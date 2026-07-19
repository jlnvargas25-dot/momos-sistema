-- MOMOS OPS · prueba adversarial H71. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_pedidos_deltas_20260719'));

do $$
declare
  v_order text;
  v_before bigint;
  v_after bigint;
  v_actor_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_71_pedidos_deltas'),
    'Falta aplicar H71.';
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_70_inventario_delta_consistencia'),
    'H71 perdió su dependencia H70.';
  assert to_regclass('public.order_sync_versions') is not null
    and to_regprocedure('public.momos_order_deltas_v1(text[])') is not null
    and to_regprocedure('public.pedidos_deltas_disponibles()') is not null,
    'Falta una pieza del contrato H71.';
  assert has_function_privilege('authenticated','public.momos_order_deltas_v1(text[])','EXECUTE')
    and not has_function_privilege('anon','public.momos_order_deltas_v1(text[])','EXECUTE')
    and not has_function_privilege('service_role','public.momos_order_deltas_v1(text[])','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_touch_order_sync_v1()','EXECUTE')
    and not has_function_privilege('anon','public._momos_touch_order_sync_v1()','EXECUTE')
    and not has_function_privilege('service_role','public._momos_touch_order_sync_v1()','EXECUTE'),
    'H71 abrió la frontera RBAC.';
  assert has_table_privilege('authenticated','public.order_sync_versions','SELECT')
    and not has_table_privilege('authenticated','public.order_sync_versions','INSERT')
    and not has_table_privilege('authenticated','public.order_sync_versions','UPDATE')
    and not has_table_privilege('authenticated','public.order_sync_versions','DELETE')
    and not has_table_privilege('anon','public.order_sync_versions','SELECT')
    and not has_table_privilege('service_role','public.order_sync_versions','SELECT'),
    'El outbox H71 no quedó legible por Realtime o expuso escritura directa.';
  assert exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='order_sync_versions'
      and policyname='order_sync_versions_staff_read'
      and roles @> array['authenticated']::name[]
  ),'El outbox H71 no protege su lectura Realtime con RLS de personal.';
  assert (
    select array_agg(a.attname::text order by a.attnum)
    from pg_attribute a
    where a.attrelid='public.order_sync_versions'::regclass
      and a.attnum>0 and not a.attisdropped
  )=array['order_id','version','changed_at'],
    'El outbox H71 expuso detalle, actor, ruta, nota o PII.';
  assert (
    select count(*)=16
    from pg_trigger t
    where t.tgname='momos_order_sync_touch' and not t.tgisinternal
      and t.tgrelid=any(array[
        'public.orders'::regclass,'public.order_items'::regclass,'public.order_item_adiciones'::regclass,
        'public.customers'::regclass,'public.deliveries'::regclass,'public.evidences'::regclass,
        'public.benefits'::regclass,'public.claims'::regclass,'public.inventory_reservations'::regclass,
        'public.production_suggestions'::regclass,'public.packing_verifications'::regclass,
        'public.order_stage_assignments'::regclass,'public.order_line_progress'::regclass,
        'public.order_incidents'::regclass,'public.order_dispatch_handoffs'::regclass,
        'public.audit_logs'::regclass
      ])
  ),'H71 no cubre las 16 fuentes del grafo visible de un pedido.';

  select o.id into v_order from public.orders o order by o.fecha desc,o.hora desc,o.id desc limit 1;
  assert v_order is not null,'H71 necesita al menos un pedido real para validar su grafo.';
  select version into v_before from public.order_sync_versions where order_id=v_order;
  update public.orders set obs=coalesce(obs,'')||' [H71 rollback]' where id=v_order;
  select version into v_after from public.order_sync_versions where order_id=v_order;
  assert v_after>v_before,'Cambiar el pedido no avanzó su versión monotónica.';

  select u.auth_id into v_actor_auth
  from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  assert v_actor_auth is not null,'Falta un Administrador autenticado para H71.';
  perform set_config('momos.h71_actor_auth',v_actor_auth::text,true);
  perform set_config('momos.h71_order',v_order,true);
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',current_setting('momos.h71_actor_auth'),'role','authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_order text:=current_setting('momos.h71_order');
  v_batch jsonb;
  v_delta jsonb;
  v_failed boolean:=false;
begin
  assert public.pedidos_deltas_disponibles(),'La capability H71 no quedó cerrada por migración y staff.';
  v_batch:=public.momos_order_deltas_v1(array[v_order,v_order]);
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_batch) keys(k)
  )=array['containsSecrets','contract','deltas','externalExecution','serverTime'],
    'El batch H71 expuso claves fuera del contrato compacto.';
  assert v_batch->>'contract'='momos.order-delta-batch.v1'
    and (v_batch->>'containsSecrets')::boolean=false
    and (v_batch->>'externalExecution')::boolean=false
    and jsonb_array_length(v_batch->'deltas')=1,
    'H71 perdió contrato, seguridad o deduplicación.';
  v_delta:=v_batch->'deltas'->0;
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_delta) keys(k)
  )=array[
    'auditLogs','benefits','claims','contract','customer','deliveries','evidences',
    'inventoryReservations','order','orderDispatchHandoffs','orderId','orderIncidents',
    'orderItems','orderLineProgress','orderStageAssignments','packingVerifications',
    'productionSuggestions','serverTime','version'
  ],'El delta H71 abrió su contrato o perdió una colección cerrada.';
  assert v_delta->>'contract'='momos.order-delta.v1'
    and v_delta->>'orderId'=v_order
    and v_delta->'order'->>'id'=v_order
    and (v_delta->>'version')::bigint=(
      select version from public.order_sync_versions where order_id=v_order
    ),'La orden, versión y grafo H71 no pertenecen al mismo corte.';
  assert not exists(
    select 1 from jsonb_array_elements(v_delta->'orderItems') x
    where x->>'orderId'<>v_order
  ) and not exists(
    select 1 from jsonb_array_elements(v_delta->'evidences') x
    where x->>'orderId'<>v_order
  ) and not exists(
    select 1 from jsonb_array_elements(v_delta->'inventoryReservations') x
    where x->>'orderId'<>v_order
  ),'H71 mezcló líneas, evidencias o reservas de otra orden.';

  begin
    perform public.momos_order_deltas_v1(array['P-H71-NO-EXISTE']);
  exception when others then v_failed:=true;
  end;
  assert v_failed,'H71 aceptó silenciosamente un pedido inexistente.';
  v_failed:=false;
  begin
    perform public.momos_order_deltas_v1(array_fill(v_order,array[51]));
  exception when others then v_failed:=true;
  end;
  assert v_failed,'H71 aceptó un batch mayor a 50 pedidos.';
end $$;

reset role;
select 'TESTS_OK — Pedidos/Empaque delta cerrado/versión/grafo/RBAC/PII PASS, rollback total' as resultado;
rollback;
