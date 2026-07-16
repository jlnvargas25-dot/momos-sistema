import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHiggsfieldCreateArgs,
  extractHiggsfieldCredits,
  extractHiggsfieldJobId,
  extractHiggsfieldOutputUrl,
  higgsfieldAspectRatio,
  higgsfieldCreditsToCop,
  higgsfieldModelForJob,
  normalizeHiggsfieldStatus,
  redactConnectorError,
} from "./higgsfield-connector.js";

const imageJob = { operation: "Generar imagen", targetFormat: "Post 4:5", prompt: "Momo Oreo sobre fondo rosa", negativePrompt: "texto deformado" };
const videoJob = { operation: "Generar video", targetFormat: "Reel 9:16", prompt: "Close-up de producto", outputSpec: { durationSeconds: 7 } };

test("elige modelos de marketing y conserva el formato social", () => {
  assert.deepEqual(higgsfieldModelForJob(imageJob), { kind: "image", model: "marketing_studio_image" });
  assert.deepEqual(higgsfieldModelForJob(videoJob), { kind: "video", model: "gemini_omni" });
  assert.equal(higgsfieldAspectRatio("Historia 9:16"), "9:16");
  assert.equal(higgsfieldAspectRatio("Cuadrado"), "1:1");
});

test("construye argumentos sin shell y separa referencias de imagen y video", () => {
  const result = buildHiggsfieldCreateArgs(videoJob, [
    { localPath: "C:/tmp/max.png", mimeType: "image/png" },
    { localPath: "C:/tmp/toma.mp4", mimeType: "video/mp4" },
    { localPath: "C:/tmp/segunda.mp4", mimeType: "video/mp4" },
  ]);
  assert.deepEqual(result.args.slice(0, 3), ["generate", "create", "gemini_omni"]);
  assert.equal(result.args.includes("--image-references"), true);
  assert.equal(result.args.filter((value) => value === "--video-references").length, 1);
  assert.equal(result.args[result.args.indexOf("--duration") + 1], "8");
  assert.match(result.args[result.args.indexOf("--prompt") + 1], /Close-up de producto/);
  assert.equal(result.args.at(-2), "--json");
});

test("acepta el contrato snake_case que entrega la RPC privada", () => {
  const command = buildHiggsfieldCreateArgs({
    operation: "Generar video", prompt: "Producto MOMOS", negative_prompt: "texto deformado",
    target_format: "Reel 9:16", output_spec: { duration_seconds: 10 },
  }, []);
  assert.equal(command.kind, "video");
  assert.ok(command.args.includes("9:16"));
  assert.ok(command.args.includes("10"));
  assert.match(command.args[command.args.indexOf("--prompt") + 1], /Evitar: texto deformado/);
});

test("rechaza modelos inyectados y trabajos sin prompt", () => {
  assert.throws(() => higgsfieldModelForJob(imageJob, [], { imageModel: "modelo; borrar" }), /no es válido/);
  assert.throws(() => buildHiggsfieldCreateArgs({ ...imageJob, prompt: "" }), /no tiene prompt/);
});

test("normaliza respuestas variables del CLI sin aceptar salida insegura", () => {
  assert.equal(extractHiggsfieldJobId({ data: { job_id: "hf-123" } }), "hf-123");
  assert.equal(normalizeHiggsfieldStatus({ state: "in_progress" }), "En generación");
  assert.equal(normalizeHiggsfieldStatus({ result: { status: "succeeded" } }), "Completado");
  assert.equal(extractHiggsfieldOutputUrl({ result: { download_url: "https://cdn.higgsfield.ai/out.mp4" } }), "https://cdn.higgsfield.ai/out.mp4");
  assert.throws(() => extractHiggsfieldOutputUrl({ url: "http://inseguro.test/out.mp4" }), /salida HTTPS/);
});

test("convierte créditos a COP y falla cerrado cuando no existe tasa", () => {
  assert.equal(extractHiggsfieldCredits({ estimate: { estimated_credits: 12.5 } }), 12.5);
  assert.equal(higgsfieldCreditsToCop(12.5, 200), 2500);
  assert.throws(() => higgsfieldCreditsToCop(2, 0), /Falta configurar/);
});

test("redacta tokens antes de reportar errores a MOMO OPS", () => {
  const message = redactConnectorError("401 Bearer abc.def.ghi token=supersecreto sb_secret_123456789012345");
  assert.equal(message.includes("supersecreto"), false);
  assert.equal(message.includes("sb_secret_"), false);
  assert.match(message, /REDACTADO/);
});
