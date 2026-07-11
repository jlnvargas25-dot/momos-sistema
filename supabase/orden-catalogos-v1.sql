-- ============================================================
-- orden_catalogos_v1 — El orden de las listas editables es parte del dato
-- (mismo diseño que catalog_values.orden).
--
-- Fix de revisión adversarial Fase 3 slice 2: el orden alfabético del server
-- rompía defaults operativos del front:
--   · figura default de "Nuevo lote": Lizi (gata) → Danna (perra) con producto gatito
--   · proveedor default de Domicilios: Picap → Mensajeros Urbanos
--   · primer topping del picker: Oreo → Almendras
-- ============================================================

alter table public.figuras add column if not exists orden smallint not null default 0;
alter table public.toppings add column if not exists orden smallint not null default 0;
alter table public.proveedores_domicilio add column if not exists orden smallint not null default 0;

update public.figuras set orden = v.o
  from (values ('Lizi',0),('Momo',1),('Toby',2),('Teo',3),('Max',4),('Rocco',5),('Danna',6)) as v(n,o)
  where figuras.nombre = v.n;

update public.toppings set orden = v.o
  from (values ('Oreo',0),('M&M',1),('Milo triturado',2),('Chips de chocolate',3),('Maní dulce',4),('Almendras',5)) as v(n,o)
  where toppings.nombre = v.n;

update public.proveedores_domicilio set orden = v.o
  from (values ('Picap',0),('Pibox',1),('Mensajeros Urbanos',2),('Propio',3),('Rappi',4)) as v(n,o)
  where proveedores_domicilio.nombre = v.n;

-- Verificación esperada:
--   select nombre, orden from figuras order by orden;               → Lizi..Danna
--   select nombre, orden from toppings order by orden;              → Oreo..Almendras
--   select nombre, orden from proveedores_domicilio order by orden; → Picap..Rappi
