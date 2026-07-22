-- MOMOS OPS · Retorno cooperativo del Cerebro de Agencia v1.
-- Paso 43. Devuelve al MCP el resultado estructurado de la decisión humana
-- sin notas libres, PII, secretos ni capacidad de ejecución externa.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_42_mcp_agency_gateway'
  ) then raise exception 'Falta el paso 42_mcp_agency_gateway.'; end if;
end $$;

-- Conserva la implementación H42 como núcleo privado. El wrapper público para
-- service_role añadirá únicamente el retorno humano sanitizado.
do $$ begin
  if to_regprocedure('public._obtener_contexto_director_agencia_h42()') is null then
    alter function public.obtener_contexto_director_agencia()
      rename to _obtener_contexto_director_agencia_h42;
  end if;
end $$;

create or replace function public._agency_mcp_human_feedback() returns jsonb
language sql stable security definer set search_path=public as $$
  with totals as (
    select
      count(*) filter(where status in ('Convertida','Descartada'))::integer as resolved_total,
      count(*) filter(where status='Convertida')::integer as converted_total,
      count(*) filter(where status='Descartada')::integer as discarded_total
    from public.agency_agent_proposals
  ), latest as (
    select
      p.id as proposal_id,
      p.status as outcome,
      p.decision_id,
      p.resolved_at,
      coalesce(p.sealed_payload->>'decision_type','Otro') as decision_type,
      coalesce(p.sealed_payload->>'risk_level','Bajo') as risk_level,
      coalesce(p.sealed_payload->>'execution_mode','Solo análisis') as execution_mode,
      coalesce(r.context_snapshot->>'snapshot_fingerprint','') as snapshot_fingerprint
    from public.agency_agent_proposals p
    join public.agency_agent_runs r on r.id=p.run_id
    where p.status in ('Convertida','Descartada') and p.resolved_at is not null
    order by p.resolved_at desc,p.id desc
    limit 12
  )
  select jsonb_build_object(
    'resolved_total',t.resolved_total,
    'converted_total',t.converted_total,
    'discarded_total',t.discarded_total,
    'contains_pii',false,
    'resolution_notes_exposed',false,
    'latest',coalesce((
      select jsonb_agg(jsonb_build_object(
        'proposal_id',l.proposal_id,
        'outcome',l.outcome,
        'decision_id',l.decision_id,
        'resolved_at',l.resolved_at,
        'decision_type',l.decision_type,
        'risk_level',l.risk_level,
        'execution_mode',l.execution_mode,
        'snapshot_fingerprint',l.snapshot_fingerprint
      ) order by l.resolved_at desc,l.proposal_id desc)
      from latest l
    ),'[]'::jsonb)
  ) from totals t
$$;

create or replace function public.obtener_contexto_director_agencia() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_base jsonb:=public._obtener_contexto_director_agencia_h42();
  v_snapshot jsonb;
begin
  v_snapshot:=v_base->'snapshot';
  v_snapshot:=jsonb_set(
    v_snapshot,
    '{agency,human_feedback}',
    public._agency_mcp_human_feedback(),
    true
  );
  return jsonb_build_object('snapshot',v_snapshot,'fingerprint',md5(v_snapshot::text));
end $$;

create or replace function public.mcp_agency_feedback_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

revoke all on function public._obtener_contexto_director_agencia_h42() from public,anon,authenticated,service_role;
revoke all on function public._agency_mcp_human_feedback() from public,anon,authenticated,service_role;
revoke all on function public.obtener_contexto_director_agencia() from public,anon,authenticated;
revoke all on function public.mcp_agency_feedback_disponible() from public,anon;
grant execute on function public.obtener_contexto_director_agencia() to service_role;
grant execute on function public.mcp_agency_feedback_disponible() to authenticated,service_role;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260716_43_ciclo_cooperativo_mcp',
  'Retorno estructurado de decisiones humanas al Cerebro MCP sin notas libres, PII, secretos o ejecución externa'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;

