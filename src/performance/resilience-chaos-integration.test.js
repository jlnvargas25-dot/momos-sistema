import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../supabase/certificacion-concurrencia-caos-v1.sql", import.meta.url);
const runnerUrl = new URL("../../scripts/operational-resilience-runner.mjs", import.meta.url);
const orderedUrl = new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url);
const stagingWorkflowUrl = new URL("../../.github/workflows/staging-database-gate.yml", import.meta.url);
const governanceUrl = new URL("../../docs/MOMOS-CODE-GOVERNANCE.md", import.meta.url);

test("H94 aísla carga y caos del dominio comercial", async () => {
  const [migration, runner] = await Promise.all([
    readFile(migrationUrl, "utf8"), readFile(runnerUrl, "utf8"),
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
  assert.match(workflow, /01-94 PASS/);
  assert.match(workflow, /test-certificacion-concurrencia-caos-v1\.sql/);
  assert.match(workflow, /MOMOS_H94_ENVIRONMENT: Staging/);
  assert.match(workflow, /MOMOS_H94_ALLOW_STAGING: CERTIFY_NON_PRODUCTION/);
  assert.match(workflow, /status='Certificado'/);
  assert.match(workflow, /invariant_failures=0/);
  assert.match(governance, /STAGING_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(governance, /aceptación\s+ordenada 01–94/);
});
