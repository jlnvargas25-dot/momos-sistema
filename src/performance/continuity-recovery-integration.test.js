import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../supabase/continuidad-recuperacion-v1.sql", import.meta.url), "utf8");
const adversarial = await readFile(new URL("../../supabase/tests/test-continuidad-recuperacion-v1.sql", import.meta.url), "utf8");
const derivedMigration = await readFile(new URL("../../supabase/evidencia-recuperacion-derivada-v1.sql", import.meta.url), "utf8");
const derivedAdversarial = await readFile(new URL("../../supabase/tests/test-evidencia-recuperacion-derivada-v1.sql", import.meta.url), "utf8");
const ordered = await readFile(new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url), "utf8");
const worker = await readFile(new URL("../../scripts/continuity-backup-worker.mjs", import.meta.url), "utf8");
const recoveryRecorder = await readFile(new URL("../../scripts/continuity-recovery-recorder.mjs", import.meta.url), "utf8");
const recoveryWorkflow = await readFile(new URL("../../.github/workflows/continuity-recovery-drill.yml", import.meta.url), "utf8");
const runbook = await readFile(new URL("../../docs/MOMOS-OPS-CONTINUIDAD-RUNBOOK.md", import.meta.url), "utf8");
const rpc = await readFile(new URL("../lib/rpc.js", import.meta.url), "utf8");
const businessPanels = await readFile(new URL("../features/backoffice/BusinessPanels.jsx", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

test("H93 separa observación, restauración y certificación", () => {
  assert.match(migration, /create table if not exists public\.operational_backup_observations/i);
  assert.match(migration, /create table if not exists public\.operational_recovery_drills/i);
  assert.match(migration, /No se puede aprobar un simulacro que incumple verificaciones, RPO o RTO/i);
  assert.match(migration, /continuity_certified_until/i);
  assert.match(migration, /observedOnly',true,'restored',false/i);
});

test("H93 conserva operación por rol durante Solo lectura", () => {
  assert.match(migration, /create or replace function public\.momos_contingency_export_v1\(\)/i);
  assert.match(migration, /momos_operational_snapshot_v2\(\)/i);
  assert.match(migration, /create table if not exists public\.operational_contingency_actions/i);
  assert.match(migration, /unique\(device_ref,local_sequence\)/i);
  assert.match(migration, /Las acciones de contingencia solo existen durante el modo Solo lectura/i);
});

test("H93 observa el plano administrado sin imprimir secretos", () => {
  assert.match(worker, /api\.supabase\.com\/v1\/projects\/\$\{PROJECT_REF\}\/database\/backups/i);
  assert.match(worker, /method:\s*"GET"/i);
  assert.match(worker, /SUPABASE_ACCESS_TOKEN/i);
  assert.match(worker, /registrar_observacion_backup_administrado_v1/i);
  assert.match(worker, /no certificado/i);
  assert.doesNotMatch(worker, /console\.log\([^)]*SERVICE_KEY/i);
  assert.doesNotMatch(worker, /process\.(?:stdout|stderr)\.write\([^)]*MANAGEMENT_TOKEN/i);
  assert.equal(packageJson.scripts["worker:continuity:observe"], "node scripts/continuity-backup-worker.mjs");
});

test("H93 tiene aceptación adversarial y procedimiento de recuperación", () => {
  assert.match(adversarial, /confundio observacion con restauracion/i);
  assert.match(adversarial, /aprobo un simulacro fuera del RTO/i);
  assert.match(adversarial, /exportacion de Cocina amplio privilegios/i);
  assert.match(adversarial, /rollback;\s*$/i);
  assert.match(ordered, /migraciones ordenadas 01-93 PASS/i);
  assert.match(runbook, /Simulacro mensual de restauración/i);
  assert.match(runbook, /Incidente: Supabase o base de datos/i);
  assert.match(runbook, /Incidente: Storage/i);
  assert.match(runbook, /migración defectuosa/i);
});

test("Configuración no presenta un backup observado como recuperable", () => {
  assert.match(rpc, /momos_continuity_snapshot_v1/);
  assert.match(rpc, /momos\.continuity\.v1/);
  assert.match(businessPanels, /Backup observado/);
  assert.match(businessPanels, /PITR inactivo/);
  assert.match(businessPanels, /Recuperación comprobada/);
  assert.match(businessPanels, /Simulacro pendiente/);
  assert.doesNotMatch(businessPanels, />Respaldo recuperable</);
});

test("H97 deriva RPO/RTO y exige evidencia separada de Storage y replay", () => {
  assert.match(derivedMigration, /extract\(epoch from \(v_target-v_restored_through\)\)/i);
  assert.match(derivedMigration, /extract\(epoch from \(v_completed-v_started\)\)/i);
  assert.match(derivedMigration, /storage_manifest_fingerprint/i);
  assert.match(derivedMigration, /replay_receipt_fingerprint/i);
  assert.match(derivedMigration, /exactamente ocho verificaciones booleanas/i);
  assert.match(derivedMigration, /databaseOnly',true/i);
  assert.match(derivedMigration, /evidenceDerived/i);
  assert.doesNotMatch(derivedMigration, /p->>'observed_rpo_minutes'/i);
  assert.doesNotMatch(derivedMigration, /p->>'observed_rto_minutes'/i);
});

test("H97 adversarial rompe métricas declaradas, cronología, Storage e inmutabilidad", () => {
  assert.match(derivedAdversarial, /aceptó RPO\/RTO autodeclarados/i);
  assert.match(derivedAdversarial, /cronología físicamente imposible/i);
  assert.match(derivedAdversarial, /sin verificar objetos Storage/i);
  assert.match(derivedAdversarial, /RPO derivado mayor al objetivo/i);
  assert.match(derivedAdversarial, /permitió reescribir una evidencia ya sellada/i);
  assert.match(derivedAdversarial, /rollback;\s*$/i);
  assert.match(ordered, /migraciones ordenadas 01-102 PASS/i);
});

test("H97 certifica únicamente un staging aislado restaurado y no ejecuta restore", () => {
  assert.match(recoveryWorkflow, /RESTORED_ISOLATED_STAGING/i);
  assert.match(recoveryWorkflow, /STORAGE_OBJECTS_RESTORED_AND_HASHED/i);
  assert.match(recoveryWorkflow, /REPLAY_COMPLETED_IDEMPOTENTLY/i);
  assert.match(recoveryWorkflow, /STAGING_PROJECT_REF.*!=.*PRODUCTION_PROJECT_REF/is);
  assert.match(recoveryWorkflow, /test-evidencia-recuperacion-derivada-v1\.sql/i);
  assert.doesNotMatch(recoveryWorkflow, /database\/backups\/restore|restore-pitr|delete project/i);
  assert.equal(packageJson.scripts["worker:continuity:certify"], "node scripts/continuity-recovery-recorder.mjs");
});

test("H97 valida el backup exacto y no imprime credenciales ni manifiestos", () => {
  assert.match(recoveryRecorder, /database\/backups/i);
  assert.match(recoveryRecorder, /RECOVERY_EXACT_BACKUP_NOT_COMPLETED/i);
  assert.match(recoveryRecorder, /analytics\/endpoints\/logs\.all/i);
  assert.match(recoveryRecorder, /database system is ready to accept connections/i);
  assert.match(recoveryRecorder, /RECOVERY_STAGING_STARTED_AT_DIVERGED/i);
  assert.match(recoveryRecorder, /RECOVERY_STAGING_READY_EVIDENCE_MISSING/i);
  assert.match(recoveryRecorder, /registrar_observacion_backup_administrado_v1/i);
  assert.match(recoveryRecorder, /registrar_simulacro_recuperacion_v1/i);
  assert.match(recoveryRecorder, /deterministicUuid/i);
  assert.doesNotMatch(recoveryRecorder, /process\.(?:stdout|stderr)\.write\([^)]*(?:PRODUCTION_KEY|MANAGEMENT_TOKEN|STORAGE_FINGERPRINT|REPLAY_FINGERPRINT)/i);
});
