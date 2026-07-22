import { businessDateISO } from "./business-date.js";

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

export const PRODUCTION_IDENTITY_VISIBILITIES = Object.freeze([
  "No aplica", "Manos sin rostro", "Rostro parcial", "Rostro identificable",
]);

export const PRODUCTION_CONSENT_CHANNELS = Object.freeze([
  "Instagram", "Facebook", "TikTok", "YouTube", "WhatsApp", "Web",
  "Email", "Punto de venta", "Todos",
]);

export const PRODUCTION_CONSENT_PURPOSES = Object.freeze([
  "Referencia", "Storyboard", "Generación", "Edición", "Revisión", "Orgánico", "Pauta",
]);

export const PRODUCTION_PACK_ROLES = Object.freeze([
  "Identidad", "Producto", "Empaque", "Mano", "Presentador", "Locación",
  "Movimiento", "Logo", "Audio", "Start frame", "End frame", "Continuidad",
]);

export const PRODUCTION_PACK_STATUSES = Object.freeze([
  "Borrador", "En revisión", "Aprobado", "Archivado",
]);

export const VISUAL_QUALITY_ISSUES = Object.freeze([
  "Desenfoque", "Escarcha", "Reflejo fuerte", "Oclusión", "Recorte incompleto",
  "Color o textura incorrectos", "Logo o texto ilegible", "Fondo contaminado",
  "Compresión visible", "Identidad o geometría inestable",
]);

export const VISUAL_QUALITY_CHECKS = Object.freeze([
  "Enfoque y exposición", "Identidad y geometría", "Color y textura",
  "Recorte y oclusiones", "Logo y texto", "Fondo y reflejos",
]);

export const VISUAL_TARGET_USES = Object.freeze({
  digitalContent: { key: "digital_content", label: "Contenido digital" },
  imageGeneration: { key: "image_generation", label: "Generación de imagen" },
  videoGeneration: { key: "video_generation", label: "Generación de video" },
  element: { key: "element", label: "Element" },
});

export const OFFICIAL_FIGURE_CAPTURE_VIEWS = Object.freeze([
  "Frontal", "Trasera", "Perfil izquierdo", "Perfil derecho", "Tres cuartos",
]);

const FIGURE_CAPTURE_ORDER = Object.freeze([
  "Lizi", "Momo", "Rocco", "Teo", "Toby", "Danna", "Max",
]);

const HUMAN_COMPONENTS = new Set(["Manos", "Presentador UGC"]);
const VISUAL_MEDIA_TYPES = new Set(["Foto", "Video", "Logo"]);

function qualityUse(assessment, use) {
  const config = VISUAL_TARGET_USES[use];
  const state = assessment?.usageReadiness?.[config?.key];
  const sourceCurrent = assessment?.sourceCurrent !== false;
  const reasons = Array.isArray(state?.reasons) ? state.reasons : [];
  if (!config) return { ready: false, reasons: ["El uso visual solicitado no existe."] };
  if (!assessment) return { ready: false, reasons: ["Falta la revisión maestra de calidad para IA."] };
  if (!sourceCurrent) return { ready: false, reasons: ["La ficha cambió después de la última revisión de calidad."] };
  return { ready: Boolean(state?.ready), reasons, label: config.label };
}

export function visualQualityReadiness(asset = {}) {
  const assessment = asset.qualityAssessment || null;
  return {
    assessed: Boolean(assessment),
    status: assessment?.status || "Pendiente",
    recommendedAction: assessment?.recommendedAction || "Registrar dimensiones",
    issues: Array.isArray(assessment?.issues) ? assessment.issues : [],
    technical: assessment?.technicalSnapshot || {},
    digitalContent: qualityUse(assessment, "digitalContent"),
    imageGeneration: qualityUse(assessment, "imageGeneration"),
    videoGeneration: qualityUse(assessment, "videoGeneration"),
    element: qualityUse(assessment, "element"),
  };
}

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
    visualSetKey: profile.visualSetKey || "",
    variantLabel: profile.variantLabel || "",
    identityVisibility: profile.identityVisibility || "No aplica",
    consentChannels: Array.isArray(profile.consentChannels) ? profile.consentChannels : [],
    consentPurposes: Array.isArray(profile.consentPurposes) ? profile.consentPurposes : [],
    consentExpiresAt: profile.consentExpiresAt || "",
    consentAiUse: Boolean(profile.consentAiUse),
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
  if (asset.rightsExpiresAt && String(asset.rightsExpiresAt) < businessDateISO()) reasons.push("La autorización del original venció.");
  if (asset.readiness && !asset.readiness.ready) reasons.push(...(asset.readiness.reasons || []));

  if (HUMAN_COMPONENTS.has(profile.componentType)) {
    if (!asset.containsPeople) reasons.push("Manos y presentadores deben declararse como contenido con personas.");
    if (asset.rightsStatus !== "Autorizado") reasons.push("Falta autorización de imagen para la persona visible.");
    if (profile.consentStatus !== "Autorizado") reasons.push("Falta consentimiento específico para uso creativo con IA.");
    if (!profile.consentAiUse) reasons.push("El consentimiento no autoriza uso creativo con IA.");
    if (profile.identityVisibility === "No aplica") reasons.push("Falta declarar si aparece rostro o solo manos.");
    if (!profile.consentChannels.length || !profile.consentPurposes.length) reasons.push("Falta limitar el consentimiento por canal y finalidad.");
    if (profile.consentExpiresAt && profile.consentExpiresAt < businessDateISO()) reasons.push("El consentimiento específico venció.");
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
  if (!profile.visualSetKey) warnings.push("El activo aún no pertenece a un set visual multivista.");
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

function normalizedFigureName(value) {
  return String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

function activeFigureSubjects(db = {}) {
  const candidates = [
    ...(Array.isArray(db.figuras) ? db.figuras : []),
    ...(Array.isArray(db.settings?.figuras) ? db.settings.figuras : []),
  ];
  const byName = new Map();
  candidates.forEach((figure) => {
    const name = String(figure?.nombre || "").trim();
    if (!name || figure?.activo === false || normalizedFigureName(name) === "horizontal") return;
    const key = normalizedFigureName(name);
    const current = byName.get(key);
    if (!current || (!current.productId && figure?.productId)) byName.set(key, { ...figure, nombre: name });
  });
  return [...byName.values()].sort((a, b) => {
    const ai = FIGURE_CAPTURE_ORDER.indexOf(a.nombre);
    const bi = FIGURE_CAPTURE_ORDER.indexOf(b.nombre);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.nombre.localeCompare(b.nombre, "es");
  });
}

function buildFigureCapturePlan(db, generationReady) {
  const figures = activeFigureSubjects(db);
  const rows = figures.map((figure) => {
    const key = normalizedFigureName(figure.nombre);
    const assets = generationReady.filter((asset) => (
      ["Producto", "Personaje"].includes(asset.productionProfile?.componentType)
      && normalizedFigureName(asset.figure) === key
    ));
    const coveredViews = [...new Set(assets
      .map((asset) => asset.productionProfile?.viewAngle)
      .filter((view) => OFFICIAL_FIGURE_CAPTURE_VIEWS.includes(view)))];
    const missingViews = OFFICIAL_FIGURE_CAPTURE_VIEWS.filter((view) => !coveredViews.includes(view));
    const optionalMacroReady = assets.some((asset) => asset.productionProfile?.viewAngle === "Detalle / macro");
    const coveragePercent = Math.round((coveredViews.length / OFFICIAL_FIGURE_CAPTURE_VIEWS.length) * 100);
    return {
      figure: figure.nombre,
      productId: figure.productId || figure.product_id || "",
      gramajeG: Number(figure.gramajeG ?? figure.gramaje_g ?? 0) || 0,
      assets,
      coveredViews,
      missingViews,
      optionalMacroReady,
      nextView: missingViews[0] || (optionalMacroReady ? "" : "Detalle / macro"),
      coveragePercent,
      ready: missingViews.length === 0,
      status: missingViews.length === 0 ? "Set oficial completo" : coveredViews.length ? "En progreso" : "Sin tomas oficiales",
    };
  });
  return {
    rows,
    complete: rows.filter((row) => row.ready).length,
    pendingFigures: rows.filter((row) => !row.ready).length,
    pendingViews: rows.reduce((sum, row) => sum + row.missingViews.length, 0),
  };
}

export function buildProductionLibrary(db = {}) {
  const assets = (db.brandMediaAssets || []).map((asset) => ({
    ...asset,
    productionReadiness: productionProfileReadiness(asset),
    aiReadiness: visualQualityReadiness(asset),
  }));
  const active = assets.filter((asset) => asset.status === "Activo" && asset.productionProfile);
  const approved = active.filter((asset) => asset.productionReadiness.ready);
  const qualityGateEnabled = Boolean(db.visualQualityReady);
  const generationReady = approved.filter((asset) => !qualityGateEnabled
    || !VISUAL_MEDIA_TYPES.has(asset.mediaType)
    || asset.aiReadiness.videoGeneration.ready);
  const componentCoverage = PRODUCTION_COMPONENT_TYPES.map((componentType) => {
    const matches = active.filter((asset) => asset.productionProfile?.componentType === componentType);
    const ready = generationReady.filter((asset) => asset.productionProfile?.componentType === componentType);
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
  const visualSetsByKey = new Map();
  approved.filter((asset) => asset.productionProfile?.visualSetKey).forEach((asset) => {
    const key = asset.productionProfile.visualSetKey;
    const current = visualSetsByKey.get(key) || { key, assets: [], views: new Set(), variants: new Set() };
    current.assets.push(asset);
    if (asset.productionProfile.viewAngle !== "No aplica") current.views.add(asset.productionProfile.viewAngle);
    if (asset.productionProfile.variantLabel) current.variants.add(asset.productionProfile.variantLabel);
    visualSetsByKey.set(key, current);
  });
  const visualSets = [...visualSetsByKey.values()].map((set) => ({
    ...set, views: [...set.views], variants: [...set.variants],
    hasFrontAndBack: set.views.has("Frontal") && set.views.has("Trasera"),
    videoReadyAssets: set.assets.filter((asset) => asset.aiReadiness.videoGeneration.ready).length,
    elementReadyAssets: set.assets.filter((asset) => asset.aiReadiness.element.ready).length,
  })).sort((a, b) => a.key.localeCompare(b.key, "es"));
  const figureCapturePlan = buildFigureCapturePlan(db, generationReady);
  return {
    ready: Boolean(db.brandProductionReady), expandedReady: Boolean(db.visualLibraryReady),
    qualityReady: qualityGateEnabled,
    assets, active, approved, generationReady, componentCoverage, packs, visualSets, figureCapturePlan,
    gaps: componentCoverage.filter((item) => !item.ready),
    summary: {
      profiled: active.length,
      approved: approved.length,
      humanComponents: approved.filter((asset) => HUMAN_COMPONENTS.has(asset.productionProfile?.componentType)).length,
      locations: approved.filter((asset) => asset.productionProfile?.componentType === "Locación").length,
      multiviewAngles: multiviewAngles.size,
      visualSets: visualSets.length,
      frontBackSets: visualSets.filter((set) => set.hasFrontAndBack).length,
      approvedPacks: packs.filter((pack) => pack.status === "Aprobado" && pack.readiness.ready).length,
      imageReady: approved.filter((asset) => asset.aiReadiness.imageGeneration.ready).length,
      videoReady: approved.filter((asset) => asset.aiReadiness.videoGeneration.ready).length,
      elementReady: approved.filter((asset) => asset.aiReadiness.element.ready).length,
      needsNewCapture: approved.filter((asset) => asset.aiReadiness.status === "Requiere nueva toma").length,
      figureSetsComplete: figureCapturePlan.complete,
      figureSetsPending: figureCapturePlan.pendingFigures,
      figureViewsPending: figureCapturePlan.pendingViews,
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
    visual_set_key: String(form.visualSetKey || "").trim().toLowerCase(),
    variant_label: String(form.variantLabel || "").trim(),
    identity_visibility: form.identityVisibility || "No aplica",
    consent_channels: Array.isArray(form.consentChannels) ? form.consentChannels : [],
    consent_purposes: Array.isArray(form.consentPurposes) ? form.consentPurposes : [],
    consent_expires_at: form.consentExpiresAt || null,
    consent_ai_use: Boolean(form.consentAiUse),
    canonical: Boolean(form.canonical),
  };
}

export function defaultProductionProfile(componentType = "Producto") {
  return {
    componentType, viewAngle: componentType === "Audio" ? "No aplica" : "Frontal",
    physicalState: "No aplica", interactionType: "Ninguna", handAssignment: "Ninguna",
    locationName: "", lightDirection: "", scaleReference: "", continuityNotes: "",
    sourceQuality: "Original limpio", qaStatus: "Pendiente", qaNotes: "",
    consentStatus: HUMAN_COMPONENTS.has(componentType) ? "Pendiente" : "No aplica",
    visualSetKey: "", variantLabel: "", identityVisibility: HUMAN_COMPONENTS.has(componentType)
      ? (componentType === "Manos" ? "Manos sin rostro" : "Rostro identificable") : "No aplica",
    consentChannels: [], consentPurposes: [], consentExpiresAt: "", consentAiUse: false,
    canonical: false, qualityReviewEnabled: false, qualityIssues: [],
    qualityChecksCompleted: [], qualityReviewNotes: "",
  };
}

export function visualQualityReviewPayload(form = {}) {
  return {
    issues: Array.isArray(form.qualityIssues) ? [...new Set(form.qualityIssues)] : [],
    checks_completed: Array.isArray(form.qualityChecksCompleted)
      ? [...new Set(form.qualityChecksCompleted)] : [],
    review_notes: String(form.qualityReviewNotes || "").trim(),
  };
}
