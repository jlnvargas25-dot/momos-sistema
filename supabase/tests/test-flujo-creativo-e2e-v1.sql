-- MOMOS OPS · prueba adversarial del flujo creativo E2E. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_50_flujo_creativo_e2e'), 'Falta aplicar la migración 50.';
  assert public.flujo_creativo_e2e_disponible(), 'La sonda del flujo creativo no responde.';
  assert to_regclass('public.agency_master_releases') is not null, 'Falta el relevo exacto del máster.';
  assert to_regclass('public.agency_master_release_events') is not null, 'Falta la bitácora del relevo.';
  assert has_function_privilege('authenticated','public.preparar_relevo_master_creativo(bigint,text)','EXECUTE'), 'El equipo no puede preparar el relevo.';
  assert has_function_privilege('authenticated','public.vincular_publicacion_master(bigint,text)','EXECUTE'), 'El equipo no puede ligar la publicación exacta.';
  assert not has_table_privilege('authenticated','public.agency_master_releases','INSERT'), 'El navegador puede fabricar relevos.';
  assert not has_table_privilege('authenticated','public.agency_master_releases','UPDATE'), 'El navegador puede reescribir relevos.';
  assert not has_table_privilege('authenticated','public.agency_master_release_events','INSERT'), 'El navegador puede fabricar eventos.';
  assert exists(select 1 from pg_trigger where tgname='content_distributions_master_lineage_before' and not tgisinternal), 'Distribución puede saltar el máster exacto.';
  assert exists(select 1 from pg_trigger where tgname='creatives_master_lineage_guard' and not tgisinternal), 'El creativo sellado admite sustitución.';
end $$;

-- La prueba crea una cadena mínima íntegra. El binding de motion se cubre en H36;
-- aquí se desactiva únicamente durante el fixture para aislar el relevo H50.
alter table public.agency_scene_routing_plans disable trigger bind_motion_to_routing;
do $$
declare v_actor public.users%rowtype; v_product text; v_decision bigint; v_room bigint; v_contract bigint; v_board bigint; v_route bigint;
  v_package bigint; v_asset bigint; v_export bigint; v_payload jsonb; v_source jsonb; v_plan jsonb;
  v_hash text:=md5(random()::text)||md5(random()::text); v_result jsonb;
begin
  select * into v_actor from public.users where auth_id is not null and activo and rol in ('Administrador','Marketing/CRM')
    order by case when rol='Administrador' then 0 else 1 end,id limit 1;
  select id into v_product from public.products where activo order by stock desc,id limit 1;
  assert v_actor.id is not null and v_product is not null, 'Falta actor o producto para la prueba H50.';
  update public.products set stock=greatest(stock,2) where id=v_product;

  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Crear contenido','TEST50 vuelo exacto','Validar el relevo sin publicar.','{"source":"test50"}'::jsonb,
    '{"proposed_budget":0}'::jsonb,'Bajo','Aprobada','humano',v_actor.id,v_actor.id,now()) returning id into v_decision;
  insert into public.agency_collaboration_rooms(room_key,title,objective,status,decision_id,context_snapshot,context_fingerprint,created_by)
  values('test50-room','TEST50 vuelo exacto','Validar un máster exacto.','Cerrada',v_decision,
    '{"schema_version":1,"objective":"Flujo E2E sin publicación"}'::jsonb,
    public._agency_mesa_fingerprint('{"schema_version":1,"objective":"Flujo E2E sin publicación"}'::jsonb),v_actor.id) returning id into v_room;

  v_payload:=jsonb_build_object('schema_version',1,'room_id',v_room,
    'facts',jsonb_build_object('product',jsonb_build_object('id',v_product)),
    'creative_direction',jsonb_build_object('concept','Antojo MOMOS verificable','channel','Instagram','content_mode','Orgánico',
      'content_goal','Construir deseo por el producto exacto','mode_primary_metric','Guardados'),
    'constraints',jsonb_build_object('human_review_required',true,'product_fidelity_required',true,
      'no_unapproved_claims',true,'paid_and_organic_separated',true));
  insert into public.agency_creative_contracts(contract_key,room_id,version,status,sealed_payload,contract_fingerprint,
    prepared_by,approved_by,approved_at,approval_note,approval_snapshot)
  values('test50-contract',v_room,1,'Aprobado',v_payload,public._agency_mesa_fingerprint(v_payload),v_actor.id,v_actor.id,now(),
    'Aprobación humana H50','{"approved":true}'::jsonb) returning id into v_contract;

  v_source:=jsonb_build_object('schema_version',1,'contract_id',v_contract,'title','TEST50 storyboard exacto');
  insert into public.agency_storyboards(storyboard_key,contract_id,version,title,status,channel,format,aspect_ratio,target_duration_sec,
    creative_brief,retention_plan,source_snapshot,source_fingerprint,estimated_cost_cop,created_by,reviewed_by,reviewed_at,review_note)
  values('test50-board',v_contract,1,'TEST50 storyboard exacto','Aprobado','Instagram','Reel','9:16',8,
    '{"hook":"Prueba primero","payoff":"Producto real","call_to_action":"Guardalo"}'::jsonb,
    '{"loops":[{"open_sec":0,"close_sec":6,"promise":"Producto real","payoff":"Textura exacta"}]}'::jsonb,
    v_source,public._agency_mesa_fingerprint(v_source),1000,v_actor.id,v_actor.id,now(),'Aprobado para relevo') returning id into v_board;

  v_plan:=jsonb_build_object('schema_version',1,'storyboard_id',v_board,'routes',jsonb_build_array(
    jsonb_build_object('shot_id',1,'shot_number',1,'provider','Kling','continuity','Producto exacto')));
  insert into public.agency_scene_routing_plans(plan_key,storyboard_id,version,status,plan_snapshot,plan_fingerprint,
    total_estimated_cost_cop,total_cost_cap_cop,prepared_by,resolved_by,resolved_at,resolution_note)
  values('test50-route',v_board,1,'Autorizado',v_plan,public._agency_mesa_fingerprint(v_plan),1,1,v_actor.id,v_actor.id,now(),
    'Ruta humana aislada para H50') returning id into v_route;

  insert into public.agency_postproduction_packages(package_key,storyboard_id,routing_plan_id,version,status,package_snapshot,
    package_fingerprint,prepared_by,reviewed_by,reviewed_at,review_note)
  values('test50-package',v_board,v_route,1,'Aprobado','{"schema_version":1,"selections":[{"review_id":"test50"}]}'::jsonb,
    md5('test50-package'),v_actor.id,v_actor.id,now(),'Corte aprobado H50') returning id into v_package;

  insert into public.brand_media_assets(name,media_type,source,product_id,orientation,rights_status,ai_use_allowed,status,
    storage_path,content_hash,mime_type,size_bytes,tags,generation_meta,created_by)
  values('TEST50 máster','Video','Generado',v_product,'Vertical','Autorizado',false,'Activo','generated/test50/master.mp4',
    v_hash,'video/mp4',4096,'["test50"]','{"provider":"postproduccion","human_review":true}'::jsonb,v_actor.id) returning id into v_asset;

  insert into public.agency_postproduction_exports(export_key,package_id,version,status,export_snapshot,export_fingerprint,
    requested_by,attempts,output_asset_id,result_snapshot,result_fingerprint,exported_at,reviewed_by,reviewed_at,review_note)
  values('test50-export',v_package,1,'Aprobada','{"schema_version":1,"container":"mp4"}'::jsonb,md5('test50-export'),
    v_actor.id,1,v_asset,jsonb_build_object('content_hash',v_hash,'probe',jsonb_build_object('container','mp4')),
    md5('test50-result'),now(),v_actor.id,now(),'Máster aprobado H50') returning id into v_export;

  insert into public.creatives(id,titulo,canal,formato,producto_foco_id,hook,copy,guion,estado,responsable,asset_url,notas)
  values('CRE-H50-EXACT','TEST50 exacto','Instagram','Reel',v_product,'Prueba primero','Producto MOMOS real','Hook, prueba y payoff',
    'Aprobado','Marketing','','Relevo exacto H50'),
    ('CRE-H50-WRONG','TEST50 ajeno','Instagram','Reel',null,'Otro producto','No corresponde','Cadena ajena',
    'Aprobado','Marketing','','Intento de cruce H50');

  insert into public.content_posts(id,fecha,hora,canal,creative_id,titulo,copy_final,estado)
  values('CAL-H50-EXACT',current_date,'12:00','Instagram','CRE-H50-EXACT','TEST50 publicación exacta','Copy final verificable','Programado'),
    ('CAL-H50-WRONG',current_date,'12:05','Instagram','CRE-H50-WRONG','TEST50 publicación ajena','Copy ajeno','Programado');

  perform public._agency_brand_record_gate('Contrato',v_contract::text,v_payload,v_actor.id);
  perform public._agency_brand_record_gate('Storyboard',v_board::text,v_source,v_actor.id,'Contrato',v_contract::text);
  perform public._agency_brand_record_gate('Máster',v_export::text,
    jsonb_build_object('export_id',v_export,'output_asset_id',v_asset,'content_hash',v_hash,'publication_authorized',false),v_actor.id);
  perform set_config('momos.test50_auth',v_actor.auth_id::text,true);
  perform set_config('momos.test50_export',v_export::text,true);
  perform set_config('momos.test50_contract',v_contract::text,true);
  perform set_config('momos.test50_product',v_product,true);
  perform set_config('momos.test50_posts_before',(select count(*)::text from public.content_posts where estado='Publicado'),true);
end $$;
alter table public.agency_scene_routing_plans enable trigger bind_motion_to_routing;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.test50_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_failed boolean:=false; v_result jsonb; v_release bigint; v_checklist jsonb;
begin
  begin perform public.preparar_relevo_master_creativo(current_setting('momos.test50_export')::bigint,'CRE-H50-WRONG');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Un creativo de otro producto recibió el máster.';

  v_result:=public.preparar_relevo_master_creativo(current_setting('momos.test50_export')::bigint,'CRE-H50-EXACT');
  v_release:=(v_result->>'release_id')::bigint;
  assert (v_result->>'ok')::boolean and not (v_result->>'duplicate')::boolean, 'No creó el relevo exacto.';
  assert exists(select 1 from public.agency_master_releases where id=v_release and content_mode='Orgánico' and status='Máster vinculado'),
    'El relevo perdió modo o estado.';
  perform set_config('momos.test50_release',v_release::text,true);

  v_checklist:='{"archivo_final":true,"formato_canal":true,"copy_revisado":true,"cta_enlace":true,"audio_derechos":true,
    "identidad_marca":true,"producto_fiel":true,"claims_verificados":true,"logo_color_tipografia":true,
    "objetivo_del_modo":true,"cta_del_modo":true,"medicion_del_modo":true,"separacion_pauta_organico":true}'::jsonb;
  perform public.guardar_preparacion_distribucion('CAL-H50-EXACT',v_checklist,'Preparación exacta H50');
  v_failed:=false;
  begin perform public.aprobar_distribucion('CAL-H50-EXACT'); exception when others then v_failed:=true; end;
  assert v_failed, 'Distribución aprobó sin ligar la publicación al máster.';

  v_failed:=false;
  begin perform public.vincular_publicacion_master(v_release,'CAL-H50-WRONG'); exception when others then v_failed:=true; end;
  assert v_failed, 'El relevo aceptó una publicación con otro creativo.';
  perform public.vincular_publicacion_master(v_release,'CAL-H50-EXACT');
  perform public.aprobar_distribucion('CAL-H50-EXACT');
  assert exists(select 1 from public.agency_master_releases where id=v_release and status='Distribución aprobada' and distribution_id is not null),
    'La aprobación no cerró el relevo exacto.';
  assert exists(select 1 from public.agency_master_release_events where release_id=v_release and event_type='Distribución aprobada'),
    'No registró el evento inmutable de aprobación.';
end $$;
reset role;

do $$
declare v_failed boolean:=false; v_release bigint:=current_setting('momos.test50_release')::bigint;
begin
  begin update public.creatives set copy='Intento de sustitución' where id='CRE-H50-EXACT'; exception when others then v_failed:=true; end;
  assert v_failed, 'El creativo ligado al máster se pudo sustituir.';
  v_failed:=false;
  begin update public.agency_master_releases set content_mode='Pauta' where id=v_release; exception when others then v_failed:=true; end;
  assert v_failed, 'El relevo Orgánico pudo convertirse en Pauta.';
  v_failed:=false;
  begin delete from public.agency_master_release_events where release_id=v_release; exception when others then v_failed:=true; end;
  assert v_failed, 'La evidencia del relevo se pudo borrar.';
  assert (select count(*) from public.content_posts where estado='Publicado')=current_setting('momos.test50_posts_before')::bigint,
    'H50 publicó contenido durante la prueba.';
end $$;

select 'TESTS_OK — flujo creativo E2E/máster exacto/Pauta-Orgánico/inmutabilidad/no publicación/RBAC PASS, rollback total' as resultado;
rollback;
