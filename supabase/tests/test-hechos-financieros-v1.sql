-- MOMOS OPS · prueba adversarial H65 Hechos financieros por rango.
-- Siempre ROLLBACK: no conserva pedidos, compras, pauta ni configuración.

begin;

do $$
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_65_hechos_financieros'
  ), 'Falta aplicar la migración 65.';
  assert to_regprocedure('public.momos_financial_facts_v1(date,date)') is not null,
    'Falta el read model financiero.';
  assert has_function_privilege(
    'authenticated','public.momos_financial_facts_v1(date,date)','EXECUTE'
  ), 'La app autenticada no puede consultar Finanzas.';
  assert not has_function_privilege(
    'anon','public.momos_financial_facts_v1(date,date)','EXECUTE'
  ) and not has_function_privilege(
    'service_role','public.momos_financial_facts_v1(date,date)','EXECUTE'
  ), 'Un rol sin sesión puede saltar la frontera financiera.';
  assert exists(
    select 1 from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='momos_financial_facts_v1'
      and p.pronargs=2 and p.provolatile='s' and not p.prosecdef
  ), 'Finanzas dejó de ser STABLE SECURITY INVOKER.';
end $$;

-- 55 pedidos terminales, 55 domicilios, 55 compras documentadas y 55 filas de
-- pauta prueban que H65 no hereda ningún LIMIT 50 del snapshot operativo.
do $$
declare
  v_admin public.users%rowtype;
  v_staff public.users%rowtype;
  v_cat text;
  v_item public.inventory_items%rowtype;
  v_provider text;
  v_suffix text:=pg_backend_pid()::text;
  v_customer text:='H65-C-'||pg_backend_pid();
  v_product text:='H65-PR-'||pg_backend_pid();
  v_campaign text:='H65-CMP-'||pg_backend_pid();
  v_from date:=date '2098-01-01';
  g integer;
begin
  select * into v_admin from public.users
  where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol]))
  order by id limit 1;
  select * into v_staff from public.users
  where activo and auth_id is not null
    and not ('Administrador'=any(coalesce(roles,array[rol])))
  order by id limit 1;
  select nombre into v_cat from public.product_cats where activo order by nombre limit 1;
  select * into v_item from public.inventory_items
  where origen_abastecimiento='Compra' order by id limit 1;
  select nombre into v_provider from public.proveedores_domicilio order by orden,nombre limit 1;
  assert v_admin.id is not null and v_staff.id is not null and v_cat is not null
    and v_item.id is not null and v_provider is not null,
    'Falta Administrador, staff, categoría, insumo comprable o proveedor para H65.';

  insert into public.customers(
    id,nombre,telefono,instagram,barrio,direccion,canal,primera,ultima,notas
  ) values(
    v_customer,'PII-NOMBRE-H65','PII-TELEFONO-H65','PII-INSTAGRAM-H65',
    'PII-BARRIO-H65','PII-DIRECCION-H65','Directo',v_from,v_from,'PII-NOTA-H65'
  );
  insert into public.products(
    id,nombre,cat,tipo,precio,costo,prep,frio,lejano,activo,descr
  ) values(
    v_product,'Producto financiero H65 '||v_suffix,v_cat,'pedido',1000,400,0,false,false,true,'Fixture H65'
  );
  insert into public.campaigns(
    id,nombre,canal,objetivo,presupuesto,estado,notas
  ) values(
    v_campaign,'Campaña financiera H65 '||v_suffix,'Instagram','Ventas',385,'Activa','PII-NOTA-CAMPANA-H65'
  );
  insert into public.app_settings(clave,valor)
  values('pauta_mensual',to_jsonb(900000::numeric))
  on conflict(clave) do update set valor=excluded.valor;

  for g in 1..55 loop
    insert into public.orders(
      id,fecha,hora,canal,customer_id,barrio,direccion,dom_cobrado,dom_costo,
      descuento,pago,comprobante,estado,obs,pagado_en,comision_pago,campaign_id
    ) values(
      'H65-O-'||v_suffix||'-'||lpad(g::text,3,'0'),v_from+(g-1),time '12:00',
      'Directo',v_customer,'PII-BARRIO-H65','PII-DIRECCION-H65',200,100,50,
      'Nequi',true,'Entregado','PII-OBS-ORDEN-H65',
      ((v_from+(g-1))::text||' 12:10:00+00')::timestamptz,10,v_campaign
    );
    insert into public.order_items(
      id,order_id,product_id,nombre,cant,precio,costo_unitario,es_caja,es_sub_momo
    ) values(
      'H65-OI-'||v_suffix||'-'||lpad(g::text,3,'0'),
      'H65-O-'||v_suffix||'-'||lpad(g::text,3,'0'),v_product,
      'Producto financiero H65',1,1000,400,false,false
    );
    insert into public.deliveries(
      id,order_id,proveedor,costo_real,cobrado,estado,obs
    ) values(
      'H65-D-'||v_suffix||'-'||lpad(g::text,3,'0'),
      'H65-O-'||v_suffix||'-'||lpad(g::text,3,'0'),v_provider,100,200,
      'Entregado','PII-NOTA-DOMICILIO-H65'
    );

    insert into public.inventory_movements(id,fecha,tipo,item_id,cant,nota)
    values(
      'H65-M-'||v_suffix||'-'||lpad(g::text,3,'0'),
      ((v_from+(g-1))::text||' 09:00:00+00')::timestamptz,
      'Entrada',v_item.id,2,'PII-NOTA-MOVIMIENTO-H65'
    );
    insert into public.inventory_lots(
      id,item_id,source_movement_id,received_at,initial_quantity,
      available_quantity,unit_cost,supplier,location,origin
    ) values(
      'H65-IL-'||v_suffix||'-'||lpad(g::text,3,'0'),v_item.id,
      'H65-M-'||v_suffix||'-'||lpad(g::text,3,'0'),v_from+(g-1),2,2,30,
      'PII-PROVEEDOR-H65','PII-UBICACION-H65','Compra'
    );
    insert into public.metrics_daily(
      fecha,fuente,campaign_id,impresiones,alcance,clicks,mensajes_wa,gasto,notas
    ) values(
      v_from+(g-1),'manual',v_campaign,100,90,10,2,7,'PII-NOTA-PAUTA-H65'
    );
  end loop;

  -- Una caja sana tiene costo solo en la fila padre. La hija fisica debe
  -- conservar precio/costo cero sin convertirse en una alerta financiera.
  insert into public.order_items(
    id,order_id,product_id,nombre,cant,precio,costo_unitario,es_caja,es_sub_momo
  ) values(
    'H65-BOX-'||v_suffix,'H65-O-'||v_suffix||'-002',v_product,
    'Caja financiera H65',1,2000,800,true,false
  );
  insert into public.order_items(
    id,order_id,product_id,nombre,cant,precio,costo_unitario,
    es_caja,es_sub_momo,parent_item_id,caja_num
  ) values(
    'H65-CHILD-'||v_suffix,'H65-O-'||v_suffix||'-002',v_product,
    'Hija fisica H65',1,0,0,false,true,'H65-BOX-'||v_suffix,1
  );

  insert into public.claims(
    id,order_id,customer_id,fecha,tipo,costo,estado,descr,resp,decision,solucion,evidencia
  ) values(
    'H65-R-'||v_suffix,'H65-O-'||v_suffix||'-001',v_customer,v_from+1,
    'Calidad',123,'Compensado','PII-DESCR-H65','PII-RESP-H65',
    'PII-DECISION-H65','PII-SOLUCION-H65','PII-RUTA-EVIDENCIA-H65'
  );
  insert into public.claims(
    id,order_id,customer_id,fecha,tipo,costo,estado,descr
  ) values(
    'H65-R-OPEN-'||v_suffix,'H65-O-'||v_suffix||'-002',v_customer,v_from+2,
    'Calidad',999,'Abierto','PII-DESCR-ABIERTO-H65'
  );

  perform set_config('momos.h65_admin_auth',v_admin.auth_id::text,true);
  perform set_config('momos.h65_staff_auth',v_staff.auth_id::text,true);
  perform set_config('momos.h65_suffix',v_suffix,true);
end $$;

-- RBAC real: tener sesión y ser staff no basta; se exige el rol acumulable de
-- Administrador dentro de la función invoker.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',current_setting('momos.h65_staff_auth'),'role','authenticated')::text,
  true
);
set local role authenticated;
do $$
declare v_failed boolean:=false;
begin
  begin
    perform public.momos_financial_facts_v1(date '2098-01-01',date '2098-03-01');
  exception when sqlstate '42501' then v_failed:=true;
  end;
  assert v_failed, 'Un usuario no Administrador pudo leer los hechos financieros.';
end $$;
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',current_setting('momos.h65_admin_auth'),'role','authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_result jsonb;
  v_suffix text:=current_setting('momos.h65_suffix');
  v_keys text[]:=array[
    'accounting_sources','ad_spend','claims','configured_ad','contains_free_text',
    'contains_pii','contains_storage_references','counts','deliveries','external_execution',
    'inventory_purchases','orders','range','server_time','version'
  ];
begin
  v_result:=public.momos_financial_facts_v1(date '2098-01-01',date '2098-03-01');

  assert (v_result->>'version')::integer=1
    and (v_result#>>'{range,days}')::integer=60
    and nullif(v_result->>'server_time','') is not null,
    'H65 no selló versión, reloj o rango inclusivo.';
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_result) keys(k)
  )=v_keys, 'El shape financiero cambió o expuso un bloque no aprobado.';
  assert coalesce((v_result->>'contains_pii')::boolean,true)=false
    and coalesce((v_result->>'contains_free_text')::boolean,true)=false
    and coalesce((v_result->>'contains_storage_references')::boolean,true)=false
    and coalesce((v_result->>'external_execution')::boolean,true)=false,
    'H65 declaró PII, texto libre, rutas o ejecución externa.';

  assert (
    select count(*) from jsonb_array_elements(v_result->'orders') x
    where x->>'order_id' like 'H65-O-'||v_suffix||'-%'
  )=55, 'La ventana de 50 expulsó pedidos financieros del rango.';
  assert (
    select count(*) from jsonb_array_elements(v_result->'deliveries') x
    where x->>'delivery_id' like 'H65-D-'||v_suffix||'-%'
  )=55, 'El cierre de pedidos perdió domicilios del rango.';
  assert (
    select count(*) from jsonb_array_elements(v_result->'inventory_purchases') x
    where x->>'movement_id' like 'H65-M-'||v_suffix||'-%'
  )=55, 'La ventana de movimientos perdió compras documentadas.';
  assert (
    select count(*) from jsonb_array_elements(v_result->'ad_spend') x
    where x->>'campaign_id'='H65-CMP-'||v_suffix
  )=55, 'El read model perdió gasto documentado de pauta.';
  assert (
    select count(*) from jsonb_array_elements(v_result->'claims') x
    where x->>'claim_id'='H65-R-'||v_suffix and (x->>'recognized_cost')::numeric=123
  )=1, 'El reclamo documentado no quedó en el rango.';

  assert exists(
    select 1 from jsonb_array_elements(v_result->'claims') x
    where x->>'claim_id'='H65-R-OPEN-'||v_suffix
      and (x->>'documented_cost')::numeric=999
      and (x->>'recognized_cost')::numeric=0
  ), 'Un reclamo abierto se reconocio prematuramente como gasto.';

  assert (
    select array_agg(k order by k)
    from jsonb_object_keys((
      select x from jsonb_array_elements(v_result->'orders') x
      where x->>'order_id'='H65-O-'||v_suffix||'-001'
    )) keys(k)
  )=array[
    'campaign_id','channel','cogs','creative_id','delivery_collected',
    'delivery_cost_on_order','discount','has_payment_evidence','incomplete_cost_lines',
    'line_count','order_date','order_id','payment_confirmed','payment_fee',
    'payment_method','product_revenue','state','total_charged'
  ], 'Una fila de pedido expuso más que el hecho financiero mínimo.';
  assert (
    select array_agg(k order by k)
    from jsonb_object_keys((
      select x from jsonb_array_elements(v_result->'deliveries') x
      where x->>'delivery_id'='H65-D-'||v_suffix||'-001'
    )) keys(k)
  )=array['actual_cost','charged','delivery_id','order_id','state'],
    'Una fila de domicilio expuso datos operativos o de ruta.';
  assert (
    select array_agg(k order by k)
    from jsonb_object_keys((
      select x from jsonb_array_elements(v_result->'claims') x
      where x->>'claim_id'='H65-R-'||v_suffix
    )) keys(k)
  )=array['claim_date','claim_id','documented_cost','order_id','recognized_cost','state'],
    'Una fila de reclamo expuso texto libre o cliente.';
  assert (
    select array_agg(k order by k)
    from jsonb_object_keys((
      select x from jsonb_array_elements(v_result->'inventory_purchases') x
      where x->>'movement_id'='H65-M-'||v_suffix||'-001'
    )) keys(k)
  )=array[
    'documented_cost','item_id','lot_id','movement_id','origin','purchase_date',
    'quantity','unit_cost'
  ], 'Una compra expuso proveedor, ubicación o nota.';
  assert (
    select array_agg(k order by k)
    from jsonb_object_keys((
      select x from jsonb_array_elements(v_result->'ad_spend') x
      where x->>'campaign_id'='H65-CMP-'||v_suffix
      order by x->>'metric_id' limit 1
    )) keys(k)
  )=array[
    'campaign_id','creative_id','documented_spend','metric_date','metric_id','post_id','source'
  ], 'Una fila de pauta expuso notas o datos ajenos al gasto documentado.';

  assert exists(
    select 1 from jsonb_array_elements(v_result->'orders') x
    where x->>'order_id'='H65-O-'||v_suffix||'-001'
      and (x->>'product_revenue')::numeric=1000
      and (x->>'cogs')::numeric=400
      and (x->>'total_charged')::numeric=1150
      and (x->>'line_count')::integer=1
  ), 'Ventas/COGS no provinieron completos de v_order_totals.';
  assert exists(
    select 1 from jsonb_array_elements(v_result->'orders') x
    where x->>'order_id'='H65-O-'||v_suffix||'-002'
      and (x->>'product_revenue')::numeric=3000
      and (x->>'cogs')::numeric=1200
      and (x->>'line_count')::integer=3
      and (x->>'incomplete_cost_lines')::integer=0
  ), 'Una hija sana de combo con costo cero se marco como costo incompleto.';
  assert exists(
    select 1 from jsonb_array_elements(v_result->'inventory_purchases') x
    where x->>'movement_id'='H65-M-'||v_suffix||'-001'
      and (x->>'quantity')::numeric=2
      and (x->>'unit_cost')::numeric=30
      and (x->>'documented_cost')::numeric=60
  ), 'La compra no conservó cantidad y costo histórico del lote.';
  assert (v_result#>>'{configured_ad,monthly_budget}')::numeric=900000
    and (v_result#>>'{configured_ad,prorated_budget}')::numeric=1800000,
    'H65 omitió o recalculó mal la pauta configurada del rango.';
  assert v_result#>>'{accounting_sources,order_revenue_and_cogs}'='v_order_totals',
    'H65 duplicó o escondió la fuente contable de ventas y COGS.';

  -- Se sembraron tokens privados en cada tabla fuente. Ninguno puede aparecer,
  -- ni siquiera dentro de un bloque nuevo o una cadena aparentemente inocua.
  assert v_result::text !~* 'PII-|customer[_-]?id|storage[_-]?path|https?://|secret|api[_-]?key',
    'La lectura financiera expuso PII, nota libre, ubicación, ruta o secreto.';
end $$;

-- Los rangos inválidos fallan de forma explícita: jamás devuelven un parcial.
do $$
declare v_failed boolean:=false;
begin
  begin
    perform public.momos_financial_facts_v1(date '2098-03-01',date '2098-01-01');
  exception when sqlstate '22007' then v_failed:=true;
  end;
  assert v_failed, 'Un rango invertido devolvió hechos parciales.';
end $$;

do $$
declare v_failed boolean:=false;
begin
  begin
    perform public.momos_financial_facts_v1(date '2097-01-01',date '2098-03-05');
  exception when sqlstate '22023' then v_failed:=true;
  end;
  assert v_failed, 'Un rango excesivo pudo materializar un JSON financiero sin límite.';
end $$;

reset role;
select 'TESTS_OK — hechos financieros completos/rango/51+/pauta/privacidad/RBAC PASS, rollback total' as resultado;
rollback;
