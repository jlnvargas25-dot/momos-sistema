-- MOMOS OPS · Gobernanza determinística de marca v1.
-- Paso 49. Sella una versión de identidad y la hace obligatoria en toda la cadena
-- creativa. La evaluación visual subjetiva sigue siendo humana; los gates verifican
-- versión, integridad, producto, claims, derechos, checklist y relevo entre etapas.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260716'));

do $$ begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations where id='20260716_48_audio_postproduccion'
  ) then raise exception 'Falta el paso 48_audio_postproduccion.'; end if;
  if to_regclass('public.agency_creative_contracts') is null
     or to_regclass('public.agency_storyboards') is null
     or to_regclass('public.agency_scene_routing_plans') is null
     or to_regclass('public.agency_scene_quality_reviews') is null
     or to_regclass('public.agency_postproduction_exports') is null then
    raise exception 'Falta la cadena creativa completa antes de sellar la marca.';
  end if;
end $$;

create table if not exists public.agency_brand_profiles(
  id bigint generated always as identity primary key,
  version integer not null unique check(version>0),
  status text not null default 'En revisión'
    check(status in ('En revisión','Activo','Sustituido','Archivado')),
  profile jsonb not null check(jsonb_typeof(profile)='object'),
  profile_fingerprint text not null unique check(profile_fingerprint ~ '^[0-9a-f]{32}$'),
  source text not null default 'Humano' check(source in ('Humano','Baseline confirmado')),
  change_note text not null check(length(btrim(change_note)) between 5 and 500),
  prepared_by text not null references public.users(id),
  prepared_at timestamptz not null default now(),
  approved_by text references public.users(id), approved_at timestamptz,
  approval_note text not null default '',
  check((status='En revisión' and approved_by is null and approved_at is null and approval_note='')
     or (status in ('Activo','Sustituido','Archivado') and approved_by is not null and approved_at is not null
       and length(btrim(approval_note))>=5))
);
create unique index if not exists agency_brand_profiles_one_active_idx
  on public.agency_brand_profiles((status)) where status='Activo';
create index if not exists agency_brand_profiles_status_idx
  on public.agency_brand_profiles(status,version desc);

create table if not exists public.agency_brand_gate_bindings(
  id bigint generated always as identity primary key,
  target_type text not null check(target_type in
    ('Contrato','Storyboard','Enrutamiento','Generación','QA escena','Paquete','Máster','Distribución')),
  target_key text not null check(length(btrim(target_key)) between 1 and 220),
  brand_profile_id bigint not null references public.agency_brand_profiles(id) on delete restrict,
  brand_fingerprint text not null check(brand_fingerprint ~ '^[0-9a-f]{32}$'),
  target_fingerprint text not null check(target_fingerprint ~ '^[0-9a-f]{32}$'),
  gate_snapshot jsonb not null check(jsonb_typeof(gate_snapshot)='object'),
  human_reviewed_by text not null references public.users(id),
  passed_at timestamptz not null default now(),
  unique(target_type,target_key),
  constraint agency_brand_gate_no_secret check(
    gate_snapshot::text !~* '"(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|service[_-]?role)"[[:space:]]*:'
  )
);
create index if not exists agency_brand_gate_profile_idx
  on public.agency_brand_gate_bindings(brand_profile_id,passed_at desc);

alter table public.agency_brand_profiles enable row level security;
alter table public.agency_brand_gate_bindings enable row level security;
drop policy if exists staff_read on public.agency_brand_profiles;
drop policy if exists staff_read on public.agency_brand_gate_bindings;
create policy staff_read on public.agency_brand_profiles for select to authenticated using(public.is_staff());
create policy staff_read on public.agency_brand_gate_bindings for select to authenticated using(public.is_staff());
revoke all on public.agency_brand_profiles,public.agency_brand_gate_bindings from public,anon,authenticated;
grant select on public.agency_brand_profiles,public.agency_brand_gate_bindings to authenticated;

-- La intención de distribución queda sellada por salida. Pauta y Orgánico
-- comparten marca, pero nunca objetivo, CTA, atribución ni lectura de resultados.
alter table public.content_distributions add column if not exists content_mode text;

create or replace function public._agency_infer_content_mode(p_post_id text) returns text
language plpgsql stable security definer set search_path=public as $$
declare v_post public.content_posts%rowtype; v_campaign public.campaigns%rowtype; v_format text;
begin
  select * into v_post from public.content_posts where id=p_post_id;
  if v_post.id is null then raise exception 'La publicación no existe para clasificar su intención.'; end if;
  select formato into v_format from public.creatives where id=v_post.creative_id;
  if v_post.campaign_id is not null then select * into v_campaign from public.campaigns where id=v_post.campaign_id; end if;
  if coalesce(v_campaign.presupuesto,0)>0 or length(btrim(coalesce(v_campaign.external_platform,'')))>0 or v_format='Anuncio' then
    return 'Pauta';
  end if;
  return 'Orgánico';
end $$;

update public.content_distributions d set content_mode=public._agency_infer_content_mode(d.post_id)
where content_mode is null;
alter table public.content_distributions alter column content_mode set default 'Orgánico';
alter table public.content_distributions alter column content_mode set not null;
alter table public.content_distributions drop constraint if exists content_distributions_content_mode_check;
alter table public.content_distributions add constraint content_distributions_content_mode_check
  check(content_mode in ('Pauta','Orgánico'));

create or replace function public._agency_content_mode_guard() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='INSERT' then new.content_mode:=public._agency_infer_content_mode(new.post_id);
  elsif new.post_id is distinct from old.post_id or new.content_mode is distinct from old.content_mode then
    raise exception 'La intención Pauta/Orgánico queda sellada al preparar la salida; creá una publicación nueva.';
  end if;
  return new;
end $$;
drop trigger if exists content_distributions_mode_guard on public.content_distributions;
create trigger content_distributions_mode_guard before insert or update of post_id,content_mode on public.content_distributions
for each row execute function public._agency_content_mode_guard();

create or replace function public._agency_brand_fingerprint(p jsonb) returns text
language sql immutable security definer set search_path=public as $$ select md5(p::text) $$;

create or replace function public._agency_brand_actor() returns public.users
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where auth_id=auth.uid() and activo;
  if v_actor.id is null or not (
    'Administrador'=any(coalesce(v_actor.roles,array[v_actor.rol]))
    or 'Marketing/CRM'=any(coalesce(v_actor.roles,array[v_actor.rol]))
  ) then raise exception 'Tu rol no puede gobernar la identidad de MOMOS.'; end if;
  return v_actor;
end $$;

create or replace function public._agency_brand_profile_errors(p jsonb) returns text[]
language plpgsql immutable security definer set search_path=public as $$
declare v_errors text[]:='{}'::text[]; v_color text;
begin
  if p is null or jsonb_typeof(p)<>'object' then return array['El perfil debe ser un objeto.']; end if;
  if length(btrim(coalesce(p#>>'{identity,brand_name}','')))<3 then v_errors:=array_append(v_errors,'Falta el nombre de marca.'); end if;
  if length(btrim(coalesce(p#>>'{identity,positioning}','')))<12 then v_errors:=array_append(v_errors,'Falta el posicionamiento.'); end if;
  if jsonb_typeof(p#>'{identity,personality}') is distinct from 'array' then
    v_errors:=array_append(v_errors,'Definí al menos tres rasgos de personalidad.');
  elsif jsonb_array_length(p#>'{identity,personality}')<3 then
    v_errors:=array_append(v_errors,'Definí al menos tres rasgos de personalidad.');
  end if;
  if jsonb_typeof(p#>'{verbal,tone}') is distinct from 'array' then v_errors:=array_append(v_errors,'Falta el tono verbal.');
  elsif jsonb_array_length(p#>'{verbal,tone}')<2 then v_errors:=array_append(v_errors,'Falta el tono verbal.'); end if;
  if jsonb_typeof(p#>'{verbal,approved_phrases}') is distinct from 'array' then v_errors:=array_append(v_errors,'Faltan frases aprobadas.'); end if;
  if jsonb_typeof(p#>'{verbal,allowed_words}') is distinct from 'array' or jsonb_typeof(p#>'{verbal,banned_words}') is distinct from 'array' then
    v_errors:=array_append(v_errors,'Falta el vocabulario permitido o prohibido.');
  end if;
  if coalesce((p#>>'{verbal,claims_policy,evidence_required}')::boolean,false) is not true
     or coalesce((p#>>'{verbal,claims_policy,no_false_urgency}')::boolean,false) is not true then
    v_errors:=array_append(v_errors,'Claims sin evidencia o urgencia falsa no quedaron prohibidos.');
  end if;
  if jsonb_typeof(p#>'{visual,palette}') is distinct from 'array' then
    v_errors:=array_append(v_errors,'La paleta necesita al menos cinco colores exactos.');
  elsif jsonb_array_length(p#>'{visual,palette}')<5 then
    v_errors:=array_append(v_errors,'La paleta necesita al menos cinco colores exactos.');
  else
    for v_color in select jsonb_array_elements_text(p#>'{visual,palette}') loop
      if v_color !~ '^#[0-9A-Fa-f]{6}$' then v_errors:=array_append(v_errors,'La paleta contiene un color no hexadecimal.'); exit; end if;
    end loop;
  end if;
  if length(btrim(coalesce(p#>>'{visual,typography,display}','')))<2
     or length(btrim(coalesce(p#>>'{visual,typography,body}','')))<2 then v_errors:=array_append(v_errors,'Falta la tipografía de títulos o texto.'); end if;
  if jsonb_typeof(p#>'{visual,logo_rules}') is distinct from 'object' or coalesce((p#>>'{visual,logo_rules,no_distortion}')::boolean,false) is not true then
    v_errors:=array_append(v_errors,'Las reglas de logo no bloquean deformaciones.');
  end if;
  if coalesce((p#>>'{product,exact_variant_required}')::boolean,false) is not true
     or coalesce((p#>>'{product,no_invented_fillings}')::boolean,false) is not true
     or coalesce((p#>>'{product,reference_asset_required}')::boolean,false) is not true then
    v_errors:=array_append(v_errors,'La fidelidad exacta del producto no quedó protegida.');
  end if;
  if jsonb_typeof(p#>'{production,camera}') is distinct from 'object' or jsonb_typeof(p#>'{production,lighting}') is distinct from 'object'
     or jsonb_typeof(p#>'{production,continuity}') is distinct from 'object' then v_errors:=array_append(v_errors,'Faltan cámara, luz o continuidad de producción.'); end if;
  if coalesce((p#>>'{production,retention,proof_first_hook}')::boolean,false) is not true
     or coalesce((p#>>'{production,retention,loops_must_close}')::boolean,false) is not true
     or coalesce((p#>>'{production,retention,one_variable_per_test}')::boolean,false) is not true
     or coalesce((p#>>'{production,retention,no_clickbait}')::boolean,false) is not true then
    v_errors:=array_append(v_errors,'La retención honesta, cierre de loops o experimentación aislada no están protegidos.');
  end if;
  if jsonb_typeof(p#>'{production,negative_constraints}') is distinct from 'array' then
    v_errors:=array_append(v_errors,'Faltan restricciones negativas de generación.');
  elsif jsonb_array_length(p#>'{production,negative_constraints}')<5 then
    v_errors:=array_append(v_errors,'Faltan restricciones negativas de generación.');
  end if;
  if jsonb_typeof(p#>'{content_modes,Pauta}') is distinct from 'object'
     or jsonb_typeof(p#>'{content_modes,Orgánico}') is distinct from 'object'
     or coalesce((p#>>'{content_modes,Pauta,requires_attribution}')::boolean,false) is not true
     or coalesce((p#>>'{content_modes,Pauta,requires_stock_capacity}')::boolean,false) is not true
     or coalesce((p#>>'{content_modes,Orgánico,no_forced_sale}')::boolean,false) is not true
     or coalesce((p#>>'{content_modes,Orgánico,no_assumed_sales_attribution}')::boolean,false) is not true then
    v_errors:=array_append(v_errors,'Pauta y Orgánico no tienen contratos de objetivo, medición y atribución separados.');
  end if;
  if coalesce((p#>>'{governance,human_review_required}')::boolean,false) is not true
     or coalesce((p#>>'{governance,separate_publication_gate}')::boolean,false) is not true
     or coalesce((p#>>'{governance,profit_with_brand_integrity}')::boolean,false) is not true then
    v_errors:=array_append(v_errors,'La gobernanza humana, publicación separada o beneficio responsable no están sellados.');
  end if;
  return v_errors;
end $$;

create or replace function public._agency_brand_profile_immutable() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Una versión de marca no se elimina; se archiva.'; end if;
  if new.version is distinct from old.version or new.profile is distinct from old.profile
     or new.profile_fingerprint is distinct from old.profile_fingerprint or new.source is distinct from old.source
     or new.change_note is distinct from old.change_note or new.prepared_by is distinct from old.prepared_by
     or new.prepared_at is distinct from old.prepared_at then
    raise exception 'El perfil sellado de marca es inmutable; prepará una versión nueva.';
  end if;
  return new;
end $$;
drop trigger if exists agency_brand_profiles_immutable on public.agency_brand_profiles;
create trigger agency_brand_profiles_immutable before update or delete on public.agency_brand_profiles
for each row execute function public._agency_brand_profile_immutable();

create or replace function public._agency_brand_binding_immutable() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  raise exception 'Un gate de marca aprobado es inmutable.';
end $$;
drop trigger if exists agency_brand_gate_bindings_immutable on public.agency_brand_gate_bindings;
create trigger agency_brand_gate_bindings_immutable before update or delete on public.agency_brand_gate_bindings
for each row execute function public._agency_brand_binding_immutable();

-- Baseline sellado de la identidad que el usuario ya confirmó visualmente en MOMOS OPS.
-- Los cambios posteriores siempre nacen En revisión y requieren activación humana.
do $$
declare v_actor text; v_legacy public.brand_library%rowtype; v_profile jsonb;
begin
  if not exists(select 1 from public.agency_brand_profiles where status='Activo') then
    select id into v_actor from public.users where activo
      order by case when 'Administrador'=any(coalesce(roles,array[rol])) then 0 else 1 end,id limit 1;
    if v_actor is null then raise exception 'Falta un usuario activo para sellar el baseline de marca.'; end if;
    select * into v_legacy from public.brand_library where id;
    v_profile:=jsonb_build_object(
      'schema_version',1,
      'identity',jsonb_build_object('brand_name','MOMOS','business_name','D''Momos Sweet Love',
        'positioning','Postres premium, tiernos y antojables con personajes que se adoptan y se comparten.',
        'personality',jsonb_build_array('Tierna','Premium','Antojable','Cercana')),
      'verbal',jsonb_build_object(
        'tone',case when jsonb_typeof(v_legacy.tono)='array' and jsonb_array_length(v_legacy.tono)>0 then v_legacy.tono else '["Tierno","Premium","Cercano"]'::jsonb end,
        'approved_phrases',coalesce(v_legacy.frases,'[]'::jsonb),'allowed_words',coalesce(v_legacy.palabras_si,'[]'::jsonb),
        'banned_words',coalesce(v_legacy.palabras_no,'[]'::jsonb),
        'claims_policy',jsonb_build_object('evidence_required',true,'no_false_urgency',true,'no_health_claims',true,'no_invented_prices',true)),
      'visual',jsonb_build_object('palette',jsonb_build_array('#FAF4EC','#FFFFFF','#54382B','#8A6C5B','#E5714E','#F3D7DC','#F7ECD9'),
        'typography',jsonb_build_object('display','Fraunces','body','Nunito Sans'),
        'logo_rules',jsonb_build_object('no_distortion',true,'clear_space_required',true,'approved_asset_required',true,'no_invented_wordmark',true),
        'style',jsonb_build_array('Luz cálida natural','Texturas reales','Composición limpia','Premium cercano')),
      'product',jsonb_build_object('exact_variant_required',true,'no_invented_fillings',true,'reference_asset_required',true,
        'real_texture_required',true,'packaging_must_match',true,'stock_and_offer_must_be_current',true),
      'production',jsonb_build_object(
        'camera',jsonb_build_object('natural_motion',true,'motivated_movement',true,'no_floating_camera',true,'supported_handheld',true),
        'lighting',jsonb_build_object('motivated_light',true,'stable_direction',true,'natural_shadows',true,'no_flicker',true),
        'continuity',jsonb_build_object('screen_direction',true,'product_identity',true,'hands_and_props',true,'match_on_action',true),
        'retention',jsonb_build_object('proof_first_hook',true,'hook_window_sec',2,'loops_must_close',true,
          'one_variable_per_test',true,'no_clickbait',true,'payoff_must_match_promise',true),
        'negative_constraints',jsonb_build_array('morphing','extra hands','warped product','invented logo','double shadows','flicker','floating camera','variant drift')),
      'channels',jsonb_build_object('Instagram',jsonb_build_object('safe_area',true),'TikTok',jsonb_build_object('safe_area',true),
        'WhatsApp',jsonb_build_object('consent_required',true)),
      'content_modes',jsonb_build_object(
        'Pauta',jsonb_build_object('purpose','Conversión rentable y medible','requires_offer',true,'requires_audience_and_funnel_stage',true,
          'requires_attribution',true,'requires_stock_capacity',true,'primary_metrics',jsonb_build_array('Beneficio incremental','Pedidos pagados','CPA','ROAS'),
          'retention_role','Diagnóstico del creativo; no reemplaza el resultado comercial','cta_style','Claro, específico y verificable'),
        'Orgánico',jsonb_build_object('purpose','Atención, afinidad, comunidad y aprendizaje','value_before_ask',true,'no_forced_sale',true,
          'no_assumed_sales_attribution',true,'primary_metrics',jsonb_build_array('Retención','Finalización','Compartidos','Guardados','Conversación cualificada'),
          'sales_role','Conversión asistida solo cuando exista atribución exacta','cta_style','Natural, conversacional o de participación')),
      'governance',jsonb_build_object('human_review_required',true,'separate_publication_gate',true,
        'profit_with_brand_integrity',true,'rights_required',true,'pii_forbidden',true)
    );
    if cardinality(public._agency_brand_profile_errors(v_profile))>0 then
      raise exception 'El baseline de marca no es válido: %',array_to_string(public._agency_brand_profile_errors(v_profile),' ');
    end if;
    insert into public.agency_brand_profiles(version,status,profile,profile_fingerprint,source,change_note,prepared_by,approved_by,approved_at,approval_note)
    values(1,'Activo',v_profile,public._agency_brand_fingerprint(v_profile),'Baseline confirmado',
      'Identidad visual y verbal vigente de MOMOS OPS sellada como versión inicial.',v_actor,v_actor,now(),
      'Baseline confirmado por la dirección de marca durante el desarrollo de MOMOS OPS.');
  end if;
end $$;

create or replace function public.preparar_perfil_marca(p_profile jsonb,p_change_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_errors text[]; v_version integer; v_id bigint; v_fp text;
  v_note text:=btrim(coalesce(p_change_note,''));
begin
  v_actor:=public._agency_brand_actor();
  if public._agency_mesa_has_secret(p_profile) then raise exception 'El perfil de marca contiene secretos o credenciales.'; end if;
  v_errors:=public._agency_brand_profile_errors(p_profile);
  if cardinality(v_errors)>0 then raise exception 'Perfil de marca incompleto: %',array_to_string(v_errors,' '); end if;
  if length(v_note) not between 5 and 500 then raise exception 'Explicá el cambio de marca.'; end if;
  v_fp:=public._agency_brand_fingerprint(p_profile);
  select id into v_id from public.agency_brand_profiles where profile_fingerprint=v_fp;
  if v_id is not null then return jsonb_build_object('ok',true,'profile_id',v_id,'duplicate',true,'external_execution',false); end if;
  perform pg_advisory_xact_lock(hashtext('agency_brand_profile'));
  select coalesce(max(version),0)+1 into v_version from public.agency_brand_profiles;
  update public.agency_brand_profiles set status='Archivado',approved_by=coalesce(approved_by,v_actor.id),approved_at=coalesce(approved_at,now()),
    approval_note=case when length(btrim(approval_note))>=5 then approval_note else 'Borrador anterior archivado al preparar una versión nueva.' end
    where status='En revisión';
  insert into public.agency_brand_profiles(version,status,profile,profile_fingerprint,source,change_note,prepared_by)
  values(v_version,'En revisión',p_profile,v_fp,'Humano',v_note,v_actor.id) returning id into v_id;
  perform public._add_audit('Gobernanza de marca',v_id::text,'Perfil preparado','',format('Versión %s · revisión humana pendiente',v_version));
  return jsonb_build_object('ok',true,'profile_id',v_id,'version',v_version,'fingerprint',v_fp,'duplicate',false,
    'requires_human_approval',true,'external_execution',false);
end $$;

create or replace function public.activar_perfil_marca(p_profile_id bigint,p_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_profile public.agency_brand_profiles%rowtype; v_note text:=btrim(coalesce(p_note,''));
begin
  v_actor:=public._agency_brand_actor(); select * into v_profile from public.agency_brand_profiles where id=p_profile_id for update;
  if v_profile.id is null or v_profile.status<>'En revisión' then raise exception 'El perfil no existe o no espera aprobación.'; end if;
  if length(v_note)<5 then raise exception 'Documentá la aprobación de marca.'; end if;
  if v_profile.profile_fingerprint<>public._agency_brand_fingerprint(v_profile.profile)
     or cardinality(public._agency_brand_profile_errors(v_profile.profile))>0 then raise exception 'El perfil perdió integridad o está incompleto.'; end if;
  update public.agency_brand_profiles set status='Sustituido' where status='Activo';
  update public.agency_brand_profiles set status='Activo',approved_by=v_actor.id,approved_at=now(),approval_note=v_note where id=v_profile.id;
  perform public._add_audit('Gobernanza de marca',v_profile.id::text,'Perfil activado','En revisión','Activo · V'||v_profile.version::text);
  return jsonb_build_object('ok',true,'profile_id',v_profile.id,'version',v_profile.version,'status','Activo',
    'requires_new_contracts',true,'external_execution',false);
end $$;

create or replace function public.obtener_perfil_marca_activo() returns jsonb
language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_build_object('id',id,'version',version,'status',status,'profile',profile,
    'fingerprint',profile_fingerprint,'approved_at',approved_at,'contains_pii',false,'contains_secrets',false)
    from public.agency_brand_profiles where status='Activo'),'{}'::jsonb)
$$;

create or replace function public._agency_brand_require_parent(p_type text,p_key text,p_profile_id bigint,p_fp text) returns void
language plpgsql stable security definer set search_path=public as $$
begin
  if not exists(select 1 from public.agency_brand_gate_bindings
    where target_type=p_type and target_key=p_key and brand_profile_id=p_profile_id and brand_fingerprint=p_fp) then
    raise exception 'La etapa anterior no está aprobada con la versión vigente de marca.';
  end if;
end $$;

create or replace function public._agency_brand_content_contract_valid(p_mode text,p_metric text,p_goal text,p_constraints jsonb) returns boolean
language sql immutable security definer set search_path=public as $$
  select p_mode in ('Pauta','Orgánico') and length(btrim(coalesce(p_goal,'')))>=5
    and coalesce((p_constraints->>'paid_and_organic_separated')::boolean,false)
    and ((p_mode='Pauta' and p_metric in ('Beneficio incremental','Pedidos pagados','CPA','ROAS'))
      or (p_mode='Orgánico' and p_metric in ('Retención','Finalización','Compartidos','Guardados','Conversación cualificada')))
$$;

create or replace function public._agency_brand_record_gate(
  p_type text,p_key text,p_payload jsonb,p_human text,p_parent_type text default null,p_parent_key text default null
) returns bigint language plpgsql security definer set search_path=public as $$
declare v_profile public.agency_brand_profiles%rowtype; v_existing public.agency_brand_gate_bindings%rowtype;
  v_target_fp text; v_snapshot jsonb; v_id bigint;
begin
  select * into v_profile from public.agency_brand_profiles where status='Activo';
  if v_profile.id is null or v_profile.profile_fingerprint<>public._agency_brand_fingerprint(v_profile.profile)
     or cardinality(public._agency_brand_profile_errors(v_profile.profile))>0 then raise exception 'No existe una versión vigente e íntegra de la marca MOMOS.'; end if;
  if p_human is null or not exists(select 1 from public.users where id=p_human and activo) then raise exception 'El gate de marca necesita revisión humana identificada.'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or public._agency_mesa_has_secret(p_payload) then raise exception 'La evidencia del gate es inválida o contiene secretos.'; end if;
  if p_parent_type is not null then perform public._agency_brand_require_parent(p_parent_type,p_parent_key,v_profile.id,v_profile.profile_fingerprint); end if;
  v_target_fp:=public._agency_brand_fingerprint(p_payload);
  v_snapshot:=jsonb_build_object('schema_version',1,'target_type',p_type,'target_key',p_key,
    'brand_profile_id',v_profile.id,'brand_version',v_profile.version,'brand_fingerprint',v_profile.profile_fingerprint,
    'target_fingerprint',v_target_fp,'deterministic_checks',jsonb_build_object(
      'active_profile',true,'profile_integrity',true,'human_review',true,'parent_same_brand_version',p_parent_type is null or true,
      'product_fidelity_required',true,'claims_require_evidence',true,'rights_required',true,'publication_separate',true),
    'contains_pii',false,'contains_secrets',false,'external_execution',false);
  select * into v_existing from public.agency_brand_gate_bindings where target_type=p_type and target_key=p_key;
  if v_existing.id is not null then
    if v_existing.brand_profile_id<>v_profile.id or v_existing.brand_fingerprint<>v_profile.profile_fingerprint
       or v_existing.target_fingerprint<>v_target_fp then raise exception 'El objeto ya fue sellado con otra marca o contenido; creá una versión nueva.'; end if;
    return v_existing.id;
  end if;
  insert into public.agency_brand_gate_bindings(target_type,target_key,brand_profile_id,brand_fingerprint,target_fingerprint,gate_snapshot,human_reviewed_by)
  values(p_type,p_key,v_profile.id,v_profile.profile_fingerprint,v_target_fp,v_snapshot,p_human) returning id into v_id;
  return v_id;
end $$;

create or replace function public._agency_brand_stage_gate() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_parent text; v_board bigint; v_job public.creative_generation_jobs%rowtype; v_post public.content_posts%rowtype;
  v_creative public.creatives%rowtype; v_profile public.agency_brand_profiles%rowtype; v_payload jsonb; v_selection jsonb;
  v_mode text; v_metric text;
begin
  if tg_table_name='agency_creative_contracts' and new.status='Aprobado' and old.status is distinct from new.status then
    if coalesce((new.sealed_payload#>>'{constraints,human_review_required}')::boolean,false) is not true
       or coalesce((new.sealed_payload#>>'{constraints,product_fidelity_required}')::boolean,false) is not true
       or coalesce((new.sealed_payload#>>'{constraints,no_unapproved_claims}')::boolean,false) is not true then
      raise exception 'El contrato no protege revisión humana, producto exacto y claims verificables.';
    end if;
    v_mode:=new.sealed_payload#>>'{creative_direction,content_mode}';
    v_metric:=new.sealed_payload#>>'{creative_direction,mode_primary_metric}';
    if not public._agency_brand_content_contract_valid(v_mode,v_metric,
      new.sealed_payload#>>'{creative_direction,content_goal}',new.sealed_payload->'constraints') then
      raise exception 'Definí si la pieza es Pauta u Orgánico con su objetivo y métrica propios antes de aprobarla.';
    end if;
    perform public._agency_brand_record_gate('Contrato',new.id::text,new.sealed_payload,new.approved_by);
  elsif tg_table_name='agency_storyboards' and new.status='Aprobado' and old.status is distinct from new.status then
    perform public._agency_brand_record_gate('Storyboard',new.id::text,new.source_snapshot,new.reviewed_by,'Contrato',new.contract_id::text);
  elsif tg_table_name='agency_scene_routing_plans' and new.status='Autorizado' and old.status is distinct from new.status then
    perform public._agency_brand_record_gate('Enrutamiento',new.id::text,new.plan_snapshot,new.resolved_by,'Storyboard',new.storyboard_id::text);
  elsif tg_table_name='agency_scene_quality_reviews' and new.status='Aprobada' and old.status is distinct from new.status then
    if coalesce((new.scores->>'product_identity')::integer,0)<>2 or coalesce((new.scores->>'brand_fidelity')::integer,0)<>2
       or coalesce((new.scores->>'text_logo')::integer,0)<>2 then raise exception 'QA no confirmó producto, marca, texto y logo exactos.'; end if;
    select * into v_profile from public.agency_brand_profiles where status='Activo';
    perform public._agency_brand_require_parent('Generación',new.job_id::text,v_profile.id,v_profile.profile_fingerprint);
    perform public._agency_brand_record_gate('QA escena',new.id::text,new.evidence_snapshot,new.resolved_by,'Enrutamiento',new.routing_plan_id::text);
  elsif tg_table_name='agency_postproduction_packages' and new.status='Aprobado' and old.status is distinct from new.status then
    select * into v_profile from public.agency_brand_profiles where status='Activo';
    if jsonb_typeof(new.package_snapshot->'selections') is distinct from 'array'
       or jsonb_array_length(new.package_snapshot->'selections')=0 then
      raise exception 'El paquete no contiene tomas selladas para validar contra la marca.';
    end if;
    for v_selection in select value from jsonb_array_elements(new.package_snapshot->'selections') loop
      perform public._agency_brand_require_parent('QA escena',v_selection->>'review_id',v_profile.id,v_profile.profile_fingerprint);
    end loop;
    perform public._agency_brand_record_gate('Paquete',new.id::text,new.package_snapshot,new.reviewed_by,'Enrutamiento',new.routing_plan_id::text);
  elsif tg_table_name='content_distributions' and new.status='Aprobada' and old.status is distinct from new.status then
    if not (coalesce((new.checklist->>'identidad_marca')::boolean,false)
      and coalesce((new.checklist->>'producto_fiel')::boolean,false)
      and coalesce((new.checklist->>'claims_verificados')::boolean,false)
      and coalesce((new.checklist->>'logo_color_tipografia')::boolean,false)
      and coalesce((new.checklist->>'objetivo_del_modo')::boolean,false)
      and coalesce((new.checklist->>'cta_del_modo')::boolean,false)
      and coalesce((new.checklist->>'medicion_del_modo')::boolean,false)
      and coalesce((new.checklist->>'separacion_pauta_organico')::boolean,false)) then
      raise exception 'La salida no superó marca, producto o el contrato separado de Pauta/Orgánico.';
    end if;
    select * into v_post from public.content_posts where id=new.post_id;
    select * into v_creative from public.creatives where id=v_post.creative_id;
    if new.content_mode='Pauta' and v_post.campaign_id is null then
      raise exception 'Una pieza de Pauta necesita campaña exacta para medir atribución y beneficio.';
    end if;
    v_payload:=jsonb_build_object('post_id',v_post.id,'channel',v_post.canal,'content_mode',new.content_mode,
      'campaign_id',v_post.campaign_id,'copy_final',v_post.copy_final,
      'creative_id',v_creative.id,'creative_status',v_creative.estado,'product_id',v_creative.producto_foco_id,
      'checklist',new.checklist,'measurement_contract',case when new.content_mode='Pauta'
        then jsonb_build_object('primary','Beneficio incremental y pedidos pagados','retention_is_diagnostic',true,'organic_metrics_must_not_merge',true)
        else jsonb_build_object('primary','Retención, finalización, compartidos, guardados y conversación','sales_attribution_requires_exact_link',true,'paid_metrics_must_not_merge',true) end,
      'publication_authorized',false);
    perform public._agency_brand_record_gate('Distribución',new.id::text,v_payload,new.approved_by);
  elsif tg_table_name='content_distributions' and new.status='Publicada' and old.status is distinct from new.status then
    perform public._agency_brand_require_parent('Distribución',new.id::text,
      (select id from public.agency_brand_profiles where status='Activo'),
      (select profile_fingerprint from public.agency_brand_profiles where status='Activo'));
  end if;
  return new;
end $$;

drop trigger if exists agency_contracts_brand_gate on public.agency_creative_contracts;
create trigger agency_contracts_brand_gate after update of status on public.agency_creative_contracts
for each row execute function public._agency_brand_stage_gate();
drop trigger if exists agency_storyboards_brand_gate on public.agency_storyboards;
create trigger agency_storyboards_brand_gate after update of status on public.agency_storyboards
for each row execute function public._agency_brand_stage_gate();
drop trigger if exists agency_routing_brand_gate on public.agency_scene_routing_plans;
create trigger agency_routing_brand_gate after update of status on public.agency_scene_routing_plans
for each row execute function public._agency_brand_stage_gate();
drop trigger if exists agency_scene_quality_brand_gate on public.agency_scene_quality_reviews;
create trigger agency_scene_quality_brand_gate after update of status on public.agency_scene_quality_reviews
for each row execute function public._agency_brand_stage_gate();
drop trigger if exists agency_packages_brand_gate on public.agency_postproduction_packages;
create trigger agency_packages_brand_gate after update of status on public.agency_postproduction_packages
for each row execute function public._agency_brand_stage_gate();
drop trigger if exists content_distributions_brand_gate on public.content_distributions;
create trigger content_distributions_brand_gate after update of status on public.content_distributions
for each row execute function public._agency_brand_stage_gate();

create or replace function public._agency_brand_job_snapshot() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_profile public.agency_brand_profiles%rowtype; v_board_id bigint; v_plan_id bigint; v_human text;
  v_authorizing boolean:=false;
begin
  select * into v_profile from public.agency_brand_profiles where status='Activo';
  if v_profile.id is null then raise exception 'No existe una marca activa para crear el trabajo.'; end if;
  if tg_op='INSERT' then
    new.brand_snapshot:=coalesce(new.brand_snapshot,'{}'::jsonb)||jsonb_build_object(
      'brand_profile_id',v_profile.id,'brand_version',v_profile.version,'brand_profile_fingerprint',v_profile.profile_fingerprint,
      'profile',v_profile.profile);
  end if;
  if tg_op='INSERT' then v_authorizing:=new.status='Autorizado';
  elsif tg_op='UPDATE' then v_authorizing:=new.status='Autorizado' and old.status is distinct from new.status;
  end if;
  if v_authorizing then
    if new.brand_snapshot->>'brand_profile_fingerprint'<>v_profile.profile_fingerprint then raise exception 'El trabajo usa una versión vieja o incompleta de marca.'; end if;
    v_board_id:=nullif(new.output_spec->>'storyboard_id','')::bigint;
    v_plan_id:=nullif(new.output_spec->>'routing_plan_id','')::bigint;
    if v_plan_id is not null then
      perform public._agency_brand_require_parent('Enrutamiento',v_plan_id::text,v_profile.id,v_profile.profile_fingerprint);
    elsif v_board_id is not null then
      perform public._agency_brand_require_parent('Storyboard',v_board_id::text,v_profile.id,v_profile.profile_fingerprint);
    end if;
    v_human:=new.authorized_by;
    perform public._agency_brand_record_gate('Generación',new.id::text,
      jsonb_build_object('prompt',new.prompt,'negative_prompt',new.negative_prompt,'brand_snapshot',new.brand_snapshot,
        'output_spec',new.output_spec,'publication_authorized',false),v_human,
      case when v_plan_id is not null then 'Enrutamiento' when v_board_id is not null then 'Storyboard' else null end,
      case when v_plan_id is not null then v_plan_id::text when v_board_id is not null then v_board_id::text else null end);
  end if;
  return new;
end $$;
drop trigger if exists creative_jobs_brand_snapshot_insert on public.creative_generation_jobs;
create trigger creative_jobs_brand_snapshot_insert before insert on public.creative_generation_jobs
for each row execute function public._agency_brand_job_snapshot();
drop trigger if exists creative_jobs_brand_snapshot_update on public.creative_generation_jobs;
create trigger creative_jobs_brand_snapshot_update before update of status on public.creative_generation_jobs
for each row execute function public._agency_brand_job_snapshot();

create or replace function public._agency_brand_export_gate() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_package public.agency_postproduction_packages%rowtype;
begin
  if new.status='Aprobada' and old.status is distinct from new.status then
    select * into v_package from public.agency_postproduction_packages where id=new.package_id;
    perform public._agency_brand_record_gate('Máster',new.id::text,
      jsonb_build_object('export_snapshot',new.export_snapshot,'result_snapshot',new.result_snapshot,
        'output_asset_id',new.output_asset_id,'result_fingerprint',new.result_fingerprint,
        'publication_authorized',false,'distribution_authorized',false),
      new.reviewed_by,'Paquete',v_package.id::text);
  end if;
  return new;
end $$;
drop trigger if exists agency_exports_brand_gate on public.agency_postproduction_exports;
create trigger agency_exports_brand_gate after update of status on public.agency_postproduction_exports
for each row execute function public._agency_brand_export_gate();

create or replace function public._agency_brand_distribution_connector_gate() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_profile public.agency_brand_profiles%rowtype;
begin
  select * into v_profile from public.agency_brand_profiles where status='Activo';
  if v_profile.id is null then raise exception 'No existe una marca activa para distribuir.'; end if;
  perform public._agency_brand_require_parent('Distribución',new.distribution_id::text,v_profile.id,v_profile.profile_fingerprint);
  return new;
end $$;
drop trigger if exists distribution_connector_brand_gate on public.distribution_connector_jobs;
create trigger distribution_connector_brand_gate before insert on public.distribution_connector_jobs
for each row execute function public._agency_brand_distribution_connector_gate();

-- El checklist final hace visible lo que el gate valida antes de distribuir.
create or replace function public._distribution_required_keys(p_channel text,p_format text) returns text[]
language plpgsql immutable set search_path=public as $$
declare v_keys text[]:=array['formato_canal','copy_revisado','cta_enlace','identidad_marca','producto_fiel','claims_verificados','logo_color_tipografia',
  'objetivo_del_modo','cta_del_modo','medicion_del_modo','separacion_pauta_organico'];
begin
  if p_channel in ('Instagram','Facebook','TikTok','Rappi','Influencer','Orgánico') then v_keys:=array_prepend('archivo_final',v_keys); end if;
  if p_channel in ('Instagram','TikTok') and p_format in ('Reel','Video UGC') then v_keys:=array_append(v_keys,'audio_derechos'); end if;
  if p_channel='WhatsApp' then v_keys:=array_append(v_keys,'audiencia_autorizada'); end if;
  if p_channel='Rappi' then v_keys:=array_append(v_keys,'ficha_disponible'); end if;
  if p_channel='Influencer' then v_keys:=array_append(v_keys,'menciones_acordadas'); end if;
  return v_keys;
end $$;

-- Expone al Cerebro MCP solo el contrato activo y un resumen de gates, sin secretos ni PII.
do $$ begin
  if to_regprocedure('public._obtener_contexto_director_agencia_h49()') is null then
    alter function public.obtener_contexto_director_agencia() rename to _obtener_contexto_director_agencia_h49;
  end if;
end $$;

create or replace function public._agency_brand_mcp_context() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'active_profile',coalesce((select jsonb_build_object('id',id,'version',version,'fingerprint',profile_fingerprint,'profile',profile)
      from public.agency_brand_profiles where status='Activo'),'{}'::jsonb),
    'gate_totals',coalesce((select jsonb_object_agg(target_type,total) from (
      select target_type,count(*)::integer total from public.agency_brand_gate_bindings group by target_type
    ) x),'{}'::jsonb),
    'rules',jsonb_build_object('current_version_required',true,'human_review_required',true,
      'publication_separate',true,'external_execution_allowed',false),
    'contains_pii',false,'contains_secrets',false
  )
$$;

create or replace function public.obtener_contexto_director_agencia() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_base jsonb:=public._obtener_contexto_director_agencia_h49(); v_snapshot jsonb;
begin
  v_snapshot:=v_base->'snapshot';
  v_snapshot:=jsonb_set(v_snapshot,'{agency,brand_contract}',public._agency_brand_mcp_context(),true);
  return jsonb_build_object('snapshot',v_snapshot,'fingerprint',md5(v_snapshot::text));
end $$;

create or replace function public.gobernanza_marca_disponible() returns boolean
language sql stable security definer set search_path=public as $$ select true $$;

revoke all on function public._agency_brand_fingerprint(jsonb) from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_actor() from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_profile_errors(jsonb) from public,anon,authenticated,service_role;
revoke all on function public._agency_infer_content_mode(text) from public,anon,authenticated,service_role;
revoke all on function public._agency_content_mode_guard() from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_content_contract_valid(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_require_parent(text,text,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_record_gate(text,text,jsonb,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_mcp_context() from public,anon,authenticated,service_role;
revoke all on function public._agency_brand_distribution_connector_gate() from public,anon,authenticated,service_role;
revoke all on function public._obtener_contexto_director_agencia_h49() from public,anon,authenticated,service_role;
revoke all on function public.preparar_perfil_marca(jsonb,text) from public,anon;
revoke all on function public.activar_perfil_marca(bigint,text) from public,anon;
revoke all on function public.obtener_perfil_marca_activo() from public,anon;
revoke all on function public.obtener_contexto_director_agencia() from public,anon,authenticated;
revoke all on function public.gobernanza_marca_disponible() from public,anon;
grant execute on function public.preparar_perfil_marca(jsonb,text) to authenticated;
grant execute on function public.activar_perfil_marca(bigint,text) to authenticated;
grant execute on function public.obtener_perfil_marca_activo() to authenticated,service_role;
grant execute on function public.obtener_contexto_director_agencia() to service_role;
grant execute on function public.gobernanza_marca_disponible() to authenticated,service_role;

insert into public.momos_ops_migrations(id,detalle)
values('20260716_49_gobernanza_marca',
  'Versión sellada de identidad MOMOS y gates de marca en contrato, escenas, generación, QA, máster y distribución')
on conflict(id) do update set detalle=excluded.detalle;

commit;
