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
