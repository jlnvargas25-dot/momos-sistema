import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../supabase/certificacion-concurrencia-caos-v1.sql", import.meta.url);
const runnerUrl = new URL("../../scripts/operational-resilience-runner.mjs", import.meta.url);
const loadPlanUrl = new URL("../lib/resilience-load-plan.js", import.meta.url);
const orderedUrl = new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url);
const stagingWorkflowUrl = new URL("../../.github/workflows/staging-database-gate.yml", import.meta.url);
const governanceUrl = new URL("../../docs/MOMOS-CODE-GOVERNANCE.md", import.meta.url);
const h99EvidenceUrl = new URL("../../docs/H99-STAGING-LOAD-2026-07-22.json", import.meta.url);

test("H94 aísla carga y caos del dominio comercial", async () => {
  const [migration, runner, loadPlan] = await Promise.all([
    readFile(migrationUrl, "utf8"), readFile(runnerUrl, "utf8"), readFile(loadPlanUrl, "utf8"),
  ]);
  assert.match(migration, /operational_resilience_runs/);
  assert.match(migration, /IDEMPOTENT_REPLAY/);
  assert.match(migration, /LAST_UNIT_RACE/);
  assert.match(migration, /ATOMIC_ROLLBACK/);
  assert.match(migration, /Validado sintetico/);
  assert.match(migration, /environment='Staging'/);
  assert.doesNotMatch(runner, /crear_pedido|crear_corrida|entrada_insumo|set_order_status/);
  assert.match(runner, /businessMutation === false/);
  assert.match(runner, /MOMOS_H94_ALLOW_STAGING/);
  assert.match(runner, /createResilienceLoadPlan/);
  assert.match(loadPlan, /targetRequests - fixedRequestCount/);
  assert.match(runner, /idempotencyKeyCount \* 2/);
  assert.match(runner, /parallelReadCount/);
  assert.match(runner, /momos\.resilience\.staging\.v1/);
  assert.match(runner, /p99: percentile\(allTimings, 0\.99\)/);
});

test("H94 cierra migración, RBAC y cadena ordenada", async () => {
  const [migration, ordered] = await Promise.all([
    readFile(migrationUrl, "utf8"), readFile(orderedUrl, "utf8"),
  ]);
  assert.match(migration, /revoke all on table public\.%I from public,anon,authenticated,service_role/);
  assert.match(migration, /grant execute on function public\.iniciar_certificacion_resiliencia_v1\(jsonb\) to service_role/);
  assert.match(migration, /grant execute on function public\.momos_resilience_snapshot_v1\(\) to authenticated/);
  assert.match(ordered, /20260721_94_certificacion_concurrencia_caos/);
  assert.match(ordered, /migraciones ordenadas 01-94 PASS/);
});

test("el gate H94 de staging falla cerrado y nunca reutiliza producción", async () => {
  const [workflow, governance] = await Promise.all([
    readFile(stagingWorkflowUrl, "utf8"), readFile(governanceUrl, "utf8"),
  ]);
  assert.match(workflow, /test "\$STAGING_PROJECT_REF" != "\$PRODUCTION_PROJECT_REF"/);
  assert.match(workflow, /https:\/\/\$STAGING_PROJECT_REF\.supabase\.co/);
  assert.match(workflow, /secrets\.STAGING_SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(workflow, /secrets\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /01-104 PASS/);
  assert.match(workflow, /test-certificacion-concurrencia-caos-v1\.sql/);
  assert.match(workflow, /test-observabilidad-slo-v1\.sql/);
  assert.match(workflow, /MOMOS_H94_ENVIRONMENT: Staging/);
  assert.match(workflow, /MOMOS_H94_ALLOW_STAGING: CERTIFY_NON_PRODUCTION/);
  assert.match(workflow, /MOMOS_H94_CONCURRENCY: 64/);
  assert.match(workflow, /MOMOS_H94_TARGET_REQUESTS: 2000/);
  assert.match(workflow, /total_requests >= 2000/);
  assert.match(workflow, /status='Certificado'/);
  assert.match(workflow, /invariant_failures=0/);
  assert.match(governance, /STAGING_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(governance, /aceptación\s+ordenada 01–100/);
});

test("H99 conserva evidencia sanitaria de 2000 solicitudes reales", async () => {
  const report = JSON.parse(await readFile(h99EvidenceUrl, "utf8"));
  const serialized = JSON.stringify(report).toLowerCase();
  assert.equal(report.contract, "momos.resilience.staging.v1");
  assert.equal(report.environment, "Staging");
  assert.equal(report.concurrency, 64);
  assert.equal(report.targetRequests, 2000);
  assert.equal(report.actualRequests, 2000);
  assert.equal(report.scenarios.length, 8);
  assert.ok(report.scenarios.every((scenario) => scenario.passed && scenario.invariantFailures === 0));
  assert.equal(report.certificate.status, "Certificado");
  assert.equal(report.certificate.reconciled, true);
  assert.match(report.certificate.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(report.latencyMs.p99 <= 2000);
  assert.equal(report.businessMutation, false);
  assert.equal(report.containsCustomerPii, false);
  assert.equal(report.containsSecrets, false);
  assert.doesNotMatch(serialized, /"(?:customer|cliente|phone|telefono|address|direccion|email|secret|service_role|token)"/);
});
