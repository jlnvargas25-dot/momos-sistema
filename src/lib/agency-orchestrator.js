import { agencyDecisionType } from "./agency-intelligence.js";

const CONFIDENCE = { Alta: 0.9, Media: 0.7, Inicial: 0.55, Baja: 0.4 };

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function orchestratorToolsFor(recommendation = {}) {
  const tools = ["MOMO OPS lectura"];
  const pillar = String(recommendation.pillar || "");
  const type = String(recommendation.type || "");
  if (["Inventario", "Producto"].includes(pillar) || /stock|inventario/i.test(type)) tools.push("Inventario");
  if (pillar === "CRM" || /segmento|cliente|cumplea/i.test(type)) tools.push("CRM");
  if (pillar === "Pauta" || /campaña|presupuesto/i.test(type)) tools.push("Meta lectura", "TikTok lectura");
  if (["Contenido", "Marca"].includes(pillar) || /contenido|creativo/i.test(type)) tools.push("Biblioteca de marca", "Kling");
  return unique(tools);
}

export function orchestratorExecutionMode(recommendation = {}) {
  const type = String(recommendation.type || "");
  if (/contenido|creativo/i.test(type)) return "Preparar borrador";
  if (/campaña|presupuesto|contactar|segmento/i.test(type)) return "Acción externa";
  return "Solo análisis";
}

export function orchestratorProposalPayload(recommendation = {}) {
  const confidence = typeof recommendation.confidence === "number"
    ? recommendation.confidence
    : (CONFIDENCE[recommendation.confidence] ?? 0.6);
  const proposedCost = Math.max(0, Number(recommendation.proposedBudget || 0));
  return {
    proposal_key: String(recommendation.id || "").trim(),
    decision_type: agencyDecisionType(recommendation.type),
    title: String(recommendation.title || "").trim(),
    rationale: String(recommendation.rationale || "").trim(),
    evidence: recommendation.evidence || {},
    proposed_action: {
      product_id: recommendation.productId || null,
      campaign_id: recommendation.campaignId || null,
      creative_id: recommendation.creativeId || null,
      customer_ids: recommendation.customerIds || [],
      proposed_budget: proposedCost,
      next_step: recommendation.nextStep || "",
    },
    required_tools: orchestratorToolsFor(recommendation),
    confidence: Math.min(1, Math.max(0, confidence)),
    risk_level: recommendation.risk || "Bajo",
    estimated_cost_cop: proposedCost,
    cost_cap_cop: proposedCost,
    execution_mode: orchestratorExecutionMode(recommendation),
    source: "MOMO OPS intelligence",
  };
}

export function buildOrchestratorInbox(db = {}) {
  const proposals = [...(db.agencyAgentProposals || [])];
  const runs = [...(db.agencyAgentRuns || [])];
  const pending = proposals.filter((item) => item.status === "Propuesta");
  const converted = proposals.filter((item) => item.status === "Convertida");
  const discarded = proposals.filter((item) => item.status === "Descartada");
  return {
    runs,
    proposals,
    pending,
    summary: {
      runs: runs.length,
      pending: pending.length,
      converted: converted.length,
      discarded: discarded.length,
      estimatedCost: pending.reduce((sum, item) => sum + Math.max(0, Number(item.estimatedCostCop || 0)), 0),
      externalActions: pending.filter((item) => item.executionMode === "Acción externa").length,
    },
  };
}
