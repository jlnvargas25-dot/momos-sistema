-- MOMOS OPS · prueba adversarial de gobernanza determinística de marca. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_49_gobernanza_marca'), 'Falta aplicar la migración 49.';
  assert public.gobernanza_marca_disponible(), 'La sonda de marca no responde.';
  assert to_regclass('public.agency_brand_profiles') is not null, 'Faltan perfiles versionados de marca.';
  assert to_regclass('public.agency_brand_gate_bindings') is not null, 'Falta el ledger de gates de marca.';
  assert exists(select 1 from information_schema.columns where table_schema='public' and table_name='content_distributions' and column_name='content_mode'), 'Distribución no separa Pauta de Orgánico.';
  assert has_function_privilege('authenticated','public.preparar_perfil_marca(jsonb,text)','EXECUTE'), 'El equipo no puede preparar una versión.';
  assert has_function_privilege('authenticated','public.activar_perfil_marca(bigint,text)','EXECUTE'), 'El equipo no puede activar una versión.';
  assert has_function_privilege('service_role','public.obtener_contexto_director_agencia()','EXECUTE'), 'El Cerebro MCP no recibe la marca.';
  assert not has_function_privilege('authenticated','public.obtener_contexto_director_agencia()','EXECUTE'), 'El contexto privado MCP quedó expuesto.';
  assert not has_function_privilege('authenticated','public._agency_brand_record_gate(text,text,jsonb,text,text,text)','EXECUTE'), 'El navegador puede fabricar gates.';
  assert not has_table_privilege('authenticated','public.agency_brand_profiles','UPDATE'), 'El navegador puede reescribir la marca.';
  assert not has_table_privilege('authenticated','public.agency_brand_gate_bindings','INSERT'), 'El navegador puede fabricar aprobaciones.';
  assert exists(select 1 from pg_trigger where tgname='agency_contracts_brand_gate' and not tgisinternal), 'Falta gate en contrato.';
  assert exists(select 1 from pg_trigger where tgname='agency_storyboards_brand_gate' and not tgisinternal), 'Falta gate en storyboard.';
  assert exists(select 1 from pg_trigger where tgname='agency_routing_brand_gate' and not tgisinternal), 'Falta gate en enrutamiento.';
  assert exists(select 1 from pg_trigger where tgname='creative_jobs_brand_snapshot_insert' and not tgisinternal), 'Falta snapshot de marca en generación.';
  assert exists(select 1 from pg_trigger where tgname='agency_scene_quality_brand_gate' and not tgisinternal), 'Falta gate de QA.';
  assert exists(select 1 from pg_trigger where tgname='agency_exports_brand_gate' and not tgisinternal), 'Falta gate de máster.';
  assert exists(select 1 from pg_trigger where tgname='content_distributions_brand_gate' and not tgisinternal), 'Falta gate de distribución.';
  assert exists(select 1 from pg_trigger where tgname='distribution_connector_brand_gate' and not tgisinternal), 'El conector puede saltar el gate de marca.';
  assert exists(select 1 from pg_trigger where tgname='content_distributions_mode_guard' and not tgisinternal), 'La intención de contenido puede reescribirse.';
  assert public._agency_brand_content_contract_valid('Pauta','CPA','Convertir nuevos compradores','{"paid_and_organic_separated":true}'::jsonb), 'Rechazó un contrato válido de Pauta.';
  assert public._agency_brand_content_contract_valid('Orgánico','Guardados','Construir deseo y afinidad','{"paid_and_organic_separated":true}'::jsonb), 'Rechazó un contrato válido Orgánico.';
  assert not public._agency_brand_content_contract_valid('Orgánico','ROAS','Construir comunidad','{"paid_and_organic_separated":true}'::jsonb), 'Mezcló ROAS de Pauta con Orgánico.';
end $$;

do $$
declare v_actor public.users%rowtype; v_active public.agency_brand_profiles%rowtype; v_gate bigint;
begin
  select * into v_actor from public.users where auth_id is not null and activo
    and ('Administrador'=any(coalesce(roles,array[rol])) or 'Marketing/CRM'=any(coalesce(roles,array[rol])))
    order by case when 'Administrador'=any(coalesce(roles,array[rol])) then 0 else 1 end,id limit 1;
  assert v_actor.id is not null, 'Falta actor de marca para la prueba.';
  select * into v_active from public.agency_brand_profiles where status='Activo';
  assert v_active.id is not null and v_active.profile_fingerprint=public._agency_brand_fingerprint(v_active.profile), 'No existe baseline activo e íntegro.';
  assert cardinality(public._agency_brand_profile_errors(v_active.profile))=0, 'El baseline activo está incompleto.';
  assert (v_active.profile#>>'{content_modes,Pauta,requires_attribution}')::boolean
     and (v_active.profile#>>'{content_modes,Orgánico,no_assumed_sales_attribution}')::boolean,
    'El perfil de marca mezcla Pauta y Orgánico.';
  v_gate:=public._agency_brand_record_gate('Contrato','test49-stale',
    '{"constraints":{"human_review_required":true,"product_fidelity_required":true,"no_unapproved_claims":true}}'::jsonb,v_actor.id);
  assert v_gate is not null, 'No registró el gate determinístico.';
  perform set_config('momos.brand_auth',v_actor.auth_id::text,true);
  perform set_config('momos.brand_old_profile',v_active.id::text,true);
  perform set_config('momos.brand_profile',jsonb_set(v_active.profile,'{identity,positioning}',
    to_jsonb('Postres premium con personajes adoptables, textura real y una experiencia tierna que convierte sin traicionar la marca.'::text))::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.brand_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_result jsonb; v_profile bigint; v_failed boolean:=false;
begin
  v_result:=public.preparar_perfil_marca(current_setting('momos.brand_profile')::jsonb,'Ajuste adversarial de posicionamiento para comprobar versionado.');
  v_profile:=(v_result->>'profile_id')::bigint;
  assert (v_result->>'requires_human_approval')::boolean and not (v_result->>'external_execution')::boolean, 'Preparar marca ejecutó o saltó revisión.';
  perform public.activar_perfil_marca(v_profile,'Aprobación humana adversarial de la versión de marca.');
  assert exists(select 1 from public.agency_brand_profiles where id=v_profile and status='Activo'), 'No activó la nueva versión.';
  assert exists(select 1 from public.agency_brand_profiles where id=current_setting('momos.brand_old_profile')::bigint and status='Sustituido'), 'No sustituyó la versión anterior.';
  begin update public.agency_brand_profiles set profile=profile||'{"tampered":true}'::jsonb where id=v_profile;
  exception when others then v_failed:=true; end;
  assert v_failed, 'Una cuenta autenticada pudo reescribir el perfil sellado.';
  v_failed:=false;
  begin perform public.preparar_perfil_marca(
    current_setting('momos.brand_profile')::jsonb||'{"api_key":"SECRETO-H49"}'::jsonb,
    'Intento adversarial de filtrar una credencial en la marca.');
  exception when others then v_failed:=true; end;
  assert v_failed, 'El perfil de marca aceptó una credencial.';
end $$;
reset role;

do $$
declare v_active public.agency_brand_profiles%rowtype; v_failed boolean:=false;
begin
  select * into v_active from public.agency_brand_profiles where status='Activo';
  begin perform public._agency_brand_require_parent('Contrato','test49-stale',v_active.id,v_active.profile_fingerprint);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Una etapa vieja cruzó silenciosamente a la nueva identidad.';
  v_failed:=false;
  begin perform public._agency_brand_record_gate('Contrato','test49-stale','{"changed":true}'::jsonb,
    (select id from public.users where auth_id=current_setting('momos.brand_auth')::uuid));
  exception when others then v_failed:=true; end;
  assert v_failed, 'La misma identidad de gate aceptó otra marca o contenido.';
end $$;

set local role service_role;
do $$ declare v_context jsonb; begin
  v_context:=public.obtener_contexto_director_agencia();
  assert coalesce(v_context#>>'{snapshot,agency,brand_contract,active_profile,fingerprint}','') ~ '^[0-9a-f]{32}$', 'El MCP no recibió el contrato de marca.';
  assert coalesce((v_context#>>'{snapshot,agency,brand_contract,contains_pii}')::boolean,true)=false, 'El contexto de marca expuso PII.';
  assert coalesce((v_context#>>'{snapshot,agency,brand_contract,contains_secrets}')::boolean,true)=false, 'El contexto de marca expuso secretos.';
  assert coalesce((v_context#>>'{snapshot,agency,brand_contract,rules,external_execution_allowed}')::boolean,true)=false, 'La marca habilitó ejecución externa.';
end $$;
reset role;

select 'TESTS_OK — marca versionada/Pauta-Orgánico/gates/stale-brand/MCP/no ejecución/RBAC PASS, rollback total' as resultado;
rollback;
