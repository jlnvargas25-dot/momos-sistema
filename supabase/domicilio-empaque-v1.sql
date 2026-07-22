-- MOMOS OPS · relevo seguro de Empaque a Domicilios
-- Solo Administrador, Empaque o Logística pueden solicitar un domicilio.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (select 1 from public.momos_ops_migrations where id = '20260714_09_empaque_trazable') then
    raise exception 'Falta el paso 09_empaque_trazable.';
  end if;
  if to_regprocedure('public._crear_domicilio_core(text,text,text,numeric,text)') is null then
    if to_regprocedure('public.crear_domicilio(text,text,text,numeric,text)') is null then
      raise exception 'Falta crear_domicilio(text,text,text,numeric,text).';
    end if;
    alter function public.crear_domicilio(text,text,text,numeric,text) rename to _crear_domicilio_core;
  end if;
end $$;

create or replace function public.delivery_handoff_role_allowed(p_role text)
returns boolean
language sql immutable
set search_path = public
as $$
  select p_role in ('Administrador','Empaque','Logística')
$$;

create or replace function public.crear_domicilio(
  p_order_id text, p_proveedor text, p_zona text default null,
  p_costo_real numeric default 0, p_obs text default ''
) returns text
language plpgsql security definer set search_path = public
as $$
declare v_role text := public.current_rol();
begin
  if not public.delivery_handoff_role_allowed(v_role) then
    raise exception 'Solo Administrador, Empaque o Logística pueden solicitar domicilios.';
  end if;
  return public._crear_domicilio_core(p_order_id, p_proveedor, p_zona, p_costo_real, p_obs);
end;
$$;

revoke all on function public._crear_domicilio_core(text,text,text,numeric,text) from public, anon, authenticated;
revoke all on function public.crear_domicilio(text,text,text,numeric,text) from public, anon;
grant execute on function public.crear_domicilio(text,text,text,numeric,text) to authenticated;
revoke all on function public.delivery_handoff_role_allowed(text) from public, anon;
grant execute on function public.delivery_handoff_role_allowed(text) to authenticated;

insert into public.momos_ops_migrations (id, detalle)
values ('20260714_10_domicilio_empaque', 'Copia, etiqueta y solicitud de domicilio limitada al relevo Empaque-Logística')
on conflict (id) do update set detalle = excluded.detalle;

commit;
