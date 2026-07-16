export const AGENCY_OUTCOME_STATUSES = Object.freeze(["Completada", "Bloqueada", "No realizada"]);
export const AGENCY_OBSERVED_RESULTS = Object.freeze(["Positivo", "Neutral", "Negativo", "Pendiente"]);
export const AGENCY_EVIDENCE_KINDS = Object.freeze(["Ninguna", "Pedido", "Lote", "Cliente", "Creativo", "Publicación", "Campaña", "Brief", "Decisión"]);

const clean = (value) => String(value ?? "").trim();

export function agencyOutcomeDefaults(item) {
  const blocked = Boolean(item?.blocked);
  return {
    completionStatus: blocked ? "Bloqueada" : "Completada",
    observedResult: "Pendiente",
    evidenceKind: blocked ? "Ninguna" : (item?.actionCode === "HUMAN_TRIAGE" ? "Decisión" : "Ninguna"),
    evidenceId: item?.actionCode === "HUMAN_TRIAGE" ? String(item?.decisionId || "") : "",
    actualCost: 0,
    summary: "",
  };
}

export function validateAgencyOutcome(form, item) {
  const completionStatus = clean(form?.completionStatus);
  const evidenceKind = clean(form?.evidenceKind) || "Ninguna";
  const evidenceId = clean(form?.evidenceId);
  const summary = clean(form?.summary);
  const actualCost = Number(form?.actualCost || 0);
  if (!AGENCY_OUTCOME_STATUSES.includes(completionStatus)) return "Elegí cómo terminó la acción.";
  if (!AGENCY_OBSERVED_RESULTS.includes(clean(form?.observedResult))) return "Elegí la lectura observada del resultado.";
  if (!AGENCY_EVIDENCE_KINDS.includes(evidenceKind)) return "Elegí un tipo de evidencia válido.";
  if (summary.length < 3 || summary.length > 280) return "Resumí el resultado en 3 a 280 caracteres.";
  if (!Number.isFinite(actualCost) || actualCost < 0) return "El costo real debe ser cero o positivo.";
  if (completionStatus === "Completada" && item?.blocked) return "Esta acción está protegida y no puede marcarse completada.";
  if (completionStatus === "Completada" && (evidenceKind === "Ninguna" || !evidenceId)) return "Una acción completada necesita evidencia interna.";
  if (evidenceKind !== "Ninguna" && !evidenceId) return "Indicá el identificador de la evidencia.";
  if (evidenceKind === "Ninguna" && evidenceId) return "Quitá el identificador o elegí su tipo de evidencia.";
  return "";
}

export function agencyOutcomePayload(item, form) {
  const error = validateAgencyOutcome(form, item);
  if (error) throw new Error(error);
  return {
    decision_id: Number(item.decisionId),
    completion_status: clean(form.completionStatus),
    observed_result: clean(form.observedResult),
    evidence_kind: clean(form.evidenceKind) || "Ninguna",
    evidence_id: clean(form.evidenceId),
    actual_cost: Number(form.actualCost || 0),
    summary: clean(form.summary),
  };
}
