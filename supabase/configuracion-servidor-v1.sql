-- MOMOS OPS · H76 Configuración autoritativa, compacta e idempotente
-- Una lectura administrativa, una mutación cerrada y un outbox sin datos de negocio.
begin;

select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260719_75_finanzas_operativas') then
    raise exception 'Falta el paso 75_finanzas_operativas.';
  end if;
  if to_regprocedure('public.is_admin()') is null or to_regprocedure('public._add_audit(text,text,text,text,text)') is null then
    raise exception 'Faltan las guardas administrativas o la auditoría canónica.';
  end if;
end $$;

create table if not exists public.configuration_sync_state(
  id smallint primary key check(id=1),
  version bigint not null default 1 check(version>0),
  changed_at timestamptz not null default clock_timestamp()
);
insert into public.configuration_sync_state(id,version) values(1,1)
on conflict(id) do nothing;
alter table public.configuration_sync_state enable row level security;
drop policy if exists configuration_sync_state_admin_read on public.configuration_sync_state;
create policy configuration_sync_state_admin_read on public.configuration_sync_state
for select to authenticated using(public.is_admin());
revoke all on table public.configuration_sync_state from public,anon,authenticated,service_role;
grant select on table public.configuration_sync_state to authenticated;

create or replace function public._touch_configuration_sync_state()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  update public.configuration_sync_state
  set version=version+1,changed_at=clock_timestamp() where id=1;
  return null;
end $$;
revoke all on function public._touch_configuration_sync_state() from public,anon,authenticated,service_role;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'app_settings','zonas','catalog_values','proveedores_domicilio','figuras','toppings','users'
  ] loop
    execute format('drop trigger if exists %I on public.%I','configuration_sync_touch_'||v_table,v_table);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each statement execute function public._touch_configuration_sync_state()',
      'configuration_sync_touch_'||v_table,v_table
    );
  end loop;
end $$;

create table if not exists public.configuration_mutation_receipts(
  idempotency_key uuid primary key,
  request_hash text not null,
  response jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.configuration_mutation_receipts enable row level security;
revoke all on table public.configuration_mutation_receipts from public,anon,authenticated,service_role;

create or replace function public.momos_configuration_snapshot_v1()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_version bigint;
  v_settings jsonb;
  v_users jsonb;
  v_activity jsonb;
  v_inventory jsonb;
  v_products jsonb;
begin
  if public.is_admin() is not true then
    raise exception 'Solo Administración puede consultar Configuración.' using errcode='42501';
  end if;
  select version into v_version from public.configuration_sync_state where id=1;

  select jsonb_build_object(
    'zones',coalesce((select jsonb_agg(jsonb_build_object('name',z.nombre,'fee',z.tarifa) order by z.nombre) from public.zonas z),'[]'::jsonb),
    'catalogs',jsonb_build_object(
      'fruitFlavors',coalesce((select jsonb_agg(c.valor order by c.orden,c.valor) from public.catalog_values c where c.categoria='sabor_frutal' and c.activo),'[]'::jsonb),
      'creamyFlavors',coalesce((select jsonb_agg(c.valor order by c.orden,c.valor) from public.catalog_values c where c.categoria='sabor_cremoso' and c.activo),'[]'::jsonb),
      'sauces',coalesce((select jsonb_agg(c.valor order by c.orden,c.valor) from public.catalog_values c where c.categoria='salsa' and c.activo),'[]'::jsonb),
      'payments',coalesce((select jsonb_agg(c.valor order by c.orden,c.valor) from public.catalog_values c where c.categoria='pago' and c.activo),'[]'::jsonb),
      'deliveryProviders',coalesce((select jsonb_agg(p.nombre order by p.orden,p.nombre) from public.proveedores_domicilio p where p.activo),'[]'::jsonb)
    ),
    'fixedFilling',coalesce((select nullif(valor#>>'{}','') from public.app_settings where clave='relleno_fijo'),''),
    'figures',coalesce((select jsonb_agg(jsonb_build_object(
      'name',f.nombre,'species',f.especie,'grams',f.gramaje_g,'productId',f.product_id,'active',f.activo
    ) order by f.orden,f.nombre) from public.figuras f),'[]'::jsonb),
    'toppings',coalesce((select jsonb_agg(jsonb_build_object(
      'name',t.nombre,'price',t.precio,'inventoryItemId',coalesce(t.insumo_id,''),'inventoryQuantity',t.insumo_cant,'active',t.activo
    ) order by t.orden,t.nombre) from public.toppings t),'[]'::jsonb),
    'orderMinimum',coalesce((select (valor#>>'{}')::numeric from public.app_settings where clave='pedido_minimo'),25000),
    'freezingHours',coalesce((select (valor#>>'{}')::integer from public.app_settings where clave='horas_congelacion'),10),
    'delays',jsonb_build_object(
      'kitchenWarning',coalesce((select (valor#>>'{}')::integer from public.app_settings where clave='demora_cocina_min'),15),
      'kitchenUrgent',coalesce((select (valor#>>'{}')::integer from public.app_settings where clave='demora_cocina_urgente_min'),30),
      'packingWarning',coalesce((select (valor#>>'{}')::integer from public.app_settings where clave='demora_empaque_min'),10),
      'packingUrgent',coalesce((select (valor#>>'{}')::integer from public.app_settings where clave='demora_empaque_urgente_min'),20),
      'repeatEvery',coalesce((select (valor#>>'{}')::integer from public.app_settings where clave='demora_repeticion_min'),5)
    ),
    'policies',coalesce((select valor#>>'{}' from public.app_settings where clave='politicas'),'')
  ) into v_settings;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',u.id,'name',u.nombre,'email',u.email,'primaryRole',u.rol,
    'roles',coalesce(to_jsonb(u.roles),jsonb_build_array(u.rol)),'active',u.activo
  ) order by u.nombre,u.id),'[]'::jsonb) into v_users from public.users u;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'at',x.fecha,'actor',coalesce(x.actor,'Sistema'),'entity',x.entidad,
    'entityId',x.entidad_id,'action',x.accion
  ) order by x.fecha desc,x.id desc),'[]'::jsonb) into v_activity
  from (select a.*,u.nombre actor from public.audit_logs a left join public.users u on u.id=a.user_id order by a.fecha desc,a.id desc limit 30) x;

  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.nombre,'unit',i.unidad) order by i.nombre,i.id),'[]'::jsonb)
  into v_inventory from public.inventory_items i;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.nombre,'species',p.especie) order by p.nombre,p.id),'[]'::jsonb)
  into v_products from public.products p where p.tipo='momo' and p.activo;

  return jsonb_build_object(
    'contract','momos.configuration-snapshot.v1','version',1,'snapshotVersion',v_version::text,
    'serverTime',clock_timestamp(),'settings',v_settings,'staff',v_users,'activity',v_activity,
    'inventoryChoices',v_inventory,'figureProductChoices',v_products,
    'containsCustomerPii',false,'containsStaffPii',true,'containsFreeText',true,
    'containsStorageReferences',false,'containsSecrets',false,'externalExecution',false
  );
end $$;
revoke all on function public.momos_configuration_snapshot_v1() from public,anon,service_role;
grant execute on function public.momos_configuration_snapshot_v1() to authenticated;

create or replace function public.guardar_configuracion_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_key uuid;
  v_hash text;
  v_payload jsonb;
  v_expected bigint;
  v_current bigint;
  v_receipt public.configuration_mutation_receipts%rowtype;
  v_snapshot jsonb;
  v_response jsonb;
  v_catalog jsonb;
  v_values jsonb;
  v_category text;
  v_name text;
  v_fixed text;
  v_order_min numeric;
  v_freezing integer;
  v_policies text;
  v_delays jsonb;
  v_kw integer; v_ku integer; v_pw integer; v_pu integer; v_repeat integer;
begin
  if public.is_admin() is not true then raise exception 'Solo Administración puede cambiar Configuración.' using errcode='42501'; end if;
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in ('idempotency_key','expected_version','payload')) then
    raise exception 'La solicitud de Configuración no cumple el contrato cerrado.';
  end if;
  begin v_key:=(p->>'idempotency_key')::uuid; exception when others then raise exception 'La llave idempotente no es UUID.'; end;
  if v_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'La llave idempotente debe ser UUID v4.'; end if;
  if coalesce(p->>'expected_version','') !~ '^\d+$' then raise exception 'Falta la versión esperada de Configuración.'; end if;
  v_expected:=(p->>'expected_version')::bigint;
  v_payload:=p->'payload';
  if jsonb_typeof(v_payload) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(v_payload) x(key) where key not in (
       'zones','catalogs','fixed_filling','figures','toppings','order_minimum','freezing_hours','delays','policies'
     ))
     or (select count(*) from jsonb_object_keys(v_payload))<>9 then
    raise exception 'El contenido de Configuración no cumple el contrato cerrado.';
  end if;
  v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('momos-configuration:'||v_key::text,0));
  select * into v_receipt from public.configuration_mutation_receipts where idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then raise exception 'La llave idempotente ya pertenece a otra configuración.'; end if;
    return jsonb_set(v_receipt.response,'{duplicate}','true'::jsonb,true);
  end if;
  select version into v_current from public.configuration_sync_state where id=1 for update;
  if v_current<>v_expected then raise exception 'Configuración cambió en otra sesión. Recargá antes de guardar.' using errcode='40001'; end if;

  if jsonb_typeof(v_payload->'zones') is distinct from 'array'
     or jsonb_array_length(v_payload->'zones')<>(select count(*) from public.zonas)
     or exists(select 1 from jsonb_array_elements(v_payload->'zones') e(value)
       where jsonb_typeof(e.value) is distinct from 'object'
          or exists(select 1 from jsonb_object_keys(e.value) k(key) where key not in ('name','fee'))
          or (select count(*) from jsonb_object_keys(e.value))<>2
          or nullif(btrim(e.value->>'name'),'') is null
          or coalesce(e.value->>'fee','') !~ '^\d+(\.\d+)?$'
          or (e.value->>'fee')::numeric<0)
     or (select count(distinct e.value->>'name') from jsonb_array_elements(v_payload->'zones') e(value))<>(select count(*) from public.zonas)
     or exists(select 1 from jsonb_array_elements(v_payload->'zones') e(value) where not exists(select 1 from public.zonas z where z.nombre=e.value->>'name')) then
    raise exception 'Las zonas no coinciden con el catálogo vigente.';
  end if;

  v_catalog:=v_payload->'catalogs';
  if jsonb_typeof(v_catalog) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(v_catalog) x(key) where key not in ('fruit_flavors','creamy_flavors','sauces','payments','delivery_providers'))
     or (select count(*) from jsonb_object_keys(v_catalog))<>5 then
    raise exception 'Los catálogos no cumplen el contrato cerrado.';
  end if;
  foreach v_name in array array['fruit_flavors','creamy_flavors','sauces','payments','delivery_providers'] loop
    v_values:=v_catalog->v_name;
    if jsonb_typeof(v_values) is distinct from 'array'
       or (v_name<>'sauces' and jsonb_array_length(v_values)=0)
       or jsonb_array_length(v_values)>100
       or exists(select 1 from jsonb_array_elements(v_values) e(value) where jsonb_typeof(e.value)<>'string' or length(btrim(e.value#>>'{}')) not between 1 and 100)
       or (select count(distinct lower(btrim(e.value#>>'{}'))) from jsonb_array_elements(v_values) e(value))<>jsonb_array_length(v_values) then
      raise exception 'El catálogo % contiene valores inválidos o repetidos.',v_name;
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements_text(v_catalog->'payments') p(value) where lower(btrim(p.value))='efectivo') then
    raise exception 'MOMOS no permite Efectivo como método de pago.';
  end if;

  v_fixed:=btrim(coalesce(v_payload->>'fixed_filling',''));
  if length(v_fixed) not between 1 and 100 then raise exception 'Debe existir un relleno fijo válido.'; end if;
  if jsonb_typeof(v_payload->'figures') is distinct from 'array' or jsonb_array_length(v_payload->'figures')=0
     or jsonb_array_length(v_payload->'figures')>100
     or exists(select 1 from jsonb_array_elements(v_payload->'figures') e(value)
       where jsonb_typeof(e.value)<>'object'
          or exists(select 1 from jsonb_object_keys(e.value) k(key) where key not in ('name','species','grams','product_id'))
          or (select count(*) from jsonb_object_keys(e.value))<>4
          or length(btrim(coalesce(e.value->>'name',''))) not between 1 and 80
          or coalesce(e.value->>'species','') not in ('gato','perro')
          or coalesce(e.value->>'grams','') !~ '^\d+$'
          or (e.value->>'grams')::integer not between 1 and 5000
          or not exists(select 1 from public.products pr where pr.id=e.value->>'product_id' and pr.activo and pr.tipo='momo' and pr.especie=e.value->>'species'))
     or (select count(distinct lower(btrim(e.value->>'name'))) from jsonb_array_elements(v_payload->'figures') e(value))<>jsonb_array_length(v_payload->'figures') then
    raise exception 'Las figuras requieren nombre, especie, gramaje y producto compatibles.';
  end if;

  if jsonb_typeof(v_payload->'toppings') is distinct from 'array' or jsonb_array_length(v_payload->'toppings')>100
     or exists(select 1 from jsonb_array_elements(v_payload->'toppings') e(value)
       where jsonb_typeof(e.value)<>'object'
          or exists(select 1 from jsonb_object_keys(e.value) k(key) where key not in ('name','price','inventory_item_id','inventory_quantity'))
          or (select count(*) from jsonb_object_keys(e.value))<>4
          or length(btrim(coalesce(e.value->>'name',''))) not between 1 and 100
          or coalesce(e.value->>'price','') !~ '^\d+(\.\d+)?$' or (e.value->>'price')::numeric<0
          or coalesce(e.value->>'inventory_quantity','') !~ '^\d+(\.\d+)?$' or (e.value->>'inventory_quantity')::numeric<0
          or (nullif(e.value->>'inventory_item_id','') is not null and not exists(select 1 from public.inventory_items i where i.id=e.value->>'inventory_item_id')))
     or (select count(distinct lower(btrim(e.value->>'name'))) from jsonb_array_elements(v_payload->'toppings') e(value))<>jsonb_array_length(v_payload->'toppings') then
    raise exception 'Los toppings contienen datos inválidos o repetidos.';
  end if;

  begin v_order_min:=(v_payload->>'order_minimum')::numeric; exception when others then raise exception 'Pedido mínimo inválido.'; end;
  begin v_freezing:=(v_payload->>'freezing_hours')::integer; exception when others then raise exception 'Horas de congelación inválidas.'; end;
  v_policies:=btrim(coalesce(v_payload->>'policies',''));
  if v_order_min<0 or v_order_min>100000000 or v_freezing not between 1 and 240 or length(v_policies) not between 1 and 4000 then
    raise exception 'Las reglas escalares de Configuración son inválidas.';
  end if;
  v_delays:=v_payload->'delays';
  if jsonb_typeof(v_delays) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(v_delays) x(key) where key not in ('kitchen_warning','kitchen_urgent','packing_warning','packing_urgent','repeat_every'))
     or (select count(*) from jsonb_object_keys(v_delays))<>5 then raise exception 'Los tiempos no cumplen el contrato cerrado.'; end if;
  begin
    v_kw:=(v_delays->>'kitchen_warning')::integer; v_ku:=(v_delays->>'kitchen_urgent')::integer;
    v_pw:=(v_delays->>'packing_warning')::integer; v_pu:=(v_delays->>'packing_urgent')::integer;
    v_repeat:=(v_delays->>'repeat_every')::integer;
  exception when others then raise exception 'Los tiempos deben ser enteros.'; end;
  if least(v_kw,v_ku,v_pw,v_pu,v_repeat)<1 or greatest(v_kw,v_ku,v_pw,v_pu,v_repeat)>1440 or v_ku<v_kw or v_pu<v_pw then
    raise exception 'Los tiempos de aviso y urgencia son inconsistentes.';
  end if;

  update public.zonas z set tarifa=e.fee
  from jsonb_to_recordset(v_payload->'zones') as e(name text,fee numeric) where z.nombre=e.name;

  foreach v_name in array array['fruit_flavors','creamy_flavors','sauces','payments'] loop
    v_category:=case v_name when 'fruit_flavors' then 'sabor_frutal' when 'creamy_flavors' then 'sabor_cremoso' when 'sauces' then 'salsa' else 'pago' end;
    v_values:=v_catalog->v_name;
    update public.catalog_values set activo=false where categoria=v_category and activo;
    insert into public.catalog_values(categoria,valor,orden,activo)
    select v_category,btrim(x.value),x.ord-1,true from jsonb_array_elements_text(v_values) with ordinality x(value,ord)
    on conflict(categoria,valor) do update set orden=excluded.orden,activo=true;
  end loop;
  update public.proveedores_domicilio set activo=false where activo;
  insert into public.proveedores_domicilio(nombre,orden,activo)
  select btrim(x.value),x.ord-1,true from jsonb_array_elements_text(v_catalog->'delivery_providers') with ordinality x(value,ord)
  on conflict(nombre) do update set orden=excluded.orden,activo=true;

  insert into public.app_settings(clave,valor) values
    ('relleno_fijo',to_jsonb(v_fixed)),('pedido_minimo',to_jsonb(v_order_min)),
    ('horas_congelacion',to_jsonb(v_freezing)),('demora_cocina_min',to_jsonb(v_kw)),
    ('demora_cocina_urgente_min',to_jsonb(v_ku)),('demora_empaque_min',to_jsonb(v_pw)),
    ('demora_empaque_urgente_min',to_jsonb(v_pu)),('demora_repeticion_min',to_jsonb(v_repeat)),
    ('politicas',to_jsonb(v_policies))
  on conflict(clave) do update set valor=excluded.valor;

  update public.figuras set activo=false where activo;
  insert into public.figuras(nombre,especie,gramaje_g,product_id,orden,activo)
  select btrim(x.value->>'name'),x.value->>'species',(x.value->>'grams')::integer,
    x.value->>'product_id',x.ord-1,true
  from jsonb_array_elements(v_payload->'figures') with ordinality as x(value,ord)
  on conflict(nombre) do update set especie=excluded.especie,gramaje_g=excluded.gramaje_g,product_id=excluded.product_id,orden=excluded.orden,activo=true;

  update public.toppings set activo=false where activo;
  insert into public.toppings(nombre,precio,insumo_id,insumo_cant,orden,activo)
  select btrim(x.value->>'name'),(x.value->>'price')::numeric,
    nullif(x.value->>'inventory_item_id',''),(x.value->>'inventory_quantity')::numeric,x.ord-1,true
  from jsonb_array_elements(v_payload->'toppings') with ordinality as x(value,ord)
  on conflict(nombre) do update set precio=excluded.precio,insumo_id=excluded.insumo_id,insumo_cant=excluded.insumo_cant,orden=excluded.orden,activo=true;

  perform public._add_audit('Configuración','general','Configuración guardada','versión '||v_expected::text,'servidor');
  v_snapshot:=public.momos_configuration_snapshot_v1();
  v_response:=jsonb_build_object('contract','momos.configuration-mutation.v1','version',1,'duplicate',false,'snapshot',v_snapshot);
  insert into public.configuration_mutation_receipts(idempotency_key,request_hash,response,created_by)
  values(v_key,v_hash,v_response,auth.uid());
  return v_response;
end $$;
revoke all on function public.guardar_configuracion_v1(jsonb) from public,anon,service_role;
grant execute on function public.guardar_configuracion_v1(jsonb) to authenticated;

create or replace function public.configuracion_servidor_disponible()
returns boolean language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
  select public.is_admin()
    and to_regprocedure('public.momos_configuration_snapshot_v1()') is not null
    and to_regprocedure('public.guardar_configuracion_v1(jsonb)') is not null
    and exists(select 1 from public.momos_ops_migrations where id='20260719_76_configuracion_servidor')
$$;
revoke all on function public.configuracion_servidor_disponible() from public,anon,service_role;
grant execute on function public.configuracion_servidor_disponible() to authenticated;

-- Las lecturas siguen disponibles según RLS; toda escritura pasa por RPC auditada.
revoke insert,update,delete,truncate,references,trigger on table
  public.app_settings,public.zonas,public.catalog_values,public.proveedores_domicilio,public.figuras,public.toppings
from public,anon,authenticated,service_role;

create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_capabilities jsonb; v_schema_version text; v_inventory_event_id bigint:=0; v_finance_version bigint:=0; v_configuration_version bigint:=0;
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
    'produccion_deltas_disponibles','catalogo_crm_deltas_disponibles','finanzas_operativas_disponibles','configuracion_servidor_disponible'
  ]::text[]) x(name);
  select id into v_schema_version from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  select version into v_finance_version from public.finance_sync_state where id=1;
  select version into v_configuration_version from public.configuration_sync_state where id=1;
  v_inventory_event_id:=4611686018427387904+((pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot()))::text)::bigint;
  return jsonb_build_object(
    'version',1,'schema_version',coalesce(v_schema_version,''),'server_time',clock_timestamp(),
    'capabilities',v_capabilities,'inventory_latest_event_id',v_inventory_event_id::text,
    'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object('version',extract(epoch from clock_timestamp())::bigint,'ttl_seconds',60,'inventory_latest_event_id',v_inventory_event_id::text),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300),
      'finanzas',jsonb_build_object('version',coalesce(v_finance_version,0)::text,'ttl_seconds',60),
      'configuracion',jsonb_build_object('version',coalesce(v_configuration_version,0)::text,'ttl_seconds',300)
    ),'contains_pii',false,'contains_secrets',false,'external_execution',false
  );
end $$;
revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='configuration_sync_state') then
    alter publication supabase_realtime add table public.configuration_sync_state;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260719_76_configuracion_servidor','Configuración compacta, guardado versionado idempotente, auditoría y outbox Realtime administrativo')
on conflict(id) do update set detalle=excluded.detalle;

commit;
