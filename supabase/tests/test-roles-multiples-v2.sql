-- MOMOS OPS · roles múltiples adversarial V2. Siempre ROLLBACK.
-- V2 no genera UUID de Auth: presta y restaura la identidad administradora dentro de la transacción.
begin;

create temporary table multi_role_test_context(user_id text,email text,auth_id uuid,admin_user_id text) on commit drop;
grant select,insert on table multi_role_test_context to authenticated;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_email text:='roles-'||pg_backend_pid()||'@momos.test'; v_first jsonb; v_second jsonb; v_same jsonb; v_failed boolean:=false;
begin
  assert public.roles_multiples_disponible(), 'Falta aplicar la migración 21.';
  v_first:=public.crear_usuario_staff('Operadora multirol',v_email,'Cocina');
  v_second:=public.crear_usuario_staff('Nombre ignorado',upper(v_email),'Empaque');
  v_same:=public.crear_usuario_staff('Nombre ignorado',v_email,'Empaque');
  assert (v_first->>'creado')::boolean, 'A1 no creó el usuario inicial.';
  assert not (v_second->>'creado')::boolean and (v_second->>'agregado')::boolean, 'A2 no acumuló Empaque.';
  assert not (v_same->>'agregado')::boolean, 'A3 duplicó el mismo rol.';
  assert (select count(*) from public.users where lower(email)=lower(v_email))=1, 'A4 duplicó el correo.';
  assert (select roles from public.users where id=v_first->>'id')=array['Cocina','Empaque']::text[], 'A5 alteró el orden o perdió roles.';
  assert (select rol from public.users where id=v_first->>'id')='Cocina', 'A6 cambió el rol principal al asignar otro.';
  insert into multi_role_test_context
  select v_first->>'id',v_email,auth.uid(),id
  from public.users where auth_id=auth.uid() and activo;
  assert (select count(*) from multi_role_test_context)=1, 'A7 no encontró la identidad administradora de la prueba.';

  begin perform public.crear_usuario_staff('Inválido','invalido-'||v_email,'Superhéroe');
  exception when others then v_failed:=true; end;
  assert v_failed, 'B1 aceptó un rol inventado.';
end $$;

reset role;

-- public.users.auth_id referencia auth.users(id). Para probar una sesión Cocina+Empaque
-- sin insertar identidades falsas en Auth, prestamos dentro de esta transacción la
-- identidad existente del administrador y la restauramos antes de probar los RPC admin.
do $$
declare v_user text; v_admin text; v_auth uuid;
begin
  select user_id,admin_user_id,auth_id into v_user,v_admin,v_auth from multi_role_test_context;
  update public.users set auth_id=null where id=v_admin;
  update public.users set auth_id=v_auth where id=v_user;
end $$;

select set_config('request.jwt.claims',json_build_object('sub',(select auth_id::text from multi_role_test_context),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_failed boolean:=false;
begin
  assert public.current_roles()=array['Cocina','Empaque']::text[], 'C1 la sesión no recibió ambos roles.';
  assert public.has_current_role('Cocina') and public.has_current_role('Empaque'), 'C2 no unió permisos.';
  assert public.order_stage_role_allowed('Cocina','Cocina'), 'C3 perdió Cocina.';
  assert public.order_stage_role_allowed('Cocina','Empaque'), 'C4 el rol secundario no habilitó Empaque.';
  assert public.order_transition_role_allowed('Cocina','Listo para empaque','Empacado',false), 'C5 no permitió el paso de Empaque.';
  assert not public.order_transition_role_allowed('Cocina','Pendiente de pago','Pagado',false), 'C6 heredó Caja sin tener ese rol.';
  assert public.order_evidence_role_allowed('Cocina','Caja abierta'), 'C7 no permitió la evidencia de Empaque.';
  assert not public.order_evidence_role_allowed('Cocina','Comprobante de pago'), 'C8 permitió evidencia de Caja.';
  begin perform public.crear_usuario_staff('Ataque','ataque-'||pg_backend_pid()||'@momos.test','Cocina');
  exception when others then v_failed:=true; end;
  assert v_failed, 'C9 un usuario no administrador pudo asignar roles.';
end $$;

reset role;

do $$
declare v_user text; v_admin text; v_auth uuid;
begin
  select user_id,admin_user_id,auth_id into v_user,v_admin,v_auth from multi_role_test_context;
  update public.users set auth_id=null where id=v_user;
  update public.users set auth_id=v_auth where id=v_admin;
end $$;

select set_config('request.jwt.claims',json_build_object('sub',(select auth_id::text from multi_role_test_context),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_user text; v_result jsonb; v_failed boolean:=false;
begin
  select user_id into v_user from multi_role_test_context;
  v_result:=public.quitar_rol_usuario(v_user,'Cocina');
  assert v_result->>'rol'='Empaque', 'D1 no promovió un rol restante al quitar el principal.';
  assert (select roles from public.users where id=v_user)=array['Empaque']::text[], 'D2 no retiró exactamente el rol pedido.';
  begin perform public.quitar_rol_usuario(v_user,'Empaque');
  exception when others then v_failed:=true; end;
  assert v_failed, 'D3 permitió dejar un usuario sin roles.';
end $$;

reset role;

do $$
declare v_failed boolean:=false; v_last text;
begin
  -- El guard se prueba sobre el último administrador activo sin depender de cuántos tenga el entorno.
  perform pg_advisory_xact_lock(hashtext('momos_ops_last_active_admin'));
  select id into v_last from public.users where activo and 'Administrador'=any(roles) order by id limit 1;
  update public.users set activo=false where activo and 'Administrador'=any(roles) and id<>v_last;
  begin update public.users set roles=array['Cocina'],rol='Cocina' where id=v_last;
  exception when others then v_failed:=true; end;
  assert v_failed, 'E1 permitió retirar al último Administrador activo.';
  assert exists(select 1 from public.users where id=v_last and activo and 'Administrador'=any(roles)), 'E2 dejó el sistema sin Administrador.';
end $$;

select 'TESTS_OK — roles múltiples acumulables/RBAC/anti-lockout PASS, rollback total' as resultado;
rollback;
