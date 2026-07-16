import { hostname } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { redactConnectorError } from "../src/lib/higgsfield-connector.js";
import { META_GRAPH_ORIGIN, metaDryRunReceipt, metaReadRequest, normalizeMetaAccountId, validateMetaConnectorConfig } from "../src/lib/agency-meta-connector.js";
import { createMetaAppSecretProof } from "../src/lib/meta-server-auth.js";

const VERSION = "momos-meta-worker/1.0.0";
const ONCE = process.argv.includes("--once");
const HEALTH_ONLY = process.argv.includes("--health-only");
const POLL_MS = Math.max(10_000, Number(process.env.META_POLL_MS || 30_000));
const WORKER_ID = process.env.META_WORKER_ID || `${hostname()}-${process.pid}`;
const ACCESS_TOKEN = String(process.env.META_ACCESS_TOKEN || "").trim();
const APP_SECRET = String(process.env.META_APP_SECRET || "").trim();
const API_VERSION = String(process.env.META_GRAPH_API_VERSION || "v25.0").trim();
const AD_ACCOUNT_ID = normalizeMetaAccountId(process.env.META_AD_ACCOUNT_ID || "");
const API_BASE_URL = String(process.env.META_GRAPH_BASE_URL || META_GRAPH_ORIGIN).replace(/\/+$/, "");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUDGET_MINOR_FACTOR = Number(process.env.META_BUDGET_MINOR_FACTOR || 1);

function isSupabaseServerKey(value) {
  const key = String(value || "").trim();
  if (key.startsWith("sb_secret_")) return true;
  if (key.startsWith("sb_publishable_")) return false;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role"; }
  catch { return false; }
}

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el worker Meta.");
let supabaseEndpoint;
try { supabaseEndpoint = new URL(SUPABASE_URL); } catch { throw new Error("SUPABASE_URL debe ser una URL completa."); }
if (!/^https?:$/.test(supabaseEndpoint.protocol)) throw new Error("SUPABASE_URL debe comenzar por https://.");
if (!isSupabaseServerKey(SERVICE_KEY)) throw new Error("SUPABASE_SERVICE_ROLE_KEY no es una clave privada service_role.");
const config = validateMetaConnectorConfig({ accessToken: ACCESS_TOKEN, appSecret: APP_SECRET, apiVersion: API_VERSION, adAccountId: AD_ACCOUNT_ID, baseUrl: API_BASE_URL });
if (!config.allowed) throw new Error(config.reasons.join(" "));
if (!Number.isFinite(BUDGET_MINOR_FACTOR) || BUDGET_MINOR_FACTOR <= 0) throw new Error("META_BUDGET_MINOR_FACTOR debe ser positivo.");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const proof = createMetaAppSecretProof(ACCESS_TOKEN, APP_SECRET);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class MetaReadError extends Error {
  constructor(message, uncertain = false) { super(message); this.uncertain = uncertain; }
}

async function rpc(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message);
  return data;
}

async function graphGet(id, fields) {
  const request = metaReadRequest(id, fields, { apiVersion: API_VERSION, appSecretProof: proof, baseUrl: API_BASE_URL });
  let response;
  try {
    response = await fetch(request.url, { method: request.method, redirect: request.redirect,
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  } catch (error) { throw new MetaReadError(`No se pudo confirmar la lectura Meta: ${redactConnectorError(error)}`, true); }
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { throw new MetaReadError(`Meta respondió HTTP ${response.status} sin JSON válido.`); }
  if (!response.ok || payload?.error) {
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    throw new MetaReadError(`Meta rechazó la lectura: ${redactConnectorError(detail)}`);
  }
  return payload;
}

async function reportHealth(status = "Activa", error = "", synced = false, label = "") {
  return rpc("reportar_worker_meta", { p_worker_id: WORKER_ID, p_version: VERSION, p_api_version: API_VERSION,
    p_status: status, p_error: redactConnectorError(error), p_account_label: label, p_ad_account_id: AD_ACCOUNT_ID, p_synced: synced });
}

async function verifyMetaReadAccess() {
  const account = await graphGet(AD_ACCOUNT_ID, ["id", "name", "account_status", "currency", "timezone_name"]);
  if (normalizeMetaAccountId(account.id) !== AD_ACCOUNT_ID) throw new Error("Meta respondió con otra cuenta publicitaria.");
  await reportHealth("Activa", "", true, account.name || "Cuenta Meta MOMOS");
  return account;
}

async function processOne() {
  const claim = await rpc("reclamar_dry_run_meta", { p_worker_id: WORKER_ID, p_lease_seconds: 120 });
  if (!claim?.dry_run_id) return false;
  let reading = false;
  try {
    if (claim.snapshot?.api_version !== API_VERSION || normalizeMetaAccountId(claim.snapshot?.expected?.ad_account_id) !== AD_ACCOUNT_ID) {
      throw new MetaReadError("El contrato solicita otra versión Graph o cuenta publicitaria.");
    }
    await rpc("marcar_lectura_dry_run_meta", { p_dry_run_id: claim.dry_run_id, p_lease_token: claim.lease_token });
    reading = true;
    const [account, campaign, audience] = await Promise.all([
      graphGet(AD_ACCOUNT_ID, ["id", "name", "account_status", "currency", "timezone_name"]),
      graphGet(claim.snapshot.expected.campaign_external_id, ["id", "name", "account_id", "status", "effective_status", "objective", "buying_type", "daily_budget", "lifetime_budget"]),
      graphGet(claim.snapshot.expected.audience_external_id, ["id", "name", "account_id"]),
    ]);
    const receipt = metaDryRunReceipt(claim.snapshot, { account, campaign, audience }, { budgetMinorFactor: BUDGET_MINOR_FACTOR });
    await rpc("registrar_resultado_dry_run_meta", { p_dry_run_id: claim.dry_run_id, p_lease_token: claim.lease_token,
      p_result: receipt.reconciled ? "Conciliado" : "Divergente", p_receipt: receipt,
      p_error: receipt.reconciled ? "" : "Las identidades o el presupuesto visible no coinciden con el contrato sellado." });
    return true;
  } catch (error) {
    const uncertain = reading && error?.uncertain === true;
    await rpc("registrar_resultado_dry_run_meta", { p_dry_run_id: claim.dry_run_id, p_lease_token: claim.lease_token,
      p_result: uncertain ? "Incierto" : "Fallido", p_receipt: {}, p_error: redactConnectorError(error) }).catch(() => {});
    throw error;
  }
}

async function cycle() {
  try {
    const account = await verifyMetaReadAccess();
    if (HEALTH_ONLY) { console.log(`[Meta] Salud OK · ${API_VERSION} · ${account.name || AD_ACCOUNT_ID} · ads_read`); return; }
    const worked = await processOne();
    if (worked) console.log("[Meta] Dry-run conciliado; cero mutaciones externas.");
  } catch (error) {
    await reportHealth("Con error", error, false).catch(() => {});
    console.error(`[Meta] ${redactConnectorError(error)}`);
    if (ONCE) process.exitCode = 1;
  }
}

do { await cycle(); if (ONCE) break; await sleep(POLL_MS); } while (true);
