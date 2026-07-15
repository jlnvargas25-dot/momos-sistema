-- MOMOS OPS · Productos y recetas como fuente oficial del servidor.
-- Paso 13, después de inventario-lotes-v1.sql.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists (select 1 from public.momos_ops_migrations where id = '20260714_12_inventario_lotes') then
    raise exception 'Falta el paso 12_inventario_lotes.';
  end if;
  if to_regprocedure('public.next_id(text,text,integer)') is null
     or to_regprocedure('public._add_audit(text,text,text,text,text)') is null then
    raise exception 'Faltan los helpers base de Momo Ops.';
  end if;
end $$;

-- Los nombres son identidad comercial: no permitimos duplicados por mayúsculas.
create unique index if not exists products_nombre_ci_uq
  on public.products(lower(btrim(nombre)));

-- Una receta solo puede contener una vez el mismo insumo.
create unique index if not exists recipes_product_item_uq
  on public.recipes(product_id,item_id);

alter table public.products drop constraint if exists products_precio_valido;
alter table public.products add constraint products_precio_valido check (precio > 0);
alter table public.products drop constraint if exists products_costo_valido;
alter table public.products add constraint products_costo_valido check (costo >= 0);
alter table public.products drop constraint if exists products_prep_valido;
alter table public.products add constraint products_prep_valido check (prep >= 0);
alter table public.recipes drop constraint if exists recipes_cantidad_valida;
alter table public.recipes add constraint recipes_cantidad_valida check (cantidad > 0);

create or replace function public.productos_servidor_disponible() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.momos_ops_migrations where id='20260714_13_productos_servidor'
  )
$$;

create or replace function public._validar_componentes_producto(
  p_tipo text,
  p_combo_size integer,
  p_empaque_item_id text,
  p_componentes jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v_component text;
begin
  if p_tipo <> 'combo' then return; end if;
  if p_combo_size is null or p_combo_size <= 0 then
    raise exception 'El combo necesita un tamaño mayor que cero.';
  end if;
  if p_empaque_item_id is null or not exists (
    select 1 from public.inventory_items where id=p_empaque_item_id and cat='Cajas'
  ) then
    raise exception 'El empaque del combo debe ser un insumo activo de categoría Cajas.';
  end if;
  if p_componentes is null or jsonb_typeof(p_componentes) <> 'array'
     or jsonb_array_length(p_componentes)=0 then
    raise exception 'El combo necesita al menos un momo componente.';
  end if;
  if (select count(*) from jsonb_array_elements_text(p_componentes)) <>
     (select count(distinct value) from jsonb_array_elements_text(p_componentes)) then
    raise exception 'El combo contiene componentes repetidos.';
  end if;
  for v_component in select value from jsonb_array_elements_text(p_componentes) loop
    if not exists (
      select 1 from public.products
      where id=v_component and tipo='momo' and activo
    ) then
      raise exception 'El componente % no existe, no es un momo o está inactivo.', v_component;
    end if;
  end loop;
end;
$$;

create or replace function public.crear_producto(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_nombre text := btrim(coalesce(p->>'nombre',''));
  v_cat text := btrim(coalesce(p->>'cat',''));
  v_tipo text := btrim(coalesce(p->>'tipo',''));
  v_especie text := nullif(btrim(coalesce(p->>'especie','')),'');
  v_precio numeric := coalesce((p->>'precio')::numeric,0);
  v_precio_rappi numeric := nullif(p->>'precio_rappi','')::numeric;
  v_costo numeric := coalesce((p->>'costo')::numeric,0);
  v_prep integer := coalesce((p->>'prep')::integer,0);
  v_frio boolean := coalesce((p->>'frio')::boolean,true);
  v_lejano boolean := coalesce((p->>'lejano')::boolean,false);
  v_descr text := btrim(coalesce(p->>'descr',''));
  v_combo_size integer := nullif(p->>'combo_size','')::integer;
  v_empaque text := nullif(btrim(coalesce(p->>'empaque_item_id','')),'');
  v_componentes jsonb := coalesce(p->'component_product_ids','[]'::jsonb);
  v_colchon integer := coalesce(nullif(p->>'colchon_produccion','')::integer,0);
  v_component text;
begin
  if not public.is_admin() then raise exception 'Solo Administrador puede crear productos.'; end if;
  if v_nombre='' then raise exception 'Falta el nombre del producto.'; end if;
  if v_tipo not in ('momo','combo','pedido') then raise exception 'Tipo de producto inválido.'; end if;
  if not exists(select 1 from public.product_cats where nombre=v_cat and activo) then
    raise exception 'La categoría % no existe o está inactiva.',v_cat;
  end if;
  if v_precio<=0 or v_costo<0 or v_prep<0 or v_colchon<0 then raise exception 'Precio, costo, preparación o colchón inválidos.'; end if;
  if v_tipo='momo' and v_especie not in ('gato','perro') then raise exception 'Un momo debe indicar especie gato o perro.'; end if;
  if v_tipo<>'momo' then v_especie:=null; end if;
  if v_precio_rappi is null or v_precio_rappi<=0 then v_precio_rappi:=round(v_precio*1.25); end if;
  perform public._validar_componentes_producto(v_tipo,v_combo_size,v_empaque,v_componentes);

  v_id:=public.next_id('product','PR',2);
  insert into public.products(
    id,nombre,cat,tipo,especie,precio,precio_rappi,costo,stock,prep,frio,lejano,
    activo,descr,combo_size,empaque_item_id,colchon_produccion
  ) values (
    v_id,v_nombre,v_cat,v_tipo,v_especie,v_precio,v_precio_rappi,v_costo,
    case when v_tipo='momo' then 0 else null end,v_prep,v_frio,v_lejano,
    true,v_descr,case when v_tipo='combo' then v_combo_size end,
    case when v_tipo='combo' then v_empaque end,case when v_tipo='momo' then v_colchon else 0 end
  );
  if v_tipo='combo' then
    for v_component in select value from jsonb_array_elements_text(v_componentes) loop
      insert into public.combo_components(combo_id,component_id) values(v_id,v_component);
    end loop;
  end if;
  perform public._add_audit('Producto',v_id,'Producto creado','',v_nombre);
  return jsonb_build_object('ok',true,'product_id',v_id);
exception when unique_violation then
  raise exception 'Ya existe un producto con ese nombre o configuración.';
end;
$$;

create or replace function public.editar_producto(p_id text,p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.products%rowtype;
  v_nombre text := btrim(coalesce(p->>'nombre',''));
  v_cat text := btrim(coalesce(p->>'cat',''));
  v_tipo text := btrim(coalesce(p->>'tipo',''));
  v_especie text := nullif(btrim(coalesce(p->>'especie','')),'');
  v_precio numeric := coalesce((p->>'precio')::numeric,0);
  v_precio_rappi numeric := nullif(p->>'precio_rappi','')::numeric;
  v_costo numeric := coalesce((p->>'costo')::numeric,0);
  v_prep integer := coalesce((p->>'prep')::integer,0);
  v_frio boolean := coalesce((p->>'frio')::boolean,true);
  v_lejano boolean := coalesce((p->>'lejano')::boolean,false);
  v_descr text := btrim(coalesce(p->>'descr',''));
  v_combo_size integer := nullif(p->>'combo_size','')::integer;
  v_empaque text := nullif(btrim(coalesce(p->>'empaque_item_id','')),'');
  v_componentes jsonb := coalesce(p->'component_product_ids','[]'::jsonb);
  v_colchon integer := coalesce(nullif(p->>'colchon_produccion','')::integer,0);
  v_component text;
begin
  if not public.is_admin() then raise exception 'Solo Administrador puede editar productos.'; end if;
  select * into v from public.products where id=p_id for update;
  if v.id is null then raise exception 'El producto % no existe.',p_id; end if;
  if v_tipo<>v.tipo then raise exception 'El tipo del producto es inmutable.'; end if;
  if v_nombre='' then raise exception 'Falta el nombre del producto.'; end if;
  if not exists(select 1 from public.product_cats where nombre=v_cat and activo) then
    raise exception 'La categoría % no existe o está inactiva.',v_cat;
  end if;
  if v_precio<=0 or v_costo<0 or v_prep<0 or v_colchon<0 then raise exception 'Precio, costo, preparación o colchón inválidos.'; end if;
  if v.tipo='momo' and v_especie not in ('gato','perro') then raise exception 'Un momo debe indicar especie gato o perro.'; end if;
  if v.tipo<>'momo' then v_especie:=null; end if;
  if v_precio_rappi is null or v_precio_rappi<=0 then v_precio_rappi:=round(v_precio*1.25); end if;
  perform public._validar_componentes_producto(v.tipo,v_combo_size,v_empaque,v_componentes);

  update public.products set
    nombre=v_nombre,cat=v_cat,especie=v_especie,precio=v_precio,
    precio_rappi=v_precio_rappi,costo=v_costo,prep=v_prep,frio=v_frio,
    lejano=v_lejano,descr=v_descr,
    colchon_produccion=case when v.tipo='momo' then v_colchon else 0 end,
    combo_size=case when v.tipo='combo' then v_combo_size end,
    empaque_item_id=case when v.tipo='combo' then v_empaque end
  where id=p_id;
  if v.tipo='combo' then
    delete from public.combo_components where combo_id=p_id;
    for v_component in select value from jsonb_array_elements_text(v_componentes) loop
      insert into public.combo_components(combo_id,component_id) values(p_id,v_component);
    end loop;
  end if;
  perform public._add_audit('Producto',p_id,'Producto editado',v.nombre,v_nombre);
  return jsonb_build_object('ok',true,'product_id',p_id);
exception when unique_violation then
  raise exception 'Ya existe un producto con ese nombre o configuración.';
end;
$$;

create or replace function public.set_producto_activo(p_id text,p_activo boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.products%rowtype;
begin
  if not public.is_admin() then raise exception 'Solo Administrador puede activar o desactivar productos.'; end if;
  if p_activo is null then raise exception 'El estado activo es obligatorio.'; end if;
  select * into v from public.products where id=p_id for update;
  if v.id is null then raise exception 'El producto % no existe.',p_id; end if;
  if v.activo=p_activo then return jsonb_build_object('ok',true,'activo',p_activo,'sin_cambio',true); end if;
  if not p_activo and exists(
    select 1 from public.combo_components cc join public.products c on c.id=cc.combo_id
    where cc.component_id=p_id and c.activo
  ) then
    raise exception 'No se puede desactivar: forma parte de un combo activo.';
  end if;
  update public.products set activo=p_activo where id=p_id;
  perform public._add_audit('Producto',p_id,case when p_activo then 'Activado en menú' else 'Desactivado del menú' end,
    case when v.activo then 'Activo' else 'Inactivo' end,case when p_activo then 'Activo' else 'Inactivo' end);
  return jsonb_build_object('ok',true,'activo',p_activo);
end;
$$;

create or replace function public.guardar_receta_producto(p_product_id text,p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_linea jsonb; v_item text; v_cantidad numeric; v_count integer:=0;
begin
  if not public.is_admin() then raise exception 'Solo Administrador puede modificar recetas.'; end if;
  perform 1 from public.products where id=p_product_id for update;
  if not found then raise exception 'El producto % no existe.',p_product_id; end if;
  if p_lineas is null or jsonb_typeof(p_lineas)<>'array' then raise exception 'La receta debe ser una lista.'; end if;
  if (select count(*) from jsonb_array_elements(p_lineas)) <>
     (select count(distinct x->>'item_id') from jsonb_array_elements(p_lineas) x) then
    raise exception 'La receta contiene insumos repetidos.';
  end if;
  for v_linea in select value from jsonb_array_elements(p_lineas) loop
    v_item:=nullif(btrim(coalesce(v_linea->>'item_id','')),'');
    v_cantidad:=nullif(v_linea->>'cantidad','')::numeric;
    if v_item is null or not exists(select 1 from public.inventory_items where id=v_item) then
      raise exception 'La receta contiene un insumo inexistente.';
    end if;
    if v_cantidad is null or v_cantidad<=0 then raise exception 'Todas las cantidades de receta deben ser mayores que cero.'; end if;
  end loop;
  delete from public.recipes where product_id=p_product_id;
  for v_linea in select value from jsonb_array_elements(p_lineas) loop
    insert into public.recipes(id,product_id,item_id,cantidad)
    values(public.next_id('recipe','RC',2),p_product_id,v_linea->>'item_id',(v_linea->>'cantidad')::numeric);
    v_count:=v_count+1;
  end loop;
  perform public._add_audit('Receta',p_product_id,'Receta reemplazada','',v_count || ' insumos');
  return jsonb_build_object('ok',true,'product_id',p_product_id,'lineas',v_count);
end;
$$;

create or replace function public.sincronizar_costo_producto(p_product_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.products%rowtype; v_costo numeric;
begin
  if not public.is_admin() then raise exception 'Solo Administrador puede sincronizar costos.'; end if;
  select * into v from public.products where id=p_product_id for update;
  if v.id is null then raise exception 'El producto % no existe.',p_product_id; end if;
  if not exists(select 1 from public.recipes where product_id=p_product_id) then raise exception 'El producto no tiene receta.'; end if;
  select round(sum(r.cantidad*i.costo)) into v_costo
  from public.recipes r join public.inventory_items i on i.id=r.item_id
  where r.product_id=p_product_id;
  update public.products set costo=v_costo where id=p_product_id;
  perform public._add_audit('Producto',p_product_id,'Costo actualizado desde receta',v.costo::text,v_costo::text);
  return jsonb_build_object('ok',true,'product_id',p_product_id,'costo',v_costo);
end;
$$;

-- Escritura exclusivamente por RPC. Las lecturas siguen disponibles para staff.
revoke insert,update,delete on public.products from authenticated;
revoke insert,update,delete on public.combo_components from authenticated;
revoke insert,update,delete on public.recipes from authenticated;
revoke all on function public._validar_componentes_producto(text,integer,text,jsonb) from public,anon,authenticated;
revoke all on function public.productos_servidor_disponible() from public,anon,authenticated;
revoke all on function public.crear_producto(jsonb) from public,anon,authenticated;
revoke all on function public.editar_producto(text,jsonb) from public,anon,authenticated;
revoke all on function public.set_producto_activo(text,boolean) from public,anon,authenticated;
revoke all on function public.guardar_receta_producto(text,jsonb) from public,anon,authenticated;
revoke all on function public.sincronizar_costo_producto(text) from public,anon,authenticated;
grant execute on function public.crear_producto(jsonb) to authenticated;
grant execute on function public.productos_servidor_disponible() to authenticated;
grant execute on function public.editar_producto(text,jsonb) to authenticated;
grant execute on function public.set_producto_activo(text,boolean) to authenticated;
grant execute on function public.guardar_receta_producto(text,jsonb) to authenticated;
grant execute on function public.sincronizar_costo_producto(text) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values ('20260714_13_productos_servidor','CRUD de productos, combos y recetas transaccional, auditado y protegido por RBAC')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260714_13_productos_servidor';
