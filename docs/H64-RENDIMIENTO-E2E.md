# H64 · Rendimiento E2E y sistema de componentes

> Nombre funcional acordado durante la conversación: H62 Rendimiento. El ID técnico será H64 porque el árbol ya reserva `20260718_62_mcp_aprobacion_humana` y `20260718_63_mcp_aprobacion_humana_rbac`. No se debe renumerar ni reemplazar trabajo aplicado o pendiente.

## Objetivo

Hacer que MOMO OPS se sienta rápido y fluido sin debilitar FIFO, stock exacto, RBAC, evidencias, trazabilidad, confirmaciones humanas ni la separación entre MOMO OPS, Codex y los motores creativos.

La extracción de archivos no cuenta como optimización por sí sola. El hito se considera exitoso únicamente si reduce transferencia, trabajo de render, consultas y latencia medidos.

## Estado previo y restricciones

- La cadena canónica validada llega a 01–60.
- H61 Biblioteca de producción, H62 Aprobación humana MCP y su corrección H63 RBAC están en trabajo local y deben estabilizarse antes de integrar H64.
- El árbol contiene cambios sin commit de otros hitos. H64 no debe modificar esos archivos hasta que tengan un punto de recuperación propio.
- `src/MomosOps.jsx` concentra la UI, navegación y estado global.
- H56 ya aporta snapshots, dominios de sincronización, deduplicación Realtime, TTL e historial paginado. H64 extiende ese diseño; no lo reemplaza.
- Meta continúa sin ejecución externa hasta autorización explícita.

## Línea base 2026-07-18

Medición de build de producción local:

| Métrica | Línea base |
| --- | ---: |
| JavaScript inicial | 1.763.570 B sin comprimir |
| JavaScript inicial transferido/gzip | ~463 KB |
| Chunks JavaScript | 1 |
| CSS inicial | 38,24 KB sin comprimir / ~7,42 KB gzip |
| `MomosOps.jsx` | ~15.000 líneas |
| Estilos inline | >1.500 |
| Botones HTML directos | ~100 |
| Pruebas locales previas | 479 PASS |

La medición fría sin autenticación en localhost transfirió ~473 KB y mostró el primer contenido en ~104 ms. Esta cifra solo cubre la pantalla de acceso; la línea base autenticada de Dashboard, Producción, Pedidos, Inventario y Agencia se recogerá con telemetría de sesión real.

Medición autenticada de cinco recargas con caché desactivada:

| Recorrido | Línea base |
| --- | ---: |
| Dashboard `load` | p50 310 ms / p95 376 ms |
| Dashboard sincronizado | p50 331 ms / p95 377 ms |
| Lecturas iniciales Dashboard | 4 |
| Abrir Agencia | 85 solicitudes REST/RPC |
| Batch de Agencia | ~6.001 ms |
| Agencia estable | ~8.166 ms |

La conclusión inicial es precisa: Dashboard no es hoy el cuello principal. La apertura de Agencia y su hidratación ancha dominan la espera; `obtener_identidad_marca` incluso aparece duplicada.

La auditoría estática ubica las causas, no solo los síntomas:

- `fetchCatalogos({ includeAgency: true })` puede disparar aproximadamente 83–85 solicitudes y más de 25 olas secuenciales.
- Una escritura seguida de `refrescar()` vuelve a pagar esa hidratación ancha.
- El bundle contiene los 20 paneles y sus dependencias aunque el rol nunca los abra.
- Cada actualización del `db` raíz clona y reemplaza todas sus referencias; después se serializa el conjunto completo.
- Producción y Agencia representan los primeros límites de carga diferida con mayor retorno.
- El snapshot operativo debe tratar como autoridad vigente cualquier lote `Listo` que todavía aporte stock vendible. No se optimiza ese camino hasta cerrar una prueba adversarial con más de 50 lotes terminales.
- Antes de depender de Realtime se verificará que cada tabla suscrita pertenezca realmente a la publicación `supabase_realtime`.

Para repetir la medición estática:

```powershell
npm run build
node scripts/performance-budget.mjs
node --test src/performance/*.test.js
```

El modo `--enforce` se activará en CI cuando cada fase alcance su presupuesto; al inicio es normal que falle los objetivos.

## Estado de implementación

- Preparado el presupuesto estático reproducible de bundle y tamaño del monolito.
- Reconstruida localmente la cadena 01–63 y confirmadas en el servidor, en modo solo lectura, las capacidades de Biblioteca y aprobación humana MCP. La aplicación de SQL sigue siendo un gate explícito del operador.
- Conectado `src/performance/runtime-performance.js` al cliente Supabase, al coordinador y a la navegación, activo solo en desarrollo o mediante `?momosPerf=1`.
- El núcleo mide HTTP real, bytes declarados, sincronización, navegación lista y atribución por vista —incluida Finanzas— con buffers acotados y p50/p95.
- La telemetría no conserva URL, query, cuerpo, headers, payload, notas, identidad ni mensajes de error.
- Doce pruebas unitarias cubren privacidad, navegación reemplazada, señales tardías, concurrencia, errores de red, telemetría desactivada y atribución de Finanzas.
- Preparada la migración H64 de integridad del snapshot y publicación Realtime, pendiente de aplicación y prueba adversarial en Supabase antes de avanzar a carga diferida funcional.
- Extraído `VoiceKitchenPanel` a un chunk diferido propio: el JavaScript inicial bajó de ~468.574 B a 453.696 B gzip y el chunk de voz pesa ~16.950 B gzip. El build pasa, Producción monta y minimiza Momobot correctamente y el navegador no reporta errores.
- `MomosOps.jsx` bajó de ~15.201 a 13.990 líneas. Este primer corte demuestra el mecanismo, pero no se considera cumplido el presupuesto de bundle: el siguiente ahorro debe separar paneles completos.
- Optimizado el cálculo financiero local con índices por pedido, producto e insumo. En una muestra de 1.200 pedidos y 3.600 líneas pasó de 118,07 ms a 1,94 ms (~60,8×), con equivalencia exacta en 200 escenarios aleatorios.
- Preparada y revisada H65: una lectura financiera íntegra de servidor para que el rango contable no dependa del límite operativo de los últimos 50 pedidos o movimientos. Es exclusiva de Administrador, no expone PII, notas ni rutas, usa `v_order_totals` como fuente canónica y limita cada consulta a 367 días inclusivos.
- Finanzas ya consume H65 únicamente al abrir el panel o cambiar el rango, conserva más de 50 pedidos, descarta respuestas tardías y muestra de forma explícita cualquier respaldo local parcial en vez de presentarlo como un periodo completo.
- El Centro de asistentes y el cálculo financiero se cargan fuera del camino inicial. El JavaScript principal bajó de ~468,57 KB a ~446,94 KB gzip; Momobot (~16,95 KB), Centro de asistentes (~5,36 KB) y Finanzas (~6,87 KB) quedaron en chunks diferidos.
- H64 y H65 pasaron sus pruebas adversariales individuales en Supabase. La cadena ordenada fue ampliada a 01–65 y es el último gate remoto del hito.

## H66 · Snapshot y carga diferida por panel

H66 cierra el cuello principal medido al abrir Agencia sin volver a hidratar los catálogos operativos:

- Agencia usa cuatro snapshots cerrados: resumen, flujo creativo, producción y medición. Con H66 instalado los recibe dentro de una sola fotografía transaccional y ejecuta exactamente un RPC; si la migración aún no existe hace un solo probe y entrega el control al fallback compatible.
- Un payload exclusivo de Agencia solo actualiza Agencia. Nunca reemplaza productos, inventario, usuarios, recetas ni configuración operativa.
- Realtime se reconstruye al cambiar de panel y escucha únicamente los dominios visibles. Agencia no publica sus 66 fuentes crudas: todas invalidan un único `agency_snapshot_events` sanitizado que solo comunica versión y hora de cambio, sin filas, actores, notas, rutas ni secretos. Al quedar suscrito, el cliente compara una vez la versión del singleton para cerrar la ventana entre la fotografía inicial y la activación del canal.
- El contrato de privacidad de Agencia es explícito y verificable: no proyecta registros de clientes ni secretos, reconoce que parte del texto libre no está verificado, prohíbe usar el payload como telemetría y declara las referencias de Storage solo en el alcance de producción.
- Agencia, Pedidos/Empaque, Producción, Inventarios y Finanzas son entradas dinámicas. Finanzas lleva su motor en el mismo grafo estático del panel para evitar una segunda espera en cascada.
- El resumen operativo de Agencia conserva Operación como contexto, pero ya no recarga catálogos core. Identidad oficial viaja como metadato seguro dentro del mismo bundle, por lo que el máximo teórico de apertura normal es tres lecturas: el bundle atómico de Agencia, una fotografía operativa y la comprobación de versión del relevo a Realtime. Las rutas y URLs temporales de los logos se solicitan solo cuando la persona abre el detalle de Identidad.

Medición local final de H66, antes del gate remoto:

| Métrica | Resultado |
| --- | ---: |
| JavaScript inicial gzip | 253.996 / 256.000 B · PASS |
| Chunk JavaScript propio mayor | 470.115 / 512.000 B · PASS |
| CSS inicial gzip | 7.388 / 30.720 B · PASS |
| Chunks JavaScript | 20 |
| Pruebas funcionales | 502 / 502 · PASS |
| Pruebas de rendimiento | 21 / 21 · PASS |
| Build de producción | PASS |

Quedan dos objetivos estructurales que no bloquean el presupuesto de transferencia pero sí deben continuar en el siguiente hito: `MomosOps.jsx` tiene 6.635 líneas frente al objetivo de 5.000 y 479 estilos inline frente al objetivo de 400. La latencia autenticada p50/p95 se medirá después de aplicar H66 en Supabase; no se declara cumplida con una medición local.

Deuda explícita para H67: algunas recomendaciones de Agencia aún combinan el snapshot H66 con productos, inventario, lotes y recetas del snapshot de Catálogos. Las mutaciones siguen protegidas por guards del servidor, pero para mantener esas señales frescas sin volver al fan-out deberá añadirse una versión compacta de hechos operativos al contrato de Agencia, no una nueva hidratación completa de Catálogos.

Gate remoto, en orden:

1. `supabase/agency-snapshot-rendimiento-v1.sql`
2. `supabase/tests/test-agency-snapshot-rendimiento-v1.sql`
3. `supabase/tests/test-migraciones-ordenadas.sql`

## H78 · Cierre de carga diferida y presupuesto frontend

H78 completa la expansión de la carga diferida sin cambiar contratos de servidor ni volver a hidratar el estado global:

- Dashboard, Historial, Productos, Domicilios, Reclamos, Clientes, Beneficios, Reportes, Configuración, Marketing, Creativos, Calendario y Resultados viven en `BusinessPanels`, un chunk de negocio cargado únicamente al entrar en una de esas vistas.
- El paquete inicial conserva solo el shell, la sesión, la navegación y los límites dinámicos. Producción, Pedidos/Empaque, Inventarios, Finanzas, Agencia, Momobot y paneles de negocio siguen separados.
- La navegación se considera lista después de montar el panel real, no al mostrar el fallback de `Suspense`.
- La telemetría E2E expone únicamente contadores, bytes aproximados, percentiles y nombres de dominio cerrados. No conserva URL, payload, filas, identidades, notas ni errores del negocio.
- El coordinador compacta una tormenta sintética de 1.000 invalidaciones Realtime en una sola conciliación posterior. Una prueba adicional aplica 25.000 filas y comprueba que el snapshot técnico no retiene el payload.
- Las pruebas preexistentes conservan la protección frente a desconexión/cambio de vista, respuestas tardías, reintento posterior a errores, cursores antiguos y deltas duplicados.

Comparación reproducible con `npm run perf:budget`:

| Métrica | Antes de H78 | H78 | Límite | Estado |
| --- | ---: | ---: | ---: | --- |
| JavaScript inicial gzip | 283.641 B | 241.056 B | 256.000 B | PASS |
| Chunk JavaScript propio mayor | 472.805 B | 472.805 B | 512.000 B | PASS |
| CSS inicial gzip | 7.448 B | 7.448 B | 30.720 B | PASS |
| Líneas de `MomosOps.jsx` | 8.059 | 4.816 | 5.000 | PASS |
| Estilos inline en `MomosOps.jsx` | 483 | 115 | 400 | PASS |

Medición autenticada local con `?momosPerf=1`, tras recorrer los paneles diferidos:

| Métrica | Resultado | Objetivo |
| --- | ---: | ---: |
| Lectura backend p95 | 420,2 ms | < 500 ms |
| Sincronización p95 | 496,8 ms | < 800 ms |
| Navegación p50 | 6,8 ms | informativa |
| Navegación p95, incluida carga fría | 512,7 ms | < 800 ms |
| Rutas diferidas listas | 9 / 9 medidas | sin errores |

Validación de cierre: 63/63 pruebas de rendimiento, 592/592 pruebas funcionales, build de producción y todos los presupuestos PASS. H78 no necesita una migración: es un hito frontend, de telemetría agregada y pruebas adversariales; la autoridad de datos permanece en H65–H77.

## H80 · Domicilios incrementales por pedido

H80 conecta Domicilios al contrato versionado instalado en H71. La tarjeta y el modal siguen usando el pedido como unidad de trabajo; el identificador `D-xxx` queda exclusivamente como trazabilidad del intento logístico.

- La vista escucha `order_sync_versions` y deja de suscribirse a las tablas operativas crudas cuando la capability de deltas está disponible.
- Asignar un domicilio o actualizar su seguimiento solicita solo `momos_order_deltas_v1` para el pedido afectado.
- El mismo delta trae pedido, cliente, productos e intentos de domicilio del commit ya confirmado.
- Una respuesta tardía se descarta por generación; solo una carrera, un error o una base sin H71 activa la conciliación operativa amplia.
- El panel no ejecuta `refrescar()` en el camino feliz de ninguna mutación logística.

H80 no agrega migración: reutiliza la autoridad, RBAC, outbox y contrato cerrado de H71. Su prueba de integración impide regresar silenciosamente a una recarga global.

## Presupuesto de aceptación

- JavaScript inicial: máximo 250 KiB gzip.
- Ningún chunk JavaScript propio mayor a 500 KB sin comprimir.
- Paneles fuera de la vista actual cargados de forma diferida.
- Interacción p75 menor a 200 ms en el equipo operativo objetivo.
- Sincronización p95 menor a 800 ms y lectura backend p95 menor a 500 ms, medidas con sesión real.
- Máximo tres lecturas de datos en el arranque.
- Agencia pasa de 85 solicitudes a máximo cinco; el resumen inicial debe resolverse idealmente con una sola RPC.
- Finanzas abre con máximo cinco solicitudes y p95 menor a 800 ms; su resumen inicial debe provenir de una lectura consolidada.
- Una mutación actualiza su entidad o dominio; no rehidrata toda la aplicación.
- Producción no descarga código ni datos de Agencia.
- Scroll y filtros fluidos con históricos grandes.
- Cero regresiones en pruebas, build, RBAC, stock, FIFO y trazabilidad.

## Plan incremental

### Fase 0 · Estabilizar antes de refactorizar

1. Cerrar y validar H61/H62/H63 existentes.
2. Actualizar la prueba de migraciones ordenadas antes de aplicar un nuevo SQL.
3. Separar y commitear Higgsfield, Biblioteca de producción y Aprobación MCP.
4. Repetir pruebas, build y `git diff --check`.
5. Guardar línea base autenticada por panel.
6. Corregir o descartar cualquier inconsistencia previa detectada por la auditoría; en particular, confirmar que lotes `Listo` nunca desaparezcan del snapshot operativo y que las tablas suscritas estén realmente publicadas en Realtime.

### Fase 1 · Instrumentación

1. Marcas de navegación, hidratación y primera UI utilizable.
2. Contadores de lecturas por dominio y bytes aproximados recibidos.
3. p50/p95 del coordinador, RPC y Storage.
4. React Profiler en desarrollo para renderizados de tarjetas y paneles.
5. Registro solo técnico: nunca PII, secretos, direcciones, teléfonos o notas libres.

### Fase 2 · Sistema visual reutilizable

Extraer sin cambiar apariencia ni comportamiento:

- `Button`, `AsyncButton`, `Card`, `Modal`, `Badge`, `Tabs`.
- `FormField`, `Select`, `Toast`, `EmptyState`, `Skeleton`.
- `PageHeader`, `KpiGrid`, `EntityCard`, `EntityDetailModal`.
- `QueueCard`, `StatusTimer`, `HistoryTabs`, `MediaCard`, `ConfirmationDialog`.
- Tokens de color, tipografía, espacio, radio y sombra de MOMO OPS.

Cada extracción debe conservar accesibilidad, estados de espera, doble confirmación y mensajes operativos.

### Fase 3 · Producción como piloto

El primer corte será deliberadamente pequeño: la isla de voz, que ya está encapsulada y solo se usa dentro de Producción.

1. Extraer tokens y controles compartidos preservando exactamente sus APIs actuales.
2. Mover `VoiceKitchenPanel` y sus helpers locales a `src/features/production/VoiceKitchenPanel.jsx`.
3. Cargar la isla con `React.lazy` y un `Suspense` local; precargarla al entrar o anticipar Producción para Cocina/Administrador.
4. Exportarla memoizada y estabilizar sus catálogos derivados, sin tocar `db`, FIFO, hidratación, permisos ni RPC.
5. Verificar que Dashboard no solicite el chunk de voz, Producción lo solicite una sola vez y el chunk no arrastre módulos de Agencia.
6. Solo después mover el resto de Producción a un límite diferido propio.
7. Mantener Momobot, cola, lotes, cronómetros y asistente sin cambios funcionales.
8. Comparar tamaño, renders, interacción y consultas antes/después.

No se expande a otros paneles hasta que el piloto pase pruebas y mediciones.

### Fase 4 · Estado por dominios

- Sesión y perfil.
- Catálogos.
- Operación.
- Inventario.
- Finanzas y conciliación.
- Agencia y Biblioteca.
- Estado efímero de interfaz.

Se elimina la clonación y serialización del objeto global completo en cada acción. Los cambios actualizan únicamente el dominio afectado.

### Fase 5 · Backend incremental

1. RPC críticas devuelven la entidad actualizada, versión y `event_id`.
2. Aplicación local del delta antes de una lectura de conciliación.
3. Paginación y filtros en servidor.
4. Columnas mínimas por vista.
5. Índices sustentados por `EXPLAIN (ANALYZE, BUFFERS)` en datos representativos.
6. Miniaturas y URLs firmadas solo al abrir un activo.
7. Realtime limitado al dominio visible y conciliación posterior única.

Nunca se cachea de manera insegura la autoridad de stock, reserva, pago, evidencia o transición de estado.

### Fase 6 · Finanzas operativas

Finanzas tendrá un límite de carga y sincronización propio; no dependerá de hidratar Pedidos, Inventario, Reclamos y Agencia completos para mostrar un resumen.

1. Cargar el panel de Finanzas de forma diferida y consultar un resumen consolidado por rango de fechas.
2. Traer bajo demanda el detalle de ventas, medios de pago, domicilios, compras, reclamos y pauta.
3. Mantener separadas las autoridades: comprobante recibido no equivale a pago confirmado; compra de inventario no duplica costo de ventas; gasto manual de pauta no equivale a gasto respaldado.
4. Hacer que las mutaciones financieras devuelvan saldo, versión y `event_id`, con una sola conciliación posterior.
5. Paginar movimientos y conciliaciones en servidor, conservando filtros, moneda COP y redondeos exactos.
6. Medir solicitudes, bytes, p50/p95 y renders del resumen y del detalle.
7. Ejecutar adversariales de pago/cancelación, domicilios duplicados, costos ausentes, reclamos, Rappi, compras y atribución de pauta.

La interfaz puede cachear vistas de lectura, pero nunca inventar ni adelantar la autoridad de pago, saldo, margen, costo, devolución o conciliación.

### Fase 7 · Expansión y cierre

1. Pedidos y Empaque.
2. Inventario e Inventario terminado.
3. Productos y CRM.
4. Agencia y Biblioteca.
5. Adversarial cruzado entre Pedidos, Producción, Inventarios, Finanzas y Agencia.
6. Adversarial de carreras, desconexión, respuestas tardías y datos grandes.
7. Comparación documentada de línea base contra resultado.
8. Commits pequeños y reversibles por fase.

## Gates de trabajo

- No editar simultáneamente `MomosOps.jsx` desde dos tareas.
- No mezclar migraciones ya aplicadas con una refactorización frontend.
- No hacer una reescritura total: cada fase debe compilar y ser operable.
- Una optimización que rompe consistencia o seguridad se rechaza aunque reduzca tiempo.
- Los presupuestos se revisan con evidencia real; no se elevan solo para hacer pasar CI.

## H81 · Domicilios compacto

- `Domicilios` deja de hidratar todo el dominio Operaciones al entrar.
- `momos_delivery_snapshot_v1(50)` devuelve solo pedidos que requieren Logística, sus líneas, destino y entregas; el historial queda limitado a 50 pedidos.
- La PII de cliente está declarada y limitada a nombre, teléfono y destino porque es necesaria para entregar. No viajan actores, rutas de Storage, evidencias, reclamos, auditoría ni secretos.
- El snapshot se guarda en colecciones propias (`deliveryOrders`, `deliveryOrderItems`, `deliveryCustomers`, `deliveryDeliveries`) y nunca reemplaza el estado global de Pedidos.
- H71 continúa siendo el contrato incremental: cada cambio actualiza la orden global y su proyección logística sin una segunda hidratación.
- El fallback de una carrera o una desconexión relee Logística, no Operaciones completas.
- RBAC: solo Administrador, Logística y Mensajero pueden leer el snapshot.

## H82 · Domicilios sin lectura posterior

- Asignar, editar y confirmar `En ruta` o `Entregado` usa una sola RPC transaccional.
- Cada intención conserva una llave UUID idempotente durante reintentos de red; repetirla no crea otro domicilio.
- La respuesta contiene el delta H71 exacto del pedido desde el mismo commit y la interfaz lo aplica localmente.
- El camino feliz no vuelve a consultar Pedidos ni Logística; solo concilia si la respuesta llega vencida, inválida o el servidor aún no tiene H82.
- Los recibos son privados, no guardan dirección, teléfono ni notas, y el contrato declara PII sin exponer secretos.
- RBAC: solo Administrador, Logística y Mensajero pueden ejecutar la mutación.

## H88 · Publicación incremental del estado

H88 elimina del camino crítico de Realtime y de las mutaciones dirigidas la clonación y normalización del árbol global completo de React.

- Los deltas de Pedidos, Inventario terminado, Producción, Catálogo y CRM crean únicamente las colecciones que realmente modifican.
- Los dominios no afectados conservan su referencia; una actualización de una orden ya no recorre inventario, finanzas, agencia ni biblioteca.
- La normalización global permanece exclusivamente en snapshots completos y restauraciones, donde sigue siendo necesaria por compatibilidad.
- Los productos recibidos por delta derivan localmente sus atributos operativos, sin depender de una normalización posterior de toda la base.
- Las pruebas usan 25.000 filas ajenas para comprobar inmutabilidad y reutilización estructural, y una prueba de integración impide volver a invocar `update()` o `normalizeDbShape()` desde los deltas dirigidos.

H88 es exclusivamente frontend y no necesita migración de Supabase. No cambia autoridad, RBAC, idempotencia, FIFO, pagos ni contratos instalados en H64–H87.

## H89 · Dependencias diferidas por dominio

H89 evita que el arranque descargue motores que solo se utilizan después de abrir Backoffice o Agencia.

- La configuración mínima de Agencia vive en un módulo pequeño e independiente; el motor completo de inteligencia queda junto al chunk diferido de Agencia.
- CRM, calendario comercial, distribución, despacho e historial operativo se importan directamente desde `BusinessPanels`, no desde el shell inicial.
- El contrato compartido del panel deja de transportar helpers de dominio que el arranque no ejecuta.
- Las pruebas estructurales impiden que estas dependencias vuelvan a importarse desde `MomosOps.jsx`.

Medición de producción H89:

- JavaScript inicial: 246.641 → 232.480 bytes gzip, ahorro de 14.161 bytes (5,7 %).
- Margen bajo el presupuesto de 256.000 bytes: 23.520 bytes.
- Chunk mayor: Agencia, 472.848 bytes crudos; continúa bajo el límite de 512.000 bytes.
- `MomosOps.jsx`: 4.921 líneas; estilos inline: 115.

H89 es exclusivamente frontend y no necesita migración de Supabase. La carga diferida cambia el momento de descarga del código, no los datos, permisos ni decisiones operativas.
