-- MOMOS OPS · lotes de insumos y FIFO por vencimiento
-- Paso 12, después de inventario-vencimientos-v1.sql.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (select 1 from public.momos_ops_migrations where id = '20260714_11_inventario_vencimientos') then
    raise exception 'Falta el paso 11_inventario_vencimientos.';
  end if;
  if to_regprocedure('public._add_movement(text,text,numeric,text,text,text)') is null
     or to_regprocedure('public.entrada_insumo(text,numeric,numeric,text)') is null then
    raise exception 'Faltan las RPC base de inventario.';
  end if;
end $$;

create table if not exists public.inventory_lots (
  id text primary key,
  item_id text not null references public.inventory_items(id),
  source_movement_id text unique references public.inventory_movements(id),
  received_at date not null default ((now() at time zone 'America/Bogota')::date),
  expires_at date,
  initial_quantity numeric not null check (initial_quantity > 0),
  available_quantity numeric not null check (available_quantity >= 0 and available_quantity <= initial_quantity),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  supplier text not null default '',
  location text not null default '',
  origin text not null default 'Compra' check (origin in ('Compra','Stock heredado','Producción','Devolución','Ajuste')),
  created_at timestamptz not null default now()
);

create index if not exists inventory_lots_fifo_idx
  on public.inventory_lots(item_id, expires_at, received_at, id)
  where available_quantity > 0;

create table if not exists public.inventory_lot_allocations (
  id bigint generated always as identity primary key,
  movement_id text not null references public.inventory_movements(id),
  lot_id text not null references public.inventory_lots(id),
  quantity numeric not null check (quantity <> 0),
  restores_allocation_id bigint references public.inventory_lot_allocations(id),
  created_at timestamptz not null default now()
);
create index if not exists inventory_lot_allocations_movement_idx
  on public.inventory_lot_allocations(movement_id);
create index if not exists inventory_lot_allocations_restore_idx
  on public.inventory_lot_allocations(restores_allocation_id)
  where restores_allocation_id is not null;

alter table public.inventory_lots enable row level security;
alter table public.inventory_lot_allocations enable row level security;
drop policy if exists inventory_lots_staff_read on public.inventory_lots;
create policy inventory_lots_staff_read on public.inventory_lots
  for select to authenticated using (public.is_staff());
drop policy if exists inventory_lot_allocations_staff_read on public.inventory_lot_allocations;
create policy inventory_lot_allocations_staff_read on public.inventory_lot_allocations
  for select to authenticated using (public.is_staff());

revoke all on table public.inventory_lots from public, anon, authenticated;
revoke all on table public.inventory_lot_allocations from public, anon, authenticated;
grant select on table public.inventory_lots to authenticated;
grant select on table public.inventory_lot_allocations to authenticated;

-- Migra el stock actual como un lote heredado por insumo. No inventa cantidades:
-- la suma inicial de lotes queda exactamente igual a inventory_items.stock.
insert into public.inventory_lots (
  id, item_id, received_at, expires_at, initial_quantity, available_quantity,
  unit_cost, supplier, location, origin
)
select
  'IL-LEG-' || i.id,
  i.id,
  coalesce(i.compra, (now() at time zone 'America/Bogota')::date),
  i.vence,
  i.stock,
  i.stock,
  greatest(coalesce(i.costo, 0), 0),
  coalesce(i.proveedor, ''),
  coalesce(i.ubicacion, ''),
  'Stock heredado'
from public.inventory_items i
where i.stock > 0
  and not exists (select 1 from public.inventory_lots l where l.item_id = i.id)
on conflict (id) do nothing;

create or replace function public._sync_inventory_item_expiry(p_item_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.inventory_items i
  set vence = (
    select min(l.expires_at)
    from public.inventory_lots l
    where l.item_id = p_item_id and l.available_quantity > 0
  )
  where i.id = p_item_id
$$;

create or replace function public._create_inventory_lot(
  p_item_id text,
  p_quantity numeric,
  p_origin text,
  p_movement_id text default null,
  p_expires_at date default null,
  p_supplier text default null,
  p_location text default null,
  p_unit_cost numeric default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.inventory_items%rowtype;
  v_id text;
begin
  if p_quantity is null or p_quantity <= 0 then return null; end if;
  select * into it from public.inventory_items where id = p_item_id;
  if it.id is null then raise exception 'El insumo % no existe.', p_item_id; end if;
  v_id := public.next_id('inventory_lot','IL-',4);
  insert into public.inventory_lots (
    id, item_id, source_movement_id, expires_at, initial_quantity,
    available_quantity, unit_cost, supplier, location, origin
  ) values (
    v_id, p_item_id, p_movement_id, coalesce(p_expires_at, it.vence), p_quantity,
    p_quantity, greatest(coalesce(p_unit_cost, it.costo, 0), 0),
    coalesce(p_supplier, it.proveedor, ''), coalesce(p_location, it.ubicacion, ''), p_origin
  );
  return v_id;
end;
$$;

create or replace function public._consume_inventory_lots(
  p_movement_id text,
  p_item_id text,
  p_quantity numeric,
  p_type text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.inventory_lots%rowtype;
  v_remaining numeric := p_quantity;
  v_take numeric;
  v_eligible numeric;
  v_protected boolean := p_type in ('Salida','Uso en producción');
begin
  if p_quantity <= 0 then return; end if;
  select coalesce(sum(available_quantity), 0) into v_eligible
  from public.inventory_lots
  where item_id = p_item_id
    and available_quantity > 0
    and (not v_protected or expires_at is null or expires_at >= current_date);
  if v_eligible < p_quantity then
    raise exception 'Stock vigente insuficiente para %. Solicitado: %, disponible por lotes: %.', p_item_id, p_quantity, v_eligible;
  end if;

  for l in
    select * from public.inventory_lots
    where item_id = p_item_id
      and available_quantity > 0
      and (not v_protected or expires_at is null or expires_at >= current_date)
    order by expires_at asc nulls last, received_at asc, id asc
    for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, l.available_quantity);
    update public.inventory_lots
    set available_quantity = available_quantity - v_take
    where id = l.id;
    insert into public.inventory_lot_allocations(movement_id, lot_id, quantity)
    values (p_movement_id, l.id, -v_take);
    v_remaining := v_remaining - v_take;
  end loop;
end;
$$;

create or replace function public._restore_inventory_lots(
  p_movement_id text,
  p_order_id text,
  p_item_id text,
  p_quantity numeric
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_remaining numeric := p_quantity;
  v_take numeric;
begin
  if p_quantity <= 0 or p_order_id is null then return p_quantity; end if;
  for a in
    select la.id, la.lot_id,
           greatest(-la.quantity - coalesce(sum(restored.quantity), 0), 0) as restorable
    from public.inventory_lot_allocations la
    join public.inventory_movements m on m.id = la.movement_id
    left join public.inventory_lot_allocations restored on restored.restores_allocation_id = la.id
    where m.order_id = p_order_id and m.item_id = p_item_id and la.quantity < 0
    group by la.id, la.lot_id, la.quantity
    having greatest(-la.quantity - coalesce(sum(restored.quantity), 0), 0) > 0
    order by la.id desc
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, a.restorable);
    update public.inventory_lots
    set available_quantity = least(initial_quantity, available_quantity + v_take)
    where id = a.lot_id;
    insert into public.inventory_lot_allocations(
      movement_id, lot_id, quantity, restores_allocation_id
    ) values (p_movement_id, a.lot_id, v_take, a.id);
    v_remaining := v_remaining - v_take;
  end loop;
  return greatest(v_remaining, 0);
end;
$$;

-- Todas las salidas existentes ya pasan por este helper. Ahora, además del
-- ledger agregado, asigna cada consumo al lote FIFO exacto.
create or replace function public._add_movement(
  p_tipo text, p_item_id text, p_cant numeric, p_nota text default '',
  p_order_id text default null, p_batch_id text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_lot_id text;
  v_remaining numeric;
  v_origin text;
begin
  v_id := public.next_id('movement','M',2);
  insert into public.inventory_movements(id, tipo, item_id, cant, nota, order_id, batch_id)
  values (v_id, p_tipo, p_item_id, p_cant, p_nota, p_order_id, p_batch_id);

  if p_cant < 0 then
    perform public._consume_inventory_lots(v_id, p_item_id, -p_cant, p_tipo);
  elsif p_cant > 0 then
    v_remaining := public._restore_inventory_lots(v_id, p_order_id, p_item_id, p_cant);
    if v_remaining > 0 then
      v_origin := case
        when p_order_id is not null then 'Devolución'
        when p_tipo = 'Ajuste' then 'Ajuste'
        else 'Producción'
      end;
      v_lot_id := public._create_inventory_lot(
        p_item_id, v_remaining, v_origin, v_id, null, null, null, null
      );
      insert into public.inventory_lot_allocations(movement_id, lot_id, quantity)
      values (v_id, v_lot_id, v_remaining);
    end if;
  end if;
  perform public._sync_inventory_item_expiry(p_item_id);
end;
$$;

create or replace function public.entrada_insumo_lote(
  p_item_id text,
  p_cant numeric,
  p_costo_total numeric,
  p_vence date,
  p_proveedor text default '',
  p_ubicacion text default '',
  p_nota text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.inventory_items%rowtype;
  v_cost numeric;
  v_stock numeric;
  v_wac numeric;
  v_movement text;
  v_lot text;
  v_note text;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if p_cant is null or p_cant <= 0 then raise exception 'La cantidad debe ser mayor a cero.'; end if;
  if p_costo_total is null or p_costo_total < 0 then raise exception 'El costo total no puede ser negativo.'; end if;
  if p_vence is not null and p_vence < current_date then
    raise exception 'Una compra nueva no puede ingresar vencida (%).', p_vence;
  end if;

  select * into it from public.inventory_items where id = p_item_id for update;
  if it.id is null then raise exception 'El insumo % no existe.', p_item_id; end if;
  v_cost := case when p_costo_total > 0 then p_costo_total / p_cant else it.costo end;
  v_stock := it.stock + p_cant;
  v_wac := case when p_costo_total > 0 and v_stock > 0
    then (it.stock * it.costo + p_costo_total) / v_stock else it.costo end;

  update public.inventory_items set
    stock = round(v_stock, 4), costo = round(v_wac, 4),
    compra = (now() at time zone 'America/Bogota')::date,
    proveedor = case when btrim(coalesce(p_proveedor,'')) <> '' then btrim(p_proveedor) else proveedor end,
    ubicacion = case when btrim(coalesce(p_ubicacion,'')) <> '' then btrim(p_ubicacion) else ubicacion end
  where id = p_item_id;

  v_movement := public.next_id('movement','M',2);
  v_note := case when p_costo_total > 0
    then 'Compra ' || p_costo_total || ' total (' || round(v_cost,4) || '/' || it.unidad || ')'
    else 'Entrada sin costo' end;
  if btrim(coalesce(p_nota,'')) <> '' then v_note := v_note || ' · ' || btrim(p_nota); end if;
  insert into public.inventory_movements(id,tipo,item_id,cant,nota)
  values (v_movement,'Entrada',p_item_id,p_cant,v_note);
  v_lot := public._create_inventory_lot(
    p_item_id, p_cant, 'Compra', v_movement, p_vence,
    nullif(btrim(coalesce(p_proveedor,'')),''), nullif(btrim(coalesce(p_ubicacion,'')),''), v_cost
  );
  insert into public.inventory_lot_allocations(movement_id,lot_id,quantity)
  values (v_movement,v_lot,p_cant);
  perform public._sync_inventory_item_expiry(p_item_id);
  perform public._add_audit('Inventario',p_item_id,'Entrada por lote','',v_lot || ' · +' || p_cant || ' ' || it.unidad);
  return jsonb_build_object('stock',round(v_stock,4),'costo',round(v_wac,4),'lot_id',v_lot);
end;
$$;

-- Compatibilidad con pantallas/versiones anteriores: una entrada sin datos de
-- lote conserva los metadatos actuales del insumo.
create or replace function public.entrada_insumo(
  p_item_id text, p_cant numeric, p_costo_total numeric, p_nota text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare it public.inventory_items%rowtype;
begin
  select * into it from public.inventory_items where id = p_item_id;
  return public.entrada_insumo_lote(
    p_item_id,p_cant,p_costo_total,it.vence,it.proveedor,it.ubicacion,p_nota
  );
end;
$$;

create or replace function public.desechar_lote_insumo(
  p_lot_id text,
  p_motivo text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.inventory_lots%rowtype;
  it public.inventory_items%rowtype;
  v_movement text;
  v_quantity numeric;
begin
  if public.current_rol() is null or public.current_rol() not in ('Administrador','Cocina') then
    raise exception 'Solo Administrador o Cocina pueden desechar un lote vencido.';
  end if;
  if btrim(coalesce(p_motivo,'')) = '' then raise exception 'El motivo es obligatorio.'; end if;
  select * into l from public.inventory_lots where id = p_lot_id for update;
  if l.id is null then raise exception 'El lote % no existe.', p_lot_id; end if;
  if l.expires_at is null or l.expires_at >= current_date then
    raise exception 'El lote % no está vencido y no puede desecharse por este flujo.', p_lot_id;
  end if;
  if l.available_quantity <= 0 then raise exception 'El lote % ya no tiene saldo.', p_lot_id; end if;
  select * into it from public.inventory_items where id = l.item_id for update;
  v_quantity := l.available_quantity;
  if it.stock < v_quantity then raise exception 'El stock agregado no cuadra con el lote %.', p_lot_id; end if;

  update public.inventory_items set stock = round(stock - v_quantity,4) where id = l.item_id;
  update public.inventory_lots set available_quantity = 0 where id = l.id;
  v_movement := public.next_id('movement','M',2);
  insert into public.inventory_movements(id,tipo,item_id,cant,nota)
  values (v_movement,'Merma',l.item_id,-v_quantity,
    'Desecho lote vencido ' || l.id || ' (' || l.expires_at || ') · ' || btrim(p_motivo));
  insert into public.inventory_lot_allocations(movement_id,lot_id,quantity)
  values (v_movement,l.id,-v_quantity);
  perform public._sync_inventory_item_expiry(l.item_id);
  perform public._add_audit('Inventario',l.item_id,'Lote vencido desechado',l.id,-v_quantity || ' ' || it.unidad);
  return jsonb_build_object('ok',true,'lot_id',l.id,'item_id',l.item_id,'desechado',v_quantity,'stock',it.stock-v_quantity);
end;
$$;

create or replace view public.v_inventory_lots with (security_barrier=true, security_invoker=true) as
select
  l.id, l.item_id, i.nombre as item_name, i.unidad,
  l.received_at, l.expires_at, l.initial_quantity, l.available_quantity,
  l.unit_cost, l.supplier, l.location, l.origin,
  case
    when l.available_quantity <= 0 then 'Agotado'
    when l.expires_at is not null and l.expires_at < current_date then 'Vencido'
    when l.expires_at = current_date then 'Vence hoy'
    else 'Disponible'
  end as status
from public.inventory_lots l
join public.inventory_items i on i.id = l.item_id;

create or replace view public.v_inventory_lot_reconciliation with (security_barrier=true, security_invoker=true) as
select i.id as item_id, i.nombre, i.stock as official_stock,
       coalesce(sum(l.available_quantity),0) as lot_stock,
       round(i.stock - coalesce(sum(l.available_quantity),0),4) as difference
from public.inventory_items i
left join public.inventory_lots l on l.item_id = i.id
group by i.id, i.nombre, i.stock;

revoke all on public.v_inventory_lots from public, anon;
revoke all on public.v_inventory_lot_reconciliation from public, anon;
grant select on public.v_inventory_lots to authenticated;
grant select on public.v_inventory_lot_reconciliation to authenticated;

revoke all on function public._sync_inventory_item_expiry(text) from public,anon,authenticated;
revoke all on function public._create_inventory_lot(text,numeric,text,text,date,text,text,numeric) from public,anon,authenticated;
revoke all on function public._consume_inventory_lots(text,text,numeric,text) from public,anon,authenticated;
revoke all on function public._restore_inventory_lots(text,text,text,numeric) from public,anon,authenticated;
revoke all on function public._add_movement(text,text,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.entrada_insumo_lote(text,numeric,numeric,date,text,text,text) from public,anon;
revoke all on function public.desechar_lote_insumo(text,text) from public,anon;
revoke all on function public.entrada_insumo(text,numeric,numeric,text) from public,anon;
grant execute on function public.entrada_insumo_lote(text,numeric,numeric,date,text,text,text) to authenticated;
grant execute on function public.desechar_lote_insumo(text,text) to authenticated;
grant execute on function public.entrada_insumo(text,numeric,numeric,text) to authenticated;

do $$
begin
  if exists (select 1 from public.v_inventory_lot_reconciliation where difference <> 0) then
    raise exception 'La migración de lotes no reconcilia con inventory_items.stock.';
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values ('20260714_12_inventario_lotes','Compras por lote, FIFO vigente, desecho exacto y reconciliación con stock agregado')
on conflict (id) do update set detalle = excluded.detalle;

commit;
