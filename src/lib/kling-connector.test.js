import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKlingRequest,
  extractKlingBilling,
  extractKlingOutputUrl,
  extractKlingTask,
  klingAspectRatio,
  klingBillingToCop,
  klingEstimatedUnits,
  klingOutputHostAllowed,
  klingUnitsToCop,
  normalizeKlingStatus,
} from "./kling-connector.js";

const job = {
  operation: "Generar video",
  targetFormat: "Reel 9:16",
  prompt: "Un Momo de Oreo gira lentamente sobre una mesa de cocina iluminada.",
  negativePrompt: "texto deformado",
  outputSpec: { duration_seconds: 5 },
};

test("construye el perfil económico de texto a video", () => {
  const request = buildKlingRequest(job, [], { externalTaskId: "momos-job-25-run-1" });
  assert.equal(request.endpoint, "/text-to-video/kling-3.0");
  assert.equal(request.body.settings.resolution, "720p");
  assert.equal(request.body.settings.duration, 5);
  assert.equal(request.body.settings.audio, "off");
  assert.equal(request.body.settings.aspect_ratio, "9:16");
  assert.equal(request.estimatedUnits, 3);
});

test("usa una fuente aprobada como primer fotograma sin incrustar secretos", () => {
  const signedUrl = "https://proyecto.supabase.co/storage/v1/object/sign/brand-assets/momo.png?token=temporal";
  const request = buildKlingRequest(job, [{ mimeType: "image/png", signedUrl }], { externalTaskId: "momos-job-25-run-2" });
  assert.equal(request.endpoint, "/image-to-video/kling-3.0");
  assert.equal(request.body.contents[1].type, "first_frame");
  assert.equal(request.body.contents[1].url, signedUrl);
  assert.doesNotMatch(JSON.stringify(request), /api[_-]?key|bearer/i);
});

test("rechaza modelos, perfiles y tareas ajenas al alcance aprobado", () => {
  assert.throws(() => buildKlingRequest({ ...job, operation: "Generar imagen", targetFormat: "Cuadrado 1:1" }, [], { externalTaskId: "momos-job-25-run-3" }), /solo está habilitado/);
  assert.throws(() => buildKlingRequest(job, [], { model: "kling-v3;rm", externalTaskId: "momos-job-25-run-4" }), /perfil aprobado/);
  assert.throws(() => buildKlingRequest(job, [], { externalTaskId: "corto" }), /idempotente/);
});

test("calcula y protege unidades y COP", () => {
  assert.equal(klingEstimatedUnits({ resolution: "720p", audio: "off", duration: 5 }), 3);
  assert.equal(klingEstimatedUnits({ resolution: "1080p", audio: "native", duration: 5 }), 6);
  assert.equal(klingUnitsToCop(3, 600, 1.25), 2250);
  assert.throws(() => klingUnitsToCop(3, 0), /conversión segura/);
  assert.equal(klingBillingToCop({ cash: 0.42, units: 0 }, { copPerUsd: 4200, copPerUnit: 588 }), 1764);
});

test("interpreta identidad, estado, salida y deducción oficiales", () => {
  const created = { code: 0, data: { id: "kl-123", status: "submitted", external_id: "momos-job-25-run-1" } };
  assert.deepEqual(extractKlingTask(created), { id: "kl-123", status: "submitted", externalId: "momos-job-25-run-1" });
  const completed = { data: [{ id: "kl-123", status: "succeeded", outputs: [{ type: "video", url: "https://p1.a.kwimgs.com/output.mp4" }], billing: [{ charge_type: "unit", amount: "3" }] }] };
  assert.equal(normalizeKlingStatus(completed), "Completado");
  assert.equal(extractKlingOutputUrl(completed), "https://p1.a.kwimgs.com/output.mp4");
  assert.deepEqual(extractKlingBilling(completed), { cash: 0, units: 3 });
});

test("bloquea salidas inseguras y SSRF", () => {
  assert.equal(klingOutputHostAllowed("https://cdn.klingai.com/a.mp4"), true);
  assert.equal(klingOutputHostAllowed("http://cdn.klingai.com/a.mp4"), false);
  assert.equal(klingOutputHostAllowed("https://127.0.0.1/a.mp4"), false);
  assert.equal(klingOutputHostAllowed("https://klingai.com.evil.test/a.mp4"), false);
  assert.throws(() => extractKlingOutputUrl({ data: [{ status: "succeeded", outputs: [{ type: "video", url: "https://evil.test/internal" }] }] }), /salida HTTPS permitida/);
  assert.equal(klingAspectRatio("TikTok 9:16"), "9:16");
});
