-- ============================================================================
-- MOMOS OPS — Seed de CATÁLOGOS (Fase 1, migración maqueta → Supabase)
-- Fuente de verdad del esquema: supabase/schema-v5.sql
-- Fuente de datos: src/MomosOps.jsx → seedUsers() (líneas 204-210, EXCLUIDA de
--   este archivo) y seedDb() (líneas 212-523), en especial:
--   settings.counters/zonas/figuras/toppings/pagos/proveedores/sabores/salsas
--   (líneas 214-242), products (246-261), inventory_items (317-332),
--   recipes (375-389), combo_components vía products[].componentProductIds.
--
-- ALCANCE — SOLO catálogos, en orden FK-seguro:
--   counters, figuras, zonas, franjas, inventory_cats, product_cats,
--   proveedores_domicilio, moldes, ubicaciones_frio, catalog_values,
--   app_settings, toppings, inventory_items, products, combo_components, recipes.
--
-- EXCLUIDO a propósito (datos operativos/demo, no catálogo): users (ya
--   poblada con U01/U02 reales — NO se insertan los usuarios demo U01-U03 de
--   la maqueta), customers, orders, order_items, benefits, production_batches,
--   deliveries, claims, evidences, audit_logs, campaigns, creatives,
--   content_posts, marketing_*, brand_library, metrics_daily,
--   recommendations, production_suggestions, inventory_reservations,
--   inventory_movements.
--
-- Idempotente: todo INSERT usa ON CONFLICT DO NOTHING (re-ejecutable).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- counters
-- Sembrado con el MÁXIMO usado por la semilla completa de la maqueta
-- (settings.counters, MomosOps.jsx:214), aunque varias de estas claves
-- correspondan a tablas operativas EXCLUIDAS de este archivo: counters es
-- transversal (la usa next_id() para TODAS las tablas), no solo catálogo.
-- ---------------------------------------------------------------------------
insert into counters (clave, valor) values
  ('order', 1045),
  ('customer', 8),
  ('batch', 18),
  ('claim', 32),
  ('benefit', 13),
  ('delivery', 224),
  ('movement', 7),
  ('evidence', 10),
  ('audit', 5),
  ('suggestion', 2),
  ('item', 9),
  ('recipe', 13),
  ('invitem', 14),
  ('reservation', 0),
  ('user', 3),
  ('campaign', 4),
  ('creative', 8),
  ('calendar', 6),
  ('result', 5),
  ('idea', 12),
  ('guion', 5),
  ('mensaje', 12),
  ('tarea', 8),
  ('frase', 6),
  ('product', 15)
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- figuras
-- settings.figuras (MomosOps.jsx:228-236). DISCREPANCIA: la maqueta trae
-- gramaje como texto "150 g" / "280 g"; el schema pide gramaje_g integer
-- (línea 68) — se parsea el número y se descarta la unidad (siempre "g").
--
-- (Producción v2) gramaje_g refleja los pesos OFICIALES de la spec aprobada
-- (ver rpc-produccion-v2.sql sección A.1). product_id NO va en este INSERT
-- a propósito: figuras se siembra ANTES que products en el orden FK-seguro
-- de este archivo (ver header, línea 11), así que 'PR01' todavía no existiría
-- como fila de products en este punto del script — el UPDATE que asigna
-- product_id va más abajo, inmediatamente después de sembrar products.
-- OJO: este INSERT usa ON CONFLICT DO NOTHING — en una base YA sembrada no
-- pisa filas existentes; los UPDATE de rpc-produccion-v2.sql son los que
-- aplican el cambio de datos ahí. Este seed solo importa para deploys frescos.
-- ---------------------------------------------------------------------------
insert into figuras (nombre, especie, gramaje_g, activo) values
  ('Lizi',  'gato',  150, true),
  ('Momo',  'gato',  180, true),
  ('Toby',  'gato',  180, true),
  ('Teo',   'gato',  250, true),
  ('Max',   'perro', 180, true),
  ('Rocco', 'perro', 180, true),
  ('Danna', 'perro', 180, true)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------------
-- zonas
-- settings.zonas (MomosOps.jsx:215-220)
-- ---------------------------------------------------------------------------
insert into zonas (nombre, tarifa) values
  ('Zona 1 · El Caney / Ingenio / Limonar', 5000),
  ('Zona 2 · Ciudad Jardín / Valle del Lili', 7000),
  ('Zona 3 · Sur amplio / Ciudad 2000 / Capri', 9000),
  ('Zona 4 · Norte / Oeste / Pance alto', 14000)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------------
-- franjas
-- sin datos en la maqueta (tabla nueva del esquema v5, gancho ORQUESTACIÓN
-- BACKLOG roadmap #11 — schema-v5.sql líneas 77-85). Nada que sembrar.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- inventory_cats
-- Valores DISTINCT de inventory_items[].cat en la semilla (MomosOps.jsx:317-332)
-- ---------------------------------------------------------------------------
insert into inventory_cats (nombre, activo) values
  ('Ingredientes', true),
  ('Bases de mousse', true),
  ('Salsas', true),
  ('Rellenos', true),
  ('Ganache', true),
  ('Mezcla de crepa', true),
  ('Granizados', true),
  ('Cajas', true),
  ('Vasos', true),
  ('Stickers', true),
  ('Empaques térmicos', true),
  ('Cucharas', true)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------------
-- product_cats
-- Valores DISTINCT de products[].cat en la semilla (MomosOps.jsx:246-261)
-- ---------------------------------------------------------------------------
insert into product_cats (nombre, activo) values
  ('Momos Signature', true),
  ('Cajas y Combos', true),
  ('Momos Cuchara', true),
  ('Momos Antojos', true),
  ('Momos Bebidas', true)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------------
-- proveedores_domicilio
-- settings.proveedores (MomosOps.jsx:238)
-- ---------------------------------------------------------------------------
insert into proveedores_domicilio (nombre, activo) values
  ('Picap', true),
  ('Pibox', true),
  ('Mensajeros Urbanos', true),
  ('Propio', true),
  ('Rappi', true)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------------
-- moldes
-- sin datos en la maqueta (gancho Fase 2, schema-v5.sql línea 92 — "el
-- usuario siembra su lista", nota de migración #11). Nada que sembrar.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ubicaciones_frio
-- sin datos en la maqueta como catálogo propio (gancho Fase 2, schema-v5.sql
-- línea 93). Los valores "Nevera 1", "Congelador A", etc. que aparecen en
-- inventory_items[].ubicacion (MomosOps.jsx:317-332) son texto libre en la
-- maqueta, no un catálogo cerrado — no se migran acá para no inventar un
-- catálogo que el usuario no definió explícitamente. Nada que sembrar.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- catalog_values (sabor_frutal, sabor_cremoso, salsa, pago)
-- SABORES_FRUTALES / SABORES_CREMOSOS (MomosOps.jsx:69-70), settings.salsas
-- (línea 223), settings.pagos (línea 237).
-- DISCREPANCIA: categoria CHECK del schema (línea 97-98) NO incluye
-- 'proveedor'/'origen' — ya migraron a tabla propia (proveedores_domicilio)
-- según el propio comentario del schema. No se intenta sembrar esas dos
-- categorías acá.
-- ---------------------------------------------------------------------------
insert into catalog_values (categoria, valor, orden, activo) values
  ('sabor_frutal', 'Mango biche', 0, true),
  ('sabor_frutal', 'Coco', 1, true),
  ('sabor_frutal', 'Maracuyá', 2, true),
  ('sabor_frutal', 'Limón', 3, true),
  ('sabor_frutal', 'Banano', 4, true),
  ('sabor_frutal', 'Durazno', 5, true),
  ('sabor_cremoso', 'M&M', 0, true),
  ('sabor_cremoso', 'Oreo', 1, true),
  ('sabor_cremoso', 'Caramelo salado', 2, true),
  ('sabor_cremoso', 'Nutella', 3, true),
  ('sabor_cremoso', 'Milo', 4, true),
  ('salsa', 'Frutos rojos', 0, true),
  ('salsa', 'Chocolate', 1, true),
  ('salsa', 'Arequipe', 2, true),
  ('salsa', 'Maracuyá', 3, true),
  ('salsa', 'Lechera', 4, true),
  ('pago', 'Nequi', 0, true),
  ('pago', 'Daviplata', 1, true),
  ('pago', 'Bancolombia', 2, true),
  ('pago', 'Rappi (app)', 3, true)
on conflict (categoria, valor) do nothing;

-- ---------------------------------------------------------------------------
-- app_settings
-- Config escalar de settings que no encaja en tabla propia (MomosOps.jsx:221,
-- 224, 239-241). relleno_fijo va acá porque RELLENOS es un array de 1 solo
-- valor constante (línea 73) — no una lista editable como sabores/salsas.
-- ---------------------------------------------------------------------------
insert into app_settings (clave, valor) values
  ('pedido_minimo', '25000'),
  ('pauta_mensual', '350000'),
  ('horas_congelacion', '10'),
  ('relleno_fijo', '"Cheesecake con ganache"'),
  ('politicas', '"MOMOS no despacha ningún pedido sin pago confirmado: se requiere comprobante de transferencia (Nequi, Daviplata o Bancolombia) o el pago dentro de la app de Rappi. No se aceptan pagos en efectivo contra entrega. Reclamos por estado del producto: máximo 20 minutos después de recibido, salvo calidad o inocuidad. Un beneficio por pedido, no acumulable, no aplica sobre domicilio."')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- toppings
-- TOPPINGS (MomosOps.jsx:77-84). DISCREPANCIA: insumoId viene como string
-- vacío "" en TODOS los toppings de la semilla (ninguno liga a un insumo
-- real todavía) — se traduce a NULL para respetar el FK a inventory_items.
-- ---------------------------------------------------------------------------
insert into toppings (nombre, precio, insumo_id, insumo_cant, activo) values
  ('Oreo', 0, null, 1, true),
  ('M&M', 0, null, 1, true),
  ('Milo triturado', 0, null, 1, true),
  ('Chips de chocolate', 0, null, 1, true),
  ('Maní dulce', 0, null, 1, true),
  ('Almendras', 0, null, 1, true)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------------
-- inventory_items
-- inventory_items (MomosOps.jsx:317-332). `min` de la maqueta → `minimo`
-- (palabra reservada evitada, ver schema-v5.sql:119). `vence`/`compra` con
-- string vacío "" en la maqueta → NULL (columnas date). `proveedor`/
-- `ubicacion` con texto libre tal cual (no son catálogos cerrados en el
-- schema: columnas text default '').
-- ---------------------------------------------------------------------------
insert into inventory_items (id, nombre, cat, unidad, stock, minimo, costo, proveedor, vence, ubicacion, compra) values
  ('I01', 'Crema de leche 1 L',       'Ingredientes',      'L',   8,    6,  11500, 'Distribuidora La Vaquita', current_date + 9,   'Nevera 1',        current_date - 4),
  ('I02', 'Base mousse maracuyá',     'Bases de mousse',   'kg',  2.5,  3,  18000, 'Producción propia',       current_date + 5,   'Congelador A',    current_date - 2),
  ('I03', 'Salsa frutos rojos',       'Salsas',            'L',   1.2,  1,  22000, 'Producción propia',       current_date + 7,   'Nevera 2',        current_date - 3),
  ('I04', 'Nutella 3 kg',             'Rellenos',          'kg',  1.8,  1,  32000, 'Makro',                   current_date + 120, 'Estante seco',    current_date - 10),
  ('I05', 'Ganache de chocolate',     'Ganache',           'kg',  0.8,  1,  26000, 'Producción propia',       current_date + 4,   'Nevera 2',        current_date - 2),
  ('I06', 'Mezcla de crepa',          'Mezcla de crepa',   'L',   3,    2,  9000,  'Producción propia',       current_date + 3,   'Nevera 1',        current_date - 1),
  ('I07', 'Pulpa mango biche',        'Granizados',        'kg',  4,    2,  8500,  'Galería Alameda',         current_date + 20,  'Congelador B',    current_date - 5),
  ('I08', 'Caja regalo x3',           'Cajas',             'und', 9,    8,  3200,  'Empaques del Valle',      null,                'Estante empaques', current_date - 15),
  ('I13', 'Caja regalo x4',           'Cajas',             'und', 5,    6,  3800,  'Empaques del Valle',      null,                'Estante empaques', current_date - 15),
  ('I14', 'Caja premium x6',          'Cajas',             'und', 2,    4,  5200,  'Empaques del Valle',      null,                'Estante empaques', current_date - 15),
  ('I09', 'Vaso cuchareable 9 oz',    'Vasos',             'und', 38,   40, 650,   'Empaques del Valle',      null,                'Estante empaques', current_date - 15),
  ('I10', 'Sticker logo Sweet Love',  'Stickers',          'und', 120,  50, 180,   'Litografía Sol',          null,                'Cajón 2',          current_date - 25),
  ('I11', 'Bolsa térmica mediana',    'Empaques térmicos', 'und', 6,    8,  2800,  'Empaques del Valle',      null,                'Estante empaques', current_date - 15),
  ('I12', 'Cucharas de bambú',        'Cucharas',          'und', 90,   40, 220,   'EcoPack',                 null,                'Cajón 2',          current_date - 20)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- products
-- products (MomosOps.jsx:246-261). precio_rappi usa el valor EXPLÍCITO de
-- la semilla (no el fallback ×1.25 documentado en el schema — la semilla ya
-- trae precios concretos, algunos distintos de precio×1.25 exacto).
-- `desc` de la maqueta → `descr`. `atributos` NO se inserta: es derivado
-- (schema-v5.sql:175-178, función atributos_de_tipo). especie solo en momo.
-- combo_size/empaque_item_id solo en combos (PR05-07).
-- ---------------------------------------------------------------------------
insert into products (id, nombre, cat, tipo, especie, precio, precio_rappi, costo, stock, prep, frio, lejano, activo, descr, combo_size, empaque_item_id) values
  ('PR01', 'Momo Gatito 150 g',              'Momos Signature', 'momo',  'gato',  18000, 23000, 6800,  8,    20, true,  false, true, 'Figura de mousse helado en forma de gatito, base crocante y salsa a elección.', null, null),
  ('PR02', 'Momo Perrito 150 g',             'Momos Signature', 'momo',  'perro', 18000, 23000, 6800,  6,    20, true,  false, true, 'Figura de mousse helado en forma de perrito, base crocante y salsa a elección.', null, null),
  ('PR03', 'Momo grande 190 g',              'Momos Signature', 'momo',  'gato',  23000, 29000, 8900,  4,    25, true,  false, true, 'Momo de 190 g con doble salsa y relleno a elección.', null, null),
  ('PR04', 'Momo premium 280 g',             'Momos Signature', 'momo',  'gato',  32000, 39000, 12500, 3,    30, true,  false, true, 'Momo premium 280 g con relleno doble, ideal para regalo.', null, null),
  ('PR05', 'Caja x3 Momos',                  'Cajas y Combos',  'combo', null,    49000, 59000, 22500, null, 35, true,  false, true, 'Caja regalo con 3 momos surtidos, sticker y lazo. Disponibilidad según momos y cajas.', 3, 'I08'),
  ('PR06', 'Caja x4 Momos',                  'Cajas y Combos',  'combo', null,    63000, 75000, 29500, null, 40, true,  false, true, 'Caja regalo con 4 momos surtidos.', 4, 'I13'),
  ('PR07', 'Caja x6 Momos',                  'Cajas y Combos',  'combo', null,    89000, 105000, 43000, null, 45, true, false, true, 'Caja premium con 6 momos surtidos para celebraciones.', 6, 'I14'),
  ('PR08', 'Cheesecake Momo cuchareable',    'Momos Cuchara',   'momo',  'gato',  15000, 19000, 5200,  12,   10, true,  true,  true, 'Cheesecake en vaso con figurita horizontal y salsa.', null, null),
  ('PR09', 'Crepa Momo Nutella',             'Momos Antojos',   'pedido', null,   14000, 18000, 4800,  null, 12, false, true,  true, 'Crepa con Nutella, banano y topping de momo mini. Se prepara al momento.', null, null),
  ('PR10', 'Crepa Momo Oreo',                'Momos Antojos',   'pedido', null,   14000, 18000, 4600,  null, 12, false, true,  true, 'Crepa con crema de Oreo y galleta triturada. Se prepara al momento.', null, null),
  ('PR11', 'Malteada Oreo Momo',             'Momos Bebidas',   'pedido', null,   13000, 16500, 4200,  null, 8,  true,  false, true, 'Malteada cremosa de Oreo con crema batida.', null, null),
  ('PR12', 'Malteada Nutella Momo',          'Momos Bebidas',   'pedido', null,   13500, 17000, 4500,  null, 8,  true,  false, true, 'Malteada de Nutella con crema y chocolate rallado.', null, null),
  ('PR13', 'Granizado de maracuyá',          'Momos Bebidas',   'pedido', null,   9000,  12000, 2600,  null, 6,  true,  false, true, 'Granizado natural de maracuyá.', null, null),
  ('PR14', 'Granizado de mango biche',       'Momos Bebidas',   'pedido', null,   9000,  12000, 2600,  null, 6,  true,  false, true, 'Granizado de mango biche con sal y limón opcional.', null, null),
  ('PR15', 'Granizado de durazno',           'Momos Bebidas',   'pedido', null,   9000,  12000, 2600,  null, 6,  true,  false, true, 'Granizado dulce de durazno.', null, null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- figuras.product_id (Producción v2)
-- Mapeo figura→producto de la spec aprobada. Va ACÁ (no en el INSERT de
-- figuras de más arriba) porque products recién existe a partir de este
-- punto del script — ver nota en el bloque de figuras. UPDATE en vez de
-- INSERT ... ON CONFLICT porque la columna se rellena sobre filas ya
-- sembradas, no se crean filas nuevas. Idempotente por naturaleza (un UPDATE
-- que fija siempre el mismo valor final es re-ejecutable sin efectos extra).
-- PR03/PR08 quedan SIN figura a propósito (decisión de la spec: no
-- producibles desde el form de corrida hasta que se les asigne figura).
-- ---------------------------------------------------------------------------
update figuras set product_id = 'PR01' where nombre in ('Lizi','Momo','Toby');
update figuras set product_id = 'PR02' where nombre in ('Max','Rocco','Danna');
update figuras set product_id = 'PR04' where nombre = 'Teo';

-- ---------------------------------------------------------------------------
-- combo_components
-- products[].componentProductIds (MomosOps.jsx:250-252): PR05/06/07 →
-- ["PR01","PR02"]. DISCREPANCIA: la maqueta modela esto como "qué productos
-- PUEDEN entrar en la caja" (2 opciones para elegir surtido), no como una
-- lista fija de componentes con cantidad — se porta tal cual la relación
-- combo→producto elegible; el schema no tiene columna de cantidad en
-- combo_components (PK compuesta combo_id+component_id, schema-v5.sql:180-184).
-- ---------------------------------------------------------------------------
insert into combo_components (combo_id, component_id) values
  ('PR05', 'PR01'), ('PR05', 'PR02'),
  ('PR06', 'PR01'), ('PR06', 'PR02'),
  ('PR07', 'PR01'), ('PR07', 'PR02')
on conflict (combo_id, component_id) do nothing;

-- ---------------------------------------------------------------------------
-- recipes
-- recipes (MomosOps.jsx:375-389). productId/itemId → product_id/item_id.
-- ---------------------------------------------------------------------------
insert into recipes (id, product_id, item_id, cantidad) values
  ('RC01', 'PR01', 'I01', 0.12),
  ('RC02', 'PR01', 'I02', 0.09),
  ('RC03', 'PR01', 'I03', 0.03),
  ('RC04', 'PR01', 'I10', 1),
  ('RC05', 'PR08', 'I01', 0.08),
  ('RC06', 'PR08', 'I09', 1),
  ('RC07', 'PR08', 'I12', 1),
  ('RC08', 'PR09', 'I06', 0.15),
  ('RC09', 'PR09', 'I04', 0.05),
  ('RC10', 'PR11', 'I01', 0.15),
  ('RC11', 'PR11', 'I09', 1),
  ('RC12', 'PR14', 'I07', 0.2),
  ('RC13', 'PR14', 'I09', 1)
on conflict (id) do nothing;

COMMIT;
