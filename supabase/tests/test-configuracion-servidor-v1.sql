-- MOMOS OPS · prueba adversarial H76 Configuración autoritativa. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_configuracion_servidor_20260719'));

do $$
declare v_admin_auth uuid; v_staff_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_76_configuracion_servidor'),
    'Falta aplicar H76.';
  assert to_regclass('public.configuration_sync_state') is not null
    and to_regclass('public.configuration_mutation_receipts') is not null
    and to_regprocedure('public.momos_configuration_snapshot_v1()') is not null
    and to_regprocedure('public.guardar_configuracion_v1(jsonb)') is not null,
    'Falta una pieza del contrato H76.';
  assert has_function_privilege('authenticated','public.momos_configuration_snapshot_v1()','EXECUTE')
    and has_function_privilege('authenticated','public.guardar_configuracion_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.momos_configuration_snapshot_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.guardar_configuracion_v1(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public._touch_configuration_sync_state()','EXECUTE'),
    'H76 abrió la frontera RBAC de sus funciones.';
  assert has_table_privilege('authenticated','public.configuration_sync_state','SELECT')
    and not has_table_privilege('authenticated','public.configuration_sync_state','INSERT')
    and not has_table_privilege('authenticated','public.configuration_sync_state','UPDATE')
    and not has_table_privilege('authenticated','public.configuration_mutation_receipts','SELECT')
    and not has_table_privilege('service_role','public.configuration_mutation_receipts','SELECT'),
    'H76 expuso escritura del outbox o los recibos privados.';
  assert (select array_agg(a.attname::text order by a.attnum)
    from pg_attribute a where a.attrelid='public.configuration_sync_state'::regclass
      and a.attnum>0 and not a.attisdropped)=array['id','version','changed_at']::text[],
    'El outbox de Configuración expuso detalle, actor o PII.';
  assert (select count(*) from pg_trigger t
    where not t.tgisinternal and t.tgname like 'configuration_sync_touch_%')=7,
    'H76 no cubre las siete fuentes autoritativas de Configuración.';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert exists(select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='configuration_sync_state'),
      'Realtime no incluye el outbox compacto de Configuración.';
  end if;
  assert position('configuracion_servidor_disponible' in pg_get_functiondef(
    'public.momos_sync_manifest_v1()'::regprocedure))>0,
    'El manifiesto de Data Sync no anuncia H76.';

  select u.auth_id into v_admin_auth from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  select u.auth_id into v_staff_auth from public.users u
  where u.activo and u.auth_id is not null
    and not ('Administrador'=any(coalesce(u.roles,array[u.rol])))
  order by u.id limit 1;
  assert v_admin_auth is not null and v_staff_auth is not null,
    'Falta Administrador y staff no Administrador para H76.';
  perform set_config('momos.h76_admin_auth',v_admin_auth::text,true);
  perform set_config('momos.h76_staff_auth',v_staff_auth::text,true);
end $$;

-- Staff autenticado no puede leer ni mutar Configuración administrativa.
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h76_staff_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_configuration_snapshot_v1();
  exception when sqlstate '42501' then v_failed:=true; end;
  assert v_failed,'Un usuario no Administrador pudo leer Configuración.';
  v_failed:=false;
  begin perform public.guardar_configuracion_v1(jsonb_build_object(
    'idempotency_key','76000000-0000-4000-8000-000000000099','expected_version','1','payload','{}'::jsonb));
  exception when sqlstate '42501' then v_failed:=true; end;
  assert v_failed,'Un usuario no Administrador pudo mutar Configuración.';
end $$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h76_admin_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_snapshot jsonb; v_settings jsonb; v_payload jsonb; v_first jsonb; v_repeat jsonb;
  v_before bigint; v_after bigint; v_min numeric;
  v_key text:='76000000-0000-4000-8000-'||lpad(pg_backend_pid()::text,12,'0');
  v_failed boolean:=false;
begin
  assert public.configuracion_servidor_disponible(),
    'La capability H76 no quedó cerrada por migración y Administrador.';
  v_snapshot:=public.momos_configuration_snapshot_v1();
  v_settings:=v_snapshot->'settings';
  assert (select array_agg(k order by k) from jsonb_object_keys(v_snapshot) keys(k))=
    array['activity','containsCustomerPii','containsFreeText','containsSecrets','containsStaffPii',
      'containsStorageReferences','contract','externalExecution','figureProductChoices',
      'inventoryChoices','serverTime','settings','snapshotVersion','staff','version'],
    'El snapshot H76 expuso una colección fuera del contrato compacto.';
  assert (select array_agg(k order by k) from jsonb_object_keys(v_settings) keys(k))=
    array['catalogs','delays','figures','fixedFilling','freezingHours','orderMinimum','policies','toppings','zones'],
    'El snapshot H76 expuso una configuración fuera del contrato.';
  assert v_snapshot->>'contract'='momos.configuration-snapshot.v1'
    and (v_snapshot->>'version')::integer=1
    and (v_snapshot->>'snapshotVersion')::bigint>0
    and coalesce((v_snapshot->>'containsCustomerPii')::boolean,true)=false
    and coalesce((v_snapshot->>'containsStaffPii')::boolean,false)=true
    and coalesce((v_snapshot->>'containsFreeText')::boolean,false)=true
    and coalesce((v_snapshot->>'containsStorageReferences')::boolean,true)=false
    and coalesce((v_snapshot->>'containsSecrets')::boolean,true)=false
    and coalesce((v_snapshot->>'externalExecution')::boolean,true)=false,
    'H76 no selló versión, privacidad o no ejecución.';
  assert v_snapshot::text !~* 'auth_id|service[_-]?role|access[_-]?token|refresh[_-]?token|storage[_-]?path|signed[_-]?url',
    'El snapshot H76 expuso identidad técnica, secreto o ruta de Storage.';

  select coalesce(jsonb_agg(jsonb_build_object(
    'name',x->>'name','species',x->>'species','grams',(x->>'grams')::integer,'product_id',x->>'productId'
  ) order by x->>'name'),'[]'::jsonb) into v_payload
  from jsonb_array_elements(v_settings->'figures') x where (x->>'active')::boolean;
  v_min:=(v_settings->>'orderMinimum')::numeric+1;
  v_payload:=jsonb_build_object(
    'zones',v_settings->'zones',
    'catalogs',jsonb_build_object(
      'fruit_flavors',v_settings#>'{catalogs,fruitFlavors}',
      'creamy_flavors',v_settings#>'{catalogs,creamyFlavors}',
      'sauces',v_settings#>'{catalogs,sauces}',
      'payments',v_settings#>'{catalogs,payments}',
      'delivery_providers',v_settings#>'{catalogs,deliveryProviders}'
    ),
    'fixed_filling',v_settings->>'fixedFilling',
    'figures',v_payload,
    'toppings',coalesce((select jsonb_agg(jsonb_build_object(
      'name',x->>'name','price',(x->>'price')::numeric,
      'inventory_item_id',x->>'inventoryItemId','inventory_quantity',(x->>'inventoryQuantity')::numeric
    ) order by x->>'name') from jsonb_array_elements(v_settings->'toppings') x where (x->>'active')::boolean),'[]'::jsonb),
    'order_minimum',v_min,'freezing_hours',(v_settings->>'freezingHours')::integer,
    'delays',jsonb_build_object(
      'kitchen_warning',(v_settings#>>'{delays,kitchenWarning}')::integer,
      'kitchen_urgent',(v_settings#>>'{delays,kitchenUrgent}')::integer,
      'packing_warning',(v_settings#>>'{delays,packingWarning}')::integer,
      'packing_urgent',(v_settings#>>'{delays,packingUrgent}')::integer,
      'repeat_every',(v_settings#>>'{delays,repeatEvery}')::integer
    ),
    'policies',v_settings->>'policies'
  );

  select version into v_before from public.configuration_sync_state where id=1;
  v_first:=public.guardar_configuracion_v1(jsonb_build_object(
    'idempotency_key',v_key,'expected_version',v_before::text,'payload',v_payload));
  select version into v_after from public.configuration_sync_state where id=1;
  assert v_after>v_before
    and v_first->>'contract'='momos.configuration-mutation.v1'
    and (v_first->>'duplicate')::boolean=false
    and (v_first#>>'{snapshot,snapshotVersion}')::bigint=v_after
    and (v_first#>>'{snapshot,settings,orderMinimum}')::numeric=v_min,
    'Guardar Configuración no devolvió el snapshot exacto del mismo commit.';

  v_repeat:=public.guardar_configuracion_v1(jsonb_build_object(
    'idempotency_key',v_key,'expected_version',v_before::text,'payload',v_payload));
  assert (v_repeat->>'duplicate')::boolean=true
    and v_repeat-'duplicate'=v_first-'duplicate'
    and (select version from public.configuration_sync_state where id=1)=v_after,
    'El replay de Configuración repitió efectos o cambió el resultado.';

  begin perform public.guardar_configuracion_v1(jsonb_build_object(
    'idempotency_key',v_key,'expected_version',v_after::text,
    'payload',jsonb_set(v_payload,'{order_minimum}',to_jsonb(v_min+1))));
  exception when others then v_failed:=true; end;
  assert v_failed,'H76 aceptó reutilizar la llave con otra Configuración.';
  v_failed:=false;
  begin perform public.guardar_configuracion_v1(jsonb_build_object(
    'idempotency_key','76000000-0000-4000-8000-000000000098','expected_version',v_before::text,'payload',v_payload));
  exception when sqlstate '40001' then v_failed:=true; end;
  assert v_failed,'H76 permitió sobrescribir silenciosamente una versión más nueva.';
  v_failed:=false;
  begin perform public.guardar_configuracion_v1(jsonb_build_object(
    'idempotency_key','76000000-0000-4000-8000-000000000097','expected_version',v_after::text,
    'payload',v_payload,'secret','x'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H76 aceptó un campo fuera del contrato cerrado.';
  v_failed:=false;
  begin perform public.guardar_configuracion_v1(jsonb_build_object(
    'idempotency_key','76000000-0000-4000-8000-000000000096','expected_version',v_after::text,
    'payload',jsonb_set(v_payload,'{catalogs,payments}',jsonb_build_array('Nequi','Efectivo'))));
  exception when others then v_failed:=true; end;
  assert v_failed,'H76 permitió Efectivo como método de pago.';
  v_failed:=false;
  begin update public.zonas set tarifa=tarifa; exception when sqlstate '42501' then v_failed:=true; end;
  assert v_failed,'Un Administrador autenticado pudo saltarse la RPC y escribir Configuración directo.';
end $$;

reset role;

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_configuration_snapshot_v1();
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo consultar Configuración.';
end $$;
reset role;

select 'TESTS_OK — Configuración snapshot/versión/idempotencia/RBAC/privacidad PASS, rollback total' as resultado;
rollback;
