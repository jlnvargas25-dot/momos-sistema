import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProductionPreflight } from "./production-preflight.js";

const plan = () => ({
  id: 1, plan_key: "plan-h107", formula_id: 2, production_pack_id: 3, version: 1,
  status: "Aprobado", provider: "Higgsfield", operation: "Generar video", model_label: "Seedance 2.0",
  channel: "Instagram", target_format: "Reel 9:16", duration_seconds: 8, output_count: 1,
  estimated_cost_cop: 5000, max_cost_cop: 8000, formula_fingerprint: "a".repeat(64),
  pack_fingerprint: "b".repeat(32), preflight_fingerprint: "c".repeat(64), source_kind: "Agente",
  prepared_at: "2026-07-22T12:00:00Z", reviewed_at: "2026-07-22T13:00:00Z",
  preflight: { schema_version: "momos-formula-production-preflight/v1",
    formula: { id: 2, fingerprint: "a".repeat(64) }, production_pack: { id: 3, asset_ids: [4] },
    routing: { provider: "Higgsfield", connector_ready: false },
    guards: { formula_approved: true, pack_approved: true, pack_ready: true,
      human_approval_required: true, credits_consumed: false, job_created: false,
      external_execution_allowed: false, publication_allowed: false } },
});

const envelope = (overrides = {}) => ({ fingerprint: "d".repeat(64), snapshot: {
  schema_version: "momos-production-preflight/v1", generated_at: "2026-07-22T12:00:00Z",
  plans: [plan()], summary: { plans: 1, prepared: 0, pending_review: 0, approved: 1 },
  privacy: { contains_customer_pii: false, contains_staff_identity: false, contains_storage_paths: false,
    contains_secrets: false, contains_order_ids: false }, human_approval_required: true,
  credits_consumed: false, jobs_created: false, external_execution_allowed: false,
  publication_allowed: false, ...overrides,
} });

test("normaliza un preflight sellado sin convertirlo en ejecución", () => {
  const result = normalizeProductionPreflight(envelope());
  assert.equal(result.plans[0].provider, "Higgsfield");
  assert.equal(result.plans[0].preflight.routing.connector_ready, false);
  assert.equal(result.creditsConsumed, false);
  assert.equal(result.jobsCreated, false);
});

test("falla cerrado ante ejecución, PII o conteos inconsistentes", () => {
  assert.throws(() => normalizeProductionPreflight(envelope({ external_execution_allowed: true })), /guardas/);
  assert.throws(() => normalizeProductionPreflight(envelope({ customer_phone: "3000000000" })), /campo privado/);
  assert.throws(() => normalizeProductionPreflight(envelope({ summary: { plans: 3 } })), /no coincide/);
});

test("rechaza un plan que declare crédito o trabajo creado", () => {
  const unsafe = envelope();
  unsafe.snapshot.plans[0].preflight.guards.job_created = true;
  assert.throws(() => normalizeProductionPreflight(unsafe), /ampliar permisos/);
});
