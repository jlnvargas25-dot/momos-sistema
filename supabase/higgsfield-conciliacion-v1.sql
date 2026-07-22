-- MOMOS OPS · H111 · Conciliación segura de despachos Higgsfield inciertos.
-- Persiste costo y huellas antes del POST externo, bloquea reenvíos y solo
-- enlaza una respuesta perdida cuando el historial del proveedor coincide
-- de forma única con el contrato preparado. No genera ni publica contenido.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260722'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations
      where id='20260722_110_formato_video_cuatro_tres') then
    raise exception 'Falta el paso 110_formato_video_cuatro_tres.';
  end if;
  if not exists(select 1 from public.momos_ops_migrations
      where id='20260722_109_preparacion_piloto_conectores')
     or to_regprocedure('public.reportar_worker_higgsfield_v2(text,text,text,text,boolean,text,text)') is null
     or to_regprocedure('public.reportar_worker_kling_v2(text,text,text,text,boolean,text,text)') is null then
    raise exception 'Falta el runtime sellado H109-S para los conectores.';
  end if;
  if exists(
    select 1 from public.creative_connector_runs
    where provider_job_id is not null
    group by provider,provider_job_id having count(*)>1
  ) then
    raise exception 'Hay identidades de proveedor repetidas; conciliarlas antes de H111.';
  end if;
end $$;

create unique index if not exists creative_connector_runs_provider_job_uq
  on public.creative_connector_runs(provider,provider_job_id)
  where provider_job_id is not null;

create or replace function public.preparar_despacho_higgsfield(
  p_run_id bigint,p_lease_token uuid,p_estimated_cost_cop numeric,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_run public.creative_connector_runs%rowtype;
  v_job public.creative_generation_jobs%rowtype;
  v_meta jsonb:=coalesce(p_metadata,'{}'::jsonb);
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Higgsfield' or v_run.state<>'Arrendado'
     or v_run.lease_token<>p_lease_token then
    raise exception 'El lease Higgsfield no admite preparar el despacho.';
  end if;
  if v_run.lease_expires_at<clock_timestamp() then
    raise exception 'El lease Higgsfield venció antes del despacho.';
  end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;
  if v_job.id is null or v_job.status<>'Autorizado' then
    raise exception 'El trabajo Higgsfield ya no conserva autorización.';
  end if;
  if p_estimated_cost_cop is null or p_estimated_cost_cop<=0
     or p_estimated_cost_cop>v_job.max_cost_cop then
    raise exception 'El costo protegido Higgsfield supera el tope autorizado.';
  end if;
  if jsonb_typeof(v_meta)<>'object' or exists(
    select 1 from jsonb_object_keys(v_meta) as x(key)
    where x.key not in ('model','kind','aspect_ratio','duration_seconds','resolution',
      'estimated_credits','prompt_sha256','source_sha256',
      'provider_match_fingerprint','request_fingerprint')
  ) then
    raise exception 'Los metadatos Higgsfield no cumplen el contrato cerrado.';
  end if;
  if coalesce(v_meta->>'model','')!~'^[a-z0-9_]{2,80}$'
     or coalesce(v_meta->>'kind','') not in ('image','video')
     or coalesce(v_meta->>'request_fingerprint','')!~'^[0-9a-f]{64}$'
     or coalesce(v_meta->>'provider_match_fingerprint','')!~'^[0-9a-f]{64}$'
     or coalesce(v_meta->>'prompt_sha256','')!~'^[0-9a-f]{64}$'
     or coalesce(v_meta->>'source_sha256','')!~'^[0-9a-f]{64}$'
     or coalesce((v_meta->>'estimated_credits')::numeric,-1)<0
     or coalesce((v_meta->>'duration_seconds')::integer,0)<0 then
    raise exception 'Las huellas o parámetros Higgsfield son inválidos.';
  end if;
  update public.creative_connector_runs
  set state='Despachando',started_at=clock_timestamp(),
    estimated_cost_cop=p_estimated_cost_cop,metadata=v_meta,
    error_message='',finished_at=null
  where id=v_run.id;
  update public.creative_generation_jobs
  set estimated_cost_cop=p_estimated_cost_cop,connector_meta=v_meta,
    error_message='',updated_at=clock_timestamp()
  where id=v_job.id;
  perform public._add_audit('Conector Higgsfield',v_job.id::text,
    'Despacho preparado con huella','Autorizado','Despachando · sin reenvío automático');
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,
    'status','Despachando','request_fingerprint',v_meta->>'request_fingerprint');
end $$;

create or replace function public.confirmar_despacho_higgsfield(
  p_run_id bigint,p_lease_token uuid,p_provider_job_id text,
  p_estimated_cost_cop numeric,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_run public.creative_connector_runs%rowtype;
  v_job public.creative_generation_jobs%rowtype;
  v_external text:=btrim(coalesce(p_provider_job_id,''));
  v_meta jsonb:=coalesce(p_metadata,'{}'::jsonb);
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Higgsfield' or v_run.lease_token<>p_lease_token then
    raise exception 'El lease Higgsfield no es válido.';
  end if;
  if v_run.state='En proveedor' and v_run.provider_job_id=v_external then
    return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_run.job_id,
      'status','En generación','duplicate',true);
  end if;
  if v_run.state<>'Despachando' then
    raise exception 'El despacho Higgsfield no está preparado para confirmar.';
  end if;
  if v_run.lease_expires_at<clock_timestamp() then
    raise exception 'El lease Higgsfield venció antes de confirmar.';
  end if;
  if v_external='' or length(v_external)>240 then
    raise exception 'Higgsfield no devolvió una identidad de trabajo válida.';
  end if;
  if exists(select 1 from public.creative_connector_runs
      where provider='Higgsfield' and provider_job_id=v_external and id<>v_run.id) then
    raise exception 'La identidad Higgsfield ya está ligada a otra ejecución.';
  end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;
  if p_estimated_cost_cop is distinct from v_run.estimated_cost_cop
     or p_estimated_cost_cop>v_job.max_cost_cop then
    raise exception 'La confirmación alteró el costo protegido.';
  end if;
  if coalesce(v_run.metadata->>'request_fingerprint','')<>coalesce(v_meta->>'request_fingerprint','')
     or v_meta is distinct from v_run.metadata then
    raise exception 'La confirmación no coincide con el despacho preparado.';
  end if;
  perform public.tomar_trabajo_creativo_conector(v_job.id,v_external);
  update public.creative_connector_runs
  set state='En proveedor',provider_job_id=v_external,error_message='',finished_at=null
  where id=v_run.id;
  update public.agency_integrations
  set last_job_at=clock_timestamp(),last_error='',updated_at=clock_timestamp()
  where provider='Higgsfield';
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,
    'status','En generación','duplicate',false);
end $$;

create or replace function public.fallar_trabajo_higgsfield(
  p_run_id bigint,p_lease_token uuid,p_error text,p_uncertain boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_run public.creative_connector_runs%rowtype;
  v_job public.creative_generation_jobs%rowtype;
  v_error text:=left(btrim(coalesce(p_error,'')),500);
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Higgsfield' or v_run.lease_token<>p_lease_token
     or v_run.state not in ('Arrendado','Despachando','En proveedor','Incierto') then
    raise exception 'La ejecución Higgsfield no admite este fallo.';
  end if;
  if length(v_error)<3 then raise exception 'El worker debe explicar el fallo.'; end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;

  if p_uncertain then
    if v_run.state<>'Despachando'
       or coalesce(v_run.metadata->>'request_fingerprint','')!~'^[0-9a-f]{64}$'
       or coalesce(v_run.metadata->>'provider_match_fingerprint','')!~'^[0-9a-f]{64}$'
       or v_job.status<>'Autorizado' then
      raise exception 'Solo un despacho autorizado y con huellas puede quedar Incierto.';
    end if;
    update public.creative_connector_runs
    set state='Incierto',error_message=v_error,finished_at=null where id=v_run.id;
    update public.creative_generation_jobs
    set error_message='Despacho incierto; MOMO OPS concilia sin reenviar: '||v_error,
      updated_at=clock_timestamp() where id=v_job.id;
    update public.agency_integrations
    set last_job_at=clock_timestamp(),last_error='Despacho incierto en conciliación',
      updated_at=clock_timestamp() where provider='Higgsfield';
    return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,
      'status','Incierto','retry_blocked',true);
  end if;

  if v_job.status='En generación' then
    perform public.resolver_trabajo_creativo_conector(v_job.id,'Fallido',null,0,v_error);
  elsif v_job.status='Autorizado' then
    update public.creative_generation_jobs
    set status='Fallido',error_message=v_error,completed_at=clock_timestamp(),
      updated_at=clock_timestamp() where id=v_job.id;
  else
    raise exception 'El trabajo ya no está en una etapa fallable por el conector.';
  end if;
  update public.creative_connector_runs
  set state='Fallido',error_message=v_error,finished_at=clock_timestamp() where id=v_run.id;
  update public.agency_integrations
  set failed_jobs=failed_jobs+1,last_job_at=clock_timestamp(),last_error=v_error,
    updated_at=clock_timestamp() where provider='Higgsfield';
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,
    'status','Fallido','retry_blocked',false);
end $$;

create or replace function public.conciliar_despacho_higgsfield(
  p_run_id bigint,p_lease_token uuid,p_provider_job_id text,p_evidence jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_run public.creative_connector_runs%rowtype;
  v_job public.creative_generation_jobs%rowtype;
  v_external text:=btrim(coalesce(p_provider_job_id,''));
  v_evidence jsonb:=coalesce(p_evidence,'{}'::jsonb);
  v_created timestamptz;
  v_status text:=lower(btrim(coalesce(p_evidence->>'provider_status','')));
  v_failed boolean;
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Higgsfield' or v_run.lease_token<>p_lease_token then
    raise exception 'La ejecución Higgsfield no admite conciliación.';
  end if;
  if v_run.state in ('En proveedor','Fallido','Completado')
     and v_run.provider_job_id=v_external then
    return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_run.job_id,
      'status',v_run.state,'reconciled',true,'duplicate',true);
  end if;
  if v_run.state<>'Incierto' or v_external='' or length(v_external)>240 then
    raise exception 'Falta un despacho incierto y una identidad Higgsfield válida.';
  end if;
  if jsonb_typeof(v_evidence)<>'object' or exists(
    select 1 from jsonb_object_keys(v_evidence) as x(key)
    where x.key not in ('request_fingerprint','provider_match_fingerprint',
      'provider_created_at','provider_status')
  ) then
    raise exception 'La evidencia de conciliación no cumple el contrato cerrado.';
  end if;
  if coalesce(v_evidence->>'request_fingerprint','')<>coalesce(v_run.metadata->>'request_fingerprint','')
     or coalesce(v_evidence->>'provider_match_fingerprint','')<>
        coalesce(v_run.metadata->>'provider_match_fingerprint','') then
    raise exception 'La evidencia no coincide con las huellas del despacho.';
  end if;
  v_created:=(v_evidence->>'provider_created_at')::timestamptz;
  if v_created<v_run.started_at-interval '30 seconds'
     or v_created>v_run.started_at+interval '15 minutes' then
    raise exception 'La hora del proveedor no corresponde al despacho preparado.';
  end if;
  if v_status not in ('queued','pending','created','processing','running','in_progress',
      'completed','complete','succeeded','success','done','finished',
      'failed','error','cancelled','canceled') then
    raise exception 'El estado Higgsfield no es conciliable.';
  end if;
  if exists(select 1 from public.creative_connector_runs
      where provider='Higgsfield' and provider_job_id=v_external and id<>v_run.id) then
    raise exception 'La identidad Higgsfield ya está ligada a otra ejecución.';
  end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;
  if v_job.status<>'Autorizado' or v_run.estimated_cost_cop<=0
     or v_run.estimated_cost_cop>v_job.max_cost_cop then
    raise exception 'El trabajo incierto ya no conserva autorización o costo válido.';
  end if;
  perform public.tomar_trabajo_creativo_conector(v_job.id,v_external);
  v_failed:=v_status in ('failed','error','cancelled','canceled');
  if v_failed then
    perform public.resolver_trabajo_creativo_conector(v_job.id,'Fallido',null,0,
      'Higgsfield confirmó fallo al conciliar el despacho exacto.');
    update public.creative_connector_runs
    set state='Fallido',provider_job_id=v_external,error_message='Fallo conciliado sin reenvío',
      finished_at=clock_timestamp() where id=v_run.id;
    update public.agency_integrations
    set failed_jobs=failed_jobs+1,last_job_at=clock_timestamp(),
      last_error='Fallo Higgsfield conciliado',updated_at=clock_timestamp()
    where provider='Higgsfield';
  else
    update public.creative_connector_runs
    set state='En proveedor',provider_job_id=v_external,error_message='',finished_at=null
    where id=v_run.id;
    update public.agency_integrations
    set last_job_at=clock_timestamp(),last_error='',updated_at=clock_timestamp()
    where provider='Higgsfield';
  end if;
  perform public._add_audit('Conector Higgsfield',v_job.id::text,
    'Despacho incierto conciliado','Incierto',
    case when v_failed then 'Fallido' else 'En proveedor' end||' · sin reenvío');
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,
    'status',case when v_failed then 'Fallido' else 'En generación' end,
    'reconciled',true,'duplicate',false,'retry_blocked',false);
end $$;

revoke all on function public.preparar_despacho_higgsfield(bigint,uuid,numeric,jsonb)
  from public,anon,authenticated;
revoke all on function public.confirmar_despacho_higgsfield(bigint,uuid,text,numeric,jsonb)
  from public,anon,authenticated;
revoke all on function public.fallar_trabajo_higgsfield(bigint,uuid,text,boolean)
  from public,anon,authenticated;
revoke all on function public.conciliar_despacho_higgsfield(bigint,uuid,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.reportar_worker_higgsfield(text,text,text,text,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.reportar_worker_kling(text,text,text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.preparar_despacho_higgsfield(bigint,uuid,numeric,jsonb)
  to service_role;
grant execute on function public.confirmar_despacho_higgsfield(bigint,uuid,text,numeric,jsonb)
  to service_role;
grant execute on function public.fallar_trabajo_higgsfield(bigint,uuid,text,boolean)
  to service_role;
grant execute on function public.conciliar_despacho_higgsfield(bigint,uuid,text,jsonb)
  to service_role;
grant execute on function public.reportar_worker_higgsfield_v2(text,text,text,text,boolean,text,text)
  to service_role;
grant execute on function public.reportar_worker_kling_v2(text,text,text,text,boolean,text,text)
  to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260722_111_conciliacion_higgsfield',
  'Costo y huellas antes del POST, reintento bloqueado y conciliación exacta de Higgsfield sin reenvío')
on conflict(id) do update set detalle=excluded.detalle;

commit;
