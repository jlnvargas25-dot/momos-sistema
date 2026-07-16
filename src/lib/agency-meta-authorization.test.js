import test from "node:test";
import assert from "node:assert/strict";
import { authorizationRequestGuard, buildMetaAuthorizationCenter, isAuthorizationLive, metaAuthorizationPayload } from "./agency-meta-authorization.js";

const scenario = { id: 39, status: "Aprobado", evidence: { stockBlocked: false, limits: { campaignBudgetLimit: 500000 } }, options: [
  { key: "Conservar", proposedBudget: 400000 }, { key: "Reducir", proposedBudget: 340000 },
  { key: "Redistribuir", proposedBudget: 400000 }, { key: "Experimento", proposedBudget: 60000 },
] };

test("separa una autorización ejecutable de la aprobación analítica", () => {
  const guard = authorizationRequestGuard({ scenario, optionKey: "Reducir", audienceExternalId: "aud_meta_123", targetBudget: 340000,
    validMinutes: 60, justification: "Reducir exposición mientras recuperamos inventario.", settings: { campaignBudgetLimit: 500000 } });
  assert.equal(guard.allowed, true);
  assert.equal(guard.executionMode, "Simulación");
  assert.equal(guard.externalMutationForbidden, true);
});

test("no permite cambiar el presupuesto sellado de una alternativa", () => {
  const guard = authorizationRequestGuard({ scenario, optionKey: "Reducir", audienceExternalId: "aud_meta_123", targetBudget: 1000,
    validMinutes: 60, justification: "Intento manipular el presupuesto de la opción.", settings: { campaignBudgetLimit: 500000 } });
  assert.equal(guard.allowed, false);
  assert.match(guard.reasons.join(" "), /no coincide/i);
});

test("stock bloqueado solo admite reducir exposición", () => {
  const blocked = { ...scenario, evidence: { ...scenario.evidence, stockBlocked: true } };
  const conserve = authorizationRequestGuard({ scenario: blocked, optionKey: "Conservar", audienceExternalId: "aud_meta_123", targetBudget: 400000,
    validMinutes: 60, justification: "Mantener la campaña mientras no existe inventario.", settings: { campaignBudgetLimit: 500000 } });
  const reduce = authorizationRequestGuard({ scenario: blocked, optionKey: "Reducir", audienceExternalId: "aud_meta_123", targetBudget: 340000,
    validMinutes: 60, justification: "Reducir exposición porque no existe inventario.", settings: { campaignBudgetLimit: 500000 } });
  assert.equal(conserve.allowed, false);
  assert.equal(reduce.allowed, true);
});

test("una alternativa con bloqueos operativos no obtiene permiso", () => {
  const guarded = { ...scenario, options: scenario.options.map((option) => option.key === "Conservar"
    ? { ...option, blockers: ["Cocina tiene cinco o más pedidos activos."] } : option) };
  const result = authorizationRequestGuard({ scenario: guarded, optionKey: "Conservar", audienceExternalId: "aud_meta_123",
    targetBudget: 400000, validMinutes: 60, justification: "Mantener exposición después de revisar capacidad.",
    settings: { campaignBudgetLimit: 500000 } });
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /bloqueos operativos/i);
});

test("exige audiencia exacta, vigencia corta y justificación", () => {
  const guard = authorizationRequestGuard({ scenario, optionKey: "Experimento", audienceExternalId: "", targetBudget: 60000,
    validMinutes: 600, justification: "poco", settings: { campaignBudgetLimit: 500000 } });
  assert.equal(guard.allowed, false);
  assert.equal(guard.reasons.length, 3);
});

test("el payload conserva solo el contrato y mantiene simulación", () => {
  const payload = metaAuthorizationPayload({ scenario, optionKey: "Experimento", audienceExternalId: "aud_test_01", validMinutes: 45,
    justification: "Comprar evidencia nueva con un límite pequeño.", settings: { campaignBudgetLimit: 500000 } });
  assert.equal(payload.target_budget, 60000);
  assert.equal(payload.execution_mode, "Simulación");
  assert.equal("access_token" in payload, false);
  assert.equal("publish" in payload, false);
});

test("una autorización vencida deja de estar viva", () => {
  assert.equal(isAuthorizationLive({ status: "Autorizada", validUntil: "2026-07-16T12:00:00Z" }, new Date("2026-07-16T11:59:00Z")), true);
  assert.equal(isAuthorizationLive({ status: "Autorizada", validUntil: "2026-07-16T12:00:00Z" }, new Date("2026-07-16T12:00:01Z")), false);
  assert.equal(isAuthorizationLive({ status: "Incierta", validUntil: "2026-07-16T13:00:00Z" }, new Date("2026-07-16T11:00:00Z")), false);
});

test("el centro no ofrece dos autorizaciones activas para el mismo escenario", () => {
  const center = buildMetaAuthorizationCenter({ agencyMetaInvestmentScenarios: [scenario, { ...scenario, id: 40 }],
    agencyMetaInvestmentAuthorizations: [{ id: 1, scenarioId: 39, status: "Autorizada", validUntil: "2026-07-16T13:00:00Z" }],
    agencyMetaInvestmentExecutionJobs: [{ id: 7, authorizationId: 1, status: "Autorizado" }] }, new Date("2026-07-16T12:00:00Z"));
  assert.deepEqual(center.candidates.map((item) => item.id), [40]);
  assert.equal(center.authorizations[0].job.id, 7);
  assert.equal(center.summary.authorized, 1);
});
