import test from "node:test";
import assert from "node:assert/strict";
import {
  MOMOS_AGENCY_MCP_TOOLS,
  assertMcpPayloadSafe,
  buildAgencyMcpRun,
  creativeContextRpc,
  normalizeAgencyMcpSnapshot,
} from "./momos-agency-mcp.js";

test("el MCP publica una superficie pequeña y sin SQL libre", () => {
  assert.deepEqual(MOMOS_AGENCY_MCP_TOOLS, [
    "momos_health", "momos_agency_snapshot", "momos_meta_observatory",
    "momos_creative_context", "momos_submit_proposals",
  ]);
  assert.equal(MOMOS_AGENCY_MCP_TOOLS.some((name) => /sql|shell|publish|budget/i.test(name)), false);
});

test("el snapshot exige versión, huella y cero ejecución externa", () => {
  const value = normalizeAgencyMcpSnapshot({
    fingerprint: "a".repeat(32),
    snapshot: { schema_version: "momos-agency-context/v1", external_execution_allowed: false, orders: { active: 2 } },
  });
  assert.equal(value.snapshot.orders.active, 2);
  assert.throws(() => normalizeAgencyMcpSnapshot({ fingerprint: "a".repeat(32), snapshot: { schema_version: "momos-agency-context/v1", external_execution_allowed: true } }), /ampliar permisos/);
});

test("ningún secreto puede cruzar el MCP aunque esté anidado", () => {
  assert.throws(() => assertMcpPayloadSafe({ evidence: { access_token: "x" } }), /no puede atravesar/);
  assert.doesNotThrow(() => assertMcpPayloadSafe({ evidence: { paid_orders: 3 } }));
});

test("los contextos creativos se resuelven por lista fija", () => {
  assert.deepEqual(creativeContextRpc("motion"), { rpc: "obtener_contexto_motion_agente", param: "p_storyboard_id" });
  assert.throws(() => creativeContextRpc("orders"), /lista cerrada/);
  assert.throws(() => creativeContextRpc("rpc_anything"), /lista cerrada/);
});

test("la propuesta queda sellada como borrador y nunca como acción externa", () => {
  const run = buildAgencyMcpRun({
    requestKey: "decision-2026-07-16-01",
    snapshotFingerprint: "b".repeat(32),
    focus: "Preparar la mejor oportunidad comercial",
    proposals: [{
      decisionType: "Crear contenido", title: "Probar un hook de producto",
      rationale: "Las ventas pagadas y el stock vigente permiten preparar un borrador.",
      evidence: { paid_orders: 4 }, proposedAction: { proposed_budget: 0 },
      requiredTools: ["MOMO OPS lectura", "Biblioteca de marca"], confidence: 0.82,
      riskLevel: "Bajo", estimatedCostCop: 0, costCapCop: 0, executionMode: "Preparar borrador",
    }],
  });
  assert.equal(run.run_key, "mcp:decision-2026-07-16-01");
  assert.equal(run.context_snapshot.external_execution_allowed, false);
  assert.equal(run.proposals[0].source, "Codex · MOMOS Agency MCP");
  assert.throws(() => buildAgencyMcpRun({ ...run, requestKey: "unsafe-run", snapshotFingerprint: "b".repeat(32), focus: "Acción peligrosa", proposals: [{ ...run.proposals[0], execution_mode: "Acción externa" }] }), /no admite acciones externas/);
});

test("la propuesta rechaza herramientas y costos abiertos", () => {
  const base = {
    requestKey: "safe-run", snapshotFingerprint: "c".repeat(32), focus: "Revisar contenido",
    proposals: [{ decision_type: "Otro", title: "Revisar una decisión", rationale: "Existe evidencia suficiente para una revisión humana.", evidence: {}, proposed_action: {}, required_tools: ["MOMO OPS lectura"], confidence: 0.5, risk_level: "Bajo", estimated_cost_cop: 0, cost_cap_cop: 0, execution_mode: "Solo análisis" }],
  };
  assert.throws(() => buildAgencyMcpRun({ ...base, proposals: [{ ...base.proposals[0], required_tools: ["Shell"] }] }), /lista cerrada/);
  assert.throws(() => buildAgencyMcpRun({ ...base, proposals: [{ ...base.proposals[0], estimated_cost_cop: 10, cost_cap_cop: 5 }] }), /Costo MCP inválido/);
});

