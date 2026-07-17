-- MOMOS OPS · prueba adversarial de Distribución Comercial. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260715_19_distribucion_comercial'), 'Falta aplicar la migración 19.';
  assert to_regclass('public.content_distributions') is not null, 'Falta la tabla de distribución.';
  assert not has_table_privilege('authenticated','public.content_distributions','INSERT'), 'Permite INSERT directo de distribución.';
  assert has_function_privilege('authenticated','public.guardar_preparacion_distribucion(text,jsonb,text)','EXECUTE'), 'Falta RPC de preparación.';
  assert has_function_privilege('authenticated','public.aprobar_distribucion(text)','EXECUTE'), 'Falta RPC de aprobación.';
  assert has_function_privilege('authenticated','public.cerrar_distribucion_publicacion(text,text,text,text,text)','EXECUTE'), 'Falta RPC de cierre.';
  assert not has_function_privilege('authenticated','public._distribution_actor()','EXECUTE'), 'Helper privado expuesto.';
  assert exists(select 1 from pg_trigger where tgname='content_posts_distribution_guard' and not tgisinternal), 'Falta guard contra publicación directa.';
end $$;

do $$
declare v_suffix text:=pg_backend_pid()::text; v_creative text:='CRE-DIST-'||v_suffix; v_post text:='CAL-DIST-'||v_suffix;
begin
  insert into public.creatives(id,titulo,canal,formato,copy,estado,asset_url)
  values(v_creative,'Creativo distribución adversarial','Instagram','Reel','Copy MOMOS aprobado','Aprobado','https://cdn.momos.test/reel.mp4');
  insert into public.content_posts(id,fecha,hora,canal,creative_id,titulo,copy_final,estado)
  values(v_post,current_date,'00:01','Instagram',v_creative,'Publicación distribución adversarial','Copy MOMOS aprobado','Programado');
  perform set_config('momos.test_distribution_post',v_post,true);
end $$;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_post text:=current_setting('momos.test_distribution_post'); v_failed boolean:=false; v_result jsonb;
  v_partial jsonb:='{"archivo_final":true,"formato_canal":true,"copy_revisado":true,"cta_enlace":false,"audio_derechos":true}'::jsonb;
  v_full jsonb:='{"archivo_final":true,"formato_canal":true,"copy_revisado":true,"cta_enlace":true,"identidad_marca":true,"producto_fiel":true,"claims_verificados":true,"logo_color_tipografia":true,"objetivo_del_modo":true,"cta_del_modo":true,"medicion_del_modo":true,"separacion_pauta_organico":true,"audio_derechos":true}'::jsonb;
begin
  assert public.distribucion_comercial_disponible(), 'La sonda de distribución no responde.';
  v_result:=public.guardar_preparacion_distribucion(v_post,v_partial,'Checklist parcial');
  assert v_result->>'status'='Preparación', 'Un checklist parcial quedó listo.';
  v_failed:=false; begin perform public.aprobar_distribucion(v_post); exception when others then v_failed:=true; end;
  assert v_failed, 'Aprobó checklist parcial.';
  v_failed:=false; begin perform public.cerrar_distribucion_publicacion(v_post,'Publicada','https://instagram.com/p/test','',''); exception when others then v_failed:=true; end;
  assert v_failed, 'Publicó sin aprobación.';
  v_failed:=false; begin perform public.set_publicacion_estado(v_post,'Publicado'); exception when others then v_failed:=true; end;
  assert v_failed, 'El RPC anterior saltó la distribución protegida.';

  v_result:=public.guardar_preparacion_distribucion(v_post,v_full,'Checklist completo');
  assert v_result->>'status'='Lista', 'Checklist completo no quedó Listo.';
  perform public.aprobar_distribucion(v_post);
  assert exists(select 1 from public.content_distributions where post_id=v_post and status='Aprobada' and approved_by is not null), 'No selló aprobación.';
  perform public.cerrar_distribucion_publicacion(v_post,'Publicada','https://instagram.com/p/test','IG-TEST','Publicación confirmada');
  assert exists(select 1 from public.content_distributions where post_id=v_post and status='Publicada' and published_at is not null and executed_by is not null), 'No selló publicación.';
  assert exists(select 1 from public.content_posts where id=v_post and estado='Publicado' and external_post_id='IG-TEST'), 'No actualizó la publicación canónica.';
  assert exists(select 1 from public.audit_logs where entidad='Distribución' and entidad_id=v_post), 'Falta auditoría de distribución.';

  v_failed:=false; begin perform public.cerrar_distribucion_publicacion(v_post,'Fallida','','','La plataforma falló'); exception when others then v_failed:=true; end;
  assert v_failed, 'Alteró una distribución ya publicada.';
end $$;

select 'TESTS_OK — distribución checklist/aprobación/evidencia/RBAC PASS, rollback total' as resultado;
rollback;
