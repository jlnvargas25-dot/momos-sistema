-- MOMOS OPS · Revisión Creativa v1.
-- Paso 26, después de Kling. Sella la decisión humana sobre cada salida
-- generada sin convertirla en publicación ni permitir reutilización IA implícita.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260715'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260715_25_kling_conector'
  ) then raise exception 'Falta el paso 25_kling_conector.'; end if;
end $$;

alter table public.creative_generation_jobs
  add column if not exists output_review_status text not null default 'No aplica',
  add column if not exists output_review_feedback text not null default '',
  add column if not exists output_reviewed_by text references public.users(id),
  add column if not exists output_reviewed_at timestamptz;

update public.creative_generation_jobs
set output_review_status='Pendiente'
where status='Completado' and output_asset_id is not null and output_review_status='No aplica';

alter table public.creative_generation_jobs
  drop constraint if exists creative_generation_jobs_output_review_status_check;
alter table public.creative_generation_jobs
  add constraint creative_generation_jobs_output_review_status_check check(
    output_review_status in ('No aplica','Pendiente','Aprobada','Cambios solicitados','Descartada')
    and (
      (status='Completado' and (
        (output_asset_id is not null and output_review_status<>'No aplica')
        or (output_asset_id is null and output_review_status='No aplica')
      ))
      or (status<>'Completado' and output_review_status='No aplica')
    )
  );
alter table public.creative_generation_jobs
  drop constraint if exists creative_generation_jobs_output_review_integrity_check;
alter table public.creative_generation_jobs
  add constraint creative_generation_jobs_output_review_integrity_check check(
    (output_review_status in ('No aplica','Pendiente')
      and output_reviewed_by is null and output_reviewed_at is null and output_review_feedback='')
    or
    (output_review_status in ('Aprobada','Cambios solicitados','Descartada')
      and output_reviewed_by is not null and output_reviewed_at is not null
      and (output_review_status='Aprobada' or length(btrim(output_review_feedback))>=5))
  );

create index if not exists creative_generation_jobs_review_idx
  on public.creative_generation_jobs(output_review_status,completed_at desc)
  where status='Completado';

create or replace function public.revision_creativa_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

-- El contrato compartido de los conectores debe abrir explícitamente la revisión.
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
    update public.creative_generation_jobs set status='Fallido',error_message=btrim(p_error),completed_at=now(),
      output_review_status='No aplica',output_review_feedback='',output_reviewed_by=null,output_reviewed_at=null,updated_at=now()
    where id=v_job.id;
  else
    select * into v_asset from public.brand_media_assets where id=p_output_asset_id;
    if v_asset.id is null or v_asset.status<>'Activo' then raise exception 'La salida no existe en la Biblioteca de Marca.'; end if;
    if coalesce(v_asset.generation_meta->>'job_id','')<>v_job.id::text then raise exception 'La salida no pertenece a este trabajo.'; end if;
    if p_cost_cop<0 or p_cost_cop>v_job.max_cost_cop then raise exception 'El costo real supera el tope autorizado.'; end if;
    update public.creative_generation_jobs set status='Completado',output_asset_id=v_asset.id,generation_cost=p_cost_cop,
      output_review_status='Pendiente',output_review_feedback='',output_reviewed_by=null,output_reviewed_at=null,
      error_message='',completed_at=now(),updated_at=now() where id=v_job.id;
  end if;
  return jsonb_build_object('ok',true,'job_id',v_job.id,'status',p_result,
    'review_status',case when p_result='Completado' then 'Pendiente' else 'No aplica' end);
end $$;

create or replace function public.revisar_salida_creativa(
  p_job_id bigint,p_decision text,p_feedback text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_job public.creative_generation_jobs%rowtype;
  v_asset public.brand_media_assets%rowtype; v_feedback text:=btrim(coalesce(p_feedback,''));
  v_tags jsonb; v_channels jsonb;
begin
  v_actor:=public._brand_actor();
  select * into v_job from public.creative_generation_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'El trabajo creativo no existe.'; end if;
  if v_job.status<>'Completado' or v_job.output_asset_id is null then
    raise exception 'Solo se puede revisar una salida completada y verificable.';
  end if;
  if v_job.output_review_status<>'Pendiente' then
    raise exception 'La salida ya tiene una decisión humana sellada: %.',v_job.output_review_status;
  end if;
  if p_decision not in ('Aprobada','Cambios solicitados','Descartada') then
    raise exception 'Decisión de revisión inválida.';
  end if;
  if p_decision in ('Cambios solicitados','Descartada') and length(v_feedback)<5 then
    raise exception 'Explicá el cambio o descarte para que el siguiente intento sea trazable.';
  end if;
  select * into v_asset from public.brand_media_assets where id=v_job.output_asset_id for update;
  if v_asset.id is null or v_asset.source<>'Generado' or v_asset.status<>'Activo'
     or coalesce(v_asset.generation_meta->>'job_id','')<>v_job.id::text then
    raise exception 'La salida generada no coincide con el trabajo revisado.';
  end if;

  update public.creative_generation_jobs set output_review_status=p_decision,
    output_review_feedback=v_feedback,output_reviewed_by=v_actor.id,output_reviewed_at=now(),updated_at=now()
  where id=v_job.id;

  if p_decision='Aprobada' then
    select coalesce(jsonb_agg(distinct value),'[]'::jsonb) into v_tags
    from jsonb_array_elements(coalesce(v_asset.tags,'[]'::jsonb)||jsonb_build_array('generado','aprobado-humano'));
    select coalesce(jsonb_agg(distinct value),'[]'::jsonb) into v_channels
    from jsonb_array_elements(coalesce(v_asset.allowed_channels,'[]'::jsonb)||jsonb_build_array(v_job.target_channel));
    update public.brand_media_assets set rights_status='Autorizado',ai_use_allowed=false,tags=v_tags,allowed_channels=v_channels,
      notes=concat_ws(E'\n',nullif(notes,''),'Aprobado por revisión humana para '||v_job.target_channel||'.'),
      generation_meta=generation_meta||jsonb_build_object('needs_human_review',false,'review_status','Aprobada',
        'reviewed_by',v_actor.id,'reviewed_at',now())
    where id=v_asset.id;
  elsif p_decision='Descartada' then
    update public.brand_media_assets set status='Archivado',archived_by=v_actor.id,archived_at=now(),
      notes=concat_ws(E'\n',nullif(notes,''),'Salida descartada: '||v_feedback),
      generation_meta=generation_meta||jsonb_build_object('review_status','Descartada','reviewed_by',v_actor.id,'reviewed_at',now())
    where id=v_asset.id;
  else
    update public.brand_media_assets set notes=concat_ws(E'\n',nullif(notes,''),'Cambios solicitados: '||v_feedback),
      generation_meta=generation_meta||jsonb_build_object('review_status','Cambios solicitados',
        'reviewed_by',v_actor.id,'reviewed_at',now())
    where id=v_asset.id;
  end if;

  perform public._add_audit('Revisión creativa',v_job.id::text,'Salida generada revisada','Pendiente',
    p_decision||case when v_feedback='' then '' else ' · '||v_feedback end);
  return jsonb_build_object('ok',true,'job_id',v_job.id,'asset_id',v_asset.id,
    'review_status',p_decision,'published',false,'ai_reuse_allowed',false);
end $$;

revoke all on function public.revision_creativa_disponible() from public,anon;
revoke all on function public.resolver_trabajo_creativo_conector(bigint,text,bigint,numeric,text) from public,anon,authenticated;
revoke all on function public.revisar_salida_creativa(bigint,text,text) from public,anon;
grant execute on function public.revision_creativa_disponible() to authenticated;
grant execute on function public.resolver_trabajo_creativo_conector(bigint,text,bigint,numeric,text) to service_role;
grant execute on function public.revisar_salida_creativa(bigint,text,text) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260715_26_revision_creativa','Revisión humana sellada de salidas IA, derechos de uso y descarte sin publicación automática')
on conflict(id) do update set detalle=excluded.detalle;

commit;
