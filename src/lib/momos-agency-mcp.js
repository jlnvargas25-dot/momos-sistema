import { createHash } from "node:crypto";

const FORBIDDEN_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|app[_-]?secret|password|service[_-]?role|authorization)/i;

export const MOMOS_AGENCY_MCP_VERSION = "1.1.0";

export const MOMOS_AGENCY_MCP_TOOLS = Object.freeze([
  "momos_health",
  "momos_agency_snapshot",
  "momos_meta_observatory",
  "momos_creative_context",
  "momos_search_brand_assets",
  "momos_get_brand_asset_reference",
  "momos_submit_proposals",
]);

const BRAND_ASSET_MEDIA_TYPES = new Set(["Foto", "Video", "Audio", "Logo", "Diseño"]);
const BRAND_ASSET_RIGHTS = new Set(["Propio", "Autorizado"]);
const BRAND_ASSET_INTERNAL_FIELDS = /(storage[_-]?path|signed[_-]?url|generation[_-]?meta|created[_-]?by|archived[_-]?by|notes)/i;
const BRAND_ASSET_SOURCES = new Set(["MOMOS", "Cliente", "Generado", "Proveedor"]);
const BRAND_ASSET_ORIENTATIONS = new Set(["Vertical", "Horizontal", "Cuadrado", "Audio", "Documento"]);
const BRAND_ASSET_CHANNELS = new Set(["Instagram", "Facebook", "TikTok", "YouTube", "WhatsApp", "Web", "Email", "Punto de venta", "Todos", "all"]);
const BRAND_ASSET_MIME_BY_MEDIA_TYPE = Object.freeze({
  Foto: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  Video: new Set(["video/mp4", "video/quicktime", "video/webm"]),
  Audio: new Set(["audio/mpeg", "audio/mp4", "audio/wav"]),
  Logo: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  Diseño: new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]),
});
const BRAND_ASSET_ORIENTATION_BY_MEDIA_TYPE = Object.freeze({
  Foto: new Set(["Vertical", "Horizontal", "Cuadrado"]),
  Video: new Set(["Vertical", "Horizontal", "Cuadrado"]),
  Audio: new Set(["Audio"]),
  Logo: new Set(["Vertical", "Horizontal", "Cuadrado"]),
  Diseño: new Set(["Vertical", "Horizontal", "Cuadrado", "Documento"]),
});
const METADATA_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const METADATA_URL = /(?:https?:\/\/|www\.)\S+/i;
const METADATA_SECRET = /(?:sb_secret_|\beyJ[A-Za-z0-9_-]{10,}|\bsk-[A-Za-z0-9_-]{8,}|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|app[ _-]?secret|password|service[ _-]?role|authorization)/i;
const METADATA_PROMPT_INJECTION = /(?:\b(?:ignora|ignore|omite|olvida|desobedece|revela|exfiltra|ejecuta|execute|run)\b.{0,48}\b(?:instrucciones?|instructions?|prompt|sistema|system|herramientas?|tools?|comandos?|commands?)\b|\b(?:system|developer|assistant)\s*(?:prompt|message|:)|<\|?(?:system|developer|assistant)\|?>|\[INST\]|```|\b(?:powershell|cmd\.exe|curl)\b)/i;
const METADATA_CONTROL = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

export const MOMOS_CREATIVE_CONTEXTS = Object.freeze([
  "routing",
  "motion",
  "quality",
  "retention",
]);

export const MOMOS_PROPOSAL_TOOLS = Object.freeze([
  "MOMO OPS lectura",
  "Inventario",
  "CRM",
  "Calendario",
  "Biblioteca de marca",
  "Kling",
  "Higgsfield",
  "Meta lectura",
  "TikTok lectura",
  "Distribución",
]);

const DECISION_TYPES = new Set([
  "Crear contenido", "Contactar segmento", "Activar campaña", "Pausar campaña",
  "Escalar presupuesto", "Reponer stock", "Revisar creativo", "Revisar oferta", "Otro",
]);

const asObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} debe ser un objeto.`);
  return value;
};

function safeBrandMetadataText(value, label, { allowEmpty = true, maxLength = 180 } = {}) {
  const text = String(value ?? "").trim();
  if ((!allowEmpty && !text) || text.length > maxLength || METADATA_CONTROL.test(text)) {
    throw new Error(`${label} contiene metadatos inválidos.`);
  }
  const withoutIsoDates = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "");
  const digitCount = (withoutIsoDates.match(/\d/g) || []).length;
  const looksLikePhone = digitCount >= 7 && /(?:\+?\d[\d\s().-]*){7,}/.test(withoutIsoDates);
  if (METADATA_EMAIL.test(text) || METADATA_URL.test(text) || METADATA_SECRET.test(text)
    || METADATA_PROMPT_INJECTION.test(text) || looksLikePhone) {
    throw new Error(`${label} contiene PII, secretos o instrucciones no permitidas.`);
  }
  return text;
}

function normalizeBrandSearchText(value) {
  return String(value ?? "").trim().toLowerCase()
    .replace(/á/g, "a").replace(/é/g, "e").replace(/í/g, "i")
    .replace(/ó/g, "o").replace(/[úü]/g, "u").replace(/ñ/g, "n")
    .replaceAll("gorilla", "gorila").replace(/\s+/g, " ");
}

export function brandAssetSearchQueryFingerprint(query) {
  return createHash("md5").update(normalizeBrandSearchText(query), "utf8").digest("hex");
}

function normalizeExpectedBrandAssetSearch(value) {
  const search = asObject(value, "El contexto esperado de búsqueda");
  const query = safeBrandMetadataText(search.query, "La consulta", { maxLength: 80 });
  const mediaTypes = Array.isArray(search.mediaTypes ?? search.media_types)
    ? [...new Set((search.mediaTypes ?? search.media_types).map((item) => String(item).trim()).filter(Boolean))]
    : [];
  const productId = String(search.productId ?? search.product_id ?? "").trim();
  const figure = safeBrandMetadataText(search.figure, "La figura", { maxLength: 80 });
  const flavor = safeBrandMetadataText(search.flavor, "El sabor", { maxLength: 80 });
  const orientation = String(search.orientation || "").trim();
  const channel = String(search.channel || "").trim();
  const limit = Number(search.limit);
  if (mediaTypes.length > BRAND_ASSET_MEDIA_TYPES.size || mediaTypes.some((item) => !BRAND_ASSET_MEDIA_TYPES.has(item))) {
    throw new Error("El filtro de tipo de medio no pertenece a la lista cerrada.");
  }
  if (productId && !/^[A-Za-z0-9._:-]{1,80}$/.test(productId)) throw new Error("El filtro de producto es inválido.");
  if (orientation && !BRAND_ASSET_ORIENTATIONS.has(orientation)) throw new Error("El filtro de orientación no pertenece a la lista cerrada.");
  if (channel && (!BRAND_ASSET_CHANNELS.has(channel) || ["Todos", "all"].includes(channel))) throw new Error("El filtro de canal no pertenece a la lista cerrada.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("El límite esperado de Biblioteca es inválido.");
  return { query, mediaTypes, productId, figure, flavor, orientation, channel, limit };
}

export function assertMcpPayloadSafe(value, path = "payload") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMcpPayloadSafe(item, `${path}[${index}]`));
    return value;
  }
  if (!value || typeof value !== "object") return value;
  Object.entries(value).forEach(([key, item]) => {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`El campo ${path}.${key} no puede atravesar el MCP.`);
    assertMcpPayloadSafe(item, `${path}.${key}`);
  });
  return value;
}

export function normalizeAgencyMcpSnapshot(value) {
  const envelope = asObject(value, "La respuesta del snapshot");
  const snapshot = asObject(envelope.snapshot, "El snapshot");
  const fingerprint = String(envelope.fingerprint || "").trim();
  if (!/^[0-9a-f]{32}$/.test(fingerprint)) throw new Error("El snapshot no tiene una huella válida.");
  if (snapshot.schema_version !== "momos-agency-context/v1") throw new Error("La versión del contexto MOMOS no es compatible.");
  if (snapshot.external_execution_allowed !== false) throw new Error("El contexto MCP intentó ampliar permisos externos.");
  assertMcpPayloadSafe(snapshot);
  return { fingerprint, snapshot };
}

export function creativeContextRpc(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  const routes = {
    routing: { rpc: "obtener_contexto_enrutamiento_agente", param: "p_storyboard_id" },
    motion: { rpc: "obtener_contexto_motion_agente", param: "p_storyboard_id" },
    quality: { rpc: "obtener_contexto_calidad_agente", param: "p_job_id" },
    retention: { rpc: "obtener_contexto_retencion_agente", param: "p_measurement_id" },
  };
  if (!routes[normalized]) throw new Error("El contexto creativo solicitado no pertenece a la lista cerrada.");
  return routes[normalized];
}

function normalizeBrandAsset(value, { allowStoragePath = false } = {}) {
  const asset = asObject(value, "El activo de marca");
  if (!allowStoragePath && Object.keys(asset).some((key) => BRAND_ASSET_INTERNAL_FIELDS.test(key))) {
    throw new Error("La búsqueda de Biblioteca expuso un campo interno.");
  }
  assertMcpPayloadSafe(asset);
  const id = Number(asset.id);
  const name = safeBrandMetadataText(asset.name, "El nombre del activo", { allowEmpty: false, maxLength: 180 });
  const mediaType = String(asset.media_type || asset.mediaType || "").trim();
  const source = safeBrandMetadataText(asset.source, "La fuente del activo", { allowEmpty: false, maxLength: 80 });
  const productId = asset.product_id == null ? null : String(asset.product_id).trim();
  const productName = safeBrandMetadataText(asset.product_name, "El producto del activo", { maxLength: 180 });
  const figure = safeBrandMetadataText(asset.figure, "La figura del activo", { maxLength: 80 });
  const flavor = safeBrandMetadataText(asset.flavor, "El sabor del activo", { maxLength: 80 });
  const shotType = safeBrandMetadataText(asset.shot_type || asset.shotType, "El tipo de toma", { maxLength: 80 });
  const orientation = String(asset.orientation || "").trim();
  const rightsStatus = String(asset.rights_status || asset.rightsStatus || "").trim();
  const status = String(asset.status || "").trim();
  const contentHash = String(asset.content_hash || asset.contentHash || "").trim().toLowerCase();
  const assetFingerprint = String(asset.asset_fingerprint || asset.assetFingerprint || "").trim().toLowerCase();
  const containsPeople = Boolean(asset.contains_people ?? asset.containsPeople);
  const aiUseAllowed = asset.ai_use_allowed ?? asset.aiUseAllowed;
  const sizeBytes = Number(asset.size_bytes ?? asset.sizeBytes);
  const mimeType = String(asset.mime_type || asset.mimeType || "").trim().toLowerCase();
  const allowedChannels = Array.isArray(asset.allowed_channels ?? asset.allowedChannels)
    ? [...new Set((asset.allowed_channels ?? asset.allowedChannels).map((item) => String(item).trim()).filter(Boolean))]
    : [];
  const tags = Array.isArray(asset.tags)
    ? asset.tags.map((item) => safeBrandMetadataText(item, "Una etiqueta del activo", { allowEmpty: false, maxLength: 60 }))
    : [];
  if (!Number.isSafeInteger(id) || id <= 0 || name.length < 3) throw new Error("La identidad del activo de marca es inválida.");
  if (!BRAND_ASSET_MEDIA_TYPES.has(mediaType) || status !== "Activo" || !BRAND_ASSET_RIGHTS.has(rightsStatus) || aiUseAllowed !== true) {
    throw new Error("El activo no está autorizado para atravesar el MCP.");
  }
  if (!BRAND_ASSET_SOURCES.has(source)) throw new Error("La fuente del activo no pertenece a la lista cerrada.");
  if (productId != null && !/^[A-Za-z0-9._:-]{1,80}$/.test(productId)) throw new Error("El producto ligado al activo es inválido.");
  if (!BRAND_ASSET_ORIENTATIONS.has(orientation) || !BRAND_ASSET_ORIENTATION_BY_MEDIA_TYPE[mediaType]?.has(orientation)) {
    throw new Error("La orientación no es compatible con el tipo de activo.");
  }
  if (allowedChannels.length > BRAND_ASSET_CHANNELS.size || allowedChannels.some((channel) => !BRAND_ASSET_CHANNELS.has(channel))) {
    throw new Error("El activo contiene un canal fuera de la lista cerrada.");
  }
  if (tags.length > 20) throw new Error("El activo contiene demasiadas etiquetas.");
  if (containsPeople && rightsStatus !== "Autorizado") throw new Error("El material con personas no tiene autorización explícita.");
  if (!/^[0-9a-f]{64}$/.test(contentHash) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > 104857600) {
    throw new Error("La huella o el tamaño del activo de marca es inválido.");
  }
  if (!/^[0-9a-f]{32}$/.test(assetFingerprint)) throw new Error("La versión sellada del activo de marca es inválida.");
  const rightsExpiresAt = asset.rights_expires_at || asset.rightsExpiresAt || null;
  if (rightsExpiresAt != null) {
    const expiry = Date.parse(`${String(rightsExpiresAt).slice(0, 10)}T23:59:59.999Z`);
    if (!Number.isFinite(expiry) || expiry < Date.now()) throw new Error("Los derechos del activo de marca están vencidos.");
  }
  if (!BRAND_ASSET_MIME_BY_MEDIA_TYPE[mediaType]?.has(mimeType)) throw new Error("El tipo MIME no es compatible con la familia del activo.");
  const normalized = {
    id,
    asset_ref: `brand-asset:${id}`,
    name,
    media_type: mediaType,
    source,
    product_id: productId,
    product_name: productName,
    figure,
    flavor,
    shot_type: shotType,
    orientation,
    contains_people: containsPeople,
    rights_status: rightsStatus,
    rights_expires_at: rightsExpiresAt,
    ai_use_allowed: true,
    allowed_channels: allowedChannels,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    width: asset.width == null ? null : Number(asset.width),
    height: asset.height == null ? null : Number(asset.height),
    duration_seconds: asset.duration_seconds == null ? null : Number(asset.duration_seconds),
    content_hash: contentHash,
    asset_fingerprint: assetFingerprint,
    tags,
  };
  if (allowStoragePath) {
    const storagePath = String(asset.storage_path || "").trim();
    if (!storagePath || storagePath.startsWith("/") || /(^|[\\/])\.\.([\\/]|$)/.test(storagePath)) {
      throw new Error("La referencia privada del activo tiene una ruta inválida.");
    }
    normalized.storage_path = storagePath;
  }
  return normalized;
}

function brandAssetMatchesExpectedSearch(asset, expected) {
  const fold = (value) => String(value ?? "").trim().toLocaleLowerCase("es");
  if (expected.mediaTypes.length && !expected.mediaTypes.includes(asset.media_type)) return false;
  if (expected.productId && fold(asset.product_id) !== fold(expected.productId)) return false;
  if (expected.figure && fold(asset.figure) !== fold(expected.figure)) return false;
  if (expected.flavor && fold(asset.flavor) !== fold(expected.flavor)) return false;
  if (expected.orientation && asset.orientation !== expected.orientation) return false;
  if (expected.channel) {
    const channels = asset.allowed_channels.map(fold);
    if (channels.length && !channels.includes(fold(expected.channel)) && !channels.includes("todos") && !channels.includes("all")) return false;
  }
  if (expected.query) {
    const searchable = normalizeBrandSearchText([
      asset.name, asset.figure, asset.flavor, asset.shot_type, asset.product_id || "", JSON.stringify(asset.tags),
    ].join(" "));
    if (!searchable.includes(normalizeBrandSearchText(expected.query))) return false;
  }
  return true;
}

export function normalizeBrandAssetSearch(value, { expectedRequestKey = "", expectedSearch } = {}) {
  const envelope = asObject(value, "La respuesta de búsqueda de Biblioteca");
  const expected = normalizeExpectedBrandAssetSearch(expectedSearch);
  const requestKeyExpected = String(expectedRequestKey || "").trim();
  if (!/^[A-Za-z0-9:_-]{3,180}$/.test(requestKeyExpected)) throw new Error("La búsqueda necesita una clave esperada válida.");
  if (envelope.schema_version !== "momos-brand-asset-search/v1") throw new Error("La versión de búsqueda de Biblioteca no es compatible.");
  if (!Array.isArray(envelope.assets) || envelope.assets.length > expected.limit) {
    throw new Error("La búsqueda de Biblioteca devolvió una cantidad inválida.");
  }
  if (envelope.external_execution_allowed !== false) throw new Error("La búsqueda de Biblioteca intentó ampliar permisos externos.");
  const queryFingerprint = String(envelope.query_fingerprint || "").trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(queryFingerprint)
    || queryFingerprint !== brandAssetSearchQueryFingerprint(expected.query)) throw new Error("La búsqueda de Biblioteca no está sellada para esta consulta.");
  const requestKey = String(envelope.request_key || "").trim();
  if (!/^[A-Za-z0-9:_-]{3,180}$/.test(requestKey) || requestKey !== requestKeyExpected) {
    throw new Error("La búsqueda de Biblioteca no corresponde a esta solicitud.");
  }
  const assets = envelope.assets.map((asset) => normalizeBrandAsset(asset));
  if (Number(envelope.count) !== assets.length) throw new Error("La búsqueda de Biblioteca reportó un conteo inconsistente.");
  if (assets.some((asset) => !brandAssetMatchesExpectedSearch(asset, expected))) {
    throw new Error("La búsqueda de Biblioteca devolvió un activo fuera de los filtros solicitados.");
  }
  return {
    schema_version: envelope.schema_version,
    request_key: requestKey,
    query_fingerprint: queryFingerprint,
    count: assets.length,
    assets,
    external_execution_allowed: false,
  };
}

export function normalizeBrandAssetClaim(value) {
  const envelope = asObject(value, "La concesión privada del activo");
  if (envelope.schema_version !== "momos-brand-asset-claim/v1") throw new Error("La versión de concesión de Biblioteca no es compatible.");
  if (envelope.external_execution_allowed !== false) throw new Error("La concesión del activo intentó ampliar permisos externos.");
  const asset = normalizeBrandAsset(envelope.asset, { allowStoragePath: true });
  const grant = asObject(envelope.grant, "La concesión temporal");
  const requestKey = String(grant.request_key || "").trim();
  const fingerprint = String(grant.contract_fingerprint || "").trim().toLowerCase();
  const expiresAt = String(grant.expires_at || "").trim();
  if (!/^[A-Za-z0-9:_-]{3,180}$/.test(requestKey) || !/^[0-9a-f]{32}$/.test(fingerprint) || !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error("La concesión temporal del activo es inválida.");
  }
  if (Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) > Date.now() + 16 * 60 * 1000) {
    throw new Error("La concesión temporal del activo está vencida o excede su vigencia permitida.");
  }
  return {
    schema_version: envelope.schema_version,
    asset,
    grant: {
      request_key: requestKey,
      contract_fingerprint: fingerprint,
      purpose: String(grant.purpose || "").trim(),
      channel: String(grant.channel || "").trim(),
      expires_at: expiresAt,
      duplicate: Boolean(grant.duplicate),
    },
    external_execution_allowed: false,
  };
}

export function sanitizeBrandAssetClaimForReference(claimValue) {
  const claim = normalizeBrandAssetClaim(claimValue);
  const { storage_path: _storagePath, ...asset } = claim.asset;
  return { asset, grant: claim.grant };
}

function normalizeProposal(value) {
  const proposal = asObject(value, "Cada propuesta");
  assertMcpPayloadSafe(proposal);
  const type = String(proposal.decisionType || proposal.decision_type || "").trim();
  const title = String(proposal.title || "").trim();
  const rationale = String(proposal.rationale || "").trim();
  const risk = String(proposal.riskLevel || proposal.risk_level || "Bajo").trim();
  const mode = String(proposal.executionMode || proposal.execution_mode || "Solo análisis").trim();
  const tools = [...new Set((proposal.requiredTools || proposal.required_tools || []).map((item) => String(item).trim()).filter(Boolean))];
  const confidence = Number(proposal.confidence);
  const estimated = Number(proposal.estimatedCostCop ?? proposal.estimated_cost_cop ?? 0);
  const cap = Number(proposal.costCapCop ?? proposal.cost_cap_cop ?? 0);
  if (!DECISION_TYPES.has(type)) throw new Error("Tipo de decisión MCP inválido.");
  if (title.length < 3 || title.length > 180 || rationale.length < 3 || rationale.length > 2000) throw new Error("Título o fundamento MCP inválido.");
  if (!['Bajo', 'Medio', 'Alto'].includes(risk)) throw new Error("Riesgo MCP inválido.");
  if (!['Solo análisis', 'Preparar borrador'].includes(mode)) throw new Error("El MCP no admite acciones externas.");
  if (!tools.length || tools.length > 12 || tools.some((tool) => !MOMOS_PROPOSAL_TOOLS.includes(tool))) throw new Error("La propuesta usa herramientas fuera de la lista cerrada.");
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Confianza MCP inválida.");
  if (![estimated, cap].every(Number.isFinite) || estimated < 0 || cap < estimated) throw new Error("Costo MCP inválido.");
  return {
    decision_type: type,
    title,
    rationale,
    evidence: asObject(proposal.evidence || {}, "La evidencia"),
    proposed_action: asObject(proposal.proposedAction || proposal.proposed_action || {}, "La acción propuesta"),
    required_tools: tools,
    confidence,
    risk_level: risk,
    estimated_cost_cop: estimated,
    cost_cap_cop: cap,
    execution_mode: mode,
    source: "Codex · MOMOS Agency MCP",
  };
}

export function buildAgencyMcpRun(input = {}) {
  assertMcpPayloadSafe(input);
  const requestKey = String(input.requestKey || input.request_key || "").trim();
  const fingerprint = String(input.snapshotFingerprint || input.snapshot_fingerprint || "").trim();
  const focus = String(input.focus || "").trim();
  const proposals = Array.isArray(input.proposals) ? input.proposals.map(normalizeProposal) : [];
  if (!/^[A-Za-z0-9:_-]{3,160}$/.test(requestKey)) throw new Error("La corrida MCP necesita una clave idempotente válida.");
  if (!/^[0-9a-f]{32}$/.test(fingerprint)) throw new Error("La corrida MCP necesita la huella exacta del snapshot.");
  if (focus.length < 3 || focus.length > 180) throw new Error("El foco MCP es inválido.");
  if (proposals.length > 12) throw new Error("Una corrida MCP admite máximo 12 propuestas.");
  return {
    run_key: `mcp:${requestKey}`,
    trigger_type: "Manual",
    focus,
    context_snapshot: {
      schema_version: "momos-agency-context/v1",
      snapshot_fingerprint: fingerprint,
      external_execution_allowed: false,
    },
    agent_name: "Codex · Cerebro de Agencia MOMOS",
    agent_version: MOMOS_AGENCY_MCP_VERSION,
    proposals,
  };
}
