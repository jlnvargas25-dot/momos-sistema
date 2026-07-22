-- MOMOS OPS · H60 Eliminación protegida del logo oficial.
-- Permite retirar el archivo físico con doble confirmación, conserva la
-- versión histórica de Identidad y deja los gates de marca cerrados hasta
-- que Administración cargue y active un logo de reemplazo.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260718'));

do $$
begin
  if not exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_59_mundo_animado'
  ) then raise exception 'Falta el paso 59_mundo_animado.'; end if;
  if to_regclass('public.agency_brand_kit_assets') is null
     or to_regclass('public.brand_media_assets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Faltan Identidad de marca, Biblioteca o Storage.';
  end if;
end $$;

create or replace function public.eliminacion_logo_oficial_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

-- H60 amplía el manifiesto instalado por Data Sync/H59. Cada hito anuncia
-- únicamente capacidades que ya existen en ese punto de la cadena.
create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_capabilities jsonb;
  v_schema_version text;
begin
  if auth.uid() is null or not exists(
    select 1 from public.users u where u.auth_id=auth.uid() and u.activo
  ) then raise exception 'Sesion MOMOS invalida.' using errcode='42501'; end if;

  select coalesce(jsonb_object_agg(x.name,
    to_regprocedure(format('public.%I()',x.name)) is not null),'{}'::jsonb)
  into v_capabilities
  from unnest(array[
    'roles_multiples_disponible','productos_servidor_disponible','agencia_comercial_disponible',
    'orquestador_agencia_disponible','centro_acciones_agencia_disponible',
    'resultados_acciones_agencia_disponibles','mesa_agencia_disponible','estudio_escenas_disponible',
    'motion_experience_disponible','enrutador_escenas_disponible','calidad_postproduccion_disponible',
    'postproduccion_exportacion_disponible','postproduccion_audio_disponible','retencion_guiones_disponible',
    'retencion_loops_disponible','observatorio_meta_disponible','incrementalidad_meta_disponible',
    'escenarios_inversion_meta_disponible','autorizacion_inversion_meta_disponible',
    'meta_conector_dry_run_disponible','distribucion_comercial_disponible',
    'distribucion_conectores_disponible','biblioteca_creativa_disponible',
    'produccion_creativa_disponible','revision_creativa_disponible','versiones_creativas_disponibles',
    'integraciones_agencia_disponibles','higgsfield_conector_disponible','kling_conector_disponible',
    'gobernanza_marca_disponible','motor_crecimiento_multimodo_disponible','flujo_creativo_e2e_disponible',
    'operacion_pedido_disponible','crm_clientes_disponible','identidad_marca_disponible',
    'mundo_animado_disponible','eliminacion_logo_oficial_disponible'
  ]::text[]) as x(name);

  select id into v_schema_version
  from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  return jsonb_build_object(
    'version',1,
    'schema_version',coalesce(v_schema_version,''),
    'server_time',clock_timestamp(),
    'capabilities',v_capabilities,
    'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object('version',extract(epoch from clock_timestamp())::bigint,'ttl_seconds',60),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300)
    ),
    'contains_pii',false,
    'contains_secrets',false,
    'external_execution',false
  );
end $$;

revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

-- El vínculo con el kit se conserva como historia. Es la única dependencia
-- exceptuada: cualquier uso creativo, versión derivada, escena, máster, audio,
-- publicación o claim MCP continúa bloqueando la eliminación.
create or replace function public._motivos_bloqueo_eliminacion_logo_oficial(p_asset_id bigint) returns text[]
language sql stable security definer set search_path=public as $$
  select coalesce(array_agg(reason order by ord),'{}'::text[])
  from unnest(public._motivos_bloqueo_eliminacion_activo(p_asset_id)) with ordinality as r(reason,ord)
  where reason<>'está ligado a una versión de identidad de marca'
$$;

-- Defensa en profundidad: la ruta genérica nunca puede retirar un archivo
-- ligado a Identidad, aunque una migración posterior amplíe o reemplace el
-- helper compartido de dependencias. Solo la RPC especial de este hito puede
-- exceptuar ese vínculo, y conserva todas las demás guardas.
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
  if exists(select 1 from public.agency_brand_kit_assets where asset_id=p_asset_id) then
    raise exception 'Este archivo pertenece a una versión de Identidad. Usá la eliminación protegida del logo oficial.';
  end if;
  v_reasons:=public._motivos_bloqueo_eliminacion_activo(p_asset_id);
  if cardinality(v_reasons)>0 then
    raise exception 'No se puede eliminar definitivamente: %. Podés archivarlo para ocultarlo sin perder la trazabilidad.',array_to_string(v_reasons,', ');
  end if;
  update public.brand_media_assets set status='Eliminando',archived_by=v_actor.id,archived_at=now()
  where id=p_asset_id;
  perform public._add_audit('Biblioteca marca',p_asset_id::text,'Eliminación preparada',v_asset.status,'Esperando retiro del archivo real');
  return jsonb_build_object('ok',true,'asset_id',p_asset_id,'storage_path',v_asset.storage_path,'previous_status',v_asset.status);
end $$;

create or replace function public.preparar_eliminacion_logo_oficial(
  p_asset_id bigint,p_confirmation text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_asset public.brand_media_assets%rowtype;
  v_reasons text[]; v_expected text:='ELIMINAR LOGO '||p_asset_id::text;
begin
  v_actor:=public._brand_actor();
  if public.has_current_role('Administrador') is not true then
    raise exception 'Solo Administración puede eliminar el logo oficial.';
  end if;
  if btrim(coalesce(p_confirmation,''))<>v_expected then
    raise exception 'La confirmación no coincide. Escribí exactamente: %',v_expected;
  end if;
  select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null then raise exception 'El archivo no existe.'; end if;
  if v_asset.media_type<>'Logo' or not exists(
    select 1 from public.agency_brand_kit_assets
    where asset_id=p_asset_id and role='principal'
  ) then raise exception 'El archivo no es un logo principal oficial de MOMOS.'; end if;
  if v_asset.status not in ('Activo','Archivado','Bloqueado') then
    raise exception 'El logo ya está eliminado o tiene una eliminación en curso.';
  end if;
  v_reasons:=public._motivos_bloqueo_eliminacion_logo_oficial(p_asset_id);
  if cardinality(v_reasons)>0 then
    raise exception 'No se puede eliminar el logo: %. Primero resolvé esas dependencias.',array_to_string(v_reasons,', ');
  end if;
  update public.brand_media_assets
  set status='Eliminando',archived_by=v_actor.id,archived_at=now()
  where id=p_asset_id;
  perform public._add_audit('Biblioteca marca',p_asset_id::text,'Eliminación de logo preparada',
    v_asset.status,'Doble confirmación validada; identidad quedará incompleta hasta reemplazo');
  return jsonb_build_object(
    'ok',true,'asset_id',p_asset_id,'storage_path',v_asset.storage_path,
    'previous_status',v_asset.status,'confirmation_phrase',v_expected,
    'identity_will_be_incomplete',true,'requires_replacement_logo',true,
    'external_execution',false
  );
end $$;

create or replace function public.confirmar_eliminacion_logo_oficial(
  p_asset_id bigint,p_confirmation text
) returns jsonb
language plpgsql security definer set search_path=public,storage as $$
declare
  v_actor public.users%rowtype; v_asset public.brand_media_assets%rowtype;
  v_reasons text[]; v_expected text:='ELIMINAR LOGO '||p_asset_id::text;
begin
  v_actor:=public._brand_actor();
  if public.has_current_role('Administrador') is not true then
    raise exception 'Solo Administración puede eliminar el logo oficial.';
  end if;
  if btrim(coalesce(p_confirmation,''))<>v_expected then
    raise exception 'La segunda confirmación no coincide.';
  end if;
  select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null or v_asset.status<>'Eliminando' or v_asset.media_type<>'Logo'
     or not exists(select 1 from public.agency_brand_kit_assets where asset_id=p_asset_id and role='principal') then
    raise exception 'No existe una eliminación pendiente de logo oficial.';
  end if;
  v_reasons:=public._motivos_bloqueo_eliminacion_logo_oficial(p_asset_id);
  if cardinality(v_reasons)>0 then
    raise exception 'Apareció una dependencia antes del cierre: %.',array_to_string(v_reasons,', ');
  end if;
  if exists(select 1 from storage.objects where bucket_id='brand-assets' and name=v_asset.storage_path) then
    raise exception 'El logo todavía existe en Storage; no se cerró la eliminación.';
  end if;
  update public.brand_media_assets set status='Eliminado',
    notes='Logo oficial eliminado; la versión histórica de identidad se conserva y exige un reemplazo.',
    tags='[]'::jsonb,generation_meta='{}'::jsonb,allowed_channels='[]'::jsonb,
    figure='',flavor='',shot_type='',rights_expires_at=null,ai_use_allowed=false,
    archived_by=v_actor.id,archived_at=now()
  where id=p_asset_id;
  perform public._add_audit('Biblioteca marca',p_asset_id::text,'Logo oficial eliminado',
    'Eliminando','Objeto retirado; identidad incompleta y gates cerrados hasta reemplazo');
  return jsonb_build_object(
    'ok',true,'asset_id',p_asset_id,'status','Eliminado',
    'identity_ready',false,'requires_replacement_logo',true,
    'historical_binding_preserved',true,'external_execution',false
  );
end $$;

revoke all on function public.eliminacion_logo_oficial_disponible() from public,anon;
revoke all on function public.preparar_eliminacion_activo_marca(bigint) from public,anon;
revoke all on function public.preparar_eliminacion_logo_oficial(bigint,text) from public,anon;
revoke all on function public.confirmar_eliminacion_logo_oficial(bigint,text) from public,anon;
revoke all on function public._motivos_bloqueo_eliminacion_logo_oficial(bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.eliminacion_logo_oficial_disponible() to authenticated,service_role;
grant execute on function public.preparar_eliminacion_activo_marca(bigint) to authenticated;
grant execute on function public.preparar_eliminacion_logo_oficial(bigint,text) to authenticated;
grant execute on function public.confirmar_eliminacion_logo_oficial(bigint,text) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260718_60_eliminacion_logo_oficial',
  'Logo oficial eliminable con doble confirmación, dependencias intactas, identidad fail-closed y auditoría')
on conflict(id) do update set detalle=excluded.detalle;

commit;
