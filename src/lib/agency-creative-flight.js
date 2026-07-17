const list = (value) => Array.isArray(value) ? value : [];
const same = (a, b) => String(a ?? "") === String(b ?? "");

export const CREATIVE_FLIGHT_STAGES = Object.freeze([
  "Contrato", "Guion", "Storyboard", "Motion", "Enrutamiento",
  "Generación", "QA", "Máster", "Distribución", "Medición",
]);

const newest = (rows, predicate = () => true) => list(rows)
  .filter(predicate)
  .sort((a, b) => Number(b.version || b.id || 0) - Number(a.version || a.id || 0))[0] || null;

const approved = (status) => ["Aprobado", "Aprobada", "Autorizado", "Publicada", "Cerrado"].includes(status);

function releaseForContract(db, contractId) {
  return newest(db.agencyMasterReleases, (row) => same(row.contractId, contractId) && row.status !== "Cancelada");
}

function stage(label, state, detail, target = "") {
  return { label, state, detail, target };
}

export function creativeFlightForContract(contract = {}, db = {}) {
  const direction = contract.sealedPayload?.creative_direction || {};
  const mode = direction.content_mode || "Sin definir";
  const script = newest(db.agencyRetentionScripts, (row) => same(row.contractId, contract.id));
  const board = newest(db.agencyStoryboards, (row) => same(row.contractId, contract.id));
  const motion = board && newest(db.agencyMotionPlans, (row) => same(row.storyboardId, board.id));
  const route = board && newest(db.agencySceneRoutingPlans, (row) => same(row.storyboardId, board.id));
  const jobs = route ? list(route.jobIds).map((id) => list(db.creativeGenerationJobs).find((row) => same(row.id, id))).filter(Boolean) : [];
  const activeShots = board ? list(db.agencyStoryboardShots).filter((row) => same(row.storyboardId, board.id) && row.status === "Vigente") : [];
  const reviews = board ? list(db.agencySceneQualityReviews).filter((row) => same(row.storyboardId, board.id)) : [];
  const approvedReviews = reviews.filter((row) => row.status === "Aprobada");
  const pack = board && newest(db.agencyPostproductionPackages, (row) => same(row.storyboardId, board.id));
  const master = pack && newest(db.agencyPostproductionExports, (row) => same(row.packageId, pack.id));
  const release = releaseForContract(db, contract.id);
  const distribution = release?.distributionId
    ? list(db.content_distributions).find((row) => same(row.id, release.distributionId))
    : release?.postId ? list(db.content_distributions).find((row) => same(row.postId, release.postId)) : null;
  const measurements = release?.postId
    ? list(db.agencyRetentionMeasurements).filter((row) => same(row.contentPostId, release.postId)) : [];

  const generationComplete = jobs.length > 0 && jobs.every((job) => job.status === "Completado" && job.outputReviewStatus === "Aprobada");
  const qaComplete = activeShots.length > 0 && approvedReviews.length >= activeShots.length;
  const measured = measurements.some((row) => mode === "Pauta"
    ? Number(row.paidOrders || 0) > 0 || Number(row.impressions || 0) >= 100
    : Number(row.views3s || 0) > 0 || Number(row.impressions || 0) >= 100);

  const stages = [
    stage("Contrato", approved(contract.status) ? "done" : "current", contract.status || "Sin contrato", "agency-collaboration-desk"),
    stage("Guion", approved(script?.status) ? "done" : script ? "current" : "pending", script?.status || "Falta guion", "agency-retention-lab"),
    stage("Storyboard", approved(board?.status) ? "done" : board ? "current" : "pending", board?.status || "Falta storyboard", "agency-scene-studio"),
    stage("Motion", approved(motion?.status) ? "done" : motion ? "current" : "pending", motion?.status || "Falta dirección", "agency-motion-experience"),
    stage("Enrutamiento", approved(route?.status) ? "done" : route ? "current" : "pending", route?.status || "Falta ruta", "agency-scene-router"),
    stage("Generación", generationComplete ? "done" : jobs.length ? "current" : "pending", jobs.length ? `${jobs.filter((job) => job.status === "Completado").length}/${jobs.length} salidas` : "Sin generar", "agency-scene-router"),
    stage("QA", qaComplete ? "done" : reviews.length ? "current" : "pending", `${approvedReviews.length}/${activeShots.length || 0} tomas aprobadas`, "agency-quality-control"),
    stage("Máster", master?.status === "Aprobada" ? "done" : master ? "current" : "pending", master?.status || "Falta máster", "agency-quality-control"),
    stage("Distribución", distribution?.status === "Publicada" ? "done" : release || distribution ? "current" : "pending", distribution?.status || release?.status || "Sin relevo exacto", "agency-distribution-room"),
    stage("Medición", measured ? "done" : distribution?.status === "Publicada" ? "current" : "pending", measured ? `${measurements.length} medición(es)` : "Sin muestra", "agency-retention-lab"),
  ];
  const firstOpen = stages.find((item) => item.state !== "done") || stages[stages.length - 1];
  const completed = stages.filter((item) => item.state === "done").length;
  return {
    contract, mode, metric: direction.mode_primary_metric || "Sin métrica", goal: direction.content_goal || "Sin objetivo",
    script, board, motion, route, jobs, pack, master, release, distribution, measurements, stages,
    completed, progress: Math.round((completed / stages.length) * 100),
    currentStage: firstOpen.label, nextTarget: firstOpen.target,
    status: completed === stages.length ? "Aprendizaje cerrado" : firstOpen.state === "current" ? "En curso" : "Pendiente",
    blocked: mode === "Sin definir" || (mode === "Pauta" && direction.mode_primary_metric && ["Retención", "Finalización", "Compartidos", "Guardados", "Conversación cualificada"].includes(direction.mode_primary_metric)),
  };
}

export function buildCreativeFlightCenter(db = {}) {
  const flights = list(db.agencyCreativeContracts)
    .filter((contract) => contract.status === "Aprobado")
    .map((contract) => creativeFlightForContract(contract, db))
    .sort((a, b) => Number(b.contract.id || 0) - Number(a.contract.id || 0));
  return {
    flights,
    active: flights.filter((flight) => flight.status !== "Aprendizaje cerrado"),
    completed: flights.filter((flight) => flight.status === "Aprendizaje cerrado"),
    summary: {
      total: flights.length,
      pauta: flights.filter((flight) => flight.mode === "Pauta").length,
      organic: flights.filter((flight) => flight.mode === "Orgánico").length,
      blocked: flights.filter((flight) => flight.blocked).length,
    },
  };
}
