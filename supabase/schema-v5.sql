-- ============================================================================
-- MOMOS OPS — Esquema Supabase v5 (BORRADOR de Fase 1)
-- Derivado del shape REAL de localStorage `momos-db-v2` (DB_VERSION 16),
-- extraído de src/MomosOps.jsx (seedDb + normalizeDbShape + shapes runtime).
-- SUPERA al SQL v4 del usuario (anterior a: especie, figuras-objeto, toppings,
-- adiciones con insumoCosto, order_items padre+hijas, atributos derivados).
--
-- Decisiones de diseño (ver DISEÑO-TRAFICKER.md §2 y §5):
--  * PKs = códigos de texto actuales (P-1041, PR01, IT10…) generados por
--    next_id() sobre `counters`. Preserva recibos/UI/migración. ✅ DECIDIDO
--    2026-07-10 (usuario): texto legible. El único beneficio real de uuid
--    (no exponer secuencias en URLs públicas) se captura aparte: cuando llegue
--    Pide MOMOS, el link público de pedido usa un TOKEN OPACO, jamás la PK.
--  * COGS congelado: costo_unitario e insumo_costo son snapshots — NUNCA se
--    recalculan desde el catálogo.
--  * `products.atributos` NO se persiste (100% derivado del tipo → función).
--  * Normalizaciones vs maqueta: movimientos con item_id FK y cant NUMERIC
--    (era string "-1.5 kg"); lotes/evidencias/audit con FKs (era nombre);
--    fechas date/timestamptz (era string Bogotá — convertir en migración).
--  * Fotos → Supabase Storage (bucket `evidencias`); acá va storage_path.
--  * REGLA (usuario 2026-07-10): toda unidad de medida es LISTA CERRADA o
--    columna numérica tipada — NUNCA texto libre (evita errores de digitación:
--    "kg"/"Kg"/"kilo", "150 g"/"150gr"). Unidades = enum del form (línea 3072);
--    gramajes = INTEGER en gramos; duraciones = INTEGER en segundos.
--  * REGLA AMPLIADA (usuario 2026-07-10): TODO dominio finito va CERRADO —
--    CHECK para enums estables, FK a tabla catálogo para listas editables.
--    Texto libre queda SOLO para notas/observaciones/descripciones y para
--    SNAPSHOTS históricos (sabor/salsa/figura en order_items y lotes): copias
--    congeladas a propósito, no deben romperse si el catálogo cambia.
-- ============================================================================

-- ---------- Contadores e IDs legibles ----------
create table counters (
  clave text primary key,          -- 'order','customer','product',…
  valor integer not null default 0
);

create or replace function next_id(p_clave text, p_prefix text, p_pad int default 0)
returns text language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into counters(clave, valor) values (p_clave, 1)
    on conflict (clave) do update set valor = counters.valor + 1
    returning valor into n;
  return p_prefix || case when p_pad > 0 then lpad(n::text, p_pad, '0') else n::text end;
end $$;

-- ---------- Usuarios y roles ----------
create table users (
  id       text primary key,                      -- U01
  auth_id  uuid unique references auth.users(id), -- NUEVO: no existía en la maqueta
  nombre   text not null,
  email    text unique not null,
  rol      text not null check (rol in ('Administrador','Cocina','Empaque','Logística','Marketing/CRM','Mensajero')),
  -- 'Mensajero' (gancho ORQUESTACIÓN): identidad para deliveries.mensajero_user_id.
  -- OJO: NO crearles auth_id hasta la vista del mensajero (Fase 3) — staff_read hoy lee TODO.
  activo   boolean not null default true
);

-- Rol del usuario autenticado (para políticas RLS)
create or replace function current_rol() returns text language sql stable security definer set search_path = public as
  $$ select rol from users where auth_id = auth.uid() and activo $$;

-- ---------- Catálogos y configuración ----------
create table figuras (
  nombre  text primary key,                        -- Lizi, Momo, Toby, Teo, Max, Rocco, Danna
  especie text not null check (especie in ('gato','perro')),
  gramaje_g integer not null default 150 check (gramaje_g > 0),  -- era text "150 g" (la UI formatea)
  activo  boolean not null default true
  -- product_id (Producción v2): FK a products, agregada más abajo vía ALTER
  -- TABLE porque products todavía no existe en este punto del archivo —
  -- ver sección "Producción" (alter table figuras add column product_id).
);

create table zonas (
  nombre text primary key,                         -- 'Zona 1 · El Caney'
  tarifa numeric not null default 0
);

-- Franjas de entrega (gancho ORQUESTACIÓN, BACKLOG roadmap #11: capacidad por
-- franja + despacho agrupado). Lista editable → tabla, por la regla del usuario.
create table franjas (
  nombre      text primary key,                    -- '3-5 pm'
  hora_inicio time,
  hora_fin    time,
  cupo        integer,                             -- pedidos que caben (NULL = sin límite aún)
  activo      boolean not null default true
);

-- Catálogos cerrados con FK (listas editables → tabla, nunca texto libre)
create table inventory_cats        ( nombre text primary key, activo boolean not null default true );  -- Ingredientes, Cajas, Vasos, …
create table product_cats          ( nombre text primary key, activo boolean not null default true );  -- Momos Signature, Cajas y Combos, …
create table proveedores_domicilio ( nombre text primary key, activo boolean not null default true );  -- Picap, Pibox, Mensajeros Urbanos, Propio, Rappi
-- capacidad (gancho ORQUESTACIÓN): denominador del dashboard de capacidad (% usado)
create table moldes               ( nombre text primary key, capacidad integer, activo boolean not null default true );  -- gancho Fase 2: calidad por molde; capacidad = unidades por tanda
create table ubicaciones_frio    ( nombre text primary key, capacidad integer, activo boolean not null default true );  -- gancho Fase 2: congelador/ubicación; capacidad = momos que caben

-- Listas simples editables (sabores, salsas, pagos, proveedores, orígenes)
create table catalog_values (
  categoria text not null check (categoria in
    ('sabor_frutal','sabor_cremoso','salsa','pago')),  -- proveedor/origen migraron a tabla propia y CHECK
  valor  text not null,
  orden  integer not null default 0,
  activo boolean not null default true,
  primary key (categoria, valor)
);

-- Config escalar (pedido_minimo, pauta_mensual, horas_congelacion, politicas,
-- relleno_fijo='Cheesecake con ganache', piso_volumen_semanal — §4 del diseño)
create table app_settings (
  clave text primary key,
  valor jsonb not null
);

-- ---------- Inventario ----------
create table inventory_items (
  id        text primary key,                      -- I01
  nombre    text not null,
  cat       text not null references inventory_cats(nombre),  -- CERRADO (los combos filtran empaque por 'Cajas')
  unidad    text not null check (unidad in ('und','kg','g','L','ml','paquete','docena')),  -- enum REAL del form (MomosOps.jsx:3072)
  stock     numeric not null default 0,
  minimo    numeric not null default 0,            -- era `min` (palabra reservada fea en SQL)
  costo     numeric not null default 0,            -- unitario WAC, en `unidad`
  proveedor text default '',
  vence     date,
  ubicacion text default '',
  compra    date                                   -- última compra
);

-- Toppings / adiciones — catálogo (era settings.toppings; regla del usuario:
-- lista editable → tabla con FK, nunca jsonb suelto). Va acá y no con los otros
-- catálogos porque su FK necesita inventory_items ya creada.
create table toppings (
  nombre      text primary key,                    -- Oreo, M&M, Milo, …
  precio      numeric not null default 0,          -- por momo (0 = gratis)
  insumo_id   text references inventory_items(id), -- opcional: liga descuento de inventario
  insumo_cant numeric not null default 0,          -- consumo por momo, en unidad del insumo
  activo      boolean not null default true
);
-- OJO: order_item_adiciones.nombre sigue siendo SNAPSHOT (texto sin FK) a propósito.

create table inventory_movements (
  id       text primary key,                       -- M07
  fecha    timestamptz not null default now(),
  tipo     text not null check (tipo in ('Entrada','Salida','Uso en producción','Merma','Ajuste')),
  item_id  text not null references inventory_items(id),  -- NORMALIZADO (era nombre)
  cant     numeric not null,                       -- firmado, en unidad del insumo (era string "-1.5 kg")
  nota     text default '',
  order_id text,                                   -- FK se agrega tras crear orders
  batch_id text
);

-- ---------- Productos ----------
create table products (
  id           text primary key,                   -- PR01
  nombre       text not null,
  cat          text not null references product_cats(nombre),  -- CERRADO (era texto libre)
  tipo         text not null check (tipo in ('momo','combo','pedido')),
  especie      text check (especie in ('gato','perro')),  -- solo tipo momo
  precio       numeric not null,
  precio_rappi numeric,                            -- fallback app: precio × 1.25
  costo        numeric not null default 0,
  stock        numeric,                            -- solo momo (combo calcula, pedido no tiene)
  prep         integer not null default 0,         -- minutos
  frio         boolean not null default true,
  lejano       boolean not null default false,
  activo       boolean not null default true,      -- soft-delete only
  descr        text default '',
  foto_path    text,                               -- gancho Fase 1/shop: foto de producto en Storage (menú al cliente)
  alergenos    text default '',                    -- gancho Pide MOMOS: catálogo público
  -- solo tipo combo:
  combo_size      integer,
  empaque_item_id text references inventory_items(id),
  constraint momo_tiene_especie check (tipo <> 'momo' or especie is not null),
  constraint combo_completo check (tipo <> 'combo' or (combo_size > 0 and empaque_item_id is not null))
);

-- atributos NO se persiste — derivado (paridad con atributosDeTipo del front)
create or replace function atributos_de_tipo(p_tipo text) returns text[] language sql immutable as $$
  select case p_tipo when 'momo' then array['sabor','salsa','figura']
                     when 'combo' then array['sabor','salsa'] else array[]::text[] end $$;

create table combo_components (                    -- era products.componentProductIds[]
  combo_id     text not null references products(id),
  component_id text not null references products(id),
  primary key (combo_id, component_id)
);

create table recipes (
  id         text primary key,                     -- RC01
  product_id text not null references products(id),
  item_id    text not null references inventory_items(id),
  cantidad   numeric not null                      -- consumo por 1 unidad de producto
);

-- ---------- Clientes ----------
create table customers (
  id        text primary key,                      -- C01
  nombre    text not null,
  telefono  text default '',
  instagram text default '',
  barrio    text default '',
  direccion text default '',
  canal     text check (canal in ('WhatsApp','Instagram','Rappi','Directo')),
  primera   date,
  ultima    date,
  total     numeric not null default 0,            -- derivados: los actualiza RPC post-entrega
  pedidos   integer not null default 0,
  cumple    text default '' check (cumple = '' or cumple ~ '^\d{2}-\d{2}$'),  -- 'MM-DD'
  favoritos text default '',
  estado    text not null default 'Nuevo' check (estado in
    ('Nuevo','Recurrente','VIP','Riesgo por reclamos','Inactivo')),
  notas     text default '',
  referido_por text references customers(id),      -- gancho Fase 2: cohorte de referidos
  auth_id   uuid unique references auth.users(id)  -- gancho "Pide MOMOS": login del cliente en el shop público
);

-- ---------- Marketing (detalle en DISEÑO-TRAFICKER.md §2) ----------
create table campaigns (
  id                text primary key,              -- CMP-01
  nombre            text not null,
  canal             text not null check (canal in
    ('Instagram','Facebook','TikTok','WhatsApp','Rappi','Referidos','Influencer','Orgánico')),  -- MK_CANALES
  objetivo          text not null check (objetivo in
    ('Ventas','Recompra','Lanzamiento','Cumpleaños','Tráfico WhatsApp','Branding')),            -- MK_OBJETIVOS
  producto_foco_id  text references products(id),  -- era NOMBRE en la maqueta
  oferta            text default '',
  fecha_inicio      date,
  fecha_fin         date,
  presupuesto       numeric not null default 0,
  -- gastoReal DESAPARECE: se deriva de metrics_daily
  estado            text not null default 'Planeada' check (estado in ('Planeada','Activa','Pausada','Finalizada')),
  responsable       text default '',
  notas             text default '',
  external_platform text,                          -- 'meta' | 'tiktok'
  external_id       text                           -- id de campaña en la plataforma (join MCP)
);

create table creatives (
  id               text primary key,               -- CRE-01
  campaign_id      text references campaigns(id),
  titulo           text not null,
  canal            text not null check (canal in
    ('Instagram','Facebook','TikTok','WhatsApp','Rappi','Referidos','Influencer','Orgánico')),
  formato          text not null check (formato in
    ('Reel','Historia','Carrusel','Foto producto','Video UGC','Anuncio','Guion','Copy','Diseño empaque')),  -- MK_FORMATOS
  producto_foco_id text references products(id),
  figura           text references figuras(nombre), -- CERRADO (estado actual, no snapshot)
  sabor            text,
  hook             text default '',
  copy             text default '',
  guion            text default '',
  estado           text not null default 'Idea' check (estado in
    ('Idea','En diseño','En revisión','Aprobado','Publicado','Ganador','Descartado')),
  responsable      text default '',
  fecha_entrega    date,
  asset_url        text default '',
  notas            text default '',
  external_id      text,                           -- ad id / post id
  generacion       jsonb                           -- {provider:'higgsfield'|'heygen', job_id, prompt, costo, generado_en} — §6
);

create table content_posts (                       -- ex content_calendar
  id               text primary key,               -- CAL-01
  fecha            date not null,
  hora             time not null default '12:00',
  canal            text not null check (canal in
    ('Instagram','Facebook','TikTok','WhatsApp','Rappi','Referidos','Influencer','Orgánico')),
  campaign_id      text references campaigns(id),
  creative_id      text references creatives(id),
  titulo           text not null,
  copy_final       text default '',
  estado           text not null default 'Pendiente' check (estado in ('Pendiente','Programado','Publicado','No publicado')),
  url_publicacion  text default '',
  external_post_id text,
  notas            text default ''
);

create table metrics_daily (                       -- ex creative_results: LA ESCRIBE EL MCP/agente
  id          bigint generated always as identity primary key,
  fecha       date not null,
  fuente      text not null check (fuente in ('mcp-meta','mcp-tiktok','manual')),
  campaign_id text references campaigns(id),
  creative_id text references creatives(id),
  post_id     text references content_posts(id),
  impresiones integer not null default 0,
  alcance     integer not null default 0,
  clicks      integer not null default 0,
  mensajes_wa integer not null default 0,
  gasto       numeric not null default 0,
  unique (fecha, fuente, campaign_id, creative_id, post_id)
  -- pedidos/ventas/margen NO van acá: se derivan de orders (v_campaign_metrics)
);

create table recommendations (                     -- LO QUE ESCRIBE CLAUDE
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  autor       text not null default 'claude' check (autor in ('claude','reglas')),
  tipo        text not null check (tipo in
    ('pausar','subir','sinstock','copy','contenido','cliente','presupuesto','otro')),  -- CERRADO (Claude también respeta enums)
  campaign_id text references campaigns(id),
  creative_id text references creatives(id),
  titulo      text not null,
  texto       text not null,                       -- lenguaje simple (molde: Asistente de marca)
  accion      jsonb,                               -- {tipo:'subir', nuevoPresupuesto: 120000}
  prioridad   integer not null default 0,
  expira      date,
  estado      text not null default 'nueva' check (estado in ('nueva','vista','aplicada','descartada')),
  resultado   text                                 -- qué pasó después (lazo de aprendizaje)
);

create table marketing_ideas (
  id           text primary key,                   -- ID-01
  titulo       text not null,
  cat          text,                               -- semi-abierta: candidata a cerrar cuando el usuario defina la lista
  objetivo     text check (objetivo is null or objetivo in
    ('vender','recompra','regalo','cumpleaños','seguidores','historias etiquetadas')),  -- OBJETIVO_SIMPLE
  producto_sugerido_id text references products(id),
  copy text default '', guion_corto text default '', canal text,
  estado text not null default 'Nueva' check (estado in ('Nueva','Usada','Repetir','Ganadora','Descartada')),
  autor  text not null default 'humano' check (autor in ('humano','claude'))
);

create table marketing_guiones (
  id text primary key,                             -- GU-01
  titulo text not null, duracion_seg integer check (duracion_seg is null or duracion_seg > 0),  -- era text "15 seg"
  producto_foco_id text references products(id),
  objetivo text, dificultad text check (dificultad in ('Fácil','Medio','Avanzado')),
  escenas jsonb not null default '[]',             -- era escena1..4
  texto_pantalla text default '', audio text default '',
  autor text not null default 'humano' check (autor in ('humano','claude'))
);

create table marketing_mensajes (
  id text primary key, tipo text not null, texto text not null
);

create table brand_library (                       -- singleton (fila única)
  id boolean primary key default true check (id),
  frases jsonb not null default '[]', tono jsonb not null default '[]',
  palabras_si jsonb not null default '[]', palabras_no jsonb not null default '[]'
);

create table marketing_tasks (
  id text primary key,                             -- TAR-01
  tarea text not null, fecha date not null,
  estado text not null default 'Pendiente' check (estado in ('Pendiente','Hecha','Saltada')),
  responsable text default 'Marketing',
  origen text not null default 'humano' check (origen in ('humano','claude')),
  recommendation_id bigint references recommendations(id)
);

-- ---------- Beneficios ----------
create table benefits (
  id                text primary key,              -- B-11
  customer_id       text not null references customers(id),
  beneficio         text not null,                 -- label: '20% descuento'
  tipo_beneficio    text not null check (tipo_beneficio in
    ('descuento_porcentaje','descuento_valor_fijo','producto_gratis')),
  valor             numeric not null default 0,
  producto_gratis_id text references products(id),
  condicion         text default '',
  minimo            numeric not null default 0,
  activacion        date,
  vence             date,
  estado            text not null default 'Activo' check (estado in ('Activo','Reservado','Usado','Vencido')),
  pedido_uso        text,                          -- FK a orders (se agrega abajo, ciclo)
  obs               text default ''
);
-- OJO — flujo Activo→Reservado→Usado (→Activo al cancelar) está BIEN: portar tal cual (falso positivo conocido).

-- ---------- Pedidos ----------
create table orders (
  id             text primary key,                 -- P-1041
  fecha          date not null,
  hora           time not null,
  canal          text not null check (canal in ('WhatsApp','Instagram','Rappi','Directo')),
  customer_id    text not null references customers(id),
  barrio         text default '', direccion text default '',
  zona           text references zonas(nombre),
  franja         text references franjas(nombre),  -- gancho ORQUESTACIÓN: franja de entrega deseada (cupo/capacidad por franja)
  dom_cobrado    numeric not null default 0,       -- Rappi fuerza 0
  dom_costo      numeric not null default 0,       -- Rappi fuerza 0
  descuento      numeric not null default 0,
  benefit_id     text references benefits(id),
  pago           text check (pago in ('Nequi','Daviplata','Bancolombia','Rappi (app)')),  -- Efectivo prohibido
  comprobante    boolean not null default false,
  estado         text not null default 'Nuevo' check (estado in
    ('Nuevo','Confirmado','Pendiente de pago','Pagado','En producción','Empacado',
     'Listo para despacho','En ruta','Entregado','Cancelado','Reclamo')),
  obs            text default '',
  pagado_en      timestamptz,                      -- sello al confirmar pago
  comision_pago  numeric not null default 0,       -- gancho Fase 2: SNAPSHOT de la comisión del medio de pago (mismo principio que COGS)
  idempotency_key text unique,                     -- gancho Pide MOMOS: el pedido nace UNA vez (doble click / reintento de red)
  campaign_id    text references campaigns(id),
  creative_id    text references creatives(id),
  origen_detalle text not null default '' check (origen_detalle in
    ('','Historia de Instagram','Anuncio Meta','TikTok orgánico','Reel de Instagram',
     'Referido','Rappi','WhatsApp directo','Influencer','Otro'))   -- ORIGENES cerrado ('Otro' = escape)
);
alter table benefits add constraint benefits_pedido_uso_fk foreign key (pedido_uso) references orders(id);
alter table inventory_movements add constraint mov_order_fk foreign key (order_id) references orders(id);
-- Grafo TRANSICIONES + gates de fotos (FOTOS_PASO) + red de seguridad de receta:
-- van DENTRO de la RPC set_order_status() en Fase 2 — el servidor es el árbitro.

create table order_items (
  id             text primary key,                 -- IT10
  order_id       text not null references orders(id),
  product_id     text not null references products(id),
  nombre         text not null,                    -- snapshot
  sabor  text default '', salsa text default '', relleno text default '', figura text default '',
  -- ↑ SNAPSHOTS a propósito (texto, sin FK): el histórico no se rompe si cambia el catálogo
  cant           numeric not null check (cant > 0),
  precio         numeric not null default 0,       -- unitario snapshot (Rappi: precio_rappi)
  costo_unitario numeric not null default 0,       -- COGS CONGELADO al crear
  es_caja        boolean not null default false,   -- fila PADRE de combo
  es_sub_momo    boolean not null default false,   -- fila HIJA (1 momo físico)
  parent_item_id text references order_items(id),
  caja_num       integer,                          -- 1-based, dentro de la línea
  constraint hija_bien_formada check (not es_sub_momo or
    (parent_item_id is not null and cant = 1 and precio = 0 and costo_unitario = 0))
  -- Invariante: precio/costo/empaque SOLO en la padre; hijas en 0 → sin doble conteo.
);

create table order_item_adiciones (                -- era order_items[].adiciones embebido
  id            bigint generated always as identity primary key,
  order_item_id text not null references order_items(id),
  nombre        text not null,
  precio        numeric not null default 0,        -- por momo (escala × cant de línea)
  cant          numeric not null default 1,
  insumo_id     text references inventory_items(id),
  insumo_cant   numeric not null default 0,
  insumo_costo  numeric                            -- SNAPSHOT al crear (sobrevive a baja del insumo)
);

-- ---------- Producción ----------

-- (Producción v2) figuras.product_id: mapeo figura→producto como DATO. Va
-- acá (no en el create table figuras de más arriba) porque products recién
-- existe a partir de este punto del archivo.
alter table figuras add column if not exists product_id text references products(id);

-- (Producción v2) corridas: el evento de producción visible para el usuario
-- (sabor+relleno+salsa+figuras con cantidad). El servidor deriva de acá los
-- lotes hijos reales (production_batches.corrida_id) agrupando por
-- (producto, gramaje) — ver rpc-produccion-v2.sql sección B.
-- OJO — sede_id SIN el FK a sedes(id) inline a propósito: la tabla `sedes`
-- no existe en este archivo (nace en sedes-v1.sql, que se aplica DESPUÉS de
-- schema-v5.sql en la cadena de dependencias). Cuando se aplica de punta a
-- punta (schema-v5 → sedes-v1 → rpc-produccion-v2, el orden real), el FK se
-- agrega ahí mismo con `alter table corridas add constraint ... references
-- sedes(id)` — este espejo documenta la COLUMNA final, no reordena archivos.
create table corridas (
  id              text primary key,               -- CR-001
  fecha           date not null,
  sabor           text not null,
  relleno         text default '',
  salsa           text default '',
  resp_user_id    text references users(id),
  obs             text default '',
  idempotency_key text unique,
  sede_id         text not null default 'SEDE-01',  -- FK a sedes(id) se agrega en sedes-v1.sql
  created_at      timestamptz not null default now()
);

create table production_batches (
  id           text primary key,                   -- L-018
  fecha        date not null,
  product_id   text references products(id),       -- NORMALIZADO (era nombre)
  figura text default '', sabor text default '', relleno text default '', salsa text default '',
  gramaje_g    integer default 150 check (gramaje_g is null or gramaje_g > 0),  -- era text "150 g"
  prod integer not null default 0, perfectas integer not null default 0,
  imperfectas integer not null default 0, descartadas integer not null default 0,
  destino      text default '',
  resp_user_id text references users(id),          -- NORMALIZADO (era nombre)
  vence        date,
  estado       text not null default 'En preparación' check (estado in
    ('En preparación','Congelando','Listo','Reservado','Vendido','Imperfecto','Descartado')),
  stock_contabilizado boolean not null default false,
  horas_congelacion   numeric not null default 10,
  inicio_congelacion  timestamptz,
  molde        text references moldes(nombre),          -- gancho Fase 2: "molde X genera más imperfectos"
  ubicacion    text references ubicaciones_frio(nombre),-- gancho Fase 2: congelador/ubicación del lote
  obs          text default '',
  corrida_id   text references corridas(id),        -- (Producción v2) qué corrida generó este lote hijo
  figuras      jsonb                                -- (Producción v2) composición: [{"figura":"Momo","cant":2}]
);
alter table inventory_movements add constraint mov_batch_fk foreign key (batch_id) references production_batches(id);

-- ---------- Domicilios ----------
create table deliveries (
  id         text primary key,                     -- D-224
  order_id   text not null references orders(id),
  proveedor  text not null references proveedores_domicilio(nombre),  -- CERRADO
  mensajero_user_id text references users(id),     -- gancho ORQUESTACIÓN: QUIÉN entregó (proveedor 'Propio'; carga y calificación por mensajero)
  costo_real numeric not null default 0,
  cobrado    numeric not null default 0,
  zona       text,
  h_solicitud time, h_salida time, h_entrega time,
  codigo     text default '',
  estado     text not null default 'Por solicitar' check (estado in
    ('Por solicitar','Solicitado','Asignado','En ruta','Entregado','Problema','Cancelado')),
  obs        text default '',
  calificacion integer check (calificacion is null or calificacion between 1 and 5)  -- gancho Fase 3: calificación del mensajero
);

-- ---------- Evidencias (fotos → Storage) ----------
create table evidences (
  id           text primary key,                   -- E01
  order_id     text not null references orders(id),
  tipo         text not null check (tipo in
    ('Pedido armado','Caja abierta','Caja cerrada con sello','Bolsa sellada','Comprobante de pago','Entrega')),
  storage_path text not null,                      -- bucket `evidencias` (era url/dataURL — fix real del bug de cuota)
  fecha        timestamptz not null default now(),
  user_id      text references users(id)           -- NORMALIZADO (era nombre)
);

-- ---------- Reclamos ----------
create table claims (
  id           text primary key,                   -- R-032
  order_id     text not null references orders(id),
  customer_id  text not null references customers(id),
  fecha        date not null,
  tipo         text not null,
  entregado_en timestamptz,                        -- canónicos (hEntrega/hReclamo legacy NO migran)
  reclamo_en   timestamptz,
  descr        text default '', resp text default '',
  decision     text default '', solucion text default '',
  costo        numeric not null default 0,         -- compensación (cuenta en Aprobado/Compensado)
  estado       text not null default 'Abierto' check (estado in
    ('Abierto','En revisión','Aprobado','Rechazado','Compensado','Cerrado')),
  evidencia    text default ''
);

-- ---------- Auditoría y sugerencias ----------
create table audit_logs (
  id        text primary key,                      -- A05
  fecha     timestamptz not null default now(),
  user_id   text references users(id),             -- NORMALIZADO (era nombre)
  entidad   text not null,
  entidad_id text not null,                        -- polimórfico (sin FK a propósito)
  accion    text not null,
  de text default '', a text default ''
);

create table production_suggestions (
  id       text primary key,                       -- S-02
  fecha    date not null,
  product_id text references products(id),
  cantidad numeric not null default 0,
  motivo   text default '',
  order_id text references orders(id),
  estado   text not null default 'Pendiente' check (estado in ('Pendiente','Atendida')),
  area     text not null default 'Producción' check (area in ('Producción','Inventario')),
  item_id  text references inventory_items(id)     -- solo si area=Inventario
);

-- ---------- Reservas de inventario ----------
create table inventory_reservations (
  id          text primary key,                    -- RES-1
  order_id    text not null references orders(id),
  tipo        text not null check (tipo in ('producto','empaque','insumo')),
  -- refId polimórfico de la maqueta → dos FKs excluyentes:
  product_id  text references products(id),        -- tipo 'producto'
  item_id     text references inventory_items(id), -- tipo 'empaque' | 'insumo'
  nombre      text not null,                       -- snapshot decorado ("… (adición Oreo)")
  cantidad    numeric not null,                    -- lo REALMENTE descontado (no lo teórico)
  fecha       timestamptz not null default now(),
  estado      text not null default 'Reservada' check (estado in ('Reservada','Liberada','Consumida','Temporal')),  -- 'Temporal' = hold de checkout (Pide MOMOS)
  liberada_en timestamptz,
  batch_id    text references production_batches(id),  -- gancho Fase 2: asignar lote a la reserva (hoy: stock agregado)
  expira      timestamptz,                              -- gancho Pide MOMOS: vencimiento del hold (10-15 min); cron/RPC libera al expirar
  constraint ref_exclusiva check (
    (tipo = 'producto' and product_id is not null and item_id is null) or
    (tipo in ('empaque','insumo') and item_id is not null and product_id is null))
);

-- ---------- Vistas de métricas (nunca se persisten CAC/ROAS/POAS) ----------
-- security_invoker = on: la vista respeta el RLS del que consulta (sin esto, una
-- vista owner expone ventas/COGS/margen a cualquier authenticated — fuga real).
create or replace view v_order_totals with (security_invoker = on) as
select o.id as order_id,
       sum(oi.precio * oi.cant)
         + coalesce(sum(ada.total_ad), 0) as ventas,
       sum(oi.costo_unitario * oi.cant)
         + coalesce(sum(ada.costo_ad), 0) as cogs
from orders o
join order_items oi on oi.order_id = o.id
left join lateral (
  select sum(a.precio * a.cant * oi.cant)                          as total_ad,
         sum(coalesce(a.insumo_costo,0) * a.insumo_cant * a.cant * oi.cant) as costo_ad
  from order_item_adiciones a where a.order_item_id = oi.id
) ada on true
group by o.id;

create or replace view v_campaign_metrics with (security_invoker = on) as  -- ROAS y POAS (§4: objetivo HÍBRIDO)
select c.id as campaign_id,
       count(distinct o.id)                          as pedidos,
       coalesce(sum(t.ventas), 0)                    as ventas,
       coalesce(sum(t.ventas - t.cogs), 0)           as margen,
       coalesce(m.gasto, 0)                          as gasto,
       case when coalesce(m.gasto,0) > 0 then sum(t.ventas) / m.gasto end            as roas,
       case when coalesce(m.gasto,0) > 0 then sum(t.ventas - t.cogs) / m.gasto end   as poas,
       case when count(distinct o.id) > 0 then coalesce(m.gasto,0) / count(distinct o.id) end as cac
from campaigns c
left join orders o on o.campaign_id = c.id
  and o.estado not in ('Cancelado') and o.pagado_en is not null
left join v_order_totals t on t.order_id = o.id
left join (select campaign_id, sum(gasto) as gasto from metrics_daily group by campaign_id) m
  on m.campaign_id = c.id
group by c.id, m.gasto;

-- ============================================================================
-- RLS — políticas por rol (concretadas 2026-07-10; reemplaza al esqueleto)
--
-- Cuatro identidades, cuatro superficies:
--   1. STAFF — auth.uid() → users.auth_id; rol vía current_rol().
--   2. claude_agent — rol Postgres PROPIO con login (conexión directa del
--      traficker/MCP). JAMÁS la service key: la service key bypassea RLS.
--   3. CLIENTE del shop — auth.uid() → customers.auth_id. Solo vistas shop_*
--      y (fase shop) RPC crear_pedido(). SIN políticas sobre tablas base.
--   4. anon — catálogo público vía vistas shop_* (invitado primero, PIDE-MOMOS.md).
--
-- Principio: los writes que arbitran STOCK/ESTADO (orders, order_items,
-- inventory_*, reservations, claims…) NO tienen política de escritura staff —
-- en Fase 2 van por RPCs `security definer` (el servidor es el árbitro).
-- Acá solo queda el CRUD que no arbitra stock: marketing, CRM, producción,
-- domicilios, evidencias, auditoría. Mientras tanto, escribe el Administrador.
-- ============================================================================

-- 0) RLS activo en TODAS las tablas → deny-by-default (sin política no entra nadie)
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 1) Helpers de identidad (security definer + search_path fijo)
create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as
  $$ select exists (select 1 from users where auth_id = auth.uid() and activo) $$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as
  $$ select current_rol() = 'Administrador' $$;

create or replace function current_customer_id() returns text
language sql stable security definer set search_path = public as
  $$ select id from customers where auth_id = auth.uid() $$;

-- 2) Administrador = todo · staff activo = LEE todo (equipo de 2-4 personas,
--    sin secretos internos; la restricción fina vive en los WRITES, no en la lectura)
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create policy admin_all  on public.%I for all    to authenticated using (is_admin()) with check (is_admin())', t);
    execute format('create policy staff_read on public.%I for select to authenticated using (is_staff())', t);
  end loop;
end $$;

-- 3) Writes por rol (solo lo que NO arbitra stock/estado; DELETE = solo admin — soft-delete)
-- Marketing/CRM: sus tablas + clientes + beneficios
do $$ declare t text; begin
  foreach t in array array['campaigns','creatives','content_posts','metrics_daily',
      'recommendations','marketing_ideas','marketing_guiones','marketing_mensajes',
      'brand_library','marketing_tasks','customers','benefits'] loop
    execute format($p$create policy mkt_insert on public.%I for insert to authenticated
      with check (current_rol() = 'Marketing/CRM')$p$, t);
    execute format($p$create policy mkt_update on public.%I for update to authenticated
      using (current_rol() = 'Marketing/CRM') with check (current_rol() = 'Marketing/CRM')$p$, t);
  end loop;
end $$;

-- Logística: domicilios
create policy log_insert on deliveries for insert to authenticated
  with check (current_rol() = 'Logística');
create policy log_update on deliveries for update to authenticated
  using (current_rol() = 'Logística') with check (current_rol() = 'Logística');

-- Cocina/Empaque: lotes de producción + atender sugerencias
create policy prod_insert on production_batches for insert to authenticated
  with check (current_rol() in ('Cocina','Empaque'));
create policy prod_update on production_batches for update to authenticated
  using (current_rol() in ('Cocina','Empaque')) with check (current_rol() in ('Cocina','Empaque'));
create policy sug_update on production_suggestions for update to authenticated
  using (current_rol() in ('Cocina','Empaque')) with check (current_rol() in ('Cocina','Empaque'));

-- Cualquier staff: sube evidencias y deja auditoría (nadie edita ni borra: solo admin)
create policy evid_insert  on evidences  for insert to authenticated with check (is_staff());
create policy audit_insert on audit_logs for insert to authenticated with check (is_staff());

-- 4) claude_agent — el traficker (DISEÑO-TRAFICKER.md §3, traficker/AGENTE.md)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'claude_agent') then
    create role claude_agent login noinherit;  -- ⚠️ password EN EL DEPLOY (no comitear):
  end if;                                      --    alter role claude_agent password '…';
end $$;
grant usage on schema public to claude_agent;

-- LEE: marketing completo + pedidos/productos (para POAS) + parámetros calibrables
grant select on campaigns, creatives, content_posts, metrics_daily, recommendations,
  marketing_ideas, marketing_guiones, marketing_mensajes, brand_library, marketing_tasks,
  orders, order_items, order_item_adiciones, products, figuras, toppings, app_settings,
  v_order_totals, v_campaign_metrics to claude_agent;
do $$ declare t text; begin
  foreach t in array array['campaigns','creatives','content_posts','metrics_daily',
      'recommendations','marketing_ideas','marketing_guiones','marketing_mensajes',
      'brand_library','marketing_tasks','orders','order_items','order_item_adiciones',
      'products','figuras','toppings','app_settings'] loop
    execute format('create policy claude_read on public.%I for select to claude_agent using (true)', t);
  end loop;
end $$;

-- ESCRIBE solo marketing (sin grant en inventory_*/orders/benefits/claims/customers:
-- JAMÁS escribe operación — la prohibición es estructural, no de prompt)
grant insert, update on metrics_daily, recommendations, marketing_ideas,
  marketing_guiones, marketing_tasks, creatives to claude_agent;
grant usage on sequence metrics_daily_id_seq, recommendations_id_seq to claude_agent;

create policy claude_metrics_ins on metrics_daily for insert to claude_agent
  with check (fuente in ('mcp-meta','mcp-tiktok'));             -- no puede firmar 'manual'
create policy claude_metrics_upd on metrics_daily for update to claude_agent
  using (fuente in ('mcp-meta','mcp-tiktok')) with check (fuente in ('mcp-meta','mcp-tiktok'));
create policy claude_reco_ins on recommendations for insert to claude_agent
  with check (autor = 'claude');
create policy claude_reco_upd on recommendations for update to claude_agent
  using (autor = 'claude') with check (autor = 'claude');        -- lazo de aprendizaje (resultado)
create policy claude_ideas_ins on marketing_ideas for insert to claude_agent
  with check (autor = 'claude');
create policy claude_ideas_upd on marketing_ideas for update to claude_agent
  using (true) with check (true);                                -- marca Usada/Ganadora
create policy claude_guion_ins on marketing_guiones for insert to claude_agent
  with check (autor = 'claude');
create policy claude_task_ins on marketing_tasks for insert to claude_agent
  with check (origen = 'claude');
create policy claude_crea_ins on creatives for insert to claude_agent
  with check (estado in ('Idea','En revisión'));                 -- §6: nace Idea, jamás Aprobado
create policy claude_crea_upd on creatives for update to claude_agent
  using (estado not in ('Aprobado','Publicado','Ganador'))       -- el humano SIEMPRE aprueba;
  with check (estado not in ('Aprobado','Publicado','Ganador')); -- lo aprobado no se toca

-- 5) Shop "Pide MOMOS" — catálogo público y seguimiento (dos frontends, UN backend)
-- Vistas OWNER (bypassean RLS a propósito): filtran FILAS y COLUMNAS a la vez —
-- el shop jamás ve costo/stock interno/otros clientes (regla 7 de PIDE-MOMOS.md).
create view shop_catalogo with (security_barrier) as
  select id, nombre, cat, tipo, especie, precio, descr, foto_path, alergenos, combo_size
  from products where activo;
create view shop_toppings with (security_barrier) as
  select nombre, precio from toppings where activo;
create view shop_figuras with (security_barrier) as
  select nombre, especie from figuras where activo;
create view shop_zonas with (security_barrier) as
  select nombre, tarifa from zonas;
create view shop_franjas with (security_barrier) as
  select nombre, hora_inicio, hora_fin from franjas where activo;  -- sin cupo: el disponible lo calcula el backend
grant select on shop_catalogo, shop_toppings, shop_figuras, shop_zonas, shop_franjas to anon, authenticated;

-- Seguimiento: SOLO sus pedidos, con los estados PÚBLICOS simplificados (PIDE-MOMOS.md)
create view shop_mis_pedidos with (security_barrier) as
  select o.id, o.fecha, o.hora,
         case o.estado
           when 'Nuevo'               then 'Pedido recibido'
           when 'Confirmado'          then 'Pedido recibido'
           when 'Pendiente de pago'   then 'Pedido recibido'
           when 'Pagado'              then 'Pago confirmado'
           when 'En producción'       then 'Preparando'
           when 'Empacado'            then 'Preparando'
           when 'Listo para despacho' then 'Listo para despacho'
           when 'En ruta'             then 'En camino'
           when 'Reclamo'             then 'Entregado'    -- el reclamo se gestiona aparte
           else o.estado end as estado,                   -- Entregado / Cancelado tal cual
         o.dom_cobrado, o.descuento
  from orders o where o.customer_id = current_customer_id();
create view shop_mis_items with (security_barrier) as
  select oi.order_id, oi.nombre, oi.sabor, oi.salsa, oi.figura, oi.cant, oi.precio,
         oi.es_caja, oi.es_sub_momo, oi.parent_item_id, oi.caja_num  -- SIN costo_unitario
  from order_items oi join orders o on o.id = oi.order_id
  where o.customer_id = current_customer_id();
grant select on shop_mis_pedidos, shop_mis_items to authenticated;  -- anon no (requiere cuenta)

-- El cliente NO tiene políticas sobre tablas base: crear pedido = RPC crear_pedido()
-- `security definer` (valida disponibilidad + reserva 'Temporal' con expira + zona +
-- idempotency_key). Consulta de pedido de INVITADO (número + teléfono) = RPC dedicada.

-- 6) Storage (al crear el proyecto, no es SQL de este archivo): bucket privado
--    `evidencias` (INSERT/SELECT staff, policies sobre storage.objects) + bucket
--    público `productos` (fotos del catálogo; escriben admin/marketing).
-- ============================================================================

-- ---------- Notas de migración (maqueta → Postgres) ----------
-- 1. Fechas: strings "YYYY-MM-DD [HH:MM[:SS]]" en hora Bogotá → date/timestamptz
--    con `at time zone 'America/Bogota'`. NUNCA interpretar como UTC.
-- 2. inventory_movements: parsear cant string ("-1.5 kg") → numeric; item nombre → item_id.
-- 3. production_batches.producto (nombre) → product_id; evidences.user / audit_logs.user → user_id.
-- 4. order_items[].adiciones (embebido) → filas en order_item_adiciones.
-- 5. products.componentProductIds[] → combo_components; atributos NO migra (derivado).
-- 6. Fotos dataURL → subir a Storage y guardar storage_path (fix real del bug de cuota #2/#6).
-- 7. settings.counters → counters; settings.toppings → tabla toppings (insumoId→insumo_id);
--    resto de settings → figuras/zonas/catalog_values/app_settings.
-- 8. seedUsers: crear auth.users reales y poblar users.auth_id ANTES de activar RLS.
-- 9. Unidades cerradas: gramajes "150 g"/"280 g" → gramaje_g integer (parsear dígitos);
--    duraciones "15 seg" → duracion_seg integer. La UI vuelve a formatear al mostrar.
--    OJO: el front debe seguir la misma regla — todo <Select> cerrado, nunca <Input> libre
--    para unidad/gramaje/duración (el form de insumos ya cumple; extenderlo a figuras y guiones).
-- 10. Dominios cerrados nuevos: sembrar inventory_cats/product_cats desde los valores DISTINTOS
--     existentes en la maqueta; proveedores_domicilio desde settings.proveedores. Quedan abiertos
--     a propósito: claims.tipo y marketing_ideas.cat (candidatos a cerrar cuando el usuario
--     defina sus listas) + notas/obs/descr + snapshots históricos.
-- 11. GANCHOS Fase 2/3 (BACKLOG "Roadmap"): moldes/ubicaciones_frio (el usuario siembra su lista),
--     batches.molde/ubicacion, orders.comision_pago, reservations.batch_id, deliveries.calificacion,
--     customers.referido_por — todos nullable/0: la maqueta migra sin estos datos y el historial
--     empieza a acumularse desde el día 1 de Fase 1. La UI los expone recién cuando su feature llegue.
--     ➕ ORQUESTACIÓN (análisis 2026-07-10, BACKLOG #8-11): franjas + orders.franja,
--     moldes.capacidad / ubicaciones_frio.capacidad, rol 'Mensajero' + deliveries.mensajero_user_id.
--     Mismo principio: nullable hoy, historial desde el día 1, la UI llega en Fase 2/3.
-- 12. GANCHOS Pide MOMOS (PIDE-MOMOS.md): customers.auth_id (invitado = NULL; cuenta activada =
--     NOT NULL — NO es estado del enum), orders.idempotency_key, reservas 'Temporal'+expira
--     (hold de checkout), products.foto_path/alergenos. Merge de invitado→cuenta por teléfono/correo
--     vía RPC (jamás dos clientes por el mismo humano); índice por customers.telefono recomendado.
