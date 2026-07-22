-- MOMOS OPS · prueba adversarial H97. Siempre ROLLBACK.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_test_h97'));

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260721_97_evidencia_recuperacion_derivada'),
    'Falta H97 evidencia de recuperación derivada.';
  assert exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='operational_recovery_drills'
        and column_name='recovery_target_at')
    and exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='operational_recovery_drills'
        and column_name='storage_manifest_fingerprint')
    and exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='operational_recovery_drills'
        and column_name='replay_receipt_fingerprint'),
    'H97 no instaló la evidencia temporal, de Storage o replay.';
  assert has_function_privilege('service_role',
      'public.registrar_simulacro_recuperacion_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated',
      'public.momos_continuity_snapshot_v1()','EXECUTE')
    and not has_function_privilege('authenticated',
      'public.registrar_simulacro_recuperacion_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon',
      'public.momos_continuity_snapshot_v1()','EXECUTE')
    and not has_table_privilege('service_role',
      'public.operational_recovery_drills','SELECT')
    and not has_table_privilege('authenticated',
      'public.operational_recovery_drills','SELECT'),
    'H97 perdió RBAC o expuso evidencia privada.';
end $$;

create temporary table h97_context(
  admin_auth_id uuid not null,
  backup_completed timestamptz not null,
  restored_through timestamptz not null,
  recovery_target timestamptz not null,
  drill_started timestamptz not null,
  drill_completed timestamptz not null
) on commit drop;

do $$
declare v_admin_auth uuid; v_now timestamptz:=clock_timestamp();
begin
  select auth_id into v_admin_auth from public.users
    where activo and auth_id is not null
      and coalesce(roles,array[rol]) @> array['Administrador']::text[]
    order by id limit 1;
  assert v_admin_auth is not null,'H97 necesita un Administrador autenticado.';
  update public.operational_continuity_policy set
    core_rpo_minutes=5,core_rto_minutes=30,drill_interval_days=30
    where singleton;
  insert into h97_context values(
    v_admin_auth,v_now-interval '60 minutes',v_now-interval '25 minutes',
    v_now-interval '21 minutes',v_now-interval '20 minutes',v_now
  );
end $$;
grant select on table h97_context to authenticated,service_role;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

do $$
declare v_result jsonb; v_failed boolean:=false;
  v_checks jsonb:=jsonb_build_object(
    'inventory',true,'migrations',true,'orders',true,'payments',true,
    'receipts',true,'replay',true,'reservations',true,'storage',true
  );
  v_without_storage jsonb:=jsonb_build_object(
    'inventory',true,'migrations',true,'orders',true,'payments',true,
    'receipts',true,'replay',true,'reservations',true
  );
  c h97_context%rowtype;
begin
  select * into c from h97_context;
  perform public.registrar_observacion_backup_administrado_v1(jsonb_build_object(
    'backup_key','h97-managed-backup-001','source','Supabase','status','Completado',
    'completed_at',c.backup_completed,'pitr_enabled',false,'region_code','us-east-1'
  ));

  begin
    perform public.registrar_simulacro_recuperacion_v1(jsonb_build_object(
      'id','97000000-0000-4000-8000-000000000001',
      'drill_key','h97-caller-metrics-forbidden','backup_key','h97-managed-backup-001',
      'status','Aprobado','started_at',c.drill_started,'completed_at',c.drill_completed,
      'recovery_target_at',c.recovery_target,'restored_through_at',c.restored_through,
      'observed_rpo_minutes',0,'observed_rto_minutes',1,'checks',v_checks,
      'replay_status','Completado','storage_manifest_fingerprint',repeat('a',64),
      'storage_object_count',10,'replay_receipt_fingerprint',repeat('b',64),
      'replayed_event_count',2
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H97 aceptó RPO/RTO autodeclarados por el llamador.';

  v_failed:=false;
  begin
    perform public.registrar_simulacro_recuperacion_v1(jsonb_build_object(
      'id','97000000-0000-4000-8000-000000000002',
      'drill_key','h97-impossible-chronology','backup_key','h97-managed-backup-001',
      'status','Fallido','started_at',c.drill_started,'completed_at',c.drill_completed,
      'recovery_target_at',c.drill_started+interval '1 minute',
      'restored_through_at',c.restored_through,'checks',v_checks,
      'replay_status','Fallido','storage_manifest_fingerprint',repeat('a',64),
      'storage_object_count',10,'replay_receipt_fingerprint',repeat('b',64),
      'replayed_event_count',0
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H97 aceptó una cronología físicamente imposible.';

  v_failed:=false;
  begin
    perform public.registrar_simulacro_recuperacion_v1(jsonb_build_object(
      'id','97000000-0000-4000-8000-000000000003',
      'drill_key','h97-storage-check-missing','backup_key','h97-managed-backup-001',
      'status','Aprobado','started_at',c.drill_started,'completed_at',c.drill_completed,
      'recovery_target_at',c.recovery_target,'restored_through_at',c.restored_through,
      'checks',v_without_storage,'replay_status','Completado',
      'storage_manifest_fingerprint',repeat('a',64),'storage_object_count',10,
      'replay_receipt_fingerprint',repeat('b',64),'replayed_event_count',2
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H97 certificó base de datos sin verificar objetos Storage.';

  v_failed:=false;
  begin
    perform public.registrar_simulacro_recuperacion_v1(jsonb_build_object(
      'id','97000000-0000-4000-8000-000000000004',
      'drill_key','h97-derived-rpo-too-high','backup_key','h97-managed-backup-001',
      'status','Aprobado','started_at',c.drill_started,'completed_at',c.drill_completed,
      'recovery_target_at',c.recovery_target,
      'restored_through_at',c.recovery_target-interval '6 minutes',
      'checks',v_checks,'replay_status','Completado',
      'storage_manifest_fingerprint',repeat('a',64),'storage_object_count',10,
      'replay_receipt_fingerprint',repeat('b',64),'replayed_event_count',2
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H97 aprobó un RPO derivado mayor al objetivo.';

  v_result:=public.registrar_simulacro_recuperacion_v1(jsonb_build_object(
    'id','97000000-0000-4000-8000-000000000005',
    'drill_key','h97-derived-approved-001','backup_key','h97-managed-backup-001',
    'status','Aprobado','started_at',c.drill_started,'completed_at',c.drill_completed,
    'recovery_target_at',c.recovery_target,'restored_through_at',c.restored_through,
    'checks',v_checks,'replay_status','Completado',
    'storage_manifest_fingerprint',repeat('a',64),'storage_object_count',10,
    'replay_receipt_fingerprint',repeat('b',64),'replayed_event_count',2
  ));
  assert (v_result->>'rpoMinutes')::numeric=4
    and (v_result->>'rtoMinutes')::numeric=20
    and coalesce((v_result->>'certified')::boolean,false)
    and coalesce((v_result->>'evidenceDerived')::boolean,false)
    and coalesce((v_result->>'storageVerified')::boolean,false)
    and not coalesce((v_result->>'duplicate')::boolean,true),
    'H97 no derivó o no selló un simulacro válido.';

  v_result:=public.registrar_simulacro_recuperacion_v1(jsonb_build_object(
    'id','97000000-0000-4000-8000-000000000005',
    'drill_key','h97-derived-approved-001','backup_key','h97-managed-backup-001',
    'status','Aprobado','started_at',c.drill_started,'completed_at',c.drill_completed,
    'recovery_target_at',c.recovery_target,'restored_through_at',c.restored_through,
    'checks',v_checks,'replay_status','Completado',
    'storage_manifest_fingerprint',repeat('a',64),'storage_object_count',10,
    'replay_receipt_fingerprint',repeat('b',64),'replayed_event_count',2
  ));
  assert coalesce((v_result->>'duplicate')::boolean,false),
    'H97 perdió idempotencia al repetir la misma evidencia.';

  v_failed:=false;
  begin
    perform public.registrar_simulacro_recuperacion_v1(jsonb_build_object(
      'id','97000000-0000-4000-8000-000000000005',
      'drill_key','h97-derived-approved-001','backup_key','h97-managed-backup-001',
      'status','Aprobado','started_at',c.drill_started,'completed_at',c.drill_completed,
      'recovery_target_at',c.recovery_target,'restored_through_at',c.restored_through,
      'checks',v_checks,'replay_status','Completado',
      'storage_manifest_fingerprint',repeat('a',64),'storage_object_count',10,
      'replay_receipt_fingerprint',repeat('b',64),'replayed_event_count',3
    ));
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'H97 permitió reescribir una evidencia ya sellada.';
end $$;

reset role;
do $$
declare v_failed boolean:=false; c h97_context%rowtype;
begin
  select * into c from h97_context;
  begin
    insert into public.operational_recovery_drills(
      id,drill_key,backup_key,environment,status,started_at,completed_at,
      observed_rpo_minutes,observed_rto_minutes,checks,replay_status,fingerprint,
      recovery_target_at
    ) values(
      '97000000-0000-4000-8000-000000000006','h97-partial-evidence-forbidden',
      'h97-managed-backup-001','Staging','Fallido',c.drill_started,c.drill_completed,
      0,20,jsonb_build_object('inventory',false),'Fallido',repeat('c',64),c.recovery_target
    );
  exception when check_violation then v_failed:=true; end;
  assert v_failed,'H97 permitió evidencia parcial mediante escritura directa.';
end $$;

set local role service_role;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select admin_auth_id::text from h97_context),'role','service_role'
)::text,true);

do $$
declare v_failed boolean:=false; c h97_context%rowtype;
begin
  select * into c from h97_context;
  begin
    perform public.registrar_simulacro_recuperacion_v1(jsonb_build_object(
      'id','97000000-0000-4000-8000-000000000007',
      'drill_key','h97-null-counter-forbidden','backup_key','h97-managed-backup-001',
      'status','Fallido','started_at',c.drill_started,'completed_at',c.drill_completed,
      'recovery_target_at',c.recovery_target,'restored_through_at',c.restored_through,
      'checks',jsonb_build_object(
        'inventory',false,'migrations',false,'orders',false,'payments',false,
        'receipts',false,'replay',false,'reservations',false,'storage',false
      ),
      'replay_status','Fallido','storage_manifest_fingerprint',repeat('a',64),
      'replay_receipt_fingerprint',repeat('b',64),'replayed_event_count',0
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H97 acepto evidencia incompleta con contador Storage nulo.';
end $$;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select admin_auth_id::text from h97_context),'role','authenticated'
)::text,true);

do $$
declare v_snapshot jsonb; v_text text;
begin
  v_snapshot:=public.momos_continuity_snapshot_v1();
  v_text:=lower(v_snapshot::text);
  assert v_snapshot->>'contract'='momos.continuity.v1'
    and coalesce((v_snapshot#>>'{backup,databaseOnly}')::boolean,false)
    and not coalesce((v_snapshot#>>'{backup,rpoCoverageObserved}')::boolean,true)
    and coalesce((v_snapshot#>>'{recovery,evidenceDerived}')::boolean,false)
    and coalesce((v_snapshot#>>'{recovery,storageVerified}')::boolean,false)
    and coalesce((v_snapshot#>>'{recovery,replayVerified}')::boolean,false)
    and coalesce((v_snapshot#>>'{recovery,certified}')::boolean,false)
    and (v_snapshot#>>'{recovery,rpoMinutes}')::numeric=4
    and (v_snapshot#>>'{recovery,rtoMinutes}')::numeric=20,
    'H97 no expuso el estado compacto y honesto de continuidad.';
  assert coalesce((v_snapshot->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_snapshot->>'containsSecrets')::boolean,true)=false
    and coalesce((v_snapshot->>'containsPaths')::boolean,true)=false
    and coalesce((v_snapshot->>'containsFreeText')::boolean,true)=false
    and v_text !~ 'telefono|direccion|storage_path|bucket|api[_-]?key|access[_-]?token|@momos.test|[0-9a-f]{64}',
    'H97 expuso PII, rutas, manifiestos o secretos.';
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_continuity_snapshot_v1();
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo consultar la evidencia H97.';
end $$;

reset role;
select 'TESTS_OK — H97 RPO/RTO derivados/Storage/replay/cronología/idempotencia/PII/RBAC PASS, rollback total' as resultado;
rollback;
