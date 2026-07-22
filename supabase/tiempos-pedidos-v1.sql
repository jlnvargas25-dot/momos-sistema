-- MOMOS OPS · tiempos configurables de pedidos demorados
-- Seguro para instalaciones existentes: conserva cualquier valor ya definido.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (select 1 from public.momos_ops_migrations where id = '20260714_03_roles_flujo') then
    raise exception 'Falta el paso 03_roles_flujo.';
  end if;
end $$;

insert into app_settings (clave, valor) values
  ('demora_cocina_min', '15'),
  ('demora_cocina_urgente_min', '30'),
  ('demora_empaque_min', '10'),
  ('demora_empaque_urgente_min', '20'),
  ('demora_repeticion_min', '5')
on conflict (clave) do nothing;

insert into public.momos_ops_migrations (id, detalle)
values ('20260714_04_tiempos_pedidos', 'Umbrales configurables de cocina, empaque, urgencia y repetición')
on conflict (id) do update set detalle = excluded.detalle;

commit;
