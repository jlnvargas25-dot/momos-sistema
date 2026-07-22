-- MOMOS OPS · H109 · piloto real controlado. Siempre ROLLBACK y nunca llama proveedores.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h109_generation_pilot'));

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_109_piloto_generacion_controlado'),
    'H109 requiere aplicar piloto-generacion-controlado-v1.sql.';
  assert public.piloto_generacion_controlado_disponible()
    and to_regclass('public.agency_generation_pilots') is not null
    and to_regprocedure('public.armar_piloto_generacion_v1(jsonb)') is not null
    and to_regprocedure('public.cancelar_piloto_generacion_v1(bigint,text)') is not null
    and to_regprocedure('public.reclamar_trabajo_creativo_general_v1(text,text,integer)') is not null
    and to_regprocedure('public.reclamar_piloto_generacion_v1(text,text,integer)') is not null
    and to_regprocedure('public.momos_generation_pilots_v1()') is not null,
    'H109 no instaló el contrato completo.';
  assert not has_table_privilege('authenticated','public.agency_generation_pilots','SELECT')
    and not has_table_privilege('service_role','public.agency_generation_pilots','SELECT')
    and has_function_privilege('authenticated','public.armar_piloto_generacion_v1(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.armar_piloto_generacion_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.reclamar_piloto_generacion_v1(text,text,integer)','EXECUTE')
    and not has_function_privilege('authenticated','public.reclamar_piloto_generacion_v1(text,text,integer)','EXECUTE'),
    'H109 perdió aislamiento o RBAC.';
end $$;

create temporary table h109_context(
  admin_id text,auth_id uuid,product_id text,formula_id bigint,pack_id bigint,
  asset_id bigint,logo_asset_id bigint,plan_id bigint,authorization_id bigint,job_id bigint,pilot_id bigint,run_id bigint,
  jobs_before bigint,runs_before bigint,pilots_before bigint
) on commit drop;
grant select,update on h109_context to authenticated,service_role;

do $$
declare
  v_actor public.users%rowtype; v_product text; v_campaign text; v_creative text;
  v_formula bigint; v_pack bigint; v_asset bigint; v_logo bigint; v_plan bigint; v_job bigint;
  v_suffix text:=pg_backend_pid()::text; v_path text; v_formula_key text;
  v_formula_snapshot jsonb; v_formula_fp text; v_plan_fp text;
begin
  select * into v_actor from public.users where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol])) order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor.id is not null and v_product is not null
    and exists(select 1 from public.agency_brand_profiles where status='Activo'),
    'H109 necesita Administrador, producto y marca activa.';
  update public.agency_settings set paused=false,
    campaign_budget_limit=greatest(campaign_budget_limit,50000) where id;
  update public.agency_integrations set status='Activa',secret_configured=true,
    last_heartbeat_at=clock_timestamp(),capabilities='["Imagen","Video","Edición"]'::jsonb
    where provider='Higgsfield';

  v_campaign:='CMP-H109-'||v_suffix; v_creative:='CRE-H109-'||v_suffix;
  v_formula_key:='h109-antojo-'||v_suffix;
  insert into public.campaigns(id,nombre,canal,objetivo,presupuesto,estado,external_platform,external_id)
  values(v_campaign,'H109 piloto protegido','Instagram','Ventas',50000,'Planeada','meta','meta-h109-'||v_suffix);
  insert into public.creatives(id,campaign_id,titulo,canal,formato,estado,producto_foco_id,figura,sabor,external_id)
  values(v_creative,v_campaign,'H109 creativo fuente','Instagram','Reel','Aprobado',v_product,
    'Momo','Mango biche','ad-h109-'||v_suffix);
  v_formula_snapshot:=jsonb_build_object(
    'hook','El antojo aparece en el primer segundo','narrative_structure','Producto, textura y cierre',
    'humanization','Movimiento natural','proof','Producto real visible','offer','Sin oferta inventada',
    'cta','Elegí tu sabor','visual_style','Cálido y apetitoso','camera_pattern','Acercamiento natural');
  v_formula_fp:=public._agency_creative_intelligence_fingerprint(jsonb_build_object(
    'formula_key',v_formula_key,'name','H109 antojo real','mode','Pauta',
    'source_creative_id',v_creative,'source_creative_version_id',null,
    'retention_script_id',null,'formula_snapshot',v_formula_snapshot));
  insert into public.agency_creative_formulas(
    proposal_key,formula_key,version,name,mode,status,source_creative_id,campaign_id,
    product_id,channel,objective,figure,flavor,formula_snapshot,formula_fingerprint,
    source_kind,prepared_by,reviewed_by,reviewed_at,review_note)
  values('h109-approved-'||v_suffix,v_formula_key,1,'H109 antojo real','Pauta','Aprobada',
    v_creative,v_campaign,v_product,'Instagram','Ventas','Momo','Mango biche',v_formula_snapshot,
    v_formula_fp,'Humano',v_actor.id,v_actor.id,clock_timestamp(),'Fórmula temporal aprobada para rollback H109.')
  returning id into v_formula;

  v_path:='test/h109-momo-'||v_suffix||'.png';
  insert into storage.objects(bucket_id,name,metadata)
  values('brand-assets',v_path,'{"mimetype":"image/png","size":4096}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,
    orientation,contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,
    content_hash,mime_type,size_bytes,width,height,tags,notes,created_by)
  values('H109 Momo frontal','Foto','MOMOS',v_product,'Momo','Mango biche','Producto','Vertical',
    false,'Propio',true,'["Instagram"]','Activo',v_path,md5(random()::text)||md5(random()::text),
    'image/png',250000,1080,1920,'[]','Rollback H109',v_actor.id) returning id into v_asset;
  insert into public.brand_asset_production_profiles(asset_id,component_type,view_angle,physical_state,
    interaction_type,hand_assignment,source_quality,qa_status,consent_status,canonical,created_by,updated_by)
  values(v_asset,'Producto','Frontal','Intacto','Ninguna','Ninguna','Original limpio','Aprobado',
    'No aplica',true,v_actor.id,v_actor.id);
  v_path:='test/h109-logo-'||v_suffix||'.png';
  insert into storage.objects(bucket_id,name,metadata)
  values('brand-assets',v_path,'{"mimetype":"image/png","size":4096}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,shot_type,orientation,contains_people,
    rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,
    tags,notes,created_by)
  values('H109 logo oficial','Logo','MOMOS','Marca','Cuadrado',false,'Propio',true,'[]','Activo',v_path,
    md5(random()::text)||md5(random()::text),'image/png',4096,'[]','Rollback H109',v_actor.id)
  returning id into v_logo;
  insert into public.brand_production_packs(name,purpose,status,product_id,figure,channel,target_format,
    requirements,fingerprint,created_by,reviewed_by,reviewed_at,review_note)
  values('H109 paquete '||v_suffix,'Referencia exacta para certificar el piloto H109.','Aprobado',
    v_product,'Momo','Instagram','Post 4:5','{"required_roles":["Producto"]}',
    md5('h109-pack-'||v_suffix),v_actor.id,v_actor.id,clock_timestamp(),'Derechos revisados para rollback.')
  returning id into v_pack;
  insert into public.brand_production_pack_assets(pack_id,asset_id,role,sequence,required,added_by)
  values(v_pack,v_asset,'Producto',1,true,v_actor.id);

  v_plan_fp:=public._agency_creative_intelligence_fingerprint(jsonb_build_object(
    'formula_id',v_formula,'pack_id',v_pack,'provider','Higgsfield','operation','Generar imagen'));
  insert into public.agency_formula_production_plans(plan_key,formula_id,production_pack_id,version,status,
    provider,operation,model_label,channel,target_format,duration_seconds,output_count,
    estimated_cost_cop,max_cost_cop,formula_fingerprint,pack_fingerprint,preflight_snapshot,
    preflight_fingerprint,source_kind,prepared_by,reviewed_by,reviewed_at,review_note)
  values('h109-plan-'||v_suffix,v_formula,v_pack,1,'Aprobado','Higgsfield','Generar imagen',
    'Imagen 4:5','Instagram','Post 4:5',0,1,5000,8000,v_formula_fp,md5('h109-pack-'||v_suffix),
    jsonb_build_object('schema_version','momos-formula-production-preflight/v1','publication_allowed',false),
    v_plan_fp,'Humano',v_actor.id,v_actor.id,clock_timestamp(),'Preflight temporal aprobado.')
  returning id into v_plan;

  insert into public.creative_generation_jobs(creative_id,provider,operation,status,input_asset_ids,
    target_channel,target_format,prompt,negative_prompt,output_spec,created_by)
  values(v_creative,'Higgsfield','Generar imagen','Preparado',jsonb_build_array(v_asset),
    'Instagram','Post 4:5','Momo real con luz cálida y producto intacto.','Sin deformar el producto.',
    jsonb_build_object('formula_production_plan_id',v_plan,'publication_allowed',false,'output_count',1),
    v_actor.id) returning id into v_job;
  insert into h109_context values(v_actor.id,v_actor.auth_id,v_product,v_formula,v_pack,v_asset,v_logo,v_plan,
    null,v_job,null,null,(select count(*) from public.creative_generation_jobs)-1,
    (select count(*) from public.creative_connector_runs),
    (select count(*) from public.agency_generation_pilots));
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h109_context),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_kit bigint; v_item record;
  v_quality_checks jsonb:='["Enfoque y exposición","Identidad y geometría","Color y textura","Recorte y oclusiones","Logo y texto","Fondo y reflejos"]'::jsonb;
begin
  v_kit:=(public.preparar_kit_identidad_marca(
    'Kit íntegro y temporal para certificar H109 con rollback total.') ->> 'kit_id')::bigint;
  for v_item in select role from public.agency_brand_kit_assets where kit_id=v_kit loop
    perform public.desvincular_logo_kit_identidad(v_kit,v_item.role);
  end loop;
  perform public.vincular_logo_kit_identidad(v_kit,(select logo_asset_id from h109_context),
    'principal','Cualquiera','{}'::text[],48,0.25);
  perform public.activar_kit_identidad_marca(v_kit,
    'Logo, colores, derechos y perfil revisados para la prueba H109.');
  -- H110-Q puede estar instalado en bases que ya endurecieron la calidad visual.
  -- La prueba conserva compatibilidad con una cadena nueva sin H110-Q, pero cuando
  -- el gate existe certifica la referencia sintética mediante la RPC humana real.
  if to_regprocedure('public.revisar_calidad_activo_visual_v1(bigint,jsonb)') is not null then
    perform public.revisar_calidad_activo_visual_v1((select asset_id from h109_context),jsonb_build_object(
      'issues','[]'::jsonb,
      'checks_completed',v_quality_checks,
      'review_notes','Referencia Full HD sintética verificada para rollback H109.'));
  end if;
  perform public.autorizar_trabajo_creativo((select job_id from h109_context),8000);
end $$;

reset role;

do $$
declare v_job_fp text; v_auth bigint; v_actor text; v_plan bigint; v_job bigint; v_plan_fp text;
begin
  select admin_id,plan_id,job_id into v_actor,v_plan,v_job from h109_context;
  select preflight_fingerprint into v_plan_fp from public.agency_formula_production_plans where id=v_plan;
  v_job_fp:=public._mcp_human_job_fingerprint(v_job);
  insert into public.agency_formula_generation_authorizations(authorization_key,plan_id,job_id,provider,
    max_cost_cop,request_fingerprint,plan_fingerprint,job_fingerprint,brand_profile_fingerprint,
    brand_kit_fingerprint,authorization_snapshot,authorization_fingerprint,authorized_by)
  values('h109-auth-'||pg_backend_pid(),v_plan,v_job,'Higgsfield',8000,
    repeat('1',64),v_plan_fp,v_job_fp,repeat('2',32),repeat('3',32),
    jsonb_build_object('schema_version','momos-generation-authorization/v1','job_id',v_job,
      'publication_allowed',false),repeat('4',64),v_actor) returning id into v_auth;
  update h109_context set authorization_id=v_auth;
end $$;

set local role authenticated;

do $$
declare v_payload jsonb; v_result jsonb; v_replay jsonb; v_failed boolean:=false;
begin
  v_payload:=jsonb_build_object('pilot_key','h109-pilot-'||pg_backend_pid(),
    'authorization_id',(select authorization_id from h109_context),'expires_in_minutes',30,
    'decision_note','Autorizo una sola generación externa para revisar el resultado sin publicarlo.',
    'acknowledge_single_external_generation',true);
  begin perform public.armar_piloto_generacion_v1(v_payload-'acknowledge_single_external_generation');
  exception when others then v_failed:=true; end;
  assert v_failed,'H109 armó un piloto sin confirmación explícita.';
  v_result:=public.armar_piloto_generacion_v1(v_payload);
  v_replay:=public.armar_piloto_generacion_v1(v_payload);
  assert (v_result->>'pilot_id')::bigint is not null and v_result->>'status'='Armado'
    and (v_result->>'pilot_worker_may_claim')::boolean
    and not (v_result->>'external_execution_started')::boolean
    and not (v_result->>'credits_consumed')::boolean
    and not (v_result->>'publication_allowed')::boolean
    and (v_replay->>'duplicate')::boolean
    and (v_replay->>'pilot_id')::bigint=(v_result->>'pilot_id')::bigint,
    'H109 no separó permiso, ejecución, crédito y publicación o duplicó el piloto.';
  update h109_context set pilot_id=(v_result->>'pilot_id')::bigint;
end $$;

reset role;

do $$
declare v_failed boolean:=false;
begin
  begin
    insert into public.creative_connector_runs(job_id,provider,worker_id,lease_expires_at)
    values((select job_id from h109_context),'Higgsfield','worker-general-bypass',clock_timestamp()+interval '10 minutes');
  exception when others then v_failed:=true; end;
  assert v_failed,'H109 permitió que un worker general reclamara el trabajo piloto.';
  assert (select count(*) from public.creative_connector_runs)=(select runs_before from h109_context),
    'H109 dejó una ejecución parcial durante el bypass.';
end $$;

set local role service_role;
do $$
declare v_claim jsonb; v_empty jsonb;
begin
  v_claim:=public.reclamar_piloto_generacion_v1('Higgsfield','pilot:test-h109',600);
  assert (v_claim#>>'{job,id}')::bigint=(select job_id from h109_context)
    and (v_claim#>>'{pilot,id}')::bigint=(select pilot_id from h109_context)
    and (v_claim->>'run_id')::bigint is not null
    and jsonb_array_length(v_claim#>'{job,assets}')=1,
    'H109 no arrendó el trabajo y activo exactos.';
  update h109_context set run_id=(v_claim->>'run_id')::bigint;
  v_empty:=public.reclamar_piloto_generacion_v1('Higgsfield','pilot:test-h109-replay',600);
  assert v_empty->'job'='null'::jsonb,'H109 permitió reclamar dos veces el mismo piloto.';
end $$;

do $$
declare v_snapshot jsonb; v_log jsonb;
begin
  v_snapshot:=public.momos_generation_pilots_v1();
  assert length(v_snapshot->>'fingerprint')=64
    and v_snapshot#>>'{snapshot,schema_version}'='momos-generation-pilots/v1'
    and (v_snapshot#>>'{snapshot,single_active_pilot}')::boolean
    and not (v_snapshot#>>'{snapshot,credits_consumed_by_arm}')::boolean
    and not (v_snapshot#>>'{snapshot,publication_allowed}')::boolean
    and not (v_snapshot#>>'{snapshot,privacy,contains_customer_pii}')::boolean
    and v_snapshot::text !~* '"storage_path"\s*:|customer_phone|"email"\s*:|direccion|access[_-]?token|service[_-]?role',
    'H109 perdió huella, privacidad o bloqueo de publicación.';
  assert exists(select 1 from jsonb_array_elements(v_snapshot#>'{snapshot,pilots}') x
    where (x->>'id')::bigint=(select pilot_id from h109_context)
      and x->>'status'='Arrendado' and (x->>'external_execution_started')::boolean
      and not (x->>'pilot_worker_may_claim')::boolean),
    'H109 no expuso el arrendamiento controlado.';
  v_log:=public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key','h109-log-'||pg_backend_pid(),'tool_name','momos_generation_pilots',
    'mode','Lectura','status','OK','worker_id','h109-mcp-worker','subject_ref','generation-pilots',
    'input_fingerprint',md5('in'),'output_fingerprint',md5('out'),
    'details','{"publication_allowed":false,"external_execution_started":true}'::jsonb));
  assert coalesce((v_log->>'ok')::boolean,false),'H109 no auditó la lectura MCP.';
end $$;

reset role;

do $$
declare v_failed boolean:=false;
begin
  assert (select count(*) from public.creative_generation_jobs)=(select jobs_before+1 from h109_context)
    and (select count(*) from public.creative_connector_runs)=(select runs_before+1 from h109_context)
    and (select count(*) from public.agency_generation_pilots)=(select pilots_before+1 from h109_context),
    'H109 perdió cardinalidad atómica.';
  assert exists(select 1 from public.creative_connector_runs r join h109_context c on c.run_id=r.id
    where r.state='Arrendado' and r.provider_job_id is null and r.actual_cost_cop=0),
    'H109 fingió despacho, proveedor o costo durante el lease.';
  assert exists(select 1 from public.creative_generation_jobs j join h109_context c on c.job_id=j.id
    where j.status='Autorizado' and j.provider_job_id is null and j.generation_cost=0
      and j.output_asset_id is null and j.output_spec->>'publication_allowed'='false'),
    'H109 consumió, generó o autorizó publicación durante el lease.';
  begin update public.agency_generation_pilots set max_cost_cop=max_cost_cop+1
    where id=(select pilot_id from h109_context);
  exception when others then v_failed:=true; end;
  assert v_failed,'H109 permitió reescribir el contrato del piloto.';
  v_failed:=false;
  begin perform public.cancelar_piloto_generacion_v1((select pilot_id from h109_context),
    'Intento tardío después del arrendamiento'); exception when others then v_failed:=true; end;
  assert v_failed,'H109 permitió cancelar como inocuo un piloto ya reclamado.';
end $$;

select 'TESTS_OK — H109 permiso temporal/worker piloto/cola general/lease único/costo cero/no proveedor/no publicación/MCP/RBAC PASS, rollback total' as resultado;
rollback;
