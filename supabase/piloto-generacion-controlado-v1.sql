-- MOMOS OPS · H109 · Piloto controlado de generación real.
-- Un trabajo H108 autorizado necesita un permiso temporal y explícito antes de
-- que un worker en modo piloto pueda arrendarlo. Publicar continúa prohibido.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_108_autorizacion_generacion_preflight') then
    raise exception 'H109 requiere H108 y la cadena operativa 01-108.';
  end if;
  if to_regclass('public.agency_formula_generation_authorizations') is null
     or to_regclass('public.creative_connector_runs') is null
     or to_regprocedure('public._validar_fuentes_trabajo_creativo(bigint)') is null
     or to_regprocedure('public._mcp_human_job_fingerprint(bigint)') is null then
    raise exception 'H109 requiere autorizaciones, cola creativa y conectores canónicos.';
  end if;
end $$;

create table if not exists public.agency_generation_pilots(
  id bigint generated always as identity primary key,
  pilot_key text not null unique check(pilot_key ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  authorization_id bigint not null unique
    references public.agency_formula_generation_authorizations(id) on delete restrict,
  job_id bigint not null unique references public.creative_generation_jobs(id) on delete restrict,
  provider text not null check(provider in ('Higgsfield','Kling')),
  status text not null default 'Armado' check(status in (
    'Armado','Arrendado','Despachando','En proveedor','Incierto','Generado',
    'Fallido','Aprobado','Cambios solicitados','Descartado','Cancelado','Expirado')),
  max_cost_cop numeric(16,2) not null check(max_cost_cop>0),
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
  authorization_fingerprint text not null check(authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  job_fingerprint text not null check(job_fingerprint ~ '^[0-9a-f]{32}$'),
  pilot_snapshot jsonb not null check(jsonb_typeof(pilot_snapshot)='object'),
  pilot_fingerprint text not null check(pilot_fingerprint ~ '^[0-9a-f]{64}$'),
  armed_by text not null references public.users(id),
  armed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null check(expires_at>armed_at),
  connector_run_id bigint unique references public.creative_connector_runs(id) on delete restrict,
  claimed_at timestamptz,
  finished_at timestamptz,
  cancelled_by text references public.users(id),
  cancelled_at timestamptz,
  cancellation_reason text not null default '',
  check((status='Armado' and connector_run_id is null and claimed_at is null and finished_at is null)
    or (status in ('Cancelado','Expirado') and connector_run_id is null and claimed_at is null and finished_at is not null)
    or (status not in ('Armado','Cancelado','Expirado') and connector_run_id is not null and claimed_at is not null)),
  check((status='Cancelado' and cancelled_by is not null and cancelled_at is not null
      and length(btrim(cancellation_reason))>=5)
    or (status<>'Cancelado' and cancelled_by is null and cancelled_at is null and cancellation_reason=''))
);
create unique index if not exists agency_generation_pilots_one_armed_uq
  on public.agency_generation_pilots((true)) where status='Armado';
create index if not exists agency_generation_pilots_recent_idx
  on public.agency_generation_pilots(armed_at desc,id desc);

alter table public.agency_generation_pilots enable row level security;
drop policy if exists no_direct_access on public.agency_generation_pilots;
create policy no_direct_access on public.agency_generation_pilots
  for all to authenticated using(false) with check(false);
revoke all on public.agency_generation_pilots from public,anon,authenticated,service_role;
revoke all on sequence public.agency_generation_pilots_id_seq from public,anon,authenticated,service_role;

create or replace function public.piloto_generacion_controlado_disponible()
returns boolean language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_generation_pilot_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'El piloto de generación es evidencia inmutable.'; end if;
  if new.pilot_key is distinct from old.pilot_key
     or new.authorization_id is distinct from old.authorization_id
     or new.job_id is distinct from old.job_id
     or new.provider is distinct from old.provider
     or new.max_cost_cop is distinct from old.max_cost_cop
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.authorization_fingerprint is distinct from old.authorization_fingerprint
     or new.job_fingerprint is distinct from old.job_fingerprint
     or new.pilot_snapshot is distinct from old.pilot_snapshot
     or new.pilot_fingerprint is distinct from old.pilot_fingerprint
     or new.armed_by is distinct from old.armed_by
     or new.armed_at is distinct from old.armed_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'El contrato del piloto está sellado.';
  end if;
  return new;
end $$;
drop trigger if exists agency_generation_pilot_guard on public.agency_generation_pilots;
create trigger agency_generation_pilot_guard before update or delete
  on public.agency_generation_pilots for each row execute function public._agency_generation_pilot_guard();

create or replace function public.armar_piloto_generacion_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype;
  v_key text:=btrim(coalesce(p->>'pilot_key',''));
  v_auth_id bigint:=nullif(p->>'authorization_id','')::bigint;
  v_minutes integer:=coalesce(nullif(p->>'expires_in_minutes','')::integer,0);
  v_note text:=btrim(coalesce(p->>'decision_note',''));
  v_ack boolean:=coalesce((p->>'acknowledge_single_external_generation')::boolean,false);
  v_auth public.agency_formula_generation_authorizations%rowtype;
  v_job public.creative_generation_jobs%rowtype;
  v_integration public.agency_integrations%rowtype;
  v_existing public.agency_generation_pilots%rowtype;
  v_request jsonb; v_request_fp text; v_snapshot jsonb; v_fp text; v_id bigint;
begin
  v_actor:=public._agency_actor();
  if not public.has_current_role('Administrador') then
    raise exception 'Solo Administración puede armar un piloto que habilite consumo externo.';
  end if;
  if p is null or jsonb_typeof(p)<>'object'
     or (select count(*) from jsonb_object_keys(p))<>5
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in(
       'pilot_key','authorization_id','expires_in_minutes','decision_note',
       'acknowledge_single_external_generation'))
     or v_key !~ '^[A-Za-z0-9_.:-]{8,120}$' or v_auth_id is null or v_auth_id<=0
     or v_minutes not between 5 and 120 or length(v_note) not between 20 and 600
     or v_note ~ '[\u0000-\u001f\u007f]'
     or v_note ~* '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|sb_secret_|access[_ -]?token|service[_ -]?role|api[_ -]?key|authorization)'
     or regexp_replace(v_note,'[^0-9]','','g') ~ '[0-9]{10,}'
     or not v_ack or public._agency_mesa_has_secret(p) then
    raise exception 'El piloto necesita identidad, vigencia, criterio seguro y confirmación explícita.';
  end if;
  perform pg_advisory_xact_lock(hashtext('h109:generation-pilot'));
  select * into v_auth from public.agency_formula_generation_authorizations where id=v_auth_id;
  if v_auth.id is null then raise exception 'La autorización H108 no existe.'; end if;
  select * into v_job from public.creative_generation_jobs where id=v_auth.job_id for update;
  v_request:=jsonb_build_object('schema_version','momos-generation-pilot-request/v1',
    'pilot_key',v_key,'authorization_id',v_auth.id,'authorization_fingerprint',v_auth.authorization_fingerprint,
    'expires_in_minutes',v_minutes,'decision_note',v_note,
    'acknowledge_single_external_generation',true);
  v_request_fp:=public._agency_creative_intelligence_fingerprint(v_request);
  select * into v_existing from public.agency_generation_pilots where pilot_key=v_key;
  if v_existing.id is not null then
    if v_existing.authorization_id<>v_auth.id or v_existing.request_fingerprint<>v_request_fp then
      raise exception 'La clave idempotente ya armó otro piloto.';
    end if;
    return jsonb_build_object('ok',true,'pilot_id',v_existing.id,'authorization_id',v_existing.authorization_id,
      'job_id',v_existing.job_id,'provider',v_existing.provider,'status',v_existing.status,
      'duplicate',true,'pilot_worker_may_claim',v_existing.status='Armado' and v_existing.expires_at>clock_timestamp(),
      'external_execution_started',v_existing.connector_run_id is not null,
      'credits_consumed',false,'publication_allowed',false);
  end if;
  if exists(select 1 from public.agency_generation_pilots where authorization_id=v_auth.id) then
    raise exception 'Esta autorización ya pertenece a otro piloto; consultá su estado.';
  end if;
  update public.agency_generation_pilots set status='Expirado',finished_at=clock_timestamp()
    where status='Armado' and expires_at<=clock_timestamp();
  if exists(select 1 from public.agency_generation_pilots where status='Armado') then
    raise exception 'Ya existe un piloto armado. Ejecutalo, cancelalo o esperá su vencimiento.';
  end if;
  if v_job.id is null or v_job.status<>'Autorizado' or v_job.provider<>v_auth.provider
     or v_job.max_cost_cop<>v_auth.max_cost_cop
     or public._mcp_human_job_fingerprint(v_job.id)<>v_auth.job_fingerprint then
    raise exception 'El trabajo cambió o dejó de conservar la autorización H108 exacta.';
  end if;
  if exists(select 1 from public.creative_connector_runs where job_id=v_job.id
    and state in ('Arrendado','Despachando','En proveedor','Incierto')) then
    raise exception 'El trabajo ya tiene una ejecución activa o incierta.';
  end if;
  select * into v_integration from public.agency_integrations where provider=v_job.provider;
  if v_integration.provider is null or v_integration.status<>'Activa' or not v_integration.secret_configured
     or v_integration.last_heartbeat_at is null
     or v_integration.last_heartbeat_at<clock_timestamp()-interval '30 minutes' then
    raise exception 'El conector no está activo, autenticado o con heartbeat reciente.';
  end if;
  perform public._validar_fuentes_trabajo_creativo(v_job.id);
  v_snapshot:=jsonb_build_object('schema_version','momos-generation-pilot/v1',
    'request',v_request,
    'authorization',jsonb_build_object('id',v_auth.id,'fingerprint',v_auth.authorization_fingerprint),
    'job',jsonb_build_object('id',v_job.id,'fingerprint',v_auth.job_fingerprint,
      'provider',v_job.provider,'operation',v_job.operation,'target_channel',v_job.target_channel,
      'target_format',v_job.target_format,'max_cost_cop',v_job.max_cost_cop),
    'connector',jsonb_build_object('provider',v_integration.provider,'healthy_at_arm',true),
    'guards',jsonb_build_object('single_job',true,'temporary_permit',true,
      'pilot_worker_required',true,'external_execution_started',false,
      'credits_consumed_by_arm',false,'human_review_required',true,'publication_allowed',false));
  v_fp:=public._agency_creative_intelligence_fingerprint(v_snapshot);
  insert into public.agency_generation_pilots(pilot_key,authorization_id,job_id,provider,max_cost_cop,
    request_fingerprint,authorization_fingerprint,job_fingerprint,pilot_snapshot,pilot_fingerprint,
    armed_by,expires_at)
  values(v_key,v_auth.id,v_job.id,v_job.provider,v_job.max_cost_cop,v_request_fp,
    v_auth.authorization_fingerprint,v_auth.job_fingerprint,v_snapshot,v_fp,v_actor.id,
    clock_timestamp()+make_interval(mins=>v_minutes)) returning id into v_id;
  perform public._add_audit('Piloto de generación',v_id::text,'Piloto armado','Autorizado',
    v_job.provider||' · trabajo #'||v_job.id::text||' · tope COP '||v_job.max_cost_cop::text);
  return jsonb_build_object('ok',true,'pilot_id',v_id,'authorization_id',v_auth.id,'job_id',v_job.id,
    'provider',v_job.provider,'status','Armado','duplicate',false,'pilot_worker_may_claim',true,
    'external_execution_started',false,'credits_consumed',false,'publication_allowed',false,
    'pilot_fingerprint',v_fp);
end $$;

create or replace function public.cancelar_piloto_generacion_v1(p_pilot_id bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_pilot public.agency_generation_pilots%rowtype;
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  v_actor:=public._agency_actor();
  if not public.has_current_role('Administrador') then raise exception 'Solo Administración puede cancelar el piloto.'; end if;
  select * into v_pilot from public.agency_generation_pilots where id=p_pilot_id for update;
  if v_pilot.id is null or v_pilot.status<>'Armado' then raise exception 'Solo un piloto Armado puede cancelarse sin riesgo.'; end if;
  if length(v_reason)<5 or length(v_reason)>500 or v_reason ~ '[\u0000-\u001f\u007f]'
     or public._agency_mesa_has_secret(jsonb_build_object('reason',v_reason)) then
    raise exception 'Documentá un motivo seguro de cancelación.';
  end if;
  update public.agency_generation_pilots set status='Cancelado',finished_at=clock_timestamp(),
    cancelled_by=v_actor.id,cancelled_at=clock_timestamp(),cancellation_reason=v_reason where id=v_pilot.id;
  perform public._add_audit('Piloto de generación',v_pilot.id::text,'Piloto cancelado','Armado','Cancelado');
  return jsonb_build_object('ok',true,'pilot_id',v_pilot.id,'job_id',v_pilot.job_id,
    'status','Cancelado','external_execution_started',false,'publication_allowed',false);
end $$;

-- Toda inserción de run para un trabajo H108 exige el contexto privado H109.
create or replace function public._agency_generation_pilot_run_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_auth bigint; v_pilot bigint:=nullif(current_setting('momos.generation_pilot_id',true),'')::bigint;
begin
  select id into v_auth from public.agency_formula_generation_authorizations where job_id=new.job_id;
  if v_auth is null then return new; end if;
  if v_pilot is null or not exists(select 1 from public.agency_generation_pilots
    where id=v_pilot and authorization_id=v_auth and job_id=new.job_id and provider=new.provider
      and status='Armado' and expires_at>clock_timestamp()) then
    raise exception 'Los trabajos H108 solo pueden reclamarse mediante un piloto H109 armado.';
  end if;
  return new;
end $$;
drop trigger if exists agency_generation_pilot_run_guard on public.creative_connector_runs;
create trigger agency_generation_pilot_run_guard before insert on public.creative_connector_runs
  for each row execute function public._agency_generation_pilot_run_guard();

-- El carril general omite cualquier trabajo gobernado por H108. Así un worker
-- actualizado puede seguir procesando la cola normal sin tocar ni bloquear el
-- único trabajo que requiere permiso H109.
create or replace function public.reclamar_trabajo_creativo_general_v1(
  p_provider text,p_worker_id text,p_lease_seconds integer default 600)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_provider text:=btrim(coalesce(p_provider,'')); v_worker text:=btrim(coalesce(p_worker_id,''));
  v_job public.creative_generation_jobs%rowtype; v_run public.creative_connector_runs%rowtype;
  v_integration public.agency_integrations%rowtype; v_assets jsonb;
begin
  if v_provider not in ('Higgsfield','Kling') or length(v_worker) not between 3 and 120
     or p_lease_seconds not between 30 and 1800 then
    raise exception 'Proveedor, worker o lease inválido para la cola general.';
  end if;
  select * into v_integration from public.agency_integrations where provider=v_provider;
  if v_integration.provider is null or v_integration.status<>'Activa' or not v_integration.secret_configured
     or v_integration.last_heartbeat_at is null
     or v_integration.last_heartbeat_at<clock_timestamp()-interval '30 minutes' then
    raise exception 'El conector general no está activo, autenticado o con heartbeat reciente.';
  end if;
  update public.creative_connector_runs set state='Expirado',finished_at=clock_timestamp(),
    error_message='Lease vencido antes de confirmar despacho'
  where provider=v_provider and state='Arrendado' and lease_expires_at<clock_timestamp();
  select j.* into v_job from public.creative_generation_jobs j
  where j.provider=v_provider and j.status='Autorizado'
    and not exists(select 1 from public.agency_formula_generation_authorizations a where a.job_id=j.id)
    and not exists(select 1 from public.creative_connector_runs r where r.job_id=j.id
      and r.state in ('Arrendado','Despachando','En proveedor','Incierto'))
  order by j.authorized_at nulls last,j.id for update skip locked limit 1;
  if v_job.id is null then return jsonb_build_object('ok',true,'job',null); end if;
  perform public._validar_fuentes_trabajo_creativo(v_job.id);
  insert into public.creative_connector_runs(job_id,provider,worker_id,lease_expires_at)
  values(v_job.id,v_provider,v_worker,clock_timestamp()+make_interval(secs=>p_lease_seconds))
  returning * into v_run;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'name',a.name,'media_type',a.media_type,'mime_type',a.mime_type,
    'storage_path',a.storage_path,'size_bytes',a.size_bytes,'content_hash',a.content_hash,
    'product_id',a.product_id,'figure',a.figure,'flavor',a.flavor
  ) order by src.ord),'[]'::jsonb) into v_assets
  from jsonb_array_elements_text(v_job.input_asset_ids) with ordinality src(id,ord)
  join public.brand_media_assets a on a.id=src.id::bigint;
  return jsonb_build_object('ok',true,'run_id',v_run.id,'lease_token',v_run.lease_token,
    'lease_expires_at',v_run.lease_expires_at,'job',jsonb_build_object(
      'id',v_job.id,'creative_id',v_job.creative_id,'brief_id',v_job.brief_id,
      'operation',v_job.operation,'target_channel',v_job.target_channel,
      'target_format',v_job.target_format,'prompt',v_job.prompt,
      'negative_prompt',v_job.negative_prompt,'brand_snapshot',v_job.brand_snapshot,
      'output_spec',v_job.output_spec,'max_cost_cop',v_job.max_cost_cop,'assets',v_assets));
end $$;

create or replace function public.reclamar_piloto_generacion_v1(
  p_provider text,p_worker_id text,p_lease_seconds integer default 600)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_provider text:=btrim(coalesce(p_provider,'')); v_worker text:=btrim(coalesce(p_worker_id,''));
  v_pilot public.agency_generation_pilots%rowtype; v_job public.creative_generation_jobs%rowtype;
  v_run public.creative_connector_runs%rowtype; v_integration public.agency_integrations%rowtype; v_assets jsonb;
begin
  if v_provider not in ('Higgsfield','Kling') or length(v_worker) not between 3 and 120
     or p_lease_seconds not between 30 and 1800 then
    raise exception 'Proveedor, worker o lease inválido para el piloto.';
  end if;
  perform pg_advisory_xact_lock(hashtext('h109:generation-pilot'));
  update public.agency_generation_pilots set status='Expirado',finished_at=clock_timestamp()
    where status='Armado' and expires_at<=clock_timestamp();
  select * into v_pilot from public.agency_generation_pilots
    where provider=v_provider and status='Armado' and expires_at>clock_timestamp()
    order by armed_at,id for update skip locked limit 1;
  if v_pilot.id is null then return jsonb_build_object('ok',true,'pilot',null,'job',null); end if;
  select * into v_integration from public.agency_integrations where provider=v_provider;
  if v_integration.provider is null or v_integration.status<>'Activa' or not v_integration.secret_configured
     or v_integration.last_heartbeat_at is null
     or v_integration.last_heartbeat_at<clock_timestamp()-interval '30 minutes' then
    raise exception 'El conector del piloto dejó de estar saludable.';
  end if;
  select * into v_job from public.creative_generation_jobs where id=v_pilot.job_id for update;
  if v_job.id is null or v_job.status<>'Autorizado' or v_job.provider<>v_pilot.provider
     or v_job.max_cost_cop<>v_pilot.max_cost_cop
     or public._mcp_human_job_fingerprint(v_job.id)<>v_pilot.job_fingerprint then
    raise exception 'El trabajo del piloto cambió antes de su ejecución.';
  end if;
  if exists(select 1 from public.creative_connector_runs where job_id=v_job.id
    and state in ('Arrendado','Despachando','En proveedor','Incierto')) then
    raise exception 'El trabajo del piloto ya tiene una ejecución activa o incierta.';
  end if;
  perform public._validar_fuentes_trabajo_creativo(v_job.id);
  perform set_config('momos.generation_pilot_id',v_pilot.id::text,true);
  insert into public.creative_connector_runs(job_id,provider,worker_id,lease_expires_at)
  values(v_job.id,v_provider,v_worker,clock_timestamp()+make_interval(secs=>p_lease_seconds)) returning * into v_run;
  update public.agency_generation_pilots set status='Arrendado',connector_run_id=v_run.id,
    claimed_at=clock_timestamp() where id=v_pilot.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'name',a.name,'media_type',a.media_type,'mime_type',a.mime_type,'storage_path',a.storage_path,
    'size_bytes',a.size_bytes,'content_hash',a.content_hash,'product_id',a.product_id,'figure',a.figure,'flavor',a.flavor
  ) order by src.ord),'[]'::jsonb) into v_assets
  from jsonb_array_elements_text(v_job.input_asset_ids) with ordinality src(id,ord)
  join public.brand_media_assets a on a.id=src.id::bigint;
  return jsonb_build_object('ok',true,'pilot',jsonb_build_object('id',v_pilot.id,'key',v_pilot.pilot_key),
    'run_id',v_run.id,'lease_token',v_run.lease_token,'lease_expires_at',v_run.lease_expires_at,
    'job',jsonb_build_object('id',v_job.id,'creative_id',v_job.creative_id,'brief_id',v_job.brief_id,
      'operation',v_job.operation,'target_channel',v_job.target_channel,'target_format',v_job.target_format,
      'prompt',v_job.prompt,'negative_prompt',v_job.negative_prompt,'brand_snapshot',v_job.brand_snapshot,
      'output_spec',v_job.output_spec,'max_cost_cop',v_job.max_cost_cop,'assets',v_assets));
end $$;

create or replace function public._agency_generation_pilot_sync_run()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  v_status:=case new.state when 'Arrendado' then 'Arrendado' when 'Despachando' then 'Despachando'
    when 'En proveedor' then 'En proveedor' when 'Incierto' then 'Incierto'
    when 'Completado' then 'Generado' when 'Fallido' then 'Fallido'
    when 'Expirado' then 'Fallido' else null end;
  if v_status is not null then
    update public.agency_generation_pilots set status=v_status,
      finished_at=case when v_status in ('Generado','Fallido') then coalesce(new.finished_at,clock_timestamp()) else finished_at end
    where connector_run_id=new.id and status not in ('Aprobado','Cambios solicitados','Descartado');
  end if;
  return new;
end $$;
drop trigger if exists agency_generation_pilot_sync_run on public.creative_connector_runs;
create trigger agency_generation_pilot_sync_run after update of state on public.creative_connector_runs
  for each row execute function public._agency_generation_pilot_sync_run();

create or replace function public._agency_generation_pilot_sync_review()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  if new.status='Fallido' then v_status:='Fallido';
  elsif new.status='Cancelado' then
    update public.agency_generation_pilots set status='Cancelado',finished_at=clock_timestamp(),
      cancelled_by=new.cancelled_by,cancelled_at=coalesce(new.cancelled_at,clock_timestamp()),
      cancellation_reason=case when length(btrim(coalesce(new.cancellation_reason,'')))>=5
        then new.cancellation_reason else 'Trabajo creativo cancelado' end
    where job_id=new.id and connector_run_id is null and status='Armado';
    return new;
  elsif new.status='Completado' then
    v_status:=case new.output_review_status when 'Aprobada' then 'Aprobado'
      when 'Cambios solicitados' then 'Cambios solicitados' when 'Descartada' then 'Descartado'
      else 'Generado' end;
  end if;
  if v_status is not null then
    update public.agency_generation_pilots set status=v_status,
      finished_at=case when v_status in ('Generado','Fallido','Aprobado','Cambios solicitados','Descartado','Cancelado')
        then coalesce(finished_at,clock_timestamp()) else finished_at end
    where job_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists agency_generation_pilot_sync_review on public.creative_generation_jobs;
create trigger agency_generation_pilot_sync_review after update of status,output_review_status
  on public.creative_generation_jobs for each row execute function public._agency_generation_pilot_sync_review();

create or replace function public.momos_generation_pilots_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb; v_snapshot jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'authorization_id',p.authorization_id,'job_id',p.job_id,'provider',p.provider,
    'status',case when p.status='Armado' and p.expires_at<=clock_timestamp() then 'Expirado' else p.status end,
    'max_cost_cop',p.max_cost_cop,'pilot_fingerprint',p.pilot_fingerprint,
    'authorization_fingerprint',p.authorization_fingerprint,'job_fingerprint',p.job_fingerprint,
    'armed_at',p.armed_at,'expires_at',p.expires_at,'claimed_at',p.claimed_at,'finished_at',p.finished_at,
    'connector_run_id',p.connector_run_id,
    'pilot_worker_may_claim',p.status='Armado' and p.expires_at>clock_timestamp(),
    'external_execution_started',p.connector_run_id is not null,
    'human_review_required',true,'publication_allowed',false)
    order by p.armed_at desc,p.id desc),'[]'::jsonb)
  into v_rows from public.agency_generation_pilots p;
  v_snapshot:=jsonb_build_object('schema_version','momos-generation-pilots/v1',
    'generated_at',clock_timestamp(),'pilots',v_rows,
    'summary',jsonb_build_object('pilots',jsonb_array_length(v_rows),
      'armed',(select count(*) from public.agency_generation_pilots where status='Armado' and expires_at>clock_timestamp()),
      'running',(select count(*) from public.agency_generation_pilots where status in ('Arrendado','Despachando','En proveedor')),
      'uncertain',(select count(*) from public.agency_generation_pilots where status='Incierto'),
      'awaiting_review',(select count(*) from public.agency_generation_pilots where status='Generado')),
    'privacy',jsonb_build_object('contains_customer_pii',false,'contains_staff_identity',false,
      'contains_storage_paths',false,'contains_secrets',false,'contains_order_ids',false),
    'single_active_pilot',true,'human_authorization_required',true,
    'credits_consumed_by_arm',false,'publication_allowed',false);
  return jsonb_build_object('snapshot',v_snapshot,
    'fingerprint',public._agency_creative_intelligence_fingerprint(v_snapshot));
end $$;

-- H109 corrige la lectura H108: Autorizado no equivale a reclamable sin piloto.
create or replace function public.momos_generation_authorizations_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb; v_snapshot jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'authorization_key',a.authorization_key,'plan_id',a.plan_id,
    'job_id',a.job_id,'provider',a.provider,'status',a.status,
    'job_status',j.status,'operation',j.operation,'target_channel',j.target_channel,
    'target_format',j.target_format,'max_cost_cop',a.max_cost_cop,
    'plan_fingerprint',a.plan_fingerprint,'job_fingerprint',a.job_fingerprint,
    'authorization_fingerprint',a.authorization_fingerprint,'authorized_at',a.authorized_at,
    'worker_may_claim',exists(select 1 from public.agency_generation_pilots p
      where p.authorization_id=a.id and p.status='Armado' and p.expires_at>clock_timestamp()),
    'publication_allowed',false) order by a.authorized_at desc,a.id desc),'[]'::jsonb)
  into v_rows from public.agency_formula_generation_authorizations a
  join public.creative_generation_jobs j on j.id=a.job_id;
  v_snapshot:=jsonb_build_object('schema_version','momos-generation-authorizations/v1',
    'generated_at',clock_timestamp(),'authorizations',v_rows,
    'summary',jsonb_build_object('authorizations',jsonb_array_length(v_rows),
      'ready_for_worker',(select count(*) from public.agency_generation_pilots
        where status='Armado' and expires_at>clock_timestamp()),
      'in_progress',(select count(*) from public.agency_generation_pilots
        where status in ('Arrendado','Despachando','En proveedor')),
      'completed',(select count(*) from public.agency_generation_pilots
        where status in ('Generado','Aprobado','Cambios solicitados','Descartado'))),
    'privacy',jsonb_build_object('contains_customer_pii',false,'contains_staff_identity',false,
      'contains_storage_paths',false,'contains_secrets',false,'contains_order_ids',false),
    'human_authorization_required',true,'credits_consumed_by_authorization',false,
    'external_generation_authorized',true,'publication_allowed',false);
  return jsonb_build_object('snapshot',v_snapshot,
    'fingerprint',public._agency_creative_intelligence_fingerprint(v_snapshot));
end $$;

alter table public.agency_mcp_access_log drop constraint if exists agency_mcp_access_log_tool_name_check;
alter table public.agency_mcp_access_log add constraint agency_mcp_access_log_tool_name_check check(tool_name in (
  'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_intelligence',
  'momos_propose_creative_formula','momos_humanization_community','momos_propose_humanization_series',
  'momos_propose_humanization_episode','momos_visual_library','momos_production_preflight',
  'momos_generation_authorizations','momos_generation_pilots','momos_prepare_production_plan',
  'momos_creative_context','momos_search_brand_assets','momos_get_brand_asset_reference',
  'momos_submit_proposals','momos_request_human_approval','momos_get_human_approval'));

-- Mantiene la implementación canónica de auditoría y solo amplía la lista cerrada.
create or replace function public.registrar_acceso_mcp_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'request_key','')); v_tool text:=btrim(coalesce(p->>'tool_name',''));
  v_mode text:=btrim(coalesce(p->>'mode','')); v_status text:=btrim(coalesce(p->>'status',''));
  v_worker text:=btrim(coalesce(p->>'worker_id','')); v_subject text:=left(btrim(coalesce(p->>'subject_ref','')),180);
  v_input text:=btrim(coalesce(p->>'input_fingerprint','')); v_output text:=btrim(coalesce(p->>'output_fingerprint',''));
  v_details jsonb:=coalesce(p->'details','{}'::jsonb); v_existing public.agency_mcp_access_log%rowtype; v_id bigint;
begin
  if p is null or jsonb_typeof(p)<>'object' or not public._agency_mcp_json_safe(p) then raise exception 'Registro MCP inválido o con secretos.'; end if;
  if v_key!~'^[A-Za-z0-9:_-]{3,180}$' or v_tool not in (
      'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_intelligence',
      'momos_propose_creative_formula','momos_humanization_community','momos_propose_humanization_series',
      'momos_propose_humanization_episode','momos_visual_library','momos_production_preflight',
      'momos_generation_authorizations','momos_generation_pilots','momos_prepare_production_plan',
      'momos_creative_context','momos_search_brand_assets','momos_get_brand_asset_reference',
      'momos_submit_proposals','momos_request_human_approval','momos_get_human_approval')
     or v_mode not in ('Lectura','Propuesta') or v_status not in ('OK','Rechazado','Error')
     or length(v_worker) not between 3 and 100 or v_input!~'^[0-9a-f]{32,64}$'
     or (v_output<>'' and v_output!~'^[0-9a-f]{32,64}$') or jsonb_typeof(v_details)<>'object'
     or v_details::text~*'(customer|cliente|phone|telefono|email|address|direccion|signed_url|storage_path|secret|token|service_role|api_key)' then
    raise exception 'Contrato de auditoría MCP inválido.';
  end if;
  select * into v_existing from public.agency_mcp_access_log where request_key=v_key;
  if v_existing.id is not null then
    if row(v_existing.tool_name,v_existing.mode,v_existing.worker_id,v_existing.subject_ref,v_existing.input_fingerprint)
       is distinct from row(v_tool,v_mode,v_worker,v_subject,v_input) then raise exception 'La clave MCP ya pertenece a otra solicitud.'; end if;
    return jsonb_build_object('ok',true,'log_id',v_existing.id,'duplicate',true);
  end if;
  insert into public.agency_mcp_access_log(request_key,tool_name,mode,status,worker_id,subject_ref,
    input_fingerprint,output_fingerprint,details)
  values(v_key,v_tool,v_mode,v_status,v_worker,v_subject,v_input,nullif(v_output,''),v_details) returning id into v_id;
  return jsonb_build_object('ok',true,'log_id',v_id,'duplicate',false);
end $$;

drop trigger if exists momos_agency_snapshot_event_v1 on public.agency_generation_pilots;
create trigger momos_agency_snapshot_event_v1 after insert or update or delete or truncate
  on public.agency_generation_pilots for each statement execute function public._momos_touch_agency_snapshot_event_v1();

revoke all on function public.piloto_generacion_controlado_disponible() from public,anon;
revoke all on function public.armar_piloto_generacion_v1(jsonb) from public,anon,service_role;
revoke all on function public.cancelar_piloto_generacion_v1(bigint,text) from public,anon,service_role;
revoke all on function public.reclamar_trabajo_creativo_general_v1(text,text,integer) from public,anon,authenticated;
revoke all on function public.reclamar_piloto_generacion_v1(text,text,integer) from public,anon,authenticated;
revoke all on function public.momos_generation_pilots_v1() from public,anon;
grant execute on function public.piloto_generacion_controlado_disponible() to authenticated,service_role;
grant execute on function public.armar_piloto_generacion_v1(jsonb) to authenticated;
grant execute on function public.cancelar_piloto_generacion_v1(bigint,text) to authenticated;
grant execute on function public.reclamar_trabajo_creativo_general_v1(text,text,integer) to service_role;
grant execute on function public.reclamar_piloto_generacion_v1(text,text,integer) to service_role;
grant execute on function public.momos_generation_pilots_v1() to authenticated,service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260722_109_piloto_generacion_controlado',
  'Permiso temporal para un único trabajo H108, worker piloto exacto, costo protegido, revisión humana y publicación bloqueada')
on conflict(id) do update set detalle=excluded.detalle;

commit;
