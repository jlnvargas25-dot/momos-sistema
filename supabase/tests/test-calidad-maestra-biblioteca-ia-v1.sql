-- MOMOS OPS · H110 · Calidad maestra de Biblioteca para IA. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h110_visual_quality'));

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_110_calidad_maestra_biblioteca_ia'),
    'H110 requiere aplicar calidad-maestra-biblioteca-ia-v1.sql.';
  assert public.biblioteca_calidad_ia_disponible()
    and to_regclass('public.brand_visual_quality_assessments') is not null
    and to_regprocedure('public.revisar_calidad_activo_visual_v1(bigint,jsonb)') is not null,
    'H110 no instaló la revisión maestra.';
  assert has_function_privilege('authenticated','public.revisar_calidad_activo_visual_v1(bigint,jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.revisar_calidad_activo_visual_v1(bigint,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.estado_calidad_set_visual_v1(text,text)','EXECUTE')
    and not has_function_privilege('service_role','public.estado_calidad_paquete_visual_v1(bigint,text)','EXECUTE')
    and not has_table_privilege('authenticated','public.brand_visual_quality_assessments','INSERT')
    and not has_table_privilege('authenticated','public.brand_visual_quality_assessments','SELECT')
    and not has_table_privilege('service_role','public.brand_visual_quality_assessments','SELECT'),
    'H110 perdió RBAC o permite fabricar certificaciones.';
  assert exists(select 1 from pg_trigger where tgname='agency_formula_plan_visual_quality_guard' and not tgisinternal)
    and exists(select 1 from pg_trigger where tgname='agency_formula_authorization_visual_quality_guard' and not tgisinternal)
    and exists(select 1 from pg_trigger where tgname='creative_job_visual_quality_guard' and not tgisinternal),
    'H110 no cerró preflight, autorización y claim del worker.';
end $$;

create temporary table h110_context(
  admin_id text,auth_id uuid,product_id text,front_id bigint,quarter_id bigint,frost_id bigint,pack_id bigint
) on commit drop;
grant select,update on h110_context to authenticated,service_role;

do $$
declare
  v_actor public.users%rowtype; v_product text; v_front bigint; v_quarter bigint; v_frost bigint;
  v_suffix text:=pg_backend_pid()::text;
begin
  select * into v_actor from public.users where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol])) order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor.id is not null and v_product is not null,'H110 necesita Administrador y producto.';
  insert into storage.objects(bucket_id,name,metadata) values
    ('brand-assets','test/h110-front-'||v_suffix||'.jpg','{"mimetype":"image/jpeg","size":250000}'::jsonb),
    ('brand-assets','test/h110-quarter-'||v_suffix||'.jpg','{"mimetype":"image/jpeg","size":250000}'::jsonb),
    ('brand-assets','test/h110-frost-'||v_suffix||'.jpg','{"mimetype":"image/jpeg","size":66009}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,
    size_bytes,width,height,tags,notes,created_by)
  values('H110 Max frontal limpio','Foto','MOMOS',v_product,'Max','','Producto','Vertical',false,'Propio',true,
    '["Instagram","TikTok"]','Activo','test/h110-front-'||v_suffix||'.jpg',md5(random()::text)||md5(random()::text),
    'image/jpeg',250000,1080,1920,'[]','Rollback H110',v_actor.id) returning id into v_front;
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,
    size_bytes,width,height,tags,notes,created_by)
  values('H110 Max tres cuartos limpio','Foto','MOMOS',v_product,'Max','','Producto','Vertical',false,'Propio',true,
    '["Instagram","TikTok"]','Activo','test/h110-quarter-'||v_suffix||'.jpg',md5(random()::text)||md5(random()::text),
    'image/jpeg',250000,1080,1920,'[]','Rollback H110',v_actor.id) returning id into v_quarter;
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,
    size_bytes,width,height,tags,notes,created_by)
  values('H110 Max con escarcha','Foto','MOMOS',v_product,'Max','','Producto','Vertical',false,'Propio',true,
    '["Instagram","TikTok"]','Activo','test/h110-frost-'||v_suffix||'.jpg',md5(random()::text)||md5(random()::text),
    'image/jpeg',66009,null,null,'[]','Rollback H110',v_actor.id) returning id into v_frost;
  insert into h110_context values(v_actor.id,v_actor.auth_id,v_product,v_front,v_quarter,v_frost,null);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h110_context),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_checks jsonb:='["Enfoque y exposición","Identidad y geometría","Color y textura","Recorte y oclusiones","Logo y texto","Fondo y reflejos"]'::jsonb;
  v_base jsonb; v_result jsonb; v_failed boolean:=false; v_pack jsonb;
begin
  v_base:=jsonb_build_object('component_type','Producto','physical_state','Intacto',
    'interaction_type','Ninguna','hand_assignment','Ninguna','source_quality','Original limpio',
    'qa_status','Aprobado','consent_status','No aplica','visual_set_key','max-master-h110',
    'variant_label','base','scale_reference','Cuchara MOMOS de 14 cm','canonical',true);
  perform public.clasificar_activo_produccion((select front_id from h110_context),
    v_base||jsonb_build_object('view_angle','Frontal'));
  perform public.clasificar_activo_produccion((select quarter_id from h110_context),
    v_base||jsonb_build_object('view_angle','Tres cuartos'));
  perform public.clasificar_activo_produccion((select frost_id from h110_context),
    (v_base-'visual_set_key')||jsonb_build_object('view_angle','Frontal',
      'source_quality','Original con escarcha','canonical',false));

  v_result:=public.revisar_calidad_activo_visual_v1((select frost_id from h110_context),jsonb_build_object(
    'issues',jsonb_build_array('Escarcha','Compresión visible'),'checks_completed',v_checks,
    'review_notes','La escarcha tapa textura y geometría; se necesita una nueva toma limpia.'));
  assert (
      (not exists(select 1 from public.momos_ops_migrations where id='20260722_111_politica_maestro_visual_limpio')
        and v_result->>'status'='Requiere nueva toma' and v_result->>'recommended_action'='Nueva toma')
      or
      (exists(select 1 from public.momos_ops_migrations where id='20260722_111_politica_maestro_visual_limpio')
        and v_result->>'status' in ('Variante artística','Requiere mejora')
        and v_result->>'recommended_action' in ('Capturar máster limpio','Registrar dimensiones'))
    ) and not (v_result#>>'{usage_readiness,video_generation,ready}')::boolean,
    'H110 aprobó la referencia defectuosa de Max.';

  v_result:=public.revisar_calidad_activo_visual_v1((select front_id from h110_context),jsonb_build_object(
    'issues','[]'::jsonb,'checks_completed',v_checks,'review_notes','Frontal limpio verificado.'));
  assert v_result->>'status'='Aprobado'
    and (v_result#>>'{usage_readiness,video_generation,ready}')::boolean,
    'H110 no aprobó el frontal Full HD limpio.';
  perform public.revisar_calidad_activo_visual_v1((select quarter_id from h110_context),jsonb_build_object(
    'issues','[]'::jsonb,'checks_completed',v_checks,'review_notes','Vista tres cuartos limpia verificada.'));

  v_pack:=public.crear_paquete_produccion(jsonb_build_object(
    'name','H110 Max video master','purpose','Probar referencia maestra de Max en video',
    'product_id',(select product_id from h110_context),'figure','Max','channel','TikTok',
    'target_format','TikTok 9:16','requirements',jsonb_build_object('required_roles',jsonb_build_array('Producto')),
    'members',jsonb_build_array(
      jsonb_build_object('asset_id',(select front_id from h110_context),'role','Producto','sequence',1,'required',true),
      jsonb_build_object('asset_id',(select quarter_id from h110_context),'role','Continuidad','sequence',2,'required',true))));
  update h110_context set pack_id=(v_pack->>'pack_id')::bigint;

  begin
    insert into public.brand_visual_quality_assessments(asset_id,version,status,issues,checks_completed,
      technical_snapshot,usage_readiness,recommended_action,source_fingerprint,assessment_fingerprint,assessed_by)
    values((select front_id from h110_context),99,'Aprobado','[]','[]','{}','{}','Ninguna',md5('x'),md5('y'),(select admin_id from h110_context));
  exception when others then v_failed:=true; end;
  assert v_failed,'H110 permite fabricar una certificación por INSERT directo.';

  v_failed:=false;
  begin perform public.revisar_calidad_activo_visual_v1((select front_id from h110_context),
    jsonb_build_object('issues',jsonb_build_array('Campo inventado'),'checks_completed',v_checks,'review_notes','Intento inválido.'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H110 aceptó una taxonomía abierta de defectos.';
end $$;

reset role;

do $$
declare v_failed boolean:=false;
begin
  assert (public.estado_calidad_set_visual_v1('max-master-h110','Generación de video')->>'ready')::boolean,
    'H110 no reconoció la cobertura frontal+tres cuartos+escala.';
  assert not (public.estado_calidad_set_visual_v1('max-master-h110','Element')->>'ready')::boolean,
    'H110 declaró Element sin trasera ni detalle macro.';
  assert (public.estado_calidad_paquete_visual_v1(
      (select pack_id from h110_context),'Generación de video')->>'ready')::boolean,
    'H110 no validó el paquete limpio para video.';
  begin
    update public.brand_visual_quality_assessments set status='Rechazado'
    where asset_id=(select front_id from h110_context);
  exception when others then v_failed:=true; end;
  assert v_failed,'H110 permite reescribir la evidencia de calidad.';
  assert (select count(*) from public.brand_visual_quality_assessments
    where asset_id in ((select front_id from h110_context),(select quarter_id from h110_context),(select frost_id from h110_context)))=3,
    'H110 duplicó o perdió revisiones.';
end $$;

set local role service_role;
do $$
declare v_snapshot jsonb;
begin
  v_snapshot:=public.momos_visual_library_v1(jsonb_build_object(
    'component_type','Producto','visual_set_key','max-master-h110','channel','TikTok',
    'purpose','Generación','target_use','Generación de video','required_views',jsonb_build_array('Frontal','Tres cuartos'),'limit',20));
  assert v_snapshot->>'schema_version'='momos-visual-library/v1'
    and (v_snapshot->>'quality_contract_version')::integer=case
      when exists(select 1 from public.momos_ops_migrations where id='20260722_111_politica_maestro_visual_limpio') then 2 else 1 end
    and (v_snapshot#>>'{sets,0,ai_quality,ready}')::boolean
    and (v_snapshot#>>'{sets,0,assets,0,ai_quality,source_current}')::boolean,
    'H110 no entregó a Codex la aptitud exacta del set.';
  assert v_snapshot::text !~* '"(storage[_-]?path|review[_-]?notes|created[_-]?by|email|telefono|direccion)"[[:space:]]*:'
    and not (v_snapshot->>'external_execution_allowed')::boolean
    and not (v_snapshot->>'credits_consumed')::boolean,
    'H110 expuso rutas, notas, PII o capacidad de ejecución.';
end $$;

reset role;
select 'TESTS_OK — H110 original inmutable/calidad/dimensiones/multivista/imagen-video-Element/RBAC/MCP/gates PASS, rollback total' as resultado;
rollback;
