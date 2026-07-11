-- ============================================================================
-- MOMOS OPS — crear_insumo v2: lista cerrada de unidades con excepción amable
-- Target: Supabase / PostgreSQL 17. Reemplaza crear_insumo de
-- rpc-produccion-v1.sql (líneas 343-422) SIN cambiar su firma (jsonb):
-- CREATE OR REPLACE preserva grants existentes; se re-declaran igual por
-- convención de estos archivos espejo (ver editar-reclamo-hentrega-v1.sql).
--
-- Gap cerrado (spec momos/normalizacion-datos, item asignado a slice 4): la
-- v1 confiaba en el CHECK nativo de inventory_items.unidad para rechazar
-- valores fuera de dominio — el error que llega al front es el mensaje crudo
-- de Postgres ("violates check constraint..."), no una excepción legible.
-- v2 valida ANTES del insert con un mensaje amistoso que lista las unidades
-- permitidas, mismo estilo que upsert_cliente valida 'canal'
-- (rpc-clientes-v1.sql línea 80: "Canal inválido: %").
--
-- Evidencia de la lista cerrada (7 valores, YA existía como CHECK en
-- schema-v5.sql línea 117 y como <Select> cerrado en el form de Inventario,
-- MomosOps.jsx — "Nuevo insumo" ya usaba options={["und","kg","g","L","ml",
-- "paquete","docena"]}, NO era texto libre). La semilla real
-- (seed-catalogos.sql) solo usa 'L', 'kg', 'und' de esos 7 — los otros 4
-- (g, ml, paquete, docena) están en el dominio pero sin uso en la semilla.
-- No se agregan ni quitan valores acá: se hace EXPLÍCITA en la RPC la misma
-- lista que ya regía en schema + UI (higiene de datos, no cambio de negocio).
--
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

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

  if v_unidad is null or v_unidad = '' then
    raise exception 'La unidad del insumo es obligatoria';
  end if;
  -- Lista cerrada (idéntica al CHECK de inventory_items.unidad, ver cabecera):
  -- excepción amable ANTES del insert, en vez de dejar que reviente el CHECK
  -- nativo con un mensaje ilegible para quien está cargando el insumo.
  if v_unidad not in ('und','kg','g','L','ml','paquete','docena') then
    raise exception 'Unidad inválida: "%". Las unidades permitidas son: und, kg, g, L, ml, paquete, docena.', v_unidad;
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

  -- Duplicado bajo carrera: el índice único inv_items_nombre_uq (rpc-produccion-v1.sql
  -- bloque 0) es el árbitro real cuando dos transacciones pasan el EXISTS a la vez.
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

revoke execute on function crear_insumo(jsonb) from public, anon;
grant execute on function crear_insumo(jsonb) to authenticated;

-- Verificación esperada:
--   select crear_insumo('{"nombre":"Test","cat":"Ingredientes","unidad":"lb","stock":1}'::jsonb);
--     → exception 'Unidad inválida: "lb". Las unidades permitidas son: und, kg, g, L, ml, paquete, docena.'
--   select crear_insumo('{"nombre":"Test2","cat":"Ingredientes","unidad":"kg","stock":1}'::jsonb);
--     → ok, item_id devuelto
