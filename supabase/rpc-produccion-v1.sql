-- ============================================================================
-- MOMOS OPS — RPCs Postgres de Producción/Lotes, Inventario (WAC) y Reclamos (v1)
-- Target: Supabase / PostgreSQL 17. Fuente de verdad de columnas: schema-v5.sql.
-- Fuente de verdad de lógica: src/MomosOps.jsx (maqueta), portada FIEL +
-- hardenings puntuales marcados explícitamente en cada RPC.
--
-- Convenciones heredadas de rpc-pedidos-v1.sql (slice 1) — NO se redefinen acá:
--   is_staff(), next_id(), _add_movement(...), _add_audit(...), set_order_status(...).
--
-- NOTA: _deduct_recipe(...) del slice 1 solo acepta p_order_id (no batch_id),
-- y el movimiento de un lote necesita batch_id seteado en inventory_movements
-- (para trazabilidad "Uso en producción" → Lote). Por eso crear_lote() NO
-- reusa _deduct_recipe: implementa su propio descuento de receta inline,
-- llamando a _add_movement(...) directo con p_batch_id. Sí reusa _add_movement
-- y _add_audit tal cual exige la regla dura de "ningún insert directo".
--
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

-- ============================================================================
-- 0) Columnas guard (flags/columnas atómicas que este slice necesita y el
--    schema todavía no tiene)
-- ============================================================================

alter table production_batches add column if not exists idempotency_key text unique;

-- Duplicado de insumo bajo carrera: el chequeo EXISTS de crear_insumo no alcanza
-- con dos transacciones concurrentes — el índice único case-insensitive es el
-- árbitro real (crear_insumo captura unique_violation con el mensaje amigable).
create unique index if not exists inv_items_nombre_uq on inventory_items (lower(nombre));

-- Seed defensivo de counters: en la base viva ya están sembrados por
-- seed-catalogos.sql — esto es red de seguridad para deploys frescos, para que
-- los pads L-019 / R-033 / I15 / M / A arranquen donde la maqueta los dejó.
insert into counters(clave, valor) values
  ('batch',18),('claim',32),('invitem',14),('movement',7),('audit',5)
on conflict (clave) do nothing;

-- ============================================================================
-- 1) RPCs de Producción / Lotes
-- ============================================================================

-- ---------------------------------------------------------------------------
-- crear_lote(p jsonb) returns jsonb
-- Payload: {product_id, figura?, sabor?, relleno?, salsa?, gramaje_g?, prod,
--   perfectas?, imperfectas?, descartadas?, resp_user_id?, vence?,
--   horas_congelacion?, obs?, molde?, ubicacion?, sugerencia_id?, idempotency_key?}
--
-- Descuenta receta por `prod` (no por perfectas) — el lote se crea IGUAL con
-- faltantes (paridad-maqueta: acá no hay bloqueo por stock insuficiente).
-- NO suma stock del producto acá — eso ocurre solo al pasar a 'Listo'
-- (ver set_lote_estado). El consumo de receta del lote es IRREVERSIBLE
-- (no se crean reservas: a diferencia de pedidos, un lote no se "cancela"
-- devolviendo insumos — decisión de paridad, documentada en la spec).
-- ---------------------------------------------------------------------------
create or replace function crear_lote(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_idem text := nullif(p->>'idempotency_key','');
  v_existing_id text;
  v_id text;
  v_product_id text := p->>'product_id';
  v_prod record;
  v_gramaje_g integer;
  v_prod_cant integer;
  v_perfectas integer;
  v_imperfectas integer;
  v_descartadas integer;
  v_resp_user_id text := nullif(p->>'resp_user_id','');
  v_vence date;
  v_horas_congelacion numeric;
  v_obs text := coalesce(p->>'obs','');
  v_molde text := nullif(p->>'molde','');
  v_ubicacion text := nullif(p->>'ubicacion','');
  v_sugerencia_id text := nullif(p->>'sugerencia_id','');
  v_sug record;
  v_fecha date := (now() at time zone 'America/Bogota')::date;
  v_faltantes jsonb := '[]'::jsonb;
  rec record;
  v_req numeric;
  v_toma numeric;
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede crear lotes de producción';
  end if;

  -- Idempotencia: mismo idempotency_key ya usado → devolver lote existente sin efectos
  if v_idem is not null then
    select id into v_existing_id from production_batches where idempotency_key = v_idem;
    if v_existing_id is not null then
      return jsonb_build_object('batch_id', v_existing_id, 'faltantes', '[]'::jsonb, 'idempotente', true);
    end if;
  end if;

  -- Validaciones
  select id, nombre, tipo, activo into v_prod from products where id = v_product_id;
  if v_prod.id is null then
    raise exception 'El producto % no existe', v_product_id;
  end if;
  if v_prod.tipo <> 'momo' then
    raise exception 'Solo se pueden crear lotes de productos tipo momo (producto % es %)', v_product_id, v_prod.tipo;
  end if;
  if not v_prod.activo then
    raise exception 'El producto % está dado de baja.', v_prod.nombre;
  end if;

  v_prod_cant := (p->>'prod')::integer;
  if v_prod_cant is null or v_prod_cant <= 0 then
    raise exception 'La cantidad producida (prod) debe ser mayor a 0';
  end if;

  v_perfectas := coalesce((p->>'perfectas')::integer, v_prod_cant);
  v_imperfectas := coalesce((p->>'imperfectas')::integer, 0);
  v_descartadas := coalesce((p->>'descartadas')::integer, 0);

  if v_perfectas < 0 or v_imperfectas < 0 or v_descartadas < 0 then
    raise exception 'Perfectas, imperfectas y descartadas no pueden ser negativas';
  end if;

  -- Hardening (spec): la maqueta permitía sumar más stock del producido; acá se bloquea.
  if v_perfectas > v_prod_cant then
    raise exception 'Perfectas (%) no puede superar lo producido (%)', v_perfectas, v_prod_cant;
  end if;

  v_gramaje_g := nullif(p->>'gramaje_g','')::integer;
  if v_gramaje_g is not null and v_gramaje_g <= 0 then
    raise exception 'El gramaje debe ser mayor a 0';
  end if;
  -- NOTA: products no tiene columna de gramaje propia (el gramaje-default 150
  -- vive en figuras.gramaje_g, que es por figura, no por producto/lote). La
  -- spec pide "default 150 como el schema" → se usa el literal 150, igual que
  -- el default de la propia columna production_batches.gramaje_g.
  v_gramaje_g := coalesce(v_gramaje_g, 150);

  if v_resp_user_id is not null and not exists (select 1 from users where id = v_resp_user_id) then
    raise exception 'El usuario responsable % no existe', v_resp_user_id;
  end if;
  -- molde/ubicacion: si vienen y no existen en el catálogo, la FK de la tabla
  -- revienta el insert con el error de Postgres (paridad con la spec: "el FK lo valida solo").

  v_vence := nullif(p->>'vence','')::date;
  v_vence := coalesce(v_vence, v_fecha + 14);
  v_horas_congelacion := coalesce(nullif(p->>'horas_congelacion','')::numeric, 10);

  v_id := next_id('batch','L-',3);

  -- Idempotencia bajo carrera: dos llamadas concurrentes con la misma key pueden
  -- pasar ambas el chequeo inicial; el UNIQUE de idempotency_key es el árbitro
  -- real — la perdedora devuelve el lote ya creado, sin efectos.
  begin
    insert into production_batches (
      id, fecha, product_id, figura, sabor, relleno, salsa, gramaje_g,
      prod, perfectas, imperfectas, descartadas, destino, resp_user_id, vence,
      estado, stock_contabilizado, horas_congelacion, inicio_congelacion,
      molde, ubicacion, obs, idempotency_key
    ) values (
      v_id, v_fecha, v_product_id,
      coalesce(p->>'figura',''), coalesce(p->>'sabor',''), coalesce(p->>'relleno',''), coalesce(p->>'salsa',''),
      v_gramaje_g, v_prod_cant, v_perfectas, v_imperfectas, v_descartadas, '—', v_resp_user_id, v_vence,
      'En preparación', false, v_horas_congelacion, null,
      v_molde, v_ubicacion, v_obs, v_idem
    );
  exception when unique_violation then
    if v_idem is not null then
      select id into v_existing_id from production_batches where idempotency_key = v_idem;
      if v_existing_id is not null then
        return jsonb_build_object('batch_id', v_existing_id, 'faltantes', '[]'::jsonb, 'idempotente', true);
      end if;
    end if;
    raise;  -- otra violación de unicidad (p.ej. PK): no es idempotencia, propagar
  end;

  -- Descuento de receta por PROD (no por perfectas). Inline (no _deduct_recipe)
  -- porque acá el movimiento necesita batch_id, no order_id — ver NOTA de cabecera.
  for rec in
    select r.item_id, r.cantidad, it.nombre, it.stock, it.unidad
    from recipes r join inventory_items it on it.id = r.item_id
    where r.product_id = v_product_id
    order by r.item_id   -- orden estable de locks: dos lotes concurrentes no se deadlockean
    for update of it
  loop
    v_req := round(rec.cantidad * v_prod_cant, 3);
    v_toma := least(rec.stock, v_req);
    update inventory_items set stock = round(stock - v_toma, 3) where id = rec.item_id;
    if v_toma > 0 then
      perform _add_movement('Uso en producción', rec.item_id, -v_toma, 'Lote ' || v_id, null, v_id);
    end if;
    if v_toma < v_req then
      v_faltantes := v_faltantes || jsonb_build_object(
        'item_id', rec.item_id, 'insumo', rec.nombre,
        'faltan', round(v_req - v_toma, 3), 'unidad', rec.unidad);
    end if;
  end loop;

  -- Atender sugerencia de producción, si vino
  if v_sugerencia_id is not null then
    select * into v_sug from production_suggestions where id = v_sugerencia_id;
    if v_sug.id is null then
      raise exception 'La sugerencia % no existe', v_sugerencia_id;
    end if;
    if v_sug.area = 'Inventario' then
      raise exception 'La sugerencia % es de Inventario (compra), no de Producción: no se puede atender creando un lote', v_sugerencia_id;
    end if;
    if v_sug.estado <> 'Pendiente' then
      raise exception 'La sugerencia % ya fue atendida', v_sugerencia_id;
    end if;
    update production_suggestions set estado = 'Atendida' where id = v_sugerencia_id;
  end if;

  perform _add_audit('Lote', v_id, 'Lote creado', '', v_prod_cant || '× ' || v_prod.nombre);

  return jsonb_build_object('batch_id', v_id, 'faltantes', v_faltantes);
end $$;

-- ---------------------------------------------------------------------------
-- set_lote_estado(p_batch_id, p_estado) returns jsonb
-- Transiciones LIBRES (paridad-maqueta: no hay grafo para lotes, a diferencia
-- de orders). Efectos EXACTOS de la maqueta, incluyendo la asimetría de que
-- sumar stock al pasar a 'Listo' NO genera movimiento de inventario (products.stock
-- vive fuera del ledger de insumos).
-- ---------------------------------------------------------------------------
create or replace function set_lote_estado(p_batch_id text, p_estado text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b production_batches%rowtype;
  v_prev text;
  v_prod record;
begin
  if not is_staff() then
    raise exception 'Solo staff activo';
  end if;

  select * into b from production_batches where id = p_batch_id for update;
  if b.id is null then
    raise exception 'El lote % no existe', p_batch_id;
  end if;

  -- El CHECK de la tabla ya restringe p_estado a los 7 valores válidos; un
  -- estado inválido revienta en el UPDATE de abajo con el error nativo del CHECK.

  if b.estado = p_estado then
    return jsonb_build_object('ok', true, 'sin_cambio', true, 'estado', b.estado);
  end if;

  v_prev := b.estado;

  perform _add_audit('Lote', p_batch_id, 'Cambio de estado', v_prev, p_estado);

  -- (a) Congelando: sellar inicio_congelacion al ENTRAR desde otro estado.
  -- Congelando→Congelando es no-op (retorna arriba, sin tocar el cronómetro);
  -- "re-entrar reinicia" aplica a salir a otro estado y VOLVER a Congelando —
  -- ahí el cronómetro se sella de nuevo (comportamiento documentado de la maqueta).
  if p_estado = 'Congelando' and v_prev <> 'Congelando' then
    update production_batches set inicio_congelacion = now() where id = p_batch_id;
  end if;

  update production_batches set estado = p_estado where id = p_batch_id;

  -- (b) Listo + producto tipo momo + aún no contabilizado → sumar stock del producto.
  -- SIN movimiento de inventario: products.stock vive fuera del ledger de insumos
  -- (asimetría intencional de la maqueta, documentada en la spec).
  -- A PROPÓSITO no se valida products.activo acá: un lote en curso de un producto
  -- dado de baja debe poder cerrar su ciclo (la baja bloquea lotes NUEVOS en crear_lote).
  if p_estado = 'Listo' and not b.stock_contabilizado then
    select id, tipo into v_prod from products where id = b.product_id for update;
    if v_prod.id is not null and v_prod.tipo = 'momo' then
      update products set stock = coalesce(stock,0) + b.perfectas where id = b.product_id;
      update production_batches set stock_contabilizado = true where id = p_batch_id;
    end if;
  end if;

  -- (c) Volver a En preparación/Congelando estando contabilizado → restar stock (reversa)
  if p_estado in ('En preparación','Congelando') and b.stock_contabilizado then
    update products set stock = greatest(0, coalesce(stock,0) - b.perfectas) where id = b.product_id;
    update production_batches set stock_contabilizado = false where id = p_batch_id;
  end if;

  return jsonb_build_object('ok', true, 'estado', p_estado);
end $$;

-- ---------------------------------------------------------------------------
-- empezar_congelamiento(p_batch_id) returns jsonb
-- Wrapper con semántica del botón: exige estado='En preparación' antes de
-- delegar en set_lote_estado (mismos efectos que el caso (a) de arriba).
-- ---------------------------------------------------------------------------
create or replace function empezar_congelamiento(p_batch_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  if not is_staff() then
    raise exception 'Solo staff activo';
  end if;

  select estado into v_estado from production_batches where id = p_batch_id;
  if v_estado is null then
    raise exception 'El lote % no existe', p_batch_id;
  end if;
  if v_estado <> 'En preparación' then
    raise exception 'El lote % debe estar "En preparación" para empezar a congelar (está en "%")', p_batch_id, v_estado;
  end if;

  return set_lote_estado(p_batch_id, 'Congelando');
end $$;

-- ---------------------------------------------------------------------------
-- convertir_imperfectas(p_batch_id) returns jsonb
-- Solo etiqueta el destino del lote — NO toca inventario (paridad-maqueta).
-- ---------------------------------------------------------------------------
create or replace function convertir_imperfectas(p_batch_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b production_batches%rowtype;
begin
  if not is_staff() then
    raise exception 'Solo staff activo';
  end if;

  select * into b from production_batches where id = p_batch_id for update;
  if b.id is null then
    raise exception 'El lote % no existe', p_batch_id;
  end if;

  if b.imperfectas <= 0 then
    raise exception 'El lote % no tiene imperfectas para convertir', p_batch_id;
  end if;
  if b.destino ilike '%Insumo%' then
    raise exception 'El lote % ya tiene sus imperfectas convertidas en insumo', p_batch_id;
  end if;

  update production_batches set destino = 'Insumo para malteadas y crepas' where id = p_batch_id;
  perform _add_audit('Lote', p_batch_id, 'Imperfectas convertidas en insumo', '', b.imperfectas || ' piezas');

  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- 2) RPCs de Inventario (WAC)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- crear_insumo(p jsonb) returns jsonb
-- Payload: {nombre, cat, unidad, stock?, minimo?, costo_total?, proveedor?, vence?, ubicacion?}
-- ---------------------------------------------------------------------------
create or replace function crear_insumo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_nombre text := trim(coalesce(p->>'nombre',''));
  v_cat text := trim(coalesce(p->>'cat',''));
  v_unidad text := p->>'unidad';
  v_stock numeric := coalesce((p->>'stock')::numeric, 0);
  v_minimo numeric := coalesce((p->>'minimo')::numeric, 0);
  v_costo_total numeric := coalesce((p->>'costo_total')::numeric, 0);
  v_proveedor text := coalesce(p->>'proveedor','');
  v_vence date := nullif(p->>'vence','')::date;
  v_ubicacion text := coalesce(p->>'ubicacion','');
  v_costo numeric;
  v_nota text;
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede crear insumos';
  end if;

  if v_nombre = '' then
    raise exception 'El nombre del insumo no puede estar vacío';
  end if;

  if exists (select 1 from inventory_items where lower(nombre) = lower(v_nombre)) then
    raise exception 'Ya existe un insumo con ese nombre. Usá "Registrar movimiento" para sumarle stock.';
  end if;

  if v_cat = '' then
    raise exception 'La categoría del insumo no puede estar vacía';
  end if;
  -- Categoría nueva: la maqueta permite categorías nuevas sobre la marcha.
  if not exists (select 1 from inventory_cats where nombre = v_cat) then
    insert into inventory_cats (nombre) values (v_cat);
  end if;

  -- unidad: el CHECK de inventory_items ya restringe el dominio; un valor
  -- fuera de la lista revienta en el INSERT de abajo con el error nativo.
  if v_unidad is null or v_unidad = '' then
    raise exception 'La unidad del insumo es obligatoria';
  end if;

  if v_stock < 0 then
    raise exception 'El stock inicial no puede ser negativo';
  end if;
  if v_minimo < 0 then
    raise exception 'El stock mínimo no puede ser negativo';
  end if;
  -- Hardening (spec): la maqueta no validaba costo_total >= 0.
  if v_costo_total < 0 then
    raise exception 'El costo total no puede ser negativo';
  end if;

  v_costo := case when v_stock > 0 then round(v_costo_total / v_stock, 4) else 0 end;

  v_id := next_id('invitem','I',2);

  -- Duplicado bajo carrera: el índice único inv_items_nombre_uq (bloque 0) es
  -- el árbitro real cuando dos transacciones pasan el EXISTS a la vez.
  begin
    insert into inventory_items (id, nombre, cat, unidad, stock, minimo, costo, proveedor, vence, ubicacion, compra)
    values (v_id, v_nombre, v_cat, v_unidad, v_stock, v_minimo, v_costo, v_proveedor, v_vence, v_ubicacion,
            case when v_stock > 0 then (now() at time zone 'America/Bogota')::date else null end);
  exception when unique_violation then
    raise exception 'Ya existe un insumo con ese nombre. Usá "Registrar movimiento" para sumarle stock.';
  end;

  if v_stock > 0 then
    if v_costo_total > 0 then
      v_nota := 'Stock inicial · ' || v_costo_total || ' total (' || v_costo || '/' || v_unidad || ')';
    else
      v_nota := 'Stock inicial del insumo';
    end if;
    perform _add_movement('Entrada', v_id, v_stock, v_nota, null, null);
  end if;

  perform _add_audit('Inventario', v_id, 'Insumo creado', '', v_nombre);

  return jsonb_build_object('item_id', v_id, 'costo', v_costo);
end $$;

-- ---------------------------------------------------------------------------
-- entrada_insumo(p_item_id, p_cant, p_costo_total, p_nota) returns jsonb
-- WAC exacto de la maqueta: costo 0 en la compra NO diluye el costo promedio,
-- solo suma stock (rama ELSE del CASE).
-- ---------------------------------------------------------------------------
create or replace function entrada_insumo(
  p_item_id text, p_cant numeric, p_costo_total numeric, p_nota text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_costo_compra numeric;
  v_stock_nuevo numeric;
  v_costo_wac numeric;
  v_nota text;
begin
  if not is_staff() then
    raise exception 'Solo staff activo';
  end if;

  select * into it from inventory_items where id = p_item_id for update;
  if it.id is null then
    raise exception 'El insumo % no existe', p_item_id;
  end if;

  if p_cant is null or p_cant <= 0 then
    raise exception 'La cantidad a ingresar debe ser mayor a 0';
  end if;
  if p_costo_total is null or p_costo_total < 0 then
    raise exception 'El costo total no puede ser negativo';
  end if;

  v_costo_compra := case when p_cant > 0 then p_costo_total / p_cant else 0 end;
  v_stock_nuevo := it.stock + p_cant;
  v_costo_wac := case
    when p_costo_total > 0 and v_stock_nuevo > 0
      then (it.stock * it.costo + p_cant * v_costo_compra) / v_stock_nuevo
    else it.costo  -- costo 0 NO diluye, solo suma stock
  end;

  update inventory_items set
    stock = round(v_stock_nuevo, 2),
    costo = round(v_costo_wac, 4),
    compra = (now() at time zone 'America/Bogota')::date
  where id = p_item_id;

  if p_costo_total > 0 then
    v_nota := 'Compra ' || p_costo_total || ' total (' || v_costo_compra || '/' || it.unidad
      || ') · costo prom. → ' || round(v_costo_wac, 4);
  else
    v_nota := 'Entrada sin costo';
  end if;
  if coalesce(p_nota,'') <> '' then
    v_nota := v_nota || ' · ' || p_nota;
  end if;

  perform _add_movement('Entrada', p_item_id, p_cant, v_nota, null, null);
  perform _add_audit('Inventario', p_item_id, 'Entrada', it.costo::text,
    '+' || p_cant || ' ' || it.unidad || ' · nuevo costo ' || round(v_costo_wac, 4));

  -- NOTA: no se recalculan snapshots históricos (costo_unitario/insumo_costo de
  -- pedidos ya creados) — son COGS congelado a propósito (ver schema-v5.sql §diseño).

  return jsonb_build_object('stock', round(v_stock_nuevo, 2), 'costo', round(v_costo_wac, 4));
end $$;

-- ---------------------------------------------------------------------------
-- movimiento_insumo(p_item_id, p_tipo, p_cant, p_nota) returns jsonb
-- Tipos permitidos acá: Salida/Ajuste/Merma/Uso en producción. 'Entrada' está
-- prohibida (usar entrada_insumo). Hardening de signo: Salida/Merma/Uso en
-- producción exigen cant negativa; Ajuste acepta ambos signos. El aplicado se
-- clampea a -stock (nunca negativo) y el movimiento registra lo APLICADO
-- (ledger veraz — hardening sobre la maqueta, que registraba lo pedido).
-- ---------------------------------------------------------------------------
create or replace function movimiento_insumo(
  p_item_id text, p_tipo text, p_cant numeric, p_nota text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it inventory_items%rowtype;
  v_aplicado numeric;
  v_truncado boolean := false;
begin
  if not is_staff() then
    raise exception 'Solo staff activo';
  end if;

  select * into it from inventory_items where id = p_item_id for update;
  if it.id is null then
    raise exception 'El insumo % no existe', p_item_id;
  end if;

  if p_tipo = 'Entrada' then
    raise exception 'Usá entrada_insumo(...) para las entradas.';
  end if;
  if p_tipo not in ('Salida','Ajuste','Merma','Uso en producción') then
    raise exception 'Tipo de movimiento inválido: %', p_tipo;
  end if;

  if p_cant is null or p_cant = 0 then
    raise exception 'La cantidad del movimiento no puede ser 0';
  end if;

  if p_tipo in ('Salida','Merma','Uso en producción') and p_cant >= 0 then
    raise exception 'Los movimientos de tipo "%" deben ser negativos (resta stock)', p_tipo;
  end if;
  -- 'Ajuste' acepta ambos signos.

  if p_cant < 0 then
    -- greatest(stock, 0): un stock negativo pre-existente jamás convierte una
    -- salida en suma (el clamp con stock < 0 daría -stock > 0 e invertiría el signo).
    v_aplicado := greatest(p_cant, -greatest(it.stock, 0));  -- stock nunca queda negativo
  else
    v_aplicado := p_cant;
  end if;
  if v_aplicado <> p_cant then
    v_truncado := true;
  end if;

  -- Decisión de producto: si el clamp truncó TODO (no hay nada que descontar),
  -- error claro en vez de registrar un movimiento de cantidad 0.
  if v_aplicado = 0 then
    raise exception 'Sin stock de % para descontar (stock actual: %)', it.nombre, it.stock;
  end if;

  update inventory_items set stock = round(stock + v_aplicado, 2) where id = p_item_id;
  -- costo NUNCA se toca acá (solo entrada_insumo recalcula WAC).

  perform _add_movement(p_tipo, p_item_id, v_aplicado, p_nota, null, null);
  perform _add_audit('Inventario', p_item_id, p_tipo, '', v_aplicado || ' ' || it.nombre);

  if v_truncado then
    return jsonb_build_object('stock', round(it.stock + v_aplicado, 2), 'aplicado', v_aplicado, 'truncado', true);
  end if;

  return jsonb_build_object('stock', round(it.stock + v_aplicado, 2), 'aplicado', v_aplicado);
end $$;

-- ============================================================================
-- 3) RPCs de Reclamos
-- ============================================================================

-- ---------------------------------------------------------------------------
-- crear_reclamo(p_order_id, p_tipo, p_descr) returns jsonb
-- entregado_en: se resuelve combinando orders.fecha + deliveries.h_entrega
-- (la única hora de entrega que existe en el schema — h_entrega time, sin
-- fecha propia). Si no hay delivery entregado, queda null.
-- ---------------------------------------------------------------------------
create or replace function crear_reclamo(
  p_order_id text,
  p_tipo text default 'Reclamo por calidad',
  p_descr text default 'Reclamo creado desde el pedido. Completar detalle.'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype;
  v_id text;
  v_entregado_en timestamptz;
  v_fecha date := (now() at time zone 'America/Bogota')::date;
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede crear reclamos';
  end if;

  select * into o from orders where id = p_order_id for update;
  if o.id is null then
    raise exception 'El pedido % no existe', p_order_id;
  end if;

  if o.estado in ('Reclamo','Cancelado') then
    raise exception 'El pedido % ya está en estado "%": no se puede crear otro reclamo', p_order_id, o.estado;
  end if;

  -- NOTA: deliveries.h_entrega es `time` sin fecha propia (el schema no tiene
  -- un timestamptz de entrega). Se combina con orders.fecha para reconstruir el
  -- instante de entrega, interpretado en America/Bogota — la zona en la que el
  -- slice 1 escribe esos sellos operativos desde la armonización (migración
  -- rpc_sellos_operativos_bogota, 2026-07-10). Si el pedido no tiene delivery
  -- con hora de entrega, entregado_en queda null.
  select (o.fecha + d.h_entrega) at time zone 'America/Bogota'
    into v_entregado_en
  from deliveries d
  where d.order_id = p_order_id and d.h_entrega is not null
  order by d.h_entrega desc
  limit 1;

  v_id := next_id('claim','R-',3);

  insert into claims (
    id, order_id, customer_id, fecha, tipo, entregado_en, reclamo_en,
    descr, resp, decision, solucion, costo, estado, evidencia
  ) values (
    v_id, p_order_id, o.customer_id, v_fecha, p_tipo, v_entregado_en, now(),
    p_descr, '', '', '', 0, 'Abierto', ''
  );

  perform _add_audit('Reclamo', v_id, 'Caso creado', '', 'Abierto');

  -- Reusa la RPC del slice 1 tal cual: genera su propio audit de cambio de
  -- estado del pedido. La doble entrada de audit (Reclamo + Pedido) es
  -- paridad con la maqueta.
  perform set_order_status(p_order_id, 'Reclamo', false);

  return jsonb_build_object('claim_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- set_reclamo_estado(p_claim_id, p_estado) returns jsonb
-- Transición LIBRE (paridad-maqueta), sin efectos colaterales sobre
-- pedido/inventario/beneficios: el costo del reclamo cuenta en reportes vía
-- query, no acá.
-- ---------------------------------------------------------------------------
create or replace function set_reclamo_estado(p_claim_id text, p_estado text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c claims%rowtype;
begin
  if not is_staff() then
    raise exception 'Solo staff activo';
  end if;

  select * into c from claims where id = p_claim_id for update;
  if c.id is null then
    raise exception 'El reclamo % no existe', p_claim_id;
  end if;

  -- El CHECK de la tabla restringe p_estado a los 6 valores válidos; un
  -- estado inválido revienta en el UPDATE de abajo con el error nativo del CHECK.

  if c.estado = p_estado then
    return jsonb_build_object('ok', true, 'sin_cambio', true, 'estado', c.estado);
  end if;

  perform _add_audit('Reclamo', p_claim_id, 'Cambio de estado', c.estado, p_estado);
  update claims set estado = p_estado where id = p_claim_id;

  return jsonb_build_object('ok', true, 'estado', p_estado);
end $$;

-- ---------------------------------------------------------------------------
-- editar_reclamo(p_claim_id, p jsonb) returns jsonb
-- Campos editables SOLO: tipo, descr, resp, decision, solucion, costo,
-- evidencia. Cualquier otra clave del payload se ignora (nunca estado/
-- order_id/customer_id/fechas por acá).
-- ---------------------------------------------------------------------------
create or replace function editar_reclamo(p_claim_id text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c claims%rowtype;
  v_costo numeric;
begin
  if not is_staff() then
    raise exception 'Solo staff activo';
  end if;

  select * into c from claims where id = p_claim_id for update;
  if c.id is null then
    raise exception 'El reclamo % no existe', p_claim_id;
  end if;

  if p ? 'costo' then
    v_costo := (p->>'costo')::numeric;
    if v_costo is not null and v_costo < 0 then
      raise exception 'El costo del reclamo no puede ser negativo';
    end if;
  end if;

  update claims set
    -- tipo no admite vacío (claims.tipo es not null y un reclamo sin tipo no
    -- significa nada); los demás campos SÍ pueden vaciarse legítimamente.
    tipo     = coalesce(nullif(p->>'tipo',''), tipo),
    descr    = coalesce(p->>'descr', descr),
    resp     = coalesce(p->>'resp', resp),
    decision = coalesce(p->>'decision', decision),
    solucion = coalesce(p->>'solucion', solucion),
    costo    = case when p ? 'costo' then coalesce(v_costo, costo) else costo end,
    evidencia = coalesce(p->>'evidencia', evidencia)
  where id = p_claim_id;

  perform _add_audit('Reclamo', p_claim_id, 'Caso editado');

  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- 4) Grants
-- ============================================================================

revoke execute on function crear_lote(jsonb) from public, anon;
revoke execute on function set_lote_estado(text, text) from public, anon;
revoke execute on function empezar_congelamiento(text) from public, anon;
revoke execute on function convertir_imperfectas(text) from public, anon;
revoke execute on function crear_insumo(jsonb) from public, anon;
revoke execute on function entrada_insumo(text, numeric, numeric, text) from public, anon;
revoke execute on function movimiento_insumo(text, text, numeric, text) from public, anon;
revoke execute on function crear_reclamo(text, text, text) from public, anon;
revoke execute on function set_reclamo_estado(text, text) from public, anon;
revoke execute on function editar_reclamo(text, jsonb) from public, anon;

grant execute on function crear_lote(jsonb) to authenticated;
grant execute on function set_lote_estado(text, text) to authenticated;
grant execute on function empezar_congelamiento(text) to authenticated;
grant execute on function convertir_imperfectas(text) to authenticated;
grant execute on function crear_insumo(jsonb) to authenticated;
grant execute on function entrada_insumo(text, numeric, numeric, text) to authenticated;
grant execute on function movimiento_insumo(text, text, numeric, text) to authenticated;
grant execute on function crear_reclamo(text, text, text) to authenticated;
grant execute on function set_reclamo_estado(text, text) to authenticated;
grant execute on function editar_reclamo(text, jsonb) to authenticated;

-- Este slice no define helpers _* nuevos: reusa _add_movement/_add_audit/
-- is_staff/next_id del slice 1 (rpc-pedidos-v1.sql), que ya tienen sus propios
-- revokes. Solo crear_lote() usa _add_movement/_add_audit directamente (ambos
-- ya revocados de public/anon en el slice 1).
