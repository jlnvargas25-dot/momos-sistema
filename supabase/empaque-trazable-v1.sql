-- MOMOS OPS · verificación trazable de Empaque
-- Paso 09, después de 08-sello-rbac.sql y antes de domicilio-empaque-v1.sql.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (select 1 from public.momos_ops_migrations where id = '20260714_08_sello_rbac') then
    raise exception 'Falta el paso 08_sello_rbac.';
  end if;
  if to_regprocedure('public.current_rol()') is null
     or to_regprocedure('public._add_audit(text,text,text,text,text)') is null then
    raise exception 'Faltan las funciones de roles o auditoría requeridas por Empaque.';
  end if;
end $$;

create table if not exists public.packing_verifications (
  order_id text primary key references public.orders(id) on delete cascade,
  user_id text references public.users(id),
  verified_at timestamptz not null default now(),
  line_ids text[] not null,
  order_signature text not null,
  snapshot jsonb not null,
  constraint packing_verifications_lineas_no_vacias check (cardinality(line_ids) > 0)
);

alter table public.packing_verifications enable row level security;
drop policy if exists packing_verifications_staff_read on public.packing_verifications;
create policy packing_verifications_staff_read
on public.packing_verifications for select to authenticated
using (public.is_staff());

revoke all on table public.packing_verifications from public, anon, authenticated;
grant select on table public.packing_verifications to authenticated;

-- La firma incluye cantidades, atributos y adiciones: conservar los mismos ids
-- no basta si el contenido real de la comanda cambió después de verificarla.
create or replace function public._packing_order_snapshot(p_order_id text)
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', oi.id,
      'product_id', oi.product_id,
      'nombre', oi.nombre,
      'cant', oi.cant,
      'figura', coalesce(oi.figura, ''),
      'sabor', coalesce(oi.sabor, ''),
      'salsa', coalesce(oi.salsa, ''),
      'relleno', coalesce(oi.relleno, ''),
      'parent_item_id', oi.parent_item_id,
      'caja_num', oi.caja_num,
      'adiciones', coalesce((
        select jsonb_agg(jsonb_build_object(
          'nombre', a.nombre,
          'cant', a.cant,
          'precio', a.precio,
          'insumo_id', a.insumo_id,
          'insumo_cant', a.insumo_cant
        ) order by a.id)
        from public.order_item_adiciones a
        where a.order_item_id = oi.id
      ), '[]'::jsonb)
    ) order by oi.id
  ), '[]'::jsonb)
  from public.order_items oi
  where oi.order_id = p_order_id
$$;

create or replace function public._packing_order_signature(p_order_id text)
returns text
language sql stable
security definer
set search_path = public
as $$
  select md5(public._packing_order_snapshot(p_order_id)::text)
$$;

create or replace function public.confirmar_verificacion_empaque(
  p_order_id text,
  p_line_ids text[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_role text := public.current_rol();
  v_user_id text;
  v_expected_ids text[];
  v_snapshot jsonb;
  v_signature text;
begin
  if v_role is null or v_role not in ('Administrador','Empaque') then
    raise exception 'Solo Administrador o Empaque pueden verificar una comanda.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'El pedido % no existe.', p_order_id; end if;
  if v_order.estado <> 'Listo para empaque' then
    raise exception 'El pedido % debe estar Listo para empaque; actualmente está %.', p_order_id, v_order.estado;
  end if;

  select coalesce(array_agg(id order by id), array[]::text[])
  into v_expected_ids
  from public.order_items
  where order_id = p_order_id;

  if cardinality(v_expected_ids) = 0 then
    raise exception 'El pedido % no tiene líneas para verificar.', p_order_id;
  end if;
  if p_line_ids is null
     or cardinality(p_line_ids) <> cardinality(v_expected_ids)
     or exists (select 1 from unnest(p_line_ids) id where id is null or btrim(id) = '')
     or (select count(distinct id) from unnest(p_line_ids) id) <> cardinality(p_line_ids)
     or exists (
       (select unnest(v_expected_ids) except select unnest(p_line_ids))
       union all
       (select unnest(p_line_ids) except select unnest(v_expected_ids))
     ) then
    raise exception 'Las líneas confirmadas no coinciden exactamente con la orden %.', p_order_id;
  end if;

  v_snapshot := public._packing_order_snapshot(p_order_id);
  v_signature := md5(v_snapshot::text);
  select id into v_user_id from public.users where auth_id = auth.uid() and activo;

  insert into public.packing_verifications (
    order_id, user_id, verified_at, line_ids, order_signature, snapshot
  ) values (
    p_order_id, v_user_id, now(), v_expected_ids, v_signature, v_snapshot
  )
  on conflict (order_id) do update set
    user_id = excluded.user_id,
    verified_at = excluded.verified_at,
    line_ids = excluded.line_ids,
    order_signature = excluded.order_signature,
    snapshot = excluded.snapshot;

  perform public._add_audit(
    'Pedido', p_order_id, 'Comanda verificada por Empaque', '',
    cardinality(v_expected_ids)::text || ' líneas coinciden'
  );

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'lineas', cardinality(v_expected_ids),
    'order_signature', v_signature
  );
end;
$$;

-- Invalida automáticamente una verificación si cambia cualquier línea o adición.
create or replace function public.invalidate_packing_verification_from_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.packing_verifications where order_id = old.order_id;
    return old;
  end if;
  delete from public.packing_verifications where order_id = new.order_id;
  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    delete from public.packing_verifications where order_id = old.order_id;
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_invalidate_packing_verification on public.order_items;
create trigger order_items_invalidate_packing_verification
after insert or update or delete on public.order_items
for each row execute function public.invalidate_packing_verification_from_item();

create or replace function public.invalidate_packing_verification_from_addition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_order_id text;
begin
  select order_id into v_order_id from public.order_items
  where id = case when tg_op = 'DELETE' then old.order_item_id else new.order_item_id end;
  if v_order_id is not null then
    delete from public.packing_verifications where order_id = v_order_id;
  end if;
  if tg_op = 'UPDATE' and old.order_item_id is distinct from new.order_item_id then
    select order_id into v_order_id from public.order_items where id = old.order_item_id;
    if v_order_id is not null then
      delete from public.packing_verifications where order_id = v_order_id;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists order_item_adiciones_invalidate_packing_verification on public.order_item_adiciones;
create trigger order_item_adiciones_invalidate_packing_verification
after insert or update or delete on public.order_item_adiciones
for each row execute function public.invalidate_packing_verification_from_addition();

-- Última defensa: aunque alguien conserve una pantalla vieja, Empacado no avanza
-- si la verificación pertenece a otro contenido o fue invalidada.
create or replace function public.enforce_packing_verification_before_packed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_verification public.packing_verifications%rowtype;
begin
  if new.estado = 'Empacado' and old.estado is distinct from new.estado then
    select * into v_verification
    from public.packing_verifications
    where order_id = new.id;
    if v_verification.order_id is null then
      raise exception 'El pedido % no puede pasar a Empacado: falta verificar la comanda completa.', new.id;
    end if;
    if v_verification.order_signature <> public._packing_order_signature(new.id) then
      raise exception 'El pedido % cambió después de verificarse; Empaque debe comparar la comanda nuevamente.', new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_packing_verification_guard on public.orders;
create trigger orders_packing_verification_guard
before update of estado on public.orders
for each row execute function public.enforce_packing_verification_before_packed();

revoke all on function public._packing_order_snapshot(text) from public, anon, authenticated;
revoke all on function public._packing_order_signature(text) from public, anon, authenticated;
revoke all on function public.invalidate_packing_verification_from_item() from public, anon, authenticated;
revoke all on function public.invalidate_packing_verification_from_addition() from public, anon, authenticated;
revoke all on function public.enforce_packing_verification_before_packed() from public, anon, authenticated;
revoke all on function public.confirmar_verificacion_empaque(text,text[]) from public, anon;
grant execute on function public.confirmar_verificacion_empaque(text,text[]) to authenticated;

insert into public.momos_ops_migrations (id, detalle)
values ('20260714_09_empaque_trazable', 'Empaque verifica líneas exactas y la orden queda sellada contra cambios posteriores')
on conflict (id) do update set detalle = excluded.detalle;

commit;
