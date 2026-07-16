const when = (order) => `${order?.fecha || ""} ${order?.hora || ""}`;
const byOldest = (left, right) => when(left).localeCompare(when(right));

export function buildPackingQueue(orders = [], handoffs = []) {
  const handoffByOrder = new Map((handoffs || []).filter((row) => row?.orderId).map((row) => [row.orderId, row]));
  const incoming = [];
  const pending = [];
  const packed = [];
  const handoff = [];

  for (const order of orders || []) {
    if (!order?.id) continue;
    if (order.estado === "En producción") incoming.push(order);
    else if (order.estado === "Listo para empaque") pending.push(order);
    else if (order.estado === "Empacado") packed.push(order);
    else if (order.estado === "Listo para despacho" && handoffByOrder.get(order.id)?.status !== "Aceptado") handoff.push(order);
  }

  incoming.sort(byOldest);
  pending.sort(byOldest);
  packed.sort(byOldest);
  handoff.sort(byOldest);
  return {
    incoming,
    pending,
    packed,
    handoff,
    activeIds: new Set([...pending, ...packed, ...handoff].map((order) => order.id)),
    visibleCount: incoming.length + pending.length + packed.length + handoff.length,
  };
}
