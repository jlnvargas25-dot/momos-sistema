-- MOMOS OPS · Flujo creativo E2E v1.
-- Paso 50. Une el máster aprobado con el creativo, la publicación, la distribución
-- y la medición exactas. No genera, no publica, no pauta y no ejecuta conectores.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_49_gobernanza_marca'
  ) then raise exception 'Falta el paso 49_gobernanza_marca.'; end if;
end $$;

alter table public.agency_brand_gate_bindings
  drop constraint if exists agency_brand_gate_bindings_target_type_check;
alter table public.agency_brand_gate_bindings
  add constraint agency_brand_gate_bindings_target_type_check check(target_type in
    ('Contrato','Storyboard','Enrutamiento','Generación','QA escena','Paquete','Máster','Relevo comercial','Distribución'));

create table if not exists public.agency_master_releases(
  id bigint generated always as identity primary key,
  release_key text not null unique check(release_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  contract_id bigint not null references public.agency_creative_contracts(id) on delete restrict,
  storyboard_id bigint not null references public.agency_storyboards(id) on delete restrict,
  export_id bigint not null unique references public.agency_postproduction_exports(id) on delete restrict,
  output_asset_id bigint not null unique references public.brand_media_assets(id) on delete restrict,
  creative_id text not null unique references public.creatives(id) on delete restrict,
  post_id text unique references public.content_posts(id) on delete restrict,
  distribution_id bigint unique references public.content_distributions(id) on delete restrict,
  content_mode text not null check(content_mode in ('Pauta','Orgánico')),
  status text not null default 'Máster vinculado' check(status in
    ('Máster vinculado','Publicación vinculada','Distribución aprobada','Publicada','Cancelada')),
  lineage_snapshot jsonb not null check(jsonb_typeof(lineage_snapshot)='object'),
  lineage_fingerprint text not null check(lineage_fingerprint ~ '^[0-9a-f]{32}$'),
  prepared_by text not null references public.users(id), prepared_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_master_releases_no_secret check(
    lineage_snapshot::text !~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:'
  )
);
create index if not exists agency_master_releases_status_idx on public.agency_master_releases(status,updated_at desc);
create index if not exists agency_master_releases_contract_idx on public.agency_master_releases(contract_id,updated_at desc);

create table if not exists public.agency_master_release_events(
  id bigint generated always as identity primary key,
  release_id bigint not null references public.agency_master_releases(id) on delete restrict,
  event_type text not null check(event_type in ('Máster vinculado','Publicación vinculada','Distribución aprobada','Publicada','Cancelada')),
  target_key text not null check(length(btrim(target_key)) between 1 and 220),
  event_snapshot jsonb not null check(jsonb_typeof(event_snapshot)='object'),
  event_fingerprint text not null check(event_fingerprint ~ '^[0-9a-f]{32}$'),
  recorded_by text not null references public.users(id), recorded_at timestamptz not null default now(),
  unique(release_id,event_type,target_key),
  constraint agency_master_release_events_no_secret check(
    event_snapshot::text !~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:'
  )
);
create index if not exists agency_master_release_events_release_idx on public.agency_master_release_events(release_id,recorded_at);

alter table public.agency_master_releases enable row level security;
alter table public.agency_master_release_events enable row level security;
drop policy if exists staff_read on public.agency_master_releases;
drop policy if exists staff_read on public.agency_master_release_events;
create policy staff_read on public.agency_master_releases for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_master_release_events for select to authenticated using(public.is_staff());
revoke all on public.agency_master_releases,public.agency_master_release_events from public,anon,authenticated;
grant select on public.agency_master_releases,public.agency_master_release_events to authenticated;

create or replace function public.flujo_creativo_e2e_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_master_release_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Los relevos de máster no se eliminan.'; end if;
  if new.release_key is distinct from old.release_key or new.contract_id is distinct from old.contract_id
     or new.storyboard_id is distinct from old.storyboard_id or new.export_id is distinct from old.export_id
     or new.output_asset_id is distinct from old.output_asset_id or new.creative_id is distinct from old.creative_id
     or new.content_mode is distinct from old.content_mode or new.lineage_snapshot is distinct from old.lineage_snapshot
     or new.lineage_fingerprint is distinct from old.lineage_fingerprint or new.prepared_by is distinct from old.prepared_by
     or new.prepared_at is distinct from old.prepared_at then
    raise exception 'La identidad del relevo es inmutable; creá una corrida nueva.';
  end if;
  if old.post_id is not null and new.post_id is distinct from old.post_id then raise exception 'La publicación exacta ya quedó sellada.'; end if;
  if old.distribution_id is not null and new.distribution_id is distinct from old.distribution_id then raise exception 'La distribución exacta ya quedó sellada.'; end if;
  if (old.status='Máster vinculado' and new.status not in ('Máster vinculado','Publicación vinculada','Cancelada'))
     or (old.status='Publicación vinculada' and new.status not in ('Publicación vinculada','Distribución aprobada','Cancelada'))
     or (old.status='Distribución aprobada' and new.status not in ('Distribución aprobada','Publicada','Cancelada'))
     or (old.status in ('Publicada','Cancelada') and new.status<>old.status) then
    raise exception 'Transición inválida del relevo creativo.';
  end if;
  new.updated_at:=now();
  return new;
end $$;
drop trigger if exists agency_master_releases_immutable on public.agency_master_releases;
create trigger agency_master_releases_immutable before update or delete on public.agency_master_releases
for each row execute function public._agency_master_release_immutable();

create or replace function public._agency_master_release_event_immutable() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  raise exception 'Los eventos del flujo creativo son inmutables.';
end $$;
drop trigger if exists agency_master_release_events_immutable on public.agency_master_release_events;
create trigger agency_master_release_events_immutable before update or delete on public.agency_master_release_events
for each row execute function public._agency_master_release_event_immutable();

create or replace function public._agency_creative_master_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.agency_master_releases where creative_id=old.id and status<>'Cancelada') and (
    new.campaign_id is distinct from old.campaign_id or new.canal is distinct from old.canal
    or new.formato is distinct from old.formato or new.producto_foco_id is distinct from old.producto_foco_id
    or new.asset_url is distinct from old.asset_url or new.generacion is distinct from old.generacion
    or new.hook is distinct from old.hook or new.copy is distinct from old.copy or new.guion is distinct from old.guion
  ) then raise exception 'El creativo ya está ligado a un máster aprobado; creá otra versión.'; end if;
  return new;
end $$;
drop trigger if exists creatives_master_lineage_guard on public.creatives;
create trigger creatives_master_lineage_guard before update on public.creatives
for each row execute function public._agency_creative_master_guard();

create or replace function public.preparar_relevo_master_creativo(p_export_id bigint,p_creative_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_export public.agency_postproduction_exports%rowtype;
  v_package public.agency_postproduction_packages%rowtype; v_board public.agency_storyboards%rowtype;
  v_contract public.agency_creative_contracts%rowtype; v_asset public.brand_media_assets%rowtype;
  v_creative public.creatives%rowtype; v_campaign public.campaigns%rowtype; v_profile public.agency_brand_profiles%rowtype;
  v_existing public.agency_master_releases%rowtype; v_mode text; v_metric text; v_product text; v_snapshot jsonb;
  v_release bigint; v_locator text;
begin
  v_actor:=public._agency_brand_actor();
  select * into v_export from public.agency_postproduction_exports where id=p_export_id for update;
  if v_export.id is null or v_export.status<>'Aprobada' or v_export.output_asset_id is null then raise exception 'El máster necesita exportación y aprobación humana.'; end if;
  select * into v_package from public.agency_postproduction_packages where id=v_export.package_id;
  select * into v_board from public.agency_storyboards where id=v_package.storyboard_id;
  select * into v_contract from public.agency_creative_contracts where id=v_board.contract_id;
  select * into v_asset from public.brand_media_assets where id=v_export.output_asset_id;
  select * into v_creative from public.creatives where id=p_creative_id for update;
  select * into v_profile from public.agency_brand_profiles where status='Activo';
  if v_package.status<>'Aprobado' or v_board.status<>'Aprobado' or v_contract.status<>'Aprobado' then raise exception 'La cadena anterior al máster no está aprobada.'; end if;
  if v_asset.id is null or v_asset.status<>'Activo' or v_asset.content_hash<>v_export.result_snapshot->>'content_hash' then raise exception 'El archivo del máster perdió identidad o integridad.'; end if;
  if v_creative.id is null or v_creative.estado<>'Aprobado' then raise exception 'El creativo comercial necesita aprobación humana antes de recibir el máster.'; end if;
  perform public._agency_brand_require_parent('Contrato',v_contract.id::text,v_profile.id,v_profile.profile_fingerprint);
  perform public._agency_brand_require_parent('Storyboard',v_board.id::text,v_profile.id,v_profile.profile_fingerprint);
  perform public._agency_brand_require_parent('Máster',v_export.id::text,v_profile.id,v_profile.profile_fingerprint);
  v_mode:=v_contract.sealed_payload#>>'{creative_direction,content_mode}';
  v_metric:=v_contract.sealed_payload#>>'{creative_direction,mode_primary_metric}';
  if not public._agency_brand_content_contract_valid(v_mode,v_metric,
    v_contract.sealed_payload#>>'{creative_direction,content_goal}',v_contract.sealed_payload->'constraints') then
    raise exception 'El contrato mezcla Pauta y Orgánico o no define cómo medirlos.';
  end if;
  v_product:=nullif(v_contract.sealed_payload#>>'{facts,product,id}','');
  if v_product is not null and v_creative.producto_foco_id is distinct from v_product then raise exception 'El creativo no corresponde al producto exacto del contrato.'; end if;
  if v_product is not null and v_asset.product_id is distinct from v_product then raise exception 'El archivo del máster no corresponde al producto exacto del contrato.'; end if;
  if v_creative.canal is distinct from v_board.channel
     or (v_contract.sealed_payload#>>'{creative_direction,channel}'<>'Multicanal'
       and v_creative.canal is distinct from v_contract.sealed_payload#>>'{creative_direction,channel}') then
    raise exception 'Canal de contrato, storyboard y creativo no coincide.';
  end if;
  if v_creative.campaign_id is not null then select * into v_campaign from public.campaigns where id=v_creative.campaign_id; end if;
  if v_mode='Pauta' and (v_campaign.id is null or not (coalesce(v_campaign.presupuesto,0)>0 or length(btrim(coalesce(v_campaign.external_platform,'')))>0 or v_creative.formato='Anuncio')) then
    raise exception 'El contenido de Pauta necesita campaña y medición atribuible.';
  elsif v_mode='Orgánico' and (coalesce(v_campaign.presupuesto,0)>0 or length(btrim(coalesce(v_campaign.external_platform,'')))>0 or v_creative.formato='Anuncio') then
    raise exception 'El creativo comercial está configurado como Pauta, no como Orgánico.';
  end if;
  select * into v_existing from public.agency_master_releases where export_id=v_export.id or creative_id=v_creative.id;
  if v_existing.id is not null then
    if v_existing.export_id<>v_export.id or v_existing.creative_id<>v_creative.id or v_existing.contract_id<>v_contract.id then raise exception 'Máster, creativo o contrato ya pertenece a otro relevo.'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'release_id',v_existing.id,'status',v_existing.status);
  end if;
  v_locator:='momos-master://asset/'||v_asset.id||'/'||v_asset.content_hash;
  if length(btrim(coalesce(v_creative.asset_url,'')))>0 and v_creative.asset_url<>v_locator then raise exception 'El creativo ya señala otro archivo; creá una versión nueva.'; end if;
  update public.creatives set asset_url=v_locator,generacion=coalesce(generacion,'{}'::jsonb)||jsonb_build_object(
    'source','MOMOS OPS master','master_export_id',v_export.id,'master_asset_id',v_asset.id,
    'master_content_hash',v_asset.content_hash,'content_mode',v_mode,'external_execution',false)
  where id=v_creative.id;
  v_snapshot:=jsonb_build_object('schema_version',1,'contract_id',v_contract.id,'contract_fingerprint',v_contract.contract_fingerprint,
    'storyboard_id',v_board.id,'storyboard_fingerprint',v_board.source_fingerprint,'package_id',v_package.id,
    'package_fingerprint',v_package.package_fingerprint,'export_id',v_export.id,'export_fingerprint',v_export.result_fingerprint,
    'output_asset_id',v_asset.id,'content_hash',v_asset.content_hash,'creative_id',v_creative.id,
    'product_id',v_product,'channel',v_creative.canal,'format',v_creative.formato,'content_mode',v_mode,
    'mode_metric',v_metric,'brand_profile_id',v_profile.id,'brand_fingerprint',v_profile.profile_fingerprint,
    'human_review_required',true,'publication_authorized',false,'paid_execution_authorized',false,
    'contains_pii',false,'contains_secrets',false);
  insert into public.agency_master_releases(release_key,contract_id,storyboard_id,export_id,output_asset_id,creative_id,content_mode,
    lineage_snapshot,lineage_fingerprint,prepared_by)
  values('release-'||v_contract.id||'-'||v_export.id,v_contract.id,v_board.id,v_export.id,v_asset.id,v_creative.id,v_mode,
    v_snapshot,public._agency_mesa_fingerprint(v_snapshot),v_actor.id) returning id into v_release;
  insert into public.agency_master_release_events(release_id,event_type,target_key,event_snapshot,event_fingerprint,recorded_by)
  values(v_release,'Máster vinculado',v_export.id::text,v_snapshot,public._agency_mesa_fingerprint(v_snapshot),v_actor.id);
  perform public._agency_brand_record_gate('Relevo comercial',v_release::text,v_snapshot,v_actor.id,'Máster',v_export.id::text);
  return jsonb_build_object('ok',true,'duplicate',false,'release_id',v_release,'status','Máster vinculado');
end $$;

create or replace function public.vincular_publicacion_master(p_release_id bigint,p_post_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_release public.agency_master_releases%rowtype; v_post public.content_posts%rowtype; v_snapshot jsonb;
begin
  v_actor:=public._agency_brand_actor();
  select * into v_release from public.agency_master_releases where id=p_release_id for update;
  if v_release.id is null or v_release.status not in ('Máster vinculado','Publicación vinculada') then raise exception 'El relevo no admite una publicación.'; end if;
  select * into v_post from public.content_posts where id=p_post_id for update;
  if v_post.id is null or v_post.estado<>'Programado' then raise exception 'La publicación debe existir y estar Programada.'; end if;
  if v_post.creative_id is distinct from v_release.creative_id then raise exception 'La publicación no usa el creativo ligado al máster.'; end if;
  if v_post.canal is distinct from v_release.lineage_snapshot->>'channel' then raise exception 'La publicación cambió el canal sellado del máster.'; end if;
  if public._agency_infer_content_mode(v_post.id)<>v_release.content_mode then raise exception 'La publicación mezcla Pauta y Orgánico.'; end if;
  if v_release.post_id is not null and v_release.post_id<>v_post.id then raise exception 'El relevo ya tiene otra publicación exacta.'; end if;
  update public.agency_master_releases set post_id=v_post.id,status='Publicación vinculada' where id=v_release.id;
  v_snapshot:=jsonb_build_object('schema_version',1,'release_id',v_release.id,'post_id',v_post.id,'creative_id',v_post.creative_id,
    'campaign_id',v_post.campaign_id,'channel',v_post.canal,'content_mode',v_release.content_mode,
    'publication_authorized',false,'paid_execution_authorized',false,'contains_pii',false,'contains_secrets',false);
  insert into public.agency_master_release_events(release_id,event_type,target_key,event_snapshot,event_fingerprint,recorded_by)
  values(v_release.id,'Publicación vinculada',v_post.id,v_snapshot,public._agency_mesa_fingerprint(v_snapshot),v_actor.id)
  on conflict(release_id,event_type,target_key) do nothing;
  return jsonb_build_object('ok',true,'release_id',v_release.id,'post_id',v_post.id,'status','Publicación vinculada');
end $$;

create or replace function public._agency_distribution_master_lineage_before() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_release public.agency_master_releases%rowtype; v_export public.agency_postproduction_exports%rowtype;
  v_profile public.agency_brand_profiles%rowtype;
begin
  if new.status='Aprobada' and old.status is distinct from new.status then
    select * into v_release from public.agency_master_releases where post_id=new.post_id and status='Publicación vinculada' for update;
    if v_release.id is null then raise exception 'La distribución no está ligada al máster aprobado exacto.'; end if;
    if v_release.content_mode<>new.content_mode then raise exception 'La distribución mezcla Pauta y Orgánico.'; end if;
    select * into v_export from public.agency_postproduction_exports where id=v_release.export_id;
    if v_export.status<>'Aprobada' or v_export.output_asset_id<>v_release.output_asset_id then raise exception 'El máster del relevo dejó de ser válido.'; end if;
    select * into v_profile from public.agency_brand_profiles where status='Activo';
    perform public._agency_brand_require_parent('Relevo comercial',v_release.id::text,v_profile.id,v_profile.profile_fingerprint);
  end if;
  return new;
end $$;
drop trigger if exists content_distributions_master_lineage_before on public.content_distributions;
create trigger content_distributions_master_lineage_before before update of status on public.content_distributions
for each row execute function public._agency_distribution_master_lineage_before();

create or replace function public._agency_distribution_master_lineage_after() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_release public.agency_master_releases%rowtype; v_actor text; v_snapshot jsonb; v_event text;
begin
  if new.status not in ('Aprobada','Publicada','Cancelada') or old.status is not distinct from new.status then return new; end if;
  select * into v_release from public.agency_master_releases where post_id=new.post_id for update;
  if v_release.id is null then return new; end if;
  v_actor:=coalesce(new.approved_by,new.executed_by,v_release.prepared_by);
  if new.status='Aprobada' then
    update public.agency_master_releases set distribution_id=new.id,status='Distribución aprobada' where id=v_release.id;
    v_event:='Distribución aprobada';
  elsif new.status='Publicada' then
    update public.agency_master_releases set distribution_id=new.id,status='Publicada' where id=v_release.id;
    v_event:='Publicada';
  else
    update public.agency_master_releases set distribution_id=new.id,status='Cancelada' where id=v_release.id and status<>'Publicada';
    v_event:='Cancelada';
  end if;
  v_snapshot:=jsonb_build_object('schema_version',1,'release_id',v_release.id,'distribution_id',new.id,'post_id',new.post_id,
    'status',new.status,'content_mode',new.content_mode,'attempt',new.attempt,
    'external_evidence_present',new.status='Publicada' and (length(btrim(new.external_url))>0 or length(btrim(new.external_post_id))>0),
    'contains_pii',false,'contains_secrets',false);
  insert into public.agency_master_release_events(release_id,event_type,target_key,event_snapshot,event_fingerprint,recorded_by)
  values(v_release.id,v_event,new.id::text,v_snapshot,public._agency_mesa_fingerprint(v_snapshot),v_actor)
  on conflict(release_id,event_type,target_key) do nothing;
  return new;
end $$;
drop trigger if exists content_distributions_master_lineage_after on public.content_distributions;
create trigger content_distributions_master_lineage_after after update of status on public.content_distributions
for each row execute function public._agency_distribution_master_lineage_after();

revoke all on function public.flujo_creativo_e2e_disponible() from public,anon;
revoke all on function public.preparar_relevo_master_creativo(bigint,text) from public,anon;
revoke all on function public.vincular_publicacion_master(bigint,text) from public,anon;
revoke all on function public._agency_master_release_immutable() from public,anon,authenticated,service_role;
revoke all on function public._agency_master_release_event_immutable() from public,anon,authenticated,service_role;
revoke all on function public._agency_creative_master_guard() from public,anon,authenticated,service_role;
revoke all on function public._agency_distribution_master_lineage_before() from public,anon,authenticated,service_role;
revoke all on function public._agency_distribution_master_lineage_after() from public,anon,authenticated,service_role;
grant execute on function public.flujo_creativo_e2e_disponible() to authenticated,service_role;
grant execute on function public.preparar_relevo_master_creativo(bigint,text) to authenticated;
grant execute on function public.vincular_publicacion_master(bigint,text) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_50_flujo_creativo_e2e',
  'Máster ligado a creativo, publicación, distribución y medición exactas sin mezclar Pauta y Orgánico')
on conflict(id) do update set detalle=excluded.detalle;

commit;
