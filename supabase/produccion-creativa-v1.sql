-- MOMOS OPS · Producción Creativa v1.
-- Paso 22: autorización humana, tope de costo y contrato seguro para conectores.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260715'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations where id='20260715_20_biblioteca_creativa')
     or not exists(select 1 from public.momos_ops_migrations where id='20260715_21_roles_multiples') then
    raise exception 'Faltan los pasos 20_biblioteca_creativa o 21_roles_multiples.';
  end if;
end $$;

alter table public.creative_generation_jobs
  drop constraint if exists creative_generation_jobs_status_check;
alter table public.creative_generation_jobs
  add constraint creative_generation_jobs_status_check
  check(status in ('Borrador','Preparado','Autorizado','En generación','Completado','Fallido','Cancelado'));

alter table public.creative_generation_jobs
  add column if not exists max_cost_cop numeric not null default 0 check(max_cost_cop>=0),
  add column if not exists authorized_by text references public.users(id),
  add column if not exists authorized_at timestamptz,
  add column if not exists cancelled_by text references public.users(id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text not null default '',
  add column if not exists attempt_count integer not null default 0 check(attempt_count>=0),
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

create or replace function public.produccion_creativa_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._validar_fuentes_trabajo_creativo(p_job_id bigint) returns void
language plpgsql stable security definer set search_path=public as $$
declare v_ids jsonb; v_id bigint; v_asset public.brand_media_assets%rowtype;
begin
  select input_asset_ids into v_ids from public.creative_generation_jobs where id=p_job_id;
  if v_ids is null then raise exception 'El trabajo creativo no existe.'; end if;
  for v_id in select value::text::bigint from jsonb_array_elements(v_ids) loop
    select * into v_asset from public.brand_media_assets where id=v_id;
    if v_asset.id is null then raise exception 'La fuente % ya no existe.',v_id; end if;
    if v_asset.status<>'Activo' or v_asset.rights_status not in ('Propio','Autorizado')
       or v_asset.ai_use_allowed is not true
       or (v_asset.rights_expires_at is not null and v_asset.rights_expires_at<current_date)
       or (v_asset.contains_people and v_asset.rights_status<>'Autorizado') then
      raise exception 'La fuente % perdió su autorización para producción creativa.',v_id;
    end if;
  end loop;
end $$;

create or replace function public.autorizar_trabajo_creativo(p_job_id bigint,p_max_cost_cop numeric) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_job public.creative_generation_jobs%rowtype; v_paused boolean;
begin
  v_actor:=public._brand_actor();
  select * into v_job from public.creative_generation_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'El trabajo creativo no existe.'; end if;
  if v_job.status<>'Preparado' then raise exception 'Solo un trabajo Preparado puede autorizarse.'; end if;
  if v_job.provider not in ('Higgsfield','HeyGen','Manual') then raise exception 'Elegí un motor real antes de autorizar.'; end if;
  if p_max_cost_cop is null or p_max_cost_cop<0 or (v_job.provider<>'Manual' and p_max_cost_cop<=0) then
    raise exception 'Definí un tope de costo válido en COP.';
  end if;
  select paused into v_paused from public.agency_settings where id;
  if coalesce(v_paused,false) then raise exception 'La parada de emergencia de Agencia MOMOS está activa.'; end if;
  if v_job.brief_id is not null and not exists(
    select 1 from public.agency_briefs where id=v_job.brief_id and status in ('Aprobado','En producción','Completado')
  ) then raise exception 'El brief necesita aprobación humana antes de generar.'; end if;
  perform public._validar_fuentes_trabajo_creativo(v_job.id);
  update public.creative_generation_jobs set status='Autorizado',max_cost_cop=p_max_cost_cop,
    authorized_by=v_actor.id,authorized_at=now(),error_message='',updated_at=now() where id=v_job.id;
  perform public._add_audit('Estudio creativo',v_job.id::text,'Trabajo autorizado','Preparado',
    v_job.provider||' · tope COP '||p_max_cost_cop::text);
  return jsonb_build_object('ok',true,'job_id',v_job.id,'status','Autorizado','max_cost_cop',p_max_cost_cop);
end $$;

create or replace function public.cancelar_trabajo_creativo(p_job_id bigint,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_job public.creative_generation_jobs%rowtype; v_reason text:=btrim(coalesce(p_reason,''));
begin
  v_actor:=public._brand_actor();
  select * into v_job from public.creative_generation_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'El trabajo creativo no existe.'; end if;
  if v_job.status not in ('Preparado','Autorizado','Fallido') then raise exception 'El trabajo ya no puede cancelarse desde este estado.'; end if;
  if length(v_reason)<3 then raise exception 'Indicá por qué se cancela el trabajo.'; end if;
  update public.creative_generation_jobs set status='Cancelado',cancelled_by=v_actor.id,cancelled_at=now(),
    cancellation_reason=v_reason,updated_at=now() where id=v_job.id;
  perform public._add_audit('Estudio creativo',v_job.id::text,'Trabajo cancelado',v_job.status,'Cancelado · '||v_reason);
  return jsonb_build_object('ok',true,'job_id',v_job.id,'status','Cancelado');
end $$;

create or replace function public.reintentar_trabajo_creativo(p_job_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_job public.creative_generation_jobs%rowtype;
begin
  v_actor:=public._brand_actor();
  select * into v_job from public.creative_generation_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'El trabajo creativo no existe.'; end if;
  if v_job.status<>'Fallido' then raise exception 'Solo un trabajo Fallido puede volver a revisión.'; end if;
  perform public._validar_fuentes_trabajo_creativo(v_job.id);
  update public.creative_generation_jobs set status='Preparado',max_cost_cop=0,authorized_by=null,authorized_at=null,
    provider_job_id=null,error_message='',started_at=null,completed_at=null,updated_at=now() where id=v_job.id;
  perform public._add_audit('Estudio creativo',v_job.id::text,'Trabajo devuelto a revisión','Fallido','Preparado');
  return jsonb_build_object('ok',true,'job_id',v_job.id,'status','Preparado');
end $$;

-- Contrato exclusivo del conector server-side. Nunca se concede a authenticated.
create or replace function public.tomar_trabajo_creativo_conector(p_job_id bigint,p_provider_job_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_job public.creative_generation_jobs%rowtype; v_external text:=btrim(coalesce(p_provider_job_id,''));
begin
  select * into v_job from public.creative_generation_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.status<>'Autorizado' then raise exception 'El trabajo no está autorizado para iniciar.'; end if;
  if v_external='' then raise exception 'Falta la identidad del trabajo en el proveedor.'; end if;
  perform public._validar_fuentes_trabajo_creativo(v_job.id);
  update public.creative_generation_jobs set status='En generación',provider_job_id=v_external,
    attempt_count=attempt_count+1,started_at=now(),error_message='',updated_at=now() where id=v_job.id;
  return jsonb_build_object('ok',true,'job_id',v_job.id,'status','En generación');
end $$;

create or replace function public.resolver_trabajo_creativo_conector(
  p_job_id bigint,p_result text,p_output_asset_id bigint default null,p_cost_cop numeric default 0,p_error text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_job public.creative_generation_jobs%rowtype; v_asset public.brand_media_assets%rowtype;
begin
  select * into v_job from public.creative_generation_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.status<>'En generación' then raise exception 'El trabajo no está En generación.'; end if;
  if p_result not in ('Completado','Fallido') then raise exception 'Resultado de conector inválido.'; end if;
  if p_result='Fallido' then
    if length(btrim(coalesce(p_error,'')))<3 then raise exception 'El conector debe explicar el fallo.'; end if;
    update public.creative_generation_jobs set status='Fallido',error_message=btrim(p_error),completed_at=now(),updated_at=now() where id=v_job.id;
  else
    select * into v_asset from public.brand_media_assets where id=p_output_asset_id;
    if v_asset.id is null or v_asset.status<>'Activo' then raise exception 'La salida no existe en la Biblioteca de Marca.'; end if;
    if coalesce(v_asset.generation_meta->>'job_id','')<>v_job.id::text then raise exception 'La salida no pertenece a este trabajo.'; end if;
    if p_cost_cop<0 or p_cost_cop>v_job.max_cost_cop then raise exception 'El costo real supera el tope autorizado.'; end if;
    update public.creative_generation_jobs set status='Completado',output_asset_id=v_asset.id,generation_cost=p_cost_cop,
      error_message='',completed_at=now(),updated_at=now() where id=v_job.id;
  end if;
  return jsonb_build_object('ok',true,'job_id',v_job.id,'status',p_result);
end $$;

revoke all on function public.produccion_creativa_disponible() from public,anon;
revoke all on function public._validar_fuentes_trabajo_creativo(bigint) from public,anon,authenticated;
revoke all on function public.autorizar_trabajo_creativo(bigint,numeric) from public,anon;
revoke all on function public.cancelar_trabajo_creativo(bigint,text) from public,anon;
revoke all on function public.reintentar_trabajo_creativo(bigint) from public,anon;
revoke all on function public.tomar_trabajo_creativo_conector(bigint,text) from public,anon,authenticated;
revoke all on function public.resolver_trabajo_creativo_conector(bigint,text,bigint,numeric,text) from public,anon,authenticated;
grant execute on function public.produccion_creativa_disponible() to authenticated;
grant execute on function public.autorizar_trabajo_creativo(bigint,numeric) to authenticated;
grant execute on function public.cancelar_trabajo_creativo(bigint,text) to authenticated;
grant execute on function public.reintentar_trabajo_creativo(bigint) to authenticated;
grant execute on function public.tomar_trabajo_creativo_conector(bigint,text) to service_role;
grant execute on function public.resolver_trabajo_creativo_conector(bigint,text,bigint,numeric,text) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260715_22_produccion_creativa','Cola creativa con aprobación humana, tope de costo y contrato privado para motores externos')
on conflict(id) do update set detalle=excluded.detalle;

commit;
