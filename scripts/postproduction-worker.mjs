import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm, stat } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { createClient } from "@supabase/supabase-js";
import {
  POSTPRODUCTION_LIMITS,
  assertMasterMatchesSpec,
  inspectProbe,
  normalizationArgs,
  outputStoragePath,
  parseLoudnorm,
  redactPostproductionError,
  sha256,
  subtitleCuesToSrt,
  validatePostproductionClaim,
} from "../src/lib/postproduction-worker.js";

const VERSION = "momos-postproduction-worker/1.0.0";
const ONCE = process.argv.includes("--once");
const HEALTH_ONLY = process.argv.includes("--health-only");
const POLL_MS = Math.max(10_000, Number(process.env.POSTPRODUCTION_POLL_MS || 30_000));
const WORKER_ID = process.env.POSTPRODUCTION_WORKER_ID || `${hostname()}-${process.pid}`;
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const FFMPEG = resolve(String(ffmpegPath || ""));
const FFPROBE = resolve(String(ffprobeStatic?.path || ""));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function isSupabaseServerKey(value) {
  if (value.startsWith("sb_secret_")) return true;
  if (value.startsWith("sb_publishable_")) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role"; }
  catch { return false; }
}

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno privado del worker.");
let endpoint;
try { endpoint = new URL(SUPABASE_URL); } catch { throw new Error("SUPABASE_URL debe ser una URL HTTP(S) completa."); }
if (!/^https?:$/.test(endpoint.protocol)) throw new Error("SUPABASE_URL debe comenzar por https://, salvo desarrollo local.");
if (!isSupabaseServerKey(SERVICE_KEY)) throw new Error("SUPABASE_SERVICE_ROLE_KEY debe ser sb_secret_ o service_role; nunca publishable/anon.");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

async function rpc(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message);
  return data;
}

async function run(binary, args, { timeoutMs = POSTPRODUCTION_LIMITS.processTimeoutMs } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let size = 0;
    const maxLogBytes = 5 * 1024 * 1024;
    const collect = (target) => (chunk) => {
      size += chunk.length;
      if (size <= maxLogBytes) target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); fail(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const result = { code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      if (code === 0) done(result);
      else fail(new Error(`Proceso multimedia terminó con código ${code ?? signal}: ${result.stderr.slice(-1200)}`));
    });
  });
}

async function reportHealth(status, available, ffmpegVersion = "", error = "") {
  return rpc("reportar_worker_postproduccion", {
    p_worker_id: WORKER_ID,
    p_version: VERSION,
    p_status: status,
    p_ffmpeg_available: available,
    p_ffmpeg_version: ffmpegVersion,
    p_error: error ? redactPostproductionError(error) : "",
  });
}

async function healthCheck() {
  try {
    const [ffmpeg, ffprobe, encoders] = await Promise.all([run(FFMPEG, ["-version"], { timeoutMs: 15_000 }), run(FFPROBE, ["-version"], { timeoutMs: 15_000 }), run(FFMPEG, ["-hide_banner", "-encoders"], { timeoutMs: 15_000 })]);
    if (!/\blibx264\b/.test(encoders.stdout) || !/\baac\b/.test(encoders.stdout)) throw new Error("El paquete FFmpeg no contiene los encoders H.264/AAC requeridos.");
    const version = `${ffmpeg.stdout.split(/\r?\n/)[0]} · ${ffprobe.stdout.split(/\r?\n/)[0]}`.slice(0, 240);
    await reportHealth("Disponible", true, version, "");
    console.log(`[Postproducción] Salud OK · FFmpeg/ffprobe versionados · ${WORKER_ID}`);
    return true;
  } catch (error) {
    await reportHealth("Bloqueado", false, "", error).catch(() => {});
    throw error;
  }
}

async function probeFile(path) {
  const result = await run(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { timeoutMs: 60_000 });
  try { return JSON.parse(result.stdout); }
  catch { throw new Error("ffprobe no devolvió JSON válido."); }
}

async function measureLoudness(path) {
  const result = await run(FFMPEG, ["-hide_banner", "-nostdin", "-i", path, "-map", "0:a:0", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { timeoutMs: 180_000 });
  return parseLoudnorm(result.stderr);
}

async function downloadSource(source, path) {
  const { data, error } = await supabase.storage.from("brand-assets").createSignedUrl(source.storage_path, 900);
  if (error || !data?.signedUrl) throw new Error(`No se pudo conceder la toma ${source.asset_id}: ${error?.message || "sin URL"}`);
  const response = await fetch(data.signedUrl, { signal: AbortSignal.timeout(120_000), redirect: "error" });
  if (!response.ok) throw new Error(`La toma ${source.asset_id} respondió HTTP ${response.status}.`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > POSTPRODUCTION_LIMITS.maxSourceBytes) throw new Error(`La toma ${source.asset_id} excede el límite.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > POSTPRODUCTION_LIMITS.maxSourceBytes) throw new Error(`La toma ${source.asset_id} tiene tamaño inválido.`);
  if (sha256(bytes) !== String(source.content_hash).toLowerCase()) throw new Error(`La toma ${source.asset_id} no coincide con su huella sellada.`);
  await writeFile(path, bytes);
}

async function normalizeSources(claim, directory) {
  const spec = claim.export.snapshot.export_spec;
  const normalized = [];
  let audioSources = 0;
  for (const [index, source] of claim.export.snapshot.sources.entries()) {
    const input = join(directory, `source-${String(index).padStart(3, "0")}.bin`);
    const output = join(directory, `clip-${String(index).padStart(3, "0")}.mp4`);
    await downloadSource(source, input);
    const inputProbe = await probeFile(input);
    const video = inputProbe.streams?.find((stream) => stream.codec_type === "video");
    const hasAudio = Boolean(inputProbe.streams?.find((stream) => stream.codec_type === "audio"));
    if (hasAudio) audioSources += 1;
    const duration = Number(inputProbe.format?.duration || video?.duration || source.duration_seconds || 0);
    if (!video || !(duration > 0 && duration <= POSTPRODUCTION_LIMITS.maxDurationSeconds)) throw new Error(`La toma ${source.asset_id} no tiene video o duración permitida.`);
    await run(FFMPEG, normalizationArgs({ inputPath: input, outputPath: output, spec, hasAudio, durationSeconds: duration }));
    normalized.push(output);
  }
  if (audioSources === 0) throw new Error("Las tomas no contienen audio original y el contrato no incluye una pista licenciada sellada.");
  return normalized;
}

async function concatClips(paths, directory) {
  const listPath = join(directory, "concat.txt");
  await writeFile(listPath, paths.map((path) => `file '${path.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  const output = join(directory, "master-concat.mp4");
  await run(FFMPEG, ["-hide_banner", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", output]);
  return output;
}

async function finalizeMaster(input, claim, directory) {
  const output = join(directory, "master-final.mp4");
  const args = ["-hide_banner", "-nostdin", "-y", "-i", input];
  if (claim.export.snapshot.export_spec.burn_subtitles === true) {
    const srtPath = join(directory, "subtitles.srt");
    await writeFile(srtPath, subtitleCuesToSrt(claim.export.snapshot.subtitle_plan.cues), "utf8");
    const filterPath = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
    args.push("-vf", `subtitles='${filterPath}'`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv");
  } else args.push("-c:v", "copy");
  args.push("-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", output);
  await run(FFMPEG, args);
  return output;
}

async function registerMaster(claim, filePath) {
  const info = await stat(filePath);
  const spec = claim.export.snapshot.export_spec;
  if (!(info.size > 0 && info.size <= Number(spec.max_size_bytes))) throw new Error("El máster excede el peso autorizado.");
  const [probeRaw, loudness] = await Promise.all([probeFile(filePath), measureLoudness(filePath)]);
  const technicalProbe = inspectProbe(probeRaw, { loudnessLufs: loudness, sizeBytes: info.size });
  assertMasterMatchesSpec(technicalProbe, spec);
  const bytes = await readFile(filePath);
  const hash = sha256(bytes);
  const storagePath = outputStoragePath(claim.export.id, hash);
  const upload = await supabase.storage.from("brand-assets").upload(storagePath, bytes, { contentType: "video/mp4", upsert: false, cacheControl: "31536000" });
  if (upload.error && !/already exists|duplicate/i.test(upload.error.message || "")) throw new Error(`No se pudo proteger el máster: ${upload.error.message}`);
  try {
    return await rpc("registrar_master_postproduccion", {
      p_export_id: claim.export.id,
      p_lease_token: claim.lease_token,
      p: { name: `Máster MOMOS · exportación ${claim.export.id}`, storage_path: storagePath, content_hash: hash, mime_type: "video/mp4", size_bytes: info.size, technical_probe: technicalProbe },
    });
  } catch (error) {
    const { data } = await supabase.from("agency_postproduction_exports").select("status,output_asset_id").eq("id", claim.export.id).maybeSingle();
    if (["Exportada", "Aprobada"].includes(data?.status) && data?.output_asset_id) return { ok: true, export_id: claim.export.id, asset_id: data.output_asset_id, status: data.status, reconciled: true };
    error.outputMayExist = true;
    throw error;
  }
}

async function processOne() {
  const claim = await rpc("reclamar_exportacion_postproduccion", { p_worker_id: WORKER_ID, p_lease_seconds: 1800 });
  if (!claim?.export) return false;
  const check = validatePostproductionClaim(claim);
  if (!check.valid) {
    await rpc("fallar_exportacion_postproduccion", { p_export_id: claim.export.id, p_lease_token: claim.lease_token, p_error: check.reasons.join(" "), p_uncertain: false });
    return true;
  }
  const directory = await mkdtemp(join(tmpdir(), "momos-postproduction-"));
  try {
    const clips = await normalizeSources(claim, directory);
    const concatenated = await concatClips(clips, directory);
    const finalPath = await finalizeMaster(concatenated, claim, directory);
    const result = await registerMaster(claim, finalPath);
    console.log(`[Postproducción] Exportación ${claim.export.id} lista · activo ${result.asset_id} · QC humano pendiente`);
    return true;
  } catch (error) {
    await rpc("fallar_exportacion_postproduccion", { p_export_id: claim.export.id, p_lease_token: claim.lease_token, p_error: redactPostproductionError(error), p_uncertain: error.outputMayExist === true }).catch(() => {});
    throw error;
  } finally {
    const safeRoot = resolve(tmpdir());
    const safeTarget = resolve(directory);
    const childPath = relative(safeRoot, safeTarget);
    if (childPath && !childPath.startsWith("..") && !isAbsolute(childPath) && safeTarget.includes("momos-postproduction-")) await rm(safeTarget, { recursive: true, force: true });
  }
}

await healthCheck();
if (!HEALTH_ONLY) {
  do {
    try {
      const worked = await processOne();
      await reportHealth("Disponible", true, "FFmpeg/ffprobe versionados", "");
      if (ONCE) break;
      if (!worked) await sleep(POLL_MS);
    } catch (error) {
      console.error(`[Postproducción] ${redactPostproductionError(error)}`);
      await reportHealth("Con error", true, "FFmpeg/ffprobe versionados", error).catch(() => {});
      if (ONCE) process.exitCode = 1;
      else await sleep(POLL_MS);
    }
  } while (!ONCE);
}
