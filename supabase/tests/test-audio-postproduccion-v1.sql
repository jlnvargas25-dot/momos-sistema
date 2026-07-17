-- MOMOS OPS · prueba adversarial Audio de postproducción. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_48_audio_postproduccion'), 'Falta aplicar la migración 48.';
  assert public.postproduccion_audio_disponible(), 'La sonda de audio no responde.';
  assert to_regclass('public.agency_postproduction_export_audio') is not null, 'Falta el ledger de audio por exportación.';
  assert has_function_privilege('authenticated','public.autorizar_exportacion_postproduccion(jsonb)','EXECUTE'), 'Falta autorización humana con audio.';
  assert has_function_privilege('service_role','public.reclamar_exportacion_postproduccion(text,integer)','EXECUTE'), 'El worker no recibe audio sellado.';
  assert not has_function_privilege('authenticated','public.reclamar_exportacion_postproduccion(text,integer)','EXECUTE'), 'El navegador puede reclamar exportaciones.';
  assert not has_function_privilege('authenticated','public._agency_postproduction_audio_snapshot(jsonb,text)','EXECUTE'), 'Helper de audio expuesto.';
  assert not has_table_privilege('authenticated','public.agency_postproduction_export_audio','INSERT'), 'El navegador fabrica vínculos de audio.';
  assert not has_table_privilege('authenticated','public.agency_postproduction_export_audio','UPDATE'), 'El navegador reescribe el audio aprobado.';
end $$;

do $$
declare v_actor text; v_asset bigint; v_path text:='test/audio-post-'||pg_backend_pid()::text||'.mp3';
  v_snapshot jsonb; v_failed boolean:=false;
begin
  select id into v_actor from public.users where activo order by case when rol='Administrador' then 0 else 1 end,id limit 1;
  assert v_actor is not null, 'Falta actor para la prueba.';
  insert into storage.objects(bucket_id,name,metadata)
  values('brand-assets',v_path,jsonb_build_object('mimetype','audio/mpeg','size',4096));
  insert into public.brand_media_assets(name,media_type,source,orientation,rights_status,rights_expires_at,ai_use_allowed,
    allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,duration_seconds,tags,notes,created_by)
  values('Pista licenciada adversarial','Audio','Proveedor','Audio','Autorizado',current_date+30,false,
    '["Instagram"]'::jsonb,'Activo',v_path,md5(random()::text)||md5(random()::text),'audio/mpeg',4096,30,
    '["música","prueba"]'::jsonb,'Sintética; siempre rollback',v_actor) returning id into v_asset;

  v_snapshot:=public._agency_postproduction_audio_snapshot(jsonb_build_object('mode','Biblioteca','audio_asset_id',v_asset),'Instagram');
  assert v_snapshot->>'mode'='Biblioteca' and (v_snapshot#>>'{asset,id}')::bigint=v_asset, 'No selló la pista exacta.';
  assert v_snapshot#>>'{mix,soundtrack_gain_db}'='-14' and coalesce((v_snapshot->>'publication_authorized')::boolean,true)=false, 'La mezcla o publicación no quedó protegida.';

  v_failed:=false;
  begin perform public._agency_postproduction_audio_snapshot(jsonb_build_object('mode','Biblioteca','audio_asset_id',v_asset),'TikTok');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó una pista fuera de su canal autorizado.';

  update public.brand_media_assets set rights_expires_at=current_date-1 where id=v_asset;
  v_failed:=false;
  begin perform public._agency_postproduction_audio_snapshot(jsonb_build_object('mode','Biblioteca','audio_asset_id',v_asset),'Instagram');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó derechos vencidos.';

  v_snapshot:=public._agency_postproduction_audio_snapshot('{"mode":"Original"}'::jsonb,'Instagram');
  assert v_snapshot->>'mode'='Original' and (v_snapshot->>'requires_source_audio')::boolean, 'El modo original inventó una pista.';
end $$;

select 'TESTS_OK — audio original/biblioteca/derechos/canal/mezcla/worker/RBAC PASS, rollback total' as resultado;
rollback;
