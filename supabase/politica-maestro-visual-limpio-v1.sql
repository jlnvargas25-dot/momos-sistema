-- MOMOS OPS · H111 · Política de máster visual limpio.
-- El original siempre se conserva. Escarcha y condensación solo pueden vivir como
-- variantes artísticas; imagen IA, video IA y Elements exigen un máster limpio.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_110_calidad_maestra_biblioteca_ia') then
    raise exception 'H111 requiere la cadena operativa hasta H110.';
  end if;
end $$;

create or replace function public._visual_quality_array_valid(p_values jsonb,p_kind text)
returns boolean language sql immutable security definer set search_path=public as $$
  select jsonb_typeof(coalesce(p_values,'null'::jsonb))='array'
    and jsonb_array_length(p_values)<=12
    and (select count(*)=count(distinct value) from jsonb_array_elements_text(p_values))
    and not exists(
      select 1 from jsonb_array_elements(p_values) e(value)
      where jsonb_typeof(e.value)<>'string'
         or (p_kind='issue' and e.value#>>'{}' not in (
           'Desenfoque','Escarcha','Condensación','Reflejo fuerte','Oclusión','Recorte incompleto',
           'Color o textura incorrectos','Logo o texto ilegible','Fondo contaminado',
           'Compresión visible','Identidad o geometría inestable'))
         or (p_kind='check' and e.value#>>'{}' not in (
           'Enfoque y exposición','Identidad y geometría','Color y textura',
           'Recorte y oclusiones','Logo y texto','Fondo y reflejos'))
    )
$$;

alter table public.brand_visual_quality_assessments
  drop constraint if exists brand_visual_quality_assessments_status_check;
alter table public.brand_visual_quality_assessments
  add constraint brand_visual_quality_assessments_status_check
  check(status in ('Aprobado','Variante artística','Requiere mejora','Requiere nueva toma','Rechazado'));
alter table public.brand_visual_quality_assessments
  drop constraint if exists brand_visual_quality_assessments_recommended_action_check;
alter table public.brand_visual_quality_assessments
  add constraint brand_visual_quality_assessments_recommended_action_check
  check(recommended_action in (
    'Ninguna','Registrar dimensiones','Upscale o nueva toma','Restaurar desde original',
    'Limpiar fondo o reflejos','Declarar máster canónico','Capturar máster limpio','Nueva toma','Rechazar'));

create or replace function public._visual_quality_snapshot_v1(
  p_asset_id bigint,p_issues jsonb,p_checks jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_asset public.brand_media_assets%rowtype;
  v_profile public.brand_asset_production_profiles%rowtype;
  v_common text[]:='{}'; v_ai_blockers text[]:='{}';
  v_digital text[]; v_image text[]; v_video text[]; v_element text[];
  v_warnings text[]:='{}'; v_issue text; v_min integer; v_max integer;
  v_supported boolean; v_is_image boolean; v_is_visual boolean; v_action text:='Ninguna';
  v_status text:='Aprobado'; v_critical boolean:=false; v_frost boolean:=false;
begin
  select * into v_asset from public.brand_media_assets where id=p_asset_id;
  select * into v_profile from public.brand_asset_production_profiles where asset_id=p_asset_id;
  if v_asset.id is null then
    return jsonb_build_object('status','Rechazado','recommended_action','Rechazar',
      'technical',jsonb_build_object('width',null,'height',null,'size_bytes',0,'mime_type',''),
      'warnings','[]'::jsonb,'uses',jsonb_build_object());
  end if;
  v_is_image:=v_asset.mime_type in ('image/jpeg','image/png','image/webp');
  v_is_visual:=v_is_image or v_asset.mime_type in ('video/mp4','video/quicktime','video/webm');
  v_supported:=v_is_visual and v_asset.media_type in ('Foto','Video','Logo','Diseño');
  if v_asset.width is not null and v_asset.height is not null then
    v_min:=least(v_asset.width,v_asset.height); v_max:=greatest(v_asset.width,v_asset.height);
  end if;

  if not v_supported then v_common:=array_append(v_common,'El formato no es una referencia visual apta para este gate.'); end if;
  if v_asset.status<>'Activo' then v_common:=array_append(v_common,'El original no está activo.'); end if;
  if v_asset.rights_status not in ('Propio','Autorizado') or not v_asset.ai_use_allowed
     or (v_asset.rights_expires_at is not null and v_asset.rights_expires_at<current_date) then
    v_common:=array_append(v_common,'Los derechos o el permiso de IA no están vigentes.');
  end if;
  if v_profile.asset_id is null or v_profile.qa_status<>'Aprobado' then
    v_common:=array_append(v_common,'Falta una ficha de producción con QA aprobado.');
  end if;
  if jsonb_array_length(p_checks)<>6 then
    v_common:=array_append(v_common,'La revisión humana no cubrió los seis controles visuales.');
  end if;
  for v_issue in select jsonb_array_elements_text(p_issues) loop
    if v_issue in ('Escarcha','Condensación') then
      v_frost:=true;
      v_ai_blockers:=array_append(v_ai_blockers,
        'La escarcha o condensación impide usar esta referencia como máster IA.');
    else
      v_common:=array_append(v_common,'Hallazgo visual: '||lower(v_issue)||'.');
    end if;
    if v_issue in ('Desenfoque','Oclusión','Recorte incompleto',
      'Color o textura incorrectos','Identidad o geometría inestable') then v_critical:=true; end if;
  end loop;
  if v_profile.source_quality='Original con escarcha' then
    v_frost:=true;
    if not ('La escarcha o condensación impide usar esta referencia como máster IA.'=any(v_ai_blockers)) then
      v_ai_blockers:=array_append(v_ai_blockers,
        'La escarcha o condensación impide usar esta referencia como máster IA.');
    end if;
  elsif v_profile.source_quality='Comprimido' then
    v_common:=array_append(v_common,'La fuente presenta compresión.');
  elsif v_profile.source_quality in ('Restaurado','Generado') and v_asset.original_asset_id is null then
    v_common:=array_append(v_common,'La versión derivada no conserva vínculo con su original.');
  end if;
  if v_profile.asset_id is not null and not v_profile.canonical then
    v_ai_blockers:=array_append(v_ai_blockers,
      'La referencia debe declararse canónica para actuar como máster IA.');
  end if;
  if v_asset.width is null or v_asset.height is null then
    v_common:=array_append(v_common,'Faltan dimensiones verificadas del archivo.');
  end if;
  if v_asset.size_bytes<100000 then
    v_warnings:=array_append(v_warnings,'El archivo pesa menos de 100 KB; revisá compresión y detalle al tamaño final.');
  end if;

  v_digital:=v_common;
  if v_min is not null and v_min<1080 then v_digital:=array_append(v_digital,'El lado corto debe tener al menos 1080 px.'); end if;
  v_image:=v_common||v_ai_blockers;
  if not v_is_image then v_image:=array_append(v_image,'La generación de imagen requiere JPG, PNG o WEBP.'); end if;
  if v_min is not null and (v_min<1024 or v_max<1536) then
    v_image:=array_append(v_image,'La referencia para imagen requiere al menos 1024 px de lado corto y 1536 px de lado largo.');
  end if;
  v_video:=v_common||v_ai_blockers;
  if v_min is not null and (v_min<1080 or v_max<1920) then
    v_video:=array_append(v_video,'La referencia para video requiere al menos 1080 × 1920 px o equivalente horizontal.');
  end if;
  v_element:=v_video;
  if not v_is_image then v_element:=array_append(v_element,'Un Element visual maestro requiere una imagen JPG, PNG o WEBP.'); end if;

  if v_critical then v_status:='Requiere nueva toma'; v_action:='Nueva toma';
  elsif cardinality(v_common)>0 or cardinality(v_digital)>0
        or (v_is_image and cardinality(v_image)>cardinality(v_ai_blockers)) then
    v_status:='Requiere mejora';
    if v_asset.width is null or v_asset.height is null then v_action:='Registrar dimensiones';
    elsif v_profile.source_quality='Comprimido' then v_action:='Restaurar desde original';
    elsif p_issues ?| array['Fondo contaminado','Reflejo fuerte'] then v_action:='Limpiar fondo o reflejos';
    else v_action:='Upscale o nueva toma'; end if;
  elsif v_frost then
    v_status:='Variante artística'; v_action:='Capturar máster limpio';
  elsif cardinality(v_ai_blockers)>0 then
    v_status:='Requiere mejora'; v_action:='Declarar máster canónico';
  else
    v_status:='Aprobado'; v_action:='Ninguna';
  end if;

  return jsonb_build_object(
    'status',v_status,'recommended_action',v_action,
    'technical',jsonb_build_object('width',v_asset.width,'height',v_asset.height,
      'size_bytes',v_asset.size_bytes,'mime_type',v_asset.mime_type,
      'source_quality',coalesce(v_profile.source_quality,''),'original_asset_id',v_asset.original_asset_id),
    'warnings',to_jsonb(v_warnings),
    'uses',jsonb_build_object(
      'digital_content',jsonb_build_object('ready',cardinality(v_digital)=0,'reasons',to_jsonb(v_digital)),
      'image_generation',jsonb_build_object('ready',cardinality(v_image)=0,'reasons',to_jsonb(v_image)),
      'video_generation',jsonb_build_object('ready',cardinality(v_video)=0,'reasons',to_jsonb(v_video)),
      'element',jsonb_build_object('ready',cardinality(v_element)=0,'reasons',to_jsonb(v_element))));
end $$;

-- Revalida dinámicamente la política H111 incluso para certificaciones H110
-- ya existentes; así ningún preflight, autorización o worker puede usar un
-- activo no canónico o con escarcha por conservar un snapshot anterior.
create or replace function public.estado_calidad_activo_visual_v1(p_asset_id bigint,p_target_use text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_row public.brand_visual_quality_assessments%rowtype; v_key text; v_use jsonb;
  v_current text; v_reasons text[]:='{}';
  v_profile public.brand_asset_production_profiles%rowtype; v_original bigint;
begin
  v_key:=case p_target_use when 'Contenido digital' then 'digital_content'
    when 'Generación de imagen' then 'image_generation'
    when 'Generación de video' then 'video_generation'
    when 'Element' then 'element' else '' end;
  if v_key='' then raise exception 'Uso visual objetivo inválido.'; end if;
  select * into v_row from public.brand_visual_quality_assessments
    where asset_id=p_asset_id order by version desc limit 1;
  select * into v_profile from public.brand_asset_production_profiles where asset_id=p_asset_id;
  select original_asset_id into v_original from public.brand_media_assets where id=p_asset_id;
  v_current:=public._visual_quality_source_fingerprint(p_asset_id);
  if v_row.id is null then
    v_reasons:=array_append(v_reasons,'Falta la revisión maestra de calidad para IA.');
  elsif v_row.source_fingerprint<>v_current then
    v_reasons:=array_append(v_reasons,'La ficha o el original cambió después de la última revisión.');
  else
    v_use:=v_row.usage_readiness->v_key;
    if not coalesce((v_use->>'ready')::boolean,false) then
      v_reasons:=array(select jsonb_array_elements_text(coalesce(v_use->'reasons','[]'::jsonb)));
    end if;
  end if;
  if p_target_use<>'Contenido digital' and v_profile.asset_id is not null then
    if v_profile.source_quality='Original con escarcha' or v_row.issues ?| array['Escarcha','Condensación'] then
      v_reasons:=array_append(v_reasons,'La escarcha o condensación impide usar esta referencia como máster IA.');
    end if;
    if not v_profile.canonical then
      v_reasons:=array_append(v_reasons,'La referencia debe declararse canónica para actuar como máster IA.');
    end if;
    if v_profile.source_quality not in ('Original limpio','Restaurado') then
      v_reasons:=array_append(v_reasons,'La fuente no califica como original limpio o restaurado.');
    end if;
    if v_profile.source_quality='Restaurado' and v_original is null then
      v_reasons:=array_append(v_reasons,'La restauración no conserva vínculo con su original.');
    end if;
  end if;
  v_reasons:=array(select distinct x from unnest(v_reasons) x);
  return jsonb_build_object('ready',cardinality(v_reasons)=0,'target_use',p_target_use,
    'reasons',to_jsonb(v_reasons),'assessment_id',v_row.id,'version',v_row.version,
    'status',coalesce(v_row.status,'Pendiente'),'recommended_action',coalesce(v_row.recommended_action,'Registrar dimensiones'),
    'issues',coalesce(v_row.issues,'[]'::jsonb),'technical',coalesce(v_row.technical_snapshot,'{}'::jsonb),
    'warnings',case when v_row.id is null then '[]'::jsonb else
      public._visual_quality_snapshot_v1(p_asset_id,v_row.issues,v_row.checks_completed)->'warnings' end,
    'source_current',v_row.id is not null and v_row.source_fingerprint=v_current,
    'assessment_fingerprint',coalesce(v_row.assessment_fingerprint,''));
end $$;

create or replace function public._brand_clean_master_profile_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_original bigint;
begin
  select original_asset_id into v_original from public.brand_media_assets where id=new.asset_id;
  if new.source_quality='Original con escarcha' and new.canonical then
    raise exception 'Una referencia con escarcha no puede ser canónica; guardala como variante artística.';
  end if;
  if new.canonical and new.component_type in ('Producto','Empaque','Personaje')
     and new.source_quality not in ('Original limpio','Restaurado') then
    raise exception 'El máster canónico de producto, empaque o personaje debe ser limpio o restaurado.';
  end if;
  if new.canonical and new.source_quality='Restaurado' and v_original is null then
    raise exception 'Un máster restaurado debe conservar vínculo con su original.';
  end if;
  return new;
end $$;

drop trigger if exists brand_clean_master_profile_guard on public.brand_asset_production_profiles;
create trigger brand_clean_master_profile_guard
  before insert or update of asset_id,component_type,source_quality,canonical
  on public.brand_asset_production_profiles for each row
  execute function public._brand_clean_master_profile_guard();

create or replace function public.estado_maestro_visual_limpio_v1(p_asset_id bigint)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_asset public.brand_media_assets%rowtype;
  v_profile public.brand_asset_production_profiles%rowtype;
  v_quality jsonb; v_latest jsonb:='[]'::jsonb; v_reasons text[]:='{}';
  v_frost boolean:=false; v_ready boolean:=false; v_class text:='Pendiente de máster';
begin
  select * into v_asset from public.brand_media_assets where id=p_asset_id;
  select * into v_profile from public.brand_asset_production_profiles where asset_id=p_asset_id;
  select issues into v_latest from public.brand_visual_quality_assessments
    where asset_id=p_asset_id order by version desc limit 1;
  v_latest:=coalesce(v_latest,'[]'::jsonb);
  v_frost:=coalesce(v_profile.source_quality='Original con escarcha',false)
    or v_latest ?| array['Escarcha','Condensación'];
  v_quality:=public.estado_calidad_activo_visual_v1(p_asset_id,'Generación de video');

  if v_asset.id is null or v_profile.asset_id is null then
    v_reasons:=array_append(v_reasons,'Falta el activo o su ficha de producción.');
  elsif v_frost then
    v_class:='Variante artística';
    v_reasons:=array_append(v_reasons,'Escarcha o condensación: conservá esta versión y capturá un máster limpio.');
  else
    if not v_profile.canonical then v_reasons:=array_append(v_reasons,'El activo no está declarado canónico.'); end if;
    if v_profile.source_quality not in ('Original limpio','Restaurado') then
      v_reasons:=array_append(v_reasons,'La fuente no califica como original limpio o restaurado.');
    end if;
    if v_profile.source_quality='Restaurado' and v_asset.original_asset_id is null then
      v_reasons:=array_append(v_reasons,'La restauración no conserva vínculo con su original.');
    end if;
    if not coalesce((v_quality->>'ready')::boolean,false) then
      v_reasons:=v_reasons||array(select jsonb_array_elements_text(coalesce(v_quality->'reasons','[]'::jsonb)));
    end if;
    v_ready:=cardinality(v_reasons)=0;
    if v_ready then v_class:='Máster IA limpio'; end if;
  end if;

  return jsonb_build_object('asset_id',p_asset_id,'class',v_class,'ready',v_ready,
    'artistic_variant',v_frost,'source_quality',coalesce(v_profile.source_quality,''),
    'canonical',coalesce(v_profile.canonical,false),'original_asset_id',v_asset.original_asset_id,
    'reasons',to_jsonb(v_reasons),'recommended_action',case
      when v_ready then 'Ninguna' when v_frost then 'Capturar máster limpio'
      else coalesce(v_quality->>'recommended_action','Registrar dimensiones') end,
    'human_review_required',true,'external_execution_allowed',false);
end $$;

create or replace function public.biblioteca_calidad_ia_read_model_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if not public.is_staff() then raise exception 'Solo el equipo MOMOS puede consultar calidad visual.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'asset_id',q.asset_id,'version',q.version,'status',q.status,
    'issues',q.issues,'technical_snapshot',q.technical_snapshot,
    'usage_readiness',jsonb_build_object(
      'digital_content',jsonb_build_object('ready',(d.state->>'ready')::boolean,'reasons',d.state->'reasons'),
      'image_generation',jsonb_build_object('ready',(i.state->>'ready')::boolean,'reasons',i.state->'reasons'),
      'video_generation',jsonb_build_object('ready',(v.state->>'ready')::boolean,'reasons',v.state->'reasons'),
      'element',jsonb_build_object('ready',(e.state->>'ready')::boolean,'reasons',e.state->'reasons')),
    'clean_master_state',public.estado_maestro_visual_limpio_v1(q.asset_id),
    'recommended_action',q.recommended_action,
    'source_current',(d.state->>'source_current')::boolean,
    'assessment_fingerprint',q.assessment_fingerprint,'assessed_at',q.assessed_at)
    order by q.asset_id),'[]'::jsonb) into v_rows
  from (select distinct on(asset_id) * from public.brand_visual_quality_assessments
    order by asset_id,version desc) q
  cross join lateral(select public.estado_calidad_activo_visual_v1(q.asset_id,'Contenido digital') state) d
  cross join lateral(select public.estado_calidad_activo_visual_v1(q.asset_id,'Generación de imagen') state) i
  cross join lateral(select public.estado_calidad_activo_visual_v1(q.asset_id,'Generación de video') state) v
  cross join lateral(select public.estado_calidad_activo_visual_v1(q.asset_id,'Element') state) e;
  return v_rows;
end $$;

-- H111 conserva el contrato de filtros H110 y añade la clasificación explícita
-- de máster limpio en cada referencia. Los activos bloqueados siguen visibles.
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
  v_target text:=btrim(coalesce(p->>'target_use','Contenido digital'));
  v_views jsonb:=coalesce(p->'required_views','[]'::jsonb);
  v_limit integer:=coalesce(nullif(p->>'limit','')::integer,20);
  v_sets jsonb; v_asset_count integer;
begin
  if p is null or jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) k where k not in
    ('component_type','visual_set_key','product_id','figure','flavor','channel','purpose','target_use','required_views','limit')) then
    raise exception 'Los filtros de Biblioteca visual no son válidos.';
  end if;
  if v_component<>'' and v_component not in ('Producto','Empaque','Manos','Presentador UGC','Locación','Movimiento','Marca','Audio','Personaje') then raise exception 'Componente visual inválido.'; end if;
  if v_set<>'' and v_set!~'^[a-z0-9][a-z0-9._:-]{2,79}$' then raise exception 'Set visual inválido.'; end if;
  if v_channel not in ('Instagram','Facebook','TikTok','YouTube','WhatsApp','Web','Email','Punto de venta')
     or v_purpose not in ('Referencia','Storyboard','Generación','Edición','Revisión','Orgánico','Pauta')
     or v_target not in ('Contenido digital','Generación de imagen','Generación de video','Element') then
    raise exception 'Canal, finalidad o uso visual inválidos.';
  end if;
  if v_limit<1 or v_limit>50 or jsonb_typeof(v_views)<>'array' or jsonb_array_length(v_views)>10
     or exists(select 1 from jsonb_array_elements(v_views) e(value) where jsonb_typeof(e.value)<>'string'
       or e.value#>>'{}' not in ('Frontal','Trasera','Perfil izquierdo','Perfil derecho','Tres cuartos','Superior','Detalle / macro','POV','Plano general')) then
    raise exception 'Cobertura visual inválida.';
  end if;
  if not public._mcp_brand_asset_text_safe(v_product) or not public._mcp_brand_asset_text_safe(v_figure)
     or not public._mcp_brand_asset_text_safe(v_flavor) then raise exception 'Un filtro visual contiene datos no permitidos.'; end if;

  with eligible as (
    select a.id,a.created_at,pp.component_type,pp.view_angle,pp.visual_set_key,pp.canonical,
      public._mcp_brand_asset_snapshot(a.id)||jsonb_build_object(
        'ai_quality',public.estado_calidad_activo_visual_v1(a.id,v_target),
        'clean_master',public.estado_maestro_visual_limpio_v1(a.id),
        'production_profile',jsonb_build_object('component_type',pp.component_type,'view_angle',pp.view_angle,
          'physical_state',pp.physical_state,'interaction_type',pp.interaction_type,
          'visual_set_key',pp.visual_set_key,'variant_label',pp.variant_label,
          'identity_visibility',pp.identity_visibility,'source_quality',pp.source_quality,
          'canonical',pp.canonical,
          'consent_valid',case when pp.component_type in ('Manos','Presentador UGC') then true else null end)) item
    from public.brand_media_assets a join public.brand_asset_production_profiles pp on pp.asset_id=a.id
    where pp.qa_status='Aprobado' and coalesce((public._estado_activo_visual_v1(a.id,v_channel,v_purpose)->>'ready')::boolean,false)
      and exists(select 1 from storage.objects o where o.bucket_id='brand-assets' and o.name=a.storage_path)
      and (v_component='' or pp.component_type=v_component) and (v_set='' or pp.visual_set_key=v_set)
      and (v_product='' or a.product_id=v_product)
      and (v_figure='' or public._mcp_brand_asset_normalize(a.figure)=public._mcp_brand_asset_normalize(v_figure))
      and (v_flavor='' or public._mcp_brand_asset_normalize(a.flavor)=public._mcp_brand_asset_normalize(v_flavor))
    order by pp.canonical desc,a.created_at desc,a.id desc limit v_limit
  ), grouped as (
    select coalesce(nullif(visual_set_key,''),'asset:'||id::text) set_key,min(component_type) component_type,
      array_agg(distinct view_angle order by view_angle) available_views,
      jsonb_agg(item order by canonical desc,created_at desc,id desc) assets
    from eligible group by coalesce(nullif(visual_set_key,''),'asset:'||id::text)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'set_key',g.set_key,'component_type',g.component_type,'available_views',to_jsonb(g.available_views),
    'coverage_complete',not exists(select 1 from jsonb_array_elements_text(v_views) r(view) where not r.view=any(g.available_views)),
    'ai_quality',case when g.set_key like 'asset:%' then jsonb_build_object(
      'ready',coalesce((g.assets#>>'{0,ai_quality,ready}')::boolean,false),
      'target_use',v_target,'reasons',coalesce(g.assets#>'{0,ai_quality,reasons}','[]'::jsonb))
      else public.estado_calidad_set_visual_v1(g.set_key,v_target) end,
    'assets',g.assets) order by g.set_key),'[]'::jsonb),
    coalesce(sum(jsonb_array_length(g.assets)),0)::integer into v_sets,v_asset_count from grouped g;

  return jsonb_build_object('schema_version','momos-visual-library/v1','quality_contract_version',2,
    'clean_master_policy_version',1,
    'filters',jsonb_build_object('component_type',v_component,'visual_set_key',v_set,'product_id',v_product,
      'figure',v_figure,'flavor',v_flavor,'channel',v_channel,'purpose',v_purpose,
      'target_use',v_target,'required_views',v_views),
    'set_count',jsonb_array_length(v_sets),'asset_count',v_asset_count,'sets',v_sets,
    'privacy',jsonb_build_object('contains_storage_paths',false,'contains_people_identity',false,
      'contains_consent_evidence',false,'contains_pii',false,'contains_secrets',false),
    'human_review_required',true,'credits_consumed',false,'external_execution_allowed',false);
end $$;

create or replace function public.biblioteca_maestro_limpio_disponible()
returns boolean language sql stable security definer set search_path=public as $$ select true $$;

revoke all on function public._brand_clean_master_profile_guard() from public,anon,authenticated,service_role;
revoke all on function public.estado_maestro_visual_limpio_v1(bigint) from public,anon,authenticated,service_role;
revoke all on function public.biblioteca_maestro_limpio_disponible() from public,anon,authenticated,service_role;
revoke all on function public.biblioteca_calidad_ia_read_model_v1() from public,anon,authenticated,service_role;
revoke all on function public.momos_visual_library_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.biblioteca_maestro_limpio_disponible() to authenticated,service_role;
grant execute on function public.biblioteca_calidad_ia_read_model_v1() to authenticated;
grant execute on function public.momos_visual_library_v1(jsonb) to service_role;

comment on function public.biblioteca_maestro_limpio_disponible() is
  'Capability H111: original preservado, escarcha artística y máster IA limpio enlazado.';
comment on function public.momos_visual_library_v1(jsonb) is
  'Biblioteca MCP con calidad v2 y estado explícito de máster limpio; nunca genera ni consume créditos.';

insert into public.momos_ops_migrations(id,detalle)
values('20260722_111_politica_maestro_visual_limpio',
  'Original preservado, escarcha y condensación como variantes artísticas y máster limpio obligatorio para imagen, video y Elements')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260722_111_politica_maestro_visual_limpio';
