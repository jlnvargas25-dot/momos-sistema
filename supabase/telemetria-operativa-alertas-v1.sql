-- MOMOS OPS · H96 Telemetria real y alertas operativas v1
-- Completa H95 con evidencia agregada del navegador, sondas privadas del
-- worker y alertas deduplicadas. Nunca persiste rutas, payloads, actores,
-- clientes, notas libres ni secretos.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260721'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260721_95_observabilidad_slo') then
    raise exception 'Falta H95 Observabilidad y SLO.';
  end if;
end $$;

-- H95 aceptaba solo worker/server. H96 agrega muestras agregadas del cliente.
do $$
declare v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid='public.operational_slo_buckets'::regclass
    and c.contype='c'
    and pg_get_constraintdef(c.oid) like '%source_kind%';
  if v_name is not null then
    execute format('alter table public.operational_slo_buckets drop constraint %I',v_name);
  end if;
  alter table public.operational_slo_buckets
    add constraint operational_slo_buckets_source_kind_check
    check(source_kind in ('client','worker','server','mixed'));
end $$;

create table if not exists public.operational_slo_alerts(
  id bigint generated always as identity primary key,
  service_code text not null references public.operational_slo_policies(service_code) on delete restrict,
  alert_code text not null check(alert_code in (
    'ERROR_BUDGET_EXHAUSTED','LATENCY_P95_HIGH','SATURATION_HIGH','QUEUE_HIGH','TELEMETRY_STALE'
  )),
  severity text not null check(severity in ('Alta','Critica')),
  status text not null default 'Abierta' check(status in ('Abierta','Recuperada')),
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  recovered_at timestamptz,
  occurrences bigint not null default 1 check(occurrences>0),
  window_minutes integer not null check(window_minutes between 5 and 1440),
  evidence_fingerprint text not null check(evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  owner_role text not null check(owner_role in ('Administrador')),
  check((status='Abierta' and recovered_at is null) or (status='Recuperada' and recovered_at is not null))
);
create unique index if not exists operational_slo_alerts_one_open_idx
  on public.operational_slo_alerts(service_code,alert_code) where status='Abierta';
create index if not exists operational_slo_alerts_recent_idx
  on public.operational_slo_alerts(last_seen_at desc,status);
alter table public.operational_slo_alerts enable row level security;
revoke all on table public.operational_slo_alerts from public,anon,authenticated,service_role;

create or replace function public._momos_h96_ingest_client_item(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_key uuid; v_service text; v_bucket timestamptz;
  v_samples bigint; v_success bigint; v_errors bigint;
  v_100 bigint; v_250 bigint; v_500 bigint; v_1000 bigint; v_2500 bigint; v_gt bigint;
  v_saturation numeric; v_queue integer; v_payload jsonb; v_fp text;
  v_existing public.operational_slo_ingest_receipts%rowtype;
begin
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in (
       'idempotency_key','service_code','bucket_at','sample_count','success_count','error_count',
       'latency_buckets','saturation_pct','queue_depth'
     )) then raise exception 'La telemetria cliente contiene campos no permitidos.'; end if;
  if jsonb_typeof(p->'latency_buckets') is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p->'latency_buckets') x(key) where key not in (
       'lte_100','lte_250','lte_500','lte_1000','lte_2500','gt_2500'
     )) then raise exception 'El histograma cliente no cumple el contrato cerrado.'; end if;

  v_key:=(p->>'idempotency_key')::uuid;
  v_service:=coalesce(p->>'service_code','');
  v_bucket:=date_trunc('minute',(p->>'bucket_at')::timestamptz);
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
  if v_service not in ('OPS_FRONTEND','RPC_CORE','REALTIME','STORAGE')
     or v_bucket<date_trunc('minute',clock_timestamp()-interval '10 minutes')
     or v_bucket>date_trunc('minute',clock_timestamp()+interval '1 minute')
     or v_samples not between 1 and 5000
     or v_success<0 or v_errors<0 or v_success+v_errors<>v_samples
     or least(v_100,v_250,v_500,v_1000,v_2500,v_gt)<0
     or v_100+v_250+v_500+v_1000+v_2500+v_gt<>v_samples
     or (v_saturation is not null and v_saturation not between 0 and 100)
     or (v_queue is not null and v_queue not between 0 and 1000000) then
    raise exception 'La telemetria cliente no cumple los limites operativos.';
  end if;

  v_payload:=(p-'idempotency_key')||jsonb_build_object('source_kind','client');
  v_fp:=public._momos_h92_hash(v_payload);
  perform pg_advisory_xact_lock(hashtextextended('momos-h96-client:'||v_key::text,0));
  select * into v_existing from public.operational_slo_ingest_receipts where idempotency_key=v_key;
  if v_existing.idempotency_key is not null then
    if v_existing.payload_fingerprint<>v_fp then
      raise exception 'La llave de telemetria ya existe con otro contrato.' using errcode='23505';
    end if;
    return jsonb_build_object('serviceCode',v_existing.service_code,'replayed',true);
  end if;

  insert into public.operational_slo_ingest_receipts(idempotency_key,service_code,bucket_at,payload_fingerprint)
  values(v_key,v_service,v_bucket,v_fp);
  insert into public.operational_slo_buckets(
    service_code,bucket_at,sample_count,success_count,error_count,
    latency_lte_100,latency_lte_250,latency_lte_500,latency_lte_1000,
    latency_lte_2500,latency_gt_2500,saturation_pct,queue_depth,source_kind,aggregate_fingerprint
  ) values(
    v_service,v_bucket,v_samples,v_success,v_errors,v_100,v_250,v_500,v_1000,
    v_2500,v_gt,v_saturation,v_queue,'client',v_fp
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
    )),updated_at=clock_timestamp();
  return jsonb_build_object('serviceCode',v_service,'replayed',false);
end $$;
revoke all on function public._momos_h96_ingest_client_item(jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.registrar_lote_telemetria_cliente_slo_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_item jsonb; v_results jsonb:='[]'::jsonb; v_count integer;
begin
  if public.is_staff() is not true then
    raise exception 'Solo el equipo activo puede reportar salud agregada.' using errcode='42501';
  end if;
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key<>'measurements')
     or jsonb_typeof(p->'measurements') is distinct from 'array' then
    raise exception 'El lote de telemetria no cumple el contrato cerrado.';
  end if;
  v_count:=jsonb_array_length(p->'measurements');
  if v_count not between 1 and 4 then raise exception 'El lote admite entre una y cuatro mediciones.'; end if;
  for v_item in select value from jsonb_array_elements(p->'measurements') loop
    v_results:=v_results||jsonb_build_array(public._momos_h96_ingest_client_item(v_item));
  end loop;
  delete from public.operational_slo_ingest_receipts where created_at<clock_timestamp()-interval '35 days';
  delete from public.operational_slo_buckets where bucket_at<clock_timestamp()-interval '35 days';
  return jsonb_build_object('ok',true,'contract','momos.client-slo-batch.v1','accepted',v_count,
    'results',v_results,'containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false);
end $$;

create or replace function public._momos_h96_set_alert(
  p_service text,p_code text,p_active boolean,p_severity text,p_window integer,p_fp text
) returns void language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if p_active then
    insert into public.operational_slo_alerts(
      service_code,alert_code,severity,status,window_minutes,evidence_fingerprint,owner_role
    ) values(p_service,p_code,p_severity,'Abierta',p_window,p_fp,'Administrador')
    on conflict(service_code,alert_code) where status='Abierta' do update set
      severity=excluded.severity,last_seen_at=clock_timestamp(),occurrences=public.operational_slo_alerts.occurrences+1,
      window_minutes=excluded.window_minutes,evidence_fingerprint=excluded.evidence_fingerprint;
  else
    update public.operational_slo_alerts set status='Recuperada',recovered_at=clock_timestamp(),last_seen_at=clock_timestamp()
    where service_code=p_service and alert_code=p_code and status='Abierta';
  end if;
end $$;
revoke all on function public._momos_h96_set_alert(text,text,boolean,text,integer,text)
  from public,anon,authenticated,service_role;

create or replace function public.evaluar_alertas_slo_v1(p_window_minutes integer default 60)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_policy public.operational_slo_policies%rowtype; v_samples bigint; v_errors bigint;
  v_100 bigint; v_250 bigint; v_500 bigint; v_1000 bigint; v_2500 bigint; v_gt bigint;
  v_saturation numeric; v_queue integer; v_last timestamptz; v_p95 integer; v_allowed bigint;
  v_fp text; v_open integer;
begin
  if public.is_admin() is not true and auth.role() is distinct from 'service_role' then
    raise exception 'Solo Administracion o el monitor privado pueden evaluar alertas.' using errcode='42501';
  end if;
  if p_window_minutes not between 5 and 1440 then raise exception 'Ventana de alertas invalida.'; end if;
  for v_policy in select * from public.operational_slo_policies where enabled order by service_code loop
    select coalesce(sum(sample_count),0),coalesce(sum(error_count),0),coalesce(sum(latency_lte_100),0),
      coalesce(sum(latency_lte_250),0),coalesce(sum(latency_lte_500),0),coalesce(sum(latency_lte_1000),0),
      coalesce(sum(latency_lte_2500),0),coalesce(sum(latency_gt_2500),0),max(saturation_pct),max(queue_depth),max(bucket_at)
    into v_samples,v_errors,v_100,v_250,v_500,v_1000,v_2500,v_gt,v_saturation,v_queue,v_last
    from public.operational_slo_buckets where service_code=v_policy.service_code
      and bucket_at>=date_trunc('minute',clock_timestamp()-make_interval(mins=>p_window_minutes));
    v_p95:=public._momos_h95_latency_upper_ms(v_samples,v_100,v_250,v_500,v_1000,v_2500,v_gt,0.95);
    v_allowed:=floor(v_samples*(1-v_policy.target_availability))::bigint;
    v_fp:=public._momos_h92_hash(jsonb_build_object('service',v_policy.service_code,'window',p_window_minutes,
      'samples',v_samples,'errors',v_errors,'p95',v_p95,'saturation',v_saturation,'queue',v_queue,
      'lastBucket',v_last,'policyVersion',v_policy.version));
    perform public._momos_h96_set_alert(v_policy.service_code,'ERROR_BUDGET_EXHAUSTED',
      v_samples>0 and v_errors>v_allowed,'Critica',p_window_minutes,v_fp);
    perform public._momos_h96_set_alert(v_policy.service_code,'LATENCY_P95_HIGH',
      v_samples>0 and v_p95>v_policy.target_p95_ms,'Alta',p_window_minutes,v_fp);
    perform public._momos_h96_set_alert(v_policy.service_code,'SATURATION_HIGH',
      v_saturation is not null and v_saturation>v_policy.max_saturation_pct,'Alta',p_window_minutes,v_fp);
    perform public._momos_h96_set_alert(v_policy.service_code,'QUEUE_HIGH',
      v_queue is not null and v_queue>v_policy.max_queue_depth,'Critica',p_window_minutes,v_fp);
    -- Nunca alerta un servicio que aun no produjo evidencia; evita ruido de activacion.
    perform public._momos_h96_set_alert(v_policy.service_code,'TELEMETRY_STALE',
      v_last is not null and v_last<date_trunc('minute',clock_timestamp()-make_interval(mins=>v_policy.max_staleness_minutes)),
      'Alta',p_window_minutes,v_fp);
  end loop;
  select count(*) into v_open from public.operational_slo_alerts where status='Abierta';
  return jsonb_build_object('ok',true,'contract','momos.slo-alert-evaluation.v1','openAlerts',v_open,
    'containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false);
end $$;

create or replace function public.obtener_sonda_slo_servidor_v1()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_connections integer:=0; v_max_connections integer:=1; v_waiting integer:=0;
  v_integrations integer:=0; v_connector_errors integer:=0; v_connector_queue integer:=0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'La sonda SLO es privada.' using errcode='42501';
  end if;
  select count(*) into v_connections from pg_stat_activity where datname=current_database();
  v_max_connections:=greatest(1,current_setting('max_connections')::integer);
  select count(*) into v_waiting from pg_stat_activity where datname=current_database() and wait_event_type='Lock';
  if to_regclass('public.agency_integrations') is not null then
    select count(*) filter(where status in ('Configurada','Activa','Con error')),
      count(*) filter(where status='Con error' or (status='Activa' and (last_heartbeat_at is null or last_heartbeat_at<clock_timestamp()-interval '30 minutes')))
    into v_integrations,v_connector_errors from public.agency_integrations;
  end if;
  if to_regclass('public.creative_generation_jobs') is not null then
    execute 'select count(*) from public.creative_generation_jobs where status not in (''Borrador'',''Completado'',''Fallido'',''Cancelado'')'
      into v_connector_queue;
  end if;
  if to_regclass('public.distribution_connector_jobs') is not null then
    execute 'select $1+count(*) from public.distribution_connector_jobs where status in (''Autorizado'',''Arrendado'',''Despachando'',''En proveedor'',''Incierto'')'
      into v_connector_queue using v_connector_queue;
  end if;
  return jsonb_build_object('contract','momos.server-slo-probe.v1',
    'database',jsonb_build_object('ok',v_waiting=0 and (v_connections*100.0/v_max_connections)<95,
      'saturationPct',round(v_connections*100.0/v_max_connections,2),'queueDepth',v_waiting),
    'connectors',jsonb_build_object('ok',v_connector_errors=0,'configured',v_integrations,
      'errorCount',v_connector_errors,'queueDepth',v_connector_queue),
    'containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false);
end $$;

create or replace function public.momos_operational_slo_snapshot_v1(p_window_minutes integer default 60)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_policy public.operational_slo_policies%rowtype; v_services jsonb:='[]'::jsonb; v_alerts jsonb:='[]'::jsonb;
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
      coalesce(sum(latency_lte_100),0),coalesce(sum(latency_lte_250),0),coalesce(sum(latency_lte_500),0),
      coalesce(sum(latency_lte_1000),0),coalesce(sum(latency_lte_2500),0),coalesce(sum(latency_gt_2500),0),
      max(saturation_pct),max(queue_depth),max(bucket_at)
    into v_samples,v_success,v_errors,v_100,v_250,v_500,v_1000,v_2500,v_gt,v_saturation,v_queue,v_last
    from public.operational_slo_buckets where service_code=v_policy.service_code
      and bucket_at>=date_trunc('minute',clock_timestamp()-make_interval(mins=>p_window_minutes));
    v_availability:=case when v_samples>0 then round(v_success::numeric/v_samples,6) end;
    v_error_rate:=case when v_samples>0 then round(v_errors::numeric/v_samples,6) end;
    v_p50:=public._momos_h95_latency_upper_ms(v_samples,v_100,v_250,v_500,v_1000,v_2500,v_gt,0.50);
    v_p95:=public._momos_h95_latency_upper_ms(v_samples,v_100,v_250,v_500,v_1000,v_2500,v_gt,0.95);
    v_p99:=public._momos_h95_latency_upper_ms(v_samples,v_100,v_250,v_500,v_1000,v_2500,v_gt,0.99);
    v_allowed:=floor(v_samples*(1-v_policy.target_availability))::bigint;
    v_remaining:=v_allowed-v_errors;
    v_stale:=v_last is null or v_last<date_trunc('minute',clock_timestamp()-make_interval(mins=>v_policy.max_staleness_minutes));
    v_status:=case when not v_policy.enabled then 'Deshabilitado' when v_samples=0 then 'Sin datos'
      when v_stale then 'Desactualizado' when v_availability<v_policy.target_availability
        or v_p95>v_policy.target_p95_ms or coalesce(v_saturation,0)>v_policy.max_saturation_pct
        or coalesce(v_queue,0)>v_policy.max_queue_depth then 'Fuera de SLO'
      when v_allowed>0 and v_remaining<=ceil(v_allowed*0.25) then 'En riesgo' else 'Saludable' end;
    v_services:=v_services||jsonb_build_array(jsonb_build_object(
      'serviceCode',v_policy.service_code,'titleCode',v_policy.title_code,'status',v_status,
      'enabled',v_policy.enabled,'version',v_policy.version,'sampleCount',v_samples,
      'successCount',v_success,'errorCount',v_errors,'availability',v_availability,'errorRate',v_error_rate,
      'latency',jsonb_build_object('method','histogram-upper-bound','p50Ms',v_p50,'p95Ms',v_p95,'p99Ms',v_p99),
      'saturationMaxPct',v_saturation,'queueMax',v_queue,'lastBucketAt',v_last,'stale',v_stale,
      'target',jsonb_build_object('availability',v_policy.target_availability,'p95Ms',v_policy.target_p95_ms,
        'maxSaturationPct',v_policy.max_saturation_pct,'maxQueueDepth',v_policy.max_queue_depth,
        'maxStalenessMinutes',v_policy.max_staleness_minutes),
      'errorBudget',jsonb_build_object('allowedErrors',v_allowed,'remainingErrors',v_remaining)
    ));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'serviceCode',service_code,'alertCode',alert_code,
    'severity',severity,'status',status,'lastSeenAt',last_seen_at,'ownerRole',owner_role)
    order by case severity when 'Critica' then 0 else 1 end,last_seen_at desc),'[]'::jsonb)
  into v_alerts from public.operational_slo_alerts
  where status='Abierta' or recovered_at>=clock_timestamp()-interval '24 hours';
  return jsonb_build_object('contract','momos.operational-slo.v1','windowMinutes',p_window_minutes,
    'generatedAt',clock_timestamp(),'services',v_services,'alerts',v_alerts,
    'counts',jsonb_build_object(
      'healthy',(select count(*) from jsonb_array_elements(v_services) x where x->>'status'='Saludable'),
      'atRisk',(select count(*) from jsonb_array_elements(v_services) x where x->>'status'='En riesgo'),
      'outside',(select count(*) from jsonb_array_elements(v_services) x where x->>'status'='Fuera de SLO'),
      'withoutData',(select count(*) from jsonb_array_elements(v_services) x where x->>'status' in ('Sin datos','Desactualizado'))),
    'alertCounts',jsonb_build_object(
      'open',(select count(*) from public.operational_slo_alerts where status='Abierta'),
      'critical',(select count(*) from public.operational_slo_alerts where status='Abierta' and severity='Critica')),
    'containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false);
end $$;

revoke all on function public.registrar_lote_telemetria_cliente_slo_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.evaluar_alertas_slo_v1(integer)
  from public,anon,authenticated,service_role;
revoke all on function public.obtener_sonda_slo_servidor_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.momos_operational_slo_snapshot_v1(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.registrar_lote_telemetria_cliente_slo_v1(jsonb) to authenticated;
grant execute on function public.evaluar_alertas_slo_v1(integer) to authenticated,service_role;
grant execute on function public.obtener_sonda_slo_servidor_v1() to service_role;
grant execute on function public.momos_operational_slo_snapshot_v1(integer) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260721_96_telemetria_alertas',
  'Telemetria real agregada, sondas privadas y alertas SLO deduplicadas sin PII')
on conflict(id) do nothing;

commit;
