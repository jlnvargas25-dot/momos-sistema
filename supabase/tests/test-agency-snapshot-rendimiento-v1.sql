-- MOMOS OPS · prueba adversarial H66 Snapshot escalonado de Agencia.
-- Siempre ROLLBACK: no deja actores, fixtures, sentinelas ni cambios de prueba.

begin;

do $$
declare
  v_sources text[];
begin
  assert exists(
    select 1 from public.momos_ops_migrations
    where id='20260718_66_agency_snapshot_rendimiento'
  ), 'Falta aplicar H66.';
  assert to_regclass('public.agency_snapshot_events') is not null,
    'Falta el singleton sanitizado de Realtime.';
  assert to_regprocedure('public.momos_agency_snapshot_v1(text)') is not null,
    'Falta el snapshot de Agencia por scope.';
  assert to_regprocedure('public.momos_agency_snapshots_v1()') is not null,
    'Falta el bundle atomico de Agencia.';
  assert has_function_privilege('authenticated','public.momos_agency_snapshot_v1(text)','EXECUTE')
    and not has_function_privilege('anon','public.momos_agency_snapshot_v1(text)','EXECUTE')
    and not has_function_privilege('service_role','public.momos_agency_snapshot_v1(text)','EXECUTE'),
    'H66 perdio la frontera autenticada de lectura.';
  assert has_function_privilege('authenticated','public.momos_agency_snapshots_v1()','EXECUTE')
    and not has_function_privilege('anon','public.momos_agency_snapshots_v1()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_agency_snapshots_v1()','EXECUTE'),
    'El bundle H66 perdio la frontera autenticada de lectura.';
  assert not has_function_privilege('authenticated','public._momos_agency_scope_payload_v1(text)','EXECUTE')
    and not has_function_privilege('service_role','public._momos_agency_scope_payload_v1(text)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)','EXECUTE')
    and not has_function_privilege('service_role','public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_agency_snapshot_source_tables_v1()','EXECUTE')
    and not has_function_privilege('service_role','public._momos_agency_snapshot_source_tables_v1()','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_touch_agency_snapshot_event_v1()','EXECUTE')
    and not has_function_privilege('service_role','public._momos_touch_agency_snapshot_event_v1()','EXECUTE'),
    'Un helper interno H66 quedo expuesto.';
  assert exists(
    select 1 from pg_proc p
    where p.oid='public.momos_agency_snapshot_v1(text)'::regprocedure
      and p.provolatile='s' and p.prosecdef
      and array_to_string(p.proconfig,'|') like '%search_path=pg_catalog, public, pg_temp%'
  ), 'H66 dejo de ser STABLE SECURITY DEFINER con search_path cerrado.';
  assert exists(
    select 1 from pg_proc p
    where p.oid='public.momos_agency_snapshots_v1()'::regprocedure
      and p.provolatile='s' and p.prosecdef
      and array_to_string(p.proconfig,'|') like '%search_path=pg_catalog, public, pg_temp%'
  ), 'El bundle H66 dejo de ser STABLE SECURITY DEFINER con search_path cerrado.';
  assert position('current_user_has_any_role' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0
    and position('Administrador' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0
    and position('Marketing/CRM' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0
    and position('jsonb_build_array' in pg_get_functiondef('public.momos_agency_snapshots_v1()'::regprocedure))>0,
    'El bundle H66 perdio gate, roles o arreglo atomico de snapshots.';
  assert exists(
    select 1 from pg_proc p
    where p.oid='public._momos_agency_snapshot_envelope_v1(text,bigint,timestamp with time zone)'::regprocedure
      and p.provolatile='s' and p.prosecdef
      and array_to_string(p.proconfig,'|') like '%search_path=pg_catalog, public, pg_temp%'
  ), 'El helper de sobre H66 perdio STABLE SECURITY DEFINER o search_path cerrado.';
  assert exists(
    select 1 from pg_proc p
    where p.oid='public._momos_touch_agency_snapshot_event_v1()'::regprocedure
      and p.prosecdef
      and array_to_string(p.proconfig,'|') like '%search_path=pg_catalog, public, pg_temp%'
  ), 'El trigger del singleton perdio SECURITY DEFINER o search_path cerrado.';

  assert exists(
    select 1 from pg_class c
    where c.oid='public.agency_snapshot_events'::regclass and c.relrowsecurity
  ), 'El singleton H66 no tiene RLS.';
  assert has_table_privilege('authenticated','public.agency_snapshot_events','SELECT')
    and not has_table_privilege('authenticated','public.agency_snapshot_events','INSERT')
    and not has_table_privilege('authenticated','public.agency_snapshot_events','UPDATE')
    and not has_table_privilege('authenticated','public.agency_snapshot_events','DELETE')
    and not has_table_privilege('anon','public.agency_snapshot_events','SELECT')
    and not has_table_privilege('service_role','public.agency_snapshot_events','SELECT'),
    'El singleton H66 expone mutaciones o lectura fuera de authenticated.';
  assert exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='agency_snapshot_events'
      and policyname='agency_snapshot_events_authorized_read'
      and cmd='SELECT'
      and qual like '%current_user_has_any_role%'
      and qual like '%Administrador%'
      and qual like '%Marketing/CRM%'
  ), 'RLS del singleton no limita lectura a Administrador/Marketing.';
  assert (select count(*) from public.agency_snapshot_events)=1
    and exists(select 1 from public.agency_snapshot_events where id=true and version>0),
    'El outbox H66 no es singleton o tiene version invalida.';

  v_sources:=public._momos_agency_snapshot_source_tables_v1();
  assert cardinality(v_sources)=66, 'H66 perdio o agrego una fuente sin actualizar su contrato cerrado.';
  assert array['agency_brand_kits','agency_brand_color_tokens','agency_brand_kit_assets']::text[] <@ v_sources,
    'Identidad de marca no invalida el snapshot H66.';
  assert not exists(
    select 1 from unnest(v_sources) s(table_name)
    where to_regclass(format('public.%I',s.table_name)) is null
  ), 'La lista H66 contiene una fuente inexistente.';
  assert not exists(
    select 1
    from unnest(v_sources) s(table_name)
    where not exists(
      select 1
      from pg_trigger t
      where t.tgrelid=to_regclass(format('public.%I',s.table_name))
        and t.tgname='momos_agency_snapshot_event_v1'
        and not t.tgisinternal
        and t.tgfoid='public._momos_touch_agency_snapshot_event_v1()'::regprocedure
        and (t.tgtype::integer & 1)=0
        and (t.tgtype::integer & 60)=60
    )
  ), 'Una fuente H66 no tiene trigger por sentencia para INSERT/UPDATE/DELETE/TRUNCATE.';

  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert not (select puballtables from pg_publication where pubname='supabase_realtime'),
      'Realtime FOR ALL TABLES expone fuentes H66 crudas.';
    assert exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='agency_snapshot_events'
    ), 'Realtime no publica el singleton sanitizado H66.';
    assert not exists(
      select 1
      from pg_publication_tables p
      join unnest(v_sources) s(table_name) on s.table_name=p.tablename
      where p.pubname='supabase_realtime' and p.schemaname='public'
    ), 'Realtime conserva al menos una fuente H66 cruda.';
    assert not exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename in (
          'brand_media_assets','brand_asset_production_profiles',
          'brand_production_packs','brand_production_pack_assets'
        )
    ), 'Realtime conserva tablas crudas de marca.';
  end if;
end $$;

-- Fixtures independientes y validos. El hash es SHA-256 hexadecimal de 64
-- caracteres; la actualizacion de integracion debe afectar exactamente una fila.
do $$
declare
  v_actor public.users%rowtype;
  v_provider text;
  v_asset bigint;
  v_rows integer;
  v_version_before bigint;
  v_version_after bigint;
  v_hash text:=md5('H66-ASSET-A-'||pg_backend_pid()::text)||md5('H66-ASSET-B-'||pg_backend_pid()::text);
begin
  select * into v_actor
  from public.users
  where activo and auth_id is not null
    and coalesce(roles,array[rol]) && array['Administrador','Marketing/CRM']::text[]
  order by case when 'Administrador'=any(coalesce(roles,array[rol])) then 0 else 1 end,id
  limit 1;
  assert v_actor.id is not null, 'Falta actor de Agencia para H66.';

  select provider into v_provider from public.agency_integrations order by provider limit 1;
  assert v_provider is not null, 'Falta una integracion existente independiente para H66.';
  select version into v_version_before from public.agency_snapshot_events where id=true;

  update public.agency_integrations
  set external_account_id='H66-PII-SECRET-ACCOUNT',
      last_error='H66-API-KEY-SECRET'
  where provider=v_provider;
  get diagnostics v_rows=row_count;
  assert v_rows=1, 'El sentinel de integracion no afecto exactamente una fila.';

  insert into public.brand_media_assets(
    name,media_type,source,orientation,contains_people,rights_status,
    ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,
    size_bytes,tags,notes,created_by
  ) values(
    'Fixture H66 independiente','Foto','MOMOS','Cuadrado',false,'Propio',
    true,'["Instagram"]'::jsonb,'Activo',
    'tests/h66-'||pg_backend_pid()::text||'.png',v_hash,'image/png',64,
    '["h66"]'::jsonb,'H66-PII-NOTA-PRIVADA',v_actor.id
  ) returning id into v_asset;
  assert v_asset is not null and length(v_hash)=64 and v_hash~'^[0-9a-f]{64}$',
    'El fixture de marca no tiene SHA-256 hexadecimal valido.';

  select version into v_version_after from public.agency_snapshot_events where id=true;
  assert v_version_after=v_version_before+2,
    'Los triggers por sentencia no incrementaron una vez por cada fuente modificada.';

  perform set_config('momos.h66_actor_auth',v_actor.auth_id::text,true);
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',current_setting('momos.h66_actor_auth'),'role','authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_scope text;
  v_result jsonb;
  v_again jsonb;
  v_bundle jsonb;
  v_snapshot jsonb;
  v_bundle_version bigint;
  v_bundle_time text;
  v_index integer;
  v_scope_order text[]:=array['overview','workflow','production','measurement'];
  v_events text[]:=array[]::text[];
  v_decisions_before bigint;
  v_jobs_before bigint;
  v_mutation_denied boolean:=false;
begin
  assert (select count(*) from public.agency_snapshot_events)=1,
    'RLS oculto el singleton a un actor autorizado.';
  begin
    update public.agency_snapshot_events set version=version+1 where id=true;
  exception when insufficient_privilege then v_mutation_denied:=true;
  end;
  assert v_mutation_denied, 'Un cliente autenticado pudo mutar el singleton.';

  select count(*) into v_decisions_before from public.agency_decisions;
  select count(*) into v_jobs_before from public.creative_generation_jobs;

  v_bundle:=public.momos_agency_snapshots_v1();
  assert (
    select array_agg(k order by k) from jsonb_object_keys(v_bundle) keys(k)
  )=array['server_time','snapshots','source_version','version'],
    'El bundle H66 cambio o expuso datos fuera del contrato.';
  assert (v_bundle->>'version')::integer=1
    and (v_bundle->>'source_version')::bigint>0
    and (v_bundle->>'source_version')::bigint=(select version from public.agency_snapshot_events where id=true)
    and nullif(v_bundle->>'server_time','') is not null
    and jsonb_typeof(v_bundle->'snapshots')='array'
    and jsonb_array_length(v_bundle->'snapshots')=4,
    'El bundle H66 no sello version, reloj, source_version o los cuatro snapshots.';

  v_bundle_version:=(v_bundle->>'source_version')::bigint;
  v_bundle_time:=v_bundle->>'server_time';
  for v_index in 0..3 loop
    v_scope:=v_scope_order[v_index+1];
    v_snapshot:=v_bundle->'snapshots'->v_index;
    assert (
      select array_agg(k order by k) from jsonb_object_keys(v_snapshot) keys(k)
    )=array['authority','event_id','payload','privacy','scope','server_time','source_version','version'],
      format('El snapshot atomico %s cambio su sobre cerrado.',v_scope);
    assert v_snapshot->>'scope'=v_scope
      and (v_snapshot->>'source_version')::bigint=v_bundle_version
      and v_snapshot->>'server_time'=v_bundle_time
      and v_snapshot->>'event_id'=md5(v_scope||':'||v_bundle_version::text),
      format('El snapshot atomico %s no comparte version/reloj o perdio su cursor.',v_scope);
    assert v_snapshot#>>'{privacy,projection}'='agency-authorized-v1'
      and coalesce((v_snapshot#>>'{privacy,customer_records_projected}')::boolean,true)=false
      and coalesce((v_snapshot#>>'{privacy,secrets_projected}')::boolean,true)=false
      and coalesce((v_snapshot#>>'{privacy,free_text_unverified}')::boolean,false)=true
      and coalesce((v_snapshot#>>'{privacy,telemetry_allowed}')::boolean,true)=false
      and coalesce((v_snapshot#>>'{authority,read_only}')::boolean,false)=true
      and coalesce((v_snapshot#>>'{authority,external_execution}')::boolean,true)=false,
      format('El snapshot atomico %s perdio privacidad o autoridad.',v_scope);
    v_again:=public.momos_agency_snapshot_v1(v_scope);
    assert (v_again->>'source_version')::bigint=v_bundle_version
      and v_again->>'event_id'=v_snapshot->>'event_id',
      format('El RPC compatible y el bundle discrepan para %s sin una escritura fuente.',v_scope);
  end loop;
  assert jsonb_typeof(v_bundle#>'{snapshots,0,payload,agency_brand_identity}')='object'
    and coalesce((v_bundle#>>'{snapshots,0,payload,agency_brand_identity,contains_secrets}')::boolean,false)=false
    and (v_bundle#>'{snapshots,0,payload,agency_brand_identity}')::text !~* 'storage_path|signed_url',
    'Identidad no viajo como metadato seguro dentro del bundle H66.';
  assert v_bundle::text !~* 'H66-PII-|H66-API-KEY|access[_-]?token|service[_-]?role',
    'El bundle atomico expuso PII, nota o secreto excluido.';

  foreach v_scope in array array['overview','workflow','production','measurement'] loop
    v_result:=public.momos_agency_snapshot_v1(v_scope);
    v_again:=public.momos_agency_snapshot_v1(v_scope);

    assert (
      select array_agg(k order by k) from jsonb_object_keys(v_result) keys(k)
    )=array['authority','event_id','payload','privacy','scope','server_time','source_version','version'],
      format('El sobre H66 de %s cambio o expuso datos fuera de contrato.',v_scope);
    assert (v_result->>'version')::integer=1
      and (v_result->>'source_version')::bigint=v_bundle_version
      and v_result->>'scope'=v_scope
      and nullif(v_result->>'server_time','') is not null
      and v_result->>'event_id' ~ '^[0-9a-f]{32}$',
      format('H66 no sello version, scope, reloj o event_id para %s.',v_scope);
    assert v_result->>'event_id'=v_again->>'event_id',
      format('El event_id de %s cambio sin una sentencia fuente.',v_scope);

    assert v_result#>>'{privacy,projection}'='agency-authorized-v1'
      and coalesce((v_result#>>'{privacy,customer_records_projected}')::boolean,true)=false
      and coalesce((v_result#>>'{privacy,secrets_projected}')::boolean,true)=false
      and coalesce((v_result#>>'{privacy,free_text_unverified}')::boolean,false)=true
      and coalesce((v_result#>>'{privacy,telemetry_allowed}')::boolean,true)=false,
      format('El scope %s perdio su contrato de privacidad honesto.',v_scope);
    assert coalesce((v_result#>>'{privacy,storage_references_projected}')::boolean,false)=(v_scope='production'),
      format('El scope %s declaro mal sus referencias de Storage.',v_scope);
    assert coalesce((v_result#>>'{authority,read_only}')::boolean,false)=true
      and coalesce((v_result#>>'{authority,external_execution}')::boolean,true)=false
      and coalesce((v_result#>>'{authority,human_approval_required}')::boolean,false)=true,
      format('El scope %s perdio la autoridad de solo lectura.',v_scope);
    assert v_result::text !~* 'H66-PII-|H66-API-KEY|access[_-]?token|service[_-]?role',
      format('El scope %s expuso PII, nota o secreto excluido.',v_scope);

    v_events:=array_append(v_events,v_result->>'event_id');
  end loop;

  assert cardinality(array(select distinct unnest(v_events)))=4,
    'Los cuatro scopes comparten cursor y no se pueden invalidar por separado.';
  assert (select count(*) from public.agency_decisions)=v_decisions_before
    and (select count(*) from public.creative_generation_jobs)=v_jobs_before,
    'Una lectura H66 modifico decisiones o trabajos creativos.';

  v_result:=public.momos_agency_snapshot_v1('overview');
  assert coalesce((v_result#>>'{payload,agency_snapshot_ready}')::boolean,false)=true
    and jsonb_typeof(v_result->'payload'->'agency_briefs')='array'
    and jsonb_typeof(v_result->'payload'->'campaigns')='array'
    and jsonb_typeof(v_result->'payload'->'agency_growth_policies')='array',
    'Overview no declara readiness o no cierra decisiones, marketing y crecimiento.';
  v_result:=public.momos_agency_snapshot_v1('workflow');
  assert jsonb_typeof(v_result->'payload'->'agency_agent_proposals')='array'
    and jsonb_typeof(v_result->'payload'->'content_distributions')='array'
    and jsonb_typeof(v_result->'payload'->'agency_integrations')='array',
    'Workflow no cierra propuestas, distribucion e integraciones.';
  v_result:=public.momos_agency_snapshot_v1('production');
  assert jsonb_typeof(v_result->'payload'->'brand_media_assets')='array'
    and jsonb_typeof(v_result->'payload'->'agency_storyboards')='array'
    and jsonb_typeof(v_result->'payload'->'agency_postproduction_exports')='array',
    'Production no cierra Biblioteca, Estudio o exportacion.';
  v_result:=public.momos_agency_snapshot_v1('measurement');
  assert jsonb_typeof(v_result->'payload'->'agency_retention_measurements')='array'
    and jsonb_typeof(v_result->'payload'->'agency_meta_snapshots')='array'
    and jsonb_typeof(v_result->'payload'->'agency_meta_lift_measurements')='array',
    'Measurement no cierra retencion, Meta e incrementalidad.';

  v_mutation_denied:=false;
  begin
    perform public.momos_agency_snapshot_v1('users; drop table public.users');
  exception when sqlstate '22023' then v_mutation_denied:=true;
  end;
  assert v_mutation_denied, 'Un scope arbitrario pudo atravesar la lista cerrada.';
end $$;

reset role;

-- UUID autenticado no vinculado: prueba RBAC sin tocar roles ni arriesgar al
-- ultimo Administrador real.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',gen_random_uuid()::text,'role','authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_failed boolean:=false;
begin
  assert (select count(*) from public.agency_snapshot_events)=0,
    'RLS del singleton expuso el evento a un UUID no vinculado.';
  begin
    perform public.momos_agency_snapshot_v1('overview');
  exception when sqlstate '42501' then v_failed:=true;
  end;
  assert v_failed, 'Un UUID no vinculado pudo leer Agencia.';
  v_failed:=false;
  begin
    perform public.momos_agency_snapshots_v1();
  exception when sqlstate '42501' then v_failed:=true;
  end;
  assert v_failed, 'Un UUID no vinculado pudo leer el bundle atomico de Agencia.';
end $$;

reset role;

select 'TESTS_OK — Agencia snapshot/outbox/privacidad/no ejecucion/RBAC PASS, rollback total' as resultado;
rollback;
