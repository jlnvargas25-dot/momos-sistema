-- MOMOS OPS · prueba adversarial H86. Siempre rollback.
begin;
set local statement_timeout='120s';

do $$
declare v_admin_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260720_86_gestion_fichas_tecnicas'),
    'falta H86';
  assert to_regclass('public.kitchen_procedure_sync_state') is not null
    and to_regprocedure('public.listar_fichas_tecnicas_cocina(text)') is not null
    and to_regprocedure('public.archivar_borrador_ficha_tecnica(bigint,text)') is not null
    and to_regprocedure('public.gestion_fichas_tecnicas_cocina_disponible()') is not null,
    'faltan outbox o RPC de gestión de fichas';
  assert (
    select array_agg(a.attname::text order by a.attnum)
    from pg_attribute a
    where a.attrelid='public.kitchen_procedure_sync_state'::regclass
      and a.attnum>0 and not a.attisdropped
  )=array['id','version','changed_at']::text[],
    'el outbox compacto expuso columnas adicionales';
  assert has_table_privilege('authenticated','public.kitchen_procedure_sync_state','SELECT')
    and not has_table_privilege('authenticated','public.kitchen_procedure_sync_state','INSERT')
    and not has_table_privilege('authenticated','public.kitchen_procedure_sync_state','UPDATE')
    and not has_table_privilege('authenticated','public.kitchen_procedure_sync_state','DELETE')
    and not has_table_privilege('anon','public.kitchen_procedure_sync_state','SELECT')
    and not has_table_privilege('service_role','public.kitchen_procedure_sync_state','SELECT'),
    'el outbox quedó escribible o expuesto';
  assert has_function_privilege('authenticated','public.listar_fichas_tecnicas_cocina(text)','EXECUTE')
    and has_function_privilege('authenticated','public.archivar_borrador_ficha_tecnica(bigint,text)','EXECUTE')
    and has_function_privilege('authenticated','public.gestion_fichas_tecnicas_cocina_disponible()','EXECUTE')
    and not has_function_privilege('anon','public.listar_fichas_tecnicas_cocina(text)','EXECUTE')
    and not has_function_privilege('service_role','public.archivar_borrador_ficha_tecnica(bigint,text)','EXECUTE')
    and not has_function_privilege('authenticated','public._touch_kitchen_procedure_sync_state()','EXECUTE'),
    'RBAC de RPC o helper H86 incorrecto';
  assert exists(
    select 1 from pg_trigger
    where tgrelid='public.kitchen_procedure_versions'::regclass
      and tgname='kitchen_procedure_versions_touch_sync' and not tgisinternal
  ),'las versiones no despiertan el outbox';
  assert position('gestion_fichas_tecnicas_cocina_disponible' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,'el manifiesto único no anuncia H86';
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    assert exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='kitchen_procedure_sync_state'
    ),'el outbox no está publicado en Realtime';
  end if;
  select u.auth_id into v_admin_auth from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  assert v_admin_auth is not null,'falta Administrador autenticado para H86';
  perform set_config('momos.h86_admin_auth',v_admin_auth::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h86_admin_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_before bigint;
  v_after_draft bigint;
  v_after_publish bigint;
  v_after_archive bigint;
  v_draft jsonb;
  v_second jsonb;
  v_history jsonb;
  v_snapshot jsonb;
  v_id bigint;
  v_second_id bigint;
  v_failed boolean:=false;
begin
  assert public.gestion_fichas_tecnicas_cocina_disponible(),
    'H86 no quedó disponible para Administrador';
  select version into v_before from public.kitchen_procedure_sync_state where id=1;

  v_draft:=public.guardar_ficha_tecnica_cocina(jsonb_build_object(
    'subrecipe_id','SR13','process_defined',true,
    'note','Procedimiento adversarial listo para revisión.',
    'steps',jsonb_build_array(
      jsonb_build_object('title','Pesar','detail','Pesar exactamente la fórmula vigente.'),
      jsonb_build_object('title','Integrar','detail','Integrar hasta lograr una mezcla uniforme.')
    ),
    'source_ref','Validación interna H86'
  ));
  v_id:=(v_draft->>'id')::bigint;
  select version into v_after_draft from public.kitchen_procedure_sync_state where id=1;
  assert v_after_draft>v_before
    and (v_draft->>'sync_version')::bigint=v_after_draft,
    'crear borrador no devolvió el cursor del mismo commit';

  v_history:=public.listar_fichas_tecnicas_cocina('SR13');
  assert v_history->>'contract'='momos.kitchen-procedure-history.v1'
    and v_history->>'subrecipeId'='SR13'
    and (v_history->>'syncVersion')::bigint=v_after_draft
    and jsonb_array_length(v_history->'rows') between 2 and 50,
    'el historial no devolvió el contrato compacto esperado';
  assert not exists(
    select 1 from jsonb_array_elements(v_history->'rows') row
    where row ?| array['createdBy','approvedBy','created_by','approved_by','email','actor','userId']
  ),'el historial expuso identidad o PII';
  assert not exists(
    select 1 from jsonb_array_elements(v_history->'rows') row
    where (select array_agg(k order by k) from jsonb_object_keys(row) k)
      <>array['approvedAt','createdAt','fingerprint','id','note','processDefined','sourceRef','status','steps','subrecipeId','version']::text[]
  ),'el historial expuso un detalle fuera del contrato cerrado';

  begin perform public.activar_ficha_tecnica_cocina(v_id,'PUBLICAR');
  exception when others then v_failed:=true; end;
  assert v_failed and (select status='Borrador' from public.kitchen_procedure_versions where id=v_id),
    'la publicación omitió la confirmación humana';
  v_failed:=false;

  perform public.activar_ficha_tecnica_cocina(v_id,'ACTIVAR FICHA');
  select version into v_after_publish from public.kitchen_procedure_sync_state where id=1;
  assert v_after_publish>v_after_draft
    and (select count(*)=1 from public.kitchen_procedure_versions
      where subrecipe_id='SR13' and status='Vigente')
    and (select status='Vigente' from public.kitchen_procedure_versions where id=v_id),
    'la publicación no fue atómica o no despertó el outbox';

  v_snapshot:=public.momos_core_snapshot_v2();
  assert (v_snapshot->>'kitchen_procedure_sync_version')::bigint=v_after_publish
    and exists(
      select 1 from jsonb_array_elements(v_snapshot->'kitchen_procedures') row
      where row->>'subrecipe_id'='SR13' and (row->>'version')::int=(v_draft->>'version')::int
    ),'el snapshot no selló ficha vigente y cursor de la misma lectura';

  v_second:=public.guardar_ficha_tecnica_cocina(jsonb_build_object(
    'subrecipe_id','SR13','process_defined',false,
    'note','Segundo borrador que debe conservarse archivado.',
    'steps',jsonb_build_array(
      jsonb_build_object('title','Revisar','detail','Pendiente de estandarización humana.')
    ),'source_ref','Validación H86'
  ));
  v_second_id:=(v_second->>'id')::bigint;
  begin perform public.archivar_borrador_ficha_tecnica(v_second_id,'ARCHIVAR');
  exception when others then v_failed:=true; end;
  assert v_failed and (select status='Borrador' from public.kitchen_procedure_versions where id=v_second_id),
    'el archivo omitió la confirmación humana';
  perform public.archivar_borrador_ficha_tecnica(v_second_id,'ARCHIVAR BORRADOR');
  select version into v_after_archive from public.kitchen_procedure_sync_state where id=1;
  assert v_after_archive>(v_second->>'sync_version')::bigint
    and (select status='Archivado' from public.kitchen_procedure_versions where id=v_second_id)
    and (select status='Vigente' from public.kitchen_procedure_versions where id=v_id),
    'archivar un borrador alteró la vigente o no emitió versión';

  v_failed:=false;
  begin update public.kitchen_procedure_sync_state set version=version+1 where id=1;
  exception when others then v_failed:=true; end;
  assert v_failed,'authenticated pudo falsificar el cursor Realtime';
end $$;

reset role;
select 'TESTS_OK — gestión fichas/borrador/aprobación/historial/outbox/RBAC PASS, rollback total' as resultado;
rollback;
