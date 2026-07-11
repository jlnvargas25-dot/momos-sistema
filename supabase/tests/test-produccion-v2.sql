-- ============================================================================
-- MOMOS OPS — Batería de aceptación RE-EJECUTABLE · Producción v2
-- (corridas flexibles por figuras, agrupación por producto+gramaje, desmolde
-- diferido, guard de set_lote_estado→Listo)
--
-- CÓMO CORRERLA: ejecutar este archivo COMPLETO como un solo script
-- (vía MCP execute_sql o SQL Editor). Es un patrón SIN RESIDUOS:
-- transacción + JWT simulado de U01 (Administrador) + DO con ASSERTs +
-- RAISE final ⇒ ROLLBACK TOTAL. La base queda EXACTAMENTE como estaba.
--
-- RESULTADO ESPERADO: el script TERMINA EN ERROR con el mensaje
-- «TESTS_OK — los 4 bloques PASS, rollback total» ⇒ TODO PASÓ.
-- Cualquier OTRO error = un assert falló → leer su mensaje (A1..D7).
--
-- Re-ejecutable con la base en cualquier estado: los asserts de ids son por
-- PATRÓN (no números absolutos), los de stock/receta son RELATIVOS al estado
-- capturado antes de cada efecto. Requisitos mínimos: figuras Lizi/Momo/Toby/
-- Max/Rocco/Danna/Teo existen con product_id asignado (PR01/PR02/PR04), PR01
-- tiene receta (RC01-RC04) y U01 es Administrador activo.
--
-- CUÁNDO CORRERLA: después de aplicar rpc-produccion-v2.sql (regresión),
-- y en cada regresión futura junto con test-slice2-produccion.sql.
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  r jsonb;
  v_corrida_id text;
  v_corrida_id2 text;
  v_lotes jsonb;
  v_lote_lizi text;
  v_lote_momo text;
  v_lote_max text;
  v_lote_teo text;
  v_lote record;
  v_pr01_pre numeric;
  v_pr01_post numeric;
  v_pre jsonb;
  v_req numeric;
  v_toma numeric;
  rec record;
  v_batch_count_pre integer;
  v_batch_count_post integer;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  -- ============ A. crear_corrida — camino feliz ============
  -- Payload: Coco, 4 figuras que caen en 4 grupos distintos:
  --   Lizi(1)→PR01/150, Momo(2)→PR01/180 [grupo SEPARADO de Lizi por gramaje],
  --   Max(1)→PR02/180, Teo(1)→PR04/250.
  select jsonb_object_agg(rc.item_id, jsonb_build_object('cant', rc.cantidad, 'stock', it.stock))
    into v_pre
  from recipes rc join inventory_items it on it.id = rc.item_id
  where rc.product_id = 'PR01';

  select stock into v_pr01_pre from products where id = 'PR01';

  r := crear_corrida(jsonb_build_object(
    'sabor', 'Coco',
    'figuras', jsonb_build_array(
      jsonb_build_object('figura','Lizi','cant',1),
      jsonb_build_object('figura','Momo','cant',2),
      jsonb_build_object('figura','Max','cant',1),
      jsonb_build_object('figura','Teo','cant',1)
    ),
    'idempotency_key', 'test-pv2-a'
  ));
  v_corrida_id := r->>'corrida_id';
  v_lotes := r->'lotes';
  assert v_corrida_id like 'CR-%', 'A1 formato id corrida: '||v_corrida_id;
  assert jsonb_array_length(v_lotes) = 4,
    'A2 4 lotes hijos esperados, hubo '||jsonb_array_length(v_lotes)||': '||v_lotes::text;

  -- Ubicar cada lote hijo por (product_id, gramaje_g) — no por orden de array.
  select b->>'batch_id' into v_lote_lizi from jsonb_array_elements(v_lotes) b
    where b->>'product_id'='PR01' and (b->>'gramaje_g')::int=150;
  select b->>'batch_id' into v_lote_momo from jsonb_array_elements(v_lotes) b
    where b->>'product_id'='PR01' and (b->>'gramaje_g')::int=180;
  select b->>'batch_id' into v_lote_max from jsonb_array_elements(v_lotes) b
    where b->>'product_id'='PR02' and (b->>'gramaje_g')::int=180;
  select b->>'batch_id' into v_lote_teo from jsonb_array_elements(v_lotes) b
    where b->>'product_id'='PR04' and (b->>'gramaje_g')::int=250;

  assert v_lote_lizi like 'L-%', 'A3 lote Lizi (PR01/150) no encontrado: '||v_lotes::text;
  assert v_lote_momo like 'L-%', 'A3 lote Momo (PR01/180) no encontrado: '||v_lotes::text;
  assert v_lote_momo <> v_lote_lizi, 'A3b Momo debe ser un lote SEPARADO de Lizi (gramaje distinto)';
  assert v_lote_max like 'L-%', 'A3 lote Max (PR02/180) no encontrado: '||v_lotes::text;
  assert v_lote_teo like 'L-%', 'A3 lote Teo (PR04/250) no encontrado: '||v_lotes::text;

  -- Prod correcto por grupo (Lizi=1, Momo=2, Max=1, Teo=1).
  assert (select prod from production_batches where id=v_lote_lizi) = 1, 'A4 prod lote Lizi';
  assert (select prod from production_batches where id=v_lote_momo) = 2, 'A4 prod lote Momo';
  assert (select prod from production_batches where id=v_lote_max) = 1, 'A4 prod lote Max';
  assert (select prod from production_batches where id=v_lote_teo) = 1, 'A4 prod lote Teo';

  -- perfectas=imperfectas=descartadas=0 en TODOS (desmolde diferido).
  for v_lote in select id from production_batches where id in (v_lote_lizi, v_lote_momo, v_lote_max, v_lote_teo)
  loop
    assert (select perfectas from production_batches where id=v_lote.id) = 0
       and (select imperfectas from production_batches where id=v_lote.id) = 0
       and (select descartadas from production_batches where id=v_lote.id) = 0,
      'A5 conteos en 0 para '||v_lote.id;
    assert (select estado from production_batches where id=v_lote.id) = 'En preparación',
      'A6 estado En preparación para '||v_lote.id;
    assert not (select stock_contabilizado from production_batches where id=v_lote.id),
      'A7 stock_contabilizado=false para '||v_lote.id;
    assert (select corrida_id from production_batches where id=v_lote.id) = v_corrida_id,
      'A8 corrida_id compartido para '||v_lote.id;
    assert (select fecha from production_batches where id=v_lote.id) = v_hoy,
      'A9 fecha = hoy Bogotá para '||v_lote.id;
    assert (select vence from production_batches where id=v_lote.id) = v_hoy + 14,
      'A10 vence = fecha+14 para '||v_lote.id;
  end loop;

  -- figuras jsonb con composición correcta (Momo lleva SOLO Momo, cant=2).
  assert (select figuras from production_batches where id=v_lote_momo)
       = jsonb_build_array(jsonb_build_object('figura','Momo','cant',2)),
    'A11 composición figuras del lote Momo: '||(select figuras::text from production_batches where id=v_lote_momo);
  assert (select figuras from production_batches where id=v_lote_lizi)
       = jsonb_build_array(jsonb_build_object('figura','Lizi','cant',1)),
    'A11b composición figuras del lote Lizi: '||(select figuras::text from production_batches where id=v_lote_lizi);

  -- Receta: descuento = requerido×prod por producto (con least/clamp), solo
  -- aplica a PR01 (Lizi+Momo=3 unidades) — PR02/PR04 no tienen recipes.
  for rec in select key as item_id, (value->>'cant')::numeric as cant, (value->>'stock')::numeric as s_pre
             from jsonb_each(v_pre)
  loop
    v_req := round(rec.cant * 3, 3);  -- prod total de PR01 en esta corrida: 1(Lizi)+2(Momo)=3
    v_toma := least(rec.s_pre, v_req);
    assert (select stock from inventory_items where id = rec.item_id) = round(rec.s_pre - v_toma, 3),
      'A12 stock '||rec.item_id||': '||(select stock from inventory_items where id = rec.item_id)||' esperado '||round(rec.s_pre - v_toma, 3);
  end loop;
  assert (select count(*) from inventory_movements where batch_id in (v_lote_lizi, v_lote_momo) and tipo='Uso en producción')
       = (select count(*) from jsonb_each(v_pre) where round((value->>'cant')::numeric*3,3) > 0 and (value->>'stock')::numeric > 0) * 2,
    'A13 movimientos con batch_id (uno por insumo, por CADA lote hijo de PR01)';

  -- ============ A.Idempotencia ============
  select count(*) into v_batch_count_pre from production_batches where corrida_id = v_corrida_id;
  r := crear_corrida(jsonb_build_object(
    'sabor', 'Coco',
    'figuras', jsonb_build_array(jsonb_build_object('figura','Lizi','cant',1)),
    'idempotency_key', 'test-pv2-a'
  ));
  assert (r->>'idempotente')::boolean, 'A14 segunda llamada misma key debe ser idempotente';
  assert r->>'corrida_id' = v_corrida_id, 'A15 mismo corrida_id en la llamada idempotente';
  select count(*) into v_batch_count_post from production_batches where corrida_id = v_corrida_id;
  assert v_batch_count_post = v_batch_count_pre, 'A16 count de lotes sin cambio tras idempotencia';
  assert (select count(*) from corridas where idempotency_key = 'test-pv2-a') = 1, 'A17 una sola corrida';

  -- ============ B. desmoldar_lote ============
  -- Sobre el hijo de Momo (prod=2): desmoldar (1,1,0).
  select stock into v_pr01_pre from products where id = 'PR01';
  r := desmoldar_lote(v_lote_momo, 1, 1, 0);
  assert (select estado from production_batches where id=v_lote_momo) = 'Listo', 'B1 estado Listo tras desmolde';
  assert (select perfectas from production_batches where id=v_lote_momo) = 1
     and (select imperfectas from production_batches where id=v_lote_momo) = 1
     and (select descartadas from production_batches where id=v_lote_momo) = 0,
    'B2 conteos guardados (1,1,0)';
  select stock into v_pr01_post from products where id = 'PR01';
  assert v_pr01_post = v_pr01_pre + 1, 'B3 stock PR01 +1 (solo perfectas)';
  assert (select stock_contabilizado from production_batches where id=v_lote_momo), 'B4 stock_contabilizado=true';

  -- Guards.
  begin
    perform desmoldar_lote(v_lote_lizi, 1, 1, 0);  -- suma 2, prod=1 → no cuadra
    raise exception 'B5 no bloqueó suma≠prod';
  exception when others then
    if sqlerrm like '%B5%' then raise; end if;
  end;

  begin
    perform desmoldar_lote(v_lote_momo, 1, 1, 0);  -- ya desmoldado
    raise exception 'B6 no bloqueó re-desmolde';
  exception when others then
    if sqlerrm like '%B6%' then raise; end if;
  end;

  begin
    perform desmoldar_lote(v_lote_lizi, -1, 1, 1);  -- conteo negativo
    raise exception 'B7 no bloqueó conteo negativo';
  exception when others then
    if sqlerrm like '%B7%' then raise; end if;
  end;

  begin
    perform desmoldar_lote('L-NOEXISTE-999', 1, 0, 0);
    raise exception 'B8 no bloqueó lote inexistente';
  exception when others then
    if sqlerrm like '%B8%' then raise; end if;
  end;

  -- set_lote_estado directo→'Listo' sobre OTRO hijo aún 0/0/0 (Lizi) DEBE fallar.
  begin
    perform set_lote_estado(v_lote_lizi, 'Listo');
    raise exception 'B9 set_lote_estado no bloqueó Listo directo sin desmolde';
  exception when others then
    if sqlerrm like '%B9%' then raise; end if;
  end;

  -- Reversa: al lote desmoldado (Momo), set_lote_estado→'Congelando' resta stock.
  select stock into v_pr01_pre from products where id = 'PR01';
  r := set_lote_estado(v_lote_momo, 'Congelando');
  select stock into v_pr01_post from products where id = 'PR01';
  assert v_pr01_post = v_pr01_pre - 1, 'B10 reversa: stock PR01 -1';
  assert not (select stock_contabilizado from production_batches where id=v_lote_momo), 'B11 flag off tras reversa';

  -- Luego set_lote_estado→'Listo' DIRECTO (conteos ya cuadran 1+1+0=2=prod) PASA
  -- y re-suma stock +1 (paridad lotes cuadrados).
  select stock into v_pr01_pre from products where id = 'PR01';
  r := set_lote_estado(v_lote_momo, 'Listo');
  select stock into v_pr01_post from products where id = 'PR01';
  assert (select estado from production_batches where id=v_lote_momo) = 'Listo', 'B12 estado Listo tras re-set directo';
  assert v_pr01_post = v_pr01_pre + 1, 'B13 re-suma stock +1 (paridad lotes cuadrados)';
  assert (select stock_contabilizado from production_batches where id=v_lote_momo), 'B14 flag on tras re-set';

  -- ============ C. Validaciones de crear_corrida ============
  -- C1: figuras vacío.
  begin
    perform crear_corrida(jsonb_build_object('sabor','Coco','figuras','[]'::jsonb));
    raise exception 'C1 no bloqueó figuras vacío';
  exception when others then
    if sqlerrm like '%C1%' then raise; end if;
  end;

  -- C2: figura inexistente.
  begin
    perform crear_corrida(jsonb_build_object('sabor','Coco','figuras',
      jsonb_build_array(jsonb_build_object('figura','NoExiste','cant',1))));
    raise exception 'C2 no bloqueó figura inexistente';
  exception when others then
    if sqlerrm like '%C2%' then raise; end if;
  end;

  -- C3: cant 0.
  begin
    perform crear_corrida(jsonb_build_object('sabor','Coco','figuras',
      jsonb_build_array(jsonb_build_object('figura','Lizi','cant',0))));
    raise exception 'C3 no bloqueó cant=0';
  exception when others then
    if sqlerrm like '%C3%' then raise; end if;
  end;

  -- C4: cant 2.5 (jsonb numérico decimal) → error AMIGABLE, no cast nativo.
  begin
    perform crear_corrida(jsonb_build_object('sabor','Coco','figuras',
      jsonb_build_array(jsonb_build_object('figura','Lizi','cant',2.5))));
    raise exception 'C4 no bloqueó cantidad decimal';
  exception when others then
    assert sqlerrm not like '%invalid input syntax%' and sqlerrm not like '%invalid_text_representation%',
      'C4 el error de cantidad decimal debe ser amigable, no el cast nativo: '||sqlerrm;
    if sqlerrm like '%C4%' then raise; end if;
  end;

  -- C5: figura repetida en el payload → SUMA (1 lote PR01/150 con prod=3).
  r := crear_corrida(jsonb_build_object(
    'sabor', 'Coco',
    'figuras', jsonb_build_array(
      jsonb_build_object('figura','Lizi','cant',1),
      jsonb_build_object('figura','Lizi','cant',2)
    ),
    'idempotency_key', 'test-pv2-c5'
  ));
  assert jsonb_array_length(r->'lotes') = 1, 'C5 debe generar 1 solo lote (figura repetida se suma)';
  assert ((r->'lotes')->0->>'prod')::int = 3, 'C5 prod sumado = 3: '||(r->'lotes')::text;

  -- C6: figura activa SIN product_id → error claro.
  insert into figuras (nombre, especie, gramaje_g, activo, product_id)
    values ('TestSinProducto', 'gato', 150, true, null)
    on conflict (nombre) do update set activo=true, product_id=null;
  begin
    perform crear_corrida(jsonb_build_object('sabor','Coco','figuras',
      jsonb_build_array(jsonb_build_object('figura','TestSinProducto','cant',1))));
    raise exception 'C6 no bloqueó figura sin producto asignado';
  exception when others then
    assert sqlerrm like '%no tiene producto asignado%', 'C6 mensaje debe indicar "no tiene producto asignado": '||sqlerrm;
  end;

  -- C7: sabor vacío.
  begin
    perform crear_corrida(jsonb_build_object('sabor','','figuras',
      jsonb_build_array(jsonb_build_object('figura','Lizi','cant',1))));
    raise exception 'C7 no bloqueó sabor vacío';
  exception when others then
    if sqlerrm like '%C7%' then raise; end if;
  end;

  -- ============ D. Datos del catálogo post-migración ============
  assert (select gramaje_g from figuras where nombre='Lizi') = 150, 'D1 Lizi gramaje_g=150';
  assert (select product_id from figuras where nombre='Lizi') = 'PR01', 'D1 Lizi product_id=PR01';
  assert (select gramaje_g from figuras where nombre='Momo') = 180, 'D2 Momo gramaje_g=180';
  assert (select product_id from figuras where nombre='Momo') = 'PR01', 'D2 Momo product_id=PR01';
  assert (select gramaje_g from figuras where nombre='Toby') = 180, 'D3 Toby gramaje_g=180';
  assert (select product_id from figuras where nombre='Toby') = 'PR01', 'D3 Toby product_id=PR01';
  assert (select gramaje_g from figuras where nombre='Teo') = 250, 'D4 Teo gramaje_g=250';
  assert (select product_id from figuras where nombre='Teo') = 'PR04', 'D4 Teo product_id=PR04';
  assert (select gramaje_g from figuras where nombre='Max') = 180, 'D5 Max gramaje_g=180';
  assert (select product_id from figuras where nombre='Max') = 'PR02', 'D5 Max product_id=PR02';
  assert (select gramaje_g from figuras where nombre='Rocco') = 180, 'D6 Rocco gramaje_g=180';
  assert (select product_id from figuras where nombre='Rocco') = 'PR02', 'D6 Rocco product_id=PR02';
  assert (select gramaje_g from figuras where nombre='Danna') = 180, 'D7 Danna gramaje_g=180';
  assert (select product_id from figuras where nombre='Danna') = 'PR02', 'D7 Danna product_id=PR02';

  raise exception 'TESTS_OK — los 4 bloques PASS, rollback total';
end $$;
