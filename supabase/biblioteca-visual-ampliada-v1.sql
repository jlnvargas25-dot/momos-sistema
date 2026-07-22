-- MOMOS OPS · H106 · Biblioteca visual ampliada.
-- Agrupa variantes y multivistas, sella consentimiento por canal/finalidad y
-- entrega a Codex únicamente una proyección segura de referencias aprobadas.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_105_humanizacion_comunidad') then
    raise exception 'H106 requiere la cadena hasta H105.';
  end if;
  if to_regclass('public.brand_asset_production_profiles') is null
     or to_regprocedure('public.momos_search_brand_assets(jsonb)') is null
     or to_regprocedure('public.registrar_acceso_mcp_agencia(jsonb)') is null then
    raise exception 'H106 requiere Biblioteca de producción y su gateway MCP.';
  end if;
end $$;

alter table public.brand_asset_production_profiles
  add column if not exists visual_set_key text not null default '',
  add column if not exists variant_label text not null default '',
  add column if not exists identity_visibility text not null default 'No aplica',
  add column if not exists consent_channels jsonb not null default '[]'::jsonb,
  add column if not exists consent_purposes jsonb not null default '[]'::jsonb,
  add column if not exists consent_expires_at date,
  add column if not exists consent_ai_use boolean not null default false;

alter table public.brand_asset_production_profiles
  drop constraint if exists brand_asset_production_visual_set_check,
  drop constraint if exists brand_asset_production_variant_check,
  drop constraint if exists brand_asset_production_visibility_check,
  drop constraint if exists brand_asset_production_consent_channels_check,
  drop constraint if exists brand_asset_production_consent_purposes_check;
alter table public.brand_asset_production_profiles
  add constraint brand_asset_production_visual_set_check check(
    visual_set_key='' or visual_set_key~'^[a-z0-9][a-z0-9._:-]{2,79}$'),
  add constraint brand_asset_production_variant_check check(
    length(variant_label)<=80 and variant_label!~'[[:cntrl:]]'),
  add constraint brand_asset_production_visibility_check check(identity_visibility in (
    'No aplica','Manos sin rostro','Rostro parcial','Rostro identificable')),
  add constraint brand_asset_production_consent_channels_check check(
    jsonb_typeof(consent_channels)='array' and jsonb_array_length(consent_channels)<=8),
  add constraint brand_asset_production_consent_purposes_check check(
    jsonb_typeof(consent_purposes)='array' and jsonb_array_length(consent_purposes)<=8);

create index if not exists brand_asset_production_visual_set_idx
  on public.brand_asset_production_profiles(visual_set_key,component_type,view_angle)
  where visual_set_key<>'';

-- Preserva la autorización H61 sin ampliarla: las personas previamente
-- autorizadas heredan solamente los canales ya permitidos por el original.
update public.brand_asset_production_profiles p
set identity_visibility=case when p.component_type='Manos' then 'Manos sin rostro'
                             else 'Rostro identificable' end,
    consent_channels=case when jsonb_array_length(a.allowed_channels)>0 then a.allowed_channels
                          else '["Todos"]'::jsonb end,
    consent_purposes='["Referencia","Storyboard","Generación","Edición","Revisión"]'::jsonb,
    consent_expires_at=a.rights_expires_at,
    consent_ai_use=true
from public.brand_media_assets a
where a.id=p.asset_id and p.component_type in ('Manos','Presentador UGC')
  and p.consent_status='Autorizado' and a.rights_status='Autorizado'
  and a.ai_use_allowed is true and p.consent_ai_use is false;

create or replace function public.biblioteca_visual_ampliada_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public._visual_scope_values_valid(p_values jsonb,p_kind text) returns boolean
language sql immutable security definer set search_path=public as $$
  select jsonb_typeof(coalesce(p_values,'null'::jsonb))='array'
    and jsonb_array_length(p_values)<=8
    and not exists(
      select 1 from jsonb_array_elements(p_values) e(value)
      where jsonb_typeof(e.value)<>'string'
         or (p_kind='channel' and e.value#>>'{}' not in
           ('Instagram','Facebook','TikTok','YouTube','WhatsApp','Web','Email','Punto de venta','Todos'))
         or (p_kind='purpose' and e.value#>>'{}' not in
           ('Referencia','Storyboard','Generación','Edición','Revisión','Orgánico','Pauta'))
    )
$$;

create or replace function public._estado_activo_produccion(p_asset_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_asset public.brand_media_assets%rowtype;
  v_profile public.brand_asset_production_profiles%rowtype;
  v_reasons text[]:='{}'; v_warnings text[]:='{}';
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
    if v_profile.consent_status<>'Autorizado' or not v_profile.consent_ai_use then
      v_reasons:=array_append(v_reasons,'Falta consentimiento específico para uso creativo con IA.');
    end if;
    if v_profile.identity_visibility='No aplica' then
      v_reasons:=array_append(v_reasons,'Falta declarar el nivel de identificación de la persona.');
    end if;
    if v_profile.consent_expires_at is not null and v_profile.consent_expires_at<current_date then
      v_reasons:=array_append(v_reasons,'El consentimiento específico venció.');
    end if;
    if jsonb_array_length(v_profile.consent_channels)=0 or jsonb_array_length(v_profile.consent_purposes)=0 then
      v_reasons:=array_append(v_reasons,'Falta limitar el consentimiento por canal y finalidad.');
    end if;
  end if;
  if v_profile.source_quality in ('Original con escarcha','Comprimido') then
    v_warnings:=array_append(v_warnings,case v_profile.source_quality
      when 'Original con escarcha' then 'La escarcha puede distorsionar textura, color y geometría.'
      else 'La compresión puede reducir fidelidad.' end);
  end if;
  if v_profile.asset_id is not null and v_profile.visual_set_key='' then
    v_warnings:=array_append(v_warnings,'El activo aún no pertenece a un set visual multivista.');
  end if;
  return jsonb_build_object('ready',cardinality(v_reasons)=0,'reasons',to_jsonb(v_reasons),'warnings',to_jsonb(v_warnings));
end $$;

create or replace function public._estado_activo_visual_v1(p_asset_id bigint,p_channel text,p_purpose text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_state jsonb; v_profile public.brand_asset_production_profiles%rowtype; v_reasons text[];
begin
  v_state:=public._estado_activo_produccion(p_asset_id);
  v_reasons:=array(select jsonb_array_elements_text(coalesce(v_state->'reasons','[]'::jsonb)));
  select * into v_profile from public.brand_asset_production_profiles where asset_id=p_asset_id;
  if v_profile.component_type in ('Manos','Presentador UGC') then
    if btrim(coalesce(p_channel,''))<>'' and not exists(
      select 1 from jsonb_array_elements_text(v_profile.consent_channels) c(value)
      where lower(c.value) in (lower(btrim(p_channel)),'todos')) then
      v_reasons:=array_append(v_reasons,'El consentimiento no cubre el canal solicitado.');
    end if;
    if btrim(coalesce(p_purpose,''))<>'' and not exists(
      select 1 from jsonb_array_elements_text(v_profile.consent_purposes) x(value)
      where lower(x.value)=lower(btrim(p_purpose))) then
      v_reasons:=array_append(v_reasons,'El consentimiento no cubre la finalidad solicitada.');
    end if;
  end if;
  return v_state||jsonb_build_object('ready',cardinality(v_reasons)=0,'reasons',to_jsonb(v_reasons),
    'channel',btrim(coalesce(p_channel,'')),'purpose',btrim(coalesce(p_purpose,'')));
end $$;

create or replace function public.clasificar_activo_produccion(p_asset_id bigint,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_asset public.brand_media_assets%rowtype;
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
  v_set text:=lower(btrim(coalesce(p->>'visual_set_key','')));
  v_variant text:=btrim(coalesce(p->>'variant_label',''));
  v_visibility text:=coalesce(nullif(p->>'identity_visibility',''),'No aplica');
  v_channels jsonb:=coalesce(p->'consent_channels','[]'::jsonb);
  v_purposes jsonb:=coalesce(p->'consent_purposes','[]'::jsonb);
  v_expiry date:=nullif(p->>'consent_expires_at','')::date;
  v_ai_consent boolean:=coalesce((p->>'consent_ai_use')::boolean,false);
  v_readiness jsonb;
begin
  v_actor:=public._brand_actor();
  if not (public.has_current_role('Administrador') or public.has_current_role('Marketing/CRM')) then
    raise exception 'Solo Administración o Marketing/CRM pueden clasificar producción.';
  end if;
  if p is null or jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) k where k not in (
    'component_type','view_angle','physical_state','interaction_type','hand_assignment','location_name',
    'light_direction','scale_reference','continuity_notes','source_quality','qa_status','qa_notes',
    'consent_status','canonical','visual_set_key','variant_label','identity_visibility',
    'consent_channels','consent_purposes','consent_expires_at','consent_ai_use')) then
    raise exception 'La ficha contiene campos no permitidos.';
  end if;
  select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null or v_asset.status='Eliminado' then raise exception 'El original no existe.'; end if;
  if exists(select 1 from public.brand_production_pack_assets m join public.brand_production_packs k on k.id=m.pack_id
    where m.asset_id=p_asset_id and k.status='Aprobado') then
    raise exception 'El activo pertenece a un paquete aprobado; creá una nueva versión antes de reclasificarlo.';
  end if;
  if v_component not in ('Producto','Empaque','Manos','Presentador UGC','Locación','Movimiento','Marca','Audio','Personaje') then raise exception 'Componente de producción inválido.'; end if;
  if v_view not in ('No aplica','Frontal','Trasera','Perfil izquierdo','Perfil derecho','Tres cuartos','Superior','Detalle / macro','POV','Plano general') then raise exception 'Vista de producción inválida.'; end if;
  if v_state not in ('No aplica','Intacto','Congelado','Listo para servir','Abierto','Cortado','Cucharada','En mano','Empaque cerrado','Empaque abierto') then raise exception 'Estado físico inválido.'; end if;
  if v_interaction not in ('Ninguna','Sostener','Abrir','Sacar','Cortar','Presionar','Servir','Probar','Movimiento de cámara','Ambiente') then raise exception 'Interacción inválida.'; end if;
  if v_hand not in ('Ninguna','Derecha','Izquierda','Ambas','Fuera de cuadro') then raise exception 'Asignación de manos inválida.'; end if;
  if v_quality not in ('Original limpio','Original con escarcha','Comprimido','Restaurado','Generado') then raise exception 'Calidad de fuente inválida.'; end if;
  if v_qa not in ('Pendiente','Aprobado','Condicionado','Rechazado') then raise exception 'Estado de QA inválido.'; end if;
  if v_consent not in ('No aplica','Pendiente','Autorizado','Vencido','Restringido') then raise exception 'Consentimiento inválido.'; end if;
  if v_set<>'' and v_set!~'^[a-z0-9][a-z0-9._:-]{2,79}$' then raise exception 'La clave del set visual es inválida.'; end if;
  if length(v_variant)>80 or v_variant~'[[:cntrl:]]' then raise exception 'La variante visual es inválida.'; end if;
  if v_component='Locación' and length(v_location)<2 then raise exception 'Identificá la locación.'; end if;
  if v_component<>'Locación' then v_location:=''; end if;
  if v_component in ('Manos','Presentador UGC') then
    if not v_asset.contains_people then raise exception 'Este componente debe declararse como contenido con personas.'; end if;
    if v_visibility not in ('Manos sin rostro','Rostro parcial','Rostro identificable') then raise exception 'Declaración de identidad inválida.'; end if;
    if not public._visual_scope_values_valid(v_channels,'channel')
       or not public._visual_scope_values_valid(v_purposes,'purpose') then raise exception 'Canales o finalidades de consentimiento inválidos.'; end if;
    if v_consent='Autorizado' and (not v_ai_consent or jsonb_array_length(v_channels)=0
       or jsonb_array_length(v_purposes)=0 or (v_expiry is not null and v_expiry<current_date)) then
      raise exception 'La autorización exige IA, canal, finalidad y vigencia coherentes.';
    end if;
    if v_qa='Aprobado' and (v_asset.rights_status<>'Autorizado' or v_consent<>'Autorizado') then
      raise exception 'No se puede aprobar QA humano sin derechos y consentimiento autorizados.';
    end if;
  else
    v_consent:='No aplica'; v_visibility:='No aplica'; v_channels:='[]'::jsonb;
    v_purposes:='[]'::jsonb; v_expiry:=null; v_ai_consent:=false;
  end if;
  if v_qa='Aprobado' and (v_asset.status<>'Activo' or v_asset.rights_status not in ('Propio','Autorizado')
    or not v_asset.ai_use_allowed or (v_asset.rights_expires_at is not null and v_asset.rights_expires_at<current_date)) then
    raise exception 'El original no puede aprobarse: faltan estado activo, derechos o permiso IA vigente.';
  end if;
  if v_canonical and not public.has_current_role('Administrador') then raise exception 'Solo Administración puede declarar una referencia canónica.'; end if;
  insert into public.brand_asset_production_profiles(
    asset_id,component_type,view_angle,physical_state,interaction_type,hand_assignment,
    location_name,light_direction,scale_reference,continuity_notes,source_quality,qa_status,
    qa_notes,consent_status,canonical,visual_set_key,variant_label,identity_visibility,
    consent_channels,consent_purposes,consent_expires_at,consent_ai_use,created_by,updated_by
  ) values(
    p_asset_id,v_component,v_view,v_state,v_interaction,v_hand,v_location,
    btrim(coalesce(p->>'light_direction','')),btrim(coalesce(p->>'scale_reference','')),
    btrim(coalesce(p->>'continuity_notes','')),v_quality,v_qa,btrim(coalesce(p->>'qa_notes','')),
    v_consent,v_canonical,v_set,v_variant,v_visibility,v_channels,v_purposes,v_expiry,v_ai_consent,v_actor.id,v_actor.id
  ) on conflict(asset_id) do update set
    component_type=excluded.component_type,view_angle=excluded.view_angle,physical_state=excluded.physical_state,
    interaction_type=excluded.interaction_type,hand_assignment=excluded.hand_assignment,
    location_name=excluded.location_name,light_direction=excluded.light_direction,
    scale_reference=excluded.scale_reference,continuity_notes=excluded.continuity_notes,
    source_quality=excluded.source_quality,qa_status=excluded.qa_status,qa_notes=excluded.qa_notes,
    consent_status=excluded.consent_status,canonical=excluded.canonical,visual_set_key=excluded.visual_set_key,
    variant_label=excluded.variant_label,identity_visibility=excluded.identity_visibility,
    consent_channels=excluded.consent_channels,consent_purposes=excluded.consent_purposes,
    consent_expires_at=excluded.consent_expires_at,consent_ai_use=excluded.consent_ai_use,
    updated_by=v_actor.id,updated_at=now();
  v_readiness:=public._estado_activo_produccion(p_asset_id);
  perform public._add_audit('Biblioteca producción',p_asset_id::text,'Ficha visual H106 guardada','',
    v_component||' · '||v_view||' · set '||coalesce(nullif(v_set,''),'sin agrupar')||' · QA '||v_qa);
  return jsonb_build_object('ok',true,'asset_id',p_asset_id,'readiness',v_readiness,
    'human_approval_required',true,'external_execution',false);
end $$;

-- La huella de una referencia incluye ahora su clasificación y alcance de
-- consentimiento. Un cambio de canal, finalidad o vigencia invalida el grant.
create or replace function public._mcp_brand_asset_fingerprint(p_asset_id bigint) returns text
language sql stable security definer set search_path=public set timezone='UTC' as $$
  select md5(jsonb_build_object('asset',to_jsonb(a),'production_profile',to_jsonb(p))::text)
  from public.brand_media_assets a
  left join public.brand_asset_production_profiles p on p.asset_id=a.id
  where a.id=p_asset_id
$$;

create or replace function public._mcp_brand_asset_eligible(p_asset_id bigint,p_channel text default '') returns boolean
language sql stable security definer set search_path=public,storage as $$
  select exists(
    select 1 from public.brand_media_assets a
    where a.id=p_asset_id and a.status='Activo' and a.ai_use_allowed is true
      and a.rights_status in ('Propio','Autorizado')
      and (a.rights_expires_at is null or a.rights_expires_at>=current_date)
      and (not a.contains_people or (
        a.rights_status='Autorizado'
        and coalesce((public._estado_activo_visual_v1(a.id,p_channel,'')->>'ready')::boolean,false)))
      and public._mcp_brand_asset_text_safe(a.name)
      and public._mcp_brand_asset_text_safe(coalesce(a.figure,''))
      and public._mcp_brand_asset_text_safe(coalesce(a.flavor,''))
      and public._mcp_brand_asset_text_safe(coalesce(a.shot_type,''))
      and ((a.media_type in ('Foto','Logo') and a.mime_type in ('image/jpeg','image/png','image/webp','image/gif') and a.orientation in ('Vertical','Horizontal','Cuadrado'))
        or (a.media_type='Video' and a.mime_type in ('video/mp4','video/quicktime','video/webm') and a.orientation in ('Vertical','Horizontal','Cuadrado'))
        or (a.media_type='Audio' and a.mime_type in ('audio/mpeg','audio/mp4','audio/wav') and a.orientation='Audio')
        or (a.media_type='Diseño' and (a.mime_type in ('image/jpeg','image/png','image/webp','image/gif') or a.mime_type='application/pdf') and a.orientation in ('Vertical','Horizontal','Cuadrado','Documento')))
      and exists(select 1 from storage.objects o where o.bucket_id='brand-assets' and o.name=a.storage_path)
      and (btrim(coalesce(p_channel,''))='' or jsonb_array_length(a.allowed_channels)=0 or exists(
        select 1 from jsonb_array_elements_text(a.allowed_channels) c(value)
        where lower(btrim(c.value)) in (lower(btrim(p_channel)),'todos','all')))
  )
$$;

create or replace function public._agency_mcp_visual_claim_scope_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_state jsonb;
begin
  v_state:=public._estado_activo_visual_v1(new.asset_id,new.channel,new.purpose);
  if not coalesce((v_state->>'ready')::boolean,false) then
    raise exception 'La referencia visual no cubre el canal o la finalidad solicitada.';
  end if;
  return new;
end $$;
drop trigger if exists agency_mcp_visual_claim_scope_guard on public.agency_mcp_asset_claims;
create trigger agency_mcp_visual_claim_scope_guard before insert on public.agency_mcp_asset_claims
for each row execute function public._agency_mcp_visual_claim_scope_guard();

create or replace function public.momos_visual_library_v1(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_component text:=btrim(coalesce(p->>'component_type',''));
  v_set text:=lower(btrim(coalesce(p->>'visual_set_key','')));
  v_product text:=btrim(coalesce(p->>'product_id',''));
  v_figure text:=btrim(coalesce(p->>'figure',''));
  v_flavor text:=btrim(coalesce(p->>'flavor',''));
  v_channel text:=btrim(coalesce(p->>'channel',''));
  v_purpose text:=btrim(coalesce(p->>'purpose','Referencia'));
  v_views jsonb:=coalesce(p->'required_views','[]'::jsonb);
  v_limit integer:=coalesce(nullif(p->>'limit','')::integer,20);
  v_sets jsonb; v_asset_count integer;
begin
  if p is null or jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) k where k not in
    ('component_type','visual_set_key','product_id','figure','flavor','channel','purpose','required_views','limit')) then
    raise exception 'Los filtros de Biblioteca visual no son válidos.';
  end if;
  if v_component<>'' and v_component not in ('Producto','Empaque','Manos','Presentador UGC','Locación','Movimiento','Marca','Audio','Personaje') then raise exception 'Componente visual inválido.'; end if;
  if v_set<>'' and v_set!~'^[a-z0-9][a-z0-9._:-]{2,79}$' then raise exception 'Set visual inválido.'; end if;
  if v_channel not in ('Instagram','Facebook','TikTok','YouTube','WhatsApp','Web','Email','Punto de venta')
     or v_purpose not in ('Referencia','Storyboard','Generación','Edición','Revisión','Orgánico','Pauta') then
    raise exception 'Canal o finalidad inválidos.';
  end if;
  if v_limit<1 or v_limit>50 or jsonb_typeof(v_views)<>'array' or jsonb_array_length(v_views)>10
     or exists(select 1 from jsonb_array_elements(v_views) e(value) where jsonb_typeof(e.value)<>'string'
       or e.value#>>'{}' not in ('Frontal','Trasera','Perfil izquierdo','Perfil derecho','Tres cuartos','Superior','Detalle / macro','POV','Plano general')) then
    raise exception 'Cobertura visual inválida.';
  end if;
  if not public._mcp_brand_asset_text_safe(v_product) or not public._mcp_brand_asset_text_safe(v_figure)
     or not public._mcp_brand_asset_text_safe(v_flavor) then raise exception 'Un filtro visual contiene datos no permitidos.'; end if;

  with eligible as (
    select a.id,a.created_at,p.component_type,p.view_angle,p.physical_state,p.interaction_type,
      p.visual_set_key,p.variant_label,p.identity_visibility,p.canonical,
      public._mcp_brand_asset_snapshot(a.id)||jsonb_build_object('production_profile',jsonb_build_object(
        'component_type',p.component_type,'view_angle',p.view_angle,'physical_state',p.physical_state,
        'interaction_type',p.interaction_type,'visual_set_key',p.visual_set_key,
        'variant_label',p.variant_label,'identity_visibility',p.identity_visibility,'canonical',p.canonical,
        'consent_valid',case when p.component_type in ('Manos','Presentador UGC') then true else null end)) item
    from public.brand_media_assets a join public.brand_asset_production_profiles p on p.asset_id=a.id
    where p.qa_status='Aprobado' and coalesce((public._estado_activo_visual_v1(a.id,v_channel,v_purpose)->>'ready')::boolean,false)
      and exists(select 1 from storage.objects o where o.bucket_id='brand-assets' and o.name=a.storage_path)
      and (v_component='' or p.component_type=v_component)
      and (v_set='' or p.visual_set_key=v_set)
      and (v_product='' or a.product_id=v_product)
      and (v_figure='' or public._mcp_brand_asset_normalize(a.figure)=public._mcp_brand_asset_normalize(v_figure))
      and (v_flavor='' or public._mcp_brand_asset_normalize(a.flavor)=public._mcp_brand_asset_normalize(v_flavor))
    order by p.canonical desc,a.created_at desc,a.id desc limit v_limit
  ), grouped as (
    select coalesce(nullif(visual_set_key,''),'asset:'||id::text) set_key,
      min(component_type) component_type,
      array_agg(distinct view_angle order by view_angle) available_views,
      jsonb_agg(item order by canonical desc,created_at desc,id desc) assets
    from eligible group by coalesce(nullif(visual_set_key,''),'asset:'||id::text)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'set_key',g.set_key,'component_type',g.component_type,'available_views',to_jsonb(g.available_views),
    'coverage_complete',not exists(select 1 from jsonb_array_elements_text(v_views) r(view) where not r.view=any(g.available_views)),
    'assets',g.assets) order by g.set_key),'[]'::jsonb),
    coalesce(sum(jsonb_array_length(g.assets)),0)::integer
  into v_sets,v_asset_count from grouped g;

  return jsonb_build_object('schema_version','momos-visual-library/v1',
    'filters',jsonb_build_object('component_type',v_component,'visual_set_key',v_set,'product_id',v_product,
      'figure',v_figure,'flavor',v_flavor,'channel',v_channel,'purpose',v_purpose,'required_views',v_views),
    'set_count',jsonb_array_length(v_sets),'asset_count',v_asset_count,'sets',v_sets,
    'privacy',jsonb_build_object('contains_storage_paths',false,'contains_people_identity',false,
      'contains_consent_evidence',false,'contains_pii',false,'contains_secrets',false),
    'human_review_required',true,'external_execution_allowed',false);
end $$;

-- H106 corrige además la lista de herramientas auditables: H103/H105 ya
-- existían, pero sus nombres aún no cabían en el constraint heredado de H62.
alter table public.agency_mcp_access_log drop constraint if exists agency_mcp_access_log_tool_name_check;
alter table public.agency_mcp_access_log add constraint agency_mcp_access_log_tool_name_check check(tool_name in (
  'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_intelligence',
  'momos_propose_creative_formula','momos_humanization_community','momos_propose_humanization_series',
  'momos_propose_humanization_episode','momos_visual_library','momos_creative_context',
  'momos_search_brand_assets','momos_get_brand_asset_reference','momos_submit_proposals',
  'momos_request_human_approval','momos_get_human_approval'));

create or replace function public.registrar_acceso_mcp_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'request_key','')); v_tool text:=btrim(coalesce(p->>'tool_name',''));
  v_mode text:=btrim(coalesce(p->>'mode','')); v_status text:=btrim(coalesce(p->>'status',''));
  v_worker text:=btrim(coalesce(p->>'worker_id','')); v_subject text:=left(btrim(coalesce(p->>'subject_ref','')),180);
  v_input text:=btrim(coalesce(p->>'input_fingerprint','')); v_output text:=btrim(coalesce(p->>'output_fingerprint',''));
  v_details jsonb:=coalesce(p->'details','{}'::jsonb); v_existing public.agency_mcp_access_log%rowtype; v_id bigint;
begin
  if p is null or jsonb_typeof(p)<>'object' or not public._agency_mcp_json_safe(p) then raise exception 'Registro MCP inválido o con secretos.'; end if;
  if v_key!~'^[A-Za-z0-9:_-]{3,180}$' or v_tool not in (
      'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_intelligence',
      'momos_propose_creative_formula','momos_humanization_community','momos_propose_humanization_series',
      'momos_propose_humanization_episode','momos_visual_library','momos_creative_context',
      'momos_search_brand_assets','momos_get_brand_asset_reference','momos_submit_proposals',
      'momos_request_human_approval','momos_get_human_approval')
    or v_mode not in ('Lectura','Propuesta','Referencia','Solicitud') or v_status not in ('OK','Denegado','Fallido')
    or length(v_worker) not between 2 and 120 or v_input!~'^[0-9a-f]{32}$'
    or (v_output<>'' and v_output!~'^[0-9a-f]{32}$') or jsonb_typeof(v_details)<>'object' then
    raise exception 'Contrato de bitácora MCP inválido.';
  end if;
  if (v_tool in ('momos_submit_proposals','momos_propose_creative_formula','momos_propose_humanization_series','momos_propose_humanization_episode') and v_mode<>'Propuesta')
     or (v_tool='momos_get_brand_asset_reference' and v_mode<>'Referencia')
     or (v_tool='momos_request_human_approval' and v_mode<>'Solicitud')
     or (v_tool not in ('momos_submit_proposals','momos_propose_creative_formula','momos_propose_humanization_series','momos_propose_humanization_episode','momos_get_brand_asset_reference','momos_request_human_approval') and v_mode<>'Lectura') then
    raise exception 'El modo no coincide con la herramienta MCP.';
  end if;
  insert into public.agency_mcp_access_log(request_key,tool_name,mode,status,worker_id,subject_ref,input_fingerprint,output_fingerprint,details)
  values(v_key,v_tool,v_mode,v_status,v_worker,v_subject,v_input,v_output,v_details)
  on conflict(request_key) do nothing returning id into v_id;
  if v_id is null then
    select * into v_existing from public.agency_mcp_access_log where request_key=v_key;
    if v_existing.tool_name<>v_tool or v_existing.mode<>v_mode or v_existing.status<>v_status
       or v_existing.worker_id<>v_worker or v_existing.subject_ref<>v_subject
       or v_existing.input_fingerprint<>v_input or v_existing.output_fingerprint<>v_output
       or v_existing.details<>v_details then raise exception 'La clave MCP ya fue usada con otro contrato.'; end if;
    return jsonb_build_object('ok',true,'id',v_existing.id,'duplicate',true);
  end if;
  return jsonb_build_object('ok',true,'id',v_id,'duplicate',false);
end $$;

do $$ declare v_signature text;
begin
  foreach v_signature in array array[
    '_visual_scope_values_valid(jsonb,text)','_estado_activo_visual_v1(bigint,text,text)',
    '_agency_mcp_visual_claim_scope_guard()'
  ] loop execute format('revoke all on function public.%s from public,anon,authenticated,service_role',v_signature); end loop;
end $$;
revoke all on function public.biblioteca_visual_ampliada_disponible() from public,anon,authenticated,service_role;
revoke all on function public.momos_visual_library_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.biblioteca_visual_ampliada_disponible() to authenticated,service_role;
grant execute on function public.momos_visual_library_v1(jsonb) to service_role;

comment on column public.brand_asset_production_profiles.visual_set_key is
  'Agrupa vistas y variantes del mismo sujeto visual sin duplicar el original.';
comment on function public.momos_visual_library_v1(jsonb) is
  'Proyección segura para Codex: sets, cobertura y activos aprobados sin rutas, identidad ni evidencia legal.';

insert into public.momos_ops_migrations(id,detalle)
values('20260722_106_biblioteca_visual_ampliada',
  'Sets multivista, variantes, consentimiento por canal/finalidad/vigencia y memoria visual segura para Codex')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260722_106_biblioteca_visual_ampliada';
