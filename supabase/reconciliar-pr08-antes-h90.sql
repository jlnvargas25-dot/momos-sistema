-- MOMOS OPS · conciliación explícita previa a H90.
--
-- PR08 (Cheesecake Momo cuchareable) conservaba 11 unidades en el campo
-- agregado products.stock, pero no existía ningún lote, variante vendible ni
-- reserva vigente que explicara físicamente ese saldo. H90 no puede convertir
-- silenciosamente esas unidades en una preparación al momento: esta operación
-- deja primero una evidencia auditable y falla cerrada ante cualquier estado
-- distinto al verificado.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('momos_ops_reconcile_pr08_h90'));

do $$
declare
  v_product public.products%rowtype;
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(
       select 1 from public.momos_ops_migrations
       where id='20260720_89_cierre_lecturas_pii'
     ) then
    raise exception 'Falta H89 antes de conciliar PR08.';
  end if;

  if exists(
    select 1 from public.momos_ops_migrations
    where id='20260720_90_dominio_productos_figuras'
  ) then
    raise exception 'H90 ya fue aplicada; la conciliación previa no puede repetirse.';
  end if;

  select * into v_product
  from public.products
  where id='PR08'
  for update;

  if v_product.id is null then
    raise exception 'PR08 no existe.';
  end if;

  if v_product.nombre<>'Cheesecake Momo cuchareable'
     or v_product.cat<>'Momos Cuchara'
     or v_product.activo
     or coalesce(v_product.stock,0)<>11 then
    raise exception 'PR08 cambió desde el preflight: nombre %, categoría %, activo %, stock %.',
      v_product.nombre,v_product.cat,v_product.activo,v_product.stock;
  end if;

  if exists(
    select 1 from public.production_batches b
    where b.product_id='PR08'
      and b.estado in ('En preparación','Congelando','Listo','Reservado')
  ) or exists(
    select 1 from public.v_variantes_disponibles v
    where v.product_id='PR08' and coalesce(v.disponibles,0)<>0
  ) or exists(
    select 1 from public.inventory_reservations r
    where r.product_id='PR08' and r.estado in ('Reservada','Temporal')
  ) or exists(
    select 1 from public.production_suggestions s
    where s.product_id='PR08' and s.estado='Pendiente'
  ) then
    raise exception 'PR08 adquirió inventario, reservas o trabajo vivo; conciliación cancelada.';
  end if;

  insert into public.audit_logs(id,user_id,entidad,entidad_id,accion,de,a)
  values(
    'AR-H90-PR08',null,'Producto','PR08',
    'Conciliación explícita de stock legado sin trazabilidad',
    '{"stock_agregado":11,"lotes_vivos":0,"variantes_disponibles":0}',
    '{"stock_agregado":0,"destino":"preparación al momento H90"}'
  );

  update public.products set stock=0 where id='PR08';
end $$;

commit;

select jsonb_build_object(
  'product_id',p.id,
  'stock_after',p.stock,
  'audit_recorded',exists(
    select 1 from public.audit_logs a where a.id='AR-H90-PR08'
  ),
  'historical_orders_preserved',(
    select count(*) from public.order_items oi where oi.product_id='PR08'
  )
) as conciliacion
from public.products p where p.id='PR08';
