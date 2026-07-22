-- MOMOS OPS · prueba adversarial H93. Siempre ROLLBACK.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_test_h93'));

do $$
declare t text;
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260721_93_continuidad_recuperacion'),'Falta H93 continuidad y recuperacion.';
  foreach t in array array[
    'operational_continuity_policy','operational_backup_observations',
    'operational_recovery_drills','operational_contingency_actions'
  ] loop
    assert to_regclass('public.'||t) is not null
      and not has_table_privilege('authenticated','public.'||t,'SELECT')
      and not has_table_privilege('service_role','public.'||t,'SELECT')
      and (select relrowsecurity from pg_class where oid=('public.'||t)::regclass),
      'H93 expuso o no protegió '||t;
  end loop;
  assert has_function_privilege('authenticated','public.momos_continuity_snapshot_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.momos_contingency_export_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.registrar_accion_contingencia_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.registrar_observacion_backup_administrado_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.registrar_simulacro_recuperacion_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_continuity_snapshot_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public.registrar_simulacro_recuperacion_v1(jsonb)','EXECUTE'),
    'H93 perdio RBAC.';
end $$;

create temporary table h93_context(
  admin_id text not null,auth_id uuid not null,kitchen_id text not null,
  backup_verified_before timestamptz
) on commit drop;

do $$
declare v_admin public.users%rowtype; v_suffix text:=pg_backend_pid()::text;
begin
  select * into v_admin from public.users where activo and auth_id is not null
    and coalesce(roles,array[rol]) @> array['Administrador']::text[] order by id limit 1;
  assert v_admin.id is not null,'H93 necesita un Administrador autenticado.';
  insert into public.users(id,nombre,email,rol,roles,activo)
  values('H93-C-'||v_suffix,'Cocina H93','h93-c-'||v_suffix||'@momos.test',
    'Cocina',array['Cocina']::text[],true);
  insert into h93_context values(v_admin.id,v_admin.auth_id,'H93-C-'||v_suffix,
    (select last_backup_verified_at from public.operational_health_state where singleton));
end $$;
grant select on table h93_context to authenticated,service_role;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h93_context),'role','authenticated'
)::text,true);

do $$
declare v_policy jsonb; v_failed boolean:=false;
begin
  v_policy:=public.configurar_politica_continuidad_v1(jsonb_build_object(
    'expected_version',1,'core_rpo_minutes',5,'core_rto_minutes',30,
    'secondary_rto_minutes',240,'backup_retention_days',14,'drill_interval_days',30));
  assert (v_policy->>'version')::integer=2
    and (v_policy->>'coreRpoMinutes')::integer=5
    and coalesce((v_policy->>'externalExecution')::boolean,true)=false,
    'H93 no versiono la politica de continuidad.';
  begin
    perform public.configurar_politica_continuidad_v1(jsonb_build_object(
      'expected_version',1,'core_rpo_minutes',10,'core_rto_minutes',30,
      'secondary_rto_minutes',240,'backup_retention_days',14,'drill_interval_days',30));
  exception when sqlstate '40001' then v_failed:=true; end;
  assert v_failed,'H93 permitio sobrescribir una politica stale.';
end $$;

reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

do $$
declare v_observation jsonb; v_failed boolean:=false;
  v_completed timestamptz:=clock_timestamp()-interval '60 minutes';
begin
  v_observation:=public.registrar_observacion_backup_administrado_v1(jsonb_build_object(
    'backup_key','h93-managed-backup-001','source','Supabase','status','Completado',
    'completed_at',v_completed,'pitr_enabled',true,'region_code','us-east-1'));
  assert v_observation->>'backupKey'='h93-managed-backup-001'
    and coalesce((v_observation->>'observedOnly')::boolean,false)
    and not coalesce((v_observation->>'restored')::boolean,true)
    and coalesce((v_observation->>'containsSecrets')::boolean,true)=false,
    'H93 confundio observacion con restauracion.';
  perform public.registrar_observacion_backup_administrado_v1(jsonb_build_object(
    'backup_key','h93-managed-backup-001','source','Supabase','status','Completado',
    'completed_at',v_completed,'pitr_enabled',true,'region_code','us-east-1'));
  begin
    perform public.registrar_observacion_backup_administrado_v1(jsonb_build_object(
      'backup_key','h93-managed-backup-001','source','Supabase','status','Fallido',
      'completed_at',v_completed,'pitr_enabled',true,'region_code','us-east-1'));
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'H93 permitio mutar la evidencia del mismo backup.';
end $$;

reset role;
do $$
begin
  assert (select s.last_backup_verified_at is not distinct from c.backup_verified_before
    from public.operational_health_state s cross join h93_context c where s.singleton),
    'Un backup observado se marco verificado sin simulacro.';
end $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

do $$
declare v_failed boolean:=false; v_drill jsonb; v_payload jsonb;
  v_h97 boolean:=exists(select 1 from public.momos_ops_migrations
    where id='20260721_97_evidencia_recuperacion_derivada');
  v_checks jsonb;
begin
  v_checks:=jsonb_build_object(
    'migrations',true,'orders',true,'inventory',true,'reservations',true,
    'payments',true,'receipts',true,'replay',true
  )||case when v_h97 then jsonb_build_object('storage',true) else '{}'::jsonb end;
  v_payload:=jsonb_build_object(
    'id','93000000-0000-4000-8000-000000000001','drill_key','h93-drill-invalid-rto',
    'backup_key','h93-managed-backup-001','status','Aprobado',
    'started_at',clock_timestamp()-interval '40 minutes','completed_at',clock_timestamp(),
    'checks',v_checks,'replay_status','Completado'
  )||case when v_h97 then jsonb_build_object(
    'recovery_target_at',clock_timestamp()-interval '41 minutes',
    'restored_through_at',clock_timestamp()-interval '45 minutes',
    'storage_manifest_fingerprint',repeat('a',64),'storage_object_count',10,
    'replay_receipt_fingerprint',repeat('b',64),'replayed_event_count',2
  ) else jsonb_build_object('observed_rpo_minutes',4,'observed_rto_minutes',31) end;
  begin
    perform public.registrar_simulacro_recuperacion_v1(v_payload);
  exception when others then v_failed:=true; end;
  assert v_failed,'H93 aprobo un simulacro fuera del RTO.';
  v_payload:=jsonb_build_object(
    'id','93000000-0000-4000-8000-000000000002','drill_key','h93-drill-approved-001',
    'backup_key','h93-managed-backup-001','status','Aprobado',
    'started_at',clock_timestamp()-interval '25 minutes','completed_at',clock_timestamp(),
    'checks',v_checks,'replay_status','Completado'
  )||case when v_h97 then jsonb_build_object(
    'recovery_target_at',clock_timestamp()-interval '26 minutes',
    'restored_through_at',clock_timestamp()-interval '30 minutes',
    'storage_manifest_fingerprint',repeat('a',64),'storage_object_count',10,
    'replay_receipt_fingerprint',repeat('b',64),'replayed_event_count',2
  ) else jsonb_build_object('observed_rpo_minutes',4,'observed_rto_minutes',25) end;
  v_drill:=public.registrar_simulacro_recuperacion_v1(v_payload);
  assert coalesce((v_drill->>'certified')::boolean,false)
    and (v_drill->>'rpoMinutes')::numeric=4 and (v_drill->>'rtoMinutes')::numeric=25
    and coalesce((v_drill->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_drill->>'containsFreeText')::boolean,true)=false,
    'H93 no sello el simulacro conforme.';
  v_failed:=false;
  v_payload:=jsonb_set(v_payload,'{status}','"Fallido"'::jsonb);
  begin
    perform public.registrar_simulacro_recuperacion_v1(v_payload);
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'H93 permitio reescribir el simulacro sellado.';
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h93_context),'role','authenticated'
)::text,true);

do $$
declare v_snapshot jsonb; v_text text;
begin
  v_snapshot:=public.momos_continuity_snapshot_v1();
  v_text:=lower(v_snapshot::text);
  assert v_snapshot->>'contract'='momos.continuity.v1'
    and coalesce((v_snapshot#>>'{backup,observed}')::boolean,false)
    and coalesce((v_snapshot#>>'{recovery,tested}')::boolean,false)
    and coalesce((v_snapshot#>>'{recovery,certified}')::boolean,false)
    and coalesce((v_snapshot->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_snapshot->>'containsSecrets')::boolean,true)=false
    and coalesce((v_snapshot->>'containsPaths')::boolean,true)=false
    and coalesce((v_snapshot->>'containsFreeText')::boolean,true)=false,
    'El snapshot H93 no distingue observacion, prueba y certificacion.';
  assert v_text !~ 'telefono|direccion|storage_path|api[_-]?key|access[_-]?token|@momos.test',
    'El snapshot H93 expuso PII, rutas o secretos.';
  perform public.establecer_modo_contingencia_v1(true,'SIMULACRO_H93');
end $$;

reset role;
-- Cocina presta temporalmente la identidad autenticada para verificar que el
-- export conserva exactamente la proyeccion de privacidad H88.
do $$
declare v_admin text; v_auth uuid; v_kitchen text;
begin
  select admin_id,auth_id,kitchen_id into v_admin,v_auth,v_kitchen from h93_context;
  update public.users set auth_id=null where id=v_admin;
  update public.users set auth_id=v_auth where id=v_kitchen;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h93_context),'role','authenticated'
)::text,true);

do $$
declare v_action jsonb; v_replay jsonb; v_export jsonb; v_failed boolean:=false;
  v_occurred timestamptz:=clock_timestamp();
begin
  v_action:=public.registrar_accion_contingencia_v1(jsonb_build_object(
    'idempotency_key','93000000-0000-4000-8000-000000000010','domain','COCINA',
    'action_code','COCINA_INICIO','entity_ref','P-H93','device_ref','tablet-cocina-1',
    'local_sequence',1,'occurred_at',v_occurred));
  v_replay:=public.registrar_accion_contingencia_v1(jsonb_build_object(
    'idempotency_key','93000000-0000-4000-8000-000000000010','domain','COCINA',
    'action_code','COCINA_INICIO','entity_ref','P-H93','device_ref','tablet-cocina-1',
    'local_sequence',1,'occurred_at',v_occurred));
  assert v_action->>'status'='Pendiente' and not coalesce((v_action->>'duplicate')::boolean,true)
    and coalesce((v_replay->>'duplicate')::boolean,false),
    'H93 perdio idempotencia en la bitacora manual.';
  begin
    perform public.registrar_accion_contingencia_v1(jsonb_build_object(
      'idempotency_key','93000000-0000-4000-8000-000000000011','domain','COCINA',
      'action_code','COCINA_LISTO','entity_ref','P-H93','device_ref','tablet-cocina-1',
      'local_sequence',1,'occurred_at',clock_timestamp()));
  exception when unique_violation then v_failed:=true; end;
  assert v_failed,'H93 reutilizo una secuencia local para otra accion.';
  v_export:=public.momos_contingency_export_v1();
  assert v_export->>'contract'='momos.contingency-export.v1'
    and v_export->'roleScope'=jsonb_build_array('Cocina')
    and coalesce((v_export#>>'{privacy,contains_customer_pii}')::boolean,true)=false
    and coalesce((v_export#>>'{privacy,contains_secrets}')::boolean,true)=false
    and v_export::text !~* 'telefono|direccion|comprobante|storage_path|api[_-]?key',
    'La exportacion de Cocina amplio privilegios o expuso PII.';
end $$;

reset role;
do $$
declare v_admin text; v_auth uuid; v_kitchen text;
begin
  select admin_id,auth_id,kitchen_id into v_admin,v_auth,v_kitchen from h93_context;
  update public.users set auth_id=null where id=v_kitchen;
  update public.users set auth_id=v_auth where id=v_admin;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h93_context),'role','authenticated'
)::text,true);
do $$
declare v_result jsonb; v_failed boolean:=false;
begin
  v_result:=public.conciliar_accion_contingencia_v1(
    '93000000-0000-4000-8000-000000000010','APLICADA_EN_SISTEMA');
  assert v_result->>'status'='Aplicada' and not coalesce((v_result->>'duplicate')::boolean,true),
    'H93 no concilio la accion manual.';
  v_result:=public.conciliar_accion_contingencia_v1(
    '93000000-0000-4000-8000-000000000010','APLICADA_EN_SISTEMA');
  assert coalesce((v_result->>'duplicate')::boolean,false),
    'H93 no hizo idempotente la conciliacion.';
  perform public.establecer_modo_contingencia_v1(false,'SIMULACRO_FINALIZADO');
  begin
    perform public.registrar_accion_contingencia_v1(jsonb_build_object(
      'idempotency_key','93000000-0000-4000-8000-000000000012','domain','PEDIDOS',
      'action_code','PEDIDO_RECIBIDO','entity_ref','P-H93B','device_ref','recepcion-1',
      'local_sequence',2,'occurred_at',clock_timestamp()));
  exception when others then v_failed:=true; end;
  assert v_failed,'H93 permitio bitacora manual fuera de contingencia.';
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_continuity_snapshot_v1(); exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo consultar continuidad.';
  v_failed:=false;
  begin perform public.momos_contingency_export_v1(); exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo exportar la operacion.';
end $$;

reset role;
select 'TESTS_OK — H93 RPO/RTO/backups/simulacro/contingencia/idempotencia/PII/RBAC PASS, rollback total' as resultado;
rollback;
