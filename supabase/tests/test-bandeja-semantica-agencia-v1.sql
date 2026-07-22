-- MOMOS OPS · Prueba adversarial de la bandeja semántica H44. Siempre ROLLBACK.
begin;

do $$
declare
  v_actor text; v_stock bigint; v_offer bigint; v_campaign bigint; v_creative bigint; v_other bigint; v_draft bigint;
  v_action jsonb;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_44_bandeja_semantica_agencia'),
    'Falta migración 44.';
  assert public.mcp_agency_action_queue_disponible(), 'Falta sonda de la bandeja semántica.';
  assert has_function_privilege('service_role','public.obtener_contexto_director_agencia()','EXECUTE'),
    'El Cerebro MCP no puede leer la bandeja.';
  assert not has_function_privilege('authenticated','public.obtener_contexto_director_agencia()','EXECUTE'),
    'El navegador accede al contexto privado.';
  assert not has_function_privilege('service_role','public._agency_mcp_next_action(bigint)','EXECUTE'),
    'El runtime puede saltar el wrapper y consultar el helper privado.';
  assert not has_function_privilege('service_role','public._agency_mcp_action_queue()','EXECUTE'),
    'El runtime puede consultar directamente la cola privada.';
  assert not has_function_privilege('authenticated','public._obtener_contexto_director_agencia_h43()','EXECUTE'),
    'El navegador puede saltar el wrapper H44.';

  select id into v_actor from public.users where activo order by id limit 1;
  assert v_actor is not null, 'Falta actor activo para la prueba H44.';

  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Reponer stock','SECRETO-H44 inventario','No exponer correo privado+h44@example.com ni 3001234567','{}','{}','Alto','Aprobada','humano',v_actor,v_actor,now())
  returning id into v_stock;
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Revisar oferta','SECRETO-H44 oferta','No exponer margen narrado','{}','{}','Alto','Aprobada','humano',v_actor,v_actor,now())
  returning id into v_offer;
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Activar campaña','SECRETO-H44 Meta','Nunca ejecutar Meta desde esta cola','{}','{}','Alto','Aprobada','humano',v_actor,v_actor,now())
  returning id into v_campaign;
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Crear contenido','SECRETO-H44 creativo','Debe empezar por Mesa','{}','{}','Alto','Aprobada','humano',v_actor,v_actor,now())
  returning id into v_creative;
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Otro','SECRETO-H44 triaje','Debe quedar en coordinación','{}','{}','Alto','Aprobada','humano',v_actor,v_actor,now())
  returning id into v_other;
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by)
  values('Otro','SECRETO-H44 borrador','No debe entrar a la cola','{}','{}','Alto','Propuesta','humano',v_actor)
  returning id into v_draft;

  v_action:=public._agency_mcp_next_action(v_stock);
  assert v_action->>'next_action_code'='REVIEW_PRODUCTION_PLAN' and v_action->>'area'='Producción',
    'Reposición no llegó al plan de producción.';
  v_action:=public._agency_mcp_next_action(v_offer);
  assert v_action->>'next_action_code'='REVIEW_COMMERCIAL_OFFER', 'Oferta no llegó a revisión comercial.';
  v_action:=public._agency_mcp_next_action(v_campaign);
  assert v_action->>'next_action_code'='REVIEW_CAMPAIGN_SCENARIO'
    and (v_action->>'blocked')::boolean and v_action->>'blocker_code'='EXTERNAL_CONNECTOR_DISABLED'
    and not (v_action->>'external_execution')::boolean,
    'La campaña no quedó bloqueada para ejecución externa.';
  v_action:=public._agency_mcp_next_action(v_creative);
  assert v_action->>'next_action_code'='OPEN_COLLABORATION_ROOM' and v_action->>'stage'='Mesa',
    'Contenido saltó la Mesa cooperativa.';
  v_action:=public._agency_mcp_next_action(v_other);
  assert v_action->>'next_action_code'='HUMAN_TRIAGE', 'Otro no llegó a triaje humano.';
  assert public._agency_mcp_next_action(v_draft) is null, 'Una decisión no aprobada entró a la cola.';
end $$;

set local role service_role;
do $$
declare
  v_before_decisions bigint; v_before_rooms bigint; v_context jsonb; v_queue jsonb; v_text text;
begin
  select count(*) into v_before_decisions from public.agency_decisions;
  select count(*) into v_before_rooms from public.agency_collaboration_rooms;
  v_context:=public.obtener_contexto_director_agencia();
  v_queue:=v_context->'snapshot'->'agency'->'action_queue';
  v_text:=v_queue::text;

  assert v_context->>'fingerprint' ~ '^[0-9a-f]{32}$', 'El snapshot H44 no quedó sellado.';
  assert (v_context->'snapshot'->>'external_execution_allowed')::boolean=false,
    'H44 amplió la ejecución externa del snapshot.';
  assert (v_queue->>'contains_pii')::boolean=false
    and (v_queue->>'free_text_exposed')::boolean=false
    and (v_queue->>'external_execution_allowed')::boolean=false,
    'La cola no declara sus límites de privacidad o ejecución.';
  assert jsonb_array_length(v_queue->'items')<=20, 'La cola semántica no está acotada.';
  assert (v_queue->>'returned_total')::integer=jsonb_array_length(v_queue->'items'),
    'El total devuelto no coincide con la lista.';
  assert not exists(
    select 1 from jsonb_array_elements(v_queue->'items') i
    group by i->>'decision_id' having count(*)<>1
  ), 'Una decisión produjo más de un siguiente paso.';
  assert not exists(
    select 1 from jsonb_array_elements(v_queue->'items') i
    where coalesce((i->>'external_execution')::boolean,true)
  ), 'Una acción semántica habilitó ejecución externa.';
  assert v_text !~* '(SECRETO-H44|privado\+h44@example|3001234567|"(title|rationale|evidence|proposed_action|result|resolution_note|approved_by|created_by)"[[:space:]]*:|"(api[_-]?key|access[_-]?token|app[_-]?secret|password|service[_-]?role|authorization)"[[:space:]]*:)',
    'La cola expuso texto libre, identidad, PII o secreto.';
  assert (select count(*) from public.agency_decisions)=v_before_decisions
    and (select count(*) from public.agency_collaboration_rooms)=v_before_rooms,
    'Leer la cola creó o modificó trabajo operativo.';
end $$;
reset role;

set local role authenticated;
do $$ declare v_failed boolean:=false; begin
  begin perform public.obtener_contexto_director_agencia();
  exception when insufficient_privilege then v_failed:=true; when others then v_failed:=true; end;
  assert v_failed, 'Authenticated leyó la bandeja privada.';
end $$;
reset role;

select 'TESTS_OK — bandeja semántica/un paso/PII/no ejecución/RBAC PASS, rollback total' as resultado;
rollback;
