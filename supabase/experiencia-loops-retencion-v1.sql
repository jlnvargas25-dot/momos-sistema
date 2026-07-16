-- MOMOS OPS · Experiencia de loops de retención v1.
-- Paso 35. Convierte una curva exacta en diagnóstico por beats/loops y aprendizaje humano aprobado.
-- Describe asociaciones temporales; no atribuye causalidad, no genera, no pauta y no publica.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_34_retencion_aprendizaje'
  ) then raise exception 'Falta el paso 34_retencion_aprendizaje.'; end if;
end $$;

create table if not exists public.agency_retention_diagnostics(
  id bigint generated always as identity primary key,
  diagnostic_key text not null unique check(diagnostic_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  measurement_id bigint not null references public.agency_retention_measurements(id) on delete restrict,
  experiment_id bigint not null references public.agency_retention_experiments(id) on delete restrict,
  script_id bigint not null references public.agency_retention_scripts(id) on delete restrict,
  hook_id bigint not null references public.agency_retention_hooks(id) on delete restrict,
  status text not null default 'En revisión' check(status in ('En revisión','Aprobado','Devuelto','Sustituido')),
  tested_variable text not null check(tested_variable in ('Hook','Primer fotograma','Prueba temprana','Orden de beats','Payoff','CTA','Oferta')),
  primary_signal text not null check(length(btrim(primary_signal)) between 10 and 1200),
  hypothesis text not null check(length(btrim(hypothesis)) between 10 and 1200),
  recommendation text not null check(length(btrim(recommendation)) between 10 and 1600),
  confidence text not null check(confidence in ('Inicial','Media','Alta')),
  diagnostic_snapshot jsonb not null check(jsonb_typeof(diagnostic_snapshot)='object'),
  diagnostic_fingerprint text not null check(diagnostic_fingerprint ~ '^[0-9a-f]{32}$'),
  source_kind text not null check(source_kind in ('Humano','Agente')),
  prepared_by text references public.users(id), prepared_by_agent text not null default '', prepared_at timestamptz not null default now(),
  reviewed_by text references public.users(id), reviewed_at timestamptz, review_note text not null default '',
  unique(measurement_id,diagnostic_fingerprint),
  check((source_kind='Humano' and prepared_by is not null and prepared_by_agent='') or
        (source_kind='Agente' and prepared_by is null and length(btrim(prepared_by_agent)) between 2 and 100))
);
create index if not exists agency_retention_diagnostics_status_idx on public.agency_retention_diagnostics(status,prepared_at desc);

create table if not exists public.agency_retention_learnings(
  id bigint generated always as identity primary key,
  learning_key text not null unique check(learning_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  diagnostic_id bigint not null unique references public.agency_retention_diagnostics(id) on delete restrict,
  platform text not null, audience text not null, target_duration_sec numeric(7,2) not null check(target_duration_sec between 5 and 180),
  tested_variable text not null check(tested_variable in ('Hook','Primer fotograma','Prueba temprana','Orden de beats','Payoff','CTA','Oferta')),
  statement text not null check(length(btrim(statement)) between 10 and 2200),
  scope_snapshot jsonb not null check(jsonb_typeof(scope_snapshot)='object'),
  evidence_snapshot jsonb not null check(jsonb_typeof(evidence_snapshot)='object'),
  learning_fingerprint text not null check(learning_fingerprint ~ '^[0-9a-f]{32}$'),
  approved_by text not null references public.users(id), approved_at timestamptz not null default now()
);
create index if not exists agency_retention_learnings_scope_idx on public.agency_retention_learnings(platform,target_duration_sec,approved_at desc);

alter table public.agency_retention_diagnostics enable row level security;
alter table public.agency_retention_learnings enable row level security;
drop policy if exists staff_read on public.agency_retention_diagnostics;
create policy staff_read on public.agency_retention_diagnostics for select to authenticated using(public.is_staff());
drop policy if exists staff_read on public.agency_retention_learnings;
create policy staff_read on public.agency_retention_learnings for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.agency_retention_diagnostics from public,anon,authenticated;
revoke insert,update,delete on public.agency_retention_learnings from public,anon,authenticated;
grant select on public.agency_retention_diagnostics to authenticated;
grant select on public.agency_retention_learnings to authenticated;

create or replace function public.retencion_loops_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_retention_curve_valid(p_curve jsonb,p_duration numeric) returns boolean
language plpgsql immutable security definer set search_path=public as $$
declare v_point jsonb; v_sec numeric; v_pct numeric; v_prev numeric:=-1; v_prev_pct numeric; v_count integer:=0; v_first numeric;
begin
  if jsonb_typeof(p_curve)<>'array' or p_duration is null or p_duration<=0 then return false; end if;
  for v_point in select value from jsonb_array_elements(p_curve) loop
    begin v_sec:=(v_point->>'sec')::numeric; v_pct:=(v_point->>'pct')::numeric;
    exception when others then return false; end;
    if v_sec<0 or v_pct<0 or v_pct>1 or v_sec<=v_prev or (v_prev_pct is not null and v_pct>v_prev_pct) then return false; end if;
    if v_count=0 then v_first:=v_sec; end if;
    v_prev:=v_sec; v_prev_pct:=v_pct; v_count:=v_count+1;
  end loop;
  return v_count>=3 and v_first=0 and v_prev>=p_duration;
end $$;

create or replace function public._agency_retention_curve_at(p_curve jsonb,p_second numeric) returns numeric
language plpgsql immutable security definer set search_path=public as $$
declare v_point jsonb; v_sec numeric; v_pct numeric; v_prev_sec numeric; v_prev_pct numeric; v_target numeric:=greatest(0,coalesce(p_second,0));
begin
  for v_point in select value from jsonb_array_elements(p_curve) loop
    v_sec:=(v_point->>'sec')::numeric; v_pct:=(v_point->>'pct')::numeric;
    if v_prev_sec is null then
      if v_target<=v_sec then return v_pct; end if;
    elsif v_target<=v_sec then
      return round((v_prev_pct+((v_pct-v_prev_pct)*((v_target-v_prev_sec)/(v_sec-v_prev_sec))))::numeric,6);
    end if;
    v_prev_sec:=v_sec; v_prev_pct:=v_pct;
  end loop;
  return v_prev_pct;
end $$;

create or replace function public._agency_retention_diagnostic_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'Los diagnósticos de retención no se eliminan.'; end if;
  if new.diagnostic_key is distinct from old.diagnostic_key or new.measurement_id is distinct from old.measurement_id
    or new.experiment_id is distinct from old.experiment_id or new.script_id is distinct from old.script_id
    or new.hook_id is distinct from old.hook_id or new.tested_variable is distinct from old.tested_variable
    or new.primary_signal is distinct from old.primary_signal or new.hypothesis is distinct from old.hypothesis
    or new.recommendation is distinct from old.recommendation or new.confidence is distinct from old.confidence
    or new.diagnostic_snapshot is distinct from old.diagnostic_snapshot or new.diagnostic_fingerprint is distinct from old.diagnostic_fingerprint
    or new.source_kind is distinct from old.source_kind or new.prepared_by is distinct from old.prepared_by
    or new.prepared_by_agent is distinct from old.prepared_by_agent or new.prepared_at is distinct from old.prepared_at then
    raise exception 'La evidencia del diagnóstico es inmutable; prepará una versión nueva.';
  end if; return new;
end $$;
drop trigger if exists agency_retention_diagnostic_guard on public.agency_retention_diagnostics;
create trigger agency_retention_diagnostic_guard before update or delete on public.agency_retention_diagnostics
for each row execute function public._agency_retention_diagnostic_guard();

create or replace function public._agency_retention_learning_immutable() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  raise exception 'El aprendizaje aprobado es inmutable; una nueva evidencia requiere otro aprendizaje.';
end $$;
drop trigger if exists agency_retention_learning_immutable on public.agency_retention_learnings;
create trigger agency_retention_learning_immutable before update or delete on public.agency_retention_learnings
for each row execute function public._agency_retention_learning_immutable();

create or replace function public._preparar_diagnostico_retencion(p jsonb,p_actor text,p_agent text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_measure public.agency_retention_measurements%rowtype; v_exp public.agency_retention_experiments%rowtype;
  v_script public.agency_retention_scripts%rowtype; v_hook public.agency_retention_hooks%rowtype; v_loop public.agency_retention_loops%rowtype;
  v_beat jsonb; v_start numeric; v_end numeric; v_start_pct numeric; v_end_pct numeric; v_drop numeric;
  v_beats jsonb:='[]'::jsonb; v_loops jsonb:='[]'::jsonb; v_primary_drop numeric:=-999; v_primary_label text:='';
  v_key text:=btrim(coalesce(p->>'diagnostic_key','')); v_variable text:=p->>'tested_variable';
  v_hypothesis text:=btrim(coalesce(p->>'hypothesis','')); v_recommendation text:=btrim(coalesce(p->>'recommendation',''));
  v_scope jsonb; v_funnel jsonb; v_snapshot jsonb; v_fp text; v_id bigint; v_confidence text; v_signal text;
  v_source text:=case when p_actor is null then 'Agente' else 'Humano' end;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) then raise exception 'El diagnóstico es inválido o contiene secretos.'; end if;
  select * into v_measure from public.agency_retention_measurements where id=nullif(p->>'measurement_id','')::bigint;
  select * into v_exp from public.agency_retention_experiments where id=v_measure.experiment_id;
  select * into v_script from public.agency_retention_scripts where id=v_exp.script_id;
  select * into v_hook from public.agency_retention_hooks where id=v_measure.hook_id;
  if v_measure.id is null or v_exp.id is null or v_script.id is null or v_hook.id is null or v_hook.script_id<>v_script.id
    or v_measure.hook_id not in (v_exp.control_hook_id,v_exp.challenger_hook_id) then raise exception 'La medición no pertenece a un guion y variante íntegros.'; end if;
  if v_measure.sample_size<100 then raise exception 'Se requieren al menos 100 observaciones para preparar un aprendizaje.'; end if;
  if not public._agency_retention_curve_valid(v_measure.retention_curve,v_script.target_duration_sec) then
    raise exception 'La curva debe comenzar en 0, tener tres puntos crecientes y cubrir toda la duración del guion.'; end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,220}$' or v_variable not in ('Hook','Primer fotograma','Prueba temprana','Orden de beats','Payoff','CTA','Oferta')
    or length(v_hypothesis)<10 or length(v_recommendation)<10 then raise exception 'Faltan clave, variable única, hipótesis o recomendación verificables.'; end if;
  if jsonb_typeof(coalesce(v_script.script_snapshot->'beat_map','[]'))<>'array' or jsonb_array_length(coalesce(v_script.script_snapshot->'beat_map','[]'))<3 then
    raise exception 'El guion no conserva suficientes beats para localizar la caída.'; end if;

  for v_beat in select value from jsonb_array_elements(v_script.script_snapshot->'beat_map') loop
    v_start:=nullif(v_beat->>'start_sec','')::numeric; v_end:=nullif(v_beat->>'end_sec','')::numeric;
    if v_start is null or v_end is null or v_end<=v_start or v_end>v_script.target_duration_sec then raise exception 'El mapa de beats perdió integridad temporal.'; end if;
    v_start_pct:=public._agency_retention_curve_at(v_measure.retention_curve,v_start);
    v_end_pct:=public._agency_retention_curve_at(v_measure.retention_curve,v_end);
    v_drop:=round(((v_start_pct-v_end_pct)*100)::numeric,1);
    v_beats:=v_beats||jsonb_build_array(jsonb_build_object('beat',v_beat->'beat','label',v_beat->>'label','start_sec',v_start,'end_sec',v_end,
      'start_pct',v_start_pct,'end_pct',v_end_pct,'drop_pp',v_drop,'purpose',v_beat->>'purpose','visual',v_beat->>'visual'));
    if v_drop>v_primary_drop then v_primary_drop:=v_drop; v_primary_label:=coalesce(nullif(v_beat->>'label',''),'Beat'); end if;
  end loop;
  for v_loop in select * from public.agency_retention_loops where script_id=v_script.id order by open_sec loop
    v_start_pct:=public._agency_retention_curve_at(v_measure.retention_curve,v_loop.open_sec);
    v_end_pct:=public._agency_retention_curve_at(v_measure.retention_curve,v_loop.close_sec);
    v_loops:=v_loops||jsonb_build_array(jsonb_build_object('loop_id',v_loop.id,'loop_key',v_loop.loop_key,'question',v_loop.question,
      'open_sec',v_loop.open_sec,'close_sec',v_loop.close_sec,'open_pct',v_start_pct,'close_pct',v_end_pct,
      'drop_pp',round(((v_start_pct-v_end_pct)*100)::numeric,1),'payoff',v_loop.payoff));
  end loop;
  if jsonb_array_length(v_loops)=0 then raise exception 'El diagnóstico necesita al menos un loop sellado.'; end if;

  v_confidence:=case when v_measure.sample_size>=500 then 'Alta' when v_measure.sample_size>=200 then 'Media' else 'Inicial' end;
  v_signal:=format('La mayor caída observada coincide con “%s”: %s pp. Es una asociación temporal, no una causa demostrada.',v_primary_label,v_primary_drop);
  v_scope:=jsonb_build_object('platform',v_measure.platform,'audience',v_script.audience,'target_duration_sec',v_script.target_duration_sec,
    'script_id',v_script.id,'script_fingerprint',v_script.script_fingerprint,'experiment_id',v_exp.id,'experiment_fingerprint',v_exp.experiment_fingerprint,
    'hook_id',v_hook.id,'hook_fingerprint',v_hook.hook_fingerprint,'publication_fingerprint',v_measure.publication_fingerprint);
  v_funnel:=jsonb_build_object('sample_size',v_measure.sample_size,'impressions',v_measure.impressions,'starts',v_measure.starts,
    'start_rate',case when v_measure.impressions>0 then round((v_measure.starts::numeric/v_measure.impressions),4) else 0 end,
    'retention_3s',case when v_measure.starts>0 then round((v_measure.views_3s::numeric/v_measure.starts),4) else 0 end,
    'completion_rate',case when v_measure.starts>0 then round((v_measure.views_100::numeric/v_measure.starts),4) else 0 end,
    'click_rate',case when v_measure.starts>0 then round((v_measure.clicks::numeric/v_measure.starts),4) else 0 end,
    'paid_orders',v_measure.paid_orders,'incremental_profit',v_measure.incremental_profit);
  v_snapshot:=jsonb_build_object('schema_version',1,'measurement_id',v_measure.id,'scope',v_scope,'funnel',v_funnel,'curve',v_measure.retention_curve,
    'beat_observations',v_beats,'loop_observations',v_loops,'primary_signal',v_signal,'tested_variable',v_variable,'hypothesis',v_hypothesis,
    'recommendation',v_recommendation,'guardrails',jsonb_build_object('one_variable',true,'same_product',true,'same_audience',true,
      'same_offer',true,'same_duration',true,'human_approval',true,'no_auto_generation',true,'no_auto_publication',true));
  v_fp:=public._agency_mesa_fingerprint(v_snapshot);
  select id into v_id from public.agency_retention_diagnostics where measurement_id=v_measure.id and diagnostic_fingerprint=v_fp;
  if v_id is not null then return jsonb_build_object('ok',true,'diagnostic_id',v_id,'duplicate',true,'executed',false,'published',false); end if;
  insert into public.agency_retention_diagnostics(diagnostic_key,measurement_id,experiment_id,script_id,hook_id,tested_variable,primary_signal,
    hypothesis,recommendation,confidence,diagnostic_snapshot,diagnostic_fingerprint,source_kind,prepared_by,prepared_by_agent)
  values(v_key,v_measure.id,v_exp.id,v_script.id,v_hook.id,v_variable,v_signal,v_hypothesis,v_recommendation,v_confidence,v_snapshot,v_fp,
    v_source,p_actor,coalesce(p_agent,'')) returning id into v_id;
  perform public._add_audit('Aprendizaje retención',v_id::text,'Diagnóstico preparado','',format('Medición %s · %s · revisión humana obligatoria',v_measure.id,v_variable));
  return jsonb_build_object('ok',true,'diagnostic_id',v_id,'status','En revisión','confidence',v_confidence,
    'requires_human_approval',true,'executed',false,'generated',false,'published',false,'cost_cop',0);
end $$;

create or replace function public.preparar_diagnostico_retencion(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare v_actor public.users%rowtype; begin
  v_actor:=public._agency_actor(); return public._preparar_diagnostico_retencion(p,v_actor.id,null); end $$;

create or replace function public.proponer_diagnostico_retencion_agente(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
  return public._preparar_diagnostico_retencion(p,null,'Cerebro de Agencia MOMOS'); end $$;

create or replace function public.obtener_contexto_retencion_agente(p_measurement_id bigint) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('measurement_id',m.id,'platform',m.platform,'sample_size',m.sample_size,'funnel',jsonb_build_object(
    'impressions',m.impressions,'starts',m.starts,'views_3s',m.views_3s,'views_25',m.views_25,'views_50',m.views_50,
    'views_75',m.views_75,'views_100',m.views_100,'clicks',m.clicks,'paid_orders',m.paid_orders,'incremental_profit',m.incremental_profit),
    'retention_curve',m.retention_curve,'script',s.script_snapshot,'script_fingerprint',s.script_fingerprint,
    'experiment',e.experiment_snapshot,'experiment_fingerprint',e.experiment_fingerprint,'hook_fingerprint',h.hook_fingerprint)
  from public.agency_retention_measurements m join public.agency_retention_experiments e on e.id=m.experiment_id
  join public.agency_retention_scripts s on s.id=e.script_id join public.agency_retention_hooks h on h.id=m.hook_id
  where m.id=p_measurement_id
$$;

create or replace function public.resolver_diagnostico_retencion(p_diagnostic_id bigint,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_diag public.agency_retention_diagnostics%rowtype; v_learning_id bigint;
  v_learning_snapshot jsonb; v_learning_fp text; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor(); select * into v_diag from public.agency_retention_diagnostics where id=p_diagnostic_id for update;
  if v_diag.id is null or v_diag.status<>'En revisión' then raise exception 'El diagnóstico no espera revisión humana.'; end if;
  if v_diag.diagnostic_fingerprint<>public._agency_mesa_fingerprint(v_diag.diagnostic_snapshot) then raise exception 'El diagnóstico perdió integridad.'; end if;
  if p_decision='Devolver' then
    if length(v_note)<3 then raise exception 'Explicá qué debe revisar el cerebro.'; end if;
    update public.agency_retention_diagnostics set status='Devuelto',reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_diag.id;
    return jsonb_build_object('ok',true,'diagnostic_id',v_diag.id,'status','Devuelto','learning_created',false,'published',false);
  elsif p_decision<>'Aprobar' then raise exception 'La decisión debe ser Aprobar o Devolver.'; end if;
  if length(v_note)<5 then raise exception 'Documentá qué evidencia validaste y el alcance del aprendizaje.'; end if;
  v_learning_snapshot:=jsonb_build_object('schema_version',1,'diagnostic_id',v_diag.id,'diagnostic_fingerprint',v_diag.diagnostic_fingerprint,
    'scope',v_diag.diagnostic_snapshot->'scope','evidence',jsonb_build_object('funnel',v_diag.diagnostic_snapshot->'funnel',
      'beat_observations',v_diag.diagnostic_snapshot->'beat_observations','loop_observations',v_diag.diagnostic_snapshot->'loop_observations'),
    'tested_variable',v_diag.tested_variable,'hypothesis',v_diag.hypothesis,'recommendation',v_diag.recommendation,'human_note',v_note);
  v_learning_fp:=public._agency_mesa_fingerprint(v_learning_snapshot);
  insert into public.agency_retention_learnings(learning_key,diagnostic_id,platform,audience,target_duration_sec,tested_variable,statement,
    scope_snapshot,evidence_snapshot,learning_fingerprint,approved_by)
  values('diagnostic-'||v_diag.id,v_diag.id,v_diag.diagnostic_snapshot#>>'{scope,platform}',v_diag.diagnostic_snapshot#>>'{scope,audience}',
    (v_diag.diagnostic_snapshot#>>'{scope,target_duration_sec}')::numeric,v_diag.tested_variable,v_diag.hypothesis||' '||v_diag.recommendation,
    v_diag.diagnostic_snapshot->'scope',v_learning_snapshot,v_learning_fp,v_actor.id) returning id into v_learning_id;
  update public.agency_retention_diagnostics set status='Aprobado',reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_diag.id;
  perform public._add_audit('Aprendizaje retención',v_learning_id::text,'Aprendizaje aprobado','',format('Diagnóstico %s · alcance exacto',v_diag.id));
  return jsonb_build_object('ok',true,'diagnostic_id',v_diag.id,'learning_id',v_learning_id,'status','Aprobado',
    'automatic_scaling',false,'generation_started',false,'published',false,'cost_cop',0);
end $$;

do $$ declare v_name text; begin
  foreach v_name in array array['_agency_retention_curve_valid(jsonb,numeric)','_agency_retention_curve_at(jsonb,numeric)',
    '_agency_retention_diagnostic_guard()','_agency_retention_learning_immutable()','_preparar_diagnostico_retencion(jsonb,text,text)'] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',v_name);
  end loop;
end $$;
revoke all on function public.retencion_loops_disponible() from public,anon;
revoke all on function public.preparar_diagnostico_retencion(jsonb) from public,anon;
revoke all on function public.resolver_diagnostico_retencion(bigint,text,text) from public,anon;
revoke all on function public.proponer_diagnostico_retencion_agente(jsonb) from public,anon,authenticated;
revoke all on function public.obtener_contexto_retencion_agente(bigint) from public,anon,authenticated;
grant execute on function public.retencion_loops_disponible() to authenticated;
grant execute on function public.preparar_diagnostico_retencion(jsonb) to authenticated;
grant execute on function public.resolver_diagnostico_retencion(bigint,text,text) to authenticated;
grant execute on function public.proponer_diagnostico_retencion_agente(jsonb) to service_role;
grant execute on function public.obtener_contexto_retencion_agente(bigint) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_35_experiencia_loops','Diagnóstico por beats y loops, evidencia exacta, aprendizaje humano aprobado y no publicación')
on conflict(id) do update set detalle=excluded.detalle;

commit;
