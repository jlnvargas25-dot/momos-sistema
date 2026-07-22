import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import ffprobeStatic from "ffprobe-static";
import { z } from "zod";
import { normalizeCreativeIntelligence } from "../src/lib/creative-intelligence.js";
import {
  MOMOS_AGENCY_MCP_VERSION,
  buildAgencyMcpRun,
  buildMcpHumanApprovalRequest,
  creativeContextRpc,
  normalizeAgencyMcpSnapshot,
  normalizeBrandAssetClaim,
  normalizeBrandAssetSearch,
  normalizeMcpHumanApprovalStatus,
  sanitizeBrandAssetClaimForReference,
} from "../src/lib/momos-agency-mcp.js";

const VERSION = `momos-agency-mcp/${MOMOS_AGENCY_MCP_VERSION}`;
const SELF_TEST = process.argv.includes("--self-test");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const WORKER_ID = String(process.env.MOMOS_MCP_WORKER_ID || `${hostname()}-${process.pid}`).trim();
const PROPOSALS_ENABLED = String(process.env.MOMOS_MCP_PROPOSALS_ENABLED || "false").toLowerCase() === "true";
const BRAND_ASSET_REFERENCE_TTL_SECONDS = 5 * 60;
const BRAND_ASSET_DELIVERY_MIN_MS = 10_000;
const BRAND_ASSET_MCP_MAX_BYTES = 25 * 1024 * 1024;
const BRAND_ASSET_TYPES = ["Foto", "Video", "Audio", "Logo", "Diseño"];
const BRAND_ASSET_ORIENTATIONS = ["Vertical", "Horizontal", "Cuadrado", "Audio", "Documento"];
const BRAND_ASSET_CHANNELS = ["Instagram", "Facebook", "TikTok", "YouTube", "WhatsApp", "Web", "Email", "Punto de venta"];
const BRAND_ASSET_PURPOSES = ["Generación", "Edición", "Storyboard", "Referencia", "Revisión"];
const BRAND_REFERENCE_ROOT = join(tmpdir(), "momos-agency-brand-references");
const BRAND_REFERENCE_PROCESS = `${createHash("sha256").update(WORKER_ID).digest("hex").slice(0, 12)}-${process.pid}`;
const BRAND_REFERENCE_DIR = join(BRAND_REFERENCE_ROOT, BRAND_REFERENCE_PROCESS);
const BRAND_REFERENCE_URI_PREFIX = "momos-brand-asset://reference/";
const FFPROBE = ffprobeStatic?.path ? resolve(String(ffprobeStatic.path)) : "";
const brandReferenceExpiries = new Map();
const brandReferenceRegistry = new Map();
let brandReferenceMaterializationTail = Promise.resolve();
const MIME_EXTENSION = Object.freeze({
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
  "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
  "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/wav": ".wav", "application/pdf": ".pdf",
});

function isSupabaseServerKey(value) {
  const key = String(value || "").trim();
  if (key.startsWith("sb_secret_")) return true;
  if (key.startsWith("sb_publishable_")) return false;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role"; }
  catch { return false; }
}

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno privado del MCP.");
let supabaseEndpoint;
try { supabaseEndpoint = new URL(SUPABASE_URL); }
catch { throw new Error("SUPABASE_URL debe ser la URL completa del proyecto MOMOS OPS."); }
if (!/^https?:$/.test(supabaseEndpoint.protocol)) throw new Error("SUPABASE_URL debe usar HTTP o HTTPS.");
if (!isSupabaseServerKey(SERVICE_KEY)) throw new Error("SUPABASE_SERVICE_ROLE_KEY no es una clave privada válida.");
if (!/^[A-Za-z0-9._:-]{2,120}$/.test(WORKER_ID)) throw new Error("MOMOS_MCP_WORKER_ID es inválido.");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const hash = (value) => createHash("md5").update(JSON.stringify(value ?? null)).digest("hex");
const redact = (value) => String(value || "Error MCP")
  .replaceAll(BRAND_REFERENCE_DIR, "[ruta local redactada]")
  .replaceAll(BRAND_REFERENCE_ROOT, "[ruta local redactada]")
  .replace(/(sb_secret_|eyJ)[A-Za-z0-9._-]+/g, "[credencial redactada]")
  .replace(/(access[_-]?token|api[_-]?key|app[_-]?secret|service[_-]?role)\s*[:=]\s*\S+/gi, "$1=[redactado]")
  .slice(0, 600);
const requestKey = (tool) => `${tool}:${Date.now()}:${randomUUID().replaceAll("-", "").slice(0, 16)}`;

function detectedMime(bytes) {
  const ascii = (start, length) => bytes.subarray(start, start + length).toString("ascii");
  const hex = (start, length) => bytes.subarray(start, start + length).toString("hex");
  if (hex(0, 4) === "89504e47") return "image/png";
  if (hex(0, 3) === "ffd8ff") return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (hex(0, 4) === "1a45dfa3") return "video/webm";
  if (ascii(0, 4) === "%PDF") return "application/pdf";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(4, 4) === "ftyp") {
    const brands = `${ascii(8, 4)} ${ascii(16, Math.min(32, Math.max(0, bytes.length - 16)))}`;
    if (/M4[ABP] /i.test(brands)) return "audio/mp4";
    if (/qt  /i.test(brands)) return "video/quicktime";
    return "video/mp4";
  }
  return "";
}

function mimeMatches(bytes, expected) {
  const detected = detectedMime(bytes);
  if (["audio/mp4", "video/mp4"].includes(expected) && ["audio/mp4", "video/mp4"].includes(detected)) return true;
  return detected === expected;
}

function assertBrandReferencePath(value) {
  const safePath = resolve(String(value || ""));
  const pathFromRoot = relative(resolve(BRAND_REFERENCE_DIR), safePath);
  if (!pathFromRoot || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("La copia temporal quedó fuera del runtime privado.");
  }
  return safePath;
}

async function serializeBrandReferenceMaterialization(callback) {
  const previous = brandReferenceMaterializationTail;
  let release;
  brandReferenceMaterializationTail = new Promise((done) => { release = done; });
  await previous;
  try { return await callback(); }
  finally { release(); }
}

function referenceIdFromUri(value) {
  const uri = String(value || "");
  const match = uri.match(/^momos-brand-asset:\/\/reference\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  if (!match) throw new Error("La referencia opaca de Biblioteca es inválida.");
  return match[1].toLowerCase();
}

function removeBrandReferenceRecord(referenceId) {
  const record = brandReferenceRegistry.get(referenceId);
  brandReferenceRegistry.delete(referenceId);
  if (record?.file) brandReferenceExpiries.delete(resolve(record.file));
  return record;
}

function removeBrandReferenceRecordsForFile(file) {
  const resolvedFile = resolve(file);
  for (const [referenceId, record] of brandReferenceRegistry) {
    if (resolve(record.file) === resolvedFile) brandReferenceRegistry.delete(referenceId);
  }
  brandReferenceExpiries.delete(resolvedFile);
}

async function verifyMediaStreams(file, asset) {
  if (!['Video', 'Audio'].includes(asset.media_type)) return;
  if (!FFPROBE) throw new Error("El runtime no tiene ffprobe para validar el archivo multimedia.");
  const result = await new Promise((done, fail) => {
    const child = spawn(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", file], {
      shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes <= 128 * 1024) stdout.push(chunk);
    });
    child.once("error", () => { clearTimeout(timer); fail(new Error("ffprobe no pudo inspeccionar la referencia.")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) done(Buffer.concat(stdout).toString("utf8"));
      else fail(new Error("ffprobe rechazó la referencia multimedia."));
    });
  });
  let probe;
  try { probe = JSON.parse(result); }
  catch { throw new Error("ffprobe devolvió una inspección inválida."); }
  const streamTypes = new Set((Array.isArray(probe?.streams) ? probe.streams : []).map((stream) => stream?.codec_type));
  if (asset.media_type === "Video" && !streamTypes.has("video")) throw new Error("El archivo autorizado como video no contiene una pista de video.");
  if (asset.media_type === "Audio" && (!streamTypes.has("audio") || streamTypes.has("video"))) {
    throw new Error("El archivo autorizado como audio no contiene únicamente audio.");
  }
}

async function cleanupExpiredBrandReferences({ removeAll = false } = {}) {
  await mkdir(BRAND_REFERENCE_DIR, { recursive: true, mode: 0o700 });
  const entries = await readdir(BRAND_REFERENCE_DIR, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const file = join(BRAND_REFERENCE_DIR, entry.name);
    try {
      const info = await stat(file);
      const trackedExpiry = brandReferenceExpiries.get(resolve(file));
      if (removeAll || (trackedExpiry != null && trackedExpiry <= Date.now())
        || Date.now() - info.mtimeMs > BRAND_ASSET_REFERENCE_TTL_SECONDS * 1000) {
        await unlink(file);
        removeBrandReferenceRecordsForFile(file);
      }
    } catch (error) {
      if (error?.code === "ENOENT") removeBrandReferenceRecordsForFile(file);
    }
  }));
  for (const [referenceId, record] of brandReferenceRegistry) {
    if (removeAll || record.expiresAtMs <= Date.now()) removeBrandReferenceRecord(referenceId);
  }
}

async function cleanupStaleBrandReferenceProcesses() {
  await mkdir(BRAND_REFERENCE_ROOT, { recursive: true, mode: 0o700 });
  const processes = await readdir(BRAND_REFERENCE_ROOT, { withFileTypes: true });
  const staleBefore = Date.now() - (BRAND_ASSET_REFERENCE_TTL_SECONDS + 60) * 1000;
  await Promise.all(processes.filter((entry) => entry.isDirectory()
    && entry.name !== BRAND_REFERENCE_PROCESS && /^[0-9a-f]{12}-\d+$/.test(entry.name)).map(async (entry) => {
    const directory = join(BRAND_REFERENCE_ROOT, entry.name);
    try {
      const files = await readdir(directory, { withFileTypes: true });
      await Promise.all(files.filter((file) => file.isFile()
        && /^[0-9a-f-]{36}\.(?:jpg|png|webp|gif|mp4|mov|webm|mp3|m4a|wav|pdf)$/i.test(file.name)).map(async (file) => {
        const path = join(directory, file.name);
        const info = await stat(path);
        if (info.mtimeMs <= staleBefore) await unlink(path).catch(() => {});
      }));
      const remaining = await readdir(directory);
      if (!remaining.length) await rmdir(directory).catch(() => {});
    } catch (error) {
      if (error?.code !== "ENOENT") console.error("[MOMOS MCP] No se pudo retirar una caché temporal vencida.");
    }
  }));
}

async function materializeBrandReference(claim) {
  if (Date.parse(claim.grant.expires_at) - Date.now() < BRAND_ASSET_DELIVERY_MIN_MS) throw new Error("La concesión venció antes de descargar el original.");
  if (claim.asset.size_bytes > BRAND_ASSET_MCP_MAX_BYTES) {
    throw new Error("El original excede 25 MB y debe procesarse mediante un worker privado, no como recurso interactivo MCP.");
  }
  const { data: blob, error } = await supabase.storage.from("brand-assets").download(claim.asset.storage_path);
  if (error || !blob) {
    console.error("[MOMOS MCP] Falló una descarga privada de Biblioteca.");
    throw new Error("No se pudo abrir el original privado dentro del runtime de MOMOS OPS.");
  }
  if (!Number.isSafeInteger(blob.size) || blob.size !== claim.asset.size_bytes) {
    throw new Error("Storage reportó un tamaño distinto a la concesión antes de cargar el original.");
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.length !== claim.asset.size_bytes) throw new Error("El tamaño descargado no coincide con la concesión de MOMOS OPS.");
  if (createHash("sha256").update(bytes).digest("hex") !== claim.asset.content_hash) throw new Error("La huella SHA-256 del original no coincide.");
  if (!mimeMatches(bytes, claim.asset.mime_type)) throw new Error("El contenido real no coincide con el formato autorizado.");
  const blobType = String(blob.type || "").toLowerCase();
  if (blobType && blobType !== "application/octet-stream" && blobType !== claim.asset.mime_type) throw new Error("Storage reportó un formato distinto al autorizado.");
  if (Date.parse(claim.grant.expires_at) - Date.now() < BRAND_ASSET_DELIVERY_MIN_MS) throw new Error("La concesión venció mientras se verificaba el original.");
  await cleanupExpiredBrandReferences();
  const extension = MIME_EXTENSION[claim.asset.mime_type];
  if (!extension) throw new Error("El formato autorizado no puede materializarse como referencia local.");
  const file = resolve(BRAND_REFERENCE_DIR, `${randomUUID()}${extension}`);
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  try { await verifyMediaStreams(file, claim.asset); }
  catch (error) {
    await unlink(file).catch(() => {});
    throw error;
  }
  const remainingMs = Math.min(BRAND_ASSET_REFERENCE_TTL_SECONDS * 1000, Date.parse(claim.grant.expires_at) - Date.now());
  if (remainingMs < BRAND_ASSET_DELIVERY_MIN_MS) {
    await unlink(file).catch(() => {});
    throw new Error("La concesión venció antes de entregar la copia temporal.");
  }
  brandReferenceExpiries.set(file, Date.now() + remainingMs);
  const cleanup = setTimeout(() => unlink(file).catch(() => {}).finally(() => removeBrandReferenceRecordsForFile(file)), remainingMs);
  cleanup.unref?.();
  return file;
}

function brandAssetClaimParams(key, input) {
  return {
    request_key: key, worker_id: WORKER_ID, asset_id: input.assetId, purpose: input.purpose, channel: input.channel,
    expected_fingerprint: input.expectedFingerprint, ttl_seconds: BRAND_ASSET_REFERENCE_TTL_SECONDS,
  };
}

function validateBrandAssetClaimContract(claim, key, input) {
  const expiresAt = Date.parse(claim.grant.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt - Date.now() < BRAND_ASSET_DELIVERY_MIN_MS
    || expiresAt > Date.now() + (BRAND_ASSET_REFERENCE_TTL_SECONDS + 5) * 1000) {
    throw new Error("La concesión no conserva la vigencia exacta solicitada por este runtime.");
  }
  if (claim.grant.request_key !== key || claim.grant.purpose !== input.purpose || claim.grant.channel !== input.channel
    || claim.asset.id !== input.assetId || claim.asset.asset_fingerprint !== input.expectedFingerprint) {
    throw new Error("La concesión no coincide con el activo, canal o propósito solicitado.");
  }
  return claim;
}

async function fetchBrandAssetClaim(key, input) {
  const value = await rpc("momos_get_brand_asset_reference", { p: brandAssetClaimParams(key, input) });
  return { value, claim: validateBrandAssetClaimContract(normalizeBrandAssetClaim(value), key, input) };
}

function assertSameBrandAssetClaim(expected, actual) {
  const fields = ["id", "asset_fingerprint", "content_hash", "size_bytes", "mime_type", "media_type", "storage_path"];
  if (fields.some((field) => expected.asset[field] !== actual.asset[field])
    || expected.grant.request_key !== actual.grant.request_key
    || expected.grant.expires_at !== actual.grant.expires_at
    || expected.grant.channel !== actual.grant.channel
    || expected.grant.purpose !== actual.grant.purpose) {
    throw new Error("El activo o sus permisos cambiaron durante la entrega; buscá de nuevo.");
  }
}

function buildMcpBrandReference(claimValue, localPath, { claimKey, input }) {
  const { asset, grant } = sanitizeBrandAssetClaimForReference(claimValue);
  const file = assertBrandReferencePath(localPath);
  const trackedExpiry = brandReferenceExpiries.get(file);
  const grantExpiry = Date.parse(grant.expires_at);
  const expiresAtMs = Math.min(trackedExpiry, grantExpiry);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs - Date.now() < BRAND_ASSET_DELIVERY_MIN_MS) {
    throw new Error("La referencia temporal ya no tiene vigencia útil para registrarse.");
  }
  const referenceId = randomUUID();
  const uri = `${BRAND_REFERENCE_URI_PREFIX}${referenceId}`;
  const output = {
    schema_version: "momos-brand-asset-reference/v1",
    asset,
    reference: {
      kind: "mcp-resource", uri, mime_type: asset.mime_type, expires_at: grant.expires_at,
      content_hash_verified: true,
    },
    policies: { human_review_required: true, output_returns_to_library: true, publication_allowed: false, external_execution_allowed: false },
  };
  brandReferenceRegistry.set(referenceId, {
    referenceId, uri, file, expiresAtMs, asset, claimKey, output,
    claimInput: Object.freeze({ ...input }),
  });
  return output;
}

function brandReferenceRecord(output) {
  if (output?.schema_version !== "momos-brand-asset-reference/v1"
    || output?.reference?.kind !== "mcp-resource" || output?.reference?.content_hash_verified !== true) {
    throw new Error("La referencia opaca no conserva el contrato de entrega.");
  }
  const referenceId = referenceIdFromUri(output.reference.uri);
  const record = brandReferenceRegistry.get(referenceId);
  if (!record || record.uri !== output.reference.uri) throw new Error("La referencia opaca no existe o ya venció.");
  return record;
}

async function validateReferenceBeforeDelivery(output, { includeBytes = false } = {}) {
  const record = brandReferenceRecord(output);
  const file = assertBrandReferencePath(record.file);
  const expiry = Date.parse(String(output.reference.expires_at || ""));
  const trackedExpiry = brandReferenceExpiries.get(file);
  if (!Number.isFinite(expiry) || expiry - Date.now() < BRAND_ASSET_DELIVERY_MIN_MS
    || !Number.isFinite(trackedExpiry) || trackedExpiry - Date.now() < BRAND_ASSET_DELIVERY_MIN_MS
    || record.expiresAtMs - Date.now() < BRAND_ASSET_DELIVERY_MIN_MS) {
    throw new Error("La referencia temporal ya no tiene vigencia útil para entregarse.");
  }
  const info = await stat(file);
  if (!info.isFile() || info.size !== output.asset.size_bytes) throw new Error("La copia temporal cambió antes de entregarse.");
  const bytes = await readFile(file);
  if (createHash("sha256").update(bytes).digest("hex") !== output.asset.content_hash) {
    throw new Error("La copia temporal perdió su integridad antes de entregarse.");
  }
  return includeBytes ? bytes : undefined;
}

async function revalidateBrandReference(record) {
  const { claim } = await fetchBrandAssetClaim(record.claimKey, record.claimInput);
  if (claim.asset.id !== record.asset.id || claim.asset.asset_fingerprint !== record.asset.asset_fingerprint
    || claim.asset.content_hash !== record.asset.content_hash || claim.asset.size_bytes !== record.asset.size_bytes
    || claim.asset.mime_type !== record.asset.mime_type) {
    throw new Error("El original perdió vigencia, derechos o integridad antes de ser leído.");
  }
  return claim;
}

async function rpc(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message);
  return data;
}

async function logAccess({ key, tool, mode = "Lectura", status, input, output, subject = "", details = {} }, { required = false } = {}) {
  try {
    await rpc("registrar_acceso_mcp_agencia", { p: {
      request_key: key, tool_name: tool, mode, status, worker_id: WORKER_ID,
      subject_ref: subject, input_fingerprint: hash(input), output_fingerprint: output == null ? "" : hash(output), details,
    } });
  } catch (error) {
    console.error(`[MOMOS MCP] No se pudo registrar la bitácora: ${redact(error.message)}`);
    if (required) throw new Error("No se pudo sellar la entrega en la bitácora de MOMOS OPS.");
  }
}

const textResult = (data) => {
  const content = [{ type: "text", text: JSON.stringify(data, null, 2) }];
  if (data?.reference?.kind === "mcp-resource") {
    content.push({
      type: "resource_link", uri: data.reference.uri, name: String(data.asset?.title || "Original MOMOS"),
      mimeType: data.reference.mime_type,
      description: "Original temporal verificado de Biblioteca MOMOS; requiere lectura MCP antes de vencer.",
    });
  }
  return { content };
};
const errorResult = (message) => ({ isError: true, content: [{ type: "text", text: redact(message) }] });

async function discardBrandReferenceOutput(output) {
  if (output?.reference?.kind !== "mcp-resource") return;
  try {
    const referenceId = referenceIdFromUri(output.reference.uri);
    const record = removeBrandReferenceRecord(referenceId);
    if (record?.file) await unlink(assertBrandReferencePath(record.file)).catch(() => {});
  } catch {}
}

async function governedTool(tool, input, callback, { mode = "Lectura", subject = "", auditKeySuffix = "", auditRequired = false } = {}) {
  const key = requestKey(tool);
  const auditKey = auditKeySuffix ? `${key}:${auditKeySuffix}` : key;
  let output = null;
  try {
    output = await callback(key);
    if (auditRequired) await validateReferenceBeforeDelivery(output);
    await logAccess({ key: auditKey, tool, mode, status: "OK", input, output, subject, details: { version: VERSION, external_execution: false } }, { required: auditRequired });
    if (auditRequired) await validateReferenceBeforeDelivery(output);
    return textResult(output);
  } catch (error) {
    if (auditRequired) await discardBrandReferenceOutput(output);
    const failureAuditKey = auditRequired && output ? `${auditKey}:failed` : auditKey;
    await logAccess({ key: failureAuditKey, tool, mode, status: mode === "Propuesta" && !PROPOSALS_ENABLED ? "Denegado" : "Fallido", input, subject,
      details: { version: VERSION, error: redact(error.message), external_execution: false } });
    return errorResult(error.message);
  }
}

async function probeBrandLibrarySearch() {
  const key = requestKey("momos_search_brand_assets");
  const expectedSearch = {
    query: "", mediaTypes: [], productId: "", figure: "", flavor: "", orientation: "", channel: "", limit: 1,
  };
  const result = await rpc("momos_search_brand_assets", { p: {
    request_key: key, worker_id: WORKER_ID, query: "", media_types: [], product_id: null,
    figure: null, flavor: null, orientation: null, channel: null, limit: 1,
  } });
  return normalizeBrandAssetSearch(result, { expectedRequestKey: key, expectedSearch });
}

async function selfTest() {
  const available = await rpc("mcp_agency_gateway_disponible");
  const libraryContract = await rpc("mcp_biblioteca_creativa_contrato");
  if (libraryContract?.schema_version !== "momos-mcp-brand-library/v1"
    || libraryContract?.search_schema !== "momos-brand-asset-search/v1"
    || libraryContract?.claim_schema !== "momos-brand-asset-claim/v1"
    || Number(libraryContract?.max_interactive_reference_bytes) !== BRAND_ASSET_MCP_MAX_BYTES
    || libraryContract?.external_execution_allowed !== false) throw new Error("El contrato MCP de Biblioteca Creativa no es compatible.");
  const [context, libraryProbe, approvalContract] = await Promise.all([
    rpc("obtener_contexto_director_agencia").then(normalizeAgencyMcpSnapshot), probeBrandLibrarySearch(),
    rpc("mcp_aprobacion_humana_contrato"),
  ]);
  if (libraryProbe.external_execution_allowed !== false) throw new Error("La prueba real de Biblioteca amplió permisos externos.");
  if (approvalContract?.schema_version !== "momos-human-approval-contract/v1"
    || approvalContract?.mcp_can_decide !== false || approvalContract?.external_execution_allowed !== false) {
    throw new Error("El contrato MCP de aprobación humana no es compatible.");
  }
  process.stdout.write(`[MOMOS MCP] Salud OK · gateway ${available ? "activo" : "inactivo"} · biblioteca activa · aprobación humana activa · contexto ${context.fingerprint.slice(0, 8)} · propuestas ${PROPOSALS_ENABLED ? "habilitadas" : "protegidas"}\n`);
}

if (SELF_TEST) {
  await selfTest();
} else {
  await cleanupStaleBrandReferenceProcesses();
  await cleanupExpiredBrandReferences({ removeAll: true });
  const referenceSweep = setInterval(() => Promise.all([
    cleanupExpiredBrandReferences(), cleanupStaleBrandReferenceProcesses(),
  ]).catch(() => {
    console.error("[MOMOS MCP] No se pudo completar el barrido de referencias temporales.");
  }), 60_000);
  referenceSweep.unref?.();
  const server = new McpServer({ name: "momos-agency", version: MOMOS_AGENCY_MCP_VERSION });

  const brandReferenceTemplate = new ResourceTemplate(`${BRAND_REFERENCE_URI_PREFIX}{referenceId}`, { list: undefined });
  server.registerResource("momos-brand-asset-reference", brandReferenceTemplate, {
    title: "Original temporal de Biblioteca MOMOS",
    description: "Original privado, verificado y de vigencia corta. No enumera referencias ni expone rutas del host.",
  }, async (uri, variables) => {
    const referenceId = typeof variables.referenceId === "string" ? variables.referenceId.toLowerCase() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(referenceId)) {
      throw new Error("La referencia solicitada es inválida.");
    }
    const record = brandReferenceRegistry.get(referenceId);
    if (!record || record.uri !== uri.href) throw new Error("La referencia solicitada no existe o ya venció.");
    const readKey = requestKey("momos_get_brand_asset_reference");
    return serializeBrandReferenceMaterialization(async () => {
      try {
        const bytes = await validateReferenceBeforeDelivery(record.output, { includeBytes: true });
        await revalidateBrandReference(record);
        await logAccess({
          key: readKey, tool: "momos_get_brand_asset_reference", mode: "Referencia", status: "OK",
          input: { assetId: record.asset.id, referenceId, channel: record.claimInput.channel, purpose: record.claimInput.purpose },
          output: { assetId: record.asset.id, referenceId, contentHash: record.asset.content_hash, bytes: bytes.length },
          subject: `brand-asset:${record.asset.id}`,
          details: { version: VERSION, event: "resource_read", external_execution: false, local_path_exposed: false },
        }, { required: true });
        await revalidateBrandReference(record);
        if (record.expiresAtMs - Date.now() < BRAND_ASSET_DELIVERY_MIN_MS) throw new Error("La referencia venció antes de completar su lectura.");
        return { contents: [{ uri: uri.href, mimeType: record.asset.mime_type, blob: bytes.toString("base64") }] };
      } catch (error) {
        await logAccess({
          key: `${readKey}:failed`, tool: "momos_get_brand_asset_reference", mode: "Referencia", status: "Fallido",
          input: { assetId: record.asset.id, referenceId }, subject: `brand-asset:${record.asset.id}`,
          details: { version: VERSION, event: "resource_read", error: redact(error.message), external_execution: false },
        });
        throw new Error(redact(error.message));
      }
    });
  });

  server.registerTool("momos_health", {
    title: "Salud del Cerebro de Agencia MOMOS",
    description: "Comprueba el gateway semántico. No devuelve secretos ni ejecuta acciones.",
    inputSchema: z.object({}),
  }, async (input) => governedTool("momos_health", input, async () => {
    const [gatewayActive, libraryActive, approvalActive, libraryProbe] = await Promise.all([
      rpc("mcp_agency_gateway_disponible"), rpc("mcp_biblioteca_creativa_disponible"),
      rpc("mcp_aprobaciones_humanas_disponible"), probeBrandLibrarySearch(),
    ]);
    return {
      ok: Boolean(gatewayActive) && Boolean(libraryActive) && Boolean(approvalActive), version: VERSION,
      brand_library_active: Boolean(libraryActive), brand_library_probe_count: libraryProbe.count,
      human_approval_active: Boolean(approvalActive), human_approval_decider: "MOMO OPS · Administración",
      proposals_enabled: PROPOSALS_ENABLED,
      external_execution_allowed: false,
    };
  }));

  server.registerTool("momos_agency_snapshot", {
    title: "Snapshot seguro de MOMOS OPS",
    description: "Lee señales agregadas de pedidos, operación, inventario, CRM y Agencia sin PII. No ofrece SQL libre.",
    inputSchema: z.object({}),
  }, async (input) => governedTool("momos_agency_snapshot", input, async () => normalizeAgencyMcpSnapshot(await rpc("obtener_contexto_director_agencia"))));

  server.registerTool("momos_meta_observatory", {
    title: "Contexto analítico Meta",
    description: "Lee el contexto gobernado del Observatorio Meta. No crea, pausa, publica ni cambia presupuesto.",
    inputSchema: z.object({}),
  }, async (input) => governedTool("momos_meta_observatory", input, async () => rpc("obtener_contexto_meta_agente")));

  server.registerTool("momos_creative_intelligence", {
    title: "Memoria creativa y publicitaria MOMOS",
    description: "Lee fórmulas versionadas y separa ROAS de plataforma, ROAS interno y retorno sobre margen. No publica, pauta ni declara ganadores.",
    inputSchema: z.object({}),
  }, async (input) => governedTool("momos_creative_intelligence", input,
    async () => normalizeCreativeIntelligence(await rpc("momos_creative_intelligence_v1"))));

  server.registerTool("momos_propose_creative_formula", {
    title: "Proponer fórmula creativa MOMOS",
    description: "Crea únicamente una propuesta versionada para revisión humana. Nunca la aprueba, publica, pauta o ejecuta.",
    inputSchema: z.object({
      proposalKey: z.string().trim().regex(/^[A-Za-z0-9_.:-]{8,120}$/),
      formulaKey: z.string().trim().regex(/^[A-Za-z0-9_.:-]{3,100}$/),
      name: z.string().trim().min(3).max(160),
      mode: z.enum(["Pauta", "Orgánico", "Híbrido"]),
      sourceCreativeId: z.string().trim().min(1).max(100),
      sourceCreativeVersionId: z.number().int().positive().optional(),
      retentionScriptId: z.number().int().positive().optional(),
      formula: z.object({
        hook: z.string().trim().min(2).max(700),
        narrativeStructure: z.string().trim().min(2).max(700),
        humanization: z.string().trim().min(2).max(700),
        proof: z.string().trim().min(2).max(700),
        offer: z.string().trim().min(2).max(700),
        cta: z.string().trim().min(2).max(700),
        visualStyle: z.string().trim().min(2).max(700),
        cameraPattern: z.string().trim().min(2).max(700),
      }).strict(),
    }).strict(),
  }, async (input) => governedTool("momos_propose_creative_formula", input, async () => rpc(
    "proponer_formula_creativa_agente_v1", { p: {
      proposal_key: input.proposalKey, formula_key: input.formulaKey, name: input.name,
      mode: input.mode, source_creative_id: input.sourceCreativeId,
      source_creative_version_id: input.sourceCreativeVersionId ?? null,
      retention_script_id: input.retentionScriptId ?? null,
      formula_snapshot: {
        hook: input.formula.hook, narrative_structure: input.formula.narrativeStructure,
        humanization: input.formula.humanization, proof: input.formula.proof,
        offer: input.formula.offer, cta: input.formula.cta,
        visual_style: input.formula.visualStyle, camera_pattern: input.formula.cameraPattern,
      },
    } },
  ), { subject: `creative-formula:${input.formulaKey}` }));

  server.registerTool("momos_creative_context", {
    title: "Contexto creativo gobernado",
    description: "Lee un contexto exacto de routing, motion, calidad o retención mediante RPC de lista cerrada.",
    inputSchema: z.object({
      kind: z.enum(["routing", "motion", "quality", "retention"]),
      id: z.number().int().positive(),
    }),
  }, async (input) => governedTool("momos_creative_context", input, async () => {
    const route = creativeContextRpc(input.kind);
    return rpc(route.rpc, { [route.param]: input.id });
  }, { subject: `${input.kind}:${input.id}` }));

  server.registerTool("momos_search_brand_assets", {
    title: "Buscar activos autorizados de MOMOS",
    description: "Busca activos de la Biblioteca Creativa con derechos vigentes y permiso para IA. Devuelve metadatos, nunca secretos, rutas privadas ni SQL libre.",
    inputSchema: z.object({
      query: z.string().trim().max(80).default(""),
      mediaTypes: z.array(z.enum(BRAND_ASSET_TYPES)).max(BRAND_ASSET_TYPES.length).default([]),
      productId: z.string().trim().max(80).default(""),
      figure: z.string().trim().max(80).default(""),
      flavor: z.string().trim().max(80).default(""),
      orientation: z.enum(BRAND_ASSET_ORIENTATIONS).optional(),
      channel: z.enum(BRAND_ASSET_CHANNELS).optional(),
      limit: z.number().int().min(1).max(20).default(10),
    }),
  }, async (input) => governedTool("momos_search_brand_assets", input, async (key) => {
    const result = await rpc("momos_search_brand_assets", { p: {
      request_key: key, worker_id: WORKER_ID, query: input.query, media_types: input.mediaTypes,
      product_id: input.productId || null, figure: input.figure || null, flavor: input.flavor || null,
      orientation: input.orientation || null, channel: input.channel || null, limit: input.limit,
    } });
    return normalizeBrandAssetSearch(result, { expectedRequestKey: key, expectedSearch: input });
  }, { subject: "brand-library-search", auditKeySuffix: "delivery" }));

  server.registerTool("momos_get_brand_asset_reference", {
    title: "Conceder referencia temporal de un original MOMOS",
    description: "Vuelve a validar derechos, IA y canal; verifica huella, tamaño y formato; y concede un recurso MCP temporal y opaco. No expone URL, token, ruta privada ni ruta local.",
    inputSchema: z.object({
      assetId: z.number().int().positive(),
      channel: z.enum(BRAND_ASSET_CHANNELS),
      purpose: z.enum(BRAND_ASSET_PURPOSES),
      expectedFingerprint: z.string().regex(/^[0-9a-f]{32}$/),
    }),
  }, async (input) => governedTool("momos_get_brand_asset_reference", input, async (key) => {
    const { value: claimValue, claim } = await fetchBrandAssetClaim(key, input);
    let localPath;
    try {
      localPath = await serializeBrandReferenceMaterialization(() => materializeBrandReference(claim));
      const { claim: revalidatedClaim } = await fetchBrandAssetClaim(key, input);
      assertSameBrandAssetClaim(claim, revalidatedClaim);
    } catch (error) {
      console.error("[MOMOS MCP] No se pudo materializar una referencia privada.");
      if (localPath) {
        await unlink(localPath).catch(() => {});
        removeBrandReferenceRecordsForFile(localPath);
      }
      throw new Error("MOMOS OPS no pudo verificar y materializar el original solicitado.");
    }
    try {
      return buildMcpBrandReference(claimValue, localPath, { claimKey: key, input });
    } catch (error) {
      await unlink(localPath).catch(() => {});
      removeBrandReferenceRecordsForFile(localPath);
      throw error;
    }
  }, { mode: "Referencia", subject: `brand-asset:${input.assetId}`, auditKeySuffix: "delivery", auditRequired: true }));

  server.registerTool("momos_submit_proposals", {
    title: "Enviar propuestas a revisión humana",
    description: "Registra propuestas selladas en MOMO OPS. Nunca ejecuta la acción propuesta y está deshabilitada por defecto.",
    inputSchema: z.object({
      requestKey: z.string().min(3).max(160).regex(/^[A-Za-z0-9:_-]+$/),
      snapshotFingerprint: z.string().regex(/^[0-9a-f]{32}$/),
      focus: z.string().min(3).max(180),
      proposals: z.array(z.record(z.string(), z.unknown())).max(12),
    }),
  }, async (input) => governedTool("momos_submit_proposals", input, async () => {
    if (!PROPOSALS_ENABLED) throw new Error("Las propuestas MCP están protegidas. Activá MOMOS_MCP_PROPOSALS_ENABLED=true en el entorno privado para registrarlas.");
    const run = buildAgencyMcpRun(input);
    const result = await rpc("registrar_corrida_orquestador_agente", { p: run });
    return { ...result, external_execution: false, requires_human_approval: true };
  }, { mode: "Propuesta", subject: input.focus.slice(0, 180) }));

  server.registerTool("momos_request_human_approval", {
    title: "Solicitar aprobación humana en MOMO OPS",
    description: "Registra el preflight exacto de un trabajo Higgsfield Preparado. No aprueba, no genera y no consume créditos; la decisión pertenece a Administración en MOMO OPS.",
    inputSchema: z.object({
      requestKey: z.string().min(3).max(180).regex(/^[A-Za-z0-9:_-]+$/),
      jobId: z.number().int().positive(),
      title: z.string().min(3).max(180),
      expiresInHours: z.number().int().min(1).max(72).default(24),
      contract: z.record(z.string(), z.unknown()),
    }),
  }, async (input) => governedTool("momos_request_human_approval", input, async () => {
    const request = buildMcpHumanApprovalRequest({ ...input, workerId: WORKER_ID });
    const result = await rpc("momos_solicitar_aprobacion_humana", { p: request });
    return normalizeMcpHumanApprovalStatus(result, {
      expectedApprovalId: result?.approval_id,
      expectedFingerprint: result?.contract_fingerprint,
    });
  }, { mode: "Solicitud", subject: `creative-job:${input.jobId}` }));

  server.registerTool("momos_get_human_approval", {
    title: "Consultar decisión humana en MOMO OPS",
    description: "Consulta una aprobación por id y huella exacta. No puede resolverla ni ejecutar el trabajo Higgsfield.",
    inputSchema: z.object({
      approvalId: z.number().int().positive(),
      expectedFingerprint: z.string().regex(/^[0-9a-f]{32}$/),
    }),
  }, async (input) => governedTool("momos_get_human_approval", input, async () => {
    const result = await rpc("momos_consultar_aprobacion_humana", {
      p_approval_id: input.approvalId, p_expected_fingerprint: input.expectedFingerprint,
    });
    return normalizeMcpHumanApprovalStatus(result, input);
  }, { subject: `human-approval:${input.approvalId}` }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[MOMOS MCP] ${VERSION} listo por stdio · aprobación humana vía MOMO OPS · propuestas ${PROPOSALS_ENABLED ? "habilitadas" : "protegidas"}`);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(referenceSweep);
    await cleanupExpiredBrandReferences({ removeAll: true }).catch(() => {});
    await rmdir(BRAND_REFERENCE_DIR).catch(() => {});
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
}
