-- MOMOS OPS · MCP Biblioteca Creativa v1.
-- Paso 54. El MCP busca únicamente activos aptos para IA mediante filtros cerrados.
-- La búsqueda no persiste el texto libre ni expone rutas; un claim privado, corto e
-- idempotente entrega al runtime server-side la ruta exacta para descarga privada directa.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260717_53_motor_crecimiento_multimodo'
  ) then raise exception 'Falta el paso 53_motor_crecimiento_multimodo.'; end if;
  if to_regclass('public.brand_media_assets') is null or to_regclass('storage.objects') is null then
    raise exception 'Falta Biblioteca Creativa o Storage.';
  end if;
  if to_regclass('public.agency_mcp_access_log') is null
     or to_regprocedure('public.registrar_acceso_mcp_agencia(jsonb)') is null
     or to_regprocedure('public._agency_mcp_json_safe(jsonb)') is null then
    raise exception 'Falta el Gateway MCP protegido.';
  end if;
end $$;

-- La bitácora central conserva una lista cerrada de herramientas reales.
alter table public.agency_mcp_access_log
  drop constraint if exists agency_mcp_access_log_tool_name_check;
alter table public.agency_mcp_access_log
  add constraint agency_mcp_access_log_tool_name_check check(tool_name in (
    'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_context',
    'momos_submit_proposals','momos_search_brand_assets','momos_get_brand_asset_reference'
  ));
alter table public.agency_mcp_access_log
  drop constraint if exists agency_mcp_access_log_mode_check;
alter table public.agency_mcp_access_log
  add constraint agency_mcp_access_log_mode_check check(mode in ('Lectura','Propuesta','Referencia'));

-- Snapshot idempotente de resultados. No guarda query, notas, rutas ni identidad humana.
create table if not exists public.agency_mcp_asset_searches(
  request_key text primary key check(request_key ~ '^[A-Za-z0-9:_-]{3,180}$'),
  worker_id text not null check(worker_id ~ '^[A-Za-z0-9._:-]{2,120}$'),
  input_fingerprint text not null check(input_fingerprint ~ '^[0-9a-f]{32}$'),
  result_snapshot jsonb not null check(jsonb_typeof(result_snapshot)='object'),
  output_fingerprint text not null check(output_fingerprint ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  constraint agency_mcp_asset_search_no_secret check(result_snapshot::text !~*
    '"(api[_-]?key|access[_-]?token|refresh[_-]?token|app[_-]?secret|password|service[_-]?role|authorization|signed[_-]?url)"[[:space:]]*:'),
  constraint agency_mcp_asset_search_no_private_fields check(result_snapshot::text !~*
    '"(storage[_-]?path|notes|created[_-]?by|archived[_-]?by|generation[_-]?meta|telefono|direccion|email|customer[_-]?id)"[[:space:]]*:')
);
create index if not exists agency_mcp_asset_searches_worker_idx
  on public.agency_mcp_asset_searches(worker_id,created_at desc);

-- Ledger privado del grant. No guarda URL, credencial ni secreto y jamás se
-- convierte en una referencia pública dentro de PostgreSQL.
create table if not exists public.agency_mcp_asset_claims(
  id bigint generated always as identity primary key,
  request_key text not null unique check(request_key ~ '^[A-Za-z0-9:_-]{3,180}$'),
  worker_id text not null check(worker_id ~ '^[A-Za-z0-9._:-]{2,120}$'),
  asset_id bigint not null references public.brand_media_assets(id) on delete restrict,
  purpose text not null check(purpose in ('Generación','Edición','Storyboard','Referencia','Revisión')),
  channel text not null check(channel in ('Instagram','Facebook','TikTok','YouTube','WhatsApp','Web','Email','Punto de venta')),
  asset_fingerprint text not null check(asset_fingerprint ~ '^[0-9a-f]{32}$'),
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  issued_at timestamptz not null default now(),
  check(expires_at>issued_at and expires_at<=issued_at+interval '15 minutes')
);
create index if not exists agency_mcp_asset_claims_asset_idx
  on public.agency_mcp_asset_claims(asset_id,issued_at desc);
create index if not exists agency_mcp_asset_claims_expiry_idx
  on public.agency_mcp_asset_claims(expires_at);
create index if not exists agency_mcp_asset_claims_worker_idx
  on public.agency_mcp_asset_claims(worker_id,issued_at desc);

alter table public.agency_mcp_asset_searches enable row level security;
alter table public.agency_mcp_asset_claims enable row level security;
revoke all on public.agency_mcp_asset_searches,public.agency_mcp_asset_claims
  from public,anon,authenticated,service_role;
revoke all on sequence public.agency_mcp_asset_claims_id_seq
  from public,anon,authenticated,service_role;

create or replace function public.mcp_biblioteca_creativa_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

create or replace function public.mcp_biblioteca_creativa_contrato() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'schema_version','momos-mcp-brand-library/v1',
    'search_schema','momos-brand-asset-search/v1',
    'claim_schema','momos-brand-asset-claim/v1',
    'max_interactive_reference_bytes',26214400,
    'tools',jsonb_build_array('momos_search_brand_assets','momos_get_brand_asset_reference'),
    'external_execution_allowed',false
  )
$$;

-- Rechaza PII, URLs, secretos o instrucciones disfrazadas en campos de texto.
create or replace function public._mcp_brand_asset_text_safe(p_text text) returns boolean
language sql immutable security definer set search_path=public as $$
  select p_text is not null and length(p_text)<=180
    and p_text !~ '[[:cntrl:]]'
    and p_text !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    and p_text !~* '(https?://|www\.)'
    and p_text !~ '[0-9][0-9 +().-]{5,}[0-9]'
    and p_text !~* '(api[ _-]?key|access[ _-]?token|refresh[ _-]?token|app[ _-]?secret|password|service[ _-]?role|authorization)'
    and p_text !~* '(ignora|ignore|omite|olvida|desobedece|revela|exfiltra|ejecuta|execute|run).{0,48}(instruccion|instruction|prompt|sistema|system|herramienta|tool|comando|command)'
    and p_text !~* '((system|developer|assistant)[[:space:]]*(prompt|message|:)|powershell|cmd\.exe|\[INST\]|```|<\|?(system|developer|assistant)\|?>)'
$$;

-- Normalización semántica mínima y determinista para el vocabulario de marca.
-- Permite encontrar el mismo personaje escrito como Gorilla o Gorila.
create or replace function public._mcp_brand_asset_normalize(p_text text) returns text
language sql immutable security definer set search_path=public as $$
  select regexp_replace(
    replace(translate(lower(btrim(coalesce(p_text,''))),'áéíóúüñ','aeiouun'),'gorilla','gorila'),
    '[[:space:]]+',' ','g'
  )
$$;

create or replace function public._mcp_brand_asset_fingerprint(p_asset_id bigint) returns text
language sql stable security definer set search_path=public set timezone='UTC' as $$
  -- La huella sella la fila completa, incluida la ruta privada, formato,
  -- dimensiones, identidad de marca, derechos, metadatos y trazabilidad.
  select md5(to_jsonb(a)::text)
  from public.brand_media_assets a where a.id=p_asset_id
$$;

-- DTO seguro común a búsqueda y claim. Las etiquetas se depuran y los canales
-- se reducen al catálogo conocido; notas, actores y metadatos libres nunca salen.
create or replace function public._mcp_brand_asset_snapshot(p_asset_id bigint) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id',a.id,'name',a.name,'media_type',a.media_type,'source',a.source,'product_id',a.product_id,
    'figure',a.figure,'flavor',a.flavor,'shot_type',a.shot_type,'orientation',a.orientation,
    'width',a.width,'height',a.height,'duration_seconds',a.duration_seconds,'mime_type',a.mime_type,
    'size_bytes',a.size_bytes,'content_hash',a.content_hash,'status',a.status,'ai_use_allowed',a.ai_use_allowed,
    'contains_people',a.contains_people,'rights_status',a.rights_status,'rights_expires_at',a.rights_expires_at,
    'tags',coalesce((
      select jsonb_agg(t.value order by t.ord)
      from jsonb_array_elements_text(a.tags) with ordinality t(value,ord)
      where t.ord<=20 and length(t.value)<=60 and public._mcp_brand_asset_text_safe(t.value)
    ),'[]'::jsonb),
    'allowed_channels',coalesce((
      select jsonb_agg(c.value order by c.ord)
      from jsonb_array_elements_text(a.allowed_channels) with ordinality c(value,ord)
      where c.value in ('Instagram','Facebook','TikTok','YouTube','WhatsApp','Web','Email','Punto de venta','Todos','all')
    ),'[]'::jsonb),
    'asset_fingerprint',public._mcp_brand_asset_fingerprint(a.id)
  )
  from public.brand_media_assets a where a.id=p_asset_id
$$;

-- Un único predicado gobierna búsqueda y claim para evitar divergencias.
create or replace function public._mcp_brand_asset_eligible(p_asset_id bigint,p_channel text default '') returns boolean
language sql stable security definer set search_path=public,storage as $$
  select exists(
    select 1
    from public.brand_media_assets a
    where a.id=p_asset_id
      and a.status='Activo'
      and a.ai_use_allowed is true
      and a.rights_status in ('Propio','Autorizado')
      and (a.rights_expires_at is null or a.rights_expires_at>=current_date)
      and (not a.contains_people or a.rights_status='Autorizado')
      and public._mcp_brand_asset_text_safe(a.name)
      and public._mcp_brand_asset_text_safe(coalesce(a.figure,''))
      and public._mcp_brand_asset_text_safe(coalesce(a.flavor,''))
      and public._mcp_brand_asset_text_safe(coalesce(a.shot_type,''))
      and (
        (a.media_type in ('Foto','Logo') and a.mime_type in ('image/jpeg','image/png','image/webp','image/gif')
          and a.orientation in ('Vertical','Horizontal','Cuadrado'))
        or (a.media_type='Video' and a.mime_type in ('video/mp4','video/quicktime','video/webm')
          and a.orientation in ('Vertical','Horizontal','Cuadrado'))
        or (a.media_type='Audio' and a.mime_type in ('audio/mpeg','audio/mp4','audio/wav') and a.orientation='Audio')
        or (a.media_type='Diseño' and (a.mime_type in ('image/jpeg','image/png','image/webp','image/gif') or a.mime_type='application/pdf')
          and a.orientation in ('Vertical','Horizontal','Cuadrado','Documento'))
      )
      and exists(select 1 from storage.objects o where o.bucket_id='brand-assets' and o.name=a.storage_path)
      and (btrim(coalesce(p_channel,''))='' or jsonb_array_length(a.allowed_channels)=0 or exists(
        select 1 from jsonb_array_elements_text(a.allowed_channels) c(value)
        where lower(btrim(c.value)) in (lower(btrim(p_channel)),'todos','all')
      ))
  )
$$;

create or replace function public._mcp_asset_ledger_immutable() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  raise exception 'La trazabilidad MCP de Biblioteca es inmutable.';
end $$;
drop trigger if exists agency_mcp_asset_searches_immutable on public.agency_mcp_asset_searches;
create trigger agency_mcp_asset_searches_immutable before update or delete on public.agency_mcp_asset_searches
for each row execute function public._mcp_asset_ledger_immutable();
drop trigger if exists agency_mcp_asset_claims_immutable on public.agency_mcp_asset_claims;
create trigger agency_mcp_asset_claims_immutable before update or delete on public.agency_mcp_asset_claims
for each row execute function public._mcp_asset_ledger_immutable();

-- H51 vuelve a considerar un grant MCP vigente como una dependencia real.
-- Preparar eliminación toma FOR UPDATE y esta función se evalúa bajo ese lock.
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
  if exists(select 1 from public.agency_mcp_asset_claims where asset_id=p_asset_id and expires_at>now()) then
    v_reasons:=array_append(v_reasons,'tiene una referencia MCP temporal vigente');
  end if;
  return v_reasons;
end $$;

-- Revalida todas las dependencias bajo el mismo lock justo antes de cerrar la
-- eliminación. Así un claim y un borrado nunca atraviesan una ventana TOCTOU.
create or replace function public.confirmar_eliminacion_activo_marca(p_asset_id bigint) returns jsonb
language plpgsql security definer set search_path=public,storage as $$
declare v_actor public.users%rowtype; v_asset public.brand_media_assets%rowtype; v_reasons text[];
begin
  v_actor:=public._brand_actor();
  select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null or v_asset.status<>'Eliminando' then raise exception 'No existe una eliminación pendiente.'; end if;
  v_reasons:=public._motivos_bloqueo_eliminacion_activo(p_asset_id);
  if cardinality(v_reasons)>0 then
    raise exception 'La eliminación perdió vigencia: %.',array_to_string(v_reasons,', ');
  end if;
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

-- Extiende la función oficial de auditoría; conserva los contratos anteriores.
create or replace function public.registrar_acceso_mcp_agencia(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_key text:=btrim(coalesce(p->>'request_key','')); v_tool text:=btrim(coalesce(p->>'tool_name',''));
  v_mode text:=btrim(coalesce(p->>'mode','')); v_status text:=btrim(coalesce(p->>'status',''));
  v_worker text:=btrim(coalesce(p->>'worker_id','')); v_subject text:=left(btrim(coalesce(p->>'subject_ref','')),180);
  v_input text:=btrim(coalesce(p->>'input_fingerprint','')); v_output text:=btrim(coalesce(p->>'output_fingerprint',''));
  v_details jsonb:=coalesce(p->'details','{}'::jsonb); v_existing public.agency_mcp_access_log%rowtype; v_id bigint;
begin
  if p is null or jsonb_typeof(p)<>'object' or not public._agency_mcp_json_safe(p) then
    raise exception 'Registro MCP inválido o con secretos.';
  end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,180}$' or v_tool not in (
      'momos_health','momos_agency_snapshot','momos_meta_observatory','momos_creative_context',
      'momos_submit_proposals','momos_search_brand_assets','momos_get_brand_asset_reference'
    ) or v_mode not in ('Lectura','Propuesta','Referencia') or v_status not in ('OK','Denegado','Fallido')
    or length(v_worker) not between 2 and 120 or v_input !~ '^[0-9a-f]{32}$'
    or (v_output<>'' and v_output !~ '^[0-9a-f]{32}$') or jsonb_typeof(v_details)<>'object' then
    raise exception 'Contrato de bitácora MCP inválido.';
  end if;
  if (v_tool='momos_submit_proposals' and v_mode<>'Propuesta')
     or (v_tool='momos_get_brand_asset_reference' and v_mode<>'Referencia')
     or (v_tool not in ('momos_submit_proposals','momos_get_brand_asset_reference') and v_mode<>'Lectura') then
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
       or v_existing.details<>v_details then
      raise exception 'La clave MCP ya fue usada con otro contrato.';
    end if;
    return jsonb_build_object('ok',true,'id',v_existing.id,'duplicate',true);
  end if;
  return jsonb_build_object('ok',true,'id',v_id,'duplicate',false);
end $$;

create or replace function public.momos_search_brand_assets(p jsonb) returns jsonb
language plpgsql security definer set search_path=public,storage as $$
declare
  v_key text:=btrim(coalesce(p->>'request_key','')); v_worker text:=btrim(coalesce(p->>'worker_id',''));
  v_query text:=btrim(coalesce(p->>'query','')); v_types jsonb:=coalesce(p->'media_types','[]'::jsonb);
  v_orientation text:=btrim(coalesce(p->>'orientation','')); v_channel text:=btrim(coalesce(p->>'channel',''));
  v_product text:=btrim(coalesce(p->>'product_id','')); v_figure text:=btrim(coalesce(p->>'figure',''));
  v_flavor text:=btrim(coalesce(p->>'flavor','')); v_limit integer:=coalesce(nullif(p->>'limit','')::integer,10);
  v_input text; v_output text; v_assets jsonb; v_result jsonb; v_existing public.agency_mcp_asset_searches%rowtype;
begin
  if p is null or jsonb_typeof(p)<>'object' or not public._agency_mcp_json_safe(p) then
    raise exception 'Búsqueda de Biblioteca inválida o con secretos.';
  end if;
  if exists(select 1 from jsonb_object_keys(p) k where k not in
    ('request_key','worker_id','query','media_types','orientation','channel','product_id','figure','flavor','limit')) then
    raise exception 'La búsqueda contiene filtros no permitidos.';
  end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,180}$' or v_worker !~ '^[A-Za-z0-9._:-]{2,120}$'
     or length(v_query)>80 or not public._mcp_brand_asset_text_safe(v_query)
     or v_limit<1 or v_limit>20 then raise exception 'Contrato de búsqueda inválido.'; end if;
  if jsonb_typeof(v_types)<>'array' or jsonb_array_length(v_types)>5 or exists(
    select 1 from jsonb_array_elements(v_types) e(value)
    where jsonb_typeof(e.value)<>'string' or e.value#>>'{}' not in ('Foto','Video','Audio','Logo','Diseño')
  ) then raise exception 'Tipos de medio inválidos.'; end if;
  if v_orientation<>'' and v_orientation not in ('Vertical','Horizontal','Cuadrado','Audio','Documento') then
    raise exception 'Orientación inválida.'; end if;
  if v_channel<>'' and v_channel not in ('Instagram','Facebook','TikTok','YouTube','WhatsApp','Web','Email','Punto de venta') then
    raise exception 'Canal inválido.'; end if;
  if not public._mcp_brand_asset_text_safe(v_product) or not public._mcp_brand_asset_text_safe(v_figure)
     or not public._mcp_brand_asset_text_safe(v_flavor) then raise exception 'Un filtro contiene datos no permitidos.'; end if;

  -- Solo la huella se persiste: el texto libre nunca entra a una tabla o bitácora.
  v_input:=md5(jsonb_build_object('query',public._mcp_brand_asset_normalize(v_query),'media_types',v_types,'orientation',v_orientation,
    'channel',v_channel,'product_id',v_product,'figure',v_figure,'flavor',v_flavor,'limit',v_limit)::text);
  select * into v_existing from public.agency_mcp_asset_searches where request_key=v_key;
  if v_existing.request_key is null then
    -- Serializa COUNT+INSERT por worker. Al despertar vuelve a consultar la
    -- clave para que un reintento concurrente conserve el fast-path idempotente.
    perform pg_advisory_xact_lock(hashtext('mcp54:asset-search'),hashtext(v_worker));
    select * into v_existing from public.agency_mcp_asset_searches where request_key=v_key;
  end if;
  if v_existing.request_key is not null then
    if v_existing.worker_id<>v_worker or v_existing.input_fingerprint<>v_input then
      raise exception 'La clave de búsqueda ya fue usada con otros filtros.';
    end if;
    if exists(
      select 1 from jsonb_array_elements(coalesce(v_existing.result_snapshot->'assets','[]'::jsonb)) item
      where not public._mcp_brand_asset_eligible((item->>'id')::bigint,v_channel)
         or public._mcp_brand_asset_fingerprint((item->>'id')::bigint) is distinct from item->>'asset_fingerprint'
    ) then raise exception 'Un activo del resultado perdió vigencia o integridad; buscá con una clave nueva.'; end if;
    return v_existing.result_snapshot||jsonb_build_object('idempotent',true);
  end if;
  if (select count(*) from public.agency_mcp_asset_searches
      where worker_id=v_worker and created_at>now()-interval '1 minute')>=30 then
    raise exception 'El worker superó el límite de 30 búsquedas por minuto.';
  end if;

  select coalesce(jsonb_agg(s.item order by s.rank,s.created_at desc,s.id desc),'[]'::jsonb) into v_assets
  from (
    select a.id,a.created_at,
      case when v_query<>'' and public._mcp_brand_asset_normalize(a.name)=public._mcp_brand_asset_normalize(v_query) then 0
           when v_query<>'' and public._mcp_brand_asset_normalize(a.name) like public._mcp_brand_asset_normalize(v_query)||'%' then 1 else 2 end as rank,
      public._mcp_brand_asset_snapshot(a.id) as item
    from public.brand_media_assets a
    where public._mcp_brand_asset_eligible(a.id,v_channel)
      and (jsonb_array_length(v_types)=0 or a.media_type in (select jsonb_array_elements_text(v_types)))
      and (v_orientation='' or a.orientation=v_orientation)
      and (v_product='' or lower(coalesce(a.product_id,''))=lower(v_product))
      and (v_figure='' or lower(a.figure)=lower(v_figure))
      and (v_flavor='' or lower(a.flavor)=lower(v_flavor))
      and (v_query='' or public._mcp_brand_asset_normalize(concat_ws(' ',a.name,a.figure,a.flavor,a.shot_type,a.product_id,a.tags::text))
        like '%'||public._mcp_brand_asset_normalize(v_query)||'%')
    order by rank,a.created_at desc,a.id desc
    limit v_limit
  ) s;

  v_result:=jsonb_build_object('schema_version','momos-brand-asset-search/v1','ok',true,'idempotent',false,
    'request_key',v_key,'query_fingerprint',md5(public._mcp_brand_asset_normalize(v_query)),
    'count',jsonb_array_length(v_assets),'assets',v_assets,'external_execution_allowed',false,
    'policy',jsonb_build_object('only_active',true,'ai_permission_required',true,'rights_revalidated',true,
      'people_require_authorization',true,'storage_verified',true,'contains_pii',false,'storage_paths_included',false,
      'external_execution',false));
  v_output:=md5(v_result::text);
  v_result:=v_result||jsonb_build_object('fingerprint',v_output);
  insert into public.agency_mcp_asset_searches(request_key,worker_id,input_fingerprint,result_snapshot,output_fingerprint)
  values(v_key,v_worker,v_input,v_result,v_output)
  on conflict(request_key) do nothing;
  if not found then
    select * into v_existing from public.agency_mcp_asset_searches where request_key=v_key;
    if v_existing.worker_id<>v_worker or v_existing.input_fingerprint<>v_input then
      raise exception 'La clave de búsqueda entró en conflicto.';
    end if;
    if exists(
      select 1 from jsonb_array_elements(coalesce(v_existing.result_snapshot->'assets','[]'::jsonb)) item
      where not public._mcp_brand_asset_eligible((item->>'id')::bigint,v_channel)
         or public._mcp_brand_asset_fingerprint((item->>'id')::bigint) is distinct from item->>'asset_fingerprint'
    ) then raise exception 'El resultado concurrente perdió vigencia o integridad; buscá con una clave nueva.'; end if;
    return v_existing.result_snapshot||jsonb_build_object('idempotent',true);
  end if;
  perform public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key',v_key,'tool_name','momos_search_brand_assets','mode','Lectura','status','OK','worker_id',v_worker,
    'subject_ref','brand-assets:'||jsonb_array_length(v_assets)::text,'input_fingerprint',v_input,
    'output_fingerprint',v_output,'details',jsonb_build_object('count',jsonb_array_length(v_assets),
      'media_types',v_types,'orientation',v_orientation,'channel',v_channel,'limit',v_limit,'query_persisted',false)
  ));
  return v_result;
end $$;

create or replace function public.momos_get_brand_asset_reference(p jsonb) returns jsonb
language plpgsql security definer set search_path=public,storage as $$
declare
  v_key text:=btrim(coalesce(p->>'request_key','')); v_worker text:=btrim(coalesce(p->>'worker_id',''));
  v_asset_id bigint:=nullif(p->>'asset_id','')::bigint; v_purpose text:=btrim(coalesce(p->>'purpose',''));
  v_channel text:=btrim(coalesce(p->>'channel','')); v_expected text:=lower(btrim(coalesce(p->>'expected_fingerprint','')));
  v_ttl integer:=coalesce(nullif(p->>'ttl_seconds','')::integer,300); v_current text; v_input text; v_output text;
  v_asset public.brand_media_assets%rowtype; v_claim public.agency_mcp_asset_claims%rowtype; v_result jsonb;
begin
  if p is null or jsonb_typeof(p)<>'object' or not public._agency_mcp_json_safe(p) then
    raise exception 'Solicitud de referencia inválida o con secretos.';
  end if;
  if exists(select 1 from jsonb_object_keys(p) k where k not in
    ('request_key','worker_id','asset_id','purpose','channel','expected_fingerprint','ttl_seconds')) then
    raise exception 'La solicitud contiene campos no permitidos.';
  end if;
  if v_key !~ '^[A-Za-z0-9:_-]{3,180}$' or v_worker !~ '^[A-Za-z0-9._:-]{2,120}$'
     or v_asset_id is null or v_asset_id<=0
     or v_purpose not in ('Generación','Edición','Storyboard','Referencia','Revisión')
     or v_channel not in ('Instagram','Facebook','TikTok','YouTube','WhatsApp','Web','Email','Punto de venta')
     or v_expected !~ '^[0-9a-f]{32}$' or v_ttl<60 or v_ttl>900 then
    raise exception 'Contrato de referencia inválido.';
  end if;
  v_input:=md5(jsonb_build_object('asset_id',v_asset_id,'purpose',v_purpose,'channel',v_channel,
    'expected_fingerprint',v_expected,'ttl_seconds',v_ttl)::text);

  select * into v_claim from public.agency_mcp_asset_claims where request_key=v_key;
  if v_claim.id is null then
    -- El lock por worker vuelve atómico el límite y la emisión. La segunda
    -- lectura preserva idempotencia si otro request igual terminó mientras esperaba.
    perform pg_advisory_xact_lock(hashtext('mcp54:asset-claim'),hashtext(v_worker));
    select * into v_claim from public.agency_mcp_asset_claims where request_key=v_key;
  end if;
  if v_claim.id is not null then
    if v_claim.worker_id<>v_worker or v_claim.asset_id<>v_asset_id or v_claim.purpose<>v_purpose
       or v_claim.channel<>v_channel or v_claim.asset_fingerprint<>v_expected
       or abs(extract(epoch from (v_claim.expires_at-v_claim.issued_at))-v_ttl)>1 then
      raise exception 'La clave de referencia ya fue usada con otro contrato.';
    end if;
    -- El fast-path toma el mismo lock que archivo y eliminación; elegibilidad,
    -- huella y snapshot quedan unidos a una sola versión de la fila.
    select * into v_asset from public.brand_media_assets where id=v_claim.asset_id for update;
    if v_claim.expires_at<=now() then raise exception 'La referencia venció; usá una clave nueva.'; end if;
    if v_asset.id is null or not public._mcp_brand_asset_eligible(v_claim.asset_id,v_claim.channel)
       or public._mcp_brand_asset_fingerprint(v_claim.asset_id)<>v_claim.asset_fingerprint then
      raise exception 'El activo perdió permisos o integridad después del claim.';
    end if;
    if v_asset.size_bytes>26214400 then
      raise exception 'El original excede 25 MB y requiere un worker privado.';
    end if;
    return jsonb_build_object('schema_version','momos-brand-asset-claim/v1','ok',true,
      'asset',public._mcp_brand_asset_snapshot(v_asset.id)||jsonb_build_object('storage_path',v_asset.storage_path),
      'grant',jsonb_build_object('request_key',v_claim.request_key,'contract_fingerprint',v_input,
        'purpose',v_claim.purpose,'channel',v_claim.channel,'expires_at',v_claim.expires_at,'duplicate',true),
      'external_execution_allowed',false,
      'policy',jsonb_build_object('temporary_reference',true,'credentials_included',false,'signed_url_included',false,
        'private_runtime_download_required',true,'sha256_verification_required',true,'external_execution',false));
  end if;
  if (select count(*) from public.agency_mcp_asset_claims
      where worker_id=v_worker and issued_at>now()-interval '5 minutes')>=20 then
    raise exception 'El worker superó el límite de 20 referencias por cinco minutos.';
  end if;

  -- Coordina con preparar/confirmar eliminación: ambos toman lock sobre la misma fila.
  select * into v_asset from public.brand_media_assets where id=v_asset_id for update;
  v_current:=public._mcp_brand_asset_fingerprint(v_asset_id);
  if v_asset.id is null or not public._mcp_brand_asset_eligible(v_asset_id,v_channel) then
    raise exception 'El activo no está disponible, autorizado, vigente o permitido para ese canal.';
  end if;
  if v_asset.size_bytes>26214400 then raise exception 'El original excede 25 MB y requiere un worker privado.'; end if;
  if v_current is null or v_current<>v_expected then raise exception 'El activo cambió desde la búsqueda; buscá de nuevo.'; end if;

  insert into public.agency_mcp_asset_claims(request_key,worker_id,asset_id,purpose,channel,asset_fingerprint,
    content_hash,expires_at)
  values(v_key,v_worker,v_asset.id,v_purpose,v_channel,v_current,v_asset.content_hash,
    now()+make_interval(secs=>v_ttl))
  on conflict(request_key) do nothing returning * into v_claim;
  if v_claim.id is null then
    select * into v_claim from public.agency_mcp_asset_claims where request_key=v_key;
    if v_claim.id is null or v_claim.worker_id<>v_worker or v_claim.asset_id<>v_asset_id
       or v_claim.purpose<>v_purpose or v_claim.channel<>v_channel or v_claim.asset_fingerprint<>v_expected
       or abs(extract(epoch from (v_claim.expires_at-v_claim.issued_at))-v_ttl)>1 then
      raise exception 'La clave de referencia entró en conflicto con otro contrato.';
    end if;
    if v_claim.expires_at<=now() or v_asset.size_bytes>26214400
       or not public._mcp_brand_asset_eligible(v_claim.asset_id,v_claim.channel)
       or public._mcp_brand_asset_fingerprint(v_claim.asset_id)<>v_claim.asset_fingerprint then
      raise exception 'La referencia concurrente perdió vigencia o permisos.';
    end if;
    return jsonb_build_object('schema_version','momos-brand-asset-claim/v1','ok',true,
      'asset',public._mcp_brand_asset_snapshot(v_claim.asset_id)||jsonb_build_object('storage_path',v_asset.storage_path),
      'grant',jsonb_build_object('request_key',v_claim.request_key,'contract_fingerprint',v_input,
        'purpose',v_claim.purpose,'channel',v_claim.channel,'expires_at',v_claim.expires_at,'duplicate',true),
      'external_execution_allowed',false,
      'policy',jsonb_build_object('temporary_reference',true,'credentials_included',false,'signed_url_included',false,
        'private_runtime_download_required',true,'sha256_verification_required',true,'external_execution',false));
  end if;

  v_result:=jsonb_build_object('schema_version','momos-brand-asset-claim/v1','ok',true,
    'asset',public._mcp_brand_asset_snapshot(v_asset.id)||jsonb_build_object('storage_path',v_asset.storage_path),
    'grant',jsonb_build_object('request_key',v_claim.request_key,'contract_fingerprint',v_input,
      'purpose',v_claim.purpose,'channel',v_claim.channel,'expires_at',v_claim.expires_at,'duplicate',false),
    'external_execution_allowed',false,
    'policy',jsonb_build_object('temporary_reference',true,'credentials_included',false,'signed_url_included',false,
      'private_runtime_download_required',true,'sha256_verification_required',true,'external_execution',false));
  v_output:=md5(v_result::text);
  perform public.registrar_acceso_mcp_agencia(jsonb_build_object(
    'request_key',v_key,'tool_name','momos_get_brand_asset_reference','mode','Referencia','status','OK','worker_id',v_worker,
    'subject_ref','brand-asset:'||v_asset.id::text,'input_fingerprint',v_input,'output_fingerprint',v_output,
    'details',jsonb_build_object('asset_id',v_asset.id,'purpose',v_purpose,'channel',v_channel,
      'ttl_seconds',v_ttl,'credentials_included',false,'private_path_logged',false)
  ));
  return v_result;
end $$;

revoke all on function public.mcp_biblioteca_creativa_disponible() from public,anon;
revoke all on function public.mcp_biblioteca_creativa_contrato() from public,anon,authenticated;
revoke all on function public._mcp_brand_asset_text_safe(text) from public,anon,authenticated,service_role;
revoke all on function public._mcp_brand_asset_normalize(text) from public,anon,authenticated,service_role;
revoke all on function public._mcp_brand_asset_fingerprint(bigint) from public,anon,authenticated,service_role;
revoke all on function public._mcp_brand_asset_snapshot(bigint) from public,anon,authenticated,service_role;
revoke all on function public._mcp_brand_asset_eligible(bigint,text) from public,anon,authenticated,service_role;
revoke all on function public._mcp_asset_ledger_immutable() from public,anon,authenticated,service_role;
revoke all on function public._motivos_bloqueo_eliminacion_activo(bigint) from public,anon,authenticated,service_role;
revoke all on function public.confirmar_eliminacion_activo_marca(bigint) from public,anon;
revoke all on function public.registrar_acceso_mcp_agencia(jsonb) from public,anon,authenticated;
revoke all on function public.momos_search_brand_assets(jsonb) from public,anon,authenticated;
revoke all on function public.momos_get_brand_asset_reference(jsonb) from public,anon,authenticated;
grant execute on function public.mcp_biblioteca_creativa_disponible() to authenticated,service_role;
grant execute on function public.mcp_biblioteca_creativa_contrato() to service_role;
grant execute on function public.registrar_acceso_mcp_agencia(jsonb) to service_role;
grant execute on function public.momos_search_brand_assets(jsonb) to service_role;
grant execute on function public.momos_get_brand_asset_reference(jsonb) to service_role;
grant execute on function public.confirmar_eliminacion_activo_marca(bigint) to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260717_54_mcp_biblioteca_creativa','MCP busca activos autorizados sin PII ni rutas y emite claims privados, breves, idempotentes y auditados')
on conflict(id) do update set detalle=excluded.detalle;

commit;
