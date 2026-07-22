-- MOMOS OPS · prueba adversarial H85. Siempre rollback.
begin;
set local statement_timeout='120s';

do $$
declare v_admin_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260720_85_fichas_tecnicas_cocina'),
    'falta H85';
  assert to_regclass('public.kitchen_procedure_versions') is not null
    and to_regprocedure('public.guardar_ficha_tecnica_cocina(jsonb)') is not null
    and to_regprocedure('public.activar_ficha_tecnica_cocina(bigint,text)') is not null
    and to_regprocedure('public.momos_core_snapshot_v2()') is not null
    and to_regprocedure('public.fichas_tecnicas_cocina_disponibles()') is not null,
    'faltan tabla o RPC de fichas técnicas';
  assert has_function_privilege('authenticated','public.guardar_ficha_tecnica_cocina(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.activar_ficha_tecnica_cocina(bigint,text)','EXECUTE')
    and has_function_privilege('authenticated','public.momos_core_snapshot_v2()','EXECUTE')
    and not has_function_privilege('anon','public.momos_core_snapshot_v2()','EXECUTE')
    and not has_function_privilege('service_role','public.momos_core_snapshot_v2()','EXECUTE')
    and not has_function_privilege('service_role','public.activar_ficha_tecnica_cocina(bigint,text)','EXECUTE'),
    'RBAC de RPC H85 incorrecto';
  assert has_table_privilege('authenticated','public.kitchen_procedure_versions','SELECT')
    and not has_table_privilege('authenticated','public.kitchen_procedure_versions','INSERT')
    and not has_table_privilege('authenticated','public.kitchen_procedure_versions','UPDATE')
    and not has_table_privilege('authenticated','public.kitchen_procedure_versions','DELETE')
    and not has_table_privilege('service_role','public.kitchen_procedure_versions','SELECT'),
    'las versiones quedaron escribibles o expuestas';
  assert not has_function_privilege('authenticated','public._validar_pasos_ficha_tecnica(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public._proteger_ficha_tecnica_vigente()','EXECUTE'),
    'H85 expuso helpers internos';
  assert position('fichas_tecnicas_cocina_disponibles' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,'el manifiesto no anuncia H85';
  assert (select count(*) from public.kitchen_procedure_versions where status='Vigente')
      =(select count(*) from public.subrecetas where activo),
    'el seed no cubre cada subreceta activa';
  assert not exists(
    select 1 from public.kitchen_procedure_versions
    where status='Vigente' and process_defined and jsonb_array_length(steps)=0
  ),'una ficha oficial quedó sin pasos';
  assert exists(
    select 1 from public.kitchen_procedure_versions k
    join public.subrecetas s on s.id=k.subrecipe_id
    where s.tipo like 'mousse_%' and k.status='Vigente'
      and not k.process_defined and lower(k.note) like '%falta%'
  ),'las mousses inventaron un procedimiento completo';
  select u.auth_id into v_admin_auth from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  assert v_admin_auth is not null,'falta Administrador autenticado para H85';
  perform set_config('momos.h85_admin_auth',v_admin_auth::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h85_admin_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_response jsonb;
  v_activation jsonb;
  v_snapshot jsonb;
  v_id bigint;
  v_version integer;
  v_failed boolean:=false;
  v_before integer;
begin
  assert public.fichas_tecnicas_cocina_disponibles(),
    'H85 no quedó disponible para Administrador';
  select count(*) into v_before from public.kitchen_procedure_versions
  where subrecipe_id='SR13';

  begin
    insert into public.kitchen_procedure_versions(
      subrecipe_id,version,status,process_defined,note,steps,source_ref,
      fingerprint
    ) values(
      'SR13',999,'Borrador',true,'Bypass',
      '[{"title":"Paso","detail":"No debe entrar"}]'::jsonb,
      'Prueba',repeat('a',64)
    );
  exception when others then v_failed:=true; end;
  assert v_failed,'authenticated pudo insertar una ficha directamente';
  v_failed:=false;

  begin
    perform public.guardar_ficha_tecnica_cocina(jsonb_build_object(
      'subrecipe_id','SR13','process_defined',true,'note','Contrato abierto',
      'steps',jsonb_build_array(jsonb_build_object('title','Uno','detail','Dos')),
      'actor','no permitido'
    ));
  exception when others then v_failed:=true; end;
  assert v_failed and (select count(*) from public.kitchen_procedure_versions where subrecipe_id='SR13')=v_before,
    'la RPC aceptó claves abiertas o dejó efectos parciales';
  v_failed:=false;

  begin
    perform public.guardar_ficha_tecnica_cocina(jsonb_build_object(
      'subrecipe_id','SR13','process_defined',true,'note','Sin pasos',
      'steps','[]'::jsonb
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H85 permitió declarar un proceso oficial vacío';
  v_failed:=false;

  v_response:=public.guardar_ficha_tecnica_cocina(jsonb_build_object(
    'subrecipe_id','SR13','process_defined',true,
    'note','Versión adversarial aprobable.',
    'steps',jsonb_build_array(
      jsonb_build_object('title','Paso de prueba','detail','Secuencia exacta para validar H85.')
    ),
    'source_ref','Prueba H85'
  ));
  v_id:=(v_response->>'id')::bigint;
  v_version:=(v_response->>'version')::integer;
  assert v_response->>'contract'='momos.kitchen-procedure-draft.v1'
    and v_response->>'status'='Borrador'
    and v_response->>'created_by' is null
    and v_response->>'approved_by' is null,
    'el borrador no respetó el contrato o expuso actores';
  assert (select count(*)=1 from public.kitchen_procedure_versions
      where id=v_id and status='Borrador' and fingerprint=v_response->>'fingerprint'),
    'el borrador no quedó sellado';

  begin
    perform public.activar_ficha_tecnica_cocina(v_id,'confirmar');
  exception when others then v_failed:=true; end;
  assert v_failed and (select status='Borrador' from public.kitchen_procedure_versions where id=v_id),
    'la activación omitió la confirmación humana';

  v_activation:=public.activar_ficha_tecnica_cocina(v_id,'ACTIVAR FICHA');
  assert v_activation->>'contract'='momos.kitchen-procedure-activation.v1'
    and v_activation->>'status'='Vigente'
    and (select count(*)=1 from public.kitchen_procedure_versions
      where subrecipe_id='SR13' and status='Vigente')
    and (select status='Vigente' and approved_at is not null
      from public.kitchen_procedure_versions where id=v_id),
    'H85 no dejó exactamente una ficha vigente aprobada';
  assert exists(select 1 from public.kitchen_procedure_versions
      where subrecipe_id='SR13' and version<v_version and status='Archivado'),
    'H85 no conservó la versión anterior como historial';

  v_snapshot:=public.momos_core_snapshot_v2();
  assert (v_snapshot->>'version')::integer=2
    and jsonb_typeof(v_snapshot->'kitchen_procedures')='array'
    and exists(
      select 1 from jsonb_array_elements(v_snapshot->'kitchen_procedures') row
      where row->>'subrecipe_id'='SR13'
        and (row->>'version')::integer=v_version
        and row->>'created_by' is null
        and row->>'approved_by' is null
    ),'el snapshot v2 no entregó la ficha exacta o expuso actores';
  assert not exists(
    select 1 from jsonb_array_elements(v_snapshot->'kitchen_procedures') row
    where row ?| array['created_by','approved_by','created_at']
  ),'el snapshot compacto expuso metadatos de actor';

  v_failed:=false;
  begin
    update public.kitchen_procedure_versions set note='Mutación directa' where id=v_id;
  exception when others then v_failed:=true; end;
  assert v_failed and (select note='Versión adversarial aprobable.'
      from public.kitchen_procedure_versions where id=v_id),
    'authenticated pudo alterar una versión vigente';

  v_failed:=false;
  begin perform public.activar_ficha_tecnica_cocina(v_id,'ACTIVAR FICHA');
  exception when others then v_failed:=true; end;
  assert v_failed,'H85 permitió reactivar la misma versión';
end $$;

reset role;
select 'TESTS_OK — fichas técnicas/versiones/proceso parcial/snapshot/RBAC PASS, rollback total' as resultado;
rollback;
