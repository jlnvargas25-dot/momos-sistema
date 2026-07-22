const CONTRACT = "momos.delivery-snapshot.v1";
const ACTIVE_DELIVERY_STATES = new Set(["Por solicitar", "Solicitado", "Asignado", "En ruta", "Problema"]);
const TERMINAL_DELIVERY_STATES = new Set(["Entregado", "Cancelado"]);
const READY_ORDER_STATES = new Set(["Empacado", "Listo para despacho"]);

const TOP_LEVEL_KEYS = Object.freeze([
  "contract", "version", "serverTime", "summary", "orders", "orderItems",
  "customers", "deliveries", "orderVersions", "privacy",
]);
const SUMMARY_KEYS = Object.freeze([
  "activeOrders", "readyWithoutDelivery", "historyReturned", "historyLimit", "subsidy", "surplus",
]);
const PRIVACY_KEYS = Object.freeze([
  "bounded", "containsCustomerPii", "containsFreeText", "containsSecrets",
  "containsStaffPii", "containsStorageReferences", "destinationPiiRequired", "externalExecution",
]);
const ORDER_KEYS = Object.freeze([
  "id", "fecha", "hora", "canal", "customerId", "barrio", "direccion", "zona",
  "domCobrado", "domCosto", "descuento", "pago", "estado", "obs",
]);
const ORDER_ITEM_KEYS = Object.freeze([
  "id", "orderId", "nombre", "cant", "precio", "sabor", "salsa", "relleno", "figura",
]);
const CUSTOMER_KEYS = Object.freeze(["id", "nombre", "telefono", "barrio", "direccion"]);
const DELIVERY_KEYS = Object.freeze([
  "id", "orderId", "proveedor", "costoReal", "cobrado", "zona", "hSolicitud",
  "hSalida", "hEntrega", "codigo", "estado", "obs",
]);
const ORDER_VERSION_KEYS = Object.freeze(["orderId", "version"]);

function token(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return "";
  return raw.replace(/^0+(?=\d)/, "");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`El snapshot de Domicilios no contiene ${label} como objeto cerrado.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`El snapshot de Domicilios expuso campos fuera de ${label}.`);
  }
}

function boundedRows(value, limit, label) {
  if (!Array.isArray(value) || value.length > limit
      || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error(`El snapshot de Domicilios no respeta el límite de ${label}.`);
  }
  return value;
}

function uniqueRows(rows, identity, label) {
  const seen = new Set();
  rows.forEach((row) => {
    const id = String(identity(row) || "").trim();
    if (!id || seen.has(id)) throw new Error(`El snapshot de Domicilios repitió o perdió identidad en ${label}.`);
    seen.add(id);
  });
}

function exactRowKeys(rows, expected, label) {
  rows.forEach((row) => exactKeys(row, expected, `${label}[]`));
}

export function normalizeDeliverySnapshot(payload) {
  exactKeys(payload, TOP_LEVEL_KEYS, "la respuesta");
  if (payload.contract !== CONTRACT || !token(payload.version)) {
    throw new Error("El snapshot de Domicilios no tiene contrato o versión válida.");
  }
  exactKeys(payload.summary, SUMMARY_KEYS, "summary");
  exactKeys(payload.privacy, PRIVACY_KEYS, "privacy");
  if (payload.privacy.bounded !== true
      || payload.privacy.containsCustomerPii !== true
      || payload.privacy.destinationPiiRequired !== true
      || payload.privacy.containsSecrets !== false
      || payload.privacy.containsStaffPii !== false
      || payload.privacy.containsStorageReferences !== false
      || payload.privacy.externalExecution !== false) {
    throw new Error("El snapshot de Domicilios abrió una frontera de privacidad no autorizada.");
  }
  const historyLimit = Number(payload.summary.historyLimit);
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 50) {
    throw new Error("El historial de Domicilios no está acotado.");
  }
  const orders = boundedRows(payload.orders, 250, "orders");
  const orderItems = boundedRows(payload.orderItems, 3000, "orderItems");
  const customers = boundedRows(payload.customers, 250, "customers");
  const deliveries = boundedRows(payload.deliveries, 1000, "deliveries");
  const orderVersions = boundedRows(payload.orderVersions, 250, "orderVersions");
  exactRowKeys(orders, ORDER_KEYS, "orders");
  exactRowKeys(orderItems, ORDER_ITEM_KEYS, "orderItems");
  exactRowKeys(customers, CUSTOMER_KEYS, "customers");
  exactRowKeys(deliveries, DELIVERY_KEYS, "deliveries");
  exactRowKeys(orderVersions, ORDER_VERSION_KEYS, "orderVersions");
  uniqueRows(orders, (row) => row.id, "orders");
  uniqueRows(orderItems, (row) => row.id, "orderItems");
  uniqueRows(customers, (row) => row.id, "customers");
  uniqueRows(deliveries, (row) => row.id, "deliveries");
  uniqueRows(orderVersions, (row) => row.orderId, "orderVersions");
  const orderIds = new Set(orders.map((row) => String(row.id)));
  const customerIds = new Set(orders.map((row) => String(row.customerId || "")).filter(Boolean));
  if (orderItems.some((row) => !orderIds.has(String(row.orderId || "")))
      || deliveries.some((row) => !orderIds.has(String(row.orderId || "")))
      || orderVersions.some((row) => !orderIds.has(String(row.orderId || "")) || !token(row.version))
      || customers.some((row) => !customerIds.has(String(row.id || "")))) {
    throw new Error("El snapshot de Domicilios mezcló datos fuera de sus pedidos.");
  }
  const versions = Object.fromEntries(orderVersions.map((row) => [String(row.orderId), token(row.version)]));
  return {
    contract: CONTRACT,
    version: token(payload.version),
    serverTime: String(payload.serverTime || ""),
    summary: payload.summary,
    orders,
    orderItems,
    customers,
    deliveries,
    orderVersions: versions,
    privacy: payload.privacy,
    syncServerTime: String(payload.serverTime || ""),
  };
}

function orderSortValue(order) {
  return `${String(order?.fecha || "")} ${String(order?.hora || "")} ${String(order?.id || "")}`;
}

function isEligible(order, deliveries) {
  if (!order || order.canal === "Rappi") return false;
  if (deliveries.some((delivery) => ACTIVE_DELIVERY_STATES.has(delivery.estado))) return true;
  if (deliveries.some((delivery) => TERMINAL_DELIVERY_STATES.has(delivery.estado))) return true;
  return READY_ORDER_STATES.has(order.estado) && !deliveries.some((delivery) => ACTIVE_DELIVERY_STATES.has(delivery.estado));
}

// H71 actualiza el grafo global de un pedido. Esta proyección copia solamente
// los pedidos que pertenecen a Logística, sin volver a consultar el snapshot.
export function syncDeliverySnapshotOrders(db, orderIds, historyLimit = 50) {
  if (!db?.deliverySnapshotReady) return db;
  const touched = new Set((orderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const byOrder = (rows, orderId) => (rows || []).filter((row) => row?.orderId === orderId);
  const upsertScoped = (current, incoming, predicate) => [
    ...(current || []).filter((row) => !predicate(row)), ...incoming,
  ];
  touched.forEach((orderId) => {
    const order = (db.orders || []).find((row) => row.id === orderId);
    const deliveries = byOrder(db.deliveries, orderId);
    const eligible = isEligible(order, deliveries);
    db.deliveryOrders = upsertScoped(db.deliveryOrders, eligible && order ? [order] : [], (row) => row.id === orderId);
    db.deliveryOrderItems = upsertScoped(db.deliveryOrderItems, eligible ? byOrder(db.order_items, orderId) : [], (row) => row.orderId === orderId);
    db.deliveryDeliveries = upsertScoped(db.deliveryDeliveries, eligible ? deliveries : [], (row) => row.orderId === orderId);
    if (order?.customerId) {
      const customer = (db.customers || []).find((row) => row.id === order.customerId);
      if (customer) db.deliveryCustomers = upsertScoped(db.deliveryCustomers, [customer], (row) => row.id === customer.id);
    }
  });
  const active = [];
  const history = [];
  (db.deliveryOrders || []).forEach((order) => {
    const attempts = byOrder(db.deliveryDeliveries, order.id);
    if (attempts.some((delivery) => ACTIVE_DELIVERY_STATES.has(delivery.estado))
        || (READY_ORDER_STATES.has(order.estado) && !attempts.some((delivery) => ACTIVE_DELIVERY_STATES.has(delivery.estado)))) active.push(order);
    else if (attempts.some((delivery) => TERMINAL_DELIVERY_STATES.has(delivery.estado))) history.push(order);
  });
  history.sort((a, b) => orderSortValue(b).localeCompare(orderSortValue(a)));
  const keptIds = new Set([...active, ...history.slice(0, Math.max(1, Math.min(50, historyLimit)))].map((row) => row.id));
  db.deliveryOrders = (db.deliveryOrders || []).filter((row) => keptIds.has(row.id));
  db.deliveryOrderItems = (db.deliveryOrderItems || []).filter((row) => keptIds.has(row.orderId));
  db.deliveryDeliveries = (db.deliveryDeliveries || []).filter((row) => keptIds.has(row.orderId));
  const keptCustomerIds = new Set(db.deliveryOrders.map((row) => row.customerId).filter(Boolean));
  db.deliveryCustomers = (db.deliveryCustomers || []).filter((row) => keptCustomerIds.has(row.id));
  return db;
}

export { CONTRACT as DELIVERY_SNAPSHOT_CONTRACT };
