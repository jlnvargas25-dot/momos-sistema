const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value, digits = 2) => value == null ? null : Number(Number(value).toFixed(digits));

export const META_LIFT_DESIGNS = Object.freeze(["Meta Conversion Lift", "Holdout aleatorio MOMOS", "Observacional"]);
export const META_LIFECYCLE_SCOPES = Object.freeze(["Todos", "Nuevos", "Recurrentes"]);

function normalCdf(value) {
  const x = Math.abs(number(value)) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return value >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export function validateLiftStudy(input = {}) {
  const reasons = [];
  if (!/^[A-Za-z0-9:_-]{3,220}$/.test(text(input.studyKey))) reasons.push("Falta una clave idempotente válida.");
  if (!Number.isInteger(Number(input.diagnosticId)) || Number(input.diagnosticId) < 1) reasons.push("Falta el diagnóstico Meta aprobado.");
  if (!META_LIFT_DESIGNS.includes(input.design)) reasons.push("El diseño de medición no es válido.");
  if (!META_LIFECYCLE_SCOPES.includes(input.lifecycleScope)) reasons.push("El ciclo de vida no es válido.");
  const start = Date.parse(input.windowStart); const end = Date.parse(input.windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) reasons.push("La ventana del estudio no es válida.");
  if (Number.isFinite(start) && Number.isFinite(end) && end - start > 62 * 24 * 60 * 60 * 1000) reasons.push("La ventana no puede superar 62 días.");
  if (!Number.isInteger(Number(input.minimumPerArm)) || number(input.minimumPerArm) < 100) reasons.push("Cada brazo necesita al menos 100 observaciones enteras.");
  if (input.design !== "Observacional" && input.randomized !== true) reasons.push("Un estudio causal debe declarar asignación aleatoria.");
  if (input.design === "Meta Conversion Lift" && text(input.externalStudyId).length < 3) reasons.push("Falta el identificador oficial del estudio Meta.");
  if (text(input.hypothesis).length < 12) reasons.push("Falta una hipótesis verificable.");
  return { ready: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function evaluateLiftMeasurement(input = {}, study = {}) {
  const control = input.control || {}; const exposed = input.exposed || {};
  const minimum = Math.max(100, number(study.minimumPerArm || input.minimumPerArm || 100));
  const reasons = [];
  for (const [name, cell] of [["control", control], ["expuesto", exposed]]) {
    for (const key of ["population", "buyers", "orders", "revenue", "margin"]) {
      if (typeof cell[key] !== "number" || !Number.isFinite(cell[key])) reasons.push(`Falta ${key} numérico en ${name}.`);
    }
    const population = number(cell.population); const buyers = number(cell.buyers);
    if (!Number.isInteger(population) || population < 0) reasons.push(`La población de ${name} es inválida.`);
    if (!Number.isInteger(buyers) || buyers < 0 || buyers > population) reasons.push(`Los compradores de ${name} no cuadran con su población.`);
    for (const key of ["orders", "revenue", "margin"]) if (number(cell[key]) < 0) reasons.push(`${key} de ${name} no puede ser negativo.`);
  }
  if (number(input.spend) < 0) reasons.push("El gasto incremental no puede ser negativo.");
  if (reasons.length) return { ready: false, reasons: [...new Set(reasons)] };
  const controlPopulation = number(control.population); const exposedPopulation = number(exposed.population);
  const controlBuyers = number(control.buyers); const exposedBuyers = number(exposed.buyers);
  const controlRate = controlPopulation ? controlBuyers / controlPopulation : 0;
  const exposedRate = exposedPopulation ? exposedBuyers / exposedPopulation : 0;
  const rateDifference = exposedRate - controlRate;
  const pooled = controlPopulation + exposedPopulation ? (controlBuyers + exposedBuyers) / (controlPopulation + exposedPopulation) : 0;
  const standardError = controlPopulation && exposedPopulation ? Math.sqrt(pooled * (1 - pooled) * (1 / controlPopulation + 1 / exposedPopulation)) : 0;
  const zScore = standardError > 0 ? rateDifference / standardError : 0;
  const pValue = standardError > 0 ? 2 * (1 - normalCdf(Math.abs(zScore))) : 1;
  const sampleSufficient = controlPopulation >= minimum && exposedPopulation >= minimum;
  const significant = sampleSufficient && pValue <= 0.05;
  const randomized = study.randomized === true || study.assignment?.randomized === true;
  const causalClaimAllowed = study.design !== "Observacional" && randomized && significant;
  const incrementalBuyers = rateDifference * exposedPopulation;
  const averageMarginPerBuyer = exposedBuyers > 0 ? number(exposed.margin) / exposedBuyers : 0;
  const incrementalMargin = incrementalBuyers * averageMarginPerBuyer;
  const incrementalProfit = incrementalMargin - number(input.spend);
  const liftPct = controlRate > 0 ? rateDifference / controlRate * 100 : null;
  let classification = "Inconcluso";
  if (!sampleSufficient) classification = "Muestra insuficiente";
  else if (study.design === "Observacional") classification = "Asociación observada";
  else if (significant && rateDifference <= 0) classification = "Sin lift";
  else if (significant && incrementalProfit > 0) classification = "Incremental rentable";
  else if (significant) classification = "Incremental sin rentabilidad";
  return { ready: true, sampleSufficient, significant, causalClaimAllowed, classification,
    controlRatePct: round(controlRate * 100), exposedRatePct: round(exposedRate * 100), rateDifferencePp: round(rateDifference * 100),
    liftPct: round(liftPct), zScore: round(zScore, 4), pValue: round(pValue, 4), incrementalBuyers: round(incrementalBuyers),
    incrementalMargin: round(incrementalMargin), spend: round(input.spend), incrementalProfit: round(incrementalProfit),
    guards: { attributionIsNotCausality: true, humanReviewRequired: true, spendChangeForbidden: true, publicationForbidden: true } };
}

export function liftStudyPayload(input = {}) {
  const study = { studyKey: text(input.studyKey), diagnosticId: Number(input.diagnosticId), design: input.design,
    lifecycleScope: input.lifecycleScope || "Todos", windowStart: input.windowStart, windowEnd: input.windowEnd,
    minimumPerArm: Number(input.minimumPerArm || 100), randomized: input.randomized === true,
    externalStudyId: text(input.externalStudyId), hypothesis: text(input.hypothesis), assignmentMethod: text(input.assignmentMethod) };
  const validation = validateLiftStudy(study); if (!validation.ready) throw new Error(validation.reasons[0]);
  return { study_key: study.studyKey, diagnostic_id: study.diagnosticId, design: study.design, lifecycle_scope: study.lifecycleScope,
    window_start: study.windowStart, window_end: study.windowEnd, minimum_per_arm: study.minimumPerArm,
    external_study_id: study.externalStudyId, hypothesis: study.hypothesis,
    assignment_snapshot: { randomized: study.randomized, method: study.assignmentMethod || (study.design === "Observacional" ? "Sin asignación" : "Asignación declarada por plataforma") } };
}

export function buildMetaIncrementalityCenter(db = {}) {
  const measurements = list(db.agencyMetaLiftMeasurements);
  const studies = list(db.agencyMetaLiftStudies).map((study) => ({ ...study,
    measurements: measurements.filter((item) => String(item.studyId) === String(study.id)) }));
  return { studies, measurements, candidates: list(db.agencyMetaDiagnostics).filter((diagnostic) => diagnostic.status === "Aprobado" &&
      !studies.some((study) => String(study.diagnosticId) === String(diagnostic.id))),
    summary: { studies: studies.length, reviewing: measurements.filter((item) => item.status === "En revisión").length,
      causal: measurements.filter((item) => item.result?.causalClaimAllowed).length,
      profit: measurements.filter((item) => item.status === "Aprobada").reduce((sum, item) => sum + number(item.result?.incrementalProfit), 0) } };
}
