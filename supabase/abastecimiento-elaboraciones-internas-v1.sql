-- MOMOS OPS · abastecimiento correcto de elaboraciones internas.
-- Paso 18, después de vencimiento de producto terminado.
-- Mousses, cheesecake, ganache y salsas se preparan con producir_subreceta;
-- nunca ingresan mediante una compra de inventario.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260715'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (
       select 1 from public.momos_ops_migrations
       where id = '20260715_17_vencimiento_terminado'
     ) then
    raise exception 'Falta el paso 17_vencimiento_terminado.';
  end if;
  if to_regclass('public.subrecetas') is null
     or to_regclass('public.inventory_items') is null
     or to_regclass('public.inventory_lots') is null then
    raise exception 'Faltan subrecetas o inventario por lotes.';
  end if;
  if to_regprocedure('public.producir_subreceta(jsonb)') is null then
    raise exception 'Falta producir_subreceta(jsonb).';
  end if;
end $$;

alter table public.inventory_items
  add column if not exists origen_abastecimiento text not null default 'Compra';
alter table public.inventory_items
  drop constraint if exists inventory_items_origen_abastecimiento_check;
alter table public.inventory_items
  add constraint inventory_items_origen_abastecimiento_check
  check (origen_abastecimiento in ('Compra','Producción interna'));

comment on column public.inventory_items.origen_abastecimiento is
  'Compra = entra desde proveedor; Producción interna = solo entra mediante su subreceta de Cocina.';

-- La relación subrecetas.item_id es la fuente de verdad. No se clasifica por
-- nombre para evitar convertir por accidente una salsa o relleno comprado.
update public.inventory_items i
set origen_abastecimiento = 'Producción interna',
    proveedor = 'Producción propia'
where exists (
  select 1 from public.subrecetas sr where sr.item_id = i.id
);

-- Conserva cantidad, costo, fecha y movimiento de entradas históricas hechas
-- desde el botón equivocado; solo corrige el origen al valor ya admitido por
-- inventory_lots para que el lote siga siendo completamente trazable.
update public.inventory_lots l
set origin = 'Producción',
    supplier = 'Producción propia'
where lower(btrim(coalesce(l.origin,''))) = 'compra'
  and exists (
    select 1 from public.inventory_items i
    where i.id = l.item_id and i.origen_abastecimiento = 'Producción interna'
  );

create or replace function public.guard_internal_preparation_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_name text;
  v_subrecipe_name text;
begin
  if lower(btrim(coalesce(new.origin,''))) <> 'compra' then
    return new;
  end if;

  select i.nombre, sr.nombre
  into v_item_name, v_subrecipe_name
  from public.inventory_items i
  left join public.subrecetas sr on sr.item_id = i.id
  where i.id = new.item_id
    and i.origen_abastecimiento = 'Producción interna'
  order by sr.activo desc nulls last, sr.id
  limit 1;

  if v_item_name is not null then
    raise exception '% no se compra: se prepara en Cocina como %. Usá producir_subreceta.',
      v_item_name, coalesce(v_subrecipe_name, v_item_name);
  end if;
  return new;
end
$$;

revoke all on function public.guard_internal_preparation_purchase() from public, anon, authenticated;

drop trigger if exists inventory_lots_internal_purchase_guard on public.inventory_lots;
create trigger inventory_lots_internal_purchase_guard
before insert or update of item_id, origin on public.inventory_lots
for each row execute function public.guard_internal_preparation_purchase();

insert into public.momos_ops_migrations(id, detalle)
values (
  '20260715_18_abastecimiento_interno',
  'Mousses, cheesecake, ganache y salsas entran solo por preparación de subreceta; compras bloqueadas'
)
on conflict(id) do update set detalle = excluded.detalle;

commit;

select id, applied_at, detalle
from public.momos_ops_migrations
where id = '20260715_18_abastecimiento_interno';
