-- ============================================================================
-- MOMOS OPS — Batería de aceptación RE-EJECUTABLE · Slice 2 + gancho sedes
-- (lotes de producción, WAC de inventario, reclamos, herencia de SEDE-01)
--
-- CÓMO CORRERLA: ejecutar este archivo COMPLETO como un solo script
-- (vía MCP execute_sql o SQL Editor). Es un patrón SIN RESIDUOS:
--   transacción + JWT simulado de U01 (Administrador) + DO con ASSERTs +
--   RAISE final ⇒ ROLLBACK TOTAL. La base queda EXACTAMENTE como estaba.
--
-- RESULTADO ESPERADO: el script TERMINA EN ERROR con el mensaje
--   «TESTS_OK — los 4 bloques PASS, rollback total»  ⇒ TODO PASÓ ✅
-- Cualquier OTRO error = un assert falló → leer su mensaje (A1..D2).
--
-- Re-ejecutable con la base en cualquier estado: los asserts de ids son por
-- PATRÓN (no números absolutos), los de stock/costo son RELATIVOS al estado
-- capturado antes de cada efecto, y los de auditoría se filtran por la
-- entidad creada en ESTE run. Requisitos mínimos: PR01 existe (momo, activo,
-- con receta), I01 existe con stock ≥ 0 y U01 es Administrador activo.
--
-- CUÁNDO CORRERLA: después de CADA migración futura (regresión).
-- ============================================================================

begin;
select set_config('request.jwt.claims', '{"sub":"992a7036-77fa-4c52-a764-e164bdc75e6e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  r jsonb; v_batch text; v_claim text;
  v_pre jsonb; rec record;
  v_req numeric; v_toma numeric;
  v_pr01 numeric;
  s0 numeric; c0 numeric; wac numeric;
  v_item text;
  v_prov text;
  v_ord text := 'P-TEST-S2';
begin
  -- ============ A. CICLO DE LOTE ============
  select stock into v_pr01 from products where id='PR01';
  select jsonb_object_agg(rc.item_id, jsonb_build_object('cant', rc.cantidad, 'stock', it.stock))
    into v_pre
  from recipes rc join inventory_items it on it.id = rc.item_id
  where rc.product_id = 'PR01';

  r := crear_lote(jsonb_build_object('product_id','PR01','prod',4,'figura','Lizi','sabor','Oreo','idempotency_key','test-s2-a'));
  v_batch := r->>'batch_id';
  assert v_batch like 'L-%', 'A1 formato id lote: '||v_batch;
  assert (select estado from production_batches where id=v_batch) = 'En preparación', 'A2 estado inicial';
  assert (select sede_id from production_batches where id=v_batch) = 'SEDE-01', 'A2b lote hereda SEDE-01';

  for rec in select key as item_id, (value->>'cant')::numeric as cant, (value->>'stock')::numeric as s_pre from jsonb_each(v_pre) loop
    v_req := round(rec.cant * 4, 3);
    v_toma := least(rec.s_pre, v_req);
    assert (select stock from inventory_items where id = rec.item_id) = round(rec.s_pre - v_toma, 3),
      'A3 stock '||rec.item_id||': '||(select stock from inventory_items where id = rec.item_id)||' esperado '||round(rec.s_pre - v_toma, 3);
  end loop;
  assert (select count(*) from inventory_movements where batch_id = v_batch and tipo='Uso en producción')
       = (select count(*) from jsonb_each(v_pre) where (value->>'stock')::numeric > 0 and round((value->>'cant')::numeric*4,3) > 0),
       'A4 movimientos con batch_id';

  r := crear_lote(jsonb_build_object('product_id','PR01','prod',4,'idempotency_key','test-s2-a'));
  assert (r->>'idempotente')::boolean and r->>'batch_id' = v_batch, 'A5 idempotente';
  assert (select count(*) from production_batches where idempotency_key='test-s2-a') = 1, 'A6 un solo lote';

  r := empezar_congelamiento(v_batch);
  assert (select estado from production_batches where id=v_batch)='Congelando', 'A7 congelando';
  assert (select inicio_congelacion from production_batches where id=v_batch) is not null, 'A8 sello inicio_congelacion';
  begin
    perform empezar_congelamiento(v_batch);
    raise exception 'A9 el wrapper no rechazó un lote que no está En preparación';
  exception when others then
    if sqlerrm like '%A9%' then raise; end if;
  end;

  r := set_lote_estado(v_batch,'Listo');
  assert (select stock from products where id='PR01') = v_pr01 + 4, 'A10 stock sumado (perfectas=4)';
  assert (select stock_contabilizado from production_batches where id=v_batch), 'A11 flag on';

  r := set_lote_estado(v_batch,'Vendido');
  assert (select stock from products where id='PR01') = v_pr01 + 4, 'A12 Vendido NO resta';

  r := set_lote_estado(v_batch,'En preparación');
  assert (select stock from products where id='PR01') = v_pr01, 'A13 reversa exacta';
  assert not (select stock_contabilizado from production_batches where id=v_batch), 'A14 flag off';

  begin
    perform crear_lote(jsonb_build_object('product_id','PR01','prod',2,'perfectas',5));
    raise exception 'A15 no bloqueó perfectas > prod';
  exception when others then
    if sqlerrm like '%A15%' then raise; end if;
  end;

  -- audits del lote de ESTE run: creado + 4 cambios de estado = 5
  assert (select count(*) from audit_logs where entidad='Lote' and entidad_id=v_batch) = 5,
    'A16 audits del lote: '||(select count(*) from audit_logs where entidad='Lote' and entidad_id=v_batch);

  -- ============ B. WAC / INVENTARIO ============
  select stock, costo into s0, c0 from inventory_items where id='I01';
  r := entrada_insumo('I01', 1.2, 48000, 'test WAC');
  wac := round((s0*c0 + 1.2*(48000/1.2)) / (s0+1.2), 4);
  assert (select costo from inventory_items where id='I01') = wac,
    'B1 WAC: '||(select costo from inventory_items where id='I01')||' esperado '||wac;
  assert (select stock from inventory_items where id='I01') = round(s0+1.2,2), 'B2 stock';

  r := entrada_insumo('I01', 1, 0);
  assert (select costo from inventory_items where id='I01') = wac, 'B3 entrada sin costo NO diluye';
  assert (select stock from inventory_items where id='I01') = round(s0+2.2,2), 'B4 stock tras entrada gratis';

  begin
    perform entrada_insumo('I01', 1, -5);
    raise exception 'B5 no bloqueó costo negativo';
  exception when others then
    if sqlerrm like '%B5%' then raise; end if;
  end;
  begin
    perform movimiento_insumo('I01','Salida', 5);
    raise exception 'B6 no bloqueó Salida positiva';
  exception when others then
    if sqlerrm like '%B6%' then raise; end if;
  end;

  r := movimiento_insumo('I01','Merma',-0.5,'test merma');
  assert (select stock from inventory_items where id='I01') = round(s0+2.2-0.5,2), 'B7 merma resta';
  assert (select costo from inventory_items where id='I01') = wac, 'B8 merma no toca costo';

  r := crear_insumo(jsonb_build_object('nombre','Insumo Test S2','cat','Ingredientes','unidad','kg','stock',2,'costo_total',10000));
  v_item := r->>'item_id';
  assert v_item like 'I%', 'B9 formato id insumo: '||v_item;
  assert (r->>'costo')::numeric = 5000, 'B10 costo unitario total/stock';
  assert (select sede_id from inventory_items where id=v_item) = 'SEDE-01', 'B10b insumo hereda SEDE-01';
  begin
    perform crear_insumo(jsonb_build_object('nombre','insumo test s2','cat','Ingredientes','unidad','kg'));
    raise exception 'B11 no bloqueó duplicado case-insensitive';
  exception when others then
    if sqlerrm like '%B11%' then raise; end if;
  end;

  -- ============ C. RECLAMOS ============
  insert into customers (id, nombre) values ('C-TEST-S2','Cliente Test');
  insert into orders (id, fecha, hora, canal, customer_id) values (v_ord, current_date, current_time, 'WhatsApp', 'C-TEST-S2');

  r := crear_reclamo(v_ord);
  v_claim := r->>'claim_id';
  assert v_claim like 'R-%', 'C1 formato id reclamo: '||v_claim;
  assert (select estado from orders where id=v_ord)='Reclamo', 'C2 pedido movido a Reclamo';
  assert (select estado from claims where id=v_claim)='Abierto', 'C3 claim Abierto';
  assert (select reclamo_en from claims where id=v_claim) is not null, 'C3b reclamo_en sellado';

  begin
    perform crear_reclamo(v_ord);
    raise exception 'C4 no bloqueó doble reclamo';
  exception when others then
    if sqlerrm like '%C4%' then raise; end if;
  end;

  r := set_reclamo_estado(v_claim,'Aprobado');
  assert (select estado from claims where id=v_claim)='Aprobado', 'C5 estado libre';
  r := editar_reclamo(v_claim, jsonb_build_object('costo', 15000, 'decision','Compensar con reposición'));
  assert (select costo from claims where id=v_claim) = 15000, 'C6 costo editado';
  assert (select decision from claims where id=v_claim) = 'Compensar con reposición', 'C6b decision';
  begin
    perform editar_reclamo(v_claim, jsonb_build_object('costo', -1));
    raise exception 'C7 no bloqueó costo negativo';
  exception when others then
    if sqlerrm like '%C7%' then raise; end if;
  end;

  -- audits del reclamo de ESTE run: creado + cambio de estado + editado = 3
  assert (select count(*) from audit_logs where entidad='Reclamo' and entidad_id=v_claim) = 3,
    'C8 audits del reclamo: '||(select count(*) from audit_logs where entidad='Reclamo' and entidad_id=v_claim);

  -- ============ D. RETROCESO #14 + RECLAMO EN RUTA (fix 2026-07-10) ============
  -- Un reclamo con el pedido 'En ruta' NO debe resetear el domicilio ni borrar
  -- h_salida (decisión: el reclamo es bandera comercial, no retroceso logístico).
  insert into orders (id, fecha, hora, canal, customer_id, estado)
    values ('P-TEST-S2B', current_date, current_time, 'WhatsApp', 'C-TEST-S2', 'En ruta');
  -- proveedor: FK a proveedores_domicilio (dominio cerrado) → se toma uno real
  -- del catálogo; si el catálogo está vacío se siembra uno sintético (rollback).
  select nombre into v_prov from proveedores_domicilio order by nombre limit 1;
  if v_prov is null then
    insert into proveedores_domicilio (nombre) values ('Test Mensajero') returning nombre into v_prov;
  end if;
  insert into deliveries (id, order_id, proveedor, estado, h_salida)
    values ('D-TEST-S2', 'P-TEST-S2B', v_prov, 'En ruta', localtime);

  r := crear_reclamo('P-TEST-S2B');
  assert (select estado from orders where id='P-TEST-S2B')='Reclamo', 'D1 pedido en Reclamo';
  assert (select estado from deliveries where id='D-TEST-S2')='En ruta'
     and (select h_salida from deliveries where id='D-TEST-S2') is not null,
    'D2 el domicilio NO se reseteó (estado='||(select estado from deliveries where id='D-TEST-S2')||', h_salida preservada)';

  raise exception 'TESTS_OK — los 4 bloques PASS, rollback total';
end $$;
