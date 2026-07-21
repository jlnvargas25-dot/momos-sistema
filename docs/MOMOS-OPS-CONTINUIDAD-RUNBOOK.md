# Continuidad y recuperación de MOMO OPS

Este runbook distingue tres evidencias que no son equivalentes:

1. **Backup observado:** Supabase informa que el respaldo existe.
2. **Restauración probada:** el respaldo fue restaurado en un proyecto de staging aislado.
3. **Recuperación certificada:** la restauración, conciliación y replay cumplieron RPO y RTO.

Nunca se marca un respaldo como recuperable solo porque aparece en la consola.

## Objetivos vigentes

| Dominio | RPO | RTO |
| --- | ---: | ---: |
| Pedidos, inventario y producción | 5 min | 30 min |
| Agencia, analítica y activos secundarios | según respaldo | 4 h |

La política canónica vive en `operational_continuity_policy`; la interfaz solo
consume `momos_continuity_snapshot_v1()`.

## Operación normal

1. Ejecutar `npm run worker:continuity:observe` bajo el supervisor privado.
2. Configurar `SUPABASE_ACCESS_TOKEN` con alcance mínimo `backups_read`, además de
   `SUPABASE_URL`, `SUPABASE_PROJECT_REF` y la service role privada requerida por
   la RPC de observación. Ninguna credencial entra al navegador o al repositorio.
3. El worker consulta por `GET` el plano de administración de Supabase y registra solamente
   identificador, fecha, estado, región y disponibilidad de PITR.
4. El Centro de Salud muestra **observado**, nunca **certificado**, hasta completar
   un simulacro real.
5. Conservar exportación cifrada diaria fuera del proyecto principal. La clave de
   cifrado nunca vive en el navegador, la base o el repositorio.

El workflow `.github/workflows/continuity-observer.yml` puede ejecutar esta
observación diariamente desde el environment protegido `production-continuity`.
Su éxito prueba lectura y registro de evidencia; no prueba restauración.

## Simulacro mensual de restauración

Responsable: Administrador técnico. Entorno obligatorio: proyecto de staging
aislado, sin conectores externos ni mensajes a clientes.

1. Elegir un backup observado y registrar hora de inicio.
2. Restaurarlo en staging siguiendo el procedimiento oficial de Supabase.
3. Aplicar únicamente migraciones posteriores que estén en la cadena ordenada.
4. Reproducir recibos idempotentes y eventos posteriores al punto restaurado.
5. Ejecutar las siete verificaciones: migraciones, pedidos, inventario, reservas,
   pagos, recibos y replay.
6. Medir pérdida máxima observada y tiempo total de recuperación.
7. Registrar el resultado con `registrar_simulacro_recuperacion_v1` desde el
   proceso privado. Solo un resultado conforme puede certificar continuidad.
8. Destruir staging después de guardar la evidencia estructurada y la bitácora
   administrativa correspondiente.

## Incidente: Supabase o base de datos

1. Activar `establecer_modo_contingencia_v1(true, codigo)`.
2. Exportar pedidos activos por rol con `momos_contingency_export_v1()`.
3. Cocina, Empaque y Logística trabajan desde esa copia sin editarla.
4. Cada acción manual usa `registrar_accion_contingencia_v1` con UUID,
   dispositivo y secuencia local únicos.
5. Restaurar en staging, verificar, y solo después promover el entorno reparado.
6. Conciliar una por una las acciones manuales; nunca reejecutarlas en bloque sin
   verificar los recibos existentes.
7. Ejecutar el Centro de Salud. Desactivar solo lectura únicamente cuando no haya
   incidentes críticos activos.

## Incidente: Realtime

Mantener la base operativa. El coordinador cae a polling dirigido; no se debe
reiniciar ni duplicar una acción ya confirmada. Si la respuesta se perdió, usar el
mismo identificador idempotente y verificar el recibo antes de reintentar.

## Incidente: Storage

Bloquear nuevas evidencias o activos, pero no alterar pedidos ya confirmados.
Conservar el identificador de carga. Ejecutar reconciliación Storage–registro y
resolver huérfanos por compensación; nunca borrar objetos directamente por SQL.

## Incidente: conector externo incierto

No reintentar automáticamente. Consultar primero por clave idempotente al
proveedor. Marcar como conciliado únicamente con evidencia del estado remoto.

## Incidente: migración defectuosa

1. Entrar en solo lectura.
2. No editar manualmente el manifiesto de migraciones.
3. Restaurar el backup previo en staging y ejecutar la cadena ordenada.
4. Preparar una migración correctiva hacia adelante. Un rollback destructivo en
   producción requiere restauración probada y aprobación explícita.

## Eliminación accidental o catálogo corrupto

No reconstruir saldos a mano. Restaurar en staging, ejecutar auditorías canónicas
de figuras, lotes, reservas y resultados físicos, y comparar huellas antes de
promover. Conservar los identificadores históricos aunque la entidad quede
archivada.

## Evidencia mínima de cierre

- backup y fecha usados;
- RPO y RTO observados;
- siete verificaciones booleanas aprobadas;
- replay completado;
- incidentes cerrados;
- acciones de contingencia conciliadas;
- cadena ordenada y pruebas adversariales aprobadas;
- responsable y fecha de la próxima práctica.

Sin esa evidencia, el estado correcto es **observado** o **degradado**, nunca
**recuperación certificada**.
