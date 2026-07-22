-- MOMOS OPS · H67 Hechos operativos compactos de Agencia v1.
--
-- Agencia deja de necesitar los snapshots completos de Catalogos y Operacion
-- para decidir que vender, producir o preparar. Este contrato solo proyecta
-- hechos agregados y catalogos operativos cerrados: nunca clientes, telefonos,
-- direcciones, observaciones, proveedores, rutas de Storage ni secretos.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260718'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_66_agency_snapshot_rendimiento'
  ) then
    raise exception 'Falta el paso 66_agency_snapshot_rendimiento.';
  end if;
  if to_regprocedure('public.momos_agency_snapshots_v1()') is null
     or to_regprocedure('public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)') is null then
    raise exception 'Falta el contrato canonico H66 de Agencia.';
  end if;
  if to_regclass('public.v_variantes_disponibles') is null
     or to_regclass('public.v_inventory_lots') is null then
    raise exception 'Faltan las vistas canonicas de stock por lote y variante.';
  end if;
end $$;

-- Lista cerrada de las fuentes operativas que cambian alguno de los hechos
-- H67. Las fuentes de Agencia (campanas, creativos y Meta) ya estan cubiertas
-- por H66 y no se duplican aqui.
create or replace function public._momos_agency_operational_source_tables_v1()
returns text[]
language sql
immutable
set search_path=pg_catalog,public,pg_temp
as $$
  select array[
    'products','combo_components','inventory_items','inventory_lots','recipes',
    'orders','order_items','production_suggestions','production_batches',
    'lote_figuras','subrecetas','customers','customer_crm_profiles'
  ]::text[];
$$;

revoke all on function public._momos_agency_operational_source_tables_v1()
  from public,anon,authenticated,service_role;

-- Proyeccion compacta. Todos los calculos comparten el mismo snapshot MVCC de
-- la sentencia que invoca momos_agency_snapshots_v2(). Los limites son parte
-- explicita del contrato; `counts` permite que el cliente falle cerrado si en
-- el futuro una coleccion excede el limite acordado.
create or replace function public._momos_agency_operational_facts_payload_v1()
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog,public,pg_temp
set timezone='America/Bogota'
as $$
with
business_clock as materialized (
  -- Toda la proyeccion usa el dia comercial de MOMOS, independiente del
  -- TimeZone de la sesion que invoque el RPC.
  select (statement_timestamp() at time zone 'America/Bogota')::date as business_date
),
paid_orders_all as materialized (
  select o.id,o.fecha,o.pagado_en,o.campaign_id,o.creative_id,
    coalesce((o.pagado_en at time zone 'America/Bogota')::date,o.fecha) as paid_on
  from public.orders o
  where o.estado<>'Cancelado'
    and (
      o.pagado_en is not null
      or o.estado in (
        'Pagado','En producción','Listo para empaque','Empacado',
        'Listo para despacho','En ruta','Entregado','Reclamo'
      )
    )
),
paid_orders_30 as materialized (
  select id,fecha,pagado_en,campaign_id,creative_id,paid_on
  from paid_orders_all cross join business_clock bc
  where paid_on between bc.business_date-29 and bc.business_date
),
all_commercial_lines as materialized (
  -- Agregacion set-based: order_items se recorre una sola vez para el resumen
  -- historico, sin una subconsulta LATERAL por cada pedido pagado.
  select oi.order_id,
    sum(greatest(1,oi.cant))::numeric as units,
    sum(greatest(0,oi.precio)*greatest(1,oi.cant))::numeric as revenue
  from paid_orders_all po
  join public.order_items oi on oi.order_id=po.id
  where oi.parent_item_id is null
  group by oi.order_id
),
paid_all_summary as materialized (
  select count(*) as orders_all,
    coalesce(sum(lines.units),0) as units_all,
    coalesce(sum(lines.revenue),0) as revenue_all,
    count(*) filter(where po.paid_on=bc.business_date) as orders_today,
    coalesce(sum(lines.units) filter(where po.paid_on=bc.business_date),0) as units_today,
    coalesce(sum(lines.revenue) filter(where po.paid_on=bc.business_date),0) as revenue_today,
    count(*) filter(where po.campaign_id is not null or po.creative_id is not null) as attributed_orders_all
  from paid_orders_all po
  cross join business_clock bc
  left join all_commercial_lines lines on lines.order_id=po.id
),
commercial_lines as materialized (
  select po.id as order_id,po.fecha,po.pagado_en,po.campaign_id,po.creative_id,
    oi.product_id,greatest(1,oi.cant)::numeric as units,
    greatest(0,oi.precio)*greatest(1,oi.cant) as revenue
  from paid_orders_30 po
  join public.order_items oi on oi.order_id=po.id and oi.parent_item_id is null
),
product_demand as materialized (
  select product_id,count(distinct order_id) as paid_orders_30d,
    sum(units) as paid_units_30d,sum(revenue) as revenue_30d,
    count(distinct order_id) filter(where campaign_id is not null or creative_id is not null) as attributed_orders_30d,
    max(coalesce((pagado_en at time zone 'America/Bogota')::date,fecha)) as last_paid_on
  from commercial_lines group by product_id
),
physical_lines as materialized (
  select po.id as order_id,po.campaign_id,po.creative_id,oi.product_id,
    nullif(btrim(oi.figura),'') as figure,nullif(btrim(oi.sabor),'') as flavor,
    coalesce(nullif(btrim(oi.relleno),''),'') as filling,
    greatest(1,oi.cant)::numeric as units
  from paid_orders_30 po
  join public.order_items oi on oi.order_id=po.id
  join public.products p on p.id=oi.product_id and p.activo and p.tipo='momo'
  where nullif(btrim(oi.figura),'') is not null
    and nullif(btrim(oi.sabor),'') is not null
),
variant_demand as materialized (
  select product_id,figure,flavor,filling,sum(units) as paid_units_30d,
    sum(units) filter(where campaign_id is not null or creative_id is not null) as attributed_units_30d,
    count(distinct order_id) as paid_orders_30d
  from physical_lines group by product_id,figure,flavor,filling
),
variant_queue as materialized (
  select coalesce(ps.product_id,oi.product_id) as product_id,
    coalesce(nullif(btrim(oi.figura),''),'') as figure,
    coalesce(nullif(btrim(oi.sabor),''),'') as flavor,
    coalesce(nullif(btrim(oi.relleno),''),'') as filling,
    sum(greatest(0,ps.cantidad)) as queue_units,
    count(*) as suggestion_count
  from public.production_suggestions ps
  left join public.order_items oi on oi.id=ps.order_item_id
  where ps.estado='Pendiente' and ps.area='Producción'
    and coalesce(ps.product_id,oi.product_id) is not null
  group by coalesce(ps.product_id,oi.product_id),
    coalesce(nullif(btrim(oi.figura),''),''),
    coalesce(nullif(btrim(oi.sabor),''),''),
    coalesce(nullif(btrim(oi.relleno),''),'')
),
active_batch_rows as materialized (
  select pb.id,pb.product_id,
    coalesce(nullif(btrim(j.row->>'figura'),''),nullif(btrim(pb.figura),''),'') as figure,
    coalesce(nullif(btrim(pb.sabor),''),'') as flavor,
    coalesce(nullif(btrim(pb.relleno),''),'') as filling,
    case when coalesce(j.row->>'cant','') ~ '^[0-9]+([.][0-9]+)?$'
      then greatest(0,(j.row->>'cant')::numeric)
      else greatest(0,pb.prod)::numeric end as units
  from public.production_batches pb
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(pb.figuras)='array' then
      case when jsonb_array_length(pb.figuras)>0 then pb.figuras
        else jsonb_build_array(jsonb_build_object('figura',pb.figura,'cant',pb.prod)) end
    else jsonb_build_array(jsonb_build_object('figura',pb.figura,'cant',pb.prod)) end
  ) j(row)
  where pb.estado in ('En preparación','Congelando') and pb.product_id is not null
),
variant_process as materialized (
  select product_id,figure,flavor,filling,sum(units) as in_process_units,
    count(distinct id) as active_batches
  from active_batch_rows group by product_id,figure,flavor,filling
),
variant_stock as materialized (
  select product_id,coalesce(figura,'') as figure,coalesce(sabor,'') as flavor,
    sum(greatest(0,disponibles)) as available_units,
    min(vencimiento_proximo) as expires_on
  from public.v_variantes_disponibles
  group by product_id,coalesce(figura,''),coalesce(sabor,'')
),
variant_keys as materialized (
  select product_id,figure,flavor,filling from variant_demand
  union select product_id,figure,flavor,filling from variant_queue
  union select product_id,figure,flavor,filling from variant_process
  union select product_id,figure,flavor,'' from variant_stock
),
variant_facts as materialized (
  select k.product_id,p.nombre as product_name,k.figure,k.flavor,k.filling,
    'product-figure-flavor'::text as stock_scope,
    true as stock_shared_across_fillings,
    coalesce(s.available_units,0) as available_units,s.expires_on,
    coalesce(q.queue_units,0) as queue_units,coalesce(q.suggestion_count,0) as suggestion_count,
    coalesce(pr.in_process_units,0) as in_process_units,coalesce(pr.active_batches,0) as active_batches,
    coalesce(d.paid_units_30d,0) as paid_units_30d,
    coalesce(d.attributed_units_30d,0) as attributed_units_30d,
    coalesce(d.paid_orders_30d,0) as paid_orders_30d
  from variant_keys k
  join public.products p on p.id=k.product_id and p.activo
  left join variant_stock s on s.product_id=k.product_id and s.figure=k.figure and s.flavor=k.flavor
  left join variant_queue q on q.product_id=k.product_id and q.figure=k.figure and q.flavor=k.flavor and q.filling=k.filling
  left join variant_process pr on pr.product_id=k.product_id and pr.figure=k.figure and pr.flavor=k.flavor and pr.filling=k.filling
  left join variant_demand d on d.product_id=k.product_id and d.figure=k.figure and d.flavor=k.flavor and d.filling=k.filling
),
lot_rollup as materialized (
  select l.item_id,
    count(*) filter(where l.available_quantity>0) as available_lot_count,
    coalesce(sum(l.available_quantity) filter(
      where l.available_quantity>0 and (l.expires_at is null or l.expires_at>=bc.business_date)
    ),0) as usable_stock
  from public.v_inventory_lots l cross join business_clock bc group by l.item_id
),
usable_inventory as materialized (
  select i.id,i.unidad,i.minimo,
    case when coalesce(l.available_lot_count,0)>0 then l.usable_stock else greatest(0,i.stock) end as usable_stock
  from public.inventory_items i left join lot_rollup l on l.item_id=i.id
),
recipe_capacity as materialized (
  select r.product_id,min(floor(ui.usable_stock/r.cantidad)) as recipe_capacity_units,
    count(*) as recipe_lines
  from public.recipes r join usable_inventory ui on ui.id=r.item_id
  where r.cantidad>0 group by r.product_id
),
exact_product_stock as materialized (
  select product_id,sum(available_units) as exact_stock_units
  from variant_stock group by product_id
),
simple_product_capacity as materialized (
  select p.id as product_id,
    coalesce(es.exact_stock_units,p.stock,rc.recipe_capacity_units) as capacity_units
  from public.products p
  left join exact_product_stock es on es.product_id=p.id
  left join recipe_capacity rc on rc.product_id=p.id
),
combo_capacity as materialized (
  select combo.id as product_id,
    least(
      floor(sum(greatest(0,coalesce(cp.capacity_units,0)))/greatest(1,combo.combo_size)),
      floor(greatest(0,pack.usable_stock))
    ) as combo_capacity_units
  from public.products combo
  join public.combo_components cc on cc.combo_id=combo.id
  join simple_product_capacity cp on cp.product_id=cc.component_id
  join usable_inventory pack on pack.id=combo.empaque_item_id
  where combo.tipo='combo' and combo.activo
  group by combo.id,combo.combo_size,pack.usable_stock
),
product_queue as materialized (
  select product_id,sum(queue_units) as queue_units,sum(suggestion_count) as pending_suggestions
  from variant_queue group by product_id
),
product_process as materialized (
  select product_id,sum(in_process_units) as in_process_units,sum(active_batches) as active_batches
  from variant_process group by product_id
),
product_facts as materialized (
  select p.id as product_id,p.nombre as name,p.cat as category,p.tipo as type,p.especie as species,
    p.precio as price,p.activo as active,
    coalesce(p.colchon_produccion,0) as production_buffer,
    coalesce(es.exact_stock_units,0) as exact_stock_units,
    case when p.stock is null then null else greatest(0,p.stock) end as legacy_stock_units,
    rc.recipe_capacity_units,cc.combo_capacity_units,
    case when p.tipo='combo' then cc.combo_capacity_units
      else coalesce(es.exact_stock_units,p.stock,rc.recipe_capacity_units) end as sellable_units,
    case when p.tipo='combo' then 'combo-capacity'
      when es.product_id is not null then 'exact-variants'
      when p.stock is not null then 'legacy-product'
      when rc.product_id is not null then 'recipe-capacity'
      else 'unverified' end as stock_source,
    coalesce(d.paid_orders_30d,0) as paid_orders_30d,coalesce(d.paid_units_30d,0) as paid_units_30d,
    coalesce(d.revenue_30d,0) as revenue_30d,coalesce(d.attributed_orders_30d,0) as attributed_orders_30d,
    d.last_paid_on,coalesce(q.queue_units,0) as queue_units,
    coalesce(q.pending_suggestions,0) as pending_suggestions,
    coalesce(pr.in_process_units,0) as in_process_units,coalesce(pr.active_batches,0) as active_batches
  from public.products p
  left join product_demand d on d.product_id=p.id
  left join exact_product_stock es on es.product_id=p.id
  left join recipe_capacity rc on rc.product_id=p.id
  left join combo_capacity cc on cc.product_id=p.id
  left join product_queue q on q.product_id=p.id
  left join product_process pr on pr.product_id=p.id
  where p.activo
),
preparation_facts as materialized (
  select s.id as subrecipe_id,s.nombre as name,coalesce(s.sabor,'') as flavor,ui.unidad,
    ui.usable_stock as current_stock,ui.minimo as minimum_stock,
    greatest(0,ui.minimo-ui.usable_stock) as below_minimum_by
  from public.subrecetas s
  join usable_inventory ui on ui.id=s.item_id
  where s.activo
),
campaign_attribution as materialized (
  select campaign_id,count(distinct order_id) as paid_orders_30d,
    sum(units) as paid_units_30d,sum(revenue) as revenue_30d
  from commercial_lines where campaign_id is not null group by campaign_id
),
creative_attribution as materialized (
  select creative_id,count(distinct order_id) as paid_orders_30d,
    sum(units) as paid_units_30d,sum(revenue) as revenue_30d
  from commercial_lines where creative_id is not null group by creative_id
),
published_posts as materialized (
  select cp.id as post_id,cp.creative_id,
    count(*) over(partition by cp.creative_id) as posts_for_creative
  from public.content_posts cp
  where cp.estado='Publicado' and cp.creative_id is not null
),
published_post_attribution as materialized (
  select pp.post_id,
    case when pp.posts_for_creative=1 then coalesce(ca.paid_orders_30d,0) else 0 end as paid_orders_30d,
    case when pp.posts_for_creative=1 then coalesce(ca.revenue_30d,0) else 0 end as revenue_30d,
    case when pp.posts_for_creative>1 then coalesce(ca.paid_orders_30d,0) else 0 end as ambiguous_orders,
    case when pp.posts_for_creative=1 then 'creative-exact-single-post' else 'ambiguous-creative-multiple-posts' end as attribution_method
  from published_posts pp left join creative_attribution ca on ca.creative_id=pp.creative_id
),
calendar_days as materialized (
  select cp.fecha,count(*) as posts,
    count(*) filter(where cp.estado='Publicado') as published,
    count(*) filter(where cp.estado<>'Publicado') as pending
  from public.content_posts cp cross join business_clock bc
  where cp.fecha between bc.business_date and bc.business_date+7
  group by cp.fecha
),
production_plan_variants as materialized (
  select vf.product_id,vf.figure,vf.flavor,vf.filling,
    greatest(
      vf.queue_units,
      greatest(0,ceil((vf.paid_units_30d/30.0)*3)-vf.available_units-vf.in_process_units)
    ) as plan_units
  from variant_facts vf
),
crm_segment_counts as materialized (
  select
    count(*) filter(
      where cp.contact_allowed
        and case cp.preferred_channel
          when 'WhatsApp' then regexp_replace(coalesce(c.telefono,''),'\D','','g') ~ '^[0-9]{7,15}$'
          when 'Llamada' then regexp_replace(coalesce(c.telefono,''),'\D','','g') ~ '^[0-9]{7,15}$'
          when 'Instagram' then nullif(btrim(c.instagram),'') is not null
          else false
        end
        and nullif(c.cumple,'') is not null
        and exists(
          -- Siete dias calendario inclusivos: hoy hasta hoy + 6.
          select 1 from generate_series(bc.business_date,bc.business_date+6,interval '1 day') d(day)
          where to_char(d.day,'MM-DD')=c.cumple
        )
    ) as birthdays_7d,
    count(*) filter(
      where cp.contact_allowed
        and case cp.preferred_channel
          when 'WhatsApp' then regexp_replace(coalesce(c.telefono,''),'\D','','g') ~ '^[0-9]{7,15}$'
          when 'Llamada' then regexp_replace(coalesce(c.telefono,''),'\D','','g') ~ '^[0-9]{7,15}$'
          when 'Instagram' then nullif(btrim(c.instagram),'') is not null
          else false
        end
        and c.ultima is not null and c.ultima<bc.business_date-30
    ) as dormant_30d
  from public.customers c
  join public.customer_crm_profiles cp on cp.customer_id=c.id
  cross join business_clock bc
),
counts as materialized (
  select
    (select count(*) from product_facts) as product_catalog,
    (select count(*) from product_facts where paid_orders_30d>0) as product_sales_30d,
    (select count(*) from campaign_attribution) as campaign_attribution,
    (select count(*) from creative_attribution) as creative_attribution,
    (select count(*) from published_post_attribution) as published_post_attribution,
    (select count(*) from preparation_facts where current_stock<minimum_stock) as critical_preparations
)
select jsonb_build_object(
  'facts_ready',true,
  'contract_version',1,
  'as_of',(select business_date from business_clock),
  'business_timezone','America/Bogota',
  'window_days',jsonb_build_object(
    'demand',30,'production_horizon',3,'crm_birthdays',7,
    'crm_birthdays_inclusive_end_offset',6,'calendar_upcoming',7
  ),
  'limits',jsonb_build_object(
    'product_catalog',500,'product_sales_30d',500,
    'campaign_attribution',500,'creative_attribution',500,'published_post_attribution',500,
    'critical_preparations',50
  ),
  'counts',(select to_jsonb(counts) from counts),
  'truncated',jsonb_build_object(
    'product_catalog',(select product_catalog>500 from counts),
    'product_sales_30d',(select product_sales_30d>500 from counts),
    'campaign_attribution',(select campaign_attribution>500 from counts),
    'creative_attribution',(select creative_attribution>500 from counts),
    'published_post_attribution',(select published_post_attribution>500 from counts),
    'critical_preparations',(select critical_preparations>50 from counts)
  ),
  'paid_summary',jsonb_build_object(
    'orders_all',coalesce((select orders_all from paid_all_summary),0),
    'units_all',coalesce((select units_all from paid_all_summary),0),
    'revenue_all',coalesce((select revenue_all from paid_all_summary),0),
    'orders_today',coalesce((select orders_today from paid_all_summary),0),
    'units_today',coalesce((select units_today from paid_all_summary),0),
    'revenue_today',coalesce((select revenue_today from paid_all_summary),0),
    'attributed_orders_all',coalesce((select attributed_orders_all from paid_all_summary),0),
    'orders_30d',(select count(*) from paid_orders_30),
    'units_30d',coalesce((select sum(units) from commercial_lines),0),
    'revenue_30d',coalesce((select sum(revenue) from commercial_lines),0),
    'attributed_orders_30d',(
      select count(*) from paid_orders_30 where campaign_id is not null or creative_id is not null
    ),
    'revenue_basis','top-level-order-lines'
  ),
  'product_catalog',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
    select product_id as id,name,category,type,species,price,active,
      sellable_units as available_stock,stock_source,queue_units,in_process_units,
      production_buffer
    from product_facts order by product_id limit 500
  ) x),'[]'::jsonb),
  'product_sales_30d',coalesce((select jsonb_agg(to_jsonb(x) order by x.product_id) from (
    select product_id,paid_units_30d as units,paid_orders_30d as orders,revenue_30d as revenue,
      attributed_orders_30d,last_paid_on
    from product_facts where paid_orders_30d>0 order by product_id limit 500
  ) x),'[]'::jsonb),
  'summary',jsonb_build_object(
    'active_products',(select count(*) from product_facts),
    'paid_orders_30d',(select count(*) from paid_orders_30),
    'paid_units_30d',coalesce((select sum(units) from commercial_lines),0),
    'revenue_30d',coalesce((select sum(revenue) from commercial_lines),0),
    'exact_stock_units',coalesce((select sum(available_units) from variant_stock),0),
    'queue_units',coalesce((select sum(queue_units) from variant_queue),0),
    'in_process_units',coalesce((select sum(in_process_units) from variant_process),0),
    'pending_production_suggestions',(select count(*) from public.production_suggestions where estado='Pendiente' and area='Producción'),
    'active_batches',(select count(*) from public.production_batches where estado in ('En preparación','Congelando')),
    'inventory_below_minimum',(select count(*) from usable_inventory where usable_stock<minimo),
    'preparations_below_minimum',(select count(*) from preparation_facts where current_stock<minimum_stock)
  ),
  'campaign_attribution',coalesce((select jsonb_agg(to_jsonb(x) order by x.campaign_id) from (
    select campaign_id,paid_orders_30d as orders,revenue_30d as revenue,paid_units_30d as units
    from campaign_attribution order by campaign_id limit 500
  ) x),'[]'::jsonb),
  'creative_attribution',coalesce((select jsonb_agg(to_jsonb(x) order by x.creative_id) from (
    select creative_id,paid_orders_30d as orders,revenue_30d as revenue,paid_units_30d as units
    from creative_attribution order by creative_id limit 500
  ) x),'[]'::jsonb),
  'published_post_attribution',coalesce((select jsonb_agg(to_jsonb(x) order by x.post_id) from (
    select post_id,paid_orders_30d as orders,revenue_30d as revenue,ambiguous_orders,attribution_method
    from published_post_attribution order by post_id limit 500
  ) x),'[]'::jsonb),
  'crm_segments',jsonb_build_object(
    'birthdays_7d',coalesce((select birthdays_7d from crm_segment_counts),0),
    'dormant_30d',coalesce((select dormant_30d from crm_segment_counts),0),
    'contains_customer_ids',false
  ),
  'calendar',jsonb_build_object(
    'today',jsonb_build_object(
      'posts',coalesce((select cd.posts from calendar_days cd cross join business_clock bc where cd.fecha=bc.business_date),0),
      'published',coalesce((select cd.published from calendar_days cd cross join business_clock bc where cd.fecha=bc.business_date),0),
      'pending',coalesce((select cd.pending from calendar_days cd cross join business_clock bc where cd.fecha=bc.business_date),0)
    ),
    'next_7d',coalesce((select jsonb_agg(to_jsonb(x) order by x.date) from (
      select cd.fecha as date,cd.posts,cd.published,cd.pending
      from calendar_days cd cross join business_clock bc
      where cd.fecha>bc.business_date order by cd.fecha
    ) x),'[]'::jsonb)
  ),
  'production',jsonb_build_object(
    'plan_units',coalesce((select sum(plan_units) from production_plan_variants),0),
    'plan_runs',coalesce((select count(distinct lower(flavor)||'|'||lower(filling))
      from production_plan_variants where plan_units>0),0),
    'queue_units',coalesce((select sum(queue_units) from variant_queue),0),
    'active_batch_units',coalesce((select sum(in_process_units) from variant_process),0),
    'critical_preparations',coalesce((select jsonb_agg(to_jsonb(x) order by x.recommended_amount desc,x.name,x.flavor) from (
      select name,flavor,unidad as unit,
        greatest(0,ceil(below_minimum_by*20)/20) as recommended_amount,
        'Crítica'::text as severity
      from preparation_facts where current_stock<minimum_stock
      order by recommended_amount desc,name,flavor limit 50
    ) x),'[]'::jsonb)
  )
);
$$;

revoke all on function public._momos_agency_operational_facts_payload_v1()
  from public,anon,authenticated,service_role;

create or replace function public._momos_agency_operational_facts_envelope_v1(
  p_source_version bigint,
  p_server_time timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if p_source_version is null or p_source_version<=0 or p_server_time is null then
    raise exception 'Cursor de hechos operativos invalido.' using errcode='22023';
  end if;
  return jsonb_build_object(
    'version',1,
    'contract','momos-agency-operational-facts/v1',
    'source_version',p_source_version,
    'server_time',p_server_time,
    'event_id',md5('operational-facts:'||p_source_version::text),
    'privacy',jsonb_build_object(
      'customer_records_projected',false,
      'order_records_projected',false,
      'catalog_labels_projected',true,
      'free_text_projected',false,
      'secrets_projected',false,
      'storage_references_projected',false,
      'projection','agency-operational-facts-v1'
    ),
    'authority',jsonb_build_object(
      'read_only',true,
      'external_execution',false,
      'human_approval_required',true,
      'allowed_roles',jsonb_build_array('Administrador','Marketing/CRM')
    ),
    'payload',jsonb_build_object(
      'agency_operational_facts',public._momos_agency_operational_facts_payload_v1()
    )
  );
end $$;

revoke all on function public._momos_agency_operational_facts_envelope_v1(bigint,timestamptz)
  from public,anon,authenticated,service_role;

-- V2 conserva sin cambios los cuatro scopes H66 y suma un quinto sobre
-- compacto. El frontend puede hidratar Agencia con un solo RPC y una unica
-- source_version, sin pedir momos_core_snapshot_v1 ni
-- momos_operational_snapshot_v1.
create or replace function public.momos_agency_snapshots_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_server_time timestamptz:=statement_timestamp();
  v_source_version bigint;
begin
  if auth.uid() is null or public.current_user_has_any_role(array['Administrador','Marketing/CRM']) is not true then
    raise exception 'Tu rol no puede consultar Agencia MOMOS.' using errcode='42501';
  end if;

  select version into v_source_version from public.agency_snapshot_events where id=true;
  if v_source_version is null or v_source_version<=0 then
    raise exception 'Falta el evento singleton de Agencia.' using errcode='55000';
  end if;

  return jsonb_build_object(
    'version',2,
    'contract','momos-agency-snapshots/v2',
    'source_version',v_source_version,
    'server_time',v_server_time,
    'snapshots',jsonb_build_array(
      public._momos_agency_snapshot_envelope_v1('overview',v_source_version,v_server_time),
      public._momos_agency_snapshot_envelope_v1('workflow',v_source_version,v_server_time),
      public._momos_agency_snapshot_envelope_v1('production',v_source_version,v_server_time),
      public._momos_agency_snapshot_envelope_v1('measurement',v_source_version,v_server_time)
    ),
    'agency_operational_facts',public._momos_agency_operational_facts_envelope_v1(v_source_version,v_server_time)
  );
end $$;

revoke all on function public.momos_agency_snapshots_v2()
  from public,anon,authenticated,service_role;
grant execute on function public.momos_agency_snapshots_v2() to authenticated;

-- Cada sentencia operativa invalida el mismo singleton H66. Se usa un nombre
-- de trigger propio para no tocar ni reemplazar Realtime operativo de otras
-- vistas. El evento publicado sigue sin transportar filas.
do $$
declare
  v_table text;
begin
  foreach v_table in array public._momos_agency_operational_source_tables_v1() loop
    if to_regclass(format('public.%I',v_table)) is null then
      raise exception 'Falta fuente operativa H67: %',v_table;
    end if;
    execute format('drop trigger if exists momos_agency_operational_event_v1 on public.%I',v_table);
    execute format(
      'create trigger momos_agency_operational_event_v1 '
      'after insert or update or delete or truncate on public.%I '
      'for each statement execute function public._momos_touch_agency_snapshot_event_v1()',
      v_table
    );
  end loop;
end $$;

-- Invalida cualquier cache H66 anterior a la instalacion de los nuevos hechos.
update public.agency_snapshot_events
set version=version+1,changed_at=clock_timestamp()
where id=true;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260718_67_agency_operational_facts',
  'Hechos agregados y versionados para Agencia sin PII, costos, formulas ni inventario detallado'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
