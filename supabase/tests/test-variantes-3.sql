-- ============================================================================
-- MOMOS OPS — Batería de aceptación RE-EJECUTABLE · Variantes Etapa 3
-- (colchón de sobre-producción por producto: RPC set_colchon_produccion con
--  gate admin, validaciones, audit, y el invariante clave — el colchón es
--  ADVISORY: no toca la cantidad de las sugerencias ni la cola)
--
-- CÓMO CORRERLA: script completo en una transacción; termina SIEMPRE en error
-- «TESTS_OK — variantes-3-colchon bloques A-C PASS, rollback total» ⇒ PASS.
-- Fixtures sintéticos 'T3C-*'. Requiere migraciones hasta variantes-3-colchon
-- aplicadas; U01 Administrador activo.
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  r jsonb;
  v_cat text;
  v_customer_id text;
  v_product text := 'T3C-PR1';
  v_combo text := 'T3C-CB1';
  v_order text := 'T3C-P1';
  v_item text := 'T3C-IT1';
  v_empaque text;
  v_err boolean;
begin
  select nombre into v_cat from product_cats limit 1;
  assert v_cat is not null, 'PRE0 debe existir al menos una categoría';
  select id into v_customer_id from customers limit 1;
  if v_customer_id is null then
    v_customer_id := 'T3C-C1';
    insert into customers (id, nombre, telefono) values (v_customer_id, 'Test 3 cliente', '3000000000');
  end if;

  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product, 'Test 3 momo', v_cat, 'momo', 'gato', 1000, 500, 0);
  -- El CHECK combo_completo exige combo_size + empaque: se reusa cualquier
  -- insumo existente como empaque del fixture (solo para pasar el CHECK).
  select id into v_empaque from inventory_items limit 1;
  assert v_empaque is not null, 'PRE1 debe existir al menos un inventory_item para el empaque del combo fixture';
  insert into products (id, nombre, cat, tipo, precio, costo, combo_size, empaque_item_id)
  values (v_combo, 'Test 3 combo', v_cat, 'combo', 5000, 2000, 3, v_empaque);

  -- ==========================================================================
  -- A. HAPPY PATH: admin setea colchón → valor + audit; repetir el mismo
  -- valor es no-op (cambio=false, sin audit duplicado).
  -- ==========================================================================
  assert (select colchon_produccion from products where id = v_product) = 0,
    'A0 el default del colchón debe ser 0';

  r := set_colchon_produccion(v_product, 3);
  assert (r->>'ok')::boolean and (r->>'colchon')::integer = 3 and (r->>'cambio')::boolean,
    'A1 setear colchón=3 debe suceder y reportar cambio';
  assert (select colchon_produccion from products where id = v_product) = 3,
    'A2 la columna debe quedar en 3';
  assert exists (select 1 from audit_logs where entidad = 'Producto' and entidad_id = v_product
                 and accion = 'Colchón de producción actualizado' and de = '0' and a like '3 %'),
    'A3 debe quedar el audit con de=0 → a=3';

  r := set_colchon_produccion(v_product, 3);
  assert (r->>'ok')::boolean and not (r->>'cambio')::boolean,
    'A4 repetir el mismo valor es no-op (cambio=false)';
  assert (select count(*) from audit_logs where entidad = 'Producto' and entidad_id = v_product
          and accion = 'Colchón de producción actualizado') = 1,
    'A5 el no-op no debe duplicar el audit';

  -- ==========================================================================
  -- B. VALIDACIONES: negativo, producto inexistente y combo se rechazan.
  -- ==========================================================================
  v_err := false;
  begin
    r := set_colchon_produccion(v_product, -1);
  exception when others then
    v_err := true;
  end;
  assert v_err, 'B1 colchón negativo debe rechazarse';

  v_err := false;
  begin
    r := set_colchon_produccion('T3C-NOEXISTE', 2);
  exception when others then
    v_err := true;
  end;
  assert v_err, 'B2 producto inexistente debe rechazarse';

  v_err := false;
  begin
    r := set_colchon_produccion(v_combo, 2);
  exception when others then
    v_err := true;
  end;
  assert v_err, 'B3 el colchón no aplica a combos';
  assert (select colchon_produccion from products where id = v_product) = 3,
    'B4 los rechazos no deben haber tocado el valor vigente';

  -- ==========================================================================
  -- C. ADVISORY: el colchón NO toca la contabilidad — un pedido pagado sin
  -- stock crea su sugerencia por lo adeudado EXACTO (la cola de Etapa 2
  -- asigna contra ese número), con o sin colchón configurado.
  -- ==========================================================================
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item, v_order, v_product, 'Test 3 momo', 'FigT3', 'SaborT3', 2, 1000, 500);
  insert into evidences (id, order_id, tipo, storage_path)
  values ('T3C-E1', v_order, 'Comprobante de pago', 'test/3c/1.jpg');
  r := set_order_status(v_order, 'Pagado', false);
  assert (r->>'ok')::boolean, 'C0 pagar debe suceder';

  assert (select cantidad from production_suggestions where order_id = v_order and product_id = v_product) = 2,
    'C1 la sugerencia debe pedir lo adeudado EXACTO (2), sin sumar el colchón (3) — el colchón es advisory del front';

  -- ==========================================================================
  -- D. GATE DE SEGURIDAD (hallazgo del Juez A): un usuario NO admin debe ser
  -- rechazado por is_admin(). Se simula con un sub que NO existe en users —
  -- para is_admin() un desconocido y un empleado no-admin son lo mismo: no
  -- admin. El valor vigente no debe moverse.
  -- ==========================================================================
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}', true);
  v_err := false;
  begin
    r := set_colchon_produccion(v_product, 9);
  exception when others then
    v_err := true;
  end;
  assert v_err, 'D1 un usuario no-admin debe ser rechazado por el gate is_admin()';
  -- Restaurar el JWT admin para los asserts finales
  perform set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
  assert (select colchon_produccion from products where id = v_product) = 3,
    'D2 el rechazo del no-admin no debe haber tocado el valor (queda en 3)';

  raise exception 'TESTS_OK — variantes-3-colchon bloques A-D PASS, rollback total';
end $$;
