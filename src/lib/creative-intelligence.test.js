import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCreativeIntelligence } from "./creative-intelligence.js";

function envelope(overrides = {}) {
  return {
    fingerprint: "a".repeat(64),
    snapshot: {
      schema_version: "momos-creative-intelligence/v1", generated_at: "2026-07-22T12:00:00Z",
      formulas: [{
        id: 1, formula_key: "dulce-antojo", version: 1, name: "Dulce antojo", mode: "Pauta",
        status: "Aprobada", source_creative_id: "CRE-1", source_creative_version_id: 4,
        retention_script_id: null, campaign_id: "CMP-1", product_id: "PROD-1", channel: "Instagram",
        objective: "Ventas", figure: "Max", flavor: "Mango biche",
        formula_snapshot: { hook: "Antojo", narrative_structure: "Bolsa y cucharada" },
        formula_fingerprint: "b".repeat(64), source_kind: "Agente", prepared_at: "2026-07-22", reviewed_at: "2026-07-22",
      }],
      measurements: [{
        id: 2, measurement_key: "measure-1", formula_id: 1, platform: "Meta",
        window_start: "2026-07-15", window_end: "2026-07-22", impressions: 1200, reach: 900,
        clicks: 80, messages: 12, spend: 10000, platform_attributed_revenue: 25000,
        internal_paid_orders: 2, internal_revenue: 22000, internal_margin: 14000,
        internal_roas: 2.2, contribution_return: 1.4, platform_roas: 2.5,
        attribution_gap: 3000, unattributed_campaign_orders: 0, attribution_status: "Exacta",
        evidence_fingerprint: "c".repeat(64), outcome: "Ganadora", source_kind: "Humano",
        recorded_at: "2026-07-22", decided_at: "2026-07-22",
      }],
      summary: { formulas: 1, approved: 1, pending_review: 0, measurements: 1, winners: 1 },
      metric_definitions: {
        platform_roas: "plataforma / gasto", internal_roas: "MOMOS / gasto",
        contribution_return: "margen / gasto", attribution_is_causality: false,
      },
      privacy: { contains_customer_pii: false, contains_staff_identity: false, contains_secrets: false, contains_order_ids: false },
      human_approval_required: true, external_execution_allowed: false,
      ...overrides,
    },
  };
}

test("normaliza fórmulas y mantiene separados los tres retornos", () => {
  const value = normalizeCreativeIntelligence(envelope());
  assert.equal(value.formulas[0].formulaKey, "dulce-antojo");
  assert.equal(value.measurements[0].platformRoas, 2.5);
  assert.equal(value.measurements[0].internalRoas, 2.2);
  assert.equal(value.measurements[0].contributionReturn, 1.4);
  assert.equal(value.externalExecutionAllowed, false);
});

test("falla cerrado ante PII, ejecución, huellas o causalidad inventada", () => {
  assert.throws(() => normalizeCreativeIntelligence(envelope({ customer_phone: "3000000000" })), /campo privado/);
  assert.throws(() => normalizeCreativeIntelligence(envelope({ external_execution_allowed: true })), /ampliar permisos/);
  assert.throws(() => normalizeCreativeIntelligence({ ...envelope(), fingerprint: "sin-huella" }), /huella válida/);
  assert.throws(() => normalizeCreativeIntelligence(envelope({
    metric_definitions: { attribution_is_causality: true },
  })), /atribución con causalidad/);
});

test("TikTok puede informar verdad interna sin fabricar ROAS de plataforma", () => {
  const value = normalizeCreativeIntelligence(envelope({
    measurements: [{ ...envelope().snapshot.measurements[0], platform: "TikTok",
      platform_attributed_revenue: null, platform_roas: null, attribution_gap: null,
      attribution_status: "Sin señal de plataforma" }],
  }));
  assert.equal(value.measurements[0].internalRoas, 2.2);
  assert.equal(value.measurements[0].platformRoas, null);
  assert.equal(value.measurements[0].attributionStatus, "Sin señal de plataforma");
});
