import test from "node:test";
import assert from "node:assert/strict";
import { agencyOutcomeDefaults, agencyOutcomePayload, validateAgencyOutcome } from "./agency-action-outcome.js";

test("un triaje propone evidencia de la misma decisión", () => {
  assert.deepEqual(agencyOutcomeDefaults({ decisionId: 14, actionCode: "HUMAN_TRIAGE", blocked: false }), {
    completionStatus: "Completada", observedResult: "Pendiente", evidenceKind: "Decisión",
    evidenceId: "14", actualCost: 0, summary: "",
  });
});

test("una acción completada exige evidencia interna", () => {
  const error = validateAgencyOutcome({ completionStatus: "Completada", observedResult: "Neutral", evidenceKind: "Ninguna", evidenceId: "", actualCost: 0, summary: "Trabajo terminado" }, { blocked: false });
  assert.match(error, /evidencia interna/i);
});

test("una acción bloqueada nunca se convierte en completada", () => {
  const error = validateAgencyOutcome({ completionStatus: "Completada", observedResult: "Pendiente", evidenceKind: "Decisión", evidenceId: "9", actualCost: 0, summary: "Se intentó cerrar" }, { blocked: true });
  assert.match(error, /protegida/i);
});

test("el payload queda cerrado y no transporta ejecución externa", () => {
  const payload = agencyOutcomePayload({ decisionId: 12, blocked: false }, {
    completionStatus: "Completada", observedResult: "Positivo", evidenceKind: "Lote",
    evidenceId: "L-046", actualCost: "15000", summary: "Lote creado según el plan",
  });
  assert.deepEqual(payload, {
    decision_id: 12, completion_status: "Completada", observed_result: "Positivo",
    evidence_kind: "Lote", evidence_id: "L-046", actual_cost: 15000, summary: "Lote creado según el plan",
  });
  assert.equal("external_execution" in payload, false);
});
