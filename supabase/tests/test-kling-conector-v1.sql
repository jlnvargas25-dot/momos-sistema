-- MOMOS OPS · prueba adversarial Conector Kling v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260715_25_kling_conector'), 'Falta aplicar la migración 25.';
  assert public.kling_conector_disponible(), 'La sonda Kling no responde.';
  assert exists(select 1 from public.agency_integrations where provider='Kling'), 'Falta Kling en el catálogo protegido.';
  assert not has_table_privilege('authenticated','public.creative_connector_runs','INSERT'), 'Authenticated puede fabricar ejecuciones.';
  assert not has_function_privilege('authenticated','public.reclamar_trabajo_kling(text,integer)','EXECUTE'), 'La cola Kling privada quedó expuesta.';
  assert not has_function_privilege('authenticated','public.marcar_despacho_kling(bigint,uuid,text,numeric,jsonb)','EXECUTE'), 'El despacho Kling privado quedó expuesto.';
  assert not has_function_privilege('authenticated','public.conciliar_despacho_kling(bigint,uuid,text)','EXECUTE'), 'La conciliación Kling quedó expuesta.';
  assert not has_function_privilege('authenticated','public.registrar_salida_kling(bigint,uuid,jsonb)','EXECUTE'), 'Authenticated puede fabricar salidas Kling.';
  assert has_function_privilege('service_role','public.reportar_worker_kling(text,text,text,text,boolean)','EXECUTE'), 'Service role no puede reportar la salud del worker Kling.';
  assert has_function_privilege('service_role','public.reclamar_trabajo_kling(text,integer)','EXECUTE'), 'Service role no puede reclamar trabajos Kling.';
  assert not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name in ('agency_integrations','creative_connector_runs')
    and column_name in ('token','access_token','refresh_token','api_key','secret','secret_value')), 'Una tabla pública contiene secretos.';
end $$;

do $$
declare v_actor text; v_actor_auth uuid; v_product text; v_creative text:='CRE-KL-'||pg_backend_pid(); v_asset bigint; v_job bigint;
begin
  select id,auth_id into v_actor,v_actor_auth from public.users where auth_id is not null and activo
    and 'Administrador'=any(coalesce(roles,array[rol])) order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor is not null and v_actor_auth is not null and v_product is not null,
    'Falta administrador autenticado o producto para la prueba Kling.';
  insert into public.creatives(id,titulo,canal,formato,producto_foco_id,estado,notas)
  values(v_creative,'Conector Kling adversarial','Instagram','Reel',v_product,'Idea','Sintético; rollback total');
  insert into public.brand_media_assets(name,media_type,source,product_id,orientation,rights_status,ai_use_allowed,status,storage_path,
    content_hash,mime_type,size_bytes,created_by)
  values('Fuente Kling adversarial','Foto','MOMOS',v_product,'Vertical','Propio',true,'Activo','test/kling-'||pg_backend_pid()||'.png',
    md5(random()::text)||md5(random()::text),'image/png',2048,v_actor) returning id into v_asset;
  insert into public.creative_generation_jobs(creative_id,provider,operation,status,input_asset_ids,target_channel,target_format,prompt,created_by)
  values(v_creative,'Kling','Generar video','Preparado',jsonb_build_array(v_asset),'Instagram','Reel 9:16',
    'Producto MOMOS cinematográfico, movimiento suave, conservar identidad',v_actor) returning id into v_job;
  perform set_config('momos.kling_actor_auth',v_actor_auth::text,true);
  perform set_config('momos.kling_job',v_job::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.kling_actor_auth'),'role','authenticated')::text,true);
set local role authenticated;
select public.autorizar_trabajo_creativo(current_setting('momos.kling_job')::bigint,30000);

reset role;
set local role service_role;
select public.reportar_worker_kling('worker-kling-adversarial','test-1.0','Activa','',true);
do $$
declare v_claim jsonb; v_second jsonb; v_failed boolean:=false; v_external text; v_meta jsonb;
begin
  v_claim:=public.reclamar_trabajo_kling('worker-kling-adversarial',600);
  assert v_claim->'job'->>'id'=current_setting('momos.kling_job'), 'El worker Kling reclamó otro trabajo.';
  assert jsonb_array_length(v_claim->'job'->'assets')=1, 'La orden Kling no entregó su fuente exacta.';
  perform set_config('momos.kling_run',v_claim->>'run_id',true);
  perform set_config('momos.kling_lease',v_claim->>'lease_token',true);
  v_external:='momos-job-'||current_setting('momos.kling_job')||'-run-'||(v_claim->>'run_id');
  v_meta:=jsonb_build_object('model','kling-3.0','resolution','720p','duration_seconds',5,
    'estimated_units',3,'base_cost_cop',9000,'protected_cost_cop',11250,'external_task_id',v_external);

  v_second:=public.reclamar_trabajo_kling('worker-kling-doble',600);
  assert v_second->'job'='null'::jsonb, 'Dos workers reclamaron el mismo trabajo Kling.';
  begin perform public.marcar_despacho_kling((v_claim->>'run_id')::bigint,gen_random_uuid(),v_external,11250,v_meta);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Kling aceptó un lease token ajeno.';
  v_failed:=false;
  begin perform public.marcar_despacho_kling((v_claim->>'run_id')::bigint,(v_claim->>'lease_token')::uuid,
    v_external,30001,v_meta);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Kling reservó más que el tope humano.';

  perform public.marcar_despacho_kling((v_claim->>'run_id')::bigint,(v_claim->>'lease_token')::uuid,v_external,11250,v_meta);
  assert exists(select 1 from public.creative_connector_runs where id=(v_claim->>'run_id')::bigint
    and state='Despachando' and estimated_cost_cop=11250 and metadata->>'external_task_id'=v_external),
    'No persistió costo e idempotencia antes del POST.';
  perform public.fallar_trabajo_kling((v_claim->>'run_id')::bigint,(v_claim->>'lease_token')::uuid,
    'La red se cortó después del POST',true);
end $$;

do $$
declare v_claim jsonb;
begin
  assert exists(select 1 from public.creative_connector_runs where id=current_setting('momos.kling_run')::bigint
    and state='Incierto'), 'El despacho incierto no quedó bloqueado.';
  assert exists(select 1 from public.creative_generation_jobs where id=current_setting('momos.kling_job')::bigint
    and status='Autorizado'), 'Un despacho incierto simuló ejecución o fallo definitivo.';
  v_claim:=public.reclamar_trabajo_kling('worker-kling-no-duplicar',600);
  assert v_claim->'job'='null'::jsonb, 'El despacho incierto se volvió a cobrar por reenvío.';
  perform public.conciliar_despacho_kling(current_setting('momos.kling_run')::bigint,
    current_setting('momos.kling_lease')::uuid,'kling-task-adversarial');
end $$;

do $$ begin
  assert exists(select 1 from public.creative_generation_jobs where id=current_setting('momos.kling_job')::bigint
    and status='En generación' and provider_job_id='kling-task-adversarial' and estimated_cost_cop=11250),
    'La conciliación no selló el trabajo real.';
  assert exists(select 1 from public.creative_connector_runs where id=current_setting('momos.kling_run')::bigint
    and state='En proveedor' and provider_job_id='kling-task-adversarial'), 'La ejecución conciliada no quedó trazable.';
end $$;

reset role;
insert into storage.objects(bucket_id,name,metadata)
values('brand-assets','generated/kling/'||current_setting('momos.kling_job')||'/resultado.mp4','{"mimetype":"video/mp4","size":4096}'::jsonb);
set local role service_role;
select public.registrar_salida_kling(current_setting('momos.kling_run')::bigint,current_setting('momos.kling_lease')::uuid,
  jsonb_build_object('storage_path','generated/kling/'||current_setting('momos.kling_job')||'/resultado.mp4',
    'content_hash',md5('kling-a')||md5('kling-b'),'mime_type','video/mp4','size_bytes',4096,'cost_cop',9800,
    'model','kling-3.0','billing',jsonb_build_object('units',3,'cash',0)));

do $$
declare v_failed boolean:=false;
begin
  assert exists(select 1 from public.creative_generation_jobs where id=current_setting('momos.kling_job')::bigint
    and status='Completado' and generation_cost=9800 and output_asset_id is not null), 'No completó Kling con costo real.';
  assert exists(select 1 from public.brand_media_assets a join public.creative_generation_jobs j on j.output_asset_id=a.id
    where j.id=current_setting('momos.kling_job')::bigint and a.source='Generado' and a.media_type='Video'
      and a.rights_status='Por verificar' and a.ai_use_allowed=false
      and a.generation_meta->>'provider'='Kling' and a.generation_meta->>'needs_human_review'='true'),
    'La salida Kling evitó revisión humana o perdió trazabilidad.';
  assert exists(select 1 from public.agency_integrations where provider='Kling' and successful_jobs>=1 and last_job_at is not null),
    'Kling no acumuló salud operativa.';
  begin perform public.registrar_salida_kling(current_setting('momos.kling_run')::bigint,
    current_setting('momos.kling_lease')::uuid,'{}');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Kling registró dos veces la misma salida.';
end $$;

reset role;
update public.agency_integrations set status='Pausada',last_error='Prueba anti-reactivación' where provider='Kling';
set local role service_role;
select public.reportar_worker_kling('worker-kling-adversarial','test-1.1','Activa','',true);
do $$ begin
  assert exists(select 1 from public.agency_integrations where provider='Kling' and status='Pausada'),
    'El heartbeat Kling anuló una pausa administrativa.';
end $$;

select 'TESTS_OK — Kling API Key/idempotencia/conciliación/costo/salida/RBAC PASS, rollback total' as resultado;
rollback;
