-- MOMOS OPS · H84 · desecho trazable de producto terminado vencido.
-- Retira únicamente el saldo exacto no reservado de un lote + figura. Las
-- unidades perfectas permanecen como rendimiento histórico; consumidas actúa
-- como contador de salidas exactas y el motivo queda en un ledger inmutable.
-- La persona confirma una cantidad esperada: si el saldo cambia mientras el
-- modal está abierto, la operación falla cerrada y exige recargar.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260720'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_83_vida_util_produccion'
  ) then
    raise exception 'Falta el paso 83_vida_util_produccion.';
  end if;
  if to_regclass('public.production_batches') is null
     or to_regclass('public.lote_figuras') is null
     or to_regclass('public.production_delta_receipts') is null
     or to_regprocedure('public._momos_production_mutation_response_v1(text,text,boolean,jsonb,text[],text[],boolean)') is null
     or to_regprocedure('public.current_user_has_any_role(text[])') is null
     or to_regprocedure('public._add_audit(text,text,text,text,text)') is null then
    raise exception 'Faltan dependencias de Producción trazable H73.';
  end if;
end $$;

-- H73 protege el outbox de mutaciones con una lista cerrada. H84 amplía ese
-- contrato dentro de la misma transacción antes de que la nueva RPC lo use.
alter table public.production_delta_receipts
  drop constraint if exists production_delta_receipts_operation_check;
alter table public.production_delta_receipts
  add constraint production_delta_receipts_operation_check
  check(operation in (
    'crear_corrida','producir_subreceta','convertir_imperfectas',
    'desechar_producto_terminado'
  ));

create table if not exists public.finished_product_disposals(
  id bigint generated always as identity primary key,
  batch_id text not null references public.production_batches(id),
  figure text not null,
  product_id text not null references public.products(id),
  quantity integer not null check(quantity>0),
  reason text not null check(length(btrim(reason)) between 1 and 500),
  created_by uuid not null references public.users(auth_id),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists finished_product_disposals_batch_figure_idx
  on public.finished_product_disposals(batch_id,figure,created_at desc);
comment on table public.finished_product_disposals is
  'Ledger inmutable de producto terminado retirado por vencimiento, con lote, figura, cantidad, motivo y actor.';
comment on column public.lote_figuras.consumidas is
  'Unidades retiradas del saldo vendible exacto: reservas/ventas más desechos trazados en finished_product_disposals.';

alter table public.finished_product_disposals enable row level security;
drop policy if exists finished_product_disposals_staff_read
  on public.finished_product_disposals;
create policy finished_product_disposals_staff_read
  on public.finished_product_disposals for select to authenticated
  using(public.is_staff());
revoke all on table public.finished_product_disposals
  from public,anon,authenticated,service_role;
grant select on table public.finished_product_disposals to authenticated;
revoke all on sequence public.finished_product_disposals_id_seq
  from public,anon,authenticated,service_role;

create or replace function public.desechar_producto_terminado_delta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_key text;
  v_hash text;
  v_batch_id text;
  v_figure text;
  v_reason text;
  v_expected_quantity integer;
  v_today date:=(clock_timestamp() at time zone 'America/Bogota')::date;
  v_batch public.production_batches%rowtype;
  v_lot public.lote_figuras%rowtype;
  v_quantity integer;
  v_product_stock numeric;
  v_result jsonb;
  v_receipt public.production_delta_receipts%rowtype;
begin
  if public.current_user_has_any_role(array['Administrador','Cocina']) is not true then
    raise exception 'Solo Administrador o Cocina pueden desechar producto terminado vencido.';
  end if;
  if jsonb_typeof(p)<>'object' or exists(
    select 1 from jsonb_object_keys(p) x(key)
    where key not in ('batch_id','figura','motivo','cantidad_esperada','idempotency_key')
  ) then
    raise exception 'El payload no cumple el contrato cerrado.';
  end if;
  v_key:=nullif(btrim(coalesce(p->>'idempotency_key','')),'');
  v_batch_id:=nullif(btrim(coalesce(p->>'batch_id','')),'');
  v_figure:=nullif(btrim(coalesce(p->>'figura','')),'');
  v_reason:=nullif(btrim(coalesce(p->>'motivo','')),'');
  begin
    v_expected_quantity:=(p->>'cantidad_esperada')::integer;
  exception when others then
    raise exception 'cantidad_esperada debe ser un entero positivo.';
  end;
  if v_key is null or length(v_key)>200 or v_batch_id is null or v_figure is null
     or v_reason is null or length(v_reason)>500
     or v_expected_quantity is null or v_expected_quantity<=0 then
    raise exception 'batch_id, figura, motivo, cantidad_esperada e idempotency_key son obligatorios y válidos.';
  end if;
  v_hash:=pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to((p-'idempotency_key')::text,'UTF8')),
    'hex'
  );
  perform pg_advisory_xact_lock(hashtextextended(
    'momos-production-delta:desechar-producto-terminado:'||v_key,0
  ));
  select * into v_receipt from public.production_delta_receipts
  where operation='desechar_producto_terminado' and idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then
      raise exception 'La llave de idempotencia ya pertenece a otro contrato.';
    end if;
    return public._momos_production_mutation_response_v1(
      v_receipt.operation,v_key,true,v_receipt.result,v_receipt.item_ids,
      v_receipt.product_ids,v_receipt.activity_changed
    );
  end if;

  select * into v_batch from public.production_batches
  where id=v_batch_id for update;
  if v_batch.id is null then raise exception 'El lote % no existe.',v_batch_id; end if;
  if v_batch.estado<>'Listo' or v_batch.stock_contabilizado is not true then
    raise exception 'El lote % todavía no es producto terminado contabilizado.',v_batch_id;
  end if;
  if coalesce(v_batch.vencimiento,v_batch.vence) is null
     or coalesce(v_batch.vencimiento,v_batch.vence)>=v_today then
    raise exception 'El lote % no está vencido y no puede desecharse por este flujo.',v_batch_id;
  end if;

  -- Orden canónico compartido con reservas y desmolde: producto antes que
  -- lote_figuras. Evita el ciclo producto→figura / figura→producto.
  select stock into v_product_stock from public.products
  where id=v_batch.product_id for update;
  if v_product_stock is null then raise exception 'El producto del lote ya no existe.'; end if;

  select * into v_lot from public.lote_figuras
  where batch_id=v_batch_id and figura=v_figure for update;
  if v_lot.batch_id is null then
    raise exception 'La figura % no existe en el lote %.',v_figure,v_batch_id;
  end if;
  -- consumidas incluye reservas/ventas exactas: solo retiramos el remanente
  -- físico libre, por lo que una unidad comprometida nunca se desecha aquí.
  v_quantity:=greatest(0,v_lot.perfectas-v_lot.consumidas);
  if v_quantity<=0 then
    raise exception 'La figura % del lote % ya no tiene saldo libre para desechar.',v_figure,v_batch_id;
  end if;
  if v_quantity<>v_expected_quantity then
    raise exception 'El saldo libre cambió de % a % unidades. Recargá la ficha antes de confirmar.',
      v_expected_quantity,v_quantity;
  end if;
  if v_product_stock<v_quantity then
    raise exception 'El stock agregado no cuadra con el lote %. Conciliá antes de desechar.',v_batch_id;
  end if;

  update public.lote_figuras
  set consumidas=consumidas+v_quantity
  where batch_id=v_batch_id and figura=v_figure;
  update public.products set stock=stock-v_quantity where id=v_batch.product_id;
  insert into public.finished_product_disposals(
    batch_id,figure,product_id,quantity,reason,created_by
  ) values(v_batch_id,v_figure,v_batch.product_id,v_quantity,v_reason,auth.uid());
  perform public._add_audit(
    'Producción',v_batch_id,'Producto terminado vencido desechado',
    v_figure||' · '||v_quantity||' und',v_reason
  );

  v_result:=jsonb_build_object(
    'contract','momos.finished-product-disposal.v1','ok',true,
    'batch_id',v_batch_id,'product_id',v_batch.product_id,'figura',v_figure,
    'desechado',v_quantity,'motivo',v_reason,
    'stock',v_product_stock-v_quantity
  );
  insert into public.production_delta_receipts(
    operation,idempotency_key,request_hash,result,item_ids,product_ids,
    activity_changed,created_by
  ) values(
    'desechar_producto_terminado',v_key,v_hash,v_result,array[]::text[],
    array[v_batch.product_id],false,auth.uid()
  );
  return public._momos_production_mutation_response_v1(
    'desechar_producto_terminado',v_key,false,v_result,array[]::text[],
    array[v_batch.product_id],false
  );
end;
$$;

revoke all on function public.desechar_producto_terminado_delta(jsonb)
  from public,anon,service_role;
grant execute on function public.desechar_producto_terminado_delta(jsonb)
  to authenticated;

create or replace function public.desecho_producto_terminado_disponible()
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select public.current_user_has_any_role(array['Administrador','Cocina']::text[])
    and exists(
      select 1 from public.momos_ops_migrations
      where id='20260720_84_desecho_producto_terminado'
    )
    and to_regprocedure('public.desechar_producto_terminado_delta(jsonb)') is not null
$$;
revoke all on function public.desecho_producto_terminado_disponible()
  from public,anon,service_role;
grant execute on function public.desecho_producto_terminado_disponible()
  to authenticated;

-- El cliente no infiere H84 a partir de H73. El manifiesto anuncia una
-- capacidad propia para que la acción solo exista cuando backend y rol están
-- realmente listos. Conserva todos los dominios compactos instalados en H82.
create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_capabilities jsonb; v_schema_version text; v_inventory_event_id bigint:=0;
  v_finance_version bigint:=0; v_configuration_version bigint:=0;
  v_dashboard_version bigint:=0; v_delivery_version bigint:=0;
begin
  if auth.uid() is null or not exists(
    select 1 from public.users u where u.auth_id=auth.uid() and u.activo
  ) then
    raise exception 'Sesión MOMOS inválida.' using errcode='42501';
  end if;
  select coalesce(jsonb_object_agg(
    x.name,to_regprocedure(format('public.%I()',x.name)) is not null
  ),'{}'::jsonb)
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
    'dashboard_operativo_disponible','domicilios_snapshot_disponible','domicilios_mutaciones_atomicas_disponibles',
    'desecho_producto_terminado_disponible'
  ]::text[]) x(name);
  select id into v_schema_version
  from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  select version into v_finance_version from public.finance_sync_state where id=1;
  select version into v_configuration_version from public.configuration_sync_state where id=1;
  select version into v_dashboard_version from public.dashboard_sync_state where id=1;
  select version into v_delivery_version from public.delivery_sync_state where id=1;
  v_inventory_event_id:=4611686018427387904
    +((pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot()))::text)::bigint;
  return jsonb_build_object(
    'version',1,'schema_version',coalesce(v_schema_version,''),
    'server_time',clock_timestamp(),'capabilities',v_capabilities,
    'inventory_latest_event_id',v_inventory_event_id::text,
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
revoke all on function public.momos_sync_manifest_v1()
  from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260720_84_desecho_producto_terminado',
  'Desecho trazable por lote y figura vencidos, con cantidad esperada y locks canónicos sin tocar reservas ni rendimiento histórico'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
