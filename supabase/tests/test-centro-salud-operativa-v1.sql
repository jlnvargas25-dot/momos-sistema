begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_test_h92'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations
    where id='20260721_92_centro_salud_operativa') then
    raise exception 'Falta H92 centro de salud operativa.';
  end if;
end $$;

do $$
declare t text;
begin
  assert to_regclass('public.operational_health_state') is not null
    and to_regclass('public.operational_health_runs') is not null
    and to_regclass('public.operational_health_checks') is not null
    and to_regclass('public.operational_health_incidents') is not null
    and to_regclass('public.operational_health_error_events') is not null
    and to_regclass('public.operational_backup_receipts') is not null,
    'H92 no creó todas sus fuentes privadas.';
  foreach t in array array[
    'operational_health_state','operational_health_runs','operational_health_checks',
    'operational_health_incidents','operational_health_error_events',
    'operational_backup_receipts','operational_health_worker_heartbeats'
  ] loop
    assert not has_table_privilege('authenticated','public.'||t,'SELECT')
      and not has_table_privilege('service_role','public.'||t,'SELECT')
      and (select relrowsecurity from pg_class where oid=('public.'||t)::regclass),
      'H92 expuso la tabla privada '||t;
  end loop;
  assert has_function_privilege('authenticated','public.momos_operational_health_snapshot_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.ejecutar_revision_salud_operativa_v1()','EXECUTE')
    and has_function_privilege('service_role','public.ejecutar_monitor_salud_operativa_v1(text,text)','EXECUTE')
    and has_function_privilege('service_role','public.registrar_backup_operativo_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_operational_health_snapshot_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public._run_operational_health_monitor_v1(text)','EXECUTE'),
    'H92 perdió RBAC o expuso el monitor interno.';
  assert (select count(*) from pg_trigger where not tgisinternal
    and tgname='momos_h92_read_only_guard')>=14,
    'H92 no protege todo el núcleo operativo en contingencia.';
end $$;

do $$
declare v_admin public.users%rowtype;
begin
  select * into v_admin from public.users
  where activo and auth_id is not null and coalesce(roles,array[rol]) @> array['Administrador']::text[]
  order by id limit 1;
  assert v_admin.id is not null,'Falta Administrador autenticado para H92.';
  perform set_config('momos.h92_admin_auth',v_admin.auth_id::text,true);
  perform set_config('momos.h92_item',(select id from public.inventory_items order by id limit 1),true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub',current_setting('momos.h92_admin_auth'),'role','authenticated')::text,true);

do $$
declare v_run jsonb; v_snapshot jsonb; v_text text;
begin
  v_run:=public.ejecutar_revision_salud_operativa_v1();
  assert v_run->>'status' in ('Saludable','Degradado','Incidente','Solo lectura')
    and (v_run->>'checks')::integer>=8
    and coalesce((v_run->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_run->>'containsSecrets')::boolean,true)=false,
    'El monitor manual no devolvió su contrato cerrado.';
  v_snapshot:=public.momos_operational_health_snapshot_v1();
  assert v_snapshot->>'contract'='momos.operational-health.v1'
    and coalesce((v_snapshot->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_snapshot->>'containsSecrets')::boolean,true)=false
    and coalesce((v_snapshot->>'containsFreeText')::boolean,true)=false,
    'El snapshot H92 perdió privacidad o contrato.';
  v_text:=lower(v_snapshot::text);
  assert v_text !~ 'telefono|direcci[oó]n|storage_path|api[_-]?key|access[_-]?token|@gmail|@hotmail',
    'El snapshot H92 expuso PII, ruta o secreto.';
end $$;

do $$
declare v_failed boolean:=false; v_receipt jsonb;
begin
  begin
    perform public.registrar_error_operativo_v1(jsonb_build_object(
      'correlation_id','92000000-0000-4000-8000-000000000001',
      'source','frontend','operation','orders.confirm','error_code','NETWORK_TIMEOUT',
      'severity','Alta','message','teléfono 3000000000'
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H92 aceptó un mensaje libre o campo no permitido.';
  v_receipt:=public.registrar_error_operativo_v1(jsonb_build_object(
    'correlation_id','92000000-0000-4000-8000-000000000001',
    'source','frontend','operation','orders.confirm','error_code','NETWORK_TIMEOUT','severity','Alta'
  ));
  assert v_receipt->>'correlationId'='92000000-0000-4000-8000-000000000001'
    and coalesce((v_receipt->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_receipt->>'containsSecrets')::boolean,true)=false,
    'H92 no registró el error sanitario.';
end $$;

-- Corrupción deliberada diferida: el monitor debe verla, abrir incidente y
-- congelar las mutaciones autenticadas antes de que pueda confirmarse.
reset role;
select set_config('request.jwt.claims','{}',true);
set constraints all deferred;
update public.inventory_items set stock=stock+1 where id=current_setting('momos.h92_item');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub',current_setting('momos.h92_admin_auth'),'role','authenticated')::text,true);

do $$
declare v_run jsonb; v_failed boolean:=false;
begin
  v_run:=public.ejecutar_revision_salud_operativa_v1();
  assert coalesce((v_run->>'readOnly')::boolean,false)
    and (v_run->>'failures')::integer>=1,
    'H92 no congeló una divergencia de inventario real.';
  begin
    perform public.entrada_insumo_lote_delta(jsonb_build_object(
      'idempotency_key','92000000-0000-4000-8000-000000000002',
      'item_id',current_setting('momos.h92_item'),'cant',1,'costo_total',1,
      'proveedor','TEST H92','ubicacion','TEST H92','vence',null
    ));
  exception when sqlstate '55000' then v_failed:=true; end;
  assert v_failed,'El modo Solo lectura permitió una mutación operativa.';
  v_failed:=false;
  begin perform public.establecer_modo_contingencia_v1(false,'REACTIVACION_PREMATURA');
  exception when others then v_failed:=true; end;
  assert v_failed,'H92 permitió reactivar con un fallo crítico activo.';
end $$;

-- Reparación break-glass simulada por el dueño de la base. La aplicación no
-- posee este camino; en un incidente real pertenece al runbook de restauración.
reset role;
select set_config('request.jwt.claims','{}',true);
do $$
declare v_incident bigint;
begin
  select id into v_incident from public.operational_health_incidents
    where incident_key='INVENTORY_RECONCILIATION' and status='Abierto' and auto_read_only;
  assert v_incident is not null,'H92 no abrió el incidente crítico privado.';
  perform set_config('momos.h92_incident',v_incident::text,true);
end $$;
update public.operational_health_state set read_only=false,status='Degradado',
  reason_code='TEST_REPAIR' where singleton;
update public.inventory_items set stock=stock-1 where id=current_setting('momos.h92_item');
set constraints all immediate;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub',current_setting('momos.h92_admin_auth'),'role','authenticated')::text,true);
do $$
declare v_run jsonb; v_snapshot jsonb; v_result jsonb; v_incident bigint;
begin
  v_run:=public.ejecutar_revision_salud_operativa_v1();
  assert not coalesce((v_run->>'readOnly')::boolean,true),'H92 no verificó la reparación.';
  v_incident:=current_setting('momos.h92_incident')::bigint;
  v_snapshot:=public.momos_operational_health_snapshot_v1();
  assert exists(select 1 from jsonb_array_elements(v_snapshot->'incidents') i
      where (i->>'id')::bigint=v_incident and i->>'status'='Recuperado'),
    'H92 no marcó el incidente como recuperado.';
  perform public.establecer_modo_contingencia_v1(false,'INTEGRITY_VERIFIED');
  v_result:=public.resolver_incidente_salud_v1(v_incident,'CORREGIDO');
  assert v_result->>'status'='Resuelto',
    'H92 no cerró el incidente después de verificar la recuperación.';
end $$;

reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare v_backup jsonb; v_run jsonb;
begin
  v_backup:=public.registrar_backup_operativo_v1(jsonb_build_object(
    'backup_key','backup-h92-test','completed_at',clock_timestamp()-interval '1 minute',
    'verified_at',clock_timestamp(),'recoverable',true,'size_bytes',1024,
    'checksum',repeat('a',64),'source','Simulacro'
  ));
  assert v_backup->>'backupKey'='backup-h92-test'
    and coalesce((v_backup->>'containsPaths')::boolean,true)=false
    and coalesce((v_backup->>'containsSecrets')::boolean,true)=false,
    'El recibo de backup expuso una ruta o secreto.';
  v_run:=public.ejecutar_monitor_salud_operativa_v1('test-h92-worker','momos-health/1.0.0');
  assert v_run->>'runId' is not null,
    'El worker H92 no dejó heartbeat y ejecución unidos.';
  perform set_config('momos.h92_worker_run',v_run->>'runId',true);
end $$;

reset role;
do $$ begin
  assert exists(select 1 from public.operational_health_worker_heartbeats
    where worker_id='test-h92-worker'
      and last_run_id=current_setting('momos.h92_worker_run')::uuid),
    'El heartbeat privado no quedó unido a su ejecución.';
end $$;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_operational_health_snapshot_v1();
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo consultar salud técnica.';
  v_failed:=false;
  begin perform public.registrar_error_operativo_v1(jsonb_build_object(
    'correlation_id','92000000-0000-4000-8000-000000000003','source','frontend',
    'operation','orders.confirm','error_code','TEST_ERROR','severity','Media'));
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo registrar telemetría técnica.';
end $$;

reset role;
select 'TESTS_OK — H92 monitor/solo lectura/incidentes/backups/errores/PII/RBAC PASS, rollback total' as resultado;
rollback;
