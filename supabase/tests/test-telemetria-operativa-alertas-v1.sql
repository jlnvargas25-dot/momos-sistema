begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_test_h96'));

do $$
declare t text;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260721_96_telemetria_alertas'),
    'Falta H96 telemetria y alertas.';
  assert to_regclass('public.operational_slo_alerts') is not null
    and to_regprocedure('public.registrar_lote_telemetria_cliente_slo_v1(jsonb)') is not null
    and to_regprocedure('public.obtener_sonda_slo_servidor_v1()') is not null
    and to_regprocedure('public.evaluar_alertas_slo_v1(integer)') is not null,
    'H96 no instalo todos sus contratos.';
  assert (select relrowsecurity from pg_class where oid='public.operational_slo_alerts'::regclass)
    and not has_table_privilege('authenticated','public.operational_slo_alerts','SELECT')
    and not has_table_privilege('service_role','public.operational_slo_alerts','SELECT'),
    'H96 expuso sus alertas privadas.';
  assert has_function_privilege('authenticated','public.registrar_lote_telemetria_cliente_slo_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.evaluar_alertas_slo_v1(integer)','EXECUTE')
    and has_function_privilege('service_role','public.obtener_sonda_slo_servidor_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public.obtener_sonda_slo_servidor_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_h96_ingest_client_item(jsonb)','EXECUTE'),
    'H96 perdio RBAC o expuso helpers.';
  assert exists(select 1 from pg_constraint where conrelid='public.operational_slo_buckets'::regclass
    and pg_get_constraintdef(oid) like '%client%'), 'H96 no habilito la fuente cliente cerrada.';
end $$;

do $$
declare v_admin public.users%rowtype;
begin
  select * into v_admin from public.users where activo and auth_id is not null
    and coalesce(roles,array[rol]) @> array['Administrador']::text[] order by id limit 1;
  assert v_admin.id is not null,'Falta Administrador autenticado para H96.';
  perform set_config('momos.h96_admin_auth',v_admin.auth_id::text,true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object(
  'sub',current_setting('momos.h96_admin_auth'),'role','authenticated')::text,true);
do $$
declare v_payload jsonb; v_first jsonb; v_replay jsonb; v_snapshot jsonb; v_failed boolean:=false;
begin
  v_payload:=jsonb_build_object('measurements',jsonb_build_array(
    jsonb_build_object('idempotency_key','96000000-0000-4000-8000-000000000001',
      'service_code','RPC_CORE','bucket_at',date_trunc('minute',clock_timestamp()),
      'sample_count',100,'success_count',90,'error_count',10,
      'latency_buckets',jsonb_build_object('lte_100',10,'lte_250',10,'lte_500',10,
        'lte_1000',10,'lte_2500',10,'gt_2500',50),'saturation_pct',90,'queue_depth',25),
    jsonb_build_object('idempotency_key','96000000-0000-4000-8000-000000000002',
      'service_code','OPS_FRONTEND','bucket_at',date_trunc('minute',clock_timestamp()),
      'sample_count',1,'success_count',1,'error_count',0,
      'latency_buckets',jsonb_build_object('lte_100',0,'lte_250',1,'lte_500',0,
        'lte_1000',0,'lte_2500',0,'gt_2500',0),'saturation_pct',null,'queue_depth',null)
  ));
  v_first:=public.registrar_lote_telemetria_cliente_slo_v1(v_payload);
  v_replay:=public.registrar_lote_telemetria_cliente_slo_v1(v_payload);
  assert v_first->>'contract'='momos.client-slo-batch.v1'
    and (v_first->>'accepted')::integer=2
    and coalesce((v_first->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_first->>'containsSecrets')::boolean,true)=false
    and coalesce((v_first->>'containsFreeText')::boolean,true)=false
    and coalesce((v_replay#>>'{results,0,replayed}')::boolean,false)=true,
    'H96 no conservo lote, replay o privacidad.';
  begin
    perform public.registrar_lote_telemetria_cliente_slo_v1(v_payload||jsonb_build_object('email','x@momos.invalid'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H96 acepto PII o campos libres.';
  perform public.evaluar_alertas_slo_v1(60);
  perform public.evaluar_alertas_slo_v1(60);
  v_snapshot:=public.momos_operational_slo_snapshot_v1(60);
  assert v_snapshot->>'contract'='momos.operational-slo.v1'
    and jsonb_typeof(v_snapshot->'alerts')='array'
    and (v_snapshot#>>'{alertCounts,open}')::integer>=1
    and exists(select 1 from jsonb_array_elements(v_snapshot->'alerts') x
      where x->>'serviceCode'='RPC_CORE' and x->>'alertCode'='ERROR_BUDGET_EXHAUSTED')
    and coalesce((v_snapshot->>'containsCustomerPii')::boolean,true)=false,
    'H96 no expuso alertas compactas o perdio privacidad.';
end $$;

reset role;
do $$
begin
  assert (select count(*) from public.operational_slo_alerts
    where service_code='RPC_CORE' and alert_code='ERROR_BUDGET_EXHAUSTED' and status='Abierta')=1,
    'H96 duplico una alerta abierta.';
end $$;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare v_probe jsonb;
begin
  v_probe:=public.obtener_sonda_slo_servidor_v1();
  assert v_probe->>'contract'='momos.server-slo-probe.v1'
    and jsonb_typeof(v_probe->'database')='object'
    and jsonb_typeof(v_probe->'connectors')='object'
    and coalesce((v_probe->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_probe->>'containsSecrets')::boolean,true)=false
    and coalesce((v_probe->>'containsFreeText')::boolean,true)=false,
    'La sonda H96 expuso datos o perdio su contrato.';
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
declare v_failed boolean:=false;
begin
  begin perform public.registrar_lote_telemetria_cliente_slo_v1('{}');
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon reporto telemetria H96.';
  v_failed:=false;
  begin perform public.evaluar_alertas_slo_v1(60);
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon evaluo alertas H96.';
end $$;

reset role;
select 'TESTS_OK - H96 telemetria/sondas/alertas/idempotencia/PII/RBAC PASS, rollback total' as resultado;
rollback;
