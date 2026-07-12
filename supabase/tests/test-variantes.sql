-- ============================================================================
-- MOMOS OPS — Batería de aceptación RE-EJECUTABLE · Variantes Etapa 1a
-- (desmolde por figura: lote de 1 figura auto-deriva, lote mixto exige
--  p_figuras, guards de p_figuras, no-regresión de lotes viejos + vista,
--  guard de plan corrupto con figura duplicada)
--
-- CÓMO CORRERLA: ejecutar este archivo COMPLETO como un solo script
-- (vía MCP execute_sql o SQL Editor). Es un patrón SIN RESIDUOS:
-- transacción + JWT simulado de U01 (Administrador) + DO con ASSERTs +
-- RAISE final ⇒ ROLLBACK TOTAL. La base queda EXACTAMENTE como estaba.
--
-- RESULTADO ESPERADO: el script TERMINA EN ERROR con el mensaje
-- «TESTS_OK — variantes-v1 bloques A-E PASS, rollback total» ⇒ TODO PASÓ.
-- Cualquier OTRO error = un assert falló → leer su mensaje (A1..E3).
--
-- Requisitos mínimos: migración variantes-v1.sql aplicada (lote_figuras,
-- desmoldar_lote nueva firma, v_variantes_disponibles); U01 es Administrador
-- activo; al menos una figura activa con product_id (Producción v2); al
-- menos DOS figuras activas que compartan el MISMO product_id Y gramaje_g
-- (según rpc-produccion-v2.sql, hoy Max/Rocco/Danna comparten PR02/180 y
-- Momo/Toby comparten PR01/180 — el bloque B resuelve esto en vivo, sin
-- hardcodear nombres, por si el catálogo cambia).
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  rec record;
  r jsonb;

  -- ---- Bloque A: lote de 1 figura ----
  v_figura_a text;
  v_product_a text;
  v_corrida_a text;
  v_batch_a text;
  v_stock_pre_a numeric;
  v_stock_post_a numeric;
  v_prod_a integer;
  v_perfectas_a integer;
  v_imperfectas_a integer;
  v_descartadas_a integer;

  -- ---- Bloque B: lote mixto ----
  v_figura_b1 text;
  v_figura_b2 text;
  v_product_b text;
  v_gramaje_b integer;
  v_cant_b1 integer := 2;
  v_cant_b2 integer := 3;
  v_prod_b integer;
  v_corrida_b text;
  v_batch_b text;
  v_stock_pre_b numeric;
  v_stock_post_b numeric;
  v_perfectas_b1 integer := 2;
  v_imperfectas_b1 integer := 0;
  v_descartadas_b1 integer := 0;
  v_perfectas_b2 integer := 2;
  v_imperfectas_b2 integer := 1;
  v_descartadas_b2 integer := 0;

  -- ---- Bloque C: guards de p_figuras (lote propio, sin desmoldar) ----
  v_batch_c text;
  v_corrida_c text;
  v_prod_c integer;

  -- ---- Bloque D: no-regresión ----
  v_batch_viejo text;
  v_disponibles_a numeric;
begin
  -- ==========================================================================
  -- PRECONDICIONES: figura activa con producto (bloque A) + par de figuras
  -- activas que compartan product_id y gramaje_g (bloque B) — resueltas en
  -- vivo, sin hardcodear nombres de figura.
  -- ==========================================================================
  select f.nombre, f.product_id into v_figura_a, v_product_a
  from figuras f where f.product_id is not null and f.activo
  order by f.nombre limit 1;
  assert v_figura_a is not null, 'PRE0 debe existir una figura activa con producto asignado';

  select f1.nombre, f2.nombre, f1.product_id, f1.gramaje_g
    into v_figura_b1, v_figura_b2, v_product_b, v_gramaje_b
  from figuras f1
  join figuras f2 on f2.product_id = f1.product_id and f2.gramaje_g = f1.gramaje_g and f2.nombre > f1.nombre
  where f1.product_id is not null and f1.activo and f2.activo
  order by f1.product_id, f1.nombre, f2.nombre limit 1;
  assert v_figura_b1 is not null and v_figura_b2 is not null,
    'PRE1 debe existir un par de figuras activas que compartan product_id y gramaje_g (lote mixto)';

  -- ==========================================================================
  -- A. LOTE DE UNA FIGURA: desmoldar_lote SIN p_figuras auto-deriva 1 fila en
  -- lote_figuras con los conteos del lote; stock del producto sube por
  -- perfectas (igual que antes de este slice); lote queda Listo/contabilizado.
  -- ==========================================================================
  select stock into v_stock_pre_a from products where id = v_product_a;

  r := crear_corrida(jsonb_build_object(
    'sabor', 'Test variantes bloque A',
    'figuras', jsonb_build_array(jsonb_build_object('figura', v_figura_a, 'cant', 4)),
    'idempotency_key', 'test-variantes-a'
  ));
  v_corrida_a := r->>'corrida_id';
  v_batch_a := r->'lotes'->0->>'batch_id';
  assert v_batch_a like 'L-%', 'A1 crear_corrida sigue derivando un lote hijo: '||v_batch_a;

  select prod into v_prod_a from production_batches where id = v_batch_a;
  v_perfectas_a := v_prod_a - 1;
  v_imperfectas_a := 1;
  v_descartadas_a := 0;

  r := desmoldar_lote(v_batch_a, v_perfectas_a, v_imperfectas_a, v_descartadas_a);
  assert (r->>'ok')::boolean, 'A2 desmoldar_lote sin p_figuras debe devolver ok=true para lote de 1 figura';
  assert r->>'estado' = 'Listo', 'A3 desmoldar_lote debe dejar el lote en Listo';

  assert (select count(*) from lote_figuras where batch_id = v_batch_a) = 1,
    'A4 debe auto-derivar EXACTAMENTE 1 fila en lote_figuras para un lote de 1 figura';
  select figura, perfectas, imperfectas, descartadas into rec
  from lote_figuras where batch_id = v_batch_a;
  assert rec.figura = v_figura_a, 'A5 la fila auto-derivada debe tener la figura del plan: '||rec.figura;
  assert rec.perfectas = v_perfectas_a and rec.imperfectas = v_imperfectas_a and rec.descartadas = v_descartadas_a,
    'A6 la fila auto-derivada debe copiar los conteos totales del lote';

  assert (select estado from production_batches where id = v_batch_a) = 'Listo',
    'A7 el lote debe quedar en estado Listo';
  assert (select stock_contabilizado from production_batches where id = v_batch_a),
    'A8 el lote debe quedar stock_contabilizado=true';

  select stock into v_stock_post_a from products where id = v_product_a;
  assert v_stock_post_a = v_stock_pre_a + v_perfectas_a,
    'A9 el stock del producto debe subir exactamente por perfectas: pre='||v_stock_pre_a||' perfectas='||v_perfectas_a||' post='||v_stock_post_a;

  -- ==========================================================================
  -- B. LOTE MIXTO: 2 figuras del MISMO producto+gramaje en la misma corrida
  -- (crear_corrida las agrupa en UN solo lote hijo — mismo mecanismo de
  -- agrupación server-side de rpc-produccion-v2.sql sección B).
  -- ==========================================================================
  select stock into v_stock_pre_b from products where id = v_product_b;

  r := crear_corrida(jsonb_build_object(
    'sabor', 'Test variantes bloque B',
    'figuras', jsonb_build_array(
      jsonb_build_object('figura', v_figura_b1, 'cant', v_cant_b1),
      jsonb_build_object('figura', v_figura_b2, 'cant', v_cant_b2)
    ),
    'idempotency_key', 'test-variantes-b'
  ));
  v_corrida_b := r->>'corrida_id';
  assert jsonb_array_length(r->'lotes') = 1,
    'B0 dos figuras del mismo producto+gramaje deben derivar en UN solo lote hijo, hubo '||jsonb_array_length(r->'lotes');
  v_batch_b := r->'lotes'->0->>'batch_id';

  select prod into v_prod_b from production_batches where id = v_batch_b;
  assert v_prod_b = v_cant_b1 + v_cant_b2,
    'B1 el lote mixto debe producir la suma de ambas figuras: esperado '||(v_cant_b1+v_cant_b2)||' fue '||v_prod_b;

  -- desmoldar_lote SIN p_figuras sobre un lote MIXTO debe fallar con LOTE_MIXTO.
  begin
    perform desmoldar_lote(v_batch_b, v_perfectas_b1 + v_perfectas_b2, v_imperfectas_b1 + v_imperfectas_b2, v_descartadas_b1 + v_descartadas_b2);
    raise exception 'B2 no bloqueó el desmolde sin p_figuras de un lote MIXTO';
  exception when others then
    if sqlerrm like '%B2%' then raise; end if;
    assert sqlerrm like '%LOTE_MIXTO%', 'B2b el error debe mencionar LOTE_MIXTO: '||sqlerrm;
  end;

  -- No debe haber quedado el lote contabilizado por el intento fallido.
  assert not (select stock_contabilizado from production_batches where id = v_batch_b),
    'B3 el intento fallido sin p_figuras no debe dejar el lote contabilizado';

  -- desmoldar_lote CON p_figuras correcto: filas por figura, totales cuadran,
  -- stock sube UNA sola vez (por la suma de perfectas de ambas figuras).
  r := desmoldar_lote(
    v_batch_b,
    v_perfectas_b1 + v_perfectas_b2, v_imperfectas_b1 + v_imperfectas_b2, v_descartadas_b1 + v_descartadas_b2,
    jsonb_build_array(
      jsonb_build_object('figura', v_figura_b1, 'perfectas', v_perfectas_b1, 'imperfectas', v_imperfectas_b1, 'descartadas', v_descartadas_b1),
      jsonb_build_object('figura', v_figura_b2, 'perfectas', v_perfectas_b2, 'imperfectas', v_imperfectas_b2, 'descartadas', v_descartadas_b2)
    )
  );
  assert (r->>'ok')::boolean, 'B4 desmoldar_lote con p_figuras correcto debe devolver ok=true';

  assert (select count(*) from lote_figuras where batch_id = v_batch_b) = 2,
    'B5 debe haber EXACTAMENTE 2 filas en lote_figuras para el lote mixto';
  assert (select perfectas from lote_figuras where batch_id = v_batch_b and figura = v_figura_b1) = v_perfectas_b1,
    'B6 la figura '||v_figura_b1||' debe tener sus perfectas propias';
  assert (select perfectas from lote_figuras where batch_id = v_batch_b and figura = v_figura_b2) = v_perfectas_b2,
    'B7 la figura '||v_figura_b2||' debe tener sus perfectas propias';

  select stock into v_stock_post_b from products where id = v_product_b;
  assert v_stock_post_b = v_stock_pre_b + v_perfectas_b1 + v_perfectas_b2,
    'B8 el stock debe subir UNA sola vez por la suma de perfectas de ambas figuras: pre='||v_stock_pre_b||
    ' esperado_delta='||(v_perfectas_b1+v_perfectas_b2)||' post='||v_stock_post_b;

  assert (select estado from production_batches where id = v_batch_b) = 'Listo',
    'B9 el lote mixto debe quedar Listo tras desmoldar con p_figuras';

  -- ==========================================================================
  -- C. GUARDS DE p_figuras: cada caso en su propio lote fresco (mismo par de
  -- figuras del bloque B, corrida nueva) para no interferir entre asserts.
  -- ==========================================================================

  -- C1: figura que NO está en el plan.
  r := crear_corrida(jsonb_build_object(
    'sabor', 'Test variantes bloque C1',
    'figuras', jsonb_build_array(
      jsonb_build_object('figura', v_figura_b1, 'cant', v_cant_b1),
      jsonb_build_object('figura', v_figura_b2, 'cant', v_cant_b2)
    ),
    'idempotency_key', 'test-variantes-c1'
  ));
  v_batch_c := r->'lotes'->0->>'batch_id';
  select prod into v_prod_c from production_batches where id = v_batch_c;
  begin
    perform desmoldar_lote(v_batch_c, v_prod_c, 0, 0, jsonb_build_array(
      jsonb_build_object('figura', v_figura_b1, 'perfectas', v_cant_b1, 'imperfectas', 0, 'descartadas', 0),
      jsonb_build_object('figura', 'FIGURA_QUE_NO_EXISTE_EN_EL_PLAN', 'perfectas', v_cant_b2, 'imperfectas', 0, 'descartadas', 0)
    ));
    raise exception 'C1 no bloqueó una figura ajena al plan';
  exception when others then
    if sqlerrm like 'C1 %' then raise; end if;
    assert sqlerrm like '%figuras del plan%' or sqlerrm like '%cubrir%',
      'C1b el error debe mencionar el descalce con el plan: '||sqlerrm;
  end;

  -- C2: suma por figura ≠ cant del plan.
  r := crear_corrida(jsonb_build_object(
    'sabor', 'Test variantes bloque C2',
    'figuras', jsonb_build_array(
      jsonb_build_object('figura', v_figura_b1, 'cant', v_cant_b1),
      jsonb_build_object('figura', v_figura_b2, 'cant', v_cant_b2)
    ),
    'idempotency_key', 'test-variantes-c2'
  ));
  v_batch_c := r->'lotes'->0->>'batch_id';
  select prod into v_prod_c from production_batches where id = v_batch_c;
  begin
    perform desmoldar_lote(v_batch_c, v_prod_c, 0, 0, jsonb_build_array(
      jsonb_build_object('figura', v_figura_b1, 'perfectas', v_cant_b1 + 1, 'imperfectas', 0, 'descartadas', 0),  -- se pasa de cant
      jsonb_build_object('figura', v_figura_b2, 'perfectas', v_cant_b2 - 1, 'imperfectas', 0, 'descartadas', 0)
    ));
    raise exception 'C2 no bloqueó una figura cuya suma no cuadra con su cant del plan';
  exception when others then
    if sqlerrm like 'C2 %' then raise; end if;
    assert sqlerrm like '%no cuadra%', 'C2b el error debe mencionar que la figura no cuadra: '||sqlerrm;
  end;

  -- C3: Σ figuras ≠ totales del lote (cada figura cuadra individualmente
  -- contra su propio cant, pero los totales enviados no coinciden con la suma).
  r := crear_corrida(jsonb_build_object(
    'sabor', 'Test variantes bloque C3',
    'figuras', jsonb_build_array(
      jsonb_build_object('figura', v_figura_b1, 'cant', v_cant_b1),
      jsonb_build_object('figura', v_figura_b2, 'cant', v_cant_b2)
    ),
    'idempotency_key', 'test-variantes-c3'
  ));
  v_batch_c := r->'lotes'->0->>'batch_id';
  select prod into v_prod_c from production_batches where id = v_batch_c;
  begin
    -- p_perfectas=v_prod_c (todo perfecto) pero p_figuras dice que hay 1 imperfecta en b1 → totales no coinciden.
    perform desmoldar_lote(v_batch_c, v_prod_c, 0, 0, jsonb_build_array(
      jsonb_build_object('figura', v_figura_b1, 'perfectas', v_cant_b1 - 1, 'imperfectas', 1, 'descartadas', 0),
      jsonb_build_object('figura', v_figura_b2, 'perfectas', v_cant_b2, 'imperfectas', 0, 'descartadas', 0)
    ));
    raise exception 'C3 no bloqueó una suma de figuras que no coincide con los totales del lote';
  exception when others then
    if sqlerrm like 'C3 %' then raise; end if;
    assert sqlerrm like '%no coincide con los totales%', 'C3b el error debe mencionar el descalce con los totales: '||sqlerrm;
  end;

  -- Ninguno de los 3 lotes de guards debe haber quedado contabilizado por los intentos fallidos.
  assert (select count(*) from production_batches where sabor like 'Test variantes bloque C%' and stock_contabilizado) = 0,
    'C4 ningún lote de los guards fallidos debe quedar contabilizado';

  -- ==========================================================================
  -- D. NO-REGRESIÓN: un lote viejo YA cuadrado (creado por crear_lote v1,
  -- sin jsonb `figuras`) pasa por set_lote_estado sin exigir lote_figuras; y
  -- la vista v_variantes_disponibles devuelve la variante del bloque A con
  -- los disponibles correctos.
  -- ==========================================================================
  select id into v_batch_viejo from production_batches
  where figuras is null and stock_contabilizado = true limit 1;

  if v_batch_viejo is not null then
    -- Ya está Listo/contabilizado — set_lote_estado a su mismo estado es no-op
    -- (rama "sin_cambio" de rpc-produccion-v2.sql sección D), no debe exigir
    -- lote_figuras porque el guard solo mira los 3 totales del lote.
    r := set_lote_estado(v_batch_viejo, (select estado from production_batches where id = v_batch_viejo));
    assert (r->>'ok')::boolean, 'D1 set_lote_estado sobre un lote viejo ya cuadrado debe seguir funcionando sin exigir lote_figuras';
  else
    -- No hay un lote viejo contabilizado en esta base: se crea y cuadra uno
    -- vía crear_lote v1 (perfectas=prod por default) para probar el mismo contrato.
    select id into v_batch_viejo from production_batches
    where figuras is null limit 1;
    if v_batch_viejo is not null and (select estado from production_batches where id = v_batch_viejo) not in ('Listo') then
      r := set_lote_estado(v_batch_viejo, 'Congelando');
      r := set_lote_estado(v_batch_viejo, 'Listo');
      assert (r->>'ok')::boolean, 'D1b set_lote_estado debe poder llevar un lote sin jsonb figuras a Listo sin exigir lote_figuras';
    end if;
  end if;

  -- v_variantes_disponibles debe reflejar la variante del bloque A.
  select disponibles into v_disponibles_a
  from v_variantes_disponibles
  where product_id = v_product_a and figura = v_figura_a and sabor = 'Test variantes bloque A';
  assert v_disponibles_a = v_perfectas_a,
    'D2 v_variantes_disponibles debe mostrar los disponibles correctos de la variante del bloque A: esperado '||v_perfectas_a||' fue '||v_disponibles_a;

  -- v_variantes_disponibles NO debe incluir lotes no-Listos/no-contabilizados
  -- (los 3 lotes fallidos del bloque C nunca llegaron a Listo).
  assert not exists (
    select 1 from v_variantes_disponibles
    where sabor like 'Test variantes bloque C%'
  ), 'D3 v_variantes_disponibles no debe incluir lotes que no llegaron a Listo/contabilizado';

  -- ==========================================================================
  -- E. PLAN CORRUPTO: production_batches.figuras con la misma figura repetida
  -- dos veces (dato corrupto a mano, nunca lo produciría crear_corrida) debe
  -- ser RECHAZADO por el guard de invariante de desmoldar_lote — reusa v_batch_c
  -- (el lote de C3, nunca desmoldado con éxito) para no crear una corrida nueva.
  -- ==========================================================================
  update production_batches
  set figuras = jsonb_build_array(
    jsonb_build_object('cant', 1, 'figura', 'X'),
    jsonb_build_object('cant', 1, 'figura', 'X')
  )
  where id = v_batch_c;

  -- E1: rama SIN p_figuras debe rechazar el plan corrupto. Los totales
  -- (v_prod_c, el prod real del lote de C3) deben cuadrar contra b.prod para
  -- que el guard de conteos no dispare ANTES que el guard de invariante que
  -- este bloque quiere probar.
  begin
    perform desmoldar_lote(v_batch_c, v_prod_c, 0, 0);
    raise exception 'E1 no bloqueó un plan corrupto (figura duplicada) sin p_figuras';
  exception when others then
    if sqlerrm like 'E1 %' then raise; end if;
    assert sqlerrm like '%Plan de figuras corrupto%', 'E1b el error debe mencionar el plan corrupto: '||sqlerrm;
  end;

  -- E2: rama CON p_figuras también debe rechazar el mismo plan corrupto —
  -- el guard corre ANTES de bifurcar entre las dos ramas. p_figuras acá es
  -- deliberadamente inconsistente con v_prod_c (no importa: el guard de
  -- invariante del plan dispara antes de llegar a validar p_figuras).
  begin
    perform desmoldar_lote(v_batch_c, v_prod_c, 0, 0, jsonb_build_array(
      jsonb_build_object('figura', 'X', 'perfectas', 1, 'imperfectas', 0, 'descartadas', 0),
      jsonb_build_object('figura', 'X', 'perfectas', 1, 'imperfectas', 0, 'descartadas', 0)
    ));
    raise exception 'E2 no bloqueó un plan corrupto (figura duplicada) con p_figuras';
  exception when others then
    if sqlerrm like 'E2 %' then raise; end if;
    assert sqlerrm like '%Plan de figuras corrupto%', 'E2b el error debe mencionar el plan corrupto: '||sqlerrm;
  end;

  -- El lote de C3 con el plan corrompido a mano no debe haber quedado contabilizado.
  assert not (select stock_contabilizado from production_batches where id = v_batch_c),
    'E3 el lote con plan corrupto no debe quedar contabilizado tras los intentos rechazados';

  raise exception 'TESTS_OK — variantes-v1 bloques A-E PASS, rollback total';
end $$;
