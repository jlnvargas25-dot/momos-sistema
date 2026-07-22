-- MOMOS OPS · H111 · Política de máster visual limpio. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h111_clean_master'));

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_111_politica_maestro_visual_limpio'),
    'H111 requiere aplicar politica-maestro-visual-limpio-v1.sql.';
  assert public.biblioteca_maestro_limpio_disponible()
    and to_regprocedure('public.estado_maestro_visual_limpio_v1(bigint)') is not null
    and exists(select 1 from pg_trigger
      where tgname='brand_clean_master_profile_guard' and not tgisinternal),
    'H111 no instaló la política o su guard.';
  assert has_function_privilege('authenticated','public.biblioteca_maestro_limpio_disponible()','EXECUTE')
    and has_function_privilege('service_role','public.biblioteca_maestro_limpio_disponible()','EXECUTE')
    and not has_function_privilege('authenticated','public.estado_maestro_visual_limpio_v1(bigint)','EXECUTE')
    and not has_function_privilege('service_role','public.estado_maestro_visual_limpio_v1(bigint)','EXECUTE'),
    'H111 perdió RBAC o expuso el clasificador interno.';
end $$;

create temporary table h111_context(
  admin_id text,auth_id uuid,product_id text,original_id bigint,clean_id bigint,orphan_id bigint
) on commit drop;
grant select on h111_context to authenticated,service_role;

do $$
declare
  v_actor public.users%rowtype; v_product text; v_original bigint; v_clean bigint; v_orphan bigint;
  v_suffix text:=pg_backend_pid()::text;
begin
  select * into v_actor from public.users where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol])) order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor.id is not null and v_product is not null,'H111 necesita Administrador y producto.';

  insert into storage.objects(bucket_id,name,metadata) values
    ('brand-assets','test/h111-frost-'||v_suffix||'.jpg','{"mimetype":"image/jpeg","size":250000}'::jsonb),
    ('brand-assets','test/h111-clean-'||v_suffix||'.jpg','{"mimetype":"image/jpeg","size":280000}'::jsonb),
    ('brand-assets','test/h111-orphan-'||v_suffix||'.jpg','{"mimetype":"image/jpeg","size":280000}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,
    size_bytes,width,height,tags,notes,created_by)
  values('H111 Max original con escarcha','Foto','MOMOS',v_product,'Max','','Producto','Vertical',false,'Propio',true,
    '["Instagram","TikTok"]','Activo','test/h111-frost-'||v_suffix||'.jpg',md5(random()::text)||md5(random()::text),
    'image/jpeg',250000,1080,1920,'[]','Rollback H111',v_actor.id) returning id into v_original;
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,
    size_bytes,width,height,tags,notes,created_by,original_asset_id)
  values('H111 Max derivado limpio','Foto','MOMOS',v_product,'Max','','Producto','Vertical',false,'Propio',true,
    '["Instagram","TikTok"]','Activo','test/h111-clean-'||v_suffix||'.jpg',md5(random()::text)||md5(random()::text),
    'image/jpeg',280000,1080,1920,'[]','Rollback H111',v_actor.id,v_original) returning id into v_clean;
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,
    size_bytes,width,height,tags,notes,created_by)
  values('H111 restaurado huérfano','Foto','MOMOS',v_product,'Max','','Producto','Vertical',false,'Propio',true,
    '["Instagram"]','Activo','test/h111-orphan-'||v_suffix||'.jpg',md5(random()::text)||md5(random()::text),
    'image/jpeg',280000,1080,1920,'[]','Rollback H111',v_actor.id) returning id into v_orphan;
  insert into h111_context values(v_actor.id,v_actor.auth_id,v_product,v_original,v_clean,v_orphan);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h111_context),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_checks jsonb:='["Enfoque y exposición","Identidad y geometría","Color y textura","Recorte y oclusiones","Logo y texto","Fondo y reflejos"]'::jsonb;
  v_base jsonb; v_result jsonb; v_model jsonb; v_state jsonb; v_failed boolean:=false;
begin
  v_base:=jsonb_build_object('component_type','Producto','view_angle','Frontal','physical_state','Intacto',
    'interaction_type','Ninguna','hand_assignment','Ninguna','qa_status','Aprobado',
    'consent_status','No aplica','visual_set_key','max-clean-master-h111','scale_reference','Cuchara MOMOS de 14 cm');
  perform public.clasificar_activo_produccion((select original_id from h111_context),
    v_base||jsonb_build_object('source_quality','Original con escarcha','variant_label','artística con escarcha','canonical',false));
  perform public.clasificar_activo_produccion((select clean_id from h111_context),
    v_base||jsonb_build_object('source_quality','Restaurado','variant_label','derivado limpio','canonical',true));

  v_result:=public.revisar_calidad_activo_visual_v1((select original_id from h111_context),jsonb_build_object(
    'issues',jsonb_build_array('Escarcha','Condensación'),'checks_completed',v_checks,
    'review_notes','Se conserva como toma artística; requiere un máster limpio para IA.'));
  assert v_result->>'status'='Variante artística'
    and (v_result#>>'{usage_readiness,digital_content,ready}')::boolean
    and not (v_result#>>'{usage_readiness,image_generation,ready}')::boolean
    and not (v_result#>>'{usage_readiness,video_generation,ready}')::boolean
    and not (v_result#>>'{usage_readiness,element,ready}')::boolean
    and v_result->>'recommended_action'='Capturar máster limpio',
    'H111 no separó contenido artístico de los usos maestros de IA.';

  v_result:=public.revisar_calidad_activo_visual_v1((select clean_id from h111_context),jsonb_build_object(
    'issues','[]'::jsonb,'checks_completed',v_checks,'review_notes','Derivado limpio verificado contra el original.'));
  v_model:=public.biblioteca_calidad_ia_read_model_v1();
  select q->'clean_master_state' into v_state from jsonb_array_elements(v_model) q
    where (q->>'asset_id')::bigint=(select clean_id from h111_context);
  assert v_result->>'status'='Aprobado'
    and (v_result#>>'{usage_readiness,video_generation,ready}')::boolean
    and (v_state->>'ready')::boolean and v_state->>'class'='Máster IA limpio'
    and (v_state->>'original_asset_id')::bigint=(select original_id from h111_context),
    'H111 no certificó el derivado limpio enlazado.';

  select q->'clean_master_state' into v_state from jsonb_array_elements(v_model) q
    where (q->>'asset_id')::bigint=(select original_id from h111_context);
  assert not (v_state->>'ready')::boolean and (v_state->>'artistic_variant')::boolean
    and v_state->>'class'='Variante artística',
    'H111 confundió la variante con escarcha con el máster limpio.';

  begin
    perform public.clasificar_activo_produccion((select original_id from h111_context),
      v_base||jsonb_build_object('source_quality','Original con escarcha','canonical',true));
  exception when others then v_failed:=true; end;
  assert v_failed,'H111 permitió declarar canónica una referencia con escarcha.';

  v_failed:=false;
  begin
    perform public.clasificar_activo_produccion((select orphan_id from h111_context),
      v_base||jsonb_build_object('source_quality','Restaurado','canonical',true));
  exception when others then v_failed:=true; end;
  assert v_failed,'H111 permitió un máster restaurado sin vínculo al original.';
end $$;

reset role;
set local role service_role;

do $$
declare v_snapshot jsonb; v_original jsonb; v_clean jsonb;
begin
  v_snapshot:=public.momos_visual_library_v1(jsonb_build_object(
    'component_type','Producto','visual_set_key','max-clean-master-h111','channel','TikTok',
    'purpose','Generación','target_use','Generación de video','required_views',jsonb_build_array('Frontal'),'limit',20));
  select a into v_original from jsonb_array_elements(v_snapshot->'sets') s,
    jsonb_array_elements(s->'assets') a where (a->>'id')::bigint=(select original_id from h111_context);
  select a into v_clean from jsonb_array_elements(v_snapshot->'sets') s,
    jsonb_array_elements(s->'assets') a where (a->>'id')::bigint=(select clean_id from h111_context);
  assert v_snapshot->>'schema_version'='momos-visual-library/v1'
    and (v_snapshot->>'quality_contract_version')::integer=2
    and (v_snapshot->>'clean_master_policy_version')::integer=1
    and v_original#>>'{clean_master,class}'='Variante artística'
    and not (v_original#>>'{clean_master,ready}')::boolean
    and v_original#>>'{production_profile,source_quality}'='Original con escarcha'
    and v_clean#>>'{clean_master,class}'='Máster IA limpio'
    and (v_clean#>>'{clean_master,ready}')::boolean,
    'H111 no entregó a Codex la separación entre variante y máster.';
  assert v_snapshot::text !~* '"(storage[_-]?path|review[_-]?notes|created[_-]?by|email|telefono|direccion)"[[:space:]]*:'
    and not (v_snapshot->>'external_execution_allowed')::boolean
    and not (v_snapshot->>'credits_consumed')::boolean,
    'H111 expuso rutas, notas, PII o capacidad de ejecución.';
end $$;

reset role;
select 'TESTS_OK — H111 original preservado/escarcha artística/máster limpio/linaje/RBAC/MCP PASS, rollback total' as resultado;
rollback;
