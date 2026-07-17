-- MOMOS OPS · prueba del catálogo completo de figuras. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260717_52_catalogo_figuras_toby'), 'Falta aplicar la migración 52.';
  assert exists(select 1 from public.figuras where nombre='Momo' and activo), 'Momo no está activo como figura.';
  assert exists(select 1 from public.figuras where nombre='Toby' and activo and especie='gato' and gramaje_g=280), 'Toby no está configurado como gato de 280 g.';
  assert not has_table_privilege('authenticated','public.figuras','UPDATE'), 'Un usuario autenticado puede alterar directamente el catálogo de figuras.';
end $$;

select 'TESTS_OK — Momo/Toby visibles y Toby gato 280 g/RBAC PASS, rollback total' as resultado;
rollback;
