-- MOMOS OPS · H82 · mutaciones logísticas atómicas con recibo H71.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_migration_20260719_82'));

do $$ begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260719_81_domicilios_snapshot') then
    raise exception 'Falta el paso 81_domicilios_snapshot.';
  end if;
  if to_regprocedure('public.crear_domicilio(text,text,text,numeric,text)') is null
     or to_regprocedure('public.actualizar_domicilio(text,jsonb)') is null
     or to_regprocedure('public.set_order_status(text,text,boolean)') is null
     or to_regprocedure('public.momos_order_deltas_v1(text[])') is null then
    raise exception 'H82 requiere Domicilios y el contrato dirigido H71.';
  end if;
end $$;

create table if not exists public.delivery_mutation_receipts(
  operation text not null check(operation in('assign','update','transition')),
  idempotency_key uuid not null,
  request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),
  order_id text not null references public.orders(id) on delete cascade,
  delivery_id text not null references public.deliveries(id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(operation,idempotency_key)
);
alter table public.delivery_mutation_receipts enable row level security;
revoke all on table public.delivery_mutation_receipts from public,anon,authenticated,service_role;
create index if not exists delivery_mutation_receipts_order_recent_idx
  on public.delivery_mutation_receipts(order_id,created_at desc);

create or replace function public._momos_delivery_mutation_response_v1(
  p_operation text,p_key uuid,p_duplicate boolean,p_order_id text,p_delivery_id text
) returns jsonb language sql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
  select jsonb_build_object(
    'contract','momos.delivery-mutation.v1','operation',p_operation,
    'idempotencyKey',p_key::text,'duplicate',p_duplicate,
    'orderId',p_order_id,'deliveryId',p_delivery_id,
    'orderDelta',public.momos_order_deltas_v1(array[p_order_id]),
    'containsCustomerPii',true,'containsSecrets',false,'externalExecution',false
  )
$$;
revoke all on function public._momos_delivery_mutation_response_v1(text,uuid,boolean,text,text)
  from public,anon,authenticated,service_role;

create or replace function public.mutar_domicilio_delta(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_operation text; v_key uuid; v_payload jsonb; v_hash text;
  v_order_id text; v_delivery_id text; v_state text;
  v_receipt public.delivery_mutation_receipts%rowtype;
  v_allowed text[];
begin
  if auth.uid() is null or public.current_user_has_any_role(array['Administrador','Logística','Mensajero']::text[]) is not true then
    raise exception 'Solo Logística activa puede operar domicilios.' using errcode='42501';
  end if;
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in('operation','idempotency_key','payload')) then
    raise exception 'La mutación logística no cumple el contrato cerrado.';
  end if;
  v_operation:=nullif(btrim(coalesce(p->>'operation','')),'');
  begin v_key:=(p->>'idempotency_key')::uuid;
  exception when others then raise exception 'La llave idempotente logística debe ser UUID.'; end;
  v_payload:=p->'payload';
  if v_operation not in('assign','update','transition') or jsonb_typeof(v_payload) is distinct from 'object' then
    raise exception 'Operación o payload logístico inválido.';
  end if;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    jsonb_build_object('operation',v_operation,'payload',v_payload)::text,'UTF8'
  )),'hex');
  perform pg_advisory_xact_lock(hashtextextended('momos-delivery:'||v_operation||':'||v_key::text,0));
  select * into v_receipt from public.delivery_mutation_receipts
  where operation=v_operation and idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then
      raise exception 'La llave idempotente logística ya pertenece a otro contrato.';
    end if;
    return public._momos_delivery_mutation_response_v1(
      v_operation,v_key,true,v_receipt.order_id,v_receipt.delivery_id
    );
  end if;

  if v_operation='assign' then
    v_allowed:=array['order_id','proveedor','zona','costo_real','obs'];
    if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then
      raise exception 'La asignación contiene campos no permitidos.';
    end if;
    v_order_id:=nullif(btrim(coalesce(v_payload->>'order_id','')),'');
    if v_order_id is null or nullif(btrim(coalesce(v_payload->>'proveedor','')),'') is null then
      raise exception 'Pedido y proveedor son obligatorios.';
    end if;
    v_delivery_id:=public.crear_domicilio(
      v_order_id,v_payload->>'proveedor',nullif(v_payload->>'zona',''),
      coalesce((v_payload->>'costo_real')::numeric,0),coalesce(v_payload->>'obs','')
    );
  elsif v_operation='update' then
    v_allowed:=array['order_id','delivery_id','estado','proveedor','zona','costo_real','codigo','obs'];
    if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then
      raise exception 'La actualización contiene campos no permitidos.';
    end if;
    v_order_id:=nullif(btrim(coalesce(v_payload->>'order_id','')),'');
    v_delivery_id:=nullif(btrim(coalesce(v_payload->>'delivery_id','')),'');
    if v_order_id is null or v_delivery_id is null
       or not exists(select 1 from public.deliveries d where d.id=v_delivery_id and d.order_id=v_order_id) then
      raise exception 'El domicilio no pertenece al pedido indicado.';
    end if;
    if (select count(*) from jsonb_object_keys(v_payload))<=2 then
      raise exception 'No hay cambios logísticos para aplicar.';
    end if;
    perform public.actualizar_domicilio(v_delivery_id,v_payload-'order_id'-'delivery_id');
  else
    v_allowed:=array['order_id','estado'];
    if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then
      raise exception 'La transición contiene campos no permitidos.';
    end if;
    v_order_id:=nullif(btrim(coalesce(v_payload->>'order_id','')),'');
    v_state:=nullif(btrim(coalesce(v_payload->>'estado','')),'');
    if v_order_id is null or v_state not in('En ruta','Entregado') then
      raise exception 'Domicilios solo puede confirmar En ruta o Entregado.';
    end if;
    perform public.set_order_status(v_order_id,v_state,false);
    select d.id into v_delivery_id from public.deliveries d
    where d.order_id=v_order_id and d.estado<>'Cancelado'
    order by d.id desc limit 1;
    if v_delivery_id is null then raise exception 'El pedido no tiene domicilio confirmado.'; end if;
  end if;

  insert into public.delivery_mutation_receipts(
    operation,idempotency_key,request_hash,order_id,delivery_id,created_by
  ) values(v_operation,v_key,v_hash,v_order_id,v_delivery_id,auth.uid());
  return public._momos_delivery_mutation_response_v1(
    v_operation,v_key,false,v_order_id,v_delivery_id
  );
end $$;
revoke all on function public.mutar_domicilio_delta(jsonb) from public,anon,service_role;
grant execute on function public.mutar_domicilio_delta(jsonb) to authenticated;

create or replace function public.domicilios_mutaciones_atomicas_disponibles()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
  select public.current_user_has_any_role(array['Administrador','Logística','Mensajero']::text[])
    and exists(select 1 from public.momos_ops_migrations where id='20260719_82_domicilios_mutaciones_atomicas')
    and to_regprocedure('public.mutar_domicilio_delta(jsonb)') is not null
$$;
revoke all on function public.domicilios_mutaciones_atomicas_disponibles() from public,anon,service_role;
grant execute on function public.domicilios_mutaciones_atomicas_disponibles() to authenticated;

-- Extiende H81 sin agregar una sonda HTTP al navegador.
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
    'dashboard_operativo_disponible','domicilios_snapshot_disponible','domicilios_mutaciones_atomicas_disponibles'
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
values('20260719_82_domicilios_mutaciones_atomicas','Domicilios asigna y actualiza con idempotencia y delta H71 del mismo commit')
on conflict(id) do update set detalle=excluded.detalle;

commit;
