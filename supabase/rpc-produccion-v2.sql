-- ============================================================================
-- MOMOS OPS — Producción v2: corridas flexibles por figuras + desmolde diferido (v2)
-- Target: Supabase / PostgreSQL 17. Fuente de verdad de columnas: schema-v5.sql
-- (este archivo AGREGA columnas/tabla nuevas — ver sección A).
--
-- DEPENDENCIAS — aplicar en este orden:
--   1. schema-v5.sql
--   2. rpc-produccion-v1.sql  (crear_lote, set_lote_estado, empezar_congelamiento,
--      convertir_imperfectas — funciones que este archivo NO reemplaza, salvo
--      set_lote_estado, ver sección D)
--   3. sedes-v1.sql            (production_batches.sede_id — replicado acá para corridas)
--   4. fix-grants-v1.sql       (revoke de helpers _* — no lo repite este archivo)
--   5. ESTE ARCHIVO (rpc-produccion-v2.sql)
--
-- RESUMEN DE DECISIÓN (spec aprobada, opción 1 — «la 1», verbatim del usuario):
-- corrida flexible por figuras + desmolde diferido, receta por producto INTACTA,
-- pesos de figuras actualizados como DATO (no cambia la lógica, cambia el valor).
--
--   * Una CORRIDA es el evento de producción visible para el usuario (sabor +
--     relleno + salsa + una lista de figuras con cantidad). El servidor DERIVA
--     de esa lista los LOTES hijos reales (production_batches) agrupando por
--     (producto, gramaje) — el usuario nunca arma "un lote por producto" a mano.
--   * DESMOLDE DIFERIDO: crear_corrida ya NO sabe cuántas salen perfectas/
--     imperfectas/descartadas (eso se decide después, al desmoldar). Los lotes
--     hijos nacen con perfectas=imperfectas=descartadas=0 — ESTO ROMPE el default
--     de crear_lote (perfectas=prod) a propósito: por eso este archivo NO llama a
--     crear_lote() para los hijos, solo replica su mecánica de descuento inline.
--   * desmoldar_lote(...) es la ÚNICA puerta para registrar los 3 conteos y
--     sumar stock — set_lote_estado() ahora EXIGE que ya estén cuadrados antes
--     de aceptar la transición a 'Listo' (guard nuevo, sección D).
--   * RECETA INTACTA: el descuento de insumos sigue siendo por `prod` (cantidad
--     producida), NUNCA por `perfectas` — mismo principio de crear_lote v1
--     (línea ~49 de rpc-produccion-v1.sql), portado literal a cada lote hijo.
--   * figura→producto es DATO nuevo (figuras.product_id), no lógica nueva: el
--     servidor resuelve QUÉ producto corresponde a cada figura consultando esa
--     columna, en vez de que el formulario se lo diga.
--   * PR03 (Momo grande 190 g) y PR08 (Cheesecake cuchareable) quedan SIN figura
--     a propósito: no son producibles desde el form de corrida hasta que Julián
--     les asigne una figura en el catálogo — decisión explícita de la spec, no
--     un olvido. crear_lote() (v1) sigue disponible para producirlos directo.
--
-- Sellos: toda fecha/hora OPERATIVA usa Bogotá vía v_hoy — mismo patrón que
-- crear_lote (rpc-produccion-v1.sql línea 77). Los timestamptz canónicos
-- (created_at, inicio_congelacion) siguen con now() (hora servidor UTC).
--
-- ESPEJO (subrecetas-bom-v1.sql, 2026-07-11): crear_corrida (sección B, abajo)
-- fue evolucionada por ese archivo vía CREATE OR REPLACE con firma intacta.
-- El cuerpo vigente de la función es el que está ACÁ (mismo texto, copia
-- literal) — subrecetas-bom-v1.sql es la migración que se ejecuta; ESTE
-- archivo es el espejo de lectura/histórico de Producción v2. Si tocás
-- crear_corrida, tocá los DOS archivos. Resumen del cambio: el bloque de
-- descuento por lote hijo ahora intenta primero resolver una subreceta de
-- mousse activa para el sabor de la corrida (consume mousse + figura_relleno,
-- relleno configurable — NUNCA hardcodeado); si no hay subreceta para ese
-- sabor, cae al camino legacy por `recipes` intacto (retrocompat total) y
-- marca "modo":"legacy" en el retorno de ese lote.
--
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

-- ============================================================================
-- A) DDL — figura→producto (dato), pesos oficiales (dato), tabla corridas,
--    columnas nuevas de production_batches
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A.1) figuras.product_id — mapeo figura→producto como DATO (no como lógica).
-- El servidor resuelve el producto de cada figura leyendo esta columna; el
-- formulario de corrida solo manda el nombre de la figura.
-- ---------------------------------------------------------------------------
alter table figuras add column if not exists product_id text references products(id);

-- Mapeo inicial (spec): Lizi/Momo/Toby → PR01 (Momo Gatito 150 g);
-- Max/Rocco/Danna → PR02 (Momo Perrito 150 g); Teo → PR04 (Momo premium 280 g).
-- PR03/PR08 quedan SIN figura a propósito — ver RESUMEN DE DECISIÓN arriba.
update figuras set product_id = 'PR01' where nombre in ('Lizi','Momo','Toby');
update figuras set product_id = 'PR02' where nombre in ('Max','Rocco','Danna');
update figuras set product_id = 'PR04' where nombre = 'Teo';

-- Pesos oficiales actualizados (spec, DATO — reemplaza el seed 150/280 parejo
-- de seed-catalogos.sql). Lizi queda en 150 (sin cambio, no está en la lista).
update figuras set gramaje_g = 180 where nombre in ('Momo','Toby','Max','Rocco','Danna');
update figuras set gramaje_g = 250 where nombre = 'Teo';

-- ---------------------------------------------------------------------------
-- A.2) Tabla corridas — el evento de producción visible para el usuario.
-- Mismo patrón de sede_id que production_batches (sedes-v1.sql línea 74):
-- not null default 'SEDE-01' references sedes(id) — replicado acá porque
-- corridas nace DESPUÉS de sedes-v1.sql, no antes (no hay migración que
-- "agregue" sede_id a esta tabla: nace ya con la columna).
-- ---------------------------------------------------------------------------
create table if not exists corridas (
  id              text primary key,               -- CR-001
  fecha           date not null,
  sabor           text not null,
  relleno         text default '',
  salsa           text default '',
  resp_user_id    text references users(id),
  obs             text default '',
  idempotency_key text unique,
  sede_id         text not null default 'SEDE-01' references sedes(id),
  created_at      timestamptz not null default now()
);

insert into counters (clave, valor) values ('corrida', 0)
on conflict (clave) do nothing;

-- RLS de corridas — MISMO patrón exacto que production_batches:
-- deny-by-default (ya activado globalmente por el bloque genérico de
-- schema-v5.sql, líneas 597-602, que corre sobre pg_tables — pero esa tabla
-- no existía cuando corrió ese bloque, así que se activa acá explícito) +
-- admin_all + staff_read + prod_insert/prod_update (Cocina/Empaque).
alter table corridas enable row level security;

drop policy if exists admin_all on corridas;
create policy admin_all on corridas for all
  using (is_admin()) with check (is_admin());

drop policy if exists staff_read on corridas;
create policy staff_read on corridas for select to authenticated
  using (is_staff());

drop policy if exists prod_insert on corridas;
create policy prod_insert on corridas for insert to authenticated
  with check (current_rol() in ('Cocina','Empaque'));

drop policy if exists prod_update on corridas;
create policy prod_update on corridas for update to authenticated
  using (current_rol() in ('Cocina','Empaque')) with check (current_rol() in ('Cocina','Empaque'));

-- ---------------------------------------------------------------------------
-- A.3) production_batches — columnas nuevas: qué corrida lo generó + qué
-- figuras (y cuántas de cada una) componen ese lote hijo.
-- ---------------------------------------------------------------------------
alter table production_batches add column if not exists corrida_id text references corridas(id);
-- Composición del lote hijo, ej: [{"figura":"Momo","cant":2},{"figura":"Toby","cant":3}]
alter table production_batches add column if not exists figuras jsonb;

-- ============================================================================
-- B) RPC crear_corrida(p jsonb) returns jsonb
-- Payload: {sabor, relleno?, salsa?, figuras:[{figura,cant}], resp_user_id?,
--   vence?, horas_congelacion?, obs?, sugerencia_id?, idempotency_key?}
--
-- Deriva N lotes hijos (production_batches) agrupando las figuras por
-- (product_id, gramaje_g) — cada grupo es UN lote. Descuenta receta por
-- producto INTACTA (por prod, no por perfectas). Desmolde DIFERIDO: los
-- hijos nacen con perfectas=imperfectas=descartadas=0 y
-- stock_contabilizado=false — NO se suma stock acá (eso ocurre recién en
-- desmoldar_lote, sección C).
-- ============================================================================
create or replace function crear_corrida(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_idem text := nullif(p->>'idempotency_key','');
  v_existing_id text;
  v_id text;
  v_sabor text := trim(coalesce(p->>'sabor',''));
  v_relleno text := coalesce(p->>'relleno','');
  v_salsa text := coalesce(p->>'salsa','');
  v_resp_user_id text := nullif(p->>'resp_user_id','');
  v_obs text := coalesce(p->>'obs','');
  v_sugerencia_id text := nullif(p->>'sugerencia_id','');
  v_sug record;
  v_vence date;
  v_horas_congelacion numeric;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_figuras jsonb := p->'figuras';
  v_fig jsonb;
  v_fig_nombre text;
  v_fig_cant integer;
  v_num numeric;
  v_figura record;      -- fila de `figuras` (nombre, product_id, activo) — primera pasada
  v_figura_product_id text;  -- product_id de una figura — segunda pasada (escalar, no record)
  v_producto record;    -- fila de `products` (id, nombre, tipo, activo)
  -- Acumulador de cantidades por figura (repetidas en el payload → SUMAR)
  v_cant_por_figura jsonb := '{}'::jsonb;
  v_figura_keys text[];
  v_key text;
  -- Grupos por (product_id, gramaje_g) → un lote hijo por grupo
  v_grupo record;
  v_batch_id text;
  v_total_unidades integer := 0;
  v_lotes jsonb := '[]'::jsonb;
  v_faltantes jsonb := '[]'::jsonb;
  rec record;
  v_req numeric;
  v_toma numeric;
  v_prod_nombre text;
  -- ---- NUEVO (subrecetas-bom-v1.sql): consumo por subreceta con fallback legacy ----
  v_mousse record;              -- subreceta de mousse resuelta para v_sabor (si existe)
  v_gramos_relleno numeric;     -- Σ(figura_relleno.gramos_por_unidad activos)
  v_gramos_mousse numeric;      -- gramaje_g del lote − v_gramos_relleno
  v_rel record;                 -- fila de figura_relleno (join subrecetas)
  v_modo text;                  -- 'subreceta' | 'legacy' — informativo, por lote
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede crear corridas de producción';
  end if;

  -- Idempotencia a nivel CORRIDA: mismo idempotency_key ya usado → devolver
  -- la corrida existente y sus lotes hijos, sin efectos.
  if v_idem is not null then
    select id into v_existing_id from corridas where idempotency_key = v_idem;
    if v_existing_id is not null then
      return jsonb_build_object(
        'corrida_id', v_existing_id,
        'lotes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'batch_id', b.id, 'product_id', b.product_id, 'prod', b.prod, 'gramaje_g', b.gramaje_g))
          from production_batches b where b.corrida_id = v_existing_id
        ), '[]'::jsonb),
        'faltantes', '[]'::jsonb,
        'idempotente', true
      );
    end if;
  end if;

  -- Validaciones de cabecera
  if v_sabor = '' then
    raise exception 'El sabor de la corrida no puede estar vacío';
  end if;
  if v_figuras is null or jsonb_typeof(v_figuras) <> 'array' or jsonb_array_length(v_figuras) = 0 then
    raise exception 'La corrida necesita al menos una figura con cantidad';
  end if;
  if v_resp_user_id is not null and not exists (select 1 from users where id = v_resp_user_id) then
    raise exception 'El usuario responsable % no existe', v_resp_user_id;
  end if;

  -- Primera pasada: validar cada entrada (figura existe/activa/con producto
  -- asignado, cantidad entera > 0) y ACUMULAR por figura — figuras repetidas
  -- en el array del payload SE SUMAN acá, no se rechazan ni se procesan dos veces.
  for v_fig in select * from jsonb_array_elements(v_figuras)
  loop
    v_fig_nombre := trim(coalesce(v_fig->>'figura',''));
    if v_fig_nombre = '' then
      raise exception 'Cada entrada de figuras necesita el nombre de la figura';
    end if;

    begin
      v_num := nullif(v_fig->>'cant','')::numeric;
    exception when invalid_text_representation then
      raise exception 'La cantidad de la figura «%» debe ser un entero mayor a 0', v_fig_nombre;
    end;
    if v_num is null or v_num <= 0 or v_num <> trunc(v_num) then
      raise exception 'La cantidad de la figura «%» debe ser un entero mayor a 0', v_fig_nombre;
    end if;
    v_fig_cant := v_num::integer;

    select nombre, product_id, activo into v_figura from figuras where nombre = v_fig_nombre;
    if v_figura.nombre is null then
      raise exception 'La figura «%» no existe', v_fig_nombre;
    end if;
    if not v_figura.activo then
      raise exception 'La figura «%» está dada de baja', v_fig_nombre;
    end if;
    if v_figura.product_id is null then
      raise exception 'La figura «%» no tiene producto asignado — asignale un producto en el catálogo antes de producirla', v_fig_nombre;
    end if;

    v_cant_por_figura := jsonb_set(
      v_cant_por_figura, array[v_fig_nombre],
      to_jsonb(coalesce((v_cant_por_figura->>v_fig_nombre)::integer, 0) + v_fig_cant)
    );
  end loop;

  -- Segunda pasada: validar el producto derivado de cada figura ÚNICA que
  -- apareció en el payload (evita validar N veces el mismo producto si la
  -- figura vino repetida). v_figura_keys = nombres de figura sin duplicados.
  select array_agg(k) into v_figura_keys from jsonb_object_keys(v_cant_por_figura) as k;
  foreach v_key in array v_figura_keys
  loop
    select f.product_id into v_figura_product_id from figuras f where f.nombre = v_key;
    select p.id, p.nombre, p.tipo, p.activo into v_producto from products p where p.id = v_figura_product_id;
    if v_producto.id is null then
      raise exception 'La figura «%» apunta al producto % que no existe', v_key, v_figura_product_id;
    end if;
    if v_producto.tipo <> 'momo' then
      raise exception 'La figura «%» apunta al producto % (tipo %), pero solo se producen lotes de productos tipo momo', v_key, v_producto.id, v_producto.tipo;
    end if;
    if not v_producto.activo then
      raise exception 'El producto % (figura «%») está dado de baja', v_producto.id, v_key;
    end if;
  end loop;

  -- Sellos y defaults
  -- El vencimiento se sella al desmoldar (migración 17), no al crear la corrida.
  v_vence := null;
  v_horas_congelacion := coalesce(nullif(p->>'horas_congelacion','')::numeric, 10);

  v_id := next_id('corrida','CR-',3);  -- CR-001 — mismo padding que L-001/R-001 (convención existente)

  -- Idempotencia bajo carrera: dos llamadas concurrentes con la misma key
  -- pueden pasar ambas el chequeo inicial; el UNIQUE de idempotency_key es
  -- el árbitro real (mismo patrón que crear_lote, rpc-produccion-v1.sql ~150-171).
  begin
    insert into corridas (id, fecha, sabor, relleno, salsa, resp_user_id, obs, idempotency_key)
    values (v_id, v_hoy, v_sabor, v_relleno, v_salsa, v_resp_user_id, v_obs, v_idem);
  exception when unique_violation then
    if v_idem is not null then
      select id into v_existing_id from corridas where idempotency_key = v_idem;
      if v_existing_id is not null then
        return jsonb_build_object(
          'corrida_id', v_existing_id,
          'lotes', coalesce((
            select jsonb_agg(jsonb_build_object(
              'batch_id', b.id, 'product_id', b.product_id, 'prod', b.prod, 'gramaje_g', b.gramaje_g))
            from production_batches b where b.corrida_id = v_existing_id
          ), '[]'::jsonb),
          'faltantes', '[]'::jsonb,
          'idempotente', true
        );
      end if;
    end if;
    raise;  -- otra violación de unicidad (p.ej. PK): no es idempotencia, propagar
  end;

  -- ---- NUEVO: resolver UNA vez la mousse del sabor de la corrida (aplica
  -- igual a todos los lotes hijos — la corrida es de UN sabor). Si no hay
  -- subreceta activa de mousse para ese sabor, v_mousse.id queda null y CADA
  -- lote hijo cae al camino legacy (retrocompat total).
  select id, nombre, item_id, merma_pct into v_mousse
  from subrecetas
  where tipo in ('mousse_frutal','mousse_cremosa')
    and activo
    and lower(sabor) = lower(v_sabor)
  limit 1;

  -- ---- NUEVO: Σ gramos de relleno activos (regla configurable, jamás
  -- hardcodeada — ver figura_relleno). Se calcula UNA vez, aplica a todos
  -- los lotes de esta corrida por igual (el relleno no varía por figura).
  select coalesce(sum(gramos_por_unidad), 0) into v_gramos_relleno
  from figura_relleno where activo;

  -- Derivación server-side: agrupar por (product_id, gramaje_g) — cada grupo
  -- es UN lote hijo. jsonb_agg arma la composición ("figuras") de ese lote.
  for v_grupo in
    select f.product_id, f.gramaje_g,
           sum((v_cant_por_figura->>f.nombre)::integer) as prod_total,
           jsonb_agg(jsonb_build_object('figura', f.nombre, 'cant', (v_cant_por_figura->>f.nombre)::integer)
                     order by f.nombre) as figuras_grupo
    from figuras f
    where f.nombre = any(v_figura_keys) and f.activo
    group by f.product_id, f.gramaje_g
  loop
    v_batch_id := next_id('batch','L-',3);
    select nombre into v_prod_nombre from products where id = v_grupo.product_id;

    insert into production_batches (
      id, fecha, product_id, figura, sabor, relleno, salsa, gramaje_g,
      prod, perfectas, imperfectas, descartadas, destino, resp_user_id, vence,
      estado, stock_contabilizado, horas_congelacion, inicio_congelacion,
      obs, corrida_id, figuras
    ) values (
      v_batch_id, v_hoy, v_grupo.product_id, '', v_sabor, v_relleno, v_salsa,
      v_grupo.gramaje_g, v_grupo.prod_total,
      0, 0, 0,  -- desmolde diferido: NO se defaultea perfectas=prod (a diferencia de crear_lote v1)
      '—', v_resp_user_id, v_vence,
      'En preparación', false, v_horas_congelacion, null,
      v_obs, v_id, v_grupo.figuras_grupo
    );

    v_total_unidades := v_total_unidades + v_grupo.prod_total;

    if v_mousse.id is not null then
      -- ================== CAMINO NUEVO: consumo por subreceta ==================
      v_modo := 'subreceta';

      v_gramos_mousse := v_grupo.gramaje_g - v_gramos_relleno;
      if v_gramos_mousse <= 0 then
        raise exception 'El gramaje del lote (%) no alcanza para descontar el relleno configurado (% g) — revisá figura_relleno',
          v_grupo.gramaje_g, v_gramos_relleno;
      end if;

      -- Consumo de la mousse: (gramaje − relleno) × prod, convertido a la
      -- unidad del item de la subreceta (kg/L → /1000; g → tal cual).
      select it.id, it.nombre, it.stock, it.unidad into rec
      from inventory_items it where it.id = v_mousse.item_id for update;

      v_req := round(
        (v_gramos_mousse * v_grupo.prod_total) / (case rec.unidad when 'g' then 1 else 1000 end),
        4);
      v_toma := least(rec.stock, v_req);
      update inventory_items set stock = round(stock - v_toma, 4) where id = v_mousse.item_id;
      if v_toma > 0 then
        perform _add_movement('Uso en producción', v_mousse.item_id, -v_toma, 'Lote ' || v_batch_id, null, v_batch_id);
      end if;
      if v_toma < v_req then
        v_faltantes := v_faltantes || jsonb_build_object(
          'item_id', v_mousse.item_id, 'insumo', rec.nombre,
          'faltan', round(v_req - v_toma, 4), 'unidad', rec.unidad);
      end if;

      -- Consumo de CADA figura_relleno activa: gramos_por_unidad × prod,
      -- convertido a la unidad del item de SU subreceta. Mismo patrón least().
      for v_rel in
        select fr.id, fr.gramos_por_unidad, sr.item_id, sr.nombre as sr_nombre
        from figura_relleno fr join subrecetas sr on sr.id = fr.subreceta_id
        where fr.activo
        order by fr.id
      loop
        select it.id, it.nombre, it.stock, it.unidad into rec
        from inventory_items it where it.id = v_rel.item_id for update;

        v_req := round(
          (v_rel.gramos_por_unidad * v_grupo.prod_total) / (case rec.unidad when 'g' then 1 else 1000 end),
          4);
        v_toma := least(rec.stock, v_req);
        update inventory_items set stock = round(stock - v_toma, 4) where id = v_rel.item_id;
        if v_toma > 0 then
          perform _add_movement('Uso en producción', v_rel.item_id, -v_toma, 'Lote ' || v_batch_id, null, v_batch_id);
        end if;
        if v_toma < v_req then
          v_faltantes := v_faltantes || jsonb_build_object(
            'item_id', v_rel.item_id, 'insumo', rec.nombre,
            'faltan', round(v_req - v_toma, 4), 'unidad', rec.unidad);
        end if;
      end loop;

    else
      -- ================== CAMINO LEGACY: consumo por `recipes` (intacto) ==================
      v_modo := 'legacy';

      -- Descuento de receta por PROD de ESTE lote hijo — mecánica IDÉNTICA a
      -- crear_lote (rpc-produccion-v1.sql ~173-193), inline (no se llama a
      -- crear_lote(): sus defaults de perfectas y su idempotencia por-lote no
      -- aplican acá — ver RESUMEN DE DECISIÓN). Lock ordenado por item_id para
      -- que dos lotes concurrentes (de esta u otra corrida) no se deadlockeen.
      for rec in
        select r.item_id, r.cantidad, it.nombre, it.stock, it.unidad
        from recipes r join inventory_items it on it.id = r.item_id
        where r.product_id = v_grupo.product_id
        order by r.item_id
        for update of it
      loop
        v_req := round(rec.cantidad * v_grupo.prod_total, 3);
        v_toma := least(rec.stock, v_req);
        update inventory_items set stock = round(stock - v_toma, 3) where id = rec.item_id;
        if v_toma > 0 then
          perform _add_movement('Uso en producción', rec.item_id, -v_toma, 'Lote ' || v_batch_id, null, v_batch_id);
        end if;
        if v_toma < v_req then
          v_faltantes := v_faltantes || jsonb_build_object(
            'item_id', rec.item_id, 'insumo', rec.nombre,
            'faltan', round(v_req - v_toma, 3), 'unidad', rec.unidad);
        end if;
      end loop;
    end if;

    v_lotes := v_lotes || jsonb_build_object(
      'batch_id', v_batch_id, 'product_id', v_grupo.product_id,
      'prod', v_grupo.prod_total, 'gramaje_g', v_grupo.gramaje_g, 'modo', v_modo);

    perform _add_audit('Lote', v_batch_id, 'Lote creado',
      '', v_grupo.prod_total || '× ' || v_prod_nombre || ' (corrida ' || v_id || ', modo ' || v_modo || ')');
  end loop;

  -- Atender sugerencia de producción, si vino — igual que crear_lote v1.
  if v_sugerencia_id is not null then
    select * into v_sug from production_suggestions where id = v_sugerencia_id;
    if v_sug.id is null then
      raise exception 'La sugerencia % no existe', v_sugerencia_id;
    end if;
    if v_sug.area = 'Inventario' then
      raise exception 'La sugerencia % es de Inventario (compra), no de Producción: no se puede atender creando una corrida', v_sugerencia_id;
    end if;
    if v_sug.estado <> 'Pendiente' then
      raise exception 'La sugerencia % ya fue atendida', v_sugerencia_id;
    end if;
    update production_suggestions set estado = 'Atendida' where id = v_sugerencia_id;
  end if;

  perform _add_audit('Corrida', v_id, 'Corrida registrada', '',
    v_sabor || ' · ' || v_total_unidades || ' unidades en ' || jsonb_array_length(v_lotes) || ' lote(s)');

  return jsonb_build_object('corrida_id', v_id, 'lotes', v_lotes, 'faltantes', v_faltantes);
end $$;

-- ============================================================================
-- C) RPC desmoldar_lote(p_batch_id, p_perfectas, p_imperfectas, p_descartadas)
-- returns jsonb
--
-- Única puerta para registrar los 3 conteos de un lote nacido con desmolde
-- diferido (perfectas=imperfectas=descartadas=0). Suma stock del producto
-- ATÓMICAMENTE junto con el registro de conteos — no depende de una llamada
-- posterior a set_lote_estado (aunque set_lote_estado también exige que ya
-- estén cuadrados, ver sección D).
--
-- ESPEJO (variantes-v1.sql, 2026-07-12): desmoldar_lote EVOLUCIONÓ en ese
-- archivo — nueva firma (agrega p_figuras jsonb default null) vía DROP de la
-- función de 4 args + CREATE de la de 5 (un parámetro nuevo, aunque tenga
-- DEFAULT, cambia la identidad de la función en Postgres; create or replace
-- con firma distinta no reemplaza, crea una segunda función). El cuerpo
-- vigente de la función es el que está en variantes-v1.sql — ESTE archivo es
-- el espejo de lectura/histórico de Producción v2. Si tocás desmoldar_lote,
-- tocá los DOS archivos. Resumen del cambio: ahora puede recibir conteos
-- desglosados POR FIGURA para lotes mixtos (production_batches.figuras con
-- 2+ entradas), que se guardan en la tabla nueva `lote_figuras`; un lote de
-- una sola figura sigue funcionando SIN p_figuras (auto-deriva), y toda la
-- lógica de guards/stock/audit de ESTE archivo se preserva intacta.
-- set_lote_estado (sección D) NO CAMBIÓ — su guard existente de conteos
-- cuadrados ya cubre lotes mixtos sin necesitar ningún ajuste.
-- ============================================================================
create or replace function desmoldar_lote(
  p_batch_id text, p_perfectas integer, p_imperfectas integer, p_descartadas integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b production_batches%rowtype;
  v_prod record;
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

  update production_batches set
    perfectas = p_perfectas,
    imperfectas = p_imperfectas,
    descartadas = p_descartadas,
    estado = 'Listo',
    stock_contabilizado = true
  where id = p_batch_id;

  -- Sumar stock del producto (mismo principio que set_lote_estado v1: SIN
  -- movimiento de inventario — products.stock vive fuera del ledger de insumos).
  select id, tipo into v_prod from products where id = b.product_id for update;
  if v_prod.id is not null and v_prod.tipo = 'momo' then
    update products set stock = coalesce(stock,0) + p_perfectas where id = b.product_id;
  end if;

  perform _add_audit('Lote', p_batch_id, 'Lote desmoldado', b.estado,
    'Listo · P=' || p_perfectas || ' I=' || p_imperfectas || ' D=' || p_descartadas);

  return jsonb_build_object('ok', true, 'estado', 'Listo');
end $$;

-- ============================================================================
-- D) set_lote_estado — CREATE OR REPLACE, FIRMA INTACTA (preserva ACLs).
-- Cambio quirúrgico en la rama 'Listo': ahora exige que perfectas+imperfectas+
-- descartadas = prod ANTES de aceptar la transición. Los lotes existentes
-- L-019/L-020 (10+0+0=10=prod) siguen pasando sin fricción. Todo lo demás
-- es copia literal de rpc-produccion-v1.sql (líneas 222-279) — NO tocar nada
-- fuera de la rama 'Listo'.
-- ============================================================================
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

  -- GUARD NUEVO (Producción v2): pasar a 'Listo' exige desmolde ya registrado.
  -- Los lotes que nacen de crear_lote (v1) ya traen perfectas=prod por default
  -- (perfectas+0+0=prod) y pasan sin fricción; los que nacen de crear_corrida
  -- (v2) nacen en 0+0+0 y DEBEN pasar por desmoldar_lote primero.
  if p_estado = 'Listo' and (b.perfectas + b.imperfectas + b.descartadas) <> b.prod then
    raise exception 'Para pasar a Listo hay que registrar el desmolde (conteos) — usá desmoldar_lote';
  end if;

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

-- ============================================================================
-- E) Grants — mismo patrón de fix-grants-v1.sql: el revoke SIEMPRE incluye
-- authenticated (no solo public/anon), porque Supabase otorga EXECUTE por
-- default privileges a anon/authenticated sobre toda función nueva.
--
-- set_lote_estado NO se re-otorga/re-revoca acá a propósito: CREATE OR REPLACE
-- con la MISMA firma (p_batch_id text, p_estado text) preserva los ACLs ya
-- existentes de la función (comportamiento nativo de Postgres — a diferencia
-- de un DROP+CREATE, que resetea a los default privileges y reabriría el
-- agujero que fix-grants-v1.sql cerró). Los ACLs vigentes que sobreviven son
-- los de rpc-produccion-v1.sql: revoke de public/anon (línea 744) + grant a
-- authenticated (línea 755) — exactamente lo que se necesita, sin duplicar.
-- ============================================================================

revoke execute on function crear_corrida(jsonb) from public, anon, authenticated;
revoke execute on function desmoldar_lote(text, integer, integer, integer) from public, anon, authenticated;

grant execute on function crear_corrida(jsonb) to authenticated;
grant execute on function desmoldar_lote(text, integer, integer, integer) to authenticated;
