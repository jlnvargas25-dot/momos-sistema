-- MOMOS OPS · prueba adversarial Agencia Comercial v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260714_16_agencia_comercial'), 'Falta aplicar la migración 16.';
  assert to_regclass('public.agency_briefs') is not null, 'Faltan briefs comerciales.';
  assert to_regclass('public.agency_decisions') is not null, 'Faltan decisiones comerciales.';
  assert to_regclass('public.agency_creative_versions') is not null, 'Faltan versiones creativas.';
  assert not has_table_privilege('authenticated','public.agency_briefs','INSERT'), 'Permite INSERT directo de briefs.';
  assert not has_table_privilege('authenticated','public.agency_decisions','UPDATE'), 'Permite UPDATE directo de decisiones.';
  assert has_function_privilege('authenticated','public.crear_brief_agencia(jsonb)','EXECUTE'), 'Falta RPC de briefs.';
  assert not has_function_privilege('authenticated','public._agency_actor()','EXECUTE'), 'Helper privado expuesto.';
end $$;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_brief bigint; v_decision bigint; v_failed boolean:=false; v_key text:='TEST-AG-'||pg_backend_pid();
begin
  assert public.agencia_comercial_disponible(), 'La sonda comercial no responde.';
  perform public.guardar_configuracion_agencia(jsonb_build_object('autonomy_mode','Copiloto','daily_budget_limit',100000,
    'campaign_budget_limit',500000,'scale_step_pct',15,'require_creative_approval',true,'block_out_of_stock',true,
    'contact_only_authorized',true,'paused',false));
  v_brief:=(public.crear_brief_agencia(jsonb_build_object('decision_key',v_key,'title','Brief adversarial MOMOS','objective','Ventas','channel','Instagram',
    'deliverables',jsonb_build_array('Reel','Historia'),'evidence',jsonb_build_object('orders',3),'proposed_budget',50000))->>'brief_id')::bigint;
  assert exists(select 1 from public.agency_briefs where id=v_brief and status='Borrador'), 'No creó brief.';
  perform public.set_estado_brief_agencia(v_brief,'En revisión','Listo para validar');
  perform public.set_estado_brief_agencia(v_brief,'Aprobado','Aprobación test');
  assert exists(select 1 from public.agency_briefs where id=v_brief and approved_by is not null and approved_budget=50000), 'No selló aprobación.';

  v_decision:=(public.crear_decision_agencia(jsonb_build_object('brief_id',v_brief,'type','Revisar oferta','title','Validar oferta comercial',
    'rationale','La evidencia exige revisar margen','evidence',jsonb_build_object('orders',3),'proposed_action',jsonb_build_object('proposed_budget',50000),
    'risk_level','Medio','author','reglas'))->>'decision_id')::bigint;
  perform public.resolver_decision_agencia(v_decision,'Aprobada','Aprobada por prueba');
  perform public.resolver_decision_agencia(v_decision,'Ejecutada','Oferta revisada sin publicación externa');
  assert exists(select 1 from public.agency_decisions where id=v_decision and status='Ejecutada' and executed_by is not null), 'No registró ejecución.';

  v_failed:=false;
  begin perform public.crear_brief_agencia(jsonb_build_object('title','Presupuesto imposible','objective','Ventas','proposed_budget',999999999));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó presupuesto por encima del límite.';
  v_failed:=false;
  begin perform public.set_estado_brief_agencia(v_brief,'Borrador','Retroceso inválido'); exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó transición inválida de brief.';
  assert exists(select 1 from public.audit_logs where entidad='Brief agencia' and entidad_id=v_brief::text), 'Falta auditoría de brief.';
  assert exists(select 1 from public.audit_logs where entidad='Decisión agencia' and entidad_id=v_decision::text), 'Falta auditoría de decisión.';
end $$;

select 'TESTS_OK — Agencia Comercial briefs/decisiones/guardas/RBAC PASS, rollback total' as resultado;
rollback;
