-- MOMOS OPS · Prueba adversarial H46. Siempre ROLLBACK.
begin;

do $$
declare v_actor public.users%rowtype; v_decision bigint;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_46_resultados_verificables_agencia'), 'Falta migración 46.';
  assert public.resultados_acciones_agencia_disponibles(), 'Falta sonda de resultados verificables.';
  assert to_regclass('public.agency_action_outcomes') is not null, 'Falta ledger de resultados.';
  assert has_function_privilege('authenticated','public.registrar_resultado_accion_agencia(jsonb)','EXECUTE'), 'Agencia no puede registrar resultados.';
  assert not has_table_privilege('authenticated','public.agency_action_outcomes','INSERT'), 'El navegador puede insertar resultados directos.';
  assert not has_table_privilege('authenticated','public.agency_action_outcomes','UPDATE'), 'El navegador puede reescribir resultados.';
  assert not has_function_privilege('authenticated','public._agency_action_evidence_snapshot(text,text,bigint)','EXECUTE'), 'Helper de evidencia expuesto.';

  select * into v_actor from public.users
  where activo and auth_id is not null and coalesce(roles,array[rol]) && array['Administrador','Marketing/CRM']::text[]
  order by id limit 1;
  assert v_actor.id is not null, 'Falta actor de Agencia con auth_id para H46.';
  update public.agency_settings set paused=false,autonomy_mode='Copiloto';
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Otro','Triaje verificable H46','Cerrar una acción con evidencia estructurada','{}','{}','Bajo','Aprobada','humano',v_actor.id,v_actor.id,now())
  returning id into v_decision;
  perform set_config('momos.test46_auth',v_actor.auth_id::text,true);
  perform set_config('momos.test46_decision',v_decision::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.test46_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_decision bigint:=current_setting('momos.test46_decision')::bigint; v_failed boolean:=false; v_result jsonb;
begin
  begin
    perform public.resolver_decision_agencia(v_decision,'Ejecutada','nota libre insegura');
  exception when others then v_failed:=true; end;
  assert v_failed, 'La RPC histórica todavía cerró una decisión sin outcome estructurado.';
  assert not exists(select 1 from public.agency_action_outcomes where decision_id=v_decision), 'El intento fallido dejó evidencia parcial.';

  begin
    perform public.registrar_resultado_accion_agencia(jsonb_build_object(
      'decision_id',v_decision,'completion_status','Completada','observed_result','Neutral',
      'evidence_kind','Ninguna','evidence_id','','actual_cost',0,'summary','Triaje completado'
    ));
  exception when others then v_failed:=true; end;
  assert not exists(select 1 from public.agency_action_outcomes where decision_id=v_decision), 'Aceptó completar sin evidencia interna.';

  v_result:=public.registrar_resultado_accion_agencia(jsonb_build_object(
    'decision_id',v_decision,'completion_status','Completada','observed_result','Neutral',
    'evidence_kind','Decisión','evidence_id',v_decision::text,'actual_cost',0,'summary','Triaje clasificado y responsable asignado'
  ));
  assert (v_result->>'ok')::boolean and (v_result->>'external_execution')::boolean=false, 'El cierre no conservó cero ejecución externa.';
  assert exists(select 1 from public.agency_decisions where id=v_decision and status='Ejecutada' and executed_by is not null), 'La decisión no cerró con outcome válido.';
  assert exists(select 1 from public.agency_action_outcomes where decision_id=v_decision and completion_status='Completada' and evidence_kind='Decisión'), 'No selló el resultado exacto.';

  v_result:=public.registrar_resultado_accion_agencia(jsonb_build_object(
    'decision_id',v_decision,'completion_status','Completada','observed_result','Neutral',
    'evidence_kind','Decisión','evidence_id',v_decision::text,'actual_cost',0,'summary','Triaje clasificado y responsable asignado'
  ));
  assert (v_result->>'idempotent')::boolean, 'Repetir el mismo cierre no fue idempotente.';

  v_failed:=false;
  begin
    perform public.registrar_resultado_accion_agencia(jsonb_build_object(
      'decision_id',v_decision,'completion_status','Completada','observed_result','Positivo',
      'evidence_kind','Decisión','evidence_id',v_decision::text,'actual_cost',0,'summary','Intento de reescritura'
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Permitió reescribir un resultado sellado.';
end $$;

reset role;

do $$
begin
  assert not exists(select 1 from public.agency_action_outcomes where external_execution), 'Existe un resultado que declara ejecución externa.';
  assert not exists(select 1 from public.agency_action_outcomes where completion_status='Completada' and evidence_kind='Ninguna'), 'Existe cierre completado sin evidencia.';
end $$;

select 'TESTS_OK — resultados estructurados/evidencia/idempotencia/no bypass/no ejecución/RBAC PASS, rollback total' as resultado;
rollback;
