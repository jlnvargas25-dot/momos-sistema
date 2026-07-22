import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOrderDeltaBatch, applyOrderDeltaBatchToDb, compareOrderDeltaVersions, normalizeOrderDeltaBatch,
} from "./order-delta.js";

function delta(orderId = "P-2000", version = "7") {
  return {
    contract: "momos.order-delta.v1", orderId, version,
    order: { id: orderId, estado: "Listo para empaque", customerId: "C-1" },
    customer: { id: "C-1", nombre: "Cliente actualizado" },
    orderItems: [{ id: "OI-2", orderId, nombre: "Max" }],
    deliveries: [{ id: "D-2", orderId }],
    evidences: [{ id: "E-2", orderId, tipo: "Caja abierta" }],
    benefits: [{ id: "B-2", customerId: "C-1", pedidoUso: orderId }],
    claims: [], inventoryReservations: [{ id: "R-2", orderId }],
    productionSuggestions: [{ id: "S-2", orderId }],
    auditLogs: [{ id: "A-2", entidadId: orderId }],
    packingVerifications: [{ orderId, lineIds: ["OI-2"] }],
    orderStageAssignments: [{ id: "AS-2", orderId }],
    orderLineProgress: [{ orderItemId: "OI-2", orderId }],
    orderIncidents: [{ id: "IN-2", orderId }],
    orderDispatchHandoffs: [{ orderId, status: "Ofrecido" }],
  };
}

function envelope(...deltas) {
  return {
    contract: "momos.order-delta-batch.v1", serverTime: "2026-07-19T12:00:00Z",
    containsSecrets: false, externalExecution: false, deltas,
  };
}

test("H71 reemplaza solo el grafo de la orden solicitada", () => {
  const db = {
    orders: [{ id: "P-1000", estado: "Pagado", customerId: "C-1" }, { id: "P-OTRA" }],
    order_items: [{ id: "OI-OLD", orderId: "P-1000" }, { id: "OI-X", orderId: "P-OTRA" }],
    customers: [{ id: "C-1", nombre: "Antes" }, { id: "C-X" }],
    deliveries: [], evidences: [], benefits: [{ id: "B-OLD", customerId: "C-1" }], claims: [],
    inventory_reservations: [], production_suggestions: [], audit_logs: [], packing_verifications: [],
    order_stage_assignments: [], order_line_progress: [], order_incidents: [], order_dispatch_handoffs: [],
  };
  const result = applyOrderDeltaBatchToDb(db, envelope(delta("P-1000", "7")));
  assert.deepEqual(result, { status: "applied", applied: ["P-1000"], stale: [] });
  assert.equal(db.orders.find((row) => row.id === "P-1000").estado, "Listo para empaque");
  assert.ok(db.orders.some((row) => row.id === "P-OTRA"));
  assert.ok(db.order_items.some((row) => row.id === "OI-X"));
  assert.ok(!db.order_items.some((row) => row.id === "OI-OLD"));
  assert.equal(db.customers.find((row) => row.id === "C-1").nombre, "Cliente actualizado");
  assert.equal(db.orderDeltaVersions["P-1000"], "7");
});

test("H71 descarta respuestas repetidas o antiguas sin tocar el estado", () => {
  const db = {
    orders: [{ id: "P-2000", estado: "Empacado", customerId: "C-1" }], orderDeltaVersions: { "P-2000": "10" },
    order_items: [], customers: [], deliveries: [], evidences: [], benefits: [], claims: [],
    inventory_reservations: [], production_suggestions: [], audit_logs: [], packing_verifications: [],
    order_stage_assignments: [], order_line_progress: [], order_incidents: [], order_dispatch_handoffs: [],
  };
  const result = applyOrderDeltaBatchToDb(db, envelope(delta("P-2000", "9")));
  assert.equal(result.status, "stale");
  assert.equal(db.orders[0].estado, "Empacado");
  assert.equal(compareOrderDeltaVersions("90071992547409930", "90071992547409929"), 1);
});

test("H88 aplica un pedido sin clonar ni mutar dominios ajenos", () => {
  const unrelated = Array.from({ length: 25000 }, (_, id) => ({ id, payload: `row-${id}` }));
  const db = {
    orders: [{ id: "P-1000", estado: "Pagado", customerId: "C-1" }],
    order_items: [], customers: [{ id: "C-1", nombre: "Antes" }], deliveries: [], evidences: [],
    benefits: [], claims: [], inventory_reservations: [], production_suggestions: [], audit_logs: [],
    packing_verifications: [], order_stage_assignments: [], order_line_progress: [], order_incidents: [],
    order_dispatch_handoffs: [], orderDeltaVersions: {}, agencyStoryboards: unrelated,
  };
  const result = applyOrderDeltaBatch(db, envelope(delta("P-1000", "7")));
  assert.equal(db.orders[0].estado, "Pagado");
  assert.equal(db.orderDeltaVersions["P-1000"], undefined);
  assert.equal(result.db.orders.find((row) => row.id === "P-1000").estado, "Listo para empaque");
  assert.equal(result.db.agencyStoryboards, unrelated);
  assert.equal(result.db.orderDeltaVersions["P-1000"], "7");
});

test("H71 falla cerrado ante contratos, versiones o duplicados inválidos", () => {
  assert.throws(() => normalizeOrderDeltaBatch({ contract: "otro", deltas: [] }), /contrato esperado/);
  assert.throws(() => normalizeOrderDeltaBatch(envelope({ ...delta(), version: "1.5" })), /versión válida/);
  assert.throws(() => normalizeOrderDeltaBatch(envelope({ ...delta(), version: "0" })), /versión válida/);
  assert.throws(() => normalizeOrderDeltaBatch(envelope(delta(), delta())), /repitió un pedido/);
  assert.throws(() => normalizeOrderDeltaBatch({ ...envelope(delta()), containsSecrets: true }), /frontera no autorizada/);
  assert.throws(() => normalizeOrderDeltaBatch(envelope({ ...delta(), orderItems: undefined })), /orderItems/);
  assert.throws(() => normalizeOrderDeltaBatch(envelope({
    ...delta(), deliveries: [{ id: "D-X", orderId: "P-OTRA" }],
  })), /deliveries/);
  assert.throws(() => normalizeOrderDeltaBatch(envelope({
    ...delta(), benefits: [{ id: "B-X", customerId: "C-OTRO", pedidoUso: "" }],
  })), /beneficios/);
});
