-- MOMOS OPS · H94 Certificacion de concurrencia, carga y caos v1
-- Los probes viven en un dominio sintetico aislado. Nunca crean pedidos,
-- consumen inventario ni alteran resultados comerciales.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260721'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260721_93_continuidad_recuperacion') then
    raise exception 'Falta H93 continuidad y recuperacion.';
  end if;
  if to_regprocedure('public._momos_h92_hash(jsonb)') is null
     or to_regclass('public.operational_health_state') is null then
    raise exception 'Faltan los contratos de salud H92.';
  end if;
end $$;

alter table public.operational_health_state
  add column if not exists last_resilience_run_at timestamptz,
  add column if not exists resilience_certified_until timestamptz;

create table if not exists public.operational_resilience_runs(
  id uuid primary key,
  run_key text not null unique check(run_key ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  environment text not null check(environment in ('Sintetico','Staging')),
  runner_version text not null check(runner_version ~ '^[A-Za-z0-9_.-]{1,40}$'),
  status text not null default 'En curso'
    check(status in ('En curso','Validado sintetico','Certificado','Fallido')),
  concurrency integer not null check(concurrency between 8 and 64),
  target_request_count integer not null check(target_request_count between 100 and 10000),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  total_requests integer not null default 0 check(total_requests>=0),
  duplicate_count integer not null default 0 check(duplicate_count>=0),
  conflict_count integer not null default 0 check(conflict_count>=0),
  invariant_failures integer not null default 0 check(invariant_failures>=0),
  p95_ms numeric,
  input_fingerprint text not null check(input_fingerprint ~ '^[0-9a-f]{64}$'),
  result_fingerprint text check(result_fingerprint is null or result_fingerprint ~ '^[0-9a-f]{64}$'),
  check((status='En curso' and completed_at is null and result_fingerprint is null)
    or (status<>'En curso' and completed_at is not null and result_fingerprint is not null))
);

create table if not exists public.operational_resilience_resources(
  run_id uuid not null references public.operational_resilience_runs(id) on delete restrict,
  resource_code text not null check(resource_code in (
    'IDEMPOTENCY_COUNTER','LAST_UNIT','LEASE','ATOMIC_COUNTER'
  )),
  available integer not null default 0 check(available>=0),
  consumed integer not null default 0 check(consumed>=0),
  counter bigint not null default 0 check(counter>=0),
  owner_fingerprint text check(owner_fingerprint is null or owner_fingerprint ~ '^[0-9a-f]{64}$'),
  lease_until timestamptz,
  version bigint not null default 1 check(version>0),
  primary key(run_id,resource_code)
);

create table if not exists public.operational_resilience_receipts(
  run_id uuid not null references public.operational_resilience_runs(id) on delete restrict,
  operation_code text not null check(operation_code in ('IDEMPOTENT_WRITE','LOST_RESPONSE_RETRY')),
  idempotency_key uuid not null,
  payload_fingerprint text not null check(payload_fingerprint ~ '^[0-9a-f]{64}$'),
  sequence_no bigint not null check(sequence_no>0),
  created_at timestamptz not null default clock_timestamp(),
  primary key(run_id,operation_code,idempotency_key)
);

create table if not exists public.operational_resilience_scenarios(
  run_id uuid not null references public.operational_resilience_runs(id) on delete restrict,
  scenario_code text not null check(scenario_code in (
    'IDEMPOTENT_REPLAY','LOST_RESPONSE_RETRY','LAST_UNIT_RACE','LEASE_CONTENTION',
    'ATOMIC_ROLLBACK','PARALLEL_READS','REALTIME_COALESCING','FINAL_RECONCILIATION'
  )),
  passed boolean not null,
  request_count integer not null check(request_count>=1),
  duplicate_count integer not null default 0 check(duplicate_count>=0),
  conflict_count integer not null default 0 check(conflict_count>=0),
  p95_ms numeric not null check(p95_ms>=0),
  invariant_failures integer not null default 0 check(invariant_failures>=0),
  evidence_fingerprint text not null check(evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(run_id,scenario_code)
);

do $$
declare t text;
begin
  foreach t in array array[
    'operational_resilience_runs','operational_resilience_resources',
    'operational_resilience_receipts','operational_resilience_scenarios'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create or replace function public._momos_h94_service_only()
returns void language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Solo el runner privado de resiliencia puede ejecutar este contrato.' using errcode='42501';
  end if;
end $$;
revoke all on function public._momos_h94_service_only()
  from public,anon,authenticated,service_role;

create or replace function public._momos_h94_assert_open(p_run uuid)
returns public.operational_resilience_runs language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_run public.operational_resilience_runs%rowtype;
begin
  perform public._momos_h94_service_only();
  select * into v_run from public.operational_resilience_runs where id=p_run for update;
  if v_run.id is null then raise exception 'La corrida H94 no existe.'; end if;
  if v_run.status<>'En curso' then raise exception 'La corrida H94 ya esta sellada.' using errcode='55000'; end if;
  return v_run;
end $$;
revoke all on function public._momos_h94_assert_open(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.iniciar_certificacion_resiliencia_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_id uuid:=gen_random_uuid(); v_key text; v_environment text; v_version text;
  v_concurrency integer; v_target integer; v_confirmation text; v_fp text;
  v_existing public.operational_resilience_runs%rowtype;
begin
  perform public._momos_h94_service_only();
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in (
       'run_key','environment','runner_version','concurrency','target_request_count','staging_confirmation'
     )) then raise exception 'El inicio H94 contiene campos no permitidos.'; end if;
  v_key:=btrim(coalesce(p->>'run_key',''));
  v_environment:=coalesce(p->>'environment','');
  v_version:=btrim(coalesce(p->>'runner_version',''));
  v_concurrency:=(p->>'concurrency')::integer;
  v_target:=(p->>'target_request_count')::integer;
  v_confirmation:=coalesce(p->>'staging_confirmation','');
  if v_key !~ '^[A-Za-z0-9_.:-]{8,120}$'
     or v_environment not in ('Sintetico','Staging')
     or v_version !~ '^[A-Za-z0-9_.-]{1,40}$'
     or v_concurrency not between 8 and 64
     or v_target not between 100 and 10000 then
    raise exception 'El inicio H94 no cumple el contrato.';
  end if;
  if v_environment='Staging' and v_confirmation<>'CERTIFY_NON_PRODUCTION' then
    raise exception 'Staging exige confirmacion explicita y nunca debe apuntar a produccion.';
  end if;
  v_fp:=public._momos_h92_hash(jsonb_build_object('runKey',v_key,'environment',v_environment,
    'runnerVersion',v_version,'concurrency',v_concurrency,'targetRequestCount',v_target));
  select * into v_existing from public.operational_resilience_runs where run_key=v_key;
  if v_existing.id is not null then
    if v_existing.input_fingerprint<>v_fp then
      raise exception 'La clave H94 ya existe con otro contrato.' using errcode='23505';
    end if;
    return jsonb_build_object('runId',v_existing.id,'status',v_existing.status,
      'replayed',true,'isolated',true,'businessMutation',false);
  end if;
  insert into public.operational_resilience_runs(
    id,run_key,environment,runner_version,concurrency,target_request_count,input_fingerprint
  ) values(v_id,v_key,v_environment,v_version,v_concurrency,v_target,v_fp);
  insert into public.operational_resilience_resources(run_id,resource_code,available)
  values(v_id,'IDEMPOTENCY_COUNTER',0),(v_id,'LAST_UNIT',1),(v_id,'LEASE',0),(v_id,'ATOMIC_COUNTER',0);
  return jsonb_build_object('runId',v_id,'status','En curso','replayed',false,
    'isolated',true,'businessMutation',false);
end $$;

create or replace function public.probar_idempotencia_resiliencia_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_run uuid; v_operation text; v_key uuid; v_payload jsonb; v_fp text;
  v_receipt public.operational_resilience_receipts%rowtype; v_sequence bigint;
begin
  perform public._momos_h94_service_only();
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key)
       where key not in ('run_id','operation_code','idempotency_key','payload')) then
    raise exception 'El probe de idempotencia contiene campos no permitidos.';
  end if;
  v_run:=(p->>'run_id')::uuid; v_operation:=coalesce(p->>'operation_code','');
  v_key:=(p->>'idempotency_key')::uuid; v_payload:=p->'payload';
  if v_operation not in ('IDEMPOTENT_WRITE','LOST_RESPONSE_RETRY')
     or jsonb_typeof(v_payload) is distinct from 'object'
     or pg_column_size(v_payload)>1024
     or exists(select 1 from jsonb_object_keys(v_payload) x(key)
       where key not in ('sequence','kind','amount')) then
    raise exception 'El payload sintetico no cumple el contrato cerrado.';
  end if;
  perform public._momos_h94_assert_open(v_run);
  perform pg_advisory_xact_lock(hashtextextended(v_run::text||':'||v_operation||':'||v_key::text,0));
  v_fp:=public._momos_h92_hash(v_payload);
  select * into v_receipt from public.operational_resilience_receipts
    where run_id=v_run and operation_code=v_operation and idempotency_key=v_key;
  if v_receipt.idempotency_key is not null then
    if v_receipt.payload_fingerprint<>v_fp then
      raise exception 'La misma clave H94 no puede cambiar de payload.' using errcode='23505';
    end if;
    return jsonb_build_object('ok',true,'duplicate',true,'sequence',v_receipt.sequence_no,
      'businessMutation',false);
  end if;
  update public.operational_resilience_resources set counter=counter+1,version=version+1
    where run_id=v_run and resource_code='IDEMPOTENCY_COUNTER'
    returning counter into v_sequence;
  insert into public.operational_resilience_receipts(
    run_id,operation_code,idempotency_key,payload_fingerprint,sequence_no
  ) values(v_run,v_operation,v_key,v_fp,v_sequence);
  return jsonb_build_object('ok',true,'duplicate',false,'sequence',v_sequence,
    'businessMutation',false);
end $$;

create or replace function public.probar_ultima_unidad_resiliencia_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_run uuid; v_contender text; v_resource public.operational_resilience_resources%rowtype;
begin
  perform public._momos_h94_service_only();
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in ('run_id','contender_id')) then
    raise exception 'El probe de ultima unidad contiene campos no permitidos.';
  end if;
  v_run:=(p->>'run_id')::uuid; v_contender:=coalesce(p->>'contender_id','');
  if v_contender !~ '^[A-Za-z0-9_.:-]{3,80}$' then raise exception 'Contendiente H94 invalido.'; end if;
  perform public._momos_h94_assert_open(v_run);
  select * into v_resource from public.operational_resilience_resources
    where run_id=v_run and resource_code='LAST_UNIT' for update;
  if v_resource.available>0 then
    update public.operational_resilience_resources set available=available-1,consumed=consumed+1,
      owner_fingerprint=public._momos_h92_hash(to_jsonb(v_contender)),version=version+1
      where run_id=v_run and resource_code='LAST_UNIT';
    return jsonb_build_object('acquired',true,'remaining',0,'businessMutation',false);
  end if;
  return jsonb_build_object('acquired',false,'remaining',0,'businessMutation',false);
end $$;

create or replace function public.probar_lease_resiliencia_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_run uuid; v_worker text; v_owner text; v_resource public.operational_resilience_resources%rowtype;
begin
  perform public._momos_h94_service_only();
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in ('run_id','worker_id')) then
    raise exception 'El probe de lease contiene campos no permitidos.';
  end if;
  v_run:=(p->>'run_id')::uuid; v_worker:=coalesce(p->>'worker_id','');
  if v_worker !~ '^[A-Za-z0-9_.:-]{3,80}$' then raise exception 'Worker H94 invalido.'; end if;
  perform public._momos_h94_assert_open(v_run);
  v_owner:=public._momos_h92_hash(to_jsonb(v_worker));
  select * into v_resource from public.operational_resilience_resources
    where run_id=v_run and resource_code='LEASE' for update;
  if v_resource.owner_fingerprint is null or v_resource.lease_until<=clock_timestamp() then
    update public.operational_resilience_resources set owner_fingerprint=v_owner,
      lease_until=clock_timestamp()+interval '30 seconds',version=version+1
      where run_id=v_run and resource_code='LEASE';
    return jsonb_build_object('acquired',true,'reused',false,'businessMutation',false);
  end if;
  return jsonb_build_object('acquired',v_resource.owner_fingerprint=v_owner,
    'reused',v_resource.owner_fingerprint=v_owner,'businessMutation',false);
end $$;

create or replace function public.probar_atomicidad_resiliencia_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_run uuid; v_attempt text; v_fail boolean; v_counter bigint;
begin
  perform public._momos_h94_service_only();
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in ('run_id','attempt_id','force_failure')) then
    raise exception 'El probe atomico contiene campos no permitidos.';
  end if;
  v_run:=(p->>'run_id')::uuid; v_attempt:=coalesce(p->>'attempt_id','');
  v_fail:=coalesce((p->>'force_failure')::boolean,false);
  if v_attempt !~ '^[A-Za-z0-9_.:-]{3,80}$' then raise exception 'Intento H94 invalido.'; end if;
  perform public._momos_h94_assert_open(v_run);
  update public.operational_resilience_resources set counter=counter+1,version=version+1
    where run_id=v_run and resource_code='ATOMIC_COUNTER' returning counter into v_counter;
  if v_fail then
    -- P0001 mantiene el rollback transaccional, pero evita que la capa de
    -- infraestructura lo confunda con un fallo de serializacion reintentable.
    raise exception 'H94_CONTROLLED_ROLLBACK' using errcode='P0001';
  end if;
  return jsonb_build_object('ok',true,'counter',v_counter,'businessMutation',false);
end $$;

create or replace function public.momos_resilience_probe_snapshot_v1(p_run uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_run public.operational_resilience_runs%rowtype;
begin
  perform public._momos_h94_service_only();
  select * into v_run from public.operational_resilience_runs where id=p_run;
  if v_run.id is null then raise exception 'La corrida H94 no existe.'; end if;
  return jsonb_build_object('runId',v_run.id,'status',v_run.status,
    'receiptCount',(select count(*) from public.operational_resilience_receipts where run_id=p_run),
    'resources',coalesce((select jsonb_object_agg(resource_code,jsonb_build_object(
      'available',available,'consumed',consumed,'counter',counter,
      'owned',owner_fingerprint is not null,'version',version
    )) from public.operational_resilience_resources where run_id=p_run),'{}'::jsonb),
    'isolated',true,'containsCustomerPii',false,'containsSecrets',false,'businessMutation',false);
end $$;

create or replace function public.registrar_resultados_resiliencia_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_run uuid; v_item jsonb; v_code text; v_fp text;
  v_required text[]:=array['IDEMPOTENT_REPLAY','LOST_RESPONSE_RETRY','LAST_UNIT_RACE','LEASE_CONTENTION',
    'ATOMIC_ROLLBACK','PARALLEL_READS','REALTIME_COALESCING','FINAL_RECONCILIATION'];
  v_existing text;
begin
  perform public._momos_h94_service_only();
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in ('run_id','scenarios'))
     or jsonb_typeof(p->'scenarios') is distinct from 'array'
     or jsonb_array_length(p->'scenarios')<>8 then
    raise exception 'Los resultados H94 deben contener exactamente ocho escenarios.';
  end if;
  v_run:=(p->>'run_id')::uuid; perform public._momos_h94_assert_open(v_run);
  if (select count(distinct value->>'code') from jsonb_array_elements(p->'scenarios'))<>8
     or exists(select 1 from jsonb_array_elements(p->'scenarios') x(value)
       where not ((value->>'code')=any(v_required))) then
    raise exception 'Los escenarios H94 no coinciden con el contrato cerrado.';
  end if;
  for v_item in select value from jsonb_array_elements(p->'scenarios') loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or exists(select 1 from jsonb_object_keys(v_item) x(key) where key not in (
         'code','passed','requestCount','duplicateCount','conflictCount','p95Ms','invariantFailures'
       )) then raise exception 'Un resultado H94 contiene campos no permitidos.'; end if;
    v_code:=v_item->>'code';
    if (v_item->>'requestCount')::integer<1 or (v_item->>'duplicateCount')::integer<0
       or (v_item->>'conflictCount')::integer<0 or (v_item->>'p95Ms')::numeric<0
       or (v_item->>'invariantFailures')::integer<0 then
      raise exception 'Las metricas H94 son invalidas.';
    end if;
    v_fp:=public._momos_h92_hash(v_item);
    select evidence_fingerprint into v_existing from public.operational_resilience_scenarios
      where run_id=v_run and scenario_code=v_code;
    if v_existing is not null and v_existing<>v_fp then
      raise exception 'La evidencia H94 es inmutable.' using errcode='23505';
    end if;
    insert into public.operational_resilience_scenarios(
      run_id,scenario_code,passed,request_count,duplicate_count,conflict_count,
      p95_ms,invariant_failures,evidence_fingerprint
    ) values(v_run,v_code,(v_item->>'passed')::boolean,(v_item->>'requestCount')::integer,
      (v_item->>'duplicateCount')::integer,(v_item->>'conflictCount')::integer,
      (v_item->>'p95Ms')::numeric,(v_item->>'invariantFailures')::integer,v_fp)
    on conflict(run_id,scenario_code) do nothing;
  end loop;
  return jsonb_build_object('ok',true,'runId',v_run,'scenarioCount',8,
    'containsCustomerPii',false,'containsFreeText',false,'businessMutation',false);
end $$;

create or replace function public.finalizar_certificacion_resiliencia_v1(p_run uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_run public.operational_resilience_runs%rowtype; v_total integer; v_duplicates integer;
  v_conflicts integer; v_failures integer; v_p95 numeric; v_passed boolean; v_reconciled boolean;
  v_status text; v_fp text; v_scenarios jsonb; v_resources jsonb;
begin
  perform public._momos_h94_service_only();
  v_run:=public._momos_h94_assert_open(p_run);
  select count(*)=8 and bool_and(passed),coalesce(sum(request_count),0),
    coalesce(sum(duplicate_count),0),coalesce(sum(conflict_count),0),
    coalesce(sum(invariant_failures),0),coalesce(max(p95_ms),0),
    coalesce(jsonb_agg(jsonb_build_object('code',scenario_code,'passed',passed,
      'requests',request_count,'duplicates',duplicate_count,'conflicts',conflict_count,
      'p95Ms',p95_ms,'invariantFailures',invariant_failures,'fingerprint',evidence_fingerprint)
      order by scenario_code),'[]'::jsonb)
    into v_passed,v_total,v_duplicates,v_conflicts,v_failures,v_p95,v_scenarios
    from public.operational_resilience_scenarios where run_id=p_run;
  select jsonb_object_agg(resource_code,jsonb_build_object('available',available,
      'consumed',consumed,'counter',counter,'owned',owner_fingerprint is not null,'version',version))
    into v_resources from public.operational_resilience_resources where run_id=p_run;
  v_reconciled:=coalesce((v_resources#>>'{LAST_UNIT,available}')::integer,-1)=0
    and coalesce((v_resources#>>'{LAST_UNIT,consumed}')::integer,-1)=1
    and coalesce((v_resources#>>'{LEASE,owned}')::boolean,false)
    and coalesce((v_resources#>>'{ATOMIC_COUNTER,counter}')::bigint,-1)=1
    and coalesce((v_resources#>>'{IDEMPOTENCY_COUNTER,counter}')::bigint,-1)=
      (select count(*) from public.operational_resilience_receipts where run_id=p_run)
    and (select count(*) from public.operational_resilience_receipts where run_id=p_run)>=20;
  if coalesce(v_passed,false) and v_total>=v_run.target_request_count
     and v_failures=0 and v_p95<=2000 and v_reconciled then
    v_status:=case when v_run.environment='Staging' then 'Certificado' else 'Validado sintetico' end;
  else v_status:='Fallido'; end if;
  v_fp:=public._momos_h92_hash(jsonb_build_object('runId',p_run,'status',v_status,
    'totalRequests',v_total,'duplicates',v_duplicates,'conflicts',v_conflicts,
    'invariantFailures',v_failures,'p95Ms',v_p95,'scenarios',v_scenarios,'resources',v_resources));
  update public.operational_resilience_runs set status=v_status,completed_at=clock_timestamp(),
    total_requests=v_total,duplicate_count=v_duplicates,conflict_count=v_conflicts,
    invariant_failures=v_failures,p95_ms=v_p95,result_fingerprint=v_fp where id=p_run;
  update public.operational_health_state set last_resilience_run_at=clock_timestamp(),
    resilience_certified_until=case when v_status='Certificado'
      then clock_timestamp()+interval '30 days' else resilience_certified_until end,
    updated_at=clock_timestamp() where singleton;
  return jsonb_build_object('runId',p_run,'status',v_status,
    'certified',v_status='Certificado','syntheticValidated',v_status='Validado sintetico',
    'totalRequests',v_total,'p95Ms',v_p95,'invariantFailures',v_failures,
    'reconciled',v_reconciled,'fingerprint',v_fp,'businessMutation',false);
end $$;

create or replace function public.momos_resilience_snapshot_v1()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_latest public.operational_resilience_runs%rowtype;
  v_certified public.operational_resilience_runs%rowtype; v_state public.operational_health_state%rowtype;
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede consultar resiliencia.'; end if;
  select * into v_latest from public.operational_resilience_runs order by started_at desc,id desc limit 1;
  select * into v_certified from public.operational_resilience_runs
    where status='Certificado' order by completed_at desc,id desc limit 1;
  select * into v_state from public.operational_health_state where singleton;
  return jsonb_build_object('contract','momos.resilience.v1',
    'latest',jsonb_build_object('exists',v_latest.id is not null,'status',v_latest.status,
      'environment',v_latest.environment,'startedAt',v_latest.started_at,
      'completedAt',v_latest.completed_at,'concurrency',v_latest.concurrency,
      'totalRequests',v_latest.total_requests,'p95Ms',v_latest.p95_ms,
      'invariantFailures',v_latest.invariant_failures),
    'certification',jsonb_build_object('exists',v_certified.id is not null,
      'valid',coalesce(v_state.resilience_certified_until>=clock_timestamp(),false),
      'certifiedAt',v_certified.completed_at,'validUntil',v_state.resilience_certified_until),
    'isolated',true,'containsCustomerPii',false,'containsSecrets',false,
    'containsPaths',false,'containsFreeText',false,'businessMutation',false);
end $$;

create or replace function public._momos_h94_block_sealed_run()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if tg_op='DELETE' or old.status<>'En curso' then
    raise exception 'La certificacion H94 sellada es inmutable.' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function public._momos_h94_block_sealed_run()
  from public,anon,authenticated,service_role;

drop trigger if exists momos_h94_sealed_run_guard on public.operational_resilience_runs;
create trigger momos_h94_sealed_run_guard before update or delete
  on public.operational_resilience_runs for each row execute function public._momos_h94_block_sealed_run();

revoke all on function public.iniciar_certificacion_resiliencia_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.probar_idempotencia_resiliencia_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.probar_ultima_unidad_resiliencia_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.probar_lease_resiliencia_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.probar_atomicidad_resiliencia_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.momos_resilience_probe_snapshot_v1(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.registrar_resultados_resiliencia_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.finalizar_certificacion_resiliencia_v1(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.momos_resilience_snapshot_v1()
  from public,anon,authenticated,service_role;

grant execute on function public.iniciar_certificacion_resiliencia_v1(jsonb) to service_role;
grant execute on function public.probar_idempotencia_resiliencia_v1(jsonb) to service_role;
grant execute on function public.probar_ultima_unidad_resiliencia_v1(jsonb) to service_role;
grant execute on function public.probar_lease_resiliencia_v1(jsonb) to service_role;
grant execute on function public.probar_atomicidad_resiliencia_v1(jsonb) to service_role;
grant execute on function public.momos_resilience_probe_snapshot_v1(uuid) to service_role;
grant execute on function public.registrar_resultados_resiliencia_v1(jsonb) to service_role;
grant execute on function public.finalizar_certificacion_resiliencia_v1(uuid) to service_role;
grant execute on function public.momos_resilience_snapshot_v1() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260721_94_certificacion_concurrencia_caos',
  'Carga y caos aislados, idempotencia, ultima unidad, leases, rollback y certificacion staging')
on conflict(id) do nothing;

commit;
