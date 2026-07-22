-- MOMOS OPS · H108 · autorización atómica desde H107. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h108_generation_authorization'));

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_108_autorizacion_generacion_preflight'),
    'H108 requiere aplicar autorizacion-generacion-preflight-v1.sql.';
  assert public.autorizacion_generacion_preflight_disponible()
    and to_regprocedure('public.autorizar_generacion_desde_preflight_v1(jsonb)') is not null
    and to_regprocedure('public.momos_generation_authorizations_v1()') is not null,
    'H108 no instaló el contrato completo.';
  assert not has_table_privilege('authenticated','public.agency_formula_generation_authorizations','SELECT')
    and not has_table_privilege('service_role','public.agency_formula_generation_authorizations','SELECT')
    and has_function_privilege('authenticated','public.autorizar_generacion_desde_preflight_v1(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.autorizar_generacion_desde_preflight_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.momos_generation_authorizations_v1()','EXECUTE'),
    'H108 perdió aislamiento o RBAC.';
end $$;

create temporary table h108_context(
  admin_id text,auth_id uuid,product_id text,formula_id bigint,pack_id bigint,
  asset_id bigint,logo_asset_id bigint,plan_id bigint,authorization_id bigint,job_id bigint,
  jobs_before bigint,runs_before bigint
) on commit drop;
grant select,update on h108_context to authenticated,service_role;

do $$
declare
  v_actor public.users%rowtype; v_product text; v_campaign text; v_creative text;
  v_formula bigint; v_pack bigint; v_asset bigint; v_logo bigint; v_suffix text:=pg_backend_pid()::text;
  v_formula_key text;
  v_formula_snapshot jsonb; v_formula_fp text; v_path text;
begin
  select * into v_actor from public.users where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol])) order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor.id is not null and v_product is not null,
    'H108 necesita Administrador y producto activo.';
  update public.agency_settings set paused=false,
    campaign_budget_limit=greatest(campaign_budget_limit,50000) where id;
  update public.agency_integrations set status='Activa',secret_configured=true,
    last_heartbeat_at=clock_timestamp(),capabilities='["Imagen","Video","Edición"]'::jsonb
    where provider='Higgsfield';

  v_campaign:='CMP-H108-'||v_suffix; v_creative:='CRE-H108-'||v_suffix;
  v_formula_key:='h108-antojo-'||v_suffix;
  insert into public.campaigns(id,nombre,canal,objetivo,presupuesto,estado,external_platform,external_id)
  values(v_campaign,'H108 generación protegida','Instagram','Ventas',50000,'Planeada','meta','meta-h108-'||v_suffix);
  insert into public.creatives(id,campaign_id,titulo,canal,formato,estado,producto_foco_id,figura,sabor,external_id)
  values(v_creative,v_campaign,'H108 creativo fuente','Instagram','Reel','Aprobado',v_product,
    'Momo','Mango biche','ad-h108-'||v_suffix);
  v_formula_snapshot:=jsonb_build_object(
    'hook','El antojo aparece en el primer segundo',
    'narrative_structure','Producto, textura, reacción y cierre',
    'humanization','Movimiento natural y manos reales',
    'proof','Producto real visible sin deformación',
    'offer','Sin oferta inventada','cta','Elegí tu sabor',
    'visual_style','Cálido, profundo y apetitoso',
    'camera_pattern','Acercamiento natural con parallax contenido');
  v_formula_fp:=public._agency_creative_intelligence_fingerprint(jsonb_build_object(
    'formula_key',v_formula_key,'name','H108 antojo real','mode','Pauta',
    'source_creative_id',v_creative,'source_creative_version_id',null,
    'retention_script_id',null,'formula_snapshot',v_formula_snapshot));
  insert into public.agency_creative_formulas(
    proposal_key,formula_key,version,name,mode,status,source_creative_id,campaign_id,
    product_id,channel,objective,figure,flavor,formula_snapshot,formula_fingerprint,
    source_kind,prepared_by,reviewed_by,reviewed_at,review_note)
  values('h108-approved-'||v_suffix,v_formula_key,1,'H108 antojo real','Pauta','Aprobada',
    v_creative,v_campaign,v_product,'Instagram','Ventas','Momo','Mango biche',v_formula_snapshot,
    v_formula_fp,'Humano',v_actor.id,v_actor.id,clock_timestamp(),'Fórmula aprobada para rollback H108.')
  returning id into v_formula;

  v_path:='test/h108-momo-'||v_suffix||'.png';
  insert into storage.objects(bucket_id,name,metadata)
  values('brand-assets',v_path,'{"mimetype":"image/png","size":4096}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,
    orientation,contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,
    content_hash,mime_type,size_bytes,tags,notes,created_by)
  values('H108 Momo frontal','Foto','MOMOS',v_product,'Momo','Mango biche','Producto','Vertical',
    false,'Propio',true,'["Instagram"]','Activo',v_path,md5(random()::text)||md5(random()::text),
    'image/png',4096,'[]','Rollback H108',v_actor.id) returning id into v_asset;
  insert into public.brand_asset_production_profiles(asset_id,component_type,view_angle,physical_state,
    interaction_type,hand_assignment,source_quality,qa_status,consent_status,canonical,created_by,updated_by)
  values(v_asset,'Producto','Frontal','Intacto','Ninguna','Ninguna','Original limpio','Aprobado',
    'No aplica',true,v_actor.id,v_actor.id);
  v_path:='test/h108-logo-'||v_suffix||'.png';
  insert into storage.objects(bucket_id,name,metadata)
  values('brand-assets',v_path,'{"mimetype":"image/png","size":4096}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,shot_type,orientation,contains_people,
    rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,
    tags,notes,created_by)
  values('H108 logo oficial','Logo','MOMOS','Marca','Cuadrado',false,'Propio',true,'[]','Activo',v_path,
    md5(random()::text)||md5(random()::text),'image/png',4096,'[]','Rollback H108',v_actor.id)
  returning id into v_logo;
  insert into public.brand_production_packs(name,purpose,status,product_id,figure,channel,target_format,
    requirements,fingerprint,created_by,reviewed_by,reviewed_at,review_note)
  values('H108 paquete '||v_suffix,'Referencias exactas para autorizar generación H108.','Aprobado',
    v_product,'Momo','Instagram','Reel 9:16','{"required_roles":["Producto"]}',
    md5('h108-pack-'||v_suffix),v_actor.id,v_actor.id,clock_timestamp(),'Derechos y referencia revisados.')
  returning id into v_pack;
  insert into public.brand_production_pack_assets(pack_id,asset_id,role,sequence,required,added_by)
  values(v_pack,v_asset,'Producto',1,true,v_actor.id);
  insert into h108_context values(v_actor.id,v_actor.auth_id,v_product,v_formula,v_pack,v_asset,v_logo,
    null,null,null,
    (select count(*) from public.creative_generation_jobs),
    (select count(*) from public.creative_connector_runs));
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h108_context),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_kit bigint; v_item record;
begin
  v_kit:=(public.preparar_kit_identidad_marca(
    'Kit íntegro y temporal para certificar H108 con rollback total.') ->> 'kit_id')::bigint;
  for v_item in select role from public.agency_brand_kit_assets where kit_id=v_kit loop
    perform public.desvincular_logo_kit_identidad(v_kit,v_item.role);
  end loop;
  perform public.vincular_logo_kit_identidad(v_kit,(select logo_asset_id from h108_context),
    'principal','Cualquiera','{}'::text[],48,0.25);
  perform public.activar_kit_identidad_marca(v_kit,
    'Logo, colores, derechos y perfil revisados para la prueba H108.');
end $$;

do $$
declare v_result jsonb; v_plan bigint;
begin
  v_result:=public.preparar_plan_produccion_formula_v1(jsonb_build_object(
    'plan_key','h108-plan-'||pg_backend_pid(),'formula_id',(select formula_id from h108_context),
    'production_pack_id',(select pack_id from h108_context),'provider','Higgsfield',
    'operation','Generar video','model_label','Seedance 2.0','duration_seconds',8,
    'output_count',1,'estimated_cost_cop',5000,'max_cost_cop',8000));
  v_plan:=(v_result->>'plan_id')::bigint;
  perform public.revisar_plan_produccion_formula_v1(v_plan,'En revisión',
    'Fórmula, referencias, motor y costo entran a revisión humana.');
  perform public.revisar_plan_produccion_formula_v1(v_plan,'Aprobado',
    'Fórmula, referencias, canal, formato, motor y costo fueron aprobados.');
  update h108_context set plan_id=v_plan;
end $$;

reset role;
update public.agency_integrations set last_heartbeat_at=clock_timestamp()-interval '31 minutes'
where provider='Higgsfield';
set local role authenticated;

do $$
declare v_failed boolean:=false;
begin
  begin
    perform public.autorizar_generacion_desde_preflight_v1(jsonb_build_object(
      'authorization_key','h108-auth-'||pg_backend_pid(),'plan_id',(select plan_id from h108_context),
      'decision_note','Autorizo la generación controlada de esta pieza sin publicación automática.',
      'acknowledge_external_generation',true));
  exception when others then v_failed:=true; end;
  assert v_failed,'H108 autorizó un conector con heartbeat vencido.';
end $$;

reset role;
update public.agency_integrations set last_heartbeat_at=clock_timestamp() where provider='Higgsfield';
set local role authenticated;

do $$
declare
  v_payload jsonb; v_result jsonb; v_duplicate jsonb;
  v_auth bigint; v_job bigint; v_failed boolean:=false;
begin
  v_payload:=jsonb_build_object('authorization_key','h108-auth-'||pg_backend_pid(),
    'plan_id',(select plan_id from h108_context),
    'decision_note','Autorizo la generación controlada de esta pieza sin publicación automática.',
    'acknowledge_external_generation',true);
  begin
    perform public.autorizar_generacion_desde_preflight_v1(v_payload-'acknowledge_external_generation');
  exception when others then v_failed:=true; end;
  assert v_failed,'H108 aceptó una autorización sin confirmación externa explícita.';

  v_result:=public.autorizar_generacion_desde_preflight_v1(v_payload);
  v_auth:=(v_result->>'authorization_id')::bigint; v_job:=(v_result->>'job_id')::bigint;
  assert v_auth is not null and v_job is not null and v_result->>'status'='Autorizado'
    and (v_result->>'job_created')::boolean and (v_result->>'job_authorized')::boolean
    and (v_result->>'worker_may_claim')::boolean
    and not (v_result->>'credits_consumed')::boolean
    and (v_result->>'external_generation_authorized')::boolean
    and not (v_result->>'publication_allowed')::boolean,
    'H108 no distinguió autorización externa de consumo o publicación.';
  v_duplicate:=public.autorizar_generacion_desde_preflight_v1(v_payload);
  assert (v_duplicate->>'duplicate')::boolean and (v_duplicate->>'job_id')::bigint=v_job,
    'H108 duplicó el trabajo durante un replay exacto.';
  v_failed:=false;
  begin
    perform public.autorizar_generacion_desde_preflight_v1(jsonb_set(v_payload,'{decision_note}',
      '"Esta nota distinta intenta reutilizar una clave ya consumida y debe fallar."'::jsonb));
  exception when others then v_failed:=true; end;
  assert v_failed,'H108 aceptó una colisión idempotente.';
  update h108_context set authorization_id=v_auth,job_id=v_job;
end $$;

reset role;
set local role service_role;

do $$
declare v_snapshot jsonb; v_log jsonb;
begin
  v_snapshot:=public.momos_generation_authorizations_v1();
  assert length(v_snapshot->>'fingerprint')=64
    and v_snapshot#>>'{snapshot,schema_version}'='momos-generation-authorizations/v1'
    and (v_snapshot#>>'{snapshot,human_authorization_required}')::boolean
    and not (v_snapshot#>>'{snapshot,credits_consumed_by_authorization}')::boolean
    and (v_snapshot#>>'{snapshot,external_generation_authorized}')::boolean
    and not (v_snapshot#>>'{snapshot,publication_allowed}')::boolean
    and not (v_snapshot#>>'{snapshot,privacy,contains_customer_pii}')::boolean
    and v_snapshot::text !~* '"storage_path"\s*:|customer_phone|"email"\s*:|direccion|access[_-]?token|service[_-]?role',
    'H108 perdió huella, privacidad o separación de publicación.';
  assert exists(select 1 from jsonb_array_elements(v_snapshot#>'{snapshot,authorizations}') x
    where (x->>'job_id')::bigint=(select job_id from h108_context)
      and x->>'job_status'='Autorizado'
      and ((not exists(select 1 from public.momos_ops_migrations
              where id='20260722_109_piloto_generacion_controlado')
            and (x->>'worker_may_claim')::boolean)
        or (exists(select 1 from public.momos_ops_migrations
              where id='20260722_109_piloto_generacion_controlado')
            and not (x->>'worker_may_claim')::boolean))),
    'H108 no expuso correctamente el trabajo autorizado y su gate H109.';
  v_log:=public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key','h108-log-'||pg_backend_pid(),'tool_name','momos_generation_authorizations',
    'mode','Lectura','status','OK','worker_id','h108-worker','subject_ref','generation-authorizations',
    'input_fingerprint',md5('in'),'output_fingerprint',md5('out'),
    'details','{"publication_allowed":false,"credits_consumed":false}'::jsonb));
  assert coalesce((v_log->>'ok')::boolean,false),'H108 no auditó la lectura MCP.';
end $$;

reset role;
do $$
declare v_failed boolean:=false;
begin
  assert (select count(*) from public.creative_generation_jobs)=(select jobs_before+1 from h108_context),
    'H108 creó más o menos de un trabajo.';
  assert (select count(*) from public.creative_connector_runs)=(select runs_before from h108_context),
    'H108 ejecutó o arrendó el worker durante la autorización.';
  assert exists(select 1 from public.creative_generation_jobs j join h108_context c on c.job_id=j.id
    where j.status='Autorizado' and j.max_cost_cop=8000 and j.provider='Higgsfield'
      and j.output_spec->>'formula_production_plan_id'=c.plan_id::text
      and j.output_spec->>'publication_allowed'='false'),
    'H108 no selló el trabajo, costo o bloqueo de publicación.';
  begin
    update public.agency_formula_generation_authorizations set max_cost_cop=max_cost_cop+1
    where id=(select authorization_id from h108_context);
  exception when others then v_failed:=true; end;
  assert v_failed,'H108 permitió reescribir una autorización.';
  v_failed:=false;
  begin delete from public.agency_formula_generation_authorizations
    where id=(select authorization_id from h108_context);
  exception when others then v_failed:=true; end;
  assert v_failed,'H108 permitió eliminar evidencia de autorización.';
end $$;

select 'TESTS_OK — H108 preflight→job atómico/idempotencia/marca/conector/costo/gate H109/no crédito/no publicación/MCP/RBAC PASS, rollback total' as resultado;
rollback;
