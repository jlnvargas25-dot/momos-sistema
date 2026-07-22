-- ============================================================================
-- MOMOS OPS — Batería de aceptación RE-EJECUTABLE · Variantes Etapa 1b
-- (venta FIFO por variante: FIFO simple por vencimiento, multi-lote, SABOR
--  y FIGURA como filtros duros, faltante exacto sin reserva fantasma,
--  liberación al cancelar, no-regresión
--  legacy sin lote_figuras, idempotencia de _reserve_inventory)
--
-- CÓMO CORRERLA: ejecutar este archivo COMPLETO como un solo script (vía MCP
-- execute_sql o SQL Editor). Patrón SIN RESIDUOS: transacción + JWT simulado
-- de U01 (Administrador) + DO con ASSERTs + RAISE final ⇒ ROLLBACK TOTAL. La
-- base queda EXACTAMENTE como estaba.
--
-- RESULTADO ESPERADO: el script TERMINA EN ERROR con el mensaje
-- «TESTS_OK — variantes-1b-fifo bloques A-G PASS, rollback total» ⇒ TODO
-- PASÓ. Cualquier OTRO error = un assert falló → leer su mensaje (A1..G5).
--
-- FIXTURES: 100% sintéticos, creados DENTRO de esta transacción con sufijo
-- 'Test 1b ...' — no dependen de datos reales del catálogo (a diferencia de
-- test-variantes.sql, que reusa figuras/productos existentes). Se apoyan en
-- UN product_cats existente (cualquiera — el nombre de la categoría no
-- afecta la lógica bajo prueba) y en customers/orders/order_items creados acá
-- mismo. La reserva/liberación se ejercita por la VÍA PÚBLICA REAL
-- (set_order_status → 'Pagado' / 'Cancelado', con comprobante+evidencia para
-- pasar el gate de pago): _reserve_inventory/_release_reservations tienen
-- revoke a authenticated (fix-grants-v1.sql) y NO son invocables directo —
-- ese blindaje es parte de lo que este test confirma de paso.
--
-- Requisitos mínimos: migraciones rpc-pedidos-v1.sql, normalizacion-
-- clientes-v1.sql, variantes-v1.sql y variantes-1b-fifo.sql aplicadas; U01 es
-- Administrador activo; existe al menos 1 fila en product_cats.
--
-- IDS DE FIXTURES: literales 'T1B-…' (prefijo inexistente en producción), NO
-- next_id() — next_id tiene revoke a authenticated (fix-grants-v1.sql) y este
-- DO corre como authenticated; además así los counters ni se rozan. Las RPCs
-- internas (reservas, sugerencias) sí usan next_id porque son security definer.
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  rec record;
  r jsonb;
  v_cat text;
  v_customer_id text;

  -- ---- Bloque A: FIFO simple (2 lotes, misma figura, distinto vencimiento) ----
  v_product_a text;
  v_batch_a1 text;  -- vence más lejos
  v_batch_a2 text;  -- vence más cerca → debe consumirse PRIMERO
  v_order_a text;
  v_item_a text;
  v_res_a record;

  -- ---- Bloque B: multi-lote (agota el primero, sigue al segundo) ----
  v_product_b text;
  v_batch_b1 text;
  v_batch_b2 text;
  v_order_b text;
  v_item_b text;
  v_cnt_reservas_b integer;
  v_sum_cant_b integer;

  -- ---- Bloque C: sabor + figura DUROS ----
  v_product_c text;
  v_batch_c_sabor_a text;  -- figura M, sabor A, vence PRIMERO (ganaría por FIFO puro Y por figura pedida)
  v_batch_c_sabor_b text;  -- figura R, sabor B: no puede cubrir figura M
  v_batch_c_fig_match text; -- figura M, sabor B: match exacto
  v_order_c1 text;
  v_item_c1 text;
  v_order_c2 text;  -- pedido con sabor inexistente → faltante a producir
  v_item_c2 text;
  v_order_c3 text;  -- figura exacta se antepone DENTRO del sabor aunque venza después
  v_item_c3 text;
  v_res_c record;
  v_c2_con_batch integer;
  v_c2_sin_batch integer;
  v_c2_cant_sin_batch numeric;

  -- ---- Bloque D: delta sin lote (cantidad > disponible) ----
  v_product_d text;
  v_batch_d text;
  v_order_d text;
  v_item_d text;
  v_stock_pre_d numeric;
  v_stock_post_d numeric;
  v_res_con_batch integer;
  v_res_sin_batch integer;
  v_cant_sin_batch numeric;

  -- ---- Bloque E: cancelar (liberar devuelve consumidas + stock) ----
  v_product_e text;
  v_batch_e text;
  v_order_e text;
  v_item_e text;
  v_consumidas_pre_e integer;
  v_consumidas_post_reserva_e integer;
  v_consumidas_post_liberar_e integer;
  v_stock_pre_e numeric;
  v_stock_post_reserva_e numeric;
  v_stock_post_liberar_e numeric;

  -- ---- Bloque F: legacy (stock sin filas lote_figuras) ----
  v_product_f text;
  v_order_f text;
  v_item_f text;
  v_stock_pre_f numeric;

  -- ---- Bloque G: idempotencia (_reserve_inventory dos veces, mismo pedido) ----
  v_product_g text;
  v_batch_g text;
  v_order_g text;
  v_item_g text;
  v_cnt_reservas_g1 integer;
  v_cnt_reservas_g2 integer;
  v_consumidas_g1 integer;
  v_consumidas_g2 integer;
begin
  select nombre into v_cat from product_cats limit 1;
  assert v_cat is not null, 'PRE0 debe existir al menos una categoría de producto (product_cats)';

  select id into v_customer_id from customers limit 1;
  if v_customer_id is null then
    v_customer_id := 'T1B-C1';
    insert into customers (id, nombre, telefono) values (v_customer_id, 'Test 1b cliente', '3000000000');
  end if;

  -- ==========================================================================
  -- A. FIFO SIMPLE: 2 lotes de la MISMA figura, distinto vencimiento → el pedido
  -- debe tomar del lote que vence MÁS PRÓXIMO primero.
  -- ==========================================================================
  v_product_a := 'T1B-PRA';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_a, 'Test 1b momo A', v_cat, 'momo', 'gato', 1000, 500, 0);

  v_batch_a1 := 'T1B-LA1';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_a1, current_date, v_product_a, 'FiguraA', 'SaborX', 10, 'Listo', true, current_date + 10);
  insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
  values (v_batch_a1, 'FiguraA', 10, 10, 0, 0);

  v_batch_a2 := 'T1B-LA2';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_a2, current_date, v_product_a, 'FiguraA', 'SaborX', 5, 'Listo', true, current_date + 2);
  insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
  values (v_batch_a2, 'FiguraA', 5, 5, 0, 0);

  update products set stock = 15 where id = v_product_a;  -- espeja el alta que desmoldar_lote ya habría hecho

  v_order_a := 'T1B-PA';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_a, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_a := 'T1B-ITA';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_a, v_order_a, v_product_a, 'Test 1b momo A', 'FiguraA', 'SaborX', 3, 1000, 500);

  insert into evidences (id, order_id, tipo, storage_path)
  values ('T1B-EA', v_order_a, 'Comprobante de pago', 'test/1b/a.jpg');
  r := set_order_status(v_order_a, 'Pagado', false);
  assert (r->>'ok')::boolean, 'A0 pagar el pedido A (vía pública set_order_status) debe suceder';

  assert (select count(*) from inventory_reservations where order_id = v_order_a and tipo = 'producto') = 1,
    'A1 debe crear exactamente 1 reserva (el pedido cabe entero en el lote más próximo a vencer)';
  select * into v_res_a from inventory_reservations where order_id = v_order_a and tipo = 'producto';
  assert v_res_a.batch_id = v_batch_a2, 'A2 debe consumir PRIMERO el lote que vence más próximo: esperado '||v_batch_a2||' fue '||v_res_a.batch_id;
  assert v_res_a.figura = 'FiguraA', 'A3 la reserva debe llevar la figura del lote consumido';
  assert v_res_a.cantidad = 3, 'A4 la cantidad reservada debe ser 3';

  assert (select consumidas from lote_figuras where batch_id = v_batch_a2 and figura = 'FiguraA') = 3,
    'A5 el lote más próximo a vencer debe quedar con consumidas=3';
  assert (select consumidas from lote_figuras where batch_id = v_batch_a1 and figura = 'FiguraA') = 0,
    'A6 el lote más lejano NO debe haberse tocado';

  assert (select disponibles from v_variantes_disponibles
          where product_id = v_product_a and figura = 'FiguraA' and sabor = 'SaborX') = 12,
    'A7 v_variantes_disponibles debe descontar lo consumido: esperado 12 (10+5-3)';

  -- ==========================================================================
  -- B. MULTI-LOTE: el pedido agota el lote 1 (vence primero) y sigue al lote 2.
  -- ==========================================================================
  v_product_b := 'T1B-PRB';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_b, 'Test 1b momo B', v_cat, 'momo', 'perro', 1000, 500, 0);

  v_batch_b1 := 'T1B-LB1';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_b1, current_date, v_product_b, 'FiguraB', 'SaborY', 4, 'Listo', true, current_date + 1);
  insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
  values (v_batch_b1, 'FiguraB', 4, 4, 0, 0);

  v_batch_b2 := 'T1B-LB2';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_b2, current_date, v_product_b, 'FiguraB', 'SaborY', 6, 'Listo', true, current_date + 5);
  insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
  values (v_batch_b2, 'FiguraB', 6, 6, 0, 0);

  update products set stock = 10 where id = v_product_b;

  v_order_b := 'T1B-PB';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_b, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_b := 'T1B-ITB';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_b, v_order_b, v_product_b, 'Test 1b momo B', 'FiguraB', 'SaborY', 7, 1000, 500);

  insert into evidences (id, order_id, tipo, storage_path)
  values ('T1B-EB', v_order_b, 'Comprobante de pago', 'test/1b/b.jpg');
  r := set_order_status(v_order_b, 'Pagado', false);
  assert (r->>'ok')::boolean, 'B0 pagar el pedido B (vía pública set_order_status) debe suceder';

  select count(*), coalesce(sum(cantidad),0) into v_cnt_reservas_b, v_sum_cant_b
  from inventory_reservations where order_id = v_order_b and tipo = 'producto';
  assert v_cnt_reservas_b = 2, 'B1 debe crear 2 filas de reserva (una por lote tocado): hubo '||v_cnt_reservas_b;
  assert v_sum_cant_b = 7, 'B2 la suma de cantidades reservadas debe ser 7: fue '||v_sum_cant_b;

  assert (select cantidad from inventory_reservations where order_id = v_order_b and batch_id = v_batch_b1) = 4,
    'B3 el lote 1 (agotado) debe aportar sus 4 unidades completas';
  assert (select cantidad from inventory_reservations where order_id = v_order_b and batch_id = v_batch_b2) = 3,
    'B4 el lote 2 debe aportar el resto (7-4=3)';
  assert (select consumidas from lote_figuras where batch_id = v_batch_b1 and figura = 'FiguraB') = 4,
    'B5 el lote 1 debe quedar 100%% consumido';
  assert (select consumidas from lote_figuras where batch_id = v_batch_b2 and figura = 'FiguraB') = 3,
    'B6 el lote 2 debe quedar parcialmente consumido (3 de 6)';

  -- ==========================================================================
  -- C. SABOR + FIGURA DUROS:
  --   C1: el pedido pide figura M + sabor B; hay figura M SOLO en sabor A
  --       (vence primero) y figura R en sabor B (vence después) → debe tomar
  --       R/B: ninguna sirve porque ambas dimensiones deben coincidir.
  --   C2: sabor inexistente → cursor vacío → faltante completo a producir,
  --       sin consumir stock agregado anterior.
  --   C3: al aparecer M/B, el match exacto sí se reserva por FIFO.
  -- ==========================================================================
  v_product_c := 'T1B-PRC';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_c, 'Test 1b momo C', v_cat, 'momo', 'gato', 1000, 500, 0);

  v_batch_c_sabor_a := 'T1B-LCA';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_c_sabor_a, current_date, v_product_c, 'FiguraCM', 'Sabor Test1bA', 5, 'Listo', true, current_date + 1);
  insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
  values (v_batch_c_sabor_a, 'FiguraCM', 5, 5, 0, 0);

  v_batch_c_sabor_b := 'T1B-LCB';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_c_sabor_b, current_date, v_product_c, 'FiguraCR', 'Sabor Test1bB', 5, 'Listo', true, current_date + 20);
  insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
  values (v_batch_c_sabor_b, 'FiguraCR', 5, 5, 0, 0);

  update products set stock = 10 where id = v_product_c;

  -- C1: figura M + sabor B pedidos. Ni M/A ni R/B pueden sustituir M/B.
  v_order_c1 := 'T1B-PC1';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_c1, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_c1 := 'T1B-ITC1';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_c1, v_order_c1, v_product_c, 'Test 1b momo C', 'FiguraCM', 'Sabor Test1bB', 2, 1000, 500);

  insert into evidences (id, order_id, tipo, storage_path)
  values ('T1B-EC1', v_order_c1, 'Comprobante de pago', 'test/1b/c1.jpg');
  r := set_order_status(v_order_c1, 'Pagado', false);
  assert (r->>'ok')::boolean, 'C0 pagar el pedido C1 (vía pública set_order_status) debe suceder';

  assert (select count(*) from inventory_reservations where order_id = v_order_c1 and tipo = 'producto') = 0,
    'C1 figura+sabor duros: no debe reservar otra figura ni stock agregado anterior';
  assert (select cantidad from production_suggestions where order_id = v_order_c1 and product_id = v_product_c) = 2,
    'C1b debe crear un faltante exacto de 2 para Producción';
  assert (select consumidas from lote_figuras where batch_id = v_batch_c_sabor_a and figura = 'FiguraCM') = 0,
    'C1c el lote de sabor A (figura pedida, vence antes) NO debe haberse tocado — el sabor no se sustituye';

  -- C2: sabor inexistente → no hay reserva con ni sin lote; el stock general
  -- queda intacto y Producción recibe el faltante.
  v_order_c2 := 'T1B-PC2';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_c2, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_c2 := 'T1B-ITC2';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_c2, v_order_c2, v_product_c, 'Test 1b momo C', 'FiguraCM', 'Sabor que no existe', 1, 1000, 500);

  insert into evidences (id, order_id, tipo, storage_path)
  values ('T1B-EC2', v_order_c2, 'Comprobante de pago', 'test/1b/c2.jpg');
  r := set_order_status(v_order_c2, 'Pagado', false);
  assert (r->>'ok')::boolean, 'C0b pagar el pedido C2 (vía pública set_order_status) debe suceder';

  select count(*) filter (where batch_id is not null), count(*) filter (where batch_id is null),
         coalesce(sum(cantidad) filter (where batch_id is null), 0)
    into v_c2_con_batch, v_c2_sin_batch, v_c2_cant_sin_batch
  from inventory_reservations where order_id = v_order_c2 and tipo = 'producto';
  assert v_c2_con_batch = 0,
    'C2 sabor inexistente NO debe asignar ningún lote (fin del fallback de sabor): hubo '||v_c2_con_batch||' reserva(s) con batch';
  assert v_c2_sin_batch = 0 and v_c2_cant_sin_batch = 0,
    'C2b una variante exacta jamás debe crear reserva agregada sin lote: filas='||v_c2_sin_batch||' cant='||v_c2_cant_sin_batch;
  assert (select cantidad from production_suggestions where order_id = v_order_c2 and product_id = v_product_c) = 1,
    'C2c el sabor inexistente debe crear un faltante de 1';
  assert (select consumidas from lote_figuras where batch_id = v_batch_c_sabor_a and figura = 'FiguraCM') = 0
     and (select consumidas from lote_figuras where batch_id = v_batch_c_sabor_b and figura = 'FiguraCR') = 0,
    'C2d ningún lote debe consumirse por una combinación distinta';

  -- C3: solo el lote de figura+sabor exactos puede cubrir el pedido.
  v_batch_c_fig_match := 'T1B-LCC';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_c_fig_match, current_date, v_product_c, 'FiguraCM', 'Sabor Test1bB', 4, 'Listo', true, current_date + 30);
  insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
  values (v_batch_c_fig_match, 'FiguraCM', 4, 4, 0, 0);
  update products set stock = stock + 4 where id = v_product_c;

  v_order_c3 := 'T1B-PC3';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_c3, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_c3 := 'T1B-ITC3';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_c3, v_order_c3, v_product_c, 'Test 1b momo C', 'FiguraCM', 'Sabor Test1bB', 1, 1000, 500);

  insert into evidences (id, order_id, tipo, storage_path)
  values ('T1B-EC3', v_order_c3, 'Comprobante de pago', 'test/1b/c3.jpg');
  r := set_order_status(v_order_c3, 'Pagado', false);
  assert (r->>'ok')::boolean, 'C0c pagar el pedido C3 (vía pública set_order_status) debe suceder';

  select * into v_res_c from inventory_reservations where order_id = v_order_c3 and tipo = 'producto';
  assert v_res_c.batch_id = v_batch_c_fig_match,
    'C3 dentro del sabor pedido, la figura exacta debe anteponerse aunque venza después: esperado '||v_batch_c_fig_match||' fue '||v_res_c.batch_id;
  assert (select consumidas from lote_figuras where batch_id = v_batch_c_sabor_b and figura = 'FiguraCR') = 0,
    'C3b el lote de otra figura del mismo sabor no debe consumirse';

  -- ==========================================================================
  -- D. DELTA EXACTO: cantidad pedida > variante exacta disponible → solo se
  -- reserva lo trazable; el resto conserva el stock general y va a Producción.
  -- ==========================================================================
  v_product_d := 'T1B-PRD';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_d, 'Test 1b momo D', v_cat, 'momo', 'gato', 1000, 500, 0);

  v_batch_d := 'T1B-LD';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_d, current_date, v_product_d, 'FiguraD', 'SaborD', 2, 'Listo', true, current_date + 1);
  insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
  values (v_batch_d, 'FiguraD', 2, 2, 0, 0);

  -- Stock de products deliberadamente MAYOR que lo desmoldado en lote_figuras
  -- (simula producir-a-pedido: el resto vino de otra vía / ajuste manual).
  v_stock_pre_d := 5;
  update products set stock = v_stock_pre_d where id = v_product_d;

  v_order_d := 'T1B-PD';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_d, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_d := 'T1B-ITD';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_d, v_order_d, v_product_d, 'Test 1b momo D', 'FiguraD', 'SaborD', 5, 1000, 500);

  insert into evidences (id, order_id, tipo, storage_path)
  values ('T1B-ED', v_order_d, 'Comprobante de pago', 'test/1b/d.jpg');
  r := set_order_status(v_order_d, 'Pagado', false);
  assert (r->>'ok')::boolean, 'D0 pagar el pedido D (vía pública set_order_status) debe suceder';

  select stock into v_stock_post_d from products where id = v_product_d;
  assert v_stock_post_d = v_stock_pre_d - 2, 'D1 products.stock debe bajar solo por las 2 unidades exactas trazables: pre='||v_stock_pre_d||' post='||v_stock_post_d;

  select count(*) filter (where batch_id is not null), count(*) filter (where batch_id is null),
         coalesce(sum(cantidad) filter (where batch_id is null), 0)
    into v_res_con_batch, v_res_sin_batch, v_cant_sin_batch
  from inventory_reservations where order_id = v_order_d and tipo = 'producto';
  assert v_res_con_batch = 1, 'D2 debe haber exactamente 1 reserva CON batch (cubrió las 2 del lote)';
  assert v_res_sin_batch = 0, 'D3 no debe haber reserva fantasma sin batch para una variante exacta';
  assert v_cant_sin_batch = 0, 'D4 el remanente no se reserva: va a Producción';
  assert (select cantidad from production_suggestions where order_id = v_order_d and product_id = v_product_d) = 3,
    'D5 debe crear sugerencia por las 3 unidades exactas faltantes';

  -- ==========================================================================
  -- E. CANCELAR: liberar una reserva CON batch_id debe devolver `consumidas`
  -- al lote/figura exactos, además de products.stock (comportamiento ya
  -- existente). Las reservas quedan en estado 'Liberada'.
  -- ==========================================================================
  v_product_e := 'T1B-PRE';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_e, 'Test 1b momo E', v_cat, 'momo', 'perro', 1000, 500, 0);

  v_batch_e := 'T1B-LE';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_e, current_date, v_product_e, 'FiguraE', 'SaborE', 8, 'Listo', true, current_date + 3);
  insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
  values (v_batch_e, 'FiguraE', 8, 8, 0, 0);
  update products set stock = 8 where id = v_product_e;

  v_order_e := 'T1B-PE';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_e, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_e := 'T1B-ITE';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_e, v_order_e, v_product_e, 'Test 1b momo E', 'FiguraE', 'SaborE', 5, 1000, 500);

  select consumidas into v_consumidas_pre_e from lote_figuras where batch_id = v_batch_e and figura = 'FiguraE';
  select stock into v_stock_pre_e from products where id = v_product_e;

  insert into evidences (id, order_id, tipo, storage_path)
  values ('T1B-EE', v_order_e, 'Comprobante de pago', 'test/1b/e.jpg');
  r := set_order_status(v_order_e, 'Pagado', false);
  assert (r->>'ok')::boolean, 'E0 pagar el pedido E (vía pública set_order_status) debe suceder';

  select consumidas into v_consumidas_post_reserva_e from lote_figuras where batch_id = v_batch_e and figura = 'FiguraE';
  select stock into v_stock_post_reserva_e from products where id = v_product_e;
  assert v_consumidas_post_reserva_e = v_consumidas_pre_e + 5, 'E1 tras reservar, consumidas debe subir en 5';
  assert v_stock_post_reserva_e = v_stock_pre_e - 5, 'E2 tras reservar, stock debe bajar en 5';

  r := set_order_status(v_order_e, 'Cancelado', false);
  assert (r->>'ok')::boolean, 'E2b cancelar el pedido E (vía pública set_order_status) debe suceder';

  select consumidas into v_consumidas_post_liberar_e from lote_figuras where batch_id = v_batch_e and figura = 'FiguraE';
  select stock into v_stock_post_liberar_e from products where id = v_product_e;
  assert v_consumidas_post_liberar_e = v_consumidas_pre_e,
    'E3 tras liberar, consumidas debe volver EXACTAMENTE al valor pre-reserva: esperado '||v_consumidas_pre_e||' fue '||v_consumidas_post_liberar_e;
  assert v_stock_post_liberar_e = v_stock_pre_e,
    'E4 tras liberar, products.stock debe volver EXACTAMENTE al valor pre-reserva: esperado '||v_stock_pre_e||' fue '||v_stock_post_liberar_e;
  assert (select count(*) from inventory_reservations where order_id = v_order_e and estado = 'Liberada') =
         (select count(*) from inventory_reservations where order_id = v_order_e),
    'E5 TODAS las reservas del pedido deben quedar en estado Liberada';
  assert not exists (select 1 from inventory_reservations where order_id = v_order_e and estado = 'Reservada'),
    'E6 no debe quedar ninguna reserva en estado Reservada tras liberar';

  -- ==========================================================================
  -- F. LEGACY: producto con products.stock pero SIN ninguna fila en
  -- lote_figuras (lote pre-1a, o simplemente sin desmolde registrado por
  -- figura) → debe comportarse EXACTAMENTE como antes de este slice: una
  -- única reserva agregada, SIN batch_id ni figura.
  -- ==========================================================================
  v_product_f := 'T1B-PRF';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_f, 'Test 1b momo F legacy', v_cat, 'momo', 'gato', 1000, 500, 6);
  v_stock_pre_f := 6;
  -- Deliberadamente CERO filas en lote_figuras para este producto.

  v_order_f := 'T1B-PF';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_f, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_f := 'T1B-ITF';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_f, v_order_f, v_product_f, 'Test 1b momo F legacy', '', '', 4, 1000, 500);

  insert into evidences (id, order_id, tipo, storage_path)
  values ('T1B-EF', v_order_f, 'Comprobante de pago', 'test/1b/f.jpg');
  r := set_order_status(v_order_f, 'Pagado', false);
  assert (r->>'ok')::boolean, 'F0 pagar el pedido F (vía pública set_order_status) debe suceder';

  assert (select count(*) from inventory_reservations where order_id = v_order_f and tipo = 'producto') = 1,
    'F1 legacy sin lote_figuras debe crear UNA sola reserva agregada';
  assert (select batch_id from inventory_reservations where order_id = v_order_f and tipo = 'producto') is null,
    'F2 la reserva legacy no debe llevar batch_id';
  assert (select figura from inventory_reservations where order_id = v_order_f and tipo = 'producto') is null,
    'F3 la reserva legacy no debe llevar figura';
  assert (select cantidad from inventory_reservations where order_id = v_order_f and tipo = 'producto') = 4,
    'F4 la cantidad reservada debe ser el total pedido (4)';
  assert (select stock from products where id = v_product_f) = v_stock_pre_f - 4,
    'F5 products.stock debe bajar por el total, igual que el comportamiento pre-1b';

  -- ==========================================================================
  -- G. IDEMPOTENCIA: re-disparar _reserve_inventory sobre el MISMO pedido ya
  -- reservado no debe duplicar reservas ni volver a consumir del lote — este
  -- test ejercita el ciclo end-to-end vía set_order_status: la idempotencia
  -- real la da el flag orders.inventario_reservado que set_order_status
  -- chequea ANTES de llamar a _reserve_inventory (efecto [Pagado] y red #7).
  -- Se verifica que ese guard sigue siendo la única puerta y que un no-op de
  -- estado no re-consume del lote.
  -- ==========================================================================
  v_product_g := 'T1B-PRG';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_g, 'Test 1b momo G', v_cat, 'momo', 'perro', 1000, 500, 0);

  v_batch_g := 'T1B-LG';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_g, current_date, v_product_g, 'FiguraG', 'SaborG', 9, 'Listo', true, current_date + 4);
  insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
  values (v_batch_g, 'FiguraG', 9, 9, 0, 0);
  update products set stock = 9 where id = v_product_g;

  v_order_g := 'T1B-PG';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_g, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_g := 'T1B-ITG';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_g, v_order_g, v_product_g, 'Test 1b momo G', 'FiguraG', 'SaborG', 3, 1000, 500);
  insert into evidences (id, order_id, tipo, storage_path)
  values ('T1B-E1', v_order_g, 'Comprobante de pago', 'test/1b/g.jpg');

  r := set_order_status(v_order_g, 'Pagado', false);
  assert (r->>'ok')::boolean, 'G0 set_order_status a Pagado debe suceder (fixture de precondición)';

  select count(*) into v_cnt_reservas_g1 from inventory_reservations where order_id = v_order_g and tipo = 'producto';
  select consumidas into v_consumidas_g1 from lote_figuras where batch_id = v_batch_g and figura = 'FiguraG';
  assert v_cnt_reservas_g1 = 1, 'G1 primera reserva vía Pagado debe crear 1 fila';
  assert v_consumidas_g1 = 3, 'G1b primera reserva debe consumir 3 del lote';

  -- Re-disparar el mismo camino: set_order_status respeta el no-op de estado
  -- y orders.inventario_reservado — no debe volver a llamar _reserve_inventory.
  r := set_order_status(v_order_g, 'Pagado', false);
  assert (r->>'ok')::boolean, 'G2 re-disparar el mismo estado debe ser no-op (rama "mismo estado" de set_order_status)';

  select count(*) into v_cnt_reservas_g2 from inventory_reservations where order_id = v_order_g and tipo = 'producto';
  select consumidas into v_consumidas_g2 from lote_figuras where batch_id = v_batch_g and figura = 'FiguraG';
  assert v_cnt_reservas_g2 = v_cnt_reservas_g1,
    'G3 el no-op de set_order_status NO debe crear reservas nuevas: antes '||v_cnt_reservas_g1||' después '||v_cnt_reservas_g2;
  assert v_consumidas_g2 = v_consumidas_g1,
    'G4 el no-op de set_order_status NO debe volver a consumir del lote: antes '||v_consumidas_g1||' después '||v_consumidas_g2;

  assert (select inventario_reservado from orders where id = v_order_g),
    'G5 el flag inventario_reservado debe quedar en true (es la puerta real de idempotencia end-to-end)';

  raise exception 'TESTS_OK — variantes-1b-fifo bloques A-G PASS, rollback total';
end $$;
