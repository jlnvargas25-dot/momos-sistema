-- MOMOS OPS · H68 precisión canónica de inventario por lotes v1.
--
-- Algunos callers legado redondean inventory_items.stock a dos o tres
-- decimales, mientras inventory_lots conserva la cantidad exacta. Los lotes
-- son la fuente trazable: después de cada movimiento, entrada o descarte, el
-- agregado se deriva nuevamente de ellos. La instalación solo corrige desfases
-- que coinciden exactamente con ese redondeo legado; cualquier diferencia
-- material aborta y exige una conciliación humana.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260719'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_67_agency_operational_facts'
  ) then
    raise exception 'Falta el paso 67_agency_operational_facts.';
  end if;
  if to_regclass('public.inventory_items') is null
     or to_regclass('public.inventory_lots') is null
     or to_regclass('public.inventory_lot_allocations') is null
     or to_regclass('public.v_inventory_lot_reconciliation') is null then
    raise exception 'Falta el inventario canónico por lotes.';
  end if;
  if to_regprocedure('public._sync_inventory_item_expiry(text)') is null
     or to_regprocedure('public._create_inventory_lot(text,numeric,text,text,date,text,text,numeric)') is null
     or to_regprocedure('public._consume_inventory_lots(text,text,numeric,text)') is null
     or to_regprocedure('public._restore_inventory_lots(text,text,text,numeric)') is null
     or to_regprocedure('public.next_id(text,text,integer)') is null
     or to_regprocedure('public._add_audit(text,text,text,text,text)') is null
     or to_regprocedure('public.current_user_has_any_role(text[])') is null then
    raise exception 'Faltan helpers privados de inventario por lotes.';
  end if;
end $$;

-- La reparación inicial debe observar un único corte. EXCLUSIVE también
-- bloquea SELECT FOR UPDATE: ninguna RPC antigua puede tomar una fila, quedar
-- esperando su UPDATE y cruzarse con la instalación. Las lecturas simples
-- siguen disponibles. Si Cocina está escribiendo, H68 espera hasta cinco
-- segundos y aborta sin cambios para que el operador reintente.
lock table public.inventory_items,public.inventory_lots in exclusive mode;

create index if not exists inventory_lot_allocations_lot_idx
  on public.inventory_lot_allocations(lot_id);

-- PostgreSQL NUMERIC admite NaN e infinitos. Las comparaciones históricas
-- (`>= 0`, `<= initial`) no los excluyen de forma uniforme, por lo que una
-- guarda BEFORE cerrada protege cantidades, costos y mínimos en todas las
-- superficies canónicas del ledger.
create or replace function public._guard_inventory_finite_values()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_row jsonb:=to_jsonb(new);
  v_key text;
  v_keys text[];
begin
  v_keys:=case tg_table_name
    when 'inventory_items' then array['stock','minimo','costo','costo_estimado']
    when 'inventory_lots' then array['initial_quantity','available_quantity','unit_cost']
    when 'inventory_lot_allocations' then array['quantity']
    when 'inventory_movements' then array['cant']
    else array[]::text[]
  end;
  foreach v_key in array v_keys loop
    if v_row->>v_key in ('NaN','Infinity','-Infinity') then
      raise exception 'El campo %.% debe ser un número finito.',tg_table_name,v_key;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists inventory_items_finite_guard on public.inventory_items;
create trigger inventory_items_finite_guard
before insert or update on public.inventory_items
for each row execute function public._guard_inventory_finite_values();
drop trigger if exists inventory_lots_finite_guard on public.inventory_lots;
create trigger inventory_lots_finite_guard
before insert or update on public.inventory_lots
for each row execute function public._guard_inventory_finite_values();
drop trigger if exists inventory_lot_allocations_finite_guard
  on public.inventory_lot_allocations;
create trigger inventory_lot_allocations_finite_guard
before insert or update on public.inventory_lot_allocations
for each row execute function public._guard_inventory_finite_values();
drop trigger if exists inventory_movements_finite_guard
  on public.inventory_movements;
create trigger inventory_movements_finite_guard
before insert or update on public.inventory_movements
for each row execute function public._guard_inventory_finite_values();

create or replace function public._sync_inventory_stock_from_lots(p_item_id text)
returns numeric
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_stock numeric;
begin
  -- Mantiene un único orden de locks: primero el agregado y luego los lotes.
  perform 1 from public.inventory_items where id=p_item_id for update;
  if not found then
    raise exception 'El insumo % no existe.',p_item_id;
  end if;

  -- No redondear aquí: NUMERIC conserva exactamente recetas fraccionales y
  -- evita que una cantidad con más de cuatro decimales cree una nueva deriva.
  select coalesce(sum(l.available_quantity),0)
  into v_stock
  from public.inventory_lots l
  where l.item_id=p_item_id and l.available_quantity>0;

  update public.inventory_items
  set stock=v_stock
  where id=p_item_id and stock is distinct from v_stock;
  return v_stock;
end;
$$;

-- Guarda diferida de transición y de futuros writers internos. No intenta
-- reparar desde un trigger de lote: hacerlo tomaría el lock lote -> item y se
-- cruzaría con el orden canónico item -> lote. En cambio, al cerrar la
-- transacción exige igualdad exacta. Una invocación H12 que hubiese quedado en
-- cola durante el despliegue falla cerrada si intenta persistir un redondeo.
create or replace function public._assert_inventory_lot_reconciliation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_item_id text;
  v_item_ids text[];
  v_official numeric;
  v_lots numeric;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;

  if tg_table_name='inventory_items' then
    v_item_ids:=case
      when tg_op='INSERT' then array[v_new->>'id']
      when tg_op='DELETE' then array[v_old->>'id']
      else array[v_old->>'id',v_new->>'id']
    end;
  elsif tg_table_name='inventory_lots' then
    v_item_ids:=case
      when tg_op='INSERT' then array[v_new->>'item_id']
      when tg_op='DELETE' then array[v_old->>'item_id']
      else array[v_old->>'item_id',v_new->>'item_id']
    end;
  elsif tg_table_name='inventory_lot_allocations' then
    v_item_ids:=case
      when tg_op='INSERT' then array[
        (select item_id from public.inventory_lots where id=v_new->>'lot_id')
      ]
      when tg_op='DELETE' then array[
        (select item_id from public.inventory_lots where id=v_old->>'lot_id')
      ]
      else array[
        (select item_id from public.inventory_lots where id=v_old->>'lot_id'),
        (select item_id from public.inventory_lots where id=v_new->>'lot_id')
      ]
    end;
  else
    v_item_ids:=case
      when tg_op='INSERT' then array[v_new->>'item_id']
      when tg_op='DELETE' then array[v_old->>'item_id']
      else array[v_old->>'item_id',v_new->>'item_id']
    end;
  end if;

  for v_item_id in
    select distinct x.item_id
    from unnest(v_item_ids) as x(item_id)
    where x.item_id is not null
    order by x.item_id
  loop
    select i.stock,coalesce(sum(l.available_quantity),0)
    into v_official,v_lots
    from public.inventory_items i
    left join public.inventory_lots l
      on l.item_id=i.id and l.available_quantity>0
    where i.id=v_item_id
    group by i.stock;

    -- Una eliminación futura del propio insumo queda en manos de sus FK. Si
    -- el item sigue existiendo, ninguna diferencia ni valor especial cruza el
    -- COMMIT.
    if found and (
      v_official::text in ('NaN','Infinity','-Infinity')
      or v_lots::text in ('NaN','Infinity','-Infinity')
      or v_official is distinct from v_lots
    ) then
      raise exception
        'El stock agregado de % no coincide exactamente con sus lotes (% vs %).',
        v_item_id,v_official,v_lots;
    end if;

    if exists(
      select 1
      from public.inventory_lots l
      left join lateral (
        select coalesce(sum(a.quantity),0) as net_quantity
        from public.inventory_lot_allocations a
        where a.lot_id=l.id
          and a.movement_id is distinct from l.source_movement_id
      ) a on true
      where l.item_id=v_item_id
        and (
          l.initial_quantity::text in ('NaN','Infinity','-Infinity')
          or l.available_quantity::text in ('NaN','Infinity','-Infinity')
          or a.net_quantity::text in ('NaN','Infinity','-Infinity')
          or l.available_quantity is distinct from l.initial_quantity+a.net_quantity
          or (
            l.source_movement_id is not null
            and not exists(
              select 1
              from public.inventory_lot_allocations src
              where src.lot_id=l.id
                and src.movement_id=l.source_movement_id
              group by src.lot_id,src.movement_id
              having count(*)=1 and sum(src.quantity)=l.initial_quantity
            )
          )
        )
    ) then
      raise exception
        'El saldo de un lote de % no coincide con su ledger de asignaciones.',
        v_item_id;
    end if;

    if exists(
      select 1
      from public.inventory_lot_allocations a
      join public.inventory_lots l on l.id=a.lot_id
      join public.inventory_movements m on m.id=a.movement_id
      where l.item_id=v_item_id and m.item_id is distinct from l.item_id
    ) or exists(
      select 1
      from public.inventory_movements m
      join public.inventory_lot_allocations a on a.movement_id=m.id
      where m.item_id=v_item_id
      group by m.id,m.cant
      having sum(a.quantity) is distinct from m.cant
    ) then
      raise exception
        'Las asignaciones de % no coinciden con su movimiento e insumo.',
        v_item_id;
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists inventory_lots_stock_sync on public.inventory_lots;
drop trigger if exists inventory_lots_stock_guard on public.inventory_lots;
drop function if exists public._sync_inventory_stock_after_lot_change();
create constraint trigger inventory_lots_stock_guard
after insert or delete or update
on public.inventory_lots
deferrable initially deferred
for each row execute function public._assert_inventory_lot_reconciliation();

drop trigger if exists inventory_items_stock_guard on public.inventory_items;
create constraint trigger inventory_items_stock_guard
after insert or delete or update
on public.inventory_items
deferrable initially deferred
for each row execute function public._assert_inventory_lot_reconciliation();

drop trigger if exists inventory_lot_allocations_stock_guard
  on public.inventory_lot_allocations;
create constraint trigger inventory_lot_allocations_stock_guard
after insert or delete or update
on public.inventory_lot_allocations
deferrable initially deferred
for each row execute function public._assert_inventory_lot_reconciliation();

drop trigger if exists inventory_movements_stock_guard
  on public.inventory_movements;
create constraint trigger inventory_movements_stock_guard
after insert or delete or update
on public.inventory_movements
deferrable initially deferred
for each row execute function public._assert_inventory_lot_reconciliation();

-- Todas las salidas, devoluciones y ajustes existentes terminan en este helper.
-- La lógica FIFO H12 se conserva; H68 únicamente vuelve a derivar el espejo
-- agregado después de que el lote exacto quedó actualizado.
create or replace function public._add_movement(
  p_tipo text,p_item_id text,p_cant numeric,p_nota text default '',
  p_order_id text default null,p_batch_id text default null
) returns void
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_id text;
  v_lot_id text;
  v_remaining numeric;
  v_origin text;
begin
  if p_cant is null or p_cant=0
     or p_cant::text in ('NaN','Infinity','-Infinity') then
    raise exception 'La cantidad del movimiento debe ser finita y distinta de cero.';
  end if;
  perform 1 from public.inventory_items where id=p_item_id for update;
  if not found then
    raise exception 'El insumo % no existe.',p_item_id;
  end if;

  v_id:=public.next_id('movement','M',2);
  insert into public.inventory_movements(id,tipo,item_id,cant,nota,order_id,batch_id)
  values(v_id,p_tipo,p_item_id,p_cant,p_nota,p_order_id,p_batch_id);

  if p_cant<0 then
    perform public._consume_inventory_lots(v_id,p_item_id,-p_cant,p_tipo);
  elsif p_cant>0 then
    v_remaining:=public._restore_inventory_lots(v_id,p_order_id,p_item_id,p_cant);
    if v_remaining>0 then
      v_origin:=case
        when p_order_id is not null then 'Devolución'
        when p_tipo='Ajuste' then 'Ajuste'
        else 'Producción'
      end;
      v_lot_id:=public._create_inventory_lot(
        p_item_id,v_remaining,v_origin,v_id,null,null,null,null
      );
      insert into public.inventory_lot_allocations(movement_id,lot_id,quantity)
      values(v_id,v_lot_id,v_remaining);
    end if;
  end if;

  perform public._sync_inventory_item_expiry(p_item_id);
  perform public._sync_inventory_stock_from_lots(p_item_id);
end;
$$;

-- Las compras por lote no pasan por _add_movement. H68 las alinea con la
-- misma autoridad matemática y mantiene el orden de locks item -> lote.
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
set search_path=pg_catalog,public,pg_temp
as $$
declare
  it public.inventory_items%rowtype;
  v_cost numeric;
  v_projected_stock numeric;
  v_final_stock numeric;
  v_wac numeric;
  v_movement text;
  v_lot text;
  v_note text;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if p_cant is null or p_cant<=0
     or p_cant::text in ('NaN','Infinity','-Infinity') then
    raise exception 'La cantidad debe ser finita y mayor a cero.';
  end if;
  if p_costo_total is null or p_costo_total<0
     or p_costo_total::text in ('NaN','Infinity','-Infinity') then
    raise exception 'El costo total debe ser finito y no puede ser negativo.';
  end if;
  if p_vence is not null and p_vence<current_date then
    raise exception 'Una compra nueva no puede ingresar vencida (%).',p_vence;
  end if;

  select * into it
  from public.inventory_items
  where id=p_item_id
  for update;
  if it.id is null then raise exception 'El insumo % no existe.',p_item_id; end if;

  v_cost:=case when p_costo_total>0 then p_costo_total/p_cant else it.costo end;
  v_projected_stock:=it.stock+p_cant;
  v_wac:=case when p_costo_total>0 and v_projected_stock>0
    then (it.stock*it.costo+p_costo_total)/v_projected_stock else it.costo end;

  update public.inventory_items set
    costo=round(v_wac,4),
    compra=(now() at time zone 'America/Bogota')::date,
    proveedor=case when btrim(coalesce(p_proveedor,''))<>'' then btrim(p_proveedor) else proveedor end,
    ubicacion=case when btrim(coalesce(p_ubicacion,''))<>'' then btrim(p_ubicacion) else ubicacion end
  where id=p_item_id;

  v_movement:=public.next_id('movement','M',2);
  v_note:=case when p_costo_total>0
    then 'Compra '||p_costo_total||' total ('||round(v_cost,4)||'/'||it.unidad||')'
    else 'Entrada sin costo' end;
  if btrim(coalesce(p_nota,''))<>'' then v_note:=v_note||' · '||btrim(p_nota); end if;
  insert into public.inventory_movements(id,tipo,item_id,cant,nota)
  values(v_movement,'Entrada',p_item_id,p_cant,v_note);

  v_lot:=public._create_inventory_lot(
    p_item_id,p_cant,'Compra',v_movement,p_vence,
    nullif(btrim(coalesce(p_proveedor,'')),''),
    nullif(btrim(coalesce(p_ubicacion,'')),''),v_cost
  );
  insert into public.inventory_lot_allocations(movement_id,lot_id,quantity)
  values(v_movement,v_lot,p_cant);

  perform public._sync_inventory_item_expiry(p_item_id);
  v_final_stock:=public._sync_inventory_stock_from_lots(p_item_id);
  perform public._add_audit(
    'Inventario',p_item_id,'Entrada por lote','',v_lot||' · +'||p_cant||' '||it.unidad
  );
  return jsonb_build_object(
    'stock',v_final_stock,'costo',round(v_wac,4),'lot_id',v_lot
  );
end;
$$;

-- El descarte H12 bloqueaba lote -> item y podía cruzarse con FIFO, que usa
-- item -> lote. Primero se identifica el item sin bloquear, luego se bloquea
-- el item y finalmente se relee/bloquea el lote antes de mutarlo.
create or replace function public.desechar_lote_insumo(
  p_lot_id text,
  p_motivo text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  l public.inventory_lots%rowtype;
  it public.inventory_items%rowtype;
  v_item_id text;
  v_movement text;
  v_quantity numeric;
  v_final_stock numeric;
begin
  if public.current_user_has_any_role(array['Administrador','Cocina']) is not true then
    raise exception 'Solo Administrador o Cocina pueden desechar un lote vencido.';
  end if;
  if btrim(coalesce(p_motivo,''))='' then raise exception 'El motivo es obligatorio.'; end if;

  select item_id into v_item_id from public.inventory_lots where id=p_lot_id;
  if v_item_id is null then raise exception 'El lote % no existe.',p_lot_id; end if;

  select * into it
  from public.inventory_items
  where id=v_item_id
  for update;
  if it.id is null then raise exception 'El insumo % no existe.',v_item_id; end if;

  select * into l
  from public.inventory_lots
  where id=p_lot_id and item_id=v_item_id
  for update;
  if l.id is null then raise exception 'El lote % cambió durante el descarte.',p_lot_id; end if;
  if l.expires_at is null or l.expires_at>=current_date then
    raise exception 'El lote % no está vencido y no puede desecharse por este flujo.',p_lot_id;
  end if;
  if l.available_quantity<=0 then raise exception 'El lote % ya no tiene saldo.',p_lot_id; end if;

  v_quantity:=l.available_quantity;
  update public.inventory_lots set available_quantity=0 where id=l.id;
  v_movement:=public.next_id('movement','M',2);
  insert into public.inventory_movements(id,tipo,item_id,cant,nota)
  values(
    v_movement,'Merma',l.item_id,-v_quantity,
    'Desecho lote vencido '||l.id||' ('||l.expires_at||') · '||btrim(p_motivo)
  );
  insert into public.inventory_lot_allocations(movement_id,lot_id,quantity)
  values(v_movement,l.id,-v_quantity);

  perform public._sync_inventory_item_expiry(l.item_id);
  v_final_stock:=public._sync_inventory_stock_from_lots(l.item_id);
  perform public._add_audit(
    'Inventario',l.item_id,'Lote vencido desechado',l.id,-v_quantity||' '||it.unidad
  );
  return jsonb_build_object(
    'ok',true,'lot_id',l.id,'item_id',l.item_id,
    'desechado',v_quantity,'stock',v_final_stock
  );
end;
$$;

revoke all on function public._sync_inventory_stock_from_lots(text)
  from public,anon,authenticated,service_role;
revoke all on function public._guard_inventory_finite_values()
  from public,anon,authenticated,service_role;
revoke all on function public._assert_inventory_lot_reconciliation()
  from public,anon,authenticated,service_role;
revoke all on function public._add_movement(text,text,numeric,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.entrada_insumo_lote(text,numeric,numeric,date,text,text,text)
  from public,anon;
revoke all on function public.desechar_lote_insumo(text,text)
  from public,anon;
grant execute on function public.entrada_insumo_lote(text,numeric,numeric,date,text,text,text)
  to authenticated;
grant execute on function public.desechar_lote_insumo(text,text)
  to authenticated;

-- El agregado deja de ser una superficie directa, incluido TRUNCATE/TRIGGER
-- (RLS no protege TRUNCATE). Las RPC SECURITY DEFINER siguen operando y cada
-- una termina conciliando contra lotes.
revoke all on table public.inventory_items
  from public,anon,authenticated,service_role;
grant select on table public.inventory_items to authenticated;
revoke all on table public.inventory_lots
  from public,anon,authenticated,service_role;
revoke all on table public.inventory_lot_allocations
  from public,anon,authenticated,service_role;
revoke all on table public.inventory_movements
  from public,anon,authenticated,service_role;
grant select on table public.inventory_lots to authenticated;
grant select on table public.inventory_lot_allocations to authenticated;
grant select on table public.inventory_movements to authenticated;

revoke all on function public._create_inventory_lot(text,numeric,text,text,date,text,text,numeric)
  from service_role;
revoke all on function public._consume_inventory_lots(text,text,numeric,text)
  from service_role;
revoke all on function public._restore_inventory_lots(text,text,text,numeric)
  from service_role;
revoke all on function public._sync_inventory_item_expiry(text)
  from service_role;

-- La diferencia de reconciliación deja de redondearse. Así una deriva de
-- cualquier magnitud es visible para auditoría y para la prueba ordenada.
create or replace view public.v_inventory_lot_reconciliation
with (security_barrier=true,security_invoker=true) as
select i.id as item_id,i.nombre,i.stock as official_stock,
       coalesce(sum(l.available_quantity),0) as lot_stock,
       i.stock-coalesce(sum(l.available_quantity),0) as difference
from public.inventory_items i
left join public.inventory_lots l on l.item_id=i.id
group by i.id,i.nombre,i.stock;
revoke all on public.v_inventory_lot_reconciliation from public,anon;
grant select on public.v_inventory_lot_reconciliation to authenticated;

create or replace function public._inventory_is_legacy_rounding(
  p_official numeric,p_lot numeric
) returns boolean
language sql
immutable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select p_official is not null and p_lot is not null
    and p_official::text not in ('NaN','Infinity','-Infinity')
    and p_lot::text not in ('NaN','Infinity','-Infinity')
    and (
      p_official=p_lot
      or p_official=round(p_lot,2)
      or p_official=round(p_lot,3)
      or p_official=round(p_lot,4)
    )
$$;
revoke all on function public._inventory_is_legacy_rounding(numeric,numeric)
  from public,anon,authenticated,service_role;

-- Repara únicamente diferencias que son exactamente el resultado de redondear
-- el saldo de lotes a 2, 3 o 4 decimales. Nunca inventa lotes ni corrige
-- silenciosamente un faltante material.
do $$
declare
  r record;
begin
  if exists(
    select 1 from public.inventory_items i
    where i.stock::text in ('NaN','Infinity','-Infinity')
       or i.minimo::text in ('NaN','Infinity','-Infinity')
       or i.costo::text in ('NaN','Infinity','-Infinity')
       or coalesce(to_jsonb(i)->>'costo_estimado','') in ('NaN','Infinity','-Infinity')
  ) or exists(
    select 1 from public.inventory_lots l
    where l.initial_quantity::text in ('NaN','Infinity','-Infinity')
       or l.available_quantity::text in ('NaN','Infinity','-Infinity')
       or l.unit_cost::text in ('NaN','Infinity','-Infinity')
  ) or exists(
    select 1 from public.inventory_lot_allocations a
    where a.quantity::text in ('NaN','Infinity','-Infinity')
  ) or exists(
    select 1 from public.inventory_movements m
    where m.cant::text in ('NaN','Infinity','-Infinity')
  ) then
    raise exception 'El ledger de inventario contiene un valor no finito; H68 requiere conciliación humana.';
  end if;

  if exists(
    select 1
    from public.v_inventory_lot_reconciliation x
    where x.official_stock::text in ('NaN','Infinity','-Infinity')
       or x.lot_stock::text in ('NaN','Infinity','-Infinity')
       or (
         x.official_stock<>x.lot_stock
         and public._inventory_is_legacy_rounding(
           x.official_stock,x.lot_stock
         ) is not true
       )
  ) then
    raise exception 'Hay diferencias materiales entre stock agregado y lotes; H68 no las corregirá automáticamente.';
  end if;

  if exists(
    select 1
    from public.inventory_lots l
    left join lateral (
      select coalesce(sum(a.quantity),0) as net_quantity
      from public.inventory_lot_allocations a
      where a.lot_id=l.id
        and a.movement_id is distinct from l.source_movement_id
    ) a on true
    where l.initial_quantity::text in ('NaN','Infinity','-Infinity')
       or l.available_quantity::text in ('NaN','Infinity','-Infinity')
       or a.net_quantity::text in ('NaN','Infinity','-Infinity')
       or l.available_quantity is distinct from l.initial_quantity+a.net_quantity
       or (
         l.source_movement_id is not null
         and not exists(
           select 1
           from public.inventory_lot_allocations src
           where src.lot_id=l.id
             and src.movement_id=l.source_movement_id
           group by src.lot_id,src.movement_id
           having count(*)=1 and sum(src.quantity)=l.initial_quantity
         )
       )
  ) then
    raise exception 'Hay lotes cuyo saldo no coincide con el ledger de asignaciones; H68 no ocultará la pérdida de trazabilidad.';
  end if;

  if exists(
    select 1
    from public.inventory_lot_allocations a
    join public.inventory_lots l on l.id=a.lot_id
    join public.inventory_movements m on m.id=a.movement_id
    where m.item_id is distinct from l.item_id
  ) or exists(
    select 1
    from public.inventory_movements m
    join public.inventory_lot_allocations a on a.movement_id=m.id
    group by m.id,m.cant
    having sum(a.quantity) is distinct from m.cant
  ) then
    raise exception 'Hay asignaciones que no coinciden con su movimiento o insumo; H68 requiere conciliación humana.';
  end if;

  for r in
    select item_id,official_stock,lot_stock
    from public.v_inventory_lot_reconciliation
    where official_stock<>lot_stock
    order by item_id
  loop
    perform public._sync_inventory_stock_from_lots(r.item_id);
    perform public._add_audit(
      'Inventario',r.item_id,'Reconciliación de precisión por lotes',
      r.official_stock::text,r.lot_stock::text
    );
  end loop;

  if exists(
    select 1 from public.v_inventory_lot_reconciliation
    where official_stock<>lot_stock
  ) then
    raise exception 'H68 no pudo reconciliar exactamente stock agregado y lotes.';
  end if;
end $$;

create or replace function public.inventory_lot_precision_disponible()
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_68_inventario_precision_lotes'
  )
  and to_regprocedure('public._sync_inventory_stock_from_lots(text)') is not null
  and to_regprocedure('public._guard_inventory_finite_values()') is not null
  and to_regprocedure('public._assert_inventory_lot_reconciliation()') is not null
  and to_regclass('public.inventory_lot_allocations_lot_idx') is not null
  and 4=(
    select count(*)
    from pg_trigger t
    where t.tgname in (
      'inventory_items_finite_guard','inventory_lots_finite_guard',
      'inventory_lot_allocations_finite_guard','inventory_movements_finite_guard'
    )
      and not t.tgisinternal and t.tgenabled in ('O','A')
      and t.tgfoid=to_regprocedure('public._guard_inventory_finite_values()')
  )
  and exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_items'::regclass
      and t.tgname='inventory_items_stock_guard'
      and not t.tgisinternal and t.tgenabled in ('O','A')
      and t.tgdeferrable and t.tginitdeferred
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  )
  and exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_lots'::regclass
      and t.tgname='inventory_lots_stock_guard'
      and not t.tgisinternal and t.tgenabled in ('O','A')
      and t.tgdeferrable and t.tginitdeferred
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  )
  and exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_lot_allocations'::regclass
      and t.tgname='inventory_lot_allocations_stock_guard'
      and not t.tgisinternal and t.tgenabled in ('O','A')
      and t.tgdeferrable and t.tginitdeferred
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  )
  and exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_movements'::regclass
      and t.tgname='inventory_movements_stock_guard'
      and not t.tgisinternal and t.tgenabled in ('O','A')
      and t.tgdeferrable and t.tginitdeferred
      and t.tgfoid=to_regprocedure('public._assert_inventory_lot_reconciliation()')
  )
  and position(
    '_sync_inventory_stock_from_lots' in
    pg_get_functiondef(to_regprocedure('public._add_movement(text,text,numeric,text,text,text)'))
  )>0
  and position(
    '_sync_inventory_stock_from_lots' in
    pg_get_functiondef(to_regprocedure('public.entrada_insumo_lote(text,numeric,numeric,date,text,text,text)'))
  )>0
  and position(
    '_sync_inventory_stock_from_lots' in
    pg_get_functiondef(to_regprocedure('public.desechar_lote_insumo(text,text)'))
  )>0
$$;

revoke all on function public.inventory_lot_precision_disponible()
  from public,anon,authenticated,service_role;
grant execute on function public.inventory_lot_precision_disponible()
  to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260719_68_inventario_precision_lotes',
  'Lotes como fuente matemática exacta, ledger diferido y locks item→lote en RPC canónicas'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
