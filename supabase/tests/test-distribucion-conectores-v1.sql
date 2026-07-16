-- MOMOS OPS · prueba adversarial de distribución por conectores. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_29_distribucion_conectores'), 'Falta aplicar la migración 29.';
  assert public.distribucion_conectores_disponible(), 'La sonda de conectores no responde.';
  assert to_regclass('public.distribution_connector_jobs') is not null, 'Falta la outbox de distribución.';
  assert not has_table_privilege('authenticated','public.distribution_connector_jobs','INSERT'), 'El navegador puede insertar despachos.';
  assert not has_table_privilege('authenticated','public.distribution_connector_jobs','UPDATE'), 'El navegador puede alterar despachos.';
  assert has_function_privilege('authenticated','public.autorizar_despacho_distribucion(text,text)','EXECUTE'), 'Falta autorización humana.';
  assert has_function_privilege('authenticated','public.reintentar_despacho_distribucion(bigint)','EXECUTE'), 'Falta reintento humano explícito.';
  assert not has_function_privilege('authenticated','public.reclamar_despacho_distribucion(text,integer)','EXECUTE'), 'Lease privado expuesto al navegador.';
  assert not has_function_privilege('authenticated','public.marcar_despacho_distribucion(bigint,uuid,jsonb)','EXECUTE'), 'Marca previa al HTTP expuesta.';
  assert has_function_privilege('service_role','public.reclamar_despacho_distribucion(text,integer)','EXECUTE'), 'El worker no puede reclamar.';
  assert has_function_privilege('service_role','public.conciliar_despacho_distribucion(bigint,text,text,text,text,numeric,jsonb)','EXECUTE'), 'El worker no puede conciliar.';
  assert exists(select 1 from pg_trigger where tgname='content_distributions_connector_guard' and not tgisinternal), 'Falta bloqueo de cierre durante despacho.';
  assert exists(select 1 from pg_trigger where tgname='content_distributions_connector_completion' and not tgisinternal), 'Falta cierre trazable del borrador.';
  assert pg_get_functiondef('public._distribution_connector_guard()'::regprocedure) !~* 'current_setting|set_config', 'El guard depende de una bandera reutilizable de sesión.';
end $$;

do $$
declare v_suffix text:=pg_backend_pid()::text; v_creative text:='CRE-CONN-'||v_suffix; v_post text:='CAL-CONN-'||v_suffix;
  v_creative_uncertain text:='CRE-CONN-U-'||v_suffix; v_post_uncertain text:='CAL-CONN-U-'||v_suffix;
begin
  insert into public.creatives(id,titulo,canal,formato,copy,estado,asset_url)
  values(v_creative,'Creativo conector adversarial','Instagram','Reel','Copy aprobado','Aprobado','https://cdn.momos.test/conector.mp4'),
    (v_creative_uncertain,'Creativo incierto adversarial','Instagram','Reel','Copy aprobado','Aprobado','https://cdn.momos.test/incierto.mp4');
  insert into public.content_posts(id,fecha,hora,canal,creative_id,titulo,copy_final,estado)
  values(v_post,current_date,'00:01','Instagram',v_creative,'Publicación por conector','Copy aprobado','Programado'),
    (v_post_uncertain,current_date,'00:02','Instagram',v_creative_uncertain,'Publicación incierta','Copy aprobado','Programado');
  perform set_config('momos.test_connector_post',v_post,true);
  perform set_config('momos.test_connector_uncertain_post',v_post_uncertain,true);
end $$;

set local role service_role;
select public.reportar_integracion_agencia_conector('Meta','Activa',true,'',
  '["Instagram","Facebook","Métricas","Publicación directa"]'::jsonb,'Meta MOMOS Test','META-TEST',true);
reset role;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_post text:=current_setting('momos.test_connector_post'); v_uncertain text:=current_setting('momos.test_connector_uncertain_post');
  v_full jsonb:='{"archivo_final":true,"formato_canal":true,"copy_revisado":true,"cta_enlace":true,"audio_derechos":true}'::jsonb;
  v_first jsonb; v_duplicate jsonb; v_uncertain_job jsonb;
begin
  perform public.guardar_preparacion_distribucion(v_post,v_full,'Salida por conector');
  perform public.aprobar_distribucion(v_post);
  v_first:=public.autorizar_despacho_distribucion(v_post,null);
  assert v_first->>'status'='Autorizado' and (v_first->>'duplicate')::boolean is false, 'No creó el despacho autorizado.';
  assert v_first->>'idempotency_key' like 'momos:distribution:%:1', 'Clave idempotente inestable.';
  v_duplicate:=public.autorizar_despacho_distribucion(v_post,null);
  assert (v_duplicate->>'duplicate')::boolean and v_duplicate->>'job_id'=v_first->>'job_id', 'La doble autorización creó otro despacho.';
  perform set_config('momos.test_connector_job',v_first->>'job_id',true);

  perform public.guardar_preparacion_distribucion(v_uncertain,v_full,'Salida incierta');
  perform public.aprobar_distribucion(v_uncertain);
  v_uncertain_job:=public.autorizar_despacho_distribucion(v_uncertain,null);
  perform set_config('momos.test_connector_uncertain_job',v_uncertain_job->>'job_id',true);
end $$;
reset role;

set local role service_role;
do $$
declare v_claim jsonb; v_job bigint:=current_setting('momos.test_connector_job')::bigint; v_token uuid; v_failed boolean:=false;
begin
  v_claim:=public.reclamar_despacho_distribucion('momos-meta-test',5);
  assert (v_claim->>'job_id')::bigint=v_job, 'El worker no tomó FIFO el despacho esperado.';
  assert v_claim->>'idempotency_key' like 'momos:distribution:%', 'El worker no recibió la clave idempotente.';
  assert (v_claim->'snapshot')::text !~* 'api[_-]?key|access[_-]?token|service[_-]?role', 'La outbox filtró un secreto.';
  v_token:=(v_claim->>'lease_token')::uuid;
  begin perform public.marcar_despacho_distribucion(v_job,v_token,'{"access_token":"NO"}'::jsonb); exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó secretos en metadata.';
  perform public.marcar_despacho_distribucion(v_job,v_token,'{"endpoint":"graph"}'::jsonb);
  perform public.confirmar_recepcion_despacho_distribucion(v_job,v_token,'META-POST-TEST','En proveedor','','{"http_status":200}'::jsonb);
  perform public.conciliar_despacho_distribucion(v_job,'Publicado','META-POST-TEST','https://instagram.com/p/momos-test','',0,'{"source":"poll"}'::jsonb);
  assert exists(select 1 from public.distribution_connector_jobs where id=v_job and status='Publicado' and completed_at is not null), 'No cerró el job publicado.';
  assert exists(select 1 from public.content_distributions d join public.distribution_connector_jobs j on j.distribution_id=d.id where j.id=v_job and d.status='Publicada'), 'No cerró la distribución canónica.';
  assert exists(select 1 from public.content_posts where id=current_setting('momos.test_connector_post') and estado='Publicado' and external_post_id='META-POST-TEST'), 'No selló la evidencia en calendario.';
  assert (public.conciliar_despacho_distribucion(v_job,'Publicado','META-POST-TEST','https://instagram.com/p/momos-test','',0,'{}'::jsonb)->>'duplicate')::boolean, 'La conciliación repetida no fue idempotente.';
end $$;
reset role;

-- El resultado incierto queda detenido: no se reenvía, no se reintenta y no
-- permite un cierre manual que podría ocultar una publicación duplicada.
set local role service_role;
do $$
declare v_claim jsonb; v_job bigint:=current_setting('momos.test_connector_uncertain_job')::bigint; v_token uuid;
begin
  v_claim:=public.reclamar_despacho_distribucion('momos-meta-test',5);
  assert (v_claim->>'job_id')::bigint=v_job, 'No tomó el segundo despacho.';
  v_token:=(v_claim->>'lease_token')::uuid;
  perform public.marcar_despacho_distribucion(v_job,v_token,'{}'::jsonb);
  perform public.conciliar_despacho_distribucion(v_job,'Incierto','','','Timeout después de enviar',0,'{}'::jsonb);
end $$;
reset role;

set local role authenticated;
do $$
declare v_job bigint:=current_setting('momos.test_connector_uncertain_job')::bigint; v_post text:=current_setting('momos.test_connector_uncertain_post'); v_result jsonb; v_failed boolean:=false;
begin
  v_result:=public.autorizar_despacho_distribucion(v_post,null);
  assert (v_result->>'duplicate')::boolean and v_result->>'status'='Incierto', 'Un incierto abrió un posible envío duplicado.';
  begin perform public.reintentar_despacho_distribucion(v_job); exception when others then v_failed:=true; end;
  assert v_failed, 'Permitió reintentar un resultado incierto.';
  v_failed:=false; begin perform public.cerrar_distribucion_publicacion(v_post,'Fallida','','','Cierre manual indebido'); exception when others then v_failed:=true; end;
  assert v_failed, 'El cierre manual ocultó un despacho incierto.';
end $$;
reset role;

do $$ begin
  assert exists(select 1 from public.audit_logs where entidad='Distribución conector'), 'Falta auditoría del conector.';
  assert not exists(select 1 from public.distribution_connector_jobs where sealed_snapshot::text ~* 'api[_-]?key|access[_-]?token|service[_-]?role'), 'Persistió un secreto.';
end $$;

select 'TESTS_OK — Distribución conectores/idempotencia/lease/incierto/RBAC PASS, rollback total' as resultado;
rollback;
