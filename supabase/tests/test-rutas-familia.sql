-- ============================================================================
-- MOMOS OPS — Batería de aceptación RE-EJECUTABLE · Rutas por familia v1
-- (seed de 9 rutas/63 pasos/26 estados; retrofit de figuras→R-FIG-CONG;
--  smoke de NO-regresión de crear_corrida; integridad de FKs y checks)
--
-- CÓMO CORRERLA: ejecutar este archivo COMPLETO como un solo script
-- (vía MCP execute_sql o SQL Editor). Es un patrón SIN RESIDUOS:
-- transacción + JWT simulado de U01 (Administrador) + DO con ASSERTs +
-- RAISE final ⇒ ROLLBACK TOTAL. La base queda EXACTAMENTE como estaba.
--
-- RESULTADO ESPERADO: el script TERMINA EN ERROR con el mensaje
-- «TESTS_OK — rutas-familia-v1 bloques A-D PASS, rollback total» ⇒ TODO PASÓ.
-- Cualquier OTRO error = un assert falló → leer su mensaje (A1..D3).
--
-- Requisitos mínimos: migración rutas-familia-v1.sql aplicada (rutas,
-- ruta_pasos, ruta_estados, columnas nuevas de products/production_batches,
-- retrofit de figuras mapeadas); U01 es Administrador activo; al menos una
-- figura activa con product_id (Producción v2) para el smoke de crear_corrida.
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  rec record;
  r jsonb;

  -- ---- Bloque A: seed ----
  v_rutas_count integer;
  v_pasos_count integer;
  v_estados_count integer;
  v_figura_nombre text;
  v_figura_product_id text;

  -- ---- Bloque B: retrofit ----
  v_con_figura_sin_ruta integer;
  v_sin_figura_con_ruta integer;

  -- ---- Bloque C: smoke de no-regresión ----
  v_corrida_id text;
  v_lotes jsonb;
  v_batch_id text;
  v_stock_pre numeric;
  v_stock_post numeric;
  v_vencimiento_nuevo date;

  -- ---- Bloque D: integridad ----
  v_huerfanos_pasos integer;
  v_huerfanos_estados integer;
begin
  -- ==========================================================================
  -- A. SEED: 9 rutas; 63 pasos; 26 estados; toda ruta genera_stock=true
  -- termina en ALTA_STOCK y tiene exactamente UN DESCONTAR_BOM; *_PED tienen
  -- genera_stock=false.
  -- ==========================================================================
  select count(*) into v_rutas_count from rutas;
  assert v_rutas_count = 9, 'A1 deben existir 9 rutas (8 catálogo + R-FIG-CONG), hay '||v_rutas_count;

  select count(*) into v_pasos_count from ruta_pasos;
  assert v_pasos_count = 63, 'A2 deben existir 63 pasos (verbatim del CSV), hay '||v_pasos_count;

  select count(*) into v_estados_count from ruta_estados;
  assert v_estados_count = 26, 'A3 deben existir 26 estados (3+4+4+3+3+3+2+2+2), hay '||v_estados_count;

  -- Toda ruta con genera_stock=true termina (mayor `orden`) en un estado
  -- con efecto ALTA_STOCK.
  for rec in select id from rutas where genera_stock loop
    assert exists (
      select 1 from ruta_estados re
      where re.ruta_id = rec.id
        and re.orden = (select max(orden) from ruta_estados where ruta_id = rec.id)
        and re.efecto = 'ALTA_STOCK'
    ), 'A4 la ruta '||rec.id||' (genera_stock=true) debe terminar en un estado con efecto ALTA_STOCK';
  end loop;

  -- Toda ruta tiene EXACTAMENTE un estado DESCONTAR_BOM.
  for rec in select id from rutas loop
    assert (select count(*) from ruta_estados where ruta_id = rec.id and efecto = 'DESCONTAR_BOM') = 1,
      'A5 la ruta '||rec.id||' debe tener exactamente UN estado DESCONTAR_BOM, tiene '||
      (select count(*) from ruta_estados where ruta_id = rec.id and efecto = 'DESCONTAR_BOM');
  end loop;

  -- Las rutas *_PED (bajo pedido) tienen genera_stock=false.
  assert (select count(*) from rutas where id like '%-PED' and not genera_stock) =
         (select count(*) from rutas where id like '%-PED'),
    'A6 todas las rutas *_PED deben tener genera_stock=false';
  assert (select count(*) from rutas where id like '%-PED') = 3,
    'A6b deben existir exactamente 3 rutas *_PED (SUN/MAL/CRZ), hay '||
    (select count(*) from rutas where id like '%-PED');

  -- ==========================================================================
  -- B. RETROFIT: todo product con figura mapeada tiene ruta_id='R-FIG-CONG'
  -- y estado_ficha='ACTIVO'; los productos SIN figura tienen ruta_id null;
  -- los estados de R-FIG-CONG coinciden BYTE A BYTE con los strings vivos de
  -- production_batches.estado.
  -- ==========================================================================
  select count(*) into v_con_figura_sin_ruta
  from products
  where id in (select distinct product_id from figuras where product_id is not null)
    and (ruta_id is distinct from 'R-FIG-CONG' or estado_ficha is distinct from 'ACTIVO');
  assert v_con_figura_sin_ruta = 0,
    'B1 todo product con figura mapeada debe tener ruta_id=R-FIG-CONG y estado_ficha=ACTIVO, '||
    v_con_figura_sin_ruta||' no lo cumplen';

  select count(*) into v_sin_figura_con_ruta
  from products
  where id not in (select distinct product_id from figuras where product_id is not null)
    and ruta_id is not null;
  assert v_sin_figura_con_ruta = 0,
    'B2 productos SIN figura mapeada deben tener ruta_id null, '||v_sin_figura_con_ruta||' no lo cumplen';

  -- Precondición: debe existir al menos una figura mapeada para que B1/B3
  -- sean asserts significativos (si no, B1/B2 pasan vacíos sin haber probado nada).
  assert exists (select 1 from figuras where product_id is not null and activo),
    'B0 precondición: debe existir al menos una figura activa con product_id (Producción v2)';

  -- Los 3 estados de R-FIG-CONG deben ser BYTE A BYTE los mismos strings que
  -- production_batches.estado acepta hoy ('En preparación','Congelando','Listo').
  assert (select estado from ruta_estados where ruta_id='R-FIG-CONG' and orden=1) = 'En preparación',
    'B3 R-FIG-CONG orden 1 debe ser exactamente "En preparación": '||
    (select estado from ruta_estados where ruta_id='R-FIG-CONG' and orden=1);
  assert (select estado from ruta_estados where ruta_id='R-FIG-CONG' and orden=2) = 'Congelando',
    'B4 R-FIG-CONG orden 2 debe ser exactamente "Congelando": '||
    (select estado from ruta_estados where ruta_id='R-FIG-CONG' and orden=2);
  assert (select estado from ruta_estados where ruta_id='R-FIG-CONG' and orden=3) = 'Listo',
    'B5 R-FIG-CONG orden 3 debe ser exactamente "Listo": '||
    (select estado from ruta_estados where ruta_id='R-FIG-CONG' and orden=3);

  -- Cada string de R-FIG-CONG debe estar entre los valores que el CHECK de
  -- production_batches.estado acepta HOY (leído en vivo del catálogo de
  -- Postgres, no hardcodeado en el test).
  for rec in select estado from ruta_estados where ruta_id = 'R-FIG-CONG' loop
    assert exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      where t.relname = 'production_batches'
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like '%' || rec.estado || '%'
    ), 'B6 el estado "'||rec.estado||'" de R-FIG-CONG debe existir en el CHECK vivo de production_batches.estado';
  end loop;

  -- ==========================================================================
  -- C. SMOKE DE NO-REGRESIÓN: crear_corrida sigue funcionando igual (lote
  -- hijo nace 'En preparación', stock/inventario se mueven como siempre) y
  -- production_batches.vencimiento existe y queda NULL en lotes nuevos.
  -- ==========================================================================
  select f.nombre, f.product_id into v_figura_nombre, v_figura_product_id
  from figuras f where f.product_id is not null and f.activo limit 1;
  assert v_figura_nombre is not null, 'C0 precondición: debe existir una figura activa con producto asignado';

  select stock into v_stock_pre from products where id = v_figura_product_id;

  r := crear_corrida(jsonb_build_object(
    'sabor', 'Test rutas-familia smoke',
    'figuras', jsonb_build_array(jsonb_build_object('figura', v_figura_nombre, 'cant', 1)),
    'idempotency_key', 'test-rutasfam-c'
  ));
  v_corrida_id := r->>'corrida_id';
  v_lotes := r->'lotes';
  assert v_corrida_id like 'CR-%', 'C1 crear_corrida sigue devolviendo un id CR-*: '||v_corrida_id;
  assert jsonb_array_length(v_lotes) >= 1, 'C2 crear_corrida sigue derivando al menos 1 lote hijo';

  v_batch_id := v_lotes->0->>'batch_id';
  assert v_batch_id like 'L-%', 'C3 el lote hijo sigue naciendo con id L-*: '||v_batch_id;
  assert (select estado from production_batches where id = v_batch_id) = 'En preparación',
    'C4 el lote hijo sigue naciendo en estado "En preparación": '||
    (select estado from production_batches where id = v_batch_id);
  assert (select prod from production_batches where id = v_batch_id) > 0,
    'C5 el lote hijo sigue naciendo con prod > 0';
  assert (select perfectas + imperfectas + descartadas from production_batches where id = v_batch_id) = 0,
    'C6 desmolde diferido intacto: perfectas+imperfectas+descartadas=0 al nacer';

  -- products.stock NO se mueve al crear la corrida (desmolde diferido —
  -- stock_contabilizado=false hasta desmoldar_lote/set_lote_estado 'Listo').
  select stock into v_stock_post from products where id = v_figura_product_id;
  assert v_stock_post = v_stock_pre,
    'C7 products.stock no se mueve al CREAR la corrida (desmolde diferido): pre='||v_stock_pre||' post='||v_stock_post;

  -- production_batches.vencimiento existe (columna nueva) y queda NULL en
  -- lotes creados por crear_corrida (sin lógica en esta etapa).
  select vencimiento into v_vencimiento_nuevo from production_batches where id = v_batch_id;
  assert v_vencimiento_nuevo is null,
    'C8 production_batches.vencimiento debe existir y quedar NULL en lotes nuevos (Etapa A sin lógica), fue '||v_vencimiento_nuevo;

  -- ==========================================================================
  -- D. INTEGRIDAD: FKs de ruta_pasos/ruta_estados sin huérfanos; el CHECK de
  -- products.estado_ficha rechaza un valor inválido.
  -- ==========================================================================
  select count(*) into v_huerfanos_pasos
  from ruta_pasos rp where not exists (select 1 from rutas r where r.id = rp.ruta_id);
  assert v_huerfanos_pasos = 0, 'D1 ruta_pasos sin huérfanos (FK a rutas), encontrados '||v_huerfanos_pasos;

  select count(*) into v_huerfanos_estados
  from ruta_estados re where not exists (select 1 from rutas r where r.id = re.ruta_id);
  assert v_huerfanos_estados = 0, 'D2 ruta_estados sin huérfanos (FK a rutas), encontrados '||v_huerfanos_estados;

  begin
    update products set estado_ficha = 'ESTADO_INVENTADO_QUE_NO_EXISTE' where id = v_figura_product_id;
    raise exception 'D3 no bloqueó un estado_ficha inválido';
  exception when others then
    if sqlerrm like '%D3%' then raise; end if;
    assert sqlerrm like '%estado_ficha%' or sqlerrm like '%check constraint%' or sqlerrm like '%violates%',
      'D3b el UPDATE inválido debe fallar por el CHECK de estado_ficha: '||sqlerrm;
  end;

  raise exception 'TESTS_OK — rutas-familia-v1 bloques A-D PASS, rollback total';
end $$;
