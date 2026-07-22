# Migraciones ordenadas de MOMOS OPS

Estas migraciones se aplican **una por una** en el SQL Editor de Supabase. No
pegues dos archivos en la misma ejecución. Cada archivo usa una transacción y
un advisory lock; un error hace rollback completo del paso actual.

## Orden obligatorio

1. `00-preflight.sql` — solo inspecciona; termina con `rollback`.
2. `01-evidencias-seguras.sql` — elimina el bypass de fotos y evita reutilizar rutas.
3. `02-integridad-pedidos.sql` — exige cantidades enteras y variantes válidas.
4. `../roles-flujo-pedidos-v1.sql` — instala la matriz de responsabilidades.
5. `../tiempos-pedidos-v1.sql` — crea los tiempos configurables.
6. `../admin-operacion-pedidos-v1.sql` — consolida al Administrador como respaldo.
7. `../fifo-variantes-exactas-v1.sql` — activa FIFO por producto + figura + sabor.
8. `../listo-para-empaque-v1.sql` — activa el relevo Cocina → Empaque.
9. `08-sello-rbac.sql` — instala defensa a nivel tabla y sella permisos finales.
10. `../empaque-trazable-v1.sql` — registra la verificación línea por línea antes de Empacado.
11. `../domicilio-empaque-v1.sql` — habilita copia/etiqueta y sella la solicitud al relevo Empaque–Logística.
12. `../inventario-vencimientos-v1.sql` — cuarentena vencidos, FIFO vigente y constraints de stock.
13. `../inventario-lotes-v1.sql` — registra compras y consumos FIFO por lote de insumo.
14. `../productos-servidor-v1.sql` — sella productos, combos y recetas en servidor.
15. `../control-operativo-pedidos-v1.sql` — responsables, progreso, incidentes y relevo físico.
16. `../crm-clientes-v2.sql` — historial, activaciones y contactos CRM.
17. `../agencia-comercial-v1.sql` — agencia comercial y decisiones protegidas.
18. `../vencimiento-producto-terminado-v1.sql` — sella desmolde y vencimiento automático a 3 días.
19. `../abastecimiento-elaboraciones-internas-v1.sql` — separa compra de preparación y bloquea comprar mousses, cheesecake, ganache y salsas internas.
20. `../distribucion-comercial-v1.sql` — checklist, aprobación humana y evidencia de publicación.
21. `../biblioteca-creativa-v1.sql` — originales, derechos, trazabilidad y estudio creativo.
22. `../roles-multiples-v1.sql` — acumula roles por usuario sin duplicar su correo ni debilitar RBAC.
23. `../produccion-creativa-v1.sql` — autoriza trabajos creativos con tope de costo y contrato privado para conectores.
24. `../integraciones-agencia-v1.sql` — registra salud y cuentas de Higgsfield, HeyGen, Meta y TikTok sin guardar secretos en tablas públicas.
25. `../higgsfield-conector-v1.sql` — instala el worker privado con lease único, idempotencia, costo protegido y salida en revisión humana.
26. `../kling-conector-v1.sql` — instala Kling 3.0 con API Key privada, reserva de costo, idempotencia y conciliación sin doble cobro.
27. `../revision-creativa-v1.sql` — sella aprobación, cambios o descarte de cada salida generada sin publicarla automáticamente.
28. `../versiones-creativas-v1.sql` — abre una versión nueva desde cambios solicitados sin sobrescribir originales ni heredar costos.
29. `../tests/test-vencimiento-producto-terminado.sql` — prueba adversarial específica; siempre hace rollback.
30. `../tests/test-abastecimiento-elaboraciones-internas.sql` — prueba que las elaboraciones solo entren por producción y las compras externas sigan funcionando.
31. `../tests/test-roles-multiples-v2.sql` — prueba roles acumulables, no duplicados y anti-lockout; siempre hace rollback.
32. `../tests/test-produccion-creativa-v1.sql` — prueba autorización, costos, reintentos, conector y RBAC; siempre hace rollback.
33. `../tests/test-integraciones-agencia-v1.sql` — prueba salud, secretos, heartbeat y RBAC; siempre hace rollback.
34. `../tests/test-higgsfield-conector-v1.sql` — prueba doble despacho, tope, salida privada, revisión humana y RBAC; siempre hace rollback.
35. `../tests/test-kling-conector-v1.sql` — prueba API Key privada, despacho incierto, anti-reenvío, costo, salida y RBAC; siempre hace rollback.
36. `../tests/test-revision-creativa-v1.sql` — prueba decisión única, derechos, no publicación y RBAC; siempre hace rollback.
37. `../tests/test-versiones-creativas-v1.sql` — prueba cadena, costo cero, fuentes originales y RBAC; siempre hace rollback.
38. `../tests/test-migraciones-ordenadas.sql` — aceptación completa; devuelve `TESTS_OK` y hace rollback explícito.

## Continuación de Agencia hasta audio de postproducción

La cadena vigente continúa después de los pasos listados arriba y ya llega al hito 48. Si la base ya muestra `20260716_47_postproduccion_exportacion`, el siguiente paso es:

39. `../audio-postproduccion-v1.sql` — sella audio original o pista exacta de Biblioteca por exportación y actualiza el contrato del worker.
40. `../tests/test-audio-postproduccion-v1.sql` — prueba archivo, derechos, canal, mezcla, aislamiento del worker y RBAC; siempre hace rollback.
41. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–48; siempre hace rollback.

## Hito 51 · eliminación segura de Biblioteca

Después de tener aplicada la cadena 01–50:

42. `../eliminacion-biblioteca-v1.sql` — permite eliminar el archivo real únicamente cuando nunca fue usado y conserva una lápida mínima de auditoría.
43. `../tests/test-eliminacion-biblioteca-v1.sql` — intenta borrar originales usados, valida compensación ante fallos de Storage y confirma el borrado seguro; siempre hace rollback.
44. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–51; siempre hace rollback.

## Hito 52 · catálogo completo de figuras

45. `../catalogo-figuras-toby-v1.sql` — mantiene Momo y Toby activos en el catálogo y corrige Toby a 280 g sin cambiar su producto asociado.
46. `../tests/test-catalogo-figuras-toby-v1.sql` — valida catálogo, gramaje y protección RBAC; siempre hace rollback.
47. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–52; siempre hace rollback.

## Hito 53 · motor de crecimiento multimodo

H53 ya está aplicado. Se conserva aquí para reconciliar la cadena técnica antes de continuar:

48. `../motor-crecimiento-multimodo-v1.sql` — sella los modos venta inmediata, conquistar demanda, marca/comunidad y pauta/aprendizaje sin ejecutar acciones externas.
49. `../tests/test-motor-crecimiento-multimodo-v1.sql` — prueba separación Pauta/Orgánico, PII, decisión humana, idempotencia, no ejecución y RBAC; siempre hace rollback.
50. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–53; siempre hace rollback.

## Hito 54 · Biblioteca Creativa vía MCP (aplicado y validado)

Aplicar únicamente después de confirmar que `20260717_53_motor_crecimiento_multimodo` aparece en `public.momos_ops_migrations`:

51. `../mcp-biblioteca-creativa-v1.sql` — instala búsqueda semántica privada y recursos MCP opacos temporales verificados de hasta 25 MB; aplica gates de archivo real, derechos, IA, vigencia y canal sin exponer URL, ruta del host, PII o secretos. Originales mayores requieren worker privado.
52. `../tests/test-mcp-biblioteca-creativa-v1.sql` — debe probar RBAC, auditoría exacta, idempotencia, vencimiento entre búsqueda y concesión, integridad del archivo, bloqueo concurrente de borrado, revisión humana y cero publicación; siempre hace rollback.
53. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–54; siempre hace rollback.

**Estado H54:** migración aplicada; prueba adversarial y aceptación 01–54 PASS con rollback total. SQL parseable, suite local 453/453 y build PASS. Reiniciá una sesión MCP anterior antes de comprobar la búsqueda y referencia de un original real desde Codex.

## Hito 55 · Identidad de marca operable (aplicado y validado)

Aplicado después de `20260717_54_mcp_biblioteca_creativa`:

54. `../identidad-marca-v1.sql` — instala el kit oficial versionado, enlaza logos reales de Biblioteca y usa `agency_brand_color_tokens.kit_id` para la paleta semántica. Los kits aprobados y sus gates quedan sellados.
55. `../tests/test-identidad-marca-v1.sql` — valida logos, paleta, versionado, inmutabilidad, PII, gates y RBAC; siempre hace rollback.
56. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–55; siempre hace rollback.

**Estado H55:** migración `20260717_55_identidad_marca` ya aplicada; adversarial específico y aceptación ordenada PASS con rollback total. No debe reemplazarse por la implementación paralela que vinculaba los tokens de color directamente mediante `brand_profile_id`.

## Hito 56 · Data Sync y rendimiento (aplicado y validado)

Aplicado después de `20260717_55_identidad_marca`:

57. `../data-sync-rendimiento-v1.sql` — instala manifiesto y snapshots acotados para catálogos y operación, además de historial paginado por cursor.
58. `../tests/test-data-sync-rendimiento-v1.sql` — valida sesión, snapshots, paginación, dominios, capacidades, PII y RBAC; siempre hace rollback.
59. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–56; siempre hace rollback.

**Estado H56:** migración `20260717_56_data_sync_rendimiento` ya aplicada y validada. El frontend usa coordinación Realtime, carga Agencia solamente en sus vistas, pagina el historial y firma evidencias o vistas previas únicamente cuando se solicitan.

Los SQL H55 y H56 se conservan aquí como historial reproducible de la base. No deben volver a ejecutarse en la base actual cuando sus IDs ya aparecen en `public.momos_ops_migrations`.

## Hito 78 · estados físicos de Producción

Aplicar únicamente después de confirmar `20260719_77_dashboard_operativo`:

1. `../produccion-estados-fisicos-v1.sql` — limita la RPC del lote a En preparación, Congelando y Listo; Reservado/Vendido quedan derivados por pedido y FIFO.
2. `../tests/test-produccion-estados-fisicos-v1.sql` — prueba RBAC, no-op físico y bloqueo de los cuatro estados manuales ambiguos; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–78; siempre hace rollback.

## Hito 79 · historial operativo paginado

Aplicar únicamente después de confirmar `20260719_78_produccion_estados_fisicos`:

1. `../historial-operativo-paginado-v1.sql` — filtra búsqueda, área y fechas en servidor; pagina por cursor estable y limita cada lectura a 50 movimientos.
2. `../tests/test-historial-operativo-paginado-v1.sql` — prueba cursores, filtros, fechas, privacidad, búsquedas sensibles, índices y RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–79; siempre hace rollback.

## Hito 80 · preflight obligatorio de elaboraciones

Aplicar únicamente después de confirmar `20260719_79_historial_operativo_paginado`:

1. `../produccion-preflight-elaboraciones-v1.sql` — impide crear un lote por subrecetas si no existe stock completo de mousse, cheesecake y ganache; bloquea las filas de inventario para evitar doble consumo concurrente.
2. `../tests/test-produccion-preflight-elaboraciones-v1.sql` — prueba el rechazo transaccional, ausencia de corrida/lote huérfano, mensaje operativo y RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–80; siempre hace rollback.

## Hito 81 · snapshot compacto de Domicilios

Aplicar únicamente después de confirmar `20260719_80_produccion_preflight_elaboraciones`:

1. `../domicilios-snapshot-v1.sql` — entrega a Logística un snapshot aislado, versionado y acotado de pedidos, destinos y domicilios; excluye Rappi y no hidrata la operación completa.
2. `../tests/test-domicilios-snapshot-v1.sql` — prueba contrato cerrado, límites, PII necesaria, versión, manifiesto y RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–81; siempre hace rollback.

## Hito 82 · mutaciones atómicas de Domicilios

Aplicar únicamente después de confirmar `20260719_81_domicilios_snapshot`:

1. `../domicilios-mutaciones-atomicas-v1.sql` — asigna, actualiza y cambia el estado logístico con llave idempotente; devuelve el delta exacto H71 del pedido desde el mismo commit y evita una lectura posterior en el camino feliz.
2. `../tests/test-domicilios-mutaciones-atomicas-v1.sql` — prueba contrato cerrado, misma transacción, versiones, reintentos, privacidad y RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–82; siempre hace rollback.

## Hito 83 · vida útil configurable de Producción

Aplicar únicamente después de confirmar `20260719_82_domicilios_mutaciones_atomicas`:

1. `../vida-util-produccion-configurable-v1.sql` — agrega en Configuración la vida útil de producto terminado y mezclas; inicia en 6 y 5 días, recalcula la adopción inicial y sella cada lote nuevo para que cambios posteriores no lo rejuvenezcan.
2. `../tests/test-vida-util-produccion-configurable-v1.sql` — prueba fechas de producto terminado, lotes de elaboraciones, inmutabilidad, rango y RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–83; siempre hace rollback.

No ejecutes el worker de postproducción 1.1.0 con trabajos pendientes hasta aplicar el paso de audio: el worker nuevo exige el contrato `audio_binding` y falla cerrado si el servidor aún entrega el contrato H47 antiguo.

Después de cada paso ejecutá:

```sql
select id, applied_at, detalle
from public.momos_ops_migrations
order by applied_at, id;
```

No continúes si el identificador del paso no aparece. Guardá un backup de la
base antes del paso 1 y no reapliques `rpc-pedidos-v1.sql` ni
`normalizacion-clientes-v1.sql` después del paso 11: son fuentes históricas que
pueden reemplazar las envolturas operativas. Si alguna vez se reaplican, volvé
a ejecutar los pasos 8, 9, 10 y 11 inmediatamente.

Si el preflight informa que falta `lote_figuras`, la base todavía no tiene la
cadena previa de variantes. En ese caso no continúes con este paquete: primero
deben verificarse y aplicar, en ese orden, `variantes-v1.sql`,
`variantes-1b-fifo.sql` y `variantes-2-cola.sql`.

## Hito 84 · desecho trazable de producto terminado

Aplicar únicamente después de confirmar `20260719_83_vida_util_produccion`:

1. `../desecho-producto-terminado-v1.sql` — retira el saldo libre vencido por lote + figura, conserva el rendimiento histórico, no toca reservas, exige la cantidad que la persona vio, usa el orden canónico de locks producto → figura y anuncia una capacidad H84 independiente al frontend.
2. `../tests/test-desecho-producto-terminado-v1.sql` — prueba cantidad exacta, vista concurrente obsoleta, idempotencia, vigencia, ledger y RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–84; siempre hace rollback.

## Hito 85 · fichas técnicas versionadas de Cocina

Aplicar únicamente después de confirmar `20260720_84_desecho_producto_terminado`:

1. `../fichas-tecnicas-cocina-v1.sql` — separa BOM de procedimiento, conserva una versión vigente por subreceta y declara explícitamente los procesos aún no estandarizados.
2. `../tests/test-fichas-tecnicas-cocina-v1.sql` — prueba versiones, confirmación humana, contrato cerrado, snapshot compacto y RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–85; siempre hace rollback.

## Hito 86 · gestión guiada de fichas técnicas

Aplicar únicamente después de confirmar `20260720_85_fichas_tecnicas_cocina`:

1. `../gestion-fichas-tecnicas-cocina-v1.sql` — permite a Cocina proponer una versión sin alterar la vigente, reserva la publicación a Administración, conserva historial y despierta las tablets mediante un cursor Realtime sin receta ni PII.
2. `../tests/test-gestion-fichas-tecnicas-cocina-v1.sql` — prueba borrador, confirmación humana, publicación, archivo, historial, cursor compacto y RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–86; siempre hace rollback.

## Hito 87 · fórmulas de elaboraciones internas

Aplicar únicamente después de confirmar `20260720_86_gestion_fichas_tecnicas`:

1. `../formulas-elaboraciones-internas-v1.sql` — versiona juntos fórmula por 1.000 g y procedimiento, bloquea dependencias circulares y publica ambos atómicamente desde Inventario.
2. `../tests/test-formulas-elaboraciones-internas-v1.sql` — prueba duplicados, ciclos, borrador, confirmación humana, publicación, separación de Productos, historial, integridad y RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–87; siempre hace rollback.

## Hito 88 · snapshots aislados por rol

Aplicar únicamente después de confirmar `20260720_87_formulas_elaboraciones`:

1. `../aislamiento-snapshots-por-rol-v1.sql` — instala catálogos v3 y operación v2 con proyección por la unión de roles; Cocina no recibe PII, pagos, Storage ni CRM, y Marketing/CRM no recibe direcciones exactas ni logística.
2. `../tests/test-aislamiento-snapshots-por-rol-v1.sql` — presta una identidad autenticada a Cocina, Marketing/CRM y Administración para probar aislamiento real, contrato, privacidad y RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–88; siempre hace rollback.

**Despliegue en dos fases:** H88 debe aplicarse y comprobarse antes de H89. H89 retirará las políticas `staff_read` de las tablas con PII una vez que todas las sesiones consuman estos snapshots protegidos.

## Hito 89 · cierre de lecturas PII por rol

Aplicar únicamente después de confirmar `20260720_88_aislamiento_snapshots_rol`:

1. `../cierre-lecturas-pii-por-rol-v1.sql` — vuelve obligatorios los snapshots H88, publica un perfil propio mínimo y retira las políticas de lectura directa sobre clientes, pedidos, domicilios, evidencias, reclamos, CRM y trazabilidad sensible.
2. `../tests/test-cierre-lecturas-pii-por-rol-v1.sql` — intenta extraer tablas como Cocina y CRM, comprueba el perfil propio, conserva Administración y valida RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente 01–89; siempre hace rollback.

La optimización frontend denominada H89 en `docs/H64-RENDIMIENTO-E2E.md` no era una migración de base. Este hito usa el número reservado en Supabase para completar el cierre de seguridad previsto por H88.

## Hito 90 · dominio canónico de figuras y presentaciones

H89 fue validado primero. El saldo agregado histórico de PR08 se concilió con
`../reconciliar-pr08-antes-h90.sql`: se verificó que no existían lotes, variantes,
reservas ni sugerencias vigentes, se conservó el pedido histórico y quedó el
asiento auditable `AR-H90-PR08` con el antes/después.

Cuando `20260720_89_cierre_lecturas_pii` aparezca aplicado y validado, y PR08
no conserve stock, lotes, reservas ni sugerencias activas:

1. `../dominio-productos-figuras-canonico-v1.sql` — separa figura física,
   presentación comercial, sabor y caja; usa `figuras.product_id` como vínculo
   exacto y bloquea la selección histórica por especie.
2. `../tests/test-dominio-productos-figuras-canonico-v1.sql` — intenta
   reintroducir figuras no canónicas, componentes no físicos, cruces de familia
   y figuras incompatibles dentro y fuera de cajas; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente
   01–90; siempre hace rollback.

H90 quedó aplicado únicamente después de esa conciliación explícita; su
preflight sigue fallando cerrado si cualquier futura reclasificación intenta
ocultar stock, lotes, reservas o sugerencias activas.

## Hito 91 · mutaciones operativas compuestas y atómicas

Aplicar únicamente después de confirmar `20260720_90_dominio_productos_figuras`:

1. `../mutaciones-compuestas-atomicas-v1.sql` — convierte el relevo Cocina →
   Empaque, la corrida con sugerencias agrupadas y la compra con recomendaciones
   de abastecimiento en tres transacciones únicas, bloqueadas e idempotentes.
2. `../tests/test-mutaciones-compuestas-atomicas-v1.sql` — fuerza un error en el
   segundo paso de cada operación, exige rollback total y después comprueba
   éxito, replay, contrato cerrado, pertenencia, privacidad y RBAC.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente
   01–91; siempre hace rollback.

El fallback de frontend a las RPC anteriores existe únicamente para un
despliegue escalonado. Cualquier error distinto a “RPC ausente” falla cerrado y
nunca ejecuta el antiguo flujo partido.

## Hito 92 · centro de salud operativa y contingencia

Aplicar únicamente después de confirmar `20260721_91_mutaciones_compuestas_atomicas`:

1. `../centro-salud-operativa-v1.sql` — instala monitor servidor, chequeos e
   incidentes sanitizados, correlación de errores, recibos verificables de
   backup, heartbeat del worker y modo de Solo lectura sobre el núcleo.
2. `../tests/test-centro-salud-operativa-v1.sql` — provoca una divergencia de
   inventario, exige congelamiento real, bloquea la reactivación prematura,
   simula reparación y valida backup, worker, privacidad y RBAC; siempre hace
   rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente
   01–92; siempre hace rollback.

Si `pg_cron` ya existe, la migración programa la revisión cada cinco minutos.
En caso contrario, ejecutar `npm run worker:health` bajo un supervisor privado;
`npm run worker:health:check` valida un único ciclo sin abrir el navegador.

## Hito 93 · continuidad y recuperación verificable

Aplicar únicamente después de confirmar `20260721_92_centro_salud_operativa`:

1. `../continuidad-recuperacion-v1.sql` — separa backup observado, restauración
   ensayada y certificación RPO/RTO; agrega política versionada, exportación por
   rol y bitácora idempotente para operar durante Solo lectura.
2. `../tests/test-continuidad-recuperacion-v1.sql` — prueba evidencia inmutable,
   rechazo de RPO/RTO incumplidos, privacidad de Cocina, replay, conciliación y
   RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente
   01–93; siempre hace rollback.

`npm run worker:continuity:observe` registra lo que informa el plano de backups
de Supabase, pero no declara el respaldo recuperable. La certificación se obtiene
únicamente después del simulacro mensual descrito en
`docs/MOMOS-OPS-CONTINUIDAD-RUNBOOK.md`.

## Hito 94 · certificación de concurrencia, carga y caos

Aplicar únicamente después de confirmar `20260721_93_continuidad_recuperacion`:

1. `../certificacion-concurrencia-caos-v1.sql` — instala un dominio sintético
   aislado para probar idempotencia, respuesta perdida, última unidad, leases,
   rollback atómico, lecturas paralelas, tormentas Realtime y conciliación sin
   crear pedidos ni modificar inventario o finanzas.
2. `../tests/test-certificacion-concurrencia-caos-v1.sql` — prueba contrato
   cerrado, evidencia inmutable, RBAC, privacidad y separación estricta entre
   “validado sintético” y “certificado en staging”; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente
   01–94; siempre hace rollback.

`npm run test:resilience:synthetic` ejecuta concurrencia real contra Supabase
con la service role desde un entorno privado. Por defecto solo puede emitir
`Validado sintetico`. Para certificar staging se requieren tanto
`MOMOS_H94_ENVIRONMENT=Staging` como
`MOMOS_H94_ALLOW_STAGING=CERTIFY_NON_PRODUCTION`; nunca debe apuntar al proyecto
de producción. Los probes solo escriben en las tablas privadas H94.

La certificación real se ejecuta mediante
`.github/workflows/staging-database-gate.yml`. El gate compara el ref de staging
contra producción, valida la URL exacta, corre la cadena 01–100 y H93, repite las
adversariales H94–H97 y el recorrido H100 con rollback, ejecuta el runner H99 con 64 contendientes y
2.000 solicitudes materializadas y exige en servidor un certificado fresco con
cero invariantes. Sin los cinco secretos del environment `staging`, el flujo
falla cerrado antes de instalar dependencias o abrir una corrida. El runner puede
emitir además un recibo JSON sin PII ni secretos mediante
`MOMOS_H94_REPORT_PATH`.

## Hito 100 — piloto operativo interno reejecutable

Aplicar después de confirmar `20260721_97_evidencia_recuperacion_derivada`:

1. `../piloto-operativo-interno-v1.sql` — corrige la firma del relevo
   Empaque–Logística usando SHA-256 nativo, sin depender de la ubicación de
   `pgcrypto.digest`, y conserva RBAC, bloqueo y auditoría.
2. `../tests/test-piloto-operativo-e2e-v1.sql` — recorre Pago, Cocina, Empaque,
   Logística y Entrega mediante las RPC canónicas, prueba reintentos, roles,
   firma de comanda, CRM y limpieza; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente
   01–100; siempre hace rollback.

H98 continúa diferido hasta producción y H99 es una certificación de carga, no
una migración de esquema. Por eso la numeración salta de la migración H97 a H100.
El recibo `docs/H100-STAGING-INTERNAL-PILOT-2026-07-22.json` declara de forma
explícita lo que el ensayo no cubre: checkout público, webhook de pago, cliente
real, carga de archivos y tráfico alto sostenido.

## Hito 102 — piloto comercial controlado

Aplicar después de confirmar `20260722_100_piloto_operativo_interno`:

1. `../piloto-comercial-controlado-v1.sql` — instala el contrato privado para
   una muestra cerrada de 1–20 pedidos ya pagados, cuatro firmas humanas, salud
   y recuperación vigentes, idempotencia durable y conciliación de evidencia y
   margen. No crea pedidos, no cobra y nunca abre tráfico.
2. `../tests/test-piloto-comercial-controlado-v1.sql` — intenta abrir Producción
   sin confirmación, iniciar sin firmas o en solo lectura, vincular un pedido no
   pagado, repetirlo, exponer PII y saltar RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente
   01–102; siempre hace rollback.

H101 fue una certificación de interfaz en staging, no una migración de esquema.
Por eso la cadena de migraciones salta de H100 a H102. Aplicar H102 tampoco
ejecuta un piloto real: la operación sigue pendiente hasta que el equipo apruebe
una ventana y vincule pedidos reales ya pagados.

## Hito 95 — observabilidad y SLO agregados

Aplicar únicamente después de confirmar `20260721_94_certificacion_concurrencia_caos`:

1. `../observabilidad-slo-v1.sql` — extiende el Centro de Salud H92 con siete
   dominios cerrados, disponibilidad, error budget, p50/p95/p99 por histograma,
   saturación, cola, vigencia e ingestión privada idempotente; no guarda rutas,
   requests, mensajes libres, actores, clientes, PII ni secretos.
2. `../tests/test-observabilidad-slo-v1.sql` — prueba percentiles, objetivos,
   idempotencia, versión optimista, privacidad y RBAC; siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente
   01–95; siempre hace rollback.

El worker `operational-health-worker` 1.1.0 reporta su propia latencia y éxito a
`HEALTH_MONITOR`. Los demás dominios permanecen honestamente `Sin datos` hasta
que su proceso privado reporte evidencia; MOMO OPS nunca inventa salud por
ausencia de telemetría.

## Hito 96 — telemetría real y alertas operativas

Aplicar únicamente después de confirmar `20260721_95_observabilidad_slo`:

1. `../telemetria-operativa-alertas-v1.sql` — recibe un lote agregado por minuto
   desde el navegador para Interfaz, RPC, Realtime y Storage; agrega sondas
   privadas de Base de datos e Integraciones y genera alertas deduplicadas por
   presupuesto de error, p95, saturación, cola y señal vencida. No acepta URL,
   RPC, vista, usuario, pedido, payload, texto libre, PII ni secretos.
2. `../tests/test-telemetria-operativa-alertas-v1.sql` — prueba idempotencia,
   contrato cerrado, RBAC, privacidad, sonda y deduplicación; siempre rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente
   01–96; siempre hace rollback.

El worker `operational-health-worker` 1.2.1 reporta `HEALTH_MONITOR`, `DATABASE`
y `CONNECTORS`, y evalúa alertas. La interfaz agrega las cuatro señales cliente
una vez por minuto y nunca bloquea una acción operativa si la observabilidad no
está disponible. Cada proceso abre su propio espacio idempotente para que un
reinicio o una comprobación manual dentro del mismo minuto no choque con otra
medición que tenga un histograma de latencia distinto.

## Hito 97 — evidencia de recuperación derivada

Aplicar únicamente después de confirmar `20260721_96_telemetria_alertas`:

1. `../evidencia-recuperacion-derivada-v1.sql` — reemplaza RPO/RTO declarados
   por cálculos de servidor, exige cronología posible, añade manifiestos sellados
   para Storage y replay y revoca la presentación de certificaciones antiguas sin
   esa evidencia. El contrato público continúa siendo `momos.continuity.v1`.
2. `../tests/test-evidencia-recuperacion-derivada-v1.sql` — intenta falsificar
   tiempos, omitir Storage, exceder RPO, reescribir evidencia y ampliar RBAC;
   siempre hace rollback.
3. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente
   01–97; siempre hace rollback.

La migración no restaura ni elimina nada. Un Administrador técnico restaura
primero un backup en staging aislado y después ejecuta manualmente
`.github/workflows/continuity-recovery-drill.yml`. El workflow valida la cadena,
las pruebas H93/H97, Storage y replay antes de registrar el resultado compacto.
