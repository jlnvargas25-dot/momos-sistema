import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../supabase/inteligencia-creativa-publicitaria-v1.sql", import.meta.url);
const adversarialUrl = new URL("../../supabase/tests/test-inteligencia-creativa-publicitaria-v1.sql", import.meta.url);
const orderedUrl = new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url);
const workflowUrl = new URL("../../.github/workflows/staging-database-gate.yml", import.meta.url);
const mcpUrl = new URL("../../scripts/momos-agency-mcp.mjs", import.meta.url);
const panelUrl = new URL("../features/agency/AgencyFormulaLab.jsx", import.meta.url);

test("H103 reutiliza la identidad creativa y no duplica activos ni verdad comercial", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /references public\.agency_creative_versions/);
  assert.match(migration, /references public\.agency_retention_scripts/);
  assert.match(migration, /from public\.metrics_daily/);
  assert.match(migration, /from public\.orders o join public\.order_items/);
  assert.match(migration, /from public\.agency_meta_signal_snapshots/);
  assert.doesNotMatch(migration, /asset_url\s+text|storage_path\s+text|customer_id\s+text/);
});

test("H103 separa ROAS de plataforma, ROAS interno y retorno sobre margen", async () => {
  const [migration, panel] = await Promise.all([readFile(migrationUrl, "utf8"), readFile(panelUrl, "utf8")]);
  for (const field of ["platform_roas", "internal_roas", "contribution_return", "attribution_gap"]) {
    assert.ok(migration.includes(field), `Falta ${field}`);
  }
  assert.match(migration, /'attribution_is_causality',false/);
  assert.match(panel, /ROAS plataforma/);
  assert.match(panel, /ROAS interno/);
  assert.match(panel, /Retorno margen/);
  assert.match(panel, /sin fabricar el dato faltante/);
});

test("H103 obliga aprobación humana y deja a Codex en proponer/consultar", async () => {
  const [migration, mcp] = await Promise.all([readFile(migrationUrl, "utf8"), readFile(mcpUrl, "utf8")]);
  assert.match(migration, /human_approval_required/);
  assert.match(migration, /No hay dos pedidos pagados y ROAS interno mínimo de 2/);
  assert.match(migration, /grant execute on function public\.proponer_formula_creativa_agente_v1\(jsonb\)\s+to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.revisar_formula_creativa_v1[^;]+service_role/s);
  assert.match(mcp, /momos_creative_intelligence/);
  assert.match(mcp, /momos_propose_creative_formula/);
  assert.match(mcp, /Nunca la aprueba, publica, pauta o ejecuta/);
});

test("H103 queda encadenado y probado en staging sin tocar producción", async () => {
  const [adversarial, ordered, workflow] = await Promise.all([
    readFile(adversarialUrl, "utf8"), readFile(orderedUrl, "utf8"), readFile(workflowUrl, "utf8"),
  ]);
  assert.match(adversarial, /^begin;/m);
  assert.match(adversarial, /rollback;\s*$/);
  assert.match(adversarial, /fabricó una ganadora sin ventas pagadas/);
  assert.match(adversarial, /permitió falsificar la verdad comercial/);
  assert.match(ordered, /20260722_103_inteligencia_creativa_publicitaria/);
  assert.match(ordered, /01-103 PASS/);
  assert.match(workflow, /inteligencia-creativa-publicitaria-v1\.sql/);
  assert.match(workflow, /test-inteligencia-creativa-publicitaria-v1\.sql/);
  assert.match(workflow, /STAGING_PROJECT_REF.*!=.*PRODUCTION_PROJECT_REF/is);
});
