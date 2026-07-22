import test from "node:test";
import assert from "node:assert/strict";
import { agencyActionDestination, buildAgencyActionQueue } from "./agency-action-queue.js";

const safeQueue = (items) => ({
  allowed: true, contains_pii: false, free_text_exposed: false,
  external_execution_allowed: false, items,
});

test("convierte cada decisión en una sola tarjeta y recupera el contexto humano autorizado", () => {
  const center = buildAgencyActionQueue(safeQueue([
    { decision_id: 12, decision_type: "Reponer stock", next_action_code: "REVIEW_PRODUCTION_PLAN", next_action_label: "Revisar producción", route: "/produccion", area: "Producción", stage: "Planificación", external_execution: false },
    { decision_id: 12, decision_type: "Reponer stock", next_action_code: "HUMAN_TRIAGE", route: "/agencia", external_execution: false },
  ]), [{ id: 12, title: "Reponer faltantes", rationale: "Hay cinco sugerencias pendientes" }]);
  assert.equal(center.items.length, 1);
  assert.equal(center.items[0].title, "Reponer faltantes");
  assert.deepEqual(agencyActionDestination(center.items[0]), { module: "Producción", anchor: "agency-approval-center" });
});

test("dirige los gates creativos al panel exacto sin abandonar Agencia", () => {
  const center = buildAgencyActionQueue(safeQueue([
    { decision_id: 20, decision_type: "Crear contenido", next_action_code: "CREATE_STORYBOARD", route: "/creativos", external_execution: false },
    { decision_id: 21, decision_type: "Crear contenido", next_action_code: "REVIEW_MOTION_PLAN", route: "/creativos", external_execution: false },
    { decision_id: 22, decision_type: "Crear contenido", next_action_code: "REVIEW_SCENE_QUALITY", route: "/creativos", external_execution: false },
  ]));
  assert.equal(center.items[0].anchor, "agency-scene-studio");
  assert.equal(center.items[1].anchor, "agency-motion-experience");
  assert.equal(center.items[2].anchor, "agency-quality-control");
  assert.ok(center.items.every((item) => item.module === "Crecimiento"));
});

test("falla cerrado ante rutas nuevas o ejecución externa", () => {
  const center = buildAgencyActionQueue(safeQueue([
    { decision_id: 30, next_action_code: "UNKNOWN", route: "/inyectada", external_execution: true },
  ]));
  assert.equal(center.items[0].blocked, true);
  assert.equal(center.items[0].blockerCode, "UNKNOWN_ROUTE");
  assert.equal(center.safe, false);
});

test("un rol no autorizado recibe una bandeja vacía", () => {
  const center = buildAgencyActionQueue({ allowed: false, items: [{ decision_id: 99 }] });
  assert.equal(center.allowed, false);
  assert.deepEqual(center.items, []);
});
