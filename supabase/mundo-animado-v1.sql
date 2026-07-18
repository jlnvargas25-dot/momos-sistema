-- MOMOS OPS · H59 Mundo animado v1.
-- Tercera colección lógica sobre la Biblioteca privada existente: personajes,
-- escenarios, objetos y continuidad sin duplicar originales ni tablas de archivos.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260718'));

do $$
begin
  if not exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_58_edicion_biblioteca'
  ) then
    raise exception 'Falta el paso 58_edicion_biblioteca.';
  end if;
  if to_regclass('public.brand_media_assets') is null
     or to_regclass('public.brand_media_asset_metadata_versions') is null then
    raise exception 'Falta la Biblioteca Creativa versionada.';
  end if;
end $$;

create or replace function public.mundo_animado_disponible() returns boolean
language sql stable security definer set search_path=public
as $$ select true $$;

-- H56 resuelve capacidades con un único manifiesto. H59 extiende ese contrato
-- para que abrir Agencia no agregue una RPC por cada visita a Mundo animado.
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
    'mundo_animado_disponible'
  ]::text[]) as x(name);

  select id into v_schema_version from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
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

-- Taxonomía cerrada. El archivo sigue siendo brand_media_assets; solo cambia su
-- colección lógica. Así no se duplica Storage ni se agrega otra lectura al arranque.
create or replace function public._validar_taxonomia_mundo_animado() returns trigger
language plpgsql set search_path=public as $$
declare
  v_marker_count integer:=0; v_kind_count integer:=0;
  v_is_animation boolean:=false; v_was_canonical boolean:=false;
begin
  if jsonb_typeof(coalesce(new.tags,'[]'::jsonb))<>'array' then
    raise exception 'Las etiquetas del archivo no son válidas.';
  end if;
  select
    count(*) filter(where lower(value) in ('momos:marca','momos:producto','momos:animacion')),
    count(*) filter(where lower(value) in (
      'animacion:tipo:personaje','animacion:tipo:escenario','animacion:tipo:objeto',
      'animacion:tipo:vestuario','animacion:tipo:vehículo','animacion:tipo:efecto visual',
      'animacion:tipo:guía del mundo')),
    bool_or(lower(value)='momos:animacion')
  into v_marker_count,v_kind_count,v_is_animation
  from jsonb_array_elements_text(coalesce(new.tags,'[]'::jsonb));

  if v_marker_count>1 then
    raise exception 'Un archivo solo puede pertenecer a una colección de Biblioteca.';
  end if;
  if exists(
    select 1 from jsonb_array_elements_text(coalesce(new.tags,'[]'::jsonb)) t(value)
    where (lower(t.value) like 'momos:%' or lower(t.value) like 'animacion:%')
      and t.value not in (
        'momos:marca','momos:producto','momos:animacion','animacion:canon',
        'animacion:tipo:personaje','animacion:tipo:escenario','animacion:tipo:objeto',
        'animacion:tipo:vestuario','animacion:tipo:vehículo','animacion:tipo:efecto visual',
        'animacion:tipo:guía del mundo'
      )
  ) then raise exception 'Una etiqueta reservada de Biblioteca es inválida.'; end if;
  if tg_op='UPDATE' then
    select coalesce(bool_or(lower(value)='animacion:canon'),false) into v_was_canonical
    from jsonb_array_elements_text(coalesce(old.tags,'[]'::jsonb));
    if v_was_canonical and not (new.tags @> '["animacion:canon"]'::jsonb) then
      raise exception 'Una referencia canónica no puede perder su condición oficial.';
    end if;
  end if;
  if v_is_animation then
    if new.product_id is not null then raise exception 'El Mundo animado no se liga al catálogo vendible.'; end if;
    if length(btrim(coalesce(new.figure,''))) not between 2 and 80 then
      raise exception 'Identificá el personaje o elemento del Mundo animado.';
    end if;
    if new.media_type='Logo' then raise exception 'Un logo pertenece a Identidad y marca, no al Mundo animado.'; end if;
    if coalesce(new.shot_type,'')<>all(array[
      'Diseño base','Turnaround','Expresiones','Poses','Hoja de escala','Prueba de movimiento',
      'Escenario maestro','Utilería','Vestuario','Storyboard','Animatic','Clip animado','Guía de continuidad'
    ]) then raise exception 'El material de animación no pertenece a la taxonomía autorizada.'; end if;
    if v_kind_count<>1 then raise exception 'Elegí exactamente un tipo de elemento del Mundo animado.'; end if;

    if new.tags @> '["animacion:canon"]'::jsonb and not v_was_canonical
       and auth.uid() is not null and public.has_current_role('Administrador') is not true then
      raise exception 'Solo Administración puede declarar una referencia canónica.';
    end if;
  elsif exists(
    select 1 from jsonb_array_elements_text(coalesce(new.tags,'[]'::jsonb))
    where lower(value) like 'animacion:%'
  ) then
    raise exception 'La taxonomía de animación solo puede usarse en Mundo animado.';
  end if;
  return new;
end $$;

drop trigger if exists validar_taxonomia_mundo_animado on public.brand_media_assets;
create trigger validar_taxonomia_mundo_animado
before insert or update of product_id,figure,flavor,shot_type,media_type,tags
on public.brand_media_assets for each row execute function public._validar_taxonomia_mundo_animado();

-- Una fuente canónica se puede archivar y sustituir mediante una futura versión,
-- pero nunca borrar como si fuera un archivo huérfano.
create or replace function public._motivos_bloqueo_eliminacion_activo(p_asset_id bigint) returns text[]
language plpgsql stable security definer set search_path=public as $$
declare v_reasons text[]:='{}'::text[];
begin
  if exists(select 1 from public.brand_media_assets where id=p_asset_id and tags @> '["animacion:canon"]'::jsonb) then
    v_reasons:=array_append(v_reasons,'es una referencia canónica del Mundo animado');
  end if;
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
  if exists(select 1 from public.agency_mcp_asset_claims where asset_id=p_asset_id and expires_at>now()) then
    v_reasons:=array_append(v_reasons,'tiene una referencia MCP temporal vigente');
  end if;
  if exists(select 1 from public.agency_brand_kit_assets where asset_id=p_asset_id) then
    v_reasons:=array_append(v_reasons,'está ligado a una versión de identidad de marca');
  end if;
  return v_reasons;
end $$;

create or replace function public._brand_media_asset_initial_metadata_version() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_collection text; v_snapshot jsonb;
begin
  if new.status='Eliminado' then return new; end if;
  v_collection:=case
    when new.tags ? 'momos:animacion' then 'Animación'
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

create or replace function public.actualizar_metadatos_activo_marca(p_asset_id bigint,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_asset public.brand_media_assets%rowtype;
  v_name text; v_collection text; v_current_collection text; v_product text;
  v_figure text; v_flavor text; v_shot text; v_orientation text;
  v_people boolean; v_rights text; v_expiry date; v_ai boolean;
  v_tags jsonb:='[]'::jsonb; v_notes text; v_tag text; v_marker text;
  v_locked boolean; v_reasons text[]; v_semantic_changed boolean; v_snapshot jsonb; v_version integer;
  v_old_taxonomy jsonb:='[]'::jsonb; v_new_taxonomy jsonb:='[]'::jsonb;
begin
  v_actor:=public._brand_actor();
  if p is null or jsonb_typeof(p)<>'object' then raise exception 'Los metadatos no son válidos.'; end if;
  if exists(
    select 1 from jsonb_object_keys(p) as item(key)
    where item.key<>all(array['name','collection','product_id','figure','flavor','shot_type','orientation',
      'contains_people','rights_status','rights_expires_at','ai_use_allowed','tags','notes'])
  ) then raise exception 'La edición contiene campos inmutables o desconocidos.'; end if;

  select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null then raise exception 'El archivo no existe.'; end if;
  if v_asset.status not in ('Activo','Archivado','Bloqueado') then
    raise exception 'El archivo está eliminado o tiene una eliminación en curso.';
  end if;

  v_current_collection:=case
    when v_asset.tags ? 'momos:animacion' then 'Animación'
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
  if v_collection not in ('Marca','Productos','Animación') then raise exception 'La colección no es válida.'; end if;
  if v_orientation not in ('Vertical','Horizontal','Cuadrado','Audio','Documento') then raise exception 'La orientación no es válida.'; end if;
  if v_rights not in ('Propio','Autorizado','Por verificar','Restringido') then raise exception 'El estado de derechos no es válido.'; end if;
  if length(v_figure)>80 or length(v_flavor)>80 or length(v_shot)>100 or length(v_notes)>2000 then
    raise exception 'La descripción supera el tamaño permitido.';
  end if;
  if v_collection='Productos' then
    if v_product is null or not exists(select 1 from public.products where id=v_product and activo) then
      raise exception 'Elegí un producto activo para catalogar este archivo.';
    end if;
  elsif v_collection='Animación' then
    v_product:=null;
    if length(v_figure) not between 2 and 80 then raise exception 'Identificá el personaje o elemento del Mundo animado.'; end if;
  else
    v_product:=null; v_figure:=''; v_flavor:='';
  end if;
  if v_people and v_rights<>'Autorizado' then v_ai:=false; end if;

  if p ? 'tags' then
    if jsonb_typeof(p->'tags')<>'array' then raise exception 'Las etiquetas deben ser una lista.'; end if;
    for v_tag in select distinct btrim(value) from jsonb_array_elements_text(p->'tags') loop
      if v_tag<>'' and v_tag!~* '^momos:' and (v_collection='Animación' or v_tag!~* '^animacion:') then
        if length(v_tag)>50 then raise exception 'Una etiqueta supera 50 caracteres.'; end if;
        if jsonb_array_length(v_tags)>=30 then raise exception 'Solo se permiten 30 etiquetas.'; end if;
        v_tags:=v_tags||jsonb_build_array(v_tag);
      end if;
    end loop;
  else
    for v_tag in select value from jsonb_array_elements_text(v_asset.tags) loop
      if v_tag!~* '^momos:' and (v_collection='Animación' or v_tag!~* '^animacion:') then
        v_tags:=v_tags||jsonb_build_array(v_tag);
      end if;
    end loop;
  end if;
  v_marker:=case v_collection when 'Marca' then 'momos:marca' when 'Animación' then 'momos:animacion' else 'momos:producto' end;
  v_tags:=jsonb_build_array(v_marker)||v_tags;

  select coalesce(jsonb_agg(lower(value) order by lower(value)),'[]'::jsonb)
    into v_old_taxonomy from jsonb_array_elements_text(v_asset.tags)
    where lower(value) like 'animacion:%';
  select coalesce(jsonb_agg(lower(value) order by lower(value)),'[]'::jsonb)
    into v_new_taxonomy from jsonb_array_elements_text(v_tags)
    where lower(value) like 'animacion:%';

  v_reasons:=public._motivos_bloqueo_eliminacion_activo(p_asset_id);
  v_locked:=cardinality(v_reasons)>0 or v_asset.tags @> '["animacion:canon"]'::jsonb;
  v_semantic_changed:=v_collection<>v_current_collection
    or v_product is distinct from v_asset.product_id
    or v_figure<>v_asset.figure or v_flavor<>v_asset.flavor or v_shot<>v_asset.shot_type
    or v_orientation<>v_asset.orientation or v_people<>v_asset.contains_people
    or v_rights<>v_asset.rights_status or v_expiry is distinct from v_asset.rights_expires_at
    or v_ai<>v_asset.ai_use_allowed or v_old_taxonomy<>v_new_taxonomy;
  if v_locked and v_semantic_changed then
    raise exception 'El archivo ya fue usado, es canónico o pertenece a la identidad oficial; solo podés corregir nombre, etiquetas y notas.';
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
    case when v_locked then 'Corrección descriptiva de activo protegido' else 'Metadatos corregidos por el equipo' end,
    v_actor.id
  );
  perform public._add_audit('Biblioteca marca',p_asset_id::text,'Metadatos actualizados',
    'versión '||(v_version-1)::text,'versión '||v_version::text||case when v_locked then ' · clasificación protegida' else '' end);
  return jsonb_build_object('ok',true,'asset_id',p_asset_id,'version',v_version,
    'semantic_locked',v_locked,'ai_use_allowed',v_ai,'external_execution',false);
end $$;

revoke all on function public.mundo_animado_disponible() from public,anon;
grant execute on function public.mundo_animado_disponible() to authenticated,service_role;
revoke all on function public._validar_taxonomia_mundo_animado() from public,anon,authenticated,service_role;
revoke all on function public._brand_media_asset_initial_metadata_version() from public,anon,authenticated,service_role;
revoke all on function public.actualizar_metadatos_activo_marca(bigint,jsonb) from public,anon;
grant execute on function public.actualizar_metadatos_activo_marca(bigint,jsonb) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260718_59_mundo_animado',
  'Mundo animado separado: personajes, escenarios, objetos, referencias canónicas y continuidad sin duplicar originales')
on conflict(id) do update set detalle=excluded.detalle;

commit;
