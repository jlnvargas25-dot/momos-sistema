import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("H109 separa autorización humana, permiso temporal y consumo real", async () => {
  const migration = await read("../../supabase/piloto-generacion-controlado-v1.sql");
  assert.match(migration, /20260722_109_piloto_generacion_controlado/);
  assert.match(migration, /create table if not exists public\.agency_generation_pilots/);
  assert.match(migration, /create unique index[^;]+status='Armado'/s);
  assert.match(migration, /create or replace function public\.armar_piloto_generacion_v1\(p jsonb\)/);
  assert.match(migration, /create trigger agency_generation_pilot_run_guard before insert on public\.creative_connector_runs/);
  assert.match(migration, /human_review_required[^\n]+true/);
  assert.match(migration, /publication_allowed[^\n]+false/);
  assert.doesNotMatch(migration, /fetch\s*\(|https?:\/\//i);
});

test("H109 impide que el worker general tome trabajos protegidos y reserva un worker piloto", async () => {
  const [migration, higgsfield, kling, pkg] = await Promise.all([
    read("../../supabase/piloto-generacion-controlado-v1.sql"),
    read("../../scripts/higgsfield-worker.mjs"),
    read("../../scripts/kling-worker.mjs"),
    read("../../package.json"),
  ]);
  assert.match(migration, /reclamar_trabajo_creativo_general_v1/);
  assert.match(migration, /reclamar_piloto_generacion_v1/);
  assert.match(migration, /and not exists\(select 1 from public\.agency_formula_generation_authorizations/);
  for (const worker of [higgsfield, kling]) {
    assert.match(worker, /process\.argv\.includes\("--pilot"\)/);
    assert.match(worker, /reclamar_trabajo_creativo_general_v1/);
    assert.match(worker, /reclamar_piloto_generacion_v1/);
    assert.match(worker, /`pilot:\$\{WORKER_ID\}`/);
  }
  assert.match(pkg, /worker:higgsfield:pilot:once/);
  assert.match(pkg, /worker:kling:pilot:once/);
});

test("H109 expone al humano solo lectura segura y acciones explícitas", async () => {
  const [panel, readModel, rpc, mcp] = await Promise.all([
    read("../features/agency/AgencyFormulaLab.jsx"),
    read("../lib/read-model.js"),
    read("../lib/rpc.js"),
    read("../../scripts/momos-agency-mcp.mjs"),
  ]);
  assert.match(panel, /Armar piloto de 1 pieza/);
  assert.match(panel, /Armar no consume créditos; ejecutar el worker piloto sí puede consumirlos/);
  assert.match(panel, /Cancelar piloto/);
  assert.match(readModel, /momos_generation_pilots_v1/);
  assert.match(rpc, /armar_piloto_generacion_v1/);
  assert.match(rpc, /cancelar_piloto_generacion_v1/);
  assert.match(mcp, /registerTool\("momos_generation_pilots"/);
  assert.match(mcp, /Nunca arma pilotos, reclama workers, consume créditos ni publica/);
});

test("H109 tiene adversarial, cadena ordenada y gate remoto", async () => {
  const [adversarial, ordered, workflow] = await Promise.all([
    read("../../supabase/tests/test-piloto-generacion-controlado-v1.sql"),
    read("../../supabase/tests/test-migraciones-ordenadas.sql"),
    read("../../.github/workflows/staging-database-gate.yml"),
  ]);
  assert.match(adversarial, /^begin;/m);
  assert.match(adversarial, /rollback;\s*$/);
  assert.match(adversarial, /nunca llama proveedores/i);
  assert.match(adversarial, /consumió, generó o autorizó publicación/i);
  assert.match(ordered, /20260722_109_piloto_generacion_controlado/);
  assert.match(ordered, /migraciones ordenadas 01-111 PASS/);
  assert.match(workflow, /piloto-generacion-controlado-v1\.sql/);
  assert.match(workflow, /test-piloto-generacion-controlado-v1\.sql/);
  assert.match(workflow, /01-111 PASS/);
  assert.match(workflow, /STAGING_PROJECT_REF.*!=.*PRODUCTION_PROJECT_REF/is);
});

test("H109 conserva un recibo de staging sin fingir generación real", async () => {
  const receipt = JSON.parse(await read("../../docs/H109-STAGING-GENERATION-PILOT-2026-07-22.json"));
  const serialized = JSON.stringify(receipt).toLowerCase();
  assert.equal(receipt.environment, "Staging");
  assert.equal(receipt.migration.applied, true);
  assert.equal(receipt.acceptance.orderedMigrations01To109, "PASS_WITH_ROLLBACK");
  assert.equal(receipt.runtime.persistedPilots, 0);
  assert.equal(receipt.runtime.activePilots, 0);
  assert.equal(receipt.runtime.pilotConnectorRuns, 0);
  assert.equal(receipt.runtime.creditsConsumedDuringCertification, false);
  assert.equal(receipt.runtime.providerCalledDuringCertification, false);
  assert.equal(receipt.runtime.publicationAllowed, false);
  assert.equal(receipt.productionVerification.h109Applied, false);
  assert.equal(receipt.productionVerification.mutated, false);
  assert.doesNotMatch(serialized, /api[_-]?key|service[_-]?role|bearer |access[_-]?token/);
});
