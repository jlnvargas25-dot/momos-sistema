import test from "node:test";
import assert from "node:assert/strict";
import { buildAgencyMotionCenter, buildMotionPlanDraft, motionPlanPayload, validateMotionProposal } from "./agency-motion-experience.js";

const storyboard = { id: 8, status: "Aprobado", title: "Reel MOMOS", targetDurationSec: 6, fingerprint: "board-fp" };
const shots = [
  { id: 10, storyboardId: 8, shotNumber: 1, status: "Vigente", title: "Abrir el Momo", purpose: "Revelar relleno", durationSec: 3,
    fingerprint: "shot-10", estimatedCostCop: 4000, payload: { subject: "Momo Gatito exacto", action: "Dos manos abren la cobertura", physics: "Ganache cae lento", camera: "macro", lighting: "key suave izquierda", continuity_out: "relleno centrado" } },
  { id: 11, storyboardId: 8, shotNumber: 2, status: "Vigente", title: "Hero final", purpose: "Cerrar con CTA", durationSec: 3,
    fingerprint: "shot-11", estimatedCostCop: 3000, payload: { subject: "Momo Gatito abierto", action: "queda estable", camera: "close", continuity_in: "relleno centrado", continuity_out: "copy space" } },
];

test("crea de una a tres propuestas por toma y selecciona exactamente una", () => {
  const draft = buildMotionPlanDraft(storyboard, shots);
  assert.equal(draft.ready, true);
  assert.equal(draft.shotRecipes.length, 2);
  draft.shotRecipes.forEach((item) => { assert.equal(item.proposals.length, 2); assert.equal(item.proposals.filter((p) => p.selected).length, 1); });
});

test("cada receta conserva cámara, luz, física, continuidad y negativos", () => {
  const recipe = buildMotionPlanDraft(storyboard, shots).shotRecipes[0].selected;
  assert.equal(validateMotionProposal(recipe).ready, true);
  assert.match(recipe.generationPrompt, /gravedad|materia/i);
  assert.equal(recipe.lightingMap.lightingChange, "none");
  assert.ok(recipe.negativeConstraints.includes("no product substitution"));
  assert.match(recipe.transitionToNext.type, /match|corte/i);
});

test("intacto no se confunde con CTA y una fractura conserva el match on action", () => {
  const crackShot = { ...shots[0], title: "El crack", purpose: "Detener el scroll con prueba sensorial", payload: {
    ...shots[0].payload,
    subject: "Max Oreo real e intacto",
    action: "La cuchara fractura la cobertura una sola vez",
  } };
  const draft = buildMotionPlanDraft(storyboard, [crackShot, shots[1]]);
  assert.equal(draft.shotRecipes[0].selected.intent.narrativeJob, "Demostrar");
  assert.equal(draft.shotRecipes[0].selected.transitionToNext.type, "Match on action");
});

test("el humano puede elegir la alternativa orgánica sin mezclar propuestas", () => {
  const first = buildMotionPlanDraft(storyboard, shots);
  const organicKey = first.shotRecipes[0].proposals[1].proposalKey;
  const draft = buildMotionPlanDraft(storyboard, shots, { 10: organicKey });
  assert.equal(draft.shotRecipes[0].selected.proposalKey, organicKey);
  assert.equal(draft.shotRecipes[0].selected.handheldProfile.mode, "supported-organic");
});

test("un storyboard no aprobado nunca obtiene receta accionable", () => {
  const draft = buildMotionPlanDraft({ ...storyboard, status: "En revisión" }, shots);
  assert.equal(draft.ready, false);
  assert.throws(() => motionPlanPayload(draft), /aprobación humana/i);
});

test("el payload no crea trabajos, no publica y conserva las huellas exactas", () => {
  const payload = motionPlanPayload(buildMotionPlanDraft(storyboard, shots));
  assert.equal(payload.storyboard_id, 8);
  assert.deepEqual(payload.shots.map((shot) => shot.shot_fingerprint), ["shot-10", "shot-11"]);
  payload.shots.flatMap((shot) => shot.proposals).forEach((proposal) => {
    assert.match(proposal.proposal_key, /^[A-Za-z0-9:_-]{3,220}$/);
  });
  assert.equal(payload.shots[0].proposals[1].proposal_key, "organica-10");
  assert.equal("provider" in payload, false);
  assert.equal("publish" in payload, false);
});

test("el centro ofrece solo storyboards aprobados todavía no gobernados", () => {
  const center = buildAgencyMotionCenter({ agencyStoryboards: [storyboard, { ...storyboard, id: 9 }], agencyMotionPlans: [{ id: 20, storyboardId: 8, status: "Aprobado" }], agencyMotionRecipes: [], agencyMotionObservations: [] });
  assert.deepEqual(center.eligibleStoryboards.map((item) => item.id), [9]);
  assert.equal(center.summary.approved, 1);
});
