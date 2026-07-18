-- MOMOS OPS · prueba adversarial H61 Biblioteca de producción. Siempre ROLLBACK.
begin;

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260718_61_biblioteca_produccion'), 'Falta aplicar H61.';
  assert public.biblioteca_produccion_disponible(), 'La sonda de producción no responde.';
  assert not has_table_privilege('authenticated','public.brand_asset_production_profiles','INSERT'), 'Authenticated puede fabricar fichas.';
  assert not has_table_privilege('authenticated','public.brand_production_packs','UPDATE'), 'Authenticated puede aprobar paquetes directamente.';
  assert has_function_privilege('authenticated','public.clasificar_activo_produccion(bigint,jsonb)','EXECUTE'), 'Falta RPC de clasificación.';
  assert has_function_privilege('authenticated','public.preparar_trabajo_desde_paquete_produccion(bigint,jsonb)','EXECUTE'), 'Falta el puente paquete → Estudio.';
  assert not has_function_privilege('anon','public.crear_paquete_produccion(jsonb)','EXECUTE'), 'Anon puede crear paquetes.';
  assert not has_function_privilege('authenticated','public._estado_activo_produccion(bigint)','EXECUTE'), 'Se expuso un helper privado.';
end $$;

do $$
declare v_admin text; v_product text; v_asset bigint;
begin
  select id into v_admin from public.users where auth_id='992a7036-77fa-4c52-a764-e164bdc75e6e'::uuid and activo;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_admin is not null and v_product is not null, 'Falta admin o producto para probar.';
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,
    contains_people,rights_status,ai_use_allowed,status,storage_path,content_hash,mime_type,size_bytes,tags,notes,created_by)
  values('Momo prueba producción','Foto','MOMOS',v_product,'Momo','Dulce antojo','Producto','Vertical',false,
    'Propio',true,'Activo','test/production-'||pg_backend_pid()||'.png',md5(random()::text)||md5(random()::text),
    'image/png',2048,'["momos:producto"]','Prueba rollback',v_admin)
  returning id into v_asset;
  perform set_config('momos.production_asset',v_asset::text,true);
end $$;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_asset bigint:=current_setting('momos.production_asset')::bigint; v_result jsonb; v_pack jsonb; v_pack_id bigint; v_failed boolean:=false;
begin
  v_result:=public.clasificar_activo_produccion(v_asset,jsonb_build_object(
    'component_type','Producto','view_angle','Trasera','physical_state','Intacto','interaction_type','Ninguna',
    'hand_assignment','Ninguna','source_quality','Original con escarcha','qa_status','Aprobado','consent_status','No aplica'
  ));
  assert (v_result#>>'{readiness,ready}')::boolean, 'El producto aprobado no quedó listo.';
  assert exists(select 1 from public.brand_asset_production_profiles where asset_id=v_asset and view_angle='Trasera' and qa_status='Aprobado'), 'No persistió la vista trasera.';

  v_failed:=false;
  begin
    perform public.clasificar_activo_produccion(v_asset,jsonb_build_object('component_type','Manos','qa_status','Aprobado','consent_status','Autorizado'));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Permitió convertir un original sin personas en manos UGC.';

  v_pack:=public.crear_paquete_produccion(jsonb_build_object(
    'name','Prueba Dulce Antojo','purpose','Video UGC para sacar y probar el Momo',
    'channel','Instagram','target_format','Reel 9:16','requirements',jsonb_build_object('required_roles',jsonb_build_array('Producto')),
    'members',jsonb_build_array(jsonb_build_object('asset_id',v_asset,'role','Producto','sequence',1,'required',true))
  ));
  v_pack_id:=(v_pack->>'pack_id')::bigint;
  assert (v_pack#>>'{readiness,ready}')::boolean, 'El paquete con producto aprobado no quedó listo.';
  perform public.revisar_paquete_produccion(v_pack_id,'Enviar a revisión','Listo para control administrativo');
  perform public.revisar_paquete_produccion(v_pack_id,'Aprobar','Producto, vista y derechos verificados');
  assert exists(select 1 from public.brand_production_packs where id=v_pack_id and status='Aprobado'), 'No aprobó el paquete.';

  v_failed:=false;
  begin
    perform public.clasificar_activo_produccion(v_asset,jsonb_build_object('component_type','Producto','view_angle','Frontal','qa_status','Aprobado'));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Permitió reclasificar un activo sellado en paquete aprobado.';
end $$;

reset role;
do $$
begin
  assert 'pertenece a un paquete de producción aprobado'=any(
    public._motivos_bloqueo_eliminacion_activo(current_setting('momos.production_asset')::bigint)
  ), 'El paquete aprobado no protege su referencia.';
  assert exists(select 1 from public.audit_logs where entidad='Biblioteca producción' and entidad_id=current_setting('momos.production_asset')), 'Falta auditoría de clasificación.';
  assert exists(select 1 from public.audit_logs where entidad='Paquetes producción' and accion='Paquete aprobado'), 'Falta auditoría de aprobación.';
end $$;

select 'TESTS_OK — producción/UGC/manos/multivista/locaciones/QA/paquetes/RBAC PASS, rollback total' as resultado;
rollback;
