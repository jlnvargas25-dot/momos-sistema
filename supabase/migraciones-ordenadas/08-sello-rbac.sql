-- MOMOS OPS · 08 · sello final de roles y permisos
-- Debe correrse después de listo-para-empaque-v1.sql.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regprocedure('public._crear_pedido_core(jsonb)') is null then
    raise exception 'Falta _crear_pedido_core(jsonb): aplicar roles-flujo-pedidos-v1.sql primero.';
  end if;
  if to_regprocedure('public._set_order_status_core(text,text,boolean)') is null then
    raise exception 'Falta _set_order_status_core(text,text,boolean): aplicar roles-flujo-pedidos-v1.sql primero.';
  end if;
  if position('Listo para empaque' in pg_get_functiondef('public.set_order_status(text,text,boolean)'::regprocedure)) = 0 then
    raise exception 'set_order_status aún no contiene el relevo Listo para empaque; aplicar listo-para-empaque-v1.sql.';
  end if;
end $$;

create or replace function public.enforce_order_intake_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_rol text;
begin
  if auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated','anon') then
    return new;
  end if;
  v_rol := public.current_rol();
  if public.order_intake_role_allowed(v_rol) is not true then
    raise exception 'El rol % no puede crear pedidos.', coalesce(v_rol, '(sin rol activo)');
  end if;
  return new;
end;
$$;

drop trigger if exists orders_intake_role_guard on public.orders;
create trigger orders_intake_role_guard
before insert on public.orders
for each row execute function public.enforce_order_intake_role();

revoke all on function public._crear_pedido_core(jsonb) from public, anon, authenticated;
revoke all on function public._set_order_status_core(text,text,boolean) from public, anon, authenticated;
revoke all on function public.enforce_order_intake_role() from public, anon, authenticated;
revoke execute on function public.crear_pedido(jsonb) from public, anon;
revoke execute on function public.set_order_status(text,text,boolean) from public, anon;
grant execute on function public.crear_pedido(jsonb) to authenticated;
grant execute on function public.set_order_status(text,text,boolean) to authenticated;

insert into public.momos_ops_migrations (id, detalle)
values ('20260714_08_sello_rbac', 'Guard de alta a nivel tabla, cores privados y wrappers autenticados')
on conflict (id) do update set detalle = excluded.detalle;

commit;
