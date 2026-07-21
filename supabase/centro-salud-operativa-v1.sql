-- MOMOS OPS · H92 Centro de Salud Operativa v1
-- El monitor vive en servidor, no depende del navegador y nunca conserva
-- payloads, mensajes libres, rutas, PII ni secretos. Los hallazgos críticos
-- de integridad activan un modo de solo lectura real sobre el núcleo operativo.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260721'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260721_91_mutaciones_compuestas_atomicas') then
    raise exception 'Falta H91 mutaciones compuestas atómicas.';
  end if;
  if to_regclass('public.v_inventory_lot_reconciliation') is null
     or to_regclass('public.lote_figuras') is null
     or to_regprocedure('public.current_user_has_any_role(text[])') is null then
    raise exception 'Faltan conciliación canónica, resultados físicos o RBAC.';
  end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'El servidor PostgreSQL no ofrece pg_catalog.sha256(bytea).';
  end if;
end $$;

create table if not exists public.operational_health_state(
  singleton boolean primary key default true check(singleton),
  status text not null default 'Degradado'
    check(status in ('Saludable','Degradado','Solo lectura','Incidente')),
  read_only boolean not null default false,
  reason_code text not null default 'MONITOR_INICIALIZANDO'
    check(reason_code ~ '^[A-Z0-9_]{3,64}$'),
  last_checked_at timestamptz,
  next_due_at timestamptz,
  scheduler_kind text not null default 'external-required'
    check(scheduler_kind in ('pg_cron','worker','external-required')),
  backup_monitoring_enabled boolean not null default false,
  backup_rpo_minutes integer not null default 5 check(backup_rpo_minutes between 1 and 1440),
  last_backup_at timestamptz,
  last_backup_verified_at timestamptz,
  version bigint not null default 1 check(version>0),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.operational_health_state(singleton) values(true)
on conflict(singleton) do nothing;

create table if not exists public.operational_health_runs(
  id uuid primary key,
  source text not null check(source ~ '^[a-z0-9_-]{2,32}$'),
  status text not null check(status in ('Ejecutando','Completado','Fallido')),
  checks_total integer not null default 0 check(checks_total>=0),
  warnings integer not null default 0 check(warnings>=0),
  failures integer not null default 0 check(failures>=0),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  duration_ms integer check(duration_ms is null or duration_ms>=0),
  fingerprint text check(fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$')
);

create table if not exists public.operational_health_checks(
  id bigint generated always as identity primary key,
  run_id uuid not null references public.operational_health_runs(id) on delete restrict,
  check_code text not null check(check_code ~ '^[A-Z0-9_]{3,64}$'),
  domain text not null check(domain in (
    'ESQUEMA','INVENTARIO','PRODUCTO_TERMINADO','PEDIDOS','SINCRONIZACION',
    'CONECTORES','BACKUPS','BASE_DATOS'
  )),
  severity text not null check(severity in ('Informativa','Media','Alta','Crítica')),
  result text not null check(result in ('OK','ADVERTENCIA','FALLO')),
  observed numeric,
  threshold numeric,
  evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object'),
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  checked_at timestamptz not null default clock_timestamp(),
  unique(run_id,check_code)
);
create index if not exists operational_health_checks_code_recent_idx
  on public.operational_health_checks(check_code,checked_at desc,id desc);

create table if not exists public.operational_health_incidents(
  id bigint generated always as identity primary key,
  incident_key text not null unique check(incident_key ~ '^[A-Z0-9_]{3,64}$'),
  check_code text not null check(check_code ~ '^[A-Z0-9_]{3,64}$'),
  domain text not null,
  severity text not null check(severity in ('Media','Alta','Crítica')),
  status text not null default 'Abierto'
    check(status in ('Abierto','Confirmado','Recuperado','Resuelto')),
  owner_role text not null check(owner_role in (
    'Administrador','Cajero','Coordinador de pedidos','Cocina','Empaque',
    'Logística','Marketing/CRM','Mensajero'
  )),
  title_code text not null check(title_code ~ '^[A-Z0-9_]{3,64}$'),
  occurrences integer not null default 1 check(occurrences>0),
  auto_read_only boolean not null default false,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  recovered_at timestamptz,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_code text check(resolution_code is null or resolution_code in (
    'CORREGIDO','RESTAURADO','FALSO_POSITIVO','ACEPTADO'
  )),
  last_check_fingerprint text not null check(last_check_fingerprint ~ '^[0-9a-f]{64}$')
);
create index if not exists operational_health_incidents_active_idx
  on public.operational_health_incidents(severity,last_seen_at desc)
  where status in ('Abierto','Confirmado');

create table if not exists public.operational_health_error_events(
  id bigint generated always as identity primary key,
  correlation_id uuid not null,
  source text not null check(source ~ '^[a-z0-9_-]{2,32}$'),
  operation text not null check(operation ~ '^[a-z0-9_.:-]{2,80}$'),
  error_code text not null check(error_code ~ '^[A-Z0-9_]{3,64}$'),
  severity text not null check(severity in ('Media','Alta','Crítica')),
  actor_role text not null check(actor_role ~ '^[A-Za-zÁÉÍÓÚáéíóú/ ]{3,40}$'),
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  occurrences integer not null default 1 check(occurrences>0),
  bucket_at timestamptz not null,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  unique(fingerprint,bucket_at)
);
create index if not exists operational_health_errors_recent_idx
  on public.operational_health_error_events(last_seen_at desc,id desc);

create table if not exists public.operational_backup_receipts(
  backup_key text primary key check(backup_key ~ '^[A-Za-z0-9_-]{8,80}$'),
  completed_at timestamptz not null,
  verified_at timestamptz,
  recoverable boolean not null,
  size_bytes bigint not null check(size_bytes>0),
  checksum text not null check(checksum ~ '^[0-9a-f]{64}$'),
  source text not null check(source in ('Supabase','Exportación cifrada','Simulacro')),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.operational_health_worker_heartbeats(
  worker_id text primary key check(worker_id ~ '^[A-Za-z0-9_.:-]{3,80}$'),
  version text not null check(version ~ '^[A-Za-z0-9_.:/-]{3,80}$'),
  status text not null check(status in ('Disponible','Con error','Detenido')),
  heartbeat_at timestamptz not null default clock_timestamp(),
  last_run_id uuid references public.operational_health_runs(id) on delete set null
);

do $$
declare t text;
begin
  foreach t in array array[
    'operational_health_state','operational_health_runs','operational_health_checks',
    'operational_health_incidents','operational_health_error_events',
    'operational_backup_receipts','operational_health_worker_heartbeats'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create or replace function public._momos_h92_hash(p jsonb)
returns text language sql immutable
set search_path=pg_catalog,public,pg_temp as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p::text,'UTF8')),'hex')
$$;
revoke all on function public._momos_h92_hash(jsonb)
  from public,anon,authenticated,service_role;

create or replace function public._momos_h92_safe_evidence(p jsonb)
returns jsonb language plpgsql immutable
set search_path=pg_catalog,public,pg_temp as $$
declare v_text text:=lower(coalesce(p::text,''));
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'La evidencia de salud debe ser agregada.';
  end if;
  if v_text ~ 'telefono|direcci[oó]n|customer|storage_path|api[_-]?key|access[_-]?token|secret|email|nota|observaci' then
    raise exception 'La evidencia de salud contiene campos sensibles.';
  end if;
  return p;
end $$;
revoke all on function public._momos_h92_safe_evidence(jsonb)
  from public,anon,authenticated,service_role;

create or replace function public._momos_h92_record_check(
  p_run uuid,p_code text,p_domain text,p_severity text,p_result text,
  p_observed numeric,p_threshold numeric,p_evidence jsonb,p_owner_role text,
  p_title_code text,p_auto_read_only boolean default false
) returns void language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_fp text; v_evidence jsonb;
begin
  if p_code !~ '^[A-Z0-9_]{3,64}$' or p_title_code !~ '^[A-Z0-9_]{3,64}$' then
    raise exception 'Código de salud inválido.';
  end if;
  v_evidence:=public._momos_h92_safe_evidence(coalesce(p_evidence,'{}'::jsonb));
  v_fp:=public._momos_h92_hash(jsonb_build_object(
    'code',p_code,'result',p_result,'observed',p_observed,
    'threshold',p_threshold,'evidence',v_evidence
  ));
  insert into public.operational_health_checks(
    run_id,check_code,domain,severity,result,observed,threshold,evidence,fingerprint
  ) values(p_run,p_code,p_domain,p_severity,p_result,p_observed,p_threshold,v_evidence,v_fp);

  if p_result in ('ADVERTENCIA','FALLO') then
    insert into public.operational_health_incidents(
      incident_key,check_code,domain,severity,status,owner_role,title_code,
      auto_read_only,last_check_fingerprint
    ) values(
      p_code,p_code,p_domain,
      case when p_severity='Informativa' then 'Media' else p_severity end,
      'Abierto',p_owner_role,p_title_code,p_auto_read_only,v_fp
    )
    on conflict(incident_key) do update set
      severity=excluded.severity,
      status=case when public.operational_health_incidents.status='Confirmado'
        then 'Confirmado' else 'Abierto' end,
      owner_role=excluded.owner_role,title_code=excluded.title_code,
      auto_read_only=excluded.auto_read_only,
      occurrences=public.operational_health_incidents.occurrences+1,
      last_seen_at=clock_timestamp(),recovered_at=null,
      last_check_fingerprint=excluded.last_check_fingerprint;
  else
    update public.operational_health_incidents set
      status='Recuperado',recovered_at=clock_timestamp(),last_seen_at=clock_timestamp(),
      last_check_fingerprint=v_fp
    where incident_key=p_code and status in ('Abierto','Confirmado');
  end if;
end $$;
revoke all on function public._momos_h92_record_check(uuid,text,text,text,text,numeric,numeric,jsonb,text,text,boolean)
  from public,anon,authenticated,service_role;

create or replace function public._run_operational_health_monitor_v1(p_source text default 'database')
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions,pg_temp as $$
declare
  v_run uuid:=gen_random_uuid(); v_started timestamptz:=clock_timestamp();
  v_count bigint:=0; v_threshold numeric:=0; v_freeze boolean:=false;
  v_failures integer:=0; v_warnings integer:=0; v_total integer:=0;
  v_active_critical integer:=0; v_active_high integer:=0; v_status text;
  v_state public.operational_health_state%rowtype; v_payload jsonb; v_fp text;
begin
  if coalesce(p_source,'') !~ '^[a-z0-9_-]{2,32}$' then raise exception 'Fuente del monitor inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('momos-h92-monitor',0));
  insert into public.operational_health_runs(id,source,status) values(v_run,p_source,'Ejecutando');
  select * into v_state from public.operational_health_state where singleton for update;

  select count(*) into v_count from public.momos_ops_migrations
    where id='20260721_91_mutaciones_compuestas_atomicas';
  perform public._momos_h92_record_check(v_run,'SCHEMA_H91','ESQUEMA','Crítica',
    case when v_count=1 then 'OK' else 'FALLO' end,v_count,1,
    jsonb_build_object('expected',1,'found',v_count),'Administrador','SCHEMA_VERSION_MISMATCH',true);
  v_freeze:=v_freeze or v_count<>1;

  select count(*) into v_count from public.v_inventory_lot_reconciliation
    where difference<>0 or official_stock<0 or lot_stock<0;
  perform public._momos_h92_record_check(v_run,'INVENTORY_RECONCILIATION','INVENTARIO','Crítica',
    case when v_count=0 then 'OK' else 'FALLO' end,v_count,0,
    jsonb_build_object('mismatchedItems',v_count),'Administrador','INVENTORY_STOCK_DRIFT',true);
  v_freeze:=v_freeze or v_count>0;

  select count(*) into v_count from public.lote_figuras
    where perfectas<0 or imperfectas<0 or descartadas<0
       or perfectas+imperfectas+descartadas<>cant;
  perform public._momos_h92_record_check(v_run,'FINISHED_RESULTS_INTEGRITY','PRODUCTO_TERMINADO','Crítica',
    case when v_count=0 then 'OK' else 'FALLO' end,v_count,0,
    jsonb_build_object('invalidRows',v_count),'Administrador','FINISHED_RESULTS_DRIFT',true);
  v_freeze:=v_freeze or v_count>0;

  select count(*) into v_count from public.orders o
  where o.estado='Pagado' and coalesce(o.pagado_en,(o.fecha+o.hora)::timestamptz)<clock_timestamp()-interval '15 minutes'
    and not exists(select 1 from public.inventory_reservations r
      where r.order_id=o.id and r.estado in ('Reservada','Consumida'))
    and not exists(select 1 from public.production_suggestions s where s.order_id=o.id);
  perform public._momos_h92_record_check(v_run,'PAID_ORDER_WITHOUT_FLOW','PEDIDOS','Alta',
    case when v_count=0 then 'OK' else 'ADVERTENCIA' end,v_count,0,
    jsonb_build_object('affectedOrders',v_count),'Coordinador de pedidos','PAID_ORDER_NEEDS_REVIEW',false);

  select coalesce((select (valor#>>'{}')::numeric from public.app_settings
    where clave='demora_cocina_urgente_min'),30) into v_threshold;
  select count(*) into v_count from public.orders o
  where o.estado='En producción'
    and coalesce((select max(a.fecha) from public.audit_logs a
      where a.entidad_id=o.id),o.pagado_en,(o.fecha+o.hora)::timestamptz)
      <clock_timestamp()-make_interval(mins=>v_threshold::integer);
  perform public._momos_h92_record_check(v_run,'STALLED_KITCHEN_ORDERS','PEDIDOS','Alta',
    case when v_count=0 then 'OK' else 'ADVERTENCIA' end,v_count,v_threshold,
    jsonb_build_object('affectedOrders',v_count,'urgentMinutes',v_threshold),
    'Cocina','KITCHEN_ORDER_STALLED',false);

  select coalesce((select (valor#>>'{}')::numeric from public.app_settings
    where clave='demora_empaque_urgente_min'),20) into v_threshold;
  select count(*) into v_count from public.orders o
  where o.estado in ('Listo para empaque','Empacado')
    and coalesce((select max(a.fecha) from public.audit_logs a
      where a.entidad_id=o.id),o.pagado_en,(o.fecha+o.hora)::timestamptz)
      <clock_timestamp()-make_interval(mins=>v_threshold::integer);
  perform public._momos_h92_record_check(v_run,'STALLED_PACKING_ORDERS','PEDIDOS','Alta',
    case when v_count=0 then 'OK' else 'ADVERTENCIA' end,v_count,v_threshold,
    jsonb_build_object('affectedOrders',v_count,'urgentMinutes',v_threshold),
    'Empaque','PACKING_ORDER_STALLED',false);

  v_count:=0;
  if to_regclass('public.agency_integrations') is not null then
    execute 'select count(*) from public.agency_integrations where status=''Activa'' and (last_heartbeat_at is null or last_heartbeat_at<clock_timestamp()-interval ''30 minutes'')'
      into v_count;
  end if;
  perform public._momos_h92_record_check(v_run,'STALE_CONNECTOR_HEARTBEATS','CONECTORES','Media',
    case when v_count=0 then 'OK' else 'ADVERTENCIA' end,v_count,30,
    jsonb_build_object('staleConnectors',v_count,'maxAgeMinutes',30),
    'Marketing/CRM','CONNECTOR_HEARTBEAT_STALE',false);

  if v_state.backup_monitoring_enabled then
    v_threshold:=v_state.backup_rpo_minutes;
    v_count:=case when v_state.last_backup_verified_at is not null
      and v_state.last_backup_verified_at>=clock_timestamp()-make_interval(mins=>v_threshold::integer)
      then 0 else 1 end;
    perform public._momos_h92_record_check(v_run,'BACKUP_RPO','BACKUPS','Crítica',
      case when v_count=0 then 'OK' else 'FALLO' end,v_count,v_threshold,
      jsonb_build_object('outsideRpo',v_count,'rpoMinutes',v_threshold),
      'Administrador','BACKUP_OUTSIDE_RPO',false);
  else
    perform public._momos_h92_record_check(v_run,'BACKUP_RPO','BACKUPS','Informativa','OK',
      0,v_state.backup_rpo_minutes,jsonb_build_object('monitoringEnabled',false),
      'Administrador','BACKUP_MONITOR_DISABLED',false);
  end if;

  select count(*) into v_count from pg_catalog.pg_stat_activity
    where datname=current_database();
  select setting::numeric into v_threshold from pg_catalog.pg_settings where name='max_connections';
  perform public._momos_h92_record_check(v_run,'DATABASE_CONNECTIONS','BASE_DATOS','Media',
    case when v_count>=v_threshold*0.8 then 'ADVERTENCIA' else 'OK' end,
    v_count,v_threshold*0.8,
    jsonb_build_object('connections',v_count,'warningAt',floor(v_threshold*0.8)),
    'Administrador','DATABASE_CONNECTION_PRESSURE',false);

  select count(*),count(*) filter(where result='FALLO'),count(*) filter(where result='ADVERTENCIA')
    into v_total,v_failures,v_warnings from public.operational_health_checks where run_id=v_run;
  select count(*) filter(where severity='Crítica'),count(*) filter(where severity='Alta')
    into v_active_critical,v_active_high from public.operational_health_incidents
    where status in ('Abierto','Confirmado');
  v_status:=case
    when v_state.read_only or v_freeze then 'Solo lectura'
    when v_active_critical>0 then 'Incidente'
    when v_active_high>0 or v_warnings>0 then 'Degradado'
    else 'Saludable' end;
  v_payload:=jsonb_build_object('runId',v_run,'status',v_status,'checks',v_total,
    'warnings',v_warnings,'failures',v_failures,'readOnly',v_state.read_only or v_freeze,
    'containsCustomerPii',false,'containsSecrets',false);
  v_fp:=public._momos_h92_hash(v_payload);
  update public.operational_health_runs set status='Completado',checks_total=v_total,
    warnings=v_warnings,failures=v_failures,completed_at=clock_timestamp(),
    duration_ms=greatest(0,(extract(epoch from clock_timestamp()-v_started)*1000)::integer),
    fingerprint=v_fp where id=v_run;
  update public.operational_health_state set status=v_status,
    read_only=read_only or v_freeze,
    reason_code=case when v_freeze then 'CRITICAL_INTEGRITY_FAILURE'
      when read_only then reason_code when v_status='Saludable' then 'ALL_CHECKS_PASS'
      when v_status='Degradado' then 'OPERATIONAL_WARNINGS' else 'ACTIVE_INCIDENT' end,
    last_checked_at=clock_timestamp(),next_due_at=clock_timestamp()+interval '5 minutes',
    version=version+1,updated_at=clock_timestamp() where singleton;
  return v_payload||jsonb_build_object('fingerprint',v_fp);
exception when others then
  update public.operational_health_runs set status='Fallido',completed_at=clock_timestamp(),
    duration_ms=greatest(0,(extract(epoch from clock_timestamp()-v_started)*1000)::integer)
    where id=v_run;
  raise;
end $$;
revoke all on function public._run_operational_health_monitor_v1(text)
  from public,anon,authenticated,service_role;

create or replace function public.ejecutar_monitor_salud_operativa_v1(
  p_worker_id text,p_version text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb; v_run uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Solo el worker privado puede ejecutar el monitor.'; end if;
  if coalesce(p_worker_id,'') !~ '^[A-Za-z0-9_.:-]{3,80}$'
     or coalesce(p_version,'') !~ '^[A-Za-z0-9_.:/-]{3,80}$' then
    raise exception 'Identidad del worker inválida.';
  end if;
  v_result:=public._run_operational_health_monitor_v1('worker');
  v_run:=(v_result->>'runId')::uuid;
  insert into public.operational_health_worker_heartbeats(worker_id,version,status,last_run_id)
  values(p_worker_id,p_version,'Disponible',v_run)
  on conflict(worker_id) do update set version=excluded.version,status='Disponible',
    heartbeat_at=clock_timestamp(),last_run_id=excluded.last_run_id;
  update public.operational_health_state set scheduler_kind='worker',updated_at=clock_timestamp()
    where singleton and scheduler_kind<>'pg_cron';
  return v_result;
end $$;

create or replace function public.ejecutar_revision_salud_operativa_v1()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede ejecutar la revisión.'; end if;
  return public._run_operational_health_monitor_v1('manual');
end $$;

create or replace function public.registrar_error_operativo_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_correlation uuid; v_source text; v_operation text; v_code text; v_severity text;
  v_role text; v_fp text; v_bucket timestamptz;
begin
  if auth.role()<>'service_role' and public.is_staff() is not true then raise exception 'Sesión no autorizada.'; end if;
  if jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) x(key)
    where key not in ('correlation_id','source','operation','error_code','severity')) then
    raise exception 'El reporte de error contiene campos no permitidos.';
  end if;
  v_correlation:=(p->>'correlation_id')::uuid;
  v_source:=btrim(coalesce(p->>'source','')); v_operation:=btrim(coalesce(p->>'operation',''));
  v_code:=upper(btrim(coalesce(p->>'error_code',''))); v_severity:=coalesce(p->>'severity','Media');
  if v_source !~ '^[a-z0-9_-]{2,32}$' or v_operation !~ '^[a-z0-9_.:-]{2,80}$'
     or v_code !~ '^[A-Z0-9_]{3,64}$' or v_severity not in ('Media','Alta','Crítica') then
    raise exception 'El reporte de error no cumple el contrato sanitario.';
  end if;
  v_role:=case when auth.role()='service_role' then 'Sistema'
    else coalesce((public.current_roles())[1],'Staff') end;
  v_fp:=public._momos_h92_hash(jsonb_build_object('source',v_source,'operation',v_operation,
    'code',v_code,'severity',v_severity,'role',v_role));
  v_bucket:=date_trunc('minute',clock_timestamp());
  insert into public.operational_health_error_events(
    correlation_id,source,operation,error_code,severity,actor_role,fingerprint,bucket_at
  ) values(v_correlation,v_source,v_operation,v_code,v_severity,v_role,v_fp,v_bucket)
  on conflict(fingerprint,bucket_at) do update set
    occurrences=public.operational_health_error_events.occurrences+1,
    last_seen_at=clock_timestamp();
  return jsonb_build_object('ok',true,'correlationId',v_correlation,'fingerprint',v_fp,
    'containsCustomerPii',false,'containsSecrets',false);
end $$;

create or replace function public.registrar_backup_operativo_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_key text; v_completed timestamptz; v_verified timestamptz; v_recoverable boolean;
  v_size bigint; v_checksum text; v_source text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Solo el proceso privado de backups puede reportar.'; end if;
  if jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) x(key)
    where key not in ('backup_key','completed_at','verified_at','recoverable','size_bytes','checksum','source')) then
    raise exception 'El recibo de backup contiene campos no permitidos.';
  end if;
  v_key:=btrim(coalesce(p->>'backup_key','')); v_completed:=(p->>'completed_at')::timestamptz;
  v_verified:=nullif(p->>'verified_at','')::timestamptz; v_recoverable:=(p->>'recoverable')::boolean;
  v_size:=(p->>'size_bytes')::bigint; v_checksum:=lower(btrim(coalesce(p->>'checksum','')));
  v_source:=p->>'source';
  if v_key !~ '^[A-Za-z0-9_-]{8,80}$' or v_checksum !~ '^[0-9a-f]{64}$'
     or v_size<=0 or v_completed>clock_timestamp()+interval '1 minute'
     or v_source not in ('Supabase','Exportación cifrada','Simulacro') then
    raise exception 'El recibo de backup no es válido.';
  end if;
  insert into public.operational_backup_receipts(
    backup_key,completed_at,verified_at,recoverable,size_bytes,checksum,source
  ) values(v_key,v_completed,v_verified,v_recoverable,v_size,v_checksum,v_source)
  on conflict(backup_key) do nothing;
  update public.operational_health_state set
    last_backup_at=greatest(last_backup_at,v_completed),
    last_backup_verified_at=case when v_recoverable and v_verified is not null
      then greatest(last_backup_verified_at,v_verified) else last_backup_verified_at end,
    version=version+1,updated_at=clock_timestamp() where singleton;
  return jsonb_build_object('ok',true,'backupKey',v_key,'recoverable',v_recoverable,
    'containsPaths',false,'containsSecrets',false);
end $$;

create or replace function public.configurar_monitoreo_backups_v1(p_enabled boolean,p_rpo_minutes integer)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede configurar backups.'; end if;
  if p_rpo_minutes not between 1 and 1440 then raise exception 'RPO inválido.'; end if;
  update public.operational_health_state set backup_monitoring_enabled=p_enabled,
    backup_rpo_minutes=p_rpo_minutes,version=version+1,updated_at=clock_timestamp()
    where singleton;
  return jsonb_build_object('ok',true,'enabled',p_enabled,'rpoMinutes',p_rpo_minutes);
end $$;

create or replace function public.confirmar_incidente_salud_v1(p_incident_id bigint)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_user uuid:=auth.uid();
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede confirmar incidentes técnicos.'; end if;
  update public.operational_health_incidents set status='Confirmado',acknowledged_by=v_user,
    acknowledged_at=clock_timestamp() where id=p_incident_id and status='Abierto';
  if not found then raise exception 'El incidente no está abierto.'; end if;
  return jsonb_build_object('ok',true,'incidentId',p_incident_id,'status','Confirmado');
end $$;

create or replace function public.resolver_incidente_salud_v1(p_incident_id bigint,p_resolution_code text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_user uuid:=auth.uid();
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede resolver incidentes técnicos.'; end if;
  if p_resolution_code not in ('CORREGIDO','RESTAURADO','FALSO_POSITIVO','ACEPTADO') then
    raise exception 'Código de resolución inválido.';
  end if;
  update public.operational_health_incidents set status='Resuelto',resolved_by=v_user,
    resolved_at=clock_timestamp(),resolution_code=p_resolution_code
    where id=p_incident_id and status='Recuperado';
  if not found then raise exception 'El incidente debe haberse recuperado antes de cerrarlo.'; end if;
  return jsonb_build_object('ok',true,'incidentId',p_incident_id,'status','Resuelto');
end $$;

create or replace function public.establecer_modo_contingencia_v1(p_enabled boolean,p_reason_code text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede cambiar el modo de contingencia.'; end if;
  if coalesce(p_reason_code,'') !~ '^[A-Z0-9_]{3,64}$' then raise exception 'Motivo de contingencia inválido.'; end if;
  if not p_enabled and exists(select 1 from public.operational_health_incidents
    where status in ('Abierto','Confirmado') and auto_read_only) then
    raise exception 'Persisten fallos críticos de integridad; no se puede reactivar la escritura.';
  end if;
  update public.operational_health_state set read_only=p_enabled,
    status=case when p_enabled then 'Solo lectura' else 'Degradado' end,
    reason_code=p_reason_code,version=version+1,updated_at=clock_timestamp() where singleton;
  return jsonb_build_object('ok',true,'readOnly',p_enabled,'reasonCode',p_reason_code);
end $$;

create or replace function public.momos_operational_health_snapshot_v1()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_state public.operational_health_state%rowtype; v_effective text;
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede consultar salud técnica.'; end if;
  select * into v_state from public.operational_health_state where singleton;
  v_effective:=case when v_state.last_checked_at is null
      or v_state.last_checked_at<clock_timestamp()-interval '6 minutes'
    then case when v_state.read_only then 'Solo lectura' else 'Degradado' end
    else v_state.status end;
  return jsonb_build_object(
    'contract','momos.operational-health.v1','status',v_effective,
    'readOnly',v_state.read_only,'reasonCode',v_state.reason_code,
    'lastCheckedAt',v_state.last_checked_at,'nextDueAt',v_state.next_due_at,
    'scheduler',v_state.scheduler_kind,
    'backup',jsonb_build_object('monitoringEnabled',v_state.backup_monitoring_enabled,
      'rpoMinutes',v_state.backup_rpo_minutes,'lastBackupAt',v_state.last_backup_at,
      'lastVerifiedAt',v_state.last_backup_verified_at),
    'counts',jsonb_build_object(
      'critical',(select count(*) from public.operational_health_incidents where status in ('Abierto','Confirmado') and severity='Crítica'),
      'high',(select count(*) from public.operational_health_incidents where status in ('Abierto','Confirmado') and severity='Alta'),
      'recovered',(select count(*) from public.operational_health_incidents where status='Recuperado'),
      'errors24h',(select coalesce(sum(occurrences),0) from public.operational_health_error_events where last_seen_at>clock_timestamp()-interval '24 hours')
    ),
    'incidents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'key',incident_key,'domain',domain,'severity',severity,'status',status,
      'ownerRole',owner_role,'titleCode',title_code,'occurrences',occurrences,
      'autoReadOnly',auto_read_only,'firstSeenAt',first_seen_at,'lastSeenAt',last_seen_at,
      'recoveredAt',recovered_at
    ) order by case severity when 'Crítica' then 1 when 'Alta' then 2 else 3 end,last_seen_at desc)
      from (select * from public.operational_health_incidents
        where status<>'Resuelto' order by last_seen_at desc limit 30) i),'[]'::jsonb),
    'latestChecks',coalesce((select jsonb_agg(jsonb_build_object(
      'code',check_code,'domain',domain,'severity',severity,'result',result,
      'observed',observed,'threshold',threshold,'evidence',evidence,'checkedAt',checked_at
    ) order by checked_at desc,id desc) from (
      select distinct on(check_code) * from public.operational_health_checks
      order by check_code,checked_at desc,id desc
    ) c),'[]'::jsonb),
    'containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false
  );
end $$;

create or replace function public._momos_h92_block_mutations()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if (auth.uid() is not null or auth.role()='service_role')
     and exists(select 1 from public.operational_health_state where singleton and read_only) then
    raise exception 'MOMO OPS está en modo Solo lectura por contingencia. Conservá el identificador y seguí el runbook.'
      using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public._momos_h92_block_mutations()
  from public,anon,authenticated,service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'orders','order_items','inventory_items','inventory_movements','inventory_lots',
    'inventory_lot_allocations','inventory_reservations','production_batches',
    'lote_figuras','production_suggestions','products','customers','deliveries','claims'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists momos_h92_read_only_guard on public.%I',t);
      execute format('create trigger momos_h92_read_only_guard before insert or update or delete on public.%I for each row execute function public._momos_h92_block_mutations()',t);
    end if;
  end loop;
end $$;

revoke all on function public.ejecutar_monitor_salud_operativa_v1(text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.ejecutar_revision_salud_operativa_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.registrar_error_operativo_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.registrar_backup_operativo_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.configurar_monitoreo_backups_v1(boolean,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.confirmar_incidente_salud_v1(bigint)
  from public,anon,authenticated,service_role;
revoke all on function public.resolver_incidente_salud_v1(bigint,text)
  from public,anon,authenticated,service_role;
revoke all on function public.establecer_modo_contingencia_v1(boolean,text)
  from public,anon,authenticated,service_role;
revoke all on function public.momos_operational_health_snapshot_v1()
  from public,anon,authenticated,service_role;

grant execute on function public.ejecutar_monitor_salud_operativa_v1(text,text) to service_role;
grant execute on function public.registrar_backup_operativo_v1(jsonb) to service_role;
grant execute on function public.registrar_error_operativo_v1(jsonb) to authenticated,service_role;
grant execute on function public.ejecutar_revision_salud_operativa_v1() to authenticated;
grant execute on function public.configurar_monitoreo_backups_v1(boolean,integer) to authenticated;
grant execute on function public.confirmar_incidente_salud_v1(bigint) to authenticated;
grant execute on function public.resolver_incidente_salud_v1(bigint,text) to authenticated;
grant execute on function public.establecer_modo_contingencia_v1(boolean,text) to authenticated;
grant execute on function public.momos_operational_health_snapshot_v1() to authenticated;

-- Si pg_cron ya está habilitado, el monitor queda autónomo. Si no, el worker
-- privado incluido en el repositorio conserva la misma frecuencia y contrato.
do $$
declare v_job bigint;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    select jobid into v_job from cron.job where jobname='momos-h92-health-monitor' limit 1;
    if v_job is not null then perform cron.unschedule(v_job); end if;
    perform cron.schedule('momos-h92-health-monitor','*/5 * * * *',
      'select public._run_operational_health_monitor_v1(''database'')');
    update public.operational_health_state set scheduler_kind='pg_cron',updated_at=clock_timestamp()
      where singleton;
  end if;
exception when insufficient_privilege or undefined_table or undefined_function then
  update public.operational_health_state set scheduler_kind='external-required',updated_at=clock_timestamp()
    where singleton;
end $$;

select public._run_operational_health_monitor_v1('migration');

insert into public.momos_ops_migrations(id,detalle)
values('20260721_92_centro_salud_operativa',
  'Monitor servidor, incidentes sanitizados, solo lectura, backups y observabilidad central')
on conflict(id) do nothing;

commit;
