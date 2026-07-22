-- MOMOS OPS · H108 · Autorización de generación desde preflight.
-- Convierte un H107 aprobado en un único trabajo Autorizado dentro de la cola
-- creativa existente. El worker puede reclamarlo; publicar sigue prohibido.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_107_orquestacion_produccion_formulas') then
    raise exception 'H108 requiere H107 y la cadena operativa 01-107.';
  end if;
  if to_regclass('public.creative_generation_jobs') is null
     or to_regclass('public.agency_formula_production_plans') is null
     or to_regclass('public.agency_brand_profiles') is null
     or to_regclass('public.agency_brand_kits') is null
     or to_regprocedure('public.preparar_trabajo_desde_paquete_produccion(bigint,jsonb)') is null
     or to_regprocedure('public.autorizar_trabajo_creativo(bigint,numeric)') is null
     or to_regprocedure('public._mcp_human_job_fingerprint(bigint)') is null then
    raise exception 'H108 requiere cola creativa, paquetes, marca y huellas canónicas.';
  end if;
end $$;

create table if not exists public.agency_formula_generation_authorizations(
  id bigint generated always as identity primary key,
  authorization_key text not null unique
    check(authorization_key ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  plan_id bigint not null unique
    references public.agency_formula_production_plans(id) on delete restrict,
  job_id bigint not null unique
    references public.creative_generation_jobs(id) on delete restrict,
  provider text not null check(provider in ('Higgsfield','Kling')),
  status text not null default 'Autorizado' check(status='Autorizado'),
  max_cost_cop numeric(16,2) not null check(max_cost_cop>0),
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
  plan_fingerprint text not null check(plan_fingerprint ~ '^[0-9a-f]{64}$'),
  job_fingerprint text not null check(job_fingerprint ~ '^[0-9a-f]{32}$'),
  brand_profile_fingerprint text not null check(brand_profile_fingerprint ~ '^[0-9a-f]{32}$'),
  brand_kit_fingerprint text not null check(brand_kit_fingerprint ~ '^[0-9a-f]{32}$'),
  authorization_snapshot jsonb not null check(jsonb_typeof(authorization_snapshot)='object'),
  authorization_fingerprint text not null check(authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  authorized_by text not null references public.users(id),
  authorized_at timestamptz not null default clock_timestamp()
);
create index if not exists agency_formula_generation_authorizations_recent_idx
  on public.agency_formula_generation_authorizations(authorized_at desc,id desc);

alter table public.agency_formula_generation_authorizations enable row level security;
drop policy if exists no_direct_access on public.agency_formula_generation_authorizations;
create policy no_direct_access on public.agency_formula_generation_authorizations
  for all to authenticated using(false) with check(false);
revoke all on public.agency_formula_generation_authorizations
  from public,anon,authenticated,service_role;
revoke all on sequence public.agency_formula_generation_authorizations_id_seq
  from public,anon,authenticated,service_role;

create or replace function public.autorizacion_generacion_preflight_disponible()
returns boolean language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_formula_generation_authorization_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  raise exception 'La autorización de generación es evidencia inmutable.';
end $$;
drop trigger if exists agency_formula_generation_authorization_guard
  on public.agency_formula_generation_authorizations;
create trigger agency_formula_generation_authorization_guard before update or delete
  on public.agency_formula_generation_authorizations for each row
  execute function public._agency_formula_generation_authorization_guard();

create or replace function public.autorizar_generacion_desde_preflight_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype;
  v_key text:=btrim(coalesce(p->>'authorization_key',''));
  v_plan_id bigint:=nullif(p->>'plan_id','')::bigint;
  v_note text:=btrim(coalesce(p->>'decision_note',''));
  v_ack boolean:=coalesce((p->>'acknowledge_external_generation')::boolean,false);
  v_plan public.agency_formula_production_plans%rowtype;
  v_formula public.agency_creative_formulas%rowtype;
  v_pack public.brand_production_packs%rowtype;
  v_integration public.agency_integrations%rowtype;
  v_settings public.agency_settings%rowtype;
  v_profile public.agency_brand_profiles%rowtype;
  v_kit public.agency_brand_kits%rowtype;
  v_existing public.agency_formula_generation_authorizations%rowtype;
  v_job public.creative_generation_jobs%rowtype;
  v_readiness jsonb;
  v_request jsonb;
  v_request_fp text;
  v_payload jsonb;
  v_job_result jsonb;
  v_auth_result jsonb;
  v_job_id bigint;
  v_job_fp text;
  v_prompt text;
  v_snapshot jsonb;
  v_fp text;
  v_id bigint;
begin
  v_actor:=public._agency_actor();
  if not public.has_current_role('Administrador') then
    raise exception 'Solo Administración puede autorizar consumo externo de generación.';
  end if;
  if p is null or jsonb_typeof(p)<>'object'
     or (select count(*) from jsonb_object_keys(p))<>4
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in(
       'authorization_key','plan_id','decision_note','acknowledge_external_generation'))
     or v_key !~ '^[A-Za-z0-9_.:-]{8,120}$'
     or v_plan_id is null or v_plan_id<=0
     or length(v_note) not between 20 and 600
     or v_note ~ '[\u0000-\u001f\u007f]'
     or v_note ~* '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|sb_secret_|access[_ -]?token|service[_ -]?role|api[_ -]?key|authorization)'
     or regexp_replace(v_note,'[^0-9]','','g') ~ '[0-9]{10,}'
     or not v_ack or public._agency_mesa_has_secret(p) then
    raise exception 'La autorización necesita una clave, una decisión segura y confirmación explícita.';
  end if;

  perform pg_advisory_xact_lock(hashtext('h108:generation:'||v_plan_id::text));
  select * into v_plan from public.agency_formula_production_plans where id=v_plan_id for update;
  if v_plan.id is null or v_plan.status<>'Aprobado' then
    raise exception 'Solo un preflight H107 aprobado puede convertirse en generación.';
  end if;
  v_request:=jsonb_build_object('schema_version','momos-generation-authorization-request/v1',
    'authorization_key',v_key,'plan_id',v_plan.id,'plan_fingerprint',v_plan.preflight_fingerprint,
    'decision_note',v_note,'acknowledge_external_generation',true);
  v_request_fp:=public._agency_creative_intelligence_fingerprint(v_request);

  select * into v_existing from public.agency_formula_generation_authorizations
    where authorization_key=v_key;
  if v_existing.id is not null then
    if v_existing.plan_id<>v_plan.id or v_existing.request_fingerprint<>v_request_fp then
      raise exception 'La clave idempotente ya autorizó otro contrato.';
    end if;
    select * into v_job from public.creative_generation_jobs where id=v_existing.job_id;
    return jsonb_build_object('ok',true,'authorization_id',v_existing.id,
      'plan_id',v_existing.plan_id,'job_id',v_existing.job_id,'status','Autorizado',
      'job_status',v_job.status,
      'duplicate',true,'job_created',true,'job_authorized',true,
      'worker_may_claim',v_job.status='Autorizado','credits_consumed',false,
      'external_generation_authorized',true,'publication_allowed',false);
  end if;
  if exists(select 1 from public.agency_formula_generation_authorizations where plan_id=v_plan.id) then
    raise exception 'Este preflight ya fue autorizado con otra clave; consultá su trabajo existente.';
  end if;

  select * into v_formula from public.agency_creative_formulas where id=v_plan.formula_id;
  select * into v_pack from public.brand_production_packs where id=v_plan.production_pack_id;
  select * into v_integration from public.agency_integrations where provider=v_plan.provider;
  select * into v_settings from public.agency_settings where id;
  select * into v_profile from public.agency_brand_profiles where status='Activo';
  select * into v_kit from public.agency_brand_kits where status='Activo';
  v_readiness:=public.estado_paquete_produccion(v_pack.id);
  if v_formula.id is null or v_formula.status<>'Aprobada'
     or v_formula.formula_fingerprint<>v_plan.formula_fingerprint then
    raise exception 'La fórmula cambió o dejó de estar aprobada.';
  end if;
  if v_pack.id is null or v_pack.status<>'Aprobado' or v_pack.fingerprint<>v_plan.pack_fingerprint
     or not coalesce((v_readiness->>'ready')::boolean,false) then
    raise exception 'El paquete visual cambió o dejó de estar listo.';
  end if;
  if coalesce(v_settings.paused,false) then
    raise exception 'La parada de emergencia de Agencia MOMOS está activa.';
  end if;
  if v_plan.max_cost_cop<=0 or v_plan.max_cost_cop>coalesce(v_settings.campaign_budget_limit,0) then
    raise exception 'El tope autorizado ya no cabe en las guardas de Agencia MOMOS.';
  end if;
  if v_integration.provider is null or v_integration.status<>'Activa'
     or not v_integration.secret_configured or v_integration.last_heartbeat_at is null
     or v_integration.last_heartbeat_at<clock_timestamp()-interval '30 minutes' then
    raise exception 'El conector elegido no está activo, autenticado o saludable.';
  end if;
  if v_profile.id is null or v_profile.profile_fingerprint<>public._agency_brand_fingerprint(v_profile.profile)
     or cardinality(public._agency_brand_profile_errors(v_profile.profile))>0 then
    raise exception 'La identidad verbal y visual vigente perdió integridad.';
  end if;
  if v_kit.id is null or (v_kit.enforcement_enabled and (
       v_kit.brand_profile_id<>v_profile.id
       or v_kit.kit_fingerprint<>public._agency_brand_kit_fingerprint(v_kit.id)
       or cardinality(public._agency_brand_kit_errors(v_kit.id))>0)) then
    raise exception 'El kit oficial de logos, colores y usos perdió integridad.';
  end if;

  v_prompt:=left(concat_ws(E'\n',
    'Objetivo: '||coalesce(nullif(v_formula.objective,''),'crear una pieza MOMOS fiel y apetecible.'),
    'Hook: '||(v_formula.formula_snapshot->>'hook'),
    'Estructura: '||(v_formula.formula_snapshot->>'narrative_structure'),
    'Humanización: '||(v_formula.formula_snapshot->>'humanization'),
    'Prueba visual: '||(v_formula.formula_snapshot->>'proof'),
    'Oferta: '||(v_formula.formula_snapshot->>'offer'),
    'CTA: '||(v_formula.formula_snapshot->>'cta'),
    'Estilo visual: '||(v_formula.formula_snapshot->>'visual_style'),
    'Cámara: '||(v_formula.formula_snapshot->>'camera_pattern'),
    'Conservar producto, proporciones, logo, color y textura de las referencias aprobadas.'),6000);
  v_payload:=jsonb_build_object(
    'creative_id',v_formula.source_creative_id,'provider',v_plan.provider,
    'operation',v_plan.operation,'target_channel',v_plan.channel,
    'target_format',v_plan.target_format,'prompt',v_prompt,
    'negative_prompt','No deformar producto, figura, manos, logo, texto, empaque, luz ni proporciones. Sin marcas ajenas.',
    'output_spec',jsonb_build_object(
      'formula_production_plan_id',v_plan.id,
      'formula_production_plan_fingerprint',v_plan.preflight_fingerprint,
      'creative_formula_id',v_formula.id,'creative_formula_fingerprint',v_formula.formula_fingerprint,
      'model_label',v_plan.model_label,'duration_seconds',v_plan.duration_seconds,
      'output_count',v_plan.output_count,'estimated_cost_cop',v_plan.estimated_cost_cop,
      'authorization_key',v_key,'human_authorized',true,
      'publication_allowed',false));
  v_job_result:=public.preparar_trabajo_desde_paquete_produccion(v_pack.id,v_payload);
  v_job_id:=(v_job_result->>'job_id')::bigint;
  v_auth_result:=public.autorizar_trabajo_creativo(v_job_id,v_plan.max_cost_cop);
  if v_auth_result->>'status'<>'Autorizado' then
    raise exception 'La cola creativa no confirmó la autorización atómica.';
  end if;
  select * into v_job from public.creative_generation_jobs where id=v_job_id;
  v_job_fp:=public._mcp_human_job_fingerprint(v_job.id);
  v_snapshot:=jsonb_build_object(
    'schema_version','momos-generation-authorization/v1',
    'request',v_request,
    'plan',jsonb_build_object('id',v_plan.id,'fingerprint',v_plan.preflight_fingerprint,
      'formula_id',v_formula.id,'formula_fingerprint',v_formula.formula_fingerprint,
      'production_pack_id',v_pack.id,'production_pack_fingerprint',v_pack.fingerprint),
    'job',jsonb_build_object('id',v_job.id,'fingerprint',v_job_fp,'status',v_job.status,
      'provider',v_job.provider,'operation',v_job.operation,'target_channel',v_job.target_channel,
      'target_format',v_job.target_format,'max_cost_cop',v_job.max_cost_cop),
    'brand',jsonb_build_object('profile_fingerprint',v_profile.profile_fingerprint,
      'kit_fingerprint',v_kit.kit_fingerprint,'kit_enforced',v_kit.enforcement_enabled,
      'kit_integrity_required',v_kit.enforcement_enabled),
    'connector',jsonb_build_object('provider',v_integration.provider,'healthy_at_authorization',true),
    'guards',jsonb_build_object('human_authorized',true,'job_created',true,
      'job_authorized',true,'worker_may_claim',true,'credits_consumed_by_authorization',false,
      'external_generation_authorized',true,'publication_allowed',false));
  v_fp:=public._agency_creative_intelligence_fingerprint(v_snapshot);
  insert into public.agency_formula_generation_authorizations(
    authorization_key,plan_id,job_id,provider,max_cost_cop,request_fingerprint,
    plan_fingerprint,job_fingerprint,brand_profile_fingerprint,brand_kit_fingerprint,
    authorization_snapshot,authorization_fingerprint,authorized_by)
  values(v_key,v_plan.id,v_job.id,v_plan.provider,v_plan.max_cost_cop,v_request_fp,
    v_plan.preflight_fingerprint,v_job_fp,v_profile.profile_fingerprint,v_kit.kit_fingerprint,
    v_snapshot,v_fp,v_actor.id) returning id into v_id;
  perform public._add_audit('Autorización generación',v_id::text,'Trabajo autorizado desde H107',
    'Preflight aprobado','Trabajo #'||v_job.id||' · '||v_plan.provider||' · tope COP '||v_plan.max_cost_cop::text);
  return jsonb_build_object('ok',true,'authorization_id',v_id,'plan_id',v_plan.id,
    'job_id',v_job.id,'status','Autorizado','duplicate',false,'job_created',true,
    'job_authorized',true,'worker_may_claim',true,'credits_consumed',false,
    'external_generation_authorized',true,'publication_allowed',false,
    'authorization_fingerprint',v_fp);
end $$;

create or replace function public.momos_generation_authorizations_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb; v_snapshot jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'authorization_key',a.authorization_key,'plan_id',a.plan_id,
    'job_id',a.job_id,'provider',a.provider,'status',a.status,
    'job_status',j.status,'operation',j.operation,'target_channel',j.target_channel,
    'target_format',j.target_format,'max_cost_cop',a.max_cost_cop,
    'plan_fingerprint',a.plan_fingerprint,'job_fingerprint',a.job_fingerprint,
    'authorization_fingerprint',a.authorization_fingerprint,'authorized_at',a.authorized_at,
    'worker_may_claim',j.status='Autorizado','publication_allowed',false)
    order by a.authorized_at desc,a.id desc),'[]'::jsonb)
  into v_rows from public.agency_formula_generation_authorizations a
  join public.creative_generation_jobs j on j.id=a.job_id;
  v_snapshot:=jsonb_build_object('schema_version','momos-generation-authorizations/v1',
    'generated_at',clock_timestamp(),'authorizations',v_rows,
    'summary',jsonb_build_object('authorizations',jsonb_array_length(v_rows),
      'ready_for_worker',(select count(*) from public.agency_formula_generation_authorizations a
        join public.creative_generation_jobs j on j.id=a.job_id where j.status='Autorizado'),
      'in_progress',(select count(*) from public.agency_formula_generation_authorizations a
        join public.creative_generation_jobs j on j.id=a.job_id where j.status='En generación'),
      'completed',(select count(*) from public.agency_formula_generation_authorizations a
        join public.creative_generation_jobs j on j.id=a.job_id where j.status='Completado')),
    'privacy',jsonb_build_object('contains_customer_pii',false,'contains_staff_identity',false,
      'contains_storage_paths',false,'contains_secrets',false,'contains_order_ids',false),
    'human_authorization_required',true,'credits_consumed_by_authorization',false,
    'external_generation_authorized',true,'publication_allowed',false);
  return jsonb_build_object('snapshot',v_snapshot,
    'fingerprint',public._agency_creative_intelligence_fingerprint(v_snapshot));
end $$;

drop trigger if exists momos_agency_snapshot_event_v1
  on public.agency_formula_generation_authorizations;
create trigger momos_agency_snapshot_event_v1 after insert or update or delete or truncate
  on public.agency_formula_generation_authorizations for each statement
  execute function public._momos_touch_agency_snapshot_event_v1();

-- H108 añade una lectura MCP del estado de autorizaciones. No permite decidir.
alter table public.agency_mcp_access_log drop constraint if exists agency_mcp_access_log_tool_name_check;
alter table public.agency_mcp_access_log add constraint agency_mcp_access_log_tool_name_check check(tool_name in (
  'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_intelligence',
  'momos_propose_creative_formula','momos_humanization_community','momos_propose_humanization_series',
  'momos_propose_humanization_episode','momos_visual_library','momos_production_preflight',
  'momos_generation_authorizations','momos_prepare_production_plan','momos_creative_context',
  'momos_search_brand_assets','momos_get_brand_asset_reference','momos_submit_proposals',
  'momos_request_human_approval','momos_get_human_approval'));

create or replace function public.registrar_acceso_mcp_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'request_key','')); v_tool text:=btrim(coalesce(p->>'tool_name',''));
  v_mode text:=btrim(coalesce(p->>'mode','')); v_status text:=btrim(coalesce(p->>'status',''));
  v_worker text:=btrim(coalesce(p->>'worker_id','')); v_subject text:=left(btrim(coalesce(p->>'subject_ref','')),180);
  v_input text:=btrim(coalesce(p->>'input_fingerprint','')); v_output text:=btrim(coalesce(p->>'output_fingerprint',''));
  v_details jsonb:=coalesce(p->'details','{}'::jsonb); v_existing public.agency_mcp_access_log%rowtype; v_id bigint;
begin
  if p is null or jsonb_typeof(p)<>'object' or not public._agency_mcp_json_safe(p) then raise exception 'Registro MCP inválido o con secretos.'; end if;
  if v_key!~'^[A-Za-z0-9:_-]{3,180}$' or v_tool not in (
      'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_intelligence',
      'momos_propose_creative_formula','momos_humanization_community','momos_propose_humanization_series',
      'momos_propose_humanization_episode','momos_visual_library','momos_production_preflight',
      'momos_generation_authorizations','momos_prepare_production_plan','momos_creative_context',
      'momos_search_brand_assets','momos_get_brand_asset_reference','momos_submit_proposals',
      'momos_request_human_approval','momos_get_human_approval')
    or v_mode not in ('Lectura','Propuesta','Referencia','Solicitud') or v_status not in ('OK','Denegado','Fallido')
    or length(v_worker) not between 2 and 120 or v_input!~'^[0-9a-f]{32}$'
    or (v_output<>'' and v_output!~'^[0-9a-f]{32}$') or jsonb_typeof(v_details)<>'object' then
    raise exception 'Contrato de bitácora MCP inválido.';
  end if;
  if (v_tool in ('momos_submit_proposals','momos_propose_creative_formula','momos_propose_humanization_series',
      'momos_propose_humanization_episode','momos_prepare_production_plan') and v_mode<>'Propuesta')
     or (v_tool='momos_get_brand_asset_reference' and v_mode<>'Referencia')
     or (v_tool='momos_request_human_approval' and v_mode<>'Solicitud')
     or (v_tool not in ('momos_submit_proposals','momos_propose_creative_formula','momos_propose_humanization_series',
       'momos_propose_humanization_episode','momos_prepare_production_plan','momos_get_brand_asset_reference',
       'momos_request_human_approval') and v_mode<>'Lectura') then
    raise exception 'El modo no coincide con la herramienta MCP.';
  end if;
  insert into public.agency_mcp_access_log(request_key,tool_name,mode,status,worker_id,subject_ref,input_fingerprint,output_fingerprint,details)
  values(v_key,v_tool,v_mode,v_status,v_worker,v_subject,v_input,nullif(v_output,''),v_details)
  on conflict(request_key) do nothing returning id into v_id;
  if v_id is null then
    select * into v_existing from public.agency_mcp_access_log where request_key=v_key;
    if v_existing.tool_name<>v_tool or v_existing.mode<>v_mode or v_existing.status<>v_status
       or v_existing.worker_id<>v_worker or v_existing.subject_ref<>v_subject
       or v_existing.input_fingerprint<>v_input or coalesce(v_existing.output_fingerprint,'')<>v_output
       or v_existing.details<>v_details then raise exception 'La clave de bitácora MCP ya pertenece a otra operación.'; end if;
    return jsonb_build_object('ok',true,'id',v_existing.id,'duplicate',true);
  end if;
  return jsonb_build_object('ok',true,'id',v_id,'duplicate',false);
end $$;

do $$ declare v_signature text;
begin
  foreach v_signature in array array[
    '_agency_formula_generation_authorization_guard()'
  ] loop
    execute format('revoke all on function public.%s from public,anon,authenticated,service_role',v_signature);
  end loop;
end $$;
revoke all on function public.autorizacion_generacion_preflight_disponible() from public,anon,authenticated,service_role;
revoke all on function public.autorizar_generacion_desde_preflight_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.momos_generation_authorizations_v1() from public,anon,authenticated,service_role;
grant execute on function public.autorizacion_generacion_preflight_disponible() to authenticated,service_role;
grant execute on function public.autorizar_generacion_desde_preflight_v1(jsonb) to authenticated;
grant execute on function public.momos_generation_authorizations_v1() to authenticated,service_role;

comment on function public.autorizar_generacion_desde_preflight_v1(jsonb) is
  'Crea y autoriza atómicamente un trabajo desde H107. Habilita al worker; nunca publica.';

insert into public.momos_ops_migrations(id,detalle)
values('20260722_108_autorizacion_generacion_preflight',
  'Preflight H107 a trabajo creativo autorizado, atómico, idempotente, con marca/costo/conector sellados y publicación bloqueada')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260722_108_autorizacion_generacion_preflight';
