-- MOMOS OPS · H105 · Humanización y Comunidad.
--
-- Versiona series y episodios, reutiliza los permisos de Biblioteca de
-- Producción y recibe únicamente señales comunitarias agregadas. No conserva
-- comentarios, perfiles o mensajes crudos; tampoco responde, contacta,
-- publica, pauta o reutiliza UGC automáticamente.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_103_inteligencia_creativa_publicitaria')
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_104_piloto_comercial_ui') then
    raise exception 'H105 requiere la cadena H103 -> H104 completa.';
  end if;
  if to_regclass('public.brand_production_packs') is null
     or to_regclass('public.brand_asset_production_profiles') is null
     or to_regclass('public.content_posts') is null
     or to_regclass('public.metrics_daily') is null
     or to_regprocedure('public.estado_paquete_produccion(bigint)') is null
     or to_regprocedure('public._agency_actor()') is null
     or to_regprocedure('public._agency_mesa_has_secret(jsonb)') is null
     or to_regprocedure('public._momos_touch_agency_snapshot_event_v1()') is null
     or to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'H105 requiere Biblioteca, Agencia, métricas y snapshot sanitario canónicos.';
  end if;
end $$;

create table if not exists public.agency_humanization_series(
  id bigint generated always as identity primary key,
  proposal_key text not null unique check(proposal_key~'^[A-Za-z0-9_.:-]{8,120}$'),
  series_key text not null check(series_key~'^[A-Za-z0-9_.:-]{3,100}$'),
  version integer not null check(version>0),
  name text not null check(length(btrim(name)) between 3 and 160),
  purpose text not null check(length(btrim(purpose)) between 10 and 500),
  protagonist text not null check(protagonist in (
    'Equipo','Comunidad','Personajes MOMOS','Producto real')),
  emotional_territory text not null check(emotional_territory in (
    'Antojo','Ternura','Celebración','Compañía','Humor','Pertenencia')),
  mode text not null check(mode in ('Orgánico','Pauta','Híbrido')),
  channel text not null check(channel in ('Instagram','Facebook','TikTok','YouTube','WhatsApp','Web')),
  status text not null default 'Propuesta' check(status in (
    'Propuesta','En revisión','Aprobada','Sustituida','Archivada','Descartada')),
  source_formula_id bigint references public.agency_creative_formulas(id) on delete restrict,
  editorial_contract jsonb not null check(jsonb_typeof(editorial_contract)='object'),
  series_fingerprint text not null check(series_fingerprint~'^[0-9a-f]{64}$'),
  source_kind text not null check(source_kind in ('Humano','Agente')),
  prepared_by text references public.users(id),
  prepared_by_agent text not null default '',
  prepared_at timestamptz not null default clock_timestamp(),
  reviewed_by text references public.users(id),
  reviewed_at timestamptz,
  review_note text not null default '',
  unique(series_key,version),
  check((source_kind='Humano' and prepared_by is not null and prepared_by_agent='')
    or (source_kind='Agente' and prepared_by is null
      and length(btrim(prepared_by_agent)) between 3 and 100)),
  check((status in ('Propuesta','En revisión') and reviewed_at is null)
    or (status in ('Aprobada','Sustituida','Archivada','Descartada') and reviewed_at is not null))
);
create index if not exists agency_humanization_series_status_idx
  on public.agency_humanization_series(status,prepared_at desc,id desc);
create unique index if not exists agency_humanization_series_one_approved_idx
  on public.agency_humanization_series(series_key) where status='Aprobada';

create table if not exists public.agency_humanization_episodes(
  id bigint generated always as identity primary key,
  proposal_key text not null unique check(proposal_key~'^[A-Za-z0-9_.:-]{8,120}$'),
  episode_key text not null check(episode_key~'^[A-Za-z0-9_.:-]{3,120}$'),
  series_id bigint not null references public.agency_humanization_series(id) on delete restrict,
  title text not null check(length(btrim(title)) between 3 and 180),
  story_kind text not null check(story_kind in (
    'Detrás de escena','Ritual de producto','Historia autorizada','UGC autorizado',
    'Pregunta de comunidad','Personaje y mundo','Momento de equipo')),
  representation text not null check(representation in (
    'Persona real','Personaje ficticio','Recreación / actor','Contenido sintético',
    'Producto real','Comunidad agregada')),
  status text not null default 'Propuesta' check(status in (
    'Propuesta','En revisión','Aprobado','Archivado','Descartado')),
  production_pack_id bigint references public.brand_production_packs(id) on delete restrict,
  source_formula_id bigint references public.agency_creative_formulas(id) on delete restrict,
  source_brief_id bigint references public.agency_briefs(id) on delete restrict,
  source_creative_id text references public.creatives(id) on delete restrict,
  episode_contract jsonb not null check(jsonb_typeof(episode_contract)='object'),
  episode_fingerprint text not null check(episode_fingerprint~'^[0-9a-f]{64}$'),
  source_kind text not null check(source_kind in ('Humano','Agente')),
  prepared_by text references public.users(id),
  prepared_by_agent text not null default '',
  prepared_at timestamptz not null default clock_timestamp(),
  reviewed_by text references public.users(id),
  reviewed_at timestamptz,
  review_note text not null default '',
  unique(series_id,episode_key),
  check((source_kind='Humano' and prepared_by is not null and prepared_by_agent='')
    or (source_kind='Agente' and prepared_by is null
      and length(btrim(prepared_by_agent)) between 3 and 100)),
  check((status in ('Propuesta','En revisión') and reviewed_at is null)
    or (status in ('Aprobado','Archivado','Descartado') and reviewed_at is not null))
);
create index if not exists agency_humanization_episodes_status_idx
  on public.agency_humanization_episodes(status,prepared_at desc,id desc);
create index if not exists agency_humanization_episodes_series_idx
  on public.agency_humanization_episodes(series_id,status,prepared_at desc);

create table if not exists public.agency_humanization_episode_publications(
  episode_id bigint primary key references public.agency_humanization_episodes(id) on delete restrict,
  post_id text not null unique references public.content_posts(id) on delete restrict,
  linked_by text not null references public.users(id),
  linked_at timestamptz not null default clock_timestamp(),
  link_note text not null check(length(btrim(link_note)) between 10 and 400)
);

create table if not exists public.agency_community_signal_rollups(
  id bigint generated always as identity primary key,
  signal_key text not null unique check(signal_key~'^[A-Za-z0-9_.:-]{8,140}$'),
  episode_id bigint not null references public.agency_humanization_episodes(id) on delete restrict,
  platform text not null check(platform in ('Meta','TikTok')),
  window_start date not null,
  window_end date not null,
  impressions bigint not null check(impressions>=0),
  reach bigint not null check(reach>=0),
  comments_total integer not null check(comments_total>=0),
  meaningful_comments integer not null check(meaningful_comments between 0 and comments_total),
  questions integer not null check(questions between 0 and comments_total),
  shares integer not null check(shares>=0),
  saves integer not null check(saves>=0),
  mentions integer not null check(mentions>=0),
  authorized_ugc integer not null check(authorized_ugc>=0),
  recurring_conversations integer not null check(recurring_conversations>=0),
  character_associations integer not null check(character_associations>=0),
  connection_signals integer generated always as (
    meaningful_comments+shares+saves+mentions+authorized_ugc+
    recurring_conversations+character_associations) stored,
  themes jsonb not null default '[]'::jsonb check(jsonb_typeof(themes)='array'),
  evidence_fingerprint text not null check(evidence_fingerprint~'^[0-9a-f]{64}$'),
  source_kind text not null check(source_kind in ('Humano','Conector')),
  recorded_by text references public.users(id),
  recorded_by_connector text not null default '',
  recorded_at timestamptz not null default clock_timestamp(),
  outcome text not null default 'En revisión' check(outcome in (
    'En revisión','Conexión ganadora','Prometedora','Inconclusa','Agotada','Descartada')),
  decided_by text references public.users(id),
  decided_at timestamptz,
  decision_note text not null default '',
  unique(episode_id,platform,window_start,window_end,evidence_fingerprint),
  check(window_start<=window_end and window_end-window_start<=30),
  check((source_kind='Humano' and recorded_by is not null and recorded_by_connector='')
    or (source_kind='Conector' and recorded_by is null
      and length(btrim(recorded_by_connector)) between 3 and 100)),
  check((outcome='En revisión' and decided_by is null and decided_at is null)
    or (outcome<>'En revisión' and decided_by is not null and decided_at is not null
      and length(btrim(decision_note)) between 20 and 600))
);
create index if not exists agency_community_signal_rollups_recent_idx
  on public.agency_community_signal_rollups(recorded_at desc,id desc);
create index if not exists agency_community_signal_rollups_episode_idx
  on public.agency_community_signal_rollups(episode_id,window_end desc,id desc);

-- Reinstala los contratos textuales para que una reaplicación idempotente
-- también repare defaults o constraints creados por un transporte no UTF-8.
alter table public.agency_humanization_series
  drop constraint if exists agency_humanization_series_emotional_territory_check,
  drop constraint if exists agency_humanization_series_mode_check,
  drop constraint if exists agency_humanization_series_status_check,
  drop constraint if exists agency_humanization_series_check1;
alter table public.agency_humanization_series
  add constraint agency_humanization_series_emotional_territory_check check(emotional_territory in (
    'Antojo','Ternura','Celebración','Compañía','Humor','Pertenencia')),
  add constraint agency_humanization_series_mode_check check(mode in ('Orgánico','Pauta','Híbrido')),
  add constraint agency_humanization_series_status_check check(status in (
    'Propuesta','En revisión','Aprobada','Sustituida','Archivada','Descartada')),
  add constraint agency_humanization_series_check1 check(
    (status in ('Propuesta','En revisión') and reviewed_at is null)
    or (status in ('Aprobada','Sustituida','Archivada','Descartada') and reviewed_at is not null));

alter table public.agency_humanization_episodes
  drop constraint if exists agency_humanization_episodes_story_kind_check,
  drop constraint if exists agency_humanization_episodes_representation_check,
  drop constraint if exists agency_humanization_episodes_status_check,
  drop constraint if exists agency_humanization_episodes_check1;
alter table public.agency_humanization_episodes
  add constraint agency_humanization_episodes_story_kind_check check(story_kind in (
    'Detrás de escena','Ritual de producto','Historia autorizada','UGC autorizado',
    'Pregunta de comunidad','Personaje y mundo','Momento de equipo')),
  add constraint agency_humanization_episodes_representation_check check(representation in (
    'Persona real','Personaje ficticio','Recreación / actor','Contenido sintético',
    'Producto real','Comunidad agregada')),
  add constraint agency_humanization_episodes_status_check check(status in (
    'Propuesta','En revisión','Aprobado','Archivado','Descartado')),
  add constraint agency_humanization_episodes_check1 check(
    (status in ('Propuesta','En revisión') and reviewed_at is null)
    or (status in ('Aprobado','Archivado','Descartado') and reviewed_at is not null));

alter table public.agency_community_signal_rollups
  alter column outcome set default 'En revisión',
  drop constraint if exists agency_community_signal_rollups_outcome_check,
  drop constraint if exists agency_community_signal_rollups_check4;
alter table public.agency_community_signal_rollups
  add constraint agency_community_signal_rollups_outcome_check check(outcome in (
    'En revisión','Conexión ganadora','Prometedora','Inconclusa','Agotada','Descartada')),
  add constraint agency_community_signal_rollups_check4 check(
    (outcome='En revisión' and decided_by is null and decided_at is null)
    or (outcome<>'En revisión' and decided_by is not null and decided_at is not null
      and length(btrim(decision_note)) between 20 and 600));

alter table public.agency_humanization_series enable row level security;
alter table public.agency_humanization_episodes enable row level security;
alter table public.agency_humanization_episode_publications enable row level security;
alter table public.agency_community_signal_rollups enable row level security;
revoke all on public.agency_humanization_series,
  public.agency_humanization_episodes,
  public.agency_humanization_episode_publications,
  public.agency_community_signal_rollups from public,anon,authenticated,service_role;
revoke all on sequence public.agency_humanization_series_id_seq,
  public.agency_humanization_episodes_id_seq,
  public.agency_community_signal_rollups_id_seq from public,anon,authenticated,service_role;

create or replace function public._agency_humanization_fingerprint(p jsonb)
returns text language sql immutable security definer set search_path=public as $$
  select encode(pg_catalog.sha256(convert_to(p::text,'UTF8')),'hex')
$$;

create or replace function public._agency_humanization_safe_text(
  p text,p_min integer default 2,p_max integer default 700)
returns boolean language sql immutable security definer set search_path=public as $$
  select p is not null and length(btrim(p)) between p_min and p_max
    and p !~ '[[:cntrl:]]'
    and p !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}'
    and regexp_replace(p,'[^0-9]','','g') !~ '[0-9]{7,}'
    and p !~* '(^|[[:space:]])@[A-Z0-9_.-]{2,}'
    and p !~* '(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|service[_ -]?role|authorization)'
$$;

create or replace function public._agency_humanization_editorial_contract_valid(p jsonb)
returns boolean language plpgsql immutable security definer set search_path=public as $$
declare v_key text; v_value jsonb; v_item jsonb;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p)
     or (select array_agg(key order by key) from jsonb_object_keys(p) x(key))
       is distinct from array[
         'allowed_variables','audience','cta','evidence','fixed_elements','format',
         'frequency','hook','narrative_formula','restrictions','ritual','tone']::text[] then
    return false;
  end if;
  foreach v_key in array array[
    'audience','hook','narrative_formula','ritual','tone','format','evidence','cta','frequency'
  ] loop
    if not public._agency_humanization_safe_text(p->>v_key,2,500) then return false; end if;
  end loop;
  foreach v_key in array array['fixed_elements','allowed_variables','restrictions'] loop
    v_value:=p->v_key;
    if jsonb_typeof(v_value)<>'array' or jsonb_array_length(v_value) not between 1 and 12 then return false; end if;
    for v_item in select value from jsonb_array_elements(v_value) loop
      if jsonb_typeof(v_item)<>'string'
         or not public._agency_humanization_safe_text(v_item#>>'{}',2,180) then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create or replace function public._agency_humanization_episode_contract_valid(
  p jsonb,p_representation text)
returns boolean language plpgsql immutable security definer set search_path=public as $$
declare v_key text;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p)
     or (select array_agg(key order by key) from jsonb_object_keys(p) x(key))
       is distinct from array[
         'angle','cta','hook','privacy_note','proof','single_variable',
         'story_arc','synthetic_disclosure']::text[] then
    return false;
  end if;
  foreach v_key in array array['angle','cta','hook','privacy_note','proof','single_variable','story_arc'] loop
    if not public._agency_humanization_safe_text(p->>v_key,2,500) then return false; end if;
  end loop;
  if p_representation='Contenido sintético' then
    if not public._agency_humanization_safe_text(p->>'synthetic_disclosure',10,300) then return false; end if;
  elsif coalesce(p->>'synthetic_disclosure','')<>'' then
    if not public._agency_humanization_safe_text(p->>'synthetic_disclosure',2,300) then return false; end if;
  end if;
  return true;
end $$;

create or replace function public._agency_humanization_themes_valid(p jsonb)
returns boolean language plpgsql immutable security definer set search_path=public as $$
declare v_item jsonb; v_count integer;
begin
  if p is null or jsonb_typeof(p)<>'array' or jsonb_array_length(p)>12
     or public._agency_mesa_has_secret(p) then return false; end if;
  for v_item in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(v_item)<>'object'
       or (select array_agg(key order by key) from jsonb_object_keys(v_item) x(key))
         is distinct from array['count','sentiment','theme']::text[]
       or v_item->>'theme' not in ('Antojo','Sabor','Textura','Empaque','Personaje',
         'Regalo','Precio','Disponibilidad','Preparación','Experiencia','Otro agregado')
       or v_item->>'sentiment' not in ('Positivo','Neutro','Mixto','Negativo') then return false; end if;
    begin v_count:=(v_item->>'count')::integer; exception when others then return false; end;
    if v_count<1 then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public._agency_humanization_pack_ready(
  p_pack_id bigint,p_representation text,p_story_kind text,p_channel text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_pack public.brand_production_packs%rowtype; v_reasons text[]:='{}'; v_need_person boolean;
begin
  v_need_person:=p_representation in ('Persona real','Recreación / actor')
    or p_story_kind in ('Historia autorizada','UGC autorizado','Momento de equipo');
  if p_pack_id is null then
    if v_need_person then v_reasons:=array_append(v_reasons,'La historia necesita un paquete de producción aprobado con consentimiento.'); end if;
    return jsonb_build_object('ready',cardinality(v_reasons)=0,'reasons',to_jsonb(v_reasons));
  end if;
  select * into v_pack from public.brand_production_packs where id=p_pack_id;
  if v_pack.id is null then v_reasons:=array_append(v_reasons,'El paquete de producción no existe.');
  else
    if v_pack.status<>'Aprobado' then v_reasons:=array_append(v_reasons,'El paquete de producción no está aprobado.'); end if;
    if v_pack.channel<>p_channel then v_reasons:=array_append(v_reasons,'El paquete no autoriza el canal de la serie.'); end if;
    if coalesce((public.estado_paquete_produccion(v_pack.id)->>'ready')::boolean,false) is not true then
      v_reasons:=array_append(v_reasons,'El paquete perdió derechos, QA o referencias obligatorias.');
    end if;
    if v_need_person and not exists(
      select 1 from public.brand_production_pack_assets pa
      join public.brand_media_assets a on a.id=pa.asset_id
      join public.brand_asset_production_profiles pp on pp.asset_id=a.id
      where pa.pack_id=v_pack.id and a.contains_people
        and a.status='Activo' and a.rights_status='Autorizado'
        and a.ai_use_allowed and (a.rights_expires_at is null or a.rights_expires_at>=current_date)
        and (jsonb_array_length(a.allowed_channels)=0 or a.allowed_channels ? p_channel or a.allowed_channels ? 'Todos')
        and pp.consent_status='Autorizado' and pp.qa_status='Aprobado'
        and pp.component_type in ('Manos','Presentador UGC')) then
      v_reasons:=array_append(v_reasons,'No hay una persona identificable con consentimiento, derechos y QA vigentes para este canal.');
    end if;
  end if;
  return jsonb_build_object('ready',cardinality(v_reasons)=0,'reasons',to_jsonb(v_reasons));
end $$;

create or replace function public._agency_humanization_series_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Una serie humanizada no se elimina; se archiva.'; end if;
  if row(new.proposal_key,new.series_key,new.version,new.name,new.purpose,new.protagonist,
      new.emotional_territory,new.mode,new.channel,new.source_formula_id,new.editorial_contract,
      new.series_fingerprint,new.source_kind,new.prepared_by,new.prepared_by_agent,new.prepared_at)
    is distinct from row(old.proposal_key,old.series_key,old.version,old.name,old.purpose,old.protagonist,
      old.emotional_territory,old.mode,old.channel,old.source_formula_id,old.editorial_contract,
      old.series_fingerprint,old.source_kind,old.prepared_by,old.prepared_by_agent,old.prepared_at) then
    raise exception 'Los hechos y el contrato de la serie son inmutables.';
  end if;
  if old.status not in ('Propuesta','En revisión') and row(new.status,new.reviewed_by,new.reviewed_at,new.review_note)
    is distinct from row(old.status,old.reviewed_by,old.reviewed_at,old.review_note) then
    raise exception 'La decisión terminal de la serie está sellada.';
  end if;
  return new;
end $$;
drop trigger if exists agency_humanization_series_guard on public.agency_humanization_series;
create trigger agency_humanization_series_guard before update or delete
  on public.agency_humanization_series for each row execute function public._agency_humanization_series_guard();

create or replace function public._agency_humanization_episode_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Un episodio humanizado no se elimina; se archiva.'; end if;
  if row(new.proposal_key,new.episode_key,new.series_id,new.title,new.story_kind,new.representation,
      new.production_pack_id,new.source_formula_id,new.source_brief_id,new.source_creative_id,
      new.episode_contract,new.episode_fingerprint,new.source_kind,new.prepared_by,
      new.prepared_by_agent,new.prepared_at)
    is distinct from row(old.proposal_key,old.episode_key,old.series_id,old.title,old.story_kind,old.representation,
      old.production_pack_id,old.source_formula_id,old.source_brief_id,old.source_creative_id,
      old.episode_contract,old.episode_fingerprint,old.source_kind,old.prepared_by,
      old.prepared_by_agent,old.prepared_at) then
    raise exception 'Los hechos y el contrato del episodio son inmutables.';
  end if;
  if old.status not in ('Propuesta','En revisión') and row(new.status,new.reviewed_by,new.reviewed_at,new.review_note)
    is distinct from row(old.status,old.reviewed_by,old.reviewed_at,old.review_note) then
    raise exception 'La decisión terminal del episodio está sellada.';
  end if;
  return new;
end $$;
drop trigger if exists agency_humanization_episode_guard on public.agency_humanization_episodes;
create trigger agency_humanization_episode_guard before update or delete
  on public.agency_humanization_episodes for each row execute function public._agency_humanization_episode_guard();

create or replace function public._agency_humanization_fact_immutable()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  raise exception 'La evidencia humanizada es inmutable; registrá una nueva ventana.';
end $$;
drop trigger if exists agency_humanization_publication_immutable on public.agency_humanization_episode_publications;
create trigger agency_humanization_publication_immutable before update or delete
  on public.agency_humanization_episode_publications for each row execute function public._agency_humanization_fact_immutable();

create or replace function public._agency_community_signal_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Una señal comunitaria no se elimina.'; end if;
  if row(new.signal_key,new.episode_id,new.platform,new.window_start,new.window_end,
      new.impressions,new.reach,new.comments_total,new.meaningful_comments,new.questions,
      new.shares,new.saves,new.mentions,new.authorized_ugc,new.recurring_conversations,
      new.character_associations,new.themes,new.evidence_fingerprint,new.source_kind,
      new.recorded_by,new.recorded_by_connector,new.recorded_at)
    is distinct from row(old.signal_key,old.episode_id,old.platform,old.window_start,old.window_end,
      old.impressions,old.reach,old.comments_total,old.meaningful_comments,old.questions,
      old.shares,old.saves,old.mentions,old.authorized_ugc,old.recurring_conversations,
      old.character_associations,old.themes,old.evidence_fingerprint,old.source_kind,
      old.recorded_by,old.recorded_by_connector,old.recorded_at) then
    raise exception 'Los hechos agregados de comunidad son inmutables.';
  end if;
  if old.outcome<>'En revisión' and row(new.outcome,new.decided_by,new.decided_at,new.decision_note)
    is distinct from row(old.outcome,old.decided_by,old.decided_at,old.decision_note) then
    raise exception 'La decisión comunitaria terminal está sellada.';
  end if;
  return new;
end $$;
drop trigger if exists agency_community_signal_guard on public.agency_community_signal_rollups;
create trigger agency_community_signal_guard before update or delete
  on public.agency_community_signal_rollups for each row execute function public._agency_community_signal_guard();

do $$ declare v_table text;
begin
  foreach v_table in array array[
    'agency_humanization_series','agency_humanization_episodes',
    'agency_humanization_episode_publications','agency_community_signal_rollups'
  ] loop
    execute format('drop trigger if exists momos_agency_snapshot_event_v1 on public.%I',v_table);
    execute format('create trigger momos_agency_snapshot_event_v1 after insert or update or delete or truncate on public.%I for each statement execute function public._momos_touch_agency_snapshot_event_v1()',v_table);
  end loop;
end $$;

create or replace function public._proponer_serie_humanizacion_v1(p jsonb,p_actor text,p_agent text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_proposal text:=btrim(coalesce(p->>'proposal_key','')); v_key text:=btrim(coalesce(p->>'series_key',''));
  v_name text:=btrim(coalesce(p->>'name','')); v_purpose text:=btrim(coalesce(p->>'purpose',''));
  v_protagonist text:=p->>'protagonist'; v_territory text:=p->>'emotional_territory';
  v_mode text:=p->>'mode'; v_channel text:=p->>'channel'; v_contract jsonb:=coalesce(p->'editorial_contract','{}');
  v_formula bigint:=nullif(p->>'source_formula_id','')::bigint; v_fp text; v_version integer; v_id bigint;
  v_existing public.agency_humanization_series%rowtype;
begin
  if p is null or jsonb_typeof(p)<>'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in(
       'proposal_key','series_key','name','purpose','protagonist','emotional_territory',
       'mode','channel','source_formula_id','editorial_contract'))
     or v_proposal!~'^[A-Za-z0-9_.:-]{8,120}$' or v_key!~'^[A-Za-z0-9_.:-]{3,100}$'
     or not public._agency_humanization_safe_text(v_name,3,160)
     or not public._agency_humanization_safe_text(v_purpose,10,500)
     or v_protagonist not in ('Equipo','Comunidad','Personajes MOMOS','Producto real')
     or v_territory not in ('Antojo','Ternura','Celebración','Compañía','Humor','Pertenencia')
     or v_mode not in ('Orgánico','Pauta','Híbrido')
     or v_channel not in ('Instagram','Facebook','TikTok','YouTube','WhatsApp','Web')
     or not public._agency_humanization_editorial_contract_valid(v_contract) then
    raise exception 'La serie no cumple el contrato cerrado o contiene PII/secretos.';
  end if;
  if v_formula is not null and not exists(select 1 from public.agency_creative_formulas
    where id=v_formula and status='Aprobada') then raise exception 'La fórmula fuente no está aprobada.'; end if;
  v_fp:=public._agency_humanization_fingerprint(jsonb_build_object('series_key',v_key,'name',v_name,
    'purpose',v_purpose,'protagonist',v_protagonist,'emotional_territory',v_territory,
    'mode',v_mode,'channel',v_channel,'source_formula_id',v_formula,'editorial_contract',v_contract));
  select * into v_existing from public.agency_humanization_series where proposal_key=v_proposal;
  if v_existing.id is not null then
    if v_existing.series_fingerprint<>v_fp then raise exception 'La clave idempotente pertenece a otra serie.'; end if;
    return jsonb_build_object('ok',true,'series_id',v_existing.id,'version',v_existing.version,
      'status',v_existing.status,'duplicate',true,'human_approval_required',true,'external_execution',false);
  end if;
  perform pg_advisory_xact_lock(hashtext('agency_humanization_series:'||v_key));
  select coalesce(max(version),0)+1 into v_version from public.agency_humanization_series where series_key=v_key;
  insert into public.agency_humanization_series(proposal_key,series_key,version,name,purpose,protagonist,
    emotional_territory,mode,channel,source_formula_id,editorial_contract,series_fingerprint,
    source_kind,prepared_by,prepared_by_agent)
  values(v_proposal,v_key,v_version,v_name,v_purpose,v_protagonist,v_territory,v_mode,v_channel,
    v_formula,v_contract,v_fp,case when p_actor is null then 'Agente' else 'Humano' end,
    p_actor,coalesce(p_agent,'')) returning id into v_id;
  return jsonb_build_object('ok',true,'series_id',v_id,'version',v_version,'status','Propuesta',
    'duplicate',false,'human_approval_required',true,'external_execution',false);
end $$;

create or replace function public.proponer_serie_humanizacion_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; begin v_actor:=public._agency_actor();
  return public._proponer_serie_humanizacion_v1(p,v_actor.id,null); end $$;
create or replace function public.proponer_serie_humanizacion_agente_v1(p jsonb)
returns jsonb language sql security definer set search_path=public as $$
  select public._proponer_serie_humanizacion_v1(p,null,'Codex · MOMOS Agency MCP') $$;

create or replace function public.revisar_serie_humanizacion_v1(p_series_id bigint,p_status text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_row public.agency_humanization_series%rowtype; v_note text:=btrim(coalesce(p_note,'')); v_ok boolean;
begin
  v_actor:=public._agency_actor(); select * into v_row from public.agency_humanization_series where id=p_series_id for update;
  if v_row.id is null then raise exception 'La serie no existe.'; end if;
  v_ok:=(v_row.status='Propuesta' and p_status in ('En revisión','Descartada'))
    or (v_row.status='En revisión' and p_status in ('Aprobada','Descartada'))
    or (v_row.status='Aprobada' and p_status in ('Sustituida','Archivada'));
  if not v_ok or not public._agency_humanization_safe_text(v_note,10,600) then raise exception 'La revisión de serie es inválida.'; end if;
  if p_status='Aprobada' and exists(select 1 from public.agency_humanization_series
    where series_key=v_row.series_key and status='Aprobada' and id<>v_row.id) then
    raise exception 'Primero sustituí o archivá la versión aprobada anterior.';
  end if;
  update public.agency_humanization_series set status=p_status,reviewed_by=case when p_status='En revisión' then null else v_actor.id end,
    reviewed_at=case when p_status='En revisión' then null else clock_timestamp() end,
    review_note=case when p_status='En revisión' then '' else v_note end where id=v_row.id;
  perform public._add_audit('Serie humanización',v_row.id::text,'Decisión humana',v_row.status,p_status);
  return jsonb_build_object('ok',true,'series_id',v_row.id,'status',p_status,'external_execution',false);
end $$;

create or replace function public._proponer_episodio_humanizacion_v1(p jsonb,p_actor text,p_agent text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_proposal text:=btrim(coalesce(p->>'proposal_key','')); v_key text:=btrim(coalesce(p->>'episode_key',''));
  v_series_id bigint:=nullif(p->>'series_id','')::bigint; v_title text:=btrim(coalesce(p->>'title',''));
  v_story text:=p->>'story_kind'; v_rep text:=p->>'representation'; v_pack bigint:=nullif(p->>'production_pack_id','')::bigint;
  v_formula bigint:=nullif(p->>'source_formula_id','')::bigint; v_brief bigint:=nullif(p->>'source_brief_id','')::bigint;
  v_creative text:=nullif(btrim(coalesce(p->>'source_creative_id','')),''); v_contract jsonb:=coalesce(p->'episode_contract','{}');
  v_series public.agency_humanization_series%rowtype; v_existing public.agency_humanization_episodes%rowtype; v_fp text; v_id bigint;
begin
  if p is null or jsonb_typeof(p)<>'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in(
       'proposal_key','episode_key','series_id','title','story_kind','representation','production_pack_id',
       'source_formula_id','source_brief_id','source_creative_id','episode_contract'))
     or v_proposal!~'^[A-Za-z0-9_.:-]{8,120}$' or v_key!~'^[A-Za-z0-9_.:-]{3,120}$'
     or not public._agency_humanization_safe_text(v_title,3,180)
     or v_story not in ('Detrás de escena','Ritual de producto','Historia autorizada','UGC autorizado',
       'Pregunta de comunidad','Personaje y mundo','Momento de equipo')
     or v_rep not in ('Persona real','Personaje ficticio','Recreación / actor','Contenido sintético','Producto real','Comunidad agregada')
     or not public._agency_humanization_episode_contract_valid(v_contract,v_rep) then
    raise exception 'El episodio no cumple el contrato cerrado o contiene PII/secretos.';
  end if;
  select * into v_series from public.agency_humanization_series where id=v_series_id and status='Aprobada';
  if v_series.id is null then raise exception 'El episodio necesita una serie aprobada.'; end if;
  if v_series.protagonist='Equipo' and v_rep not in ('Persona real','Recreación / actor') then raise exception 'Una serie de equipo necesita persona real o actor declarado.'; end if;
  if v_series.protagonist='Personajes MOMOS' and v_rep not in ('Personaje ficticio','Contenido sintético') then raise exception 'Una serie de personajes debe declarar ficción o síntesis.'; end if;
  if v_series.protagonist='Producto real' and v_rep<>'Producto real' then raise exception 'Una serie de producto debe mostrar producto real.'; end if;
  if v_series.protagonist='Comunidad' and v_rep not in ('Comunidad agregada','Persona real','Recreación / actor') then raise exception 'La representación no corresponde a Comunidad.'; end if;
  if v_formula is not null and not exists(select 1 from public.agency_creative_formulas where id=v_formula and status='Aprobada') then raise exception 'La fórmula del episodio no está aprobada.'; end if;
  if v_brief is not null and not exists(select 1 from public.agency_briefs where id=v_brief) then raise exception 'El brief no existe.'; end if;
  if v_creative is not null and not exists(select 1 from public.creatives where id=v_creative) then raise exception 'El creativo no existe.'; end if;
  if v_pack is not null and not exists(select 1 from public.brand_production_packs where id=v_pack) then raise exception 'El paquete no existe.'; end if;
  v_fp:=public._agency_humanization_fingerprint(jsonb_build_object('episode_key',v_key,'series_id',v_series_id,
    'title',v_title,'story_kind',v_story,'representation',v_rep,'production_pack_id',v_pack,
    'source_formula_id',v_formula,'source_brief_id',v_brief,'source_creative_id',v_creative,'episode_contract',v_contract));
  select * into v_existing from public.agency_humanization_episodes where proposal_key=v_proposal;
  if v_existing.id is not null then
    if v_existing.episode_fingerprint<>v_fp then raise exception 'La clave idempotente pertenece a otro episodio.'; end if;
    return jsonb_build_object('ok',true,'episode_id',v_existing.id,'status',v_existing.status,
      'duplicate',true,'human_approval_required',true,'external_execution',false);
  end if;
  insert into public.agency_humanization_episodes(proposal_key,episode_key,series_id,title,story_kind,representation,
    production_pack_id,source_formula_id,source_brief_id,source_creative_id,episode_contract,episode_fingerprint,
    source_kind,prepared_by,prepared_by_agent)
  values(v_proposal,v_key,v_series_id,v_title,v_story,v_rep,v_pack,v_formula,v_brief,v_creative,v_contract,v_fp,
    case when p_actor is null then 'Agente' else 'Humano' end,p_actor,coalesce(p_agent,'')) returning id into v_id;
  return jsonb_build_object('ok',true,'episode_id',v_id,'status','Propuesta','duplicate',false,
    'human_approval_required',true,'external_execution',false);
end $$;

create or replace function public.proponer_episodio_humanizacion_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; begin v_actor:=public._agency_actor();
  return public._proponer_episodio_humanizacion_v1(p,v_actor.id,null); end $$;
create or replace function public.proponer_episodio_humanizacion_agente_v1(p jsonb)
returns jsonb language sql security definer set search_path=public as $$
  select public._proponer_episodio_humanizacion_v1(p,null,'Codex · MOMOS Agency MCP') $$;

create or replace function public.revisar_episodio_humanizacion_v1(p_episode_id bigint,p_status text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_row public.agency_humanization_episodes%rowtype; v_series public.agency_humanization_series%rowtype;
  v_note text:=btrim(coalesce(p_note,'')); v_ok boolean; v_pack jsonb;
begin
  v_actor:=public._agency_actor(); select * into v_row from public.agency_humanization_episodes where id=p_episode_id for update;
  if v_row.id is null then raise exception 'El episodio no existe.'; end if;
  select * into v_series from public.agency_humanization_series where id=v_row.series_id;
  v_ok:=(v_row.status='Propuesta' and p_status in ('En revisión','Descartado'))
    or (v_row.status='En revisión' and p_status in ('Aprobado','Descartado'))
    or (v_row.status='Aprobado' and p_status='Archivado');
  if not v_ok or not public._agency_humanization_safe_text(v_note,10,600) then raise exception 'La revisión del episodio es inválida.'; end if;
  if p_status='Aprobado' then
    if v_series.status<>'Aprobada' then raise exception 'La serie ya no está aprobada.'; end if;
    v_pack:=public._agency_humanization_pack_ready(v_row.production_pack_id,v_row.representation,v_row.story_kind,v_series.channel);
    if coalesce((v_pack->>'ready')::boolean,false) is not true then raise exception 'Derechos o consentimiento insuficientes: %',v_pack->'reasons'; end if;
  end if;
  update public.agency_humanization_episodes set status=p_status,
    reviewed_by=case when p_status='En revisión' then null else v_actor.id end,
    reviewed_at=case when p_status='En revisión' then null else clock_timestamp() end,
    review_note=case when p_status='En revisión' then '' else v_note end where id=v_row.id;
  perform public._add_audit('Episodio humanización',v_row.id::text,'Decisión humana',v_row.status,p_status);
  return jsonb_build_object('ok',true,'episode_id',v_row.id,'status',p_status,'pack_readiness',coalesce(v_pack,'{}'),
    'external_execution',false);
end $$;

create or replace function public.vincular_episodio_humanizacion_publicacion_v1(
  p_episode_id bigint,p_post_id text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_episode public.agency_humanization_episodes%rowtype;
  v_series public.agency_humanization_series%rowtype; v_post public.content_posts%rowtype; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor();
  select * into v_episode from public.agency_humanization_episodes where id=p_episode_id;
  select * into v_series from public.agency_humanization_series where id=v_episode.series_id;
  select * into v_post from public.content_posts where id=p_post_id;
  if v_episode.id is null or v_episode.status<>'Aprobado' then raise exception 'El episodio no está aprobado.'; end if;
  if v_post.id is null or v_post.estado<>'Publicado' then raise exception 'La publicación no existe o no está publicada.'; end if;
  if not public._agency_humanization_safe_text(v_note,10,400) then raise exception 'La nota de vínculo es inválida.'; end if;
  if (v_series.channel in ('Instagram','Facebook') and v_post.canal not in ('Instagram','Facebook'))
     or (v_series.channel not in ('Instagram','Facebook') and v_post.canal<>v_series.channel) then
    raise exception 'La publicación no pertenece al canal de la serie.';
  end if;
  if v_episode.source_creative_id is not null and v_post.creative_id is distinct from v_episode.source_creative_id then
    raise exception 'La publicación no pertenece al creativo del episodio.';
  end if;
  insert into public.agency_humanization_episode_publications(episode_id,post_id,linked_by,link_note)
  values(v_episode.id,v_post.id,v_actor.id,v_note);
  return jsonb_build_object('ok',true,'episode_id',v_episode.id,'post_id',v_post.id,'external_execution',false);
end $$;

create or replace function public._registrar_senal_comunidad_v1(p jsonb,p_actor text,p_connector text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'signal_key','')); v_episode_id bigint:=nullif(p->>'episode_id','')::bigint;
  v_platform text:=p->>'platform'; v_start date:=nullif(p->>'window_start','')::date; v_end date:=nullif(p->>'window_end','')::date;
  v_counts jsonb:=coalesce(p->'counts','{}'); v_themes jsonb:=coalesce(p->'themes','[]');
  v_episode public.agency_humanization_episodes%rowtype; v_link public.agency_humanization_episode_publications%rowtype;
  v_post public.content_posts%rowtype; v_imp bigint:=0; v_reach bigint:=0; v_fp text; v_id bigint;
  v_existing public.agency_community_signal_rollups%rowtype;
begin
  if p is null or jsonb_typeof(p)<>'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in(
       'signal_key','episode_id','platform','window_start','window_end','counts','themes'))
     or v_key!~'^[A-Za-z0-9_.:-]{8,140}$' or v_platform not in ('Meta','TikTok')
     or v_start is null or v_end is null or v_start>v_end or v_end-v_start>30
     or jsonb_typeof(v_counts)<>'object'
     or (select array_agg(key order by key) from jsonb_object_keys(v_counts) x(key)) is distinct from array[
       'authorized_ugc','character_associations','comments_total','meaningful_comments',
       'mentions','questions','recurring_conversations','saves','shares']::text[]
     or not public._agency_humanization_themes_valid(v_themes) then
    raise exception 'La señal no cumple el contrato agregado cerrado.';
  end if;
  begin
    if (v_counts->>'comments_total')::integer<0 or (v_counts->>'meaningful_comments')::integer<0
       or (v_counts->>'meaningful_comments')::integer>(v_counts->>'comments_total')::integer
       or (v_counts->>'questions')::integer<0 or (v_counts->>'questions')::integer>(v_counts->>'comments_total')::integer
       or (v_counts->>'shares')::integer<0 or (v_counts->>'saves')::integer<0 or (v_counts->>'mentions')::integer<0
       or (v_counts->>'authorized_ugc')::integer<0 or (v_counts->>'recurring_conversations')::integer<0
       or (v_counts->>'character_associations')::integer<0 then raise exception 'Conteos inválidos.'; end if;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Los conteos deben ser enteros.'; end;
  select * into v_episode from public.agency_humanization_episodes where id=v_episode_id and status='Aprobado';
  select * into v_link from public.agency_humanization_episode_publications where episode_id=v_episode_id;
  select * into v_post from public.content_posts where id=v_link.post_id;
  if v_episode.id is null or v_link.episode_id is null or v_post.id is null then raise exception 'La señal necesita episodio y publicación aprobados.'; end if;
  if (v_platform='TikTok' and v_post.canal<>'TikTok') or (v_platform='Meta' and v_post.canal not in ('Instagram','Facebook')) then
    raise exception 'La plataforma no corresponde a la publicación.';
  end if;
  select coalesce(sum(impresiones),0),coalesce(sum(alcance),0) into v_imp,v_reach
  from public.metrics_daily where post_id=v_post.id and fecha between v_start and v_end
    and ((v_platform='TikTok' and fuente='mcp-tiktok') or (v_platform='Meta' and fuente='mcp-meta'));
  v_fp:=public._agency_humanization_fingerprint(jsonb_build_object('episode_id',v_episode_id,'platform',v_platform,
    'window_start',v_start,'window_end',v_end,'impressions',v_imp,'reach',v_reach,'counts',v_counts,'themes',v_themes));
  select * into v_existing from public.agency_community_signal_rollups where signal_key=v_key;
  if v_existing.id is not null then
    if v_existing.evidence_fingerprint<>v_fp then raise exception 'La clave idempotente pertenece a otra señal.'; end if;
    return jsonb_build_object('ok',true,'signal_id',v_existing.id,'duplicate',true,'outcome',v_existing.outcome,'external_execution',false);
  end if;
  insert into public.agency_community_signal_rollups(signal_key,episode_id,platform,window_start,window_end,impressions,reach,
    comments_total,meaningful_comments,questions,shares,saves,mentions,authorized_ugc,recurring_conversations,
    character_associations,themes,evidence_fingerprint,source_kind,recorded_by,recorded_by_connector)
  values(v_key,v_episode_id,v_platform,v_start,v_end,v_imp,v_reach,(v_counts->>'comments_total')::integer,
    (v_counts->>'meaningful_comments')::integer,(v_counts->>'questions')::integer,(v_counts->>'shares')::integer,
    (v_counts->>'saves')::integer,(v_counts->>'mentions')::integer,(v_counts->>'authorized_ugc')::integer,
    (v_counts->>'recurring_conversations')::integer,(v_counts->>'character_associations')::integer,v_themes,v_fp,
    case when p_actor is null then 'Conector' else 'Humano' end,p_actor,coalesce(p_connector,'')) returning id into v_id;
  return jsonb_build_object('ok',true,'signal_id',v_id,'duplicate',false,'outcome','En revisión',
    'impressions',v_imp,'reach',v_reach,'human_approval_required',true,'external_execution',false);
end $$;

create or replace function public.registrar_senal_comunidad_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; begin v_actor:=public._agency_actor();
  return public._registrar_senal_comunidad_v1(p,v_actor.id,null); end $$;
create or replace function public.registrar_senal_comunidad_conector_v1(p jsonb)
returns jsonb language sql security definer set search_path=public as $$
  select public._registrar_senal_comunidad_v1(p,null,'Meta/TikTok · MOMOS connector') $$;

create or replace function public.resolver_senal_comunidad_v1(p_signal_id bigint,p_outcome text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_signal public.agency_community_signal_rollups%rowtype;
  v_episode public.agency_humanization_episodes%rowtype; v_note text:=btrim(coalesce(p_note,'')); v_episode_count integer;
begin
  v_actor:=public._agency_actor(); select * into v_signal from public.agency_community_signal_rollups where id=p_signal_id for update;
  if v_signal.id is null or v_signal.outcome<>'En revisión' then raise exception 'La señal no existe o ya fue resuelta.'; end if;
  if p_outcome not in ('Conexión ganadora','Prometedora','Inconclusa','Agotada','Descartada')
     or not public._agency_humanization_safe_text(v_note,20,600) then raise exception 'La decisión comunitaria es inválida.'; end if;
  select * into v_episode from public.agency_humanization_episodes where id=v_signal.episode_id;
  select count(*) into v_episode_count from public.agency_humanization_episodes e
    join public.agency_humanization_episode_publications ep on ep.episode_id=e.id
    where e.series_id=v_episode.series_id and e.status='Aprobado';
  if p_outcome='Conexión ganadora' and (v_signal.reach<100 or v_signal.connection_signals<3 or v_episode_count<2) then
    raise exception 'Una conexión ganadora exige alcance 100+, señales significativas 3+ y dos episodios aprobados publicados.';
  end if;
  update public.agency_community_signal_rollups set outcome=p_outcome,decided_by=v_actor.id,
    decided_at=clock_timestamp(),decision_note=v_note where id=v_signal.id;
  perform public._add_audit('Señal comunidad',v_signal.id::text,'Decisión humana','En revisión',p_outcome);
  return jsonb_build_object('ok',true,'signal_id',v_signal.id,'episode_id',v_episode.id,
    'outcome',p_outcome,'external_execution',false);
end $$;

create or replace function public.humanizacion_comunidad_disponible()
returns boolean language plpgsql stable security definer set search_path=public as $$
begin if coalesce(auth.role(),'')<>'service_role' then perform public._agency_actor(); end if; return true; end $$;

create or replace function public.momos_humanization_community_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_snapshot jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then perform public._agency_actor(); end if;
  select jsonb_build_object(
    'schema_version','momos-humanization-community/v1','generated_at',clock_timestamp(),
    'series',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc,x.id desc) from (
      select s.id,s.series_key,s.version,s.name,s.purpose,s.protagonist,s.emotional_territory,
        s.mode,s.channel,s.status,s.source_formula_id,s.editorial_contract,s.series_fingerprint,
        s.source_kind,s.prepared_at,s.reviewed_at
      from public.agency_humanization_series s order by s.prepared_at desc,s.id desc limit 100) x),'[]'::jsonb),
    'episodes',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc,x.id desc) from (
      select e.id,e.episode_key,e.series_id,e.title,e.story_kind,e.representation,e.status,
        e.production_pack_id,e.source_formula_id,e.source_brief_id,e.source_creative_id,
        e.episode_contract,e.episode_fingerprint,e.source_kind,e.prepared_at,e.reviewed_at,
        ep.post_id,ep.linked_at,
        public._agency_humanization_pack_ready(e.production_pack_id,e.representation,e.story_kind,s.channel) pack_readiness
      from public.agency_humanization_episodes e join public.agency_humanization_series s on s.id=e.series_id
      left join public.agency_humanization_episode_publications ep on ep.episode_id=e.id
      order by e.prepared_at desc,e.id desc limit 200) x),'[]'::jsonb),
    'signals',coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at desc,x.id desc) from (
      select r.id,r.signal_key,r.episode_id,r.platform,r.window_start,r.window_end,r.impressions,r.reach,
        r.comments_total,r.meaningful_comments,r.questions,r.shares,r.saves,r.mentions,r.authorized_ugc,
        r.recurring_conversations,r.character_associations,r.connection_signals,r.themes,
        r.evidence_fingerprint,r.source_kind,r.recorded_at,r.outcome,r.decided_at
      from public.agency_community_signal_rollups r order by r.recorded_at desc,r.id desc limit 300) x),'[]'::jsonb),
    'summary',jsonb_build_object(
      'series',(select count(*) from public.agency_humanization_series),
      'approved_series',(select count(*) from public.agency_humanization_series where status='Aprobada'),
      'pending_series',(select count(*) from public.agency_humanization_series where status in ('Propuesta','En revisión')),
      'episodes',(select count(*) from public.agency_humanization_episodes),
      'approved_episodes',(select count(*) from public.agency_humanization_episodes where status='Aprobado'),
      'published_episodes',(select count(*) from public.agency_humanization_episode_publications),
      'signal_windows',(select count(*) from public.agency_community_signal_rollups),
      'winning_connections',(select count(*) from public.agency_community_signal_rollups where outcome='Conexión ganadora')),
    'metric_definitions',jsonb_build_object(
      'reach','suma del alcance diario reportado por el conector para la publicación exacta',
      'connection_signals','comentarios significativos + compartidos + guardados + menciones + UGC autorizado + conversación recurrente + asociación con personaje',
      'views_alone_can_win',false,'attribution_is_causality',false),
    'privacy',jsonb_build_object('contains_customer_pii',false,'contains_staff_identity',false,
      'contains_raw_comments',false,'contains_handles',false,'contains_direct_messages',false,
      'contains_secrets',false,'contains_order_ids',false),
    'capabilities',jsonb_build_object('can_propose',true,'can_read_aggregates',true,
      'can_approve',false,'can_reply',false,'can_contact',false,'can_publish',false,
      'can_reuse_ugc',false,'can_change_budget',false),
    'human_approval_required',true,'external_execution_allowed',false
  ) into v_snapshot;
  return jsonb_build_object('snapshot',v_snapshot,'fingerprint',public._agency_humanization_fingerprint(v_snapshot));
end $$;

do $$ declare v_signature text;
begin
  foreach v_signature in array array[
    '_agency_humanization_fingerprint(jsonb)','_agency_humanization_safe_text(text,integer,integer)',
    '_agency_humanization_editorial_contract_valid(jsonb)','_agency_humanization_episode_contract_valid(jsonb,text)',
    '_agency_humanization_themes_valid(jsonb)','_agency_humanization_pack_ready(bigint,text,text,text)',
    '_agency_humanization_series_guard()','_agency_humanization_episode_guard()',
    '_agency_humanization_fact_immutable()','_agency_community_signal_guard()',
    '_proponer_serie_humanizacion_v1(jsonb,text,text)','_proponer_episodio_humanizacion_v1(jsonb,text,text)',
    '_registrar_senal_comunidad_v1(jsonb,text,text)'
  ] loop execute format('revoke all on function public.%s from public,anon,authenticated,service_role',v_signature); end loop;
end $$;

revoke all on function public.proponer_serie_humanizacion_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.proponer_serie_humanizacion_agente_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.revisar_serie_humanizacion_v1(bigint,text,text) from public,anon,authenticated,service_role;
revoke all on function public.proponer_episodio_humanizacion_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.proponer_episodio_humanizacion_agente_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.revisar_episodio_humanizacion_v1(bigint,text,text) from public,anon,authenticated,service_role;
revoke all on function public.vincular_episodio_humanizacion_publicacion_v1(bigint,text,text) from public,anon,authenticated,service_role;
revoke all on function public.registrar_senal_comunidad_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.registrar_senal_comunidad_conector_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.resolver_senal_comunidad_v1(bigint,text,text) from public,anon,authenticated,service_role;
revoke all on function public.humanizacion_comunidad_disponible() from public,anon,authenticated,service_role;
revoke all on function public.momos_humanization_community_v1() from public,anon,authenticated,service_role;

grant execute on function public.proponer_serie_humanizacion_v1(jsonb),
  public.revisar_serie_humanizacion_v1(bigint,text,text),
  public.proponer_episodio_humanizacion_v1(jsonb),
  public.revisar_episodio_humanizacion_v1(bigint,text,text),
  public.vincular_episodio_humanizacion_publicacion_v1(bigint,text,text),
  public.registrar_senal_comunidad_v1(jsonb),
  public.resolver_senal_comunidad_v1(bigint,text,text),
  public.humanizacion_comunidad_disponible(),
  public.momos_humanization_community_v1() to authenticated;
grant execute on function public.proponer_serie_humanizacion_agente_v1(jsonb),
  public.proponer_episodio_humanizacion_agente_v1(jsonb),
  public.registrar_senal_comunidad_conector_v1(jsonb),
  public.humanizacion_comunidad_disponible(),
  public.momos_humanization_community_v1() to service_role;

comment on table public.agency_humanization_series is
  'Series editoriales versionadas; reutilizan identidad y fórmulas sin duplicarlas.';
comment on table public.agency_humanization_episodes is
  'Episodios trazables con representación explícita y consentimiento derivado de Biblioteca.';
comment on table public.agency_community_signal_rollups is
  'Señales agregadas sin comentarios, perfiles, mensajes o PII crudos.';
comment on function public.momos_humanization_community_v1() is
  'Memoria comunitaria segura para Codex; propone y consulta, nunca responde ni publica.';

insert into public.momos_ops_migrations(id,detalle)
values('20260722_105_humanizacion_comunidad',
  'Series, episodios, consentimiento reutilizado, señales Meta/TikTok agregadas y decisión humana sin PII')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260722_105_humanizacion_comunidad';
