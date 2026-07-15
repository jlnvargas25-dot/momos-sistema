-- ============================================================================
-- MOMOS OPS — Variantes Etapa 2: reservas contra producción (2026-07-12)
-- Target: Supabase / PostgreSQL 17. Fuentes de verdad que este archivo
-- evoluciona: variantes-v1.sql (desmoldar_lote 5 args, lote_figuras),
-- variantes-1b-fifo.sql (_reserve_inventory con FIFO de variante exacta,
-- lote_figuras.consumidas, reservas con batch_id/figura). schema-v5.sql es la
-- fuente de columnas base (production_suggestions.estado Pendiente/Atendida).
--
-- QUÉ ES ESTE SLICE (Etapa 2 — decisión del dueño 2026-07-12: asignación
-- AUTOMÁTICA al desmoldar):
-- Hoy, un pedido pagado SIN stock desmoldado ni agregado queda así: v_toma=0
-- → ni siquiera nace una reserva; solo una production_suggestion 'Pendiente'
-- con el faltante. Cuando la cocina produce y desmolda, el alta de stock cae
-- al pool general y NADIE conecta ese desmolde con los pedidos que esperaban:
-- la unidad aparece "disponible" cuando ya tiene dueño. Este archivo cierra
-- ese hilo: la COLA de producción son las production_suggestions pendientes
-- con order_id, y desmoldar_lote la atiende PRIMERO, automáticamente.
--
-- DECISIONES DE PRODUCTO (cerradas por el dueño, NO reabrir):
--   1. Asignación AUTOMÁTICA al desmoldar (sin confirmación humana): misma
--      política que la venta de 1b — SABOR y FIGURA son filtros duros; una
--      variante distinta no atiende ni completa esa espera.
--   2. Orden de la cola: FIFO por orders.pagado_en (el que pagó primero,
--      cobra primero); desempate por id de sugerencia (= orden de creación).
--   3. La cola SIEMPRE gana al mostrador: lo asignado se descuenta de
--      products.stock en el mismo acto — el neto visible del desmolde es
--      perfectas − asignadas.
--
-- INVARIANTE CONTABLE QUE ESTE ARCHIVO NO ROMPE: products.stock sigue siendo
-- el agregado de unidades NO comprometidas. Al pagar, una unidad reservada se
-- descuenta de stock; la cola replica ese contrato al desmoldar: alta de
-- perfectas (comportamiento existente, intacto) e inmediatamente stock -= lo
-- asignado a la cola + consumidas += en el lote exacto + reserva con
-- batch_id/figura. Cancelar un pedido atendido ya devuelve stock y consumidas
-- vía _release_reservations (1b, sin tocar); entregar consume la reserva vía
-- _consume_reservations (sin tocar). El ciclo cierra sin funciones públicas
-- nuevas.
--
-- LÍMITES CONOCIDOS (a propósito, materia de Etapa 3):
--   - La cola se atiende SOLO al desmoldar. Disponibilidad que aparece por
--     cancelación de otro pedido no la dispara (esa unidad queda para venta
--     nueva / colchón).
--   - Faltantes de COMBO (pull genérico) crean sugerencias con el product_id
--     del combo — un desmolde (siempre de un momo) no las matchea; quedan
--     para atención manual como hoy.
--   - Sugerencias pre-migración (order_item_id null) se atienden con FIFO
--     puro del lote (sin sabor/figura pedidos que respetar) — igual de
--     conservador que la venta con variante null.
--
-- ORDEN DE LOCKS (evitar deadlocks): el flujo de pago lockea products ANTES
-- de lote_figuras (_reserve_inventory → _asignar_variante_fifo). desmoldar_
-- lote ya lockea production_batches → products (sección de alta de stock);
-- _atender_cola_produccion corre DESPUÉS de ese lock de products y recién ahí
-- toca production_suggestions → lote_figuras. El orden relativo products →
-- lote_figuras se preserva en ambos caminos; la exclusión mutua por producto
-- la da el propio lock de products.
--
-- DEPENDENCIAS — aplicar en este orden:
--   1. schema-v5.sql  2. rpc-pedidos-v1.sql  3. normalizacion-clientes-v1.sql
--   4. rpc-produccion-v2.sql  5. variantes-v1.sql  6. variantes-1b-fifo.sql
--   7. ESTE ARCHIVO (variantes-2-cola.sql)
--
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

begin;

-- ============================================================================
-- A) DDL — production_suggestions.order_item_id: la sugerencia recuerda QUÉ
-- variante esperaba (figura/sabor viven en order_items — no se duplican).
-- Nullable: sugerencias viejas, de combo, o de insumo quedan null.
-- ============================================================================
alter table production_suggestions add column if not exists order_item_id text references order_items(id);

comment on column production_suggestions.order_item_id is
  'Item del pedido cuyo faltante generó esta sugerencia — SOLO poblado en faltantes de momo (área Producción, Etapa 2). Permite a la cola de producción respetar sabor (duro) y figura (blanda) al asignar el desmolde. Null en sugerencias de combo, de insumo/empaque, o anteriores a variantes Etapa 2.';

-- ============================================================================
-- B) _atender_cola_produccion — helper nuevo INTERNO. Dado un lote recién
-- desmoldado (lote_figuras ya poblado, products.stock ya altado por el
-- caller), recorre la cola de sugerencias pendientes de ESE producto en FIFO
-- por pagado_en y asigna unidades de ESTE lote: reserva con batch_id/figura +
-- consumidas += + stock -= . Devuelve el total de unidades asignadas.
--
-- SOLO mira lote_figuras de p_batch_id: las unidades asignables son
-- exactamente las que este desmolde acaba de crear — la resta de stock nunca
-- puede exceder el alta (asignadas <= perfectas del lote).
-- ============================================================================
create or replace function _atender_cola_produccion(p_batch_id text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  b production_batches%rowtype;
  s record;
  f record;
  v_sabor_lote text;
  v_sabor_pedido text;
  v_figura_pedida text;
  v_need integer;
  v_toma integer;
  v_asignadas_pedido integer;
  v_total integer := 0;
  v_texto text;
begin
  select * into b from production_batches where id = p_batch_id;
  if b.id is null then
    return 0;
  end if;
  v_sabor_lote := nullif(trim(coalesce(b.sabor,'')), '');

  for s in
    select ps.id as sug_id, ps.order_id, ps.cantidad, ps.order_item_id,
           oi.figura as oi_figura, oi.sabor as oi_sabor
    from production_suggestions ps
    join orders o on o.id = ps.order_id
    left join order_items oi on oi.id = ps.order_item_id
    where ps.estado = 'Pendiente'
      and ps.area = 'Producción'
      and ps.product_id = b.product_id
      and ps.order_id is not null
      -- Pedidos que ya salieron del flujo no se atienden: Cancelado (nada que
      -- deber), Entregado/Reclamo (el faltante se resolvió por fuera — una
      -- reserva tardía jamás se consumiría).
      and o.estado not in ('Cancelado', 'Entregado', 'Reclamo')
    order by o.pagado_en asc nulls last, ps.id asc
    for update of ps
  loop
    v_need := greatest(0, round(s.cantidad))::integer;
    if v_need <= 0 then
      continue;
    end if;

    -- SABOR DURO (decisión 1): si el pedido pide un sabor y este lote es de
    -- otro, esta espera NO se atiende con este lote — sigue en cola.
    v_sabor_pedido := nullif(trim(coalesce(s.oi_sabor,'')), '');
    if v_sabor_pedido is not null and (v_sabor_lote is null or v_sabor_lote <> v_sabor_pedido) then
      continue;
    end if;
    v_figura_pedida := nullif(trim(coalesce(s.oi_figura,'')), '');

    v_asignadas_pedido := 0;

    -- FIGURA DURA: dentro de ESTE lote solo entra la figura pedida. FOR UPDATE sobre el mismo
    -- objeto (lote_figuras) y en el mismo orden relativo que el flujo de pago
    -- (products ya lockeado por el caller) — ver ORDEN DE LOCKS.
    for f in
      select lf.figura, (lf.perfectas - lf.consumidas) as disp
      from lote_figuras lf
      where lf.batch_id = p_batch_id
        and (v_figura_pedida is null or lf.figura = v_figura_pedida)
        and (lf.perfectas - lf.consumidas) > 0
      order by
        lf.figura asc
      for update
    loop
      exit when v_need <= 0;
      v_toma := least(f.disp, v_need);
      if v_toma <= 0 then
        continue;
      end if;

      update lote_figuras set consumidas = consumidas + v_toma
      where batch_id = p_batch_id and figura = f.figura;

      insert into inventory_reservations (
        id, order_id, tipo, product_id, item_id, nombre, cantidad, batch_id, figura
      )
      select next_id('reservation','RES-',0), s.order_id, 'producto', b.product_id, null,
             p.nombre || ' · ' || f.figura || ' (' || p_batch_id || ')',
             v_toma, p_batch_id, f.figura
      from products p where p.id = b.product_id;

      -- La cola gana al mostrador: la unidad recién altada nace comprometida.
      update products set stock = coalesce(stock,0) - v_toma where id = b.product_id;

      v_need := v_need - v_toma;
      v_asignadas_pedido := v_asignadas_pedido + v_toma;
      v_total := v_total + v_toma;
    end loop;

    if v_asignadas_pedido > 0 then
      if v_need <= 0 then
        update production_suggestions set estado = 'Atendida' where id = s.sug_id;
        v_texto := v_asignadas_pedido || '× asignada(s) del lote ' || p_batch_id || ' — faltante cubierto';
      else
        -- Cobertura parcial: la sugerencia queda Pendiente por el resto.
        update production_suggestions set cantidad = v_need where id = s.sug_id;
        v_texto := v_asignadas_pedido || '× asignada(s) del lote ' || p_batch_id || ' — pendiente ' || v_need;
      end if;
      perform _add_audit('Producción', s.order_id, 'Cola de producción atendida', '', v_texto);
    end if;

    -- Lote agotado → los siguientes de la cola esperan el próximo desmolde
    -- (se corta acá para no recorrer sugerencias que ya no pueden cubrirse).
    exit when not exists (
      select 1 from lote_figuras where batch_id = p_batch_id and (perfectas - consumidas) > 0
    );
  end loop;

  return v_total;
end $$;

revoke execute on function _atender_cola_produccion(text) from public, anon, authenticated;

-- ============================================================================
-- C) desmoldar_lote — MISMA firma de 5 args que variantes-v1.sql (create or
-- replace preserva ACLs; revoke+grant re-declarados por defensa en
-- profundidad, patrón de la casa). Cuerpo completo copiado de variantes-v1;
-- los ÚNICOS cambios: llamada a _atender_cola_produccion() DESPUÉS del alta
-- de stock (products ya lockeado), sufijo en el audit y campo
-- 'asignadas_cola' en el jsonb de retorno.
-- ============================================================================
create or replace function desmoldar_lote(
  p_batch_id text, p_perfectas integer, p_imperfectas integer, p_descartadas integer,
  p_figuras jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b production_batches%rowtype;
  v_prod record;
  v_plan jsonb;
  v_plan_count integer;
  v_fig jsonb;
  v_fig_nombre text;
  v_fig_cant integer;
  v_fig_perfectas integer;
  v_fig_imperfectas integer;
  v_fig_descartadas integer;
  v_plan_figuras text[];
  v_enviadas_figuras text[];
  v_sum_perfectas integer := 0;
  v_sum_imperfectas integer := 0;
  v_sum_descartadas integer := 0;
  v_cant_plan integer;
  v_asignadas integer := 0;   -- VARIANTES 2: unidades asignadas a la cola
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede desmoldar lotes';
  end if;

  select * into b from production_batches where id = p_batch_id for update;
  if b.id is null then
    raise exception 'El lote % no existe', p_batch_id;
  end if;

  if b.stock_contabilizado then
    raise exception 'El lote % ya fue desmoldado', p_batch_id;
  end if;
  if b.estado not in ('En preparación','Congelando') then
    raise exception 'El lote % debe estar "En preparación" o "Congelando" para desmoldarse (está en "%")', p_batch_id, b.estado;
  end if;

  if p_perfectas is null or p_imperfectas is null or p_descartadas is null
     or p_perfectas < 0 or p_imperfectas < 0 or p_descartadas < 0 then
    raise exception 'Perfectas, imperfectas y descartadas son obligatorias y no pueden ser negativas';
  end if;
  if p_perfectas + p_imperfectas + p_descartadas <> b.prod then
    raise exception 'Los conteos no cuadran: %+%+%=% pero el lote produjo %',
      p_perfectas, p_imperfectas, p_descartadas, p_perfectas + p_imperfectas + p_descartadas, b.prod;
  end if;

  if b.figuras is not null and jsonb_typeof(b.figuras) = 'array' and jsonb_array_length(b.figuras) > 0 then
    v_plan := b.figuras;
  else
    v_plan := jsonb_build_array(
      jsonb_build_object('figura', coalesce(nullif(b.figura,''), '—'), 'cant', b.prod)
    );
  end if;
  select array_agg(distinct trim(f->>'figura')) into v_plan_figuras
  from jsonb_array_elements(v_plan) as f;
  v_plan_count := coalesce(array_length(v_plan_figuras, 1), 0);

  if (select count(*) from jsonb_array_elements(v_plan)) <> (select count(distinct trim(f->>'figura')) from jsonb_array_elements(v_plan) f) then
    raise exception 'Plan de figuras corrupto en el lote %: figura repetida en production_batches.figuras — revisá el lote', p_batch_id;
  end if;

  if p_figuras is null then
    if v_plan_count = 1 then
      begin
        insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
        values (p_batch_id, v_plan_figuras[1], (v_plan->0->>'cant')::integer, p_perfectas, p_imperfectas, p_descartadas);
      exception when unique_violation then
        raise exception 'El lote % ya tiene el desmolde por figura registrado', p_batch_id;
      end;
    else
      raise exception 'LOTE_MIXTO: el lote % combina % figuras — enviá p_figuras con conteos por figura', p_batch_id, v_plan_count;
    end if;
  else
    if jsonb_typeof(p_figuras) <> 'array' or jsonb_array_length(p_figuras) = 0 then
      raise exception 'p_figuras debe ser un array no vacío de {figura,perfectas,imperfectas,descartadas}';
    end if;

    select array_agg(distinct trim(f->>'figura')) into v_enviadas_figuras
    from jsonb_array_elements(p_figuras) as f;

    if jsonb_array_length(p_figuras) <> coalesce(array_length(v_enviadas_figuras,1),0) then
      raise exception 'p_figuras no puede repetir la misma figura dos veces';
    end if;
    if not (v_enviadas_figuras <@ v_plan_figuras and v_plan_figuras <@ v_enviadas_figuras) then
      raise exception 'p_figuras debe cubrir EXACTAMENTE las figuras del plan del lote % (plan: %, recibidas: %)',
        p_batch_id, array_to_string(v_plan_figuras, ', '), array_to_string(v_enviadas_figuras, ', ');
    end if;

    for v_fig in select * from jsonb_array_elements(p_figuras)
    loop
      v_fig_nombre := trim(v_fig->>'figura');
      v_fig_perfectas := nullif(v_fig->>'perfectas','')::integer;
      v_fig_imperfectas := nullif(v_fig->>'imperfectas','')::integer;
      v_fig_descartadas := nullif(v_fig->>'descartadas','')::integer;
      if v_fig_perfectas is null or v_fig_imperfectas is null or v_fig_descartadas is null
         or v_fig_perfectas < 0 or v_fig_imperfectas < 0 or v_fig_descartadas < 0 then
        raise exception 'La figura «%» necesita perfectas/imperfectas/descartadas obligatorias y no negativas', v_fig_nombre;
      end if;

      select (f->>'cant')::integer into v_cant_plan
      from jsonb_array_elements(v_plan) as f
      where trim(f->>'figura') = v_fig_nombre
      limit 1;

      if v_fig_perfectas + v_fig_imperfectas + v_fig_descartadas <> v_cant_plan then
        raise exception 'La figura «%» no cuadra: %+%+%=% pero el plan pide %',
          v_fig_nombre, v_fig_perfectas, v_fig_imperfectas, v_fig_descartadas,
          v_fig_perfectas + v_fig_imperfectas + v_fig_descartadas, v_cant_plan;
      end if;

      v_sum_perfectas := v_sum_perfectas + v_fig_perfectas;
      v_sum_imperfectas := v_sum_imperfectas + v_fig_imperfectas;
      v_sum_descartadas := v_sum_descartadas + v_fig_descartadas;
    end loop;

    if v_sum_perfectas <> p_perfectas or v_sum_imperfectas <> p_imperfectas or v_sum_descartadas <> p_descartadas then
      raise exception 'La suma por figura (%+%+%=%) no coincide con los totales del lote (%+%+%=%)',
        v_sum_perfectas, v_sum_imperfectas, v_sum_descartadas, v_sum_perfectas + v_sum_imperfectas + v_sum_descartadas,
        p_perfectas, p_imperfectas, p_descartadas, p_perfectas + p_imperfectas + p_descartadas;
    end if;

    begin
      insert into lote_figuras (batch_id, figura, cant, perfectas, imperfectas, descartadas)
      select p_batch_id, trim(f->>'figura'), (f->>'cant')::integer,
             (f2->>'perfectas')::integer, (f2->>'imperfectas')::integer, (f2->>'descartadas')::integer
      from jsonb_array_elements(v_plan) as f
      join jsonb_array_elements(p_figuras) as f2 on trim(f2->>'figura') = trim(f->>'figura');
    exception when unique_violation then
      raise exception 'El lote % ya tiene el desmolde por figura registrado', p_batch_id;
    end;
  end if;

  update production_batches set
    perfectas = p_perfectas,
    imperfectas = p_imperfectas,
    descartadas = p_descartadas,
    estado = 'Listo',
    stock_contabilizado = true
  where id = p_batch_id;

  select id, tipo into v_prod from products where id = b.product_id for update;
  if v_prod.id is not null and v_prod.tipo = 'momo' then
    update products set stock = coalesce(stock,0) + p_perfectas where id = b.product_id;

    -- VARIANTES 2: la cola de producción se atiende ANTES de que el alta
    -- llegue al mostrador — products ya está lockeado (línea de arriba); el
    -- helper solo toca sugerencias → lote_figuras de ESTE lote (ver ORDEN DE
    -- LOCKS en la cabecera). Solo momos: las sugerencias de combo/insumo no
    -- matchean el product_id de un lote.
    v_asignadas := _atender_cola_produccion(p_batch_id);
  end if;

  perform _add_audit('Lote', p_batch_id, 'Lote desmoldado', b.estado,
    'Listo · P=' || p_perfectas || ' I=' || p_imperfectas || ' D=' || p_descartadas
    || case when v_asignadas > 0 then ' · ' || v_asignadas || ' a pedidos en cola' else '' end);

  return jsonb_build_object('ok', true, 'estado', 'Listo', 'asignadas_cola', v_asignadas);
end $$;

revoke execute on function desmoldar_lote(text, integer, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function desmoldar_lote(text, integer, integer, integer, jsonb) to authenticated;

-- ============================================================================
-- D) _reserve_inventory — MISMA firma que variantes-1b-fifo.sql. Cuerpo
-- completo copiado de ahí (versión de variante exacta); el ÚNICO cambio es
-- que el faltante de momo (sección 1) puebla order_item_id en la sugerencia —
-- así la cola sabe qué figura/sabor esperaba ese pedido. Los faltantes de
-- combo/empaque/insumo quedan sin order_item_id (la cola no los atiende).
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
    select stock into v_stock_actual from products where id = item.product_id for update;
    v_toma := least(coalesce(v_stock_actual,0), item.cant);
    update products set stock = coalesce(stock,0) - v_toma where id = item.product_id;
    if v_toma > 0 then
      v_remanente := _asignar_variante_fifo(
        p_order_id, item.product_id, item.figura, item.sabor,
        round(v_toma)::integer, item.nombre
      );
      if v_remanente > 0 then
        if nullif(trim(coalesce(item.figura,'')), '') is not null
           or nullif(trim(coalesce(item.sabor,'')), '') is not null then
          update products set stock = coalesce(stock,0) + v_remanente where id = item.product_id;
          v_toma := v_toma - v_remanente;
        else
          perform _add_reservation(p_order_id, 'producto', item.product_id, null, item.nombre, v_remanente);
        end if;
      end if;
    end if;
    if v_toma < item.cant then
      v_faltantes := v_faltantes || jsonb_build_object(
        'producto', item.nombre, 'cant', item.cant - v_toma, 'area', 'Producción');
      v_sugerencias_texto := v_sugerencias_texto
        || case when v_sugerencias_texto = '' then '' else ', ' end
        || (item.cant - v_toma) || '× ' || item.nombre;
      -- VARIANTES 2: la sugerencia lleva order_item_id — la cola de
      -- producción respeta la variante pedida al asignar el desmolde.
      insert into production_suggestions (id, fecha, product_id, cantidad, motivo, order_id, area, order_item_id)
      values (next_id('suggestion','S-',0), v_hoy, item.product_id,
              item.cant - v_toma, 'Faltante al reservar pedido ' || p_order_id, p_order_id, 'Producción', item.id);
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
          v_remanente := _asignar_variante_fifo(
            p_order_id, comp.component_id, null, null,
            round(v_toma)::integer, comp.comp_nombre || ' (para ' || item.nombre || ')'
          );
          if v_remanente > 0 then
            perform _add_reservation(p_order_id, 'producto', comp.component_id, null,
              comp.comp_nombre || ' (para ' || item.nombre || ')', v_remanente);
          end if;
        end if;
        v_necesita := v_necesita - v_toma;
      end loop;
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

revoke execute on function _reserve_inventory(text) from public, anon, authenticated;

commit;
