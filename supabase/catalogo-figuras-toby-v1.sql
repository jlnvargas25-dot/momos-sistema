-- MOMOS OPS · catálogo completo de figuras v1.
-- Toby es una figura gato de 280 g. No cambia product_id ni stock histórico.
begin;

select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260717_51_eliminacion_biblioteca') then
    raise exception 'Falta el paso 51_eliminacion_biblioteca.';
  end if;
  if to_regclass('public.figuras') is null then
    raise exception 'Falta el catálogo de figuras.';
  end if;
  if not exists(select 1 from public.figuras where nombre='Momo') then
    raise exception 'Falta Momo en el catálogo de figuras; corregí el catálogo antes de continuar.';
  end if;
  if not exists(select 1 from public.figuras where nombre='Toby') then
    raise exception 'Falta Toby en el catálogo de figuras; corregí el catálogo antes de continuar.';
  end if;
end $$;

update public.figuras set activo=true where nombre in ('Momo','Toby');
update public.figuras set especie='gato',gramaje_g=280 where nombre='Toby';

insert into public.momos_ops_migrations(id,detalle)
values('20260717_52_catalogo_figuras_toby','Momo y Toby visibles como figuras activas; Toby corregido a gato de 280 g')
on conflict(id) do update set detalle=excluded.detalle;

commit;
