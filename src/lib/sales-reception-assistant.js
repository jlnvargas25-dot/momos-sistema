import { evaluateExactVariantDemand } from "./variant-availability.js";

const INTAKE_STATES = new Set(["Nuevo", "Confirmado", "Pendiente de pago"]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function orderValue(db, order) {
  const items = (db.order_items || []).filter((item) => item.orderId === order.id && !item.esSubMomo);
  const subtotal = items.reduce((sum, item) => {
    const additions = (item.adiciones || []).reduce((acc, addition) => acc + number(addition.precio) * number(addition.cant || 1), 0);
    return sum + number(item.precio) * number(item.cant) + additions;
  }, 0);
  return Math.max(0, subtotal - number(order.descuento) + number(order.domCobrado));
}

function minutesWaiting(order, now) {
  const created = Date.parse(`${order.fecha || ""}T${order.hora || "00:00"}:00`);
  const current = Date.parse(now || new Date().toISOString());
  if (!Number.isFinite(created) || !Number.isFinite(current)) return 0;
  return Math.max(0, Math.floor((current - created) / 60000));
}

function paymentEvidence(db, order) {
  return Boolean(order.comprobante || (db.evidences || []).some((row) => row.orderId === order.id && row.tipo === "Comprobante de pago"));
}

function requiredDetails(db, order, customer, items) {
  const missing = [];
  if (!String(customer?.nombre || "").trim()) missing.push("nombre del cliente");
  if (!String(customer?.telefono || "").trim() && order.canal !== "Rappi") missing.push("teléfono");
  if (!items.length) missing.push("productos");
  if (!String(order.pago || "").trim()) missing.push("forma de pago");
  if (order.canal !== "Rappi" && !String(order.direccion || customer?.direccion || "").trim()) missing.push("dirección");
  if (order.canal !== "Rappi" && !String(order.barrio || customer?.barrio || "").trim()) missing.push("barrio");

  items.forEach((item) => {
    const product = (db.products || []).find((row) => row.id === item.productId);
    const attributes = new Set(product?.atributos || []);
    if ((product?.tipo === "momo" || item.esSubMomo) && !item.figura) missing.push(`figura de ${item.nombre}`);
    if ((product?.tipo === "momo" || item.esSubMomo) && !item.sabor) missing.push(`sabor de ${item.nombre}`);
    if (attributes.has("salsa") && !item.salsa) missing.push(`salsa de ${item.nombre}`);
    if (attributes.has("relleno") && !item.relleno) missing.push(`relleno de ${item.nombre}`);
  });
  return [...new Set(missing)];
}

function exactStockStatus(db, items, today) {
  const grouped = new Map();
  let incomplete = 0;
  items.forEach((item) => {
    const product = (db.products || []).find((row) => row.id === item.productId);
    if (!(product?.tipo === "momo" || item.esSubMomo)) return;
    if (!item.figura || !item.sabor) { incomplete += 1; return; }
    const key = `${item.productId}\u0000${item.figura}\u0000${item.sabor}`;
    const current = grouped.get(key) || { productId: item.productId, productName: item.nombre, figure: item.figura, flavor: item.sabor, quantity: 0 };
    current.quantity += number(item.cant || 1);
    grouped.set(key, current);
  });
  const checks = [...grouped.values()].map((demand) => evaluateExactVariantDemand({
    productId: demand.productId,
    productName: demand.productName,
    figure: demand.figure,
    flavor: demand.flavor,
    quantity: demand.quantity,
    variants: db.variantes || [],
    today,
  }));
  const shortages = checks.filter((row) => row.missing > 0);
  if (incomplete) return { status: "incomplete", label: "Falta definir figura o sabor", shortages, checks };
  if (shortages.length) return { status: "shortage", label: `Faltan ${shortages.reduce((sum, row) => sum + row.missing, 0)} unidades exactas`, shortages, checks };
  if (checks.length) return { status: "available", label: "Stock exacto verificado ahora", shortages: [], checks };
  return { status: "not-applicable", label: "Se prepara al momento", shortages: [], checks: [] };
}

function customerContext(db, customer, order, total, today) {
  const activeBenefits = (db.benefits || []).filter((benefit) => benefit.customerId === customer?.id
    && benefit.estado === "Activo" && (!benefit.vence || benefit.vence >= today));
  const context = [];
  if (number(customer?.pedidos) > 0) context.push(`${number(customer.pedidos)} compra${number(customer.pedidos) === 1 ? "" : "s"} anteriores`);
  if (customer?.favoritos) context.push(`preferencia: ${customer.favoritos}`);
  if (order.benefitId) context.push("beneficio ya reservado en este pedido");
  else if (activeBenefits.length) {
    const benefit = activeBenefits[0];
    context.push(total >= number(benefit.minimo) ? `beneficio activo para revisar: ${benefit.beneficio}` : `beneficio activo desde $${number(benefit.minimo).toLocaleString("es-CO")}`);
  }
  return context;
}

export function buildSalesReceptionAssistant(db = {}, { today, now } = {}) {
  const day = today || new Date().toISOString().slice(0, 10);
  const queue = (db.orders || []).filter((order) => INTAKE_STATES.has(order.estado) && !order.pagadoEn).map((order) => {
    const customer = (db.customers || []).find((row) => row.id === order.customerId) || {};
    const items = (db.order_items || []).filter((item) => item.orderId === order.id && !item.esCaja);
    const total = orderValue(db, order);
    const missing = requiredDetails(db, order, customer, items);
    const hasEvidence = paymentEvidence(db, order);
    const waitingMinutes = minutesWaiting(order, now);
    const stock = exactStockStatus(db, items, day);

    let action = "Confirmar datos del pedido";
    let priority = "Normal";
    let score = 40;
    if (hasEvidence) { action = "Verificar comprobante y confirmar pago"; priority = "Urgente"; score = 120; }
    else if (missing.length) { action = "Completar datos antes de cobrar"; priority = "Urgente"; score = 110; }
    else if (order.estado === "Pendiente de pago") { action = "Recordar pago al cliente"; priority = waitingMinutes >= 30 ? "Alta" : "Normal"; score = 80 + Math.min(waitingMinutes, 120) / 10; }
    else if (order.estado === "Confirmado") { action = "Enviar instrucciones de pago"; priority = "Alta"; score = 75; }
    else if (order.estado === "Nuevo") { action = "Confirmar pedido con el cliente"; priority = "Normal"; score = 60; }
    if (stock.status === "shortage") score += 8;

    return {
      orderId: order.id,
      order,
      customer,
      total,
      missing,
      hasEvidence,
      waitingMinutes,
      stock,
      action,
      priority,
      score,
      customerContext: customerContext(db, customer, order, total, day),
    };
  }).sort((a, b) => b.score - a.score || `${a.order.fecha} ${a.order.hora}`.localeCompare(`${b.order.fecha} ${b.order.hora}`));

  return {
    queue,
    summary: {
      attention: queue.length,
      evidence: queue.filter((row) => row.hasEvidence).length,
      incomplete: queue.filter((row) => row.missing.length > 0).length,
      pendingValue: queue.reduce((sum, row) => sum + row.total, 0),
      stockShortages: queue.filter((row) => row.stock.status === "shortage").length,
    },
  };
}
