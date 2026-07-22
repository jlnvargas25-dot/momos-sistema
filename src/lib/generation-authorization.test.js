import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGenerationAuthorizations } from "./generation-authorization.js";

const authorization = (overrides = {}) => ({
  id: 1, authorization_key: "ui.h108.plan.8", plan_id: 8, job_id: 19,
  provider: "Higgsfield", status: "Autorizado", job_status: "Autorizado",
  operation: "Generar video", target_channel: "Instagram", target_format: "Reel 9:16",
  max_cost_cop: 8000, plan_fingerprint: "a".repeat(64), job_fingerprint: "b".repeat(32),
  authorization_fingerprint: "c".repeat(64), authorized_at: "2026-07-22T12:00:00Z",
  worker_may_claim: true, publication_allowed: false, ...overrides,
});

const envelope = (overrides = {}) => ({ fingerprint: "d".repeat(64), snapshot: {
  schema_version: "momos-generation-authorizations/v1", generated_at: "2026-07-22T12:00:00Z",
  authorizations: [authorization()], summary: { authorizations: 1, ready_for_worker: 1, in_progress: 0, completed: 0 },
  privacy: { contains_customer_pii: false, contains_staff_identity: false, contains_storage_paths: false,
    contains_secrets: false, contains_order_ids: false }, human_authorization_required: true,
  credits_consumed_by_authorization: false, external_generation_authorized: true,
  publication_allowed: false, ...overrides,
} });

test("normaliza autorización humana sin confundir generación con publicación", () => {
  const result = normalizeGenerationAuthorizations(envelope());
  assert.equal(result.authorizations[0].jobId, 19);
  assert.equal(result.authorizations[0].workerMayClaim, true);
  assert.equal(result.creditsConsumedByAuthorization, false);
  assert.equal(result.publicationAllowed, false);
});

test("falla cerrado ante publicación, PII o resumen inconsistente", () => {
  assert.throws(() => normalizeGenerationAuthorizations(envelope({ publication_allowed: true })), /separación/);
  assert.throws(() => normalizeGenerationAuthorizations(envelope({ customer_phone: "3000000000" })), /campo privado/);
  assert.throws(() => normalizeGenerationAuthorizations(envelope({ summary: { authorizations: 2 } })), /no coincide/);
});

test("rechaza proveedor, huella o permiso de fila inválidos", () => {
  const unsafe = envelope();
  unsafe.snapshot.authorizations[0] = authorization({ provider: "Otro" });
  assert.throws(() => normalizeGenerationAuthorizations(unsafe), /identidad/);
  const published = envelope();
  published.snapshot.authorizations[0].publication_allowed = true;
  assert.throws(() => normalizeGenerationAuthorizations(published), /publicación/);
});
