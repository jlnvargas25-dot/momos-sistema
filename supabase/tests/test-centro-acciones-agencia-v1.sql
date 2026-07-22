-- MOMOS OPS · Prueba adversarial del Centro humano H45. Siempre ROLLBACK.
begin;

do $$
declare v_actor public.users%rowtype;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_45_centro_acciones_agencia'),
    'Falta migración 45.';
  assert public.centro_acciones_agencia_disponible(), 'Falta sonda del Centro de acciones.';
  assert has_function_privilege('authenticated','public.obtener_bandeja_acciones_agencia()','EXECUTE'),
    'La interfaz autenticada no puede leer su bandeja.';
  assert not has_function_privilege('anon','public.obtener_bandeja_acciones_agencia()','EXECUTE'),
    'Anon puede leer la bandeja interna.';
  assert not has_function_privilege('authenticated','public._agency_mcp_action_queue()','EXECUTE'),
    'La interfaz puede saltar el wrapper humano.';
  select * into v_actor from public.users
  where activo and auth_id is not null
    and coalesce(roles,array[rol]) && array['Administrador','Marketing/CRM']::text[]
  order by id limit 1;
  assert v_actor.id is not null, 'Falta actor de Agencia con auth_id para H45.';
  perform set_config('momos.test45_auth',v_actor.auth_id::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.test45_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_queue jsonb; v_text text;
begin
  v_queue:=public.obtener_bandeja_acciones_agencia(); v_text:=v_queue::text;
  assert (v_queue->>'allowed')::boolean, 'Agencia no recibió su bandeja.';
  assert (v_queue->>'contains_pii')::boolean=false
    and (v_queue->>'free_text_exposed')::boolean=false
    and (v_queue->>'external_execution_allowed')::boolean=false,
    'El contrato visual amplió privacidad o ejecución.';
  assert jsonb_array_length(v_queue->'items')<=20
    and (v_queue->>'returned_total')::integer=jsonb_array_length(v_queue->'items'),
    'La bandeja visual no está acotada o no cuadra.';
  assert not exists(
    select 1 from jsonb_array_elements(v_queue->'items') i
    where coalesce((i->>'external_execution')::boolean,true)
       or i->>'decision_status'<>'Aprobada'
  ), 'La interfaz recibió una decisión no aprobada o ejecutable.';
  assert v_text !~* '"(title|rationale|evidence|proposed_action|result|resolution_note|approved_by|created_by|api[_-]?key|access[_-]?token|app[_-]?secret|password|service[_-]?role|authorization)"[[:space:]]*:',
    'La interfaz recibió texto libre, identidad o secreto.';
end $$;
reset role;

do $$
declare v_actor public.users%rowtype;
begin
  select * into v_actor from public.users
  where activo and auth_id is not null
    and not(coalesce(roles,array[rol]) && array['Administrador','Marketing/CRM']::text[])
  order by id limit 1;
  if v_actor.id is not null then perform set_config('momos.test45_nonagency_auth',v_actor.auth_id::text,true); end if;
end $$;

do $$
declare v_auth text:=current_setting('momos.test45_nonagency_auth',true); v_queue jsonb;
begin
  if coalesce(v_auth,'')<>'' then
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_auth,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    v_queue:=public.obtener_bandeja_acciones_agencia();
    execute 'reset role';
    assert (v_queue->>'allowed')::boolean=false and jsonb_array_length(v_queue->'items')=0,
      'Un rol ajeno a Agencia recibió decisiones internas.';
  end if;
end $$;

select 'TESTS_OK — centro humano/una acción/navegación/PII/no ejecución/RBAC PASS, rollback total' as resultado;
rollback;
