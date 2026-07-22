-- MOMOS OPS · H93 Continuidad y recuperación verificable v1
-- Separa evidencia observada, restauración ensayada y certificación RPO/RTO.
-- Ningún backup se declara recuperable por existir: exige un simulacro cerrado.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260721'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260721_92_centro_salud_operativa') then
    raise exception 'Falta H92 centro de salud operativa.';
  end if;
  if to_regprocedure('public.momos_operational_snapshot_v2()') is null
     or to_regprocedure('public._momos_h92_hash(jsonb)') is null
     or to_regclass('public.operational_health_state') is null then
    raise exception 'Faltan snapshots aislados o contratos de salud H92.';
  end if;
end $$;

alter table public.operational_health_state
  add column if not exists last_managed_backup_at timestamptz,
  add column if not exists pitr_enabled boolean not null default false,
  add column if not exists last_restore_drill_at timestamptz,
  add column if not exists last_restore_rpo_minutes numeric,
  add column if not exists last_restore_rto_minutes numeric,
  add column if not exists continuity_certified_until timestamptz;

do $$
begin
  if not exists(select 1 from pg_constraint
    where conrelid='public.operational_health_state'::regclass
      and conname='operational_health_state_restore_metrics_check') then
    alter table public.operational_health_state
      add constraint operational_health_state_restore_metrics_check check(
        (last_restore_rpo_minutes is null or last_restore_rpo_minutes>=0)
        and (last_restore_rto_minutes is null or last_restore_rto_minutes>=0)
      );
  end if;
end $$;

create table if not exists public.operational_continuity_policy(
  singleton boolean primary key default true check(singleton),
  core_rpo_minutes integer not null default 5 check(core_rpo_minutes between 1 and 60),
  core_rto_minutes integer not null default 30 check(core_rto_minutes between 5 and 240),
  secondary_rto_minutes integer not null default 240 check(secondary_rto_minutes between 30 and 1440),
  backup_retention_days integer not null default 7 check(backup_retention_days between 7 and 365),
  drill_interval_days integer not null default 30 check(drill_interval_days between 7 and 90),
  version bigint not null default 1 check(version>0),
  updated_by uuid,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.operational_continuity_policy(singleton) values(true)
on conflict(singleton) do nothing;

create table if not exists public.operational_backup_observations(
  backup_key text primary key check(backup_key ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  source text not null check(source in ('Supabase','Exportacion_cifrada')),
  status text not null check(status in ('Completado','Fallido')),
  completed_at timestamptz not null,
  observed_at timestamptz not null default clock_timestamp(),
  pitr_enabled boolean not null default false,
  region_code text not null check(region_code ~ '^[a-z0-9-]{2,32}$'),
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$')
);
create index if not exists operational_backup_observations_recent_idx
  on public.operational_backup_observations(completed_at desc,observed_at desc);

create table if not exists public.operational_recovery_drills(
  id uuid primary key,
  drill_key text not null unique check(drill_key ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  backup_key text not null references public.operational_backup_observations(backup_key) on delete restrict,
  environment text not null check(environment='Staging'),
  status text not null check(status in ('Aprobado','Fallido')),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  observed_rpo_minutes numeric not null check(observed_rpo_minutes>=0),
  observed_rto_minutes numeric not null check(observed_rto_minutes>=0),
  checks jsonb not null check(jsonb_typeof(checks)='object'),
  replay_status text not null check(replay_status in ('Completado','Fallido','No requerido')),
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists operational_recovery_drills_recent_idx
  on public.operational_recovery_drills(completed_at desc,id);

create table if not exists public.operational_contingency_actions(
  idempotency_key uuid primary key,
  domain text not null check(domain in ('PEDIDOS','COCINA','EMPAQUE','LOGISTICA','PAGOS')),
  action_code text not null check(action_code in (
    'PEDIDO_RECIBIDO','PAGO_RECIBIDO','COCINA_INICIO','COCINA_LISTO',
    'EMPAQUE_INICIO','EMPAQUE_LISTO','DESPACHO_SALIDA','ENTREGA_CONFIRMADA'
  )),
  entity_ref text not null check(entity_ref ~ '^[A-Z]{1,4}-[A-Za-z0-9-]{1,32}$'),
  device_ref text not null check(device_ref ~ '^[A-Za-z0-9_.:-]{3,80}$'),
  local_sequence bigint not null check(local_sequence>0),
  occurred_at timestamptz not null,
  status text not null default 'Pendiente'
    check(status in ('Pendiente','Aplicada','Descartada','Duplicada')),
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  reconciled_by uuid,
  reconciled_at timestamptz,
  resolution_code text check(resolution_code is null or resolution_code in (
    'APLICADA_EN_SISTEMA','YA_EXISTIA','ERROR_OPERATIVO'
  )),
  unique(device_ref,local_sequence)
);
create index if not exists operational_contingency_pending_idx
  on public.operational_contingency_actions(occurred_at,idempotency_key)
  where status='Pendiente';

do $$
declare t text;
begin
  foreach t in array array[
    'operational_continuity_policy','operational_backup_observations',
    'operational_recovery_drills','operational_contingency_actions'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create or replace function public.configurar_politica_continuidad_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_current public.operational_continuity_policy%rowtype; v_expected bigint;
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede configurar continuidad.'; end if;
  if jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) x(key)
    where key not in ('expected_version','core_rpo_minutes','core_rto_minutes',
      'secondary_rto_minutes','backup_retention_days','drill_interval_days')) then
    raise exception 'La politica de continuidad contiene campos no permitidos.';
  end if;
  select * into v_current from public.operational_continuity_policy where singleton for update;
  v_expected:=(p->>'expected_version')::bigint;
  if v_expected is distinct from v_current.version then
    raise exception 'La politica cambio en otra sesion. Recarga antes de guardar.' using errcode='40001';
  end if;
  update public.operational_continuity_policy set
    core_rpo_minutes=(p->>'core_rpo_minutes')::integer,
    core_rto_minutes=(p->>'core_rto_minutes')::integer,
    secondary_rto_minutes=(p->>'secondary_rto_minutes')::integer,
    backup_retention_days=(p->>'backup_retention_days')::integer,
    drill_interval_days=(p->>'drill_interval_days')::integer,
    version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
    where singleton;
  select * into v_current from public.operational_continuity_policy where singleton;
  return jsonb_build_object('ok',true,'version',v_current.version,
    'coreRpoMinutes',v_current.core_rpo_minutes,'coreRtoMinutes',v_current.core_rto_minutes,
    'secondaryRtoMinutes',v_current.secondary_rto_minutes,
    'backupRetentionDays',v_current.backup_retention_days,
    'drillIntervalDays',v_current.drill_interval_days,
    'externalExecution',false);
end $$;

create or replace function public.registrar_observacion_backup_administrado_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_key text; v_source text; v_status text; v_completed timestamptz;
  v_pitr boolean; v_region text; v_fp text; v_existing text; v_certified boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Solo el worker privado puede observar backups.'; end if;
  if jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) x(key)
    where key not in ('backup_key','source','status','completed_at','pitr_enabled','region_code')) then
    raise exception 'La observacion de backup contiene campos no permitidos.';
  end if;
  v_key:=btrim(coalesce(p->>'backup_key','')); v_source:=coalesce(p->>'source','');
  v_status:=coalesce(p->>'status',''); v_completed:=(p->>'completed_at')::timestamptz;
  v_pitr:=(p->>'pitr_enabled')::boolean; v_region:=lower(btrim(coalesce(p->>'region_code','')));
  if v_key !~ '^[A-Za-z0-9_.:-]{8,120}$' or v_source not in ('Supabase','Exportacion_cifrada')
     or v_status not in ('Completado','Fallido') or v_region !~ '^[a-z0-9-]{2,32}$'
     or v_completed>clock_timestamp()+interval '1 minute' then
    raise exception 'La observacion de backup no cumple el contrato.';
  end if;
  v_fp:=public._momos_h92_hash(jsonb_build_object('backupKey',v_key,'source',v_source,
    'status',v_status,'completedAt',v_completed,'pitrEnabled',v_pitr,'regionCode',v_region));
  select fingerprint into v_existing from public.operational_backup_observations where backup_key=v_key;
  if v_existing is not null and v_existing<>v_fp then
    raise exception 'El mismo backup no puede cambiar su evidencia.' using errcode='23505';
  end if;
  insert into public.operational_backup_observations(
    backup_key,source,status,completed_at,pitr_enabled,region_code,fingerprint
  ) values(v_key,v_source,v_status,v_completed,v_pitr,v_region,v_fp)
  on conflict(backup_key) do update set observed_at=clock_timestamp();
  select coalesce(s.continuity_certified_until>=clock_timestamp(),false)
      and exists(
        select 1 from public.operational_recovery_drills d
        where d.backup_key=v_key and d.status='Aprobado'
      )
    into v_certified
    from public.operational_health_state s where s.singleton;
  update public.operational_health_state set
    last_managed_backup_at=case when v_status='Completado' then greatest(last_managed_backup_at,v_completed) else last_managed_backup_at end,
    last_backup_at=case when v_status='Completado' then greatest(last_backup_at,v_completed) else last_backup_at end,
    pitr_enabled=v_pitr,
    last_backup_verified_at=case when v_status='Completado' and v_pitr and coalesce(v_certified,false)
      then clock_timestamp() else last_backup_verified_at end,
    version=version+1,updated_at=clock_timestamp() where singleton;
  return jsonb_build_object('ok',true,'backupKey',v_key,'status',v_status,
    'pitrEnabled',v_pitr,'observedOnly',true,'restored',false,'containsSecrets',false);
end $$;

create or replace function public.registrar_simulacro_recuperacion_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_id uuid; v_key text; v_backup text; v_status text; v_started timestamptz;
  v_completed timestamptz; v_rpo numeric; v_rto numeric; v_checks jsonb;
  v_replay text; v_fp text; v_existing text; v_policy public.operational_continuity_policy%rowtype;
  v_all_checks boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Solo el proceso privado de recuperacion puede certificar simulacros.'; end if;
  if jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) x(key)
    where key not in ('id','drill_key','backup_key','status','started_at','completed_at',
      'observed_rpo_minutes','observed_rto_minutes','checks','replay_status')) then
    raise exception 'El simulacro contiene campos no permitidos.';
  end if;
  v_id:=(p->>'id')::uuid; v_key:=btrim(coalesce(p->>'drill_key',''));
  v_backup:=btrim(coalesce(p->>'backup_key','')); v_status:=coalesce(p->>'status','');
  v_started:=(p->>'started_at')::timestamptz; v_completed:=(p->>'completed_at')::timestamptz;
  v_rpo:=(p->>'observed_rpo_minutes')::numeric; v_rto:=(p->>'observed_rto_minutes')::numeric;
  v_checks:=p->'checks'; v_replay:=coalesce(p->>'replay_status','');
  select * into v_policy from public.operational_continuity_policy where singleton;
  if v_key !~ '^[A-Za-z0-9_.:-]{8,120}$' or v_status not in ('Aprobado','Fallido')
     or v_replay not in ('Completado','Fallido','No requerido')
     or v_completed<v_started or v_completed>clock_timestamp()+interval '1 minute'
     or v_rpo<0 or v_rto<0 or not exists(select 1 from public.operational_backup_observations
       where backup_key=v_backup and status='Completado') then
    raise exception 'El simulacro no cumple el contrato temporal o de procedencia.';
  end if;
  if jsonb_typeof(v_checks)<>'object'
     or (select array_agg(key order by key) from jsonb_object_keys(v_checks) x(key))
        is distinct from array['inventory','migrations','orders','payments','receipts','replay','reservations']::text[] then
    raise exception 'El simulacro requiere exactamente siete verificaciones estructuradas.';
  end if;
  select bool_and(value::boolean) into v_all_checks from jsonb_each_text(v_checks);
  if v_status='Aprobado' and (not coalesce(v_all_checks,false) or v_replay<>'Completado'
     or v_rpo>v_policy.core_rpo_minutes or v_rto>v_policy.core_rto_minutes) then
    raise exception 'No se puede aprobar un simulacro que incumple verificaciones, RPO o RTO.';
  end if;
  v_fp:=public._momos_h92_hash(jsonb_build_object('id',v_id,'drillKey',v_key,
    'backupKey',v_backup,'status',v_status,'startedAt',v_started,'completedAt',v_completed,
    'rpo',v_rpo,'rto',v_rto,'checks',v_checks,'replayStatus',v_replay));
  select fingerprint into v_existing from public.operational_recovery_drills
    where id=v_id or drill_key=v_key limit 1;
  if v_existing is not null and v_existing<>v_fp then
    raise exception 'El simulacro sellado es inmutable.' using errcode='23505';
  end if;
  insert into public.operational_recovery_drills(
    id,drill_key,backup_key,environment,status,started_at,completed_at,
    observed_rpo_minutes,observed_rto_minutes,checks,replay_status,fingerprint
  ) values(v_id,v_key,v_backup,'Staging',v_status,v_started,v_completed,
    v_rpo,v_rto,v_checks,v_replay,v_fp) on conflict(id) do nothing;
  if v_status='Aprobado' then
    update public.operational_health_state set
      backup_monitoring_enabled=true,backup_rpo_minutes=v_policy.core_rpo_minutes,
      last_restore_drill_at=v_completed,last_restore_rpo_minutes=v_rpo,
      last_restore_rto_minutes=v_rto,
      continuity_certified_until=v_completed+make_interval(days=>v_policy.drill_interval_days),
      version=version+1,updated_at=clock_timestamp() where singleton;
  end if;
  return jsonb_build_object('ok',true,'drillId',v_id,'status',v_status,
    'rpoMinutes',v_rpo,'rtoMinutes',v_rto,'certified',v_status='Aprobado',
    'containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false);
end $$;

-- H92 conserva compatibilidad, pero desde H93 un recibo reportado no puede
-- promover por sí solo la fecha verificada: debe existir un simulacro aprobado.
create or replace function public.registrar_backup_operativo_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_key text; v_completed timestamptz; v_verified timestamptz; v_recoverable boolean;
  v_size bigint; v_checksum text; v_source text; v_existing public.operational_backup_receipts%rowtype;
  v_drill_verified boolean;
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
     or v_source not in ('Supabase','ExportaciÃ³n cifrada','Simulacro') then
    raise exception 'El recibo de backup no es valido.';
  end if;
  select * into v_existing from public.operational_backup_receipts where backup_key=v_key;
  if v_existing.backup_key is not null and (v_existing.completed_at<>v_completed
    or v_existing.verified_at is distinct from v_verified or v_existing.recoverable<>v_recoverable
    or v_existing.size_bytes<>v_size or v_existing.checksum<>v_checksum or v_existing.source<>v_source) then
    raise exception 'El recibo de backup es inmutable.' using errcode='23505';
  end if;
  insert into public.operational_backup_receipts(
    backup_key,completed_at,verified_at,recoverable,size_bytes,checksum,source
  ) values(v_key,v_completed,v_verified,v_recoverable,v_size,v_checksum,v_source)
  on conflict(backup_key) do nothing;
  select exists(select 1 from public.operational_recovery_drills
    where backup_key=v_key and status='Aprobado') into v_drill_verified;
  update public.operational_health_state set
    last_backup_at=greatest(last_backup_at,v_completed),
    last_backup_verified_at=case when v_recoverable and v_verified is not null and v_drill_verified
      then greatest(last_backup_verified_at,v_verified) else last_backup_verified_at end,
    version=version+1,updated_at=clock_timestamp() where singleton;
  return jsonb_build_object('ok',true,'backupKey',v_key,'recoverable',v_recoverable,
    'recoveryCertified',v_drill_verified,'containsPaths',false,'containsSecrets',false);
end $$;

create or replace function public.registrar_accion_contingencia_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_id uuid; v_domain text; v_action text; v_entity text; v_device text;
  v_sequence bigint; v_occurred timestamptz; v_fp text; v_existing text;
  v_roles text[]:=coalesce(public.current_roles(),array[]::text[]);
begin
  if public.is_staff() is not true then raise exception 'Sesion MOMOS no autorizada.'; end if;
  if not exists(select 1 from public.operational_health_state where singleton and read_only) then
    raise exception 'Las acciones de contingencia solo existen durante el modo Solo lectura.';
  end if;
  if jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) x(key)
    where key not in ('idempotency_key','domain','action_code','entity_ref','device_ref','local_sequence','occurred_at')) then
    raise exception 'La accion manual contiene campos no permitidos.';
  end if;
  v_id:=(p->>'idempotency_key')::uuid; v_domain:=coalesce(p->>'domain','');
  v_action:=coalesce(p->>'action_code',''); v_entity:=upper(btrim(coalesce(p->>'entity_ref','')));
  v_device:=btrim(coalesce(p->>'device_ref','')); v_sequence:=(p->>'local_sequence')::bigint;
  v_occurred:=(p->>'occurred_at')::timestamptz;
  if v_domain not in ('PEDIDOS','COCINA','EMPAQUE','LOGISTICA','PAGOS')
     or v_action not in ('PEDIDO_RECIBIDO','PAGO_RECIBIDO','COCINA_INICIO','COCINA_LISTO',
       'EMPAQUE_INICIO','EMPAQUE_LISTO','DESPACHO_SALIDA','ENTREGA_CONFIRMADA')
     or v_entity !~ '^[A-Z]{1,4}-[A-Z0-9-]{1,32}$' or v_device !~ '^[A-Za-z0-9_.:-]{3,80}$'
     or v_sequence<=0 or v_occurred>clock_timestamp()+interval '1 minute'
     or v_occurred<clock_timestamp()-interval '7 days' then
    raise exception 'La accion manual no cumple el contrato sanitario.';
  end if;
  if not ('Administrador'=any(v_roles)
    or (v_domain='COCINA' and 'Cocina'=any(v_roles))
    or (v_domain='EMPAQUE' and 'Empaque'=any(v_roles))
    or (v_domain='LOGISTICA' and v_roles&&array['Logistica','Logística','Mensajero']::text[])
    or (v_domain in ('PEDIDOS','PAGOS') and v_roles&&array['Cajero','Coordinador de pedidos']::text[])) then
    raise exception 'Tu rol no puede registrar esa accion de contingencia.' using errcode='42501';
  end if;
  v_fp:=public._momos_h92_hash(jsonb_build_object('id',v_id,'domain',v_domain,
    'action',v_action,'entity',v_entity,'device',v_device,'sequence',v_sequence,'occurredAt',v_occurred));
  select fingerprint into v_existing from public.operational_contingency_actions
    where idempotency_key=v_id or (device_ref=v_device and local_sequence=v_sequence) limit 1;
  if v_existing is not null and v_existing<>v_fp then
    raise exception 'La secuencia manual ya identifica otra accion.' using errcode='23505';
  end if;
  insert into public.operational_contingency_actions(
    idempotency_key,domain,action_code,entity_ref,device_ref,local_sequence,
    occurred_at,fingerprint,created_by
  ) values(v_id,v_domain,v_action,v_entity,v_device,v_sequence,v_occurred,v_fp,auth.uid())
  on conflict(idempotency_key) do nothing;
  return jsonb_build_object('ok',true,'idempotencyKey',v_id,'status','Pendiente',
    'duplicate',v_existing is not null,'containsCustomerPii',false,'containsFreeText',false);
end $$;

create or replace function public.conciliar_accion_contingencia_v1(
  p_idempotency_key uuid,p_resolution_code text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_status text;
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede conciliar contingencias.'; end if;
  if p_resolution_code not in ('APLICADA_EN_SISTEMA','YA_EXISTIA','ERROR_OPERATIVO') then
    raise exception 'Resolucion de contingencia invalida.';
  end if;
  v_status:=case p_resolution_code when 'APLICADA_EN_SISTEMA' then 'Aplicada'
    when 'YA_EXISTIA' then 'Duplicada' else 'Descartada' end;
  update public.operational_contingency_actions set status=v_status,
    resolution_code=p_resolution_code,reconciled_by=auth.uid(),reconciled_at=clock_timestamp()
    where idempotency_key=p_idempotency_key and status='Pendiente';
  if not found then
    if exists(select 1 from public.operational_contingency_actions
      where idempotency_key=p_idempotency_key and status=v_status and resolution_code=p_resolution_code) then
      return jsonb_build_object('ok',true,'idempotencyKey',p_idempotency_key,'status',v_status,'duplicate',true);
    end if;
    raise exception 'La accion no existe, ya fue conciliada con otro resultado o no esta pendiente.';
  end if;
  return jsonb_build_object('ok',true,'idempotencyKey',p_idempotency_key,'status',v_status,'duplicate',false);
end $$;

create or replace function public.momos_contingency_export_v1()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_base jsonb; v_orders jsonb; v_ids text[]; v_items jsonb; v_customers jsonb;
  v_deliveries jsonb; v_assignments jsonb; v_privacy jsonb;
begin
  if public.is_staff() is not true then raise exception 'Sesion MOMOS no autorizada.'; end if;
  if not exists(select 1 from public.operational_health_state where singleton and read_only) then
    raise exception 'La exportacion de contingencia solo se habilita en modo Solo lectura.';
  end if;
  v_base:=public.momos_operational_snapshot_v2();
  select coalesce(jsonb_agg(value order by value->>'fecha',value->>'hora',value->>'id'),'[]'::jsonb),
    coalesce(array_agg(value->>'id'),'{}'::text[]) into v_orders,v_ids
    from jsonb_array_elements(coalesce(v_base->'orders','[]'::jsonb))
    where value->>'estado' not in ('Entregado','Cancelado');
  select coalesce(jsonb_agg(value order by value->>'order_id',value->>'id'),'[]'::jsonb)
    into v_items from jsonb_array_elements(coalesce(v_base->'order_items','[]'::jsonb))
    where value->>'order_id'=any(v_ids);
  select coalesce(jsonb_agg(value order by value->>'id'),'[]'::jsonb) into v_customers
    from jsonb_array_elements(coalesce(v_base->'customers','[]'::jsonb))
    where value->>'id'=any(array(select distinct x->>'customer_id' from jsonb_array_elements(v_orders) x));
  select coalesce(jsonb_agg(value order by value->>'id'),'[]'::jsonb) into v_deliveries
    from jsonb_array_elements(coalesce(v_base->'deliveries','[]'::jsonb))
    where value->>'order_id'=any(v_ids);
  select coalesce(jsonb_agg(value order by value->>'order_id'),'[]'::jsonb) into v_assignments
    from jsonb_array_elements(coalesce(v_base->'order_stage_assignments','[]'::jsonb))
    where value->>'order_id'=any(v_ids);
  v_privacy:=coalesce(v_base->'privacy','{}'::jsonb);
  return jsonb_build_object('contract','momos.contingency-export.v1',
    'generatedAt',clock_timestamp(),'readOnly',true,'roleScope',v_base->'role_scope',
    'orders',v_orders,'orderItems',v_items,'customers',v_customers,
    'deliveries',v_deliveries,'stageAssignments',v_assignments,
    'privacy',v_privacy||jsonb_build_object('contains_secrets',false,'external_execution',false),
    'integrity',jsonb_build_object('orderCount',jsonb_array_length(v_orders),
      'fingerprint',public._momos_h92_hash(jsonb_build_object('orders',v_orders,'items',v_items))));
end $$;

create or replace function public.momos_continuity_snapshot_v1()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_policy public.operational_continuity_policy%rowtype;
  v_state public.operational_health_state%rowtype; v_backup public.operational_backup_observations%rowtype;
  v_drill public.operational_recovery_drills%rowtype;
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede consultar continuidad.'; end if;
  select * into v_policy from public.operational_continuity_policy where singleton;
  select * into v_state from public.operational_health_state where singleton;
  select * into v_backup from public.operational_backup_observations order by completed_at desc limit 1;
  select * into v_drill from public.operational_recovery_drills order by completed_at desc limit 1;
  return jsonb_build_object('contract','momos.continuity.v1',
    'policy',jsonb_build_object('version',v_policy.version,'coreRpoMinutes',v_policy.core_rpo_minutes,
      'coreRtoMinutes',v_policy.core_rto_minutes,'secondaryRtoMinutes',v_policy.secondary_rto_minutes,
      'backupRetentionDays',v_policy.backup_retention_days,'drillIntervalDays',v_policy.drill_interval_days),
    'backup',jsonb_build_object('observed',v_backup.backup_key is not null,
      'status',v_backup.status,'source',v_backup.source,'completedAt',v_backup.completed_at,
      'observedAt',v_backup.observed_at,'pitrEnabled',coalesce(v_backup.pitr_enabled,false)),
    'recovery',jsonb_build_object('tested',v_drill.id is not null,'status',v_drill.status,
      'completedAt',v_drill.completed_at,'rpoMinutes',v_drill.observed_rpo_minutes,
      'rtoMinutes',v_drill.observed_rto_minutes,
      'certified',coalesce(v_state.continuity_certified_until>=clock_timestamp(),false),
      'certifiedUntil',v_state.continuity_certified_until),
    'contingency',jsonb_build_object('readOnly',v_state.read_only,
      'pendingActions',(select count(*) from public.operational_contingency_actions where status='Pendiente')),
    'containsCustomerPii',false,'containsSecrets',false,'containsPaths',false,
    'containsFreeText',false,'externalExecution',false);
end $$;

revoke all on function public.configurar_politica_continuidad_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.registrar_observacion_backup_administrado_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.registrar_simulacro_recuperacion_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.registrar_backup_operativo_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.registrar_accion_contingencia_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.conciliar_accion_contingencia_v1(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.momos_contingency_export_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.momos_continuity_snapshot_v1()
  from public,anon,authenticated,service_role;

grant execute on function public.configurar_politica_continuidad_v1(jsonb) to authenticated;
grant execute on function public.registrar_observacion_backup_administrado_v1(jsonb) to service_role;
grant execute on function public.registrar_simulacro_recuperacion_v1(jsonb) to service_role;
grant execute on function public.registrar_backup_operativo_v1(jsonb) to service_role;
grant execute on function public.registrar_accion_contingencia_v1(jsonb) to authenticated;
grant execute on function public.conciliar_accion_contingencia_v1(uuid,text) to authenticated;
grant execute on function public.momos_contingency_export_v1() to authenticated;
grant execute on function public.momos_continuity_snapshot_v1() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260721_93_continuidad_recuperacion',
  'RPO/RTO, backups observados, restauracion certificada, exportacion y acciones de contingencia')
on conflict(id) do nothing;

commit;
