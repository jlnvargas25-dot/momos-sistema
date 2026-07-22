-- MOMOS OPS · Prueba adversarial del retorno cooperativo MCP v1. Siempre ROLLBACK.
begin;

do $$
declare
  v_run bigint; v_proposal bigint; v_payload jsonb;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_43_ciclo_cooperativo_mcp'),
    'Falta migración 43.';
  assert public.mcp_agency_feedback_disponible(), 'Falta sonda del retorno cooperativo.';
  assert has_function_privilege('service_role','public.obtener_contexto_director_agencia()','EXECUTE'),
    'El Cerebro MCP no puede leer el feedback humano.';
  assert not has_function_privilege('authenticated','public.obtener_contexto_director_agencia()','EXECUTE'),
    'El navegador accede al contexto privado del Cerebro.';
  assert not has_function_privilege('service_role','public._agency_mcp_human_feedback()','EXECUTE'),
    'El helper privado quedó expuesto al runtime.';
  assert not has_function_privilege('authenticated','public._obtener_contexto_director_agencia_h42()','EXECUTE'),
    'El navegador puede saltar el wrapper sanitizado.';

  v_payload:=jsonb_build_object(
    'decision_type','Otro','title','Prueba de retorno seguro','rationale','Validar el ciclo humano sin ejecutar.',
    'evidence',jsonb_build_object('source','test43'),'proposed_action',jsonb_build_object('review_only',true),
    'required_tools',jsonb_build_array('MOMO OPS lectura'),'confidence',0.9,'risk_level','Bajo',
    'estimated_cost_cop',0,'cost_cap_cop',0,'execution_mode','Solo análisis','source','Test H43'
  );
  insert into public.agency_agent_runs(
    run_key,trigger_type,status,focus,context_snapshot,agent_name,agent_version,completed_at
  ) values(
    'test43-run','Manual','Propuestas listas','Retorno seguro',
    jsonb_build_object('snapshot_fingerprint',md5('test43')),'Test H43','1',now()
  ) returning id into v_run;
  insert into public.agency_agent_proposals(
    run_id,proposal_key,sealed_payload,payload_fingerprint,status,resolved_at,resolution_note
  ) values(
    v_run,'test43-proposal',v_payload,public._agency_proposal_fingerprint(v_payload),
    'Descartada',now(),'Cliente privado@example.com teléfono 3001234567 secret: nunca exponer'
  ) returning id into v_proposal;
end $$;

set local role service_role;
do $$
declare
  v_before_runs bigint; v_before_proposals bigint; v_context jsonb; v_snapshot jsonb; v_feedback jsonb; v_item jsonb;
begin
  select count(*) into v_before_runs from public.agency_agent_runs;
  select count(*) into v_before_proposals from public.agency_agent_proposals;
  v_context:=public.obtener_contexto_director_agencia();
  v_snapshot:=v_context->'snapshot';
  v_feedback:=v_snapshot->'agency'->'human_feedback';
  select value into v_item
  from jsonb_array_elements(v_feedback->'latest')
  where value->>'snapshot_fingerprint'=md5('test43')
  limit 1;

  assert v_context->>'fingerprint' ~ '^[0-9a-f]{32}$', 'El snapshot enriquecido no quedó sellado.';
  assert (v_snapshot->>'external_execution_allowed')::boolean=false, 'El feedback amplió ejecución externa.';
  assert (v_feedback->>'contains_pii')::boolean=false
    and (v_feedback->>'resolution_notes_exposed')::boolean=false,
    'El contrato no declara la exclusión de PII o notas.';
  assert v_item is not null and v_item->>'outcome'='Descartada'
    and v_item->>'decision_type'='Otro' and v_item->>'execution_mode'='Solo análisis',
    'El resultado humano estructurado no regresó correctamente.';
  assert v_feedback::text !~* '(privado@example|3001234567|"(resolution_note|resolved_by)"[[:space:]]*:|"(api[_-]?key|access[_-]?token|app[_-]?secret|password|service[_-]?role|authorization)"[[:space:]]*:)',
    'El feedback expuso nota libre, identidad o secreto.';
  assert jsonb_array_length(v_feedback->'latest')<=12, 'El retorno cooperativo no está acotado.';
  assert (v_feedback->>'resolved_total')::integer=(
    select count(*) from public.agency_agent_proposals where status in ('Convertida','Descartada')
  ), 'El total resuelto no coincide.';
  assert (select count(*) from public.agency_agent_runs)=v_before_runs
    and (select count(*) from public.agency_agent_proposals)=v_before_proposals,
    'Leer feedback modificó el orquestador.';
end $$;
reset role;

set local role authenticated;
do $$ declare v_failed boolean:=false; begin
  begin perform public.obtener_contexto_director_agencia();
  exception when insufficient_privilege then v_failed:=true; when others then v_failed:=true; end;
  assert v_failed, 'Authenticated leyó el retorno privado.';
end $$;
reset role;

select 'TESTS_OK — ciclo cooperativo feedback/PII/notas/no ejecución/RBAC PASS, rollback total' as resultado;
rollback;
