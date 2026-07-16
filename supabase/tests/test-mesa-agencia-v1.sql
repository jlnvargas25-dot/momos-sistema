-- MOMOS OPS · Prueba adversarial Mesa cooperativa de Agencia v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_30_mesa_agencia'), 'Falta migración 30.';
  assert public.mesa_agencia_disponible(), 'Falta sonda de Mesa de Agencia.';
  assert has_function_privilege('authenticated','public.abrir_mesa_agencia(jsonb)','EXECUTE'), 'El equipo no puede abrir mesas.';
  assert has_function_privilege('authenticated','public.agregar_aporte_mesa_agencia(bigint,text,text,text,jsonb)','EXECUTE'), 'El humano no puede aportar.';
  assert has_function_privilege('authenticated','public.preparar_contrato_creativo(bigint,jsonb,jsonb)','EXECUTE'), 'El humano no puede preparar el contrato.';
  assert has_function_privilege('authenticated','public.aprobar_contrato_creativo(bigint,text)','EXECUTE'), 'El humano no puede aprobar el contrato.';
  assert has_function_privilege('service_role','public.registrar_aporte_agente_mesa(jsonb)','EXECUTE'), 'El runtime MCP no puede aportar.';
  assert not has_function_privilege('authenticated','public.registrar_aporte_agente_mesa(jsonb)','EXECUTE'), 'El navegador puede suplantar al agente.';
  assert not has_table_privilege('authenticated','public.agency_collaboration_entries','INSERT'), 'El navegador puede insertar aportes directos.';
  assert not has_table_privilege('authenticated','public.agency_creative_contracts','UPDATE'), 'El navegador puede aprobar contratos directo.';
end $$;

do $$
declare v_actor public.users%rowtype; v_decision bigint;
begin
  select * into v_actor from public.users where auth_id is not null and activo
    and ('Administrador'=any(coalesce(roles,array[rol])) or 'Marketing/CRM'=any(coalesce(roles,array[rol]))) order by id limit 1;
  assert v_actor.id is not null, 'Falta actor de Agencia para la prueba.';
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,approved_at)
  values('Crear contenido','TEST30 oportunidad rentable','Hay evidencia determinística para deliberar.','{"source":"test30"}'::jsonb,
    '{"proposed_budget":0}'::jsonb,'Bajo','Aprobada','humano',v_actor.id,v_actor.id,now()) returning id into v_decision;
  perform set_config('momos.mesa_auth',v_actor.auth_id::text,true);
  perform set_config('momos.mesa_decision',v_decision::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.mesa_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_result jsonb; v_room bigint; v_failed boolean:=false; v_dup jsonb;
begin
  v_result:=public.abrir_mesa_agencia(jsonb_build_object('room_key','test30-mesa-rentable','title','TEST30 Mesa rentable',
    'objective','Aumentar beneficio incremental sin comprometer la marca.','decision_id',current_setting('momos.mesa_decision')::bigint));
  v_room:=(v_result->>'room_id')::bigint;
  perform set_config('momos.mesa_room',v_room::text,true);
  assert (v_result->>'executed')::boolean=false, 'Abrir la mesa ejecutó una acción.';
  assert exists(select 1 from public.agency_collaboration_rooms where id=v_room and context_fingerprint ~ '^[0-9a-f]{32}$'), 'Los hechos no quedaron sellados.';
  assert exists(select 1 from public.agency_collaboration_entries where room_id=v_room and author_kind='Sistema'), 'Falta el origen determinístico.';
  v_dup:=public.abrir_mesa_agencia(jsonb_build_object('room_key','test30-mesa-rentable','title','TEST30 Mesa rentable',
    'objective','Aumentar beneficio incremental sin comprometer la marca.','decision_id',current_setting('momos.mesa_decision')::bigint));
  assert (v_dup->>'duplicate')::boolean and (v_dup->>'room_id')::bigint=v_room, 'La mesa idempotente se duplicó.';
  perform public.agregar_aporte_mesa_agencia(v_room,'test30-human-1','Aporte','La pieza debe sentirse tierna, premium y antojable.',
    '{"brand_owner":true}'::jsonb);
  begin
    perform public.preparar_contrato_creativo(v_room,'{"concept":"Mostrar el relleno","audience":"Recompra","channel":"Instagram"}'::jsonb,'{}'::jsonb);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Se creó contrato sin cooperación del agente.';
  v_failed:=false;
  begin
    perform public.agregar_aporte_mesa_agencia(v_room,'test30-human-1','Aporte','Contenido distinto con la misma clave.','{}'::jsonb);
  exception when others then v_failed:=true; end;
  assert v_failed, 'La idempotencia permitió reescribir el aporte humano.';
end $$;
reset role;

set local role service_role;
do $$ declare v_result jsonb; v_failed boolean:=false; begin
  v_result:=public.registrar_aporte_agente_mesa(jsonb_build_object('room_id',current_setting('momos.mesa_room')::bigint,
    'entry_key','test30-agent-1','entry_type','Propuesta','body','Propongo abrir con el relleno y cerrar con adopción del Momo.',
    'payload',jsonb_build_object('hypothesis','El close-up aumenta intención de compra'),'agent_name','Codex Agencia MOMOS'));
  assert (v_result->>'executed')::boolean=false, 'El aporte del agente ejecutó una acción.';
  begin
    perform public.registrar_aporte_agente_mesa(jsonb_build_object('room_id',current_setting('momos.mesa_room')::bigint,
      'entry_key','test30-secret','body','Intento','payload',jsonb_build_object('api_key','nunca'),'agent_name','Intruso'));
  exception when others then v_failed:=true; end;
  assert v_failed, 'La mesa almacenó un secreto del conector.';
end $$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.mesa_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_result jsonb; v_dup jsonb; v_contract bigint;
begin
  v_result:=public.preparar_contrato_creativo(current_setting('momos.mesa_room')::bigint,
    '{"concept":"Abrir con el relleno real","audience":"Clientes de recompra","channel":"Instagram","primary_kpi":"Beneficio incremental","human_intent":"Que se sienta MOMOS"}'::jsonb,
    '{"must_include":"Producto real","must_avoid":"Descuentos inventados"}'::jsonb);
  v_contract:=(v_result->>'contract_id')::bigint;
  perform set_config('momos.mesa_contract',v_contract::text,true);
  assert (v_result->>'executed')::boolean=false and (v_result->>'requires_human_approval')::boolean, 'Preparar contrato ejecutó o evitó aprobación.';
  v_dup:=public.preparar_contrato_creativo(current_setting('momos.mesa_room')::bigint,
    '{"concept":"Abrir con el relleno real","audience":"Clientes de recompra","channel":"Instagram","primary_kpi":"Beneficio incremental","human_intent":"Que se sienta MOMOS"}'::jsonb,
    '{"must_include":"Producto real","must_avoid":"Descuentos inventados"}'::jsonb);
  assert (v_dup->>'duplicate')::boolean and (v_dup->>'contract_id')::bigint=v_contract, 'El mismo acuerdo creó otra versión.';
  perform public.agregar_aporte_mesa_agencia(current_setting('momos.mesa_room')::bigint,'test30-human-2','Decisión',
    'Afinar el cierre para que la adopción del Momo sea el recuerdo principal.','{"revision":2}'::jsonb);
  assert exists(select 1 from public.agency_creative_contracts where id=v_contract and status='Sustituido'),
    'Un aporte nuevo dejó aprobable un contrato con contexto conversacional viejo.';
  v_result:=public.preparar_contrato_creativo(current_setting('momos.mesa_room')::bigint,
    '{"concept":"Abrir con el relleno real y cerrar con adopción","audience":"Clientes de recompra","channel":"Instagram","primary_kpi":"Beneficio incremental","human_intent":"Que se sienta MOMOS"}'::jsonb,
    '{"must_include":"Producto real","must_avoid":"Descuentos inventados"}'::jsonb);
  v_contract:=(v_result->>'contract_id')::bigint;
  perform set_config('momos.mesa_contract',v_contract::text,true);
  assert (v_result->>'version')::integer=2, 'La nueva deliberación no creó una versión posterior.';
  v_result:=public.aprobar_contrato_creativo(v_contract,'Aprobado conjuntamente para pasar al estudio.');
  assert (v_result->>'executed')::boolean=false and (v_result->>'generation_started')::boolean=false
    and (v_result->>'distribution_started')::boolean=false, 'Aprobar el contrato generó, gastó o distribuyó.';
  assert exists(select 1 from public.agency_creative_contracts where id=v_contract and status='Aprobado' and approved_by is not null), 'No selló aprobación humana.';
  assert exists(select 1 from public.agency_collaboration_rooms where id=current_setting('momos.mesa_room')::bigint and status='Cerrada'), 'La mesa no cerró el acuerdo.';
end $$;
reset role;

do $$ declare v_failed boolean:=false; begin
  begin update public.agency_creative_contracts set sealed_payload=sealed_payload||'{"tampered":true}'::jsonb where id=current_setting('momos.mesa_contract')::bigint;
  exception when others then v_failed:=true; end;
  assert v_failed, 'El contrato aprobado pudo alterarse.';
  v_failed:=false;
  begin update public.agency_collaboration_entries set body='Reescrito' where room_id=current_setting('momos.mesa_room')::bigint;
  exception when others then v_failed:=true; end;
  assert v_failed, 'El historial cooperativo pudo reescribirse.';
  assert not exists(select 1 from public.content_posts where titulo='TEST30 Mesa rentable'), 'La mesa publicó contenido.';
end $$;

do $$ declare v_auth uuid; v_failed boolean:=false; begin
  select auth_id into v_auth from public.users where auth_id is not null and activo
    and not ('Administrador'=any(coalesce(roles,array[rol]))) and not ('Marketing/CRM'=any(coalesce(roles,array[rol]))) order by id limit 1;
  if v_auth is not null then
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_auth,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    begin perform public.abrir_mesa_agencia(jsonb_build_object('room_key','test30-intrusion','title','Intrusión ajena',
      'objective','Intentar operar Agencia sin rol.','decision_id',current_setting('momos.mesa_decision')::bigint));
    exception when others then v_failed:=true; end;
    execute 'reset role';
    assert v_failed, 'Un rol ajeno a Agencia abrió una mesa.';
  end if;
end $$;

select 'TESTS_OK — Mesa cooperativa/hechos/contrato/inmutabilidad/RBAC PASS, rollback total' as resultado;
rollback;
