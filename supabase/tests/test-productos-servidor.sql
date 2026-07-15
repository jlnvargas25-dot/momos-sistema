-- MOMOS OPS · prueba adversarial de Productos servidor v1. Siempre ROLLBACK.
begin;
select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare
  v_suffix text := pg_backend_pid()::text;
  v_cat text;
  v_combo_cat text;
  v_box text;
  v_item text;
  v_product text;
  v_combo text;
  v_result jsonb;
  v_failed boolean;
  v_recipe_count integer;
begin
  assert public.productos_servidor_disponible(),
    'Falta aplicar la migración 13.';
  select nombre into v_cat from public.product_cats where activo order by nombre limit 1;
  select nombre into v_combo_cat from public.product_cats where activo and nombre='Cajas y Combos' limit 1;
  v_combo_cat:=coalesce(v_combo_cat,v_cat);
  select id into v_box from public.inventory_items where cat='Cajas' order by id limit 1;
  select id into v_item from public.inventory_items order by id limit 1;
  assert v_cat is not null and v_box is not null and v_item is not null, 'Faltan catálogos base para la prueba.';

  v_result:=public.crear_producto(jsonb_build_object(
    'nombre','Producto adversarial '||v_suffix,'cat',v_cat,'tipo','momo','especie','gato',
    'precio',10000,'precio_rappi',12500,'costo',3000,'prep',10,'frio',true,'lejano',false,
    'descr','fixture rollback','colchon_produccion',2
  ));
  v_product:=v_result->>'product_id';
  assert exists(select 1 from public.products where id=v_product and stock=0 and colchon_produccion=2),
    'A1 crear producto no persistió todos los campos.';
  assert exists(select 1 from public.audit_logs where entidad='Producto' and entidad_id=v_product and accion='Producto creado'),
    'A2 falta auditoría de creación.';

  v_result:=public.guardar_receta_producto(v_product,jsonb_build_array(
    jsonb_build_object('item_id',v_item,'cantidad',0.25)
  ));
  assert (v_result->>'lineas')::integer=1, 'B1 la receta debe guardar una línea.';
  select count(*) into v_recipe_count from public.recipes where product_id=v_product;
  assert v_recipe_count=1, 'B2 la receta quedó duplicada o vacía.';

  v_failed:=false;
  begin
    perform public.guardar_receta_producto(v_product,jsonb_build_array(
      jsonb_build_object('item_id',v_item,'cantidad',0.1),
      jsonb_build_object('item_id',v_item,'cantidad',0.2)
    ));
  exception when others then v_failed:=true;
  end;
  assert v_failed, 'B3 una receta con insumo duplicado debe rechazarse.';
  assert (select count(*) from public.recipes where product_id=v_product)=1,
    'B4 el rechazo dañó la receta anterior.';

  v_result:=public.editar_producto(v_product,jsonb_build_object(
    'nombre','Producto adversarial editado '||v_suffix,'cat',v_cat,'tipo','momo','especie','perro',
    'precio',11000,'precio_rappi',14000,'costo',3200,'prep',12,'frio',true,'lejano',true,
    'descr','editado','colchon_produccion',3
  ));
  assert exists(select 1 from public.products where id=v_product and precio=11000 and especie='perro' and colchon_produccion=3),
    'C1 la edición transaccional no persistió.';

  v_result:=public.crear_producto(jsonb_build_object(
    'nombre','Combo adversarial '||v_suffix,'cat',v_combo_cat,'tipo','combo',
    'precio',30000,'costo',9000,'prep',5,'frio',true,'lejano',true,'descr','combo fixture',
    'combo_size',3,'empaque_item_id',v_box,'component_product_ids',jsonb_build_array(v_product)
  ));
  v_combo:=v_result->>'product_id';
  assert exists(select 1 from public.combo_components where combo_id=v_combo and component_id=v_product),
    'D1 el combo no guardó su componente exacto.';

  v_failed:=false;
  begin perform public.set_producto_activo(v_product,false);
  exception when others then v_failed:=true;
  end;
  assert v_failed and (select activo from public.products where id=v_product),
    'D2 no debe desactivar un componente de combo activo.';
  perform public.set_producto_activo(v_combo,false);
  perform public.set_producto_activo(v_product,false);
  assert not (select activo from public.products where id=v_product), 'D3 la desactivación ordenada falló.';

  v_failed:=false;
  begin
    perform public.editar_producto(v_product,jsonb_build_object(
      'nombre','Cambio tipo '||v_suffix,'cat',v_cat,'tipo','pedido','precio',1000,'costo',0,'prep',0
    ));
  exception when others then v_failed:=true;
  end;
  assert v_failed and (select tipo from public.products where id=v_product)='momo',
    'E1 el tipo inmutable pudo cambiarse.';

end $$;

-- Nueva sentencia: obliga a reevaluar las funciones STABLE con otra identidad.
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111113","role":"authenticated"}',true);

do $$
declare
  v_failed boolean:=false;
  v_cat text;
begin
  select nombre into v_cat from public.product_cats where activo order by nombre limit 1;
  begin
    perform public.crear_producto(jsonb_build_object(
      'nombre','No autorizado '||pg_backend_pid(),'cat',v_cat,'tipo','pedido','precio',1000,'costo',0
    ));
  exception when others then v_failed:=true;
  end;
  assert v_failed, 'F1 una cuenta no administradora pudo crear un producto.';
  assert not has_table_privilege('authenticated','public.products','INSERT'), 'F2 authenticated conserva INSERT directo en products.';
  assert not has_table_privilege('authenticated','public.products','UPDATE'), 'F3 authenticated conserva UPDATE directo en products.';
  assert not has_table_privilege('authenticated','public.recipes','UPDATE'), 'F4 authenticated conserva UPDATE directo en recipes.';
  assert has_function_privilege('authenticated','public.crear_producto(jsonb)','EXECUTE'), 'F5 falta grant de la RPC pública.';
  assert not has_function_privilege('authenticated','public._validar_componentes_producto(text,integer,text,jsonb)','EXECUTE'),
    'F6 el helper interno quedó expuesto.';
end $$;

select 'TESTS_OK — Productos servidor CRUD/recetas/RBAC PASS, rollback total' as resultado;
rollback;
