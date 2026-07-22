-- MOMOS OPS · prueba adversarial H72. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_producto_terminado_deltas_20260719'));

do $$
declare
  v_product text;
  v_before bigint;
  v_after bigint;
  v_actor_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_72_producto_terminado_deltas'),
    'Falta aplicar H72.';
  assert to_regclass('public.finished_inventory_sync_versions') is not null
    and to_regprocedure('public.momos_finished_inventory_deltas_v1(text[])') is not null
    and to_regprocedure('public.producto_terminado_deltas_disponibles()') is not null,
    'Falta una pieza del contrato H72.';
  assert has_function_privilege('authenticated','public.momos_finished_inventory_deltas_v1(text[])','EXECUTE')
    and not has_function_privilege('anon','public.momos_finished_inventory_deltas_v1(text[])','EXECUTE')
    and not has_function_privilege('service_role','public.momos_finished_inventory_deltas_v1(text[])','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_touch_finished_inventory_sync_v1()','EXECUTE'),
    'H72 abrió la frontera RBAC.';
  assert has_table_privilege('authenticated','public.finished_inventory_sync_versions','SELECT')
    and not has_table_privilege('authenticated','public.finished_inventory_sync_versions','INSERT')
    and not has_table_privilege('authenticated','public.finished_inventory_sync_versions','UPDATE')
    and not has_table_privilege('authenticated','public.finished_inventory_sync_versions','DELETE')
    and not has_table_privilege('anon','public.finished_inventory_sync_versions','SELECT')
    and not has_table_privilege('service_role','public.finished_inventory_sync_versions','SELECT'),
    'El outbox H72 expuso escritura o lectura privilegiada.';
  assert exists(select 1 from pg_policies where schemaname='public'
    and tablename='finished_inventory_sync_versions'
    and policyname='finished_inventory_sync_versions_staff_read'
    and roles @> array['authenticated']::name[]),
    'El outbox H72 perdió RLS de personal.';
  assert (select array_agg(a.attname::text order by a.attnum)
    from pg_attribute a where a.attrelid='public.finished_inventory_sync_versions'::regclass
    and a.attnum>0 and not a.attisdropped)=array['product_id','version','changed_at'],
    'El outbox H72 expuso detalle, actor, notas o PII.';
  assert (select count(*)=5 from pg_trigger t where t.tgname='momos_finished_inventory_sync_touch'
    and not t.tgisinternal and t.tgrelid=any(array[
      'public.products'::regclass,'public.production_batches'::regclass,'public.lote_figuras'::regclass,
      'public.inventory_reservations'::regclass,'public.audit_logs'::regclass
    ])),'H72 no cubre las cinco fuentes visibles del producto terminado.';

  select p.id into v_product from public.products p where p.tipo='momo' order by p.id limit 1;
  assert v_product is not null,'H72 necesita un producto momo real.';
  select version into v_before from public.finished_inventory_sync_versions where product_id=v_product;
  update public.products set descr=coalesce(descr,'')||' [H72 rollback]' where id=v_product;
  select version into v_after from public.finished_inventory_sync_versions where product_id=v_product;
  assert v_after>v_before,'Cambiar el producto no avanzó su versión monotónica.';

  select u.auth_id into v_actor_auth from public.users u
  where u.activo and u.auth_id is not null and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  assert v_actor_auth is not null,'Falta un Administrador autenticado para H72.';
  perform set_config('momos.h72_actor_auth',v_actor_auth::text,true);
  perform set_config('momos.h72_product',v_product,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h72_actor_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_product text:=current_setting('momos.h72_product');
  v_batch jsonb;
  v_delta jsonb;
  v_failed boolean:=false;
begin
  assert public.producto_terminado_deltas_disponibles(),'La capability H72 no quedó cerrada por migración y staff.';
  v_batch:=public.momos_finished_inventory_deltas_v1(array[v_product,v_product]);
  assert (select array_agg(k order by k) from jsonb_object_keys(v_batch) keys(k))=
    array['containsSecrets','contract','deltas','externalExecution','serverTime'],
    'El batch H72 expuso claves fuera del contrato compacto.';
  assert v_batch->>'contract'='momos.finished-inventory-delta-batch.v1'
    and (v_batch->>'containsSecrets')::boolean=false
    and (v_batch->>'externalExecution')::boolean=false
    and jsonb_array_length(v_batch->'deltas')=1,
    'H72 perdió contrato, seguridad o deduplicación.';
  v_delta:=v_batch->'deltas'->0;
  assert (select array_agg(k order by k) from jsonb_object_keys(v_delta) keys(k))=
    array['contract','product','productId','productionBatches','quarantinedVariants','variants','version'],
    'El delta H72 abrió su contrato o perdió una colección cerrada.';
  assert v_delta->>'productId'=v_product and v_delta->'product'->>'id'=v_product
    and (v_delta->>'version')::bigint=(select version from public.finished_inventory_sync_versions where product_id=v_product),
    'Producto, versión y detalle H72 no pertenecen al mismo corte.';
  assert not exists(select 1 from jsonb_array_elements(v_delta->'productionBatches') x where x->>'productId'<>v_product)
    and not exists(select 1 from jsonb_array_elements(v_delta->'variants') x where x->>'productId'<>v_product)
    and not exists(select 1 from jsonb_array_elements(v_delta->'quarantinedVariants') x where x->>'productId'<>v_product),
    'H72 mezcló lotes o variantes de otro producto.';
  begin perform public.momos_finished_inventory_deltas_v1(array['PR-H72-NO-EXISTE']);
  exception when others then v_failed:=true; end;
  assert v_failed,'H72 aceptó silenciosamente un producto inexistente.';
  v_failed:=false;
  begin perform public.momos_finished_inventory_deltas_v1(array_fill(v_product,array[21]));
  exception when others then v_failed:=true; end;
  assert v_failed,'H72 aceptó un batch mayor a 20 productos.';
end $$;

reset role;
select 'TESTS_OK — Inventario terminado delta/lotes/variantes/versión/PII/RBAC PASS, rollback total' as resultado;
rollback;
