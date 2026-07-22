-- MOMOS OPS · prueba adversarial Conector Higgsfield v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260715_24_higgsfield_conector'), 'Falta aplicar la migración 24.';
  assert public.higgsfield_conector_disponible(), 'La sonda Higgsfield no responde.';
  assert to_regclass('public.creative_connector_runs') is not null, 'Falta historial de ejecuciones del conector.';
  assert not has_table_privilege('authenticated','public.creative_connector_runs','INSERT'), 'Authenticated puede fabricar ejecuciones.';
  assert not has_function_privilege('authenticated','public.reclamar_trabajo_higgsfield(text,integer)','EXECUTE'), 'La cola privada quedó expuesta.';
  assert not has_function_privilege('authenticated','public.marcar_despacho_higgsfield(bigint,uuid)','EXECUTE'), 'El inicio privado de despacho quedó expuesto.';
  assert not has_function_privilege('authenticated','public.registrar_salida_higgsfield(bigint,uuid,jsonb)','EXECUTE'), 'Authenticated puede fabricar salidas.';
  assert not exists(select 1 from information_schema.columns where table_schema='public' and table_name in ('agency_integrations','creative_connector_runs')
    and column_name in ('token','access_token','refresh_token','api_key','secret','secret_value')), 'Una tabla pública contiene secretos.';
end $$;

do $$
declare v_actor text; v_actor_auth uuid; v_product text; v_creative text:='CRE-HF-'||pg_backend_pid(); v_asset bigint; v_job bigint;
begin
  select id,auth_id into v_actor,v_actor_auth from public.users where auth_id is not null and activo
    and 'Administrador'=any(coalesce(roles,array[rol])) order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor is not null and v_actor_auth is not null and v_product is not null, 'Falta administrador autenticado o producto para la prueba.';
  insert into public.creatives(id,titulo,canal,formato,producto_foco_id,estado,notas)
  values(v_creative,'Conector Higgsfield adversarial','Instagram','Reel',v_product,'Idea','Sintético; rollback total');
  insert into public.brand_media_assets(name,media_type,source,product_id,orientation,rights_status,ai_use_allowed,status,storage_path,
    content_hash,mime_type,size_bytes,created_by)
  values('Fuente Higgsfield adversarial','Foto','MOMOS',v_product,'Vertical','Propio',true,'Activo','test/hf-'||pg_backend_pid()||'.png',
    md5(random()::text)||md5(random()::text),'image/png',2048,v_actor) returning id into v_asset;
  insert into public.creative_generation_jobs(creative_id,provider,operation,status,input_asset_ids,target_channel,target_format,prompt,created_by)
  values(v_creative,'Higgsfield','Generar video','Preparado',jsonb_build_array(v_asset),'Instagram','Reel 9:16','Producto MOMOS cinematográfico',v_actor)
  returning id into v_job;
  perform set_config('momos.hf_actor_auth',v_actor_auth::text,true);
  perform set_config('momos.hf_job',v_job::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.hf_actor_auth'),'role','authenticated')::text,true);
set local role authenticated;
select public.autorizar_trabajo_creativo(current_setting('momos.hf_job')::bigint,30000);

reset role;
set local role service_role;
select public.reportar_worker_higgsfield('worker-adversarial','test-1.0','Activa','',true);
do $$
declare v_claim jsonb; v_second jsonb; v_failed boolean:=false;
begin
  v_claim:=public.reclamar_trabajo_higgsfield('worker-adversarial',300);
  assert v_claim->'job'->>'id'=current_setting('momos.hf_job'), 'El worker reclamó otro trabajo.';
  assert jsonb_array_length(v_claim->'job'->'assets')=1, 'La orden no entregó su fuente exacta.';
  perform set_config('momos.hf_run',v_claim->>'run_id',true);
  perform set_config('momos.hf_lease',v_claim->>'lease_token',true);
  v_second:=public.reclamar_trabajo_higgsfield('worker-doble',300);
  assert v_second->'job'='null'::jsonb, 'Dos workers reclamaron el mismo trabajo.';
  begin perform public.confirmar_despacho_higgsfield((v_claim->>'run_id')::bigint,gen_random_uuid(),'hf-no',1000,'{}');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó un lease token ajeno.';
  perform public.marcar_despacho_higgsfield((v_claim->>'run_id')::bigint,(v_claim->>'lease_token')::uuid);
  assert exists(select 1 from public.creative_connector_runs where id=(v_claim->>'run_id')::bigint and state='Despachando'),
    'No persistió el despacho antes de contactar al proveedor.';
  v_failed:=false;
  begin perform public.confirmar_despacho_higgsfield((v_claim->>'run_id')::bigint,(v_claim->>'lease_token')::uuid,'hf-caro',30001,'{}');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Despachó por encima del tope autorizado.';
  perform public.confirmar_despacho_higgsfield((v_claim->>'run_id')::bigint,(v_claim->>'lease_token')::uuid,'hf-job-adversarial',12000,
    jsonb_build_object('model','gemini_omni','credits',12));
end $$;

do $$ begin
  assert exists(select 1 from public.creative_generation_jobs where id=current_setting('momos.hf_job')::bigint
    and status='En generación' and provider_job_id='hf-job-adversarial' and estimated_cost_cop=12000), 'No selló el despacho real.';
  assert exists(select 1 from public.creative_connector_runs where id=current_setting('momos.hf_run')::bigint and state='En proveedor'), 'La ejecución no quedó trazable.';
end $$;

reset role;
insert into storage.objects(bucket_id,name,metadata)
values('brand-assets','generated/higgsfield/'||current_setting('momos.hf_job')||'/resultado.png','{"mimetype":"image/png","size":4096}'::jsonb);
set local role service_role;
select public.registrar_salida_higgsfield(current_setting('momos.hf_run')::bigint,current_setting('momos.hf_lease')::uuid,
  jsonb_build_object('storage_path','generated/higgsfield/'||current_setting('momos.hf_job')||'/resultado.png',
    'content_hash',md5('hf-a')||md5('hf-b'),'mime_type','image/png','size_bytes',4096,'cost_cop',11500,'model','gemini_omni'));

do $$
declare v_failed boolean:=false;
begin
  assert exists(select 1 from public.creative_generation_jobs where id=current_setting('momos.hf_job')::bigint
    and status='Completado' and generation_cost=11500 and output_asset_id is not null), 'No completó el trabajo con costo real.';
  assert exists(select 1 from public.brand_media_assets a join public.creative_generation_jobs j on j.output_asset_id=a.id
    where j.id=current_setting('momos.hf_job')::bigint and a.source='Generado' and a.rights_status='Por verificar'
      and a.ai_use_allowed=false and a.generation_meta->>'needs_human_review'='true'), 'La salida evitó la revisión humana.';
  assert exists(select 1 from public.agency_integrations where provider='Higgsfield' and successful_jobs>=1 and last_job_at is not null), 'No acumuló salud operativa.';
  begin perform public.registrar_salida_higgsfield(current_setting('momos.hf_run')::bigint,current_setting('momos.hf_lease')::uuid,'{}');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Registró dos veces la misma salida.';
end $$;

reset role;
update public.agency_integrations set status='Pausada',last_error='Prueba anti-reactivación' where provider='Higgsfield';
set local role service_role;
select public.reportar_worker_higgsfield('worker-adversarial','test-1.1','Activa','',true);
do $$ begin
  assert exists(select 1 from public.agency_integrations where provider='Higgsfield' and status='Pausada'),
    'El heartbeat del worker anuló una pausa administrativa.';
end $$;

select 'TESTS_OK — Conector Higgsfield lease/costo/salida/RBAC PASS, rollback total' as resultado;
rollback;
