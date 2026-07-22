import test from "node:test";
import assert from "node:assert/strict";
import { AGENCY_QUALITY_CRITERIA, buildAgencyQualityCenter, evaluateSceneQuality, postproductionPackagePayload, sceneQualityReviewPayload } from "./agency-quality-control.js";

const perfect = Object.fromEntries(AGENCY_QUALITY_CRITERIA.map(({ key }) => [key, 2]));

test("una toma exacta y con derechos supera el control", () => {
  const result = evaluateSceneQuality(perfect, true);
  assert.equal(result.approved, true);
  assert.equal(result.total, 22);
});

test("no promedia una falla crítica aunque el resto sea perfecto", () => {
  const result = evaluateSceneQuality({ ...perfect, gravity_viscosity: 0 }, true);
  assert.equal(result.approved, false);
  assert.match(result.reasons.join(" "), /Falla crítica.*Gravedad/i);
});

test("producto aproximado no entra al corte final", () => {
  const result = evaluateSceneQuality({ ...perfect, product_identity: 1 }, true);
  assert.equal(result.total, 21);
  assert.equal(result.approved, false);
  assert.match(result.reasons.join(" "), /exactos/i);
});

test("el payload deriva la decisión sin permitir una aprobación fingida", () => {
  const payload = sceneQualityReviewPayload({ id: 8, outputAssetId: 55 }, { ...perfect, light_geometry: 0 }, {
    rightsValid: true, failureType: "Fallo técnico", reviewNote: "La luz cambia con la cámara",
  });
  assert.equal(payload.decision, "Rechazar");
  assert.equal(payload.failure_type, "Fallo técnico");
  assert.equal(payload.output_asset_id, 55);
});

test("el paquete conserva solo tomas aprobadas y su orden", () => {
  const payload = postproductionPackagePayload({ id: 31, aspectRatio: "9:16", channel: "Instagram" }, { id: 7 }, [
    { id: 2, shotId: 12, shotNumber: 2, jobId: 92, outputAssetId: 82, status: "Aprobada" },
    { id: 1, shotId: 11, shotNumber: 1, jobId: 91, outputAssetId: 81, status: "Aprobada" },
    { id: 3, shotId: 13, shotNumber: 3, jobId: 93, outputAssetId: 83, status: "Rechazada" },
  ]);
  assert.deepEqual(payload.selections.map((item) => item.shot_id), [11, 12]);
  assert.equal(payload.export_spec.final_qc_required, true);
});

test("el centro no vuelve a ofrecer un trabajo ya controlado", () => {
  const center = buildAgencyQualityCenter({
    creativeGenerationJobs: [
      { id: 1, status: "Completado", outputReviewStatus: "Aprobada", outputAssetId: 10, outputSpec: { storyboard_shot_id: 7 } },
      { id: 2, status: "Completado", outputReviewStatus: "Aprobada", outputAssetId: 11, outputSpec: { storyboard_shot_id: 8 } },
    ],
    agencySceneQualityReviews: [{ id: 5, jobId: 1, shotId: 7, outputAssetId: 10, status: "Aprobada" }],
  });
  assert.deepEqual(center.eligibleJobs.map((job) => job.id), [2]);
  assert.equal(center.summary.approved, 1);
});
