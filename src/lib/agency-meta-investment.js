const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

export const META_INVESTMENT_OPTIONS = Object.freeze(["Conservar", "Reducir", "Redistribuir", "Experimento"]);

export function normalizeInvestmentEvidence(input = {}) {
  const measurement = input.measurement || {};
  const result = measurement.result || input.result || {};
  const product = input.product || {};
  const stock = input.stock || {};
  const settings = input.settings || {};
  const baselineBudget = Math.max(0, number(input.baselineBudget ?? input.campaign?.budget));
  const measuredSpend = Math.max(0, number(result.incrementalSpend ?? result.spend ?? measurement.incrementalSpend));
  const incrementalProfit = number(result.incrementalProfit);
  const exactAvailable = Math.max(0, number(stock.exactAvailable));
  const inProcess = Math.max(0, number(stock.inProcess));
  const reservations = Math.max(0, number(stock.reservations));
  const officialStock = Math.max(0, number(stock.official));
  const stockBlocked = !text(product.id) || product.active === false || (officialStock <= 0 && exactAvailable <= 0 && inProcess <= 0);
  return { measurementId: Number(measurement.id || input.measurementId), campaignId: text(input.campaign?.id || input.campaignId),
    productId: text(product.id), productName: text(product.name), baselineBudget, measuredSpend, incrementalProfit,
    causalClaimAllowed: result.causalClaimAllowed === true, classification: text(result.classification), officialStock,
    exactAvailable, inProcess, reservations, expiringSoon: Math.max(0, number(stock.expiringSoon)),
    pendingProduction: Math.max(0, number(stock.pendingProduction)), kitchenQueue: Math.max(0, number(input.kitchenQueue)),
    dailyBudgetLimit: Math.max(0, number(settings.dailyBudgetLimit)), campaignBudgetLimit: Math.max(0, number(settings.campaignBudgetLimit)),
    scaleStepPct: Math.min(30, Math.max(0, number(settings.scaleStepPct || 15))), stockBlocked,
    lifecycle: measurement.localLifecycle || input.lifecycle || {} };
}

function projection(budget, ratio, lowFactor, highFactor) {
  const base = budget * ratio;
  const bounds = [base * lowFactor, base * highFactor].sort((a, b) => a - b);
  return { low: round(bounds[0]), base: round(base), high: round(bounds[1]) };
}

export function buildInvestmentScenarios(rawEvidence = {}, horizonDays = 7) {
  const evidence = normalizeInvestmentEvidence(rawEvidence);
  const horizon = Number(horizonDays);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 30) throw new Error("El horizonte debe estar entre 1 y 30 días.");
  if (!Number.isInteger(evidence.measurementId) || evidence.measurementId < 1) throw new Error("Falta una medición incremental aprobada.");
  const baseline = evidence.baselineBudget || evidence.measuredSpend;
  const step = evidence.scaleStepPct || 15;
  const rawRatio = evidence.measuredSpend > 0 ? evidence.incrementalProfit / evidence.measuredSpend : 0;
  const ratio = Math.max(-2, Math.min(5, rawRatio));
  const conserveBudget = round(baseline);
  const reduceBudget = round(baseline * (1 - step / 100));
  const experimentBudget = round(Math.min(evidence.dailyBudgetLimit || 50000, baseline > 0 ? baseline * 0.15 : 50000));
  const returningMargin = number(evidence.lifecycle?.returning?.margin);
  const newMargin = number(evidence.lifecycle?.new?.margin);
  const lifecycleTarget = returningMargin > newMargin ? "Recurrentes" : "Nuevos";
  const operationalBlockers = [];
  if (evidence.stockBlocked) operationalBlockers.push("Sin postre o presentación foco utilizable ni producción en curso.");
  if (evidence.exactAvailable <= evidence.reservations && evidence.inProcess <= 0) operationalBlockers.push("La disponibilidad exacta no supera las reservas vigentes.");
  if (evidence.kitchenQueue >= 5) operationalBlockers.push("Cocina tiene cinco o más pedidos activos.");
  const assumptions = ["Proyección, no promesa: escala conservadoramente el único resultado aprobado.", "No modifica presupuesto, audiencia, campaña ni publicación."];
  const options = [
    { key: "Conservar", proposedBudget: conserveBudget, deltaPct: 0, projection: projection(conserveBudget, ratio, 0.5, 1.15),
      purpose: "Mantener el aprendizaje sin ampliar exposición.", blockers: operationalBlockers, assumptions },
    { key: "Reducir", proposedBudget: reduceBudget, deltaPct: -step, projection: projection(reduceBudget, ratio, 0.5, 1.05),
      purpose: "Limitar riesgo mientras se corrige rentabilidad o capacidad.", blockers: [], assumptions },
    { key: "Redistribuir", proposedBudget: conserveBudget, deltaPct: 0, projection: projection(conserveBudget, ratio, 0.4, 1.2),
      purpose: `Comparar ciclo de vida sin aumentar el total; foco sugerido: ${lifecycleTarget}.`, blockers: operationalBlockers, assumptions },
    { key: "Experimento", proposedBudget: experimentBudget, deltaPct: baseline > 0 ? round(experimentBudget / baseline * 100 - 100) : 0,
      projection: { low: -experimentBudget, base: 0, high: round(Math.max(0, evidence.incrementalProfit) * 0.25) },
      purpose: "Comprar evidencia nueva con una sola variable y un tope pequeño.", blockers: evidence.stockBlocked ? operationalBlockers : [], assumptions },
  ];
  let recommended = "Conservar";
  if (evidence.stockBlocked || (evidence.causalClaimAllowed && evidence.incrementalProfit <= 0)) recommended = "Reducir";
  else if (!evidence.causalClaimAllowed) recommended = "Experimento";
  else if ((returningMargin > 0 || newMargin > 0) && Math.max(returningMargin, newMargin) >= Math.max(1, Math.min(returningMargin, newMargin)) * 1.5) recommended = "Redistribuir";
  else if (operationalBlockers.length) recommended = "Conservar";
  return { horizonDays: horizon, evidence, options, recommended, guards: { humanReviewRequired: true, executionForbidden: true,
    budgetChangeForbidden: true, audienceChangeForbidden: true, publicationForbidden: true } };
}

export function investmentScenarioPayload(measurement, horizonDays = 7) {
  const id = Number(measurement?.id);
  if (!Number.isInteger(id) || id < 1 || measurement?.status !== "Aprobada") throw new Error("Elegí una medición incremental aprobada.");
  return { scenario_key: `meta-investment-${id}-${Date.now()}`, measurement_id: id, horizon_days: Number(horizonDays) };
}

export function buildMetaInvestmentCenter(db = {}) {
  const scenarios = list(db.agencyMetaInvestmentScenarios);
  const measurements = list(db.agencyMetaLiftMeasurements);
  return { scenarios, candidates: measurements.filter((measurement) => measurement.status === "Aprobada" &&
      !scenarios.some((scenario) => String(scenario.measurementId) === String(measurement.id))),
    summary: { scenarios: scenarios.length, reviewing: scenarios.filter((item) => item.status === "En revisión").length,
      approved: scenarios.filter((item) => item.status === "Aprobado").length,
      blocked: scenarios.filter((item) => item.evidence?.stockBlocked || item.options?.some((option) => option.blockers?.length)).length } };
}
