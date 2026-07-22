-- MOMOS OPS · prueba adversarial de Retención y aprendizaje. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_34_retencion_aprendizaje'), 'Falta aplicar la migración 34.';
  assert to_regclass('public.agency_retention_scripts') is not null, 'Faltan guiones de retención.';
  assert to_regclass('public.agency_retention_measurements') is not null, 'Faltan mediciones de retención.';
  assert has_function_privilege('authenticated','public.preparar_guion_retencion(jsonb)','EXECUTE'), 'Falta preparar guion.';
  assert has_function_privilege('authenticated','public.cerrar_experimento_retencion(bigint,text,bigint,text)','EXECUTE'), 'Falta cierre humano.';
  assert not has_function_privilege('authenticated','public.proponer_guion_retencion_agente(jsonb)','EXECUTE'), 'El canal privado del agente está expuesto.';
  assert not has_table_privilege('authenticated','public.agency_retention_measurements','INSERT'), 'Las métricas admiten INSERT directo.';
  assert not has_table_privilege('authenticated','public.agency_retention_measurements','UPDATE'), 'Las métricas admiten reescritura.';
  assert not has_table_privilege('authenticated','public.agency_retention_hooks','DELETE'), 'Los hooks admiten borrado.';
end $$;

do $$
declare v_actor public.users%rowtype; v_decision bigint; v_room bigint; v_contract bigint; v_context jsonb; v_payload jsonb;
  v_suffix text:=pg_backend_pid()::text;
begin
  select * into v_actor from public.users where activo and auth_id is not null
    and public.valid_user_roles(roles,rol) and ('Administrador'=any(roles) or 'Marketing/CRM'=any(roles)) order by id limit 1;
  assert v_actor.id is not null, 'Falta actor de Agencia para la prueba.';
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Crear contenido','TEST34 contrato '||v_suffix,'Crear un fixture aislado para probar retención.','{"source":"test34"}'::jsonb,
    '{"proposed_budget":0}'::jsonb,'Bajo','Aprobada','humano',v_actor.id,v_actor.id,now()) returning id into v_decision;
  v_context:=jsonb_build_object('schema_version',1,'decision_id',v_decision,'objective','Probar retención sin usar datos reales.');
  insert into public.agency_collaboration_rooms(room_key,title,objective,status,decision_id,context_snapshot,context_fingerprint,created_by)
  values('test34-room-'||v_suffix,'TEST34 Retención','Validar guiones y experimentos sin ejecutar proveedores.','Cerrada',v_decision,v_context,
    public._agency_mesa_fingerprint(v_context),v_actor.id) returning id into v_room;
  v_payload:=jsonb_build_object('schema_version',1,'room_id',v_room,'creative_direction',jsonb_build_object(
    'concept','Abrir un Momo y mostrar el relleno real','audience','Clientes de recompra','channel','Instagram Reels',
    'primary_kpi','Beneficio incremental','human_intent','Tierno, premium y verificable','call_to_action','Pedí el tuyo'));
  insert into public.agency_creative_contracts(contract_key,room_id,version,status,sealed_payload,contract_fingerprint,
    prepared_by,approved_by,approved_at,approval_note,approval_snapshot)
  values('test34-contract-'||v_suffix,v_room,1,'Aprobado',v_payload,public._agency_mesa_fingerprint(v_payload),
    v_actor.id,v_actor.id,now(),'Contrato temporal aprobado','{"approved":true,"source":"test34"}'::jsonb) returning id into v_contract;
  perform set_config('momos.test34_contract',v_contract::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor.auth_id,'role','authenticated')::text,true);
end $$;
set local role authenticated;

do $$
declare v_contract bigint; v_script bigint; v_control bigint; v_challenger bigint; v_experiment bigint;
  v_result jsonb; v_measure jsonb; v_failed boolean:=false; v_suffix text:=pg_backend_pid()::text;
  v_scores jsonb:='{"clarity":2,"relevance":2,"specificity":2,"proof":2,"novelty":1,"payoff_fit":2,"brand_fit":2,"honesty":2}'::jsonb;
begin
  v_contract:=current_setting('momos.test34_contract')::bigint;

  begin
    perform public.preparar_guion_retencion(jsonb_build_object('script_key','test34-bad-'||v_suffix,'contract_id',v_contract,
      'title','Guion incompleto','platform','Instagram Reels','target_duration_sec',15,'objective','Ventas','audience','Cali',
      'promise','Ver el producto','payoff','Ver el relleno','call_to_action','Pedir','beat_map','[]'::jsonb,'loops','[]'::jsonb,'hooks','[]'::jsonb));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Un guion sin arquitectura fue aceptado.';

  v_result:=public.preparar_guion_retencion(jsonb_build_object('script_key','test34-'||v_suffix,'contract_id',v_contract,
    'title','Prueba de retención MOMOS','platform','Instagram Reels','target_duration_sec',15,'objective','Beneficio incremental',
    'audience','Personas que disfrutan postres premium','promise','Mostrar el relleno real','payoff','El ganache aparece al abrir el Momo','call_to_action','Pedí el tuyo',
    'evidence_plan','{"product_real":true,"no_unapproved_claims":true}'::jsonb,
    'beat_map','[{"beat":1,"label":"Hook","start_sec":0,"end_sec":3,"purpose":"Promesa"},{"beat":2,"label":"Prueba","start_sec":3,"end_sec":10,"purpose":"Demostración"},{"beat":3,"label":"Payoff","start_sec":10,"end_sec":15,"purpose":"Cierre"}]'::jsonb,
    'loops','[{"loop_key":"L1","question":"¿Qué hay adentro?","open_sec":0,"close_sec":12,"payoff":"Ganache real"}]'::jsonb,
    'hooks',jsonb_build_array(
      jsonb_build_object('variant_key','A','label','Control','mechanism','Resultado primero','hook_text','Mirá el centro de este Momo','opening_visual','Macro del producto real','proof','Corte real del producto','scores',v_scores,'selected',true),
      jsonb_build_object('variant_key','B','label','Retador','mechanism','Pregunta','hook_text','¿Qué esconde este Momo?','opening_visual','Producto entero real','proof','Corte real del producto','scores',v_scores,'selected',false))));
  v_script:=(v_result->>'script_id')::bigint;
  assert v_script is not null and not (v_result->>'published')::boolean and not (v_result->>'executed')::boolean, 'Preparar guion ejecutó o publicó.';
  select id into v_control from public.agency_retention_hooks where script_id=v_script and selected;
  select id into v_challenger from public.agency_retention_hooks where script_id=v_script and not selected;
  assert v_control is not null and v_challenger is not null and v_control<>v_challenger, 'No quedaron control y retador exactos.';

  v_result:=public.resolver_guion_retencion(v_script,'Aprobar','Promesa, prueba, payoff y CTA verificados por la marca.');
  assert v_result->>'status'='Aprobado' and not (v_result->>'published')::boolean and not (v_result->>'generation_started')::boolean, 'Aprobar guion generó o publicó.';
  v_result:=public.crear_experimento_retencion(jsonb_build_object('experiment_key','test34-exp-'||v_suffix,'script_id',v_script,
    'control_hook_id',v_control,'challenger_hook_id',v_challenger,'declared_variable','Hook',
    'hypothesis','El control retendrá mejor al segundo tres que el retador.','primary_metric','Retención 3 s',
    'guardrails','{"same_product":true,"same_offer":true,"same_audience":true,"human_winner_required":true}'::jsonb));
  v_experiment:=(v_result->>'experiment_id')::bigint;
  assert v_experiment is not null and not (v_result->>'published')::boolean, 'Planear A/B publicó contenido.';

  v_measure:=jsonb_build_object('experiment_id',v_experiment,'platform','Instagram','captured_at',now(),'sample_size',100,'impressions',120,
    'starts',110,'views_3s',90,'views_25',80,'views_50',70,'views_75',60,'views_100',50,'watch_time_sec',900,'clicks',12,
    'paid_orders',3,'attributed_revenue',54000,'attributed_margin',30000,'incremental_profit',22000,
    'retention_curve','[{"sec":0,"pct":1},{"sec":3,"pct":0.82},{"sec":10,"pct":0.6},{"sec":15,"pct":0.45}]'::jsonb,
    'attribution_snapshot','{"method":"exact-link"}'::jsonb,'publication_fingerprint',md5('test34-publication-'||v_suffix));
  v_failed:=false;
  begin
    perform public.registrar_medicion_retencion(v_measure||jsonb_build_object('measurement_key','test34-invalid-'||v_suffix,'hook_id',v_control,'views_3s',75,'views_25',80));
  exception when check_violation then v_failed:=true; end;
  assert v_failed, 'Una curva de embudo imposible fue aceptada.';

  perform public.registrar_medicion_retencion(v_measure||jsonb_build_object('measurement_key','test34-control-'||v_suffix,'hook_id',v_control));
  v_failed:=false;
  begin perform public.cerrar_experimento_retencion(v_experiment,'Ganador',v_control,'Muestra y atribución verificadas en un solo brazo.');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Se declaró ganador sin muestra suficiente en ambos brazos.';
  perform public.registrar_medicion_retencion(v_measure||jsonb_build_object('measurement_key','test34-challenger-'||v_suffix,'hook_id',v_challenger,
    'views_3s',75,'views_25',70,'views_50',60,'views_75',50,'views_100',40,
    'retention_curve','[{"sec":0,"pct":1},{"sec":3,"pct":0.68},{"sec":10,"pct":0.49},{"sec":15,"pct":0.35}]'::jsonb));
  v_result:=public.cerrar_experimento_retencion(v_experiment,'Ganador',v_control,'Ambos brazos tienen muestra exacta; control retuvo más a 3 s.');
  assert v_result->>'status'='Cerrado' and not (v_result->>'automatic_scaling')::boolean and not (v_result->>'published')::boolean,
    'El experimento no cerró con gate humano o escaló/publicó solo.';
end $$;

reset role;
select 'TESTS_OK — Retención hooks/loops/experimentos/muestra/beneficio/no publicación/RBAC PASS, rollback total' as resultado;
rollback;
