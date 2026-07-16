const clean = (value) => String(value ?? "").trim();
const list = (value) => Array.isArray(value) ? value : [];

const RESOLUTIONS = new Set(["720p", "1080p", "4k"]);
const AUDIO_MODES = new Set(["off", "native"]);
const ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1"]);
const OUTPUT_HOSTS = ["klingai.com", "kling.ai", "kwimgs.com", "yximgs.com"];

// Tabla oficial de Kling Open Platform para kling-v3, expresada en unidades/s.
// El valor COP de cada unidad se configura en el worker y nunca en el frontend.
const UNITS_PER_SECOND = Object.freeze({
  off: Object.freeze({ "720p": 0.6, "1080p": 0.8, "4k": 3 }),
  native: Object.freeze({ "720p": 0.9, "1080p": 1.2, "4k": 3 }),
});

function clampText(value, max) {
  return clean(value).replace(/\u0000/g, "").slice(0, max);
}

function taskRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.result)) return payload.data.result;
  if (payload?.data && typeof payload.data === "object") return [payload.data];
  return [];
}

function configuredDuration(job = {}, fallback = 5) {
  const spec = job.outputSpec ?? job.output_spec ?? {};
  const duration = Number(spec.durationSeconds ?? spec.duration_seconds ?? fallback);
  if (!Number.isInteger(duration) || duration < 3 || duration > 15) return fallback;
  return duration;
}

export function klingAspectRatio(targetFormat = "") {
  const match = clean(targetFormat).match(/(?:^|\s)(16:9|9:16|1:1)(?:\s|$)/);
  return match?.[1] || (/reel|historia|tiktok|short/i.test(targetFormat) ? "9:16" : "16:9");
}

export function klingOutputHostAllowed(value, suffixes = OUTPUT_HOSTS) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) return false;
  return list(suffixes).some((suffix) => {
    const accepted = clean(suffix).toLowerCase().replace(/^\.+/, "");
    return accepted && (host === accepted || host.endsWith(`.${accepted}`));
  });
}

export function klingEstimatedUnits(settings = {}) {
  const resolution = clean(settings.resolution || "720p").toLowerCase();
  const audio = clean(settings.audio || "off").toLowerCase();
  const duration = Number(settings.duration ?? 5);
  if (!RESOLUTIONS.has(resolution) || !AUDIO_MODES.has(audio)) throw new Error("La calidad Kling configurada no es válida.");
  if (!Number.isInteger(duration) || duration < 3 || duration > 15) throw new Error("La duración Kling debe estar entre 3 y 15 segundos.");
  return Number((UNITS_PER_SECOND[audio][resolution] * duration).toFixed(4));
}

export function klingUnitsToCop(units, copPerUnit, safetyFactor = 1) {
  const amount = Number(units);
  const rate = Number(copPerUnit);
  const factor = Number(safetyFactor);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(rate) || rate <= 0
      || !Number.isFinite(factor) || factor < 1 || factor > 3) {
    throw new Error("Falta configurar una conversión segura de unidades Kling a COP.");
  }
  return Math.ceil(amount * rate * factor);
}

export function buildKlingRequest(job = {}, media = [], options = {}) {
  const operation = clean(job.operation);
  const targetFormat = clean(job.targetFormat ?? job.target_format);
  if (operation !== "Generar video" && !/video|reel|historia|tiktok|short/i.test(targetFormat)) {
    throw new Error("Kling 3.0 solo está habilitado para trabajos de video en este hito.");
  }
  const prompt = clampText(job.prompt, 2500);
  if (prompt.length < 12) throw new Error("El trabajo creativo no tiene un prompt suficiente para Kling.");
  const negative = clampText(job.negativePrompt ?? job.negative_prompt, 500);
  const finalPrompt = negative ? `${prompt}\n\nEvitar: ${negative}` : prompt;
  const model = clean(options.model || "kling-3.0");
  if (model !== "kling-3.0") throw new Error("El modelo Kling no pertenece al perfil aprobado.");
  const resolution = clean(options.resolution || "720p").toLowerCase();
  const audio = clean(options.audio || "off").toLowerCase();
  const duration = configuredDuration(job, Number(options.duration || 5));
  const aspectRatio = klingAspectRatio(targetFormat);
  if (!RESOLUTIONS.has(resolution) || !AUDIO_MODES.has(audio) || !ASPECT_RATIOS.has(aspectRatio)) {
    throw new Error("La salida Kling solicitada no pertenece al perfil seguro.");
  }
  const externalTaskId = clean(options.externalTaskId);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(externalTaskId)) throw new Error("Falta una identidad externa idempotente para Kling.");
  const images = list(media).filter((item) => clean(item.mimeType ?? item.mime_type).startsWith("image/"));
  const firstFrame = images.find((item) => /^https:\/\//i.test(clean(item.signedUrl ?? item.url)));
  const settings = { resolution, duration, audio, multi_shot: false };
  const optionsBody = { external_task_id: externalTaskId, watermark_info: { enabled: false } };
  if (firstFrame) {
    return {
      endpoint: `/image-to-video/${model}`,
      kind: "image-to-video",
      model,
      settings,
      aspectRatio,
      estimatedUnits: klingEstimatedUnits(settings),
      body: {
        contents: [
          { type: "prompt", text: finalPrompt },
          { type: "first_frame", url: clean(firstFrame.signedUrl ?? firstFrame.url) },
        ],
        settings,
        options: optionsBody,
      },
    };
  }
  return {
    endpoint: `/text-to-video/${model}`,
    kind: "text-to-video",
    model,
    settings: { ...settings, aspect_ratio: aspectRatio },
    aspectRatio,
    estimatedUnits: klingEstimatedUnits(settings),
    body: { prompt: finalPrompt, settings: { ...settings, aspect_ratio: aspectRatio }, options: optionsBody },
  };
}

export function extractKlingTask(payload) {
  const task = taskRows(payload)[0];
  const id = clean(task?.id ?? task?.task_id);
  if (!id) throw new Error("Kling no devolvió una identidad de tarea verificable.");
  return { id, status: clean(task.status ?? task.task_status), externalId: clean(task.external_id) };
}

export function findKlingTask(payload) {
  const task = taskRows(payload)[0];
  return task && typeof task === "object" ? task : null;
}

export function normalizeKlingStatus(payload) {
  const task = findKlingTask(payload) || payload;
  const status = clean(task?.status ?? task?.task_status).toLowerCase();
  if (status === "succeeded" || status === "succeed") return "Completado";
  if (status === "failed") return "Fallido";
  if (["submitted", "processing", "pending", "running"].includes(status)) return "En generación";
  return "Desconocido";
}

export function extractKlingOutputUrl(payload) {
  const task = findKlingTask(payload) || payload;
  const output = list(task?.outputs ?? task?.task_result?.videos)
    .find((item) => !item?.type || item.type === "video");
  const url = clean(output?.url);
  if (!klingOutputHostAllowed(url)) throw new Error("Kling completó la tarea sin una salida HTTPS permitida.");
  return url;
}

export function extractKlingBilling(payload) {
  const task = findKlingTask(payload) || payload;
  const billing = list(task?.billing);
  return billing.reduce((total, row) => {
    const amount = Number(row?.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Kling devolvió una deducción inválida.");
    if (row.charge_type === "cash") total.cash += amount;
    else if (row.charge_type === "unit") total.units += amount;
    else throw new Error("Kling devolvió un tipo de deducción desconocido.");
    return total;
  }, { cash: 0, units: 0 });
}

export function klingBillingToCop(billing, { copPerUsd, copPerUnit }) {
  const cash = Number(billing?.cash || 0);
  const units = Number(billing?.units || 0);
  const usdRate = Number(copPerUsd);
  const unitRate = Number(copPerUnit);
  if (cash < 0 || units < 0 || !Number.isFinite(cash) || !Number.isFinite(units)
      || !Number.isFinite(usdRate) || usdRate <= 0 || !Number.isFinite(unitRate) || unitRate <= 0) {
    throw new Error("Falta configurar la valoración Kling en COP.");
  }
  return Math.ceil(cash * usdRate + units * unitRate);
}

export function klingFailureMessage(payload) {
  const task = findKlingTask(payload) || payload;
  return clampText(task?.message ?? task?.task_status_msg ?? payload?.message ?? "Kling marcó la tarea como fallida.", 500);
}
