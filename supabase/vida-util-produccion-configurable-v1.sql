-- MOMOS OPS · H83 Vida útil configurable y sellada por lote.
-- Valores iniciales aprobados: producto terminado 6 días; mezclas 5 días.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260719_82_domicilios_mutaciones_atomicas') then
    raise exception 'Falta el paso 82_domicilios_mutaciones_atomicas.';
  end if;
  if to_regprocedure('public.momos_configuration_snapshot_v1()') is null
     or to_regprocedure('public.guardar_configuracion_v1(jsonb)') is null
     or to_regprocedure('public._create_inventory_lot(text,numeric,text,text,date,text,text,numeric)') is null
     or to_regprocedure('public._sync_inventory_item_expiry(text)') is null then
    raise exception 'Faltan Configuración H76 o lotes de inventario H68.';
  end if;
end $$;

insert into public.app_settings(clave,valor) values
  ('vida_util_producto_terminado_dias',to_jsonb(6::integer)),
  ('vida_util_mezclas_dias',to_jsonb(5::integer))
on conflict(clave) do nothing;

alter table public.production_batches
  add column if not exists vida_util_dias smallint;
alter table public.inventory_lots
  add column if not exists vida_util_dias smallint;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='production_batches_shelf_life_days_check' and conrelid='public.production_batches'::regclass) then
    alter table public.production_batches add constraint production_batches_shelf_life_days_check
      check(vida_util_dias is null or vida_util_dias between 1 and 30);
  end if;
  if not exists(select 1 from pg_constraint where conname='inventory_lots_shelf_life_days_check' and conrelid='public.inventory_lots'::regclass) then
    alter table public.inventory_lots add constraint inventory_lots_shelf_life_days_check
      check(vida_util_dias is null or vida_util_dias between 1 and 30);
  end if;
end $$;

comment on column public.production_batches.vida_util_dias is
  'Vida útil sellada al primer desmolde. Cambiar Configuración no rejuvenece lotes ya fechados.';
comment on column public.production_batches.vence is
  'Fecha de vencimiento: primer desmolde en Bogotá + vida_util_dias sellada para el lote.';
comment on column public.inventory_lots.vida_util_dias is
  'Vida útil sellada para elaboraciones internas; queda nula en insumos comprados con vencimiento del proveedor.';

create or replace function public.enforce_finished_product_expiry()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_expiry date;
  v_days integer;
  v_explicit date;
begin
  if tg_op='UPDATE' and old.desmoldado_en is not null then
    new.desmoldado_en:=old.desmoldado_en;
    -- Una fila anterior a H83 puede sellarse una única vez durante el backfill.
    if old.vida_util_dias is not null then
      new.vida_util_dias:=old.vida_util_dias;
    end if;
  end if;

  if tg_op='UPDATE' and new.desmoldado_en is null
     and new.estado='Listo' and new.stock_contabilizado=true
     and (old.estado is distinct from 'Listo' or old.stock_contabilizado is distinct from true) then
    new.desmoldado_en:=clock_timestamp();
  end if;

  if tg_op='INSERT' and new.desmoldado_en is null
     and new.estado='Listo' and new.stock_contabilizado=true
     and new.vence is null and new.vencimiento is null then
    new.desmoldado_en:=clock_timestamp();
  end if;

  if new.desmoldado_en is null then
    if new.estado not in ('Listo','Reservado','Vendido','Imperfecto','Descartado') then
      new.vence:=null;
      new.vencimiento:=null;
      new.vida_util_dias:=null;
    end if;
    return new;
  end if;

  if new.vida_util_dias is null then
    v_explicit:=coalesce(new.vence,new.vencimiento);
    if tg_op='INSERT' and v_explicit is not null
       and v_explicit-(new.desmoldado_en at time zone 'America/Bogota')::date between 1 and 30 then
      v_days:=v_explicit-(new.desmoldado_en at time zone 'America/Bogota')::date;
    else
      select coalesce((s.valor#>>'{}')::integer,6) into v_days
      from public.app_settings s where s.clave='vida_util_producto_terminado_dias';
      v_days:=coalesce(v_days,6);
    end if;
    if v_days not between 1 and 30 then raise exception 'Vida útil de producto terminado inválida: %.',v_days; end if;
    new.vida_util_dias:=v_days;
  end if;

  v_expiry:=(new.desmoldado_en at time zone 'America/Bogota')::date+new.vida_util_dias;
  new.vence:=v_expiry;
  new.vencimiento:=v_expiry;
  return new;
end;
$$;
revoke all on function public.enforce_finished_product_expiry() from public,anon,authenticated,service_role;

drop trigger if exists production_batches_finished_expiry_guard on public.production_batches;
create trigger production_batches_finished_expiry_guard
before insert or update on public.production_batches
for each row execute function public.enforce_finished_product_expiry();

-- Primera adopción de la política aprobada: los lotes existentes pasan de la
-- regla histórica de 3 días al valor inicial configurado. Después quedan sellados.
update public.production_batches
set vida_util_dias=coalesce((
  select (s.valor#>>'{}')::integer
  from public.app_settings s
  where s.clave='vida_util_producto_terminado_dias'
),6)
where desmoldado_en is not null and vida_util_dias is null;

-- Todas las elaboraciones internas existentes con saldo adoptan la regla de
-- valor inicial desde su recepción/producción. Futuras tandas sellan el valor vigente.
update public.inventory_lots l
set vida_util_dias=coalesce((
    select (s.valor#>>'{}')::integer
    from public.app_settings s
    where s.clave='vida_util_mezclas_dias'
  ),5),
  expires_at=l.received_at+coalesce((
  select (s.valor#>>'{}')::integer
  from public.app_settings s
  where s.clave='vida_util_mezclas_dias'
),5)
from public.subrecetas sr
where sr.item_id=l.item_id and l.available_quantity>0 and l.vida_util_dias is null;

do $$
declare r record;
begin
  for r in select distinct sr.item_id from public.subrecetas sr loop
    perform public._sync_inventory_item_expiry(r.item_id);
  end loop;
end $$;

-- H68 preservado: una entrada que nace de producir_subreceta crea el lote con
-- vencimiento explícito. El resto de entradas, devoluciones y FIFO no cambia.
create or replace function public._add_movement(
  p_tipo text,p_item_id text,p_cant numeric,p_nota text default '',
  p_order_id text default null,p_batch_id text default null
) returns void
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_id text;
  v_lot_id text;
  v_remaining numeric;
  v_origin text;
  v_expires date;
  v_mix_days integer;
begin
  if p_cant is null or p_cant=0
     or p_cant::text in ('NaN','Infinity','-Infinity') then
    raise exception 'La cantidad del movimiento debe ser finita y distinta de cero.';
  end if;
  perform 1 from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'El insumo % no existe.',p_item_id; end if;

  v_id:=public.next_id('movement','M',2);
  insert into public.inventory_movements(id,tipo,item_id,cant,nota,order_id,batch_id)
  values(v_id,p_tipo,p_item_id,p_cant,p_nota,p_order_id,p_batch_id);

  if p_cant<0 then
    perform public._consume_inventory_lots(v_id,p_item_id,-p_cant,p_tipo);
  elsif p_cant>0 then
    v_remaining:=public._restore_inventory_lots(v_id,p_order_id,p_item_id,p_cant);
    if v_remaining>0 then
      v_origin:=case when p_order_id is not null then 'Devolución' when p_tipo='Ajuste' then 'Ajuste' else 'Producción' end;
      v_expires:=null;
      if p_tipo='Entrada' and p_order_id is null and p_batch_id is null
         and p_nota like 'Producción subreceta %'
         and exists(select 1 from public.subrecetas sr where sr.item_id=p_item_id and sr.activo) then
        select coalesce((s.valor#>>'{}')::integer,5) into v_mix_days
        from public.app_settings s where s.clave='vida_util_mezclas_dias';
        v_mix_days:=coalesce(v_mix_days,5);
        if v_mix_days not between 1 and 30 then raise exception 'Vida útil de mezclas inválida: %.',v_mix_days; end if;
        v_expires:=(clock_timestamp() at time zone 'America/Bogota')::date+v_mix_days;
      end if;
      v_lot_id:=public._create_inventory_lot(p_item_id,v_remaining,v_origin,v_id,v_expires,null,null,null);
      if v_mix_days is not null then
        update public.inventory_lots set vida_util_dias=v_mix_days where id=v_lot_id;
      end if;
      insert into public.inventory_lot_allocations(movement_id,lot_id,quantity)
      values(v_id,v_lot_id,v_remaining);
    end if;
  end if;

  perform public._sync_inventory_item_expiry(p_item_id);
  perform public._sync_inventory_stock_from_lots(p_item_id);
end;
$$;
revoke all on function public._add_movement(text,text,numeric,text,text,text) from public,anon,authenticated,service_role;

create or replace function public.momos_configuration_snapshot_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_base jsonb; v_settings jsonb; v_finished integer; v_mixes integer;
begin
  if public.is_admin() is not true then raise exception 'Solo Administración puede consultar Configuración.' using errcode='42501'; end if;
  v_base:=public.momos_configuration_snapshot_v1();
  select coalesce((valor#>>'{}')::integer,6) into v_finished from public.app_settings where clave='vida_util_producto_terminado_dias';
  select coalesce((valor#>>'{}')::integer,5) into v_mixes from public.app_settings where clave='vida_util_mezclas_dias';
  v_finished:=coalesce(v_finished,6); v_mixes:=coalesce(v_mixes,5);
  if v_finished not between 1 and 30 or v_mixes not between 1 and 30 then raise exception 'Configuración de vida útil fuera de rango.'; end if;
  v_settings:=(v_base->'settings')||jsonb_build_object('finishedProductShelfDays',v_finished,'mixtureShelfDays',v_mixes);
  return jsonb_set(jsonb_set(jsonb_set(v_base,'{contract}',to_jsonb('momos.configuration-snapshot.v2'::text),true),'{version}','2'::jsonb,true),'{settings}',v_settings,true);
end;
$$;
revoke all on function public.momos_configuration_snapshot_v2() from public,anon,service_role;
grant execute on function public.momos_configuration_snapshot_v2() to authenticated;

create table if not exists public.configuration_v2_mutation_receipts(
  idempotency_key uuid primary key,
  request_hash text not null,
  response jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.configuration_v2_mutation_receipts enable row level security;
revoke all on table public.configuration_v2_mutation_receipts from public,anon,authenticated,service_role;

create or replace function public.guardar_configuracion_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_key uuid; v_expected text; v_payload jsonb; v_base_payload jsonb;
  v_base_key uuid; v_base_hex text;
  v_hash text; v_finished integer; v_mixes integer;
  v_receipt public.configuration_v2_mutation_receipts%rowtype;
  v_snapshot jsonb; v_response jsonb;
begin
  if public.is_admin() is not true then raise exception 'Solo Administración puede cambiar Configuración.' using errcode='42501'; end if;
  if jsonb_typeof(p) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in ('idempotency_key','expected_version','payload'))
     or (select count(*) from jsonb_object_keys(p))<>3 then raise exception 'La solicitud de Configuración v2 no cumple el contrato cerrado.'; end if;
  begin v_key:=(p->>'idempotency_key')::uuid; exception when others then raise exception 'La llave idempotente no es UUID.'; end;
  if v_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'La llave idempotente debe ser UUID v4.'; end if;
  v_expected:=coalesce(p->>'expected_version','');
  if v_expected !~ '^\d+$' or v_expected='0' then raise exception 'Falta la versión esperada de Configuración.'; end if;
  v_payload:=p->'payload';
  if jsonb_typeof(v_payload) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(v_payload) x(key) where key not in (
       'zones','catalogs','fixed_filling','figures','toppings','order_minimum','freezing_hours','delays','policies',
       'finished_product_shelf_days','mixture_shelf_days'))
     or (select count(*) from jsonb_object_keys(v_payload))<>11 then raise exception 'El contenido de Configuración v2 no cumple el contrato cerrado.'; end if;
  begin
    v_finished:=(v_payload->>'finished_product_shelf_days')::integer;
    v_mixes:=(v_payload->>'mixture_shelf_days')::integer;
  exception when others then raise exception 'La vida útil debe expresarse en días enteros.'; end;
  if v_finished is null or v_mixes is null
     or v_finished not between 1 and 30 or v_mixes not between 1 and 30 then
    raise exception 'La vida útil debe estar entre 1 y 30 días.';
  end if;

  v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('momos-configuration-v2:'||v_key::text,0));
  select * into v_receipt from public.configuration_v2_mutation_receipts where idempotency_key=v_key;
  if found then
    if v_receipt.request_hash<>v_hash then raise exception 'La llave idempotente ya pertenece a otra configuración.'; end if;
    return jsonb_set(v_receipt.response,'{duplicate}','true'::jsonb,true);
  end if;

  v_base_payload:=v_payload-array['finished_product_shelf_days','mixture_shelf_days'];
  -- La mutación v1 conserva su propia idempotencia sin compartir namespace
  -- con la llave pública v2.
  v_base_hex:=md5(v_key::text||':momos-configuration-v1-base');
  v_base_key:=(substr(v_base_hex,1,8)||'-'||substr(v_base_hex,9,4)||'-4'||
    substr(v_base_hex,14,3)||'-8'||substr(v_base_hex,18,3)||'-'||substr(v_base_hex,21,12))::uuid;
  perform public.guardar_configuracion_v1(jsonb_build_object(
    'idempotency_key',v_base_key::text,'expected_version',v_expected,'payload',v_base_payload));

  insert into public.app_settings(clave,valor) values
    ('vida_util_producto_terminado_dias',to_jsonb(v_finished)),
    ('vida_util_mezclas_dias',to_jsonb(v_mixes))
  on conflict(clave) do update set valor=excluded.valor;
  perform public._add_audit('Configuración','vida_util_produccion','Vida útil actualizada','',
    'Producto terminado '||v_finished||' días · mezclas '||v_mixes||' días');

  v_snapshot:=public.momos_configuration_snapshot_v2();
  v_response:=jsonb_build_object('contract','momos.configuration-mutation.v2','version',2,'duplicate',false,'snapshot',v_snapshot);
  insert into public.configuration_v2_mutation_receipts(idempotency_key,request_hash,response,created_by)
  values(v_key,v_hash,v_response,auth.uid());
  return v_response;
end;
$$;
revoke all on function public.guardar_configuracion_v2(jsonb) from public,anon,service_role;
grant execute on function public.guardar_configuracion_v2(jsonb) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260719_83_vida_util_produccion','Vida útil configurable: producto terminado 6 días, mezclas 5 días; fechas selladas por lote y guardado administrativo v2')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations where id='20260719_83_vida_util_produccion';
