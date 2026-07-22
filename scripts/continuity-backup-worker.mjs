import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const MANAGEMENT_TOKEN = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();
const PROJECT_REF = String(process.env.SUPABASE_PROJECT_REF || "").trim()
  || (() => {
    try { return new URL(SUPABASE_URL).hostname.split(".")[0] || ""; }
    catch { return ""; }
  })();

function isSupabaseServerKey(value) {
  if (value.startsWith("sb_secret_")) return true;
  if (value.startsWith("sb_publishable_")) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role"; }
  catch { return false; }
}

if (!SUPABASE_URL || !PROJECT_REF || !MANAGEMENT_TOKEN || !isSupabaseServerKey(SERVICE_KEY)) {
  throw new Error("CONTINUITY_PRIVATE_ENV_INVALID");
}
if (!/^[a-z0-9]{20}$/.test(PROJECT_REF)) throw new Error("SUPABASE_PROJECT_REF_INVALID");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function readManagedBackups() {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/backups`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${MANAGEMENT_TOKEN}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`BACKUP_MANAGEMENT_HTTP_${response.status}`);
  const result = await response.json();
  const backups = Array.isArray(result?.backups) ? result.backups : [];
  const completed = backups
    .filter((backup) => String(backup?.status || "").toUpperCase() === "COMPLETED")
    .sort((a, b) => String(b?.inserted_at || "").localeCompare(String(a?.inserted_at || "")));
  const latest = completed[0];
  if (!latest?.id || !latest?.inserted_at) throw new Error("MANAGED_BACKUP_NOT_FOUND");
  return {
    backupKey: `supabase-${latest.id}`,
    completedAt: new Date(latest.inserted_at).toISOString(),
    pitrEnabled: Boolean(result?.pitr_enabled),
    regionCode: String(result?.region || "unknown").toLowerCase(),
    completedCount: completed.length,
  };
}

async function main() {
  let observation;
  try {
    observation = await readManagedBackups();
  } catch {
    process.stderr.write("[Continuidad MOMOS] BACKUP_MANAGEMENT_READ_FAILED\n");
    process.exitCode = 1;
    return;
  }
  const { data, error } = await supabase.rpc("registrar_observacion_backup_administrado_v1", {
    p: {
      backup_key: observation.backupKey,
      source: "Supabase",
      status: "Completado",
      completed_at: observation.completedAt,
      pitr_enabled: observation.pitrEnabled,
      region_code: observation.regionCode,
    },
  });
  if (error || !data?.ok) {
    process.stderr.write("[Continuidad MOMOS] BACKUP_OBSERVATION_RPC_FAILED\n");
    process.exitCode = 1;
    return;
  }
  const ageMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(observation.completedAt)) / 60_000));
  process.stdout.write(
    `[Continuidad MOMOS] Backup observado · ${observation.completedCount} disponibles · `
    + `último hace ${ageMinutes} min · PITR ${observation.pitrEnabled ? "activo" : "inactivo"} · no certificado\n`,
  );
}

await main();
