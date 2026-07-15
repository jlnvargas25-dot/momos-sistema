import { buildFinishedInventory } from "./finished-inventory.js";

const TERMINAL_ORDER_STATES = new Set(["Cancelado", "Entregado"]);
const IN_PROCESS_BATCH_STATES = new Set(["En preparación", "Congelando", "Reservado"]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function issue(code, message, entityId = "") {
  return { code, message, entityId };
}

export function auditSupplyChainSnapshot(db = {}, { today } = {}) {
  const issues = [];
  const orders = new Map((db.orders || []).map((order) => [order.id, order]));
  const products = new Map((db.products || []).map((product) => [product.id, product]));
  const inventoryItems = new Map((db.inventory_items || []).map((item) => [item.id, item]));

  products.forEach((product) => {
    if (number(product.stock) < 0) issues.push(issue("PRODUCT_STOCK_NEGATIVE", `${product.nombre || product.id} tiene stock negativo.`, product.id));
  });
  inventoryItems.forEach((item) => {
    if (number(item.stock) < 0) issues.push(issue("SUPPLY_STOCK_NEGATIVE", `${item.nombre || item.id} tiene stock negativo.`, item.id));
  });

  (db.order_items || []).forEach((item) => {
    const quantity = number(item.cant);
    if (quantity <= 0 || !Number.isInteger(quantity)) issues.push(issue("ORDER_QUANTITY_INVALID", `La línea ${item.id} no tiene una cantidad entera positiva.`, item.id));
    const product = products.get(item.productId);
    if (product?.tipo === "momo" && (!String(item.figura || "").trim() || !String(item.sabor || "").trim())) {
      issues.push(issue("ORDER_VARIANT_INCOMPLETE", `La línea ${item.id} no define figura y sabor.`, item.id));
    }
  });

  (db.inventory_reservations || []).forEach((reservation) => {
    if (reservation.estado !== "Reservada") return;
    const order = orders.get(reservation.orderId);
    if (!order) issues.push(issue("RESERVATION_WITHOUT_ORDER", `La reserva ${reservation.id} no tiene pedido.`, reservation.id));
    else if (TERMINAL_ORDER_STATES.has(order.estado)) issues.push(issue("ACTIVE_RESERVATION_ON_TERMINAL_ORDER", `El pedido ${order.id} terminó pero conserva la reserva ${reservation.id}.`, reservation.id));
    if (!(number(reservation.cantidad) > 0)) issues.push(issue("RESERVATION_QUANTITY_INVALID", `La reserva ${reservation.id} no tiene cantidad positiva.`, reservation.id));
  });

  (db.production_suggestions || []).forEach((suggestion) => {
    if (suggestion.estado !== "Pendiente" || !suggestion.orderId) return;
    const order = orders.get(suggestion.orderId);
    if (!order) issues.push(issue("SUGGESTION_WITHOUT_ORDER", `La sugerencia ${suggestion.id} no tiene pedido.`, suggestion.id));
    else if (TERMINAL_ORDER_STATES.has(order.estado)) issues.push(issue("PENDING_SUGGESTION_ON_TERMINAL_ORDER", `El pedido ${order.id} terminó pero conserva la sugerencia ${suggestion.id}.`, suggestion.id));
  });

  (db.production_batches || []).forEach((batch) => {
    const counts = [batch.perfectas, batch.imperfectas, batch.descartadas].map(number);
    if (counts.some((value) => value < 0) || number(batch.prod) < 0) issues.push(issue("BATCH_COUNT_NEGATIVE", `El lote ${batch.id} tiene conteos negativos.`, batch.id));
    if (counts.reduce((sum, value) => sum + value, 0) > number(batch.prod)) issues.push(issue("BATCH_COUNTS_EXCEED_PRODUCTION", `Los conteos del lote ${batch.id} exceden lo producido.`, batch.id));
    if (batch.stockContabilizado && batch.estado !== "Listo") issues.push(issue("BATCH_STOCK_IN_WRONG_STATE", `El lote ${batch.id} contabilizó stock sin estar Listo.`, batch.id));
    if (batch.estado === "Listo" && products.get(batch.productId)?.tipo === "momo" && batch.stockContabilizado === false) {
      issues.push(issue("READY_BATCH_NOT_ACCOUNTED", `El lote ${batch.id} está Listo pero no sumó stock.`, batch.id));
    }
    if (IN_PROCESS_BATCH_STATES.has(batch.estado) && batch.stockContabilizado) issues.push(issue("IN_PROCESS_BATCH_ACCOUNTED", `El lote ${batch.id} sigue en proceso pero ya está disponible.`, batch.id));
  });

  const finished = buildFinishedInventory(db, today ? { today } : undefined);
  if (finished.summary.reconciliationExcess > 0) issues.push(issue("FINISHED_STOCK_MISMATCH", `El detalle exacto excede el stock oficial por ${finished.summary.reconciliationExcess}.`));
  if (finished.summary.quarantined > 0) issues.push(issue("EXPIRED_FINISHED_STOCK", `${finished.summary.quarantined} unidad(es) terminadas están vencidas y en cuarentena.`));
  if (finished.summary.negativeStockProducts > 0) issues.push(issue("FINISHED_STOCK_NEGATIVE", `${finished.summary.negativeStockProducts} producto(s) terminados tienen stock negativo.`));

  return { ok: issues.length === 0, issues, finished };
}
