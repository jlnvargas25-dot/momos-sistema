-- MOMOS OPS · Prueba adversarial Calidad/Postproducción v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_33_calidad_postproduccion'), 'Falta migración 33.';
  assert public.calidad_postproduccion_disponible(), 'Falta sonda de Calidad/Postproducción.';
  assert has_function_privilege('authenticated','public.registrar_revision_calidad_escena(jsonb)','EXECUTE'), 'Falta control humano.';
  assert has_function_privilege('authenticated','public.preparar_paquete_postproduccion(jsonb)','EXECUTE'), 'Falta paquete de corte.';
  assert has_function_privilege('authenticated','public.resolver_paquete_postproduccion(bigint,text,text)','EXECUTE'), 'Falta aprobación final.';
  assert not has_function_privilege('authenticated','public.registrar_revision_calidad_agente(jsonb)','EXECUTE'), 'El navegador suplanta al agente.';
  assert has_function_privilege('service_role','public.registrar_revision_calidad_agente(jsonb)','EXECUTE'), 'El cerebro privado no puede proponer QA.';
  assert not has_table_privilege('authenticated','public.agency_scene_quality_reviews','INSERT'), 'El navegador inserta QA directo.';
  assert not has_table_privilege('authenticated','public.agency_postproduction_packages','UPDATE'), 'El navegador reescribe el corte.';
end $$;

do $$
declare v_actor public.users%rowtype; v_product text; v_decision bigint; v_room bigint; v_contract bigint; v_board bigint;
  v_shot bigint; v_plan bigint; v_job bigint; v_asset bigint; v_context jsonb; v_contract_payload jsonb;
  v_board_source jsonb; v_shot_payload jsonb; v_shot_fp text; v_route_fp text; v_plan_snapshot jsonb;
begin
  select * into v_actor from public.users where auth_id is not null and activo
    and ('Administrador'=any(coalesce(roles,array[rol])) or 'Marketing/CRM'=any(coalesce(roles,array[rol]))) order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor.id is not null and v_product is not null, 'Falta actor o producto para prueba 33.';
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Crear contenido','TEST33 QA y corte','Validar calidad sin publicar.','{"source":"test33"}'::jsonb,
    '{"proposed_budget":10000}'::jsonb,'Bajo','Aprobada','humano',v_actor.id,v_actor.id,now()) returning id into v_decision;
  v_context:=jsonb_build_object('schema_version',1,'decision_id',v_decision,'objective','Controlar una toma y preparar corte.');
  insert into public.agency_collaboration_rooms(room_key,title,objective,status,decision_id,context_snapshot,context_fingerprint,created_by)
  values('test33-quality-room','TEST33 Calidad','Validar una toma real.','Cerrada',v_decision,v_context,
    public._agency_mesa_fingerprint(v_context),v_actor.id) returning id into v_room;
  v_contract_payload:=jsonb_build_object('schema_version',1,'room_id',v_room,'creative_direction',jsonb_build_object('concept','Momo real exacto'));
  insert into public.agency_creative_contracts(contract_key,room_id,version,status,sealed_payload,contract_fingerprint,prepared_by,approved_by,approved_at,approval_note,approval_snapshot)
  values('test33-quality-contract',v_room,1,'Aprobado',v_contract_payload,public._agency_mesa_fingerprint(v_contract_payload),
    v_actor.id,v_actor.id,now(),'Aprobado para QA','{"approved":true}'::jsonb) returning id into v_contract;
  v_board_source:=jsonb_build_object('schema_version',1,'contract_id',v_contract,'title','TEST33 corte');
  insert into public.agency_storyboards(storyboard_key,contract_id,version,title,status,channel,format,aspect_ratio,target_duration_sec,
    creative_brief,retention_plan,source_snapshot,source_fingerprint,estimated_cost_cop,created_by,reviewed_by,reviewed_at,review_note)
  values('test33-quality-board',v_contract,1,'TEST33 corte','Aprobado','Instagram','Reel','9:16',3,
    '{"hook":"Abrir","payoff":"Relleno","call_to_action":"Pedí"}'::jsonb,
    '{"loops":[{"open_sec":0,"close_sec":3,"promise":"Abrir","payoff":"Relleno"}]}'::jsonb,
    v_board_source,public._agency_mesa_fingerprint(v_board_source),8000,v_actor.id,v_actor.id,now(),'Aprobado') returning id into v_board;
  v_shot_payload:='{"subject":"Momo exacto","action":"Se abre y muestra ganache","physics":"Ganache bajo gravedad","camera":"Macro con entrada y salida estables","lighting":"Ventana fija a izquierda","continuity_out":"Relleno centrado y logo intacto"}'::jsonb;
  v_shot_fp:=md5('test33-shot-'||v_board::text);
  insert into public.agency_storyboard_shots(storyboard_id,shot_number,revision,title,purpose,duration_sec,shot_payload,input_asset_ids,estimated_cost_cop,shot_fingerprint,created_by)
  values(v_board,1,1,'Payoff de relleno','Mostrar el producto real',3,v_shot_payload,'{}',8000,v_shot_fp,v_actor.id) returning id into v_shot;
  v_route_fp:=md5('test33-route-'||v_shot::text);
  v_plan_snapshot:=jsonb_build_object('schema_version',1,'storyboard_id',v_board,'storyboard_fingerprint',public._agency_mesa_fingerprint(v_board_source),
    'routes',jsonb_build_array(jsonb_build_object('shot_id',v_shot,'shot_number',1,'shot_fingerprint',v_shot_fp,
      'route_fingerprint',v_route_fp,'provider','Kling')));
  insert into public.agency_scene_routing_plans(plan_key,storyboard_id,version,status,plan_snapshot,plan_fingerprint,
    total_estimated_cost_cop,total_cost_cap_cop,prepared_by,resolved_by,resolved_at,resolution_note)
  values('test33-quality-route',v_board,1,'Autorizado',v_plan_snapshot,public._agency_mesa_fingerprint(v_plan_snapshot),8000,10000,
    v_actor.id,v_actor.id,now(),'Ruta de prueba autorizada') returning id into v_plan;
  insert into public.creative_generation_jobs(provider,operation,status,input_asset_ids,target_channel,target_format,prompt,negative_prompt,
    brand_snapshot,output_spec,max_cost_cop,generation_cost,output_review_status,created_by)
  values('Kling','Generar video','Preparado','[]','Instagram','Reel 9:16','Toma exacta MOMOS','No deformar producto','{}',
    jsonb_build_object('routing_plan_id',v_plan,'storyboard_id',v_board,'storyboard_shot_id',v_shot,'route_fingerprint',v_route_fp),
    10000,8000,'No aplica',v_actor.id) returning id into v_job;
  insert into public.brand_media_assets(name,media_type,source,product_id,orientation,rights_status,ai_use_allowed,status,
    storage_path,content_hash,mime_type,size_bytes,tags,generation_meta,created_by)
  values('TEST33 salida controlada','Video','Generado',v_product,'Vertical','Autorizado',false,'Activo',
    'generated/test33/'||v_job||'/resultado.mp4',md5(random()::text)||md5(random()::text),'video/mp4',4096,'["test33"]',
    jsonb_build_object('provider','Kling','job_id',v_job::text,'review_status','Aprobada'),v_actor.id) returning id into v_asset;
  update public.creative_generation_jobs set status='Completado',output_asset_id=v_asset,output_review_status='Aprobada',
    output_reviewed_by=v_actor.id,output_reviewed_at=now(),completed_at=now() where id=v_job;
  update public.agency_scene_routing_plans set job_ids=array[v_job] where id=v_plan;
  perform set_config('momos.quality_auth',v_actor.auth_id::text,true);
  perform set_config('momos.quality_job',v_job::text,true); perform set_config('momos.quality_asset',v_asset::text,true);
  perform set_config('momos.quality_board',v_board::text,true); perform set_config('momos.quality_shot',v_shot::text,true);
  perform set_config('momos.quality_plan',v_plan::text,true);
  perform set_config('momos.quality_posts_before',(select count(*)::text from public.content_posts),true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.quality_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_scores jsonb:='{"product_identity":2,"brand_fidelity":2,"text_logo":2,"anatomy":2,"contact_physics":2,"gravity_viscosity":0,"camera_motion":2,"light_geometry":2,"shadow_reflection":2,"temporal_stability":2,"continuity":2}'::jsonb;
  v_payload jsonb; v_failed boolean:=false; v_result jsonb; v_review bigint; v_package bigint;
begin
  v_payload:=jsonb_build_object('review_key','test33-bad-quality','job_id',current_setting('momos.quality_job')::bigint,
    'output_asset_id',current_setting('momos.quality_asset')::bigint,'decision','Aprobar','failure_type','Aprobada','scores',v_scores,
    'findings','[]'::jsonb,'continuity_observation','Salida centrada para la toma siguiente','review_note','Revisión humana');
  begin perform public.registrar_revision_calidad_escena(v_payload); exception when others then v_failed:=true; end;
  assert v_failed, 'Un cero crítico fue promediado y aprobado.';
  v_scores:=jsonb_set(v_scores,'{gravity_viscosity}','2'::jsonb);
  v_payload:=jsonb_set(v_payload,'{review_key}','"test33-good-quality"'::jsonb);
  v_payload:=jsonb_set(v_payload,'{scores}',v_scores);
  v_result:=public.registrar_revision_calidad_escena(v_payload); v_review:=(v_result->>'review_id')::bigint;
  assert v_result->>'status'='Aprobada' and (v_result->>'score_total')::integer=22 and not (v_result->>'published')::boolean,
    'La toma exacta no quedó aprobada o publicó contenido.';
  v_result:=public.preparar_paquete_postproduccion(jsonb_build_object('package_key','test33-final-cut',
    'storyboard_id',current_setting('momos.quality_board')::bigint,'routing_plan_id',current_setting('momos.quality_plan')::bigint,
    'selections',jsonb_build_array(jsonb_build_object('shot_id',current_setting('momos.quality_shot')::bigint,
      'review_id',v_review,'job_id',current_setting('momos.quality_job')::bigint,'output_asset_id',current_setting('momos.quality_asset')::bigint)),
    'audio_plan','{"mode":"original-o-licenciado","loudness_review":true}'::jsonb,
    'subtitle_plan','{"required":true,"safe_area_review":true}'::jsonb,
    'edit_decisions','{"preserve_storyboard_order":true,"color_match":true}'::jsonb,
    'export_spec','{"aspect_ratio":"9:16","channel":"Instagram","final_qc_required":true}'::jsonb));
  v_package:=(v_result->>'package_id')::bigint;
  assert v_result->>'status'='Preparado' and (v_result->>'requires_human_approval')::boolean
    and not (v_result->>'published')::boolean and not (v_result->>'distribution_authorized')::boolean,
    'Preparar corte aprobó distribución o publicación.';
  v_result:=public.resolver_paquete_postproduccion(v_package,'Aprobar','Producto, audio, subtítulos y continuidad verificados');
  assert v_result->>'status'='Aprobado' and not (v_result->>'published')::boolean, 'La aprobación final publicó contenido.';
  perform set_config('momos.quality_review',v_review::text,true); perform set_config('momos.quality_package',v_package::text,true);
end $$;
reset role;

do $$ declare v_failed boolean:=false; begin
  begin update public.agency_scene_quality_reviews set scores=scores||'{"continuity":0}'::jsonb
    where id=current_setting('momos.quality_review')::bigint; exception when others then v_failed:=true; end;
  assert v_failed, 'El control sellado pudo reescribirse.';
  v_failed:=false;
  begin delete from public.agency_postproduction_packages where id=current_setting('momos.quality_package')::bigint;
  exception when others then v_failed:=true; end;
  assert v_failed, 'El paquete aprobado pudo eliminarse.';
  assert (select count(*) from public.content_posts)=current_setting('momos.quality_posts_before')::bigint, 'H33 publicó contenido.';
end $$;

select 'TESTS_OK — Calidad/continuidad/postproducción/fallos/derechos/no publicación/RBAC PASS, rollback total' as resultado;
rollback;
