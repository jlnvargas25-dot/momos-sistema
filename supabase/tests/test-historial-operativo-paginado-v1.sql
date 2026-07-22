-- MOMOS OPS · prueba adversarial H79. Siempre ROLLBACK.
begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_historial_operativo_20260719'));

do $$
declare v_staff_auth uuid; v_staff_id text;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260719_79_historial_operativo_paginado'),
    'Falta aplicar H79.';
  assert to_regprocedure('public.momos_history_page_v2(jsonb,integer,text,text,date,date)') is not null
    and to_regprocedure('public.historial_operativo_paginado_disponible()') is not null,
    'Falta una pieza del contrato H79.';
  assert has_function_privilege('authenticated','public.momos_history_page_v2(jsonb,integer,text,text,date,date)','EXECUTE')
    and has_function_privilege('authenticated','public.historial_operativo_paginado_disponible()','EXECUTE')
    and not has_function_privilege('anon','public.momos_history_page_v2(jsonb,integer,text,text,date,date)','EXECUTE')
    and not has_function_privilege('service_role','public.momos_history_page_v2(jsonb,integer,text,text,date,date)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_history_area_v2(text)','EXECUTE'),
    'H79 abrió la frontera RBAC de sus funciones.';
  assert exists(select 1 from pg_indexes where schemaname='public' and indexname='audit_logs_history_recent_idx')
    and exists(select 1 from pg_indexes where schemaname='public' and indexname='audit_logs_history_area_recent_idx'),
    'H79 no instaló los índices del cursor y área.';
  assert (select p.provolatile from pg_proc p where p.oid='public.momos_history_page_v2(jsonb,integer,text,text,date,date)'::regprocedure)='s'
    and position('search_path=pg_catalog,public,pg_temp' in replace(array_to_string(
      (select p.proconfig from pg_proc p where p.oid='public.momos_history_page_v2(jsonb,integer,text,text,date,date)'::regprocedure),','),' ',''))>0,
    'La RPC H79 perdió estabilidad o search_path cerrado.';
  assert public._momos_history_area_v2('Brief agencia')='Agencia MOMOS'
    and public._momos_history_area_v2('Identidad de marca')='Agencia MOMOS'
    and public._momos_history_area_v2('Movimiento financiero')='Finanzas'
    and public._momos_history_area_v2('Producto terminado')='Inventario terminado',
    'H79 dejó áreas operativas sin clasificación navegable.';

  select u.auth_id,u.id into v_staff_auth,v_staff_id from public.users u
  where u.activo and u.auth_id is not null order by u.id limit 1;
  assert v_staff_auth is not null and v_staff_id is not null,
    'Falta un usuario activo enlazado a Auth para H79.';
  perform set_config('momos.h79_staff_auth',v_staff_auth::text,true);

  insert into public.audit_logs(id,fecha,user_id,entidad,entidad_id,accion,de,a) values
    ('H79-AUD-001','2026-07-19 13:00:00+00',v_staff_id,'Pedido','H79-ORDER-001','Pago confirmado','Pendiente','Pagado'),
    ('H79-AUD-002','2026-07-19 12:00:00+00',v_staff_id,'Lote','H79-BATCH-001','Congelación iniciada','En preparación','Congelando'),
    ('H79-CURSOR-003','2026-07-18 13:00:00+00',v_staff_id,'Inventario','H79-CURSOR','Movimiento 3','',''),
    ('H79-CURSOR-002','2026-07-18 12:00:00+00',v_staff_id,'Inventario','H79-CURSOR','Movimiento 2','',''),
    ('H79-CURSOR-001','2026-07-18 11:00:00+00',v_staff_id,'Inventario','H79-CURSOR','Movimiento 1','','');
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h79_staff_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_page jsonb; v_second jsonb; v_row jsonb; v_failed boolean:=false;
begin
  assert public.historial_operativo_paginado_disponible(),
    'La capability H79 no quedó disponible para staff activo.';

  v_page:=public.momos_history_page_v2(null,50,'H79-ORDER-001','Pedidos','2026-07-19','2026-07-19');
  assert v_page->>'contract'='momos.history-page.v2'
    and (v_page->>'version')::integer=2
    and (v_page->>'filtered')::boolean
    and jsonb_array_length(v_page->'rows')=1,
    'H79 no aplicó búsqueda, área y fecha en servidor.';
  v_row:=v_page#>'{rows,0}';
  assert v_row->>'id'='H79-AUD-001' and v_row->>'area'='Pedidos',
    'H79 devolvió una fila ajena al filtro.';
  assert (select array_agg(k order by k) from jsonb_object_keys(v_row) keys(k))=
    array['a','accion','area','de','entidad','entidad_id','fecha','id','user'],
    'Una fila H79 salió del contrato cerrado.';
  assert (v_page->'privacy')=jsonb_build_object(
      'contains_customer_pii',false,'contains_staff_identity',false,'contains_storage_references',false,
      'contains_secrets',false,'contains_free_text',true,'external_execution',false),
    'H79 no declaró correctamente privacidad y texto libre.';
  assert (v_page-'rows')::text !~* 'auth[_-]?id|telefono|direccion|storage[_-]?path|signed[_-]?url|access[_-]?token|service[_-]?role',
    'El sobre H79 expuso PII, ruta o secreto.';

  v_page:=public.momos_history_page_v2(null,50,'','Producción',null,null);
  assert exists(select 1 from jsonb_array_elements(v_page->'rows') x where x->>'id'='H79-AUD-002')
    and not exists(select 1 from jsonb_array_elements(v_page->'rows') x where x->>'id'='H79-AUD-001'),
    'El filtro por área cruzó Producción con Pedidos.';

  v_page:=public.momos_history_page_v2(null,2,'H79-CURSOR','Inventario',null,null);
  assert jsonb_array_length(v_page->'rows')=2 and (v_page->>'has_more')::boolean
    and v_page->'next_cursor' is not null,
    'La primera página H79 no selló límite o cursor.';
  v_second:=public.momos_history_page_v2(v_page->'next_cursor',2,'H79-CURSOR','Inventario',null,null);
  assert jsonb_array_length(v_second->'rows')=1 and not (v_second->>'has_more')::boolean,
    'La segunda página H79 perdió o duplicó el cierre.';
  assert not exists(
    select 1 from jsonb_array_elements(v_page->'rows') a
    join jsonb_array_elements(v_second->'rows') b on a->>'id'=b->>'id'
  ),'El cursor H79 repitió una fila.';

  v_page:=public.momos_history_page_v2(null,50,'secret@example.com','','2026-07-19','2026-07-19');
  assert position('secret@example.com' in v_page::text)=0,
    'H79 reflejó una búsqueda potencialmente sensible.';

  v_page:=public.momos_history_page_v2(null,50,'','Finanzas',null,null);
  assert v_page->>'contract'='momos.history-page.v2',
    'H79 no aceptó Finanzas dentro de su contrato cerrado.';

  begin perform public.momos_history_page_v2(null,50,'','Talento humano',null,null);
  exception when sqlstate '22023' then v_failed:=true; end;
  assert v_failed,'H79 aceptó un área fuera de su lista cerrada.';
end $$;

reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ declare v_failed boolean:=false; begin
  begin perform public.momos_history_page_v2(null,50,'','','2026-07-19','2026-07-19');
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo consultar el historial interno.';
end $$;
reset role;

select 'TESTS_OK — Historial filtros/cursor/volumen/privacidad/RBAC PASS, rollback total' as resultado;
rollback;
