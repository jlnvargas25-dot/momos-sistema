-- MOMOS OPS · H100 · ensayo operativo E2E interno en staging. Siempre ROLLBACK.
--
-- Recorre el flujo interno real de un pedido con las RPC canonicas:
-- Recepcion/Pago -> Cocina -> Empaque -> Logistica -> Entrega.
-- Usa datos sinteticos, evidencias de fixture y una identidad real prestada
-- dentro de la transaccion. No certifica checkout publico, webhook de pago,
-- Storage API ni un piloto con clientes reales.

begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h100_internal_pilot'));

create temporary table h100_context(
  admin_id text not null,
  auth_id uuid not null,
  kitchen_id text not null,
  customer_id text not null,
  order_id text not null,
  order_item_id text not null,
  product_id text not null,
  figure text not null,
  provider text not null,
  stock_total numeric not null,
  kitchen_key uuid not null
) on commit drop;
grant select on table h100_context to authenticated,anon;

do $$
declare
  v_admin public.users%rowtype;
  v_product text;
  v_figure text;
  v_provider text;
  v_suffix text:=pg_backend_pid()::text;
  v_customer text:='C-H100-'||v_suffix;
  v_order text:='P-H100-'||v_suffix;
  v_item text:='OI-H100-'||v_suffix;
  v_kitchen text:='U-H100-'||v_suffix;
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_100_piloto_operativo_interno'),
    'H100 requiere aplicar piloto-operativo-interno-v1.sql.';
  assert to_regprocedure('public.set_order_status(text,text,boolean)') is not null
    and to_regprocedure('public.completar_cocina_y_entregar_empaque_v1(jsonb)') is not null
    and to_regprocedure('public.confirmar_verificacion_empaque(text,text[])') is not null
    and to_regprocedure('public.ofrecer_relevo_despacho(text,text)') is not null
    and to_regprocedure('public.aceptar_relevo_despacho(text)') is not null
    and to_regprocedure('public.piloto_operativo_interno_disponible()') is not null,
    'H100 no encontro todas las RPC canonicas del recorrido.';
  assert position('pg_catalog.sha256' in pg_get_functiondef(
      'public.ofrecer_relevo_despacho(text,text)'::regprocedure))>0
    and position('digest(' in pg_get_functiondef(
      'public.ofrecer_relevo_despacho(text,text)'::regprocedure))=0,
    'H100 conserva una firma de relevo dependiente de pgcrypto.';

  select * into v_admin from public.users
  where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol]))
  order by id limit 1;
  select f.product_id,f.nombre into v_product,v_figure
  from public.figuras f
  join public.products p on p.id=f.product_id
  where f.activo and public._momos_es_figura_canonica(f.nombre)
    and p.activo and p.tipo='momo'
  order by f.nombre limit 1;
  select nombre into v_provider from public.proveedores_domicilio order by nombre limit 1;
  assert v_admin.id is not null and v_product is not null and v_provider is not null,
    'H100 necesita Administrador autenticado, figura activa y proveedor de domicilio.';

  insert into public.users(id,nombre,email,rol,roles,activo,sede_id)
  values(
    v_kitchen,'Cocina H100','h100-cocina-'||v_suffix||'@momos.test',
    'Cocina',array['Cocina']::text[],true,v_admin.sede_id
  );
  insert into public.customers(id,nombre,telefono,canal)
  values(v_customer,'Cliente sintetico H100','399'||right('0000000'||v_suffix,7),'Directo');
  insert into public.orders(
    id,fecha,hora,canal,customer_id,barrio,direccion,zona,dom_cobrado,dom_costo,
    pago,comprobante,estado,obs,inventario_reservado,insumos_descontados
  ) values(
    v_order,current_date,localtime,'Directo',v_customer,'Prueba interna','Direccion sintetica',
    null,5000,5000,'Nequi',false,'Pendiente de pago','[TEST H100 · ROLLBACK]',true,true
  );
  insert into public.order_items(
    id,order_id,product_id,nombre,figura,sabor,relleno,cant,precio,costo_unitario
  ) select v_item,v_order,p.id,p.nombre,v_figure,'Coco','Cheesecake con ganache',1,p.precio,p.costo
    from public.products p where p.id=v_product;

  insert into h100_context values(
    v_admin.id,v_admin.auth_id,v_kitchen,v_customer,v_order,v_item,
    v_product,v_figure,v_provider,
    (select coalesce(sum(stock),0) from public.inventory_items),
    '10000000-0000-4000-8000-000000000001'::uuid
  );
end $$;

-- Una persona de Cocina no puede confirmar pagos. Para probarlo sin crear una
-- identidad falsa en Auth se presta la identidad del Administrador y se restaura.
do $$
declare v_admin text; v_kitchen text; v_auth uuid;
begin
  select admin_id,kitchen_id,auth_id into v_admin,v_kitchen,v_auth from h100_context;
  update public.users set auth_id=null where id=v_admin;
  update public.users set auth_id=v_auth where id=v_kitchen;
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h100_context),'role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare v_failed boolean:=false; v_message text:='';
begin
  begin
    perform public.set_order_status((select order_id from h100_context),'Pagado',false);
  exception when others then
    v_failed:=true; v_message:=sqlerrm;
  end;
  assert v_failed and v_message ilike '%no puede confirmar%',
    'H100 permitio que Cocina confirmara el pago.';
end $$;

reset role;
do $$
declare v_admin text; v_kitchen text; v_auth uuid;
begin
  select admin_id,kitchen_id,auth_id into v_admin,v_kitchen,v_auth from h100_context;
  update public.users set auth_id=null where id=v_kitchen;
  update public.users set auth_id=v_auth where id=v_admin;
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h100_context),'role','authenticated'
)::text,true);

-- Fixture de Storage: H100 prueba los gates operativos, mientras H97 certifica
-- por separado bytes, hashes y restauracion de Storage.
insert into public.evidences(id,order_id,tipo,storage_path,user_id)
select 'E-H100-PAGO-'||pg_backend_pid(),order_id,'Comprobante de pago',
  'tests/h100/'||pg_backend_pid()||'/pago.jpg',admin_id from h100_context;

set local role authenticated;
do $$
declare
  v_order text:=(select order_id from h100_context);
  v_item text:=(select order_item_id from h100_context);
  v_first jsonb; v_replay jsonb; v_stage jsonb; v_pack1 jsonb; v_pack2 jsonb;
begin
  v_first:=public.set_order_status(v_order,'Pagado',false);
  v_replay:=public.set_order_status(v_order,'Pagado',false);
  assert v_first->>'a'='Pagado' and v_replay->>'de'='Pagado' and v_replay->>'a'='Pagado',
    'H100 no tolero el reintento de confirmacion de pago.';

  perform public.set_order_status(v_order,'En producción',false);
  perform public.tomar_etapa_pedido(v_order,'Cocina');
  v_first:=public.completar_cocina_y_entregar_empaque_v1(jsonb_build_object(
    'idempotency_key',(select kitchen_key::text from h100_context),
    'order_id',v_order
  ));
  v_replay:=public.completar_cocina_y_entregar_empaque_v1(jsonb_build_object(
    'idempotency_key',(select kitchen_key::text from h100_context),
    'order_id',v_order
  ));
  assert v_first->>'contract'='momos.compound-mutation.v1'
    and (v_first->>'duplicate')::boolean=false
    and (v_replay->>'duplicate')::boolean=true,
    'H100 no conservo idempotencia en el relevo Cocina-Empaque.';

  v_pack1:=public.confirmar_verificacion_empaque(v_order,array[v_item]);
  v_pack2:=public.confirmar_verificacion_empaque(v_order,array[v_item]);
  assert v_pack1->>'order_signature'=v_pack2->>'order_signature'
    and nullif(v_pack1->>'order_signature','') is not null,
    'H100 altero la firma de una misma comanda al reintentar.';

  assert coalesce((v_first->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_first->>'containsSecrets')::boolean,true)=false
    and coalesce((v_first->>'externalExecution')::boolean,true)=false
    and (v_first::text||v_replay::text||v_pack1::text)
      !~* '"(telefono|direccion|email|service_role|api_key|token)"[[:space:]]*:',
    'H100 expuso PII, secretos o ejecucion externa en las respuestas operativas.';
end $$;

reset role;
insert into public.evidences(id,order_id,tipo,storage_path,user_id)
select 'E-H100-ABIERTA-'||pg_backend_pid(),order_id,'Caja abierta',
  'tests/h100/'||pg_backend_pid()||'/caja-abierta.jpg',admin_id from h100_context
union all
select 'E-H100-SELLO-'||pg_backend_pid(),order_id,'Caja cerrada con sello',
  'tests/h100/'||pg_backend_pid()||'/sello.jpg',admin_id from h100_context;

set local role authenticated;
do $$
declare v_order text:=(select order_id from h100_context); v_failed boolean:=false;
begin
  perform public.set_order_status(v_order,'Empacado',false);
  perform public.set_order_status(v_order,'Listo para despacho',false);
  perform public.ofrecer_relevo_despacho(v_order,'Ensayo interno H100');
  perform public.aceptar_relevo_despacho(v_order);
  assert coalesce((public.aceptar_relevo_despacho(v_order)->>'sin_cambio')::boolean,false),
    'H100 no tolero el reintento del relevo logistico.';
  begin perform public.ofrecer_relevo_despacho(v_order,'No debe reabrir');
  exception when others then v_failed:=true; end;
  assert v_failed,'H100 permitio reabrir un relevo fisico ya aceptado.';
end $$;

reset role;
insert into public.deliveries(
  id,order_id,proveedor,costo_real,cobrado,zona,estado,obs
) select 'D-H100-'||pg_backend_pid(),order_id,provider,5000,5000,null,'Asignado','[TEST H100]'
  from h100_context;
insert into public.evidences(id,order_id,tipo,storage_path,user_id)
select 'E-H100-ENTREGA-'||pg_backend_pid(),order_id,'Entrega',
  'tests/h100/'||pg_backend_pid()||'/entrega.jpg',admin_id from h100_context;

set local role authenticated;
do $$
declare v_order text:=(select order_id from h100_context); v_first jsonb; v_replay jsonb;
begin
  v_first:=public.set_order_status(v_order,'En ruta',false);
  v_replay:=public.set_order_status(v_order,'En ruta',false);
  assert v_first->>'a'='En ruta' and v_replay->>'de'='En ruta',
    'H100 no tolero el reintento al iniciar ruta.';
  v_first:=public.set_order_status(v_order,'Entregado',false);
  v_replay:=public.set_order_status(v_order,'Entregado',false);
  assert v_first->>'a'='Entregado' and v_replay->>'a'='Entregado',
    'H100 no tolero el reintento de entrega.';
end $$;

reset role;
do $$
declare
  v_order text:=(select order_id from h100_context);
  v_item text:=(select order_item_id from h100_context);
begin
  assert (select estado from public.orders where id=v_order)='Entregado',
    'H100 no termino el pedido como Entregado.';
  assert (select estado from public.deliveries where order_id=v_order)='Entregado',
    'H100 perdio el cierre del domicilio.';
  assert (select status from public.order_dispatch_handoffs where order_id=v_order)='Aceptado',
    'H100 perdio el relevo fisico aceptado.';
  assert (select status from public.order_line_progress
    where order_item_id=v_item and stage='Cocina')='Listo'
    and (select status from public.order_line_progress
    where order_item_id=v_item and stage='Empaque')='Verificado',
    'H100 perdio el progreso exacto de Cocina o Empaque.';
  assert (select count(*) from public.compound_mutation_receipts
    where operation='cocina_a_empaque'
      and idempotency_key=(select kitchen_key from h100_context))=1,
    'H100 creo mas de un recibo para el relevo de Cocina.';
  assert (select count(*) from public.packing_verifications where order_id=v_order)=1,
    'H100 duplico la verificacion de Empaque.';
  assert not exists(select 1 from public.order_stage_assignments
    where order_id=v_order and status='Activa'),
    'H100 dejo una etapa activa despues de Entregado.';
  assert not exists(select 1 from public.order_incidents
    where order_id=v_order and status='Abierto'),
    'H100 cerro el pedido con incidentes abiertos.';
  assert (select count(*) from public.evidences where order_id=v_order)=4,
    'H100 perdio o duplico evidencias del recorrido.';
  assert (select pedidos from public.customers
    where id=(select customer_id from h100_context))=1,
    'H100 no actualizo las metricas CRM exactamente una vez.';
  assert (select coalesce(sum(stock),0) from public.inventory_items)
      =(select stock_total from h100_context),
    'H100 altero inventario fuera del contrato aislado del ensayo.';
  assert (select count(*) from public.audit_logs
    where entidad='Pedido' and entidad_id=v_order and accion='Cambio de estado')>=7,
    'H100 no conservo la trazabilidad de cambios de estado.';
end $$;

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare v_failed boolean:=false;
begin
  begin perform public.set_order_status((select order_id from h100_context),'Entregado',false);
  exception when others then v_failed:=true; end;
  assert v_failed,'H100 permitio que anon invocara el flujo interno.';
end $$;
reset role;

select 'TESTS_OK — H100 piloto operativo interno E2E/RPC/idempotencia/relevo/PII/RBAC PASS, rollback total' as resultado;
rollback;
