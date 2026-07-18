-- MOMOS OPS · prueba adversarial de eliminación protegida del logo oficial. Siempre ROLLBACK.
begin;

do $$
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_60_eliminacion_logo_oficial'
  ), 'Falta aplicar la migración 60.';
  assert public.eliminacion_logo_oficial_disponible(),
    'La sonda de eliminación del logo oficial no responde.';
  assert to_regprocedure('public.momos_sync_manifest_v1()') is not null
    and position(
      'eliminacion_logo_oficial_disponible'
      in pg_get_functiondef('public.momos_sync_manifest_v1()'::regprocedure)
    )>0, 'El manifiesto de Data Sync no anuncia H60.';
  assert has_function_privilege(
    'authenticated','public.preparar_eliminacion_logo_oficial(bigint,text)','EXECUTE'
  ), 'Administración no puede preparar la eliminación protegida.';
  assert has_function_privilege(
    'authenticated','public.confirmar_eliminacion_logo_oficial(bigint,text)','EXECUTE'
  ), 'Administración no puede cerrar la eliminación protegida.';
  assert has_function_privilege(
    'authenticated','public.preparar_eliminacion_activo_marca(bigint)','EXECUTE'
  ), 'La eliminación genérica dejó de estar disponible para archivos libres.';
  assert not has_function_privilege(
    'anon','public.preparar_eliminacion_logo_oficial(bigint,text)','EXECUTE'
  ), 'Anon puede preparar la eliminación del logo.';
  assert not has_function_privilege(
    'anon','public.confirmar_eliminacion_logo_oficial(bigint,text)','EXECUTE'
  ), 'Anon puede confirmar la eliminación del logo.';
  assert not has_function_privilege(
    'authenticated','public._motivos_bloqueo_eliminacion_logo_oficial(bigint)','EXECUTE'
  ), 'El helper privado del logo quedó expuesto.';
end $$;

do $$
declare
  v_admin public.users%rowtype; v_staff public.users%rowtype;
  v_profile bigint; v_logo bigint; v_present bigint; v_locked bigint; v_child bigint;
  v_kit bigint; v_present_kit bigint; v_locked_kit bigint; v_version integer;
  v_path text; v_present_path text; v_locked_path text; v_suffix text:=pg_backend_pid()::text;
begin
  select * into v_admin from public.users
  where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol]))
  order by id limit 1;
  select * into v_staff from public.users
  where activo and auth_id is not null
    and not ('Administrador'=any(coalesce(roles,array[rol])))
  order by id limit 1;
  select id into v_profile from public.agency_brand_profiles order by id limit 1;
  assert v_admin.id is not null and v_staff.id is not null and v_profile is not null,
    'Falta Administrador, usuario no administrador o perfil de marca para la prueba.';

  v_path:='test/h60-logo-'||v_suffix||'.png';
  v_present_path:='test/h60-logo-present-'||v_suffix||'.png';
  v_locked_path:='test/h60-logo-locked-'||v_suffix||'.png';
  insert into storage.objects(bucket_id,name,metadata) values
    ('brand-assets',v_present_path,'{"mimetype":"image/png","size":4096}'::jsonb),
    ('brand-assets',v_locked_path,'{"mimetype":"image/png","size":4096}'::jsonb);

  insert into public.brand_media_assets(
    name,media_type,source,orientation,contains_people,rights_status,ai_use_allowed,
    allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,width,height,tags,created_by
  ) values(
    'Logo oficial eliminable H60','Logo','MOMOS','Horizontal',false,'Propio',true,
    '["Instagram","Facebook","Web"]','Activo',v_path,
    md5('h60-logo-a-'||v_suffix)||md5('h60-logo-b-'||v_suffix),
    'image/png',4096,1200,500,'["momos:marca","logo oficial"]',v_admin.id
  ) returning id into v_logo;

  insert into public.brand_media_assets(
    name,media_type,source,orientation,contains_people,rights_status,ai_use_allowed,
    allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,width,height,tags,created_by
  ) values(
    'Logo oficial todavía presente H60','Logo','MOMOS','Horizontal',false,'Propio',true,
    '["Instagram","Facebook","Web"]','Activo',v_present_path,
    md5('h60-present-a-'||v_suffix)||md5('h60-present-b-'||v_suffix),
    'image/png',4096,1200,500,'["momos:marca","logo oficial"]',v_admin.id
  ) returning id into v_present;

  insert into public.brand_media_assets(
    name,media_type,source,orientation,contains_people,rights_status,ai_use_allowed,
    allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,width,height,tags,created_by
  ) values(
    'Logo oficial con dependencia H60','Logo','MOMOS','Horizontal',false,'Propio',true,
    '["Instagram","Facebook","Web"]','Activo',v_locked_path,
    md5('h60-lock-a-'||v_suffix)||md5('h60-lock-b-'||v_suffix),
    'image/png',4096,1200,500,'["momos:marca","logo oficial"]',v_admin.id
  ) returning id into v_locked;

  insert into public.brand_media_assets(
    name,media_type,source,orientation,contains_people,rights_status,ai_use_allowed,
    allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,created_by,original_asset_id
  ) values(
    'Versión dependiente del logo H60','Foto','Generado','Horizontal',false,'Autorizado',true,
    '["Instagram"]','Activo','test/h60-dependent-'||v_suffix||'.png',
    md5('h60-child-a-'||v_suffix)||md5('h60-child-b-'||v_suffix),
    'image/png',1024,v_admin.id,v_locked
  ) returning id into v_child;

  select coalesce(max(version),0)+1 into v_version from public.agency_brand_kits;
  insert into public.agency_brand_kits(
    version,status,brand_profile_id,change_note,prepared_by
  ) values(
    v_version,'Borrador',v_profile,'Prueba H60 de eliminación protegida',v_admin.id
  ) returning id into v_kit;
  insert into public.agency_brand_kits(
    version,status,brand_profile_id,change_note,prepared_by
  ) values(
    v_version+1,'Borrador',v_profile,'Prueba H60 de objeto aún presente',v_admin.id
  ) returning id into v_present_kit;
  insert into public.agency_brand_kits(
    version,status,brand_profile_id,change_note,prepared_by
  ) values(
    v_version+2,'Borrador',v_profile,'Prueba H60 de dependencia creativa',v_admin.id
  ) returning id into v_locked_kit;

  insert into public.agency_brand_kit_assets(
    kit_id,asset_id,role,background,channels,min_width_px,clear_space_ratio,
    asset_fingerprint,created_by
  ) values(
    v_kit,v_logo,'principal','Claro',array['Instagram','Facebook','Web'],48,0.25,
    public._mcp_brand_asset_fingerprint(v_logo),v_admin.id
  ),(
    v_present_kit,v_present,'principal','Claro',array['Instagram','Facebook','Web'],48,0.25,
    public._mcp_brand_asset_fingerprint(v_present),v_admin.id
  ),(
    v_locked_kit,v_locked,'principal','Claro',array['Instagram','Facebook','Web'],48,0.25,
    public._mcp_brand_asset_fingerprint(v_locked),v_admin.id
  );

  perform set_config('momos.h60_admin_auth',v_admin.auth_id::text,true);
  perform set_config('momos.h60_staff_auth',v_staff.auth_id::text,true);
  perform set_config('momos.h60_logo',v_logo::text,true);
  perform set_config('momos.h60_present',v_present::text,true);
  perform set_config('momos.h60_locked',v_locked::text,true);
  perform set_config('momos.h60_child',v_child::text,true);
  perform set_config('momos.h60_kit',v_kit::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h60_staff_auth'),'role','authenticated'
)::text,true);
set local role authenticated;
do $$
declare v_failed boolean:=false; v_logo bigint:=current_setting('momos.h60_logo')::bigint;
begin
  begin
    perform public.preparar_eliminacion_logo_oficial(v_logo,'ELIMINAR LOGO '||v_logo::text);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Un usuario no administrador pudo eliminar el logo oficial.';
end $$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h60_admin_auth'),'role','authenticated'
)::text,true);
set local role authenticated;
do $$
declare
  v_logo bigint:=current_setting('momos.h60_logo')::bigint;
  v_present bigint:=current_setting('momos.h60_present')::bigint;
  v_locked bigint:=current_setting('momos.h60_locked')::bigint;
  v_kit bigint:=current_setting('momos.h60_kit')::bigint;
  v_phrase text:='ELIMINAR LOGO '||current_setting('momos.h60_logo');
  v_result jsonb; v_failed boolean:=false;
begin
  assert exists(
    select 1 from public.agency_brand_kit_assets
    where kit_id=v_kit and asset_id=v_logo and role='principal'
  ), 'La preparación de prueba perdió el vínculo de Identidad.';

  begin perform public.preparar_eliminacion_activo_marca(v_logo);
  exception when others then v_failed:=true; end;
  assert v_failed, 'La eliminación genérica pudo saltarse el vínculo de Identidad.';

  v_failed:=false;
  begin perform public.preparar_eliminacion_logo_oficial(v_logo,'ELIMINAR LOGO INCORRECTO');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Una frase incorrecta habilitó la eliminación especial.';

  v_failed:=false;
  begin perform public.preparar_eliminacion_logo_oficial(
    v_locked,'ELIMINAR LOGO '||v_locked::text
  ); exception when others then v_failed:=true; end;
  assert v_failed, 'Una dependencia creativa dejó de bloquear el logo.';

  v_result:=public.preparar_eliminacion_logo_oficial(
    v_present,'ELIMINAR LOGO '||v_present::text
  );
  v_failed:=false;
  begin perform public.confirmar_eliminacion_logo_oficial(
    v_present,'ELIMINAR LOGO '||v_present::text
  ); exception when others then v_failed:=true; end;
  assert v_failed, 'El cierre ignoró que el archivo seguía presente en Storage.';
  assert exists(
    select 1 from public.brand_media_assets where id=v_present and status='Eliminando'
  ), 'El cierre fallido perdió el estado compensable.';

  v_result:=public.preparar_eliminacion_logo_oficial(v_logo,v_phrase);
  assert (v_result->>'identity_will_be_incomplete')::boolean
    and (v_result->>'requires_replacement_logo')::boolean
    and not (v_result->>'external_execution')::boolean,
    'La preparación no declaró el impacto seguro sobre Identidad.';
  assert exists(
    select 1 from public.brand_media_assets where id=v_logo and status='Eliminando'
  ), 'El logo no entró en estado compensable.';

end $$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h60_admin_auth'),'role','authenticated'
)::text,true);
set local role authenticated;
do $$
declare
  v_logo bigint:=current_setting('momos.h60_logo')::bigint;
  v_phrase text:='ELIMINAR LOGO '||current_setting('momos.h60_logo');
  v_result jsonb;
begin
  v_result:=public.confirmar_eliminacion_logo_oficial(v_logo,v_phrase);
  assert v_result->>'status'='Eliminado'
    and not (v_result->>'identity_ready')::boolean
    and (v_result->>'requires_replacement_logo')::boolean
    and (v_result->>'historical_binding_preserved')::boolean
    and not (v_result->>'external_execution')::boolean,
    'El cierre no conservó el contrato fail-closed de Identidad.';
end $$;
reset role;

do $$
declare
  v_logo bigint:=current_setting('momos.h60_logo')::bigint;
  v_locked bigint:=current_setting('momos.h60_locked')::bigint;
  v_child bigint:=current_setting('momos.h60_child')::bigint;
  v_kit bigint:=current_setting('momos.h60_kit')::bigint;
begin
  assert exists(
    select 1 from public.brand_media_assets
    where id=v_logo and status='Eliminado' and ai_use_allowed=false
      and tags='[]'::jsonb and allowed_channels='[]'::jsonb
  ), 'El logo no quedó convertido en una lápida segura.';
  assert exists(
    select 1 from public.agency_brand_kit_assets
    where kit_id=v_kit and asset_id=v_logo and role='principal'
  ), 'La eliminación borró el vínculo histórico de Identidad.';
  assert exists(
    select 1 from unnest(public._agency_brand_kit_errors(v_kit)) as e(reason)
    where reason like 'Un logo oficial perdió estado, derechos, archivo o integridad.%'
  ), 'Identidad siguió declarada íntegra sin su archivo oficial.';
  assert exists(
    select 1 from public.brand_media_assets where id=v_locked and status='Activo'
  ) and exists(
    select 1 from public.brand_media_assets where id=v_child and status='Activo'
  ), 'La prueba alteró el logo protegido o su versión dependiente.';
  assert exists(
    select 1 from public.audit_logs
    where entidad='Biblioteca marca' and entidad_id=v_logo::text
      and accion='Eliminación de logo preparada'
  ), 'Falta auditoría de la primera confirmación.';
  assert exists(
    select 1 from public.audit_logs
    where entidad='Biblioteca marca' and entidad_id=v_logo::text
      and accion='Logo oficial eliminado'
  ), 'Falta auditoría del cierre.';
end $$;

select 'TESTS_OK — logo oficial doble confirmación/dependencias/Storage/identidad/RBAC PASS, rollback total' as resultado;
rollback;
