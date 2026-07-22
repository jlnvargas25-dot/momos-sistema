-- MOMOS OPS · H111 · prueba adversarial de conciliación Higgsfield.
-- Siempre ROLLBACK. Nunca llama al proveedor ni consume créditos.
begin;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
      where id='20260722_111_conciliacion_higgsfield'), 'Falta H111.';
  assert to_regprocedure('public.preparar_despacho_higgsfield(bigint,uuid,numeric,jsonb)') is not null,
    'Falta preparación sellada del despacho.';
  assert to_regprocedure('public.conciliar_despacho_higgsfield(bigint,uuid,text,jsonb)') is not null,
    'Falta conciliación Higgsfield.';
  assert not has_function_privilege('authenticated',
      'public.preparar_despacho_higgsfield(bigint,uuid,numeric,jsonb)','EXECUTE'),
    'Authenticated puede preparar despachos externos.';
  assert not has_function_privilege('authenticated',
      'public.conciliar_despacho_higgsfield(bigint,uuid,text,jsonb)','EXECUTE'),
    'Authenticated puede fabricar conciliaciones.';
  assert has_function_privilege('service_role',
      'public.conciliar_despacho_higgsfield(bigint,uuid,text,jsonb)','EXECUTE'),
    'El worker privado no puede conciliar.';
  assert has_function_privilege('service_role',
      'public.reportar_worker_higgsfield_v2(text,text,text,text,boolean,text,text)','EXECUTE')
    and has_function_privilege('service_role',
      'public.reportar_worker_kling_v2(text,text,text,text,boolean,text,text)','EXECUTE')
    and not has_function_privilege('service_role',
      'public.reportar_worker_higgsfield(text,text,text,text,boolean)','EXECUTE')
    and not has_function_privilege('service_role',
      'public.reportar_worker_kling(text,text,text,text,boolean)','EXECUTE'),
    'Los workers perdieron el heartbeat v2 o recuperaron el RPC legado.';
end $$;

do $$
declare
  v_actor text; v_auth uuid; v_product text;
  v_creative text:='CRE-H111-'||pg_backend_pid();
  v_asset bigint; v_logo bigint; v_job bigint; v_path text;
begin
  select id,auth_id into v_actor,v_auth from public.users
  where auth_id is not null and activo
    and 'Administrador'=any(coalesce(roles,array[rol]))
  order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor is not null and v_auth is not null and v_product is not null,
    'Falta actor o producto para H111.';
  insert into public.creatives(id,titulo,canal,formato,producto_foco_id,estado,notas)
  values(v_creative,'H111 conciliación','Instagram','Reel',v_product,'Idea','Sintético; rollback total');
  v_path:='test/h111-product-'||pg_backend_pid()||'.png';
  insert into storage.objects(bucket_id,name,metadata)
  values('brand-assets',v_path,'{"mimetype":"image/png","size":2048}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,product_id,orientation,
    rights_status,ai_use_allowed,status,storage_path,content_hash,mime_type,size_bytes,created_by)
  values('Fuente H111','Foto','MOMOS',v_product,'Vertical','Propio',true,'Activo',
    v_path,md5(random()::text)||md5(random()::text),
    'image/png',2048,v_actor) returning id into v_asset;
  insert into public.brand_asset_production_profiles(asset_id,component_type,view_angle,
    physical_state,interaction_type,hand_assignment,source_quality,qa_status,
    consent_status,canonical,created_by,updated_by)
  values(v_asset,'Producto','Frontal','Intacto','Ninguna','Ninguna','Original limpio',
    'Aprobado','No aplica',true,v_actor,v_actor);
  v_path:='test/h111-logo-'||pg_backend_pid()||'.png';
  insert into storage.objects(bucket_id,name,metadata)
  values('brand-assets',v_path,'{"mimetype":"image/png","size":2048}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,
    content_hash,mime_type,size_bytes,tags,notes,created_by)
  values('Logo H111','Logo','MOMOS','Marca','Cuadrado',false,'Propio',true,'[]','Activo',
    v_path,md5(random()::text)||md5(random()::text),'image/png',2048,'[]',
    'Rollback H111',v_actor) returning id into v_logo;
  insert into public.creative_generation_jobs(creative_id,provider,operation,status,
    input_asset_ids,target_channel,target_format,prompt,created_by)
  values(v_creative,'Higgsfield','Generar video','Preparado',jsonb_build_array(v_asset),
    'Instagram','Reel 9:16','Producto MOMOS cinematográfico para prueba H111',v_actor)
  returning id into v_job;
  perform set_config('momos.h111_actor_auth',v_auth::text,true);
  perform set_config('momos.h111_job',v_job::text,true);
  perform set_config('momos.h111_logo',v_logo::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h111_actor_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_kit bigint; v_item record;
begin
  v_kit:=(public.preparar_kit_identidad_marca(
    'Kit íntegro temporal para certificar H111 con rollback total.') ->> 'kit_id')::bigint;
  for v_item in select role from public.agency_brand_kit_assets where kit_id=v_kit loop
    perform public.desvincular_logo_kit_identidad(v_kit,v_item.role);
  end loop;
  perform public.vincular_logo_kit_identidad(v_kit,current_setting('momos.h111_logo')::bigint,
    'principal','Cualquiera','{}'::text[],48,0.25);
  perform public.activar_kit_identidad_marca(v_kit,
    'Logo, colores, derechos y perfil revisados para la prueba H111.');
  perform public.autorizar_trabajo_creativo(current_setting('momos.h111_job')::bigint,30000);
end $$;

reset role;
update public.creative_generation_jobs
set authorized_at='2000-01-01 00:00:00+00'
where id=current_setting('momos.h111_job')::bigint;
update public.agency_integrations
set status='Activa',secret_configured=true,last_heartbeat_at=clock_timestamp(),last_error=''
where provider='Higgsfield';

set local role service_role;
do $$
declare
  v_claim jsonb; v_meta jsonb; v_failed boolean:=false; v_failed_before integer;
begin
  v_claim:=public.reclamar_trabajo_creativo_general_v1('Higgsfield','worker-h111',300);
  assert v_claim->'job'->>'id'=current_setting('momos.h111_job'),
    'H111 no reclamó el trabajo sintético exacto.';
  perform set_config('momos.h111_run',v_claim->>'run_id',true);
  perform set_config('momos.h111_lease',v_claim->>'lease_token',true);
  select failed_jobs into v_failed_before from public.agency_integrations where provider='Higgsfield';
  perform set_config('momos.h111_failed_before',v_failed_before::text,true);
  v_meta:=jsonb_build_object(
    'model','seedance_2_0_fast','kind','video','aspect_ratio','9:16',
    'duration_seconds',5,'resolution','720p','estimated_credits',17.5,
    'prompt_sha256',repeat('a',64),'source_sha256',repeat('b',64),
    'provider_match_fingerprint',repeat('c',64),'request_fingerprint',repeat('d',64));
  begin
    perform public.preparar_despacho_higgsfield((v_claim->>'run_id')::bigint,
      (v_claim->>'lease_token')::uuid,2800,v_meta||jsonb_build_object('customer_phone','3001234567'));
  exception when others then v_failed:=true; end;
  assert v_failed, 'H111 aceptó PII o una clave fuera del contrato compacto.';
  perform public.preparar_despacho_higgsfield((v_claim->>'run_id')::bigint,
    (v_claim->>'lease_token')::uuid,2800,v_meta);
  assert exists(select 1 from public.creative_connector_runs
    where id=(v_claim->>'run_id')::bigint and state='Despachando'
      and estimated_cost_cop=2800
      and metadata->>'request_fingerprint'=repeat('d',64)),
    'H111 no persistió costo y huellas antes del POST.';
  perform public.fallar_trabajo_higgsfield((v_claim->>'run_id')::bigint,
    (v_claim->>'lease_token')::uuid,'Respuesta perdida después del POST',true);
end $$;

do $$
begin
  assert exists(select 1 from public.creative_generation_jobs
    where id=current_setting('momos.h111_job')::bigint and status='Autorizado'
      and attempt_count=0 and error_message like 'Despacho incierto;%'),
    'La incertidumbre consumió la autorización o fingió un intento confirmado.';
  assert exists(select 1 from public.creative_connector_runs
    where id=current_setting('momos.h111_run')::bigint and state='Incierto'
      and provider_job_id is null and finished_at is null),
    'El despacho incierto no bloqueó el reenvío.';
  assert (select failed_jobs from public.agency_integrations where provider='Higgsfield')=
    current_setting('momos.h111_failed_before')::integer,
    'H111 contó un resultado incierto como fallo definitivo.';
end $$;

reset role;
do $$
declare v_failed boolean:=false;
begin
  begin
    insert into public.creative_connector_runs(job_id,provider,worker_id,lease_expires_at)
    values(current_setting('momos.h111_job')::bigint,'Higgsfield','worker-h111-duplicado',
      clock_timestamp()+interval '5 minutes');
  exception when unique_violation then v_failed:=true; end;
  assert v_failed, 'Un incierto permitió abrir una segunda ejecución.';
end $$;

set local role service_role;
do $$
declare v_failed boolean:=false; v_result jsonb; v_external text:='hf-h111-'||pg_backend_pid();
begin
  begin
    perform public.conciliar_despacho_higgsfield(current_setting('momos.h111_run')::bigint,
      current_setting('momos.h111_lease')::uuid,v_external,
      jsonb_build_object('request_fingerprint',repeat('e',64),
        'provider_match_fingerprint',repeat('c',64),
        'provider_created_at',clock_timestamp(),'provider_status','pending'));
  exception when others then v_failed:=true; end;
  assert v_failed, 'H111 concilió una respuesta con huella ajena.';
  v_result:=public.conciliar_despacho_higgsfield(current_setting('momos.h111_run')::bigint,
    current_setting('momos.h111_lease')::uuid,v_external,
    jsonb_build_object('request_fingerprint',repeat('d',64),
      'provider_match_fingerprint',repeat('c',64),
      'provider_created_at',clock_timestamp(),'provider_status','pending'));
  assert (v_result->>'reconciled')::boolean and not (v_result->>'duplicate')::boolean,
    'La primera conciliación exacta no quedó aplicada.';
  v_result:=public.conciliar_despacho_higgsfield(current_setting('momos.h111_run')::bigint,
    current_setting('momos.h111_lease')::uuid,v_external,
    jsonb_build_object('request_fingerprint',repeat('d',64),
      'provider_match_fingerprint',repeat('c',64),
      'provider_created_at',clock_timestamp(),'provider_status','pending'));
  assert (v_result->>'reconciled')::boolean and (v_result->>'duplicate')::boolean,
    'La repetición de la conciliación no fue idempotente.';
end $$;

do $$
begin
  assert exists(select 1 from public.creative_generation_jobs
    where id=current_setting('momos.h111_job')::bigint and status='En generación'
      and attempt_count=1 and provider_job_id='hf-h111-'||pg_backend_pid()),
    'La conciliación no vinculó exactamente el trabajo externo.';
  assert exists(select 1 from public.creative_connector_runs
    where id=current_setting('momos.h111_run')::bigint and state='En proveedor'
      and provider_job_id='hf-h111-'||pg_backend_pid()),
    'La ejecución no salió de Incierto con el ID conciliado.';
  assert (select count(*) from public.creative_connector_runs
    where job_id=current_setting('momos.h111_job')::bigint)=1,
    'H111 creó una ejecución adicional durante la conciliación.';
  assert exists(select 1 from public.audit_logs
    where entidad='Conector Higgsfield'
      and entidad_id=current_setting('momos.h111_job')
      and accion='Despacho incierto conciliado'),
    'Falta auditoría de la conciliación sin reenvío.';
end $$;

select 'TESTS_OK — Higgsfield costo/huella/incierto/conciliación/idempotencia/PII/RBAC PASS, rollback total' as resultado;
rollback;
