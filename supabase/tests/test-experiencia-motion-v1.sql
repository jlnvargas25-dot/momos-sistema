-- MOMOS OPS · prueba adversarial de experiencia motion. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_36_experiencia_motion'), 'Falta aplicar la migración 36.';
  assert public.motion_experience_disponible(), 'Falta la sonda de motion.';
  assert to_regclass('public.agency_motion_plans') is not null and to_regclass('public.agency_motion_recipes') is not null
    and to_regclass('public.agency_motion_observations') is not null, 'Faltan tablas de experiencia motion.';
  assert has_function_privilege('authenticated','public.preparar_plan_motion(jsonb)','EXECUTE'), 'Falta preparación humana de motion.';
  assert has_function_privilege('authenticated','public.resolver_plan_motion(bigint,text,text)','EXECUTE'), 'Falta revisión humana de motion.';
  assert not has_function_privilege('authenticated','public.proponer_plan_motion_agente(jsonb)','EXECUTE'), 'El navegador suplanta al cerebro de motion.';
  assert not has_function_privilege('authenticated','public.registrar_observacion_motion_conector(jsonb)','EXECUTE'), 'El navegador suplanta telemetría del conector.';
  assert has_function_privilege('service_role','public.obtener_contexto_motion_agente(bigint)','EXECUTE'), 'El cerebro privado no puede leer contexto motion.';
  assert has_function_privilege('service_role','public.registrar_observacion_motion_conector(jsonb)','EXECUTE'), 'El conector no puede registrar telemetría.';
  assert not has_table_privilege('authenticated','public.agency_motion_plans','INSERT'), 'El navegador inserta planes directos.';
  assert not has_table_privilege('authenticated','public.agency_motion_recipes','UPDATE'), 'El navegador reescribe recetas.';
end $$;

do $$
declare v_actor public.users%rowtype; v_decision bigint; v_room bigint; v_contract bigint; v_board bigint; v_s1 bigint; v_s2 bigint;
  v_context jsonb; v_contract_payload jsonb; v_source jsonb; v_shot jsonb; v_suffix text:=pg_backend_pid()::text;
begin
  select * into v_actor from public.users where activo and auth_id is not null and public.valid_user_roles(roles,rol)
    and ('Administrador'=any(roles) or 'Marketing/CRM'=any(roles)) order by id limit 1;
  assert v_actor.id is not null, 'Falta actor de Agencia para la prueba.';
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Crear contenido','TEST36 motion '||v_suffix,'Validar cámara, luz, continuidad y gates.','{"source":"test36"}'::jsonb,
    '{"proposed_budget":0}'::jsonb,'Bajo','Aprobada','humano',v_actor.id,v_actor.id,now()) returning id into v_decision;
  v_context:=jsonb_build_object('schema_version',1,'decision_id',v_decision,'objective','Dirigir motion antes del Enrutador.');
  insert into public.agency_collaboration_rooms(room_key,title,objective,status,decision_id,context_snapshot,context_fingerprint,created_by)
  values('test36-room-'||v_suffix,'TEST36 Motion','Probar recetas sin generar.','Cerrada',v_decision,v_context,
    public._agency_mesa_fingerprint(v_context),v_actor.id) returning id into v_room;
  v_contract_payload:=jsonb_build_object('schema_version',1,'room_id',v_room,'creative_direction',jsonb_build_object(
    'concept','Abrir un Momo y revelar su relleno','audience','Clientes MOMOS','channel','Instagram','primary_kpi','Beneficio incremental'));
  insert into public.agency_creative_contracts(contract_key,room_id,version,status,sealed_payload,contract_fingerprint,prepared_by,approved_by,approved_at,approval_note,approval_snapshot)
  values('test36-contract-'||v_suffix,v_room,1,'Aprobado',v_contract_payload,public._agency_mesa_fingerprint(v_contract_payload),
    v_actor.id,v_actor.id,now(),'Fixture aprobado','{"approved":true}'::jsonb) returning id into v_contract;
  v_source:=jsonb_build_object('schema_version',1,'contract_id',v_contract,'title','TEST36 Reel');
  insert into public.agency_storyboards(storyboard_key,contract_id,version,title,status,channel,format,aspect_ratio,target_duration_sec,
    creative_brief,retention_plan,source_snapshot,source_fingerprint,estimated_cost_cop,created_by,reviewed_by,reviewed_at,review_note)
  values('test36-board-'||v_suffix,v_contract,1,'TEST36 Reel motion','Aprobado','Instagram','Reel','9:16',6,
    '{"hook":"Qué hay dentro","payoff":"Ganache real","call_to_action":"Pedí"}'::jsonb,
    '{"loops":[{"open_sec":0,"close_sec":6,"promise":"Qué hay dentro","payoff":"Ganache real"}]}'::jsonb,
    v_source,public._agency_mesa_fingerprint(v_source),2000,v_actor.id,v_actor.id,now(),'Storyboard aprobado') returning id into v_board;
  v_shot:='{"subject":"Momo real","action":"Dos manos lo abren","physics":"Ganache viscoso bajo gravedad","camera":"Macro","lighting":"Key suave izquierda","continuity_out":"Relleno centrado"}'::jsonb;
  insert into public.agency_storyboard_shots(storyboard_id,shot_number,revision,title,purpose,duration_sec,shot_payload,input_asset_ids,estimated_cost_cop,shot_fingerprint,created_by)
  values(v_board,1,1,'Apertura','Revelar relleno',3,v_shot,'{}',1000,public._agency_mesa_fingerprint(jsonb_build_object('board',v_board,'shot',1,'payload',v_shot)),v_actor.id) returning id into v_s1;
  v_shot:='{"subject":"Momo abierto","action":"Permanece estable","camera":"Close hero","lighting":"Misma key izquierda","continuity_in":"Relleno centrado","continuity_out":"Copy space"}'::jsonb;
  insert into public.agency_storyboard_shots(storyboard_id,shot_number,revision,title,purpose,duration_sec,shot_payload,input_asset_ids,estimated_cost_cop,shot_fingerprint,created_by)
  values(v_board,2,1,'Hero final','Cerrar CTA',3,v_shot,'{}',1000,public._agency_mesa_fingerprint(jsonb_build_object('board',v_board,'shot',2,'payload',v_shot)),v_actor.id) returning id into v_s2;
  update public.agency_settings set paused=false,campaign_budget_limit=greatest(coalesce(campaign_budget_limit,0),10000) where id;
  perform set_config('momos.test36_auth',v_actor.auth_id::text,true); perform set_config('momos.test36_board',v_board::text,true);
  perform set_config('momos.test36_s1',v_s1::text,true); perform set_config('momos.test36_s2',v_s2::text,true);
  perform set_config('momos.test36_jobs_before',(select count(*)::text from public.creative_generation_jobs),true);
  perform set_config('momos.test36_posts_before',(select count(*)::text from public.content_posts),true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.test36_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_board bigint:=current_setting('momos.test36_board')::bigint; v_s1 bigint:=current_setting('momos.test36_s1')::bigint;
  v_s2 bigint:=current_setting('momos.test36_s2')::bigint; v_fp1 text; v_fp2 text; v_route jsonb; v_failed boolean:=false;
begin
  select shot_fingerprint into v_fp1 from public.agency_storyboard_shots where id=v_s1;
  select shot_fingerprint into v_fp2 from public.agency_storyboard_shots where id=v_s2;
  v_route:=jsonb_build_object('plan_key','test36-route-before','storyboard_id',v_board,'routes',jsonb_build_array(
    jsonb_build_object('shot_id',v_s1,'shot_fingerprint',v_fp1,'provider','Kling','operation','Generar video','capability','Física','rationale','Producto real',
      'risk_level','Medio','estimated_cost_cop',100,'max_cost_cop',125,'prompt',repeat('Dirección física exacta. ',5),'negative_prompt','No deformar.','output_spec','{}'::jsonb),
    jsonb_build_object('shot_id',v_s2,'shot_fingerprint',v_fp2,'provider','Kling','operation','Generar video','capability','Hero','rationale','Cierre estable',
      'risk_level','Bajo','estimated_cost_cop',100,'max_cost_cop',125,'prompt',repeat('Hero MOMOS estable. ',6),'negative_prompt','No mutar.','output_spec','{}'::jsonb)));
  begin perform public.preparar_enrutamiento_escenas(v_route); exception when others then v_failed:=true; end;
  assert v_failed, 'El Enrutador aceptó un storyboard sin motion aprobado.';
  perform set_config('momos.test36_route',v_route::text,true);
end $$;

do $$
declare v_board bigint:=current_setting('momos.test36_board')::bigint; v_s1 bigint:=current_setting('momos.test36_s1')::bigint;
  v_s2 bigint:=current_setting('momos.test36_s2')::bigint; v_fp1 text; v_fp2 text; v_proposal jsonb; v_bad jsonb; v_payload jsonb;
  v_result jsonb; v_plan bigint; v_failed boolean:=false; v_suffix text:=pg_backend_pid()::text;
begin
  select shot_fingerprint into v_fp1 from public.agency_storyboard_shots where id=v_s1;
  select shot_fingerprint into v_fp2 from public.agency_storyboard_shots where id=v_s2;
  v_proposal:=jsonb_build_object('proposal_key','precisa','label','Precisa y natural','selected',true,
    'intent',jsonb_build_object('narrative_job','Revelar'),'framing_lens','{}'::jsonb,'camera_path','{}'::jsonb,'handheld_profile','{}'::jsonb,
    'motion_blur_focus','{}'::jsonb,'lighting_map','{}'::jsonb,'continuity','{}'::jsonb,'physics','{}'::jsonb,'transition_to_next','{}'::jsonb,
    'generation_prompt',repeat('Producto exacto, física natural, cámara con inercia, luz fija y continuidad. ',3),
    'negative_constraints','["no morphing","no product substitution","no logo mutation","no hand swap","no axis reversal","no double shadow"]'::jsonb,
    'acceptance_tests','["identidad","física","cámara","luz","continuidad"]'::jsonb,'provider_assumptions','[]'::jsonb,'estimated_preview_cost_cop',20);
  v_bad:=v_proposal||jsonb_build_object('proposal_key','tambien-seleccionada','selected',true);
  v_payload:=jsonb_build_object('plan_key','test36-bad-'||v_suffix,'storyboard_id',v_board,'grammar_primary','Precisión y control',
    'grammar_secondary','Información y POV','continuity_ledger','{"axis":"sellado"}'::jsonb,'shots',jsonb_build_array(
      jsonb_build_object('shot_id',v_s1,'shot_fingerprint',v_fp1,'proposals',jsonb_build_array(v_proposal,v_bad)),
      jsonb_build_object('shot_id',v_s2,'shot_fingerprint',v_fp2,'proposals',jsonb_build_array(v_proposal))));
  begin perform public.preparar_plan_motion(v_payload); exception when others then v_failed:=true; end;
  assert v_failed, 'Una toma con dos propuestas seleccionadas fue aceptada.';
  v_payload:=jsonb_set(v_payload,'{plan_key}',to_jsonb('test36-valid-'||v_suffix));
  v_payload:=jsonb_set(v_payload,'{shots,0,proposals}',jsonb_build_array(v_proposal));
  v_result:=public.preparar_plan_motion(v_payload); v_plan:=(v_result->>'motion_plan_id')::bigint;
  assert v_plan is not null and v_result->>'status'='En revisión' and not (v_result->>'generated')::boolean
    and not (v_result->>'published')::boolean and (v_result->>'cost_cop')::numeric=0, 'Preparar motion generó, publicó o gastó.';
  assert (select count(*) from public.agency_motion_recipes where plan_id=v_plan)=2, 'No creó una receta exacta por toma.';
  assert (select count(*) from public.creative_generation_jobs)=current_setting('momos.test36_jobs_before')::bigint, 'Preparar motion creó trabajos.';
  perform set_config('momos.test36_plan',v_plan::text,true);
end $$;

do $$ declare v_failed boolean:=false; v_result jsonb; begin
  begin perform public.proponer_plan_motion_agente('{}'::jsonb); exception when insufficient_privilege then v_failed:=true; end;
  assert v_failed, 'Una cuenta autenticada suplantó al agente motion.';
  v_result:=public.resolver_plan_motion(current_setting('momos.test36_plan')::bigint,'Aprobar','Verifiqué producto, física, cámara, luz, eje y continuidad entre tomas.');
  assert v_result->>'status'='Aprobado' and (v_result->>'routing_unlocked')::boolean and not (v_result->>'generation_started')::boolean
    and not (v_result->>'published')::boolean and (v_result->>'cost_cop')::numeric=0, 'Aprobar motion generó, publicó o gastó.';
end $$;

do $$ declare v_route jsonb:=current_setting('momos.test36_route')::jsonb; v_result jsonb; v_route_id bigint; begin
  v_route:=jsonb_set(v_route,'{plan_key}',to_jsonb('test36-route-after-'||pg_backend_pid()));
  v_result:=public.preparar_enrutamiento_escenas(v_route); v_route_id:=(v_result->>'plan_id')::bigint;
  assert v_route_id is not null and not (v_result->>'executed')::boolean, 'Preparar Enrutador ejecutó trabajos.';
  assert exists(select 1 from public.agency_scene_routing_plans r join public.agency_motion_plans m on m.id=r.motion_plan_id
    where r.id=v_route_id and m.id=current_setting('momos.test36_plan')::bigint and r.motion_plan_fingerprint=m.plan_fingerprint),
    'El Enrutador no quedó ligado al motion aprobado exacto.';
end $$;

reset role;
do $$ declare v_failed boolean:=false; begin
  begin update public.agency_motion_recipes set selected_key='alterada' where plan_id=current_setting('momos.test36_plan')::bigint;
  exception when others then v_failed:=true; end;
  assert v_failed, 'Una receta aprobada pudo reescribirse.';
  assert (select count(*) from public.creative_generation_jobs)=current_setting('momos.test36_jobs_before')::bigint, 'El hito creó trabajos sin autorización del Enrutador.';
  assert (select count(*) from public.content_posts)=current_setting('momos.test36_posts_before')::bigint, 'El hito publicó contenido.';
end $$;

select 'TESTS_OK — motion cámara/luz/física/continuidad/selección/gates/telemetría/RBAC PASS, rollback total' as resultado;
rollback;
