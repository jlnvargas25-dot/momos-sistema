-- MOMOS OPS · Prueba adversarial del Enrutador por escenas v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_32_enrutador_escenas'), 'Falta migración 32.';
  assert public.enrutador_escenas_disponible(), 'Falta sonda del Enrutador.';
  assert has_function_privilege('authenticated','public.preparar_enrutamiento_escenas(jsonb)','EXECUTE'), 'Agencia no puede preparar rutas.';
  assert has_function_privilege('authenticated','public.resolver_enrutamiento_escenas(bigint,text,text)','EXECUTE'), 'Agencia no puede resolver rutas.';
  assert not has_function_privilege('authenticated','public.obtener_contexto_enrutamiento_agente(bigint)','EXECUTE'), 'El navegador accede al contexto privado MCP.';
  assert not has_function_privilege('authenticated','public.registrar_plan_enrutamiento_agente(jsonb)','EXECUTE'), 'El navegador suplanta al agente MCP.';
  assert has_function_privilege('service_role','public.obtener_contexto_enrutamiento_agente(bigint)','EXECUTE'), 'El cerebro privado no puede leer contexto seguro.';
  assert has_function_privilege('service_role','public.registrar_plan_enrutamiento_agente(jsonb)','EXECUTE'), 'El cerebro privado no puede registrar propuestas.';
  assert not has_table_privilege('authenticated','public.agency_scene_routing_plans','INSERT'), 'El navegador inserta planes sin RPC.';
  assert not has_table_privilege('authenticated','public.agency_scene_routing_plans','UPDATE'), 'El navegador reescribe planes.';
end $$;

do $$
declare v_actor public.users%rowtype; v_decision bigint; v_room bigint; v_contract bigint; v_board bigint;
  v_payload jsonb; v_context jsonb; v_contract_payload jsonb; v_shot_payload jsonb; v_shot1 bigint; v_shot2 bigint;
begin
  select * into v_actor from public.users where auth_id is not null and activo
    and ('Administrador'=any(coalesce(roles,array[rol])) or 'Marketing/CRM'=any(coalesce(roles,array[rol]))) order by id limit 1;
  assert v_actor.id is not null, 'Falta actor de Agencia para la prueba.';
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Crear contenido','TEST32 ruta multimotor','Probar autorización atómica sin publicación.','{"source":"test32"}'::jsonb,
    '{"proposed_budget":50000}'::jsonb,'Bajo','Aprobada','humano',v_actor.id,v_actor.id,now()) returning id into v_decision;
  v_context:=jsonb_build_object('schema_version',1,'decision_id',v_decision,'objective','Probar el enrutador multimotor.');
  insert into public.agency_collaboration_rooms(room_key,title,objective,status,decision_id,context_snapshot,context_fingerprint,created_by)
  values('test32-route-room','TEST32 Router','Enrutar dos tomas sin publicar.','Cerrada',v_decision,v_context,
    public._agency_mesa_fingerprint(v_context),v_actor.id) returning id into v_room;
  v_contract_payload:=jsonb_build_object('schema_version',1,'room_id',v_room,'creative_direction',jsonb_build_object(
    'concept','Producto real y motion controlado','primary_kpi','Beneficio incremental'));
  insert into public.agency_creative_contracts(contract_key,room_id,version,status,sealed_payload,contract_fingerprint,
    prepared_by,approved_by,approved_at,approval_note,approval_snapshot)
  values('test32-approved-contract',v_room,1,'Aprobado',v_contract_payload,public._agency_mesa_fingerprint(v_contract_payload),
    v_actor.id,v_actor.id,now(),'Aprobado para prueba','{"approved":true}'::jsonb) returning id into v_contract;
  v_payload:=jsonb_build_object('schema_version',1,'contract_id',v_contract,'title','TEST32 Reel multimotor');
  insert into public.agency_storyboards(storyboard_key,contract_id,version,title,status,channel,format,aspect_ratio,target_duration_sec,
    creative_brief,retention_plan,source_snapshot,source_fingerprint,estimated_cost_cop,created_by,reviewed_by,reviewed_at,review_note)
  values('test32-approved-board',v_contract,1,'TEST32 Reel multimotor','Aprobado','Instagram','Reel','9:16',6,
    '{"hook":"Abrir","payoff":"Relleno","call_to_action":"Pedí"}'::jsonb,
    '{"loops":[{"open_sec":0,"close_sec":6,"promise":"Abrir","payoff":"Relleno"}]}'::jsonb,
    v_payload,public._agency_mesa_fingerprint(v_payload),25000,v_actor.id,v_actor.id,now(),'Aprobado') returning id into v_board;
  v_shot_payload:='{"subject":"Logo MOMOS","action":"Texto entra por capas","camera":"Fija","continuity_out":"Producto visible","on_screen_text":"¿Qué hay dentro?"}'::jsonb;
  v_payload:=jsonb_build_object('board',v_board,'shot',1,'payload',v_shot_payload);
  insert into public.agency_storyboard_shots(storyboard_id,shot_number,revision,title,purpose,duration_sec,shot_payload,input_asset_ids,
    estimated_cost_cop,shot_fingerprint,created_by)
  values(v_board,1,1,'Hook tipográfico','Abrir curiosidad',3,v_shot_payload,'{}',10000,public._agency_mesa_fingerprint(v_payload),v_actor.id)
  returning id into v_shot1;
  v_shot_payload:='{"subject":"Momo real","action":"Dos manos lo parten","physics":"Ganache viscoso bajo gravedad","camera":"Macro dolly","continuity_out":"Logo y CTA"}'::jsonb;
  v_payload:=jsonb_build_object('board',v_board,'shot',2,'payload',v_shot_payload);
  insert into public.agency_storyboard_shots(storyboard_id,shot_number,revision,title,purpose,duration_sec,shot_payload,input_asset_ids,
    estimated_cost_cop,shot_fingerprint,created_by)
  values(v_board,2,1,'Relleno real','Cerrar el payoff',3,v_shot_payload,'{}',15000,public._agency_mesa_fingerprint(v_payload),v_actor.id)
  returning id into v_shot2;
  update public.agency_settings set paused=false,campaign_budget_limit=greatest(campaign_budget_limit,100000) where id;
  update public.agency_integrations set status='Activa',secret_configured=true,last_heartbeat_at=now(),last_error=''
    where provider in ('Higgsfield','Kling');
  perform set_config('momos.route_auth',v_actor.auth_id::text,true);
  perform set_config('momos.route_board',v_board::text,true);
  perform set_config('momos.route_shot1',v_shot1::text,true);
  perform set_config('momos.route_shot2',v_shot2::text,true);
  perform set_config('momos.route_jobs_before',(select count(*)::text from public.creative_generation_jobs),true);
  perform set_config('momos.route_posts_before',(select count(*)::text from public.content_posts),true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.route_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_board bigint:=current_setting('momos.route_board')::bigint; v_s1 bigint:=current_setting('momos.route_shot1')::bigint;
  v_s2 bigint:=current_setting('momos.route_shot2')::bigint; v_fp1 text; v_fp2 text; v_payload jsonb; v_result jsonb; v_dup jsonb;
  v_plan bigint; v_failed boolean:=false;
begin
  select shot_fingerprint into v_fp1 from public.agency_storyboard_shots where id=v_s1;
  select shot_fingerprint into v_fp2 from public.agency_storyboard_shots where id=v_s2;
  v_payload:=jsonb_build_object('plan_key','test32-route-invalid','storyboard_id',v_board,'routes',jsonb_build_array(
    jsonb_build_object('shot_id',v_s1,'shot_fingerprint',repeat('0',32),'provider','Higgsfield','operation','Generar video',
      'capability','Motion gráfico','rationale','Controlar texto','risk_level','Bajo','estimated_cost_cop',10000,'max_cost_cop',12500,
      'prompt','Toma tipográfica MOMOS controlada y coherente.','negative_prompt','No inventar logo.','output_spec','{}'::jsonb),
    jsonb_build_object('shot_id',v_s2,'shot_fingerprint',v_fp2,'provider','Kling','operation','Generar video',
      'capability','Física de producto','rationale','Resolver manos y ganache','risk_level','Medio','estimated_cost_cop',15000,'max_cost_cop',18800,
      'prompt','Dos manos parten el Momo y revelan ganache real.','negative_prompt','No deformar producto.','output_spec','{}'::jsonb)));
  begin perform public.preparar_enrutamiento_escenas(v_payload); exception when others then v_failed:=true; end;
  assert v_failed, 'Se aceptó una huella de toma falsa.';
  v_payload:=jsonb_set(v_payload,'{plan_key}','"test32-route-valid"'::jsonb);
  v_payload:=jsonb_set(v_payload,'{routes,0,shot_fingerprint}',to_jsonb(v_fp1));
  v_result:=public.preparar_enrutamiento_escenas(v_payload); v_plan:=(v_result->>'plan_id')::bigint;
  assert not (v_result->>'executed')::boolean and (v_result->>'requires_human_approval')::boolean, 'Preparar ejecutó o evitó aprobación humana.';
  assert (select count(*) from public.creative_generation_jobs)=current_setting('momos.route_jobs_before')::bigint, 'Preparar creó trabajos.';
  v_payload:=jsonb_set(v_payload,'{plan_key}','"test32-route-same-content"'::jsonb);
  v_dup:=public.preparar_enrutamiento_escenas(v_payload);
  assert (v_dup->>'duplicate')::boolean and (v_dup->>'plan_id')::bigint=v_plan, 'El mismo contenido creó otro plan.';
  perform set_config('momos.route_plan',v_plan::text,true);
end $$;
reset role;

update public.agency_integrations set last_heartbeat_at=now()-interval '2 hours' where provider='Higgsfield';
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.route_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare v_failed boolean:=false; begin
  begin perform public.resolver_enrutamiento_escenas(current_setting('momos.route_plan')::bigint,'Autorizar','Prueba con motor vencido');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Se autorizó con un conector vencido.';
  assert (select count(*) from public.creative_generation_jobs)=current_setting('momos.route_jobs_before')::bigint,
    'El fallo del segundo motor dejó trabajos parciales.';
end $$;
reset role;

update public.agency_integrations set last_heartbeat_at=now() where provider='Higgsfield';
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.route_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare v_result jsonb; v_count bigint; begin
  v_result:=public.resolver_enrutamiento_escenas(current_setting('momos.route_plan')::bigint,'Autorizar','Motores y topes revisados por humano');
  assert v_result->>'status'='Autorizado' and (v_result->>'executed')::boolean and not (v_result->>'published')::boolean,
    'La autorización no creó la cola segura o publicó contenido.';
  assert jsonb_array_length(v_result->'job_ids')=2, 'No se creó exactamente un trabajo por toma.';
  select count(*) into v_count from public.creative_generation_jobs
    where (output_spec->>'routing_plan_id')::bigint=current_setting('momos.route_plan')::bigint and status='Autorizado';
  assert v_count=2, 'Los dos trabajos no quedaron autorizados y vinculados.';
  assert exists(select 1 from public.creative_generation_jobs where (output_spec->>'routing_plan_id')::bigint=current_setting('momos.route_plan')::bigint and provider='Higgsfield');
  assert exists(select 1 from public.creative_generation_jobs where (output_spec->>'routing_plan_id')::bigint=current_setting('momos.route_plan')::bigint and provider='Kling');
  v_result:=public.resolver_enrutamiento_escenas(current_setting('momos.route_plan')::bigint,'Autorizar','Reintento');
  assert (v_result->>'duplicate')::boolean, 'Reautorizar no fue idempotente.';
  assert (select count(*) from public.creative_generation_jobs where (output_spec->>'routing_plan_id')::bigint=current_setting('momos.route_plan')::bigint)=2,
    'Reautorizar duplicó trabajos.';
end $$;
reset role;

do $$ declare v_failed boolean:=false; begin
  begin update public.agency_scene_routing_plans set plan_snapshot=plan_snapshot||'{"tampered":true}'::jsonb
    where id=current_setting('momos.route_plan')::bigint; exception when others then v_failed:=true; end;
  assert v_failed, 'Un plan sellado pudo reescribirse.';
  assert (select count(*) from public.content_posts)=current_setting('momos.route_posts_before')::bigint, 'El enrutador publicó contenido.';
end $$;

select 'TESTS_OK — Enrutador escenas/multimotor/costo/idempotencia/atomicidad/no publicación/RBAC PASS, rollback total' as resultado;
rollback;
