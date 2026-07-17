-- MOMOS OPS · prueba adversarial del motor multimodo. Siempre ROLLBACK.
begin;
do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260717_53_motor_crecimiento_multimodo'), 'Falta migración 53.';
  assert public.motor_crecimiento_multimodo_disponible(), 'La sonda del motor no responde.';
  assert (select count(*) from public.agency_growth_mode_policies where active)=4, 'No existen los cuatro modos activos.';
  assert exists(select 1 from public.agency_growth_mode_policies where mode_key='marca-comunidad' and channel_mode='Orgánico'), 'Orgánico quedó mal clasificado.';
  assert exists(select 1 from public.agency_growth_mode_policies where mode_key='pauta-aprendizaje' and channel_mode='Pauta'), 'Pauta quedó mal clasificada.';
  assert not has_table_privilege('authenticated','public.agency_growth_snapshots','INSERT'), 'Staff puede saltar el RPC de snapshots.';
  assert not has_table_privilege('authenticated','public.agency_growth_selections','INSERT'), 'Staff puede saltar el RPC de selección.';
  assert not has_function_privilege('anon','public.registrar_snapshot_motor_crecimiento(jsonb)','EXECUTE'), 'Anon puede preparar estrategias.';
  assert not has_function_privilege('authenticated','public._agency_growth_actor()','EXECUTE'), 'Helper privado expuesto.';
end $$;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_modes jsonb:='[
  {"id":"venta-inmediata","channel":"Mixto","status":{"value":"Listo"}},
  {"id":"conquistar-demanda","channel":"Mixto","status":{"value":"Plan listo"}},
  {"id":"marca-comunidad","channel":"Orgánico","status":{"value":"Listo"}},
  {"id":"pauta-aprendizaje","channel":"Pauta","status":{"value":"Preparar"}}
]'::jsonb;
  v_payload jsonb; v_result jsonb; v_id bigint; v_failed boolean;
begin
  v_payload:=jsonb_build_object('snapshot_key','growth:2099-01-01:adversarial-53','engine_version',1,'generated_for','2099-01-01',
    'facts',jsonb_build_object('exactStockUnits',4,'paidOrders30d',3,'productionUnits',8),
    'modes',v_modes,'recommended_mode','conquistar-demanda',
    'policy',jsonb_build_object('humanDecisionRequired',true,'externalExecution',false,'paidOrganicSeparated',true));
  v_result:=public.registrar_snapshot_motor_crecimiento(v_payload); v_id:=(v_result->>'id')::bigint;
  assert coalesce((v_result->>'external_execution')::boolean,true)=false, 'El motor declaró ejecución externa.';
  assert exists(select 1 from public.agency_growth_snapshots where id=v_id and recommended_mode='conquistar-demanda'), 'No selló la recomendación.';
  assert (public.registrar_snapshot_motor_crecimiento(v_payload)->>'idempotent')::boolean, 'La repetición no fue idempotente.';

  v_result:=public.seleccionar_modo_crecimiento(v_id,'conquistar-demanda','Aumentar ventas y adaptar Producción con confirmación humana.');
  assert coalesce((v_result->>'external_execution')::boolean,true)=false, 'La elección ejecutó una acción externa.';
  assert (public.seleccionar_modo_crecimiento(v_id,'conquistar-demanda','Aumentar ventas y adaptar Producción con confirmación humana.')->>'idempotent')::boolean, 'La selección no fue idempotente.';

  v_failed:=false;
  begin perform public.seleccionar_modo_crecimiento(v_id,'pauta-aprendizaje','Cambiar la decisión ya sellada.'); exception when others then v_failed:=true; end;
  assert v_failed, 'Permitió cambiar silenciosamente la decisión humana sellada.';

  v_failed:=false;
  begin perform public.registrar_snapshot_motor_crecimiento(v_payload||jsonb_build_object('modes',v_modes-3)); exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó un snapshot sin los cuatro modos.';

  v_failed:=false;
  begin perform public.registrar_snapshot_motor_crecimiento(v_payload||jsonb_build_object('snapshot_key','growth:2099-01-01:secret-53','facts',(v_payload->'facts')||jsonb_build_object('api_key','secreto'))); exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó secretos en los hechos.';

  v_failed:=false;
  begin perform public.registrar_snapshot_motor_crecimiento(v_payload||jsonb_build_object('snapshot_key','growth:2099-01-01:execute-53','policy',(v_payload->'policy')||jsonb_build_object('execute',true))); exception when others then v_failed:=true; end;
  assert v_failed, 'El snapshot intentó ejecutar.';

  v_failed:=false;
  begin perform public.seleccionar_modo_crecimiento(v_id,'conquistar-demanda','Escribir al cliente 3001234567 para vender.'); exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó PII en el objetivo.';
end $$;

select 'TESTS_OK — motor multimodo/stock-demanda-marca-pauta/PII/no ejecución/RBAC PASS, rollback total' as resultado;
rollback;
