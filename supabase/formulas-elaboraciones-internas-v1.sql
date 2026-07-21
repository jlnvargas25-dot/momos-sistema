-- MOMOS OPS · H87 · fórmulas y procedimientos de elaboraciones internas.
-- Productos conserva su receta por unidad en Products/recipes. Inventario
-- gobierna las elaboraciones internas: fórmula por 1.000 g + procedimiento.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260720'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260720_86_gestion_fichas_tecnicas'
  ) then raise exception 'Falta el paso 86_gestion_fichas_tecnicas.'; end if;
  if to_regclass('public.subreceta_ingredientes') is null
     or to_regclass('public.kitchen_procedure_versions') is null then
    raise exception 'Faltan las fórmulas o fichas técnicas base.';
  end if;
end $$;

create or replace function public._validar_formula_elaboracion(p_formula jsonb)
returns boolean
language sql immutable
set search_path=pg_catalog,public,pg_temp
as $$
  select jsonb_typeof(p_formula)='array'
    and jsonb_array_length(p_formula) between 1 and 30
    and not exists(
      select 1 from jsonb_array_elements(p_formula) line
      where jsonb_typeof(line)<>'object'
        or nullif(btrim(coalesce(line->>'item_id','')),'') is null
        or length(btrim(line->>'item_id'))>100
        or jsonb_typeof(line->'cantidad')<>'number'
        or (line->>'cantidad')::numeric<=0
        or (line->>'cantidad')::numeric>100000
        or exists(
          select 1 from jsonb_object_keys(line) key
          where key not in ('item_id','cantidad')
        )
    )
    and (
      select count(*)=count(distinct line->>'item_id')
      from jsonb_array_elements(p_formula) line
    )
$$;
revoke all on function public._validar_formula_elaboracion(jsonb)
  from public,anon,authenticated,service_role;

create or replace function public._formula_elaboracion_tiene_ciclo(
  p_subrecipe_id text,p_formula jsonb
) returns boolean
language sql stable
set search_path=pg_catalog,public,pg_temp
as $$
  with recursive dependencias(id) as (
    select s.id
    from jsonb_array_elements(p_formula) line
    join public.subrecetas s on s.item_id=line->>'item_id'
    union
    select child.id
    from dependencias d
    join public.subreceta_ingredientes si on si.subreceta_id=d.id
    join public.subrecetas child on child.item_id=si.item_id
  )
  select exists(select 1 from dependencias where id=p_subrecipe_id)
$$;
revoke all on function public._formula_elaboracion_tiene_ciclo(text,jsonb)
  from public,anon,authenticated,service_role;

alter table public.kitchen_procedure_versions
  add column if not exists formula jsonb,
  add column if not exists formula_fingerprint text,
  add column if not exists formula_origin text;

update public.kitchen_procedure_versions k
set formula=coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id',si.item_id,'cantidad',si.cantidad
      ) order by si.item_id)
      from public.subreceta_ingredientes si
      where si.subreceta_id=k.subrecipe_id
    ),'[]'::jsonb),
    formula_origin='Captura inicial H87'
where formula is null;

update public.kitchen_procedure_versions
set formula_fingerprint=encode(sha256(convert_to(formula::text,'UTF8')),'hex')
where formula_fingerprint is null;

alter table public.kitchen_procedure_versions
  alter column formula set not null,
  alter column formula_fingerprint set not null,
  alter column formula_origin set not null;
alter table public.kitchen_procedure_versions
  drop constraint if exists kitchen_procedure_formula_valid,
  drop constraint if exists kitchen_procedure_formula_fingerprint_valid,
  drop constraint if exists kitchen_procedure_formula_origin_valid;
alter table public.kitchen_procedure_versions
  add constraint kitchen_procedure_formula_valid check(
    jsonb_typeof(formula)='array' and jsonb_array_length(formula)<=30
  ),
  add constraint kitchen_procedure_formula_fingerprint_valid check(
    formula_fingerprint~'^[0-9a-f]{64}$'
  ),
  add constraint kitchen_procedure_formula_origin_valid check(
    length(btrim(formula_origin)) between 1 and 200
  );

create or replace function public._proteger_ficha_tecnica_vigente()
returns trigger
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    raise exception 'Las fichas técnicas no se eliminan; se conserva su historial.';
  end if;
  if current_setting('momos.activar_ficha_tecnica',true)<>'1' then
    raise exception 'Las fichas técnicas solo cambian mediante su RPC gobernada.';
  end if;
  if old.subrecipe_id<>new.subrecipe_id or old.version<>new.version
     or old.process_defined<>new.process_defined or old.note<>new.note
     or old.steps<>new.steps or old.source_ref<>new.source_ref
     or old.fingerprint<>new.fingerprint
     or old.formula<>new.formula
     or old.formula_fingerprint<>new.formula_fingerprint
     or old.formula_origin<>new.formula_origin
     or old.created_by is distinct from new.created_by
     or old.created_at<>new.created_at then
    raise exception 'El contenido de una versión es inmutable; creá una nueva versión.';
  end if;
  return new;
end;
$$;
revoke all on function public._proteger_ficha_tecnica_vigente()
  from public,anon,authenticated,service_role;

create or replace function public.guardar_ficha_tecnica_cocina(p jsonb)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_subrecipe_id text; v_note text; v_source_ref text; v_formula_origin text;
  v_steps jsonb; v_formula jsonb; v_normalized_formula jsonb;
  v_defined boolean; v_version integer; v_payload jsonb;
  v_fingerprint text; v_formula_fingerprint text; v_id bigint; v_sync_version bigint;
begin
  if public.current_user_has_any_role(array['Administrador','Cocina']::text[]) is not true then
    raise exception 'Solo Administrador o Cocina pueden proponer una ficha técnica.';
  end if;
  if jsonb_typeof(p)<>'object' or exists(
    select 1 from jsonb_object_keys(p) key
    where key not in ('subrecipe_id','process_defined','note','steps','source_ref','formula','formula_origin')
  ) then raise exception 'El payload de la ficha no cumple el contrato cerrado.'; end if;
  v_subrecipe_id:=nullif(btrim(coalesce(p->>'subrecipe_id','')),'');
  v_note:=nullif(btrim(coalesce(p->>'note','')),'');
  v_source_ref:=coalesce(nullif(btrim(coalesce(p->>'source_ref','')),''),'Procedimiento interno MOMOS');
  v_formula_origin:=coalesce(nullif(btrim(coalesce(p->>'formula_origin','')),''),'Fórmula interna MOMOS');
  v_steps:=coalesce(p->'steps','[]'::jsonb);
  begin v_defined:=(p->>'process_defined')::boolean;
  exception when others then raise exception 'process_defined debe ser booleano.'; end;
  if v_subrecipe_id is null or v_note is null or length(v_note)>1000
     or length(v_source_ref)>200 or length(v_formula_origin)>200
     or not public._validar_pasos_ficha_tecnica(v_steps)
     or (v_defined and jsonb_array_length(v_steps)=0) then
    raise exception 'Subreceta, nota y pasos válidos son obligatorios.';
  end if;
  if not exists(select 1 from public.subrecetas where id=v_subrecipe_id and activo) then
    raise exception 'La elaboración no existe o está inactiva.';
  end if;
  if p ? 'formula' then
    v_formula:=p->'formula';
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_id',si.item_id,'cantidad',si.cantidad
    ) order by si.item_id),'[]'::jsonb)
    into v_formula from public.subreceta_ingredientes si
    where si.subreceta_id=v_subrecipe_id;
  end if;
  if not public._validar_formula_elaboracion(v_formula) then
    raise exception 'La fórmula debe tener entre 1 y 30 insumos únicos con cantidades positivas.';
  end if;
  if exists(
    select 1 from jsonb_array_elements(v_formula) line
    left join public.inventory_items i on i.id=line->>'item_id'
    where i.id is null
  ) or public._formula_elaboracion_tiene_ciclo(v_subrecipe_id,v_formula) then
    raise exception 'La fórmula contiene un insumo inexistente o una dependencia circular.';
  end if;
  select jsonb_agg(jsonb_build_object(
    'item_id',x.item_id,'cantidad',x.cantidad
  ) order by x.item_id) into v_normalized_formula
  from jsonb_to_recordset(v_formula) x(item_id text,cantidad numeric);
  perform pg_advisory_xact_lock(hashtextextended('momos-ficha-tecnica:'||v_subrecipe_id,0));
  select coalesce(max(version),0)+1 into v_version
  from public.kitchen_procedure_versions where subrecipe_id=v_subrecipe_id;
  v_formula_fingerprint:=encode(sha256(convert_to(v_normalized_formula::text,'UTF8')),'hex');
  v_payload:=jsonb_build_object(
    'subrecipe_id',v_subrecipe_id,'version',v_version,
    'process_defined',v_defined,'note',v_note,'steps',v_steps,
    'source_ref',v_source_ref,'formula',v_normalized_formula,
    'formula_origin',v_formula_origin
  );
  v_fingerprint:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  insert into public.kitchen_procedure_versions(
    subrecipe_id,version,status,process_defined,note,steps,source_ref,
    fingerprint,created_by,formula,formula_fingerprint,formula_origin
  ) values(
    v_subrecipe_id,v_version,'Borrador',v_defined,v_note,v_steps,v_source_ref,
    v_fingerprint,auth.uid(),v_normalized_formula,v_formula_fingerprint,v_formula_origin
  ) returning id into v_id;
  perform public._add_audit('Ficha técnica Cocina',v_id::text,'Borrador integral propuesto','',
    v_subrecipe_id||' · versión '||v_version::text||' · fórmula y procedimiento');
  select version into v_sync_version from public.kitchen_procedure_sync_state where id=1;
  return jsonb_build_object(
    'contract','momos.kitchen-procedure-draft.v2','id',v_id,
    'subrecipe_id',v_subrecipe_id,'version',v_version,'status','Borrador',
    'fingerprint',v_fingerprint,'formula_fingerprint',v_formula_fingerprint,
    'sync_version',v_sync_version::text,'external_execution',false
  );
end;
$$;
revoke all on function public.guardar_ficha_tecnica_cocina(jsonb)
  from public,anon,service_role;
grant execute on function public.guardar_ficha_tecnica_cocina(jsonb) to authenticated;

create or replace function public.activar_ficha_tecnica_cocina(p_id bigint,p_confirmacion text)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_row public.kitchen_procedure_versions%rowtype; v_sync_version bigint;
begin
  if public.is_admin() is not true then raise exception 'Solo Administrador puede publicar una ficha técnica.'; end if;
  if btrim(coalesce(p_confirmacion,''))<>'ACTIVAR FICHA' then
    raise exception 'Escribí ACTIVAR FICHA para confirmar la publicación.';
  end if;
  select * into v_row from public.kitchen_procedure_versions where id=p_id;
  if v_row.id is null then raise exception 'La ficha no existe.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('momos-ficha-tecnica:'||v_row.subrecipe_id,0));
  perform 1 from public.subrecetas where id=v_row.subrecipe_id for update;
  select * into v_row from public.kitchen_procedure_versions where id=p_id for update;
  if v_row.status<>'Borrador' then raise exception 'Solo un borrador puede publicarse.'; end if;
  if not public._validar_formula_elaboracion(v_row.formula)
     or encode(sha256(convert_to(v_row.formula::text,'UTF8')),'hex')<>v_row.formula_fingerprint then
    raise exception 'La fórmula versionada no supera la verificación de integridad.';
  end if;
  if exists(
    select 1 from jsonb_array_elements(v_row.formula) line
    left join public.inventory_items i on i.id=line->>'item_id'
    where i.id is null
  ) or public._formula_elaboracion_tiene_ciclo(v_row.subrecipe_id,v_row.formula) then
    raise exception 'La fórmula contiene un insumo inexistente o circular.';
  end if;
  perform 1 from public.inventory_items i
  where i.id in (select line->>'item_id' from jsonb_array_elements(v_row.formula) line)
  order by i.id for share;
  perform set_config('momos.activar_ficha_tecnica','1',true);
  update public.kitchen_procedure_versions set status='Archivado'
  where subrecipe_id=v_row.subrecipe_id and status='Vigente';
  update public.kitchen_procedure_versions
  set status='Vigente',approved_by=auth.uid(),approved_at=clock_timestamp()
  where id=p_id;
  delete from public.subreceta_ingredientes where subreceta_id=v_row.subrecipe_id;
  insert into public.subreceta_ingredientes(subreceta_id,item_id,cantidad)
  select v_row.subrecipe_id,x.item_id,x.cantidad
  from jsonb_to_recordset(v_row.formula) x(item_id text,cantidad numeric)
  order by x.item_id;
  perform public._add_audit('Ficha técnica Cocina',p_id::text,'Ficha integral publicada','Borrador',
    v_row.subrecipe_id||' · versión '||v_row.version::text||' · fórmula y procedimiento');
  select version into v_sync_version from public.kitchen_procedure_sync_state where id=1;
  return jsonb_build_object(
    'contract','momos.kitchen-procedure-activation.v2','id',p_id,
    'subrecipe_id',v_row.subrecipe_id,'version',v_row.version,'status','Vigente',
    'fingerprint',v_row.fingerprint,'formula_fingerprint',v_row.formula_fingerprint,
    'sync_version',v_sync_version::text,'external_execution',false
  );
end;
$$;
revoke all on function public.activar_ficha_tecnica_cocina(bigint,text)
  from public,anon,service_role;
grant execute on function public.activar_ficha_tecnica_cocina(bigint,text) to authenticated;

create or replace function public.listar_fichas_tecnicas_cocina(p_subrecipe_id text)
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_subrecipe_id text:=nullif(btrim(coalesce(p_subrecipe_id,'')),''); v_sync_version bigint; v_rows jsonb;
begin
  if public.current_user_has_any_role(array['Administrador','Cocina']::text[]) is not true then
    raise exception 'Solo Administrador o Cocina pueden consultar el historial de fichas.';
  end if;
  if v_subrecipe_id is null or not exists(select 1 from public.subrecetas where id=v_subrecipe_id) then
    raise exception 'La elaboración solicitada no existe.';
  end if;
  select version into v_sync_version from public.kitchen_procedure_sync_state where id=1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'subrecipeId',x.subrecipe_id,'version',x.version,'status',x.status,
    'processDefined',x.process_defined,'note',x.note,'steps',x.steps,
    'sourceRef',x.source_ref,'fingerprint',x.fingerprint,
    'createdAt',x.created_at,'approvedAt',x.approved_at
  ) order by x.version desc),'[]'::jsonb) into v_rows
  from (
    select id,subrecipe_id,version,status,process_defined,note,steps,source_ref,
      fingerprint,formula,formula_fingerprint,formula_origin,created_at,approved_at
    from public.kitchen_procedure_versions where subrecipe_id=v_subrecipe_id
    order by version desc limit 50
  ) x;
  return jsonb_build_object(
    'contract','momos.kitchen-procedure-history.v1','subrecipeId',v_subrecipe_id,
    'syncVersion',v_sync_version::text,'rows',v_rows,'containsPii',false,'externalExecution',false
  );
end;
$$;
revoke all on function public.listar_fichas_tecnicas_cocina(text)
  from public,anon,service_role;
grant execute on function public.listar_fichas_tecnicas_cocina(text) to authenticated;

create or replace function public.listar_fichas_integrales_elaboracion(p_subrecipe_id text)
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_subrecipe_id text:=nullif(btrim(coalesce(p_subrecipe_id,'')),''); v_sync_version bigint; v_rows jsonb;
begin
  if public.current_user_has_any_role(array['Administrador','Cocina']::text[]) is not true then
    raise exception 'Solo Administrador o Cocina pueden consultar fórmulas internas.';
  end if;
  if v_subrecipe_id is null or not exists(select 1 from public.subrecetas where id=v_subrecipe_id) then
    raise exception 'La elaboración solicitada no existe.';
  end if;
  select version into v_sync_version from public.kitchen_procedure_sync_state where id=1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'subrecipeId',x.subrecipe_id,'version',x.version,'status',x.status,
    'processDefined',x.process_defined,'note',x.note,'steps',x.steps,
    'sourceRef',x.source_ref,'fingerprint',x.fingerprint,
    'formula',x.formula,'formulaFingerprint',x.formula_fingerprint,
    'formulaOrigin',x.formula_origin,'createdAt',x.created_at,'approvedAt',x.approved_at
  ) order by x.version desc),'[]'::jsonb) into v_rows
  from (
    select id,subrecipe_id,version,status,process_defined,note,steps,source_ref,
      fingerprint,formula,formula_fingerprint,formula_origin,created_at,approved_at
    from public.kitchen_procedure_versions where subrecipe_id=v_subrecipe_id
    order by version desc limit 50
  ) x;
  return jsonb_build_object(
    'contract','momos.internal-preparation-sheet-history.v1','subrecipeId',v_subrecipe_id,
    'syncVersion',v_sync_version::text,'rows',v_rows,'containsPii',false,'externalExecution',false
  );
end;
$$;
revoke all on function public.listar_fichas_integrales_elaboracion(text)
  from public,anon,service_role;
grant execute on function public.listar_fichas_integrales_elaboracion(text) to authenticated;

create or replace function public.momos_core_snapshot_v2()
returns jsonb
language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp
as $$
declare v_base jsonb; v_sync_version bigint:=0;
begin
  v_base:=public.momos_core_snapshot_v1();
  select version into v_sync_version from public.kitchen_procedure_sync_state where id=1;
  return jsonb_set(v_base,'{version}','2'::jsonb,true)||jsonb_build_object(
    'kitchen_procedure_sync_version',coalesce(v_sync_version,0)::text,
    'kitchen_procedures',coalesce((select jsonb_agg(to_jsonb(x) order by x.subrecipe_id)
      from (select subrecipe_id,version,process_defined,note,steps,source_ref,
        fingerprint,formula_fingerprint,approved_at
        from public.kitchen_procedure_versions where status='Vigente' order by subrecipe_id) x
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.momos_core_snapshot_v2() from public,anon,service_role;
grant execute on function public.momos_core_snapshot_v2() to authenticated;

-- La fórmula solo se publica por la RPC gobernada; ni siquiera Administración
-- puede cambiarla por accidente desde el cliente o el editor de tablas.
revoke insert,update,delete on table public.subreceta_ingredientes from authenticated;

create or replace function public.formulas_elaboraciones_internas_disponibles()
returns boolean
language sql stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select public.current_user_has_any_role(array['Administrador','Cocina']::text[])
    and exists(select 1 from public.momos_ops_migrations where id='20260720_87_formulas_elaboraciones')
    and exists(select 1 from pg_attribute where attrelid='public.kitchen_procedure_versions'::regclass
      and attname='formula' and not attisdropped)
    and to_regprocedure('public.listar_fichas_integrales_elaboracion(text)') is not null
$$;
revoke all on function public.formulas_elaboraciones_internas_disponibles()
  from public,anon,service_role;
grant execute on function public.formulas_elaboraciones_internas_disponibles() to authenticated;

-- Mantiene el manifiesto único y agrega la capacidad H87 sin otra sonda HTTP.
create or replace function public.momos_sync_manifest_v1() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_capabilities jsonb; v_schema_version text; v_inventory_event_id bigint:=0;
  v_finance_version bigint:=0; v_configuration_version bigint:=0;
  v_dashboard_version bigint:=0; v_delivery_version bigint:=0;
begin
  if auth.uid() is null or not exists(select 1 from public.users u where u.auth_id=auth.uid() and u.activo)
  then raise exception 'Sesión MOMOS inválida.' using errcode='42501'; end if;
  select coalesce(jsonb_object_agg(x.name,to_regprocedure(format('public.%I()',x.name)) is not null),'{}'::jsonb)
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
    'desecho_producto_terminado_disponible','fichas_tecnicas_cocina_disponibles','gestion_fichas_tecnicas_cocina_disponible',
    'formulas_elaboraciones_internas_disponibles'
  ]::text[]) x(name);
  select id into v_schema_version from public.momos_ops_migrations order by applied_at desc,id desc limit 1;
  select version into v_finance_version from public.finance_sync_state where id=1;
  select version into v_configuration_version from public.configuration_sync_state where id=1;
  select version into v_dashboard_version from public.dashboard_sync_state where id=1;
  select version into v_delivery_version from public.delivery_sync_state where id=1;
  v_inventory_event_id:=4611686018427387904+((pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot()))::text)::bigint;
  return jsonb_build_object(
    'version',1,'schema_version',coalesce(v_schema_version,''),'server_time',clock_timestamp(),
    'capabilities',v_capabilities,'inventory_latest_event_id',v_inventory_event_id::text,
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
revoke all on function public.momos_sync_manifest_v1() from public,anon,service_role;
grant execute on function public.momos_sync_manifest_v1() to authenticated;

insert into public.momos_ops_migrations(id,detalle)
values('20260720_87_formulas_elaboraciones',
  'Fórmula y procedimiento versionados juntos; edición desde Inventario y publicación administrativa atómica')
on conflict(id) do update set detalle=excluded.detalle;

commit;
