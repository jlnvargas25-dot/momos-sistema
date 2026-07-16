-- MOMOS OPS · prueba adversarial de Escenarios de inversión Meta. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_39_escenarios_inversion'), 'Falta aplicar la migración 39.';
  assert public.escenarios_inversion_meta_disponible(), 'Falta la sonda de escenarios Meta.';
  assert to_regclass('public.agency_meta_investment_scenarios') is not null, 'Falta la tabla de escenarios Meta.';
  assert has_function_privilege('authenticated','public.crear_escenarios_inversion_meta(jsonb)','EXECUTE'), 'Falta preparación humana.';
  assert has_function_privilege('authenticated','public.resolver_escenarios_inversion_meta(bigint,text,text)','EXECUTE'), 'Falta revisión humana.';
  assert not has_function_privilege('authenticated','public.proponer_escenarios_inversion_meta_agente(jsonb,text)','EXECUTE'), 'El navegador suplanta al agente.';
  assert has_function_privilege('service_role','public.proponer_escenarios_inversion_meta_agente(jsonb,text)','EXECUTE'), 'El cerebro privado no puede proponer.';
  assert not has_table_privilege('authenticated','public.agency_meta_investment_scenarios','INSERT'), 'El navegador inserta escenarios directos.';
  assert not has_table_privilege('authenticated','public.agency_meta_investment_scenarios','UPDATE'), 'El navegador reescribe escenarios.';
end $$;

do $$
declare v_actor public.users%rowtype; v_suffix text:=pg_backend_pid()::text; v_product text:='PR-T39-'||v_suffix;
  v_campaign text:='CMP-T39-'||v_suffix; v_creative text:='CRE-T39-'||v_suffix; v_cat text; v_snapshot bigint; v_result jsonb;
begin
  select * into v_actor from public.users where activo and auth_id is not null and public.valid_user_roles(roles,rol)
    and 'Administrador'=any(roles) order by id limit 1;
  select nombre into v_cat from public.product_cats order by nombre limit 1;
  assert v_actor.id is not null and v_cat is not null, 'Falta Administrador o categoría de producto para la prueba.';
  insert into public.products(id,nombre,cat,tipo,especie,precio,costo,stock,activo)
  values(v_product,'TEST39 producto sin stock',v_cat,'momo','gato',18000,7000,0,true);
  insert into public.campaigns(id,nombre,canal,objetivo,producto_foco_id,presupuesto,estado,external_platform,external_id)
  values(v_campaign,'TEST39 escenarios','Instagram','Ventas',v_product,400000,'Planeada','meta','investment-campaign-'||v_suffix);
  insert into public.creatives(id,campaign_id,titulo,canal,formato,producto_foco_id,estado,external_id)
  values(v_creative,v_campaign,'TEST39 creativo','Instagram','Anuncio',v_product,'Aprobado','investment-ad-'||v_suffix);
  v_result:=public.registrar_snapshot_meta_conector(jsonb_build_object('snapshot_key','test39-snapshot-'||v_suffix,
    'account_external_id','act_test39','account_label','MOMOS TEST39','entity_type','Campaña','entity_external_id','campaign-'||v_suffix,
    'objective','Ventas','currency','COP','timezone','America/Bogota','window_start',now()-interval '14 days','window_end',now()-interval '7 days',
    'source_captured_at',now(),'local_campaign_id',v_campaign,'local_creative_id',v_creative,
    'metrics',jsonb_build_object('spend',200000,'impressions',20000,'clicks',400,'purchases',10,'purchaseValue',900000),
    'pixel_events','[]'::jsonb,'catalog_products','[]'::jsonb,'connector_name','meta-test39'));
  v_snapshot:=(v_result->>'snapshot_id')::bigint;
  perform set_config('momos.test39_auth',v_actor.auth_id::text,true); perform set_config('momos.test39_product',v_product,true);
  perform set_config('momos.test39_campaign',v_campaign,true); perform set_config('momos.test39_snapshot',v_snapshot::text,true);
  perform set_config('momos.test39_budget','400000',true); perform set_config('momos.test39_posts',(select count(*)::text from public.content_posts),true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.test39_auth'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_diag bigint; v_study bigint; v_result jsonb;
begin
  v_result:=public.preparar_diagnostico_meta(current_setting('momos.test39_snapshot')::bigint,'TEST39 diagnóstico aprobado para inversión protegida.');
  v_diag:=(v_result->>'diagnostic_id')::bigint;
  perform public.resolver_diagnostico_meta(v_diag,'Aprobar','TEST39 hechos revisados sin autorizar pauta.');
  v_result:=public.crear_estudio_incremental_meta(jsonb_build_object('study_key','test39-study-'||pg_backend_pid(),'diagnostic_id',v_diag,
    'external_study_id','META-LIFT-T39-'||pg_backend_pid(),'design','Meta Conversion Lift','lifecycle_scope','Todos',
    'window_start',now()-interval '14 days','window_end',now()-interval '7 days','minimum_per_arm',100,
    'hypothesis','La campaña aumenta compradores pagados frente al control aleatorio.',
    'assignment_snapshot',jsonb_build_object('randomized',true,'method','Meta Conversion Lift')));
  v_study:=(v_result->>'study_id')::bigint;
  perform public.resolver_estudio_incremental_meta(v_study,'Aprobar','TEST39 diseño causal revisado por una persona.');
  perform set_config('momos.test39_study',v_study::text,true);
end $$;

reset role;
do $$ declare v_result jsonb; v_measure bigint; begin
  v_result:=public.registrar_medicion_incremental_meta_conector(jsonb_build_object('measurement_key','test39-measure-'||pg_backend_pid(),
    'study_id',current_setting('momos.test39_study')::bigint,'captured_at',now(),'incremental_spend',200000,'connector_name','meta-lift-test39',
    'control',jsonb_build_object('population',1000,'buyers',50,'orders',52,'revenue',900000,'margin',500000),
    'exposed',jsonb_build_object('population',1000,'buyers',90,'orders',95,'revenue',1710000,'margin',950000),
    'platform_result',jsonb_build_object('source','Meta Conversion Lift','reported_lift_pct',80)));
  v_measure:=(v_result->>'measurement_id')::bigint; perform set_config('momos.test39_measure',v_measure::text,true);
end $$;

set local role authenticated;
do $$ declare v_result jsonb; begin
  perform public.resolver_medicion_incremental_meta(current_setting('momos.test39_measure')::bigint,'Aprobar',
    'TEST39 muestra y causalidad revisadas antes del escenario.');
  begin perform public.proponer_escenarios_inversion_meta_agente('{}','agente-falso');
    raise exception 'Una cuenta autenticada suplantó al agente.'; exception when insufficient_privilege then null; end;
  begin perform public.crear_escenarios_inversion_meta(jsonb_build_object('scenario_key','test39-invalid-'||pg_backend_pid(),
    'measurement_id',current_setting('momos.test39_measure')::bigint,'horizon_days',31));
    raise exception 'Aceptó horizonte fuera de rango.'; exception when others then
      if sqlerrm='Aceptó horizonte fuera de rango.' then raise; end if; end;
  v_result:=public.crear_escenarios_inversion_meta(jsonb_build_object('scenario_key','test39-scenario-'||pg_backend_pid(),
    'measurement_id',current_setting('momos.test39_measure')::bigint,'horizon_days',7));
  assert v_result->>'recommended_option'='Reducir', 'El stock agotado no bloqueó crecimiento.';
  assert not (v_result->>'executed')::boolean and not (v_result->>'published')::boolean
    and not (v_result->>'budget_changed')::boolean and not (v_result->>'audience_changed')::boolean,
    'Preparar escenarios ejecutó una acción externa.';
  perform set_config('momos.test39_scenario',(v_result->>'scenario_id'),true);
end $$;

reset role;
do $$
declare v_row public.agency_meta_investment_scenarios%rowtype; v_result jsonb; v_failed boolean:=false;
begin
  select * into v_row from public.agency_meta_investment_scenarios where id=current_setting('momos.test39_scenario')::bigint;
  assert jsonb_array_length(v_row.options_snapshot)=4 and (select count(distinct x->>'key') from jsonb_array_elements(v_row.options_snapshot) x)=4,
    'No generó cuatro alternativas únicas.';
  assert v_row.recommended_option='Reducir' and (v_row.evidence_snapshot#>>'{operations,stock_blocked}')::boolean,
    'La recomendación ignoró la verdad operativa.';
  assert v_row.evidence_snapshot#>>'{campaign,id}'=current_setting('momos.test39_campaign')
    and v_row.evidence_snapshot#>>'{product,id}'=current_setting('momos.test39_product'), 'El snapshot cruzó otra campaña o producto.';
  assert (select bool_and(x ? 'projection' and x ? 'assumptions' and x ? 'blockers') from jsonb_array_elements(v_row.options_snapshot) x),
    'Una alternativa perdió rango, supuestos o bloqueos.';
  v_result:=public._crear_escenarios_inversion_meta(jsonb_build_object('scenario_key','test39-scenario-'||pg_backend_pid(),
    'measurement_id',current_setting('momos.test39_measure')::bigint,'horizon_days',7),(select id from public.users where auth_id=current_setting('momos.test39_auth')::uuid),null);
  assert (v_result->>'duplicate')::boolean, 'La misma solicitud no fue idempotente.';
  begin update public.agency_meta_investment_scenarios set evidence_snapshot='{}' where id=v_row.id; exception when others then v_failed:=true; end;
  assert v_failed, 'La evidencia sellada pudo reescribirse.';
end $$;

set local role authenticated;
do $$ declare v_result jsonb; begin
  v_result:=public.resolver_escenarios_inversion_meta(current_setting('momos.test39_scenario')::bigint,'Aprobar',
    'TEST39 comparación humana aprobada como insumo, no como ejecución.');
  assert v_result->>'status'='Aprobado' and not (v_result->>'executed')::boolean and not (v_result->>'published')::boolean
    and not (v_result->>'budget_changed')::boolean and not (v_result->>'audience_changed')::boolean,
    'Aprobar escenarios alteró Meta.';
end $$;

reset role;
do $$ declare v_failed boolean:=false; begin
  begin delete from public.agency_meta_investment_scenarios where id=current_setting('momos.test39_scenario')::bigint; exception when others then v_failed:=true; end;
  assert v_failed, 'Un escenario aprobado pudo eliminarse.';
  assert (select presupuesto from public.campaigns where id=current_setting('momos.test39_campaign'))=current_setting('momos.test39_budget')::numeric,
    'El hito cambió presupuesto.';
  assert (select stock from public.products where id=current_setting('momos.test39_product'))=0, 'El hito inventó stock.';
  assert (select count(*) from public.content_posts)=current_setting('momos.test39_posts')::bigint, 'El hito publicó contenido.';
end $$;

select 'TESTS_OK — Escenarios Meta beneficio/stock/capacidad/lifecycle/4 alternativas/no ejecución/RBAC PASS, rollback total' as resultado;
rollback;
