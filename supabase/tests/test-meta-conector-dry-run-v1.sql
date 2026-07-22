-- MOMOS OPS · prueba adversarial del conector Meta read-only. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_41_meta_conector_dry_run'), 'Falta aplicar la migración 41.';
  assert public.meta_conector_dry_run_disponible(), 'Falta la sonda del conector Meta.';
  assert to_regclass('public.agency_meta_connector_dry_runs') is not null, 'Falta la evidencia dry-run.';
  assert has_function_privilege('authenticated','public.preparar_dry_run_meta(bigint,text,text)','EXECUTE'), 'Administración no puede preparar el dry-run.';
  assert not has_function_privilege('authenticated','public.reclamar_dry_run_meta(text,integer)','EXECUTE'), 'El navegador suplanta al worker Meta.';
  assert has_function_privilege('service_role','public.reclamar_dry_run_meta(text,integer)','EXECUTE'), 'El worker privado no puede reclamar.';
  assert not has_table_privilege('authenticated','public.agency_meta_connector_dry_runs','INSERT'), 'El navegador inserta evidencia falsa.';
  assert not has_table_privilege('authenticated','public.agency_meta_connector_dry_runs','UPDATE'), 'El navegador reescribe evidencia Meta.';
end $$;

do $$
declare v_actor public.users%rowtype; v_suffix text:=pg_backend_pid()::text; v_product text:='PR-T41-'||v_suffix;
  v_campaign text:='CMP-T41-'||v_suffix; v_cat text; v_policy bigint; v_snapshot bigint; v_diag bigint; v_study bigint; v_measure bigint;
  v_scenario bigint; v_auth bigint; v_auth_snapshot jsonb; v_auth_fp text;
begin
  select * into v_actor from public.users where activo and auth_id is not null and public.valid_user_roles(roles,rol)
    and 'Administrador'=any(roles) order by id limit 1;
  select nombre into v_cat from public.product_cats order by nombre limit 1;
  select id into v_policy from public.agency_meta_policies where status='Activa' order by version desc limit 1;
  assert v_actor.id is not null and v_cat is not null and v_policy is not null, 'Falta Administrador, categoría o política Meta.';
  insert into public.products(id,nombre,cat,tipo,especie,precio,costo,stock,activo)
  values(v_product,'TEST41 producto vigente',v_cat,'momo','gato',18000,7000,10,true);
  insert into public.campaigns(id,nombre,canal,objetivo,producto_foco_id,presupuesto,estado,external_platform,external_id)
  values(v_campaign,'TEST41 verificación','Instagram','Ventas',v_product,340000,'Activa','meta','41000001');
  insert into public.agency_meta_signal_snapshots(snapshot_key,account_external_id,account_label,entity_type,entity_external_id,objective,currency,
    timezone,window_start,window_end,source_captured_at,local_campaign_id,metrics,pixel_events,catalog_products,local_truth,snapshot_fingerprint,recorded_by_connector)
  values('test41-snapshot-'||v_suffix,'act_410001','MOMOS TEST41','Campaña','41000001','Ventas','COP','America/Bogota',
    now()-interval '14 days',now()-interval '7 days',now(),v_campaign,'{"spend":200000,"impressions":20000,"clicks":400,"purchases":10}',
    '[]','[]','{"paid_orders":10,"paid_revenue":900000,"paid_margin":500000}',md5('test41-snapshot-'||v_suffix),'meta-test41') returning id into v_snapshot;
  insert into public.agency_meta_diagnostics(diagnostic_key,snapshot_id,policy_id,status,what_happened,why_hypotheses,recommended_actions,
    evidence_snapshot,confidence,source_kind,diagnostic_fingerprint,prepared_by,reviewed_by,reviewed_at,review_note)
  values('test41-diagnostic-'||v_suffix,v_snapshot,v_policy,'Aprobado','{}','[]','[]','{}','Alta','Humano',md5('test41-diagnostic-'||v_suffix),
    v_actor.id,v_actor.id,now(),'TEST41 diagnóstico aprobado.') returning id into v_diag;
  insert into public.agency_meta_lift_studies(study_key,diagnostic_id,snapshot_id,campaign_id,external_study_id,design,lifecycle_scope,status,
    window_start,window_end,minimum_per_arm,hypothesis,assignment_snapshot,guardrails,study_fingerprint,source_kind,prepared_by,reviewed_by,reviewed_at,review_note)
  values('test41-study-'||v_suffix,v_diag,v_snapshot,v_campaign,'META-LIFT-T41-'||v_suffix,'Meta Conversion Lift','Todos','Cerrado',
    now()-interval '14 days',now()-interval '7 days',100,'La campaña aumenta compradores pagados.','{"randomized":true}',
    '{"publication_forbidden":true}',md5('test41-study-'||v_suffix),'Humano',v_actor.id,v_actor.id,now(),'TEST41 diseño aprobado.') returning id into v_study;
  insert into public.agency_meta_lift_measurements(measurement_key,study_id,status,captured_at,control_cell,exposed_cell,incremental_spend,
    platform_result,local_lifecycle_snapshot,result_snapshot,measurement_fingerprint,recorded_by_connector,reviewed_by,reviewed_at,review_note)
  values('test41-measure-'||v_suffix,v_study,'Aprobada',now(),'{"population":1000,"buyers":50,"orders":52,"revenue":900000,"margin":500000}',
    '{"population":1000,"buyers":90,"orders":95,"revenue":1710000,"margin":950000}',200000,'{"source":"Meta Conversion Lift"}',
    '{"new":{"margin":400000}}','{"classification":"Incremental rentable","sample_sufficient":true,"causal_claim_allowed":true,"incremental_profit":222222}',
    md5('test41-measure-'||v_suffix),'meta-lift-test41',v_actor.id,now(),'TEST41 medición aprobada.') returning id into v_measure;
  insert into public.agency_meta_investment_scenarios(scenario_key,measurement_id,study_id,campaign_id,product_id,status,horizon_days,recommended_option,
    evidence_snapshot,options_snapshot,guardrails,scenario_fingerprint,source_kind,prepared_by,reviewed_by,reviewed_at,review_note,prepared_at)
  values('test41-scenario-'||v_suffix,v_measure,v_study,v_campaign,v_product,'Aprobado',7,'Reducir','{"operations":{"stock_blocked":false}}',
    '[{"key":"Conservar","proposed_budget":340000,"blockers":[]},{"key":"Reducir","proposed_budget":300000,"blockers":[]},{"key":"Redistribuir","proposed_budget":340000,"blockers":[]},{"key":"Experimento","proposed_budget":60000,"blockers":[]}]',
    '{"execution_forbidden":true}',md5('test41-scenario-'||v_suffix),'Humano',v_actor.id,v_actor.id,now(),'TEST41 escenario aprobado.',now()) returning id into v_scenario;
  v_auth_snapshot:=jsonb_build_object('schema_version',1,'campaign',jsonb_build_object('id',v_campaign,'external_id','41000001','current_budget',340000),
    'audience_external_id','41000002','target_budget',300000,'guards',jsonb_build_object('simulation_only',true));
  v_auth_fp:=public._agency_mesa_fingerprint(v_auth_snapshot);
  insert into public.agency_meta_investment_authorizations(authorization_key,scenario_id,measurement_id,campaign_id,product_id,selected_option,
    audience_external_id,target_budget,execution_mode,status,justification,valid_from,valid_until,request_fingerprint,sealed_snapshot,snapshot_fingerprint,
    requested_by,authorized_by,authorized_at,reviewed_by,reviewed_at,review_note)
  values('test41-auth-1-'||v_suffix,v_scenario,v_measure,v_campaign,v_product,'Reducir','41000002',300000,'Simulación','Autorizada',
    'TEST41 autorización humana exacta para comprobar Meta.',now(),now()+interval '60 minutes',md5('test41-request-1-'||v_suffix),v_auth_snapshot,v_auth_fp,
    v_actor.id,v_actor.id,now(),v_actor.id,now(),'TEST41 autorizado por una persona.') returning id into v_auth;
  insert into public.agency_meta_investment_execution_jobs(authorization_id,idempotency_key,sealed_snapshot,snapshot_fingerprint)
  values(v_auth,'momos:meta-investment:'||v_auth||':1',v_auth_snapshot,v_auth_fp);
  perform set_config('momos.test41_auth_user',v_actor.auth_id::text,true); perform set_config('momos.test41_actor',v_actor.id,true);
  perform set_config('momos.test41_auth',v_auth::text,true); perform set_config('momos.test41_scenario',v_scenario::text,true);
  perform set_config('momos.test41_measure',v_measure::text,true); perform set_config('momos.test41_campaign',v_campaign,true);
  perform set_config('momos.test41_budget','340000',true); perform set_config('momos.test41_posts',(select count(*)::text from public.content_posts),true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.test41_auth_user'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare v_result jsonb; begin
  begin perform public.reclamar_dry_run_meta('navegador-falso',120); raise exception 'El navegador reclamó el worker.';
    exception when insufficient_privilege then null; end;
  begin perform public.preparar_dry_run_meta(current_setting('momos.test41_auth')::bigint,'act_otro','v25.0');
    raise exception 'Aceptó cuenta no numérica.'; exception when others then if sqlerrm='Aceptó cuenta no numérica.' then raise; end if; end;
  v_result:=public.preparar_dry_run_meta(current_setting('momos.test41_auth')::bigint,'410001','v25.0');
  assert v_result->>'status'='Preparado' and (v_result->>'read_only')::boolean and not (v_result->>'executed')::boolean,
    'Preparar el dry-run ejecutó Meta.';
  perform set_config('momos.test41_run',v_result->>'dry_run_id',true);
  v_result:=public.preparar_dry_run_meta(current_setting('momos.test41_auth')::bigint,'act_410001','v25.0');
  assert (v_result->>'duplicate')::boolean, 'La preparación no fue idempotente.';
end $$;
reset role;

update public.agency_integrations set status='Configurada',last_error='' where provider='Meta';
select public.reportar_worker_meta('worker-test41','test-1.0','v25.0','Activa','','Cuenta MOMOS','act_410001',true);
do $$ declare v_claim jsonb; v_token uuid; v_receipt jsonb; v_failed boolean:=false; begin
  assert exists(select 1 from public.agency_integrations where provider='Meta' and status='Activa' and capabilities @> '["ads_read"]'
    and not capabilities @> '["ads_management"]'), 'La salud Meta pidió permisos de escritura.';
  v_claim:=public.reclamar_dry_run_meta('worker-test41',120); v_token:=(v_claim->>'lease_token')::uuid;
  assert v_claim->>'allowed_method'='GET' and (v_claim->>'read_only')::boolean, 'El lease admitió otro método.';
  perform public.marcar_lectura_dry_run_meta((v_claim->>'dry_run_id')::bigint,v_token);
  v_receipt:=jsonb_build_object('schema_version',1,'api_version','v25.0','mode','Read-only','external_mutation',false,'reconciled',true,
    'requests',jsonb_build_array(jsonb_build_object('resource','account','method','POST','host','graph.facebook.com'),
      jsonb_build_object('resource','campaign','method','GET','host','graph.facebook.com'),jsonb_build_object('resource','audience','method','GET','host','graph.facebook.com')),
    'account',jsonb_build_object('id','act_410001'),'campaign',jsonb_build_object('id','41000001'),'audience',jsonb_build_object('id','41000002'));
  begin perform public.registrar_resultado_dry_run_meta((v_claim->>'dry_run_id')::bigint,v_token,'Conciliado',v_receipt,'');
    exception when others then v_failed:=true; end;
  assert v_failed, 'El servidor aceptó un POST fingido como lectura.';
  v_receipt:=jsonb_set(v_receipt,'{requests,0,method}','"GET"');
  perform public.registrar_resultado_dry_run_meta((v_claim->>'dry_run_id')::bigint,v_token,'Conciliado',v_receipt,'');
  assert (select status from public.agency_meta_connector_dry_runs where id=(v_claim->>'dry_run_id')::bigint)='Conciliado', 'No selló la conciliación.';
  assert (select presupuesto from public.campaigns where id=current_setting('momos.test41_campaign'))=current_setting('momos.test41_budget')::numeric,
    'El dry-run cambió presupuesto.';
  assert (select count(*) from public.content_posts)=current_setting('momos.test41_posts')::bigint, 'El dry-run publicó contenido.';
  v_failed:=false;
  begin update public.agency_meta_connector_dry_runs set ad_account_id='act_999999' where id=(v_claim->>'dry_run_id')::bigint;
    exception when others then v_failed:=true; end;
  assert v_failed, 'La identidad conciliada pudo reescribirse.';
end $$;

do $$ declare v_auth bigint; v_snapshot jsonb; v_fp text; begin
  update public.agency_meta_investment_authorizations set status='Simulada' where id=current_setting('momos.test41_auth')::bigint;
  select sealed_snapshot,snapshot_fingerprint into v_snapshot,v_fp from public.agency_meta_investment_authorizations where id=current_setting('momos.test41_auth')::bigint;
  insert into public.agency_meta_investment_authorizations(authorization_key,scenario_id,measurement_id,campaign_id,product_id,selected_option,
    audience_external_id,target_budget,execution_mode,status,justification,valid_from,valid_until,request_fingerprint,sealed_snapshot,snapshot_fingerprint,
    requested_by,authorized_by,authorized_at,reviewed_by,reviewed_at,review_note)
  select 'test41-auth-2-'||pg_backend_pid(),scenario_id,measurement_id,campaign_id,product_id,selected_option,audience_external_id,target_budget,
    execution_mode,'Autorizada','TEST41 segunda autorización para probar incertidumbre.',now(),now()+interval '60 minutes',md5('test41-request-2-'||pg_backend_pid()),
    v_snapshot,v_fp,current_setting('momos.test41_actor'),current_setting('momos.test41_actor'),now(),current_setting('momos.test41_actor'),now(),'TEST41 autorizado para anti-reintento.'
  from public.agency_meta_investment_authorizations where id=current_setting('momos.test41_auth')::bigint returning id into v_auth;
  perform set_config('momos.test41_auth2',v_auth::text,true);
end $$;
set local role authenticated;
select public.preparar_dry_run_meta(current_setting('momos.test41_auth2')::bigint,'act_410001','v25.0');
reset role;
do $$ declare v_claim jsonb; v_token uuid; v_empty jsonb; begin
  v_claim:=public.reclamar_dry_run_meta('worker-test41',120); v_token:=(v_claim->>'lease_token')::uuid;
  perform public.marcar_lectura_dry_run_meta((v_claim->>'dry_run_id')::bigint,v_token);
  perform public.registrar_resultado_dry_run_meta((v_claim->>'dry_run_id')::bigint,v_token,'Incierto','{}','La conexión terminó sin una lectura conciliable.');
  v_empty:=public.reclamar_dry_run_meta('worker-test41',120);
  assert v_empty='{}'::jsonb, 'Una lectura incierta se reintentó automáticamente.';
end $$;

update public.agency_integrations set status='Pausada',last_error='TEST41 pausa humana' where provider='Meta';
select public.reportar_worker_meta('worker-test41','test-1.1','v25.0','Activa','','Cuenta MOMOS','act_410001',true);
do $$ begin assert (select status from public.agency_integrations where provider='Meta')='Pausada', 'El heartbeat deshizo una pausa humana.'; end $$;

select 'TESTS_OK — Meta dry-run GET/appsecret-proof/identidad/conciliación/no mutación/lease/incierto/RBAC PASS, rollback total' as resultado;
rollback;
