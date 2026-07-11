-- ============================================================================
-- MOMOS OPS — Gancho MULTI-SEDE v1 (2026-07-10)
-- Regla del usuario: "No construir hoy toda la operación de las islas, pero sí
-- evitar que el sistema quede amarrado a una sola cocina."
-- Modelo: Caney produce; las islas venden, almacenan, entregan y amplían cobertura.
--
-- Este archivo es SOLO DDL + defaults: cero cambios en RPCs y cero en el front.
-- Todo registro nuevo cae automáticamente en la sede única (SEDE-01). Cuando
-- exista la 2ª sede, el default pasa a ser parámetro de las RPCs.
--
-- Lo que NO hace a propósito (etapa isla, ver BACKLOG "🔭 Multi-sede"):
--   - NO parte products.stock por sede (hoy se re-interpreta: stock = stock en
--     la sede única; la partición a product_stock(product_id, sede_id) es
--     migración mecánica cuando llegue la isla).
--   - NO crea RPCs/UI de transferencias/turnos (sin 2ª sede son código muerto);
--     acá solo se CONGELA el contrato (tablas + estados).
-- ============================================================================

-- ============================================================================
-- 1) Tabla sedes + seed de la única sede actual
-- ============================================================================

create table if not exists sedes (
  id                 text primary key,                -- SEDE-01
  nombre             text not null,
  tipo               text not null check (tipo in ('cocina','isla','local','bodega')),
  direccion          text default '',
  lat                numeric,
  lng                numeric,
  radio_cobertura_km numeric,
  activa             boolean not null default true,
  -- horarios, capacidad (pedidos/hora, congelación, empaque, mensajeros,
  -- horarios de corte), canales activos, límites: motor CONFIGURABLE,
  -- jamás hardcodeado (regla del usuario, misma que embajadores v2).
  config             jsonb not null default '{}'::jsonb
);

insert into sedes (id, nombre, tipo, direccion) values
  ('SEDE-01', 'Cocina Central Caney', 'cocina', 'El Caney, Cali')
on conflict (id) do nothing;

-- ============================================================================
-- 2) Turnos (esqueleto — la caja básica es etapa isla; el contrato queda ya)
-- ============================================================================

create table if not exists turnos (
  id         text primary key,                        -- T-1
  sede_id    text not null references sedes(id),
  user_id    text references users(id),
  abierto_en timestamptz not null default now(),
  cerrado_en timestamptz,
  estado     text not null default 'Abierto' check (estado in ('Abierto','Cerrado')),
  obs        text default ''
);

-- ============================================================================
-- 3) Sede en cada registro operativo (default = la única sede)
-- ============================================================================

-- Pedido: sede que registra la venta, sede que PRODUCE, sede que DESPACHA
-- (el análisis lo separa a propósito: "Caney puede producir y la isla despachar"),
-- sede de recogida (null = domicilio) y turno de caja (null hasta que exista caja).
alter table orders add column if not exists sede_id          text not null default 'SEDE-01' references sedes(id);
alter table orders add column if not exists prep_sede_id     text not null default 'SEDE-01' references sedes(id);
alter table orders add column if not exists despacho_sede_id text not null default 'SEDE-01' references sedes(id);
alter table orders add column if not exists pickup_sede_id   text references sedes(id);
alter table orders add column if not exists turno_id         text references turnos(id);

-- Inventario: DÓNDE vive el stock/movimiento (inventory_location_id del análisis).
alter table inventory_items     add column if not exists sede_id text not null default 'SEDE-01' references sedes(id);
alter table inventory_movements add column if not exists sede_id text not null default 'SEDE-01' references sedes(id);

-- Producción: dónde se produjo el lote (trazabilidad multi-punto).
alter table production_batches  add column if not exists sede_id text not null default 'SEDE-01' references sedes(id);

-- Despacho: nodo base del mensajero / desde dónde sale la entrega.
alter table deliveries          add column if not exists sede_id text not null default 'SEDE-01' references sedes(id);

-- Personal por sede.
alter table users               add column if not exists sede_id text not null default 'SEDE-01' references sedes(id);

-- Reclamos: desde qué sede salió lo reclamado (calidad/trazabilidad por punto).
alter table claims              add column if not exists sede_id text not null default 'SEDE-01' references sedes(id);

-- Cobertura: qué nodo atiende cada zona (la asignación futura pondera además
-- tráfico/capacidad/inventario — eso es motor de etapa isla, no columna).
alter table zonas               add column if not exists sede_id text not null default 'SEDE-01' references sedes(id);

-- ============================================================================
-- 4) Transferencias entre sedes — CONTRATO congelado (sin RPCs/UI todavía)
-- ============================================================================

create table if not exists transferencias (
  id              text primary key,                   -- TR-1
  origen_sede_id  text not null references sedes(id),
  destino_sede_id text not null references sedes(id),
  fecha           date not null,
  estado          text not null default 'Creada' check (estado in
    ('Creada','Preparada','Despachada','En tránsito','Recibida','Recibida con diferencia','Anulada')),
  creada_por      text references users(id),
  recibida_por    text references users(id),
  despachada_en   timestamptz,
  recibida_en     timestamptz,
  obs             text default '',
  constraint transf_sedes_distintas check (origen_sede_id <> destino_sede_id)
);

create table if not exists transferencia_items (
  id               text primary key,                  -- TRI-1
  transferencia_id text not null references transferencias(id),
  product_id       text references products(id),      -- producto terminado…
  item_id          text references inventory_items(id), -- …o insumo/empaque
  cant_enviada     numeric not null check (cant_enviada > 0),
  cant_recibida    numeric,                           -- null hasta recibir; ≠ enviada => "Recibida con diferencia"
  batch_id         text references production_batches(id), -- trazabilidad: de qué lote salió
  constraint transf_item_ref_exclusiva check (
    (product_id is not null and item_id is null) or
    (item_id is not null and product_id is null))
);

-- ============================================================================
-- 5) Counters para las entidades nuevas
-- ============================================================================

insert into counters (clave, valor) values
  ('turno', 0), ('transferencia', 0), ('transf_item', 0)
on conflict (clave) do nothing;

-- ============================================================================
-- 6) RLS — mismo patrón del schema: deny-by-default + admin_all + staff_read.
--    Los WRITES de staff van por RPCs security definer cuando existan los
--    flujos (etapa isla); mientras tanto solo el Administrador escribe directo.
-- ============================================================================

alter table sedes                enable row level security;
alter table turnos               enable row level security;
alter table transferencias      enable row level security;
alter table transferencia_items enable row level security;

drop policy if exists admin_all on sedes;
create policy admin_all on sedes for all
  using (current_rol() = 'Administrador') with check (current_rol() = 'Administrador');
drop policy if exists staff_read on sedes;
create policy staff_read on sedes for select using (is_staff());

drop policy if exists admin_all on turnos;
create policy admin_all on turnos for all
  using (current_rol() = 'Administrador') with check (current_rol() = 'Administrador');
drop policy if exists staff_read on turnos;
create policy staff_read on turnos for select using (is_staff());

drop policy if exists admin_all on transferencias;
create policy admin_all on transferencias for all
  using (current_rol() = 'Administrador') with check (current_rol() = 'Administrador');
drop policy if exists staff_read on transferencias;
create policy staff_read on transferencias for select using (is_staff());

drop policy if exists admin_all on transferencia_items;
create policy admin_all on transferencia_items for all
  using (current_rol() = 'Administrador') with check (current_rol() = 'Administrador');
drop policy if exists staff_read on transferencia_items;
create policy staff_read on transferencia_items for select using (is_staff());
