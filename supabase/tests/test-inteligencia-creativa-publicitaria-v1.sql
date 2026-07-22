-- MOMOS OPS · H103 · inteligencia creativa publicitaria. Siempre ROLLBACK.
-- No publica, no pauta, no cambia presupuesto y no conserva fixtures.

begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h103_creative_intelligence'));

create temporary table h103_context(
  admin_id text not null,
  auth_id uuid not null,
  campaign_id text not null,
  creative_id text not null,
  creative_version_id bigint not null,
  formula_id bigint,
  measurement_id bigint
) on commit drop;
grant select,update on table h103_context to authenticated,anon;

do $$
declare
  v_actor public.users%rowtype;
  v_suffix text:=pg_backend_pid()::text;
  v_campaign text:='CMP-H103-'||v_suffix;
  v_creative text:='CRE-H103-'||v_suffix;
  v_version bigint;
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_103_inteligencia_creativa_publicitaria'),
    'H103 requiere aplicar inteligencia-creativa-publicitaria-v1.sql.';
  assert to_regclass('public.agency_creative_formulas') is not null
    and to_regclass('public.agency_creative_formula_measurements') is not null
    and to_regprocedure('public.proponer_formula_creativa_v1(jsonb)') is not null
    and to_regprocedure('public.proponer_formula_creativa_agente_v1(jsonb)') is not null
    and to_regprocedure('public.revisar_formula_creativa_v1(bigint,text,text)') is not null
    and to_regprocedure('public.medir_formula_creativa_v1(jsonb)') is not null
    and to_regprocedure('public.resolver_medicion_formula_creativa_v1(bigint,text,text)') is not null
    and to_regprocedure('public.momos_creative_intelligence_v1()') is not null,
    'H103 no instaló el contrato completo.';
  assert exists(select 1 from pg_trigger
      where tgrelid='public.agency_creative_formulas'::regclass
        and tgname='momos_agency_snapshot_event_v1' and not tgisinternal)
    and exists(select 1 from pg_trigger
      where tgrelid='public.agency_creative_formula_measurements'::regclass
        and tgname='momos_agency_snapshot_event_v1' and not tgisinternal),
    'H103 no despierta el cursor sanitario de Agencia.';
  assert not has_table_privilege('authenticated','public.agency_creative_formulas','SELECT')
    and not has_table_privilege('authenticated','public.agency_creative_formula_measurements','SELECT')
    and not has_table_privilege('service_role','public.agency_creative_formulas','SELECT')
    and has_function_privilege('authenticated','public.proponer_formula_creativa_v1(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.proponer_formula_creativa_agente_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.proponer_formula_creativa_agente_v1(jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.momos_creative_intelligence_v1()','EXECUTE')
    and not has_function_privilege('anon','public.momos_creative_intelligence_v1()','EXECUTE'),
    'H103 perdió aislamiento o RBAC.';

  select * into v_actor from public.users
  where activo and auth_id is not null
    and ('Administrador'=any(coalesce(roles,array[rol]))
      or 'Marketing/CRM'=any(coalesce(roles,array[rol])))
  order by case when 'Administrador'=any(coalesce(roles,array[rol])) then 0 else 1 end,id
  limit 1;
  assert v_actor.id is not null,'H103 necesita un actor de Agencia autenticado.';

  insert into public.campaigns(id,nombre,canal,objetivo,presupuesto,estado,
    external_platform,external_id)
  values(v_campaign,'H103 fórmula controlada','Instagram','Ventas',50000,
    'Planeada','meta','meta-h103-'||v_suffix);
  insert into public.creatives(id,campaign_id,titulo,canal,formato,estado,external_id)
  values(v_creative,v_campaign,'H103 creativo fuente','Instagram','Anuncio',
    'Aprobado','ad-h103-'||v_suffix);
  insert into public.agency_creative_versions(
    creative_id,version,provider,prompt,negative_prompt,brand_snapshot,
    asset_url,status,created_by)
  values(v_creative,1,'manual','Fixture H103 sin PII','',
    '{"brand":"MOMOS","approved":true}'::jsonb,
    'https://example.invalid/h103.mp4','Aprobada',v_actor.id)
  returning id into v_version;
  insert into public.metrics_daily(fecha,fuente,campaign_id,creative_id,
    impresiones,alcance,clicks,mensajes_wa,gasto,notas)
  values(current_date,'mcp-meta',v_campaign,v_creative,1200,900,80,12,10000,'H103 fixture');
  insert into h103_context values(v_actor.id,v_actor.auth_id,v_campaign,
    v_creative,v_version,null,null);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h103_context),'role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare
  v_payload jsonb;
  v_result jsonb;
  v_formula bigint;
  v_measure bigint;
  v_failed boolean:=false;
  v_snapshot jsonb;
begin
  v_payload:=jsonb_build_object(
    'proposal_key','h103-proposal-'||pg_backend_pid(),
    'formula_key','dulce-antojo-ugc',
    'name','Dulce antojo UGC con producto real',
    'mode','Pauta',
    'source_creative_id',(select creative_id from h103_context),
    'source_creative_version_id',(select creative_version_id from h103_context),
    'retention_script_id',null,
    'formula_snapshot',jsonb_build_object(
      'hook','Un dulce antojo aparece en el primer segundo',
      'narrative_structure','Bolsa, personaje, mirada, cámara y cucharada',
      'humanization','Manos reales y reacción contenida',
      'proof','Producto y textura visibles en una toma continua',
      'offer','Sin oferta inventada',
      'cta','Descubrir el sabor disponible',
      'visual_style','UGC cálido y cercano',
      'camera_pattern','Handheld contenido, lente natural sin fisheye'));

  begin
    perform public.proponer_formula_creativa_v1(v_payload||jsonb_build_object(
      'customer_phone','3000000000'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H103 aceptó campos abiertos o PII en una fórmula.';

  v_result:=public.proponer_formula_creativa_v1(v_payload);
  v_formula:=(v_result->>'formula_id')::bigint;
  assert v_formula is not null and v_result->>'status'='Propuesta'
    and (v_result->>'human_approval_required')::boolean
    and not (v_result->>'external_execution')::boolean,
    'H103 no dejó la fórmula como propuesta humana y sin ejecución.';
  assert (public.proponer_formula_creativa_v1(v_payload)->>'duplicate')::boolean,
    'H103 duplicó la propuesta durante un replay exacto.';
  v_failed:=false;
  begin
    perform public.proponer_formula_creativa_v1(jsonb_set(
      v_payload,'{name}',to_jsonb('Otra fórmula bajo la misma llave'::text)));
  exception when others then v_failed:=true; end;
  assert v_failed,'H103 aceptó una colisión idempotente.';

  perform public.revisar_formula_creativa_v1(v_formula,'En revisión',
    'La fórmula entra a revisión de marca y evidencia.');
  v_result:=public.revisar_formula_creativa_v1(v_formula,'Aprobada',
    'Identidad, producto, estructura y uso de cámara fueron verificados.');
  assert v_result->>'status'='Aprobada'
    and not (v_result->>'external_execution')::boolean,
    'H103 confundió aprobación de fórmula con ejecución externa.';

  v_result:=public.medir_formula_creativa_v1(jsonb_build_object(
    'measurement_key','h103-measurement-'||pg_backend_pid(),
    'formula_id',v_formula,'platform','Meta',
    'window_start',current_date,'window_end',current_date));
  v_measure:=(v_result->>'measurement_id')::bigint;
  assert v_measure is not null and v_result->>'outcome'='En revisión'
    and (v_result->>'human_decision_required')::boolean
    and not (v_result->>'external_execution')::boolean,
    'H103 permitió que una medición decidiera o ejecutara por sí sola.';
  assert (v_result#>>'{metrics,spend}')::numeric=10000
    and (v_result#>>'{metrics,internal_revenue}')::numeric=0
    and (v_result#>>'{metrics,internal_roas}')::numeric=0
    and v_result#>>'{metrics,platform_roas}' is null
    and v_result#>>'{metrics,attribution_status}'='Sin señal de plataforma',
    'H103 mezcló gasto, verdad interna o ROAS de plataforma ausente.';
  assert (public.medir_formula_creativa_v1(jsonb_build_object(
    'measurement_key','h103-measurement-'||pg_backend_pid(),
    'formula_id',v_formula,'platform','Meta',
    'window_start',current_date,'window_end',current_date))->>'duplicate')::boolean,
    'H103 duplicó una medición durante replay.';

  v_failed:=false;
  begin
    perform public.resolver_medicion_formula_creativa_v1(v_measure,'Ganadora',
      'Intento inválido sin pedidos pagados ni retorno interno suficiente.');
  exception when others then v_failed:=true; end;
  assert v_failed,'H103 fabricó una ganadora sin ventas pagadas.';
  v_result:=public.resolver_medicion_formula_creativa_v1(v_measure,'Inconclusa',
    'La muestra tiene gasto, pero todavía no produjo pedidos pagados atribuibles.');
  assert v_result->>'outcome'='Inconclusa'
    and not (v_result->>'external_execution')::boolean,
    'H103 no selló una decisión humana inconclusa.';

  v_snapshot:=public.momos_creative_intelligence_v1();
  assert length(v_snapshot->>'fingerprint')=64
    and v_snapshot#>>'{snapshot,schema_version}'='momos-creative-intelligence/v1'
    and not (v_snapshot#>>'{snapshot,external_execution_allowed}')::boolean
    and (v_snapshot#>>'{snapshot,human_approval_required}')::boolean
    and not (v_snapshot#>>'{snapshot,metric_definitions,attribution_is_causality}')::boolean
    and not (v_snapshot#>>'{snapshot,privacy,contains_customer_pii}')::boolean
    and v_snapshot::text !~* 'customer_phone|"order_id"|access[_-]?token|service[_-]?role',
    'H103 perdió huella, privacidad o separación atribución/causalidad.';
  update h103_context set formula_id=v_formula,measurement_id=v_measure;
end $$;

reset role;

do $$
declare v_failed boolean:=false;
begin
  begin
    update public.agency_creative_formulas
    set formula_snapshot='{}'::jsonb
    where id=(select formula_id from h103_context);
  exception when others then v_failed:=true; end;
  assert v_failed,'H103 permitió reescribir una fórmula aprobada.';
  v_failed:=false;
  begin
    update public.agency_creative_formula_measurements
    set internal_revenue=999999999
    where id=(select measurement_id from h103_context);
  exception when others then v_failed:=true; end;
  assert v_failed,'H103 permitió falsificar la verdad comercial de una medición.';
  v_failed:=false;
  begin
    update public.agency_creative_formula_measurements
    set outcome='Ganadora'
    where id=(select measurement_id from h103_context);
  exception when others then v_failed:=true; end;
  assert v_failed,'H103 permitió reabrir o cambiar una decisión terminal.';
end $$;

select 'TESTS_OK — H103 fórmulas/versiones/Meta-TikTok/ROAS separados/decisión humana/PII/RBAC PASS, rollback total'
  as resultado;
rollback;
