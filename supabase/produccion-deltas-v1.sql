-- MOMOS OPS · H73 Produccion por deltas atomicos v1.
--
-- Crear corridas, preparar subrecetas y convertir imperfectas conservan sus
-- RPC canonicas. Estos wrappers agregan un recibo idempotente y devuelven, en
-- la misma transaccion, solo los insumos, lotes y actividad que cambiaron.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260719'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260719_72_producto_terminado_deltas') then
    raise exception 'H73 requiere H72 Inventario terminado por deltas.';
  end if;
  if to_regprocedure('public.crear_corrida(jsonb)') is null
     or to_regprocedure('public.producir_subreceta(jsonb)') is null
     or to_regprocedure('public.convertir_imperfectas(text)') is null then
    raise exception 'H73 requiere las RPC canonicas de Produccion.';
  end if;
  if to_regprocedure('public.momos_inventory_deltas_v1(text[])') is null
     or to_regprocedure('public.momos_finished_inventory_deltas_v1(text[])') is null then
    raise exception 'H73 requiere H70 y H72 para construir deltas exactos.';
  end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'H73 requiere pg_catalog.sha256(bytea) para sellar idempotencia.';
  end if;
end $$;

create table if not exists public.production_activity_sync_versions(
  scope text primary key check(scope='production'),
  version bigint not null default 1 check(version>0),
  changed_at timestamptz not null default clock_timestamp()
);
alter table public.production_activity_sync_versions enable row level security;
drop policy if exists production_activity_sync_versions_staff_read
  on public.production_activity_sync_versions;
create policy production_activity_sync_versions_staff_read
  on public.production_activity_sync_versions for select to authenticated
  using(public.is_staff());
revoke all on table public.production_activity_sync_versions
  from public,anon,authenticated,service_role;
grant select on table public.production_activity_sync_versions to authenticated;
insert into public.production_activity_sync_versions(scope,version)
values('production',1) on conflict(scope) do nothing;

create or replace function public._momos_touch_production_activity_sync_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if tg_op<>'INSERT' and to_jsonb(old) is not distinct from to_jsonb(new) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  insert into public.production_activity_sync_versions(scope,version,changed_at)
  values('production',1,clock_timestamp())
  on conflict(scope) do update
    set version=public.production_activity_sync_versions.version+1,
        changed_at=excluded.changed_at;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public._momos_touch_production_activity_sync_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists momos_production_activity_sync_touch on public.subreceta_producciones;
create trigger momos_production_activity_sync_touch
after insert or update or delete on public.subreceta_producciones
for each row execute function public._momos_touch_production_activity_sync_v1();
drop trigger if exists momos_production_activity_sync_touch on public.production_suggestions;
create trigger momos_production_activity_sync_touch
after insert or update or delete on public.production_suggestions
for each row execute function public._momos_touch_production_activity_sync_v1();

create or replace function public.momos_production_activity_delta_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_version bigint; v_response jsonb;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  select version into v_version
  from public.production_activity_sync_versions where scope='production';
  select jsonb_build_object(
    'contract','momos.production-activity-delta.v1',
    'version',coalesce(v_version,1)::text,
    'subrecipeProductions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',x.id,'fecha',x.fecha::text,'subrecetaId',x.subreceta_id,
      'gramosNominales',x.gramos_nominales,'gramosObtenidos',x.gramos_obtenidos,
      'costoBatch',x.costo_batch,'faltantes',coalesce(x.faltantes,'[]'::jsonb),
      'creado',x.created_at
    ) order by x.created_at desc,x.id desc) from (
      select sp.id,sp.fecha,sp.subreceta_id,sp.gramos_nominales,
             sp.gramos_obtenidos,sp.costo_batch,sp.faltantes,sp.created_at
      from public.subreceta_producciones sp
      order by sp.created_at desc,sp.id desc limit 50
    ) x),'[]'::jsonb),
    'productionSuggestions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',x.id,'fecha',x.fecha::text,'producto',case when x.area='Inventario'
        then coalesce(i.nombre,'') else coalesce(p.nombre,'') end,
      'cantidad',coalesce(x.cantidad,0),'motivo',coalesce(x.motivo,''),
      'orderId',coalesce(x.order_id,''),'estado',x.estado,'area',x.area,
      'itemId',coalesce(x.item_id,''),'productId',coalesce(x.product_id,''),
      'orderItemId',coalesce(x.order_item_id,'')
    ) order by x.id desc) from (
      select s.id,s.fecha,s.product_id,s.item_id,s.cantidad,s.motivo,
             s.order_id,s.estado,s.area,s.order_item_id
      from public.production_suggestions s order by s.id desc limit 100
    ) x left join public.inventory_items i on i.id=x.item_id
        left join public.products p on p.id=x.product_id),'[]'::jsonb),
    'containsSecrets',false,'externalExecution',false
  ) into v_response;
  return v_response;
end $$;
revoke all on function public.momos_production_activity_delta_v1()
  from public,anon,service_role;
grant execute on function public.momos_production_activity_delta_v1() to authenticated;

create table if not exists public.production_delta_receipts(
  operation text not null check(operation in ('crear_corrida','producir_subreceta','convertir_imperfectas')),
  idempotency_key text not null check(length(idempotency_key) between 1 and 200),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  item_ids text[] not null default array[]::text[],
  product_ids text[] not null default array[]::text[],
  activity_changed boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(operation,idempotency_key)
);
alter table public.production_delta_receipts enable row level security;
revoke all on table public.production_delta_receipts
  from public,anon,authenticated,service_role;

create or replace function public._momos_production_mutation_response_v1(
  p_operation text,p_key text,p_duplicate boolean,p_result jsonb,
  p_item_ids text[],p_product_ids text[],p_activity_changed boolean
) returns jsonb
language plpgsql
volatile
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_inventory jsonb:=null; v_finished jsonb:=null; v_activity jsonb:=null;
begin
  if coalesce(cardinality(p_item_ids),0)>50 then
    raise exception 'Una mutacion de Produccion no puede afectar mas de 50 insumos.';
  end if;
  if coalesce(cardinality(p_product_ids),0)>20 then
    raise exception 'Una mutacion de Produccion no puede afectar mas de 20 productos.';
  end if;
  if coalesce(cardinality(p_item_ids),0)>0 then
    v_inventory:=public.momos_inventory_deltas_v1(p_item_ids);
  end if;
  if coalesce(cardinality(p_product_ids),0)>0 then
    v_finished:=public.momos_finished_inventory_deltas_v1(p_product_ids);
  end if;
  if p_activity_changed then
    v_activity:=public.momos_production_activity_delta_v1();
  end if;
  return jsonb_build_object(
    'contract','momos.production-mutation.v1','operation',p_operation,
    'idempotencyKey',p_key,'duplicate',p_duplicate,'result',p_result,
    'inventory',v_inventory,'finishedInventory',v_finished,'activity',v_activity,
    'containsSecrets',false,'externalExecution',false
  );
end $$;
revoke all on function public._momos_production_mutation_response_v1(
  text,text,boolean,jsonb,text[],text[],boolean
) from public,anon,authenticated,service_role;

create or replace function public.crear_corrida_delta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_key text; v_hash text; v_receipt public.production_delta_receipts%rowtype;
  v_result jsonb; v_batch_ids text[]:=array[]::text[];
  v_item_ids text[]:=array[]::text[]; v_product_ids text[]:=array[]::text[];
  v_activity boolean:=false;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if jsonb_typeof(p)<>'object' then raise exception 'El payload debe ser un objeto.'; end if;
  if exists(select 1 from jsonb_object_keys(p) x(key) where key not in (
    'sabor','relleno','salsa','resp_user_id','obs','sugerencia_id',
    'horas_congelacion','figuras','idempotency_key'
  )) then raise exception 'El payload contiene campos no permitidos.'; end if;
  v_key:=nullif(btrim(coalesce(p->>'idempotency_key','')),'');
  if v_key is null or length(v_key)>200 then raise exception 'idempotency_key es obligatoria y debe tener hasta 200 caracteres.'; end if;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((p-'idempotency_key')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('momos-production-delta:crear_corrida:'||v_key,0));
  select * into v_receipt from public.production_delta_receipts
  where operation='crear_corrida' and idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then raise exception 'La llave de idempotencia ya pertenece a otro contrato.'; end if;
    return public._momos_production_mutation_response_v1(
      v_receipt.operation,v_key,true,v_receipt.result,v_receipt.item_ids,
      v_receipt.product_ids,v_receipt.activity_changed
    );
  end if;

  v_result:=public.crear_corrida(p);
  select coalesce(array_agg(distinct x.batch_id order by x.batch_id),array[]::text[]),
         coalesce(array_agg(distinct x.product_id order by x.product_id),array[]::text[])
  into v_batch_ids,v_product_ids
  from jsonb_to_recordset(coalesce(v_result->'lotes','[]'::jsonb)) x(batch_id text,product_id text);
  select coalesce(array_agg(distinct z.item_id order by z.item_id),array[]::text[])
  into v_item_ids from (
    select m.item_id from public.inventory_movements m where m.batch_id=any(v_batch_ids)
    union
    select f->>'item_id' from jsonb_array_elements(coalesce(v_result->'faltantes','[]'::jsonb)) f
    where nullif(btrim(coalesce(f->>'item_id','')),'') is not null
  ) z;
  v_activity:=nullif(btrim(coalesce(p->>'sugerencia_id','')),'') is not null;
  insert into public.production_delta_receipts(
    operation,idempotency_key,request_hash,result,item_ids,product_ids,
    activity_changed,created_by
  ) values('crear_corrida',v_key,v_hash,v_result,v_item_ids,v_product_ids,v_activity,auth.uid());
  return public._momos_production_mutation_response_v1(
    'crear_corrida',v_key,false,v_result,v_item_ids,v_product_ids,v_activity
  );
end $$;

create or replace function public.producir_subreceta_delta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_key text; v_hash text; v_receipt public.production_delta_receipts%rowtype;
  v_result jsonb; v_item_ids text[]:=array[]::text[];
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if jsonb_typeof(p)<>'object' then raise exception 'El payload debe ser un objeto.'; end if;
  if exists(select 1 from jsonb_object_keys(p) x(key) where key not in (
    'subreceta_id','gramos_nominales','gramos_obtenidos','resp_user_id','obs','idempotency_key'
  )) then raise exception 'El payload contiene campos no permitidos.'; end if;
  v_key:=nullif(btrim(coalesce(p->>'idempotency_key','')),'');
  if v_key is null or length(v_key)>200 then raise exception 'idempotency_key es obligatoria y debe tener hasta 200 caracteres.'; end if;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((p-'idempotency_key')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('momos-production-delta:producir_subreceta:'||v_key,0));
  select * into v_receipt from public.production_delta_receipts
  where operation='producir_subreceta' and idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then raise exception 'La llave de idempotencia ya pertenece a otro contrato.'; end if;
    return public._momos_production_mutation_response_v1(
      v_receipt.operation,v_key,true,v_receipt.result,v_receipt.item_ids,
      v_receipt.product_ids,v_receipt.activity_changed
    );
  end if;

  v_result:=public.producir_subreceta(p);
  select coalesce(array_agg(distinct z.item_id order by z.item_id),array[]::text[])
  into v_item_ids from (
    select si.item_id from public.subreceta_ingredientes si
    where si.subreceta_id=p->>'subreceta_id'
    union
    select sr.item_id from public.subrecetas sr where sr.id=p->>'subreceta_id'
  ) z where nullif(btrim(coalesce(z.item_id,'')),'') is not null;
  insert into public.production_delta_receipts(
    operation,idempotency_key,request_hash,result,item_ids,product_ids,
    activity_changed,created_by
  ) values('producir_subreceta',v_key,v_hash,v_result,v_item_ids,array[]::text[],true,auth.uid());
  return public._momos_production_mutation_response_v1(
    'producir_subreceta',v_key,false,v_result,v_item_ids,array[]::text[],true
  );
end $$;

create or replace function public.convertir_imperfectas_delta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_key text; v_hash text; v_batch_id text;
  v_receipt public.production_delta_receipts%rowtype;
  v_result jsonb; v_product_ids text[]:=array[]::text[];
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if jsonb_typeof(p)<>'object' or exists(
    select 1 from jsonb_object_keys(p) x(key) where key not in ('batch_id','idempotency_key')
  ) then raise exception 'El payload no cumple el contrato cerrado.'; end if;
  v_key:=nullif(btrim(coalesce(p->>'idempotency_key','')),'');
  v_batch_id:=nullif(btrim(coalesce(p->>'batch_id','')),'');
  if v_key is null or length(v_key)>200 or v_batch_id is null then
    raise exception 'batch_id e idempotency_key son obligatorios.';
  end if;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((p-'idempotency_key')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('momos-production-delta:convertir_imperfectas:'||v_key,0));
  select * into v_receipt from public.production_delta_receipts
  where operation='convertir_imperfectas' and idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then raise exception 'La llave de idempotencia ya pertenece a otro contrato.'; end if;
    return public._momos_production_mutation_response_v1(
      v_receipt.operation,v_key,true,v_receipt.result,v_receipt.item_ids,
      v_receipt.product_ids,v_receipt.activity_changed
    );
  end if;
  select array[b.product_id] into v_product_ids
  from public.production_batches b where b.id=v_batch_id for update;
  if v_product_ids is null then raise exception 'El lote % no existe',v_batch_id; end if;
  v_result:=public.convertir_imperfectas(v_batch_id);
  insert into public.production_delta_receipts(
    operation,idempotency_key,request_hash,result,item_ids,product_ids,
    activity_changed,created_by
  ) values('convertir_imperfectas',v_key,v_hash,v_result,array[]::text[],v_product_ids,false,auth.uid());
  return public._momos_production_mutation_response_v1(
    'convertir_imperfectas',v_key,false,v_result,array[]::text[],v_product_ids,false
  );
end $$;

revoke all on function public.crear_corrida_delta(jsonb) from public,anon,service_role;
revoke all on function public.producir_subreceta_delta(jsonb) from public,anon,service_role;
revoke all on function public.convertir_imperfectas_delta(jsonb) from public,anon,service_role;
grant execute on function public.crear_corrida_delta(jsonb) to authenticated;
grant execute on function public.producir_subreceta_delta(jsonb) to authenticated;
grant execute on function public.convertir_imperfectas_delta(jsonb) to authenticated;

create or replace function public.produccion_deltas_disponibles()
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select public.is_staff()
    and to_regprocedure('public.crear_corrida_delta(jsonb)') is not null
    and to_regprocedure('public.producir_subreceta_delta(jsonb)') is not null
    and to_regprocedure('public.convertir_imperfectas_delta(jsonb)') is not null
    and to_regprocedure('public.momos_production_activity_delta_v1()') is not null
    and exists(select 1 from public.momos_ops_migrations where id='20260719_73_produccion_deltas')
$$;
revoke all on function public.produccion_deltas_disponibles() from public,anon,service_role;
grant execute on function public.produccion_deltas_disponibles() to authenticated;

-- Conserva todas las capacidades H72 y agrega H73 sin otra sonda HTTP.
create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_capabilities jsonb; v_schema_version text; v_inventory_event_id bigint:=0;
begin
  if auth.uid() is null or not exists(select 1 from public.users u where u.auth_id=auth.uid() and u.activo) then
    raise exception 'Sesion MOMOS invalida.' using errcode='42501';
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
    'produccion_deltas_disponibles'
  ]::text[]) x(name);
  select id into v_schema_version from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  v_inventory_event_id:=4611686018427387904+((pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot()))::text)::bigint;
  return jsonb_build_object(
    'version',1,'schema_version',coalesce(v_schema_version,''),'server_time',clock_timestamp(),
    'capabilities',v_capabilities,'inventory_latest_event_id',v_inventory_event_id::text,
    'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object('version',extract(epoch from clock_timestamp())::bigint,'ttl_seconds',60,'inventory_latest_event_id',v_inventory_event_id::text),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300)
    ),'contains_pii',false,'contains_secrets',false,'external_execution',false
  );
end $$;
revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_catalog.pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public'
         and tablename='production_activity_sync_versions') then
    alter publication supabase_realtime add table public.production_activity_sync_versions;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260719_73_produccion_deltas','Produccion devuelve insumos, lotes y actividad exactos en la misma mutacion con recibos idempotentes y Realtime compacto')
on conflict(id) do update set detalle=excluded.detalle;

commit;
