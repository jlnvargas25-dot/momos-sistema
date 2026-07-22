-- MOMOS OPS · H71 Pedidos y Empaque incrementales v1.
--
-- Cada acción conserva sus RPC y guards canónicos. Este hito agrega una
-- lectura cerrada por pedido para que la UI no rehidrate toda la operación
-- después de cambiar una sola comanda. La tabla de versiones no contiene PII:
-- publica únicamente order_id, versión y hora del último cambio.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260719'));

do $$
begin
  if not exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_70_inventario_delta_consistencia'
  ) then
    raise exception 'H71 requiere H70 inventario delta consistente.';
  end if;
  if to_regprocedure('public.set_order_status(text,text,boolean)') is null
     or to_regprocedure('public.confirmar_verificacion_empaque(text,text[])') is null
     or to_regprocedure('public.operacion_pedido_disponible()') is null then
    raise exception 'H71 requiere las RPC canónicas de Pedidos, Empaque y control operativo.';
  end if;
end $$;

create table if not exists public.order_sync_versions(
  order_id text primary key references public.orders(id) on delete cascade,
  version bigint not null default 1 check(version>0),
  changed_at timestamptz not null default clock_timestamp()
);
alter table public.order_sync_versions enable row level security;
drop policy if exists order_sync_versions_staff_read
  on public.order_sync_versions;
create policy order_sync_versions_staff_read
  on public.order_sync_versions for select to authenticated
  using(public.is_staff());
revoke all on table public.order_sync_versions
  from public,anon,authenticated,service_role;
grant select on table public.order_sync_versions to authenticated;

insert into public.order_sync_versions(order_id,version,changed_at)
select o.id,1,clock_timestamp()
from public.orders o
on conflict(order_id) do nothing;

create or replace function public._momos_touch_order_sync_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_order_id text;
  v_item_id text;
  v_old_customer_id text;
  v_new_customer_id text;
  v_old_linked_order_id text;
  v_new_linked_order_id text;
begin
  if tg_op<>'INSERT' and to_jsonb(old) is not distinct from to_jsonb(new) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_table_name='customers' then
    v_old_customer_id:=case when tg_op='INSERT' then null else old.id end;
    v_new_customer_id:=case when tg_op='DELETE' then null else new.id end;
    insert into public.order_sync_versions(order_id,version,changed_at)
    select distinct o.id,1,clock_timestamp()
    from public.orders o
    where o.customer_id in (coalesce(v_old_customer_id,''),coalesce(v_new_customer_id,''))
    on conflict(order_id) do update
      set version=public.order_sync_versions.version+1,
          changed_at=excluded.changed_at;
    return case when tg_op='DELETE' then old else new end;
  elsif tg_table_name='benefits' then
    v_old_customer_id:=case when tg_op='INSERT' then null else old.customer_id end;
    v_new_customer_id:=case when tg_op='DELETE' then null else new.customer_id end;
    v_old_linked_order_id:=case when tg_op='INSERT' then null else old.pedido_uso end;
    v_new_linked_order_id:=case when tg_op='DELETE' then null else new.pedido_uso end;
    insert into public.order_sync_versions(order_id,version,changed_at)
    select distinct o.id,1,clock_timestamp()
    from public.orders o
    where o.customer_id in (coalesce(v_old_customer_id,''),coalesce(v_new_customer_id,''))
       or o.id in (coalesce(v_old_linked_order_id,''),coalesce(v_new_linked_order_id,''))
    on conflict(order_id) do update
      set version=public.order_sync_versions.version+1,
          changed_at=excluded.changed_at;
    return case when tg_op='DELETE' then old else new end;
  elsif tg_table_name='orders' then
    v_order_id:=case when tg_op='DELETE' then old.id else new.id end;
  elsif tg_table_name='order_item_adiciones' then
    v_item_id:=case when tg_op='DELETE' then old.order_item_id else new.order_item_id end;
    select oi.order_id into v_order_id
    from public.order_items oi where oi.id=v_item_id;
  elsif tg_table_name='audit_logs' then
    v_order_id:=case when tg_op='DELETE' then old.entidad_id else new.entidad_id end;
    if not exists(select 1 from public.orders o where o.id=v_order_id) then
      v_order_id:=null;
    end if;
  else
    v_order_id:=case when tg_op='DELETE' then old.order_id else new.order_id end;
  end if;
  if nullif(btrim(coalesce(v_order_id,'')),'') is not null
     and exists(select 1 from public.orders o where o.id=v_order_id) then
    insert into public.order_sync_versions(order_id,version,changed_at)
    values(v_order_id,1,clock_timestamp())
    on conflict(order_id) do update
      set version=public.order_sync_versions.version+1,
          changed_at=excluded.changed_at;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

revoke all on function public._momos_touch_order_sync_v1() from public,anon,authenticated,service_role;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'orders','order_items','order_item_adiciones','customers','deliveries','evidences','benefits','claims',
    'inventory_reservations','production_suggestions','packing_verifications',
    'order_stage_assignments','order_line_progress','order_incidents',
    'order_dispatch_handoffs','audit_logs'
  ] loop
    execute format('drop trigger if exists momos_order_sync_touch on public.%I',v_table);
    execute format(
      'create trigger momos_order_sync_touch after insert or update or delete on public.%I for each row execute function public._momos_touch_order_sync_v1()',
      v_table
    );
  end loop;
end $$;

create or replace function public.momos_order_deltas_v1(p_order_ids text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_missing text[];
  v_response jsonb;
begin
  if public.is_staff() is not true then
    raise exception 'Solo staff activo';
  end if;
  if p_order_ids is null or cardinality(p_order_ids)=0 or cardinality(p_order_ids)>50 then
    raise exception 'Solicita entre 1 y 50 pedidos.';
  end if;
  if exists(
    select 1 from unnest(p_order_ids) raw_id
    where nullif(btrim(coalesce(raw_id,'')),'') is null
  ) then
    raise exception 'La lista contiene un order_id vacío.';
  end if;

  with requested as materialized (
    select btrim(u.raw_id) order_id,min(u.ord)::bigint first_ord
    from unnest(p_order_ids) with ordinality u(raw_id,ord)
    group by btrim(u.raw_id)
  )
  select array_agg(r.order_id order by r.first_ord)
  into v_missing
  from requested r
  left join public.orders o on o.id=r.order_id
  where o.id is null;
  if coalesce(cardinality(v_missing),0)>0 then
    raise exception 'No existen los pedidos solicitados: %',array_to_string(v_missing,', ');
  end if;

  with requested as materialized (
    select btrim(u.raw_id) order_id,min(u.ord)::bigint first_ord
    from unnest(p_order_ids) with ordinality u(raw_id,ord)
    group by btrim(u.raw_id)
  ), payload as materialized (
    select r.first_ord,jsonb_build_object(
      'contract','momos.order-delta.v1',
      'orderId',o.id,
      'version',coalesce(v.version,1)::text,
      'serverTime',statement_timestamp(),
      'order',jsonb_build_object(
        'id',o.id,'fecha',o.fecha,'hora',to_char(o.hora,'HH24:MI'),'canal',o.canal,
        'customerId',coalesce(o.customer_id,''),'barrio',coalesce(o.barrio,''),
        'direccion',coalesce(o.direccion,''),'zona',coalesce(o.zona,''),
        'domCobrado',o.dom_cobrado,'domCosto',o.dom_costo,'descuento',o.descuento,
        'benefitId',coalesce(o.benefit_id,''),'pago',coalesce(o.pago,''),
        'comprobante',o.comprobante,'estado',o.estado,'obs',coalesce(o.obs,''),
        'pagadoEn',case when o.pagado_en is null then null else to_char(o.pagado_en at time zone 'America/Bogota','YYYY-MM-DD HH24:MI') end,
        'metricasClienteActualizadas',o.metricas_cliente_actualizadas,
        'campaignId',coalesce(o.campaign_id,''),'creativeId',coalesce(o.creative_id,''),
        'origenDetalle',coalesce(o.origen_detalle,'')
      ),
      'orderItems',coalesce((select jsonb_agg(jsonb_build_object(
        'id',oi.id,'orderId',oi.order_id,'productId',oi.product_id,'nombre',oi.nombre,
        'sabor',coalesce(oi.sabor,''),'salsa',coalesce(oi.salsa,''),'relleno',coalesce(oi.relleno,''),
        'figura',coalesce(oi.figura,''),'cant',oi.cant,'precio',oi.precio,
        'costoUnitario',oi.costo_unitario,'esCaja',oi.es_caja,'esSubMomo',oi.es_sub_momo,
        'parentItemId',oi.parent_item_id,'cajaNum',oi.caja_num,
        'adiciones',coalesce((select jsonb_agg(jsonb_build_object(
          'nombre',a.nombre,'precio',a.precio,'cant',a.cant,
          'insumoId',coalesce(a.insumo_id,''),'insumoCant',a.insumo_cant
        ) order by a.id) from public.order_item_adiciones a where a.order_item_id=oi.id),'[]'::jsonb)
      ) order by oi.id desc) from public.order_items oi where oi.order_id=o.id),'[]'::jsonb),
      'customer',coalesce((select jsonb_build_object(
        'id',c.id,'nombre',c.nombre,'telefono',coalesce(c.telefono,''),'instagram',coalesce(c.instagram,''),
        'barrio',coalesce(c.barrio,''),'direccion',coalesce(c.direccion,''),'canal',coalesce(c.canal,''),
        'primera',coalesce(c.primera::text,''),'ultima',coalesce(c.ultima::text,''),
        'total',c.total,'pedidos',c.pedidos,'cumple',coalesce(c.cumple::text,''),
        'favoritos',coalesce(c.favoritos,''),'estado',c.estado,'notas',coalesce(c.notas,'')
      ) from public.customers c where c.id=o.customer_id),'null'::jsonb),
      'deliveries',coalesce((select jsonb_agg(jsonb_build_object(
        'id',d.id,'orderId',d.order_id,'proveedor',d.proveedor,'costoReal',d.costo_real,
        'cobrado',d.cobrado,'zona',coalesce(d.zona,''),'hSolicitud',coalesce(to_char(d.h_solicitud,'HH24:MI'),''),
        'hSalida',coalesce(to_char(d.h_salida,'HH24:MI'),''),'hEntrega',coalesce(to_char(d.h_entrega,'HH24:MI'),''),
        'codigo',coalesce(d.codigo,''),'estado',d.estado,'obs',coalesce(d.obs,'')
      ) order by d.id desc) from public.deliveries d where d.order_id=o.id),'[]'::jsonb),
      'evidences',coalesce((select jsonb_agg(jsonb_build_object(
        'id',e.id,'orderId',e.order_id,'tipo',e.tipo,'storagePath',coalesce(e.storage_path,''),'url','',
        'fecha',to_char(e.fecha at time zone 'America/Bogota','YYYY-MM-DD'),
        'hora',to_char(e.fecha at time zone 'America/Bogota','HH24:MI'),
        'user',coalesce(u.rol,'')
      ) order by e.fecha desc,e.id desc) from public.evidences e left join public.users u on u.id=e.user_id where e.order_id=o.id),'[]'::jsonb),
      'benefits',coalesce((select jsonb_agg(jsonb_build_object(
        'id',b.id,'customerId',b.customer_id,'beneficio',b.beneficio,'tipoBeneficio',b.tipo_beneficio,
        'valor',b.valor,'productoGratisId',coalesce(b.producto_gratis_id,''),'condicion',coalesce(b.condicion,''),
        'minimo',b.minimo,'activacion',coalesce(b.activacion::text,''),'vence',coalesce(b.vence::text,''),
        'estado',b.estado,'pedidoUso',coalesce(b.pedido_uso,''),'obs',coalesce(b.obs,'')
      ) order by b.id desc) from public.benefits b where b.customer_id=o.customer_id or b.pedido_uso=o.id),'[]'::jsonb),
      'claims',coalesce((select jsonb_agg(jsonb_build_object(
        'id',c.id,'orderId',c.order_id,'customerId',coalesce(c.customer_id,''),'fecha',c.fecha,
        'tipo',c.tipo,'hEntrega',coalesce(to_char(c.entregado_en at time zone 'America/Bogota','HH24:MI'),''),
        'hReclamo',coalesce(to_char(c.reclamo_en at time zone 'America/Bogota','HH24:MI'),''),
        'entregadoEn',coalesce(to_char(c.entregado_en at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),''),
        'reclamoEn',coalesce(to_char(c.reclamo_en at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),''),
        'desc',coalesce(c.descr,''),'resp',coalesce(c.resp,''),'decision',coalesce(c.decision,''),
        'solucion',coalesce(c.solucion,''),'costo',c.costo,'estado',c.estado,'evidencia',coalesce(c.evidencia,'')
      ) order by c.id desc) from public.claims c where c.order_id=o.id),'[]'::jsonb),
      'inventoryReservations',coalesce((select jsonb_agg(jsonb_build_object(
        'id',ir.id,'orderId',ir.order_id,'tipo',ir.tipo,
        'refId',case when ir.tipo='producto' then coalesce(ir.product_id,'') else coalesce(ir.item_id,'') end,
        'nombre',ir.nombre,'cantidad',ir.cantidad,
        'fecha',to_char(ir.fecha at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),
        'estado',ir.estado,'batchId',coalesce(ir.batch_id,''),'figuraLote',coalesce(ir.figura,'')
      ) order by ir.id desc) from public.inventory_reservations ir where ir.order_id=o.id),'[]'::jsonb),
      'productionSuggestions',coalesce((select jsonb_agg(jsonb_build_object(
        'id',ps.id,'fecha',ps.fecha,'producto',case when ps.area='Inventario' then coalesce(ii.nombre,'') else coalesce(p.nombre,'') end,
        'cantidad',ps.cantidad,'motivo',coalesce(ps.motivo,''),'orderId',coalesce(ps.order_id,''),
        'estado',ps.estado,'area',ps.area,'itemId',coalesce(ps.item_id,''),
        'productId',coalesce(ps.product_id,''),'orderItemId',coalesce(ps.order_item_id,'')
      ) order by ps.fecha desc,ps.id desc) from public.production_suggestions ps
        left join public.inventory_items ii on ii.id=ps.item_id
        left join public.products p on p.id=ps.product_id where ps.order_id=o.id),'[]'::jsonb),
      'auditLogs',coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'fecha',to_char(a.fecha at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),
        'user',coalesce(u.rol,''),'entidad',a.entidad,'entidadId',coalesce(a.entidad_id,''),
        'accion',a.accion,'de',coalesce(a.de,''),'a',coalesce(a.a,'')
      ) order by a.fecha desc,a.id desc) from public.audit_logs a left join public.users u on u.id=a.user_id where a.entidad_id=o.id),'[]'::jsonb),
      'packingVerifications',coalesce((select jsonb_agg(jsonb_build_object(
        'orderId',pv.order_id,'userId',pv.user_id,'user',coalesce(u.nombre,u.rol,'Empaque'),
        'verifiedAt',to_char(pv.verified_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),
        'lineIds',pv.line_ids,'orderSignature',pv.order_signature,'snapshot',pv.snapshot
      ) order by pv.verified_at desc) from public.packing_verifications pv left join public.users u on u.id=pv.user_id where pv.order_id=o.id),'[]'::jsonb),
      'orderStageAssignments',coalesce((select jsonb_agg(jsonb_build_object(
        'id',s.id,'orderId',s.order_id,'stage',s.stage,'userId',s.user_id,'user',coalesce(u.nombre,''),
        'status',s.status,'claimedAt',to_char(s.claimed_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),
        'releasedAt',coalesce(to_char(s.released_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),''),
        'releaseReason',coalesce(s.release_reason,'')
      ) order by s.claimed_at desc,s.id desc) from public.order_stage_assignments s left join public.users u on u.id=s.user_id where s.order_id=o.id),'[]'::jsonb),
      'orderLineProgress',coalesce((select jsonb_agg(jsonb_build_object(
        'orderItemId',p.order_item_id,'orderId',p.order_id,'stage',p.stage,'status',p.status,
        'userId',p.user_id,'user',coalesce(u.nombre,''),
        'updatedAt',to_char(p.updated_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),'version',p.version
      ) order by p.updated_at desc,p.order_item_id desc) from public.order_line_progress p left join public.users u on u.id=p.user_id where p.order_id=o.id),'[]'::jsonb),
      'orderIncidents',coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,'orderId',i.order_id,'orderItemId',coalesce(i.order_item_id,''),'area',i.area,
        'type',i.type,'description',i.description,'status',i.status,'createdBy',i.created_by,
        'createdByName',coalesce(cu.nombre,''),'createdAt',to_char(i.created_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),
        'resolvedBy',coalesce(i.resolved_by,''),'resolvedAt',coalesce(to_char(i.resolved_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),''),
        'resolution',coalesce(i.resolution,'')
      ) order by i.created_at desc,i.id desc) from public.order_incidents i left join public.users cu on cu.id=i.created_by where i.order_id=o.id),'[]'::jsonb),
      'orderDispatchHandoffs',coalesce((select jsonb_agg(jsonb_build_object(
        'orderId',h.order_id,'status',h.status,'packingUserId',h.packing_user_id,
        'packingUser',coalesce(pu.nombre,''),'logisticsUserId',coalesce(h.logistics_user_id,''),
        'logisticsUser',coalesce(lu.nombre,''),'offeredAt',to_char(h.offered_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),
        'acceptedAt',coalesce(to_char(h.accepted_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),''),
        'packageSignature',h.package_signature,'note',coalesce(h.note,''),'version',h.version
      ) order by h.offered_at desc) from public.order_dispatch_handoffs h
        left join public.users pu on pu.id=h.packing_user_id left join public.users lu on lu.id=h.logistics_user_id
        where h.order_id=o.id),'[]'::jsonb)
    ) delta
    from requested r
    join public.orders o on o.id=r.order_id
    left join public.order_sync_versions v on v.order_id=o.id
  )
  select jsonb_build_object(
    'contract','momos.order-delta-batch.v1',
    'serverTime',statement_timestamp(),
    'deltas',coalesce(jsonb_agg(p.delta order by p.first_ord),'[]'::jsonb),
    'containsSecrets',false,
    'externalExecution',false
  ) into v_response from payload p;
  return v_response;
end $$;

revoke all on function public.momos_order_deltas_v1(text[]) from public,anon,service_role;
grant execute on function public.momos_order_deltas_v1(text[]) to authenticated;

create or replace function public.pedidos_deltas_disponibles()
returns boolean
language sql stable security definer set search_path=pg_catalog,public,pg_temp
as $$
  select public.is_staff()
    and to_regprocedure('public.momos_order_deltas_v1(text[])') is not null
    and to_regclass('public.order_sync_versions') is not null
    and exists(
      select 1 from public.momos_ops_migrations
      where id='20260719_71_pedidos_deltas'
    )
$$;
revoke all on function public.pedidos_deltas_disponibles() from public,anon,service_role;
grant execute on function public.pedidos_deltas_disponibles() to authenticated;

-- Conserva el contrato H70 y suma la capacidad H71 dentro de la lectura de
-- arranque ya existente; no agrega una sonda HTTP al navegador.
create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_capabilities jsonb;
  v_schema_version text;
  v_inventory_event_id bigint:=0;
begin
  if auth.uid() is null or not exists(
    select 1 from public.users u where u.auth_id=auth.uid() and u.activo
  ) then raise exception 'Sesion MOMOS invalida.' using errcode='42501'; end if;
  select coalesce(jsonb_object_agg(x.name,
    to_regprocedure(format('public.%I()',x.name)) is not null),'{}'::jsonb)
  into v_capabilities
  from unnest(array[
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
    'inventario_deltas_disponibles','pedidos_deltas_disponibles'
  ]::text[]) x(name);
  select id into v_schema_version
  from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  v_inventory_event_id:=4611686018427387904
    + ((pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot()))::text)::bigint;
  return jsonb_build_object(
    'version',1,'schema_version',coalesce(v_schema_version,''),'server_time',clock_timestamp(),
    'capabilities',v_capabilities,'inventory_latest_event_id',v_inventory_event_id::text,
    'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object('version',extract(epoch from clock_timestamp())::bigint,'ttl_seconds',60,'inventory_latest_event_id',v_inventory_event_id::text),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300)
    ),
    'contains_pii',false,'contains_secrets',false,'external_execution',false
  );
end $$;

revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1 from pg_catalog.pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='order_sync_versions'
     ) then
    alter publication supabase_realtime add table public.order_sync_versions;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260719_71_pedidos_deltas',
  'Pedidos y Empaque aplican deltas cerrados por orden con versión monotónica, RBAC y fallback seguro'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
