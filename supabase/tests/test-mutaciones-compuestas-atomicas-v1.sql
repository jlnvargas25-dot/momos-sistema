-- MOMOS OPS · prueba adversarial H91. Siempre ROLLBACK.
-- Fuerza una caída en el segundo paso de cada flujo y exige que el primero
-- tampoco sobreviva. Después repite cada contrato y verifica idempotencia.

begin;
select pg_advisory_xact_lock(hashtext('momos_ops_test_h91_20260721'));

create or replace function public._h91_test_fail_order_status()
returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.id=current_setting('momos.h91_order',true)
     and new.estado='Listo para empaque' then
    raise exception 'H91_TEST_FAIL_ORDER_SECOND_STEP';
  end if;
  return new;
end $$;

create or replace function public._h91_test_fail_suggestion()
returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.id=current_setting('momos.h91_fail_suggestion',true)
     and new.estado='Atendida' then
    raise exception 'H91_TEST_FAIL_SUGGESTION_SECOND_STEP';
  end if;
  return new;
end $$;

do $$
declare
  v_actor_auth uuid;
  v_product text;
  v_figure text;
  v_cat text;
  v_order text:='P-H91-'||pg_backend_pid();
  v_customer text:='C-H91-'||pg_backend_pid();
  v_order_item text:='OI-H91-'||pg_backend_pid();
  v_purchase_item text:='I-H91-'||pg_backend_pid();
  v_item record;
begin
  assert exists(select 1 from public.momos_ops_migrations
    where id='20260721_91_mutaciones_compuestas_atomicas'),'Falta aplicar H91.';
  assert to_regclass('public.compound_mutation_receipts') is not null
    and to_regprocedure('public.completar_cocina_y_entregar_empaque_v1(jsonb)') is not null
    and to_regprocedure('public.crear_corrida_agrupada_v1(jsonb)') is not null
    and to_regprocedure('public.registrar_compra_y_atender_sugerencias_v1(jsonb)') is not null
    and to_regprocedure('public.mutaciones_compuestas_atomicas_disponibles()') is not null,
    'H91 no instaló todas sus piezas.';
  assert has_function_privilege('authenticated','public.completar_cocina_y_entregar_empaque_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.crear_corrida_agrupada_v1(jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.registrar_compra_y_atender_sugerencias_v1(jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.completar_cocina_y_entregar_empaque_v1(jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.crear_corrida_agrupada_v1(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public._momos_h91_suggestion_ids(jsonb)','EXECUTE'),
    'H91 abrió una función interna o perdió RBAC.';
  assert not has_table_privilege('authenticated','public.compound_mutation_receipts','SELECT')
    and not has_table_privilege('authenticated','public.compound_mutation_receipts','INSERT')
    and not has_table_privilege('service_role','public.compound_mutation_receipts','SELECT')
    and (select relrowsecurity from pg_class where oid='public.compound_mutation_receipts'::regclass),
    'Los recibos compuestos H91 no son privados.';

  select u.auth_id into v_actor_auth from public.users u
  where u.activo and u.auth_id is not null
    and 'Administrador'=any(coalesce(u.roles,array[u.rol]))
  order by u.id limit 1;
  select f.product_id,f.nombre into v_product,v_figure
  from public.figuras f join public.products p on p.id=f.product_id
  where f.activo and public._momos_es_figura_canonica(f.nombre)
    and p.activo and p.tipo='momo'
  order by f.nombre limit 1;
  select nombre into v_cat from public.inventory_cats order by nombre limit 1;
  assert v_actor_auth is not null and v_product is not null and v_cat is not null,
    'Falta actor, figura o categoría para H91.';

  insert into public.customers(id,nombre,telefono,canal)
  values(v_customer,'Fixture H91','398'||right('0000000'||pg_backend_pid(),7),'Directo');
  insert into public.orders(
    id,fecha,hora,canal,customer_id,pago,comprobante,pagado_en,estado,obs
  ) values(
    v_order,current_date,localtime,'Directo',v_customer,'Nequi',true,now(),
    'En producción','[TEST H91]'
  );
  insert into public.order_items(
    id,order_id,product_id,nombre,figura,sabor,relleno,cant,precio,costo_unitario
  ) select v_order_item,v_order,p.id,p.nombre,v_figure,'Coco','Cheesecake con ganache',1,p.precio,p.costo
    from public.products p where p.id=v_product;

  insert into public.inventory_items(
    id,nombre,cat,unidad,stock,minimo,costo,proveedor,vence,ubicacion,compra
  ) values(v_purchase_item,'Insumo compra H91',v_cat,'kg',0,0,1000,'Prueba H91',null,'Rollback',current_date);

  -- Cobertura sintética exacta para cualquier receta que la corrida consuma.
  for v_item in select id,coalesce(costo,0) costo from public.inventory_items order by id loop
    if v_item.id<>v_purchase_item then
      insert into public.inventory_lots(
        id,item_id,received_at,expires_at,initial_quantity,available_quantity,
        unit_cost,supplier,location,origin
      ) values(
        'IL-H91-'||v_item.id||'-'||pg_backend_pid(),v_item.id,current_date,current_date+30,
        1000,1000,greatest(v_item.costo,0),'Prueba H91','Rollback','Ajuste'
      );
      update public.inventory_items i set stock=(
        select coalesce(sum(l.available_quantity),0) from public.inventory_lots l
        where l.item_id=i.id and l.available_quantity>0
      ) where i.id=v_item.id;
    end if;
  end loop;

  insert into public.production_suggestions(
    id,fecha,product_id,cantidad,motivo,estado,area
  ) values
    ('S-H91-P1-'||pg_backend_pid(),current_date,v_product,1,'Corrida H91','Pendiente','Producción'),
    ('S-H91-P2-'||pg_backend_pid(),current_date,v_product,1,'Corrida H91','Pendiente','Producción');
  insert into public.production_suggestions(
    id,fecha,item_id,cantidad,motivo,estado,area
  ) values
    ('S-H91-I1-'||pg_backend_pid(),current_date,v_purchase_item,1,'Compra H91','Pendiente','Inventario'),
    ('S-H91-I2-'||pg_backend_pid(),current_date,v_purchase_item,1,'Compra H91','Pendiente','Inventario');

  perform set_config('momos.h91_actor_auth',v_actor_auth::text,true);
  perform set_config('momos.h91_order',v_order,true);
  perform set_config('momos.h91_order_item',v_order_item,true);
  perform set_config('momos.h91_product',v_product,true);
  perform set_config('momos.h91_figure',v_figure,true);
  perform set_config('momos.h91_purchase_item',v_purchase_item,true);
end $$;

create trigger h91_test_fail_order_status
before update on public.orders for each row
execute function public._h91_test_fail_order_status();

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('momos.h91_actor_auth'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare v_failed boolean:=false;
begin
  assert public.mutaciones_compuestas_atomicas_disponibles(),'H91 no está disponible para staff.';
  perform public.tomar_etapa_pedido(current_setting('momos.h91_order'),'Cocina');
  begin
    perform public.completar_cocina_y_entregar_empaque_v1(jsonb_build_object(
      'idempotency_key','91000000-0000-4000-8000-000000000001',
      'order_id',current_setting('momos.h91_order')
    ));
  exception when others then
    v_failed:=position('H91_TEST_FAIL_ORDER_SECOND_STEP' in sqlerrm)>0;
  end;
  assert v_failed,'No se alcanzó el fallo sintético del segundo paso de Cocina.';
end $$;

reset role;
do $$
begin
  assert (select estado from public.orders where id=current_setting('momos.h91_order'))='En producción'
    and (select status from public.order_line_progress
      where order_item_id=current_setting('momos.h91_order_item') and stage='Cocina')='Pendiente'
    and not exists(select 1 from public.compound_mutation_receipts
      where operation='cocina_a_empaque' and idempotency_key='91000000-0000-4000-8000-000000000001'),
    'Cocina dejó líneas, estado o recibo parcial tras fallar el segundo paso.';
end $$;
drop trigger h91_test_fail_order_status on public.orders;

set local role authenticated;
do $$
declare v_first jsonb; v_repeat jsonb; v_failed boolean:=false;
begin
  v_first:=public.completar_cocina_y_entregar_empaque_v1(jsonb_build_object(
    'idempotency_key','91000000-0000-4000-8000-000000000001',
    'order_id',current_setting('momos.h91_order')
  ));
  v_repeat:=public.completar_cocina_y_entregar_empaque_v1(jsonb_build_object(
    'idempotency_key','91000000-0000-4000-8000-000000000001',
    'order_id',current_setting('momos.h91_order')
  ));
  assert v_first->>'contract'='momos.compound-mutation.v1'
    and v_first->>'operation'='cocina_a_empaque'
    and (v_first->>'duplicate')::boolean=false
    and (v_repeat->>'duplicate')::boolean=true,
    'El relevo Cocina a Empaque no es idempotente.';
  begin perform public.completar_cocina_y_entregar_empaque_v1(
    jsonb_build_object('idempotency_key','91000000-0000-4000-8000-000000000001','order_id','OTRO')
  ); exception when others then v_failed:=true; end;
  assert v_failed,'Cocina aceptó reutilizar una llave con otro pedido.';
end $$;

reset role;
do $$
begin
  assert (select estado from public.orders where id=current_setting('momos.h91_order'))='Listo para empaque'
    and (select status from public.order_line_progress
      where order_item_id=current_setting('momos.h91_order_item') and stage='Cocina')='Listo'
    and (select count(*) from public.compound_mutation_receipts
      where operation='cocina_a_empaque' and idempotency_key='91000000-0000-4000-8000-000000000001')=1,
    'El relevo Cocina a Empaque no confirmó ambos efectos exactamente una vez.';
end $$;

create trigger h91_test_fail_suggestion
before update on public.production_suggestions for each row
execute function public._h91_test_fail_suggestion();
select set_config('momos.h91_fail_suggestion','S-H91-P2-'||pg_backend_pid(),true);
set local role authenticated;

do $$
declare v_failed boolean:=false;
begin
  begin
    perform public.crear_corrida_agrupada_v1(jsonb_build_object(
      'idempotency_key','91000000-0000-4000-8000-000000000002',
      'corrida',jsonb_build_object(
        'sabor','Coco','relleno','Cheesecake con ganache',
        'figuras',jsonb_build_array(jsonb_build_object('figura',current_setting('momos.h91_figure'),'cant',2)),
        'idempotency_key','test-h91-corrida'
      ),
      'suggestion_ids',jsonb_build_array(
        'S-H91-P1-'||pg_backend_pid(),'S-H91-P2-'||pg_backend_pid()
      )
    ));
  exception when others then
    v_failed:=position('H91_TEST_FAIL_SUGGESTION_SECOND_STEP' in sqlerrm)>0;
  end;
  assert v_failed,'No se alcanzó el fallo sintético al cerrar la segunda sugerencia de Producción.';
end $$;

reset role;
do $$
begin
  assert not exists(select 1 from public.production_delta_receipts
      where operation='crear_corrida' and idempotency_key='test-h91-corrida')
    and not exists(select 1 from public.compound_mutation_receipts
      where operation='corrida_agrupada' and idempotency_key='91000000-0000-4000-8000-000000000002')
    and not exists(select 1 from public.production_batches where obs ilike '%S-H91-P1-%')
    and not exists(select 1 from public.production_suggestions
      where id=any(array['S-H91-P1-'||pg_backend_pid(),'S-H91-P2-'||pg_backend_pid()]) and estado<>'Pendiente'),
    'La corrida agrupada dejó lotes, recibos o sugerencias parcialmente cerradas.';
end $$;
drop trigger h91_test_fail_suggestion on public.production_suggestions;

set local role authenticated;
do $$
declare v_first jsonb; v_repeat jsonb; v_count integer;
begin
  v_first:=public.crear_corrida_agrupada_v1(jsonb_build_object(
    'idempotency_key','91000000-0000-4000-8000-000000000002',
    'corrida',jsonb_build_object(
      'sabor','Coco','relleno','Cheesecake con ganache',
      'figuras',jsonb_build_array(jsonb_build_object('figura',current_setting('momos.h91_figure'),'cant',2)),
      'idempotency_key','test-h91-corrida'
    ),
    'suggestion_ids',jsonb_build_array('S-H91-P1-'||pg_backend_pid(),'S-H91-P2-'||pg_backend_pid())
  ));
  v_repeat:=public.crear_corrida_agrupada_v1(jsonb_build_object(
    'idempotency_key','91000000-0000-4000-8000-000000000002',
    'corrida',jsonb_build_object(
      'sabor','Coco','relleno','Cheesecake con ganache',
      'figuras',jsonb_build_array(jsonb_build_object('figura',current_setting('momos.h91_figure'),'cant',2)),
      'idempotency_key','test-h91-corrida'
    ),
    'suggestion_ids',jsonb_build_array('S-H91-P1-'||pg_backend_pid(),'S-H91-P2-'||pg_backend_pid())
  ));
  assert v_first->'production'->>'contract'='momos.production-mutation.v1'
    and (v_first->>'suggestionCount')::integer=2
    and (v_repeat->>'duplicate')::boolean=true,
    'La corrida agrupada no devolvió su mutación ni replay exacto.';
end $$;

reset role;
do $$
begin
  assert not exists(select 1 from public.production_suggestions
      where id=any(array['S-H91-P1-'||pg_backend_pid(),'S-H91-P2-'||pg_backend_pid()]) and estado<>'Atendida')
    and (select count(*) from public.production_delta_receipts
      where operation='crear_corrida' and idempotency_key='test-h91-corrida')=1
    and (select count(*) from public.compound_mutation_receipts
      where operation='corrida_agrupada' and idempotency_key='91000000-0000-4000-8000-000000000002')=1,
    'La corrida o sus sugerencias no quedaron confirmadas exactamente una vez.';
end $$;

create trigger h91_test_fail_suggestion
before update on public.production_suggestions for each row
execute function public._h91_test_fail_suggestion();
select set_config('momos.h91_fail_suggestion','S-H91-I2-'||pg_backend_pid(),true);
set local role authenticated;

do $$
declare v_failed boolean:=false;
begin
  begin
    perform public.registrar_compra_y_atender_sugerencias_v1(jsonb_build_object(
      'idempotency_key','91000000-0000-4000-8000-000000000003',
      'compra',jsonb_build_object(
        'item_id',current_setting('momos.h91_purchase_item'),'cant',2,'costo_total',2000,
        'vence',(current_date+10)::text,'proveedor','Prueba H91','ubicacion','Rollback','nota','No persistir'
      ),
      'suggestion_ids',jsonb_build_array('S-H91-I1-'||pg_backend_pid(),'S-H91-I2-'||pg_backend_pid())
    ));
  exception when others then
    v_failed:=position('H91_TEST_FAIL_SUGGESTION_SECOND_STEP' in sqlerrm)>0;
  end;
  assert v_failed,'No se alcanzó el fallo sintético al cerrar la segunda sugerencia de compra.';
end $$;

reset role;
do $$
begin
  assert (select stock from public.inventory_items where id=current_setting('momos.h91_purchase_item'))=0
    and not exists(select 1 from public.inventory_lots where item_id=current_setting('momos.h91_purchase_item'))
    and not exists(select 1 from public.inventory_delta_receipts
      where idempotency_key='91000000-0000-4000-8000-000000000003')
    and not exists(select 1 from public.compound_mutation_receipts
      where operation='compra_con_sugerencias' and idempotency_key='91000000-0000-4000-8000-000000000003')
    and not exists(select 1 from public.production_suggestions
      where id=any(array['S-H91-I1-'||pg_backend_pid(),'S-H91-I2-'||pg_backend_pid()]) and estado<>'Pendiente'),
    'La compra dejó stock, lote, recibo o sugerencias parcialmente cerradas.';
end $$;
drop trigger h91_test_fail_suggestion on public.production_suggestions;

set local role authenticated;
do $$
declare v_first jsonb; v_repeat jsonb; v_failed boolean:=false;
begin
  v_first:=public.registrar_compra_y_atender_sugerencias_v1(jsonb_build_object(
    'idempotency_key','91000000-0000-4000-8000-000000000003',
    'compra',jsonb_build_object(
      'item_id',current_setting('momos.h91_purchase_item'),'cant',2,'costo_total',2000,
      'vence',(current_date+10)::text,'proveedor','Prueba H91','ubicacion','Rollback','nota','No persistir'
    ),
    'suggestion_ids',jsonb_build_array('S-H91-I1-'||pg_backend_pid(),'S-H91-I2-'||pg_backend_pid())
  ));
  v_repeat:=public.registrar_compra_y_atender_sugerencias_v1(jsonb_build_object(
    'idempotency_key','91000000-0000-4000-8000-000000000003',
    'compra',jsonb_build_object(
      'item_id',current_setting('momos.h91_purchase_item'),'cant',2,'costo_total',2000,
      'vence',(current_date+10)::text,'proveedor','Prueba H91','ubicacion','Rollback','nota','No persistir'
    ),
    'suggestion_ids',jsonb_build_array('S-H91-I1-'||pg_backend_pid(),'S-H91-I2-'||pg_backend_pid())
  ));
  assert v_first->'inventory'->>'contract'='momos.inventory-mutation.v1'
    and (v_first->>'suggestionCount')::integer=2
    and (v_repeat->>'duplicate')::boolean=true,
    'La compra compuesta no devolvió inventario ni replay exacto.';
  begin
    perform public.registrar_compra_y_atender_sugerencias_v1(jsonb_build_object(
      'idempotency_key','91000000-0000-4000-8000-000000000003',
      'compra',jsonb_build_object('item_id',current_setting('momos.h91_purchase_item'),'cant',3,'costo_total',2000),
      'suggestion_ids',jsonb_build_array('S-H91-I1-'||pg_backend_pid(),'S-H91-I2-'||pg_backend_pid())
    ));
  exception when others then v_failed:=true; end;
  assert v_failed,'La compra aceptó reutilizar la llave con otro contrato.';
end $$;

reset role;
do $$
declare v_receipt_text text;
begin
  assert (select stock from public.inventory_items where id=current_setting('momos.h91_purchase_item'))=2
    and (select coalesce(sum(available_quantity),0) from public.inventory_lots
      where item_id=current_setting('momos.h91_purchase_item'))=2
    and not exists(select 1 from public.production_suggestions
      where id=any(array['S-H91-I1-'||pg_backend_pid(),'S-H91-I2-'||pg_backend_pid()]) and estado<>'Atendida')
    and (select count(*) from public.inventory_delta_receipts
      where idempotency_key='91000000-0000-4000-8000-000000000003')=1
    and (select count(*) from public.compound_mutation_receipts
      where operation='compra_con_sugerencias' and idempotency_key='91000000-0000-4000-8000-000000000003')=1,
    'La compra, su lote o sus sugerencias no quedaron confirmadas exactamente una vez.';
  assert not exists(
    select 1 from public.compound_mutation_receipts
    where coalesce((response->>'containsCustomerPii')::boolean,true)
       or coalesce((response->>'containsSecrets')::boolean,true)
       or coalesce((response->>'externalExecution')::boolean,true)
  ), 'Los recibos H91 no declararon correctamente su contrato de privacidad.';
  select string_agg(response::text,' ') into v_receipt_text from public.compound_mutation_receipts;
  assert lower(coalesce(v_receipt_text,'')) !~ 'telefono|direcci[oó]n|storage_path|api[_-]?key|access[_-]?token',
    'Los recibos H91 expusieron PII, ruta o secreto.';
end $$;

set local role anon;
do $$
declare v_failed boolean:=false;
begin
  begin perform public.completar_cocina_y_entregar_empaque_v1('{}'::jsonb);
  exception when others then v_failed:=true; end;
  assert v_failed,'Anon pudo ejecutar H91.';
end $$;
reset role;

set constraints all immediate;
select 'TESTS_OK — H91 Cocina/Corrida/Compra atómicas/rollback/idempotencia/PII/RBAC PASS, rollback total' as resultado;
rollback;
