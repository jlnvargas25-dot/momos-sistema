import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SYNC_DOMAINS, syncDomainsForView } from "../lib/sync-coordinator.js";

const pilotUrl = new URL("../../scripts/staging-ui-pilot.mjs", import.meta.url);
const launcherUrl = new URL("../../scripts/start-staging-ui-pilot.ps1", import.meta.url);
const clientUrl = new URL("../lib/supabase.js", import.meta.url);
const evidenceUrl = new URL("../../docs/H101-STAGING-UI-PILOT-2026-07-22.json", import.meta.url);

test("H101 falla cerrado fuera del staging sellado y no entrega secretos al navegador", async () => {
  const [pilot, launcher, client] = await Promise.all([
    readFile(pilotUrl, "utf8"),
    readFile(launcherUrl, "utf8"),
    readFile(clientUrl, "utf8"),
  ]);
  assert.match(pilot, /const STAGING_REF = "mxrsmuqyesolkxoqvggl"/);
  assert.match(pilot, /endpoint\.protocol !== "https:" \|\| ref !== STAGING_REF/);
  assert.match(pilot, /assertPrivateSupabaseKey/);
  assert.match(pilot, /readSealedSession/);
  assert.match(pilot, /session\.projectRef === projectRef/);
  assert.match(pilot, /service_role/);
  assert.match(launcher, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(launcher, /VITE_SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(client, /STAGING_SUPABASE_SERVICE_ROLE_KEY/);
});

test("H101 prepara cinco sesiones acumulables y las revoca al finalizar", async () => {
  const pilot = await readFile(pilotUrl, "utf8");
  for (const role of ["Administrador", "Cajero", "Coordinador de pedidos", "Cocina", "Empaque", "Log\\u00edstica"]) {
    assert.ok(pilot.includes(role), `falta el rol ${role}`);
  }
  assert.match(pilot, /update\(\{ activo: false, auth_id: null \}\)/);
  assert.match(pilot, /auth\.admin\.deleteUser/);
  assert.match(pilot, /await unlink\(SESSION_PATH\)/);
});

test("Pedidos hidrata el menu canonico junto al flujo vivo", () => {
  assert.deepEqual(syncDomainsForView("Pedidos"), [SYNC_DOMAINS.CATALOGS, SYNC_DOMAINS.OPERATIONS]);
});

test("H101 conserva un recibo sanitario honesto del recorrido UI", async () => {
  const report = JSON.parse(await readFile(evidenceUrl, "utf8"));
  const serialized = JSON.stringify(report).toLowerCase();
  assert.equal(report.contract, "momos.ui-operational-pilot.staging.v1");
  assert.equal(report.environment, "Staging");
  assert.equal(report.result, "PASS");
  assert.equal(report.order.finalStatus, "Entregado");
  assert.equal(report.flow.browserConsoleErrors, 0);
  assert.equal(report.flow.realtimeReconnectPersisted, true);
  assert.equal(report.cleanup.credentialsRevoked, true);
  assert.equal(report.cleanup.sessionFileRemoved, true);
  assert.equal(report.scope.realBrowserUiCertified, true);
  assert.equal(report.scope.productionTouched, false);
  assert.equal(report.scope.realCustomerPilot, false);
  assert.equal(report.scope.publicCheckoutCertified, false);
  assert.equal(report.privacy.containsCustomerPii, false);
  assert.equal(report.privacy.containsSecrets, false);
  assert.doesNotMatch(serialized, /api[_-]?key|service[_-]?role[_-]?key|bearer[ ]|access[_-]?token|password/);
});
