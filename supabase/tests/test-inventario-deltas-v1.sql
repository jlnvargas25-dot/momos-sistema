-- MOMOS OPS · prueba adversarial H69 Inventario incremental/idempotente.
-- Siempre ROLLBACK: no deja insumos, lotes, recibos ni eventos sintéticos.

begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_inventario_deltas_20260719'));

do $$
declare
  v_event_columns text[];
  v_definition text;
  v_actor_auth uuid;
  v_cat text;
  v_item text:='I-H69-'||pg_backend_pid();
  v_expired_item text:='I-H69-X-'||pg_backend_pid();
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_69_inventario_deltas'
  ),'Falta aplicar H69.';
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_68_inventario_precision_lotes'
  ),'H69 perdió su dependencia H68.';
  assert to_regclass('public.inventory_delta_receipts') is not null
    and to_regclass('public.inventory_sync_events') is not null,
    'Falta el recibo privado o el outbox sanitario H69.';
  assert to_regprocedure('public.entrada_insumo_lote_delta(jsonb)') is not null
    and to_regprocedure('public.movimiento_insumo_delta(jsonb)') is not null
    and to_regprocedure('public.desechar_lote_insumo_delta(jsonb)') is not null
    and to_regprocedure('public.momos_inventory_deltas_v1(text[])') is not null
    and to_regprocedure('public.momos_inventory_deltas_since_v1(bigint,integer)') is not null
    and to_regprocedure('public.inventario_deltas_disponibles()') is not null,
    'Falta una superficie pública H69.';

  assert has_function_privilege('authenticated','public.entrada_insumo_lote_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.movimiento_insumo_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.desechar_lote_insumo_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.momos_inventory_deltas_v1(text[])','EXECUTE')
    and has_function_privilege('authenticated','public.momos_inventory_deltas_since_v1(bigint,integer)','EXECUTE')
    and has_function_privilege('authenticated','public.inventario_deltas_disponibles()','EXECUTE'),
    'La app autenticada no puede usar H69.';
  assert not has_function_privilege('anon','public.entrada_insumo_lote_delta(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.movimiento_insumo_delta(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.desechar_lote_insumo_delta(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_inventory_deltas_v1(text[])','EXECUTE')
    and not has_function_privilege('anon','public.momos_inventory_deltas_since_v1(bigint,integer)','EXECUTE')
    and not has_function_privilege('service_role','public.entrada_insumo_lote_delta(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.momos_inventory_deltas_v1(text[])','EXECUTE'),
    'Anon o service_role pueden saltar la sesión H69.';
  assert not has_function_privilege('authenticated','public._momos_inventory_delta_v1(text,bigint)','EXECUTE')
    and not has_function_privilege('service_role','public._momos_inventory_delta_v1(text,bigint)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_touch_inventory_sync_event_v1()','EXECUTE'),
    'Un helper H69 quedó expuesto.';
  assert exists(
    select 1 from pg_proc
    where oid='public._momos_inventory_delta_v1(text,bigint)'::regprocedure
      and provolatile='v' and prosecdef
  ) and exists(
    select 1 from pg_proc
    where oid='public.momos_inventory_deltas_v1(text[])'::regprocedure
      and provolatile='v' and prosecdef
  ),'Mutation delta o batch no conservan visibilidad VOLATILE segura.';
  if exists(
    select 1 from public.momos_ops_migrations
    where id='20260719_70_inventario_delta_consistencia'
  ) then
    assert pg_get_functiondef(
        'public.momos_inventory_deltas_v1(text[])'::regprocedure
      ) !~* 'for[[:space:]]+(share|update)'
      and pg_get_functiondef(
        'public._momos_inventory_delta_v1(text,bigint)'::regprocedure
      ) !~* 'for[[:space:]]+(share|update)',
      'H70 reintrodujo locks de fila en delta/batch.';
  else
    assert position('for share' in lower(
      pg_get_functiondef('public.momos_inventory_deltas_v1(text[])'::regprocedure)
    ))>0 and position('order by i.id' in lower(
      pg_get_functiondef('public.momos_inventory_deltas_v1(text[])'::regprocedure)
    ))>0 and position('for share' in lower(
      pg_get_functiondef('public._momos_inventory_delta_v1(text,bigint)'::regprocedure)
    ))>0,'El delta/batch H69 no bloquea insumos en orden canonico.';
  end if;

  assert not has_table_privilege('authenticated','public.inventory_delta_receipts','SELECT')
    and not has_table_privilege('authenticated','public.inventory_delta_receipts','INSERT')
    and not has_table_privilege('service_role','public.inventory_delta_receipts','SELECT'),
    'El recibo idempotente privado quedó expuesto.';
  assert has_table_privilege('authenticated','public.inventory_sync_events','SELECT')
    and not has_table_privilege('authenticated','public.inventory_sync_events','INSERT')
    and not has_table_privilege('authenticated','public.inventory_sync_events','UPDATE')
    and not has_table_privilege('authenticated','public.inventory_sync_events','DELETE')
    and not has_sequence_privilege('authenticated','public.inventory_sync_events_event_id_seq','USAGE'),
    'El outbox H69 no es append-only para el cliente.';
  assert exists(
    select 1 from pg_class c where c.oid='public.inventory_delta_receipts'::regclass
      and c.relrowsecurity
  ) and exists(
    select 1 from pg_class c where c.oid='public.inventory_sync_events'::regclass
      and c.relrowsecurity
  ),'H69 dejó una tabla sin RLS.';

  select array_agg(column_name order by ordinal_position) into v_event_columns
  from information_schema.columns
  where table_schema='public' and table_name='inventory_sync_events';
  assert v_event_columns=array['event_id','item_id','changed_at']::text[],
    'El evento Realtime expone más que cursor, insumo y fecha.';
  assert exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.inventory_items'::regclass
      and t.tgname='inventory_items_sync_event_v1'
      and not t.tgisinternal
      and t.tgfoid='public._momos_touch_inventory_sync_event_v1()'::regprocedure
  ),'inventory_items no genera el outbox H69.';
  assert not exists(select 1 from pg_publication where pubname='supabase_realtime')
    or exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables)
    or exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='inventory_sync_events'
    ),'Realtime no publicó el evento sanitario H69.';

  v_definition:=pg_get_functiondef('public._momos_inventory_delta_v1(text,bigint)'::regprocedure);
  assert v_definition !~* '[.]nota([,[:space:]]|$)|[.]de([,[:space:]]|$)|[.]a([,[:space:]]|$)|[.]user_id([,[:space:]]|$)'
    and v_definition !~* 'storage_path|signed_url|api[_-]?key|access[_-]?token',
    'El SQL del delta proyecta notas, actor, ruta o secreto.';
  assert position('Agotado' in v_definition)>0
    and position('Vencido' in v_definition)>0
    and position('Vence hoy' in v_definition)>0
    and position('Disponible' in v_definition)>0,
    'El delta perdió los estados canónicos de v_inventory_lots.';
  assert position('inventario_deltas_disponibles' in pg_get_functiondef('public.momos_sync_manifest_v1()'::regprocedure))>0
    and position('inventory_latest_event_id' in pg_get_functiondef('public.momos_sync_manifest_v1()'::regprocedure))>0,
    'El manifiesto H56 no anuncia capability y cursor H69.';

  select nombre into v_cat from public.inventory_cats order by nombre limit 1;
  assert v_cat is not null,'Falta una categoría de inventario para el fixture H69.';
  insert into public.inventory_items(
    id,nombre,cat,unidad,stock,minimo,costo,proveedor,vence,ubicacion,compra
  ) values
    (v_item,'Insumo delta H69',v_cat,'kg',0,0,1,'Proveedor H69',null,'Nevera H69',current_date),
    (v_expired_item,'Insumo vencido H69',v_cat,'kg',2,0,1,'Proveedor H69',current_date-1,'Nevera H69',current_date-2);
  insert into public.inventory_lots(
    id,item_id,received_at,expires_at,initial_quantity,available_quantity,
    unit_cost,supplier,location,origin
  ) values(
    'IL-H69-X-'||pg_backend_pid(),v_expired_item,current_date-2,current_date-1,
    2,2,1,'Proveedor H69','Nevera H69','Ajuste'
  );

  select u.auth_id into v_actor_auth
  from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  assert v_actor_auth is not null,'Falta un Administrador autenticado para H69.';
  perform set_config('momos.h69_actor_auth',v_actor_auth::text,true);
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',current_setting('momos.h69_actor_auth'),'role','authenticated'
  )::text,
  true
);
set local role authenticated;

do $$
declare
  v_item text:='I-H69-'||pg_backend_pid();
  v_expired_item text:='I-H69-X-'||pg_backend_pid();
  v_lot text:='IL-H69-X-'||pg_backend_pid();
  v_entry_payload jsonb:=jsonb_build_object(
    'idempotency_key','69000000-0000-4000-8000-000000000001',
    'item_id','I-H69-'||pg_backend_pid(),
    'cant',1.25,
    'costo_total',2500,
    'vence',(current_date+10)::text,
    'proveedor','Proveedor H69',
    'ubicacion','Nevera H69',
    'nota','TOKEN-H69-ENTRY telefono 3000000000 api_key=NO-EXPONER'
  );
  v_entry jsonb;
  v_duplicate jsonb;
  v_movement jsonb;
  v_discard jsonb;
  v_batch jsonb;
  v_gap jsonb;
  v_overflow jsonb;
  v_ahead jsonb;
  v_manifest jsonb;
  v_cursor bigint;
  v_event_count bigint;
  v_movement_count bigint;
  v_lot_count bigint;
  v_blocked boolean:=false;
  v_h70 boolean:=to_regprocedure(
    'public._momos_inventory_events_page_v1(bigint,bigint,integer)'
  ) is not null;
begin
  assert public.inventario_deltas_disponibles(),
    'La capability H69 no está disponible para staff.';
  v_manifest:=public.momos_sync_manifest_v1();
  assert v_manifest#>>'{capabilities,inventario_deltas_disponibles}'='true'
    and v_manifest->>'inventory_latest_event_id' ~ '^[0-9]+$',
    'El manifiesto no entrega capability/cursor H69.';

  v_entry:=public.entrada_insumo_lote_delta(v_entry_payload);
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_entry) keys(k)
  )=array['contract','delta','duplicate','idempotency_key','operation','result'],
    'La mutación de entrada expuso claves fuera del contrato cerrado.';
  assert v_entry->>'contract'='momos.inventory-mutation.v1'
    and v_entry->>'operation'='entrada_insumo_lote'
    and (v_entry->>'duplicate')::boolean is false
    and v_entry->>'idempotency_key'='69000000-0000-4000-8000-000000000001',
    'La entrada no selló su identidad contractual.';
  assert (
    select array_agg(k order by k)
    from jsonb_object_keys(v_entry->'delta') keys(k)
  )=array['audits','contract','event_id','item','lots','movements','reconciliation','scope','server_time','source_version'],
    'El delta de entrada expuso claves fuera del contrato cerrado.';
  assert v_entry#>>'{delta,contract}'='momos.inventory-delta.v1'
    and v_entry#>>'{delta,scope}'='inventory_item'
    and v_entry#>>'{delta,event_id}' ~ '^[0-9]+$'
    and v_entry#>>'{delta,event_id}'=v_entry#>>'{delta,source_version}'
    and (v_entry#>>'{delta,item,stock}')::numeric=1.25
    and (v_entry#>>'{delta,reconciliation,lots_available}')::numeric=1.25
    and (v_entry#>>'{delta,reconciliation,difference}')::numeric=0
    and (v_entry#>>'{delta,reconciliation,exact}')::boolean,
    'El delta no conserva cursor string o conciliación exacta.';
  assert jsonb_array_length(v_entry#>'{delta,lots}')=1
    and jsonb_array_length(v_entry#>'{delta,movements}')=1
    and jsonb_array_length(v_entry#>'{delta,audits}')=1,
    'El delta no trae todos los lotes y solo el movimiento/auditoría más reciente.';
  assert v_entry#>>'{delta,lots,0,status}'='Disponible',
    'El delta no conserva la taxonomía de v_inventory_lots.';
  assert not ((v_entry#>'{delta,movements,0}') ? 'nota')
    and not ((v_entry#>'{delta,audits,0}') ?| array['user_id','de','a'])
    and position('TOKEN-H69-ENTRY' in v_entry::text)=0
    and position('3000000000' in v_entry::text)=0
    and position('NO-EXPONER' in v_entry::text)=0,
    'El delta o recibo expuso nota, teléfono, actor o secreto.';

  select count(*) into v_event_count from public.inventory_sync_events;
  select count(*) into v_movement_count from public.inventory_movements where item_id=v_item;
  select count(*) into v_lot_count from public.inventory_lots where item_id=v_item;
  v_duplicate:=public.entrada_insumo_lote_delta(v_entry_payload);
  assert (v_duplicate->>'duplicate')::boolean
    and v_duplicate#>>'{delta,event_id}'=v_entry#>>'{delta,event_id}'
    and (select count(*) from public.inventory_sync_events)=v_event_count
    and (select count(*) from public.inventory_movements where item_id=v_item)=v_movement_count
    and (select count(*) from public.inventory_lots where item_id=v_item)=v_lot_count,
    'El reintento duplicó evento, movimiento o lote.';

  begin
    perform public.entrada_insumo_lote_delta(
      jsonb_set(v_entry_payload,'{cant}','2'::jsonb)
    );
  exception when others then v_blocked:=true;
  end;
  assert v_blocked,'Una UUID pudo reutilizarse con otro payload.';

  if v_h70 then
    v_cursor:=4611686018427387904
      + ((pg_catalog.pg_snapshot_xmin(
        pg_catalog.pg_current_snapshot()
      ))::text)::bigint;
  else
    select coalesce(max(event_id),0) into v_cursor
    from public.inventory_sync_events;
  end if;
  v_movement:=public.movimiento_insumo_delta(jsonb_build_object(
    'idempotency_key','69000000-0000-4000-8000-000000000002',
    'item_id',v_item,
    'tipo','Uso en producción',
    'cant',-0.25,
    'nota','TOKEN-H69-MOVEMENT access_token=NO-EXPONER'
  ));
  assert v_movement->>'contract'='momos.inventory-mutation.v1'
    and v_movement->>'operation'='movimiento_insumo'
    and (v_movement#>>'{delta,item,stock}')::numeric=1
    and (v_movement#>>'{delta,reconciliation,lots_available}')::numeric=1
    and position('TOKEN-H69-MOVEMENT' in v_movement::text)=0,
    'El movimiento no devolvió un delta exacto y sanitario.';

  -- El resultado de la primera entrada sigue siendo idempotente, pero su
  -- delta debe refrescarse: nunca puede pisar en memoria el movimiento nuevo.
  select count(*) into v_event_count from public.inventory_sync_events;
  select count(*) into v_movement_count from public.inventory_movements where item_id=v_item;
  v_duplicate:=public.entrada_insumo_lote_delta(v_entry_payload);
  assert (v_duplicate->>'duplicate')::boolean
    and (v_duplicate#>>'{result,stock}')::numeric=1.25
    and (v_duplicate#>>'{delta,item,stock}')::numeric=1
    and v_duplicate#>>'{delta,event_id}'=v_movement#>>'{delta,event_id}'
    and (select count(*) from public.inventory_sync_events)=v_event_count
    and (select count(*) from public.inventory_movements where item_id=v_item)=v_movement_count,
    'Un retry tardío devolvió delta viejo o reaplicó la entrada.';

  v_gap:=public.momos_inventory_deltas_since_v1(v_cursor,100);
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_gap) keys(k)
  )=array['contract','item_ids','latest_event_id','next_event_id','overflow'],
    'El gap Realtime expuso datos fuera del contrato cerrado.';
  assert v_gap->>'contract'='momos.inventory-events.v1'
    and v_gap->>'latest_event_id' ~ '^[0-9]+$'
    and v_gap->>'next_event_id' ~ '^[0-9]+$'
    and (
      (not v_h70 and exists(
        select 1 from jsonb_array_elements_text(v_gap->'item_ids') x where x=v_item
      ))
      or (v_h70 and (v_gap->>'latest_event_id')::bigint>=v_cursor)
    )
    and (v_gap->>'overflow')::boolean is false,
    'El gap no recuperó el insumo modificado o perdió el cursor string.';

  v_overflow:=public.momos_inventory_deltas_since_v1(0,1);
  assert (v_overflow->>'overflow')::boolean
    and (
      (not v_h70 and jsonb_array_length(v_overflow->'item_ids')=1)
      or (
        v_h70 and (
          jsonb_array_length(v_overflow->'item_ids')=1
          or (
            jsonb_array_length(v_overflow->'item_ids')=0
            and (v_overflow->>'next_event_id')::bigint
              >(v_overflow->>'latest_event_id')::bigint
          )
        )
      )
    ),
    'El gap no señaló una página incompleta.';

  v_ahead:=public.momos_inventory_deltas_since_v1(
    (v_gap->>'latest_event_id')::bigint+100,100
  );
  assert (v_ahead->>'overflow')::boolean
    and jsonb_array_length(v_ahead->'item_ids')=0
    and (v_ahead->>'next_event_id')::bigint>(v_ahead->>'latest_event_id')::bigint
    and (
      select array_agg(k order by k) from jsonb_object_keys(v_ahead) keys(k)
    )=array['contract','item_ids','latest_event_id','next_event_id','overflow'],
    'Un cursor adelantado no pidió reconciliación con contrato válido.';

  v_discard:=public.desechar_lote_insumo_delta(jsonb_build_object(
    'idempotency_key','69000000-0000-4000-8000-000000000003',
    'lot_id',v_lot,
    'motivo','Descarte vencido H69'
  ));
  assert v_discard->>'operation'='desechar_lote_insumo'
    and (v_discard#>>'{delta,item,stock}')::numeric=0
    and (v_discard#>>'{delta,reconciliation,lots_available}')::numeric=0
    and v_discard#>>'{delta,lots,0,status}'='Agotado',
    'El descarte no devolvió lote, agregado y estado exactos.';

  v_batch:=public.momos_inventory_deltas_v1(array[v_item,v_expired_item,v_item]);
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_batch) keys(k)
  )=array['contract','items','latest_event_id'],
    'El batch expuso claves fuera del contrato cerrado.';
  assert v_batch->>'contract'='momos.inventory-delta-batch.v1'
    and v_batch->>'latest_event_id' ~ '^[0-9]+$'
    and jsonb_array_length(v_batch->'items')=2
    and not exists(
      select 1 from jsonb_array_elements(v_batch->'items') d
      where d->>'contract'<>'momos.inventory-delta.v1'
         or d->>'event_id' !~ '^[0-9]+$'
         or (d#>>'{reconciliation,exact}')::boolean is not true
    ),'El batch no deduplicó IDs o entregó un delta no reconciliado.';

  v_blocked:=false;
  begin
    perform public.movimiento_insumo_delta(jsonb_build_object(
      'idempotency_key','69000000-0000-4000-8000-000000000004',
      'item_id',v_item,'tipo','Entrada','cant',1,
      'nota','Debe fallar','campo_inventado','NO'
    ));
  exception when others then v_blocked:=true;
  end;
  assert v_blocked,'Un payload abierto cruzó la frontera H69.';

  v_blocked:=false;
  begin perform public._momos_inventory_delta_v1(v_item,null);
  exception when insufficient_privilege then v_blocked:=true;
  end;
  assert v_blocked,'Una cuenta autenticada ejecutó el helper privado.';

  v_blocked:=false;
  begin perform 1 from public.inventory_delta_receipts limit 1;
  exception when insufficient_privilege then v_blocked:=true;
  end;
  assert v_blocked,'Una cuenta autenticada leyó recibos privados.';

  v_blocked:=false;
  begin insert into public.inventory_sync_events(item_id) values(v_item);
  exception when insufficient_privilege then v_blocked:=true;
  end;
  assert v_blocked,'Una cuenta autenticada inyectó un evento Realtime.';
end $$;

reset role;

do $$
declare
  v_item text:='I-H69-'||pg_backend_pid();
begin
  assert (
    select count(*) from public.inventory_delta_receipts
    where idempotency_key in (
      '69000000-0000-4000-8000-000000000001'::uuid,
      '69000000-0000-4000-8000-000000000002'::uuid,
      '69000000-0000-4000-8000-000000000003'::uuid
    )
  )=3,'H69 no conserva exactamente un recibo por mutación aplicada.';
  assert not exists(
    select 1 from public.inventory_delta_receipts
    where idempotency_key='69000000-0000-4000-8000-000000000004'::uuid
  ),'Una mutación fallida dejó un recibo fantasma.';
  assert not exists(
    select 1 from public.inventory_delta_receipts
    where response::text ~* 'TOKEN-H69|3000000000|NO-EXPONER|api[_-]?key|access[_-]?token'
  ),'El recibo privado guardó el payload libre o un secreto.';
  assert exists(
    select 1 from public.inventory_delta_receipts r
    where r.item_id=v_item and r.request_hash ~ '^[0-9a-f]{64}$'
  ),'El recibo no conserva la huella cerrada del contrato.';
end $$;

-- Sesión autenticada inexistente: SECURITY DEFINER no puede convertirse en
-- bypass de RLS/RBAC.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000069","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare v_blocked boolean:=false;
begin
  begin
    perform public.momos_inventory_deltas_v1(array['I-H69-'||pg_backend_pid()]);
  exception when others then v_blocked:=true;
  end;
  assert v_blocked,'Una identidad inexistente leyó el delta H69.';
end $$;

reset role;

-- Obliga a evaluar las guardas H68 antes del rollback de la prueba.
set constraints inventory_items_stock_guard,
  inventory_lots_stock_guard,
  inventory_lot_allocations_stock_guard,
  inventory_movements_stock_guard immediate;

select 'TESTS_OK — inventario deltas/idempotencia/outbox/reconciliación/PII/RBAC PASS, rollback total' as resultado;
rollback;
