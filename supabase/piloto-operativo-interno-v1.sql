-- MOMOS OPS · H100 · cierre del relevo fisico para el piloto operativo interno.
--
-- El ensayo E2E encontro que la firma Empaque -> Logistica dependia de
-- pgcrypto.digest() sin resolver su esquema. Esta version usa sha256 nativo de
-- pg_catalog, igual que los contratos atomicos H91, y conserva roles, bloqueo,
-- auditoria, firma exacta e idempotencia del relevo.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260721_97_evidencia_recuperacion_derivada') then
    raise exception 'H100 requiere la cadena operativa 01-97.';
  end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null
     or to_regprocedure('public.confirmar_verificacion_empaque(text,text[])') is null
     or to_regprocedure('public._claim_order_stage(text,text,text)') is null then
    raise exception 'H100 requiere SHA-256 nativo y el flujo operativo de Empaque.';
  end if;
end $$;

create or replace function public.ofrecer_relevo_despacho(
  p_order_id text,p_note text default ''
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_actor record;
  v_order public.orders%rowtype;
  v_assignment public.order_stage_assignments%rowtype;
  v_signature text;
begin
  select id,nombre into v_actor
  from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null
     or public.current_user_has_any_role(array['Administrador','Empaque']) is not true then
    raise exception 'Solo Empaque puede ofrecer el pedido a Logistica.';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'El pedido % no existe.',p_order_id; end if;
  if v_order.estado<>'Listo para despacho' then
    raise exception 'El pedido debe estar Listo para despacho.';
  end if;
  select * into v_assignment from public.order_stage_assignments
  where order_id=p_order_id and stage='Empaque' and status='Activa';
  if v_assignment.id is null
     or (v_assignment.user_id<>v_actor.id and not public.has_current_role('Administrador')) then
    raise exception 'Primero debes tomar la etapa Empaque.';
  end if;
  if exists(select 1 from public.order_incidents
    where order_id=p_order_id and status='Abierto') then
    raise exception 'El pedido tiene incidentes abiertos.';
  end if;

  v_signature:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    p_order_id||':'||coalesce((select order_signature
      from public.packing_verifications where order_id=p_order_id),''),
    'UTF8'
  )),'hex');

  insert into public.order_dispatch_handoffs(
    order_id,status,packing_user_id,package_signature,note
  ) values(
    p_order_id,'Ofrecido',v_actor.id,v_signature,btrim(coalesce(p_note,''))
  )
  on conflict(order_id) do update set
    status='Ofrecido',packing_user_id=excluded.packing_user_id,
    logistics_user_id=null,offered_at=now(),accepted_at=null,
    package_signature=excluded.package_signature,note=excluded.note,
    version=public.order_dispatch_handoffs.version+1
  where public.order_dispatch_handoffs.status<>'Aceptado';
  if not found then
    raise exception 'El relevo ya fue aceptado y no puede reemplazarse.';
  end if;
  perform public._add_audit(
    'Pedido',p_order_id,'Relevo ofrecido','Empaque','Logistica'
  );
  return jsonb_build_object(
    'ok',true,'status','Ofrecido','containsCustomerPii',false,
    'containsSecrets',false,'externalExecution',false
  );
end $$;

create or replace function public.piloto_operativo_interno_disponible()
returns boolean
language sql stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select exists(select 1 from public.momos_ops_migrations
    where id='20260722_100_piloto_operativo_interno')
$$;

revoke all on function public.ofrecer_relevo_despacho(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.ofrecer_relevo_despacho(text,text) to authenticated;
revoke all on function public.piloto_operativo_interno_disponible()
  from public,anon,authenticated,service_role;
grant execute on function public.piloto_operativo_interno_disponible() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260722_100_piloto_operativo_interno',
  'Relevo Empaque-Logistica con SHA-256 nativo y gate E2E interno reejecutable'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260722_100_piloto_operativo_interno';
