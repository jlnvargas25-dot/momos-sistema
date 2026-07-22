-- MOMOS OPS · edición segura de metadatos de Biblioteca v1.
-- El original, su SHA-256, formato, procedencia y ruta permanecen inmutables.
-- Las correcciones de catálogo quedan versionadas y los activos ya utilizados
-- solo admiten cambios descriptivos que no reescriban la historia creativa.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260718'));

do $$
begin
  if not exists(
    select 1 from public.momos_ops_migrations
    where id='20260717_57_reingreso_archivo_eliminado'
  ) then
    raise exception 'Falta el paso 57_reingreso_archivo_eliminado.';
  end if;
  if to_regclass('public.brand_media_assets') is null then
    raise exception 'Falta Biblioteca Creativa.';
  end if;
end $$;

create table if not exists public.brand_media_asset_metadata_versions(
  id bigint generated always as identity primary key,
  asset_id bigint not null references public.brand_media_assets(id) on delete restrict,
  version integer not null check(version>0),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  fingerprint text not null check(fingerprint~'^[0-9a-f]{32}$'),
  change_note text not null default '' check(length(change_note)<=240),
  changed_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  unique(asset_id,version)
);

create index if not exists brand_media_asset_metadata_versions_asset_idx
  on public.brand_media_asset_metadata_versions(asset_id,version desc);

alter table public.brand_media_asset_metadata_versions enable row level security;
drop policy if exists staff_read on public.brand_media_asset_metadata_versions;
create policy staff_read on public.brand_media_asset_metadata_versions
  for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.brand_media_asset_metadata_versions from anon,authenticated;
grant select on public.brand_media_asset_metadata_versions to authenticated;

-- Conserva como versión 1 el estado que existía antes de habilitar la edición.
insert into public.brand_media_asset_metadata_versions(
  asset_id,version,snapshot,fingerprint,change_note,changed_by,created_at
)
select a.id,1,s.snapshot,md5(s.snapshot::text),'Estado inicial antes de habilitar edición',a.created_by,a.created_at
from public.brand_media_assets a
cross join lateral (
  select jsonb_build_object(
    'name',a.name,
    'collection',case
      when a.tags ? 'momos:producto'
        or (not (a.tags ? 'momos:marca') and (a.product_id is not null or a.figure<>'' or a.flavor<>''))
        then 'Productos' else 'Marca' end,
    'product_id',a.product_id,'figure',a.figure,'flavor',a.flavor,'shot_type',a.shot_type,
    'orientation',a.orientation,'contains_people',a.contains_people,
    'rights_status',a.rights_status,'rights_expires_at',a.rights_expires_at,
    'ai_use_allowed',a.ai_use_allowed,'tags',a.tags,'notes',a.notes
  ) snapshot
) s
where a.status<>'Eliminado'
on conflict(asset_id,version) do nothing;

create or replace function public._brand_media_asset_initial_metadata_version() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_collection text; v_snapshot jsonb;
begin
  if new.status='Eliminado' then return new; end if;
  v_collection:=case
    when new.tags ? 'momos:producto'
      or (not (new.tags ? 'momos:marca') and (new.product_id is not null or new.figure<>'' or new.flavor<>''))
      then 'Productos' else 'Marca' end;
  v_snapshot:=jsonb_build_object(
    'name',new.name,'collection',v_collection,'product_id',new.product_id,
    'figure',new.figure,'flavor',new.flavor,'shot_type',new.shot_type,
    'orientation',new.orientation,'contains_people',new.contains_people,
    'rights_status',new.rights_status,'rights_expires_at',new.rights_expires_at,
    'ai_use_allowed',new.ai_use_allowed,'tags',new.tags,'notes',new.notes
  );
  insert into public.brand_media_asset_metadata_versions(
    asset_id,version,snapshot,fingerprint,change_note,changed_by,created_at
  ) values(new.id,1,v_snapshot,md5(v_snapshot::text),'Metadatos del ingreso original',new.created_by,new.created_at)
  on conflict(asset_id,version) do nothing;
  return new;
end $$;

drop trigger if exists brand_media_asset_initial_metadata_version on public.brand_media_assets;
create trigger brand_media_asset_initial_metadata_version
after insert on public.brand_media_assets
for each row execute function public._brand_media_asset_initial_metadata_version();

create or replace function public.edicion_biblioteca_disponible() returns boolean
language sql stable security definer set search_path=public
as $$ select true $$;

create or replace function public.actualizar_metadatos_activo_marca(p_asset_id bigint,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_asset public.brand_media_assets%rowtype;
  v_name text; v_collection text; v_current_collection text; v_product text;
  v_figure text; v_flavor text; v_shot text; v_orientation text;
  v_people boolean; v_rights text; v_expiry date; v_ai boolean;
  v_tags jsonb:='[]'::jsonb; v_notes text; v_tag text; v_marker text;
  v_locked boolean; v_reasons text[]; v_semantic_changed boolean; v_snapshot jsonb; v_version integer;
begin
  v_actor:=public._brand_actor();
  if p is null or jsonb_typeof(p)<>'object' then raise exception 'Los metadatos no son válidos.'; end if;
  if exists(
    select 1 from jsonb_object_keys(p) as item(key)
    where item.key<>all(array['name','collection','product_id','figure','flavor','shot_type','orientation',
      'contains_people','rights_status','rights_expires_at','ai_use_allowed','tags','notes'])
  ) then
    raise exception 'La edición contiene campos inmutables o desconocidos.';
  end if;

  select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null then raise exception 'El archivo no existe.'; end if;
  if v_asset.status not in ('Activo','Archivado','Bloqueado') then
    raise exception 'El archivo está eliminado o tiene una eliminación en curso.';
  end if;

  v_current_collection:=case
    when v_asset.tags ? 'momos:producto'
      or (not (v_asset.tags ? 'momos:marca') and (v_asset.product_id is not null or v_asset.figure<>'' or v_asset.flavor<>''))
      then 'Productos' else 'Marca' end;
  v_name:=btrim(case when p ? 'name' then coalesce(p->>'name','') else v_asset.name end);
  v_collection:=case when p ? 'collection' then btrim(coalesce(p->>'collection','')) else v_current_collection end;
  v_product:=case when p ? 'product_id' then nullif(btrim(coalesce(p->>'product_id','')),'') else v_asset.product_id end;
  v_figure:=btrim(case when p ? 'figure' then coalesce(p->>'figure','') else v_asset.figure end);
  v_flavor:=btrim(case when p ? 'flavor' then coalesce(p->>'flavor','') else v_asset.flavor end);
  v_shot:=btrim(case when p ? 'shot_type' then coalesce(p->>'shot_type','') else v_asset.shot_type end);
  v_orientation:=btrim(case when p ? 'orientation' then coalesce(p->>'orientation','') else v_asset.orientation end);
  v_people:=case when p ? 'contains_people' then (p->>'contains_people')::boolean else v_asset.contains_people end;
  v_rights:=btrim(case when p ? 'rights_status' then coalesce(p->>'rights_status','') else v_asset.rights_status end);
  v_expiry:=case when p ? 'rights_expires_at' then nullif(p->>'rights_expires_at','')::date else v_asset.rights_expires_at end;
  v_ai:=case when p ? 'ai_use_allowed' then (p->>'ai_use_allowed')::boolean else v_asset.ai_use_allowed end;
  v_notes:=case when p ? 'notes' then btrim(coalesce(p->>'notes','')) else v_asset.notes end;

  if length(v_name) not between 3 and 160 then raise exception 'El nombre debe tener entre 3 y 160 caracteres.'; end if;
  if v_collection not in ('Marca','Productos') then raise exception 'La colección no es válida.'; end if;
  if v_orientation not in ('Vertical','Horizontal','Cuadrado','Audio','Documento') then raise exception 'La orientación no es válida.'; end if;
  if v_rights not in ('Propio','Autorizado','Por verificar','Restringido') then raise exception 'El estado de derechos no es válido.'; end if;
  if length(v_figure)>80 or length(v_flavor)>80 or length(v_shot)>100 or length(v_notes)>2000 then
    raise exception 'La descripción supera el tamaño permitido.';
  end if;
  if v_collection='Productos' then
    if v_product is null or not exists(select 1 from public.products where id=v_product and activo) then
      raise exception 'Elegí un producto activo para catalogar este archivo.';
    end if;
  else
    v_product:=null; v_figure:=''; v_flavor:='';
  end if;
  if v_people and v_rights<>'Autorizado' then v_ai:=false; end if;

  if p ? 'tags' then
    if jsonb_typeof(p->'tags')<>'array' then raise exception 'Las etiquetas deben ser una lista.'; end if;
    for v_tag in select distinct btrim(value) from jsonb_array_elements_text(p->'tags') loop
      if v_tag<>'' and v_tag!~* '^momos:' then
        if length(v_tag)>50 then raise exception 'Una etiqueta supera 50 caracteres.'; end if;
        if jsonb_array_length(v_tags)>=30 then raise exception 'Solo se permiten 30 etiquetas.'; end if;
        v_tags:=v_tags||jsonb_build_array(v_tag);
      end if;
    end loop;
  else
    for v_tag in select value from jsonb_array_elements_text(v_asset.tags) loop
      if v_tag!~* '^momos:' then v_tags:=v_tags||jsonb_build_array(v_tag); end if;
    end loop;
  end if;
  v_marker:=case when v_collection='Marca' then 'momos:marca' else 'momos:producto' end;
  v_tags:=jsonb_build_array(v_marker)||v_tags;

  v_reasons:=public._motivos_bloqueo_eliminacion_activo(p_asset_id);
  v_locked:=cardinality(v_reasons)>0;
  v_semantic_changed:=v_collection<>v_current_collection
    or v_product is distinct from v_asset.product_id
    or v_figure<>v_asset.figure or v_flavor<>v_asset.flavor or v_shot<>v_asset.shot_type
    or v_orientation<>v_asset.orientation or v_people<>v_asset.contains_people
    or v_rights<>v_asset.rights_status or v_expiry is distinct from v_asset.rights_expires_at
    or v_ai<>v_asset.ai_use_allowed;
  if v_locked and v_semantic_changed then
    raise exception 'El archivo ya fue usado o pertenece a la identidad oficial; solo podés corregir nombre, etiquetas y notas.';
  end if;

  update public.brand_media_assets set
    name=v_name,product_id=v_product,figure=v_figure,flavor=v_flavor,shot_type=v_shot,
    orientation=v_orientation,contains_people=v_people,rights_status=v_rights,
    rights_expires_at=v_expiry,ai_use_allowed=v_ai,tags=v_tags,notes=v_notes
  where id=p_asset_id;

  v_snapshot:=jsonb_build_object(
    'name',v_name,'collection',v_collection,'product_id',v_product,'figure',v_figure,
    'flavor',v_flavor,'shot_type',v_shot,'orientation',v_orientation,
    'contains_people',v_people,'rights_status',v_rights,'rights_expires_at',v_expiry,
    'ai_use_allowed',v_ai,'tags',v_tags,'notes',v_notes
  );
  select coalesce(max(version),0)+1 into v_version
  from public.brand_media_asset_metadata_versions where asset_id=p_asset_id;
  insert into public.brand_media_asset_metadata_versions(
    asset_id,version,snapshot,fingerprint,change_note,changed_by
  ) values(
    p_asset_id,v_version,v_snapshot,md5(v_snapshot::text),
    case when v_locked then 'Corrección descriptiva de activo en uso' else 'Metadatos corregidos por el equipo' end,
    v_actor.id
  );
  perform public._add_audit('Biblioteca marca',p_asset_id::text,'Metadatos actualizados',
    'versión '||(v_version-1)::text,'versión '||v_version::text||case when v_locked then ' · clasificación protegida' else '' end);
  return jsonb_build_object('ok',true,'asset_id',p_asset_id,'version',v_version,
    'semantic_locked',v_locked,'ai_use_allowed',v_ai,'external_execution',false);
end $$;

revoke all on function public.edicion_biblioteca_disponible() from public,anon;
grant execute on function public.edicion_biblioteca_disponible() to authenticated,service_role;
revoke all on function public._brand_media_asset_initial_metadata_version() from public,anon,authenticated,service_role;
revoke all on function public.actualizar_metadatos_activo_marca(bigint,jsonb) from public,anon;
grant execute on function public.actualizar_metadatos_activo_marca(bigint,jsonb) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260718_58_edicion_biblioteca',
  'Vista completa y corrección versionada de metadatos sin alterar original, SHA-256, procedencia ni activos en uso')
on conflict(id) do update set detalle=excluded.detalle;

commit;
