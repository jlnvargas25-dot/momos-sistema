-- MOMOS OPS · Prueba adversarial de Revisión Creativa v1. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260715_26_revision_creativa'), 'Falta migración 26.';
  assert public.revision_creativa_disponible(), 'Falta sonda de revisión creativa.';
  assert has_function_privilege('authenticated','public.revisar_salida_creativa(bigint,text,text)','EXECUTE'), 'Staff no puede revisar salidas.';
  assert not has_table_privilege('authenticated','public.creative_generation_jobs','UPDATE'), 'Authenticated puede falsificar revisión directa.';
  assert not has_table_privilege('authenticated','public.brand_media_assets','UPDATE'), 'Authenticated puede aprobar activos directamente.';
end $$;

do $$
declare v_actor text; v_auth uuid; v_product text; v_job bigint; v_asset bigint;
begin
  select id,auth_id into v_actor,v_auth from public.users where auth_id is not null and activo
    and ('Administrador'=any(coalesce(roles,array[rol])) or 'Marketing/CRM'=any(coalesce(roles,array[rol])))
    order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor is not null and v_auth is not null and v_product is not null, 'Falta actor de Agencia o producto para la prueba.';
  insert into public.creative_generation_jobs(provider,operation,status,input_asset_ids,target_channel,target_format,prompt,
    max_cost_cop,generation_cost,output_review_status,created_by)
  values('Kling','Generar video','Preparado','[]','Instagram','Reel 9:16','Prueba adversarial de revisión humana',
    3000,1800,'No aplica',v_actor) returning id into v_job;
  insert into public.brand_media_assets(name,media_type,source,product_id,orientation,rights_status,ai_use_allowed,status,
    storage_path,content_hash,mime_type,size_bytes,tags,generation_meta,created_by)
  values('Salida revisión adversarial','Video','Generado',v_product,'Vertical','Por verificar',false,'Activo',
    'generated/review/'||v_job||'/resultado.mp4',md5(random()::text)||md5(random()::text),'video/mp4',4096,'["kling"]',
    jsonb_build_object('provider','Kling','job_id',v_job::text,'needs_human_review',true),v_actor) returning id into v_asset;
  update public.creative_generation_jobs set status='Completado',output_asset_id=v_asset,
    output_review_status='Pendiente',completed_at=now() where id=v_job;
  perform set_config('momos.review_auth',v_auth::text,true);
  perform set_config('momos.review_job',v_job::text,true);
  perform set_config('momos.review_asset',v_asset::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.review_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$ declare v_failed boolean:=false; begin
  begin perform public.revisar_salida_creativa(current_setting('momos.review_job')::bigint,'Cambios solicitados','');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó cambios sin explicación trazable.';
end $$;

select public.revisar_salida_creativa(current_setting('momos.review_job')::bigint,'Aprobada','Cumple identidad y producto real.');

do $$ declare v_failed boolean:=false; begin
  assert exists(select 1 from public.creative_generation_jobs where id=current_setting('momos.review_job')::bigint
    and output_review_status='Aprobada' and output_reviewed_by is not null and output_reviewed_at is not null),
    'No selló la decisión humana.';
  assert exists(select 1 from public.brand_media_assets where id=current_setting('momos.review_asset')::bigint
    and rights_status='Autorizado' and ai_use_allowed=false and status='Activo'
    and generation_meta->>'needs_human_review'='false'),
    'La aprobación no habilitó uso o concedió reutilización IA implícita.';
  assert not exists(select 1 from public.content_posts where titulo='Salida revisión adversarial'),
    'La revisión publicó contenido automáticamente.';
  begin perform public.revisar_salida_creativa(current_setting('momos.review_job')::bigint,'Descartada','Segundo veredicto malicioso');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Una salida recibió dos decisiones humanas contradictorias.';
  assert exists(select 1 from public.audit_logs where entidad='Revisión creativa'
    and entidad_id=current_setting('momos.review_job')), 'Falta auditoría de revisión.';
end $$;

reset role;

do $$
declare v_nonagency_auth uuid; v_failed boolean:=false;
begin
  select auth_id into v_nonagency_auth from public.users where auth_id is not null and activo
    and not ('Administrador'=any(coalesce(roles,array[rol])))
    and not ('Marketing/CRM'=any(coalesce(roles,array[rol]))) order by id limit 1;
  if v_nonagency_auth is not null then
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_nonagency_auth,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    begin perform public.revisar_salida_creativa(current_setting('momos.review_job')::bigint,'Aprobada','Intento no autorizado');
    exception when others then v_failed:=true; end;
    execute 'reset role';
    assert v_failed, 'Un rol ajeno a Agencia pudo revisar una salida.';
  end if;
end $$;

select 'TESTS_OK — revisión creativa humana/derechos/no publicación/RBAC PASS, rollback total' as resultado;
rollback;
