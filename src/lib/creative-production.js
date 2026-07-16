const list = (value) => Array.isArray(value) ? value : [];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const clean = (value) => String(value || "").trim();

export const CREATIVE_PROVIDERS = Object.freeze(["Por conectar", "Kling", "Higgsfield", "HeyGen", "Manual"]);
export const CREATIVE_JOB_STATES = Object.freeze([
  "Preparado", "Autorizado", "En generación", "Completado", "Fallido", "Cancelado",
]);

export function recommendedCreativeProvider(job = {}) {
  const text = [job.operation, job.targetFormat, job.prompt].map(clean).join(" ").toLocaleLowerCase("es");
  if (/avatar|presentador|hablando|voz a cámara|vocero/.test(text)) return "HeyGen";
  if (/generar video|reel|tiktok|cinem|producto|transición/.test(text)) return "Kling";
  return "Manual";
}

export function creativeAuthorizationGuard(job = {}, input = {}, db = {}, today = new Date().toISOString().slice(0, 10)) {
  const reasons = [];
  const maxCostCop = number(input.maxCostCop);
  if (job.status !== "Preparado") reasons.push("Solo un trabajo preparado puede autorizarse.");
  if (!CREATIVE_PROVIDERS.includes(job.provider) || job.provider === "Por conectar") reasons.push("Elegí un motor real antes de autorizar.");
  if (job.provider !== "Manual" && maxCostCop <= 0) reasons.push("Definí un tope de costo en COP para evitar cargos abiertos.");
  if (maxCostCop < 0) reasons.push("El tope de costo no puede ser negativo.");
  if (db.agencySettings?.paused) reasons.push("La parada de emergencia de Agencia MOMOS está activa.");
  const assets = list(job.inputAssetIds).map((id) => list(db.brandMediaAssets).find((asset) => String(asset.id) === String(id)));
  if (assets.some((asset) => !asset)) reasons.push("Una fuente del trabajo ya no existe.");
  assets.filter(Boolean).forEach((asset) => {
    if (asset.status !== "Activo") reasons.push(`${asset.name || asset.id} ya no está activo.`);
    if (!["Propio", "Autorizado"].includes(asset.rightsStatus)) reasons.push(`${asset.name || asset.id} no tiene derechos aprobados.`);
    if (asset.aiUseAllowed !== true) reasons.push(`${asset.name || asset.id} no autoriza uso con IA.`);
    if (asset.rightsExpiresAt && asset.rightsExpiresAt < today) reasons.push(`${asset.name || asset.id} tiene el permiso vencido.`);
  });
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], maxCostCop };
}

export function creativeJobNextAction(job = {}, productionReady = false) {
  if (!productionReady) return { label: "Instalar control", tone: "warning", action: "install" };
  if (job.status === "Preparado") return { label: "Autorizar", tone: "primary", action: "authorize" };
  if (job.status === "Autorizado") return { label: "Listo para conector", tone: "info", action: "waiting" };
  if (job.status === "En generación") return { label: "Generando", tone: "info", action: "running" };
  if (job.status === "Fallido") return { label: "Revisar y reintentar", tone: "danger", action: "retry" };
  if (job.status === "Completado") return { label: "Revisar resultado", tone: "success", action: "review" };
  return { label: "Sin acciones", tone: "muted", action: "none" };
}

export function buildCreativeProductionQueue(db = {}) {
  const jobs = list(db.creativeGenerationJobs).map((job) => ({
    ...job,
    recommendedProvider: recommendedCreativeProvider(job),
    nextAction: creativeJobNextAction(job, Boolean(db.creativeProductionReady)),
    outputAsset: list(db.brandMediaAssets).find((asset) => String(asset.id) === String(job.outputAssetId)) || null,
  }));
  const active = jobs.filter((job) => ["Preparado", "Autorizado", "En generación", "Fallido"].includes(job.status));
  return {
    jobs,
    active,
    history: jobs.filter((job) => ["Completado", "Cancelado"].includes(job.status)),
    summary: {
      prepared: jobs.filter((job) => job.status === "Preparado").length,
      authorized: jobs.filter((job) => job.status === "Autorizado").length,
      running: jobs.filter((job) => job.status === "En generación").length,
      failed: jobs.filter((job) => job.status === "Fallido").length,
      completed: jobs.filter((job) => job.status === "Completado").length,
      authorizedCostCop: jobs.filter((job) => ["Autorizado", "En generación"].includes(job.status))
        .reduce((sum, job) => sum + number(job.maxCostCop), 0),
    },
  };
}
