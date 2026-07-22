-- MOMOS OPS · H97 Evidencia de recuperación derivada v1
-- RPO y RTO se calculan en servidor; Storage y replay requieren manifiestos sellados.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260721'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260721_96_telemetria_alertas') then
    raise exception 'Falta H96 telemetría y alertas operativas.';
  end if;
  if to_regclass('public.operational_recovery_drills') is null
     or to_regprocedure('public.registrar_simulacro_recuperacion_v1(jsonb)') is null
     or to_regprocedure('public.momos_continuity_snapshot_v1()') is null then
    raise exception 'Falta H93 continuidad y recuperación verificable.';
  end if;
end $$;

alter table public.operational_recovery_drills
  add column if not exists recovery_target_at timestamptz,
  add column if not exists restored_through_at timestamptz,
  add column if not exists recovery_method text,
  add column if not exists storage_verified boolean,
  add column if not exists storage_manifest_fingerprint text,
  add column if not exists storage_object_count bigint,
  add column if not exists replay_receipt_fingerprint text,
  add column if not exists replayed_event_count bigint;

do $$
begin
  if not exists(select 1 from pg_constraint
    where conrelid='public.operational_recovery_drills'::regclass
      and conname='operational_recovery_drills_derived_evidence_check') then
    alter table public.operational_recovery_drills
      add constraint operational_recovery_drills_derived_evidence_check check(
        (
          recovery_target_at is null and restored_through_at is null
          and recovery_method is null and storage_verified is null
          and storage_manifest_fingerprint is null and storage_object_count is null
          and replay_receipt_fingerprint is null and replayed_event_count is null
        ) or (
          recovery_target_at is not null and restored_through_at is not null
          and recovery_method in ('PITR','Backup_diario_replay','Exportacion_cifrada')
          and restored_through_at<=recovery_target_at and recovery_target_at<=started_at
          and storage_verified is not null
          and storage_manifest_fingerprint is not null
          and storage_manifest_fingerprint ~ '^[0-9a-f]{64}$'
          and storage_object_count is not null and storage_object_count>0
          and replay_receipt_fingerprint is not null
          and replay_receipt_fingerprint ~ '^[0-9a-f]{64}$'
          and replayed_event_count is not null and replayed_event_count>=0
        )
      );
  end if;
end $$;

create or replace function public.registrar_simulacro_recuperacion_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_id uuid; v_key text; v_backup text; v_status text;
  v_started timestamptz; v_completed timestamptz; v_target timestamptz;
  v_restored_through timestamptz; v_backup_completed timestamptz;
  v_backup_pitr boolean; v_backup_source text; v_method text;
  v_rpo numeric; v_rto numeric; v_checks jsonb; v_replay text;
  v_storage_fp text; v_storage_count bigint; v_replay_fp text; v_replay_count bigint;
  v_storage_verified boolean; v_fp text; v_existing text;
  v_policy public.operational_continuity_policy%rowtype;
  v_all_checks boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Solo el proceso privado de recuperación puede certificar simulacros.';
  end if;
  if jsonb_typeof(p)<>'object' or exists(
    select 1 from jsonb_object_keys(p) x(key)
    where key not in (
      'id','drill_key','backup_key','status','started_at','completed_at',
      'recovery_target_at','restored_through_at','checks','replay_status',
      'storage_manifest_fingerprint','storage_object_count',
      'replay_receipt_fingerprint','replayed_event_count'
    )
  ) then
    raise exception 'El simulacro contiene campos no permitidos.';
  end if;

  v_id:=(p->>'id')::uuid;
  v_key:=btrim(coalesce(p->>'drill_key',''));
  v_backup:=btrim(coalesce(p->>'backup_key',''));
  v_status:=coalesce(p->>'status','');
  v_started:=(p->>'started_at')::timestamptz;
  v_completed:=(p->>'completed_at')::timestamptz;
  v_target:=(p->>'recovery_target_at')::timestamptz;
  v_restored_through:=(p->>'restored_through_at')::timestamptz;
  v_checks:=p->'checks';
  v_replay:=coalesce(p->>'replay_status','');
  v_storage_fp:=lower(btrim(coalesce(p->>'storage_manifest_fingerprint','')));
  v_storage_count:=(p->>'storage_object_count')::bigint;
  v_replay_fp:=lower(btrim(coalesce(p->>'replay_receipt_fingerprint','')));
  v_replay_count:=(p->>'replayed_event_count')::bigint;

  select completed_at,pitr_enabled,source
    into v_backup_completed,v_backup_pitr,v_backup_source
    from public.operational_backup_observations
    where backup_key=v_backup and status='Completado';
  select * into v_policy from public.operational_continuity_policy where singleton;

  if v_id is null
     or v_key !~ '^[A-Za-z0-9_.:-]{8,120}$'
     or v_status not in ('Aprobado','Fallido')
     or v_replay not in ('Completado','Fallido','No requerido')
     or v_backup_completed is null
     or v_started is null or v_completed is null
     or v_target is null or v_restored_through is null
     or v_backup_completed>v_restored_through
     or v_restored_through>v_target
     or v_target>v_started
     or v_started>v_completed
     or v_completed>clock_timestamp()+interval '1 minute'
     or v_storage_fp !~ '^[0-9a-f]{64}$'
     or v_storage_count is null or v_storage_count<=0
     or v_replay_fp !~ '^[0-9a-f]{64}$'
     or v_replay_count is null or v_replay_count<0 then
    raise exception 'El simulacro no cumple el contrato temporal o de procedencia.';
  end if;
  if jsonb_typeof(v_checks)<>'object'
     or (select array_agg(key order by key) from jsonb_object_keys(v_checks) x(key))
        is distinct from array[
          'inventory','migrations','orders','payments','receipts','replay','reservations','storage'
        ]::text[]
     or exists(select 1 from jsonb_each(v_checks) where jsonb_typeof(value)<>'boolean') then
    raise exception 'El simulacro requiere exactamente ocho verificaciones booleanas estructuradas.';
  end if;

  select bool_and(value::boolean) into v_all_checks from jsonb_each_text(v_checks);
  v_storage_verified:=coalesce((v_checks->>'storage')::boolean,false)
    and v_storage_count>0 and v_storage_fp ~ '^[0-9a-f]{64}$';
  v_rpo:=round((extract(epoch from (v_target-v_restored_through))/60.0)::numeric,2);
  v_rto:=round((extract(epoch from (v_completed-v_started))/60.0)::numeric,2);
  v_method:=case
    when coalesce(v_backup_pitr,false) then 'PITR'
    when v_backup_source='Exportacion_cifrada' then 'Exportacion_cifrada'
    else 'Backup_diario_replay'
  end;

  if v_status='Aprobado' and (
    not coalesce(v_all_checks,false) or not v_storage_verified
    or v_replay<>'Completado'
    or v_rpo>v_policy.core_rpo_minutes or v_rto>v_policy.core_rto_minutes
  ) then
    raise exception 'No se puede aprobar un simulacro que incumple verificaciones, Storage, replay, RPO o RTO.';
  end if;

  v_fp:=public._momos_h92_hash(jsonb_build_object(
    'id',v_id,'drillKey',v_key,'backupKey',v_backup,'status',v_status,
    'startedAt',v_started,'completedAt',v_completed,'recoveryTargetAt',v_target,
    'restoredThroughAt',v_restored_through,'recoveryMethod',v_method,
    'rpo',v_rpo,'rto',v_rto,'checks',v_checks,'replayStatus',v_replay,
    'storageManifestFingerprint',v_storage_fp,'storageObjectCount',v_storage_count,
    'replayReceiptFingerprint',v_replay_fp,'replayedEventCount',v_replay_count
  ));
  select fingerprint into v_existing
    from public.operational_recovery_drills
    where id=v_id or drill_key=v_key limit 1;
  if v_existing is not null and v_existing<>v_fp then
    raise exception 'El simulacro sellado es inmutable.' using errcode='23505';
  end if;
  if v_existing=v_fp then
    return jsonb_build_object(
      'ok',true,'drillId',v_id,'status',v_status,'rpoMinutes',v_rpo,
      'rtoMinutes',v_rto,'certified',v_status='Aprobado','duplicate',true,
      'evidenceDerived',true,'storageVerified',v_storage_verified,
      'containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false
    );
  end if;

  insert into public.operational_recovery_drills(
    id,drill_key,backup_key,environment,status,started_at,completed_at,
    observed_rpo_minutes,observed_rto_minutes,checks,replay_status,fingerprint,
    recovery_target_at,restored_through_at,recovery_method,storage_verified,
    storage_manifest_fingerprint,storage_object_count,replay_receipt_fingerprint,
    replayed_event_count
  ) values(
    v_id,v_key,v_backup,'Staging',v_status,v_started,v_completed,
    v_rpo,v_rto,v_checks,v_replay,v_fp,v_target,v_restored_through,v_method,
    v_storage_verified,v_storage_fp,v_storage_count,v_replay_fp,v_replay_count
  );

  update public.operational_health_state set
    backup_monitoring_enabled=true,
    backup_rpo_minutes=v_policy.core_rpo_minutes,
    last_restore_drill_at=v_completed,
    last_restore_rpo_minutes=v_rpo,
    last_restore_rto_minutes=v_rto,
    continuity_certified_until=case when v_status='Aprobado'
      then v_completed+make_interval(days=>v_policy.drill_interval_days) else null end,
    version=version+1,
    updated_at=clock_timestamp()
  where singleton;

  return jsonb_build_object(
    'ok',true,'drillId',v_id,'status',v_status,'rpoMinutes',v_rpo,
    'rtoMinutes',v_rto,'certified',v_status='Aprobado','duplicate',false,
    'evidenceDerived',true,'storageVerified',v_storage_verified,
    'containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false
  );
end $$;

create or replace function public.momos_continuity_snapshot_v1()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_policy public.operational_continuity_policy%rowtype;
  v_state public.operational_health_state%rowtype;
  v_backup public.operational_backup_observations%rowtype;
  v_drill public.operational_recovery_drills%rowtype;
  v_backup_age numeric; v_all_checks boolean; v_certified boolean;
begin
  if public.is_admin() is not true then
    raise exception 'Solo un Administrador puede consultar continuidad.';
  end if;
  select * into v_policy from public.operational_continuity_policy where singleton;
  select * into v_state from public.operational_health_state where singleton;
  select * into v_backup from public.operational_backup_observations
    order by completed_at desc limit 1;
  select * into v_drill from public.operational_recovery_drills
    order by completed_at desc,id limit 1;
  if v_backup.completed_at is not null then
    v_backup_age:=round((extract(epoch from (clock_timestamp()-v_backup.completed_at))/60.0)::numeric,2);
  end if;
  if v_drill.checks is not null then
    select bool_and(value::boolean) into v_all_checks from jsonb_each_text(v_drill.checks);
  end if;
  v_certified:=coalesce(v_state.continuity_certified_until>=clock_timestamp(),false)
    and v_drill.status='Aprobado'
    and v_drill.recovery_target_at is not null
    and v_drill.restored_through_at is not null
    and coalesce(v_drill.storage_verified,false)
    and coalesce(v_all_checks,false)
    and v_drill.replay_status='Completado';

  return jsonb_build_object(
    'contract','momos.continuity.v1',
    'policy',jsonb_build_object(
      'version',v_policy.version,'coreRpoMinutes',v_policy.core_rpo_minutes,
      'coreRtoMinutes',v_policy.core_rto_minutes,
      'secondaryRtoMinutes',v_policy.secondary_rto_minutes,
      'backupRetentionDays',v_policy.backup_retention_days,
      'drillIntervalDays',v_policy.drill_interval_days
    ),
    'backup',jsonb_build_object(
      'observed',v_backup.backup_key is not null,'status',v_backup.status,
      'source',v_backup.source,'completedAt',v_backup.completed_at,
      'observedAt',v_backup.observed_at,'pitrEnabled',coalesce(v_backup.pitr_enabled,false),
      'ageMinutes',v_backup_age,'databaseOnly',true,
      'rpoCoverageObserved',coalesce(v_backup.pitr_enabled,false)
        or coalesce(v_backup_age<=v_policy.core_rpo_minutes,false)
    ),
    'recovery',jsonb_build_object(
      'tested',v_drill.id is not null,'status',v_drill.status,
      'completedAt',v_drill.completed_at,
      'recoveryTargetAt',v_drill.recovery_target_at,
      'restoredThroughAt',v_drill.restored_through_at,
      'recoveryMethod',v_drill.recovery_method,
      'rpoMinutes',v_drill.observed_rpo_minutes,
      'rtoMinutes',v_drill.observed_rto_minutes,
      'evidenceDerived',v_drill.recovery_target_at is not null
        and v_drill.restored_through_at is not null,
      'storageVerified',coalesce(v_drill.storage_verified,false),
      'storageObjectCount',v_drill.storage_object_count,
      'replayVerified',v_drill.replay_status='Completado'
        and v_drill.replay_receipt_fingerprint is not null,
      'replayedEventCount',v_drill.replayed_event_count,
      'certified',v_certified,
      'certifiedUntil',case when v_certified then v_state.continuity_certified_until end
    ),
    'contingency',jsonb_build_object(
      'readOnly',v_state.read_only,
      'pendingActions',(select count(*) from public.operational_contingency_actions
        where status='Pendiente')
    ),
    'containsCustomerPii',false,'containsSecrets',false,'containsPaths',false,
    'containsFreeText',false,'externalExecution',false
  );
end $$;

-- Una certificación creada con métricas declaradas antes de H97 deja de mostrarse
-- como vigente. La evidencia histórica se conserva intacta para auditoría.
update public.operational_health_state s set
  continuity_certified_until=null,
  version=version+1,
  updated_at=clock_timestamp()
where s.singleton and s.continuity_certified_until is not null
  and not exists(
    select 1 from public.operational_recovery_drills d
    where d.status='Aprobado'
      and d.completed_at=s.last_restore_drill_at
      and d.recovery_target_at is not null
      and d.restored_through_at is not null
      and d.storage_verified
  );

revoke all on function public.registrar_simulacro_recuperacion_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.momos_continuity_snapshot_v1()
  from public,anon,authenticated,service_role;
grant execute on function public.registrar_simulacro_recuperacion_v1(jsonb) to service_role;
grant execute on function public.momos_continuity_snapshot_v1() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260721_97_evidencia_recuperacion_derivada',
  'RPO/RTO derivados, Storage y replay sellados, certificación sin evidencia autodeclarada')
on conflict(id) do nothing;

commit;
