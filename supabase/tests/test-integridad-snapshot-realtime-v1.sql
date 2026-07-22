-- MOMOS OPS · prueba adversarial H64 Integridad snapshot/Realtime.
-- Siempre ROLLBACK: no deja lotes, figuras ni cambios de prueba.

begin;

do $$
declare
  v_table text;
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_64_integridad_snapshot_realtime'
  ), 'Falta aplicar la migración 64.';
  assert to_regprocedure('public.momos_operational_snapshot_v1()') is not null,
    'Falta el snapshot operativo.';
  assert has_function_privilege('authenticated','public.momos_operational_snapshot_v1()','EXECUTE'),
    'La app autenticada no puede leer el snapshot.';
  assert not has_function_privilege('anon','public.momos_operational_snapshot_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_operational_snapshot_v1()','EXECUTE'),
    'Un rol sin sesión puede saltar la frontera del snapshot.';
  assert exists(
    select 1 from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='momos_operational_snapshot_v1'
      and p.pronargs=0 and p.provolatile='s' and not p.prosecdef
  ), 'El snapshot dejó de ser STABLE SECURITY INVOKER.';

  assert exists(select 1 from pg_publication where pubname='supabase_realtime'),
    'Falta la publicación supabase_realtime.';
  foreach v_table in array array[
    'orders','order_items','order_item_adiciones','packing_verifications','evidences','deliveries',
    'customers','benefits','claims','inventory_movements','inventory_reservations','production_suggestions',
    'production_batches','lote_figuras','subreceta_producciones','audit_logs',
    'products','combo_components','inventory_items','inventory_lots','recipes','users','toppings','figuras',
    'catalog_values','zonas','proveedores_domicilio','brand_library','app_settings','subrecetas',
    'subreceta_ingredientes','figura_relleno'
  ] loop
    assert to_regclass(format('public.%I',v_table)) is not null,
      format('Falta la tabla base escuchada %s.',v_table);
    assert (
      select count(*)=1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
    ), format('Realtime no publicó exactamente una vez public.%s.',v_table);
  end loop;
end $$;

-- Más de 50 lotes terminales recientes no pueden expulsar un lote Listo
-- antiguo que todavía sea inventario vendible. Un Listo vencido igual de
-- antiguo sí queda fuera de la raíz y no se confunde con stock vigente.
do $$
declare
  v_actor public.users%rowtype;
  v_product public.products%rowtype;
  g integer;
begin
  select * into v_actor
  from public.users
  where activo and auth_id is not null
  order by case when rol='Administrador' then 0 else 1 end,id
  limit 1;
  assert v_actor.id is not null, 'Falta un actor autenticado para H64.';

  select * into v_product
  from public.products
  where activo
  order by id
  limit 1;
  assert v_product.id is not null, 'Falta un producto activo para H64.';

  insert into public.production_batches(
    id,fecha,product_id,figura,sabor,gramaje_g,prod,perfectas,imperfectas,descartadas,
    vence,vencimiento,estado,stock_contabilizado,obs
  ) values (
    'H64-LISTO-VIGENTE',date '2000-01-01',v_product.id,'H64 Figura','H64 Sabor',150,3,2,1,0,
    current_date+2,current_date+2,'Listo',true,'Fixture H64 Listo antiguo vendible'
  );
  insert into public.lote_figuras(
    batch_id,figura,cant,perfectas,imperfectas,descartadas,consumidas
  ) values ('H64-LISTO-VIGENTE','H64 Figura',3,2,1,0,0);

  insert into public.production_batches(
    id,fecha,product_id,figura,sabor,gramaje_g,prod,perfectas,imperfectas,descartadas,
    vence,vencimiento,estado,stock_contabilizado,obs
  ) values (
    'H64-LISTO-VENCIDO',date '1999-01-01',v_product.id,'H64 Vencida','H64 Vencido',150,1,1,0,0,
    current_date-1,current_date-1,'Listo',true,'Fixture H64 Listo vencido'
  );
  insert into public.lote_figuras(
    batch_id,figura,cant,perfectas,imperfectas,descartadas,consumidas
  ) values ('H64-LISTO-VENCIDO','H64 Vencida',1,1,0,0,0);

  for g in 1..60 loop
    insert into public.production_batches(id,fecha,prod,estado,stock_contabilizado,obs)
    values(
      'H64-TERM-'||lpad(g::text,3,'0'),date '2099-12-31',0,'Descartado',false,
      'Fixture H64 terminal '||g
    );
  end loop;

  perform set_config('momos.h64_auth',v_actor.auth_id::text,true);
  perform set_config('momos.h64_product',v_product.id,true);
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',current_setting('momos.h64_auth'),'role','authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_snapshot jsonb;
  v_product_id text:=current_setting('momos.h64_product');
  v_expected_keys text[]:=array[
    'audit_logs','benefits','claims','customer_activations','customer_contacts','customer_crm_profiles',
    'customers','deliveries','evidences','history_cursor','inventory_lookup','inventory_movements',
    'inventory_reservations','lote_figuras','order_dispatch_handoffs','order_incidents',
    'order_item_adiciones','order_items','order_line_progress','order_stage_assignments','orders',
    'packing_verifications','production_batches','production_suggestions','products_lookup','server_time',
    'snapshot_started_at','subreceta_producciones','users_lookup','variantes','variantes_cuarentena','version'
  ];
begin
  v_snapshot:=public.momos_operational_snapshot_v1();

  assert (v_snapshot->>'version')::integer=1
    and v_snapshot->>'server_time'=v_snapshot->>'snapshot_started_at',
    'H64 alteró la versión o el reloj contractual de H56.';
  assert (select array_agg(k order by k) from jsonb_object_keys(v_snapshot) as keys(k))=v_expected_keys,
    'H64 alteró las claves o el shape del snapshot H56.';

  assert exists(
    select 1 from jsonb_array_elements(v_snapshot->'production_batches') b
    where b->>'id'='H64-LISTO-VIGENTE'
      and b->>'estado'='Listo'
      and (b->>'stock_contabilizado')::boolean
  ), 'Un lote Listo antiguo, vigente y vendible fue expulsado del snapshot.';
  assert exists(
    select 1 from jsonb_array_elements(v_snapshot->'lote_figuras') lf
    where lf->>'batch_id'='H64-LISTO-VIGENTE'
      and lf->>'figura'='H64 Figura'
      and (lf->>'perfectas')::integer-(lf->>'consumidas')::integer=2
  ), 'El lote Listo quedó sin su composición exacta de figuras.';
  assert exists(
    select 1 from jsonb_array_elements(v_snapshot->'variantes') v
    where v->>'product_id'=v_product_id
      and v->>'figura'='H64 Figura'
      and v->>'sabor'='H64 Sabor'
      and (v->>'disponibles')::numeric=2
  ), 'El snapshot no expuso la variante vendible exacta del lote Listo.';

  assert not exists(
    select 1 from jsonb_array_elements(v_snapshot->'production_batches') b
    where b->>'id'='H64-LISTO-VENCIDO'
  ), 'Un lote Listo vencido se trató como inventario vendible vivo.';
  assert (
    select count(*) from jsonb_array_elements(v_snapshot->'production_batches') b
    where b->>'id' like 'H64-TERM-%'
  )=50, 'La ventana histórica de lotes terminales dejó de estar limitada a 50.';
end $$;

reset role;

select 'TESTS_OK — snapshot Listo vigente/shape/cierre relacional/Realtime/RBAC PASS, rollback total' as resultado;
rollback;
