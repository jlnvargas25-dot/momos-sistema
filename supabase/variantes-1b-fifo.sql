-- ============================================================================
-- MOMOS OPS — Variantes Etapa 1b: venta FIFO por variante (2026-07-12)
-- Target: Supabase / PostgreSQL 17. Fuente de verdad de columnas base:
-- schema-v5.sql. Fuente de verdad de resultado de desmolde: variantes-v1.sql
-- (lote_figuras, desmoldar_lote, v_variantes_disponibles — Etapa 1a). Fuente
-- de verdad de reservas al pagar: rpc-pedidos-v1.sql (_reserve_inventory,
-- _release_reservations, _add_reservation, set_order_status efecto [Pagado]).
--
-- QUÉ ES ESTE SLICE (Etapa 1b — spec cerrada por el dueño, NO reabrir):
-- Hoy, al pagar un pedido, `_reserve_inventory` descuenta `products.stock`
-- (agregado por producto) y crea UNA reserva agregada por línea de momo —
-- sin saber de QUÉ LOTE FÍSICO salió esa unidad. Desde Etapa 1a existe
-- `lote_figuras` con el desglose real de perfectas por figura y por lote
-- (con su fecha de vencimiento). Este archivo conecta ambas cosas: al pagar,
-- cada unidad de momo reservada se asigna FIFO (vencimiento más próximo
-- primero) a un lote_figuras concreto, dejando un rastro en
-- `inventory_reservations.batch_id`/`figura`.
--
-- DECISIONES DE PRODUCTO (cerradas por el dueño, NO reabrir):
--   1. La asignación de lote físico ocurre AL PAGAR, FIFO automático por
--      vencimiento más próximo (coalesce(vencimiento, vence) asc).
--   2. Matching: figura+sabor preferido, con fallback a figura sola (mismo
--      pase, orden por match de sabor primero — no dos pasadas separadas).
--   3. Si no hay stock desmoldado suficiente de esa figura: la venta
--      PROCEDE igual; el remanente queda SIN lote (batch_id null), exacto
--      como hoy — el modelo producir-a-pedido queda intacto.
--
-- INVARIANTE QUE ESTE ARCHIVO NO ROMPE: products.stock sigue siendo la
-- fuente agregada de verdad (se descuenta EXACTAMENTE como hoy, mismo total,
-- mismos guards de "least(stock disponible, necesidad)"). lote_figuras es el
-- DESGLOSE físico de esa misma unidad de stock — nunca una segunda fuente
-- paralela. El delta entre lo que el FIFO pudo cubrir con lote_figuras y lo
-- que efectivamente se descontó de products.stock es exactamente el stock
-- "legacy" (productos sin filas lote_figuras, ej. lotes viejos pre-1a) o el
-- "a producir" (ventas que exceden lo desmoldado — producir-a-pedido): ese
-- remanente sigue reservándose SIN batch_id, tal cual el comportamiento
-- actual, así el reporte de producción sugerida no cambia una sola fila.
--
-- QUÉ CAMBIA / QUÉ NO CAMBIA respecto a rpc-pedidos-v1.sql:
--   - _reserve_inventory: MISMA firma, mismos guards, MISMO total descontado
--     de products.stock. Lo único que cambia es CÓMO se arman las filas de
--     inventory_reservations tipo 'producto' con origen "momo real" (sección
--     1, momos sueltos/hijas de combo) y "componente de combo sin hijas"
--     (sección 2, pull genérico legacy): en vez de una reserva agregada por
--     item, se llama _asignar_variante_fifo() con la figura/sabor de ESE
--     item puntual y se reserva el remanente (si lo hay) sin batch, tal cual
--     hoy. Las reservas de EMPAQUE/INSUMO (secciones 2-empaque/extras y 3)
--     NO se tocan — variantes es un concepto de MOMO, no de insumo/empaque.
--   - _release_reservations: MISMA firma, mismo efecto de stock. Lo único
--     que se agrega es: si la reserva liberada tiene batch_id (vino del
--     FIFO), además de devolver products.stock, se le devuelven las
--     unidades a `lote_figuras.consumidas` del lote/figura exactos de los
--     que salió — así una cancelación vuelve a dejar esa unidad disponible
--     para la próxima venta FIFO.
--   - _consume_reservations, set_order_status, crear_pedido, grants de
--     funciones públicas: SIN TOCAR. Firmas de _reserve_inventory/
--     _release_reservations quedan intactas → create or replace preserva
--     ACLs de las RPCs públicas que las invocan (set_order_status,
--     marcar_pagado, cancelar_pedido) sin re-grant.
--
-- POR QUÉ EL ORDEN DE LOCKS SE MANTIENE (evitar deadlocks): el flujo actual
-- lockea `products` (FOR UPDATE) antes de crear cada reserva dentro del
-- mismo loop de item. _asignar_variante_fifo() se invoca DESPUÉS de ese
-- lock de products — mantiene el mismo orden relativo (products → lote_
-- figuras) en todo el archivo, para que dos transacciones concurrentes
-- nunca lockeen esas dos tablas en orden inverso entre sí.
--
-- DEPENDENCIAS — aplicar en este orden:
--   1. schema-v5.sql
--   2. rpc-pedidos-v1.sql       (_reserve_inventory/_release_reservations que ESTE archivo evoluciona)
--   3. normalizacion-clientes-v1.sql
--   4. variantes-v1.sql         (lote_figuras, v_variantes_disponibles que ESTE archivo evoluciona)
--   5. ESTE ARCHIVO (variantes-1b-fifo.sql)
--
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

-- begin/commit: alter table + create or replace de 3 funciones + vista deben
-- aplicarse atómicos — sin ventana donde lote_figuras tenga `consumidas` pero
-- _reserve_inventory todavía no sepa poblarla (o viceversa).
begin;

-- ============================================================================
-- A) DDL — lote_figuras.consumidas: cuánto de `perfectas` ya se vendió
-- (asignó vía FIFO a una reserva). NUNCA se resta de `perfectas` — perfectas
-- es el conteo HISTÓRICO del desmolde (Etapa 1a, CHECK lote_figuras_cuadra
-- exige perfectas+imperfectas+descartadas=cant, intacto); consumidas es la
-- porción de esas perfectas que YA tiene una reserva viva encima. Disponible
-- para vender = perfectas - consumidas (ver vista de la sección C).
-- ============================================================================
alter table lote_figuras add column if not exists consumidas integer not null default 0;

alter table lote_figuras add constraint lote_figuras_consumo_valido
  check (consumidas >= 0 and consumidas <= perfectas);

-- ============================================================================
-- B) DDL — inventory_reservations.figura: SOLO se puebla en reservas tipo
-- 'producto' que sí encontraron lote (batch_id not null) — el mismo evento
-- que ya escribe batch_id. Reservas sin lote (remanente FIFO, legacy sin
-- lote_figuras, empaque/insumo) dejan esta columna en null, igual que hoy
-- dejan batch_id en null.
-- ============================================================================
alter table inventory_reservations add column if not exists figura text;

comment on column inventory_reservations.figura is
  'Figura del lote_figuras del que salió esta unidad — SOLO poblada cuando batch_id no es null (asignación FIFO de Etapa 1b). Null en reservas sin lote físico (remanente a producir, legacy sin lote_figuras, o tipo empaque/insumo).';

-- ============================================================================
-- C) Vista v_variantes_disponibles — MISMA columna/shape que variantes-v1.sql
-- (security_invoker=on intacto), PERO "disponibles" ahora descuenta lo ya
-- reservado por el FIFO (perfectas - consumidas) en vez de solo perfectas —
-- así el panel del front (src/lib/read-model.js) deja de mostrar como
-- disponible una unidad que ya tiene una reserva 'Reservada' viva encima.
-- ============================================================================
create or replace view v_variantes_disponibles with (security_invoker = on) as
select
  p.id as product_id,
  p.nombre as producto,
  lf.figura,
  b.sabor,
  b.gramaje_g,
  sum(lf.perfectas - lf.consumidas) as disponibles,
  min(coalesce(b.vencimiento, b.vence)) as vencimiento_proximo
from lote_figuras lf
join production_batches b on b.id = lf.batch_id
join products p on p.id = b.product_id
where b.estado = 'Listo' and b.stock_contabilizado = true
group by p.id, p.nombre, lf.figura, b.sabor, b.gramaje_g
-- Una variante sin disponibles (todo consumido, o 0 perfectas desde Etapa 1a)
-- no está "disponible" — mismo HAVING de variantes-v1.sql, ahora sobre el
-- neto perfectas-consumidas en vez de solo perfectas.
having sum(lf.perfectas - lf.consumidas) > 0;

grant select on v_variantes_disponibles to authenticated;

-- ============================================================================
-- D) _asignar_variante_fifo — helper nuevo. Dada una figura/sabor de UNA
-- unidad de venta (un item de order_items, o 1 unidad dentro de item.cant),
-- recorre lote_figuras con lock FOR UPDATE en orden FIFO y va creando
-- reservas 'producto' CON batch_id/figura por cada lote que toca, hasta
-- cubrir p_cantidad o agotar stock desmoldado. Devuelve el REMANENTE no
-- cubierto (>= 0) — el caller es quien decide qué hacer con ese remanente
-- (hoy: reservarlo agregado, sin batch, igual que el comportamiento actual).
--
-- ORDEN DEL CURSOR (decisión 2 del dueño — figura+sabor preferido, fallback
-- a figura sola, MISMO PASE): "case when sabor coincide then 0 else 1 end"
-- antepone las filas de sabor exacto SIN necesitar una segunda consulta —
-- una fila de sabor distinto pero vencimiento más próximo NUNCA gana contra
-- una de sabor exacto (el CASE es la clave primaria de orden), pero entre
-- dos filas del MISMO grupo de match (ambas sabor-exacto, o ambas fallback)
-- manda el vencimiento más próximo — eso ES el FIFO dentro de cada grupo.
--
-- LOCK: FOR UPDATE OF lf — mismo objeto (lote_figuras) que ya lockea
-- desmoldar_lote (variantes-v1.sql) vía `select ... for update` sobre
-- production_batches primero y acá sobre lote_figuras; el caller
-- (_reserve_inventory) ya lockeó products ANTES de llamar a este helper —
-- se preserva el orden products → lote_figuras en todo el flujo de pago.
-- ============================================================================
create or replace function _asignar_variante_fifo(
  p_order_id text, p_product_id text, p_figura text, p_sabor text,
  p_cantidad integer, p_nombre_producto text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  rec record;
  v_figura text := nullif(trim(p_figura), '');
  v_sabor text := nullif(trim(p_sabor), '');
  v_restante integer := p_cantidad;
  v_toma integer;
begin
  if p_cantidad is null or p_cantidad <= 0 then
    return 0;
  end if;

  for rec in
    select lf.batch_id, lf.figura, (lf.perfectas - lf.consumidas) as disp, b.sabor
    from lote_figuras lf
    join production_batches b on b.id = lf.batch_id
    where b.product_id = p_product_id
      and b.estado = 'Listo'
      and b.stock_contabilizado
      and (v_figura is null or lf.figura = v_figura)
      and (lf.perfectas - lf.consumidas) > 0
    order by
      (case when v_sabor is not null and b.sabor = v_sabor then 0 else 1 end),
      coalesce(b.vencimiento, b.vence) asc nulls last,
      b.fecha asc,
      b.id asc,
      lf.figura asc
    for update of lf
  loop
    exit when v_restante <= 0;

    v_toma := least(rec.disp, v_restante);
    if v_toma <= 0 then
      continue;
    end if;

    update lote_figuras set consumidas = consumidas + v_toma
    where batch_id = rec.batch_id and figura = rec.figura;

    insert into inventory_reservations (
      id, order_id, tipo, product_id, item_id, nombre, cantidad, batch_id, figura
    ) values (
      next_id('reservation','RES-',0), p_order_id, 'producto', p_product_id, null,
      p_nombre_producto || ' · ' || rec.figura || ' (' || rec.batch_id || ')',
      v_toma, rec.batch_id, rec.figura
    );

    v_restante := v_restante - v_toma;
  end loop;

  return v_restante;
end $$;

revoke execute on function _asignar_variante_fifo(text, text, text, text, integer, text) from public, anon, authenticated;

-- ============================================================================
-- E) _reserve_inventory — MISMA firma que rpc-pedidos-v1.sql:158. Cuerpo
-- completo copiado desde ahí; los ÚNICOS bloques modificados son:
--   (1) sección "1) Momos": la reserva de tipo 'producto' que salía de
--       _add_reservation(...) ahora sale de _asignar_variante_fifo(...) con
--       figura/sabor de ESE order_item, y el remanente que devuelve se
--       reserva agregado SIN batch (mismo _add_reservation de siempre) —
--       la suma cubierta+remanente es SIEMPRE v_toma, igual que hoy.
--   (2) sección "2) Combos" — pull genérico SOLO si no tiene hijas: mismo
--       patrón, FIFO con la figura/sabor del ITEM del combo (el pull
--       genérico no tiene figura/sabor propios en order_items — ver nota
--       en el bloque, cae a fallback por figura null = solo vencimiento).
-- Todo lo demás (empaque, extras de receta del combo, adiciones, faltantes,
-- production_suggestions, audits) queda CARÁCTER POR CARÁCTER igual.
-- ============================================================================
create or replace function _reserve_inventory(p_order_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item record;
  comp record;
  addd record;
  v_toma numeric;
  v_necesita numeric;
  v_req numeric;
  v_stock_actual numeric;
  v_tiene_hijas boolean;
  v_faltantes jsonb := '[]'::jsonb;
  v_sugerencias_texto text := '';
  v_compras_texto text := '';
  v_hoy date := (now() at time zone 'America/Bogota')::date;   -- fecha operativa del negocio (la sesión corre en UTC)
  v_remanente integer;
begin
  -- 1) Momos (incluye hijas de combo, es_sub_momo=true, y momos sueltos)
  for item in
    select oi.id, oi.product_id, oi.cant, oi.nombre, oi.figura, oi.sabor
    from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.tipo = 'momo'
  loop
    -- Releer stock EN VIVO con lock: dos filas del mismo producto en un pedido
    -- (ej. 2 hijas del mismo momo) deben ver el stock ya decrementado por la
    -- anterior — como muta la maqueta — no el snapshot del cursor.
    select stock into v_stock_actual from products where id = item.product_id for update;
    v_toma := least(coalesce(v_stock_actual,0), item.cant);
    update products set stock = coalesce(stock,0) - v_toma where id = item.product_id;
    if v_toma > 0 then
      -- VARIANTES 1b: FIFO por figura/sabor de ESTE item — reemplaza la
      -- reserva agregada única. v_toma es entero acá (cant de order_items es
      -- numeric pero las unidades de momo siempre son enteras — round()
      -- defensivo por si algún día cant trae decimales espurios).
      v_remanente := _asignar_variante_fifo(
        p_order_id, item.product_id, item.figura, item.sabor,
        round(v_toma)::integer, item.nombre
      );
      if v_remanente > 0 then
        -- Remanente sin lote físico (stock legacy sin lote_figuras, o venta
        -- que excede lo desmoldado) — MISMO comportamiento de hoy: reserva
        -- agregada sin batch_id/figura.
        perform _add_reservation(p_order_id, 'producto', item.product_id, null, item.nombre, v_remanente);
      end if;
    end if;
    if v_toma < item.cant then
      v_faltantes := v_faltantes || jsonb_build_object(
        'producto', item.nombre, 'cant', item.cant - v_toma, 'area', 'Producción');
      v_sugerencias_texto := v_sugerencias_texto
        || case when v_sugerencias_texto = '' then '' else ', ' end
        || (item.cant - v_toma) || '× ' || item.nombre;
      insert into production_suggestions (id, fecha, product_id, cantidad, motivo, order_id, area)
      values (next_id('suggestion','S-',0), v_hoy, item.product_id,
              item.cant - v_toma, 'Faltante al reservar pedido ' || p_order_id, p_order_id, 'Producción');
    end if;
  end loop;

  -- 2) Combos: pull genérico SOLO si no tiene hijas (legacy); empaque y extras
  --    de receta SIEMPRE se descuentan (con o sin hijas).
  for item in
    select oi.id, oi.product_id, oi.cant, oi.nombre
    from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.tipo = 'combo'
  loop
    select exists(select 1 from order_items where parent_item_id = item.id) into v_tiene_hijas;

    if not v_tiene_hijas then
      select combo_size into v_necesita from products where id = item.product_id;
      v_necesita := v_necesita * item.cant;
      for comp in
        select cc.component_id, pr.nombre as comp_nombre
        from combo_components cc join products pr on pr.id = cc.component_id
        where cc.combo_id = item.product_id
      loop
        exit when v_necesita <= 0;
        select stock into v_stock_actual from products where id = comp.component_id for update;
        v_toma := least(coalesce(v_stock_actual,0), v_necesita);
        update products set stock = coalesce(stock,0) - v_toma where id = comp.component_id;
        if v_toma > 0 then
          -- VARIANTES 1b: pull genérico legacy — el componente del combo NO
          -- tiene figura/sabor propios en order_items (esa info vive en las
          -- HIJAS es_sub_momo, que este combo justamente NO tiene — por eso
          -- cayó en la rama "sin hijas"). FIFO con figura/sabor null: cubre
          -- por vencimiento más próximo entre TODAS las figuras de este
          -- producto componente, exactamente el mismo criterio con el que
          -- hoy se toma stock agregado sin distinguir variante.
          v_remanente := _asignar_variante_fifo(
            p_order_id, comp.component_id, null, null,
            round(v_toma)::integer, comp.comp_nombre || ' (para ' || item.nombre || ')'
          );
          if v_remanente > 0 then
            perform _add_reservation(p_order_id, 'producto', comp.component_id, null,
              comp.comp_nombre || ' (para ' || item.nombre || ')', v_remanente);
          end if;
        end if;
        -- Lo tomado de este componente REDUCE lo que falta cubrir (sin esto,
        -- cada componente descontaría la necesidad completa = doble resta)
        v_necesita := v_necesita - v_toma;
      end loop;
      -- Faltante del combo: UNA sola vez, al final, con lo que quedó sin cubrir
      if v_necesita > 0 then
        v_faltantes := v_faltantes || jsonb_build_object(
          'producto', 'Momos para ' || item.nombre, 'cant', v_necesita, 'area', 'Producción');
        v_sugerencias_texto := v_sugerencias_texto
          || case when v_sugerencias_texto = '' then '' else ', ' end
          || v_necesita || '× Momos para ' || item.nombre;
        insert into production_suggestions (id, fecha, product_id, cantidad, motivo, order_id, area)
        values (next_id('suggestion','S-',0), v_hoy, item.product_id, v_necesita,
                'Faltante al reservar pedido ' || p_order_id || ' (Momos para ' || item.nombre || ')',
                p_order_id, 'Producción');
      end if;
    end if;

    -- Empaque: SIEMPRE
    declare
      v_empaque_id text;
      v_empaque_nombre text;
      v_empaque_stock numeric;
    begin
      select empaque_item_id into v_empaque_id from products where id = item.product_id;
      select nombre, stock into v_empaque_nombre, v_empaque_stock from inventory_items where id = v_empaque_id for update;
      v_toma := least(coalesce(v_empaque_stock,0), item.cant);
      update inventory_items set stock = round(stock - v_toma, 2) where id = v_empaque_id;
      if v_toma > 0 then
        perform _add_reservation(p_order_id, 'empaque', null, v_empaque_id, v_empaque_nombre, v_toma);
        perform _add_movement('Salida', v_empaque_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
      end if;
      if v_toma < item.cant then
        v_faltantes := v_faltantes || jsonb_build_object(
          'item_id', v_empaque_id, 'producto', v_empaque_nombre, 'cant', item.cant - v_toma, 'area', 'Inventario');
        v_compras_texto := v_compras_texto
          || case when v_compras_texto = '' then '' else ', ' end
          || (item.cant - v_toma) || '× ' || v_empaque_nombre;
        insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
        values (next_id('suggestion','S-',0), v_hoy, item.cant - v_toma,
                'Faltante de empaque al reservar pedido ' || p_order_id, p_order_id, 'Inventario', v_empaque_id);
      end if;
    end;

    -- Extras de receta del combo (recipes del producto combo)
    for comp in
      select r.item_id, r.cantidad, it.nombre as it_nombre
      from recipes r join inventory_items it on it.id = r.item_id
      where r.product_id = item.product_id
    loop
      v_req := comp.cantidad * item.cant;
      select stock into v_stock_actual from inventory_items where id = comp.item_id for update;
      v_toma := least(coalesce(v_stock_actual,0), v_req);
      update inventory_items set stock = round(stock - v_toma, 3) where id = comp.item_id;
      if v_toma > 0 then
        perform _add_reservation(p_order_id, 'insumo', null, comp.item_id, comp.it_nombre, v_toma);
        perform _add_movement('Salida', comp.item_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
      end if;
      if v_toma < v_req then
        v_faltantes := v_faltantes || jsonb_build_object(
          'item_id', comp.item_id, 'producto', comp.it_nombre, 'cant', v_req - v_toma, 'area', 'Inventario');
        v_compras_texto := v_compras_texto
          || case when v_compras_texto = '' then '' else ', ' end
          || (v_req - v_toma) || '× ' || comp.it_nombre;
        insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
        values (next_id('suggestion','S-',0), v_hoy, v_req - v_toma,
                'Faltante de insumo al reservar pedido ' || p_order_id, p_order_id, 'Inventario', comp.item_id);
      end if;
    end loop;
  end loop;

  -- 3) Adiciones (de todos los items del pedido, solo con insumo_id)
  for addd in
    select a.id, a.nombre, a.insumo_id, a.insumo_cant, a.cant as ad_cant,
           oi.cant as item_cant, it.nombre as insumo_nombre
    from order_item_adiciones a
    join order_items oi on oi.id = a.order_item_id
    join inventory_items it on it.id = a.insumo_id
    where oi.order_id = p_order_id and a.insumo_id is not null
  loop
    v_req := addd.insumo_cant * addd.ad_cant * addd.item_cant;
    select stock into v_stock_actual from inventory_items where id = addd.insumo_id for update;
    v_toma := least(coalesce(v_stock_actual,0), v_req);
    update inventory_items set stock = round(stock - v_toma, 3) where id = addd.insumo_id;
    if v_toma > 0 then
      perform _add_reservation(p_order_id, 'insumo', null, addd.insumo_id,
        addd.insumo_nombre || ' (adición ' || addd.nombre || ')', v_toma);
      perform _add_movement('Salida', addd.insumo_id, -v_toma, 'Reserva pedido ' || p_order_id, p_order_id);
    end if;
    if v_toma < v_req then
      v_faltantes := v_faltantes || jsonb_build_object(
        'item_id', addd.insumo_id, 'producto', addd.insumo_nombre || ' (adición ' || addd.nombre || ')',
        'cant', v_req - v_toma, 'area', 'Inventario');
      v_compras_texto := v_compras_texto
        || case when v_compras_texto = '' then '' else ', ' end
        || (v_req - v_toma) || '× ' || addd.insumo_nombre;
      insert into production_suggestions (id, fecha, cantidad, motivo, order_id, area, item_id)
      values (next_id('suggestion','S-',0), v_hoy, v_req - v_toma,
              'Faltante de insumo (adición ' || addd.nombre || ') al reservar pedido ' || p_order_id,
              p_order_id, 'Inventario', addd.insumo_id);
    end if;
  end loop;

  -- Audits agregados si hubo faltantes
  if v_sugerencias_texto <> '' then
    perform _add_audit('Producción', p_order_id, 'Sugerencia de producción creada', '', v_sugerencias_texto);
  end if;
  if v_compras_texto <> '' then
    perform _add_audit('Inventario', p_order_id, 'Compra sugerida creada', '', v_compras_texto);
  end if;

  return v_faltantes;
end $$;

-- ============================================================================
-- F) _release_reservations — MISMA firma que rpc-pedidos-v1.sql:345. Cuerpo
-- completo copiado desde ahí; el ÚNICO cambio es: rama tipo='producto' ahora
-- distingue si la reserva tenía batch_id (vino del FIFO) — de ser así,
-- además de devolver products.stock, devuelve las unidades a
-- lote_figuras.consumidas del lote/figura exactos. Sin batch_id (remanente
-- legacy/a-producir): comportamiento IDÉNTICO al actual, sin tocar
-- lote_figuras (no hay de dónde descontar/devolver).
-- ============================================================================
create or replace function _release_reservations(p_order_id text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_liberadas integer := 0;
begin
  for r in select * from inventory_reservations where order_id = p_order_id and estado = 'Reservada' for update
  loop
    if r.tipo = 'producto' then
      update products set stock = coalesce(stock,0) + r.cantidad where id = r.product_id;
      -- VARIANTES 1b: si esta unidad salió de un lote físico concreto (FIFO
      -- al pagar), la cancelación la vuelve a dejar disponible en ESE lote —
      -- greatest(0, ...) es defensiva (consumidas jamás debería quedar
      -- negativa dado que solo se incrementa por el mismo camino que la
      -- libera, pero protege el CHECK lote_figuras_consumo_valido ante
      -- cualquier desalineo futuro en vez de reventar la liberación entera).
      if r.batch_id is not null then
        update lote_figuras set consumidas = greatest(0, consumidas - r.cantidad)
        where batch_id = r.batch_id and figura = r.figura;
      end if;
    elsif r.tipo = 'empaque' then
      update inventory_items set stock = round(stock + r.cantidad, 2) where id = r.item_id;
      perform _add_movement('Entrada', r.item_id, r.cantidad,
        'Liberación por cancelación de ' || p_order_id, p_order_id);
    elsif r.tipo = 'insumo' then
      update inventory_items set stock = round(stock + r.cantidad, 3) where id = r.item_id;
      perform _add_movement('Entrada', r.item_id, r.cantidad,
        'Liberación por cancelación de ' || p_order_id, p_order_id);
    end if;
    update inventory_reservations set estado = 'Liberada', liberada_en = now() where id = r.id;
    v_liberadas := v_liberadas + 1;
  end loop;

  if v_liberadas > 0 then
    perform _add_audit('Inventario', p_order_id, 'Reservas liberadas', '',
      v_liberadas || ' reserva(s) devueltas al stock');
  end if;

  return v_liberadas;
end $$;

-- ============================================================================
-- G) Grants — MISMO patrón que rpc-pedidos-v1.sql sección 3 y variantes-v1.sql
-- sección B: revoke SIEMPRE incluye `authenticated` (default privilege de
-- Supabase otorga EXECUTE a authenticated sobre TODA función nueva). Firmas
-- de _reserve_inventory/_release_reservations son IDÉNTICAS a las que ya
-- tenían revoke — create or replace no cambia ACLs existentes, pero se
-- re-declaran acá por defensa en profundidad y para que este archivo sea
-- autocontenido si algún día se aplica solo sobre una base que NO corrió
-- rpc-pedidos-v1.sql primero (no debería pasar — está en DEPENDENCIAS — pero
-- un revoke de más nunca rompe nada).
-- ============================================================================
revoke execute on function _reserve_inventory(text) from public, anon, authenticated;
revoke execute on function _release_reservations(text) from public, anon, authenticated;

commit;
