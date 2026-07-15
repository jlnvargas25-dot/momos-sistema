-- MOMOS OPS · Administrador como respaldo de Cocina, Empaque y Logística
-- Mantiene intactas las gates de pago, inventario, domicilio y evidencias.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (select 1 from public.momos_ops_migrations where id = '20260714_04_tiempos_pedidos') then
    raise exception 'Falta el paso 04_tiempos_pedidos.';
  end if;
end $$;

create or replace function public.order_transition_role_allowed(
  p_role text, p_from text, p_to text, p_quick_sale boolean default false
)
returns boolean
language sql immutable
set search_path = public
as $$
  select case
    when p_from = p_to then p_role in (
      'Administrador','Cajero','Coordinador de pedidos','Cocina','Empaque',
      'Logística','Marketing/CRM','Mensajero'
    )
    when p_to in ('Nuevo','Confirmado','Pendiente de pago')
      then public.order_intake_role_allowed(p_role)
    when p_to = 'Pagado'
      then p_role in ('Administrador','Cajero','Coordinador de pedidos')
    when p_to in ('En producción','Listo para empaque')
      then p_role in ('Administrador','Cocina')
    when p_to in ('Empacado','Listo para despacho')
      then p_role in ('Administrador','Empaque')
    when p_to = 'En ruta'
      then p_role in ('Administrador','Logística','Mensajero')
    when p_to = 'Entregado' and p_quick_sale and p_from = 'Pagado'
      then p_role in ('Administrador','Cajero','Coordinador de pedidos','Logística','Mensajero')
    when p_to = 'Entregado' and p_quick_sale
      then false
    when p_to = 'Entregado'
      then p_role in ('Administrador','Logística','Mensajero')
    when p_to = 'Cancelado'
      then p_role in ('Administrador','Cajero','Coordinador de pedidos')
    when p_to = 'Reclamo'
      then p_role in ('Administrador','Coordinador de pedidos','Empaque','Logística','Marketing/CRM')
    else false
end
$$;

create or replace function public.order_evidence_role_allowed(p_role text, p_type text)
returns boolean
language sql immutable
set search_path = public
as $$
  select case
    when p_type = 'Comprobante de pago'
      then p_role in ('Administrador','Cajero','Coordinador de pedidos')
    when p_type in ('Pedido armado','Caja abierta','Caja cerrada con sello','Bolsa sellada')
      then p_role in ('Administrador','Empaque')
    when p_type = 'Entrega'
      then p_role in ('Administrador','Cajero','Coordinador de pedidos','Logística','Mensajero')
    else false
end
$$;

insert into public.momos_ops_migrations (id, detalle)
values ('20260714_05_admin_operacion', 'Administrador como respaldo operativo sin saltar gates')
on conflict (id) do update set detalle = excluded.detalle;

commit;
