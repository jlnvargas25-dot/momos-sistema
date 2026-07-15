-- ============================================================================
-- MOMOS OPS — Batería de aceptación RE-EJECUTABLE · Variantes Etapa 2
-- (reservas contra producción: la cola de sugerencias pendientes se atiende
--  automáticamente al desmoldar — FIFO por pagado_en, sabor y figura duros,
--  cobertura parcial, pedidos fuera de flujo saltados, ciclo de
--  cancelación devuelve stock+consumidas)
--
-- CÓMO CORRERLA: ejecutar este archivo COMPLETO como un solo script. Patrón
-- SIN RESIDUOS: transacción + JWT simulado de U01 (Administrador) + DO con
-- ASSERTs + RAISE final ⇒ ROLLBACK TOTAL.
--
-- RESULTADO ESPERADO: el script TERMINA EN ERROR con el mensaje
-- «TESTS_OK — variantes-2-cola bloques A-F PASS, rollback total» ⇒ TODO PASÓ.
--
-- FIXTURES: 100% sintéticos con prefijo 'T2C-'. La reserva/pago va por la VÍA
-- PÚBLICA REAL (set_order_status con comprobante+evidencia); el desmolde por
-- la RPC pública desmoldar_lote (grant a authenticated + is_staff) — NO se
-- pre-insertan filas en lote_figuras: el desmolde es la única puerta.
--
-- Requisitos: migraciones hasta variantes-2-cola.sql aplicadas; U01 es
-- Administrador activo; existe al menos 1 fila en product_cats.
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  r jsonb;
  v_cat text;
  v_customer_id text;

  -- ---- Bloque A: cola simple (pedido espera → desmolde lo cubre) ----
  v_product_a text; v_order_a text; v_item_a text; v_batch_a text;
  v_sug_a record; v_res_a record;

  -- ---- Bloque B: sabor duro en la cola ----
  v_product_b text; v_order_b text; v_item_b text; v_batch_b1 text; v_batch_b2 text; v_batch_b3 text;

  -- ---- Bloque C: figura exacta en lote mixto ----
  v_product_c text; v_order_c text; v_item_c text; v_batch_c text;

  -- ---- Bloque D: FIFO por pagado_en + cobertura parcial ----
  v_product_d text; v_order_d1 text; v_item_d1 text; v_order_d2 text; v_item_d2 text; v_batch_d text;

  -- ---- Bloque E: pedidos fuera de flujo no se atienden ----
  v_product_e text; v_order_e text; v_item_e text; v_batch_e text;

  -- ---- Bloque F: cancelar un pedido atendido devuelve todo ----
  v_product_f text; v_order_f text; v_item_f text; v_batch_f text;
begin
  select nombre into v_cat from product_cats limit 1;
  assert v_cat is not null, 'PRE0 debe existir al menos una categoría de producto';

  select id into v_customer_id from customers limit 1;
  if v_customer_id is null then
    v_customer_id := 'T2C-C1';
    insert into customers (id, nombre, telefono) values (v_customer_id, 'Test 2 cliente', '3000000000');
  end if;

  -- ==========================================================================
  -- A. COLA SIMPLE: pedido pagado con stock 0 → sugerencia Pendiente con
  -- order_item_id y CERO reservas. Desmolde del sabor/figura pedidos →
  -- reserva con lote, consumidas, stock neto = perfectas − asignadas,
  -- sugerencia Atendida, asignadas_cola en el retorno.
  -- ==========================================================================
  v_product_a := 'T2C-PRA';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_a, 'Test 2 momo A', v_cat, 'momo', 'gato', 1000, 500, 0);

  v_order_a := 'T2C-PA';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_a, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_a := 'T2C-ITA';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_a, v_order_a, v_product_a, 'Test 2 momo A', 'FiguraA2', 'SaborA2', 3, 1000, 500);
  insert into evidences (id, order_id, tipo, storage_path)
  values ('T2C-EA', v_order_a, 'Comprobante de pago', 'test/2c/a.jpg');
  r := set_order_status(v_order_a, 'Pagado', false);
  assert (r->>'ok')::boolean, 'A0 pagar el pedido A debe suceder (la venta procede sin stock)';

  assert (select count(*) from inventory_reservations where order_id = v_order_a and tipo = 'producto') = 0,
    'A1 con stock 0 no debe nacer NINGUNA reserva de producto (solo la sugerencia)';
  select * into v_sug_a from production_suggestions
  where order_id = v_order_a and product_id = v_product_a and area = 'Producción';
  assert v_sug_a.id is not null and v_sug_a.estado = 'Pendiente' and v_sug_a.cantidad = 3,
    'A2 debe existir la sugerencia Pendiente por 3';
  assert v_sug_a.order_item_id = v_item_a,
    'A3 la sugerencia debe recordar el order_item (variante pedida): fue '||coalesce(v_sug_a.order_item_id,'null');

  v_batch_a := 'T2C-LA';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_a, current_date, v_product_a, 'FiguraA2', 'SaborA2', 5, 'Congelando', false, current_date + 5);
  r := desmoldar_lote(v_batch_a, 5, 0, 0);
  assert (r->>'ok')::boolean, 'A4 el desmolde debe suceder';
  assert (r->>'asignadas_cola')::integer = 3, 'A5 el desmolde debe reportar 3 asignadas a la cola: fue '||(r->>'asignadas_cola');

  select * into v_res_a from inventory_reservations where order_id = v_order_a and tipo = 'producto';
  assert v_res_a.batch_id = v_batch_a and v_res_a.figura = 'FiguraA2' and v_res_a.cantidad = 3 and v_res_a.estado = 'Reservada',
    'A6 la reserva de la cola debe nacer con lote/figura/cantidad exactos';
  assert (select consumidas from lote_figuras where batch_id = v_batch_a and figura = 'FiguraA2') = 3,
    'A7 el lote debe quedar con consumidas=3';
  assert (select stock from products where id = v_product_a) = 2,
    'A8 stock neto del desmolde = perfectas − asignadas = 5−3 = 2 (la cola gana al mostrador)';
  assert (select estado from production_suggestions where id = v_sug_a.id) = 'Atendida',
    'A9 la sugerencia debe quedar Atendida';

  -- ==========================================================================
  -- B. SABOR + FIGURA DUROS: ni otro sabor ni otra figura atienden la espera.
  -- ==========================================================================
  v_product_b := 'T2C-PRB';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_b, 'Test 2 momo B', v_cat, 'momo', 'perro', 1000, 500, 0);

  v_order_b := 'T2C-PB';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_b, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_b := 'T2C-ITB';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_b, v_order_b, v_product_b, 'Test 2 momo B', 'FiguraB2', 'Sabor T2CB', 2, 1000, 500);
  insert into evidences (id, order_id, tipo, storage_path)
  values ('T2C-EB', v_order_b, 'Comprobante de pago', 'test/2c/b.jpg');
  r := set_order_status(v_order_b, 'Pagado', false);
  assert (r->>'ok')::boolean, 'B0 pagar el pedido B debe suceder';

  v_batch_b1 := 'T2C-LB1';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_b1, current_date, v_product_b, 'FiguraB2', 'Sabor T2C-Otro', 3, 'Congelando', false, current_date + 5);
  r := desmoldar_lote(v_batch_b1, 3, 0, 0);
  assert (r->>'asignadas_cola')::integer = 0,
    'B1 un lote de OTRO sabor NO debe atender la cola (sabor duro): asignó '||(r->>'asignadas_cola');
  assert (select estado from production_suggestions where order_id = v_order_b) = 'Pendiente',
    'B2 la sugerencia debe seguir Pendiente';
  assert (select consumidas from lote_figuras where batch_id = v_batch_b1 and figura = 'FiguraB2') = 0,
    'B3 el lote de otro sabor no debe consumirse';
  assert (select stock from products where id = v_product_b) = 3,
    'B4 el alta del lote de otro sabor va completa al mostrador';

  v_batch_b2 := 'T2C-LB2';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_b2, current_date, v_product_b, 'OtraFiguraB2', 'Sabor T2CB', 2, 'Congelando', false, current_date + 8);
  r := desmoldar_lote(v_batch_b2, 2, 0, 0);
  assert (r->>'asignadas_cola')::integer = 0,
    'B5 el lote del sabor pedido pero otra figura NO atiende: asignó '||(r->>'asignadas_cola');
  assert (select estado from production_suggestions where order_id = v_order_b) = 'Pendiente',
    'B6 la sugerencia debe seguir esperando la figura exacta';

  v_batch_b3 := 'T2C-LB3';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_b3, current_date, v_product_b, 'FiguraB2', 'Sabor T2CB', 2, 'Congelando', false, current_date + 9);
  r := desmoldar_lote(v_batch_b3, 2, 0, 0);
  assert (r->>'asignadas_cola')::integer = 2,
    'B7 solo figura+sabor exactos atienden las 2 unidades';
  assert (select figura from inventory_reservations where order_id = v_order_b and tipo = 'producto') = 'FiguraB2',
    'B8 la reserva debe llevar la figura exacta pedida';
  assert (select estado from production_suggestions where order_id = v_order_b) = 'Atendida',
    'B9 la sugerencia debe quedar Atendida';
  assert (select stock from products where id = v_product_b) = 5,
    'B10 stock final conserva 3 de otro sabor + 2 de otra figura';

  -- ==========================================================================
  -- C. FIGURA EXACTA EN LOTE MIXTO: solo la figura pedida atiende la cola;
  -- las otras figuras del mismo lote/sabor quedan disponibles.
  -- ==========================================================================
  v_product_c := 'T2C-PRC';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_c, 'Test 2 momo C', v_cat, 'momo', 'gato', 1000, 500, 0);

  v_order_c := 'T2C-PC';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_c, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_c := 'T2C-ITC';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_c, v_order_c, v_product_c, 'Test 2 momo C', 'FigC2M', 'Sabor T2CC', 2, 1000, 500);
  insert into evidences (id, order_id, tipo, storage_path)
  values ('T2C-EC', v_order_c, 'Comprobante de pago', 'test/2c/c.jpg');
  r := set_order_status(v_order_c, 'Pagado', false);
  assert (r->>'ok')::boolean, 'C0 pagar el pedido C debe suceder';

  v_batch_c := 'T2C-LC';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento, figuras)
  values (v_batch_c, current_date, v_product_c, '', 'Sabor T2CC', 3, 'Congelando', false, current_date + 6,
          '[{"figura":"FigC2M","cant":1},{"figura":"FigC2R","cant":2}]'::jsonb);
  r := desmoldar_lote(v_batch_c, 3, 0, 0,
        '[{"figura":"FigC2M","perfectas":1,"imperfectas":0,"descartadas":0},{"figura":"FigC2R","perfectas":2,"imperfectas":0,"descartadas":0}]'::jsonb);
  assert (r->>'asignadas_cola')::integer = 1, 'C1 debe asignar solo la figura exacta disponible: fue '||(r->>'asignadas_cola');
  assert (select count(*) from inventory_reservations where order_id = v_order_c and tipo = 'producto') = 1,
    'C2 la reserva no debe cruzar a otra figura';
  assert (select cantidad from inventory_reservations where order_id = v_order_c and figura = 'FigC2M') = 1,
    'C3 la figura PEDIDA se sirve primero (1 disponible)';
  assert not exists (select 1 from inventory_reservations where order_id = v_order_c and figura = 'FigC2R'),
    'C4 la otra figura no cubre el faltante';
  assert (select consumidas from lote_figuras where batch_id = v_batch_c and figura = 'FigC2M') = 1
     and (select consumidas from lote_figuras where batch_id = v_batch_c and figura = 'FigC2R') = 0,
    'C5 consumidas exactas por figura';
  assert (select stock from products where id = v_product_c) = 2,
    'C6 stock neto = 3 − 1 = 2';
  assert (select estado from production_suggestions where order_id = v_order_c) = 'Pendiente'
     and (select cantidad from production_suggestions where order_id = v_order_c) = 1,
    'C7 la sugerencia queda Pendiente por la figura exacta faltante';

  -- ==========================================================================
  -- D. FIFO POR PAGADO_EN + PARCIAL: dos pedidos esperan; el lote alcanza para
  -- el primero completo y parte del segundo — la sugerencia del segundo queda
  -- Pendiente por el resto.
  -- ==========================================================================
  v_product_d := 'T2C-PRD';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_d, 'Test 2 momo D', v_cat, 'momo', 'gato', 1000, 500, 0);

  v_order_d1 := 'T2C-PD1';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_d1, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_d1 := 'T2C-ITD1';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_d1, v_order_d1, v_product_d, 'Test 2 momo D', 'FigD2', 'Sabor T2CD', 2, 1000, 500);
  insert into evidences (id, order_id, tipo, storage_path)
  values ('T2C-ED1', v_order_d1, 'Comprobante de pago', 'test/2c/d1.jpg');
  r := set_order_status(v_order_d1, 'Pagado', false);
  assert (r->>'ok')::boolean, 'D0 pagar D1 debe suceder';

  v_order_d2 := 'T2C-PD2';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_d2, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_d2 := 'T2C-ITD2';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_d2, v_order_d2, v_product_d, 'Test 2 momo D', 'FigD2', 'Sabor T2CD', 2, 1000, 500);
  insert into evidences (id, order_id, tipo, storage_path)
  values ('T2C-ED2', v_order_d2, 'Comprobante de pago', 'test/2c/d2.jpg');
  r := set_order_status(v_order_d2, 'Pagado', false);
  assert (r->>'ok')::boolean, 'D0b pagar D2 debe suceder';
  -- Nota: dentro de una transacción now() es fijo → pagado_en empata; el
  -- desempate real es el id de la sugerencia (orden de creación = orden de
  -- pago). Los asserts D2/D3 verifican exactamente esa prioridad.

  v_batch_d := 'T2C-LD';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_d, current_date, v_product_d, 'FigD2', 'Sabor T2CD', 3, 'Congelando', false, current_date + 4);
  r := desmoldar_lote(v_batch_d, 3, 0, 0);
  assert (r->>'asignadas_cola')::integer = 3, 'D1 debe asignar las 3 del lote: fue '||(r->>'asignadas_cola');

  assert (select estado from production_suggestions where order_id = v_order_d1) = 'Atendida',
    'D2 el que pagó PRIMERO queda cubierto completo';
  assert (select coalesce(sum(cantidad),0) from inventory_reservations where order_id = v_order_d1 and tipo = 'producto') = 2,
    'D2b con sus 2 unidades reservadas';
  assert (select estado from production_suggestions where order_id = v_order_d2) = 'Pendiente',
    'D3 el segundo queda parcial → sugerencia sigue Pendiente';
  assert (select cantidad from production_suggestions where order_id = v_order_d2) = 1,
    'D3b la sugerencia del segundo baja al resto (2−1=1)';
  assert (select coalesce(sum(cantidad),0) from inventory_reservations where order_id = v_order_d2 and tipo = 'producto') = 1,
    'D3c con 1 unidad reservada';
  assert (select stock from products where id = v_product_d) = 0,
    'D4 stock neto = 3 − 3 = 0';

  -- ==========================================================================
  -- E. FUERA DE FLUJO: un pedido CANCELADO en cola no se atiende (su
  -- sugerencia sigue Pendiente — comportamiento actual — pero el desmolde no
  -- le asigna nada y el alta va completa al mostrador).
  -- ==========================================================================
  v_product_e := 'T2C-PRE';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_e, 'Test 2 momo E', v_cat, 'momo', 'perro', 1000, 500, 0);

  v_order_e := 'T2C-PE';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_e, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_e := 'T2C-ITE';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_e, v_order_e, v_product_e, 'Test 2 momo E', 'FigE2', 'Sabor T2CE', 2, 1000, 500);
  insert into evidences (id, order_id, tipo, storage_path)
  values ('T2C-EE', v_order_e, 'Comprobante de pago', 'test/2c/e.jpg');
  r := set_order_status(v_order_e, 'Pagado', false);
  assert (r->>'ok')::boolean, 'E0 pagar E debe suceder';
  r := set_order_status(v_order_e, 'Cancelado', false);
  assert (r->>'ok')::boolean, 'E0b cancelar E debe suceder';

  v_batch_e := 'T2C-LE';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_e, current_date, v_product_e, 'FigE2', 'Sabor T2CE', 2, 'Congelando', false, current_date + 4);
  r := desmoldar_lote(v_batch_e, 2, 0, 0);
  assert (r->>'asignadas_cola')::integer = 0,
    'E1 un pedido Cancelado no se atiende: asignó '||(r->>'asignadas_cola');
  assert (select count(*) from inventory_reservations where order_id = v_order_e and estado = 'Reservada') = 0,
    'E2 no debe nacer ninguna reserva viva para el cancelado';
  assert (select stock from products where id = v_product_e) = 2,
    'E3 el alta va completa al mostrador';

  -- ==========================================================================
  -- F. CICLO COMPLETO: cancelar un pedido YA ATENDIDO por la cola devuelve
  -- stock y consumidas exactos (rama batch_id de _release_reservations, 1b).
  -- ==========================================================================
  v_product_f := 'T2C-PRF';
  insert into products (id, nombre, cat, tipo, especie, precio, costo, stock)
  values (v_product_f, 'Test 2 momo F', v_cat, 'momo', 'gato', 1000, 500, 0);

  v_order_f := 'T2C-PF';
  insert into orders (id, fecha, hora, canal, customer_id, estado, pago, comprobante)
  values (v_order_f, current_date, current_time, 'WhatsApp', v_customer_id, 'Nuevo', 'Nequi', true);
  v_item_f := 'T2C-ITF';
  insert into order_items (id, order_id, product_id, nombre, figura, sabor, cant, precio, costo_unitario)
  values (v_item_f, v_order_f, v_product_f, 'Test 2 momo F', 'FigF2', 'Sabor T2CF', 2, 1000, 500);
  insert into evidences (id, order_id, tipo, storage_path)
  values ('T2C-EF', v_order_f, 'Comprobante de pago', 'test/2c/f.jpg');
  r := set_order_status(v_order_f, 'Pagado', false);
  assert (r->>'ok')::boolean, 'F0 pagar F debe suceder';

  v_batch_f := 'T2C-LF';
  insert into production_batches (id, fecha, product_id, figura, sabor, prod, estado, stock_contabilizado, vencimiento)
  values (v_batch_f, current_date, v_product_f, 'FigF2', 'Sabor T2CF', 4, 'Congelando', false, current_date + 4);
  r := desmoldar_lote(v_batch_f, 4, 0, 0);
  assert (r->>'asignadas_cola')::integer = 2, 'F1 la cola toma 2 del lote';
  assert (select stock from products where id = v_product_f) = 2, 'F2 stock neto 4−2=2';
  assert (select consumidas from lote_figuras where batch_id = v_batch_f and figura = 'FigF2') = 2, 'F3 consumidas=2';

  r := set_order_status(v_order_f, 'Cancelado', false);
  assert (r->>'ok')::boolean, 'F4 cancelar F debe suceder';
  assert (select stock from products where id = v_product_f) = 4,
    'F5 cancelar devuelve el stock: 2+2=4';
  assert (select consumidas from lote_figuras where batch_id = v_batch_f and figura = 'FigF2') = 0,
    'F6 cancelar devuelve consumidas al lote exacto';
  assert not exists (select 1 from inventory_reservations where order_id = v_order_f and estado = 'Reservada'),
    'F7 la reserva de la cola queda Liberada';

  raise exception 'TESTS_OK — variantes-2-cola bloques A-F PASS, rollback total';
end $$;
