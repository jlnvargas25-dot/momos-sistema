# Protección del código y releases de MOMOS

Este contrato une prevención, detección y recuperación. La vigilancia semanal no
reemplaza el gate por cambio ni demuestra que un backup pueda restaurarse.

## Gate obligatorio por cambio

El workflow `.github/workflows/quality-gate.yml` se ejecuta en pull requests,
push a `main` y manualmente. El check requerido se llama `quality-gate` y cubre:

- instalación reproducible mediante `npm ci` y `package-lock.json`;
- contratos del repositorio, secretos críticos, conflictos y migraciones;
- pruebas unitarias;
- pruebas de rendimiento/integración;
- build de producción;
- presupuesto de rendimiento;
- vulnerabilidades altas o críticas de dependencias de producción.

El mismo gate puede reproducirse localmente con `npm run ci:quality`.

`.github/CODEOWNERS` asigna explícitamente el repositorio y las superficies
sensibles al propietario. `.github/dependabot.yml` prepara PR semanales agrupados
para npm y GitHub Actions. Dependabot nunca integra por sí solo: cada propuesta
debe pasar el gate y la revisión humana.

## Protección que debe activarse en GitHub

En el ruleset de `main`:

1. exigir pull request;
2. exigir el check `quality-gate`;
3. exigir que la rama esté actualizada antes de integrar;
4. bloquear force-push y borrado de `main`;
5. exigir resolución de conversaciones;
6. limitar bypass a una cuenta administradora de emergencia;
7. conservar al menos una revisión humana para cambios de Supabase, pagos,
   inventario, permisos, workers o workflows.

Este repositorio no tiene un GitHub CLI autenticado en la máquina actual. Por eso
el ruleset remoto no puede declararse activo únicamente porque el YAML exista.

## Gate SQL de staging

`staging-database-gate.yml` es manual y falla cerrado salvo confirmación explícita
de staging. Requiere un environment protegido `staging` con:

- `STAGING_DATABASE_URL`;
- `STAGING_PROJECT_REF`;
- `STAGING_SUPABASE_URL`;
- `STAGING_SUPABASE_SERVICE_ROLE_KEY`;
- `PRODUCTION_PROJECT_REF`.

El workflow rechaza refs iguales y exige que tanto la conexión PostgreSQL como la
URL de Supabase pertenezcan al mismo proyecto de staging. Ejecuta la aceptación
ordenada 01–94, H93 y la prueba adversarial H94 dentro de transacciones con
rollback. Después corre el runner privado H94 en modo `Staging` y solo acepta un
certificado fresco, con al menos 100 solicitudes y cero invariantes rotas. La
service role de staging vive exclusivamente en el environment protegido; nunca
debe configurarse con una clave o URL de producción.

## Observación diaria de backups

`continuity-observer.yml` consulta diariamente el endpoint de backups de la API de
administración y registra únicamente la observación sellada de H93. Requiere un
environment protegido `production-continuity` con:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `SUPABASE_ACCESS_TOKEN` de mínimo privilegio `backups_read`;
- `SUPABASE_PROJECT_REF`.

El token de administración consulta el plano de backups. La service role se usa
solo para registrar la observación estructurada mediante la RPC H93. Ningún valor
se imprime ni se guarda como artifact.

Observar un backup no certifica recuperación. El simulacro mensual y la evidencia
RPO/RTO siguen el procedimiento de `MOMOS-OPS-CONTINUIDAD-RUNBOOK.md`.

## Secuencia de release

1. Rama/worktree aislado.
2. `npm run ci:quality` local.
3. Pull request y `quality-gate` remoto.
4. Revisión humana proporcional al riesgo.
5. Gate SQL sobre staging cuando cambia Supabase.
6. Smoke E2E y evidencia.
7. Release versionada.
8. Despliegue gradual.
9. Centro de Salud H92 y observador H93 activos.
10. Rollback o corrección hacia adelante conforme al runbook.

## Evidencia mínima

No declarar el sistema protegido sin:

- commits visibles en el remoto;
- ruleset de `main` activo;
- último `quality-gate` aprobado;
- aceptación SQL en staging para cambios de base;
- backup reciente observado;
- simulacro de restauración vigente;
- incidentes críticos cerrados o modo Solo lectura activo.
