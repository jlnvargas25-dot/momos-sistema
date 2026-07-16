import test from "node:test";
import assert from "node:assert/strict";
import {
  activeStageAssignment, canOperateStage, dispatchHandoffFor, lineProgressFor,
  openOrderIncidents, operationalStageForOrder, stageProgressSummary,
} from "./operational-control.js";

test("ubica cada pedido en el área operativa correcta", () => {
  assert.equal(operationalStageForOrder({ estado: "Pagado" }), "Cocina");
  assert.equal(operationalStageForOrder({ estado: "Listo para empaque" }), "Empaque");
  assert.equal(operationalStageForOrder({ estado: "En ruta" }), "Logística");
  assert.equal(operationalStageForOrder({ estado: "Entregado" }), null);
});

test("separa quién puede tomar cada etapa", () => {
  assert.equal(canOperateStage("Cocina", "Cocina"), true);
  assert.equal(canOperateStage("Empaque", "Cocina"), false);
  assert.equal(canOperateStage("Administrador", "Logística"), true);
  assert.equal(canOperateStage("Mensajero", "Logística"), true);
});

test("acumula Cocina y Empaque sobre la misma identidad", () => {
  const roles = ["Cocina", "Empaque"];
  assert.equal(canOperateStage(roles, "Cocina"), true);
  assert.equal(canOperateStage(roles, "Empaque"), true);
  assert.equal(canOperateStage(roles, "Logística"), false);
});

test("un pedido conserva un único responsable activo por etapa", () => {
  const assignments = [
    { orderId: "P1", stage: "Cocina", status: "Liberada", user: "Ana" },
    { orderId: "P1", stage: "Cocina", status: "Activa", user: "Luz" },
  ];
  assert.equal(activeStageAssignment("P1", "Cocina", assignments).user, "Luz");
});

test("el progreso exige todas las líneas y falla cerrado ante incidentes", () => {
  const items = [{ id: "I1", orderId: "P1" }, { id: "I2", orderId: "P1" }];
  const partial = [{ orderId: "P1", orderItemId: "I1", stage: "Cocina", status: "Listo" }];
  assert.equal(lineProgressFor("P1", "Cocina", items, partial)[1].progress.status, "Pendiente");
  assert.equal(stageProgressSummary("P1", "Cocina", items, partial).ready, false);
  const complete = [...partial, { orderId: "P1", orderItemId: "I2", stage: "Cocina", status: "Listo" }];
  assert.equal(stageProgressSummary("P1", "Cocina", items, complete).ready, true);
  complete[1].status = "Incidente";
  assert.equal(stageProgressSummary("P1", "Cocina", items, complete).ready, false);
});

test("solo expone incidentes abiertos y el relevo del pedido exacto", () => {
  const incidents = [{ orderId: "P1", status: "Abierto" }, { orderId: "P1", status: "Resuelto" }];
  assert.equal(openOrderIncidents("P1", incidents).length, 1);
  assert.equal(dispatchHandoffFor("P2", [{ orderId: "P1" }, { orderId: "P2", status: "Aceptado" }]).status, "Aceptado");
});
