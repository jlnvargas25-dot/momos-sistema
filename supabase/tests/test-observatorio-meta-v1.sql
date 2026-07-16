-- MOMOS OPS · prueba adversarial del Observatorio Meta. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260716_37_observatorio_meta'), 'Falta aplicar la migración 37.';
  assert public.observatorio_meta_disponible(), 'Falta la sonda del Observatorio Meta.';
  assert to_regclass('public.agency_meta_policies') is not null and to_regclass('public.agency_meta_signal_snapshots') is not null
    and to_regclass('public.agency_meta_diagnostics') is not null, 'Faltan tablas del Observatorio Meta.';
  assert has_function_privilege('authenticated','public.preparar_diagnostico_meta(bigint,text)','EXECUTE'), 'Falta diagnóstico humano.';
  assert has_function_privilege('authenticated','public.resolver_diagnostico_meta(bigint,text,text)','EXECUTE'), 'Falta revisión humana del diagnóstico.';
  assert not has_function_privilege('authenticated','public.registrar_snapshot_meta_conector(jsonb)','EXECUTE'), 'El navegador suplanta al conector Meta.';
  assert not has_function_privilege('authenticated','public.proponer_diagnostico_meta_agente(bigint,text)','EXECUTE'), 'El navegador suplanta al cerebro Meta.';
  assert has_function_privilege('service_role','public.registrar_snapshot_meta_conector(jsonb)','EXECUTE'), 'El conector privado no puede registrar señales.';
  assert has_function_privilege('service_role','public.obtener_contexto_meta_agente()','EXECUTE'), 'El cerebro privado no puede leer contexto Meta.';
  assert not has_table_privilege('authenticated','public.agency_meta_signal_snapshots','INSERT'), 'El navegador inserta señales directas.';
  assert not has_table_privilege('authenticated','public.agency_meta_signal_snapshots','UPDATE'), 'El navegador reescribe señales.';
  assert not has_table_privilege('authenticated','public.agency_meta_diagnostics','UPDATE'), 'El navegador aprueba diagnósticos directo.';
end $$;

do $$
declare v_actor public.users%rowtype; v_suffix text:=pg_backend_pid()::text; v_campaign text:='CMP-T37-'||v_suffix;
  v_creative text:='CRE-T37-'||v_suffix; v_product text; v_posts bigint; v_metrics bigint; v_budget numeric;
begin
  select * into v_actor from public.users where activo and auth_id is not null and public.valid_user_roles(roles,rol)
    and 'Administrador'=any(roles) order by id limit 1;
  assert v_actor.id is not null, 'Falta actor Administrador para la prueba.';
  select id into v_product from public.products where activo order by id limit 1;
  assert v_product is not null, 'Falta producto activo para la prueba.';
  insert into public.campaigns(id,nombre,canal,objetivo,producto_foco_id,presupuesto,estado,external_platform,external_id)
  values(v_campaign,'TEST37 Meta','Instagram','Ventas',v_product,98765,'Planeada','meta','2385'||v_suffix);
  insert into public.creatives(id,campaign_id,titulo,canal,formato,producto_foco_id,estado,external_id)
  values(v_creative,v_campaign,'TEST37 creativo','Instagram','Anuncio',v_product,'Aprobado','ad-'||v_suffix);
  select count(*) into v_posts from public.content_posts; select count(*) into v_metrics from public.metrics_daily;
  select presupuesto into v_budget from public.campaigns where id=v_campaign;
  perform set_config('momos.test37_auth',v_actor.auth_id::text,true); perform set_config('momos.test37_campaign',v_campaign,true);
  perform set_config('momos.test37_creative',v_creative,true); perform set_config('momos.test37_product',v_product,true);
  perform set_config('momos.test37_posts',v_posts::text,true); perform set_config('momos.test37_metrics',v_metrics::text,true);
  perform set_config('momos.test37_budget',v_budget::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.test37_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$ declare v_failed boolean:=false; v_result jsonb; begin
  begin perform public.registrar_snapshot_meta_conector('{}'::jsonb); exception when insufficient_privilege then v_failed:=true; end;
  assert v_failed, 'Una cuenta autenticada suplantó al conector Meta.';
  v_result:=public.crear_politica_meta(jsonb_build_object('policy_key','test37-policy-'||pg_backend_pid(),'source_label','TEST37 política versionada',
    'market','Cali, Colombia','currency','COP','effective_from',current_date,'targets',jsonb_build_object('roas',2.8,'cost_per_conversation',12000,'cost_per_lead',18000),
    'thresholds',jsonb_build_object('ctr_min_pct',1.5,'landing_rate_min_pct',60,'checkout_purchase_min_pct',30,'video_3s_min_pct',20,'frequency_high',5,'pixel_drop_pct',20,'pixel_floor',50,'minimum_impressions',100)));
  assert (v_result->>'version')::int>=2 and not (v_result->>'executed')::boolean and not (v_result->>'published')::boolean and not (v_result->>'spend_changed')::boolean,
    'Versionar política ejecutó pauta.';
end $$;

reset role;
do $$
declare v_payload jsonb; v_result jsonb; v_snapshot bigint; v_failed boolean:=false; v_stored public.agency_meta_signal_snapshots%rowtype;
begin
  v_payload:=jsonb_build_object('snapshot_key','test37-snapshot-'||pg_backend_pid(),'account_external_id','act_test37','account_label','MOMOS TEST',
    'entity_type','Campaña','entity_external_id','2385-test','objective','Ventas','currency','COP','timezone','America/Bogota',
    'window_start','2026-07-01T00:00:00-05:00','window_end','2026-07-08T00:00:00-05:00','source_captured_at','2026-07-08T01:00:00-05:00',
    'local_campaign_id',current_setting('momos.test37_campaign'),'local_creative_id',current_setting('momos.test37_creative'),
    'metrics',jsonb_build_object('spend',100000,'impressions',10000,'reach',7000,'frequency',1.43,'clicks',180,'outboundClicks',150,
      'landingViews',75,'contentViews',60,'addsToCart',20,'checkouts',10,'purchases',2,'purchaseValue',210000,'video3s',1500),
    'pixel_events',jsonb_build_array(jsonb_build_object('name','Purchase','previous',100,'current',65,'emq',7.2),jsonb_build_object('name','Lead','previous',10,'current',1,'emq',3)),
    'catalog_products',jsonb_build_array(jsonb_build_object('product_external_id','meta-product-test37','local_product_id',current_setting('momos.test37_product'),'name','Producto TEST37','spend',40000)),
    'local_truth',jsonb_build_object('paid_revenue',999999999),'connector_name','meta-mcp-test37');
  begin perform public.registrar_snapshot_meta_conector(jsonb_set(v_payload,'{metrics,spend}','-1'::jsonb)); exception when others then v_failed:=true; end;
  assert v_failed, 'El conector aceptó gasto negativo.';
  v_failed:=false;
  begin perform public.registrar_snapshot_meta_conector(jsonb_set(v_payload,'{source_captured_at}',to_jsonb('2026-07-07T23:00:00-05:00'::text))); exception when others then v_failed:=true; end;
  assert v_failed, 'El conector aceptó una captura anterior al cierre de la ventana.';
  v_result:=public.registrar_snapshot_meta_conector(v_payload); v_snapshot:=(v_result->>'snapshot_id')::bigint;
  assert v_snapshot is not null and not (v_result->>'published')::boolean and not (v_result->>'spend_changed')::boolean, 'Registrar señales cambió pauta.';
  select * into v_stored from public.agency_meta_signal_snapshots where id=v_snapshot;
  assert (v_stored.local_truth->>'paid_revenue')::numeric<>999999999, 'El conector pudo falsificar ingresos MOMOS.';
  assert v_stored.catalog_products#>>'{0,momos_truth,source}'='MOMOS OPS', 'El catálogo no fue enriquecido con verdad local.';
  assert (public.registrar_snapshot_meta_conector(v_payload)->>'duplicate')::boolean, 'El snapshot idempotente se duplicó.';
  v_failed:=false;
  begin perform public.registrar_snapshot_meta_conector(jsonb_set(v_payload,'{metrics,spend}','100001'::jsonb)); exception when others then v_failed:=true; end;
  assert v_failed, 'La misma clave idempotente aceptó otro contenido.';
  perform set_config('momos.test37_snapshot',v_snapshot::text,true);
end $$;

set local role authenticated;
do $$
declare v_result jsonb; v_diagnostic bigint; v_diag public.agency_meta_diagnostics%rowtype; v_failed boolean:=false;
begin
  begin perform public.proponer_diagnostico_meta_agente(current_setting('momos.test37_snapshot')::bigint,'falso'); exception when insufficient_privilege then v_failed:=true; end;
  assert v_failed, 'Una cuenta autenticada suplantó al cerebro Meta.';
  v_result:=public.preparar_diagnostico_meta(current_setting('momos.test37_snapshot')::bigint,'Diagnóstico determinístico para revisión humana.');
  v_diagnostic:=(v_result->>'diagnostic_id')::bigint; select * into v_diag from public.agency_meta_diagnostics where id=v_diagnostic;
  assert v_diag.id is not null and v_diag.status='En revisión' and not (v_result->>'executed')::boolean and not (v_result->>'published')::boolean
    and not (v_result->>'spend_changed')::boolean, 'Preparar diagnóstico ejecutó cambios externos.';
  assert (v_diag.evidence_snapshot->>'attribution_is_not_causality')::boolean, 'El diagnóstico confundió atribución con causalidad.';
  assert exists(select 1 from jsonb_array_elements(v_diag.evidence_snapshot->'pixel_health') e where e->>'name'='Purchase' and (e->>'alert')::boolean), 'No detectó caída del evento con muestra.';
  assert exists(select 1 from jsonb_array_elements(v_diag.evidence_snapshot->'pixel_health') e where e->>'name'='Lead' and not (e->>'alert')::boolean and (e->>'low_volume')::boolean), 'Alertó ruido de bajo volumen.';
  assert not exists(select 1 from jsonb_array_elements(v_diag.recommended_actions) a where coalesce((a->>'changes_external_state')::boolean,true)), 'Una recomendación ejecuta cambios externos.';
  v_result:=public.resolver_diagnostico_meta(v_diagnostic,'Aprobar','Revisé hechos, atribución, píxel y acciones; no autorizo cambios de pauta.');
  assert v_result->>'status'='Aprobado' and not (v_result->>'executed')::boolean and not (v_result->>'published')::boolean and not (v_result->>'spend_changed')::boolean,
    'Aprobar diagnóstico modificó pauta.';
  perform set_config('momos.test37_diagnostic',v_diagnostic::text,true);
end $$;

reset role;
do $$ declare v_failed boolean:=false; begin
  begin update public.agency_meta_signal_snapshots set metrics='{}'::jsonb where id=current_setting('momos.test37_snapshot')::bigint; exception when others then v_failed:=true; end;
  assert v_failed, 'Un snapshot Meta pudo reescribirse.';
  v_failed:=false; begin update public.agency_meta_diagnostics set what_happened='{}'::jsonb where id=current_setting('momos.test37_diagnostic')::bigint; exception when others then v_failed:=true; end;
  assert v_failed, 'Los hechos de un diagnóstico aprobado pudieron reescribirse.';
  assert (select presupuesto from public.campaigns where id=current_setting('momos.test37_campaign'))=current_setting('momos.test37_budget')::numeric, 'El hito cambió presupuesto de campaña.';
  assert (select count(*) from public.content_posts)=current_setting('momos.test37_posts')::bigint, 'El hito publicó contenido.';
  assert (select count(*) from public.metrics_daily)=current_setting('momos.test37_metrics')::bigint, 'El hito alteró métricas legacy.';
end $$;

select 'TESTS_OK — Observatorio Meta snapshots/3Q/píxel/catálogo/atribución/no pauta/RBAC PASS, rollback total' as resultado;
rollback;
