-- MOMOS OPS · prueba adversarial de experiencia de loops. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_35_experiencia_loops'), 'Falta aplicar la migración 35.';
  assert to_regclass('public.agency_retention_diagnostics') is not null, 'Faltan diagnósticos de retención.';
  assert to_regclass('public.agency_retention_learnings') is not null, 'Faltan aprendizajes aprobados.';
  assert has_function_privilege('authenticated','public.preparar_diagnostico_retencion(jsonb)','EXECUTE'), 'Falta diagnóstico humano.';
  assert has_function_privilege('authenticated','public.resolver_diagnostico_retencion(bigint,text,text)','EXECUTE'), 'Falta revisión humana.';
  assert has_function_privilege('service_role','public.proponer_diagnostico_retencion_agente(jsonb)','EXECUTE'), 'Falta propuesta privada del cerebro.';
  assert not has_function_privilege('authenticated','public.proponer_diagnostico_retencion_agente(jsonb)','EXECUTE'), 'La propuesta privada está expuesta al navegador.';
  assert not has_function_privilege('authenticated','public.obtener_contexto_retencion_agente(bigint)','EXECUTE'), 'El contexto MCP está expuesto al navegador.';
  assert not has_table_privilege('authenticated','public.agency_retention_diagnostics','INSERT'), 'Los diagnósticos admiten INSERT directo.';
  assert not has_table_privilege('authenticated','public.agency_retention_learnings','UPDATE'), 'Los aprendizajes admiten reescritura.';
  assert not public._agency_retention_curve_valid(
    '[{"sec":0,"pct":1},{"sec":3,"pct":0.70},{"sec":8,"pct":0.82},{"sec":15,"pct":0.40}]'::jsonb,15
  ), 'Una curva acumulada que vuelve a subir fue aceptada.';
end $$;

do $$
declare v_actor public.users%rowtype; v_decision bigint; v_room bigint; v_contract bigint; v_context jsonb; v_payload jsonb;
  v_suffix text:=pg_backend_pid()::text;
begin
  select * into v_actor from public.users where activo and auth_id is not null
    and public.valid_user_roles(roles,rol) and ('Administrador'=any(roles) or 'Marketing/CRM'=any(roles)) order by id limit 1;
  assert v_actor.id is not null, 'Falta actor de Agencia para la prueba.';
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Crear contenido','TEST35 contrato '||v_suffix,'Crear un fixture aislado para diagnosticar loops.','{"source":"test35"}'::jsonb,
    '{"proposed_budget":0}'::jsonb,'Bajo','Aprobada','humano',v_actor.id,v_actor.id,now()) returning id into v_decision;
  v_context:=jsonb_build_object('schema_version',1,'decision_id',v_decision,'objective','Medir loops sin usar datos reales.');
  insert into public.agency_collaboration_rooms(room_key,title,objective,status,decision_id,context_snapshot,context_fingerprint,created_by)
  values('test35-room-'||v_suffix,'TEST35 Loops','Validar aprendizaje sin ejecutar proveedores.','Cerrada',v_decision,v_context,
    public._agency_mesa_fingerprint(v_context),v_actor.id) returning id into v_room;
  v_payload:=jsonb_build_object('schema_version',1,'room_id',v_room,'creative_direction',jsonb_build_object(
    'concept','Abrir un Momo y mostrar el relleno real','audience','Clientes de recompra','channel','Instagram Reels',
    'primary_kpi','Beneficio incremental','human_intent','Tierno, premium y verificable','call_to_action','Pedí el tuyo'));
  insert into public.agency_creative_contracts(contract_key,room_id,version,status,sealed_payload,contract_fingerprint,
    prepared_by,approved_by,approved_at,approval_note,approval_snapshot)
  values('test35-contract-'||v_suffix,v_room,1,'Aprobado',v_payload,public._agency_mesa_fingerprint(v_payload),
    v_actor.id,v_actor.id,now(),'Contrato temporal aprobado','{"approved":true,"source":"test35"}'::jsonb) returning id into v_contract;
  perform set_config('momos.test35_contract',v_contract::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor.auth_id,'role','authenticated')::text,true);
end $$;
set local role authenticated;

do $$
declare v_contract bigint; v_script bigint; v_control bigint; v_challenger bigint; v_experiment bigint; v_measurement bigint; v_low bigint; v_diag bigint;
  v_result jsonb; v_measure jsonb; v_failed boolean:=false; v_suffix text:=pg_backend_pid()::text;
  v_scores jsonb:='{"clarity":2,"relevance":2,"specificity":2,"proof":2,"novelty":1,"payoff_fit":2,"brand_fit":2,"honesty":2}'::jsonb;
begin
  v_contract:=current_setting('momos.test35_contract')::bigint;
  v_result:=public.preparar_guion_retencion(jsonb_build_object('script_key','test35-script-'||v_suffix,'contract_id',v_contract,
    'title','Diagnóstico temporal MOMOS','platform','Instagram Reels','target_duration_sec',15,'objective','Beneficio incremental',
    'audience','Personas que disfrutan postres premium','promise','Mostrar el relleno real','payoff','El ganache aparece al abrir el Momo','call_to_action','Pedí el tuyo',
    'evidence_plan','{"product_real":true}'::jsonb,
    'beat_map','[{"beat":1,"label":"Hook","start_sec":0,"end_sec":3,"purpose":"Promesa","visual":"Producto real"},{"beat":2,"label":"Prueba","start_sec":3,"end_sec":10,"purpose":"Demostración","visual":"Corte real"},{"beat":3,"label":"Payoff y CTA","start_sec":10,"end_sec":15,"purpose":"Cierre","visual":"Relleno visible"}]'::jsonb,
    'loops','[{"loop_key":"L1","question":"¿Qué hay adentro?","open_sec":0,"close_sec":12,"payoff":"Ganache real"}]'::jsonb,
    'hooks',jsonb_build_array(
      jsonb_build_object('variant_key','A','label','Control','mechanism','Resultado primero','hook_text','Mirá el centro de este Momo','opening_visual','Macro real','proof','Corte real','scores',v_scores,'selected',true),
      jsonb_build_object('variant_key','B','label','Retador','mechanism','Pregunta','hook_text','¿Qué esconde este Momo?','opening_visual','Producto real','proof','Corte real','scores',v_scores,'selected',false))));
  v_script:=(v_result->>'script_id')::bigint;
  perform public.resolver_guion_retencion(v_script,'Aprobar','Promesa, prueba y payoff verificados.');
  select id into v_control from public.agency_retention_hooks where script_id=v_script and selected;
  select id into v_challenger from public.agency_retention_hooks where script_id=v_script and not selected;
  v_result:=public.crear_experimento_retencion(jsonb_build_object('experiment_key','test35-exp-'||v_suffix,'script_id',v_script,
    'control_hook_id',v_control,'challenger_hook_id',v_challenger,'declared_variable','Hook',
    'hypothesis','El control conservará más audiencia al segundo tres.','primary_metric','Retención 3 s','guardrails','{"same_product":true}'::jsonb));
  v_experiment:=(v_result->>'experiment_id')::bigint;

  v_measure:=jsonb_build_object('experiment_id',v_experiment,'hook_id',v_control,'platform','Instagram Reels','captured_at',now(),
    'sample_size',220,'impressions',300,'starts',250,'views_3s',205,'views_25',180,'views_50',145,'views_75',120,'views_100',100,
    'watch_time_sec',2100,'clicks',20,'paid_orders',4,'attributed_revenue',72000,'attributed_margin',45000,'incremental_profit',32000,
    'retention_curve','[{"sec":0,"pct":1},{"sec":3,"pct":0.82},{"sec":10,"pct":0.50},{"sec":15,"pct":0.40}]'::jsonb,
    'attribution_snapshot','{"method":"exact-link"}'::jsonb,'publication_fingerprint',md5('test35-publication-'||v_suffix));
  v_result:=public.registrar_medicion_retencion(v_measure||jsonb_build_object('measurement_key','test35-main-'||v_suffix));
  v_measurement:=(v_result->>'measurement_id')::bigint;
  v_result:=public.registrar_medicion_retencion((v_measure||jsonb_build_object('measurement_key','test35-low-'||v_suffix,'hook_id',v_challenger,
    'sample_size',99,'impressions',120,'starts',100,'views_3s',80,'views_25',70,'views_50',60,'views_75',50,'views_100',40,
    'publication_fingerprint',md5('test35-low-publication-'||v_suffix))));
  v_low:=(v_result->>'measurement_id')::bigint;

  v_failed:=false;
  begin perform public.preparar_diagnostico_retencion(jsonb_build_object('diagnostic_key','test35-low-'||v_suffix,'measurement_id',v_low,
    'tested_variable','Hook','hypothesis','Cambiar el hook puede mejorar la retención.','recommendation','Probar otro hook con una sola variable.'));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Una muestra menor a 100 produjo aprendizaje.';

  v_result:=public.preparar_diagnostico_retencion(jsonb_build_object('diagnostic_key','test35-main-'||v_suffix,'measurement_id',v_measurement,
    'tested_variable','Prueba temprana','hypothesis','Adelantar la demostración puede reducir la caída del bloque de prueba sin bajar ventas.',
    'recommendation','Crear una variante con el mismo producto, audiencia, oferta, duración y CTA; cambiar solo la prueba temprana.'));
  v_diag:=(v_result->>'diagnostic_id')::bigint;
  assert v_diag is not null and v_result->>'status'='En revisión' and (v_result->>'requires_human_approval')::boolean
    and not (v_result->>'generated')::boolean and not (v_result->>'published')::boolean and (v_result->>'cost_cop')::numeric=0,
    'El diagnóstico ejecutó, gastó o publicó.';
  assert jsonb_array_length((select diagnostic_snapshot->'beat_observations' from public.agency_retention_diagnostics where id=v_diag))=3,
    'No ubicó la curva en los tres beats.';
  assert jsonb_array_length((select diagnostic_snapshot->'loop_observations' from public.agency_retention_diagnostics where id=v_diag))=1,
    'No ubicó el loop sellado.';
  assert (select primary_signal ilike '%asociación temporal%no una causa%' from public.agency_retention_diagnostics where id=v_diag),
    'El diagnóstico presentó correlación como causalidad.';
  assert (select (diagnostic_snapshot#>>'{guardrails,one_variable}')::boolean and
    (diagnostic_snapshot#>>'{guardrails,no_auto_generation}')::boolean and
    (diagnostic_snapshot#>>'{guardrails,no_auto_publication}')::boolean from public.agency_retention_diagnostics where id=v_diag),
    'Faltan guardas de variable única o no ejecución.';
  perform set_config('momos.test35_diag',v_diag::text,true);
end $$;

reset role;
do $$ declare v_failed boolean:=false; begin
  begin update public.agency_retention_diagnostics set hypothesis='Causalidad inventada' where id=current_setting('momos.test35_diag')::bigint;
  exception when others then v_failed:=true; end;
  assert v_failed, 'La evidencia del diagnóstico pudo reescribirse.';
end $$;

set local role authenticated;
do $$ declare v_diag bigint:=current_setting('momos.test35_diag')::bigint; v_result jsonb; v_learning bigint; v_failed boolean:=false; begin
  begin perform public.proponer_diagnostico_retencion_agente('{}'::jsonb); exception when insufficient_privilege then v_failed:=true; end;
  assert v_failed, 'Una cuenta autenticada suplantó al cerebro privado.';
  v_result:=public.resolver_diagnostico_retencion(v_diag,'Aprobar','Validé la curva exacta, el beat de mayor caída y el alcance limitado a esta plataforma.');
  v_learning:=(v_result->>'learning_id')::bigint;
  assert v_learning is not null and v_result->>'status'='Aprobado' and not (v_result->>'automatic_scaling')::boolean
    and not (v_result->>'generation_started')::boolean and not (v_result->>'published')::boolean,
    'Aprobar el aprendizaje escaló, generó o publicó.';
  assert (select diagnostic_id=v_diag and tested_variable='Prueba temprana' from public.agency_retention_learnings where id=v_learning),
    'El aprendizaje no conserva diagnóstico y variable exactos.';
  perform set_config('momos.test35_learning',v_learning::text,true);
end $$;

reset role;
do $$ declare v_failed boolean:=false; begin
  begin update public.agency_retention_learnings set statement='Reescrito' where id=current_setting('momos.test35_learning')::bigint;
  exception when others then v_failed:=true; end;
  assert v_failed, 'El aprendizaje aprobado pudo reescribirse.';
end $$;

select 'TESTS_OK — loops por beat/curva/muestra/causalidad/aprendizaje humano/no publicación/RBAC PASS, rollback total' as resultado;
rollback;
