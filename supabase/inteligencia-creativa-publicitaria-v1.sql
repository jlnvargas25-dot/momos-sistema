-- MOMOS OPS · H103 · inteligencia creativa publicitaria.
--
-- Une fórmulas creativas, versiones, medición pagada Meta/TikTok y verdad
-- comercial de MOMO OPS. No publica, no pauta, no cambia presupuestos y no
-- acepta que un conector declare ganadores.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_102_piloto_comercial_controlado') then
    raise exception 'H103 requiere H102 y la cadena operativa 01-102.';
  end if;
  if to_regclass('public.agency_creative_versions') is null
     or to_regclass('public.agency_retention_scripts') is null
     or to_regclass('public.agency_meta_signal_snapshots') is null
     or to_regclass('public.metrics_daily') is null
     or to_regclass('public.v_order_totals') is null
     or to_regprocedure('public._agency_actor()') is null
     or to_regprocedure('public._agency_mesa_has_secret(jsonb)') is null
     or to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'H103 requiere Agencia, retención, Observatorio Meta, finanzas y SHA-256 canónicos.';
  end if;
end $$;

create table if not exists public.agency_creative_formulas(
  id bigint generated always as identity primary key,
  proposal_key text not null unique
    check(proposal_key ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  formula_key text not null
    check(formula_key ~ '^[A-Za-z0-9_.:-]{3,100}$'),
  version integer not null check(version>0),
  name text not null check(length(btrim(name)) between 3 and 160),
  mode text not null check(mode in ('Pauta','Orgánico','Híbrido')),
  status text not null default 'Propuesta'
    check(status in ('Propuesta','En revisión','Aprobada','Sustituida','Descartada')),
  source_creative_id text not null references public.creatives(id) on delete restrict,
  source_creative_version_id bigint references public.agency_creative_versions(id) on delete restrict,
  retention_script_id bigint references public.agency_retention_scripts(id) on delete restrict,
  campaign_id text references public.campaigns(id) on delete restrict,
  product_id text references public.products(id) on delete restrict,
  channel text not null,
  objective text not null default '',
  figure text not null default '',
  flavor text not null default '',
  formula_snapshot jsonb not null check(jsonb_typeof(formula_snapshot)='object'),
  formula_fingerprint text not null check(formula_fingerprint ~ '^[0-9a-f]{64}$'),
  source_kind text not null check(source_kind in ('Humano','Agente')),
  prepared_by text references public.users(id),
  prepared_by_agent text not null default '',
  prepared_at timestamptz not null default clock_timestamp(),
  reviewed_by text references public.users(id),
  reviewed_at timestamptz,
  review_note text not null default '',
  unique(formula_key,version),
  unique(source_creative_version_id),
  check((source_kind='Humano' and prepared_by is not null and prepared_by_agent='')
    or (source_kind='Agente' and prepared_by is null
      and length(btrim(prepared_by_agent)) between 3 and 100)),
  check((status in ('Propuesta','En revisión') and reviewed_at is null)
    or (status in ('Aprobada','Sustituida','Descartada') and reviewed_at is not null))
);
create index if not exists agency_creative_formulas_status_idx
  on public.agency_creative_formulas(status,prepared_at desc,id desc);
create index if not exists agency_creative_formulas_source_idx
  on public.agency_creative_formulas(source_creative_id,version desc);
create unique index if not exists agency_creative_formulas_one_approved_idx
  on public.agency_creative_formulas(formula_key) where status='Aprobada';

create table if not exists public.agency_creative_formula_measurements(
  id bigint generated always as identity primary key,
  measurement_key text not null unique
    check(measurement_key ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  formula_id bigint not null references public.agency_creative_formulas(id) on delete restrict,
  platform text not null check(platform in ('Meta','TikTok','Mixto')),
  window_start date not null,
  window_end date not null,
  impressions bigint not null check(impressions>=0),
  reach bigint not null check(reach>=0),
  clicks bigint not null check(clicks>=0),
  messages bigint not null check(messages>=0),
  spend numeric(16,2) not null check(spend>=0),
  platform_attributed_revenue numeric(16,2)
    check(platform_attributed_revenue is null or platform_attributed_revenue>=0),
  internal_paid_orders integer not null check(internal_paid_orders>=0),
  internal_revenue numeric(16,2) not null check(internal_revenue>=0),
  internal_margin numeric(16,2) not null,
  internal_roas numeric(18,6),
  contribution_return numeric(18,6),
  platform_roas numeric(18,6),
  attribution_gap numeric(16,2),
  unattributed_campaign_orders integer not null default 0
    check(unattributed_campaign_orders>=0),
  attribution_status text not null
    check(attribution_status in ('Exacta','Parcial','Sin señal de plataforma')),
  evidence_fingerprint text not null check(evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  outcome text not null default 'En revisión'
    check(outcome in ('En revisión','Ganadora','Prometedora','Inconclusa','Agotada','Descartada')),
  source_kind text not null check(source_kind in ('Humano','Conector')),
  recorded_by text references public.users(id),
  recorded_by_connector text not null default '',
  recorded_at timestamptz not null default clock_timestamp(),
  decided_by text references public.users(id),
  decided_at timestamptz,
  decision_note text not null default '',
  unique(formula_id,platform,window_start,window_end,evidence_fingerprint),
  check(window_start<=window_end and window_end-window_start<=30),
  check((spend=0 and internal_roas is null and contribution_return is null
      and platform_roas is null)
    or (spend>0 and internal_roas is not null and contribution_return is not null)),
  check((platform_attributed_revenue is null and platform_roas is null
      and attribution_gap is null)
    or (platform_attributed_revenue is not null and attribution_gap is not null
      and ((spend=0 and platform_roas is null)
        or (spend>0 and platform_roas is not null)))),
  check((source_kind='Humano' and recorded_by is not null and recorded_by_connector='')
    or (source_kind='Conector' and recorded_by is null
      and length(btrim(recorded_by_connector)) between 3 and 100)),
  check((outcome='En revisión' and decided_at is null and decided_by is null)
    or (outcome<>'En revisión' and decided_at is not null and decided_by is not null
      and length(btrim(decision_note)) between 20 and 600))
);
create index if not exists agency_creative_formula_measurements_recent_idx
  on public.agency_creative_formula_measurements(recorded_at desc,id desc);
create index if not exists agency_creative_formula_measurements_formula_idx
  on public.agency_creative_formula_measurements(formula_id,window_end desc,id desc);

alter table public.agency_creative_formulas enable row level security;
alter table public.agency_creative_formula_measurements enable row level security;
revoke all on public.agency_creative_formulas,
  public.agency_creative_formula_measurements from public,anon,authenticated,service_role;
revoke all on sequence public.agency_creative_formulas_id_seq,
  public.agency_creative_formula_measurements_id_seq from public,anon,authenticated,service_role;

create or replace function public._agency_creative_intelligence_fingerprint(p jsonb)
returns text language sql immutable security definer set search_path=public as $$
  select encode(pg_catalog.sha256(convert_to(p::text,'UTF8')),'hex')
$$;

create or replace function public._agency_creative_formula_snapshot_valid(p jsonb)
returns boolean language plpgsql immutable security definer set search_path=public as $$
declare
  v_key text;
  v_value text;
  v_allowed constant text[]:=array[
    'hook','narrative_structure','humanization','proof',
    'offer','cta','visual_style','camera_pattern'
  ];
begin
  if p is null or jsonb_typeof(p)<>'object'
     or (select count(*) from jsonb_object_keys(p))<>cardinality(v_allowed)
     or exists(select 1 from jsonb_object_keys(p) x(key)
       where not(key=any(v_allowed))) then return false; end if;
  foreach v_key in array v_allowed loop
    if jsonb_typeof(p->v_key)<>'string' then return false; end if;
    v_value:=p->>v_key;
    if length(btrim(v_value)) not between 2 and 700
       or v_value ~ '[\u0000-\u001f\u007f]'
       or v_value ~* '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|sb_secret_|access[_ -]?token|service[_ -]?role|api[_ -]?key|authorization)'
       or regexp_replace(v_value,'[^0-9]','','g') ~ '[0-9]{10,}' then
      return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create or replace function public._agency_creative_formula_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    raise exception 'Las fórmulas creativas no se eliminan; se sustituyen o descartan.';
  end if;
  if new.proposal_key is distinct from old.proposal_key
     or new.formula_key is distinct from old.formula_key
     or new.version is distinct from old.version
     or new.name is distinct from old.name
     or new.mode is distinct from old.mode
     or new.source_creative_id is distinct from old.source_creative_id
     or new.source_creative_version_id is distinct from old.source_creative_version_id
     or new.retention_script_id is distinct from old.retention_script_id
     or new.campaign_id is distinct from old.campaign_id
     or new.product_id is distinct from old.product_id
     or new.channel is distinct from old.channel
     or new.objective is distinct from old.objective
     or new.figure is distinct from old.figure
     or new.flavor is distinct from old.flavor
     or new.formula_snapshot is distinct from old.formula_snapshot
     or new.formula_fingerprint is distinct from old.formula_fingerprint
     or new.source_kind is distinct from old.source_kind
     or new.prepared_by is distinct from old.prepared_by
     or new.prepared_by_agent is distinct from old.prepared_by_agent
     or new.prepared_at is distinct from old.prepared_at then
    raise exception 'La fórmula creativa es inmutable; proponé una versión nueva.';
  end if;
  if old.status='Aprobada' and new.status='Sustituida'
     and new.reviewed_by is not distinct from old.reviewed_by
     and new.reviewed_at is not distinct from old.reviewed_at
     and new.review_note is not distinct from old.review_note then
    return new;
  end if;
  if old.status in ('Aprobada','Sustituida','Descartada')
     and (new.status is distinct from old.status
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.review_note is distinct from old.review_note) then
    raise exception 'La revisión terminal de la fórmula está sellada.';
  end if;
  return new;
end $$;
drop trigger if exists agency_creative_formula_guard on public.agency_creative_formulas;
create trigger agency_creative_formula_guard before update or delete
  on public.agency_creative_formulas for each row
  execute function public._agency_creative_formula_guard();

create or replace function public._agency_creative_formula_measurement_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    raise exception 'Las mediciones creativas son evidencia inmutable.';
  end if;
  if new.measurement_key is distinct from old.measurement_key
     or new.formula_id is distinct from old.formula_id
     or new.platform is distinct from old.platform
     or new.window_start is distinct from old.window_start
     or new.window_end is distinct from old.window_end
     or new.impressions is distinct from old.impressions
     or new.reach is distinct from old.reach
     or new.clicks is distinct from old.clicks
     or new.messages is distinct from old.messages
     or new.spend is distinct from old.spend
     or new.platform_attributed_revenue is distinct from old.platform_attributed_revenue
     or new.internal_paid_orders is distinct from old.internal_paid_orders
     or new.internal_revenue is distinct from old.internal_revenue
     or new.internal_margin is distinct from old.internal_margin
     or new.internal_roas is distinct from old.internal_roas
     or new.contribution_return is distinct from old.contribution_return
     or new.platform_roas is distinct from old.platform_roas
     or new.attribution_gap is distinct from old.attribution_gap
     or new.unattributed_campaign_orders is distinct from old.unattributed_campaign_orders
     or new.attribution_status is distinct from old.attribution_status
     or new.evidence_fingerprint is distinct from old.evidence_fingerprint
     or new.source_kind is distinct from old.source_kind
     or new.recorded_by is distinct from old.recorded_by
     or new.recorded_by_connector is distinct from old.recorded_by_connector
     or new.recorded_at is distinct from old.recorded_at then
    raise exception 'Los hechos de la medición son inmutables.';
  end if;
  if old.outcome<>'En revisión' and row(new.outcome,new.decided_by,new.decided_at,new.decision_note)
    is distinct from row(old.outcome,old.decided_by,old.decided_at,old.decision_note) then
    raise exception 'La decisión creativa terminal está sellada.';
  end if;
  return new;
end $$;
drop trigger if exists agency_creative_formula_measurement_guard
  on public.agency_creative_formula_measurements;
create trigger agency_creative_formula_measurement_guard before update or delete
  on public.agency_creative_formula_measurements for each row
  execute function public._agency_creative_formula_measurement_guard();

-- H66 ya publica un único cursor Realtime sanitario. Las dos fuentes nuevas
-- tocan ese cursor por sentencia; nunca exponen filas, fórmulas o métricas.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'agency_creative_formulas','agency_creative_formula_measurements'
  ] loop
    execute format('drop trigger if exists momos_agency_snapshot_event_v1 on public.%I',v_table);
    execute format(
      'create trigger momos_agency_snapshot_event_v1 '
      'after insert or update or delete or truncate on public.%I '
      'for each statement execute function public._momos_touch_agency_snapshot_event_v1()',
      v_table
    );
  end loop;
end $$;

create or replace function public._proponer_formula_creativa_v1(
  p jsonb,p_actor text,p_agent text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_proposal text:=btrim(coalesce(p->>'proposal_key',''));
  v_key text:=btrim(coalesce(p->>'formula_key',''));
  v_name text:=btrim(coalesce(p->>'name',''));
  v_mode text:=coalesce(p->>'mode','');
  v_creative_id text:=btrim(coalesce(p->>'source_creative_id',''));
  v_version_id bigint:=nullif(p->>'source_creative_version_id','')::bigint;
  v_script_id bigint:=nullif(p->>'retention_script_id','')::bigint;
  v_snapshot jsonb:=coalesce(p->'formula_snapshot','{}'::jsonb);
  v_creative public.creatives%rowtype;
  v_version integer;
  v_fp text;
  v_id bigint;
  v_existing public.agency_creative_formulas%rowtype;
  v_source text:=case when p_actor is null then 'Agente' else 'Humano' end;
begin
  if p is null or jsonb_typeof(p)<>'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in(
       'proposal_key','formula_key','name','mode','source_creative_id',
       'source_creative_version_id','retention_script_id','formula_snapshot'))
     or v_proposal !~ '^[A-Za-z0-9_.:-]{8,120}$'
     or v_key !~ '^[A-Za-z0-9_.:-]{3,100}$'
     or length(v_name) not between 3 and 160
     or v_mode not in ('Pauta','Orgánico','Híbrido')
     or not public._agency_creative_formula_snapshot_valid(v_snapshot)
     or public._agency_mesa_has_secret(p) then
    raise exception 'La propuesta de fórmula no cumple el contrato cerrado o contiene PII/secretos.';
  end if;
  select * into v_creative from public.creatives where id=v_creative_id;
  if v_creative.id is null then raise exception 'El creativo fuente no existe.'; end if;
  if v_version_id is not null and not exists(select 1
    from public.agency_creative_versions
    where id=v_version_id and creative_id=v_creative_id) then
    raise exception 'La versión creativa no pertenece al creativo fuente.';
  end if;
  if v_script_id is not null and not exists(select 1
    from public.agency_retention_scripts where id=v_script_id) then
    raise exception 'El guion de retención no existe.';
  end if;
  v_fp:=public._agency_creative_intelligence_fingerprint(jsonb_build_object(
    'formula_key',v_key,'name',v_name,'mode',v_mode,
    'source_creative_id',v_creative_id,'source_creative_version_id',v_version_id,
    'retention_script_id',v_script_id,'formula_snapshot',v_snapshot));
  select * into v_existing from public.agency_creative_formulas
    where proposal_key=v_proposal;
  if v_existing.id is not null then
    if v_existing.formula_fingerprint<>v_fp then
      raise exception 'La clave idempotente ya pertenece a otra fórmula.';
    end if;
    return jsonb_build_object('ok',true,'formula_id',v_existing.id,
      'version',v_existing.version,'status',v_existing.status,'duplicate',true,
      'human_approval_required',true,'external_execution',false);
  end if;
  perform pg_advisory_xact_lock(hashtext('agency_formula:'||v_key));
  select coalesce(max(version),0)+1 into v_version
    from public.agency_creative_formulas where formula_key=v_key;
  insert into public.agency_creative_formulas(
    proposal_key,formula_key,version,name,mode,source_creative_id,
    source_creative_version_id,retention_script_id,campaign_id,product_id,
    channel,objective,figure,flavor,formula_snapshot,formula_fingerprint,
    source_kind,prepared_by,prepared_by_agent)
  select v_proposal,v_key,v_version,v_name,v_mode,v_creative.id,
    v_version_id,v_script_id,v_creative.campaign_id,v_creative.producto_foco_id,
    v_creative.canal,coalesce(c.objetivo,''),coalesce(v_creative.figura,''),
    coalesce(v_creative.sabor,''),v_snapshot,v_fp,v_source,p_actor,coalesce(p_agent,'')
  from (select 1) x left join public.campaigns c on c.id=v_creative.campaign_id
  returning id into v_id;
  return jsonb_build_object('ok',true,'formula_id',v_id,'version',v_version,
    'status','Propuesta','duplicate',false,'human_approval_required',true,
    'external_execution',false);
end $$;

create or replace function public.proponer_formula_creativa_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  v_actor:=public._agency_actor();
  return public._proponer_formula_creativa_v1(p,v_actor.id,null);
end $$;

create or replace function public.proponer_formula_creativa_agente_v1(p jsonb)
returns jsonb language sql security definer set search_path=public as $$
  select public._proponer_formula_creativa_v1(p,null,'Codex · MOMOS Agency MCP')
$$;

create or replace function public.revisar_formula_creativa_v1(
  p_formula_id bigint,p_status text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype;
  v_formula public.agency_creative_formulas%rowtype;
  v_note text:=btrim(coalesce(p_note,''));
  v_valid boolean;
begin
  v_actor:=public._agency_actor();
  select * into v_formula from public.agency_creative_formulas
    where id=p_formula_id for update;
  if v_formula.id is null then raise exception 'La fórmula no existe.'; end if;
  v_valid:=(v_formula.status='Propuesta' and p_status in ('En revisión','Descartada'))
    or (v_formula.status='En revisión' and p_status in ('Aprobada','Descartada'));
  if not v_valid or length(v_note) not between 10 and 600 then
    raise exception 'La revisión de fórmula es inválida o no documenta el criterio.';
  end if;
  if p_status='Aprobada' then
    update public.agency_creative_formulas set status='Sustituida'
    where formula_key=v_formula.formula_key and status='Aprobada' and id<>v_formula.id;
  end if;
  update public.agency_creative_formulas set status=p_status,
    reviewed_by=case when p_status in ('Aprobada','Descartada') then v_actor.id end,
    reviewed_at=case when p_status in ('Aprobada','Descartada') then clock_timestamp() end,
    review_note=case when p_status in ('Aprobada','Descartada') then v_note else '' end
  where id=v_formula.id;
  perform public._add_audit('Fórmula creativa',v_formula.id::text,
    'Revisión humana de fórmula',v_formula.status,p_status);
  return jsonb_build_object('ok',true,'formula_id',v_formula.id,
    'status',p_status,'external_execution',false);
end $$;

create or replace function public._medir_formula_creativa_v1(
  p jsonb,p_actor text,p_connector text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'measurement_key',''));
  v_formula_id bigint:=nullif(p->>'formula_id','')::bigint;
  v_platform text:=coalesce(p->>'platform','');
  v_start date:=nullif(p->>'window_start','')::date;
  v_end date:=nullif(p->>'window_end','')::date;
  v_formula public.agency_creative_formulas%rowtype;
  v_impressions bigint:=0; v_reach bigint:=0; v_clicks bigint:=0; v_messages bigint:=0;
  v_spend numeric:=0; v_platform_revenue numeric; v_orders integer:=0;
  v_revenue numeric:=0; v_margin numeric:=0; v_internal_roas numeric;
  v_contribution_return numeric; v_platform_roas numeric; v_gap numeric;
  v_unattributed integer:=0; v_status text; v_evidence jsonb; v_fp text; v_id bigint;
  v_existing public.agency_creative_formula_measurements%rowtype;
  v_source text:=case when p_actor is null then 'Conector' else 'Humano' end;
begin
  if p is null or jsonb_typeof(p)<>'object'
     or exists(select 1 from jsonb_object_keys(p) x(key) where key not in(
       'measurement_key','formula_id','platform','window_start','window_end'))
     or v_key !~ '^[A-Za-z0-9_.:-]{8,120}$'
     or v_platform not in ('Meta','TikTok','Mixto')
     or v_start is null or v_end is null or v_start>v_end
     or v_end-v_start>30 or v_end>current_date
     or public._agency_mesa_has_secret(p) then
    raise exception 'La medición no cumple el contrato cerrado o perdió su ventana.';
  end if;
  select * into v_formula from public.agency_creative_formulas
    where id=v_formula_id;
  if v_formula.id is null or v_formula.status not in ('Aprobada','Sustituida') then
    raise exception 'Solo se mide una fórmula aprobada o sustituida.';
  end if;
  select coalesce(sum(md.impresiones),0),coalesce(sum(md.alcance),0),
    coalesce(sum(md.clicks),0),coalesce(sum(md.mensajes_wa),0),
    coalesce(sum(md.gasto),0)
  into v_impressions,v_reach,v_clicks,v_messages,v_spend
  from public.metrics_daily md
  where md.fecha between v_start and v_end
    and (md.creative_id=v_formula.source_creative_id or exists(
      select 1 from public.content_posts cp
      where cp.id=md.post_id and cp.creative_id=v_formula.source_creative_id))
    and (v_platform='Mixto'
      or (v_platform='Meta' and md.fuente='mcp-meta')
      or (v_platform='TikTok' and md.fuente='mcp-tiktok'));
  select count(distinct o.id),
    coalesce(sum(case when not oi.es_sub_momo then oi.cant*oi.precio else 0 end),0),
    coalesce(sum(case when not oi.es_sub_momo
      then oi.cant*(oi.precio-oi.costo_unitario) else 0 end),0)
  into v_orders,v_revenue,v_margin
  from public.orders o join public.order_items oi on oi.order_id=o.id
  where o.pagado_en>=(v_start::timestamp at time zone 'America/Bogota')
    and o.pagado_en<((v_end+1)::timestamp at time zone 'America/Bogota')
    and o.estado<>'Cancelado' and o.creative_id=v_formula.source_creative_id;
  if v_formula.campaign_id is not null then
    select count(*) into v_unattributed from public.orders o
    where o.pagado_en>=(v_start::timestamp at time zone 'America/Bogota')
      and o.pagado_en<((v_end+1)::timestamp at time zone 'America/Bogota') and o.estado<>'Cancelado'
      and o.campaign_id=v_formula.campaign_id and o.creative_id is null;
  end if;
  if v_platform in ('Meta','Mixto') then
    select nullif(s.metrics->>'purchaseValue','')::numeric
    into v_platform_revenue
    from public.agency_meta_signal_snapshots s
    where s.local_creative_id=v_formula.source_creative_id
      and s.window_start::date=v_start
      and (s.window_end-interval '1 microsecond')::date=v_end
    order by s.source_captured_at desc,s.id desc limit 1;
  end if;
  v_internal_roas:=case when v_spend>0 then round(v_revenue/v_spend,6) end;
  v_contribution_return:=case when v_spend>0 then round(v_margin/v_spend,6) end;
  v_platform_roas:=case when v_spend>0 and v_platform_revenue is not null
    then round(v_platform_revenue/v_spend,6) end;
  v_gap:=case when v_platform_revenue is not null
    then round(v_platform_revenue-v_revenue,2) end;
  v_status:=case
    when v_platform_revenue is null then 'Sin señal de plataforma'
    when v_platform='Mixto' then 'Parcial'
    else 'Exacta' end;
  v_evidence:=jsonb_build_object(
    'formula_id',v_formula.id,'source_creative_id',v_formula.source_creative_id,
    'platform',v_platform,'window_start',v_start,'window_end',v_end,
    'impressions',v_impressions,'reach',v_reach,'clicks',v_clicks,
    'messages',v_messages,'spend',v_spend,
    'platform_attributed_revenue',v_platform_revenue,
    'internal_paid_orders',v_orders,'internal_revenue',v_revenue,
    'internal_margin',v_margin,'internal_roas',v_internal_roas,
    'contribution_return',v_contribution_return,'platform_roas',v_platform_roas,
    'attribution_gap',v_gap,'unattributed_campaign_orders',v_unattributed,
    'attribution_status',v_status,
    'truth_sources',jsonb_build_array('metrics_daily','orders.pagado_en','order_items'));
  v_fp:=public._agency_creative_intelligence_fingerprint(v_evidence);
  select * into v_existing from public.agency_creative_formula_measurements
    where measurement_key=v_key;
  if v_existing.id is not null then
    if v_existing.evidence_fingerprint<>v_fp then
      raise exception 'La clave idempotente ya pertenece a otra medición.';
    end if;
    return jsonb_build_object('ok',true,'measurement_id',v_existing.id,
      'duplicate',true,'outcome',v_existing.outcome,'external_execution',false);
  end if;
  insert into public.agency_creative_formula_measurements(
    measurement_key,formula_id,platform,window_start,window_end,
    impressions,reach,clicks,messages,spend,platform_attributed_revenue,
    internal_paid_orders,internal_revenue,internal_margin,internal_roas,
    contribution_return,platform_roas,attribution_gap,
    unattributed_campaign_orders,attribution_status,evidence_fingerprint,
    source_kind,recorded_by,recorded_by_connector)
  values(v_key,v_formula.id,v_platform,v_start,v_end,v_impressions,v_reach,
    v_clicks,v_messages,v_spend,v_platform_revenue,v_orders,v_revenue,v_margin,
    v_internal_roas,v_contribution_return,v_platform_roas,v_gap,v_unattributed,
    v_status,v_fp,v_source,p_actor,coalesce(p_connector,''))
  returning id into v_id;
  return jsonb_build_object('ok',true,'measurement_id',v_id,'duplicate',false,
    'outcome','En revisión','metrics',v_evidence,'human_decision_required',true,
    'external_execution',false);
end $$;

create or replace function public.medir_formula_creativa_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  v_actor:=public._agency_actor();
  return public._medir_formula_creativa_v1(p,v_actor.id,null);
end $$;

create or replace function public.medir_formula_creativa_conector_v1(p jsonb)
returns jsonb language sql security definer set search_path=public as $$
  select public._medir_formula_creativa_v1(p,null,'MOMOS Metrics Connector')
$$;

create or replace function public.resolver_medicion_formula_creativa_v1(
  p_measurement_id bigint,p_outcome text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype;
  v_measure public.agency_creative_formula_measurements%rowtype;
  v_formula public.agency_creative_formulas%rowtype;
  v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor();
  select * into v_measure from public.agency_creative_formula_measurements
    where id=p_measurement_id for update;
  if v_measure.id is null or v_measure.outcome<>'En revisión'
     or p_outcome not in ('Ganadora','Prometedora','Inconclusa','Agotada','Descartada')
     or length(v_note) not between 20 and 600 then
    raise exception 'La decisión creativa es inválida o no documenta el criterio.';
  end if;
  select * into v_formula from public.agency_creative_formulas
    where id=v_measure.formula_id;
  if p_outcome='Ganadora' and v_formula.status<>'Aprobada' then
    raise exception 'Solo una fórmula vigente y aprobada puede declararse ganadora.';
  end if;
  if p_outcome='Ganadora' and v_formula.mode in ('Pauta','Híbrido')
     and not (v_measure.internal_paid_orders>=2 and v_measure.spend>0
       and v_measure.internal_roas>=2) then
    raise exception 'No hay dos pedidos pagados y ROAS interno mínimo de 2 para declarar ganadora.';
  end if;
  if p_outcome='Ganadora' and v_formula.mode='Orgánico'
     and (v_formula.retention_script_id is null or not exists(
       select 1 from public.agency_retention_experiments e
       where e.script_id=v_formula.retention_script_id
         and e.status='Cerrado' and e.winner_hook_id is not null)) then
    raise exception 'La fórmula orgánica necesita un experimento de retención cerrado con ganador.';
  end if;
  update public.agency_creative_formula_measurements set outcome=p_outcome,
    decided_by=v_actor.id,decided_at=clock_timestamp(),decision_note=v_note
  where id=v_measure.id;
  perform public._add_audit('Medición fórmula creativa',v_measure.id::text,
    'Decisión humana de aprendizaje','En revisión',p_outcome);
  return jsonb_build_object('ok',true,'measurement_id',v_measure.id,
    'formula_id',v_formula.id,'outcome',p_outcome,'external_execution',false);
end $$;

create or replace function public.inteligencia_creativa_publicitaria_disponible()
returns boolean language plpgsql stable security definer set search_path=public as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then perform public._agency_actor(); end if;
  return true;
end $$;

create or replace function public.momos_creative_intelligence_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_snapshot jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then perform public._agency_actor(); end if;
  select jsonb_build_object(
    'schema_version','momos-creative-intelligence/v1',
    'generated_at',clock_timestamp(),
    'formulas',coalesce((select jsonb_agg(to_jsonb(x) order by x.prepared_at desc,x.id desc)
      from (select f.id,f.formula_key,f.version,f.name,f.mode,f.status,
        f.source_creative_id,f.source_creative_version_id,f.retention_script_id,
        f.campaign_id,f.product_id,f.channel,f.objective,f.figure,f.flavor,
        f.formula_snapshot,f.formula_fingerprint,f.source_kind,f.prepared_at,
        f.reviewed_at from public.agency_creative_formulas f
        order by f.prepared_at desc,f.id desc limit 100) x),'[]'::jsonb),
    'measurements',coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at desc,x.id desc)
      from (select m.id,m.measurement_key,m.formula_id,m.platform,
        m.window_start,m.window_end,m.impressions,m.reach,m.clicks,m.messages,
        m.spend,m.platform_attributed_revenue,m.internal_paid_orders,
        m.internal_revenue,m.internal_margin,m.internal_roas,
        m.contribution_return,m.platform_roas,m.attribution_gap,
        m.unattributed_campaign_orders,m.attribution_status,m.evidence_fingerprint,
        m.outcome,m.source_kind,m.recorded_at,m.decided_at
        from public.agency_creative_formula_measurements m
        order by m.recorded_at desc,m.id desc limit 200) x),'[]'::jsonb),
    'summary',jsonb_build_object(
      'formulas',(select count(*) from public.agency_creative_formulas),
      'approved',(select count(*) from public.agency_creative_formulas where status='Aprobada'),
      'pending_review',(select count(*) from public.agency_creative_formulas where status in ('Propuesta','En revisión')),
      'measurements',(select count(*) from public.agency_creative_formula_measurements),
      'winners',(select count(*) from public.agency_creative_formula_measurements where outcome='Ganadora'),
      'meta_measurements',(select count(*) from public.agency_creative_formula_measurements where platform='Meta'),
      'tiktok_measurements',(select count(*) from public.agency_creative_formula_measurements where platform='TikTok')),
    'metric_definitions',jsonb_build_object(
      'platform_roas','ingreso atribuido por la plataforma / gasto exacto',
      'internal_roas','ventas pagadas MOMO OPS / gasto exacto',
      'contribution_return','margen bruto MOMO OPS / gasto exacto',
      'attribution_is_causality',false),
    'privacy',jsonb_build_object('contains_customer_pii',false,
      'contains_staff_identity',false,'contains_secrets',false,
      'contains_order_ids',false),
    'human_approval_required',true,
    'external_execution_allowed',false
  ) into v_snapshot;
  return jsonb_build_object('snapshot',v_snapshot,
    'fingerprint',public._agency_creative_intelligence_fingerprint(v_snapshot));
end $$;

revoke all on function public._agency_creative_intelligence_fingerprint(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public._agency_creative_formula_snapshot_valid(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public._agency_creative_formula_guard()
  from public,anon,authenticated,service_role;
revoke all on function public._agency_creative_formula_measurement_guard()
  from public,anon,authenticated,service_role;
revoke all on function public._proponer_formula_creativa_v1(jsonb,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public._medir_formula_creativa_v1(jsonb,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.proponer_formula_creativa_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.proponer_formula_creativa_agente_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.revisar_formula_creativa_v1(bigint,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.medir_formula_creativa_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.medir_formula_creativa_conector_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.resolver_medicion_formula_creativa_v1(bigint,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.inteligencia_creativa_publicitaria_disponible()
  from public,anon,authenticated,service_role;
revoke all on function public.momos_creative_intelligence_v1()
  from public,anon,authenticated,service_role;

grant execute on function public.proponer_formula_creativa_v1(jsonb) to authenticated;
grant execute on function public.revisar_formula_creativa_v1(bigint,text,text) to authenticated;
grant execute on function public.medir_formula_creativa_v1(jsonb) to authenticated;
grant execute on function public.resolver_medicion_formula_creativa_v1(bigint,text,text) to authenticated;
grant execute on function public.inteligencia_creativa_publicitaria_disponible()
  to authenticated,service_role;
grant execute on function public.momos_creative_intelligence_v1()
  to authenticated,service_role;
grant execute on function public.proponer_formula_creativa_agente_v1(jsonb)
  to service_role;
grant execute on function public.medir_formula_creativa_conector_v1(jsonb)
  to service_role;

comment on table public.agency_creative_formulas is
  'Fórmulas creativas versionadas y humanas; enlazan contratos existentes sin duplicar activos.';
comment on table public.agency_creative_formula_measurements is
  'Snapshots inmutables: plataforma, ROAS interno y retorno sobre margen permanecen separados.';
comment on function public.momos_creative_intelligence_v1() is
  'Memoria creativa sin PII para MOMO OPS y Codex; nunca ejecuta publicación, pauta o presupuesto.';

insert into public.momos_ops_migrations(id,detalle)
values('20260722_103_inteligencia_creativa_publicitaria',
  'Fórmulas versionadas, verdad pagada Meta/TikTok, ROAS separados, decisión humana y memoria MCP sin PII')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260722_103_inteligencia_creativa_publicitaria';
