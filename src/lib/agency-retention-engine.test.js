import test from "node:test";
import assert from "node:assert/strict";
import { buildAgencyRetentionCenter, retentionScriptPayload, scoreRetentionHook, validateRetentionArchitecture } from "./agency-retention-engine.js";

const strongScores = { clarity: 2, relevance: 2, specificity: 2, proof: 2, novelty: 1, payoff_fit: 2, brand_fit: 2, honesty: 2 };

test("un hook no gana si la promesa no tiene prueba u honestidad", () => {
  assert.equal(scoreRetentionHook({ ...strongScores, proof: 1 }).eligible, false);
  assert.equal(scoreRetentionHook(strongScores).eligible, true);
});

test("la arquitectura exige control, retador, loop cerrado y un único hook seleccionado", () => {
  const base = {
    promise: "Vas a ver el relleno real", payoff: "El ganache aparece al abrir el Momo", callToAction: "Pedí el tuyo",
    targetDurationSec: 15,
    hooks: [{ selected: true, scores: strongScores }, { selected: false, scores: strongScores }],
    beatMap: [{ label: "Hook", startSec: 0, endSec: 3 }, { label: "Prueba", startSec: 3, endSec: 10 }, { label: "Payoff", startSec: 10, endSec: 15 }],
    loops: [{ question: "¿Qué hay adentro?", openSec: 0, closeSec: 12, payoff: "Ganache real" }],
  };
  assert.equal(validateRetentionArchitecture(base).ready, true);
  assert.equal(validateRetentionArchitecture({ ...base, loops: [] }).ready, false);
  assert.equal(validateRetentionArchitecture({ ...base, hooks: base.hooks.map((hook) => ({ ...hook, selected: true })) }).ready, false);
});

test("payload normaliza el contrato sin convertir el CTA en payoff", () => {
  const payload = retentionScriptPayload({
    promise: "Mirá el centro", payoff: "Relleno visible", callToAction: "Pedilo", targetDurationSec: 15,
    hooks: [{ hookText: "No lo cortes todavía", selected: true, scores: strongScores }, { hookText: "Esperá al centro", scores: strongScores }],
    beatMap: [{ label: "Hook", startSec: 0, endSec: 3 }], loops: [{ question: "¿Qué esconde?", openSec: 0, closeSec: 12, payoff: "Relleno visible" }],
  }, { id: 7, sealedPayload: {} });
  assert.equal(payload.contract_id, 7);
  assert.equal(payload.call_to_action, "Pedilo");
  assert.equal(payload.loops[0].payoff, "Relleno visible");
});

test("centro solo ofrece contratos aprobados sin guion activo", () => {
  const center = buildAgencyRetentionCenter({
    agencyCreativeContracts: [{ id: 1, status: "Aprobado" }, { id: 2, status: "En revisión" }],
    agencyRetentionScripts: [{ id: 9, contractId: 1, status: "En revisión", targetDurationSec: 15, snapshot: {} }],
  });
  assert.equal(center.eligibleContracts.length, 0);
  assert.equal(center.pending.length, 1);
});
