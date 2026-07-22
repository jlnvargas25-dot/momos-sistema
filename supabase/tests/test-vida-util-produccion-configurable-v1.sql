-- MOMOS OPS · prueba H83. Siempre rollback.
begin;
set local statement_timeout='120s';

do $$
declare
  v_admin_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_83_vida_util_produccion'),'falta H83';
  assert (select (valor#>>'{}')::integer between 1 and 30 from public.app_settings where clave='vida_util_producto_terminado_dias'),'vida útil de terminado inválida';
  assert (select (valor#>>'{}')::integer between 1 and 30 from public.app_settings where clave='vida_util_mezclas_dias'),'vida útil de mezclas inválida';
  assert to_regprocedure('public.momos_configuration_snapshot_v2()') is not null
    and to_regprocedure('public.guardar_configuracion_v2(jsonb)') is not null,'faltan contratos v2';
  assert has_function_privilege('authenticated','public.momos_configuration_snapshot_v2()','EXECUTE')
    and has_function_privilege('authenticated','public.guardar_configuracion_v2(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_configuration_snapshot_v2()','EXECUTE')
    and not has_function_privilege('service_role','public.guardar_configuracion_v2(jsonb)','EXECUTE'),'RBAC v2 incorrecto';
  select u.auth_id into v_admin_auth from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  assert v_admin_auth is not null,'falta Administrador autenticado para probar Configuración v2';
  perform set_config('momos.h83_admin_auth',v_admin_auth::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h83_admin_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_snapshot jsonb; v_settings jsonb; v_figures jsonb; v_payload jsonb;
  v_response jsonb; v_repeat jsonb; v_before bigint; v_after bigint;
  v_key text:='83000000-0000-4000-8000-'||lpad(pg_backend_pid()::text,12,'0');
  v_failed boolean:=false;
begin
  v_snapshot:=public.momos_configuration_snapshot_v2();
  v_settings:=v_snapshot->'settings';
  assert v_snapshot->>'contract'='momos.configuration-snapshot.v2'
    and (v_snapshot->>'version')::integer=2
    and (v_settings->>'finishedProductShelfDays')::integer between 1 and 30
    and (v_settings->>'mixtureShelfDays')::integer between 1 and 30,
    'snapshot v2 incompleto';

  select coalesce(jsonb_agg(jsonb_build_object(
    'name',x->>'name','species',x->>'species','grams',(x->>'grams')::integer,'product_id',x->>'productId'
  ) order by x->>'name'),'[]'::jsonb) into v_figures
  from jsonb_array_elements(v_settings->'figures') x where (x->>'active')::boolean;
  v_payload:=jsonb_build_object(
    'zones',v_settings->'zones',
    'catalogs',jsonb_build_object(
      'fruit_flavors',v_settings#>'{catalogs,fruitFlavors}',
      'creamy_flavors',v_settings#>'{catalogs,creamyFlavors}',
      'sauces',v_settings#>'{catalogs,sauces}',
      'payments',v_settings#>'{catalogs,payments}',
      'delivery_providers',v_settings#>'{catalogs,deliveryProviders}'
    ),
    'fixed_filling',v_settings->>'fixedFilling','figures',v_figures,
    'toppings',coalesce((select jsonb_agg(jsonb_build_object(
      'name',x->>'name','price',(x->>'price')::numeric,
      'inventory_item_id',x->>'inventoryItemId','inventory_quantity',(x->>'inventoryQuantity')::numeric
    ) order by x->>'name') from jsonb_array_elements(v_settings->'toppings') x where (x->>'active')::boolean),'[]'::jsonb),
    'order_minimum',(v_settings->>'orderMinimum')::numeric,
    'freezing_hours',(v_settings->>'freezingHours')::integer,
    'delays',jsonb_build_object(
      'kitchen_warning',(v_settings#>>'{delays,kitchenWarning}')::integer,
      'kitchen_urgent',(v_settings#>>'{delays,kitchenUrgent}')::integer,
      'packing_warning',(v_settings#>>'{delays,packingWarning}')::integer,
      'packing_urgent',(v_settings#>>'{delays,packingUrgent}')::integer,
      'repeat_every',(v_settings#>>'{delays,repeatEvery}')::integer
    ),
    'policies',v_settings->>'policies',
    'finished_product_shelf_days',6,'mixture_shelf_days',5
  );

  select version into v_before from public.configuration_sync_state where id=1;
  v_response:=public.guardar_configuracion_v2(jsonb_build_object(
    'idempotency_key',v_key,'expected_version',v_before::text,'payload',v_payload));
  select version into v_after from public.configuration_sync_state where id=1;
  assert v_after>v_before
    and v_response->>'contract'='momos.configuration-mutation.v2'
    and (v_response->>'duplicate')::boolean=false
    and (v_response#>>'{snapshot,settings,finishedProductShelfDays}')::integer=6
    and (v_response#>>'{snapshot,settings,mixtureShelfDays}')::integer=5,
    'guardar_configuracion_v2 no confirmó 6/5 desde el mismo commit';
  v_repeat:=public.guardar_configuracion_v2(jsonb_build_object(
    'idempotency_key',v_key,'expected_version',v_before::text,'payload',v_payload));
  assert (v_repeat->>'duplicate')::boolean=true
    and v_repeat-'duplicate'=v_response-'duplicate'
    and (select version from public.configuration_sync_state where id=1)=v_after,
    'reintento v2 repitió efectos';
  begin
    perform public.guardar_configuracion_v2(jsonb_build_object(
      'idempotency_key','83000000-0000-4000-8000-000000000099',
      'expected_version',v_after::text,'payload',jsonb_set(v_payload,'{mixture_shelf_days}','31'::jsonb)));
  exception when others then v_failed:=true; end;
  assert v_failed,'Configuración v2 aceptó más de 30 días';
end $$;

reset role;

do $$
declare
  v_product text; v_batch text; v_item text; v_note text; v_lot public.inventory_lots%rowtype;
  v_base date; v_expiry date; v_days integer;
begin

  select id into v_product from public.products where tipo='momo' and activo order by id limit 1;
  v_batch:=public.next_id('batch','L-',3);
  insert into public.production_batches(id,fecha,product_id,figura,sabor,gramaje_g,prod,perfectas,imperfectas,descartadas,estado,stock_contabilizado)
  values(v_batch,current_date,v_product,'Prueba H83','Prueba H83',180,1,0,0,0,'En preparación',false);
  update public.production_batches set perfectas=1,estado='Listo',stock_contabilizado=true where id=v_batch;
  select (desmoldado_en at time zone 'America/Bogota')::date,vence,vida_util_dias into v_base,v_expiry,v_days
  from public.production_batches where id=v_batch;
  assert v_days=6 and v_expiry=v_base+6,'producto nuevo no selló 6 días';
  update public.app_settings set valor=to_jsonb(7::integer) where clave='vida_util_producto_terminado_dias';
  update public.production_batches set obs='edición inocua' where id=v_batch;
  assert (select vida_util_dias=6 and vence=v_base+6 from public.production_batches where id=v_batch),'cambio de configuración rejuveneció un lote sellado';

  select sr.item_id into v_item from public.subrecetas sr where sr.activo order by sr.id limit 1;
  v_note:='Producción subreceta SP-H83-'||pg_backend_pid();
  perform public._add_movement('Entrada',v_item,0.001,v_note,null,null);
  select l.* into v_lot
  from public.inventory_lots l
  join public.inventory_movements m on m.id=l.source_movement_id
  where l.item_id=v_item and m.nota=v_note
  order by m.id desc limit 1;
  assert v_lot.id is not null and v_lot.vida_util_dias=5
    and v_lot.expires_at=(clock_timestamp() at time zone 'America/Bogota')::date+5,
    'mezcla nueva no selló 5 días';
  assert not has_table_privilege('authenticated','public.configuration_v2_mutation_receipts','SELECT'),'recibos v2 expuestos';
end $$;

select 'TESTS_OK — vida útil configurable 6/5, sellado por lote, Configuración v2 y RBAC PASS; rollback total' as resultado;
rollback;
