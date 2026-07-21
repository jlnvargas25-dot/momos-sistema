const BATCH_CONTRACT = "momos.order-delta-batch.v1";
const DELTA_CONTRACT = "momos.order-delta.v1";

const COLLECTIONS = Object.freeze([
  ["order_items", "orderItems", (row, orderId) => row?.orderId === orderId],
  ["deliveries", "deliveries", (row, orderId) => row?.orderId === orderId],
  ["evidences", "evidences", (row, orderId) => row?.orderId === orderId],
  ["claims", "claims", (row, orderId) => row?.orderId === orderId],
  ["inventory_reservations", "inventoryReservations", (row, orderId) => row?.orderId === orderId],
  ["production_suggestions", "productionSuggestions", (row, orderId) => row?.orderId === orderId],
  ["audit_logs", "auditLogs", (row, orderId) => row?.entidadId === orderId],
  ["packing_verifications", "packingVerifications", (row, orderId) => row?.orderId === orderId],
  ["order_stage_assignments", "orderStageAssignments", (row, orderId) => row?.orderId === orderId],
  ["order_line_progress", "orderLineProgress", (row, orderId) => row?.orderId === orderId],
  ["order_incidents", "orderIncidents", (row, orderId) => row?.orderId === orderId],
  ["order_dispatch_handoffs", "orderDispatchHandoffs", (row, orderId) => row?.orderId === orderId],
]);

function token(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized) || /^0+$/.test(normalized)) return "";
  return normalized.replace(/^0+(?=\d)/, "");
}

function compareTokens(left, right) {
  const a = token(left);
  const b = token(right);
  if (!a || !b) return null;
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a === b ? 0 : a > b ? 1 : -1;
}

export function compareOrderDeltaVersions(left, right) {
  return compareTokens(left, right);
}

function rows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];
}

function requiredRows(value, label) {
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error(`La respuesta dirigida no contiene ${label} como colección cerrada.`);
  }
  return value;
}

function scopedIdentity(deltaKey, row) {
  if (deltaKey === "packingVerifications" || deltaKey === "orderDispatchHandoffs") return row.orderId;
  if (deltaKey === "orderLineProgress") return `${row.orderItemId || ""}|${row.stage || ""}`;
  return row.id;
}

export function normalizeOrderDeltaBatch(envelope) {
  if (!envelope || typeof envelope !== "object" || envelope.contract !== BATCH_CONTRACT) {
    throw new Error("La respuesta dirigida de Pedidos no tiene el contrato esperado.");
  }
  if (envelope.containsSecrets !== false || envelope.externalExecution !== false) {
    throw new Error("La respuesta dirigida de Pedidos abrió una frontera no autorizada.");
  }
  const deltas = requiredRows(envelope.deltas, "deltas").map((delta) => {
    const orderId = String(delta.orderId || "").trim();
    const version = token(delta.version);
    if (delta.contract !== DELTA_CONTRACT || !orderId || !version || delta.order?.id !== orderId) {
      throw new Error("La respuesta dirigida contiene un pedido incompleto o sin versión válida.");
    }
    const customerId = String(delta.order.customerId || "").trim();
    if (delta.customer != null && (typeof delta.customer !== "object" || Array.isArray(delta.customer)
        || String(delta.customer.id || "").trim() !== customerId)) {
      throw new Error("La respuesta dirigida mezcló el cliente de otro pedido.");
    }
    const normalized = {
      ...delta,
      orderId,
      version,
      orderItems: requiredRows(delta.orderItems, "orderItems"),
      deliveries: requiredRows(delta.deliveries, "deliveries"),
      evidences: requiredRows(delta.evidences, "evidences"),
      benefits: requiredRows(delta.benefits, "benefits"),
      claims: requiredRows(delta.claims, "claims"),
      inventoryReservations: requiredRows(delta.inventoryReservations, "inventoryReservations"),
      productionSuggestions: requiredRows(delta.productionSuggestions, "productionSuggestions"),
      auditLogs: requiredRows(delta.auditLogs, "auditLogs"),
      packingVerifications: requiredRows(delta.packingVerifications, "packingVerifications"),
      orderStageAssignments: requiredRows(delta.orderStageAssignments, "orderStageAssignments"),
      orderLineProgress: requiredRows(delta.orderLineProgress, "orderLineProgress"),
      orderIncidents: requiredRows(delta.orderIncidents, "orderIncidents"),
      orderDispatchHandoffs: requiredRows(delta.orderDispatchHandoffs, "orderDispatchHandoffs"),
    };
    for (const [, deltaKey, predicate] of COLLECTIONS) {
      const seen = new Set();
      for (const row of normalized[deltaKey]) {
        const identity = String(scopedIdentity(deltaKey, row) || "").trim();
        if (!predicate(row, orderId) || !identity || seen.has(identity)) {
          throw new Error(`La respuesta dirigida mezcló o repitió filas en ${deltaKey}.`);
        }
        seen.add(identity);
      }
    }
    const benefitIds = new Set();
    for (const benefit of normalized.benefits) {
      const benefitId = String(benefit.id || "").trim();
      if (!benefitId || benefitIds.has(benefitId)
          || (benefit.customerId !== customerId && benefit.pedidoUso !== orderId)) {
        throw new Error("La respuesta dirigida mezcló o repitió beneficios de otro pedido.");
      }
      benefitIds.add(benefitId);
    }
    return normalized;
  });
  const ids = new Set();
  for (const delta of deltas) {
    if (ids.has(delta.orderId)) throw new Error("La respuesta dirigida repitió un pedido.");
    ids.add(delta.orderId);
  }
  return { contract: BATCH_CONTRACT, serverTime: envelope.serverTime || "", deltas };
}

function replaceScoped(current, incoming, predicate, orderId) {
  return [...rows(current).filter((row) => !predicate(row, orderId)), ...incoming];
}

export function applyOrderDeltaBatchToDb(db, envelope) {
  const normalized = normalizeOrderDeltaBatch(envelope);
  if (!db || typeof db !== "object") throw new Error("MOMO OPS no tiene un estado operativo válido.");
  if (!db.orderDeltaVersions || typeof db.orderDeltaVersions !== "object" || Array.isArray(db.orderDeltaVersions)) {
    db.orderDeltaVersions = {};
  }
  const applied = [];
  const stale = [];
  for (const delta of normalized.deltas) {
    const currentVersion = token(db.orderDeltaVersions[delta.orderId]);
    if (currentVersion && compareTokens(delta.version, currentVersion) !== 1) {
      stale.push(delta.orderId);
      continue;
    }
    db.orders = replaceScoped(db.orders, [delta.order], (row, id) => row?.id === id, delta.orderId);
    for (const [dbKey, deltaKey, predicate] of COLLECTIONS) {
      db[dbKey] = replaceScoped(db[dbKey], delta[deltaKey], predicate, delta.orderId);
    }
    if (delta.customer?.id) {
      db.customers = replaceScoped(db.customers, [delta.customer], (row, id) => row?.id === id, delta.customer.id);
    }
    const customerId = String(delta.customer?.id || delta.order?.customerId || "").trim();
    db.benefits = replaceScoped(
      db.benefits,
      delta.benefits,
      (row, scopedCustomerId) => (scopedCustomerId && row?.customerId === scopedCustomerId)
        || row?.pedidoUso === delta.orderId,
      customerId,
    );
    db.orderDeltaVersions[delta.orderId] = delta.version;
    applied.push(delta.orderId);
  }
  return { status: stale.length && !applied.length ? "stale" : "applied", applied, stale };
}

// H88: variante inmutable para el estado React. Conserva las colecciones no
// afectadas por referencia y copia Ãºnicamente el registro de versiones que la
// aplicaciÃ³n dirigida modifica en sitio. La funciÃ³n histÃ³rica de arriba sigue
// disponible para compatibilidad con consumidores que trabajan sobre un draft.
export function applyOrderDeltaBatch(db, envelope) {
  if (!db || typeof db !== "object") throw new Error("MOMO OPS no tiene un estado operativo vÃ¡lido.");
  const next = {
    ...db,
    orderDeltaVersions: { ...(db.orderDeltaVersions || {}) },
  };
  const result = applyOrderDeltaBatchToDb(next, envelope);
  if (!result.applied.length) return { ...result, db };
  return { ...result, db: next };
}

export function clearOrderDeltaVersions(db) {
  if (db && typeof db === "object") db.orderDeltaVersions = {};
  return db;
}

export { BATCH_CONTRACT as ORDER_DELTA_BATCH_CONTRACT, DELTA_CONTRACT as ORDER_DELTA_CONTRACT };
