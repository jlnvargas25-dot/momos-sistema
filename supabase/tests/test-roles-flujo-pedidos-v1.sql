-- ============================================================================
-- MOMOS OPS — aceptación re-ejecutable · roles_flujo_pedidos_v1
-- Ejecutar completa. PASS = error final:
-- TESTS_OK — roles-flujo-pedidos-v1 bloques A-D PASS, rollback total
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{}', true);

insert into orders (id, fecha, hora, canal, customer_id, pago, comprobante, estado, pagado_en, obs)
values
  ('P-RBAC-1', current_date, localtime, 'Directo', (select id from customers order by id limit 1), 'Nequi', true, 'Pagado', now(), '[TEST RBAC FLUJO]'),
  ('P-RBAC-2', current_date, localtime, 'Directo', (select id from customers order by id limit 1), 'Nequi', false, 'Pendiente de pago', null, '[TEST RBAC PAGO]');

insert into evidences (id, order_id, tipo, storage_path, user_id)
values
  ('E-RBAC-1', 'P-RBAC-1', 'Caja abierta', 'tests/rbac/caja-abierta.jpg', 'U01'),
  ('E-RBAC-2', 'P-RBAC-1', 'Caja cerrada con sello', 'tests/rbac/sello.jpg', 'U01'),
  ('E-RBAC-3', 'P-RBAC-2', 'Comprobante de pago', 'tests/rbac/pago.jpg', 'U01');

select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);

do $$
declare
  r jsonb;
  v_err boolean;
  v_msg text;
  v_cajero text;
  v_coord text;
begin
  -- A. Matriz pura, incluido fail-closed.
  assert order_intake_role_allowed('Administrador'), 'A1 admin agenda';
  assert order_intake_role_allowed('Cajero'), 'A2 cajero agenda';
  assert order_intake_role_allowed('Coordinador de pedidos'), 'A3 coordinador agenda';
  assert order_intake_role_allowed('Empaque'), 'A4 empaque puede agendar';
  assert order_intake_role_allowed('Cocina') is false, 'A5 cocina no agenda';
  assert order_intake_role_allowed(null) is null, 'A6 helper puro conserva NULL y el gate usa IS NOT TRUE';
  assert order_transition_role_allowed('Cocina','Pagado','En producción',false), 'A7 Cocina inicia';
  assert order_transition_role_allowed('Administrador','Pagado','En producción',false), 'A8 admin respalda Cocina';
  assert order_transition_role_allowed('Cocina','En producción','Listo para empaque',false), 'A9 Cocina entrega a Empaque';
  assert order_transition_role_allowed('Empaque','En producción','Listo para empaque',false) is false, 'A9b Empaque no suplanta Cocina';
  assert order_transition_role_allowed('Empaque','Listo para empaque','Empacado',false), 'A10 Empaque confirma empaque';
  assert order_transition_role_allowed('Cocina','Listo para empaque','Empacado',false) is false, 'A10b Cocina no suplanta Empaque';
  assert order_transition_role_allowed('Logística','Listo para despacho','En ruta',false), 'A11 Logística despacha';
  assert order_transition_role_allowed('Administrador','En producción','Listo para empaque',false), 'A11b admin respalda Cocina';
  assert order_transition_role_allowed('Administrador','Listo para empaque','Empacado',false), 'A11bb admin respalda Empaque';
  assert order_transition_role_allowed('Administrador','Listo para despacho','En ruta',false), 'A11c admin respalda Logística';
  assert order_transition_role_allowed('Administrador','En ruta','Entregado',false), 'A11d admin completa entrega';
  assert order_evidence_role_allowed('Cajero','Comprobante de pago'), 'A12 Caja carga comprobante';
  assert order_evidence_role_allowed('Empaque','Caja abierta'), 'A13 Empaque carga caja';
  assert order_evidence_role_allowed('Administrador','Caja abierta'), 'A14 admin captura evidencia al respaldar Empaque';

  -- B. Wrapper real de estados: Admin puede cubrir Cocina y Empaque sin saltar gates.
  update users set rol = 'Administrador' where id = 'U01';
  r := set_order_status('P-RBAC-1','En producción',false);
  assert (r->>'a') = 'En producción', 'B1 Admin inicia producción';
  r := set_order_status('P-RBAC-1','Listo para empaque',false);
  assert (r->>'a') = 'Listo para empaque', 'B2 Admin entrega a Empaque';
  r := set_order_status('P-RBAC-1','Empacado',false);
  assert (r->>'a') = 'Empacado', 'B2b Admin confirma Empacado con evidencias';
  r := set_order_status('P-RBAC-1','Listo para despacho',false);
  assert (r->>'a') = 'Listo para despacho', 'B3 Admin confirma Listo para despacho';

  update users set rol = 'Cocina' where id = 'U01';
  v_err := false; v_msg := '';
  begin r := set_order_status('P-RBAC-1','En ruta',false);
  exception when others then v_err := true; v_msg := sqlerrm; end;
  assert v_err and v_msg like '%no puede confirmar%', 'B4 Cocina no suplanta Logística';

  update users set rol = 'Empaque' where id = 'U01';

  -- C. Pago: Empaque puede agendar, pero Caja/Coordinación/Admin confirman pago.
  v_err := false;
  begin r := set_order_status('P-RBAC-2','Pagado',false);
  exception when others then v_err := true; end;
  assert v_err, 'C1 Empaque no confirma pago';
  update users set rol = 'Cajero' where id = 'U01';
  r := set_order_status('P-RBAC-2','Pagado',false);
  assert (r->>'a') = 'Pagado' and (select pagado_en is not null from orders where id = 'P-RBAC-2'), 'C2 Cajero confirma pago';

  -- D. Dominio de roles + gate de alta y de agendamiento.
  update users set rol = 'Administrador' where id = 'U01';
  r := crear_usuario_staff('Test Cajero RBAC','t-rbac-cajero@test.local','Cajero');
  v_cajero := r->>'id';
  r := crear_usuario_staff('Test Coord RBAC','t-rbac-coord@test.local','Coordinador de pedidos');
  v_coord := r->>'id';
  assert (select rol = 'Cajero' from users where id = v_cajero), 'D1 alta Cajero';
  assert (select rol = 'Coordinador de pedidos' from users where id = v_coord), 'D2 alta Coordinador';

  update users set rol = 'Cocina' where id = 'U01';
  v_err := false; v_msg := '';
  begin r := crear_pedido('{}'::jsonb);
  exception when others then v_err := true; v_msg := sqlerrm; end;
  assert v_err and v_msg like '%no puede agendar pedidos%', 'D3 Cocina se bloquea antes de validar payload';

  update users set rol = 'Empaque' where id = 'U01';
  v_err := false; v_msg := '';
  begin r := crear_pedido('{}'::jsonb);
  exception when others then v_err := true; v_msg := sqlerrm; end;
  assert v_err and v_msg not like '%no puede agendar pedidos%', 'D4 Empaque atraviesa el gate de agenda y llega a validación normal';

  update users set rol = 'Administrador' where id = 'U01';
  assert has_function_privilege('authenticated','public.set_order_status(text,text,boolean)','EXECUTE'), 'D5 authenticated ejecuta wrapper';
  assert not has_function_privilege('authenticated','public._set_order_status_core(text,text,boolean)','EXECUTE'), 'D6 core no es invocable por cliente';
  assert not has_function_privilege('authenticated','public._crear_pedido_core(jsonb)','EXECUTE'), 'D7 core de creación no es invocable por cliente';
  assert exists (select 1 from pg_trigger where tgname = 'orders_transition_role_guard' and not tgisinternal), 'D8 guard de tabla debe existir';
  assert exists (select 1 from pg_trigger where tgname = 'evidences_role_guard' and not tgisinternal), 'D9 guard de evidencia debe existir';

  raise exception 'TESTS_OK — roles-flujo-pedidos-v1 bloques A-D PASS, rollback total';
end $$;
