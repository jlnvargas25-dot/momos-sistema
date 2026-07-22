-- MOMOS OPS · H69 Inventario incremental e idempotente v1.
--
-- H68 conserva los lotes como fuente matemática exacta. Este hito agrega una
-- frontera de sincronización compacta: las mutaciones canónicas siguen
-- aplicando sus mismos guards, pero ahora entregan el ítem reconciliado y un
-- cursor monotónico. Realtime publica únicamente item_id + event_id; nunca
-- notas, actores, rutas, teléfonos ni secretos.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260719'));

-- H69 es reaplicable solo mientras H70 no haya hecho el cutover del cursor.
-- Fallar antes de cualquier DDL evita restaurar accidentalmente las funciones
-- y el trigger identity de H69 sobre una instalacion H70 ya operativa.
do $$
begin
  if to_regprocedure(
    'public._momos_inventory_events_page_v1(bigint,bigint,integer)'
  ) is not null then
    raise exception 'H69 no puede reaplicarse despues de H70.';
  end if;
  if to_regclass('public.momos_ops_migrations') is not null then
    if exists(
      select 1 from public.momos_ops_migrations
      where id='20260719_70_inventario_delta_consistencia'
    ) then
      raise exception 'H69 no puede reaplicarse despues de H70.';
    end if;
  end if;
end $$;

-- Preflight deliberadamente granular: cada fallo identifica exactamente el
-- prerrequisito ausente. SHA-256 es la función nativa de pg_catalog; H69 no
-- depende de dónde esté instalado pgcrypto.
do $$
begin
  if to_regclass('public.momos_ops_migrations') is null then
    raise exception 'Falta la tabla public.momos_ops_migrations.';
  end if;
  if not exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_68_inventario_precision_lotes'
  ) then
    raise exception 'Falta el paso 68_inventario_precision_lotes.';
  end if;
  if to_regprocedure('public.entrada_insumo_lote(text,numeric,numeric,date,text,text,text)') is null then
    raise exception 'Falta la RPC canónica entrada_insumo_lote de H68.';
  end if;
  if to_regprocedure('public.movimiento_insumo(text,text,numeric,text)') is null then
    raise exception 'Falta la RPC canónica movimiento_insumo.';
  end if;
  if to_regprocedure('public.desechar_lote_insumo(text,text)') is null then
    raise exception 'Falta la RPC canónica desechar_lote_insumo de H68.';
  end if;
  if to_regprocedure('public.inventory_lot_precision_disponible()') is null then
    raise exception 'Falta la conciliación inventory_lot_precision_disponible de H68.';
  end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'El servidor PostgreSQL no ofrece pg_catalog.sha256(bytea).';
  end if;
end $$;

-- Recibo privado: permite reintentos seguros incluso si el navegador perdió la
-- respuesta. Solo guarda huella, resultado compacto y UUID del actor; jamás el
-- payload original ni sus notas libres.
create table if not exists public.inventory_delta_receipts (
  idempotency_key uuid primary key,
  operation text not null check(operation in (
    'entrada_insumo_lote','movimiento_insumo','desechar_lote_insumo'
  )),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  item_id text not null,
  event_id bigint not null check(event_id>=0),
  response jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.inventory_delta_receipts enable row level security;
revoke all on table public.inventory_delta_receipts
  from public,anon,authenticated,service_role;

-- Outbox sanitario y append-only para Realtime. El detalle se obtiene después
-- con momos_inventory_deltas_v1(), bajo RBAC y en un solo snapshot.
create table if not exists public.inventory_sync_events (
  event_id bigint generated always as identity primary key,
  item_id text not null,
  changed_at timestamptz not null default clock_timestamp()
);
create index if not exists inventory_sync_events_item_idx
  on public.inventory_sync_events(item_id,event_id desc);
alter table public.inventory_sync_events enable row level security;
drop policy if exists inventory_sync_events_staff_read
  on public.inventory_sync_events;
create policy inventory_sync_events_staff_read
  on public.inventory_sync_events for select to authenticated
  using(public.is_staff());
revoke all on table public.inventory_sync_events
  from public,anon,authenticated,service_role;
grant select on table public.inventory_sync_events to authenticated;
revoke all on sequence public.inventory_sync_events_event_id_seq
  from public,anon,authenticated,service_role;

create or replace function public._momos_touch_inventory_sync_event_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if tg_op='INSERT' or to_jsonb(old) is distinct from to_jsonb(new) then
    insert into public.inventory_sync_events(item_id) values(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_items_sync_event_v1
  on public.inventory_items;
create trigger inventory_items_sync_event_v1
after insert or update on public.inventory_items
for each row execute function public._momos_touch_inventory_sync_event_v1();

-- Si el hito se instala sobre una operación existente, cada ítem recibe un
-- cursor inicial una sola vez. No se vuelve a sembrar en una reaplicación.
insert into public.inventory_sync_events(item_id)
select i.id
from public.inventory_items i
where not exists(select 1 from public.inventory_sync_events)
order by i.id;

-- Delta autoritativo de un ítem. SECURITY DEFINER permite leer las tablas
-- privadas, pero la función no queda expuesta; las superficies públicas
-- validan sesión y rol antes de invocarla.
create or replace function public._momos_inventory_delta_v1(
  p_item_id text,
  p_until_event_id bigint default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_item public.inventory_items%rowtype;
  v_event_id bigint:=0;
  v_lot_stock numeric:=0;
  v_lots jsonb:='[]'::jsonb;
  v_movements jsonb:='[]'::jsonb;
  v_audits jsonb:='[]'::jsonb;
begin
  if nullif(btrim(coalesce(p_item_id,'')),'') is null then
    raise exception 'El item_id es obligatorio.';
  end if;

  select * into v_item
  from public.inventory_items
  where id=p_item_id
  for share;
  if v_item.id is null then
    raise exception 'El insumo solicitado no existe.';
  end if;

  select coalesce(max(e.event_id),0) into v_event_id
  from public.inventory_sync_events e
  where e.item_id=p_item_id
    and (p_until_event_id is null or e.event_id<=p_until_event_id);

  select coalesce(sum(l.available_quantity),0),
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id',l.id,
             'item_id',l.item_id,
             'source_movement_id',l.source_movement_id,
             'received_at',l.received_at,
             'expires_at',l.expires_at,
             'initial_quantity',l.initial_quantity,
             'available_quantity',l.available_quantity,
             'unit_cost',l.unit_cost,
             'supplier',l.supplier,
             'location',l.location,
             'origin',l.origin,
             'created_at',l.created_at,
             'status',case
               when l.available_quantity<=0 then 'Agotado'
               when l.expires_at is not null and l.expires_at<current_date then 'Vencido'
               when l.expires_at=current_date then 'Vence hoy'
               else 'Disponible'
             end
           ) order by l.expires_at nulls last,l.received_at,l.id
         ),'[]'::jsonb)
  into v_lot_stock,v_lots
  from public.inventory_lots l
  where l.item_id=p_item_id;

  if v_item.stock is distinct from v_lot_stock then
    raise exception 'El inventario no está reconciliado exactamente; requiere revisión humana.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
  into v_movements
  from (
    select m.id,m.fecha,m.tipo,m.item_id,m.cant,m.order_id,m.batch_id
    from public.inventory_movements m
    where m.item_id=p_item_id
    order by m.fecha desc,m.id desc
    limit 1
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
  into v_audits
  from (
    select a.id,a.fecha,a.entidad,a.entidad_id,a.accion
    from public.audit_logs a
    where a.entidad='Inventario' and a.entidad_id=p_item_id
    order by a.fecha desc,a.id desc
    limit 1
  ) x;

  return jsonb_build_object(
    'contract','momos.inventory-delta.v1',
    'event_id',v_event_id::text,
    'source_version',v_event_id::text,
    'server_time',statement_timestamp(),
    'scope','inventory_item',
    'item',jsonb_build_object(
      'id',v_item.id,
      'nombre',v_item.nombre,
      'cat',v_item.cat,
      'unidad',v_item.unidad,
      'stock',v_item.stock,
      'minimo',v_item.minimo,
      'costo',v_item.costo,
      'proveedor',v_item.proveedor,
      'vence',v_item.vence,
      'ubicacion',v_item.ubicacion,
      'compra',v_item.compra,
      'costo_estimado',v_item.costo_estimado
    ),
    'lots',v_lots,
    'movements',v_movements,
    'audits',v_audits,
    'reconciliation',jsonb_build_object(
      'item_stock',v_item.stock,
      'lots_available',v_lot_stock,
      'difference',v_item.stock-v_lot_stock,
      'exact',v_item.stock=v_lot_stock
    )
  );
end;
$$;

-- Tres wrappers aditivos: llaman las RPC canónicas en vez de duplicar sus
-- reglas. Una misma llave con igual contrato devuelve el recibo; con payload
-- distinto falla cerrada.
create or replace function public.entrada_insumo_lote_delta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_key uuid;
  v_hash text;
  v_receipt public.inventory_delta_receipts%rowtype;
  v_result jsonb;
  v_delta jsonb;
  v_response jsonb;
  v_event_id bigint;
  v_item_id text;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if jsonb_typeof(p)<>'object' then raise exception 'El payload debe ser un objeto.'; end if;
  if exists(
    select 1 from jsonb_object_keys(p) as item(key)
    where key not in ('idempotency_key','item_id','cant','costo_total','vence','proveedor','ubicacion','nota')
  ) then raise exception 'El payload contiene campos no permitidos.'; end if;
  if nullif(p->>'idempotency_key','') is null
     or nullif(btrim(coalesce(p->>'item_id','')),'') is null
     or not (p ? 'cant') then
    raise exception 'idempotency_key, item_id y cant son obligatorios.';
  end if;
  begin v_key:=(p->>'idempotency_key')::uuid;
  exception when invalid_text_representation then
    raise exception 'idempotency_key debe ser un UUID válido.';
  end;
  v_item_id:=btrim(p->>'item_id');
  v_hash:=pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to((p-'idempotency_key')::text,'UTF8')),
    'hex'
  );
  perform pg_advisory_xact_lock(hashtextextended('momos-inventory-delta:'||v_key::text,0));
  select * into v_receipt from public.inventory_delta_receipts where idempotency_key=v_key;
  if found then
    if v_receipt.operation<>'entrada_insumo_lote' or v_receipt.request_hash<>v_hash then
      raise exception 'La llave de idempotencia ya pertenece a otro contrato.';
    end if;
    v_response:=jsonb_set(v_receipt.response,'{duplicate}','true'::jsonb,true);
    return jsonb_set(
      v_response,'{delta}',
      public._momos_inventory_delta_v1(v_receipt.item_id,null),true
    );
  end if;

  v_result:=public.entrada_insumo_lote(
    v_item_id,
    (p->>'cant')::numeric,
    coalesce(nullif(p->>'costo_total','')::numeric,0),
    nullif(p->>'vence','')::date,
    coalesce(p->>'proveedor',''),
    coalesce(p->>'ubicacion',''),
    coalesce(p->>'nota','')
  );
  v_delta:=public._momos_inventory_delta_v1(v_item_id,null);
  v_event_id:=(v_delta->>'event_id')::bigint;
  v_response:=jsonb_build_object(
    'contract','momos.inventory-mutation.v1',
    'operation','entrada_insumo_lote',
    'idempotency_key',v_key::text,
    'duplicate',false,
    'result',v_result,
    'delta',v_delta
  );
  insert into public.inventory_delta_receipts(
    idempotency_key,operation,request_hash,item_id,event_id,response,created_by
  ) values(v_key,'entrada_insumo_lote',v_hash,v_item_id,v_event_id,v_response,auth.uid());
  return v_response;
end;
$$;

create or replace function public.movimiento_insumo_delta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_key uuid;
  v_hash text;
  v_receipt public.inventory_delta_receipts%rowtype;
  v_result jsonb;
  v_delta jsonb;
  v_response jsonb;
  v_event_id bigint;
  v_item_id text;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if jsonb_typeof(p)<>'object' then raise exception 'El payload debe ser un objeto.'; end if;
  if exists(
    select 1 from jsonb_object_keys(p) as item(key)
    where key not in ('idempotency_key','item_id','tipo','cant','nota')
  ) then raise exception 'El payload contiene campos no permitidos.'; end if;
  if nullif(p->>'idempotency_key','') is null
     or nullif(btrim(coalesce(p->>'item_id','')),'') is null
     or nullif(btrim(coalesce(p->>'tipo','')),'') is null
     or not (p ? 'cant') then
    raise exception 'idempotency_key, item_id, tipo y cant son obligatorios.';
  end if;
  begin v_key:=(p->>'idempotency_key')::uuid;
  exception when invalid_text_representation then
    raise exception 'idempotency_key debe ser un UUID válido.';
  end;
  v_item_id:=btrim(p->>'item_id');
  v_hash:=pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to((p-'idempotency_key')::text,'UTF8')),
    'hex'
  );
  perform pg_advisory_xact_lock(hashtextextended('momos-inventory-delta:'||v_key::text,0));
  select * into v_receipt from public.inventory_delta_receipts where idempotency_key=v_key;
  if found then
    if v_receipt.operation<>'movimiento_insumo' or v_receipt.request_hash<>v_hash then
      raise exception 'La llave de idempotencia ya pertenece a otro contrato.';
    end if;
    v_response:=jsonb_set(v_receipt.response,'{duplicate}','true'::jsonb,true);
    return jsonb_set(
      v_response,'{delta}',
      public._momos_inventory_delta_v1(v_receipt.item_id,null),true
    );
  end if;

  v_result:=public.movimiento_insumo(
    v_item_id,btrim(p->>'tipo'),(p->>'cant')::numeric,coalesce(p->>'nota','')
  );
  v_delta:=public._momos_inventory_delta_v1(v_item_id,null);
  v_event_id:=(v_delta->>'event_id')::bigint;
  v_response:=jsonb_build_object(
    'contract','momos.inventory-mutation.v1',
    'operation','movimiento_insumo',
    'idempotency_key',v_key::text,
    'duplicate',false,
    'result',v_result,
    'delta',v_delta
  );
  insert into public.inventory_delta_receipts(
    idempotency_key,operation,request_hash,item_id,event_id,response,created_by
  ) values(v_key,'movimiento_insumo',v_hash,v_item_id,v_event_id,v_response,auth.uid());
  return v_response;
end;
$$;

create or replace function public.desechar_lote_insumo_delta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_key uuid;
  v_hash text;
  v_receipt public.inventory_delta_receipts%rowtype;
  v_result jsonb;
  v_delta jsonb;
  v_response jsonb;
  v_event_id bigint;
  v_item_id text;
begin
  if public.current_user_has_any_role(array['Administrador','Cocina']) is not true then
    raise exception 'Solo Administrador o Cocina pueden desechar un lote vencido.';
  end if;
  if jsonb_typeof(p)<>'object' then raise exception 'El payload debe ser un objeto.'; end if;
  if exists(
    select 1 from jsonb_object_keys(p) as item(key)
    where key not in ('idempotency_key','lot_id','motivo')
  ) then raise exception 'El payload contiene campos no permitidos.'; end if;
  if nullif(p->>'idempotency_key','') is null
     or nullif(btrim(coalesce(p->>'lot_id','')),'') is null
     or nullif(btrim(coalesce(p->>'motivo','')),'') is null then
    raise exception 'idempotency_key, lot_id y motivo son obligatorios.';
  end if;
  begin v_key:=(p->>'idempotency_key')::uuid;
  exception when invalid_text_representation then
    raise exception 'idempotency_key debe ser un UUID válido.';
  end;
  v_hash:=pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to((p-'idempotency_key')::text,'UTF8')),
    'hex'
  );
  perform pg_advisory_xact_lock(hashtextextended('momos-inventory-delta:'||v_key::text,0));
  select * into v_receipt from public.inventory_delta_receipts where idempotency_key=v_key;
  if found then
    if v_receipt.operation<>'desechar_lote_insumo' or v_receipt.request_hash<>v_hash then
      raise exception 'La llave de idempotencia ya pertenece a otro contrato.';
    end if;
    v_response:=jsonb_set(v_receipt.response,'{duplicate}','true'::jsonb,true);
    return jsonb_set(
      v_response,'{delta}',
      public._momos_inventory_delta_v1(v_receipt.item_id,null),true
    );
  end if;

  select l.item_id into v_item_id
  from public.inventory_lots l
  where l.id=btrim(p->>'lot_id');
  if v_item_id is null then raise exception 'El lote solicitado no existe.'; end if;
  v_result:=public.desechar_lote_insumo(btrim(p->>'lot_id'),btrim(p->>'motivo'));
  v_delta:=public._momos_inventory_delta_v1(v_item_id,null);
  v_event_id:=(v_delta->>'event_id')::bigint;
  v_response:=jsonb_build_object(
    'contract','momos.inventory-mutation.v1',
    'operation','desechar_lote_insumo',
    'idempotency_key',v_key::text,
    'duplicate',false,
    'result',v_result,
    'delta',v_delta
  );
  insert into public.inventory_delta_receipts(
    idempotency_key,operation,request_hash,item_id,event_id,response,created_by
  ) values(v_key,'desechar_lote_insumo',v_hash,v_item_id,v_event_id,v_response,auth.uid());
  return v_response;
end;
$$;

-- Batch exacto por IDs. La respuesta entera comparte el mismo snapshot MVCC y
-- el mismo límite superior del outbox.
create or replace function public.momos_inventory_deltas_v1(p_item_ids text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_latest bigint:=0;
  v_items jsonb:='[]'::jsonb;
  v_item_id text;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if p_item_ids is null or cardinality(p_item_ids)=0 or cardinality(p_item_ids)>50 then
    raise exception 'Solicitá entre 1 y 50 insumos.';
  end if;
  if exists(
    select 1 from unnest(p_item_ids) as item(raw_id)
    where nullif(btrim(coalesce(raw_id,'')),'') is null
  ) then
    raise exception 'La lista contiene un item_id vacío.';
  end if;
  if exists(
    select 1 from (
      select distinct btrim(raw_id) id
      from unnest(p_item_ids) as item(raw_id)
    ) q
    left join public.inventory_items i on i.id=q.id
    where i.id is null
  ) then raise exception 'La lista contiene un insumo inexistente.'; end if;

  -- Toda mutación canónica bloquea primero inventory_items FOR UPDATE. El
  -- mismo orden global + FOR SHARE entrega un corte coherente de todos los IDs
  -- y evita deadlocks con Cocina.
  perform i.id
  from public.inventory_items i
  where i.id in (
    select distinct btrim(raw_id)
    from unnest(p_item_ids) as item(raw_id)
  )
  order by i.id
  for share;

  select coalesce(max(event_id),0) into v_latest from public.inventory_sync_events;
  for v_item_id in
    select id from (
      select btrim(x) id,min(ord) first_ord
      from unnest(p_item_ids) with ordinality u(x,ord)
      group by btrim(x)
    ) q order by first_ord
  loop
    v_items:=v_items||jsonb_build_array(
      public._momos_inventory_delta_v1(v_item_id,v_latest)
    );
  end loop;
  return jsonb_build_object(
    'contract','momos.inventory-delta-batch.v1',
    'latest_event_id',v_latest::text,
    'items',v_items
  );
end;
$$;

-- Recuperación de gaps de Realtime. Solo retorna IDs; si quedaron más eventos
-- después de la página, overflow=true y el cliente continúa desde next_event_id.
create or replace function public.momos_inventory_deltas_since_v1(
  p_after_event_id bigint,
  p_limit integer default 100
) returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_latest bigint:=0;
  v_next bigint;
  v_ids text[]:=array[]::text[];
  v_overflow boolean:=false;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if p_after_event_id is null or p_after_event_id<0 then
    raise exception 'El cursor debe ser cero o positivo.';
  end if;
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'El límite debe estar entre 1 y 100.';
  end if;

  select coalesce(max(event_id),0) into v_latest from public.inventory_sync_events;
  with page as materialized (
    select e.event_id,e.item_id
    from public.inventory_sync_events e
    where e.event_id>p_after_event_id and e.event_id<=v_latest
    order by e.event_id
    limit p_limit
  ), dedup as (
    select item_id,min(event_id) first_event from page group by item_id
  )
  select coalesce(array_agg(item_id order by first_event),array[]::text[]),
         coalesce((select max(event_id) from page),p_after_event_id)
  into v_ids,v_next
  from dedup;

  v_overflow:=p_after_event_id>v_latest or v_next<v_latest;
  return jsonb_build_object(
    'contract','momos.inventory-events.v1',
    'latest_event_id',v_latest::text,
    'next_event_id',v_next::text,
    'overflow',v_overflow,
    'item_ids',to_jsonb(v_ids)
  );
end;
$$;

create or replace function public.inventario_deltas_disponibles()
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select public.is_staff()
    and exists(
      select 1 from public.momos_ops_migrations
      where id='20260719_69_inventario_deltas'
    )
    and to_regclass('public.inventory_sync_events') is not null
    and to_regprocedure('public.momos_inventory_deltas_v1(text[])') is not null
    and to_regprocedure('public.momos_inventory_deltas_since_v1(bigint,integer)') is not null
$$;

-- H69 extiende el manifiesto único de Data Sync; no agrega una sonda al
-- navegador. latest_event_id siempre viaja como string para no perder enteros
-- bigint en JavaScript.
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
    'inventario_deltas_disponibles'
  ]::text[]) x(name);

  select id into v_schema_version
  from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  select coalesce(max(event_id),0) into v_inventory_event_id
  from public.inventory_sync_events;
  return jsonb_build_object(
    'version',1,
    'schema_version',coalesce(v_schema_version,''),
    'server_time',clock_timestamp(),
    'capabilities',v_capabilities,
    'inventory_latest_event_id',v_inventory_event_id::text,
    'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object(
        'version',extract(epoch from clock_timestamp())::bigint,
        'ttl_seconds',60,
        'inventory_latest_event_id',v_inventory_event_id::text
      ),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300)
    ),
    'contains_pii',false,
    'contains_secrets',false,
    'external_execution',false
  );
end $$;

-- Frontera de privilegios cerrada.
revoke all on function public._momos_touch_inventory_sync_event_v1()
  from public,anon,authenticated,service_role;
revoke all on function public._momos_inventory_delta_v1(text,bigint)
  from public,anon,authenticated,service_role;
revoke all on function public.entrada_insumo_lote_delta(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.movimiento_insumo_delta(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.desechar_lote_insumo_delta(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.momos_inventory_deltas_v1(text[])
  from public,anon,authenticated,service_role;
revoke all on function public.momos_inventory_deltas_since_v1(bigint,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.inventario_deltas_disponibles()
  from public,anon,authenticated,service_role;
revoke all on function public.momos_sync_manifest_v1()
  from public,anon,authenticated,service_role;

grant execute on function public.entrada_insumo_lote_delta(jsonb) to authenticated;
grant execute on function public.movimiento_insumo_delta(jsonb) to authenticated;
grant execute on function public.desechar_lote_insumo_delta(jsonb) to authenticated;
grant execute on function public.momos_inventory_deltas_v1(text[]) to authenticated;
grant execute on function public.momos_inventory_deltas_since_v1(bigint,integer) to authenticated;
grant execute on function public.inventario_deltas_disponibles() to authenticated;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

-- Publicación aditiva y compatible tanto con una publicación por lista como
-- con FOR ALL TABLES.
do $$
begin
  if exists(
    select 1 from pg_publication
    where pubname='supabase_realtime' and puballtables is not true
  ) and not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public' and tablename='inventory_sync_events'
  ) then
    alter publication supabase_realtime add table public.inventory_sync_events;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260719_69_inventario_deltas',
  'Mutaciones idempotentes, deltas exactos por lote y outbox Realtime sanitario para inventario'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
