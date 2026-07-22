-- MOMOS OPS · reingreso seguro de archivos eliminados v1.
-- Una lápida conserva la auditoría, pero no debe reservar para siempre la huella
-- de un objeto que ya no existe en Storage. Los duplicados vigentes siguen
-- bloqueados y el alta se serializa por SHA-256 para cerrar carreras concurrentes.
begin;

do $$
begin
  if not exists(
    select 1 from public.momos_ops_migrations
    where id='20260717_56_data_sync_rendimiento'
  ) then
    raise exception 'Falta el paso 56_data_sync_rendimiento.';
  end if;
  if to_regclass('public.brand_media_assets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Falta Biblioteca o Storage.';
  end if;
end $$;

-- La unicidad original incluía también lápidas con status Eliminado. Se conserva
-- la misma protección para cualquier archivo utilizable o eliminación en curso.
alter table public.brand_media_assets
  drop constraint if exists brand_media_assets_content_hash_key;

drop index if exists public.brand_media_assets_live_content_hash_uidx;
create unique index brand_media_assets_live_content_hash_uidx
  on public.brand_media_assets(content_hash)
  where status <> 'Eliminado';

create or replace function public.reingreso_archivo_eliminado_disponible() returns boolean
language sql stable security definer set search_path=public
as $$ select true $$;

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
  if v_path='' or v_path not like auth.uid()::text||'/%' or v_path like '/%' or v_path~'(^|/)\.\.(/|$)' then
    raise exception 'Ruta de activo inválida.';
  end if;
  if v_hash!~'^[0-9a-f]{64}$' then raise exception 'La huella digital del archivo es inválida.'; end if;
  if v_type not in ('Foto','Video','Audio','Logo','Diseño') then raise exception 'Tipo de activo inválido.'; end if;
  if v_rights not in ('Propio','Autorizado','Por verificar','Restringido') then raise exception 'Estado de derechos inválido.'; end if;

  -- Dos sesiones que intenten registrar el mismo contenido se resuelven en orden.
  -- La segunda verá el activo de la primera y recibirá el mensaje de duplicado.
  perform pg_advisory_xact_lock(hashtext('momos:brand-media:'||v_hash));

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
  if exists(
    select 1 from public.brand_media_assets
    where content_hash=v_hash and status<>'Eliminado'
  ) then
    raise exception 'Este archivo ya existe en la biblioteca.';
  end if;
  if exists(select 1 from public.brand_media_assets where storage_path=v_path) then
    raise exception 'Esta ruta ya fue registrada.';
  end if;
  if v_people and v_rights<>'Autorizado' then v_ai:=false; end if;

  insert into public.brand_media_assets(name,media_type,source,product_id,figure,flavor,shot_type,orientation,contains_people,
    rights_status,rights_expires_at,ai_use_allowed,allowed_channels,storage_path,content_hash,mime_type,size_bytes,width,height,
    duration_seconds,tags,notes,original_asset_id,generation_meta,created_by)
  values(btrim(coalesce(p->>'name','')),v_type,coalesce(nullif(p->>'source',''),'MOMOS'),nullif(p->>'product_id',''),
    coalesce(p->>'figure',''),coalesce(p->>'flavor',''),coalesce(p->>'shot_type',''),coalesce(nullif(p->>'orientation',''),'Vertical'),v_people,
    v_rights,nullif(p->>'rights_expires_at','')::date,v_ai,coalesce(p->'allowed_channels','[]'::jsonb),v_path,v_hash,
    v_mime,v_size,nullif(p->>'width','')::integer,nullif(p->>'height','')::integer,
    nullif(p->>'duration_seconds','')::numeric,coalesce(p->'tags','[]'::jsonb),coalesce(p->>'notes',''),
    nullif(p->>'original_asset_id','')::bigint,coalesce(p->'generation_meta','{}'::jsonb),v_actor.id)
  returning id into v_id;

  perform public._add_audit('Biblioteca marca',v_id::text,'Activo original registrado','',
    v_type||' · '||coalesce(p->>'name',''));
  return jsonb_build_object('ok',true,'asset_id',v_id,'ai_use_allowed',v_ai);
end $$;

revoke all on function public.reingreso_archivo_eliminado_disponible() from public,anon;
grant execute on function public.reingreso_archivo_eliminado_disponible() to authenticated,service_role;
revoke all on function public.registrar_activo_marca(jsonb) from public,anon;
grant execute on function public.registrar_activo_marca(jsonb) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260717_57_reingreso_archivo_eliminado',
  'Reingreso del mismo archivo tras eliminación real, duplicados vigentes bloqueados y alta serializada por SHA-256')
on conflict(id) do update set detalle=excluded.detalle;

commit;
