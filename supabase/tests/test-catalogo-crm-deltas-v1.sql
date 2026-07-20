-- MOMOS OPS · prueba adversarial H74. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_catalogo_crm_deltas_20260719'));

do $$
declare v_actor_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_74_catalogo_crm_deltas'),
    'Falta aplicar H74.';
  assert to_regclass('public.product_catalog_sync_versions') is not null
    and to_regclass('public.customer_crm_sync_versions') is not null
    and to_regclass('public.catalog_crm_delta_receipts') is not null
    and to_regprocedure('public.momos_product_catalog_deltas_v1(text[])') is not null
    and to_regprocedure('public.momos_customer_crm_deltas_v1(text[])') is not null
    and to_regprocedure('public.mutar_catalogo_crm_delta(jsonb)') is not null,
    'Falta una pieza del contrato H74.';
  assert has_function_privilege('authenticated','public.momos_product_catalog_deltas_v1(text[])','EXECUTE')
    and has_function_privilege('authenticated','public.momos_customer_crm_deltas_v1(text[])','EXECUTE')
    and has_function_privilege('authenticated','public.mutar_catalogo_crm_delta(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.mutar_catalogo_crm_delta(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.mutar_catalogo_crm_delta(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_catalog_crm_mutation_response_v1(text,text,boolean,jsonb,text,text[])','EXECUTE'),
    'H74 abrió la frontera RBAC de sus funciones.';
  assert has_table_privilege('authenticated','public.product_catalog_sync_versions','SELECT')
    and has_table_privilege('authenticated','public.customer_crm_sync_versions','SELECT')
    and not has_table_privilege('authenticated','public.product_catalog_sync_versions','INSERT')
    and not has_table_privilege('authenticated','public.customer_crm_sync_versions','UPDATE')
    and not has_table_privilege('authenticated','public.catalog_crm_delta_receipts','SELECT')
    and not has_table_privilege('service_role','public.catalog_crm_delta_receipts','SELECT'),
    'H74 expuso escritura del outbox o los recibos privados.';
  assert (select array_agg(a.attname::text order by a.attnum)
    from pg_attribute a where a.attrelid='public.product_catalog_sync_versions'::regclass
      and a.attnum>0 and not a.attisdropped)=array['product_id','version','changed_at'],
    'El outbox de Catálogo expuso detalle o identidad.';
  assert (select array_agg(a.attname::text order by a.attnum)
    from pg_attribute a where a.attrelid='public.customer_crm_sync_versions'::regclass
      and a.attnum>0 and not a.attisdropped)=array['customer_id','version','changed_at'],
    'El outbox CRM expuso PII o detalle de actividad.';
  assert (select count(*)=3 from pg_trigger t where t.tgname='momos_product_catalog_sync_touch'
    and not t.tgisinternal and t.tgrelid=any(array[
      'public.products'::regclass,'public.combo_components'::regclass,'public.recipes'::regclass
    ])), 'H74 no cubre las tres fuentes del Catálogo.';
  assert (select count(*)=5 from pg_trigger t where t.tgname='momos_customer_crm_sync_touch'
    and not t.tgisinternal and t.tgrelid=any(array[
      'public.customers'::regclass,'public.customer_crm_profiles'::regclass,
      'public.customer_contacts'::regclass,'public.customer_activations'::regclass,'public.benefits'::regclass
    ])), 'H74 no cubre las cinco fuentes CRM.';
  select u.auth_id into v_actor_auth from public.users u
  where u.activo and u.auth_id is not null and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  assert v_actor_auth is not null,'Falta un Administrador autenticado para H74.';
  perform set_config('momos.h74_actor_auth',v_actor_auth::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h74_actor_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_category text;
  v_first jsonb;
  v_repeat jsonb;
  v_delta jsonb;
  v_product_id text;
  v_customer_id text;
  v_phone text:='311'||right('0000000'||pg_backend_pid()::text,7);
  v_count integer;
  v_failed boolean:=false;
begin
  assert public.catalogo_crm_deltas_disponibles(),
    'La capability H74 no quedó cerrada por migración y staff.';
  select pc.nombre into v_category from public.product_cats pc where pc.activo order by pc.nombre limit 1;
  assert v_category is not null,'Falta una categoría activa para la prueba H74.';

  v_first:=public.mutar_catalogo_crm_delta(jsonb_build_object(
    'operation','crear_producto','idempotency_key','test-h74-product-'||pg_backend_pid(),
    'payload',jsonb_build_object(
      'nombre','Producto delta '||pg_backend_pid(),'cat',v_category,'tipo','pedido','especie',null,
      'precio',12000,'precio_rappi',15000,'costo',4000,'prep',5,'frio',false,'lejano',true,
      'descr','Prueba con rollback','combo_size',null,'component_product_ids','[]'::jsonb,
      'empaque_item_id',null,'colchon_produccion',0
    )
  ));
  assert (select array_agg(k order by k) from jsonb_object_keys(v_first) keys(k))=
    array['catalog','containsCustomerPii','containsSecrets','contract','crm','duplicate','externalExecution','idempotencyKey','operation','result'],
    'La mutación H74 expuso claves fuera del contrato.';
  assert v_first->>'contract'='momos.catalog-crm-mutation.v1'
    and v_first->>'operation'='crear_producto'
    and (v_first->>'duplicate')::boolean=false
    and (v_first->>'containsCustomerPii')::boolean=false
    and (v_first->>'containsSecrets')::boolean=false
    and (v_first->>'externalExecution')::boolean=false
    and v_first->'crm'='null'::jsonb
    and v_first->'catalog'->>'contract'='momos.product-catalog-delta-batch.v1',
    'Crear producto no devolvió un delta de Catálogo protegido.';
  v_product_id:=v_first->'result'->>'product_id';
  assert v_product_id is not null
    and exists(select 1 from jsonb_array_elements(v_first->'catalog'->'deltas') d where d->>'productId'=v_product_id),
    'El delta de Catálogo no contiene el producto creado.';
  assert position('telefono' in lower((v_first->'catalog')::text))=0
    and position('direccion' in lower((v_first->'catalog')::text))=0
    and position('auth_id' in lower((v_first->'catalog')::text))=0,
    'El Catálogo H74 expuso PII.';
  select count(*) into v_count from public.products where id=v_product_id;
  v_repeat:=public.mutar_catalogo_crm_delta(jsonb_build_object(
    'operation','crear_producto','idempotency_key','test-h74-product-'||pg_backend_pid(),
    'payload',jsonb_build_object(
      'nombre','Producto delta '||pg_backend_pid(),'cat',v_category,'tipo','pedido','especie',null,
      'precio',12000,'precio_rappi',15000,'costo',4000,'prep',5,'frio',false,'lejano',true,
      'descr','Prueba con rollback','combo_size',null,'component_product_ids','[]'::jsonb,
      'empaque_item_id',null,'colchon_produccion',0
    )
  ));
  assert (v_repeat->>'duplicate')::boolean=true
    and v_repeat->'result'=v_first->'result'
    and (select count(*) from public.products where id=v_product_id)=v_count,
    'El replay de Catálogo repitió efectos o cambió el resultado.';
  v_failed:=false;
  begin
    perform public.mutar_catalogo_crm_delta(jsonb_build_object(
      'operation','crear_producto','idempotency_key','test-h74-product-'||pg_backend_pid(),
      'payload',jsonb_build_object('nombre','Otro contrato')
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H74 aceptó reutilizar la llave de Catálogo con otro contrato.';

  v_delta:=public.momos_product_catalog_deltas_v1(array[v_product_id]);
  assert jsonb_array_length(v_delta->'deltas')=1
    and (select array_agg(k order by k) from jsonb_object_keys(v_delta) keys(k))=
      array['containsCustomerPii','containsSecrets','contract','deltas','externalExecution'],
    'La lectura dirigida de Catálogo no es cerrada o exacta.';

  v_first:=public.mutar_catalogo_crm_delta(jsonb_build_object(
    'operation','upsert_cliente','idempotency_key','test-h74-customer-'||pg_backend_pid(),
    'payload',jsonb_build_object(
      'customer_id','','nombre','Cliente delta','telefono',v_phone,'instagram','','canal','WhatsApp',
      'barrio','Caney','direccion','Dirección privada','cumple','','favoritos','Momo','estado','Nuevo','notas','Nota privada'
    )
  ));
  v_customer_id:=v_first->'result'->>'customer_id';
  assert v_customer_id is not null
    and (v_first->>'containsCustomerPii')::boolean=true
    and v_first->'catalog'='null'::jsonb
    and v_first->'crm'->>'contract'='momos.customer-crm-delta-batch.v1'
    and v_first->'crm'->>'scope'='staff-private'
    and exists(select 1 from jsonb_array_elements(v_first->'crm'->'deltas') d where d->>'customerId'=v_customer_id),
    'Crear cliente no devolvió su delta CRM privado exacto.';
  assert position(v_phone in v_first::text)>0
    and position('auth_id' in lower(v_first::text))=0
    and position('email' in lower(v_first::text))=0
    and position('storage_path' in lower(v_first::text))=0,
    'El delta CRM perdió PII necesaria o expuso identidad técnica/secretos.';

  v_first:=public.mutar_catalogo_crm_delta(jsonb_build_object(
    'operation','guardar_preferencias_cliente','idempotency_key','test-h74-prefs-'||pg_backend_pid(),
    'payload',jsonb_build_object('customer_id',v_customer_id,'contact_allowed',true,
      'preferred_channel','WhatsApp','acquisition_source','Prueba H74','contact_reason','')
  ));
  assert exists(select 1 from jsonb_array_elements(v_first->'crm'->'deltas') d
    where d->>'customerId'=v_customer_id and d->'profile'->>'acquisitionSource'='Prueba H74'),
    'Preferencias no devolvió la ficha CRM del mismo commit.';

  v_first:=public.mutar_catalogo_crm_delta(jsonb_build_object(
    'operation','registrar_contacto_cliente','idempotency_key','test-h74-contact-'||pg_backend_pid(),
    'payload',jsonb_build_object('customer_id',v_customer_id,'channel','WhatsApp',
      'reason','Seguimiento delta','outcome','Enviado','notes','Privada','follow_up_on','')
  ));
  select count(*) into v_count from public.customer_contacts where customer_id=v_customer_id;
  v_repeat:=public.mutar_catalogo_crm_delta(jsonb_build_object(
    'operation','registrar_contacto_cliente','idempotency_key','test-h74-contact-'||pg_backend_pid(),
    'payload',jsonb_build_object('customer_id',v_customer_id,'channel','WhatsApp',
      'reason','Seguimiento delta','outcome','Enviado','notes','Privada','follow_up_on','')
  ));
  assert (v_repeat->>'duplicate')::boolean=true
    and (select count(*) from public.customer_contacts where customer_id=v_customer_id)=v_count,
    'El replay CRM duplicó el contacto.';

  v_failed:=false;
  begin
    perform public.mutar_catalogo_crm_delta(jsonb_build_object(
      'operation','upsert_cliente','idempotency_key','test-h74-extra-'||pg_backend_pid(),
      'payload',jsonb_build_object('customer_id',v_customer_id,'nombre','Cliente delta','telefono',v_phone,'secret','x')
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H74 aceptó un campo fuera del contrato cerrado.';
end $$;

reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare v_failed boolean:=false;
begin
  begin perform public.momos_product_catalog_deltas_v1(array['PR01']);
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo leer deltas de Catálogo.';
  v_failed:=false;
  begin perform public.momos_customer_crm_deltas_v1(array['C01']);
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo leer PII CRM.';
end $$;

reset role;
select 'TESTS_OK — Catálogo/CRM deltas/idempotencia/privacidad/outbox/RBAC PASS, rollback total' as resultado;
rollback;
