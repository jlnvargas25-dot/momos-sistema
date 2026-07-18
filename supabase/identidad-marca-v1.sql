-- MOMOS OPS · Identidad de marca operable v1.
-- Paso 55. Convierte el perfil H49 y los originales H20 en un kit oficial
-- versionado: colores con función semántica, logos exactos y una sola fuente
-- de verdad para la UI, los gates creativos y el Cerebro MCP.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260717'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260717_54_mcp_biblioteca_creativa'
  ) then raise exception 'Falta el paso 54_mcp_biblioteca_creativa.'; end if;
  if to_regclass('public.agency_brand_profiles') is null
     or to_regclass('public.brand_media_assets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Faltan Gobernanza de marca, Biblioteca o Storage.';
  end if;
end $$;

create table if not exists public.agency_brand_kits(
  id bigint generated always as identity primary key,
  version integer not null unique check(version>0),
  status text not null default 'Borrador'
    check(status in ('Borrador','Activo','Sustituido','Archivado')),
  brand_profile_id bigint not null references public.agency_brand_profiles(id) on delete restrict,
  kit_fingerprint text check(kit_fingerprint is null or kit_fingerprint ~ '^[0-9a-f]{32}$'),
  enforcement_enabled boolean not null default false,
  change_note text not null check(length(btrim(change_note)) between 5 and 500),
  prepared_by text not null references public.users(id),
  prepared_at timestamptz not null default now(),
  approved_by text references public.users(id),
  approved_at timestamptz,
  approval_note text not null default '',
  check((status='Borrador' and kit_fingerprint is null and approved_by is null and approved_at is null and approval_note='')
    or (status in ('Activo','Sustituido') and kit_fingerprint is not null and approved_by is not null and approved_at is not null
      and length(btrim(approval_note))>=5)
    or status='Archivado')
);
create unique index if not exists agency_brand_kits_one_active_idx
  on public.agency_brand_kits((status)) where status='Activo';
create index if not exists agency_brand_kits_profile_idx
  on public.agency_brand_kits(brand_profile_id,version desc);

create table if not exists public.agency_brand_color_tokens(
  id bigint generated always as identity primary key,
  kit_id bigint not null references public.agency_brand_kits(id) on delete restrict,
  token text not null check(token in ('background','surface','text','muted','primary','rose','accent')),
  label text not null check(length(btrim(label)) between 2 and 40),
  color_hex text not null check(color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  contrast_hex text not null check(contrast_hex ~ '^#[0-9A-Fa-f]{6}$'),
  usage text not null check(length(btrim(usage)) between 3 and 140),
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  unique(kit_id,token)
);
create index if not exists agency_brand_color_tokens_kit_idx
  on public.agency_brand_color_tokens(kit_id,token);

create table if not exists public.agency_brand_kit_assets(
  id bigint generated always as identity primary key,
  kit_id bigint not null references public.agency_brand_kits(id) on delete restrict,
  asset_id bigint not null references public.brand_media_assets(id) on delete restrict,
  role text not null check(role in
    ('principal','isotipo','horizontal','monocromo_claro','monocromo_oscuro','avatar','empaque')),
  background text not null default 'Cualquiera'
    check(background in ('Claro','Oscuro','Transparente','Cualquiera')),
  channels text[] not null default '{}'::text[]
    check(channels <@ array['Instagram','Facebook','TikTok','YouTube','WhatsApp','Web','Email','Punto de venta']::text[]),
  min_width_px integer not null default 48 check(min_width_px between 16 and 4096),
  clear_space_ratio numeric not null default 0.25 check(clear_space_ratio between 0 and 2),
  asset_fingerprint text not null check(asset_fingerprint ~ '^[0-9a-f]{32}$'),
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  unique(kit_id,role),
  unique(kit_id,asset_id,role)
);
create index if not exists agency_brand_kit_assets_kit_idx
  on public.agency_brand_kit_assets(kit_id,role);
create index if not exists agency_brand_kit_assets_asset_idx
  on public.agency_brand_kit_assets(asset_id,kit_id);

alter table public.agency_brand_kits enable row level security;
alter table public.agency_brand_color_tokens enable row level security;
alter table public.agency_brand_kit_assets enable row level security;
drop policy if exists staff_read on public.agency_brand_kits;
drop policy if exists staff_read on public.agency_brand_color_tokens;
drop policy if exists staff_read on public.agency_brand_kit_assets;
create policy staff_read on public.agency_brand_kits for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_brand_color_tokens for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_brand_kit_assets for select to authenticated using(public.is_staff());
revoke all on public.agency_brand_kits,public.agency_brand_color_tokens,public.agency_brand_kit_assets
  from public,anon,authenticated;
grant select on public.agency_brand_kits,public.agency_brand_color_tokens,public.agency_brand_kit_assets
  to authenticated;

create or replace function public._agency_brand_kit_row_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Una versión del kit de marca no se elimina.'; end if;
  if old.status<>'Borrador' and (
    new.version is distinct from old.version
    or new.brand_profile_id is distinct from old.brand_profile_id
    or new.kit_fingerprint is distinct from old.kit_fingerprint
    or new.enforcement_enabled is distinct from old.enforcement_enabled
    or new.change_note is distinct from old.change_note
    or new.prepared_by is distinct from old.prepared_by
    or new.prepared_at is distinct from old.prepared_at
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.approval_note is distinct from old.approval_note
  ) then raise exception 'El kit activo o histórico es inmutable; prepará una versión nueva.'; end if;
  if old.status in ('Sustituido','Archivado') and new.status is distinct from old.status then
    raise exception 'El estado histórico del kit es inmutable.';
  end if;
  return new;
end $$;
drop trigger if exists agency_brand_kits_guard on public.agency_brand_kits;
create trigger agency_brand_kits_guard before update or delete on public.agency_brand_kits
for each row execute function public._agency_brand_kit_row_guard();

create or replace function public._agency_brand_kit_child_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_kit_id bigint:=case when tg_op='DELETE' then old.kit_id else new.kit_id end; v_status text;
begin
  select status into v_status from public.agency_brand_kits where id=v_kit_id;
  if v_status is distinct from 'Borrador' then
    raise exception 'Los colores y logos de un kit activo o histórico son inmutables.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists agency_brand_color_tokens_guard on public.agency_brand_color_tokens;
create trigger agency_brand_color_tokens_guard before insert or update or delete on public.agency_brand_color_tokens
for each row execute function public._agency_brand_kit_child_guard();
drop trigger if exists agency_brand_kit_assets_guard on public.agency_brand_kit_assets;
create trigger agency_brand_kit_assets_guard before insert or update or delete on public.agency_brand_kit_assets
for each row execute function public._agency_brand_kit_child_guard();

create or replace function public._agency_brand_seed_colors(p_kit_id bigint,p_profile_id bigint,p_actor text) returns void
language plpgsql security definer set search_path=public as $$
declare v_profile jsonb; v_palette jsonb;
begin
  select profile into v_profile from public.agency_brand_profiles where id=p_profile_id;
  v_palette:=coalesce(v_profile#>'{visual,palette}','[]'::jsonb);
  insert into public.agency_brand_color_tokens(kit_id,token,label,color_hex,contrast_hex,usage,created_by)
  values
    (p_kit_id,'background','Crema MOMOS',v_palette->>0,'#54382B','Fondo general cálido',p_actor),
    (p_kit_id,'surface','Blanco cálido',v_palette->>1,'#54382B','Tarjetas y superficies principales',p_actor),
    (p_kit_id,'text','Chocolate',v_palette->>2,'#FFFFFF','Texto y títulos de alta legibilidad',p_actor),
    (p_kit_id,'muted','Cacao suave',v_palette->>3,'#FFFFFF','Texto secundario y detalles',p_actor),
    (p_kit_id,'primary','Coral MOMOS',v_palette->>4,'#FFFFFF','Acciones principales y énfasis',p_actor),
    (p_kit_id,'rose','Rosa tierno',coalesce(v_palette->>5,v_palette->>4),'#54382B','Acentos emocionales y comunidad',p_actor),
    (p_kit_id,'accent','Vainilla',coalesce(v_palette->>6,v_palette->>0),'#54382B','Fondos de apoyo y señalización suave',p_actor);
end $$;

create or replace function public._agency_brand_kit_errors(p_kit_id bigint) returns text[]
language plpgsql stable security definer set search_path=public,storage as $$
declare v_errors text[]:='{}'::text[]; v_kit public.agency_brand_kits%rowtype; v_profile public.agency_brand_profiles%rowtype;
  v_binding record;
begin
  select * into v_kit from public.agency_brand_kits where id=p_kit_id;
  if v_kit.id is null then return array['El kit de marca no existe.']; end if;
  select * into v_profile from public.agency_brand_profiles where id=v_kit.brand_profile_id;
  if v_profile.id is null or v_profile.profile_fingerprint<>public._agency_brand_fingerprint(v_profile.profile)
     or cardinality(public._agency_brand_profile_errors(v_profile.profile))>0 then
    v_errors:=array_append(v_errors,'El perfil de marca ligado no está íntegro.');
  end if;
  if not array['background','surface','text','primary','accent']::text[] <@ coalesce((
    select array_agg(token order by token) from public.agency_brand_color_tokens where kit_id=p_kit_id
  ),'{}'::text[]) then
    v_errors:=array_append(v_errors,'Faltan colores corporativos con función definida.');
  end if;
  if exists(
    select 1 from public.agency_brand_color_tokens c where c.kit_id=p_kit_id
      and not exists(
        select 1
        from jsonb_array_elements_text(coalesce(v_profile.profile#>'{visual,palette}','[]'::jsonb)) p(value)
        where lower(p.value)=lower(c.color_hex)
      )
  ) then
    v_errors:=array_append(v_errors,'Un color del kit no pertenece a la paleta aprobada.');
  end if;
  if not exists(select 1 from public.agency_brand_kit_assets where kit_id=p_kit_id and role='principal') then
    v_errors:=array_append(v_errors,'Falta elegir el logo principal oficial.');
  end if;
  for v_binding in
    select b.*,a.media_type,a.name,a.status asset_status,a.rights_status,a.rights_expires_at,a.ai_use_allowed,
      a.contains_people,a.allowed_channels,a.storage_path,a.mime_type
    from public.agency_brand_kit_assets b join public.brand_media_assets a on a.id=b.asset_id
    where b.kit_id=p_kit_id
  loop
    if v_binding.media_type<>'Logo' or v_binding.asset_status<>'Activo'
       or v_binding.rights_status not in ('Propio','Autorizado')
       or (v_binding.rights_expires_at is not null and v_binding.rights_expires_at<current_date)
       or v_binding.ai_use_allowed is not true or v_binding.contains_people is true
       or v_binding.mime_type not in ('image/png','image/jpeg','image/webp')
       or not public._mcp_brand_asset_text_safe(v_binding.name)
       or not exists(select 1 from storage.objects o where o.bucket_id='brand-assets' and o.name=v_binding.storage_path)
       or public._mcp_brand_asset_fingerprint(v_binding.asset_id) is distinct from v_binding.asset_fingerprint then
      v_errors:=array_append(v_errors,'Un logo oficial perdió estado, derechos, archivo o integridad.');
      exit;
    end if;
    if cardinality(v_binding.channels)>0 and jsonb_array_length(v_binding.allowed_channels)>0 and exists(
      select 1 from unnest(v_binding.channels) c where not v_binding.allowed_channels ? c
    ) then
      v_errors:=array_append(v_errors,'Un logo no tiene derechos para todos los canales declarados.');
      exit;
    end if;
  end loop;
  return v_errors;
end $$;

create or replace function public._agency_brand_kit_fingerprint(p_kit_id bigint) returns text
language sql stable security definer set search_path=public as $$
  select md5(jsonb_build_object(
    'schema_version',1,'brand_profile_id',k.brand_profile_id,'brand_profile_fingerprint',p.profile_fingerprint,
    'colors',coalesce((select jsonb_agg(jsonb_build_object('token',c.token,'label',c.label,'hex',upper(c.color_hex),
      'contrast',upper(c.contrast_hex),'usage',c.usage) order by c.token)
      from public.agency_brand_color_tokens c where c.kit_id=k.id),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object('role',a.role,'asset_id',a.asset_id,'background',a.background,
      'channels',a.channels,'min_width_px',a.min_width_px,'clear_space_ratio',a.clear_space_ratio,
      'asset_fingerprint',a.asset_fingerprint) order by a.role)
      from public.agency_brand_kit_assets a where a.kit_id=k.id),'[]'::jsonb)
  )::text)
  from public.agency_brand_kits k join public.agency_brand_profiles p on p.id=k.brand_profile_id
  where k.id=p_kit_id
$$;

-- Baseline compatible: conserva la operación aun si el logo todavía no fue
-- clasificado. Cuando existe un Logo elegible se activa la exigencia completa.
do $$
declare v_profile public.agency_brand_profiles%rowtype; v_actor text; v_kit bigint; v_logo bigint; v_errors text[];
begin
  if not exists(select 1 from public.agency_brand_kits) then
    select * into v_profile from public.agency_brand_profiles where status='Activo';
    if v_profile.id is null then raise exception 'Falta el perfil activo de marca.'; end if;
    v_actor:=coalesce(v_profile.approved_by,v_profile.prepared_by);
    insert into public.agency_brand_kits(version,status,brand_profile_id,change_note,prepared_by)
    values(1,'Borrador',v_profile.id,'Kit inicial derivado de la identidad activa de MOMOS.',v_actor)
    returning id into v_kit;
    perform public._agency_brand_seed_colors(v_kit,v_profile.id,v_actor);
    select a.id into v_logo from public.brand_media_assets a
    where a.media_type='Logo' and a.status='Activo' and a.rights_status in ('Propio','Autorizado')
      and (a.rights_expires_at is null or a.rights_expires_at>=current_date) and a.ai_use_allowed
      and not a.contains_people and a.mime_type in ('image/png','image/jpeg','image/webp')
      and public._mcp_brand_asset_text_safe(a.name)
      and exists(select 1 from storage.objects o where o.bucket_id='brand-assets' and o.name=a.storage_path)
    order by a.created_at desc,a.id desc limit 1;
    if v_logo is not null then
      insert into public.agency_brand_kit_assets(kit_id,asset_id,role,background,channels,min_width_px,clear_space_ratio,asset_fingerprint,created_by)
      values(v_kit,v_logo,'principal','Cualquiera','{}',48,0.25,public._mcp_brand_asset_fingerprint(v_logo),v_actor);
    end if;
    v_errors:=public._agency_brand_kit_errors(v_kit);
    update public.agency_brand_kits set status='Activo',kit_fingerprint=public._agency_brand_kit_fingerprint(v_kit),
      enforcement_enabled=cardinality(v_errors)=0,approved_by=v_actor,approved_at=now(),
      approval_note=case when cardinality(v_errors)=0 then 'Kit inicial verificado con logo y paleta oficiales.'
        else 'Baseline operativo conservado; falta clasificar el logo principal oficial.' end
    where id=v_kit;
  end if;
end $$;

create or replace function public._agency_brand_active_kit() returns public.agency_brand_kits
language sql stable security definer set search_path=public as $$
  select k from public.agency_brand_kits k where k.status='Activo'
$$;

create or replace function public.preparar_kit_identidad_marca(p_change_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_active public.agency_brand_kits%rowtype; v_id bigint; v_version integer;
  v_note text:=btrim(coalesce(p_change_note,''));
begin
  v_actor:=public._agency_brand_actor();
  if length(v_note) not between 5 and 500 then raise exception 'Explicá qué cambiará en la identidad.'; end if;
  perform pg_advisory_xact_lock(hashtext('agency_brand_kit'));
  select * into v_active from public.agency_brand_kits where status='Activo';
  if v_active.id is null then raise exception 'No existe un kit activo para versionar.'; end if;
  update public.agency_brand_kits set status='Archivado' where status='Borrador';
  select coalesce(max(version),0)+1 into v_version from public.agency_brand_kits;
  insert into public.agency_brand_kits(version,status,brand_profile_id,change_note,prepared_by)
  values(v_version,'Borrador',v_active.brand_profile_id,v_note,v_actor.id) returning id into v_id;
  insert into public.agency_brand_color_tokens(kit_id,token,label,color_hex,contrast_hex,usage,created_by)
    select v_id,token,label,color_hex,contrast_hex,usage,v_actor.id from public.agency_brand_color_tokens where kit_id=v_active.id;
  insert into public.agency_brand_kit_assets(kit_id,asset_id,role,background,channels,min_width_px,clear_space_ratio,asset_fingerprint,created_by)
    select v_id,asset_id,role,background,channels,min_width_px,clear_space_ratio,asset_fingerprint,v_actor.id
    from public.agency_brand_kit_assets where kit_id=v_active.id;
  perform public._add_audit('Identidad de marca',v_id::text,'Kit preparado','',format('Versión %s · revisión humana pendiente',v_version));
  return jsonb_build_object('ok',true,'kit_id',v_id,'version',v_version,'requires_human_approval',true,'external_execution',false);
end $$;

create or replace function public.vincular_logo_kit_identidad(
  p_kit_id bigint,p_asset_id bigint,p_role text,p_background text default 'Cualquiera',
  p_channels text[] default '{}'::text[],p_min_width_px integer default 48,p_clear_space_ratio numeric default 0.25
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_actor public.users%rowtype; v_kit public.agency_brand_kits%rowtype; v_asset public.brand_media_assets%rowtype; v_id bigint;
begin
  v_actor:=public._agency_brand_actor();
  select * into v_kit from public.agency_brand_kits where id=p_kit_id for update;
  if v_kit.id is null or v_kit.status<>'Borrador' then raise exception 'El kit no existe o ya está sellado.'; end if;
  if p_role not in ('principal','isotipo','horizontal','monocromo_claro','monocromo_oscuro','avatar','empaque')
     or p_background not in ('Claro','Oscuro','Transparente','Cualquiera')
     or not (coalesce(p_channels,'{}'::text[]) <@ array['Instagram','Facebook','TikTok','YouTube','WhatsApp','Web','Email','Punto de venta']::text[])
     or p_min_width_px not between 16 and 4096 or p_clear_space_ratio not between 0 and 2 then
    raise exception 'La función o las reglas del logo no son válidas.';
  end if;
  select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null or v_asset.media_type<>'Logo' or v_asset.status<>'Activo'
     or v_asset.rights_status not in ('Propio','Autorizado')
     or (v_asset.rights_expires_at is not null and v_asset.rights_expires_at<current_date)
     or v_asset.ai_use_allowed is not true or v_asset.contains_people is true
     or v_asset.mime_type not in ('image/png','image/jpeg','image/webp')
     or not public._mcp_brand_asset_text_safe(v_asset.name)
     or not exists(select 1 from storage.objects where bucket_id='brand-assets' and name=v_asset.storage_path) then
    raise exception 'El archivo no puede ser un logo oficial: revisá tipo, derechos, IA, vigencia y archivo real.';
  end if;
  if cardinality(coalesce(p_channels,'{}'::text[]))>0 and jsonb_array_length(v_asset.allowed_channels)>0 and exists(
    select 1 from unnest(p_channels) c where not v_asset.allowed_channels ? c
  ) then raise exception 'El logo no está autorizado para todos los canales elegidos.'; end if;
  insert into public.agency_brand_kit_assets(kit_id,asset_id,role,background,channels,min_width_px,clear_space_ratio,asset_fingerprint,created_by)
  values(p_kit_id,p_asset_id,p_role,p_background,coalesce(p_channels,'{}'),p_min_width_px,p_clear_space_ratio,
    public._mcp_brand_asset_fingerprint(p_asset_id),v_actor.id)
  on conflict(kit_id,role) do update set asset_id=excluded.asset_id,background=excluded.background,channels=excluded.channels,
    min_width_px=excluded.min_width_px,clear_space_ratio=excluded.clear_space_ratio,
    asset_fingerprint=excluded.asset_fingerprint,created_by=excluded.created_by,created_at=now()
  returning id into v_id;
  perform public._add_audit('Identidad de marca',p_kit_id::text,'Logo vinculado','',p_role||' · activo '||p_asset_id::text);
  return jsonb_build_object('ok',true,'binding_id',v_id,'kit_id',p_kit_id,'role',p_role,'requires_human_approval',true,'external_execution',false);
end $$;

create or replace function public.desvincular_logo_kit_identidad(p_kit_id bigint,p_role text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  v_actor:=public._agency_brand_actor();
  if not exists(select 1 from public.agency_brand_kits where id=p_kit_id and status='Borrador') then
    raise exception 'Solo un kit en borrador puede cambiar sus logos.';
  end if;
  delete from public.agency_brand_kit_assets where kit_id=p_kit_id and role=p_role;
  if not found then raise exception 'Ese logo no está vinculado al borrador.'; end if;
  perform public._add_audit('Identidad de marca',p_kit_id::text,'Logo desvinculado',p_role,'');
  return jsonb_build_object('ok',true,'kit_id',p_kit_id,'role',p_role,'requires_human_approval',true,'external_execution',false);
end $$;

create or replace function public.guardar_colores_kit_identidad(p_kit_id bigint,p_tokens jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_item jsonb; v_count integer:=0; v_profile jsonb;
begin
  v_actor:=public._agency_brand_actor();
  select p.profile into v_profile from public.agency_brand_kits k join public.agency_brand_profiles p on p.id=k.brand_profile_id
    where k.id=p_kit_id and k.status='Borrador' for update of k;
  if v_profile is null then raise exception 'El kit no existe o ya está sellado.'; end if;
  if jsonb_typeof(p_tokens)<>'array' or jsonb_array_length(p_tokens)<>7 then raise exception 'Definí exactamente los siete colores corporativos.'; end if;
  if (select count(distinct value->>'token') from jsonb_array_elements(p_tokens))<>7 then raise exception 'Cada función de color debe aparecer una sola vez.'; end if;
  delete from public.agency_brand_color_tokens where kit_id=p_kit_id;
  for v_item in select value from jsonb_array_elements(p_tokens) loop
    if v_item->>'token' not in ('background','surface','text','muted','primary','rose','accent')
       or coalesce(v_item->>'color_hex','') !~ '^#[0-9A-Fa-f]{6}$'
       or coalesce(v_item->>'contrast_hex','') !~ '^#[0-9A-Fa-f]{6}$'
       or not exists(select 1 from jsonb_array_elements_text(v_profile#>'{visual,palette}') p(value)
         where lower(p.value)=lower(v_item->>'color_hex'))
       or not public._mcp_brand_asset_text_safe(coalesce(v_item->>'label',''))
       or not public._mcp_brand_asset_text_safe(coalesce(v_item->>'usage','')) then
      raise exception 'Un color no pertenece a la paleta o contiene datos no permitidos.';
    end if;
    insert into public.agency_brand_color_tokens(kit_id,token,label,color_hex,contrast_hex,usage,created_by)
    values(p_kit_id,v_item->>'token',btrim(v_item->>'label'),upper(v_item->>'color_hex'),upper(v_item->>'contrast_hex'),
      btrim(v_item->>'usage'),v_actor.id);
    v_count:=v_count+1;
  end loop;
  perform public._add_audit('Identidad de marca',p_kit_id::text,'Colores actualizados','',v_count::text||' funciones semánticas');
  return jsonb_build_object('ok',true,'kit_id',p_kit_id,'colors',v_count,'requires_human_approval',true,'external_execution',false);
end $$;

create or replace function public.activar_kit_identidad_marca(p_kit_id bigint,p_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_kit public.agency_brand_kits%rowtype; v_errors text[]; v_fp text; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_brand_actor();
  if length(v_note)<5 then raise exception 'Documentá la aprobación humana del kit de marca.'; end if;
  perform pg_advisory_xact_lock(hashtext('agency_brand_kit'));
  select * into v_kit from public.agency_brand_kits where id=p_kit_id for update;
  if v_kit.id is null or v_kit.status<>'Borrador' then raise exception 'El kit no existe o no espera aprobación.'; end if;
  if not exists(select 1 from public.agency_brand_profiles where id=v_kit.brand_profile_id and status='Activo') then
    raise exception 'El kit no corresponde al perfil de marca activo.';
  end if;
  v_errors:=public._agency_brand_kit_errors(v_kit.id);
  if cardinality(v_errors)>0 then raise exception 'El kit de marca está incompleto: %',array_to_string(v_errors,' '); end if;
  v_fp:=public._agency_brand_kit_fingerprint(v_kit.id);
  update public.agency_brand_kits set status='Sustituido' where status='Activo';
  update public.agency_brand_kits set status='Activo',kit_fingerprint=v_fp,enforcement_enabled=true,
    approved_by=v_actor.id,approved_at=now(),approval_note=v_note where id=v_kit.id;
  perform public._add_audit('Identidad de marca',v_kit.id::text,'Kit activado','Borrador','Activo · V'||v_kit.version::text);
  return jsonb_build_object('ok',true,'kit_id',v_kit.id,'version',v_kit.version,'status','Activo','fingerprint',v_fp,
    'requires_new_brand_gates',true,'external_execution',false);
end $$;

create or replace function public._agency_brand_kit_asset_snapshot(p_kit_id bigint) returns jsonb
language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'binding_id',b.id,'role',b.role,'background',b.background,'channels',to_jsonb(b.channels),
    'min_width_px',b.min_width_px,'clear_space_ratio',b.clear_space_ratio,'asset_fingerprint',b.asset_fingerprint,
    'asset',jsonb_build_object('id',a.id,'name',a.name,'media_type',a.media_type,'mime_type',a.mime_type,
      'width',a.width,'height',a.height,'content_hash',a.content_hash,'rights_status',a.rights_status,
      'rights_expires_at',a.rights_expires_at,'status',a.status,'ai_use_allowed',a.ai_use_allowed)
  ) order by case b.role when 'principal' then 0 when 'horizontal' then 1 when 'isotipo' then 2 else 3 end,b.role),'[]'::jsonb)
  from public.agency_brand_kit_assets b join public.brand_media_assets a on a.id=b.asset_id
  where b.kit_id=p_kit_id
$$;

create or replace function public.obtener_identidad_marca(p_include_history boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_kit public.agency_brand_kits%rowtype; v_profile public.agency_brand_profiles%rowtype; v_errors text[]; v_colors jsonb;
  v_assets jsonb; v_history jsonb:='[]'::jsonb;
begin
  select * into v_kit from public.agency_brand_kits where status='Activo';
  if v_kit.id is null then return jsonb_build_object('ready',false,'available',true,'errors',jsonb_build_array('Falta el kit activo de marca.')); end if;
  select * into v_profile from public.agency_brand_profiles where id=v_kit.brand_profile_id;
  v_errors:=public._agency_brand_kit_errors(v_kit.id);
  select coalesce(jsonb_agg(jsonb_build_object('token',token,'label',label,'color_hex',upper(color_hex),
    'contrast_hex',upper(contrast_hex),'usage',usage) order by id),'[]'::jsonb)
    into v_colors from public.agency_brand_color_tokens where kit_id=v_kit.id;
  v_assets:=public._agency_brand_kit_asset_snapshot(v_kit.id);
  if p_include_history then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'status',status,
      'brand_profile_id',brand_profile_id,'fingerprint',kit_fingerprint,'enforcement_enabled',enforcement_enabled,
      'prepared_at',prepared_at,'approved_at',approved_at) order by version desc),'[]'::jsonb)
      into v_history from (select * from public.agency_brand_kits order by version desc limit 20) h;
  end if;
  return jsonb_build_object(
    'schema_version','momos-brand-identity/v1','available',true,
    'ready',v_kit.enforcement_enabled and cardinality(v_errors)=0,
    'enforcement_enabled',v_kit.enforcement_enabled,'errors',to_jsonb(v_errors),
    'kit',jsonb_build_object('id',v_kit.id,'version',v_kit.version,'status',v_kit.status,
      'fingerprint',v_kit.kit_fingerprint,'brand_profile_id',v_kit.brand_profile_id,'approved_at',v_kit.approved_at),
    'profile',jsonb_build_object('id',v_profile.id,'version',v_profile.version,'status',v_profile.status,
      'fingerprint',v_profile.profile_fingerprint,'profile',v_profile.profile,'approved_at',v_profile.approved_at),
    'colors',v_colors,'assets',v_assets,'history',v_history,
    'policy',jsonb_build_object('library_stores_files',true,'identity_declares_official_use',true,
      'human_approval_required',true,'publication_separate',true,'external_execution_allowed',false),
    'contains_secrets',false,'external_execution',false
  );
end $$;

create or replace function public.identidad_marca_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

-- `brand_library` queda como proyección de compatibilidad, no como otra fuente
-- editable. Así los módulos históricos leen la versión activa sin divergir.
create or replace function public._sync_brand_library_from_profile() returns void
language plpgsql security definer set search_path=public as $$
declare v_profile jsonb;
begin
  select profile into v_profile from public.agency_brand_profiles where status='Activo';
  if v_profile is null then return; end if;
  insert into public.brand_library(id,frases,tono,palabras_si,palabras_no)
  values(true,coalesce(v_profile#>'{verbal,approved_phrases}','[]'::jsonb),coalesce(v_profile#>'{verbal,tone}','[]'::jsonb),
    coalesce(v_profile#>'{verbal,allowed_words}','[]'::jsonb),coalesce(v_profile#>'{verbal,banned_words}','[]'::jsonb))
  on conflict(id) do update set frases=excluded.frases,tono=excluded.tono,palabras_si=excluded.palabras_si,palabras_no=excluded.palabras_no;
end $$;
select public._sync_brand_library_from_profile();
revoke insert,update,delete on public.brand_library from anon,authenticated;

create or replace function public._brand_profile_identity_sync() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_old_kit public.agency_brand_kits%rowtype; v_new_kit bigint; v_version integer; v_errors text[];
begin
  if new.status='Activo' and old.status is distinct from new.status then
    perform public._sync_brand_library_from_profile();
    select * into v_old_kit from public.agency_brand_kits where status='Activo' for update;
    if v_old_kit.id is not null and v_old_kit.brand_profile_id<>new.id then
      select coalesce(max(version),0)+1 into v_version from public.agency_brand_kits;
      update public.agency_brand_kits set status='Archivado' where status='Borrador';
      insert into public.agency_brand_kits(version,status,brand_profile_id,change_note,prepared_by)
      values(v_version,'Borrador',new.id,'Kit actualizado para la nueva versión del perfil de marca.',new.approved_by)
      returning id into v_new_kit;
      perform public._agency_brand_seed_colors(v_new_kit,new.id,new.approved_by);
      insert into public.agency_brand_kit_assets(kit_id,asset_id,role,background,channels,min_width_px,clear_space_ratio,asset_fingerprint,created_by)
        select v_new_kit,asset_id,role,background,channels,min_width_px,clear_space_ratio,
          public._mcp_brand_asset_fingerprint(asset_id),new.approved_by
        from public.agency_brand_kit_assets where kit_id=v_old_kit.id;
      v_errors:=public._agency_brand_kit_errors(v_new_kit);
      update public.agency_brand_kits set status='Sustituido' where id=v_old_kit.id;
      update public.agency_brand_kits set status='Activo',kit_fingerprint=public._agency_brand_kit_fingerprint(v_new_kit),
        enforcement_enabled=v_old_kit.enforcement_enabled and cardinality(v_errors)=0,
        approved_by=new.approved_by,approved_at=now(),approval_note='Kit reconciliado con la nueva versión humana del perfil.'
      where id=v_new_kit;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists brand_profile_identity_sync on public.agency_brand_profiles;
create trigger brand_profile_identity_sync after update of status on public.agency_brand_profiles
for each row execute function public._brand_profile_identity_sync();

-- Los originales declarados en cualquier versión del kit son evidencia histórica
-- y no se eliminan. Los activos de un kit activo o borrador tampoco se archivan.
create or replace function public.archivar_activo_marca(p_asset_id bigint,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_asset public.brand_media_assets%rowtype;
begin
  v_actor:=public._brand_actor(); select * into v_asset from public.brand_media_assets where id=p_asset_id for update;
  if v_asset.id is null then raise exception 'El activo no existe.'; end if;
  if v_asset.status<>'Activo' then raise exception 'El activo ya no está activo.'; end if;
  if exists(select 1 from public.agency_brand_kit_assets b join public.agency_brand_kits k on k.id=b.kit_id
    where b.asset_id=p_asset_id and k.status in ('Activo','Borrador')) then
    raise exception 'El archivo está declarado como logo oficial. Activá primero una versión que lo sustituya.';
  end if;
  if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Indicá por qué se archiva el activo.'; end if;
  update public.brand_media_assets set status='Archivado',archived_by=v_actor.id,archived_at=now(),
    notes=concat_ws(E'\n',nullif(notes,''),'Archivado: '||btrim(p_reason)) where id=p_asset_id;
  perform public._add_audit('Biblioteca marca',p_asset_id::text,'Activo archivado','Activo','Archivado · '||btrim(p_reason));
  return jsonb_build_object('ok',true,'asset_id',p_asset_id,'status','Archivado');
end $$;

create or replace function public._motivos_bloqueo_eliminacion_activo(p_asset_id bigint) returns text[]
language plpgsql stable security definer set search_path=public as $$
declare v_reasons text[]:='{}'::text[];
begin
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
  return v_reasons;
end $$;

-- Los gates nuevos sellan también el kit oficial. La transición no detiene la
-- cadena si el baseline todavía no tiene logo; después de activar el primer kit
-- completo, cualquier gate antiguo o logo sustituido queda obsoleto.
alter table public.agency_brand_gate_bindings add column if not exists brand_kit_id bigint references public.agency_brand_kits(id) on delete restrict;
alter table public.agency_brand_gate_bindings add column if not exists brand_kit_fingerprint text
  check(brand_kit_fingerprint is null or brand_kit_fingerprint ~ '^[0-9a-f]{32}$');

create or replace function public._agency_brand_require_parent(p_type text,p_key text,p_profile_id bigint,p_fp text) returns void
language plpgsql stable security definer set search_path=public as $$
declare v_kit public.agency_brand_kits%rowtype;
begin
  select * into v_kit from public.agency_brand_kits where status='Activo';
  if v_kit.enforcement_enabled and (v_kit.brand_profile_id<>p_profile_id
     or v_kit.kit_fingerprint<>public._agency_brand_kit_fingerprint(v_kit.id)
     or cardinality(public._agency_brand_kit_errors(v_kit.id))>0) then
    raise exception 'El kit oficial de marca no coincide o perdió integridad.';
  end if;
  if not exists(select 1 from public.agency_brand_gate_bindings
    where target_type=p_type and target_key=p_key and brand_profile_id=p_profile_id and brand_fingerprint=p_fp
      and (not v_kit.enforcement_enabled or (brand_kit_id=v_kit.id and brand_kit_fingerprint=v_kit.kit_fingerprint))) then
    raise exception 'La etapa anterior no está aprobada con la identidad de marca vigente.';
  end if;
end $$;

create or replace function public._agency_brand_record_gate(
  p_type text,p_key text,p_payload jsonb,p_human text,p_parent_type text default null,p_parent_key text default null
) returns bigint language plpgsql security definer set search_path=public as $$
declare v_profile public.agency_brand_profiles%rowtype; v_kit public.agency_brand_kits%rowtype;
  v_existing public.agency_brand_gate_bindings%rowtype; v_target_fp text; v_snapshot jsonb; v_id bigint;
begin
  select * into v_profile from public.agency_brand_profiles where status='Activo';
  select * into v_kit from public.agency_brand_kits where status='Activo';
  if v_profile.id is null or v_profile.profile_fingerprint<>public._agency_brand_fingerprint(v_profile.profile)
     or cardinality(public._agency_brand_profile_errors(v_profile.profile))>0 then raise exception 'No existe una versión vigente e íntegra de la marca MOMOS.'; end if;
  if v_kit.enforcement_enabled and (v_kit.brand_profile_id<>v_profile.id
     or v_kit.kit_fingerprint<>public._agency_brand_kit_fingerprint(v_kit.id)
     or cardinality(public._agency_brand_kit_errors(v_kit.id))>0) then raise exception 'El kit oficial de logos y colores no está íntegro.'; end if;
  if p_human is null or not exists(select 1 from public.users where id=p_human and activo) then raise exception 'El gate de marca necesita revisión humana identificada.'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or public._agency_mesa_has_secret(p_payload) then raise exception 'La evidencia del gate es inválida o contiene secretos.'; end if;
  if p_parent_type is not null then perform public._agency_brand_require_parent(p_parent_type,p_parent_key,v_profile.id,v_profile.profile_fingerprint); end if;
  v_target_fp:=public._agency_brand_fingerprint(p_payload);
  v_snapshot:=jsonb_build_object('schema_version',2,'target_type',p_type,'target_key',p_key,
    'brand_profile_id',v_profile.id,'brand_version',v_profile.version,'brand_fingerprint',v_profile.profile_fingerprint,
    'brand_kit_id',v_kit.id,'brand_kit_version',v_kit.version,'brand_kit_fingerprint',v_kit.kit_fingerprint,
    'brand_kit_enforced',v_kit.enforcement_enabled,'target_fingerprint',v_target_fp,
    'deterministic_checks',jsonb_build_object('active_profile',true,'profile_integrity',true,
      'official_assets_integrity',not v_kit.enforcement_enabled or cardinality(public._agency_brand_kit_errors(v_kit.id))=0,
      'human_review',true,'parent_same_brand_version',true,'product_fidelity_required',true,
      'claims_require_evidence',true,'rights_required',true,'publication_separate',true),
    'contains_pii',false,'contains_secrets',false,'external_execution',false);
  select * into v_existing from public.agency_brand_gate_bindings where target_type=p_type and target_key=p_key;
  if v_existing.id is not null then
    if v_existing.brand_profile_id<>v_profile.id or v_existing.brand_fingerprint<>v_profile.profile_fingerprint
       or v_existing.target_fingerprint<>v_target_fp
       or (v_kit.enforcement_enabled and (v_existing.brand_kit_id<>v_kit.id or v_existing.brand_kit_fingerprint<>v_kit.kit_fingerprint)) then
      raise exception 'El objeto ya fue sellado con otra identidad o contenido; creá una versión nueva.';
    end if;
    return v_existing.id;
  end if;
  insert into public.agency_brand_gate_bindings(target_type,target_key,brand_profile_id,brand_fingerprint,target_fingerprint,
    gate_snapshot,human_reviewed_by,brand_kit_id,brand_kit_fingerprint)
  values(p_type,p_key,v_profile.id,v_profile.profile_fingerprint,v_target_fp,v_snapshot,p_human,v_kit.id,v_kit.kit_fingerprint)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public._agency_brand_mcp_context() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'active_profile',coalesce((select jsonb_build_object('id',id,'version',version,'fingerprint',profile_fingerprint,'profile',profile)
      from public.agency_brand_profiles where status='Activo'),'{}'::jsonb),
    'active_kit',coalesce((select jsonb_build_object('id',k.id,'version',k.version,'fingerprint',k.kit_fingerprint,
      'enforcement_enabled',k.enforcement_enabled,'ready',k.enforcement_enabled and cardinality(public._agency_brand_kit_errors(k.id))=0,
      'colors',coalesce((select jsonb_agg(jsonb_build_object('token',c.token,'hex',upper(c.color_hex),'usage',c.usage) order by c.token)
        from public.agency_brand_color_tokens c where c.kit_id=k.id),'[]'::jsonb),
      'official_assets',public._agency_brand_kit_asset_snapshot(k.id))
      from public.agency_brand_kits k where k.status='Activo'),'{}'::jsonb),
    'gate_totals',coalesce((select jsonb_object_agg(target_type,total) from (
      select target_type,count(*)::integer total from public.agency_brand_gate_bindings group by target_type
    ) x),'{}'::jsonb),
    'rules',jsonb_build_object('current_profile_and_kit_required',true,'human_review_required',true,
      'library_stores_files_identity_declares_use',true,'publication_separate',true,'external_execution_allowed',false),
    'contains_pii',false,'contains_secrets',false
  )
$$;

revoke all on function public._agency_brand_kit_row_guard() from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_kit_child_guard() from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_seed_colors(bigint,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_kit_errors(bigint) from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_kit_fingerprint(bigint) from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_active_kit() from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_kit_asset_snapshot(bigint) from public,anon,authenticated,service_role;
revoke all on function public._sync_brand_library_from_profile() from public,anon,authenticated,service_role;
revoke all on function public._brand_profile_identity_sync() from public,anon,authenticated,service_role;
revoke all on function public.preparar_kit_identidad_marca(text) from public,anon;
revoke all on function public.vincular_logo_kit_identidad(bigint,bigint,text,text,text[],integer,numeric) from public,anon;
revoke all on function public.desvincular_logo_kit_identidad(bigint,text) from public,anon;
revoke all on function public.guardar_colores_kit_identidad(bigint,jsonb) from public,anon;
revoke all on function public.activar_kit_identidad_marca(bigint,text) from public,anon;
revoke all on function public.obtener_identidad_marca(boolean) from public,anon;
revoke all on function public.identidad_marca_disponible() from public,anon;
grant execute on function public.preparar_kit_identidad_marca(text) to authenticated;
grant execute on function public.vincular_logo_kit_identidad(bigint,bigint,text,text,text[],integer,numeric) to authenticated;
grant execute on function public.desvincular_logo_kit_identidad(bigint,text) to authenticated;
grant execute on function public.guardar_colores_kit_identidad(bigint,jsonb) to authenticated;
grant execute on function public.activar_kit_identidad_marca(bigint,text) to authenticated;
grant execute on function public.obtener_identidad_marca(boolean) to authenticated,service_role;
grant execute on function public.identidad_marca_disponible() to authenticated,service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260717_55_identidad_marca',
  'Kit versionado de identidad con logos oficiales, colores semánticos, fuente única, gates y contexto MCP')
on conflict(id) do update set detalle=excluded.detalle;

commit;
