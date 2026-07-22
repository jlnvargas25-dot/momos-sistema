-- MOMOS OPS · Data Sync y rendimiento v1.
-- Paso 56. Consolida las sondas de capacidades en un manifiesto seguro para
-- que el navegador no ejecute decenas de RPC antes de consultar cada dominio.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260717'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260717_55_identidad_marca'
  ) then raise exception 'Falta el paso 55_identidad_marca.'; end if;
  if to_regclass('public.users') is null then raise exception 'Falta public.users.'; end if;
end $$;

create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_capabilities jsonb;
  v_schema_version text;
begin
  if auth.uid() is null or not exists(
    select 1 from public.users u where u.auth_id=auth.uid() and u.activo
  ) then raise exception 'Sesión MOMOS inválida.' using errcode='42501'; end if;

  select coalesce(jsonb_object_agg(x.name,
    to_regprocedure(format('public.%I()',x.name)) is not null),'{}'::jsonb)
  into v_capabilities
  from unnest(array[
    'roles_multiples_disponible','productos_servidor_disponible','agencia_comercial_disponible',
    'orquestador_agencia_disponible','centro_acciones_agencia_disponible',
    'resultados_acciones_agencia_disponibles','mesa_agencia_disponible','estudio_escenas_disponible',
    'motion_experience_disponible','enrutador_escenas_disponible','calidad_postproduccion_disponible',
    'postproduccion_exportacion_disponible','postproduccion_audio_disponible','retencion_guiones_disponible',
    'retencion_loops_disponible','observatorio_meta_disponible','incrementalidad_meta_disponible',
    'escenarios_inversion_meta_disponible','autorizacion_inversion_meta_disponible',
    'meta_conector_dry_run_disponible','distribucion_comercial_disponible',
    'distribucion_conectores_disponible','biblioteca_creativa_disponible',
    'produccion_creativa_disponible','revision_creativa_disponible','versiones_creativas_disponibles',
    'integraciones_agencia_disponibles','higgsfield_conector_disponible','kling_conector_disponible',
    'gobernanza_marca_disponible','motor_crecimiento_multimodo_disponible','flujo_creativo_e2e_disponible',
    'operacion_pedido_disponible','crm_clientes_disponible','identidad_marca_disponible'
  ]::text[]) as x(name);

  select id into v_schema_version from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  return jsonb_build_object(
    'version',1,
    'schema_version',coalesce(v_schema_version,''),
    'server_time',clock_timestamp(),
    'capabilities',v_capabilities,
    'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object('version',extract(epoch from clock_timestamp())::bigint,'ttl_seconds',60),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300)
    ),
    'contains_pii',false,
    'contains_secrets',false,
    'external_execution',false
  );
end $$;

revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

-- Snapshot compacto de maestros para vistas operativas. SECURITY INVOKER
-- conserva las politicas RLS; Agencia e historicos quedan fuera.
create or replace function public.momos_core_snapshot_v1() returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.users u where u.auth_id=auth.uid() and u.activo
  ) then raise exception 'Sesion MOMOS invalida.' using errcode='42501'; end if;

  return jsonb_build_object(
    'version',1,
    'server_time',clock_timestamp(),
    'products',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
      select id,nombre,cat,tipo,especie,precio,precio_rappi,costo,stock,prep,frio,lejano,activo,descr,combo_size,empaque_item_id,colchon_produccion from public.products order by id
    ) x),'[]'::jsonb),
    'combo_components',coalesce((select jsonb_agg(to_jsonb(x) order by x.component_id) from (
      select combo_id,component_id from public.combo_components order by component_id
    ) x),'[]'::jsonb),
    'inventory_items',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
      select id,nombre,cat,unidad,stock,minimo,costo,proveedor,vence,ubicacion,compra,costo_estimado from public.inventory_items order by id
    ) x),'[]'::jsonb),
    'inventory_lots',coalesce((select jsonb_agg(to_jsonb(x) order by x.item_id,x.expires_at nulls last,x.received_at) from (
      select id,item_id,item_name,unidad,received_at,expires_at,initial_quantity,available_quantity,unit_cost,supplier,location,origin,status from public.v_inventory_lots order by item_id,expires_at nulls last,received_at
    ) x),'[]'::jsonb),
    'recipes',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
      select id,product_id,item_id,cantidad from public.recipes order by id
    ) x),'[]'::jsonb),
    'users',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
      select id,nombre,email,rol,roles,activo from public.users order by id
    ) x),'[]'::jsonb),
    'toppings',coalesce((select jsonb_agg(to_jsonb(x) order by x.orden) from (
      select nombre,precio,insumo_id,insumo_cant,orden from public.toppings where activo order by orden
    ) x),'[]'::jsonb),
    'figuras',coalesce((select jsonb_agg(to_jsonb(x) order by x.orden) from (
      select nombre,especie,gramaje_g,product_id,activo,orden from public.figuras order by orden
    ) x),'[]'::jsonb),
    'catalog_values',coalesce((select jsonb_agg(to_jsonb(x) order by x.orden) from (
      select categoria,valor,orden from public.catalog_values where activo order by orden
    ) x),'[]'::jsonb),
    'zonas',coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from (
      select nombre,tarifa from public.zonas order by nombre
    ) x),'[]'::jsonb),
    'proveedores_domicilio',coalesce((select jsonb_agg(to_jsonb(x) order by x.orden) from (
      select nombre,orden from public.proveedores_domicilio where activo order by orden
    ) x),'[]'::jsonb),
    'brand_library',coalesce((select to_jsonb(x) from (
      select frases,tono,palabras_si,palabras_no from public.brand_library limit 1
    ) x),'null'::jsonb),
    'app_settings',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select clave,valor from public.app_settings
    ) x),'[]'::jsonb),
    'subrecetas',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
      select id,nombre,tipo,sabor,merma_pct,rinde_g,item_id,activo from public.subrecetas order by id
    ) x),'[]'::jsonb),
    'subreceta_ingredientes',coalesce((select jsonb_agg(to_jsonb(x) order by x.subreceta_id) from (
      select subreceta_id,item_id,cantidad from public.subreceta_ingredientes order by subreceta_id
    ) x),'[]'::jsonb),
    'figura_relleno',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
      select id,subreceta_id,gramos_por_unidad,activo from public.figura_relleno order by id
    ) x),'[]'::jsonb),
    'contains_agency',false
  );
end $$;

revoke all on function public.momos_core_snapshot_v1() from public,anon,service_role;
grant execute on function public.momos_core_snapshot_v1() to authenticated;

-- Snapshot acotado de la bandeja operativa. Las evidencias conservan solo su
-- ruta privada y se firman individualmente cuando una persona las abre.
create or replace function public.momos_operational_snapshot_v1() returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
  -- Se captura antes de cualquier lectura para que el cliente pueda descartar
  -- respuestas antiguas sin confundir la hora de finalizacion con la del corte.
  v_snapshot_started_at timestamptz:=clock_timestamp();
  v_result jsonb;
begin
  if auth.uid() is null or not exists(
    select 1 from public.users u where u.auth_id=auth.uid() and u.activo
  ) then raise exception 'Sesion MOMOS invalida.' using errcode='42501'; end if;

  -- Cierre relacional: nunca se limita una tabla hija de manera independiente.
  -- El conjunto raiz contiene toda la operacion viva y solo una ventana acotada
  -- del historico terminal. Asi una orden activa antigua conserva cada linea,
  -- evidencia, reserva y control que la explica.
  with selected_orders as materialized (
    select o.*
    from public.orders o
    where o.estado not in ('Entregado','Cancelado')
    union all
    select terminal.*
    from (
      select o.*
      from public.orders o
      where o.estado in ('Entregado','Cancelado')
      order by o.fecha desc,o.hora desc,o.id desc
      limit 50
    ) terminal
  ),
  selected_order_ids as materialized (
    select id from selected_orders
  ),
  selected_order_items as materialized (
    select oi.*
    from public.order_items oi
    join selected_order_ids so on so.id=oi.order_id
  ),
  selected_reservations as materialized (
    select r.*
    from public.inventory_reservations r
    join selected_order_ids so on so.id=r.order_id
  ),
  selected_suggestions as materialized (
    select ps.*
    from public.production_suggestions ps
    where ps.estado='Pendiente'
    union all
    select attended.*
    from (
      select ps.*
      from public.production_suggestions ps
      where ps.estado='Atendida'
      order by ps.fecha desc,ps.id desc
      limit 50
    ) attended
  ),
  selected_batches as materialized (
    select pb.*
    from public.production_batches pb
    where pb.estado in ('En preparación','Congelando','Reservado')
    union
    select terminal.*
    from (
      select pb.*
      from public.production_batches pb
      where pb.estado not in ('En preparación','Congelando','Reservado')
      order by pb.fecha desc,pb.id desc
      limit 50
    ) terminal
    union
    select pb.*
    from public.production_batches pb
    join selected_reservations r on r.batch_id=pb.id
  ),
  selected_batch_ids as materialized (
    select id from selected_batches
  )
  select jsonb_build_object(
    'version',1,
    'server_time',v_snapshot_started_at,
    'snapshot_started_at',v_snapshot_started_at,
    'orders',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.hora desc,x.id desc) from (
      select id,fecha,hora,canal,customer_id,barrio,direccion,zona,dom_cobrado,dom_costo,descuento,benefit_id,pago,comprobante,estado,obs,pagado_en,metricas_cliente_actualizadas,campaign_id,creative_id,origen_detalle from selected_orders
    ) x),'[]'::jsonb),
    'order_items',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
      select id,order_id,product_id,nombre,sabor,salsa,relleno,figura,cant,precio,costo_unitario,es_caja,parent_item_id,caja_num,es_sub_momo from selected_order_items
    ) x),'[]'::jsonb),
    'order_item_adiciones',coalesce((select jsonb_agg(to_jsonb(x) order by x.order_item_id,x.id) from (
      select a.id,a.order_item_id,a.nombre,a.precio,a.cant,a.insumo_id,a.insumo_cant
      from public.order_item_adiciones a
      join selected_order_items oi on oi.id=a.order_item_id
    ) x),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(to_jsonb(x) order by x.ultima desc nulls last) from (
      select c.id,c.nombre,c.telefono,c.instagram,c.barrio,c.direccion,c.canal,c.primera,c.ultima,c.total,c.pedidos,c.cumple,c.favoritos,c.estado,c.notas
      from public.customers c
      where c.id in (select customer_id from selected_orders)
         or c.id in (select rc.id from public.customers rc order by rc.ultima desc nulls last,rc.id limit 250)
    ) x),'[]'::jsonb),
    'deliveries',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
      select d.id,d.order_id,d.proveedor,d.costo_real,d.cobrado,d.zona,d.h_solicitud,d.h_salida,d.h_entrega,d.codigo,d.estado,d.obs
      from public.deliveries d join selected_order_ids so on so.id=d.order_id
    ) x),'[]'::jsonb),
    'evidences',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc) from (
      select e.id,e.order_id,e.tipo,e.storage_path,e.fecha,e.user_id
      from public.evidences e join selected_order_ids so on so.id=e.order_id
    ) x),'[]'::jsonb),
    'benefits',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
      select id,customer_id,beneficio,tipo_beneficio,valor,producto_gratis_id,condicion,minimo,activacion,vence,estado,pedido_uso,obs from public.benefits order by id desc limit 100
    ) x),'[]'::jsonb),
    'claims',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
      select c.id,c.order_id,c.customer_id,c.fecha,c.tipo,c.entregado_en,c.reclamo_en,c.descr,c.resp,c.decision,c.solucion,c.costo,c.estado,c.evidencia
      from public.claims c join selected_order_ids so on so.id=c.order_id
    ) x),'[]'::jsonb),
    'inventory_movements',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc) from (
      select id,fecha,tipo,item_id,cant,nota from public.inventory_movements order by fecha desc limit 50
    ) x),'[]'::jsonb),
    'inventory_reservations',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
      select id,order_id,tipo,product_id,item_id,nombre,cantidad,fecha,estado,batch_id,figura
      from selected_reservations
    ) x),'[]'::jsonb),
    'production_suggestions',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc) from (
      select id,fecha,product_id,item_id,cantidad,motivo,order_id,estado,area,order_item_id from selected_suggestions
    ) x),'[]'::jsonb),
    'audit_logs',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc) from (
      select id,fecha,user_id,entidad,entidad_id,accion,de,a from public.audit_logs order by fecha desc,id desc limit 50
    ) x),'[]'::jsonb),
    'history_cursor',coalesce((select jsonb_build_object('at',x.fecha,'id',x.id) from (
      select fecha,id from public.audit_logs order by fecha desc,id desc offset 49 limit 1
    ) x),'null'::jsonb),
    'users_lookup',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,rol,nombre from public.users order by id) x),'[]'::jsonb),
    'inventory_lookup',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,nombre,unidad from public.inventory_items order by id) x),'[]'::jsonb),
    'products_lookup',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id,nombre from public.products order by id) x),'[]'::jsonb),
    'production_batches',coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc) from (
      select id,fecha,product_id,figura,sabor,relleno,salsa,gramaje_g,prod,perfectas,imperfectas,descartadas,destino,resp_user_id,vence,estado,stock_contabilizado,horas_congelacion,inicio_congelacion,molde,ubicacion,obs,corrida_id,figuras from selected_batches
    ) x),'[]'::jsonb),
    'lote_figuras',coalesce((select jsonb_agg(to_jsonb(x) order by x.batch_id desc,x.figura) from (
      select lf.batch_id,lf.figura,lf.cant,lf.perfectas,lf.imperfectas,lf.descartadas,lf.consumidas
      from public.lote_figuras lf join selected_batch_ids sb on sb.id=lf.batch_id
    ) x),'[]'::jsonb),
    'subreceta_producciones',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select id,fecha,subreceta_id,gramos_nominales,gramos_obtenidos,costo_batch,faltantes,resp_user_id,obs,created_at from public.subreceta_producciones order by created_at desc limit 50
    ) x),'[]'::jsonb),
    'variantes',coalesce((select jsonb_agg(to_jsonb(x) order by x.producto,x.figura,x.sabor) from (
      select product_id,producto,figura,sabor,gramaje_g,disponibles,vencimiento_proximo from public.v_variantes_disponibles
    ) x),'[]'::jsonb),
    'variantes_cuarentena',coalesce((select jsonb_agg(to_jsonb(x) order by x.producto,x.figura,x.sabor) from (
      select product_id,producto,figura,sabor,gramaje_g,disponibles,vencimiento_proximo from public.v_variantes_cuarentena
    ) x),'[]'::jsonb),
    'packing_verifications',coalesce((select jsonb_agg(to_jsonb(x) order by x.verified_at desc) from (
      select p.order_id,p.user_id,p.verified_at,p.line_ids,p.order_signature,p.snapshot
      from public.packing_verifications p join selected_order_ids so on so.id=p.order_id
    ) x),'[]'::jsonb),
    'order_stage_assignments',coalesce((select jsonb_agg(to_jsonb(x) order by x.claimed_at desc,x.id desc) from (
      select s.id,s.order_id,s.stage,s.user_id,s.status,s.claimed_at,s.released_at,s.release_reason
      from public.order_stage_assignments s join selected_order_ids so on so.id=s.order_id
    ) x),'[]'::jsonb),
    'order_line_progress',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.order_item_id desc) from (
      select p.order_item_id,p.order_id,p.stage,p.status,p.user_id,p.updated_at,p.version
      from public.order_line_progress p join selected_order_ids so on so.id=p.order_id
    ) x),'[]'::jsonb),
    'order_incidents',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
      select i.id,i.order_id,i.order_item_id,i.area,i.type,i.description,i.status,i.created_by,i.created_at,i.resolved_by,i.resolved_at,i.resolution
      from public.order_incidents i join selected_order_ids so on so.id=i.order_id
    ) x),'[]'::jsonb),
    'order_dispatch_handoffs',coalesce((select jsonb_agg(to_jsonb(x) order by x.offered_at desc,x.order_id desc) from (
      select h.order_id,h.status,h.packing_user_id,h.logistics_user_id,h.offered_at,h.accepted_at,h.package_signature,h.note,h.version
      from public.order_dispatch_handoffs h join selected_order_ids so on so.id=h.order_id
    ) x),'[]'::jsonb),
    'customer_crm_profiles',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select customer_id,contact_allowed,contact_reason,preferred_channel,acquisition_source,referred_by_customer_id,updated_by,updated_at from public.customer_crm_profiles
    ) x),'[]'::jsonb),
    'customer_contacts',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select id,customer_id,channel,reason,outcome,notes,follow_up_on,activation_id,order_id,created_by,created_at from public.customer_contacts order by created_at desc limit 100
    ) x),'[]'::jsonb),
    'customer_activations',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select id,customer_id,type,title,message,status,benefit_id,expires_on,converted_order_id,created_by,created_at,updated_at from public.customer_activations order by created_at desc limit 100
    ) x),'[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.momos_operational_snapshot_v1() from public,anon,service_role;
grant execute on function public.momos_operational_snapshot_v1() to authenticated;

create or replace function public.momos_history_page_v1(p_cursor jsonb default null,p_limit integer default 50)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
  v_limit integer:=least(50,greatest(1,coalesce(p_limit,50)));
  v_at timestamptz:=nullif(p_cursor->>'at','')::timestamptz;
  v_id text:=coalesce(p_cursor->>'id','');
  v_rows jsonb;
  v_next jsonb;
begin
  if auth.uid() is null or not exists(
    select 1 from public.users u where u.auth_id=auth.uid() and u.activo
  ) then raise exception 'Sesion MOMOS invalida.' using errcode='42501'; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc),'[]'::jsonb)
  into v_rows from (
    select a.id,a.fecha,coalesce(u.rol,'') as "user",a.entidad,a.entidad_id,a.accion,a.de,a.a
    from public.audit_logs a left join public.users u on u.id=a.user_id
    where v_at is null or (a.fecha,a.id)<(v_at,v_id)
    order by a.fecha desc,a.id desc limit v_limit
  ) x;

  if jsonb_array_length(v_rows)=v_limit then
    select jsonb_build_object('at',x.fecha,'id',x.id) into v_next from (
      select a.fecha,a.id from public.audit_logs a
      where v_at is null or (a.fecha,a.id)<(v_at,v_id)
      order by a.fecha desc,a.id desc offset (v_limit-1) limit 1
    ) x;
  end if;
  return jsonb_build_object('rows',v_rows,'next_cursor',v_next,'limit',v_limit);
end $$;

revoke all on function public.momos_history_page_v1(jsonb,integer) from public,anon,service_role;
grant execute on function public.momos_history_page_v1(jsonb,integer) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260717_56_data_sync_rendimiento',
  'Manifiesto único de capacidades, dominios dirigidos y contrato seguro para sincronización incremental')
on conflict(id) do update set detalle=excluded.detalle;

commit;
