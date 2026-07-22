-- MOMOS OPS · Control operativo del pedido: responsables, líneas, incidentes y relevo.
-- Paso 14, después de productos-servidor-v1.sql.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations where id='20260714_13_productos_servidor') then
    raise exception 'Falta el paso 13_productos_servidor.';
  end if;
  if to_regclass('public.packing_verifications') is null then
    raise exception 'Falta Empaque trazable.';
  end if;
end $$;

create table if not exists public.order_stage_assignments(
  id text primary key,
  order_id text not null references public.orders(id),
  stage text not null check(stage in ('Cocina','Empaque','Logística')),
  user_id text not null references public.users(id),
  status text not null default 'Activa' check(status in ('Activa','Liberada')),
  claimed_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text not null default ''
);
create unique index if not exists order_stage_one_active_uq
  on public.order_stage_assignments(order_id,stage) where status='Activa';
create index if not exists order_stage_assignments_order_idx
  on public.order_stage_assignments(order_id,claimed_at desc);

create table if not exists public.order_line_progress(
  order_item_id text not null references public.order_items(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade,
  stage text not null check(stage in ('Cocina','Empaque')),
  status text not null check(status in ('Pendiente','En proceso','Listo','Verificado','Incidente')),
  user_id text references public.users(id),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check(version>0),
  primary key(order_item_id,stage)
);
create index if not exists order_line_progress_order_idx
  on public.order_line_progress(order_id,stage,status);

create table if not exists public.order_incidents(
  id text primary key,
  order_id text not null references public.orders(id),
  order_item_id text references public.order_items(id),
  area text not null check(area in ('Recepción','Cocina','Empaque','Logística')),
  type text not null check(type in (
    'Faltante','Sustitución','Preparación equivocada','Rehacer','Cancelación posterior',
    'Diferencia de empaque','Dirección','Domicilio','Cliente ausente','Otro'
  )),
  description text not null check(length(btrim(description))>=3),
  status text not null default 'Abierto' check(status in ('Abierto','Resuelto','Cancelado')),
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  resolved_by text references public.users(id),
  resolved_at timestamptz,
  resolution text not null default ''
);
create index if not exists order_incidents_open_idx
  on public.order_incidents(order_id,area) where status='Abierto';

create table if not exists public.order_dispatch_handoffs(
  order_id text primary key references public.orders(id),
  status text not null default 'Ofrecido' check(status in ('Ofrecido','Aceptado','Cancelado')),
  packing_user_id text not null references public.users(id),
  logistics_user_id text references public.users(id),
  offered_at timestamptz not null default now(),
  accepted_at timestamptz,
  package_signature text not null,
  note text not null default '',
  version integer not null default 1 check(version>0)
);

-- Sincronización inmediata entre las pantallas de Caja, Cocina, Empaque y
-- Logística. Es idempotente y también cubre las tablas operativas anteriores.
do $$ declare t text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array[
      'orders','order_items','packing_verifications','evidences','deliveries',
      'order_stage_assignments','order_line_progress','order_incidents','order_dispatch_handoffs'
    ] loop
      if not exists(
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=t
      ) then
        execute format('alter publication supabase_realtime add table public.%I',t);
      end if;
    end loop;
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['order_stage_assignments','order_line_progress','order_incidents','order_dispatch_handoffs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists staff_read on public.%I',t);
    execute format('create policy staff_read on public.%I for select to authenticated using (public.is_staff())',t);
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
    execute format('grant select on table public.%I to authenticated',t);
  end loop;
end $$;

create or replace function public.operacion_pedido_disponible() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.momos_ops_migrations where id='20260714_14_control_operativo')
$$;

create or replace function public.order_stage_role_allowed(p_role text,p_stage text) returns boolean
language sql immutable set search_path=public as $$
  select case p_stage
    when 'Cocina' then p_role in ('Administrador','Cocina')
    when 'Empaque' then p_role in ('Administrador','Empaque')
    when 'Logística' then p_role in ('Administrador','Logística','Mensajero')
    else false end
$$;

create or replace function public._initialize_order_line_progress(p_order_id text,p_stage text)
returns void language sql security definer set search_path=public as $$
  insert into public.order_line_progress(order_item_id,order_id,stage,status)
  select oi.id,oi.order_id,p_stage,'Pendiente'
  from public.order_items oi where oi.order_id=p_order_id and p_stage in ('Cocina','Empaque')
  on conflict(order_item_id,stage) do nothing
$$;

create or replace function public._claim_order_stage(p_order_id text,p_stage text,p_user_id text)
returns text language plpgsql security definer set search_path=public as $$
declare v_active public.order_stage_assignments%rowtype; v_id text;
begin
  select * into v_active from public.order_stage_assignments
  where order_id=p_order_id and stage=p_stage and status='Activa' for update;
  if v_active.id is not null then
    if v_active.user_id<>p_user_id then
      raise exception 'La etapa % del pedido % ya está a cargo de %.',p_stage,p_order_id,
        (select nombre from public.users where id=v_active.user_id);
    end if;
    return v_active.id;
  end if;
  v_id:=public.next_id('stage_assignment','OA-',4);
  insert into public.order_stage_assignments(id,order_id,stage,user_id)
  values(v_id,p_order_id,p_stage,p_user_id);
  perform public._initialize_order_line_progress(p_order_id,p_stage);
  return v_id;
exception when unique_violation then
  select * into v_active from public.order_stage_assignments
  where order_id=p_order_id and stage=p_stage and status='Activa';
  if v_active.user_id=p_user_id then return v_active.id; end if;
  raise exception 'Otra persona tomó la etapa % del pedido % al mismo tiempo.',p_stage,p_order_id;
end;
$$;

create or replace function public.tomar_etapa_pedido(p_order_id text,p_stage text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_order public.orders%rowtype; v_actor record; v_id text;
begin
  select id,rol,nombre into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or public.order_stage_role_allowed(v_actor.rol,p_stage) is not true then
    raise exception 'Tu rol no puede tomar la etapa %.',coalesce(p_stage,'(vacía)');
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'El pedido % no existe.',p_order_id; end if;
  if (p_stage='Cocina' and v_order.estado not in ('Pagado','En producción'))
     or (p_stage='Empaque' and v_order.estado not in ('Listo para empaque','Empacado','Listo para despacho'))
     or (p_stage='Logística' and v_order.estado not in ('Listo para despacho','En ruta')) then
    raise exception 'El pedido % está en % y no puede tomarse en %.',p_order_id,v_order.estado,p_stage;
  end if;
  v_id:=public._claim_order_stage(p_order_id,p_stage,v_actor.id);
  perform public._add_audit('Pedido',p_order_id,'Etapa tomada',p_stage,v_actor.nombre);
  return jsonb_build_object('ok',true,'assignment_id',v_id,'stage',p_stage,'user_id',v_actor.id,'user',v_actor.nombre);
end;
$$;

create or replace function public.liberar_etapa_pedido(p_order_id text,p_stage text,p_reason text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor record; v_assignment public.order_stage_assignments%rowtype;
begin
  select id,rol,nombre into v_actor from public.users where auth_id=auth.uid() and activo;
  select * into v_assignment from public.order_stage_assignments
  where order_id=p_order_id and stage=p_stage and status='Activa' for update;
  if v_assignment.id is null then return jsonb_build_object('ok',true,'sin_cambio',true); end if;
  if v_actor.rol<>'Administrador' and v_assignment.user_id<>v_actor.id then
    raise exception 'Solo la persona responsable o Administración puede liberar esta etapa.';
  end if;
  update public.order_stage_assignments set status='Liberada',released_at=now(),release_reason=btrim(coalesce(p_reason,''))
  where id=v_assignment.id;
  perform public._add_audit('Pedido',p_order_id,'Etapa liberada',p_stage,coalesce(p_reason,''));
  return jsonb_build_object('ok',true,'assignment_id',v_assignment.id);
end;
$$;

create or replace function public.set_progreso_linea_pedido(
  p_order_item_id text,p_stage text,p_status text,p_expected_version integer default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor record; v_item public.order_items%rowtype; v_assignment public.order_stage_assignments%rowtype; v_prev public.order_line_progress%rowtype;
begin
  select id,rol into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or public.order_stage_role_allowed(v_actor.rol,p_stage) is not true then raise exception 'Tu rol no puede actualizar %.',p_stage; end if;
  if (p_stage='Cocina' and p_status not in ('Pendiente','En proceso','Listo','Incidente'))
     or (p_stage='Empaque' and p_status not in ('Pendiente','Incidente')) then
    raise exception 'Estado % inválido para %.',coalesce(p_status,'(vacío)'),p_stage;
  end if;
  select * into v_item from public.order_items where id=p_order_item_id;
  if v_item.id is null then raise exception 'La línea % no existe.',p_order_item_id; end if;
  select * into v_assignment from public.order_stage_assignments
  where order_id=v_item.order_id and stage=p_stage and status='Activa';
  if v_assignment.id is null or (v_assignment.user_id<>v_actor.id and v_actor.rol<>'Administrador') then
    raise exception 'Primero debés tomar la etapa % del pedido %.',p_stage,v_item.order_id;
  end if;
  select * into v_prev from public.order_line_progress where order_item_id=p_order_item_id and stage=p_stage for update;
  if p_expected_version is not null
     and (v_prev.order_item_id is null or v_prev.version is distinct from p_expected_version) then
    raise exception 'La línea cambió en otro dispositivo. Actualizá la vista antes de intentar de nuevo.';
  end if;
  insert into public.order_line_progress(order_item_id,order_id,stage,status,user_id)
  values(v_item.id,v_item.order_id,p_stage,p_status,v_actor.id)
  on conflict(order_item_id,stage) do update set status=excluded.status,user_id=excluded.user_id,
    updated_at=now(),version=public.order_line_progress.version+1;
  return jsonb_build_object('ok',true,'order_id',v_item.order_id,'status',p_status);
end;
$$;

create or replace function public.completar_etapa_pedido(p_order_id text,p_stage text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor record; v_assignment public.order_stage_assignments%rowtype; v_status text; v_count integer;
begin
  select id,rol into v_actor from public.users where auth_id=auth.uid() and activo;
  if p_stage not in ('Cocina','Empaque') or public.order_stage_role_allowed(v_actor.rol,p_stage) is not true then raise exception 'No podés completar la etapa %.',p_stage; end if;
  if p_stage='Empaque' then
    raise exception 'Empaque se completa únicamente verificando la comanda exacta; no admite cierre masivo.';
  end if;
  select * into v_assignment from public.order_stage_assignments
  where order_id=p_order_id and stage=p_stage and status='Activa';
  if v_assignment.id is null or (v_assignment.user_id<>v_actor.id and v_actor.rol<>'Administrador') then raise exception 'Primero debés tomar la etapa %.',p_stage; end if;
  if exists(select 1 from public.order_incidents where order_id=p_order_id and status='Abierto') then raise exception 'El pedido tiene incidentes abiertos.'; end if;
  v_status:=case when p_stage='Cocina' then 'Listo' else 'Verificado' end;
  perform public._initialize_order_line_progress(p_order_id,p_stage);
  update public.order_line_progress set status=v_status,user_id=v_actor.id,updated_at=now(),version=version+1
  where order_id=p_order_id and stage=p_stage and status<>'Incidente';
  get diagnostics v_count=row_count;
  perform public._add_audit('Pedido',p_order_id,'Etapa completada',p_stage,v_count||' líneas');
  return jsonb_build_object('ok',true,'stage',p_stage,'lineas',v_count);
end;
$$;

create or replace function public.crear_incidente_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor record; v_order_id text:=p->>'order_id'; v_item text:=nullif(p->>'order_item_id',''); v_area text:=p->>'area'; v_type text:=p->>'type'; v_desc text:=btrim(coalesce(p->>'description','')); v_id text;
begin
  select id,rol into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null then raise exception 'Solo staff activo puede registrar incidentes.'; end if;
  if not exists(select 1 from public.orders where id=v_order_id) then raise exception 'El pedido no existe.'; end if;
  if v_item is not null and not exists(select 1 from public.order_items where id=v_item and order_id=v_order_id) then raise exception 'La línea no pertenece al pedido.'; end if;
  if v_area not in ('Recepción','Cocina','Empaque','Logística') then raise exception 'Área inválida.'; end if;
  if v_actor.rol<>'Administrador' and not (
    (v_area='Recepción' and v_actor.rol in ('Cajero','Coordinador de pedidos')) or public.order_stage_role_allowed(v_actor.rol,v_area)
  ) then raise exception 'Tu rol no puede registrar incidentes de %.',v_area; end if;
  v_id:=public.next_id('order_incident','INC-',4);
  insert into public.order_incidents(id,order_id,order_item_id,area,type,description,created_by)
  values(v_id,v_order_id,v_item,v_area,v_type,v_desc,v_actor.id);
  if v_item is not null and v_area in ('Cocina','Empaque') then
    insert into public.order_line_progress(order_item_id,order_id,stage,status,user_id)
    values(v_item,v_order_id,v_area,'Incidente',v_actor.id)
    on conflict(order_item_id,stage) do update set status='Incidente',user_id=v_actor.id,updated_at=now(),version=public.order_line_progress.version+1;
  end if;
  perform public._add_audit('Pedido',v_order_id,'Incidente abierto',v_area,v_type);
  return jsonb_build_object('ok',true,'incident_id',v_id);
end;
$$;

create or replace function public.resolver_incidente_pedido(p_incident_id text,p_resolution text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor record; v public.order_incidents%rowtype;
begin
  select id,rol into v_actor from public.users where auth_id=auth.uid() and activo;
  select * into v from public.order_incidents where id=p_incident_id for update;
  if v.id is null then raise exception 'El incidente no existe.'; end if;
  if v.status<>'Abierto' then return jsonb_build_object('ok',true,'sin_cambio',true); end if;
  if v_actor.rol not in ('Administrador','Coordinador de pedidos') and not public.order_stage_role_allowed(v_actor.rol,v.area) then raise exception 'Tu rol no puede resolver este incidente.'; end if;
  if length(btrim(coalesce(p_resolution,'')))<3 then raise exception 'Indicá cómo se resolvió.'; end if;
  update public.order_incidents set status='Resuelto',resolved_by=v_actor.id,resolved_at=now(),resolution=btrim(p_resolution) where id=v.id;
  if v.order_item_id is not null and v.area in ('Cocina','Empaque') then
    update public.order_line_progress set status='Pendiente',user_id=v_actor.id,updated_at=now(),version=version+1
    where order_item_id=v.order_item_id and stage=v.area and status='Incidente';
  end if;
  perform public._add_audit('Pedido',v.order_id,'Incidente resuelto',v.type,p_resolution);
  return jsonb_build_object('ok',true,'incident_id',v.id);
end;
$$;

create or replace function public.ofrecer_relevo_despacho(p_order_id text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor record; v_order public.orders%rowtype; v_assignment public.order_stage_assignments%rowtype; v_signature text;
begin
  select id,rol into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.rol not in ('Administrador','Empaque') then raise exception 'Solo Empaque puede ofrecer el pedido a Logística.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.estado<>'Listo para despacho' then raise exception 'El pedido debe estar Listo para despacho.'; end if;
  select * into v_assignment from public.order_stage_assignments where order_id=p_order_id and stage='Empaque' and status='Activa';
  if v_assignment.id is null or (v_assignment.user_id<>v_actor.id and v_actor.rol<>'Administrador') then raise exception 'Primero debés tomar la etapa Empaque.'; end if;
  if exists(select 1 from public.order_incidents where order_id=p_order_id and status='Abierto') then raise exception 'El pedido tiene incidentes abiertos.'; end if;
  v_signature:=encode(digest(p_order_id||':'||coalesce((select order_signature from public.packing_verifications where order_id=p_order_id),''), 'sha256'),'hex');
  insert into public.order_dispatch_handoffs(order_id,status,packing_user_id,package_signature,note)
  values(p_order_id,'Ofrecido',v_actor.id,v_signature,btrim(coalesce(p_note,'')))
  on conflict(order_id) do update set status='Ofrecido',packing_user_id=excluded.packing_user_id,
    logistics_user_id=null,offered_at=now(),accepted_at=null,package_signature=excluded.package_signature,
    note=excluded.note,version=public.order_dispatch_handoffs.version+1
  where public.order_dispatch_handoffs.status<>'Aceptado';
  if not found then raise exception 'El relevo ya fue aceptado y no puede reemplazarse.'; end if;
  perform public._add_audit('Pedido',p_order_id,'Relevo ofrecido','Empaque','Logística');
  return jsonb_build_object('ok',true,'status','Ofrecido');
end;
$$;

create or replace function public.aceptar_relevo_despacho(p_order_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor record; v_order public.orders%rowtype; v_handoff public.order_dispatch_handoffs%rowtype; v_assignment text;
begin
  select id,rol,nombre into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.rol not in ('Administrador','Logística','Mensajero') then raise exception 'Solo Logística puede aceptar el relevo.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.estado<>'Listo para despacho' then raise exception 'El pedido debe estar Listo para despacho.'; end if;
  select * into v_handoff from public.order_dispatch_handoffs where order_id=p_order_id for update;
  if v_handoff.order_id is null or v_handoff.status='Cancelado' then raise exception 'Empaque todavía no ofreció este pedido.'; end if;
  if v_handoff.status='Aceptado' then
    if v_handoff.logistics_user_id=v_actor.id then return jsonb_build_object('ok',true,'sin_cambio',true); end if;
    raise exception 'El relevo ya fue aceptado por otra persona.';
  end if;
  v_assignment:=public._claim_order_stage(p_order_id,'Logística',v_actor.id);
  update public.order_dispatch_handoffs set status='Aceptado',logistics_user_id=v_actor.id,accepted_at=now(),version=version+1 where order_id=p_order_id;
  update public.order_stage_assignments set status='Liberada',released_at=now(),release_reason='Relevo aceptado por Logística'
  where order_id=p_order_id and stage='Empaque' and status='Activa';
  perform public._add_audit('Pedido',p_order_id,'Relevo aceptado','Logística',v_actor.nombre);
  return jsonb_build_object('ok',true,'status','Aceptado','assignment_id',v_assignment);
end;
$$;

-- La verificación exacta de Empaque alimenta el progreso de sus líneas.
create or replace function public.sync_packing_line_progress() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.order_line_progress(order_item_id,order_id,stage,status,user_id)
  select oi.id,new.order_id,'Empaque','Verificado',new.user_id
  from public.order_items oi where oi.order_id=new.order_id and oi.id=any(new.line_ids)
  on conflict(order_item_id,stage) do update set status='Verificado',user_id=excluded.user_id,
    updated_at=now(),version=public.order_line_progress.version+1;
  return new;
end;
$$;
drop trigger if exists packing_verification_line_progress on public.packing_verifications;
create trigger packing_verification_line_progress after insert or update on public.packing_verifications
for each row execute function public.sync_packing_line_progress();

create or replace function public.enforce_operational_order_transition() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_actor record; v_assignment public.order_stage_assignments%rowtype; v_handoff public.order_dispatch_handoffs%rowtype;
begin
  if new.estado is not distinct from old.estado then return new; end if;
  if auth.uid() is null and coalesce(auth.role(),'') not in ('authenticated','anon') then return new; end if;
  select id,rol into v_actor from public.users where auth_id=auth.uid() and activo;
  if new.estado='En producción' then
    perform public._claim_order_stage(new.id,'Cocina',v_actor.id);
  elsif new.estado='Listo para empaque' then
    select * into v_assignment from public.order_stage_assignments where order_id=new.id and stage='Cocina' and status='Activa';
    if v_assignment.id is null or (v_assignment.user_id<>v_actor.id and v_actor.rol<>'Administrador') then raise exception 'Primero debés tomar la etapa Cocina.'; end if;
    if exists(select 1 from public.order_incidents where order_id=new.id and status='Abierto') then raise exception 'El pedido tiene incidentes abiertos.'; end if;
    if exists(select 1 from public.order_items oi left join public.order_line_progress lp on lp.order_item_id=oi.id and lp.stage='Cocina' where oi.order_id=new.id and coalesce(lp.status,'Pendiente')<>'Listo') then raise exception 'Todas las líneas deben quedar Listas en Cocina.'; end if;
  elsif new.estado='Empacado' then
    perform public._claim_order_stage(new.id,'Empaque',v_actor.id);
    if exists(select 1 from public.order_incidents where order_id=new.id and status='Abierto') then raise exception 'El pedido tiene incidentes abiertos.'; end if;
    if exists(select 1 from public.order_items oi left join public.order_line_progress lp on lp.order_item_id=oi.id and lp.stage='Empaque' where oi.order_id=new.id and coalesce(lp.status,'Pendiente')<>'Verificado') then raise exception 'Todas las líneas deben quedar Verificadas en Empaque.'; end if;
  elsif new.estado='En ruta' then
    select * into v_handoff from public.order_dispatch_handoffs where order_id=new.id;
    if v_handoff.status is distinct from 'Aceptado' then raise exception 'Logística debe aceptar el relevo físico antes de iniciar la ruta.'; end if;
    if v_handoff.logistics_user_id<>v_actor.id and v_actor.rol<>'Administrador' then raise exception 'El relevo fue aceptado por otra persona.'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_operational_control_guard on public.orders;
create trigger orders_operational_control_guard before update of estado on public.orders
for each row execute function public.enforce_operational_order_transition();

create or replace function public.release_finished_order_stages() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.estado='Listo para empaque' then
    update public.order_stage_assignments set status='Liberada',released_at=now(),release_reason='Cocina entregó a Empaque'
    where order_id=new.id and stage='Cocina' and status='Activa';
  elsif new.estado in ('Entregado','Cancelado') then
    update public.order_stage_assignments set status='Liberada',released_at=now(),release_reason='Pedido '||new.estado
    where order_id=new.id and status='Activa';
  end if;
  return new;
end;
$$;
drop trigger if exists orders_release_finished_stages on public.orders;
create trigger orders_release_finished_stages after update of estado on public.orders
for each row execute function public.release_finished_order_stages();

revoke all on function public._initialize_order_line_progress(text,text) from public,anon,authenticated;
revoke all on function public._claim_order_stage(text,text,text) from public,anon,authenticated;
revoke all on function public.sync_packing_line_progress() from public,anon,authenticated;
revoke all on function public.enforce_operational_order_transition() from public,anon,authenticated;
revoke all on function public.release_finished_order_stages() from public,anon,authenticated;
revoke all on function public.operacion_pedido_disponible() from public,anon,authenticated;
revoke all on function public.order_stage_role_allowed(text,text) from public,anon,authenticated;
revoke all on function public.tomar_etapa_pedido(text,text) from public,anon,authenticated;
revoke all on function public.liberar_etapa_pedido(text,text,text) from public,anon,authenticated;
revoke all on function public.set_progreso_linea_pedido(text,text,text,integer) from public,anon,authenticated;
revoke all on function public.completar_etapa_pedido(text,text) from public,anon,authenticated;
revoke all on function public.crear_incidente_pedido(jsonb) from public,anon,authenticated;
revoke all on function public.resolver_incidente_pedido(text,text) from public,anon,authenticated;
revoke all on function public.ofrecer_relevo_despacho(text,text) from public,anon,authenticated;
revoke all on function public.aceptar_relevo_despacho(text) from public,anon,authenticated;
grant execute on function public.operacion_pedido_disponible() to authenticated;
grant execute on function public.order_stage_role_allowed(text,text) to authenticated;
grant execute on function public.tomar_etapa_pedido(text,text) to authenticated;
grant execute on function public.liberar_etapa_pedido(text,text,text) to authenticated;
grant execute on function public.set_progreso_linea_pedido(text,text,text,integer) to authenticated;
grant execute on function public.completar_etapa_pedido(text,text) to authenticated;
grant execute on function public.crear_incidente_pedido(jsonb) to authenticated;
grant execute on function public.resolver_incidente_pedido(text,text) to authenticated;
grant execute on function public.ofrecer_relevo_despacho(text,text) to authenticated;
grant execute on function public.aceptar_relevo_despacho(text) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260714_14_control_operativo','Responsable único por etapa, progreso por línea, incidentes y relevo físico Empaque-Logística')
on conflict(id) do update set detalle=excluded.detalle;
commit;

select id,applied_at,detalle from public.momos_ops_migrations where id='20260714_14_control_operativo';
