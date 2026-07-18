-- MOMOS OPS · prueba adversarial de reingreso tras borrado. Siempre ROLLBACK.
begin;

do $$
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260717_57_reingreso_archivo_eliminado'
  ), 'Falta aplicar la migración 57.';
  assert public.reingreso_archivo_eliminado_disponible(), 'La sonda de reingreso no responde.';
  assert has_function_privilege('authenticated','public.registrar_activo_marca(jsonb)','EXECUTE'),
    'Authenticated no puede registrar mediante la RPC protegida.';
  assert not has_function_privilege('anon','public.registrar_activo_marca(jsonb)','EXECUTE'),
    'Anon puede registrar activos.';
  assert not exists(
    select 1 from pg_constraint
    where conrelid='public.brand_media_assets'::regclass
      and conname='brand_media_assets_content_hash_key'
  ), 'Sigue activa la unicidad global que bloquea lápidas.';
  assert exists(
    select 1 from pg_indexes
    where schemaname='public' and tablename='brand_media_assets'
      and indexname='brand_media_assets_live_content_hash_uidx'
      and indexdef ilike '%where (status <> ''Eliminado''%'
  ), 'Falta la unicidad parcial de archivos vigentes.';
end $$;

do $$
declare
  v_actor text; v_hash text:=md5('reupload-a-'||pg_backend_pid())||md5('reupload-b-'||pg_backend_pid());
  v_deleted bigint; v_path text; v_duplicate_path text;
begin
  select id into v_actor from public.users
  where auth_id='992a7036-77fa-4c52-a764-e164bdc75e6e'::uuid and activo;
  assert v_actor is not null, 'Falta actor Administrador para la prueba.';
  v_path:='992a7036-77fa-4c52-a764-e164bdc75e6e/reupload-'||pg_backend_pid()||'.jpg';
  v_duplicate_path:='992a7036-77fa-4c52-a764-e164bdc75e6e/reupload-duplicate-'||pg_backend_pid()||'.jpg';

  insert into public.brand_media_assets(name,media_type,source,orientation,rights_status,ai_use_allowed,status,
    storage_path,content_hash,mime_type,size_bytes,notes,created_by)
  values('Lápida anterior','Foto','MOMOS','Cuadrado','Propio',false,'Eliminado',
    'test/deleted-reupload-'||pg_backend_pid()||'.jpg',v_hash,'image/jpeg',128,
    'Archivo eliminado definitivamente; se conserva únicamente esta lápida de auditoría.',v_actor)
  returning id into v_deleted;

  insert into storage.objects(bucket_id,name,metadata)
  values('brand-assets',v_path,'{"mimetype":"image/jpeg","size":2048}'::jsonb),
        ('brand-assets',v_duplicate_path,'{"mimetype":"image/jpeg","size":2048}'::jsonb);

  perform set_config('momos.reupload_hash',v_hash,true);
  perform set_config('momos.reupload_path',v_path,true);
  perform set_config('momos.reupload_duplicate_path',v_duplicate_path,true);
  perform set_config('momos.reupload_deleted',v_deleted::text,true);
end $$;

select set_config('request.jwt.claims',
  '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare
  v_hash text:=current_setting('momos.reupload_hash');
  v_path text:=current_setting('momos.reupload_path');
  v_duplicate_path text:=current_setting('momos.reupload_duplicate_path');
  v_deleted bigint:=current_setting('momos.reupload_deleted')::bigint;
  v_result jsonb; v_new bigint; v_failed boolean:=false; v_error text:='';
begin
  v_result:=public.registrar_activo_marca(jsonb_build_object(
    'name','Logo principal reingresado','media_type','Logo','source','MOMOS',
    'orientation','Cuadrado','rights_status','Propio','ai_use_allowed',true,
    'storage_path',v_path,'content_hash',v_hash,'mime_type','image/jpeg','size_bytes',2048
  ));
  v_new:=(v_result->>'asset_id')::bigint;

  assert v_new is not null and v_new<>v_deleted, 'No creó una identidad nueva para el reingreso.';
  assert exists(
    select 1 from public.brand_media_assets
    where id=v_new and status='Activo' and content_hash=v_hash and storage_path=v_path
  ), 'No registró el archivo reingresado.';
  assert exists(
    select 1 from public.brand_media_assets
    where id=v_deleted and status='Eliminado' and content_hash=v_hash and ai_use_allowed=false
  ), 'Alteró o revivió la lápida anterior.';

  begin
    perform public.registrar_activo_marca(jsonb_build_object(
      'name','Duplicado vigente','media_type','Logo','source','MOMOS',
      'orientation','Cuadrado','rights_status','Propio','ai_use_allowed',true,
      'storage_path',v_duplicate_path,'content_hash',v_hash,'mime_type','image/jpeg','size_bytes',2048
    ));
  exception when others then
    v_failed:=true; v_error:=sqlerrm;
  end;
  assert v_failed and v_error like '%ya existe en la biblioteca%',
    'Permitió un segundo archivo vigente o perdió el mensaje comprensible.';
  assert (select count(*) from public.brand_media_assets where content_hash=v_hash and status<>'Eliminado')=1,
    'La unicidad vigente quedó rota.';
  assert exists(
    select 1 from public.audit_logs
    where entidad='Biblioteca marca' and entidad_id=v_new::text and accion='Activo original registrado'
  ), 'Falta auditoría del nuevo ingreso.';
end $$;

select 'TESTS_OK — reingreso tras eliminación/duplicado vigente/carrera/auditoría/RBAC PASS, rollback total' as resultado;
rollback;
