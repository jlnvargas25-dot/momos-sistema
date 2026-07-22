-- MOMOS OPS · Enrutador creativo por escenas v1.
-- Paso 32. Sella una ruta multimotor por toma y solo crea trabajos tras aprobación humana.
-- No despacha al proveedor y nunca publica contenido.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_31_estudio_escenas'
  ) then raise exception 'Falta el paso 31_estudio_escenas.'; end if;
  if to_regprocedure('public.reclamar_trabajo_higgsfield(text,integer)') is null
     or to_regprocedure('public.reclamar_trabajo_kling(text,integer)') is null then
    raise exception 'Faltan los conectores privados Higgsfield o Kling.';
  end if;
end $$;

create table if not exists public.agency_scene_routing_plans(
  id bigint generated always as identity primary key,
  plan_key text not null unique check(plan_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  storyboard_id bigint not null references public.agency_storyboards(id) on delete restrict,
  version integer not null check(version>0),
  status text not null default 'Preparado' check(status in ('Preparado','Autorizado','Sustituido','Descartado')),
  plan_snapshot jsonb not null check(jsonb_typeof(plan_snapshot)='object'),
  plan_fingerprint text not null check(plan_fingerprint ~ '^[0-9a-f]{32}$'),
  total_estimated_cost_cop numeric(14,2) not null check(total_estimated_cost_cop>0),
  total_cost_cap_cop numeric(14,2) not null check(total_cost_cap_cop>=total_estimated_cost_cop),
  prepared_by text references public.users(id),
  prepared_by_agent text not null default '' check(length(prepared_by_agent)<=120),
  created_at timestamptz not null default now(),
  resolved_by text references public.users(id), resolved_at timestamptz,
  resolution_note text not null default '', job_ids bigint[] not null default '{}'::bigint[],
  unique(storyboard_id,version)
);
create unique index if not exists agency_scene_routing_one_prepared_idx
  on public.agency_scene_routing_plans(storyboard_id) where status='Preparado';
create index if not exists agency_scene_routing_status_idx
  on public.agency_scene_routing_plans(status,created_at desc);

alter table public.agency_scene_routing_plans enable row level security;
drop policy if exists staff_read on public.agency_scene_routing_plans;
create policy staff_read on public.agency_scene_routing_plans for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.agency_scene_routing_plans from public,anon,authenticated;
grant select on public.agency_scene_routing_plans to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_scene_routing_plans') then
    alter publication supabase_realtime add table public.agency_scene_routing_plans;
  end if;
end $$;

create or replace function public.enrutador_escenas_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._scene_route_plan_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.plan_key is distinct from old.plan_key or new.storyboard_id is distinct from old.storyboard_id
     or new.version is distinct from old.version or new.plan_snapshot is distinct from old.plan_snapshot
     or new.plan_fingerprint is distinct from old.plan_fingerprint
     or new.total_estimated_cost_cop is distinct from old.total_estimated_cost_cop
     or new.total_cost_cap_cop is distinct from old.total_cost_cap_cop
     or new.prepared_by is distinct from old.prepared_by or new.prepared_by_agent is distinct from old.prepared_by_agent
     or new.created_at is distinct from old.created_at then
    raise exception 'El enrutamiento sellado no se reescribe; prepará una versión nueva.';
  end if;
  return new;
end $$;
drop trigger if exists agency_scene_routing_immutable on public.agency_scene_routing_plans;
create trigger agency_scene_routing_immutable before update on public.agency_scene_routing_plans
for each row execute function public._scene_route_plan_immutable();

create or replace function public._crear_plan_enrutamiento_escenas(
  p jsonb,p_prepared_by text default null,p_agent_name text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_board public.agency_storyboards%rowtype; v_shot public.agency_storyboard_shots%rowtype;
  v_existing public.agency_scene_routing_plans%rowtype; v_route jsonb; v_routes jsonb:='[]'::jsonb;
  v_key text:=btrim(coalesce(p->>'plan_key','')); v_board_id bigint:=nullif(p->>'storyboard_id','')::bigint;
  v_version integer; v_fingerprint text; v_id bigint; v_count integer; v_seen bigint[]:='{}'::bigint[];
  v_provider text; v_operation text; v_capability text; v_rationale text; v_risk text;
  v_prompt text; v_negative text; v_output jsonb; v_shot_id bigint; v_shot_fp text;
  v_est numeric; v_cap numeric; v_total_est numeric:=0; v_total_cap numeric:=0; v_budget numeric;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) then
    raise exception 'El plan es inválido o contiene secretos.';
  end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,220}$' or jsonb_typeof(p->'routes')<>'array' then
    raise exception 'Falta una clave idempotente o una lista de rutas válida.';
  end if;
  select * into v_board from public.agency_storyboards where id=v_board_id for update;
  if v_board.id is null or v_board.status<>'Aprobado' then raise exception 'Solo se enruta un storyboard aprobado.'; end if;
  select count(*) into v_count from public.agency_storyboard_shots where storyboard_id=v_board.id and status='Vigente';
  if v_count=0 or jsonb_array_length(p->'routes')<>v_count then
    raise exception 'El plan necesita exactamente una ruta por toma vigente.';
  end if;
  for v_route in select value from jsonb_array_elements(p->'routes') loop
    v_shot_id:=nullif(v_route->>'shot_id','')::bigint; v_shot_fp:=btrim(coalesce(v_route->>'shot_fingerprint',''));
    select * into v_shot from public.agency_storyboard_shots where id=v_shot_id and storyboard_id=v_board.id and status='Vigente';
    if v_shot.id is null or v_shot.shot_fingerprint<>v_shot_fp then raise exception 'Una toma cambió o no pertenece al storyboard.'; end if;
    if v_shot.id=any(v_seen) then raise exception 'Una toma no puede tener dos rutas.'; end if;
    v_seen:=array_append(v_seen,v_shot.id);
    v_provider:=btrim(coalesce(v_route->>'provider','')); v_operation:=btrim(coalesce(v_route->>'operation',''));
    v_capability:=btrim(coalesce(v_route->>'capability','')); v_rationale:=btrim(coalesce(v_route->>'rationale',''));
    v_risk:=btrim(coalesce(v_route->>'risk_level','')); v_prompt:=btrim(coalesce(v_route->>'prompt',''));
    v_negative:=btrim(coalesce(v_route->>'negative_prompt','')); v_output:=coalesce(v_route->'output_spec','{}'::jsonb);
    v_est:=coalesce(nullif(v_route->>'estimated_cost_cop','')::numeric,0);
    v_cap:=coalesce(nullif(v_route->>'max_cost_cop','')::numeric,0);
    if v_provider not in ('Higgsfield','Kling') or v_operation<>'Generar video'
       or length(v_capability) not between 2 and 120 or length(v_rationale) not between 3 and 600
       or v_risk not in ('Bajo','Medio','Alto') or length(v_prompt)<12 or length(v_prompt)>8000
       or length(v_negative)>3000 or jsonb_typeof(v_output)<>'object' or public._agency_mesa_has_secret(v_output)
       or v_est<=0 or v_cap<v_est then raise exception 'Una ruta no cumple el contrato de motor, costo, riesgo o prompt.'; end if;
    v_total_est:=v_total_est+v_est; v_total_cap:=v_total_cap+v_cap;
    v_routes:=v_routes||jsonb_build_array(jsonb_build_object(
      'shot_id',v_shot.id,'shot_number',v_shot.shot_number,'shot_fingerprint',v_shot.shot_fingerprint,
      'input_asset_ids',to_jsonb(v_shot.input_asset_ids),'provider',v_provider,'operation',v_operation,
      'capability',v_capability,'rationale',v_rationale,'risk_level',v_risk,
      'estimated_cost_cop',v_est,'max_cost_cop',v_cap,'prompt',v_prompt,'negative_prompt',v_negative,
      'output_spec',v_output,'route_fingerprint',public._agency_mesa_fingerprint(jsonb_build_object(
        'shot_id',v_shot.id,'shot_fingerprint',v_shot.shot_fingerprint,'provider',v_provider,
        'operation',v_operation,'estimated_cost_cop',v_est,'max_cost_cop',v_cap,'prompt',v_prompt,
        'negative_prompt',v_negative,'output_spec',v_output))));
  end loop;
  select campaign_budget_limit into v_budget from public.agency_settings where id;
  if v_total_cap>coalesce(v_budget,0) then raise exception 'El tope total supera la guarda vigente de Agencia.'; end if;
  v_route:=jsonb_build_object('schema_version',1,'storyboard_id',v_board.id,
    'storyboard_fingerprint',v_board.source_fingerprint,'routes',v_routes,
    'total_estimated_cost_cop',v_total_est,'total_cost_cap_cop',v_total_cap);
  v_fingerprint:=public._agency_mesa_fingerprint(v_route);
  select * into v_existing from public.agency_scene_routing_plans where plan_key=v_key;
  if v_existing.id is not null then
    if v_existing.storyboard_id<>v_board.id or v_existing.plan_fingerprint<>v_fingerprint then
      raise exception 'La clave idempotente ya pertenece a otro enrutamiento.';
    end if;
    return jsonb_build_object('ok',true,'plan_id',v_existing.id,'duplicate',true,'executed',false);
  end if;
  select * into v_existing from public.agency_scene_routing_plans where storyboard_id=v_board.id and plan_fingerprint=v_fingerprint;
  if v_existing.id is not null then return jsonb_build_object('ok',true,'plan_id',v_existing.id,'duplicate',true,'executed',false); end if;
  perform pg_advisory_xact_lock(hashtext('agency_scene_route:'||v_board.id::text));
  select coalesce(max(version),0)+1 into v_version from public.agency_scene_routing_plans where storyboard_id=v_board.id;
  update public.agency_scene_routing_plans set status='Sustituido',resolved_at=now(),resolution_note='Sustituido antes de autorización.'
    where storyboard_id=v_board.id and status='Preparado';
  insert into public.agency_scene_routing_plans(plan_key,storyboard_id,version,plan_snapshot,plan_fingerprint,
    total_estimated_cost_cop,total_cost_cap_cop,prepared_by,prepared_by_agent)
  values(v_key,v_board.id,v_version,v_route,v_fingerprint,v_total_est,v_total_cap,p_prepared_by,btrim(coalesce(p_agent_name,'')))
  returning id into v_id;
  perform public._add_audit('Enrutador de escenas',v_id::text,'Plan preparado','',format('%s tomas · tope COP %s',v_count,v_total_cap));
  return jsonb_build_object('ok',true,'plan_id',v_id,'version',v_version,'duplicate',false,'executed',false,
    'requires_human_approval',true,'total_cost_cap_cop',v_total_cap);
end $$;

create or replace function public.preparar_enrutamiento_escenas(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin v_actor:=public._agency_actor(); return public._crear_plan_enrutamiento_escenas(p,v_actor.id,''); end $$;

create or replace function public.obtener_contexto_enrutamiento_agente(p_storyboard_id bigint) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('storyboard',jsonb_build_object('id',b.id,'title',b.title,'status',b.status,
      'channel',b.channel,'format',b.format,'aspect_ratio',b.aspect_ratio,'source_fingerprint',b.source_fingerprint),
    'shots',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'shot_number',s.shot_number,'title',s.title,
      'purpose',s.purpose,'duration_sec',s.duration_sec,'shot',s.shot_payload,'estimated_cost_cop',s.estimated_cost_cop,
      'shot_fingerprint',s.shot_fingerprint,'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,
        'media_type',a.media_type,'product_id',a.product_id,'figure',a.figure,'flavor',a.flavor,'content_hash',a.content_hash))
        from unnest(s.input_asset_ids) x join public.brand_media_assets a on a.id=x),'[]'::jsonb)) order by s.shot_number)
      from public.agency_storyboard_shots s where s.storyboard_id=b.id and s.status='Vigente'),'[]'::jsonb),
    'integrations',coalesce((select jsonb_agg(jsonb_build_object('provider',i.provider,'status',i.status,
      'capabilities',i.capabilities,'secret_configured',i.secret_configured,'last_heartbeat_at',i.last_heartbeat_at))
      from public.agency_integrations i where i.provider in ('Higgsfield','Kling')),'[]'::jsonb),
    'rules',jsonb_build_object('human_authorization_required',true,'publication_forbidden',true,'one_route_per_shot',true))
  from public.agency_storyboards b where b.id=p_storyboard_id and b.status='Aprobado'
$$;

create or replace function public.registrar_plan_enrutamiento_agente(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_agent text:=btrim(coalesce(p->>'agent_name',''));
begin
  if length(v_agent) not between 2 and 120 then raise exception 'Identificá el agente que propone la ruta.'; end if;
  return public._crear_plan_enrutamiento_escenas(p,null,v_agent);
end $$;

create or replace function public.resolver_enrutamiento_escenas(p_plan_id bigint,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_plan public.agency_scene_routing_plans%rowtype; v_board public.agency_storyboards%rowtype;
  v_route jsonb; v_shot public.agency_storyboard_shots%rowtype; v_integration public.agency_integrations%rowtype;
  v_job bigint; v_jobs bigint[]:='{}'::bigint[]; v_asset bigint; v_brand jsonb; v_paused boolean; v_budget numeric;
  v_note text:=btrim(coalesce(p_note,'')); v_decision text:=initcap(lower(btrim(coalesce(p_decision,''))));
  v_format text;
begin
  v_actor:=public._agency_actor(); select * into v_plan from public.agency_scene_routing_plans where id=p_plan_id for update;
  if v_plan.id is null then raise exception 'El plan de enrutamiento no existe.'; end if;
  if v_plan.status='Autorizado' and v_decision='Autorizar' then
    return jsonb_build_object('ok',true,'plan_id',v_plan.id,'status',v_plan.status,'job_ids',to_jsonb(v_plan.job_ids),'duplicate',true,'executed',true);
  end if;
  if v_plan.status<>'Preparado' then raise exception 'El plan ya fue resuelto o sustituido.'; end if;
  if v_decision='Descartar' then
    if length(v_note)<3 then raise exception 'Indicá por qué se descarta el plan.'; end if;
    update public.agency_scene_routing_plans set status='Descartado',resolved_by=v_actor.id,resolved_at=now(),resolution_note=v_note where id=v_plan.id;
    return jsonb_build_object('ok',true,'plan_id',v_plan.id,'status','Descartado','executed',false);
  end if;
  if v_decision<>'Autorizar' then raise exception 'La decisión debe ser Autorizar o Descartar.'; end if;
  if v_plan.plan_fingerprint<>public._agency_mesa_fingerprint(v_plan.plan_snapshot) then raise exception 'El plan perdió integridad.'; end if;
  select * into v_board from public.agency_storyboards where id=v_plan.storyboard_id for update;
  if v_board.id is null or v_board.status<>'Aprobado'
     or v_board.source_fingerprint<>v_plan.plan_snapshot->>'storyboard_fingerprint' then raise exception 'El storyboard aprobado cambió.'; end if;
  select paused,campaign_budget_limit into v_paused,v_budget from public.agency_settings where id;
  if coalesce(v_paused,false) then raise exception 'La parada de emergencia de Agencia MOMOS está activa.'; end if;
  if v_plan.total_cost_cap_cop>coalesce(v_budget,0) then raise exception 'El plan ya no cabe en la guarda de presupuesto.'; end if;
  select jsonb_build_object('frases',frases,'tono',tono,'palabras_si',palabras_si,'palabras_no',palabras_no)
    into v_brand from public.brand_library where id;
  for v_route in select value from jsonb_array_elements(v_plan.plan_snapshot->'routes') loop
    select * into v_shot from public.agency_storyboard_shots where id=(v_route->>'shot_id')::bigint
      and storyboard_id=v_board.id and status='Vigente';
    if v_shot.id is null or v_shot.shot_fingerprint<>v_route->>'shot_fingerprint' then raise exception 'Una toma cambió después del enrutamiento.'; end if;
    select * into v_integration from public.agency_integrations where provider=v_route->>'provider';
    if v_integration.provider is null or v_integration.status<>'Activa' or not v_integration.secret_configured
       or v_integration.last_heartbeat_at is null or v_integration.last_heartbeat_at<now()-interval '30 minutes' then
      raise exception 'El conector % no está activo, autenticado o reciente.',v_route->>'provider';
    end if;
    v_format:=case v_board.aspect_ratio when '9:16' then case when lower(v_board.channel) like '%tiktok%' then 'TikTok 9:16' else 'Reel 9:16' end
      when '1:1' then 'Cuadrado 1:1' when '4:5' then 'Post 4:5' else 'Reel 9:16' end;
    insert into public.creative_generation_jobs(provider,operation,status,input_asset_ids,target_channel,target_format,prompt,
      negative_prompt,brand_snapshot,output_spec,max_cost_cop,authorized_by,authorized_at,created_by,estimated_cost_cop)
    values(v_route->>'provider','Generar video','Autorizado',coalesce(v_route->'input_asset_ids','[]'::jsonb),v_board.channel,v_format,
      v_route->>'prompt',coalesce(v_route->>'negative_prompt',''),coalesce(v_brand,'{}'::jsonb),
      coalesce(v_route->'output_spec','{}'::jsonb)||jsonb_build_object('output_mode','new_asset','routing_plan_id',v_plan.id,
        'storyboard_id',v_board.id,'storyboard_shot_id',v_shot.id,'route_fingerprint',v_route->>'route_fingerprint'),
      (v_route->>'max_cost_cop')::numeric,v_actor.id,now(),v_actor.id,(v_route->>'estimated_cost_cop')::numeric)
    returning id into v_job;
    perform public._validar_fuentes_trabajo_creativo(v_job);
    foreach v_asset in array v_shot.input_asset_ids loop
      insert into public.brand_media_usages(asset_id,job_id,role,created_by)
      values(v_asset,v_job,case when not exists(select 1 from public.brand_media_usages where job_id=v_job) then 'Principal' else 'Apoyo' end,v_actor.id);
    end loop;
    v_jobs:=array_append(v_jobs,v_job);
  end loop;
  update public.agency_scene_routing_plans set status='Autorizado',resolved_by=v_actor.id,resolved_at=now(),
    resolution_note=v_note,job_ids=v_jobs where id=v_plan.id;
  perform public._add_audit('Enrutador de escenas',v_plan.id::text,'Ruta autorizada','Preparado',format('%s trabajos · tope COP %s',cardinality(v_jobs),v_plan.total_cost_cap_cop));
  return jsonb_build_object('ok',true,'plan_id',v_plan.id,'status','Autorizado','job_ids',to_jsonb(v_jobs),'duplicate',false,'executed',true,'published',false);
end $$;

revoke all on function public.enrutador_escenas_disponible() from public,anon;
revoke all on function public._scene_route_plan_immutable() from public,anon,authenticated;
revoke all on function public._crear_plan_enrutamiento_escenas(jsonb,text,text) from public,anon,authenticated;
revoke all on function public.preparar_enrutamiento_escenas(jsonb) from public,anon;
revoke all on function public.resolver_enrutamiento_escenas(bigint,text,text) from public,anon;
revoke all on function public.obtener_contexto_enrutamiento_agente(bigint) from public,anon,authenticated;
revoke all on function public.registrar_plan_enrutamiento_agente(jsonb) from public,anon,authenticated;
grant execute on function public.enrutador_escenas_disponible() to authenticated;
grant execute on function public.preparar_enrutamiento_escenas(jsonb) to authenticated;
grant execute on function public.resolver_enrutamiento_escenas(bigint,text,text) to authenticated;
grant execute on function public.obtener_contexto_enrutamiento_agente(bigint) to service_role;
grant execute on function public.registrar_plan_enrutamiento_agente(jsonb) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_32_enrutador_escenas','Enrutamiento multimotor por toma, costos sellados, autorización humana atómica y cero publicación')
on conflict(id) do nothing;

commit;
