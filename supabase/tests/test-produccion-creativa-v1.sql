-- MOMOS OPS · prueba adversarial Producción Creativa v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260715_22_produccion_creativa'), 'Falta aplicar la migración 22.';
  assert public.produccion_creativa_disponible(), 'La sonda de Producción Creativa no responde.';
  assert has_function_privilege('authenticated','public.autorizar_trabajo_creativo(bigint,numeric)','EXECUTE'), 'Falta autorización humana.';
  assert not has_function_privilege('authenticated','public.tomar_trabajo_creativo_conector(bigint,text)','EXECUTE'), 'El conector privado quedó expuesto.';
  assert not has_table_privilege('authenticated','public.creative_generation_jobs','UPDATE'), 'Authenticated puede saltarse la cola por UPDATE.';
end $$;

do $$
declare v_actor text; v_product text; v_creative text:='CRE-PROD-'||pg_backend_pid(); v_asset bigint; v_job bigint;
begin
  select id into v_actor from public.users where auth_id='992a7036-77fa-4c52-a764-e164bdc75e6e'::uuid and activo;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor is not null and v_product is not null, 'Falta actor o producto para la prueba.';
  insert into public.creatives(id,titulo,canal,formato,producto_foco_id,estado,notas)
  values(v_creative,'Producción creativa adversarial','Instagram','Reel',v_product,'Idea','Sintético; rollback total');
  insert into public.brand_media_assets(name,media_type,source,product_id,orientation,rights_status,ai_use_allowed,status,storage_path,
    content_hash,mime_type,size_bytes,created_by)
  values('Fuente creativa adversarial','Video','MOMOS',v_product,'Vertical','Propio',true,'Activo','test/prod-'||pg_backend_pid()||'.mp4',
    md5(random()::text)||md5(random()::text),'video/mp4',2048,v_actor) returning id into v_asset;
  insert into public.creative_generation_jobs(creative_id,provider,operation,status,input_asset_ids,target_channel,target_format,prompt,created_by)
  values(v_creative,'Higgsfield','Generar video','Preparado',jsonb_build_array(v_asset),'Instagram','Reel 9:16','Trabajo adversarial protegido',v_actor)
  returning id into v_job;
  perform set_config('momos.prod_job',v_job::text,true);
  perform set_config('momos.prod_asset',v_asset::text,true);
end $$;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_job bigint:=current_setting('momos.prod_job')::bigint; v_failed boolean:=false;
begin
  begin perform public.autorizar_trabajo_creativo(v_job,0); exception when others then v_failed:=true; end;
  assert v_failed, 'Autorizó un motor externo sin tope.';
  perform public.autorizar_trabajo_creativo(v_job,30000);
  assert exists(select 1 from public.creative_generation_jobs where id=v_job and status='Autorizado' and max_cost_cop=30000 and authorized_by is not null), 'No selló autorización y tope.';
  v_failed:=false;
  begin perform public.autorizar_trabajo_creativo(v_job,30000); exception when others then v_failed:=true; end;
  assert v_failed, 'Permitió autorizar dos veces.';
end $$;

reset role;
do $$ begin
  -- Desde el paso 23 el conector falla cerrado si no reportó salud reciente.
  if to_regclass('public.agency_integrations') is not null then
    update public.agency_integrations set status='Activa',secret_configured=true,last_heartbeat_at=now()
    where provider='Higgsfield';
  end if;
end $$;
set local role service_role;
select public.tomar_trabajo_creativo_conector(current_setting('momos.prod_job')::bigint,'provider-job-adversarial');
select public.resolver_trabajo_creativo_conector(current_setting('momos.prod_job')::bigint,'Fallido',null,0,'timeout controlado');

reset role;
set local role authenticated;
do $$
declare v_job bigint:=current_setting('momos.prod_job')::bigint; v_failed boolean:=false;
begin
  assert exists(select 1 from public.creative_generation_jobs where id=v_job and status='Fallido' and attempt_count=1), 'No registró el fallo trazable.';
  perform public.reintentar_trabajo_creativo(v_job);
  assert exists(select 1 from public.creative_generation_jobs where id=v_job and status='Preparado' and max_cost_cop=0 and provider_job_id is null), 'El reintento no volvió a revisión segura.';
  perform public.cancelar_trabajo_creativo(v_job,'No continuar con esta variante');
  assert exists(select 1 from public.creative_generation_jobs where id=v_job and status='Cancelado' and cancellation_reason<>''), 'No conservó la cancelación.';
  v_failed:=false;
  begin perform public.reintentar_trabajo_creativo(v_job); exception when others then v_failed:=true; end;
  assert v_failed, 'Reabrió un trabajo cancelado.';
end $$;

select 'TESTS_OK — Producción Creativa autorización/costos/conector/RBAC PASS, rollback total' as resultado;
rollback;
