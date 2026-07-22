-- ============================================================================
-- roles_flujo_pedidos_v1 — separación de responsabilidades por pedido
--
-- Recepción: Administrador/Cajero/Coordinador/Empaque pueden agendar.
-- Pago: Administrador/Cajero/Coordinador.
-- Producción: Cocina o Administrador.
-- Listo para empaque: Cocina o Administrador. Empacado/Listo para despacho: Empaque o Administrador.
-- Ruta/Entrega: Logística, Mensajero o Administrador (venta rápida también Caja/Coordinación).
--
-- Las RPC core conservan todas sus gates e impactos. Estas envolturas agregan
-- autorización FAIL-CLOSED antes de entrar al core y bloquean atajos por UI.
-- ============================================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (select 1 from public.momos_ops_migrations where id = '20260714_02_integridad_pedidos') then
    raise exception 'Falta el paso 02_integridad_pedidos.';
  end if;
  if to_regprocedure('public.crear_pedido(jsonb)') is null
     and to_regprocedure('public._crear_pedido_core(jsonb)') is null then
    raise exception 'Falta crear_pedido(jsonb) y no existe un core recuperable.';
  end if;
  if to_regprocedure('public.set_order_status(text,text,boolean)') is null
     and to_regprocedure('public._set_order_status_core(text,text,boolean)') is null then
    raise exception 'Falta set_order_status(text,text,boolean) y no existe un core recuperable.';
  end if;
end $$;

alter table public.users drop constraint if exists users_rol_check;
alter table public.users add constraint users_rol_check check (rol in (
  'Administrador','Cajero','Coordinador de pedidos','Cocina','Empaque',
  'Logística','Marketing/CRM','Mensajero'
));

create or replace function public.order_intake_role_allowed(p_role text)
returns boolean
language sql immutable
set search_path = public
as $$
  select p_role in ('Administrador','Cajero','Coordinador de pedidos','Empaque')
$$;

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

create or replace function public.enforce_order_evidence_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  if auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated','anon') then return new; end if;
  v_rol := public.current_rol();
  if public.order_evidence_role_allowed(v_rol, new.tipo) is not true then
    raise exception 'El rol % no puede registrar evidencia de tipo "%"; esa foto pertenece a otra área.', coalesce(v_rol, '(sin rol activo)'), new.tipo;
  end if;
  return new;
end;
$$;

drop trigger if exists evidences_role_guard on public.evidences;
create trigger evidences_role_guard
before insert on public.evidences
for each row execute function public.enforce_order_evidence_role();

-- Cinturón de seguridad a nivel tabla: incluso una llamada interna que conserve
-- un plan viejo hacia la RPC core pasa por este trigger antes de mutar estado.
-- SQL Editor/migraciones sin JWT se permiten; una petición anon/auth sin perfil
-- falla cerrada. La entrega que salta desde una etapa previa se trata como venta
-- rápida y conserva sus gates de evidencia dentro del core.
create or replace function public.enforce_order_transition_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
  v_quick_sale boolean;
begin
  if new.estado is not distinct from old.estado then return new; end if;
  if auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated','anon') then return new; end if;
  v_rol := public.current_rol();
  v_quick_sale := new.estado = 'Entregado' and old.estado <> 'En ruta';
  if public.order_transition_role_allowed(v_rol, old.estado, new.estado, v_quick_sale) is not true then
    raise exception 'El rol % no puede confirmar el paso de "%" a "%". Cada área confirma únicamente el trabajo que ejecutó.', coalesce(v_rol, '(sin rol activo)'), old.estado, new.estado;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_transition_role_guard on public.orders;
create trigger orders_transition_role_guard
before update of estado on public.orders
for each row execute function public.enforce_order_transition_role();

-- Envolver crear_pedido sin duplicar su lógica de precios, inventario e idempotencia.
do $$
begin
  if to_regprocedure('public._crear_pedido_core(jsonb)') is null then
    alter function public.crear_pedido(jsonb) rename to _crear_pedido_core;
  end if;
end $$;

create or replace function public.crear_pedido(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text := public.current_rol();
begin
  if public.order_intake_role_allowed(v_rol) is not true then
    raise exception 'Tu rol % no puede agendar pedidos. Solo Administrador, Cajero, Coordinador de pedidos o Empaque.', coalesce(v_rol, '(sin rol activo)');
  end if;
  return public._crear_pedido_core(p);
end;
$$;

-- Envolver set_order_status: lock previo evita autorizar contra un estado viejo.
do $$
begin
  if to_regprocedure('public._set_order_status_core(text,text,boolean)') is null then
    alter function public.set_order_status(text,text,boolean) rename to _set_order_status_core;
  end if;
end $$;

create or replace function public.set_order_status(
  p_order_id text, p_estado text, p_venta_rapida boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text;
  v_rol text := public.current_rol();
begin
  if (v_rol in (
    'Administrador','Cajero','Coordinador de pedidos','Cocina','Empaque',
    'Logística','Marketing/CRM','Mensajero'
  )) is not true then
    raise exception 'Solo un usuario operativo activo puede cambiar pedidos.';
  end if;

  select estado into v_prev from public.orders where id = p_order_id for update;
  if v_prev is null then
    raise exception 'El pedido % no existe', p_order_id;
  end if;

  if public.order_transition_role_allowed(v_rol, v_prev, p_estado, p_venta_rapida) is not true then
    raise exception 'El rol % no puede confirmar el paso de "%" a "%". Cada área confirma únicamente el trabajo que ejecutó.', v_rol, v_prev, coalesce(p_estado, '(vacío)');
  end if;

  return public._set_order_status_core(p_order_id, p_estado, p_venta_rapida);
end;
$$;

-- Alta de usuarios: mismo contrato de usuarios_v1, con los dos roles nuevos.
create or replace function public.crear_usuario_staff(
  p_nombre text,
  p_email text,
  p_rol text,
  p_sede_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_sede text;
begin
  if public.is_admin() is not true then
    raise exception 'Solo un Administrador puede crear usuarios';
  end if;
  if p_nombre is null or length(trim(p_nombre)) = 0 then raise exception 'Falta el nombre del usuario'; end if;
  if p_email is null or length(trim(p_email)) = 0 then raise exception 'Falta el email del usuario'; end if;
  if p_rol is null or p_rol not in (
    'Administrador','Cajero','Coordinador de pedidos','Cocina','Empaque',
    'Logística','Marketing/CRM','Mensajero'
  ) then
    raise exception 'Rol inválido: %', coalesce(p_rol, '(vacío)');
  end if;
  if exists (select 1 from public.users where lower(email) = lower(trim(p_email))) then
    raise exception 'Ya existe un usuario con el email %', trim(p_email);
  end if;

  v_sede := coalesce(p_sede_id, (select sede_id from public.users where auth_id = auth.uid()));
  if v_sede is null or not exists (select 1 from public.sedes where id = v_sede) then
    raise exception 'Sede inválida: %', coalesce(v_sede, '(vacía)');
  end if;

  v_id := public.next_id('user', 'U', 2);
  insert into public.users (id, auth_id, nombre, email, rol, activo, sede_id)
  values (v_id, null, trim(p_nombre), trim(p_email), p_rol, true, v_sede);
  insert into public.audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (public.next_id('audit', 'A', 2),
          (select id from public.users where auth_id = auth.uid()),
          'Usuario', v_id, 'Usuario creado', '', p_rol);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public._crear_pedido_core(jsonb) from public, anon, authenticated;
revoke all on function public._set_order_status_core(text,text,boolean) from public, anon, authenticated;
revoke execute on function public.crear_pedido(jsonb) from public, anon;
revoke execute on function public.set_order_status(text,text,boolean) from public, anon;
revoke execute on function public.crear_usuario_staff(text,text,text,text) from public, anon;
grant execute on function public.crear_pedido(jsonb) to authenticated;
grant execute on function public.set_order_status(text,text,boolean) to authenticated;
grant execute on function public.crear_usuario_staff(text,text,text,text) to authenticated;

insert into public.momos_ops_migrations (id, detalle)
values ('20260714_03_roles_flujo', 'Matriz de roles, guards de evidencia/estado y cores privados')
on conflict (id) do update set detalle = excluded.detalle;

commit;
