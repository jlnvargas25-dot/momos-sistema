import test from "node:test";
import assert from "node:assert/strict";
import { buildCreativeProductionQueue, creativeAuthorizationGuard, creativeOutputReviewStatus, recommendedCreativeProvider } from "./creative-production.js";

const asset = { id: 1, name: "Max Oreo", status: "Activo", rightsStatus: "Propio", aiUseAllowed: true };
const job = { id: 8, status: "Preparado", provider: "Higgsfield", operation: "Generar video", targetFormat: "Reel 9:16", inputAssetIds: [1] };

test("recomienda proveedor según el trabajo sin confundir avatar con producto", () => {
  assert.equal(recommendedCreativeProvider({ operation: "Generar video", prompt: "avatar hablando a cámara" }), "HeyGen");
  assert.equal(recommendedCreativeProvider({ operation: "Generar video", prompt: "close-up cinematográfico del producto" }), "Kling");
  assert.equal(recommendedCreativeProvider({ operation: "Editar", targetFormat: "Post 4:5" }), "Manual");
});

test("autoriza solo con motor, tope y derechos vigentes", () => {
  const db = { brandMediaAssets: [asset], agencySettings: { paused: false } };
  assert.equal(creativeAuthorizationGuard(job, { maxCostCop: 30000 }, db).allowed, true);
  assert.equal(creativeAuthorizationGuard({ ...job, provider: "Por conectar" }, { maxCostCop: 30000 }, db).allowed, false);
  assert.equal(creativeAuthorizationGuard(job, { maxCostCop: 0 }, db).allowed, false);
  assert.equal(creativeAuthorizationGuard(job, { maxCostCop: 30000 }, { ...db, agencySettings: { paused: true } }).allowed, false);
  assert.equal(creativeAuthorizationGuard(job, { maxCostCop: 30000 }, { ...db, brandMediaAssets: [{ ...asset, rightsStatus: "Restringido" }] }).allowed, false);
});

test("cola separa trabajo activo e historial y suma solo topes comprometidos", () => {
  const db = { creativeProductionReady: true, creativeReviewReady: true, brandMediaAssets: [asset], creativeGenerationJobs: [
    job,
    { ...job, id: 9, status: "Autorizado", maxCostCop: 20000 },
    { ...job, id: 10, status: "En generación", maxCostCop: 25000 },
    { ...job, id: 11, status: "Completado", maxCostCop: 50000, outputAssetId: 1, outputReviewStatus: "Pendiente" },
  ] };
  const queue = buildCreativeProductionQueue(db);
  assert.equal(queue.active.length, 3);
  assert.equal(queue.history.length, 1);
  assert.equal(queue.summary.authorizedCostCop, 45000);
  assert.equal(queue.jobs.find((item) => item.id === 11).outputAsset.name, "Max Oreo");
  assert.equal(queue.summary.pendingReview, 1);
});

test("encadena una corrección sin ocultar la versión anterior", () => {
  const db = { creativeProductionReady: true, creativeReviewReady: true, creativeIterationReady: true,
    brandMediaAssets: [asset], creativeGenerationJobs: [
      { ...job, id: 20, status: "Completado", outputAssetId: 1, outputReviewStatus: "Cambios solicitados", revisionNumber: 1 },
      { ...job, id: 21, status: "Preparado", revisionOfJobId: 20, revisionNumber: 2 },
    ] };
  const queue = buildCreativeProductionQueue(db);
  assert.equal(queue.jobs.find((item) => item.id === 20).revisionJob.id, 21);
  assert.equal(queue.jobs.find((item) => item.id === 21).parentJob.id, 20);
  assert.equal(queue.summary.revisions, 1);
  assert.equal(queue.history.length, 1);
  assert.equal(queue.active.length, 1);
});

test("una salida completada nunca aparece aprobada por omisión", () => {
  const completed = { status: "Completado", outputAssetId: 7 };
  assert.equal(creativeOutputReviewStatus(completed, false), "Pendiente");
  assert.equal(creativeOutputReviewStatus({ ...completed, outputReviewStatus: "Aprobada" }, true), "Aprobada");
  assert.equal(creativeOutputReviewStatus({ ...completed, outputReviewStatus: "No aplica" }, true), "Pendiente");
  assert.equal(creativeOutputReviewStatus({ status: "Fallido", outputAssetId: 7 }, true), "No aplica");
});
