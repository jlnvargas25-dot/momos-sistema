const list = (value) => Array.isArray(value) ? value : [];
const clean = (value) => String(value ?? "").trim();
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const POSTPRODUCTION_EXPORT_FORMATS = Object.freeze({
  "9:16": Object.freeze({ width: 1080, height: 1920, fps: 30, container: "mp4", videoCodec: "h264", audioCodec: "aac" }),
  "1:1": Object.freeze({ width: 1080, height: 1080, fps: 30, container: "mp4", videoCodec: "h264", audioCodec: "aac" }),
  "4:5": Object.freeze({ width: 1080, height: 1350, fps: 30, container: "mp4", videoCodec: "h264", audioCodec: "aac" }),
  "16:9": Object.freeze({ width: 1920, height: 1080, fps: 30, container: "mp4", videoCodec: "h264", audioCodec: "aac" }),
});

export const POSTPRODUCTION_EXPORT_FINAL_STATES = Object.freeze(["Aprobada", "Rechazada", "Cancelada"]);

export function postproductionAudioSelection(asset = null) {
  if (!asset) return { mode: "Original" };
  return { mode: "Biblioteca", audio_asset_id: Number(asset.id) };
}

export function postproductionExportSpec(pkg = {}, overrides = {}) {
  const packageSpec = pkg.snapshot?.export_spec || {};
  const aspectRatio = clean(overrides.aspectRatio || packageSpec.aspect_ratio || "9:16");
  const preset = POSTPRODUCTION_EXPORT_FORMATS[aspectRatio] || POSTPRODUCTION_EXPORT_FORMATS["9:16"];
  return {
    aspect_ratio: aspectRatio in POSTPRODUCTION_EXPORT_FORMATS ? aspectRatio : "9:16",
    width: Math.round(finite(overrides.width, preset.width)),
    height: Math.round(finite(overrides.height, preset.height)),
    fps: Math.round(finite(overrides.fps, preset.fps)),
    container: clean(overrides.container || preset.container).toLowerCase(),
    video_codec: clean(overrides.videoCodec || preset.videoCodec).toLowerCase(),
    audio_codec: clean(overrides.audioCodec || preset.audioCodec).toLowerCase(),
    color_space: clean(overrides.colorSpace || "bt709").toLowerCase(),
    loudness_lufs: finite(overrides.loudnessLufs, -14),
    max_size_bytes: Math.round(finite(overrides.maxSizeBytes, 100 * 1024 * 1024)),
    burn_subtitles: overrides.burnSubtitles === true,
    final_qc_required: true,
  };
}

export function validatePostproductionExportSpec(spec = {}) {
  const reasons = [];
  if (!POSTPRODUCTION_EXPORT_FORMATS[spec.aspect_ratio]) reasons.push("La relación de aspecto no está permitida.");
  if (!Number.isInteger(spec.width) || !Number.isInteger(spec.height) || spec.width < 480 || spec.height < 480 || spec.width > 3840 || spec.height > 3840) reasons.push("La resolución debe estar entre 480 y 3840 píxeles por lado.");
  if (![24, 25, 30, 50, 60].includes(spec.fps)) reasons.push("Los FPS deben ser 24, 25, 30, 50 o 60.");
  if (spec.container !== "mp4" || spec.video_codec !== "h264" || spec.audio_codec !== "aac") reasons.push("El máster operativo debe ser MP4, H.264 y AAC.");
  if (spec.color_space !== "bt709") reasons.push("El espacio de color operativo debe ser BT.709.");
  if (spec.loudness_lufs < -24 || spec.loudness_lufs > -9) reasons.push("La sonoridad objetivo debe quedar entre -24 y -9 LUFS.");
  if (spec.max_size_bytes < 1024 * 1024 || spec.max_size_bytes > 100 * 1024 * 1024) reasons.push("El límite del archivo debe estar entre 1 y 100 MB.");
  if (spec.final_qc_required !== true) reasons.push("El control técnico final es obligatorio.");
  return { valid: reasons.length === 0, reasons };
}

export function postproductionExportPayload(pkg = {}, overrides = {}) {
  const spec = postproductionExportSpec(pkg, overrides);
  return {
    export_key: clean(overrides.exportKey) || `package-${pkg.id}-master-${Date.now()}`,
    package_id: pkg.id,
    export_spec: spec,
    audio_selection: postproductionAudioSelection(overrides.audioAsset),
  };
}

export function evaluatePostproductionMaster(exportJob = {}, asset = null) {
  const expected = exportJob.snapshot?.export_spec || exportJob.exportSpec || {};
  const observed = exportJob.result?.technical_probe || exportJob.resultSnapshot?.technical_probe || {};
  const reasons = [];
  if (!asset || asset.status !== "Activo" || asset.rightsStatus !== "Autorizado") reasons.push("El máster no tiene archivo activo y derechos autorizados.");
  if (asset && asset.mimeType !== "video/mp4") reasons.push("El archivo final no es MP4.");
  if (asset && clean(asset.contentHash).length !== 64) reasons.push("La huella SHA-256 del archivo no es válida.");
  for (const field of ["width", "height", "fps"]) {
    if (finite(observed[field]) !== finite(expected[field])) reasons.push(`${field} no coincide con la especificación sellada.`);
  }
  if (clean(observed.video_codec).toLowerCase() !== clean(expected.video_codec).toLowerCase()) reasons.push("El códec de video no coincide.");
  if (clean(observed.color_space).toLowerCase() !== clean(expected.color_space).toLowerCase()) reasons.push("El espacio de color no coincide.");
  if (finite(observed.size_bytes || asset?.sizeBytes) > finite(expected.max_size_bytes)) reasons.push("El archivo supera el peso autorizado.");
  return { approved: reasons.length === 0, reasons };
}

export function buildPostproductionExportCenter(db = {}) {
  const storyboards = list(db.agencyStoryboards);
  const packages = list(db.agencyPostproductionPackages).map((item) => ({
    ...item,
    storyboard: storyboards.find((board) => String(board.id) === String(item.storyboardId)) || null,
  }));
  const assets = list(db.brandMediaAssets);
  const audioBindings = list(db.agencyPostproductionAudioBindings);
  const exports = list(db.agencyPostproductionExports).map((item) => ({
    ...item,
    package: packages.find((pkg) => String(pkg.id) === String(item.packageId)) || null,
    outputAsset: assets.find((asset) => String(asset.id) === String(item.outputAssetId)) || null,
    audioBinding: audioBindings.find((binding) => String(binding.exportId) === String(item.id)) || null,
  }));
  const packageIds = new Set(exports.filter((item) => !["Rechazada", "Cancelada"].includes(item.status)).map((item) => String(item.packageId)));
  const candidates = packages.filter((pkg) => pkg.status === "Aprobado" && !packageIds.has(String(pkg.id)));
  return {
    exports,
    candidates,
    summary: {
      authorized: exports.filter((item) => item.status === "Autorizada").length,
      processing: exports.filter((item) => ["Procesando", "Incierta"].includes(item.status)).length,
      awaitingQc: exports.filter((item) => item.status === "Exportada").length,
      approved: exports.filter((item) => item.status === "Aprobada").length,
      blocked: exports.filter((item) => ["Fallida", "Incierta", "Rechazada"].includes(item.status)).length,
    },
  };
}
