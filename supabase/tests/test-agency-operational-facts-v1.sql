-- MOMOS OPS · prueba adversarial H67 Hechos operativos compactos de Agencia.
-- Siempre ROLLBACK: no deja sentinelas, actores ni cambios de prueba.

begin;
-- El contrato no puede depender del TimeZone de quien ejecuta la prueba.
set local timezone='Pacific/Kiritimati';

do $$
declare
  v_sources text[];
  v_definition text;
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_67_agency_operational_facts'
  ), 'Falta aplicar H67.';
  assert to_regprocedure('public.momos_agency_snapshots_v2()') is not null,
    'Falta el bundle H67.';
  assert to_regprocedure('public._momos_agency_operational_facts_payload_v1()') is not null
    and to_regprocedure('public._momos_agency_operational_facts_envelope_v1(bigint,timestamp with time zone)') is not null
    and to_regprocedure('public._momos_agency_operational_source_tables_v1()') is not null,
    'Falta un helper H67.';

  assert has_function_privilege('authenticated','public.momos_agency_snapshots_v2()','EXECUTE')
    and not has_function_privilege('anon','public.momos_agency_snapshots_v2()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_agency_snapshots_v2()','EXECUTE'),
    'H67 perdio la frontera authenticated.';
  assert not has_function_privilege('authenticated','public._momos_agency_operational_facts_payload_v1()','EXECUTE')
    and not has_function_privilege('service_role','public._momos_agency_operational_facts_payload_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_agency_operational_facts_envelope_v1(bigint,timestamp with time zone)','EXECUTE')
    and not has_function_privilege('service_role','public._momos_agency_operational_facts_envelope_v1(bigint,timestamp with time zone)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_agency_operational_source_tables_v1()','EXECUTE')
    and not has_function_privilege('service_role','public._momos_agency_operational_source_tables_v1()','EXECUTE'),
    'Un helper interno H67 quedo expuesto.';

  assert exists(
    select 1 from pg_proc p
    where p.oid='public.momos_agency_snapshots_v2()'::regprocedure
      and p.provolatile='s' and p.prosecdef
      and array_to_string(p.proconfig,'|') like '%search_path=pg_catalog, public, pg_temp%'
  ), 'El bundle H67 no es STABLE SECURITY DEFINER con search_path cerrado.';
  assert exists(
    select 1 from pg_proc p
    where p.oid='public._momos_agency_operational_facts_payload_v1()'::regprocedure
      and p.provolatile='s' and p.prosecdef
      and array_to_string(p.proconfig,'|') like '%search_path=pg_catalog, public, pg_temp%'
      and lower(array_to_string(p.proconfig,'|')) like '%timezone=america/bogota%'
  ), 'El payload H67 no es STABLE SECURITY DEFINER con search_path cerrado.';
  v_definition:=pg_get_functiondef('public._momos_agency_operational_facts_payload_v1()'::regprocedure);
  assert v_definition !~* 'storage_path|signed_url|external_account_id|last_error'
    and v_definition !~* '[.]obs([,[:space:]]|$)|[.]notas([,[:space:]]|$)|[.]proveedor([,[:space:]]|$)',
    'El SQL H67 proyecta una columna libre, PII, ruta o secreto.';
  assert position('america/bogota' in lower(v_definition))>0
    and position('current_date' in lower(v_definition))=0,
    'H67 depende del TimeZone de sesion en vez del dia negocio America/Bogota.';
  assert position('all_commercial_lines as materialized' in lower(v_definition))>0
    and position('where oi.order_id=po.id and oi.parent_item_id is null' in lower(v_definition))=0,
    'El resumen historico H67 regreso a una lectura N+1 por pedido.';
  assert position('left join lateral' in lower(v_definition))=0,
    'H67 regreso a una busqueda LATERAL por cada variante.';
  assert position('current_user_has_any_role' in pg_get_functiondef('public.momos_agency_snapshots_v2()'::regprocedure))>0
    and position('Administrador' in pg_get_functiondef('public.momos_agency_snapshots_v2()'::regprocedure))>0
    and position('Marketing/CRM' in pg_get_functiondef('public.momos_agency_snapshots_v2()'::regprocedure))>0,
    'H67 perdio su gate o matriz de roles.';

  v_sources:=public._momos_agency_operational_source_tables_v1();
  assert cardinality(v_sources)=13,
    'H67 cambio la lista cerrada de fuentes sin versionar su contrato.';
  assert array[
    'products','combo_components','inventory_items','inventory_lots','recipes',
    'orders','order_items','production_suggestions','production_batches',
    'lote_figuras','subrecetas','customers','customer_crm_profiles'
  ]::text[] <@ v_sources,
    'H67 no invalida todos sus hechos operativos y segmentos agregados.';
  assert 'content_posts'=any(public._momos_agency_snapshot_source_tables_v1()),
    'El calendario/atribucion por post H67 no invalida el singleton mediante H66.';
  assert not exists(
    select 1 from unnest(v_sources) s(table_name)
    where to_regclass(format('public.%I',s.table_name)) is null
  ), 'H67 contiene una fuente inexistente.';
  assert not exists(
    select 1 from unnest(v_sources) s(table_name)
    where not exists(
      select 1 from pg_trigger t
      where t.tgrelid=to_regclass(format('public.%I',s.table_name))
        and t.tgname='momos_agency_operational_event_v1'
        and not t.tgisinternal
        and t.tgfoid='public._momos_touch_agency_snapshot_event_v1()'::regprocedure
        and (t.tgtype::integer & 1)=0
        and (t.tgtype::integer & 60)=60
    )
  ), 'Una fuente H67 no invalida el singleton una vez por sentencia.';
  assert exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename='agency_snapshot_events'
  ) or not exists(select 1 from pg_publication where pubname='supabase_realtime'),
    'H67 no conserva el evento sanitizado para Realtime.';
end $$;

-- Un perfil permitido solo entra en CRM si el dato del canal elegido existe.
-- La ventana cumpleaños es exactamente hoy..hoy+6 (7 dias inclusivos).
do $$
declare
  v_customer text:='TEST-H67-CRM-'||txid_current()::text;
  v_phone text:='TEST-H67-PHONE-'||txid_current()::text;
  v_business_date date:=(statement_timestamp() at time zone 'America/Bogota')::date;
  v_without_contact jsonb;
  v_with_contact jsonb;
begin
  insert into public.customers(
    id,nombre,telefono,instagram,canal,primera,ultima,cumple,estado
  ) values(
    v_customer,'Prueba H67 canal',v_phone,'','Directo',
    v_business_date-60,v_business_date-31,to_char(v_business_date+6,'MM-DD'),'Inactivo'
  );
  insert into public.customer_crm_profiles(
    customer_id,contact_allowed,preferred_channel,acquisition_source
  ) values(v_customer,true,'Instagram','TEST-H67');

  v_without_contact:=public._momos_agency_operational_facts_payload_v1();
  update public.customers set instagram='H67-INSTAGRAM-CONTACTO' where id=v_customer;
  v_with_contact:=public._momos_agency_operational_facts_payload_v1();

  assert (v_with_contact#>>'{crm_segments,birthdays_7d}')::bigint
      =(v_without_contact#>>'{crm_segments,birthdays_7d}')::bigint+1
    and (v_with_contact#>>'{crm_segments,dormant_30d}')::bigint
      =(v_without_contact#>>'{crm_segments,dormant_30d}')::bigint+1,
    'CRM conto un perfil sin el dato del canal o no respeto hoy..hoy+6.';
  assert v_with_contact::text !~* 'H67-INSTAGRAM-CONTACTO|TEST-H67-PHONE-|Prueba H67 canal',
    'CRM expuso el dato de contacto usado solo para contar.';
end $$;

-- Inyecta secretos y PII exclusivamente en columnas que H67 debe ignorar.
-- Cada sentencia fuente debe tocar una vez el singleton compartido.
do $$
declare
  v_actor public.users%rowtype;
  v_product text;
  v_item text;
  v_customer text;
  v_before bigint;
  v_after bigint;
begin
  select * into v_actor from public.users
  where activo and auth_id is not null
    and coalesce(roles,array[rol]) && array['Administrador','Marketing/CRM']::text[]
  order by case when 'Administrador'=any(coalesce(roles,array[rol])) then 0 else 1 end,id limit 1;
  assert v_actor.id is not null, 'Falta actor H67 de Agencia.';
  select id into v_product from public.products order by id limit 1;
  select id into v_item from public.inventory_items order by id limit 1;
  select id into v_customer from public.customers order by id limit 1;
  assert v_product is not null and v_item is not null and v_customer is not null,
    'Falta producto, insumo o cliente independiente para H67.';

  select version into v_before from public.agency_snapshot_events where id=true;
  update public.products set descr='H67-PII-NOTA-PRODUCTO' where id=v_product;
  update public.inventory_items set proveedor='H67-SECRET-PROVEEDOR' where id=v_item;
  update public.customers set notas='H67-PII-CLIENTE',direccion='H67-DIRECCION-PRIVADA' where id=v_customer;
  select version into v_after from public.agency_snapshot_events where id=true;
  assert v_after=v_before+3,
    'Las tres fuentes H67 no tocaron exactamente una vez el singleton.';
  perform set_config('momos.h67_actor_auth',v_actor.auth_id::text,true);
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',current_setting('momos.h67_actor_auth'),'role','authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_bundle jsonb;
  v_again jsonb;
  v_facts jsonb;
  v_payload jsonb;
  v_source bigint;
  v_time text;
  v_decisions bigint;
  v_jobs bigint;
  v_business_date date:=(statement_timestamp() at time zone 'America/Bogota')::date;
  v_limit_key text;
  v_collections jsonb;
  v_expected_payload_keys text[]:=array[
    'as_of','business_timezone','calendar','campaign_attribution','contract_version','counts',
    'creative_attribution','crm_segments','facts_ready','limits','paid_summary','product_catalog',
    'product_sales_30d','production','published_post_attribution','summary','truncated','window_days'
  ];
begin
  select count(*) into v_decisions from public.agency_decisions;
  select count(*) into v_jobs from public.creative_generation_jobs;

  v_bundle:=public.momos_agency_snapshots_v2();
  v_again:=public.momos_agency_snapshots_v2();
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_bundle) keys(k)
  )=array['agency_operational_facts','contract','server_time','snapshots','source_version','version'],
    'El bundle H67 expuso claves fuera de contrato.';
  assert (v_bundle->>'version')::integer=2
    and v_bundle->>'contract'='momos-agency-snapshots/v2'
    and jsonb_typeof(v_bundle->'snapshots')='array'
    and jsonb_array_length(v_bundle->'snapshots')=4,
    'H67 no conserva los cuatro scopes H66 dentro del bundle V2.';

  v_source:=(v_bundle->>'source_version')::bigint;
  v_time:=v_bundle->>'server_time';
  v_facts:=v_bundle->'agency_operational_facts';
  v_payload:=v_facts#>'{payload,agency_operational_facts}';
  assert (v_facts->>'version')::integer=1
    and v_facts->>'contract'='momos-agency-operational-facts/v1'
    and (v_facts->>'source_version')::bigint=v_source
    and v_facts->>'server_time'=v_time
    and v_facts->>'event_id'=md5('operational-facts:'||v_source::text)
    and (v_again#>>'{agency_operational_facts,event_id}')=v_facts->>'event_id',
    'Los hechos H67 no comparten version, reloj o cursor con H66.';
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_facts->'payload') keys(k)
  )=array['agency_operational_facts'],
    'El sobre H67 no expone la clave canonica agency_operational_facts.';
  assert not exists(
    select 1 from jsonb_array_elements(v_bundle->'snapshots') s(row)
    where (s.row->>'source_version')::bigint<>v_source or s.row->>'server_time'<>v_time
  ), 'Un scope H66 discrepa del corte H67.';

  assert v_facts#>>'{privacy,projection}'='agency-operational-facts-v1'
    and coalesce((v_facts#>>'{privacy,customer_records_projected}')::boolean,true)=false
    and coalesce((v_facts#>>'{privacy,order_records_projected}')::boolean,true)=false
    and coalesce((v_facts#>>'{privacy,free_text_projected}')::boolean,true)=false
    and coalesce((v_facts#>>'{privacy,secrets_projected}')::boolean,true)=false
    and coalesce((v_facts#>>'{privacy,storage_references_projected}')::boolean,true)=false
    and coalesce((v_facts#>>'{authority,read_only}')::boolean,false)=true
    and coalesce((v_facts#>>'{authority,external_execution}')::boolean,true)=false,
    'H67 perdio privacidad o autoridad de solo lectura.';
  assert coalesce((v_payload->>'facts_ready')::boolean,false)
    and (v_payload->>'contract_version')::integer=1
    and v_payload->>'as_of'=v_business_date::text
    and v_payload->>'business_timezone'='America/Bogota'
    and (v_payload#>>'{window_days,crm_birthdays}')::integer=7
    and (v_payload#>>'{window_days,crm_birthdays_inclusive_end_offset}')::integer=6,
    'El payload H67 no declara readiness, version o corte.';

  assert (select count(*) from jsonb_object_keys(v_payload))=cardinality(v_expected_payload_keys)
    and v_payload ?& v_expected_payload_keys,
    'H67 expuso una coleccion o detalle fuera del contrato compacto.';

  assert jsonb_typeof(v_payload->'product_catalog')='array'
    and jsonb_typeof(v_payload->'product_sales_30d')='array'
    and jsonb_typeof(v_payload->'paid_summary')='object'
    and jsonb_typeof(v_payload->'campaign_attribution')='array'
    and jsonb_typeof(v_payload->'creative_attribution')='array'
    and jsonb_typeof(v_payload->'published_post_attribution')='array'
    and jsonb_typeof(v_payload->'crm_segments')='object'
    and jsonb_typeof(v_payload->'calendar')='object'
    and jsonb_typeof(v_payload->'production')='object'
    and jsonb_typeof(v_payload#>'{production,critical_preparations}')='array',
    'H67 no cierra catalogo, ventas, atribucion, CRM, calendario o Produccion.';
  assert (v_payload#>>'{paid_summary,orders_all}')::bigint>=(v_payload#>>'{paid_summary,orders_30d}')::bigint
    and (v_payload#>>'{paid_summary,units_all}')::numeric>=(v_payload#>>'{paid_summary,units_30d}')::numeric
    and (v_payload#>>'{paid_summary,revenue_all}')::numeric>=(v_payload#>>'{paid_summary,revenue_30d}')::numeric
    and (v_payload#>>'{paid_summary,orders_30d}')::bigint>=(v_payload#>>'{paid_summary,orders_today}')::bigint
    and (v_payload#>>'{paid_summary,units_30d}')::numeric>=(v_payload#>>'{paid_summary,units_today}')::numeric
    and (v_payload#>>'{paid_summary,revenue_30d}')::numeric>=(v_payload#>>'{paid_summary,revenue_today}')::numeric
    and (v_payload#>>'{paid_summary,attributed_orders_all}')::bigint>=(v_payload#>>'{paid_summary,attributed_orders_30d}')::bigint
    and v_payload#>>'{paid_summary,revenue_basis}'='top-level-order-lines',
    'paid_summary H67 no sustituye de forma coherente el resumen de Operations.';
  assert not exists(
    select 1 from jsonb_array_elements(v_payload->'product_catalog') p(row)
    where (
      select array_agg(k order by k) from jsonb_object_keys(p.row) keys(k)
    )<>array[
      'active','available_stock','category','id','in_process_units','name','price',
      'production_buffer','queue_units','species','stock_source','type'
    ]
  ), 'El catalogo compacto H67 expuso costo, texto libre o detalle no contratado.';

  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_payload->'limits') keys(k)
  )=array[
    'campaign_attribution','creative_attribution','critical_preparations',
    'product_catalog','product_sales_30d','published_post_attribution'
  ]
    and (select array_agg(k order by k) from jsonb_object_keys(v_payload->'limits') keys(k))
      =(select array_agg(k order by k) from jsonb_object_keys(v_payload->'counts') keys(k))
    and (
      select array_agg(k order by k) from jsonb_object_keys(v_payload->'limits') keys(k)
    )=(select array_agg(k order by k) from jsonb_object_keys(v_payload->'truncated') keys(k)),
    'Cada coleccion limitada debe tener count y truncated homologos.';
  for v_limit_key in select jsonb_object_keys(v_payload->'limits') loop
    assert ((v_payload->'truncated'->>v_limit_key)::boolean)
      =((v_payload->'counts'->>v_limit_key)::bigint>(v_payload->'limits'->>v_limit_key)::bigint),
      format('truncated.%s no deriva de count > limit.',v_limit_key);
  end loop;

  v_collections:=jsonb_build_object(
    'product_catalog',v_payload->'product_catalog',
    'product_sales_30d',v_payload->'product_sales_30d',
    'campaign_attribution',v_payload->'campaign_attribution',
    'creative_attribution',v_payload->'creative_attribution',
    'published_post_attribution',v_payload->'published_post_attribution',
    'critical_preparations',v_payload#>'{production,critical_preparations}'
  );
  for v_limit_key in select jsonb_object_keys(v_collections) loop
    assert jsonb_typeof(v_collections->v_limit_key)='array'
      and jsonb_array_length(v_collections->v_limit_key)<=(v_payload->'limits'->>v_limit_key)::integer,
      format('La coleccion %s no respeta su limite declarado.',v_limit_key);
  end loop;
  assert (v_payload#>>'{crm_segments,contains_customer_ids}')::boolean=false
    and v_payload::text !~* '"customer_id"[[:space:]]*:'
    and v_payload::text !~* '"order_id"[[:space:]]*:'
    and v_payload::text !~* '"(telefono|instagram|direccion|phone|address)"[[:space:]]*:',
    'H67 expuso IDs de clientes o pedidos.';
  assert not exists(
    select 1 from jsonb_array_elements(v_payload#>'{production,critical_preparations}') p(row)
    where (
      select array_agg(k order by k) from jsonb_object_keys(p.row) keys(k)
    )<>array['flavor','name','recommended_amount','severity','unit']
  ), 'Las preparaciones criticas expusieron formula, inventario o capacidad sensible.';
  assert v_payload::text !~* '"(cost|costo|unit_cost|estimated_cost|ingredients|quantity_per_[a-z_]+|current_stock|minimum_stock|yield_grams|possible_batches|item_id)"[[:space:]]*:',
    'H67 expuso costos, formula o inventario detallado.';
  assert v_payload::text !~* 'H67-PII-|H67-SECRET-|H67-DIRECCION-PRIVADA|storage_path|signed_url|access[_-]?token|service[_-]?role',
    'H67 expuso PII, nota, proveedor, ruta o secreto sentinel.';
  assert octet_length(v_payload::text)<=524288,
    'H67 excedio el techo compacto de 512 KiB.';
  assert not exists(
    select 1 from jsonb_each_text(v_payload->'truncated') t(key,value)
    where value::boolean
  ),
    'La base viva excede un limite H67; el cliente debe fallar cerrado antes de omitir hechos.';

  assert (select count(*) from public.agency_decisions)=v_decisions
    and (select count(*) from public.creative_generation_jobs)=v_jobs,
    'Una lectura H67 creo una decision o trabajo externo.';
end $$;

reset role;

-- Un UUID no vinculado no puede atravesar SECURITY DEFINER.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',gen_random_uuid()::text,'role','authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_failed boolean:=false;
begin
  begin
    perform public.momos_agency_snapshots_v2();
  exception when sqlstate '42501' then v_failed:=true;
  end;
  assert v_failed, 'Un UUID no vinculado pudo leer H67.';
end $$;

reset role;

select 'TESTS_OK — Agencia hechos compactos/stock/demanda/capacidad/PII/outbox/RBAC PASS, rollback total' as resultado;
rollback;
