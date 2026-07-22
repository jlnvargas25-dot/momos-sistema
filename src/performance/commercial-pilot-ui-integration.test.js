import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../supabase/piloto-comercial-ui-v1.sql", import.meta.url);
const adversarialUrl = new URL("../../supabase/tests/test-piloto-comercial-ui-v1.sql", import.meta.url);
const orderedUrl = new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url);
const workflowUrl = new URL("../../.github/workflows/staging-database-gate.yml", import.meta.url);
const panelUrl = new URL("../features/backoffice/CommercialPilotPanel.jsx", import.meta.url);
const receiptUrl = new URL("../../docs/H104-STAGING-COMMERCIAL-PILOT-UI-2026-07-22.json", import.meta.url);

test("H104 expone una lectura mínima y deja las tablas del piloto privadas", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /20260722_104_piloto_comercial_ui/);
  assert.match(migration, /momos_commercial_pilot_snapshot_v2/);
  assert.match(migration, /containsCustomerPii',false/);
  assert.match(migration, /containsSecrets',false/);
  assert.match(migration, /containsFreeText',false/);
  assert.match(migration, /publicTrafficOpened',false/);
  assert.match(migration, /externalExecution',false/);
  assert.match(migration, /revoke all on function public\.momos_commercial_pilot_snapshot_v2\(\)/);
  assert.doesNotMatch(migration, /grant select on public\.commercial_pilot_/i);
});

test("H104 presenta el recorrido humano sin abrir tráfico ni crear pedidos", async () => {
  const panel = await readFile(panelUrl, "utf8");
  assert.match(panel, /data-testid="commercial-pilot-panel"/);
  assert.match(panel, /cuatro aprobaciones/);
  assert.match(panel, /Solo vincula pedidos ya pagados/);
  assert.match(panel, /No crea pedidos, no cobra y no abre Pide MOMOS/);
  assert.match(panel, /linkKeysRef/);
  assert.doesNotMatch(panel, /crearPedido|setOrderStatus|crear_pedido_publico|payment_intent/i);
});

test("H104 queda detrás de H103 y forma parte del gate de staging", async () => {
  const [migration, adversarial, ordered, workflow] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(adversarialUrl, "utf8"),
    readFile(orderedUrl, "utf8"),
    readFile(workflowUrl, "utf8"),
  ]);
  assert.match(migration, /20260722_103_inteligencia_creativa_publicitaria/);
  assert.match(adversarial, /^begin;/m);
  assert.match(adversarial, /rollback;\s*$/);
  assert.match(adversarial, /H104 UI piloto\/firmas\/pedidos\/salud\/PII\/RBAC PASS/);
  assert.match(ordered, /migraciones ordenadas 01-104 PASS/);
  assert.match(workflow, /piloto-comercial-ui-v1\.sql/);
  assert.match(workflow, /test-piloto-comercial-ui-v1\.sql/);
  assert.match(workflow, /01-108 PASS/);
});

test("H104 conserva un recibo de staging sin fingir el piloto real", async () => {
  const receipt = JSON.parse(await readFile(receiptUrl, "utf8"));
  const serialized = JSON.stringify(receipt).toLowerCase();
  assert.equal(receipt.environment, "Staging");
  assert.equal(receipt.validation.h104Adversarial, "PASS");
  assert.equal(receipt.validation.orderedMigrations, "01-104 PASS");
  assert.equal(receipt.scope.humanPilotPanelReady, true);
  assert.equal(receipt.scope.realCustomerPilotExecuted, false);
  assert.equal(receipt.scope.publicTrafficOpened, false);
  assert.equal(receipt.scope.productionMutated, false);
  assert.equal(receipt.privacy.containsCustomerPii, false);
  assert.equal(receipt.privacy.containsSecrets, false);
  assert.doesNotMatch(serialized, /service[_-]?role|bearer |access[_-]?token|api[_-]?key/);
});
