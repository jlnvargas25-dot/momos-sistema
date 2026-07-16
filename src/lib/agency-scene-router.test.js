import test from "node:test";
import assert from "node:assert/strict";
import { buildAgencySceneRouter, buildSceneRoutingDraft, recommendSceneProvider, sceneRoutingPayload } from "./agency-scene-router.js";

const board = { id: 31, status: "Aprobado", aspectRatio: "9:16", sourceFingerprint: "board-fp" };
const shots = [
  { id: 1, storyboardId: 31, shotNumber: 1, status: "Vigente", title: "Hook tipográfico", purpose: "Abrir curiosidad", durationSec: 3, estimatedCostCop: 10000, fingerprint: "a".repeat(32), payload: { subject: "Logo MOMOS", action: "El texto entra por capas", camera: "Fija", continuity_out: "Producto visible", on_screen_text: "¿Qué hay dentro?" } },
  { id: 2, storyboardId: 31, shotNumber: 2, status: "Vigente", title: "Relleno real", purpose: "Cerrar el payoff", durationSec: 3, estimatedCostCop: 15000, fingerprint: "b".repeat(32), payload: { subject: "Momo", action: "Dos manos lo parten", physics: "Ganache viscoso bajo gravedad", camera: "Macro dolly", continuity_out: "Logo y CTA" } },
  { id: 3, storyboardId: 31, shotNumber: 2, status: "Sustituida", title: "Vieja", estimatedCostCop: 99999, fingerprint: "c".repeat(32), payload: {} },
];

function operationalDb() {
  return {
    agencyIntegrationsReady: true, higgsfieldConnectorReady: true, klingConnectorReady: true,
    agencyIntegrations: ["Higgsfield", "Kling"].map((provider) => ({ provider, status: "Activa", secretConfigured: true, lastHeartbeatAt: new Date().toISOString() })),
  };
}

test("dirige motion gráfico a Higgsfield y física de producto a Kling", () => {
  assert.equal(recommendSceneProvider(shots[0]).provider, "Higgsfield");
  assert.equal(recommendSceneProvider(shots[1]).provider, "Kling");
});

test("crea exactamente una ruta por toma vigente y conserva costos", () => {
  const draft = buildSceneRoutingDraft(board, shots, operationalDb());
  assert.equal(draft.routes.length, 2);
  assert.equal(draft.totalEstimatedCostCop, 25000);
  assert.equal(draft.totalCostCapCop, 31300);
  assert.equal(draft.ready, true);
  assert.equal(draft.operational, true);
});

test("un costo desconocido bloquea la preparación sin inventar precio", () => {
  const draft = buildSceneRoutingDraft(board, [{ ...shots[0], estimatedCostCop: 0 }], operationalDb());
  assert.equal(draft.ready, false);
  assert.match(draft.reasons.join(" "), /costo real/i);
});

test("la preparación puede documentarse aunque el conector siga caído", () => {
  const draft = buildSceneRoutingDraft(board, shots, { agencyIntegrationsReady: true });
  assert.equal(draft.ready, true);
  assert.equal(draft.operational, false);
  assert.match(draft.operationalReasons.join(" "), /adaptador|activo/i);
});

test("el payload no delega al proveedor los activos ni la aprobación", () => {
  const draft = buildSceneRoutingDraft(board, shots, operationalDb());
  const payload = sceneRoutingPayload(draft);
  assert.equal(payload.storyboard_id, 31);
  assert.equal(payload.routes.length, 2);
  assert.equal(payload.routes[0].shot_fingerprint, shots[0].fingerprint);
  assert.equal("input_asset_ids" in payload.routes[0], false);
  assert.equal("authorized" in payload, false);
});

test("el centro une planes y trabajos sin ofrecer dos veces el mismo storyboard", () => {
  const db = {
    agencyStoryboards: [board, { id: 32, status: "Aprobado" }],
    agencySceneRoutingPlans: [{ id: 8, storyboardId: 31, status: "Preparado", totalCostCapCop: 30000 }],
    creativeGenerationJobs: [{ id: 99, outputSpec: { routing_plan_id: 8 } }],
  };
  const center = buildAgencySceneRouter(db);
  assert.deepEqual(center.eligibleStoryboards.map((item) => item.id), [32]);
  assert.equal(center.plans[0].jobs[0].id, 99);
  assert.equal(center.summary.prepared, 1);
});
