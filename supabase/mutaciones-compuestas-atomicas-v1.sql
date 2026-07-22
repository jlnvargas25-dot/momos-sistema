-- MOMOS OPS · H91 · mutaciones compuestas atómicas.
--
-- Cierra tres ventanas de consistencia que antes requerían dos llamadas HTTP:
--   1. Cocina completa sus líneas y entrega el pedido a Empaque.
--   2. Producción crea una corrida y atiende todas las sugerencias agrupadas.
--   3. Inventario registra una compra y atiende sus sugerencias de abastecimiento.
--
-- Cada contrato usa un recibo privado e idempotente. Si cualquier paso falla,
-- PostgreSQL revierte el conjunto completo; nunca queda stock sin tarea cerrada
-- ni una tarea cerrada sin su movimiento físico.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260720_90_dominio_productos_figuras') then
    raise exception 'Falta H90 dominio canónico de productos y figuras.';
  end if;
  if to_regprocedure('public.completar_etapa_pedido(text,text)') is null
     or to_regprocedure('public.set_order_status(text,text,boolean)') is null
     or to_regprocedure('public.crear_corrida_delta(jsonb)') is null
     or to_regprocedure('public.entrada_insumo_lote_delta(jsonb)') is null
     or to_regprocedure('public.set_sugerencia_estado(text,text)') is null then
    raise exception 'Faltan las RPC canónicas de Pedidos, Producción o Inventario.';
  end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'El servidor PostgreSQL no ofrece pg_catalog.sha256(bytea).';
  end if;
end $$;

create table if not exists public.compound_mutation_receipts(
  operation text not null check(operation in (
    'cocina_a_empaque','corrida_agrupada','compra_con_sugerencias'
  )),
  idempotency_key uuid not null,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(operation,idempotency_key)
);
alter table public.compound_mutation_receipts enable row level security;
revoke all on table public.compound_mutation_receipts
  from public,anon,authenticated,service_role;

create or replace function public._momos_h91_uuid(p_value text,p_label text)
returns uuid
language plpgsql immutable
set search_path=pg_catalog,public,pg_temp
as $$
declare v uuid;
begin
  begin v:=btrim(coalesce(p_value,''))::uuid;
  exception when invalid_text_representation then
    raise exception '% debe ser un UUID válido.',p_label;
  end;
  if v is null then raise exception '% es obligatorio.',p_label; end if;
  return v;
end $$;

create or replace function public._momos_h91_suggestion_ids(p_value jsonb)
returns text[]
language plpgsql immutable
set search_path=pg_catalog,public,pg_temp
as $$
declare v_ids text[];
begin
  if jsonb_typeof(p_value)<>'array' then
    raise exception 'suggestion_ids debe ser una lista.';
  end if;
  if jsonb_array_length(p_value) not between 1 and 50 then
    raise exception 'La operación necesita entre 1 y 50 sugerencias.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_value) x(value)
    where jsonb_typeof(x.value)<>'string'
      or nullif(btrim(x.value#>>'{}'),'') is null) then
    raise exception 'Cada suggestion_id debe ser texto no vacío.';
  end if;
  select array_agg(btrim(x.value#>>'{}') order by x.ord)
  into v_ids
  from jsonb_array_elements(p_value) with ordinality x(value,ord);
  if cardinality(v_ids)<>(select count(distinct id) from unnest(v_ids) id) then
    raise exception 'suggestion_ids no admite duplicados.';
  end if;
  return v_ids;
end $$;

revoke all on function public._momos_h91_uuid(text,text)
  from public,anon,authenticated,service_role;
revoke all on function public._momos_h91_suggestion_ids(jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.completar_cocina_y_entregar_empaque_v1(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_key uuid; v_hash text; v_receipt public.compound_mutation_receipts%rowtype;
  v_order_id text; v_state text; v_stage jsonb; v_status jsonb; v_response jsonb;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo.'; end if;
  if jsonb_typeof(p)<>'object' then raise exception 'El payload debe ser un objeto.'; end if;
  if exists(select 1 from jsonb_object_keys(p) x(key)
    where key not in ('idempotency_key','order_id')) then
    raise exception 'El payload contiene campos no permitidos.';
  end if;
  v_key:=public._momos_h91_uuid(p->>'idempotency_key','idempotency_key');
  v_order_id:=nullif(btrim(coalesce(p->>'order_id','')),'');
  if v_order_id is null then raise exception 'order_id es obligatorio.'; end if;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to((p-'idempotency_key')::text,'UTF8')),'hex');

  perform pg_advisory_xact_lock(hashtextextended('momos-h91:key:cocina_a_empaque:'||v_key::text,0));
  perform pg_advisory_xact_lock(hashtextextended('momos-h91:cocina:'||v_order_id,0));
  select * into v_receipt from public.compound_mutation_receipts
  where operation='cocina_a_empaque' and idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then
      raise exception 'La llave de idempotencia ya pertenece a otro contrato.';
    end if;
    return jsonb_set(v_receipt.response,'{duplicate}','true'::jsonb,true);
  end if;

  select estado into v_state from public.orders where id=v_order_id for update;
  if v_state is null then raise exception 'El pedido % no existe.',v_order_id; end if;
  if v_state='Listo para empaque' then
    v_stage:=jsonb_build_object('ok',true,'sin_cambio',true,'stage','Cocina');
    v_status:=jsonb_build_object('ok',true,'de',v_state,'a',v_state,'faltantes','[]'::jsonb);
  elsif v_state='En producción' then
    v_stage:=public.completar_etapa_pedido(v_order_id,'Cocina');
    v_status:=public.set_order_status(v_order_id,'Listo para empaque',false);
  else
    raise exception 'El pedido % está en "%"; solo Cocina en producción puede entregarlo a Empaque.',v_order_id,v_state;
  end if;

  v_response:=jsonb_build_object(
    'contract','momos.compound-mutation.v1','operation','cocina_a_empaque',
    'idempotencyKey',v_key::text,'duplicate',false,'orderId',v_order_id,
    'stage',v_stage,'status',v_status,'containsCustomerPii',false,
    'containsSecrets',false,'externalExecution',false
  );
  insert into public.compound_mutation_receipts(
    operation,idempotency_key,request_hash,response,created_by
  ) values('cocina_a_empaque',v_key,v_hash,v_response,auth.uid());
  return v_response;
end $$;

create or replace function public.crear_corrida_agrupada_v1(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_key uuid; v_hash text; v_receipt public.compound_mutation_receipts%rowtype;
  v_run jsonb; v_ids text[]; v_first text; v_production jsonb; v_response jsonb;
  v_run_products text[]; v_suggestion_products text[];
  i integer;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo.'; end if;
  if jsonb_typeof(p)<>'object' then raise exception 'El payload debe ser un objeto.'; end if;
  if exists(select 1 from jsonb_object_keys(p) x(key)
    where key not in ('idempotency_key','corrida','suggestion_ids')) then
    raise exception 'El payload contiene campos no permitidos.';
  end if;
  v_key:=public._momos_h91_uuid(p->>'idempotency_key','idempotency_key');
  if jsonb_typeof(p->'corrida')<>'object' then raise exception 'corrida debe ser un objeto.'; end if;
  v_run:=p->'corrida';
  if nullif(btrim(coalesce(v_run->>'idempotency_key','')),'') is null then
    raise exception 'La corrida necesita su propia idempotency_key.';
  end if;
  v_ids:=public._momos_h91_suggestion_ids(p->'suggestion_ids');
  v_first:=v_ids[1];
  if nullif(btrim(coalesce(v_run->>'sugerencia_id','')),'') is not null
     and btrim(v_run->>'sugerencia_id')<>v_first then
    raise exception 'sugerencia_id no coincide con la primera sugerencia agrupada.';
  end if;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to((p-'idempotency_key')::text,'UTF8')),'hex');

  perform pg_advisory_xact_lock(hashtextextended('momos-h91:key:corrida_agrupada:'||v_key::text,0));
  perform pg_advisory_xact_lock(hashtextextended(
    'momos-h91:corrida:'||(select string_agg(id,',' order by id) from unnest(v_ids) id),0));
  select * into v_receipt from public.compound_mutation_receipts
  where operation='corrida_agrupada' and idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then
      raise exception 'La llave de idempotencia ya pertenece a otro contrato.';
    end if;
    return jsonb_set(v_receipt.response,'{duplicate}','true'::jsonb,true);
  end if;

  perform 1 from public.production_suggestions
  where id=any(v_ids) order by id for update;
  if (select count(*) from public.production_suggestions where id=any(v_ids))<>cardinality(v_ids) then
    raise exception 'Una o más sugerencias no existen.';
  end if;
  if exists(select 1 from public.production_suggestions
    where id=any(v_ids) and (area<>'Producción' or estado<>'Pendiente')) then
    raise exception 'Las sugerencias de la corrida deben estar Pendientes y pertenecer a Producción.';
  end if;
  if jsonb_typeof(v_run->'figuras')<>'array' or jsonb_array_length(v_run->'figuras')=0 then
    raise exception 'La corrida necesita figuras exactas.';
  end if;
  select coalesce(array_agg(distinct f.product_id order by f.product_id),array[]::text[])
  into v_run_products
  from jsonb_array_elements(v_run->'figuras') x
  join public.figuras f on f.nombre=btrim(x->>'figura') and f.activo
  where coalesce((x->>'cant')::numeric,0)>0;
  if cardinality(v_run_products)=0 then raise exception 'La corrida no resolvió figuras activas.'; end if;
  select coalesce(array_agg(distinct s.product_id order by s.product_id),array[]::text[])
  into v_suggestion_products from public.production_suggestions s where s.id=any(v_ids);
  if exists(select 1 from unnest(v_suggestion_products) product_id
    where product_id is null or product_id<>all(v_run_products)) then
    raise exception 'Una sugerencia no corresponde a las figuras de esta corrida.';
  end if;
  if exists(
    select 1 from public.production_suggestions s
    join public.order_items oi on oi.id=s.order_item_id
    where s.id=any(v_ids) and (
      lower(btrim(coalesce(oi.sabor,'')))<>lower(btrim(coalesce(v_run->>'sabor','')))
      or (nullif(btrim(coalesce(oi.relleno,'')),'') is not null
        and lower(btrim(oi.relleno))<>lower(btrim(coalesce(v_run->>'relleno',''))))
    )
  ) then raise exception 'Una sugerencia no coincide con el sabor o relleno de la corrida.'; end if;

  v_run:=jsonb_set(v_run,'{sugerencia_id}',to_jsonb(v_first),true);
  v_production:=public.crear_corrida_delta(v_run);
  if cardinality(v_ids)>1 then
    for i in 2..cardinality(v_ids) loop
      perform public.set_sugerencia_estado(v_ids[i],'Atendida');
    end loop;
  end if;
  v_production:=jsonb_set(
    v_production,'{activity}',public.momos_production_activity_delta_v1(),true
  );
  v_response:=jsonb_build_object(
    'contract','momos.compound-mutation.v1','operation','corrida_agrupada',
    'idempotencyKey',v_key::text,'duplicate',false,'production',v_production,
    'suggestionIds',to_jsonb(v_ids),'suggestionCount',cardinality(v_ids),
    'containsCustomerPii',false,'containsSecrets',false,'externalExecution',false
  );
  insert into public.compound_mutation_receipts(
    operation,idempotency_key,request_hash,response,created_by
  ) values('corrida_agrupada',v_key,v_hash,v_response,auth.uid());
  return v_response;
end $$;

create or replace function public.registrar_compra_y_atender_sugerencias_v1(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_key uuid; v_hash text; v_receipt public.compound_mutation_receipts%rowtype;
  v_purchase jsonb; v_ids text[]; v_item_id text; v_inventory jsonb; v_response jsonb;
  v_suggestion_id text;
begin
  if public.is_staff() is not true then raise exception 'Solo staff activo.'; end if;
  if jsonb_typeof(p)<>'object' then raise exception 'El payload debe ser un objeto.'; end if;
  if exists(select 1 from jsonb_object_keys(p) x(key)
    where key not in ('idempotency_key','compra','suggestion_ids')) then
    raise exception 'El payload contiene campos no permitidos.';
  end if;
  v_key:=public._momos_h91_uuid(p->>'idempotency_key','idempotency_key');
  if jsonb_typeof(p->'compra')<>'object' then raise exception 'compra debe ser un objeto.'; end if;
  v_purchase:=p->'compra';
  v_item_id:=nullif(btrim(coalesce(v_purchase->>'item_id','')),'');
  if v_item_id is null then raise exception 'compra.item_id es obligatorio.'; end if;
  if v_purchase ? 'idempotency_key' then
    raise exception 'La idempotencia de la compra se deriva del contrato compuesto.';
  end if;
  v_ids:=public._momos_h91_suggestion_ids(p->'suggestion_ids');
  v_hash:=pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to((p-'idempotency_key')::text,'UTF8')),'hex');

  perform pg_advisory_xact_lock(hashtextextended('momos-h91:key:compra_con_sugerencias:'||v_key::text,0));
  perform pg_advisory_xact_lock(hashtextextended(
    'momos-h91:compra:'||(select string_agg(id,',' order by id) from unnest(v_ids) id),0));
  select * into v_receipt from public.compound_mutation_receipts
  where operation='compra_con_sugerencias' and idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then
      raise exception 'La llave de idempotencia ya pertenece a otro contrato.';
    end if;
    return jsonb_set(v_receipt.response,'{duplicate}','true'::jsonb,true);
  end if;

  perform 1 from public.production_suggestions
  where id=any(v_ids) order by id for update;
  if (select count(*) from public.production_suggestions where id=any(v_ids))<>cardinality(v_ids) then
    raise exception 'Una o más sugerencias no existen.';
  end if;
  if exists(select 1 from public.production_suggestions
    where id=any(v_ids) and (
      area<>'Inventario' or estado<>'Pendiente' or item_id is distinct from v_item_id
    )) then
    raise exception 'Las sugerencias deben estar Pendientes y corresponder al mismo insumo comprado.';
  end if;

  v_inventory:=public.entrada_insumo_lote_delta(
    v_purchase||jsonb_build_object('idempotency_key',v_key::text)
  );
  foreach v_suggestion_id in array v_ids loop
    perform public.set_sugerencia_estado(v_suggestion_id,'Atendida');
  end loop;
  v_response:=jsonb_build_object(
    'contract','momos.compound-mutation.v1','operation','compra_con_sugerencias',
    'idempotencyKey',v_key::text,'duplicate',false,'inventory',v_inventory,
    'suggestionIds',to_jsonb(v_ids),'suggestionCount',cardinality(v_ids),
    'containsCustomerPii',false,'containsSecrets',false,'externalExecution',false
  );
  insert into public.compound_mutation_receipts(
    operation,idempotency_key,request_hash,response,created_by
  ) values('compra_con_sugerencias',v_key,v_hash,v_response,auth.uid());
  return v_response;
end $$;

create or replace function public.mutaciones_compuestas_atomicas_disponibles()
returns boolean
language sql stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select public.is_staff() is true
    and exists(select 1 from public.momos_ops_migrations
      where id='20260721_91_mutaciones_compuestas_atomicas')
    and to_regclass('public.compound_mutation_receipts') is not null
$$;

revoke all on function public.completar_cocina_y_entregar_empaque_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.crear_corrida_agrupada_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.registrar_compra_y_atender_sugerencias_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.mutaciones_compuestas_atomicas_disponibles()
  from public,anon,authenticated,service_role;
grant execute on function public.completar_cocina_y_entregar_empaque_v1(jsonb)
  to authenticated;
grant execute on function public.crear_corrida_agrupada_v1(jsonb)
  to authenticated;
grant execute on function public.registrar_compra_y_atender_sugerencias_v1(jsonb)
  to authenticated;
grant execute on function public.mutaciones_compuestas_atomicas_disponibles()
  to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260721_91_mutaciones_compuestas_atomicas',
  'Cocina a Empaque, corridas agrupadas y compras con sugerencias en una sola transacción idempotente'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
