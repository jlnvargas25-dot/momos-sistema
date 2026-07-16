-- MOMOS OPS · Prueba adversarial del Gateway MCP semántico v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_42_mcp_agency_gateway'), 'Falta migración 42.';
  assert public.mcp_agency_gateway_disponible(), 'Falta sonda del Gateway MCP.';
  assert to_regclass('public.agency_mcp_access_log') is not null, 'Falta bitácora MCP.';
  assert has_function_privilege('service_role','public.obtener_contexto_director_agencia()','EXECUTE'), 'El runtime privado no puede leer contexto.';
  assert has_function_privilege('service_role','public.registrar_acceso_mcp_agencia(jsonb)','EXECUTE'), 'El runtime privado no puede registrar trazabilidad.';
  assert not has_function_privilege('authenticated','public.obtener_contexto_director_agencia()','EXECUTE'), 'El navegador accede al contexto privado MCP.';
  assert not has_function_privilege('authenticated','public.registrar_acceso_mcp_agencia(jsonb)','EXECUTE'), 'El navegador puede suplantar al MCP.';
  assert not has_table_privilege('authenticated','public.agency_mcp_access_log','INSERT'), 'Staff inserta bitácora MCP directamente.';
  assert not has_table_privilege('authenticated','public.agency_mcp_access_log','UPDATE'), 'Staff reescribe bitácora MCP.';
  assert to_regprocedure('public.ejecutar_sql_mcp(text)') is null and to_regprocedure('public.mcp_execute_sql(text)') is null,
    'El Gateway expone SQL libre.';
end $$;

set local role service_role;
do $$
declare
  v_context jsonb; v_snapshot jsonb; v_result jsonb; v_duplicate jsonb; v_failed boolean:=false;
  v_orders bigint; v_campaigns bigint; v_posts bigint; v_decisions bigint; v_log bigint;
begin
  select count(*) into v_orders from public.orders;
  select count(*) into v_campaigns from public.campaigns;
  select count(*) into v_posts from public.content_posts;
  select count(*) into v_decisions from public.agency_decisions;
  v_context:=public.obtener_contexto_director_agencia();
  v_snapshot:=v_context->'snapshot';
  assert v_context->>'fingerprint' ~ '^[0-9a-f]{32}$', 'El contexto no quedó sellado.';
  assert v_snapshot->>'schema_version'='momos-agency-context/v1', 'Versión semántica incorrecta.';
  assert (v_snapshot->>'external_execution_allowed')::boolean=false, 'El contexto amplió ejecución externa.';
  assert (v_snapshot->'policies'->>'sql_tool_available')::boolean=false
    and (v_snapshot->'policies'->>'payments_allowed')::boolean=false
    and (v_snapshot->'policies'->>'publishing_allowed')::boolean=false
    and (v_snapshot->'policies'->>'budget_changes_allowed')::boolean=false,
    'El snapshot habilitó una capacidad prohibida.';
  assert v_snapshot::text !~* '"(telefono|direccion|instagram|customer_name|customer_id)"[[:space:]]*:',
    'El contexto MCP expuso datos personales de clientes.';
  assert v_snapshot::text !~* '"(api[_-]?key|access[_-]?token|app[_-]?secret|service[_-]?role|password|authorization)"[[:space:]]*:',
    'El contexto MCP expuso secretos.';
  assert (select count(*) from public.orders)=v_orders and (select count(*) from public.campaigns)=v_campaigns
    and (select count(*) from public.content_posts)=v_posts and (select count(*) from public.agency_decisions)=v_decisions,
    'Leer contexto MCP cambió el estado externo o comercial.';

  v_result:=public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key','test42-read-1','tool_name','momos_agency_snapshot','mode','Lectura','status','OK',
    'worker_id','test-mcp-worker','input_fingerprint',md5('{}'),'output_fingerprint',v_context->>'fingerprint',
    'details',jsonb_build_object('version','test','external_execution',false)
  ));
  assert (v_result->>'ok')::boolean and not (v_result->>'duplicate')::boolean, 'No registró acceso MCP.';
  v_duplicate:=public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key','test42-read-1','tool_name','momos_agency_snapshot','mode','Lectura','status','OK',
    'worker_id','test-mcp-worker','input_fingerprint',md5('{}'),'output_fingerprint',v_context->>'fingerprint',
    'details',jsonb_build_object('version','test','external_execution',false)
  ));
  assert (v_duplicate->>'duplicate')::boolean, 'La bitácora no es idempotente.';

  begin
    perform public.registrar_acceso_mcp_agencia(jsonb_build_object(
      'request_key','test42-read-1','tool_name','momos_meta_observatory','mode','Lectura','status','OK',
      'worker_id','test-mcp-worker','input_fingerprint',md5('otro'),'details','{}'::jsonb
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Una clave MCP fue reutilizada con otro contrato.';
  v_failed:=false;
  begin
    perform public.registrar_acceso_mcp_agencia(jsonb_build_object(
      'request_key','test42-secret','tool_name','momos_health','mode','Lectura','status','OK',
      'worker_id','test-mcp-worker','input_fingerprint',md5('{}'),'details',jsonb_build_object('access_token','prohibido')
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'La bitácora aceptó un secreto.';
  select id into v_log from public.agency_mcp_access_log where request_key='test42-read-1';
  v_failed:=false;
  begin update public.agency_mcp_access_log set subject_ref='alterado' where id=v_log;
  exception when others then v_failed:=true; end;
  assert v_failed, 'La bitácora MCP se puede reescribir.';
end $$;
reset role;

set local role authenticated;
do $$ declare v_failed boolean:=false; begin
  begin perform public.obtener_contexto_director_agencia(); exception when insufficient_privilege then v_failed:=true; when others then v_failed:=true; end;
  assert v_failed, 'Authenticated leyó el contexto privado.';
end $$;
reset role;

select 'TESTS_OK — Gateway MCP semántico/PII/secretos/lista cerrada/trazabilidad/no ejecución/RBAC PASS, rollback total' as resultado;
rollback;

