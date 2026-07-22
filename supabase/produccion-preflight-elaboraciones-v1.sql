-- MOMOS OPS · H80 Producción: preflight obligatorio de elaboraciones.
-- Un lote que usa el modelo de subrecetas solo puede nacer cuando toda la
-- mousse y todos los rellenos preparados están disponibles en inventario.
begin;

set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if not exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_79_historial_operativo_paginado'
  ) then
    raise exception 'Falta el paso 79_historial_operativo_paginado.';
  end if;
  if to_regclass('public.production_batches') is null
     or to_regclass('public.inventory_items') is null
     or to_regclass('public.subrecetas') is null
     or to_regclass('public.figura_relleno') is null
     or to_regprocedure('public.crear_corrida(jsonb)') is null then
    raise exception 'Falta el contrato de producción por subrecetas.';
  end if;
end $$;

create or replace function public._production_batch_prepared_stock_guard()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_mousse_item_id text;
  v_filling_per_unit_g numeric:=0;
  v_mousse_per_unit_g numeric:=0;
  v_requirement record;
  v_item record;
  v_required_stock numeric;
begin
  -- Los lotes históricos o de la ruta legacy siguen siendo compatibles. La
  -- ruta vigente de crear_corrida siempre informa corrida_id y prod positivo.
  if new.corrida_id is null or coalesce(new.prod,0)<=0 then
    return new;
  end if;

  -- Espejo exacto de crear_corrida: una mousse activa resuelta por sabor. Si
  -- no existe, esa RPC conserva su fallback legacy y este guard no interviene.
  select sr.item_id into v_mousse_item_id
  from public.subrecetas sr
  where sr.tipo in ('mousse_frutal','mousse_cremosa')
    and sr.activo
    and lower(sr.sabor)=lower(new.sabor)
  limit 1;

  if v_mousse_item_id is null then
    return new;
  end if;

  select coalesce(sum(fr.gramos_por_unidad),0)
    into v_filling_per_unit_g
  from public.figura_relleno fr
  where fr.activo;

  v_mousse_per_unit_g:=coalesce(new.gramaje_g,0)-v_filling_per_unit_g;
  if v_mousse_per_unit_g<=0 then
    raise exception
      'No se puede crear el lote: el gramaje (%) no alcanza para los rellenos configurados (% g).',
      new.gramaje_g,v_filling_per_unit_g
      using errcode='23514';
  end if;

  -- Agrupar por item evita validar dos veces una misma elaboración y fija el
  -- orden de los locks. Los locks permanecen hasta que crear_corrida termina
  -- de descontar, por lo que dos solicitudes concurrentes no duplican stock.
  for v_requirement in
    select requirement.item_id,round(sum(requirement.required_g),4) as required_g
    from (
      select v_mousse_item_id as item_id,
             v_mousse_per_unit_g*new.prod as required_g
      union all
      select sr.item_id,
             fr.gramos_por_unidad*new.prod as required_g
      from public.figura_relleno fr
      join public.subrecetas sr on sr.id=fr.subreceta_id
      where fr.activo
    ) requirement
    group by requirement.item_id
    order by requirement.item_id
  loop
    select it.id,it.nombre,coalesce(it.stock,0) as stock,it.unidad
      into v_item
    from public.inventory_items it
    where it.id=v_requirement.item_id
    for update;

    if not found then
      raise exception
        'No se puede crear el lote: falta en inventario una elaboración requerida (%).',
        v_requirement.item_id
        using errcode='23514';
    end if;

    v_required_stock:=round(
      v_requirement.required_g/(case when v_item.unidad='g' then 1 else 1000 end),
      4
    );

    if v_item.stock+0.0000001<v_required_stock then
      raise exception
        'No se puede crear el lote: % requiere % % y hay % %. Prepará y registrá esta elaboración en inventario antes de crear el lote.',
        v_item.nombre,v_required_stock,v_item.unidad,v_item.stock,v_item.unidad
        using errcode='23514';
    end if;
  end loop;

  return new;
end $$;

revoke all on function public._production_batch_prepared_stock_guard()
from public,anon,authenticated,service_role;

drop trigger if exists production_batches_prepared_stock_guard
on public.production_batches;
create trigger production_batches_prepared_stock_guard
before insert on public.production_batches
for each row execute function public._production_batch_prepared_stock_guard();

do $$
begin
  if not exists(
    select 1 from pg_trigger
    where tgname='production_batches_prepared_stock_guard'
      and tgrelid='public.production_batches'::regclass
      and not tgisinternal
      and tgenabled='O'
  ) then
    raise exception 'No quedó instalado el preflight de elaboraciones.';
  end if;
  if has_function_privilege(
    'authenticated','public._production_batch_prepared_stock_guard()','EXECUTE'
  ) then
    raise exception 'La función interna del preflight quedó invocable por authenticated.';
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260719_80_produccion_preflight_elaboraciones',
  'Crear lotes exige stock completo de mousse y rellenos preparados; validación transaccional y locks anti-sobreconsumo'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
