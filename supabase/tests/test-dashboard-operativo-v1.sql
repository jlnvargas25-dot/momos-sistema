-- MOMOS OPS · prueba adversarial H77 Dashboard operativo compacto. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_dashboard_operativo_20260719'));

do $$
declare v_staff_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_77_dashboard_operativo'),
    'Falta aplicar H77.';
  assert to_regclass('public.dashboard_sync_state') is not null
    and to_regprocedure('public.momos_dashboard_snapshot_v1()') is not null
    and to_regprocedure('public.dashboard_operativo_disponible()') is not null,
    'Falta una pieza del contrato H77.';
  assert has_function_privilege('authenticated','public.momos_dashboard_snapshot_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.dashboard_operativo_disponible()','EXECUTE')
    and not has_function_privilege('anon','public.momos_dashboard_snapshot_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_dashboard_snapshot_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public._touch_dashboard_sync_state()','EXECUTE'),
    'H77 abrió la frontera RBAC de sus funciones.';
  assert has_table_privilege('authenticated','public.dashboard_sync_state','SELECT')
    and not has_table_privilege('authenticated','public.dashboard_sync_state','INSERT')
    and not has_table_privilege('authenticated','public.dashboard_sync_state','UPDATE')
    and not has_table_privilege('authenticated','public.dashboard_sync_state','DELETE'),
    'H77 expuso escritura directa del outbox.';
  assert (select array_agg(a.attname::text order by a.attnum)
    from pg_attribute a where a.attrelid='public.dashboard_sync_state'::regclass
      and a.attnum>0 and not a.attisdropped)=array['id','version','changed_at']::text[],
    'El outbox de Dashboard expuso detalle, actor o PII.';
  assert (select count(*) from pg_trigger t
    where not t.tgisinternal and t.tgname like 'trg_h77_dashboard_%')=9,
    'H77 no cubre exactamente sus nueve outboxes canónicos.';
  assert (select count(distinct c.relname) from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname='public' and t.tgname like 'trg_h77_dashboard_%'
      and c.relname=any(array[
        'inventory_sync_events','order_sync_versions','finished_inventory_sync_versions',
        'production_activity_sync_versions','product_catalog_sync_versions','customer_crm_sync_versions',
        'agency_snapshot_events','finance_sync_state','configuration_sync_state'
      ]))=9,
    'H77 escucha una fuente no canónica o dejó una fuente sin cubrir.';
  assert (select p.provolatile from pg_proc p where p.oid='public.momos_dashboard_snapshot_v1()'::regprocedure)='s'
    and position('search_path=pg_catalog,public,pg_temp' in replace(array_to_string(
      (select p.proconfig from pg_proc p where p.oid='public.momos_dashboard_snapshot_v1()'::regprocedure),','),' ',''))>0,
    'La RPC H77 perdió estabilidad o search_path cerrado.';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert exists(select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='dashboard_sync_state'),
      'Realtime no incluye el outbox compacto de Dashboard.';
  end if;
  assert position('dashboard_operativo_disponible' in pg_get_functiondef(
    'public.momos_sync_manifest_v1()'::regprocedure))>0
    and position('''dashboard''' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure))>0,
    'El manifiesto de Data Sync no anuncia H77.';

  select u.auth_id into v_staff_auth from public.users u
  where u.activo and u.auth_id is not null
  order by u.id limit 1;
  assert v_staff_auth is not null,'Falta un usuario activo enlazado a Auth para H77.';
  perform set_config('momos.h77_staff_auth',v_staff_auth::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h77_staff_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_snapshot jsonb; v_privacy jsonb; v_tasks jsonb; v_before bigint;
  v_failed boolean:=false;
begin
  assert public.dashboard_operativo_disponible(),
    'La capability H77 no quedó disponible para staff activo.';
  v_snapshot:=public.momos_dashboard_snapshot_v1();
  v_privacy:=v_snapshot->'privacy';
  v_tasks:=v_snapshot#>'{assistantCenter,tasks}';

  assert (select array_agg(k order by k) from jsonb_object_keys(v_snapshot) keys(k))=
    array['assistantCenter','brandAssistant','businessDate','contract','customerSummary','inventoryAlerts',
      'notices','ordersByState','privacy','productAvailability','salesByChannel','serverTime',
      'snapshotVersion','summary','version'],
    'H77 expuso una colección fuera del contrato compacto.';
  assert v_snapshot->>'contract'='momos.dashboard-snapshot.v1'
    and (v_snapshot->>'version')::integer=1
    and (v_snapshot->>'snapshotVersion')::bigint>0
    and v_snapshot->>'businessDate'~'^\d{4}-\d{2}-\d{2}$',
    'H77 no selló contrato, versión o fecha operativa.';
  assert v_privacy=jsonb_build_object(
      'containsCustomerPii',false,'containsStaffPii',false,'containsFreeText',false,
      'containsStorageReferences',false,'containsSecrets',false,'externalExecution',false),
    'H77 no cerró su contrato de privacidad y no ejecución.';
  assert jsonb_array_length(v_tasks)<=24
    and jsonb_array_length(v_snapshot#>'{notices,productionSuggestions}')<=12
    and jsonb_array_length(v_snapshot#>'{notices,freezingReady}')<=12
    and jsonb_array_length(v_snapshot#>'{notices,publicationsToday}')<=12
    and jsonb_array_length(v_snapshot#>'{notices,creativeReviews}')<=12
    and jsonb_array_length(v_snapshot#>'{notices,campaignsWithoutOrders}')<=12
    and jsonb_array_length(v_snapshot#>'{inventoryAlerts,lowStock}')<=20
    and jsonb_array_length(v_snapshot#>'{inventoryAlerts,expiringSoon}')<=20
    and jsonb_array_length(v_snapshot->'productAvailability')<=50,
    'H77 devolvió una colección sin límite operativo.';
  assert not (v_snapshot ?| array['orders','customers','products','inventory','campaigns','creatives','users','evidences']),
    'H77 expuso una colección operativa pesada.';
  assert (v_snapshot-'privacy')::text !~* 'customer[_-]?id|auth[_-]?id|telefono|direccion|storage[_-]?path|signed[_-]?url|access[_-]?token|refresh[_-]?token|service[_-]?role|notas|\"obs\"',
    'H77 expuso PII, ruta, secreto o nota libre.';
  assert not exists(
    select 1 from jsonb_array_elements(v_tasks) t
    where (select array_agg(k order by k) from jsonb_object_keys(t) keys(k))<>
      array['area','blocks','confidence','confirmationRequired','detail','entityId','entityType','id',
        'module','nextAction','ownerRoles','reasons','severity','title']
  ),'Una tarea H77 salió del contrato cerrado.';

  select version into v_before from public.dashboard_sync_state where id=1;
  begin update public.dashboard_sync_state set version=version+1 where id=1;
  exception when sqlstate '42501' then v_failed:=true; end;
  assert v_failed and (select version from public.dashboard_sync_state where id=1)=v_before,
    'Staff pudo alterar directamente la versión del Dashboard.';
end $$;

reset role;

do $$
declare v_before bigint; v_after bigint;
begin
  select version into v_before from public.dashboard_sync_state where id=1;
  update public.configuration_sync_state set version=version+1 where id=1;
  select version into v_after from public.dashboard_sync_state where id=1;
  assert v_after=v_before+1,
    'Un cambio canónico no produjo exactamente una invalidación del Dashboard.';
end $$;

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_dashboard_snapshot_v1();
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo consultar el Dashboard interno.';
end $$;
reset role;

select 'TESTS_OK — Dashboard compacto/versionado/Realtime/PII/RBAC PASS, rollback total' as resultado;
rollback;
