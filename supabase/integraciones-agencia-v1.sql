-- MOMOS OPS · Integraciones de Agencia v1.
-- Paso 23: estado verificable de conectores sin guardar secretos en tablas públicas.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260715'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations where id='20260715_22_produccion_creativa') then
    raise exception 'Falta el paso 22_produccion_creativa.';
  end if;
end $$;

create table if not exists public.agency_integrations (
  provider text primary key check(provider in ('Higgsfield','HeyGen','Meta','TikTok')),
  kind text not null check(kind in ('Generación','Distribución y métricas')),
  status text not null default 'Por conectar' check(status in ('Por conectar','Configurada','Activa','Pausada','Con error')),
  environment text not null default 'Producción' check(environment in ('Pruebas','Producción')),
  account_label text not null default '',
  external_account_id text not null default '',
  capabilities jsonb not null default '[]'::jsonb check(jsonb_typeof(capabilities)='array'),
  secret_configured boolean not null default false,
  last_heartbeat_at timestamptz,
  last_sync_at timestamptz,
  last_error text not null default '',
  configured_by text references public.users(id),
  updated_at timestamptz not null default now()
);

insert into public.agency_integrations(provider,kind,capabilities)
values
  ('Higgsfield','Generación','["Imagen","Video","Edición"]'::jsonb),
  ('HeyGen','Generación','["Video","Avatar","Voz"]'::jsonb),
  ('Meta','Distribución y métricas','["Instagram","Facebook","Métricas"]'::jsonb),
  ('TikTok','Distribución y métricas','["TikTok","Pauta","Métricas"]'::jsonb)
on conflict(provider) do nothing;

alter table public.agency_integrations enable row level security;
drop policy if exists staff_read on public.agency_integrations;
create policy staff_read on public.agency_integrations for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.agency_integrations from public,anon,authenticated;
grant select on public.agency_integrations to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_integrations') then
    alter publication supabase_realtime add table public.agency_integrations;
  end if;
end $$;

create or replace function public.integraciones_agencia_disponibles() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

-- El navegador guarda únicamente la referencia de cuenta. Tokens, API keys y
-- secretos viven en Supabase Secrets y solo el conector server-side los conoce.
create or replace function public.guardar_referencia_integracion_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_provider text:=btrim(coalesce(p->>'provider',''));
  v_environment text:=coalesce(nullif(p->>'environment',''),'Producción');
  v_label text:=btrim(coalesce(p->>'account_label','')); v_external text:=btrim(coalesce(p->>'external_account_id',''));
  v_current public.agency_integrations%rowtype;
begin
  v_actor:=public._agency_actor();
  if public.has_current_role('Administrador') is not true then raise exception 'Solo Administración puede configurar integraciones.'; end if;
  select * into v_current from public.agency_integrations where provider=v_provider for update;
  if v_current.provider is null then raise exception 'El proveedor no pertenece al catálogo protegido.'; end if;
  if v_environment not in ('Pruebas','Producción') then raise exception 'Entorno de integración inválido.'; end if;
  if length(v_label)<2 or length(v_label)>100 or length(v_external)>160 then raise exception 'Completá una referencia de cuenta válida.'; end if;
  update public.agency_integrations set
    environment=v_environment,account_label=v_label,external_account_id=v_external,
    status=case when status in ('Activa','Pausada','Con error') then status else 'Configurada' end,
    configured_by=v_actor.id,updated_at=now()
  where provider=v_provider;
  perform public._add_audit('Integración agencia',v_provider,'Referencia de cuenta actualizada','',v_environment||' · '||v_label);
  return jsonb_build_object('ok',true,'provider',v_provider,'status',(select status from public.agency_integrations where provider=v_provider));
end $$;

create or replace function public.pausar_integracion_agencia(p_provider text,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_provider text:=btrim(coalesce(p_provider,'')); v_reason text:=btrim(coalesce(p_reason,''));
begin
  v_actor:=public._agency_actor();
  if public.has_current_role('Administrador') is not true then raise exception 'Solo Administración puede pausar integraciones.'; end if;
  if not exists(select 1 from public.agency_integrations where provider=v_provider) then raise exception 'La integración no existe.'; end if;
  if length(v_reason)<3 then raise exception 'Indicá por qué se pausa la integración.'; end if;
  update public.agency_integrations set status='Pausada',last_error=v_reason,configured_by=v_actor.id,updated_at=now() where provider=v_provider;
  perform public._add_audit('Integración agencia',v_provider,'Integración pausada','',v_reason);
  return jsonb_build_object('ok',true,'provider',v_provider,'status','Pausada');
end $$;

-- Contrato privado para Edge Functions/conectores. No acepta ni devuelve el
-- secreto: únicamente certifica si el runtime pudo leerlo y contactar al proveedor.
create or replace function public.reportar_integracion_agencia_conector(
  p_provider text,p_status text,p_secret_configured boolean,p_error text default '',
  p_capabilities jsonb default null,p_account_label text default null,p_external_account_id text default null,
  p_synced boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_provider text:=btrim(coalesce(p_provider,'')); v_error text:=btrim(coalesce(p_error,''));
begin
  if not exists(select 1 from public.agency_integrations where provider=v_provider) then raise exception 'La integración no existe.'; end if;
  if p_status not in ('Configurada','Activa','Con error') then raise exception 'Estado de conector inválido.'; end if;
  if p_status='Activa' and p_secret_configured is not true then raise exception 'Un conector sin secreto no puede declararse Activo.'; end if;
  if p_status='Con error' and length(v_error)<3 then raise exception 'El conector debe explicar el error.'; end if;
  if p_capabilities is not null and jsonb_typeof(p_capabilities)<>'array' then raise exception 'Capacidades inválidas.'; end if;
  update public.agency_integrations set status=p_status,secret_configured=coalesce(p_secret_configured,false),
    last_heartbeat_at=now(),last_sync_at=case when p_synced then now() else last_sync_at end,
    last_error=case when p_status='Con error' then v_error else '' end,
    capabilities=coalesce(p_capabilities,capabilities),
    account_label=coalesce(nullif(btrim(p_account_label),''),account_label),
    external_account_id=coalesce(nullif(btrim(p_external_account_id),''),external_account_id),updated_at=now()
  where provider=v_provider;
  return jsonb_build_object('ok',true,'provider',v_provider,'status',p_status,'heartbeat_at',now());
end $$;

-- Refuerza el contrato del paso 22: un trabajo autorizado no puede salir del
-- servidor si el motor no está activo, tiene secreto ausente o heartbeat vencido.
create or replace function public.tomar_trabajo_creativo_conector(p_job_id bigint,p_provider_job_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_job public.creative_generation_jobs%rowtype; v_external text:=btrim(coalesce(p_provider_job_id,''));
  v_integration public.agency_integrations%rowtype;
begin
  select * into v_job from public.creative_generation_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.status<>'Autorizado' then raise exception 'El trabajo no está autorizado para iniciar.'; end if;
  if v_external='' then raise exception 'Falta la identidad del trabajo en el proveedor.'; end if;
  select * into v_integration from public.agency_integrations where provider=v_job.provider;
  if v_integration.provider is null or v_integration.status<>'Activa' or v_integration.secret_configured is not true then
    raise exception 'El conector % no está activo o no tiene secreto confirmado.',v_job.provider;
  end if;
  if v_integration.last_heartbeat_at is null or v_integration.last_heartbeat_at<now()-interval '30 minutes' then
    raise exception 'El conector % no reporta actividad reciente.',v_job.provider;
  end if;
  perform public._validar_fuentes_trabajo_creativo(v_job.id);
  update public.creative_generation_jobs set status='En generación',provider_job_id=v_external,
    attempt_count=attempt_count+1,started_at=now(),error_message='',updated_at=now() where id=v_job.id;
  return jsonb_build_object('ok',true,'job_id',v_job.id,'status','En generación');
end $$;

revoke all on function public.integraciones_agencia_disponibles() from public,anon;
revoke all on function public.guardar_referencia_integracion_agencia(jsonb) from public,anon;
revoke all on function public.pausar_integracion_agencia(text,text) from public,anon;
revoke all on function public.reportar_integracion_agencia_conector(text,text,boolean,text,jsonb,text,text,boolean) from public,anon,authenticated;
revoke all on function public.tomar_trabajo_creativo_conector(bigint,text) from public,anon,authenticated;
grant execute on function public.integraciones_agencia_disponibles() to authenticated;
grant execute on function public.guardar_referencia_integracion_agencia(jsonb) to authenticated;
grant execute on function public.pausar_integracion_agencia(text,text) to authenticated;
grant execute on function public.reportar_integracion_agencia_conector(text,text,boolean,text,jsonb,text,text,boolean) to service_role;
grant execute on function public.tomar_trabajo_creativo_conector(bigint,text) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260715_23_integraciones_agencia','Salud, cuentas y contratos privados para motores creativos, Meta y TikTok sin exponer secretos')
on conflict(id) do update set detalle=excluded.detalle;

commit;
