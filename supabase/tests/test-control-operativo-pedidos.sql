-- MOMOS OPS · prueba adversarial de control operativo. Siempre ROLLBACK.
begin;

create temporary table control_test_context(order_id text,item_id text,customer_id text) on commit drop;
do $$
declare v_suffix text:=pg_backend_pid()::text; v_customer text:='CTRL-C-'||pg_backend_pid(); v_order text:='CTRL-P-'||pg_backend_pid(); v_item text:='CTRL-I-'||pg_backend_pid(); v_product text; v_figura text;
begin
  assert public.operacion_pedido_disponible(), 'Falta aplicar la migración 14.';
  select p.id,f.nombre into v_product,v_figura
  from public.products p join public.figuras f on f.product_id=p.id and f.activo
  where p.activo order by p.id,f.nombre limit 1;
  assert v_product is not null and v_figura is not null, 'Falta un producto con figura activa para el fixture.';
  insert into public.customers(id,nombre,telefono,canal) values(v_customer,'Control adversarial','399'||right('0000000'||v_suffix,7),'Directo');
  insert into public.orders(id,fecha,hora,canal,customer_id,pago,comprobante,estado,obs)
  values(v_order,current_date,localtime,'Directo',v_customer,'Nequi',true,'Pagado','[TEST CONTROL OPERATIVO]');
  insert into public.order_items(id,order_id,product_id,nombre,figura,sabor,cant,precio,costo_unitario)
  select v_item,v_order,p.id,p.nombre,v_figura,'Coco',1,p.precio,p.costo from public.products p where p.id=v_product;
  insert into control_test_context values(v_order,v_item,v_customer);
end $$;

-- El test cambia de rol; la tabla temporal necesita un permiso explícito. Esto
-- solo afecta el fixture pg_temp y desaparece con el ROLLBACK.
grant select on table control_test_context to authenticated;

select set_config('request.jwt.claims','{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_order text; v_item text; v_assignment text; v_incident text; v_version integer; v_failed boolean:=false;
begin
  select order_id,item_id into v_order,v_item from control_test_context;

  v_assignment:=public.tomar_etapa_pedido(v_order,'Cocina')->>'assignment_id';
  assert v_assignment is not null, 'A1 no creó responsable de Cocina.';
  perform public.tomar_etapa_pedido(v_order,'Cocina');
  assert (select count(*) from public.order_stage_assignments where order_id=v_order and stage='Cocina' and status='Activa')=1,
    'A2 tomar dos veces duplicó el responsable activo.';
  assert (select count(*) from public.order_line_progress where order_id=v_order and stage='Cocina')=1,
    'A3 no inicializó el progreso por línea.';

  select version into v_version from public.order_line_progress where order_item_id=v_item and stage='Cocina';
  perform public.set_progreso_linea_pedido(v_item,'Cocina','En proceso',v_version);
  v_failed:=false;
  begin perform public.set_progreso_linea_pedido(v_item,'Cocina','Listo',v_version);
  exception when others then v_failed:=true; end;
  assert v_failed, 'B1 aceptó una versión obsoleta desde otro dispositivo.';

  v_incident:=public.crear_incidente_pedido(jsonb_build_object(
    'order_id',v_order,'order_item_id',v_item,'area','Cocina','type','Faltante','description','Falta material de prueba'
  ))->>'incident_id';
  assert (select status from public.order_line_progress where order_item_id=v_item and stage='Cocina')='Incidente',
    'C1 el incidente no bloqueó la línea.';
  v_failed:=false;
  begin perform public.completar_etapa_pedido(v_order,'Cocina');
  exception when others then v_failed:=true; end;
  assert v_failed, 'C2 permitió completar Cocina con incidente abierto.';
  perform public.resolver_incidente_pedido(v_incident,'Material repuesto y verificado');
  assert not exists(select 1 from public.order_incidents where id=v_incident and status='Abierto'), 'C3 no resolvió el incidente.';

  select version into v_version from public.order_line_progress where order_item_id=v_item and stage='Cocina';
  perform public.set_progreso_linea_pedido(v_item,'Cocina','Listo',v_version);
  perform public.completar_etapa_pedido(v_order,'Cocina');
  assert (select status from public.order_line_progress where order_item_id=v_item and stage='Cocina')='Listo',
    'D1 la línea no quedó Lista.';

  v_failed:=false;
  begin perform public.set_progreso_linea_pedido(v_item,'Empaque','Verificado',null);
  exception when others then v_failed:=true; end;
  assert v_failed, 'D2 permitió falsificar Verificado sin la comanda exacta de Empaque.';

  perform public.liberar_etapa_pedido(v_order,'Cocina','Fin de prueba');
  assert not exists(select 1 from public.order_stage_assignments where order_id=v_order and stage='Cocina' and status='Activa'),
    'E1 no liberó la responsabilidad.';
  assert exists(select 1 from public.audit_logs where entidad='Pedido' and entidad_id=v_order and accion='Incidente resuelto'),
    'E2 falta auditoría del flujo.';

  assert not has_table_privilege('authenticated','public.order_stage_assignments','INSERT'), 'F1 authenticated conserva INSERT directo.';
  assert not has_table_privilege('authenticated','public.order_line_progress','UPDATE'), 'F2 authenticated conserva UPDATE directo.';
  assert not has_table_privilege('authenticated','public.order_incidents','DELETE'), 'F3 authenticated conserva DELETE directo.';
end $$;

select 'TESTS_OK — control operativo responsables/progreso/incidentes/RBAC PASS, rollback total' as resultado;
rollback;
