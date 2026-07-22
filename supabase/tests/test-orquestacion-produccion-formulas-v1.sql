-- MOMOS OPS · H107 · Orquestación fórmula + paquete. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h107_formula_production'));

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_107_orquestacion_produccion_formulas'),
    'H107 requiere aplicar orquestacion-produccion-formulas-v1.sql.';
  assert public.orquestacion_produccion_formulas_disponible()
    and to_regprocedure('public.preparar_plan_produccion_formula_v1(jsonb)') is not null
    and to_regprocedure('public.preparar_plan_produccion_formula_agente_v1(jsonb)') is not null
    and to_regprocedure('public.revisar_plan_produccion_formula_v1(bigint,text,text)') is not null
    and to_regprocedure('public.momos_production_preflight_v1()') is not null,
    'H107 no instaló el contrato completo.';
  assert not has_table_privilege('authenticated','public.agency_formula_production_plans','SELECT')
    and not has_table_privilege('service_role','public.agency_formula_production_plans','SELECT')
    and has_function_privilege('authenticated','public.preparar_plan_produccion_formula_v1(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.preparar_plan_produccion_formula_agente_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.preparar_plan_produccion_formula_agente_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_production_preflight_v1()','EXECUTE'),
    'H107 perdió aislamiento o RBAC.';
end $$;

create temporary table h107_context(
  admin_id text,auth_id uuid,product_id text,campaign_id text,creative_id text,
  formula_id bigint,draft_formula_id bigint,pack_id bigint,asset_id bigint,quarter_asset_id bigint,
  plan_id bigint,jobs_before bigint
) on commit drop;
grant select,update on h107_context to authenticated,service_role;

do $$
declare
  v_actor public.users%rowtype; v_product text; v_campaign text; v_creative text;
  v_formula bigint; v_draft bigint; v_pack bigint; v_asset bigint; v_quarter bigint;
  v_suffix text:=pg_backend_pid()::text; v_path text; v_formula_snapshot jsonb;
  v_formula_fp text; v_pack_fp text;
begin
  select * into v_actor from public.users where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol])) order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor.id is not null and v_product is not null,
    'H107 necesita Administrador y producto activo.';
  v_campaign:='CMP-H107-'||v_suffix; v_creative:='CRE-H107-'||v_suffix;
  insert into public.campaigns(id,nombre,canal,objetivo,presupuesto,estado,external_platform,external_id)
  values(v_campaign,'H107 preflight controlado','Instagram','Ventas',50000,'Planeada','meta','meta-h107-'||v_suffix);
  insert into public.creatives(id,campaign_id,titulo,canal,formato,estado,producto_foco_id,figura,sabor,external_id)
  values(v_creative,v_campaign,'H107 creativo fuente','Instagram','Reel','Aprobado',v_product,
    'Momo','Mango biche','ad-h107-'||v_suffix);
  v_formula_snapshot:=jsonb_build_object(
    'hook','El antojo aparece en el primer segundo',
    'narrative_structure','Producto, textura, reacción y cierre',
    'humanization','Movimiento natural y manos reales',
    'proof','Producto real visible sin deformación',
    'offer','Sin oferta inventada','cta','Elegí tu sabor',
    'visual_style','Cálido, profundo y apetitoso',
    'camera_pattern','Acercamiento natural con parallax contenido');
  v_formula_fp:=public._agency_creative_intelligence_fingerprint(jsonb_build_object(
    'formula_key','h107-antojo','name','H107 antojo real','mode','Pauta',
    'source_creative_id',v_creative,'source_creative_version_id',null,
    'retention_script_id',null,'formula_snapshot',v_formula_snapshot));
  insert into public.agency_creative_formulas(
    proposal_key,formula_key,version,name,mode,status,source_creative_id,campaign_id,
    product_id,channel,objective,figure,flavor,formula_snapshot,formula_fingerprint,
    source_kind,prepared_by,reviewed_by,reviewed_at,review_note)
  values('h107-approved-'||v_suffix,'h107-antojo',1,'H107 antojo real','Pauta','Aprobada',
    v_creative,v_campaign,v_product,'Instagram','Ventas','Momo','Mango biche',v_formula_snapshot,
    v_formula_fp,'Humano',v_actor.id,v_actor.id,clock_timestamp(),'Fórmula validada para rollback H107.')
  returning id into v_formula;
  insert into public.agency_creative_formulas(
    proposal_key,formula_key,version,name,mode,status,source_creative_id,campaign_id,
    product_id,channel,objective,figure,flavor,formula_snapshot,formula_fingerprint,
    source_kind,prepared_by)
  values('h107-draft-'||v_suffix,'h107-borrador',1,'H107 fórmula sin aprobar','Pauta','Propuesta',
    v_creative,v_campaign,v_product,'Instagram','Ventas','Momo','Mango biche',v_formula_snapshot,
    public._agency_creative_intelligence_fingerprint(v_formula_snapshot||'{"draft":true}'::jsonb),
    'Humano',v_actor.id) returning id into v_draft;

  v_path:='test/h107-momo-'||v_suffix||'.png';
  insert into storage.objects(bucket_id,name,metadata)
  values('brand-assets',v_path,'{"mimetype":"image/png","size":250000}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,
    orientation,contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,
    content_hash,mime_type,size_bytes,width,height,tags,notes,created_by)
  values('H107 Momo frontal','Foto','MOMOS',v_product,'Momo','Mango biche','Producto','Vertical',
    false,'Propio',true,'["Instagram"]','Activo',v_path,md5(random()::text)||md5(random()::text),
    'image/png',250000,1080,1920,'[]','Rollback H107',v_actor.id) returning id into v_asset;
  v_path:='test/h107-momo-quarter-'||v_suffix||'.png';
  insert into storage.objects(bucket_id,name,metadata)
  values('brand-assets',v_path,'{"mimetype":"image/png","size":250000}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,
    orientation,contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,
    content_hash,mime_type,size_bytes,width,height,tags,notes,created_by)
  values('H107 Momo tres cuartos','Foto','MOMOS',v_product,'Momo','Mango biche','Producto','Vertical',
    false,'Propio',true,'["Instagram"]','Activo',v_path,md5(random()::text)||md5(random()::text),
    'image/png',250000,1080,1920,'[]','Rollback H107',v_actor.id) returning id into v_quarter;
  insert into public.brand_asset_production_profiles(asset_id,component_type,view_angle,physical_state,
    interaction_type,hand_assignment,scale_reference,source_quality,qa_status,consent_status,canonical,
    visual_set_key,created_by,updated_by)
  values
    (v_asset,'Producto','Frontal','Intacto','Ninguna','Ninguna','Cuchara MOMOS de 14 cm',
      'Original limpio','Aprobado','No aplica',true,'h107-momo-master-'||v_suffix,v_actor.id,v_actor.id),
    (v_quarter,'Producto','Tres cuartos','Intacto','Ninguna','Ninguna','Cuchara MOMOS de 14 cm',
      'Original limpio','Aprobado','No aplica',true,'h107-momo-master-'||v_suffix,v_actor.id,v_actor.id);
  v_pack_fp:=md5(jsonb_build_object('h107',v_suffix,'asset_id',v_asset,'quarter_asset_id',v_quarter)::text);
  insert into public.brand_production_packs(name,purpose,status,product_id,figure,channel,target_format,
    requirements,fingerprint,created_by,reviewed_by,reviewed_at,review_note)
  values('H107 paquete '||v_suffix,'Referencias exactas para validar el preflight H107.','Aprobado',
    v_product,'Momo','Instagram','Reel 9:16','{"required_roles":["Producto"]}',v_pack_fp,
    v_actor.id,v_actor.id,clock_timestamp(),'Activo y derechos revisados.') returning id into v_pack;
  insert into public.brand_production_pack_assets(pack_id,asset_id,role,sequence,required,added_by)
  values
    (v_pack,v_asset,'Producto',1,true,v_actor.id),
    (v_pack,v_quarter,'Continuidad',2,true,v_actor.id);
  insert into h107_context values(v_actor.id,v_actor.auth_id,v_product,v_campaign,v_creative,
    v_formula,v_draft,v_pack,v_asset,v_quarter,null,(select count(*) from public.creative_generation_jobs));
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h107_context),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_checks jsonb:='["Enfoque y exposición","Identidad y geometría","Color y textura","Recorte y oclusiones","Logo y texto","Fondo y reflejos"]'::jsonb;
begin
  if to_regprocedure('public.revisar_calidad_activo_visual_v1(bigint,jsonb)') is not null then
    perform public.revisar_calidad_activo_visual_v1((select asset_id from h107_context),
      jsonb_build_object('issues','[]'::jsonb,'checks_completed',v_checks,
        'review_notes','Referencia frontal limpia verificada para la prueba H107.'));
    perform public.revisar_calidad_activo_visual_v1((select quarter_asset_id from h107_context),
      jsonb_build_object('issues','[]'::jsonb,'checks_completed',v_checks,
        'review_notes','Referencia tres cuartos limpia verificada para la prueba H107.'));
  end if;
end $$;

do $$
declare
  v_payload jsonb; v_result jsonb; v_state jsonb; v_plan bigint; v_next_plan bigint; v_failed boolean:=false;
begin
  v_payload:=jsonb_build_object(
    'plan_key','h107-plan-'||pg_backend_pid(),
    'formula_id',(select formula_id from h107_context),
    'production_pack_id',(select pack_id from h107_context),
    'provider','Higgsfield','operation','Generar video','model_label','Seedance 2.0',
    'duration_seconds',8,'output_count',1,'estimated_cost_cop',5000,'max_cost_cop',8000);

  begin
    perform public.preparar_plan_produccion_formula_v1(v_payload||jsonb_build_object('customer_phone','3001234567'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H107 aceptó campos abiertos o PII.';
  v_failed:=false;
  begin
    perform public.preparar_plan_produccion_formula_v1(jsonb_set(v_payload,'{formula_id}',
      to_jsonb((select draft_formula_id from h107_context))));
  exception when others then v_failed:=true; end;
  assert v_failed,'H107 aceptó una fórmula no aprobada.';

  v_result:=public.preparar_plan_produccion_formula_v1(v_payload);
  v_plan:=(v_result->>'plan_id')::bigint;
  assert v_plan is not null and v_result->>'status'='Preparado'
    and (v_result->>'human_approval_required')::boolean
    and not (v_result->>'credits_consumed')::boolean
    and not (v_result->>'job_created')::boolean
    and not (v_result->>'external_execution')::boolean
    and not (v_result->>'publication_allowed')::boolean,
    'H107 confundió preflight con ejecución, crédito o publicación.';
  assert (public.preparar_plan_produccion_formula_v1(v_payload)->>'duplicate')::boolean,
    'H107 duplicó el preflight durante un replay exacto.';
  v_failed:=false;
  begin perform public.preparar_plan_produccion_formula_v1(jsonb_set(v_payload,'{max_cost_cop}','9000'::jsonb));
  exception when others then v_failed:=true; end;
  assert v_failed,'H107 aceptó una colisión idempotente.';

  perform public.revisar_plan_produccion_formula_v1(v_plan,'En revisión',
    'El preflight entra a revisión humana de fórmula, activos y costo.');
  v_result:=public.revisar_plan_produccion_formula_v1(v_plan,'Aprobado',
    'Fórmula, activos, canal, formato, derechos y costo máximo fueron revisados.');
  assert v_result->>'status'='Aprobado'
    and not (v_result->>'credits_consumed')::boolean
    and not (v_result->>'job_created')::boolean
    and not (v_result->>'external_execution')::boolean,
    'H107 convirtió la aprobación del contrato en ejecución.';

  v_result:=public.preparar_plan_produccion_formula_v1(
    jsonb_set(v_payload,'{plan_key}',to_jsonb('h107-plan-next-'||pg_backend_pid())));
  v_next_plan:=(v_result->>'plan_id')::bigint;
  perform public.revisar_plan_produccion_formula_v1(v_next_plan,'En revisión',
    'Una versión posterior entra a revisión humana controlada.');
  perform public.revisar_plan_produccion_formula_v1(v_next_plan,'Aprobado',
    'La versión posterior sustituye sin reescribir la evidencia previa.');
  v_state:=public.momos_production_preflight_v1();
  assert exists(select 1 from jsonb_array_elements(v_state#>'{snapshot,plans}') x
      where (x->>'id')::bigint=v_plan and x->>'status'='Sustituido')
    and exists(select 1 from jsonb_array_elements(v_state#>'{snapshot,plans}') x
      where (x->>'id')::bigint=v_next_plan and x->>'status'='Aprobado'),
    'H107 no sustituyó limpiamente la aprobación anterior.';
  update h107_context set plan_id=v_next_plan;
end $$;

reset role;
set local role service_role;

do $$
declare v_snapshot jsonb; v_result jsonb;
begin
  v_snapshot:=public.momos_production_preflight_v1();
  assert length(v_snapshot->>'fingerprint')=64
    and v_snapshot#>>'{snapshot,schema_version}'='momos-production-preflight/v1'
    and (v_snapshot#>>'{snapshot,human_approval_required}')::boolean
    and not (v_snapshot#>>'{snapshot,credits_consumed}')::boolean
    and not (v_snapshot#>>'{snapshot,jobs_created}')::boolean
    and not (v_snapshot#>>'{snapshot,external_execution_allowed}')::boolean
    and not (v_snapshot#>>'{snapshot,publication_allowed}')::boolean
    and not (v_snapshot#>>'{snapshot,privacy,contains_customer_pii}')::boolean
    and v_snapshot::text !~* '"storage_path"\s*:|customer_phone|"email"\s*:|direccion|access[_-]?token|service[_-]?role',
    'H107 perdió huella, privacidad o sus guardas cerradas.';
  v_result:=public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key','h107-log-'||pg_backend_pid(),'tool_name','momos_production_preflight',
    'mode','Lectura','status','OK','worker_id','h107-worker','subject_ref','preflight',
    'input_fingerprint',md5('in'),'output_fingerprint',md5('out'),
    'details','{"external_execution":false,"credits_consumed":false}'::jsonb));
  assert coalesce((v_result->>'ok')::boolean,false),'H107 no auditó la lectura MCP.';
end $$;

reset role;
do $$
declare v_failed boolean:=false;
begin
  assert (select count(*) from public.creative_generation_jobs)=(select jobs_before from h107_context),
    'H107 creó o alteró trabajos creativos durante el preflight.';
  assert exists(select 1 from public.agency_mcp_access_log
    where worker_id='h107-worker' and tool_name='momos_production_preflight'),
    'H107 no persistió la auditoría MCP.';
  begin
    update public.agency_formula_production_plans set max_cost_cop=max_cost_cop+1
    where id=(select plan_id from h107_context);
  exception when others then v_failed:=true; end;
  assert v_failed,'H107 permitió reescribir un preflight aprobado.';
  v_failed:=false;
  begin delete from public.agency_formula_production_plans where id=(select plan_id from h107_context);
  exception when others then v_failed:=true; end;
  assert v_failed,'H107 permitió eliminar evidencia del preflight.';
end $$;

select 'TESTS_OK — H107 fórmula/paquete/preflight/costo/idempotencia/no créditos/no ejecución/no publicación/MCP/RBAC PASS, rollback total' as resultado;
rollback;
