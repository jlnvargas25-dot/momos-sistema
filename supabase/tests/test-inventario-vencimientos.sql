-- MOMOS OPS · vencimientos y stock no negativo. Siempre ROLLBACK.
begin;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260714_11_inventario_vencimientos'), 'falta paso 11';
  assert to_regclass('public.v_variantes_cuarentena') is not null, 'falta vista de cuarentena';
  assert not exists(select 1 from public.v_variantes_disponibles where vencimiento_proximo<current_date), 'venta exacta expone lote vencido';
  assert position('current_date' in pg_get_functiondef('public._asignar_variante_fifo(text,text,text,text,integer,text)'::regprocedure))>0, 'FIFO no filtra vencidos';
  assert position('current_date' in pg_get_functiondef('public._atender_cola_produccion(text)'::regprocedure))>0, 'cola no filtra vencidos';
  assert exists(select 1 from pg_constraint where conname='products_stock_no_negativo' and convalidated), 'stock terminado acepta negativos';
  assert exists(select 1 from pg_constraint where conname='inventory_items_stock_no_negativo' and convalidated), 'stock de insumos acepta negativos';
  assert exists(select 1 from pg_trigger where tgname='orders_close_terminal_suggestions' and not tgisinternal), 'falta cierre de tareas huérfanas';
end $$;

select 'TESTS_OK — inventario y vencimientos adversarial PASS, rollback total' as resultado;
rollback;
