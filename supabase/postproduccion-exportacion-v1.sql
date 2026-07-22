-- MOMOS OPS · Postproducción y exportación trazable v1.
-- Paso 47. Convierte un paquete de corte aprobado en una cola privada de exportación,
-- registra un archivo MP4 real y exige control técnico humano antes de declararlo máster.
-- No publica, no distribuye y no ejecuta pauta.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_46_resultados_verificables_agencia'
  ) then raise exception 'Falta el paso 46_resultados_verificables_agencia.'; end if;
  if to_regclass('public.agency_postproduction_packages') is null or to_regclass('public.brand_media_assets') is null
     or to_regclass('storage.objects') is null then raise exception 'Faltan Postproducción, Biblioteca o Storage.'; end if;
end $$;

create table if not exists public.agency_postproduction_exports(
  id bigint generated always as identity primary key,
  export_key text not null unique check(export_key ~ '^[A-Za-z0-9:_-]{3,220}$'),
  package_id bigint not null references public.agency_postproduction_packages(id) on delete restrict,
  version integer not null check(version>0),
  status text not null default 'Autorizada' check(status in (
    'Autorizada','Procesando','Exportada','Aprobada','Rechazada','Fallida','Incierta','Cancelada'
  )),
  export_snapshot jsonb not null check(jsonb_typeof(export_snapshot)='object'),
  export_fingerprint text not null check(export_fingerprint ~ '^[0-9a-f]{32}$'),
  requested_by text not null references public.users(id), requested_at timestamptz not null default now(),
  worker_id text not null default '' check(length(worker_id)<=160),
  lease_token uuid, leased_at timestamptz, lease_expires_at timestamptz,
  attempts integer not null default 0 check(attempts between 0 and 10),
  output_asset_id bigint unique references public.brand_media_assets(id) on delete restrict,
  result_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(result_snapshot)='object'),
  result_fingerprint text not null default '' check(result_fingerprint='' or result_fingerprint ~ '^[0-9a-f]{32}$'),
  error_message text not null default '' check(length(error_message)<=1200),
  started_at timestamptz, exported_at timestamptz,
  reviewed_by text references public.users(id), reviewed_at timestamptz, review_note text not null default '',
  unique(package_id,version), unique(package_id,export_fingerprint),
  check((status='Autorizada' and output_asset_id is null and result_snapshot='{}'::jsonb and result_fingerprint='')
     or status<>'Autorizada'),
  check((status in ('Exportada','Aprobada','Rechazada') and output_asset_id is not null and result_snapshot<>'{}'::jsonb
      and result_fingerprint<>'' and exported_at is not null) or status not in ('Exportada','Aprobada','Rechazada')),
  check((status in ('Aprobada','Rechazada') and reviewed_by is not null and reviewed_at is not null and length(btrim(review_note))>=5)
      or status not in ('Aprobada','Rechazada'))
);
create index if not exists agency_postproduction_exports_queue_idx
  on public.agency_postproduction_exports(status,requested_at,id);
create unique index if not exists agency_postproduction_one_live_export_idx
  on public.agency_postproduction_exports(package_id)
  where status in ('Autorizada','Procesando','Exportada','Aprobada','Incierta');

create table if not exists public.agency_postproduction_worker_health(
  worker_id text primary key check(length(btrim(worker_id)) between 3 and 160),
  version text not null check(length(btrim(version)) between 2 and 100),
  status text not null check(status in ('Disponible','Bloqueado','Con error')),
  ffmpeg_available boolean not null default false,
  ffmpeg_version text not null default '' check(length(ffmpeg_version)<=240),
  last_error text not null default '' check(length(last_error)<=600),
  heartbeat_at timestamptz not null default now()
);

alter table public.agency_postproduction_exports enable row level security;
alter table public.agency_postproduction_worker_health enable row level security;
drop policy if exists staff_read on public.agency_postproduction_exports;
drop policy if exists staff_read on public.agency_postproduction_worker_health;
create policy staff_read on public.agency_postproduction_exports for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_postproduction_worker_health for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.agency_postproduction_exports,public.agency_postproduction_worker_health from public,anon,authenticated;
grant select on public.agency_postproduction_exports,public.agency_postproduction_worker_health to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agency_postproduction_exports') then
      alter publication supabase_realtime add table public.agency_postproduction_exports;
    end if;
  end if;
end $$;

create or replace function public.postproduccion_exportacion_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._agency_export_spec_valid(p jsonb) returns boolean
language sql immutable security definer set search_path=public as $$
  select jsonb_typeof(p)='object'
    and coalesce(p->>'aspect_ratio','') in ('9:16','1:1','4:5','16:9')
    and coalesce(p->>'container','')='mp4'
    and coalesce(p->>'video_codec','')='h264'
    and coalesce(p->>'audio_codec','')='aac'
    and coalesce(p->>'color_space','')='bt709'
    and coalesce((p->>'width')::integer,0) between 480 and 3840
    and coalesce((p->>'height')::integer,0) between 480 and 3840
    and coalesce((p->>'fps')::integer,0) in (24,25,30,50,60)
    and coalesce((p->>'loudness_lufs')::numeric,0) between -24 and -9
    and coalesce((p->>'max_size_bytes')::bigint,0) between 1048576 and 104857600
    and coalesce((p->>'burn_subtitles')::boolean,false) in (true,false)
    and coalesce((p->>'final_qc_required')::boolean,false)=true
    and ((p->>'aspect_ratio'='9:16' and (p->>'width')::integer=1080 and (p->>'height')::integer=1920)
      or (p->>'aspect_ratio'='1:1' and (p->>'width')::integer=1080 and (p->>'height')::integer=1080)
      or (p->>'aspect_ratio'='4:5' and (p->>'width')::integer=1080 and (p->>'height')::integer=1350)
      or (p->>'aspect_ratio'='16:9' and (p->>'width')::integer=1920 and (p->>'height')::integer=1080))
$$;

create or replace function public._agency_postproduction_export_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Las exportaciones trazables no se eliminan.'; end if;
  if new.export_key is distinct from old.export_key or new.package_id is distinct from old.package_id
     or new.version is distinct from old.version or new.export_snapshot is distinct from old.export_snapshot
     or new.export_fingerprint is distinct from old.export_fingerprint or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at then
    raise exception 'El contrato de exportación no se reescribe; autorizá una versión nueva.';
  end if;
  return new;
end $$;
drop trigger if exists agency_postproduction_export_immutable on public.agency_postproduction_exports;
create trigger agency_postproduction_export_immutable before update or delete on public.agency_postproduction_exports
for each row execute function public._agency_postproduction_export_immutable();

create or replace function public.autorizar_exportacion_postproduccion(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_package public.agency_postproduction_packages%rowtype;
  v_spec jsonb:=coalesce(p->'export_spec','{}'::jsonb); v_key text:=btrim(coalesce(p->>'export_key',''));
  v_selection jsonb; v_asset public.brand_media_assets%rowtype; v_sources jsonb:='[]'::jsonb;
  v_snapshot jsonb; v_fingerprint text; v_version integer; v_id bigint;
  v_existing public.agency_postproduction_exports%rowtype;
begin
  v_actor:=public._agency_actor();
  if p is null or jsonb_typeof(p)<>'object' or public._agency_mesa_has_secret(p)
     or v_key!~'^[A-Za-z0-9:_-]{3,220}$' or not public._agency_export_spec_valid(v_spec) then
    raise exception 'La autorización de exportación es inválida, insegura o no cumple el máster operativo.';
  end if;
  select * into v_package from public.agency_postproduction_packages where id=nullif(p->>'package_id','')::bigint for update;
  if v_package.id is null or v_package.status<>'Aprobado'
     or v_package.package_fingerprint<>public._agency_mesa_fingerprint(v_package.package_snapshot)
     or coalesce((v_package.package_snapshot->>'publication_authorized')::boolean,true)
     or coalesce((v_package.package_snapshot->>'distribution_authorized')::boolean,true) then
    raise exception 'El paquete no está aprobado, íntegro o conserva separada la publicación.';
  end if;
  for v_selection in select value from jsonb_array_elements(v_package.package_snapshot->'selections') loop
    select * into v_asset from public.brand_media_assets
      where id=(v_selection->>'output_asset_id')::bigint and status='Activo' and rights_status='Autorizado';
    if v_asset.id is null or v_asset.content_hash<>v_selection->>'output_content_hash'
       or v_asset.mime_type not in ('video/mp4','video/quicktime','video/webm') then
      raise exception 'Una fuente dejó de estar activa, autorizada, íntegra o no es video.';
    end if;
    v_sources:=v_sources||jsonb_build_array(jsonb_build_object('shot_id',v_selection->>'shot_id','asset_id',v_asset.id,
      'storage_path',v_asset.storage_path,'content_hash',v_asset.content_hash,'mime_type',v_asset.mime_type,
      'size_bytes',v_asset.size_bytes,'duration_seconds',v_asset.duration_seconds));
  end loop;
  if jsonb_array_length(v_sources)=0 then raise exception 'El paquete aprobado no contiene tomas exportables.'; end if;
  v_snapshot:=jsonb_build_object('schema_version',1,'package_id',v_package.id,'package_version',v_package.version,
    'package_fingerprint',v_package.package_fingerprint,'storyboard_id',v_package.storyboard_id,
    'sources',v_sources,'audio_plan',v_package.package_snapshot->'audio_plan',
    'subtitle_plan',v_package.package_snapshot->'subtitle_plan','edit_decisions',v_package.package_snapshot->'edit_decisions',
    'export_spec',v_spec,'publication_authorized',false,'distribution_authorized',false);
  v_fingerprint:=public._agency_mesa_fingerprint(v_snapshot);
  select * into v_existing from public.agency_postproduction_exports
    where export_key=v_key or (package_id=v_package.id and export_fingerprint=v_fingerprint) limit 1;
  if v_existing.id is not null then
    if v_existing.export_fingerprint<>v_fingerprint then raise exception 'La clave ya pertenece a otra exportación.'; end if;
    return jsonb_build_object('ok',true,'export_id',v_existing.id,'status',v_existing.status,'duplicate',true,
      'published',false,'distributed',false);
  end if;
  perform pg_advisory_xact_lock(hashtext('agency_export:'||v_package.id::text));
  select coalesce(max(version),0)+1 into v_version from public.agency_postproduction_exports where package_id=v_package.id;
  if exists(select 1 from public.agency_postproduction_exports where package_id=v_package.id
      and status in ('Autorizada','Procesando','Exportada','Aprobada','Incierta')) then
    raise exception 'Este paquete ya tiene una exportación viva o incierta.';
  end if;
  insert into public.agency_postproduction_exports(export_key,package_id,version,export_snapshot,export_fingerprint,requested_by)
  values(v_key,v_package.id,v_version,v_snapshot,v_fingerprint,v_actor.id) returning id into v_id;
  perform public._add_audit('Exportación Agencia',v_id::text,'Máster autorizado','',format('Paquete %s · V%s · MP4 H.264',v_package.id,v_version));
  return jsonb_build_object('ok',true,'export_id',v_id,'status','Autorizada','duplicate',false,
    'worker_required',true,'published',false,'distributed',false);
end $$;

create or replace function public.reclamar_exportacion_postproduccion(p_worker_id text,p_lease_seconds integer default 900) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_export public.agency_postproduction_exports%rowtype; v_token uuid:=gen_random_uuid();
  v_worker text:=left(btrim(coalesce(p_worker_id,'')),160); v_lease integer:=greatest(120,least(coalesce(p_lease_seconds,900),1800));
begin
  if length(v_worker)<3 then raise exception 'Identidad del worker inválida.'; end if;
  update public.agency_postproduction_exports set status='Incierta',error_message='Lease vencido: requiere conciliación humana; no se reenvía.'
    where status='Procesando' and lease_expires_at<now();
  select * into v_export from public.agency_postproduction_exports
    where status='Autorizada' order by requested_at,id for update skip locked limit 1;
  if v_export.id is null then return jsonb_build_object('ok',true,'export',null,'published',false); end if;
  update public.agency_postproduction_exports set status='Procesando',worker_id=v_worker,lease_token=v_token,
    leased_at=now(),lease_expires_at=now()+make_interval(secs=>v_lease),attempts=attempts+1,started_at=coalesce(started_at,now()),error_message=''
    where id=v_export.id;
  return jsonb_build_object('ok',true,'lease_token',v_token,'export',jsonb_build_object('id',v_export.id,
    'package_id',v_export.package_id,'version',v_export.version,'snapshot',v_export.export_snapshot,
    'fingerprint',v_export.export_fingerprint),'published',false);
end $$;

create or replace function public.fallar_exportacion_postproduccion(
  p_export_id bigint,p_lease_token uuid,p_error text,p_uncertain boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_export public.agency_postproduction_exports%rowtype; v_error text:=left(btrim(coalesce(p_error,'')),1200);
begin
  select * into v_export from public.agency_postproduction_exports where id=p_export_id for update;
  if v_export.id is null or v_export.status<>'Procesando' or v_export.lease_token<>p_lease_token then
    raise exception 'La exportación no admite este cierre.';
  end if;
  if length(v_error)<3 then raise exception 'El worker debe explicar el fallo.'; end if;
  update public.agency_postproduction_exports set status=case when p_uncertain then 'Incierta' else 'Fallida' end,
    error_message=v_error,lease_expires_at=null where id=v_export.id;
  perform public._add_audit('Exportación Agencia',v_export.id::text,case when p_uncertain then 'Resultado incierto' else 'Exportación fallida' end,
    'Procesando',v_error);
  return jsonb_build_object('ok',true,'export_id',v_export.id,'status',case when p_uncertain then 'Incierta' else 'Fallida' end,
    'retry_blocked',p_uncertain,'published',false);
end $$;

create or replace function public.registrar_master_postproduccion(
  p_export_id bigint,p_lease_token uuid,p jsonb
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_export public.agency_postproduction_exports%rowtype; v_object storage.objects%rowtype; v_actor text;
  v_path text:=btrim(coalesce(p->>'storage_path','')); v_hash text:=lower(btrim(coalesce(p->>'content_hash','')));
  v_probe jsonb:=coalesce(p->'technical_probe','{}'::jsonb); v_spec jsonb; v_size bigint; v_asset bigint;
  v_result jsonb; v_result_fp text; v_duration numeric;
begin
  select * into v_export from public.agency_postproduction_exports where id=p_export_id for update;
  if v_export.id is null or v_export.status<>'Procesando' or v_export.lease_token<>p_lease_token then
    raise exception 'La exportación no está procesando con este lease.';
  end if;
  v_spec:=v_export.export_snapshot->'export_spec';
  if v_export.export_fingerprint<>public._agency_mesa_fingerprint(v_export.export_snapshot) then raise exception 'El contrato de exportación perdió integridad.'; end if;
  if v_path='' or v_path like '/%' or v_path~'(^|/)\.\.(/|$)' or v_path not like 'exports/'||v_export.id::text||'/%'
     or v_hash!~'^[0-9a-f]{64}$' then raise exception 'Ruta o huella del máster inválida.'; end if;
  select * into v_object from storage.objects where bucket_id='brand-assets' and name=v_path;
  if v_object.id is null then raise exception 'El archivo exportado no existe en Storage.'; end if;
  v_size:=coalesce(nullif(v_object.metadata->>'size','')::bigint,nullif(p->>'size_bytes','')::bigint,0);
  if coalesce(v_object.metadata->>'mimetype',p->>'mime_type')<>'video/mp4' or v_size<=0
     or v_size>(v_spec->>'max_size_bytes')::bigint then raise exception 'El archivo real no cumple tipo o tamaño autorizado.'; end if;
  v_duration:=coalesce(nullif(v_probe->>'duration_seconds','')::numeric,0);
  if jsonb_typeof(v_probe)<>'object' or (v_probe->>'width')::integer<>(v_spec->>'width')::integer
     or (v_probe->>'height')::integer<>(v_spec->>'height')::integer or (v_probe->>'fps')::integer<>(v_spec->>'fps')::integer
     or lower(v_probe->>'video_codec')<>(v_spec->>'video_codec') or lower(v_probe->>'audio_codec')<>(v_spec->>'audio_codec')
     or lower(v_probe->>'color_space')<>(v_spec->>'color_space') or v_duration<=0 or v_duration>300
     or coalesce((v_probe->>'loudness_lufs')::numeric,0) not between -24 and -9 then
    raise exception 'El probe técnico no coincide con el contrato sellado.';
  end if;
  select prepared_by into v_actor from public.agency_postproduction_packages where id=v_export.package_id;
  insert into public.brand_media_assets(name,media_type,source,orientation,contains_people,rights_status,ai_use_allowed,
    allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,width,height,duration_seconds,tags,notes,generation_meta,created_by)
  values(coalesce(nullif(btrim(p->>'name'),''),'Máster MOMOS · exportación '||v_export.id),'Video','Generado',
    case when v_spec->>'aspect_ratio'='9:16' then 'Vertical' when v_spec->>'aspect_ratio'='16:9' then 'Horizontal'
      when v_spec->>'aspect_ratio'='1:1' then 'Cuadrado' else 'Vertical' end,false,'Autorizado',false,
    jsonb_build_array(coalesce(v_export.export_snapshot->>'channel','Postproducción')),'Activo',v_path,v_hash,'video/mp4',v_size,
    (v_probe->>'width')::integer,(v_probe->>'height')::integer,v_duration,jsonb_build_array('master','postproduccion','qc-pendiente'),
    'Máster exportado; requiere control técnico humano antes de Distribución.',
    jsonb_build_object('postproduction_export_id',v_export.id,'package_id',v_export.package_id,
      'export_fingerprint',v_export.export_fingerprint,'technical_probe',v_probe,'needs_human_qc',true),v_actor)
  returning id into v_asset;
  v_result:=jsonb_build_object('schema_version',1,'output_asset_id',v_asset,'storage_path',v_path,'content_hash',v_hash,
    'size_bytes',v_size,'technical_probe',v_probe,'publication_authorized',false,'distribution_authorized',false);
  v_result_fp:=public._agency_mesa_fingerprint(v_result);
  update public.agency_postproduction_exports set status='Exportada',output_asset_id=v_asset,result_snapshot=v_result,
    result_fingerprint=v_result_fp,exported_at=now(),lease_expires_at=null,error_message='' where id=v_export.id;
  perform public._add_audit('Exportación Agencia',v_export.id::text,'Máster real registrado','Procesando','Activo '||v_asset::text||' · QC pendiente');
  return jsonb_build_object('ok',true,'export_id',v_export.id,'asset_id',v_asset,'status','Exportada',
    'requires_human_qc',true,'published',false,'distributed',false);
end $$;

create or replace function public.resolver_control_master_postproduccion(
  p_export_id bigint,p_decision text,p_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_export public.agency_postproduction_exports%rowtype;
  v_asset public.brand_media_assets%rowtype; v_spec jsonb; v_probe jsonb; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor(); select * into v_export from public.agency_postproduction_exports where id=p_export_id for update;
  if v_export.id is null or v_export.status<>'Exportada' or length(v_note)<5 then raise exception 'El máster no espera control o falta explicación.'; end if;
  select * into v_asset from public.brand_media_assets where id=v_export.output_asset_id and status='Activo' and rights_status='Autorizado';
  if v_asset.id is null or v_export.result_fingerprint<>public._agency_mesa_fingerprint(v_export.result_snapshot)
     or v_asset.content_hash<>v_export.result_snapshot->>'content_hash' then raise exception 'El máster o su resultado perdió integridad.'; end if;
  v_spec:=v_export.export_snapshot->'export_spec'; v_probe:=v_export.result_snapshot->'technical_probe';
  if p_decision='Aprobar' then
    if v_asset.mime_type<>'video/mp4' or v_asset.width<>(v_spec->>'width')::integer or v_asset.height<>(v_spec->>'height')::integer
       or (v_probe->>'fps')::integer<>(v_spec->>'fps')::integer or lower(v_probe->>'video_codec')<>'h264'
       or lower(v_probe->>'audio_codec')<>'aac' or lower(v_probe->>'color_space')<>'bt709' then
      raise exception 'El máster no supera el control técnico final.';
    end if;
    update public.agency_postproduction_exports set status='Aprobada',reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_export.id;
  elsif p_decision='Rechazar' then
    update public.agency_postproduction_exports set status='Rechazada',reviewed_by=v_actor.id,reviewed_at=now(),review_note=v_note where id=v_export.id;
  else raise exception 'La decisión debe ser Aprobar o Rechazar.'; end if;
  perform public._add_audit('Exportación Agencia',v_export.id::text,'Control técnico humano','Exportada',p_decision||' · '||v_note);
  return jsonb_build_object('ok',true,'export_id',v_export.id,'asset_id',v_asset.id,
    'status',case when p_decision='Aprobar' then 'Aprobada' else 'Rechazada' end,'published',false,'distributed',false);
end $$;

create or replace function public.reintentar_exportacion_postproduccion(p_export_id bigint,p_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_export public.agency_postproduction_exports%rowtype; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_actor(); select * into v_export from public.agency_postproduction_exports where id=p_export_id for update;
  if v_export.id is null or v_export.status<>'Fallida' or v_export.output_asset_id is not null or length(v_note)<5 then
    raise exception 'Solo un fallo definitivo y sin salida puede reintentarse con explicación.';
  end if;
  if v_export.attempts>=3 then raise exception 'La exportación alcanzó el máximo de intentos; prepará una versión nueva.'; end if;
  update public.agency_postproduction_exports set status='Autorizada',worker_id='',lease_token=null,leased_at=null,
    lease_expires_at=null,error_message='' where id=v_export.id;
  perform public._add_audit('Exportación Agencia',v_export.id::text,'Reintento humano autorizado','Fallida',v_note);
  return jsonb_build_object('ok',true,'export_id',v_export.id,'status','Autorizada','published',false);
end $$;

create or replace function public.reportar_worker_postproduccion(
  p_worker_id text,p_version text,p_status text,p_ffmpeg_available boolean,p_ffmpeg_version text default '',p_error text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if length(btrim(coalesce(p_worker_id,'')))<3 or length(btrim(coalesce(p_version,'')))<2
     or p_status not in ('Disponible','Bloqueado','Con error') then raise exception 'Salud del worker inválida.'; end if;
  insert into public.agency_postproduction_worker_health(worker_id,version,status,ffmpeg_available,ffmpeg_version,last_error,heartbeat_at)
  values(left(btrim(p_worker_id),160),left(btrim(p_version),100),p_status,coalesce(p_ffmpeg_available,false),
    left(btrim(coalesce(p_ffmpeg_version,'')),240),left(btrim(coalesce(p_error,'')),600),now())
  on conflict(worker_id) do update set version=excluded.version,status=excluded.status,ffmpeg_available=excluded.ffmpeg_available,
    ffmpeg_version=excluded.ffmpeg_version,last_error=excluded.last_error,heartbeat_at=now();
  return jsonb_build_object('ok',true,'status',p_status,'ffmpeg_available',coalesce(p_ffmpeg_available,false));
end $$;

revoke all on function public.postproduccion_exportacion_disponible() from public,anon;
revoke all on function public._agency_export_spec_valid(jsonb) from public,anon,authenticated;
revoke all on function public._agency_postproduction_export_immutable() from public,anon,authenticated;
revoke all on function public.autorizar_exportacion_postproduccion(jsonb) from public,anon;
revoke all on function public.reclamar_exportacion_postproduccion(text,integer) from public,anon,authenticated;
revoke all on function public.fallar_exportacion_postproduccion(bigint,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.registrar_master_postproduccion(bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.resolver_control_master_postproduccion(bigint,text,text) from public,anon;
revoke all on function public.reintentar_exportacion_postproduccion(bigint,text) from public,anon;
revoke all on function public.reportar_worker_postproduccion(text,text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.postproduccion_exportacion_disponible() to authenticated;
grant execute on function public.autorizar_exportacion_postproduccion(jsonb) to authenticated;
grant execute on function public.resolver_control_master_postproduccion(bigint,text,text) to authenticated;
grant execute on function public.reintentar_exportacion_postproduccion(bigint,text) to authenticated;
grant execute on function public.reclamar_exportacion_postproduccion(text,integer) to service_role;
grant execute on function public.fallar_exportacion_postproduccion(bigint,uuid,text,boolean) to service_role;
grant execute on function public.registrar_master_postproduccion(bigint,uuid,jsonb) to service_role;
grant execute on function public.reportar_worker_postproduccion(text,text,text,boolean,text,text) to service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_47_postproduccion_exportacion','Cola privada de exportación, máster real, probe técnico, control humano y cero publicación')
on conflict(id) do update set detalle=excluded.detalle;

notify pgrst, 'reload schema';
commit;
