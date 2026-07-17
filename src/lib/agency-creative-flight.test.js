import test from "node:test";
import assert from "node:assert/strict";
import { buildCreativeFlightCenter, creativeCandidatesForFlight, creativeFlightForContract, creativeRelayStep, publicationCandidatesForFlight, publicationDraftForFlight } from "./agency-creative-flight.js";

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

test("el relevo humano solo ofrece creativos aprobados del producto, canal y modo exactos", () => {
  const flight = creativeFlightForContract({ ...contract, sealedPayload: {
    facts: { product: { id: "P01" } },
    creative_direction: { content_mode: "Orgánico", content_goal: "Deseo", mode_primary_metric: "Guardados", channel: "Instagram" },
  } }, { agencyStoryboards: [{ id: 20, contractId: 7, status: "Aprobado", channel: "Instagram" }] });
  const db = {
    campaigns: [{ id: "C0", presupuesto: 0 }, { id: "CP", presupuesto: 50000 }],
    creatives: [
      { id: "OK", estado: "Aprobado", canal: "Instagram", productoFocoId: "P01", campaignId: "C0", formato: "Reel" },
      { id: "PAID", estado: "Aprobado", canal: "Instagram", productoFocoId: "P01", campaignId: "CP", formato: "Reel" },
      { id: "WRONG-PRODUCT", estado: "Aprobado", canal: "Instagram", productoFocoId: "P02", campaignId: "C0", formato: "Reel" },
      { id: "DRAFT", estado: "Borrador", canal: "Instagram", productoFocoId: "P01", campaignId: "C0", formato: "Reel" },
    ],
  };
  assert.deepEqual(creativeCandidatesForFlight(flight, db).map((row) => row.id), ["OK"]);
});

test("la publicación reutilizable debe estar programada y conservar la cadena exacta", () => {
  const flight = { mode: "Orgánico", goal: "Deseo", board: { channel: "Instagram" }, release: {
    id: 9, creativeId: "CRE-1", status: "Máster vinculado", lineageSnapshot: { channel: "Instagram" },
  } };
  const db = {
    campaigns: [{ id: "C0", presupuesto: 0 }],
    creatives: [{ id: "CRE-1", campaignId: "C0", canal: "Instagram", formato: "Reel", titulo: "Oreo", copy: "Probalo" }],
    content_calendar: [
      { id: "CAL-1", creativeId: "CRE-1", campaignId: "C0", canal: "Instagram", estado: "Programado" },
      { id: "CAL-2", creativeId: "CRE-1", campaignId: "C0", canal: "TikTok", estado: "Programado" },
      { id: "CAL-3", creativeId: "CRE-1", campaignId: "C0", canal: "Instagram", estado: "Publicado" },
    ],
  };
  assert.deepEqual(publicationCandidatesForFlight(flight, db).map((row) => row.id), ["CAL-1"]);
  assert.deepEqual(publicationDraftForFlight(flight, db, "2026-07-18"), {
    fecha: "2026-07-18", hora: "12:00", canal: "Instagram", creativeId: "CRE-1", campaignId: "C0",
    titulo: "Oreo", copyFinal: "Probalo",
  });
  assert.equal(creativeRelayStep({ ...flight, currentStage: "Distribución", master: { status: "Aprobada" } }), "publication");
});
