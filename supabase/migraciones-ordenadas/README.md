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
20. `../tests/test-vencimiento-producto-terminado.sql` — prueba adversarial específica; siempre hace rollback.
21. `../tests/test-abastecimiento-elaboraciones-internas.sql` — prueba que las elaboraciones solo entren por producción y las compras externas sigan funcionando.
22. `../tests/test-migraciones-ordenadas.sql` — aceptación completa; devuelve `TESTS_OK` y hace rollback explícito.

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
