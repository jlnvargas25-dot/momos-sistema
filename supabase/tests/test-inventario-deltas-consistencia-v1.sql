-- MOMOS OPS · prueba adversarial H70.
-- Siempre ROLLBACK: valida batch MVCC, receipts O(1), safe-xmin y core atomico.

begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_inventario_delta_consistencia_20260719'));

do $$
declare
  v_helper text;
  v_batch text;
  v_core text;
  v_events text;
  v_page text;
  v_manifest text;
  v_actor_auth uuid;
  v_cat text;
  v_item text:='I-H70-'||pg_backend_pid();
  v_empty_item text:='I-H70-E-'||pg_backend_pid();
  v_third_item text:='I-H70-T-'||pg_backend_pid();
  v_a_xid bigint;
  v_b_xid bigint;
  v_a_event bigint;
  v_b_event bigint;
  v_waiting jsonb;
  v_resolved jsonb;
  v_hot_page jsonb;
  v_hot_xid bigint;
  v_hot_event bigint;
  v_i integer;
  v_poison_key uuid:=('71000000-0000-4000-8000-'||lpad(pg_backend_pid()::text,12,'0'))::uuid;
  v_poison_response jsonb;
  v_null_key uuid:=('72000000-0000-4000-8000-'||lpad(pg_backend_pid()::text,12,'0'))::uuid;
  v_check_blocked boolean:=false;
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_70_inventario_delta_consistencia'
  ),'Falta aplicar H70.';
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_69_inventario_deltas'
  ),'H70 perdio su dependencia H69.';
  assert to_regprocedure('public._momos_inventory_delta_v1(text,bigint)') is not null
    and to_regprocedure('public.momos_inventory_deltas_v1(text[])') is not null
    and to_regprocedure('public.momos_inventory_deltas_since_v1(bigint,integer)') is not null
    and to_regprocedure('public._momos_inventory_events_page_v1(bigint,bigint,integer)') is not null
    and to_regprocedure('public.momos_core_snapshot_v1()') is not null
    and to_regprocedure('public._momos_compact_inventory_delta_receipt_v1()') is not null,
    'Falta una funcion reemplazada por H70.';
  assert to_regclass('public.inventory_sync_event_xids') is not null,
    'Falta el mapping privado de xid productor H70.';

    assert has_function_privilege(
      'authenticated','public.momos_inventory_deltas_v1(text[])','EXECUTE'
    )
    and has_function_privilege(
      'authenticated','public.momos_inventory_deltas_since_v1(bigint,integer)','EXECUTE'
    )
    and has_function_privilege(
      'authenticated','public.momos_core_snapshot_v1()','EXECUTE'
    )
    and not has_function_privilege(
      'anon','public.momos_inventory_deltas_v1(text[])','EXECUTE'
    )
    and not has_function_privilege(
      'service_role','public.momos_inventory_deltas_v1(text[])','EXECUTE'
    )
    and not has_function_privilege(
      'authenticated','public._momos_inventory_delta_v1(text,bigint)','EXECUTE'
    )
    and not has_function_privilege(
      'authenticated','public._momos_compact_inventory_delta_receipt_v1()','EXECUTE'
    )
    and not has_function_privilege(
      'anon','public._momos_compact_inventory_delta_receipt_v1()','EXECUTE'
    )
    and not has_function_privilege(
      'service_role','public._momos_compact_inventory_delta_receipt_v1()','EXECUTE'
    )
    and not has_function_privilege(
      'authenticated','public._momos_inventory_events_page_v1(bigint,bigint,integer)','EXECUTE'
    )
    and not has_function_privilege(
      'anon','public._momos_inventory_events_page_v1(bigint,bigint,integer)','EXECUTE'
    )
    and not has_function_privilege(
      'service_role','public._momos_inventory_events_page_v1(bigint,bigint,integer)','EXECUTE'
    )
    and not has_function_privilege(
      'authenticated','public._momos_touch_inventory_sync_event_v1()','EXECUTE'
    )
    and not has_function_privilege(
      'anon','public._momos_touch_inventory_sync_event_v1()','EXECUTE'
    )
    and not has_function_privilege(
      'service_role','public._momos_touch_inventory_sync_event_v1()','EXECUTE'
    ),'H70 abrio la frontera RBAC.';
  assert not has_table_privilege(
      'authenticated','public.inventory_sync_event_xids','SELECT'
    ) and not has_table_privilege(
      'anon','public.inventory_sync_event_xids','SELECT'
    ) and not has_table_privilege(
      'service_role','public.inventory_sync_event_xids','SELECT'
    ) and not has_table_privilege(
      'authenticated','public.inventory_sync_event_xids','INSERT'
    ) and not has_table_privilege(
      'authenticated','public.inventory_sync_event_xids','UPDATE'
    ) and not has_table_privilege(
      'authenticated','public.inventory_sync_event_xids','DELETE'
    ) and not has_table_privilege(
      'anon','public.inventory_sync_event_xids','INSERT'
    ) and not has_table_privilege(
      'service_role','public.inventory_sync_event_xids','INSERT'
    ) and exists(
      select 1 from pg_class c
      where c.oid='public.inventory_sync_event_xids'::regclass
        and c.relrowsecurity
    ) and not exists(
      select 1 from pg_catalog.pg_publication where puballtables
    ),'H70 expuso el mapping xid privado o acepto una publicacion global.';

  assert exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_delta_receipts'::regclass
      and t.tgname='inventory_delta_receipts_compact_v1'
      and not t.tgisinternal
      and t.tgfoid='public._momos_compact_inventory_delta_receipt_v1()'::regprocedure
  ) and exists(
    select 1 from pg_constraint c
    where c.conrelid='public.inventory_delta_receipts'::regclass
      and c.conname='inventory_delta_receipts_response_compact'
      and c.convalidated
  ) and not exists(
    select 1 from public.inventory_delta_receipts r where r.response ? 'delta'
  ),'H70 no compacto el backfill o no protege recibos futuros.';

  select lower(pg_get_functiondef(
    'public._momos_inventory_delta_v1(text,bigint)'::regprocedure
  )) into v_helper;
  select lower(pg_get_functiondef(
    'public.momos_inventory_deltas_v1(text[])'::regprocedure
  )) into v_batch;
  select lower(pg_get_functiondef(
    'public.momos_core_snapshot_v1()'::regprocedure
  )) into v_core;
  select lower(pg_get_functiondef(
    'public.momos_inventory_deltas_since_v1(bigint,integer)'::regprocedure
  )) into v_events;
  select lower(pg_get_functiondef(
    'public._momos_inventory_events_page_v1(bigint,bigint,integer)'::regprocedure
  )) into v_page;
  select lower(pg_get_functiondef(
    'public.momos_sync_manifest_v1()'::regprocedure
  )) into v_manifest;

  assert v_helper !~ 'for[[:space:]]+(share|update)'
    and v_batch !~ 'for[[:space:]]+(share|update)',
    'H70 conserva locks de fila que pueden cruzarse con escritores multi-item.';
  assert position('_momos_inventory_delta_v1' in v_batch)=0
    and position('with requested as materialized' in v_batch)>0
    and position('perform i.id' in v_batch)=0
    and v_batch !~ '[[:<:]]loop[[:>:]]',
    'El batch H70 no resuelve todos los items en un unico statement.';
  assert regexp_count(v_helper,'limit[[:space:]]+50')=2
    and regexp_count(v_batch,'limit[[:space:]]+50')=2,
    'H70 no conserva ventanas de 50 movimientos y auditorias.';
  assert position('with target_item as materialized' in v_helper)>0
    and position('with snapshot_payload as materialized' in v_core)>0
    and position('inventory_latest_event_id' in v_core)>0
    and position('pg_snapshot_xmin' in v_core)>0
    and position('4611686018427387904' in v_core)>0
    and position('from public.inventory_items' in v_core)>0
    and position('from public.v_inventory_lots' in v_core)>0,
    'Helper o core snapshot perdieron su corte MVCC explicito.';
  assert position('pg_snapshot_xmin' in v_events)>0
    and position('4611686018427387904' in v_events)>0
    and position('_momos_inventory_events_page_v1' in v_events)>0
    and position('x.producer_xid>=p_after_xid' in v_page)>0
    and position('x.producer_xid<p_target_xid' in v_page)>0
    and position('group by x.producer_xid' in v_page)>0
    and position('limit p_limit+1' in v_page)>0
    and position('v_group_count>=p_limit' in v_page)>0
    and position('pg_snapshot_xmin' in v_manifest)>0
    and position('4611686018427387904' in v_manifest)>0,
    'H70 volvio a depender de identity como orden global de commit.';
  assert (
    select array_agg(c.column_name::text order by c.ordinal_position)
    from information_schema.columns c
    where c.table_schema='public' and c.table_name='inventory_sync_events'
  )=array['event_id','item_id','changed_at']::text[]
    and (
      select array_agg(c.column_name::text order by c.ordinal_position)
      from information_schema.columns c
      where c.table_schema='public'
        and c.table_name='inventory_sync_event_xids'
    )=array['event_id','producer_xid']::text[]
    and exists(
      select 1 from pg_constraint c
      where c.conrelid='public.inventory_sync_event_xids'::regclass
        and c.contype='p'
    )
    and exists(
      select 1 from pg_constraint c
      where c.conrelid='public.inventory_sync_event_xids'::regclass
        and c.contype='f'
        and c.confrelid='public.inventory_sync_events'::regclass
        and c.confdeltype='c'
    )
    and exists(
      select 1 from pg_constraint c
      where c.conrelid='public.inventory_sync_event_xids'::regclass
        and c.contype='c'
        and position('producer_xid >= 0' in pg_get_constraintdef(c.oid))>0
    )
    and exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='inventory_sync_event_xids'
      and i.indexname='inventory_sync_event_xids_producer_idx'
  ) and not exists(
    select 1 from pg_publication_tables p
    where p.schemaname='public' and p.tablename='inventory_sync_event_xids'
  ) and not exists(
    select 1
    from public.inventory_sync_events e
    left join public.inventory_sync_event_xids x on x.event_id=e.event_id
    where x.event_id is null
  ) and position(
    'insert into public.inventory_sync_event_xids' in lower(pg_get_functiondef(
      'public._momos_touch_inventory_sync_event_v1()'::regprocedure
    ))
  )>0 and position(
    'pg_current_xact_id' in lower(pg_get_functiondef(
      'public._momos_touch_inventory_sync_event_v1()'::regprocedure
    ))
  )>0,'H70 amplio/publico el outbox o dejo eventos sin xid privado.';
  assert exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='inventory_lots'
      and i.indexname='inventory_lots_item_history_idx'
  ) and exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='inventory_movements'
      and i.indexname='inventory_movements_item_recent_idx'
  ) and exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='audit_logs'
      and i.indexname='audit_logs_inventory_item_recent_idx'
  ) and exists(
    select 1 from pg_indexes i
    where i.schemaname='public' and i.tablename='audit_logs'
      and i.indexname='audit_logs_inventory_recent_idx'
  ),'H70 no instalo los indices completos de lotes e historial.';
  assert exists(
    select 1 from pg_proc
    where oid='public._momos_inventory_delta_v1(text,bigint)'::regprocedure
      and provolatile='v' and prosecdef
  ) and exists(
    select 1 from pg_proc
    where oid='public.momos_inventory_deltas_v1(text[])'::regprocedure
      and provolatile='v' and prosecdef
  ) and exists(
    select 1 from pg_proc
    where oid='public.momos_core_snapshot_v1()'::regprocedure
      and provolatile='s' and not prosecdef
  ),'H70 cambio volatilidad o contexto de seguridad requerido.';

  select nombre into v_cat from public.inventory_cats order by nombre limit 1;
  assert v_cat is not null,'Falta una categoria de inventario para H70.';
  insert into public.inventory_items(
    id,nombre,cat,unidad,stock,minimo,costo,proveedor,vence,ubicacion,compra
  ) values
    (v_item,'Insumo historia H70',v_cat,'kg',60,0,1,'Proveedor H70',null,'Nevera H70',current_date),
    (v_empty_item,'Insumo vacio H70',v_cat,'kg',0,0,1,'Proveedor H70',null,'Nevera H70',current_date),
    (v_third_item,'Insumo tercero H70',v_cat,'kg',0,0,1,'Proveedor H70',null,'Nevera H70',current_date);
  insert into public.inventory_lots(
    id,item_id,received_at,expires_at,initial_quantity,available_quantity,
    unit_cost,supplier,location,origin
  ) values(
    'IL-H70-'||pg_backend_pid(),v_item,current_date,null,60,60,
    1,'Proveedor H70','Nevera H70','Ajuste'
  );

  -- Equivalente determinista de commit invertido: A recibe xid/evento primero,
  -- B confirma antes, pero el safe xmin permanece en A. La primera pagina no
  -- certifica B; cuando A termina, el rango siguiente entrega A y B juntos.
  v_a_xid:=((pg_catalog.pg_current_xact_id())::text)::bigint+1000000;
  v_b_xid:=v_a_xid+1;
  insert into public.inventory_sync_events(item_id)
  values(v_item) returning event_id into v_a_event;
  insert into public.inventory_sync_event_xids(event_id,producer_xid)
  values(v_a_event,v_a_xid);
  insert into public.inventory_sync_events(item_id)
  values(v_empty_item) returning event_id into v_b_event;
  insert into public.inventory_sync_event_xids(event_id,producer_xid)
  values(v_b_event,v_b_xid);
  assert v_a_event<v_b_event,'El fixture no representa asignacion A antes que B.';

  v_waiting:=public._momos_inventory_events_page_v1(v_a_xid,v_a_xid,100);
  assert v_waiting->>'latest_event_id'=v_a_xid::text
    and v_waiting->>'next_event_id'=v_a_xid::text
    and not (v_waiting->>'overflow')::boolean
    and jsonb_array_length(v_waiting->'item_ids')=0,
    'El watermark avanzo mientras A seguia abierta y pudo perder B.';
  v_resolved:=public._momos_inventory_events_page_v1(
    v_a_xid,v_b_xid+1,100
  );
  assert v_resolved->>'latest_event_id'=(v_b_xid+1)::text
    and v_resolved->>'next_event_id'=(v_b_xid+1)::text
    and not (v_resolved->>'overflow')::boolean
    and jsonb_array_length(v_resolved->'item_ids')=2
    and v_resolved->'item_ids' @> jsonb_build_array(v_item,v_empty_item),
    'El rango seguro posterior no recupero A y B tras el commit invertido.';

  -- Aun si un mismo item cambia en una larga sucesion de transacciones, el
  -- helper inspecciona como maximo limit+1 grupos y continua desde el primero
  -- excluido. Esto evita que un item caliente cause un scan sin cota.
  v_hot_xid:=v_b_xid+1000000;
  for v_i in 0..2 loop
    insert into public.inventory_sync_events(item_id)
    values(v_item) returning event_id into v_hot_event;
    insert into public.inventory_sync_event_xids(event_id,producer_xid)
    values(v_hot_event,v_hot_xid+v_i);
  end loop;
  v_hot_page:=public._momos_inventory_events_page_v1(
    v_hot_xid,v_hot_xid+3,2
  );
  assert (v_hot_page->>'overflow')::boolean
    and v_hot_page->>'latest_event_id'=(v_hot_xid+3)::text
    and v_hot_page->>'next_event_id'=(v_hot_xid+2)::text
    and v_hot_page->'item_ids'=jsonb_build_array(v_item),
    'El paginador xid no corta un historial caliente en limit+1 grupos.';

  -- Una transaccion atomica no puede dividirse entre paginas. Si por si sola
  -- supera el limite, el contrato pide un snapshot completo y no entrega un
  -- subconjunto engañoso de sus items.
  v_hot_xid:=v_hot_xid+100;
  insert into public.inventory_sync_events(item_id)
  values(v_item) returning event_id into v_hot_event;
  insert into public.inventory_sync_event_xids(event_id,producer_xid)
  values(v_hot_event,v_hot_xid);
  insert into public.inventory_sync_events(item_id)
  values(v_empty_item) returning event_id into v_hot_event;
  insert into public.inventory_sync_event_xids(event_id,producer_xid)
  values(v_hot_event,v_hot_xid);
  insert into public.inventory_sync_events(item_id)
  values(v_third_item) returning event_id into v_hot_event;
  insert into public.inventory_sync_event_xids(event_id,producer_xid)
  values(v_hot_event,v_hot_xid);
  v_hot_page:=public._momos_inventory_events_page_v1(
    v_hot_xid,v_hot_xid+1,2
  );
  assert (v_hot_page->>'overflow')::boolean
    and jsonb_array_length(v_hot_page->'item_ids')=0
    and (v_hot_page->>'next_event_id')::bigint
      >(v_hot_page->>'latest_event_id')::bigint,
    'Una producer_xid indivisible mayor al limite no forzo snapshot cerrado.';

  select u.auth_id into v_actor_auth
  from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  assert v_actor_auth is not null,'Falta un Administrador autenticado para H70.';

  insert into public.inventory_delta_receipts(
    idempotency_key,operation,request_hash,item_id,event_id,response,created_by
  ) values(
    v_poison_key,'movimiento_insumo',repeat('a',64),v_item,v_a_event,
    jsonb_build_object(
      'contract','momos.inventory-mutation.v1',
      'operation','movimiento_insumo',
      'idempotency_key',v_poison_key::text,
      'duplicate',false,
      'result',jsonb_build_object('ok',true),
      'delta',jsonb_build_object('lots',jsonb_build_array(1,2,3)),
      'telefono','3000000000',
      'nota','TOKEN-H70-RECIBO-PII'
    ),v_actor_auth
  );
  select r.response into strict v_poison_response
  from public.inventory_delta_receipts r
  where r.idempotency_key=v_poison_key;
  assert (
    select array_agg(k order by k)
    from jsonb_object_keys(v_poison_response) keys(k)
  )=array['contract','duplicate','idempotency_key','operation','result']
    and position('TOKEN-H70-RECIBO-PII' in v_poison_response::text)=0
    and position('3000000000' in v_poison_response::text)=0,
    'El gate de recibos no elimino claves libres, PII o delta.';

  execute 'alter table public.inventory_delta_receipts disable trigger inventory_delta_receipts_compact_v1';
  begin
    insert into public.inventory_delta_receipts(
      idempotency_key,operation,request_hash,item_id,event_id,response,created_by
    ) values(
      v_null_key,'movimiento_insumo',repeat('b',64),v_item,v_a_event,
      jsonb_build_object(
        'contract',null,
        'operation',null,
        'idempotency_key',null,
        'duplicate',false,
        'result',jsonb_build_object('ok',true)
      ),v_actor_auth
    );
  exception when check_violation then
    v_check_blocked:=true;
  end;
  execute 'alter table public.inventory_delta_receipts enable trigger inventory_delta_receipts_compact_v1';
  assert v_check_blocked,
    'El CHECK compacto acepto identidad contractual JSON null sin trigger.';
  perform set_config('momos.h70_actor_auth',v_actor_auth::text,true);
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',current_setting('momos.h70_actor_auth'),'role','authenticated'
  )::text,
  true
);
set local role authenticated;

do $$
declare
  v_item text:='I-H70-'||pg_backend_pid();
  v_empty_item text:='I-H70-E-'||pg_backend_pid();
  v_i integer;
  v_batch jsonb;
  v_delta jsonb;
  v_core jsonb;
  v_expected_movements text[];
  v_actual_movements text[];
  v_expected_audits text[];
  v_actual_audits text[];
  v_cursor_before bigint;
  v_receipt_key uuid:=('70000000-0000-4000-8000-'||lpad(pg_backend_pid()::text,12,'0'))::uuid;
  v_first_receipt jsonb;
  v_replay_receipt jsonb;
  v_movements_before_retry bigint;
  v_legacy_reset jsonb;
begin
  assert public.inventario_deltas_disponibles(),
    'La capability de inventario no exige H70.';
  v_legacy_reset:=public.momos_inventory_deltas_since_v1(1,100);
  assert (v_legacy_reset->>'overflow')::boolean
    and jsonb_array_length(v_legacy_reset->'item_ids')=0
    and (v_legacy_reset->>'latest_event_id')::bigint>=4611686018427387904
    and (v_legacy_reset->>'next_event_id')::bigint
      >(v_legacy_reset->>'latest_event_id')::bigint,
    'Un cursor identity H69 se interpreto como xid en vez de pedir snapshot.';

  for v_i in 1..55 loop
    perform public.movimiento_insumo(
      v_item,
      'Ajuste',
      -1,
      'TOKEN-H70-NO-EXPONER movimiento '||v_i
    );
  end loop;

  assert (select count(*) from public.inventory_movements where item_id=v_item)=55
    and (
      select count(*) from public.audit_logs
      where entidad='Inventario' and entidad_id=v_item
    )=55,'El fixture H70 no genero 55 filas de cada historial.';

  v_batch:=public.momos_inventory_deltas_v1(
    array[v_item,v_empty_item,v_item]
  );
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_batch) keys(k)
  )=array['contract','items','latest_event_id'],
    'El batch H70 expuso claves fuera del contrato cerrado.';
  assert v_batch->>'contract'='momos.inventory-delta-batch.v1'
    and jsonb_typeof(v_batch->'latest_event_id')='string'
    and v_batch->>'latest_event_id' ~ '^[0-9]+$'
    and (v_batch->>'latest_event_id')::bigint>=4611686018427387904
    and jsonb_array_length(v_batch->'items')=2,
    'El batch H70 perdio cursor string, contrato o deduplicacion.';

  select d.value into v_delta
  from jsonb_array_elements(v_batch->'items') d(value)
  where d.value#>>'{item,id}'=v_item;
  assert v_delta is not null,'El batch H70 omitio el item con historia.';
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_delta) keys(k)
  )=array['audits','contract','event_id','item','lots','movements','reconciliation','scope','server_time','source_version'],
    'El delta H70 expuso claves fuera del contrato cerrado.';
  assert jsonb_array_length(v_delta->'movements')=50
    and jsonb_array_length(v_delta->'audits')=50,
    'H70 no devolvio exactamente las 50 filas mas recientes.';
  assert (v_delta#>>'{item,stock}')::numeric=5
    and (v_delta#>>'{reconciliation,lots_available}')::numeric=5
    and (v_delta#>>'{reconciliation,difference}')::numeric=0
    and (v_delta#>>'{reconciliation,exact}')::boolean,
    'El batch de un statement no conserva reconciliacion exacta.';

  select array_agg(x.id order by x.fecha desc,x.id desc)
  into v_expected_movements
  from (
    select m.id,m.fecha
    from public.inventory_movements m
    where m.item_id=v_item
    order by m.fecha desc,m.id desc
    limit 50
  ) x;
  select array_agg(x.value->>'id' order by x.ord)
  into v_actual_movements
  from jsonb_array_elements(v_delta->'movements')
    with ordinality x(value,ord);
  assert v_actual_movements=v_expected_movements,
    'La ventana de movimientos H70 no contiene los 50 mas recientes en orden.';

  select array_agg(x.id order by x.fecha desc,x.id desc)
  into v_expected_audits
  from (
    select a.id,a.fecha
    from public.audit_logs a
    where a.entidad='Inventario' and a.entidad_id=v_item
    order by a.fecha desc,a.id desc
    limit 50
  ) x;
  select array_agg(x.value->>'id' order by x.ord)
  into v_actual_audits
  from jsonb_array_elements(v_delta->'audits')
    with ordinality x(value,ord);
  assert v_actual_audits=v_expected_audits,
    'La ventana de auditorias H70 no contiene las 50 mas recientes en orden.';

  assert not ((v_delta#>'{movements,0}') ? 'nota')
    and not ((v_delta#>'{audits,0}') ?| array['user_id','de','a'])
    and position('TOKEN-H70-NO-EXPONER' in v_delta::text)=0,
    'H70 expuso nota libre o identidad en su historial sanitario.';
  assert (
    select array_agg(k order by k)
    from jsonb_object_keys(v_delta#>'{movements,0}') keys(k)
  )=array['batch_id','cant','fecha','id','item_id','order_id','tipo']
    and (
      select array_agg(k order by k)
      from jsonb_object_keys(v_delta#>'{audits,0}') keys(k)
  )=array['accion','entidad','entidad_id','fecha','id'],
    'La proyeccion sanitaria del historial H70 cambio.';

  v_first_receipt:=public.movimiento_insumo_delta(jsonb_build_object(
    'idempotency_key',v_receipt_key::text,
    'item_id',v_item,
    'tipo','Ajuste',
    'cant',-1,
    'nota','TOKEN-H70-RECIBO-NO-PERSISTIR'
  ));
  assert not (v_first_receipt->>'duplicate')::boolean
    and v_first_receipt ? 'delta'
    and v_first_receipt#>>'{delta,item,id}'=v_item,
    'La respuesta original perdio el delta aunque el recibo deba ser compacto.';

  -- El replay no reutiliza un snapshot grande: recompone el delta actual. Un
  -- cambio intermedio permite demostrarlo sin repetir la mutacion idempotente.
  perform public.movimiento_insumo(
    v_item,'Ajuste',1,'TOKEN-H70-REPLAY-ESTADO-ACTUAL'
  );
  select count(*) into v_movements_before_retry
  from public.inventory_movements where item_id=v_item;
  v_replay_receipt:=public.movimiento_insumo_delta(jsonb_build_object(
    'idempotency_key',v_receipt_key::text,
    'item_id',v_item,
    'tipo','Ajuste',
    'cant',-1,
    'nota','TOKEN-H70-RECIBO-NO-PERSISTIR'
  ));
  assert (v_replay_receipt->>'duplicate')::boolean
    and v_replay_receipt ? 'delta'
    and (v_replay_receipt#>>'{delta,source_version}')::bigint
      >(v_first_receipt#>>'{delta,source_version}')::bigint
    and (v_replay_receipt#>>'{delta,item,stock}')::numeric=5
    and position('TOKEN-H70-' in (v_replay_receipt->'delta')::text)=0,
    'El replay no reconstruyo un delta actual y sanitario.';
  assert (
    select count(*) from public.inventory_movements where item_id=v_item
  )=v_movements_before_retry,
    'El replay idempotente repitio la mutacion.';
  perform set_config('momos.h70_receipt_key',v_receipt_key::text,true);

  v_cursor_before:=4611686018427387904
    + ((pg_catalog.pg_snapshot_xmin(
      pg_catalog.pg_current_snapshot()
    ))::text)::bigint;
  v_core:=public.momos_core_snapshot_v1();
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_core) keys(k)
  )=array[
    'app_settings','brand_library','catalog_values','combo_components',
    'contains_agency','figura_relleno','figuras','inventory_audit_logs',
    'inventory_items','inventory_latest_event_id','inventory_lots',
    'inventory_movements','products',
    'proveedores_domicilio','recipes','server_time',
    'subreceta_ingredientes','subrecetas','toppings','users','version','zonas'
  ],'El cursor H70 no quedo dentro del contrato cerrado del core snapshot.';
  assert jsonb_typeof(v_core->'inventory_latest_event_id')='string'
    and v_core->>'inventory_latest_event_id' ~ '^[0-9]+$'
    and (v_core->>'inventory_latest_event_id')::bigint>=v_cursor_before,
    'El core snapshot no entrega el safe xmin numerico de su propio corte.';
  assert jsonb_array_length(v_core->'inventory_movements')=50
    and jsonb_array_length(v_core->'inventory_audit_logs')=50
    and (
      select array_agg(k order by k)
      from jsonb_object_keys(v_core#>'{inventory_movements,0}') keys(k)
    )=array['batch_id','cant','fecha','id','item_id','order_id','tipo']
    and (
      select array_agg(k order by k)
      from jsonb_object_keys(v_core#>'{inventory_audit_logs,0}') keys(k)
    )=array['accion','entidad','entidad_id','fecha','id']
    and not exists(
      select 1 from jsonb_array_elements(v_core->'inventory_audit_logs') a(value)
      where a.value->>'entidad'<>'Inventario'
    ),'El historial atomico del core no es cerrado, sanitario o acotado a 50.';
  assert not (v_core ?| array['inventory_sync_events','changed_at','event'])
    and position('TOKEN-H70-NO-EXPONER' in v_core::text)=0,
    'El cursor atomico agrego filas del outbox o datos libres al snapshot.';
end $$;

reset role;

do $$
declare
  v_response jsonb;
begin
  select r.response into strict v_response
  from public.inventory_delta_receipts r
  where r.idempotency_key=current_setting('momos.h70_receipt_key')::uuid;
  assert not (v_response ? 'delta')
    and (
      select array_agg(k order by k) from jsonb_object_keys(v_response) keys(k)
    )=array['contract','duplicate','idempotency_key','operation','result']
    and position('TOKEN-H70-' in v_response::text)=0,
    'El recibo persistido no es O(1), conserva el delta o expone texto libre.';
end $$;

-- Obliga a evaluar las guardas H68 antes del rollback del fixture.
set constraints inventory_items_stock_guard,
  inventory_lots_stock_guard,
  inventory_lot_allocations_stock_guard,
  inventory_movements_stock_guard immediate;

select 'TESTS_OK — H70 batch MVCC/recibos O(1)/replay/safe-xmin commit-order/historial 50/core atomico/RBAC/PII PASS, rollback total' as resultado;
rollback;
