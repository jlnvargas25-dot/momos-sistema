-- MOMOS OPS · CRM de clientes v2: preferencias, contactos, activaciones y conversión.
-- Paso 15, después de control-operativo-pedidos-v1.sql.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations where id='20260714_14_control_operativo') then
    raise exception 'Falta el paso 14_control_operativo.';
  end if;
end $$;

create table if not exists public.customer_crm_profiles(
  customer_id text primary key references public.customers(id) on delete cascade,
  contact_allowed boolean not null default true,
  contact_reason text not null default '',
  preferred_channel text not null default 'WhatsApp'
    check(preferred_channel in ('WhatsApp','Instagram','Llamada','No contactar')),
  acquisition_source text not null default '',
  referred_by_customer_id text references public.customers(id),
  updated_by text references public.users(id),
  updated_at timestamptz not null default now(),
  check(contact_allowed or preferred_channel='No contactar')
);

create table if not exists public.customer_activations(
  id bigint generated always as identity primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  type text not null check(type in ('Reactivación','Cumpleaños','Fidelización','Seguimiento','Recuperación','Otro')),
  title text not null check(length(btrim(title))>=3),
  message text not null default '',
  status text not null default 'Planeada' check(status in ('Planeada','Contactada','Convertida','Vencida','Cancelada')),
  benefit_id text references public.benefits(id),
  expires_on date,
  converted_order_id text references public.orders(id),
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((status='Convertida')=(converted_order_id is not null))
);
create index if not exists customer_activations_customer_idx on public.customer_activations(customer_id,created_at desc);
create unique index if not exists customer_activation_order_conversion_uq
  on public.customer_activations(converted_order_id) where converted_order_id is not null;

create table if not exists public.customer_contacts(
  id bigint generated always as identity primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  channel text not null check(channel in ('WhatsApp','Instagram','Llamada','Presencial','Otro')),
  reason text not null check(length(btrim(reason))>=3),
  outcome text not null default 'Enviado'
    check(outcome in ('Pendiente','Enviado','Respondió','Interesado','No interesado','No respondió','Venta')),
  notes text not null default '',
  follow_up_on date,
  activation_id bigint references public.customer_activations(id),
  order_id text references public.orders(id),
  created_by text not null references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists customer_contacts_customer_idx on public.customer_contacts(customer_id,created_at desc);
create index if not exists customer_contacts_followup_idx on public.customer_contacts(follow_up_on) where follow_up_on is not null;

alter table public.customer_crm_profiles enable row level security;
alter table public.customer_activations enable row level security;
alter table public.customer_contacts enable row level security;
drop policy if exists staff_read on public.customer_crm_profiles;
drop policy if exists staff_read on public.customer_activations;
drop policy if exists staff_read on public.customer_contacts;
create policy staff_read on public.customer_crm_profiles for select to authenticated using(public.is_staff());
create policy staff_read on public.customer_activations for select to authenticated using(public.is_staff());
create policy staff_read on public.customer_contacts for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.customer_crm_profiles from anon,authenticated;
revoke insert,update,delete on public.customer_activations from anon,authenticated;
revoke insert,update,delete on public.customer_contacts from anon,authenticated;
grant select on public.customer_crm_profiles,public.customer_activations,public.customer_contacts to authenticated;

do $$
declare v_table text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['customers','benefits','customer_crm_profiles','customer_activations','customer_contacts'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

create or replace function public.crm_clientes_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._crm_actor(p_roles text[]) returns public.users
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or not(v_actor.rol=any(p_roles)) then
    raise exception 'Tu rol no puede realizar esta acción de CRM.';
  end if;
  return v_actor;
end $$;

create or replace function public.guardar_preferencias_cliente(p_customer_id text,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_allowed boolean; v_channel text;
begin
  v_actor:=public._crm_actor(array['Administrador','Marketing/CRM','Coordinador de pedidos']);
  if not exists(select 1 from public.customers where id=p_customer_id) then raise exception 'El cliente no existe.'; end if;
  v_allowed:=coalesce((p->>'contact_allowed')::boolean,true);
  v_channel:=coalesce(nullif(btrim(p->>'preferred_channel'),''),'WhatsApp');
  if not v_allowed then v_channel:='No contactar'; end if;
  if v_channel not in ('WhatsApp','Instagram','Llamada','No contactar') then raise exception 'Canal preferido inválido.'; end if;
  insert into public.customer_crm_profiles(customer_id,contact_allowed,contact_reason,preferred_channel,acquisition_source,referred_by_customer_id,updated_by,updated_at)
  values(p_customer_id,v_allowed,coalesce(p->>'contact_reason',''),v_channel,coalesce(p->>'acquisition_source',''),nullif(p->>'referred_by_customer_id',''),v_actor.id,now())
  on conflict(customer_id) do update set contact_allowed=excluded.contact_allowed,contact_reason=excluded.contact_reason,
    preferred_channel=excluded.preferred_channel,acquisition_source=excluded.acquisition_source,
    referred_by_customer_id=excluded.referred_by_customer_id,updated_by=excluded.updated_by,updated_at=now();
  perform public._add_audit('Cliente',p_customer_id,'Preferencias CRM actualizadas','',v_channel);
  return jsonb_build_object('ok',true,'customer_id',p_customer_id);
end $$;

create or replace function public.crear_activacion_cliente(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_id bigint; v_customer text:=nullif(p->>'customer_id',''); v_type text:=coalesce(nullif(p->>'type',''),'Otro');
begin
  v_actor:=public._crm_actor(array['Administrador','Marketing/CRM','Coordinador de pedidos']);
  if not exists(select 1 from public.customers where id=v_customer) then raise exception 'El cliente no existe.'; end if;
  if exists(select 1 from public.customer_crm_profiles where customer_id=v_customer and not contact_allowed) then
    raise exception 'El cliente está marcado como No contactar.';
  end if;
  insert into public.customer_activations(customer_id,type,title,message,expires_on,created_by)
  values(v_customer,v_type,btrim(coalesce(p->>'title','')),coalesce(p->>'message',''),nullif(p->>'expires_on','')::date,v_actor.id)
  returning id into v_id;
  perform public._add_audit('Cliente',v_customer,'Activación CRM creada','',v_type||' #'||v_id);
  return jsonb_build_object('ok',true,'activation_id',v_id);
end $$;

create or replace function public.registrar_contacto_cliente(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_id bigint; v_customer text:=nullif(p->>'customer_id',''); v_activation bigint:=nullif(p->>'activation_id','')::bigint;
begin
  v_actor:=public._crm_actor(array['Administrador','Marketing/CRM','Coordinador de pedidos','Cajero']);
  if not exists(select 1 from public.customers where id=v_customer) then raise exception 'El cliente no existe.'; end if;
  if exists(select 1 from public.customer_crm_profiles where customer_id=v_customer and not contact_allowed) then
    raise exception 'El cliente está marcado como No contactar.';
  end if;
  if v_activation is not null and not exists(select 1 from public.customer_activations where id=v_activation and customer_id=v_customer) then
    raise exception 'La activación no corresponde al cliente.';
  end if;
  insert into public.customer_contacts(customer_id,channel,reason,outcome,notes,follow_up_on,activation_id,order_id,created_by)
  values(v_customer,coalesce(nullif(p->>'channel',''),'WhatsApp'),btrim(coalesce(p->>'reason','')),
    coalesce(nullif(p->>'outcome',''),'Enviado'),coalesce(p->>'notes',''),nullif(p->>'follow_up_on','')::date,
    v_activation,nullif(p->>'order_id',''),v_actor.id) returning id into v_id;
  if v_activation is not null then update public.customer_activations set status='Contactada',updated_at=now() where id=v_activation and status='Planeada'; end if;
  perform public._add_audit('Cliente',v_customer,'Contacto CRM registrado','',coalesce(p->>'channel','WhatsApp')||' #'||v_id);
  return jsonb_build_object('ok',true,'contact_id',v_id);
end $$;

create or replace function public.convertir_activacion_cliente(p_activation_id bigint,p_order_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_activation public.customer_activations%rowtype;
begin
  v_actor:=public._crm_actor(array['Administrador','Marketing/CRM','Coordinador de pedidos']);
  select * into v_activation from public.customer_activations where id=p_activation_id for update;
  if v_activation.id is null then raise exception 'La activación no existe.'; end if;
  if not exists(select 1 from public.orders where id=p_order_id and customer_id=v_activation.customer_id and estado<>'Cancelado') then
    raise exception 'El pedido no corresponde al cliente o fue cancelado.';
  end if;
  update public.customer_activations set status='Convertida',converted_order_id=p_order_id,updated_at=now() where id=p_activation_id;
  perform public._add_audit('Cliente',v_activation.customer_id,'Activación CRM convertida',p_activation_id::text,p_order_id);
  return jsonb_build_object('ok',true,'activation_id',p_activation_id,'order_id',p_order_id);
end $$;

create or replace function public.activar_beneficio_cliente(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_id text; v_customer text:=nullif(p->>'customer_id',''); v_type text:=p->>'tipo_beneficio'; v_value numeric:=coalesce((p->>'valor')::numeric,0); v_label text;
begin
  v_actor:=public._crm_actor(array['Administrador','Marketing/CRM']);
  if not exists(select 1 from public.customers where id=v_customer) then raise exception 'El cliente no existe.'; end if;
  if v_type not in ('descuento_porcentaje','descuento_valor_fijo','producto_gratis') then raise exception 'Tipo de beneficio inválido.'; end if;
  if v_type='descuento_porcentaje' and (v_value<=0 or v_value>100) then raise exception 'El porcentaje debe estar entre 1 y 100.'; end if;
  if v_type='descuento_valor_fijo' and v_value<=0 then raise exception 'El valor del descuento debe ser mayor a cero.'; end if;
  if v_type='producto_gratis' and not exists(select 1 from public.products where id=nullif(p->>'producto_gratis_id','') and activo) then raise exception 'El producto gratis no existe o está inactivo.'; end if;
  if nullif(p->>'vence','')::date<current_date then raise exception 'El beneficio no puede nacer vencido.'; end if;
  v_label:=case when v_type='descuento_porcentaje' then trim(to_char(v_value,'FM999990D##'))||'% descuento'
    when v_type='descuento_valor_fijo' then '$'||trim(to_char(v_value,'FM999999990'))||' de descuento'
    else coalesce((select nombre from public.products where id=nullif(p->>'producto_gratis_id','')),'Producto')||' gratis' end;
  v_id:=public.next_id('benefit','B-',0);
  insert into public.benefits(id,customer_id,beneficio,tipo_beneficio,valor,producto_gratis_id,condicion,minimo,activacion,vence,estado,obs)
  values(v_id,v_customer,v_label,v_type,v_value,nullif(p->>'producto_gratis_id',''),coalesce(p->>'condicion',''),
    coalesce((p->>'minimo')::numeric,0),current_date,nullif(p->>'vence','')::date,'Activo',coalesce(p->>'obs',''));
  perform public._add_audit('Beneficio',v_id,'Beneficio activado','',v_label);
  return jsonb_build_object('ok',true,'benefit_id',v_id);
end $$;

create or replace function public.capture_customer_first_purchase() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.estado='Entregado' and old.estado is distinct from 'Entregado' then
    update public.customers set primera=least(coalesce(primera,new.fecha),new.fecha) where id=new.customer_id;
  end if;
  return new;
end $$;
drop trigger if exists orders_capture_customer_first_purchase on public.orders;
create trigger orders_capture_customer_first_purchase after update of estado on public.orders
for each row execute function public.capture_customer_first_purchase();

revoke all on function public.crm_clientes_disponible() from public,anon,authenticated;
revoke all on function public._crm_actor(text[]) from public,anon,authenticated;
revoke all on function public.guardar_preferencias_cliente(text,jsonb) from public,anon,authenticated;
revoke all on function public.crear_activacion_cliente(jsonb) from public,anon,authenticated;
revoke all on function public.registrar_contacto_cliente(jsonb) from public,anon,authenticated;
revoke all on function public.convertir_activacion_cliente(bigint,text) from public,anon,authenticated;
revoke all on function public.activar_beneficio_cliente(jsonb) from public,anon,authenticated;
revoke all on function public.capture_customer_first_purchase() from public,anon,authenticated;
grant execute on function public.crm_clientes_disponible() to authenticated;
grant execute on function public.guardar_preferencias_cliente(text,jsonb) to authenticated;
grant execute on function public.crear_activacion_cliente(jsonb) to authenticated;
grant execute on function public.registrar_contacto_cliente(jsonb) to authenticated;
grant execute on function public.convertir_activacion_cliente(bigint,text) to authenticated;
grant execute on function public.activar_beneficio_cliente(jsonb) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260714_15_crm_clientes','Historial comercial, preferencias de contacto, activaciones, conversiones y beneficios auditados')
on conflict(id) do update set detalle=excluded.detalle;
commit;

select id,applied_at,detalle from public.momos_ops_migrations where id='20260714_15_crm_clientes';
