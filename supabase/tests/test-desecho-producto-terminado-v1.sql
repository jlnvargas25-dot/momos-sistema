-- MOMOS OPS · prueba H84. Siempre rollback.
begin;
set local statement_timeout='120s';

do $$
declare v_admin_auth uuid;
begin
  assert exists(select 1 from public.momos_ops_migrations where id='20260720_84_desecho_producto_terminado'),'falta H84';
  assert to_regclass('public.finished_product_disposals') is not null
    and to_regprocedure('public.desechar_producto_terminado_delta(jsonb)') is not null
    and to_regprocedure('public.desecho_producto_terminado_disponible()') is not null,
    'faltan ledger o RPC de desecho terminado';
  assert has_function_privilege('authenticated','public.desechar_producto_terminado_delta(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.desecho_producto_terminado_disponible()','EXECUTE')
    and not has_function_privilege('anon','public.desechar_producto_terminado_delta(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.desecho_producto_terminado_disponible()','EXECUTE')
    and not has_function_privilege('service_role','public.desechar_producto_terminado_delta(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.desecho_producto_terminado_disponible()','EXECUTE'),
    'RBAC de la RPC H84 incorrecto';
  assert position('desecho_producto_terminado_disponible' in pg_get_functiondef(
      'public.momos_sync_manifest_v1()'::regprocedure
    ))>0,
    'el manifiesto de Data Sync no anuncia H84';
  assert exists(
    select 1 from pg_constraint c
    where c.conrelid='public.production_delta_receipts'::regclass
      and c.conname='production_delta_receipts_operation_check'
      and position('desechar_producto_terminado' in pg_get_constraintdef(c.oid))>0
  ),'el recibo idempotente de Producción no admite la operación H84';
  assert has_table_privilege('authenticated','public.finished_product_disposals','SELECT')
    and not has_table_privilege('authenticated','public.finished_product_disposals','INSERT')
    and not has_table_privilege('authenticated','public.finished_product_disposals','UPDATE')
    and not has_table_privilege('service_role','public.finished_product_disposals','SELECT'),
    'el ledger de desechos quedó escribible o expuesto';
  select u.auth_id into v_admin_auth from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  assert v_admin_auth is not null,'falta Administrador autenticado para H84';
  perform set_config('momos.h84_admin_auth',v_admin_auth::text,true);
end $$;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h84_admin_auth'),'role','authenticated')::text,true);

-- El fixture lo prepara postgres. El rol authenticated solo usa la RPC pública;
-- así la prueba no exige ni concede escritura directa sobre tablas operativas.
do $$
declare
  v_product text;
  v_batch text:='L-H84-'||pg_backend_pid()::text;
  v_fresh_batch text:='L-H84-F-'||pg_backend_pid()::text;
  v_stale_batch text:='L-H84-S-'||pg_backend_pid()::text;
  v_figure text:='Figura H84';
  v_stock_before numeric;
  v_key text:='84000000-0000-4000-8000-'||lpad(pg_backend_pid()::text,12,'0');
begin
  select p.id,p.stock into v_product,v_stock_before
  from public.products p where p.tipo='momo' and p.activo order by p.id limit 1;
  assert v_product is not null,'falta producto momo para H84';

  insert into public.production_batches(
    id,fecha,product_id,figura,sabor,gramaje_g,prod,perfectas,imperfectas,
    descartadas,estado,stock_contabilizado,desmoldado_en,vida_util_dias
  ) values(
    v_batch,current_date-3,v_product,v_figure,'Prueba H84',180,3,3,0,0,
    'Listo',true,clock_timestamp()-interval '3 days',1
  );
  insert into public.lote_figuras(
    batch_id,figura,cant,perfectas,imperfectas,descartadas,consumidas
  ) values(v_batch,v_figure,3,3,0,0,1);

  insert into public.production_batches(
    id,fecha,product_id,figura,sabor,gramaje_g,prod,perfectas,imperfectas,
    descartadas,estado,stock_contabilizado,desmoldado_en,vida_util_dias
  ) values(
    v_fresh_batch,current_date,v_product,v_figure,'Prueba H84 vigente',180,1,1,0,0,
    'Listo',true,clock_timestamp(),6
  );
  insert into public.lote_figuras(
    batch_id,figura,cant,perfectas,imperfectas,descartadas,consumidas
  ) values(v_fresh_batch,v_figure,1,1,0,0,0);

  insert into public.production_batches(
    id,fecha,product_id,figura,sabor,gramaje_g,prod,perfectas,imperfectas,
    descartadas,estado,stock_contabilizado,desmoldado_en,vida_util_dias
  ) values(
    v_stale_batch,current_date-3,v_product,v_figure,'Prueba H84 stale',180,2,2,0,0,
    'Listo',true,clock_timestamp()-interval '3 days',1
  );
  insert into public.lote_figuras(
    batch_id,figura,cant,perfectas,imperfectas,descartadas,consumidas
  ) values(v_stale_batch,v_figure,2,2,0,0,0);

  -- Dos libres del lote vencido, una del vigente y dos del lote de vista obsoleta.
  update public.products set stock=stock+5 where id=v_product;
  perform set_config('momos.h84_product',v_product,true);
  perform set_config('momos.h84_batch',v_batch,true);
  perform set_config('momos.h84_fresh_batch',v_fresh_batch,true);
  perform set_config('momos.h84_stale_batch',v_stale_batch,true);
  perform set_config('momos.h84_figure',v_figure,true);
  perform set_config('momos.h84_stock_before',v_stock_before::text,true);
  perform set_config('momos.h84_key',v_key,true);
end $$;

set local role authenticated;

do $$
declare
  v_product text:=current_setting('momos.h84_product');
  v_batch text:=current_setting('momos.h84_batch');
  v_fresh_batch text:=current_setting('momos.h84_fresh_batch');
  v_stale_batch text:=current_setting('momos.h84_stale_batch');
  v_figure text:=current_setting('momos.h84_figure');
  v_stock_before numeric:=current_setting('momos.h84_stock_before')::numeric;
  v_key text:=current_setting('momos.h84_key');
  v_response jsonb;
  v_repeat jsonb;
  v_failed boolean:=false;
begin
  assert public.desecho_producto_terminado_disponible(),
    'H84 no quedó disponible para Administrador';

  begin
    perform public.desechar_producto_terminado_delta(jsonb_build_object(
      'batch_id',v_batch,'figura',v_figure,'motivo','Contrato incompleto',
      'idempotency_key','84000000-0000-4000-8000-000000000097'
    ));
  exception when others then v_failed:=true; end;
  assert v_failed
    and (select consumidas=1 from public.lote_figuras where batch_id=v_batch and figura=v_figure)
    and not exists(select 1 from public.finished_product_disposals where batch_id=v_batch),
    'H84 aceptó un desecho sin cantidad esperada o dejó efectos parciales';
  v_failed:=false;

  v_response:=public.desechar_producto_terminado_delta(jsonb_build_object(
    'batch_id',v_batch,'figura',v_figure,'motivo','Vencimiento prueba H84',
    'cantidad_esperada',2,'idempotency_key',v_key
  ));
  assert v_response->>'contract'='momos.production-mutation.v1'
    and v_response->>'operation'='desechar_producto_terminado'
    and (v_response->>'duplicate')::boolean=false
    and (v_response#>>'{result,desechado}')::integer=2
    and v_response#>>'{result,contract}'='momos.finished-product-disposal.v1'
    and v_response->'finishedInventory' is not null,
    'la respuesta H84 no confirmó el desecho y su delta exacto';
  assert (select consumidas=3 from public.lote_figuras where batch_id=v_batch and figura=v_figure)
    and (select stock=v_stock_before+3 from public.products where id=v_product),
    'H84 no retiró exactamente el saldo libre';
  assert (select count(*)=1 and max(quantity)=2 and max(reason)='Vencimiento prueba H84'
    from public.finished_product_disposals where batch_id=v_batch and figure=v_figure),
    'el ledger H84 no conservó cantidad y motivo';

  v_repeat:=public.desechar_producto_terminado_delta(jsonb_build_object(
    'batch_id',v_batch,'figura',v_figure,'motivo','Vencimiento prueba H84',
    'cantidad_esperada',2,'idempotency_key',v_key
  ));
  assert (v_repeat->>'duplicate')::boolean=true
    and (select count(*)=1 from public.finished_product_disposals where batch_id=v_batch),
    'el reintento H84 duplicó la merma';

  begin
    perform public.desechar_producto_terminado_delta(jsonb_build_object(
      'batch_id',v_fresh_batch,'figura',v_figure,'motivo','No debería aplicar',
      'cantidad_esperada',1,
      'idempotency_key','84000000-0000-4000-8000-000000000099'
    ));
  exception when others then v_failed:=true; end;
  assert v_failed and (select consumidas=0 from public.lote_figuras where batch_id=v_fresh_batch),
    'H84 permitió desechar producto vigente';

  v_failed:=false;
  begin
    perform public.desechar_producto_terminado_delta(jsonb_build_object(
      'batch_id',v_stale_batch,'figura',v_figure,'motivo','Vista desactualizada',
      'cantidad_esperada',1,
      'idempotency_key','84000000-0000-4000-8000-000000000098'
    ));
  exception when others then v_failed:=true; end;
  assert v_failed
    and (select consumidas=0 from public.lote_figuras where batch_id=v_stale_batch and figura=v_figure)
    and not exists(select 1 from public.finished_product_disposals where batch_id=v_stale_batch),
    'H84 aceptó una cantidad esperada obsoleta o dejó efectos parciales';
end $$;

reset role;
select 'TESTS_OK — desecho terminado exacto/idempotente/RBAC/vigencia y ledger PASS; rollback total' as resultado;
rollback;
