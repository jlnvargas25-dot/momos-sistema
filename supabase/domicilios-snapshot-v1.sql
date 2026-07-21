-- MOMOS OPS · H81 · snapshot compacto y versionado de Logística.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_migration_20260719_81'));

do $$ begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260719_80_produccion_preflight_elaboraciones') then
    raise exception 'Falta el paso 80_produccion_preflight_elaboraciones.';
  end if;
  if to_regclass('public.order_sync_versions') is null
     or to_regprocedure('public.momos_order_deltas_v1(text[])') is null then
    raise exception 'H81 necesita el contrato dirigido H71.';
  end if;
end $$;

create table if not exists public.delivery_sync_state(
  id smallint primary key default 1 check(id=1),
  version bigint not null default 1 check(version>0),
  changed_at timestamptz not null default clock_timestamp()
);
insert into public.delivery_sync_state(id,version) values(1,1) on conflict(id) do nothing;

alter table public.delivery_sync_state enable row level security;
drop policy if exists delivery_sync_state_logistics_read on public.delivery_sync_state;
create policy delivery_sync_state_logistics_read on public.delivery_sync_state
  for select to authenticated
  using(public.current_user_has_any_role(array['Administrador','Logística','Mensajero']::text[]));
revoke all on table public.delivery_sync_state from public,anon,authenticated,service_role;
grant select on table public.delivery_sync_state to authenticated;

create or replace function public._momos_touch_delivery_sync_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  insert into public.delivery_sync_state(id,version,changed_at) values(1,1,clock_timestamp())
  on conflict(id) do update set version=public.delivery_sync_state.version+1,changed_at=excluded.changed_at;
  return null;
end $$;
revoke all on function public._momos_touch_delivery_sync_v1() from public,anon,authenticated,service_role;

drop trigger if exists momos_delivery_sync_touch on public.order_sync_versions;
create trigger momos_delivery_sync_touch
after insert or update or delete on public.order_sync_versions
for each statement execute function public._momos_touch_delivery_sync_v1();

create or replace function public.momos_delivery_snapshot_v1(p_history_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_limit integer:=least(50,greatest(1,coalesce(p_history_limit,50)));
  v_version bigint;
  v_active_ids text[]:=array[]::text[];
  v_history_ids text[]:=array[]::text[];
  v_ids text[]:=array[]::text[];
  v_orders jsonb:='[]'::jsonb;
  v_items jsonb:='[]'::jsonb;
  v_customers jsonb:='[]'::jsonb;
  v_deliveries jsonb:='[]'::jsonb;
  v_versions jsonb:='[]'::jsonb;
  v_ready_without integer:=0;
  v_subsidy numeric:=0;
  v_surplus numeric:=0;
begin
  if auth.uid() is null or not public.current_user_has_any_role(array['Administrador','Logística','Mensajero']::text[]) then
    raise exception 'Solo Logística activa puede consultar los domicilios.' using errcode='42501';
  end if;
  select version into v_version from public.delivery_sync_state where id=1;

  select coalesce(array_agg(x.id order by x.fecha,x.hora,x.id),array[]::text[])
  into v_active_ids from(
    select o.id,o.fecha,o.hora
    from public.orders o
    where coalesce(o.canal,'')<>'Rappi' and o.estado not in('Entregado','Cancelado') and(
      exists(select 1 from public.deliveries d where d.order_id=o.id and d.estado in('Por solicitar','Solicitado','Asignado','En ruta','Problema'))
      or(o.estado in('Empacado','Listo para despacho') and not exists(
        select 1 from public.deliveries d where d.order_id=o.id and d.estado in('Por solicitar','Solicitado','Asignado','En ruta','Problema')
      ))
    )
    order by o.fecha,o.hora,o.id limit 200
  ) x;

  select coalesce(array_agg(x.id order by x.fecha desc,x.hora desc,x.id desc),array[]::text[])
  into v_history_ids from(
    select o.id,o.fecha,o.hora
    from public.orders o
    where coalesce(o.canal,'')<>'Rappi' and not(o.id=any(v_active_ids))
      and exists(select 1 from public.deliveries d where d.order_id=o.id and d.estado in('Entregado','Cancelado'))
    order by o.fecha desc,o.hora desc,o.id desc limit v_limit
  ) x;
  v_ids:=array_cat(v_active_ids,v_history_ids);

  select count(*) into v_ready_without from public.orders o
  where o.id=any(v_active_ids) and o.estado in('Empacado','Listo para despacho')
    and not exists(select 1 from public.deliveries d where d.order_id=o.id and d.estado in('Por solicitar','Solicitado','Asignado','En ruta','Problema'));

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'fecha',o.fecha,'hora',to_char(o.hora,'HH24:MI'),'canal',o.canal,
    'customerId',coalesce(o.customer_id,''),'barrio',coalesce(o.barrio,''),
    'direccion',coalesce(o.direccion,''),'zona',coalesce(o.zona,''),
    'domCobrado',o.dom_cobrado,'domCosto',o.dom_costo,'descuento',o.descuento,
    'pago',coalesce(o.pago,''),'estado',o.estado,'obs',coalesce(o.obs,'')
  ) order by o.fecha,o.hora,o.id),'[]'::jsonb) into v_orders
  from public.orders o where o.id=any(v_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',oi.id,'orderId',oi.order_id,'nombre',oi.nombre,'cant',oi.cant,'precio',oi.precio,
    'sabor',coalesce(oi.sabor,''),'salsa',coalesce(oi.salsa,''),
    'relleno',coalesce(oi.relleno,''),'figura',coalesce(oi.figura,'')
  ) order by oi.order_id,oi.id),'[]'::jsonb) into v_items
  from(
    select x.* from public.order_items x
    where x.order_id=any(v_ids)
    order by x.order_id,x.id
    limit 3000
  ) oi;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'nombre',c.nombre,'telefono',coalesce(c.telefono,''),
    'barrio',coalesce(c.barrio,''),'direccion',coalesce(c.direccion,'')
  ) order by c.id),'[]'::jsonb) into v_customers
  from public.customers c where exists(
    select 1 from public.orders o where o.id=any(v_ids) and o.customer_id=c.id
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'orderId',d.order_id,'proveedor',d.proveedor,'costoReal',d.costo_real,
    'cobrado',d.cobrado,'zona',coalesce(d.zona,''),
    'hSolicitud',coalesce(to_char(d.h_solicitud,'HH24:MI'),''),
    'hSalida',coalesce(to_char(d.h_salida,'HH24:MI'),''),
    'hEntrega',coalesce(to_char(d.h_entrega,'HH24:MI'),''),
    'codigo',coalesce(d.codigo,''),'estado',d.estado,'obs',coalesce(d.obs,'')
  ) order by d.order_id,d.id desc),'[]'::jsonb),
  coalesce(sum(greatest(0,d.costo_real-d.cobrado)),0),
  coalesce(sum(greatest(0,d.cobrado-d.costo_real)),0)
  into v_deliveries,v_subsidy,v_surplus
  from(
    select x.* from public.deliveries x
    where x.order_id=any(v_ids)
    order by x.order_id,x.id desc
    limit 1000
  ) d;

  select coalesce(jsonb_agg(jsonb_build_object('orderId',o.id,'version',coalesce(v.version,1)::text) order by o.id),'[]'::jsonb)
  into v_versions from public.orders o left join public.order_sync_versions v on v.order_id=o.id where o.id=any(v_ids);

  return jsonb_build_object(
    'contract','momos.delivery-snapshot.v1','version',coalesce(v_version,1)::text,'serverTime',statement_timestamp(),
    'summary',jsonb_build_object(
      'activeOrders',cardinality(v_active_ids),'readyWithoutDelivery',v_ready_without,
      'historyReturned',cardinality(v_history_ids),'historyLimit',v_limit,
      'subsidy',v_subsidy,'surplus',v_surplus
    ),
    'orders',v_orders,'orderItems',v_items,'customers',v_customers,'deliveries',v_deliveries,'orderVersions',v_versions,
    'privacy',jsonb_build_object(
      'bounded',true,'containsCustomerPii',true,'destinationPiiRequired',true,'containsFreeText',true,
      'containsSecrets',false,'containsStaffPii',false,'containsStorageReferences',false,'externalExecution',false
    )
  );
end $$;
revoke all on function public.momos_delivery_snapshot_v1(integer) from public,anon,service_role;
grant execute on function public.momos_delivery_snapshot_v1(integer) to authenticated;

create or replace function public.domicilios_snapshot_disponible()
returns boolean language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
  select public.current_user_has_any_role(array['Administrador','Logística','Mensajero']::text[])
    and exists(select 1 from public.momos_ops_migrations where id='20260719_81_domicilios_snapshot')
    and to_regprocedure('public.momos_delivery_snapshot_v1(integer)') is not null
$$;
revoke all on function public.domicilios_snapshot_disponible() from public,anon,service_role;
grant execute on function public.domicilios_snapshot_disponible() to authenticated;

-- Extiende el manifiesto de arranque sin agregar una sonda HTTP.
create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_capabilities jsonb; v_schema_version text; v_inventory_event_id bigint:=0;
  v_finance_version bigint:=0; v_configuration_version bigint:=0; v_dashboard_version bigint:=0; v_delivery_version bigint:=0;
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
    'dashboard_operativo_disponible','domicilios_snapshot_disponible'
  ]::text[]) x(name);
  select id into v_schema_version from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  select version into v_finance_version from public.finance_sync_state where id=1;
  select version into v_configuration_version from public.configuration_sync_state where id=1;
  select version into v_dashboard_version from public.dashboard_sync_state where id=1;
  select version into v_delivery_version from public.delivery_sync_state where id=1;
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
      'dashboard',jsonb_build_object('version',coalesce(v_dashboard_version,0)::text,'ttl_seconds',30),
      'logistica',jsonb_build_object('version',coalesce(v_delivery_version,0)::text,'ttl_seconds',30)
    ),'contains_pii',false,'contains_secrets',false,'external_execution',false
  );
end $$;
revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260719_81_domicilios_snapshot','Snapshot compacto y acotado de Logística con PII de destino declarada, H71 incremental y RBAC')
on conflict(id) do update set detalle=excluded.detalle;

commit;
