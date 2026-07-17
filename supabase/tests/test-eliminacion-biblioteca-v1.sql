-- MOMOS OPS · prueba adversarial de eliminación segura en Biblioteca. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260717_51_eliminacion_biblioteca'), 'Falta aplicar la migración 51.';
  assert public.eliminacion_biblioteca_disponible(), 'La sonda de eliminación no responde.';
  assert has_function_privilege('authenticated','public.preparar_eliminacion_activo_marca(bigint)','EXECUTE'), 'Falta preparar eliminación.';
  assert has_function_privilege('authenticated','public.cancelar_eliminacion_activo_marca(bigint,text)','EXECUTE'), 'Falta compensación de eliminación.';
  assert has_function_privilege('authenticated','public.confirmar_eliminacion_activo_marca(bigint)','EXECUTE'), 'Falta confirmar eliminación.';
  assert not has_function_privilege('anon','public.preparar_eliminacion_activo_marca(bigint)','EXECUTE'), 'Anon puede preparar eliminaciones.';
  assert not has_function_privilege('authenticated','public._motivos_bloqueo_eliminacion_activo(bigint)','EXECUTE'), 'Helper privado expuesto.';
end $$;

do $$
declare v_actor text; v_free bigint; v_used bigint; v_child bigint;
begin
  select id into v_actor from public.users where auth_id='992a7036-77fa-4c52-a764-e164bdc75e6e'::uuid and activo;
  assert v_actor is not null, 'Falta actor Administrador para la prueba.';

  insert into public.brand_media_assets(name,media_type,source,orientation,rights_status,ai_use_allowed,status,storage_path,
    content_hash,mime_type,size_bytes,created_by)
  values('Original libre para borrar','Foto','MOMOS','Vertical','Propio',true,'Activo','test/delete-free-'||pg_backend_pid()||'.jpg',
    md5('free-'||random()::text)||md5(random()::text),'image/jpeg',128,v_actor) returning id into v_free;

  insert into public.brand_media_assets(name,media_type,source,orientation,rights_status,ai_use_allowed,status,storage_path,
    content_hash,mime_type,size_bytes,created_by)
  values('Original protegido por versión','Foto','MOMOS','Vertical','Propio',true,'Activo','test/delete-used-'||pg_backend_pid()||'.jpg',
    md5('used-'||random()::text)||md5(random()::text),'image/jpeg',128,v_actor) returning id into v_used;

  insert into public.brand_media_assets(name,media_type,source,orientation,rights_status,ai_use_allowed,status,storage_path,
    content_hash,mime_type,size_bytes,created_by,original_asset_id)
  values('Versión conservada','Foto','Generado','Vertical','Autorizado',true,'Activo','test/delete-child-'||pg_backend_pid()||'.jpg',
    md5('child-'||random()::text)||md5(random()::text),'image/jpeg',128,v_actor,v_used) returning id into v_child;

  perform set_config('momos.delete_free',v_free::text,true);
  perform set_config('momos.delete_used',v_used::text,true);
end $$;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_free bigint:=current_setting('momos.delete_free')::bigint;
  v_used bigint:=current_setting('momos.delete_used')::bigint;
  v_result jsonb; v_failed boolean:=false;
begin
  v_result:=public.preparar_eliminacion_activo_marca(v_free);
  assert v_result->>'previous_status'='Activo', 'No conservó el estado previo para compensar.';
  assert exists(select 1 from public.brand_media_assets where id=v_free and status='Eliminando'), 'No preparó la eliminación.';

  v_result:=public.cancelar_eliminacion_activo_marca(v_free,'Activo');
  assert exists(select 1 from public.brand_media_assets where id=v_free and status='Activo'), 'No compensó el fallo de Storage.';

  v_result:=public.preparar_eliminacion_activo_marca(v_free);
  v_result:=public.confirmar_eliminacion_activo_marca(v_free);
  assert exists(select 1 from public.brand_media_assets where id=v_free and status='Eliminado' and ai_use_allowed=false
    and notes like 'Archivo eliminado definitivamente%'), 'No conservó la lápida segura.';

  begin
    perform public.preparar_eliminacion_activo_marca(v_used);
  exception when others then
    v_failed:=true;
  end;
  assert v_failed, 'Permitió borrar un original del que depende otra versión.';
  assert exists(select 1 from public.brand_media_assets where id=v_used and status='Activo'), 'Alteró el original protegido.';
  assert exists(select 1 from public.audit_logs where entidad='Biblioteca marca' and entidad_id=v_free::text and accion='Archivo eliminado'), 'Falta auditoría del borrado.';
end $$;

select 'TESTS_OK — Biblioteca elimina solo originales sin uso/compensación/auditoría/RBAC PASS, rollback total' as resultado;
rollback;
