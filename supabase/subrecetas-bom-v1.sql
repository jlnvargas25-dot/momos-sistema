-- ============================================================================
-- MOMOS OPS — Subrecetas / BOM v1 (2026-07-11)
-- Target: Supabase / PostgreSQL 17. Fuente de verdad de columnas base:
-- schema-v5.sql. Fuente de verdad de lógica de producción: rpc-produccion-v1.sql
-- (WAC de entrada_insumo) y rpc-produccion-v2.sql (crear_corrida, patrón
-- v_variables / _add_movement / _add_audit / idempotencia por unique_violation).
-- Fuente de verdad del DOMINIO (recetas y gramos): RECETAS.md (raíz del repo).
-- Referencia funcional: OPERACION-COCINA.md §13.2.
--
-- QUÉ ES ESTE SLICE (spec aprobada, engram momos/subrecetas-bom-spec):
-- Hoy `crear_corrida` descuenta insumos ATÓMICOS por `recipes` (receta por
-- producto). Pero la mousse/cheesecake/ganache/salsa NO son insumos atómicos:
-- son BASES que Cocina prepara aparte, en tandas de ~1000 g, y que después se
-- usan para rellenar figuras. Este slice modela esas bases como `subrecetas`
-- con su propia receta (`subreceta_ingredientes`), su propia RPC de producción
-- (`producir_subreceta`) y su propio item de inventario (stock+costo WAC como
-- CUALQUIER insumo). `crear_corrida` evoluciona para consumir la mousse de la
-- subreceta del sabor resuelto (si existe) en vez de `recipes`, con fallback
-- legacy total si el sabor todavía no tiene subreceta.
--
-- DECISIONES DE DISEÑO:
--  * `subrecetas.item_id` → inventory_items: la fila de inventario que porta
--    STOCK y COSTO WAC de la base preparada. `producir_subreceta` la alimenta
--    con la MISMA fórmula WAC que `entrada_insumo` (costo 0 no diluye).
--  * `subreceta_ingredientes.cantidad` va EN LA UNIDAD DEL INSUMO por cada
--    1000 g de subreceta — mismo patrón que `recipes.cantidad` (consumo por
--    1 unidad de producto). Densidad ≈ 1 para líquidos/lácteos (crema de
--    leche, leche, agua, zumos, pulpas líquidas): 1 g ≈ 1 mL ≈ 0.001 L. Para
--    sólidos en kg: 1 g = 0.001 kg. Documentado inline en cada INSERT.
--  * `figura_relleno` (AJUSTE EXPLÍCITO del usuario sobre la primera versión
--    de la spec): el relleno de 20 g cheesecake + 15 g ganache NO va
--    hardcodeado en la RPC — vive en tabla editable. `crear_corrida` sólo
--    conoce la REGLA (mousse = gramaje − Σ relleno_activos), nunca el número.
--  * `subreceta_producciones`: log/trazabilidad de cada tanda preparada
--    (idempotencia + costo del batch + faltantes), mismo espíritu que
--    `corridas`/`production_batches`.
--  * `inventory_items.costo_estimado`: los insumos atómicos NUEVOS que este
--    slice necesita (grenetina, queso crema, chocolate, …) no tienen costo
--    real de compra todavía — se siembran con un estimado de mercado (Cali,
--    2026) y este flag para poder filtrarlos y corregirlos con una
--    `entrada_insumo` real más adelante (el WAC los pule solo).
--
-- DEPENDENCIAS — aplicar en este orden:
--   1. schema-v5.sql
--   2. rpc-produccion-v1.sql   (entrada_insumo, _add_movement, _add_audit, next_id)
--   3. sedes-v1.sql
--   4. fix-grants-v1.sql
--   5. rpc-produccion-v2.sql   (crear_corrida original — ESTE archivo la reemplaza
--      con CREATE OR REPLACE, firma intacta)
--   6. seed-catalogos.sql
--   7. ESTE ARCHIVO (subrecetas-bom-v1.sql)
--
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

-- ============================================================================
-- A) DDL — tablas nuevas + columna nueva en inventory_items
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A.1) inventory_items.costo_estimado — marca insumos con costo estimado
-- pendiente de corrección (ver DECISIONES arriba). Cualquier insumo VIEJO
-- (sembrado antes de este slice) queda en false por default: sus costos ya
-- vienen de compras reales de la maqueta.
-- ---------------------------------------------------------------------------
alter table inventory_items add column if not exists costo_estimado boolean not null default false;

-- ---------------------------------------------------------------------------
-- A.2) subrecetas — catálogo de bases (mousses, cheesecake, ganache, salsas,
-- crocante). item_id porta stock+costo WAC en inventory_items; rinde_g es la
-- normalización de RECETAS.md (siempre 1000 g de mezcla).
-- ---------------------------------------------------------------------------
create table if not exists subrecetas (
  id         text primary key,                    -- SR01
  nombre     text not null,
  tipo       text not null check (tipo in
    ('mousse_frutal','mousse_cremosa','cheesecake','ganache','salsa','crocante')),
  sabor      text,                                 -- obligatorio para mousse_frutal/mousse_cremosa/salsa; null en cheesecake/ganache/crocante
  merma_pct  numeric not null default 0 check (merma_pct >= 0 and merma_pct < 100),
  rinde_g    numeric not null default 1000 check (rinde_g > 0),
  item_id    text not null unique references inventory_items(id),
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint subreceta_sabor_obligatorio check (
    (tipo in ('mousse_frutal','mousse_cremosa','salsa') and sabor is not null and trim(sabor) <> '')
    or (tipo in ('cheesecake','ganache','crocante'))
  )
);
create unique index if not exists subrecetas_tipo_sabor_uq
  on subrecetas (tipo, lower(sabor)) where sabor is not null;

-- ---------------------------------------------------------------------------
-- A.3) subreceta_ingredientes — receta maestra por 1000 g de subreceta.
-- cantidad EN LA UNIDAD DEL INSUMO (mismo patrón que recipes.cantidad).
-- ---------------------------------------------------------------------------
create table if not exists subreceta_ingredientes (
  subreceta_id text not null references subrecetas(id),
  item_id      text not null references inventory_items(id),
  cantidad     numeric not null check (cantidad > 0),
  primary key (subreceta_id, item_id)
);

-- ---------------------------------------------------------------------------
-- A.4) figura_relleno — AJUSTE del usuario: relleno configurable, jamás
-- hardcodeado. gramos_por_unidad = cuánto de ESA subreceta lleva cada figura
-- (independiente del gramaje de la figura). Seed: cheesecake 20 g + ganache 15 g.
-- ---------------------------------------------------------------------------
create table if not exists figura_relleno (
  id             text primary key,                -- FR01
  subreceta_id   text not null references subrecetas(id),
  gramos_por_unidad numeric not null check (gramos_por_unidad > 0),
  activo         boolean not null default true
);

-- ---------------------------------------------------------------------------
-- A.5) subreceta_producciones — log/trazabilidad de cada tanda preparada.
-- fecha sellada en America/Bogota (regla del proyecto); created_at UTC (now()).
-- ---------------------------------------------------------------------------
create table if not exists subreceta_producciones (
  id               text primary key,               -- SP-001
  fecha            date not null,
  subreceta_id     text not null references subrecetas(id),
  gramos_nominales numeric not null check (gramos_nominales > 0),
  gramos_obtenidos numeric not null check (gramos_obtenidos >= 0),
  costo_batch      numeric not null default 0,
  faltantes        jsonb not null default '[]'::jsonb,
  resp_user_id     text references users(id),
  obs              text default '',
  idempotency_key  text unique,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- A.6) counters — SR / FR / SP, seed defensivo (idéntico espíritu al bloque
-- 0 de rpc-produccion-v1.sql: en la base viva el seed de abajo los deja en
-- su valor real; esto es red de seguridad para deploys frescos).
-- ---------------------------------------------------------------------------
insert into counters (clave, valor) values ('subreceta', 0), ('figrelleno', 0), ('subprod', 0)
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- A.7) RLS — MISMO patrón exacto que corridas/production_batches:
-- deny-by-default + admin_all + staff_read + prod_insert/prod_update
-- (Cocina/Empaque) en las tablas operativas. subrecetas/figura_relleno son
-- CATÁLOGO (igual que products/recipes): admin_all + staff_read alcanza —
-- no hay política de insert/update staff, se editan por RPC o por el admin.
-- ---------------------------------------------------------------------------
alter table subrecetas enable row level security;
alter table subreceta_ingredientes enable row level security;
alter table figura_relleno enable row level security;
alter table subreceta_producciones enable row level security;

-- NOTA: `to authenticated` explícito en admin_all (más estricto que el patrón
-- de corridas en rpc-produccion-v2.sql, que lo omite) — is_admin() ya resuelve
-- false para anon sin sesión así que no hay hueco real, pero acá se sigue la
-- convención más estricta del loop genérico de schema-v5.sql (línea 655).
drop policy if exists admin_all on subrecetas;
create policy admin_all on subrecetas for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists staff_read on subrecetas;
create policy staff_read on subrecetas for select to authenticated using (is_staff());

drop policy if exists admin_all on subreceta_ingredientes;
create policy admin_all on subreceta_ingredientes for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists staff_read on subreceta_ingredientes;
create policy staff_read on subreceta_ingredientes for select to authenticated using (is_staff());

drop policy if exists admin_all on figura_relleno;
create policy admin_all on figura_relleno for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists staff_read on figura_relleno;
create policy staff_read on figura_relleno for select to authenticated using (is_staff());

drop policy if exists admin_all on subreceta_producciones;
create policy admin_all on subreceta_producciones for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists staff_read on subreceta_producciones;
create policy staff_read on subreceta_producciones for select to authenticated using (is_staff());
drop policy if exists prod_insert on subreceta_producciones;
create policy prod_insert on subreceta_producciones for insert to authenticated
  with check (current_rol() in ('Cocina','Empaque'));

-- ============================================================================
-- B) RPC producir_subreceta(p jsonb) returns jsonb
-- Payload: {subreceta_id, gramos_nominales, gramos_obtenidos?, resp_user_id?,
--   obs?, idempotency_key?}
--
-- (1) idempotencia por idempotency_key (unique_violation, mismo patrón que
--     crear_corrida); (2) consume cada ingrediente = cantidad×(nominales/1000),
--     least() no-bloqueante + _add_movement; (3) costo_batch = Σ(toma×costo);
--     (4) suma gramos_obtenidos (default = nominales×(1−merma_pct/100)) al
--     item_id de la subreceta con WAC idéntico a entrada_insumo; (5) inserta
--     el log; (6) audita; (7) retorna jsonb.
-- ============================================================================
create or replace function producir_subreceta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_idem text := nullif(p->>'idempotency_key','');
  v_existing_id text;
  v_id text;
  v_subreceta_id text := p->>'subreceta_id';
  v_sr record;
  v_gramos_nominales numeric;
  v_gramos_obtenidos numeric;
  v_resp_user_id text := nullif(p->>'resp_user_id','');
  v_obs text := coalesce(p->>'obs','');
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_faltantes jsonb := '[]'::jsonb;
  v_costo_batch numeric := 0;
  rec record;
  v_req numeric;
  v_toma numeric;
  v_factor numeric;
  -- WAC del item de la subreceta (idéntico a entrada_insumo)
  it inventory_items%rowtype;
  v_gramos_en_unidad numeric;
  v_stock_nuevo numeric;
  v_costo_compra numeric;
  v_costo_wac numeric;
begin
  if not is_staff() then
    raise exception 'Solo staff activo puede producir subrecetas';
  end if;

  -- Idempotencia: mismo idempotency_key ya usado → devolver el log existente, sin efectos.
  if v_idem is not null then
    select id into v_existing_id from subreceta_producciones where idempotency_key = v_idem;
    if v_existing_id is not null then
      return (
        select jsonb_build_object(
          'ok', true, 'id', sp.id, 'costo_batch', sp.costo_batch,
          'gramos_obtenidos', sp.gramos_obtenidos, 'faltantes', sp.faltantes, 'idempotente', true)
        from subreceta_producciones sp where sp.id = v_existing_id
      );
    end if;
  end if;

  -- Validaciones de cabecera
  select id, nombre, merma_pct, item_id, activo into v_sr from subrecetas where id = v_subreceta_id;
  if v_sr.id is null then
    raise exception 'La subreceta % no existe', v_subreceta_id;
  end if;
  if not v_sr.activo then
    raise exception 'La subreceta % está dada de baja', v_subreceta_id;
  end if;

  v_gramos_nominales := nullif(p->>'gramos_nominales','')::numeric;
  if v_gramos_nominales is null or v_gramos_nominales <= 0 then
    raise exception 'Los gramos nominales deben ser mayores a 0';
  end if;

  v_gramos_obtenidos := nullif(p->>'gramos_obtenidos','')::numeric;
  v_gramos_obtenidos := coalesce(v_gramos_obtenidos,
    round(v_gramos_nominales * (1 - v_sr.merma_pct / 100.0), 1));
  if v_gramos_obtenidos < 0 then
    raise exception 'Los gramos obtenidos no pueden ser negativos';
  end if;

  if v_resp_user_id is not null and not exists (select 1 from users where id = v_resp_user_id) then
    raise exception 'El usuario responsable % no existe', v_resp_user_id;
  end if;

  v_id := next_id('subprod','SP-',3);

  -- Idempotencia bajo carrera: el UNIQUE de idempotency_key es el árbitro real.
  begin
    insert into subreceta_producciones (
      id, fecha, subreceta_id, gramos_nominales, gramos_obtenidos, costo_batch,
      faltantes, resp_user_id, obs, idempotency_key
    ) values (
      v_id, v_hoy, v_subreceta_id, v_gramos_nominales, v_gramos_obtenidos, 0,
      '[]'::jsonb, v_resp_user_id, v_obs, v_idem
    );
  exception when unique_violation then
    if v_idem is not null then
      select id into v_existing_id from subreceta_producciones where idempotency_key = v_idem;
      if v_existing_id is not null then
        return (
          select jsonb_build_object(
            'ok', true, 'id', sp.id, 'costo_batch', sp.costo_batch,
            'gramos_obtenidos', sp.gramos_obtenidos, 'faltantes', sp.faltantes, 'idempotente', true)
          from subreceta_producciones sp where sp.id = v_existing_id
        );
      end if;
    end if;
    raise;
  end;

  -- Consumo de ingredientes: req = cantidad × (nominales/1000), least() no-bloqueante.
  v_factor := v_gramos_nominales / 1000.0;
  for rec in
    select si.item_id, si.cantidad, it2.nombre, it2.stock, it2.unidad, it2.costo
    from subreceta_ingredientes si join inventory_items it2 on it2.id = si.item_id
    where si.subreceta_id = v_subreceta_id
    order by si.item_id
    for update of it2
  loop
    v_req := round(rec.cantidad * v_factor, 4);
    v_toma := least(rec.stock, v_req);
    update inventory_items set stock = round(stock - v_toma, 4) where id = rec.item_id;
    if v_toma > 0 then
      perform _add_movement('Uso en producción', rec.item_id, -v_toma, 'Subreceta ' || v_id, null, null);
      v_costo_batch := v_costo_batch + round(v_toma * rec.costo, 2);
    end if;
    if v_toma < v_req then
      v_faltantes := v_faltantes || jsonb_build_object(
        'item_id', rec.item_id, 'insumo', rec.nombre,
        'faltan', round(v_req - v_toma, 4), 'unidad', rec.unidad);
    end if;
  end loop;
  v_costo_batch := round(v_costo_batch, 2);

  -- Suma de stock al item de la subreceta, convirtiendo gramos_obtenidos a la
  -- unidad del item (kg → /1000; L → /1000; g → tal cual), con WAC IDÉNTICO
  -- a entrada_insumo (costo_batch 0 no diluye, solo suma stock).
  select * into it from inventory_items where id = v_sr.item_id for update;
  v_gramos_en_unidad := case it.unidad
    when 'kg' then v_gramos_obtenidos / 1000.0
    when 'L'  then v_gramos_obtenidos / 1000.0
    when 'g'  then v_gramos_obtenidos
    else v_gramos_obtenidos / 1000.0  -- fallback defensivo (no debería pasar: items de subreceta son kg)
  end;

  v_costo_compra := case when v_gramos_en_unidad > 0 then v_costo_batch / v_gramos_en_unidad else 0 end;
  v_stock_nuevo := it.stock + v_gramos_en_unidad;
  v_costo_wac := case
    when v_costo_batch > 0 and v_stock_nuevo > 0
      then (it.stock * it.costo + v_gramos_en_unidad * v_costo_compra) / v_stock_nuevo
    else it.costo  -- costo 0 NO diluye, solo suma stock (mismo principio de entrada_insumo)
  end;

  update inventory_items set
    stock = round(v_stock_nuevo, 4),
    costo = round(v_costo_wac, 2),
    compra = v_hoy
  where id = v_sr.item_id;

  if v_gramos_en_unidad > 0 then
    perform _add_movement('Entrada', v_sr.item_id, v_gramos_en_unidad,
      'Producción subreceta ' || v_id || ' (' || v_sr.nombre || ') · costo batch ' || v_costo_batch,
      null, null);
  end if;

  update subreceta_producciones set costo_batch = v_costo_batch, faltantes = v_faltantes where id = v_id;

  perform _add_audit('Subreceta', v_id, 'Subreceta producida', '',
    v_sr.nombre || ' · ' || v_gramos_obtenidos || ' g obtenidos · costo ' || v_costo_batch);

  return jsonb_build_object(
    'ok', true, 'id', v_id, 'costo_batch', v_costo_batch,
    'gramos_obtenidos', v_gramos_obtenidos, 'faltantes', v_faltantes);
end $$;

revoke execute on function producir_subreceta(jsonb) from public, anon, authenticated;
grant execute on function producir_subreceta(jsonb) to authenticated;

-- ============================================================================
-- C) crear_corrida — CREATE OR REPLACE, FIRMA INTACTA (preserva ACLs).
-- Cambio quirúrgico: el bloque de descuento por lote hijo ahora intenta
-- primero resolver una subreceta de mousse activa para el sabor de la
-- corrida. Si existe: consume mousse + figura_relleno (regla, no números
-- hardcodeados). Si NO existe: fallback COMPLETO al camino legacy por
-- `recipes` (retrocompat total — lotes históricos y sabores sin subreceta
-- siguen funcionando igual que en rpc-produccion-v2.sql) + flag "modo" en
-- el retorno de cada lote. Todo lo demás (derivación de lotes, idempotencia,
-- figuras jsonb, sugerencia_id, audit) es copia literal de rpc-produccion-v2.sql.
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
  v_vence := nullif(p->>'vence','')::date;
  v_vence := coalesce(v_vence, v_hoy + 14);
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

-- set_lote_estado/desmoldar_lote NO se tocan en este slice — siguen siendo
-- los de rpc-produccion-v2.sql (CREATE OR REPLACE con firma intacta no
-- resetea sus ACLs; no hace falta repetirlos acá).

-- crear_corrida ya tenía sus grants revocados/otorgados en rpc-produccion-v2.sql
-- (revoke public/anon/authenticated + grant authenticated) — CREATE OR REPLACE
-- con la MISMA firma preserva esos ACLs (comportamiento nativo de Postgres,
-- documentado en rpc-produccion-v2.sql sección E). No se repite acá.

-- ============================================================================
-- D) SEED — insumos atómicos nuevos, items de inventario para bases nuevas,
-- subrecetas + subreceta_ingredientes, figura_relleno, counters.
-- Idempotente: todo INSERT usa ON CONFLICT DO NOTHING.
--
-- COSTOS: estimados de mercado MAYORISTA Cali, 2026 (criterio del autor de
-- esta migración — Julián corrige con compras reales; costo_estimado=true
-- en todos los insumos atómicos nuevos para poder filtrarlos y revisarlos).
-- Los items de BASE (mousses/cheesecake/salsas/crocante) nacen con costo 0 y
-- costo_estimado=false: su costo real lo pone el WAC de producir_subreceta.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- D.1) inventory_cats nueva para la base crocante (no calza en ninguna
-- categoría existente: no es "Relleno" ni "Salsa" ni "Ganache").
-- ---------------------------------------------------------------------------
insert into inventory_cats (nombre, activo) values
  ('Bases crocantes', true)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------------
-- D.2) Insumos atómicos NUEVOS (id siguiendo el counter de invitem: la base
-- viva llega hasta I14 — ver seed-catalogos.sql counters 'invitem'=14 y
-- rpc-produccion-v1.sql bloque 0 — arrancan en I15). costo_estimado=true en
-- TODOS; stock 0, minimo 0, proveedor '' (compra pendiente).
-- ---------------------------------------------------------------------------
insert into inventory_items (id, nombre, cat, unidad, stock, minimo, costo, proveedor, costo_estimado) values
  ('I15', 'Grenetina',                          'Ingredientes', 'kg', 0, 0, 95000, '', true),
  ('I16', 'Sal',                                'Ingredientes', 'kg', 0, 0, 2500,  '', true),
  ('I17', 'Leche en polvo',                     'Ingredientes', 'kg', 0, 0, 22000, '', true),
  ('I18', 'Azúcar',                             'Ingredientes', 'kg', 0, 0, 4800,  '', true),
  ('I19', 'Zumo de limón',                      'Ingredientes', 'L',  0, 0, 6000,  '', true),
  ('I20', 'Agua',                               'Ingredientes', 'L',  0, 0, 200,   '', true),
  ('I21', 'Leche de coco',                      'Ingredientes', 'L',  0, 0, 9500,  '', true),
  ('I22', 'Ralladura de coco',                  'Ingredientes', 'kg', 0, 0, 14000, '', true),
  ('I23', 'Pulpa de maracuyá',                  'Ingredientes', 'kg', 0, 0, 9500,  '', true),
  ('I24', 'Banano',                             'Ingredientes', 'kg', 0, 0, 3200,  '', true),
  ('I25', 'Pulpa de durazno escurrido',         'Ingredientes', 'kg', 0, 0, 9000,  '', true),
  ('I26', 'Leche evaporada',                    'Ingredientes', 'L',  0, 0, 6500,  '', true),
  ('I27', 'Galleta Oreo sin crema',              'Ingredientes', 'kg', 0, 0, 18000, '', true),
  ('I28', 'Crema tipo Oreo',                     'Ingredientes', 'kg', 0, 0, 20000, '', true),
  ('I29', 'Vainilla líquida',                    'Ingredientes', 'L',  0, 0, 45000, '', true),
  ('I30', 'Cacao en polvo',                     'Ingredientes', 'kg', 0, 0, 26000, '', true),
  ('I31', 'Avellana triturada',                 'Ingredientes', 'kg', 0, 0, 48000, '', true),
  ('I32', 'M&M / mini M&M',                     'Ingredientes', 'kg', 0, 0, 32000, '', true),
  ('I33', 'Milo',                               'Ingredientes', 'kg', 0, 0, 19000, '', true),
  ('I34', 'Caramelo salado (insumo)',           'Ingredientes', 'kg', 0, 0, 24000, '', true),
  ('I35', 'Queso crema',                        'Ingredientes', 'kg', 0, 0, 28000, '', true),
  ('I36', 'Leche condensada',                   'Ingredientes', 'kg', 0, 0, 9500,  '', true),
  ('I37', 'Chocolate semiamargo/con leche',     'Ingredientes', 'kg', 0, 0, 38000, '', true),
  ('I38', 'Mantequilla',                        'Ingredientes', 'kg', 0, 0, 16000, '', true),
  ('I39', 'Frutos rojos / fresa / mora',        'Ingredientes', 'kg', 0, 0, 12000, '', true),
  ('I40', 'Manzana verde',                      'Ingredientes', 'kg', 0, 0, 4500,  '', true),
  ('I41', 'Esencia de manzana verde',           'Ingredientes', 'L',  0, 0, 60000, '', true),
  ('I42', 'Arequipe repostero',                 'Ingredientes', 'kg', 0, 0, 14000, '', true),
  ('I43', 'Galleta triturada (Oreo/Saltín/María/Ducales)', 'Ingredientes', 'kg', 0, 0, 16000, '', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- D.3) Items de inventario para las BASES nuevas (mousses/cheesecake/salsas/
-- crocante). Costo inicial 0 + costo_estimado=false: el WAC de
-- producir_subreceta les pone costo real desde la primera tanda.
-- ---------------------------------------------------------------------------
insert into inventory_items (id, nombre, cat, unidad, stock, minimo, costo, proveedor, costo_estimado) values
  ('I44', 'Base mousse mango biche',   'Bases de mousse',  'kg', 0, 0, 0, 'Producción propia', false),
  ('I45', 'Base mousse coco',          'Bases de mousse',  'kg', 0, 0, 0, 'Producción propia', false),
  ('I46', 'Base mousse limón',         'Bases de mousse',  'kg', 0, 0, 0, 'Producción propia', false),
  ('I47', 'Base mousse banano',        'Bases de mousse',  'kg', 0, 0, 0, 'Producción propia', false),
  ('I48', 'Base mousse durazno',       'Bases de mousse',  'kg', 0, 0, 0, 'Producción propia', false),
  ('I49', 'Base mousse Oreo',          'Bases de mousse',  'kg', 0, 0, 0, 'Producción propia', false),
  ('I50', 'Base mousse Nutella',       'Bases de mousse',  'kg', 0, 0, 0, 'Producción propia', false),
  ('I51', 'Base mousse M&M',           'Bases de mousse',  'kg', 0, 0, 0, 'Producción propia', false),
  ('I52', 'Base mousse Milo',          'Bases de mousse',  'kg', 0, 0, 0, 'Producción propia', false),
  ('I53', 'Base mousse caramelo salado','Bases de mousse', 'kg', 0, 0, 0, 'Producción propia', false),
  ('I54', 'Relleno cheesecake',        'Rellenos',         'kg', 0, 0, 0, 'Producción propia', false),
  ('I55', 'Salsa caramelo salado',     'Salsas',           'kg', 0, 0, 0, 'Producción propia', false),
  ('I56', 'Salsa maracuyá',            'Salsas',           'kg', 0, 0, 0, 'Producción propia', false),
  ('I57', 'Salsa manzana verde',       'Salsas',           'kg', 0, 0, 0, 'Producción propia', false),
  ('I58', 'Salsa arequipe',            'Salsas',           'kg', 0, 0, 0, 'Producción propia', false),
  ('I59', 'Salsa leche condensada',    'Salsas',           'kg', 0, 0, 0, 'Producción propia', false),
  ('I60', 'Base crocante sin horno',   'Bases crocantes',  'kg', 0, 0, 0, 'Producción propia', false)
on conflict (id) do nothing;

-- counter invitem: última fila sembrada es I60 → deja el counter en 60.
insert into counters (clave, valor) values ('invitem', 60)
on conflict (clave) do update set valor = greatest(counters.valor, 60);

-- ---------------------------------------------------------------------------
-- D.4) subrecetas — 20 filas (11 mousse + cheesecake + ganache + 6 salsa +
-- crocante). merma_pct default por tipo (spec): frutal 8, cremosa 6,
-- cheesecake 5, ganache 4, salsa 5, crocante 5. item_id reusa I02/I03/I05
-- para maracuyá/frutos-rojos/ganache; el resto usa los items nuevos de D.3.
-- ---------------------------------------------------------------------------
insert into subrecetas (id, nombre, tipo, sabor, merma_pct, rinde_g, item_id, activo) values
  ('SR01', 'Mousse mango biche',    'mousse_frutal',  'Mango biche',      8, 1000, 'I44', true),
  ('SR02', 'Mousse coco',           'mousse_frutal',  'Coco',             8, 1000, 'I45', true),
  ('SR03', 'Mousse maracuyá',       'mousse_frutal',  'Maracuyá',         8, 1000, 'I02', true),
  ('SR04', 'Mousse limón',          'mousse_frutal',  'Limón',            8, 1000, 'I46', true),
  ('SR05', 'Mousse banano',         'mousse_frutal',  'Banano',           8, 1000, 'I47', true),
  ('SR06', 'Mousse durazno',        'mousse_frutal',  'Durazno',          8, 1000, 'I48', true),
  ('SR07', 'Mousse Oreo',           'mousse_cremosa', 'Oreo',             6, 1000, 'I49', true),
  ('SR08', 'Mousse Nutella',        'mousse_cremosa', 'Nutella',          6, 1000, 'I50', true),
  ('SR09', 'Mousse M&M',            'mousse_cremosa', 'M&M',              6, 1000, 'I51', true),
  ('SR10', 'Mousse Milo',           'mousse_cremosa', 'Milo',             6, 1000, 'I52', true),
  ('SR11', 'Mousse caramelo salado','mousse_cremosa', 'Caramelo salado',  6, 1000, 'I53', true),
  ('SR12', 'Relleno cheesecake',    'cheesecake',      null,              5, 1000, 'I54', true),
  ('SR13', 'Ganache de chocolate',  'ganache',         null,              4, 1000, 'I05', true),
  ('SR14', 'Salsa caramelo salado', 'salsa',           'Caramelo salado', 5, 1000, 'I55', true),
  ('SR15', 'Salsa maracuyá',        'salsa',           'Maracuyá',        5, 1000, 'I56', true),
  ('SR16', 'Salsa frutos rojos',    'salsa',           'Frutos rojos',    5, 1000, 'I03', true),
  ('SR17', 'Salsa manzana verde',   'salsa',           'Manzana verde',   5, 1000, 'I57', true),
  ('SR18', 'Salsa arequipe',        'salsa',           'Arequipe',        5, 1000, 'I58', true),
  ('SR19', 'Salsa leche condensada','salsa',           'Leche condensada',5, 1000, 'I59', true),
  ('SR20', 'Base crocante sin horno','crocante',       null,              5, 1000, 'I60', true)
on conflict (id) do nothing;

insert into counters (clave, valor) values ('subreceta', 20)
on conflict (clave) do update set valor = greatest(counters.valor, 20);

-- ---------------------------------------------------------------------------
-- D.5) subreceta_ingredientes — receta exacta de RECETAS.md por 1000 g,
-- convertida a la unidad de cada insumo (kg/L: gramos/1000; g: tal cual —
-- no aplica acá, todos los insumos de este seed son kg o L). Densidad ≈ 1
-- para líquidos/lácteos (documentado en la cabecera del archivo).
-- Cada bloque suma ~1000 g en origen (verificado; redondeos de RECETAS.md
-- dejan algunas sumas en 999.8-1000.1, dentro de tolerancia del propio doc).
-- ---------------------------------------------------------------------------

-- SR01 Mousse mango biche
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR01','I07', 0.4803),  -- Pulpa mango biche (kg)
  ('SR01','I01', 0.3095),  -- Crema de leche (L)
  ('SR01','I20', 0.0534),  -- Agua (L)
  ('SR01','I15', 0.0160),  -- Grenetina (kg)
  ('SR01','I16', 0.0075),  -- Sal (kg)
  ('SR01','I17', 0.0534),  -- Leche en polvo (kg)
  ('SR01','I18', 0.0747),  -- Azúcar (kg)
  ('SR01','I19', 0.0053)   -- Zumo de limón (L)
on conflict (subreceta_id, item_id) do nothing;

-- SR02 Mousse coco
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR02','I21', 0.3297),  -- Leche de coco (L)
  ('SR02','I22', 0.1648),  -- Ralladura de coco (kg)
  ('SR02','I01', 0.2747),  -- Crema de leche (L)
  ('SR02','I20', 0.0824),  -- Agua (L)
  ('SR02','I15', 0.0165),  -- Grenetina (kg)
  ('SR02','I16', 0.0055),  -- Sal (kg)
  ('SR02','I17', 0.0549),  -- Leche en polvo (kg)
  ('SR02','I18', 0.0549),  -- Azúcar (kg)
  ('SR02','I19', 0.0165)   -- Zumo de limón (L)
on conflict (subreceta_id, item_id) do nothing;

-- SR03 Mousse maracuyá (item_id = I02, reuso)
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR03','I23', 0.4972),  -- Pulpa de maracuyá (kg)
  ('SR03','I01', 0.2762),  -- Crema de leche (L)
  ('SR03','I20', 0.0829),  -- Agua (L)
  ('SR03','I15', 0.0166),  -- Grenetina (kg)
  ('SR03','I16', 0.0055),  -- Sal (kg)
  ('SR03','I17', 0.0552),  -- Leche en polvo (kg)
  ('SR03','I18', 0.0663)   -- Azúcar (kg)
on conflict (subreceta_id, item_id) do nothing;

-- SR04 Mousse limón (jugo/pulpa de limón unificado con Zumo de limón, I19 — ver nota de huecos)
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR04','I19', 0.4762),  -- Jugo/pulpa de limón (L) — base, cantidad grande
  ('SR04','I01', 0.2646),  -- Crema de leche (L)
  ('SR04','I20', 0.0794),  -- Agua (L)
  ('SR04','I15', 0.0159),  -- Grenetina (kg)
  ('SR04','I16', 0.0053),  -- Sal (kg)
  ('SR04','I17', 0.0529),  -- Leche en polvo (kg)
  ('SR04','I18', 0.1058)   -- Azúcar (kg)
on conflict (subreceta_id, item_id) do nothing;

-- SR05 Mousse banano
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR05','I24', 0.5000),  -- Banano (kg)
  ('SR05','I01', 0.2778),  -- Crema de leche (L)
  ('SR05','I20', 0.0833),  -- Agua (L)
  ('SR05','I15', 0.0167),  -- Grenetina (kg)
  ('SR05','I16', 0.0056),  -- Sal (kg)
  ('SR05','I17', 0.0556),  -- Leche en polvo (kg)
  ('SR05','I18', 0.0444),  -- Azúcar (kg)
  ('SR05','I19', 0.0167)   -- Zumo de limón (L)
on conflict (subreceta_id, item_id) do nothing;

-- SR06 Mousse durazno
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR06','I25', 0.5028),  -- Pulpa de durazno escurrido (kg)
  ('SR06','I01', 0.2793),  -- Crema de leche (L)
  ('SR06','I20', 0.0838),  -- Agua (L)
  ('SR06','I15', 0.0168),  -- Grenetina (kg)
  ('SR06','I16', 0.0056),  -- Sal (kg)
  ('SR06','I17', 0.0559),  -- Leche en polvo (kg)
  ('SR06','I18', 0.0447),  -- Azúcar (kg)
  ('SR06','I19', 0.0112)   -- Zumo de limón (L)
on conflict (subreceta_id, item_id) do nothing;

-- SR07 Mousse Oreo
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR07','I01', 0.4037),  -- Crema de leche (L)
  ('SR07','I26', 0.2174),  -- Leche evaporada (L)
  ('SR07','I20', 0.0621),  -- Agua (L)
  ('SR07','I15', 0.0186),  -- Grenetina (kg)
  ('SR07','I16', 0.0062),  -- Sal (kg)
  ('SR07','I17', 0.0745),  -- Leche en polvo (kg)
  ('SR07','I27', 0.1366),  -- Galleta Oreo sin crema (kg)
  ('SR07','I28', 0.0745),  -- Crema tipo Oreo (kg)
  ('SR07','I29', 0.0062)   -- Vainilla líquida (L)
on conflict (subreceta_id, item_id) do nothing;

-- SR08 Mousse Nutella
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR08','I01', 0.3854),  -- Crema de leche (L)
  ('SR08','I26', 0.2326),  -- Leche evaporada (L)
  ('SR08','I20', 0.0664),  -- Agua (L)
  ('SR08','I15', 0.0199),  -- Grenetina (kg)
  ('SR08','I16', 0.0066),  -- Sal (kg)
  ('SR08','I17', 0.0532),  -- Leche en polvo (kg)
  ('SR08','I04', 0.1860),  -- Nutella (kg) — reusa I04
  ('SR08','I30', 0.0199),  -- Cacao en polvo (kg)
  ('SR08','I29', 0.0033),  -- Vainilla líquida (L)
  ('SR08','I31', 0.0266)   -- Avellana triturada (kg)
on conflict (subreceta_id, item_id) do nothing;

-- SR09 Mousse M&M
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR09','I01', 0.4040),  -- Crema de leche (L)
  ('SR09','I26', 0.2559),  -- Leche evaporada (L)
  ('SR09','I20', 0.0673),  -- Agua (L)
  ('SR09','I15', 0.0202),  -- Grenetina (kg)
  ('SR09','I16', 0.0067),  -- Sal (kg)
  ('SR09','I17', 0.0673),  -- Leche en polvo (kg)
  ('SR09','I18', 0.0337),  -- Azúcar (kg)
  ('SR09','I30', 0.0202),  -- Cacao en polvo (kg)
  ('SR09','I29', 0.0034),  -- Vainilla líquida (L)
  ('SR09','I32', 0.1212)   -- M&M / mini M&M (kg)
on conflict (subreceta_id, item_id) do nothing;

-- SR10 Mousse Milo
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR10','I01', 0.4040),  -- Crema de leche (L)
  ('SR10','I26', 0.2694),  -- Leche evaporada (L)
  ('SR10','I20', 0.0673),  -- Agua (L)
  ('SR10','I15', 0.0202),  -- Grenetina (kg)
  ('SR10','I16', 0.0067),  -- Sal (kg)
  ('SR10','I17', 0.0673),  -- Leche en polvo (kg)
  ('SR10','I33', 0.1481),  -- Milo (kg)
  ('SR10','I30', 0.0135),  -- Cacao en polvo (kg)
  ('SR10','I29', 0.0034)   -- Vainilla líquida (L)
on conflict (subreceta_id, item_id) do nothing;

-- SR11 Mousse caramelo salado
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR11','I01', 0.4285),  -- Crema de leche (L)
  ('SR11','I26', 0.1648),  -- Leche evaporada (L)
  ('SR11','I20', 0.0659),  -- Agua (L)
  ('SR11','I15', 0.0198),  -- Grenetina (kg)
  ('SR11','I16', 0.0079),  -- Sal (kg)
  ('SR11','I17', 0.0791),  -- Leche en polvo (kg)
  ('SR11','I34', 0.2307),  -- Caramelo salado — insumo (kg)
  ('SR11','I29', 0.0033)   -- Vainilla líquida (L)
on conflict (subreceta_id, item_id) do nothing;

-- SR12 Relleno cheesecake
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR12','I35', 0.4065),  -- Queso crema (kg)
  ('SR12','I01', 0.2927),  -- Crema de leche (L)
  ('SR12','I36', 0.1951),  -- Leche condensada (kg)
  ('SR12','I19', 0.0325),  -- Zumo de limón (L)
  ('SR12','I29', 0.0033),  -- Vainilla líquida (L)
  ('SR12','I15', 0.0114),  -- Grenetina (kg)
  ('SR12','I20', 0.0569),  -- Agua para hidratar grenetina (L)
  ('SR12','I16', 0.0016)   -- Sal (kg)
on conflict (subreceta_id, item_id) do nothing;

-- SR13 Ganache de chocolate (item_id = I05, reuso)
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR13','I37', 0.5500),  -- Chocolate semiamargo/con leche (kg)
  ('SR13','I01', 0.4300),  -- Crema de leche caliente (L)
  ('SR13','I38', 0.0180),  -- Mantequilla (kg)
  ('SR13','I16', 0.0020)   -- Sal (kg)
on conflict (subreceta_id, item_id) do nothing;

-- SR14 Salsa caramelo salado
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR14','I18', 0.5076),  -- Azúcar (kg)
  ('SR14','I01', 0.3553),  -- Crema de leche caliente (L)
  ('SR14','I38', 0.1269),  -- Mantequilla (kg)
  ('SR14','I16', 0.0102)   -- Sal (kg)
on conflict (subreceta_id, item_id) do nothing;

-- SR15 Salsa maracuyá
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR15','I23', 0.6000),  -- Pulpa de maracuyá (kg)
  ('SR15','I18', 0.3000),  -- Azúcar (kg)
  ('SR15','I20', 0.0900),  -- Agua (L)
  ('SR15','I19', 0.0050),  -- Zumo de limón (L)
  ('SR15','I16', 0.0050)   -- Sal (kg)
on conflict (subreceta_id, item_id) do nothing;

-- SR16 Salsa frutos rojos (item_id = I03, reuso)
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR16','I39', 0.6500),  -- Frutos rojos/fresa/mora (kg)
  ('SR16','I18', 0.2700),  -- Azúcar (kg)
  ('SR16','I20', 0.0600),  -- Agua (L)
  ('SR16','I19', 0.0150),  -- Zumo de limón (L)
  ('SR16','I16', 0.0050)   -- Sal (kg)
on conflict (subreceta_id, item_id) do nothing;

-- SR17 Salsa manzana verde
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR17','I40', 0.6234),  -- Manzana verde (kg)
  ('SR17','I20', 0.1995),  -- Agua (L)
  ('SR17','I18', 0.1372),  -- Azúcar (kg)
  ('SR17','I19', 0.0374),  -- Zumo de limón (L)
  ('SR17','I16', 0.0012),  -- Sal (kg)
  ('SR17','I41', 0.0012)   -- Esencia de manzana verde (L)
on conflict (subreceta_id, item_id) do nothing;

-- SR18 Salsa arequipe (usa Leche evaporada — ver nota de huecos)
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR18','I42', 0.8050),  -- Arequipe repostero (kg)
  ('SR18','I26', 0.1900),  -- Leche evaporada (L)
  ('SR18','I16', 0.0040),  -- Sal (kg)
  ('SR18','I29', 0.0010)   -- Vainilla líquida (L)
on conflict (subreceta_id, item_id) do nothing;

-- SR19 Salsa leche condensada (usa Leche evaporada — ver nota de huecos)
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR19','I36', 0.8500),  -- Leche condensada (kg)
  ('SR19','I26', 0.1480),  -- Leche evaporada (L)
  ('SR19','I16', 0.0020)   -- Sal (kg)
on conflict (subreceta_id, item_id) do nothing;

-- SR20 Base crocante sin horno
insert into subreceta_ingredientes (subreceta_id, item_id, cantidad) values
  ('SR20','I43', 0.6800),  -- Galleta triturada (kg)
  ('SR20','I38', 0.3000),  -- Mantequilla derretida (kg)
  ('SR20','I16', 0.0030),  -- Sal (kg)
  ('SR20','I18', 0.0170)   -- Azúcar, opcional (kg)
on conflict (subreceta_id, item_id) do nothing;

-- ---------------------------------------------------------------------------
-- D.6) figura_relleno — cheesecake 20 g + ganache 15 g (spec del usuario:
-- editable, NUNCA hardcodeado en la RPC).
-- ---------------------------------------------------------------------------
insert into figura_relleno (id, subreceta_id, gramos_por_unidad, activo) values
  ('FR01', 'SR12', 20, true),  -- Relleno cheesecake
  ('FR02', 'SR13', 15, true)   -- Ganache
on conflict (id) do nothing;

insert into counters (clave, valor) values ('figrelleno', 2)
on conflict (clave) do update set valor = greatest(counters.valor, 2);

COMMIT;

-- ============================================================================
-- Notas de migración / huecos para revisión (ver también mem_save en engram,
-- topic momos/subrecetas-bom-implementacion):
--
-- 1. "Zumo de limón" (I19) unifica el acidulante chico de varias recetas con
--    el "jugo/pulpa de limón" que es la BASE de la mousse de limón (476.2 g).
--    RECETAS.md los nombra de forma intercambiable pero en cocina real podrían
--    ser productos distintos (jugo colado vs pulpa con pulpa) — REVISAR con
--    Julián si conviene separar en dos insumos.
-- 2. "Leche evaporada o leche entera" (Oreo, Nutella, M&M, Milo, caramelo
--    salado, arequipe, leche condensada) se unificó en UN insumo "Leche
--    evaporada" (I26). Costo/densidad real difieren entre evaporada y entera
--    — decisión de simplificación, no de receta: REVISAR.
-- 3. Ingredientes "opcionales" fuera de la tabla de 1000 g (pimienta blanca
--    en mango biche, "1 g por kilo") NO se sembraron como ingrediente de la
--    subreceta — solo se incluyeron los opcionales que SÍ están dentro de la
--    tabla de 1000 g del propio documento (avellana triturada en Nutella,
--    esencia de manzana verde, azúcar en crocante). Criterio del autor de
--    esta migración, no instrucción explícita — REVISAR.
-- 4. "Caramelo salado" aparece DOS veces con roles distintos: como INSUMO
--    dentro de la mousse cremosa Caramelo salado (I34, 230.7 g/kg — algo que
--    Cocina prepara o compra aparte) y como SUBRECETA completa "Salsa de
--    caramelo salado" (SR14/I55). Son insumos/items DISTINTOS a propósito —
--    este slice NO modela BOM de 2 niveles (subreceta-de-subreceta): si en la
--    práctica el "caramelo salado" que entra en la mousse ES la misma salsa
--    SR14, hay que decidir si conviene enlazarlos (fuera de scope v1).
--    ⚠️ SI SE IMPLEMENTA a futuro: ojo con el orden de locks — producir_subreceta
--    bloquea sus insumos crudos ANTES que el item final de la subreceta;
--    crear_corrida bloquea el item final de la mousse/relleno directo, sin
--    pasar por sus insumos crudos. Hoy no hay ciclo posible porque los sets de
--    items no se solapan (insumos I01-I43 vs. bases I02/I03/I05/I44-I60); un
--    BOM de 2 niveles rompería esa separación y podría deadlockear dos
--    transacciones concurrentes que bloquean el mismo par en orden inverso.
-- 5. Todos los costos de insumos atómicos nuevos (I15-I43) son ESTIMADOS de
--    mercado mayorista Cali 2026, marcados con costo_estimado=true. Ninguno
--    tiene compra real todavía — la primera entrada_insumo real corrige el
--    WAC. Ver lista completa en el bloque D.2 de este archivo.
-- 6. RECETAS.md no trae receta para: frappé/granizado Crazy Rush, macerado de
--    fruta, base de yogurt griego (Yogurt Bites), baño de chocolate, relleno
--    de sándwich caliente sellado (§7 del propio documento, "Recetas
--    auxiliares que FALTAN") — fuera de scope de este slice, no se sembró nada.
-- ============================================================================
