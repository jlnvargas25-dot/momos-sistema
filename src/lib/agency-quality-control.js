const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const score = (value) => Math.max(0, Math.min(2, Number(value) || 0));

export const AGENCY_QUALITY_CRITERIA = Object.freeze([
  { key: "product_identity", label: "Producto, figura y sabor", critical: true },
  { key: "brand_fidelity", label: "Marca, color y empaque", critical: true },
  { key: "text_logo", label: "Logo y textos", critical: false },
  { key: "anatomy", label: "Manos, rostro y anatomía", critical: false },
  { key: "contact_physics", label: "Contacto, peso y resistencia", critical: true },
  { key: "gravity_viscosity", label: "Gravedad y viscosidad", critical: true },
  { key: "camera_motion", label: "Cámara, inercia y foco", critical: false },
  { key: "light_geometry", label: "Dirección de luz", critical: true },
  { key: "shadow_reflection", label: "Sombras y reflejos", critical: false },
  { key: "temporal_stability", label: "Estabilidad temporal", critical: false },
  { key: "continuity", label: "Continuidad de entrada y salida", critical: true },
]);

export const AGENCY_QUALITY_FAILURE_TYPES = Object.freeze([
  "Aprobada", "Fallo técnico", "Fallo de marca", "Cambio creativo",
]);

export function evaluateSceneQuality(scores = {}, rightsValid = false) {
  const normalized = Object.fromEntries(AGENCY_QUALITY_CRITERIA.map((criterion) => [criterion.key, score(scores[criterion.key])]));
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  const zeros = AGENCY_QUALITY_CRITERIA.filter((criterion) => normalized[criterion.key] === 0);
  const criticalFailures = zeros.filter((criterion) => criterion.critical);
  const exactIdentity = normalized.product_identity === 2 && normalized.brand_fidelity === 2;
  const exactContinuity = normalized.continuity === 2;
  const approved = rightsValid && zeros.length === 0 && criticalFailures.length === 0
    && exactIdentity && exactContinuity && total >= 18;
  const reasons = [];
  if (!rightsValid) reasons.push("La salida no conserva derechos y archivo verificables.");
  if (criticalFailures.length) reasons.push(`Falla crítica: ${criticalFailures.map((item) => item.label).join(", ")}.`);
  if (zeros.length && !criticalFailures.length) reasons.push(`Debe corregirse: ${zeros.map((item) => item.label).join(", ")}.`);
  if (!exactIdentity) reasons.push("Producto y marca deben quedar exactos, no aproximados.");
  if (!exactContinuity) reasons.push("La continuidad debe coincidir exactamente con el storyboard.");
  if (total < 18) reasons.push(`La toma suma ${total}/22; el mínimo aprobable es 18.`);
  return { scores: normalized, total, max: 22, approved, reasons: [...new Set(reasons)], criticalFailures, zeros };
}

export function sceneQualityReviewPayload(job = {}, scores = {}, input = {}) {
  const evaluation = evaluateSceneQuality(scores, input.rightsValid === true);
  return {
    review_key: text(input.reviewKey) || `job-${job.id}-quality-${Date.now()}`,
    job_id: job.id,
    output_asset_id: job.outputAssetId,
    decision: evaluation.approved ? "Aprobar" : "Rechazar",
    failure_type: evaluation.approved ? "Aprobada" : text(input.failureType),
    scores: evaluation.scores,
    findings: list(input.findings).map(text).filter(Boolean),
    continuity_observation: text(input.continuityObservation),
    review_note: text(input.reviewNote),
  };
}

export function postproductionPackagePayload(storyboard = {}, routingPlan = {}, reviews = [], input = {}) {
  const selections = list(reviews)
    .filter((review) => review.status === "Aprobada")
    .sort((a, b) => Number(a.shotNumber ?? a.shot?.shotNumber) - Number(b.shotNumber ?? b.shot?.shotNumber))
    .map((review) => ({ shot_id: review.shotId, review_id: review.id, job_id: review.jobId, output_asset_id: review.outputAssetId }));
  return {
    package_key: text(input.packageKey) || `storyboard-${storyboard.id}-post-${Date.now()}`,
    storyboard_id: storyboard.id,
    routing_plan_id: routingPlan.id,
    selections,
    audio_plan: input.audioPlan || { mode: "original-o-licenciado", loudness_review: true },
    subtitle_plan: input.subtitlePlan || { required: true, safe_area_review: true, spelling_review: true },
    edit_decisions: input.editDecisions || { preserve_storyboard_order: true, transitions: "motivadas", color_match: true },
    export_spec: input.exportSpec || { aspect_ratio: storyboard.aspectRatio, channel: storyboard.channel, final_qc_required: true },
  };
}

export function buildAgencyQualityCenter(db = {}) {
  const boards = list(db.agencyStoryboards);
  const shots = list(db.agencyStoryboardShots);
  const jobs = list(db.creativeGenerationJobs);
  const assets = list(db.brandMediaAssets);
  const reviews = list(db.agencySceneQualityReviews).map((review) => ({
    ...review,
    job: jobs.find((job) => String(job.id) === String(review.jobId)) || null,
    shot: shots.find((shot) => String(shot.id) === String(review.shotId)) || null,
    outputAsset: assets.find((asset) => String(asset.id) === String(review.outputAssetId)) || null,
  }));
  const reviewedJobIds = new Set(reviews.map((review) => String(review.jobId)));
  const eligibleJobs = jobs.filter((job) => job.status === "Completado" && job.outputReviewStatus === "Aprobada"
    && job.outputAssetId && job.outputSpec?.storyboard_shot_id && !reviewedJobIds.has(String(job.id)));
  const packages = list(db.agencyPostproductionPackages).map((item) => ({
    ...item,
    storyboard: boards.find((board) => String(board.id) === String(item.storyboardId)) || null,
  }));
  return {
    reviews, eligibleJobs, packages,
    approved: reviews.filter((review) => review.status === "Aprobada"),
    rejected: reviews.filter((review) => review.status === "Rechazada"),
    pending: reviews.filter((review) => review.status === "En revisión"),
    summary: {
      waiting: eligibleJobs.length,
      pending: reviews.filter((review) => review.status === "En revisión").length,
      approved: reviews.filter((review) => review.status === "Aprobada").length,
      rejected: reviews.filter((review) => review.status === "Rechazada").length,
      packagesReady: packages.filter((item) => item.status === "Preparado").length,
      packagesApproved: packages.filter((item) => item.status === "Aprobado").length,
    },
  };
}
