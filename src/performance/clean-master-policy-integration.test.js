import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../../supabase/politica-maestro-visual-limpio-v1.sql");
const adversarial = read("../../supabase/tests/test-politica-maestro-visual-limpio-v1.sql");
const ordered = read("../../supabase/tests/test-migraciones-ordenadas.sql");
const workflow = read("../../.github/workflows/staging-database-gate.yml");
const panel = read("../features/agency/AgencyBrandStudio.jsx");
const readModel = read("../lib/read-model.js");
const mcp = read("../lib/visual-library.js");

test("H111 conserva el original y exige linaje en la restauración canónica", () => {
  assert.match(migration, /Original con escarcha' and new\.canonical/);
  assert.match(migration, /source_quality='Restaurado' and v_original is null/);
  assert.match(migration, /brand_clean_master_profile_guard/);
  assert.match(adversarial, /permitió un máster restaurado sin vínculo al original/);
});

test("H111 permite uso artístico pero bloquea generación y Elements", () => {
  assert.match(migration, /v_digital:=v_common/);
  assert.match(migration, /v_image:=v_common\|\|v_ai_blockers/);
  assert.match(migration, /v_video:=v_common\|\|v_ai_blockers/);
  assert.match(adversarial, /Variante artística/);
  assert.match(adversarial, /usage_readiness,digital_content,ready/);
});

test("UI, read model y MCP comparten la misma clasificación", () => {
  assert.match(panel, /Protocolo anti-escarcha/);
  assert.match(panel, /Másteres limpios/);
  assert.match(readModel, /biblioteca_maestro_limpio_disponible/);
  assert.match(readModel, /cleanMasterState/);
  assert.match(mcp, /CLEAN_MASTER_CLASSES/);
  assert.match(mcp, /clean_master_policy_version/);
});

test("H111 está cerrado por aceptación ordenada y staging", () => {
  assert.match(ordered, /20260722_111_politica_maestro_visual_limpio/);
  assert.match(ordered, /01-111 PASS/);
  assert.match(workflow, /politica-maestro-visual-limpio-v1\.sql/);
  assert.match(workflow, /test-politica-maestro-visual-limpio-v1\.sql/);
  assert.match(workflow, /01-111 PASS/);
});
