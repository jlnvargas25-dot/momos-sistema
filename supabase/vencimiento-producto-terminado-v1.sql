-- MOMOS OPS · vencimiento seguro de producto terminado.
-- Paso 17, después de Agencia Comercial v1.
-- La vida útil nace al desmoldar: fecha local de Bogotá + 3 días.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260715'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (
       select 1 from public.momos_ops_migrations
       where id = '20260714_16_agencia_comercial'
     ) then
    raise exception 'Falta el paso 16_agencia_comercial.';
  end if;
  if to_regclass('public.production_batches') is null
     or to_regclass('public.lote_figuras') is null then
    raise exception 'Faltan production_batches o lote_figuras.';
  end if;
end $$;

alter table public.production_batches
  add column if not exists desmoldado_en timestamptz;
alter table public.production_batches
  add column if not exists vencimiento date;

comment on column public.production_batches.desmoldado_en is
  'Instante inmutable del primer desmolde. Origina el vencimiento del producto terminado.';
comment on column public.production_batches.vence is
  'Fecha de vencimiento operativa: fecha Bogotá del primer desmolde + 3 días.';
comment on column public.production_batches.vencimiento is
  'Alias legado sincronizado con vence; no se edita manualmente después del desmolde.';

-- Reconstruye el primer desmolde de lotes ya existentes. El audit es la fuente
-- preferida; fecha del lote es el fallback conservador para datos anteriores al audit.
update public.production_batches b
set desmoldado_en = coalesce(
  (
    select min(a.fecha)
    from public.audit_logs a
    where a.entidad = 'Lote'
      and a.entidad_id = b.id
      and lower(a.accion) = 'lote desmoldado'
  ),
  b.fecha::timestamp at time zone 'America/Bogota'
)
where b.desmoldado_en is null
  and (
    b.stock_contabilizado = true
    or b.estado in ('Listo','Reservado','Vendido','Imperfecto','Descartado')
    or exists (select 1 from public.lote_figuras lf where lf.batch_id = b.id)
  );

-- Un lote todavía no desmoldado no es producto terminado y no puede tener una
-- fecha de vencimiento anticipada. Esto elimina el antiguo default de +14 días.
update public.production_batches
set vence = null, vencimiento = null
where desmoldado_en is null;

update public.production_batches
set vence = ((desmoldado_en at time zone 'America/Bogota')::date + 3),
    vencimiento = ((desmoldado_en at time zone 'America/Bogota')::date + 3)
where desmoldado_en is not null;

create or replace function public.enforce_finished_product_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expiry date;
begin
  -- El primer desmolde es inmutable: ni una edición de lote ni una reversa de
  -- estado pueden rejuvenecer producto terminado.
  if tg_op = 'UPDATE' then
    if old.desmoldado_en is not null then
      new.desmoldado_en := old.desmoldado_en;
    end if;
  end if;

  -- El RPC de desmolde cambia estado y stock en el mismo UPDATE. Ese momento
  -- sella automáticamente el primer desmolde, sin depender del cliente.
  if tg_op = 'UPDATE' then
    if new.desmoldado_en is null
       and new.estado = 'Listo'
       and new.stock_contabilizado = true
       and (old.estado is distinct from 'Listo' or old.stock_contabilizado is distinct from true) then
      new.desmoldado_en := now();
    end if;
  end if;

  -- Compatibilidad para cargas administrativas ya desmoldadas: si INSERT trae
  -- una fecha explícita, se normaliza. Los fixtures históricos con vencimiento
  -- explícito y sin timestamp se conservan para restauraciones controladas.
  if tg_op = 'INSERT' then
    if new.desmoldado_en is null
       and new.estado = 'Listo'
       and new.stock_contabilizado = true
       and new.vence is null
       and new.vencimiento is null then
      new.desmoldado_en := now();
    end if;
  end if;

  if new.desmoldado_en is null then
    -- Antes del desmolde la vida útil todavía no empezó.
    if new.estado not in ('Listo','Reservado','Vendido','Imperfecto','Descartado') then
      new.vence := null;
      new.vencimiento := null;
    end if;
    return new;
  end if;

  v_expiry := (new.desmoldado_en at time zone 'America/Bogota')::date + 3;
  new.vence := v_expiry;
  new.vencimiento := v_expiry;
  return new;
end
$$;

revoke all on function public.enforce_finished_product_expiry() from public, anon, authenticated;

drop trigger if exists production_batches_finished_expiry_guard on public.production_batches;
create trigger production_batches_finished_expiry_guard
before insert or update on public.production_batches
for each row execute function public.enforce_finished_product_expiry();

create index if not exists production_batches_desmoldado_en_idx
  on public.production_batches(desmoldado_en)
  where desmoldado_en is not null;

insert into public.momos_ops_migrations(id, detalle)
values (
  '20260715_17_vencimiento_terminado',
  'Producto terminado vence 3 días después del primer desmolde; fecha sellada e inmutable para FIFO'
)
on conflict(id) do update set detalle = excluded.detalle;

commit;

select id, applied_at, detalle
from public.momos_ops_migrations
where id = '20260715_17_vencimiento_terminado';
