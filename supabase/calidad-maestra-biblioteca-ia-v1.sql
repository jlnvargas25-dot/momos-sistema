-- MOMOS OPS · H110 · Calidad maestra de Biblioteca para IA.
-- Conserva el original, versiona la revisión humana y bloquea generación cuando
-- una referencia no es técnicamente apta para el uso solicitado.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migrations'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null
     or not exists(select 1 from public.momos_ops_migrations
       where id='20260722_109_preparacion_piloto_conectores') then
    raise exception 'H110 requiere la cadena operativa hasta H109.';
  end if;
  if to_regclass('public.brand_media_assets') is null
     or to_regclass('public.brand_asset_production_profiles') is null
     or to_regclass('public.brand_production_packs') is null
     or to_regclass('public.agency_formula_production_plans') is null
     or to_regclass('public.agency_formula_generation_authorizations') is null
     or to_regprocedure('public.momos_visual_library_v1(jsonb)') is null then
    raise exception 'H110 requiere Biblioteca, sets H106 y preflight H107/H108.';
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
           'Desenfoque','Escarcha','Reflejo fuerte','Oclusión','Recorte incompleto',
           'Color o textura incorrectos','Logo o texto ilegible','Fondo contaminado',
           'Compresión visible','Identidad o geometría inestable'))
         or (p_kind='check' and e.value#>>'{}' not in (
           'Enfoque y exposición','Identidad y geometría','Color y textura',
           'Recorte y oclusiones','Logo y texto','Fondo y reflejos'))
    )
$$;

create table if not exists public.brand_visual_quality_assessments(
  id bigint generated always as identity primary key,
  asset_id bigint not null references public.brand_media_assets(id) on delete restrict,
  version integer not null check(version>0),
  status text not null check(status in ('Aprobado','Requiere mejora','Requiere nueva toma','Rechazado')),
  issues jsonb not null default '[]'::jsonb check(public._visual_quality_array_valid(issues,'issue')),
  checks_completed jsonb not null default '[]'::jsonb check(public._visual_quality_array_valid(checks_completed,'check')),
  technical_snapshot jsonb not null check(jsonb_typeof(technical_snapshot)='object'),
  usage_readiness jsonb not null check(jsonb_typeof(usage_readiness)='object'),
  recommended_action text not null check(recommended_action in (
    'Ninguna','Registrar dimensiones','Upscale o nueva toma','Restaurar desde original',
    'Limpiar fondo o reflejos','Nueva toma','Rechazar')),
  review_notes text not null default '' check(length(review_notes)<=600 and review_notes!~'[[:cntrl:]]'),
  source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{32}$'),
  assessment_fingerprint text not null unique check(assessment_fingerprint~'^[0-9a-f]{32}$'),
  assessed_by text not null references public.users(id),
  assessed_at timestamptz not null default clock_timestamp(),
  unique(asset_id,version)
);
create index if not exists brand_visual_quality_asset_idx
  on public.brand_visual_quality_assessments(asset_id,version desc);

alter table public.brand_visual_quality_assessments enable row level security;
drop policy if exists staff_read on public.brand_visual_quality_assessments;
create policy staff_read on public.brand_visual_quality_assessments
  for select to authenticated using(public.is_staff());
revoke all on public.brand_visual_quality_assessments from public,anon,authenticated,service_role;
revoke all on sequence public.brand_visual_quality_assessments_id_seq from public,anon,authenticated,service_role;

create or replace function public._visual_quality_assessment_immutable()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  raise exception 'La revisión de calidad es evidencia inmutable; registrá una versión nueva.';
end $$;
drop trigger if exists brand_visual_quality_assessment_immutable
  on public.brand_visual_quality_assessments;
create trigger brand_visual_quality_assessment_immutable before update or delete
  on public.brand_visual_quality_assessments for each row
  execute function public._visual_quality_assessment_immutable();

create or replace function public._visual_quality_source_fingerprint(p_asset_id bigint)
returns text language sql stable security definer set search_path=public set timezone='UTC' as $$
  select md5(jsonb_build_object('asset',to_jsonb(a),'production_profile',to_jsonb(p))::text)
  from public.brand_media_assets a
  left join public.brand_asset_production_profiles p on p.asset_id=a.id
  where a.id=p_asset_id
$$;

create or replace function public._visual_quality_snapshot_v1(
  p_asset_id bigint,p_issues jsonb,p_checks jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_asset public.brand_media_assets%rowtype;
  v_profile public.brand_asset_production_profiles%rowtype;
  v_common text[]:='{}'; v_digital text[]; v_image text[]; v_video text[]; v_element text[];
  v_warnings text[]:='{}'; v_issue text; v_min integer; v_max integer;
  v_supported boolean; v_is_image boolean; v_is_visual boolean; v_action text:='Ninguna';
  v_status text:='Aprobado'; v_critical boolean:=false;
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
    v_common:=array_append(v_common,'Hallazgo visual: '||lower(v_issue)||'.');
    if v_issue in ('Desenfoque','Escarcha','Oclusión','Recorte incompleto',
      'Color o textura incorrectos','Identidad o geometría inestable') then v_critical:=true; end if;
  end loop;
  if v_profile.source_quality='Original con escarcha' then
    v_common:=array_append(v_common,'La fuente fue clasificada con escarcha.'); v_critical:=true;
  elsif v_profile.source_quality='Comprimido' then
    v_common:=array_append(v_common,'La fuente presenta compresión.');
  elsif v_profile.source_quality in ('Restaurado','Generado') and v_asset.original_asset_id is null then
    v_common:=array_append(v_common,'La versión derivada no conserva vínculo con su original.');
  end if;
  if v_asset.width is null or v_asset.height is null then
    v_common:=array_append(v_common,'Faltan dimensiones verificadas del archivo.');
  end if;
  if v_asset.size_bytes<100000 then
    v_warnings:=array_append(v_warnings,'El archivo pesa menos de 100 KB; revisá compresión y detalle al tamaño final.');
  end if;

  v_digital:=v_common;
  if v_min is not null and v_min<1080 then v_digital:=array_append(v_digital,'El lado corto debe tener al menos 1080 px.'); end if;
  v_image:=v_common;
  if not v_is_image then v_image:=array_append(v_image,'La generación de imagen requiere JPG, PNG o WEBP.'); end if;
  if v_min is not null and (v_min<1024 or v_max<1536) then
    v_image:=array_append(v_image,'La referencia para imagen requiere al menos 1024 px de lado corto y 1536 px de lado largo.');
  end if;
  v_video:=v_common;
  if v_min is not null and (v_min<1080 or v_max<1920) then
    v_video:=array_append(v_video,'La referencia para video requiere al menos 1080 × 1920 px o equivalente horizontal.');
  end if;
  v_element:=v_video;
  if not v_is_image then v_element:=array_append(v_element,'Un Element visual maestro requiere una imagen JPG, PNG o WEBP.'); end if;
  if v_profile.asset_id is not null and not v_profile.canonical then
    v_element:=array_append(v_element,'El activo debe declararse canónico antes de integrarlo a un Element.');
  end if;

  if v_critical then v_status:='Requiere nueva toma'; v_action:='Nueva toma';
  elsif cardinality(v_common)>0 or cardinality(v_video)>0
        or (v_is_image and cardinality(v_image)>0) then
    v_status:='Requiere mejora';
    if v_asset.width is null or v_asset.height is null then v_action:='Registrar dimensiones';
    elsif v_profile.source_quality='Comprimido' then v_action:='Restaurar desde original';
    elsif p_issues ?| array['Fondo contaminado','Reflejo fuerte'] then v_action:='Limpiar fondo o reflejos';
    else v_action:='Upscale o nueva toma'; end if;
  end if;
  if cardinality(v_common)=0 and cardinality(v_video)=0
     and (not v_is_image or cardinality(v_image)=0) then
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
      'element',jsonb_build_object('ready',cardinality(v_element)=0,'reasons',to_jsonb(v_element)))) ;
end $$;

create or replace function public.revisar_calidad_activo_visual_v1(p_asset_id bigint,p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_asset public.brand_media_assets%rowtype;
  v_issues jsonb:=coalesce(p->'issues','[]'::jsonb);
  v_checks jsonb:=coalesce(p->'checks_completed','[]'::jsonb);
  v_notes text:=btrim(coalesce(p->>'review_notes','')); v_snapshot jsonb;
  v_source text; v_fp text; v_version integer; v_id bigint; v_status text; v_action text;
begin
  v_actor:=public._brand_actor();
  if not (public.has_current_role('Administrador') or public.has_current_role('Marketing/CRM')) then
    raise exception 'Solo Administración o Marketing/CRM pueden revisar calidad visual.';
  end if;
  if p is null or jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) k
      where k not in ('issues','checks_completed','review_notes'))
     or not public._visual_quality_array_valid(v_issues,'issue')
     or not public._visual_quality_array_valid(v_checks,'check')
     or jsonb_array_length(v_checks)<>6 or length(v_notes)>600
     or v_notes~'[[:cntrl:]]'
     or v_notes~* '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|api[_ -]?key|access[_ -]?token|service[_ -]?role|password|authorization)'
     or regexp_replace(v_notes,'[^0-9]','','g')~'[0-9]{10,}' then
    raise exception 'La revisión visual no cumple el contrato cerrado o contiene datos sensibles.';
  end if;
  select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null or v_asset.status='Eliminado' then raise exception 'El original visual no existe.'; end if;
  if not exists(select 1 from public.brand_asset_production_profiles where asset_id=p_asset_id) then
    raise exception 'Clasificá primero la ficha de producción del activo.';
  end if;
  v_snapshot:=public._visual_quality_snapshot_v1(p_asset_id,v_issues,v_checks);
  v_status:=v_snapshot->>'status'; v_action:=v_snapshot->>'recommended_action';
  if v_status<>'Aprobado' and length(v_notes)<10 then
    raise exception 'Documentá en al menos 10 caracteres por qué necesita mejora o nueva toma.';
  end if;
  v_source:=public._visual_quality_source_fingerprint(p_asset_id);
  perform pg_advisory_xact_lock(hashtext('visual-quality:'||p_asset_id::text));
  select coalesce(max(version),0)+1 into v_version
    from public.brand_visual_quality_assessments where asset_id=p_asset_id;
  v_fp:=md5(jsonb_build_object('asset_id',p_asset_id,'version',v_version,
    'source_fingerprint',v_source,'issues',v_issues,'checks_completed',v_checks,
    'technical_snapshot',v_snapshot->'technical','usage_readiness',v_snapshot->'uses',
    'status',v_status,'recommended_action',v_action)::text);
  insert into public.brand_visual_quality_assessments(asset_id,version,status,issues,checks_completed,
    technical_snapshot,usage_readiness,recommended_action,review_notes,source_fingerprint,
    assessment_fingerprint,assessed_by)
  values(p_asset_id,v_version,v_status,v_issues,v_checks,v_snapshot->'technical',v_snapshot->'uses',
    v_action,v_notes,v_source,v_fp,v_actor.id) returning id into v_id;
  perform public._add_audit('Biblioteca calidad IA',p_asset_id::text,'Revisión visual v'||v_version::text,
    '',v_status||' · '||v_action);
  return jsonb_build_object('ok',true,'assessment_id',v_id,'asset_id',p_asset_id,
    'version',v_version,'status',v_status,'recommended_action',v_action,
    'usage_readiness',v_snapshot->'uses','warnings',v_snapshot->'warnings',
    'assessment_fingerprint',v_fp,'original_mutated',false,'credits_consumed',false,
    'external_execution',false,'publication_allowed',false);
end $$;

create or replace function public.estado_calidad_activo_visual_v1(p_asset_id bigint,p_target_use text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_row public.brand_visual_quality_assessments%rowtype; v_key text; v_use jsonb;
  v_current text; v_reasons text[]:='{}';
begin
  v_key:=case p_target_use when 'Contenido digital' then 'digital_content'
    when 'Generación de imagen' then 'image_generation'
    when 'Generación de video' then 'video_generation'
    when 'Element' then 'element' else '' end;
  if v_key='' then raise exception 'Uso visual objetivo inválido.'; end if;
  select * into v_row from public.brand_visual_quality_assessments
    where asset_id=p_asset_id order by version desc limit 1;
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
  return jsonb_build_object('ready',cardinality(v_reasons)=0,'target_use',p_target_use,
    'reasons',to_jsonb(v_reasons),'assessment_id',v_row.id,'version',v_row.version,
    'status',coalesce(v_row.status,'Pendiente'),'recommended_action',coalesce(v_row.recommended_action,'Registrar dimensiones'),
    'issues',coalesce(v_row.issues,'[]'::jsonb),'technical',coalesce(v_row.technical_snapshot,'{}'::jsonb),
    'warnings',case when v_row.id is null then '[]'::jsonb else
      public._visual_quality_snapshot_v1(p_asset_id,v_row.issues,v_row.checks_completed)->'warnings' end,
    'source_current',v_row.id is not null and v_row.source_fingerprint=v_current,
    'assessment_fingerprint',coalesce(v_row.assessment_fingerprint,''));
end $$;

create or replace function public.estado_calidad_set_visual_v1(p_set_key text,p_target_use text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_set text:=lower(btrim(coalesce(p_set_key,''))); v_views text[]:='{}';
  v_reasons text[]:='{}'; v_assets jsonb:='[]'::jsonb; v_state jsonb;
  v_row record; v_total integer:=0; v_ready integer:=0; v_component text:=''; v_scale boolean:=false;
begin
  if v_set!~'^[a-z0-9][a-z0-9._:-]{2,79}$' then raise exception 'Set visual inválido.'; end if;
  for v_row in select a.id,a.name,p.component_type,p.view_angle,p.scale_reference
    from public.brand_media_assets a join public.brand_asset_production_profiles p on p.asset_id=a.id
    where a.status='Activo' and p.visual_set_key=v_set order by p.canonical desc,a.id loop
    v_total:=v_total+1; v_component:=v_row.component_type; v_state:=public.estado_calidad_activo_visual_v1(v_row.id,p_target_use);
    v_assets:=v_assets||jsonb_build_array(jsonb_build_object('asset_id',v_row.id,'name',v_row.name,
      'view_angle',v_row.view_angle,'ready',v_state->'ready','status',v_state->'status',
      'recommended_action',v_state->'recommended_action','reasons',v_state->'reasons',
      'assessment_fingerprint',v_state->'assessment_fingerprint'));
    if coalesce((v_state->>'ready')::boolean,false) then
      v_ready:=v_ready+1; v_views:=array_append(v_views,v_row.view_angle);
      v_scale:=v_scale or length(btrim(coalesce(v_row.scale_reference,'')))>=2;
    end if;
  end loop;
  if v_total=0 then v_reasons:=array_append(v_reasons,'El set visual no tiene activos activos.'); end if;
  if v_ready=0 then v_reasons:=array_append(v_reasons,'El set no tiene referencias aptas para el uso solicitado.'); end if;
  if p_target_use in ('Generación de video','Element') and v_component in ('Producto','Empaque','Personaje') then
    if not ('Frontal'=any(v_views)) then v_reasons:=array_append(v_reasons,'Falta una vista frontal apta.'); end if;
    if not (v_views&&array['Tres cuartos','Perfil izquierdo','Perfil derecho','Trasera']) then
      v_reasons:=array_append(v_reasons,'Falta una vista tres cuartos, perfil o trasera apta.');
    end if;
    if not v_scale then v_reasons:=array_append(v_reasons,'Falta una referencia de escala apta.'); end if;
  end if;
  if p_target_use='Element' and v_component in ('Producto','Empaque','Personaje') then
    if not ('Trasera'=any(v_views)) then v_reasons:=array_append(v_reasons,'El Element requiere una vista trasera apta.'); end if;
    if not ('Detalle / macro'=any(v_views)) then v_reasons:=array_append(v_reasons,'El Element requiere una vista de detalle apta.'); end if;
  end if;
  return jsonb_build_object('set_key',v_set,'component_type',v_component,'target_use',p_target_use,
    'ready',cardinality(v_reasons)=0,'reasons',to_jsonb(v_reasons),'available_ready_views',to_jsonb(v_views),
    'asset_count',v_total,'ready_asset_count',v_ready,'assets',v_assets,
    'human_review_required',true,'external_execution_allowed',false);
end $$;

create or replace function public.estado_calidad_paquete_visual_v1(p_pack_id bigint,p_target_use text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_base jsonb; v_reasons text[]:='{}'; v_state jsonb; v_set_state jsonb;
  v_row record; v_sets text[]:='{}'; v_set text;
begin
  v_base:=public.estado_paquete_produccion(p_pack_id);
  if not coalesce((v_base->>'ready')::boolean,false) then
    v_reasons:=array(select jsonb_array_elements_text(coalesce(v_base->'reasons','[]'::jsonb)));
  end if;
  for v_row in select a.id,a.media_type,a.mime_type,p.visual_set_key
    from public.brand_production_pack_assets m join public.brand_media_assets a on a.id=m.asset_id
    left join public.brand_asset_production_profiles p on p.asset_id=a.id where m.pack_id=p_pack_id loop
    if v_row.media_type in ('Foto','Video','Logo') or v_row.mime_type in ('image/jpeg','image/png','image/webp') then
      v_state:=public.estado_calidad_activo_visual_v1(v_row.id,p_target_use);
      if not coalesce((v_state->>'ready')::boolean,false) then
        v_reasons:=array_append(v_reasons,'Activo #'||v_row.id::text||': '||coalesce(v_state#>>'{reasons,0}','calidad pendiente.'));
      end if;
      if p_target_use in ('Generación de video','Element') and coalesce(v_row.visual_set_key,'')='' then
        v_reasons:=array_append(v_reasons,'Activo #'||v_row.id::text||': falta set multivista.');
      elsif coalesce(v_row.visual_set_key,'')<>'' and not v_row.visual_set_key=any(v_sets) then
        v_sets:=array_append(v_sets,v_row.visual_set_key);
      end if;
    end if;
  end loop;
  foreach v_set in array v_sets loop
    v_set_state:=public.estado_calidad_set_visual_v1(v_set,p_target_use);
    if not coalesce((v_set_state->>'ready')::boolean,false) then
      v_reasons:=array_append(v_reasons,'Set '||v_set||': '||coalesce(v_set_state#>>'{reasons,0}','cobertura incompleta.'));
    end if;
  end loop;
  return jsonb_build_object('ready',cardinality(v_reasons)=0,'target_use',p_target_use,
    'reasons',to_jsonb(v_reasons),'pack_id',p_pack_id,'base_readiness',v_base,
    'quality_assessment_required',true,'credits_consumed',false,'external_execution_allowed',false);
end $$;

create or replace function public._agency_formula_plan_visual_quality_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_target text; v_state jsonb;
begin
  if new.status='Aprobado' and (tg_op='INSERT' or old.status is distinct from new.status) then
    v_target:=case when new.operation='Generar imagen' then 'Generación de imagen' else 'Generación de video' end;
    v_state:=public.estado_calidad_paquete_visual_v1(new.production_pack_id,v_target);
    if not coalesce((v_state->>'ready')::boolean,false) then
      raise exception 'El paquete no supera calidad %: %',v_target,coalesce(v_state#>>'{reasons,0}','revisión pendiente.');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists agency_formula_plan_visual_quality_guard on public.agency_formula_production_plans;
create trigger agency_formula_plan_visual_quality_guard before update of status
  on public.agency_formula_production_plans for each row
  execute function public._agency_formula_plan_visual_quality_guard();

create or replace function public._agency_formula_authorization_visual_quality_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_plan public.agency_formula_production_plans%rowtype; v_target text; v_state jsonb;
begin
  select * into v_plan from public.agency_formula_production_plans where id=new.plan_id;
  v_target:=case when v_plan.operation='Generar imagen' then 'Generación de imagen' else 'Generación de video' end;
  v_state:=public.estado_calidad_paquete_visual_v1(v_plan.production_pack_id,v_target);
  if not coalesce((v_state->>'ready')::boolean,false) then
    raise exception 'La calidad visual cambió antes de autorizar: %',coalesce(v_state#>>'{reasons,0}','revisión pendiente.');
  end if;
  return new;
end $$;
drop trigger if exists agency_formula_authorization_visual_quality_guard
  on public.agency_formula_generation_authorizations;
create trigger agency_formula_authorization_visual_quality_guard before insert
  on public.agency_formula_generation_authorizations for each row
  execute function public._agency_formula_authorization_visual_quality_guard();

create or replace function public._creative_job_visual_quality_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_plan public.agency_formula_production_plans%rowtype; v_plan_id bigint; v_target text; v_state jsonb;
begin
  if new.status='En generación' and old.status is distinct from new.status then
    v_plan_id:=nullif(new.output_spec->>'formula_production_plan_id','')::bigint;
    if v_plan_id is not null then
      select * into v_plan from public.agency_formula_production_plans where id=v_plan_id;
      if v_plan.id is null then raise exception 'El trabajo perdió su preflight H107.'; end if;
      v_target:=case when v_plan.operation='Generar imagen' then 'Generación de imagen' else 'Generación de video' end;
      v_state:=public.estado_calidad_paquete_visual_v1(v_plan.production_pack_id,v_target);
      if not coalesce((v_state->>'ready')::boolean,false) then
        raise exception 'El worker no puede reclamar referencias con calidad vencida: %',
          coalesce(v_state#>>'{reasons,0}','revisión pendiente.');
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists creative_job_visual_quality_guard on public.creative_generation_jobs;
create trigger creative_job_visual_quality_guard before update of status
  on public.creative_generation_jobs for each row execute function public._creative_job_visual_quality_guard();

-- La huella MCP cambia si cambia la última certificación de calidad.
create or replace function public._mcp_brand_asset_fingerprint(p_asset_id bigint) returns text
language sql stable security definer set search_path=public set timezone='UTC' as $$
  select md5(jsonb_build_object('asset',to_jsonb(a),'production_profile',to_jsonb(p),
    'quality_assessment',to_jsonb(q))::text)
  from public.brand_media_assets a
  left join public.brand_asset_production_profiles p on p.asset_id=a.id
  left join lateral(select * from public.brand_visual_quality_assessments x
    where x.asset_id=a.id order by x.version desc limit 1) q on true
  where a.id=p_asset_id
$$;

-- H110 mantiene el contrato H106 y añade una meta opcional de calidad. No
-- oculta los bloqueados: Codex necesita ver el motivo para pedir nueva toma.
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
        'production_profile',jsonb_build_object('component_type',pp.component_type,'view_angle',pp.view_angle,
          'physical_state',pp.physical_state,'interaction_type',pp.interaction_type,
          'visual_set_key',pp.visual_set_key,'variant_label',pp.variant_label,
          'identity_visibility',pp.identity_visibility,'canonical',pp.canonical,
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

  return jsonb_build_object('schema_version','momos-visual-library/v1','quality_contract_version',1,
    'filters',jsonb_build_object('component_type',v_component,'visual_set_key',v_set,'product_id',v_product,
      'figure',v_figure,'flavor',v_flavor,'channel',v_channel,'purpose',v_purpose,
      'target_use',v_target,'required_views',v_views),
    'set_count',jsonb_array_length(v_sets),'asset_count',v_asset_count,'sets',v_sets,
    'privacy',jsonb_build_object('contains_storage_paths',false,'contains_people_identity',false,
      'contains_consent_evidence',false,'contains_pii',false,'contains_secrets',false),
    'human_review_required',true,'credits_consumed',false,'external_execution_allowed',false);
end $$;

create or replace function public.biblioteca_calidad_ia_disponible()
returns boolean language sql stable security definer set search_path=public as $$ select true $$;

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

drop trigger if exists momos_agency_snapshot_quality_event_v1 on public.brand_visual_quality_assessments;
create trigger momos_agency_snapshot_quality_event_v1
  after insert or update or delete or truncate on public.brand_visual_quality_assessments
  for each statement execute function public._momos_touch_agency_snapshot_event_v1();

do $$ declare v_signature text;
begin
  foreach v_signature in array array[
    '_visual_quality_array_valid(jsonb,text)','_visual_quality_assessment_immutable()',
    '_visual_quality_source_fingerprint(bigint)','_visual_quality_snapshot_v1(bigint,jsonb,jsonb)',
    'estado_calidad_activo_visual_v1(bigint,text)','estado_calidad_set_visual_v1(text,text)',
    'estado_calidad_paquete_visual_v1(bigint,text)','_agency_formula_plan_visual_quality_guard()',
    '_agency_formula_authorization_visual_quality_guard()','_creative_job_visual_quality_guard()'
  ] loop execute format('revoke all on function public.%s from public,anon,authenticated,service_role',v_signature); end loop;
end $$;
revoke all on function public.revisar_calidad_activo_visual_v1(bigint,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.biblioteca_calidad_ia_disponible() from public,anon,authenticated,service_role;
revoke all on function public.biblioteca_calidad_ia_read_model_v1() from public,anon,authenticated,service_role;
revoke all on function public.momos_visual_library_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.revisar_calidad_activo_visual_v1(bigint,jsonb) to authenticated;
grant execute on function public.biblioteca_calidad_ia_disponible() to authenticated,service_role;
grant execute on function public.biblioteca_calidad_ia_read_model_v1() to authenticated;
grant execute on function public.momos_visual_library_v1(jsonb) to service_role;

comment on table public.brand_visual_quality_assessments is
  'Revisiones humanas append-only; el original nunca se sobrescribe y cada cambio invalida la certificación anterior.';
comment on function public.momos_visual_library_v1(jsonb) is
  'Sets MOMOS con aptitud explícita para contenido digital, imagen IA, video IA o Element; nunca genera ni consume créditos.';

insert into public.momos_ops_migrations(id,detalle)
values('20260722_110_calidad_maestra_biblioteca_ia',
  'Revisión visual versionada, linaje, multivistas y gates de calidad para imagen, video y Elements sin alterar originales ni consumir créditos')
on conflict(id) do update set detalle=excluded.detalle;

commit;

select id,applied_at,detalle from public.momos_ops_migrations
where id='20260722_110_calidad_maestra_biblioteca_ia';
