import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPostproductionExportCenter,
  evaluatePostproductionMaster,
  postproductionExportPayload,
  postproductionAudioSelection,
  postproductionExportSpec,
  validatePostproductionExportSpec,
} from "./agency-postproduction-export.js";

test("deriva un máster vertical verificable desde el paquete aprobado", () => {
  const spec = postproductionExportSpec({ snapshot: { export_spec: { aspect_ratio: "9:16" } } });
  assert.deepEqual({ width: spec.width, height: spec.height, fps: spec.fps }, { width: 1080, height: 1920, fps: 30 });
  assert.equal(spec.burn_subtitles, false);
  assert.equal(validatePostproductionExportSpec(spec).valid, true);
});

test("no permite declarar un export sin control técnico", () => {
  const spec = postproductionExportSpec({}, { burnSubtitles: false });
  spec.final_qc_required = false;
  assert.equal(validatePostproductionExportSpec(spec).valid, false);
});

test("rechaza formatos que el worker operativo no garantiza", () => {
  const spec = postproductionExportSpec({}, { videoCodec: "prores", container: "mov" });
  assert.match(validatePostproductionExportSpec(spec).reasons.join(" "), /MP4.*H\.264.*AAC/i);
});

test("el payload conserva únicamente paquete y especificación cerrada", () => {
  const payload = postproductionExportPayload({ id: 33, snapshot: { export_spec: { aspect_ratio: "1:1" } } }, { exportKey: "master-33-v1" });
  assert.equal(payload.package_id, 33);
  assert.equal(payload.export_key, "master-33-v1");
  assert.equal(payload.export_spec.width, 1080);
  assert.deepEqual(payload.audio_selection, { mode: "Original" });
  assert.equal("publication" in payload, false);
});

test("la pista de Biblioteca se identifica sin transportar URLs ni derechos declarados por el navegador", () => {
  assert.deepEqual(postproductionAudioSelection({ id: 17, storagePath: "no-debe-viajar.mp3" }), { mode: "Biblioteca", audio_asset_id: 17 });
});

test("el QA final compara archivo y probe contra el contrato", () => {
  const job = { snapshot: { export_spec: { width: 1080, height: 1920, fps: 30, video_codec: "h264", color_space: "bt709", max_size_bytes: 10_000 } }, result: { technical_probe: { width: 1080, height: 1920, fps: 30, video_codec: "h264", color_space: "bt709", size_bytes: 9_000 } } };
  const asset = { status: "Activo", rightsStatus: "Autorizado", mimeType: "video/mp4", contentHash: "a".repeat(64), sizeBytes: 9_000 };
  assert.equal(evaluatePostproductionMaster(job, asset).approved, true);
  assert.match(evaluatePostproductionMaster({ ...job, result: { technical_probe: { ...job.result.technical_probe, width: 720 } } }, asset).reasons.join(" "), /width/i);
});

test("el centro no vuelve a autorizar un paquete con export activo", () => {
  const center = buildPostproductionExportCenter({
    agencyStoryboards: [{ id: 3, channel: "Instagram" }],
    agencyPostproductionPackages: [{ id: 1, status: "Aprobado" }, { id: 2, storyboardId: 3, status: "Aprobado" }],
    agencyPostproductionExports: [{ id: 9, packageId: 1, status: "Procesando" }],
    agencyPostproductionAudioBindings: [{ exportId: 9, mode: "Biblioteca", assetId: 4 }],
  });
  assert.deepEqual(center.candidates.map((item) => item.id), [2]);
  assert.equal(center.summary.processing, 1);
  assert.equal(center.exports[0].audioBinding.mode, "Biblioteca");
  assert.equal(center.candidates[0].storyboard.channel, "Instagram");
});
