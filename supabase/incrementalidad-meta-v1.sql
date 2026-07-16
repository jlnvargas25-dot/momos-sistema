-- MOMOS OPS · Medición incremental y ciclo de vida Meta v1.
-- Paso 38. Diseña y mide holdouts; atribución nunca se convierte en causalidad sin aleatorización, muestra y revisión humana.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_37_observatorio_meta'
  ) then raise exception 'Falta el paso 37_observatorio_meta.'; end if;
end $$;

create table if not exists public.agency_meta_lift_studies(
  id bigint generated always as identity primary key,
  study_key text not null unique check(study_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  diagnostic_id bigint not null references public.agency_meta_diagnostics(id) on delete restrict,
  snapshot_id bigint not null references public.agency_meta_signal_snapshots(id) on delete restrict,
  campaign_id text not null references public.campaigns(id) on delete restrict,
  external_study_id text not null default '' check(length(external_study_id)<=180),
  design text not null check(design in ('Meta Conversion Lift','Holdout aleatorio MOMOS','Observacional')),
  lifecycle_scope text not null check(lifecycle_scope in ('Todos','Nuevos','Recurrentes')),
  status text not null default 'En revisión' check(status in ('En revisión','Diseñado','Midiendo','Devuelto','Cancelado','Cerrado')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  minimum_per_arm integer not null default 100 check(minimum_per_arm>=100),
  hypothesis text not null check(length(btrim(hypothesis)) between 12 and 500),
  assignment_snapshot jsonb not null check(jsonb_typeof(assignment_snapshot)='object'),
  guardrails jsonb not null check(jsonb_typeof(guardrails)='object'),
  study_fingerprint text not null check(study_fingerprint ~ '^[0-9a-f]{32}$'),
  source_kind text not null check(source_kind in ('Humano','Agente')),
  prepared_by text references public.users(id),
  prepared_by_agent text not null default '',
  prepared_at timestamptz not null default now(),
  reviewed_by text references public.users(id), reviewed_at timestamptz, review_note text not null default '',
  check(window_start<window_end and window_end-window_start<=interval '62 days'),
  check(design<>'Meta Conversion Lift' or length(btrim(external_study_id))>=3),
  check((design='Observacional') or coalesce((assignment_snapshot->>'randomized')::boolean,false)),
  check((source_kind='Humano' and prepared_by is not null and prepared_by_agent='') or
        (source_kind='Agente' and prepared_by is null and length(btrim(prepared_by_agent)) between 2 and 100)),
  unique(diagnostic_id,study_fingerprint)
);
create index if not exists agency_meta_lift_studies_status_idx on public.agency_meta_lift_studies(status,prepared_at desc);

create table if not exists public.agency_meta_lift_measurements(
  id bigint generated always as identity primary key,
  measurement_key text not null unique check(measurement_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  study_id bigint not null references public.agency_meta_lift_studies(id) on delete restrict,
  status text not null default 'En revisión' check(status in ('En revisión','Aprobada','Inconclusa','Devuelta','Sustituida')),
  captured_at timestamptz not null,
  control_cell jsonb not null check(jsonb_typeof(control_cell)='object'),
  exposed_cell jsonb not null check(jsonb_typeof(exposed_cell)='object'),
  incremental_spend numeric(16,2) not null check(incremental_spend>=0),
  platform_result jsonb not null default '{}'::jsonb check(jsonb_typeof(platform_result)='object'),
  local_lifecycle_snapshot jsonb not null check(jsonb_typeof(local_lifecycle_snapshot)='object'),
  result_snapshot jsonb not null check(jsonb_typeof(result_snapshot)='object'),
  measurement_fingerprint text not null check(measurement_fingerprint ~ '^[0-9a-f]{32}$'),
  recorded_by_connector text not null check(length(btrim(recorded_by_connector)) between 2 and 100),
  recorded_at timestamptz not null default now(),
  reviewed_by text references public.users(id), reviewed_at timestamptz, review_note text not null default '',
  unique(study_id,measurement_fingerprint)
);
create index if not exists agency_meta_lift_measurements_status_idx on public.agency_meta_lift_measurements(status,recorded_at desc);

alter table public.agency_meta_lift_studies enable row level security;
alter table public.agency_meta_lift_measurements enable row level security;
do $$ declare v_table text; begin
  foreach v_table in array array['agency_meta_lift_studies','agency_meta_lift_measurements'] loop
    execute format('drop policy if exists staff_read on public.%I',v_table);
    execute format('create policy staff_read on public.%I for select to authenticated using(public.is_staff())',v_table);
    execute format('revoke insert,update,delete on public.%I from public,anon,authenticated',v_table);
    execute format('grant select on public.%I to authenticated',v_table);
  end loop;
end $$;

create or replace function public.incrementalidad_meta_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._meta_lift_cell_valid(p jsonb) returns boolean
language plpgsql immutable security definer set search_path=public as $$
declare v_population numeric; v_buyers numeric; v_key text;
begin
  if p is null or jsonb_typeof(p)<>'object' then return false; end if;
  foreach v_key in array array['population','buyers','orders','revenue','margin'] loop
    if jsonb_typeof(p->v_key)<>'number' or (p->>v_key)::numeric<0 then return false; end if;
  end loop;
  v_population:=(p->>'population')::numeric; v_buyers:=(p->>'buyers')::numeric;
  return trunc(v_population)=v_population and trunc(v_buyers)=v_buyers and v_buyers<=v_population;
exception when others then return false;
end $$;

create or replace function public._meta_lift_result(p_control jsonb,p_exposed jsonb,p_spend numeric,p_minimum integer,p_design text,p_randomized boolean) returns jsonb
language plpgsql immutable security definer set search_path=public as $$
declare c_pop numeric:=(p_control->>'population')::numeric; e_pop numeric:=(p_exposed->>'population')::numeric;
  c_buy numeric:=(p_control->>'buyers')::numeric; e_buy numeric:=(p_exposed->>'buyers')::numeric;
  c_rate numeric:=case when c_pop>0 then c_buy/c_pop else 0 end; e_rate numeric:=case when e_pop>0 then e_buy/e_pop else 0 end;
  v_pooled numeric:=case when c_pop+e_pop>0 then (c_buy+e_buy)/(c_pop+e_pop) else 0 end; v_se numeric; v_z numeric:=0;
  v_sample boolean:=c_pop>=p_minimum and e_pop>=p_minimum; v_significant boolean; v_causal boolean;
  v_incremental_buyers numeric; v_margin_per_buyer numeric; v_incremental_margin numeric; v_profit numeric; v_class text;
begin
  if not public._meta_lift_cell_valid(p_control) or not public._meta_lift_cell_valid(p_exposed) or p_spend<0 or p_minimum<100 then
    raise exception 'Las celdas del estudio no cuadran o contienen valores inválidos.'; end if;
  v_se:=case when c_pop>0 and e_pop>0 then sqrt(v_pooled*(1-v_pooled)*(1/c_pop+1/e_pop)) else 0 end;
  if v_se>0 then v_z:=(e_rate-c_rate)/v_se; end if;
  v_significant:=v_sample and abs(v_z)>=1.96;
  v_causal:=p_design<>'Observacional' and p_randomized and v_significant;
  v_incremental_buyers:=(e_rate-c_rate)*e_pop;
  v_margin_per_buyer:=case when e_buy>0 then (p_exposed->>'margin')::numeric/e_buy else 0 end;
  v_incremental_margin:=v_incremental_buyers*v_margin_per_buyer; v_profit:=v_incremental_margin-p_spend;
  v_class:=case when not v_sample then 'Muestra insuficiente' when p_design='Observacional' then 'Asociación observada'
    when v_significant and e_rate<=c_rate then 'Sin lift' when v_significant and v_profit>0 then 'Incremental rentable'
    when v_significant then 'Incremental sin rentabilidad' else 'Inconcluso' end;
  return jsonb_build_object('sample_sufficient',v_sample,'statistically_significant',v_significant,'causal_claim_allowed',v_causal,'classification',v_class,
    'control_rate_pct',round(c_rate*100,2),'exposed_rate_pct',round(e_rate*100,2),'rate_difference_pp',round((e_rate-c_rate)*100,2),
    'lift_pct',case when c_rate>0 then round((e_rate-c_rate)/c_rate*100,2) end,'z_score',round(v_z,4),
    'incremental_buyers',round(v_incremental_buyers,2),'incremental_margin',round(v_incremental_margin,2),'incremental_spend',p_spend,
    'incremental_profit',round(v_profit,2),'attribution_is_not_causality',true,'human_review_required',true,
    'publication_forbidden',true,'spend_change_forbidden',true);
end $$;

create or replace function public._meta_lifecycle_snapshot(p_campaign text,p_start timestamptz,p_end timestamptz) returns jsonb
language sql stable security definer set search_path=public as $$
with order_totals as (
  select o.id,o.customer_id,o.pagado_en,
    coalesce(sum(case when not oi.es_sub_momo then oi.cant*oi.precio else 0 end),0) revenue,
    coalesce(sum(case when not oi.es_sub_momo then oi.cant*(oi.precio-oi.costo_unitario) else 0 end),0) margin
  from public.orders o join public.order_items oi on oi.order_id=o.id
  where o.campaign_id=p_campaign and o.pagado_en>=p_start and o.pagado_en<p_end and o.estado<>'Cancelado'
  group by o.id,o.customer_id,o.pagado_en
), classified as (
  select ot.*,case when exists(select 1 from public.orders prior where prior.customer_id=ot.customer_id and prior.pagado_en<p_start and prior.estado<>'Cancelado')
    then 'Recurrentes' else 'Nuevos' end lifecycle from order_totals ot
)
select jsonb_build_object('source','MOMOS OPS','window_start',p_start,'window_end',p_end,
  'new',jsonb_build_object('buyers',count(distinct customer_id) filter(where lifecycle='Nuevos'),'orders',count(*) filter(where lifecycle='Nuevos'),
    'revenue',coalesce(sum(revenue) filter(where lifecycle='Nuevos'),0),'margin',coalesce(sum(margin) filter(where lifecycle='Nuevos'),0)),
  'returning',jsonb_build_object('buyers',count(distinct customer_id) filter(where lifecycle='Recurrentes'),'orders',count(*) filter(where lifecycle='Recurrentes'),
    'revenue',coalesce(sum(revenue) filter(where lifecycle='Recurrentes'),0),'margin',coalesce(sum(margin) filter(where lifecycle='Recurrentes'),0)))
from classified
$$;

create or replace function public._meta_lift_study_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'Los estudios incrementales no se eliminan.'; end if;
  if new.study_key is distinct from old.study_key or new.diagnostic_id is distinct from old.diagnostic_id or new.snapshot_id is distinct from old.snapshot_id
     or new.campaign_id is distinct from old.campaign_id or new.external_study_id is distinct from old.external_study_id or new.design is distinct from old.design
     or new.lifecycle_scope is distinct from old.lifecycle_scope or new.window_start is distinct from old.window_start or new.window_end is distinct from old.window_end
     or new.minimum_per_arm is distinct from old.minimum_per_arm or new.hypothesis is distinct from old.hypothesis
     or new.assignment_snapshot is distinct from old.assignment_snapshot or new.guardrails is distinct from old.guardrails
     or new.study_fingerprint is distinct from old.study_fingerprint or new.source_kind is distinct from old.source_kind
     or new.prepared_by is distinct from old.prepared_by or new.prepared_by_agent is distinct from old.prepared_by_agent or new.prepared_at is distinct from old.prepared_at then
    raise exception 'El diseño incremental es inmutable; prepará otro estudio.'; end if;
  return new;
end $$;
drop trigger if exists agency_meta_lift_study_guard on public.agency_meta_lift_studies;
create trigger agency_meta_lift_study_guard before update or delete on public.agency_meta_lift_studies for each row execute function public._meta_lift_study_guard();

create or replace function public._meta_lift_measurement_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'Las mediciones incrementales no se eliminan.'; end if;
  if new.measurement_key is distinct from old.measurement_key or new.study_id is distinct from old.study_id or new.captured_at is distinct from old.captured_at
     or new.control_cell is distinct from old.control_cell or new.exposed_cell is distinct from old.exposed_cell
     or new.incremental_spend is distinct from old.incremental_spend or new.platform_result is distinct from old.platform_result
     or new.local_lifecycle_snapshot is distinct from old.local_lifecycle_snapshot or new.result_snapshot is distinct from old.result_snapshot
     or new.measurement_fingerprint is distinct from old.measurement_fingerprint or new.recorded_by_connector is distinct from old.recorded_by_connector
     or new.recorded_at is distinct from old.recorded_at then raise exception 'La medición incremental es inmutable.'; end if;
  return new;
end $$;
drop trigger if exists agency_meta_lift_measurement_guard on public.agency_meta_lift_measurements;
create trigger agency_meta_lift_measurement_guard before update or delete on public.agency_meta_lift_measurements for each row execute function public._meta_lift_measurement_guard();

create or replace function public._crear_estudio_incremental_meta(p jsonb,p_actor text,p_agent text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_diag public.agency_meta_diagnostics%rowtype; v_snapshot public.agency_meta_signal_snapshots%rowtype;
  v_key text:=btrim(coalesce(p->>'study_key','')); v_design text:=coalesce(p->>'design',''); v_scope text:=coalesce(p->>'lifecycle_scope','Todos');
  v_start timestamptz:=nullif(p->>'window_start','')::timestamptz; v_end timestamptz:=nullif(p->>'window_end','')::timestamptz;
  v_min integer:=coalesce(nullif(p->>'minimum_per_arm','')::integer,100); v_assignment jsonb:=coalesce(p->'assignment_snapshot','{}'::jsonb);
  v_hypothesis text:=btrim(coalesce(p->>'hypothesis','')); v_fp text; v_id bigint; v_existing public.agency_meta_lift_studies%rowtype;
  v_kind text:=case when p_actor is not null then 'Humano' else 'Agente' end;
begin
  select * into v_diag from public.agency_meta_diagnostics where id=nullif(p->>'diagnostic_id','')::bigint and status='Aprobado';
  if v_diag.id is null then raise exception 'El estudio necesita un diagnóstico Meta aprobado.'; end if;
  select * into v_snapshot from public.agency_meta_signal_snapshots where id=v_diag.snapshot_id;
  if v_snapshot.local_campaign_id is null then raise exception 'El snapshot debe estar ligado a una campaña local exacta.'; end if;
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) or v_key !~ '^[A-Za-z0-9:_-]{3,220}$'
     or v_design not in ('Meta Conversion Lift','Holdout aleatorio MOMOS','Observacional') or v_scope not in ('Todos','Nuevos','Recurrentes')
     or v_start is null or v_end is null or v_start>=v_end or v_end-v_start>interval '62 days' or v_min<100
     or length(v_hypothesis) not between 12 and 500 or jsonb_typeof(v_assignment)<>'object'
     or (v_design='Meta Conversion Lift' and length(btrim(coalesce(p->>'external_study_id','')))<3)
     or (v_design<>'Observacional' and not coalesce((v_assignment->>'randomized')::boolean,false)) then
    raise exception 'El diseño incremental es inválido, no aleatorio o contiene secretos.'; end if;
  v_fp:=public._agency_mesa_fingerprint(jsonb_build_object('diagnostic_fingerprint',v_diag.diagnostic_fingerprint,'design',v_design,'scope',v_scope,
    'window_start',v_start,'window_end',v_end,'minimum_per_arm',v_min,'hypothesis',v_hypothesis,'assignment',v_assignment));
  select * into v_existing from public.agency_meta_lift_studies where study_key=v_key;
  if v_existing.id is not null then
    if v_existing.study_fingerprint<>v_fp then raise exception 'La clave del estudio ya existe con otro diseño.'; end if;
    return jsonb_build_object('ok',true,'study_id',v_existing.id,'duplicate',true,'status',v_existing.status,'executed',false,'published',false,'spend_changed',false);
  end if;
  insert into public.agency_meta_lift_studies(study_key,diagnostic_id,snapshot_id,campaign_id,external_study_id,design,lifecycle_scope,status,
    window_start,window_end,minimum_per_arm,hypothesis,assignment_snapshot,guardrails,study_fingerprint,source_kind,prepared_by,prepared_by_agent)
  values(v_key,v_diag.id,v_snapshot.id,v_snapshot.local_campaign_id,btrim(coalesce(p->>'external_study_id','')),v_design,v_scope,'En revisión',v_start,v_end,v_min,
    v_hypothesis,v_assignment,jsonb_build_object('attribution_is_not_causality',true,'human_review_required',true,'publication_forbidden',true,
      'spend_change_forbidden',true,'minimum_per_arm',v_min),v_fp,v_kind,p_actor,coalesce(p_agent,'')) returning id into v_id;
  return jsonb_build_object('ok',true,'study_id',v_id,'duplicate',false,'status','En revisión','executed',false,'published',false,'spend_changed',false);
end $$;

create or replace function public.crear_estudio_incremental_meta(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare v_actor public.users%rowtype; begin
  v_actor:=public._agency_actor(); if not(public.has_current_role('Administrador') or public.has_current_role('Marketing/CRM')) then raise exception 'Tu rol no diseña estudios de adquisición.'; end if;
  return public._crear_estudio_incremental_meta(p,v_actor.id,null); end $$;

create or replace function public.proponer_estudio_incremental_meta_agente(p jsonb,p_agent text) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
  if length(btrim(coalesce(p_agent,''))) not between 2 and 100 then raise exception 'Identificá el agente que propone el estudio.'; end if;
  return public._crear_estudio_incremental_meta(p,null,btrim(p_agent)); end $$;

create or replace function public.resolver_estudio_incremental_meta(p_study_id bigint,p_decision text,p_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_study public.agency_meta_lift_studies%rowtype; v_status text; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor(); select * into v_study from public.agency_meta_lift_studies where id=p_study_id for update;
  if v_study.id is null or v_study.status<>'En revisión' then raise exception 'El estudio no espera revisión humana.'; end if;
  if p_decision not in ('Aprobar','Devolver','Cancelar') or length(v_note)<8 then raise exception 'La revisión necesita decisión y nota humana.'; end if;
  v_status:=case p_decision when 'Aprobar' then 'Diseñado' when 'Devolver' then 'Devuelto' else 'Cancelado' end;
  update public.agency_meta_lift_studies set status=v_status,reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_study.id;
  perform public._add_audit('Incrementalidad Meta',v_study.id::text,'Estudio '||lower(v_status),'',left(v_note,180));
  return jsonb_build_object('ok',true,'study_id',v_study.id,'status',v_status,'executed',false,'published',false,'spend_changed',false);
end $$;

create or replace function public.registrar_medicion_incremental_meta_conector(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_study public.agency_meta_lift_studies%rowtype; v_key text:=btrim(coalesce(p->>'measurement_key',''));
  v_control jsonb:=coalesce(p->'control','{}'::jsonb); v_exposed jsonb:=coalesce(p->'exposed','{}'::jsonb);
  v_spend numeric:=coalesce(nullif(p->>'incremental_spend','')::numeric,0); v_captured timestamptz:=nullif(p->>'captured_at','')::timestamptz;
  v_connector text:=btrim(coalesce(p->>'connector_name','')); v_platform jsonb:=coalesce(p->'platform_result','{}'::jsonb);
  v_lifecycle jsonb; v_result jsonb; v_fp text; v_id bigint; v_existing public.agency_meta_lift_measurements%rowtype;
begin
  select * into v_study from public.agency_meta_lift_studies where id=nullif(p->>'study_id','')::bigint for update;
  if v_study.id is null or v_study.status not in ('Diseñado','Midiendo') then raise exception 'El estudio no está autorizado para recibir mediciones.'; end if;
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) or v_key !~ '^[A-Za-z0-9:_-]{3,220}$'
     or not public._meta_lift_cell_valid(v_control) or not public._meta_lift_cell_valid(v_exposed) or v_spend<0
     or v_captured is null or v_captured<v_study.window_end or v_captured>now()+interval '15 minutes'
     or length(v_connector) not between 2 and 100 or jsonb_typeof(v_platform)<>'object' then raise exception 'La medición incremental es inválida o contiene secretos.'; end if;
  if v_study.design='Meta Conversion Lift' and v_study.external_study_id='' then raise exception 'Falta el identificador oficial del estudio Meta.'; end if;
  v_lifecycle:=public._meta_lifecycle_snapshot(v_study.campaign_id,v_study.window_start,v_study.window_end);
  v_result:=public._meta_lift_result(v_control,v_exposed,v_spend,v_study.minimum_per_arm,v_study.design,
    coalesce((v_study.assignment_snapshot->>'randomized')::boolean,false));
  v_fp:=public._agency_mesa_fingerprint(jsonb_build_object('study_fingerprint',v_study.study_fingerprint,'captured_at',v_captured,'control',v_control,
    'exposed',v_exposed,'spend',v_spend,'platform_result',v_platform,'local_lifecycle',v_lifecycle,'result',v_result));
  select * into v_existing from public.agency_meta_lift_measurements where measurement_key=v_key;
  if v_existing.id is not null then
    if v_existing.measurement_fingerprint<>v_fp then raise exception 'La clave de medición ya existe con otro contenido.'; end if;
    return jsonb_build_object('ok',true,'measurement_id',v_existing.id,'duplicate',true,'status',v_existing.status,'executed',false,'published',false,'spend_changed',false);
  end if;
  update public.agency_meta_lift_measurements set status='Sustituida',review_note='Sustituida por una medición posterior.' where study_id=v_study.id and status='En revisión';
  insert into public.agency_meta_lift_measurements(measurement_key,study_id,status,captured_at,control_cell,exposed_cell,incremental_spend,
    platform_result,local_lifecycle_snapshot,result_snapshot,measurement_fingerprint,recorded_by_connector)
  values(v_key,v_study.id,'En revisión',v_captured,v_control,v_exposed,v_spend,v_platform,v_lifecycle,v_result,v_fp,v_connector) returning id into v_id;
  update public.agency_meta_lift_studies set status='Midiendo' where id=v_study.id;
  return jsonb_build_object('ok',true,'measurement_id',v_id,'duplicate',false,'status','En revisión','result',v_result,
    'executed',false,'published',false,'spend_changed',false);
end $$;

create or replace function public.resolver_medicion_incremental_meta(p_measurement_id bigint,p_decision text,p_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_measure public.agency_meta_lift_measurements%rowtype; v_status text; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor(); select * into v_measure from public.agency_meta_lift_measurements where id=p_measurement_id for update;
  if v_measure.id is null or v_measure.status<>'En revisión' then raise exception 'La medición no espera revisión humana.'; end if;
  if p_decision not in ('Aprobar','Inconclusa','Devolver') or length(v_note)<8 then raise exception 'La revisión necesita decisión y nota humana.'; end if;
  if p_decision='Aprobar' and not coalesce((v_measure.result_snapshot->>'sample_sufficient')::boolean,false) then
    raise exception 'Una muestra insuficiente solo puede quedar inconclusa o devolverse.'; end if;
  v_status:=case p_decision when 'Aprobar' then 'Aprobada' when 'Inconclusa' then 'Inconclusa' else 'Devuelta' end;
  update public.agency_meta_lift_measurements set status=v_status,reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_measure.id;
  if v_status in ('Aprobada','Inconclusa') then update public.agency_meta_lift_studies set status='Cerrado' where id=v_measure.study_id; end if;
  perform public._add_audit('Incrementalidad Meta',v_measure.id::text,'Medición '||lower(v_status),'',left(v_note,180));
  return jsonb_build_object('ok',true,'measurement_id',v_measure.id,'status',v_status,'causal_claim_allowed',
    coalesce((v_measure.result_snapshot->>'causal_claim_allowed')::boolean,false),'executed',false,'published',false,'spend_changed',false);
end $$;

create or replace function public.obtener_contexto_incrementalidad_meta_agente() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('schema_version',1,'captured_at',now(),
    'approved_diagnostics',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'snapshot_id',d.snapshot_id,'confidence',d.confidence,'evidence',d.evidence_snapshot,'fingerprint',d.diagnostic_fingerprint))
      from public.agency_meta_diagnostics d where d.status='Aprobado' and not exists(select 1 from public.agency_meta_lift_studies s where s.diagnostic_id=d.id)),'[]'::jsonb),
    'studies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'design',design,'lifecycle_scope',lifecycle_scope,'status',status,'window_start',window_start,
      'window_end',window_end,'minimum_per_arm',minimum_per_arm,'hypothesis',hypothesis,'assignment',assignment_snapshot,'fingerprint',study_fingerprint) order by prepared_at desc)
      from public.agency_meta_lift_studies),'[]'::jsonb),
    'guards',jsonb_build_object('proposal_only',true,'attribution_is_not_causality',true,'human_review_required',true,'publication_forbidden',true,'spend_change_forbidden',true))
$$;

do $$ declare v_name text; begin
  foreach v_name in array array['_meta_lift_cell_valid(jsonb)','_meta_lift_result(jsonb,jsonb,numeric,integer,text,boolean)',
    '_meta_lifecycle_snapshot(text,timestamp with time zone,timestamp with time zone)','_meta_lift_study_guard()','_meta_lift_measurement_guard()',
    '_crear_estudio_incremental_meta(jsonb,text,text)'] loop execute format('revoke all on function public.%s from public,anon,authenticated',v_name); end loop;
end $$;
revoke all on function public.incrementalidad_meta_disponible() from public,anon;
revoke all on function public.crear_estudio_incremental_meta(jsonb) from public,anon;
revoke all on function public.proponer_estudio_incremental_meta_agente(jsonb,text) from public,anon,authenticated;
revoke all on function public.resolver_estudio_incremental_meta(bigint,text,text) from public,anon;
revoke all on function public.registrar_medicion_incremental_meta_conector(jsonb) from public,anon,authenticated;
revoke all on function public.resolver_medicion_incremental_meta(bigint,text,text) from public,anon;
revoke all on function public.obtener_contexto_incrementalidad_meta_agente() from public,anon,authenticated;
grant execute on function public.incrementalidad_meta_disponible() to authenticated;
grant execute on function public.crear_estudio_incremental_meta(jsonb) to authenticated;
grant execute on function public.resolver_estudio_incremental_meta(bigint,text,text) to authenticated;
grant execute on function public.resolver_medicion_incremental_meta(bigint,text,text) to authenticated;
grant execute on function public.proponer_estudio_incremental_meta_agente(jsonb,text) to service_role;
grant execute on function public.registrar_medicion_incremental_meta_conector(jsonb) to service_role;
grant execute on function public.obtener_contexto_incrementalidad_meta_agente() to service_role;

do $$ declare v_table text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['agency_meta_lift_studies','agency_meta_lift_measurements'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table); end if;
    end loop;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_38_incrementalidad_meta','Estudios lift y lifecycle con aleatorización, muestra, beneficio incremental y revisión humana sin cambios de pauta')
on conflict(id) do update set detalle=excluded.detalle;

commit;
