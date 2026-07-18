const clean = (value) => String(value || "").trim();
const list = (value) => Array.isArray(value) ? value : [];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const BRAND_MEDIA_TYPES = Object.freeze(["Foto", "Video", "Audio", "Logo", "Diseño"]);
export const BRAND_MEDIA_RIGHTS = Object.freeze(["Propio", "Autorizado", "Por verificar", "Restringido"]);
export const BRAND_STUDIO_OPERATIONS = Object.freeze(["Componer", "Editar", "Adaptar", "Generar imagen", "Generar video"]);
export const BRAND_MEDIA_COLLECTIONS = Object.freeze(["Marca", "Productos", "Animación"]);
export const BRAND_ASSET_ROLES = Object.freeze([
  "Logo principal", "Logo secundario", "Referencia visual", "Ambiente y estilo de vida",
  "Empaque y material", "Equipo y cultura", "Textura o fondo", "Guía de marca",
]);
export const ANIMATION_ASSET_KINDS = Object.freeze([
  "Personaje", "Escenario", "Objeto", "Vestuario", "Vehículo", "Efecto visual", "Guía del mundo",
]);
export const ANIMATION_ASSET_ROLES = Object.freeze([
  "Diseño base", "Turnaround", "Expresiones", "Poses", "Hoja de escala", "Prueba de movimiento",
  "Escenario maestro", "Utilería", "Vestuario", "Storyboard", "Animatic", "Clip animado", "Guía de continuidad",
]);

const BRAND_TAG = "momos:marca";
const PRODUCT_TAG = "momos:producto";
const ANIMATION_TAG = "momos:animacion";

function normalizedTags(asset) {
  return list(asset?.tags).map((tag) => clean(tag).toLocaleLowerCase("es"));
}

export function brandAssetCollection(asset = {}) {
  const tags = normalizedTags(asset);
  if (tags.includes(ANIMATION_TAG)) return "Animación";
  if (tags.includes(PRODUCT_TAG)) return "Productos";
  if (tags.includes(BRAND_TAG)) return "Marca";
  if (asset.mediaType === "Logo") return "Marca";
  if (clean(asset.productId) || clean(asset.productName) || clean(asset.figure) || clean(asset.flavor)) return "Productos";
  return "Marca";
}

export function animationAssetKind(asset = {}) {
  const tag = normalizedTags(asset).find((item) => item.startsWith("animacion:tipo:"));
  if (!tag) return "Guía del mundo";
  const value = tag.slice("animacion:tipo:".length);
  return ANIMATION_ASSET_KINDS.find((item) => item.toLocaleLowerCase("es") === value) || "Guía del mundo";
}

export function animationAssetIsCanonical(asset = {}) {
  return normalizedTags(asset).includes("animacion:canon");
}

export function brandAssetRole(asset = {}) {
  const shotType = clean(asset.shotType);
  if (asset.mediaType === "Logo") return shotType || "Logo de marca";
  if (brandAssetCollection(asset) === "Animación") return shotType || "Diseño base";
  if (brandAssetCollection(asset) === "Productos") return shotType || "Producto";
  return shotType || "Referencia visual";
}

const FORMAT_SPECS = Object.freeze({
  "Reel 9:16": { aspectRatio: "9:16", width: 1080, height: 1920, duration: "6-30 s" },
  "Historia 9:16": { aspectRatio: "9:16", width: 1080, height: 1920, duration: "5-15 s" },
  "TikTok 9:16": { aspectRatio: "9:16", width: 1080, height: 1920, duration: "6-30 s" },
  "Post 4:5": { aspectRatio: "4:5", width: 1080, height: 1350, duration: "imagen" },
  "Cuadrado 1:1": { aspectRatio: "1:1", width: 1080, height: 1080, duration: "imagen o video" },
  "WhatsApp 4:5": { aspectRatio: "4:5", width: 1080, height: 1350, duration: "imagen o video corto" },
});

export const BRAND_STUDIO_FORMATS = Object.freeze(Object.keys(FORMAT_SPECS));

function brandSnapshot(db) {
  const brand = db.brand_library || {};
  return {
    phrases: list(brand.frases).map(clean).filter(Boolean),
    tone: list(brand.tono).map(clean).filter(Boolean),
    allowedWords: list(brand.palabrasSi).map(clean).filter(Boolean),
    forbiddenWords: list(brand.palabrasNo).map(clean).filter(Boolean),
  };
}

function assetSearchText(asset) {
  return [asset.id, asset.name, asset.mediaType, asset.source, asset.productName, asset.figure,
    asset.flavor, asset.shotType, asset.orientation, asset.collection, asset.roleLabel, asset.animationKind,
    ...list(asset.tags), asset.notes]
    .map(clean).join(" ").toLocaleLowerCase("es");
}

export function brandAssetReadiness(asset = {}, today = new Date().toISOString().slice(0, 10), operation = "Generar video") {
  const reasons = [];
  const warnings = [];
  if (!asset.id) reasons.push("El activo no tiene identidad trazable.");
  if (!BRAND_MEDIA_TYPES.includes(asset.mediaType)) reasons.push("El tipo de archivo no está permitido en la biblioteca.");
  if (asset.fileAvailable !== true && !clean(asset.storagePath) && !clean(asset.url)) reasons.push("El activo no tiene un archivo original disponible.");
  if (asset.status !== "Activo") reasons.push("El activo está archivado o bloqueado.");
  if (!BRAND_MEDIA_RIGHTS.includes(asset.rightsStatus) || ["Por verificar", "Restringido"].includes(asset.rightsStatus)) {
    reasons.push("Los derechos de uso no están aprobados.");
  }
  if (asset.rightsExpiresAt && clean(asset.rightsExpiresAt) < today) reasons.push("La autorización de uso está vencida.");
  if (asset.containsPeople && asset.rightsStatus !== "Autorizado") reasons.push("El material con personas necesita autorización explícita de imagen.");
  if (operation !== "Catalogar" && asset.aiUseAllowed !== true) reasons.push("El activo no autoriza edición o generación con IA.");
  if (!asset.contentHash) warnings.push("No tiene huella digital para detectar archivos repetidos.");
  if (brandAssetCollection(asset) === "Animación" && !clean(asset.figure)) reasons.push("El archivo animado necesita un personaje o elemento del mundo.");
  if (brandAssetCollection(asset) === "Productos" && !asset.productId && ["Foto", "Video"].includes(asset.mediaType)) warnings.push("El recurso de producto no está relacionado con un producto del catálogo.");
  return { ready: reasons.length === 0, reasons: [...new Set(reasons)], warnings: [...new Set(warnings)] };
}

export function buildBrandMediaLibrary(db = {}, today = new Date().toISOString().slice(0, 10)) {
  const assets = list(db.brandMediaAssets).map((asset) => ({
    ...asset,
    collection: brandAssetCollection(asset),
    roleLabel: brandAssetRole(asset),
    animationKind: animationAssetKind(asset),
    animationCanonical: animationAssetIsCanonical(asset),
    readiness: brandAssetReadiness(asset, today),
  }));
  const hashes = new Map();
  assets.forEach((asset) => {
    if (!asset.contentHash) return;
    const matches = hashes.get(asset.contentHash) || [];
    matches.push(asset.id);
    hashes.set(asset.contentHash, matches);
  });
  const duplicateIds = new Set([...hashes.values()].filter((ids) => ids.length > 1).flat());
  const normalized = assets.map((asset) => ({ ...asset, duplicate: duplicateIds.has(asset.id) }));
  const active = normalized.filter((asset) => asset.status === "Activo");
  const productCoverage = new Set(active.filter((asset) => asset.productId).map((asset) => asset.productId));
  const orientationCoverage = new Set(active.map((asset) => asset.orientation).filter(Boolean));
  const brandAssets = active.filter((asset) => asset.collection === "Marca");
  const productAssets = active.filter((asset) => asset.collection === "Productos");
  const animationAssets = active.filter((asset) => asset.collection === "Animación");
  const animationCharacters = new Set(animationAssets.filter((asset) => asset.animationKind === "Personaje").map((asset) => clean(asset.figure)).filter(Boolean));
  return {
    assets: normalized,
    active,
    readyForAi: active.filter((asset) => asset.readiness.ready && !asset.duplicate),
    blocked: active.filter((asset) => !asset.readiness.ready || asset.duplicate),
    summary: {
      total: normalized.length,
      active: active.length,
      readyForAi: active.filter((asset) => asset.readiness.ready && !asset.duplicate).length,
      rightsPending: active.filter((asset) => asset.readiness.reasons.some((reason) => /derechos|autorización/i.test(reason))).length,
      duplicates: duplicateIds.size,
      productsCovered: productCoverage.size,
      orientationsCovered: orientationCoverage.size,
      brandAssets: brandAssets.length,
      productAssets: productAssets.length,
      animationAssets: animationAssets.length,
      animationCharacters: animationCharacters.size,
      animationCanonical: animationAssets.filter((asset) => asset.animationCanonical).length,
      primaryLogos: brandAssets.filter((asset) => asset.mediaType === "Logo" && /principal/i.test(asset.roleLabel)).length,
      brandReferences: brandAssets.filter((asset) => asset.mediaType !== "Logo").length,
    },
  };
}

export function searchBrandMediaAssets(library, query = "", filters = {}) {
  const needle = clean(query).toLocaleLowerCase("es");
  const terms = needle.split(/\s+/).filter(Boolean);
  return list(library?.assets).filter((asset) => {
    if (filters.mediaType && asset.mediaType !== filters.mediaType) return false;
    if (filters.collection && asset.collection !== filters.collection) return false;
    if (filters.status && asset.status !== filters.status) return false;
    if (filters.productId && asset.productId !== filters.productId) return false;
    if (filters.readyForAi === true && (!asset.readiness?.ready || asset.duplicate)) return false;
    const haystack = assetSearchText(asset);
    return terms.length === 0 || terms.every((term) => haystack.includes(term));
  });
}

export function brandAssetDeletionReadiness(asset = {}, db = {}) {
  const id = String(asset.id || "");
  const reasons = [];
  const contains = (values) => list(values).some((value) => String(value) === id);
  if (!id) reasons.push("El archivo no tiene una identidad válida.");
  if (asset.status === "Eliminando") reasons.push("La eliminación ya está en proceso.");
  if (asset.status === "Eliminado") reasons.push("El archivo ya fue eliminado.");
  if (animationAssetIsCanonical(asset)) reasons.push("Es una referencia canónica del Mundo animado.");
  if (list(db.brandMediaUsages).some((usage) => String(usage.assetId) === id)) reasons.push("Ya fue usado en una pieza creativa.");
  if (list(db.creativeGenerationJobs).some((job) => String(job.outputAssetId || "") === id || contains(job.inputAssetIds))) reasons.push("Está ligado a un trabajo creativo.");
  if (list(db.agencyStoryboardShots).some((shot) => contains(shot.inputAssetIds))) reasons.push("Está incluido en una escena aprobada o en preparación.");
  if (list(db.agencySceneQualityReviews).some((review) => String(review.outputAssetId || "") === id)) reasons.push("Forma parte de una revisión de calidad.");
  if (list(db.agencyPostproductionExports).some((item) => String(item.outputAssetId || "") === id)) reasons.push("Forma parte de una exportación.");
  if (list(db.agencyPostproductionAudioBindings).some((binding) => String(binding.assetId || "") === id)) reasons.push("Está seleccionado como audio de un máster.");
  if (list(db.agencyMasterReleases).some((release) => String(release.outputAssetId || "") === id)) reasons.push("Está ligado a una publicación trazable.");
  if (list(db.brandMediaAssets).some((candidate) => String(candidate.originalAssetId || "") === id)) reasons.push("Es el original de otra versión conservada.");
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function isOfficialBrandLogo(asset = {}) {
  return asset.collection === "Marca"
    && asset.mediaType === "Logo"
    && /principal/i.test(clean(asset.roleLabel || asset.shotType));
}

export function brandAssetDeletionPolicy(asset = {}, db = {}, options = {}) {
  const readiness = brandAssetDeletionReadiness(asset, db);
  if (!isOfficialBrandLogo(asset)) {
    return { ...readiness, mode: readiness.allowed ? "standard" : "blocked", confirmationPhrase: "" };
  }
  const reasons = [...readiness.reasons];
  if (!options.isAdmin) reasons.push("Solo Administración puede retirar el logo oficial.");
  if (!options.officialLogoDeletionReady) reasons.push("Falta habilitar la eliminación protegida del logo oficial.");
  return {
    allowed: reasons.length === 0,
    mode: reasons.length === 0 ? "official-logo" : "blocked",
    reasons: [...new Set(reasons)],
    confirmationPhrase: `ELIMINAR LOGO ${asset.id}`,
  };
}

function targetFormat(channel, requested) {
  if (FORMAT_SPECS[requested]) return requested;
  if (channel === "TikTok") return "TikTok 9:16";
  if (channel === "WhatsApp") return "WhatsApp 4:5";
  return "Reel 9:16";
}

export function buildCreativeStudioDraft(input = {}, db = {}, today = new Date().toISOString().slice(0, 10)) {
  const creative = list(db.creatives).find((item) => String(item.id) === String(input.creativeId)) || null;
  const brief = list(db.agencyBriefs).find((item) => String(item.id) === String(input.briefId)) || null;
  const requestedIds = [...new Set(list(input.assetIds).map(String).filter(Boolean))];
  const assets = requestedIds.map((id) => list(db.brandMediaAssets).find((asset) => String(asset.id) === id)).filter(Boolean);
  const missingIds = requestedIds.filter((id) => !assets.some((asset) => String(asset.id) === id));
  const operation = BRAND_STUDIO_OPERATIONS.includes(input.operation) ? input.operation : "Componer";
  const channel = clean(input.targetChannel || creative?.canal || brief?.channel || "Instagram");
  const format = targetFormat(channel, input.targetFormat);
  const spec = FORMAT_SPECS[format];
  const errors = [];
  const warnings = [];
  if (!creative && !brief) errors.push("Elegí un creativo o un brief trazable antes de producir.");
  if (missingIds.length) errors.push(`${missingIds.length} activo(s) seleccionado(s) ya no existen.`);
  if (["Componer", "Editar", "Adaptar"].includes(operation) && assets.length === 0) errors.push("Esta operación necesita al menos un archivo real de la biblioteca.");
  assets.forEach((asset) => {
    const readiness = brandAssetReadiness(asset, today, operation);
    readiness.reasons.forEach((reason) => errors.push(`${asset.name || asset.id}: ${reason}`));
    readiness.warnings.forEach((warning) => warnings.push(`${asset.name || asset.id}: ${warning}`));
  });
  const productId = creative?.productoFocoId || brief?.productId || null;
  if (productId && !assets.some((asset) => asset.productId === productId)) {
    errors.push("Falta una toma real del producto foco; no se permitirá que la IA invente su apariencia.");
  }
  const hashes = assets.map((asset) => asset.contentHash).filter(Boolean);
  if (new Set(hashes).size !== hashes.length) errors.push("La selección contiene el mismo archivo más de una vez.");
  const brand = brandSnapshot(db);
  if (brand.tone.length === 0 || brand.forbiddenWords.length === 0) warnings.push("La identidad de marca está incompleta; revisá tono y palabras prohibidas.");
  const title = creative?.titulo || brief?.title || "Pieza MOMOS";
  const focus = creative?.productoFoco || (db.products || []).find((product) => product.id === productId)?.nombre || "marca MOMOS";
  const prompt = [
    `${operation} una pieza ${format} para ${title}.`,
    `Mantener el producto real ${focus} sin alterar forma, relleno, color ni empaque.`,
    brand.tone.length ? `Tono visual y verbal: ${brand.tone.join(", ")}.` : "",
    assets.length ? `Usar ${assets.length} activo(s) originales como fuente principal; generar solo tomas de apoyo, fondos o transiciones faltantes.` : "",
    `Salida nueva de ${spec.width}×${spec.height}; nunca sobrescribir los originales.`,
  ].filter(Boolean).join(" ");
  return {
    title,
    creative,
    brief,
    operation,
    provider: clean(input.provider || "Por conectar"),
    channel,
    format,
    spec,
    assets,
    productId,
    brandSnapshot: brand,
    prompt,
    negativePrompt: brand.forbiddenWords.join(", "),
    outputMode: "new_asset",
    usagePlan: assets.map((asset, index) => ({ assetId: asset.id, role: index === 0 ? "Principal" : "Apoyo", preserveOriginal: true })),
    audit: { passed: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] },
  };
}

export function estimateStudioDuration(assets = []) {
  return list(assets).filter((asset) => asset.mediaType === "Video").reduce((sum, asset) => sum + Math.max(0, number(asset.durationSeconds)), 0);
}
