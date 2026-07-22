import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../../supabase/biblioteca-visual-ampliada-v1.sql");
const adversarial = read("../../supabase/tests/test-biblioteca-visual-ampliada-v1.sql");
const ordered = read("../../supabase/tests/test-migraciones-ordenadas.sql");
const workflow = read("../../.github/workflows/staging-database-gate.yml");
const runtime = read("../../scripts/momos-agency-mcp.mjs");
const panel = read("../features/agency/AgencyBrandStudio.jsx");
const readModel = read("../lib/read-model.js");

test("H106 extiende H61 sin crear una segunda biblioteca", () => {
  assert.match(migration, /alter table public\.brand_asset_production_profiles/);
  assert.match(migration, /visual_set_key/);
  assert.match(migration, /variant_label/);
  assert.doesNotMatch(migration, /create table if not exists public\.brand_(?:visual_assets|visual_library_assets)/);
});

test("H106 sella persona, canal, finalidad, vigencia y huella", () => {
  assert.match(migration, /identity_visibility/);
  assert.match(migration, /consent_channels/);
  assert.match(migration, /consent_purposes/);
  assert.match(migration, /consent_expires_at/);
  assert.match(migration, /consent_ai_use/);
  assert.match(migration, /production_profile',to_jsonb\(p\)/);
  assert.match(migration, /agency_mcp_visual_claim_scope_guard/);
  assert.match(adversarial, /cruzó consentimiento TikTok hacia Instagram/);
});

test("Codex recibe sets seguros y la UI puede administrarlos", () => {
  assert.match(runtime, /momos_visual_library/);
  assert.match(runtime, /normalizeVisualLibrary/);
  assert.match(runtime, /No expone rutas, identidad de personas ni evidencia legal/);
  assert.match(panel, /Sets multivista reutilizables/);
  assert.match(panel, /Finalidades autorizadas/);
  assert.match(readModel, /biblioteca_visual_ampliada_disponible/);
  assert.match(readModel, /consent_purposes/);
});

test("H106 queda en la cadena y en el gate aislado de staging", () => {
  assert.match(ordered, /20260722_106_biblioteca_visual_ampliada/);
  assert.match(ordered, /01-111 PASS/);
  assert.match(workflow, /biblioteca-visual-ampliada-v1\.sql/);
  assert.match(workflow, /test-biblioteca-visual-ampliada-v1\.sql/);
  assert.match(workflow, /01-111 PASS/);
});
