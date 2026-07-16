const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const META_AUTHORIZATION_STATUSES = Object.freeze([
  "En revisión", "Autorizada", "Devuelta", "Rechazada", "Revocada", "Vencida", "Sustituida", "Simulada", "Fallida", "Incierta",
]);

export function authorizationRequestGuard({ scenario, optionKey, audienceExternalId, targetBudget, validMinutes, justification, settings = {} } = {}) {
  const reasons = [];
  const option = list(scenario?.options).find((item) => item.key === optionKey);
  const minutes = Number(validMinutes);
  const budget = number(targetBudget);
  if (!scenario?.id || scenario.status !== "Aprobado") reasons.push("El escenario necesita aprobación humana vigente.");
  if (!option) reasons.push("Elegí una de las cuatro alternativas selladas.");
  if (list(option?.blockers).length > 0) reasons.push("La alternativa conserva bloqueos operativos sin resolver.");
  if (option && Math.abs(number(option.proposedBudget) - budget) > 0.01) reasons.push("El presupuesto no coincide con la alternativa sellada.");
  if (!/^[A-Za-z0-9._:-]{3,180}$/.test(text(audienceExternalId))) reasons.push("Identificá la audiencia exacta de Meta.");
  if (!Number.isInteger(minutes) || minutes < 10 || minutes > 120) reasons.push("La vigencia debe estar entre 10 y 120 minutos.");
  if (text(justification).length < 16 || text(justification).length > 600) reasons.push("La justificación debe tener entre 16 y 600 caracteres.");
  if (budget < 0 || budget > number(settings.campaignBudgetLimit || scenario?.evidence?.limits?.campaignBudgetLimit)) reasons.push("El objetivo supera el límite protegido por campaña.");
  if (settings.paused === true) reasons.push("Agencia MOMOS está pausada.");
  if (scenario?.evidence?.stockBlocked && optionKey !== "Reducir") reasons.push("Sin stock operativo solo puede autorizarse reducir exposición.");
  return { allowed: reasons.length === 0, reasons, option, executionMode: "Simulación", externalMutationForbidden: true };
}

export function metaAuthorizationPayload({ scenario, optionKey, audienceExternalId, validMinutes = 60, justification, settings = {} } = {}) {
  const option = list(scenario?.options).find((item) => item.key === optionKey);
  const guard = authorizationRequestGuard({ scenario, optionKey, audienceExternalId, targetBudget: option?.proposedBudget, validMinutes, justification, settings });
  if (!guard.allowed) throw new Error(guard.reasons[0]);
  return { authorization_key: `meta-auth-${scenario.id}-${Date.now()}`, scenario_id: Number(scenario.id), selected_option: optionKey,
    audience_external_id: text(audienceExternalId), target_budget: number(option.proposedBudget), valid_minutes: Number(validMinutes),
    justification: text(justification), execution_mode: "Simulación" };
}

export function isAuthorizationLive(authorization, now = new Date()) {
  if (!authorization || !["En revisión", "Autorizada"].includes(authorization.status)) return false;
  const expiry = new Date(authorization.validUntil);
  return Number.isFinite(expiry.getTime()) && expiry.getTime() > new Date(now).getTime();
}

export function buildMetaAuthorizationCenter(db = {}, now = new Date()) {
  const scenarios = list(db.agencyMetaInvestmentScenarios);
  const authorizations = list(db.agencyMetaInvestmentAuthorizations);
  const jobs = list(db.agencyMetaInvestmentExecutionJobs);
  const governed = new Set(authorizations.filter((item) => !["Devuelta", "Rechazada", "Revocada", "Vencida", "Sustituida", "Fallida"].includes(item.status))
    .map((item) => String(item.scenarioId)));
  const candidates = scenarios.filter((scenario) => scenario.status === "Aprobado" && !governed.has(String(scenario.id)));
  return { candidates, authorizations: authorizations.map((authorization) => ({ ...authorization,
      job: jobs.find((job) => String(job.authorizationId) === String(authorization.id)) || null,
      live: isAuthorizationLive(authorization, now) })), jobs,
    summary: { requests: authorizations.length, reviewing: authorizations.filter((item) => item.status === "En revisión").length,
      authorized: authorizations.filter((item) => item.status === "Autorizada").length,
      uncertain: authorizations.filter((item) => item.status === "Incierta").length } };
}
