-- ============================================================================
-- MOMOS OPS — Batería de aceptación RE-EJECUTABLE · Subrecetas / BOM v1
-- (producir_subreceta ciclo completo + default de merma + idempotencia;
--  crear_corrida modo subreceta con dos gramajes + fallback legacy total;
--  guard de relleno que no cabe en el gramaje de la figura)
--
-- CÓMO CORRERLA: ejecutar este archivo COMPLETO como un solo script
-- (vía MCP execute_sql o SQL Editor). Es un patrón SIN RESIDUOS:
-- transacción + JWT simulado de U01 (Administrador) + DO con ASSERTs +
-- RAISE final ⇒ ROLLBACK TOTAL. La base queda EXACTAMENTE como estaba.
--
-- RESULTADO ESPERADO: el script TERMINA EN ERROR con el mensaje
-- «TESTS_OK — subrecetas-bom-v1 bloques A-F PASS, rollback total» ⇒ TODO PASÓ.
-- Cualquier OTRO error = un assert falló → leer su mensaje (A1..F3).
--
-- Re-ejecutable con la base en cualquier estado: los asserts de stock/costo
-- son RELATIVOS al estado capturado antes de cada efecto (nunca números
-- absolutos), y los ids se buscan por patrón. El setup de stock a los 9
-- ingredientes de SR02 y a I45/I54/I05 se hace con UPDATE directo — el rol
-- ya es `authenticated` simulando a U01 (Administrador) y la policy
-- admin_all permite el update.
--
-- Requisitos mínimos: migración subrecetas-bom-v1.sql aplicada (SR01-SR20,
-- FR01/FR02, producir_subreceta, crear_corrida modo subreceta); figuras
-- Lizi (PR01/150g) y Momo (PR01/180g) activas con product_id; U01 es
-- Administrador activo.
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  r jsonb;
  rec record;
  v_sp_id text;
  v_sp_id2 text;
  v_hoy date := (now() at time zone 'America/Bogota')::date;

  -- ---- Bloque A: producir_subreceta ciclo completo (SR02 mousse coco, I45) ----
  v_sr02_ingredientes jsonb;   -- item_id -> {cantidad, stock_pre, costo}
  v_i45_stock_pre numeric;
  v_i45_costo_pre numeric;
  v_i45_stock_post numeric;
  v_i45_costo_post numeric;
  v_costo_batch_esperado numeric := 0;
  v_gramos_en_unidad numeric;
  v_wac_esperado numeric;
  v_key text;
  v_val jsonb;
  v_toma numeric;
  v_mov_count_pre integer;
  v_mov_count_post integer;
  v_sp_count_pre integer;
  v_sp_count_post integer;

  -- ---- Bloque B: default de merma ----
  v_gramos_obtenidos_log numeric;

  -- ---- Bloque C: idempotencia ----
  v_stock_snapshot jsonb;
  v_stock_snapshot2 jsonb;
  v_mov_count_c_pre integer;
  v_mov_count_c_post integer;
  v_sp_count_c_pre integer;
  v_sp_count_c_post integer;

  -- ---- Bloque D: crear_corrida modo subreceta ----
  v_corrida_id text;
  v_lotes jsonb;
  v_lote_lizi text;
  v_lote_momo text;
  v_gramos_relleno_activo numeric;
  v_gramos_fr01 numeric;
  v_gramos_fr02 numeric;
  v_i45_pre numeric;
  v_i54_pre numeric;
  v_i05_pre numeric;
  v_i45_post numeric;
  v_i54_post numeric;
  v_i05_post numeric;
  v_total_prod integer;
  v_req_mousse numeric;
  v_req_i54 numeric;
  v_req_i05 numeric;

  -- ---- Bloque E: fallback legacy ----
  v_corrida_id_e text;
  v_lotes_e jsonb;
  v_lote jsonb;
  v_mov_count_e_subreceta_pre integer;
  v_mov_count_e_subreceta_post integer;

  -- ---- Bloque F: guard de relleno ----
  v_fr01_pre numeric;

  -- ---- Checksums globales (bloque final, informativo dentro de la tx) ----
  v_chk_items_pre record;
  v_chk_items_post record;
begin
  -- ==========================================================================
  -- SETUP: stock conocido a los 9 ingredientes de SR02 (mousse coco) y a
  -- I45 (item de la subreceta), I54 (relleno cheesecake) e I05 (ganache).
  -- Usamos valores generosos para que ninguna toma choque con least().
  -- ==========================================================================
  update inventory_items set stock = 100 where id in (
    select item_id from subreceta_ingredientes where subreceta_id = 'SR02'
  );
  update inventory_items set stock = 50 where id = 'I45';   -- base mousse coco
  update inventory_items set stock = 50 where id = 'I54';   -- relleno cheesecake
  update inventory_items set stock = 50 where id = 'I05';   -- ganache (ya tenía costo real)

  -- ============ A. producir_subreceta — ciclo completo (SR02, I45) ============
  select jsonb_object_agg(si.item_id, jsonb_build_object('cantidad', si.cantidad, 'stock_pre', it.stock, 'costo', it.costo))
    into v_sr02_ingredientes
  from subreceta_ingredientes si join inventory_items it on it.id = si.item_id
  where si.subreceta_id = 'SR02';

  assert (select count(*) from jsonb_object_keys(v_sr02_ingredientes)) = 9,
    'A0 SR02 debe tener 9 ingredientes, tiene '||(select count(*) from jsonb_object_keys(v_sr02_ingredientes));

  select stock, costo into v_i45_stock_pre, v_i45_costo_pre from inventory_items where id = 'I45';
  select count(*) into v_mov_count_pre from inventory_movements;
  select count(*) into v_sp_count_pre from subreceta_producciones;

  r := producir_subreceta(jsonb_build_object(
    'subreceta_id', 'SR02',
    'gramos_nominales', 1000,
    'gramos_obtenidos', 920,
    'idempotency_key', 'test-srb-a'
  ));
  v_sp_id := r->>'id';
  assert v_sp_id like 'SP-%', 'A1 formato id subreceta_produccion: '||v_sp_id;
  assert (r->>'gramos_obtenidos')::numeric = 920, 'A2 gramos_obtenidos explícito respetado: '||(r->>'gramos_obtenidos');

  -- Cada ingrediente descontado EXACTO: cantidad × (1000/1000) = cantidad × 1.0
  for v_key, v_val in select * from jsonb_each(v_sr02_ingredientes)
  loop
    v_toma := (v_val->>'cantidad')::numeric;  -- factor 1.0 exacto (stock_pre=100 alcanza sobrado)
    assert (select stock from inventory_items where id = v_key) = round((v_val->>'stock_pre')::numeric - v_toma, 4),
      'A3 stock '||v_key||' descontado exacto: '||(select stock from inventory_items where id = v_key)||
      ' esperado '||round((v_val->>'stock_pre')::numeric - v_toma, 4);
    v_costo_batch_esperado := v_costo_batch_esperado + round(v_toma * (v_val->>'costo')::numeric, 2);
  end loop;
  v_costo_batch_esperado := round(v_costo_batch_esperado, 2);

  assert (select costo_batch from subreceta_producciones where id = v_sp_id) = v_costo_batch_esperado,
    'A4 costo_batch = suma(toma×costo) de los 9 ingredientes: '||
    (select costo_batch from subreceta_producciones where id = v_sp_id)||' esperado '||v_costo_batch_esperado;
  assert (select costo_batch from subreceta_producciones where id = v_sp_id) > 0, 'A4b costo_batch > 0';
  assert (select faltantes from subreceta_producciones where id = v_sp_id) = '[]'::jsonb,
    'A5 faltantes vacío (stock sobrado en el setup)';

  -- Stock I45 sube 0.92 kg (920 g obtenidos, unidad kg → /1000)
  select stock, costo into v_i45_stock_post, v_i45_costo_post from inventory_items where id = 'I45';
  assert v_i45_stock_post = round(v_i45_stock_pre + 0.92, 4),
    'A6 stock I45 sube 0.92 kg: '||v_i45_stock_post||' esperado '||round(v_i45_stock_pre + 0.92, 4);

  -- Costo I45 = WAC esperado, calculado con la misma fórmula que entrada_insumo.
  v_gramos_en_unidad := 0.92;  -- 920 g / 1000 (I45 es kg)
  v_wac_esperado := case
    when v_costo_batch_esperado > 0 and (v_i45_stock_pre + v_gramos_en_unidad) > 0
      then round((v_i45_stock_pre * v_i45_costo_pre + v_gramos_en_unidad * (v_costo_batch_esperado / v_gramos_en_unidad)) / (v_i45_stock_pre + v_gramos_en_unidad), 2)
    else v_i45_costo_pre
  end;
  assert v_i45_costo_post = v_wac_esperado,
    'A7 costo I45 = WAC esperado: '||v_i45_costo_post||' esperado '||v_wac_esperado;

  -- Movimientos: 9 'Uso en producción' (uno por ingrediente) + 1 'Entrada' (I45), con nota correcta.
  assert (select count(*) from inventory_movements where nota = 'Subreceta ' || v_sp_id and tipo = 'Uso en producción') = 9,
    'A8 9 movimientos Uso en producción con nota Subreceta '||v_sp_id;
  assert (select count(*) from inventory_movements where item_id = 'I45' and tipo = 'Entrada'
          and nota like 'Producción subreceta ' || v_sp_id || '%') = 1,
    'A9 1 movimiento Entrada en I45 con nota Producción subreceta '||v_sp_id;
  select count(*) into v_mov_count_post from inventory_movements;
  assert v_mov_count_post = v_mov_count_pre + 10, 'A10 total movimientos +10 (9 uso + 1 entrada): '||(v_mov_count_post - v_mov_count_pre);
  select count(*) into v_sp_count_post from subreceta_producciones;
  assert v_sp_count_post = v_sp_count_pre + 1, 'A11 una sola fila subreceta_producciones nueva';

  -- ============ B. default de merma (sin gramos_obtenidos, SR02 merma_pct=8) ============
  r := producir_subreceta(jsonb_build_object(
    'subreceta_id', 'SR02',
    'gramos_nominales', 1000,
    'idempotency_key', 'test-srb-b'
  ));
  v_sp_id2 := r->>'id';
  v_gramos_obtenidos_log := (select gramos_obtenidos from subreceta_producciones where id = v_sp_id2);
  assert v_gramos_obtenidos_log = round(1000 * (1 - 8/100.0), 1),
    'B1 default merma: gramos_obtenidos = 1000×(1-8/100) redondeado a 1 = 920.0, fue '||v_gramos_obtenidos_log;
  assert v_gramos_obtenidos_log = 920.0, 'B2 valor concreto esperado 920.0 para merma_pct=8, fue '||v_gramos_obtenidos_log;
  assert (r->>'gramos_obtenidos')::numeric = 920.0, 'B3 el retorno de la RPC también trae 920.0';

  -- ============ C. idempotencia (repetir llamada A con MISMO idempotency_key) ============
  select jsonb_object_agg(id, jsonb_build_object('stock', stock, 'costo', costo)) into v_stock_snapshot
  from inventory_items where id in (select item_id from subreceta_ingredientes where subreceta_id='SR02') or id = 'I45';
  select count(*) into v_mov_count_c_pre from inventory_movements;
  select count(*) into v_sp_count_c_pre from subreceta_producciones;

  r := producir_subreceta(jsonb_build_object(
    'subreceta_id', 'SR02',
    'gramos_nominales', 1000,
    'gramos_obtenidos', 920,
    'idempotency_key', 'test-srb-a'   -- MISMA key que el bloque A
  ));
  assert (r->>'idempotente')::boolean, 'C1 segunda llamada misma key debe ser idempotente';
  assert r->>'id' = v_sp_id, 'C2 mismo id de subreceta_produccion que la llamada original: '||(r->>'id')||' esperado '||v_sp_id;

  select jsonb_object_agg(id, jsonb_build_object('stock', stock, 'costo', costo)) into v_stock_snapshot2
  from inventory_items where id in (select item_id from subreceta_ingredientes where subreceta_id='SR02') or id = 'I45';
  assert v_stock_snapshot = v_stock_snapshot2, 'C3 stock/costo de los ingredientes + I45 sin cambio tras idempotencia';

  select count(*) into v_mov_count_c_post from inventory_movements;
  assert v_mov_count_c_post = v_mov_count_c_pre, 'C4 ningún movimiento nuevo tras idempotencia';
  select count(*) into v_sp_count_c_post from subreceta_producciones;
  assert v_sp_count_c_post = v_sp_count_c_pre, 'C5 ninguna fila SP nueva tras idempotencia';
  assert (select count(*) from subreceta_producciones where idempotency_key = 'test-srb-a') = 1, 'C6 una sola fila con esa key';

  -- ============ D. crear_corrida modo subreceta (Coco, dos gramajes: Lizi 150g / Momo 180g) ============
  -- Relleno leído EN VIVO de figura_relleno (NUNCA hardcodeado en el test).
  select coalesce(sum(gramos_por_unidad), 0) into v_gramos_relleno_activo from figura_relleno where activo;
  select gramos_por_unidad into v_gramos_fr01 from figura_relleno where id = 'FR01' and activo;
  select gramos_por_unidad into v_gramos_fr02 from figura_relleno where id = 'FR02' and activo;
  assert v_gramos_relleno_activo > 0, 'D0 debe haber relleno activo configurado';

  select stock into v_i45_pre from inventory_items where id = 'I45';
  select stock into v_i54_pre from inventory_items where id = 'I54';
  select stock into v_i05_pre from inventory_items where id = 'I05';

  r := crear_corrida(jsonb_build_object(
    'sabor', 'Coco',
    'figuras', jsonb_build_array(
      jsonb_build_object('figura','Lizi','cant',2),
      jsonb_build_object('figura','Momo','cant',3)
    ),
    'idempotency_key', 'test-srb-d'
  ));
  v_corrida_id := r->>'corrida_id';
  v_lotes := r->'lotes';
  assert v_corrida_id like 'CR-%', 'D1 formato id corrida: '||v_corrida_id;
  assert jsonb_array_length(v_lotes) = 2, 'D2 2 lotes hijos esperados (Lizi 150g / Momo 180g): '||v_lotes::text;

  select b->>'batch_id' into v_lote_lizi from jsonb_array_elements(v_lotes) b
    where b->>'product_id'='PR01' and (b->>'gramaje_g')::int=150;
  select b->>'batch_id' into v_lote_momo from jsonb_array_elements(v_lotes) b
    where b->>'product_id'='PR01' and (b->>'gramaje_g')::int=180;
  assert v_lote_lizi like 'L-%', 'D3 lote Lizi (150g) no encontrado: '||v_lotes::text;
  assert v_lote_momo like 'L-%', 'D3 lote Momo (180g) no encontrado: '||v_lotes::text;
  assert v_lote_momo <> v_lote_lizi, 'D3b Momo debe ser lote SEPARADO de Lizi (gramaje distinto)';

  -- Ambos lotes hijos comparten corrida_id.
  assert (select corrida_id from production_batches where id=v_lote_lizi) = v_corrida_id, 'D4 corrida_id Lizi';
  assert (select corrida_id from production_batches where id=v_lote_momo) = v_corrida_id, 'D4 corrida_id Momo';

  -- Retorno de cada lote trae 'modo':'subreceta', faltantes '[]'.
  for v_lote in select * from jsonb_array_elements(v_lotes)
  loop
    assert v_lote->>'modo' = 'subreceta', 'D5 modo=subreceta para lote '||(v_lote->>'batch_id')||': '||(v_lote->>'modo');
  end loop;
  assert r->'faltantes' = '[]'::jsonb, 'D6 faltantes vacío (stock sobrado en el setup): '||(r->'faltantes')::text;

  -- Descuento I45 (mousse) = Σ((gramaje − relleno_activo) × prod) / 1000, con
  -- el relleno LEÍDO de figura_relleno (no hardcodeado). prod: Lizi=2, Momo=3.
  v_req_mousse := round(
    (((150 - v_gramos_relleno_activo) * 2) + ((180 - v_gramos_relleno_activo) * 3)) / 1000.0,
    4);
  select stock into v_i45_post from inventory_items where id = 'I45';
  assert v_i45_post = round(v_i45_pre - v_req_mousse, 4),
    'D7 descuento I45 (mousse): '||v_i45_post||' esperado '||round(v_i45_pre - v_req_mousse, 4)||' (req='||v_req_mousse||')';

  -- Descuento I54 (relleno cheesecake, FR01) = gramos_fr01 × total_prod / 1000.
  v_total_prod := 2 + 3;  -- Lizi(2) + Momo(3), el relleno no depende del gramaje de la figura
  v_req_i54 := round(v_gramos_fr01 * v_total_prod / 1000.0, 4);
  select stock into v_i54_post from inventory_items where id = 'I54';
  assert v_i54_post = round(v_i54_pre - v_req_i54, 4),
    'D8 descuento I54 (relleno cheesecake, FR01='||v_gramos_fr01||'g): '||v_i54_post||' esperado '||round(v_i54_pre - v_req_i54, 4);

  -- Descuento I05 (ganache, FR02) = gramos_fr02 × total_prod / 1000.
  v_req_i05 := round(v_gramos_fr02 * v_total_prod / 1000.0, 4);
  select stock into v_i05_post from inventory_items where id = 'I05';
  assert v_i05_post = round(v_i05_pre - v_req_i05, 4),
    'D9 descuento I05 (ganache, FR02='||v_gramos_fr02||'g): '||v_i05_post||' esperado '||round(v_i05_pre - v_req_i05, 4);

  -- ============ E. fallback legacy (sabor SIN subreceta) ============
  assert not exists (
    select 1 from subrecetas
    where tipo in ('mousse_frutal','mousse_cremosa') and activo and lower(sabor) = lower('Vainilla test')
  ), 'E0 precondición: "Vainilla test" no debe tener subreceta de mousse activa';

  -- NOTA: NO se puede assertar "ningún movimiento sobre item_id que aparece en
  -- subrecetas", porque la migración documenta reuso deliberado de item_id
  -- entre insumos crudos de `recipes` y bases de subreceta (I02/I03/I05 —
  -- ver cabecera D.4 de subrecetas-bom-v1.sql). PR01 (Lizi/Momo) tiene en su
  -- `recipes` justamente I02 y I03. Lo que SÍ debe quedar intacta es la
  -- subreceta de MOUSSE COCO (I45, la que el bloque D usó) y el ITEM de
  -- figura_relleno activo (I54/I05) — esos son los que el modo 'subreceta'
  -- tocaría y el modo 'legacy' NO debe tocar en esta corrida.
  select stock into v_i45_pre from inventory_items where id = 'I45';
  select stock into v_i54_pre from inventory_items where id = 'I54';
  select stock into v_i05_pre from inventory_items where id = 'I05';

  r := crear_corrida(jsonb_build_object(
    'sabor', 'Vainilla test',
    'figuras', jsonb_build_array(jsonb_build_object('figura','Lizi','cant',1)),
    'idempotency_key', 'test-srb-e'
  ));
  v_corrida_id_e := r->>'corrida_id';
  v_lotes_e := r->'lotes';
  assert jsonb_array_length(v_lotes_e) = 1, 'E1 1 lote hijo esperado (Lizi 150g): '||v_lotes_e::text;
  assert (v_lotes_e->0->>'modo') = 'legacy', 'E2 modo=legacy (sabor sin subreceta): '||(v_lotes_e->0->>'modo');

  -- No se tocó la base de mousse coco (I45) ni el relleno/ganache (I54/I05):
  -- el camino legacy no conoce subrecetas, solo `recipes`.
  select stock into v_i45_post from inventory_items where id = 'I45';
  select stock into v_i54_post from inventory_items where id = 'I54';
  select stock into v_i05_post from inventory_items where id = 'I05';
  assert v_i45_post = v_i45_pre, 'E3 stock I45 (mousse coco) intacto en camino legacy';
  assert v_i54_post = v_i54_pre, 'E3b stock I54 (relleno cheesecake) intacto en camino legacy';
  assert v_i05_post = v_i05_pre, 'E3c stock I05 (ganache) intacto en camino legacy';

  -- ============ F. guard de relleno (gramaje insuficiente para el relleno) ============
  select gramos_por_unidad into v_fr01_pre from figura_relleno where id = 'FR01';
  update figura_relleno set gramos_por_unidad = 200 where id = 'FR01';

  begin
    perform crear_corrida(jsonb_build_object(
      'sabor', 'Coco',
      'figuras', jsonb_build_array(jsonb_build_object('figura','Lizi','cant',1)),
      'idempotency_key', 'test-srb-f'
    ));
    raise exception 'F1 no bloqueó relleno que no cabe en el gramaje de la figura';
  exception when others then
    if sqlerrm like '%F1%' then raise; end if;
    assert sqlerrm like '%no alcanza para descontar el relleno%',
      'F2 mensaje debe indicar "no alcanza para descontar el relleno": '||sqlerrm;
  end;

  -- Revertir el update de FR01 (el rollback final lo garantiza igual, pero
  -- se deja explícito por higiene si algún bloque posterior se agregara).
  update figura_relleno set gramos_por_unidad = v_fr01_pre where id = 'FR01';
  assert (select gramos_por_unidad from figura_relleno where id='FR01') = v_fr01_pre, 'F3 FR01 revertido';

  raise exception 'TESTS_OK — subrecetas-bom-v1 bloques A-F PASS, rollback total';
end $$;
