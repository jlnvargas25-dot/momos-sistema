-- MOMOS OPS · roles múltiples por usuario
-- Conserva users.rol como rol principal para compatibilidad y acumula permisos en users.roles.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260715'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations where id='20260715_20_biblioteca_creativa') then
    raise exception 'Falta el paso 20_biblioteca_creativa.';
  end if;
  if to_regclass('public.users') is null then raise exception 'Falta public.users.'; end if;
end $$;

alter table public.users add column if not exists roles text[];
update public.users set roles=array[rol] where roles is null or cardinality(roles)=0;

create or replace function public.valid_user_roles(p_roles text[],p_primary text) returns boolean
language sql immutable set search_path=public as $$
  select p_roles is not null
    and cardinality(p_roles)>0
    and p_primary=any(p_roles)
    and p_roles <@ array[
      'Administrador','Cajero','Coordinador de pedidos','Cocina','Empaque',
      'Logística','Marketing/CRM','Mensajero'
    ]::text[]
    and cardinality(p_roles)=(select count(distinct role_name) from unnest(p_roles) role_name)
$$;

alter table public.users alter column roles set not null;
alter table public.users drop constraint if exists users_roles_valid_check;
alter table public.users add constraint users_roles_valid_check check(public.valid_user_roles(roles,rol));

create or replace function public.enforce_user_roles_shape() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.roles is null or cardinality(new.roles)=0 then new.roles:=array[new.rol]; end if;
  if not(new.rol=any(new.roles)) then new.roles:=array_prepend(new.rol,new.roles); end if;
  if public.valid_user_roles(new.roles,new.rol) is not true then
    raise exception 'La combinación de roles del usuario no es válida.';
  end if;
  return new;
end $$;

drop trigger if exists users_roles_shape_guard on public.users;
create trigger users_roles_shape_guard before insert or update of rol,roles on public.users
for each row execute function public.enforce_user_roles_shape();

create or replace function public.guard_last_active_admin_multi() returns trigger
language plpgsql set search_path=public as $$
declare v_removes_admin boolean;
begin
  if tg_op='DELETE' then
    v_removes_admin:=old.activo and 'Administrador'=any(old.roles);
  else
    v_removes_admin:=old.activo and 'Administrador'=any(old.roles)
      and (not new.activo or not('Administrador'=any(new.roles)));
  end if;
  if not v_removes_admin then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('momos_ops_last_active_admin'));
  if not exists(select 1 from public.users u where u.id<>old.id and u.activo and 'Administrador'=any(u.roles)) then
    raise exception 'No se puede quitar ni desactivar al último Administrador activo.';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists users_last_admin_multi_guard on public.users;
create trigger users_last_admin_multi_guard before update of activo,roles or delete on public.users
for each row execute function public.guard_last_active_admin_multi();

create or replace function public.current_roles() returns text[]
language sql stable security definer set search_path=public as $$
  select coalesce(roles,array[rol]) from public.users where auth_id=auth.uid() and activo
$$;

create or replace function public.has_current_role(p_role text) returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce(p_role=any(public.current_roles()),false)
$$;

create or replace function public.current_user_has_any_role(p_roles text[]) returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce(public.current_roles() && coalesce(p_roles,array[]::text[]),false)
$$;

create or replace function public.effective_roles(p_legacy_role text) returns text[]
language sql stable security definer set search_path=public as $$
  select case when cardinality(coalesce(public.current_roles(),array[]::text[]))>0
    then public.current_roles() else array[p_legacy_role] end
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select public.has_current_role('Administrador')
$$;

create or replace function public.roles_multiples_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

-- Matriz de pedidos: los wrappers históricos siguen pasando users.rol, pero
-- estas funciones resuelven el conjunto real de la sesión autenticada.
create or replace function public.order_intake_role_allowed(p_role text) returns boolean
language sql stable set search_path=public as $$
  select public.effective_roles(p_role) && array['Administrador','Cajero','Coordinador de pedidos','Empaque']::text[]
$$;

create or replace function public.order_transition_role_allowed(
  p_role text,p_from text,p_to text,p_quick_sale boolean default false
) returns boolean language sql stable set search_path=public as $$
  select case
    when p_from=p_to then public.effective_roles(p_role) && array[
      'Administrador','Cajero','Coordinador de pedidos','Cocina','Empaque','Logística','Marketing/CRM','Mensajero']::text[]
    when p_to in ('Nuevo','Confirmado','Pendiente de pago') then public.order_intake_role_allowed(p_role)
    when p_to='Pagado' then public.effective_roles(p_role) && array['Administrador','Cajero','Coordinador de pedidos']::text[]
    when p_to in ('En producción','Listo para empaque') then public.effective_roles(p_role) && array['Administrador','Cocina']::text[]
    when p_to in ('Empacado','Listo para despacho') then public.effective_roles(p_role) && array['Administrador','Empaque']::text[]
    when p_to='En ruta' then public.effective_roles(p_role) && array['Administrador','Logística','Mensajero']::text[]
    when p_to='Entregado' and p_quick_sale and p_from='Pagado' then public.effective_roles(p_role) && array['Administrador','Cajero','Coordinador de pedidos','Logística','Mensajero']::text[]
    when p_to='Entregado' and p_quick_sale then false
    when p_to='Entregado' then public.effective_roles(p_role) && array['Administrador','Logística','Mensajero']::text[]
    when p_to='Cancelado' then public.effective_roles(p_role) && array['Administrador','Cajero','Coordinador de pedidos']::text[]
    when p_to='Reclamo' then public.effective_roles(p_role) && array['Administrador','Coordinador de pedidos','Empaque','Logística','Marketing/CRM']::text[]
    else false end
$$;

create or replace function public.order_evidence_role_allowed(p_role text,p_type text) returns boolean
language sql stable set search_path=public as $$
  select case
    when p_type='Comprobante de pago' then public.effective_roles(p_role) && array['Administrador','Cajero','Coordinador de pedidos']::text[]
    when p_type in ('Pedido armado','Caja abierta','Caja cerrada con sello','Bolsa sellada') then public.effective_roles(p_role) && array['Administrador','Empaque']::text[]
    when p_type='Entrega' then public.effective_roles(p_role) && array['Administrador','Cajero','Coordinador de pedidos','Logística','Mensajero']::text[]
    else false end
$$;

create or replace function public.order_stage_role_allowed(p_role text,p_stage text) returns boolean
language sql stable set search_path=public as $$
  select case p_stage
    when 'Cocina' then public.effective_roles(p_role) && array['Administrador','Cocina']::text[]
    when 'Empaque' then public.effective_roles(p_role) && array['Administrador','Empaque']::text[]
    when 'Logística' then public.effective_roles(p_role) && array['Administrador','Logística','Mensajero']::text[]
    else false end
$$;

create or replace function public.delivery_handoff_role_allowed(p_role text) returns boolean
language sql stable set search_path=public as $$
  select public.effective_roles(p_role) && array['Administrador','Empaque','Logística']::text[]
$$;

-- Alta idempotente: un correo existente recibe el rol; nunca se duplica la persona.
create or replace function public.crear_usuario_staff(
  p_nombre text,p_email text,p_rol text,p_sede_id text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id text; v_sede text; v_user public.users%rowtype; v_added boolean:=false;
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede crear usuarios o asignar roles.'; end if;
  if btrim(coalesce(p_nombre,''))='' then raise exception 'Falta el nombre del usuario.'; end if;
  if btrim(coalesce(p_email,''))='' then raise exception 'Falta el email del usuario.'; end if;
  if p_rol is null or not public.valid_user_roles(array[p_rol],p_rol) then raise exception 'Rol inválido: %',coalesce(p_rol,'(vacío)'); end if;

  select * into v_user from public.users where lower(email)=lower(btrim(p_email)) for update;
  if v_user.id is not null then
    v_added:=not(p_rol=any(v_user.roles));
    if v_added then
      update public.users set roles=array_append(roles,p_rol) where id=v_user.id;
      perform public._add_audit('Usuario',v_user.id,'Rol agregado','',p_rol);
    end if;
    return jsonb_build_object('ok',true,'id',v_user.id,'creado',false,'agregado',v_added,'roles',
      (select roles from public.users where id=v_user.id));
  end if;

  v_sede:=coalesce(p_sede_id,(select sede_id from public.users where auth_id=auth.uid()));
  if v_sede is null or not exists(select 1 from public.sedes where id=v_sede) then raise exception 'Sede inválida: %',coalesce(v_sede,'(vacía)'); end if;
  v_id:=public.next_id('user','U',2);
  insert into public.users(id,auth_id,nombre,email,rol,roles,activo,sede_id)
  values(v_id,null,btrim(p_nombre),btrim(p_email),p_rol,array[p_rol],true,v_sede);
  perform public._add_audit('Usuario',v_id,'Usuario creado','',p_rol);
  return jsonb_build_object('ok',true,'id',v_id,'creado',true,'agregado',true,'roles',array[p_rol]);
end $$;

create or replace function public.quitar_rol_usuario(p_user_id text,p_rol text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_user public.users%rowtype; v_roles text[]; v_primary text;
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede retirar roles.'; end if;
  select * into v_user from public.users where id=p_user_id for update;
  if v_user.id is null then raise exception 'El usuario % no existe.',p_user_id; end if;
  if not(p_rol=any(v_user.roles)) then return jsonb_build_object('ok',true,'id',v_user.id,'cambio',false,'rol',v_user.rol,'roles',v_user.roles); end if;
  if cardinality(v_user.roles)=1 then raise exception 'Cada usuario debe conservar al menos un rol.'; end if;
  v_roles:=array_remove(v_user.roles,p_rol);
  v_primary:=case when v_user.rol=p_rol then v_roles[1] else v_user.rol end;
  update public.users set roles=v_roles,rol=v_primary where id=v_user.id;
  perform public._add_audit('Usuario',v_user.id,'Rol retirado',p_rol,v_primary);
  return jsonb_build_object('ok',true,'id',v_user.id,'cambio',true,'rol',v_primary,'roles',v_roles);
end $$;

create or replace function public.set_user_activo(p_user_id text,p_activo boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_user public.users%rowtype;
begin
  if public.is_admin() is not true then raise exception 'Solo un Administrador puede activar/desactivar usuarios.'; end if;
  if p_activo is null then raise exception 'Falta el estado destino.'; end if;
  select * into v_user from public.users where id=p_user_id for update;
  if v_user.id is null then raise exception 'El usuario % no existe.',p_user_id; end if;
  if v_user.activo=p_activo then return jsonb_build_object('ok',true,'activo',v_user.activo,'cambio',false); end if;
  update public.users set activo=p_activo where id=v_user.id;
  perform public._add_audit('Usuario',v_user.id,'Cambio de estado',case when v_user.activo then 'Activo' else 'Inactivo' end,case when p_activo then 'Activo' else 'Inactivo' end);
  return jsonb_build_object('ok',true,'activo',p_activo,'cambio',true);
end $$;

-- Empaque exacto acepta Empaque aunque sea un rol secundario.
create or replace function public.confirmar_verificacion_empaque(p_order_id text,p_line_ids text[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_order public.orders%rowtype; v_user_id text; v_expected_ids text[]; v_snapshot jsonb; v_signature text;
begin
  if public.current_user_has_any_role(array['Administrador','Empaque']) is not true then raise exception 'Solo Administrador o Empaque pueden verificar una comanda.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'El pedido % no existe.',p_order_id; end if;
  if v_order.estado<>'Listo para empaque' then raise exception 'El pedido % debe estar Listo para empaque; actualmente está %.',p_order_id,v_order.estado; end if;
  select coalesce(array_agg(id order by id),array[]::text[]) into v_expected_ids from public.order_items where order_id=p_order_id;
  if cardinality(v_expected_ids)=0 then raise exception 'El pedido % no tiene líneas para verificar.',p_order_id; end if;
  if p_line_ids is null or cardinality(p_line_ids)<>cardinality(v_expected_ids)
    or exists(select 1 from unnest(p_line_ids) id where id is null or btrim(id)='')
    or (select count(distinct id) from unnest(p_line_ids) id)<>cardinality(p_line_ids)
    or exists((select unnest(v_expected_ids) except select unnest(p_line_ids)) union all (select unnest(p_line_ids) except select unnest(v_expected_ids)))
  then raise exception 'Las líneas confirmadas no coinciden exactamente con la orden %.',p_order_id; end if;
  v_snapshot:=public._packing_order_snapshot(p_order_id); v_signature:=md5(v_snapshot::text);
  select id into v_user_id from public.users where auth_id=auth.uid() and activo;
  insert into public.packing_verifications(order_id,user_id,verified_at,line_ids,order_signature,snapshot)
  values(p_order_id,v_user_id,now(),v_expected_ids,v_signature,v_snapshot)
  on conflict(order_id) do update set user_id=excluded.user_id,verified_at=excluded.verified_at,line_ids=excluded.line_ids,order_signature=excluded.order_signature,snapshot=excluded.snapshot;
  perform public._add_audit('Pedido',p_order_id,'Comanda verificada por Empaque','',cardinality(v_expected_ids)::text||' líneas coinciden');
  return jsonb_build_object('ok',true,'order_id',p_order_id,'lineas',cardinality(v_expected_ids),'order_signature',v_signature);
end $$;

create or replace function public.ofrecer_relevo_despacho(p_order_id text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor record; v_order public.orders%rowtype; v_assignment public.order_stage_assignments%rowtype; v_signature text;
begin
  select id,nombre into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or public.current_user_has_any_role(array['Administrador','Empaque']) is not true then raise exception 'Solo Empaque puede ofrecer el pedido a Logística.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.estado<>'Listo para despacho' then raise exception 'El pedido debe estar Listo para despacho.'; end if;
  select * into v_assignment from public.order_stage_assignments where order_id=p_order_id and stage='Empaque' and status='Activa';
  if v_assignment.id is null or (v_assignment.user_id<>v_actor.id and not public.has_current_role('Administrador')) then raise exception 'Primero debés tomar la etapa Empaque.'; end if;
  if exists(select 1 from public.order_incidents where order_id=p_order_id and status='Abierto') then raise exception 'El pedido tiene incidentes abiertos.'; end if;
  v_signature:=encode(digest(p_order_id||':'||coalesce((select order_signature from public.packing_verifications where order_id=p_order_id),''),'sha256'),'hex');
  insert into public.order_dispatch_handoffs(order_id,status,packing_user_id,package_signature,note)
  values(p_order_id,'Ofrecido',v_actor.id,v_signature,btrim(coalesce(p_note,'')))
  on conflict(order_id) do update set status='Ofrecido',packing_user_id=excluded.packing_user_id,logistics_user_id=null,offered_at=now(),accepted_at=null,package_signature=excluded.package_signature,note=excluded.note,version=public.order_dispatch_handoffs.version+1
  where public.order_dispatch_handoffs.status<>'Aceptado';
  if not found then raise exception 'El relevo ya fue aceptado y no puede reemplazarse.'; end if;
  perform public._add_audit('Pedido',p_order_id,'Relevo ofrecido','Empaque','Logística');
  return jsonb_build_object('ok',true,'status','Ofrecido');
end $$;

create or replace function public.aceptar_relevo_despacho(p_order_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor record; v_order public.orders%rowtype; v_handoff public.order_dispatch_handoffs%rowtype; v_assignment text;
begin
  select id,nombre into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or public.current_user_has_any_role(array['Administrador','Logística','Mensajero']) is not true then raise exception 'Solo Logística puede aceptar el relevo.'; end if;
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
  update public.order_stage_assignments set status='Liberada',released_at=now(),release_reason='Relevo aceptado por Logística' where order_id=p_order_id and stage='Empaque' and status='Activa';
  perform public._add_audit('Pedido',p_order_id,'Relevo aceptado','Logística',v_actor.nombre);
  return jsonb_build_object('ok',true,'status','Aceptado','assignment_id',v_assignment);
end $$;

-- Los actores reutilizados por CRM y Agencia también aceptan roles secundarios.
create or replace function public._crm_actor(p_roles text[]) returns public.users
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or public.current_user_has_any_role(p_roles) is not true then raise exception 'Tu rol no puede realizar esta acción de CRM.'; end if;
  return v_actor;
end $$;

create or replace function public._agency_actor() returns public.users
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or public.current_user_has_any_role(array['Administrador','Marketing/CRM']) is not true then raise exception 'Tu rol no puede operar Agencia MOMOS.'; end if;
  if public.has_current_role('Administrador') then v_actor.rol:='Administrador'; end if;
  return v_actor;
end $$;

create or replace function public._distribution_actor() returns public.users
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or public.current_user_has_any_role(array['Administrador','Marketing/CRM']) is not true then raise exception 'Tu rol no puede operar la distribución comercial.'; end if;
  return v_actor;
end $$;

-- Políticas aditivas: PostgreSQL combina políticas permisivas con OR.
do $$ declare t text; begin
  foreach t in array array['campaigns','creatives','content_posts','metrics_daily','recommendations','marketing_ideas','marketing_guiones','marketing_mensajes','brand_library','marketing_tasks','customers','benefits'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists multi_role_mkt_insert on public.%I',t);
      execute format('drop policy if exists multi_role_mkt_update on public.%I',t);
      execute format('create policy multi_role_mkt_insert on public.%I for insert to authenticated with check (public.has_current_role(''Marketing/CRM''))',t);
      execute format('create policy multi_role_mkt_update on public.%I for update to authenticated using (public.has_current_role(''Marketing/CRM'')) with check (public.has_current_role(''Marketing/CRM''))',t);
    end if;
  end loop;
end $$;

drop policy if exists multi_role_log_insert on public.deliveries;
drop policy if exists multi_role_log_update on public.deliveries;
create policy multi_role_log_insert on public.deliveries for insert to authenticated with check(public.has_current_role('Logística'));
create policy multi_role_log_update on public.deliveries for update to authenticated using(public.has_current_role('Logística')) with check(public.has_current_role('Logística'));

do $$ declare t text; begin
  foreach t in array array['production_batches','production_suggestions','subreceta_producciones'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists multi_role_production_insert on public.%I',t);
      execute format('drop policy if exists multi_role_production_update on public.%I',t);
      execute format('create policy multi_role_production_insert on public.%I for insert to authenticated with check (public.current_user_has_any_role(array[''Cocina'',''Empaque'']))',t);
      execute format('create policy multi_role_production_update on public.%I for update to authenticated using (public.current_user_has_any_role(array[''Cocina'',''Empaque''])) with check (public.current_user_has_any_role(array[''Cocina'',''Empaque'']))',t);
    end if;
  end loop;
end $$;

drop policy if exists brand_assets_owner_insert on storage.objects;
create policy brand_assets_owner_insert on storage.objects for insert to authenticated
with check(bucket_id='brand-assets' and name like auth.uid()::text||'/%' and public.current_user_has_any_role(array['Administrador','Marketing/CRM']));
drop policy if exists brand_assets_unregistered_cleanup on storage.objects;
create policy brand_assets_unregistered_cleanup on storage.objects for delete to authenticated
using(bucket_id='brand-assets' and name like auth.uid()::text||'/%'
  and not exists(select 1 from public.brand_media_assets a where a.storage_path=storage.objects.name)
  and public.current_user_has_any_role(array['Administrador','Marketing/CRM']));

revoke all on function public.roles_multiples_disponible() from public,anon;
revoke all on function public.current_roles() from public,anon;
revoke all on function public.has_current_role(text) from public,anon;
revoke all on function public.current_user_has_any_role(text[]) from public,anon;
revoke all on function public.effective_roles(text) from public,anon;
revoke all on function public.crear_usuario_staff(text,text,text,text) from public,anon;
revoke all on function public.quitar_rol_usuario(text,text) from public,anon;
revoke all on function public.set_user_activo(text,boolean) from public,anon;
grant execute on function public.roles_multiples_disponible() to authenticated;
grant execute on function public.current_roles() to authenticated;
grant execute on function public.has_current_role(text) to authenticated;
grant execute on function public.current_user_has_any_role(text[]) to authenticated;
grant execute on function public.effective_roles(text) to authenticated;
grant execute on function public.crear_usuario_staff(text,text,text,text) to authenticated;
grant execute on function public.quitar_rol_usuario(text,text) to authenticated;
grant execute on function public.set_user_activo(text,boolean) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260715_21_roles_multiples','Roles acumulables por usuario, permisos por unión y protección del rol principal')
on conflict(id) do update set detalle=excluded.detalle;

commit;
