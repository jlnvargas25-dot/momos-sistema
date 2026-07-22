-- MOMOS OPS · Experiencia de dirección de motion v1.
-- Paso 36. Storyboard aprobado → receta de motion aprobada → enrutador. Nunca publica.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_35_experiencia_loops'
  ) then raise exception 'Falta el paso 35_experiencia_loops.'; end if;
end $$;

create table if not exists public.agency_motion_plans(
  id bigint generated always as identity primary key,
  plan_key text not null unique check(plan_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  storyboard_id bigint not null references public.agency_storyboards(id) on delete restrict,
  version integer not null check(version>0),
  status text not null default 'En revisión' check(status in ('En revisión','Aprobado','Devuelto','Sustituido','Anulado')),
  grammar_primary text not null check(grammar_primary in ('Información y POV','Movimiento y energía','Claridad y blocking','Impulso y compresión','Precisión y control')),
  grammar_secondary text not null default '' check(grammar_secondary='' or grammar_secondary in ('Información y POV','Movimiento y energía','Claridad y blocking','Impulso y compresión','Precisión y control')),
  continuity_ledger jsonb not null check(jsonb_typeof(continuity_ledger)='object'),
  plan_snapshot jsonb not null check(jsonb_typeof(plan_snapshot)='object'),
  plan_fingerprint text not null check(plan_fingerprint ~ '^[0-9a-f]{32}$'),
  estimated_preview_cost_cop numeric(16,2) not null default 0 check(estimated_preview_cost_cop>=0),
  source_kind text not null check(source_kind in ('Humano','Agente')),
  prepared_by text references public.users(id), prepared_by_agent text not null default '', prepared_at timestamptz not null default now(),
  reviewed_by text references public.users(id), reviewed_at timestamptz, review_note text not null default '',
  unique(storyboard_id,version), unique(storyboard_id,plan_fingerprint),
  check((source_kind='Humano' and prepared_by is not null and prepared_by_agent='') or
        (source_kind='Agente' and prepared_by is null and length(btrim(prepared_by_agent)) between 2 and 100))
);
create unique index if not exists agency_motion_one_approved_idx on public.agency_motion_plans(storyboard_id) where status='Aprobado';
create index if not exists agency_motion_status_idx on public.agency_motion_plans(status,prepared_at desc);

create table if not exists public.agency_motion_recipes(
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.agency_motion_plans(id) on delete restrict,
  storyboard_id bigint not null references public.agency_storyboards(id) on delete restrict,
  shot_id bigint not null references public.agency_storyboard_shots(id) on delete restrict,
  shot_number integer not null check(shot_number>0),
  shot_fingerprint text not null check(shot_fingerprint ~ '^[0-9a-f]{32}$'),
  selected_key text not null check(selected_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  proposals jsonb not null check(jsonb_typeof(proposals)='array' and jsonb_array_length(proposals) between 1 and 3),
  selected_recipe jsonb not null check(jsonb_typeof(selected_recipe)='object'),
  recipe_fingerprint text not null check(recipe_fingerprint ~ '^[0-9a-f]{32}$'),
  estimated_preview_cost_cop numeric(16,2) not null default 0 check(estimated_preview_cost_cop>=0),
  created_at timestamptz not null default now(),
  unique(plan_id,shot_id), unique(plan_id,shot_number)
);
create index if not exists agency_motion_recipes_shot_idx on public.agency_motion_recipes(shot_id,created_at desc);

create table if not exists public.agency_motion_observations(
  id bigint generated always as identity primary key,
  observation_key text not null unique check(observation_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  plan_id bigint not null references public.agency_motion_plans(id) on delete restrict,
  recipe_id bigint not null references public.agency_motion_recipes(id) on delete restrict,
  shot_id bigint not null references public.agency_storyboard_shots(id) on delete restrict,
  job_id bigint not null unique references public.creative_generation_jobs(id) on delete restrict,
  quality_review_id bigint references public.agency_scene_quality_reviews(id) on delete restrict,
  provider text not null check(length(btrim(provider)) between 2 and 80), model text not null check(length(btrim(model)) between 1 and 120),
  model_version text not null default '', effective_parameters jsonb not null check(jsonb_typeof(effective_parameters)='object'),
  actual_cost_cop numeric(16,2) not null check(actual_cost_cop>=0), runtime_sec numeric(16,2) not null check(runtime_sec>=0),
  attempts integer not null check(attempts between 1 and 100), errors jsonb not null check(jsonb_typeof(errors)='array'),
  manual_corrections jsonb not null check(jsonb_typeof(manual_corrections)='array'),
  qa_snapshot jsonb not null check(jsonb_typeof(qa_snapshot)='object'), attention_snapshot jsonb not null check(jsonb_typeof(attention_snapshot)='object'),
  observation_fingerprint text not null check(observation_fingerprint ~ '^[0-9a-f]{32}$'),
  recorded_by_connector text not null check(length(btrim(recorded_by_connector)) between 2 and 100), recorded_at timestamptz not null default now()
);
create index if not exists agency_motion_observations_recipe_idx on public.agency_motion_observations(recipe_id,recorded_at desc);

alter table public.agency_motion_plans enable row level security;
alter table public.agency_motion_recipes enable row level security;
alter table public.agency_motion_observations enable row level security;
do $$ declare v_table text; begin
  foreach v_table in array array['agency_motion_plans','agency_motion_recipes','agency_motion_observations'] loop
    execute format('drop policy if exists staff_read on public.%I',v_table);
    execute format('create policy staff_read on public.%I for select to authenticated using(public.is_staff())',v_table);
    execute format('revoke insert,update,delete on public.%I from public,anon,authenticated',v_table);
    execute format('grant select on public.%I to authenticated',v_table);
  end loop;
end $$;

create or replace function public.motion_experience_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._motion_proposal_valid(p jsonb) returns boolean
language plpgsql immutable security definer set search_path=public as $$
declare v_key text; v_object text; v_job text;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) then return false; end if;
  v_key:=btrim(coalesce(p->>'proposal_key','')); v_job:=p#>>'{intent,narrative_job}';
  if v_key !~ '^[A-Za-z0-9:_-]{3,220}$' or length(btrim(coalesce(p->>'label',''))) not between 3 and 160
     or v_job not in ('Orientar','Revelar','Intensificar','Demostrar','Humanizar','Cerrar') then return false; end if;
  foreach v_object in array array['intent','framing_lens','camera_path','handheld_profile','motion_blur_focus','lighting_map','continuity','physics','transition_to_next'] loop
    if jsonb_typeof(p->v_object)<>'object' then return false; end if;
  end loop;
  return length(btrim(coalesce(p->>'generation_prompt',''))) between 80 and 8000
    and jsonb_typeof(p->'negative_constraints')='array' and jsonb_array_length(p->'negative_constraints')>=6
    and jsonb_typeof(p->'acceptance_tests')='array' and jsonb_array_length(p->'acceptance_tests')>=5
    and jsonb_typeof(p->'provider_assumptions')='array'
    and coalesce(nullif(p->>'estimated_preview_cost_cop','')::numeric,0)>=0;
exception when others then return false;
end $$;

create or replace function public._motion_plan_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'Los planes de motion no se eliminan.'; end if;
  if new.plan_key is distinct from old.plan_key or new.storyboard_id is distinct from old.storyboard_id or new.version is distinct from old.version
    or new.grammar_primary is distinct from old.grammar_primary or new.grammar_secondary is distinct from old.grammar_secondary
    or new.continuity_ledger is distinct from old.continuity_ledger or new.plan_snapshot is distinct from old.plan_snapshot
    or new.plan_fingerprint is distinct from old.plan_fingerprint or new.estimated_preview_cost_cop is distinct from old.estimated_preview_cost_cop
    or new.source_kind is distinct from old.source_kind or new.prepared_by is distinct from old.prepared_by
    or new.prepared_by_agent is distinct from old.prepared_by_agent or new.prepared_at is distinct from old.prepared_at then
    raise exception 'La receta de motion es inmutable; prepará una versión nueva.'; end if;
  return new;
end $$;
drop trigger if exists agency_motion_plan_guard on public.agency_motion_plans;
create trigger agency_motion_plan_guard before update or delete on public.agency_motion_plans for each row execute function public._motion_plan_guard();

create or replace function public._motion_recipe_immutable() returns trigger
language plpgsql security definer set search_path=public as $$ begin raise exception 'Las recetas y observaciones de motion son inmutables.'; end $$;
do $$ declare v_table text; begin
  foreach v_table in array array['agency_motion_recipes','agency_motion_observations'] loop
    execute format('drop trigger if exists agency_motion_immutable on public.%I',v_table);
    execute format('create trigger agency_motion_immutable before update or delete on public.%I for each row execute function public._motion_recipe_immutable()',v_table);
  end loop;
end $$;

create or replace function public._preparar_plan_motion(p jsonb,p_actor text,p_agent text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_board public.agency_storyboards%rowtype; v_shot public.agency_storyboard_shots%rowtype; v_existing public.agency_motion_plans%rowtype;
  v_entry jsonb; v_proposal jsonb; v_selected jsonb; v_recipes jsonb:='[]'::jsonb; v_seen bigint[]:='{}'::bigint[];
  v_key text:=btrim(coalesce(p->>'plan_key','')); v_board_id bigint:=nullif(p->>'storyboard_id','')::bigint;
  v_primary text:=p->>'grammar_primary'; v_secondary text:=coalesce(p->>'grammar_secondary',''); v_ledger jsonb:=p->'continuity_ledger';
  v_count integer; v_selected_count integer; v_shot_id bigint; v_shot_fp text; v_selected_key text; v_recipe_fp text;
  v_total numeric:=0; v_version integer; v_snapshot jsonb; v_fp text; v_id bigint; v_source text:=case when p_actor is null then 'Agente' else 'Humano' end;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) then raise exception 'El plan de motion es inválido o contiene secretos.'; end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,220}$' or v_primary not in ('Información y POV','Movimiento y energía','Claridad y blocking','Impulso y compresión','Precisión y control')
    or (v_secondary<>'' and v_secondary not in ('Información y POV','Movimiento y energía','Claridad y blocking','Impulso y compresión','Precisión y control'))
    or v_secondary=v_primary or jsonb_typeof(v_ledger)<>'object' or jsonb_typeof(p->'shots')<>'array' then
    raise exception 'Faltan gramática, continuidad o tomas válidas.'; end if;
  select * into v_board from public.agency_storyboards where id=v_board_id for update;
  if v_board.id is null or v_board.status<>'Aprobado' then raise exception 'Solo se dirige motion para un storyboard aprobado.'; end if;
  select count(*) into v_count from public.agency_storyboard_shots where storyboard_id=v_board.id and status='Vigente';
  if v_count=0 or jsonb_array_length(p->'shots')<>v_count then raise exception 'El plan necesita exactamente una receta por toma vigente.'; end if;
  for v_entry in select value from jsonb_array_elements(p->'shots') loop
    v_shot_id:=nullif(v_entry->>'shot_id','')::bigint; v_shot_fp:=btrim(coalesce(v_entry->>'shot_fingerprint',''));
    select * into v_shot from public.agency_storyboard_shots where id=v_shot_id and storyboard_id=v_board.id and status='Vigente';
    if v_shot.id is null or v_shot.shot_fingerprint<>v_shot_fp or v_shot.id=any(v_seen) then raise exception 'Una toma cambió, se repitió o no pertenece al storyboard.'; end if;
    v_seen:=array_append(v_seen,v_shot.id);
    if jsonb_typeof(v_entry->'proposals')<>'array' or jsonb_array_length(v_entry->'proposals') not between 1 and 3 then raise exception 'Cada toma necesita entre una y tres propuestas.'; end if;
    v_selected_count:=0; v_selected:=null; v_selected_key:='';
    for v_proposal in select value from jsonb_array_elements(v_entry->'proposals') loop
      if not public._motion_proposal_valid(v_proposal) then raise exception 'Una propuesta no conserva cámara, luz, física, continuidad o QA.'; end if;
      if coalesce((v_proposal->>'selected')::boolean,false) then v_selected_count:=v_selected_count+1; v_selected:=v_proposal; v_selected_key:=v_proposal->>'proposal_key'; end if;
    end loop;
    if v_selected_count<>1 then raise exception 'Cada toma necesita exactamente una propuesta seleccionada.'; end if;
    v_recipe_fp:=public._agency_mesa_fingerprint(jsonb_build_object('shot_id',v_shot.id,'shot_fingerprint',v_shot.shot_fingerprint,'proposals',v_entry->'proposals','selected_key',v_selected_key));
    v_total:=v_total+coalesce(nullif(v_selected->>'estimated_preview_cost_cop','')::numeric,0);
    v_recipes:=v_recipes||jsonb_build_array(jsonb_build_object('shot_id',v_shot.id,'shot_number',v_shot.shot_number,
      'shot_fingerprint',v_shot.shot_fingerprint,'selected_key',v_selected_key,'recipe_fingerprint',v_recipe_fp));
  end loop;
  v_snapshot:=jsonb_build_object('schema_version',1,'storyboard_id',v_board.id,'storyboard_fingerprint',v_board.source_fingerprint,
    'grammar_primary',v_primary,'grammar_secondary',v_secondary,'continuity_ledger',v_ledger,'recipes',v_recipes,
    'guards',jsonb_build_object('storyboard_approved',true,'motion_approval_required',true,'generation_forbidden',true,'publication_forbidden',true));
  v_fp:=public._agency_mesa_fingerprint(v_snapshot);
  select * into v_existing from public.agency_motion_plans where plan_key=v_key;
  if v_existing.id is not null then
    if v_existing.storyboard_id<>v_board.id or v_existing.plan_fingerprint<>v_fp then raise exception 'La clave idempotente pertenece a otro plan de motion.'; end if;
    return jsonb_build_object('ok',true,'motion_plan_id',v_existing.id,'duplicate',true,'executed',false,'published',false);
  end if;
  select * into v_existing from public.agency_motion_plans where storyboard_id=v_board.id and plan_fingerprint=v_fp;
  if v_existing.id is not null then return jsonb_build_object('ok',true,'motion_plan_id',v_existing.id,'duplicate',true,'executed',false,'published',false); end if;
  perform pg_advisory_xact_lock(hashtext('agency_motion_plan:'||v_board.id));
  select coalesce(max(version),0)+1 into v_version from public.agency_motion_plans where storyboard_id=v_board.id;
  update public.agency_motion_plans set status='Sustituido',reviewed_at=now(),review_note='Sustituido antes de aprobación.' where storyboard_id=v_board.id and status='En revisión';
  insert into public.agency_motion_plans(plan_key,storyboard_id,version,grammar_primary,grammar_secondary,continuity_ledger,plan_snapshot,
    plan_fingerprint,estimated_preview_cost_cop,source_kind,prepared_by,prepared_by_agent)
  values(v_key,v_board.id,v_version,v_primary,v_secondary,v_ledger,v_snapshot,v_fp,v_total,v_source,p_actor,coalesce(p_agent,'')) returning id into v_id;
  for v_entry in select value from jsonb_array_elements(p->'shots') loop
    v_shot_id:=(v_entry->>'shot_id')::bigint; select * into v_shot from public.agency_storyboard_shots where id=v_shot_id;
    select value into v_selected from jsonb_array_elements(v_entry->'proposals') where coalesce((value->>'selected')::boolean,false) limit 1;
    v_selected_key:=v_selected->>'proposal_key';
    v_recipe_fp:=public._agency_mesa_fingerprint(jsonb_build_object('shot_id',v_shot.id,'shot_fingerprint',v_shot.shot_fingerprint,'proposals',v_entry->'proposals','selected_key',v_selected_key));
    insert into public.agency_motion_recipes(plan_id,storyboard_id,shot_id,shot_number,shot_fingerprint,selected_key,proposals,selected_recipe,
      recipe_fingerprint,estimated_preview_cost_cop)
    values(v_id,v_board.id,v_shot.id,v_shot.shot_number,v_shot.shot_fingerprint,v_selected_key,v_entry->'proposals',v_selected,v_recipe_fp,
      coalesce(nullif(v_selected->>'estimated_preview_cost_cop','')::numeric,0));
  end loop;
  perform public._add_audit('Dirección motion',v_id::text,'Plan preparado','',format('%s tomas · preview estimado COP %s',v_count,v_total));
  return jsonb_build_object('ok',true,'motion_plan_id',v_id,'version',v_version,'status','En revisión','duplicate',false,
    'requires_human_approval',true,'executed',false,'generated',false,'published',false,'cost_cop',0,'estimated_preview_cost_cop',v_total);
end $$;

create or replace function public.preparar_plan_motion(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare v_actor public.users%rowtype; begin
  v_actor:=public._agency_actor(); return public._preparar_plan_motion(p,v_actor.id,null); end $$;

create or replace function public.proponer_plan_motion_agente(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ declare v_agent text:=btrim(coalesce(p->>'agent_name','')); begin
  if length(v_agent) not between 2 and 100 then raise exception 'Identificá el agente que propone motion.'; end if;
  return public._preparar_plan_motion(p,null,v_agent); end $$;

create or replace function public.obtener_contexto_motion_agente(p_storyboard_id bigint) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('storyboard',jsonb_build_object('id',b.id,'title',b.title,'status',b.status,'channel',b.channel,'format',b.format,
      'aspect_ratio',b.aspect_ratio,'duration_sec',b.target_duration_sec,'fingerprint',b.source_fingerprint,'creative_brief',b.creative_brief),
    'shots',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'number',s.shot_number,'title',s.title,'purpose',s.purpose,
      'duration_sec',s.duration_sec,'shot',s.shot_payload,'fingerprint',s.shot_fingerprint) order by s.shot_number)
      from public.agency_storyboard_shots s where s.storyboard_id=b.id and s.status='Vigente'),'[]'::jsonb),
    'rules',jsonb_build_object('proposals_per_shot','1-3','one_selected',true,'human_approval',true,'generation_forbidden',true,'publication_forbidden',true))
  from public.agency_storyboards b where b.id=p_storyboard_id and b.status='Aprobado'
$$;

create or replace function public.resolver_plan_motion(p_plan_id bigint,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_plan public.agency_motion_plans%rowtype; v_board public.agency_storyboards%rowtype;
  v_recipe public.agency_motion_recipes%rowtype; v_shot public.agency_storyboard_shots%rowtype; v_count integer; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor(); select * into v_plan from public.agency_motion_plans where id=p_plan_id for update;
  if v_plan.id is null or v_plan.status<>'En revisión' then raise exception 'El plan de motion no espera revisión humana.'; end if;
  if v_plan.plan_fingerprint<>public._agency_mesa_fingerprint(v_plan.plan_snapshot) then raise exception 'El plan de motion perdió integridad.'; end if;
  if p_decision='Devolver' then
    if length(v_note)<3 then raise exception 'Explicá qué debe corregirse.'; end if;
    update public.agency_motion_plans set status='Devuelto',reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_plan.id;
    return jsonb_build_object('ok',true,'motion_plan_id',v_plan.id,'status','Devuelto','generated',false,'published',false);
  elsif p_decision<>'Aprobar' then raise exception 'La decisión debe ser Aprobar o Devolver.'; end if;
  if length(v_note)<5 then raise exception 'Documentá qué verificaste en cámara, luz, física y continuidad.'; end if;
  select * into v_board from public.agency_storyboards where id=v_plan.storyboard_id for update;
  if v_board.id is null or v_board.status<>'Aprobado' or v_board.source_fingerprint<>v_plan.plan_snapshot->>'storyboard_fingerprint' then raise exception 'El storyboard aprobado cambió.'; end if;
  select count(*) into v_count from public.agency_storyboard_shots where storyboard_id=v_board.id and status='Vigente';
  if v_count<>(select count(*) from public.agency_motion_recipes where plan_id=v_plan.id) then raise exception 'La cobertura de recetas dejó de ser exacta.'; end if;
  for v_recipe in select * from public.agency_motion_recipes where plan_id=v_plan.id loop
    select * into v_shot from public.agency_storyboard_shots where id=v_recipe.shot_id and storyboard_id=v_board.id and status='Vigente';
    if v_shot.id is null or v_shot.shot_fingerprint<>v_recipe.shot_fingerprint or
       v_recipe.recipe_fingerprint<>public._agency_mesa_fingerprint(jsonb_build_object('shot_id',v_shot.id,'shot_fingerprint',v_shot.shot_fingerprint,
         'proposals',v_recipe.proposals,'selected_key',v_recipe.selected_key)) then raise exception 'Una receta o toma perdió integridad.'; end if;
  end loop;
  update public.agency_motion_plans set status='Sustituido',reviewed_at=now(),review_note='Sustituido por una versión posterior aprobada.'
    where storyboard_id=v_plan.storyboard_id and status='Aprobado' and id<>v_plan.id;
  update public.agency_motion_plans set status='Aprobado',reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_plan.id;
  perform public._add_audit('Dirección motion',v_plan.id::text,'Motion aprobado','En revisión',format('%s recetas · sin generar ni publicar',v_count));
  return jsonb_build_object('ok',true,'motion_plan_id',v_plan.id,'status','Aprobado','routing_unlocked',true,
    'generation_started',false,'preview_started',false,'published',false,'cost_cop',0);
end $$;

alter table public.agency_scene_routing_plans add column if not exists motion_plan_id bigint references public.agency_motion_plans(id) on delete restrict;
alter table public.agency_scene_routing_plans add column if not exists motion_plan_fingerprint text;

create or replace function public._bind_motion_to_routing() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_motion public.agency_motion_plans%rowtype; v_routes integer; v_recipes integer;
begin
  select * into v_motion from public.agency_motion_plans where storyboard_id=new.storyboard_id and status='Aprobado';
  if v_motion.id is null or v_motion.plan_fingerprint<>public._agency_mesa_fingerprint(v_motion.plan_snapshot) then
    raise exception 'El storyboard necesita una receta de motion aprobada e íntegra antes del Enrutador.'; end if;
  v_routes:=jsonb_array_length(new.plan_snapshot->'routes'); select count(*) into v_recipes from public.agency_motion_recipes where plan_id=v_motion.id;
  if v_routes<>v_recipes then raise exception 'Motion y Enrutador no cubren las mismas tomas.'; end if;
  new.motion_plan_id:=v_motion.id; new.motion_plan_fingerprint:=v_motion.plan_fingerprint; return new;
end $$;
drop trigger if exists bind_motion_to_routing on public.agency_scene_routing_plans;
create trigger bind_motion_to_routing before insert on public.agency_scene_routing_plans for each row execute function public._bind_motion_to_routing();

create or replace function public._guard_routing_motion_fields() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if new.motion_plan_id is distinct from old.motion_plan_id or new.motion_plan_fingerprint is distinct from old.motion_plan_fingerprint then
    raise exception 'La receta de motion ligada al Enrutador es inmutable.'; end if; return new;
end $$;
drop trigger if exists guard_routing_motion_fields on public.agency_scene_routing_plans;
create trigger guard_routing_motion_fields before update on public.agency_scene_routing_plans for each row execute function public._guard_routing_motion_fields();

create or replace function public._bind_motion_to_generation_job() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_route public.agency_scene_routing_plans%rowtype; v_motion public.agency_motion_plans%rowtype; v_recipe public.agency_motion_recipes%rowtype; v_negative text;
begin
  if not (coalesce(new.output_spec,'{}'::jsonb) ? 'routing_plan_id') then return new; end if;
  select * into v_route from public.agency_scene_routing_plans where id=(new.output_spec->>'routing_plan_id')::bigint;
  select * into v_motion from public.agency_motion_plans where id=v_route.motion_plan_id and status='Aprobado';
  select * into v_recipe from public.agency_motion_recipes where plan_id=v_motion.id and shot_id=(new.output_spec->>'storyboard_shot_id')::bigint;
  if v_route.id is null or v_motion.id is null or v_recipe.id is null or v_route.motion_plan_fingerprint<>v_motion.plan_fingerprint
    or v_recipe.recipe_fingerprint<>public._agency_mesa_fingerprint(jsonb_build_object('shot_id',v_recipe.shot_id,'shot_fingerprint',v_recipe.shot_fingerprint,
      'proposals',v_recipe.proposals,'selected_key',v_recipe.selected_key)) then raise exception 'No existe una receta de motion aprobada e íntegra para este trabajo.'; end if;
  select string_agg(value,'; ' order by ord) into v_negative from jsonb_array_elements_text(v_recipe.selected_recipe->'negative_constraints') with ordinality x(value,ord);
  new.prompt:=v_recipe.selected_recipe->>'generation_prompt'; new.negative_prompt:=coalesce(v_negative,'');
  new.output_spec:=new.output_spec||jsonb_build_object('motion_plan_id',v_motion.id,'motion_plan_fingerprint',v_motion.plan_fingerprint,
    'motion_recipe_id',v_recipe.id,'motion_recipe_fingerprint',v_recipe.recipe_fingerprint,'motion_recipe',v_recipe.selected_recipe,
    'motion_acceptance_tests',v_recipe.selected_recipe->'acceptance_tests');
  return new;
end $$;
drop trigger if exists bind_motion_to_generation_job on public.creative_generation_jobs;
create trigger bind_motion_to_generation_job before insert on public.creative_generation_jobs for each row execute function public._bind_motion_to_generation_job();

create or replace function public.registrar_observacion_motion_conector(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_job public.creative_generation_jobs%rowtype; v_recipe public.agency_motion_recipes%rowtype; v_review public.agency_scene_quality_reviews%rowtype;
  v_key text:=btrim(coalesce(p->>'observation_key','')); v_connector text:=btrim(coalesce(p->>'connector',''));
  v_snapshot jsonb; v_fp text; v_id bigint;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) or v_key !~ '^[A-Za-z0-9:_-]{3,220}$'
    or length(v_connector) not between 2 and 100 then raise exception 'La observación es inválida o contiene secretos.'; end if;
  select * into v_job from public.creative_generation_jobs where id=nullif(p->>'job_id','')::bigint;
  select * into v_recipe from public.agency_motion_recipes where id=nullif(v_job.output_spec->>'motion_recipe_id','')::bigint;
  if v_job.id is null or v_recipe.id is null or v_job.output_spec->>'motion_recipe_fingerprint'<>v_recipe.recipe_fingerprint then raise exception 'El trabajo no conserva una receta de motion íntegra.'; end if;
  if nullif(p->>'quality_review_id','') is not null then
    select * into v_review from public.agency_scene_quality_reviews where id=(p->>'quality_review_id')::bigint;
    if v_review.id is null or v_review.job_id<>v_job.id or v_review.shot_id<>v_recipe.shot_id then raise exception 'El QA no pertenece al trabajo y toma exactos.'; end if;
  end if;
  if coalesce(nullif(p->>'actual_cost_cop','')::numeric,-1)<0 or coalesce(nullif(p->>'runtime_sec','')::numeric,-1)<0
    or coalesce(nullif(p->>'attempts','')::integer,0) not between 1 and 100 or jsonb_typeof(p->'effective_parameters')<>'object'
    or jsonb_typeof(p->'errors')<>'array' or jsonb_typeof(p->'manual_corrections')<>'array'
    or jsonb_typeof(p->'qa_snapshot')<>'object' or jsonb_typeof(p->'attention_snapshot')<>'object' then raise exception 'Falta telemetría efectiva, costo, intentos o QA.'; end if;
  v_snapshot:=jsonb_build_object('schema_version',1,'plan_id',v_recipe.plan_id,'recipe_id',v_recipe.id,'recipe_fingerprint',v_recipe.recipe_fingerprint,
    'shot_id',v_recipe.shot_id,'job_id',v_job.id,'quality_review_id',v_review.id,'provider',p->>'provider','model',p->>'model',
    'model_version',coalesce(p->>'model_version',''),'effective_parameters',p->'effective_parameters','actual_cost_cop',(p->>'actual_cost_cop')::numeric,
    'runtime_sec',(p->>'runtime_sec')::numeric,'attempts',(p->>'attempts')::integer,'errors',p->'errors','manual_corrections',p->'manual_corrections',
    'qa_snapshot',p->'qa_snapshot','attention_snapshot',p->'attention_snapshot');
  v_fp:=public._agency_mesa_fingerprint(v_snapshot);
  select id into v_id from public.agency_motion_observations where observation_key=v_key or (job_id=v_job.id and observation_fingerprint=v_fp) limit 1;
  if v_id is not null then return jsonb_build_object('ok',true,'observation_id',v_id,'duplicate',true); end if;
  insert into public.agency_motion_observations(observation_key,plan_id,recipe_id,shot_id,job_id,quality_review_id,provider,model,model_version,
    effective_parameters,actual_cost_cop,runtime_sec,attempts,errors,manual_corrections,qa_snapshot,attention_snapshot,observation_fingerprint,recorded_by_connector)
  values(v_key,v_recipe.plan_id,v_recipe.id,v_recipe.shot_id,v_job.id,v_review.id,p->>'provider',p->>'model',coalesce(p->>'model_version',''),
    p->'effective_parameters',(p->>'actual_cost_cop')::numeric,(p->>'runtime_sec')::numeric,(p->>'attempts')::integer,p->'errors',p->'manual_corrections',
    p->'qa_snapshot',p->'attention_snapshot',v_fp,v_connector) returning id into v_id;
  return jsonb_build_object('ok',true,'observation_id',v_id,'duplicate',false,'published',false);
end $$;

do $$ declare v_name text; begin
  foreach v_name in array array['_motion_proposal_valid(jsonb)','_motion_plan_guard()','_motion_recipe_immutable()',
    '_preparar_plan_motion(jsonb,text,text)','_bind_motion_to_routing()','_guard_routing_motion_fields()','_bind_motion_to_generation_job()'] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',v_name);
  end loop;
end $$;
revoke all on function public.motion_experience_disponible() from public,anon;
revoke all on function public.preparar_plan_motion(jsonb) from public,anon;
revoke all on function public.resolver_plan_motion(bigint,text,text) from public,anon;
revoke all on function public.proponer_plan_motion_agente(jsonb) from public,anon,authenticated;
revoke all on function public.obtener_contexto_motion_agente(bigint) from public,anon,authenticated;
revoke all on function public.registrar_observacion_motion_conector(jsonb) from public,anon,authenticated;
grant execute on function public.motion_experience_disponible() to authenticated;
grant execute on function public.preparar_plan_motion(jsonb) to authenticated;
grant execute on function public.resolver_plan_motion(bigint,text,text) to authenticated;
grant execute on function public.proponer_plan_motion_agente(jsonb) to service_role;
grant execute on function public.obtener_contexto_motion_agente(bigint) to service_role;
grant execute on function public.registrar_observacion_motion_conector(jsonb) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_36_experiencia_motion','Recetas de cámara, luz, física, continuidad y transición aprobadas antes del Enrutador, con telemetría inmutable')
on conflict(id) do update set detalle=excluded.detalle;

commit;
