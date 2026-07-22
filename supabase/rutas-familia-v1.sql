-- ============================================================================
-- MOMOS OPS — Rutas por familia v1 (Etapa A: datos sin motor) (2026-07-11)
-- Target: Supabase / PostgreSQL 17. Fuente de verdad de columnas base:
-- schema-v5.sql. Patrón de tabla nueva + RLS: sedes-v1.sql. Fuente de verdad
-- de estados de lote vivos: rpc-produccion-v2.sql (set_lote_estado).
--
-- SPEC DE ENTRADA: catalogo-derivados/ — 69 SKUs (productos_derivados_momos_ops.csv)
-- en 8 rutas (rutas_derivados_momos_ops.csv, 63 pasos). Estado del catálogo:
-- BORRADOR_TECNICO_V1 / NO_HASTA_VALIDAR — LOS 69 SKUs NO SE IMPORTAN ACÁ.
-- Este archivo siembra el CATÁLOGO DE RUTAS (nombres, atributos, checklist,
-- máquina de estados como dato) para que el piloto físico pueda validarlo
-- ANTES de que exista una sola fila de producto derivado en la base.
--
-- QUÉ ES ESTE SLICE (Etapa A, spec aprobada — sesión de diseño 2026-07-11):
-- "Ruta" es la línea de producción de una familia (Momo Cake, Cheesecake,
-- Pavé, Cuchareable, Sundae, Malteada, Crazy Rush, Yogurt Bites) más el
-- retrofit de lo que Producción v2 YA hace (figuras moldeadas congeladas,
-- ruta R-FIG-CONG). Esta etapa es SOLO DDL + SEED: tres tablas nuevas
-- (rutas, ruta_pasos, ruta_estados), columnas nuevas en products/
-- production_batches, y los datos de las 9 rutas — CERO funciones nuevas,
-- CERO cambios a crear_corrida/set_lote_estado/desmoldar_lote, CERO cambios
-- de comportamiento observable. Los MOTORES (ensamblar_lote, la RPC que de
-- verdad recorra ruta_estados y descuente BOM al ensamblar) llegan en la
-- Etapa B, después de validar el piloto físico de al menos una familia.
--
-- DECISIÓN — estados gruesos como DATO, no como enum nuevo: cada ruta tiene
-- su propia mini máquina de estados (ruta_estados), pensada para reusar los
-- MISMOS strings de estado que ya acepta el CHECK de production_batches
-- ('En preparación','Congelando','Listo','Reservado','Vendido','Imperfecto',
-- 'Descartado' — ver schema-v5.sql). R-FIG-CONG replica BYTE A BYTE el ciclo
-- que crear_corrida/set_lote_estado ya ejecutan hoy (retrofit, no invención).
-- Las demás rutas usan estados NUEVOS ('Ensamblado','Estabilizando',...) que
-- HOY NO PASAN el CHECK de production_batches.estado — a propósito: nadie
-- los usa todavía (no hay motor), y cuando la Etapa B los active sobre lotes
-- reales, esa migración ampliará el CHECK. Este archivo los guarda como
-- referencia (tabla propia, sin FK a production_batches.estado) para que el
-- checklist/máquina de estados quede escrito y peer-reviewable ANTES de
-- tocar una sola línea de código de servidor.
--
-- DEPENDENCIAS — aplicar en este orden:
--   1. schema-v5.sql
--   2. sedes-v1.sql
--   3. rpc-produccion-v2.sql   (estados vivos de production_batches — set_lote_estado)
--   4. subrecetas-bom-v1.sql
--   5. ESTE ARCHIVO (rutas-familia-v1.sql)
--
-- NO EJECUTAR contra ninguna base desde acá — archivo de definición únicamente.
-- ============================================================================

-- ============================================================================
-- A) DDL — tablas nuevas (rutas, ruta_pasos, ruta_estados)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A.1) rutas — catálogo de líneas de producción por familia. PK = código del
-- catálogo (R-MCK-CONG, …) para que sea legible en joins/auditoría, mismo
-- espíritu que las PKs de texto del resto del sistema (schema-v5.sql, nota
-- de diseño "PKs = códigos de texto actuales").
-- ---------------------------------------------------------------------------
create table if not exists rutas (
  id                text primary key,               -- R-MCK-CONG, R-FIG-CONG, …
  nombre            text not null,
  momento_descuento text not null check (momento_descuento in
    ('AL_FABRICAR','AL_ENSAMBLAR','AL_PREPARAR')),
  conservacion      text not null check (conservacion in
    ('CONGELADO','REFRIGERADO','NINGUNA')),
  genera_stock      boolean not null,                -- true = PRODUCIR_PARA_STOCK; false = bajo pedido/consumo inmediato
  activo            boolean not null default true,
  created_at        timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- A.2) ruta_pasos — checklist INFORMATIVO, sin efectos de servidor (ninguna
-- RPC lee esta tabla en esta etapa). Transcripción verbatim de
-- catalogo-derivados/rutas_derivados_momos_ops.csv.
-- ---------------------------------------------------------------------------
create table if not exists ruta_pasos (
  ruta_id     text not null references rutas(id),
  orden       int not null,
  codigo      text not null,
  descripcion text not null,
  primary key (ruta_id, orden)
);

-- ---------------------------------------------------------------------------
-- A.3) ruta_estados — máquina de estados GRUESA por ruta, como datos (ver
-- DECISIÓN arriba). efecto describe qué haría el motor de Etapa B al entrar
-- a ese estado; en Etapa A es solo metadata, ninguna RPC actúa sobre 'efecto'.
-- ---------------------------------------------------------------------------
create table if not exists ruta_estados (
  ruta_id text not null references rutas(id),
  orden   int not null,
  estado  text not null,
  efecto  text not null check (efecto in ('NINGUNO','DESCONTAR_BOM','ALTA_STOCK')),
  primary key (ruta_id, orden)
);

-- ---------------------------------------------------------------------------
-- A.4) products — columnas de ficha técnica, todas NULL-able (ficha
-- pendiente hasta que el piloto valide la familia). Mismo patrón de
-- "gancho nullable, historial desde el día 1" que sedes-v1.sql y las notas
-- de migración 11/12 de schema-v5.sql.
-- ---------------------------------------------------------------------------
alter table products add column if not exists familia text;
alter table products add column if not exists ruta_id text references rutas(id);
alter table products add column if not exists modo_stock text check (modo_stock in
  ('PRODUCIR_PARA_STOCK','BAJO_PEDIDO'));
alter table products add column if not exists vida_util_dias int check (vida_util_dias is null or vida_util_dias > 0);
alter table products add column if not exists estado_ficha text check (estado_ficha in
  ('BORRADOR_TECNICO_V1','PILOTO','ACTIVO','RETIRADO'));

-- ---------------------------------------------------------------------------
-- A.5) production_batches.vencimiento — SIN lógica en esta etapa (la usa la
-- Etapa B para calcular vida útil real por lote). Nace null en lotes nuevos.
-- ---------------------------------------------------------------------------
alter table production_batches add column if not exists vencimiento date;

-- ============================================================================
-- B) SEED — 9 rutas (8 del catálogo + retrofit R-FIG-CONG), 63 pasos
-- verbatim, 26 estados gruesos (decididos en sesión de diseño), retrofit de
-- products para figuras ya mapeadas, familias en catalog_values (si el shape
-- calza — ver nota más abajo). Todo idempotente: on conflict do nothing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- B.1) rutas — atributos de las 8 rutas del catálogo DERIVADOS de
-- productos_derivados_momos_ops.csv (verificado: cada ruta tiene UNA sola
-- combinación de momento_descuento/conservacion/modo_stock entre sus SKUs —
-- sin mezclas, no hizo falta parar). Mapeos de vocabulario CSV → columnas:
--   conservacion CSV 'CONSUMO_INMEDIATO' → conservacion 'NINGUNA' (el check
--     de esta tabla no tiene un valor propio para "se consume al toque";
--     NINGUNA = no hay conservación que gestionar, coincide en espíritu).
--   modo_stock CSV 'PREPARAR_AL_PEDIDO' → genera_stock=false (bajo pedido,
--     nunca produce para stock); 'PRODUCIR_PARA_STOCK' → genera_stock=true.
-- R-FIG-CONG es RETROFIT (no está en el catálogo derivados): describe lo que
-- crear_corrida + set_lote_estado YA hacen hoy para figuras moldeadas —
-- descuenta insumos AL crear la corrida (momento_descuento=AL_FABRICAR),
-- pasa por congelación (conservacion=CONGELADO) y sí genera stock.
-- ---------------------------------------------------------------------------
insert into rutas (id, nombre, momento_descuento, conservacion, genera_stock) values
  ('R-FIG-CONG', 'Figura moldeada congelada',      'AL_FABRICAR',  'CONGELADO',   true),
  ('R-MCK-CONG', 'Momo Cake congelado',            'AL_ENSAMBLAR', 'CONGELADO',   true),
  ('R-CHK-REF',  'Cheesecake refrigerado',         'AL_ENSAMBLAR', 'REFRIGERADO', true),
  ('R-PAV-REF',  'Pavé MOMOS refrigerado',         'AL_ENSAMBLAR', 'REFRIGERADO', true),
  ('R-CUC-REF',  'Cuchareable MOMOS refrigerado',  'AL_ENSAMBLAR', 'REFRIGERADO', true),
  ('R-SUN-PED',  'Sundae MOMOS bajo pedido',       'AL_PREPARAR',  'NINGUNA',     false),
  ('R-MAL-PED',  'Malteada MOMOS bajo pedido',     'AL_PREPARAR',  'NINGUNA',     false),
  ('R-CRZ-PED',  'Crazy Rush bajo pedido',         'AL_PREPARAR',  'NINGUNA',     false),
  ('R-YGB-CONG', 'Yogurt Bites congelado',         'AL_FABRICAR',  'CONGELADO',   true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- B.2) ruta_pasos — 63 pasos verbatim de rutas_derivados_momos_ops.csv
-- (route_code, step_order, step_code, description — mismo orden, código y
-- texto del CSV; sin pasos para R-FIG-CONG, que es retrofit sin checklist
-- documentado en el catálogo).
-- ---------------------------------------------------------------------------
insert into ruta_pasos (ruta_id, orden, codigo, descripcion) values
  -- R-MCK-CONG (11)
  ('R-MCK-CONG', 1,  'VERIFICAR_COMPONENTES', 'Confirmar mousse, cheesecake, ganache/salsa, crocante, topping y figurita disponibles.'),
  ('R-MCK-CONG', 2,  'FORMAR_BASE',           'Dosificar y compactar el crocante en el molde o envase.'),
  ('R-MCK-CONG', 3,  'DOSIFICAR_MOUSSE_1',    'Agregar primera capa de mousse.'),
  ('R-MCK-CONG', 4,  'AGREGAR_CENTRO',        'Agregar cheesecake y ganache o el relleno definido.'),
  ('R-MCK-CONG', 5,  'CERRAR_MOUSSE',         'Completar y nivelar con mousse.'),
  ('R-MCK-CONG', 6,  'CONGELAR',              'Congelar 8 a 12 horas o hasta desmolde seguro.'),
  ('R-MCK-CONG', 7,  'DESMOLDAR',             'Desmoldar completamente congelado.'),
  ('R-MCK-CONG', 8,  'DECORAR',               'Aplicar salsa/cobertura y topping.'),
  ('R-MCK-CONG', 9,  'COLOCAR_FIGURA',        'Colocar 1 figurita horizontal del sabor.'),
  ('R-MCK-CONG', 10, 'EMPACAR',               'Empacar y etiquetar lote.'),
  ('R-MCK-CONG', 11, 'LIBERAR',               'Liberar como disponible congelado.'),

  -- R-CHK-REF (9)
  ('R-CHK-REF', 1, 'VERIFICAR_COMPONENTES', 'Confirmar cheesecake, crocante, inclusión, salsa, topping y figurita.'),
  ('R-CHK-REF', 2, 'FORMAR_BASE',           'Dosificar y compactar crocante en el envase.'),
  ('R-CHK-REF', 3, 'SABORIZAR_CHEESECAKE',  'Mezclar cheesecake con la inclusión del sabor cuando aplique.'),
  ('R-CHK-REF', 4, 'DOSIFICAR',             'Dosificar crema cheesecake sobre la base.'),
  ('R-CHK-REF', 5, 'ESTABILIZAR_REF',       'Refrigerar hasta firmeza validada.'),
  ('R-CHK-REF', 6, 'DECORAR',               'Aplicar salsa y topping.'),
  ('R-CHK-REF', 7, 'COLOCAR_FIGURA',        'Colocar figurita congelada sobre barrera estable o cerca del despacho.'),
  ('R-CHK-REF', 8, 'EMPACAR',               'Cerrar y etiquetar.'),
  ('R-CHK-REF', 9, 'LIBERAR',               'Liberar como disponible refrigerado.'),

  -- R-PAV-REF (10)
  ('R-PAV-REF', 1,  'VERIFICAR_COMPONENTES', 'Confirmar crema, mousse, Saltín, salsa, topping y figurita.'),
  ('R-PAV-REF', 2,  'CAPA_CREMA',            'Dosificar primera capa de crema cheesecake/pavé.'),
  ('R-PAV-REF', 3,  'CAPA_SALTIN',           'Colocar galleta Saltín seca o ligeramente humedecida según ficha.'),
  ('R-PAV-REF', 4,  'CAPA_MOUSSE',           'Dosificar mousse del sabor.'),
  ('R-PAV-REF', 5,  'REPETIR_CAPAS',         'Repetir crema, Saltín y mousse según presentación.'),
  ('R-PAV-REF', 6,  'DECORAR',               'Aplicar salsa y topping.'),
  ('R-PAV-REF', 7,  'REPOSAR_REF',           'Refrigerar para integrar capas y ablandar parcialmente la galleta.'),
  ('R-PAV-REF', 8,  'COLOCAR_FIGURA',        'Colocar figurita horizontal.'),
  ('R-PAV-REF', 9,  'EMPACAR',               'Cerrar y etiquetar.'),
  ('R-PAV-REF', 10, 'LIBERAR',               'Liberar como disponible refrigerado.'),

  -- R-CUC-REF (8)
  ('R-CUC-REF', 1, 'VERIFICAR_COMPONENTES', 'Confirmar mousse, cheesecake, crocante, salsa, topping y figurita.'),
  ('R-CUC-REF', 2, 'PREPARAR_ENVASE',       'Identificar vaso/envase y lote.'),
  ('R-CUC-REF', 3, 'MONTAR_CAPAS',          'Dosificar crocante, mousse, cheesecake y salsa en capas.'),
  ('R-CUC-REF', 4, 'TERMINAR',              'Añadir topping y limpiar bordes.'),
  ('R-CUC-REF', 5, 'ESTABILIZAR_REF',       'Refrigerar hasta la textura objetivo.'),
  ('R-CUC-REF', 6, 'COLOCAR_FIGURA',        'Colocar figurita horizontal.'),
  ('R-CUC-REF', 7, 'EMPACAR',               'Cerrar y etiquetar.'),
  ('R-CUC-REF', 8, 'LIBERAR',               'Liberar como disponible refrigerado.'),

  -- R-SUN-PED (6)
  ('R-SUN-PED', 1, 'RECIBIR_PEDIDO',        'Crear preparación bajo pedido.'),
  ('R-SUN-PED', 2, 'RESERVAR_COMPONENTES',  'Reservar mousse congelada, crema, salsa, crocante e inclusiones.'),
  ('R-SUN-PED', 3, 'PORCIONAR_MOUSSE',      'Dosificar mousse o trozos aptos.'),
  ('R-SUN-PED', 4, 'ENSAMBLAR',             'Añadir cheesecake/crema, salsa, crocante e inclusión.'),
  ('R-SUN-PED', 5, 'TERMINAR',              'Aplicar topping.'),
  ('R-SUN-PED', 6, 'ENTREGAR',              'Entregar inmediatamente; no crear stock terminado.'),

  -- R-MAL-PED (6)
  ('R-MAL-PED', 1, 'RECIBIR_PEDIDO', 'Crear preparación bajo pedido.'),
  ('R-MAL-PED', 2, 'RESERVAR_BASE',  'Tomar mousse, figura o imperfecto apto trazable.'),
  ('R-MAL-PED', 3, 'LICUAR',         'Licuar con leche/base líquida según ficha.'),
  ('R-MAL-PED', 4, 'AJUSTAR',        'Verificar textura y ajustar.'),
  ('R-MAL-PED', 5, 'DECORAR',        'Agregar salsa y topping.'),
  ('R-MAL-PED', 6, 'ENTREGAR',       'Entregar inmediatamente.'),

  -- R-CRZ-PED (5)
  ('R-CRZ-PED', 1, 'RECIBIR_PEDIDO',    'Crear preparación bajo pedido.'),
  ('R-CRZ-PED', 2, 'LICUAR_BASE',       'Licuar hielo, agua, sirope, concentrado y ácido.'),
  ('R-CRZ-PED', 3, 'AGREGAR_MACERADO',  'Agregar fruta macerada y chamoy/Tajín según versión.'),
  ('R-CRZ-PED', 4, 'DECORAR',           'Terminar vaso y bordes.'),
  ('R-CRZ-PED', 5, 'ENTREGAR',          'Entregar inmediatamente.'),

  -- R-YGB-CONG (8)
  ('R-YGB-CONG', 1, 'PREPARAR_MEZCLA', 'Preparar yogurt, fruta, leche en polvo y endulzante.'),
  ('R-YGB-CONG', 2, 'PORCIONAR',       'Dosificar en moldes.'),
  ('R-YGB-CONG', 3, 'CONGELAR',        'Congelar hasta firmeza.'),
  ('R-YGB-CONG', 4, 'DESMOLDAR',       'Desmoldar.'),
  ('R-YGB-CONG', 5, 'BANAR',           'Bañar con chocolate/cobertura.'),
  ('R-YGB-CONG', 6, 'ESTABILIZAR',     'Volver a congelar o estabilizar.'),
  ('R-YGB-CONG', 7, 'EMPACAR',         'Empacar y etiquetar.'),
  ('R-YGB-CONG', 8, 'LIBERAR',         'Liberar como disponible congelado.')
on conflict (ruta_id, orden) do nothing;

-- ---------------------------------------------------------------------------
-- B.3) ruta_estados — máquina de estados gruesa, decidida en sesión de
-- diseño (NO CAMBIAR sin nueva decisión). R-FIG-CONG usa los strings EXACTOS
-- que set_lote_estado acepta hoy en production_batches.estado
-- ('En preparación','Congelando','Listo' — rpc-produccion-v2.sql/schema-v5.sql);
-- las demás rutas usan estados nuevos, propios de esta tabla, que TODAVÍA NO
-- pasan el CHECK de production_batches (no hay motor en Etapa A que los
-- escriba ahí — ver DECISIÓN en la cabecera del archivo).
-- Conteo: 3+4+4+3+3+3+2+2+2 = 26.
-- ---------------------------------------------------------------------------
insert into ruta_estados (ruta_id, orden, estado, efecto) values
  -- R-FIG-CONG (3) — retrofit byte a byte de crear_corrida + set_lote_estado
  ('R-FIG-CONG', 1, 'En preparación', 'DESCONTAR_BOM'),
  ('R-FIG-CONG', 2, 'Congelando',     'NINGUNO'),
  ('R-FIG-CONG', 3, 'Listo',         'ALTA_STOCK'),

  -- R-MCK-CONG (4)
  ('R-MCK-CONG', 1, 'Ensamblado', 'DESCONTAR_BOM'),
  ('R-MCK-CONG', 2, 'Congelando', 'NINGUNO'),
  ('R-MCK-CONG', 3, 'Terminando', 'NINGUNO'),
  ('R-MCK-CONG', 4, 'Listo',      'ALTA_STOCK'),

  -- R-YGB-CONG (4)
  ('R-YGB-CONG', 1, 'Producido',  'DESCONTAR_BOM'),
  ('R-YGB-CONG', 2, 'Congelando', 'NINGUNO'),
  ('R-YGB-CONG', 3, 'Terminando', 'NINGUNO'),
  ('R-YGB-CONG', 4, 'Listo',      'ALTA_STOCK'),

  -- R-CHK-REF (3)
  ('R-CHK-REF', 1, 'Ensamblado',    'DESCONTAR_BOM'),
  ('R-CHK-REF', 2, 'Estabilizando', 'NINGUNO'),
  ('R-CHK-REF', 3, 'Listo',         'ALTA_STOCK'),

  -- R-PAV-REF (3)
  ('R-PAV-REF', 1, 'Ensamblado',    'DESCONTAR_BOM'),
  ('R-PAV-REF', 2, 'Estabilizando', 'NINGUNO'),
  ('R-PAV-REF', 3, 'Listo',         'ALTA_STOCK'),

  -- R-CUC-REF (3)
  ('R-CUC-REF', 1, 'Ensamblado',    'DESCONTAR_BOM'),
  ('R-CUC-REF', 2, 'Estabilizando', 'NINGUNO'),
  ('R-CUC-REF', 3, 'Listo',         'ALTA_STOCK'),

  -- R-SUN-PED (2) — bajo pedido: sin alta de stock (genera_stock=false)
  ('R-SUN-PED', 1, 'Preparado', 'DESCONTAR_BOM'),
  ('R-SUN-PED', 2, 'Entregado', 'NINGUNO'),

  -- R-MAL-PED (2)
  ('R-MAL-PED', 1, 'Preparado', 'DESCONTAR_BOM'),
  ('R-MAL-PED', 2, 'Entregado', 'NINGUNO'),

  -- R-CRZ-PED (2)
  ('R-CRZ-PED', 1, 'Preparado', 'DESCONTAR_BOM'),
  ('R-CRZ-PED', 2, 'Entregado', 'NINGUNO')
on conflict (ruta_id, orden) do nothing;

-- ---------------------------------------------------------------------------
-- B.4) Retrofit de products — SOLO para productos con figura mapeada
-- (figuras.product_id, Producción v2). Pisa únicamente los campos NULL
-- (idempotente y no destructivo: si alguien ya asignó una ficha manual, no
-- se sobreescribe). El resto de products queda con familia/ruta_id/
-- modo_stock/estado_ficha en null — ficha pendiente, sin inventar valores.
-- ---------------------------------------------------------------------------
update products set
  ruta_id      = coalesce(ruta_id, 'R-FIG-CONG'),
  familia      = coalesce(familia, 'Figura'),
  modo_stock   = coalesce(modo_stock, 'PRODUCIR_PARA_STOCK'),
  estado_ficha = coalesce(estado_ficha, 'ACTIVO')
where id in (select distinct product_id from figuras where product_id is not null);

-- ---------------------------------------------------------------------------
-- B.5) Familias en catalog_values — NO SE HACE (shape no calza). El CHECK de
-- catalog_values.categoria (schema-v5.sql) es CERRADO a
-- ('sabor_frutal','sabor_cremoso','salsa','pago') — no incluye una categoría
-- 'familia'. Ampliar ese CHECK es un cambio de esquema fuera del alcance
-- "Etapa A: SOLO DDL de rutas + seed" de este archivo (tocaría una tabla
-- ajena con una migración de CHECK, no de creación). Se deja anotado acá en
-- vez de forzarlo: products.familia queda como TEXTO LIBRE (sin FK) hasta
-- que se decida si 'familia' se cierra en catalog_values o en tabla propia.
-- Nombres de familia (verbatim del CSV, columna `familia`, para cuando se
-- resuelva el punto anterior): Momo Cake, Cheesecake, Cheesecake Momo (ver
-- catalogo-derivados/cheesecake-momo.md — familia nueva, aún sin SKUs en el
-- CSV principal), Pavé MOMOS, Cuchareable MOMOS, Sundae MOMOS, Malteada
-- MOMOS, Crazy Rush, Yogurt Bites, Figura (retrofit, no viene del CSV).
-- ---------------------------------------------------------------------------

-- ============================================================================
-- C) RLS — mismo patrón EXACTO que sedes-v1.sql: deny-by-default (ya activo
-- globalmente desde schema-v5.sql, se activa acá explícito porque las tablas
-- nacen después de ese bloque genérico) + admin_all + staff_read. Sin
-- política de insert/update staff: catálogo de referencia, se edita por
-- admin o por RPC cuando llegue la Etapa B.
-- ============================================================================

alter table rutas       enable row level security;
alter table ruta_pasos  enable row level security;
alter table ruta_estados enable row level security;

drop policy if exists admin_all on rutas;
create policy admin_all on rutas for all
  using (current_rol() = 'Administrador') with check (current_rol() = 'Administrador');
drop policy if exists staff_read on rutas;
create policy staff_read on rutas for select using (is_staff());

drop policy if exists admin_all on ruta_pasos;
create policy admin_all on ruta_pasos for all
  using (current_rol() = 'Administrador') with check (current_rol() = 'Administrador');
drop policy if exists staff_read on ruta_pasos;
create policy staff_read on ruta_pasos for select using (is_staff());

drop policy if exists admin_all on ruta_estados;
create policy admin_all on ruta_estados for all
  using (current_rol() = 'Administrador') with check (current_rol() = 'Administrador');
drop policy if exists staff_read on ruta_estados;
create policy staff_read on ruta_estados for select using (is_staff());
