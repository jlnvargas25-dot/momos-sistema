-- MOMOS OPS · H109 · aislamiento y reanudación de conectores. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h109_connector_pilot'));

do $$
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260722_109_preparacion_piloto_conectores'),
    'H109 requiere aplicar preparacion-piloto-conectores-v1.sql.';
  assert public.preparacion_piloto_conectores_disponible()
    and to_regprocedure('public.configurar_entorno_conectores_v1(jsonb)') is not null
    and to_regprocedure('public.preparar_reanudacion_integracion_agencia_v1(jsonb)') is not null
    and to_regprocedure('public.reportar_worker_higgsfield_v2(text,text,text,text,boolean,text,text)') is not null
    and to_regprocedure('public.momos_connector_pilot_readiness_v1()') is not null,
    'H109 no instaló el contrato completo.';
  assert not has_table_privilege('authenticated','public.agency_connector_runtime_seal','SELECT'),
    'H109 expuso el sello a authenticated.';
  assert not has_table_privilege('service_role','public.agency_connector_runtime_seal','SELECT'),
    'H109 expuso el sello a service_role.';
  assert not has_table_privilege('authenticated','public.agency_connector_resume_events','SELECT'),
    'H109 expuso decisiones a authenticated.';
  assert not has_table_privilege('service_role','public.agency_connector_resume_events','SELECT'),
    'H109 expuso decisiones a service_role.';
  assert has_function_privilege('service_role','public.configurar_entorno_conectores_v1(jsonb)','EXECUTE'),
    'H109 no concedió el sello al runtime privado.';
  assert not has_function_privilege('authenticated','public.configurar_entorno_conectores_v1(jsonb)','EXECUTE'),
    'H109 permitió que authenticated selle el runtime.';
  assert has_function_privilege('authenticated','public.preparar_reanudacion_integracion_agencia_v1(jsonb)','EXECUTE'),
    'H109 no concedió la decisión humana a authenticated.';
  assert not has_function_privilege('service_role','public.preparar_reanudacion_integracion_agencia_v1(jsonb)','EXECUTE'),
    'H109 permitió que service_role fabrique la decisión humana.';
  assert not has_function_privilege('service_role','public.reportar_worker_higgsfield(text,text,text,text,boolean)','EXECUTE'),
    'H109 dejó habilitado el reporte Higgsfield sin entorno.';
end $$;

create temporary table h109_context(
  admin_id text,auth_id uuid,jobs_before bigint,runs_before bigint,cost_before numeric,
  resume_event_id bigint
) on commit drop;
grant select,update on h109_context to authenticated,service_role;

do $$
declare v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where activo and auth_id is not null
    and 'Administrador'=any(coalesce(roles,array[rol])) order by id limit 1;
  assert v_actor.id is not null,'H109 necesita un Administrador activo.';
  insert into h109_context values(v_actor.id,v_actor.auth_id,
    (select count(*) from public.creative_generation_jobs),
    (select count(*) from public.creative_connector_runs),
    (select coalesce(sum(actual_cost_cop),0) from public.creative_connector_runs),null);
end $$;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare v_failed boolean:=false; v_result jsonb;
begin
  begin
    perform public.configurar_entorno_conectores_v1(jsonb_build_object(
      'environment','Staging','project_ref','mxrsmuqyesolkxoqvggl',
      'production_project_ref','mxrsmuqyesolkxoqvggl','confirmation','SELLAR_STAGING_NO_PRODUCCION'));
  exception when others then v_failed:=true; end;
  assert v_failed,'H109 aceptó que staging y producción fueran el mismo proyecto.';
  v_result:=public.configurar_entorno_conectores_v1(jsonb_build_object(
    'environment','Staging','project_ref','mxrsmuqyesolkxoqvggl',
    'production_project_ref','csojbqpvujymesuvntxb','confirmation','SELLAR_STAGING_NO_PRODUCCION'));
  assert (v_result->>'ok')::boolean and v_result->>'environment'='Staging'
    and (v_result->>'project_ref_verified')::boolean
    and not (v_result->>'generation_allowed')::boolean
    and not (v_result->>'publication_allowed')::boolean,
    'H109 no selló staging con permisos cerrados.';
  v_result:=public.configurar_entorno_conectores_v1(jsonb_build_object(
    'environment','Staging','project_ref','mxrsmuqyesolkxoqvggl',
    'production_project_ref','csojbqpvujymesuvntxb','confirmation','SELLAR_STAGING_NO_PRODUCCION'));
  assert (v_result->>'duplicate')::boolean,'H109 no es idempotente al repetir el sello exacto.';
end $$;

reset role;
update public.agency_integrations set status='Pausada',environment='Staging',
  secret_configured=true,worker_version='momos-higgsfield-worker/test-h109',
  last_heartbeat_at=clock_timestamp()-interval '16 minutes',last_error='Prueba H109'
where provider='Higgsfield';
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select auth_id::text from h109_context),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_failed boolean:=false; v_payload jsonb;
begin
  v_payload:=jsonb_build_object('request_key','h109-resume-'||pg_backend_pid(),
    'provider','Higgsfield','environment','Staging',
    'reason','Reanudar únicamente el chequeo aislado del conector creativo.',
    'acknowledgement','PREPARAR HIGGSFIELD EN STAGING SIN GENERAR NI PUBLICAR');
  begin perform public.preparar_reanudacion_integracion_agencia_v1(v_payload);
  exception when others then v_failed:=true; end;
  assert v_failed,'H109 preparó un worker con heartbeat vencido.';
  v_failed:=false;
  begin perform public.preparar_reanudacion_integracion_agencia_v1(
    jsonb_set(v_payload,'{acknowledgement}','"confirmo"'::jsonb));
  exception when others then v_failed:=true; end;
  assert v_failed,'H109 aceptó una frase humana inexacta.';
end $$;

reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare v_failed boolean:=false; v_result jsonb;
begin
  begin
    perform public.reportar_worker_higgsfield_v2('h109-worker','momos-higgsfield-worker/test-h109',
      'Activa','',false,'Staging','csojbqpvujymesuvntxb');
  exception when others then v_failed:=true; end;
  assert v_failed,'H109 aceptó un heartbeat proveniente de otro project ref.';
  v_result:=public.reportar_worker_higgsfield_v2('h109-worker','momos-higgsfield-worker/test-h109',
    'Activa','',false,'Staging','mxrsmuqyesolkxoqvggl');
  assert v_result->>'status'='Pausada' and (v_result->>'project_ref_verified')::boolean,
    'H109 permitió que el health-only levantara una pausa por sí mismo.';
end $$;

reset role;
set local role authenticated;
do $$
declare v_payload jsonb; v_result jsonb; v_duplicate jsonb; v_id bigint;
begin
  v_payload:=jsonb_build_object('request_key','h109-resume-'||pg_backend_pid(),
    'provider','Higgsfield','environment','Staging',
    'reason','Reanudar únicamente el chequeo aislado del conector creativo.',
    'acknowledgement','PREPARAR HIGGSFIELD EN STAGING SIN GENERAR NI PUBLICAR');
  v_result:=public.preparar_reanudacion_integracion_agencia_v1(v_payload);
  v_id:=(v_result->>'resume_event_id')::bigint;
  assert v_id is not null and v_result->>'status'='Configurada'
    and not (v_result->>'jobs_created')::boolean
    and not (v_result->>'credits_consumed')::boolean
    and not (v_result->>'generation_allowed')::boolean
    and not (v_result->>'publication_allowed')::boolean
    and (v_result->>'health_confirmation_required')::boolean,
    'H109 confundió preparación con ejecución o publicación.';
  v_duplicate:=public.preparar_reanudacion_integracion_agencia_v1(v_payload);
  assert (v_duplicate->>'duplicate')::boolean
    and (v_duplicate->>'resume_event_id')::bigint=v_id,
    'H109 duplicó una decisión durante el replay exacto.';
  update h109_context set resume_event_id=v_id;
end $$;

reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare v_result jsonb; v_snapshot jsonb;
begin
  v_result:=public.reportar_worker_higgsfield_v2('h109-worker','momos-higgsfield-worker/test-h109',
    'Activa','',true,'Staging','mxrsmuqyesolkxoqvggl');
  assert v_result->>'status'='Activa' and (v_result->>'project_ref_verified')::boolean,
    'H109 no permitió que el health-only confirmara la preparación.';
  v_snapshot:=public.momos_connector_pilot_readiness_v1();
  assert v_snapshot->>'schema_version'='momos-connector-pilot-readiness/v1'
    and (v_snapshot#>>'{runtime,sealed}')::boolean
    and v_snapshot#>>'{runtime,environment}'='Staging'
    and not (v_snapshot#>>'{guards,credits_consumed_by_readiness}')::boolean
    and not (v_snapshot#>>'{guards,jobs_created_by_readiness}')::boolean
    and not (v_snapshot#>>'{guards,publication_allowed}')::boolean
    and not (v_snapshot#>>'{privacy,contains_project_ref}')::boolean
    and v_snapshot::text !~* 'mxrsmuqyesolkxoqvggl|csojbqpvujymesuvntxb|access[_-]?token|service[_-]?role|last_error|external_account_id',
    'H109 expuso project refs, secretos, cuentas o amplió permisos.';
end $$;

reset role;
do $$
declare v_failed boolean:=false;
begin
  assert (select count(*) from public.creative_generation_jobs)=(select jobs_before from h109_context)
    and (select count(*) from public.creative_connector_runs)=(select runs_before from h109_context)
    and (select coalesce(sum(actual_cost_cop),0) from public.creative_connector_runs)=(select cost_before from h109_context),
    'H109 creó trabajos, ejecuciones o costos durante configuración/readiness.';
  begin update public.agency_connector_resume_events set reason='reescritura prohibida'
    where id=(select resume_event_id from h109_context);
  exception when others then v_failed:=true; end;
  assert v_failed,'H109 permitió reescribir la decisión humana.';
end $$;

select 'TESTS_OK — H109 project-ref/entorno/RBAC/pausa/preparación humana/health-only/no trabajo/no crédito/no publicación/privacidad PASS, rollback total' as resultado;
rollback;
