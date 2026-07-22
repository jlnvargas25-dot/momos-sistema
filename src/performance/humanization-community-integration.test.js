import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../../supabase/humanizacion-comunidad-v1.sql");
const adversarial = read("../../supabase/tests/test-humanizacion-comunidad-v1.sql");
const panel = read("../features/agency/AgencyHumanizationHub.jsx");
const agency = read("../features/agency/AgencyPanel.jsx");
const model = read("../lib/read-model.js");
const mcp = read("../../scripts/momos-agency-mcp.mjs");
const workflow = read("../../.github/workflows/staging-database-gate.yml");
const ordered = read("../../supabase/tests/test-migraciones-ordenadas.sql");

test("H105 reutiliza Biblioteca, publicaciones, métricas y fórmulas sin crear otro silo", () => {
  assert.match(migration, /references public\.brand_production_packs/);
  assert.match(migration, /references public\.agency_creative_formulas/);
  assert.match(migration, /references public\.content_posts/);
  assert.match(migration, /from public\.metrics_daily where post_id=v_post\.id/);
  assert.doesNotMatch(migration, /create table if not exists public\.(customers|brand_media_assets|metrics_daily)/);
});

test("H105 conserva únicamente señales agregadas y consentimiento verificable", () => {
  assert.match(migration, /comments_total integer/);
  assert.match(migration, /meaningful_comments integer/);
  assert.match(migration, /contains_raw_comments',false/);
  assert.match(migration, /consent_status='Autorizado'/);
  assert.match(migration, /rights_status='Autorizado'/);
  assert.doesNotMatch(migration, /\b(comment_text|raw_comment|user_handle|profile_url|direct_message)\s+(?:text|jsonb)/);
  assert.match(adversarial, /PII|consentimiento|comentario crudo/i);
});

test("Codex propone y consulta, mientras las decisiones permanecen humanas", () => {
  assert.match(mcp, /momos_humanization_community/);
  assert.match(mcp, /momos_propose_humanization_series/);
  assert.match(mcp, /momos_propose_humanization_episode/);
  assert.doesNotMatch(mcp, /momos_approve_humanization|momos_reply_community/);
  assert.match(migration, /can_approve',false/);
  assert.match(migration, /can_reply',false/);
  assert.match(migration, /external_execution_allowed',false/);
});

test("la interfaz carga bajo demanda y expone los cuatro recorridos humanos", () => {
  assert.match(agency, /lazy\(\(\) => import\("\.\/AgencyHumanizationHub"\)/);
  assert.match(panel, /Crear una serie/);
  assert.match(panel, /Preparar episodios y consentimiento/);
  assert.match(panel, /Escuchar a la comunidad y aprender/);
  assert.match(panel, /Vincular publicación/);
  assert.match(model, /momos_humanization_community_v1/);
});

test("H105 queda gobernado por aceptación y staging sin tocar producción", () => {
  assert.match(migration, /20260722_104_piloto_comercial_ui/);
  assert.match(ordered, /20260722_105_humanizacion_comunidad/);
  assert.match(ordered, /01-105 PASS/);
  assert.match(workflow, /humanizacion-comunidad-v1\.sql/);
  assert.match(workflow, /test-humanizacion-comunidad-v1\.sql/);
  assert.match(workflow, /01-110 PASS/);
});
