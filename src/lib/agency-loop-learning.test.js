import test from "node:test";
import assert from "node:assert/strict";
import { buildAgencyLoopLearningCenter, diagnoseRetentionMeasurement, loopDiagnosticPayload, normalizeRetentionCurve, retentionAt } from "./agency-loop-learning.js";

const script = {
  id: 7, targetDurationSec: 15, platform: "Instagram Reels", audience: "Amantes de postres premium", fingerprint: "script-fp",
  snapshot: { beat_map: [
    { beat: 1, label: "Hook", start_sec: 0, end_sec: 3, purpose: "Promesa y producto" },
    { beat: 2, label: "Prueba", start_sec: 3, end_sec: 10, purpose: "Demostración real" },
    { beat: 3, label: "Payoff y CTA", start_sec: 10, end_sec: 15, purpose: "Cerrar respuesta" },
  ] },
};
const measurement = {
  id: 21, platform: "Instagram", sampleSize: 220, impressions: 300, starts: 250, views3s: 200, views100: 100,
  clicks: 20, paidOrders: 4, incrementalProfit: 45000, publicationFingerprint: "publication-fp",
  retentionCurve: [{ sec: 0, pct: 1 }, { sec: 3, pct: .82 }, { sec: 10, pct: .5 }, { sec: 15, pct: .4 }],
};
const experiment = { id: 9, scriptId: 7, fingerprint: "experiment-fp" };
const hook = { id: 11, fingerprint: "hook-fp" };
const loops = [{ id: 5, scriptId: 7, loopKey: "L1", question: "¿Qué hay dentro?", openSec: 0, closeSec: 12, payoff: "Ganache real" }];

test("la curva exige cobertura temporal y orden, sin inventar puntos", () => {
  assert.equal(normalizeRetentionCurve([{ sec: 0, pct: 1 }, { sec: 3, pct: .8 }], 15).ready, false);
  assert.equal(normalizeRetentionCurve(measurement.retentionCurve, 15).ready, true);
  assert.equal(retentionAt(measurement.retentionCurve, 6.5), .66);
});

test("la curva acumulada no puede volver a subir", () => {
  const result = normalizeRetentionCurve([
    { sec: 0, pct: 1 }, { sec: 3, pct: .7 }, { sec: 8, pct: .82 }, { sec: 15, pct: .4 },
  ], 15);
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /no puede aumentar/i);
});

test("localiza la mayor caída dentro del beat y la describe sin afirmar causalidad", () => {
  const result = diagnoseRetentionMeasurement({ measurement, script, experiment, hook, loops });
  assert.equal(result.ready, true);
  assert.equal(result.beats[1].label, "Prueba");
  assert.equal(result.testedVariable, "Prueba temprana");
  assert.match(result.primarySignal, /asociación temporal, no una causa demostrada/i);
  assert.equal(result.guardrails.noAutoPublication, true);
});

test("una muestra pequeña nunca se convierte en aprendizaje accionable", () => {
  const result = diagnoseRetentionMeasurement({ measurement: { ...measurement, sampleSize: 99 }, script, experiment, hook, loops });
  assert.equal(result.ready, false);
  assert.throws(() => loopDiagnosticPayload(result), /100 observaciones/);
});

test("el payload cambia una sola variable y mantiene generación y publicación cerradas", () => {
  const result = diagnoseRetentionMeasurement({ measurement, script, experiment, hook, loops });
  const payload = loopDiagnosticPayload(result);
  assert.equal(payload.tested_variable, "Prueba temprana");
  assert.equal(payload.guardrails.one_variable, true);
  assert.equal(payload.guardrails.no_auto_generation, true);
  assert.equal(payload.guardrails.no_auto_publication, true);
});

test("el centro no vuelve a diagnosticar una medición ya gobernada", () => {
  const center = buildAgencyLoopLearningCenter({
    agencyRetentionScripts: [script], agencyRetentionHooks: [hook], agencyRetentionLoops: loops,
    agencyRetentionExperiments: [experiment], agencyRetentionMeasurements: [{ ...measurement, experimentId: 9, hookId: 11 }],
    agencyRetentionDiagnostics: [{ id: 30, measurementId: 21, status: "En revisión" }], agencyRetentionLearnings: [],
  });
  assert.equal(center.candidates.length, 0);
  assert.equal(center.pending.length, 1);
});
