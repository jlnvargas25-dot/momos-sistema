-- MOMOS OPS · H102 · piloto comercial controlado.
--
-- Esta capa no crea pedidos, no cobra, no abre checkout y no ejecuta acciones
-- externas. Autoriza una muestra cerrada, vincula pedidos ya pagados y exige
-- conciliacion operativa y financiera antes de declarar el piloto cerrado.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_100_piloto_operativo_interno') then
    raise exception 'H102 requiere H100 y la cadena operativa 01-100.';
  end if;
  if to_regclass('public.operational_health_state') is null
     or to_regclass('public.operational_health_incidents') is null
     or to_regclass('public.v_order_totals') is null
     or to_regprocedure('public.current_user_has_any_role(text[])') is null
     or to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'H102 requiere salud, continuidad, finanzas canonicas y RBAC.';
  end if;
end $$;

create table if not exists public.commercial_pilot_runs(
  id uuid primary key default gen_random_uuid(),
  pilot_key text not null unique check(pilot_key ~ '^[A-Za-z0-9_.:-]{8,80}$'),
  environment text not null check(environment in ('Staging','Produccion')),
  status text not null default 'Borrador'
    check(status in ('Borrador','Listo','En curso','Cerrado','Abortado')),
  planned_orders integer not null check(planned_orders between 1 and 20),
  max_order_total numeric not null check(max_order_total between 1000 and 500000),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  created_by text not null,
  authorized_by text,
  started_at timestamptz,
  closed_at timestamptz,
  input_fingerprint text not null check(input_fingerprint ~ '^[0-9a-f]{64}$'),
  result_fingerprint text check(result_fingerprint is null or result_fingerprint ~ '^[0-9a-f]{64}$'),
  version bigint not null default 1 check(version>0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(expires_at>starts_at and expires_at<=starts_at+interval '7 days'),
  check((status in ('Borrador','Listo') and started_at is null and closed_at is null)
    or (status='En curso' and started_at is not null and closed_at is null)
    or (status in ('Cerrado','Abortado') and closed_at is not null))
);

create table if not exists public.commercial_pilot_signoffs(
  pilot_id uuid not null references public.commercial_pilot_runs(id) on delete restrict,
  area text not null check(area in ('Producto','Operaciones','Finanzas','Seguridad y Privacidad')),
  status text not null default 'Pendiente' check(status in ('Pendiente','Aprobado','Rechazado')),
  evidence_code text,
  actor_id text,
  decided_at timestamptz,
  fingerprint text check(fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$'),
  primary key(pilot_id,area),
  check((status='Pendiente' and evidence_code is null and actor_id is null and decided_at is null and fingerprint is null)
    or (status<>'Pendiente' and evidence_code is not null and actor_id is not null and decided_at is not null and fingerprint is not null))
);

create table if not exists public.commercial_pilot_orders(
  pilot_id uuid not null references public.commercial_pilot_runs(id) on delete restrict,
  order_id text not null unique references public.orders(id) on delete restrict,
  idempotency_key uuid not null unique,
  initial_total numeric not null check(initial_total>=0),
  current_status text not null,
  outcome text not null default 'En curso'
    check(outcome in ('En curso','Entregado','Cancelado','Reclamo')),
  reconciled boolean not null default false,
  final_margin numeric,
  linked_by text not null,
  linked_at timestamptz not null default clock_timestamp(),
  reconciled_by text,
  reconciled_at timestamptz,
  version bigint not null default 1 check(version>0),
  primary key(pilot_id,order_id),
  check((not reconciled and reconciled_by is null and reconciled_at is null)
    or (reconciled and reconciled_by is not null and reconciled_at is not null))
);

create table if not exists public.commercial_pilot_events(
  id bigint generated always as identity primary key,
  pilot_id uuid not null references public.commercial_pilot_runs(id) on delete restrict,
  event_code text not null check(event_code in (
    'PREPARED','SIGNED','READY','STARTED','ORDER_LINKED','ORDER_RECONCILED','CLOSED','ABORTED'
  )),
  entity_ref text not null check(entity_ref ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  actor_id text not null,
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists commercial_pilot_events_recent_idx
  on public.commercial_pilot_events(pilot_id,created_at desc,id desc);

do $$
declare t text;
begin
  foreach t in array array[
    'commercial_pilot_runs','commercial_pilot_signoffs',
    'commercial_pilot_orders','commercial_pilot_events'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create or replace function public._commercial_pilot_hash(p jsonb)
returns text language sql immutable
set search_path=pg_catalog,public,pg_temp as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p::text,'UTF8')),'hex')
$$;

create or replace function public._commercial_pilot_actor_id()
returns text language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_id text;
begin
  select id into v_id from public.users where auth_id=auth.uid() and activo limit 1;
  if v_id is null then raise exception 'Se requiere una sesion interna activa.' using errcode='42501'; end if;
  return v_id;
end $$;

create or replace function public._commercial_pilot_event(
  p_pilot uuid,p_code text,p_ref text,p_actor text,p_payload jsonb
) returns void language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  insert into public.commercial_pilot_events(pilot_id,event_code,entity_ref,actor_id,fingerprint)
  values(p_pilot,p_code,p_ref,p_actor,public._commercial_pilot_hash(p_payload));
end $$;

revoke all on function public._commercial_pilot_hash(jsonb) from public,anon,authenticated,service_role;
revoke all on function public._commercial_pilot_actor_id() from public,anon,authenticated,service_role;
revoke all on function public._commercial_pilot_event(uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.preparar_piloto_comercial_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_actor text; v_id uuid; v_existing public.commercial_pilot_runs%rowtype;
  v_key text; v_environment text; v_planned integer; v_cap numeric;
  v_start timestamptz; v_expires timestamptz; v_fp text;
begin
  if public.current_user_has_any_role(array['Administrador']) is not true then
    raise exception 'Solo Administracion puede preparar un piloto comercial.' using errcode='42501';
  end if;
  if jsonb_typeof(p) is distinct from 'object' or exists(
    select 1 from jsonb_object_keys(p) x(key) where key not in (
      'contract','pilot_key','environment','planned_orders','max_order_total',
      'starts_at','expires_at','production_confirmation'
    )
  ) then raise exception 'El contrato del piloto contiene campos no permitidos.'; end if;
  if p->>'contract'<>'momos.commercial-pilot.prepare.v1' then raise exception 'Contrato de piloto invalido.'; end if;
  v_key:=btrim(coalesce(p->>'pilot_key',''));
  v_environment:=p->>'environment';
  v_planned:=(p->>'planned_orders')::integer;
  v_cap:=(p->>'max_order_total')::numeric;
  v_start:=(p->>'starts_at')::timestamptz;
  v_expires:=(p->>'expires_at')::timestamptz;
  if v_key!~'^[A-Za-z0-9_.:-]{8,80}$' or v_environment not in ('Staging','Produccion')
     or v_planned not between 1 and 20 or v_cap not between 1000 and 500000
     or v_start<clock_timestamp()-interval '10 minutes'
     or v_expires<=v_start or v_expires>v_start+interval '7 days' then
    raise exception 'Parametros del piloto fuera del contrato cerrado.';
  end if;
  if v_environment='Produccion'
     and coalesce(p->>'production_confirmation','')<>'PREPARAR_PILOTO_CERRADO_SIN_ABRIR_TRAFICO' then
    raise exception 'Produccion requiere confirmacion humana explicita.';
  end if;
  v_actor:=public._commercial_pilot_actor_id();
  v_fp:=public._commercial_pilot_hash(jsonb_build_object(
    'pilot_key',v_key,'environment',v_environment,'planned_orders',v_planned,
    'max_order_total',v_cap,'starts_at',v_start,'expires_at',v_expires
  ));
  select * into v_existing from public.commercial_pilot_runs where pilot_key=v_key;
  if v_existing.id is not null then
    if v_existing.input_fingerprint<>v_fp then raise exception 'La clave del piloto ya existe con otro contrato.'; end if;
    return jsonb_build_object('contract','momos.commercial-pilot.v1','pilotId',v_existing.id,
      'status',v_existing.status,'version',v_existing.version,'duplicate',true,
      'publicTrafficOpened',false,'externalExecution',false,'containsCustomerPii',false,'containsSecrets',false);
  end if;
  insert into public.commercial_pilot_runs(
    pilot_key,environment,planned_orders,max_order_total,starts_at,expires_at,created_by,input_fingerprint
  ) values(v_key,v_environment,v_planned,v_cap,v_start,v_expires,v_actor,v_fp) returning id into v_id;
  insert into public.commercial_pilot_signoffs(pilot_id,area)
  select v_id,x from unnest(array['Producto','Operaciones','Finanzas','Seguridad y Privacidad']) x;
  perform public._commercial_pilot_event(v_id,'PREPARED',v_key,v_actor,jsonb_build_object('fingerprint',v_fp));
  return jsonb_build_object('contract','momos.commercial-pilot.v1','pilotId',v_id,
    'status','Borrador','version',1,'duplicate',false,'signoffsRequired',4,
    'publicTrafficOpened',false,'externalExecution',false,'containsCustomerPii',false,'containsSecrets',false);
end $$;

create or replace function public.firmar_piloto_comercial_v1(
  p_pilot uuid,p_area text,p_evidence_code text,p_expected_version bigint
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_actor text; v_run public.commercial_pilot_runs%rowtype; v_sign public.commercial_pilot_signoffs%rowtype;
  v_expected_code text; v_approved integer; v_fp text; v_status text; v_new_version bigint;
begin
  v_expected_code:=case p_area when 'Producto' then 'SCOPE_APPROVED'
    when 'Operaciones' then 'ROLES_TRAINED'
    when 'Finanzas' then 'CLOSE_READY'
    when 'Seguridad y Privacidad' then 'PRIVACY_REVIEWED' end;
  if v_expected_code is null or p_evidence_code<>v_expected_code then raise exception 'Firma o evidencia fuera del contrato.'; end if;
  if (p_area='Producto' and public.current_user_has_any_role(array['Administrador']) is not true)
     or (p_area='Operaciones' and public.current_user_has_any_role(array['Administrador','Coordinador de pedidos']) is not true)
     or (p_area='Finanzas' and public.current_user_has_any_role(array['Administrador','Cajero']) is not true)
     or (p_area='Seguridad y Privacidad' and public.current_user_has_any_role(array['Administrador']) is not true) then
    raise exception 'Tu rol no puede firmar esta area.' using errcode='42501';
  end if;
  v_actor:=public._commercial_pilot_actor_id();
  select * into v_run from public.commercial_pilot_runs where id=p_pilot for update;
  if v_run.id is null or v_run.status not in ('Borrador','Listo') then raise exception 'El piloto no admite firmas.'; end if;
  select * into v_sign from public.commercial_pilot_signoffs where pilot_id=p_pilot and area=p_area for update;
  if v_sign.status='Aprobado' and v_sign.evidence_code=p_evidence_code then
    return jsonb_build_object('contract','momos.commercial-pilot.v1','pilotId',p_pilot,
      'status',v_run.status,'version',v_run.version,'duplicate',true,'containsCustomerPii',false,'containsSecrets',false);
  end if;
  if v_run.version<>p_expected_version then raise exception 'Version del piloto desactualizada.' using errcode='40001'; end if;
  v_fp:=public._commercial_pilot_hash(jsonb_build_object('pilot_id',p_pilot,'area',p_area,'evidence_code',p_evidence_code,'actor',v_actor));
  update public.commercial_pilot_signoffs set status='Aprobado',evidence_code=p_evidence_code,
    actor_id=v_actor,decided_at=clock_timestamp(),fingerprint=v_fp where pilot_id=p_pilot and area=p_area;
  select count(*) into v_approved from public.commercial_pilot_signoffs where pilot_id=p_pilot and status='Aprobado';
  v_status:=case when v_approved=4 then 'Listo' else 'Borrador' end;
  update public.commercial_pilot_runs set status=v_status,
    authorized_by=case when v_status='Listo' then v_actor else authorized_by end,
    version=version+1,updated_at=clock_timestamp() where id=p_pilot returning version into v_new_version;
  perform public._commercial_pilot_event(p_pilot,'SIGNED',p_evidence_code,v_actor,
    jsonb_build_object('fingerprint',v_fp,'area',p_area));
  if v_status='Listo' then
    perform public._commercial_pilot_event(p_pilot,'READY',v_run.pilot_key,v_actor,jsonb_build_object('approved',4));
  end if;
  return jsonb_build_object('contract','momos.commercial-pilot.v1','pilotId',p_pilot,
    'status',v_status,'version',v_new_version,'approvedSignoffs',v_approved,'duplicate',false,
    'containsCustomerPii',false,'containsSecrets',false,'externalExecution',false);
end $$;

create or replace function public.iniciar_piloto_comercial_v1(
  p_pilot uuid,p_expected_version bigint,p_confirmation text default ''
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_actor text; v_run public.commercial_pilot_runs%rowtype; v_health public.operational_health_state%rowtype;
begin
  if public.current_user_has_any_role(array['Administrador']) is not true then raise exception 'Solo Administracion puede iniciar el piloto.' using errcode='42501'; end if;
  v_actor:=public._commercial_pilot_actor_id();
  select * into v_run from public.commercial_pilot_runs where id=p_pilot for update;
  if v_run.id is null or v_run.status<>'Listo' then raise exception 'El piloto todavia no esta listo.'; end if;
  if v_run.version<>p_expected_version then raise exception 'Version del piloto desactualizada.' using errcode='40001'; end if;
  if clock_timestamp()<v_run.starts_at or clock_timestamp()>v_run.expires_at then raise exception 'El piloto esta fuera de su ventana autorizada.'; end if;
  if v_run.environment='Produccion' and p_confirmation<>'INICIAR_PILOTO_CERRADO_PRODUCCION' then raise exception 'Falta confirmar el inicio cerrado en Produccion.'; end if;
  select * into v_health from public.operational_health_state where singleton;
  if v_health.read_only or v_health.resilience_certified_until<clock_timestamp()
     or v_health.continuity_certified_until<clock_timestamp()
     or exists(select 1 from public.operational_health_incidents
       where status in ('Abierto','Confirmado') and severity in ('Alta','Crítica')) then
    raise exception 'Salud, resiliencia o recuperacion no permiten iniciar el piloto.';
  end if;
  update public.commercial_pilot_runs set status='En curso',started_at=clock_timestamp(),
    version=version+1,updated_at=clock_timestamp() where id=p_pilot returning version into p_expected_version;
  perform public._commercial_pilot_event(p_pilot,'STARTED',v_run.pilot_key,v_actor,jsonb_build_object('environment',v_run.environment));
  return jsonb_build_object('contract','momos.commercial-pilot.v1','pilotId',p_pilot,
    'status','En curso','version',p_expected_version,'orderLimit',v_run.planned_orders,
    'publicTrafficOpened',false,'externalExecution',false,'containsCustomerPii',false,'containsSecrets',false);
end $$;

create or replace function public.vincular_pedido_piloto_comercial_v1(
  p_pilot uuid,p_order_id text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_actor text; v_run public.commercial_pilot_runs%rowtype; v_order public.orders%rowtype;
  v_total numeric; v_existing public.commercial_pilot_orders%rowtype; v_count integer;
begin
  if public.current_user_has_any_role(array['Administrador','Coordinador de pedidos']) is not true then raise exception 'Tu rol no puede vincular pedidos al piloto.' using errcode='42501'; end if;
  if p_idempotency_key is null then raise exception 'Falta idempotencia durable.'; end if;
  v_actor:=public._commercial_pilot_actor_id();
  select * into v_existing from public.commercial_pilot_orders where idempotency_key=p_idempotency_key;
  if v_existing.pilot_id is not null then
    if v_existing.pilot_id<>p_pilot or v_existing.order_id<>p_order_id then raise exception 'La idempotencia pertenece a otro pedido.'; end if;
    return jsonb_build_object('contract','momos.commercial-pilot.v1','pilotId',p_pilot,
      'orderId',p_order_id,'status',v_existing.current_status,'duplicate',true,
      'containsCustomerPii',false,'containsSecrets',false,'externalExecution',false);
  end if;
  select * into v_run from public.commercial_pilot_runs where id=p_pilot for update;
  if v_run.id is null or v_run.status<>'En curso' or clock_timestamp()>v_run.expires_at then raise exception 'El piloto no esta abierto para nuevos pedidos.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null or v_order.pagado_en is null
     or v_order.estado not in ('Pagado','En producción','Listo para empaque','Empacado','Listo para despacho','En ruta') then
    raise exception 'Solo se vinculan pedidos pagados y todavia operables.';
  end if;
  select coalesce(t.ventas,0)-coalesce(v_order.descuento,0)+coalesce(v_order.dom_cobrado,0)
    into v_total from public.v_order_totals t where t.order_id=p_order_id;
  v_total:=coalesce(v_total,0);
  if v_total<=0 or v_total>v_run.max_order_total then raise exception 'El total del pedido excede el contrato del piloto.'; end if;
  select count(*) into v_count from public.commercial_pilot_orders where pilot_id=p_pilot;
  if v_count>=v_run.planned_orders then raise exception 'La muestra cerrada ya completo su cupo.'; end if;
  insert into public.commercial_pilot_orders(
    pilot_id,order_id,idempotency_key,initial_total,current_status,linked_by
  ) values(p_pilot,p_order_id,p_idempotency_key,v_total,v_order.estado,v_actor);
  perform public._commercial_pilot_event(p_pilot,'ORDER_LINKED',p_order_id,v_actor,jsonb_build_object('total',v_total));
  return jsonb_build_object('contract','momos.commercial-pilot.v1','pilotId',p_pilot,
    'orderId',p_order_id,'status',v_order.estado,'total',v_total,'duplicate',false,
    'containsCustomerPii',false,'containsSecrets',false,'externalExecution',false);
end $$;

create or replace function public.conciliar_pedido_piloto_comercial_v1(
  p_pilot uuid,p_order_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_actor text; v_link public.commercial_pilot_orders%rowtype; v_order public.orders%rowtype;
  v_outcome text:='En curso'; v_reconciled boolean:=false; v_margin numeric; v_claim_cost numeric:=0;
  v_delivery_cost numeric:=0; v_gates boolean:=false;
begin
  if public.current_user_has_any_role(array['Administrador','Coordinador de pedidos','Cajero']) is not true then raise exception 'Tu rol no puede conciliar el piloto.' using errcode='42501'; end if;
  v_actor:=public._commercial_pilot_actor_id();
  select * into v_link from public.commercial_pilot_orders where pilot_id=p_pilot and order_id=p_order_id for update;
  if v_link.pilot_id is null then raise exception 'El pedido no pertenece al piloto.'; end if;
  select * into v_order from public.orders where id=p_order_id;
  select coalesce(sum(c.costo) filter(where c.estado in ('Aprobado','Compensado')),0) into v_claim_cost from public.claims c where c.order_id=p_order_id;
  select coalesce(max(d.costo_real) filter(where d.estado='Entregado'),coalesce(v_order.dom_costo,0)) into v_delivery_cost from public.deliveries d where d.order_id=p_order_id;
  select v_order.pagado_en is not null
    and exists(select 1 from public.evidences where order_id=p_order_id and tipo='Comprobante de pago')
    and exists(select 1 from public.packing_verifications where order_id=p_order_id)
    and exists(select 1 from public.evidences where order_id=p_order_id and tipo='Caja abierta')
    and exists(select 1 from public.evidences where order_id=p_order_id and tipo='Caja cerrada con sello')
    and exists(select 1 from public.order_dispatch_handoffs where order_id=p_order_id and status='Aceptado')
    and exists(select 1 from public.deliveries where order_id=p_order_id and estado='Entregado')
    and exists(select 1 from public.evidences where order_id=p_order_id and tipo='Entrega')
    and not exists(select 1 from public.order_incidents where order_id=p_order_id and status='Abierto')
    into v_gates;
  if v_order.estado='Entregado' then v_outcome:='Entregado'; v_reconciled:=v_gates;
  elsif v_order.estado='Cancelado' then
    v_outcome:='Cancelado';
    v_reconciled:=not exists(select 1 from public.inventory_reservations where order_id=p_order_id and estado='Reservada')
      and not exists(select 1 from public.order_stage_assignments where order_id=p_order_id and status='Activa');
  elsif v_order.estado in ('Reclamo') or exists(select 1 from public.claims where order_id=p_order_id) then
    v_outcome:='Reclamo';
    v_reconciled:=not exists(select 1 from public.claims where order_id=p_order_id and estado in ('Abierto','En revisión','Aprobado'));
  end if;
  select coalesce(t.ventas,0)-coalesce(t.cogs,0)-coalesce(v_order.descuento,0)
    +coalesce(v_order.dom_cobrado,0)-coalesce(v_delivery_cost,0)
    -coalesce(v_order.comision_pago,0)-coalesce(v_claim_cost,0)
    into v_margin from public.v_order_totals t where t.order_id=p_order_id;
  update public.commercial_pilot_orders set current_status=v_order.estado,outcome=v_outcome,
    reconciled=v_reconciled,final_margin=case when v_reconciled then coalesce(v_margin,0) end,
    reconciled_by=case when v_reconciled then v_actor end,
    reconciled_at=case when v_reconciled then clock_timestamp() end,version=version+1
  where pilot_id=p_pilot and order_id=p_order_id;
  if v_reconciled then perform public._commercial_pilot_event(p_pilot,'ORDER_RECONCILED',p_order_id,v_actor,jsonb_build_object('outcome',v_outcome,'margin',coalesce(v_margin,0))); end if;
  return jsonb_build_object('contract','momos.commercial-pilot.v1','pilotId',p_pilot,
    'orderId',p_order_id,'status',v_order.estado,'outcome',v_outcome,'reconciled',v_reconciled,
    'margin',case when v_reconciled then coalesce(v_margin,0) end,
    'containsCustomerPii',false,'containsSecrets',false,'externalExecution',false);
end $$;

create or replace function public.cerrar_piloto_comercial_v1(
  p_pilot uuid,p_expected_version bigint
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_actor text; v_run public.commercial_pilot_runs%rowtype; v_count integer; v_reconciled integer;
  v_delivered integer; v_margin numeric; v_fp text;
begin
  if public.current_user_has_any_role(array['Administrador']) is not true then raise exception 'Solo Administracion puede cerrar el piloto.' using errcode='42501'; end if;
  v_actor:=public._commercial_pilot_actor_id();
  select * into v_run from public.commercial_pilot_runs where id=p_pilot for update;
  if v_run.id is null or v_run.status<>'En curso' then raise exception 'El piloto no esta en curso.'; end if;
  if v_run.version<>p_expected_version then raise exception 'Version del piloto desactualizada.' using errcode='40001'; end if;
  select count(*),count(*) filter(where reconciled),count(*) filter(where outcome='Entregado'),coalesce(sum(final_margin) filter(where reconciled),0)
    into v_count,v_reconciled,v_delivered,v_margin from public.commercial_pilot_orders where pilot_id=p_pilot;
  if v_count<>v_run.planned_orders or v_reconciled<>v_count then raise exception 'La muestra o su conciliacion todavia no estan completas.'; end if;
  v_fp:=public._commercial_pilot_hash(jsonb_build_object('pilot_id',p_pilot,'orders',v_count,'delivered',v_delivered,'margin',v_margin));
  update public.commercial_pilot_runs set status='Cerrado',closed_at=clock_timestamp(),
    result_fingerprint=v_fp,version=version+1,updated_at=clock_timestamp()
  where id=p_pilot returning version into p_expected_version;
  perform public._commercial_pilot_event(p_pilot,'CLOSED',v_run.pilot_key,v_actor,jsonb_build_object('fingerprint',v_fp));
  return jsonb_build_object('contract','momos.commercial-pilot.v1','pilotId',p_pilot,
    'status','Cerrado','version',p_expected_version,'orders',v_count,'delivered',v_delivered,
    'reconciled',v_reconciled,'margin',v_margin,'resultFingerprint',v_fp,
    'containsCustomerPii',false,'containsSecrets',false,'externalExecution',false);
end $$;

create or replace function public.abortar_piloto_comercial_v1(
  p_pilot uuid,p_expected_version bigint,p_confirmation text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_actor text; v_run public.commercial_pilot_runs%rowtype;
begin
  if public.current_user_has_any_role(array['Administrador']) is not true then raise exception 'Solo Administracion puede abortar el piloto.' using errcode='42501'; end if;
  if p_confirmation<>'ABORTAR_PILOTO_SIN_REVERTIR_PEDIDOS' then raise exception 'Falta la doble confirmacion de aborto.'; end if;
  v_actor:=public._commercial_pilot_actor_id();
  select * into v_run from public.commercial_pilot_runs where id=p_pilot for update;
  if v_run.id is null or v_run.status in ('Cerrado','Abortado') then raise exception 'El piloto ya es terminal.'; end if;
  if v_run.version<>p_expected_version then raise exception 'Version del piloto desactualizada.' using errcode='40001'; end if;
  update public.commercial_pilot_runs set status='Abortado',closed_at=clock_timestamp(),
    version=version+1,updated_at=clock_timestamp() where id=p_pilot returning version into p_expected_version;
  perform public._commercial_pilot_event(p_pilot,'ABORTED',v_run.pilot_key,v_actor,jsonb_build_object('ordersPreserved',true));
  return jsonb_build_object('contract','momos.commercial-pilot.v1','pilotId',p_pilot,
    'status','Abortado','version',p_expected_version,'ordersPreserved',true,
    'containsCustomerPii',false,'containsSecrets',false,'externalExecution',false);
end $$;

create or replace function public.momos_commercial_pilot_snapshot_v1()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_actor text; v_result jsonb;
begin
  if public.current_user_has_any_role(array['Administrador','Coordinador de pedidos','Cajero']) is not true then raise exception 'Tu rol no puede consultar el piloto.' using errcode='42501'; end if;
  v_actor:=public._commercial_pilot_actor_id();
  select jsonb_build_object(
    'contract','momos.commercial-pilot.snapshot.v1','capturedAt',clock_timestamp(),
    'pilots',coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'key',r.pilot_key,'environment',r.environment,'status',r.status,
      'plannedOrders',r.planned_orders,'linkedOrders',(select count(*) from public.commercial_pilot_orders o where o.pilot_id=r.id),
      'reconciledOrders',(select count(*) from public.commercial_pilot_orders o where o.pilot_id=r.id and o.reconciled),
      'approvedSignoffs',(select count(*) from public.commercial_pilot_signoffs s where s.pilot_id=r.id and s.status='Aprobado'),
      'startsAt',r.starts_at,'expiresAt',r.expires_at,'version',r.version
    ) order by r.created_at desc),'[]'::jsonb),
    'authority',jsonb_build_object('actorPresent',v_actor is not null,'readOnly',true,'publicTrafficOpened',false),
    'privacy',jsonb_build_object('containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false),
    'externalExecution',false
  ) into v_result from (select * from public.commercial_pilot_runs order by created_at desc limit 20) r;
  return v_result;
end $$;

do $$
declare signature text;
begin
  foreach signature in array array[
    'public.preparar_piloto_comercial_v1(jsonb)',
    'public.firmar_piloto_comercial_v1(uuid,text,text,bigint)',
    'public.iniciar_piloto_comercial_v1(uuid,bigint,text)',
    'public.vincular_pedido_piloto_comercial_v1(uuid,text,uuid)',
    'public.conciliar_pedido_piloto_comercial_v1(uuid,text)',
    'public.cerrar_piloto_comercial_v1(uuid,bigint)',
    'public.abortar_piloto_comercial_v1(uuid,bigint,text)',
    'public.momos_commercial_pilot_snapshot_v1()'
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
    execute format('grant execute on function %s to authenticated',signature);
  end loop;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260722_102_piloto_comercial_controlado',
  'Muestra cerrada, cuatro firmas, salud vigente, pedidos pagados y conciliacion operativa-financiera sin abrir trafico')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260722_102_piloto_comercial_controlado';
