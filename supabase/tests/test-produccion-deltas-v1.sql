-- MOMOS OPS · prueba adversarial H73. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_produccion_deltas_20260719'));

do $$
declare
  v_actor_auth uuid;
  v_figure text;
  v_subrecipe text;
  v_output_item text;
  v_before bigint;
  v_after bigint;
  v_item record;
  v_fixture_lot_id text;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_73_produccion_deltas'),
    'Falta aplicar H73.';
  assert to_regclass('public.production_activity_sync_versions') is not null
    and to_regclass('public.production_delta_receipts') is not null
    and to_regprocedure('public.momos_production_activity_delta_v1()') is not null
    and to_regprocedure('public.crear_corrida_delta(jsonb)') is not null
    and to_regprocedure('public.producir_subreceta_delta(jsonb)') is not null
    and to_regprocedure('public.convertir_imperfectas_delta(jsonb)') is not null,
    'Falta una pieza del contrato H73.';
  assert has_function_privilege('authenticated','public.crear_corrida_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.producir_subreceta_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.convertir_imperfectas_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.momos_production_activity_delta_v1()','EXECUTE')
    and not has_function_privilege('anon','public.crear_corrida_delta(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.crear_corrida_delta(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_production_mutation_response_v1(text,text,boolean,jsonb,text[],text[],boolean)','EXECUTE'),
    'H73 abrió la frontera RBAC de sus funciones.';
  assert has_table_privilege('authenticated','public.production_activity_sync_versions','SELECT')
    and not has_table_privilege('authenticated','public.production_activity_sync_versions','INSERT')
    and not has_table_privilege('service_role','public.production_activity_sync_versions','SELECT')
    and not has_table_privilege('authenticated','public.production_delta_receipts','SELECT')
    and not has_table_privilege('authenticated','public.production_delta_receipts','INSERT')
    and not has_table_privilege('service_role','public.production_delta_receipts','SELECT'),
    'H73 expuso escritura del outbox o los recibos privados.';
  assert exists(select 1 from pg_policies where schemaname='public'
    and tablename='production_activity_sync_versions'
    and policyname='production_activity_sync_versions_staff_read'
    and roles @> array['authenticated']::name[]),
    'El outbox H73 perdió RLS de personal.';
  assert (select array_agg(a.attname::text order by a.attnum)
    from pg_attribute a where a.attrelid='public.production_activity_sync_versions'::regclass
    and a.attnum>0 and not a.attisdropped)=array['scope','version','changed_at'],
    'El outbox H73 expuso detalle, actor, notas o PII.';
  assert (select count(*)=2 from pg_trigger t where t.tgname='momos_production_activity_sync_touch'
    and not t.tgisinternal and t.tgrelid=any(array[
      'public.subreceta_producciones'::regclass,'public.production_suggestions'::regclass
    ])),'H73 no cubre las dos fuentes de actividad de Producción.';

  select u.auth_id into v_actor_auth from public.users u
  where u.activo and u.auth_id is not null and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  assert v_actor_auth is not null,'Falta un Administrador autenticado para H73.';
  select f.nombre into v_figure from public.figuras f join public.products p on p.id=f.product_id
  where f.activo and p.activo and p.tipo='momo' order by f.nombre limit 1;
  assert v_figure is not null,'Falta una figura activa con producto para H73.';
  select s.id,s.item_id into v_subrecipe,v_output_item
  from public.subrecetas s
  join public.inventory_items output_item on output_item.id=s.item_id
  where s.activo and s.item_id is not null
    and exists(select 1 from public.subreceta_ingredientes si where si.subreceta_id=s.id)
  order by s.id limit 1;
  assert v_subrecipe is not null and v_output_item is not null,
    'Falta una subreceta activa con fórmula e insumo de salida para H73.';

  -- H68 convirtió los lotes FIFO en fuente exacta de verdad. La cobertura sintética
  -- debe existir también como lote vigente; inflar solo inventory_items.stock falsearía
  -- el modelo y _consume_inventory_lots debe rechazarlo. Todo termina en ROLLBACK.
  for v_item in
    select i.id,coalesce(i.costo,0) as costo
    from public.inventory_items i
    order by i.id
  loop
    v_fixture_lot_id:='IL-H73-'||v_item.id||'-'||pg_backend_pid()::text;
    insert into public.inventory_lots(
      id,item_id,received_at,expires_at,initial_quantity,available_quantity,
      unit_cost,supplier,location,origin
    ) values(
      v_fixture_lot_id,v_item.id,current_date,current_date+30,1000,1000,
      greatest(v_item.costo,0),'Prueba H73','Rollback','Ajuste'
    );
    update public.inventory_items i
    set stock=(
      select coalesce(sum(l.available_quantity),0)
      from public.inventory_lots l
      where l.item_id=i.id and l.available_quantity>0
    )
    where i.id=v_item.id;
  end loop;
  select version into v_before from public.production_activity_sync_versions where scope='production';
  update public.production_suggestions set motivo=motivo where id=(select id from public.production_suggestions order by id limit 1);
  select version into v_after from public.production_activity_sync_versions where scope='production';
  assert v_after=v_before,'Un UPDATE sin cambios avanzó incorrectamente la versión H73.';

  perform set_config('momos.h73_actor_auth',v_actor_auth::text,true);
  perform set_config('momos.h73_figure',v_figure,true);
  perform set_config('momos.h73_subrecipe',v_subrecipe,true);
  perform set_config('momos.h73_output_item',v_output_item,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h73_actor_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_figure text:=current_setting('momos.h73_figure');
  v_subrecipe text:=current_setting('momos.h73_subrecipe');
  v_output_item text:=current_setting('momos.h73_output_item');
  v_activity jsonb;
  v_first jsonb;
  v_repeat jsonb;
  v_sub jsonb;
  v_convert jsonb;
  v_batch_id text;
  v_product_id text;
  v_corrida_id text;
  v_count integer;
  v_failed boolean:=false;
begin
  assert public.produccion_deltas_disponibles(),
    'La capability H73 no quedó cerrada por migración y staff.';
  v_activity:=public.momos_production_activity_delta_v1();
  assert (select array_agg(k order by k) from jsonb_object_keys(v_activity) keys(k))=
    array['containsSecrets','contract','externalExecution','productionSuggestions','subrecipeProductions','version'],
    'La actividad H73 expuso claves fuera del contrato compacto.';
  assert v_activity->>'contract'='momos.production-activity-delta.v1'
    and (v_activity->>'containsSecrets')::boolean=false
    and (v_activity->>'externalExecution')::boolean=false
    and jsonb_array_length(v_activity->'subrecipeProductions')<=50
    and jsonb_array_length(v_activity->'productionSuggestions')<=100,
    'La actividad H73 perdió límites o fronteras de seguridad.';
  assert position('"obs"' in lower(v_activity::text))=0
    and position('resp_user_id' in lower(v_activity::text))=0
    and position('created_by' in lower(v_activity::text))=0
    and position('email' in lower(v_activity::text))=0
    and position('telefono' in lower(v_activity::text))=0,
    'La actividad H73 expuso notas, actores o PII.';

  v_first:=public.crear_corrida_delta(jsonb_build_object(
    'sabor','Coco','figuras',jsonb_build_array(jsonb_build_object('figura',v_figure,'cant',1)),
    'idempotency_key','test-h73-corrida'
  ));
  assert (select array_agg(k order by k) from jsonb_object_keys(v_first) keys(k))=
    array['activity','containsSecrets','contract','duplicate','externalExecution','finishedInventory','idempotencyKey','inventory','operation','result'],
    'La mutación H73 expuso claves fuera de su contrato.';
  assert v_first->>'contract'='momos.production-mutation.v1'
    and v_first->>'operation'='crear_corrida'
    and (v_first->>'duplicate')::boolean=false
    and (v_first->>'containsSecrets')::boolean=false
    and (v_first->>'externalExecution')::boolean=false
    and v_first->'finishedInventory'->>'contract'='momos.finished-inventory-delta-batch.v1',
    'Crear corrida no devolvió un delta atómico protegido.';
  v_corrida_id:=v_first->'result'->>'corrida_id';
  v_batch_id:=v_first->'result'->'lotes'->0->>'batch_id';
  v_product_id:=v_first->'result'->'lotes'->0->>'product_id';
  assert v_corrida_id is not null and v_batch_id is not null and v_product_id is not null,
    'Crear corrida no devolvió sus identificadores canónicos.';
  assert exists(select 1 from jsonb_array_elements(v_first->'finishedInventory'->'deltas') d
    where d->>'productId'=v_product_id),
    'El delta de corrida no contiene el producto realmente afectado.';
  select count(*) into v_count from public.production_batches where corrida_id=v_corrida_id;
  v_repeat:=public.crear_corrida_delta(jsonb_build_object(
    'sabor','Coco','figuras',jsonb_build_array(jsonb_build_object('figura',v_figure,'cant',1)),
    'idempotency_key','test-h73-corrida'
  ));
  assert (v_repeat->>'duplicate')::boolean=true
    and v_repeat->'result'=v_first->'result'
    and (select count(*) from public.production_batches where corrida_id=v_corrida_id)=v_count,
    'El replay H73 repitió efectos o cambió el resultado.';
  begin
    perform public.crear_corrida_delta(jsonb_build_object(
      'sabor','Maracuyá','figuras',jsonb_build_array(jsonb_build_object('figura',v_figure,'cant',1)),
      'idempotency_key','test-h73-corrida'
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H73 aceptó reutilizar la llave con otro contrato.';

  v_sub:=public.producir_subreceta_delta(jsonb_build_object(
    'subreceta_id',v_subrecipe,'gramos_nominales',10,'gramos_obtenidos',9,
    'idempotency_key','test-h73-subreceta'
  ));
  assert v_sub->>'operation'='producir_subreceta'
    and (v_sub->>'duplicate')::boolean=false
    and v_sub->'inventory'->>'contract'='momos.inventory-delta-batch.v1'
    and v_sub->'activity'->>'contract'='momos.production-activity-delta.v1'
    and exists(select 1 from jsonb_array_elements(v_sub->'inventory'->'items') d
      where d->'item'->>'id'=v_output_item),
    'Preparar subreceta no devolvió inventario y actividad del mismo commit.';
  v_repeat:=public.producir_subreceta_delta(jsonb_build_object(
    'subreceta_id',v_subrecipe,'gramos_nominales',10,'gramos_obtenidos',9,
    'idempotency_key','test-h73-subreceta'
  ));
  assert (v_repeat->>'duplicate')::boolean=true and v_repeat->'result'=v_sub->'result',
    'El replay de subreceta no fue estable.';

  update public.production_batches set prod=1,perfectas=0,imperfectas=1,descartadas=0,
    destino='',stock_contabilizado=false where id=v_batch_id;
  v_convert:=public.convertir_imperfectas_delta(jsonb_build_object(
    'batch_id',v_batch_id,'idempotency_key','test-h73-imperfectas'
  ));
  assert v_convert->>'operation'='convertir_imperfectas'
    and (v_convert->>'duplicate')::boolean=false
    and v_convert->'finishedInventory'->>'contract'='momos.finished-inventory-delta-batch.v1'
    and exists(select 1 from jsonb_array_elements(v_convert->'finishedInventory'->'deltas') d
      where d->>'productId'=v_product_id)
    and (select destino ilike '%Insumo%' from public.production_batches where id=v_batch_id),
    'Convertir imperfectas no devolvió el lote exacto actualizado.';
  v_repeat:=public.convertir_imperfectas_delta(jsonb_build_object(
    'batch_id',v_batch_id,'idempotency_key','test-h73-imperfectas'
  ));
  assert (v_repeat->>'duplicate')::boolean=true,
    'El replay de imperfectas intentó repetir una conversión terminal.';

  v_failed:=false;
  begin perform public.producir_subreceta_delta(jsonb_build_object(
    'subreceta_id',v_subrecipe,'gramos_nominales',10,
    'idempotency_key','test-h73-extra','secreto','no'
  )); exception when others then v_failed:=true; end;
  assert v_failed,'H73 aceptó campos fuera de su contrato cerrado.';
end $$;

reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_production_activity_delta_v1();
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo leer actividad de Producción.';
  v_failed:=false;
  begin perform public.crear_corrida_delta('{"idempotency_key":"anon"}'::jsonb);
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo mutar Producción.';
end $$;

reset role;
set constraints inventory_items_stock_guard, inventory_lots_stock_guard,
  inventory_lot_allocations_stock_guard, inventory_movements_stock_guard immediate;
select 'TESTS_OK — Producción deltas/atomicidad/idempotencia/actividad/FIFO/PII/RBAC PASS, rollback total' as resultado;
rollback;
