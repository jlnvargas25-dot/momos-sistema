# Continuidad y recuperación de MOMO OPS

Este runbook separa tres evidencias que nunca deben confundirse:

1. **Backup observado:** Supabase informa que el respaldo de base existe.
2. **Restauración probada:** ese respaldo fue restaurado en un proyecto de staging aislado.
3. **Recuperación certificada:** base, Storage y replay pasaron las verificaciones y los tiempos derivados cumplieron RPO/RTO.

Ver un backup en la consola no demuestra que pueda recuperarse la operación completa.

## Objetivos vigentes

| Dominio | RPO | RTO |
| --- | ---: | ---: |
| Pedidos, inventario y producción | 5 min | 30 min |
| Agencia, analítica y activos secundarios | según respaldo | 4 h |

La política canónica vive en `operational_continuity_policy`; la interfaz solo
consume `momos_continuity_snapshot_v1()`.

## Estado verificado el 21 de julio de 2026

- Supabase mostró siete backups físicos diarios, del 15 al 21 de julio.
- El último respaldo visible terminó el 21 de julio a las 09:34:09 UTC.
- PITR aparecía disponible como add-on, pero no estaba activo.
- El respaldo de base incluye metadatos de Storage, no los bytes de los objetos.
- El backup físico exacto `1171502694` fue restaurado en el staging aislado
  `mxrsmuqyesolkxoqvggl`.
- El plano de control registró la creación a las `2026-07-22T02:34:19.210Z` y
  PostgreSQL quedó listo a las `2026-07-22T02:38:17.154Z`: RTO derivado 3,97 min.
- El objetivo y el punto restaurado fueron `2026-07-21T09:34:09.602Z`: RPO
  derivado 0 min y replay idempotente de cero eventos.
- Storage verificó 50 objetos, tres buckets y 8.652.100 bytes mediante SHA-256.
- H93, H97 y la cadena ordenada 01–100 pasaron sobre el staging restaurado; la
  evidencia estructurada quedó registrada en producción como certificada.

Conclusión honesta: la recuperación completa de base, Storage y replay sí quedó
probada y certificada. Como PITR continúa inactivo, la cobertura diaria observada
todavía no demuestra que cualquier incidente arbitrario pierda como máximo cinco
minutos de operación. H97 mantiene separados ambos hechos.

## Operación normal

1. Ejecutar `npm run worker:continuity:observe` bajo un supervisor privado.
2. Configurar `SUPABASE_ACCESS_TOKEN` con alcance mínimo `backups_read`, además de
   `SUPABASE_URL`, `SUPABASE_PROJECT_REF` y la service role privada requerida por
   la RPC. Ninguna credencial entra al navegador o al repositorio.
3. El worker consulta `GET /v1/projects/{ref}/database/backups` y registra solo
   identificador, fecha, estado, región y disponibilidad de PITR.
4. El Centro de Salud muestra **observado**, nunca **certificado**, hasta completar
   un simulacro real H97.
5. Mantener una copia cifrada externa de los objetos Storage con manifiesto
   SHA-256 y cantidad de objetos. El backup de base no sustituye esta copia.
6. Mantener un recibo sellado del replay de eventos posteriores al punto restaurado.

El workflow `.github/workflows/continuity-observer.yml` hace la observación diaria
desde el environment protegido `production-continuity`. Su éxito solo prueba
lectura y registro de evidencia.

## Simulacro mensual de restauración

Responsable: Administrador técnico. Entorno obligatorio: proyecto de staging
aislado, sin conectores externos, cobros, publicaciones ni mensajes a clientes.

### Preparación

1. Elegir un backup observado exacto.
2. Registrar tres tiempos UTC ISO antes de actuar:
   - `restore_started_at`: inicio esperado del simulacro; el registrador lo
     contrasta con `created_at` oficial del proyecto de staging;
   - `recovery_target_at`: instante del negocio que se busca recuperar;
   - `restored_through_at`: último evento realmente presente después del replay.
3. Confirmar que el ref y la URL de staging son distintos a producción.
4. Crear o seleccionar el manifiesto externo de Storage y el recibo de replay.

### Restauración y verificación

1. Restaurar el backup de base en staging mediante el procedimiento oficial de Supabase.
2. Aplicar únicamente migraciones posteriores incluidas en la cadena ordenada.
3. Restaurar los objetos Storage desde la copia externa y comparar el manifiesto SHA-256.
   El restaurador privado e idempotente se ejecuta con
   `npm run worker:continuity:restore-storage`. Recibe las URL, refs y claves
   `service_role` de producción y staging únicamente por variables de entorno,
   descarga y compara cada objeto, reutiliza los que ya son idénticos y escribe
   un recibo agregado sin rutas, nombres de archivo ni secretos. Nunca guardar
   las claves en el repositorio ni en el archivo de resultado.
4. Reproducir eventos posteriores con sus claves idempotentes y sellar el recibo.
   Cuando el objetivo de recuperación coincide exactamente con el último instante
   restaurado no existe una ventana posterior que reproducir. En ese único caso,
   `npm run worker:continuity:seal-replay` genera un recibo determinista de cero
   eventos. Si los instantes difieren, el comando falla y obliga a usar el ledger
   real de eventos; nunca permite declarar cero por conveniencia.
5. Ejecutar exactamente ocho verificaciones: migraciones, pedidos, inventario,
   reservas, pagos, recibos, replay y Storage.
6. Ejecutar las pruebas H93 y H97, la cadena 01–100, contratos y build.
7. Invocar manualmente `.github/workflows/continuity-recovery-drill.yml` con los
   tiempos y huellas anteriores. El workflow no crea ni restaura proyectos; solo
   valida el staging ya restaurado y registra evidencia estructurada.
   El cierre deriva el inicio desde el proyecto de staging y el fin desde el primer
   evento PostgreSQL `ready to accept connections`; no usa la hora de ejecución del
   workflow ni permite declarar manualmente el RTO.
8. Destruir staging únicamente después de conservar la bitácora administrativa.

### Cálculos H97

- `RPO = recovery_target_at - restored_through_at`.
- `RTO = completed_at - restore_started_at`.

El servidor calcula ambos valores. El llamador no puede enviarlos. Para certificar:

- la cronología debe ser físicamente posible;
- las ocho verificaciones deben ser verdaderas;
- Storage debe tener manifiesto SHA-256 y al menos un objeto verificado;
- replay debe tener recibo SHA-256, incluso si reprodujo cero eventos;
- RPO debe ser menor o igual a 5 minutos;
- RTO debe ser menor o igual a 30 minutos.

Una prueba fallida o una certificación anterior sin evidencia derivada deja el
estado como no certificado, conservando la evidencia histórica para auditoría.

## Incidente: Supabase o base de datos

1. Activar `establecer_modo_contingencia_v1(true, codigo)`.
2. Exportar pedidos activos por rol con `momos_contingency_export_v1()`.
3. Cocina, Empaque y Logística trabajan desde esa copia sin editarla.
4. Cada acción manual usa `registrar_accion_contingencia_v1` con UUID,
   dispositivo y secuencia local únicos.
5. Restaurar y verificar en staging antes de promover un entorno reparado.
6. Conciliar cada acción manual; nunca reejecutar un lote sin revisar recibos.
7. Desactivar Solo lectura solo cuando el Centro de Salud no tenga críticos activos.

## Incidente: Realtime

Mantener la base operativa. El coordinador cae a polling dirigido. Si una respuesta
se perdió, reutilizar el mismo identificador idempotente y consultar el recibo antes
de reintentar.

## Incidente: Storage

Bloquear nuevas evidencias o activos, sin alterar pedidos confirmados. Conservar el
identificador de carga. Reconciliar Storage y registros mediante API; nunca borrar
objetos directamente por SQL.

## Incidente: conector externo incierto

No reintentar automáticamente. Consultar primero la clave idempotente en el
proveedor y conciliar solo con evidencia del estado remoto.

## Incidente: migración defectuosa

1. Entrar en Solo lectura.
2. No editar manualmente el manifiesto de migraciones.
3. Restaurar el backup previo en staging y ejecutar la cadena ordenada.
4. Preparar una migración correctiva hacia adelante. Un rollback destructivo en
   producción requiere restauración probada y aprobación explícita.

## Evidencia mínima de cierre

- backup exacto y fecha usados;
- objetivo, punto restaurado, inicio y fin del simulacro;
- RPO y RTO derivados por servidor;
- ocho verificaciones booleanas aprobadas;
- huella y conteo de Storage;
- huella y conteo de replay;
- acciones de contingencia conciliadas;
- cadena ordenada y pruebas adversariales aprobadas;
- responsable y fecha del próximo simulacro.

Sin esa evidencia, el estado correcto es **observado** o **degradado**, nunca
**recuperación certificada**.

## Referencias oficiales

- [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase Management API](https://supabase.com/docs/reference/api/getting-started)
- [Supabase Storage: descarga y migración de objetos](https://supabase.com/docs/guides/storage/management/download-objects)
