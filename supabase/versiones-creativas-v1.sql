-- MOMOS OPS · Versiones Creativas v1.
-- Paso 27. Convierte una solicitud de cambios en un trabajo nuevo y trazable.
-- Conserva el resultado anterior, revalida las fuentes originales y nunca hereda gasto.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260715'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260715_26_revision_creativa'
  ) then raise exception 'Falta el paso 26_revision_creativa.'; end if;
end $$;

alter table public.creative_generation_jobs
  add column if not exists revision_of_job_id bigint references public.creative_generation_jobs(id) on delete restrict,
  add column if not exists revision_number integer not null default 1;

alter table public.creative_generation_jobs
  drop constraint if exists creative_generation_jobs_revision_number_check;
alter table public.creative_generation_jobs
  add constraint creative_generation_jobs_revision_number_check check(
    (revision_of_job_id is null and revision_number=1)
    or (revision_of_job_id is not null and revision_number>1 and revision_of_job_id<>id)
  );

create unique index if not exists creative_generation_jobs_one_revision_idx
  on public.creative_generation_jobs(revision_of_job_id)
  where revision_of_job_id is not null;
create index if not exists creative_generation_jobs_revision_chain_idx
  on public.creative_generation_jobs(revision_number,id);

create or replace function public.versiones_creativas_disponibles() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public.crear_revision_salida_creativa(p_job_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_source public.creative_generation_jobs%rowtype;
  v_new_id bigint; v_usage_count integer; v_expected_count integer;
  v_feedback text; v_prompt text; v_next_number integer;
begin
  v_actor:=public._brand_actor();
  select * into v_source from public.creative_generation_jobs where id=p_job_id for update;
  if v_source.id is null then raise exception 'El trabajo creativo no existe.'; end if;
  if v_source.status<>'Completado' or v_source.output_asset_id is null
     or v_source.output_review_status<>'Cambios solicitados' then
    raise exception 'Solo una salida con cambios solicitados puede abrir una nueva versión.';
  end if;
  if exists(select 1 from public.creative_generation_jobs where revision_of_job_id=v_source.id) then
    raise exception 'Esta solicitud de cambios ya tiene una nueva versión preparada.';
  end if;
  v_feedback:=btrim(v_source.output_review_feedback);
  if length(v_feedback)<5 then raise exception 'La solicitud de cambios no tiene instrucciones suficientes.'; end if;
  perform public._validar_fuentes_trabajo_creativo(v_source.id);
  select count(*)::integer into v_usage_count from public.brand_media_usages where job_id=v_source.id;
  v_expected_count:=jsonb_array_length(v_source.input_asset_ids);
  if v_usage_count<>v_expected_count then
    raise exception 'La versión original tiene trazabilidad incompleta de sus fuentes.';
  end if;

  v_next_number:=v_source.revision_number+1;
  v_prompt:=v_source.prompt||E'\n\nCORRECCIÓN HUMANA · VERSIÓN '||v_next_number||E':\n'||v_feedback;
  insert into public.creative_generation_jobs(
    creative_id,brief_id,provider,operation,status,input_asset_ids,target_channel,target_format,
    prompt,negative_prompt,brand_snapshot,output_spec,max_cost_cop,generation_cost,
    output_review_status,revision_of_job_id,revision_number,created_by
  ) values(
    v_source.creative_id,v_source.brief_id,v_source.provider,v_source.operation,'Preparado',
    v_source.input_asset_ids,v_source.target_channel,v_source.target_format,v_prompt,
    v_source.negative_prompt,v_source.brand_snapshot,
    v_source.output_spec||jsonb_build_object(
      'output_mode','new_asset','revision_of_job_id',v_source.id,
      'revision_number',v_next_number,'revision_feedback',v_feedback
    ),0,0,'No aplica',v_source.id,v_next_number,v_actor.id
  ) returning id into v_new_id;

  insert into public.brand_media_usages(asset_id,job_id,role,start_second,end_second,created_by)
  select asset_id,v_new_id,role,start_second,end_second,v_actor.id
  from public.brand_media_usages where job_id=v_source.id order by id;

  perform public._add_audit('Estudio creativo',v_source.id::text,'Nueva versión correctiva preparada',
    'Cambios solicitados','Trabajo '||v_new_id::text||' · versión '||v_next_number::text);
  perform public._add_audit('Estudio creativo',v_new_id::text,'Trabajo preparado desde revisión','',
    'Origen '||v_source.id::text||' · '||v_feedback);
  return jsonb_build_object('ok',true,'job_id',v_new_id,'status','Preparado',
    'revision_of_job_id',v_source.id,'revision_number',v_next_number,
    'max_cost_cop',0,'published',false);
end $$;

revoke all on function public.versiones_creativas_disponibles() from public,anon;
revoke all on function public.crear_revision_salida_creativa(bigint) from public,anon;
grant execute on function public.versiones_creativas_disponibles() to authenticated;
grant execute on function public.crear_revision_salida_creativa(bigint) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260715_27_versiones_creativas','Nuevas versiones desde cambios solicitados, fuentes revalidadas y costos sin herencia')
on conflict(id) do update set detalle=excluded.detalle;

commit;
