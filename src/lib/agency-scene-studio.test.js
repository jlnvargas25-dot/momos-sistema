import test from "node:test";
import assert from "node:assert/strict";
import { activeStoryboardShots, buildAgencySceneStudio, normalizeShotDraft, shotPayload, storyboardPayload, storyboardReadiness } from "./agency-scene-studio.js";

const contract = { id: 30, status: "Aprobado", sealedPayload: { creative_direction: { concept: "Abrir el relleno", call_to_action: "Pedí el tuyo" } } };
const storyboard = {
  id: 31, contractId: 30, status: "Borrador", targetDurationSec: 6,
  retentionPlan: { loops: [{ loop_id: "L1", open_sec: 0, close_sec: 6, promise: "¿Qué hay dentro?", payoff: "El relleno real" }] },
};
const shots = [
  { id: 1, storyboardId: 31, shotNumber: 1, status: "Vigente", durationSec: 3, estimatedCostCop: 1000, title: "Hook", purpose: "Abrir curiosidad", payload: { subject: "Momo", action: "Se abre", camera: "Macro fijo", continuity_out: "Relleno visible" } },
  { id: 2, storyboardId: 31, shotNumber: 2, status: "Vigente", durationSec: 3, estimatedCostCop: 1500, title: "Payoff", purpose: "Resolver", payload: { subject: "Relleno", action: "Cae lentamente", camera: "Dolly corto", continuity_out: "Logo y CTA" } },
];

test("normaliza una toma sin aceptar activos o costos inválidos", () => {
  const result = normalizeShotDraft({ shotNumber: -3, durationSec: 0, assetIds: [2, "3", -1, "x"], estimatedCostCop: -20 });
  assert.equal(result.shotNumber, 1);
  assert.equal(result.durationSec, 3);
  assert.deepEqual(result.assetIds, [2, 3]);
  assert.equal(result.estimatedCostCop, 0);
});

test("una toma sustituida no participa del corte vigente", () => {
  const result = activeStoryboardShots(storyboard, [...shots, { ...shots[0], id: 9, status: "Sustituida", revision: 1 }]);
  assert.deepEqual(result.map((item) => item.id), [1, 2]);
});

test("storyboard completo queda listo y suma costo", () => {
  const result = storyboardReadiness(storyboard, shots, [contract]);
  assert.equal(result.ready, true);
  assert.equal(result.totalDurationSec, 6);
  assert.equal(result.estimatedCostCop, 2500);
});

test("bloquea huecos, duración, dirección incompleta y loop abierto", () => {
  const result = storyboardReadiness({ ...storyboard, retentionPlan: { loops: [{ open_sec: 0, close_sec: 7, promise: "Promesa", payoff: "" }] } }, [
    { ...shots[0], shotNumber: 2, payload: { subject: "Momo" } },
  ], [contract]);
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /consecutivas/);
  assert.match(result.reasons.join(" "), /dirección verificable/);
  assert.match(result.reasons.join(" "), /suman/);
  assert.match(result.reasons.join(" "), /loop/);
});

test("el escritorio solo ofrece contratos aprobados sin storyboard activo", () => {
  const result = buildAgencySceneStudio({ agencyCreativeContracts: [contract, { id: 40, status: "Aprobado" }], agencyStoryboards: [storyboard], agencyStoryboardShots: shots });
  assert.deepEqual(result.eligibleContracts.map((item) => item.id), [40]);
  assert.equal(result.summary.drafting, 1);
  assert.equal(result.summary.shots, 2);
});

test("payloads conservan contrato, retención y dirección física", () => {
  const boardPayload = storyboardPayload({ title: "Max Oreo", targetDurationSec: 9, hook: "Mirá el centro", payoff: "Ganache real" }, contract);
  assert.equal(boardPayload.contract_id, 30);
  assert.equal(boardPayload.retention_plan.loops[0].close_sec, 9);
  const take = shotPayload({ shotNumber: 1, title: "Abrir", purpose: "Hook", subject: "Max", action: "Se parte", physics: "La cobertura resiste y cede", camera: "Macro", continuityOut: "Ganache visible" }, { id: 55 });
  assert.equal(take.storyboard_id, 55);
  assert.equal(take.shot.physics, "La cobertura resiste y cede");
});
