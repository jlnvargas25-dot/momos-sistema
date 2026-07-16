-- MOMOS OPS · Resultados verificables de Agencia v1.
-- Paso 46. Una decisión aprobada solo puede cerrarse con un resultado
-- estructurado y una evidencia interna validada por el servidor.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_45_centro_acciones_agencia'
  ) then raise exception 'Falta el paso 45_centro_acciones_agencia.'; end if;
end $$;

create table if not exists public.agency_action_outcomes(
  id bigint generated always as identity primary key,
  decision_id bigint not null unique references public.agency_decisions(id) on delete restrict,
  action_code text not null check(action_code ~ '^[A-Z0-9_]{3,80}$'),
  completion_status text not null check(completion_status in ('Completada','Bloqueada','No realizada')),
  target_decision_status text not null check(target_decision_status in ('Ejecutada','Fallida')),
  observed_result text not null check(observed_result in ('Positivo','Neutral','Negativo','Pendiente')),
  evidence_kind text not null default 'Ninguna'
    check(evidence_kind in ('Ninguna','Pedido','Lote','Cliente','Creativo','Publicación','Campaña','Brief','Decisión')),
  evidence_id text not null default '',
  evidence_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence_snapshot)='object'),
  actual_cost numeric not null default 0 check(actual_cost>=0),
  summary text not null check(length(btrim(summary)) between 3 and 280),
  blocker_code text not null default '',
  external_execution boolean not null default false check(external_execution=false),
  fingerprint text not null unique check(length(fingerprint)=32),
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  check(
    (completion_status='Completada' and target_decision_status='Ejecutada' and evidence_kind<>'Ninguna' and length(btrim(evidence_id))>0)
    or (completion_status in ('Bloqueada','No realizada') and target_decision_status='Fallida')
  ),
  check(completion_status<>'Bloqueada' or length(btrim(blocker_code))>=3)
);
create index if not exists agency_action_outcomes_created_idx on public.agency_action_outcomes(created_at desc,id desc);

alter table public.agency_action_outcomes enable row level security;
drop policy if exists agency_action_outcomes_read on public.agency_action_outcomes;
create policy agency_action_outcomes_read on public.agency_action_outcomes for select to authenticated
using(public.current_user_has_any_role(array['Administrador','Marketing/CRM']));
revoke all on public.agency_action_outcomes from anon,authenticated;
grant select on public.agency_action_outcomes to authenticated;

create or replace function public._agency_action_evidence_snapshot(
  p_kind text,p_id text,p_decision_id bigint
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_snapshot jsonb;
begin
  if p_kind='Pedido' then
    select jsonb_build_object('kind',p_kind,'id',id,'status',estado,'created_at',created_at)
      into v_snapshot from public.orders where id=p_id;
  elsif p_kind='Lote' then
    select jsonb_build_object('kind',p_kind,'id',id,'status',estado,'created_at',fecha)
      into v_snapshot from public.production_batches where id=p_id;
  elsif p_kind='Cliente' then
    select jsonb_build_object('kind',p_kind,'id',customer_id,'status',case when contact_allowed then 'Contacto permitido' else 'No contactar' end,'created_at',updated_at)
      into v_snapshot from public.customer_crm_profiles where customer_id=p_id;
  elsif p_kind='Creativo' then
    select jsonb_build_object('kind',p_kind,'id',id,'status',estado,'created_at',fecha_entrega)
      into v_snapshot from public.creatives where id=p_id;
  elsif p_kind='Publicación' then
    select jsonb_build_object('kind',p_kind,'id',id,'status',estado,'created_at',fecha)
      into v_snapshot from public.content_posts where id=p_id;
  elsif p_kind='Campaña' then
    select jsonb_build_object('kind',p_kind,'id',id,'status',estado,'created_at',fecha_inicio)
      into v_snapshot from public.campaigns where id=p_id;
  elsif p_kind='Brief' and p_id ~ '^[0-9]+$' then
    select jsonb_build_object('kind',p_kind,'id',id,'status',status,'created_at',created_at)
      into v_snapshot from public.agency_briefs where id=p_id::bigint;
  elsif p_kind='Decisión' and p_id ~ '^[0-9]+$' and p_id::bigint=p_decision_id then
    select jsonb_build_object('kind',p_kind,'id',id,'status',status,'created_at',created_at)
      into v_snapshot from public.agency_decisions where id=p_id::bigint;
  end if;
  if v_snapshot is null then raise exception 'La evidencia % % no existe o no corresponde a esta decisión.',p_kind,p_id; end if;
  return v_snapshot;
end $$;

create or replace function public._agency_decision_outcome_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.status='Aprobada' and new.status in ('Ejecutada','Fallida') and not exists(
    select 1 from public.agency_action_outcomes o
    where o.decision_id=new.id and o.target_decision_status=new.status
  ) then
    raise exception 'Registrá primero un resultado estructurado con evidencia desde el Centro de acciones.';
  end if;
  return new;
end $$;
drop trigger if exists agency_decisions_outcome_guard on public.agency_decisions;
create trigger agency_decisions_outcome_guard before update of status on public.agency_decisions
for each row execute function public._agency_decision_outcome_guard();

create or replace function public.registrar_resultado_accion_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_decision public.agency_decisions%rowtype; v_existing public.agency_action_outcomes%rowtype; v_action jsonb;
  v_decision_id bigint:=nullif(p->>'decision_id','')::bigint;
  v_completion text:=coalesce(nullif(p->>'completion_status',''),'');
  v_observed text:=coalesce(nullif(p->>'observed_result',''),'Pendiente');
  v_kind text:=coalesce(nullif(p->>'evidence_kind',''),'Ninguna');
  v_evidence_id text:=btrim(coalesce(p->>'evidence_id',''));
  v_summary text:=btrim(coalesce(p->>'summary',''));
  v_cost numeric:=coalesce((p->>'actual_cost')::numeric,0);
  v_target text; v_blocker text; v_snapshot jsonb:='{}'::jsonb; v_fingerprint text; v_id bigint;
begin
  select * into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or public.current_user_has_any_role(array['Administrador','Marketing/CRM']) is not true then
    raise exception 'Tu rol no puede cerrar acciones de Agencia MOMOS.';
  end if;
  select * into v_decision from public.agency_decisions where id=v_decision_id for update;
  if v_decision.id is null then raise exception 'La decisión no existe.'; end if;
  if v_completion not in ('Completada','Bloqueada','No realizada') then raise exception 'Resultado de acción inválido.'; end if;
  if v_observed not in ('Positivo','Neutral','Negativo','Pendiente') then raise exception 'Lectura del resultado inválida.'; end if;
  if v_kind not in ('Ninguna','Pedido','Lote','Cliente','Creativo','Publicación','Campaña','Brief','Decisión') then raise exception 'Tipo de evidencia inválido.'; end if;
  if length(v_summary) not between 3 and 280 then raise exception 'El resumen debe tener entre 3 y 280 caracteres.'; end if;
  if v_summary ~* '(api[_ -]?key|access[_ -]?token|app[_ -]?secret|service[_ -]?role|password|bearer[[:space:]])' then
    raise exception 'El resumen parece contener un secreto. No lo guardes en MOMO OPS.';
  end if;
  if v_cost<0 then raise exception 'El costo real no puede ser negativo.'; end if;
  select * into v_existing from public.agency_action_outcomes where decision_id=v_decision_id;
  if v_existing.id is not null then
    if v_existing.completion_status=v_completion and v_existing.observed_result=v_observed
       and v_existing.evidence_kind=v_kind and v_existing.evidence_id=v_evidence_id
       and v_existing.actual_cost=v_cost and v_existing.summary=v_summary then
      return jsonb_build_object('ok',true,'outcome_id',v_existing.id,'decision_id',v_decision_id,'status',v_existing.target_decision_status,'idempotent',true);
    end if;
    raise exception 'La decisión ya tiene un resultado sellado y no puede reescribirse.';
  end if;
  v_action:=public._agency_mcp_next_action(v_decision_id);
  if v_action is null or v_decision.status<>'Aprobada' then raise exception 'La decisión ya no espera una acción humana.'; end if;
  if coalesce((v_action->>'external_execution')::boolean,true) then raise exception 'La acción no cumple el contrato de cero ejecución externa.'; end if;
  if v_completion='Completada' and coalesce((v_action->>'blocked')::boolean,false) then
    raise exception 'La acción está bloqueada por % y no puede cerrarse como completada.',coalesce(v_action->>'blocker_code','una guarda');
  end if;
  if v_completion='Completada' and (v_kind='Ninguna' or v_evidence_id='') then
    raise exception 'Una acción completada necesita evidencia interna verificable.';
  end if;
  if v_kind<>'Ninguna' then
    if v_evidence_id='' then raise exception 'Indicá el identificador de la evidencia.'; end if;
    v_snapshot:=public._agency_action_evidence_snapshot(v_kind,v_evidence_id,v_decision_id);
  elsif v_evidence_id<>'' then raise exception 'No envíes identificador cuando la evidencia es Ninguna.';
  end if;
  v_target:=case when v_completion='Completada' then 'Ejecutada' else 'Fallida' end;
  v_blocker:=case when v_completion='Bloqueada' then coalesce(nullif(v_action->>'blocker_code',''),'HUMAN_BLOCKER_RECORDED') else '' end;
  v_fingerprint:=md5(concat_ws('|',v_decision_id,(v_action->>'next_action_code'),v_completion,v_observed,v_kind,v_evidence_id,v_cost,v_summary));

  insert into public.agency_action_outcomes(
    decision_id,action_code,completion_status,target_decision_status,observed_result,
    evidence_kind,evidence_id,evidence_snapshot,actual_cost,summary,blocker_code,fingerprint,created_by
  ) values(
    v_decision_id,v_action->>'next_action_code',v_completion,v_target,v_observed,
    v_kind,v_evidence_id,v_snapshot,v_cost,v_summary,v_blocker,v_fingerprint,v_actor.id
  ) returning id into v_id;

  perform public.resolver_decision_agencia(v_decision_id,v_target,v_summary);
  perform public._add_audit('Acción agencia',v_id::text,'Resultado estructurado registrado',v_action->>'next_action_code',v_completion);
  return jsonb_build_object('ok',true,'outcome_id',v_id,'decision_id',v_decision_id,'status',v_target,'idempotent',false,'external_execution',false);
end $$;

create or replace function public.resultados_acciones_agencia_disponibles() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

revoke all on function public._agency_action_evidence_snapshot(text,text,bigint) from public,anon,authenticated,service_role;
revoke all on function public._agency_decision_outcome_guard() from public,anon,authenticated,service_role;
revoke all on function public.registrar_resultado_accion_agencia(jsonb) from public,anon;
revoke all on function public.resultados_acciones_agencia_disponibles() from public,anon;
grant execute on function public.registrar_resultado_accion_agencia(jsonb) to authenticated;
grant execute on function public.resultados_acciones_agencia_disponibles() to authenticated,service_role;

do $$ declare v_table text:='agency_action_outcomes'; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
    execute format('alter publication supabase_realtime add table public.%I',v_table);
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_46_resultados_verificables_agencia','Resultados estructurados, evidencia interna, idempotencia y cierre protegido de decisiones de Agencia')
on conflict(id) do update set detalle=excluded.detalle;

commit;
