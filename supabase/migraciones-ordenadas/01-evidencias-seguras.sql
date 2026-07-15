-- MOMOS OPS · 01 · evidencias seguras

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

create table if not exists public.momos_ops_migrations (
  id text primary key,
  applied_at timestamptz not null default now(),
  detalle text not null
);
alter table public.momos_ops_migrations enable row level security;
revoke all on table public.momos_ops_migrations from public, anon, authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise exception 'Falta storage.objects. No se puede validar la foto real.';
  end if;
  if exists (
    select 1 from public.evidences
    where storage_path is not null
    group by storage_path having count(*) > 1
  ) then
    raise exception 'Hay rutas de evidencia repetidas. Reconciliarlas antes de continuar.';
  end if;
end $$;

create unique index if not exists evidences_storage_path_uq
  on public.evidences (storage_path);

drop policy if exists evid_insert on public.evidences;
revoke insert, update, delete on table public.evidences from anon, authenticated;

create or replace function public.crear_evidencia(
  p_order_id text, p_tipo text, p_storage_path text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_user_id text;
  v_path text := trim(coalesce(p_storage_path, ''));
begin
  if public.is_staff() is not true then
    raise exception 'Solo staff activo puede registrar evidencias';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'El pedido % no existe', coalesce(p_order_id, '(vacío)');
  end if;
  if p_tipo is null or p_tipo not in (
    'Pedido armado','Caja abierta','Caja cerrada con sello','Bolsa sellada',
    'Comprobante de pago','Entrega'
  ) then
    raise exception 'Tipo de evidencia inválido: %', coalesce(p_tipo, '(vacío)');
  end if;
  if v_path = '' or left(v_path, length(p_order_id) + 1) <> p_order_id || '/'
     or v_path like '/%' or v_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'Ruta inválida: la evidencia debe vivir dentro de %/', p_order_id;
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'evidencias' and name = v_path
  ) then
    raise exception 'El archivo de la evidencia no existe en Storage — subí la foto primero';
  end if;
  if exists (select 1 from public.evidences where storage_path = v_path) then
    raise exception 'Esta foto ya fue registrada y no se puede reutilizar';
  end if;

  select id into v_user_id from public.users where auth_id = auth.uid() and activo;
  v_id := public.next_id('evidence', 'E', 2);
  insert into public.evidences (id, order_id, tipo, storage_path, user_id)
  values (v_id, p_order_id, p_tipo, v_path, v_user_id);
  insert into public.audit_logs (id, user_id, entidad, entidad_id, accion, de, a)
  values (public.next_id('audit', 'A', 2), v_user_id, 'Evidencia', p_order_id, 'Foto subida', '', p_tipo);
  return v_id;
end;
$$;

revoke all on function public.crear_evidencia(text,text,text) from public, anon;
grant execute on function public.crear_evidencia(text,text,text) to authenticated;

insert into public.momos_ops_migrations (id, detalle)
values ('20260714_01_evidencias_seguras', 'RPC única, archivo real, ruta ligada al pedido y no reutilizable')
on conflict (id) do update set detalle = excluded.detalle;

commit;

