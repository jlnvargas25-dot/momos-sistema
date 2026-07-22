-- MOMOS OPS · H70: deltas consistentes sin locks de lectura y cursor atomico.
-- Requiere H69. Es aditiva y reaplicable; no altera contratos de mutacion.

begin;

set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260719'));

do $$
begin
  if not exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_69_inventario_deltas'
  ) then
    raise exception 'H70 requiere H69 inventario deltas.';
  end if;
  if to_regclass('public.inventory_sync_events') is null
     or to_regclass('public.inventory_delta_receipts') is null
     or to_regclass('public.inventory_lots') is null
     or to_regclass('public.inventory_movements') is null
     or to_regclass('public.audit_logs') is null then
    raise exception 'H70 requiere las tablas de inventario, historial y outbox H69.';
  end if;
  if to_regprocedure('public._momos_inventory_delta_v1(text,bigint)') is null
     or to_regprocedure('public.momos_inventory_deltas_v1(text[])') is null
     or to_regprocedure('public.momos_core_snapshot_v1()') is null then
    raise exception 'H70 requiere los contratos de delta y snapshot previos.';
  end if;
  if to_regprocedure('pg_catalog.pg_current_xact_id()') is null
     or to_regprocedure('pg_catalog.pg_snapshot_xmin(pg_snapshot)') is null then
    raise exception 'H70 requiere cursores xid8 y snapshots MVCC de PostgreSQL.';
  end if;
  if exists(select 1 from pg_catalog.pg_publication where puballtables) then
    raise exception 'H70 requiere publicaciones por lista; desactive FOR ALL TABLES antes de instalar el mapping xid privado.';
  end if;
end $$;

-- Drena escritores H69 antes del cutover. Una transaccion que ya tomo un row
-- lock pero aun no escribio puede continuar solo despues del commit H70 y, por
-- tanto, su evento ya recibe producer_xid. lock_timeout hace fallar la
-- migracion completa en vez de instalar una frontera parcial.
lock table public.inventory_items in share row exclusive mode;

-- event_id conserva su contrato H69 publico exacto. El xid productor vive en
-- una relacion privada que no participa de Realtime: permite un watermark
-- seguro sin ampliar el payload sanitario del outbox.
create table if not exists public.inventory_sync_event_xids(
  event_id bigint primary key references public.inventory_sync_events(event_id)
    on delete cascade,
  producer_xid bigint not null check(producer_xid>=0)
);
create index if not exists inventory_sync_event_xids_producer_idx
  on public.inventory_sync_event_xids(producer_xid,event_id);
alter table public.inventory_sync_event_xids enable row level security;
revoke all on table public.inventory_sync_event_xids
  from public,anon,authenticated,service_role;

-- Todo evento anterior al cutover ya esta incluido en cualquier core H70; cero
-- lo mantiene disponible solo para el bootstrap 0 y nunca para un cursor H69.
insert into public.inventory_sync_event_xids(event_id,producer_xid)
select e.event_id,0 from public.inventory_sync_events e
on conflict(event_id) do nothing;

create or replace function public._momos_touch_inventory_sync_event_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_event_id bigint;
begin
  if tg_op='INSERT' or to_jsonb(old) is distinct from to_jsonb(new) then
    insert into public.inventory_sync_events(item_id)
    values(new.id)
    returning event_id into v_event_id;
    insert into public.inventory_sync_event_xids(event_id,producer_xid)
    values(
      v_event_id,
      ((pg_catalog.pg_current_xact_id())::text)::bigint
    );
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_items_sync_event_v1
  on public.inventory_items;
create trigger inventory_items_sync_event_v1
after insert or update on public.inventory_items
for each row execute function public._momos_touch_inventory_sync_event_v1();

-- Los tres rollups del batch se resuelven por item. El indice FIFO previo es
-- parcial y no cubre lotes agotados, que tambien forman parte del delta.
create index if not exists inventory_lots_item_history_idx
  on public.inventory_lots(item_id,expires_at,received_at,id);
create index if not exists inventory_movements_item_recent_idx
  on public.inventory_movements(item_id,fecha desc,id desc);
create index if not exists audit_logs_inventory_item_recent_idx
  on public.audit_logs(entidad_id,fecha desc,id desc)
  where entidad='Inventario';
create index if not exists audit_logs_inventory_recent_idx
  on public.audit_logs(fecha desc,id desc)
  where entidad='Inventario';

-- El recibo solo necesita conservar el resultado compacto para reconocer y
-- validar el reintento. El delta se reconstruye siempre con el estado vigente,
-- de modo que persistirlo duplicaria la lista completa de lotes en cada
-- mutacion y haria crecer el historial O(N^2).
create or replace function public._momos_compact_inventory_delta_receipt_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if new.response is null or jsonb_typeof(new.response)<>'object' then
    raise exception 'El recibo de inventario debe ser un objeto JSON.';
  end if;
  if not (new.response ?& array[
       'contract','operation','idempotency_key','duplicate','result'
     ])
     or (
       new.response->>'contract'='momos.inventory-mutation.v1'
       and new.response->>'operation'=new.operation
       and new.response->>'idempotency_key'=new.idempotency_key::text
       and jsonb_typeof(new.response->'duplicate')='boolean'
     ) is not true then
    raise exception 'El recibo de inventario no coincide con su contrato.';
  end if;
  new.response:=jsonb_build_object(
    'contract',new.response->'contract',
    'operation',new.response->'operation',
    'idempotency_key',new.response->'idempotency_key',
    'duplicate',new.response->'duplicate',
    'result',new.response->'result'
  );
  return new;
end;
$$;

drop trigger if exists inventory_delta_receipts_compact_v1
  on public.inventory_delta_receipts;
create trigger inventory_delta_receipts_compact_v1
before insert or update of response on public.inventory_delta_receipts
for each row execute function public._momos_compact_inventory_delta_receipt_v1();

-- Sanea recibos H69 ya existentes antes de volver obligatoria la forma
-- compacta. La actualizacion tambien atraviesa el trigger para que la misma
-- regla cubra migracion y escrituras futuras.
update public.inventory_delta_receipts set response=response;

alter table public.inventory_delta_receipts
  drop constraint if exists inventory_delta_receipts_response_compact;
alter table public.inventory_delta_receipts
  add constraint inventory_delta_receipts_response_compact
  check((
    jsonb_typeof(response)='object'
    and response ?& array[
      'contract','operation','idempotency_key','duplicate','result'
    ]
    and response-array[
      'contract','operation','idempotency_key','duplicate','result'
    ]='{}'::jsonb
    and response->>'contract'='momos.inventory-mutation.v1'
    and response->>'operation'=operation
    and response->>'idempotency_key'=idempotency_key::text
    and jsonb_typeof(response->'duplicate')='boolean'
  ) is true);

-- El helper sigue VOLATILE porque las RPC de mutacion deben ver sus propias
-- escrituras. Toda la lectura autoritativa del delta ocurre, sin embargo, en
-- un unico statement y por tanto comparte un solo snapshot MVCC.
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
  v_item_id text:=btrim(coalesce(p_item_id,''));
  v_found boolean:=false;
  v_exact boolean:=false;
  v_delta jsonb;
begin
  if v_item_id='' then
    raise exception 'El item_id es obligatorio.';
  end if;

  with target_item as materialized (
    select
      i.id,i.nombre,i.cat,i.unidad,i.stock,i.minimo,i.costo,i.proveedor,
      i.vence,i.ubicacion,i.compra,i.costo_estimado
    from public.inventory_items i
    where i.id=v_item_id
  ),
  event_boundary as materialized (
    select coalesce(max(e.event_id),0)::bigint as event_id
    from public.inventory_sync_events e
    where e.item_id=v_item_id
      and (p_until_event_id is null or e.event_id<=p_until_event_id)
  ),
  lot_rollup as materialized (
    select
      coalesce(sum(l.available_quantity),0)::numeric as lot_stock,
      coalesce(
        jsonb_agg(
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
        ),
        '[]'::jsonb
      ) as lots
    from public.inventory_lots l
    where l.item_id=v_item_id
  ),
  movement_rollup as materialized (
    select coalesce(
      jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc),
      '[]'::jsonb
    ) as movements
    from (
      select m.id,m.fecha,m.tipo,m.item_id,m.cant,m.order_id,m.batch_id
      from public.inventory_movements m
      where m.item_id=v_item_id
      order by m.fecha desc,m.id desc
      limit 50
    ) x
  ),
  audit_rollup as materialized (
    select coalesce(
      jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc),
      '[]'::jsonb
    ) as audits
    from (
      select a.id,a.fecha,a.entidad,a.entidad_id,a.accion
      from public.audit_logs a
      where a.entidad='Inventario' and a.entidad_id=v_item_id
      order by a.fecha desc,a.id desc
      limit 50
    ) x
  ),
  payload as materialized (
    select
      ti.stock is not distinct from lr.lot_stock as exact,
      jsonb_build_object(
        'contract','momos.inventory-delta.v1',
        'event_id',eb.event_id::text,
        'source_version',eb.event_id::text,
        'server_time',statement_timestamp(),
        'scope','inventory_item',
        'item',jsonb_build_object(
          'id',ti.id,
          'nombre',ti.nombre,
          'cat',ti.cat,
          'unidad',ti.unidad,
          'stock',ti.stock,
          'minimo',ti.minimo,
          'costo',ti.costo,
          'proveedor',ti.proveedor,
          'vence',ti.vence,
          'ubicacion',ti.ubicacion,
          'compra',ti.compra,
          'costo_estimado',ti.costo_estimado
        ),
        'lots',lr.lots,
        'movements',mr.movements,
        'audits',ar.audits,
        'reconciliation',jsonb_build_object(
          'item_stock',ti.stock,
          'lots_available',lr.lot_stock,
          'difference',ti.stock-lr.lot_stock,
          'exact',ti.stock=lr.lot_stock
        )
      ) as delta
    from target_item ti
    cross join event_boundary eb
    cross join lot_rollup lr
    cross join movement_rollup mr
    cross join audit_rollup ar
  )
  select
    exists(select 1 from target_item),
    coalesce((select p.exact from payload p),false),
    (select p.delta from payload p)
  into v_found,v_exact,v_delta;

  if not v_found then
    raise exception 'El insumo solicitado no existe.';
  end if;
  if not v_exact then
    raise exception 'El inventario no esta reconciliado exactamente; requiere revision humana.';
  end if;
  return v_delta;
end;
$$;

-- El batch no toma row locks ni llama el helper por item. Sus datos, el
-- limite superior del outbox y todos los deltas se materializan en un unico
-- statement MVCC, incluso cuando se solicitan 50 items.
create or replace function public.momos_inventory_deltas_v1(p_item_ids text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_missing text[]:=array[]::text[];
  v_inexact text[]:=array[]::text[];
  v_response jsonb;
begin
  if public.is_staff() is not true then
    raise exception 'Solo staff activo';
  end if;
  if p_item_ids is null or cardinality(p_item_ids)=0 or cardinality(p_item_ids)>50 then
    raise exception 'Solicita entre 1 y 50 insumos.';
  end if;
  if exists(
    select 1 from unnest(p_item_ids) as item(raw_id)
    where nullif(btrim(coalesce(raw_id,'')),'') is null
  ) then
    raise exception 'La lista contiene un item_id vacio.';
  end if;

  with requested as materialized (
    select btrim(u.raw_id) as item_id,min(u.ord)::bigint as first_ord
    from unnest(p_item_ids) with ordinality as u(raw_id,ord)
    group by btrim(u.raw_id)
  ),
  boundary as materialized (
    select
      coalesce(max(e.event_id),0)::bigint as latest_source_event_id,
      4611686018427387904
        + ((pg_catalog.pg_snapshot_xmin(
          pg_catalog.pg_current_snapshot()
        ))::text)::bigint as latest_event_id
    from public.inventory_sync_events e
  ),
  payload as materialized (
    select
      r.item_id,
      r.first_ord,
      i.id is not null as item_found,
      (i.id is not null and i.stock is not distinct from lr.lot_stock) as exact,
      case when i.id is null then null else jsonb_build_object(
        'contract','momos.inventory-delta.v1',
        'event_id',er.event_id::text,
        'source_version',er.event_id::text,
        'server_time',statement_timestamp(),
        'scope','inventory_item',
        'item',jsonb_build_object(
          'id',i.id,
          'nombre',i.nombre,
          'cat',i.cat,
          'unidad',i.unidad,
          'stock',i.stock,
          'minimo',i.minimo,
          'costo',i.costo,
          'proveedor',i.proveedor,
          'vence',i.vence,
          'ubicacion',i.ubicacion,
          'compra',i.compra,
          'costo_estimado',i.costo_estimado
        ),
        'lots',lr.lots,
        'movements',mr.movements,
        'audits',ar.audits,
        'reconciliation',jsonb_build_object(
          'item_stock',i.stock,
          'lots_available',lr.lot_stock,
          'difference',i.stock-lr.lot_stock,
          'exact',i.stock=lr.lot_stock
        )
      ) end as delta
    from requested r
    cross join boundary b
    left join public.inventory_items i on i.id=r.item_id
    left join lateral (
      select
        coalesce(sum(l.available_quantity),0)::numeric as lot_stock,
        coalesce(
          jsonb_agg(
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
          ),
          '[]'::jsonb
        ) as lots
      from public.inventory_lots l
      where l.item_id=r.item_id
    ) lr on true
    left join lateral (
      select coalesce(
        jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc),
        '[]'::jsonb
      ) as movements
      from (
        select m.id,m.fecha,m.tipo,m.item_id,m.cant,m.order_id,m.batch_id
        from public.inventory_movements m
        where m.item_id=r.item_id
        order by m.fecha desc,m.id desc
        limit 50
      ) x
    ) mr on true
    left join lateral (
      select coalesce(
        jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc),
        '[]'::jsonb
      ) as audits
      from (
        select a.id,a.fecha,a.entidad,a.entidad_id,a.accion
        from public.audit_logs a
        where a.entidad='Inventario' and a.entidad_id=r.item_id
        order by a.fecha desc,a.id desc
        limit 50
      ) x
    ) ar on true
    left join lateral (
      select coalesce(max(e.event_id),0)::bigint as event_id
      from public.inventory_sync_events e
      where e.item_id=r.item_id and e.event_id<=b.latest_source_event_id
    ) er on true
  )
  select
    coalesce(
      array_agg(p.item_id order by p.first_ord)
        filter(where p.item_found is false),
      array[]::text[]
    ),
    coalesce(
      array_agg(p.item_id order by p.first_ord)
        filter(where p.item_found and not p.exact),
      array[]::text[]
    ),
    jsonb_build_object(
      'contract','momos.inventory-delta-batch.v1',
      'latest_event_id',b.latest_event_id::text,
      'items',coalesce(
        jsonb_agg(p.delta order by p.first_ord) filter(where p.item_found),
        '[]'::jsonb
      )
    )
  into v_missing,v_inexact,v_response
  from boundary b
  left join payload p on true
  group by b.latest_event_id,b.latest_source_event_id;

  if cardinality(v_missing)>0 then
    raise exception 'La lista contiene un insumo inexistente.';
  end if;
  if cardinality(v_inexact)>0 then
    raise exception 'El inventario no esta reconciliado exactamente; requiere revision humana.';
  end if;
  return v_response;
end;
$$;

-- Pagina un rango de transacciones completamente resueltas. Nunca corta un
-- mismo xid productor: asi el cursor solo avanza cuando todos los items de la
-- transaccion quedaron incluidos. Si una unica transaccion supera el limite,
-- solicita snapshot completo en vez de certificar una pagina parcial.
create or replace function public._momos_inventory_events_page_v1(
  p_after_xid bigint,
  p_target_xid bigint,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_ids text[]:=array[]::text[];
  v_candidate text[];
  v_group record;
  v_group_count integer:=0;
  v_next bigint:=p_target_xid;
  v_overflow boolean:=false;
begin
  if p_after_xid is null or p_after_xid<0
     or p_target_xid is null or p_target_xid<0 then
    raise exception 'Los cursores xid deben ser cero o positivos.';
  end if;
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'El limite debe estar entre 1 y 100.';
  end if;
  if p_after_xid>p_target_xid then
    return jsonb_build_object(
      'contract','momos.inventory-events.v1',
      'latest_event_id',p_target_xid::text,
      'next_event_id',p_after_xid::text,
      'overflow',true,
      'item_ids','[]'::jsonb
    );
  end if;

  for v_group in
    with xid_groups as materialized (
      select x.producer_xid
      from public.inventory_sync_event_xids x
      where x.producer_xid>=p_after_xid
        and x.producer_xid<p_target_xid
      group by x.producer_xid
      order by x.producer_xid
      limit p_limit+1
    )
    select
      g.producer_xid,
      coalesce((
        select array_agg(q.item_id order by q.item_id)
        from (
          select distinct e.item_id
          from public.inventory_sync_event_xids x
          join public.inventory_sync_events e on e.event_id=x.event_id
          where x.producer_xid=g.producer_xid
          order by e.item_id
          limit p_limit+1
        ) q
      ),array[]::text[]) as item_ids
    from xid_groups g
    order by g.producer_xid
  loop
    if v_group_count>=p_limit then
      v_next:=v_group.producer_xid;
      v_overflow:=true;
      exit;
    end if;
    select coalesce(array_agg(x.item_id order by x.item_id),array[]::text[])
    into v_candidate
    from (
      select distinct u.item_id
      from unnest(v_ids||v_group.item_ids) as u(item_id)
    ) x;

    if cardinality(v_candidate)>p_limit then
      if cardinality(v_ids)=0 then
        if p_target_xid=9223372036854775807 then
          raise exception 'El cursor xid excede el rango soportado.';
        end if;
        return jsonb_build_object(
          'contract','momos.inventory-events.v1',
          'latest_event_id',p_target_xid::text,
          'next_event_id',(p_target_xid+1)::text,
          'overflow',true,
          'item_ids','[]'::jsonb
        );
      end if;
      v_next:=v_group.producer_xid;
      v_overflow:=true;
      exit;
    end if;
    v_ids:=v_candidate;
    v_group_count:=v_group_count+1;
  end loop;

  return jsonb_build_object(
    'contract','momos.inventory-events.v1',
    'latest_event_id',p_target_xid::text,
    'next_event_id',v_next::text,
    'overflow',v_overflow,
    'item_ids',to_jsonb(v_ids)
  );
end;
$$;

-- El watermark es pg_snapshot_xmin: si A sigue abierta y B confirma primero,
-- xmin permanece en A. B no se pierde ni se declara aplicada; cuando A termina,
-- el rango seguro siguiente contiene ambas transacciones sin bloquear escritores.
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
  v_cursor_tag constant bigint:=4611686018427387904;
  v_safe_xmin bigint;
  v_after_xid bigint;
  v_page jsonb;
  v_latest_xid bigint;
  v_next_xid bigint;
begin
  if public.is_staff() is not true then
    raise exception 'Solo staff activo';
  end if;
  if p_after_event_id is null or p_after_event_id<0 then
    raise exception 'El cursor debe ser cero o positivo.';
  end if;
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'El limite debe estar entre 1 y 100.';
  end if;

  v_safe_xmin:=((pg_catalog.pg_snapshot_xmin(
    pg_catalog.pg_current_snapshot()
  ))::text)::bigint;

  -- 0 conserva bootstrap. Todo cursor H69 no cero vive debajo del tag y debe
  -- pedir un snapshot; nunca se interpreta accidentalmente como xid.
  if p_after_event_id>0 and p_after_event_id<v_cursor_tag then
    return jsonb_build_object(
      'contract','momos.inventory-events.v1',
      'latest_event_id',(v_cursor_tag+v_safe_xmin)::text,
      'next_event_id',(v_cursor_tag+v_safe_xmin+1)::text,
      'overflow',true,
      'item_ids','[]'::jsonb
    );
  end if;

  v_after_xid:=case when p_after_event_id=0
    then 0 else p_after_event_id-v_cursor_tag end;
  v_page:=public._momos_inventory_events_page_v1(
    v_after_xid,v_safe_xmin,p_limit
  );
  v_latest_xid:=(v_page->>'latest_event_id')::bigint;
  v_next_xid:=(v_page->>'next_event_id')::bigint;
  return jsonb_set(
    jsonb_set(
      v_page,'{latest_event_id}',to_jsonb((v_cursor_tag+v_latest_xid)::text),false
    ),
    '{next_event_id}',to_jsonb((v_cursor_tag+v_next_xid)::text),false
  );
end;
$$;

-- El cursor del inventario y las colecciones inventory_items/inventory_lots
-- nacen del mismo SELECT. Bajo READ COMMITTED no hay ventana entre manifiesto
-- y snapshot que permita etiquetar datos viejos con un cursor nuevo.
create or replace function public.momos_core_snapshot_v1() returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not exists(
    select 1 from public.users u where u.auth_id=auth.uid() and u.activo
  ) then raise exception 'Sesion MOMOS invalida.' using errcode='42501'; end if;

  with snapshot_payload as materialized (
    select
      (
        4611686018427387904
        + ((pg_catalog.pg_snapshot_xmin(
          pg_catalog.pg_current_snapshot()
        ))::text)::bigint
      )::text
        as inventory_latest_event_id,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select id,nombre,cat,tipo,especie,precio,precio_rappi,costo,stock,prep,frio,lejano,activo,descr,combo_size,empaque_item_id,colchon_produccion from public.products order by id
      ) x),'[]'::jsonb) as products,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.component_id) from (
        select combo_id,component_id from public.combo_components order by component_id
      ) x),'[]'::jsonb) as combo_components,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select id,nombre,cat,unidad,stock,minimo,costo,proveedor,vence,ubicacion,compra,costo_estimado from public.inventory_items order by id
      ) x),'[]'::jsonb) as inventory_items,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.item_id,x.expires_at nulls last,x.received_at) from (
        select id,item_id,item_name,unidad,received_at,expires_at,initial_quantity,available_quantity,unit_cost,supplier,location,origin,status from public.v_inventory_lots order by item_id,expires_at nulls last,received_at
      ) x),'[]'::jsonb) as inventory_lots,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc) from (
        select id,fecha,tipo,item_id,cant,order_id,batch_id
        from public.inventory_movements order by fecha desc,id desc limit 50
      ) x),'[]'::jsonb) as inventory_movements,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha desc,x.id desc) from (
        select id,fecha,entidad,entidad_id,accion
        from public.audit_logs where entidad='Inventario'
        order by fecha desc,id desc limit 50
      ) x),'[]'::jsonb) as inventory_audit_logs,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select id,product_id,item_id,cantidad from public.recipes order by id
      ) x),'[]'::jsonb) as recipes,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select id,nombre,email,rol,roles,activo from public.users order by id
      ) x),'[]'::jsonb) as users,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.orden) from (
        select nombre,precio,insumo_id,insumo_cant,orden from public.toppings where activo order by orden
      ) x),'[]'::jsonb) as toppings,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.orden) from (
        select nombre,especie,gramaje_g,product_id,activo,orden from public.figuras order by orden
      ) x),'[]'::jsonb) as figuras,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.orden) from (
        select categoria,valor,orden from public.catalog_values where activo order by orden
      ) x),'[]'::jsonb) as catalog_values,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from (
        select nombre,tarifa from public.zonas order by nombre
      ) x),'[]'::jsonb) as zonas,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.orden) from (
        select nombre,orden from public.proveedores_domicilio where activo order by orden
      ) x),'[]'::jsonb) as proveedores_domicilio,
      coalesce((select to_jsonb(x) from (
        select frases,tono,palabras_si,palabras_no from public.brand_library limit 1
      ) x),'null'::jsonb) as brand_library,
      coalesce((select jsonb_agg(to_jsonb(x)) from (
        select clave,valor from public.app_settings
      ) x),'[]'::jsonb) as app_settings,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select id,nombre,tipo,sabor,merma_pct,rinde_g,item_id,activo from public.subrecetas order by id
      ) x),'[]'::jsonb) as subrecetas,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.subreceta_id) from (
        select subreceta_id,item_id,cantidad from public.subreceta_ingredientes order by subreceta_id
      ) x),'[]'::jsonb) as subreceta_ingredientes,
      coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select id,subreceta_id,gramos_por_unidad,activo from public.figura_relleno order by id
      ) x),'[]'::jsonb) as figura_relleno
  )
  select jsonb_build_object(
    'version',1,
    'server_time',clock_timestamp(),
    'products',s.products,
    'combo_components',s.combo_components,
    'inventory_items',s.inventory_items,
    'inventory_lots',s.inventory_lots,
    'inventory_movements',s.inventory_movements,
    'inventory_audit_logs',s.inventory_audit_logs,
    'inventory_latest_event_id',s.inventory_latest_event_id,
    'recipes',s.recipes,
    'users',s.users,
    'toppings',s.toppings,
    'figuras',s.figuras,
    'catalog_values',s.catalog_values,
    'zonas',s.zonas,
    'proveedores_domicilio',s.proveedores_domicilio,
    'brand_library',s.brand_library,
    'app_settings',s.app_settings,
    'subrecetas',s.subrecetas,
    'subreceta_ingredientes',s.subreceta_ingredientes,
    'figura_relleno',s.figura_relleno,
    'contains_agency',false
  ) into v_result
  from snapshot_payload s;

  return v_result;
end $$;

-- El manifiesto conserva su contrato H69, pero el campo historico
-- inventory_latest_event_id ahora transporta el mismo watermark xid seguro que
-- el core. Sigue siendo diagnostico; la frontera atomica autoritativa vive en
-- momos_core_snapshot_v1().
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
  v_inventory_event_id:=4611686018427387904
    + ((pg_catalog.pg_snapshot_xmin(
      pg_catalog.pg_current_snapshot()
    ))::text)::bigint;
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

-- La capability solo se anuncia cuando el correctivo completo H70 quedo
-- registrado en la misma transaccion.
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
      where id='20260719_70_inventario_delta_consistencia'
    )
    and to_regclass('public.inventory_sync_events') is not null
    and to_regclass('public.inventory_sync_event_xids') is not null
    and to_regprocedure('public.momos_inventory_deltas_v1(text[])') is not null
    and to_regprocedure('public.momos_inventory_deltas_since_v1(bigint,integer)') is not null
    and to_regprocedure('public._momos_inventory_events_page_v1(bigint,bigint,integer)') is not null
$$;

revoke all on function public._momos_inventory_delta_v1(text,bigint)
  from public,anon,authenticated,service_role;
revoke all on function public._momos_touch_inventory_sync_event_v1()
  from public,anon,authenticated,service_role;
revoke all on function public._momos_compact_inventory_delta_receipt_v1()
  from public,anon,authenticated,service_role;
revoke all on function public._momos_inventory_events_page_v1(bigint,bigint,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.momos_inventory_deltas_v1(text[])
  from public,anon,authenticated,service_role;
revoke all on function public.momos_inventory_deltas_since_v1(bigint,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.momos_core_snapshot_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.momos_sync_manifest_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.inventario_deltas_disponibles()
  from public,anon,authenticated,service_role;

grant execute on function public.momos_inventory_deltas_v1(text[]) to authenticated;
grant execute on function public.momos_inventory_deltas_since_v1(bigint,integer) to authenticated;
grant execute on function public.momos_core_snapshot_v1() to authenticated;
grant execute on function public.momos_sync_manifest_v1() to authenticated;
grant execute on function public.inventario_deltas_disponibles() to authenticated;

do $$
declare
  v_helper text:=lower(pg_get_functiondef(
    'public._momos_inventory_delta_v1(text,bigint)'::regprocedure
  ));
  v_batch text:=lower(pg_get_functiondef(
    'public.momos_inventory_deltas_v1(text[])'::regprocedure
  ));
  v_core text:=lower(pg_get_functiondef(
    'public.momos_core_snapshot_v1()'::regprocedure
  ));
  v_events text:=lower(pg_get_functiondef(
    'public.momos_inventory_deltas_since_v1(bigint,integer)'::regprocedure
  ));
  v_page text:=lower(pg_get_functiondef(
    'public._momos_inventory_events_page_v1(bigint,bigint,integer)'::regprocedure
  ));
  v_manifest text:=lower(pg_get_functiondef(
    'public.momos_sync_manifest_v1()'::regprocedure
  ));
begin
  if v_helper ~ 'for[[:space:]]+(share|update)'
     or v_batch ~ 'for[[:space:]]+(share|update)' then
    raise exception 'H70 no puede conservar locks de lectura en los deltas.';
  end if;
  if position('_momos_inventory_delta_v1' in v_batch)>0
     or position('with requested as materialized' in v_batch)=0 then
    raise exception 'H70 batch debe resolver todos los items en un statement.';
  end if;
  if regexp_count(v_helper,'limit[[:space:]]+50')<>2
     or regexp_count(v_batch,'limit[[:space:]]+50')<>2 then
    raise exception 'H70 debe conservar 50 movimientos y 50 auditorias por item.';
  end if;
  if position('with snapshot_payload as materialized' in v_core)=0
     or position('pg_snapshot_xmin' in v_core)=0
     or position('4611686018427387904' in v_core)=0
     or position('inventory_latest_event_id' in v_core)=0
     or position('inventory_movements' in v_core)=0
     or position('inventory_audit_logs' in v_core)=0 then
    raise exception 'H70 snapshot no captura cursor e historial junto con sus colecciones.';
  end if;
  if position('pg_snapshot_xmin' in v_events)=0
     or position('4611686018427387904' in v_events)=0
     or position('_momos_inventory_events_page_v1' in v_events)=0
     or position('x.producer_xid>=p_after_xid' in v_page)=0
     or position('x.producer_xid<p_target_xid' in v_page)=0
     or position('group by x.producer_xid' in v_page)=0
     or position('limit p_limit+1' in v_page)=0
     or position('v_group_count>=p_limit' in v_page)=0
     or position('pg_snapshot_xmin' in v_manifest)=0
     or position('4611686018427387904' in v_manifest)=0 then
    raise exception 'H70 no usa un safe-watermark xid stateless y transaccional.';
  end if;
  if not exists(
    select 1 from pg_class c
    where c.oid='public.inventory_sync_event_xids'::regclass
      and c.relrowsecurity
  ) or (
    select array_agg(c.column_name::text order by c.ordinal_position)
    from information_schema.columns c
    where c.table_schema='public'
      and c.table_name='inventory_sync_event_xids'
  )<>array['event_id','producer_xid']::text[] or not exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='inventory_sync_event_xids'
      and i.indexname='inventory_sync_event_xids_producer_idx'
  ) or not exists(
    select 1 from pg_constraint c
    where c.conrelid='public.inventory_sync_event_xids'::regclass
      and c.contype='p'
  ) or not exists(
    select 1 from pg_constraint c
    where c.conrelid='public.inventory_sync_event_xids'::regclass
      and c.contype='f'
      and c.confrelid='public.inventory_sync_events'::regclass
      and c.confdeltype='c'
  ) or not exists(
    select 1 from pg_constraint c
    where c.conrelid='public.inventory_sync_event_xids'::regclass
      and c.contype='c'
      and position('producer_xid >= 0' in pg_get_constraintdef(c.oid))>0
  ) or exists(
    select 1 from pg_publication_tables p
    where p.schemaname='public' and p.tablename='inventory_sync_event_xids'
  ) or has_table_privilege(
    'authenticated','public.inventory_sync_event_xids','SELECT'
  ) or has_table_privilege(
    'anon','public.inventory_sync_event_xids','SELECT'
  ) or has_table_privilege(
    'service_role','public.inventory_sync_event_xids','SELECT'
  ) or has_table_privilege(
    'authenticated','public.inventory_sync_event_xids','INSERT'
  ) or has_table_privilege(
    'authenticated','public.inventory_sync_event_xids','UPDATE'
  ) or has_table_privilege(
    'authenticated','public.inventory_sync_event_xids','DELETE'
  ) or has_table_privilege(
    'anon','public.inventory_sync_event_xids','INSERT'
  ) or has_table_privilege(
    'service_role','public.inventory_sync_event_xids','INSERT'
  ) or exists(
    select 1
    from public.inventory_sync_events e
    left join public.inventory_sync_event_xids x on x.event_id=e.event_id
    where x.event_id is null
  ) then
    raise exception 'H70 no sello, completo o indexo el xid privado del outbox.';
  end if;
  if (
    select array_agg(c.column_name::text order by c.ordinal_position)
    from information_schema.columns c
    where c.table_schema='public' and c.table_name='inventory_sync_events'
  )<>array['event_id','item_id','changed_at']::text[]
     or position(
       'insert into public.inventory_sync_event_xids' in lower(pg_get_functiondef(
         'public._momos_touch_inventory_sync_event_v1()'::regprocedure
       ))
     )=0
     or position(
       'pg_current_xact_id' in lower(pg_get_functiondef(
         'public._momos_touch_inventory_sync_event_v1()'::regprocedure
       ))
     )=0 then
    raise exception 'H70 amplio el outbox publico o no enlazo su xid privado.';
  end if;
  if not exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='inventory_lots'
      and i.indexname='inventory_lots_item_history_idx'
  ) or not exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='inventory_movements'
      and i.indexname='inventory_movements_item_recent_idx'
  ) or not exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='audit_logs'
      and i.indexname='audit_logs_inventory_item_recent_idx'
  ) or not exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='audit_logs'
      and i.indexname='audit_logs_inventory_recent_idx'
  ) then
    raise exception 'H70 no instalo los indices de lotes e historial.';
  end if;
  if not exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_delta_receipts'::regclass
      and t.tgname='inventory_delta_receipts_compact_v1'
      and not t.tgisinternal
      and t.tgfoid='public._momos_compact_inventory_delta_receipt_v1()'::regprocedure
  ) or not exists(
    select 1 from pg_constraint c
    where c.conrelid='public.inventory_delta_receipts'::regclass
      and c.conname='inventory_delta_receipts_response_compact'
      and c.convalidated
  ) or exists(
    select 1
    from public.inventory_delta_receipts r
    where jsonb_typeof(r.response) is distinct from 'object'
      or not (r.response ?& array[
        'contract','operation','idempotency_key','duplicate','result'
      ])
      or r.response-array[
        'contract','operation','idempotency_key','duplicate','result'
      ]<>'{}'::jsonb
      or r.response->>'contract' is distinct from 'momos.inventory-mutation.v1'
      or r.response->>'operation' is distinct from r.operation
      or r.response->>'idempotency_key' is distinct from r.idempotency_key::text
      or jsonb_typeof(r.response->'duplicate') is distinct from 'boolean'
  ) then
    raise exception 'H70 no compacto o no protegio los recibos idempotentes.';
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260719_70_inventario_delta_consistencia',
  'Batch MVCC sin locks, recibos O(1), historial sanitario y cursor safe-xmin atomicos sin orden de commit por identity'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
