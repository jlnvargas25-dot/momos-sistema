-- MOMOS OPS · H77 Dashboard operativo compacto, versionado y sin PII.
-- Inicio deja de hidratar Catálogos + Operación + Agencia para construir sus tarjetas.
begin;

select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260719_76_configuracion_servidor') then
    raise exception 'Falta el paso 76_configuracion_servidor.';
  end if;
  if to_regprocedure('public.is_staff()') is null
     or to_regclass('public.inventory_sync_events') is null
     or to_regclass('public.order_sync_versions') is null
     or to_regclass('public.finished_inventory_sync_versions') is null
     or to_regclass('public.production_activity_sync_versions') is null
     or to_regclass('public.product_catalog_sync_versions') is null
     or to_regclass('public.customer_crm_sync_versions') is null
     or to_regclass('public.agency_snapshot_events') is null
     or to_regclass('public.finance_sync_state') is null
     or to_regclass('public.configuration_sync_state') is null then
    raise exception 'Faltan los outboxes canónicos requeridos por H77.';
  end if;
end $$;

create table if not exists public.dashboard_sync_state(
  id smallint primary key check(id=1),
  version bigint not null default 1 check(version>0),
  changed_at timestamptz not null default clock_timestamp()
);
insert into public.dashboard_sync_state(id,version) values(1,1)
on conflict(id) do nothing;
alter table public.dashboard_sync_state enable row level security;
drop policy if exists dashboard_sync_state_staff_read on public.dashboard_sync_state;
create policy dashboard_sync_state_staff_read on public.dashboard_sync_state
for select to authenticated using(public.is_staff());
revoke all on table public.dashboard_sync_state from public,anon,authenticated,service_role;
grant select on table public.dashboard_sync_state to authenticated;

create or replace function public._touch_dashboard_sync_state()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  update public.dashboard_sync_state
  set version=version+1,changed_at=clock_timestamp() where id=1;
  return null;
end $$;
revoke all on function public._touch_dashboard_sync_state() from public,anon,authenticated,service_role;

do $$
declare v_table text; v_trigger text;
begin
  foreach v_table in array array[
    'inventory_sync_events','order_sync_versions','finished_inventory_sync_versions',
    'production_activity_sync_versions','product_catalog_sync_versions','customer_crm_sync_versions',
    'agency_snapshot_events','finance_sync_state','configuration_sync_state'
  ] loop
    v_trigger:='trg_h77_dashboard_'||v_table;
    execute format('drop trigger if exists %I on public.%I',v_trigger,v_table);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each statement execute function public._touch_dashboard_sync_state()',
      v_trigger,v_table
    );
  end loop;
end $$;

create or replace function public.momos_dashboard_snapshot_v1()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_version bigint;
  v_today date:=(clock_timestamp() at time zone 'America/Bogota')::date;
  v_summary jsonb;
  v_tasks jsonb;
  v_primary jsonb;
  v_assistants jsonb;
  v_assistant_summary jsonb;
  v_notices jsonb;
  v_brand jsonb;
  v_inventory jsonb;
  v_customer jsonb;
  v_states jsonb;
  v_channels jsonb;
  v_products jsonb;
begin
  if auth.uid() is null or public.is_staff() is not true then
    raise exception 'Solo el equipo activo de MOMOS puede consultar el Dashboard.' using errcode='42501';
  end if;
  select version into v_version from public.dashboard_sync_state where id=1;

  with totals as materialized(
    select o.id,o.fecha,o.canal,o.estado,o.pagado_en,
      greatest(0,coalesce(t.ventas,0)-coalesce(o.descuento,0)+coalesce(o.dom_cobrado,0)) total
    from public.orders o left join public.v_order_totals t on t.order_id=o.id
  )
  select jsonb_build_object(
    'salesToday',coalesce(sum(total) filter(where fecha=v_today and pagado_en is not null and estado not in ('Nuevo','Confirmado','Pendiente de pago','Cancelado')),0),
    'ordersToday',count(*) filter(where fecha=v_today and estado<>'Cancelado'),
    'activeOrders',count(*) filter(where estado not in ('Entregado','Cancelado')),
    'pendingPayments',count(*) filter(where estado in ('Nuevo','Confirmado','Pendiente de pago') and pagado_en is null),
    'pendingPaymentAmount',coalesce(sum(total) filter(where estado in ('Nuevo','Confirmado','Pendiente de pago') and pagado_en is null),0),
    'openClaims',(select count(*) from public.claims where estado in ('Abierto','En revisión'))
  ) into v_summary from totals;

  with candidates as(
    select 10 priority,o.id sort_id,jsonb_build_object(
      'id','payment:'||o.id,'area','VENTAS Y RECEPCIÓN','module','Pedidos','ownerRoles',jsonb_build_array('Caja / Coordinación de pedidos','Administrador'),
      'entityId',o.id,'entityType','Pedido','severity','high','blocks',false,'confidence','Alta','confirmationRequired',true,
      'title','Confirmar el pago de '||o.id,'detail','El pedido sigue en recepción y todavía no tiene pago confirmado.',
      'nextAction','Abrir Pedidos, validar el comprobante y confirmar el pago.','reasons',jsonb_build_array('El pago sigue pendiente.')
    ) task
    from public.orders o where o.estado in ('Nuevo','Confirmado','Pendiente de pago') and o.pagado_en is null
    union all
    select 20,o.id,jsonb_build_object(
      'id','order-data:'||o.id,'area','VENTAS Y RECEPCIÓN','module','Pedidos','ownerRoles',jsonb_build_array('Caja / Coordinación de pedidos','Administrador'),
      'entityId',o.id,'entityType','Pedido','severity','critical','blocks',true,'confidence','Alta','confirmationRequired',true,
      'title','Completar los datos de '||o.id,'detail','Una línea del pedido necesita figura o sabor antes de continuar.',
      'nextAction','Abrir Pedidos y completar la variante solicitada.','reasons',jsonb_build_array('La variante vendida está incompleta.')
    )
    from public.orders o where o.estado<>'Cancelado' and exists(
      select 1 from public.order_items oi join public.products p on p.id=oi.product_id
      where oi.order_id=o.id and p.tipo='momo' and (nullif(btrim(oi.figura),'') is null or nullif(btrim(oi.sabor),'') is null)
    )
    union all
    select 30,ps.id,jsonb_build_object(
      'id','production:'||ps.id,'area','COCINA','module','Producción','ownerRoles',jsonb_build_array('Cocina','Administrador'),
      'entityId',ps.id,'entityType','Sugerencia','severity','high','blocks',false,'confidence','Alta','confirmationRequired',true,
      'title','Resolver una necesidad de producción','detail','Existe una sugerencia pendiente ligada a demanda o reposición.',
      'nextAction','Abrir Producción, revisar la corrida sugerida y confirmarla.','reasons',jsonb_build_array('La sugerencia continúa pendiente.')
    )
    from public.production_suggestions ps where ps.estado='Pendiente' and ps.area='Producción'
    union all
    select 40,i.id,jsonb_build_object(
      'id','inventory:'||i.id,'area','COMPRAS','module','Inventario','ownerRoles',jsonb_build_array('Administrador','Cocina'),
      'entityId',i.id,'entityType','Insumo','severity',case when i.stock<=0 then 'critical' else 'high' end,'blocks',i.stock<=0,
      'confidence','Alta','confirmationRequired',true,'title','Reponer '||left(i.nombre,100),
      'detail','El insumo está por debajo de su mínimo operativo.','nextAction','Abrir Inventario y registrar la compra o preparación correspondiente.',
      'reasons',jsonb_build_array('Stock '||i.stock::text||' '||i.unidad||'; mínimo '||i.minimo::text||' '||i.unidad||'.')
    )
    from public.inventory_items i where i.stock<i.minimo
    union all
    select 50,o.id,jsonb_build_object(
      'id','packing:'||o.id,'area','EMPAQUE','module','Empaque','ownerRoles',jsonb_build_array('Empaque','Administrador'),
      'entityId',o.id,'entityType','Pedido','severity','medium','blocks',false,'confidence','Alta','confirmationRequired',true,
      'title','Alistar '||o.id,'detail','Cocina entregó el pedido y Empaque debe verificar su contenido.',
      'nextAction','Abrir Empaque, cotejar la orden y completar las evidencias.','reasons',jsonb_build_array('El pedido está listo para empaque.')
    )
    from public.orders o where o.estado='Listo para empaque'
    union all
    select 60,c.id,jsonb_build_object(
      'id','claim:'||c.id,'area','SERVICIO','module','Reclamos','ownerRoles',jsonb_build_array('Administrador'),
      'entityId',c.id,'entityType','Reclamo','severity','high','blocks',false,'confidence','Alta','confirmationRequired',true,
      'title','Revisar el reclamo '||c.id,'detail','El reclamo sigue abierto y necesita una decisión trazable.',
      'nextAction','Abrir Reclamos, revisar las evidencias y registrar la decisión.','reasons',jsonb_build_array('El reclamo no está cerrado.')
    )
    from public.claims c where c.estado in ('Abierto','En revisión')
  ), bounded as(
    select * from candidates order by priority,sort_id limit 24
  )
  select coalesce(jsonb_agg(task order by priority,sort_id),'[]'::jsonb) into v_tasks from bounded;

  select jsonb_build_object(
    'title',x->>'title','detail',x->>'detail','ownerRoles',x->'ownerRoles','nextAction',x->>'nextAction'
  ) into v_primary from jsonb_array_elements(v_tasks) x limit 1;

  with areas(id,name,module) as(values
    ('ventas','Ventas','Pedidos'),('cocina','Cocina','Producción'),('compras','Compras','Inventario'),
    ('empaque','Empaque','Empaque'),('servicio','Servicio','Reclamos')
  ), counted as(
    select a.*,
      (select count(*) from jsonb_array_elements(v_tasks) t where
        (a.id='ventas' and t->>'area'='VENTAS Y RECEPCIÓN') or (a.id='cocina' and t->>'area'='COCINA')
        or (a.id='compras' and t->>'area'='COMPRAS') or (a.id='empaque' and t->>'area'='EMPAQUE')
        or (a.id='servicio' and t->>'area'='SERVICIO')) task_count,
      (select count(*) from jsonb_array_elements(v_tasks) t where (t->>'blocks')::boolean and (
        (a.id='ventas' and t->>'area'='VENTAS Y RECEPCIÓN') or (a.id='cocina' and t->>'area'='COCINA')
        or (a.id='compras' and t->>'area'='COMPRAS') or (a.id='empaque' and t->>'area'='EMPAQUE')
        or (a.id='servicio' and t->>'area'='SERVICIO'))) block_count
    from areas a
  )
  select jsonb_agg(jsonb_build_object(
    'id',id,'name',name,'module',module,'count',task_count,
    'status',case when block_count>0 then 'Bloqueado' when task_count>0 then 'Atención' else 'Al día' end
  ) order by id) into v_assistants from counted;

  select jsonb_build_object(
    'health',case when count(*) filter(where (t->>'blocks')::boolean)>0 then 'Bloqueado' when count(*)>0 then 'Atención' else 'Al día' end,
    'tasks',count(*),'critical',count(*) filter(where t->>'severity'='critical'),'blocking',count(*) filter(where (t->>'blocks')::boolean)
  ) into v_assistant_summary from jsonb_array_elements(v_tasks) t;

  select jsonb_build_object(
    'productionSuggestions',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'quantity',x.cantidad,'product',x.product) order by x.fecha,x.id) from(
      select ps.id,ps.cantidad,coalesce(p.nombre,'Necesidad de producción') product,ps.fecha
      from public.production_suggestions ps left join public.products p on p.id=ps.product_id
      where ps.estado='Pendiente' and ps.area='Producción' order by ps.fecha,ps.id limit 12
    ) x),'[]'::jsonb),
    'freezingReady',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'product',x.product,'grams',x.gramaje_g,'flavor',x.sabor) order by x.fecha,x.id) from(
      select b.id,coalesce(p.nombre,'Producto') product,b.gramaje_g,coalesce(b.sabor,'') sabor,b.fecha
      from public.production_batches b left join public.products p on p.id=b.product_id
      where b.estado='Congelando' and b.inicio_congelacion is not null
        and extract(epoch from(clock_timestamp()-b.inicio_congelacion))/3600>=b.horas_congelacion
      order by b.fecha,b.id limit 12
    ) x),'[]'::jsonb),
    'publicationsToday',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'time',x.hora,'channel',x.canal) order by x.hora,x.id) from(
      select id,to_char(hora,'HH24:MI') hora,canal from public.content_posts where fecha=v_today order by hora,id limit 12
    ) x),'[]'::jsonb),
    'creativeReviews',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'label','Creativo pendiente de aprobación') order by x.id) from(
      select id from public.creatives where estado='En revisión' order by id limit 12
    ) x),'[]'::jsonb),
    'campaignsWithoutOrders',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'label','Campaña activa sin pedidos atribuidos') order by x.id) from(
      select c.id from public.campaigns c where c.estado='Activa' and not exists(
        select 1 from public.orders o where o.campaign_id=c.id and o.pagado_en is not null and o.estado<>'Cancelado'
      ) order by c.id limit 12
    ) x),'[]'::jsonb),
    'winner',(select jsonb_build_object('campaignId',m.campaign_id,'roas',round(m.roas,2),'creativeId',(
      select cr.id from public.creatives cr where cr.estado='Ganador' and cr.campaign_id=m.campaign_id order by cr.id limit 1
    )) from public.v_campaign_metrics m where m.roas is not null order by m.roas desc,m.campaign_id limit 1)
  ) into v_notices;

  select jsonb_build_object(
    'ideaToday',(select jsonb_build_object('id',i.id,'label','Idea de contenido lista para revisar') from public.marketing_ideas i order by case i.estado when 'Ganadora' then 0 when 'Repetir' then 1 when 'Nueva' then 2 else 3 end,i.id limit 1),
    'customerContact',coalesce(
      (select jsonb_build_object('label','Cliente con beneficio por vencer','reason','Revisar seguimiento en CRM') from public.benefits b where b.estado='Activo' and b.vence between v_today and v_today+3 limit 1),
      (select jsonb_build_object('label','Cliente inactivo para recuperar','reason','Revisar seguimiento en CRM') from public.customers c where c.ultima is not null and c.ultima<=v_today-15 limit 1)
    ),
    'campaignReview',(select jsonb_build_object('id',c.id,'label','Campaña activa para revisar') from public.campaigns c where c.estado='Activa' order by c.id limit 1),
    'contentRepeat',(select jsonb_build_object('id',i.id,'label','Contenido ganador para repetir') from public.marketing_ideas i where i.estado='Ganadora' order by i.id limit 1),
    'benefitExpiring',(select jsonb_build_object('id',b.id,'label','Beneficio próximo a vencer','expires',b.vence) from public.benefits b where b.estado='Activo' and b.vence>=v_today order by b.vence,b.id limit 1),
    'taskMissing',(select jsonb_build_object('id',t.id,'label','Tarea de marca pendiente') from public.marketing_tasks t where t.estado='Pendiente' and t.fecha=v_today order by t.id limit 1)
  ) into v_brand;

  select jsonb_build_object(
    'lowStock',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.nombre,'stock',x.stock,'minimum',x.minimo,'unit',x.unidad) order by x.nombre,x.id) from(
      select id,nombre,stock,minimo,unidad from public.inventory_items where stock<minimo order by (minimo-stock) desc,nombre,id limit 20
    ) x),'[]'::jsonb),
    'expiringSoon',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.nombre,'expires',x.vence) order by x.vence,x.nombre,x.id) from(
      select id,nombre,vence from public.inventory_items where vence between v_today and v_today+5 order by vence,nombre,id limit 20
    ) x),'[]'::jsonb)
  ) into v_inventory;

  select jsonb_build_object(
    'new',count(*) filter(where estado='Nuevo'),
    'recurrent',count(*) filter(where estado in ('Recurrente','VIP'))
  ) into v_customer from public.customers;

  with states(label,ord) as(values
    ('Nuevo',1),('Confirmado',2),('Pendiente de pago',3),('Pagado',4),('En producción',5),('Listo para empaque',6),
    ('Empacado',7),('Listo para despacho',8),('En ruta',9),('Entregado',10),('Cancelado',11),('Reclamo',12)
  )
  select coalesce(jsonb_agg(jsonb_build_object('label',s.label,'value',s.qty) order by s.ord),'[]'::jsonb) into v_states
  from(select st.label,st.ord,count(o.id) qty from states st left join public.orders o on o.estado=st.label group by st.label,st.ord having count(o.id)>0) s;

  with channels(label,ord) as(values('WhatsApp',1),('Instagram',2),('Rappi',3),('Directo',4)), totals as(
    select o.canal,greatest(0,coalesce(t.ventas,0)-coalesce(o.descuento,0)+coalesce(o.dom_cobrado,0)) total
    from public.orders o left join public.v_order_totals t on t.order_id=o.id
    where o.pagado_en is not null and o.estado not in ('Nuevo','Confirmado','Pendiente de pago','Cancelado')
  ), channel_totals as(
    select c.label,c.ord,coalesce(sum(t.total),0) value
    from channels c left join totals t on t.canal=c.label
    group by c.label,c.ord
  )
  select jsonb_agg(jsonb_build_object('label',label,'value',value) order by ord) into v_channels
  from channel_totals;

  with available as(
    select p.id,p.nombre,p.tipo,
      case when p.tipo='momo' then floor(greatest(0,coalesce(p.stock,0)))
           when p.tipo='combo' then least(
             floor(greatest(0,coalesce((select sum(coalesce(cp.stock,0)) from public.combo_components cc join public.products cp on cp.id=cc.component_id where cc.combo_id=p.id),0))/greatest(p.combo_size,1)),
             floor(greatest(0,coalesce((select i.stock from public.inventory_items i where i.id=p.empaque_item_id),0)))
           ) else 0 end available
    from public.products p where p.activo and p.tipo<>'pedido'
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',nombre,'type',tipo,'available',available,'low',available<=2) order by nombre,id),'[]'::jsonb)
  into v_products from(select * from available order by nombre,id limit 50) bounded;

  return jsonb_build_object(
    'contract','momos.dashboard-snapshot.v1','version',1,'snapshotVersion',v_version::text,
    'serverTime',clock_timestamp(),'businessDate',v_today,
    'summary',v_summary,
    'assistantCenter',jsonb_build_object(
      'primary',v_primary,'assistants',v_assistants,'tasks',v_tasks,'summary',v_assistant_summary,
      'policy','Toda acción sensible requiere confirmación humana en el módulo responsable.'
    ),
    'notices',v_notices,'brandAssistant',v_brand,'inventoryAlerts',v_inventory,'customerSummary',v_customer,
    'ordersByState',v_states,'salesByChannel',v_channels,'productAvailability',v_products,
    'privacy',jsonb_build_object(
      'containsCustomerPii',false,'containsStaffPii',false,'containsFreeText',false,
      'containsStorageReferences',false,'containsSecrets',false,'externalExecution',false
    )
  );
end $$;
revoke all on function public.momos_dashboard_snapshot_v1() from public,anon,service_role;
grant execute on function public.momos_dashboard_snapshot_v1() to authenticated;

create or replace function public.dashboard_operativo_disponible()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
  select public.is_staff()
    and to_regprocedure('public.momos_dashboard_snapshot_v1()') is not null
    and exists(select 1 from public.momos_ops_migrations where id='20260719_77_dashboard_operativo')
$$;
revoke all on function public.dashboard_operativo_disponible() from public,anon,service_role;
grant execute on function public.dashboard_operativo_disponible() to authenticated;

create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_capabilities jsonb; v_schema_version text; v_inventory_event_id bigint:=0;
  v_finance_version bigint:=0; v_configuration_version bigint:=0; v_dashboard_version bigint:=0;
begin
  if auth.uid() is null or not exists(select 1 from public.users u where u.auth_id=auth.uid() and u.activo) then
    raise exception 'Sesión MOMOS inválida.' using errcode='42501';
  end if;
  select coalesce(jsonb_object_agg(x.name,to_regprocedure(format('public.%I()',x.name)) is not null),'{}'::jsonb)
  into v_capabilities from unnest(array[
    'roles_multiples_disponible','productos_servidor_disponible','agencia_comercial_disponible','orquestador_agencia_disponible',
    'centro_acciones_agencia_disponible','resultados_acciones_agencia_disponibles','mesa_agencia_disponible','estudio_escenas_disponible',
    'motion_experience_disponible','enrutador_escenas_disponible','calidad_postproduccion_disponible','postproduccion_exportacion_disponible',
    'postproduccion_audio_disponible','retencion_guiones_disponible','retencion_loops_disponible','observatorio_meta_disponible',
    'incrementalidad_meta_disponible','escenarios_inversion_meta_disponible','autorizacion_inversion_meta_disponible','meta_conector_dry_run_disponible',
    'distribucion_comercial_disponible','distribucion_conectores_disponible','biblioteca_creativa_disponible','produccion_creativa_disponible',
    'revision_creativa_disponible','versiones_creativas_disponibles','integraciones_agencia_disponibles','higgsfield_conector_disponible',
    'kling_conector_disponible','gobernanza_marca_disponible','motor_crecimiento_multimodo_disponible','flujo_creativo_e2e_disponible',
    'operacion_pedido_disponible','crm_clientes_disponible','identidad_marca_disponible','mundo_animado_disponible',
    'eliminacion_logo_oficial_disponible','biblioteca_produccion_disponible','mcp_aprobaciones_humanas_disponible',
    'inventario_deltas_disponibles','pedidos_deltas_disponibles','producto_terminado_deltas_disponibles',
    'produccion_deltas_disponibles','catalogo_crm_deltas_disponibles','finanzas_operativas_disponibles','configuracion_servidor_disponible',
    'dashboard_operativo_disponible'
  ]::text[]) x(name);
  select id into v_schema_version from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  select version into v_finance_version from public.finance_sync_state where id=1;
  select version into v_configuration_version from public.configuration_sync_state where id=1;
  select version into v_dashboard_version from public.dashboard_sync_state where id=1;
  v_inventory_event_id:=4611686018427387904+((pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot()))::text)::bigint;
  return jsonb_build_object(
    'version',1,'schema_version',coalesce(v_schema_version,''),'server_time',clock_timestamp(),
    'capabilities',v_capabilities,'inventory_latest_event_id',v_inventory_event_id::text,
    'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object('version',extract(epoch from clock_timestamp())::bigint,'ttl_seconds',60,'inventory_latest_event_id',v_inventory_event_id::text),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300),
      'finanzas',jsonb_build_object('version',coalesce(v_finance_version,0)::text,'ttl_seconds',60),
      'configuracion',jsonb_build_object('version',coalesce(v_configuration_version,0)::text,'ttl_seconds',300),
      'dashboard',jsonb_build_object('version',coalesce(v_dashboard_version,0)::text,'ttl_seconds',30)
    ),'contains_pii',false,'contains_secrets',false,'external_execution',false
  );
end $$;
revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dashboard_sync_state') then
    alter publication supabase_realtime add table public.dashboard_sync_state;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260719_77_dashboard_operativo','Dashboard compacto versionado, sin PII, derivado de outboxes y sincronizado por Realtime')
on conflict(id) do update set detalle=excluded.detalle;

commit;
