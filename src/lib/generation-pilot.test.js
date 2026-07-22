import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGenerationPilots } from "./generation-pilot.js";

const pilot = (overrides = {}) => ({
  id: 3, authorization_id: 2, job_id: 19, provider: "Higgsfield", status: "Armado",
  max_cost_cop: 8000, pilot_fingerprint: "a".repeat(64), authorization_fingerprint: "b".repeat(64),
  job_fingerprint: "c".repeat(32), armed_at: "2026-07-22T18:00:00Z",
  expires_at: "2026-07-22T19:00:00Z", claimed_at: null, finished_at: null,
  connector_run_id: null, pilot_worker_may_claim: true, external_execution_started: false,
  human_review_required: true, publication_allowed: false, ...overrides,
});

const envelope = (overrides = {}) => ({ fingerprint: "d".repeat(64), snapshot: {
  schema_version: "momos-generation-pilots/v1", generated_at: "2026-07-22T18:00:00Z",
  pilots: [pilot()], summary: { pilots: 1, armed: 1, running: 0, uncertain: 0, awaiting_review: 0 },
  privacy: { contains_customer_pii: false, contains_staff_identity: false, contains_storage_paths: false,
    contains_secrets: false, contains_order_ids: false }, single_active_pilot: true,
  human_authorization_required: true, credits_consumed_by_arm: false, publication_allowed: false,
  ...overrides,
} });

test("normaliza un único piloto armado sin fingir ejecución o publicación", () => {
  const result = normalizeGenerationPilots(envelope());
  assert.equal(result.pilots[0].jobId, 19);
  assert.equal(result.pilots[0].pilotWorkerMayClaim, true);
  assert.equal(result.pilots[0].externalExecutionStarted, false);
  assert.equal(result.publicationAllowed, false);
});

test("rechaza PII, permisos o resumen inconsistentes", () => {
  assert.throws(() => normalizeGenerationPilots(envelope({ publication_allowed: true })), /separación/);
  assert.throws(() => normalizeGenerationPilots(envelope({ customer_phone: "3000000000" })), /campo privado/);
  assert.throws(() => normalizeGenerationPilots(envelope({ summary: { pilots: 2 } })), /no coincide/);
});

test("rechaza estados de ejecución contradictorios", () => {
  const running = envelope();
  running.snapshot.pilots[0] = pilot({ status: "En proveedor", connector_run_id: 9,
    pilot_worker_may_claim: false, external_execution_started: true });
  assert.equal(normalizeGenerationPilots(running).pilots[0].connectorRunId, 9);
  const unsafe = envelope();
  unsafe.snapshot.pilots[0] = pilot({ external_execution_started: true });
  assert.throws(() => normalizeGenerationPilots(unsafe), /inconsistente/);
});
