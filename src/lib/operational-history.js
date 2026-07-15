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
    .sort((a, b) => b.at.localeCompare(a.at) || String(b.id).localeCompare(String(a.id)));
}

export {
  CLAIM_TERMINAL,
  DELIVERY_TERMINAL,
  ORDER_TERMINAL,
  PACKING_ACTIVE,
  PRODUCTION_ACTIVE,
};
