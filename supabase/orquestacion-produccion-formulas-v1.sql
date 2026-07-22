-- MOMOS OPS · H107 · Orquestación de producción desde fórmulas aprobadas
-- Une memoria creativa y biblioteca visual en un preflight sellado.
-- Este hito NO crea trabajos, NO consume créditos y NO publica.
begin;

do $$
begin
  if to_regclass('public.agency_creative_formulas') is null
     or to_regclass('public.brand_production_packs') is null
     or to_regclass('public.brand_production_pack_assets') is null
     or to_regclass('public.agency_integrations') is null
     or to_regclass('public.agency_mcp_access_log') is null
     or to_regprocedure('public.estado_paquete_produccion(bigint)') is null
     or to_regprocedure('public._agency_creative_intelligence_fingerprint(jsonb)') is null
     or not exists(select 1 from public.momos_ops_migrations where id='20260722_103_inteligencia_creativa_publicitaria')
     or not exists(select 1 from public.momos_ops_migrations where id='20260722_106_biblioteca_visual_ampliada') then
    raise exception 'H107 requiere H61, H103 y H106 aplicados.';
  end if;
end $$;

create table if not exists public.agency_formula_production_plans(
  id bigint generated always as identity primary key,
  plan_key text not null unique check(plan_key ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  formula_id bigint not null references public.agency_creative_formulas(id) on delete restrict,
  production_pack_id bigint not null references public.brand_production_packs(id) on delete restrict,
  version integer not null check(version>0),
  status text not null default 'Preparado'
    check(status in ('Preparado','En revisión','Aprobado','Rechazado','Sustituido')),
  provider text not null check(provider in ('Higgsfield','Kling')),
  operation text not null check(operation in ('Generar imagen','Generar video','Editar')),
  model_label text not null check(length(btrim(model_label)) between 2 and 120),
  channel text not null check(length(btrim(channel)) between 2 and 80),
  target_format text not null check(length(btrim(target_format)) between 2 and 80),
  duration_seconds numeric(8,2) not null check(duration_seconds>=0 and duration_seconds<=120),
  output_count integer not null check(output_count between 1 and 4),
  estimated_cost_cop numeric(16,2) not null check(estimated_cost_cop>0),
  max_cost_cop numeric(16,2) not null check(max_cost_cop>=estimated_cost_cop),
  formula_fingerprint text not null check(formula_fingerprint ~ '^[0-9a-f]{64}$'),
  pack_fingerprint text not null check(pack_fingerprint ~ '^[0-9a-f]{32}$'),
  preflight_snapshot jsonb not null check(jsonb_typeof(preflight_snapshot)='object'),
  preflight_fingerprint text not null check(preflight_fingerprint ~ '^[0-9a-f]{64}$'),
  source_kind text not null check(source_kind in ('Humano','Agente')),
  prepared_by text references public.users(id),
  prepared_by_agent text not null default '',
  prepared_at timestamptz not null default clock_timestamp(),
  reviewed_by text references public.users(id),
  reviewed_at timestamptz,
  review_note text not null default '',
  unique(formula_id,production_pack_id,version),
  check((operation='Generar imagen' and duration_seconds=0)
    or (operation in ('Generar video','Editar') and duration_seconds>0)),
  check((source_kind='Humano' and prepared_by is not null and prepared_by_agent='')
    or (source_kind='Agente' and prepared_by is null
      and length(btrim(prepared_by_agent)) between 3 and 100)),
  check((status in ('Preparado','En revisión') and reviewed_at is null)
    or (status in ('Aprobado','Rechazado','Sustituido') and reviewed_at is not null))
);
create index if not exists agency_formula_production_plans_status_idx
  on public.agency_formula_production_plans(status,prepared_at desc,id desc);
create index if not exists agency_formula_production_plans_formula_idx
  on public.agency_formula_production_plans(formula_id,version desc);
create unique index if not exists agency_formula_production_one_approved_idx
  on public.agency_formula_production_plans(formula_id) where status='Aprobado';

alter table public.agency_formula_production_plans enable row level security;
revoke all on public.agency_formula_production_plans from public,anon,authenticated,service_role;
revoke all on sequence public.agency_formula_production_plans_id_seq from public,anon,authenticated,service_role;

create or replace function public.orquestacion_produccion_formulas_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_formula_production_plan_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    raise exception 'El preflight de producción es evidencia inmutable.';
  end if;
  if new.plan_key is distinct from old.plan_key
     or new.formula_id is distinct from old.formula_id
     or new.production_pack_id is distinct from old.production_pack_id
     or new.version is distinct from old.version
     or new.provider is distinct from old.provider
     or new.operation is distinct from old.operation
     or new.model_label is distinct from old.model_label
     or new.channel is distinct from old.channel
     or new.target_format is distinct from old.target_format
     or new.duration_seconds is distinct from old.duration_seconds
     or new.output_count is distinct from old.output_count
     or new.estimated_cost_cop is distinct from old.estimated_cost_cop
     or new.max_cost_cop is distinct from old.max_cost_cop
     or new.formula_fingerprint is distinct from old.formula_fingerprint
     or new.pack_fingerprint is distinct from old.pack_fingerprint
     or new.preflight_snapshot is distinct from old.preflight_snapshot
     or new.preflight_fingerprint is distinct from old.preflight_fingerprint
     or new.source_kind is distinct from old.source_kind
     or new.prepared_by is distinct from old.prepared_by
     or new.prepared_by_agent is distinct from old.prepared_by_agent
     or new.prepared_at is distinct from old.prepared_at then
    raise exception 'El contrato del preflight está sellado; prepará una versión nueva.';
  end if;
  if old.status='Aprobado' and new.status='Sustituido'
     and row(new.reviewed_by,new.reviewed_at,new.review_note)
       is not distinct from row(old.reviewed_by,old.reviewed_at,old.review_note) then
    return new;
  end if;
  if old.status in ('Aprobado','Rechazado','Sustituido')
     and row(new.status,new.reviewed_by,new.reviewed_at,new.review_note)
       is distinct from row(old.status,old.reviewed_by,old.reviewed_at,old.review_note) then
    raise exception 'La revisión terminal del preflight está sellada.';
  end if;
  return new;
end $$;
drop trigger if exists agency_formula_production_plan_guard on public.agency_formula_production_plans;
create trigger agency_formula_production_plan_guard before update or delete
  on public.agency_formula_production_plans for each row
  execute function public._agency_formula_production_plan_guard();

create or replace function public._agency_formula_production_preflight(
  p jsonb,p_actor text,p_agent text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'plan_key',''));
  v_formula_id bigint:=nullif(p->>'formula_id','')::bigint;
  v_pack_id bigint:=nullif(p->>'production_pack_id','')::bigint;
  v_provider text:=btrim(coalesce(p->>'provider',''));
  v_operation text:=btrim(coalesce(p->>'operation',''));
  v_model text:=btrim(coalesce(p->>'model_label',''));
  v_duration numeric:=coalesce(nullif(p->>'duration_seconds','')::numeric,0);
  v_outputs integer:=coalesce(nullif(p->>'output_count','')::integer,1);
  v_est numeric:=coalesce(nullif(p->>'estimated_cost_cop','')::numeric,0);
  v_cap numeric:=coalesce(nullif(p->>'max_cost_cop','')::numeric,0);
  v_formula public.agency_creative_formulas%rowtype;
  v_pack public.brand_production_packs%rowtype;
  v_integration public.agency_integrations%rowtype;
  v_existing public.agency_formula_production_plans%rowtype;
  v_readiness jsonb;
  v_assets jsonb;
  v_roles jsonb;
  v_snapshot jsonb;
  v_fp text;
  v_capability text;
  v_version integer;
  v_id bigint;
  v_budget numeric;
  v_source text:=case when p_actor is null then 'Agente' else 'Humano' end;
begin
  if p is null or jsonb_typeof(p)<>'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in(
       'plan_key','formula_id','production_pack_id','provider','operation',
       'model_label','duration_seconds','output_count','estimated_cost_cop','max_cost_cop'))
     or v_key !~ '^[A-Za-z0-9_.:-]{8,120}$'
     or v_provider not in ('Higgsfield','Kling')
     or v_operation not in ('Generar imagen','Generar video','Editar')
     or length(v_model) not between 2 and 120
     or v_duration<0 or v_duration>120
     or (v_operation='Generar imagen' and v_duration<>0)
     or (v_operation in ('Generar video','Editar') and v_duration<=0)
     or v_outputs not between 1 and 4
     or v_est<=0 or v_cap<v_est
     or public._agency_mesa_has_secret(p) then
    raise exception 'El preflight no cumple el contrato cerrado de motor, duración o costo.';
  end if;

  select * into v_formula from public.agency_creative_formulas where id=v_formula_id;
  if v_formula.id is null or v_formula.status<>'Aprobada' then
    raise exception 'Elegí una fórmula creativa aprobada.';
  end if;
  select * into v_pack from public.brand_production_packs where id=v_pack_id;
  if v_pack.id is null or v_pack.status<>'Aprobado' then
    raise exception 'Elegí un paquete visual aprobado.';
  end if;
  v_readiness:=public.estado_paquete_produccion(v_pack.id);
  if not coalesce((v_readiness->>'ready')::boolean,false) then
    raise exception 'El paquete visual dejó de estar listo: %',coalesce(v_readiness#>>'{reasons,0}','revisá sus activos.');
  end if;
  if v_formula.product_id is not null and v_pack.product_id is not null
     and v_formula.product_id<>v_pack.product_id then
    raise exception 'La fórmula y el paquete pertenecen a productos diferentes.';
  end if;
  if v_formula.figure<>'' and v_pack.figure<>'' and lower(v_formula.figure)<>lower(v_pack.figure) then
    raise exception 'La figura de la fórmula no coincide con la del paquete.';
  end if;
  if lower(v_formula.channel)<>lower(v_pack.channel) then
    raise exception 'El canal de la fórmula no coincide con el paquete.';
  end if;

  select * into v_integration from public.agency_integrations where provider=v_provider;
  v_capability:=case v_operation when 'Generar imagen' then 'Imagen'
    when 'Generar video' then 'Video' else 'Edición' end;
  if v_integration.provider is null or not(v_integration.capabilities @> jsonb_build_array(v_capability)) then
    raise exception 'El conector no declara la capacidad requerida.';
  end if;
  select campaign_budget_limit into v_budget from public.agency_settings where id;
  if v_cap>coalesce(v_budget,0) then
    raise exception 'El costo máximo supera la guarda vigente de Agencia MOMOS.';
  end if;

  select coalesce(jsonb_agg(x.asset_id order by x.sequence,x.asset_id),'[]'::jsonb),
         coalesce(jsonb_agg(x.role order by x.sequence,x.asset_id),'[]'::jsonb)
    into v_assets,v_roles
  from (select distinct on(m.asset_id) m.asset_id,m.role,m.sequence
        from public.brand_production_pack_assets m where m.pack_id=v_pack.id
        order by m.asset_id,m.sequence) x;

  v_snapshot:=jsonb_build_object(
    'schema_version','momos-formula-production-preflight/v1',
    'formula',jsonb_build_object('id',v_formula.id,'key',v_formula.formula_key,
      'version',v_formula.version,'mode',v_formula.mode,'channel',v_formula.channel,
      'product_id',v_formula.product_id,'figure',v_formula.figure,'flavor',v_formula.flavor,
      'fingerprint',v_formula.formula_fingerprint),
    'production_pack',jsonb_build_object('id',v_pack.id,'version',v_pack.version,
      'channel',v_pack.channel,'target_format',v_pack.target_format,
      'product_id',v_pack.product_id,'figure',v_pack.figure,'fingerprint',v_pack.fingerprint,
      'member_count',coalesce((v_readiness->>'member_count')::integer,0),
      'asset_ids',v_assets,'roles',v_roles),
    'routing',jsonb_build_object('provider',v_provider,'operation',v_operation,
      'model_label',v_model,'duration_seconds',v_duration,'output_count',v_outputs,
      'estimated_cost_cop',v_est,'max_cost_cop',v_cap,
      'connector_status',v_integration.status,
      'connector_ready',v_integration.status='Activa' and v_integration.secret_configured),
    'guards',jsonb_build_object('formula_approved',true,'pack_approved',true,
      'pack_ready',true,'human_approval_required',true,'credits_consumed',false,
      'job_created',false,'external_execution_allowed',false,'publication_allowed',false));
  v_fp:=public._agency_creative_intelligence_fingerprint(v_snapshot);

  select * into v_existing from public.agency_formula_production_plans where plan_key=v_key;
  if v_existing.id is not null then
    if v_existing.preflight_fingerprint<>v_fp then
      raise exception 'La clave idempotente ya pertenece a otro preflight.';
    end if;
    return jsonb_build_object('ok',true,'plan_id',v_existing.id,'version',v_existing.version,
      'status',v_existing.status,'duplicate',true,'credits_consumed',false,
      'job_created',false,'external_execution',false,'publication_allowed',false);
  end if;

  perform pg_advisory_xact_lock(hashtext('agency_formula_production:'||v_formula.id::text));
  select coalesce(max(version),0)+1 into v_version
    from public.agency_formula_production_plans where formula_id=v_formula.id and production_pack_id=v_pack.id;
  update public.agency_formula_production_plans
     set status='Sustituido',reviewed_at=clock_timestamp(),review_note='Sustituido antes de aprobación.'
   where formula_id=v_formula.id and status='Preparado';
  insert into public.agency_formula_production_plans(
    plan_key,formula_id,production_pack_id,version,provider,operation,model_label,
    channel,target_format,duration_seconds,output_count,estimated_cost_cop,max_cost_cop,
    formula_fingerprint,pack_fingerprint,preflight_snapshot,preflight_fingerprint,
    source_kind,prepared_by,prepared_by_agent)
  values(v_key,v_formula.id,v_pack.id,v_version,v_provider,v_operation,v_model,
    v_pack.channel,v_pack.target_format,v_duration,v_outputs,v_est,v_cap,
    v_formula.formula_fingerprint,v_pack.fingerprint,v_snapshot,v_fp,
    v_source,p_actor,coalesce(p_agent,'')) returning id into v_id;
  perform public._add_audit('Preflight creativo',v_id::text,'Preflight preparado','',
    v_provider||' · '||v_operation||' · tope COP '||v_cap::text);
  return jsonb_build_object('ok',true,'plan_id',v_id,'version',v_version,
    'status','Preparado','duplicate',false,'connector_ready',
    v_integration.status='Activa' and v_integration.secret_configured,
    'human_approval_required',true,'credits_consumed',false,'job_created',false,
    'external_execution',false,'publication_allowed',false);
end $$;

create or replace function public.preparar_plan_produccion_formula_v1(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  v_actor:=public._agency_actor();
  return public._agency_formula_production_preflight(p,v_actor.id,null);
end $$;

create or replace function public.preparar_plan_produccion_formula_agente_v1(p jsonb) returns jsonb
language sql security definer set search_path=public as $$
  select public._agency_formula_production_preflight(p,null,'Codex · MOMOS Agency MCP')
$$;

create or replace function public.revisar_plan_produccion_formula_v1(
  p_plan_id bigint,p_status text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype;
  v_plan public.agency_formula_production_plans%rowtype;
  v_formula public.agency_creative_formulas%rowtype;
  v_pack public.brand_production_packs%rowtype;
  v_readiness jsonb;
  v_note text:=btrim(coalesce(p_note,''));
  v_valid boolean;
begin
  v_actor:=public._agency_actor();
  select * into v_plan from public.agency_formula_production_plans where id=p_plan_id for update;
  if v_plan.id is null then raise exception 'El preflight no existe.'; end if;
  v_valid:=(v_plan.status='Preparado' and p_status in ('En revisión','Rechazado'))
    or (v_plan.status='En revisión' and p_status in ('Aprobado','Rechazado'));
  if not v_valid or length(v_note) not between 10 and 600 then
    raise exception 'La revisión del preflight es inválida o no documenta el criterio.';
  end if;
  if p_status='Aprobado' then
    if not public.has_current_role('Administrador') then
      raise exception 'Solo Administración puede aprobar el preflight de producción.';
    end if;
    select * into v_formula from public.agency_creative_formulas where id=v_plan.formula_id;
    select * into v_pack from public.brand_production_packs where id=v_plan.production_pack_id;
    v_readiness:=public.estado_paquete_produccion(v_pack.id);
    if v_formula.status<>'Aprobada' or v_formula.formula_fingerprint<>v_plan.formula_fingerprint then
      raise exception 'La fórmula cambió o dejó de estar aprobada; prepará otro preflight.';
    end if;
    if v_pack.status<>'Aprobado' or v_pack.fingerprint<>v_plan.pack_fingerprint
       or not coalesce((v_readiness->>'ready')::boolean,false) then
      raise exception 'El paquete cambió o dejó de estar listo; prepará otro preflight.';
    end if;
    update public.agency_formula_production_plans
       set status='Sustituido'
     where formula_id=v_plan.formula_id and status='Aprobado' and id<>v_plan.id;
  end if;
  update public.agency_formula_production_plans set status=p_status,
    reviewed_by=case when p_status in ('Aprobado','Rechazado') then v_actor.id end,
    reviewed_at=case when p_status in ('Aprobado','Rechazado') then clock_timestamp() end,
    review_note=case when p_status in ('Aprobado','Rechazado') then v_note else '' end
  where id=v_plan.id;
  perform public._add_audit('Preflight creativo',v_plan.id::text,'Revisión humana',v_plan.status,p_status);
  return jsonb_build_object('ok',true,'plan_id',v_plan.id,'status',p_status,
    'credits_consumed',false,'job_created',false,'external_execution',false,
    'publication_allowed',false);
end $$;

create or replace function public.momos_production_preflight_v1() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_plans jsonb; v_snapshot jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'plan_key',p.plan_key,'formula_id',p.formula_id,
    'production_pack_id',p.production_pack_id,'version',p.version,'status',p.status,
    'provider',p.provider,'operation',p.operation,'model_label',p.model_label,
    'channel',p.channel,'target_format',p.target_format,'duration_seconds',p.duration_seconds,
    'output_count',p.output_count,'estimated_cost_cop',p.estimated_cost_cop,
    'max_cost_cop',p.max_cost_cop,'formula_fingerprint',p.formula_fingerprint,
    'pack_fingerprint',p.pack_fingerprint,'preflight_fingerprint',p.preflight_fingerprint,
    'preflight',p.preflight_snapshot,'source_kind',p.source_kind,
    'prepared_at',p.prepared_at,'reviewed_at',p.reviewed_at)
    order by p.prepared_at desc,p.id desc),'[]'::jsonb)
  into v_plans from (select * from public.agency_formula_production_plans
    order by prepared_at desc,id desc limit 100) p;
  v_snapshot:=jsonb_build_object(
    'schema_version','momos-production-preflight/v1','generated_at',clock_timestamp(),
    'plans',v_plans,'summary',jsonb_build_object(
      'plans',jsonb_array_length(v_plans),
      'prepared',(select count(*) from public.agency_formula_production_plans where status='Preparado'),
      'pending_review',(select count(*) from public.agency_formula_production_plans where status='En revisión'),
      'approved',(select count(*) from public.agency_formula_production_plans where status='Aprobado')),
    'privacy',jsonb_build_object('contains_customer_pii',false,'contains_staff_identity',false,
      'contains_storage_paths',false,'contains_secrets',false,'contains_order_ids',false),
    'human_approval_required',true,'credits_consumed',false,'jobs_created',false,
    'external_execution_allowed',false,'publication_allowed',false);
  return jsonb_build_object('snapshot',v_snapshot,
    'fingerprint',public._agency_creative_intelligence_fingerprint(v_snapshot));
end $$;

-- Un único cursor sanitario para la nueva evidencia; no expone filas.
drop trigger if exists momos_agency_snapshot_event_v1 on public.agency_formula_production_plans;
create trigger momos_agency_snapshot_event_v1
  after insert or update or delete or truncate on public.agency_formula_production_plans
  for each statement execute function public._momos_touch_agency_snapshot_event_v1();

-- H107 amplía la bitácora MCP sin relajar modos ni privacidad.
alter table public.agency_mcp_access_log drop constraint if exists agency_mcp_access_log_tool_name_check;
alter table public.agency_mcp_access_log add constraint agency_mcp_access_log_tool_name_check check(tool_name in (
  'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_intelligence',
  'momos_propose_creative_formula','momos_humanization_community','momos_propose_humanization_series',
  'momos_propose_humanization_episode','momos_visual_library','momos_production_preflight',
  'momos_prepare_production_plan','momos_creative_context','momos_search_brand_assets',
  'momos_get_brand_asset_reference','momos_submit_proposals','momos_request_human_approval',
  'momos_get_human_approval'));

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
      'momos_prepare_production_plan','momos_creative_context','momos_search_brand_assets',
      'momos_get_brand_asset_reference','momos_submit_proposals','momos_request_human_approval','momos_get_human_approval')
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
  values(v_key,v_tool,v_mode,v_status,v_worker,v_subject,v_input,v_output,v_details)
  on conflict(request_key) do nothing returning id into v_id;
  if v_id is null then
    select * into v_existing from public.agency_mcp_access_log where request_key=v_key;
    if v_existing.tool_name<>v_tool or v_existing.mode<>v_mode or v_existing.status<>v_status
       or v_existing.worker_id<>v_worker or v_existing.subject_ref<>v_subject
       or v_existing.input_fingerprint<>v_input or v_existing.output_fingerprint<>v_output
       or v_existing.details<>v_details then raise exception 'La clave MCP ya fue usada con otro contrato.'; end if;
    return jsonb_build_object('ok',true,'id',v_existing.id,'duplicate',true);
  end if;
  return jsonb_build_object('ok',true,'id',v_id,'duplicate',false);
end $$;

do $$ declare v_signature text;
begin
  foreach v_signature in array array[
    '_agency_formula_production_plan_guard()',
    '_agency_formula_production_preflight(jsonb,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public,anon,authenticated,service_role',v_signature);
  end loop;
end $$;
revoke all on function public.orquestacion_produccion_formulas_disponible() from public,anon,authenticated,service_role;
revoke all on function public.preparar_plan_produccion_formula_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.preparar_plan_produccion_formula_agente_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.revisar_plan_produccion_formula_v1(bigint,text,text) from public,anon,authenticated,service_role;
revoke all on function public.momos_production_preflight_v1() from public,anon,authenticated,service_role;
grant execute on function public.orquestacion_produccion_formulas_disponible() to authenticated,service_role;
grant execute on function public.preparar_plan_produccion_formula_v1(jsonb) to authenticated;
grant execute on function public.revisar_plan_produccion_formula_v1(bigint,text,text) to authenticated;
grant execute on function public.preparar_plan_produccion_formula_agente_v1(jsonb) to service_role;
grant execute on function public.momos_production_preflight_v1() to authenticated,service_role;

comment on function public.momos_production_preflight_v1() is
  'Preflight seguro fórmula + paquete visual; nunca crea trabajos, consume créditos, publica o pauta.';

insert into public.momos_ops_migrations(id,detalle)
values('20260722_107_orquestacion_produccion_formulas',
  'Fórmula aprobada + paquete visual aprobado en preflight sellado, costo acotado, revisión humana y MCP sin ejecución')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260722_107_orquestacion_produccion_formulas';
