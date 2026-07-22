-- MOMOS OPS · Audio trazable de postproducción v1.
-- Paso 48. Sella audio original o una pista de Biblioteca al autorizar el máster.
-- Revalida archivo, derechos y canal al reclamar y registrar. No publica ni distribuye.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_47_postproduccion_exportacion'
  ) then raise exception 'Falta el paso 47_postproduccion_exportacion.'; end if;
end $$;

create table if not exists public.agency_postproduction_export_audio(
  export_id bigint primary key references public.agency_postproduction_exports(id) on delete restrict,
  mode text not null check(mode in ('Original','Biblioteca')),
  asset_id bigint references public.brand_media_assets(id) on delete restrict,
  audio_snapshot jsonb not null check(jsonb_typeof(audio_snapshot)='object'),
  audio_fingerprint text not null check(audio_fingerprint~'^[0-9a-f]{32}$'),
  authorized_by text not null references public.users(id),
  authorized_at timestamptz not null default now(),
  check((mode='Original' and asset_id is null) or (mode='Biblioteca' and asset_id is not null))
);

alter table public.agency_postproduction_export_audio enable row level security;
drop policy if exists staff_read on public.agency_postproduction_export_audio;
create policy staff_read on public.agency_postproduction_export_audio for select to authenticated using(public.is_staff());
revoke all on public.agency_postproduction_export_audio from public,anon,authenticated;
grant select on public.agency_postproduction_export_audio to authenticated;

create or replace function public.postproduccion_audio_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_postproduction_audio_snapshot(p jsonb,p_channel text) returns jsonb
language plpgsql stable security definer set search_path=public,storage as $$
declare v_mode text:=lower(btrim(coalesce(p->>'mode','original'))); v_asset public.brand_media_assets%rowtype;
  v_asset_id bigint; v_channel text:=btrim(coalesce(p_channel,'')); v_allowed boolean;
begin
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p) then
    raise exception 'La selección de audio es inválida o contiene secretos.';
  end if;
  if v_mode in ('original','audio original','tomas') then
    return jsonb_build_object('schema_version',1,'mode','Original','requires_source_audio',true,
      'target_lufs',-14,'publication_authorized',false,'distribution_authorized',false);
  end if;
  if v_mode not in ('biblioteca','library','pista de biblioteca') then raise exception 'El audio debe ser Original o Biblioteca.'; end if;
  v_asset_id:=nullif(p->>'audio_asset_id','')::bigint;
  select * into v_asset from public.brand_media_assets where id=v_asset_id;
  if v_asset.id is null or v_asset.media_type<>'Audio' or v_asset.status<>'Activo'
     or v_asset.rights_status not in ('Propio','Autorizado')
     or (v_asset.rights_expires_at is not null and v_asset.rights_expires_at<current_date)
     or v_asset.mime_type not in ('audio/mpeg','audio/mp4','audio/wav')
     or coalesce(v_asset.duration_seconds,0)<=0 or coalesce(v_asset.duration_seconds,0)>1800
     or not exists(select 1 from storage.objects where bucket_id='brand-assets' and name=v_asset.storage_path) then
    raise exception 'La pista no está activa, autorizada, vigente o respaldada por un archivo real.';
  end if;
  select jsonb_array_length(v_asset.allowed_channels)=0 or exists(
    select 1 from jsonb_array_elements_text(v_asset.allowed_channels) c(value)
    where lower(btrim(c.value)) in (lower(v_channel),'todos','all')
  ) into v_allowed;
  if not coalesce(v_allowed,false) then raise exception 'Los derechos de la pista no cubren el canal %.',v_channel; end if;
  return jsonb_build_object('schema_version',1,'mode','Biblioteca','target_lufs',-14,
    'asset',jsonb_build_object('id',v_asset.id,'storage_path',v_asset.storage_path,'content_hash',v_asset.content_hash,
      'mime_type',v_asset.mime_type,'size_bytes',v_asset.size_bytes,'duration_seconds',v_asset.duration_seconds,
      'rights_status',v_asset.rights_status,'rights_expires_at',v_asset.rights_expires_at,
      'allowed_channels',v_asset.allowed_channels),
    'mix',jsonb_build_object('original_gain_db',0,'soundtrack_gain_db',-14,'loop',true),
    'publication_authorized',false,'distribution_authorized',false);
end $$;

create or replace function public._agency_postproduction_audio_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  raise exception 'La selección de audio está sellada; autorizá una exportación nueva para cambiarla.';
end $$;
drop trigger if exists agency_postproduction_audio_immutable on public.agency_postproduction_export_audio;
create trigger agency_postproduction_audio_immutable before update or delete on public.agency_postproduction_export_audio
for each row execute function public._agency_postproduction_audio_immutable();

-- Conserva contratos H47 previos como "Audio original" sin inventar una pista.
insert into public.agency_postproduction_export_audio(export_id,mode,asset_id,audio_snapshot,audio_fingerprint,authorized_by,authorized_at)
select e.id,'Original',null,s.snapshot,public._agency_mesa_fingerprint(s.snapshot),e.requested_by,e.requested_at
from public.agency_postproduction_exports e
cross join lateral (select jsonb_build_object('schema_version',1,'mode','Original','requires_source_audio',true,
  'target_lufs',-14,'publication_authorized',false,'distribution_authorized',false) snapshot) s
where not exists(select 1 from public.agency_postproduction_export_audio a where a.export_id=e.id);

do $$ begin
  if to_regprocedure('public._autorizar_exportacion_postproduccion_h47(jsonb)') is null then
    alter function public.autorizar_exportacion_postproduccion(jsonb) rename to _autorizar_exportacion_postproduccion_h47;
  end if;
  if to_regprocedure('public._reclamar_exportacion_postproduccion_h47(text,integer)') is null then
    alter function public.reclamar_exportacion_postproduccion(text,integer) rename to _reclamar_exportacion_postproduccion_h47;
  end if;
  if to_regprocedure('public._registrar_master_postproduccion_h47(bigint,uuid,jsonb)') is null then
    alter function public.registrar_master_postproduccion(bigint,uuid,jsonb) rename to _registrar_master_postproduccion_h47;
  end if;
end $$;

create or replace function public.autorizar_exportacion_postproduccion(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_package public.agency_postproduction_packages%rowtype;
  v_board public.agency_storyboards%rowtype; v_audio jsonb; v_fp text; v_result jsonb; v_export_id bigint;
  v_existing public.agency_postproduction_export_audio%rowtype;
begin
  v_actor:=public._agency_actor();
  select * into v_package from public.agency_postproduction_packages where id=nullif(p->>'package_id','')::bigint;
  select * into v_board from public.agency_storyboards where id=v_package.storyboard_id;
  if v_package.id is null or v_board.id is null then raise exception 'El paquete o storyboard no existe.'; end if;
  v_audio:=public._agency_postproduction_audio_snapshot(coalesce(p->'audio_selection','{"mode":"Original"}'::jsonb),v_board.channel);
  v_fp:=public._agency_mesa_fingerprint(v_audio);
  v_result:=public._autorizar_exportacion_postproduccion_h47(p-'audio_selection');
  v_export_id:=(v_result->>'export_id')::bigint;
  insert into public.agency_postproduction_export_audio(export_id,mode,asset_id,audio_snapshot,audio_fingerprint,authorized_by)
  values(v_export_id,v_audio->>'mode',nullif(v_audio#>>'{asset,id}','')::bigint,v_audio,v_fp,v_actor.id)
  on conflict(export_id) do nothing;
  select * into v_existing from public.agency_postproduction_export_audio where export_id=v_export_id;
  if v_existing.audio_fingerprint<>v_fp then raise exception 'La exportación ya fue autorizada con otra selección de audio.'; end if;
  return v_result||jsonb_build_object('audio_mode',v_existing.mode,'audio_fingerprint',v_existing.audio_fingerprint);
end $$;

create or replace function public.reclamar_exportacion_postproduccion(p_worker_id text,p_lease_seconds integer default 900) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_binding public.agency_postproduction_export_audio%rowtype; v_export_id bigint;
begin
  v_result:=public._reclamar_exportacion_postproduccion_h47(p_worker_id,p_lease_seconds);
  if v_result->>'export' is null then return v_result; end if;
  v_export_id:=(v_result#>>'{export,id}')::bigint;
  select * into v_binding from public.agency_postproduction_export_audio where export_id=v_export_id;
  if v_binding.export_id is null or v_binding.audio_fingerprint<>public._agency_mesa_fingerprint(v_binding.audio_snapshot) then
    raise exception 'La exportación no tiene un contrato de audio íntegro.';
  end if;
  return v_result||jsonb_build_object('audio_binding',jsonb_build_object('export_id',v_binding.export_id,
    'mode',v_binding.mode,'snapshot',v_binding.audio_snapshot,'fingerprint',v_binding.audio_fingerprint));
end $$;

create or replace function public.registrar_master_postproduccion(p_export_id bigint,p_lease_token uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_binding public.agency_postproduction_export_audio%rowtype; v_export public.agency_postproduction_exports%rowtype;
  v_package public.agency_postproduction_packages%rowtype; v_board public.agency_storyboards%rowtype; v_current jsonb;
begin
  select * into v_binding from public.agency_postproduction_export_audio where export_id=p_export_id;
  select * into v_export from public.agency_postproduction_exports where id=p_export_id;
  select * into v_package from public.agency_postproduction_packages where id=v_export.package_id;
  select * into v_board from public.agency_storyboards where id=v_package.storyboard_id;
  if v_binding.export_id is null or v_board.id is null then raise exception 'Falta el contrato de audio de la exportación.'; end if;
  v_current:=public._agency_postproduction_audio_snapshot(
    case when v_binding.mode='Biblioteca' then jsonb_build_object('mode','Biblioteca','audio_asset_id',v_binding.asset_id)
      else jsonb_build_object('mode','Original') end,v_board.channel);
  if v_binding.audio_fingerprint<>public._agency_mesa_fingerprint(v_current) then
    raise exception 'La pista, sus derechos o su cobertura cambiaron antes del máster.';
  end if;
  return public._registrar_master_postproduccion_h47(p_export_id,p_lease_token,p);
end $$;

revoke all on function public.postproduccion_audio_disponible() from public,anon;
revoke all on function public._agency_postproduction_audio_snapshot(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public._agency_postproduction_audio_immutable() from public,anon,authenticated,service_role;
revoke all on function public._autorizar_exportacion_postproduccion_h47(jsonb) from public,anon,authenticated,service_role;
revoke all on function public._reclamar_exportacion_postproduccion_h47(text,integer) from public,anon,authenticated,service_role;
revoke all on function public._registrar_master_postproduccion_h47(bigint,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.autorizar_exportacion_postproduccion(jsonb) from public,anon;
revoke all on function public.reclamar_exportacion_postproduccion(text,integer) from public,anon,authenticated;
revoke all on function public.registrar_master_postproduccion(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.postproduccion_audio_disponible() to authenticated;
grant execute on function public.autorizar_exportacion_postproduccion(jsonb) to authenticated;
grant execute on function public.reclamar_exportacion_postproduccion(text,integer) to service_role;
grant execute on function public.registrar_master_postproduccion(bigint,uuid,jsonb) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_48_audio_postproduccion','Audio original o de Biblioteca sellado por exportación, derechos vigentes, mezcla trazable y normalización LUFS')
on conflict(id) do update set detalle=excluded.detalle;

notify pgrst, 'reload schema';
commit;
