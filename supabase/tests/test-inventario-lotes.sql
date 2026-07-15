-- MOMOS OPS · prueba adversarial de lotes de insumos. Siempre ROLLBACK.
begin;

do $$
declare
  v_item text := 'I-LOT-TEST-' || pg_backend_pid();
  v_failed boolean := false;
begin
  assert exists (select 1 from public.momos_ops_migrations where id = '20260714_12_inventario_lotes'),
    'Falta aplicar la migración 12.';

  insert into public.inventory_items(
    id,nombre,cat,unidad,stock,minimo,costo,proveedor,vence,ubicacion,compra
  ) values (
    v_item,'Insumo lotes adversarial ' || pg_backend_pid(),'Ingredientes','kg',9,0,10,
    'Test',current_date - 1,'Nevera test',current_date
  );
  insert into public.inventory_lots(
    id,item_id,received_at,expires_at,initial_quantity,available_quantity,unit_cost,supplier,location,origin
  ) values
    ('IL-T-X-' || pg_backend_pid(),v_item,current_date-3,current_date-1,4,4,10,'Test','Nevera test','Ajuste'),
    ('IL-T-1-' || pg_backend_pid(),v_item,current_date-2,current_date+1,2,2,10,'Test','Nevera test','Ajuste'),
    ('IL-T-2-' || pg_backend_pid(),v_item,current_date-1,current_date+5,3,3,10,'Test','Nevera test','Ajuste');

  update public.inventory_items set stock = stock - 3 where id = v_item;
  perform public._add_movement('Uso en producción',v_item,-3,'FIFO adversarial',null,null);
  assert (select available_quantity from public.inventory_lots where id='IL-T-1-' || pg_backend_pid()) = 0,
    'FIFO no agotó primero el lote vigente más próximo';
  assert (select available_quantity from public.inventory_lots where id='IL-T-2-' || pg_backend_pid()) = 2,
    'FIFO no tomó el remanente del segundo lote';
  assert (select available_quantity from public.inventory_lots where id='IL-T-X-' || pg_backend_pid()) = 4,
    'producción consumió un lote vencido';

  begin
    update public.inventory_items set stock = stock - 3 where id = v_item;
    perform public._add_movement('Uso en producción',v_item,-3,'Debe fallar',null,null);
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'el consumo debe fallar cuando solo queda stock vencido para completar';

  assert not exists (select 1 from public.v_inventory_lot_reconciliation where item_id=v_item and difference<>0),
    'el ciclo FIFO dejó descuadrado el stock agregado';
end $$;

select 'TESTS_OK — lotes de insumos FIFO PASS, rollback total' as resultado;
rollback;
