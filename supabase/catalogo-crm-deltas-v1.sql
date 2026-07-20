-- MOMOS OPS · H74 Catálogo y CRM por deltas exactos v1.
--
-- Productos/recetas y la ficha CRM dejan de rehidratar dominios completos.
-- Los outboxes solo publican id+versión. La lectura CRM conserva PII porque
-- alimenta una pantalla privada de staff; nunca la mezcla con el catálogo.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260719'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260719_73_produccion_deltas') then
    raise exception 'H74 requiere H73 Producción por deltas.';
  end if;
  if to_regprocedure('public.crear_producto(jsonb)') is null
     or to_regprocedure('public.upsert_cliente(text,jsonb)') is null
     or to_regprocedure('public.crm_clientes_disponible()') is null then
    raise exception 'H74 requiere las RPC canónicas de Productos y CRM.';
  end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'H74 requiere pg_catalog.sha256(bytea).';
  end if;
end $$;

create table if not exists public.product_catalog_sync_versions(
  product_id text primary key references public.products(id) on delete cascade,
  version bigint not null default 1 check(version>0),
  changed_at timestamptz not null default clock_timestamp()
);
alter table public.product_catalog_sync_versions enable row level security;
drop policy if exists product_catalog_sync_versions_staff_read on public.product_catalog_sync_versions;
create policy product_catalog_sync_versions_staff_read on public.product_catalog_sync_versions
  for select to authenticated using(public.is_staff());
revoke all on table public.product_catalog_sync_versions from public,anon,authenticated,service_role;
grant select on table public.product_catalog_sync_versions to authenticated;
insert into public.product_catalog_sync_versions(product_id,version)
select p.id,1 from public.products p on conflict(product_id) do nothing;

create table if not exists public.customer_crm_sync_versions(
  customer_id text primary key references public.customers(id) on delete cascade,
  version bigint not null default 1 check(version>0),
  changed_at timestamptz not null default clock_timestamp()
);
alter table public.customer_crm_sync_versions enable row level security;
drop policy if exists customer_crm_sync_versions_staff_read on public.customer_crm_sync_versions;
create policy customer_crm_sync_versions_staff_read on public.customer_crm_sync_versions
  for select to authenticated using(public.is_staff());
revoke all on table public.customer_crm_sync_versions from public,anon,authenticated,service_role;
grant select on table public.customer_crm_sync_versions to authenticated;
insert into public.customer_crm_sync_versions(customer_id,version)
select c.id,1 from public.customers c on conflict(customer_id) do nothing;

create or replace function public._momos_touch_product_catalog_sync_v1()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_product_id text;
begin
  if tg_op<>'INSERT' and to_jsonb(old) is not distinct from to_jsonb(new) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_table_name='products' then
    if tg_op='DELETE' then return old; end if;
    v_product_id:=new.id;
  elsif tg_table_name='combo_components' then
    v_product_id:=case when tg_op='DELETE' then old.combo_id else new.combo_id end;
  else
    v_product_id:=case when tg_op='DELETE' then old.product_id else new.product_id end;
  end if;
  if exists(select 1 from public.products p where p.id=v_product_id) then
    insert into public.product_catalog_sync_versions(product_id,version,changed_at)
    values(v_product_id,1,clock_timestamp())
    on conflict(product_id) do update set
      version=public.product_catalog_sync_versions.version+1,
      changed_at=excluded.changed_at;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public._momos_touch_product_catalog_sync_v1() from public,anon,authenticated,service_role;

drop trigger if exists momos_product_catalog_sync_touch on public.products;
create trigger momos_product_catalog_sync_touch after insert or update or delete on public.products
for each row execute function public._momos_touch_product_catalog_sync_v1();
drop trigger if exists momos_product_catalog_sync_touch on public.combo_components;
create trigger momos_product_catalog_sync_touch after insert or update or delete on public.combo_components
for each row execute function public._momos_touch_product_catalog_sync_v1();
drop trigger if exists momos_product_catalog_sync_touch on public.recipes;
create trigger momos_product_catalog_sync_touch after insert or update or delete on public.recipes
for each row execute function public._momos_touch_product_catalog_sync_v1();

create or replace function public._momos_touch_customer_crm_sync_v1()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_customer_id text;
begin
  if tg_op<>'INSERT' and to_jsonb(old) is not distinct from to_jsonb(new) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_table_name='customers' then
    if tg_op='DELETE' then return old; end if;
    v_customer_id:=new.id;
  else
    v_customer_id:=case when tg_op='DELETE' then old.customer_id else new.customer_id end;
  end if;
  if exists(select 1 from public.customers c where c.id=v_customer_id) then
    insert into public.customer_crm_sync_versions(customer_id,version,changed_at)
    values(v_customer_id,1,clock_timestamp())
    on conflict(customer_id) do update set
      version=public.customer_crm_sync_versions.version+1,
      changed_at=excluded.changed_at;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public._momos_touch_customer_crm_sync_v1() from public,anon,authenticated,service_role;

do $$
declare v_table text;
begin
  foreach v_table in array array['customers','customer_crm_profiles','customer_contacts','customer_activations','benefits'] loop
    execute format('drop trigger if exists momos_customer_crm_sync_touch on public.%I',v_table);
    execute format('create trigger momos_customer_crm_sync_touch after insert or update or delete on public.%I for each row execute function public._momos_touch_customer_crm_sync_v1()',v_table);
  end loop;
end $$;

create or replace function public.momos_product_catalog_deltas_v1(p_product_ids text[])
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_missing text[]; v_response jsonb;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if p_product_ids is null or cardinality(p_product_ids)=0 or cardinality(p_product_ids)>20 then
    raise exception 'Solicita entre 1 y 20 productos.';
  end if;
  if exists(select 1 from unnest(p_product_ids) x(id) where nullif(btrim(coalesce(id,'')),'') is null) then
    raise exception 'La lista contiene un product_id vacío.';
  end if;
  with requested as materialized(
    select btrim(x.id) id,min(x.ord) ord from unnest(p_product_ids) with ordinality x(id,ord) group by btrim(x.id)
  ) select array_agg(r.id order by r.ord) into v_missing from requested r left join public.products p on p.id=r.id where p.id is null;
  if coalesce(cardinality(v_missing),0)>0 then raise exception 'No existen los productos solicitados: %',array_to_string(v_missing,', '); end if;

  with requested as materialized(
    select btrim(x.id) id,min(x.ord) ord from unnest(p_product_ids) with ordinality x(id,ord) group by btrim(x.id)
  ), payload as materialized(
    select r.ord,jsonb_build_object(
      'contract','momos.product-catalog-delta.v1','productId',p.id,
      'version',coalesce(v.version,1)::text,'serverTime',statement_timestamp(),
      'product',jsonb_build_object(
        'id',p.id,'nombre',p.nombre,'cat',p.cat,'tipo',p.tipo,'especie',p.especie,
        'precio',p.precio,'precioRappi',p.precio_rappi,'costo',p.costo,'stock',p.stock,
        'prep',p.prep,'frio',p.frio,'lejano',p.lejano,'activo',p.activo,'desc',coalesce(p.descr,''),
        'comboSize',p.combo_size,'componentProductIds',coalesce((select jsonb_agg(cc.component_id order by cc.component_id) from public.combo_components cc where cc.combo_id=p.id),'[]'::jsonb),
        'empaqueItem',coalesce(p.empaque_item_id,''),'colchonProduccion',coalesce(p.colchon_produccion,0)
      ),
      'recipes',coalesce((select jsonb_agg(jsonb_build_object(
        'id',rc.id,'productId',rc.product_id,'itemId',rc.item_id,'cantidad',rc.cantidad
      ) order by rc.id) from public.recipes rc where rc.product_id=p.id),'[]'::jsonb)
    ) body
    from requested r join public.products p on p.id=r.id
    left join public.product_catalog_sync_versions v on v.product_id=p.id
  ) select jsonb_build_object(
    'contract','momos.product-catalog-delta-batch.v1','deltas',jsonb_agg(body order by ord),
    'containsCustomerPii',false,'containsSecrets',false,'externalExecution',false
  ) into v_response from payload;
  return v_response;
end $$;
revoke all on function public.momos_product_catalog_deltas_v1(text[]) from public,anon,service_role;
grant execute on function public.momos_product_catalog_deltas_v1(text[]) to authenticated;

create or replace function public.momos_customer_crm_deltas_v1(p_customer_ids text[])
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_missing text[]; v_response jsonb;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if p_customer_ids is null or cardinality(p_customer_ids)=0 or cardinality(p_customer_ids)>20 then
    raise exception 'Solicita entre 1 y 20 clientes.';
  end if;
  if exists(select 1 from unnest(p_customer_ids) x(id) where nullif(btrim(coalesce(id,'')),'') is null) then
    raise exception 'La lista contiene un customer_id vacío.';
  end if;
  with requested as materialized(
    select btrim(x.id) id,min(x.ord) ord from unnest(p_customer_ids) with ordinality x(id,ord) group by btrim(x.id)
  ) select array_agg(r.id order by r.ord) into v_missing from requested r left join public.customers c on c.id=r.id where c.id is null;
  if coalesce(cardinality(v_missing),0)>0 then raise exception 'No existen los clientes solicitados: %',array_to_string(v_missing,', '); end if;

  with requested as materialized(
    select btrim(x.id) id,min(x.ord) ord from unnest(p_customer_ids) with ordinality x(id,ord) group by btrim(x.id)
  ), payload as materialized(
    select r.ord,jsonb_build_object(
      'contract','momos.customer-crm-delta.v1','customerId',c.id,
      'version',coalesce(v.version,1)::text,'serverTime',statement_timestamp(),
      'customer',jsonb_build_object(
        'id',c.id,'nombre',c.nombre,'telefono',coalesce(c.telefono,''),'instagram',coalesce(c.instagram,''),
        'barrio',coalesce(c.barrio,''),'direccion',coalesce(c.direccion,''),'canal',coalesce(c.canal,''),
        'primera',coalesce(c.primera::text,''),'ultima',coalesce(c.ultima::text,''),'total',c.total,'pedidos',c.pedidos,
        'cumple',coalesce(c.cumple::text,''),'favoritos',coalesce(c.favoritos,''),'estado',c.estado,'notas',coalesce(c.notas,'')
      ),
      'profile',coalesce((select jsonb_build_object(
        'customerId',cp.customer_id,'contactAllowed',cp.contact_allowed,'contactReason',coalesce(cp.contact_reason,''),
        'preferredChannel',cp.preferred_channel,'acquisitionSource',coalesce(cp.acquisition_source,''),
        'referredByCustomerId',coalesce(cp.referred_by_customer_id,''),'updatedBy',coalesce(cp.updated_by,''),
        'updatedAt',to_char(cp.updated_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI')
      ) from public.customer_crm_profiles cp where cp.customer_id=c.id),'null'::jsonb),
      'contacts',coalesce((select jsonb_agg(jsonb_build_object(
        'id',x.id::text,'customerId',x.customer_id,'channel',x.channel,'reason',x.reason,'outcome',x.outcome,
        'notes',coalesce(x.notes,''),'followUpOn',coalesce(x.follow_up_on::text,''),
        'activationId',coalesce(x.activation_id::text,''),'orderId',coalesce(x.order_id,''),
        'createdBy',x.created_by,'createdByName',coalesce(u.nombre,''),
        'createdAt',to_char(x.created_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI')
      ) order by x.created_at desc,x.id desc) from (
        select cc.* from public.customer_contacts cc where cc.customer_id=c.id order by cc.created_at desc,cc.id desc limit 100
      ) x left join public.users u on u.id=x.created_by),'[]'::jsonb),
      'activations',coalesce((select jsonb_agg(jsonb_build_object(
        'id',x.id::text,'customerId',x.customer_id,'type',x.type,'title',x.title,'message',coalesce(x.message,''),
        'status',x.status,'benefitId',coalesce(x.benefit_id,''),'expiresOn',coalesce(x.expires_on::text,''),
        'convertedOrderId',coalesce(x.converted_order_id,''),'createdBy',x.created_by,'createdByName',coalesce(u.nombre,''),
        'createdAt',to_char(x.created_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI'),
        'updatedAt',to_char(x.updated_at at time zone 'America/Bogota','YYYY-MM-DD HH24:MI')
      ) order by x.created_at desc,x.id desc) from (
        select ca.* from public.customer_activations ca where ca.customer_id=c.id order by ca.created_at desc,ca.id desc limit 100
      ) x left join public.users u on u.id=x.created_by),'[]'::jsonb),
      'benefits',coalesce((select jsonb_agg(jsonb_build_object(
        'id',b.id,'customerId',b.customer_id,'beneficio',b.beneficio,'tipoBeneficio',b.tipo_beneficio,
        'valor',b.valor,'productoGratisId',coalesce(b.producto_gratis_id,''),'condicion',coalesce(b.condicion,''),
        'minimo',b.minimo,'activacion',coalesce(b.activacion::text,''),'vence',coalesce(b.vence::text,''),
        'estado',b.estado,'pedidoUso',coalesce(b.pedido_uso,''),'obs',coalesce(b.obs,'')
      ) order by b.id desc) from public.benefits b where b.customer_id=c.id),'[]'::jsonb)
    ) body
    from requested r join public.customers c on c.id=r.id
    left join public.customer_crm_sync_versions v on v.customer_id=c.id
  ) select jsonb_build_object(
    'contract','momos.customer-crm-delta-batch.v1','scope','staff-private','deltas',jsonb_agg(body order by ord),
    'containsCustomerPii',true,'containsSecrets',false,'externalExecution',false
  ) into v_response from payload;
  return v_response;
end $$;
revoke all on function public.momos_customer_crm_deltas_v1(text[]) from public,anon,service_role;
grant execute on function public.momos_customer_crm_deltas_v1(text[]) to authenticated;

create table if not exists public.catalog_crm_delta_receipts(
  operation text not null check(operation in (
    'crear_producto','editar_producto','set_producto_activo','guardar_receta_producto','sincronizar_costo_producto',
    'upsert_cliente','guardar_preferencias_cliente','crear_activacion_cliente','registrar_contacto_cliente','convertir_activacion_cliente','activar_beneficio_cliente'
  )),
  idempotency_key text not null check(length(idempotency_key) between 1 and 200),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  domain text not null check(domain in ('catalog','crm')),
  entity_ids text[] not null check(cardinality(entity_ids) between 1 and 20),
  result jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(operation,idempotency_key)
);
alter table public.catalog_crm_delta_receipts enable row level security;
revoke all on table public.catalog_crm_delta_receipts from public,anon,authenticated,service_role;

create or replace function public._momos_catalog_crm_mutation_response_v1(
  p_operation text,p_key text,p_duplicate boolean,p_result jsonb,p_domain text,p_entity_ids text[]
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_catalog jsonb:=null; v_crm jsonb:=null;
begin
  if p_domain='catalog' then v_catalog:=public.momos_product_catalog_deltas_v1(p_entity_ids);
  elsif p_domain='crm' then v_crm:=public.momos_customer_crm_deltas_v1(p_entity_ids);
  else raise exception 'Dominio incremental inválido.'; end if;
  return jsonb_build_object(
    'contract','momos.catalog-crm-mutation.v1','operation',p_operation,
    'idempotencyKey',p_key,'duplicate',p_duplicate,'result',p_result,
    'catalog',v_catalog,'crm',v_crm,'containsCustomerPii',(p_domain='crm'),
    'containsSecrets',false,'externalExecution',false
  );
end $$;
revoke all on function public._momos_catalog_crm_mutation_response_v1(text,text,boolean,jsonb,text,text[]) from public,anon,authenticated,service_role;

create or replace function public.mutar_catalogo_crm_delta(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_operation text; v_key text; v_payload jsonb; v_hash text;
  v_receipt public.catalog_crm_delta_receipts%rowtype;
  v_result jsonb; v_domain text; v_entity_id text; v_activation bigint;
  v_allowed text[];
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo'; end if;
  if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) x(key) where key not in ('operation','idempotency_key','payload')) then
    raise exception 'La mutación no cumple el contrato cerrado.';
  end if;
  v_operation:=nullif(btrim(coalesce(p->>'operation','')),'');
  v_key:=nullif(btrim(coalesce(p->>'idempotency_key','')),'');
  v_payload:=p->'payload';
  if v_operation is null or v_key is null or length(v_key)>200 or jsonb_typeof(v_payload) is distinct from 'object' then
    raise exception 'operation, idempotency_key y payload son obligatorios.';
  end if;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('operation',v_operation,'payload',v_payload)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('momos-catalog-crm:'||v_operation||':'||v_key,0));
  select * into v_receipt from public.catalog_crm_delta_receipts where operation=v_operation and idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then raise exception 'La llave de idempotencia ya pertenece a otro contrato.'; end if;
    return public._momos_catalog_crm_mutation_response_v1(v_operation,v_key,true,v_receipt.result,v_receipt.domain,v_receipt.entity_ids);
  end if;

  case v_operation
    when 'crear_producto' then
      v_domain:='catalog';
      v_allowed:=array['nombre','cat','tipo','especie','precio','precio_rappi','costo','prep','frio','lejano','descr','combo_size','component_product_ids','empaque_item_id','colchon_produccion'];
      if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then raise exception 'El producto contiene campos no permitidos.'; end if;
      v_result:=public.crear_producto(v_payload); v_entity_id:=v_result->>'product_id';
    when 'editar_producto' then
      v_domain:='catalog';
      v_allowed:=array['product_id','nombre','cat','tipo','especie','precio','precio_rappi','costo','prep','frio','lejano','descr','combo_size','component_product_ids','empaque_item_id','colchon_produccion'];
      if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then raise exception 'El producto contiene campos no permitidos.'; end if;
      v_entity_id:=nullif(btrim(coalesce(v_payload->>'product_id','')),'');
      v_result:=public.editar_producto(v_entity_id,v_payload-'product_id');
    when 'set_producto_activo' then
      v_domain:='catalog'; v_allowed:=array['product_id','activo'];
      if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then raise exception 'El estado contiene campos no permitidos.'; end if;
      v_entity_id:=nullif(btrim(coalesce(v_payload->>'product_id','')),'');
      v_result:=public.set_producto_activo(v_entity_id,(v_payload->>'activo')::boolean);
    when 'guardar_receta_producto' then
      v_domain:='catalog'; v_allowed:=array['product_id','lineas'];
      if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then raise exception 'La receta contiene campos no permitidos.'; end if;
      v_entity_id:=nullif(btrim(coalesce(v_payload->>'product_id','')),'');
      if jsonb_typeof(v_payload->'lineas') is distinct from 'array' or exists(select 1 from jsonb_array_elements(v_payload->'lineas') elem(value) where jsonb_typeof(elem.value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(elem.value) z(key) where key not in ('item_id','cantidad'))) then
        raise exception 'Las líneas de receta no cumplen el contrato cerrado.';
      end if;
      v_result:=public.guardar_receta_producto(v_entity_id,v_payload->'lineas');
    when 'sincronizar_costo_producto' then
      v_domain:='catalog'; v_allowed:=array['product_id'];
      if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then raise exception 'El costo contiene campos no permitidos.'; end if;
      v_entity_id:=nullif(btrim(coalesce(v_payload->>'product_id','')),'');
      v_result:=public.sincronizar_costo_producto(v_entity_id);
    when 'upsert_cliente' then
      v_domain:='crm';
      v_allowed:=array['customer_id','nombre','telefono','instagram','canal','barrio','direccion','cumple','favoritos','estado','notas'];
      if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then raise exception 'El cliente contiene campos no permitidos.'; end if;
      v_entity_id:=public.upsert_cliente(nullif(v_payload->>'customer_id',''),v_payload-'customer_id');
      v_result:=jsonb_build_object('ok',true,'customer_id',v_entity_id);
    when 'guardar_preferencias_cliente' then
      v_domain:='crm'; v_allowed:=array['customer_id','contact_allowed','contact_reason','preferred_channel','acquisition_source','referred_by_customer_id'];
      if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then raise exception 'Las preferencias contienen campos no permitidos.'; end if;
      v_entity_id:=nullif(v_payload->>'customer_id',''); v_result:=public.guardar_preferencias_cliente(v_entity_id,v_payload-'customer_id');
    when 'crear_activacion_cliente' then
      v_domain:='crm'; v_allowed:=array['customer_id','type','title','message','expires_on'];
      if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then raise exception 'La activación contiene campos no permitidos.'; end if;
      v_entity_id:=nullif(v_payload->>'customer_id',''); v_result:=public.crear_activacion_cliente(v_payload);
    when 'registrar_contacto_cliente' then
      v_domain:='crm'; v_allowed:=array['customer_id','channel','reason','outcome','notes','follow_up_on','activation_id','order_id'];
      if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then raise exception 'El contacto contiene campos no permitidos.'; end if;
      v_entity_id:=nullif(v_payload->>'customer_id',''); v_result:=public.registrar_contacto_cliente(v_payload);
    when 'convertir_activacion_cliente' then
      v_domain:='crm'; v_allowed:=array['activation_id','order_id'];
      if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then raise exception 'La conversión contiene campos no permitidos.'; end if;
      v_activation:=(v_payload->>'activation_id')::bigint;
      select ca.customer_id into v_entity_id from public.customer_activations ca where ca.id=v_activation;
      if v_entity_id is null then raise exception 'La activación no existe.'; end if;
      v_result:=public.convertir_activacion_cliente(v_activation,v_payload->>'order_id');
    when 'activar_beneficio_cliente' then
      v_domain:='crm'; v_allowed:=array['customer_id','tipo_beneficio','valor','producto_gratis_id','condicion','minimo','vence','obs'];
      if exists(select 1 from jsonb_object_keys(v_payload) x(key) where not(key=any(v_allowed))) then raise exception 'El beneficio contiene campos no permitidos.'; end if;
      v_entity_id:=nullif(v_payload->>'customer_id',''); v_result:=public.activar_beneficio_cliente(v_payload);
    else raise exception 'Operación incremental no permitida: %',v_operation;
  end case;
  if nullif(btrim(coalesce(v_entity_id,'')),'') is null then raise exception 'La mutación no produjo una entidad.'; end if;
  insert into public.catalog_crm_delta_receipts(operation,idempotency_key,request_hash,domain,entity_ids,result,created_by)
  values(v_operation,v_key,v_hash,v_domain,array[v_entity_id],v_result,auth.uid());
  return public._momos_catalog_crm_mutation_response_v1(v_operation,v_key,false,v_result,v_domain,array[v_entity_id]);
end $$;
revoke all on function public.mutar_catalogo_crm_delta(jsonb) from public,anon,service_role;
grant execute on function public.mutar_catalogo_crm_delta(jsonb) to authenticated;

create or replace function public.catalogo_crm_deltas_disponibles()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
  select public.is_staff()
    and to_regprocedure('public.momos_product_catalog_deltas_v1(text[])') is not null
    and to_regprocedure('public.momos_customer_crm_deltas_v1(text[])') is not null
    and to_regprocedure('public.mutar_catalogo_crm_delta(jsonb)') is not null
    and exists(select 1 from public.momos_ops_migrations where id='20260719_74_catalogo_crm_deltas')
$$;
revoke all on function public.catalogo_crm_deltas_disponibles() from public,anon,service_role;
grant execute on function public.catalogo_crm_deltas_disponibles() to authenticated;

create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_capabilities jsonb; v_schema_version text; v_inventory_event_id bigint:=0;
begin
  if auth.uid() is null or not exists(select 1 from public.users u where u.auth_id=auth.uid() and u.activo) then
    raise exception 'Sesión MOMOS inválida.' using errcode='42501';
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
    'inventario_deltas_disponibles','pedidos_deltas_disponibles','producto_terminado_deltas_disponibles',
    'produccion_deltas_disponibles','catalogo_crm_deltas_disponibles'
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
declare v_table text;
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['product_catalog_sync_versions','customer_crm_sync_versions'] loop
      if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260719_74_catalogo_crm_deltas','Productos, recetas y ficha CRM devuelven únicamente la entidad modificada con versión, idempotencia y privacidad por dominio')
on conflict(id) do update set detalle=excluded.detalle;
commit;
