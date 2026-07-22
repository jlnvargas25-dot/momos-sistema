-- MOMOS OPS · H106 · Biblioteca visual ampliada. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h106_visual_library'));

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260722_106_biblioteca_visual_ampliada'),
    'H106 requiere aplicar biblioteca-visual-ampliada-v1.sql.';
  assert public.biblioteca_visual_ampliada_disponible()
    and to_regprocedure('public.momos_visual_library_v1(jsonb)') is not null,
    'H106 no instaló la sonda o la proyección visual.';
  assert has_function_privilege('service_role','public.momos_visual_library_v1(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.momos_visual_library_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_visual_library_v1(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public._estado_activo_visual_v1(bigint,text,text)','EXECUTE'),
    'H106 perdió el aislamiento MCP o expuso helpers.';
  assert not has_table_privilege('authenticated','public.brand_asset_production_profiles','UPDATE'),
    'H106 permite fabricar consentimiento por tabla.';
end $$;

create temporary table h106_context(admin_id text,auth_id uuid,product_id text,front_id bigint,back_id bigint,human_id bigint,ghost_id bigint) on commit drop;
grant select on h106_context to authenticated,service_role;

do $$
declare
  v_actor public.users%rowtype; v_product text; v_front bigint; v_back bigint; v_human bigint; v_ghost bigint;
  v_suffix text:=pg_backend_pid()::text; v_front_path text; v_back_path text; v_human_path text;
begin
  select * into v_actor from public.users where activo and auth_id is not null
    and ('Administrador'=any(coalesce(roles,array[rol])) or 'Marketing/CRM'=any(coalesce(roles,array[rol])))
    order by case when 'Administrador'=any(coalesce(roles,array[rol])) then 0 else 1 end,id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor.id is not null and v_product is not null,'H106 necesita actor y producto.';
  v_front_path:='test/h106-front-'||v_suffix||'.png';
  v_back_path:='test/h106-back-'||v_suffix||'.png';
  v_human_path:='test/h106-hands-'||v_suffix||'.png';
  insert into storage.objects(bucket_id,name,metadata) values
    ('brand-assets',v_front_path,'{"mimetype":"image/png","size":2048}'::jsonb),
    ('brand-assets',v_back_path,'{"mimetype":"image/png","size":2048}'::jsonb),
    ('brand-assets',v_human_path,'{"mimetype":"image/png","size":2048}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,tags,notes,created_by)
  values('H106 Momo frontal','Foto','MOMOS',v_product,'Momo','Mango biche','Producto','Vertical',false,'Propio',true,
      '["Instagram","TikTok"]','Activo',v_front_path,md5(random()::text)||md5(random()::text),'image/png',2048,'[]','Rollback H106',v_actor.id)
  returning id into v_front;
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,tags,notes,created_by)
  values('H106 Momo trasera','Foto','MOMOS',v_product,'Momo','Mango biche','Producto','Vertical',false,'Propio',true,
      '["Instagram","TikTok"]','Activo',v_back_path,md5(random()::text)||md5(random()::text),'image/png',2048,'[]','Rollback H106',v_actor.id)
  returning id into v_back;
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,tags,notes,created_by)
  values('H106 manos UGC','Foto','MOMOS',v_product,'Momo','Mango biche','Manos','Vertical',true,'Autorizado',true,
      '["Instagram","TikTok"]','Activo',v_human_path,md5(random()::text)||md5(random()::text),'image/png',2048,'[]','Rollback H106',v_actor.id)
  returning id into v_human;
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,tags,notes,created_by)
  values('H106 objeto ausente','Foto','MOMOS',v_product,'Momo','Mango biche','Producto','Vertical',false,'Propio',true,
      '["Instagram"]','Activo','test/h106-missing-'||v_suffix||'.png',md5(random()::text)||md5(random()::text),'image/png',2048,'[]','Rollback H106',v_actor.id)
  returning id into v_ghost;
  insert into h106_context values(v_actor.id,v_actor.auth_id,v_product,v_front,v_back,v_human,v_ghost);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_id::text from h106_context),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_failed boolean:=false; v_base jsonb;
begin
  v_base:=jsonb_build_object('component_type','Producto','physical_state','Intacto','interaction_type','Ninguna',
    'hand_assignment','Ninguna','source_quality','Original limpio','qa_status','Aprobado','consent_status','No aplica',
    'visual_set_key','momo-mango-biche','variant_label','intacto');
  perform public.clasificar_activo_produccion((select front_id from h106_context),v_base||jsonb_build_object('view_angle','Frontal'));
  perform public.clasificar_activo_produccion((select back_id from h106_context),v_base||jsonb_build_object('view_angle','Trasera','variant_label','bolsa'));
  assert exists(select 1 from public.brand_asset_production_profiles where visual_set_key='momo-mango-biche'
    group by visual_set_key having count(*)=2 and count(distinct view_angle)=2),
    'H106 no agrupó las multivistas del mismo sujeto.';
  perform public.clasificar_activo_produccion((select ghost_id from h106_context),v_base||jsonb_build_object(
    'view_angle','Superior','variant_label','objeto-ausente'));

  begin
    perform public.clasificar_activo_produccion((select human_id from h106_context),jsonb_build_object(
      'component_type','Manos','view_angle','POV','qa_status','Aprobado','consent_status','Autorizado',
      'identity_visibility','Manos sin rostro','consent_ai_use',true,'consent_channels',jsonb_build_array('TikTok'),
      'consent_purposes','[]'::jsonb,'visual_set_key','ugc-manos-max'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H106 aprobó una persona sin finalidad de consentimiento.';

  v_failed:=false;
  begin
    perform public.clasificar_activo_produccion((select human_id from h106_context),jsonb_build_object(
      'component_type','Manos','view_angle','POV','qa_status','Aprobado','consent_status','Autorizado',
      'identity_visibility','Manos sin rostro','consent_ai_use',true,'consent_channels',jsonb_build_array('TikTok'),
      'consent_purposes',jsonb_build_array('Generación'),'consent_expires_at',(current_date-1)::text,'visual_set_key','ugc-manos-max'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H106 aprobó un consentimiento ya vencido.';

  perform public.clasificar_activo_produccion((select human_id from h106_context),jsonb_build_object(
    'component_type','Manos','view_angle','POV','physical_state','En mano','interaction_type','Sacar',
    'hand_assignment','Derecha','source_quality','Original limpio','qa_status','Aprobado','consent_status','Autorizado',
    'identity_visibility','Manos sin rostro','consent_ai_use',true,'consent_channels',jsonb_build_array('TikTok'),
    'consent_purposes',jsonb_build_array('Generación'),'consent_expires_at',(current_date+30)::text,
    'visual_set_key','ugc-manos-max','variant_label','sacar-de-bolsa'));

  v_failed:=false;
  begin perform public.clasificar_activo_produccion((select front_id from h106_context),v_base||jsonb_build_object('sql','select *'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H106 aceptó campos abiertos en la ficha.';
end $$;

reset role;
set local role service_role;

do $$
declare
  v_snapshot jsonb; v_failed boolean:=false; v_log_formula jsonb; v_log_community jsonb;
  v_claim jsonb; v_fingerprint text;
begin
  v_snapshot:=public.momos_visual_library_v1(jsonb_build_object('component_type','Producto','product_id',(select product_id from h106_context),
    'figure','Momo','flavor','Mango biche','channel','Instagram','purpose','Referencia',
    'required_views',jsonb_build_array('Frontal','Trasera'),'limit',20));
  assert v_snapshot->>'schema_version'='momos-visual-library/v1'
    and (v_snapshot->>'set_count')::integer=1 and (v_snapshot->>'asset_count')::integer=2
    and (v_snapshot#>>'{sets,0,coverage_complete}')::boolean,
    'H106 no devolvió cobertura frente/trasera exacta.';
  assert v_snapshot::text !~* '"(storage[_-]?path|created[_-]?by|consent[_-]?evidence|email|telefono|direccion)"[[:space:]]*:'
    and (v_snapshot#>>'{privacy,contains_secrets}')::boolean is false
    and not (v_snapshot->>'external_execution_allowed')::boolean,
    'H106 expuso rutas, PII, evidencia legal o ejecución.';

  v_snapshot:=public.momos_visual_library_v1(jsonb_build_object('component_type','Manos','channel','Instagram','purpose','Generación','limit',20));
  assert (v_snapshot->>'asset_count')::integer=0,'H106 cruzó consentimiento TikTok hacia Instagram.';
  v_snapshot:=public.momos_visual_library_v1(jsonb_build_object('component_type','Manos','channel','TikTok','purpose','Generación','limit',20));
  assert (v_snapshot->>'asset_count')::integer=1,'H106 no encontró las manos con alcance exacto.';
  v_fingerprint:=v_snapshot#>>'{sets,0,assets,0,asset_fingerprint}';
  v_claim:=public.momos_get_brand_asset_reference(jsonb_build_object(
    'request_key','h106-reference-'||pg_backend_pid(),'worker_id','h106-reference-worker',
    'asset_id',(select human_id from h106_context),'purpose','Generación','channel','TikTok',
    'expected_fingerprint',v_fingerprint,'ttl_seconds',120));
  assert v_claim->>'schema_version'='momos-brand-asset-claim/v1'
    and (v_claim#>>'{grant,purpose}')='Generación' and (v_claim#>>'{grant,channel}')='TikTok',
    'H106 no entregó la referencia humana por su alcance exacto.';

  v_log_formula:=public.registrar_acceso_mcp_agencia(jsonb_build_object('request_key','h106-log-formula-'||pg_backend_pid(),
    'tool_name','momos_propose_creative_formula','mode','Propuesta','status','OK','worker_id','h106-worker',
    'subject_ref','creative-formula:test','input_fingerprint',md5('in'),'output_fingerprint',md5('out'),'details','{"external_execution":false}'::jsonb));
  v_log_community:=public.registrar_acceso_mcp_agencia(jsonb_build_object('request_key','h106-log-community-'||pg_backend_pid(),
    'tool_name','momos_humanization_community','mode','Lectura','status','OK','worker_id','h106-worker',
    'subject_ref','humanization','input_fingerprint',md5('in2'),'output_fingerprint',md5('out2'),'details','{"external_execution":false}'::jsonb));
  assert coalesce((v_log_formula->>'ok')::boolean,false)
    and coalesce((v_log_community->>'ok')::boolean,false),
    'H106 no corrigió la auditoría de tools H103/H105.';

  v_failed:=false;
  begin perform public.momos_visual_library_v1(jsonb_build_object('channel','TikTok','purpose','Generación','customer_phone','3001234567'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H106 aceptó PII o filtros abiertos.';
end $$;

reset role;
do $$
declare v_failed boolean:=false; v_human bigint:=(select human_id from h106_context);
begin
  assert exists(select 1 from public.agency_mcp_access_log where worker_id='h106-worker' and tool_name='momos_propose_creative_formula')
    and exists(select 1 from public.agency_mcp_access_log where worker_id='h106-worker' and tool_name='momos_humanization_community'),
    'H106 did not persist the H103/H105 tool audit.';
  assert exists(select 1 from public.agency_mcp_asset_claims where worker_id='h106-reference-worker'
    and asset_id=v_human and purpose='Generación' and channel='TikTok'),
    'H106 did not persist the exact human reference scope.';

  begin
    insert into public.agency_mcp_asset_claims(request_key,worker_id,asset_id,purpose,channel,asset_fingerprint,content_hash,expires_at)
    select 'h106-denied-'||pg_backend_pid(),'h106-worker',a.id,'Generación','Instagram',public._mcp_brand_asset_fingerprint(a.id),a.content_hash,now()+interval '2 minutes'
    from public.brand_media_assets a where a.id=v_human;
  exception when others then v_failed:=true; end;
  assert v_failed,'H106 permitió conceder la referencia humana fuera del canal autorizado.';

end $$;

select 'TESTS_OK — H106 sets/multivista/variantes/consentimiento/canal/finalidad/MCP/RBAC PASS, rollback total' as resultado;
rollback;
