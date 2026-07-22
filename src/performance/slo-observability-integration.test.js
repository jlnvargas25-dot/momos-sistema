import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("H95 agrega SLO sin conservar eventos, rutas ni PII", async () => {
  const sql = await read("supabase/observabilidad-slo-v1.sql");
  for (const marker of [
    "operational_slo_policies", "operational_slo_buckets", "operational_slo_ingest_receipts",
    "registrar_telemetria_slo_v1", "momos_operational_slo_snapshot_v1",
    "histogram-upper-bound", "errorBudget", "containsCustomerPii", "containsSecrets",
  ]) assert.match(sql, new RegExp(marker));
  assert.match(sql, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(sql, /jsonb_object_keys\(p\)/);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*momos-h95-slo/);
  assert.doesNotMatch(sql, /request_path|customer_id|actor_id|email|telefono|direcci[oó]n/i);
});

test("el monitor 1.2 reporta salud, base, conectores y evalúa alertas", async () => {
  const worker = await read("scripts/operational-health-worker.mjs");
  assert.match(worker, /momos-operational-health-worker\/1\.2\.1/);
  assert.match(worker, /registrar_telemetria_slo_v1/);
  assert.match(worker, /reportSlo\("HEALTH_MONITOR"/);
  assert.match(worker, /obtener_sonda_slo_servidor_v1/);
  assert.match(worker, /evaluar_alertas_slo_v1/);
  assert.match(worker, /idempotency_key: stableUuid\(/);
  assert.match(worker, /PROCESS_RUN_ID = randomUUID\(\)/);
  assert.match(worker, /receiptSequence = \+\+reportSequence/);
  assert.doesNotMatch(worker, /WORKER_ID\}\|\$\{serviceCode\}\|\$\{bucketAt/);
  assert.match(worker, /Math\.floor\(Date\.now\(\) \/ 60_000\)/);
  assert.match(worker, /latency_buckets: latencyHistogram/);
  assert.doesNotMatch(worker, /p:\s*\{[^}]*message/s);
});

test("H96 conecta agregación cliente, sondas, alertas y UI sin PII", async () => {
  const [sql, rpc, app, panel, reporter] = await Promise.all([
    read("supabase/telemetria-operativa-alertas-v1.sql"),
    read("src/lib/rpc.js"), read("src/MomosOps.jsx"),
    read("src/features/backoffice/BusinessPanels.jsx"),
    read("src/performance/runtime-slo-reporter.js"),
  ]);
  for (const marker of [
    "registrar_lote_telemetria_cliente_slo_v1", "operational_slo_alerts",
    "obtener_sonda_slo_servidor_v1", "evaluar_alertas_slo_v1",
    "containsCustomerPii", "containsSecrets", "containsFreeText",
  ]) assert.match(sql, new RegExp(marker));
  assert.match(rpc, /reportClientSloTelemetry/);
  assert.match(app, /createRuntimeSloReporter/);
  assert.match(app, /recordRealtime/);
  assert.match(panel, /data-testid="operational-slo-alerts"/);
  assert.match(reporter, /OPS_FRONTEND[\s\S]*RPC_CORE[\s\S]*STORAGE[\s\S]*REALTIME/);
  assert.doesNotMatch(reporter, /customer_id|actor_id|email|telefono|direcci[oó]n|request_path/i);
});

test("Configuración muestra SLO dentro del Centro de Salud existente", async () => {
  const [rpc, app, panel] = await Promise.all([
    read("src/lib/rpc.js"), read("src/MomosOps.jsx"),
    read("src/features/backoffice/BusinessPanels.jsx"),
  ]);
  assert.match(rpc, /momos_operational_slo_snapshot_v1/);
  assert.match(rpc, /momos\.operational-slo\.v1/);
  assert.match(rpc, /pendingActivation: true/);
  assert.match(app, /fetchOperationalSloSnapshot/);
  assert.match(panel, /data-testid="operational-slo-center"/);
  assert.match(panel, /Nivel de servicio · última hora/);
  assert.doesNotMatch(panel, /operational_slo_(?:policies|buckets|ingest_receipts)/);
});

test("H95 queda en la aceptación y en el gate aislado de staging", async () => {
  const [ordered, workflow, contracts] = await Promise.all([
    read("supabase/tests/test-migraciones-ordenadas.sql"),
    read(".github/workflows/staging-database-gate.yml"),
    read("scripts/verify-repository-contracts.mjs"),
  ]);
  assert.match(ordered, /20260721_95_observabilidad_slo/);
  assert.match(ordered, /migraciones ordenadas 01-95 PASS/);
  assert.match(workflow, /test-observabilidad-slo-v1\.sql/);
  assert.match(workflow, /01-106 PASS/);
  assert.match(contracts, /test-observabilidad-slo-v1\.sql/);
});
