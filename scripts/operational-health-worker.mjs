import { hostname } from "node:os";
import { createClient } from "@supabase/supabase-js";

const VERSION = "momos-operational-health-worker/1.0.0";
const ONCE = process.argv.includes("--once");
const HEALTH_ONLY = process.argv.includes("--health-only");
const POLL_MS = Math.max(60_000, Number(process.env.OPERATIONAL_HEALTH_POLL_MS || 300_000));
const WORKER_ID = String(process.env.OPERATIONAL_HEALTH_WORKER_ID || `${hostname()}-${process.pid}`)
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

async function runMonitor() {
  const { data, error } = await supabase.rpc("ejecutar_monitor_salud_operativa_v1", {
    p_worker_id: WORKER_ID,
    p_version: VERSION,
  });
  if (error) throw new Error(error.message);
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
