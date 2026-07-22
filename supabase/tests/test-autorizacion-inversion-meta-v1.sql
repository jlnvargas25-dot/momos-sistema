-- MOMOS OPS · prueba adversarial de Autorización de inversión Meta. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_40_autorizacion_inversion'), 'Falta aplicar la migración 40.';
  assert public.autorizacion_inversion_meta_disponible(), 'Falta la sonda de autorización Meta.';
  assert to_regclass('public.agency_meta_investment_authorizations') is not null, 'Falta la tabla de autorizaciones.';
  assert to_regclass('public.agency_meta_investment_execution_jobs') is not null, 'Falta la outbox de simulación.';
  assert has_function_privilege('authenticated','public.solicitar_autorizacion_inversion_meta(jsonb)','EXECUTE'), 'Falta solicitud humana.';
  assert has_function_privilege('authenticated','public.resolver_autorizacion_inversion_meta(bigint,text,text)','EXECUTE'), 'Falta autorización humana.';
  assert not has_function_privilege('authenticated','public.reclamar_simulacion_inversion_meta(text,integer)','EXECUTE'), 'El navegador suplanta al worker.';
  assert has_function_privilege('service_role','public.reclamar_simulacion_inversion_meta(text,integer)','EXECUTE'), 'El worker privado no puede reclamar.';
  assert not has_table_privilege('authenticated','public.agency_meta_investment_authorizations','INSERT'), 'El navegador inserta permisos directos.';
  assert not has_table_privilege('authenticated','public.agency_meta_investment_execution_jobs','UPDATE'), 'El navegador altera intentos.';
end $$;

do $$
declare v_actor public.users%rowtype; v_suffix text:=pg_backend_pid()::text; v_product text:='PR-T40-'||v_suffix;
  v_campaign text:='CMP-T40-'||v_suffix; v_cat text; v_policy bigint; v_snapshot bigint; v_diag bigint; v_study bigint; v_measure bigint; v_scenario bigint;
begin
  select * into v_actor from public.users where activo and auth_id is not null and public.valid_user_roles(roles,rol)
    and 'Administrador'=any(roles) order by id limit 1;
  select nombre into v_cat from public.product_cats order by nombre limit 1;
  select id into v_policy from public.agency_meta_policies where status='Activa' order by version desc limit 1;
  assert v_actor.id is not null and v_cat is not null and v_policy is not null, 'Falta Administrador, categoría o política Meta.';
  update public.agency_settings
  set paused=false,daily_budget_limit=100000,campaign_budget_limit=500000
  where id;
  insert into public.products(id,nombre,cat,tipo,especie,precio,costo,stock,activo)
  values(v_product,'TEST40 producto vigente',v_cat,'momo','gato',18000,7000,10,true);
  insert into public.campaigns(id,nombre,canal,objetivo,producto_foco_id,presupuesto,estado,external_platform,external_id)
  values(v_campaign,'TEST40 autorización','Instagram','Ventas',v_product,400000,'Activa','meta','campaign-test40-'||v_suffix);
  insert into public.agency_meta_signal_snapshots(snapshot_key,account_external_id,account_label,entity_type,entity_external_id,objective,currency,
    timezone,window_start,window_end,source_captured_at,local_campaign_id,metrics,pixel_events,catalog_products,local_truth,snapshot_fingerprint,recorded_by_connector)
  values('test40-snapshot-'||v_suffix,'act_test40','MOMOS TEST40','Campaña','campaign-test40-'||v_suffix,'Ventas','COP','America/Bogota',
    now()-interval '14 days',now()-interval '7 days',now(),v_campaign,'{"spend":200000,"impressions":20000,"clicks":400,"purchases":10}'::jsonb,
    '[]'::jsonb,'[]'::jsonb,'{"paid_orders":10,"paid_revenue":900000,"paid_margin":500000}'::jsonb,md5('test40-snapshot-'||v_suffix),'meta-test40') returning id into v_snapshot;
  insert into public.agency_meta_diagnostics(diagnostic_key,snapshot_id,policy_id,status,what_happened,why_hypotheses,recommended_actions,
    evidence_snapshot,confidence,source_kind,diagnostic_fingerprint,prepared_by,reviewed_by,reviewed_at,review_note)
  values('test40-diagnostic-'||v_suffix,v_snapshot,v_policy,'Aprobado','{}','[]','[]','{}','Alta','Humano',md5('test40-diagnostic-'||v_suffix),
    v_actor.id,v_actor.id,now(),'TEST40 diagnóstico aprobado.') returning id into v_diag;
  insert into public.agency_meta_lift_studies(study_key,diagnostic_id,snapshot_id,campaign_id,external_study_id,design,lifecycle_scope,status,
    window_start,window_end,minimum_per_arm,hypothesis,assignment_snapshot,guardrails,study_fingerprint,source_kind,prepared_by,reviewed_by,reviewed_at,review_note)
  values('test40-study-'||v_suffix,v_diag,v_snapshot,v_campaign,'META-LIFT-T40-'||v_suffix,'Meta Conversion Lift','Todos','Cerrado',
    now()-interval '14 days',now()-interval '7 days',100,'La campaña aumenta compradores pagados frente al control.','{"randomized":true,"method":"Meta Conversion Lift"}',
    '{"publication_forbidden":true}',md5('test40-study-'||v_suffix),'Humano',v_actor.id,v_actor.id,now(),'TEST40 diseño aprobado.') returning id into v_study;
  insert into public.agency_meta_lift_measurements(measurement_key,study_id,status,captured_at,control_cell,exposed_cell,incremental_spend,
    platform_result,local_lifecycle_snapshot,result_snapshot,measurement_fingerprint,recorded_by_connector,reviewed_by,reviewed_at,review_note)
  values('test40-measure-'||v_suffix,v_study,'Aprobada',now(),'{"population":1000,"buyers":50,"orders":52,"revenue":900000,"margin":500000}',
    '{"population":1000,"buyers":90,"orders":95,"revenue":1710000,"margin":950000}',200000,'{"source":"Meta Conversion Lift"}',
    '{"new":{"margin":400000},"returning":{"margin":550000}}','{"classification":"Incremental rentable","sample_sufficient":true,"statistically_significant":true,"causal_claim_allowed":true,"incremental_profit":222222,"incremental_margin":422222}',
    md5('test40-measure-'||v_suffix),'meta-lift-test40',v_actor.id,now(),'TEST40 medición aprobada.') returning id into v_measure;
  insert into public.agency_meta_investment_scenarios(scenario_key,measurement_id,study_id,campaign_id,product_id,status,horizon_days,recommended_option,
    evidence_snapshot,options_snapshot,guardrails,scenario_fingerprint,source_kind,prepared_by,reviewed_by,reviewed_at,review_note,prepared_at)
  values('test40-scenario-1-'||v_suffix,v_measure,v_study,v_campaign,v_product,'Aprobado',7,'Conservar',
    jsonb_build_object('campaign',jsonb_build_object('id',v_campaign),'product',jsonb_build_object('id',v_product,'name','TEST40 producto vigente'),
      'operations',jsonb_build_object('stock_blocked',false),'limits',jsonb_build_object('daily_budget_limit',500000,'campaign_budget_limit',500000)),
    '[{"key":"Conservar","proposed_budget":400000,"delta_pct":0,"projection":{"low":10000,"base":20000,"high":30000},"purpose":"Mantener","blockers":[],"assumptions":[]},{"key":"Reducir","proposed_budget":340000,"delta_pct":-15,"projection":{"low":8000,"base":16000,"high":24000},"purpose":"Reducir","blockers":[],"assumptions":[]},{"key":"Redistribuir","proposed_budget":400000,"delta_pct":0,"projection":{"low":9000,"base":19000,"high":31000},"purpose":"Redistribuir","blockers":[],"assumptions":[]},{"key":"Experimento","proposed_budget":60000,"delta_pct":-85,"projection":{"low":-60000,"base":0,"high":50000},"purpose":"Experimentar","blockers":[],"assumptions":[]}]',
    '{"execution_forbidden":true}',md5('test40-scenario-1-'||v_suffix),'Humano',v_actor.id,v_actor.id,now(),'TEST40 escenarios aprobados.',now()) returning id into v_scenario;
  perform set_config('momos.test40_auth',v_actor.auth_id::text,true); perform set_config('momos.test40_actor',v_actor.id,true);
  perform set_config('momos.test40_product',v_product,true); perform set_config('momos.test40_campaign',v_campaign,true);
  perform set_config('momos.test40_study',v_study::text,true); perform set_config('momos.test40_measure',v_measure::text,true);
  perform set_config('momos.test40_scenario',v_scenario::text,true); perform set_config('momos.test40_budget','400000',true);
  perform set_config('momos.test40_posts',(select count(*)::text from public.content_posts),true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.test40_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare v_result jsonb; begin
  begin perform public.reclamar_simulacion_inversion_meta('navegador-falso',5); raise exception 'El navegador reclamó un lease.';
    exception when insufficient_privilege then null; end;
  begin perform public.solicitar_autorizacion_inversion_meta(jsonb_build_object('authorization_key','test40-bad-budget-'||pg_backend_pid(),
    'scenario_id',current_setting('momos.test40_scenario')::bigint,'selected_option','Reducir','audience_external_id','aud_test40',
    'target_budget',1,'valid_minutes',60,'justification','TEST40 presupuesto manipulado por navegador.','execution_mode','Simulación'));
    raise exception 'Aceptó presupuesto manipulado.'; exception when others then if sqlerrm='Aceptó presupuesto manipulado.' then raise; end if; end;
  begin perform public.solicitar_autorizacion_inversion_meta(jsonb_build_object('authorization_key','test40-bad-mode-'||pg_backend_pid(),
    'scenario_id',current_setting('momos.test40_scenario')::bigint,'selected_option','Reducir','audience_external_id','aud_test40',
    'target_budget',340000,'valid_minutes',60,'justification','TEST40 intentó activar ejecución real.','execution_mode','Producción'));
    raise exception 'Aceptó modo de ejecución real.'; exception when others then if sqlerrm='Aceptó modo de ejecución real.' then raise; end if; end;
  v_result:=public.solicitar_autorizacion_inversion_meta(jsonb_build_object('authorization_key','test40-auth-1-'||pg_backend_pid(),
    'scenario_id',current_setting('momos.test40_scenario')::bigint,'selected_option','Reducir','audience_external_id','aud_test40_exact',
    'target_budget',340000,'valid_minutes',60,'justification','TEST40 reducir exposición con permiso corto y exacto.','execution_mode','Simulación'));
  assert v_result->>'status'='En revisión' and not (v_result->>'authorized')::boolean and not (v_result->>'executed')::boolean,
    'La solicitud se autoautorizó o ejecutó.';
  perform set_config('momos.test40_auth1',(v_result->>'authorization_id'),true);
  v_result:=public.solicitar_autorizacion_inversion_meta(jsonb_build_object('authorization_key','test40-auth-1-'||pg_backend_pid(),
    'scenario_id',current_setting('momos.test40_scenario')::bigint,'selected_option','Reducir','audience_external_id','aud_test40_exact',
    'target_budget',340000,'valid_minutes',60,'justification','TEST40 reducir exposición con permiso corto y exacto.','execution_mode','Simulación'));
  assert (v_result->>'duplicate')::boolean, 'La solicitud no fue idempotente.';
  v_result:=public.resolver_autorizacion_inversion_meta(current_setting('momos.test40_auth1')::bigint,'Autorizar',
    'TEST40 autorización humana separada de la lectura analítica.');
  assert v_result->>'status'='Autorizada' and (v_result->>'authorized')::boolean and not (v_result->>'executed')::boolean
    and (v_result->>'simulation_only')::boolean, 'Autorizar ejecutó Meta o salió de simulación.';
end $$;

reset role;
do $$
declare v_scenario bigint; v_measure bigint:=current_setting('momos.test40_measure')::bigint; v_study bigint:=current_setting('momos.test40_study')::bigint;
  v_campaign text:=current_setting('momos.test40_campaign'); v_product text:=current_setting('momos.test40_product'); v_actor text:=current_setting('momos.test40_actor');
begin
  insert into public.agency_meta_investment_scenarios(scenario_key,measurement_id,study_id,campaign_id,product_id,status,horizon_days,recommended_option,
    evidence_snapshot,options_snapshot,guardrails,scenario_fingerprint,source_kind,prepared_by,reviewed_by,reviewed_at,review_note,prepared_at)
  select 'test40-scenario-2-'||pg_backend_pid(),v_measure,v_study,v_campaign,v_product,'Aprobado',7,'Conservar',evidence_snapshot,options_snapshot,
    guardrails,md5('test40-scenario-2-'||pg_backend_pid()),'Humano',v_actor,v_actor,now(),'TEST40 evidencia nueva aprobada.',now()+interval '1 second'
  from public.agency_meta_investment_scenarios where id=current_setting('momos.test40_scenario')::bigint returning id into v_scenario;
  assert (select status from public.agency_meta_investment_authorizations where id=current_setting('momos.test40_auth1')::bigint)='Sustituida',
    'La evidencia nueva no invalidó el permiso pendiente.';
  assert (select status from public.agency_meta_investment_execution_jobs where authorization_id=current_setting('momos.test40_auth1')::bigint)='Cancelado',
    'El job de evidencia sustituida siguió ejecutable.';
  perform set_config('momos.test40_scenario',v_scenario::text,true);
end $$;

set local role authenticated;
do $$ declare v_result jsonb; begin
  v_result:=public.solicitar_autorizacion_inversion_meta(jsonb_build_object('authorization_key','test40-auth-2-'||pg_backend_pid(),
    'scenario_id',current_setting('momos.test40_scenario')::bigint,'selected_option','Experimento','audience_external_id','aud_test40_experiment',
    'target_budget',60000,'valid_minutes',60,'justification','TEST40 simular experimento sin tocar la campaña.','execution_mode','Simulación'));
  perform set_config('momos.test40_auth2',(v_result->>'authorization_id'),true);
  perform public.resolver_autorizacion_inversion_meta((v_result->>'authorization_id')::bigint,'Autorizar',
    'TEST40 autoriza únicamente el cálculo seco del experimento.');
end $$;

reset role;
do $$ declare v_claim jsonb; v_mark jsonb; v_result jsonb; v_token uuid; begin
  v_claim:=public.reclamar_simulacion_inversion_meta('worker-test40',5); v_token:=(v_claim->>'lease_token')::uuid;
  assert (v_claim->>'simulation_only')::boolean and (v_claim->>'external_http_forbidden')::boolean, 'El lease permitió mutar Meta.';
  v_mark:=public.marcar_despacho_simulacion_inversion_meta((v_claim->>'job_id')::bigint,v_token);
  assert (v_mark->>'external_http_forbidden')::boolean, 'El despacho expuso una instrucción externa.';
  begin perform public.registrar_resultado_simulacion_inversion_meta((v_claim->>'job_id')::bigint,v_token,'Aplicado','{}','');
    raise exception 'H40 aceptó una mutación aplicada.'; exception when others then if sqlerrm='H40 aceptó una mutación aplicada.' then raise; end if; end;
  v_result:=public.registrar_resultado_simulacion_inversion_meta((v_claim->>'job_id')::bigint,v_token,'Simulado',
    '{"dry_run":true,"external_mutation":false,"summary":"Sin cambios externos"}','');
  assert v_result->>'status'='Simulado' and not (v_result->>'executed')::boolean, 'La simulación se presentó como ejecución.';
  assert (select presupuesto from public.campaigns where id=current_setting('momos.test40_campaign'))=current_setting('momos.test40_budget')::numeric,
    'La simulación cambió presupuesto.';
end $$;

do $$
declare v_scenario bigint; v_measure bigint:=current_setting('momos.test40_measure')::bigint; v_study bigint:=current_setting('momos.test40_study')::bigint;
  v_campaign text:=current_setting('momos.test40_campaign'); v_product text:=current_setting('momos.test40_product'); v_actor text:=current_setting('momos.test40_actor');
begin
  insert into public.agency_meta_investment_scenarios(scenario_key,measurement_id,study_id,campaign_id,product_id,status,horizon_days,recommended_option,
    evidence_snapshot,options_snapshot,guardrails,scenario_fingerprint,source_kind,prepared_by,reviewed_by,reviewed_at,review_note,prepared_at)
  select 'test40-scenario-3-'||pg_backend_pid(),v_measure,v_study,v_campaign,v_product,'Aprobado',7,'Reducir',evidence_snapshot,options_snapshot,
    guardrails,md5('test40-scenario-3-'||pg_backend_pid()),'Humano',v_actor,v_actor,now(),'TEST40 escenario para incertidumbre.',now()+interval '2 seconds'
  from public.agency_meta_investment_scenarios where id=current_setting('momos.test40_scenario')::bigint returning id into v_scenario;
  perform set_config('momos.test40_scenario',v_scenario::text,true);
end $$;

set local role authenticated;
do $$ declare v_result jsonb; begin
  v_result:=public.solicitar_autorizacion_inversion_meta(jsonb_build_object('authorization_key','test40-auth-3-'||pg_backend_pid(),
    'scenario_id',current_setting('momos.test40_scenario')::bigint,'selected_option','Reducir','audience_external_id','aud_test40_uncertain',
    'target_budget',340000,'valid_minutes',60,'justification','TEST40 permiso destinado a probar incertidumbre.','execution_mode','Simulación'));
  perform public.resolver_autorizacion_inversion_meta((v_result->>'authorization_id')::bigint,'Autorizar',
    'TEST40 autorización humana para probar anti-reenvío incierto.');
end $$;

reset role;
do $$ declare v_claim jsonb; v_token uuid; v_empty jsonb; v_failed boolean:=false; begin
  v_claim:=public.reclamar_simulacion_inversion_meta('worker-test40',5); v_token:=(v_claim->>'lease_token')::uuid;
  perform public.marcar_despacho_simulacion_inversion_meta((v_claim->>'job_id')::bigint,v_token);
  perform public.registrar_resultado_simulacion_inversion_meta((v_claim->>'job_id')::bigint,v_token,'Incierto','{}',
    'TEST40 el worker perdió confirmación del cálculo seco.');
  v_empty:=public.reclamar_simulacion_inversion_meta('worker-test40',5);
  assert v_empty='{}'::jsonb, 'Un resultado incierto se reenvió automáticamente.';
  assert (select status from public.agency_meta_investment_execution_jobs where id=(v_claim->>'job_id')::bigint)='Incierto',
    'El intento incierto perdió su estado visible.';
  begin update public.agency_meta_investment_authorizations set sealed_snapshot='{}' where id=current_setting('momos.test40_auth2')::bigint;
    exception when others then v_failed:=true; end;
  assert v_failed, 'El contrato sellado pudo reescribirse.';
  assert (select presupuesto from public.campaigns where id=current_setting('momos.test40_campaign'))=current_setting('momos.test40_budget')::numeric,
    'H40 cambió presupuesto.';
  assert (select count(*) from public.content_posts)=current_setting('momos.test40_posts')::bigint, 'H40 publicó contenido.';
end $$;

select 'TESTS_OK — Autorización Meta contrato/vigencia/simulación/lease/idempotencia/incierto/no ejecución/RBAC PASS, rollback total' as resultado;
rollback;
