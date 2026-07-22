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

## Carril Pide · P01 fundaciones

Pide MOMOS comparte el MISMO ledger `public.momos_ops_migrations` con OPS, pero
avanza por un carril propio con prefijo `p`: los hitos OPS usan IDs numéricos
(`20260721_93_...`, "H") y los de Pide usan `20260721_pNN_...` ("P"), así la
colisión de identificadores es imposible. El orden real entre carriles lo da
`applied_at`, no el nombre del archivo ni el ID. El preflight de P01 se ancla en
`20260721_93_continuidad_recuperacion` (último hito verificado en la base viva)
más comprobaciones de objetos y de las definiciones EXACTAS de los CHECK vivos
vía `pg_get_constraintdef`, y NO exige los hitos OPS 94-97: viven en otra rama y
los dos carriles se aplican en orden libre entre sí.

Regla de aplicación: primero confirmar que `20260721_93_continuidad_recuperacion`
aparece en el ledger de la base viva; después pasa el gate de siempre —
revisión adversarial del SQL y aprobación explícita de Jorge antes de tocar la
base. Un preflight que falla significa que la base se movió respecto de lo
verificado: se investiga, jamás se fuerza.

P01 NO toca funciones del core OPS: el cableado de
`_pide_liberar_holds_vencidos` dentro de `_reserve_inventory` y de las RPC
públicas llega en P03 — hacerlo en P01 cruzaría el carril OPS.

Requisito sellado para la revisión de P03: el FIFO del hold JAMÁS emite una
fila con `batch_id` null habiendo consumido `lote_figuras`. El escape
`batch_id` null existe solo para stock legítimamente sin lote, y ese supuesto
debe confirmarse contra el dominio antes de aplicar P03.

### Pendientes de decisión (Jorge)

- Gate de contratos: el verificador vive solo en la rama OPS — ¿portarlo al
  carril Pide o correrlo en el merge?
- Valores comerciales de los seeds de `app_settings`
  (`pide_hold_ttl_minutos`, `pide_hold_extension_minutos`,
  `pide_hold_stock_fraccion`, `pide_purga_checkout_horas`,
  `pide_tracking_expira_dias`): los actuales son técnicos, no aprobados.
- Sumar `order_tracking_tokens` al guard H89 en P04 (requiere tocar la lista
  cerrada de la spec §1.9).
- `k=3` del snapshot de demanda y `franja` fuera de sus dimensiones.
- Pasarela concreta: el slug de proveedor de `payments` queda abierto.

60. `../pide-fundaciones-v1.sql` — §1 completo de la superficie pública: canal `Pide` en los CHECK vivos, retiro del gancho muerto `Temporal`/`expira`, tablas `quotes`, `checkout_sessions`, `checkout_holds` + `checkout_hold_lotes` (extensión exactly-once y terminales selladas por trigger), `payments` + `payment_events` (UNIQUE parcial Iniciado/Aprobado), `order_attributions`, demanda con snapshot sellado k≥3 por `creado_at`, tracking v4, `benefits.hold_quote_id`, techos anti-acaparamiento, RLS deny-all, perímetro H89 ampliado y purga en dos fases (DELETE 24–72 h).
61. `../tests/test-pide-fundaciones-v1.sql` — adversarial: CHECKs nuevos y viejos, deny-all real por rol (4 verbos), UNIQUE parciales de idempotencia, extensión exactly-once, estados terminales, hold veneno aislado, liberación de holds vencidos con orden global de locks, payment_events idempotentes, anonimización con re-saneo de atribución, FK RESTRICT, guard H89 y k≥3 del snapshot de demanda; siempre hace rollback.
62. `../tests/test-migraciones-ordenadas.sql` — aceptación completa vigente (cadena OPS del snapshot local + sección P01); siempre hace rollback.
