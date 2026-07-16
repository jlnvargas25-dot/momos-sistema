-- MOMOS OPS · Escenarios de inversión Meta v1.
-- Paso 39. Compara alternativas con evidencia aprobada y verdad operativa; nunca ejecuta pauta.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_38_incrementalidad_meta'
  ) then raise exception 'Falta el paso 38_incrementalidad_meta.'; end if;
end $$;

create table if not exists public.agency_meta_investment_scenarios(
  id bigint generated always as identity primary key,
  scenario_key text not null unique check(scenario_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  measurement_id bigint not null references public.agency_meta_lift_measurements(id) on delete restrict,
  study_id bigint not null references public.agency_meta_lift_studies(id) on delete restrict,
  campaign_id text not null references public.campaigns(id) on delete restrict,
  product_id text references public.products(id) on delete restrict,
  status text not null default 'En revisión' check(status in ('En revisión','Aprobado','Devuelto','Descartado','Sustituido')),
  horizon_days integer not null check(horizon_days between 1 and 30),
  recommended_option text not null check(recommended_option in ('Conservar','Reducir','Redistribuir','Experimento')),
  evidence_snapshot jsonb not null check(jsonb_typeof(evidence_snapshot)='object'),
  options_snapshot jsonb not null check(jsonb_typeof(options_snapshot)='array' and jsonb_array_length(options_snapshot)=4),
  guardrails jsonb not null check(jsonb_typeof(guardrails)='object'),
  scenario_fingerprint text not null check(scenario_fingerprint ~ '^[0-9a-f]{32}$'),
  source_kind text not null check(source_kind in ('Humano','Agente')),
  prepared_by text references public.users(id), prepared_by_agent text not null default '', prepared_at timestamptz not null default now(),
  reviewed_by text references public.users(id), reviewed_at timestamptz, review_note text not null default '',
  check((source_kind='Humano' and prepared_by is not null and prepared_by_agent='') or
        (source_kind='Agente' and prepared_by is null and length(btrim(prepared_by_agent)) between 2 and 100)),
  unique(measurement_id,scenario_fingerprint)
);
create index if not exists agency_meta_investment_scenarios_status_idx
  on public.agency_meta_investment_scenarios(status,prepared_at desc);

alter table public.agency_meta_investment_scenarios enable row level security;
drop policy if exists staff_read on public.agency_meta_investment_scenarios;
create policy staff_read on public.agency_meta_investment_scenarios for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.agency_meta_investment_scenarios from public,anon,authenticated;
grant select on public.agency_meta_investment_scenarios to authenticated;

create or replace function public.escenarios_inversion_meta_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._meta_investment_ops_snapshot(p_measurement_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_measure public.agency_meta_lift_measurements%rowtype; v_study public.agency_meta_lift_studies%rowtype;
  v_campaign public.campaigns%rowtype; v_product public.products%rowtype; v_settings public.agency_settings%rowtype;
  v_exact numeric:=0; v_expiring numeric:=0; v_in_process numeric:=0; v_reservations numeric:=0; v_pending numeric:=0;
  v_queue integer:=0; v_freezing integer:=0; v_freezer_capacity numeric:=0; v_stock_blocked boolean;
begin
  select * into v_measure from public.agency_meta_lift_measurements where id=p_measurement_id and status='Aprobada';
  if v_measure.id is null then raise exception 'Los escenarios necesitan una medición incremental aprobada.'; end if;
  select * into v_study from public.agency_meta_lift_studies where id=v_measure.study_id;
  select * into v_campaign from public.campaigns where id=v_study.campaign_id;
  if v_campaign.id is null then raise exception 'La campaña local del estudio ya no existe.'; end if;
  if v_campaign.producto_foco_id is not null then select * into v_product from public.products where id=v_campaign.producto_foco_id; end if;
  select * into v_settings from public.agency_settings where id;
  if v_product.id is not null then
    select coalesce(sum(disponibles),0),coalesce(sum(disponibles) filter(where vencimiento_proximo<=current_date+2),0)
      into v_exact,v_expiring from public.v_variantes_disponibles where product_id=v_product.id;
    select coalesce(sum(prod),0) into v_in_process from public.production_batches
      where product_id=v_product.id and estado in ('En preparación','Congelando');
    select coalesce(sum(cantidad),0) into v_reservations from public.inventory_reservations
      where product_id=v_product.id and tipo='producto' and estado in ('Reservada','Temporal');
    select coalesce(sum(cantidad),0) into v_pending from public.production_suggestions
      where product_id=v_product.id and estado='Pendiente';
  end if;
  select count(*) into v_queue from public.orders where estado in ('Pagado','En producción');
  select count(*) into v_freezing from public.production_batches where estado='Congelando';
  select coalesce(sum(capacidad),0) into v_freezer_capacity from public.ubicaciones_frio where activo;
  v_stock_blocked:=v_product.id is null or not coalesce(v_product.activo,false) or
    (coalesce(v_product.stock,0)<=0 and v_exact<=0 and v_in_process<=0);
  return jsonb_build_object('schema_version',1,'captured_at',now(),
    'measurement',jsonb_build_object('id',v_measure.id,'classification',v_measure.result_snapshot->>'classification',
      'causal_claim_allowed',coalesce((v_measure.result_snapshot->>'causal_claim_allowed')::boolean,false),
      'incremental_profit',coalesce((v_measure.result_snapshot->>'incremental_profit')::numeric,0),
      'incremental_margin',coalesce((v_measure.result_snapshot->>'incremental_margin')::numeric,0),
      'incremental_spend',v_measure.incremental_spend,'fingerprint',v_measure.measurement_fingerprint),
    'campaign',jsonb_build_object('id',v_campaign.id,'name',v_campaign.nombre,'state',v_campaign.estado,'baseline_budget',v_campaign.presupuesto),
    'product',case when v_product.id is null then jsonb_build_object('id',null,'active',false) else
      jsonb_build_object('id',v_product.id,'name',v_product.nombre,'active',v_product.activo,'official_stock',coalesce(v_product.stock,0),'price',v_product.precio,'cost',v_product.costo) end,
    'operations',jsonb_build_object('exact_available',v_exact,'expiring_within_2d',v_expiring,'in_process',v_in_process,
      'reservations',v_reservations,'pending_production',v_pending,'kitchen_queue',v_queue,'freezing_batches',v_freezing,
      'freezer_capacity',v_freezer_capacity,'stock_blocked',v_stock_blocked),
    'lifecycle',v_measure.local_lifecycle_snapshot,
    'limits',jsonb_build_object('daily_budget_limit',coalesce(v_settings.daily_budget_limit,0),
      'campaign_budget_limit',coalesce(v_settings.campaign_budget_limit,0),'scale_step_pct',coalesce(v_settings.scale_step_pct,15)),
    'guards',jsonb_build_object('projection_not_promise',true,'human_review_required',true,'execution_forbidden',true,
      'budget_change_forbidden',true,'audience_change_forbidden',true,'publication_forbidden',true));
end $$;

create or replace function public._meta_investment_projection(p_budget numeric,p_ratio numeric,p_low numeric,p_high numeric) returns jsonb
language sql immutable security definer set search_path=public as $$
  select jsonb_build_object('low',round(least(p_budget*p_ratio*p_low,p_budget*p_ratio*p_high),2),
    'base',round(p_budget*p_ratio,2),'high',round(greatest(p_budget*p_ratio*p_low,p_budget*p_ratio*p_high),2))
$$;

create or replace function public._meta_investment_options(p_evidence jsonb,p_horizon integer) returns jsonb
language plpgsql immutable security definer set search_path=public as $$
declare v_budget numeric:=coalesce((p_evidence#>>'{campaign,baseline_budget}')::numeric,0);
  v_spend numeric:=coalesce((p_evidence#>>'{measurement,incremental_spend}')::numeric,0);
  v_profit numeric:=coalesce((p_evidence#>>'{measurement,incremental_profit}')::numeric,0);
  v_causal boolean:=coalesce((p_evidence#>>'{measurement,causal_claim_allowed}')::boolean,false);
  v_step numeric:=least(30,greatest(0,coalesce((p_evidence#>>'{limits,scale_step_pct}')::numeric,15)));
  v_daily numeric:=coalesce((p_evidence#>>'{limits,daily_budget_limit}')::numeric,0); v_ratio numeric:=0;
  v_reduce numeric; v_experiment numeric; v_blocked boolean:=coalesce((p_evidence#>>'{operations,stock_blocked}')::boolean,true);
  v_exact numeric:=coalesce((p_evidence#>>'{operations,exact_available}')::numeric,0);
  v_process numeric:=coalesce((p_evidence#>>'{operations,in_process}')::numeric,0);
  v_reserved numeric:=coalesce((p_evidence#>>'{operations,reservations}')::numeric,0);
  v_queue numeric:=coalesce((p_evidence#>>'{operations,kitchen_queue}')::numeric,0);
  v_new_margin numeric:=coalesce((p_evidence#>>'{lifecycle,new,margin}')::numeric,0);
  v_return_margin numeric:=coalesce((p_evidence#>>'{lifecycle,returning,margin}')::numeric,0);
  v_target text; v_recommended text:='Conservar'; v_blockers jsonb:='[]'::jsonb; v_assumptions jsonb;
begin
  if p_horizon not between 1 and 30 then raise exception 'El horizonte debe estar entre 1 y 30 días.'; end if;
  if v_budget<=0 then v_budget:=v_spend; end if;
  if v_spend>0 then v_ratio:=greatest(-2,least(5,v_profit/v_spend)); end if;
  v_reduce:=round(v_budget*(1-v_step/100),2);
  v_experiment:=round(least(case when v_daily>0 then v_daily else 50000 end,case when v_budget>0 then v_budget*.15 else 50000 end),2);
  v_target:=case when v_return_margin>v_new_margin then 'Recurrentes' else 'Nuevos' end;
  if v_blocked then v_blockers:=v_blockers||jsonb_build_array('Sin producto foco utilizable ni producción en curso.'); end if;
  if v_exact<=v_reserved and v_process<=0 then v_blockers:=v_blockers||jsonb_build_array('La disponibilidad exacta no supera las reservas vigentes.'); end if;
  if v_queue>=5 then v_blockers:=v_blockers||jsonb_build_array('Cocina tiene cinco o más pedidos activos.'); end if;
  v_assumptions:=jsonb_build_array('Proyección, no promesa: escala conservadoramente el único resultado aprobado.',
    'No modifica presupuesto, audiencia, campaña ni publicación.');
  if v_blocked or (v_causal and v_profit<=0) then v_recommended:='Reducir';
  elsif not v_causal then v_recommended:='Experimento';
  elsif (v_new_margin>0 or v_return_margin>0) and greatest(v_new_margin,v_return_margin)>=greatest(1,least(v_new_margin,v_return_margin))*1.5 then v_recommended:='Redistribuir';
  elsif jsonb_array_length(v_blockers)>0 then v_recommended:='Conservar'; end if;
  return jsonb_build_object('recommended',v_recommended,'options',jsonb_build_array(
    jsonb_build_object('key','Conservar','proposed_budget',round(v_budget,2),'delta_pct',0,'projection',public._meta_investment_projection(v_budget,v_ratio,.5,1.15),
      'purpose','Mantener el aprendizaje sin ampliar exposición.','blockers',v_blockers,'assumptions',v_assumptions),
    jsonb_build_object('key','Reducir','proposed_budget',v_reduce,'delta_pct',-v_step,'projection',public._meta_investment_projection(v_reduce,v_ratio,.5,1.05),
      'purpose','Limitar riesgo mientras se corrige rentabilidad o capacidad.','blockers','[]'::jsonb,'assumptions',v_assumptions),
    jsonb_build_object('key','Redistribuir','proposed_budget',round(v_budget,2),'delta_pct',0,'projection',public._meta_investment_projection(v_budget,v_ratio,.4,1.2),
      'purpose','Comparar ciclo de vida sin aumentar el total; foco sugerido: '||v_target||'.','blockers',v_blockers,'assumptions',v_assumptions),
    jsonb_build_object('key','Experimento','proposed_budget',v_experiment,'delta_pct',case when v_budget>0 then round(v_experiment/v_budget*100-100,2) else 0 end,
      'projection',jsonb_build_object('low',-v_experiment,'base',0,'high',round(greatest(0,v_profit)*.25,2)),
      'purpose','Comprar evidencia nueva con una sola variable y un tope pequeño.','blockers',case when v_blocked then v_blockers else '[]'::jsonb end,'assumptions',v_assumptions)));
end $$;

create or replace function public._meta_investment_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'Los escenarios de inversión no se eliminan.'; end if;
  if new.scenario_key is distinct from old.scenario_key or new.measurement_id is distinct from old.measurement_id
     or new.study_id is distinct from old.study_id or new.campaign_id is distinct from old.campaign_id or new.product_id is distinct from old.product_id
     or new.horizon_days is distinct from old.horizon_days or new.recommended_option is distinct from old.recommended_option
     or new.evidence_snapshot is distinct from old.evidence_snapshot or new.options_snapshot is distinct from old.options_snapshot
     or new.guardrails is distinct from old.guardrails or new.scenario_fingerprint is distinct from old.scenario_fingerprint
     or new.source_kind is distinct from old.source_kind or new.prepared_by is distinct from old.prepared_by
     or new.prepared_by_agent is distinct from old.prepared_by_agent or new.prepared_at is distinct from old.prepared_at then
    raise exception 'La evidencia y las alternativas selladas no se pueden reescribir.'; end if;
  return new;
end $$;
drop trigger if exists agency_meta_investment_guard on public.agency_meta_investment_scenarios;
create trigger agency_meta_investment_guard before update or delete on public.agency_meta_investment_scenarios
for each row execute function public._meta_investment_guard();

create or replace function public._crear_escenarios_inversion_meta(p jsonb,p_actor text,p_agent text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_measure public.agency_meta_lift_measurements%rowtype; v_study public.agency_meta_lift_studies%rowtype;
  v_key text:=btrim(coalesce(p->>'scenario_key','')); v_horizon integer:=coalesce(nullif(p->>'horizon_days','')::integer,7);
  v_evidence jsonb; v_analysis jsonb; v_options jsonb; v_recommended text; v_fp text; v_id bigint;
  v_existing public.agency_meta_investment_scenarios%rowtype; v_kind text:=case when p_actor is not null then 'Humano' else 'Agente' end;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) or v_key !~ '^[A-Za-z0-9:_-]{3,220}$'
     or v_horizon not between 1 and 30 then raise exception 'La solicitud de escenarios es inválida o contiene secretos.'; end if;
  select * into v_measure from public.agency_meta_lift_measurements where id=nullif(p->>'measurement_id','')::bigint and status='Aprobada';
  if v_measure.id is null then raise exception 'Los escenarios necesitan una medición incremental aprobada.'; end if;
  select * into v_study from public.agency_meta_lift_studies where id=v_measure.study_id;
  v_evidence:=public._meta_investment_ops_snapshot(v_measure.id);
  v_analysis:=public._meta_investment_options(v_evidence,v_horizon); v_options:=v_analysis->'options'; v_recommended:=v_analysis->>'recommended';
  v_fp:=public._agency_mesa_fingerprint(jsonb_build_object('measurement_fingerprint',v_measure.measurement_fingerprint,
    'horizon_days',v_horizon,'evidence',v_evidence-'captured_at','analysis',v_analysis));
  select * into v_existing from public.agency_meta_investment_scenarios where scenario_key=v_key;
  if v_existing.id is not null and v_existing.scenario_fingerprint<>v_fp then raise exception 'La clave de escenarios ya existe con otro contenido.'; end if;
  if v_existing.id is null then select * into v_existing from public.agency_meta_investment_scenarios
    where measurement_id=v_measure.id and scenario_fingerprint=v_fp; end if;
  if v_existing.id is not null then return jsonb_build_object('ok',true,'scenario_id',v_existing.id,'duplicate',true,
    'status',v_existing.status,'executed',false,'published',false,'budget_changed',false,'audience_changed',false); end if;
  update public.agency_meta_investment_scenarios set status='Sustituido',review_note='Sustituido por contexto operativo más reciente.'
    where measurement_id=v_measure.id and status='En revisión';
  insert into public.agency_meta_investment_scenarios(scenario_key,measurement_id,study_id,campaign_id,product_id,status,horizon_days,
    recommended_option,evidence_snapshot,options_snapshot,guardrails,scenario_fingerprint,source_kind,prepared_by,prepared_by_agent)
  values(v_key,v_measure.id,v_study.id,v_study.campaign_id,nullif(v_evidence#>>'{product,id}',''),'En revisión',v_horizon,v_recommended,
    v_evidence,v_options,jsonb_build_object('human_review_required',true,'execution_forbidden',true,'budget_change_forbidden',true,
      'audience_change_forbidden',true,'publication_forbidden',true),v_fp,v_kind,p_actor,coalesce(p_agent,'')) returning id into v_id;
  return jsonb_build_object('ok',true,'scenario_id',v_id,'duplicate',false,'status','En revisión','recommended_option',v_recommended,
    'executed',false,'published',false,'budget_changed',false,'audience_changed',false);
end $$;

create or replace function public.crear_escenarios_inversion_meta(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare v_actor public.users%rowtype; begin
  v_actor:=public._agency_actor();
  if not(public.has_current_role('Administrador') or public.has_current_role('Marketing/CRM')) then raise exception 'Tu rol no diseña escenarios de inversión.'; end if;
  return public._crear_escenarios_inversion_meta(p,v_actor.id,null);
end $$;

create or replace function public.proponer_escenarios_inversion_meta_agente(p jsonb,p_agent text) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
  if length(btrim(coalesce(p_agent,''))) not between 2 and 100 then raise exception 'Identificá el agente que propone los escenarios.'; end if;
  return public._crear_escenarios_inversion_meta(p,null,btrim(p_agent));
end $$;

create or replace function public.resolver_escenarios_inversion_meta(p_scenario_id bigint,p_decision text,p_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_scenario public.agency_meta_investment_scenarios%rowtype; v_status text; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor();
  if not(public.has_current_role('Administrador') or public.has_current_role('Marketing/CRM')) then raise exception 'Tu rol no revisa escenarios de inversión.'; end if;
  select * into v_scenario from public.agency_meta_investment_scenarios where id=p_scenario_id for update;
  if v_scenario.id is null or v_scenario.status<>'En revisión' then raise exception 'Los escenarios no esperan revisión humana.'; end if;
  if p_decision not in ('Aprobar','Devolver','Descartar') or length(v_note)<8 then raise exception 'La revisión necesita decisión y nota humana.'; end if;
  v_status:=case p_decision when 'Aprobar' then 'Aprobado' when 'Devolver' then 'Devuelto' else 'Descartado' end;
  update public.agency_meta_investment_scenarios set status=v_status,reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_scenario.id;
  perform public._add_audit('Escenarios Meta',v_scenario.id::text,'Escenarios '||lower(v_status),'',left(v_note,180));
  return jsonb_build_object('ok',true,'scenario_id',v_scenario.id,'status',v_status,'recommended_option',v_scenario.recommended_option,
    'executed',false,'published',false,'budget_changed',false,'audience_changed',false);
end $$;

create or replace function public.obtener_contexto_escenarios_inversion_meta_agente() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('schema_version',1,'captured_at',now(),
    'approved_measurements',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'study_id',m.study_id,'result',m.result_snapshot,
      'lifecycle',m.local_lifecycle_snapshot,'fingerprint',m.measurement_fingerprint) order by m.reviewed_at desc)
      from public.agency_meta_lift_measurements m where m.status='Aprobada' and not exists(
        select 1 from public.agency_meta_investment_scenarios s where s.measurement_id=m.id and s.status in ('En revisión','Aprobado'))),'[]'::jsonb),
    'guards',jsonb_build_object('proposal_only',true,'human_review_required',true,'execution_forbidden',true,
      'budget_change_forbidden',true,'audience_change_forbidden',true,'publication_forbidden',true))
$$;

do $$ declare v_name text; begin
  foreach v_name in array array['_meta_investment_ops_snapshot(bigint)','_meta_investment_projection(numeric,numeric,numeric,numeric)',
    '_meta_investment_options(jsonb,integer)','_meta_investment_guard()','_crear_escenarios_inversion_meta(jsonb,text,text)'] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',v_name); end loop;
end $$;
revoke all on function public.escenarios_inversion_meta_disponible() from public,anon;
revoke all on function public.crear_escenarios_inversion_meta(jsonb) from public,anon;
revoke all on function public.proponer_escenarios_inversion_meta_agente(jsonb,text) from public,anon,authenticated;
revoke all on function public.resolver_escenarios_inversion_meta(bigint,text,text) from public,anon;
revoke all on function public.obtener_contexto_escenarios_inversion_meta_agente() from public,anon,authenticated;
grant execute on function public.escenarios_inversion_meta_disponible() to authenticated;
grant execute on function public.crear_escenarios_inversion_meta(jsonb) to authenticated;
grant execute on function public.resolver_escenarios_inversion_meta(bigint,text,text) to authenticated;
grant execute on function public.proponer_escenarios_inversion_meta_agente(jsonb,text) to service_role;
grant execute on function public.obtener_contexto_escenarios_inversion_meta_agente() to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_meta_investment_scenarios'
  ) then alter publication supabase_realtime add table public.agency_meta_investment_scenarios; end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_39_escenarios_inversion','Escenarios comparables Meta con beneficio, stock, capacidad, ciclo de vida y revisión humana sin ejecutar pauta')
on conflict(id) do update set detalle=excluded.detalle;

commit;
