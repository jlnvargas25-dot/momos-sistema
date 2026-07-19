-- MOMOS OPS · H72 Inventario terminado incremental v1.
-- Publica solo producto_id, versión y hora; el detalle se obtiene por una RPC
-- cerrada. Las mutaciones canónicas de Producción siguen siendo la única vía
-- de escritura y este hito no cambia stock ni estados.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260719'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260719_71_pedidos_deltas') then
    raise exception 'H72 requiere H71 Pedidos y Empaque incrementales.';
  end if;
  if to_regclass('public.production_batches') is null
     or to_regclass('public.lote_figuras') is null
     or to_regclass('public.v_variantes_disponibles') is null
     or to_regclass('public.v_variantes_cuarentena') is null then
    raise exception 'H72 requiere Producción e Inventario terminado exacto.';
  end if;
end $$;

create table if not exists public.finished_inventory_sync_versions(
  product_id text primary key references public.products(id) on delete cascade,
  version bigint not null default 1 check(version>0),
  changed_at timestamptz not null default clock_timestamp()
);
alter table public.finished_inventory_sync_versions enable row level security;
drop policy if exists finished_inventory_sync_versions_staff_read
  on public.finished_inventory_sync_versions;
create policy finished_inventory_sync_versions_staff_read
  on public.finished_inventory_sync_versions for select to authenticated
  using(public.is_staff());
revoke all on table public.finished_inventory_sync_versions
  from public,anon,authenticated,service_role;
grant select on table public.finished_inventory_sync_versions to authenticated;

insert into public.finished_inventory_sync_versions(product_id,version,changed_at)
select p.id,1,clock_timestamp() from public.products p
on conflict(product_id) do nothing;

create or replace function public._momos_touch_finished_inventory_sync_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_product_ids text[]:=array[]::text[];
  v_product_id text;
  v_batch_id text;
begin
  if tg_op<>'INSERT' and to_jsonb(old) is not distinct from to_jsonb(new) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_table_name='products' then
    if tg_op<>'DELETE' then v_product_ids:=array_append(v_product_ids,new.id); end if;
    if tg_op='UPDATE' and old.id is distinct from new.id then v_product_ids:=array_append(v_product_ids,old.id); end if;
  elsif tg_table_name='production_batches' then
    if tg_op<>'INSERT' then v_product_ids:=array_append(v_product_ids,old.product_id); end if;
    if tg_op<>'DELETE' then v_product_ids:=array_append(v_product_ids,new.product_id); end if;
  elsif tg_table_name='lote_figuras' then
    if tg_op<>'INSERT' then
      select b.product_id into v_product_id from public.production_batches b where b.id=old.batch_id;
      v_product_ids:=array_append(v_product_ids,v_product_id);
    end if;
    if tg_op<>'DELETE' then
      select b.product_id into v_product_id from public.production_batches b where b.id=new.batch_id;
      v_product_ids:=array_append(v_product_ids,v_product_id);
    end if;
  elsif tg_table_name='inventory_reservations' then
    if tg_op<>'INSERT' and old.tipo='producto' then v_product_ids:=array_append(v_product_ids,old.product_id); end if;
    if tg_op<>'DELETE' and new.tipo='producto' then v_product_ids:=array_append(v_product_ids,new.product_id); end if;
  elsif tg_table_name='audit_logs' then
    if tg_op='DELETE' then
      if old.entidad<>'Lote' then return old; end if;
      v_batch_id:=old.entidad_id;
    else
      if new.entidad<>'Lote' then return new; end if;
      v_batch_id:=new.entidad_id;
    end if;
    select b.product_id into v_product_id from public.production_batches b where b.id=v_batch_id;
    v_product_ids:=array_append(v_product_ids,v_product_id);
  end if;
  for v_product_id in
    select distinct nullif(btrim(raw_id),'')
    from unnest(v_product_ids) raw_id
    where nullif(btrim(coalesce(raw_id,'')),'') is not null
  loop
    if exists(select 1 from public.products p where p.id=v_product_id) then
      insert into public.finished_inventory_sync_versions(product_id,version,changed_at)
      values(v_product_id,1,clock_timestamp())
      on conflict(product_id) do update
        set version=public.finished_inventory_sync_versions.version+1,
            changed_at=excluded.changed_at;
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end $$;

revoke all on function public._momos_touch_finished_inventory_sync_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists momos_finished_inventory_sync_touch on public.products;
create trigger momos_finished_inventory_sync_touch
after insert or update on public.products for each row
execute function public._momos_touch_finished_inventory_sync_v1();
drop trigger if exists momos_finished_inventory_sync_touch on public.production_batches;
create trigger momos_finished_inventory_sync_touch
after insert or update or delete on public.production_batches for each row
execute function public._momos_touch_finished_inventory_sync_v1();
drop trigger if exists momos_finished_inventory_sync_touch on public.lote_figuras;
create trigger momos_finished_inventory_sync_touch
after insert or update or delete on public.lote_figuras for each row
execute function public._momos_touch_finished_inventory_sync_v1();
drop trigger if exists momos_finished_inventory_sync_touch on public.inventory_reservations;
create trigger momos_finished_inventory_sync_touch
after insert or update or delete on public.inventory_reservations for each row
execute function public._momos_touch_finished_inventory_sync_v1();
drop trigger if exists momos_finished_inventory_sync_touch on public.audit_logs;
create trigger momos_finished_inventory_sync_touch
after insert or update or delete on public.audit_logs for each row
execute function public._momos_touch_finished_inventory_sync_v1();

create or replace function public.momos_finished_inventory_deltas_v1(p_product_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_missing text[];
  v_response jsonb;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if p_product_ids is null or cardinality(p_product_ids)=0 or cardinality(p_product_ids)>20 then
    raise exception 'Solicita entre 1 y 20 productos.';
  end if;
  if exists(select 1 from unnest(p_product_ids) raw_id where nullif(btrim(coalesce(raw_id,'')),'') is null) then
    raise exception 'La lista contiene un product_id vacío.';
  end if;
  with requested as materialized(
    select btrim(u.raw_id) product_id,min(u.ord)::bigint first_ord
    from unnest(p_product_ids) with ordinality u(raw_id,ord)
    group by btrim(u.raw_id)
  )
  select array_agg(r.product_id order by r.first_ord) into v_missing
  from requested r left join public.products p on p.id=r.product_id
  where p.id is null;
  if coalesce(cardinality(v_missing),0)>0 then
    raise exception 'No existen los productos solicitados: %',array_to_string(v_missing,', ');
  end if;

  with requested as materialized(
    select btrim(u.raw_id) product_id,min(u.ord)::bigint first_ord
    from unnest(p_product_ids) with ordinality u(raw_id,ord)
    group by btrim(u.raw_id)
  ), payload as materialized(
    select r.first_ord,jsonb_build_object(
      'contract','momos.finished-inventory-delta.v1',
      'productId',p.id,
      'version',coalesce(v.version,1)::text,
      'product',jsonb_build_object(
        'id',p.id,'nombre',p.nombre,'tipo',p.tipo,'especie',coalesce(p.especie,''),
        'activo',p.activo,'stock',p.stock
      ),
      'productionBatches',coalesce((select jsonb_agg(jsonb_build_object(
        'id',b.id,'fecha',b.fecha::text,'productId',b.product_id,'producto',p.nombre,
        'figura',coalesce(b.figura,''),'sabor',coalesce(b.sabor,''),'relleno',coalesce(b.relleno,''),
        'salsa',coalesce(b.salsa,''),'gramaje',case when b.gramaje_g is null then '' else b.gramaje_g::text||' g' end,
        'prod',b.prod,'perfectas',b.perfectas,'imperfectas',b.imperfectas,'descartadas',b.descartadas,
        'destino',coalesce(nullif(b.destino,''),'—'),'resp',coalesce(u.nombre,''),
        'vence',coalesce(coalesce(b.vencimiento,b.vence)::text,''),
        'desmoldadoEn',case when b.desmoldado_en is null then '' else to_char(b.desmoldado_en at time zone 'America/Bogota','YYYY-MM-DD HH24:MI') end,
        'estado',b.estado,'stockContabilizado',b.stock_contabilizado,
        'horasCongelacion',b.horas_congelacion,
        'inicioCongelacion',case when b.inicio_congelacion is null then '' else to_char(b.inicio_congelacion at time zone 'America/Bogota','YYYY-MM-DD HH24:MI') end,
        'molde',coalesce(b.molde,''),'ubicacion',coalesce(b.ubicacion,''),'obs',coalesce(b.obs,''),
        'corridaId',coalesce(b.corrida_id,''),'figuras',coalesce(b.figuras,'[]'::jsonb),
        'resultadosFiguras',coalesce((select jsonb_agg(jsonb_build_object(
          'figura',coalesce(lf.figura,''),'cant',lf.cant,'perfectas',lf.perfectas,
          'imperfectas',lf.imperfectas,'descartadas',lf.descartadas,'consumidas',coalesce(lf.consumidas,0)
        ) order by lf.figura) from public.lote_figuras lf where lf.batch_id=b.id),'[]'::jsonb)
      ) order by b.id desc) from public.production_batches b
        left join public.users u on u.id=b.resp_user_id where b.product_id=p.id),'[]'::jsonb),
      'variants',coalesce((select jsonb_agg(jsonb_build_object(
        'productId',x.product_id,'producto',x.producto,'figura',x.figura,'sabor',coalesce(x.sabor,''),
        'gramajeG',x.gramaje_g,'disponibles',x.disponibles,'vence',coalesce(x.vencimiento_proximo::text,'')
      ) order by x.figura,x.sabor,x.gramaje_g) from public.v_variantes_disponibles x where x.product_id=p.id),'[]'::jsonb),
      'quarantinedVariants',coalesce((select jsonb_agg(jsonb_build_object(
        'productId',x.product_id,'producto',x.producto,'figura',x.figura,'sabor',coalesce(x.sabor,''),
        'gramajeG',x.gramaje_g,'disponibles',x.disponibles,'vence',coalesce(x.vencimiento_proximo::text,'')
      ) order by x.figura,x.sabor,x.gramaje_g) from public.v_variantes_cuarentena x where x.product_id=p.id),'[]'::jsonb)
    ) delta
    from requested r join public.products p on p.id=r.product_id
    left join public.finished_inventory_sync_versions v on v.product_id=p.id
  )
  select jsonb_build_object(
    'contract','momos.finished-inventory-delta-batch.v1',
    'serverTime',statement_timestamp(),
    'deltas',coalesce(jsonb_agg(delta order by first_ord),'[]'::jsonb),
    'containsSecrets',false,
    'externalExecution',false
  ) into v_response from payload;
  return v_response;
end $$;

revoke all on function public.momos_finished_inventory_deltas_v1(text[])
  from public,anon,service_role;
grant execute on function public.momos_finished_inventory_deltas_v1(text[]) to authenticated;

create or replace function public.producto_terminado_deltas_disponibles()
returns boolean
language sql stable security definer set search_path=pg_catalog,public,pg_temp
as $$
  select public.is_staff()
    and to_regprocedure('public.momos_finished_inventory_deltas_v1(text[])') is not null
    and to_regclass('public.finished_inventory_sync_versions') is not null
    and exists(select 1 from public.momos_ops_migrations where id='20260719_72_producto_terminado_deltas')
$$;
revoke all on function public.producto_terminado_deltas_disponibles() from public,anon,service_role;
grant execute on function public.producto_terminado_deltas_disponibles() to authenticated;

-- Conserva H70/H71 y anuncia H72 sin agregar otra sonda HTTP.
create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_capabilities jsonb;
  v_schema_version text;
  v_inventory_event_id bigint:=0;
begin
  if auth.uid() is null or not exists(select 1 from public.users u where u.auth_id=auth.uid() and u.activo) then
    raise exception 'Sesion MOMOS invalida.' using errcode='42501';
  end if;
  select coalesce(jsonb_object_agg(x.name,to_regprocedure(format('public.%I()',x.name)) is not null),'{}'::jsonb)
  into v_capabilities from unnest(array[
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
    'inventario_deltas_disponibles','pedidos_deltas_disponibles','producto_terminado_deltas_disponibles'
  ]::text[]) x(name);
  select id into v_schema_version from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  v_inventory_event_id:=4611686018427387904+((pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot()))::text)::bigint;
  return jsonb_build_object(
    'version',1,'schema_version',coalesce(v_schema_version,''),'server_time',clock_timestamp(),
    'capabilities',v_capabilities,'inventory_latest_event_id',v_inventory_event_id::text,
    'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object('version',extract(epoch from clock_timestamp())::bigint,'ttl_seconds',60,'inventory_latest_event_id',v_inventory_event_id::text),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300)
    ),'contains_pii',false,'contains_secrets',false,'external_execution',false
  );
end $$;
revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='finished_inventory_sync_versions') then
    alter publication supabase_realtime add table public.finished_inventory_sync_versions;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260719_72_producto_terminado_deltas','Inventario terminado aplica lotes y variantes exactas por producto con versión monotónica, RBAC y fallback seguro')
on conflict(id) do update set detalle=excluded.detalle;

commit;
