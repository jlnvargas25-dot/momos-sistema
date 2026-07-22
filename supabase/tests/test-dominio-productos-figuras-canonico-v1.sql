-- MOMOS OPS · prueba adversarial H90. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_dominio_productos_figuras_20260720'));

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260720_90_dominio_productos_figuras'),'Falta aplicar H90.';
  assert to_regprocedure('public.auditar_dominio_productos_figuras_v1()') is not null
    and to_regprocedure('public.dominio_productos_figuras_canonico_disponible()') is not null,
    'Falta el contrato público H90.';
  assert has_function_privilege('authenticated','public.auditar_dominio_productos_figuras_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.dominio_productos_figuras_canonico_disponible()','EXECUTE')
    and not has_function_privilege('anon','public.auditar_dominio_productos_figuras_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.auditar_dominio_productos_figuras_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_guard_producto_canonico()','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_assert_product_reclassification_safe(text,boolean)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_guard_linea_pedido_canonica()','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_guard_componente_caja()','EXECUTE'),
    'H90 perdió la frontera pública/privada.';
  assert exists(select 1 from pg_constraint where conname='products_dominio_canonico'
      and conrelid='public.products'::regclass and convalidated)
    and exists(select 1 from pg_trigger where tgname='a00_momos_products_canonical_guard'
      and tgrelid='public.products'::regclass and not tgisinternal and tgenabled='O')
    and exists(select 1 from pg_trigger where tgname='momos_figuras_canonical_guard'
      and tgrelid='public.figuras'::regclass and not tgisinternal and tgenabled='O')
    and exists(select 1 from pg_trigger where tgname='momos_products_domain_invariant'
      and tgrelid='public.products'::regclass and not tgisinternal and tgenabled='O')
    and exists(select 1 from pg_trigger where tgname='momos_figures_domain_invariant'
      and tgrelid='public.figuras'::regclass and not tgisinternal and tgenabled='O')
    and exists(select 1 from pg_trigger where tgname='momos_products_horizontal_visibility'
      and tgrelid='public.products'::regclass and not tgisinternal and tgenabled='O')
    and exists(select 1 from pg_trigger where tgname='momos_products_horizontal_visibility_delete'
      and tgrelid='public.products'::regclass and not tgisinternal and tgenabled='O')
    and exists(select 1 from pg_trigger where tgname='momos_combo_component_canonical_guard'
      and tgrelid='public.combo_components'::regclass and not tgisinternal and tgenabled='O')
    and exists(select 1 from pg_trigger where tgname='a00_momos_order_item_canonical_guard'
      and tgrelid='public.order_items'::regclass and not tgisinternal and tgenabled='O'),
    'H90 no instaló las restricciones y guards de integridad.';
end $$;

do $$
begin
  assert not exists(select 1 from public.products p
    where p.tipo<>public._momos_tipo_producto_esperado(p.cat)
       or (p.cat<>'Momos Signature' and (p.especie is not null or p.stock is not null))),
    'Categoría, tipo, especie o stock conservan una clasificación ambigua.';
  assert exists(select 1 from public.products where id='PR08' and cat='Momos Cuchara'
    and tipo='pedido' and especie is null and stock is null),
    'PR08 no quedó como cuchareable al momento sin figura ni stock.';
  assert not exists(select 1 from public.figuras where product_id='PR08'),
    'PR08 todavía está ligado a una figura.';
  assert not exists(select 1 from public.products p where p.activo and p.cat='Momos Signature'
    and not exists(select 1 from public.figuras f where f.activo and f.product_id=p.id)),
    'Quedó una presentación Signature activa sin figura.';
  assert not exists(select 1 from public.products where id='PR03' and activo),
    'PR03 debe conservarse como historia, pero fuera del menú hasta definir su figura.';
  assert not exists(select 1 from public.figuras
    where activo and nombre<>all(array['Lizi','Momo','Rocco','Teo','Toby','Danna','Max','Horizontal']::text[])),
    'Quedó una denominación no canónica activa como figura.';
  assert not exists(select 1 from public.figuras where nombre='Horizontal'
    and (product_id is not null or activo is distinct from public._momos_horizontal_requerida())),
    'Horizontal no siguió el estado activo de Cuchareable, Cake Momo o Cheesecake Momo.';
  assert (select count(*) from public.figuras where activo and public._momos_es_figura_canonica(nombre))=7,
    'No están activas exactamente las siete figuras físicas de MOMOS.';
  assert not exists(
    select 1
    from (values
      ('Lizi','gato',150,'PR01'),('Momo','gato',180,'PR01'),
      ('Rocco','perro',180,'PR02'),('Teo','gato',250,'PR04'),
      ('Toby','gato',280,'PR01'),('Danna','perro',180,'PR02'),
      ('Max','perro',180,'PR02')
    ) expected(nombre,especie,gramaje_g,product_id)
    left join public.figuras f on f.nombre=expected.nombre and f.activo
    where f.nombre is null or f.especie<>expected.especie
      or f.gramaje_g<>expected.gramaje_g or f.product_id<>expected.product_id
  ),'Figura, especie, gramaje o presentación comercial no coinciden con el contrato canónico.';
end $$;

create temporary table h90_context(
  order_id text not null,
  combo_id text not null,
  allowed_product_id text not null,
  allowed_product_name text not null,
  allowed_figure text not null,
  denied_product_id text not null,
  denied_figure text not null,
  made_to_order_id text not null
) on commit drop;

do $$
declare
  v_suffix text:=pg_backend_pid()::text;
  v_customer text:='H90-CU-'||pg_backend_pid()::text;
  v_order text:='H90-P-'||pg_backend_pid()::text;
  v_combo text:='H90-CB-'||pg_backend_pid()::text;
  v_made text:='H90-PD-'||pg_backend_pid()::text;
  v_box_item text;
  v_allowed_name text;
  v_non_signature_cat text;
begin
  select nombre into v_allowed_name from public.products where id='PR04';
  select id into v_box_item from public.inventory_items where cat='Cajas' order by id limit 1;
  select nombre into v_non_signature_cat from public.product_cats
  where activo and nombre not in ('Momos Signature','Cajas y Combos') order by nombre limit 1;
  assert v_allowed_name is not null and v_box_item is not null and v_non_signature_cat is not null,
    'H90 necesita PR04, una caja y una categoría de producto al momento.';

  insert into public.customers(id,nombre,telefono,canal)
  values(v_customer,'Cliente prueba H90','','Directo');
  insert into public.orders(id,fecha,hora,canal,customer_id,estado)
  values(v_order,current_date,localtime,'Directo',v_customer,'Nuevo');

  insert into public.products(
    id,nombre,cat,tipo,precio,costo,prep,frio,lejano,activo,combo_size,empaque_item_id
  ) values(
    v_combo,'Caja exacta H90 '||v_suffix,'Cajas y Combos','combo',1,0,0,true,false,true,1,v_box_item
  );
  insert into public.products(
    id,nombre,cat,tipo,precio,costo,stock,prep,frio,lejano,activo
  ) values(
    v_made,'Producto al momento H90 '||v_suffix,v_non_signature_cat,'pedido',1,0,null,0,true,false,true
  );
  -- Teo (PR04) y Lizi (PR01) son ambos gato: la prueba demuestra que especie
  -- no decide la hija. Esta caja admite únicamente la presentación de Teo.
  insert into public.combo_components(combo_id,component_id) values(v_combo,'PR04');

  insert into h90_context values(
    v_order,v_combo,'PR04',v_allowed_name,'Teo','PR01','Lizi',v_made
  );
end $$;

do $$
declare v h90_context%rowtype; v_failed boolean:=false; v_bad text:='H90-BAD-'||pg_backend_pid()::text;
begin
  select * into v from h90_context;

  begin
    insert into public.products(id,nombre,cat,tipo,especie,precio,costo,stock,prep,frio,lejano,activo)
    select v_bad,'Clasificación inválida H90',p.cat,'momo','gato',1,0,0,0,true,false,true
    from public.products p where p.id=v.made_to_order_id;
  exception when others then v_failed:=true; end;
  assert v_failed,'Una categoría al momento pudo guardarse como tipo momo.';

  v_failed:=false;
  begin update public.products set stock=1 where id='PR08';
  exception when others then v_failed:=true; end;
  assert v_failed,'PR08 recuperó stock terminado.';

  v_failed:=false;
  begin update public.products set tipo='momo',especie='gato' where id='PR08';
  exception when others then v_failed:=true; end;
  assert v_failed,'PR08 pudo convertirse otra vez en figura.';

  v_failed:=false;
  begin
    insert into public.figuras(nombre,especie,gramaje_g,product_id,activo)
    values('Osito H90','gato',150,'PR01',true);
  exception when others then v_failed:=true; end;
  assert v_failed,'Se pudo reintroducir Osito como figura activa.';

  v_failed:=false;
  begin
    insert into public.figuras(nombre,especie,gramaje_g,product_id,activo)
    values('Cuchareable legado H90','gato',150,'PR08',false);
  exception when others then v_failed:=true; end;
  assert v_failed,'PR08 pudo ligarse a una figura inactiva.';

  v_failed:=false;
  begin
    insert into public.combo_components(combo_id,component_id)
    values(v.combo_id,v.made_to_order_id);
  exception when others then v_failed:=true; end;
  assert v_failed,'Una caja admitió un producto sin figura física exacta.';
end $$;

-- Los invariantes diferidos permiten actualizaciones transaccionales completas,
-- pero bloquean al commit una familia sin figura o un catálogo parcial.
do $$
declare v_failed boolean:=false;
begin
  begin
    insert into public.products(id,nombre,cat,tipo,especie,precio,costo,stock,prep,frio,lejano,activo)
    values('H90-UNM-'||pg_backend_pid()::text,'Familia sin figura H90','Momos Signature','momo','gato',1,0,0,0,true,false,true);
    set constraints momos_products_domain_invariant immediate;
  exception when others then v_failed:=true; end;
  assert v_failed,'Una presentación Signature activa quedó sin figura.';
  set constraints all deferred;

  v_failed:=false;
  begin
    update public.figuras set activo=false where nombre='Lizi';
    set constraints momos_figures_domain_invariant immediate;
  exception when others then v_failed:=true; end;
  assert v_failed,'Se pudo confirmar una configuración sin Lizi.';
  set constraints all deferred;
end $$;

-- La precondición usada por la migración falla cerrado ante trabajo vivo.
do $$
declare v h90_context%rowtype; v_failed boolean:=false;
begin
  select * into v from h90_context;
  insert into public.production_suggestions(id,fecha,product_id,cantidad,motivo,estado,area)
  values('H90-SUG-'||pg_backend_pid()::text,current_date,v.made_to_order_id,1,'Prueba H90','Pendiente','Producción');
  begin perform public._momos_assert_product_reclassification_safe(v.made_to_order_id,true);
  exception when others then v_failed:=true; end;
  assert v_failed,'La reclasificación no detectó una sugerencia operativa vigente.';
end $$;

do $$
declare v h90_context%rowtype; v_failed boolean:=false;
begin
  select * into v from h90_context;

  -- Padre comercial de la caja: no tiene figura ni sabor propios.
  insert into public.order_items(id,order_id,product_id,nombre,cant,precio,costo_unitario,es_caja)
  values('H90-PA-'||pg_backend_pid()::text,v.order_id,v.combo_id,'Nombre inyectado',1,1,0,true);

  -- Simula el bug histórico: llega PR01 por compartir especie gato con Teo.
  -- H90 resuelve la hija a PR04 usando figuras.product_id exacto.
  insert into public.order_items(
    id,order_id,product_id,nombre,figura,sabor,cant,precio,costo_unitario,
    es_sub_momo,parent_item_id,caja_num
  ) values(
    'H90-HI-'||pg_backend_pid()::text,v.order_id,v.denied_product_id,'Nombre equivocado',
    v.allowed_figure,'Coco',1,0,0,true,'H90-PA-'||pg_backend_pid()::text,1
  );
  assert exists(select 1 from public.order_items oi
    where oi.id='H90-HI-'||pg_backend_pid()::text
      and oi.product_id=v.allowed_product_id and oi.nombre=v.allowed_product_name
      and oi.figura='Teo' and oi.sabor='Coco'),
    'La hija de caja no quedó ligada al producto exacto de Teo.';

  v_failed:=false;
  begin
    insert into public.order_items(
      id,order_id,product_id,nombre,figura,sabor,cant,precio,costo_unitario,
      es_sub_momo,parent_item_id,caja_num
    ) values(
      'H90-XC-'||pg_backend_pid()::text,v.order_id,v.denied_product_id,'Cruce caja',
      v.denied_figure,'Oreo',1,0,0,true,'H90-PA-'||pg_backend_pid()::text,1
    );
  exception when others then v_failed:=true; end;
  assert v_failed,'La caja aceptó una figura cuya presentación no está habilitada.';

  insert into public.order_items(id,order_id,product_id,nombre,figura,sabor,cant,precio,costo_unitario)
  values('H90-SI-'||pg_backend_pid()::text,v.order_id,'PR04','Nombre inyectado','Teo','Maracuyá',1,1,0);
  assert exists(select 1 from public.order_items oi
    where oi.id='H90-SI-'||pg_backend_pid()::text and oi.product_id='PR04'
      and oi.nombre=v.allowed_product_name and oi.figura='Teo'),
    'La línea simple exacta no conservó presentación y figura separadas.';

  v_failed:=false;
  begin
    insert into public.order_items(id,order_id,product_id,nombre,figura,sabor,cant,precio,costo_unitario)
    values('H90-XS-'||pg_backend_pid()::text,v.order_id,'PR04','Cruce simple','Lizi','Milo',1,1,0);
  exception when others then v_failed:=true; end;
  assert v_failed,'Una venta simple cruzó figura y presentación comercial.';

  -- Una preparación al momento activa conserva sabor/salsa, pero jamás una
  -- figura. PR08 está correctamente fuera del menú y se prueba por separado
  -- arriba; por eso esta frontera usa el producto temporal activo del test.
  insert into public.order_items(id,order_id,product_id,nombre,figura,sabor,salsa,cant,precio,costo_unitario)
  values('H90-CU-'||pg_backend_pid()::text,v.order_id,v.made_to_order_id,'Nombre inyectado','','Oreo','Maracuyá',1,1,0);
  assert exists(select 1 from public.order_items oi where oi.id='H90-CU-'||pg_backend_pid()::text
    and oi.product_id=v.made_to_order_id and oi.figura='' and oi.sabor='Oreo'),
    'El cuchareable válido perdió su sabor o inventó una figura.';

  v_failed:=false;
  begin
    insert into public.order_items(id,order_id,product_id,nombre,figura,sabor,salsa,cant,precio,costo_unitario)
    values('H90-CX-'||pg_backend_pid()::text,v.order_id,v.made_to_order_id,'Cuchareable falso','Lizi','Oreo','Maracuyá',1,1,0);
  exception when others then v_failed:=true; end;
  assert v_failed,'El cuchareable aceptó una figura física.';
end $$;

do $$
declare v_audit jsonb;
begin
  v_audit:=public.auditar_dominio_productos_figuras_v1();
  assert (select array_agg(k order by k) from jsonb_object_keys(v_audit) k)=array[
    'active_auxiliary_figures','active_noncanonical_figures','canonical_figures','contains_customer_pii',
    'contains_free_text','contract','external_execution','invalid_auxiliary_figures',
    'invalid_combo_components','invalid_figure_mappings','invalid_historical_order_lines','invalid_product_classifications',
    'unmapped_signature_presentations','version'
  ]::text[],'La auditoría H90 expuso datos fuera de su contrato compacto.';
  assert v_audit->>'contract'='momos.domain-integrity.v1'
    and (v_audit->>'version')::integer=1
    and (v_audit->>'canonical_figures')::integer=7
    and (v_audit->>'active_noncanonical_figures')::integer=0
    and (v_audit->>'invalid_auxiliary_figures')::integer=0
    and (v_audit->>'invalid_product_classifications')::integer=0
    and (v_audit->>'invalid_figure_mappings')::integer=0
    and (v_audit->>'unmapped_signature_presentations')::integer=0
    and coalesce((v_audit->>'contains_customer_pii')::boolean,true)=false
    and coalesce((v_audit->>'contains_free_text')::boolean,true)=false
    and coalesce((v_audit->>'external_execution')::boolean,true)=false,
    'La auditoría H90 perdió catálogo, privacidad o no ejecución.';
  assert v_audit::text !~* 'telefono|direccion|cliente|auth_id|email|precio|nota|service[_-]?role',
    'La auditoría H90 expuso PII, valor comercial, nota o secreto.';
end $$;

select 'TESTS_OK — dominio categoría/presentación/figura/sabor/cajas exactas/fail-closed/RBAC PASS, rollback total' as resultado;
rollback;
