-- MOMOS OPS · Orquestador de Agencia v1.
-- Paso 28. Bandeja sellada para recomendaciones de agentes/MCP.
-- El agente analiza y propone; una persona aprueba; las guardas existentes ejecutan.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260715'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260715_27_versiones_creativas'
  ) then raise exception 'Falta el paso 27_versiones_creativas.'; end if;
end $$;

create table if not exists public.agency_agent_runs(
  id bigint generated always as identity primary key,
  run_key text not null unique check(length(btrim(run_key)) between 3 and 180),
  trigger_type text not null check(trigger_type in ('Manual','Evento','Programado')),
  status text not null default 'Propuestas listas' check(status in ('Analizando','Propuestas listas','Sin hallazgos','Fallida','Cancelada')),
  focus text not null default '', context_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(context_snapshot)='object'),
  agent_name text not null default 'MOMO OPS Orchestrator', agent_version text not null default '1',
  requested_by text references public.users(id), requested_at timestamptz not null default now(), completed_at timestamptz,
  error_message text not null default '' check(length(error_message)<=500)
);
create index if not exists agency_agent_runs_status_idx on public.agency_agent_runs(status,requested_at desc);

create table if not exists public.agency_agent_proposals(
  id bigint generated always as identity primary key,
  run_id bigint not null references public.agency_agent_runs(id) on delete restrict,
  proposal_key text not null unique check(length(btrim(proposal_key)) between 3 and 180),
  sealed_payload jsonb not null check(jsonb_typeof(sealed_payload)='object'),
  payload_fingerprint text not null check(payload_fingerprint ~ '^[0-9a-f]{32}$'),
  status text not null default 'Propuesta' check(status in ('Propuesta','Convertida','Descartada')),
  decision_id bigint unique references public.agency_decisions(id) on delete restrict,
  resolved_by text references public.users(id), resolved_at timestamptz, resolution_note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists agency_agent_proposals_status_idx on public.agency_agent_proposals(status,created_at desc);

alter table public.agency_agent_runs enable row level security;
alter table public.agency_agent_proposals enable row level security;
drop policy if exists staff_read on public.agency_agent_runs;
drop policy if exists staff_read on public.agency_agent_proposals;
create policy staff_read on public.agency_agent_runs for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_agent_proposals for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.agency_agent_runs,public.agency_agent_proposals from anon,authenticated;
grant select on public.agency_agent_runs,public.agency_agent_proposals to authenticated;

create or replace function public.orquestador_agencia_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_proposal_fingerprint(p jsonb) returns text
language sql immutable security definer set search_path=public as $$ select md5(p::text) $$;

create or replace function public._validar_propuesta_orquestador(p jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_type text:=btrim(coalesce(p->>'decision_type','')); v_title text:=btrim(coalesce(p->>'title',''));
  v_reason text:=btrim(coalesce(p->>'rationale','')); v_risk text:=coalesce(nullif(p->>'risk_level',''),'Bajo');
  v_mode text:=coalesce(nullif(p->>'execution_mode',''),'Solo análisis'); v_conf numeric; v_est numeric; v_cap numeric; v_limit numeric;
  v_tools jsonb:=coalesce(p->'required_tools','[]'::jsonb); v_evidence jsonb:=coalesce(p->'evidence','{}'::jsonb);
  v_action jsonb:=coalesce(p->'proposed_action','{}'::jsonb); v_action_budget numeric;
begin
  if p is null or jsonb_typeof(p)<>'object' then raise exception 'La propuesta del agente debe ser un objeto.'; end if;
  if p::text ~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:' then
    raise exception 'La propuesta contiene un secreto; los agentes solo pueden guardar referencias seguras.';
  end if;
  if v_type not in ('Crear contenido','Contactar segmento','Activar campaña','Pausar campaña','Escalar presupuesto','Reponer stock','Revisar creativo','Revisar oferta','Otro') then raise exception 'Tipo de decisión del agente inválido.'; end if;
  if length(v_title)<3 or length(v_title)>180 or length(v_reason)<3 or length(v_reason)>2000 then raise exception 'Título o fundamento de la propuesta inválido.'; end if;
  if v_risk not in ('Bajo','Medio','Alto') or v_mode not in ('Solo análisis','Preparar borrador','Acción externa') then raise exception 'Riesgo o modo de ejecución inválido.'; end if;
  if jsonb_typeof(v_tools)<>'array' or jsonb_array_length(v_tools)=0 or jsonb_array_length(v_tools)>12
     or exists(select 1 from jsonb_array_elements(v_tools) as x(value) where jsonb_typeof(x.value)<>'string'
       or (x.value#>>'{}') not in ('MOMO OPS lectura','Inventario','CRM','Calendario','Biblioteca de marca','Kling','Higgsfield','Meta lectura','TikTok lectura','Distribución')) then
    raise exception 'La propuesta debe declarar entre 1 y 12 herramientas válidas.';
  end if;
  if jsonb_typeof(v_evidence)<>'object' or jsonb_typeof(v_action)<>'object' then raise exception 'Evidencia y acción propuesta deben ser objetos.'; end if;
  v_conf:=coalesce((p->>'confidence')::numeric,0); v_est:=coalesce((p->>'estimated_cost_cop')::numeric,0); v_cap:=coalesce((p->>'cost_cap_cop')::numeric,0);
  v_action_budget:=coalesce((v_action->>'proposed_budget')::numeric,0);
  select campaign_budget_limit into v_limit from public.agency_settings where id;
  if v_conf<0 or v_conf>1 or v_est<0 or v_cap<0 or v_est>v_cap or v_action_budget<0 or v_action_budget>v_cap or v_cap>coalesce(v_limit,0) then raise exception 'Confianza o límite de costo fuera de las guardas.'; end if;
  return jsonb_build_object(
    'decision_type',v_type,'title',v_title,'rationale',v_reason,'evidence',v_evidence,'proposed_action',v_action,
    'required_tools',v_tools,'confidence',v_conf,'risk_level',v_risk,'estimated_cost_cop',v_est,'cost_cap_cop',v_cap,
    'execution_mode',v_mode,'source',left(coalesce(nullif(p->>'source',''),'Agente MCP'),100)
  );
end $$;

create or replace function public._insertar_propuesta_orquestador(p_run_id bigint,p_key text,p jsonb) returns bigint
language plpgsql security definer set search_path=public as $$
declare v_payload jsonb; v_id bigint; v_key text:=btrim(coalesce(p_key,''));
begin
  if v_key !~ '^[A-Za-z0-9:_-]{3,180}$' then raise exception 'La clave idempotente de la propuesta es inválida.'; end if;
  v_payload:=public._validar_propuesta_orquestador(p);
  insert into public.agency_agent_proposals(run_id,proposal_key,sealed_payload,payload_fingerprint)
  values(p_run_id,v_key,v_payload,public._agency_proposal_fingerprint(v_payload))
  on conflict(proposal_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.agency_agent_proposals where proposal_key=v_key; end if;
  return v_id;
end $$;

create or replace function public._agency_proposal_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.run_id is distinct from old.run_id or new.proposal_key is distinct from old.proposal_key
     or new.sealed_payload is distinct from old.sealed_payload or new.payload_fingerprint is distinct from old.payload_fingerprint
     or new.created_at is distinct from old.created_at then raise exception 'La propuesta sellada no se puede reescribir.'; end if;
  return new;
end $$;
drop trigger if exists agency_agent_proposals_immutable on public.agency_agent_proposals;
create trigger agency_agent_proposals_immutable before update on public.agency_agent_proposals
for each row execute function public._agency_proposal_immutable();

create or replace function public.registrar_recomendacion_orquestador(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_run_id bigint; v_proposal_id bigint; v_key text:=btrim(coalesce(p->>'proposal_key',''));
begin
  v_actor:=public._agency_actor();
  if v_key !~ '^[A-Za-z0-9:_-]{3,180}$' then raise exception 'La recomendación necesita una clave estable.'; end if;
  insert into public.agency_agent_runs(run_key,trigger_type,status,focus,context_snapshot,agent_name,agent_version,requested_by,completed_at)
  values('momos:'||v_key,'Manual','Propuestas listas',coalesce(p->>'title',''),jsonb_build_object('source',coalesce(p->>'source','MOMO OPS intelligence')),
    'MOMO OPS Intelligence','1',v_actor.id,now()) on conflict(run_key) do nothing returning id into v_run_id;
  if v_run_id is null then select id into v_run_id from public.agency_agent_runs where run_key='momos:'||v_key; end if;
  v_proposal_id:=public._insertar_propuesta_orquestador(v_run_id,'momos:'||v_key,p-'proposal_key');
  perform public._add_audit('Cerebro Agencia',v_proposal_id::text,'Propuesta sellada','',coalesce(p->>'title',''));
  return jsonb_build_object('ok',true,'run_id',v_run_id,'proposal_id',v_proposal_id,'executed',false,'requires_human_approval',true);
end $$;

create or replace function public.registrar_corrida_orquestador_agente(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_run_id bigint; v_key text:=btrim(coalesce(p->>'run_key','')); v_item jsonb; v_count integer:=0; v_id bigint;
begin
  if p is null or jsonb_typeof(p)<>'object' or jsonb_typeof(p->'proposals')<>'array' then raise exception 'Corrida de agente inválida.'; end if;
  if p::text ~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:' then raise exception 'La corrida contiene secretos.'; end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,180}$' or jsonb_array_length(p->'proposals')>20 then raise exception 'Clave o cantidad de propuestas inválida.'; end if;
  insert into public.agency_agent_runs(run_key,trigger_type,status,focus,context_snapshot,agent_name,agent_version,completed_at)
  values(v_key,coalesce(nullif(p->>'trigger_type',''),'Evento'),'Propuestas listas',left(coalesce(p->>'focus',''),180),coalesce(p->'context_snapshot','{}'::jsonb),
    left(coalesce(nullif(p->>'agent_name',''),'MOMO OPS MCP'),100),left(coalesce(nullif(p->>'agent_version',''),'1'),40),now())
  on conflict(run_key) do nothing returning id into v_run_id;
  if v_run_id is null then
    select id into v_run_id from public.agency_agent_runs where run_key=v_key;
    return jsonb_build_object('ok',true,'run_id',v_run_id,'duplicate',true,'executed',false);
  end if;
  for v_item in select value from jsonb_array_elements(p->'proposals') loop
    v_count:=v_count+1;
    v_id:=public._insertar_propuesta_orquestador(v_run_id,v_key||':'||v_count::text,v_item);
  end loop;
  if v_count=0 then update public.agency_agent_runs set status='Sin hallazgos' where id=v_run_id; end if;
  return jsonb_build_object('ok',true,'run_id',v_run_id,'proposal_count',v_count,'executed',false,'requires_human_approval',true);
end $$;

create or replace function public.resolver_propuesta_orquestador(p_proposal_id bigint,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_proposal public.agency_agent_proposals%rowtype; v_payload jsonb; v_decision_id bigint; v_note text:=btrim(coalesce(p_note,'')); v_limit numeric;
begin
  v_actor:=public._agency_actor();
  select * into v_proposal from public.agency_agent_proposals where id=p_proposal_id for update;
  if v_proposal.id is null then raise exception 'La propuesta del agente no existe.'; end if;
  if v_proposal.status<>'Propuesta' then raise exception 'La propuesta ya fue resuelta.'; end if;
  if p_decision not in ('Aprobar','Descartar') then raise exception 'Decisión humana inválida.'; end if;
  if v_proposal.payload_fingerprint<>public._agency_proposal_fingerprint(v_proposal.sealed_payload) then raise exception 'La propuesta perdió integridad; no puede aprobarse.'; end if;
  if p_decision='Descartar' then
    if length(v_note)<3 then raise exception 'Explicá brevemente por qué se descarta.'; end if;
    update public.agency_agent_proposals set status='Descartada',resolved_by=v_actor.id,resolved_at=now(),resolution_note=v_note where id=v_proposal.id;
    perform public._add_audit('Cerebro Agencia',v_proposal.id::text,'Propuesta humana','Propuesta','Descartada · '||v_note);
    return jsonb_build_object('ok',true,'proposal_id',v_proposal.id,'status','Descartada','executed',false);
  end if;
  v_payload:=v_proposal.sealed_payload;
  select campaign_budget_limit into v_limit from public.agency_settings where id;
  if coalesce((v_payload->>'cost_cap_cop')::numeric,0)>coalesce(v_limit,0) then raise exception 'El límite comercial cambió; pedí un nuevo análisis antes de aprobar.'; end if;
  insert into public.agency_decisions(type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,created_at,approved_at,result)
  values(v_payload->>'decision_type',v_payload->>'title',v_payload->>'rationale',v_payload->'evidence',
    (v_payload->'proposed_action')||jsonb_build_object('_orchestrator',jsonb_build_object('proposal_id',v_proposal.id,'run_id',v_proposal.run_id,
      'required_tools',v_payload->'required_tools','confidence',v_payload->'confidence','execution_mode',v_payload->>'execution_mode',
      'estimated_cost_cop',v_payload->'estimated_cost_cop','cost_cap_cop',v_payload->'cost_cap_cop')),
    v_payload->>'risk_level','Aprobada','ia',v_actor.id,v_actor.id,now(),now(),v_note) returning id into v_decision_id;
  update public.agency_agent_proposals set status='Convertida',decision_id=v_decision_id,resolved_by=v_actor.id,resolved_at=now(),resolution_note=v_note where id=v_proposal.id;
  perform public._add_audit('Cerebro Agencia',v_proposal.id::text,'Propuesta humana','Propuesta','Convertida en decisión #'||v_decision_id::text);
  return jsonb_build_object('ok',true,'proposal_id',v_proposal.id,'status','Convertida','decision_id',v_decision_id,'executed',false);
end $$;

do $$ declare v_table text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['agency_agent_runs','agency_agent_proposals'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

revoke all on function public.orquestador_agencia_disponible() from public,anon;
revoke all on function public._agency_proposal_fingerprint(jsonb) from public,anon,authenticated;
revoke all on function public._validar_propuesta_orquestador(jsonb) from public,anon,authenticated;
revoke all on function public._insertar_propuesta_orquestador(bigint,text,jsonb) from public,anon,authenticated;
revoke all on function public._agency_proposal_immutable() from public,anon,authenticated;
revoke all on function public.registrar_recomendacion_orquestador(jsonb) from public,anon;
revoke all on function public.registrar_corrida_orquestador_agente(jsonb) from public,anon,authenticated;
revoke all on function public.resolver_propuesta_orquestador(bigint,text,text) from public,anon;
grant execute on function public.orquestador_agencia_disponible() to authenticated;
grant execute on function public.registrar_recomendacion_orquestador(jsonb) to authenticated;
grant execute on function public.registrar_corrida_orquestador_agente(jsonb) to service_role;
grant execute on function public.resolver_propuesta_orquestador(bigint,text,text) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260715_28_orquestador_agencia','Bandeja sellada para agentes/MCP con evidencia, herramientas, costo, aprobación humana y cero ejecución automática')
on conflict(id) do update set detalle=excluded.detalle;

commit;
