-- MOMOS OPS · H61 Biblioteca de producción v1.
-- Clasifica los originales existentes como componentes reutilizables y arma
-- paquetes de referencias aprobables para Higgsfield u otros motores.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260718'));

do $$
begin
  if not exists(select 1 from public.momos_ops_migrations where id='20260718_60_eliminacion_logo_oficial') then
    raise exception 'Falta el paso 60_eliminacion_logo_oficial.';
  end if;
  if to_regclass('public.brand_media_assets') is null then
    raise exception 'Falta la Biblioteca Creativa.';
  end if;
end $$;

create table if not exists public.brand_asset_production_profiles(
  asset_id bigint primary key references public.brand_media_assets(id) on delete cascade,
  component_type text not null check(component_type in (
    'Producto','Empaque','Manos','Presentador UGC','Locación','Movimiento','Marca','Audio','Personaje'
  )),
  view_angle text not null default 'No aplica' check(view_angle in (
    'No aplica','Frontal','Trasera','Perfil izquierdo','Perfil derecho','Tres cuartos',
    'Superior','Detalle / macro','POV','Plano general'
  )),
  physical_state text not null default 'No aplica' check(physical_state in (
    'No aplica','Intacto','Congelado','Listo para servir','Abierto','Cortado','Cucharada',
    'En mano','Empaque cerrado','Empaque abierto'
  )),
  interaction_type text not null default 'Ninguna' check(interaction_type in (
    'Ninguna','Sostener','Abrir','Sacar','Cortar','Presionar','Servir','Probar',
    'Movimiento de cámara','Ambiente'
  )),
  hand_assignment text not null default 'Ninguna' check(hand_assignment in (
    'Ninguna','Derecha','Izquierda','Ambas','Fuera de cuadro'
  )),
  location_name text not null default '',
  light_direction text not null default '',
  scale_reference text not null default '',
  continuity_notes text not null default '',
  source_quality text not null default 'Original limpio' check(source_quality in (
    'Original limpio','Original con escarcha','Comprimido','Restaurado','Generado'
  )),
  qa_status text not null default 'Pendiente' check(qa_status in ('Pendiente','Aprobado','Condicionado','Rechazado')),
  qa_notes text not null default '',
  consent_status text not null default 'No aplica' check(consent_status in (
    'No aplica','Pendiente','Autorizado','Vencido','Restringido'
  )),
  canonical boolean not null default false,
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_by text not null references public.users(id),
  updated_at timestamptz not null default now(),
  check(component_type='Locación' or location_name=''),
  check(component_type in ('Manos','Presentador UGC') or consent_status='No aplica')
);
create index if not exists brand_asset_production_component_idx
  on public.brand_asset_production_profiles(component_type,qa_status,view_angle);

create table if not exists public.brand_production_packs(
  id bigint generated always as identity primary key,
  name text not null check(length(btrim(name)) between 3 and 120),
  purpose text not null check(length(btrim(purpose)) between 8 and 500),
  version integer not null default 1 check(version>0),
  status text not null default 'Borrador' check(status in ('Borrador','En revisión','Aprobado','Archivado')),
  product_id text references public.products(id) on delete set null,
  figure text not null default '',
  channel text not null default 'Instagram',
  target_format text not null default 'Reel 9:16',
  description text not null default '',
  requirements jsonb not null default '{"required_roles":["Producto"]}'::jsonb check(jsonb_typeof(requirements)='object'),
  fingerprint text not null check(fingerprint~'^[0-9a-f]{32}$'),
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  reviewed_by text references public.users(id),
  reviewed_at timestamptz,
  review_note text not null default '',
  unique(name,version)
);
create index if not exists brand_production_packs_status_idx
  on public.brand_production_packs(status,created_at desc);

create table if not exists public.brand_production_pack_assets(
  pack_id bigint not null references public.brand_production_packs(id) on delete cascade,
  asset_id bigint not null references public.brand_media_assets(id) on delete restrict,
  role text not null check(role in (
    'Identidad','Producto','Empaque','Mano','Presentador','Locación','Movimiento','Logo',
    'Audio','Start frame','End frame','Continuidad'
  )),
  sequence integer not null default 1 check(sequence between 1 and 100),
  required boolean not null default true,
  notes text not null default '',
  added_by text not null references public.users(id),
  added_at timestamptz not null default now(),
  primary key(pack_id,asset_id,role)
);
create index if not exists brand_production_pack_assets_asset_idx
  on public.brand_production_pack_assets(asset_id,pack_id);

alter table public.brand_asset_production_profiles enable row level security;
alter table public.brand_production_packs enable row level security;
alter table public.brand_production_pack_assets enable row level security;
drop policy if exists staff_read on public.brand_asset_production_profiles;
drop policy if exists staff_read on public.brand_production_packs;
drop policy if exists staff_read on public.brand_production_pack_assets;
create policy staff_read on public.brand_asset_production_profiles for select to authenticated using(public.is_staff());
create policy staff_read on public.brand_production_packs for select to authenticated using(public.is_staff());
create policy staff_read on public.brand_production_pack_assets for select to authenticated using(public.is_staff());
revoke insert,update,delete on public.brand_asset_production_profiles,public.brand_production_packs,public.brand_production_pack_assets from anon,authenticated;
grant select on public.brand_asset_production_profiles,public.brand_production_packs,public.brand_production_pack_assets to authenticated;

create or replace function public.biblioteca_produccion_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._estado_activo_produccion(p_asset_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_asset public.brand_media_assets%rowtype;
  v_profile public.brand_asset_production_profiles%rowtype;
  v_reasons text[]:='{}'::text[];
  v_warnings text[]:='{}'::text[];
begin
  select * into v_asset from public.brand_media_assets where id=p_asset_id;
  select * into v_profile from public.brand_asset_production_profiles where asset_id=p_asset_id;
  if v_asset.id is null then v_reasons:=array_append(v_reasons,'El original ya no existe.'); end if;
  if v_profile.asset_id is null then v_reasons:=array_append(v_reasons,'Falta la ficha de producción.'); end if;
  if v_asset.id is not null and v_asset.status<>'Activo' then v_reasons:=array_append(v_reasons,'El original no está activo.'); end if;
  if v_asset.id is not null and (v_asset.rights_status not in ('Propio','Autorizado') or not v_asset.ai_use_allowed
    or (v_asset.rights_expires_at is not null and v_asset.rights_expires_at<current_date)) then
    v_reasons:=array_append(v_reasons,'Los derechos o el permiso para IA no están vigentes.');
  end if;
  if v_profile.asset_id is not null and v_profile.qa_status<>'Aprobado' then
    v_reasons:=array_append(v_reasons,'La ficha no tiene QA Aprobado.');
  end if;
  if v_profile.component_type in ('Manos','Presentador UGC') then
    if not v_asset.contains_people or v_asset.rights_status<>'Autorizado' then
      v_reasons:=array_append(v_reasons,'La persona visible no tiene autorización de imagen completa.');
    end if;
    if v_profile.consent_status<>'Autorizado' then
      v_reasons:=array_append(v_reasons,'Falta consentimiento específico para IA.');
    end if;
  end if;
  if v_profile.source_quality in ('Original con escarcha','Comprimido') then
    v_warnings:=array_append(v_warnings,case v_profile.source_quality
      when 'Original con escarcha' then 'La escarcha puede distorsionar textura, color y geometría.'
      else 'La compresión puede reducir fidelidad.' end);
  end if;
  return jsonb_build_object('ready',cardinality(v_reasons)=0,'reasons',to_jsonb(v_reasons),'warnings',to_jsonb(v_warnings));
end $$;

create or replace function public.clasificar_activo_produccion(p_asset_id bigint,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype;
  v_asset public.brand_media_assets%rowtype;
  v_component text:=btrim(coalesce(p->>'component_type',''));
  v_view text:=coalesce(nullif(p->>'view_angle',''),'No aplica');
  v_state text:=coalesce(nullif(p->>'physical_state',''),'No aplica');
  v_interaction text:=coalesce(nullif(p->>'interaction_type',''),'Ninguna');
  v_hand text:=coalesce(nullif(p->>'hand_assignment',''),'Ninguna');
  v_location text:=btrim(coalesce(p->>'location_name',''));
  v_quality text:=coalesce(nullif(p->>'source_quality',''),'Original limpio');
  v_qa text:=coalesce(nullif(p->>'qa_status',''),'Pendiente');
  v_consent text:=coalesce(nullif(p->>'consent_status',''),'No aplica');
  v_canonical boolean:=coalesce((p->>'canonical')::boolean,false);
  v_readiness jsonb;
begin
  v_actor:=public._brand_actor();
  if not (public.has_current_role('Administrador') or public.has_current_role('Marketing/CRM')) then
    raise exception 'Solo Administración o Marketing/CRM pueden clasificar producción.';
  end if;
  select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null or v_asset.status='Eliminado' then raise exception 'El original no existe.'; end if;
  if exists(select 1 from public.brand_production_pack_assets m join public.brand_production_packs k on k.id=m.pack_id
    where m.asset_id=p_asset_id and k.status='Aprobado') then
    raise exception 'El activo pertenece a un paquete aprobado; creá una nueva versión del paquete antes de reclasificarlo.';
  end if;
  if v_component not in ('Producto','Empaque','Manos','Presentador UGC','Locación','Movimiento','Marca','Audio','Personaje') then raise exception 'Componente de producción inválido.'; end if;
  if v_view not in ('No aplica','Frontal','Trasera','Perfil izquierdo','Perfil derecho','Tres cuartos','Superior','Detalle / macro','POV','Plano general') then raise exception 'Vista de producción inválida.'; end if;
  if v_state not in ('No aplica','Intacto','Congelado','Listo para servir','Abierto','Cortado','Cucharada','En mano','Empaque cerrado','Empaque abierto') then raise exception 'Estado físico inválido.'; end if;
  if v_interaction not in ('Ninguna','Sostener','Abrir','Sacar','Cortar','Presionar','Servir','Probar','Movimiento de cámara','Ambiente') then raise exception 'Interacción inválida.'; end if;
  if v_hand not in ('Ninguna','Derecha','Izquierda','Ambas','Fuera de cuadro') then raise exception 'Asignación de manos inválida.'; end if;
  if v_quality not in ('Original limpio','Original con escarcha','Comprimido','Restaurado','Generado') then raise exception 'Calidad de fuente inválida.'; end if;
  if v_qa not in ('Pendiente','Aprobado','Condicionado','Rechazado') then raise exception 'Estado de QA inválido.'; end if;
  if v_consent not in ('No aplica','Pendiente','Autorizado','Vencido','Restringido') then raise exception 'Consentimiento inválido.'; end if;
  if v_component='Locación' and length(v_location)<2 then raise exception 'Identificá la locación.'; end if;
  if v_component<>'Locación' then v_location:=''; end if;
  if v_component in ('Manos','Presentador UGC') then
    if not v_asset.contains_people then raise exception 'Este componente debe declararse como contenido con personas.'; end if;
    if v_consent='No aplica' then raise exception 'Manos y presentadores necesitan estado de consentimiento.'; end if;
    if v_qa='Aprobado' and (v_asset.rights_status<>'Autorizado' or v_consent<>'Autorizado') then
      raise exception 'No se puede aprobar QA humano sin derechos y consentimiento autorizados.';
    end if;
  else v_consent:='No aplica'; end if;
  if v_qa='Aprobado' and (v_asset.status<>'Activo' or v_asset.rights_status not in ('Propio','Autorizado')
    or not v_asset.ai_use_allowed or (v_asset.rights_expires_at is not null and v_asset.rights_expires_at<current_date)) then
    raise exception 'El original no puede aprobarse: faltan estado activo, derechos o permiso IA vigente.';
  end if;
  if v_canonical and not public.has_current_role('Administrador') then
    raise exception 'Solo Administración puede declarar una referencia canónica.';
  end if;
  insert into public.brand_asset_production_profiles(
    asset_id,component_type,view_angle,physical_state,interaction_type,hand_assignment,
    location_name,light_direction,scale_reference,continuity_notes,source_quality,qa_status,
    qa_notes,consent_status,canonical,created_by,updated_by
  ) values(
    p_asset_id,v_component,v_view,v_state,v_interaction,v_hand,v_location,
    btrim(coalesce(p->>'light_direction','')),btrim(coalesce(p->>'scale_reference','')),
    btrim(coalesce(p->>'continuity_notes','')),v_quality,v_qa,btrim(coalesce(p->>'qa_notes','')),
    v_consent,v_canonical,v_actor.id,v_actor.id
  ) on conflict(asset_id) do update set
    component_type=excluded.component_type,view_angle=excluded.view_angle,physical_state=excluded.physical_state,
    interaction_type=excluded.interaction_type,hand_assignment=excluded.hand_assignment,
    location_name=excluded.location_name,light_direction=excluded.light_direction,
    scale_reference=excluded.scale_reference,continuity_notes=excluded.continuity_notes,
    source_quality=excluded.source_quality,qa_status=excluded.qa_status,qa_notes=excluded.qa_notes,
    consent_status=excluded.consent_status,canonical=excluded.canonical,updated_by=v_actor.id,updated_at=now();
  v_readiness:=public._estado_activo_produccion(p_asset_id);
  perform public._add_audit('Biblioteca producción',p_asset_id::text,'Ficha de producción guardada','',v_component||' · '||v_view||' · QA '||v_qa);
  return jsonb_build_object('ok',true,'asset_id',p_asset_id,'readiness',v_readiness,'external_execution',false);
end $$;

create or replace function public.estado_paquete_produccion(p_pack_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_pack public.brand_production_packs%rowtype;
  v_member record;
  v_role text;
  v_reasons text[]:='{}'::text[];
  v_state jsonb;
  v_count integer:=0;
begin
  select * into v_pack from public.brand_production_packs where id=p_pack_id;
  if v_pack.id is null then return jsonb_build_object('ready',false,'reasons',jsonb_build_array('El paquete no existe.'),'member_count',0); end if;
  for v_role in select value from jsonb_array_elements_text(coalesce(v_pack.requirements->'required_roles','[]'::jsonb)) loop
    if not exists(select 1 from public.brand_production_pack_assets where pack_id=p_pack_id and role=v_role) then
      v_reasons:=array_append(v_reasons,'Falta referencia obligatoria: '||v_role||'.');
    end if;
  end loop;
  for v_member in select * from public.brand_production_pack_assets where pack_id=p_pack_id loop
    v_count:=v_count+1;
    v_state:=public._estado_activo_produccion(v_member.asset_id);
    if not coalesce((v_state->>'ready')::boolean,false) then
      v_reasons:=array_append(v_reasons,v_member.role||': '||coalesce(v_state#>>'{reasons,0}','activo no disponible.'));
    end if;
  end loop;
  if v_count=0 then v_reasons:=array_append(v_reasons,'El paquete todavía no tiene referencias.'); end if;
  return jsonb_build_object('ready',cardinality(v_reasons)=0,'reasons',to_jsonb(v_reasons),'member_count',v_count);
end $$;

create or replace function public.crear_paquete_produccion(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype;
  v_id bigint;
  v_name text:=btrim(coalesce(p->>'name',''));
  v_purpose text:=btrim(coalesce(p->>'purpose',''));
  v_members jsonb:=coalesce(p->'members','[]'::jsonb);
  v_member jsonb;
  v_asset_id bigint;
  v_role text;
  v_requirements jsonb:=coalesce(p->'requirements','{"required_roles":["Producto"]}'::jsonb);
  v_fingerprint text;
begin
  v_actor:=public._brand_actor();
  if not (public.has_current_role('Administrador') or public.has_current_role('Marketing/CRM')) then raise exception 'No podés crear paquetes de producción.'; end if;
  if length(v_name) not between 3 and 120 then raise exception 'El paquete necesita un nombre claro.'; end if;
  if length(v_purpose) not between 8 and 500 then raise exception 'Explicá para qué video o flujo se usará.'; end if;
  if jsonb_typeof(v_members)<>'array' or jsonb_array_length(v_members)>20 then raise exception 'La lista de referencias es inválida o supera 20 activos.'; end if;
  if jsonb_typeof(v_requirements)<>'object' or jsonb_typeof(coalesce(v_requirements->'required_roles','[]'::jsonb))<>'array' then raise exception 'Los requisitos del paquete son inválidos.'; end if;
  if exists(select 1 from jsonb_array_elements_text(v_requirements->'required_roles') role where role not in ('Identidad','Producto','Empaque','Mano','Presentador','Locación','Movimiento','Logo','Audio','Start frame','End frame','Continuidad')) then raise exception 'Hay un rol requerido inválido.'; end if;
  v_fingerprint:=md5(jsonb_build_object('name',v_name,'purpose',v_purpose,'product_id',nullif(p->>'product_id',''),
    'figure',coalesce(p->>'figure',''),'channel',coalesce(p->>'channel','Instagram'),
    'target_format',coalesce(p->>'target_format','Reel 9:16'),'requirements',v_requirements,'members',v_members)::text);
  insert into public.brand_production_packs(name,purpose,product_id,figure,channel,target_format,description,requirements,fingerprint,created_by)
  values(v_name,v_purpose,nullif(p->>'product_id',''),btrim(coalesce(p->>'figure','')),
    btrim(coalesce(p->>'channel','Instagram')),btrim(coalesce(p->>'target_format','Reel 9:16')),
    btrim(coalesce(p->>'description','')),v_requirements,v_fingerprint,v_actor.id)
  returning id into v_id;
  for v_member in select value from jsonb_array_elements(v_members) loop
    v_asset_id:=nullif(v_member->>'asset_id','')::bigint;
    v_role:=v_member->>'role';
    if not exists(select 1 from public.brand_media_assets where id=v_asset_id and status<>'Eliminado') then raise exception 'Un activo del paquete no existe.'; end if;
    if v_role not in ('Identidad','Producto','Empaque','Mano','Presentador','Locación','Movimiento','Logo','Audio','Start frame','End frame','Continuidad') then raise exception 'Rol de referencia inválido.'; end if;
    insert into public.brand_production_pack_assets(pack_id,asset_id,role,sequence,required,notes,added_by)
    values(v_id,v_asset_id,v_role,coalesce(nullif(v_member->>'sequence','')::integer,1),
      coalesce((v_member->>'required')::boolean,true),btrim(coalesce(v_member->>'notes','')),v_actor.id);
  end loop;
  perform public._add_audit('Paquetes producción',v_id::text,'Paquete creado','',v_name||' · borrador');
  return jsonb_build_object('ok',true,'pack_id',v_id,'status','Borrador','readiness',public.estado_paquete_produccion(v_id),'external_execution',false);
end $$;

create or replace function public.revisar_paquete_produccion(p_pack_id bigint,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype;
  v_pack public.brand_production_packs%rowtype;
  v_state jsonb;
  v_status text;
begin
  v_actor:=public._brand_actor();
  select * into v_pack from public.brand_production_packs where id=p_pack_id for update;
  if v_pack.id is null then raise exception 'El paquete no existe.'; end if;
  if p_decision='Enviar a revisión' then v_status:='En revisión';
  elsif p_decision='Aprobar' then v_status:='Aprobado';
  elsif p_decision='Archivar' then v_status:='Archivado';
  else raise exception 'Decisión de paquete inválida.'; end if;
  if v_pack.status in ('Aprobado','Archivado') then raise exception 'El paquete ya está cerrado; creá una nueva versión.'; end if;
  if v_status='Aprobado' then
    if not public.has_current_role('Administrador') then raise exception 'Solo Administración puede aprobar paquetes para motores externos.'; end if;
    if length(btrim(coalesce(p_note,'')))<5 then raise exception 'Documentá qué referencias verificaste.'; end if;
    v_state:=public.estado_paquete_produccion(p_pack_id);
    if not coalesce((v_state->>'ready')::boolean,false) then raise exception 'El paquete no está listo: %',v_state#>>'{reasons,0}'; end if;
  end if;
  update public.brand_production_packs set status=v_status,reviewed_by=v_actor.id,reviewed_at=now(),review_note=btrim(coalesce(p_note,'')) where id=p_pack_id;
  perform public._add_audit('Paquetes producción',p_pack_id::text,'Paquete '||lower(v_status),v_pack.status,v_status||' · '||btrim(coalesce(p_note,'')));
  return jsonb_build_object('ok',true,'pack_id',p_pack_id,'status',v_status,'external_execution',false);
end $$;

create or replace function public.preparar_trabajo_desde_paquete_produccion(p_pack_id bigint,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype;
  v_pack public.brand_production_packs%rowtype;
  v_state jsonb;
  v_assets jsonb;
  v_payload jsonb;
  v_result jsonb;
begin
  v_actor:=public._brand_actor();
  select * into v_pack from public.brand_production_packs where id=p_pack_id;
  if v_pack.id is null or v_pack.status<>'Aprobado' then raise exception 'Elegí un paquete de producción aprobado.'; end if;
  v_state:=public.estado_paquete_produccion(p_pack_id);
  if not coalesce((v_state->>'ready')::boolean,false) then raise exception 'El paquete dejó de estar listo: %',v_state#>>'{reasons,0}'; end if;
  select coalesce(jsonb_agg(asset_id order by sequence,asset_id),'[]'::jsonb) into v_assets
  from (select distinct on(asset_id) asset_id,sequence from public.brand_production_pack_assets where pack_id=p_pack_id order by asset_id,sequence) x;
  v_payload:=coalesce(p,'{}'::jsonb)||jsonb_build_object(
    'input_asset_ids',v_assets,
    'target_channel',v_pack.channel,
    'target_format',v_pack.target_format,
    'output_spec',coalesce(p->'output_spec','{}'::jsonb)||jsonb_build_object(
      'production_pack_id',v_pack.id,'production_pack_version',v_pack.version,
      'production_pack_fingerprint',v_pack.fingerprint,'production_pack_name',v_pack.name
    )
  );
  v_result:=public.crear_trabajo_creativo(v_payload);
  perform public._add_audit('Paquetes producción',p_pack_id::text,'Paquete ligado a trabajo',v_pack.fingerprint,'Trabajo #'||(v_result->>'job_id'));
  return v_result||jsonb_build_object('pack_id',p_pack_id,'pack_fingerprint',v_pack.fingerprint,'external_execution',false);
end $$;

-- Un paquete aprobado es una dependencia creativa real y bloquea la retirada
-- silenciosa de cualquiera de sus referencias.
create or replace function public._motivos_bloqueo_eliminacion_activo(p_asset_id bigint) returns text[]
language plpgsql stable security definer set search_path=public as $$
declare v_reasons text[]:='{}'::text[];
begin
  if exists(select 1 from public.brand_asset_production_profiles where asset_id=p_asset_id and canonical) then v_reasons:=array_append(v_reasons,'es una referencia canónica de producción'); end if;
  if exists(select 1 from public.brand_media_assets where id=p_asset_id and tags @> '["animacion:canon"]'::jsonb) then v_reasons:=array_append(v_reasons,'es una referencia canónica del Mundo animado'); end if;
  if exists(select 1 from public.brand_media_usages where asset_id=p_asset_id) then v_reasons:=array_append(v_reasons,'ya fue usado en una pieza creativa'); end if;
  if exists(select 1 from public.creative_generation_jobs where output_asset_id=p_asset_id or input_asset_ids @> jsonb_build_array(p_asset_id)) then v_reasons:=array_append(v_reasons,'está ligado a un trabajo creativo'); end if;
  if exists(select 1 from public.agency_storyboard_shots where p_asset_id=any(input_asset_ids)) then v_reasons:=array_append(v_reasons,'está incluido en una escena'); end if;
  if exists(select 1 from public.agency_scene_quality_reviews where output_asset_id=p_asset_id) then v_reasons:=array_append(v_reasons,'forma parte de una revisión de calidad'); end if;
  if exists(select 1 from public.agency_postproduction_exports where output_asset_id=p_asset_id) then v_reasons:=array_append(v_reasons,'forma parte de una exportación'); end if;
  if exists(select 1 from public.agency_postproduction_export_audio where asset_id=p_asset_id) then v_reasons:=array_append(v_reasons,'está seleccionado como audio de un máster'); end if;
  if exists(select 1 from public.agency_master_releases where output_asset_id=p_asset_id) then v_reasons:=array_append(v_reasons,'está ligado a una publicación trazable'); end if;
  if exists(select 1 from public.brand_media_assets where original_asset_id=p_asset_id and status<>'Eliminado') then v_reasons:=array_append(v_reasons,'es el original de otra versión conservada'); end if;
  if exists(select 1 from public.agency_mcp_asset_claims where asset_id=p_asset_id and expires_at>now()) then v_reasons:=array_append(v_reasons,'tiene una referencia MCP temporal vigente'); end if;
  if exists(select 1 from public.agency_brand_kit_assets where asset_id=p_asset_id) then v_reasons:=array_append(v_reasons,'está ligado a una versión de identidad de marca'); end if;
  if exists(select 1 from public.brand_production_pack_assets m join public.brand_production_packs k on k.id=m.pack_id where m.asset_id=p_asset_id and k.status='Aprobado') then v_reasons:=array_append(v_reasons,'pertenece a un paquete de producción aprobado'); end if;
  return v_reasons;
end $$;

-- El manifiesto evita una RPC extra al abrir Agencia.
create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_capabilities jsonb; v_schema_version text;
begin
  if auth.uid() is null or not exists(select 1 from public.users u where u.auth_id=auth.uid() and u.activo) then raise exception 'Sesion MOMOS invalida.' using errcode='42501'; end if;
  select coalesce(jsonb_object_agg(x.name,to_regprocedure(format('public.%I()',x.name)) is not null),'{}'::jsonb) into v_capabilities
  from unnest(array[
    'roles_multiples_disponible','productos_servidor_disponible','agencia_comercial_disponible','orquestador_agencia_disponible',
    'centro_acciones_agencia_disponible','resultados_acciones_agencia_disponibles','mesa_agencia_disponible','estudio_escenas_disponible',
    'motion_experience_disponible','enrutador_escenas_disponible','calidad_postproduccion_disponible','postproduccion_exportacion_disponible',
    'postproduccion_audio_disponible','retencion_guiones_disponible','retencion_loops_disponible','observatorio_meta_disponible',
    'incrementalidad_meta_disponible','escenarios_inversion_meta_disponible','autorizacion_inversion_meta_disponible','meta_conector_dry_run_disponible',
    'distribucion_comercial_disponible','distribucion_conectores_disponible','biblioteca_creativa_disponible','produccion_creativa_disponible',
    'revision_creativa_disponible','versiones_creativas_disponibles','integraciones_agencia_disponibles','higgsfield_conector_disponible',
    'kling_conector_disponible','gobernanza_marca_disponible','motor_crecimiento_multimodo_disponible','flujo_creativo_e2e_disponible',
    'operacion_pedido_disponible','crm_clientes_disponible','identidad_marca_disponible','mundo_animado_disponible',
    'eliminacion_logo_oficial_disponible','biblioteca_produccion_disponible'
  ]::text[]) x(name);
  select id into v_schema_version from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  return jsonb_build_object('version',1,'schema_version',coalesce(v_schema_version,''),'server_time',clock_timestamp(),
    'capabilities',v_capabilities,'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object('version',extract(epoch from clock_timestamp())::bigint,'ttl_seconds',60),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300)),
    'contains_pii',false,'contains_secrets',false,'external_execution',false);
end $$;

revoke all on function public.biblioteca_produccion_disponible() from public,anon;
revoke all on function public._estado_activo_produccion(bigint) from public,anon,authenticated,service_role;
revoke all on function public.clasificar_activo_produccion(bigint,jsonb) from public,anon;
revoke all on function public.estado_paquete_produccion(bigint) from public,anon;
revoke all on function public.crear_paquete_produccion(jsonb) from public,anon;
revoke all on function public.revisar_paquete_produccion(bigint,text,text) from public,anon;
revoke all on function public.preparar_trabajo_desde_paquete_produccion(bigint,jsonb) from public,anon;
revoke all on function public._motivos_bloqueo_eliminacion_activo(bigint) from public,anon,authenticated,service_role;
revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.biblioteca_produccion_disponible() to authenticated,service_role;
grant execute on function public.clasificar_activo_produccion(bigint,jsonb) to authenticated;
grant execute on function public.estado_paquete_produccion(bigint) to authenticated;
grant execute on function public.crear_paquete_produccion(jsonb) to authenticated;
grant execute on function public.revisar_paquete_produccion(bigint,text,text) to authenticated;
grant execute on function public.preparar_trabajo_desde_paquete_produccion(bigint,jsonb) to authenticated;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

do $$ declare v_table text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['brand_asset_production_profiles','brand_production_packs','brand_production_pack_assets'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

insert into public.momos_ops_migrations(id,detalle)
values('20260718_61_biblioteca_produccion',
  'Componentes UGC, manos, multivistas, estados físicos, locaciones, consentimiento, QA y paquetes reutilizables para motores creativos')
on conflict(id) do update set detalle=excluded.detalle;

commit;
