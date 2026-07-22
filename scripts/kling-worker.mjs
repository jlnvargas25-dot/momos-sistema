import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { redactConnectorError } from "../src/lib/higgsfield-connector.js";
import { assertConnectorRuntime } from "../src/lib/connector-runtime-guard.js";
import {
  buildKlingRequest,
  extractKlingBilling,
  extractKlingOutputUrl,
  extractKlingTask,
  findKlingTask,
  klingBillingToCop,
  klingFailureMessage,
  klingOutputHostAllowed,
  klingUnitsToCop,
  normalizeKlingStatus,
} from "../src/lib/kling-connector.js";

const VERSION = "momos-kling-worker/1.0.0";
const ONCE = process.argv.includes("--once");
const HEALTH_ONLY = process.argv.includes("--health-only");
const POLL_MS = Math.max(10_000, Number(process.env.KLING_POLL_MS || 30_000));
const WORKER_ID = process.env.KLING_WORKER_ID || `${hostname()}-${process.pid}`;
const API_KEY = String(process.env.KLING_API_KEY || "").trim();
const API_BASE_URL = String(process.env.KLING_API_BASE_URL || "https://api-singapore.klingai.com").replace(/\/+$/, "");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COP_PER_UNIT = Number(process.env.KLING_COP_PER_UNIT);
const COP_PER_USD = Number(process.env.KLING_COP_PER_USD);
const SAFETY_FACTOR = Number(process.env.KLING_COST_SAFETY_FACTOR || 1.25);
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const OUTPUT_HOST_SUFFIXES = String(process.env.KLING_OUTPUT_HOST_SUFFIXES || "klingai.com,kling.ai,kwimgs.com,yximgs.com")
  .split(",").map((item) => item.trim()).filter(Boolean);

function isSupabaseServerKey(value) {
  const key = String(value || "").trim();
  if (key.startsWith("sb_secret_")) return true;
  if (key.startsWith("sb_publishable_")) return false;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.role === "service_role";
  } catch { return false; }
}

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno privado del worker.");
const CONNECTOR_RUNTIME = assertConnectorRuntime({
  supabaseUrl: SUPABASE_URL,
  environment: process.env.MOMOS_CONNECTOR_ENVIRONMENT,
  projectRef: process.env.MOMOS_CONNECTOR_PROJECT_REF,
  stagingConfirmation: process.env.MOMOS_CONNECTOR_ALLOW_STAGING,
  productionConfirmation: process.env.MOMOS_CONNECTOR_ALLOW_PRODUCTION,
});
let supabaseEndpoint;
try { supabaseEndpoint = new URL(SUPABASE_URL); }
catch { throw new Error("SUPABASE_URL debe ser la URL completa del proyecto, por ejemplo https://proyecto.supabase.co."); }
if (!/^https?:$/.test(supabaseEndpoint.protocol)) throw new Error("SUPABASE_URL debe comenzar por https:// (o http:// únicamente para desarrollo local).");
if (!isSupabaseServerKey(SERVICE_KEY)) throw new Error("SUPABASE_SERVICE_ROLE_KEY no es una clave privada sb_secret_ ni una service_role válida. No uses publishable o anon.");
if (!API_KEY || API_KEY.length < 16) throw new Error("Falta KLING_API_KEY del Open Platform en el entorno privado del worker.");
if (new URL(API_BASE_URL).origin !== "https://api-singapore.klingai.com") throw new Error("KLING_API_BASE_URL no apunta al Open Platform oficial aprobado.");
if (!HEALTH_ONLY && (!Number.isFinite(COP_PER_UNIT) || COP_PER_UNIT <= 0 || !Number.isFinite(COP_PER_USD) || COP_PER_USD <= 0)) {
  throw new Error("Faltan KLING_COP_PER_UNIT o KLING_COP_PER_USD para proteger el presupuesto.");
}
if (!HEALTH_ONLY && (!Number.isFinite(SAFETY_FACTOR) || SAFETY_FACTOR < 1 || SAFETY_FACTOR > 3)) throw new Error("KLING_COST_SAFETY_FACTOR debe estar entre 1 y 3.");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const clean = (value) => String(value ?? "").trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class KlingApiError extends Error {
  constructor(message, definitive = true) {
    super(message);
    this.definitive = definitive;
  }
}

async function rpc(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message);
  return data;
}

async function reportHealth(status = "Activa", error = "", synced = false) {
  return rpc("reportar_worker_kling_v2", {
    p_worker_id: WORKER_ID,
    p_version: VERSION,
    p_status: status,
    p_error: redactConnectorError(error),
    p_synced: synced,
    p_environment: CONNECTOR_RUNTIME.environment,
    p_project_ref: CONNECTOR_RUNTIME.projectRef,
  });
}

async function apiRequest(path, { method = "GET", body } = {}, timeoutMs = 60_000) {
  if (!/^\/[a-z0-9?=&_.\/-]+$/i.test(path) || path.includes("..")) throw new KlingApiError("Ruta Kling inválida.");
  const url = new URL(path, `${API_BASE_URL}/`);
  if (url.origin !== "https://api-singapore.klingai.com") throw new KlingApiError("Destino Kling no permitido.");
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch (error) {
    throw new KlingApiError(`No se pudo confirmar la respuesta de Kling: ${redactConnectorError(error)}`, false);
  }
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { throw new KlingApiError(`Kling respondió HTTP ${response.status} sin JSON válido.`); }
  if (!response.ok || Number(payload.code) !== 0) {
    throw new KlingApiError(`Kling rechazó la solicitud (${payload.code ?? response.status}): ${clean(payload.message || "sin detalle")}`);
  }
  return payload;
}

async function verifyKlingKey() {
  await apiRequest("/tasks", { method: "POST", body: { limit: 1, filters: [{ key: "product_type", values: ["video"] }] } }, 30_000);
  return reportHealth("Activa", "", true);
}

async function signedSources(claim) {
  const media = [];
  for (const source of claim.job.assets || []) {
    if (!clean(source.mime_type).startsWith("image/")) continue;
    const { data, error } = await supabase.storage.from("brand-assets").createSignedUrl(source.storage_path, 3600);
    if (error || !data?.signedUrl) throw new Error(`No se pudo conceder la fuente ${source.id} a Kling: ${error?.message || "sin URL"}`);
    media.push({ ...source, signedUrl: data.signedUrl, mimeType: source.mime_type });
  }
  return media;
}

function requestOptions(claim, media) {
  const externalTaskId = `momos-job-${claim.job.id}-run-${claim.run_id}`;
  const request = buildKlingRequest(claim.job, media, {
    externalTaskId,
    model: process.env.KLING_MODEL || "kling-3.0",
    resolution: process.env.KLING_RESOLUTION || "720p",
    audio: process.env.KLING_AUDIO || "off",
    duration: Number(process.env.KLING_DURATION_SECONDS || 5),
  });
  const baseCostCop = klingUnitsToCop(request.estimatedUnits, COP_PER_UNIT, 1);
  const protectedCostCop = klingUnitsToCop(request.estimatedUnits, COP_PER_UNIT, SAFETY_FACTOR);
  return { externalTaskId, request, baseCostCop, protectedCostCop };
}

async function dispatchOne() {
  const claim = await rpc("reclamar_trabajo_kling", { p_worker_id: WORKER_ID, p_lease_seconds: 600 });
  if (!claim?.job) return false;
  let requestMayHaveBeenAccepted = false;
  try {
    const media = await signedSources(claim);
    const { externalTaskId, request, baseCostCop, protectedCostCop } = requestOptions(claim, media);
    if (protectedCostCop > Number(claim.job.max_cost_cop)) {
      throw new KlingApiError(`El perfil Kling requiere reservar ${protectedCostCop} COP y el tope autorizado es ${claim.job.max_cost_cop} COP.`);
    }
    await rpc("marcar_despacho_kling", {
      p_run_id: claim.run_id,
      p_lease_token: claim.lease_token,
      p_external_task_id: externalTaskId,
      p_estimated_cost_cop: protectedCostCop,
      p_metadata: {
        model: request.model,
        kind: request.kind,
        resolution: request.settings.resolution,
        duration_seconds: request.settings.duration,
        audio: request.settings.audio,
        aspect_ratio: request.aspectRatio,
        estimated_units: request.estimatedUnits,
        base_cost_cop: baseCostCop,
        protected_cost_cop: protectedCostCop,
        external_task_id: externalTaskId,
      },
    });
    requestMayHaveBeenAccepted = true;
    const created = await apiRequest(request.endpoint, { method: "POST", body: request.body }, 120_000);
    requestMayHaveBeenAccepted = false;
    const task = extractKlingTask(created);
    await rpc("confirmar_despacho_kling", {
      p_run_id: claim.run_id,
      p_lease_token: claim.lease_token,
      p_provider_job_id: task.id,
      p_estimated_cost_cop: protectedCostCop,
      p_metadata: {
        model: request.model,
        kind: request.kind,
        resolution: request.settings.resolution,
        duration_seconds: request.settings.duration,
        audio: request.settings.audio,
        aspect_ratio: request.aspectRatio,
        estimated_units: request.estimatedUnits,
        base_cost_cop: baseCostCop,
        protected_cost_cop: protectedCostCop,
        external_task_id: externalTaskId,
      },
    });
    return true;
  } catch (error) {
    const uncertain = requestMayHaveBeenAccepted && error?.definitive !== true;
    await rpc("fallar_trabajo_kling", {
      p_run_id: claim.run_id,
      p_lease_token: claim.lease_token,
      p_error: redactConnectorError(error),
      p_uncertain: uncertain,
    }).catch(() => {});
    throw error;
  }
}

async function queryTask({ taskId, externalTaskId }) {
  const params = taskId ? `task_ids=${encodeURIComponent(taskId)}` : `external_task_ids=${encodeURIComponent(externalTaskId)}`;
  return apiRequest(`/tasks?${params}`, {}, 60_000);
}

async function safeDownload(url, timeoutMs = 120_000) {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!klingOutputHostAllowed(current, OUTPUT_HOST_SUFFIXES)) throw new Error("Kling devolvió un host de descarga no permitido.");
    const response = await fetch(current, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("La descarga Kling redirigió sin destino.");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`La descarga Kling respondió HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_OUTPUT_BYTES) throw new Error("La salida Kling excede el tamaño permitido.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES) throw new Error("La salida Kling tiene un tamaño no permitido.");
    return { bytes, contentType: clean(response.headers.get("content-type")).split(";")[0] };
  }
  throw new Error("La descarga Kling excedió el número de redirecciones permitido.");
}

async function uploadCompletedRun(run, payload) {
  const outputUrl = extractKlingOutputUrl(payload);
  const { bytes, contentType } = await safeDownload(outputUrl);
  const mimeType = contentType === "video/mp4" || contentType === "application/octet-stream" || !contentType ? "video/mp4" : contentType;
  if (!/^video\/(mp4|quicktime|webm)$/.test(mimeType)) throw new Error(`Formato Kling no permitido: ${mimeType}.`);
  const extension = mimeType === "video/webm" ? ".webm" : mimeType === "video/quicktime" ? ".mov" : ".mp4";
  const hash = createHash("sha256").update(bytes).digest("hex");
  const storagePath = `generated/kling/${run.job_id}/${hash}${extension}`;
  const upload = await supabase.storage.from("brand-assets").upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (upload.error && !/already exists|duplicate/i.test(upload.error.message || "")) throw new Error(`No se pudo proteger la salida Kling: ${upload.error.message}`);
  let billing = { cash: 0, units: 0 };
  try { billing = extractKlingBilling(payload); } catch { /* usar la reserva local */ }
  const hasBilling = billing.cash > 0 || billing.units > 0;
  const costCop = hasBilling
    ? klingBillingToCop(billing, { copPerUsd: COP_PER_USD, copPerUnit: COP_PER_UNIT })
    : Number(run.metadata?.base_cost_cop || run.estimated_cost_cop || 0);
  await rpc("registrar_salida_kling", {
    p_run_id: run.id,
    p_lease_token: run.lease_token,
    p: {
      storage_path: storagePath,
      content_hash: hash,
      mime_type: mimeType,
      size_bytes: bytes.length,
      cost_cop: costCop,
      model: run.metadata?.model || "kling-3.0",
      billing,
      name: `Kling 3.0 · trabajo ${run.job_id}`,
    },
  });
}

async function reconcileUncertainRuns() {
  const { data: runs, error } = await supabase.from("creative_connector_runs")
    .select("id,job_id,lease_token,provider_job_id,metadata,estimated_cost_cop")
    .eq("provider", "Kling").eq("state", "Incierto").order("started_at").limit(10);
  if (error) throw new Error(error.message);
  for (const run of runs || []) {
    const externalTaskId = clean(run.metadata?.external_task_id);
    if (!externalTaskId) continue;
    try {
      const payload = await queryTask({ externalTaskId });
      const task = findKlingTask(payload);
      if (!task) continue;
      const status = normalizeKlingStatus(payload);
      if (status === "Fallido") {
        await rpc("fallar_trabajo_kling", { p_run_id: run.id, p_lease_token: run.lease_token, p_error: klingFailureMessage(payload), p_uncertain: false });
        continue;
      }
      const identity = extractKlingTask(payload);
      await rpc("conciliar_despacho_kling", {
        p_run_id: run.id,
        p_lease_token: run.lease_token,
        p_provider_job_id: identity.id,
      });
      if (status === "Completado") await uploadCompletedRun(run, payload);
    } catch (error) {
      await reportHealth("Con error", redactConnectorError(error), false).catch(() => {});
    }
  }
}

async function pollRuns() {
  const { data: runs, error } = await supabase.from("creative_connector_runs")
    .select("id,job_id,lease_token,provider_job_id,metadata,estimated_cost_cop")
    .eq("provider", "Kling").eq("state", "En proveedor").order("started_at").limit(10);
  if (error) throw new Error(error.message);
  for (const run of runs || []) {
    try {
      const payload = await queryTask({ taskId: run.provider_job_id });
      const status = normalizeKlingStatus(payload);
      if (status === "Completado") await uploadCompletedRun(run, payload);
      else if (status === "Fallido") await rpc("fallar_trabajo_kling", {
        p_run_id: run.id,
        p_lease_token: run.lease_token,
        p_error: klingFailureMessage(payload),
        p_uncertain: false,
      });
    } catch (error) {
      await reportHealth("Con error", redactConnectorError(error), false).catch(() => {});
    }
  }
}

async function cycle() {
  const health = await verifyKlingKey();
  if (HEALTH_ONLY) {
    process.stdout.write(`[Kling] Salud OK · API Singapore · integración ${health?.status || "Activa"}\n`);
    return;
  }
  if (health?.status === "Pausada") return;
  await reconcileUncertainRuns();
  await pollRuns();
  await dispatchOne();
}

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

do {
  try { await cycle(); }
  catch (error) {
    const safe = redactConnectorError(error);
    await reportHealth("Con error", safe, false).catch(() => {});
    process.stderr.write(`[Kling] ${safe}\n`);
    if (ONCE) process.exitCode = 1;
  }
  if (!ONCE && !stopping) await sleep(POLL_MS);
} while (!ONCE && !stopping);
