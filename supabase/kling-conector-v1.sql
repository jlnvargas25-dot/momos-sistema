-- MOMOS OPS · Conector Kling v1.
-- Paso 25: Kling 3.0 con API Key server-side, idempotencia, costo protegido,
-- conciliación de despachos inciertos y salida privada con revisión humana.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260715'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations where id='20260715_24_higgsfield_conector') then
    raise exception 'Falta el paso 24_higgsfield_conector.';
  end if;
end $$;

-- Amplía los catálogos sin recrear ni perder filas existentes.
alter table public.agency_integrations drop constraint if exists agency_integrations_provider_check;
alter table public.agency_integrations add constraint agency_integrations_provider_check
  check(provider in ('Higgsfield','Kling','HeyGen','Meta','TikTok'));

alter table public.creative_connector_runs drop constraint if exists creative_connector_runs_provider_check;
alter table public.creative_connector_runs add constraint creative_connector_runs_provider_check
  check(provider in ('Higgsfield','Kling','HeyGen'));

insert into public.agency_integrations(provider,kind,capabilities)
values('Kling','Generación','["Video","Imagen a video","Audio nativo"]'::jsonb)
on conflict(provider) do nothing;

-- Un despacho incierto bloquea un segundo intento hasta que el worker lo concilie.
do $$ begin
  if exists(
    select 1 from public.creative_connector_runs
    where state in ('Arrendado','Despachando','En proveedor','Incierto')
    group by job_id having count(*)>1
  ) then
    raise exception 'Hay trabajos creativos con más de una ejecución activa o incierta. Revisalos antes de aplicar el paso 25.';
  end if;
end $$;
drop index if exists public.creative_connector_runs_one_active_job_uq;
create unique index creative_connector_runs_one_active_job_uq
  on public.creative_connector_runs(job_id)
  where state in ('Arrendado','Despachando','En proveedor','Incierto');

create or replace function public.kling_conector_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

-- Kling pasa a ser un motor autorizable, conservando todas las guardas del hito 22.
create or replace function public.autorizar_trabajo_creativo(p_job_id bigint,p_max_cost_cop numeric) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_job public.creative_generation_jobs%rowtype; v_paused boolean;
begin
  v_actor:=public._brand_actor();
  select * into v_job from public.creative_generation_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'El trabajo creativo no existe.'; end if;
  if v_job.status<>'Preparado' then raise exception 'Solo un trabajo Preparado puede autorizarse.'; end if;
  if v_job.provider not in ('Higgsfield','Kling','HeyGen','Manual') then raise exception 'Elegí un motor real antes de autorizar.'; end if;
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

create or replace function public.reclamar_trabajo_kling(
  p_worker_id text,p_lease_seconds integer default 600
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_worker text:=btrim(coalesce(p_worker_id,'')); v_job public.creative_generation_jobs%rowtype;
  v_run public.creative_connector_runs%rowtype; v_assets jsonb; v_integration public.agency_integrations%rowtype;
begin
  if length(v_worker)<3 or length(v_worker)>120 then raise exception 'Identidad de worker inválida.'; end if;
  if p_lease_seconds<30 or p_lease_seconds>1800 then raise exception 'Lease Kling fuera de rango.'; end if;
  select * into v_integration from public.agency_integrations where provider='Kling';
  if v_integration.provider is null or v_integration.status is distinct from 'Activa' or v_integration.secret_configured is not true
     or v_integration.last_heartbeat_at is null or v_integration.last_heartbeat_at<now()-interval '30 minutes' then
    raise exception 'Kling no está activo, autenticado o con heartbeat reciente.';
  end if;

  update public.creative_connector_runs set state='Expirado',finished_at=now(),
    error_message='Lease vencido antes de preparar el despacho'
  where provider='Kling' and state='Arrendado' and lease_expires_at<now();

  select j.* into v_job
  from public.creative_generation_jobs j
  where j.provider='Kling' and j.status='Autorizado'
    and not exists(select 1 from public.creative_connector_runs r where r.job_id=j.id
      and r.state in ('Arrendado','Despachando','En proveedor','Incierto'))
  order by j.authorized_at nulls last,j.id
  for update skip locked limit 1;
  if v_job.id is null then return jsonb_build_object('ok',true,'job',null); end if;
  perform public._validar_fuentes_trabajo_creativo(v_job.id);

  insert into public.creative_connector_runs(job_id,provider,worker_id,lease_expires_at)
  values(v_job.id,'Kling',v_worker,now()+make_interval(secs=>p_lease_seconds)) returning * into v_run;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'name',a.name,'media_type',a.media_type,'mime_type',a.mime_type,'storage_path',a.storage_path,
    'size_bytes',a.size_bytes,'content_hash',a.content_hash,'product_id',a.product_id,'figure',a.figure,'flavor',a.flavor
  ) order by src.ord),'[]'::jsonb) into v_assets
  from jsonb_array_elements_text(v_job.input_asset_ids) with ordinality src(id,ord)
  join public.brand_media_assets a on a.id=src.id::bigint;

  return jsonb_build_object('ok',true,'run_id',v_run.id,'lease_token',v_run.lease_token,
    'lease_expires_at',v_run.lease_expires_at,'job',jsonb_build_object(
      'id',v_job.id,'creative_id',v_job.creative_id,'brief_id',v_job.brief_id,'operation',v_job.operation,
      'target_channel',v_job.target_channel,'target_format',v_job.target_format,'prompt',v_job.prompt,
      'negative_prompt',v_job.negative_prompt,'brand_snapshot',v_job.brand_snapshot,'output_spec',v_job.output_spec,
      'max_cost_cop',v_job.max_cost_cop,'assets',v_assets
    ));
end $$;

-- Se guarda identidad idempotente, perfil y reserva ANTES de llamar a Kling.
create or replace function public.marcar_despacho_kling(
  p_run_id bigint,p_lease_token uuid,p_external_task_id text,p_estimated_cost_cop numeric,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.creative_connector_runs%rowtype; v_job public.creative_generation_jobs%rowtype;
  v_external text:=btrim(coalesce(p_external_task_id,'')); v_meta jsonb:=coalesce(p_metadata,'{}'::jsonb);
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Kling' or v_run.state<>'Arrendado' or v_run.lease_token<>p_lease_token then
    raise exception 'El lease Kling no admite iniciar el despacho.';
  end if;
  if v_run.lease_expires_at<now() then raise exception 'El lease Kling venció antes del despacho.'; end if;
  if v_external!~'^momos-job-[0-9]+-run-[0-9]+$' then raise exception 'Identidad idempotente Kling inválida.'; end if;
  if jsonb_typeof(v_meta)<>'object' or coalesce(v_meta->>'external_task_id','')<>v_external then
    raise exception 'Metadatos Kling inválidos o no coinciden con el despacho.';
  end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;
  if p_estimated_cost_cop is null or p_estimated_cost_cop<=0 or p_estimated_cost_cop>v_job.max_cost_cop then
    raise exception 'El costo protegido Kling supera el tope autorizado.';
  end if;
  update public.creative_connector_runs set state='Despachando',started_at=now(),estimated_cost_cop=p_estimated_cost_cop,
    metadata=v_meta||jsonb_build_object('external_task_id',v_external) where id=v_run.id;
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_run.job_id,'status','Despachando','external_task_id',v_external);
end $$;

create or replace function public.confirmar_despacho_kling(
  p_run_id bigint,p_lease_token uuid,p_provider_job_id text,p_estimated_cost_cop numeric,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.creative_connector_runs%rowtype; v_job public.creative_generation_jobs%rowtype;
  v_provider_job text:=btrim(coalesce(p_provider_job_id,'')); v_meta jsonb:=coalesce(p_metadata,'{}'::jsonb);
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Kling' or v_run.state<>'Despachando' or v_run.lease_token<>p_lease_token then
    raise exception 'El lease Kling no es válido.';
  end if;
  if v_run.lease_expires_at<now() then raise exception 'El lease Kling venció antes de confirmar.'; end if;
  if v_provider_job='' or length(v_provider_job)>240 then raise exception 'Kling no devolvió identidad de trabajo válida.'; end if;
  if jsonb_typeof(v_meta)<>'object' or coalesce(v_meta->>'external_task_id','')<>coalesce(v_run.metadata->>'external_task_id','') then
    raise exception 'La confirmación Kling no coincide con el despacho preparado.';
  end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;
  if p_estimated_cost_cop is distinct from v_run.estimated_cost_cop or p_estimated_cost_cop>v_job.max_cost_cop then
    raise exception 'La confirmación alteró el costo protegido.';
  end if;
  perform public.tomar_trabajo_creativo_conector(v_job.id,v_provider_job);
  update public.creative_generation_jobs set estimated_cost_cop=v_run.estimated_cost_cop,connector_meta=v_meta,updated_at=now() where id=v_job.id;
  update public.creative_connector_runs set state='En proveedor',provider_job_id=v_provider_job,metadata=v_meta where id=v_run.id;
  update public.agency_integrations set last_job_at=now(),updated_at=now() where provider='Kling';
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,'status','En generación');
end $$;

-- Recupera un POST cuya respuesta se perdió. Nunca crea un segundo trabajo.
create or replace function public.conciliar_despacho_kling(
  p_run_id bigint,p_lease_token uuid,p_provider_job_id text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.creative_connector_runs%rowtype; v_job public.creative_generation_jobs%rowtype;
  v_provider_job text:=btrim(coalesce(p_provider_job_id,''));
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Kling' or v_run.state<>'Incierto' or v_run.lease_token<>p_lease_token then
    raise exception 'La ejecución Kling no admite conciliación.';
  end if;
  if v_provider_job='' or length(v_provider_job)>240 then raise exception 'Falta la identidad conciliada en Kling.'; end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;
  if v_job.status<>'Autorizado' or v_run.estimated_cost_cop<=0 or v_run.estimated_cost_cop>v_job.max_cost_cop then
    raise exception 'El trabajo incierto ya no conserva una autorización válida.';
  end if;
  perform public.tomar_trabajo_creativo_conector(v_job.id,v_provider_job);
  update public.creative_generation_jobs set estimated_cost_cop=v_run.estimated_cost_cop,
    connector_meta=v_run.metadata,updated_at=now() where id=v_job.id;
  update public.creative_connector_runs set state='En proveedor',provider_job_id=v_provider_job,
    error_message='',finished_at=null where id=v_run.id;
  update public.agency_integrations set last_job_at=now(),updated_at=now() where provider='Kling';
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,'status','En generación','reconciled',true);
end $$;

create or replace function public.fallar_trabajo_kling(
  p_run_id bigint,p_lease_token uuid,p_error text,p_uncertain boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.creative_connector_runs%rowtype; v_job public.creative_generation_jobs%rowtype;
  v_error text:=left(btrim(coalesce(p_error,'')),500);
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Kling' or v_run.lease_token<>p_lease_token
     or v_run.state not in ('Arrendado','Despachando','En proveedor','Incierto') then
    raise exception 'La ejecución Kling no admite este fallo.';
  end if;
  if length(v_error)<3 then raise exception 'El worker debe explicar el fallo.'; end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;

  if p_uncertain then
    if v_run.state<>'Despachando' or coalesce(v_run.metadata->>'external_task_id','')='' then
      raise exception 'Solo un despacho identificable puede quedar Incierto.';
    end if;
    update public.creative_connector_runs set state='Incierto',error_message=v_error,finished_at=null where id=v_run.id;
    update public.creative_generation_jobs set error_message='Despacho incierto; MOMO OPS está conciliando sin reenviar: '||v_error,
      updated_at=now() where id=v_job.id and status='Autorizado';
    update public.agency_integrations set last_job_at=now(),last_error='Despacho incierto en conciliación',updated_at=now()
      where provider='Kling';
    return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,'status','Incierto','retry_blocked',true);
  end if;

  if v_job.status='En generación' then
    perform public.resolver_trabajo_creativo_conector(v_job.id,'Fallido',null,0,v_error);
  elsif v_job.status='Autorizado' then
    update public.creative_generation_jobs set status='Fallido',error_message=v_error,completed_at=now(),updated_at=now() where id=v_job.id;
  else raise exception 'El trabajo ya no está en una etapa fallable por el conector.';
  end if;
  update public.creative_connector_runs set state='Fallido',error_message=v_error,finished_at=now() where id=v_run.id;
  update public.agency_integrations set failed_jobs=failed_jobs+1,last_job_at=now(),last_error=v_error,updated_at=now()
    where provider='Kling';
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,'status','Fallido');
end $$;

create or replace function public.registrar_salida_kling(
  p_run_id bigint,p_lease_token uuid,p jsonb
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_run public.creative_connector_runs%rowtype; v_job public.creative_generation_jobs%rowtype;
  v_object storage.objects%rowtype; v_asset bigint; v_path text:=btrim(coalesce(p->>'storage_path',''));
  v_hash text:=lower(btrim(coalesce(p->>'content_hash',''))); v_mime text; v_size bigint; v_cost numeric;
  v_orientation text; v_source public.brand_media_assets%rowtype;
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Kling' or v_run.state<>'En proveedor' or v_run.lease_token<>p_lease_token then
    raise exception 'La ejecución Kling no está lista para registrar salida.';
  end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;
  if v_job.status<>'En generación' then raise exception 'El trabajo creativo no está En generación.'; end if;
  if v_path='' or v_path like '/%' or v_path~'(^|/)\.\.(/|$)' or v_path not like 'generated/kling/'||v_job.id::text||'/%' then
    raise exception 'Ruta de salida Kling inválida.';
  end if;
  if v_hash!~'^[0-9a-f]{64}$' then raise exception 'Huella de salida Kling inválida.'; end if;
  select * into v_object from storage.objects where bucket_id='brand-assets' and name=v_path;
  if v_object.id is null then raise exception 'La salida Kling no existe en Storage.'; end if;
  v_mime:=coalesce(nullif(v_object.metadata->>'mimetype',''),nullif(p->>'mime_type',''),'application/octet-stream');
  v_size:=coalesce(nullif(v_object.metadata->>'size','')::bigint,nullif(p->>'size_bytes','')::bigint,0);
  if v_size<=0 or v_size>104857600 then raise exception 'Tamaño de salida Kling inválido.'; end if;
  if v_mime not in ('video/mp4','video/webm','video/quicktime') then raise exception 'Formato de salida Kling no permitido.'; end if;
  v_cost:=coalesce(nullif(p->>'cost_cop','')::numeric,0);
  if v_cost<0 or v_cost>v_job.max_cost_cop then raise exception 'El costo real supera el tope autorizado.'; end if;
  select a.* into v_source from jsonb_array_elements_text(v_job.input_asset_ids) src(id)
    join public.brand_media_assets a on a.id=src.id::bigint order by a.id limit 1;
  v_orientation:=case when v_job.target_format like '%9:16%' then 'Vertical'
    when v_job.target_format like '%16:9%' then 'Horizontal'
    when v_job.target_format like '%1:1%' then 'Cuadrado' else coalesce(v_source.orientation,'Vertical') end;
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,contains_people,
    rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,tags,notes,
    original_asset_id,generation_meta,created_by)
  values(coalesce(nullif(btrim(p->>'name'),''),'Kling 3.0 · trabajo '||v_job.id),'Video','Generado',v_source.product_id,
    coalesce(v_source.figure,''),coalesce(v_source.flavor,''),'Generado por Kling',v_orientation,false,
    'Por verificar',false,jsonb_build_array(v_job.target_channel),'Activo',v_path,v_hash,v_mime,v_size,
    jsonb_build_array('kling','generado','revision-pendiente'),'Salida generada; requiere revisión humana antes de publicar.',
    v_source.id,jsonb_build_object('job_id',v_job.id,'provider','Kling','provider_job_id',v_run.provider_job_id,
      'connector_run_id',v_run.id,'model',coalesce(p->>'model',v_run.metadata->>'model'),
      'billing',coalesce(p->'billing','{}'::jsonb),'generated_at',now(),'needs_human_review',true),v_job.created_by)
  returning id into v_asset;
  insert into public.brand_media_usages(asset_id,job_id,role,created_by) values(v_asset,v_job.id,'Principal',v_job.created_by);
  perform public.resolver_trabajo_creativo_conector(v_job.id,'Completado',v_asset,v_cost,'');
  update public.creative_connector_runs set state='Completado',actual_cost_cop=v_cost,
    metadata=metadata||jsonb_build_object('output_asset_id',v_asset,'billing',coalesce(p->'billing','{}'::jsonb)),finished_at=now()
    where id=v_run.id;
  update public.agency_integrations set successful_jobs=successful_jobs+1,last_job_at=now(),last_sync_at=now(),last_error='',updated_at=now()
    where provider='Kling';
  perform public._add_audit('Conector Kling',v_job.id::text,'Salida generada protegida','En generación','Completado · activo '||v_asset::text);
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,'asset_id',v_asset,'status','Completado','needs_human_review',true);
end $$;

create or replace function public.reportar_worker_kling(
  p_worker_id text,p_version text,p_status text,p_error text default '',p_synced boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_version text:=left(btrim(coalesce(p_version,'')),80); v_current text;
begin
  if length(btrim(coalesce(p_worker_id,'')))<3 or v_version='' then raise exception 'Identidad o versión de worker inválida.'; end if;
  select status into v_current from public.agency_integrations where provider='Kling' for update;
  if v_current='Pausada' then
    update public.agency_integrations set worker_version=v_version,last_heartbeat_at=now(),updated_at=now() where provider='Kling';
    return jsonb_build_object('ok',true,'provider','Kling','status','Pausada','worker_version',v_version);
  end if;
  v_result:=public.reportar_integracion_agencia_conector('Kling',p_status,true,p_error,
    jsonb_build_array('Video','Imagen a video','Audio nativo'),null,null,p_synced);
  update public.agency_integrations set worker_version=v_version,updated_at=now() where provider='Kling';
  return v_result||jsonb_build_object('worker_version',v_version);
end $$;

revoke all on function public.kling_conector_disponible() from public,anon;
revoke all on function public.reclamar_trabajo_kling(text,integer) from public,anon,authenticated;
revoke all on function public.marcar_despacho_kling(bigint,uuid,text,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.confirmar_despacho_kling(bigint,uuid,text,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.conciliar_despacho_kling(bigint,uuid,text) from public,anon,authenticated;
revoke all on function public.fallar_trabajo_kling(bigint,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.registrar_salida_kling(bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.reportar_worker_kling(text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.kling_conector_disponible() to authenticated;
grant execute on function public.reclamar_trabajo_kling(text,integer) to service_role;
grant execute on function public.marcar_despacho_kling(bigint,uuid,text,numeric,jsonb) to service_role;
grant execute on function public.confirmar_despacho_kling(bigint,uuid,text,numeric,jsonb) to service_role;
grant execute on function public.conciliar_despacho_kling(bigint,uuid,text) to service_role;
grant execute on function public.fallar_trabajo_kling(bigint,uuid,text,boolean) to service_role;
grant execute on function public.registrar_salida_kling(bigint,uuid,jsonb) to service_role;
grant execute on function public.reportar_worker_kling(text,text,text,text,boolean) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260715_25_kling_conector','Kling 3.0 con API Key privada, idempotencia, costo protegido, conciliación y revisión humana')
on conflict(id) do update set detalle=excluded.detalle;

notify pgrst, 'reload schema';

commit;
