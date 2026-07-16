-- MOMOS OPS · Calidad, continuidad y postproducción v1.
-- Paso 33. Controla cada salida contra producto, marca, física, cámara, luz,
-- derechos y continuidad. Solo tomas aprobadas pueden formar un paquete de corte.
-- No edita archivos, no publica y no autoriza distribución.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_32_enrutador_escenas'
  ) then raise exception 'Falta el paso 32_enrutador_escenas.'; end if;
end $$;

create table if not exists public.agency_scene_quality_reviews(
  id bigint generated always as identity primary key,
  review_key text not null unique check(review_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  routing_plan_id bigint not null references public.agency_scene_routing_plans(id) on delete restrict,
  storyboard_id bigint not null references public.agency_storyboards(id) on delete restrict,
  shot_id bigint not null references public.agency_storyboard_shots(id) on delete restrict,
  job_id bigint not null unique references public.creative_generation_jobs(id) on delete restrict,
  output_asset_id bigint not null references public.brand_media_assets(id) on delete restrict,
  source_kind text not null check(source_kind in ('Humano','Agente')),
  status text not null check(status in ('En revisión','Aprobada','Rechazada')),
  failure_type text not null check(failure_type in ('Pendiente','Aprobada','Fallo técnico','Fallo de marca','Cambio creativo')),
  scores jsonb not null check(jsonb_typeof(scores)='object'),
  score_total integer not null check(score_total between 0 and 22),
  findings jsonb not null default '[]'::jsonb check(jsonb_typeof(findings)='array'),
  continuity_observation text not null check(length(btrim(continuity_observation)) between 3 and 1200),
  evidence_snapshot jsonb not null check(jsonb_typeof(evidence_snapshot)='object'),
  review_fingerprint text not null check(review_fingerprint ~ '^[0-9a-f]{32}$'),
  prepared_by text references public.users(id),
  prepared_by_agent text not null default '' check(length(prepared_by_agent)<=120),
  created_at timestamptz not null default now(),
  resolved_by text references public.users(id), resolved_at timestamptz,
  resolution_note text not null default '',
  check((source_kind='Humano' and prepared_by is not null and prepared_by_agent='')
     or (source_kind='Agente' and prepared_by is null and length(btrim(prepared_by_agent))>=2)),
  check((status='En revisión' and failure_type='Pendiente' and resolved_by is null and resolved_at is null and resolution_note='')
     or (status='Aprobada' and failure_type='Aprobada' and resolved_by is not null and resolved_at is not null)
     or (status='Rechazada' and failure_type in ('Fallo técnico','Fallo de marca','Cambio creativo')
       and resolved_by is not null and resolved_at is not null and length(btrim(resolution_note))>=5))
);
create index if not exists agency_scene_quality_status_idx on public.agency_scene_quality_reviews(status,created_at desc);
create index if not exists agency_scene_quality_storyboard_idx on public.agency_scene_quality_reviews(storyboard_id,shot_id);

create table if not exists public.agency_postproduction_packages(
  id bigint generated always as identity primary key,
  package_key text not null unique check(package_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  storyboard_id bigint not null references public.agency_storyboards(id) on delete restrict,
  routing_plan_id bigint not null references public.agency_scene_routing_plans(id) on delete restrict,
  version integer not null check(version>0),
  status text not null default 'Preparado' check(status in ('Preparado','Aprobado','Devuelto','Sustituido','Anulado')),
  package_snapshot jsonb not null check(jsonb_typeof(package_snapshot)='object'),
  package_fingerprint text not null check(package_fingerprint ~ '^[0-9a-f]{32}$'),
  prepared_by text not null references public.users(id), prepared_at timestamptz not null default now(),
  reviewed_by text references public.users(id), reviewed_at timestamptz, review_note text not null default '',
  unique(storyboard_id,version), unique(storyboard_id,package_fingerprint),
  check((status='Preparado' and reviewed_by is null and reviewed_at is null and review_note='')
     or (status in ('Aprobado','Devuelto') and reviewed_by is not null and reviewed_at is not null)
     or status in ('Sustituido','Anulado'))
);
create unique index if not exists agency_postproduction_one_prepared_idx
  on public.agency_postproduction_packages(storyboard_id) where status='Preparado';
create index if not exists agency_postproduction_status_idx on public.agency_postproduction_packages(status,prepared_at desc);

alter table public.agency_scene_quality_reviews enable row level security;
alter table public.agency_postproduction_packages enable row level security;
drop policy if exists staff_read on public.agency_scene_quality_reviews;
drop policy if exists staff_read on public.agency_postproduction_packages;
create policy staff_read on public.agency_scene_quality_reviews for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_postproduction_packages for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.agency_scene_quality_reviews,public.agency_postproduction_packages from public,anon,authenticated;
grant select on public.agency_scene_quality_reviews,public.agency_postproduction_packages to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_scene_quality_reviews') then
      alter publication supabase_realtime add table public.agency_scene_quality_reviews;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_postproduction_packages') then
      alter publication supabase_realtime add table public.agency_postproduction_packages;
    end if;
  end if;
end $$;

create or replace function public.calidad_postproduccion_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_quality_scores_valid(p_scores jsonb) returns boolean
language sql immutable security definer set search_path=public as $$
  select jsonb_typeof(p_scores)='object'
    and (select count(*) from jsonb_object_keys(p_scores))=11
    and not exists(
      select 1 from jsonb_each_text(p_scores) e
      where e.key not in ('product_identity','brand_fidelity','text_logo','anatomy','contact_physics','gravity_viscosity',
        'camera_motion','light_geometry','shadow_reflection','temporal_stability','continuity')
        or e.value !~ '^[0-2]$'
    )
$$;

create or replace function public._agency_quality_can_approve(p_scores jsonb) returns boolean
language sql immutable security definer set search_path=public as $$
  select public._agency_quality_scores_valid(p_scores)
    and (p_scores->>'product_identity')::integer=2
    and (p_scores->>'brand_fidelity')::integer=2
    and (p_scores->>'continuity')::integer=2
    and not exists(select 1 from jsonb_each_text(p_scores) where value='0')
    and (select sum(value::integer) from jsonb_each_text(p_scores))>=18
$$;

create or replace function public._agency_quality_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Los controles de calidad no se eliminan.'; end if;
  if new.review_key is distinct from old.review_key or new.routing_plan_id is distinct from old.routing_plan_id
     or new.storyboard_id is distinct from old.storyboard_id or new.shot_id is distinct from old.shot_id
     or new.job_id is distinct from old.job_id or new.output_asset_id is distinct from old.output_asset_id
     or new.source_kind is distinct from old.source_kind or new.scores is distinct from old.scores
     or new.score_total is distinct from old.score_total or new.findings is distinct from old.findings
     or new.continuity_observation is distinct from old.continuity_observation
     or new.evidence_snapshot is distinct from old.evidence_snapshot or new.review_fingerprint is distinct from old.review_fingerprint
     or new.prepared_by is distinct from old.prepared_by or new.prepared_by_agent is distinct from old.prepared_by_agent
     or new.created_at is distinct from old.created_at then
    raise exception 'El control sellado no se reescribe; generá otra salida o una nueva toma.';
  end if;
  return new;
end $$;
drop trigger if exists agency_scene_quality_immutable on public.agency_scene_quality_reviews;
create trigger agency_scene_quality_immutable before update or delete on public.agency_scene_quality_reviews
for each row execute function public._agency_quality_immutable();

create or replace function public._agency_postproduction_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Los paquetes de postproducción no se eliminan.'; end if;
  if new.package_key is distinct from old.package_key or new.storyboard_id is distinct from old.storyboard_id
     or new.routing_plan_id is distinct from old.routing_plan_id or new.version is distinct from old.version
     or new.package_snapshot is distinct from old.package_snapshot or new.package_fingerprint is distinct from old.package_fingerprint
     or new.prepared_by is distinct from old.prepared_by or new.prepared_at is distinct from old.prepared_at then
    raise exception 'El paquete sellado no se reescribe; prepará una versión nueva.';
  end if;
  return new;
end $$;
drop trigger if exists agency_postproduction_immutable on public.agency_postproduction_packages;
create trigger agency_postproduction_immutable before update or delete on public.agency_postproduction_packages
for each row execute function public._agency_postproduction_immutable();

create or replace function public._registrar_revision_calidad_escena(
  p jsonb,p_actor_id text,p_agent_name text,p_allow_resolution boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'review_key','')); v_job_id bigint:=nullif(p->>'job_id','')::bigint;
  v_asset_id bigint:=nullif(p->>'output_asset_id','')::bigint; v_decision text:=btrim(coalesce(p->>'decision',''));
  v_failure text:=btrim(coalesce(p->>'failure_type','Pendiente')); v_note text:=btrim(coalesce(p->>'review_note',''));
  v_continuity text:=btrim(coalesce(p->>'continuity_observation','')); v_scores jsonb:=coalesce(p->'scores','{}'::jsonb);
  v_findings jsonb:=coalesce(p->'findings','[]'::jsonb); v_job public.creative_generation_jobs%rowtype;
  v_asset public.brand_media_assets%rowtype; v_plan public.agency_scene_routing_plans%rowtype;
  v_board public.agency_storyboards%rowtype; v_shot public.agency_storyboard_shots%rowtype; v_route jsonb;
  v_snapshot jsonb; v_fingerprint text; v_id bigint; v_total integer; v_existing public.agency_scene_quality_reviews%rowtype;
  v_status text:='En revisión'; v_source text:=case when p_actor_id is null then 'Agente' else 'Humano' end;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) then raise exception 'El control de calidad es inválido o contiene secretos.'; end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,220}$' or not public._agency_quality_scores_valid(v_scores)
     or jsonb_typeof(v_findings)<>'array' or length(v_continuity) not between 3 and 1200 then
    raise exception 'El control requiere clave, 11 puntajes 0-2, hallazgos y observación de continuidad.';
  end if;
  if p_actor_id is null and length(btrim(coalesce(p_agent_name,'')))<2 then raise exception 'Falta identificar el agente privado.'; end if;
  select * into v_job from public.creative_generation_jobs where id=v_job_id for update;
  if v_job.id is null or v_job.status<>'Completado' or v_job.output_asset_id is null
     or v_job.output_review_status<>'Aprobada' then raise exception 'La toma necesita salida completada y revisión creativa humana aprobada.'; end if;
  if v_job.output_asset_id<>v_asset_id then raise exception 'El archivo no pertenece al trabajo revisado.'; end if;
  select * into v_asset from public.brand_media_assets where id=v_asset_id;
  if v_asset.id is null or v_asset.status<>'Activo' or v_asset.rights_status<>'Autorizado'
     or coalesce(v_asset.generation_meta->>'job_id','')<>v_job.id::text then raise exception 'La salida no está activa, autorizada o trazada al trabajo.'; end if;
  select * into v_plan from public.agency_scene_routing_plans where id=nullif(v_job.output_spec->>'routing_plan_id','')::bigint;
  select * into v_board from public.agency_storyboards where id=nullif(v_job.output_spec->>'storyboard_id','')::bigint;
  select * into v_shot from public.agency_storyboard_shots where id=nullif(v_job.output_spec->>'storyboard_shot_id','')::bigint;
  if v_plan.id is null or v_plan.status<>'Autorizado' or not (v_job.id=any(v_plan.job_ids)) then raise exception 'El trabajo no pertenece a una ruta autorizada.'; end if;
  if v_board.id is null or v_board.status<>'Aprobado' or v_board.id<>v_plan.storyboard_id
     or v_board.source_fingerprint<>v_plan.plan_snapshot->>'storyboard_fingerprint' then raise exception 'El storyboard aprobado cambió.'; end if;
  if v_shot.id is null or v_shot.status<>'Vigente' or v_shot.storyboard_id<>v_board.id then raise exception 'La toma ya no es vigente.'; end if;
  select value into v_route from jsonb_array_elements(v_plan.plan_snapshot->'routes') where (value->>'shot_id')::bigint=v_shot.id limit 1;
  if v_route is null or v_route->>'shot_fingerprint'<>v_shot.shot_fingerprint
     or v_route->>'route_fingerprint'<>v_job.output_spec->>'route_fingerprint' then raise exception 'La ruta o la toma perdió integridad.'; end if;
  select coalesce(sum(value::integer),0)::integer into v_total from jsonb_each_text(v_scores);
  if p_allow_resolution then
    if v_decision='Aprobar' then
      if not public._agency_quality_can_approve(v_scores) then raise exception 'La toma no supera el umbral: identidad y continuidad exactas, sin ceros y mínimo 18/22.'; end if;
      v_status:='Aprobada'; v_failure:='Aprobada';
    elsif v_decision='Rechazar' then
      if v_failure not in ('Fallo técnico','Fallo de marca','Cambio creativo') or length(v_note)<5 then
        raise exception 'Clasificá y explicá el rechazo para la siguiente versión.';
      end if;
      v_status:='Rechazada';
    else raise exception 'La decisión humana debe ser Aprobar o Rechazar.'; end if;
  else
    v_status:='En revisión'; v_failure:='Pendiente'; v_note:='';
  end if;
  v_snapshot:=jsonb_build_object('schema_version',1,'routing_plan_id',v_plan.id,'routing_fingerprint',v_plan.plan_fingerprint,
    'storyboard_id',v_board.id,'storyboard_fingerprint',v_board.source_fingerprint,'shot_id',v_shot.id,
    'shot_fingerprint',v_shot.shot_fingerprint,'route_fingerprint',v_route->>'route_fingerprint','job_id',v_job.id,
    'provider',v_job.provider,'output_asset_id',v_asset.id,'output_content_hash',v_asset.content_hash,
    'scores',v_scores,'findings',v_findings,'continuity_observation',v_continuity);
  v_fingerprint:=public._agency_mesa_fingerprint(v_snapshot);
  select * into v_existing from public.agency_scene_quality_reviews where review_key=v_key or job_id=v_job.id limit 1;
  if v_existing.id is not null then
    if v_existing.review_fingerprint<>v_fingerprint then raise exception 'La clave o el trabajo ya pertenecen a otro control.'; end if;
    return jsonb_build_object('ok',true,'review_id',v_existing.id,'status',v_existing.status,'duplicate',true,'published',false);
  end if;
  insert into public.agency_scene_quality_reviews(review_key,routing_plan_id,storyboard_id,shot_id,job_id,output_asset_id,
    source_kind,status,failure_type,scores,score_total,findings,continuity_observation,evidence_snapshot,review_fingerprint,
    prepared_by,prepared_by_agent,resolved_by,resolved_at,resolution_note)
  values(v_key,v_plan.id,v_board.id,v_shot.id,v_job.id,v_asset.id,v_source,v_status,v_failure,v_scores,v_total,v_findings,v_continuity,
    v_snapshot,v_fingerprint,p_actor_id,case when p_actor_id is null then btrim(p_agent_name) else '' end,
    case when v_status<>'En revisión' then p_actor_id end,case when v_status<>'En revisión' then now() end,v_note)
  returning id into v_id;
  perform public._add_audit('Calidad creativa',v_id::text,'Toma controlada','',format('%s · %s/22 · %s',v_status,v_total,v_failure));
  return jsonb_build_object('ok',true,'review_id',v_id,'status',v_status,'score_total',v_total,'failure_type',v_failure,
    'requires_human_approval',v_status='En revisión','published',false);
end $$;

create or replace function public.registrar_revision_calidad_escena(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; begin v_actor:=public._agency_actor();
  return public._registrar_revision_calidad_escena(p,v_actor.id,'',true); end $$;

create or replace function public.registrar_revision_calidad_agente(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
begin return public._registrar_revision_calidad_escena(p,null,btrim(coalesce(p->>'agent_name','')),false); end $$;

create or replace function public.obtener_contexto_calidad_agente(p_job_id bigint) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('job',jsonb_build_object('id',j.id,'provider',j.provider,'output_asset_id',j.output_asset_id,
      'output_spec',j.output_spec,'brand_snapshot',j.brand_snapshot),
    'asset',jsonb_build_object('id',a.id,'name',a.name,'product_id',a.product_id,'figure',a.figure,'flavor',a.flavor,
      'content_hash',a.content_hash,'rights_status',a.rights_status,'status',a.status),
    'shot',jsonb_build_object('id',s.id,'shot_number',s.shot_number,'title',s.title,'purpose',s.purpose,
      'payload',s.shot_payload,'fingerprint',s.shot_fingerprint))
  from public.creative_generation_jobs j join public.brand_media_assets a on a.id=j.output_asset_id
  join public.agency_storyboard_shots s on s.id=nullif(j.output_spec->>'storyboard_shot_id','')::bigint
  where j.id=p_job_id and j.status='Completado' and j.output_review_status='Aprobada'
$$;

create or replace function public.resolver_revision_calidad_escena(p_review_id bigint,p_decision text,p_failure_type text default 'Pendiente',p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_review public.agency_scene_quality_reviews%rowtype; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor(); select * into v_review from public.agency_scene_quality_reviews where id=p_review_id for update;
  if v_review.id is null or v_review.status<>'En revisión' then raise exception 'El control no espera revisión humana.'; end if;
  if p_decision='Aprobar' then
    if not public._agency_quality_can_approve(v_review.scores) then raise exception 'La toma no supera el umbral de calidad.'; end if;
    update public.agency_scene_quality_reviews set status='Aprobada',failure_type='Aprobada',resolved_by=v_actor.id,resolved_at=now(),resolution_note=v_note where id=v_review.id;
  elsif p_decision='Rechazar' then
    if p_failure_type not in ('Fallo técnico','Fallo de marca','Cambio creativo') or length(v_note)<5 then raise exception 'Clasificá y explicá el rechazo.'; end if;
    update public.agency_scene_quality_reviews set status='Rechazada',failure_type=p_failure_type,resolved_by=v_actor.id,resolved_at=now(),resolution_note=v_note where id=v_review.id;
  else raise exception 'La decisión debe ser Aprobar o Rechazar.'; end if;
  perform public._add_audit('Calidad creativa',v_review.id::text,'Revisión humana resuelta','En revisión',p_decision||' · '||p_failure_type);
  return jsonb_build_object('ok',true,'review_id',v_review.id,'status',case when p_decision='Aprobar' then 'Aprobada' else 'Rechazada' end,'published',false);
end $$;

create or replace function public.preparar_paquete_postproduccion(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_key text:=btrim(coalesce(p->>'package_key','')); v_board_id bigint:=nullif(p->>'storyboard_id','')::bigint;
  v_plan_id bigint:=nullif(p->>'routing_plan_id','')::bigint; v_board public.agency_storyboards%rowtype;
  v_plan public.agency_scene_routing_plans%rowtype; v_selection jsonb; v_review public.agency_scene_quality_reviews%rowtype;
  v_shot public.agency_storyboard_shots%rowtype; v_asset public.brand_media_assets%rowtype; v_sealed jsonb:='[]'::jsonb;
  v_snapshot jsonb; v_fingerprint text; v_version integer; v_id bigint; v_count integer; v_existing public.agency_postproduction_packages%rowtype;
  v_audio jsonb:=coalesce(p->'audio_plan','{}'::jsonb); v_subtitles jsonb:=coalesce(p->'subtitle_plan','{}'::jsonb);
  v_edit jsonb:=coalesce(p->'edit_decisions','{}'::jsonb); v_export jsonb:=coalesce(p->'export_spec','{}'::jsonb);
begin
  v_actor:=public._agency_actor();
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) or v_key !~ '^[A-Za-z0-9:_-]{3,220}$'
     or jsonb_typeof(p->'selections')<>'array' or jsonb_typeof(v_audio)<>'object' or jsonb_typeof(v_subtitles)<>'object'
     or jsonb_typeof(v_edit)<>'object' or jsonb_typeof(v_export)<>'object' then raise exception 'El paquete de postproducción es inválido o contiene secretos.'; end if;
  select * into v_board from public.agency_storyboards where id=v_board_id for update;
  select * into v_plan from public.agency_scene_routing_plans where id=v_plan_id;
  if v_board.id is null or v_board.status<>'Aprobado' or v_plan.id is null or v_plan.status<>'Autorizado'
     or v_plan.storyboard_id<>v_board.id or v_plan.plan_fingerprint<>public._agency_mesa_fingerprint(v_plan.plan_snapshot)
     or v_board.source_fingerprint<>v_plan.plan_snapshot->>'storyboard_fingerprint' then raise exception 'Storyboard o ruta no están aprobados e íntegros.'; end if;
  select count(*)::integer into v_count from public.agency_storyboard_shots where storyboard_id=v_board.id and status='Vigente';
  if jsonb_array_length(p->'selections')<>v_count or (select count(distinct (value->>'shot_id')::bigint) from jsonb_array_elements(p->'selections'))<>v_count then
    raise exception 'El corte debe cubrir exactamente una vez cada toma vigente.';
  end if;
  for v_selection in
    select e.value from jsonb_array_elements(p->'selections') e(value)
    order by (select s.shot_number from public.agency_storyboard_shots s where s.id=(e.value->>'shot_id')::bigint)
  loop
    select * into v_review from public.agency_scene_quality_reviews where id=nullif(v_selection->>'review_id','')::bigint and status='Aprobada';
    if v_review.id is null or v_review.storyboard_id<>v_board.id or v_review.routing_plan_id<>v_plan.id
       or v_review.shot_id<>nullif(v_selection->>'shot_id','')::bigint or v_review.job_id<>nullif(v_selection->>'job_id','')::bigint
       or v_review.output_asset_id<>nullif(v_selection->>'output_asset_id','')::bigint then raise exception 'Una selección no coincide con su control aprobado.'; end if;
    select * into v_shot from public.agency_storyboard_shots where id=v_review.shot_id and storyboard_id=v_board.id and status='Vigente';
    select * into v_asset from public.brand_media_assets where id=v_review.output_asset_id and status='Activo' and rights_status='Autorizado';
    if v_shot.id is null or v_asset.id is null or v_review.evidence_snapshot->>'shot_fingerprint'<>v_shot.shot_fingerprint
       or v_review.evidence_snapshot->>'output_content_hash'<>v_asset.content_hash then raise exception 'La toma o el archivo cambió después del control.'; end if;
    v_sealed:=v_sealed||jsonb_build_array(jsonb_build_object('shot_id',v_shot.id,'shot_number',v_shot.shot_number,
      'shot_fingerprint',v_shot.shot_fingerprint,'review_id',v_review.id,'quality_fingerprint',v_review.review_fingerprint,
      'job_id',v_review.job_id,'output_asset_id',v_asset.id,'output_content_hash',v_asset.content_hash));
  end loop;
  v_snapshot:=jsonb_build_object('schema_version',1,'storyboard_id',v_board.id,'storyboard_fingerprint',v_board.source_fingerprint,
    'routing_plan_id',v_plan.id,'routing_fingerprint',v_plan.plan_fingerprint,'selections',v_sealed,
    'audio_plan',v_audio,'subtitle_plan',v_subtitles,'edit_decisions',v_edit,'export_spec',v_export,
    'publication_authorized',false,'distribution_authorized',false);
  v_fingerprint:=public._agency_mesa_fingerprint(v_snapshot);
  select * into v_existing from public.agency_postproduction_packages where package_key=v_key or (storyboard_id=v_board.id and package_fingerprint=v_fingerprint) limit 1;
  if v_existing.id is not null then
    if v_existing.package_fingerprint<>v_fingerprint then raise exception 'La clave ya pertenece a otro paquete.'; end if;
    return jsonb_build_object('ok',true,'package_id',v_existing.id,'version',v_existing.version,'status',v_existing.status,'duplicate',true,'published',false);
  end if;
  perform pg_advisory_xact_lock(hashtext('agency_postproduction:'||v_board.id::text));
  select coalesce(max(version),0)+1 into v_version from public.agency_postproduction_packages where storyboard_id=v_board.id;
  update public.agency_postproduction_packages set status='Sustituido' where storyboard_id=v_board.id and status='Preparado';
  insert into public.agency_postproduction_packages(package_key,storyboard_id,routing_plan_id,version,package_snapshot,package_fingerprint,prepared_by)
  values(v_key,v_board.id,v_plan.id,v_version,v_snapshot,v_fingerprint,v_actor.id) returning id into v_id;
  perform public._add_audit('Postproducción Agencia',v_id::text,'Paquete preparado','',format('%s tomas · versión %s',v_count,v_version));
  return jsonb_build_object('ok',true,'package_id',v_id,'version',v_version,'status','Preparado','duplicate',false,
    'requires_human_approval',true,'published',false,'distribution_authorized',false);
end $$;

create or replace function public.resolver_paquete_postproduccion(p_package_id bigint,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_package public.agency_postproduction_packages%rowtype; v_selection jsonb;
  v_review public.agency_scene_quality_reviews%rowtype; v_board public.agency_storyboards%rowtype;
  v_plan public.agency_scene_routing_plans%rowtype; v_shot public.agency_storyboard_shots%rowtype;
  v_asset public.brand_media_assets%rowtype; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor(); select * into v_package from public.agency_postproduction_packages where id=p_package_id for update;
  if v_package.id is null or v_package.status<>'Preparado' then raise exception 'El paquete no espera revisión.'; end if;
  if v_package.package_fingerprint<>public._agency_mesa_fingerprint(v_package.package_snapshot) then raise exception 'El paquete perdió integridad.'; end if;
  if p_decision='Devolver' then
    if length(v_note)<5 then raise exception 'Explicá qué debe corregirse en el corte.'; end if;
    update public.agency_postproduction_packages set status='Devuelto',reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_package.id;
  elsif p_decision='Aprobar' then
    select * into v_board from public.agency_storyboards where id=v_package.storyboard_id;
    select * into v_plan from public.agency_scene_routing_plans where id=v_package.routing_plan_id;
    if v_board.id is null or v_board.status<>'Aprobado' or v_plan.id is null or v_plan.status<>'Autorizado'
       or v_package.package_snapshot->>'storyboard_fingerprint'<>v_board.source_fingerprint
       or v_package.package_snapshot->>'routing_fingerprint'<>v_plan.plan_fingerprint then
      raise exception 'Storyboard o ruta cambiaron antes del corte final.';
    end if;
    for v_selection in select value from jsonb_array_elements(v_package.package_snapshot->'selections') loop
      select * into v_review from public.agency_scene_quality_reviews where id=(v_selection->>'review_id')::bigint and status='Aprobada';
      select * into v_shot from public.agency_storyboard_shots where id=(v_selection->>'shot_id')::bigint and status='Vigente';
      select * into v_asset from public.brand_media_assets where id=(v_selection->>'output_asset_id')::bigint and status='Activo' and rights_status='Autorizado';
      if v_review.id is null or v_review.review_fingerprint<>v_selection->>'quality_fingerprint'
         or v_shot.id is null or v_shot.shot_fingerprint<>v_selection->>'shot_fingerprint'
         or v_asset.id is null or v_asset.content_hash<>v_selection->>'output_content_hash' then
        raise exception 'Una toma, control o archivo dejó de estar aprobado e íntegro.';
      end if;
    end loop;
    update public.agency_postproduction_packages set status='Aprobado',reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_package.id;
  else raise exception 'La decisión debe ser Aprobar o Devolver.'; end if;
  perform public._add_audit('Postproducción Agencia',v_package.id::text,'Paquete resuelto','Preparado',p_decision||case when v_note='' then '' else ' · '||v_note end);
  return jsonb_build_object('ok',true,'package_id',v_package.id,'status',case when p_decision='Aprobar' then 'Aprobado' else 'Devuelto' end,
    'published',false,'distribution_authorized',false);
end $$;

revoke all on function public.calidad_postproduccion_disponible() from public,anon;
revoke all on function public._agency_quality_scores_valid(jsonb) from public,anon,authenticated;
revoke all on function public._agency_quality_can_approve(jsonb) from public,anon,authenticated;
revoke all on function public._agency_quality_immutable() from public,anon,authenticated;
revoke all on function public._agency_postproduction_immutable() from public,anon,authenticated;
revoke all on function public._registrar_revision_calidad_escena(jsonb,text,text,boolean) from public,anon,authenticated;
revoke all on function public.registrar_revision_calidad_escena(jsonb) from public,anon;
revoke all on function public.registrar_revision_calidad_agente(jsonb) from public,anon,authenticated;
revoke all on function public.obtener_contexto_calidad_agente(bigint) from public,anon,authenticated;
revoke all on function public.resolver_revision_calidad_escena(bigint,text,text,text) from public,anon;
revoke all on function public.preparar_paquete_postproduccion(jsonb) from public,anon;
revoke all on function public.resolver_paquete_postproduccion(bigint,text,text) from public,anon;
grant execute on function public.calidad_postproduccion_disponible() to authenticated;
grant execute on function public.registrar_revision_calidad_escena(jsonb) to authenticated;
grant execute on function public.resolver_revision_calidad_escena(bigint,text,text,text) to authenticated;
grant execute on function public.preparar_paquete_postproduccion(jsonb) to authenticated;
grant execute on function public.resolver_paquete_postproduccion(bigint,text,text) to authenticated;
grant execute on function public.registrar_revision_calidad_agente(jsonb) to service_role;
grant execute on function public.obtener_contexto_calidad_agente(bigint) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_33_calidad_postproduccion','QA por toma, continuidad, clasificación de fallos y paquete de postproducción con aprobación humana')
on conflict(id) do nothing;

commit;
