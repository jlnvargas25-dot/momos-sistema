-- MOMOS OPS · prueba adversarial de Identidad de marca. Siempre ROLLBACK.
begin;

do $$ begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260717_55_identidad_marca'), 'Falta aplicar la migración 55.';
  assert public.identidad_marca_disponible(), 'La sonda de Identidad no responde.';
  assert to_regclass('public.agency_brand_kits') is not null, 'Falta el kit versionado de marca.';
  assert to_regclass('public.agency_brand_color_tokens') is not null, 'Faltan colores semánticos.';
  assert to_regclass('public.agency_brand_kit_assets') is not null, 'Faltan logos oficiales.';
  assert has_function_privilege('authenticated','public.obtener_identidad_marca(boolean)','EXECUTE'), 'La UI no puede leer Identidad.';
  assert has_function_privilege('authenticated','public.preparar_kit_identidad_marca(text)','EXECUTE'), 'El equipo no puede versionar Identidad.';
  assert not has_table_privilege('authenticated','public.agency_brand_kits','UPDATE'), 'El navegador reescribe kits directamente.';
  assert not has_table_privilege('authenticated','public.agency_brand_kit_assets','INSERT'), 'El navegador fabrica logos oficiales.';
  assert not has_table_privilege('authenticated','public.brand_library','UPDATE'), 'La biblioteca verbal legado sigue siendo otra fuente editable.';
  assert not has_function_privilege('authenticated','public._agency_brand_kit_errors(bigint)','EXECUTE'), 'El helper de integridad quedó expuesto.';
  assert not has_function_privilege('service_role','public._agency_brand_mcp_context()','EXECUTE'), 'El runtime puede saltar el contrato MCP público.';
  assert has_function_privilege('service_role','public.obtener_contexto_director_agencia()','EXECUTE'), 'El Cerebro MCP no puede leer el contrato público seguro.';
  assert exists(select 1 from information_schema.columns where table_schema='public' and table_name='agency_brand_gate_bindings' and column_name='brand_kit_id'), 'Los gates no sellan el kit.';
end $$;

do $$
declare v_actor public.users%rowtype; v_logo bigint; v_photo bigint; v_path text; v_old_gate bigint; v_suffix text:=pg_backend_pid()::text;
begin
  select * into v_actor from public.users where activo and auth_id is not null
    and ('Administrador'=any(coalesce(roles,array[rol])) or 'Marketing/CRM'=any(coalesce(roles,array[rol])))
    order by case when 'Administrador'=any(coalesce(roles,array[rol])) then 0 else 1 end,id limit 1;
  assert v_actor.id is not null, 'Falta actor autenticado de marca para la prueba.';

  v_path:='test/identity-logo-'||v_suffix||'.png';
  insert into storage.objects(bucket_id,name,metadata) values('brand-assets',v_path,'{"mimetype":"image/png","size":4096}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,orientation,contains_people,rights_status,ai_use_allowed,
    allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,width,height,tags,created_by)
  values('Logo MOMOS adversarial','Logo','MOMOS','Horizontal',false,'Propio',true,
    '["Instagram","Facebook","TikTok","Web"]','Activo',v_path,md5('logo-a-'||v_suffix)||md5('logo-b-'||v_suffix),
    'image/png',4096,1200,500,'["MOMOS","Logo oficial"]',v_actor.id) returning id into v_logo;

  v_path:='test/identity-photo-'||v_suffix||'.png';
  insert into storage.objects(bucket_id,name,metadata) values('brand-assets',v_path,'{"mimetype":"image/png","size":2048}'::jsonb);
  insert into public.brand_media_assets(name,media_type,source,orientation,contains_people,rights_status,ai_use_allowed,
    allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,created_by)
  values('Foto que no puede ser logo','Foto','MOMOS','Horizontal',false,'Propio',true,
    '["Instagram"]','Activo',v_path,md5('photo-a-'||v_suffix)||md5('photo-b-'||v_suffix),'image/png',2048,v_actor.id)
  returning id into v_photo;

  v_old_gate:=public._agency_brand_record_gate('Contrato','test55-old-'||v_suffix,
    jsonb_build_object('human_review_required',true,'brand_identity','vigente'),v_actor.id);
  perform set_config('momos.identity_auth',v_actor.auth_id::text,true);
  perform set_config('momos.identity_actor',v_actor.id,true);
  perform set_config('momos.identity_logo',v_logo::text,true);
  perform set_config('momos.identity_photo',v_photo::text,true);
  perform set_config('momos.identity_old_gate',v_old_gate::text,true);
  perform set_config('momos.identity_suffix',v_suffix,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('momos.identity_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_kit bigint; v_result jsonb; v_failed boolean:=false; v_logo bigint:=current_setting('momos.identity_logo')::bigint;
  v_photo bigint:=current_setting('momos.identity_photo')::bigint;
begin
  v_result:=public.preparar_kit_identidad_marca('Nueva versión adversarial de logo, colores y reglas oficiales.');
  v_kit:=(v_result->>'kit_id')::bigint;
  perform set_config('momos.identity_kit',v_kit::text,true);
  assert (v_result->>'requires_human_approval')::boolean and not (v_result->>'external_execution')::boolean,
    'Preparar Identidad ejecutó una acción externa o saltó la revisión.';

  if exists(select 1 from public.agency_brand_kit_assets where kit_id=v_kit and role='principal') then
    perform public.desvincular_logo_kit_identidad(v_kit,'principal');
  end if;
  begin perform public.activar_kit_identidad_marca(v_kit,'Intento sin logo principal.');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Activó un kit sin logo principal.';

  v_failed:=false;
  begin perform public.vincular_logo_kit_identidad(v_kit,v_photo,'principal','Claro',array['Instagram'],48,0.25);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Aceptó una Foto como logo oficial.';

  v_result:=public.vincular_logo_kit_identidad(v_kit,v_logo,'principal','Claro',array['Instagram','Facebook','TikTok','Web'],48,0.25);
  assert v_result->>'role'='principal', 'No vinculó el logo principal válido.';
  v_result:=public.activar_kit_identidad_marca(v_kit,'Dirección de marca verificó logo, colores, tipografía y usos.');
  assert v_result->>'status'='Activo' and (v_result->>'requires_new_brand_gates')::boolean,
    'No activó el kit o no invalidó gates anteriores.';

  v_failed:=false;
  begin update public.agency_brand_kits set approval_note='alterado' where id=v_kit;
  exception when others then v_failed:=true; end;
  assert v_failed, 'Un usuario autenticado alteró el kit sellado.';

  v_failed:=false;
  begin perform public.archivar_activo_marca(v_logo,'Intento de retirar el logo vigente');
  exception when others then v_failed:=true; end;
  assert v_failed, 'Archivó el logo oficial vigente.';

  v_failed:=false;
  begin perform public.preparar_eliminacion_activo_marca(v_logo);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Preparó la eliminación de un logo ligado al historial de marca.';
end $$;
reset role;

do $$
declare v_kit public.agency_brand_kits%rowtype; v_profile public.agency_brand_profiles%rowtype; v_identity jsonb;
  v_failed boolean:=false; v_gate bigint; v_suffix text:=current_setting('momos.identity_suffix');
begin
  select * into v_kit from public.agency_brand_kits where status='Activo';
  select * into v_profile from public.agency_brand_profiles where status='Activo';
  assert v_kit.enforcement_enabled and v_kit.brand_profile_id=v_profile.id, 'El kit activo no protege el perfil vigente.';
  assert v_kit.kit_fingerprint=public._agency_brand_kit_fingerprint(v_kit.id), 'La huella del kit no coincide.';
  assert cardinality(public._agency_brand_kit_errors(v_kit.id))=0, 'El kit activo perdió integridad.';
  assert exists(select 1 from public.agency_brand_kit_assets where kit_id=v_kit.id and role='principal'), 'Falta logo principal.';

  begin perform public._agency_brand_require_parent('Contrato','test55-old-'||v_suffix,v_profile.id,v_profile.profile_fingerprint);
  exception when others then v_failed:=true; end;
  assert v_failed, 'Un gate anterior cruzó al nuevo kit oficial.';

  v_gate:=public._agency_brand_record_gate('Contrato','test55-current-'||v_suffix,
    jsonb_build_object('human_review_required',true,'brand_identity','actual'),current_setting('momos.identity_actor'));
  assert exists(select 1 from public.agency_brand_gate_bindings where id=v_gate and brand_kit_id=v_kit.id
    and brand_kit_fingerprint=v_kit.kit_fingerprint), 'El gate nuevo no selló el kit exacto.';
  perform public._agency_brand_require_parent('Contrato','test55-current-'||v_suffix,v_profile.id,v_profile.profile_fingerprint);

  v_identity:=public.obtener_identidad_marca(true);
  assert (v_identity->>'ready')::boolean and jsonb_array_length(v_identity->'colors')=7
    and jsonb_array_length(v_identity->'assets')>=1, 'El DTO de Identidad está incompleto.';
  assert v_identity::text !~* 'storage[_-]?path|created[_-]?by|archived[_-]?by|generation[_-]?meta|notes|telefono|direccion|email',
    'Identidad expuso rutas, actores, notas o PII.';
  assert exists(select 1 from public.brand_library b where b.id
    and b.tono=v_profile.profile#>'{verbal,tone}' and b.frases=v_profile.profile#>'{verbal,approved_phrases}'),
    'La proyección verbal legado divergió del perfil activo.';
end $$;

set local role service_role;
do $$ declare v_context jsonb; v_brand jsonb; begin
  -- El runtime real consume el contrato público security-definer. El helper
  -- interno permanece deliberadamente sin EXECUTE para service_role.
  v_context:=public.obtener_contexto_director_agencia();
  v_brand:=v_context#>'{snapshot,agency,brand_contract}';
  assert coalesce(v_brand#>>'{active_kit,fingerprint}','') ~ '^[0-9a-f]{32}$', 'El Cerebro MCP no recibió el kit oficial.';
  assert coalesce((v_brand#>>'{active_kit,ready}')::boolean,false), 'El Cerebro MCP recibió un kit no íntegro.';
  assert coalesce((v_brand#>>'{rules,external_execution_allowed}')::boolean,true)=false, 'Identidad habilitó ejecución externa.';
  assert v_brand::text !~* 'storage[_-]?path|created[_-]?by|archived[_-]?by|notes|telefono|direccion|email',
    'El contexto MCP de Identidad expuso rutas, actores, notas o PII.';
end $$;
reset role;

select 'TESTS_OK — Identidad logo/paleta/versionado/gates/inmutabilidad/PII/RBAC PASS, rollback total' as resultado;
rollback;
