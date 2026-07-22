-- MOMOS OPS · prueba adversarial H81. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_domicilios_snapshot_20260719'));

do $$
declare
  v_auth uuid;
  v_order text;
  v_before bigint;
  v_after bigint;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_81_domicilios_snapshot'),'Falta aplicar H81.';
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_80_produccion_preflight_elaboraciones'),'H81 perdió su dependencia H80.';
  assert to_regclass('public.delivery_sync_state') is not null
    and to_regprocedure('public.momos_delivery_snapshot_v1(integer)') is not null
    and to_regprocedure('public.domicilios_snapshot_disponible()') is not null,'Falta una pieza del contrato H81.';
  assert has_function_privilege('authenticated','public.momos_delivery_snapshot_v1(integer)','EXECUTE')
    and not has_function_privilege('anon','public.momos_delivery_snapshot_v1(integer)','EXECUTE')
    and not has_function_privilege('service_role','public.momos_delivery_snapshot_v1(integer)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_touch_delivery_sync_v1()','EXECUTE'),'H81 perdió su frontera de funciones.';
  assert has_table_privilege('authenticated','public.delivery_sync_state','SELECT')
    and not has_table_privilege('authenticated','public.delivery_sync_state','INSERT')
    and not has_table_privilege('authenticated','public.delivery_sync_state','UPDATE')
    and not has_table_privilege('anon','public.delivery_sync_state','SELECT'),'H81 expuso escritura o lectura anónima del outbox.';
  assert (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
    where a.attrelid='public.delivery_sync_state'::regclass and a.attnum>0 and not a.attisdropped)
    =array['id','version','changed_at'],'El outbox de Logística expuso detalle o PII.';
  assert exists(select 1 from pg_policies where schemaname='public' and tablename='delivery_sync_state'
    and policyname='delivery_sync_state_logistics_read' and roles @> array['authenticated']::name[]),'H81 perdió RLS por rol.';

  select o.id into v_order from public.orders o order by o.fecha desc,o.hora desc,o.id desc limit 1;
  assert v_order is not null,'H81 necesita un pedido para probar versionado.';
  select version into v_before from public.delivery_sync_state where id=1;
  update public.orders set obs=coalesce(obs,'')||' [H81 rollback]' where id=v_order;
  select version into v_after from public.delivery_sync_state where id=1;
  assert v_after>v_before,'Cambiar un pedido no avanzó el snapshot de Logística.';

  select u.auth_id into v_auth from public.users u where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol])) order by u.id limit 1;
  assert v_auth is not null,'Falta Administrador autenticado para H81.';
  perform set_config('momos.h81_actor_auth',v_auth::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.h81_actor_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_payload jsonb;
begin
  assert public.domicilios_snapshot_disponible(),'La capability H81 no quedó disponible para Administrador.';
  v_payload:=public.momos_delivery_snapshot_v1(7);
  assert (select array_agg(k order by k) from jsonb_object_keys(v_payload) k)
    =array['contract','customers','deliveries','orderItems','orders','orderVersions','privacy','serverTime','summary','version'],
    'H81 expuso una colección fuera del contrato compacto.';
  assert v_payload->>'contract'='momos.delivery-snapshot.v1'
    and (v_payload->>'version')::bigint>0
    and (v_payload->'summary'->>'historyLimit')::int=7
    and jsonb_array_length(v_payload->'orders')<=207
    and jsonb_array_length(v_payload->'customers')<=207,'H81 perdió contrato o límites.';
  assert (select array_agg(k order by k) from jsonb_object_keys(v_payload->'privacy') k)
    =array['bounded','containsCustomerPii','containsFreeText','containsSecrets','containsStaffPii','containsStorageReferences','destinationPiiRequired','externalExecution'],
    'H81 no declaró exactamente su frontera de privacidad.';
  assert (v_payload->'privacy'->>'containsCustomerPii')::boolean
    and (v_payload->'privacy'->>'destinationPiiRequired')::boolean
    and not(v_payload->'privacy'->>'containsSecrets')::boolean
    and not(v_payload->'privacy'->>'containsStaffPii')::boolean
    and not(v_payload->'privacy'->>'containsStorageReferences')::boolean
    and not(v_payload->'privacy'->>'externalExecution')::boolean,'H81 abrió secretos, actores o ejecución externa.';
  assert not exists(select 1 from jsonb_array_elements(v_payload->'orders') o where o->>'canal'='Rappi'),
    'H81 incluyó pedidos Rappi en la operación de domicilios.';
  assert not exists(
    select 1 from jsonb_array_elements(v_payload->'orderItems') i
    where not exists(select 1 from jsonb_array_elements(v_payload->'orders') o where o->>'id'=i->>'orderId')
  ) and not exists(
    select 1 from jsonb_array_elements(v_payload->'deliveries') d
    where not exists(select 1 from jsonb_array_elements(v_payload->'orders') o where o->>'id'=d->>'orderId')
  ),'H81 mezcló líneas o domicilios de otro pedido.';
  assert position('domicilios_snapshot_disponible' in pg_get_functiondef('public.momos_sync_manifest_v1()'::regprocedure))>0,
    'El manifiesto de Data Sync no anuncia H81.';
end $$;

reset role;
select 'TESTS_OK — Domicilios snapshot compacto/límites/PII/H71/RBAC PASS, rollback total' as resultado;
rollback;
