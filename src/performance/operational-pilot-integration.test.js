import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../supabase/piloto-operativo-interno-v1.sql", import.meta.url);
const pilotUrl = new URL("../../supabase/tests/test-piloto-operativo-e2e-v1.sql", import.meta.url);
const orderedUrl = new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url);
const workflowUrl = new URL("../../.github/workflows/staging-database-gate.yml", import.meta.url);
const evidenceUrl = new URL("../../docs/H100-STAGING-INTERNAL-PILOT-2026-07-22.json", import.meta.url);

test("H100 usa el flujo operativo real y corrige la firma de relevo", async () => {
  const [migration, pilot] = await Promise.all([
    readFile(migrationUrl, "utf8"), readFile(pilotUrl, "utf8"),
  ]);
  assert.match(migration, /20260722_100_piloto_operativo_interno/);
  assert.match(migration, /pg_catalog\.sha256/);
  assert.match(migration, /pg_catalog\.convert_to/);
  assert.doesNotMatch(migration, /v_signature\s*:=\s*encode\s*\(\s*digest/i);
  assert.match(pilot, /public\.set_order_status/);
  assert.match(pilot, /public\.completar_cocina_y_entregar_empaque_v1/);
  assert.match(pilot, /public\.confirmar_verificacion_empaque/);
  assert.match(pilot, /public\.ofrecer_relevo_despacho/);
  assert.match(pilot, /public\.aceptar_relevo_despacho/);
  assert.match(pilot, /^begin;/m);
  assert.match(pilot, /rollback;\s*$/);
  assert.match(pilot, /H97 certifica[\s\S]*Storage/);
});

test("H100 queda dentro del gate staging y de la cadena ordenada", async () => {
  const [ordered, workflow] = await Promise.all([
    readFile(orderedUrl, "utf8"), readFile(workflowUrl, "utf8"),
  ]);
  assert.match(ordered, /20260722_100_piloto_operativo_interno/);
  assert.match(ordered, /migraciones ordenadas 01-100 PASS/);
  assert.match(workflow, /test-piloto-operativo-e2e-v1\.sql/);
  assert.match(workflow, /H100 piloto operativo interno E2E/);
  assert.match(workflow, /01-100 PASS/);
});

test("H100 conserva evidencia sanitaria y alcance honesto", async () => {
  const report = JSON.parse(await readFile(evidenceUrl, "utf8"));
  const serialized = JSON.stringify(report).toLowerCase();
  assert.equal(report.contract, "momos.internal-operational-pilot.staging.v1");
  assert.equal(report.environment, "Staging");
  assert.equal(report.result, "PASS");
  assert.equal(report.transaction.rolledBack, true);
  assert.ok(Object.values(report.transaction.cleanup).every((value) => value === 0));
  assert.equal(report.scope.internalOperationsCertified, true);
  assert.equal(report.scope.realCustomerPilot, false);
  assert.equal(report.scope.publicCheckoutCertified, false);
  assert.equal(report.scope.paymentWebhookCertified, false);
  assert.equal(report.privacy.containsCustomerPii, false);
  assert.equal(report.privacy.containsSecrets, false);
  assert.doesNotMatch(serialized, /api[_-]?key|service[_-]?role|bearer[ ]|access[_-]?token/);
});
