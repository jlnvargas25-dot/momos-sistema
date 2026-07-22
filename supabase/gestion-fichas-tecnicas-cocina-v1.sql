-- MOMOS OPS · H86 · gestión guiada de fichas técnicas de Cocina.
-- Cocina propone borradores; Administración publica. El contenido versionado
-- permanece inmutable y Realtime solo emite una versión compacta sin PII.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260720'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260720_85_fichas_tecnicas_cocina'
  ) then
    raise exception 'Falta el paso 85_fichas_tecnicas_cocina.';
  end if;
  if to_regclass('public.kitchen_procedure_versions') is null
     or to_regprocedure('public.guardar_ficha_tecnica_cocina(jsonb)') is null
     or to_regprocedure('public.activar_ficha_tecnica_cocina(bigint,text)') is null then
    raise exception 'Falta el contrato base de fichas técnicas H85.';
  end if;
end $$;

create table if not exists public.kitchen_procedure_sync_state(
  id smallint primary key default 1 check(id=1),
  version bigint not null default 0 check(version>=0),
  changed_at timestamptz not null default clock_timestamp()
);
insert into public.kitchen_procedure_sync_state(id,version)
values(1,0) on conflict(id) do nothing;

alter table public.kitchen_procedure_sync_state enable row level security;
drop policy if exists kitchen_procedure_sync_staff_read
  on public.kitchen_procedure_sync_state;
create policy kitchen_procedure_sync_staff_read
  on public.kitchen_procedure_sync_state for select to authenticated
  using(public.is_staff());
revoke all on table public.kitchen_procedure_sync_state
  from public,anon,authenticated,service_role;
grant select on table public.kitchen_procedure_sync_state to authenticated;

create or replace function public._touch_kitchen_procedure_sync_state()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  update public.kitchen_procedure_sync_state
  set version=version+1,changed_at=clock_timestamp()
  where id=1;
  return null;
end;
$$;
revoke all on function public._touch_kitchen_procedure_sync_state()
  from public,anon,authenticated,service_role;

drop trigger if exists kitchen_procedure_versions_touch_sync
  on public.kitchen_procedure_versions;
create trigger kitchen_procedure_versions_touch_sync
after insert or update on public.kitchen_procedure_versions
for each statement execute function public._touch_kitchen_procedure_sync_state();

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1 from pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public'
         and tablename='kitchen_procedure_sync_state'
     ) then
    execute 'alter publication supabase_realtime add table public.kitchen_procedure_sync_state';
  end if;
end $$;

create or replace function public.guardar_ficha_tecnica_cocina(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_subrecipe_id text;
  v_note text;
  v_source_ref text;
  v_steps jsonb;
  v_defined boolean;
  v_version integer;
  v_payload jsonb;
  v_fingerprint text;
  v_id bigint;
  v_sync_version bigint;
begin
  if public.current_user_has_any_role(array['Administrador','Cocina']::text[]) is not true then
    raise exception 'Solo Administrador o Cocina pueden proponer una ficha técnica.';
  end if;
  if jsonb_typeof(p)<>'object' or exists(
    select 1 from jsonb_object_keys(p) key
    where key not in ('subrecipe_id','process_defined','note','steps','source_ref')
  ) then raise exception 'El payload de la ficha no cumple el contrato cerrado.'; end if;
  v_subrecipe_id:=nullif(btrim(coalesce(p->>'subrecipe_id','')),'');
  v_note:=nullif(btrim(coalesce(p->>'note','')),'');
  v_source_ref:=coalesce(nullif(btrim(coalesce(p->>'source_ref','')),''),'Procedimiento interno MOMOS');
  v_steps:=coalesce(p->'steps','[]'::jsonb);
  begin v_defined:=(p->>'process_defined')::boolean;
  exception when others then raise exception 'process_defined debe ser booleano.'; end;
  if v_subrecipe_id is null or v_note is null or length(v_note)>1000
     or length(v_source_ref)>200 or not public._validar_pasos_ficha_tecnica(v_steps)
     or (v_defined and jsonb_array_length(v_steps)=0) then
    raise exception 'Subreceta, nota y pasos válidos son obligatorios.';
  end if;
  if not exists(select 1 from public.subrecetas where id=v_subrecipe_id and activo) then
    raise exception 'La subreceta no existe o está inactiva.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('momos-ficha-tecnica:'||v_subrecipe_id,0));
  select coalesce(max(version),0)+1 into v_version
  from public.kitchen_procedure_versions where subrecipe_id=v_subrecipe_id;
  v_payload:=jsonb_build_object(
    'subrecipe_id',v_subrecipe_id,'version',v_version,
    'process_defined',v_defined,'note',v_note,'steps',v_steps,
    'source_ref',v_source_ref
  );
  v_fingerprint:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  insert into public.kitchen_procedure_versions(
    subrecipe_id,version,status,process_defined,note,steps,source_ref,
    fingerprint,created_by
  ) values(
    v_subrecipe_id,v_version,'Borrador',v_defined,v_note,v_steps,v_source_ref,
    v_fingerprint,auth.uid()
  ) returning id into v_id;
  perform public._add_audit(
    'Ficha técnica Cocina',v_id::text,'Borrador propuesto','',
    v_subrecipe_id||' · versión '||v_version::text
  );
  select version into v_sync_version
  from public.kitchen_procedure_sync_state where id=1;
  return jsonb_build_object(
    'contract','momos.kitchen-procedure-draft.v1','id',v_id,
    'subrecipe_id',v_subrecipe_id,'version',v_version,'status','Borrador',
    'fingerprint',v_fingerprint,'sync_version',v_sync_version::text,
    'external_execution',false
  );
end;
$$;
revoke all on function public.guardar_ficha_tecnica_cocina(jsonb)
  from public,anon,service_role;
grant execute on function public.guardar_ficha_tecnica_cocina(jsonb)
  to authenticated;

create or replace function public.activar_ficha_tecnica_cocina(
  p_id bigint,p_confirmacion text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_row public.kitchen_procedure_versions%rowtype;
  v_sync_version bigint;
begin
  if public.is_admin() is not true then
    raise exception 'Solo Administrador puede publicar una ficha técnica.';
  end if;
  if btrim(coalesce(p_confirmacion,''))<>'ACTIVAR FICHA' then
    raise exception 'Escribí ACTIVAR FICHA para confirmar la publicación.';
  end if;
  select * into v_row from public.kitchen_procedure_versions where id=p_id;
  if v_row.id is null then raise exception 'La ficha no existe.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('momos-ficha-tecnica:'||v_row.subrecipe_id,0));
  select * into v_row from public.kitchen_procedure_versions
  where id=p_id for update;
  if v_row.status<>'Borrador' then raise exception 'Solo un borrador puede publicarse.'; end if;
  perform set_config('momos.activar_ficha_tecnica','1',true);
  update public.kitchen_procedure_versions
  set status='Archivado'
  where subrecipe_id=v_row.subrecipe_id and status='Vigente';
  update public.kitchen_procedure_versions
  set status='Vigente',approved_by=auth.uid(),approved_at=clock_timestamp()
  where id=p_id;
  perform public._add_audit(
    'Ficha técnica Cocina',p_id::text,'Ficha publicada','Borrador',
    v_row.subrecipe_id||' · versión '||v_row.version::text
  );
  select version into v_sync_version
  from public.kitchen_procedure_sync_state where id=1;
  return jsonb_build_object(
    'contract','momos.kitchen-procedure-activation.v1','id',p_id,
    'subrecipe_id',v_row.subrecipe_id,'version',v_row.version,
    'status','Vigente','fingerprint',v_row.fingerprint,
    'sync_version',v_sync_version::text,'external_execution',false
  );
end;
$$;
revoke all on function public.activar_ficha_tecnica_cocina(bigint,text)
  from public,anon,service_role;
grant execute on function public.activar_ficha_tecnica_cocina(bigint,text)
  to authenticated;

create or replace function public.archivar_borrador_ficha_tecnica(
  p_id bigint,p_confirmacion text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_row public.kitchen_procedure_versions%rowtype;
  v_sync_version bigint;
begin
  if public.current_user_has_any_role(array['Administrador','Cocina']::text[]) is not true then
    raise exception 'Solo Administrador o Cocina pueden archivar un borrador.';
  end if;
  if btrim(coalesce(p_confirmacion,''))<>'ARCHIVAR BORRADOR' then
    raise exception 'Escribí ARCHIVAR BORRADOR para confirmar.';
  end if;
  select * into v_row from public.kitchen_procedure_versions
  where id=p_id for update;
  if v_row.id is null then raise exception 'La ficha no existe.'; end if;
  if v_row.status<>'Borrador' then raise exception 'Solo un borrador puede archivarse.'; end if;
  if public.is_admin() is not true and v_row.created_by is distinct from auth.uid() then
    raise exception 'Cocina solo puede archivar sus propios borradores.';
  end if;
  perform set_config('momos.activar_ficha_tecnica','1',true);
  update public.kitchen_procedure_versions set status='Archivado' where id=p_id;
  perform public._add_audit(
    'Ficha técnica Cocina',p_id::text,'Borrador archivado','Borrador',
    v_row.subrecipe_id||' · versión '||v_row.version::text
  );
  select version into v_sync_version
  from public.kitchen_procedure_sync_state where id=1;
  return jsonb_build_object(
    'contract','momos.kitchen-procedure-archive.v1','id',p_id,
    'subrecipe_id',v_row.subrecipe_id,'version',v_row.version,
    'status','Archivado','sync_version',v_sync_version::text,
    'external_execution',false
  );
end;
$$;
revoke all on function public.archivar_borrador_ficha_tecnica(bigint,text)
  from public,anon,service_role;
grant execute on function public.archivar_borrador_ficha_tecnica(bigint,text)
  to authenticated;

create or replace function public.listar_fichas_tecnicas_cocina(
  p_subrecipe_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_subrecipe_id text:=nullif(btrim(coalesce(p_subrecipe_id,'')),'');
  v_sync_version bigint;
  v_rows jsonb;
begin
  if public.current_user_has_any_role(array['Administrador','Cocina']::text[]) is not true then
    raise exception 'Solo Administrador o Cocina pueden consultar el historial de fichas.';
  end if;
  if v_subrecipe_id is null or not exists(
    select 1 from public.subrecetas where id=v_subrecipe_id
  ) then raise exception 'La subreceta solicitada no existe.'; end if;
  select version into v_sync_version
  from public.kitchen_procedure_sync_state where id=1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'subrecipeId',x.subrecipe_id,'version',x.version,
    'status',x.status,'processDefined',x.process_defined,
    'note',x.note,'steps',x.steps,'sourceRef',x.source_ref,
    'fingerprint',x.fingerprint,'createdAt',x.created_at,
    'approvedAt',x.approved_at
  ) order by x.version desc),'[]'::jsonb)
  into v_rows
  from (
    select id,subrecipe_id,version,status,process_defined,note,steps,
      source_ref,fingerprint,created_at,approved_at
    from public.kitchen_procedure_versions
    where subrecipe_id=v_subrecipe_id
    order by version desc limit 50
  ) x;
  return jsonb_build_object(
    'contract','momos.kitchen-procedure-history.v1',
    'subrecipeId',v_subrecipe_id,'syncVersion',v_sync_version::text,
    'rows',v_rows,'containsPii',false,'externalExecution',false
  );
end;
$$;
revoke all on function public.listar_fichas_tecnicas_cocina(text)
  from public,anon,service_role;
grant execute on function public.listar_fichas_tecnicas_cocina(text)
  to authenticated;

-- Conserva el snapshot compacto de H85 y agrega solo el cursor del outbox.
create or replace function public.momos_core_snapshot_v2()
returns jsonb
language plpgsql
stable
security invoker
set search_path=pg_catalog,public,pg_temp
as $$
declare v_base jsonb; v_sync_version bigint:=0;
begin
  v_base:=public.momos_core_snapshot_v1();
  select version into v_sync_version
  from public.kitchen_procedure_sync_state where id=1;
  return jsonb_set(v_base,'{version}','2'::jsonb,true)
    || jsonb_build_object(
      'kitchen_procedure_sync_version',coalesce(v_sync_version,0)::text,
      'kitchen_procedures',coalesce((
        select jsonb_agg(to_jsonb(x) order by x.subrecipe_id)
        from (
          select subrecipe_id,version,process_defined,note,steps,source_ref,
            fingerprint,approved_at
          from public.kitchen_procedure_versions
          where status='Vigente'
          order by subrecipe_id
        ) x
      ),'[]'::jsonb)
    );
end;
$$;
revoke all on function public.momos_core_snapshot_v2()
  from public,anon,service_role;
grant execute on function public.momos_core_snapshot_v2() to authenticated;

create or replace function public.gestion_fichas_tecnicas_cocina_disponible()
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select public.current_user_has_any_role(array['Administrador','Cocina']::text[])
    and exists(
      select 1 from public.momos_ops_migrations
      where id='20260720_86_gestion_fichas_tecnicas'
    )
    and to_regclass('public.kitchen_procedure_sync_state') is not null
    and to_regprocedure('public.listar_fichas_tecnicas_cocina(text)') is not null
$$;
revoke all on function public.gestion_fichas_tecnicas_cocina_disponible()
  from public,anon,service_role;
grant execute on function public.gestion_fichas_tecnicas_cocina_disponible()
  to authenticated;

-- Mantiene el manifiesto único de Data Sync y agrega H86 sin una sonda HTTP.
create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_capabilities jsonb; v_schema_version text; v_inventory_event_id bigint:=0;
  v_finance_version bigint:=0; v_configuration_version bigint:=0;
  v_dashboard_version bigint:=0; v_delivery_version bigint:=0;
begin
  if auth.uid() is null or not exists(
    select 1 from public.users u where u.auth_id=auth.uid() and u.activo
  ) then raise exception 'Sesión MOMOS inválida.' using errcode='42501'; end if;
  select coalesce(jsonb_object_agg(
    x.name,to_regprocedure(format('public.%I()',x.name)) is not null
  ),'{}'::jsonb)
  into v_capabilities from unnest(array[
    'roles_multiples_disponible','productos_servidor_disponible','agencia_comercial_disponible','orquestador_agencia_disponible',
    'centro_acciones_agencia_disponible','resultados_acciones_agencia_disponibles','mesa_agencia_disponible','estudio_escenas_disponible',
    'motion_experience_disponible','enrutador_escenas_disponible','calidad_postproduccion_disponible','postproduccion_exportacion_disponible',
    'postproduccion_audio_disponible','retencion_guiones_disponible','retencion_loops_disponible','observatorio_meta_disponible',
    'incrementalidad_meta_disponible','escenarios_inversion_meta_disponible','autorizacion_inversion_meta_disponible','meta_conector_dry_run_disponible',
    'distribucion_comercial_disponible','distribucion_conectores_disponible','biblioteca_creativa_disponible','produccion_creativa_disponible',
    'revision_creativa_disponible','versiones_creativas_disponibles','integraciones_agencia_disponibles','higgsfield_conector_disponible',
    'kling_conector_disponible','gobernanza_marca_disponible','motor_crecimiento_multimodo_disponible','flujo_creativo_e2e_disponible',
    'operacion_pedido_disponible','crm_clientes_disponible','identidad_marca_disponible','mundo_animado_disponible',
    'eliminacion_logo_oficial_disponible','biblioteca_produccion_disponible','mcp_aprobaciones_humanas_disponible',
    'inventario_deltas_disponibles','pedidos_deltas_disponibles','producto_terminado_deltas_disponibles',
    'produccion_deltas_disponibles','catalogo_crm_deltas_disponibles','finanzas_operativas_disponibles','configuracion_servidor_disponible',
    'dashboard_operativo_disponible','domicilios_snapshot_disponible','domicilios_mutaciones_atomicas_disponibles',
    'desecho_producto_terminado_disponible','fichas_tecnicas_cocina_disponibles','gestion_fichas_tecnicas_cocina_disponible'
  ]::text[]) x(name);
  select id into v_schema_version from public.momos_ops_migrations
  order by applied_at desc,id desc limit 1;
  select version into v_finance_version from public.finance_sync_state where id=1;
  select version into v_configuration_version from public.configuration_sync_state where id=1;
  select version into v_dashboard_version from public.dashboard_sync_state where id=1;
  select version into v_delivery_version from public.delivery_sync_state where id=1;
  v_inventory_event_id:=4611686018427387904
    +((pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot()))::text)::bigint;
  return jsonb_build_object(
    'version',1,'schema_version',coalesce(v_schema_version,''),
    'server_time',clock_timestamp(),'capabilities',v_capabilities,
    'inventory_latest_event_id',v_inventory_event_id::text,
    'domains',jsonb_build_object(
      'catalogos',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',900),
      'operativo',jsonb_build_object('version',extract(epoch from clock_timestamp())::bigint,'ttl_seconds',60,'inventory_latest_event_id',v_inventory_event_id::text),
      'agencia',jsonb_build_object('version',coalesce(v_schema_version,''),'ttl_seconds',300),
      'finanzas',jsonb_build_object('version',coalesce(v_finance_version,0)::text,'ttl_seconds',60),
      'configuracion',jsonb_build_object('version',coalesce(v_configuration_version,0)::text,'ttl_seconds',300),
      'dashboard',jsonb_build_object('version',coalesce(v_dashboard_version,0)::text,'ttl_seconds',30),
      'logistica',jsonb_build_object('version',coalesce(v_delivery_version,0)::text,'ttl_seconds',30)
    ),'contains_pii',false,'contains_secrets',false,'external_execution',false
  );
end $$;
revoke all on function public.momos_sync_manifest_v1()
  from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values(
  '20260720_86_gestion_fichas_tecnicas',
  'Borradores de Cocina, aprobación administrativa, historial bajo demanda y sincronización compacta'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
