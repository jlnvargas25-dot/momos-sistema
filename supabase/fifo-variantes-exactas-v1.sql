-- MOMOS OPS — FIFO estricto por producto + figura + sabor (2026-07-14)
-- Forward migration para bases que ya aplicaron variantes-1b-fifo.sql y
-- variantes-2-cola.sql. El stock agregado anterior solo sirve para ítems
-- genéricos; una elección concreta genera faltante si no existe lote exacto.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (select 1 from public.momos_ops_migrations where id = '20260714_05_admin_operacion') then
    raise exception 'Falta el paso 05_admin_operacion.';
  end if;
  if to_regclass('public.lote_figuras') is null
     or to_regclass('public.inventory_reservations') is null
     or to_regprocedure('public._add_reservation(text,text,text,text,text,numeric)') is null then
    raise exception 'Faltan dependencias FIFO. Aplicar variantes-1b-fifo.sql y variantes-2-cola.sql primero.';
  end if;
end $$;

create or replace function _asignar_variante_fifo(
  p_order_id text, p_product_id text, p_figura text, p_sabor text,
  p_cantidad integer, p_nombre_producto text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  rec record;
  v_figura text := nullif(trim(p_figura), '');
  v_sabor text := nullif(trim(p_sabor), '');
  v_restante integer := p_cantidad;
  v_toma integer;
begin
  if p_cantidad is null or p_cantidad <= 0 then return 0; end if;

  for rec in
    select lf.batch_id, lf.figura, (lf.perfectas - lf.consumidas) as disp
    from lote_figuras lf
    join production_batches b on b.id = lf.batch_id
    where b.product_id = p_product_id
      and b.estado = 'Listo'
      and b.stock_contabilizado
      and (v_sabor is null or b.sabor = v_sabor)
      and (v_figura is null or lf.figura = v_figura)
      and (lf.perfectas - lf.consumidas) > 0
    order by coalesce(b.vencimiento, b.vence) asc nulls last,
             b.fecha asc, b.id asc, lf.figura asc
    for update of lf
  loop
    exit when v_restante <= 0;
    v_toma := least(rec.disp, v_restante);
    if v_toma <= 0 then continue; end if;

    update lote_figuras set consumidas = consumidas + v_toma
    where batch_id = rec.batch_id and figura = rec.figura;

    insert into inventory_reservations (
      id, order_id, tipo, product_id, item_id, nombre, cantidad, batch_id, figura
    ) values (
      next_id('reservation','RES-',0), p_order_id, 'producto', p_product_id, null,
      p_nombre_producto || ' · ' || rec.figura || ' (' || rec.batch_id || ')',
      v_toma, rec.batch_id, rec.figura
    );
    v_restante := v_restante - v_toma;
  end loop;
  return v_restante;
end $$;

revoke execute on function _asignar_variante_fifo(text, text, text, text, integer, text) from public, anon, authenticated;

create or replace function _atender_cola_produccion(p_batch_id text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  b production_batches%rowtype;
  s record;
  f record;
  v_sabor_lote text;
  v_sabor_pedido text;
  v_figura_pedida text;
  v_need integer;
  v_toma integer;
  v_asignadas_pedido integer;
  v_total integer := 0;
  v_texto text;
begin
  select * into b from production_batches where id = p_batch_id;
  if b.id is null then return 0; end if;
  v_sabor_lote := nullif(trim(coalesce(b.sabor,'')), '');

  for s in
    select ps.id as sug_id, ps.order_id, ps.cantidad, ps.order_item_id,
           oi.figura as oi_figura, oi.sabor as oi_sabor
    from production_suggestions ps
    join orders o on o.id = ps.order_id
    left join order_items oi on oi.id = ps.order_item_id
    where ps.estado = 'Pendiente'
      and ps.area = 'Producción'
      and ps.product_id = b.product_id
      and ps.order_id is not null
      and o.estado not in ('Cancelado', 'Entregado', 'Reclamo')
    order by o.pagado_en asc nulls last, ps.id asc
    for update of ps
  loop
    v_need := greatest(0, round(s.cantidad))::integer;
    if v_need <= 0 then continue; end if;

    v_sabor_pedido := nullif(trim(coalesce(s.oi_sabor,'')), '');
    if v_sabor_pedido is not null and (v_sabor_lote is null or v_sabor_lote <> v_sabor_pedido) then
      continue;
    end if;
    v_figura_pedida := nullif(trim(coalesce(s.oi_figura,'')), '');
    v_asignadas_pedido := 0;

    for f in
      select lf.figura, (lf.perfectas - lf.consumidas) as disp
      from lote_figuras lf
      where lf.batch_id = p_batch_id
        and (v_figura_pedida is null or lf.figura = v_figura_pedida)
        and (lf.perfectas - lf.consumidas) > 0
      order by lf.figura asc
      for update
    loop
      exit when v_need <= 0;
      v_toma := least(f.disp, v_need);
      if v_toma <= 0 then continue; end if;

      update lote_figuras set consumidas = consumidas + v_toma
      where batch_id = p_batch_id and figura = f.figura;

      insert into inventory_reservations (
        id, order_id, tipo, product_id, item_id, nombre, cantidad, batch_id, figura
      )
      select next_id('reservation','RES-',0), s.order_id, 'producto', b.product_id, null,
             p.nombre || ' · ' || f.figura || ' (' || p_batch_id || ')',
             v_toma, p_batch_id, f.figura
      from products p where p.id = b.product_id;

      update products set stock = coalesce(stock,0) - v_toma where id = b.product_id;
      v_need := v_need - v_toma;
      v_asignadas_pedido := v_asignadas_pedido + v_toma;
      v_total := v_total + v_toma;
    end loop;

    if v_asignadas_pedido > 0 then
      if v_need <= 0 then
        update production_suggestions set estado = 'Atendida' where id = s.sug_id;
        v_texto := v_asignadas_pedido || '× asignada(s) del lote ' || p_batch_id || ' — faltante cubierto';
      else
        update production_suggestions set cantidad = v_need where id = s.sug_id;
        v_texto := v_asignadas_pedido || '× asignada(s) del lote ' || p_batch_id || ' — pendiente ' || v_need;
      end if;
      perform _add_audit('Producción', s.order_id, 'Cola de producción atendida', '', v_texto);
    end if;

    exit when not exists (
      select 1 from lote_figuras where batch_id = p_batch_id and (perfectas - consumidas) > 0
    );
  end loop;
  return v_total;
end $$;

revoke execute on function _atender_cola_produccion(text) from public, anon, authenticated;

create or replace function _reserve_inventory(p_order_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item record;
  comp record;
  addd record;
  v_toma numeric;
  v_necesita numeric;
  v_req numeric;
  v_stock_actual numeric;
  v_tiene_hijas boolean;
  v_faltantes jsonb := '[]'::jsonb;
  v_sugerencias_texto text := '';
  v_compras_texto text := '';
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_remanente integer;
begin
  for item in
    select oi.id, oi.product_id, oi.cant, oi.nombre, oi.figura, oi.sabor
    from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.tipo = 'momo'
  loop
    select stock into v_stock_actual from products where id = item.product_id for update;
    v_toma := least(coalesce(v_stock_actual,0), item.cant);
    update products set stock = coalesce(stock,0) - v_toma where id = item.product_id;
    if v_toma > 0 then
      v_remanente := _asignar_variante_fifo(
        p_order_id, item.product_id, item.figura, item.sabor,
        round(v_toma)::integer, item.nombre
      );
      if v_remanente > 0 then
        if nullif(trim(coalesce(item.figura,'')), '') is not null
           or nullif(trim(coalesce(item.sabor,'')), '') is not null then
          update products set stock = coalesce(stock,0) + v_remanente where id = item.product_id;
          v_toma := v_toma - v_remanente;
        else
          perform _add_reservation(p_order_id, 'producto', item.product_id, null, item.nombre, v_remanente);
        end if;
      end if;
    end if;
    if v_toma < item.cant then
      v_faltantes := v_faltantes || jsonb_build_object(
        'producto', item.nombre, 'cant', item.cant - v_toma, 'area', 'Producción');
      v_sugerencias_texto := v_sugerencias_texto
        || case when v_sugerencias_texto = '' then '' else ', ' end
        || (item.cant - v_toma) || '× ' || item.nombre;
      insert into production_suggestions (id, fecha, product_id, cantidad, motivo, order_id, area, order_item_id)
      values (next_id('suggestion','S-',0), v_hoy, item.product_id,
              item.cant - v_toma, 'Faltante al reservar pedido ' || p_order_id, p_order_id, 'Producción', item.id);
    end if;
  end loop;

  for item in
    select oi.id, oi.product_id, oi.cant, oi.nombre
    from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.tipo = 'combo'
  loop
    select exists(select 1 from order_items where parent_item_id = item.id) into v_tiene_hijas;

    if not v_tiene_hijas then
      select combo_size into v_necesita from products where id = item.product_id;
      v_necesita := v_necesita * item.cant;
      for comp in
        select cc.component_id, pr.nombre as comp_nombre
        from combo_components cc join products pr on pr.id = cc.component_id
        where cc.combo_id = item.product_id
      loop
        exit when v_necesita <= 0;
        select stock into v_stock_actual from products where id = comp.component_id for update;
        v_toma := least(coalesce(v_stock_actual,0), v_necesita);
        update products set stock = coalesce(stock,0) - v_toma where id = comp.component_id;
        if v_toma > 0 then
          v_remanente := _asignar_variante_fifo(
            p_order_id, comp.component_id, null, null,
            round(v_toma)::integer, comp.comp_nombre || ' (para ' || item.nombre || ')'
          );
          if v_remanente > 0 then
            perform _add_reservation(p_order_id, 'producto', comp.component_id, null,
              comp.comp_nombre || ' (para ' || item.nombre || ')', v_remanente);
          end if;
        end if;
        v_necesita := v_necesita - v_toma;
      end loop;
      if v_necesita > 0 then
        v_faltantes := v_faltantes || jsonb_build_object(
          'producto', 'Momos para ' || item.nombre, 'cant', v_necesita, 'area', 'Producción');
        v_sugerencias_texto := v_sugerencias_texto
          || case when v_sugerencias_texto = '' then '' else ', ' end
          || v_necesita || '× Momos para ' || item.nombre;
        insert into production_suggestions (id, fecha, product_id, cantidad, motivo, order_id, area)
        values (next_id('suggestion','S-',0), v_hoy, item.product_id, v_necesita,
                'Faltante al reservar pedido ' || p_order_id || ' (Momos para ' || item.nombre || ')',
                p_order_id, 'Producción');
      end if;
    end if;

    declare
      v_empaque_id text;
      v_empaque_nombre text;
      v_empaque_stock numeric;
    begin
      select empaque_item_id into v_empaque_id from products where id = item.product_id;
      select nombre, stock into v_empaque_nombre, v_empaque_stock from inventory_items where id = v_empaque_id for update;
      v_toma := least(coalesce(v_empaque_stock,0), item.cant);
      update inventory_items set stock = round(stock - v_toma, 2) where id = v_empaque_id;
      if v_toma > 0 then
        perform _add_reservation(p_order_id, 'empaque', null, v_empaque_id, v_empaque_nombre, v_toma);
        perform _add_movement('Salida', v_empaque_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
      end if;
      if v_toma < item.cant then
        v_faltantes := v_faltantes || jsonb_build_object(
          'item_id', v_empaque_id, 'producto', v_empaque_nombre, 'cant', item.cant - v_toma, 'area', 'Inventario');
        v_compras_texto := v_compras_texto
          || case when v_compras_texto = '' then '' else ', ' end
          || (item.cant - v_toma) || '× ' || v_empaque_nombre;
        insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
        values (next_id('suggestion','S-',0), v_hoy, item.cant - v_toma,
                'Faltante de empaque al reservar pedido ' || p_order_id, p_order_id, 'Inventario', v_empaque_id);
      end if;
    end;

    for comp in
      select r.item_id, r.cantidad, it.nombre as it_nombre
      from recipes r join inventory_items it on it.id = r.item_id
      where r.product_id = item.product_id
    loop
      v_req := comp.cantidad * item.cant;
      select stock into v_stock_actual from inventory_items where id = comp.item_id for update;
      v_toma := least(coalesce(v_stock_actual,0), v_req);
      update inventory_items set stock = round(stock - v_toma, 3) where id = comp.item_id;
      if v_toma > 0 then
        perform _add_reservation(p_order_id, 'insumo', null, comp.item_id, comp.it_nombre, v_toma);
        perform _add_movement('Salida', comp.item_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
      end if;
      if v_toma < v_req then
        v_faltantes := v_faltantes || jsonb_build_object(
          'item_id', comp.item_id, 'producto', comp.it_nombre, 'cant', v_req - v_toma, 'area', 'Inventario');
        v_compras_texto := v_compras_texto
          || case when v_compras_texto = '' then '' else ', ' end
          || (v_req - v_toma) || '× ' || comp.it_nombre;
        insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
        values (next_id('suggestion','S-',0), v_hoy, v_req - v_toma,
                'Faltante de insumo al reservar pedido ' || p_order_id, p_order_id, 'Inventario', comp.item_id);
      end if;
    end loop;
  end loop;

  for addd in
    select a.id, a.nombre, a.insumo_id, a.insumo_cant, a.cant as ad_cant,
           oi.cant as item_cant, it.nombre as insumo_nombre
    from order_item_adiciones a
    join order_items oi on oi.id = a.order_item_id
    join inventory_items it on it.id = a.insumo_id
    where oi.order_id = p_order_id and a.insumo_id is not null
  loop
    v_req := addd.insumo_cant * addd.ad_cant * addd.item_cant;
    select stock into v_stock_actual from inventory_items where id = addd.insumo_id for update;
    v_toma := least(coalesce(v_stock_actual,0), v_req);
    update inventory_items set stock = round(stock - v_toma, 3) where id = addd.insumo_id;
    if v_toma > 0 then
      perform _add_reservation(p_order_id, 'insumo', null, addd.insumo_id,
        addd.insumo_nombre || ' (adición ' || addd.nombre || ')', v_toma);
      perform _add_movement('Salida', addd.insumo_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
    end if;
    if v_toma < v_req then
      v_faltantes := v_faltantes || jsonb_build_object(
        'item_id', addd.insumo_id, 'producto', addd.insumo_nombre || ' (adición ' || addd.nombre || ')',
        'cant', v_req - v_toma, 'area', 'Inventario');
      v_compras_texto := v_compras_texto
        || case when v_compras_texto = '' then '' else ', ' end
        || (v_req - v_toma) || '× ' || addd.insumo_nombre;
      insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
      values (next_id('suggestion','S-',0), v_hoy, v_req - v_toma,
              'Faltante de insumo (adición ' || addd.nombre || ') al reservar pedido ' || p_order_id,
              p_order_id, 'Inventario', addd.insumo_id);
    end if;
  end loop;

  if v_sugerencias_texto <> '' then
    perform _add_audit('Producción', p_order_id, 'Sugerencia de producción creada', '', v_sugerencias_texto);
  end if;
  if v_compras_texto <> '' then
    perform _add_audit('Inventario', p_order_id, 'Compra sugerida creada', '', v_compras_texto);
  end if;
  return v_faltantes;
end $$;

revoke execute on function _reserve_inventory(text) from public, anon, authenticated;

insert into public.momos_ops_migrations (id, detalle)
values ('20260714_06_fifo_variantes_exactas', 'FIFO por producto, figura y sabor; faltantes exactos a Producción')
on conflict (id) do update set detalle = excluded.detalle;

commit;
