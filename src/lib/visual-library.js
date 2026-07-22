import { assertMcpPayloadSafe, normalizeBrandAsset } from "./momos-agency-mcp.js";

const COMPONENTS = new Set(["Producto", "Empaque", "Manos", "Presentador UGC", "Locación", "Movimiento", "Marca", "Audio", "Personaje"]);
const VIEWS = new Set(["No aplica", "Frontal", "Trasera", "Perfil izquierdo", "Perfil derecho", "Tres cuartos", "Superior", "Detalle / macro", "POV", "Plano general"]);
const VISIBILITIES = new Set(["No aplica", "Manos sin rostro", "Rostro parcial", "Rostro identificable"]);
const TARGET_USES = new Set(["Contenido digital", "Generación de imagen", "Generación de video", "Element"]);

const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} no es un objeto válido.`);
  return value;
};

function normalizeQuality(value, label) {
  const quality = object(value, label);
  if (!TARGET_USES.has(quality.target_use) || typeof quality.ready !== "boolean") {
    throw new Error(`${label} tiene un contrato inválido.`);
  }
  const reasons = Array.isArray(quality.reasons) ? quality.reasons.map(String) : [];
  const warnings = Array.isArray(quality.warnings) ? quality.warnings.map(String) : [];
  if (reasons.length > 50 || warnings.length > 20 || reasons.some((item) => item.length > 240)
      || warnings.some((item) => item.length > 240)) throw new Error(`${label} excede sus límites.`);
  return {
    ready: quality.ready, target_use: quality.target_use, reasons, warnings,
    status: String(quality.status || "Pendiente"),
    recommended_action: String(quality.recommended_action || "Registrar dimensiones"),
    source_current: quality.source_current == null ? null : Boolean(quality.source_current),
    assessment_fingerprint: String(quality.assessment_fingerprint || ""),
    available_ready_views: Array.isArray(quality.available_ready_views)
      ? [...new Set(quality.available_ready_views.map(String))] : [],
    asset_count: Number(quality.asset_count || 0), ready_asset_count: Number(quality.ready_asset_count || 0),
  };
}

export function normalizeVisualLibrary(value) {
  const envelope = object(value, "La Biblioteca visual");
  assertMcpPayloadSafe(envelope);
  if (envelope.schema_version !== "momos-visual-library/v1"
      || envelope.external_execution_allowed !== false
      || envelope.human_review_required !== true
      || envelope.privacy?.contains_storage_paths !== false
      || envelope.privacy?.contains_people_identity !== false
      || envelope.privacy?.contains_consent_evidence !== false
      || envelope.privacy?.contains_pii !== false
      || envelope.privacy?.contains_secrets !== false) {
    throw new Error("La Biblioteca visual perdió privacidad o revisión humana.");
  }
  if (!Array.isArray(envelope.sets) || envelope.sets.length > 50) throw new Error("La Biblioteca visual devolvió demasiados sets.");
  const sets = envelope.sets.map((rawSet) => {
    const set = object(rawSet, "Un set visual");
    const key = String(set.set_key || "").trim();
    if (!/^(?:[a-z0-9][a-z0-9._:-]{2,79}|asset:\d+)$/.test(key) || !COMPONENTS.has(set.component_type)) {
      throw new Error("Un set visual tiene identidad inválida.");
    }
    if (!Array.isArray(set.available_views) || set.available_views.length > VIEWS.size
        || set.available_views.some((view) => !VIEWS.has(view))) throw new Error("Un set visual contiene vistas inválidas.");
    if (!Array.isArray(set.assets) || !set.assets.length || set.assets.length > 50) throw new Error("Un set visual contiene una cantidad inválida de activos.");
    const assets = set.assets.map((rawAsset) => {
      const profile = object(rawAsset.production_profile, "La ficha visual");
      if (!COMPONENTS.has(profile.component_type) || !VIEWS.has(profile.view_angle)
          || !VISIBILITIES.has(profile.identity_visibility)
          || String(profile.visual_set_key || "") !== (key.startsWith("asset:") ? "" : key)
          || String(profile.variant_label || "").length > 80) throw new Error("Una ficha visual no coincide con su set.");
      if (["Manos", "Presentador UGC"].includes(profile.component_type) && profile.consent_valid !== true) {
        throw new Error("Un activo humano atravesó el MCP sin consentimiento válido.");
      }
      const aiQuality = rawAsset.ai_quality ? normalizeQuality(rawAsset.ai_quality, "La calidad del activo") : null;
      return { ...normalizeBrandAsset(rawAsset), ai_quality: aiQuality, production_profile: {
        component_type: profile.component_type, view_angle: profile.view_angle,
        physical_state: String(profile.physical_state || ""), interaction_type: String(profile.interaction_type || ""),
        visual_set_key: String(profile.visual_set_key || ""), variant_label: String(profile.variant_label || ""),
        identity_visibility: profile.identity_visibility, canonical: Boolean(profile.canonical),
        consent_valid: profile.consent_valid == null ? null : Boolean(profile.consent_valid),
      } };
    });
    const aiQuality = set.ai_quality ? normalizeQuality(set.ai_quality, "La calidad del set") : null;
    return { set_key: key, component_type: set.component_type, available_views: [...new Set(set.available_views)],
      coverage_complete: Boolean(set.coverage_complete), ai_quality: aiQuality, assets };
  });
  const assetCount = sets.reduce((total, set) => total + set.assets.length, 0);
  if (Number(envelope.set_count) !== sets.length || Number(envelope.asset_count) !== assetCount) {
    throw new Error("La Biblioteca visual reportó conteos inconsistentes.");
  }
  return { schema_version: envelope.schema_version, quality_contract_version: Number(envelope.quality_contract_version || 0),
    filters: object(envelope.filters, "Los filtros visuales"),
    set_count: sets.length, asset_count: assetCount, sets, privacy: envelope.privacy,
    human_review_required: true, external_execution_allowed: false };
}
