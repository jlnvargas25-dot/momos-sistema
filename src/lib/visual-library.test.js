import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVisualLibrary } from "./visual-library.js";

const asset = (profile = {}) => ({
  id: 8, name: "Momo mango frontal", media_type: "Foto", source: "MOMOS", product_id: "momo-gatito",
  figure: "Momo", flavor: "Mango biche", shot_type: "Producto", orientation: "Vertical",
  contains_people: false, rights_status: "Propio", rights_expires_at: null, ai_use_allowed: true, status: "Activo",
  allowed_channels: ["Instagram"], mime_type: "image/png", size_bytes: 2048,
  width: 1080, height: 1920, duration_seconds: null, content_hash: "a".repeat(64), asset_fingerprint: "b".repeat(32), tags: [],
  production_profile: { component_type: "Producto", view_angle: "Frontal", physical_state: "Intacto",
    interaction_type: "Ninguna", visual_set_key: "momo-mango", variant_label: "intacto",
    identity_visibility: "No aplica", canonical: true, consent_valid: null, ...profile },
});

const envelope = (assets = [asset()]) => ({ schema_version: "momos-visual-library/v1",
  filters: { channel: "Instagram", purpose: "Referencia" }, set_count: 1, asset_count: assets.length,
  sets: [{ set_key: "momo-mango", component_type: "Producto", available_views: ["Frontal"], coverage_complete: false, assets }],
  privacy: { contains_storage_paths: false, contains_people_identity: false, contains_consent_evidence: false, contains_pii: false, contains_secrets: false },
  human_review_required: true, external_execution_allowed: false });

test("normaliza sets visuales aprobados sin rutas ni identidad", () => {
  const result = normalizeVisualLibrary(envelope());
  assert.equal(result.asset_count, 1);
  assert.equal(result.sets[0].assets[0].production_profile.visual_set_key, "momo-mango");
});

test("rechaza identidad humana sin consentimiento vigente", () => {
  const human = asset({ component_type: "Manos", identity_visibility: "Manos sin rostro", consent_valid: false });
  assert.throws(() => normalizeVisualLibrary(envelope([human])), /consentimiento válido/);
});

test("rechaza rutas privadas aunque estén anidadas", () => {
  const leaked = envelope();
  leaked.sets[0].assets[0].storage_path = "private/momo.png";
  assert.throws(() => normalizeVisualLibrary(leaked), /campo interno|sensible|privado/i);
});

test("conserva la aptitud H110 separada para activo y set", () => {
  const quality = { ready: false, target_use: "Generación de video",
    reasons: ["Falta una vista tres cuartos apta."], warnings: [],
    status: "Requiere mejora", recommended_action: "Nueva toma", source_current: true,
    assessment_fingerprint: "c".repeat(32) };
  const input = envelope([{ ...asset(), ai_quality: quality }]);
  input.quality_contract_version = 1;
  input.filters.target_use = "Generación de video";
  input.sets[0].ai_quality = quality;
  const result = normalizeVisualLibrary(input);
  assert.equal(result.quality_contract_version, 1);
  assert.equal(result.sets[0].ai_quality.ready, false);
  assert.equal(result.sets[0].assets[0].ai_quality.target_use, "Generación de video");
});

test("H111 separa una variante con escarcha de un máster limpio", () => {
  const quality = { ready: false, target_use: "Generación de video",
    reasons: ["La escarcha impide usar esta referencia como máster IA."], warnings: [],
    status: "Variante artística", recommended_action: "Capturar máster limpio", source_current: true,
    assessment_fingerprint: "d".repeat(32) };
  const artistic = { ...asset({ source_quality: "Original con escarcha", canonical: false }), ai_quality: quality,
    clean_master: { class: "Variante artística", ready: false, artistic_variant: true,
      source_quality: "Original con escarcha", canonical: false, original_asset_id: null,
      reasons: ["Conservar y capturar un máster limpio."], recommended_action: "Capturar máster limpio",
      human_review_required: true, external_execution_allowed: false } };
  const input = envelope([artistic]);
  input.quality_contract_version = 2;
  input.clean_master_policy_version = 1;
  input.filters.target_use = "Generación de video";
  const result = normalizeVisualLibrary(input);
  assert.equal(result.clean_master_policy_version, 1);
  assert.equal(result.sets[0].assets[0].clean_master.class, "Variante artística");
  assert.equal(result.sets[0].assets[0].clean_master.ready, false);
  assert.equal(result.sets[0].assets[0].production_profile.source_quality, "Original con escarcha");
});

test("H111 rechaza contratos v2 que omiten el estado de máster", () => {
  const input = envelope();
  input.quality_contract_version = 2;
  input.clean_master_policy_version = 1;
  assert.throws(() => normalizeVisualLibrary(input), /estado de máster limpio/);
});
