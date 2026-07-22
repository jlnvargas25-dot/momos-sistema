-- MOMOS OPS · prueba adversarial de Incrementalidad Meta. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_38_incrementalidad_meta'), 'Falta aplicar la migración 38.';
  assert public.incrementalidad_meta_disponible(), 'Falta la sonda de Incrementalidad Meta.';
  assert to_regclass('public.agency_meta_lift_studies') is not null and to_regclass('public.agency_meta_lift_measurements') is not null, 'Faltan tablas de lift.';
  assert has_function_privilege('authenticated','public.crear_estudio_incremental_meta(jsonb)','EXECUTE'), 'Falta diseño humano del estudio.';
  assert has_function_privilege('authenticated','public.resolver_estudio_incremental_meta(bigint,text,text)','EXECUTE'), 'Falta revisión humana del estudio.';
  assert not has_function_privilege('authenticated','public.registrar_medicion_incremental_meta_conector(jsonb)','EXECUTE'), 'El navegador suplanta al conector de lift.';
  assert not has_function_privilege('authenticated','public.proponer_estudio_incremental_meta_agente(jsonb,text)','EXECUTE'), 'El navegador suplanta al cerebro.';
  assert has_function_privilege('service_role','public.registrar_medicion_incremental_meta_conector(jsonb)','EXECUTE'), 'El conector privado no puede medir.';
  assert has_function_privilege('service_role','public.obtener_contexto_incrementalidad_meta_agente()','EXECUTE'), 'El cerebro privado no recibe contexto.';
  assert not has_table_privilege('authenticated','public.agency_meta_lift_studies','INSERT'), 'El navegador inserta estudios directos.';
  assert not has_table_privilege('authenticated','public.agency_meta_lift_measurements','UPDATE'), 'El navegador reescribe mediciones.';
end $$;

do $$
declare v_actor public.users%rowtype; v_suffix text:=pg_backend_pid()::text; v_campaign text:='CMP-T38-'||v_suffix;
  v_creative text:='CRE-T38-'||v_suffix; v_product text; v_snapshot bigint; v_result jsonb;
begin
  select * into v_actor from public.users where activo and auth_id is not null and public.valid_user_roles(roles,rol)
    and 'Administrador'=any(roles) order by id limit 1;
  select id into v_product from public.products where activo order by id limit 1;
  assert v_actor.id is not null and v_product is not null, 'Falta Administrador o producto activo para la prueba.';
  insert into public.campaigns(id,nombre,canal,objetivo,producto_foco_id,presupuesto,estado,external_platform,external_id)
  values(v_campaign,'TEST38 Lift','Instagram','Ventas',v_product,76543,'Planeada','meta','lift-campaign-'||v_suffix);
  insert into public.creatives(id,campaign_id,titulo,canal,formato,producto_foco_id,estado,external_id)
  values(v_creative,v_campaign,'TEST38 creativo','Instagram','Anuncio',v_product,'Aprobado','lift-ad-'||v_suffix);
  v_result:=public.registrar_snapshot_meta_conector(jsonb_build_object('snapshot_key','test38-snapshot-'||v_suffix,
    'account_external_id','act_test38','account_label','MOMOS TEST38','entity_type','Campaña','entity_external_id','campaign-'||v_suffix,
    'objective','Ventas','currency','COP','timezone','America/Bogota','window_start',now()-interval '14 days','window_end',now()-interval '7 days',
    'source_captured_at',now(),'local_campaign_id',v_campaign,'local_creative_id',v_creative,
    'metrics',jsonb_build_object('spend',200000,'impressions',20000,'clicks',400,'purchases',10,'purchaseValue',900000),
    'pixel_events','[]'::jsonb,'catalog_products','[]'::jsonb,'connector_name','meta-test38'));
  v_snapshot:=(v_result->>'snapshot_id')::bigint;
  perform set_config('momos.test38_auth',v_actor.auth_id::text,true); perform set_config('momos.test38_campaign',v_campaign,true);
  perform set_config('momos.test38_snapshot',v_snapshot::text,true); perform set_config('momos.test38_budget','76543',true);
  perform set_config('momos.test38_posts',(select count(*)::text from public.content_posts),true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.test38_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_diag bigint; v_study bigint; v_result jsonb; v_failed boolean:=false;
begin
  begin perform public.registrar_medicion_incremental_meta_conector('{}'); exception when insufficient_privilege then v_failed:=true; end;
  assert v_failed, 'Una cuenta autenticada suplantó al conector.';
  v_result:=public.preparar_diagnostico_meta(current_setting('momos.test38_snapshot')::bigint,'TEST38 diagnóstico aprobado para diseñar medición incremental.');
  v_diag:=(v_result->>'diagnostic_id')::bigint;
  perform public.resolver_diagnostico_meta(v_diag,'Aprobar','TEST38 hechos revisados; no autoriza cambios de pauta.');
  v_failed:=false;
  begin perform public.crear_estudio_incremental_meta(jsonb_build_object('study_key','test38-invalid-'||pg_backend_pid(),'diagnostic_id',v_diag,
    'design','Meta Conversion Lift','lifecycle_scope','Todos','window_start',now()-interval '14 days','window_end',now()-interval '7 days',
    'minimum_per_arm',50,'hypothesis','La campaña aumenta compradores pagados.','assignment_snapshot',jsonb_build_object('randomized',false)));
  exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó un supuesto causal sin aleatorización o muestra mínima.';
  v_result:=public.crear_estudio_incremental_meta(jsonb_build_object('study_key','test38-study-'||pg_backend_pid(),'diagnostic_id',v_diag,
    'external_study_id','META-LIFT-'||pg_backend_pid(),'design','Meta Conversion Lift','lifecycle_scope','Todos',
    'window_start',now()-interval '14 days','window_end',now()-interval '7 days','minimum_per_arm',100,
    'hypothesis','La campaña aumenta compradores pagados frente al control aleatorio.',
    'assignment_snapshot',jsonb_build_object('randomized',true,'method','Meta Conversion Lift')));
  v_study:=(v_result->>'study_id')::bigint;
  assert not (v_result->>'executed')::boolean and not (v_result->>'published')::boolean and not (v_result->>'spend_changed')::boolean,
    'Diseñar el estudio ejecutó pauta.';
  perform public.resolver_estudio_incremental_meta(v_study,'Aprobar','TEST38 diseño y aleatorización revisados por una persona.');
  perform set_config('momos.test38_study',v_study::text,true);
end $$;

reset role;
do $$
declare v_payload jsonb; v_small jsonb; v_result jsonb; v_measure bigint; v_failed boolean:=false; v_row public.agency_meta_lift_measurements%rowtype;
begin
  v_payload:=jsonb_build_object('measurement_key','test38-measure-'||pg_backend_pid(),'study_id',current_setting('momos.test38_study')::bigint,
    'captured_at',now(),'incremental_spend',200000,'connector_name','meta-lift-test38',
    'control',jsonb_build_object('population',1000,'buyers',50,'orders',52,'revenue',900000,'margin',500000),
    'exposed',jsonb_build_object('population',1000,'buyers',90,'orders',95,'revenue',1710000,'margin',950000),
    'platform_result',jsonb_build_object('source','Meta Conversion Lift','reported_lift_pct',80));
  begin perform public.registrar_medicion_incremental_meta_conector(jsonb_set(v_payload,'{control,buyers}','1001'::jsonb)); exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó más compradores que población control.';
  v_small:=v_payload||jsonb_build_object('measurement_key','test38-small-'||pg_backend_pid(),
    'control',jsonb_build_object('population',20,'buyers',1,'orders',1,'revenue',10000,'margin',5000),
    'exposed',jsonb_build_object('population',20,'buyers',4,'orders',4,'revenue',40000,'margin',20000));
  v_result:=public.registrar_medicion_incremental_meta_conector(v_small); v_measure:=(v_result->>'measurement_id')::bigint;
  assert not (v_result->'result'->>'sample_sufficient')::boolean, 'Una muestra pequeña apareció suficiente.';
  perform set_config('momos.test38_small_measure',v_measure::text,true);
end $$;

set local role authenticated;
do $$ declare v_failed boolean:=false; begin
  begin perform public.resolver_medicion_incremental_meta(current_setting('momos.test38_small_measure')::bigint,'Aprobar',
    'TEST38 intento adversarial de aprobar una muestra insuficiente.'); exception when others then v_failed:=true; end;
  assert v_failed, 'Una persona aprobó como concluyente una muestra insuficiente.';
end $$;

reset role;
do $$
declare v_payload jsonb; v_result jsonb; v_measure bigint; v_failed boolean:=false; v_row public.agency_meta_lift_measurements%rowtype;
begin
  v_payload:=jsonb_build_object('measurement_key','test38-measure-'||pg_backend_pid(),'study_id',current_setting('momos.test38_study')::bigint,
    'captured_at',now(),'incremental_spend',200000,'connector_name','meta-lift-test38',
    'control',jsonb_build_object('population',1000,'buyers',50,'orders',52,'revenue',900000,'margin',500000),
    'exposed',jsonb_build_object('population',1000,'buyers',90,'orders',95,'revenue',1710000,'margin',950000),
    'platform_result',jsonb_build_object('source','Meta Conversion Lift','reported_lift_pct',80));
  v_result:=public.registrar_medicion_incremental_meta_conector(v_payload); v_measure:=(v_result->>'measurement_id')::bigint;
  select * into v_row from public.agency_meta_lift_measurements where id=v_measure;
  assert (v_row.result_snapshot->>'sample_sufficient')::boolean and (v_row.result_snapshot->>'statistically_significant')::boolean,
    'No reconoció la muestra y diferencia verificables.';
  assert (v_row.result_snapshot->>'causal_claim_allowed')::boolean and v_row.result_snapshot->>'classification'='Incremental rentable',
    'No separó el resultado causal rentable.';
  assert v_row.local_lifecycle_snapshot->>'source'='MOMOS OPS', 'El ciclo de vida no proviene de la verdad local.';
  assert (public.registrar_medicion_incremental_meta_conector(v_payload)->>'duplicate')::boolean, 'La medición idempotente se duplicó.';
  v_failed:=false; begin perform public.registrar_medicion_incremental_meta_conector(jsonb_set(v_payload,'{incremental_spend}','200001'::jsonb)); exception when others then v_failed:=true; end;
  assert v_failed, 'La misma clave aceptó otra medición.';
  perform set_config('momos.test38_measure',v_measure::text,true);
end $$;

set local role authenticated;
do $$ declare v_result jsonb; begin
  v_result:=public.resolver_medicion_incremental_meta(current_setting('momos.test38_measure')::bigint,'Aprobar',
    'TEST38 muestra, aleatorización, margen y alcance causal revisados.');
  assert v_result->>'status'='Aprobada' and (v_result->>'causal_claim_allowed')::boolean
    and not (v_result->>'executed')::boolean and not (v_result->>'published')::boolean and not (v_result->>'spend_changed')::boolean,
    'Aprobar la lectura ejecutó una acción externa.';
end $$;

reset role;
do $$ declare v_failed boolean:=false; begin
  begin update public.agency_meta_lift_measurements set control_cell='{}' where id=current_setting('momos.test38_measure')::bigint; exception when others then v_failed:=true; end;
  assert v_failed, 'Una medición sellada pudo reescribirse.';
  v_failed:=false; begin delete from public.agency_meta_lift_studies where id=current_setting('momos.test38_study')::bigint; exception when others then v_failed:=true; end;
  assert v_failed, 'Un estudio pudo eliminarse.';
  assert (select presupuesto from public.campaigns where id=current_setting('momos.test38_campaign'))=current_setting('momos.test38_budget')::numeric,
    'El hito cambió presupuesto.';
  assert (select count(*) from public.content_posts)=current_setting('momos.test38_posts')::bigint, 'El hito publicó contenido.';
end $$;

select 'TESTS_OK — Incrementalidad Meta lift/lifecycle/muestra/causalidad/beneficio/no pauta/RBAC PASS, rollback total' as resultado;
rollback;
