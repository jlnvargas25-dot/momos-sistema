-- MOMOS · Carril Pide · prueba adversarial P02 pide-cotizacion. Siempre ROLLBACK.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_pide_test_p02'));

-- 0) Ledger, RBAC estructural y remediación de grants.
do $$
declare v_rol text; v_priv text;
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_p02_pide_cotizacion'),'Falta P02 en el ledger.';
  assert exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='products'
        and column_name='precio_pide'),'Falta products.precio_pide.';
  -- Las DOS RPC públicas son la única superficie con EXECUTE.
  assert has_function_privilege('anon','public.cotizar_pedido_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.cotizar_pedido_v1(jsonb)','EXECUTE')
    and has_function_privilege('anon','public.catalogo_publico_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.catalogo_publico_v1()','EXECUTE'),
    'P02 no expuso las RPC públicas a anon/authenticated.';
  assert not has_function_privilege('anon','public._pide_rate_golpe(text,interval)','EXECUTE')
    and not has_function_privilege('anon','public._pide_disponibilidad(text)','EXECUTE')
    and not has_function_privilege('anon','public._pide_setting_int(text,integer)','EXECUTE')
    and not has_function_privilege('authenticated','public._pide_rate_golpe(text,interval)','EXECUTE')
    and not has_function_privilege('service_role','public.cotizar_pedido_v1(jsonb)','EXECUTE'),
    'P02 dejó helpers expuestos o service_role con superficie pública.';
  -- Tabla de rate: deny-all para los cuatro verbos.
  foreach v_rol in array array['anon','authenticated','service_role'] loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      assert not has_table_privilege(v_rol,'public.pide_rate_counters',v_priv),
        'pide_rate_counters dejó '||v_priv||' a '||v_rol;
    end loop;
  end loop;
  -- Remediación del drift: anon CERO privilegios; authenticated SOLO SELECT.
  foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    assert not has_table_privilege('anon','public.shop_mis_pedidos',v_priv),
      'shop_mis_pedidos dejó '||v_priv||' a anon (drift sin remediar).';
    assert not has_table_privilege('anon','public.shop_mis_items',v_priv),
      'shop_mis_items dejó '||v_priv||' a anon (drift sin remediar).';
  end loop;
  foreach v_priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    assert not has_table_privilege('authenticated','public.shop_mis_pedidos',v_priv),
      'shop_mis_pedidos dejó '||v_priv||' a authenticated.';
    assert not has_table_privilege('authenticated','public.shop_mis_items',v_priv),
      'shop_mis_items dejó '||v_priv||' a authenticated.';
  end loop;
  assert has_table_privilege('authenticated','public.shop_mis_pedidos','SELECT')
    and has_table_privilege('authenticated','public.shop_mis_items','SELECT'),
    'authenticated perdió el SELECT legítimo de sus vistas.';
end $$;

-- Contexto compartido (ids como texto; siempre rollback).
create temporary table p02_ids(clave text primary key,valor text not null) on commit drop;
grant select on table p02_ids to anon,authenticated,service_role;

do $$
declare
  v_sfx text:=pg_backend_pid()::text||'-'||(extract(epoch from clock_timestamp())::bigint%100000)::text;
  v_admin public.users%rowtype;
  v_momo text; v_figura text; v_combo text; v_combo_figura text;
  v_pedido_prod text; v_apagado text;
  v_sabor text; v_salsa text;
  v_cliente text;
  v_tel text:='301'||lpad(((extract(epoch from clock_timestamp())::bigint)%10000000)::text,7,'0');
begin
  select * into v_admin from public.users where activo and auth_id is not null
    and coalesce(roles,array[rol]) @> array['Administrador']::text[] order by id limit 1;
  assert v_admin.id is not null,'P02 necesita un Administrador autenticado en la base.';
  insert into p02_ids values('sfx',v_sfx),('admin_auth',v_admin.auth_id::text);

  -- Producto momo Signature EXISTENTE con figura canónica activa (lección H90).
  select f.product_id,f.nombre into v_momo,v_figura
    from public.figuras f join public.products p on p.id=f.product_id
    where f.activo and p.activo and p.tipo='momo'
    order by f.product_id,f.orden limit 1;
  assert v_momo is not null,'P02 necesita una figura canónica activa (H90).';
  update public.products set precio_pide=48000, stock=coalesce(stock,0)+10
    where id=v_momo;
  insert into p02_ids values
    ('momo',v_momo),('figura',v_figura),
    ('stock0',(select stock from public.products where id=v_momo)::text);

  -- Combo EXISTENTE con componentes (dominio canónico H90).
  select p.id into v_combo from public.products p
    where p.tipo='combo' and p.activo and coalesce(p.combo_size,0)>=1
      and exists(select 1 from public.combo_components cc
        join public.figuras f on f.product_id=cc.component_id and f.activo
        where cc.combo_id=p.id)
    order by p.id limit 1;
  assert v_combo is not null,'P02 necesita un combo activo con componentes y figuras.';
  update public.products set precio_pide=96000 where id=v_combo;
  select f.nombre into v_combo_figura
    from public.combo_components cc
    join public.figuras f on f.product_id=cc.component_id and f.activo
    where cc.combo_id=v_combo order by f.orden,f.nombre limit 1;
  insert into p02_ids values('combo',v_combo),
    ('combo_size',(select combo_size from public.products where id=v_combo)::text),
    ('combo_figura',v_combo_figura);

  -- Producto al momento (tipo pedido) barato para el test de mínimo.
  select p.id into v_pedido_prod from public.products p
    where p.tipo='pedido' and p.activo order by p.id limit 1;
  assert v_pedido_prod is not null,'P02 necesita un producto al momento activo.';
  update public.products set precio_pide=1000 where id=v_pedido_prod;
  insert into p02_ids values('pedido_prod',v_pedido_prod);

  -- Producto activo SIN precio_pide (queda apagado en Pide).
  select p.id into v_apagado from public.products p
    where p.activo and p.precio_pide is null
      and p.id not in (v_momo,v_combo,v_pedido_prod)
    order by p.id limit 1;
  assert v_apagado is not null,'P02 necesita un producto activo sin precio_pide.';
  insert into p02_ids values('apagado',v_apagado);

  -- Sabor y salsa canónicos vivos.
  select valor into v_sabor from public.catalog_values
    where activo and categoria like 'sabor_%' order by categoria,orden,valor limit 1;
  select valor into v_salsa from public.catalog_values
    where activo and categoria='salsa' order by orden,valor limit 1;
  assert v_sabor is not null and v_salsa is not null,
    'P02 necesita sabor y salsa canónicos activos.';
  insert into p02_ids values('sabor',v_sabor),('salsa',v_salsa);

  -- Zona/franja propias: franja generosa y franja chica para capacidad.
  insert into public.zonas(nombre,tarifa,sede_id)
  values('P02 Zona '||v_sfx,6000,(select sede_id from public.zonas order by nombre limit 1));
  insert into public.franjas(nombre,hora_inicio,hora_fin,cupo,activo)
  values('P02 Franja '||v_sfx,'10:00','12:00',50,true);
  insert into public.franjas(nombre,hora_inicio,hora_fin,cupo,activo)
  values('P02 Chica '||v_sfx,'14:00','16:00',3,true);
  insert into p02_ids values('zona','P02 Zona '||v_sfx),
    ('franja','P02 Franja '||v_sfx),('franja_chica','P02 Chica '||v_sfx);

  -- Cliente atado a la identidad del admin (current_customer_id) + beneficio.
  select id into v_cliente from public.customers where auth_id=v_admin.auth_id limit 1;
  if v_cliente is null then
    v_cliente:='P02-C-'||v_sfx;
    insert into public.customers(id,nombre,telefono,canal,auth_id)
    values(v_cliente,'P02 cliente',v_tel,'Pide',v_admin.auth_id);
  end if;
  insert into public.benefits(id,customer_id,beneficio,tipo_beneficio,valor)
  values('P02-B-'||v_sfx,v_cliente,'P02 descuento','descuento_valor_fijo',5000);
  insert into p02_ids values('cliente',v_cliente),('telefono_cliente',
    coalesce((select telefono from public.customers where id=v_cliente),v_tel));

  -- Margen del propio rate limit durante el test (hallazgo del panel): el
  -- fixture sube el techo por IP; solo el bloque 11 lo baja para probar el
  -- corte. El rollback final revierte el setting.
  update public.app_settings set valor=to_jsonb(1000) where clave='pide_rate_limit_ip';
end $$;

-- 1) Catálogo público como anon: precio del canal, sin verdad interna.
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
declare v_cat jsonb; v_prod jsonb;
begin
  v_cat:=public.catalogo_publico_v1();
  assert coalesce((v_cat->>'ok')::boolean,false)
    and v_cat->>'contract'='momos.pide.catalogo.v1'
    and coalesce((v_cat#>>'{privacy,contains_pii}')::boolean,true)=false,
    'El catálogo público no cumplió su contrato.';
  select c into v_prod from jsonb_array_elements(v_cat->'productos') c
    where c->>'product_id'=(select valor from p02_ids where clave='momo');
  assert v_prod is not null and (v_prod->>'precio')::numeric=48000
    and v_prod ? 'disponibilidad',
    'El catálogo no expuso el producto habilitado con precio_pide.';
  assert not exists(select 1 from jsonb_array_elements(v_cat->'productos') c
      where c->>'product_id'=(select valor from p02_ids where clave='apagado')),
    'El catálogo expuso un producto sin precio_pide.';
  assert not (v_prod ? 'stock') and not (v_prod ? 'costo')
    and position('precio_rappi' in v_cat::text)=0
    and position('"costo"' in v_cat::text)=0,
    'El catálogo filtró verdad interna (stock/costo/precio staff).';
  -- EXECUTE real de cotizar bajo anon (la validación corta antes de escribir).
  assert (public.cotizar_pedido_v1('{}'::jsonb)->>'error')='ENTRADA_INVALIDA',
    'cotizar_pedido_v1 no ejecutó bajo el rol anon real.';
end $$;
reset role;
-- Del bloque 2 al 8 el rol REAL es el dueño (los asserts leen tablas deny-all
-- y mutan fixtures — lección del CRITICO de P01); la identidad pública viaja
-- en el claim JWT: current_customer_id() resuelve por auth.uid() y las RPC son
-- SECURITY DEFINER, así que el camino de código es idéntico. El EXECUTE real
-- por rol quedó probado en el bloque 0 (privilegios) y arriba (anon real).
select set_config('request.jwt.claims','{"role":"anon"}',true);

-- 2) Cotización feliz (anon): precio server, domicilio, quote inmutable.
do $$
declare v_q jsonb; v_q2 jsonb; v_row public.quotes%rowtype;
  v_momo text:=(select valor from p02_ids where clave='momo');
begin
  v_q:=public.cotizar_pedido_v1(jsonb_build_object(
    'canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',v_momo,'cantidad',1,
      'figura',(select valor from p02_ids where clave='figura'),
      'sabor',(select valor from p02_ids where clave='sabor'),
      'salsa',(select valor from p02_ids where clave='salsa'))),
    'zona',(select valor from p02_ids where clave='zona'),
    'franja',(select valor from p02_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text,
    'atribucion',jsonb_build_object('utm_source','meta','campaign_id','120210000000000042')));
  assert coalesce((v_q->>'ok')::boolean,false),
    'La cotización feliz falló: '||coalesce(v_q->>'error','?');
  assert (v_q->>'total')::numeric=48000+6000
    and (v_q->>'quote_version')::integer=1
    and (v_q->>'vence_at')::timestamptz>clock_timestamp()
    and v_q->>'contract'='momos.pide.quote.v1',
    'La cotización no congeló precio+domicilio como el servidor manda.';
  assert (v_q->>'quote_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    'quote_id no es un token opaco v4.';
  assert not exists(select 1 from jsonb_array_elements(v_q->'lineas') l
      where l->>'tipo'='beneficio'),
    'Un anon recibió línea de beneficio.';
  select * into v_row from public.quotes where id=(v_q->>'quote_id')::uuid;
  assert v_row.estado='Vigente' and v_row.telefono_hmac is null
    and v_row.canal='Pide' and v_row.total=54000
    and v_row.atribucion->>'utm_source'='meta',
    'La quote persistida no coincide con la respuesta.';
  insert into p02_ids values('quote1',v_q->>'quote_id');
  -- Inmutable: re-cotizar crea OTRA quote.
  v_q2:=public.cotizar_pedido_v1(jsonb_build_object(
    'canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',v_momo,'cantidad',1,
      'figura',(select valor from p02_ids where clave='figura'),
      'sabor',(select valor from p02_ids where clave='sabor'),
      'salsa',(select valor from p02_ids where clave='salsa'))),
    'zona',(select valor from p02_ids where clave='zona'),
    'franja',(select valor from p02_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text));
  assert coalesce((v_q2->>'ok')::boolean,false)
    and v_q2->>'quote_id'<>v_q->>'quote_id',
    'Re-cotizar no creó una quote nueva.';
end $$;

-- 3) La entrada JAMÁS manda: precios, adiciones, límites, atribución.
do $$
declare v_q jsonb;
  v_momo text:=(select valor from p02_ids where clave='momo');
  v_zona text:=(select valor from p02_ids where clave='zona');
  v_franja text:=(select valor from p02_ids where clave='franja');
  v_item jsonb;
begin
  v_item:=jsonb_build_object('product_id',v_momo,'cantidad',1,
    'figura',(select valor from p02_ids where clave='figura'),
    'sabor',(select valor from p02_ids where clave='sabor'),
    'salsa',(select valor from p02_ids where clave='salsa'));
  -- precio inyectado
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(v_item||jsonb_build_object('precio',1)),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='ENTRADA_INVALIDA','Aceptó un precio del navegador.';
  -- adiciones sin verdad de precio
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(v_item||jsonb_build_object(
      'adiciones',jsonb_build_array(jsonb_build_object('nombre','Topping','cant',1)))),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='ENTRADA_INVALIDA','Aceptó adiciones sin verdad canónica de precio.';
  -- cantidad fuera de rango
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(v_item||jsonb_build_object('cantidad',999)),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='ENTRADA_INVALIDA','Aceptó una cantidad absurda.';
  -- atribución fuera de whitelist (se corta ANTES de tocar catálogo)
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(v_item),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text,
    'atribucion',jsonb_build_object('hack','si')));
  assert v_q->>'error'='ENTRADA_INVALIDA','Aceptó atribución fuera de whitelist.';
  -- fecha pasada
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(v_item),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date-1)::text));
  assert v_q->>'error'='ENTRADA_INVALIDA','Aceptó una fecha de entrega pasada.';
  -- canal ausente
  v_q:=public.cotizar_pedido_v1(jsonb_build_object(
    'items',jsonb_build_array(v_item),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='ENTRADA_INVALIDA','Aceptó una solicitud sin canal.';
end $$;

-- 4) Dominio canónico: producto apagado, figura ajena, sabor/salsa inventados,
--    combo con cajas exactas.
do $$
declare v_q jsonb; v_boxes jsonb; v_slot jsonb; i integer;
  v_zona text:=(select valor from p02_ids where clave='zona');
  v_franja text:=(select valor from p02_ids where clave='franja');
  v_combo text:=(select valor from p02_ids where clave='combo');
  v_size integer:=(select valor::integer from p02_ids where clave='combo_size');
begin
  -- producto sin precio_pide
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',(select valor from p02_ids where clave='apagado'),'cantidad',1)),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='PRODUCTO_NO_DISPONIBLE','Cotizó un producto apagado en Pide.';
  -- figura que no corresponde al producto
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',(select valor from p02_ids where clave='momo'),'cantidad',1,
      'figura','FiguraInexistente P02',
      'sabor',(select valor from p02_ids where clave='sabor'),
      'salsa',(select valor from p02_ids where clave='salsa'))),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='ENTRADA_INVALIDA','Aceptó una figura ajena al producto.';
  -- sabor no canónico
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',(select valor from p02_ids where clave='momo'),'cantidad',1,
      'figura',(select valor from p02_ids where clave='figura'),
      'sabor','Sabor Inventado','salsa',(select valor from p02_ids where clave='salsa'))),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='ENTRADA_INVALIDA','Aceptó un sabor fuera de catalog_values.';
  -- combo sin boxes
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object('product_id',v_combo,'cantidad',1)),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='ENTRADA_INVALIDA','Aceptó un combo sin cajas.';
  -- combo feliz: 1 caja con combo_size slots canónicos
  v_slot:=jsonb_build_object(
    'figura',(select valor from p02_ids where clave='combo_figura'),
    'sabor',(select valor from p02_ids where clave='sabor'),
    'salsa',(select valor from p02_ids where clave='salsa'));
  v_boxes:='[]'::jsonb;
  for i in 1..v_size loop v_boxes:=v_boxes||v_slot; end loop;
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',v_combo,'cantidad',1,'boxes',jsonb_build_array(v_boxes))),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text));
  assert coalesce((v_q->>'ok')::boolean,false)
    and (v_q->>'total')::numeric=96000+6000,
    'El combo canónico no cotizó con el precio del canal: '||coalesce(v_q->>'error','?');
  -- slot con figura ajena al combo
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',v_combo,'cantidad',1,
      'boxes',jsonb_build_array((
        select jsonb_agg(case when n=1 then v_slot||jsonb_build_object('figura','FiguraAjena P02')
                              else v_slot end)
        from generate_series(1,v_size) n)))),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='ENTRADA_INVALIDA','Aceptó una figura ajena dentro del combo.';
  -- componente APAGADO ⇒ el combo no cotiza (quote irreproducible prohibida)
  update public.products set activo=false
    where id=(select product_id from public.figuras
      where nombre=(select valor from p02_ids where clave='combo_figura') limit 1);
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',v_combo,'cantidad',1,'boxes',jsonb_build_array(v_boxes))),
    'zona',v_zona,'franja',v_franja,'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error' in ('ENTRADA_INVALIDA','PRODUCTO_NO_DISPONIBLE'),
    'Un combo con componente apagado cotizó igual.';
  update public.products set activo=true
    where id=(select product_id from public.figuras
      where nombre=(select valor from p02_ids where clave='combo_figura') limit 1);
end $$;

-- 5) Disponibilidad gruesa: agotado corta; pocas_unidades advierte; jamás
--    aparece el número exacto de stock en la respuesta.
do $$
declare v_q jsonb;
  v_momo text:=(select valor from p02_ids where clave='momo');
  v_item jsonb; v_stock0 numeric:=(select valor::numeric from p02_ids where clave='stock0');
begin
  v_item:=jsonb_build_object('product_id',v_momo,'cantidad',1,
    'figura',(select valor from p02_ids where clave='figura'),
    'sabor',(select valor from p02_ids where clave='sabor'),
    'salsa',(select valor from p02_ids where clave='salsa'));
  update public.products set stock=0 where id=v_momo;
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(v_item),
    'zona',(select valor from p02_ids where clave='zona'),
    'franja',(select valor from p02_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='PRODUCTO_NO_DISPONIBLE','Cotizó un producto agotado.';
  update public.products set stock=2 where id=v_momo;  -- <= colchón+1
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(v_item),
    'zona',(select valor from p02_ids where clave='zona'),
    'franja',(select valor from p02_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text));
  assert coalesce((v_q->>'ok')::boolean,false)
    and exists(select 1 from jsonb_array_elements(v_q->'advertencias') a
      where a->>'tipo'='pocas_unidades'),
    'La señal gruesa pocas_unidades no llegó.';
  assert position('"stock"' in v_q::text)=0,
    'La respuesta filtró el número exacto de stock.';
  update public.products set stock=v_stock0 where id=v_momo;
end $$;

-- 6) Cobertura y capacidad: demanda PII-free normalizada; el pedido Cancelado
--    no ocupa cupo; el colchón corre el punto de quiebre.
do $$
declare v_q jsonb; v_eventos0 integer; v_orden text;
  v_momo text:=(select valor from p02_ids where clave='momo');
  v_item jsonb;
  v_chica text:=(select valor from p02_ids where clave='franja_chica');
  v_sfx text:=(select valor from p02_ids where clave='sfx');
begin
  v_item:=jsonb_build_object('product_id',v_momo,'cantidad',1,
    'figura',(select valor from p02_ids where clave='figura'),
    'sabor',(select valor from p02_ids where clave='sabor'),
    'salsa',(select valor from p02_ids where clave='salsa'));
  -- zona texto crudo → error + evento NORMALIZADO (jamás persiste el crudo)
  select count(*) into v_eventos0 from public.pide_demand_events;
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(v_item),
    'zona','Calle 9 # 8-77 cel 3009998877','franja',v_chica,
    'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='FUERA_DE_COBERTURA','No cortó una zona fuera de cobertura.';
  assert (select count(*) from public.pide_demand_events)=v_eventos0+1
    and not exists(select 1 from public.pide_demand_events where zona like 'Calle%'),
    'El evento de demanda no se registró normalizado.';
  -- franja chica (cupo 3, colchón 2 ⇒ corta desde el pedido 1 activo)
  v_orden:='P02-O-'||v_sfx;
  -- Semántica REAL: orders.fecha = fecha operativa de creación (staff);
  -- la ENTREGA viaja en fecha_entrega+franja (contrato sellado para P04).
  insert into public.orders(id,fecha,hora,canal,customer_id,estado,zona,franja,fecha_entrega)
  values(v_orden,current_date,current_time,'Pide',
    (select valor from p02_ids where clave='cliente'),'Nuevo',
    (select valor from p02_ids where clave='zona'),v_chica,current_date+2);
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(v_item),
    'zona',(select valor from p02_ids where clave='zona'),'franja',v_chica,
    'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='SIN_CAPACIDAD_FRANJA','No cortó la franja llena (con colchón).';
  -- el mismo pedido Cancelado libera el cupo
  update public.orders set estado='Cancelado' where id=v_orden;
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(v_item),
    'zona',(select valor from p02_ids where clave='zona'),'franja',v_chica,
    'fecha_entrega',(current_date+2)::text));
  assert coalesce((v_q->>'ok')::boolean,false),
    'Un pedido Cancelado siguió ocupando cupo.';
end $$;

-- 7) Mínimo global (decisión ratificada).
do $$
declare v_q jsonb;
begin
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',(select valor from p02_ids where clave='pedido_prod'),'cantidad',1)),
    'zona',(select valor from p02_ids where clave='zona'),
    'franja',(select valor from p02_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='MINIMO_NO_ALCANZADO','Cotizó por debajo del mínimo del negocio.';
end $$;

-- 8) Anti-oráculo de beneficio (§3.9): para anon la respuesta es IDÉNTICA en
--    shape exista o no beneficio; el teléfono de un tercero no activa nada.
do $$
declare v_con jsonb; v_sin jsonb;
  v_item jsonb;
begin
  v_item:=jsonb_build_object(
    'product_id',(select valor from p02_ids where clave='momo'),'cantidad',1,
    'figura',(select valor from p02_ids where clave='figura'),
    'sabor',(select valor from p02_ids where clave='sabor'),
    'salsa',(select valor from p02_ids where clave='salsa'));
  v_con:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'telefono',(select valor from p02_ids where clave='telefono_cliente'),
    'items',jsonb_build_array(v_item),
    'zona',(select valor from p02_ids where clave='zona'),
    'franja',(select valor from p02_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text));
  v_sin:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(v_item),
    'zona',(select valor from p02_ids where clave='zona'),
    'franja',(select valor from p02_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text));
  assert coalesce((v_con->>'ok')::boolean,false)
    and coalesce((v_sin->>'ok')::boolean,false),
    'La cotización anon con/sin teléfono no respondió.';
  assert (select array_agg(k order by k) from jsonb_object_keys(v_con) k)
       = (select array_agg(k order by k) from jsonb_object_keys(v_sin) k)
    and (v_con->>'total')=(v_sin->>'total')
    and jsonb_array_length(v_con->'lineas')=jsonb_array_length(v_sin->'lineas')
    and not exists(select 1 from jsonb_array_elements(v_con->'lineas') l
      where l->>'tipo'='beneficio'),
    'El teléfono de un cliente con beneficio alteró la respuesta anon (oráculo).';
end $$;
reset role;

-- 9) Beneficio con posesión probada (sesión authenticated dueña): aparece la
--    línea, el total baja y el benefit_id interno JAMÁS se expone.
-- Identidad de la sesión dueña vía claim (rol real: dueño — lee quotes/benefits).
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select valor from p02_ids where clave='admin_auth'),'role','authenticated'
)::text,true);
do $$
declare v_q jsonb; v_row public.quotes%rowtype; v_payload jsonb;
  v_sfx text:=(select valor from p02_ids where clave='sfx');
begin
  v_payload:=jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',(select valor from p02_ids where clave='momo'),'cantidad',1,
      'figura',(select valor from p02_ids where clave='figura'),
      'sabor',(select valor from p02_ids where clave='sabor'),
      'salsa',(select valor from p02_ids where clave='salsa'))),
    'zona',(select valor from p02_ids where clave='zona'),
    'franja',(select valor from p02_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text);
  v_q:=public.cotizar_pedido_v1(v_payload);
  assert coalesce((v_q->>'ok')::boolean,false),
    'La cotización authenticated falló: '||coalesce(v_q->>'error','?');
  assert exists(select 1 from jsonb_array_elements(v_q->'lineas') l
      where l->>'tipo'='beneficio' and (l->>'total')::numeric=-5000),
    'La sesión dueña no recibió su beneficio.';
  assert (v_q->>'total')::numeric=48000-5000+6000,
    'El descuento del beneficio no bajó el total.';
  assert position('P02-B-'||v_sfx in v_q::text)=0,
    'El benefit_id interno se filtró en la respuesta.';
  select * into v_row from public.quotes where id=(v_q->>'quote_id')::uuid;
  assert v_row.benefit_id='P02-B-'||v_sfx and v_row.customer_id is not null,
    'La quote no ancló internamente beneficio y cliente.';
  -- Cotizar NO reservó el beneficio (eso es de P03): sigue Activo.
  assert (select estado from public.benefits where id='P02-B-'||v_sfx)='Activo',
    'Cotizar mutó el estado del beneficio.';

  -- Beneficio VENCIDO: no aparece y el shape no cambia (vigencia real del core).
  update public.benefits set vence=current_date-1 where id='P02-B-'||v_sfx;
  v_q:=public.cotizar_pedido_v1(v_payload);
  assert coalesce((v_q->>'ok')::boolean,false)
    and not exists(select 1 from jsonb_array_elements(v_q->'lineas') l
      where l->>'tipo'='beneficio'),
    'Un beneficio vencido se aplicó igual.';
  update public.benefits set vence=null where id='P02-B-'||v_sfx;

  -- Mínimo del beneficio no alcanzado: sin línea y sin ancla interna.
  update public.benefits set minimo=999999 where id='P02-B-'||v_sfx;
  v_q:=public.cotizar_pedido_v1(v_payload);
  assert coalesce((v_q->>'ok')::boolean,false)
    and not exists(select 1 from jsonb_array_elements(v_q->'lineas') l
      where l->>'tipo'='beneficio')
    and (select benefit_id from public.quotes
      where id=(v_q->>'quote_id')::uuid) is null,
    'Un beneficio con mínimo no alcanzado se aplicó o se ancló igual.';
  update public.benefits set minimo=null where id='P02-B-'||v_sfx;
end $$;
reset role;

-- 10) Cotizar no muta estado comercial (§3.3).
do $$
declare
  v_momo text:=(select valor from p02_ids where clave='momo');
begin
  assert (select stock from public.products where id=v_momo)
    =(select valor::numeric from p02_ids where clave='stock0'),
    'Cotizar movió stock.';
  assert not exists(select 1 from public.inventory_reservations
      where id like 'P02-%'),
    'Cotizar creó reservas de inventario.';
  assert not exists(select 1 from public.checkout_holds),
    'Cotizar creó holds (eso es de P03).';
end $$;

-- 11) Rate limit: al superar el umbral responde QUOTE_RATE_LIMIT sin tocar
--     catálogo (defensa de costo, §8).
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
declare v_q jsonb;
begin
  update public.app_settings set valor=to_jsonb(1) where clave='pide_rate_limit_ip';
  v_q:=public.cotizar_pedido_v1(jsonb_build_object('canal','pide',
    'items',jsonb_build_array(jsonb_build_object(
      'product_id',(select valor from p02_ids where clave='momo'),'cantidad',1)),
    'zona',(select valor from p02_ids where clave='zona'),
    'franja',(select valor from p02_ids where clave='franja'),
    'fecha_entrega',(current_date+2)::text));
  assert v_q->>'error'='QUOTE_RATE_LIMIT','El rate limit por IP no cortó.';
  update public.app_settings set valor=to_jsonb(1000) where clave='pide_rate_limit_ip';
end $$;
reset role;

-- 11b) La clave de IP se acuña del ÚLTIMO salto de x-forwarded-for: los
--      prefijos que invente el cliente NO fabrican claves nuevas.
do $$
declare v_claves0 integer; v_claves integer;
begin
  select count(*) into v_claves0 from public.pide_rate_counters where clave like 'ip:%';
  perform set_config('request.headers','{"x-forwarded-for":"1.2.3.4, 9.9.9.9"}',true);
  perform public.cotizar_pedido_v1('{}'::jsonb);
  perform set_config('request.headers','{"x-forwarded-for":"5.6.7.8, 9.9.9.9"}',true);
  perform public.cotizar_pedido_v1('{}'::jsonb);
  select count(*) into v_claves from public.pide_rate_counters where clave like 'ip:%';
  assert v_claves-v_claves0=1,
    'Prefijos falsos de x-forwarded-for acuñaron claves de IP nuevas.';
  perform set_config('request.headers','',true);
end $$;

select 'TESTS_OK — P02 catálogo por canal/precio server/dominio canónico/combos exactos/disponibilidad gruesa/demanda normalizada/capacidad con colchón y Cancelado libera/mínimo/anti-oráculo de beneficio/posesión probada/no-mutación/rate limit/grants remediados PASS, rollback total' as resultado;
rollback;
