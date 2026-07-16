-- MOMOS OPS · Prueba adversarial del Orquestador de Agencia v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260715_28_orquestador_agencia'), 'Falta migración 28.';
  assert public.orquestador_agencia_disponible(), 'Falta sonda del orquestador.';
  assert has_function_privilege('authenticated','public.registrar_recomendacion_orquestador(jsonb)','EXECUTE'), 'Agencia no puede registrar recomendaciones.';
  assert has_function_privilege('authenticated','public.resolver_propuesta_orquestador(bigint,text,text)','EXECUTE'), 'Agencia no puede resolver propuestas.';
  assert has_function_privilege('service_role','public.registrar_corrida_orquestador_agente(jsonb)','EXECUTE'), 'El runtime MCP no tiene contrato privado.';
  assert not has_function_privilege('authenticated','public.registrar_corrida_orquestador_agente(jsonb)','EXECUTE'), 'El navegador puede suplantar al runtime MCP.';
  assert not has_table_privilege('authenticated','public.agency_agent_proposals','INSERT'), 'Staff puede insertar propuestas sin RPC.';
  assert not has_table_privilege('authenticated','public.agency_agent_proposals','UPDATE'), 'Staff puede reescribir propuestas selladas.';
end $$;

set local role service_role;
do $$
declare v_result jsonb; v_duplicate jsonb; v_failed boolean:=false; v_proposal bigint;
begin
  v_result:=public.registrar_corrida_orquestador_agente(jsonb_build_object(
    'run_key','test-28-mcp-run','trigger_type','Evento','focus','Auditoría comercial','agent_name','Codex MCP','agent_version','1',
    'context_snapshot',jsonb_build_object('orders',3,'stock_alerts',1),
    'proposals',jsonb_build_array(jsonb_build_object(
      'decision_type','Crear contenido','title','Crear borrador trazable','rationale','Hay evidencia de ventas y stock suficiente.',
      'evidence',jsonb_build_object('paid_orders',3),'proposed_action',jsonb_build_object('proposed_budget',0),
      'required_tools',jsonb_build_array('MOMO OPS lectura','Biblioteca de marca','Kling'),'confidence',0.86,
      'risk_level','Bajo','estimated_cost_cop',0,'cost_cap_cop',0,'execution_mode','Preparar borrador','source','Codex MCP'
    ))
  ));
  assert (v_result->>'executed')::boolean=false and (v_result->>'requires_human_approval')::boolean, 'El agente ejecutó o evitó aprobación humana.';
  select id into v_proposal from public.agency_agent_proposals where proposal_key='test-28-mcp-run:1';
  assert v_proposal is not null, 'La propuesta MCP no quedó registrada.';
  perform set_config('momos.orchestrator_proposal',v_proposal::text,true);
  v_duplicate:=public.registrar_corrida_orquestador_agente(jsonb_build_object('run_key','test-28-mcp-run','proposals','[]'::jsonb));
  assert (v_duplicate->>'duplicate')::boolean and (select count(*) from public.agency_agent_proposals where run_id=(v_result->>'run_id')::bigint)=1,
    'La idempotencia duplicó la corrida o su propuesta.';
  begin
    perform public.registrar_corrida_orquestador_agente(jsonb_build_object('run_key','test-28-secret','api_key','nunca-guardar','proposals','[]'::jsonb));
  exception when others then v_failed:=true; end;
  assert v_failed, 'El orquestador almacenó un secreto.';
end $$;
reset role;

do $$ declare v_auth uuid; begin
  select auth_id into v_auth from public.users where auth_id is not null and activo
    and ('Administrador'=any(coalesce(roles,array[rol])) or 'Marketing/CRM'=any(coalesce(roles,array[rol]))) order by id limit 1;
  assert v_auth is not null, 'Falta actor de Agencia para la prueba.';
  perform set_config('momos.orchestrator_auth',v_auth::text,true);
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.orchestrator_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$ declare v_result jsonb; v_decision bigint; v_failed boolean:=false; begin
  v_result:=public.resolver_propuesta_orquestador(current_setting('momos.orchestrator_proposal')::bigint,'Aprobar','Validada por Marketing');
  v_decision:=(v_result->>'decision_id')::bigint;
  assert (v_result->>'executed')::boolean=false, 'Aprobar la propuesta ejecutó una acción externa.';
  assert exists(select 1 from public.agency_agent_proposals where id=current_setting('momos.orchestrator_proposal')::bigint
    and status='Convertida' and decision_id=v_decision and resolved_by is not null), 'No selló la resolución humana.';
  assert exists(select 1 from public.agency_decisions where id=v_decision and status='Aprobada' and author='ia'
    and approved_by is not null and proposed_action->'_orchestrator'->>'proposal_id'=current_setting('momos.orchestrator_proposal')),
    'La decisión perdió autoría, aprobación o metadatos del orquestador.';
  assert not exists(select 1 from public.content_posts where titulo='Crear borrador trazable'), 'Aprobar publicó contenido automáticamente.';
  begin perform public.resolver_propuesta_orquestador(current_setting('momos.orchestrator_proposal')::bigint,'Descartar','Segundo veredicto');
  exception when others then v_failed:=true; end;
  assert v_failed, 'La misma propuesta recibió dos decisiones humanas.';
end $$;

do $$ declare v_failed boolean:=false; begin
  begin
    perform public.registrar_recomendacion_orquestador(jsonb_build_object(
      'proposal_key','test-28-overbudget','decision_type','Escalar presupuesto','title','Gastar sin límite',
      'rationale','Intento adversarial por encima del límite.','evidence','{}'::jsonb,'proposed_action','{}'::jsonb,
      'required_tools',jsonb_build_array('Meta lectura'),'confidence',1,'risk_level','Alto','estimated_cost_cop',0,
      'cost_cap_cop',999999999,'execution_mode','Acción externa'
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó una propuesta por encima del límite de campaña.';
  v_failed:=false;
  begin
    perform public.registrar_recomendacion_orquestador(jsonb_build_object(
      'proposal_key','test-28-unknown-tool','decision_type','Otro','title','Ejecutar herramienta libre',
      'rationale','Intento de ampliar capacidades sin autorización.','evidence','{}'::jsonb,'proposed_action','{}'::jsonb,
      'required_tools',jsonb_build_array('Shell sin control'),'confidence',0.5,'risk_level','Alto','estimated_cost_cop',0,
      'cost_cap_cop',0,'execution_mode','Acción externa'
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó una herramienta fuera de la lista protegida.';
end $$;
reset role;

do $$
declare v_nonagency_auth uuid; v_failed boolean:=false;
begin
  select auth_id into v_nonagency_auth from public.users where auth_id is not null and activo
    and not ('Administrador'=any(coalesce(roles,array[rol]))) and not ('Marketing/CRM'=any(coalesce(roles,array[rol]))) order by id limit 1;
  if v_nonagency_auth is not null then
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_nonagency_auth,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    begin perform public.resolver_propuesta_orquestador(current_setting('momos.orchestrator_proposal')::bigint,'Aprobar','Intrusión');
    exception when others then v_failed:=true; end;
    execute 'reset role';
    assert v_failed, 'Un rol ajeno a Agencia operó el cerebro.';
  end if;
end $$;

select 'TESTS_OK — orquestador MCP/evidencia/costo/idempotencia/aprobación/RBAC PASS, rollback total' as resultado;
rollback;
