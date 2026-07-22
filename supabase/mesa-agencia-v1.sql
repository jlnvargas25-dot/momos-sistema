-- MOMOS OPS · Mesa cooperativa de Agencia v1.
-- Paso 30. El humano y el agente deliberan sobre hechos sellados antes de
-- crear un contrato creativo. Aprobar el contrato no ejecuta ni publica.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_29_distribucion_conectores'
  ) then raise exception 'Falta el paso 29_distribucion_conectores.'; end if;
end $$;

create table if not exists public.agency_collaboration_rooms(
  id bigint generated always as identity primary key,
  room_key text not null unique check(room_key ~ '^[A-Za-z0-9:_-]{3,180}$'),
  title text not null check(length(btrim(title)) between 3 and 180),
  objective text not null check(length(btrim(objective)) between 3 and 1200),
  status text not null default 'Abierta' check(status in ('Abierta','Contrato listo','Cerrada','Cancelada')),
  brief_id bigint references public.agency_briefs(id) on delete restrict,
  decision_id bigint references public.agency_decisions(id) on delete restrict,
  context_snapshot jsonb not null check(jsonb_typeof(context_snapshot)='object'),
  context_fingerprint text not null check(context_fingerprint ~ '^[0-9a-f]{32}$'),
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(brief_id is not null or decision_id is not null)
);
create index if not exists agency_collaboration_rooms_status_idx on public.agency_collaboration_rooms(status,updated_at desc);

create table if not exists public.agency_collaboration_entries(
  id bigint generated always as identity primary key,
  room_id bigint not null references public.agency_collaboration_rooms(id) on delete restrict,
  entry_key text not null unique check(entry_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  author_kind text not null check(author_kind in ('Humano','Agente','Sistema')),
  entry_type text not null check(entry_type in ('Aporte','Pregunta','Propuesta','Objeción','Respuesta','Decisión')),
  body text not null check(length(btrim(body)) between 2 and 4000),
  payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
  payload_fingerprint text not null check(payload_fingerprint ~ '^[0-9a-f]{32}$'),
  created_by text references public.users(id), agent_name text not null default '',
  created_at timestamptz not null default now(),
  check((author_kind='Humano' and created_by is not null and agent_name='')
     or (author_kind='Agente' and created_by is null and length(btrim(agent_name)) between 2 and 100)
     or (author_kind='Sistema' and created_by is null))
);
create index if not exists agency_collaboration_entries_room_idx on public.agency_collaboration_entries(room_id,created_at);

create table if not exists public.agency_creative_contracts(
  id bigint generated always as identity primary key,
  contract_key text not null unique check(contract_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  room_id bigint not null references public.agency_collaboration_rooms(id) on delete restrict,
  version integer not null check(version>0),
  status text not null default 'En revisión' check(status in ('En revisión','Aprobado','Sustituido','Anulado')),
  sealed_payload jsonb not null check(jsonb_typeof(sealed_payload)='object'),
  contract_fingerprint text not null check(contract_fingerprint ~ '^[0-9a-f]{32}$'),
  prepared_by text not null references public.users(id), prepared_at timestamptz not null default now(),
  approved_by text references public.users(id), approved_at timestamptz,
  approval_note text not null default '', approval_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(approval_snapshot)='object'),
  unique(room_id,version), unique(room_id,contract_fingerprint)
);
create index if not exists agency_creative_contracts_status_idx on public.agency_creative_contracts(status,prepared_at desc);

alter table public.agency_collaboration_rooms enable row level security;
alter table public.agency_collaboration_entries enable row level security;
alter table public.agency_creative_contracts enable row level security;
drop policy if exists staff_read on public.agency_collaboration_rooms;
drop policy if exists staff_read on public.agency_collaboration_entries;
drop policy if exists staff_read on public.agency_creative_contracts;
create policy staff_read on public.agency_collaboration_rooms for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_collaboration_entries for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_creative_contracts for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.agency_collaboration_rooms,public.agency_collaboration_entries,public.agency_creative_contracts from anon,authenticated;
grant select on public.agency_collaboration_rooms,public.agency_collaboration_entries,public.agency_creative_contracts to authenticated;

create or replace function public.mesa_agencia_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_mesa_fingerprint(p jsonb) returns text
language sql immutable security definer set search_path=public as $$ select md5(p::text) $$;

create or replace function public._agency_mesa_has_secret(p jsonb) returns boolean
language sql immutable security definer set search_path=public as $$
  select coalesce(p::text ~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:',false)
$$;

create or replace function public._agency_room_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.room_key is distinct from old.room_key or new.title is distinct from old.title
     or new.objective is distinct from old.objective or new.brief_id is distinct from old.brief_id
     or new.decision_id is distinct from old.decision_id or new.context_snapshot is distinct from old.context_snapshot
     or new.context_fingerprint is distinct from old.context_fingerprint or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Los hechos y el origen de la mesa no se pueden reescribir.';
  end if;
  return new;
end $$;
drop trigger if exists agency_collaboration_rooms_immutable on public.agency_collaboration_rooms;
create trigger agency_collaboration_rooms_immutable before update on public.agency_collaboration_rooms
for each row execute function public._agency_room_immutable();

create or replace function public._agency_entry_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  raise exception 'Los aportes de la mesa son inmutables; agregá una nueva respuesta.';
end $$;
drop trigger if exists agency_collaboration_entries_immutable on public.agency_collaboration_entries;
create trigger agency_collaboration_entries_immutable before update or delete on public.agency_collaboration_entries
for each row execute function public._agency_entry_immutable();

create or replace function public._agency_contract_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.contract_key is distinct from old.contract_key or new.room_id is distinct from old.room_id
     or new.version is distinct from old.version or new.sealed_payload is distinct from old.sealed_payload
     or new.contract_fingerprint is distinct from old.contract_fingerprint or new.prepared_by is distinct from old.prepared_by
     or new.prepared_at is distinct from old.prepared_at then
    raise exception 'El contenido sellado del contrato creativo no se puede reescribir.';
  end if;
  return new;
end $$;
drop trigger if exists agency_creative_contracts_immutable on public.agency_creative_contracts;
create trigger agency_creative_contracts_immutable before update on public.agency_creative_contracts
for each row execute function public._agency_contract_immutable();

create or replace function public.abrir_mesa_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_brief public.agency_briefs%rowtype; v_decision public.agency_decisions%rowtype;
  v_product public.products%rowtype; v_settings public.agency_settings%rowtype; v_proposal public.agency_agent_proposals%rowtype;
  v_brand jsonb:='{}'::jsonb; v_context jsonb; v_room public.agency_collaboration_rooms%rowtype;
  v_key text:=btrim(coalesce(p->>'room_key','')); v_title text:=btrim(coalesce(p->>'title',''));
  v_objective text:=btrim(coalesce(p->>'objective','')); v_brief_id bigint:=nullif(p->>'brief_id','')::bigint;
  v_decision_id bigint:=nullif(p->>'decision_id','')::bigint; v_product_id text; v_proposal_id bigint;
begin
  v_actor:=public._agency_actor();
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) then raise exception 'La mesa contiene datos inválidos o secretos.'; end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,180}$' or length(v_title) not between 3 and 180 or length(v_objective) not between 3 and 1200 then
    raise exception 'Clave, título u objetivo de mesa inválido.';
  end if;
  if v_brief_id is null and v_decision_id is null then raise exception 'La mesa necesita un brief o una decisión trazable.'; end if;
  if v_brief_id is not null then select * into v_brief from public.agency_briefs where id=v_brief_id; end if;
  if v_decision_id is not null then select * into v_decision from public.agency_decisions where id=v_decision_id; end if;
  if v_brief_id is not null and v_brief.id is null then raise exception 'El brief de la mesa no existe.'; end if;
  if v_decision_id is not null and v_decision.id is null then raise exception 'La decisión de la mesa no existe.'; end if;
  v_product_id:=coalesce(v_brief.product_id,nullif(v_decision.proposed_action->>'product_id',''));
  if v_product_id is not null then select * into v_product from public.products where id=v_product_id; end if;
  select * into v_settings from public.agency_settings where id;
  select jsonb_build_object('frases',frases,'tono',tono,'palabras_si',palabras_si,'palabras_no',palabras_no)
    into v_brand from public.brand_library where id;
  v_context:=jsonb_strip_nulls(jsonb_build_object(
    'schema_version',1,'captured_at',now(),'objective',v_objective,
    'brief',case when v_brief.id is null then null else jsonb_build_object('id',v_brief.id,'title',v_brief.title,'objective',v_brief.objective,
      'status',v_brief.status,'channel',v_brief.channel,'crm_segment',v_brief.crm_segment,'offer',v_brief.offer,
      'approved_budget',v_brief.approved_budget,'proposed_budget',v_brief.proposed_budget,'stock_snapshot',v_brief.stock_snapshot,'evidence',v_brief.evidence) end,
    'decision',case when v_decision.id is null then null else jsonb_build_object('id',v_decision.id,'type',v_decision.type,'title',v_decision.title,
      'status',v_decision.status,'rationale',v_decision.rationale,'evidence',v_decision.evidence,'proposed_action',v_decision.proposed_action,'risk_level',v_decision.risk_level) end,
    'product',case when v_product.id is null then null else jsonb_build_object('id',v_product.id,'name',v_product.nombre,'active',v_product.activo,
      'stock',v_product.stock,'price',v_product.precio,'cost',v_product.costo,
      'margin_pct',round(((v_product.precio-v_product.costo)/nullif(v_product.precio,0)*100)::numeric,2)) end,
    'agency_limits',jsonb_build_object('mode',v_settings.autonomy_mode,'daily_budget',v_settings.daily_budget_limit,
      'campaign_budget',v_settings.campaign_budget_limit,'creative_approval',v_settings.require_creative_approval,
      'block_out_of_stock',v_settings.block_out_of_stock,'paused',v_settings.paused),
    'brand',coalesce(v_brand,'{}'::jsonb)
  ));
  insert into public.agency_collaboration_rooms(room_key,title,objective,brief_id,decision_id,context_snapshot,context_fingerprint,created_by)
  values(v_key,v_title,v_objective,v_brief_id,v_decision_id,v_context,public._agency_mesa_fingerprint(v_context),v_actor.id)
  on conflict(room_key) do nothing returning * into v_room;
  if v_room.id is null then
    select * into v_room from public.agency_collaboration_rooms where room_key=v_key;
    if v_room.brief_id is distinct from v_brief_id or v_room.decision_id is distinct from v_decision_id then
      raise exception 'La clave de mesa ya pertenece a otra fuente.';
    end if;
    return jsonb_build_object('ok',true,'room_id',v_room.id,'duplicate',true,'executed',false);
  end if;
  insert into public.agency_collaboration_entries(room_id,entry_key,author_kind,entry_type,body,payload,payload_fingerprint)
  values(v_room.id,v_key||':context','Sistema','Aporte','MOMO OPS selló los hechos disponibles para esta conversación.',
    jsonb_build_object('context_fingerprint',v_room.context_fingerprint),public._agency_mesa_fingerprint(jsonb_build_object('context_fingerprint',v_room.context_fingerprint)));
  v_proposal_id:=nullif(v_decision.proposed_action#>>'{_orchestrator,proposal_id}','')::bigint;
  if v_proposal_id is not null then
    select * into v_proposal from public.agency_agent_proposals where id=v_proposal_id and status='Convertida';
    if v_proposal.id is not null then
      insert into public.agency_collaboration_entries(room_id,entry_key,author_kind,entry_type,body,payload,payload_fingerprint,agent_name)
      select v_room.id,v_key||':agent-source','Agente','Propuesta',
        coalesce(v_proposal.sealed_payload->>'title','Propuesta del cerebro')||'. '||coalesce(v_proposal.sealed_payload->>'rationale',''),
        jsonb_build_object('proposal_id',v_proposal.id,'fingerprint',v_proposal.payload_fingerprint,'payload',v_proposal.sealed_payload),
        public._agency_mesa_fingerprint(jsonb_build_object('proposal_id',v_proposal.id,'fingerprint',v_proposal.payload_fingerprint,'payload',v_proposal.sealed_payload)),
        coalesce(r.agent_name,'Cerebro de Agencia MOMOS') from public.agency_agent_runs r where r.id=v_proposal.run_id;
    end if;
  end if;
  perform public._add_audit('Mesa Agencia',v_room.id::text,'Mesa cooperativa abierta','',v_title);
  return jsonb_build_object('ok',true,'room_id',v_room.id,'duplicate',false,'executed',false,'context_fingerprint',v_room.context_fingerprint);
end $$;

create or replace function public.agregar_aporte_mesa_agencia(p_room_id bigint,p_entry_key text,p_entry_type text,p_body text,p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_room public.agency_collaboration_rooms%rowtype; v_id bigint; v_existing public.agency_collaboration_entries%rowtype;
  v_key text:=btrim(coalesce(p_entry_key,'')); v_body text:=btrim(coalesce(p_body,'')); v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
begin
  v_actor:=public._agency_actor(); select * into v_room from public.agency_collaboration_rooms where id=p_room_id for update;
  if v_room.id is null then raise exception 'La mesa no existe.'; end if;
  if v_room.status not in ('Abierta','Contrato listo') then raise exception 'La mesa ya no admite aportes.'; end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,220}$' or p_entry_type not in ('Aporte','Pregunta','Propuesta','Objeción','Respuesta','Decisión')
     or length(v_body) not between 2 and 4000 or jsonb_typeof(v_payload)<>'object' or public._agency_mesa_has_secret(v_payload) then
    raise exception 'El aporte humano es inválido o contiene secretos.';
  end if;
  insert into public.agency_collaboration_entries(room_id,entry_key,author_kind,entry_type,body,payload,payload_fingerprint,created_by)
  values(v_room.id,v_key,'Humano',p_entry_type,v_body,v_payload,public._agency_mesa_fingerprint(v_payload),v_actor.id)
  on conflict(entry_key) do nothing returning id into v_id;
  if v_id is null then
    select * into v_existing from public.agency_collaboration_entries where entry_key=v_key;
    if v_existing.room_id<>v_room.id or v_existing.author_kind<>'Humano' or v_existing.entry_type<>p_entry_type
       or v_existing.body<>v_body or v_existing.payload<>v_payload then raise exception 'La clave idempotente del aporte ya tiene otro contenido.'; end if;
    v_id:=v_existing.id;
  end if;
  update public.agency_collaboration_rooms set status='Abierta',updated_at=now() where id=v_room.id;
  update public.agency_creative_contracts set status='Sustituido'
    where room_id=v_room.id and status='En revisión';
  perform public._add_audit('Mesa Agencia',v_room.id::text,'Aporte humano agregado','',left(v_body,180));
  return jsonb_build_object('ok',true,'room_id',v_room.id,'entry_id',v_id,'executed',false);
end $$;

create or replace function public.registrar_aporte_agente_mesa(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_room public.agency_collaboration_rooms%rowtype; v_id bigint; v_existing public.agency_collaboration_entries%rowtype;
  v_room_id bigint:=nullif(p->>'room_id','')::bigint; v_key text:=btrim(coalesce(p->>'entry_key',''));
  v_type text:=coalesce(nullif(p->>'entry_type',''),'Propuesta'); v_body text:=btrim(coalesce(p->>'body',''));
  v_payload jsonb:=coalesce(p->'payload','{}'::jsonb); v_agent text:=btrim(coalesce(p->>'agent_name',''));
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) then raise exception 'El aporte del agente es inválido o contiene secretos.'; end if;
  select * into v_room from public.agency_collaboration_rooms where id=v_room_id for update;
  if v_room.id is null or v_room.status not in ('Abierta','Contrato listo') then raise exception 'La mesa no existe o ya está cerrada.'; end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,220}$' or v_type not in ('Aporte','Pregunta','Propuesta','Objeción','Respuesta','Decisión')
     or length(v_body) not between 2 and 4000 or length(v_agent) not between 2 and 100 or jsonb_typeof(v_payload)<>'object' then
    raise exception 'El aporte del agente no cumple el contrato.';
  end if;
  insert into public.agency_collaboration_entries(room_id,entry_key,author_kind,entry_type,body,payload,payload_fingerprint,agent_name)
  values(v_room.id,v_key,'Agente',v_type,v_body,v_payload,public._agency_mesa_fingerprint(v_payload),v_agent)
  on conflict(entry_key) do nothing returning id into v_id;
  if v_id is null then
    select * into v_existing from public.agency_collaboration_entries where entry_key=v_key;
    if v_existing.room_id<>v_room.id or v_existing.author_kind<>'Agente' or v_existing.entry_type<>v_type
       or v_existing.body<>v_body or v_existing.payload<>v_payload or v_existing.agent_name<>v_agent then
      raise exception 'La clave idempotente del agente ya tiene otro contenido.';
    end if;
    v_id:=v_existing.id;
  end if;
  update public.agency_collaboration_rooms set status='Abierta',updated_at=now() where id=v_room.id;
  update public.agency_creative_contracts set status='Sustituido'
    where room_id=v_room.id and status='En revisión';
  return jsonb_build_object('ok',true,'room_id',v_room.id,'entry_id',v_id,'executed',false);
end $$;

create or replace function public.preparar_contrato_creativo(p_room_id bigint,p_direction jsonb,p_constraints jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_room public.agency_collaboration_rooms%rowtype; v_brief public.agency_briefs%rowtype;
  v_decision public.agency_decisions%rowtype; v_direction jsonb:=coalesce(p_direction,'{}'::jsonb); v_constraints jsonb:=coalesce(p_constraints,'{}'::jsonb);
  v_payload jsonb; v_fingerprint text; v_version integer; v_id bigint; v_budget numeric:=0; v_limit numeric; v_kpi text;
begin
  v_actor:=public._agency_actor(); select * into v_room from public.agency_collaboration_rooms where id=p_room_id for update;
  if v_room.id is null or v_room.status not in ('Abierta','Contrato listo') then raise exception 'La mesa no existe o ya está cerrada.'; end if;
  if jsonb_typeof(v_direction)<>'object' or jsonb_typeof(v_constraints)<>'object'
     or public._agency_mesa_has_secret(v_direction) or public._agency_mesa_has_secret(v_constraints) then raise exception 'La dirección creativa es inválida o contiene secretos.'; end if;
  if length(btrim(coalesce(v_direction->>'concept','')))<3 then raise exception 'El contrato necesita un concepto creativo acordado.'; end if;
  if not exists(select 1 from public.agency_collaboration_entries where room_id=v_room.id and author_kind='Humano') then raise exception 'Falta el criterio humano de marca.'; end if;
  if not exists(select 1 from public.agency_collaboration_entries where room_id=v_room.id and author_kind='Agente') then raise exception 'Falta una propuesta del cerebro de Agencia.'; end if;
  if v_room.brief_id is not null then
    select * into v_brief from public.agency_briefs where id=v_room.brief_id;
    if v_brief.status not in ('Aprobado','En producción') then raise exception 'El brief necesita aprobación humana antes del contrato.'; end if;
    v_budget:=coalesce(v_brief.approved_budget,v_brief.proposed_budget,0);
  end if;
  if v_room.decision_id is not null then
    select * into v_decision from public.agency_decisions where id=v_room.decision_id;
    if v_decision.status<>'Aprobada' then raise exception 'La decisión necesita aprobación humana antes del contrato.'; end if;
    if v_room.brief_id is null then
      if coalesce(v_decision.proposed_action->>'proposed_budget','0') !~ '^[0-9]+([.][0-9]+)?$' then
        raise exception 'La decisión contiene un presupuesto inválido.';
      end if;
      v_budget:=coalesce((v_decision.proposed_action->>'proposed_budget')::numeric,0);
    end if;
  end if;
  select campaign_budget_limit into v_limit from public.agency_settings where id;
  if v_budget<0 or v_budget>coalesce(v_limit,0) then raise exception 'El presupuesto aprobado ya no cabe en las guardas.'; end if;
  v_kpi:=coalesce(nullif(v_direction->>'primary_kpi',''),'Beneficio incremental');
  if v_kpi not in ('Beneficio incremental','Margen incremental','Ventas incrementales','Recompra') then raise exception 'KPI principal inválido.'; end if;
  v_payload:=jsonb_build_object(
    'schema_version',1,'room_id',v_room.id,'objective',v_room.objective,'primary_kpi',v_kpi,'approved_budget',v_budget,
    'facts',v_room.context_snapshot,'creative_direction',v_direction,
    'constraints',v_constraints||jsonb_build_object('human_review_required',true,'product_fidelity_required',true,'no_unapproved_claims',true),
    'collaboration',jsonb_build_object('human_entries',(select count(*) from public.agency_collaboration_entries where room_id=v_room.id and author_kind='Humano'),
      'agent_entries',(select count(*) from public.agency_collaboration_entries where room_id=v_room.id and author_kind='Agente'),
      'last_entry_id',(select max(id) from public.agency_collaboration_entries where room_id=v_room.id))
  );
  v_fingerprint:=public._agency_mesa_fingerprint(v_payload);
  select id into v_id from public.agency_creative_contracts where room_id=v_room.id and contract_fingerprint=v_fingerprint;
  if v_id is not null then return jsonb_build_object('ok',true,'contract_id',v_id,'duplicate',true,'executed',false); end if;
  select coalesce(max(version),0)+1 into v_version from public.agency_creative_contracts where room_id=v_room.id;
  update public.agency_creative_contracts set status='Sustituido'
    where room_id=v_room.id and status='En revisión';
  insert into public.agency_creative_contracts(contract_key,room_id,version,sealed_payload,contract_fingerprint,prepared_by)
  values(v_room.room_key||':contract:'||v_version::text,v_room.id,v_version,v_payload,v_fingerprint,v_actor.id) returning id into v_id;
  update public.agency_collaboration_rooms set status='Contrato listo',updated_at=now() where id=v_room.id;
  perform public._add_audit('Contrato creativo',v_id::text,'Contrato preparado','',v_room.title||' · V'||v_version::text);
  return jsonb_build_object('ok',true,'contract_id',v_id,'version',v_version,'fingerprint',v_fingerprint,'duplicate',false,'executed',false,'requires_human_approval',true);
end $$;

create or replace function public.aprobar_contrato_creativo(p_contract_id bigint,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_contract public.agency_creative_contracts%rowtype; v_room public.agency_collaboration_rooms%rowtype;
  v_brief public.agency_briefs%rowtype; v_decision public.agency_decisions%rowtype; v_product public.products%rowtype;
  v_settings public.agency_settings%rowtype; v_budget numeric; v_product_id text; v_snapshot jsonb; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor(); select * into v_contract from public.agency_creative_contracts where id=p_contract_id for update;
  if v_contract.id is null or v_contract.status<>'En revisión' then raise exception 'El contrato no existe o ya fue resuelto.'; end if;
  if exists(select 1 from public.agency_creative_contracts where room_id=v_contract.room_id and version>v_contract.version and status<>'Anulado') then
    raise exception 'Existe una versión posterior del contrato.';
  end if;
  if v_contract.contract_fingerprint<>public._agency_mesa_fingerprint(v_contract.sealed_payload) then raise exception 'El contrato perdió integridad.'; end if;
  select * into v_room from public.agency_collaboration_rooms where id=v_contract.room_id for update;
  select * into v_settings from public.agency_settings where id;
  if v_settings.paused then raise exception 'Agencia MOMOS está pausada.'; end if;
  if v_room.brief_id is not null then
    select * into v_brief from public.agency_briefs where id=v_room.brief_id;
    if v_brief.status not in ('Aprobado','En producción') then raise exception 'El brief dejó de estar aprobado.'; end if;
  end if;
  if v_room.decision_id is not null then
    select * into v_decision from public.agency_decisions where id=v_room.decision_id;
    if v_decision.status<>'Aprobada' then raise exception 'La decisión dejó de estar aprobada.'; end if;
  end if;
  v_budget:=coalesce((v_contract.sealed_payload->>'approved_budget')::numeric,0);
  if v_budget<0 or v_budget>v_settings.campaign_budget_limit then raise exception 'El presupuesto ya no cabe en las guardas.'; end if;
  v_product_id:=nullif(v_contract.sealed_payload#>>'{facts,product,id}','');
  if v_product_id is not null then
    select * into v_product from public.products where id=v_product_id;
    if v_product.id is null or not v_product.activo then raise exception 'El producto foco ya no está activo.'; end if;
    if v_settings.block_out_of_stock and coalesce(v_product.stock,0)<=0 then raise exception 'El producto foco ya no tiene stock para respaldar la campaña.'; end if;
  end if;
  v_snapshot:=jsonb_strip_nulls(jsonb_build_object('approved_at',now(),'approved_by',v_actor.id,
    'campaign_budget_limit',v_settings.campaign_budget_limit,'product_id',v_product_id,'product_stock',v_product.stock));
  update public.agency_creative_contracts set status='Sustituido'
    where room_id=v_room.id and status='Aprobado' and id<>v_contract.id;
  update public.agency_creative_contracts set status='Aprobado',approved_by=v_actor.id,approved_at=now(),approval_note=v_note,approval_snapshot=v_snapshot
    where id=v_contract.id;
  update public.agency_collaboration_rooms set status='Cerrada',updated_at=now() where id=v_room.id;
  perform public._add_audit('Contrato creativo',v_contract.id::text,'Contrato aprobado','En revisión','Aprobado · no ejecutado');
  return jsonb_build_object('ok',true,'contract_id',v_contract.id,'status','Aprobado','executed',false,
    'generation_started',false,'distribution_started',false,'requires_next_authorization',true);
end $$;

do $$ declare v_table text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['agency_collaboration_rooms','agency_collaboration_entries','agency_creative_contracts'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

revoke all on function public.mesa_agencia_disponible() from public,anon;
revoke all on function public._agency_mesa_fingerprint(jsonb) from public,anon,authenticated;
revoke all on function public._agency_mesa_has_secret(jsonb) from public,anon,authenticated;
revoke all on function public._agency_room_immutable() from public,anon,authenticated;
revoke all on function public._agency_entry_immutable() from public,anon,authenticated;
revoke all on function public._agency_contract_immutable() from public,anon,authenticated;
revoke all on function public.abrir_mesa_agencia(jsonb) from public,anon,authenticated;
revoke all on function public.agregar_aporte_mesa_agencia(bigint,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.registrar_aporte_agente_mesa(jsonb) from public,anon,authenticated;
revoke all on function public.preparar_contrato_creativo(bigint,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.aprobar_contrato_creativo(bigint,text) from public,anon,authenticated;
grant execute on function public.mesa_agencia_disponible() to authenticated;
grant execute on function public.abrir_mesa_agencia(jsonb) to authenticated;
grant execute on function public.agregar_aporte_mesa_agencia(bigint,text,text,text,jsonb) to authenticated;
grant execute on function public.preparar_contrato_creativo(bigint,jsonb,jsonb) to authenticated;
grant execute on function public.aprobar_contrato_creativo(bigint,text) to authenticated;
grant execute on function public.registrar_aporte_agente_mesa(jsonb) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_30_mesa_agencia','Mesa cooperativa humano-agente, hechos sellados y contrato creativo orientado a beneficio sin ejecución automática')
on conflict(id) do update set detalle=excluded.detalle;

commit;
