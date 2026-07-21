-- MOMOS OPS · prueba adversarial H94. Siempre ROLLBACK.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_test_h94'));

do $$
declare t text;
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260721_94_certificacion_concurrencia_caos'),
    'Falta H94 certificacion de concurrencia y caos.';
  foreach t in array array[
    'operational_resilience_runs','operational_resilience_resources',
    'operational_resilience_receipts','operational_resilience_scenarios'
  ] loop
    assert to_regclass('public.'||t) is not null
      and (select relrowsecurity from pg_class where oid=('public.'||t)::regclass)
      and not has_table_privilege('authenticated','public.'||t,'SELECT')
      and not has_table_privilege('service_role','public.'||t,'SELECT'),
      'H94 expuso o no protegio '||t;
  end loop;
  assert has_function_privilege('service_role','public.iniciar_certificacion_resiliencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.probar_idempotencia_resiliencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.probar_ultima_unidad_resiliencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.probar_lease_resiliencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.probar_atomicidad_resiliencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.momos_resilience_snapshot_v1()','EXECUTE')
    and not has_function_privilege('anon','public.momos_resilience_snapshot_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public.iniciar_certificacion_resiliencia_v1(jsonb)','EXECUTE'),
    'H94 perdio RBAC.';
end $$;

create temporary table h94_context(
  run_id uuid,admin_auth uuid,orders_before bigint,movements_before bigint,batches_before bigint
) on commit drop;
insert into h94_context(admin_auth,orders_before,movements_before,batches_before)
select (select auth_id from public.users where activo and auth_id is not null
    and coalesce(roles,array[rol]) @> array['Administrador']::text[] order by id limit 1),
  (select count(*) from public.orders),
  (select count(*) from public.inventory_movements),
  (select count(*) from public.production_batches);
grant all on table h94_context to service_role;
grant select on table h94_context to authenticated;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

do $$
declare v_start jsonb; v_replay jsonb; v_failed boolean:=false;
begin
  assert (select admin_auth is not null from h94_context),'H94 necesita un Administrador autenticado.';
  begin
    perform public.iniciar_certificacion_resiliencia_v1(jsonb_build_object(
      'run_key','h94-staging-without-confirmation','environment','Staging',
      'runner_version','test-1','concurrency',8,'target_request_count',100));
  exception when others then v_failed:=true; end;
  assert v_failed,'H94 permitio certificar staging sin confirmacion explicita.';
  v_start:=public.iniciar_certificacion_resiliencia_v1(jsonb_build_object(
    'run_key','h94-adversarial-synthetic-001','environment','Sintetico',
    'runner_version','test-1','concurrency',12,'target_request_count',100));
  update h94_context set run_id=(v_start->>'runId')::uuid;
  v_replay:=public.iniciar_certificacion_resiliencia_v1(jsonb_build_object(
    'run_key','h94-adversarial-synthetic-001','environment','Sintetico',
    'runner_version','test-1','concurrency',12,'target_request_count',100));
  assert not coalesce((v_start->>'replayed')::boolean,true)
    and coalesce((v_replay->>'replayed')::boolean,false)
    and v_replay->>'runId'=v_start->>'runId'
    and coalesce((v_start->>'isolated')::boolean,false)
    and not coalesce((v_start->>'businessMutation')::boolean,true),
    'H94 no hizo idempotente el inicio aislado.';
end $$;

do $$
declare v_run uuid:=(select run_id from h94_context); v_first jsonb; v_retry jsonb;
  v_failed boolean:=false; i integer; v_key uuid;
begin
  for i in 1..20 loop
    v_key:=('94000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
    v_first:=public.probar_idempotencia_resiliencia_v1(jsonb_build_object(
      'run_id',v_run,'operation_code',case when i=20 then 'LOST_RESPONSE_RETRY' else 'IDEMPOTENT_WRITE' end,
      'idempotency_key',v_key,'payload',jsonb_build_object('sequence',i,'kind','synthetic')));
    if i in (1,20) then
      v_retry:=public.probar_idempotencia_resiliencia_v1(jsonb_build_object(
        'run_id',v_run,'operation_code',case when i=20 then 'LOST_RESPONSE_RETRY' else 'IDEMPOTENT_WRITE' end,
        'idempotency_key',v_key,'payload',jsonb_build_object('sequence',i,'kind','synthetic')));
      assert not coalesce((v_first->>'duplicate')::boolean,true)
        and coalesce((v_retry->>'duplicate')::boolean,false)
        and v_retry->>'sequence'=v_first->>'sequence',
        'H94 repitio una escritura idempotente.';
    end if;
  end loop;
  begin
    perform public.probar_idempotencia_resiliencia_v1(jsonb_build_object(
      'run_id',v_run,'operation_code','IDEMPOTENT_WRITE',
      'idempotency_key','94000000-0000-4000-8000-000000000001',
      'payload',jsonb_build_object('sequence',999,'kind','changed')));
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'H94 permitio reutilizar una clave con otro payload.';
end $$;

do $$
declare v_run uuid:=(select run_id from h94_context); v_first jsonb; v_second jsonb;
  v_lease_a jsonb; v_lease_b jsonb; v_failed boolean:=false; v_snapshot jsonb;
begin
  v_first:=public.probar_ultima_unidad_resiliencia_v1(jsonb_build_object(
    'run_id',v_run,'contender_id','tablet-a'));
  v_second:=public.probar_ultima_unidad_resiliencia_v1(jsonb_build_object(
    'run_id',v_run,'contender_id','tablet-b'));
  assert coalesce((v_first->>'acquired')::boolean,false)
    and not coalesce((v_second->>'acquired')::boolean,true),
    'H94 vendio dos veces la ultima unidad sintetica.';
  v_lease_a:=public.probar_lease_resiliencia_v1(jsonb_build_object(
    'run_id',v_run,'worker_id','worker-a'));
  v_lease_b:=public.probar_lease_resiliencia_v1(jsonb_build_object(
    'run_id',v_run,'worker_id','worker-b'));
  assert coalesce((v_lease_a->>'acquired')::boolean,false)
    and not coalesce((v_lease_b->>'acquired')::boolean,true),
    'H94 entrego el mismo lease a dos workers.';
  begin
    perform public.probar_atomicidad_resiliencia_v1(jsonb_build_object(
      'run_id',v_run,'attempt_id','rollback-1','force_failure',true));
  exception when sqlstate '40001' then v_failed:=true; end;
  assert v_failed,'H94 no genero el rollback controlado.';
  v_snapshot:=public.momos_resilience_probe_snapshot_v1(v_run);
  assert (v_snapshot#>>'{resources,ATOMIC_COUNTER,counter}')::integer=0,
    'H94 conservo una escritura parcial despues del fallo.';
  perform public.probar_atomicidad_resiliencia_v1(jsonb_build_object(
    'run_id',v_run,'attempt_id','commit-1','force_failure',false));
end $$;

do $$
declare v_run uuid:=(select run_id from h94_context); v_codes text[]:=array[
  'IDEMPOTENT_REPLAY','LOST_RESPONSE_RETRY','LAST_UNIT_RACE','LEASE_CONTENTION',
  'ATOMIC_ROLLBACK','PARALLEL_READS','REALTIME_COALESCING','FINAL_RECONCILIATION'];
  v_code text; v_scenarios jsonb:='[]'::jsonb; v_result jsonb; v_final jsonb;
begin
  foreach v_code in array v_codes loop
    v_scenarios:=v_scenarios||jsonb_build_array(jsonb_build_object(
      'code',v_code,'passed',true,'requestCount',15,
      'duplicateCount',case when v_code in ('IDEMPOTENT_REPLAY','LOST_RESPONSE_RETRY') then 1 else 0 end,
      'conflictCount',case when v_code in ('LAST_UNIT_RACE','LEASE_CONTENTION') then 1 else 0 end,
      'p95Ms',125,'invariantFailures',0));
  end loop;
  v_result:=public.registrar_resultados_resiliencia_v1(jsonb_build_object(
    'run_id',v_run,'scenarios',v_scenarios));
  perform public.registrar_resultados_resiliencia_v1(jsonb_build_object(
    'run_id',v_run,'scenarios',v_scenarios));
  assert (v_result->>'scenarioCount')::integer=8
    and not coalesce((v_result->>'containsCustomerPii')::boolean,true)
    and not coalesce((v_result->>'containsFreeText')::boolean,true),
    'H94 no sello ocho resultados compactos.';
  v_final:=public.finalizar_certificacion_resiliencia_v1(v_run);
  assert v_final->>'status'='Validado sintetico'
    and coalesce((v_final->>'syntheticValidated')::boolean,false)
    and not coalesce((v_final->>'certified')::boolean,true)
    and coalesce((v_final->>'reconciled')::boolean,false)
    and (v_final->>'invariantFailures')::integer=0,
    'H94 confundio una prueba sintetica con certificacion staging.';
end $$;

reset role;
do $$
declare v_failed boolean:=false;
begin
  begin
    update public.operational_resilience_runs set p95_ms=1
      where id=(select run_id from h94_context);
  exception when sqlstate '55000' then v_failed:=true; end;
  assert v_failed,'H94 permitio reescribir una corrida sellada.';
  assert (select count(*) from public.orders)=(select orders_before from h94_context)
    and (select count(*) from public.inventory_movements)=(select movements_before from h94_context)
    and (select count(*) from public.production_batches)=(select batches_before from h94_context),
    'H94 altero datos comerciales durante los probes.';
end $$;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select admin_auth::text from h94_context),'role','authenticated'
)::text,true);
do $$
declare v_snapshot jsonb; v_text text;
begin
  v_snapshot:=public.momos_resilience_snapshot_v1(); v_text:=lower(v_snapshot::text);
  assert v_snapshot->>'contract'='momos.resilience.v1'
    and v_snapshot#>>'{latest,status}'='Validado sintetico'
    and not coalesce((v_snapshot#>>'{certification,valid}')::boolean,true)
    and coalesce((v_snapshot->>'isolated')::boolean,false)
    and not coalesce((v_snapshot->>'containsCustomerPii')::boolean,true)
    and not coalesce((v_snapshot->>'containsSecrets')::boolean,true)
    and not coalesce((v_snapshot->>'containsPaths')::boolean,true)
    and not coalesce((v_snapshot->>'containsFreeText')::boolean,true)
    and not coalesce((v_snapshot->>'businessMutation')::boolean,true),
    'El snapshot H94 no distingue validacion sintetica de certificacion.';
  assert v_text !~ 'telefono|direccion|customer|storage_path|api[_-]?key|access[_-]?token|@momos.test',
    'H94 expuso PII, rutas o secretos.';
end $$;

reset role;
select 'TESTS_OK — concurrencia/carga/caos aislado/idempotencia/ultima unidad/lease/rollback/RBAC PASS, rollback total' as resultado;
rollback;
