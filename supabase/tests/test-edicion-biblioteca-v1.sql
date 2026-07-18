-- MOMOS OPS · prueba adversarial de edición segura de Biblioteca. Siempre ROLLBACK.
begin;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260718_58_edicion_biblioteca'),
    'Falta aplicar la migración 58.';
  assert public.edicion_biblioteca_disponible(), 'La sonda de edición no responde.';
  assert to_regclass('public.brand_media_asset_metadata_versions') is not null,
    'Falta el historial versionado de metadatos.';
  assert has_function_privilege('authenticated','public.actualizar_metadatos_activo_marca(bigint,jsonb)','EXECUTE'),
    'Falta la RPC protegida de edición.';
  assert not has_function_privilege('anon','public.actualizar_metadatos_activo_marca(bigint,jsonb)','EXECUTE'),
    'Anon puede editar la Biblioteca.';
  assert not has_table_privilege('authenticated','public.brand_media_assets','UPDATE'),
    'Authenticated puede saltarse la RPC y editar originales directamente.';
  assert not has_table_privilege('authenticated','public.brand_media_asset_metadata_versions','INSERT'),
    'Authenticated puede fabricar versiones de metadatos.';
end $$;

do $$
declare
  v_actor text; v_product text; v_free bigint; v_locked bigint; v_child bigint;
  v_free_hash text:=md5('edit-free-a-'||pg_backend_pid())||md5('edit-free-b-'||pg_backend_pid());
  v_locked_hash text:=md5('edit-lock-a-'||pg_backend_pid())||md5('edit-lock-b-'||pg_backend_pid());
begin
  select id into v_actor from public.users
    where auth_id='992a7036-77fa-4c52-a764-e164bdc75e6e'::uuid and activo;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor is not null and v_product is not null, 'Falta actor o producto para la prueba.';

  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,status,storage_path,content_hash,mime_type,size_bytes,tags,notes,created_by)
  values('Archivo libre','Foto','MOMOS',v_product,'Max','Oreo','Producto','Vertical',false,'Propio',true,'Activo',
    'test/edit-free-'||pg_backend_pid()||'.jpg',v_free_hash,'image/jpeg',1024,'["momos:producto","vieja"]','Nota inicial',v_actor)
  returning id into v_free;

  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,status,storage_path,content_hash,mime_type,size_bytes,tags,notes,created_by)
  values('Archivo usado','Foto','MOMOS',v_product,'Lizi','Coco','Producto','Vertical',false,'Propio',true,'Activo',
    'test/edit-locked-'||pg_backend_pid()||'.jpg',v_locked_hash,'image/jpeg',1024,'["momos:producto"]','Nota inicial',v_actor)
  returning id into v_locked;

  insert into public.brand_media_assets(name,media_type,source,orientation,rights_status,ai_use_allowed,status,
    storage_path,content_hash,mime_type,size_bytes,created_by,original_asset_id)
  values('Versión dependiente','Foto','Generado','Vertical','Autorizado',true,'Activo',
    'test/edit-child-'||pg_backend_pid()||'.jpg',md5(random()::text)||md5(random()::text),'image/jpeg',512,v_actor,v_locked)
  returning id into v_child;

  perform set_config('momos.edit_free',v_free::text,true);
  perform set_config('momos.edit_locked',v_locked::text,true);
  perform set_config('momos.edit_free_hash',v_free_hash,true);
  perform set_config('momos.edit_product',v_product,true);
end $$;

select set_config('request.jwt.claims',
  '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare
  v_free bigint:=current_setting('momos.edit_free')::bigint;
  v_locked bigint:=current_setting('momos.edit_locked')::bigint;
  v_hash text:=current_setting('momos.edit_free_hash');
  v_product text:=current_setting('momos.edit_product');
  v_result jsonb; v_failed boolean:=false; v_before_path text; v_before_source text; v_before_mime text;
begin
  select storage_path,source,mime_type into v_before_path,v_before_source,v_before_mime
    from public.brand_media_assets where id=v_free;
  v_result:=public.actualizar_metadatos_activo_marca(v_free,jsonb_build_object(
    'name','Max Oreo corregido','collection','Productos','product_id',v_product,
    'figure','Max','flavor','Oreo','shot_type','Close-up','orientation','Cuadrado',
    'contains_people',true,'rights_status','Por verificar','rights_expires_at',null,
    'ai_use_allowed',true,'tags',jsonb_build_array('close-up','momos:marca','oreo'),'notes','Alcance corregido'
  ));
  assert (v_result->>'version')::int>=2, 'No creó una versión nueva.';
  assert exists(select 1 from public.brand_media_assets where id=v_free and name='Max Oreo corregido'
    and shot_type='Close-up' and orientation='Cuadrado' and contains_people
    and rights_status='Por verificar' and ai_use_allowed=false
    and tags ? 'momos:producto' and not (tags ? 'momos:marca')),
    'No corrigió o normalizó los metadatos.';
  assert exists(select 1 from public.brand_media_assets where id=v_free and content_hash=v_hash
    and storage_path=v_before_path and source=v_before_source and mime_type=v_before_mime),
    'Alteró identidad, procedencia o archivo físico.';
  assert (select count(*) from public.brand_media_asset_metadata_versions where asset_id=v_free)>=2,
    'No conservó el historial versionado.';

  v_failed:=false;
  begin
    perform public.actualizar_metadatos_activo_marca(v_free,jsonb_build_object(
      'name','Intento inseguro','storage_path','otra/ruta.jpg'
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Permitió editar una ruta o campo inmutable.';

  v_failed:=false;
  begin
    perform public.actualizar_metadatos_activo_marca(v_locked,jsonb_build_object(
      'name','Archivo usado','collection','Productos','product_id',v_product,
      'figure','Max','flavor','Fresa','shot_type','Producto','orientation','Vertical',
      'contains_people',false,'rights_status','Propio','rights_expires_at',null,
      'ai_use_allowed',true,'tags',jsonb_build_array('cambio'),'notes','No debe pasar'
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Permitió reescribir la clasificación de un original usado.';
  assert exists(select 1 from public.brand_media_assets where id=v_locked and figure='Lizi' and flavor='Coco'),
    'Alteró el significado histórico del original usado.';

  v_result:=public.actualizar_metadatos_activo_marca(v_locked,jsonb_build_object(
    'name','Archivo usado · nombre corregido','tags',jsonb_build_array('descriptiva'),
    'notes','Corrección descriptiva permitida'
  ));
  assert (v_result->>'semantic_locked')::boolean,
    'No informó que la clasificación estaba protegida.';
  assert exists(select 1 from public.brand_media_assets where id=v_locked
    and name='Archivo usado · nombre corregido' and figure='Lizi' and flavor='Coco'),
    'No permitió la corrección descriptiva segura.';
  assert exists(select 1 from public.audit_logs where entidad='Biblioteca marca'
    and entidad_id=v_locked::text and accion='Metadatos actualizados'),
    'Falta auditoría de la edición.';
end $$;

select 'TESTS_OK — Biblioteca vista/edición/versiones/inmutabilidad/activos usados/RBAC | resultado                                                                                            |
| ---------------------------------------------------------------------------------------------------- |
| TESTS_OK — Biblioteca vista/edición/versiones/inmutabilidad/activos usados/RBAC PASS, rollback total |PASS, rollback total' as resultado;
rollback;
