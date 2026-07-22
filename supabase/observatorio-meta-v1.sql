-- MOMOS OPS · Observatorio de adquisición Meta v1.
-- Paso 37. Meta aporta señales; MOMO OPS conserva verdad comercial, diagnóstico y gates. Nunca publica ni cambia pauta.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_36_experiencia_motion'
  ) then raise exception 'Falta el paso 36_experiencia_motion.'; end if;
end $$;

create table if not exists public.agency_meta_policies(
  id bigint generated always as identity primary key,
  policy_key text not null unique check(policy_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  version integer not null check(version>0),
  status text not null default 'Activa' check(status in ('Activa','Sustituida','Anulada')),
  source_label text not null check(length(btrim(source_label)) between 3 and 240),
  market text not null check(length(btrim(market)) between 2 and 120),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  effective_from date not null,
  effective_until date,
  targets jsonb not null check(jsonb_typeof(targets)='object'),
  thresholds jsonb not null check(jsonb_typeof(thresholds)='object'),
  policy_fingerprint text not null check(policy_fingerprint ~ '^[0-9a-f]{32}$'),
  created_by text references public.users(id),
  created_at timestamptz not null default now(),
  unique(market,currency,version),
  check(effective_until is null or effective_until>=effective_from)
);
create unique index if not exists agency_meta_one_active_policy_idx on public.agency_meta_policies(market,currency) where status='Activa';

create table if not exists public.agency_meta_signal_snapshots(
  id bigint generated always as identity primary key,
  snapshot_key text not null unique check(snapshot_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  account_external_id text not null check(length(btrim(account_external_id)) between 3 and 180),
  account_label text not null default '' check(length(account_label)<=180),
  entity_type text not null check(entity_type in ('Cuenta','Campaña','Conjunto','Anuncio','Creativo','Pixel','Catálogo')),
  entity_external_id text not null default '' check(length(entity_external_id)<=180),
  objective text not null check(objective in ('Ventas','Mensajes','Leads','Reconocimiento')),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  timezone text not null check(length(btrim(timezone)) between 3 and 100),
  window_start timestamptz not null,
  window_end timestamptz not null,
  source_captured_at timestamptz not null,
  local_campaign_id text references public.campaigns(id) on delete restrict,
  local_creative_id text references public.creatives(id) on delete restrict,
  local_post_id text references public.content_posts(id) on delete restrict,
  metrics jsonb not null check(jsonb_typeof(metrics)='object'),
  pixel_events jsonb not null default '[]'::jsonb check(jsonb_typeof(pixel_events)='array'),
  catalog_products jsonb not null default '[]'::jsonb check(jsonb_typeof(catalog_products)='array'),
  local_truth jsonb not null check(jsonb_typeof(local_truth)='object'),
  publication_fingerprint text not null default '' check(publication_fingerprint='' or publication_fingerprint ~ '^[0-9a-f]{32}$'),
  snapshot_fingerprint text not null check(snapshot_fingerprint ~ '^[0-9a-f]{32}$'),
  recorded_by_connector text not null check(length(btrim(recorded_by_connector)) between 2 and 100),
  created_at timestamptz not null default now(),
  check(window_start<window_end),
  unique(account_external_id,entity_type,entity_external_id,window_start,window_end,snapshot_fingerprint)
);
create index if not exists agency_meta_snapshots_account_idx on public.agency_meta_signal_snapshots(account_external_id,window_end desc);
create index if not exists agency_meta_snapshots_local_idx on public.agency_meta_signal_snapshots(local_campaign_id,local_creative_id,window_end desc);

create table if not exists public.agency_meta_diagnostics(
  id bigint generated always as identity primary key,
  diagnostic_key text not null unique check(diagnostic_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  snapshot_id bigint not null references public.agency_meta_signal_snapshots(id) on delete restrict,
  policy_id bigint not null references public.agency_meta_policies(id) on delete restrict,
  status text not null default 'En revisión' check(status in ('En revisión','Aprobado','Devuelto','Sustituido','Anulado')),
  what_happened jsonb not null check(jsonb_typeof(what_happened)='object'),
  why_hypotheses jsonb not null check(jsonb_typeof(why_hypotheses)='array'),
  recommended_actions jsonb not null check(jsonb_typeof(recommended_actions)='array'),
  evidence_snapshot jsonb not null check(jsonb_typeof(evidence_snapshot)='object'),
  confidence text not null check(confidence in ('Inicial','Media','Alta')),
  source_kind text not null check(source_kind in ('Humano','Agente')),
  diagnostic_fingerprint text not null check(diagnostic_fingerprint ~ '^[0-9a-f]{32}$'),
  prepared_by text references public.users(id), prepared_by_agent text not null default '', prepared_at timestamptz not null default now(),
  reviewed_by text references public.users(id), reviewed_at timestamptz, review_note text not null default '',
  unique(snapshot_id,policy_id,diagnostic_fingerprint),
  check((source_kind='Humano' and prepared_by is not null and prepared_by_agent='') or
        (source_kind='Agente' and prepared_by is null and length(btrim(prepared_by_agent)) between 2 and 100))
);
create index if not exists agency_meta_diagnostics_status_idx on public.agency_meta_diagnostics(status,prepared_at desc);

alter table public.agency_meta_policies enable row level security;
alter table public.agency_meta_signal_snapshots enable row level security;
alter table public.agency_meta_diagnostics enable row level security;
do $$ declare v_table text; begin
  foreach v_table in array array['agency_meta_policies','agency_meta_signal_snapshots','agency_meta_diagnostics'] loop
    execute format('drop policy if exists staff_read on public.%I',v_table);
    execute format('create policy staff_read on public.%I for select to authenticated using(public.is_staff())',v_table);
    execute format('revoke insert,update,delete on public.%I from public,anon,authenticated',v_table);
    execute format('grant select on public.%I to authenticated',v_table);
  end loop;
end $$;

create or replace function public.observatorio_meta_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._meta_json_numbers_valid(p jsonb) returns boolean
language plpgsql immutable security definer set search_path=public as $$
declare v_value jsonb;
begin
  if p is null or jsonb_typeof(p)<>'object' then return false; end if;
  for v_value in select value from jsonb_each(p) loop
    if jsonb_typeof(v_value)<>'number' or (v_value::text)::numeric<0 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create or replace function public._meta_signal_arrays_valid(p_pixels jsonb,p_catalog jsonb) returns boolean
language plpgsql immutable security definer set search_path=public as $$
declare v_item jsonb;
begin
  if jsonb_typeof(p_pixels)<>'array' or jsonb_typeof(p_catalog)<>'array' then return false; end if;
  for v_item in select value from jsonb_array_elements(p_pixels) loop
    if jsonb_typeof(v_item)<>'object' or length(btrim(coalesce(v_item->>'name','')))<1
       or jsonb_typeof(v_item->'current')<>'number' or jsonb_typeof(v_item->'previous')<>'number' or jsonb_typeof(v_item->'emq')<>'number'
       or (v_item->>'current')::numeric<0 or (v_item->>'previous')::numeric<0 or (v_item->>'emq')::numeric not between 0 and 10 then return false; end if;
  end loop;
  for v_item in select value from jsonb_array_elements(p_catalog) loop
    if jsonb_typeof(v_item)<>'object' or length(btrim(coalesce(v_item->>'product_external_id','')))<1
       or jsonb_typeof(v_item->'spend')<>'number' or (v_item->>'spend')::numeric<0 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create or replace function public._meta_policy_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'Las políticas Meta no se eliminan.'; end if;
  if new.policy_key is distinct from old.policy_key or new.version is distinct from old.version or new.source_label is distinct from old.source_label
     or new.market is distinct from old.market or new.currency is distinct from old.currency or new.effective_from is distinct from old.effective_from
     or new.effective_until is distinct from old.effective_until or new.targets is distinct from old.targets or new.thresholds is distinct from old.thresholds
     or new.policy_fingerprint is distinct from old.policy_fingerprint or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'La política Meta es inmutable; creá una versión nueva.'; end if;
  return new;
end $$;
drop trigger if exists agency_meta_policy_guard on public.agency_meta_policies;
create trigger agency_meta_policy_guard before update or delete on public.agency_meta_policies for each row execute function public._meta_policy_guard();

create or replace function public._meta_snapshot_immutable() returns trigger
language plpgsql security definer set search_path=public as $$ begin raise exception 'Las señales Meta son snapshots inmutables.'; end $$;
drop trigger if exists agency_meta_snapshot_immutable on public.agency_meta_signal_snapshots;
create trigger agency_meta_snapshot_immutable before update or delete on public.agency_meta_signal_snapshots for each row execute function public._meta_snapshot_immutable();

create or replace function public._meta_diagnostic_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='DELETE' then raise exception 'Los diagnósticos Meta no se eliminan.'; end if;
  if new.diagnostic_key is distinct from old.diagnostic_key or new.snapshot_id is distinct from old.snapshot_id or new.policy_id is distinct from old.policy_id
     or new.what_happened is distinct from old.what_happened or new.why_hypotheses is distinct from old.why_hypotheses
     or new.recommended_actions is distinct from old.recommended_actions or new.evidence_snapshot is distinct from old.evidence_snapshot
     or new.confidence is distinct from old.confidence or new.source_kind is distinct from old.source_kind
     or new.diagnostic_fingerprint is distinct from old.diagnostic_fingerprint or new.prepared_by is distinct from old.prepared_by
     or new.prepared_by_agent is distinct from old.prepared_by_agent or new.prepared_at is distinct from old.prepared_at then
    raise exception 'Los hechos del diagnóstico son inmutables; prepará otro snapshot.'; end if;
  return new;
end $$;
drop trigger if exists agency_meta_diagnostic_guard on public.agency_meta_diagnostics;
create trigger agency_meta_diagnostic_guard before update or delete on public.agency_meta_diagnostics for each row execute function public._meta_diagnostic_guard();

insert into public.agency_meta_policies(policy_key,version,status,source_label,market,currency,effective_from,targets,thresholds,policy_fingerprint)
select 'momos-meta-operacion-v1',1,'Activa','MOMOS OPS · hipótesis inicial revisable','Cali, Colombia','COP',current_date,
  '{"roas":2.5,"cost_per_conversation":12000,"cost_per_lead":18000}'::jsonb,
  '{"ctr_min_pct":1.5,"landing_rate_min_pct":60,"checkout_purchase_min_pct":30,"video_3s_min_pct":20,"frequency_high":5,"pixel_drop_pct":20,"pixel_floor":50,"minimum_impressions":100}'::jsonb,
  public._agency_mesa_fingerprint(jsonb_build_object('version',1,'source','MOMOS OPS · hipótesis inicial revisable','market','Cali, Colombia','currency','COP',
    'targets','{"roas":2.5,"cost_per_conversation":12000,"cost_per_lead":18000}'::jsonb,
    'thresholds','{"ctr_min_pct":1.5,"landing_rate_min_pct":60,"checkout_purchase_min_pct":30,"video_3s_min_pct":20,"frequency_high":5,"pixel_drop_pct":20,"pixel_floor":50,"minimum_impressions":100}'::jsonb))
where not exists(select 1 from public.agency_meta_policies where policy_key='momos-meta-operacion-v1');

create or replace function public.crear_politica_meta(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_key text:=btrim(coalesce(p->>'policy_key','')); v_market text:=btrim(coalesce(p->>'market',''));
  v_currency text:=upper(btrim(coalesce(p->>'currency',''))); v_targets jsonb:=coalesce(p->'targets','{}'::jsonb);
  v_thresholds jsonb:=coalesce(p->'thresholds','{}'::jsonb); v_version integer; v_fp text; v_id bigint;
begin
  v_actor:=public._agency_actor(); if public.has_current_role('Administrador') is not true then raise exception 'Solo Administrador versiona políticas Meta.'; end if;
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) or v_key !~ '^[A-Za-z0-9:_-]{3,220}$'
     or length(v_market) not between 2 and 120 or v_currency !~ '^[A-Z]{3}$' or not public._meta_json_numbers_valid(v_targets)
     or not public._meta_json_numbers_valid(v_thresholds) then raise exception 'La política Meta es inválida o contiene secretos.'; end if;
  perform pg_advisory_xact_lock(hashtext('meta_policy:'||v_market||':'||v_currency));
  select coalesce(max(version),0)+1 into v_version from public.agency_meta_policies where market=v_market and currency=v_currency;
  v_fp:=public._agency_mesa_fingerprint(jsonb_build_object('version',v_version,'source_label',p->>'source_label','market',v_market,'currency',v_currency,
    'effective_from',coalesce(p->>'effective_from',current_date::text),'targets',v_targets,'thresholds',v_thresholds));
  update public.agency_meta_policies set status='Sustituida' where market=v_market and currency=v_currency and status='Activa';
  insert into public.agency_meta_policies(policy_key,version,status,source_label,market,currency,effective_from,effective_until,targets,thresholds,policy_fingerprint,created_by)
  values(v_key,v_version,'Activa',btrim(p->>'source_label'),v_market,v_currency,coalesce(nullif(p->>'effective_from','')::date,current_date),nullif(p->>'effective_until','')::date,
    v_targets,v_thresholds,v_fp,v_actor.id) returning id into v_id;
  return jsonb_build_object('ok',true,'policy_id',v_id,'version',v_version,'executed',false,'published',false,'spend_changed',false);
end $$;

create or replace function public.registrar_snapshot_meta_conector(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_key text:=btrim(coalesce(p->>'snapshot_key','')); v_account text:=btrim(coalesce(p->>'account_external_id',''));
  v_entity text:=coalesce(p->>'entity_type',''); v_external text:=btrim(coalesce(p->>'entity_external_id',''));
  v_objective text:=coalesce(p->>'objective',''); v_currency text:=upper(btrim(coalesce(p->>'currency',''))); v_timezone text:=btrim(coalesce(p->>'timezone',''));
  v_start timestamptz:=nullif(p->>'window_start','')::timestamptz; v_end timestamptz:=nullif(p->>'window_end','')::timestamptz;
  v_captured timestamptz:=nullif(p->>'source_captured_at','')::timestamptz; v_metrics jsonb:=coalesce(p->'metrics','{}'::jsonb);
  v_pixels jsonb:=coalesce(p->'pixel_events','[]'::jsonb); v_catalog jsonb:=coalesce(p->'catalog_products','[]'::jsonb);
  v_campaign text:=nullif(p->>'local_campaign_id',''); v_creative text:=nullif(p->>'local_creative_id',''); v_post text:=nullif(p->>'local_post_id','');
  v_connector text:=btrim(coalesce(p->>'connector_name','')); v_publication text:=btrim(coalesce(p->>'publication_fingerprint',''));
  v_truth jsonb; v_catalog_enriched jsonb:='[]'::jsonb; v_item jsonb; v_product public.products%rowtype;
  v_paid_orders integer:=0; v_paid_revenue numeric:=0; v_margin numeric:=0; v_units numeric:=0; v_id bigint; v_fp text; v_existing public.agency_meta_signal_snapshots%rowtype;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) or v_key !~ '^[A-Za-z0-9:_-]{3,220}$'
     or length(v_account) not between 3 and 180 or v_entity not in ('Cuenta','Campaña','Conjunto','Anuncio','Creativo','Pixel','Catálogo')
     or v_objective not in ('Ventas','Mensajes','Leads','Reconocimiento') or v_currency !~ '^[A-Z]{3}$' or length(v_timezone) not between 3 and 100
     or v_start is null or v_end is null or v_start>=v_end or v_end-v_start>interval '31 days'
     or v_captured is null or v_captured<v_end or v_captured>now()+interval '15 minutes' or length(v_connector) not between 2 and 100
     or not public._meta_json_numbers_valid(v_metrics) or not public._meta_signal_arrays_valid(v_pixels,v_catalog)
     or (v_publication<>'' and v_publication !~ '^[0-9a-f]{32}$') then raise exception 'El snapshot Meta es inválido, contiene secretos o perdió su ventana.'; end if;
  if v_campaign is not null and not exists(select 1 from public.campaigns where id=v_campaign) then raise exception 'La campaña local no existe.'; end if;
  if v_creative is not null and not exists(select 1 from public.creatives where id=v_creative) then raise exception 'El creativo local no existe.'; end if;
  if v_post is not null and not exists(select 1 from public.content_posts where id=v_post) then raise exception 'La publicación local no existe.'; end if;
  if v_campaign is not null and v_creative is not null and not exists(
    select 1 from public.creatives where id=v_creative and campaign_id=v_campaign
  ) then raise exception 'El creativo no pertenece a la campaña local indicada.'; end if;
  if v_creative is not null and v_post is not null and not exists(
    select 1 from public.content_posts where id=v_post and creative_id=v_creative
  ) then raise exception 'La publicación no pertenece al creativo local indicado.'; end if;
  if v_campaign is not null or v_creative is not null then
    select count(distinct o.id),coalesce(sum(case when not oi.es_sub_momo then oi.cant*oi.precio else 0 end),0),
      coalesce(sum(case when not oi.es_sub_momo then oi.cant*(oi.precio-oi.costo_unitario) else 0 end),0)
      into v_paid_orders,v_paid_revenue,v_margin
    from public.orders o join public.order_items oi on oi.order_id=o.id
    where o.pagado_en>=v_start and o.pagado_en<v_end and o.estado<>'Cancelado'
      and (v_campaign is null or o.campaign_id=v_campaign) and (v_creative is null or o.creative_id=v_creative);
  end if;
  for v_item in select value from jsonb_array_elements(v_catalog) loop
    v_product.id:=null; v_product.stock:=0; v_product.activo:=false; v_units:=0; v_paid_revenue:=0; v_margin:=0;
    if nullif(v_item->>'local_product_id','') is not null then
      select * into v_product from public.products where id=v_item->>'local_product_id';
      if v_product.id is null then raise exception 'Un producto local del catálogo no existe.'; end if;
      select coalesce(sum(oi.cant),0),coalesce(sum(oi.cant*oi.precio),0),coalesce(sum(oi.cant*(oi.precio-oi.costo_unitario)),0)
        into v_units,v_paid_revenue,v_margin from public.order_items oi join public.orders o on o.id=oi.order_id
        where oi.product_id=v_product.id and not oi.es_sub_momo and o.pagado_en>=v_start and o.pagado_en<v_end and o.estado<>'Cancelado';
    end if;
    v_catalog_enriched:=v_catalog_enriched||jsonb_build_array(v_item||jsonb_build_object('momos_truth',jsonb_build_object(
      'available_stock',coalesce(v_product.stock,0),'paid_units',v_units,'paid_revenue',v_paid_revenue,'gross_margin',v_margin,
      'active',coalesce(v_product.activo,false),'expired',false,'source','MOMOS OPS')));
  end loop;
  if v_campaign is not null or v_creative is not null then
    select count(distinct o.id),coalesce(sum(case when not oi.es_sub_momo then oi.cant*oi.precio else 0 end),0),
      coalesce(sum(case when not oi.es_sub_momo then oi.cant*(oi.precio-oi.costo_unitario) else 0 end),0)
      into v_paid_orders,v_paid_revenue,v_margin
    from public.orders o join public.order_items oi on oi.order_id=o.id
    where o.pagado_en>=v_start and o.pagado_en<v_end and o.estado<>'Cancelado'
      and (v_campaign is null or o.campaign_id=v_campaign) and (v_creative is null or o.creative_id=v_creative);
  else v_paid_orders:=0; v_paid_revenue:=0; v_margin:=0; end if;
  v_truth:=jsonb_build_object('paid_orders',v_paid_orders,'paid_revenue',v_paid_revenue,'gross_margin',v_margin,
    'source','orders.pagado_en · misma ventana','linked',v_campaign is not null or v_creative is not null,'captured_at',v_captured);
  v_fp:=public._agency_mesa_fingerprint(jsonb_build_object('account_external_id',v_account,'entity_type',v_entity,'entity_external_id',v_external,
    'objective',v_objective,'currency',v_currency,'timezone',v_timezone,'window_start',v_start,'window_end',v_end,'source_captured_at',v_captured,
    'local_campaign_id',v_campaign,'local_creative_id',v_creative,'local_post_id',v_post,'metrics',v_metrics,'pixel_events',v_pixels,
    'catalog_products',v_catalog_enriched,'local_truth',v_truth,'publication_fingerprint',v_publication));
  select * into v_existing from public.agency_meta_signal_snapshots where snapshot_key=v_key;
  if v_existing.id is not null then
    if v_existing.snapshot_fingerprint<>v_fp then raise exception 'La clave idempotente Meta ya pertenece a otro snapshot.'; end if;
    return jsonb_build_object('ok',true,'snapshot_id',v_existing.id,'duplicate',true,'published',false,'spend_changed',false);
  end if;
  insert into public.agency_meta_signal_snapshots(snapshot_key,account_external_id,account_label,entity_type,entity_external_id,objective,currency,timezone,
    window_start,window_end,source_captured_at,local_campaign_id,local_creative_id,local_post_id,metrics,pixel_events,catalog_products,local_truth,
    publication_fingerprint,snapshot_fingerprint,recorded_by_connector)
  values(v_key,v_account,coalesce(p->>'account_label',''),v_entity,v_external,v_objective,v_currency,v_timezone,v_start,v_end,v_captured,
    v_campaign,v_creative,v_post,v_metrics,v_pixels,v_catalog_enriched,v_truth,v_publication,v_fp,v_connector) returning id into v_id;
  return jsonb_build_object('ok',true,'snapshot_id',v_id,'duplicate',false,'published',false,'spend_changed',false,'local_truth',v_truth);
end $$;

create or replace function public._construir_diagnostico_meta(p_snapshot public.agency_meta_signal_snapshots,p_policy public.agency_meta_policies) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare m jsonb:=p_snapshot.metrics; t jsonb:=p_policy.thresholds; targets jsonb:=p_policy.targets;
  impressions numeric:=coalesce((m->>'impressions')::numeric,0); clicks numeric:=coalesce((m->>'clicks')::numeric,0);
  outbound numeric:=coalesce((m->>'outboundClicks')::numeric,0); landing numeric:=coalesce((m->>'landingViews')::numeric,0);
  checkouts numeric:=coalesce((m->>'checkouts')::numeric,0); purchases numeric:=coalesce((m->>'purchases')::numeric,0);
  spend numeric:=coalesce((m->>'spend')::numeric,0); purchase_value numeric:=coalesce((m->>'purchaseValue')::numeric,0);
  conversations numeric:=coalesce((m->>'conversations')::numeric,0); leads numeric:=coalesce((m->>'leads')::numeric,0);
  ctr numeric; landing_rate numeric; purchase_rate numeric; roas numeric; cpc numeric; cpm numeric; primary_value numeric; primary_target numeric;
  hypotheses jsonb:='[]'::jsonb; actions jsonb:='[]'::jsonb; pixel_health jsonb:='[]'::jsonb; e jsonb; previous numeric; current_value numeric; change_pct numeric; alert boolean;
  confidence text; meta_revenue numeric:=purchase_value; momos_revenue numeric:=coalesce((p_snapshot.local_truth->>'paid_revenue')::numeric,0); gap numeric;
begin
  ctr:=case when impressions>0 then round(clicks/impressions*100,2) end;
  landing_rate:=case when coalesce(nullif(outbound,0),clicks)>0 then round(landing/coalesce(nullif(outbound,0),clicks)*100,2) end;
  purchase_rate:=case when checkouts>0 then round(purchases/checkouts*100,2) end;
  roas:=case when spend>0 then round(purchase_value/spend,2) end; cpc:=case when clicks>0 then round(spend/clicks,2) end;
  cpm:=case when impressions>0 then round(spend/impressions*1000,2) end; gap:=meta_revenue-momos_revenue;
  if p_snapshot.objective='Ventas' then primary_value:=roas; primary_target:=coalesce((targets->>'roas')::numeric,0);
  elsif p_snapshot.objective='Mensajes' then primary_value:=case when conversations>0 then round(spend/conversations,2) end; primary_target:=coalesce((targets->>'cost_per_conversation')::numeric,0);
  elsif p_snapshot.objective='Leads' then primary_value:=case when leads>0 then round(spend/leads,2) end; primary_target:=coalesce((targets->>'cost_per_lead')::numeric,0);
  else primary_value:=cpm; primary_target:=null; end if;
  if ctr is not null and ctr<coalesce((t->>'ctr_min_pct')::numeric,0) then
    hypotheses:=hypotheses||jsonb_build_array(jsonb_build_object('signal','CTR','observation',ctr,'interpretation','Respuesta inicial por debajo de la política versionada.','causal',false));
    actions:=actions||jsonb_build_array(jsonb_build_object('priority','Alta','action','Probar un hook o primer fotograma distinto manteniendo oferta y audiencia.','gate','Experimento humano','changes_external_state',false));
  end if;
  if landing_rate is not null and landing_rate<coalesce((t->>'landing_rate_min_pct')::numeric,0) then
    hypotheses:=hypotheses||jsonb_build_array(jsonb_build_object('signal','Clic a destino','observation',landing_rate,'interpretation','Pérdida entre clic y llegada medida; no demuestra una causa.','causal',false));
    actions:=actions||jsonb_build_array(jsonb_build_object('priority','Alta','action','Auditar URL, velocidad, experiencia y etiquetado antes de cambiar el creativo.','gate','Revisión técnica','changes_external_state',false));
  end if;
  if purchase_rate is not null and purchase_rate<coalesce((t->>'checkout_purchase_min_pct')::numeric,0) then
    hypotheses:=hypotheses||jsonb_build_array(jsonb_build_object('signal','Checkout a compra','observation',purchase_rate,'interpretation','Fricción final o medición incompleta; no demuestra una causa.','causal',false));
    actions:=actions||jsonb_build_array(jsonb_build_object('priority','Alta','action','Conciliar checkout, pagos y pedidos pagados de MOMOS.','gate','Conciliación','changes_external_state',false));
  end if;
  for e in select value from jsonb_array_elements(p_snapshot.pixel_events) loop
    previous:=(e->>'previous')::numeric; current_value:=(e->>'current')::numeric;
    change_pct:=case when previous>0 then round((current_value-previous)/previous*100,2) end;
    alert:=previous>=coalesce((t->>'pixel_floor')::numeric,50) and change_pct is not null and change_pct < -coalesce((t->>'pixel_drop_pct')::numeric,20);
    pixel_health:=pixel_health||jsonb_build_array(e||jsonb_build_object('change_pct',change_pct,'alert',alert,'low_volume',previous<coalesce((t->>'pixel_floor')::numeric,50),
      'emq_status',case when (e->>'emq')::numeric>=8 then 'Excelente' when (e->>'emq')::numeric>=6 then 'Aceptable' when (e->>'emq')::numeric>=4 then 'Bajo' else 'Crítico' end));
    if alert then actions:=actions||jsonb_build_array(jsonb_build_object('priority','Crítica','action','Revisar caída del evento '||(e->>'name')||' ('||change_pct||'%) y su implementación.','gate','Medición','changes_external_state',false)); end if;
  end loop;
  if jsonb_array_length(actions)=0 then actions:=jsonb_build_array(jsonb_build_object('priority','Media','action','Reunir otra ventana comparable antes de cambiar la pauta.','gate','Muestra','changes_external_state',false)); end if;
  confidence:=case when impressions<coalesce((t->>'minimum_impressions')::numeric,100) or (purchases+conversations+leads)<1 then 'Inicial'
    when abs(gap)>greatest(1,momos_revenue*.2) then 'Media' else 'Alta' end;
  return jsonb_build_object('what_happened',jsonb_build_object('objective',p_snapshot.objective,'spend',spend,'impressions',impressions,
      'primary_value',primary_value,'primary_target',primary_target,'meta_attributed_revenue',meta_revenue,'momos_paid_revenue',momos_revenue,'attribution_gap',gap),
    'why_hypotheses',hypotheses,'recommended_actions',actions,'confidence',confidence,
    'evidence',jsonb_build_object('derived',jsonb_build_object('ctr_pct',ctr,'landing_rate_pct',landing_rate,'purchase_rate_pct',purchase_rate,'roas',roas,'cpc',cpc,'cpm',cpm),
      'pixel_health',pixel_health,'catalog_hypotheses',p_snapshot.catalog_products,'local_truth',p_snapshot.local_truth,
      'policy_key',p_policy.policy_key,'policy_fingerprint',p_policy.policy_fingerprint,'attribution_is_not_causality',true,
      'guards',jsonb_build_object('read_only',true,'approval_required',true,'publication_forbidden',true,'spend_change_forbidden',true)));
exception when others then raise exception 'No se pudo construir el diagnóstico Meta: %',sqlerrm;
end $$;

create or replace function public._preparar_diagnostico_meta(p_snapshot_id bigint,p_note text,p_actor text,p_agent text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_snapshot public.agency_meta_signal_snapshots%rowtype; v_policy public.agency_meta_policies%rowtype; v_analysis jsonb; v_fp text; v_id bigint;
  v_kind text:=case when p_actor is not null then 'Humano' else 'Agente' end; v_key text;
begin
  select * into v_snapshot from public.agency_meta_signal_snapshots where id=p_snapshot_id;
  if v_snapshot.id is null then raise exception 'El snapshot Meta no existe.'; end if;
  select * into v_policy from public.agency_meta_policies where status='Activa' and currency=v_snapshot.currency order by version desc limit 1;
  if v_policy.id is null then raise exception 'No existe una política Meta activa para esta moneda.'; end if;
  v_analysis:=public._construir_diagnostico_meta(v_snapshot,v_policy);
  v_fp:=public._agency_mesa_fingerprint(jsonb_build_object('snapshot_fingerprint',v_snapshot.snapshot_fingerprint,'policy_fingerprint',v_policy.policy_fingerprint,
    'analysis',v_analysis,'note',btrim(coalesce(p_note,'')))); v_key:='meta-diagnostic-'||v_snapshot.id||'-'||v_policy.id||'-'||left(v_fp,12);
  select id into v_id from public.agency_meta_diagnostics where snapshot_id=v_snapshot.id and policy_id=v_policy.id and diagnostic_fingerprint=v_fp;
  if v_id is not null then return jsonb_build_object('ok',true,'diagnostic_id',v_id,'duplicate',true,'executed',false,'published',false,'spend_changed',false); end if;
  update public.agency_meta_diagnostics set status='Sustituido',reviewed_at=now(),review_note='Sustituido por evidencia o política posterior.'
    where snapshot_id=v_snapshot.id and status='En revisión';
  insert into public.agency_meta_diagnostics(diagnostic_key,snapshot_id,policy_id,status,what_happened,why_hypotheses,recommended_actions,evidence_snapshot,
    confidence,source_kind,diagnostic_fingerprint,prepared_by,prepared_by_agent)
  values(v_key,v_snapshot.id,v_policy.id,'En revisión',v_analysis->'what_happened',v_analysis->'why_hypotheses',v_analysis->'recommended_actions',v_analysis->'evidence',
    v_analysis->>'confidence',v_kind,v_fp,p_actor,coalesce(p_agent,'')) returning id into v_id;
  return jsonb_build_object('ok',true,'diagnostic_id',v_id,'duplicate',false,'status','En revisión','executed',false,'published',false,'spend_changed',false);
end $$;

create or replace function public.preparar_diagnostico_meta(p_snapshot_id bigint,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$ declare v_actor public.users%rowtype; begin
  v_actor:=public._agency_actor(); return public._preparar_diagnostico_meta(p_snapshot_id,p_note,v_actor.id,null); end $$;

create or replace function public.proponer_diagnostico_meta_agente(p_snapshot_id bigint,p_agent text) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
  if length(btrim(coalesce(p_agent,''))) not between 2 and 100 then raise exception 'Identificá el agente que diagnostica Meta.'; end if;
  return public._preparar_diagnostico_meta(p_snapshot_id,'',null,btrim(p_agent)); end $$;

create or replace function public.resolver_diagnostico_meta(p_diagnostic_id bigint,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_diag public.agency_meta_diagnostics%rowtype; v_status text; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor(); select * into v_diag from public.agency_meta_diagnostics where id=p_diagnostic_id for update;
  if v_diag.id is null or v_diag.status<>'En revisión' then raise exception 'El diagnóstico Meta no espera revisión humana.'; end if;
  if p_decision not in ('Aprobar','Devolver') or length(v_note)<8 then raise exception 'La revisión necesita decisión y nota humana.'; end if;
  v_status:=case when p_decision='Aprobar' then 'Aprobado' else 'Devuelto' end;
  update public.agency_meta_diagnostics set status=v_status,reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_diag.id;
  perform public._add_audit('Observatorio Meta',v_diag.id::text,'Diagnóstico '||lower(v_status),'',left(v_note,180));
  return jsonb_build_object('ok',true,'diagnostic_id',v_diag.id,'status',v_status,'executed',false,'published',false,'spend_changed',false);
end $$;

create or replace function public.obtener_contexto_meta_agente() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('schema_version',1,'captured_at',now(),
    'policies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'policy_key',policy_key,'version',version,'source_label',source_label,'market',market,'currency',currency,'targets',targets,'thresholds',thresholds,'fingerprint',policy_fingerprint)) from public.agency_meta_policies where status='Activa'),'[]'::jsonb),
    'snapshots',coalesce((select jsonb_agg(jsonb_build_object('id',id,'snapshot_key',snapshot_key,'account_external_id',account_external_id,'entity_type',entity_type,'entity_external_id',entity_external_id,'objective',objective,'currency',currency,'timezone',timezone,'window_start',window_start,'window_end',window_end,'metrics',metrics,'pixel_events',pixel_events,'catalog_products',catalog_products,'local_truth',local_truth,'publication_fingerprint',publication_fingerprint,'fingerprint',snapshot_fingerprint) order by window_end desc) from (select * from public.agency_meta_signal_snapshots order by window_end desc limit 100) s),'[]'::jsonb),
    'guards',jsonb_build_object('read_only',true,'proposal_only',true,'publication_forbidden',true,'spend_change_forbidden',true))
$$;

do $$ declare v_name text; begin
  foreach v_name in array array['_meta_json_numbers_valid(jsonb)','_meta_signal_arrays_valid(jsonb,jsonb)','_meta_policy_guard()',
    '_meta_snapshot_immutable()','_meta_diagnostic_guard()','_construir_diagnostico_meta(public.agency_meta_signal_snapshots,public.agency_meta_policies)',
    '_preparar_diagnostico_meta(bigint,text,text,text)'] loop execute format('revoke all on function public.%s from public,anon,authenticated',v_name); end loop;
end $$;
revoke all on function public.observatorio_meta_disponible() from public,anon;
revoke all on function public.crear_politica_meta(jsonb) from public,anon;
revoke all on function public.registrar_snapshot_meta_conector(jsonb) from public,anon,authenticated;
revoke all on function public.preparar_diagnostico_meta(bigint,text) from public,anon;
revoke all on function public.proponer_diagnostico_meta_agente(bigint,text) from public,anon,authenticated;
revoke all on function public.resolver_diagnostico_meta(bigint,text,text) from public,anon;
revoke all on function public.obtener_contexto_meta_agente() from public,anon,authenticated;
grant execute on function public.observatorio_meta_disponible() to authenticated;
grant execute on function public.crear_politica_meta(jsonb) to authenticated;
grant execute on function public.preparar_diagnostico_meta(bigint,text) to authenticated;
grant execute on function public.resolver_diagnostico_meta(bigint,text,text) to authenticated;
grant execute on function public.registrar_snapshot_meta_conector(jsonb) to service_role;
grant execute on function public.proponer_diagnostico_meta_agente(bigint,text) to service_role;
grant execute on function public.obtener_contexto_meta_agente() to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_37_observatorio_meta','Snapshots Meta inmutables, verdad comercial MOMOS, píxel, catálogo y diagnóstico 3Q gobernado sin publicación ni cambios de pauta')
on conflict(id) do update set detalle=excluded.detalle;

commit;
