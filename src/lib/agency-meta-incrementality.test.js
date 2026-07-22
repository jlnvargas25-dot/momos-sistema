import test from "node:test";
import assert from "node:assert/strict";
import { buildMetaIncrementalityCenter, evaluateLiftMeasurement, liftStudyPayload, validateLiftStudy } from "./agency-meta-incrementality.js";

const study = { studyKey: "lift-meta-cmp-01", diagnosticId: 37, design: "Meta Conversion Lift", lifecycleScope: "Todos",
  windowStart: "2026-07-01T00:00:00-05:00", windowEnd: "2026-07-15T00:00:00-05:00", minimumPerArm: 100,
  randomized: true, externalStudyId: "META-LIFT-CMP-01", hypothesis: "La campaña aumenta compradores pagados frente al control." };

test("un diseño causal exige aleatorización, ventana y muestra mínima", () => {
  assert.equal(validateLiftStudy(study).ready, true);
  const invalid = validateLiftStudy({ ...study, randomized: false, minimumPerArm: 20 });
  assert.equal(invalid.ready, false);
  assert.match(invalid.reasons.join(" "), /aleatoria|100/i);
});

test("Meta exige id oficial, ventana acotada y muestra entera", () => {
  const validation = validateLiftStudy({ studyKey: "lift-meta-2", diagnosticId: 8, design: "Meta Conversion Lift",
    lifecycleScope: "Todos", windowStart: "2026-01-01", windowEnd: "2026-04-01", minimumPerArm: 100.5,
    randomized: true, externalStudyId: "", hypothesis: "La campaña produce compradores incrementales verificables." });
  assert.equal(validation.ready, false);
  assert.ok(validation.reasons.some((reason) => reason.includes("62 días")));
  assert.ok(validation.reasons.some((reason) => reason.includes("identificador oficial")));
  assert.ok(validation.reasons.some((reason) => reason.includes("enteras")));
});

test("calcula lift y beneficio incremental con denominadores explícitos", () => {
  const result = evaluateLiftMeasurement({ control: { population: 1000, buyers: 50, orders: 52, revenue: 900000, margin: 500000 },
    exposed: { population: 1000, buyers: 90, orders: 95, revenue: 1710000, margin: 950000 }, spend: 200000 }, study);
  assert.equal(result.ready, true);
  assert.equal(result.controlRatePct, 5);
  assert.equal(result.exposedRatePct, 9);
  assert.equal(result.causalClaimAllowed, true);
  assert.equal(result.classification, "Incremental rentable");
  assert.ok(result.incrementalProfit > 0);
});

test("una muestra pequeña siempre queda inconclusa", () => {
  const result = evaluateLiftMeasurement({ control: { population: 20, buyers: 1, orders: 1, revenue: 10000, margin: 5000 },
    exposed: { population: 20, buyers: 4, orders: 4, revenue: 40000, margin: 20000 }, spend: 1000 }, study);
  assert.equal(result.sampleSufficient, false);
  assert.equal(result.causalClaimAllowed, false);
  assert.equal(result.classification, "Muestra insuficiente");
});

test("una comparación observacional nunca declara causalidad", () => {
  const result = evaluateLiftMeasurement({ control: { population: 1000, buyers: 20, orders: 20, revenue: 200000, margin: 100000 },
    exposed: { population: 1000, buyers: 100, orders: 100, revenue: 2000000, margin: 1000000 }, spend: 0 },
    { ...study, design: "Observacional", randomized: false });
  assert.equal(result.significant, true);
  assert.equal(result.causalClaimAllowed, false);
  assert.equal(result.classification, "Asociación observada");
});

test("rechaza compradores que superan la población", () => {
  const result = evaluateLiftMeasurement({ control: { population: 100, buyers: 101, orders: 101, revenue: 1000, margin: 500 },
    exposed: { population: 100, buyers: 5, orders: 5, revenue: 1000, margin: 500 }, spend: 0 }, study);
  assert.equal(result.ready, false);
  assert.match(result.reasons[0], /no cuadran/i);
});

test("rechaza celdas incompletas aunque los faltantes parezcan cero", () => {
  const result = evaluateLiftMeasurement({ spend: 0,
    control: { population: 100, buyers: 2, orders: 2, revenue: 100 },
    exposed: { population: 100, buyers: 4, orders: 4, revenue: 200, margin: 80 } },
  { design: "Holdout aleatorio MOMOS", randomized: true, minimumPerArm: 100 });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((reason) => reason.includes("margin")));
});

test("el payload no incluye publicación, pausa ni presupuesto", () => {
  const payload = liftStudyPayload(study);
  assert.equal(payload.assignment_snapshot.randomized, true);
  assert.equal("publish" in payload, false);
  assert.equal("pause" in payload, false);
  assert.equal("budget" in payload, false);
});

test("el centro separa candidatos, revisión y beneficio aprobado", () => {
  const center = buildMetaIncrementalityCenter({ agencyMetaDiagnostics: [{ id: 37, status: "Aprobado" }, { id: 38, status: "Devuelto" }],
    agencyMetaLiftStudies: [{ id: 1, diagnosticId: 99 }], agencyMetaLiftMeasurements: [{ id: 2, studyId: 1, status: "En revisión", result: { incrementalProfit: 5000 } }] });
  assert.equal(center.candidates.length, 1);
  assert.equal(center.summary.reviewing, 1);
  assert.equal(center.summary.profit, 0);
});
