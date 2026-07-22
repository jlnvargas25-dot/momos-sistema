-- MOMOS OPS · H64 Integridad del snapshot operativo y Realtime v1.
-- Forward-only: conserva el contrato JSON de H56, mantiene RBAC y evita que
-- la ventana de 50 lotes terminales expulse producto terminado aún vendible.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260718'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_63_mcp_aprobacion_humana_rbac'
  ) then
    raise exception 'Falta el paso 63_mcp_aprobacion_humana_rbac.';
  end if;
  if to_regprocedure('public.momos_operational_snapshot_v1()') is null then
    raise exception 'Falta momos_operational_snapshot_v1() de H56.';
  end if;
end $$;

-- Copia contractual de H56. El único cambio funcional está en selected_batches:
-- además de lotes en proceso y reservados, retiene todo lote Listo que siga
-- vigente, contabilizado y con al menos una pieza perfecta no consumida.
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
       or (
         pb.estado='Listo'
         and pb.stock_contabilizado
         and (coalesce(pb.vencimiento,pb.vence) is null or coalesce(pb.vencimiento,pb.vence)>=current_date)
         and exists(
           select 1 from public.lote_figuras lf
           where lf.batch_id=pb.id and (lf.perfectas-lf.consumidas)>0
         )
       )
    union
    select terminal.*
    from (
      select pb.*
      from public.production_batches pb
      where not (
        pb.estado in ('En preparación','Congelando','Reservado')
        or (
          pb.estado='Listo'
          and pb.stock_contabilizado
          and (coalesce(pb.vencimiento,pb.vence) is null or coalesce(pb.vencimiento,pb.vence)>=current_date)
          and exists(
            select 1 from public.lote_figuras lf
            where lf.batch_id=pb.id and (lf.perfectas-lf.consumidas)>0
          )
        )
      )
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

-- CREATE OR REPLACE conserva ACL existentes; se vuelve a sellar la frontera
-- explícitamente para que el contrato permanezca idéntico al de H56.
revoke all on function public.momos_operational_snapshot_v1() from public,anon,service_role;
grant execute on function public.momos_operational_snapshot_v1() to authenticated;

-- Tablas base que la app escucha siempre. La publicación es aditiva,
-- idempotente y omite de forma defensiva cualquier relación no instalada.
do $$
declare
  v_table text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array[
      'orders','order_items','order_item_adiciones','packing_verifications','evidences','deliveries',
      'customers','benefits','claims','inventory_movements','inventory_reservations','production_suggestions',
      'production_batches','lote_figuras','subreceta_producciones','audit_logs',
      'products','combo_components','inventory_items','inventory_lots','recipes','users','toppings','figuras',
      'catalog_values','zonas','proveedores_domicilio','brand_library','app_settings','subrecetas',
      'subreceta_ingredientes','figura_relleno'
    ] loop
      if to_regclass(format('public.%I',v_table)) is not null and not exists(
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260718_64_integridad_snapshot_realtime',
  'Snapshot operativo conserva lotes Listo vendibles vigentes y publica idempotentemente las tablas base escuchadas por Data Sync')
on conflict(id) do update set detalle=excluded.detalle;

commit;
