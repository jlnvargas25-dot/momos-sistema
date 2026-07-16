const FORBIDDEN_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|app[_-]?secret|password|service[_-]?role|authorization)/i;

export const MOMOS_AGENCY_MCP_VERSION = "1.0.0";

export const MOMOS_AGENCY_MCP_TOOLS = Object.freeze([
  "momos_health",
  "momos_agency_snapshot",
  "momos_meta_observatory",
  "momos_creative_context",
  "momos_submit_proposals",
]);

export const MOMOS_CREATIVE_CONTEXTS = Object.freeze([
  "routing",
  "motion",
  "quality",
  "retention",
]);

export const MOMOS_PROPOSAL_TOOLS = Object.freeze([
  "MOMO OPS lectura",
  "Inventario",
  "CRM",
  "Calendario",
  "Biblioteca de marca",
  "Kling",
  "Higgsfield",
  "Meta lectura",
  "TikTok lectura",
  "Distribución",
]);

const DECISION_TYPES = new Set([
  "Crear contenido", "Contactar segmento", "Activar campaña", "Pausar campaña",
  "Escalar presupuesto", "Reponer stock", "Revisar creativo", "Revisar oferta", "Otro",
]);

const asObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} debe ser un objeto.`);
  return value;
};

export function assertMcpPayloadSafe(value, path = "payload") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMcpPayloadSafe(item, `${path}[${index}]`));
    return value;
  }
  if (!value || typeof value !== "object") return value;
  Object.entries(value).forEach(([key, item]) => {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`El campo ${path}.${key} no puede atravesar el MCP.`);
    assertMcpPayloadSafe(item, `${path}.${key}`);
  });
  return value;
}

export function normalizeAgencyMcpSnapshot(value) {
  const envelope = asObject(value, "La respuesta del snapshot");
  const snapshot = asObject(envelope.snapshot, "El snapshot");
  const fingerprint = String(envelope.fingerprint || "").trim();
  if (!/^[0-9a-f]{32}$/.test(fingerprint)) throw new Error("El snapshot no tiene una huella válida.");
  if (snapshot.schema_version !== "momos-agency-context/v1") throw new Error("La versión del contexto MOMOS no es compatible.");
  if (snapshot.external_execution_allowed !== false) throw new Error("El contexto MCP intentó ampliar permisos externos.");
  assertMcpPayloadSafe(snapshot);
  return { fingerprint, snapshot };
}

export function creativeContextRpc(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  const routes = {
    routing: { rpc: "obtener_contexto_enrutamiento_agente", param: "p_storyboard_id" },
    motion: { rpc: "obtener_contexto_motion_agente", param: "p_storyboard_id" },
    quality: { rpc: "obtener_contexto_calidad_agente", param: "p_job_id" },
    retention: { rpc: "obtener_contexto_retencion_agente", param: "p_measurement_id" },
  };
  if (!routes[normalized]) throw new Error("El contexto creativo solicitado no pertenece a la lista cerrada.");
  return routes[normalized];
}

function normalizeProposal(value) {
  const proposal = asObject(value, "Cada propuesta");
  assertMcpPayloadSafe(proposal);
  const type = String(proposal.decisionType || proposal.decision_type || "").trim();
  const title = String(proposal.title || "").trim();
  const rationale = String(proposal.rationale || "").trim();
  const risk = String(proposal.riskLevel || proposal.risk_level || "Bajo").trim();
  const mode = String(proposal.executionMode || proposal.execution_mode || "Solo análisis").trim();
  const tools = [...new Set((proposal.requiredTools || proposal.required_tools || []).map((item) => String(item).trim()).filter(Boolean))];
  const confidence = Number(proposal.confidence);
  const estimated = Number(proposal.estimatedCostCop ?? proposal.estimated_cost_cop ?? 0);
  const cap = Number(proposal.costCapCop ?? proposal.cost_cap_cop ?? 0);
  if (!DECISION_TYPES.has(type)) throw new Error("Tipo de decisión MCP inválido.");
  if (title.length < 3 || title.length > 180 || rationale.length < 3 || rationale.length > 2000) throw new Error("Título o fundamento MCP inválido.");
  if (!['Bajo', 'Medio', 'Alto'].includes(risk)) throw new Error("Riesgo MCP inválido.");
  if (!['Solo análisis', 'Preparar borrador'].includes(mode)) throw new Error("El MCP no admite acciones externas.");
  if (!tools.length || tools.length > 12 || tools.some((tool) => !MOMOS_PROPOSAL_TOOLS.includes(tool))) throw new Error("La propuesta usa herramientas fuera de la lista cerrada.");
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Confianza MCP inválida.");
  if (![estimated, cap].every(Number.isFinite) || estimated < 0 || cap < estimated) throw new Error("Costo MCP inválido.");
  return {
    decision_type: type,
    title,
    rationale,
    evidence: asObject(proposal.evidence || {}, "La evidencia"),
    proposed_action: asObject(proposal.proposedAction || proposal.proposed_action || {}, "La acción propuesta"),
    required_tools: tools,
    confidence,
    risk_level: risk,
    estimated_cost_cop: estimated,
    cost_cap_cop: cap,
    execution_mode: mode,
    source: "Codex · MOMOS Agency MCP",
  };
}

export function buildAgencyMcpRun(input = {}) {
  assertMcpPayloadSafe(input);
  const requestKey = String(input.requestKey || input.request_key || "").trim();
  const fingerprint = String(input.snapshotFingerprint || input.snapshot_fingerprint || "").trim();
  const focus = String(input.focus || "").trim();
  const proposals = Array.isArray(input.proposals) ? input.proposals.map(normalizeProposal) : [];
  if (!/^[A-Za-z0-9:_-]{3,160}$/.test(requestKey)) throw new Error("La corrida MCP necesita una clave idempotente válida.");
  if (!/^[0-9a-f]{32}$/.test(fingerprint)) throw new Error("La corrida MCP necesita la huella exacta del snapshot.");
  if (focus.length < 3 || focus.length > 180) throw new Error("El foco MCP es inválido.");
  if (proposals.length > 12) throw new Error("Una corrida MCP admite máximo 12 propuestas.");
  return {
    run_key: `mcp:${requestKey}`,
    trigger_type: "Manual",
    focus,
    context_snapshot: {
      schema_version: "momos-agency-context/v1",
      snapshot_fingerprint: fingerprint,
      external_execution_allowed: false,
    },
    agent_name: "Codex · Cerebro de Agencia MOMOS",
    agent_version: MOMOS_AGENCY_MCP_VERSION,
    proposals,
  };
}

