import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../supabase/piloto-comercial-controlado-v1.sql", import.meta.url);
const adversarialUrl = new URL("../../supabase/tests/test-piloto-comercial-controlado-v1.sql", import.meta.url);
const orderedUrl = new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url);
const workflowUrl = new URL("../../.github/workflows/staging-database-gate.yml", import.meta.url);
const runbookUrl = new URL("../../docs/MOMOS-OPS-COMMERCIAL-PILOT-RUNBOOK.md", import.meta.url);
const receiptUrl = new URL("../../docs/H102-STAGING-COMMERCIAL-PILOT-CONTROL-2026-07-22.json", import.meta.url);

test("H102 modela una muestra cerrada y nunca abre tráfico ni cobra", async () => {
  const [migration, runbook] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(runbookUrl, "utf8"),
  ]);
  assert.match(migration, /20260722_102_piloto_comercial_controlado/);
  assert.match(migration, /planned_orders between 1 and 20/);
  assert.match(migration, /expires_at<=starts_at\+interval '7 days'/);
  assert.match(migration, /PREPARAR_PILOTO_CERRADO_SIN_ABRIR_TRAFICO/);
  assert.match(migration, /INICIAR_PILOTO_CERRADO_PRODUCCION/);
  assert.match(migration, /'publicTrafficOpened',false/);
  assert.match(migration, /'externalExecution',false/);
  assert.doesNotMatch(migration, /crear_pedido_publico|payment_intent|webhook|fetch\s*\(/i);
  assert.match(runbook, /no crea pedidos/i);
  assert.match(runbook, /no abre checkout/i);
  assert.match(runbook, /piloto real sigue pendiente/i);
});

test("H102 exige firmas, salud, recuperación, idempotencia y conciliación", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  for (const fragment of [
    "Producto", "Operaciones", "Finanzas", "Seguridad y Privacidad",
    "resilience_certified_until", "continuity_certified_until",
    "idempotency_key uuid not null unique", "v_order_totals",
    "packing_verifications", "order_dispatch_handoffs", "final_margin",
  ]) assert.ok(migration.includes(fragment), `Falta ${fragment}`);
  assert.match(migration, /status in \('Abierto','Confirmado'\)/);
  assert.match(migration, /v_count<>v_run\.planned_orders or v_reconciled<>v_count/);
});

test("H102 adversarial, cadena y staging permanecen cerrados", async () => {
  const [adversarial, ordered, workflow] = await Promise.all([
    readFile(adversarialUrl, "utf8"),
    readFile(orderedUrl, "utf8"),
    readFile(workflowUrl, "utf8"),
  ]);
  assert.match(adversarial, /^begin;/m);
  assert.match(adversarial, /rollback;\s*$/);
  assert.match(adversarial, /vinculó un pedido no pagado/);
  assert.match(adversarial, /ignoró el modo solo lectura/);
  assert.match(adversarial, /perdió idempotencia durable/);
  assert.match(adversarial, /permitió consulta anónima/);
  assert.match(adversarial, /containsCustomerPii/);
  assert.match(ordered, /20260722_102_piloto_comercial_controlado/);
  assert.match(ordered, /migraciones ordenadas 01-102 PASS/);
  assert.match(workflow, /piloto-comercial-controlado-v1\.sql/);
  assert.match(workflow, /test-piloto-comercial-controlado-v1\.sql/);
  assert.match(workflow, /01-106 PASS/);
  assert.match(workflow, /STAGING_PROJECT_REF.*!=.*PRODUCTION_PROJECT_REF/is);
});

test("H102 conserva un recibo sanitario y no finge el piloto real", async () => {
  const receipt = JSON.parse(await readFile(receiptUrl, "utf8"));
  const serialized = JSON.stringify(receipt).toLowerCase();
  assert.equal(receipt.environment, "Staging");
  assert.equal(receipt.migration.applied, true);
  assert.equal(receipt.validation.adversarial, "PASS");
  assert.equal(receipt.validation.orderedMigrations, "01-102 PASS");
  assert.equal(receipt.validation.remainingPilots, 0);
  assert.equal(receipt.scope.closedSampleControllerReady, true);
  assert.equal(receipt.scope.realCustomerPilotExecuted, false);
  assert.equal(receipt.scope.publicTrafficOpened, false);
  assert.equal(receipt.scope.productionMutated, false);
  assert.equal(receipt.privacy.containsCustomerPii, false);
  assert.equal(receipt.privacy.containsSecrets, false);
  assert.doesNotMatch(serialized, /api[_-]?key|service[_-]?role|bearer |access[_-]?token/);
});
