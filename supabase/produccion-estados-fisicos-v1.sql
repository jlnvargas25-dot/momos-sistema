-- MOMOS OPS · H78 Producción: estados físicos del lote v1.
-- Forward-only: las reservas y ventas viven en inventory_reservations y pedidos.
-- Esta puerta impide volver a convertir el lote completo en una reserva/venta
-- manual, sin borrar los valores históricos admitidos por la tabla.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260719'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_77_dashboard_operativo'
  ) then
    raise exception 'Falta el paso 77_dashboard_operativo.';
  end if;
  if to_regprocedure('public.set_lote_estado(text,text)') is null then
    raise exception 'Falta set_lote_estado(text,text) de Producción v2.';
  end if;
end $$;

create or replace function public.set_lote_estado(p_batch_id text, p_estado text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  b public.production_batches%rowtype;
  v_prev text;
  v_prod record;
begin
  if not public.is_staff() then
    raise exception 'Solo staff activo';
  end if;

  select * into b from public.production_batches where id=p_batch_id for update;
  if b.id is null then
    raise exception 'El lote % no existe',p_batch_id;
  end if;

  -- Producción administra el estado FÍSICO. Reservado/Consumida/Liberada son
  -- estados de inventory_reservations; la venta se cierra desde el pedido.
  -- Imperfectas y descartadas son conteos del desmolde, no estados del lote.
  if p_estado not in ('En preparación','Congelando','Listo') then
    raise exception 'Producción solo permite En preparación, Congelando o Listo. Las reservas y ventas se gestionan automáticamente desde Pedidos.'
      using errcode='22023';
  end if;

  if b.estado=p_estado then
    return jsonb_build_object('ok',true,'sin_cambio',true,'estado',b.estado);
  end if;

  v_prev:=b.estado;

  if p_estado='Listo' and (b.perfectas+b.imperfectas+b.descartadas)<>b.prod then
    raise exception 'Para pasar a Listo hay que registrar el desmolde (conteos) — usá desmoldar_lote';
  end if;

  perform public._add_audit('Lote',p_batch_id,'Cambio de estado',v_prev,p_estado);

  if p_estado='Congelando' and v_prev<>'Congelando' then
    update public.production_batches set inicio_congelacion=now() where id=p_batch_id;
  end if;

  update public.production_batches set estado=p_estado where id=p_batch_id;

  if p_estado='Listo' and not b.stock_contabilizado then
    select id,tipo into v_prod from public.products where id=b.product_id for update;
    if v_prod.id is not null and v_prod.tipo='momo' then
      update public.products set stock=coalesce(stock,0)+b.perfectas where id=b.product_id;
      update public.production_batches set stock_contabilizado=true where id=p_batch_id;
    end if;
  end if;

  -- Reversa operativa para corregir un desmolde: conserva el comportamiento
  -- de Producción v2 y evita que una unidad siga disponible dos veces.
  if p_estado in ('En preparación','Congelando') and b.stock_contabilizado then
    update public.products set stock=greatest(0,coalesce(stock,0)-b.perfectas) where id=b.product_id;
    update public.production_batches set stock_contabilizado=false where id=p_batch_id;
  end if;

  return jsonb_build_object('ok',true,'estado',p_estado);
end $$;

-- CREATE OR REPLACE conserva los ACL vigentes. Estas aserciones fallan cerrado
-- si una reinstalación previa dejó la RPC expuesta de forma distinta.
do $$
begin
  if has_function_privilege('anon','public.set_lote_estado(text,text)','EXECUTE') then
    raise exception 'set_lote_estado quedó expuesta a anon.';
  end if;
  if not has_function_privilege('authenticated','public.set_lote_estado(text,text)','EXECUTE') then
    raise exception 'authenticated perdió acceso a set_lote_estado.';
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260719_78_produccion_estados_fisicos',
  'Producción limita el lote a En preparación/Congelando/Listo; reservas y ventas quedan derivadas por pedido y asignación FIFO')
on conflict(id) do update set detalle=excluded.detalle;

commit;
