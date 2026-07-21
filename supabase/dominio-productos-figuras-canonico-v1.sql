-- MOMOS OPS · H90 · dominio canónico de productos, figuras y cajas.
--
-- Contrato protegido por el servidor:
--   * producto físico / figura: Lizi, Momo, Rocco, Teo, Toby, Danna o Max;
--   * presentación comercial: producto de la categoría Momos Signature;
--   * producto al momento: cuchareable, Cake Momo o Cheesecake Momo puede usar
--     Horizontal como figura auxiliar de decoración, nunca como variante vendible;
--   * caja: presentación tipo combo con hijas resueltas por figuras.product_id;
--   * especie: metadato visual; nunca decide inventario ni una hija de caja.
--
-- H90 se despliega únicamente después del cierre PII H89 y de conciliar
-- explícitamente cualquier saldo agregado legado que vaya a perder semántica.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260720_89_cierre_lecturas_pii'
  ) then
    raise exception 'Falta H89 cierre de lecturas PII por rol.';
  end if;
  if to_regclass('public.products') is null
     or to_regclass('public.figuras') is null
     or to_regclass('public.combo_components') is null
     or to_regclass('public.order_items') is null
     or to_regclass('public.production_batches') is null
     or to_regclass('public.production_suggestions') is null
     or to_regclass('public.inventory_reservations') is null then
    raise exception 'Faltan productos, figuras, cajas, pedidos o fuentes operativas para aplicar H90.';
  end if;
  if not exists(select 1 from public.product_cats where nombre='Momos Signature')
     or not exists(select 1 from public.product_cats where nombre='Cajas y Combos')
     or not exists(select 1 from public.product_cats where nombre='Momos Cuchara') then
    raise exception 'Faltan categorías canónicas de productos.';
  end if;
  if exists(
    select 1 from unnest(array['PR01','PR02','PR04','PR08']::text[]) x(id)
    left join public.products p on p.id=x.id where p.id is null
  ) then
    raise exception 'Faltan PR01, PR02, PR04 o PR08; no se puede inferir una presentación comercial.';
  end if;
end $$;

comment on table public.products is
  'Presentaciones comerciales vendibles: familias Signature, cajas y productos al momento. No es el catálogo de figuras físicas.';
comment on table public.figuras is
  'Figuras de Cocina: siete postres físicos canónicos y Horizontal como auxiliar condicional de Cuchareable/Cake/Cheesecake. product_id solo enlaza figuras canónicas.';
comment on table public.combo_components is
  'Presentaciones comerciales admitidas dentro de una caja; cada postre concreto se define por figura y sabor.';
comment on column public.order_items.product_id is
  'Presentación comercial cobrada o asignada; en una hija de caja coincide con figuras.product_id.';
comment on column public.order_items.figura is
  'Figura física exacta del postre; nunca contiene una familia comercial.';
comment on column public.order_items.sabor is
  'Sabor exacto e independiente de la figura física y de la presentación comercial.';
comment on column public.products.especie is
  'Metadato visual de la presentación Signature; no puede decidir cajas, inventario, reservas ni producción.';

create or replace function public._momos_es_figura_canonica(p_nombre text)
returns boolean language sql immutable parallel safe
set search_path=pg_catalog,public,pg_temp as $$
  select btrim(coalesce(p_nombre,'')) = any(
    array['Lizi','Momo','Rocco','Teo','Toby','Danna','Max']::text[]
  )
$$;

create or replace function public._momos_es_figura_auxiliar(p_nombre text)
returns boolean language sql immutable parallel safe
set search_path=pg_catalog,public,pg_temp as $$
  select btrim(coalesce(p_nombre,''))='Horizontal'
$$;

create or replace function public._momos_producto_usa_horizontal(
  p_nombre text,
  p_familia text,
  p_ruta_id text
)
returns boolean language sql immutable parallel safe
set search_path=pg_catalog,public,pg_temp as $$
  select lower(btrim(coalesce(p_ruta_id,'')))=any(array['r-mck-cong','r-chk-ref','r-cuc-ref']::text[])
    or lower(coalesce(p_nombre,'')) like '%cuchareable%'
    or lower(coalesce(p_nombre,'')) like '%cuchariable%'
    or lower(coalesce(p_nombre,'')) like '%cake momo%'
    or lower(coalesce(p_nombre,'')) like '%momo cake%'
    or lower(btrim(coalesce(p_nombre,''))) like 'cheesecake momo%'
    or lower(btrim(coalesce(p_familia,'')))=any(array['momo cake','cheesecake momo','cuchareable momos']::text[])
$$;

create or replace function public._momos_horizontal_requerida()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
  select exists(
    select 1 from public.products p
    where p.activo and public._momos_producto_usa_horizontal(p.nombre,p.familia,p.ruta_id)
  )
$$;

create or replace function public._momos_producto_figura_esperado(p_nombre text)
returns text language sql immutable parallel safe
set search_path=pg_catalog,public,pg_temp as $$
  select case btrim(coalesce(p_nombre,''))
    when 'Lizi' then 'PR01' when 'Momo' then 'PR01' when 'Toby' then 'PR01'
    when 'Max' then 'PR02' when 'Rocco' then 'PR02' when 'Danna' then 'PR02'
    when 'Teo' then 'PR04' else null end
$$;

create or replace function public._momos_especie_figura_esperada(p_nombre text)
returns text language sql immutable parallel safe
set search_path=pg_catalog,public,pg_temp as $$
  select case
    when btrim(coalesce(p_nombre,''))=any(array['Lizi','Momo','Toby','Teo']::text[]) then 'gato'
    when btrim(coalesce(p_nombre,''))=any(array['Max','Rocco','Danna']::text[]) then 'perro'
    else null end
$$;

create or replace function public._momos_gramaje_figura_esperado(p_nombre text)
returns integer language sql immutable parallel safe
set search_path=pg_catalog,public,pg_temp as $$
  select case btrim(coalesce(p_nombre,''))
    when 'Lizi' then 150 when 'Momo' then 180 when 'Rocco' then 180
    when 'Teo' then 250 when 'Toby' then 280 when 'Danna' then 180
    when 'Max' then 180 else null end
$$;

create or replace function public._momos_tipo_producto_esperado(p_categoria text)
returns text language sql immutable parallel safe
set search_path=pg_catalog,public,pg_temp as $$
  select case btrim(coalesce(p_categoria,''))
    when 'Momos Signature' then 'momo'
    when 'Cajas y Combos' then 'combo'
    else 'pedido' end
$$;

-- Impide descartar stock o esconder trabajo vivo durante una reclasificación.
-- Los snapshots terminales e históricos nunca se reescriben.
create or replace function public._momos_assert_product_reclassification_safe(
  p_product_id text,
  p_will_drop_stock boolean default false
)
returns void language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_product public.products%rowtype;
begin
  select * into v_product from public.products where id=p_product_id for update;
  if v_product.id is null then raise exception 'Producto % inexistente.',p_product_id; end if;
  if p_will_drop_stock and coalesce(v_product.stock,0)<>0 then
    raise exception 'El producto % conserva stock agregado (%). Conciliá el inventario antes de reclasificarlo.',p_product_id,v_product.stock;
  end if;
  if exists(select 1 from public.production_batches b
    where b.product_id=p_product_id and b.estado in ('En preparación','Congelando','Listo','Reservado')) then
    raise exception 'El producto % tiene lotes vivos o vendibles. Cerrá o conciliá esos lotes antes de reclasificarlo.',p_product_id;
  end if;
  if exists(select 1 from public.production_suggestions s
    where s.product_id=p_product_id and s.estado='Pendiente') then
    raise exception 'El producto % tiene sugerencias de producción pendientes. Resolvelas antes de reclasificarlo.',p_product_id;
  end if;
  if exists(select 1 from public.inventory_reservations r
    where r.product_id=p_product_id and r.estado in ('Reservada','Temporal')) then
    raise exception 'El producto % tiene reservas vigentes. Liberalas o consumilas antes de reclasificarlo.',p_product_id;
  end if;
end $$;

-- Las figuras no canónicas se conservan como historia, pero no pueden
-- desaparecer del panel mientras exista un lote activo que todavía las use.
do $$
begin
  if exists(
    select 1 from public.production_batches b
    where b.estado in ('En preparación','Congelando','Listo','Reservado') and (
      (btrim(coalesce(b.figura,''))<>'' and not public._momos_es_figura_canonica(b.figura))
      or exists(
        select 1
        from jsonb_array_elements(case when jsonb_typeof(b.figuras)='array' then b.figuras else '[]'::jsonb end) x
        where not public._momos_es_figura_canonica(x->>'figura')
      )
    )
  ) then
    raise exception 'Hay lotes vivos con figuras retiradas. Cerrá o conciliá esos lotes antes de aplicar H90.';
  end if;
end $$;

-- PR08 era el origen transversal de la confusión: es cuchareable al momento,
-- nunca inventario de figura. Si aún tiene stock/producción/reserva, H90 falla
-- antes de tocarlo para no borrar una obligación operativa.
do $$
begin
  perform public._momos_assert_product_reclassification_safe('PR08',true);
end $$;

-- Una presentación Signature sin figura (PR03 y equivalentes) queda en
-- cuarentena, fuera del menú. Los pedidos históricos conservan su snapshot.
do $$
declare v_product_id text;
begin
  for v_product_id in
    select p.id from public.products p
    where p.cat='Momos Signature' and p.activo
      and p.id<>all(array['PR01','PR02','PR04']::text[])
  loop
    perform public._momos_assert_product_reclassification_safe(v_product_id,false);
  end loop;
end $$;

-- Cualquier fila que vaya a perder la semántica de stock debe llegar sin
-- unidades vivas. Un cero legado se convierte de forma segura en NULL.
do $$
declare v_product_id text;
begin
  for v_product_id in
    select p.id from public.products p
    where p.cat not in ('Momos Signature','Cajas y Combos')
      and (p.tipo<>'pedido' or p.especie is not null or p.stock is not null)
  loop
    perform public._momos_assert_product_reclassification_safe(v_product_id,true);
  end loop;
  if exists(select 1 from public.products p
    where p.cat='Cajas y Combos' and (coalesce(p.combo_size,0)<=0 or p.empaque_item_id is null)) then
    raise exception 'Existe una caja sin tamaño o empaque; corregila antes de aplicar H90.';
  end if;
  if exists(select 1 from public.products p
    where p.cat='Momos Signature' and p.id<>all(array['PR01','PR02','PR04']::text[])
      and (p.especie is null or p.especie not in ('gato','perro'))) then
    raise exception 'Existe una presentación Signature sin especie visual válida.';
  end if;
end $$;

-- Normalización de datos actuales. No toca order_items, lotes ni auditoría.
update public.products set
  nombre=case id when 'PR01' then 'Momo Gatito' when 'PR02' then 'Momo Perrito' else 'Momo premium' end,
  cat='Momos Signature',tipo='momo',
  especie=case id when 'PR02' then 'perro' else 'gato' end,
  combo_size=null,empaque_item_id=null
where id in ('PR01','PR02','PR04');

update public.products set
  nombre='Cheesecake Momo cuchareable',cat='Momos Cuchara',tipo='pedido',
  especie=null,stock=null,combo_size=null,empaque_item_id=null,
  descr='Cheesecake en vaso preparado al momento, con sabor y salsa a elección.'
where id='PR08';

update public.products p set activo=false
where p.cat='Momos Signature' and p.activo
  and p.id<>all(array['PR01','PR02','PR04']::text[]);

update public.products set
  tipo=public._momos_tipo_producto_esperado(cat),
  especie=case when cat='Momos Signature' then especie else null end,
  stock=case when cat='Momos Signature' then stock else null end,
  combo_size=case when cat='Cajas y Combos' then combo_size else null end,
  empaque_item_id=case when cat='Cajas y Combos' then empaque_item_id else null end;

-- Se conserva la fila de una figura retirada, pero se elimina cualquier enlace
-- catalogal engañoso hacia un producto que no sea Signature.
update public.figuras f set product_id=null
where not f.activo and f.product_id is not null
  and not exists(select 1 from public.products p
    where p.id=f.product_id and p.cat='Momos Signature' and p.tipo='momo');

insert into public.figuras(nombre,especie,gramaje_g,product_id,orden,activo)
values
  ('Lizi','gato',150,'PR01',0,true),
  ('Momo','gato',180,'PR01',1,true),
  ('Rocco','perro',180,'PR02',2,true),
  ('Teo','gato',250,'PR04',3,true),
  ('Toby','gato',280,'PR01',4,true),
  ('Danna','perro',180,'PR02',5,true),
  ('Max','perro',180,'PR02',6,true)
on conflict(nombre) do update set
  especie=excluded.especie,gramaje_g=excluded.gramaje_g,
  product_id=excluded.product_id,orden=excluded.orden,activo=true;

update public.figuras set activo=false
where activo and not public._momos_es_figura_canonica(nombre)
  and not public._momos_es_figura_auxiliar(nombre);

-- Horizontal no es una figura Signature ni una opción del pedido. Es una
-- decoración compartida y solo permanece visible mientras exista al menos un
-- producto compatible activo.
update public.figuras set product_id=null,activo=public._momos_horizontal_requerida()
where nombre='Horizontal';

update public.figuras f set product_id=null
where not f.activo and f.product_id is not null
  and not exists(select 1 from public.products p
    where p.id=f.product_id and p.cat='Momos Signature' and p.tipo='momo');

-- Defensa estructural: la categoría define el tipo; solo Signature admite
-- especie/stock y solo Cajas y Combos admite datos de combo.
alter table public.products drop constraint if exists products_dominio_canonico;
alter table public.products add constraint products_dominio_canonico check(
  (cat='Momos Signature' and tipo='momo' and especie in ('gato','perro')
    and combo_size is null and empaque_item_id is null)
  or
  (cat='Cajas y Combos' and tipo='combo' and especie is null and stock is null
    and combo_size>0 and empaque_item_id is not null)
  or
  (cat not in ('Momos Signature','Cajas y Combos') and tipo='pedido'
    and especie is null and stock is null and combo_size is null and empaque_item_id is null)
) not valid;
alter table public.products validate constraint products_dominio_canonico;

create or replace function public._momos_guard_producto_canonico()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_expected text;
begin
  v_expected:=public._momos_tipo_producto_esperado(new.cat);
  if new.tipo<>v_expected then
    raise exception 'La categoría % exige tipo %; no se puede guardar como %.',new.cat,v_expected,new.tipo;
  end if;
  if new.cat='Momos Signature' then
    if new.especie not in ('gato','perro') then raise exception 'Una presentación Signature necesita especie visual.'; end if;
  elsif new.especie is not null or new.stock is not null then
    raise exception '% se prepara/vende sin figura: no admite especie ni stock terminado.',new.nombre;
  end if;
  if new.id='PR08' and (
    new.cat<>'Momos Cuchara' or new.tipo<>'pedido' or new.especie is not null
    or new.stock is not null or new.combo_size is not null or new.empaque_item_id is not null
  ) then
    raise exception 'PR08 es un cuchareable al momento: no admite figura, especie ni stock terminado.';
  end if;
  return new;
end $$;

drop trigger if exists a00_momos_products_canonical_guard on public.products;
create trigger a00_momos_products_canonical_guard
before insert or update of cat,tipo,especie,stock,combo_size,empaque_item_id
on public.products for each row execute function public._momos_guard_producto_canonico();

create or replace function public._momos_guard_figura_canonica()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_product public.products%rowtype;
begin
  if public._momos_es_figura_auxiliar(new.nombre) then
    if new.product_id is not null then
      raise exception 'Horizontal es una figura auxiliar compartida y no puede enlazar una presentación comercial.';
    end if;
    -- Configuración guarda en bloque las siete figuras físicas. Horizontal no
    -- forma parte de ese payload: su estado siempre se deriva de los productos.
    new.activo:=public._momos_horizontal_requerida();
    return new;
  end if;
  if new.product_id='PR08' then
    raise exception 'PR08 es cuchareable y jamás puede ser la presentación de una figura.';
  end if;
  if new.product_id is not null then
    select * into v_product from public.products where id=new.product_id;
    if v_product.id is null or v_product.tipo<>'momo' or v_product.cat<>'Momos Signature'
       or v_product.especie<>new.especie then
      raise exception 'La figura % solo puede enlazar una presentación Momos Signature de su misma especie.',new.nombre;
    end if;
  end if;
  if not new.activo then return new; end if;
  if not public._momos_es_figura_canonica(new.nombre) then
    raise exception '% no es una figura física de MOMOS. Usá Lizi, Momo, Rocco, Teo, Toby, Danna o Max.',new.nombre;
  end if;
  if new.especie is distinct from public._momos_especie_figura_esperada(new.nombre)
     or new.gramaje_g is distinct from public._momos_gramaje_figura_esperado(new.nombre)
     or new.product_id is distinct from public._momos_producto_figura_esperado(new.nombre)
     or not v_product.activo then
    raise exception 'La ficha activa de % no coincide con especie, gramaje o presentación canónica.',new.nombre;
  end if;
  return new;
end $$;

drop trigger if exists momos_figuras_canonical_guard on public.figuras;
create trigger momos_figuras_canonical_guard
before insert or update of nombre,especie,gramaje_g,product_id,activo on public.figuras
for each row execute function public._momos_guard_figura_canonica();

create or replace function public._momos_sincronizar_horizontal()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  update public.figuras
  set product_id=null,activo=public._momos_horizontal_requerida()
  where nombre='Horizontal'
    and (product_id is not null or activo is distinct from public._momos_horizontal_requerida());
  return null;
end $$;

drop trigger if exists momos_products_horizontal_visibility on public.products;
create trigger momos_products_horizontal_visibility
after insert or update of nombre,familia,ruta_id,activo on public.products
for each statement execute function public._momos_sincronizar_horizontal();

drop trigger if exists momos_products_horizontal_visibility_delete on public.products;
create trigger momos_products_horizontal_visibility_delete
after delete on public.products
for each statement execute function public._momos_sincronizar_horizontal();

-- Invariante diferida: permite que guardar_configuracion_v1 desactive y vuelva
-- a activar las siete filas dentro de la misma transacción, pero nunca confirma
-- una configuración parcial, una familia sin figura o una figura sin familia.
create or replace function public._momos_assert_dominio_canonico()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if (select count(*) from public.figuras f where f.activo and public._momos_es_figura_canonica(f.nombre))<>7
     or exists(select 1 from public.figuras f where f.activo and public._momos_es_figura_canonica(f.nombre) and (
       not public._momos_es_figura_canonica(f.nombre)
       or f.especie is distinct from public._momos_especie_figura_esperada(f.nombre)
       or f.gramaje_g is distinct from public._momos_gramaje_figura_esperado(f.nombre)
       or f.product_id is distinct from public._momos_producto_figura_esperado(f.nombre)
     )) then
    raise exception 'El catálogo debe conservar exactamente las siete figuras canónicas con su gramaje y presentación.';
  end if;
  if exists(select 1 from public.figuras f where f.activo
      and not public._momos_es_figura_canonica(f.nombre)
      and not public._momos_es_figura_auxiliar(f.nombre))
     or exists(select 1 from public.figuras f
      where public._momos_es_figura_auxiliar(f.nombre)
        and (f.product_id is not null
          or f.activo is distinct from public._momos_horizontal_requerida())) then
    raise exception 'El catálogo contiene una figura auxiliar visible sin un producto compatible activo.';
  end if;
  if exists(select 1 from public.figuras f join public.products p on p.id=f.product_id
    where f.activo and (not p.activo or p.cat<>'Momos Signature' or p.tipo<>'momo' or p.especie<>f.especie)) then
    raise exception 'Una figura activa perdió su presentación Signature compatible.';
  end if;
  if exists(select 1 from public.products p
    where p.activo and p.cat='Momos Signature'
      and not exists(select 1 from public.figuras f where f.activo and f.product_id=p.id)) then
    raise exception 'Una presentación Signature activa no puede quedar sin figura física.';
  end if;
  if exists(select 1 from public.figuras where product_id='PR08') then
    raise exception 'PR08 es cuchareable y no puede estar ligado a ninguna figura.';
  end if;
  return null;
end $$;

drop trigger if exists momos_products_domain_invariant on public.products;
create constraint trigger momos_products_domain_invariant
after insert or update or delete on public.products
deferrable initially deferred for each row
execute function public._momos_assert_dominio_canonico();

drop trigger if exists momos_figures_domain_invariant on public.figuras;
create constraint trigger momos_figures_domain_invariant
after insert or update or delete on public.figuras
deferrable initially deferred for each row
execute function public._momos_assert_dominio_canonico();

do $$
begin
  if exists(
    select 1 from public.combo_components cc
    left join public.products c on c.id=cc.combo_id
    left join public.products p on p.id=cc.component_id
    where c.id is null or c.cat<>'Cajas y Combos' or c.tipo<>'combo'
       or p.id is null or not p.activo or p.cat<>'Momos Signature' or p.tipo<>'momo'
       or not exists(select 1 from public.figuras f where f.activo and f.product_id=p.id)
  ) then
    raise exception 'Hay componentes de caja que no corresponden a presentaciones Signature con figura activa.';
  end if;
end $$;

create or replace function public._momos_guard_componente_caja()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_combo public.products%rowtype; v_component public.products%rowtype;
begin
  select * into v_combo from public.products where id=new.combo_id;
  select * into v_component from public.products where id=new.component_id;
  if v_combo.id is null or not v_combo.activo or v_combo.tipo<>'combo' or v_combo.cat<>'Cajas y Combos' then
    raise exception 'La relación de caja necesita una presentación Cajas y Combos activa.';
  end if;
  if v_component.id is null or not v_component.activo or v_component.tipo<>'momo'
     or v_component.cat<>'Momos Signature'
     or not exists(select 1 from public.figuras f
       where f.activo and f.product_id=v_component.id and public._momos_es_figura_canonica(f.nombre)) then
    raise exception 'Una caja solo admite presentaciones Signature ligadas a figuras físicas activas.';
  end if;
  return new;
end $$;

drop trigger if exists momos_combo_component_canonical_guard on public.combo_components;
create trigger momos_combo_component_canonical_guard
before insert or update of combo_id,component_id on public.combo_components
for each row execute function public._momos_guard_componente_caja();

create or replace function public._momos_guard_linea_pedido_canonica()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_product public.products%rowtype;
  v_exact_product public.products%rowtype;
  v_figure public.figuras%rowtype;
  v_parent public.order_items%rowtype;
begin
  select * into v_product from public.products where id=new.product_id;
  if v_product.id is null then raise exception 'La línea referencia un producto inexistente.'; end if;
  if not v_product.activo then
    if tg_op='INSERT' then
      raise exception 'La presentación % está fuera del menú.',v_product.nombre;
    elsif old.product_id is distinct from new.product_id then
      raise exception 'La presentación % está fuera del menú.',v_product.nombre;
    end if;
  end if;

  new.figura:=btrim(coalesce(new.figura,''));
  new.sabor:=btrim(coalesce(new.sabor,''));

  if new.es_caja then
    if v_product.tipo<>'combo' or new.es_sub_momo or new.parent_item_id is not null then
      raise exception 'La caja padre debe usar un combo y no puede ser una figura hija.';
    end if;
    if new.figura<>'' or new.sabor<>'' then
      raise exception 'La caja padre es una presentación; figura y sabor pertenecen a cada postre hijo.';
    end if;
    new.nombre:=v_product.nombre;
    return new;
  end if;

  if v_product.tipo='combo' then
    raise exception 'Un combo debe registrarse como caja padre con figuras hijas exactas.';
  end if;

  if new.es_sub_momo then
    if new.parent_item_id is null or coalesce(new.caja_num,0)<1 then
      raise exception 'La figura de una caja necesita padre y número de caja.';
    end if;
    select * into v_parent from public.order_items where id=new.parent_item_id;
    if v_parent.id is null or v_parent.order_id<>new.order_id or not v_parent.es_caja then
      raise exception 'La figura hija no pertenece a una caja padre del mismo pedido.';
    end if;
    if new.figura='' or new.sabor='' then
      raise exception 'Cada postre de la caja necesita figura y sabor exactos.';
    end if;
    select * into v_figure from public.figuras
    where nombre=new.figura and activo and public._momos_es_figura_canonica(nombre);
    if v_figure.nombre is null or v_figure.product_id is null then
      raise exception 'La figura % no existe o no tiene presentación comercial activa.',new.figura;
    end if;
    if not exists(select 1 from public.combo_components cc
      where cc.combo_id=v_parent.product_id and cc.component_id=v_figure.product_id) then
      raise exception 'La caja % no admite la presentación exacta de la figura %.',v_parent.nombre,new.figura;
    end if;
    select * into v_exact_product from public.products
    where id=v_figure.product_id and activo and tipo='momo' and cat='Momos Signature';
    if v_exact_product.id is null then raise exception 'La figura % perdió su presentación activa.',new.figura; end if;
    -- Corrige el bug legado que elegía por especie: la relación exacta es
    -- figuras.product_id y especie no participa en la decisión.
    new.product_id:=v_exact_product.id;
    new.nombre:=v_exact_product.nombre;
    return new;
  end if;

  if new.parent_item_id is not null then raise exception 'Una línea simple no puede colgar de una caja.'; end if;

  if v_product.cat='Momos Signature' then
    if new.figura='' or new.sabor='' then
      raise exception 'La presentación % necesita figura y sabor exactos.',v_product.nombre;
    end if;
    select * into v_figure from public.figuras
    where nombre=new.figura and activo and public._momos_es_figura_canonica(nombre);
    if v_figure.nombre is null or v_figure.product_id is distinct from v_product.id then
      raise exception 'La figura % no corresponde a la presentación %.',new.figura,v_product.nombre;
    end if;
    new.nombre:=v_product.nombre;
  elsif new.figura<>'' then
    raise exception '% se prepara al momento y no admite una figura física.',v_product.nombre;
  end if;
  return new;
end $$;

-- El prefijo a00 ejecuta la normalización exacta antes de guards históricos.
drop trigger if exists a00_momos_order_item_canonical_guard on public.order_items;
drop trigger if exists momos_order_item_canonical_guard on public.order_items;
create trigger a00_momos_order_item_canonical_guard
before insert or update of order_id,product_id,nombre,sabor,figura,es_caja,es_sub_momo,parent_item_id,caja_num
on public.order_items for each row execute function public._momos_guard_linea_pedido_canonica();

-- Auditoría compacta: no expone cliente, dirección, notas, actor ni precios.
create or replace function public.auditar_dominio_productos_figuras_v1()
returns jsonb language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
  select jsonb_build_object(
    'contract','momos.domain-integrity.v1','version',1,
    'canonical_figures',(select count(*) from public.figuras f where f.activo and public._momos_es_figura_canonica(f.nombre)),
    'active_auxiliary_figures',(select count(*) from public.figuras f where f.activo and public._momos_es_figura_auxiliar(f.nombre)),
    'active_noncanonical_figures',(select count(*) from public.figuras f where f.activo
      and not public._momos_es_figura_canonica(f.nombre) and not public._momos_es_figura_auxiliar(f.nombre)),
    'invalid_auxiliary_figures',(select count(*) from public.figuras f where f.activo
      and public._momos_es_figura_auxiliar(f.nombre)
      and (f.product_id is not null or not public._momos_horizontal_requerida())),
    'invalid_product_classifications',(select count(*) from public.products p where p.tipo<>public._momos_tipo_producto_esperado(p.cat)
      or (p.cat<>'Momos Signature' and (p.especie is not null or p.stock is not null))),
    'invalid_figure_mappings',(select count(*) from public.figuras f where f.activo
      and public._momos_es_figura_canonica(f.nombre) and (
      f.product_id is distinct from public._momos_producto_figura_esperado(f.nombre)
      or f.especie is distinct from public._momos_especie_figura_esperada(f.nombre)
      or f.gramaje_g is distinct from public._momos_gramaje_figura_esperado(f.nombre))),
    'unmapped_signature_presentations',(select count(*) from public.products p
      where p.activo and p.tipo='momo' and p.cat='Momos Signature'
        and not exists(select 1 from public.figuras f where f.activo and f.product_id=p.id)),
    'invalid_combo_components',(select count(*) from public.combo_components cc
      left join public.products c on c.id=cc.combo_id left join public.products p on p.id=cc.component_id
      where c.id is null or c.tipo<>'combo' or c.cat<>'Cajas y Combos'
        or p.id is null or p.tipo<>'momo' or p.cat<>'Momos Signature' or not p.activo
        or not exists(select 1 from public.figuras f where f.activo and f.product_id=p.id)),
    'invalid_historical_order_lines',(select count(*) from public.order_items oi
      join public.products p on p.id=oi.product_id
      left join public.figuras f on f.nombre=oi.figura and f.activo
      left join public.order_items parent on parent.id=oi.parent_item_id
      where not oi.es_caja and (
        (p.cat='Momos Signature' and (btrim(coalesce(oi.figura,''))='' or btrim(coalesce(oi.sabor,''))=''
          or f.nombre is null or f.product_id is distinct from oi.product_id))
        or (p.cat<>'Momos Signature' and btrim(coalesce(oi.figura,''))<>'')
        or (oi.es_sub_momo and (parent.id is null or not parent.es_caja or parent.order_id<>oi.order_id
          or not exists(select 1 from public.combo_components cc
            where cc.combo_id=parent.product_id and cc.component_id=oi.product_id)))
      )),
    'contains_customer_pii',false,'contains_free_text',false,'external_execution',false
  )
$$;

create or replace function public.dominio_productos_figuras_canonico_disponible()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
  select exists(select 1 from public.momos_ops_migrations where id='20260720_90_dominio_productos_figuras')
$$;

revoke all on function public._momos_es_figura_canonica(text) from public,anon,authenticated,service_role;
revoke all on function public._momos_es_figura_auxiliar(text) from public,anon,authenticated,service_role;
revoke all on function public._momos_producto_usa_horizontal(text,text,text) from public,anon,authenticated,service_role;
revoke all on function public._momos_horizontal_requerida() from public,anon,authenticated,service_role;
revoke all on function public._momos_producto_figura_esperado(text) from public,anon,authenticated,service_role;
revoke all on function public._momos_especie_figura_esperada(text) from public,anon,authenticated,service_role;
revoke all on function public._momos_gramaje_figura_esperado(text) from public,anon,authenticated,service_role;
revoke all on function public._momos_tipo_producto_esperado(text) from public,anon,authenticated,service_role;
revoke all on function public._momos_assert_product_reclassification_safe(text,boolean) from public,anon,authenticated,service_role;
revoke all on function public._momos_guard_producto_canonico() from public,anon,authenticated,service_role;
revoke all on function public._momos_guard_figura_canonica() from public,anon,authenticated,service_role;
revoke all on function public._momos_sincronizar_horizontal() from public,anon,authenticated,service_role;
revoke all on function public._momos_assert_dominio_canonico() from public,anon,authenticated,service_role;
revoke all on function public._momos_guard_componente_caja() from public,anon,authenticated,service_role;
revoke all on function public._momos_guard_linea_pedido_canonica() from public,anon,authenticated,service_role;
revoke all on function public.auditar_dominio_productos_figuras_v1() from public,anon,authenticated,service_role;
revoke all on function public.dominio_productos_figuras_canonico_disponible() from public,anon,authenticated,service_role;
grant execute on function public.auditar_dominio_productos_figuras_v1() to authenticated;
grant execute on function public.dominio_productos_figuras_canonico_disponible() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260720_90_dominio_productos_figuras',
  'Categoría y tipo sellados; siete figuras exactas; Horizontal auxiliar condicional; cajas resueltas por figuras.product_id')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260720_90_dominio_productos_figuras';
