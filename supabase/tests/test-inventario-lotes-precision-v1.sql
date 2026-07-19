-- MOMOS OPS · prueba adversarial H68 de precisión por lotes. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_inventario_precision_20260719'));

do $$
declare
  v_item text:='I-PREC-'||pg_backend_pid();
  v_movement text;
  v_actor_auth uuid;
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_68_inventario_precision_lotes'
  ),'Falta aplicar H68.';
  assert public.inventory_lot_precision_disponible(),
    'La sonda H68 no confirma el helper canónico.';
  assert not has_function_privilege(
    'authenticated','public._sync_inventory_stock_from_lots(text)','EXECUTE'
  ),'El helper privado H68 quedó expuesto.';
  assert not has_function_privilege(
    'authenticated','public._add_movement(text,text,numeric,text,text,text)','EXECUTE'
  ),'_add_movement dejó de ser privado.';
  assert not has_function_privilege(
    'service_role','public._sync_inventory_stock_from_lots(text)','EXECUTE'
  ),'El helper H68 quedó expuesto a service_role.';
  assert not has_function_privilege(
    'authenticated','public._assert_inventory_lot_reconciliation()','EXECUTE'
  ) and not has_function_privilege(
    'authenticated','public._guard_inventory_finite_values()','EXECUTE'
  ) and not has_function_privilege(
    'authenticated','public._inventory_is_legacy_rounding(numeric,numeric)','EXECUTE'
  ),'Un helper interno H68 quedó expuesto.';
  assert exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_items'::regclass
      and t.tgname='inventory_items_stock_guard'
      and not t.tgisinternal and t.tgenabled in ('O','A')
      and t.tgdeferrable and t.tginitdeferred
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  ) and exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_lots'::regclass
      and t.tgname='inventory_lots_stock_guard'
      and not t.tgisinternal and t.tgenabled in ('O','A')
      and t.tgdeferrable and t.tginitdeferred
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  ) and exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_lot_allocations'::regclass
      and t.tgname='inventory_lot_allocations_stock_guard'
      and not t.tgisinternal and t.tgenabled in ('O','A')
      and t.tgdeferrable and t.tginitdeferred
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  ) and exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_movements'::regclass
      and t.tgname='inventory_movements_stock_guard'
      and not t.tgisinternal and t.tgenabled in ('O','A')
      and t.tgdeferrable and t.tginitdeferred
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  ),'Faltan las guardas diferidas de lote y ledger.';
  assert public._inventory_is_legacy_rounding(9.629,9.6289),
    'El guard no acepta el redondeo legado real a tres decimales.';
  assert public._inventory_is_legacy_rounding(9.63,9.6289),
    'El guard no acepta un redondeo legado a dos decimales.';
  assert public._inventory_is_legacy_rounding(9.6289,9.6289),
    'El guard no acepta saldos ya exactos.';
  assert public._inventory_is_legacy_rounding(9.5,9.6289) is not true,
    'El guard clasificó una diferencia material como redondeo.';
  assert has_function_privilege(
    'authenticated','public.inventory_lot_precision_disponible()','EXECUTE'
  ) and not has_function_privilege(
    'anon','public.inventory_lot_precision_disponible()','EXECUTE'
  ),'La sonda H68 perdió su frontera authenticated.';
  assert not has_table_privilege('authenticated','public.inventory_items','INSERT')
    and not has_table_privilege('authenticated','public.inventory_items','UPDATE')
    and not has_table_privilege('authenticated','public.inventory_items','DELETE')
    and not has_table_privilege('authenticated','public.inventory_items','TRUNCATE')
    and not has_table_privilege('authenticated','public.inventory_items','REFERENCES')
    and not has_table_privilege('authenticated','public.inventory_items','TRIGGER'),
    'El agregado de inventario conserva una superficie directa.';
  assert not has_table_privilege('service_role','public.inventory_items','UPDATE')
    and not has_table_privilege('service_role','public.inventory_lots','UPDATE')
    and not has_table_privilege('service_role','public.inventory_lot_allocations','INSERT')
    and not has_table_privilege('service_role','public.inventory_movements','INSERT'),
    'service_role conserva una superficie directa de inventario.';
  assert not has_table_privilege('authenticated','public.inventory_movements','INSERT')
    and not has_table_privilege('authenticated','public.inventory_movements','UPDATE')
    and not has_table_privilege('authenticated','public.inventory_movements','DELETE'),
    'El ledger de movimientos conserva escritura directa.';

  insert into public.inventory_items(
    id,nombre,cat,unidad,stock,minimo,costo,proveedor,vence,ubicacion,compra
  ) values(
    v_item,'Precisión lotes adversarial '||pg_backend_pid(),
    'Ingredientes','L',10.0789,0,1,'Test',current_date+5,'Nevera test',current_date
  );
  insert into public.inventory_lots(
    id,item_id,received_at,expires_at,initial_quantity,available_quantity,
    unit_cost,supplier,location,origin
  ) values
    ('IL-PREC-X-'||pg_backend_pid(),v_item,current_date-2,current_date-1,4,4,1,'Test','Nevera test','Ajuste'),
    ('IL-PREC-V-'||pg_backend_pid(),v_item,current_date-1,current_date+5,6.0789,6.0789,1,'Test','Nevera test','Ajuste');

  -- Reproduce el caller legado: el agregado pierde el cuarto decimal antes de
  -- que H12 descuente el lote exacto.
  update public.inventory_items
  set stock=round(stock-0.450,3)
  where id=v_item;
  assert (select stock from public.inventory_items where id=v_item)=9.629,
    'El fixture no reprodujo el redondeo legado a tres decimales.';
  perform public._add_movement(
    'Uso en producción',v_item,-0.450,'Precisión adversarial',null,null
  );

  select m.id into v_movement
  from public.inventory_movements m
  where m.item_id=v_item and m.nota='Precisión adversarial'
  order by m.fecha desc,m.id desc
  limit 1;
  assert v_movement is not null,'No se registró el movimiento adversarial.';

  assert (select stock from public.inventory_items where id=v_item)=9.6289,
    'H68 no restauró el cuarto decimal del stock agregado.';
  assert (
    select coalesce(sum(available_quantity),0)
    from public.inventory_lots where item_id=v_item
  )=9.6289,'Los lotes no conservaron el saldo exacto.';
  assert not exists(
    select 1 from public.v_inventory_lot_reconciliation
    where item_id=v_item and difference<>0
  ),'El movimiento fraccional dejó stock y lotes descuadrados.';
  assert (
    select coalesce(sum(quantity),0)
    from public.inventory_lot_allocations where movement_id=v_movement
  )=-0.450,'La asignación FIFO no conserva el consumo exacto.';
  assert exists(
    select 1
    from public.inventory_lot_allocations
    where movement_id=v_movement
      and lot_id='IL-PREC-V-'||pg_backend_pid()
      and quantity=-0.450
  ),'El consumo no quedó ligado al lote vigente exacto.';
  assert (
    select available_quantity from public.inventory_lots
    where id='IL-PREC-V-'||pg_backend_pid()
  )=5.6289,'El lote vigente perdió precisión después del FIFO.';
  assert (
    select available_quantity from public.inventory_lots
    where id='IL-PREC-X-'||pg_backend_pid()
  )=4,'H68 consumió el lote vencido.';

  -- Un writer interno directo no debe quedar "verde" solo por modificar el
  -- lote: sin movimiento y asignación, la guarda diferida falla cerrada. El
  -- subbloque revierte la mutación adversarial completa.
  declare
    v_guarded boolean:=false;
    v_nonfinite_guarded boolean:=false;
    v_item_guarded boolean:=false;
    v_allocation_guarded boolean:=false;
    v_movement_guarded boolean:=false;
  begin
    begin
      update public.inventory_lots
      set available_quantity=available_quantity-0.00001
      where id='IL-PREC-V-'||pg_backend_pid();
      set constraints inventory_lots_stock_guard immediate;
    exception when others then
      v_guarded:=true;
    end;
    assert v_guarded,
      'Una mutación de lote sin ledger cruzó la guarda diferida.';
    begin
      insert into public.inventory_lots(
        id,item_id,initial_quantity,available_quantity,origin
      ) values(
        'IL-PREC-NAN-'||pg_backend_pid(),v_item,
        'NaN'::numeric,'NaN'::numeric,'Ajuste'
      );
      set constraints inventory_lots_stock_guard immediate;
    exception when others then
      v_nonfinite_guarded:=true;
    end;
    assert v_nonfinite_guarded,
      'Un lote no finito cruzó constraints y guarda diferida.';
    begin
      update public.inventory_items
      set stock=stock+0.00001
      where id=v_item;
      set constraints inventory_items_stock_guard immediate;
    exception when others then
      v_item_guarded:=true;
    end;
    assert v_item_guarded,
      'Una mutación aislada del agregado cruzó la guarda diferida.';
    begin
      insert into public.inventory_lot_allocations(
        movement_id,lot_id,quantity
      ) values(
        v_movement,'IL-PREC-V-'||pg_backend_pid(),0.00001
      );
      set constraints inventory_lot_allocations_stock_guard immediate;
    exception when others then
      v_allocation_guarded:=true;
    end;
    assert v_allocation_guarded,
      'Una asignación sin cambio de lote cruzó la guarda diferida.';
    begin
      update public.inventory_movements
      set cant=cant-0.00001
      where id=v_movement;
      set constraints inventory_movements_stock_guard immediate;
    exception when others then
      v_movement_guarded:=true;
    end;
    assert v_movement_guarded,
      'Un movimiento que no cuadra con sus asignaciones cruzó la guarda.';
  end;
  assert (select stock from public.inventory_items where id=v_item)=9.6289,
    'La prueba de la guarda alteró el agregado canónico.';
  assert (
    select available_quantity from public.inventory_lots
    where id='IL-PREC-V-'||pg_backend_pid()
  )=5.6289,'La mutación sin ledger no fue revertida.';
  assert not exists(
    select 1 from public.inventory_lots
    where id='IL-PREC-NAN-'||pg_backend_pid()
  ),'El lote no finito no fue revertido.';
  assert not exists(
    select 1 from public.inventory_lot_allocations
    where movement_id=v_movement and quantity=0.00001
  ),'La asignación huérfana no fue revertida.';
  assert (
    select cant from public.inventory_movements where id=v_movement
  )=-0.450,'El movimiento incongruente no fue revertido.';

  select u.auth_id into v_actor_auth
  from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id
  limit 1;
  assert v_actor_auth is not null,'Falta un Administrador autenticado para probar RPC H68.';
  perform set_config('momos.h68_actor_auth',v_actor_auth::text,true);
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',current_setting('momos.h68_actor_auth'),'role','authenticated'
  )::text,
  true
);
set local role authenticated;

do $$
declare
  v_item text:='I-PREC-'||pg_backend_pid();
  v_expired_lot text:='IL-PREC-X-'||pg_backend_pid();
  v_entry jsonb;
  v_discard jsonb;
  v_blocked boolean:=false;
  v_invalid boolean:=false;
begin
  -- Cantidad con cinco decimales: el agregado debe conservarla exactamente,
  -- no ocultarla mediante un round(...,4).
  v_entry:=public.entrada_insumo_lote(
    v_item,0.00005,0,current_date+10,'Test precisión','Nevera test','Entrada exacta H68'
  );
  assert (v_entry->>'stock')::numeric=9.62895,
    'La compra por lote redondeó una cantidad exacta.';
  assert (
    select official_stock=lot_stock and lot_stock=9.62895
    from public.v_inventory_lot_reconciliation where item_id=v_item
  ),'La compra por lote recreó divergencia entre agregado y lotes.';

  v_discard:=public.desechar_lote_insumo(v_expired_lot,'Prueba H68 rollback');
  assert (v_discard->>'desechado')::numeric=4
    and (v_discard->>'stock')::numeric=5.62895,
    'El descarte no recalculó el saldo exacto.';
  assert (
    select available_quantity from public.inventory_lots where id=v_expired_lot
  )=0,'El lote vencido conserva saldo después del descarte.';
  assert (
    select official_stock=lot_stock and lot_stock=5.62895
    from public.v_inventory_lot_reconciliation where item_id=v_item
  ),'El descarte recreó divergencia entre agregado y lotes.';

  begin
    perform public.entrada_insumo_lote(
      v_item,'NaN'::numeric,0,current_date+10,'Test','Nevera test','Debe fallar'
    );
  exception when others then
    v_invalid:=true;
  end;
  assert v_invalid,'La entrada aceptó una cantidad NaN.';

  v_invalid:=false;
  begin
    perform public.movimiento_insumo(v_item,'Ajuste','Infinity'::numeric,'Debe fallar');
  exception when others then
    v_invalid:=true;
  end;
  assert v_invalid,'El movimiento aceptó una cantidad infinita.';

  v_invalid:=false;
  begin
    perform public.crear_insumo(jsonb_build_object(
      'nombre','Insumo no finito H68 '||pg_backend_pid(),
      'cat','Ingredientes','unidad','kg','stock',0,
      'minimo','NaN','costo_total',0
    ));
  exception when others then
    v_invalid:=true;
  end;
  assert v_invalid,'crear_insumo aceptó un mínimo no finito.';
  assert not exists(
    select 1 from public.inventory_items
    where nombre='Insumo no finito H68 '||pg_backend_pid()
  ),'crear_insumo persistió un insumo no finito.';

  begin
    update public.inventory_items set stock=999 where id=v_item;
  exception when insufficient_privilege then
    v_blocked:=true;
  end;
  assert v_blocked,'Una cuenta autenticada alteró directamente el agregado.';
end $$;

-- Fuerza las tres guardas antes del ROLLBACK: las operaciones canónicas de la
-- prueba deben llegar exactas no solo en la vista, también al cierre real.
set constraints inventory_items_stock_guard,
  inventory_lots_stock_guard,
  inventory_lot_allocations_stock_guard,
  inventory_movements_stock_guard immediate;

select 'TESTS_OK — precisión exacta de inventario/lotes/FIFO/entradas/descartes/RBAC PASS, rollback total' as resultado;
rollback;
