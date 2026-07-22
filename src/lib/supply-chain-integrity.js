import { buildFinishedInventory } from "./finished-inventory.js";
import {
  expectedFigureProductId, isCommercialFamilyProduct, isKitchenFigureName, productDomainKind,
} from "./momos-domain-language.js";

const TERMINAL_ORDER_STATES = new Set(["Cancelado", "Entregado"]);
const IN_PROCESS_BATCH_STATES = new Set(["En preparación", "Congelando", "Reservado"]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function issue(code, message, entityId = "") {
  return { code, message, entityId };
}

function normalizedId(value) {
  return String(value ?? "").trim();
}

function figureBelongsToProduct(figure, productId) {
  const expectedProductId = expectedFigureProductId(figure);
  return Boolean(expectedProductId && expectedProductId === normalizedId(productId));
}

export function auditSupplyChainSnapshot(db = {}, { today } = {}) {
  const issues = [];
  const orders = new Map((db.orders || []).map((order) => [order.id, order]));
  const products = new Map((db.products || []).map((product) => [product.id, product]));
  const inventoryItems = new Map((db.inventory_items || []).map((item) => [item.id, item]));
  const orderItems = Array.isArray(db.order_items) ? db.order_items : [];
  const orderItemsById = new Map(orderItems.map((item) => [item.id, item]));

  products.forEach((product) => {
    if (number(product.stock) < 0) issues.push(issue("PRODUCT_STOCK_NEGATIVE", `${product.nombre || product.id} tiene stock negativo.`, product.id));
  });
  inventoryItems.forEach((item) => {
    if (number(item.stock) < 0) issues.push(issue("SUPPLY_STOCK_NEGATIVE", `${item.nombre || item.id} tiene stock negativo.`, item.id));
  });

  orderItems.forEach((item) => {
    const quantity = number(item.cant);
    if (quantity <= 0 || !Number.isInteger(quantity)) issues.push(issue("ORDER_QUANTITY_INVALID", `La línea ${item.id} no tiene una cantidad entera positiva.`, item.id));
    const product = products.get(item.productId);
    const productKind = productDomainKind(product);
    const figure = String(item.figura || "").trim();
    const flavor = String(item.sabor || "").trim();

    if (item.esCaja) {
      const validParent = productKind === "combo"
        && !item.esSubMomo
        && !item.parentItemId
        && !figure
        && !flavor;
      if (!validParent) {
        issues.push(issue("ORDER_COMBO_STRUCTURE_INVALID", `La línea ${item.id} no es una caja padre canónica: figura y sabor pertenecen a sus postres hijos.`, item.id));
      }
      return;
    }

    if (productKind === "combo") {
      issues.push(issue("ORDER_COMBO_STRUCTURE_INVALID", `La línea ${item.id} usa un combo sin registrarlo como caja padre con postres hijos.`, item.id));
      return;
    }

    const exactFigureProduct = isCommercialFamilyProduct(product) || item.esSubMomo;
    if (exactFigureProduct && (!isKitchenFigureName(figure) || !flavor)) {
      issues.push(issue("ORDER_VARIANT_INCOMPLETE", `La línea ${item.id} no define una figura física canónica y sabor.`, item.id));
    } else if (exactFigureProduct && (!isCommercialFamilyProduct(product) || !figureBelongsToProduct(figure, item.productId))) {
      issues.push(issue("ORDER_FAMILY_FIGURE_MISMATCH", `La figura ${figure} de la línea ${item.id} no corresponde a su familia comercial ${item.productId || "sin identificar"}.`, item.id));
    } else if (!exactFigureProduct && figure) {
      issues.push(issue("ORDER_FIGURE_NOT_APPLICABLE", `La línea ${item.id} se prepara al momento y no admite una figura física.`, item.id));
    }

    if (item.esSubMomo) {
      const parent = orderItemsById.get(item.parentItemId);
      const parentProduct = parent ? products.get(parent.productId) : null;
      const allowedComponents = new Set(Array.isArray(parentProduct?.componentProductIds)
        ? parentProduct.componentProductIds.map(normalizedId)
        : []);
      const validChild = parent
        && parent.orderId === item.orderId
        && parent.esCaja
        && productDomainKind(parentProduct) === "combo"
        && allowedComponents.has(normalizedId(item.productId));
      if (!validChild) {
        issues.push(issue("ORDER_COMBO_STRUCTURE_INVALID", `La figura hija ${item.id} no pertenece a una caja padre que admita su familia comercial.`, item.id));
      }
    } else if (item.parentItemId) {
      issues.push(issue("ORDER_COMBO_STRUCTURE_INVALID", `La línea simple ${item.id} no puede heredar una caja padre.`, item.id));
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
    const batchProduct = products.get(batch.productId);
    const batchFigures = [
      batch.figura,
      ...(Array.isArray(batch.figuras) ? batch.figuras.map((row) => row?.figura) : []),
      ...(Array.isArray(batch.resultadosFiguras) ? batch.resultadosFiguras.map((row) => row?.figura) : []),
    ].map((figure) => String(figure || "").trim()).filter(Boolean);
    if (batchFigures.some((figure) => !isKitchenFigureName(figure))) {
      issues.push(issue("BATCH_FIGURE_INVALID", `El lote ${batch.id} contiene una figura que no pertenece al catálogo físico de Cocina.`, batch.id));
    }
    const canonicalBatchFigures = batchFigures.filter(isKitchenFigureName);
    if (canonicalBatchFigures.length && !isCommercialFamilyProduct(batchProduct)) {
      issues.push(issue("BATCH_FIGURE_NOT_APPLICABLE", `El lote ${batch.id} no pertenece a una familia comercial y no admite figuras físicas.`, batch.id));
    } else if (canonicalBatchFigures.some((figure) => !figureBelongsToProduct(figure, batch.productId))) {
      issues.push(issue("BATCH_FAMILY_FIGURE_MISMATCH", `El lote ${batch.id} mezcla una figura con una familia comercial distinta.`, batch.id));
    }
    const counts = [batch.perfectas, batch.imperfectas, batch.descartadas].map(number);
    if (counts.some((value) => value < 0) || number(batch.prod) < 0) issues.push(issue("BATCH_COUNT_NEGATIVE", `El lote ${batch.id} tiene conteos negativos.`, batch.id));
    if (counts.reduce((sum, value) => sum + value, 0) > number(batch.prod)) issues.push(issue("BATCH_COUNTS_EXCEED_PRODUCTION", `Los conteos del lote ${batch.id} exceden lo producido.`, batch.id));
    if (batch.stockContabilizado && batch.estado !== "Listo") issues.push(issue("BATCH_STOCK_IN_WRONG_STATE", `El lote ${batch.id} contabilizó stock sin estar Listo.`, batch.id));
    if (batch.estado === "Listo" && isCommercialFamilyProduct(batchProduct) && batch.stockContabilizado === false) {
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
