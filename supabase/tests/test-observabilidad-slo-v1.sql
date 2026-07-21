begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_test_h95'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations
    where id='20260721_95_observabilidad_slo') then
    raise exception 'Falta H95 observabilidad y SLO.';
  end if;
end $$;

do $$
declare t text;
begin
  assert to_regclass('public.operational_slo_policies') is not null
    and to_regclass('public.operational_slo_buckets') is not null
    and to_regclass('public.operational_slo_ingest_receipts') is not null,
    'H95 no creo todas sus fuentes privadas.';
  foreach t in array array[
    'operational_slo_policies','operational_slo_buckets','operational_slo_ingest_receipts'
  ] loop
    assert (select relrowsecurity from pg_class where oid=('public.'||t)::regclass)
      and not has_table_privilege('authenticated','public.'||t,'SELECT')
      and not has_table_privilege('service_role','public.'||t,'SELECT'),
      'H95 expuso la tabla privada '||t;
  end loop;
  assert has_function_privilege('service_role','public.registrar_telemetria_slo_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.momos_operational_slo_snapshot_v1(integer)','EXECUTE')
    and has_function_privilege('authenticated','public.configurar_slo_operativo_v1(text,bigint,numeric,integer,numeric,integer,integer,boolean)','EXECUTE')
    and not has_function_privilege('anon','public.momos_operational_slo_snapshot_v1(integer)','EXECUTE')
    and not has_function_privilege('authenticated','public.registrar_telemetria_slo_v1(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public._momos_h95_latency_upper_ms(bigint,bigint,bigint,bigint,bigint,bigint,bigint,numeric)','EXECUTE'),
    'H95 perdio RBAC o expuso helpers.';
  assert (select count(*) from public.operational_slo_policies)=7,
    'H95 no declaro los siete dominios operativos.';
end $$;

do $$
declare v_admin public.users%rowtype;
begin
  select * into v_admin from public.users
  where activo and auth_id is not null and coalesce(roles,array[rol]) @> array['Administrador']::text[]
  order by id limit 1;
  assert v_admin.id is not null,'Falta Administrador autenticado para H95.';
  perform set_config('momos.h95_admin_auth',v_admin.auth_id::text,true);
end $$;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
  v_payload jsonb; v_first jsonb; v_replay jsonb; v_failed boolean:=false;
begin
  v_payload:=jsonb_build_object(
    'idempotency_key','95000000-0000-4000-8000-000000000001',
    'service_code','RPC_CORE','bucket_at',date_trunc('minute',clock_timestamp()),
    'sample_count',100,'success_count',99,'error_count',1,
    'latency_buckets',jsonb_build_object(
      'lte_100',20,'lte_250',30,'lte_500',30,'lte_1000',15,'lte_2500',4,'gt_2500',1
    ),'saturation_pct',40,'queue_depth',2,'source_kind','worker'
  );
  v_first:=public.registrar_telemetria_slo_v1(v_payload);
  v_replay:=public.registrar_telemetria_slo_v1(v_payload);
  assert coalesce((v_first->>'replayed')::boolean,true)=false
    and coalesce((v_replay->>'replayed')::boolean,false)=true
    and (v_first->>'sampleCount')::integer=100
    and coalesce((v_first->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_first->>'containsSecrets')::boolean,true)=false,
    'H95 no conservo idempotencia o privacidad.';
  begin
    perform public.registrar_telemetria_slo_v1(v_payload||jsonb_build_object('saturation_pct',41));
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'H95 permitio reutilizar una llave con otra medicion.';
  v_failed:=false;
  begin
    perform public.registrar_telemetria_slo_v1(v_payload||jsonb_build_object('customer_email','x@example.com'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H95 acepto PII o campos libres.';
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub',current_setting('momos.h95_admin_auth'),'role','authenticated')::text,true);
do $$
declare v_snapshot jsonb; v_rpc jsonb; v_version bigint; v_saved jsonb; v_failed boolean:=false;
begin
  v_snapshot:=public.momos_operational_slo_snapshot_v1(60);
  assert v_snapshot->>'contract'='momos.operational-slo.v1'
    and jsonb_array_length(v_snapshot->'services')=7
    and coalesce((v_snapshot->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_snapshot->>'containsSecrets')::boolean,true)=false
    and coalesce((v_snapshot->>'containsFreeText')::boolean,true)=false,
    'El snapshot H95 perdio contrato o privacidad.';
  select x into v_rpc from jsonb_array_elements(v_snapshot->'services') x
    where x->>'serviceCode'='RPC_CORE';
  assert v_rpc->>'status'='Fuera de SLO'
    and (v_rpc->>'sampleCount')::integer=100
    and (v_rpc#>>'{latency,p50Ms}')::integer=250
    and (v_rpc#>>'{latency,p95Ms}')::integer=1000
    and (v_rpc#>>'{latency,p99Ms}')::integer=2500
    and (v_rpc->>'availability')::numeric=0.990000,
    'H95 calculo mal disponibilidad o percentiles agregados.';
  select version into v_version from public.operational_slo_policies where service_code='RPC_CORE';
  v_saved:=public.configurar_slo_operativo_v1('RPC_CORE',v_version,0.994000,900,75,20,20,true);
  assert (v_saved->>'version')::bigint=v_version+1,'H95 no versiono la politica SLO.';
  begin
    perform public.configurar_slo_operativo_v1('RPC_CORE',v_version,0.994000,900,75,20,20,true);
  exception when sqlstate '55000' then v_failed:=true; end;
  assert v_failed,'H95 permitio sobrescribir una politica obsoleta.';
end $$;

-- Una sesion autenticada que no pertenece al equipo no obtiene datos ni puede configurar.
select set_config('request.jwt.claims',
  json_build_object('sub','95000000-0000-4000-8000-000000000099','role','authenticated')::text,true);
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_operational_slo_snapshot_v1(60);
  exception when others then v_failed:=true; end;
  assert v_failed,'Una cuenta no administradora consulto SLO.';
  v_failed:=false;
  begin perform public.configurar_slo_operativo_v1('RPC_CORE',1,0.99,900,75,20,20,true);
  exception when others then v_failed:=true; end;
  assert v_failed,'Una cuenta no administradora configuro SLO.';
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_operational_slo_snapshot_v1(60);
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo consultar observabilidad interna.';
  v_failed:=false;
  begin perform public.registrar_telemetria_slo_v1('{}'::jsonb);
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo registrar telemetria.';
end $$;

reset role;
select 'TESTS_OK - H95 SLO/percentiles/error-budget/idempotencia/PII/RBAC PASS, rollback total' as resultado;
rollback;
