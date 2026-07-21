import { normalizeOrderDeltaBatch } from "./order-delta.js";

export const DELIVERY_MUTATION_CONTRACT = "momos.delivery-mutation.v1";
export const DELIVERY_MUTATION_OPERATIONS = Object.freeze(["assign", "update", "transition"]);

const TOP_LEVEL_KEYS = Object.freeze([
  "containsCustomerPii",
  "containsSecrets",
  "contract",
  "deliveryId",
  "duplicate",
  "externalExecution",
  "idempotencyKey",
  "operation",
  "orderDelta",
  "orderId",
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requiredText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeDeliveryMutationEnvelope(envelope, expectedOperation = "") {
  if (!exactKeys(envelope, TOP_LEVEL_KEYS)) {
    throw new Error("La respuesta logística no cumple el contrato cerrado H82.");
  }
  if (envelope.contract !== DELIVERY_MUTATION_CONTRACT
      || !DELIVERY_MUTATION_OPERATIONS.includes(envelope.operation)
      || (expectedOperation && envelope.operation !== expectedOperation)) {
    throw new Error("La respuesta logística no corresponde a la operación solicitada.");
  }
  if (!requiredText(envelope.idempotencyKey) || !requiredText(envelope.orderId)
      || !requiredText(envelope.deliveryId) || typeof envelope.duplicate !== "boolean") {
    throw new Error("La respuesta logística no identifica de forma segura su mutación.");
  }
  if (envelope.containsCustomerPii !== true || envelope.containsSecrets !== false
      || envelope.externalExecution !== false) {
    throw new Error("La respuesta logística abrió una frontera de privacidad no autorizada.");
  }
  const orderDelta = normalizeOrderDeltaBatch(envelope.orderDelta);
  if (orderDelta.deltas.length !== 1 || orderDelta.deltas[0].orderId !== envelope.orderId) {
    throw new Error("La respuesta logística mezcló otro pedido.");
  }
  if (!orderDelta.deltas[0].deliveries.some((delivery) => delivery.id === envelope.deliveryId)) {
    throw new Error("La respuesta logística no contiene el domicilio confirmado.");
  }
  return { ...envelope, orderDelta };
}
