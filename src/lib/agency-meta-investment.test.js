import test from "node:test";
import assert from "node:assert/strict";
import { buildInvestmentScenarios, buildMetaInvestmentCenter, investmentScenarioPayload, META_INVESTMENT_OPTIONS } from "./agency-meta-investment.js";

const base = { measurement: { id: 38, status: "Aprobada", incrementalSpend: 200000,
  result: { causalClaimAllowed: true, classification: "Incremental rentable", incrementalProfit: 300000, incrementalSpend: 200000 },
  localLifecycle: { new: { margin: 100000 }, returning: { margin: 300000 } } },
  campaign: { id: "CMP-01", budget: 400000 }, product: { id: "PR01", name: "Momo Gatito", active: true },
  stock: { official: 10, exactAvailable: 8, inProcess: 4, reservations: 3, expiringSoon: 1 }, kitchenQueue: 2,
  settings: { dailyBudgetLimit: 100000, campaignBudgetLimit: 500000, scaleStepPct: 15 } };

test("genera exactamente cuatro escenarios comparables sin ejecutar pauta", () => {
  const result = buildInvestmentScenarios(base, 7);
  assert.deepEqual(result.options.map((item) => item.key), META_INVESTMENT_OPTIONS);
  assert.equal(result.recommended, "Redistribuir");
  assert.equal(result.guards.executionForbidden, true);
  assert.equal(result.guards.budgetChangeForbidden, true);
});

test("stock agotado bloquea crecimiento aunque el lift sea rentable", () => {
  const result = buildInvestmentScenarios({ ...base, stock: { official: 0, exactAvailable: 0, inProcess: 0, reservations: 2 } }, 7);
  assert.equal(result.recommended, "Reducir");
  assert.ok(result.options.find((item) => item.key === "Conservar").blockers.length > 0);
});

test("una asociación observacional solo recomienda comprar evidencia", () => {
  const result = buildInvestmentScenarios({ ...base, measurement: { ...base.measurement,
    result: { ...base.measurement.result, causalClaimAllowed: false, classification: "Asociación observada" } } }, 7);
  assert.equal(result.recommended, "Experimento");
});

test("beneficio causal negativo recomienda reducir", () => {
  const result = buildInvestmentScenarios({ ...base, measurement: { ...base.measurement,
    result: { ...base.measurement.result, incrementalProfit: -50000 } } }, 7);
  assert.equal(result.recommended, "Reducir");
  assert.ok(result.options.every((item) => item.projection.low <= item.projection.high));
});

test("rechaza horizontes y mediciones no aprobadas", () => {
  assert.throws(() => buildInvestmentScenarios(base, 31), /horizonte/i);
  assert.throws(() => investmentScenarioPayload({ id: 2, status: "En revisión" }), /aprobada/i);
});

test("el payload solo identifica la fuente y no transporta una acción externa", () => {
  const payload = investmentScenarioPayload(base.measurement, 7);
  assert.equal(payload.measurement_id, 38);
  assert.equal("budget" in payload, false);
  assert.equal("publish" in payload, false);
  assert.equal("audience" in payload, false);
});

test("el centro separa candidatos y escenarios gobernados", () => {
  const center = buildMetaInvestmentCenter({ agencyMetaLiftMeasurements: [{ id: 1, status: "Aprobada" }, { id: 2, status: "Inconclusa" }],
    agencyMetaInvestmentScenarios: [{ id: 3, measurementId: 9, status: "En revisión", evidence: { stockBlocked: true }, options: [] }] });
  assert.equal(center.candidates.length, 1);
  assert.equal(center.summary.reviewing, 1);
  assert.equal(center.summary.blocked, 1);
});
