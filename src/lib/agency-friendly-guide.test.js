import test from "node:test";
import assert from "node:assert/strict";
import { buildFriendlyAgencyGuide } from "./agency-friendly-guide.js";

const contract = { id: 14, status: "Aprobado", sealedPayload: { creative_direction: { content_mode: "Orgánico", content_goal: "Mostrar Max Oreo", mode_primary_metric: "Retención" } } };

test("traduce diez gates técnicos a seis pasos humanos", () => {
  const guide = buildFriendlyAgencyGuide({
    agencyCreativeContracts: [contract],
    agencyRetentionScripts: [{ id: 1, contractId: 14, status: "Aprobado", title: "Max Oreo" }],
    agencyStoryboards: [{ id: 9, contractId: 14, status: "Aprobado", title: "Max Oreo · crack y centro real" }],
    agencyMotionPlans: [{ id: 4, storyboardId: 9, status: "Aprobado" }],
  });
  assert.equal(guide.activeFlight.phases.length, 6);
  assert.equal(guide.activeFlight.completed, 2);
  assert.equal(guide.activeFlight.current.label, "Creación");
  assert.equal(guide.activeFlight.current.target, "agency-scene-router");
  assert.equal(guide.activeFlight.progress, 33);
});

test("elige una recomendación humana para cada objetivo sin mezclar áreas", () => {
  const intelligence = { recommendations: [
    { id: "C", pillar: "Contenido", type: "Crear contenido" },
    { id: "P", pillar: "Producto", type: "Impulsar producto" },
    { id: "R", pillar: "CRM", type: "Contactar segmento" },
  ] };
  const guide = buildFriendlyAgencyGuide({}, intelligence, { summary: { published: 4, conclusive: 2, winners: 1 } });
  assert.equal(guide.recommendations.content.id, "C");
  assert.equal(guide.recommendations.sales.id, "P");
  assert.equal(guide.recommendations.customers.id, "R");
  assert.deepEqual(guide.results, { published: 4, conclusive: 2, winners: 1 });
});
