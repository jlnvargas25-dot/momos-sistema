# Familia Cheesecake Momo — arquitectura estándar (Julián, 2026-07-11)

> Estado: **BORRADOR_TECNICO_V1 / NO_HASTA_VALIDAR** (gramajes se ajustan con prueba piloto
> por sabor — los frutales especialmente: acidez y agua cambian la estabilidad).
> Familia HÍBRIDA priorizada sobre el "cheesecake Oreo clásico" (cheesecake mezclado con
> inclusión) del catálogo base: aprovecha la mousse que ya producimos y hace el producto
> propio de la marca. Complementa a `productos_derivados_momos_ops.csv` /
> `bom_derivados_momos_ops.csv` (familia CHK = versión clásica con inclusión).

## Estructura fija de la familia

**Cheesecake neutro + mousse MOMOS del sabor (CAPA SEPARADA, no mezclada) + crocante +
salsa o ganache + topping + figurita horizontal del sabor.**

La capa separada conserva: sabor/textura de cheesecake, identidad de cada mousse,
producción modular y costeo claro (cada base se descuenta por su lado).

## Fórmula estándar inicial — 270 g + figurita

| Componente                    | Cantidad |
| ----------------------------- | -------: |
| Base crocante (variante)      |     40 g |
| Cheesecake neutro             |    125 g |
| Mousse MOMOS del sabor        |     75 g |
| Salsa o ganache compatible    |     20 g |
| Topping del sabor             |     10 g |
| **Producto base**             | **270 g** |
| Figurita horizontal del sabor | **1 und** |

Consumo por SKU (unidad de inventario):
`0.040 kg crocante específico · 0.125 kg cheesecake neutro · 0.075 kg mousse del sabor ·
0.020 kg salsa/ganache específica · 0.010 kg topping específico · 1 figurita FIG-HOR-*`

## Montaje estándar

1. 40 g de crocante al fondo → 2. capa de cheesecake neutro → 3. 75 g de mousse MOMOS →
4. cubrir con el resto del cheesecake → 5. refrigerar hasta estabilizar → 6. salsa/ganache →
7. topping → 8. figurita horizontal → 9. empacar, conservar refrigerado.

Variante visual: crocante → cheesecake → mousse → cheesecake → ganache → topping.

## Ruta térmica

En recipiente individual: `ENSAMBLAR → REFRIGERAR → ESTABILIZAR → DECORAR → FIGURITA →
EMPACAR` (ruta C / R-CHK-REF). NO lleva congelación completa; congelación técnica corta
solo si hubiera que desmoldar.

## SKUs (11, uno por sabor)

`CHK-MOMO-ORE-270 · CHK-MOMO-NUT-270 · CHK-MOMO-MIL-270 · CHK-MOMO-MYM-270 ·
CHK-MOMO-CAR-270 · CHK-MOMO-MAR-270 · CHK-MOMO-LIM-270 · CHK-MOMO-BAN-270 ·
CHK-MOMO-DUR-270 · CHK-MOMO-COC-270 · CHK-MOMO-MGB-270`

## Variantes por sabor

| Sabor           | Crocante                  | Mousse             | Salsa                 | Topping             |
| --------------- | ------------------------- | ------------------ | --------------------- | ------------------- |
| Oreo            | Oreo                      | Mousse Oreo        | Ganache chocolate     | Oreo triturada      |
| Nutella         | Galleta chocolate         | Mousse Nutella     | Salsa Nutella/ganache | Avellana            |
| Milo            | Galleta chocolate         | Mousse Milo        | Ganache               | Milo o chips        |
| M&M             | Galleta chocolate         | Mousse M&M         | Ganache               | Mini M&M            |
| Caramelo salado | Saltín o galleta vainilla | Mousse caramelo    | Caramelo salado       | Crocante            |
| Maracuyá        | Galleta vainilla          | Mousse maracuyá    | Salsa maracuyá        | Pulpa o crocante    |
| Limón           | Galleta vainilla          | Mousse limón       | Salsa limón           | Ralladura o galleta |
| Banano          | Galleta vainilla          | Mousse banano      | Caramelo              | Banano crocante     |
| Durazno         | Galleta vainilla          | Mousse durazno     | Salsa durazno         | Cubitos de durazno  |
| Coco            | Galleta vainilla/coco     | Mousse coco        | Leche condensada      | Coco rallado        |
| Mango biche     | Galleta neutra            | Mousse mango biche | Salsa mango           | Mango o toque ácido |

## Diferencia entre versiones (posicionamiento)

| Producto                 | Composición                                            |
| ------------------------ | ------------------------------------------------------ |
| Cheesecake Oreo clásico  | Cheesecake neutro mezclado con Oreo (familia CHK CSV)  |
| **Cheesecake Momo Oreo** | Cheesecake neutro + capa separada de mousse MOMOS Oreo |
| Momo Cake Oreo           | Mousse MOMOS Oreo como componente principal            |

## Mapa contra el sistema (2026-07-11)

**Ya existe como subreceta viva (WAC):** cheesecake neutro (SR12/I54), ganache (SR13/I05),
las 11 mousses (SR01–SR11), salsa maracuyá (SR15), salsa caramelo salado (SR14), salsa
leche condensada (SR19).

**Falta construir (entra al slice "rutas por familia"):** crocantes variantes (Oreo,
chocolate, Saltín, vainilla — hoy solo crocante neutro SR20), salsas nuevas (Nutella,
limón, banano/caramelo, durazno, mango), toppings como componente PESADO del BOM (hoy
las adiciones son otro mecanismo, por unidad), figuritas FIG-HOR-* como semiterminado
POR UNIDAD (producir_subreceta trabaja por gramos), y los campos de ficha de producto
(familia, ruta, momento_descuento, conservación, modo_stock, estado técnico).
