import { compareOperationalDatesDesc, parseOperationalTimestamp } from "./operational-time.js";

const ORDER_TERMINAL = new Set(["Entregado", "Cancelado"]);
const PRODUCTION_ACTIVE = new Set(["En preparación", "Congelando"]);
const PACKING_ACTIVE = new Set(["Listo para empaque", "Empacado"]);
const PACKING_HISTORY = new Set(["Listo para despacho", "En ruta", "Entregado", "Reclamo"]);
const DELIVERY_TERMINAL = new Set(["Entregado", "Cancelado"]);
const CLAIM_TERMINAL = new Set(["Rechazado", "Compensado", "Cerrado"]);

const clean = (value) => String(value || "").trim();

export function isActiveOrder(order) {
  return Boolean(order) && !ORDER_TERMINAL.has(order.estado);
}

export function isActiveProductionBatch(batch) {
  return Boolean(batch) && PRODUCTION_ACTIVE.has(batch.estado);
}

export function isActivePackingOrder(order) {
  return Boolean(order) && PACKING_ACTIVE.has(order.estado);
}

export function isPackingHistoryOrder(order, db = {}) {
  if (!order || isActivePackingOrder(order)) return false;
  if (PACKING_HISTORY.has(order.estado)) return true;
  const orderId = order.id;
  return (db.packing_verifications || []).some((row) => row.orderId === orderId)
    || (db.audit_logs || []).some((row) => row.entidadId === orderId
      && [row.de, row.a].some((state) => PACKING_ACTIVE.has(state) || PACKING_HISTORY.has(state)));
}

export function isActiveDelivery(delivery) {
  return Boolean(delivery) && !DELIVERY_TERMINAL.has(delivery.estado);
}

export function isActiveClaim(claim) {
  return Boolean(claim) && !CLAIM_TERMINAL.has(claim.estado);
}

export function isActiveInventoryReservation(reservation) {
  return clean(reservation?.estado).toLocaleLowerCase("es") === "reservada";
}

export function buildInventoryHistory(db = {}) {
  const movements = (db.inventory_movements || []).map((movement) => {
    const quantityLabel = clean(movement.cant);
    const quantity = Number.parseFloat(quantityLabel.replace(",", "."));
    return {
      id: `movement:${movement.id}`,
      sourceId: clean(movement.id),
      at: clean(movement.fecha),
      kind: "movement",
      type: clean(movement.tipo) || "Movimiento",
      item: clean(movement.item) || "Insumo",
      quantity: Number.isFinite(quantity) ? quantity : 0,
      quantityLabel: quantityLabel || "0",
      orderId: "",
      status: clean(movement.tipo) || "Movimiento",
      note: clean(movement.nota),
    };
  });

  const reservations = (db.inventory_reservations || [])
    .filter((reservation) => !isActiveInventoryReservation(reservation))
    .map((reservation) => ({
      id: `reservation:${reservation.id}`,
      sourceId: clean(reservation.id),
      at: clean(reservation.fecha),
      kind: "reservation",
      type: "Reserva",
      item: clean(reservation.nombre) || "Inventario reservado",
      quantity: Number(reservation.cantidad || 0),
      quantityLabel: clean(reservation.cantidad) || "0",
      orderId: clean(reservation.orderId),
      status: clean(reservation.estado) || "Cerrada",
      note: reservation.orderId ? `Pedido ${reservation.orderId}` : "Reserva sin pedido asociado",
    }));

  return [...movements, ...reservations]
    .sort((a, b) => compareOperationalDatesDesc(a.at, b.at) || b.id.localeCompare(a.id));
}

export function buildActiveReservationDashboard(db = {}, now = new Date()) {
  const orders = new Map((db.orders || []).map((order) => [order.id, order]));
  const customers = new Map((db.customers || []).map((customer) => [customer.id, customer]));
  const nowTimestamp = now instanceof Date ? now.getTime() : parseOperationalTimestamp(now);
  const terminalStates = new Set(["Entregado", "Cancelado", "Reclamo"]);
  const reservations = (db.inventory_reservations || [])
    .filter(isActiveInventoryReservation)
    .map((reservation) => {
      const order = orders.get(reservation.orderId) || null;
      const customer = order ? customers.get(order.customerId) : null;
      const createdAt = parseOperationalTimestamp(reservation.fecha);
      const ageHours = createdAt != null && nowTimestamp != null
        ? Math.max(0, Math.floor((nowTimestamp - createdAt) / 3600000))
        : null;
      const reasons = [];
      if (!order) reasons.push("Pedido inexistente");
      else if (terminalStates.has(order.estado)) reasons.push(`Pedido ${order.estado.toLocaleLowerCase("es")}`);
      if (ageHours != null && ageHours >= 8) reasons.push(`Lleva ${ageHours} h reservada`);
      return {
        ...reservation,
        quantity: Number(reservation.cantidad || 0),
        order,
        orderState: order?.estado || "Sin pedido",
        customerName: customer?.nombre || order?.cliente || "Cliente sin identificar",
        ageHours,
        exactSource: Boolean(reservation.batchId),
        sourceLabel: reservation.batchId
          ? `Lote ${reservation.batchId}${reservation.figuraLote ? ` · ${reservation.figuraLote}` : ""}`
          : reservation.tipo === "producto" ? "Sin lote físico exacto" : "Stock de insumo o empaque",
        attention: reasons.length > 0,
        attentionReasons: reasons,
      };
    })
    .sort((a, b) => Number(b.attention) - Number(a.attention)
      || (b.ageHours ?? -1) - (a.ageHours ?? -1)
      || compareOperationalDatesDesc(a.fecha, b.fecha));

  const grouped = [...reservations.reduce((groups, reservation) => {
    const key = reservation.orderId || `missing:${reservation.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        orderId: reservation.orderId || "Sin pedido",
        orderState: reservation.orderState,
        customerName: reservation.customerName,
        rows: [], quantity: 0, attention: false, reasons: new Set(), oldestHours: null,
      });
    }
    const group = groups.get(key);
    group.rows.push(reservation);
    group.quantity += reservation.quantity;
    group.attention ||= reservation.attention;
    reservation.attentionReasons.forEach((reason) => group.reasons.add(reason));
    if (reservation.ageHours != null) group.oldestHours = Math.max(group.oldestHours ?? 0, reservation.ageHours);
    return groups;
  }, new Map()).values()].map((group) => ({ ...group, reasons: [...group.reasons] }))
    .sort((a, b) => Number(b.attention) - Number(a.attention) || (b.oldestHours ?? -1) - (a.oldestHours ?? -1));

  return {
    reservations,
    groups: grouped,
    summary: {
      reservations: reservations.length,
      orders: grouped.length,
      quantity: reservations.reduce((sum, reservation) => sum + reservation.quantity, 0),
      exact: reservations.filter((reservation) => reservation.exactSource).length,
      attention: reservations.filter((reservation) => reservation.attention).length,
    },
  };
}

export function partitionByActivity(rows = [], predicate) {
  return rows.reduce((result, row) => {
    result[predicate(row) ? "active" : "history"].push(row);
    return result;
  }, { active: [], history: [] });
}

const AREA_BY_ENTITY = new Map([
  ["Pedido", "Pedidos"], ["Evidencia", "Pedidos"],
  ["Lote", "Producción"], ["Producción", "Producción"], ["Corrida", "Producción"], ["Subreceta", "Producción"],
  ["Empaque", "Empaque"], ["Verificación de empaque", "Empaque"], ["Relevo", "Empaque"],
  ["Domicilio", "Domicilios"], ["Entrega", "Domicilios"],
  ["Reclamo", "Reclamos"],
  ["Inventario", "Inventario"], ["Insumo", "Inventario"], ["Lote de insumo", "Inventario"], ["Movimiento", "Inventario"],
  ["Producto", "Productos"], ["Receta", "Productos"],
  ["Cliente", "Clientes"], ["CRM", "Clientes"], ["Activación", "Clientes"], ["Beneficio", "Clientes"],
  ["Campaña", "Agencia MOMOS"], ["Creativo", "Agencia MOMOS"], ["Publicación", "Agencia MOMOS"], ["Brief", "Agencia MOMOS"], ["Decisión", "Agencia MOMOS"],
  ["Usuario", "Configuración"], ["Configuración", "Configuración"],
]);

export function operationalAreaForAudit(log = {}) {
  const entity = clean(log.entidad);
  if (AREA_BY_ENTITY.has(entity)) return AREA_BY_ENTITY.get(entity);
  const normalized = entity.toLocaleLowerCase("es");
  if (normalized.includes("pedido") || normalized.includes("pago")) return "Pedidos";
  if (normalized.includes("lote") || normalized.includes("produ")) return "Producción";
  if (normalized.includes("empaque")) return "Empaque";
  if (normalized.includes("domic") || normalized.includes("entrega")) return "Domicilios";
  if (normalized.includes("reclamo") || normalized.includes("incidente")) return "Reclamos";
  if (normalized.includes("invent") || normalized.includes("insumo")) return "Inventario";
  if (normalized.includes("cliente") || normalized.includes("crm")) return "Clientes";
  if (normalized.includes("marketing") || normalized.includes("creativ") || normalized.includes("campaña")) return "Agencia MOMOS";
  return entity || "Operación";
}

export function buildOperationalHistory(db = {}) {
  return (db.audit_logs || [])
    .filter((log) => log && log.id)
    .map((log) => ({
      id: log.id,
      at: clean(log.fecha),
      area: operationalAreaForAudit(log),
      entity: clean(log.entidad) || "Registro",
      entityId: clean(log.entidadId),
      action: clean(log.accion) || "Actualización",
      from: clean(log.de),
      to: clean(log.a),
      actor: clean(log.user) || "Sistema",
    }))
    .sort((a, b) => compareOperationalDatesDesc(a.at, b.at) || String(b.id).localeCompare(String(a.id)));
}

export {
  CLAIM_TERMINAL,
  DELIVERY_TERMINAL,
  ORDER_TERMINAL,
  PACKING_ACTIVE,
  PRODUCTION_ACTIVE,
};
