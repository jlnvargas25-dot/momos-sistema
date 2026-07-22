-- MOMOS OPS · Biblioteca Inteligente de Marca + Estudio Creativo v1.
-- Paso 20, después de Distribución Comercial. Los originales son privados,
-- inmutables desde el cliente y cada uso queda ligado a un trabajo creativo.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260714'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260715_19_distribucion_comercial'
  ) then raise exception 'Falta el paso 19_distribucion_comercial.'; end if;
  if to_regclass('storage.objects') is null then raise exception 'Falta Storage; no se puede proteger la biblioteca de marca.'; end if;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('brand-assets','brand-assets',false,104857600,array[
  'image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm',
  'audio/mpeg','audio/mp4','audio/wav','application/pdf'
])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.brand_media_assets(
  id bigint generated always as identity primary key,
  name text not null check(length(btrim(name))>=3),
  media_type text not null check(media_type in ('Foto','Video','Audio','Logo','Diseño')),
  source text not null default 'MOMOS' check(source in ('MOMOS','Cliente','Generado','Proveedor')),
  product_id text references public.products(id) on delete set null,
  figure text not null default '', flavor text not null default '', shot_type text not null default '',
  orientation text not null default 'Vertical' check(orientation in ('Vertical','Horizontal','Cuadrado','Audio','Documento')),
  contains_people boolean not null default false,
  rights_status text not null default 'Propio' check(rights_status in ('Propio','Autorizado','Por verificar','Restringido')),
  rights_expires_at date,
  ai_use_allowed boolean not null default true,
  allowed_channels jsonb not null default '[]'::jsonb check(jsonb_typeof(allowed_channels)='array'),
  status text not null default 'Activo' check(status in ('Activo','Archivado','Bloqueado')),
  storage_path text not null unique check(storage_path!~'(^|/)\.\.(/|$)' and storage_path!~'^/'),
  content_hash text not null unique check(content_hash~'^[0-9a-f]{64}$'),
  mime_type text not null, size_bytes bigint not null check(size_bytes>0 and size_bytes<=104857600),
  width integer check(width is null or width>0), height integer check(height is null or height>0),
  duration_seconds numeric check(duration_seconds is null or duration_seconds>=0),
  tags jsonb not null default '[]'::jsonb check(jsonb_typeof(tags)='array'),
  notes text not null default '', original_asset_id bigint references public.brand_media_assets(id) on delete set null,
  generation_meta jsonb not null default '{}'::jsonb check(jsonb_typeof(generation_meta)='object'),
  created_by text not null references public.users(id), created_at timestamptz not null default now(),
  archived_by text references public.users(id), archived_at timestamptz
);
create index if not exists brand_media_assets_active_idx on public.brand_media_assets(status,media_type,created_at desc);
create index if not exists brand_media_assets_product_idx on public.brand_media_assets(product_id,status);

create table if not exists public.creative_generation_jobs(
  id bigint generated always as identity primary key,
  creative_id text references public.creatives(id) on delete set null,
  brief_id bigint references public.agency_briefs(id) on delete set null,
  provider text not null default 'Por conectar',
  operation text not null check(operation in ('Componer','Editar','Adaptar','Generar imagen','Generar video')),
  status text not null default 'Preparado' check(status in ('Borrador','Preparado','En generación','Completado','Fallido','Cancelado')),
  input_asset_ids jsonb not null default '[]'::jsonb check(jsonb_typeof(input_asset_ids)='array'),
  target_channel text not null default 'Instagram', target_format text not null,
  prompt text not null, negative_prompt text not null default '',
  brand_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(brand_snapshot)='object'),
  output_spec jsonb not null default '{}'::jsonb check(jsonb_typeof(output_spec)='object'),
  provider_job_id text unique, output_asset_id bigint references public.brand_media_assets(id) on delete set null,
  generation_cost numeric not null default 0 check(generation_cost>=0), error_message text not null default '',
  created_by text not null references public.users(id), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists creative_generation_jobs_status_idx on public.creative_generation_jobs(status,created_at desc);

create table if not exists public.brand_media_usages(
  id bigint generated always as identity primary key,
  asset_id bigint not null references public.brand_media_assets(id) on delete restrict,
  job_id bigint references public.creative_generation_jobs(id) on delete cascade,
  creative_version_id bigint references public.agency_creative_versions(id) on delete set null,
  role text not null default 'Apoyo' check(role in ('Principal','Apoyo','Logo','Audio','Referencia')),
  start_second numeric check(start_second is null or start_second>=0),
  end_second numeric check(end_second is null or end_second>=coalesce(start_second,0)),
  created_by text not null references public.users(id), created_at timestamptz not null default now(),
  check(job_id is not null or creative_version_id is not null),
  unique(asset_id,job_id,creative_version_id)
);

alter table public.brand_media_assets enable row level security;
alter table public.creative_generation_jobs enable row level security;
alter table public.brand_media_usages enable row level security;
drop policy if exists staff_read on public.brand_media_assets;
drop policy if exists staff_read on public.creative_generation_jobs;
drop policy if exists staff_read on public.brand_media_usages;
create policy staff_read on public.brand_media_assets for select to authenticated using(public.is_staff());
create policy staff_read on public.creative_generation_jobs for select to authenticated using(public.is_staff());
create policy staff_read on public.brand_media_usages for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.brand_media_assets,public.creative_generation_jobs,public.brand_media_usages from anon,authenticated;
grant select on public.brand_media_assets,public.creative_generation_jobs,public.brand_media_usages to authenticated;

drop policy if exists brand_assets_staff_read on storage.objects;
drop policy if exists brand_assets_owner_insert on storage.objects;
drop policy if exists brand_assets_unregistered_cleanup on storage.objects;
create policy brand_assets_staff_read on storage.objects for select to authenticated
  using(bucket_id='brand-assets' and public.is_staff());
create policy brand_assets_owner_insert on storage.objects for insert to authenticated
  with check(bucket_id='brand-assets' and name like auth.uid()::text||'/%'
    and public.current_rol() in ('Administrador','Marketing/CRM'));
create policy brand_assets_unregistered_cleanup on storage.objects for delete to authenticated
  using(bucket_id='brand-assets' and name like auth.uid()::text||'/%'
    and not exists(select 1 from public.brand_media_assets a where a.storage_path=storage.objects.name)
    and public.current_rol() in ('Administrador','Marketing/CRM'));

create or replace function public.biblioteca_creativa_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._brand_actor() returns public.users
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  v_actor:=public._agency_actor();
  return v_actor;
end $$;

create or replace function public.registrar_activo_marca(p jsonb) returns jsonb
language plpgsql security definer set search_path=public,storage as $$
declare
  v_actor public.users%rowtype; v_id bigint; v_path text:=btrim(coalesce(p->>'storage_path',''));
  v_hash text:=lower(btrim(coalesce(p->>'content_hash',''))); v_type text:=p->>'media_type';
  v_rights text:=coalesce(nullif(p->>'rights_status',''),'Propio'); v_people boolean:=coalesce((p->>'contains_people')::boolean,false);
  v_ai boolean:=coalesce((p->>'ai_use_allowed')::boolean,true); v_object storage.objects%rowtype;
  v_mime text; v_size bigint;
begin
  v_actor:=public._brand_actor();
  if v_path='' or v_path not like auth.uid()::text||'/%' or v_path like '/%' or v_path~'(^|/)\.\.(/|$)' then raise exception 'Ruta de activo inválida.'; end if;
  if v_hash!~'^[0-9a-f]{64}$' then raise exception 'La huella digital del archivo es inválida.'; end if;
  if v_type not in ('Foto','Video','Audio','Logo','Diseño') then raise exception 'Tipo de activo inválido.'; end if;
  if v_rights not in ('Propio','Autorizado','Por verificar','Restringido') then raise exception 'Estado de derechos inválido.'; end if;
  select * into v_object from storage.objects where bucket_id='brand-assets' and name=v_path;
  if v_object.id is null then raise exception 'El archivo original no existe en Storage.'; end if;
  v_mime:=coalesce(nullif(v_object.metadata->>'mimetype',''),nullif(p->>'mime_type',''),'application/octet-stream');
  v_size:=coalesce(nullif(v_object.metadata->>'size','')::bigint,nullif(p->>'size_bytes','')::bigint,0);
  if v_size<=0 or v_size>104857600 then raise exception 'El tamaño real del archivo no está permitido.'; end if;
  if (v_type in ('Foto','Logo') and v_mime not like 'image/%')
     or (v_type='Video' and v_mime not like 'video/%')
     or (v_type='Audio' and v_mime not like 'audio/%')
     or (v_type='Diseño' and v_mime not like 'image/%' and v_mime<>'application/pdf') then
    raise exception 'El tipo % no coincide con el archivo real %.',v_type,v_mime;
  end if;
  if exists(select 1 from public.brand_media_assets where content_hash=v_hash) then raise exception 'Este archivo ya existe en la biblioteca.'; end if;
  if exists(select 1 from public.brand_media_assets where storage_path=v_path) then raise exception 'Esta ruta ya fue registrada.'; end if;
  if v_people and v_rights<>'Autorizado' then v_ai:=false; end if;
  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,contains_people,
    rights_status,rights_expires_at,ai_use_allowed,allowed_channels,storage_path,content_hash,mime_type,size_bytes,width,height,
    duration_seconds,tags,notes,original_asset_id,generation_meta,created_by)
  values(btrim(coalesce(p->>'name','')),v_type,coalesce(nullif(p->>'source',''),'MOMOS'),nullif(p->>'product_id',''),
    coalesce(p->>'figure',''),coalesce(p->>'flavor',''),coalesce(p->>'shot_type',''),coalesce(nullif(p->>'orientation',''),'Vertical'),v_people,
    v_rights,nullif(p->>'rights_expires_at','')::date,v_ai,coalesce(p->'allowed_channels','[]'::jsonb),v_path,v_hash,
    v_mime,v_size,nullif(p->>'width','')::integer,
    nullif(p->>'height','')::integer,nullif(p->>'duration_seconds','')::numeric,coalesce(p->'tags','[]'::jsonb),coalesce(p->>'notes',''),
    nullif(p->>'original_asset_id','')::bigint,coalesce(p->'generation_meta','{}'::jsonb),v_actor.id)
  returning id into v_id;
  perform public._add_audit('Biblioteca marca',v_id::text,'Activo original registrado','',v_type||' · '||coalesce(p->>'name',''));
  return jsonb_build_object('ok',true,'asset_id',v_id,'ai_use_allowed',v_ai);
end $$;

create or replace function public.archivar_activo_marca(p_asset_id bigint,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_asset public.brand_media_assets%rowtype;
begin
  v_actor:=public._brand_actor(); select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null then raise exception 'El activo no existe.'; end if;
  if v_asset.status<>'Activo' then raise exception 'El activo ya no está activo.'; end if;
  if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Indicá por qué se archiva el activo.'; end if;
  update public.brand_media_assets set status='Archivado',archived_by=v_actor.id,archived_at=now(),
    notes=concat_ws(E'\n',nullif(notes,''),'Archivado: '||btrim(p_reason)) where id=p_asset_id;
  perform public._add_audit('Biblioteca marca',p_asset_id::text,'Activo archivado','Activo','Archivado · '||btrim(p_reason));
  return jsonb_build_object('ok',true,'asset_id',p_asset_id,'status','Archivado');
end $$;

create or replace function public.crear_trabajo_creativo(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_id bigint; v_creative text:=nullif(p->>'creative_id','');
  v_brief bigint:=nullif(p->>'brief_id','')::bigint; v_operation text:=p->>'operation'; v_assets jsonb:=coalesce(p->'input_asset_ids','[]'::jsonb);
  v_asset_id bigint; v_asset public.brand_media_assets%rowtype; v_product text; v_has_product boolean:=false; v_brand jsonb;
  v_format text:=btrim(coalesce(p->>'target_format','')); v_prompt text:=btrim(coalesce(p->>'prompt',''));
begin
  v_actor:=public._brand_actor();
  if v_creative is null and v_brief is null then raise exception 'El trabajo necesita un creativo o brief.'; end if;
  if v_creative is not null and not exists(select 1 from public.creatives where id=v_creative) then raise exception 'El creativo no existe.'; end if;
  if v_brief is not null and not exists(select 1 from public.agency_briefs where id=v_brief) then raise exception 'El brief no existe.'; end if;
  if v_operation not in ('Componer','Editar','Adaptar','Generar imagen','Generar video') then raise exception 'Operación creativa inválida.'; end if;
  if jsonb_typeof(v_assets)<>'array' then raise exception 'Los activos de entrada son inválidos.'; end if;
  if (select count(*)<>count(distinct value) from jsonb_array_elements_text(v_assets)) then raise exception 'Un activo no puede repetirse en el mismo trabajo.'; end if;
  if v_format not in ('Reel 9:16','Historia 9:16','TikTok 9:16','Post 4:5','Cuadrado 1:1','WhatsApp 4:5') then raise exception 'Formato de salida inválido.'; end if;
  if length(v_prompt)<12 then raise exception 'El trabajo necesita un prompt suficientemente claro.'; end if;
  if v_operation in ('Componer','Editar','Adaptar') and jsonb_array_length(v_assets)=0 then raise exception 'La operación necesita archivos reales de la biblioteca.'; end if;
  v_product:=coalesce((select producto_foco_id from public.creatives where id=v_creative),(select product_id from public.agency_briefs where id=v_brief));
  for v_asset_id in select value::text::bigint from jsonb_array_elements(v_assets) loop
    select * into v_asset from public.brand_media_assets where id=v_asset_id;
    if v_asset.id is null then raise exception 'Un activo seleccionado ya no existe.'; end if;
    if v_asset.status<>'Activo' or v_asset.rights_status not in ('Propio','Autorizado') or v_asset.ai_use_allowed is not true
       or (v_asset.rights_expires_at is not null and v_asset.rights_expires_at<current_date)
       or (v_asset.contains_people and v_asset.rights_status<>'Autorizado') then
      raise exception 'El activo % no tiene permisos vigentes para IA.',v_asset_id;
    end if;
    if v_product is not null and v_asset.product_id=v_product then v_has_product:=true; end if;
  end loop;
  if v_product is not null and not v_has_product then
    raise exception 'Falta una toma real del producto foco.';
  end if;
  select jsonb_build_object('frases',frases,'tono',tono,'palabras_si',palabras_si,'palabras_no',palabras_no)
    into v_brand from public.brand_library where id;
  insert into public.creative_generation_jobs(creative_id,brief_id,provider,operation,status,input_asset_ids,target_channel,target_format,
    prompt,negative_prompt,brand_snapshot,output_spec,created_by)
  values(v_creative,v_brief,coalesce(nullif(p->>'provider',''),'Por conectar'),v_operation,'Preparado',v_assets,
    coalesce(nullif(p->>'target_channel',''),'Instagram'),v_format,
    v_prompt,coalesce(p->>'negative_prompt',''),coalesce(v_brand,'{}'::jsonb),
    coalesce(p->'output_spec','{}'::jsonb)||jsonb_build_object('output_mode','new_asset'),v_actor.id)
  returning id into v_id;
  for v_asset_id in select value::text::bigint from jsonb_array_elements(v_assets) loop
    insert into public.brand_media_usages(asset_id,job_id,role,created_by)
    values(v_asset_id,v_id,case when not exists(select 1 from public.brand_media_usages where job_id=v_id) then 'Principal' else 'Apoyo' end,v_actor.id);
  end loop;
  perform public._add_audit('Estudio creativo',v_id::text,'Trabajo preparado','',v_operation||' · '||v_format);
  return jsonb_build_object('ok',true,'job_id',v_id,'status','Preparado');
end $$;

revoke all on function public.biblioteca_creativa_disponible() from public,anon;
revoke all on function public._brand_actor() from public,anon,authenticated;
revoke all on function public.registrar_activo_marca(jsonb) from public,anon;
revoke all on function public.archivar_activo_marca(bigint,text) from public,anon;
revoke all on function public.crear_trabajo_creativo(jsonb) from public,anon;
grant execute on function public.biblioteca_creativa_disponible() to authenticated;
grant execute on function public.registrar_activo_marca(jsonb) to authenticated;
grant execute on function public.archivar_activo_marca(bigint,text) to authenticated;
grant execute on function public.crear_trabajo_creativo(jsonb) to authenticated;

do $$ declare v_table text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['brand_media_assets','creative_generation_jobs','brand_media_usages'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260715_20_biblioteca_creativa','Originales privados, derechos y consentimiento, composiciones trazables y trabajos de generación desacoplados')
on conflict(id) do update set detalle=excluded.detalle;

commit;
