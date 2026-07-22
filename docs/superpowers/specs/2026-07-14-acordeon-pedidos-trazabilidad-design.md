# Acordeón de pedidos con trazabilidad inline — Diseño

**Fecha:** 2026-07-14
**Estado:** Diseño APROBADO (brainstorming). Pendiente: plan de implementación + build en **sesión fresca** (se frenó acá por costo, no por bloqueo técnico).
**Reemplaza:** el modo **"Control y trazabilidad"** de `Pedidos` — hoy `PanelTrazabilidadPedidos`, un master-detail lado-a-lado.

## Objetivo
Convertir el panel de trazabilidad (master-detail) en un **acordeón**: una lista vertical de pedidos donde, al hacer click en una fila, se despliega **hacia abajo, in-place**, toda la información del pedido y su trazabilidad. Interacción más fluida, sin saltar a otra vista.

## Interacción
- **Fila colapsada:** muestra lo esencial — `id`, cliente, badge de **estado + health**, y la **siguiente acción** (lo que hoy tiene la columna izquierda de `PanelTrazabilidadPedidos`).
- **Click → se expande hacia abajo** in-place con TODAS las secciones del detalle actual: cabecera + flujo (ya sobrio, sin barra), cliente/destino, pago/valor, contenido y control físico, grid responsable/evidencias/reservas/domicilio, y el timeline "Trazabilidad completa".
- **Uno a la vez por default:** abrir una fila cierra la anterior.
- **Toggle "Comparar"** en la barra: activado, abrir un pedido **no** cierra los otros → varios desplegados a la vez para comparar.
- Despliegue con **animación de altura** suave. Contrato visual sobrio: tokens `T` + semánticos establecidos, borde-izq rosa, sin barras/gradientes/heros.

## Arquitectura (reuso = bajo riesgo)
- **Data:** reusa `buildOrderTraceability(db, order)` tal cual. **Cero lógica de dominio nueva.**
- **Extracción:** las secciones del detalle derecho actual se extraen a un subcomponente reutilizable **`DetalleTrazabilidad({ trace, db, onOpen })`**, que se renderiza inline dentro de cada card expandida. Bonus: parte el monolito JSX (~90 líneas) de `PanelTrazabilidadPedidos` en piezas legibles y testeables.
- **`PanelTrazabilidadPedidos`** pasa de master-detail a **acordeón**:
  - Estado: `abiertos: Set<orderId>` + `comparar: boolean`. Modo normal → abrir setea `new Set([id])` (máx 1); modo comparar → toggle add/remove.
  - Encabezado: mantiene la fila de `Stat` actual + agrega el toggle "Comparar".
  - Cuerpo: `traces.map` → fila colapsada (botón, `aria-expanded`) + `{abiertos.has(id) && <DetalleTrazabilidad .../>}`.
- **`DetallePedido`** (acciones de escritura) sigue accesible por el botón "Abrir pedido completo".

## Read-only
El panel sigue **sin escrituras**. Las transiciones (con su juice `toast` + try/catch separado) viven en `DetallePedido` / `Pedidos.cambiar()`. **No se agrega juice nuevo.**

## Fuera de alcance (YAGNI)
- No toca Kanban ni Tabla.
- No agrega acciones de escritura al panel.
- No cambia `buildOrderTraceability` ni el modelo de datos.

## Verificación esperada
- `npm run build` + `npm test` verdes.
- Accesibilidad: fila colapsada = botón con `aria-expanded`; contenido expandido como `role="region"` con `aria-labelledby` al id del pedido.
- Visual en vivo: revisión de Julián en su server (la app está auth-gated).

## Ubicaciones de referencia (repo tras commit `6b4cb3f`)
- `src/MomosOps.jsx`: `PanelTrazabilidadPedidos` (~L2821), pestaña "Control y trazabilidad" en `Pedidos` (~L3006 / render ~L3045).
- Helper de data: `buildOrderTraceability` (lib `order-traceability.js`).

## Próximo paso
Sesión fresca: invocar `writing-plans` sobre este spec → plan de implementación → build con verificación (build + tests + revisión visual de Julián).
