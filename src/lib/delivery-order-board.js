const ACTIVE_DELIVERY_STATES = new Set(["Por solicitar", "Solicitado", "Asignado", "En ruta", "Problema"]);
const TERMINAL_DELIVERY_STATES = new Set(["Entregado", "Cancelado"]);
const READY_FOR_DELIVERY_STATES = new Set(["Empacado", "Listo para despacho"]);

function deliverySequence(delivery) {
  const match = String(delivery?.id || "").match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function newestDelivery(deliveries) {
  return [...deliveries].sort((left, right) => deliverySequence(right) - deliverySequence(left))[0] || null;
}

function orderSequence(order) {
  return `${String(order?.fecha || "")}T${String(order?.hora || "")}`;
}

/**
 * Convierte la logistica en una bandeja centrada en pedidos. Un pedido puede
 * tener varios intentos D-xxx, pero nunca se duplica como trabajo humano.
 */
export function buildDeliveryOrderBoard({ orders = [], deliveries = [], scope = "active" } = {}) {
  const deliveriesByOrder = new Map();
  deliveries.forEach((delivery) => {
    const orderId = String(delivery?.orderId || "").trim();
    if (!orderId) return;
    const current = deliveriesByOrder.get(orderId) || [];
    current.push(delivery);
    deliveriesByOrder.set(orderId, current);
  });

  const cards = [];
  orders.forEach((order) => {
    const attempts = deliveriesByOrder.get(order.id) || [];
    const activeAttempts = attempts.filter((delivery) => ACTIVE_DELIVERY_STATES.has(delivery.estado));
    const terminalAttempts = attempts.filter((delivery) => TERMINAL_DELIVERY_STATES.has(delivery.estado));
    const isRappi = order.canal === "Rappi";

    if (scope === "history") {
      if (!terminalAttempts.length) return;
      cards.push({
        order,
        delivery: newestDelivery(terminalAttempts),
        attempts: [...attempts].sort((left, right) => deliverySequence(right) - deliverySequence(left)),
        needsAssignment: false,
      });
      return;
    }

    const delivery = newestDelivery(activeAttempts);
    const needsAssignment = !delivery && READY_FOR_DELIVERY_STATES.has(order.estado) && !isRappi;
    if (!delivery && !needsAssignment) return;
    cards.push({
      order,
      delivery,
      attempts: [...attempts].sort((left, right) => deliverySequence(right) - deliverySequence(left)),
      needsAssignment,
    });
  });

  return cards.sort((left, right) => {
    if (left.needsAssignment !== right.needsAssignment) return left.needsAssignment ? -1 : 1;
    return orderSequence(left.order).localeCompare(orderSequence(right.order));
  });
}

export function deliveryNextStep(card) {
  if (!card?.delivery) return "Asignar proveedor y costo del domicilio";
  switch (card.delivery.estado) {
    case "Por solicitar": return "Enviar la solicitud al proveedor";
    case "Solicitado": return "Confirmar quién tomó el servicio";
    case "Asignado": return "Confirmar la salida del pedido";
    case "En ruta": return "Esperar y confirmar la entrega";
    case "Problema": return "Resolver la novedad antes de continuar";
    case "Entregado": return "Entrega completada";
    case "Cancelado": return "Solicitud cancelada";
    default: return "Revisar el seguimiento del domicilio";
  }
}
