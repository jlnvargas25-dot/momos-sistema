-- MOMOS OPS · relevo explícito Cocina → Empaque
-- Cocina confirma "Listo para empaque"; Empaque confirma "Empacado" con sus fotos.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (select 1 from public.momos_ops_migrations where id = '20260714_06_fifo_variantes_exactas') then
    raise exception 'Falta el paso 06_fifo_variantes_exactas.';
  end if;
  if to_regprocedure('public._set_order_status_core(text,text,boolean)') is null then
    raise exception 'Falta _set_order_status_core; aplicar roles-flujo-pedidos-v1.sql primero.';
  end if;
end $$;

alter table public.orders drop constraint if exists orders_estado_check;
alter table public.orders add constraint orders_estado_check check (estado in (
  'Nuevo','Confirmado','Pendiente de pago','Pagado','En producción','Listo para empaque',
  'Empacado','Listo para despacho','En ruta','Entregado','Cancelado','Reclamo'
));

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

-- La instalación existente conserva la implementación core anterior bajo este
-- nombre. La envoltura resuelve únicamente las aristas nuevas y delega todo lo
-- demás al core, preservando pago, reservas, recetas, entrega y métricas.
create or replace function public.set_order_status(
  p_order_id text, p_estado text, p_venta_rapida boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  v_prev text;
  v_rol text := public.current_rol();
begin
  if (v_rol in (
    'Administrador','Cajero','Coordinador de pedidos','Cocina','Empaque',
    'Logística','Marketing/CRM','Mensajero'
  )) is not true then
    raise exception 'Solo un usuario operativo activo puede cambiar pedidos.';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'El pedido % no existe', p_order_id; end if;
  v_prev := o.estado;

  if v_prev = p_estado then
    return jsonb_build_object('ok', true, 'de', v_prev, 'a', p_estado, 'faltantes', '[]'::jsonb);
  end if;

  if public.order_transition_role_allowed(v_rol, v_prev, p_estado, p_venta_rapida) is not true then
    raise exception 'El rol % no puede confirmar el paso de "%" a "%". Cada área confirma únicamente el trabajo que ejecutó.', v_rol, v_prev, coalesce(p_estado, '(vacío)');
  end if;

  if (v_prev = 'En producción' and p_estado = 'Listo para empaque')
     or (v_prev = 'Listo para empaque' and p_estado = 'En producción')
     or (v_prev = 'Empacado' and p_estado = 'Listo para empaque') then
    if o.pagado_en is null then
      raise exception 'MOMOS no produce ni empaca pedidos sin pago confirmado.';
    end if;
    perform public._add_audit('Pedido', p_order_id, 'Cambio de estado', v_prev, p_estado);
    update public.orders set estado = p_estado where id = p_order_id;
    return jsonb_build_object('ok', true, 'de', v_prev, 'a', p_estado, 'faltantes', '[]'::jsonb);
  end if;

  if v_prev = 'Listo para empaque' and p_estado = 'Empacado' then
    if o.pagado_en is null then
      raise exception 'MOMOS no empaca pedidos sin pago confirmado.';
    end if;
    if not public._tiene_evidencia(p_order_id, 'Caja abierta') then
      raise exception 'El pedido % no puede pasar a "Empacado": falta la foto de Caja abierta.', p_order_id;
    end if;
    if not public._tiene_sello(p_order_id) then
      raise exception 'El pedido % no puede pasar a "Empacado": falta la foto de Caja cerrada con sello o Bolsa sellada.', p_order_id;
    end if;
    perform public._add_audit('Pedido', p_order_id, 'Cambio de estado', v_prev, p_estado);
    update public.orders set estado = p_estado where id = p_order_id;
    return jsonb_build_object('ok', true, 'de', v_prev, 'a', p_estado, 'faltantes', '[]'::jsonb);
  end if;

  if v_prev = 'Listo para empaque' and p_estado = 'Cancelado' then
    perform public._add_audit('Pedido', p_order_id, 'Cambio de estado', v_prev, p_estado);
    update public.orders set estado = p_estado where id = p_order_id;
    perform public._release_reservations(p_order_id);
    if o.insumos_descontados then
      update public.orders set insumos_descontados = false where id = p_order_id;
    end if;
    update public.deliveries set estado = 'Cancelado' where order_id = p_order_id and estado <> 'Cancelado';
    return jsonb_build_object('ok', true, 'de', v_prev, 'a', p_estado, 'faltantes', '[]'::jsonb);
  end if;

  return public._set_order_status_core(p_order_id, p_estado, p_venta_rapida);
end;
$$;

revoke execute on function public.set_order_status(text,text,boolean) from public;
grant execute on function public.set_order_status(text,text,boolean) to authenticated;

create or replace view public.shop_mis_pedidos with (security_barrier) as
  select o.id, o.fecha, o.hora,
         case o.estado
           when 'Nuevo'               then 'Pedido recibido'
           when 'Confirmado'          then 'Pedido recibido'
           when 'Pendiente de pago'   then 'Pedido recibido'
           when 'Pagado'              then 'Pago confirmado'
           when 'En producción'       then 'Preparando'
           when 'Listo para empaque'  then 'Preparando'
           when 'Empacado'            then 'Preparando'
           when 'Listo para despacho' then 'Listo para despacho'
           when 'En ruta'             then 'En camino'
           when 'Reclamo'             then 'Entregado'
           else o.estado end as estado,
         o.dom_cobrado, o.descuento
  from public.orders o where o.customer_id = public.current_customer_id();

grant select on public.shop_mis_pedidos to authenticated;

insert into public.momos_ops_migrations (id, detalle)
values ('20260714_07_listo_para_empaque', 'Relevo explícito Cocina a Empaque con gates de evidencia')
on conflict (id) do update set detalle = excluded.detalle;

commit;
