-- MOMOS OPS · prueba adversarial H87. Siempre rollback.
begin;
set local statement_timeout='120s';

do $$
declare v_admin_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260720_87_formulas_elaboraciones'),'falta H87';
  assert to_regprocedure('public.listar_fichas_integrales_elaboracion(text)') is not null
    and to_regprocedure('public.formulas_elaboraciones_internas_disponibles()') is not null,
    'faltan RPC o capacidad H87';
  assert exists(select 1 from pg_attribute where attrelid='public.kitchen_procedure_versions'::regclass
      and attname='formula' and not attisdropped)
    and exists(select 1 from pg_attribute where attrelid='public.kitchen_procedure_versions'::regclass
      and attname='formula_fingerprint' and not attisdropped),
    'las versiones no conservan la fórmula';
  assert has_function_privilege('authenticated','public.listar_fichas_integrales_elaboracion(text)','EXECUTE')
    and has_function_privilege('authenticated','public.formulas_elaboraciones_internas_disponibles()','EXECUTE')
    and not has_function_privilege('anon','public.listar_fichas_integrales_elaboracion(text)','EXECUTE')
    and not has_function_privilege('service_role','public.listar_fichas_integrales_elaboracion(text)','EXECUTE')
    and not has_table_privilege('authenticated','public.subreceta_ingredientes','INSERT')
    and not has_table_privilege('authenticated','public.subreceta_ingredientes','UPDATE')
    and not has_table_privilege('authenticated','public.subreceta_ingredientes','DELETE'),
    'la fórmula quedó expuesta a escritura directa o a un rol incorrecto';
  assert position('formulas_elaboraciones_internas_disponibles' in pg_get_functiondef(
    'public.momos_sync_manifest_v1()'::regprocedure))>0,'el manifiesto no anuncia H87';
  select u.auth_id into v_admin_auth from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  assert v_admin_auth is not null,'falta Administrador autenticado para H87';
  perform set_config('momos.h87_admin_auth',v_admin_auth::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h87_admin_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare
  v_sr text; v_output_item text; v_formula jsonb; v_changed_formula jsonb;
  v_before_formula jsonb; v_products_before text; v_draft jsonb; v_history jsonb;
  v_id bigint; v_failed boolean:=false; v_before_sync bigint; v_after_sync bigint;
begin
  assert public.formulas_elaboraciones_internas_disponibles(),'H87 no quedó disponible para Administrador';
  select s.id,s.item_id into v_sr,v_output_item from public.subrecetas s
  where s.activo and exists(select 1 from public.subreceta_ingredientes si where si.subreceta_id=s.id)
  order by s.id limit 1;
  assert v_sr is not null,'falta elaboración activa con fórmula para H87';
  select jsonb_agg(jsonb_build_object('item_id',si.item_id,'cantidad',si.cantidad) order by si.item_id)
  into v_formula from public.subreceta_ingredientes si where si.subreceta_id=v_sr;
  v_before_formula:=v_formula;
  select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text,'UTF8')),'hex')
  into v_products_before from (select id,product_id,item_id,cantidad from public.recipes order by id) x;
  select jsonb_agg(jsonb_build_object(
    'item_id',line->>'item_id',
    'cantidad',(line->>'cantidad')::numeric+case when ord=1 then 0.0001 else 0 end
  ) order by line->>'item_id') into v_changed_formula
  from jsonb_array_elements(v_formula) with ordinality f(line,ord);
  select version into v_before_sync from public.kitchen_procedure_sync_state where id=1;

  begin
    perform public.guardar_ficha_tecnica_cocina(jsonb_build_object(
      'subrecipe_id',v_sr,'process_defined',true,'note','Duplicado inválido',
      'source_ref','Prueba H87','formula_origin','Prueba H87',
      'formula',v_changed_formula||(v_changed_formula->0),
      'steps',jsonb_build_array(jsonb_build_object('title','Pesar','detail','Pesar la fórmula.'))
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H87 aceptó un insumo repetido'; v_failed:=false;

  begin
    perform public.guardar_ficha_tecnica_cocina(jsonb_build_object(
      'subrecipe_id',v_sr,'process_defined',true,'note','Circular inválida',
      'source_ref','Prueba H87','formula_origin','Prueba H87',
      'formula',jsonb_build_array(jsonb_build_object('item_id',v_output_item,'cantidad',1)),
      'steps',jsonb_build_array(jsonb_build_object('title','Pesar','detail','Pesar la fórmula.'))
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'H87 aceptó que una elaboración se consumiera a sí misma'; v_failed:=false;

  v_draft:=public.guardar_ficha_tecnica_cocina(jsonb_build_object(
    'subrecipe_id',v_sr,'process_defined',true,
    'note','Fórmula y procedimiento revisados juntos.',
    'source_ref','Validación interna H87','formula_origin','Balanza de Cocina H87',
    'formula',v_changed_formula,
    'steps',jsonb_build_array(
      jsonb_build_object('title','Pesar','detail','Pesar cada insumo de la fórmula publicada.'),
      jsonb_build_object('title','Integrar','detail','Integrar en el orden validado por Cocina.')
    )
  ));
  v_id:=(v_draft->>'id')::bigint;
  assert v_draft->>'contract'='momos.kitchen-procedure-draft.v2'
    and length(v_draft->>'formula_fingerprint')=64
    and (select formula=v_changed_formula and status='Borrador'
      from public.kitchen_procedure_versions where id=v_id),
    'el borrador no selló fórmula y procedimiento juntos';
  assert (select jsonb_agg(jsonb_build_object('item_id',si.item_id,'cantidad',si.cantidad) order by si.item_id)
    from public.subreceta_ingredientes si where si.subreceta_id=v_sr)=v_before_formula,
    'guardar el borrador alteró la fórmula vigente';

  v_history:=public.listar_fichas_integrales_elaboracion(v_sr);
  assert v_history->>'contract'='momos.internal-preparation-sheet-history.v1'
    and v_history->>'subrecipeId'=v_sr and jsonb_array_length(v_history->'rows') between 2 and 50,
    'el historial integral no devolvió el contrato esperado';
  assert not exists(select 1 from jsonb_array_elements(v_history->'rows') row
    where row ?| array['createdBy','approvedBy','created_by','approved_by','email','actor','userId']),
    'el historial integral expuso identidad o PII';
  assert not exists(select 1 from jsonb_array_elements(v_history->'rows') row
    where (select array_agg(k order by k) from jsonb_object_keys(row) k)
      <>array['approvedAt','createdAt','fingerprint','formula','formulaFingerprint','formulaOrigin','id','note','processDefined','sourceRef','status','steps','subrecipeId','version']::text[]),
    'el historial integral expuso campos fuera del contrato cerrado';

  begin perform public.activar_ficha_tecnica_cocina(v_id,'PUBLICAR');
  exception when others then v_failed:=true; end;
  assert v_failed and (select status='Borrador' from public.kitchen_procedure_versions where id=v_id),
    'H87 omitió la confirmación de publicación'; v_failed:=false;
  perform public.activar_ficha_tecnica_cocina(v_id,'ACTIVAR FICHA');
  select version into v_after_sync from public.kitchen_procedure_sync_state where id=1;
  assert v_after_sync>v_before_sync
    and (select count(*)=1 from public.kitchen_procedure_versions where subrecipe_id=v_sr and status='Vigente')
    and (select jsonb_agg(jsonb_build_object('item_id',si.item_id,'cantidad',si.cantidad) order by si.item_id)
      from public.subreceta_ingredientes si where si.subreceta_id=v_sr)=v_changed_formula,
    'la publicación no cambió fórmula y versión vigente de forma atómica';
  assert (select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text,'UTF8')),'hex')
    from (select id,product_id,item_id,cantidad from public.recipes order by id) x)=v_products_before,
    'editar una elaboración alteró recetas de Productos';

  begin
    update public.subreceta_ingredientes set cantidad=cantidad+1 where subreceta_id=v_sr;
  exception when others then v_failed:=true; end;
  assert v_failed,'authenticated pudo alterar directamente la fórmula publicada';
end $$;

reset role;
select 'TESTS_OK — fórmulas internas/borrador/publicación atómica/historial/RBAC PASS, rollback total' as resultado;
rollback;
