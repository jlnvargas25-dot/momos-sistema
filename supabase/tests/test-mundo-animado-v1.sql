-- MOMOS OPS · prueba adversarial H59 Mundo animado. Siempre ROLLBACK.
begin;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260718_59_mundo_animado'),
    'Falta aplicar la migración 59.';
  assert public.mundo_animado_disponible(), 'La sonda del Mundo animado no responde.';
  assert exists(select 1 from pg_trigger where tgname='validar_taxonomia_mundo_animado' and not tgisinternal),
    'Falta el guard de taxonomía animada.';
  assert not has_table_privilege('authenticated','public.brand_media_assets','INSERT'),
    'Authenticated puede fabricar personajes directamente.';
  assert not has_table_privilege('authenticated','public.brand_media_assets','UPDATE'),
    'Authenticated puede alterar el canon directamente.';
  assert has_function_privilege('authenticated','public.actualizar_metadatos_activo_marca(bigint,jsonb)','EXECUTE'),
    'Falta la edición segura y versionada.';
  assert not has_function_privilege('anon','public.actualizar_metadatos_activo_marca(bigint,jsonb)','EXECUTE'),
    'Anon puede editar el Mundo animado.';
  assert exists(
    select 1
    from public.agency_brand_kit_assets b
    cross join lateral unnest(public._motivos_bloqueo_eliminacion_activo(b.asset_id)) reason
    where reason='está ligado a una versión de identidad de marca'
  ), 'H59 perdió la protección de logos oficiales de H55.';
end $$;

do $$
declare
  v_admin text; v_marketing_auth uuid; v_product text; v_free bigint; v_marketing bigint;
  v_failed boolean:=false;
begin
  select id into v_admin from public.users
    where auth_id='992a7036-77fa-4c52-a764-e164bdc75e6e'::uuid and activo;
  select auth_id into v_marketing_auth from public.users
    where activo and auth_id is not null
      and not ('Administrador'=any(coalesce(roles,array[rol])))
    order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_admin is not null and v_marketing_auth is not null and v_product is not null,
    'Falta actor administrador, actor no administrador o producto para la prueba.';
  update public.users set roles=(select array_agg(distinct item) from unnest(coalesce(roles,array[rol])||array['Marketing/CRM']) item)
    where auth_id=v_marketing_auth;

  insert into public.brand_media_assets(name,media_type,source,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,status,storage_path,content_hash,mime_type,size_bytes,tags,notes,created_by)
  values('Momo diseño base','Diseño','MOMOS','Momo','Base','Diseño base','Cuadrado',false,'Propio',true,'Activo',
    'test/animation-momo-'||pg_backend_pid()||'.png',md5(random()::text)||md5(random()::text),'image/png',2048,
    '["momos:animacion","animacion:tipo:personaje"]','Fuente visual inicial',v_admin)
  returning id into v_free;

  insert into public.brand_media_assets(name,media_type,source,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,status,storage_path,content_hash,mime_type,size_bytes,tags,notes,created_by)
  values('Toby expresiones','Diseño','MOMOS','Toby','Chef','Expresiones','Horizontal',false,'Propio',true,'Activo',
    'test/animation-toby-'||pg_backend_pid()||'.png',md5(random()::text)||md5(random()::text),'image/png',2048,
    '["momos:animacion","animacion:tipo:personaje"]','Hoja de expresiones',v_admin)
  returning id into v_marketing;

  begin
    insert into public.brand_media_assets(name,media_type,source,figure,shot_type,orientation,rights_status,ai_use_allowed,
      status,storage_path,content_hash,mime_type,size_bytes,tags,created_by)
    values('Taxonomía ambigua','Diseño','MOMOS','Momo','Diseño base','Cuadrado','Propio',true,'Activo',
      'test/animation-bad-kind-'||pg_backend_pid()||'.png',md5(random()::text)||md5(random()::text),'image/png',100,
      '["momos:animacion","animacion:tipo:personaje","animacion:tipo:objeto"]',v_admin);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó dos tipos de elemento para el mismo archivo.';

  v_failed:=false;
  begin
    insert into public.brand_media_assets(name,media_type,source,figure,shot_type,orientation,rights_status,ai_use_allowed,
      status,storage_path,content_hash,mime_type,size_bytes,tags,created_by)
    values('Rol inventado','Diseño','MOMOS','Momo','Toma mágica','Cuadrado','Propio',true,'Activo',
      'test/animation-bad-role-'||pg_backend_pid()||'.png',md5(random()::text)||md5(random()::text),'image/png',100,
      '["momos:animacion","animacion:tipo:personaje"]',v_admin);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó un material fuera de la taxonomía animada.';

  v_failed:=false;
  begin
    insert into public.brand_media_assets(name,media_type,source,product_id,figure,shot_type,orientation,rights_status,ai_use_allowed,
      status,storage_path,content_hash,mime_type,size_bytes,tags,created_by)
    values('Personaje mezclado con producto','Diseño','MOMOS',v_product,'Momo','Diseño base','Cuadrado','Propio',true,'Activo',
      'test/animation-product-'||pg_backend_pid()||'.png',md5(random()::text)||md5(random()::text),'image/png',100,
      '["momos:animacion","animacion:tipo:personaje"]',v_admin);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Permitió mezclar el Mundo animado con el catálogo vendible.';

  perform set_config('momos.animation_free',v_free::text,true);
  perform set_config('momos.animation_marketing',v_marketing::text,true);
  perform set_config('momos.animation_marketing_auth',coalesce(v_marketing_auth::text,''),true);
end $$;

select set_config('request.jwt.claims',
  '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare
  v_asset bigint:=current_setting('momos.animation_free')::bigint;
  v_result jsonb; v_manifest jsonb; v_failed boolean:=false;
begin
  v_manifest:=public.momos_sync_manifest_v1();
  assert v_manifest#>>'{capabilities,mundo_animado_disponible}'='true',
    'El manifiesto H56 no incorporó Mundo animado y agregaría una lectura separada.';
  v_result:=public.actualizar_metadatos_activo_marca(v_asset,jsonb_build_object(
    'name','Momo diseño oficial','collection','Animación','product_id',null,
    'figure','Momo','flavor','Base','shot_type','Turnaround','orientation','Horizontal',
    'contains_people',false,'rights_status','Propio','rights_expires_at',null,'ai_use_allowed',true,
    'tags',jsonb_build_array('animacion:tipo:personaje','animacion:canon','modelo 3D'),
    'notes','Proporciones y silueta oficiales'
  ));
  assert (v_result->>'version')::int>=2, 'No versionó la declaración canónica.';
  assert exists(select 1 from public.brand_media_assets where id=v_asset
    and product_id is null and figure='Momo' and shot_type='Turnaround'
    and tags ? 'momos:animacion' and tags ? 'animacion:tipo:personaje' and tags ? 'animacion:canon'
    and not (tags ? 'momos:marca') and not (tags ? 'momos:producto')),
    'No separó o normalizó el Mundo animado.';

  begin
    perform public.actualizar_metadatos_activo_marca(v_asset,jsonb_build_object(
      'collection','Animación','figure','Momo','flavor','Villano','shot_type','Expresiones',
      'tags',jsonb_build_array('animacion:tipo:personaje','animacion:canon')
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Permitió reescribir una referencia canónica.';

  v_result:=public.actualizar_metadatos_activo_marca(v_asset,jsonb_build_object(
    'name','Momo · diseño oficial','tags',jsonb_build_array('animacion:tipo:personaje','animacion:canon','aprobado'),
    'notes','Nombre y nota descriptiva corregidos; canon intacto'
  ));
  assert (v_result->>'semantic_locked')::boolean, 'No informó el bloqueo semántico del canon.';
  assert exists(select 1 from public.brand_media_assets where id=v_asset and flavor='Base' and shot_type='Turnaround'
    and tags ? 'animacion:canon'), 'La corrección descriptiva alteró el canon.';
end $$;

do $$
declare
  v_auth text:=current_setting('momos.animation_marketing_auth',true);
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_auth,'role','authenticated')::text,true);
end $$;

do $$
declare
  v_auth text:=current_setting('momos.animation_marketing_auth',true);
  v_asset bigint:=current_setting('momos.animation_marketing')::bigint;
  v_failed boolean:=false;
begin
  begin
    perform public.actualizar_metadatos_activo_marca(v_asset,jsonb_build_object(
      'collection','Animación','figure','Toby','flavor','Chef','shot_type','Expresiones',
      'tags',jsonb_build_array('animacion:tipo:personaje','animacion:canon')
    ));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Marketing pudo declarar canon sin aprobación administrativa.';
end $$;

reset role;
do $$
declare v_failed boolean:=false;
begin
  begin
    update public.brand_media_assets
      set tags=tags-'animacion:canon'
      where id=current_setting('momos.animation_free')::bigint;
  exception when others then v_failed:=true; end;
  assert v_failed, 'Un acceso privilegiado pudo degradar silenciosamente una referencia canónica.';
  assert exists(select 1 from public.audit_logs where entidad='Biblioteca marca'
    and entidad_id=current_setting('momos.animation_free') and accion='Metadatos actualizados'),
    'Falta auditoría del Mundo animado.';
  assert exists(select 1 from public.brand_media_asset_metadata_versions
    where asset_id=current_setting('momos.animation_free')::bigint and snapshot->>'collection'='Animación'),
    'El historial no identifica la colección animada.';
end $$;

select 'TESTS_OK — Mundo animado/personajes/canon/taxonomía/versiones/no duplicación/RBAC PASS, rollback total' as resultado;
rollback;
