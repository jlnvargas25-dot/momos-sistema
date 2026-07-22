import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = (name) => String(process.env[name] || "").trim();
const PRODUCTION_URL = env("PRODUCTION_SUPABASE_URL").replace(/\/+$/, "");
const PRODUCTION_KEY = env("PRODUCTION_SUPABASE_SERVICE_ROLE_KEY");
const PRODUCTION_REF = env("PRODUCTION_PROJECT_REF");
const STAGING_URL = env("STAGING_SUPABASE_URL").replace(/\/+$/, "");
const STAGING_REF = env("STAGING_PROJECT_REF");
const MANAGEMENT_TOKEN = env("SUPABASE_ACCESS_TOKEN");
const BACKUP_ID = env("MOMOS_RECOVERY_BACKUP_ID");
const EXPECTED_RESTORE_STARTED_AT = env("MOMOS_RECOVERY_STARTED_AT");
const RECOVERY_TARGET_AT = env("MOMOS_RECOVERY_TARGET_AT");
const RESTORED_THROUGH_AT = env("MOMOS_RECOVERY_RESTORED_THROUGH_AT");
const STORAGE_FINGERPRINT = env("MOMOS_STORAGE_MANIFEST_SHA256").toLowerCase();
const STORAGE_COUNT = Number(env("MOMOS_STORAGE_OBJECT_COUNT"));
const REPLAY_FINGERPRINT = env("MOMOS_REPLAY_RECEIPT_SHA256").toLowerCase();
const REPLAY_COUNT = Number(env("MOMOS_REPLAYED_EVENT_COUNT"));

function isSupabaseServerKey(value) {
  if (value.startsWith("sb_secret_")) return true;
  if (value.startsWith("sb_publishable_")) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role";
  } catch {
    return false;
  }
}

function parseInstant(value, code) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(code);
  return parsed;
}

function deterministicUuid(input) {
  const bytes = Buffer.from(createHash("sha256").update(input).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validatePrivateContract() {
  if (env("MOMOS_RECOVERY_ENVIRONMENT") !== "RESTORED_ISOLATED_STAGING") {
    throw new Error("RECOVERY_ISOLATION_NOT_CONFIRMED");
  }
  if (env("MOMOS_REPLAY_CONFIRMATION") !== "REPLAY_COMPLETED_IDEMPOTENTLY") {
    throw new Error("RECOVERY_REPLAY_NOT_CONFIRMED");
  }
  if (env("MOMOS_STORAGE_CONFIRMATION") !== "STORAGE_OBJECTS_RESTORED_AND_HASHED") {
    throw new Error("RECOVERY_STORAGE_NOT_CONFIRMED");
  }
  if (!/^[a-z0-9]{20}$/.test(PRODUCTION_REF) || !/^[a-z0-9]{20}$/.test(STAGING_REF)
      || PRODUCTION_REF === STAGING_REF) {
    throw new Error("RECOVERY_PROJECT_ISOLATION_INVALID");
  }
  if (PRODUCTION_URL !== `https://${PRODUCTION_REF}.supabase.co`
      || STAGING_URL !== `https://${STAGING_REF}.supabase.co`) {
    throw new Error("RECOVERY_PROJECT_URL_INVALID");
  }
  if (!isSupabaseServerKey(PRODUCTION_KEY) || !MANAGEMENT_TOKEN || BACKUP_ID.length < 3) {
    throw new Error("RECOVERY_PRIVATE_ENV_INVALID");
  }
  if (!/^[0-9a-f]{64}$/.test(STORAGE_FINGERPRINT) || !Number.isSafeInteger(STORAGE_COUNT)
      || STORAGE_COUNT <= 0) {
    throw new Error("RECOVERY_STORAGE_MANIFEST_INVALID");
  }
  if (!/^[0-9a-f]{64}$/.test(REPLAY_FINGERPRINT) || !Number.isSafeInteger(REPLAY_COUNT)
      || REPLAY_COUNT < 0) {
    throw new Error("RECOVERY_REPLAY_RECEIPT_INVALID");
  }
  const target = parseInstant(RECOVERY_TARGET_AT, "RECOVERY_TARGET_AT_INVALID");
  const restored = parseInstant(RESTORED_THROUGH_AT, "RECOVERY_RESTORED_THROUGH_AT_INVALID");
  const expectedStarted = EXPECTED_RESTORE_STARTED_AT
    ? parseInstant(EXPECTED_RESTORE_STARTED_AT, "RECOVERY_STARTED_AT_INVALID")
    : null;
  if (!(restored <= target && target <= (expectedStarted ?? Date.now() + 60_000))) {
    throw new Error("RECOVERY_TIMELINE_INVALID");
  }
}

async function readExactManagedBackup() {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PRODUCTION_REF}/database/backups`,
    {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${MANAGEMENT_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`RECOVERY_BACKUP_MANAGEMENT_HTTP_${response.status}`);
  const result = await response.json();
  const backup = (Array.isArray(result?.backups) ? result.backups : [])
    .find((item) => String(item?.id || "") === BACKUP_ID);
  if (!backup || String(backup.status || "").toUpperCase() !== "COMPLETED" || !backup.inserted_at) {
    throw new Error("RECOVERY_EXACT_BACKUP_NOT_COMPLETED");
  }
  const completedAt = new Date(backup.inserted_at).toISOString();
  if (Date.parse(completedAt) > Date.parse(RESTORED_THROUGH_AT)) {
    throw new Error("RECOVERY_BACKUP_NEWER_THAN_RESTORED_DATA");
  }
  return {
    backupKey: `supabase-${BACKUP_ID}`,
    completedAt,
    pitrEnabled: Boolean(result?.pitr_enabled),
    regionCode: String(result?.region || "unknown").toLowerCase(),
  };
}

function postgresLogTimestamp(value) {
  const microseconds = Number(value);
  if (!Number.isFinite(microseconds) || microseconds < 1_000_000_000_000_000) return null;
  const instant = new Date(Math.floor(microseconds / 1_000));
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}

async function readDerivedRestoreTimeline() {
  const projectResponse = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}`, {
    method: "GET",
    headers: { accept: "application/json", authorization: `Bearer ${MANAGEMENT_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!projectResponse.ok) throw new Error(`RECOVERY_STAGING_PROJECT_HTTP_${projectResponse.status}`);
  const project = await projectResponse.json();
  if (String(project?.id || project?.ref || "") !== STAGING_REF
      || String(project?.status || "") !== "ACTIVE_HEALTHY" || !project?.created_at) {
    throw new Error("RECOVERY_STAGING_PROJECT_INVALID");
  }
  const startedAt = new Date(project.created_at).toISOString();
  if (!Number.isFinite(Date.parse(startedAt))) throw new Error("RECOVERY_STAGING_STARTED_AT_INVALID");
  if (EXPECTED_RESTORE_STARTED_AT
      && Math.abs(Date.parse(EXPECTED_RESTORE_STARTED_AT) - Date.parse(startedAt)) > 1_000) {
    throw new Error("RECOVERY_STAGING_STARTED_AT_DIVERGED");
  }

  const logEnd = new Date(Date.parse(startedAt) + 30 * 60_000).toISOString();
  const logsUrl = new URL(
    `https://api.supabase.com/v1/projects/${STAGING_REF}/analytics/endpoints/logs.all`,
  );
  logsUrl.searchParams.set("iso_timestamp_start", startedAt);
  logsUrl.searchParams.set("iso_timestamp_end", logEnd);
  logsUrl.searchParams.set(
    "sql",
    "select timestamp,event_message from postgres_logs order by timestamp asc limit 500",
  );
  const logsResponse = await fetch(logsUrl, {
    method: "GET",
    headers: { accept: "application/json", authorization: `Bearer ${MANAGEMENT_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!logsResponse.ok) throw new Error(`RECOVERY_STAGING_LOGS_HTTP_${logsResponse.status}`);
  const logs = await logsResponse.json();
  if (logs?.error || !Array.isArray(logs?.result)) throw new Error("RECOVERY_STAGING_LOGS_INVALID");
  const completedAt = logs.result
    .filter((row) => /database system is ready to accept connections/i.test(String(row?.event_message || "")))
    .map((row) => postgresLogTimestamp(row?.timestamp))
    .filter(Boolean)
    .sort()[0];
  if (!completedAt || Date.parse(completedAt) < Date.parse(startedAt)
      || Date.parse(completedAt) > Date.parse(logEnd)) {
    throw new Error("RECOVERY_STAGING_READY_EVIDENCE_MISSING");
  }
  return { startedAt, completedAt };
}

async function main() {
  validatePrivateContract();
  const [backup, timeline] = await Promise.all([
    readExactManagedBackup(),
    readDerivedRestoreTimeline(),
  ]);
  if (Date.parse(RECOVERY_TARGET_AT) > Date.parse(timeline.startedAt)) {
    throw new Error("RECOVERY_TARGET_AFTER_RESTORE_STARTED");
  }
  const supabase = createClient(PRODUCTION_URL, PRODUCTION_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: observed, error: observationError } = await supabase.rpc(
    "registrar_observacion_backup_administrado_v1",
    { p: {
      backup_key: backup.backupKey,
      source: "Supabase",
      status: "Completado",
      completed_at: backup.completedAt,
      pitr_enabled: backup.pitrEnabled,
      region_code: backup.regionCode,
    } },
  );
  if (observationError || !observed?.ok) throw new Error("RECOVERY_BACKUP_OBSERVATION_FAILED");

  const completedAt = timeline.completedAt;
  const seed = [PRODUCTION_REF, BACKUP_ID, timeline.startedAt, RECOVERY_TARGET_AT].join(":");
  const drillId = deterministicUuid(seed);
  const drillKey = `recovery-${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
  const { data, error } = await supabase.rpc("registrar_simulacro_recuperacion_v1", {
    p: {
      id: drillId,
      drill_key: drillKey,
      backup_key: backup.backupKey,
      status: "Aprobado",
      started_at: timeline.startedAt,
      completed_at: completedAt,
      recovery_target_at: RECOVERY_TARGET_AT,
      restored_through_at: RESTORED_THROUGH_AT,
      checks: {
        inventory: true,
        migrations: true,
        orders: true,
        payments: true,
        receipts: true,
        replay: true,
        reservations: true,
        storage: true,
      },
      replay_status: "Completado",
      storage_manifest_fingerprint: STORAGE_FINGERPRINT,
      storage_object_count: STORAGE_COUNT,
      replay_receipt_fingerprint: REPLAY_FINGERPRINT,
      replayed_event_count: REPLAY_COUNT,
    },
  });
  if (error || !data?.ok || !data?.evidenceDerived || !data?.storageVerified) {
    throw new Error("RECOVERY_DRILL_REGISTRATION_FAILED");
  }
  process.stdout.write(
    `[Continuidad MOMOS] Recuperación registrada · RPO ${data.rpoMinutes} min · `
    + `RTO ${data.rtoMinutes} min · Storage verificado · ${data.certified ? "certificada" : "no certificada"}\n`,
  );
}

main().catch((error) => {
  const safeCode = /^[A-Z0-9_]+$/.test(String(error?.message || ""))
    ? error.message
    : "RECOVERY_RECORDER_FAILED";
  process.stderr.write(`[Continuidad MOMOS] ${safeCode}\n`);
  process.exitCode = 1;
});
