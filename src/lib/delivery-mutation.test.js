import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDeliveryMutationEnvelope } from "./delivery-mutation.js";

function orderDelta(orderId = "P-1082", deliveryId = "D-282", version = "12") {
  return {
    contract: "momos.order-delta-batch.v1",
    serverTime: "2026-07-19T18:00:00Z",
    containsSecrets: false,
    externalExecution: false,
    deltas: [{
      contract: "momos.order-delta.v1",
      orderId,
      version,
      order: { id: orderId, customerId: "C01" },
      customer: { id: "C01" },
      orderItems: [],
      deliveries: [{ id: deliveryId, orderId, estado: "Solicitado" }],
      evidences: [],
      benefits: [],
      claims: [],
      inventoryReservations: [],
      productionSuggestions: [],
      auditLogs: [],
      packingVerifications: [],
      orderStageAssignments: [],
      orderLineProgress: [],
      orderIncidents: [],
      orderDispatchHandoffs: [],
    }],
  };
}

function envelope(overrides = {}) {
  return {
    contract: "momos.delivery-mutation.v1",
    operation: "assign",
    idempotencyKey: "82000000-0000-4000-8000-000000000001",
    duplicate: false,
    orderId: "P-1082",
    deliveryId: "D-282",
    orderDelta: orderDelta(),
    containsCustomerPii: true,
    containsSecrets: false,
    externalExecution: false,
    ...overrides,
  };
}

test("H82 acepta una mutación logística con el pedido del mismo commit", () => {
  const normalized = normalizeDeliveryMutationEnvelope(envelope(), "assign");
  assert.equal(normalized.orderDelta.deltas[0].version, "12");
  assert.equal(normalized.orderDelta.deltas[0].deliveries[0].id, "D-282");
});

test("H82 conserva el mismo contrato al responder un reintento idempotente", () => {
  const normalized = normalizeDeliveryMutationEnvelope(envelope({ duplicate: true }), "assign");
  assert.equal(normalized.duplicate, true);
});

test("H82 falla cerrado ante campos extra, secretos u operación distinta", () => {
  assert.throws(() => normalizeDeliveryMutationEnvelope({ ...envelope(), actor: "U01" }), /cerrado H82/i);
  assert.throws(() => normalizeDeliveryMutationEnvelope(envelope({ containsSecrets: true })), /privacidad/i);
  assert.throws(() => normalizeDeliveryMutationEnvelope(envelope(), "update"), /operación solicitada/i);
});

test("H82 rechaza domicilios o pedidos cruzados", () => {
  assert.throws(() => normalizeDeliveryMutationEnvelope(envelope({ orderId: "P-OTRO" })), /mezcló otro pedido/i);
  assert.throws(() => normalizeDeliveryMutationEnvelope(envelope({ deliveryId: "D-OTRO" })), /domicilio confirmado/i);
});
