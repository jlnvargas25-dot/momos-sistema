const clean = (value) => String(value ?? "").trim();
const list = (value) => Array.isArray(value) ? value : [];

const IMAGE_OPERATIONS = new Set(["Generar imagen", "Componer", "Adaptar", "Editar"]);
const VIDEO_HINT = /video|reel|tiktok|short|9:16/i;
const SAFE_MODEL = /^[a-z0-9_]+$/;

function clampText(value, max = 6000) {
  return clean(value).replace(/\u0000/g, "").slice(0, max);
}

function walk(value, visitor) {
  if (value == null) return undefined;
  const found = visitor(value);
  if (found !== undefined) return found;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = walk(item, visitor);
      if (nested !== undefined) return nested;
    }
  } else if (typeof value === "object") {
    for (const item of Object.values(value)) {
      const nested = walk(item, visitor);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function firstKey(value, keys) {
  const accepted = new Set(keys);
  return walk(value, (node) => {
    if (!node || Array.isArray(node) || typeof node !== "object") return undefined;
    for (const [key, item] of Object.entries(node)) {
      if (accepted.has(key) && item !== null && item !== "") return item;
    }
    return undefined;
  });
}

export function higgsfieldAspectRatio(targetFormat = "") {
  const match = clean(targetFormat).match(/(?:^|\s)(21:9|16:9|9:16|4:5|5:4|4:3|3:4|3:2|2:3|1:1)(?:\s|$)/);
  return match?.[1] || (VIDEO_HINT.test(targetFormat) ? "9:16" : "1:1");
}

export function higgsfieldJobKind(job = {}, media = []) {
  const operation = clean(job.operation);
  const targetFormat = job.targetFormat ?? job.target_format;
  const hasVideo = list(media).some((item) => clean(item.mimeType || item.mime_type).startsWith("video/"));
  if (operation === "Generar video" || hasVideo || VIDEO_HINT.test(targetFormat)) return "video";
  if (IMAGE_OPERATIONS.has(operation)) return "image";
  throw new Error("La operación creativa no tiene una ruta Higgsfield soportada.");
}

export function higgsfieldModelForJob(job = {}, media = [], overrides = {}) {
  const kind = higgsfieldJobKind(job, media);
  const model = clean(kind === "video" ? overrides.videoModel : overrides.imageModel)
    || (kind === "video" ? "gemini_omni" : "marketing_studio_image");
  if (!SAFE_MODEL.test(model)) throw new Error("El modelo Higgsfield configurado no es válido.");
  return { kind, model };
}

function durationForJob(job = {}) {
  const outputSpec = job.outputSpec ?? job.output_spec ?? {};
  const requested = Number(outputSpec.durationSeconds ?? outputSpec.duration_seconds ?? 8);
  const allowed = [4, 6, 8, 10];
  if (!Number.isFinite(requested)) return 8;
  return allowed.reduce((best, value) => Math.abs(value - requested) < Math.abs(best - requested) ? value : best, 8);
}

export function buildHiggsfieldCreateArgs(job = {}, media = [], overrides = {}) {
  const { kind, model } = higgsfieldModelForJob(job, media, overrides);
  const prompt = clampText(job.prompt);
  if (!prompt) throw new Error("El trabajo creativo no tiene prompt para Higgsfield.");
  const negative = clampText(job.negativePrompt ?? job.negative_prompt, 1200);
  const finalPrompt = negative ? `${prompt}\n\nEvitar: ${negative}` : prompt;
  const aspectRatio = higgsfieldAspectRatio(job.targetFormat ?? job.target_format);
  const args = ["generate", "create", model, "--prompt", finalPrompt, "--aspect_ratio", aspectRatio];

  if (kind === "image") {
    args.push("--resolution", clean(overrides.imageResolution) || "2k");
  } else {
    args.push("--duration", String(durationForJob(job)), "--resolution", clean(overrides.videoResolution) || "720p");
  }

  let videoReferences = 0;
  for (const source of list(media)) {
    const path = clean(source.localPath || source.path);
    const mime = clean(source.mimeType || source.mime_type);
    if (!path) continue;
    if (mime.startsWith("image/")) args.push("--image-references", path);
    else if (mime.startsWith("video/") && kind === "video" && videoReferences === 0) {
      args.push("--video-references", path);
      videoReferences += 1;
    }
  }
  args.push("--json", "--no-color");
  return { args, kind, model, aspectRatio };
}

export function extractHiggsfieldJobId(payload) {
  const value = firstKey(payload, ["job_id", "jobId", "generation_id", "generationId"])
    ?? firstKey(payload, ["id"]);
  const id = clean(value);
  if (!id || id === "[object Object]") throw new Error("Higgsfield no devolvió una identidad de trabajo verificable.");
  return id;
}

export function extractHiggsfieldOutputUrl(payload) {
  const value = firstKey(payload, ["result_url", "resultUrl", "output_url", "outputUrl", "download_url", "downloadUrl", "url"]);
  const url = clean(value);
  if (!/^https:\/\//i.test(url)) throw new Error("Higgsfield marcó el trabajo como completo sin una salida HTTPS.");
  return url;
}

export function normalizeHiggsfieldStatus(payload) {
  const raw = clean(firstKey(payload, ["status", "state"])).toLowerCase();
  if (["completed", "complete", "succeeded", "success", "done", "finished"].includes(raw)) return "Completado";
  if (["failed", "error", "cancelled", "canceled"].includes(raw)) return "Fallido";
  if (["queued", "pending", "created", "processing", "running", "in_progress", "in progress"].includes(raw)) return "En generación";
  return "Desconocido";
}

export function extractHiggsfieldCredits(payload) {
  const raw = firstKey(payload, ["estimated_credits", "estimatedCredits", "cost_credits", "costCredits", "credits"]);
  const credits = Number(raw);
  if (!Number.isFinite(credits) || credits < 0) throw new Error("Higgsfield no devolvió un costo estimado en créditos.");
  return credits;
}

export function higgsfieldCreditsToCop(credits, copPerCredit) {
  const amount = Number(credits);
  const rate = Number(copPerCredit);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("Falta configurar una conversión válida de crédito Higgsfield a COP.");
  }
  return Math.ceil(amount * rate);
}

export function redactConnectorError(error) {
  return clampText(error instanceof Error ? error.message : error, 500)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTADO]")
    .replace(/\b(?:sb_secret|eyJ)[A-Za-z0-9._-]{12,}\b/g, "[SECRETO REDACTADO]")
    .replace(/(?:token|secret|key)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTADO]");
}
