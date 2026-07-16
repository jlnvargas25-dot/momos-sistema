-- MOMOS OPS · Conector Higgsfield v1.
-- Paso 24: lease/idempotencia, costo protegido y registro de salidas generadas.
-- La credencial OAuth de Higgsfield vive únicamente en el worker/CLI oficial.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260715'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations where id='20260715_23_integraciones_agencia') then
    raise exception 'Falta el paso 23_integraciones_agencia.';
  end if;
end $$;

alter table public.creative_generation_jobs
  add column if not exists estimated_cost_cop numeric not null default 0 check(estimated_cost_cop>=0),
  add column if not exists connector_meta jsonb not null default '{}'::jsonb check(jsonb_typeof(connector_meta)='object');

alter table public.agency_integrations
  add column if not exists worker_version text not null default '',
  add column if not exists last_job_at timestamptz,
  add column if not exists successful_jobs integer not null default 0 check(successful_jobs>=0),
  add column if not exists failed_jobs integer not null default 0 check(failed_jobs>=0);

create table if not exists public.creative_connector_runs(
  id bigint generated always as identity primary key,
  job_id bigint not null references public.creative_generation_jobs(id) on delete cascade,
  provider text not null check(provider in ('Higgsfield','HeyGen')),
  lease_token uuid not null default gen_random_uuid() unique,
  worker_id text not null check(length(btrim(worker_id)) between 3 and 120),
  state text not null default 'Arrendado' check(state in ('Arrendado','Despachando','En proveedor','Completado','Fallido','Expirado','Incierto')),
  provider_job_id text,
  estimated_cost_cop numeric not null default 0 check(estimated_cost_cop>=0),
  actual_cost_cop numeric not null default 0 check(actual_cost_cop>=0),
  error_message text not null default '',
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  leased_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz
);
drop index if exists public.creative_connector_runs_one_active_job_uq;
create unique index creative_connector_runs_one_active_job_uq
  on public.creative_connector_runs(job_id) where state in ('Arrendado','Despachando','En proveedor');
create index if not exists creative_connector_runs_provider_state_idx
  on public.creative_connector_runs(provider,state,leased_at desc);

alter table public.creative_connector_runs enable row level security;
drop policy if exists staff_read on public.creative_connector_runs;
create policy staff_read on public.creative_connector_runs for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.creative_connector_runs from public,anon,authenticated;
grant select on public.creative_connector_runs to authenticated;

create or replace function public.higgsfield_conector_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

-- Reclama exactamente un trabajo. Sigue Autorizado hasta que Higgsfield entregue
-- un provider_job_id; así una caída previa al envío no simula gasto ni ejecución.
create or replace function public.reclamar_trabajo_higgsfield(
  p_worker_id text,p_lease_seconds integer default 300
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_worker text:=btrim(coalesce(p_worker_id,'')); v_job public.creative_generation_jobs%rowtype;
  v_run public.creative_connector_runs%rowtype; v_assets jsonb; v_integration public.agency_integrations%rowtype;
begin
  if length(v_worker)<3 or length(v_worker)>120 then raise exception 'Identidad de worker inválida.'; end if;
  if p_lease_seconds<30 or p_lease_seconds>1800 then raise exception 'Lease Higgsfield fuera de rango.'; end if;
  select * into v_integration from public.agency_integrations where provider='Higgsfield';
  if v_integration.provider is null or v_integration.status is distinct from 'Activa' or v_integration.secret_configured is not true
     or v_integration.last_heartbeat_at is null or v_integration.last_heartbeat_at<now()-interval '30 minutes' then
    raise exception 'Higgsfield no está activo, autenticado o con heartbeat reciente.';
  end if;

  update public.creative_connector_runs set state='Expirado',finished_at=now(),
    error_message='Lease vencido antes de confirmar despacho'
  where provider='Higgsfield' and state='Arrendado' and lease_expires_at<now();

  select j.* into v_job
  from public.creative_generation_jobs j
  where j.provider='Higgsfield' and j.status='Autorizado'
    and not exists(select 1 from public.creative_connector_runs r where r.job_id=j.id and r.state in ('Arrendado','Despachando','En proveedor'))
  order by j.authorized_at nulls last,j.id
  for update skip locked limit 1;
  if v_job.id is null then return jsonb_build_object('ok',true,'job',null); end if;
  perform public._validar_fuentes_trabajo_creativo(v_job.id);

  insert into public.creative_connector_runs(job_id,provider,worker_id,lease_expires_at)
  values(v_job.id,'Higgsfield',v_worker,now()+make_interval(secs=>p_lease_seconds)) returning * into v_run;
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

-- Se persiste ANTES de contactar al proveedor. Si el worker muere después de
-- este punto, el trabajo queda para conciliación manual y jamás se reenvía solo.
create or replace function public.marcar_despacho_higgsfield(
  p_run_id bigint,p_lease_token uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.creative_connector_runs%rowtype;
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Higgsfield' or v_run.state<>'Arrendado' or v_run.lease_token<>p_lease_token then
    raise exception 'El lease Higgsfield no admite iniciar el despacho.';
  end if;
  if v_run.lease_expires_at<now() then raise exception 'El lease Higgsfield venció antes del despacho.'; end if;
  update public.creative_connector_runs set state='Despachando',started_at=now() where id=v_run.id;
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_run.job_id,'status','Despachando');
end $$;

create or replace function public.confirmar_despacho_higgsfield(
  p_run_id bigint,p_lease_token uuid,p_provider_job_id text,p_estimated_cost_cop numeric,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.creative_connector_runs%rowtype; v_job public.creative_generation_jobs%rowtype;
  v_external text:=btrim(coalesce(p_provider_job_id,'')); v_meta jsonb:=coalesce(p_metadata,'{}'::jsonb);
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Higgsfield' or v_run.state<>'Despachando' or v_run.lease_token<>p_lease_token then
    raise exception 'El lease Higgsfield no es válido.';
  end if;
  if v_run.lease_expires_at<now() then raise exception 'El lease Higgsfield venció antes del despacho.'; end if;
  if v_external='' then raise exception 'Higgsfield no devolvió identidad de trabajo.'; end if;
  if jsonb_typeof(v_meta)<>'object' then raise exception 'Metadatos de conector inválidos.'; end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;
  if p_estimated_cost_cop is null or p_estimated_cost_cop<0 or p_estimated_cost_cop>v_job.max_cost_cop then
    raise exception 'El costo estimado supera el tope autorizado.';
  end if;
  perform public.tomar_trabajo_creativo_conector(v_job.id,v_external);
  update public.creative_generation_jobs set estimated_cost_cop=p_estimated_cost_cop,connector_meta=v_meta,updated_at=now() where id=v_job.id;
  update public.creative_connector_runs set state='En proveedor',provider_job_id=v_external,
    estimated_cost_cop=p_estimated_cost_cop,metadata=v_meta where id=v_run.id;
  update public.agency_integrations set last_job_at=now(),updated_at=now() where provider='Higgsfield';
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,'status','En generación');
end $$;

create or replace function public.fallar_trabajo_higgsfield(
  p_run_id bigint,p_lease_token uuid,p_error text,p_uncertain boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.creative_connector_runs%rowtype; v_job public.creative_generation_jobs%rowtype;
  v_error text:=left(btrim(coalesce(p_error,'')),500); v_state text;
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Higgsfield' or v_run.lease_token<>p_lease_token
     or v_run.state not in ('Arrendado','Despachando','En proveedor') then raise exception 'La ejecución Higgsfield no admite este fallo.'; end if;
  if length(v_error)<3 then raise exception 'El worker debe explicar el fallo.'; end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;
  v_state:=case when p_uncertain then 'Incierto' else 'Fallido' end;
  if v_job.status='En generación' then
    perform public.resolver_trabajo_creativo_conector(v_job.id,'Fallido',null,0,
      case when p_uncertain then 'Despacho incierto: ' else '' end||v_error);
  elsif v_job.status='Autorizado' then
    update public.creative_generation_jobs set status='Fallido',error_message=case when p_uncertain then 'Despacho incierto: ' else '' end||v_error,
      completed_at=now(),updated_at=now() where id=v_job.id;
  else raise exception 'El trabajo ya no está en una etapa fallable por el conector.';
  end if;
  update public.creative_connector_runs set state=v_state,error_message=v_error,finished_at=now() where id=v_run.id;
  update public.agency_integrations set failed_jobs=failed_jobs+1,last_job_at=now(),updated_at=now() where provider='Higgsfield';
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,'status',v_state);
end $$;

-- El worker sube primero el binario al bucket privado brand-assets. Esta RPC
-- verifica el objeto real, crea la ficha generada y recién entonces completa el job.
create or replace function public.registrar_salida_higgsfield(
  p_run_id bigint,p_lease_token uuid,p jsonb
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_run public.creative_connector_runs%rowtype; v_job public.creative_generation_jobs%rowtype;
  v_object storage.objects%rowtype; v_asset bigint; v_path text:=btrim(coalesce(p->>'storage_path',''));
  v_hash text:=lower(btrim(coalesce(p->>'content_hash',''))); v_mime text; v_size bigint; v_cost numeric;
  v_media text; v_orientation text; v_source public.brand_media_assets%rowtype;
begin
  select * into v_run from public.creative_connector_runs where id=p_run_id for update;
  if v_run.id is null or v_run.provider<>'Higgsfield' or v_run.state<>'En proveedor' or v_run.lease_token<>p_lease_token then
    raise exception 'La ejecución Higgsfield no está lista para registrar salida.';
  end if;
  select * into v_job from public.creative_generation_jobs where id=v_run.job_id for update;
  if v_job.status<>'En generación' then raise exception 'El trabajo creativo no está En generación.'; end if;
  if v_path='' or v_path like '/%' or v_path~'(^|/)\.\.(/|$)' or v_path not like 'generated/higgsfield/'||v_job.id::text||'/%' then
    raise exception 'Ruta de salida Higgsfield inválida.';
  end if;
  if v_hash!~'^[0-9a-f]{64}$' then raise exception 'Huella de salida Higgsfield inválida.'; end if;
  select * into v_object from storage.objects where bucket_id='brand-assets' and name=v_path;
  if v_object.id is null then raise exception 'La salida Higgsfield no existe en Storage.'; end if;
  v_mime:=coalesce(nullif(v_object.metadata->>'mimetype',''),nullif(p->>'mime_type',''),'application/octet-stream');
  v_size:=coalesce(nullif(v_object.metadata->>'size','')::bigint,nullif(p->>'size_bytes','')::bigint,0);
  if v_size<=0 or v_size>104857600 then raise exception 'Tamaño de salida Higgsfield inválido.'; end if;
  if v_mime like 'image/%' then v_media:='Foto'; elsif v_mime like 'video/%' then v_media:='Video'; else raise exception 'Formato de salida Higgsfield no permitido.'; end if;
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
  values(coalesce(nullif(btrim(p->>'name'),''),'Higgsfield · trabajo '||v_job.id),v_media,'Generado',v_source.product_id,
    coalesce(v_source.figure,''),coalesce(v_source.flavor,''),'Generado por Higgsfield',v_orientation,false,
    'Por verificar',false,jsonb_build_array(v_job.target_channel),'Activo',v_path,v_hash,v_mime,v_size,
    jsonb_build_array('higgsfield','generado','revision-pendiente'),'Salida generada; requiere revisión humana antes de publicar.',
    v_source.id,jsonb_build_object('job_id',v_job.id,'provider','Higgsfield','provider_job_id',v_run.provider_job_id,
      'connector_run_id',v_run.id,'model',coalesce(p->>'model',v_run.metadata->>'model'),'generated_at',now(),'needs_human_review',true),
    v_job.created_by) returning id into v_asset;
  insert into public.brand_media_usages(asset_id,job_id,role,created_by) values(v_asset,v_job.id,'Principal',v_job.created_by);
  perform public.resolver_trabajo_creativo_conector(v_job.id,'Completado',v_asset,v_cost,'');
  update public.creative_connector_runs set state='Completado',actual_cost_cop=v_cost,
    metadata=metadata||jsonb_build_object('output_asset_id',v_asset),finished_at=now() where id=v_run.id;
  update public.agency_integrations set successful_jobs=successful_jobs+1,last_job_at=now(),last_sync_at=now(),updated_at=now()
    where provider='Higgsfield';
  perform public._add_audit('Conector Higgsfield',v_job.id::text,'Salida generada protegida','En generación','Completado · activo '||v_asset::text);
  return jsonb_build_object('ok',true,'run_id',v_run.id,'job_id',v_job.id,'asset_id',v_asset,'status','Completado','needs_human_review',true);
end $$;

create or replace function public.reportar_worker_higgsfield(
  p_worker_id text,p_version text,p_status text,p_error text default '',p_synced boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_version text:=left(btrim(coalesce(p_version,'')),80); v_current text;
begin
  if length(btrim(coalesce(p_worker_id,'')))<3 or v_version='' then raise exception 'Identidad o versión de worker inválida.'; end if;
  select status into v_current from public.agency_integrations where provider='Higgsfield' for update;
  if v_current='Pausada' then
    update public.agency_integrations set worker_version=v_version,last_heartbeat_at=now(),updated_at=now() where provider='Higgsfield';
    return jsonb_build_object('ok',true,'provider','Higgsfield','status','Pausada','worker_version',v_version);
  end if;
  v_result:=public.reportar_integracion_agencia_conector('Higgsfield',p_status,true,p_error,
    jsonb_build_array('Imagen','Video','Edición'),null,null,p_synced);
  update public.agency_integrations set worker_version=v_version,updated_at=now() where provider='Higgsfield';
  return v_result||jsonb_build_object('worker_version',v_version);
end $$;

revoke all on function public.higgsfield_conector_disponible() from public,anon;
revoke all on function public.reclamar_trabajo_higgsfield(text,integer) from public,anon,authenticated;
revoke all on function public.marcar_despacho_higgsfield(bigint,uuid) from public,anon,authenticated;
revoke all on function public.confirmar_despacho_higgsfield(bigint,uuid,text,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.fallar_trabajo_higgsfield(bigint,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.registrar_salida_higgsfield(bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.reportar_worker_higgsfield(text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.higgsfield_conector_disponible() to authenticated;
grant execute on function public.reclamar_trabajo_higgsfield(text,integer) to service_role;
grant execute on function public.marcar_despacho_higgsfield(bigint,uuid) to service_role;
grant execute on function public.confirmar_despacho_higgsfield(bigint,uuid,text,numeric,jsonb) to service_role;
grant execute on function public.fallar_trabajo_higgsfield(bigint,uuid,text,boolean) to service_role;
grant execute on function public.registrar_salida_higgsfield(bigint,uuid,jsonb) to service_role;
grant execute on function public.reportar_worker_higgsfield(text,text,text,text,boolean) to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='creative_connector_runs') then
    alter publication supabase_realtime add table public.creative_connector_runs;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260715_24_higgsfield_conector','Worker Higgsfield con lease único, costo protegido, salida privada y revisión humana')
on conflict(id) do update set detalle=excluded.detalle;

commit;
