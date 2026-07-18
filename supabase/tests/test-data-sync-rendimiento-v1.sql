-- MOMOS OPS · prueba adversarial Data Sync y rendimiento. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260717_56_data_sync_rendimiento'),
    'Falta aplicar la migración 56.';
  assert to_regprocedure('public.momos_sync_manifest_v1()') is not null, 'Falta el manifiesto de sync.';
  assert to_regprocedure('public.momos_core_snapshot_v1()') is not null, 'Falta snapshot de catalogos.';
  assert to_regprocedure('public.momos_operational_snapshot_v1()') is not null, 'Falta snapshot operativo.';
  assert to_regprocedure('public.momos_history_page_v1(jsonb,integer)') is not null, 'Falta historial por cursor.';
  assert has_function_privilege('authenticated','public.momos_sync_manifest_v1()','EXECUTE'),
    'La app autenticada no puede leer el manifiesto.';
  assert not has_function_privilege('anon','public.momos_sync_manifest_v1()','EXECUTE'),
    'El manifiesto quedó expuesto sin sesión.';
  assert not has_function_privilege('service_role','public.momos_sync_manifest_v1()','EXECUTE'),
    'El worker puede saltar el contrato de sesión del manifiesto.';
  assert has_function_privilege('authenticated','public.momos_core_snapshot_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.momos_operational_snapshot_v1()','EXECUTE'),
    'La app no puede leer los snapshots dirigidos.';
  assert not has_function_privilege('anon','public.momos_core_snapshot_v1()','EXECUTE')
    and not has_function_privilege('anon','public.momos_operational_snapshot_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_core_snapshot_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_operational_snapshot_v1()','EXECUTE'),
    'Un rol sin sesion puede saltar el gateway de snapshots.';
  assert has_function_privilege('authenticated','public.momos_history_page_v1(jsonb,integer)','EXECUTE')
    and not has_function_privilege('anon','public.momos_history_page_v1(jsonb,integer)','EXECUTE')
    and not has_function_privilege('service_role','public.momos_history_page_v1(jsonb,integer)','EXECUTE'),
    'El historial paginado no respeta la frontera autenticada.';
end $$;

-- Fixture adversarial: 101 filas terminales recientes no pueden expulsar una
-- orden activa antigua ni romper su cierre relacional. Se inserta como owner y
-- todo queda dentro de esta transaccion, que siempre termina en ROLLBACK.
do $$
declare
  v_actor public.users%rowtype;
  v_customer_id text;
  v_item public.order_items%rowtype;
  v_provider text;
  g integer;
begin
  select * into v_actor
  from public.users
  where activo and auth_id is not null
  order by case when rol='Administrador' then 0 else 1 end,id
  limit 1;
  assert v_actor.id is not null, 'Falta un actor autenticado para probar el manifiesto.';

  select id into v_customer_id from public.customers order by id limit 1;
  assert v_customer_id is not null, 'Falta un cliente para la prueba de cierre relacional.';

  select oi.* into v_item
  from public.order_items oi
  join public.products p on p.id=oi.product_id and p.activo
  where not oi.es_caja and not oi.es_sub_momo
  order by case when coalesce(oi.figura,'')<>'' and coalesce(oi.sabor,'')<>'' then 0 else 1 end,oi.id
  limit 1;
  assert v_item.id is not null, 'Falta una linea valida para la prueba de cierre relacional.';

  select nombre into v_provider from public.proveedores_domicilio order by orden,nombre limit 1;
  assert v_provider is not null, 'Falta proveedor de domicilio para la prueba de cierre relacional.';

  insert into public.orders(id,fecha,hora,canal,customer_id,estado,obs)
  values('H56-ACTIVE-CLOSURE',date '2000-01-01',time '00:00','Directo',v_customer_id,'Nuevo','Fixture H56 activo antiguo');

  for g in 1..101 loop
    insert into public.orders(id,fecha,hora,canal,customer_id,estado,obs)
    values('H56-TERM-'||lpad(g::text,3,'0'),date '2099-12-31',time '23:59','Directo',v_customer_id,'Entregado','Fixture H56 terminal');
  end loop;

  insert into public.order_items(id,order_id,product_id,nombre,sabor,salsa,relleno,figura,cant,precio,costo_unitario,es_caja,es_sub_momo,parent_item_id,caja_num)
  values('H56-ITEM-CLOSURE','H56-ACTIVE-CLOSURE',v_item.product_id,v_item.nombre,v_item.sabor,v_item.salsa,v_item.relleno,v_item.figura,1,v_item.precio,v_item.costo_unitario,false,false,null,null);
  insert into public.order_item_adiciones(order_item_id,nombre,precio,cant,insumo_cant)
  values('H56-ITEM-CLOSURE','Adicion H56',0,1,0);
  insert into public.deliveries(id,order_id,proveedor,estado,obs)
  values('H56-DELIVERY-CLOSURE','H56-ACTIVE-CLOSURE',v_provider,'Por solicitar','Fixture H56');
  insert into public.evidences(id,order_id,tipo,storage_path,user_id)
  values('H56-EVIDENCE-CLOSURE','H56-ACTIVE-CLOSURE','Pedido armado','h56/active-closure.jpg',v_actor.id);
  insert into public.inventory_reservations(id,order_id,tipo,product_id,nombre,cantidad,estado,figura)
  values('H56-RESERVATION-CLOSURE','H56-ACTIVE-CLOSURE','producto',v_item.product_id,v_item.nombre,1,'Reservada',v_item.figura);
  insert into public.packing_verifications(order_id,user_id,line_ids,order_signature,snapshot)
  values('H56-ACTIVE-CLOSURE',v_actor.id,array['H56-ITEM-CLOSURE'],'h56-signature','{}'::jsonb);
  insert into public.order_stage_assignments(id,order_id,stage,user_id,status)
  values('H56-STAGE-CLOSURE','H56-ACTIVE-CLOSURE','Cocina',v_actor.id,'Activa');
  insert into public.order_line_progress(order_item_id,order_id,stage,status,user_id)
  values('H56-ITEM-CLOSURE','H56-ACTIVE-CLOSURE','Cocina','Pendiente',v_actor.id);
  insert into public.order_incidents(id,order_id,order_item_id,area,type,description,created_by)
  values('H56-INCIDENT-CLOSURE','H56-ACTIVE-CLOSURE','H56-ITEM-CLOSURE','Cocina','Otro','Fixture de cierre H56',v_actor.id);
  insert into public.order_dispatch_handoffs(order_id,status,packing_user_id,package_signature,note)
  values('H56-ACTIVE-CLOSURE','Ofrecido',v_actor.id,'h56-package-signature','Fixture H56');

  insert into public.production_batches(id,fecha,prod,estado,obs)
  values('H56-BATCH-ACTIVE',date '2000-01-01',1,'En preparación','Fixture H56 activo antiguo');
  insert into public.lote_figuras(batch_id,figura,cant,perfectas,imperfectas,descartadas)
  values('H56-BATCH-ACTIVE','H56 figura',1,0,0,1);
  for g in 1..101 loop
    insert into public.production_batches(id,fecha,prod,estado,obs)
    values('H56-BATCH-TERM-'||lpad(g::text,3,'0'),date '2099-12-31',0,'Descartado','Fixture H56 terminal');
  end loop;
  insert into public.production_batches(id,fecha,prod,estado,obs)
  values('H56-BATCH-REFERENCED',date '1999-01-01',1,'Descartado','Fixture H56 terminal referenciado');
  insert into public.lote_figuras(batch_id,figura,cant,perfectas,imperfectas,descartadas)
  values('H56-BATCH-REFERENCED','H56 figura referenciada',1,0,0,1);
  update public.inventory_reservations
  set batch_id='H56-BATCH-REFERENCED'
  where id='H56-RESERVATION-CLOSURE';

  insert into public.production_suggestions(id,fecha,cantidad,motivo,estado,area)
  values('H56-SUGGESTION-PENDING',date '2000-01-01',1,'Fixture H56 pendiente antigua','Pendiente','Producción');
  for g in 1..101 loop
    insert into public.production_suggestions(id,fecha,cantidad,motivo,estado,area)
    values('H56-SUGGESTION-DONE-'||lpad(g::text,3,'0'),date '2099-12-31',1,'Fixture H56 atendida','Atendida','Producción');
  end loop;

  perform set_config('momos.sync_auth',v_actor.auth_id::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.sync_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$ declare v_manifest jsonb; begin
  v_manifest:=public.momos_sync_manifest_v1();
  assert (v_manifest->>'version')::integer=1, 'Versión de manifiesto inesperada.';
  assert jsonb_typeof(v_manifest->'capabilities')='object', 'Capacidades no consolidadas.';
  assert jsonb_typeof(v_manifest->'domains')='object'
    and v_manifest->'domains' ?& array['catalogos','operativo','agencia'], 'Faltan dominios dirigidos.';
  assert coalesce((v_manifest#>>'{capabilities,roles_multiples_disponible}')::boolean,false),
    'El manifiesto perdió una capacidad instalada.';
  assert coalesce((v_manifest->>'contains_pii')::boolean,true)=false
    and coalesce((v_manifest->>'contains_secrets')::boolean,true)=false
    and coalesce((v_manifest->>'external_execution')::boolean,true)=false,
    'El manifiesto expuso PII, secretos o ejecución.';
  assert v_manifest::text !~* 'email|telefono|direccion|storage[_-]?path|api[_-]?key|secret[_-]?key',
    'El manifiesto transportó datos privados.';
end $$;

do $$ declare v_core jsonb; v_op jsonb; begin
  v_core:=public.momos_core_snapshot_v1();
  v_op:=public.momos_operational_snapshot_v1();
  assert (v_core->>'version')::integer=1 and coalesce((v_core->>'contains_agency')::boolean,true)=false,
    'El snapshot de catalogos mezclo Agencia.';
  assert jsonb_typeof(v_core->'products')='array' and jsonb_typeof(v_core->'inventory_lots')='array',
    'El snapshot de catalogos esta incompleto.';
  assert nullif(v_core->>'server_time','') is not null and nullif(v_op->>'server_time','') is not null,
    'Los snapshots no permiten ordenar commits del servidor.';
  assert v_op->>'server_time'=v_op->>'snapshot_started_at',
    'El snapshot no devolvio el timestamp capturado al inicio.';
  assert jsonb_typeof(v_op->'orders')='array' and jsonb_typeof(v_op->'audit_logs')='array'
    and jsonb_typeof(v_op->'evidences')='array', 'El snapshot operativo esta incompleto.';
  assert not exists(
    select 1 from jsonb_array_elements(v_op->'evidences') e
    where coalesce(e->>'storage_path','') ~ '^(https?|data):'
  ), 'El snapshot firmo o expuso una URL publica de evidencia.';

  assert exists(select 1 from jsonb_array_elements(v_op->'orders') x where x->>'id'='H56-ACTIVE-CLOSURE'),
    'Una orden activa antigua fue expulsada por el limite del historico.';
  assert (select count(*) from jsonb_array_elements(v_op->'orders') x where x->>'id' like 'H56-TERM-%')=50,
    'La ventana terminal de pedidos no quedo acotada a 50.';
  assert exists(select 1 from jsonb_array_elements(v_op->'order_items') x where x->>'id'='H56-ITEM-CLOSURE')
    and exists(select 1 from jsonb_array_elements(v_op->'order_item_adiciones') x where x->>'order_item_id'='H56-ITEM-CLOSURE')
    and exists(select 1 from jsonb_array_elements(v_op->'deliveries') x where x->>'order_id'='H56-ACTIVE-CLOSURE')
    and exists(select 1 from jsonb_array_elements(v_op->'evidences') x where x->>'order_id'='H56-ACTIVE-CLOSURE')
    and exists(select 1 from jsonb_array_elements(v_op->'inventory_reservations') x where x->>'order_id'='H56-ACTIVE-CLOSURE')
    and exists(select 1 from jsonb_array_elements(v_op->'packing_verifications') x where x->>'order_id'='H56-ACTIVE-CLOSURE')
    and exists(select 1 from jsonb_array_elements(v_op->'order_stage_assignments') x where x->>'order_id'='H56-ACTIVE-CLOSURE')
    and exists(select 1 from jsonb_array_elements(v_op->'order_line_progress') x where x->>'order_id'='H56-ACTIVE-CLOSURE')
    and exists(select 1 from jsonb_array_elements(v_op->'order_incidents') x where x->>'order_id'='H56-ACTIVE-CLOSURE')
    and exists(select 1 from jsonb_array_elements(v_op->'order_dispatch_handoffs') x where x->>'order_id'='H56-ACTIVE-CLOSURE'),
    'El snapshot corto al menos una relacion de la orden activa.';

  assert exists(select 1 from jsonb_array_elements(v_op->'production_batches') x where x->>'id'='H56-BATCH-ACTIVE')
    and exists(select 1 from jsonb_array_elements(v_op->'lote_figuras') x where x->>'batch_id'='H56-BATCH-ACTIVE'),
    'Un lote activo antiguo o sus figuras fueron expulsados.';
  assert exists(select 1 from jsonb_array_elements(v_op->'production_batches') x where x->>'id'='H56-BATCH-REFERENCED')
    and exists(select 1 from jsonb_array_elements(v_op->'lote_figuras') x where x->>'batch_id'='H56-BATCH-REFERENCED'),
    'Una reserva seleccionada quedo apuntando a un lote ausente.';
  assert (select count(*) from jsonb_array_elements(v_op->'production_batches') x where x->>'id' like 'H56-BATCH-TERM-%')=50,
    'La ventana terminal de lotes no quedo acotada a 50.';
  assert exists(select 1 from jsonb_array_elements(v_op->'production_suggestions') x where x->>'id'='H56-SUGGESTION-PENDING')
    and (select count(*) from jsonb_array_elements(v_op->'production_suggestions') x where x->>'id' like 'H56-SUGGESTION-DONE-%')=50,
    'Las sugerencias pendientes o su ventana atendida quedaron incompletas.';
end $$;

do $$ declare v_page jsonb; begin
  v_page:=public.momos_history_page_v1(null,25);
  assert (v_page->>'limit')::integer=25 and jsonb_typeof(v_page->'rows')='array',
    'El historial no respeto la pagina solicitada.';
  assert jsonb_array_length(v_page->'rows')<=25, 'El historial excedio el limite.';
  assert not exists(
    select 1
    from jsonb_array_elements(v_page->'rows') with ordinality a(row,n)
    join jsonb_array_elements(v_page->'rows') with ordinality b(row,n) on b.n=a.n+1
    where ((a.row->>'fecha')::timestamptz,a.row->>'id')
        < ((b.row->>'fecha')::timestamptz,b.row->>'id')
  ), 'El historial no conserva el orden fecha DESC, id DESC.';
end $$;

reset role;
select 'TESTS_OK — Data Sync manifiesto/capacidades/dominios/PII/RBAC PASS, rollback total' as resultado;
rollback;
