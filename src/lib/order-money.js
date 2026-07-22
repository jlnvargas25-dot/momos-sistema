function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantity(value) {
  return Math.max(0, number(value));
}

export function orderLineAdditionsTotal(line = {}) {
  const lineQuantity = quantity(line.cant);
  return (Array.isArray(line.adiciones) ? line.adiciones : []).reduce((sum, addition) => (
    sum
      + number(addition.precio)
      * Math.max(1, quantity(addition.cant))
      * lineQuantity
  ), 0);
}

export function orderLineMoney(line = {}) {
  const lineQuantity = quantity(line.cant);
  const base = number(line.precio) * lineQuantity;
  const additions = orderLineAdditionsTotal(line);
  return { base, additions, subtotal: base + additions };
}

export function calculateOrderMoney(db = {}, order = {}) {
  const lines = (db.order_items || []).filter((line) => line.orderId === order.id);
  const lineBreakdown = lines.map((line) => ({ line, ...orderLineMoney(line) }));
  const subtotalBeforeDiscount = lineBreakdown.reduce((sum, row) => sum + row.subtotal, 0);
  const discount = Math.max(0, number(order.descuento));
  const deliveryCharged = number(order.domCobrado);
  const productRevenue = Math.max(0, subtotalBeforeDiscount - discount);
  const totalCharged = Math.max(0, productRevenue + deliveryCharged);
  return {
    lines,
    lineBreakdown,
    subtotalBeforeDiscount,
    discount,
    productRevenue,
    deliveryCharged,
    totalCharged,
  };
}

/**
 * Base deliberadamente distinta al dinero cobrado: es la misma definición
 * compacta que usa Agencia en el servidor (líneas comerciales principales,
 * antes de domicilio, descuentos y adiciones). Nunca alterna según exista
 * o no `order.total`.
 */
export function calculateOrderAttributionRevenue(db = {}, order = {}) {
  const lines = (db.order_items || [])
    .filter((line) => line.orderId === order.id && !line.parentItemId && !line.esSubMomo);
  if (lines.length) return lines.reduce((sum, line) => sum + number(line.precio) * quantity(line.cant), 0);
  // Compatibilidad de lectura para snapshots históricos sin líneas. Nunca se
  // usa cuando existe el detalle comercial y no altera el contrato principal.
  return Math.max(0, number(order.total));
}
