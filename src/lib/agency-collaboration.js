const clean = (value) => String(value ?? "").trim();
const list = (value) => Array.isArray(value) ? value : [];

export const AGENCY_COLLABORATION_ENTRY_TYPES = Object.freeze([
  "Aporte", "Pregunta", "Propuesta", "Objeción", "Respuesta", "Decisión",
]);

export const AGENCY_CONTRACT_KPIS = Object.freeze([
  "Beneficio incremental", "Margen incremental", "Ventas incrementales", "Recompra",
]);

export const AGENCY_CONTENT_MODES = Object.freeze(["Pauta", "Orgánico"]);
export const AGENCY_MODE_METRICS = Object.freeze({
  Pauta: ["Beneficio incremental", "Pedidos pagados", "CPA", "ROAS"],
  "Orgánico": ["Retención", "Finalización", "Compartidos", "Guardados", "Conversación cualificada"],
});

export function collaborationRoomReadiness(room = {}, entries = [], contracts = []) {
  const roomEntries = list(entries).filter((entry) => String(entry.roomId) === String(room.id));
  const roomContracts = list(contracts).filter((contract) => String(contract.roomId) === String(room.id));
  const humanCount = roomEntries.filter((entry) => entry.authorKind === "Humano").length;
  const agentCount = roomEntries.filter((entry) => entry.authorKind === "Agente").length;
  const latestContract = [...roomContracts].sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0] || null;
  const reasons = [];
  if (room.status === "Cerrada" || room.status === "Cancelada") reasons.push("La mesa ya no admite nuevos acuerdos.");
  if (humanCount === 0) reasons.push("Falta el criterio humano de marca.");
  if (agentCount === 0) reasons.push("Falta una propuesta del cerebro de Agencia.");
  return {
    readyForContract: reasons.length === 0,
    reasons,
    humanCount,
    agentCount,
    totalEntries: roomEntries.length,
    latestContract,
    hasApprovedContract: roomContracts.some((contract) => contract.status === "Aprobado"),
  };
}

export function buildAgencyCollaborationDesk(db = {}) {
  const rooms = list(db.agencyCollaborationRooms).map((room) => ({
    ...room,
    readiness: collaborationRoomReadiness(room, db.agencyCollaborationEntries, db.agencyCreativeContracts),
  }));
  const contracts = list(db.agencyCreativeContracts);
  const open = rooms.filter((room) => ["Abierta", "Contrato listo"].includes(room.status));
  return {
    rooms,
    open,
    closed: rooms.filter((room) => ["Cerrada", "Cancelada"].includes(room.status)),
    contracts,
    summary: {
      open: open.length,
      waitingForHuman: open.filter((room) => room.readiness.humanCount === 0).length,
      waitingForAgent: open.filter((room) => room.readiness.agentCount === 0).length,
      pendingApproval: contracts.filter((contract) => contract.status === "En revisión").length,
      approved: contracts.filter((contract) => contract.status === "Aprobado").length,
    },
  };
}

export function agencyRoomPayload(source = {}, objective = "") {
  const decisionId = source.decisionId || (source.kind === "decision" ? source.id : null);
  const briefId = source.briefId || (source.kind === "brief" ? source.id : null);
  const sourceKey = decisionId ? `decision-${decisionId}` : `brief-${briefId}`;
  return {
    room_key: `mesa-${sourceKey}`,
    title: clean(source.title) || "Mesa de dirección MOMOS",
    objective: clean(objective) || clean(source.rationale) || "Convertir una oportunidad comercial en una acción creativa rentable.",
    decision_id: decisionId || null,
    brief_id: briefId || null,
  };
}

export function agencyContractDirection(input = {}, room = {}) {
  const contentMode = AGENCY_CONTENT_MODES.includes(input.contentMode) ? input.contentMode : "Orgánico";
  const allowedMetrics = AGENCY_MODE_METRICS[contentMode];
  return {
    concept: clean(input.concept),
    audience: clean(input.audience),
    channel: clean(input.channel),
    primary_kpi: AGENCY_CONTRACT_KPIS.includes(input.primaryKpi) ? input.primaryKpi : "Beneficio incremental",
    content_mode: contentMode,
    content_goal: clean(input.contentGoal),
    mode_primary_metric: allowedMetrics.includes(input.modePrimaryMetric) ? input.modePrimaryMetric : allowedMetrics[0],
    human_intent: clean(input.humanIntent),
    call_to_action: clean(input.callToAction),
    room_title: clean(room.title),
  };
}

export function agencyContractConstraints(input = {}) {
  return {
    must_include: clean(input.mustInclude),
    must_avoid: clean(input.mustAvoid),
    product_fidelity_required: true,
    human_review_required: true,
    no_unapproved_claims: true,
    paid_and_organic_separated: true,
  };
}
