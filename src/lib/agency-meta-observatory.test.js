import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_META_POLICY, buildAgencyMetaCenter, buildMetaDiagnostic, deriveMetaMetrics, metaSnapshotPayload, pixelHealth, validateMetaSnapshot } from "./agency-meta-observatory.js";

const snapshot = {
  snapshotKey: "meta-cmp-01-20260701-20260707", accountExternalId: "act_123456", accountLabel: "MOMOS Meta",
  entityType: "Campaña", entityExternalId: "2385001", objective: "Ventas", currency: "COP", timezone: "America/Bogota",
  windowStart: "2026-07-01T00:00:00-05:00", windowEnd: "2026-07-08T00:00:00-05:00", sourceCapturedAt: "2026-07-08T01:00:00-05:00",
  metrics: { spend: 100000, impressions: 10000, reach: 7000, frequency: 1.43, clicks: 180, outboundClicks: 150, landingViews: 90,
    contentViews: 75, addsToCart: 20, checkouts: 10, purchases: 4, purchaseValue: 280000, video3s: 1500 },
  pixelEvents: [{ name: "Purchase", previous: 100, current: 65, emq: 7.2 }],
  catalogProducts: [{ productExternalId: "meta-pr01", localProductId: "PR01", name: "Momo Gatito", spend: 40000, momosTruth: { availableStock: 8, paidUnits: 4, expired: false } }],
  localTruth: { paidOrders: 3, paidRevenue: 250000, grossMargin: 125000 }, connectorName: "meta-mcp-private",
};

test("deriva tasas con denominadores explícitos sin inventar datos faltantes", () => {
  const result = deriveMetaMetrics(snapshot.metrics);
  assert.equal(result.roas, 2.8);
  assert.equal(result.ctrPct, 1.8);
  assert.equal(result.landingRatePct, 60);
  assert.equal(result.purchaseRatePct, 40);
});

test("rechaza monedas, ventanas y métricas inválidas", () => {
  assert.equal(validateMetaSnapshot(snapshot).ready, true);
  const invalid = validateMetaSnapshot({ ...snapshot, currency: "pesos", windowEnd: snapshot.windowStart, metrics: { spend: -1 } });
  assert.equal(invalid.ready, false);
  assert.match(invalid.reasons.join(" "), /moneda|ventana|negativa/i);
});

test("la alerta del píxel exige caída y piso de volumen", () => {
  const events = pixelHealth([{ name: "Purchase", previous: 100, current: 70, emq: 8.2 }, { name: "Lead", previous: 10, current: 1, emq: 3 }]);
  assert.equal(events[0].alert, true);
  assert.equal(events[1].alert, false);
  assert.equal(events[1].lowVolume, true);
  assert.equal(events[1].emqStatus, "Crítico");
});

test("el diagnóstico separa hechos, hipótesis y acciones no ejecutables", () => {
  const result = buildMetaDiagnostic(snapshot, DEFAULT_META_POLICY);
  assert.equal(result.ready, true);
  assert.equal(result.guards.readOnly, true);
  assert.equal(result.guards.spendChangeForbidden, true);
  assert.ok(result.whyHypotheses.every((item) => item.causal === false));
  assert.ok(result.recommendedActions.every((item) => item.changesExternalState === false));
  assert.equal(result.whatHappened.attributionGap, 30000);
});

test("catálogo conserva que gasto no equivale a ventas y bloquea vencidos", () => {
  const result = buildMetaDiagnostic({ ...snapshot, catalogProducts: [
    snapshot.catalogProducts[0],
    { productExternalId: "meta-pr02", name: "Momo vencido", spend: 80000, momosTruth: { availableStock: 10, expired: true } },
  ] });
  assert.equal(result.catalogHypotheses[0].hypothesisOnly, true);
  assert.equal(result.catalogHypotheses[1].eligible, false);
  assert.match(result.catalogHypotheses[1].reason, /vencido|stock/i);
});

test("el payload del conector no acepta publicación, pausa ni presupuesto", () => {
  const payload = metaSnapshotPayload(snapshot);
  assert.equal(payload.account_external_id, "act_123456");
  assert.equal(payload.catalog_products[0].local_product_id, "PR01");
  assert.equal("publish" in payload, false);
  assert.equal("budget" in payload, false);
  assert.equal("pause" in payload, false);
});

test("el centro agrupa snapshots, revisiones y alertas", () => {
  const center = buildAgencyMetaCenter({ agencyMetaSnapshots: [{ id: 1, ...snapshot }], agencyMetaDiagnostics: [{ id: 2, snapshotId: 1, status: "En revisión" }], agencyMetaPolicies: [] });
  assert.equal(center.summary.snapshots, 1);
  assert.equal(center.summary.reviewing, 1);
  assert.equal(center.summary.alerts, 1);
  assert.equal(center.snapshots[0].diagnostics.length, 1);
});
