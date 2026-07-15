-- MOMOS OPS — Inventario seguro por vencimiento y reconciliación (2026-07-14)
-- Paso 11, después de domicilio-empaque-v1.sql.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (select 1 from public.momos_ops_migrations where id = '20260714_10_domicilio_empaque') then
    raise exception 'Falta el paso 10_domicilio_empaque.';
  end if;
  if to_regclass('public.lote_figuras') is null
     or to_regprocedure('public._asignar_variante_fifo(text,text,text,text,integer,text)') is null
     or to_regprocedure('public._add_movement(text,text,numeric,text,text,text)') is null then
    raise exception 'Faltan dependencias de inventario/FIFO.';
  end if;
end $$;

-- Corrige estados imposibles antes de sellar la integridad. El detalle queda
-- trazado por la propia migración y nunca se convierte una deuda en stock.
update products set stock = 0 where stock < 0;
update inventory_items set stock = 0 where stock < 0;
update inventory_items set minimo = 0 where minimo < 0;
update inventory_items set costo = 0 where costo < 0;

alter table products drop constraint if exists products_stock_no_negativo;
alter table products add constraint products_stock_no_negativo
  check (stock is null or stock >= 0);

alter table inventory_items drop constraint if exists inventory_items_stock_no_negativo;
alter table inventory_items add constraint inventory_items_stock_no_negativo check (stock >= 0);
alter table inventory_items drop constraint if exists inventory_items_minimo_no_negativo;
alter table inventory_items add constraint inventory_items_minimo_no_negativo check (minimo >= 0);
alter table inventory_items drop constraint if exists inventory_items_costo_no_negativo;
alter table inventory_items add constraint inventory_items_costo_no_negativo check (costo >= 0);

-- Solo las variantes vigentes son vendibles. Los lotes sin fecha conservan la
-- compatibilidad histórica; los vencidos quedan disponibles en una vista de
-- cuarentena para que Operaciones pueda retirarlos mediante Merma.
create or replace view v_variantes_disponibles with (security_invoker = on) as
select
  p.id as product_id,
  p.nombre as producto,
  lf.figura,
  b.sabor,
  b.gramaje_g,
  sum(lf.perfectas - lf.consumidas) as disponibles,
  min(coalesce(b.vencimiento, b.vence)) as vencimiento_proximo
from lote_figuras lf
join production_batches b on b.id = lf.batch_id
join products p on p.id = b.product_id
where b.estado = 'Listo'
  and b.stock_contabilizado = true
  and (coalesce(b.vencimiento, b.vence) is null or coalesce(b.vencimiento, b.vence) >= current_date)
group by p.id, p.nombre, lf.figura, b.sabor, b.gramaje_g
having sum(lf.perfectas - lf.consumidas) > 0;

create or replace view v_variantes_cuarentena with (security_invoker = on) as
select
  p.id as product_id,
  p.nombre as producto,
  lf.figura,
  b.sabor,
  b.gramaje_g,
  sum(lf.perfectas - lf.consumidas) as disponibles,
  min(coalesce(b.vencimiento, b.vence)) as vencimiento_proximo
from lote_figuras lf
join production_batches b on b.id = lf.batch_id
join products p on p.id = b.product_id
where b.estado = 'Listo'
  and b.stock_contabilizado = true
  and coalesce(b.vencimiento, b.vence) < current_date
group by p.id, p.nombre, lf.figura, b.sabor, b.gramaje_g
having sum(lf.perfectas - lf.consumidas) > 0;

grant select on v_variantes_disponibles, v_variantes_cuarentena to authenticated;

-- Defensa final del FIFO. Incluso si un cliente ignora las vistas, una reserva
-- exacta jamás toma un lote vencido.
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
      and (coalesce(b.vencimiento, b.vence) is null or coalesce(b.vencimiento, b.vence) >= current_date)
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

revoke execute on function _asignar_variante_fifo(text, text, text, text, integer, text)
  from public, anon, authenticated;

-- La cola automática también es una puerta de asignación. Un lote que ya
-- venció puede cerrarse y quedar en cuarentena, pero nunca cubrir un pedido.
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
  if coalesce(b.vencimiento, b.vence) < current_date then return 0; end if;
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

-- Una orden terminal no puede conservar trabajo pendiente de Producción. La
-- tabla solo admite Pendiente/Atendida, por lo que Atendida significa cerrada.
create or replace function close_terminal_order_suggestions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado in ('Cancelado', 'Entregado') and old.estado is distinct from new.estado then
    update production_suggestions
    set estado = 'Atendida'
    where order_id = new.id and estado = 'Pendiente';
  end if;
  return new;
end $$;

drop trigger if exists orders_close_terminal_suggestions on orders;
create trigger orders_close_terminal_suggestions
after update of estado on orders
for each row execute function close_terminal_order_suggestions();

update production_suggestions ps
set estado = 'Atendida'
from orders o
where o.id = ps.order_id
  and o.estado in ('Cancelado', 'Entregado')
  and ps.estado = 'Pendiente';

revoke execute on function close_terminal_order_suggestions() from public, anon, authenticated;

-- Toda salida operativa pasa por este helper. Si una función ya descontó stock,
-- la excepción revierte la transacción completa. Merma y Ajuste siguen abiertos
-- para retirar o reconciliar físicamente el material vencido.
create or replace function _add_movement(
  p_tipo text, p_item_id text, p_cant numeric, p_nota text default '',
  p_order_id text default null, p_batch_id text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item inventory_items%rowtype;
begin
  if p_cant < 0 and p_tipo in ('Salida', 'Uso en producción') then
    select * into v_item from inventory_items where id = p_item_id;
    if v_item.id is not null and v_item.vence is not null and v_item.vence < current_date then
      raise exception 'El insumo % venció el %. Registrá una Merma; no puede usarse ni reservarse.', v_item.nombre, v_item.vence;
    end if;
  end if;

  insert into inventory_movements (id, tipo, item_id, cant, nota, order_id, batch_id)
  values (next_id('movement','M',2), p_tipo, p_item_id, p_cant, p_nota, p_order_id, p_batch_id);
end $$;

revoke execute on function _add_movement(text, text, numeric, text, text, text)
  from public, anon, authenticated;

insert into public.momos_ops_migrations (id, detalle)
values ('20260714_11_inventario_vencimientos', 'Cuarentena de vencidos, FIFO y cola vigentes, cierre de tareas terminales y stocks no negativos')
on conflict (id) do update set detalle = excluded.detalle;

commit;
