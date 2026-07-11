# BACKLOG — Fase 0 (maqueta local-first)

> Trabajo pendiente de la maqueta **antes** de migrar a Supabase (Fase 1).
> Complementa el HANDOFF (que es la fuente de verdad para retomar).
> **Prioridad:** `P1` = bloquea operación real · `P2` = polish / deuda técnica · `Fase 1` = requiere backend.
> Última actualización: **2026-07-07**.

---

## ✅ Hecho y verificado (Fase 0)

- [x] Scaffolding Vite + React 18 + Tailwind v4. 15 bugs de dominio arreglados.
- [x] Catálogo de **figuras** con nombre (editor dedicado en Configuración).
- [x] **Relleno** = constante fija "Cheesecake con ganache".
- [x] **CRUD de productos** (crear/editar, soft-delete).
- [x] **Atributos derivados del tipo** — sin toggles manuales; imposible romper la regla por diseño (`atributosDeTipo()`).
- [x] **Smoke-test Fase 0 — 4/4 en vivo** (reserva única, combo + extra baja del stock, sync no miente, tiempo de lote sin "9h 60min").
- [x] **Fix del cimiento de inventario** — los extras de receta descontados al reservar vuelven al cancelar (reserva `tipo:"insumo"`).
- [x] **Toppings / adiciones** — catálogo editable + picker por línea + suma al total + inventario liberable.
- [x] **Combos reales (P1)** — composición LIBRE por slot, figura nombrada de las 7, esquema `order_items` PADRE (caja) + N HIJAS (`parentItemId`). CRUD de combos desbloqueado (tamaño/momos-componentes/caja). Descuento por **especie exacta** (figura→especie→momo-componente). ✅ **Verificado en navegador (2026-07-07):** Caja x3 con Lizi+Momo (gato) + Max (perro) → padre $49.000 + 3 hijas $0 · pagar descuenta PR01 8→6, PR02 6→5, I08 9→8 (sin pull genérico) · cancelar devuelve todo · detalle muestra la composición para la cocina · 0 errores · semilla restaurada.
- [x] **Combos — composición DISTINTA por caja en una misma línea (#2)** — el estado pasa a `boxes` = Array(cant) × Array(comboSize); cada caja se arma aparte. `guardar()` emite 1 hija por (caja, slot) con `cajaNum` y `cant:1` → total momos = cajas × comboSize (reserveInventory/release sin tocar). UI "ARMÁ LAS N CAJAS" con "Caja 1 → todas" y "= mismos momos" por caja; `setCant` redimensiona conservando. `DetallePedido` agrupa por `cajaNum`; CSV con columna "Caja #". ✅ **Verificado en navegador:** 2 cajas distintas → padre cant=2 + 6 hijas (cajaNum 1/2) · pagar PR01 8→5, PR02 6→3, I08 9→7 · cancelar devuelve todo (7 reservas) · redimensión conserva/agrega vacías · validación bloquea cajas incompletas · 0 errores.
- [x] **Revisión adversarial de combos (workflow, 7 agentes) — 3 hallazgos confirmados, los 3 arreglados y verificados:**
  - 🔴 **ALTA — `availability`/`faltaStock` miraban el POOL combinado de especies, pero el descuento es por especie EXACTA** → un combo concentrado en una especie agotada mostraba "disponible" y no alertaba (recién saltaba al pagar). Fix: helper `comboFaltantesEspecie(db, combo, boxes)` (demanda por componente vs stock); `faltaStock` y el aviso por línea ahora muestran el faltante de especie REAL ("Faltan 1 Momo Perrito…"). **No bloquea** (coherente con el diseño oversell→sugerir producción). Verificado: perro=1, 2 perros pedidos → alerta; bajar a 1 perro → alerta desaparece.
  - 🟡 **BAJA — cantidad decimal** (tipear "2.5") desincronizaba `boxes.length` de `cant`. Fix: `Math.floor` en `setCant` (fuente única del invariante).
  - Dimensiones **ux-edge** y **retrocompat**: limpias (0 hallazgos).
- [x] **Cards resumen accionables (Producción + Domicilios)** — click en **Stock operativo** → filtra "Lotes" por producto; click en **Lotes en proceso** → filtra por producto·sabor·figura·gramaje; click en **Domicilios activos** → filtra la lista a los activos. Reusa `onClick` de `Card`/`Stat` (cursor+hover), estado local + scroll con `getElementById`; sin tocar dominio ni persistir. ✅ Verificado en navegador (5 lotes→1, 4 domicilios→2, chips + botones de quitar filtro).
- [x] Sabores / salsas / rellenos ya eran editables ("Catálogos del negocio" en Configuración).
- [x] **Toppings POR SUB-MOMO dentro de una caja** (polish no-bloqueante 2026-07-09) — cada slot de "ARMÁ LA CAJA" tiene su propio picker de toppings (antes las hijas iban con `adiciones:[]` y el picker se ocultaba en combos). Estado: cada slot gana `adiciones`; helper `toggleSlotAdicion`; `boxesAdicionesTotal` suma los toppings de los sub-momos al subtotal/total de línea del preview; `guardar()` emite cada hija con `adiciones: snapAdiciones(d, sl.adiciones)`; `DetallePedido` muestra el topping bajo cada sub-momo en "COMPOSICIÓN … (para la cocina)". El dominio **no se tocó**: `reserveInventory`/`releaseReservations`/`lineAdicionesCOGS` ya iteran `itemsOf` (incluye hijas, `cant:1`) → descuento/costeo/devolución por sub-momo salen solos. ✅ **Verificado en navegador de punta a punta (2026-07-09):** Caja x3 (Lizi+Momo gato · Max perro) con Oreo→Nutella en 1 sub-momo · subtotal $49.000+$3.000=**$52.000** · guardar → padre `esCaja` + 3 hijas, la del slot 0 con `adiciones:[{Oreo, insumoCosto:32000}]` · **pagar** → PR01 8→6, PR02 6→5, I08 9→8, **Nutella 1.8→1.75** (reserva `insumo` "adición Oreo" 0.05) · **cancelar** → todo vuelve (Nutella 1.75→1.8), 5 reservas Liberadas · composición muestra "🍫 Oreo (+$3.000)" solo en su sub-momo · 0 errores de consola · semilla restaurada pristina.
- [x] **Evidencias guiadas por paso** — el paso pide su foto con el tipo YA FIJO (sin dropdown que se equivoque). Gates nuevas de Empacado (caja abierta + sello) y Entregado (foto de entrega). Verificado en vivo: la trampa clásica (comprobante), empaque y Rappi; las 3 gates bloquean con mensaje claro.
- [x] **Costeo de insumos por costo total + WAC** — form "Nuevo insumo" pide **costo TOTAL de la compra** (deriva unitario = total ÷ stock, con helper en vivo). Cada **Entrada** pide cantidad numérica + costo total, con **unidad cerrada** (la del insumo, badge no editable) y recalcula el costo unitario por **promedio ponderado (WAC)**. Decisión del usuario: la Entrada usa siempre la unidad del insumo (sin conversión). ✅ **Verificado en navegador (2026-07-07):** Nutella 1.8 kg @ $32.000 + Entrada 1.2 kg/$48.000 → 3.0 kg @ **$35.200/kg** exacto, unidad `kg` cerrada, persiste, 0 errores.
- [x] **Auditoría adversarial de dominio (2026-07-07)** — 51 agentes, **7 bugs confirmados de 15** (8 falsos positivos descartados por verificación triple). Fixes aplicados **y re-verificados adversarialmente (todas las lentes limpias)**:
  - 🔴 **#1 Stock fantasma al cancelar** — un pedido "al momento" con insumo insuficiente devolvía la receta TEÓRICA, no el consumo real → inventario inflado. Ahora `deductRecipe` registra el consumo real como reserva `tipo:"insumo"` (con `orderId`) y `releaseReservations` devuelve exactamente lo consumido.
  - 🔴 **#3 Costo negativo en Entrada** — el guard solo bloqueaba vacío; un `-900` contaminaba `it.costo` (WAC negativo) → COGS/márgenes. Guard endurecido (`+form.precio < 0`).
  - 🟢 **#7 Costo total 0 en Entrada** — diluía el costo unitario. Ahora una entrada sin costo (0) solo suma stock, no toca el WAC.
  - 🟡 **#4 Transiciones de estado** — `setOrderStatus` no validaba saltos → se podía Entregar sin descontar receta. Ahora: **grafo estricto `TRANSICIONES`** (Cancelado/Reclamo = excepciones universales) + **red de seguridad de receta** (descuenta al llegar a En ruta/Entregado si no se hizo) + **venta rápida** ("⚡ Entrega inmediata": Pagado→Entregado, exige pago + foto de entrega, omite sello).
  - **Formato colombiano de millones** — helper `milCO` (apóstrofe en la frontera de millones: `$1'250.000`), centralizado en `fmt`.
  - 🔴 **#2/#6 Pérdida silenciosa por cuota** — un guardado que excede localStorage ahora prende estado **"error"** + banner rojo ("almacenamiento lleno, exportá backup") + label en el header, en vez de fallar invisible; `beforeunload` advierte. **Fase 0 = mitigación visible; fix real (fotos → Supabase Storage) = Fase 1.**
  - 🟢 **#5 dbLoad no persistía tras normalizar** (path same-version) — ahora compara el shape pre/post y persiste solo si la normalización cambió algo (no más "guardado" sin escribir).
  - **TOTAL: 7/7 bugs confirmados cerrados y re-verificados adversarialmente (todas las lentes limpias). + venta rápida (feature nueva).**

---

## ⏳ Pendiente — Fase 0

### ✅ HECHO (mitigación Fase 0) · Pérdida silenciosa de datos por cuota de localStorage  · [auditoría #2/#6]

**Resuelto 2026-07-07:** el fallo ahora es VISIBLE (estado "error" + banner rojo + `beforeunload` advierte). El fix REAL (fotos fuera del blob → Supabase Storage) queda en la sección "Empuja a Fase 1". _Detalle original abajo._


**Problema:** las fotos base64 viven en el mismo blob de `localStorage` (`momos-db-v2`). Al pasar los ~5MB, `dbPersist` falla **en silencio** (console.error + return false): el cambio queda en memoria pero NO en disco, el indicador dice "local" (parece benigno), y al recargar se pierde el trabajo. `beforeunload` (#6) reintenta el mismo `setItem` condenado.

**Mitigación Fase 0 (sin backend):** hacer el fallo VISIBLE — estado de sync "error" + banner rojo prominente ("No se pudo guardar: almacenamiento lleno, exportá un backup"); en `beforeunload`, avisar de exportar backup en vez de reintentar. **Fix real = Supabase Storage** (fotos fuera del blob; el producto/evidencia guarda la URL) → Fase 1.

**Dónde:** `dbPersist`, `update()` (setTimeout de persist), el indicador de sync, `beforeunload`. **Esfuerzo: BAJO-MEDIO (mitigación).**

---

### ✅ HECHO · dbLoad normaliza en memoria pero no persiste (path same-version)  · [auditoría #5]

**Resuelto 2026-07-07:** `dbLoad` compara el shape pre/post `normalizeDbShape` y persiste solo si cambió. _Detalle original abajo._


**Problema (BAJA, semi-inalcanzable):** en `dbLoad`, cuando `version === DB_VERSION` se retorna `normalizeDbShape(d)` sin marcar `_migrated`, y el caller hace `setSync("guardado")` sin persistir. Si la normalización transformó algo (solo alcanzable con storage tocado a mano), queda en memoria y dice "guardado" sin escritura. **Fix:** persistir tras normalizar en el path same-version (o ajustar el indicador). Un verificador lo marcó inalcanzable por la app en ejecución.

---

### ✅ HECHO Y VERIFICADO · `P1` · Combos reales — crear cajas vendibles  · [pendiente #3]

**Resuelto 2026-07-07 (sesión fresca).** Implementadas las 6 zonas del diseño cerrado + migración + CSV, y **verificado en navegador de punta a punta** (detalle en la lista "Hecho y verificado" arriba). Lo que quedó implementado:
- Helpers `momoEspecie` / `figuraEspecie` / `componentProductForFigura` / `figurasDeCombo`.
- `reserveInventory`: guard `tieneHijas` → si la caja tiene sub-momos, cada hija se descuenta sola por especie exacta (rama `momo`); combo legacy sin hijas mantiene el pull genérico (retrocompat). `releaseReservations` sin cambios.
- `NuevoPedido`: bloque "🎁 ARMÁ LA CAJA" con `comboSize` slots (figura de `figurasDeCombo` + sabor + salsa) + "= igual para todos"; `guardar()` genera PADRE (`esCaja`) + N HIJAS (`parentItemId`, `esSubMomo`, precio/costo 0).
- `Productos`: tipo "combo" desbloqueado al crear + bloque de config (momos por caja, caja/empaque de cat. "Cajas", chips de momos-componentes con especie); persistido en `guardarNuevo`/`guardarEdicion`.
- `DetallePedido`: filtra las hijas del map principal y las muestra indentadas bajo la caja ("COMPOSICIÓN DE LA CAJA (para la cocina)").
- Migración: `especie` sembrada en momos + backfill idempotente en `normalizeDbShape` (por nombre). CSV de items con columna "Padre (caja)". **Sin bump de DB_VERSION.**
- **Pendiente-futuro (no bloqueante):** toppings por sub-momo (hoy las hijas van con `adiciones:[]`, y el picker de toppings se oculta en líneas combo); composición distinta por caja dentro de una misma línea (hoy la composición del slot se repite en las N cajas de la línea; para cajas distintas se agrega otra línea).

_Diseño original (referencia):_

**Problema:** el CRUD hoy **bloqueaba** crear combos (sin selectores quedan invendibles, availability 0). Además una caja es UNA línea con un solo sabor/figura → no se puede expresar "1 gatito maracuyá + 1 perrito oreo + 1 gatito coco". La semilla lo mete a mano en texto libre; la cocina no puede trabajar con eso.

#### ✅ Decisiones CERRADAS con el usuario (2026-07-07)
1. **Composición LIBRE por slot** (con atajo "igual para todos"). NO presets fijos.
2. **Figura NOMBRADA por slot** — cada slot elige una de las **7 figuras del catálogo** (Lizi/Momo/Toby/Teo · Max/Rocco/Danna), no solo "gatito/perrito".
3. **Esquema `order_items` = 1 fila PADRE (caja) + N sub-filas HIJAS (`parentItemId`).** La padre lleva precio+costo+empaque+comboSize; cada hija = 1 momo con figura+sabor+salsa. → mapea 1:1 a filas de Supabase, la cocina lee cada sub-momo, el inventario descuenta exacto. (Descartado: JSON dentro de la línea — peor para Postgres y para la cocina.)

#### Modelo de datos
- **Momo products += `especie`** (`"gato"`/`"perro"`). Backfill en `normalizeDbShape` por nombre (`/perr/i`→perro, else gato). El stock de momos vive a nivel ESPECIE (PR01 Gatito=pool gato, PR02 Perrito=pool perro), NO por figura.
- **Figura → especie:** `settings.figuras[].especie` YA existe. El descuento hace: slot.figura → `figuraEspecie` → el `componentProduct` con esa especie.
- **Slot figura options** = figuras cuya especie está entre las especies de los `componentProductIds` de esa caja (helper `figurasDeCombo`). Caja gato+perro → las 7; caja solo-gatos → las 4 de gato.
- **Fila HIJA:** `{ id, orderId, parentItemId, productId: <componentProduct de la especie>, nombre: "<figura> (en <caja>)", figura, sabor, salsa, relleno: "Cheesecake con ganache", cant: <boxCant>, precio: 0, costoUnitario: 0, adiciones: [], esSubMomo: true }`.
- **Fila PADRE:** como hoy pero `esCaja: true`; sabor/salsa/figura vacíos (la composición vive en las hijas). Precio y costo de la caja SOLO en la padre → sin doble conteo (`orderSubtotal`/`orderCOGS` ya suman `precio*cant` / `costoUnitario*cant`, las hijas aportan 0).

#### Las 6 zonas de código a tocar (líneas ACTUALES, `MomosOps.jsx`)
1. **Helpers** (~1018, junto a `comboComponentStock`): agregar `momoEspecie(p)`, `figuraEspecie(db, nombre)`, `componentProductForFigura(db, combo, figuraNombre)`, `figurasDeCombo(db, combo)`.
2. **`reserveInventory` rama combo** (1152-1187): si la caja TIENE hijas (`order_items` con `parentItemId === boxRow.id`), **saltar el pull genérico de `comboSize` momos** (las hijas se descuentan solas por la rama `momo`, 1147-1151, que ya toma `it.cant` del stock exacto → "2 de PR01 + 1 de PR02") → descontar SOLO empaque + extras de receta. Si NO tiene hijas (combo legacy de semilla) → mantener el pull genérico actual (retrocompat). `releaseReservations` (1218-1244) **NO se toca**: revierte por tipo (producto/empaque/insumo) y las hijas ya son reservas `producto`.
3. **`nuevoProductoVacio`** (2971) + **form de `Productos`** (3092-3130): agregar `comboSize` (number), `componentProductIds` (multiselect de momos activos), `empaqueItem` (select de `inventory_items` cat. Cajas). **Desbloquear "combo"** en el `<Select options={["momo","pedido"]}>` de tipo al CREAR (3101). `guardarNuevo`/`guardarEdicion` (2986-3026): persistir esos campos si `tipo==="combo"`; validar `comboSize>0`, `componentProductIds` no vacío, `empaqueItem` seteado.
4. **`NuevoPedido` estado + UI** (2221 `items`, 2358-2404 render): agregar `slots` al item. Al elegir un combo, `slots = Array(comboSize)` de `{figura:"",sabor:"",salsa:""}`. En el render, si `pSel.tipo==="combo"`: **NO** mostrar los selects sabor/salsa de línea; mostrar `comboSize` sub-forms (figura de `figurasDeCombo`, sabor de `sabores`, salsa de `s.salsas`) + botón "igual para todos" (copia slot 0 a todos). Helper `setSlot(i, slotIdx, campo, valor)`.
5. **`guardar()` de NuevoPedido** (2284-2302, el `.map` de `nuevasLineas`): para una línea combo, en vez de 1 fila → PADRE + N HIJAS desde `slots` (generar id padre primero, hijas con `parentItemId`). Validar que TODOS los slots tengan figura+sabor+salsa antes de crear el pedido.
6. **`DetallePedido`** (2089-2110): renderizar la caja PADRE y debajo, indentadas, sus HIJAS (sub-momos con figura+sabor+salsa) para la cocina. Filtrar las hijas del map principal (solo bajo su padre). El CSV de items (~4208) debería incluir `parentItemId`/composición.

#### Migración y verificación
- `normalizeDbShape`: backfill `especie` en momos. Combos legacy sin hijas quedan igual (retrocompat vía el fallback de la zona 2). Semilla PR05/PR06/PR07 sigue vendible; cajas de pedidos históricos no se rompen.
- **Verificar en navegador:** crear un combo (no bloqueado) · Nuevo pedido Caja x3 con 3 slots distintos + "igual para todos" · guardar → padre + 3 hijas, precio solo en padre · marcar pagado → descuenta especie exacta (gato→PR01, perro→PR02) + 1 caja del empaque · cancelar → todo vuelve · DetallePedido muestra los 3 sub-momos · combo legacy de semilla sigue OK.

**Esfuerzo: ALTO.** **Recomendado hacerlo en sesión fresca** (contexto liviano = más barato y menos error).

---

### `P2` · Polish de toppings — ✅ HECHO (2026-07-07, sesión nueva)

- [x] **COGS computa el costo del insumo de las adiciones** (`lineAdicionesCOGS` + `orderCOGS`). Verificado: $69.200→$72.400 con un topping ligado a insumo.
- [x] **CSV de items incluye adiciones**: 3 columnas nuevas (`Adiciones` serializada, `Total adiciones`, `Costo insumo adiciones`).
- [x] **Modelo de topping = POR MOMO** (decisión del usuario). Inventario, COGS y precio escalan por la cantidad de la línea (`× it.cant`) en `reserveInventory`, `lineAdicionesCOGS` y `lineAdicionesTotal` — los tres coherentes. Verificado: 1 momo→(3000/1600/0.05kg), 2 momos→(6000/3200/0.1kg).

**Revisión adversarial (workflow 3 dimensiones) — hallazgos y estado:**
- ✅ Fórmula `× it.cant` (era ALTA: `reserveInventory` subdescontaba y el COGS subcosteaba en líneas multi-unidad) → **arreglado** con el modelo "por momo".
- ✅ Botón "Marcar pagado" vs bloque guiado inconsistente en pedidos "Reclamo" → **arreglado** (se agregó `"Reclamo"` a la exclusión del botón).
- ℹ️ Rappi exige foto de "Entrega" para Entregado → **es lo decidido** (HANDOFF punch-list #2). El operador sube la foto (el slot guiado renderiza para Rappi). Sin cambio.

### ✅ HECHO · Congelar el costo de insumo de las adiciones  · [polish no-bloqueante 2026-07-09]

**Resuelto 2026-07-09 (adelantado desde Supabase, decisión "cerrar el polish no-bloqueante").** Helper `snapAdiciones(d, adiciones)`: al crear el pedido (`guardar()` de `NuevoPedido`, ambas ramas — línea normal y sub-momos hijas) congela `insumoCosto` = costo en vivo del insumo en ese momento. `lineAdicionesCOGS` ahora lee `ad.insumoCosto` con **fallback al costo en vivo** para filas viejas sin snapshot (`if (costo === undefined)`). Esto además arregla el **"COGS da 0 si se borra el insumo"** — el snapshot sobrevive a la baja del insumo. Sin bump de `DB_VERSION`, sin migración (el fallback cubre lo viejo). ✅ **Verificado en navegador (2026-07-09):** pedido con topping Oreo ligado a Nutella ($32.000/kg) → la hija persistió `adiciones:[{…, insumoCosto: 32000}]` congelado. _Fix real server-side (COGS en Postgres) sigue siendo la meta de Fase 2; esto es la versión maqueta._

_Detalle original del pendiente (referencia):_ `lineAdicionesCOGS` usaba el costo de insumo **en vivo**, no congelado como `costoUnitario` → el margen histórico se movía si cambiaba el precio del insumo (y daba 0 si se borraba el insumo).

---

### ✅ HECHO · Costo de insumo derivado (total ÷ cantidad) + WAC en Entradas  · [obs. usuario 2026-07-07]

**Resuelto 2026-07-07 (sesión nueva).** Form "Nuevo insumo" pide **costo total** (deriva unitario = total ÷ stock inicial, con helper en vivo). **Entrada** ahora pide cantidad numérica parametrizada + costo total, con **unidad de medida cerrada = la del insumo** (badge no editable — decisión del usuario: sin conversión de unidad de compra), y recalcula el costo unitario por **promedio ponderado (WAC)**. El campo canónico `costo` (unitario, en la unidad del insumo) no cambia de forma; recetas/COGS lo siguen usando igual. ✅ **Verificado en navegador (2026-07-07):** WAC exacto ($35.200/kg en el caso Nutella), unidad cerrada, persiste. _Detalle original de la feature, como referencia:_

**Problema:** el form "＋ Nuevo insumo" (`Inventario`, ~línea 2811) pide **"Costo unitario"** directo → obliga al operador a dividir a mano (factura trae un TOTAL, no un precio/kg) → error de dedo. Además, al **reponer** stock ("Registrar movimiento → Entrada", ~línea 2838) el `costo` **no se actualiza nunca** (queda congelado en el de creación).

**Alcance (decidido: al backlog, sesión fresca):**
- **Form nuevo insumo:** reemplazar "Costo unitario" por **"Costo total de la compra"**; derivar `costo = total ÷ stock inicial` (el "Stock inicial" ya es la cantidad comprada). Mostrar el unitario calculado como ayuda. Fallback si stock inicial = 0.
- **Reposición (movimiento de Entrada):** hoy pide la cantidad como **texto libre** (`+5`), sin precio ni unidad. Debe capturar, para cada Entrada, **(1) precio al que se compró**, **(2) cantidad numérica parametrizada** (no texto libre), **(3) unidad de medida = lista CERRADA (`<Select>`), NUNCA texto libre** — reusar el enum del form de creación (`und/kg/g/L/ml/paquete/docena`, línea 2808) para no ensuciar datos (`kg`/`Kg`/`kilo`) ni romper conversión/costo. Pedido explícito del usuario (2026-07-07). Con eso **recalcula el costo unitario con promedio ponderado** (WAC): `(stock_viejo × costo_viejo + cant_comprada × costo_compra) ÷ (stock_viejo + cant_comprada)`.
  - **Decisión pendiente:** WAC vs "último precio" (sobreescribir). WAC es lo contablemente correcto.
  - **Decisión pendiente:** ¿el "precio de compra" es **total** (→ unitario = total÷cantidad, coherente con el form) o **unitario**? Recomendado: total, como en la factura.
  - **Nuance a resolver:** la **unidad de compra puede diferir de la de almacenamiento** (ej: comprás "1 tarro = 3 kg" pero guardás en kg). Si se permite, hace falta un factor de conversión a la unidad canónica del insumo antes de sumar al stock y promediar el costo.

**Dónde:** `MomosOps.jsx` → componente `Inventario` (form nuevo insumo ~2800-2835; modal "Registrar movimiento" ~2838-2844, hoy: Tipo/Ítem/Cantidad-texto/Nota). El campo canónico sigue siendo `costo` (unitario, en la unidad del insumo) porque recetas/COGS lo usan. **Esfuerzo: BAJO (form) / MEDIO (reposición WAC + conversión de unidad).**

---

### ✅ HECHO · CRM con alta de leads + edición de clientes  · [obs. usuario 2026-07-07]

**Resuelto 2026-07-07 (sesión nueva, verificado en navegador).** `Clientes` ahora recibe `{ db, update, user }`. Cambios:
- **✏️ Editar cliente** (botón en el detalle): form con `nombre, teléfono, instagram, canal, barrio, dirección, cumpleaños (date picker → MM-DD), estado, favoritos, notas`. Los derivados (`primera/ultima/total/pedidos`) NO se editan a mano — verificado que editar NO toca las métricas (Andrés siguió con total $96.000 / 3 pedidos).
- **＋ Nuevo cliente (lead)** (decisión del usuario): alta manual SIN pedido para cargar prospectos. ID vía `nextId(d,"customer","C",2)` (C09…), métricas en 0, `primera/ultima` vacíos, `addAudit` "Cliente creado a mano (lead)".
- 🐛 **Bug encontrado y arreglado en el mismo flujo:** la lista de alertas arrancaba con `if (!c.ultima) return` (línea ~3469), lo que mataba TAMBIÉN la alerta de cumpleaños para un lead sin compras — justo lo que este módulo venía a revivir. Se separó: la inactividad queda tras `if (c.ultima)`, el cumpleaños corre siempre. Verificado en vivo: un lead con cumpleaños a 5 días dispara "🎂 … cumple años en 5 día(s)".
- **Verificado en navegador:** alta de lead (C09, métricas 0, alerta de cumple revivida), edición (notas + round-trip de cumpleaños 11-02, métricas intactas, audit "Cliente editado"), semilla restaurada pristina, 0 errores nuevos.

_Detalle original del hallazgo, como referencia:_

**Hallazgo (verificado):** el componente `Clientes` (`function Clientes({ db })`, ~línea 3461) recibe `db` pero **NO** `update` → no puede escribir nada. Un cliente **solo** se crea desde el form de Nuevo Pedido (`guardar()`, ~2266-2268), con `cumple/favoritos/notas` en `""`. Grep confirma que **no hay ningún `.cumple =` / `.notas =` / `.favoritos =`** en el código: esos campos nunca se pueblan después de crear.

**Consecuencias:**
- No se puede cargar un prospecto/lead antes de su primer pedido.
- No se puede corregir un dato mal tipeado (teléfono, barrio) ni cargar cumpleaños/favoritos/notas.
- La **alerta de cumpleaños** del módulo (~3473) queda MUERTA para clientes reales — solo dispara para los de la semilla, porque `cumple` nunca se puebla desde la UI.

**Alcance (Fase 0 mínimo):** pasar `update` a `Clientes` + form de **editar cliente** (nombre, teléfono, barrio, cumpleaños, favoritos, notas) y opcional "＋ Nuevo cliente" (alta manual sin pedido). Hoy es diseño lean (no hay clientes fantasma); la decisión es cuánto CRM se quiere en la maqueta vs. dejarlo para el CRM real de Fase 1.

**Dónde:** `MomosOps.jsx` → `Clientes` (~3461, hoy solo-lectura). **Esfuerzo: BAJO-MEDIO.**

---

## 🎯 Empuja a Fase 1 (Supabase) — anotado, NO es Fase 0

- **Toppings declarados por producto** (`products[].toppingsIds`) — hoy los toppings son globales (cualquier línea puede llevar cualquiera). Para el **menú al cliente** conviene que cada producto declare los suyos.
- **Menú con cara al cliente** + **fotos de producto** (Supabase Storage) + **precios de adiciones** visibles.
- **Trazabilidad compartida** entre dispositivos (el cliente elige desde otro equipo y el pedido entra a la app).
- Ver la sección **"🎯 EL SALTO"** del HANDOFF: recomendación de arrancar Supabase como proyecto propio, en sesión fresca.

---

## 🔭 Roadmap Fase 2/3 — delta del análisis estratégico (2026-07-10)

> Origen: análisis externo de los 6 flujos (demanda→inventario→producción→despacho→cliente→recompra).
> **Verificado contra el código: su "Fase 1 Lanzamiento" ya está ~70% construida en Fase 0.**
> NADA de esto se construye en la maqueta — todo requiere servidor (historial consultable + cron + datos compartidos).
> Los **ganchos de datos** que estas features necesitan ya quedaron en `supabase/schema-v5.sql` (2026-07-10) para que el historial exista desde el día 1.

### Lo genuinamente nuevo (ordenado por valor)
1. **Pronóstico de producción por sabor/figura** (Fase 2) — "mañana producir 28 maracuyá, 22 Oreo…". Insumos: ventas por sabor (`order_items` ya lo snapshotea desde siempre), rotación, inventario listo+congelando, pedidos confirmados, merma histórica, día de semana, campañas activas. Hoy solo hay sugerencias REACTIVAS (`production_suggestions` al faltar stock) — esto es lo predictivo.
2. **Trazabilidad de calidad por molde/ubicación** (Fase 2) — alertas "molde X genera más imperfectos", "sabor Y con merma sobre el promedio". Gancho: `production_batches.molde/ubicacion` + catálogos `moldes`/`ubicaciones_frio` (ya en schema-v5).
3. **Asignar lote a la reserva** (Fase 2) — hoy se reserva contra stock agregado. Gancho: `inventory_reservations.batch_id` (ya en schema-v5).
4. **Contribución COMPLETA por pedido** (Fase 2) — falta: comisión del medio de pago (gancho: `orders.comision_pago` snapshot, ya en schema-v5), pauta atribuida por pedido individual, flag nuevo/recurrente (derivable del historial, sin gancho).
5. **CRM cohortes y segmentos extra** (Fase 2) — fan de sabor (derivable de `order_items`), comprador de regalo, referido (gancho: `customers.referido_por`, ya en schema-v5), sensible a promos. La recompra automática = el agente traficker (`traficker/AGENTE.md`, tipo `cliente`).
6. **Despacho asistido** (Fase 3) — calificación del mensajero (gancho: `deliveries.calificacion`, ya en schema-v5), agrupación por zona/franja ("5 entregas entre San Fernando y El Ingenio 3-5 pm"), rutas.
7. **KPIs de la mañana (10)** (Fase 2) — el Dashboard ya muestra ~6/10; faltan CAC, contribución por pedido y recompras/reactivados.

**➕ Capa de ORQUESTACIÓN (análisis 2026-07-10: "convertir pedidos en tareas, tareas en rutas, clientes en recompra"):**

8. **Planificador de agrupamiento de producción** (Fase 2) — pedidos confirmados del día → orden AGREGADA ("producir 6 Oreo, 2 Maracuyá, 1 Milo" + colchón por rotación). Hermano operativo del pronóstico (#1): el pronóstico mira histórico; este agrupa lo CONFIRMADO. Sin esto, 5 personas producen pedido por pedido y la capacidad no alcanza.
9. **Colas por estación** (Fase 2) — pantalla de COCINA con tareas horarias ("10:30 preparar 24 Oreo · 11:00 desmoldar L-034 · 12:00 empacar 1182-1190"), y cola de EMPAQUE (pedido, contenido, caja, mensaje regalo, franja, hora límite; etiqueta/QR por pedido). Los DATOS ya existen (lotes, padre+hijas, FOTOS_PASO) — es una vista de tareas, no dominio nuevo.
10. **Tablero de despacho + vista del mensajero** (Fase 3) — carga por mensajero/zona/franja, orden de entrega, detección de retrasos, evitar 2 mensajeros a la misma zona. Complementa el #6 (agrupación por zona/franja).
11. **Dashboard de capacidad en tiempo real** (Fase 2/3) — % de moldes usados, % de congelación, pedidos por franja vs cupo, cocina/mensajeros saturados, "pedidos nuevos ya no alcanzan entrega inmediata". Es el FRENO que evita aceptar lo que no se puede cumplir. **Ganchos ✅ APLICADOS a schema-v5 (2026-07-10, sesión nueva — el esquema aún no corre, agregar costó cero):** tabla `franjas` (con `cupo`) + `orders.franja`, `capacidad` en `moldes`/`ubicaciones_frio`, rol `Mensajero` + `deliveries.mensajero_user_id` (identidad para el #10; sin auth hasta Fase 3), vista pública `shop_franjas`. El historial de franjas/capacidad/mensajero se acumula desde el día 1.

> Ya cubierto de esa lista de 10: Pide MOMOS (blueprint en `PIDE-MOMOS.md`) · reserva automática (Fase 0) · pronóstico de sabores (#1) · despacho por zonas (#6/#10) · automatización de mensajes (eventos de PIDE-MOMOS + traficker).

11b. **Ideas rescatadas del predecesor "Postres Momos Admin"** (proyecto Supabase viejo `momos-ops-v1`, inventariado y borrado 2026-07-10 para reusar su proyecto en Fase 1): (a) **`expenses`** — gastos generales del negocio (arriendo, servicios, nómina) que OPS no modela aún; sin ellos el P&L completo no cierra (hoy solo hay COGS+domicilio+pauta+compensaciones). (b) **Inbox omnicanal** (`inbox_conversations`/`inbox_messages`/`inbox_ai_suggestions`/`channel_connections`) — conversaciones WhatsApp/IG centralizadas con sugerencias de IA y borrador de pedido con aprobación; encaja con "automatización de mensajes" + el traficker (Fase 2/3). Su código Next.js queda en `C:\Users\Windows 11\OneDrive\Documentos\New project 3\momos-ops-v1` como referencia.

12. **Programa de EMBAJADORES** (fase shop V2 — análisis del usuario 2026-07-10, destilado en [`EMBAJADORES.md`](EMBAJADORES.md)) — enlaces `/r/CODIGO`, atribución con ventana, comisión 20% SOLO cliente nuevo validado (antifraude), billetera con estados + pagos quincenales, niveles, rentabilidad/LTV por embajador. **Reusa lo ya construido:** `benefits` para el reward, merge por teléfono para antifraude, COGS congelado para margen por embajador. Cero cambios de esquema hoy (no puede haber historial antes de que exista el shop).

### Qué ya cubre Fase 0 (NO rehacer — verificado)
- **Reserva automática completa**: pagar→reservar (doble venta imposible), cancelar→liberar, entregar→consumir, especie exacta en combos, sugerencias de producción reactivas al faltar stock.
- **Cadena de frío**: cronómetro 8-12h con inicio explícito (botón ❄️), "listo para desmolde" (Congelación cumplida→Marcar Listo), merma >15% alerta por lote, imperfectas recuperadas en malteadas.
- **Rentabilidad**: COGS congelado por pedido (incl. adiciones), atribución campaña/creativo, domicilio cobrado vs costo real; POAS por campaña en schema-v5.
- **CRM**: segmentos derivados solos (VIP/Recurrente/Inactivo/Riesgo), cumpleaños, beneficios por vencer, "A quién escribirle hoy" con mensaje listo.
- **Despacho**: zona/costo/proveedor/horas/evidencia/estado.

---

## 🔭 Multi-sede — contemplar desde YA, construir por etapas (análisis del usuario 2026-07-10, **v2 ampliada el mismo día**)

**Regla del usuario (verbatim):** *"No construir hoy toda la operación de las islas, pero sí evitar que el sistema quede amarrado a una sola cocina."* **Modelo: Caney produce; las islas venden, almacenan, entregan y amplían cobertura.**

**Verificado contra la base viva (2026-07-10):** `orders.canal` + `origen_detalle` ✓ (canal de venta / origen), atribución campaña/creativo ✓, tabla `zonas` ✓, `deliveries.mensajero_user_id` ✓, `customers` global = **cuenta única del cliente** ✓. **Delta genuino:** sedes, sede en cada registro, inventario por ubicación, transferencias, caja/turno, asignación/reposición/capacidad por nodo — nada de eso existe (verificado: 0 tablas).

### 🪝 Gancho AHORA — [`supabase/sedes-v1.sql`](supabase/sedes-v1.sql) (solo DDL + defaults; CERO cambios de RPC/front)
- **`sedes`** `{id, nombre, tipo: cocina|isla|local|bodega, direccion, lat/lng, radio_cobertura_km, activa, config jsonb}` (horarios/capacidad/límites/canales activos van en `config` — motor configurable, jamás hardcodeado) + seed único **`SEDE-01` "Cocina Central Caney"**.
- **Sede en cada registro** (default `'SEDE-01'`): `orders.sede_id` + **`prep_sede_id`** (quién produce) + **`despacho_sede_id`** (quién despacha — "Caney puede producir y la isla despachar") + **`pickup_sede_id`** (null = domicilio; seteada = recogida) + `turno_id` (null hasta que exista caja); `inventory_items`, `inventory_movements`, `production_batches`, `deliveries` (nodo base del mensajero), `users` (personal por sede), `claims`, y **`zonas.sede_id`** (cobertura: qué nodo atiende cada zona).
- **`transferencias` + `transferencia_items`** — contrato CONGELADO con los 7 estados del análisis (Creada→Preparada→Despachada→En tránsito→Recibida / Recibida con diferencia / Anulada), `cant_enviada` vs `cant_recibida`, `batch_id` para trazabilidad. **Sin RPCs ni UI todavía** — sin 2ª sede serían código muerto.
- **`turnos`** esqueleto (sede, user, abierto/cerrado) — la caja básica es etapa isla; la columna y la tabla quedan desde ya.
- RLS deny-by-default + `admin_all` + `staff_read` en las 4 tablas nuevas (mismo patrón del schema).
- **`products.stock` se re-interpreta** como "stock en la sede única"; partirlo a `product_stock(product_id, sede_id)` con estados (disponible/reservado/en tránsito/imperfecto) es la migración mecánica de la etapa isla — el dato de HOY no se pierde.

### Antes de la PRIMERA ISLA (no antes)
Partir stock por sede + **reserva de inventario POR CANAL** (presencial/domicilios/recogidas/programados/seguridad — la isla no vende presencialmente lo prometido a domicilios) · **RPCs del flujo de transferencias** (crear→preparar→despachar→tránsito→recibir con diferencia) · **reposición recomendada** por ventas históricas × día/hora × inventario restante × velocidad de venta (ej. del usuario: "Isla Norte vende 18 Oreo los sábados y tiene 6 → reponer 15") · caja presencial básica (venta, producto, cliente, cobro, comprobante, descuento de inventario, empleado, turno, método de pago) + cierres de turno · **QR de captura en isla** ("Regístrate en Pide MOMOS y recibe una malteada en tu próxima compra" — la venta presencial alimenta el CRM) · rutas/mensajeros por nodo (cada isla = base de última milla: entregas agrupadas, tiempos reales, costo por pedido, saturación del nodo) · alertas de stock por sede · **capacidad por ubicación** (pedidos/hora, espacio de congelación, empaque, mensajeros, horarios de corte — en `sedes.config`; Pide MOMOS no acepta más de lo que el nodo puede cumplir) · **rentabilidad por punto** con la fórmula de contribución REAL del usuario (+ ventas presenciales + digitales despachadas + recogidas + clientes captados + ahorro logístico − arriendo − personal − transporte desde Caney − merma − servicios − comisiones; una isla puede ser floja por mostrador y valiosísima como nodo logístico — requiere `expenses` por sede → #11b).

### Antes del LOCAL (no antes)
POS completo, consumo en sitio/mesas, turnos avanzados, permisos por sede, menú por franja, compras/proveedores por punto, integración fiscal/contable profunda.

### Pide MOMOS — implicación (shop)
El MVP del shop NO cambia (domicilio/catálogo/pago/cuenta/embajadores/recompra). Contemplado para activar SIN rehacer: **selección automática del nodo** (el cliente NO elige sede — el sistema decide por distancia/tiempo/inventario/horario/capacidad/costo de domicilio/tipo de producto: "Valle del Lili → Caney; norte → Isla Norte; personalizado → produce y despacha Caney") · modalidades (domicilio / recoger en cocina / recoger en isla / comprar-ahora-recoger-después / programado / consumo en sitio) · **catálogo por ubicación** (productos, sabores, precios especiales, promos, horarios y tiempo de prep POR SEDE — Caney completo, islas alta rotación) · fila virtual, QR en isla, pedidos anticipados. **Cuenta única SIEMPRE**: historial/puntos/beneficios globales compre por domicilio, isla, local, embajador o presencial ✓ (`customers` ya es global — jamás partir el cliente por sede).

### 🚫 Sobreingeniería HOY (lista explícita del usuario — NO construir)
Caja física completa, gestión de mesas, pantallas de cocina por restaurante, facturación multi-sede avanzada, integración con centros comerciales, hardware POS, franquicias. **Añadido nuestro, mismo espíritu: los MOTORES de asignación automática / reposición / flujo de transferencias tampoco se construyen hoy — sin 2ª sede son dead code; lo que se congela hoy es el CONTRATO (tablas + columnas).**

## 🚫 No tocar

- **Flujo de beneficios** (Activo → Reservado en `NuevoPedido` → Usado al pagar → Activo al cancelar). Está BIEN. Un análisis lo marcó como bug pero fue **falso positivo**.
