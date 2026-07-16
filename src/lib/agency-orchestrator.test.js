import test from "node:test";
import assert from "node:assert/strict";
import { buildOrchestratorInbox, orchestratorExecutionMode, orchestratorProposalPayload, orchestratorToolsFor } from "./agency-orchestrator.js";

test("mapea pauta a herramientas de lectura y nunca a publicación directa", () => {
  const recommendation = { id: "ad-1", type: "Activar campaña", pillar: "Pauta", title: "Probar anuncio", rationale: "Hay evidencia suficiente", confidence: "Alta", risk: "Medio", proposedBudget: 50000 };
  const payload = orchestratorProposalPayload(recommendation);
  assert.deepEqual(orchestratorToolsFor(recommendation), ["MOMO OPS lectura", "Meta lectura", "TikTok lectura"]);
  assert.equal(orchestratorExecutionMode(recommendation), "Acción externa");
  assert.equal(payload.confidence, 0.9);
  assert.equal(payload.cost_cap_cop, 50000);
  assert.equal(payload.proposed_action.proposed_budget, 50000);
  assert.equal(payload.required_tools.includes("Meta publicar"), false);
});

test("un creativo usa biblioteca y Kling como borrador humano", () => {
  const payload = orchestratorProposalPayload({ id: "creative-1", type: "Crear contenido", pillar: "Contenido", title: "Video Oreo", rationale: "El formato funcionó", confidence: "Media", risk: "Bajo" });
  assert.equal(payload.execution_mode, "Preparar borrador");
  assert.deepEqual(payload.required_tools, ["MOMO OPS lectura", "Biblioteca de marca", "Kling"]);
  assert.equal(payload.estimated_cost_cop, 0);
});

test("resume la bandeja sin mezclar propuestas resueltas", () => {
  const inbox = buildOrchestratorInbox({
    agencyAgentRuns: [{ id: 1 }],
    agencyAgentProposals: [
      { id: 1, status: "Propuesta", estimatedCostCop: 12000, executionMode: "Acción externa" },
      { id: 2, status: "Convertida", estimatedCostCop: 9000, executionMode: "Preparar borrador" },
      { id: 3, status: "Descartada", estimatedCostCop: 1000, executionMode: "Solo análisis" },
    ],
  });
  assert.equal(inbox.summary.pending, 1);
  assert.equal(inbox.summary.converted, 1);
  assert.equal(inbox.summary.discarded, 1);
  assert.equal(inbox.summary.estimatedCost, 12000);
  assert.equal(inbox.summary.externalActions, 1);
});
