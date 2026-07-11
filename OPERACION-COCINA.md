# OPERACIÓN DE COCINA — documento maestro operativo de MOMOS OPS

> Fuente: Julián, 2026-07-11. **Arquitectura objetivo del módulo de producción.**
> Recetas y gramajes detallados: ver [`RECETAS.md`](RECETAS.md). Este doc define CÓMO produce la
> cocina y cómo debe modelarlo el sistema: **componentes comunes + BOM por producto + ruta
> operativa por familia.**

## 1. Modelo de niveles (cómo debe entender la cocina el sistema)

El sistema trabaja con **componentes**, no solo con productos finales.

| Nivel                | Qué significa              | Ejemplo                                           |
| -------------------- | -------------------------- | ------------------------------------------------- |
| **Ingrediente**      | Materia prima individual   | crema de leche, mango, Oreo, grenetina            |
| **Base / subreceta** | Preparación madre por kilo | mousse maracuyá, mousse Oreo, cheesecake, ganache |
| **Componente**       | Parte usada en un producto | relleno 20 g cheesecake, 15 g ganache             |
| **Producto final**   | Lo que se vende            | Lizi, Momo, Teo, Momo Cake, parfait               |
| **Formato**          | Gramaje y presentación     | 150 g, 180 g, 250 g, 270 g + figurita             |

Separación obligatoria por producto:
- **Receta/BOM** = qué componentes consume.
- **Ruta de producción** = qué pasos sigue.
- **Estado operativo** = en qué punto real está.

## 2. Figuras, gramajes y fórmula de mousse

Pesos oficiales y composición: ver [`RECETAS.md`](RECETAS.md). Regla FIJA para el sistema:

**Mousse necesaria = peso final de figura − 35 g de relleno** (20 g cheesecake + 15 g ganache)

→ Lizi 150 g = 115 g mousse · estándar 180 g = 145 g · Teo 250 g = 215 g.

## 3. Líneas oficiales activas

- **Frutal (6):** Mango biche, Coco, Maracuyá, Limón, Banano, Durazno.
- **Cremosa (5):** M&M, Oreo, Caramelo salado, Nutella, Milo.
- **Línea de autor: PAUSADA** — no entra como línea activa de producción hasta que las pruebas salgan estables.

## 3b. Portafolio — estado oficial (2026-07-11)

**✅ Activo (lanzamiento):** Figuras MOMOS rellenas · Momo Cake · Cheesecake · Pavé MOMOS ·
Cuchareables/parfaits · Sundae MOMOS · Malteadas · Frappés/Crazy Rush · Yogurt bites.

**⏸️ En espera (`EN_ESPERA` / desarrollo futuro):** Crepas · Sándwiches calientes · Paletas —
no disponibles para venta, sin producción activa, sin reserva ni descuento de inventario, fuera
del lanzamiento inicial; **conservados en el roadmap para reactivarlos** más adelante.

**⛔ Descartados por ahora:** Tiramisú · Bowl MOMOS · Tartaletas.

> **Cómo lo modela el sistema HOY:** los productos en espera que ya existían en el catálogo van a
> `products.activo = false` (aplicado 2026-07-11: PR09/PR10 crepas — soft-delete reversible, el
> historial de pedidos queda intacto); los que no existen aún NO se crean hasta activarse. El campo
> fino de estado de portafolio (`EN_ESPERA`/`DESARROLLO_FUTURO`) llega con la ficha de producto (§11).
> Pavé MOMOS y Sundae MOMOS entran al portafolio activo SIN ficha todavía (§12).

## 4. Recetas maestras y cálculos que debe hacer el sistema

Todas las recetas se cargan **por 1000 g** (ver RECETAS.md). El sistema calcula:

| Cálculo                    | Ejemplo                                 |
| -------------------------- | --------------------------------------- |
| Cuánta mousse necesito     | 10 Momos de 180 g = 10 × 145 g = 1450 g |
| Cuánto cheesecake necesito | 10 unidades × 20 g = 200 g              |
| Cuánto ganache necesito    | 10 unidades × 15 g = 150 g              |
| Cuánto producir con merma  | 1450 g + 8% merma = 1566 g              |

**Merma estándar** (campo recomendado por tipo de preparación):

| Tipo de preparación  | Merma sugerida |
| -------------------- | -------------: |
| Mousse frutal        |        5% a 8% |
| Mousse cremosa       |        4% a 6% |
| Cheesecake           |        3% a 5% |
| Ganache              |        2% a 4% |
| Salsas               |             5% |
| Decoración / topping |       5% a 10% |

## 5. Productos derivados (formato 270 g + figurita)

Momo Cake, cheesecake frío, cuchareables/parfaits, tiramisú Momo, tartaletas frías, bowls/sundaes:

**En el sistema se carga como: 270 g de producto base + figura decorativa VARIABLE (adicional).
NO como 315 g totales.** (Si la figurita pesa 45 g, el total comercial es 315 g.)

Fórmulas estándar por producto: ver [`RECETAS.md`](RECETAS.md) §8.

## 6. Subrecetas compartidas = lotes independientes de inventario

| Subreceta común         | Usos                                            |
| ----------------------- | ----------------------------------------------- |
| Mousse frutal o cremoso | Figuras, Momo Cake, cheesecake, parfaits        |
| Cheesecake              | Relleno de figuras, capa, vasitos               |
| Ganache                 | Relleno, capa, cobertura o topping              |
| Salsas                  | Decoración, centro, capa o bebida               |
| Crocante de galleta     | Cake, cheesecake, parfait, tartaleta            |
| Figurita decorativa     | Cakes, cheesecake y cuchareables                |

Estas preparaciones existen como **lotes propios en inventario**; cada producto consume cantidades
de ellas según su BOM.

## 7. Flujo de producción (etapas de cocina)

| Etapa                         | Qué ocurre                                       |
| ----------------------------- | ------------------------------------------------ |
| 1. Mise en place              | Se pesan ingredientes y se preparan moldes       |
| 2. Producción de bases        | Se preparan mousses, cheesecake, ganache, salsas |
| 3. Porcionado                 | Se pesan cantidades por molde/producto           |
| 4. Relleno                    | Se agrega cheesecake y ganache según ficha       |
| 5. Moldeado                   | Se completa con mousse                           |
| 6. Congelación                | 8 a 12 horas recomendadas                        |
| 7. Desmolde                   | Solo cuando esté completamente congelado         |
| 8. Decoración                 | Pintura, baño, topping, figuritas                |
| 9. Empaque                    | Caja individual, caja surtida o producto evento  |
| 10. Inventario disponible     | Producto pasa a stock listo                      |
| 11. Venta / despacho          | Se descuenta del inventario                      |

## 8. Estados de producción (objetivo)

| Estado                   | Significado                              |
| ------------------------ | ---------------------------------------- |
| Planificado              | Producción programada                    |
| En preparación           | Ingredientes pesados / mezcla en proceso |
| Moldeado                 | Producto ya está en molde                |
| Congelando               | En congelador, todavía no disponible     |
| Listo para desmoldar     | Cumplió tiempo mínimo                    |
| Desmoldado               | Ya salió del molde                       |
| Decorado                 | Tiene acabado final                      |
| Empacado                 | Listo para vender                        |
| Disponible               | En inventario                            |
| Reservado                | Apartado para pedido                     |
| Vendido                  | Salió del inventario                     |
| Imperfecto               | Sirve para malteadas/parfaits            |
| Descartado               | No apto para venta                       |

> **Mapeo al sistema HOY (Producción v2 en curso):** los 7 estados actuales son un subconjunto:
> `En preparación` (≈ mise en place + moldeado), `Congelando`, `Listo` (≈ desmoldado/disponible —
> el desmolde con conteos ES la transición a Listo), `Reservado`, `Vendido`, `Imperfecto`,
> `Descartado`. Los estados finos (Moldeado, Decorado, Empacado…) llegan con las rutas por familia.

## 9. Rutas operativas por familia

Cada producto necesita una **ruta operativa asignada**:

| Tipo de producto    | Ruta                                          |
| ------------------- | --------------------------------------------- |
| Figuras rellenas    | `FIGURA_MOLDEADA_CONGELADA`                   |
| Momo Cake           | `POSTRE_ENSAMBLADO_CONGELADO`                 |
| Cheesecake frío     | `POSTRE_ENSAMBLADO_REFRIGERADO` o `CONGELADO` |
| Parfait/cuchareable | `POSTRE_EN_VASO_POR_CAPAS`                    |
| Tiramisú Momo       | `POSTRE_EN_VASO_REFRIGERADO`                  |
| Malteada            | `BEBIDA_PREPARADA_AL_PEDIDO`                  |
| Frappé              | `BEBIDA_LICUADA_AL_PEDIDO`                    |
| Yogurt bites        | `BOCADO_MOLDEADO_CONGELADO_Y_BAÑADO`          |

### Ruta: figura rellena 180 g (`FIGURA_MOLDEADA_CONGELADA`)
BOM: mousse del sabor 145 g + cheesecake 20 g + ganache 15 g = 180 g.
Pasos: planificar → verificar bases → molde → capa de mousse → 20 g cheesecake → 15 g ganache →
cerrar con mousse → congelar 8-12 h → desmoldar → revisar acabado/peso → decorar/bañar → empacar →
inventario disponible. Genera unidad terminada almacenable en congelación.

### Ruta: Momo Cake (`POSTRE_ENSAMBLADO_CONGELADO`) — SÍ congela (2026-07-11)
Su estructura principal es la mousse MOMOS → congela para: estabilizar la mousse, mantener las
capas, permitir el desmolde, instalar cobertura y figurita sin deformarlo, y conservarse.
Pasos: base crocante → primera capa de mousse → cheesecake y ganache → cerrar con mousse →
nivelar → **congelar 8-12 h** (según tamaño y congelador) → desmoldar completamente congelado →
cobertura y toppings → figurita CONGELADA → empacar → mantener congelado.
Estados: `ENSAMBLADO → CONGELANDO → LISTO_PARA_DESMOLDAR → DESMOLDADO → DECORADO → EMPACADO →
DISPONIBLE_CONGELADO`.

### Ruta: cheesecake — depende de la PRESENTACIÓN (2026-07-11)
**Regla clave para el sistema: la congelación como PROCESO (técnica, para desmoldar) y la
conservación como ESTADO FINAL son dos campos DISTINTOS de la ficha** —
`CONGELACION_TECNICA_PARA_DESMOLDE` ≠ `CONSERVACION_FINAL_REFRIGERADA`.

1. **En vaso/recipiente (LANZAMIENTO):** se estabiliza en su envase, NO congela, no hay desmolde.
   Pasos: base de galleta → crema cheesecake → Oreo/salsa/sabor → refrigerar hasta estabilizar →
   decorar → figurita cuando esté firme o cerca del despacho → refrigerado.
   Estados: `ENSAMBLADO → REFRIGERANDO/ESTABILIZANDO → DECORADO → EMPACADO → DISPONIBLE_REFRIGERADO`.
2. **Desmoldable:** congelación técnica CORTA solo para facilitar el desmolde; vive refrigerado.
   Pasos: base compactada → cheesecake → refrigerar → congelar hasta firme → desmoldar → decorar →
   **conservación final refrigerada**.
3. **Cheesecake helado estilo MOMOS (híbrido, futuro):** con capa de mousse importante (ej.
   base galleta + cheesecake + mousse Oreo + figurita) → ruta cercana al Momo Cake, congelado.

### Diferencia operativa de congelación (tabla oficial)

| Producto                | ¿Congela?         | Razón                                   | Conservación final |
| ----------------------- | ----------------- | --------------------------------------- | ------------------ |
| Figura MOMOS            | Sí                | Molde, mousse y desmolde                | Congelada          |
| Momo Cake               | Sí                | Mousse principal y desmolde             | Congelada          |
| Cheesecake en vaso      | No necesariamente | Se estabiliza en su envase              | Refrigerada        |
| Cheesecake desmoldable  | Congelación corta | Facilitar desmolde                      | Refrigerada        |
| Cheesecake helado MOMOS | Sí                | Textura congelada e inclusión de mousse | Congelada          |

**Recomendación de LANZAMIENTO (Julián, 2026-07-11):** Momo Cake siempre congelado · Cheesecake
en envase individual de 270 g, refrigerado · **Figurita decorativa: se produce CONGELADA por
separado** y se coloca cuando el cheesecake esté estable; si suelta humedad, colocarla poco antes
del despacho o sobre capa protectora (chocolate, galleta o ganache). Dos rutas distintas — el
cheesecake NO pasa por el proceso de una figura ni de un Momo Cake.

### Ruta: malteada (`BEBIDA_PREPARADA_AL_PEDIDO`)
**Preparada bajo pedido, NO genera stock terminado.** Puede consumir Momo terminado, Momo
imperfecto apto, porción congelada de mousse, leche (150-180 g), salsas, toppings, hielo.
Pasos: pedido → reservar ingredientes → licuar → verificar textura → servir → salsa/topping →
entrega inmediata. Sin moldeado, sin congelación 8-12 h, sin desmolde.
**Descuenta materias primas AL PREPARARSE, no al planificar.**

## 9b. Rutas TÉRMICAS del portafolio (clasificación oficial 2026-07-11)

**Regla madre térmica: congelar un COMPONENTE no significa que el producto final se almacene
congelado.** Cuatro distinciones: congelación esencial del producto · congelación técnica solo
para manipular/desmoldar · refrigeración como conservación final · componentes congelados con
producto ensamblado al momento.

| Producto               | Proceso térmico                              | Conservación final      |
| ---------------------- | -------------------------------------------- | ----------------------- |
| Figuras MOMOS          | Congelación obligatoria                      | Congelado               |
| Momo Cake              | Congelación obligatoria                      | Congelado               |
| Cheesecake en vaso     | Refrigeración                                | Refrigerado             |
| Cheesecake desmoldable | Congelación técnica opcional                 | Refrigerado             |
| Pavé MOMOS             | Refrigeración                                | Refrigerado             |
| Cuchareable/parfait    | Refrigerado o congelado, según fórmula       | Según variante          |
| Sundae MOMOS           | Componentes congelados; montaje al pedido    | Consumo inmediato       |
| Malteada               | Base congelada; licuado al pedido            | Consumo inmediato       |
| Frappé/Crazy Rush      | Hielo y componentes fríos; montaje al pedido | Consumo inmediato       |
| Yogurt bites           | Congelación obligatoria                      | Congelado               |
| Figurita decorativa    | Congelación obligatoria                      | Congelada hasta montaje |

### Las cuatro rutas térmicas (+1)

**A. Congelado de producción y conservación** — figuras, Momo Cake, yogurt bites, figuritas:
`PRODUCIR → CONGELAR → DESMOLDAR → DECORAR → EMPACAR → CONSERVAR_CONGELADO`

**B. Congelación técnica + conservación refrigerada** — cheesecake desmoldable y especiales
que salen de molde:
`ENSAMBLAR → CONGELAR_PARA_DESMOLDE → DESMOLDAR → DECORAR → DESCONGELAR_CONTROLADO → REFRIGERAR`

**C. Refrigerado sin congelación principal** — cheesecake en vaso, Pavé, cuchareable refrigerado:
`ENSAMBLAR → REFRIGERAR → ESTABILIZAR → DECORAR → EMPACAR → CONSERVAR_REFRIGERADO`

**D. Preparado al pedido con componentes congelados** — sundae, malteada:
`PEDIDO → RETIRAR_COMPONENTES → ENSAMBLAR_O_LICUAR → DECORAR → ENTREGAR`

**D2 (quinta lógica). Crazy Rush** — componentes refrigerados + hielo:
`PEDIDO → LICUAR_HIELO_Y_BASE → AÑADIR_MACERADO → DECORAR → ENTREGAR`

### Notas por producto

- **Pavé MOMOS** (ruta C): capas con Saltín + crema; refrigera para que la galleta se humedezca
  e integre — NO congela (no se desmolda y la galleta debe quedar suave).
  `ENSAMBLADO → REFRIGERANDO → REPOSO_DE_CAPAS → DECORADO → FIGURITA → EMPACADO → DISPONIBLE_REFRIGERADO`
- **Cuchareable/parfait — DECISIÓN DE LANZAMIENTO:** existen dos versiones que deben ser
  **dos SKUs distintos** (`CUCHAREABLE_REFRIGERADO` y `CUCHAREABLE_CONGELADO`) — un mismo SKU
  NO puede seguir cualquiera de las dos rutas. **Para el lanzamiento: refrigerado** (cheesecake/
  crema/ganache/salsa/galletas + mousse controlada como capa secundaria o trozos de Momo
  añadidos cerca del despacho).
- **Yogurt bites** (ruta A):
  `MEZCLA → PORCIONADO → CONGELACION → DESMOLDE → BAÑO → ESTABILIZACION → EMPAQUE → DISPONIBLE_CONGELADO`
- **Sundae MOMOS** (ruta D): lo congelado son los COMPONENTES (mousse, trozos de figura,
  imperfectas aptas, figurita) — **el sistema NO crea stock de sundae armado**.
- **Malteada** (ruta D): `PEDIDO → RESERVAR_BASE_CONGELADA → LICUAR → DECORAR → ENTREGAR` —
  no se almacena como producto terminado.
- **Frappé/Crazy Rush** (D2): hielo, sirope, fruta macerada refrigerada, chamoy, Tajín,
  concentrado. **La fruta macerada se guarda refrigerada como SUBRECETA por lote.**
- **Figuritas decorativas** (ruta A, ruta propia): mousse del sabor → dosificar en molde →
  congelar → desmoldar → decorar → guardar CONGELADAS → colocar sobre el producto terminado.
  Sobre postres refrigerados: colocar cuando el postre esté firme, cerca del despacho, o sobre
  barrera de chocolate/galleta/ganache (humedad).

### Campos térmicos que cada ficha debe declarar por separado

| Campo | Ejemplo |
|---|---|
| Método de estabilización | Congelación 8-12 h / refrigeración / ninguno |
| Conservación final | Congelado / refrigerado / consumo inmediato |
| Temperatura del componente | Mousse congelada, macerado refrigerado |
| Momento de ensamblaje | En producción / al despacho / al pedido |
| Necesidad de desmolde | Sí (con o sin congelación técnica) / no |
| Inventario o bajo pedido | Stock terminado / componentes + montaje |

## 10. Regla de inventario — tres momentos de descuento

| Familia                                | Cuándo descuenta                       | Qué genera                                 |
| -------------------------------------- | -------------------------------------- | ------------------------------------------ |
| **Producido para almacenar** (figuras, Momo Cake, cheesecake congelado, paletas) | Al fabricar (ingredientes/subrecetas)  | Unidades terminadas en inventario congelado |
| **Ensamblado con anticipación** (parfaits, cheesecake refrigerado, tiramisú)     | Al ensamblar (componentes)             | Unidades con fecha de producción y vencimiento, refrigeradas |
| **Preparado al pedido** (malteadas, frappés, crepas)                             | Al PREPARAR (reserva con el pedido)    | NO genera stock terminado                   |

## 11. Campos de la ficha de producto (objetivo)

| Campo                    | Ejemplo                              |
| ------------------------ | ------------------------------------ |
| Tipo de producto         | Figura / cake / bebida / cuchareable |
| Ruta de producción       | Figura congelada                     |
| Peso base                | 270 g                                |
| Peso de decoración       | 45 g                                 |
| Peso total comercial     | 315 g                                |
| Conservación             | Congelado / refrigerado              |
| Tiempo de estabilización | 8–12 h                               |
| Requiere molde           | Sí/no                                |
| Requiere desmolde        | Sí/no                                |
| Preparado bajo pedido    | Sí/no                                |
| Componentes (BOM)        | Mousse, cheesecake, ganache…         |
| Punto de descuento       | Producción o preparación             |
| Vida útil                | Según ficha validada                 |
| Control de calidad       | Peso, textura, presentación          |
| Aprovecha imperfectos    | Sí/no                                |

## 12. Fichas pendientes de definir

| Ficha                          | Estado                                       |
| ------------------------------ | -------------------------------------------- |
| Recetas frutales por 1000 g    | ✅ Ya las tenemos                             |
| Recetas cremosas por 1000 g    | ✅ Ya las tenemos                             |
| Cheesecake por 1000 g          | ✅ Ya lo tenemos                              |
| Ganache por 1000 g             | ✅ Ya lo tenemos                              |
| Salsas por 1000 g              | ✅ Ya tenemos varias                          |
| Base crocante sin horno        | ✅ Ya la tenemos                              |
| Figurita decorativa horizontal | ❌ Falta definir peso final real              |
| Malteadas                      | ❌ Falta ficha final                          |
| Frappés / Crazy Rush           | ❌ Falta ficha final                          |
| Yogurt bites                   | ❌ Falta ficha final                          |
| Momo Cake                      | 🟡 Proporción lista, falta proceso oficial   |
| Cheesecake frío                | 🟡 Proporción lista, falta proceso oficial   |
| Parfait / cuchareable          | 🟡 Proporción lista, falta proceso oficial   |
| Pavé MOMOS                     | ❌ Falta ficha (nuevo en portafolio activo)  |
| Sundae MOMOS                   | ❌ Falta ficha (nuevo en portafolio activo)  |
| Tiramisú Momo                  | ⛔ DESCARTADO por ahora (§3b, 2026-07-11)    |
| Sándwich sellado               | ⏸️ EN ESPERA (§3b, 2026-07-11)               |

## 13. Mapeo al roadmap del sistema (arquitectura → slices)

1. **HOY — Producción v2 (en curso):** ruta `FIGURA_MOLDEADA_CONGELADA`, primera implementación:
   corrida flexible por figuras + desmolde diferido con conteos. Estados actuales = subconjunto
   (§8). Receta por producto se mantiene como aproximación.
2. **SIGUIENTE — Componentes + BOM (evolución del "slice de mezcla"):** subrecetas/bases como
   lotes propios de inventario (mousse por sabor, cheesecake, ganache, salsas, crocante),
   recetas maestras por 1000 g cargadas al sistema, BOM por producto (figuras = mousse 115/145/215 +
   20 + 15), merma estándar por tipo de preparación. Requiere: alta de insumos nuevos con costos
   (los da Julián) + sesión de diseño.
3. **DESPUÉS — Rutas por familia:** campo `ruta` en la ficha de producto, máquinas de estado por
   ruta (ensamblados, refrigerados, bajo pedido), punto de descuento por familia (3 momentos, §10),
   conservación configurable. Habilita Momo Cake, parfaits, malteadas y bebidas como familias
   de producción reales.

**Conclusión operativa (regla madre):** el sistema NO debe tratar todos los productos como una
figura de 180 g. Comparte subrecetas; asigna a cada familia su BOM, su ruta, sus tiempos, sus
estados, su conservación y su regla de inventario.
