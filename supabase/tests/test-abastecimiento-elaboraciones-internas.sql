-- MOMOS OPS · compra vs elaboración interna. Siempre ROLLBACK.
begin;

do $$
declare
  v_internal text;
  v_external text;
  v_lot text;
  v_blocked boolean := false;
begin
  assert exists (
    select 1 from public.momos_ops_migrations
    where id = '20260715_18_abastecimiento_interno'
  ), 'falta paso 18_abastecimiento_interno';

  assert not exists (
    select 1
    from public.subrecetas sr
    join public.inventory_items i on i.id = sr.item_id
    where i.origen_abastecimiento <> 'Producción interna'
  ), 'una subreceta quedó clasificada como compra';

  select sr.item_id into v_internal
  from public.subrecetas sr
  join public.inventory_items i on i.id = sr.item_id
  order by sr.id limit 1;
  assert v_internal is not null, 'el test necesita una subreceta';

  begin
    perform public._create_inventory_lot(
      v_internal, 0.001, 'Compra', null, current_date + 2,
      'Proveedor incorrecto', 'Nevera test', 1
    );
  exception when others then
    if position('no se compra: se prepara en Cocina' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  assert v_blocked, 'una elaboración interna pudo entrar como compra';

  v_lot := public._create_inventory_lot(
    v_internal, 0.001, 'Producción', null, current_date + 2,
    'Producción propia', 'Nevera test', 1
  );
  assert v_lot is not null and exists (
    select 1 from public.inventory_lots
    where id = v_lot and item_id = v_internal and origin = 'Producción'
  ), 'la preparación interna legítima fue bloqueada';

  select i.id into v_external
  from public.inventory_items i
  where i.origen_abastecimiento = 'Compra'
  order by i.id limit 1;
  assert v_external is not null, 'el test necesita un insumo comprado';
  v_lot := public._create_inventory_lot(
    v_external, 0.001, 'Compra', null, current_date + 2,
    'Proveedor test', 'Bodega test', 1
  );
  assert v_lot is not null, 'un insumo externo legítimo no pudo comprarse';
end $$;

select 'TESTS_OK — elaboraciones internas no comprables/preparación y compras externas PASS, rollback total' as resultado;
rollback;
