-- MOMOS OPS · H89 · cierre de lecturas directas con PII.
--
-- H88 instaló snapshots proyectados por la unión real de roles. H89 convierte
-- esos snapshots en la única frontera de lectura para operación, clientes y
-- trazabilidad sensible. Las mutaciones continúan pasando por RPC canónicas.
begin;

set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if not exists(
    select 1 from public.momos_ops_migrations
    where id='20260720_88_aislamiento_snapshots_rol'
  ) then
    raise exception 'Falta H88 aislamiento de snapshots por rol.';
  end if;
  if to_regprocedure('public.current_roles()') is null
     or to_regprocedure('public.momos_core_snapshot_v3()') is null
     or to_regprocedure('public.momos_operational_snapshot_v2()') is null then
    raise exception 'Faltan los contratos protegidos de H88.';
  end if;
end $$;

-- Perfil propio mínimo. El arranque no necesita leer public.users ni recibir
-- correo, auth_id u otra identidad de un compañero para resolver la sesión.
create or replace function public.momos_current_user_profile_v1()
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp
set row_security=off
as $$
declare
  v_user public.users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sesión MOMOS inválida.' using errcode='42501';
  end if;
  select * into v_user
  from public.users
  where auth_id=auth.uid() and activo
  limit 1;
  if v_user.id is null then
    raise exception 'Usuario MOMOS inactivo o no vinculado.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'id',v_user.id,
    'nombre',v_user.nombre,
    'rol',v_user.rol,
    'roles',to_jsonb(coalesce(v_user.roles,array[v_user.rol]::text[])),
    'activo',v_user.activo,
    'version',1,
    'privacy',jsonb_build_object(
      'own_profile_only',true,
      'contains_email',false,
      'contains_auth_id',false,
      'contains_secrets',false,
      'external_execution',false
    )
  );
end;
$$;
revoke all on function public.momos_current_user_profile_v1()
  from public,anon,service_role;
grant execute on function public.momos_current_user_profile_v1() to authenticated;

-- El usuario conserva una lectura directa exclusivamente de su propia fila.
-- Administración mantiene admin_all. El directorio seguro para los demás
-- roles vive en momos_core_snapshot_v3().
drop policy if exists staff_read on public.users;
drop policy if exists own_profile_read on public.users;
create policy own_profile_read on public.users
for select to authenticated
using (auth_id=auth.uid() and activo);

-- Ningún rol operativo ni el agente puede extraer estas tablas directamente.
-- Los snapshots H88 entregan solo las columnas que cada área necesita.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'customers','orders','order_items','order_item_adiciones','deliveries',
    'evidences','benefits','claims','audit_logs','packing_verifications',
    'order_stage_assignments','order_line_progress','order_incidents',
    'order_dispatch_handoffs','customer_crm_profiles','customer_contacts',
    'customer_activations'
  ]::text[] loop
    if to_regclass('public.'||v_table) is null then
      raise exception 'Falta la tabla sensible public.%.',v_table;
    end if;
    execute format('drop policy if exists staff_read on public.%I',v_table);
  end loop;
end $$;

drop policy if exists packing_verifications_staff_read on public.packing_verifications;
drop policy if exists claude_read on public.orders;
drop policy if exists claude_read on public.order_items;
drop policy if exists claude_read on public.order_item_adiciones;

comment on function public.momos_current_user_profile_v1() is
  'Perfil mínimo de la sesión autenticada; nunca expone correo, auth_id, PII de clientes ni secretos.';
comment on table public.customers is
  'PII de clientes: lectura de cliente bloqueada; consumir momos_operational_snapshot_v2 según rol.';
comment on table public.orders is
  'Pedidos sensibles: lectura de cliente bloqueada; consumir momos_operational_snapshot_v2 según rol.';
comment on table public.users is
  'Directorio interno: cada sesión solo lee su fila; el directorio proyectado vive en momos_core_snapshot_v3.';

create or replace function public.cierre_lecturas_pii_disponible()
returns boolean
language sql stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select cardinality(coalesce(public.current_roles(),array[]::text[]))>0
    and exists(select 1 from public.momos_ops_migrations
      where id='20260720_89_cierre_lecturas_pii')
    and to_regprocedure('public.momos_current_user_profile_v1()') is not null
    and not exists(
      select 1 from pg_catalog.pg_policies p
      where p.schemaname='public'
        and p.tablename=any(array[
          'users','customers','orders','order_items','order_item_adiciones',
          'deliveries','evidences','benefits','claims','audit_logs',
          'packing_verifications','order_stage_assignments','order_line_progress',
          'order_incidents','order_dispatch_handoffs','customer_crm_profiles',
          'customer_contacts','customer_activations'
        ]::text[])
        and (p.policyname='staff_read'
          or p.policyname='packing_verifications_staff_read'
          or p.policyname='claude_read')
    )
$$;
revoke all on function public.cierre_lecturas_pii_disponible()
  from public,anon,service_role;
grant execute on function public.cierre_lecturas_pii_disponible() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260720_89_cierre_lecturas_pii',
  'Snapshots H88 obligatorios, perfil propio mínimo y cierre de SELECT directo sobre PII operativa'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
