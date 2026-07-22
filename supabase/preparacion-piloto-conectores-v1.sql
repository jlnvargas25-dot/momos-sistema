-- MOMOS OPS · H109 · aislamiento y reanudación controlada de conectores creativos.
-- Sella el proyecto/entorno del runtime, exige una decisión humana para salir
-- de Pausada y conserva generación, créditos y publicación cerrados al preparar.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_108_autorizacion_generacion_preflight') then
    raise exception 'H109 requiere H108 y la cadena operativa 01-108.';
  end if;
  if to_regclass('public.agency_integrations') is null
     or to_regclass('public.creative_connector_runs') is null
     or to_regprocedure('public.reportar_worker_higgsfield(text,text,text,text,boolean)') is null
     or to_regprocedure('public.reportar_worker_kling(text,text,text,text,boolean)') is null then
    raise exception 'H109 requiere los conectores creativos de Higgsfield y Kling.';
  end if;
end $$;

alter table public.agency_integrations
  drop constraint if exists agency_integrations_environment_check;
alter table public.agency_integrations
  add constraint agency_integrations_environment_check
  check(environment in ('Pruebas','Staging','Producción'));

create table if not exists public.agency_connector_runtime_seal(
  singleton boolean primary key default true check(singleton),
  environment text not null check(environment in ('Staging','Produccion')),
  project_ref text not null check(project_ref ~ '^[a-z0-9]{20}$'),
  configuration_fingerprint text not null check(configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  configured_at timestamptz not null default clock_timestamp()
);

create table if not exists public.agency_connector_resume_events(
  id bigint generated always as identity primary key,
  request_key text not null unique check(request_key ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  provider text not null check(provider in ('Higgsfield','Kling')),
  environment text not null check(environment='Staging'),
  reason text not null check(length(reason) between 20 and 500),
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
  jobs_before bigint not null check(jobs_before>=0),
  runs_before bigint not null check(runs_before>=0),
  cost_before_cop numeric not null check(cost_before_cop>=0),
  prepared_by text not null references public.users(id),
  prepared_at timestamptz not null default clock_timestamp()
);
create index if not exists agency_connector_resume_events_recent_idx
  on public.agency_connector_resume_events(prepared_at desc,id desc);

alter table public.agency_connector_runtime_seal enable row level security;
alter table public.agency_connector_resume_events enable row level security;
revoke all on public.agency_connector_runtime_seal
  from public,anon,authenticated,service_role;
revoke all on public.agency_connector_resume_events
  from public,anon,authenticated,service_role;
revoke all on sequence public.agency_connector_resume_events_id_seq
  from public,anon,authenticated,service_role;

create or replace function public.preparacion_piloto_conectores_disponible()
returns boolean language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_connector_immutable_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  raise exception 'El sello y las decisiones de conectores son evidencia inmutable.';
end $$;
revoke all on function public._agency_connector_immutable_guard()
  from public,anon,authenticated,service_role;

drop trigger if exists agency_connector_runtime_seal_immutable
  on public.agency_connector_runtime_seal;
create trigger agency_connector_runtime_seal_immutable before update or delete
  on public.agency_connector_runtime_seal for each row
  execute function public._agency_connector_immutable_guard();
drop trigger if exists agency_connector_resume_events_immutable
  on public.agency_connector_resume_events;
create trigger agency_connector_resume_events_immutable before update or delete
  on public.agency_connector_resume_events for each row
  execute function public._agency_connector_immutable_guard();

create or replace function public._agency_connector_service_only()
returns void language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Solo el runtime privado puede sellar o reportar conectores.' using errcode='42501';
  end if;
end $$;
revoke all on function public._agency_connector_service_only()
  from public,anon,authenticated,service_role;

create or replace function public.configurar_entorno_conectores_v1(p jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
  v_environment text:=btrim(coalesce(p->>'environment',''));
  v_project_ref text:=lower(btrim(coalesce(p->>'project_ref','')));
  v_production_ref text:=lower(btrim(coalesce(p->>'production_project_ref','')));
  v_confirmation text:=coalesce(p->>'confirmation','');
  v_snapshot jsonb; v_fp text; v_existing public.agency_connector_runtime_seal%rowtype;
begin
  perform public._agency_connector_service_only();
  if p is null or jsonb_typeof(p)<>'object'
     or (select count(*) from jsonb_object_keys(p))<>4
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in(
       'environment','project_ref','production_project_ref','confirmation'))
     or v_environment not in ('Staging','Produccion')
     or v_project_ref !~ '^[a-z0-9]{20}$'
     or v_production_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'El sello de runtime no cumple el contrato cerrado.';
  end if;
  if v_environment='Staging' and (
       v_confirmation<>'SELLAR_STAGING_NO_PRODUCCION' or v_project_ref=v_production_ref) then
    raise exception 'Staging exige confirmación explícita y un proyecto distinto de producción.';
  end if;
  if v_environment='Produccion' and (
       v_confirmation<>'SELLAR_PRODUCCION_EXPLICITA' or v_project_ref<>v_production_ref) then
    raise exception 'Producción exige confirmación explícita y coincidencia con su project ref.';
  end if;
  v_snapshot:=jsonb_build_object('schema_version','momos-connector-runtime-seal/v1',
    'environment',v_environment,'project_ref',v_project_ref,
    'production_project_ref',v_production_ref,'confirmation',v_confirmation);
  v_fp:=public._agency_creative_intelligence_fingerprint(v_snapshot);
  select * into v_existing from public.agency_connector_runtime_seal where singleton;
  if v_existing.singleton then
    if v_existing.environment<>v_environment or v_existing.project_ref<>v_project_ref
       or v_existing.configuration_fingerprint<>v_fp then
      raise exception 'El runtime ya fue sellado para otro proyecto o entorno.';
    end if;
    return jsonb_build_object('ok',true,'environment',v_environment,'duplicate',true,
      'project_ref_verified',true,'generation_allowed',false,'publication_allowed',false);
  end if;
  insert into public.agency_connector_runtime_seal(
    singleton,environment,project_ref,configuration_fingerprint)
  values(true,v_environment,v_project_ref,v_fp);
  update public.agency_integrations set
    environment=case when v_environment='Staging' then 'Staging' else 'Producción' end,
    updated_at=clock_timestamp()
  where provider in ('Higgsfield','Kling') and status in ('Por conectar','Configurada','Pausada');
  return jsonb_build_object('ok',true,'environment',v_environment,'duplicate',false,
    'project_ref_verified',true,'generation_allowed',false,'publication_allowed',false);
end $$;

create or replace function public._agency_connector_assert_runtime(
  p_provider text,p_environment text,p_project_ref text
) returns public.agency_integrations language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_seal public.agency_connector_runtime_seal%rowtype;
  v_integration public.agency_integrations%rowtype; v_expected text;
begin
  perform public._agency_connector_service_only();
  select * into v_seal from public.agency_connector_runtime_seal where singleton;
  if not coalesce(v_seal.singleton,false) or v_seal.environment<>p_environment
     or v_seal.project_ref<>lower(btrim(coalesce(p_project_ref,''))) then
    raise exception 'El worker no coincide con el proyecto y entorno sellados.' using errcode='42501';
  end if;
  select * into v_integration from public.agency_integrations where provider=p_provider for update;
  v_expected:=case when p_environment='Staging' then 'Staging' else 'Producción' end;
  if v_integration.provider is null or v_integration.environment<>v_expected then
    raise exception 'La integración no pertenece al entorno sellado.' using errcode='42501';
  end if;
  return v_integration;
end $$;
revoke all on function public._agency_connector_assert_runtime(text,text,text)
  from public,anon,authenticated,service_role;

create or replace function public.reportar_worker_higgsfield_v2(
  p_worker_id text,p_version text,p_status text,p_error text default '',
  p_synced boolean default false,p_environment text default '',p_project_ref text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_integration public.agency_integrations%rowtype;
  v_version text:=left(btrim(coalesce(p_version,'')),80);
begin
  if length(btrim(coalesce(p_worker_id,'')))<3 or v_version=''
     or p_status not in ('Activa','Con error') then
    raise exception 'Reporte Higgsfield H109 inválido.';
  end if;
  v_integration:=public._agency_connector_assert_runtime('Higgsfield',p_environment,p_project_ref);
  if v_integration.status='Pausada' then
    update public.agency_integrations set worker_version=v_version,secret_configured=true,
      last_heartbeat_at=clock_timestamp(),updated_at=clock_timestamp() where provider='Higgsfield';
    return jsonb_build_object('ok',true,'provider','Higgsfield','status','Pausada',
      'environment',p_environment,'project_ref_verified',true);
  end if;
  v_result:=public.reportar_integracion_agencia_conector('Higgsfield',p_status,true,p_error,
    jsonb_build_array('Imagen','Video','Edición'),null,null,p_synced);
  update public.agency_integrations set worker_version=v_version where provider='Higgsfield';
  return v_result||jsonb_build_object('worker_version',v_version,'environment',p_environment,
    'project_ref_verified',true);
end $$;

create or replace function public.reportar_worker_kling_v2(
  p_worker_id text,p_version text,p_status text,p_error text default '',
  p_synced boolean default false,p_environment text default '',p_project_ref text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_integration public.agency_integrations%rowtype;
  v_version text:=left(btrim(coalesce(p_version,'')),80);
begin
  if length(btrim(coalesce(p_worker_id,'')))<3 or v_version=''
     or p_status not in ('Activa','Con error') then
    raise exception 'Reporte Kling H109 inválido.';
  end if;
  v_integration:=public._agency_connector_assert_runtime('Kling',p_environment,p_project_ref);
  if v_integration.status='Pausada' then
    update public.agency_integrations set worker_version=v_version,secret_configured=true,
      last_heartbeat_at=clock_timestamp(),updated_at=clock_timestamp() where provider='Kling';
    return jsonb_build_object('ok',true,'provider','Kling','status','Pausada',
      'environment',p_environment,'project_ref_verified',true);
  end if;
  v_result:=public.reportar_integracion_agencia_conector('Kling',p_status,true,p_error,
    jsonb_build_array('Video','Imagen a video','Audio nativo'),null,null,p_synced);
  update public.agency_integrations set worker_version=v_version where provider='Kling';
  return v_result||jsonb_build_object('worker_version',v_version,'environment',p_environment,
    'project_ref_verified',true);
end $$;

create or replace function public.preparar_reanudacion_integracion_agencia_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_provider text:=btrim(coalesce(p->>'provider',''));
  v_environment text:=btrim(coalesce(p->>'environment',''));
  v_key text:=btrim(coalesce(p->>'request_key',''));
  v_reason text:=btrim(coalesce(p->>'reason',''));
  v_ack text:=coalesce(p->>'acknowledgement',''); v_expected_ack text;
  v_request jsonb; v_fp text; v_existing public.agency_connector_resume_events%rowtype;
  v_integration public.agency_integrations%rowtype; v_runtime public.agency_connector_runtime_seal%rowtype;
  v_jobs bigint; v_runs bigint; v_cost numeric; v_id bigint;
begin
  v_actor:=public._agency_actor();
  if not public.has_current_role('Administrador') then
    raise exception 'Solo Administración puede preparar la reanudación de un conector.';
  end if;
  v_expected_ack:='PREPARAR '||upper(v_provider)||' EN STAGING SIN GENERAR NI PUBLICAR';
  if p is null or jsonb_typeof(p)<>'object'
     or (select count(*) from jsonb_object_keys(p))<>5
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in(
       'request_key','provider','environment','reason','acknowledgement'))
     or v_key !~ '^[A-Za-z0-9_.:-]{8,120}$'
     or v_provider not in ('Higgsfield','Kling') or v_environment<>'Staging'
     or length(v_reason) not between 20 and 500
     or v_reason ~ '[\u0000-\u001f\u007f]'
     or v_reason ~* '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|sb_secret_|access[_ -]?token|service[_ -]?role|api[_ -]?key|authorization)'
     or regexp_replace(v_reason,'[^0-9]','','g') ~ '[0-9]{10,}'
     or v_ack<>v_expected_ack then
    raise exception 'La preparación exige contrato cerrado, motivo seguro y frase exacta.';
  end if;
  v_request:=jsonb_build_object('schema_version','momos-connector-resume-request/v1',
    'request_key',v_key,'provider',v_provider,'environment',v_environment,
    'reason',v_reason,'acknowledgement',v_ack);
  v_fp:=public._agency_creative_intelligence_fingerprint(v_request);
  select * into v_existing from public.agency_connector_resume_events where request_key=v_key;
  if v_existing.id is not null then
    if v_existing.provider<>v_provider or v_existing.request_fingerprint<>v_fp then
      raise exception 'La clave de reanudación ya existe con otro contrato.';
    end if;
    return jsonb_build_object('ok',true,'resume_event_id',v_existing.id,
      'provider',v_provider,'status','Configurada','duplicate',true,
      'jobs_created',false,'credits_consumed',false,'generation_allowed',false,
      'publication_allowed',false,'health_confirmation_required',true);
  end if;
  select * into v_runtime from public.agency_connector_runtime_seal where singleton;
  if not coalesce(v_runtime.singleton,false) or v_runtime.environment<>'Staging' then
    raise exception 'El proyecto no está sellado como Staging.';
  end if;
  perform pg_advisory_xact_lock(hashtext('h109:resume:'||v_provider));
  select * into v_integration from public.agency_integrations where provider=v_provider for update;
  if v_integration.status not in ('Pausada','Configurada')
     or v_integration.environment<>'Staging'
     or not v_integration.secret_configured
     or btrim(coalesce(v_integration.worker_version,''))=''
     or v_integration.last_heartbeat_at is null
     or v_integration.last_heartbeat_at<clock_timestamp()-interval '15 minutes' then
    raise exception 'El conector necesita pausa/configuración, secreto y heartbeat reciente en Staging.';
  end if;
  select count(*) into v_jobs from public.creative_generation_jobs;
  select count(*),coalesce(sum(actual_cost_cop),0) into v_runs,v_cost from public.creative_connector_runs;
  update public.agency_integrations set status='Configurada',last_error='',
    configured_by=v_actor.id,updated_at=clock_timestamp() where provider=v_provider;
  insert into public.agency_connector_resume_events(request_key,provider,environment,reason,
    request_fingerprint,jobs_before,runs_before,cost_before_cop,prepared_by)
  values(v_key,v_provider,v_environment,v_reason,v_fp,v_jobs,v_runs,v_cost,v_actor.id)
  returning id into v_id;
  perform public._add_audit('Integración agencia',v_provider,'Reanudación preparada en Staging',
    'Pausada','Configurada · requiere health-only');
  return jsonb_build_object('ok',true,'resume_event_id',v_id,'provider',v_provider,
    'status','Configurada','duplicate',false,'jobs_created',false,'credits_consumed',false,
    'generation_allowed',false,'publication_allowed',false,'health_confirmation_required',true);
end $$;

create or replace function public.momos_connector_pilot_readiness_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_runtime public.agency_connector_runtime_seal%rowtype; v_connectors jsonb;
  v_resilience boolean;
begin
  if auth.role() is distinct from 'service_role' and public.is_staff() is not true then
    raise exception 'Solo el equipo MOMOS puede consultar la preparación de conectores.' using errcode='42501';
  end if;
  select * into v_runtime from public.agency_connector_runtime_seal where singleton;
  select exists(select 1 from public.operational_resilience_runs where environment='Staging'
    and status='Certificado' and invariant_failures=0
    and completed_at>=clock_timestamp()-interval '30 days') into v_resilience;
  select coalesce(jsonb_agg(jsonb_build_object(
    'provider',i.provider,'status',i.status,'environment',i.environment,
    'environment_matches',coalesce(v_runtime.singleton,false)
      and i.environment=case when v_runtime.environment='Staging' then 'Staging' else 'Producción' end,
    'secret_configured',i.secret_configured,
    'worker_installed',btrim(coalesce(i.worker_version,''))<>'',
    'heartbeat_fresh',i.last_heartbeat_at>=clock_timestamp()-interval '15 minutes',
    'ready_to_prepare',i.status in ('Pausada','Configurada') and i.environment='Staging'
      and i.secret_configured and btrim(coalesce(i.worker_version,''))<>''
      and i.last_heartbeat_at>=clock_timestamp()-interval '15 minutes',
    'generation_allowed',i.status='Activa' and i.secret_configured
      and i.last_heartbeat_at>=clock_timestamp()-interval '30 minutes',
    'publication_allowed',false) order by i.provider),'[]'::jsonb)
  into v_connectors from public.agency_integrations i where i.provider in ('Higgsfield','Kling');
  return jsonb_build_object('schema_version','momos-connector-pilot-readiness/v1',
    'generated_at',clock_timestamp(),
    'runtime',jsonb_build_object('sealed',coalesce(v_runtime.singleton,false),
      'environment',v_runtime.environment,'project_ref_verified',coalesce(v_runtime.singleton,false)),
    'resilience_certified',v_resilience,'connectors',v_connectors,
    'guards',jsonb_build_object('human_resume_required',true,
      'health_confirmation_required',true,'credits_consumed_by_readiness',false,
      'jobs_created_by_readiness',false,'publication_allowed',false),
    'privacy',jsonb_build_object('contains_secrets',false,'contains_project_ref',false,
      'contains_account_ids',false,'contains_raw_errors',false,'contains_pii',false));
end $$;

-- H109 invalida los reportes antiguos: no prueban project ref ni entorno.
revoke execute on function public.reportar_worker_higgsfield(text,text,text,text,boolean) from service_role;
revoke execute on function public.reportar_worker_kling(text,text,text,text,boolean) from service_role;
revoke all on function public.preparacion_piloto_conectores_disponible() from public,anon;
revoke all on function public.configurar_entorno_conectores_v1(jsonb) from public,anon,authenticated;
revoke all on function public.reportar_worker_higgsfield_v2(text,text,text,text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.reportar_worker_kling_v2(text,text,text,text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.preparar_reanudacion_integracion_agencia_v1(jsonb) from public,anon;
revoke all on function public.momos_connector_pilot_readiness_v1() from public,anon;
grant execute on function public.preparacion_piloto_conectores_disponible() to authenticated,service_role;
grant execute on function public.configurar_entorno_conectores_v1(jsonb) to service_role;
grant execute on function public.reportar_worker_higgsfield_v2(text,text,text,text,boolean,text,text) to service_role;
grant execute on function public.reportar_worker_kling_v2(text,text,text,text,boolean,text,text) to service_role;
grant execute on function public.preparar_reanudacion_integracion_agencia_v1(jsonb) to authenticated;
grant execute on function public.momos_connector_pilot_readiness_v1() to authenticated,service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260722_109_preparacion_piloto_conectores',
  'Project ref y entorno sellados, reportes v2, reanudación humana en staging y lectura compacta sin créditos ni publicación')
on conflict(id) do update set detalle=excluded.detalle;

notify pgrst, 'reload schema';
commit;
