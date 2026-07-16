-- MOMOS OPS · Retención y aprendizaje económico v1.
-- Paso 34. Versiona guiones, hooks, loops, experimentos y mediciones exactas.
-- No genera, no pauta y no publica.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_33_calidad_postproduccion'
  ) then raise exception 'Falta el paso 33_calidad_postproduccion.'; end if;
end $$;

create table if not exists public.agency_retention_scripts(
  id bigint generated always as identity primary key,
  script_key text not null unique check(script_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  contract_id bigint not null references public.agency_creative_contracts(id) on delete restrict,
  version integer not null check(version>0),
  title text not null check(length(btrim(title)) between 3 and 180),
  status text not null default 'En revisión' check(status in ('En revisión','Aprobado','Devuelto','Sustituido','Anulado')),
  platform text not null check(platform in ('Instagram Reels','TikTok','YouTube Shorts','Meta Ads','Multicanal')),
  target_duration_sec numeric(7,2) not null check(target_duration_sec between 5 and 180),
  objective text not null check(length(btrim(objective)) between 3 and 500),
  audience text not null check(length(btrim(audience)) between 2 and 500),
  promise text not null check(length(btrim(promise)) between 3 and 700),
  payoff text not null check(length(btrim(payoff)) between 3 and 700),
  source_kind text not null check(source_kind in ('Humano','Agente')),
  script_snapshot jsonb not null check(jsonb_typeof(script_snapshot)='object'),
  script_fingerprint text not null check(script_fingerprint ~ '^[0-9a-f]{32}$'),
  prepared_by text references public.users(id), prepared_by_agent text not null default '', prepared_at timestamptz not null default now(),
  reviewed_by text references public.users(id), reviewed_at timestamptz, review_note text not null default '',
  unique(contract_id,version), unique(contract_id,script_fingerprint),
  check((source_kind='Humano' and prepared_by is not null and prepared_by_agent='') or
        (source_kind='Agente' and prepared_by is null and length(btrim(prepared_by_agent)) between 2 and 100))
);
create index if not exists agency_retention_scripts_status_idx on public.agency_retention_scripts(status,prepared_at desc);

create table if not exists public.agency_retention_hooks(
  id bigint generated always as identity primary key,
  script_id bigint not null references public.agency_retention_scripts(id) on delete restrict,
  variant_key text not null check(variant_key ~ '^[A-Za-z0-9:_-]{1,80}$'),
  label text not null check(length(btrim(label)) between 2 and 100),
  mechanism text not null check(mechanism in ('Resultado primero','Contraste','Demostración','Pregunta','Especificidad')),
  hook_text text not null check(length(btrim(hook_text)) between 3 and 500),
  opening_visual text not null check(length(btrim(opening_visual)) between 3 and 700),
  proof text not null check(length(btrim(proof)) between 3 and 700),
  scores jsonb not null check(jsonb_typeof(scores)='object'), score_total integer not null check(score_total between 0 and 16),
  selected boolean not null default false, hook_fingerprint text not null check(hook_fingerprint ~ '^[0-9a-f]{32}$'),
  unique(script_id,variant_key), unique(script_id,hook_fingerprint)
);
create unique index if not exists agency_retention_hooks_one_selected_idx on public.agency_retention_hooks(script_id) where selected;

create table if not exists public.agency_retention_loops(
  id bigint generated always as identity primary key,
  script_id bigint not null references public.agency_retention_scripts(id) on delete restrict,
  loop_key text not null check(loop_key ~ '^[A-Za-z0-9:_-]{1,80}$'),
  question text not null check(length(btrim(question)) between 3 and 500),
  open_sec numeric(7,2) not null check(open_sec>=0), partial_payoff_sec numeric(7,2),
  close_sec numeric(7,2) not null, payoff text not null check(length(btrim(payoff)) between 3 and 700),
  loop_fingerprint text not null check(loop_fingerprint ~ '^[0-9a-f]{32}$'),
  unique(script_id,loop_key), check(close_sec>open_sec),
  check(partial_payoff_sec is null or (partial_payoff_sec>open_sec and partial_payoff_sec<close_sec))
);

create table if not exists public.agency_retention_experiments(
  id bigint generated always as identity primary key,
  experiment_key text not null unique check(experiment_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  script_id bigint not null references public.agency_retention_scripts(id) on delete restrict,
  control_hook_id bigint not null references public.agency_retention_hooks(id) on delete restrict,
  challenger_hook_id bigint not null references public.agency_retention_hooks(id) on delete restrict,
  declared_variable text not null check(declared_variable in ('Hook','Primer fotograma','CTA','Oferta')),
  hypothesis text not null check(length(btrim(hypothesis)) between 10 and 1200),
  primary_metric text not null check(primary_metric in ('Retención 3 s','Retención 50 %','Finalización','CTR','Pedidos pagados','Beneficio incremental')),
  status text not null default 'Planificado' check(status in ('Planificado','Activo','Cerrado','Inconcluso','Cancelado')),
  experiment_snapshot jsonb not null check(jsonb_typeof(experiment_snapshot)='object'),
  experiment_fingerprint text not null check(experiment_fingerprint ~ '^[0-9a-f]{32}$'),
  created_by text not null references public.users(id), created_at timestamptz not null default now(),
  resolved_by text references public.users(id), resolved_at timestamptz, resolution text not null default '', winner_hook_id bigint references public.agency_retention_hooks(id),
  check(control_hook_id<>challenger_hook_id)
);

create table if not exists public.agency_retention_measurements(
  id bigint generated always as identity primary key,
  measurement_key text not null unique check(measurement_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  experiment_id bigint not null references public.agency_retention_experiments(id) on delete restrict,
  hook_id bigint not null references public.agency_retention_hooks(id) on delete restrict,
  content_post_id text references public.content_posts(id) on delete restrict,
  platform text not null, captured_at timestamptz not null,
  sample_size integer not null check(sample_size>=0), impressions integer not null check(impressions>=0), starts integer not null check(starts>=0),
  views_3s integer not null check(views_3s>=0), views_25 integer not null check(views_25>=0), views_50 integer not null check(views_50>=0),
  views_75 integer not null check(views_75>=0), views_100 integer not null check(views_100>=0),
  watch_time_sec numeric(16,2) not null check(watch_time_sec>=0), clicks integer not null check(clicks>=0),
  paid_orders integer not null check(paid_orders>=0), attributed_revenue numeric(16,2) not null check(attributed_revenue>=0),
  attributed_margin numeric(16,2) not null, incremental_profit numeric(16,2) not null,
  retention_curve jsonb not null check(jsonb_typeof(retention_curve)='array'), attribution_snapshot jsonb not null check(jsonb_typeof(attribution_snapshot)='object'),
  publication_fingerprint text not null check(publication_fingerprint ~ '^[0-9a-f]{32}$'),
  source_kind text not null check(source_kind in ('Humano','Conector')),
  recorded_by text references public.users(id), recorded_by_connector text not null default '', created_at timestamptz not null default now(),
  check(starts<=impressions and views_3s<=starts and views_25<=views_3s and views_50<=views_25 and views_75<=views_50 and views_100<=views_75),
  check((source_kind='Humano' and recorded_by is not null and recorded_by_connector='') or
        (source_kind='Conector' and recorded_by is null and length(btrim(recorded_by_connector)) between 2 and 100))
);
create index if not exists agency_retention_measurements_experiment_idx on public.agency_retention_measurements(experiment_id,hook_id,captured_at);

alter table public.agency_retention_scripts enable row level security;
alter table public.agency_retention_hooks enable row level security;
alter table public.agency_retention_loops enable row level security;
alter table public.agency_retention_experiments enable row level security;
alter table public.agency_retention_measurements enable row level security;
do $$ declare v_table text; begin
  foreach v_table in array array['agency_retention_scripts','agency_retention_hooks','agency_retention_loops','agency_retention_experiments','agency_retention_measurements'] loop
    execute format('drop policy if exists staff_read on public.%I',v_table);
    execute format('create policy staff_read on public.%I for select to authenticated using(public.is_staff())',v_table);
    execute format('revoke insert,update,delete on public.%I from public,anon,authenticated',v_table);
    execute format('grant select on public.%I to authenticated',v_table);
  end loop;
end $$;

create or replace function public.retencion_guiones_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_retention_scores_valid(p jsonb) returns boolean
language sql immutable security definer set search_path=public as $$
  select jsonb_typeof(p)='object' and (select count(*) from jsonb_object_keys(p))=8 and not exists(
    select 1 from jsonb_each_text(p) e where e.key not in ('clarity','relevance','specificity','proof','novelty','payoff_fit','brand_fit','honesty') or e.value !~ '^[0-2]$'
  )
$$;

create or replace function public._agency_retention_hook_eligible(p jsonb) returns boolean
language sql immutable security definer set search_path=public as $$
  select public._agency_retention_scores_valid(p) and (p->>'proof')::int=2 and (p->>'honesty')::int=2
    and (p->>'payoff_fit')::int=2 and (select sum(value::int) from jsonb_each_text(p))>=12
$$;

create or replace function public._agency_retention_immutable() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'El aprendizaje de retención no se elimina.'; end if;
  if tg_table_name in ('agency_retention_hooks','agency_retention_loops','agency_retention_measurements') then
    raise exception 'La evidencia de retención es inmutable; registrá una versión nueva.';
  end if;
  return new;
end $$;
do $$ declare v_table text; begin
  foreach v_table in array array['agency_retention_hooks','agency_retention_loops','agency_retention_measurements'] loop
    execute format('drop trigger if exists agency_retention_immutable on public.%I',v_table);
    execute format('create trigger agency_retention_immutable before update or delete on public.%I for each row execute function public._agency_retention_immutable()',v_table);
  end loop;
end $$;

create or replace function public._agency_retention_script_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'Los guiones no se eliminan.'; end if;
  if new.script_key is distinct from old.script_key or new.contract_id is distinct from old.contract_id or new.version is distinct from old.version
    or new.platform is distinct from old.platform or new.target_duration_sec is distinct from old.target_duration_sec
    or new.promise is distinct from old.promise or new.payoff is distinct from old.payoff or new.script_snapshot is distinct from old.script_snapshot
    or new.script_fingerprint is distinct from old.script_fingerprint or new.prepared_by is distinct from old.prepared_by
    or new.prepared_by_agent is distinct from old.prepared_by_agent or new.prepared_at is distinct from old.prepared_at then
    raise exception 'El guion sellado no se reescribe; prepará una versión nueva.';
  end if; return new;
end $$;
drop trigger if exists agency_retention_script_guard on public.agency_retention_scripts;
create trigger agency_retention_script_guard before update or delete on public.agency_retention_scripts for each row execute function public._agency_retention_script_guard();

create or replace function public._preparar_guion_retencion(p jsonb,p_actor text,p_agent text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_contract public.agency_creative_contracts%rowtype; v_id bigint; v_version int; v_snapshot jsonb; v_fp text;
  v_key text:=btrim(coalesce(p->>'script_key','')); v_contract_id bigint:=nullif(p->>'contract_id','')::bigint;
  v_duration numeric:=coalesce(nullif(p->>'target_duration_sec','')::numeric,0); v_hooks jsonb:=coalesce(p->'hooks','[]'); v_loops jsonb:=coalesce(p->'loops','[]');
  v_hook jsonb; v_loop jsonb; v_score int; v_selected int:=0; v_source text:=case when p_actor is null then 'Agente' else 'Humano' end;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) then raise exception 'El guion es inválido o contiene secretos.'; end if;
  select * into v_contract from public.agency_creative_contracts where id=v_contract_id for update;
  if v_contract.id is null or v_contract.status<>'Aprobado' then raise exception 'El guion requiere un contrato creativo aprobado.'; end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,220}$' or v_duration not between 5 and 180 or jsonb_typeof(v_hooks)<>'array' or jsonb_array_length(v_hooks)<2
    or jsonb_typeof(v_loops)<>'array' or jsonb_array_length(v_loops)<1 or jsonb_typeof(coalesce(p->'beat_map','[]'))<>'array'
    or jsonb_array_length(coalesce(p->'beat_map','[]'))<3 then raise exception 'El guion necesita clave, duración, dos hooks, tres bloques y un loop.'; end if;
  if length(btrim(coalesce(p->>'promise','')))<3 or length(btrim(coalesce(p->>'payoff','')))<3 or length(btrim(coalesce(p->>'call_to_action','')))<2 then
    raise exception 'Faltan promesa, payoff o CTA verificables.'; end if;
  for v_hook in select value from jsonb_array_elements(v_hooks) loop
    if not public._agency_retention_scores_valid(coalesce(v_hook->'scores','{}')) or length(btrim(coalesce(v_hook->>'hook_text','')))<3
      or length(btrim(coalesce(v_hook->>'opening_visual','')))<3 or length(btrim(coalesce(v_hook->>'proof','')))<3 then
      raise exception 'Cada hook necesita texto, primer fotograma, prueba y ocho puntajes 0-2.'; end if;
    if coalesce((v_hook->>'selected')::boolean,false) then v_selected:=v_selected+1; end if;
  end loop;
  if v_selected<>1 then raise exception 'Seleccioná exactamente un hook para esta versión.'; end if;
  for v_loop in select value from jsonb_array_elements(v_loops) loop
    if coalesce(nullif(v_loop->>'open_sec','')::numeric,-1)<0 or coalesce(nullif(v_loop->>'close_sec','')::numeric,0)<=coalesce(nullif(v_loop->>'open_sec','')::numeric,-1)
      or coalesce(nullif(v_loop->>'close_sec','')::numeric,999)>v_duration or length(btrim(coalesce(v_loop->>'question','')))<3 or length(btrim(coalesce(v_loop->>'payoff','')))<3 then
      raise exception 'Cada loop debe abrir y cerrar su promesa dentro de la pieza.'; end if;
  end loop;
  v_snapshot:=jsonb_build_object('schema_version',1,'contract_id',v_contract.id,'contract_fingerprint',v_contract.contract_fingerprint,
    'objective',p->>'objective','audience',p->>'audience','promise',p->>'promise','payoff',p->>'payoff','call_to_action',p->>'call_to_action',
    'evidence_plan',coalesce(p->'evidence_plan','{}'),'beat_map',p->'beat_map','loops',v_loops,'hooks',v_hooks);
  v_fp:=public._agency_mesa_fingerprint(v_snapshot);
  select id into v_id from public.agency_retention_scripts where contract_id=v_contract.id and script_fingerprint=v_fp;
  if v_id is not null then return jsonb_build_object('ok',true,'script_id',v_id,'duplicate',true,'executed',false,'published',false); end if;
  perform pg_advisory_xact_lock(hashtext('retention-script:'||v_contract.id));
  select coalesce(max(version),0)+1 into v_version from public.agency_retention_scripts where contract_id=v_contract.id;
  insert into public.agency_retention_scripts(script_key,contract_id,version,title,platform,target_duration_sec,objective,audience,promise,payoff,
    source_kind,script_snapshot,script_fingerprint,prepared_by,prepared_by_agent)
  values(v_key,v_contract.id,v_version,btrim(p->>'title'),p->>'platform',v_duration,btrim(p->>'objective'),btrim(p->>'audience'),btrim(p->>'promise'),btrim(p->>'payoff'),
    v_source,v_snapshot,v_fp,p_actor,coalesce(p_agent,'')) returning id into v_id;
  for v_hook in select value from jsonb_array_elements(v_hooks) loop
    select sum(value::int) into v_score from jsonb_each_text(v_hook->'scores');
    insert into public.agency_retention_hooks(script_id,variant_key,label,mechanism,hook_text,opening_visual,proof,scores,score_total,selected,hook_fingerprint)
    values(v_id,v_hook->>'variant_key',v_hook->>'label',v_hook->>'mechanism',v_hook->>'hook_text',v_hook->>'opening_visual',v_hook->>'proof',v_hook->'scores',v_score,
      coalesce((v_hook->>'selected')::boolean,false),public._agency_mesa_fingerprint(v_hook));
  end loop;
  for v_loop in select value from jsonb_array_elements(v_loops) loop
    insert into public.agency_retention_loops(script_id,loop_key,question,open_sec,partial_payoff_sec,close_sec,payoff,loop_fingerprint)
    values(v_id,v_loop->>'loop_key',v_loop->>'question',(v_loop->>'open_sec')::numeric,nullif(v_loop->>'partial_payoff_sec','')::numeric,
      (v_loop->>'close_sec')::numeric,v_loop->>'payoff',public._agency_mesa_fingerprint(v_loop));
  end loop;
  perform public._add_audit('Guion retención',v_id::text,'Guion preparado','',format('Contrato %s · V%s · no ejecutado',v_contract.id,v_version));
  return jsonb_build_object('ok',true,'script_id',v_id,'version',v_version,'status','En revisión','executed',false,'published',false,'cost_cop',0);
end $$;

create or replace function public.preparar_guion_retencion(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare v_actor public.users%rowtype; begin v_actor:=public._agency_actor(); return public._preparar_guion_retencion(p,v_actor.id,null); end $$;
create or replace function public.proponer_guion_retencion_agente(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ begin return public._preparar_guion_retencion(p,null,'Cerebro de Agencia MOMOS'); end $$;

create or replace function public.resolver_guion_retencion(p_script_id bigint,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_script public.agency_retention_scripts%rowtype; v_hook public.agency_retention_hooks%rowtype;
begin
  v_actor:=public._agency_actor(); select * into v_script from public.agency_retention_scripts where id=p_script_id for update;
  if v_script.id is null or v_script.status not in ('En revisión','Devuelto') then raise exception 'El guion no espera resolución.'; end if;
  if p_decision not in ('Aprobar','Devolver') then raise exception 'Decisión inválida.'; end if;
  if p_decision='Devolver' then
    if length(btrim(coalesce(p_note,'')))<3 then raise exception 'Explicá qué debe corregirse.'; end if;
    update public.agency_retention_scripts set status='Devuelto',reviewed_by=v_actor.id,reviewed_at=now(),review_note=btrim(p_note) where id=v_script.id;
    return jsonb_build_object('ok',true,'script_id',v_script.id,'status','Devuelto','published',false);
  end if;
  select * into v_hook from public.agency_retention_hooks where script_id=v_script.id and selected;
  if v_hook.id is null or not public._agency_retention_hook_eligible(v_hook.scores) then raise exception 'El hook seleccionado no supera prueba, honestidad, payoff y 12/16.'; end if;
  if not exists(select 1 from public.agency_retention_loops where script_id=v_script.id and close_sec<=v_script.target_duration_sec) then raise exception 'El guion no cierra ningún loop.'; end if;
  if not exists(select 1 from public.agency_creative_contracts where id=v_script.contract_id and status='Aprobado'
    and contract_fingerprint=v_script.script_snapshot->>'contract_fingerprint') then raise exception 'El contrato de origen cambió o dejó de estar aprobado.'; end if;
  update public.agency_retention_scripts set status='Sustituido',review_note='Sustituido por una versión posterior aprobada.' where contract_id=v_script.contract_id and status='Aprobado' and id<>v_script.id;
  update public.agency_retention_scripts set status='Aprobado',reviewed_by=v_actor.id,reviewed_at=now(),review_note=btrim(coalesce(p_note,'')) where id=v_script.id;
  perform public._add_audit('Guion retención',v_script.id::text,'Guion aprobado','En revisión','Aprobado · no publicado');
  return jsonb_build_object('ok',true,'script_id',v_script.id,'status','Aprobado','selected_hook_id',v_hook.id,'published',false,'generation_started',false,'cost_cop',0);
end $$;

create or replace function public.crear_experimento_retencion(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_script public.agency_retention_scripts%rowtype; v_control public.agency_retention_hooks%rowtype; v_challenger public.agency_retention_hooks%rowtype;
  v_snapshot jsonb; v_id bigint;
begin
  v_actor:=public._agency_actor(); select * into v_script from public.agency_retention_scripts where id=nullif(p->>'script_id','')::bigint;
  select * into v_control from public.agency_retention_hooks where id=nullif(p->>'control_hook_id','')::bigint;
  select * into v_challenger from public.agency_retention_hooks where id=nullif(p->>'challenger_hook_id','')::bigint;
  if v_script.status<>'Aprobado' or v_control.script_id<>v_script.id or v_challenger.script_id<>v_script.id or v_control.id=v_challenger.id then raise exception 'El experimento requiere dos hooks distintos del mismo guion aprobado.'; end if;
  if p->>'declared_variable' not in ('Hook','Primer fotograma','CTA','Oferta') or length(btrim(coalesce(p->>'hypothesis','')))<10 then raise exception 'Declaración de variable o hipótesis inválida.'; end if;
  v_snapshot:=jsonb_build_object('schema_version',1,'script_id',v_script.id,'script_fingerprint',v_script.script_fingerprint,'control_hook_fingerprint',v_control.hook_fingerprint,
    'challenger_hook_fingerprint',v_challenger.hook_fingerprint,'declared_variable',p->>'declared_variable','hypothesis',p->>'hypothesis','primary_metric',p->>'primary_metric',
    'guardrails',coalesce(p->'guardrails','{}'));
  insert into public.agency_retention_experiments(experiment_key,script_id,control_hook_id,challenger_hook_id,declared_variable,hypothesis,primary_metric,
    experiment_snapshot,experiment_fingerprint,created_by)
  values(p->>'experiment_key',v_script.id,v_control.id,v_challenger.id,p->>'declared_variable',p->>'hypothesis',p->>'primary_metric',v_snapshot,
    public._agency_mesa_fingerprint(v_snapshot),v_actor.id) returning id into v_id;
  return jsonb_build_object('ok',true,'experiment_id',v_id,'status','Planificado','published',false,'spend_authorized',false);
end $$;

create or replace function public._registrar_medicion_retencion(p jsonb,p_actor text,p_connector text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_exp public.agency_retention_experiments%rowtype; v_hook bigint:=nullif(p->>'hook_id','')::bigint; v_id bigint; v_source text:=case when p_actor is null then 'Conector' else 'Humano' end;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) then raise exception 'Medición inválida o con secretos.'; end if;
  select * into v_exp from public.agency_retention_experiments where id=nullif(p->>'experiment_id','')::bigint;
  if v_exp.id is null or v_exp.status not in ('Planificado','Activo') or v_hook not in (v_exp.control_hook_id,v_exp.challenger_hook_id) then raise exception 'La medición no pertenece a un experimento medible.'; end if;
  insert into public.agency_retention_measurements(measurement_key,experiment_id,hook_id,content_post_id,platform,captured_at,sample_size,impressions,starts,
    views_3s,views_25,views_50,views_75,views_100,watch_time_sec,clicks,paid_orders,attributed_revenue,attributed_margin,incremental_profit,
    retention_curve,attribution_snapshot,publication_fingerprint,source_kind,recorded_by,recorded_by_connector)
  values(p->>'measurement_key',v_exp.id,v_hook,nullif(p->>'content_post_id',''),p->>'platform',(p->>'captured_at')::timestamptz,
    (p->>'sample_size')::int,(p->>'impressions')::int,(p->>'starts')::int,(p->>'views_3s')::int,(p->>'views_25')::int,(p->>'views_50')::int,
    (p->>'views_75')::int,(p->>'views_100')::int,(p->>'watch_time_sec')::numeric,(p->>'clicks')::int,(p->>'paid_orders')::int,
    (p->>'attributed_revenue')::numeric,(p->>'attributed_margin')::numeric,(p->>'incremental_profit')::numeric,p->'retention_curve',p->'attribution_snapshot',
    p->>'publication_fingerprint',v_source,p_actor,coalesce(p_connector,'')) returning id into v_id;
  update public.agency_retention_experiments set status='Activo' where id=v_exp.id and status='Planificado';
  return jsonb_build_object('ok',true,'measurement_id',v_id,'experiment_id',v_exp.id,'published',false);
end $$;

create or replace function public.registrar_medicion_retencion(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare v_actor public.users%rowtype; begin v_actor:=public._agency_actor(); return public._registrar_medicion_retencion(p,v_actor.id,null); end $$;
create or replace function public.registrar_medicion_retencion_conector(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ begin return public._registrar_medicion_retencion(p,null,'MOMO OPS Metrics Connector'); end $$;

create or replace function public.cerrar_experimento_retencion(p_experiment_id bigint,p_resolution text,p_winner_hook_id bigint,p_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_exp public.agency_retention_experiments%rowtype; v_control int; v_challenger int;
begin
  v_actor:=public._agency_actor(); select * into v_exp from public.agency_retention_experiments where id=p_experiment_id for update;
  if v_exp.id is null or v_exp.status not in ('Planificado','Activo') or p_resolution not in ('Ganador','Inconcluso','Cancelar') then raise exception 'Resolución inválida.'; end if;
  select coalesce(sum(sample_size),0) into v_control from public.agency_retention_measurements where experiment_id=v_exp.id and hook_id=v_exp.control_hook_id;
  select coalesce(sum(sample_size),0) into v_challenger from public.agency_retention_measurements where experiment_id=v_exp.id and hook_id=v_exp.challenger_hook_id;
  if p_resolution='Ganador' and (p_winner_hook_id not in (v_exp.control_hook_id,v_exp.challenger_hook_id) or least(v_control,v_challenger)<100) then
    raise exception 'No se puede declarar ganador sin ambas variantes y al menos 100 observaciones por brazo.'; end if;
  if p_resolution='Ganador' and length(btrim(coalesce(p_note,'')))<10 then raise exception 'Documentá atribución, muestra y criterio del ganador.'; end if;
  update public.agency_retention_experiments set status=case p_resolution when 'Ganador' then 'Cerrado' when 'Inconcluso' then 'Inconcluso' else 'Cancelado' end,
    resolved_by=v_actor.id,resolved_at=now(),resolution=btrim(coalesce(p_note,'')),winner_hook_id=case when p_resolution='Ganador' then p_winner_hook_id else null end where id=v_exp.id;
  return jsonb_build_object('ok',true,'experiment_id',v_exp.id,'status',(select status from public.agency_retention_experiments where id=v_exp.id),
    'control_sample',v_control,'challenger_sample',v_challenger,'published',false,'automatic_scaling',false);
end $$;

do $$ declare v_table text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['agency_retention_scripts','agency_retention_hooks','agency_retention_loops','agency_retention_experiments','agency_retention_measurements'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

revoke all on function public.retencion_guiones_disponible() from public,anon;
revoke all on function public._agency_retention_scores_valid(jsonb) from public,anon,authenticated;
revoke all on function public._agency_retention_hook_eligible(jsonb) from public,anon,authenticated;
revoke all on function public._agency_retention_immutable() from public,anon,authenticated;
revoke all on function public._agency_retention_script_guard() from public,anon,authenticated;
revoke all on function public._preparar_guion_retencion(jsonb,text,text) from public,anon,authenticated;
revoke all on function public.preparar_guion_retencion(jsonb) from public,anon,authenticated;
revoke all on function public.proponer_guion_retencion_agente(jsonb) from public,anon,authenticated;
revoke all on function public.resolver_guion_retencion(bigint,text,text) from public,anon,authenticated;
revoke all on function public.crear_experimento_retencion(jsonb) from public,anon,authenticated;
revoke all on function public._registrar_medicion_retencion(jsonb,text,text) from public,anon,authenticated;
revoke all on function public.registrar_medicion_retencion(jsonb) from public,anon,authenticated;
revoke all on function public.registrar_medicion_retencion_conector(jsonb) from public,anon,authenticated;
revoke all on function public.cerrar_experimento_retencion(bigint,text,bigint,text) from public,anon,authenticated;
grant execute on function public.retencion_guiones_disponible() to authenticated;
grant execute on function public.preparar_guion_retencion(jsonb) to authenticated;
grant execute on function public.resolver_guion_retencion(bigint,text,text) to authenticated;
grant execute on function public.crear_experimento_retencion(jsonb) to authenticated;
grant execute on function public.registrar_medicion_retencion(jsonb) to authenticated;
grant execute on function public.cerrar_experimento_retencion(bigint,text,bigint,text) to authenticated;
grant execute on function public.proponer_guion_retencion_agente(jsonb) to service_role;
grant execute on function public.registrar_medicion_retencion_conector(jsonb) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_34_retencion_aprendizaje','Guiones, hooks, loops y experimentos versionados con prueba, aprobación humana y aprendizaje económico exacto')
on conflict(id) do update set detalle=excluded.detalle;

commit;
