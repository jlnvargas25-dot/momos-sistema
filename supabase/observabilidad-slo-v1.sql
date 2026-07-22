-- MOMOS OPS · H95 Observabilidad y SLO v1
-- Extiende el Centro de Salud H92 con telemetria agregada. Nunca conserva
-- requests, rutas, payloads, actores, clientes, mensajes libres ni secretos.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260721'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260721_94_certificacion_concurrencia_caos') then
    raise exception 'Falta H94 certificacion de concurrencia y caos.';
  end if;
  if to_regprocedure('public._momos_h92_hash(jsonb)') is null
     or to_regclass('public.operational_health_state') is null then
    raise exception 'Falta H92 Centro de Salud Operativa.';
  end if;
end $$;

create table if not exists public.operational_slo_policies(
  service_code text primary key check(service_code in (
    'OPS_FRONTEND','RPC_CORE','DATABASE','REALTIME','STORAGE','CONNECTORS','HEALTH_MONITOR'
  )),
  title_code text not null check(title_code ~ '^[A-Z0-9_]{3,64}$'),
  target_availability numeric(7,6) not null check(target_availability between 0.900000 and 0.999999),
  target_p95_ms integer not null check(target_p95_ms between 50 and 30000),
  max_saturation_pct numeric(5,2) not null check(max_saturation_pct between 1 and 100),
  max_queue_depth integer not null check(max_queue_depth between 0 and 1000000),
  max_staleness_minutes integer not null check(max_staleness_minutes between 2 and 1440),
  enabled boolean not null default true,
  version bigint not null default 1 check(version>0),
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.operational_slo_policies(
  service_code,title_code,target_availability,target_p95_ms,
  max_saturation_pct,max_queue_depth,max_staleness_minutes
) values
  ('OPS_FRONTEND','SLO_OPS_FRONTEND',0.990000,1500,80,20,90),
  ('RPC_CORE','SLO_RPC_CORE',0.995000,800,75,20,15),
  ('DATABASE','SLO_DATABASE',0.999000,500,70,10,10),
  ('REALTIME','SLO_REALTIME',0.990000,1000,80,100,10),
  ('STORAGE','SLO_STORAGE',0.990000,1500,80,50,30),
  ('CONNECTORS','SLO_CONNECTORS',0.980000,2500,80,100,30),
  ('HEALTH_MONITOR','SLO_HEALTH_MONITOR',0.990000,2500,70,5,10)
on conflict(service_code) do nothing;

create table if not exists public.operational_slo_buckets(
  service_code text not null references public.operational_slo_policies(service_code) on delete restrict,
  bucket_at timestamptz not null check(bucket_at=date_trunc('minute',bucket_at)),
  sample_count bigint not null check(sample_count>0),
  success_count bigint not null check(success_count>=0),
  error_count bigint not null check(error_count>=0),
  latency_lte_100 bigint not null default 0 check(latency_lte_100>=0),
  latency_lte_250 bigint not null default 0 check(latency_lte_250>=0),
  latency_lte_500 bigint not null default 0 check(latency_lte_500>=0),
  latency_lte_1000 bigint not null default 0 check(latency_lte_1000>=0),
  latency_lte_2500 bigint not null default 0 check(latency_lte_2500>=0),
  latency_gt_2500 bigint not null default 0 check(latency_gt_2500>=0),
  saturation_pct numeric(5,2) check(saturation_pct is null or saturation_pct between 0 and 100),
  queue_depth integer check(queue_depth is null or queue_depth between 0 and 1000000),
  source_kind text not null check(source_kind in ('worker','server','mixed')),
  aggregate_fingerprint text not null check(aggregate_fingerprint ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(service_code,bucket_at),
  check(success_count+error_count=sample_count),
  check(latency_lte_100+latency_lte_250+latency_lte_500+latency_lte_1000+
    latency_lte_2500+latency_gt_2500=sample_count)
);
create index if not exists operational_slo_buckets_recent_idx
  on public.operational_slo_buckets(bucket_at desc,service_code);

create table if not exists public.operational_slo_ingest_receipts(
  idempotency_key uuid primary key,
  service_code text not null references public.operational_slo_policies(service_code) on delete restrict,
  bucket_at timestamptz not null,
  payload_fingerprint text not null check(payload_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists operational_slo_receipts_created_idx
  on public.operational_slo_ingest_receipts(created_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'operational_slo_policies','operational_slo_buckets','operational_slo_ingest_receipts'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create or replace function public._momos_h95_latency_upper_ms(
  p_samples bigint,p_lte_100 bigint,p_lte_250 bigint,p_lte_500 bigint,
  p_lte_1000 bigint,p_lte_2500 bigint,p_gt_2500 bigint,p_percentile numeric
) returns integer language plpgsql immutable
set search_path=pg_catalog,public,pg_temp as $$
declare v_target bigint;
begin
  if coalesce(p_samples,0)<=0 then return null; end if;
  if p_percentile<=0 or p_percentile>1 then raise exception 'Percentil SLO invalido.'; end if;
  v_target:=ceil(p_samples*p_percentile)::bigint;
  if p_lte_100>=v_target then return 100; end if;
  if p_lte_100+p_lte_250>=v_target then return 250; end if;
  if p_lte_100+p_lte_250+p_lte_500>=v_target then return 500; end if;
  if p_lte_100+p_lte_250+p_lte_500+p_lte_1000>=v_target then return 1000; end if;
  if p_lte_100+p_lte_250+p_lte_500+p_lte_1000+p_lte_2500>=v_target then return 2500; end if;
  return 5000;
end $$;
revoke all on function public._momos_h95_latency_upper_ms(bigint,bigint,bigint,bigint,bigint,bigint,bigint,numeric)
  from public,anon,authenticated,service_role;

create or replace function public.registrar_telemetria_slo_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_key uuid; v_service text; v_bucket timestamptz; v_source text;
  v_samples bigint; v_success bigint; v_errors bigint;
  v_100 bigint; v_250 bigint; v_500 bigint; v_1000 bigint; v_2500 bigint; v_gt bigint;
  v_saturation numeric; v_queue integer; v_payload jsonb; v_fp text;
  v_existing public.operational_slo_ingest_receipts%rowtype;
  v_bucket_row public.operational_slo_buckets%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Solo un proceso privado puede reportar SLO.' using errcode='42501';
  end if;
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in (
       'idempotency_key','service_code','bucket_at','sample_count','success_count','error_count',
       'latency_buckets','saturation_pct','queue_depth','source_kind'
     )) then raise exception 'La telemetria SLO contiene campos no permitidos.'; end if;
  if jsonb_typeof(p->'latency_buckets') is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p->'latency_buckets') x(key) where key not in (
       'lte_100','lte_250','lte_500','lte_1000','lte_2500','gt_2500'
     )) then raise exception 'El histograma SLO no cumple el contrato cerrado.'; end if;

  v_key:=(p->>'idempotency_key')::uuid;
  v_service:=coalesce(p->>'service_code','');
  v_bucket:=date_trunc('minute',(p->>'bucket_at')::timestamptz);
  v_source:=coalesce(p->>'source_kind','');
  v_samples:=(p->>'sample_count')::bigint;
  v_success:=(p->>'success_count')::bigint;
  v_errors:=(p->>'error_count')::bigint;
  v_100:=coalesce((p->'latency_buckets'->>'lte_100')::bigint,0);
  v_250:=coalesce((p->'latency_buckets'->>'lte_250')::bigint,0);
  v_500:=coalesce((p->'latency_buckets'->>'lte_500')::bigint,0);
  v_1000:=coalesce((p->'latency_buckets'->>'lte_1000')::bigint,0);
  v_2500:=coalesce((p->'latency_buckets'->>'lte_2500')::bigint,0);
  v_gt:=coalesce((p->'latency_buckets'->>'gt_2500')::bigint,0);
  v_saturation:=nullif(p->>'saturation_pct','')::numeric;
  v_queue:=nullif(p->>'queue_depth','')::integer;
  if not exists(select 1 from public.operational_slo_policies
      where service_code=v_service and enabled)
     or v_source not in ('worker','server')
     or v_bucket<date_trunc('minute',clock_timestamp()-interval '10 minutes')
     or v_bucket>date_trunc('minute',clock_timestamp()+interval '1 minute')
     or v_samples not between 1 and 1000000
     or v_success<0 or v_errors<0 or v_success+v_errors<>v_samples
     or v_100<0 or v_250<0 or v_500<0 or v_1000<0 or v_2500<0 or v_gt<0
     or v_100+v_250+v_500+v_1000+v_2500+v_gt<>v_samples
     or (v_saturation is not null and v_saturation not between 0 and 100)
     or (v_queue is not null and v_queue not between 0 and 1000000) then
    raise exception 'La telemetria SLO no cumple los limites operativos.';
  end if;

  v_payload:=p-'idempotency_key';
  v_fp:=public._momos_h92_hash(v_payload);
  -- Serializa la misma muestra para que dos reintentos concurrentes vean el
  -- recibo confirmado y nunca sumen dos veces el histograma del minuto.
  perform pg_advisory_xact_lock(hashtextextended('momos-h95-slo:'||v_key::text,0));
  select * into v_existing from public.operational_slo_ingest_receipts
    where idempotency_key=v_key;
  if v_existing.idempotency_key is not null then
    if v_existing.payload_fingerprint<>v_fp then
      raise exception 'La llave SLO ya existe con otro contrato.' using errcode='23505';
    end if;
    return jsonb_build_object('ok',true,'replayed',true,'serviceCode',v_existing.service_code,
      'bucketAt',v_existing.bucket_at,'containsCustomerPii',false,'containsSecrets',false);
  end if;

  insert into public.operational_slo_ingest_receipts(
    idempotency_key,service_code,bucket_at,payload_fingerprint
  ) values(v_key,v_service,v_bucket,v_fp);
  insert into public.operational_slo_buckets(
    service_code,bucket_at,sample_count,success_count,error_count,
    latency_lte_100,latency_lte_250,latency_lte_500,latency_lte_1000,
    latency_lte_2500,latency_gt_2500,saturation_pct,queue_depth,source_kind,
    aggregate_fingerprint
  ) values(
    v_service,v_bucket,v_samples,v_success,v_errors,v_100,v_250,v_500,v_1000,
    v_2500,v_gt,v_saturation,v_queue,v_source,v_fp
  ) on conflict(service_code,bucket_at) do update set
    sample_count=public.operational_slo_buckets.sample_count+excluded.sample_count,
    success_count=public.operational_slo_buckets.success_count+excluded.success_count,
    error_count=public.operational_slo_buckets.error_count+excluded.error_count,
    latency_lte_100=public.operational_slo_buckets.latency_lte_100+excluded.latency_lte_100,
    latency_lte_250=public.operational_slo_buckets.latency_lte_250+excluded.latency_lte_250,
    latency_lte_500=public.operational_slo_buckets.latency_lte_500+excluded.latency_lte_500,
    latency_lte_1000=public.operational_slo_buckets.latency_lte_1000+excluded.latency_lte_1000,
    latency_lte_2500=public.operational_slo_buckets.latency_lte_2500+excluded.latency_lte_2500,
    latency_gt_2500=public.operational_slo_buckets.latency_gt_2500+excluded.latency_gt_2500,
    saturation_pct=greatest(public.operational_slo_buckets.saturation_pct,excluded.saturation_pct),
    queue_depth=greatest(public.operational_slo_buckets.queue_depth,excluded.queue_depth),
    source_kind=case when public.operational_slo_buckets.source_kind=excluded.source_kind
      then excluded.source_kind else 'mixed' end,
    aggregate_fingerprint=public._momos_h92_hash(jsonb_build_object(
      'previous',public.operational_slo_buckets.aggregate_fingerprint,'incoming',excluded.aggregate_fingerprint
    )),updated_at=clock_timestamp()
  returning * into v_bucket_row;
  delete from public.operational_slo_ingest_receipts where created_at<clock_timestamp()-interval '35 days';
  delete from public.operational_slo_buckets where bucket_at<clock_timestamp()-interval '35 days';
  return jsonb_build_object('ok',true,'replayed',false,'serviceCode',v_service,
    'bucketAt',v_bucket,'sampleCount',v_bucket_row.sample_count,
    'fingerprint',v_bucket_row.aggregate_fingerprint,
    'containsCustomerPii',false,'containsSecrets',false);
end $$;

create or replace function public.configurar_slo_operativo_v1(
  p_service_code text,p_expected_version bigint,p_target_availability numeric,
  p_target_p95_ms integer,p_max_saturation_pct numeric,p_max_queue_depth integer,
  p_max_staleness_minutes integer,p_enabled boolean
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_policy public.operational_slo_policies%rowtype;
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede configurar SLO.'; end if;
  if p_target_availability not between 0.900000 and 0.999999
     or p_target_p95_ms not between 50 and 30000
     or p_max_saturation_pct not between 1 and 100
     or p_max_queue_depth not between 0 and 1000000
     or p_max_staleness_minutes not between 2 and 1440 then
    raise exception 'La politica SLO no cumple los limites.';
  end if;
  update public.operational_slo_policies set
    target_availability=p_target_availability,target_p95_ms=p_target_p95_ms,
    max_saturation_pct=p_max_saturation_pct,max_queue_depth=p_max_queue_depth,
    max_staleness_minutes=p_max_staleness_minutes,enabled=p_enabled,
    version=version+1,updated_at=clock_timestamp()
  where service_code=p_service_code and version=p_expected_version
  returning * into v_policy;
  if v_policy.service_code is null then
    raise exception 'La politica SLO cambio o no existe; recarga antes de guardar.' using errcode='55000';
  end if;
  return jsonb_build_object('ok',true,'serviceCode',v_policy.service_code,
    'version',v_policy.version,'enabled',v_policy.enabled);
end $$;

create or replace function public.momos_operational_slo_snapshot_v1(p_window_minutes integer default 60)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_policy public.operational_slo_policies%rowtype; v_services jsonb:='[]'::jsonb;
  v_samples bigint; v_success bigint; v_errors bigint;
  v_100 bigint; v_250 bigint; v_500 bigint; v_1000 bigint; v_2500 bigint; v_gt bigint;
  v_saturation numeric; v_queue integer; v_last timestamptz;
  v_availability numeric; v_error_rate numeric; v_p50 integer; v_p95 integer; v_p99 integer;
  v_allowed bigint; v_remaining bigint; v_status text; v_stale boolean;
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede consultar SLO.'; end if;
  if p_window_minutes not between 5 and 1440 then raise exception 'Ventana SLO invalida.'; end if;
  for v_policy in select * from public.operational_slo_policies order by service_code loop
    select coalesce(sum(sample_count),0),coalesce(sum(success_count),0),coalesce(sum(error_count),0),
      coalesce(sum(latency_lte_100),0),coalesce(sum(latency_lte_250),0),
      coalesce(sum(latency_lte_500),0),coalesce(sum(latency_lte_1000),0),
      coalesce(sum(latency_lte_2500),0),coalesce(sum(latency_gt_2500),0),
      max(saturation_pct),max(queue_depth),max(bucket_at)
    into v_samples,v_success,v_errors,v_100,v_250,v_500,v_1000,v_2500,v_gt,
      v_saturation,v_queue,v_last
    from public.operational_slo_buckets
    where service_code=v_policy.service_code
      and bucket_at>=date_trunc('minute',clock_timestamp()-make_interval(mins=>p_window_minutes));
    v_availability:=case when v_samples>0 then round(v_success::numeric/v_samples,6) end;
    v_error_rate:=case when v_samples>0 then round(v_errors::numeric/v_samples,6) end;
    v_p50:=public._momos_h95_latency_upper_ms(v_samples,v_100,v_250,v_500,v_1000,v_2500,v_gt,0.50);
    v_p95:=public._momos_h95_latency_upper_ms(v_samples,v_100,v_250,v_500,v_1000,v_2500,v_gt,0.95);
    v_p99:=public._momos_h95_latency_upper_ms(v_samples,v_100,v_250,v_500,v_1000,v_2500,v_gt,0.99);
    v_allowed:=floor(v_samples*(1-v_policy.target_availability))::bigint;
    v_remaining:=v_allowed-v_errors;
    v_stale:=v_last is null or v_last<date_trunc('minute',clock_timestamp()-make_interval(mins=>v_policy.max_staleness_minutes));
    v_status:=case
      when not v_policy.enabled then 'Deshabilitado'
      when v_samples=0 then 'Sin datos'
      when v_stale then 'Desactualizado'
      when v_availability<v_policy.target_availability
        or v_p95>v_policy.target_p95_ms
        or coalesce(v_saturation,0)>v_policy.max_saturation_pct
        or coalesce(v_queue,0)>v_policy.max_queue_depth then 'Fuera de SLO'
      when v_allowed>0 and v_remaining<=ceil(v_allowed*0.25) then 'En riesgo'
      else 'Saludable' end;
    v_services:=v_services||jsonb_build_array(jsonb_build_object(
      'serviceCode',v_policy.service_code,'titleCode',v_policy.title_code,
      'status',v_status,'enabled',v_policy.enabled,'version',v_policy.version,
      'sampleCount',v_samples,'successCount',v_success,'errorCount',v_errors,
      'availability',v_availability,'errorRate',v_error_rate,
      'latency',jsonb_build_object('method','histogram-upper-bound','p50Ms',v_p50,'p95Ms',v_p95,'p99Ms',v_p99),
      'saturationMaxPct',v_saturation,'queueMax',v_queue,'lastBucketAt',v_last,'stale',v_stale,
      'target',jsonb_build_object('availability',v_policy.target_availability,
        'p95Ms',v_policy.target_p95_ms,'maxSaturationPct',v_policy.max_saturation_pct,
        'maxQueueDepth',v_policy.max_queue_depth,'maxStalenessMinutes',v_policy.max_staleness_minutes),
      'errorBudget',jsonb_build_object('allowedErrors',v_allowed,'remainingErrors',v_remaining)
    ));
  end loop;
  return jsonb_build_object(
    'contract','momos.operational-slo.v1','windowMinutes',p_window_minutes,
    'generatedAt',clock_timestamp(),'services',v_services,
    'counts',jsonb_build_object(
      'healthy',(select count(*) from jsonb_array_elements(v_services) x where x->>'status'='Saludable'),
      'atRisk',(select count(*) from jsonb_array_elements(v_services) x where x->>'status'='En riesgo'),
      'outside',(select count(*) from jsonb_array_elements(v_services) x where x->>'status'='Fuera de SLO'),
      'withoutData',(select count(*) from jsonb_array_elements(v_services) x where x->>'status' in ('Sin datos','Desactualizado'))
    ),
    'containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false
  );
end $$;

revoke all on function public.registrar_telemetria_slo_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.configurar_slo_operativo_v1(text,bigint,numeric,integer,numeric,integer,integer,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.momos_operational_slo_snapshot_v1(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.registrar_telemetria_slo_v1(jsonb) to service_role;
grant execute on function public.configurar_slo_operativo_v1(text,bigint,numeric,integer,numeric,integer,integer,boolean) to authenticated;
grant execute on function public.momos_operational_slo_snapshot_v1(integer) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260721_95_observabilidad_slo',
  'SLO agregados p50/p95/p99, disponibilidad, error budget, saturacion y colas sin PII')
on conflict(id) do nothing;

commit;
