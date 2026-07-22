import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const env = (name) => String(process.env[name] || "").trim();
const SOURCE_REF = env("PRODUCTION_PROJECT_REF");
const TARGET_REF = env("STAGING_PROJECT_REF");
const BACKUP_ID = env("MOMOS_RECOVERY_BACKUP_ID");
const RECOVERY_TARGET_AT = env("MOMOS_RECOVERY_TARGET_AT");
const RESTORED_THROUGH_AT = env("MOMOS_RECOVERY_RESTORED_THROUGH_AT");
const RESULT_PATH = env("MOMOS_REPLAY_RESULT_PATH");

function exactInstant(value, code) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(code);
  return new Date(parsed).toISOString();
}

function validateContract() {
  if (!/^[a-z0-9]{20}$/.test(SOURCE_REF) || !/^[a-z0-9]{20}$/.test(TARGET_REF)
      || SOURCE_REF === TARGET_REF) {
    throw new Error("REPLAY_PROJECT_ISOLATION_INVALID");
  }
  if (BACKUP_ID.length < 3 || !RESULT_PATH) throw new Error("REPLAY_PRIVATE_ENV_INVALID");
  const target = exactInstant(RECOVERY_TARGET_AT, "REPLAY_TARGET_INVALID");
  const restored = exactInstant(RESTORED_THROUGH_AT, "REPLAY_RESTORED_THROUGH_INVALID");
  if (target !== restored) throw new Error("REPLAY_WINDOW_REQUIRES_EVENT_LEDGER");
  return { target, restored };
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function main() {
  const { target, restored } = validateContract();
  const receipt = {
    contract: "momos.replay-receipt.v1",
    sourceProject: SOURCE_REF,
    targetProject: TARGET_REF,
    backupId: BACKUP_ID,
    recoveryTargetAt: target,
    restoredThroughAt: restored,
    replayedEventCount: 0,
    status: "NO_POST_BACKUP_EVENTS_IN_TARGET_WINDOW",
  };
  const result = {
    ok: true,
    contract: receipt.contract,
    receiptSha256: sha256(JSON.stringify(receipt)),
    replayedEventCount: 0,
    status: receipt.status,
  };
  await writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(`[Continuidad MOMOS] Replay sellado · 0 eventos · ventana exacta del backup\n`);
}

main().catch(async (error) => {
  const safeCode = /^[A-Z0-9_]+$/.test(String(error?.message || ""))
    ? error.message
    : "REPLAY_RECEIPT_FAILED";
  if (RESULT_PATH) {
    await writeFile(RESULT_PATH, `${JSON.stringify({ ok: false, error: safeCode }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    }).catch(() => {});
  }
  process.stderr.write(`[Continuidad MOMOS] ${safeCode}\n`);
  process.exitCode = 1;
});
