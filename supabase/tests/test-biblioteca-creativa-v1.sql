-- MOMOS OPS · prueba adversarial Biblioteca Inteligente + Estudio. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260715_20_biblioteca_creativa'), 'Falta aplicar la migración 20.';
  assert to_regclass('public.brand_media_assets') is not null, 'Falta biblioteca de activos.';
  assert to_regclass('public.creative_generation_jobs') is not null, 'Faltan trabajos creativos.';
  assert to_regclass('public.brand_media_usages') is not null, 'Falta trazabilidad de usos.';
  assert exists(select 1 from storage.buckets where id='brand-assets' and public=false), 'El bucket de marca no es privado.';
  assert not has_table_privilege('authenticated','public.brand_media_assets','INSERT'), 'Permite fabricar activos directamente.';
  assert not has_table_privilege('authenticated','public.creative_generation_jobs','UPDATE'), 'Permite manipular trabajos directamente.';
  assert has_function_privilege('authenticated','public.crear_trabajo_creativo(jsonb)','EXECUTE'), 'Falta RPC del estudio.';
  assert not has_function_privilege('authenticated','public._brand_actor()','EXECUTE'), 'Helper privado expuesto.';
end $$;

do $$
declare v_actor text; v_creative text; v_product text; v_asset bigint; v_blocked bigint;
begin
  select id into v_actor from public.users where auth_id='992a7036-77fa-4c52-a764-e164bdc75e6e'::uuid and activo;
  select id,producto_foco_id into v_creative,v_product from public.creatives where producto_foco_id is not null order by id limit 1;
  assert v_actor is not null and v_creative is not null and v_product is not null, 'Falta actor o creativo con producto foco para la prueba.';
  insert into public.brand_media_assets(name,media_type,source,product_id,orientation,rights_status,ai_use_allowed,status,storage_path,
    content_hash,mime_type,size_bytes,created_by)
  values('Original adversarial','Video','MOMOS',v_product,'Vertical','Propio',true,'Activo','test/original-'||pg_backend_pid()||'.mp4',
    md5(random()::text)||md5(random()::text),'video/mp4',1024,v_actor) returning id into v_asset;
  insert into public.brand_media_assets(name,media_type,source,product_id,orientation,rights_status,ai_use_allowed,status,storage_path,
    content_hash,mime_type,size_bytes,created_by)
  values('Material restringido','Video','Cliente',v_product,'Vertical','Restringido',false,'Activo','test/restringido-'||pg_backend_pid()||'.mp4',
    md5(random()::text)||md5(random()::text),'video/mp4',1024,v_actor) returning id into v_blocked;
  perform set_config('momos.test_creative',v_creative,true);
  perform set_config('momos.test_asset',v_asset::text,true);
  perform set_config('momos.test_blocked',v_blocked::text,true);
end $$;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_job bigint; v_failed boolean:=false; v_asset bigint:=current_setting('momos.test_asset')::bigint;
  v_blocked bigint:=current_setting('momos.test_blocked')::bigint; v_creative text:=current_setting('momos.test_creative');
begin
  assert public.biblioteca_creativa_disponible(), 'La sonda de biblioteca no responde.';
  v_job:=(public.crear_trabajo_creativo(jsonb_build_object('creative_id',v_creative,'operation','Editar','provider','Por conectar',
    'input_asset_ids',jsonb_build_array(v_asset),'target_channel','Instagram','target_format','Reel 9:16','prompt','Edición adversarial segura',
    'output_spec',jsonb_build_object('width',1080,'height',1920)))->>'job_id')::bigint;
  assert exists(select 1 from public.creative_generation_jobs where id=v_job and status='Preparado' and output_spec->>'output_mode'='new_asset'), 'No preparó trabajo seguro.';
  assert exists(select 1 from public.brand_media_usages where job_id=v_job and asset_id=v_asset and role='Principal'), 'No trazó el original usado.';
  v_failed:=false;
  begin perform public.crear_trabajo_creativo(jsonb_build_object('creative_id',v_creative,'operation','Editar','input_asset_ids',jsonb_build_array(v_blocked),
    'target_format','Reel 9:16','prompt','Debe fallar')); exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó material restringido.';
  v_failed:=false;
  begin perform public.crear_trabajo_creativo(jsonb_build_object('creative_id',v_creative,'operation','Editar','input_asset_ids',jsonb_build_array(v_asset,v_asset),
    'target_format','Reel 9:16','prompt','Este trabajo repite el mismo activo')); exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó el mismo activo dos veces.';
  v_failed:=false;
  begin perform public.crear_trabajo_creativo(jsonb_build_object('creative_id',v_creative,'operation','Editar','input_asset_ids',jsonb_build_array(v_asset),
    'target_format','Formato inventado','prompt','Este trabajo tiene un formato imposible')); exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó un formato de salida inventado.';
  v_failed:=false;
  begin perform public.crear_trabajo_creativo(jsonb_build_object('creative_id',v_creative,'operation','Generar imagen','input_asset_ids','[]'::jsonb,
    'target_format','Post 4:5','prompt','No debe inventar el producto real')); exception when others then v_failed:=true; end;
  assert v_failed, 'Permitió generar un producto foco sin una toma real.';
  v_failed:=false;
  begin perform public.registrar_activo_marca(jsonb_build_object('name','Archivo inexistente','media_type','Video','storage_path',auth.uid()::text||'/no-existe.mp4',
    'content_hash',md5(random()::text)||md5(random()::text),'mime_type','video/mp4','size_bytes',10)); exception when others then v_failed:=true; end;
  assert v_failed, 'Registró una fila sin archivo real en Storage.';
  assert exists(select 1 from public.audit_logs where entidad='Estudio creativo' and entidad_id=v_job::text), 'Falta auditoría del trabajo.';
end $$;

select 'TESTS_OK — Biblioteca/Estudio derechos, originales, trazabilidad y RBAC PASS, rollback total' as resultado;
rollback;
