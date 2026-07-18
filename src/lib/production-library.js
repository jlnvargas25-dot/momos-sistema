export const PRODUCTION_COMPONENT_TYPES = Object.freeze([
  "Producto", "Empaque", "Manos", "Presentador UGC", "Locación",
  "Movimiento", "Marca", "Audio", "Personaje",
]);

export const PRODUCTION_VIEW_ANGLES = Object.freeze([
  "No aplica", "Frontal", "Trasera", "Perfil izquierdo", "Perfil derecho",
  "Tres cuartos", "Superior", "Detalle / macro", "POV", "Plano general",
]);

export const PRODUCTION_PHYSICAL_STATES = Object.freeze([
  "No aplica", "Intacto", "Congelado", "Listo para servir", "Abierto",
  "Cortado", "Cucharada", "En mano", "Empaque cerrado", "Empaque abierto",
]);

export const PRODUCTION_INTERACTIONS = Object.freeze([
  "Ninguna", "Sostener", "Abrir", "Sacar", "Cortar", "Presionar", "Servir",
  "Probar", "Movimiento de cámara", "Ambiente",
]);

export const PRODUCTION_HAND_ASSIGNMENTS = Object.freeze([
  "Ninguna", "Derecha", "Izquierda", "Ambas", "Fuera de cuadro",
]);

export const PRODUCTION_SOURCE_QUALITIES = Object.freeze([
  "Original limpio", "Original con escarcha", "Comprimido", "Restaurado", "Generado",
]);

export const PRODUCTION_QA_STATUSES = Object.freeze([
  "Pendiente", "Aprobado", "Condicionado", "Rechazado",
]);

export const PRODUCTION_CONSENT_STATUSES = Object.freeze([
  "No aplica", "Pendiente", "Autorizado", "Vencido", "Restringido",
]);

export const PRODUCTION_PACK_ROLES = Object.freeze([
  "Identidad", "Producto", "Empaque", "Mano", "Presentador", "Locación",
  "Movimiento", "Logo", "Audio", "Start frame", "End frame", "Continuidad",
]);

export const PRODUCTION_PACK_STATUSES = Object.freeze([
  "Borrador", "En revisión", "Aprobado", "Archivado",
]);

const HUMAN_COMPONENTS = new Set(["Manos", "Presentador UGC"]);

function normalizedProfile(asset = {}) {
  const profile = asset.productionProfile || {};
  return {
    assetId: profile.assetId ?? asset.id ?? null,
    componentType: profile.componentType || "",
    viewAngle: profile.viewAngle || "No aplica",
    physicalState: profile.physicalState || "No aplica",
    interactionType: profile.interactionType || "Ninguna",
    handAssignment: profile.handAssignment || "Ninguna",
    locationName: profile.locationName || "",
    lightDirection: profile.lightDirection || "",
    scaleReference: profile.scaleReference || "",
    continuityNotes: profile.continuityNotes || "",
    sourceQuality: profile.sourceQuality || "Original limpio",
    qaStatus: profile.qaStatus || "Pendiente",
    qaNotes: profile.qaNotes || "",
    consentStatus: profile.consentStatus || "No aplica",
    canonical: Boolean(profile.canonical),
    updatedAt: profile.updatedAt || "",
  };
}

export function productionProfileReadiness(asset = {}) {
  const profile = normalizedProfile(asset);
  const reasons = [];
  const warnings = [];
  if (!asset.productionProfile || !profile.componentType) reasons.push("Falta clasificar el componente de producción.");
  if (profile.qaStatus !== "Aprobado") reasons.push(profile.qaStatus === "Pendiente"
    ? "Falta revisión visual de producción."
    : `QA de producción: ${profile.qaStatus.toLowerCase()}.`);
  if (asset.status && asset.status !== "Activo") reasons.push("El original no está activo.");
  if (asset.rightsStatus && !["Propio", "Autorizado"].includes(asset.rightsStatus)) reasons.push("Los derechos del original no están vigentes.");
  if (asset.aiUseAllowed === false) reasons.push("El original no permite uso creativo con IA.");
  if (asset.rightsExpiresAt && String(asset.rightsExpiresAt) < new Date().toISOString().slice(0, 10)) reasons.push("La autorización del original venció.");
  if (asset.readiness && !asset.readiness.ready) reasons.push(...(asset.readiness.reasons || []));

  if (HUMAN_COMPONENTS.has(profile.componentType)) {
    if (!asset.containsPeople) reasons.push("Manos y presentadores deben declararse como contenido con personas.");
    if (asset.rightsStatus !== "Autorizado") reasons.push("Falta autorización de imagen para la persona visible.");
    if (profile.consentStatus !== "Autorizado") reasons.push("Falta consentimiento específico para uso creativo con IA.");
  }
  if (profile.componentType === "Locación" && !profile.locationName.trim()) reasons.push("Falta identificar la locación.");
  if (["Producto", "Empaque"].includes(profile.componentType) && profile.viewAngle === "No aplica") {
    warnings.push("Conviene registrar el ángulo para construir cobertura multivista.");
  }
  if (["Original con escarcha", "Comprimido"].includes(profile.sourceQuality)) {
    warnings.push(profile.sourceQuality === "Original con escarcha"
      ? "La escarcha puede alterar textura, color y geometría al generar video."
      : "La compresión puede reducir la fidelidad de producto.");
  }
  return { ready: reasons.length === 0, reasons: [...new Set(reasons)], warnings: [...new Set(warnings)], profile };
}

function packReadiness(pack, assetsById, links) {
  const members = links.filter((link) => String(link.packId) === String(pack.id))
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
    .map((link) => ({ ...link, asset: assetsById.get(String(link.assetId)) || null }));
  const requiredRoles = Array.isArray(pack.requirements?.required_roles) ? pack.requirements.required_roles : ["Producto"];
  const presentRoles = new Set(members.map((member) => member.role));
  const reasons = requiredRoles.filter((role) => !presentRoles.has(role)).map((role) => `Falta referencia obligatoria: ${role}.`);
  members.forEach((member) => {
    if (!member.asset) reasons.push(`El activo #${member.assetId} ya no está disponible.`);
    else {
      const readiness = productionProfileReadiness(member.asset);
      if (!readiness.ready) reasons.push(`${member.role}: ${readiness.reasons[0]}`);
    }
  });
  if (!members.length) reasons.push("El paquete todavía no tiene referencias.");
  return { ready: reasons.length === 0, reasons: [...new Set(reasons)], members };
}

export function buildProductionLibrary(db = {}) {
  const assets = (db.brandMediaAssets || []).map((asset) => ({
    ...asset,
    productionReadiness: productionProfileReadiness(asset),
  }));
  const active = assets.filter((asset) => asset.status === "Activo" && asset.productionProfile);
  const approved = active.filter((asset) => asset.productionReadiness.ready);
  const componentCoverage = PRODUCTION_COMPONENT_TYPES.map((componentType) => {
    const matches = active.filter((asset) => asset.productionProfile?.componentType === componentType);
    const ready = matches.filter((asset) => asset.productionReadiness.ready);
    return { componentType, count: matches.length, approved: ready.length, ready: ready.length > 0 };
  });
  const assetsById = new Map(assets.map((asset) => [String(asset.id), asset]));
  const links = db.brandProductionPackAssets || [];
  const packs = (db.brandProductionPacks || []).map((pack) => ({
    ...pack,
    readiness: packReadiness(pack, assetsById, links),
  }));
  const multiviewAngles = new Set(approved
    .filter((asset) => ["Producto", "Empaque", "Personaje"].includes(asset.productionProfile?.componentType))
    .map((asset) => asset.productionProfile?.viewAngle)
    .filter((angle) => angle && angle !== "No aplica"));
  return {
    ready: Boolean(db.brandProductionReady), assets, active, approved, componentCoverage, packs,
    gaps: componentCoverage.filter((item) => !item.ready),
    summary: {
      profiled: active.length,
      approved: approved.length,
      humanComponents: approved.filter((asset) => HUMAN_COMPONENTS.has(asset.productionProfile?.componentType)).length,
      locations: approved.filter((asset) => asset.productionProfile?.componentType === "Locación").length,
      multiviewAngles: multiviewAngles.size,
      approvedPacks: packs.filter((pack) => pack.status === "Aprobado" && pack.readiness.ready).length,
    },
  };
}

export function productionProfilePayload(form = {}) {
  return {
    component_type: form.componentType,
    view_angle: form.viewAngle,
    physical_state: form.physicalState,
    interaction_type: form.interactionType,
    hand_assignment: form.handAssignment,
    location_name: String(form.locationName || "").trim(),
    light_direction: String(form.lightDirection || "").trim(),
    scale_reference: String(form.scaleReference || "").trim(),
    continuity_notes: String(form.continuityNotes || "").trim(),
    source_quality: form.sourceQuality,
    qa_status: form.qaStatus,
    qa_notes: String(form.qaNotes || "").trim(),
    consent_status: form.consentStatus,
    canonical: Boolean(form.canonical),
  };
}

export function defaultProductionProfile(componentType = "Producto") {
  return {
    componentType, viewAngle: componentType === "Audio" ? "No aplica" : "Frontal",
    physicalState: "No aplica", interactionType: "Ninguna", handAssignment: "Ninguna",
    locationName: "", lightDirection: "", scaleReference: "", continuityNotes: "",
    sourceQuality: "Original limpio", qaStatus: "Pendiente", qaNotes: "",
    consentStatus: HUMAN_COMPONENTS.has(componentType) ? "Pendiente" : "No aplica", canonical: false,
  };
}
