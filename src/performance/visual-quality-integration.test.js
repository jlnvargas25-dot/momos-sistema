import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../../supabase/calidad-maestra-biblioteca-ia-v1.sql");
const adversarial = read("../../supabase/tests/test-calidad-maestra-biblioteca-ia-v1.sql");
const ordered = read("../../supabase/tests/test-migraciones-ordenadas.sql");
const workflow = read("../../.github/workflows/staging-database-gate.yml");
const runtime = read("../../scripts/momos-agency-mcp.mjs");
const panel = read("../features/agency/AgencyBrandStudio.jsx");
const readModel = read("../lib/read-model.js");

test("H110 conserva el original y versiona una evidencia humana cerrada", () => {
  assert.match(migration, /brand_visual_quality_assessments/);
  assert.match(migration, /brand_visual_quality_assessment_immutable/);
  assert.match(migration, /source_fingerprint/);
  assert.match(migration, /original_mutated',false/);
  assert.match(adversarial, /H110 original inmutable/);
});

test("H110 separa permiso de IA de aptitud para imagen, video y Element", () => {
  assert.match(migration, /Contenido digital/);
  assert.match(migration, /Generación de imagen/);
  assert.match(migration, /Generación de video/);
  assert.match(migration, /Element/);
  assert.match(migration, /Falta una vista frontal apta/);
  assert.match(migration, /El Element requiere una vista trasera apta/);
});

test("la calidad se revalida en preflight, autorización y reclamo del worker", () => {
  assert.match(migration, /agency_formula_plan_visual_quality_guard/);
  assert.match(migration, /agency_formula_authorization_visual_quality_guard/);
  assert.match(migration, /creative_job_visual_quality_guard/);
  assert.match(migration, /credits_consumed',false/);
  assert.match(migration, /external_execution_allowed',false/);
});

test("MCP y Agencia exponen aptitud sin confundirla con derechos", () => {
  assert.match(runtime, /targetUse/);
  assert.match(runtime, /Generación de video/);
  assert.match(panel, /Derechos listos/);
  assert.match(panel, /Calidad maestra para IA/);
  assert.match(panel, /Subir versión mejorada/);
  assert.match(readModel, /biblioteca_calidad_ia_read_model_v1/);
  assert.match(readModel, /visualQualityReady/);
});

test("H110 pertenece a la cadena y al gate aislado de staging", () => {
  assert.match(ordered, /20260722_110_calidad_maestra_biblioteca_ia/);
  assert.match(ordered, /01-110 PASS/);
  assert.match(workflow, /calidad-maestra-biblioteca-ia-v1\.sql/);
  assert.match(workflow, /test-calidad-maestra-biblioteca-ia-v1\.sql/);
  assert.match(workflow, /01-110 PASS/);
});
