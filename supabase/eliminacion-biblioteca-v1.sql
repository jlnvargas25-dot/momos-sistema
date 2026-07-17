-- MOMOS OPS · eliminación segura de originales de Biblioteca v1.
-- Borra el objeto real solo cuando nunca fue usado. Conserva una lápida mínima
-- para auditoría y evita romper creativos, escenas, audio, másteres o publicaciones.
begin;

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260716_50_flujo_creativo_e2e') then
    raise exception 'Falta el paso 50_flujo_creativo_e2e.';
  end if;
  if to_regclass('public.brand_media_assets') is null or to_regclass('storage.objects') is null then
    raise exception 'Falta Biblioteca o Storage.';
  end if;
end $$;

alter table public.brand_media_assets drop constraint if exists brand_media_assets_status_check;
alter table public.brand_media_assets add constraint brand_media_assets_status_check
  check(status in ('Activo','Archivado','Bloqueado','Eliminando','Eliminado'));

create or replace function public.eliminacion_biblioteca_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._motivos_bloqueo_eliminacion_activo(p_asset_id bigint) returns text[]
language plpgsql stable security definer set search_path=public as $$
declare v_reasons text[]:='{}'::text[];
begin
  if exists(select 1 from public.brand_media_usages where asset_id=p_asset_id) then
    v_reasons:=array_append(v_reasons,'ya fue usado en una pieza creativa');
  end if;
  if exists(select 1 from public.creative_generation_jobs
    where output_asset_id=p_asset_id or input_asset_ids @> jsonb_build_array(p_asset_id)) then
    v_reasons:=array_append(v_reasons,'está ligado a un trabajo creativo');
  end if;
  if exists(select 1 from public.agency_storyboard_shots where p_asset_id=any(input_asset_ids)) then
    v_reasons:=array_append(v_reasons,'está incluido en una escena');
  end if;
  if exists(select 1 from public.agency_scene_quality_reviews where output_asset_id=p_asset_id) then
    v_reasons:=array_append(v_reasons,'forma parte de una revisión de calidad');
  end if;
  if exists(select 1 from public.agency_postproduction_exports where output_asset_id=p_asset_id) then
    v_reasons:=array_append(v_reasons,'forma parte de una exportación');
  end if;
  if exists(select 1 from public.agency_postproduction_export_audio where asset_id=p_asset_id) then
    v_reasons:=array_append(v_reasons,'está seleccionado como audio de un máster');
  end if;
  if exists(select 1 from public.agency_master_releases where output_asset_id=p_asset_id) then
    v_reasons:=array_append(v_reasons,'está ligado a una publicación trazable');
  end if;
  if exists(select 1 from public.brand_media_assets where original_asset_id=p_asset_id and status<>'Eliminado') then
    v_reasons:=array_append(v_reasons,'es el original de otra versión conservada');
  end if;
  return v_reasons;
end $$;

create or replace function public.preparar_eliminacion_activo_marca(p_asset_id bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_asset public.brand_media_assets%rowtype; v_reasons text[];
begin
  v_actor:=public._brand_actor();
  select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null then raise exception 'El archivo no existe.'; end if;
  if v_asset.status not in ('Activo','Archivado','Bloqueado') then
    raise exception 'El archivo ya está eliminado o tiene una eliminación en curso.';
  end if;
  v_reasons:=public._motivos_bloqueo_eliminacion_activo(p_asset_id);
  if cardinality(v_reasons)>0 then
    raise exception 'No se puede eliminar definitivamente: %. Podés archivarlo para ocultarlo sin perder la trazabilidad.',array_to_string(v_reasons,', ');
  end if;
  update public.brand_media_assets set status='Eliminando',archived_by=v_actor.id,archived_at=now() where id=p_asset_id;
  perform public._add_audit('Biblioteca marca',p_asset_id::text,'Eliminación preparada',v_asset.status,'Esperando retiro del archivo real');
  return jsonb_build_object('ok',true,'asset_id',p_asset_id,'storage_path',v_asset.storage_path,'previous_status',v_asset.status);
end $$;

create or replace function public.cancelar_eliminacion_activo_marca(p_asset_id bigint,p_previous_status text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_status text;
begin
  v_actor:=public._brand_actor();
  v_status:=case when p_previous_status in ('Activo','Archivado','Bloqueado') then p_previous_status else 'Activo' end;
  update public.brand_media_assets set status=v_status where id=p_asset_id and status='Eliminando';
  if not found then raise exception 'No existe una eliminación pendiente para cancelar.'; end if;
  perform public._add_audit('Biblioteca marca',p_asset_id::text,'Eliminación cancelada','Eliminando',v_status);
  return jsonb_build_object('ok',true,'asset_id',p_asset_id,'status',v_status);
end $$;

create or replace function public.confirmar_eliminacion_activo_marca(p_asset_id bigint) returns jsonb
language plpgsql security definer set search_path=public,storage as $$
declare v_actor public.users%rowtype; v_asset public.brand_media_assets%rowtype;
begin
  v_actor:=public._brand_actor();
  select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null or v_asset.status<>'Eliminando' then raise exception 'No existe una eliminación pendiente.'; end if;
  if exists(select 1 from storage.objects where bucket_id='brand-assets' and name=v_asset.storage_path) then
    raise exception 'El archivo todavía existe en Storage; no se cerró la eliminación.';
  end if;
  update public.brand_media_assets set status='Eliminado',
    notes='Archivo eliminado definitivamente; se conserva únicamente esta lápida de auditoría.',
    tags='[]'::jsonb,generation_meta='{}'::jsonb,allowed_channels='[]'::jsonb,
    figure='',flavor='',shot_type='',rights_expires_at=null,ai_use_allowed=false,
    archived_by=v_actor.id,archived_at=now()
  where id=p_asset_id;
  perform public._add_audit('Biblioteca marca',p_asset_id::text,'Archivo eliminado','Eliminando','Objeto retirado de Storage; lápida de auditoría conservada');
  return jsonb_build_object('ok',true,'asset_id',p_asset_id,'status','Eliminado');
end $$;

drop policy if exists brand_assets_pending_delete on storage.objects;
create policy brand_assets_pending_delete on storage.objects for delete to authenticated
using(bucket_id='brand-assets'
  and public.current_user_has_any_role(array['Administrador','Marketing/CRM'])
  and exists(select 1 from public.brand_media_assets a where a.storage_path=storage.objects.name and a.status='Eliminando'));

revoke all on function public.eliminacion_biblioteca_disponible() from public,anon;
revoke all on function public.preparar_eliminacion_activo_marca(bigint) from public,anon;
revoke all on function public.cancelar_eliminacion_activo_marca(bigint,text) from public,anon;
revoke all on function public.confirmar_eliminacion_activo_marca(bigint) from public,anon;
revoke all on function public._motivos_bloqueo_eliminacion_activo(bigint) from public,anon,authenticated,service_role;
grant execute on function public.eliminacion_biblioteca_disponible() to authenticated,service_role;
grant execute on function public.preparar_eliminacion_activo_marca(bigint) to authenticated;
grant execute on function public.cancelar_eliminacion_activo_marca(bigint,text) to authenticated;
grant execute on function public.confirmar_eliminacion_activo_marca(bigint) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260717_51_eliminacion_biblioteca','Eliminación real de originales sin uso, protección de dependencias y lápida auditable')
on conflict(id) do update set detalle=excluded.detalle;

commit;
