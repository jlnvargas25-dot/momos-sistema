-- MOMOS OPS · H85 · fichas técnicas versionadas de Cocina.
-- Las cantidades continúan viviendo en la BOM de subrecetas. Este hito
-- gobierna únicamente el procedimiento: una versión vigente por preparación,
-- historial inmutable y publicación humana explícita. Cuando RECETAS.md no
-- define temperatura o tiempo, la ficha lo declara y jamás inventa el dato.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('momos_ops_migraciones_20260720'));

do $$
begin
  if to_regclass('public.momos_ops_migrations') is null or not exists(
    select 1 from public.momos_ops_migrations
    where id='20260720_84_desecho_producto_terminado'
  ) then
    raise exception 'Falta el paso 84_desecho_producto_terminado.';
  end if;
  if to_regclass('public.subrecetas') is null
     or to_regprocedure('public.momos_core_snapshot_v1()') is null
     or to_regprocedure('public.current_user_has_any_role(text[])') is null then
    raise exception 'Faltan Subrecetas, Data Sync o roles múltiples.';
  end if;
end $$;

create or replace function public._validar_pasos_ficha_tecnica(p_steps jsonb)
returns boolean
language sql
immutable
set search_path=pg_catalog,public,pg_temp
as $$
  select jsonb_typeof(p_steps)='array'
    and jsonb_array_length(p_steps)<=20
    and not exists(
      select 1
      from jsonb_array_elements(p_steps) step
      where jsonb_typeof(step)<>'object'
        or nullif(btrim(coalesce(step->>'title','')),'') is null
        or length(btrim(step->>'title'))>120
        or nullif(btrim(coalesce(step->>'detail','')),'') is null
        or length(btrim(step->>'detail'))>700
        or exists(
          select 1 from jsonb_object_keys(step) key
          where key not in ('title','detail')
        )
    )
$$;
revoke all on function public._validar_pasos_ficha_tecnica(jsonb)
  from public,anon,authenticated,service_role;

create table if not exists public.kitchen_procedure_versions(
  id bigint generated always as identity primary key,
  subrecipe_id text not null references public.subrecetas(id),
  version integer not null check(version>0),
  status text not null check(status in ('Borrador','Vigente','Archivado')),
  process_defined boolean not null,
  note text not null check(length(btrim(note)) between 1 and 1000),
  steps jsonb not null,
  source_ref text not null default 'RECETAS.md'
    check(length(btrim(source_ref)) between 1 and 200),
  fingerprint text not null check(fingerprint~'^[0-9a-f]{64}$'),
  created_by uuid references public.users(auth_id),
  approved_by uuid references public.users(auth_id),
  created_at timestamptz not null default clock_timestamp(),
  approved_at timestamptz,
  unique(subrecipe_id,version),
  constraint kitchen_procedure_steps_valid check(
    public._validar_pasos_ficha_tecnica(steps)
    and (not process_defined or jsonb_array_length(steps)>0)
  ),
  constraint kitchen_procedure_approval_consistent check(
    (status='Vigente' and approved_at is not null)
    or (status<>'Vigente')
  )
);
create unique index if not exists kitchen_procedure_one_current_uq
  on public.kitchen_procedure_versions(subrecipe_id)
  where status='Vigente';
create index if not exists kitchen_procedure_history_idx
  on public.kitchen_procedure_versions(subrecipe_id,version desc);
comment on table public.kitchen_procedure_versions is
  'Versiones gobernadas del procedimiento de Cocina. La BOM y el rendimiento permanecen en subrecetas.';

alter table public.kitchen_procedure_versions enable row level security;
drop policy if exists kitchen_procedure_staff_read
  on public.kitchen_procedure_versions;
create policy kitchen_procedure_staff_read
  on public.kitchen_procedure_versions for select to authenticated
  using(public.is_staff());
revoke all on table public.kitchen_procedure_versions
  from public,anon,authenticated,service_role;
grant select on table public.kitchen_procedure_versions to authenticated;
revoke all on sequence public.kitchen_procedure_versions_id_seq
  from public,anon,authenticated,service_role;

create or replace function public._proteger_ficha_tecnica_vigente()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    raise exception 'Las fichas técnicas no se eliminan; se conserva su historial.';
  end if;
  if current_setting('momos.activar_ficha_tecnica',true)<>'1' then
    raise exception 'Las fichas técnicas solo cambian mediante su RPC gobernada.';
  end if;
  if old.subrecipe_id<>new.subrecipe_id
     or old.version<>new.version
     or old.process_defined<>new.process_defined
     or old.note<>new.note
     or old.steps<>new.steps
     or old.source_ref<>new.source_ref
     or old.fingerprint<>new.fingerprint
     or old.created_by is distinct from new.created_by
     or old.created_at<>new.created_at then
    raise exception 'El contenido de una versión es inmutable; creá una nueva versión.';
  end if;
  return new;
end;
$$;
revoke all on function public._proteger_ficha_tecnica_vigente()
  from public,anon,authenticated,service_role;
drop trigger if exists kitchen_procedure_versions_immutable
  on public.kitchen_procedure_versions;
create trigger kitchen_procedure_versions_immutable
before update or delete on public.kitchen_procedure_versions
for each row execute function public._proteger_ficha_tecnica_vigente();

-- Seed canónico desde RECETAS.md. Las mousses conservan una guía segura pero
-- process_defined=false porque el documento aún no fija tiempos/temperaturas.
with source_rows as (
  select sr.id as subrecipe_id,
    case
      when sr.tipo='mousse_frutal' then false
      when sr.tipo='mousse_cremosa' then false
      when sr.tipo in ('cheesecake','ganache') then true
      when sr.tipo='salsa' and lower(sr.nombre) like '%maracuy%' then true
      when sr.tipo='salsa' and lower(sr.nombre) like '%frutos rojos%' then true
      else false
    end as process_defined,
    case
      when sr.tipo='mousse_frutal' then
        'Fórmula oficial. Falta estandarizar tiempos y temperaturas del proceso frutal; no improvisarlos.'
      when sr.tipo='mousse_cremosa' then
        'Fórmula oficial. La crema se usa líquida, no montada; faltan tiempos y temperaturas estandarizados.'
      when sr.tipo in ('cheesecake','ganache') then
        'Procedimiento oficial documentado en RECETAS.md.'
      when sr.tipo='salsa' and lower(sr.nombre) like '%maracuy%' then
        'Procedimiento oficial; el punto final se valida por textura, sin inventar tiempo ni temperatura.'
      when sr.tipo='salsa' and lower(sr.nombre) like '%frutos rojos%' then
        'Procedimiento oficial; conservar textura de fruta, sin inventar tiempo ni temperatura.'
      when sr.tipo='crocante' then
        'La fórmula oficial define una base sin horno, pero no fija un procedimiento completo.'
      else
        'La fórmula y cantidades son oficiales; el procedimiento fino todavía no está estandarizado.'
    end as note,
    case
      when sr.tipo='mousse_frutal' then jsonb_build_array(
        jsonb_build_object('title','Preparar la base frutal','detail','Procesá la fruta o pulpa con los líquidos y secos pesados hasta obtener una mezcla uniforme.'),
        jsonb_build_object('title','Incorporar la estabilización','detail','Hidratá la grenetina con el agua asignada en la fórmula e incorporala de manera uniforme.'),
        jsonb_build_object('title','Integrar la crema','detail','Agregá la crema de leche y homogeneizá sin alterar las cantidades pesadas.')
      )
      when sr.tipo='mousse_cremosa' then jsonb_build_array(
        jsonb_build_object('title','Preparar la fase cremosa','detail','Usá la crema líquida, no montada, y reuní los líquidos y secos de la fórmula.'),
        jsonb_build_object('title','Incorporar la estabilización','detail','Hidratá la grenetina con el agua asignada e incorporala de manera uniforme.'),
        jsonb_build_object('title','Emulsionar','detail','Emulsioná la preparación hasta que quede homogénea.')
      ) || case when lower(sr.nombre) like '%m&m%' then jsonb_build_array(
        jsonb_build_object('title','Agregar M&M al final','detail','Incorporá los M&M al final y no los licúes para evitar que suelten color.')
      ) else '[]'::jsonb end
      when sr.tipo='cheesecake' then jsonb_build_array(
        jsonb_build_object('title','Hidratar la grenetina','detail','Hidratá la grenetina con el agua pesada para esta tanda.'),
        jsonb_build_object('title','Preparar la mezcla base','detail','Mezclá queso crema con leche condensada, limón, vainilla y sal.'),
        jsonb_build_object('title','Agregar la crema','detail','Incorporá la crema de leche hasta homogeneizar.'),
        jsonb_build_object('title','Estabilizar','detail','Derretí la grenetina hidratada e incorporala en hilo a la mezcla.'),
        jsonb_build_object('title','Conservar o dosificar','detail','Refrigerá la elaboración o usala inmediatamente como relleno.')
      )
      when sr.tipo='ganache' then jsonb_build_array(
        jsonb_build_object('title','Calentar la crema','detail','Calentá la crema sin dejar que hierva fuertemente.'),
        jsonb_build_object('title','Verter sobre el chocolate','detail','Verté la crema caliente sobre el chocolate pesado y dejá reposar 1 minuto.'),
        jsonb_build_object('title','Emulsionar','detail','Mezclá hasta obtener una emulsión uniforme.'),
        jsonb_build_object('title','Terminar la ganache','detail','Incorporá la mantequilla y la sal pesadas para la tanda.')
      )
      when sr.tipo='salsa' and lower(sr.nombre) like '%maracuy%' then jsonb_build_array(
        jsonb_build_object('title','Reunir la fórmula','detail','Combiná la pulpa, azúcar, agua, limón y sal ya pesados.'),
        jsonb_build_object('title','Cocinar','detail','Cociná hasta que espese ligeramente; debe seguir siendo salsa y no caramelo.')
      )
      when sr.tipo='salsa' and lower(sr.nombre) like '%frutos rojos%' then jsonb_build_array(
        jsonb_build_object('title','Reunir la fórmula','detail','Combiná la fruta, azúcar, agua, limón y sal ya pesados.'),
        jsonb_build_object('title','Cocinar','detail','Cociná la mezcla y triturá solo un poco, conservando textura de fruta.')
      )
      when sr.tipo='crocante' then jsonb_build_array(
        jsonb_build_object('title','Preparar la galleta','detail','Triturá y pesá la galleta elegida. Si usás Saltín, omití la sal extra.'),
        jsonb_build_object('title','Integrar','detail','Agregá la mantequilla derretida y los demás ingredientes pesados.'),
        jsonb_build_object('title','Uniformar','detail','Mezclá hasta lograr una textura húmeda y uniforme lista para compactar.')
      )
      else '[]'::jsonb
    end as steps
  from public.subrecetas sr
  where sr.activo
), versioned as (
  select s.*,
    jsonb_build_object(
      'subrecipe_id',s.subrecipe_id,'version',1,
      'process_defined',s.process_defined,'note',s.note,
      'steps',s.steps,'source_ref','RECETAS.md'
    ) as signed_payload
  from source_rows s
)
insert into public.kitchen_procedure_versions(
  subrecipe_id,version,status,process_defined,note,steps,source_ref,
  fingerprint,approved_at
)
select subrecipe_id,1,'Vigente',process_defined,note,steps,'RECETAS.md',
  encode(sha256(convert_to(signed_payload::text,'UTF8')),'hex'),clock_timestamp()
from versioned
on conflict(subrecipe_id,version) do nothing;

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
  v_source_ref:=coalesce(nullif(btrim(coalesce(p->>'source_ref','')),''),'RECETAS.md');
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
  return jsonb_build_object(
    'contract','momos.kitchen-procedure-draft.v1','id',v_id,
    'subrecipe_id',v_subrecipe_id,'version',v_version,'status','Borrador',
    'fingerprint',v_fingerprint,'external_execution',false
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
declare v_row public.kitchen_procedure_versions%rowtype;
begin
  if public.is_admin() is not true then
    raise exception 'Solo Administrador puede activar una ficha técnica.';
  end if;
  if btrim(coalesce(p_confirmacion,''))<>'ACTIVAR FICHA' then
    raise exception 'Escribí ACTIVAR FICHA para confirmar la publicación.';
  end if;
  select * into v_row from public.kitchen_procedure_versions
  where id=p_id for update;
  if v_row.id is null then raise exception 'La ficha no existe.'; end if;
  if v_row.status<>'Borrador' then raise exception 'Solo un borrador puede activarse.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('momos-ficha-tecnica:'||v_row.subrecipe_id,0));
  perform set_config('momos.activar_ficha_tecnica','1',true);
  update public.kitchen_procedure_versions
  set status='Archivado'
  where subrecipe_id=v_row.subrecipe_id and status='Vigente';
  update public.kitchen_procedure_versions
  set status='Vigente',approved_by=auth.uid(),approved_at=clock_timestamp()
  where id=p_id;
  return jsonb_build_object(
    'contract','momos.kitchen-procedure-activation.v1','id',p_id,
    'subrecipe_id',v_row.subrecipe_id,'version',v_row.version,
    'status','Vigente','fingerprint',v_row.fingerprint,
    'external_execution',false
  );
end;
$$;
revoke all on function public.activar_ficha_tecnica_cocina(bigint,text)
  from public,anon,service_role;
grant execute on function public.activar_ficha_tecnica_cocina(bigint,text)
  to authenticated;

-- V2 reutiliza el snapshot MVCC H56/H70 y agrega únicamente las fichas
-- vigentes. No crea fan-out ni duplica lecturas de catálogos.
create or replace function public.momos_core_snapshot_v2()
returns jsonb
language plpgsql
stable
security invoker
set search_path=pg_catalog,public,pg_temp
as $$
declare v_base jsonb;
begin
  v_base:=public.momos_core_snapshot_v1();
  return jsonb_set(v_base,'{version}','2'::jsonb,true)
    || jsonb_build_object(
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

create or replace function public.fichas_tecnicas_cocina_disponibles()
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select public.current_user_has_any_role(array['Administrador','Cocina']::text[])
    and exists(
      select 1 from public.momos_ops_migrations
      where id='20260720_85_fichas_tecnicas_cocina'
    )
    and to_regprocedure('public.momos_core_snapshot_v2()') is not null
$$;
revoke all on function public.fichas_tecnicas_cocina_disponibles()
  from public,anon,service_role;
grant execute on function public.fichas_tecnicas_cocina_disponibles()
  to authenticated;

-- Conserva el manifiesto de H84 y suma la nueva capacidad sin cambiar los TTL.
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
    'desecho_producto_terminado_disponible','fichas_tecnicas_cocina_disponibles'
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
  '20260720_85_fichas_tecnicas_cocina',
  'Fichas técnicas versionadas, guía segura sin parámetros inventados y snapshot compacto de Cocina'
)
on conflict(id) do update set detalle=excluded.detalle;

commit;
