import test from "node:test";
import assert from "node:assert/strict";
import { buildCreativeFlightCenter, creativeFlightForContract } from "./agency-creative-flight.js";

const contract = { id: 7, status: "Aprobado", sealedPayload: { creative_direction: {
  content_mode: "Orgánico", content_goal: "Construir deseo por Oreo", mode_primary_metric: "Guardados",
} } };

test("una corrida avanza solo con el relevo exacto de cada etapa", () => {
  const flight = creativeFlightForContract(contract, {
    agencyRetentionScripts: [{ id: 10, contractId: 7, status: "Aprobado" }],
    agencyStoryboards: [{ id: 20, contractId: 7, status: "Aprobado" }],
    agencyMotionPlans: [{ id: 30, storyboardId: 20, status: "Aprobado" }],
    agencySceneRoutingPlans: [{ id: 40, storyboardId: 20, status: "Autorizado", jobIds: [50] }],
    creativeGenerationJobs: [{ id: 50, status: "Completado", outputReviewStatus: "Aprobada" }],
    agencyStoryboardShots: [{ id: 60, storyboardId: 20, status: "Vigente" }],
    agencySceneQualityReviews: [{ id: 70, storyboardId: 20, status: "Aprobada" }],
    agencyPostproductionPackages: [{ id: 80, storyboardId: 20, status: "Aprobado" }],
    agencyPostproductionExports: [{ id: 90, packageId: 80, status: "Aprobada" }],
  });
  assert.equal(flight.progress, 80);
  assert.equal(flight.currentStage, "Distribución");
  assert.equal(flight.distribution, null);
});

test("no confunde una publicación cualquiera con el máster de la corrida", () => {
  const flight = creativeFlightForContract(contract, {
    content_distributions: [{ id: 5, postId: "CAL-1", status: "Publicada" }],
    agencyRetentionMeasurements: [{ id: 6, contentPostId: "CAL-1", impressions: 500 }],
  });
  assert.equal(flight.distribution, null);
  assert.equal(flight.measurements.length, 0);
  assert.equal(flight.currentStage, "Guion");
});

test("Pauta y Orgánico permanecen separados en el centro", () => {
  const paid = { ...contract, id: 8, sealedPayload: { creative_direction: {
    content_mode: "Pauta", content_goal: "Convertir compradores", mode_primary_metric: "CPA",
  } } };
  const center = buildCreativeFlightCenter({ agencyCreativeContracts: [contract, paid] });
  assert.equal(center.summary.pauta, 1);
  assert.equal(center.summary.organic, 1);
  assert.equal(center.summary.blocked, 0);
});

test("bloquea una métrica orgánica dentro de una corrida de pauta", () => {
  const bad = { ...contract, id: 9, sealedPayload: { creative_direction: {
    content_mode: "Pauta", content_goal: "Vender con atribución", mode_primary_metric: "Guardados",
  } } };
  assert.equal(creativeFlightForContract(bad, {}).blocked, true);
});
