const text = (value) => String(value ?? "").trim();

const MODULE_BY_ROUTE = Object.freeze({
  "/produccion": "Producción",
  "/clientes": "Clientes",
  "/creativos": "Crecimiento",
  "/agencia": "Crecimiento",
});

const ANCHOR_BY_ACTION = Object.freeze({
  OPEN_COLLABORATION_ROOM: "agency-collaboration-desk",
  PREPARE_CREATIVE_CONTRACT: "agency-collaboration-desk",
  REVIEW_CREATIVE_CONTRACT: "agency-collaboration-desk",
  CREATE_STORYBOARD: "agency-scene-studio",
  COMPLETE_STORYBOARD: "agency-scene-studio",
  REVIEW_STORYBOARD: "agency-scene-studio",
  PREPARE_MOTION_PLAN: "agency-motion-experience",
  REVIEW_MOTION_PLAN: "agency-motion-experience",
  REVISE_MOTION_PLAN: "agency-motion-experience",
  PREPARE_SCENE_ROUTING: "agency-scene-router",
  AUTHORIZE_SCENE_ROUTING: "agency-scene-router",
  REVIEW_ROUTING_JOBS: "agency-scene-router",
  WAIT_FOR_GENERATION: "agency-scene-router",
  REVIEW_GENERATION_FAILURE: "agency-scene-router",
  REVISE_GENERATED_OUTPUT: "agency-quality-control",
  REVIEW_GENERATED_OUTPUT: "agency-quality-control",
  REVIEW_SCENE_QUALITY: "agency-quality-control",
  CORRECT_REJECTED_SCENES: "agency-quality-control",
  PREPARE_POSTPRODUCTION: "agency-quality-control",
  REVIEW_POSTPRODUCTION: "agency-quality-control",
  REVISE_POSTPRODUCTION: "agency-quality-control",
  PREPARE_DISTRIBUTION: "agency-distribution-room",
  REVIEW_COMMERCIAL_OFFER: "agency-approval-center",
  REVIEW_CAMPAIGN_SCENARIO: "agency-approval-center",
  HUMAN_TRIAGE: "agency-approval-center",
});

export const AGENCY_ACTION_TARGET_IDS = Object.freeze([...new Set(Object.values(ANCHOR_BY_ACTION))]);

function normalizeItem(raw, decisionById) {
  const decisionId = Number(raw?.decision_id ?? raw?.decisionId);
  const actionCode = text(raw?.next_action_code ?? raw?.nextActionCode);
  const route = text(raw?.route);
  const decision = decisionById.get(String(decisionId));
  const unknownRoute = !MODULE_BY_ROUTE[route];
  const distribution = actionCode === "PREPARE_DISTRIBUTION";
  return {
    decisionId,
    decisionType: text(raw?.decision_type ?? raw?.decisionType),
    riskLevel: text(raw?.risk_level ?? raw?.riskLevel) || "Bajo",
    actionCode,
    actionLabel: text(raw?.next_action_label ?? raw?.nextActionLabel) || "Revisar el siguiente paso",
    stage: text(raw?.stage) || "Coordinación",
    area: text(raw?.area) || "Agencia MOMOS",
    route,
    module: distribution ? "Calendario" : (MODULE_BY_ROUTE[route] || "Crecimiento"),
    anchor: ANCHOR_BY_ACTION[actionCode] || "agency-approval-center",
    blocked: Boolean(raw?.blocked) || unknownRoute,
    blockerCode: unknownRoute ? "UNKNOWN_ROUTE" : text(raw?.blocker_code ?? raw?.blockerCode),
    humanActionRequired: raw?.human_action_required ?? raw?.humanActionRequired ?? true,
    externalExecution: Boolean(raw?.external_execution ?? raw?.externalExecution),
    title: text(decision?.title) || `Decisión #${decisionId}`,
    rationale: text(decision?.rationale),
  };
}

export function buildAgencyActionQueue(queue, decisions = []) {
  const decisionById = new Map(decisions.map((item) => [String(item.id), item]));
  const allowed = queue?.allowed !== false;
  const source = allowed && Array.isArray(queue?.items) ? queue.items : [];
  const seen = new Set();
  const items = source.map((item) => normalizeItem(item, decisionById)).filter((item) => {
    if (!Number.isFinite(item.decisionId) || !item.actionCode || seen.has(item.decisionId)) return false;
    seen.add(item.decisionId);
    return true;
  });
  return {
    ready: Boolean(queue),
    allowed,
    items,
    summary: {
      total: items.length,
      human: items.filter((item) => item.humanActionRequired).length,
      blocked: items.filter((item) => item.blocked).length,
      system: items.filter((item) => !item.humanActionRequired).length,
    },
    safe: queue?.contains_pii === false
      && queue?.free_text_exposed === false
      && queue?.external_execution_allowed === false
      && items.every((item) => item.externalExecution === false),
  };
}

export function agencyActionDestination(item) {
  if (!item) return { module: "Crecimiento", anchor: "agency-approval-center" };
  return { module: item.module || "Crecimiento", anchor: item.anchor || "agency-approval-center" };
}
