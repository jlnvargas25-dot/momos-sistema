import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENCY_MODE_METRICS,
  agencyContractConstraints,
  agencyContractDirection,
  agencyRoomPayload,
  buildAgencyCollaborationDesk,
  collaborationRoomReadiness,
} from "./agency-collaboration.js";

test("una mesa exige cooperación humana y del agente", () => {
  const room = { id: 7, status: "Abierta" };
  assert.equal(collaborationRoomReadiness(room, [], []).readyForContract, false);
  assert.equal(collaborationRoomReadiness(room, [{ roomId: 7, authorKind: "Humano" }], []).readyForContract, false);
  const ready = collaborationRoomReadiness(room, [
    { roomId: 7, authorKind: "Humano" },
    { roomId: 7, authorKind: "Agente" },
  ], []);
  assert.equal(ready.readyForContract, true);
  assert.equal(ready.humanCount, 1);
  assert.equal(ready.agentCount, 1);
});

test("resume contratos sin confundir borradores con aprobados", () => {
  const desk = buildAgencyCollaborationDesk({
    agencyCollaborationRooms: [{ id: 1, status: "Abierta" }, { id: 2, status: "Cerrada" }],
    agencyCollaborationEntries: [
      { roomId: 1, authorKind: "Humano" }, { roomId: 1, authorKind: "Agente" },
    ],
    agencyCreativeContracts: [
      { id: 10, roomId: 1, version: 1, status: "En revisión" },
      { id: 11, roomId: 2, version: 1, status: "Aprobado" },
    ],
  });
  assert.equal(desk.summary.open, 1);
  assert.equal(desk.summary.pendingApproval, 1);
  assert.equal(desk.summary.approved, 1);
  assert.equal(desk.rooms[0].readiness.latestContract.id, 10);
});

test("crea payloads sin permitir que la capa creativa cambie las guardas", () => {
  const room = agencyRoomPayload({ kind: "decision", id: 4, title: "Impulsar Oreo", rationale: "Hay margen" });
  assert.equal(room.room_key, "mesa-decision-4");
  assert.equal(room.decision_id, 4);
  const direction = agencyContractDirection({ concept: "Abrir el relleno", audience: "Recompra", channel: "Instagram", primaryKpi: "Vistas" }, room);
  assert.equal(direction.primary_kpi, "Beneficio incremental");
  const constraints = agencyContractConstraints({ mustAvoid: "precios inventados" });
  assert.equal(constraints.product_fidelity_required, true);
  assert.equal(constraints.human_review_required, true);
  assert.equal(constraints.paid_and_organic_separated, true);
});

test("pauta y orgánico conservan contratos de éxito distintos", () => {
  const paid = agencyContractDirection({ contentMode: "Pauta", modePrimaryMetric: "CPA", concept: "Corte", audience: "Nuevos", channel: "Instagram" });
  const organic = agencyContractDirection({ contentMode: "Orgánico", modePrimaryMetric: "Guardados", concept: "Proceso", audience: "Comunidad", channel: "Instagram" });
  assert.equal(paid.content_mode, "Pauta");
  assert.equal(paid.mode_primary_metric, "CPA");
  assert.equal(organic.content_mode, "Orgánico");
  assert.equal(organic.mode_primary_metric, "Guardados");
  assert.equal(AGENCY_MODE_METRICS.Pauta.includes(organic.mode_primary_metric), false);
});
