import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildHiggsfieldCreateArgs,
  extractHiggsfieldCredits,
  extractHiggsfieldJobId,
  extractHiggsfieldOutputUrl,
  higgsfieldCreditsToCop,
  normalizeHiggsfieldStatus,
  redactConnectorError,
} from "../src/lib/higgsfield-connector.js";

const VERSION = "momos-higgsfield-worker/1.1.0";
const ONCE = process.argv.includes("--once");
const HEALTH_ONLY = process.argv.includes("--health-only");
const POLL_MS = Math.max(10_000, Number(process.env.HIGGSFIELD_POLL_MS || 30_000));
const WORKER_ID = process.env.HIGGSFIELD_WORKER_ID || `${hostname()}-${process.pid}`;
const CUSTOM_HIGGSFIELD_BIN = String(process.env.HIGGSFIELD_BIN || "").trim();
const HIGGSFIELD_CLI_ENTRY = String(process.env.HIGGSFIELD_CLI_ENTRY || (
  process.platform === "win32" && process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm", "node_modules", "@higgsfield", "cli", "bin", "higgsfield.js")
    : ""
)).trim();
const HIGGSFIELD_BIN = CUSTOM_HIGGSFIELD_BIN || (process.platform === "win32" ? process.execPath : "higgsfield");
const HIGGSFIELD_ARGS_PREFIX = !CUSTOM_HIGGSFIELD_BIN && process.platform === "win32" ? [HIGGSFIELD_CLI_ENTRY] : [];
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COP_PER_CREDIT = Number(process.env.HIGGSFIELD_COP_PER_CREDIT);
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno privado del worker.");
if (process.platform === "win32" && !CUSTOM_HIGGSFIELD_BIN && !HIGGSFIELD_CLI_ENTRY) {
  throw new Error("No se pudo resolver el entrypoint del CLI Higgsfield. Define HIGGSFIELD_CLI_ENTRY en el runtime privado.");
}
if (!HEALTH_ONLY && (!Number.isFinite(COP_PER_CREDIT) || COP_PER_CREDIT <= 0)) {
  throw new Error("Falta HIGGSFIELD_COP_PER_CREDIT para proteger el tope en COP.");
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => String(value ?? "").trim();

function parseCliJson(stdout) {
  const text = clean(stdout);
  const candidates = [text, ...text.split(/\r?\n/).reverse()];
  for (const candidate of candidates) {
    const start = Math.min(...[candidate.indexOf("{"), candidate.indexOf("[")].filter((index) => index >= 0));
    if (!Number.isFinite(start)) continue;
    try { return JSON.parse(candidate.slice(start)); } catch { /* probar siguiente línea */ }
  }
  throw new Error("Higgsfield no devolvió JSON interpretable.");
}

function runCli(args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(HIGGSFIELD_BIN, [...HIGGSFIELD_ARGS_PREFIX, ...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = ""; let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) reject(new Error("Higgsfield excedió el tiempo máximo de respuesta."));
      settled = true;
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-2_000_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-20_000); });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) reject(error);
      settled = true;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) reject(new Error(stderr || stdout || `Higgsfield terminó con código ${code}.`));
      else resolve(parseCliJson(stdout));
    });
  });
}

async function rpc(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message);
  return data;
}

async function reportHealth(status = "Activa", error = "", synced = false) {
  return rpc("reportar_worker_higgsfield", {
    p_worker_id: WORKER_ID, p_version: VERSION, p_status: status,
    p_error: redactConnectorError(error), p_synced: synced,
  });
}

async function verifyHiggsfieldSession() {
  await runCli(["model", "list", "--json", "--no-color"], 60_000);
  return reportHealth("Activa", "", true);
}

async function downloadSources(claim, directory) {
  const sources = claim.job.assets || [];
  const media = [];
  for (const [index, source] of sources.entries()) {
    const { data, error } = await supabase.storage.from("brand-assets").createSignedUrl(source.storage_path, 300);
    if (error || !data?.signedUrl) throw new Error(`No se pudo abrir la fuente ${source.id}: ${error?.message || "sin URL"}`);
    const response = await fetch(data.signedUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`La fuente ${source.id} respondió HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES) throw new Error(`La fuente ${source.id} tiene un tamaño no permitido.`);
    const extension = path.extname(source.storage_path).replace(/[^.a-z0-9]/gi, "").slice(0, 10) || ".bin";
    const localPath = path.join(directory, `source-${index + 1}${extension}`);
    await writeFile(localPath, bytes, { flag: "wx" });
    media.push({ ...source, localPath, mimeType: source.mime_type });
  }
  return media;
}

function costArgs(createArgs) {
  const args = [...createArgs];
  if (args[0] !== "generate" || args[1] !== "create") throw new Error("No se pudo derivar la estimación Higgsfield.");
  args[1] = "cost";
  return args;
}

async function dispatchOne() {
  const claim = await rpc("reclamar_trabajo_higgsfield", { p_worker_id: WORKER_ID, p_lease_seconds: 600 });
  if (!claim?.job) return false;
  const directory = path.join(tmpdir(), `momos-higgsfield-${claim.job.id}-${randomUUID()}`);
  await mkdir(directory, { recursive: false });
  let providerRequestStarted = false;
  try {
    const media = await downloadSources(claim, directory);
    const command = buildHiggsfieldCreateArgs(claim.job, media, {
      imageModel: process.env.HIGGSFIELD_IMAGE_MODEL,
      videoModel: process.env.HIGGSFIELD_VIDEO_MODEL,
      imageResolution: process.env.HIGGSFIELD_IMAGE_RESOLUTION,
      videoResolution: process.env.HIGGSFIELD_VIDEO_RESOLUTION,
    });
    const estimate = await runCli(costArgs(command.args), 90_000);
    const credits = extractHiggsfieldCredits(estimate);
    const estimatedCop = higgsfieldCreditsToCop(credits, COP_PER_CREDIT);
    if (estimatedCop > Number(claim.job.max_cost_cop)) {
      throw new Error(`Costo estimado ${estimatedCop} COP superior al tope autorizado ${claim.job.max_cost_cop} COP.`);
    }
    // Persistimos la intención antes del request externo. Una caída dura desde
    // aquí deja el run bloqueado para conciliación y nunca duplica el despacho.
    await rpc("marcar_despacho_higgsfield", {
      p_run_id: claim.run_id, p_lease_token: claim.lease_token,
    });
    providerRequestStarted = true;
    const created = await runCli(command.args, 120_000);
    const providerJobId = extractHiggsfieldJobId(created);
    await rpc("confirmar_despacho_higgsfield", {
      p_run_id: claim.run_id, p_lease_token: claim.lease_token,
      p_provider_job_id: providerJobId, p_estimated_cost_cop: estimatedCop,
      p_metadata: { model: command.model, kind: command.kind, aspect_ratio: command.aspectRatio, estimated_credits: credits },
    });
    return true;
  } catch (error) {
    await rpc("fallar_trabajo_higgsfield", {
      p_run_id: claim.run_id, p_lease_token: claim.lease_token,
      p_error: redactConnectorError(error), p_uncertain: providerRequestStarted,
    }).catch(() => {});
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function responseError(payload) {
  const raw = payload?.error_message || payload?.error || payload?.message || payload?.data?.error;
  return redactConnectorError(typeof raw === "string" ? raw : "Higgsfield marcó el trabajo como fallido.");
}

async function uploadCompletedRun(run, payload) {
  const outputUrl = extractHiggsfieldOutputUrl(payload);
  const response = await fetch(outputUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`La descarga Higgsfield respondió HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES) throw new Error("La salida Higgsfield tiene un tamaño no permitido.");
  const mimeType = clean(response.headers.get("content-type")).split(";")[0]
    || (outputUrl.match(/\.mp4(?:\?|$)/i) ? "video/mp4" : "image/png");
  if (!/^image\/(jpeg|png|webp|gif)$|^video\/(mp4|quicktime|webm)$/.test(mimeType)) throw new Error(`Formato de salida no permitido: ${mimeType}.`);
  const extension = mimeType.startsWith("video/") ? ".mp4" : mimeType === "image/jpeg" ? ".jpg" : ".png";
  const hash = createHash("sha256").update(bytes).digest("hex");
  const storagePath = `generated/higgsfield/${run.job_id}/${hash}${extension}`;
  const upload = await supabase.storage.from("brand-assets").upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (upload.error && !/already exists|duplicate/i.test(upload.error.message || "")) throw new Error(`No se pudo proteger la salida: ${upload.error.message}`);
  let credits;
  try { credits = extractHiggsfieldCredits(payload); } catch { credits = Number(run.metadata?.estimated_credits); }
  const costCop = higgsfieldCreditsToCop(credits, COP_PER_CREDIT);
  await rpc("registrar_salida_higgsfield", {
    p_run_id: run.id, p_lease_token: run.lease_token,
    p: { storage_path: storagePath, content_hash: hash, mime_type: mimeType, size_bytes: bytes.length,
      cost_cop: costCop, model: run.metadata?.model, name: `Higgsfield · trabajo ${run.job_id}` },
  });
}

async function pollRuns() {
  const { data: runs, error } = await supabase.from("creative_connector_runs")
    .select("id,job_id,lease_token,provider_job_id,metadata,estimated_cost_cop")
    .eq("provider", "Higgsfield").eq("state", "En proveedor").order("started_at").limit(10);
  if (error) throw new Error(error.message);
  for (const run of runs || []) {
    try {
      const payload = await runCli(["generate", "get", run.provider_job_id, "--json", "--no-color"], 60_000);
      const status = normalizeHiggsfieldStatus(payload);
      if (status === "Completado") await uploadCompletedRun(run, payload);
      else if (status === "Fallido") await rpc("fallar_trabajo_higgsfield", {
        p_run_id: run.id, p_lease_token: run.lease_token, p_error: responseError(payload), p_uncertain: false,
      });
    } catch (error) {
      // Un fallo de red al consultar no cambia el job: el siguiente ciclo concilia.
      await reportHealth("Con error", redactConnectorError(error), false).catch(() => {});
    }
  }
}

async function cycle() {
  const health = await verifyHiggsfieldSession();
  if (HEALTH_ONLY) {
    process.stdout.write(`[Higgsfield] Salud OK · CLI oficial · integración ${health?.status || "Activa"}\n`);
    return;
  }
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
    process.stderr.write(`[Higgsfield] ${safe}\n`);
    if (ONCE) process.exitCode = 1;
  }
  if (!ONCE && !stopping) await sleep(POLL_MS);
} while (!ONCE && !stopping);
