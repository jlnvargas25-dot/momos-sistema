import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("H111 sella costo y huellas antes de contactar Higgsfield", async () => {
  const [migration, worker] = await Promise.all([
    read("../../supabase/higgsfield-conciliacion-v1.sql"),
    read("../../scripts/higgsfield-worker.mjs"),
  ]);
  assert.match(migration, /20260722_111_conciliacion_higgsfield/);
  assert.match(migration, /preparar_despacho_higgsfield/);
  assert.match(migration, /provider_match_fingerprint/);
  assert.match(migration, /request_fingerprint/);
  assert.match(worker, /buildDispatchMetadata/);
  assert.match(worker, /await rpc\("preparar_despacho_higgsfield"[\s\S]+providerRequestStarted = true/);
  assert.doesNotMatch(migration, /fetch\s*\(|https?:\/\//i);
});

test("H111 bloquea el reenvío incierto y concilia una sola coincidencia", async () => {
  const [migration, worker, helper] = await Promise.all([
    read("../../supabase/higgsfield-conciliacion-v1.sql"),
    read("../../scripts/higgsfield-worker.mjs"),
    read("../lib/higgsfield-connector.js"),
  ]);
  assert.match(migration, /status','Incierto','retry_blocked',true/);
  assert.match(migration, /conciliar_despacho_higgsfield/);
  assert.match(migration, /v_run\.state<>'Incierto'/);
  assert.match(migration, /provider_created_at/);
  assert.match(worker, /generate", "list", "--size", "100"/);
  assert.match(worker, /candidates\.length !== 1/);
  assert.match(worker, /conciliar_despacho_higgsfield/);
  assert.match(helper, /findHiggsfieldReconciliationCandidates/);
});

test("H111 conserva prueba rollback, RBAC y cadena 01-111", async () => {
  const [adversarial, ordered, workflow] = await Promise.all([
    read("../../supabase/tests/test-higgsfield-conciliacion-v1.sql"),
    read("../../supabase/tests/test-migraciones-ordenadas.sql"),
    read("../../.github/workflows/staging-database-gate.yml"),
  ]);
  assert.match(adversarial, /^begin;/m);
  assert.match(adversarial, /Nunca llama al proveedor ni consume créditos/i);
  assert.match(adversarial, /rollback;\s*$/);
  assert.match(adversarial, /customer_phone/);
  assert.match(ordered, /20260722_111_conciliacion_higgsfield/);
  assert.match(ordered, /migraciones ordenadas 01-111 PASS/);
  assert.match(workflow, /higgsfield-conciliacion-v1\.sql/);
  assert.match(workflow, /test-higgsfield-conciliacion-v1\.sql/);
  assert.match(workflow, /01-111 PASS/);
});
