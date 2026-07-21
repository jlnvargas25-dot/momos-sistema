import { hostname } from "node:os";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const VERSION = "momos-operational-health-worker/1.1.0";
const ONCE = process.argv.includes("--once");
const HEALTH_ONLY = process.argv.includes("--health-only");
const POLL_MS = Math.max(60_000, Number(process.env.OPERATIONAL_HEALTH_POLL_MS || 300_000));
const WORKER_ID = String(process.env.OPERATIONAL_HEALTH_WORKER_ID || `${hostname()}-health`)
  .replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 80);
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function isSupabaseServerKey(value) {
  if (value.startsWith("sb_secret_")) return true;
  if (value.startsWith("sb_publishable_")) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role"; }
  catch { return false; }
}

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno privado del monitor.");
}
let endpoint;
try { endpoint = new URL(SUPABASE_URL); } catch { throw new Error("SUPABASE_URL debe ser una URL HTTP(S) completa."); }
if (!/^https?:$/.test(endpoint.protocol)) throw new Error("SUPABASE_URL debe comenzar por https://, salvo desarrollo local.");
if (!isSupabaseServerKey(SERVICE_KEY)) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY debe ser sb_secret_ o service_role; nunca publishable/anon.");
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function latencyHistogram(durationMs) {
  const result = { lte_100: 0, lte_250: 0, lte_500: 0, lte_1000: 0, lte_2500: 0, gt_2500: 0 };
  const key = durationMs <= 100 ? "lte_100"
    : durationMs <= 250 ? "lte_250"
      : durationMs <= 500 ? "lte_500"
        : durationMs <= 1000 ? "lte_1000"
          : durationMs <= 2500 ? "lte_2500" : "gt_2500";
  result[key] = 1;
  return result;
}

function stableUuid(material) {
  const hex = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function reportSlo(durationMs, succeeded) {
  const bucketAt = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const { error } = await supabase.rpc("registrar_telemetria_slo_v1", {
    p: {
      idempotency_key: stableUuid(`${WORKER_ID}|HEALTH_MONITOR|${bucketAt}|${succeeded ? "ok" : "error"}`),
      service_code: "HEALTH_MONITOR",
      bucket_at: bucketAt,
      sample_count: 1,
      success_count: succeeded ? 1 : 0,
      error_count: succeeded ? 0 : 1,
      latency_buckets: latencyHistogram(durationMs),
      saturation_pct: null,
      queue_depth: 0,
      source_kind: "worker",
    },
  });
  // Despliegue compatible: antes de H95 la RPC no existe. Cualquier otro
  // error deja de ser silencioso porque significaría perder observabilidad.
  if (error && error.code !== "PGRST202") throw new Error("SLO_REPORT_FAILED");
}

async function runMonitor() {
  const startedAt = performance.now();
  const { data, error } = await supabase.rpc("ejecutar_monitor_salud_operativa_v1", {
    p_worker_id: WORKER_ID,
    p_version: VERSION,
  });
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  if (error) {
    await reportSlo(durationMs, false).catch(() => {});
    throw new Error(error.message);
  }
  await reportSlo(durationMs, true);
  const state = String(data?.status || "Desconocido");
  const checks = Number(data?.checks || 0);
  const failures = Number(data?.failures || 0);
  process.stdout.write(`[Salud MOMOS] ${state} · ${checks} chequeos · ${failures} fallos · ${WORKER_ID}\n`);
  return data;
}

async function main() {
  do {
    try {
      await runMonitor();
    } catch (error) {
      // No se imprime el mensaje remoto: puede contener nombres internos. El
      // supervisor del proceso recibe un código estable y ninguna PII.
      process.stderr.write("[Salud MOMOS] MONITOR_RPC_FAILED\n");
      if (ONCE || HEALTH_ONLY) throw new Error("MONITOR_RPC_FAILED");
    }
    if (ONCE || HEALTH_ONLY) break;
    await sleep(POLL_MS);
  } while (true);
}

await main();
