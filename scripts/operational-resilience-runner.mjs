import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createSyncCoordinator, SYNC_DOMAINS } from "../src/lib/sync-coordinator.js";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const ENVIRONMENT = String(process.env.MOMOS_H94_ENVIRONMENT || "Sintetico").trim();
const CONCURRENCY = Math.max(8, Math.min(64, Number(process.env.MOMOS_H94_CONCURRENCY || 16)));
const TARGET_REQUESTS = Math.max(100, Number(process.env.MOMOS_H94_TARGET_REQUESTS || 150));
const RUNNER_VERSION = "h94-runner-1";

function isServerKey(value) {
  if (/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(value)) return true;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role"; }
  catch { return false; }
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)) {
  throw new Error("SUPABASE_URL debe ser la URL HTTPS valida del proyecto.");
}
if (!isServerKey(SERVICE_KEY)) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY debe ser privada; nunca uses publishable/anon.");
}
if (!["Sintetico", "Staging"].includes(ENVIRONMENT)) {
  throw new Error("MOMOS_H94_ENVIRONMENT solo admite Sintetico o Staging.");
}
if (ENVIRONMENT === "Staging" && process.env.MOMOS_H94_ALLOW_STAGING !== "CERTIFY_NON_PRODUCTION") {
  throw new Error("Staging exige MOMOS_H94_ALLOW_STAGING=CERTIFY_NON_PRODUCTION.");
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { "x-momos-worker": RUNNER_VERSION } },
});

const timings = new Map();
const recordTiming = (scenario, duration) => {
  if (!timings.has(scenario)) timings.set(scenario, []);
  timings.get(scenario).push(duration);
};
const percentile = (values, pct = 0.95) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return Number(ordered[Math.max(0, Math.ceil(ordered.length * pct) - 1)].toFixed(2));
};

async function rpc(name, args, scenario = "CONTROL") {
  const started = performance.now();
  const { data, error } = await supabase.rpc(name, args);
  recordTiming(scenario, performance.now() - started);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function batches(values, size, work) {
  const results = [];
  for (let offset = 0; offset < values.length; offset += size) {
    results.push(...await Promise.all(values.slice(offset, offset + size).map(work)));
  }
  return results;
}

const runKey = `h94-${ENVIRONMENT.toLowerCase()}-${Date.now()}-${randomUUID().slice(0, 8)}`;
const start = await rpc("iniciar_certificacion_resiliencia_v1", { p: {
  run_key: runKey,
  environment: ENVIRONMENT,
  runner_version: RUNNER_VERSION,
  concurrency: CONCURRENCY,
  target_request_count: TARGET_REQUESTS,
  ...(ENVIRONMENT === "Staging" ? { staging_confirmation: "CERTIFY_NON_PRODUCTION" } : {}),
} });
const runId = start?.runId;
if (!runId) throw new Error("H94 no devolvio runId.");

const scenarios = [];
const addScenario = (code, passed, requestCount, duplicateCount = 0, conflictCount = 0, invariantFailures = 0) => {
  scenarios.push({
    code, passed: Boolean(passed), requestCount, duplicateCount, conflictCount,
    p95Ms: percentile(timings.get(code) || []), invariantFailures,
  });
};

// 40 escrituras se envian dos veces con la misma clave. Debe existir un solo efecto por clave.
const idempotencyKeys = Array.from({ length: 40 }, (_, index) => ({ key: randomUUID(), index: index + 1 }));
const idempotencyPairs = await batches(idempotencyKeys, Math.max(4, Math.floor(CONCURRENCY / 2)), async ({ key, index }) => {
  const payload = { run_id: runId, operation_code: "IDEMPOTENT_WRITE", idempotency_key: key,
    payload: { sequence: index, kind: "synthetic" } };
  return Promise.all([
    rpc("probar_idempotencia_resiliencia_v1", { p: payload }, "IDEMPOTENT_REPLAY"),
    rpc("probar_idempotencia_resiliencia_v1", { p: payload }, "IDEMPOTENT_REPLAY"),
  ]);
});
const idempotencyOk = idempotencyPairs.every((pair) =>
  pair.filter((entry) => entry?.duplicate === false).length === 1
  && pair.filter((entry) => entry?.duplicate === true).length === 1
  && pair[0]?.sequence === pair[1]?.sequence);
addScenario("IDEMPOTENT_REPLAY", idempotencyOk, 80, 40, 0, idempotencyOk ? 0 : 1);

// Se descarta deliberadamente la primera respuesta y se reintenta la misma solicitud.
let lostResponseOk = true;
for (let index = 1; index <= 5; index += 1) {
  const key = randomUUID();
  const payload = { run_id: runId, operation_code: "LOST_RESPONSE_RETRY", idempotency_key: key,
    payload: { sequence: index, kind: "discarded-response" } };
  await rpc("probar_idempotencia_resiliencia_v1", { p: payload }, "LOST_RESPONSE_RETRY");
  const retried = await rpc("probar_idempotencia_resiliencia_v1", { p: payload }, "LOST_RESPONSE_RETRY");
  lostResponseOk &&= retried?.duplicate === true;
}
addScenario("LOST_RESPONSE_RETRY", lostResponseOk, 10, 5, 0, lostResponseOk ? 0 : 1);

const contenders = Array.from({ length: CONCURRENCY }, (_, index) => `tablet-${index + 1}`);
const lastUnit = await Promise.all(contenders.map((contender_id) => rpc(
  "probar_ultima_unidad_resiliencia_v1", { p: { run_id: runId, contender_id } }, "LAST_UNIT_RACE"
)));
const lastUnitWinners = lastUnit.filter((entry) => entry?.acquired === true).length;
addScenario("LAST_UNIT_RACE", lastUnitWinners === 1, contenders.length, 0,
  contenders.length - lastUnitWinners, lastUnitWinners === 1 ? 0 : 1);

const leases = await Promise.all(contenders.map((_, index) => rpc(
  "probar_lease_resiliencia_v1", { p: { run_id: runId, worker_id: `worker-${index + 1}` } }, "LEASE_CONTENTION"
)));
const leaseWinners = leases.filter((entry) => entry?.acquired === true).length;
addScenario("LEASE_CONTENTION", leaseWinners === 1, contenders.length, 0,
  contenders.length - leaseWinners, leaseWinners === 1 ? 0 : 1);

let controlledRollback = false;
const rollbackStarted = performance.now();
const rollbackResponse = await supabase.rpc("probar_atomicidad_resiliencia_v1", { p: {
  run_id: runId, attempt_id: "forced-rollback", force_failure: true,
} });
recordTiming("ATOMIC_ROLLBACK", performance.now() - rollbackStarted);
controlledRollback = Boolean(rollbackResponse.error?.message?.includes("H94_CONTROLLED_ROLLBACK"));
const afterRollback = await rpc("momos_resilience_probe_snapshot_v1", { p_run: runId }, "ATOMIC_ROLLBACK");
const rollbackClean = Number(afterRollback?.resources?.ATOMIC_COUNTER?.counter) === 0;
await rpc("probar_atomicidad_resiliencia_v1", { p: {
  run_id: runId, attempt_id: "successful-commit", force_failure: false,
} }, "ATOMIC_ROLLBACK");
addScenario("ATOMIC_ROLLBACK", controlledRollback && rollbackClean, 3, 0, 1,
  controlledRollback && rollbackClean ? 0 : 1);

const parallelReads = await batches(Array.from({ length: 40 }), CONCURRENCY, () => rpc(
  "momos_resilience_probe_snapshot_v1", { p_run: runId }, "PARALLEL_READS"
));
const parallelReadsOk = parallelReads.every((entry) => entry?.isolated === true && entry?.businessMutation === false);
addScenario("PARALLEL_READS", parallelReadsOk, 40, 0, 0, parallelReadsOk ? 0 : 1);

let releaseFirst;
const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
let localLoads = 0;
const coordinator = createSyncCoordinator({
  loaders: { [SYNC_DOMAINS.OPERATIONS]: async () => {
    localLoads += 1;
    if (localLoads === 1) await firstGate;
    return { syncServerTime: new Date().toISOString(), version: localLoads };
  } },
  apply: async () => {},
});
const realtimeStarted = performance.now();
const firstRefresh = coordinator.request(SYNC_DOMAINS.OPERATIONS);
for (let index = 0; index < 19; index += 1) {
  coordinator.request(SYNC_DOMAINS.OPERATIONS, { reason: "h94-realtime", afterActive: true });
}
releaseFirst();
await firstRefresh;
recordTiming("REALTIME_COALESCING", performance.now() - realtimeStarted);
const realtimeSnapshot = coordinator.snapshot();
const realtimeOk = localLoads === 2 && realtimeSnapshot.counters.requests === 20
  && realtimeSnapshot.counters.deduplicated >= 18;
addScenario("REALTIME_COALESCING", realtimeOk, 20, realtimeSnapshot.counters.deduplicated, 0,
  realtimeOk ? 0 : 1);

const reconciliation = await rpc("momos_resilience_probe_snapshot_v1", { p_run: runId }, "FINAL_RECONCILIATION");
const resources = reconciliation?.resources || {};
const reconciled = Number(resources?.LAST_UNIT?.available) === 0
  && Number(resources?.LAST_UNIT?.consumed) === 1
  && resources?.LEASE?.owned === true
  && Number(resources?.ATOMIC_COUNTER?.counter) === 1
  && Number(resources?.IDEMPOTENCY_COUNTER?.counter) === Number(reconciliation?.receiptCount)
  && Number(reconciliation?.receiptCount) === 45;
addScenario("FINAL_RECONCILIATION", reconciled, 1, 0, 0, reconciled ? 0 : 1);

await rpc("registrar_resultados_resiliencia_v1", { p: { run_id: runId, scenarios } });
const final = await rpc("finalizar_certificacion_resiliencia_v1", { p_run: runId });
const allPassed = scenarios.every((scenario) => scenario.passed && scenario.invariantFailures === 0);
const expectedStatus = ENVIRONMENT === "Staging" ? "Certificado" : "Validado sintetico";
if (!allPassed || final?.status !== expectedStatus || final?.reconciled !== true) {
  throw new Error(`H94 fallo cerrado · estado ${final?.status || "desconocido"} · corrida ${runKey}`);
}

console.log(`[H94] ${final.status} · ${final.totalRequests} solicitudes · p95 ${final.p95Ms} ms · 0 invariantes rotas`);
console.log(`[H94] Dominio sintetico aislado · corrida ${runKey} · no se tocaron pedidos, stock ni finanzas`);
