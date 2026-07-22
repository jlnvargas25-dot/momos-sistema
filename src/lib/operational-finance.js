import { calculateOrderMoney } from "./order-money.js";
import { buildCanonicalPhysicalResults } from "./canonical-production-results.js";

const PREPAYMENT_STATES = new Set(["Nuevo", "Confirmado", "Pendiente de pago"]);
const TERMINAL_WITH_DELIVERY = new Set(["En ruta", "Entregado", "Reclamo"]);
const ACTIVE_DELIVERY_STATES = new Set(["Solicitado", "Asignado", "En ruta", "Entregado"]);

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalize = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .trim();

const datePart = (value) => String(value || "").slice(0, 10);
const inRange = (value, from, to) => {
  const date = datePart(value);
  return !!date && (!from || date >= from) && (!to || date <= to);
};

const indexFirst = (rows, keyOf) => {
  const index = new Map();
  rows.forEach((row) => {
    const key = keyOf(row);
    if (!index.has(key)) index.set(key, row);
  });
  return index;
};

const groupBy = (rows, keyOf) => {
  const groups = new Map();
  rows.forEach((row) => {
    const key = keyOf(row);
    const current = groups.get(key);
    if (current) current.push(row);
    else groups.set(key, [row]);
  });
  return groups;
};

const buildFinanceIndexes = (db) => {
  const products = db.products || [];
  const inventoryItems = db.inventory_items || [];
  const paymentEvidenceOrderIds = new Set();
  const activeDeliveriesByOrder = new Map();

  (db.evidences || []).forEach((evidence) => {
    if (/comprobante.*pago|pago.*comprobante/.test(normalize(evidence.tipo))) {
      paymentEvidenceOrderIds.add(evidence.orderId);
    }
  });
  (db.deliveries || []).forEach((delivery) => {
    if (!ACTIVE_DELIVERY_STATES.has(delivery.estado)) return;
    const current = activeDeliveriesByOrder.get(delivery.orderId);
    if (current) current.push(delivery);
    else activeDeliveriesByOrder.set(delivery.orderId, [delivery]);
  });

  return {
    productById: indexFirst(products, (row) => row.id),
    inventoryItemById: indexFirst(inventoryItems, (row) => row.id),
    inventoryItemByName: indexFirst(inventoryItems, (row) => row.nombre),
    orderById: indexFirst(db.orders || [], (row) => row.id),
    itemsByOrder: groupBy(db.order_items || [], (row) => row.orderId),
    paymentEvidenceOrderIds,
    activeDeliveriesByOrder,
  };
};

const lineCost = (indexes, line) => {
  const product = indexes.productById.get(line.productId);
  const base = line.costoUnitario !== undefined && line.costoUnitario !== null
    ? number(line.costoUnitario)
    : number(product?.costo);
  const additions = (Array.isArray(line?.adiciones) ? line.adiciones : []).reduce((sum, addition) => {
    if (!addition.insumoId) return sum;
    const item = indexes.inventoryItemById.get(addition.insumoId);
    return sum + number(addition.insumoCant) * Math.max(1, number(addition.cant)) * Math.max(1, number(line.cant)) * number(addition.insumoCosto ?? item?.costo);
  }, 0);
  return base * number(line.cant) + additions;
};

export function financeOrderSubtotal(db, order) {
  return calculateOrderMoney(db, order).subtotalBeforeDiscount;
}

export function financeOrderTotal(db, order) {
  return calculateOrderMoney(db, order).totalCharged;
}

function parseMovementAmount(value) {
  const match = String(value || "").replace(",", ".").match(/[+-]?\d+(?:\.\d+)?/);
  return match ? number(match[0]) : 0;
}

function severityRank(severity) {
  return ({ critical: 0, high: 1, medium: 2, info: 3 })[severity] ?? 4;
}

function addTask(queue, task) {
  queue.push({
    amount: 0,
    blocksClose: task.severity === "critical" || task.severity === "high",
    ...task,
  });
}

export function buildOperationalFinance(db, { from = "", to = "" } = {}) {
  const orders = (db.orders || []).filter((order) => inRange(order.fecha, from, to));
  const productionResults = Array.isArray(db.production_batches)
    ? buildCanonicalPhysicalResults(db.production_batches, { from, to })
    : null;
  const indexes = buildFinanceIndexes(db);
  const metricsByOrder = new Map();
  orders.forEach((order) => {
    const money = calculateOrderMoney(db, order);
    metricsByOrder.set(order, {
      lines: money.lines,
      subtotal: money.subtotalBeforeDiscount,
      total: money.totalCharged,
    });
  });

  const confirmedPayments = orders.filter((order) => order.pagadoEn);
  const paidOrders = confirmedPayments.filter((order) => !PREPAYMENT_STATES.has(order.estado) && order.estado !== "Cancelado");
  const unpaidOrders = orders.filter((order) => !order.pagadoEn && order.estado !== "Cancelado");
  const queue = [];

  orders.forEach((order) => {
    const { lines, subtotal, total } = metricsByOrder.get(order);
    const paymentEvidence = indexes.paymentEvidenceOrderIds.has(order.id);
    const isRappi = normalize(order.canal) === "rappi" || normalize(order.pago).includes("rappi");
    const deliveries = indexes.activeDeliveriesByOrder.get(order.id) || [];
    const authoritativeDelivery = deliveries.find((delivery) => delivery.estado === "Entregado") || deliveries[0];

    if (order.pagadoEn && order.estado === "Cancelado") {
      addTask(queue, { id: `refund-${order.id}`, orderId: order.id, severity: "critical", category: "Pago", title: "Definir devolución de un pedido cancelado", detail: `${order.id} conserva un pago confirmado aunque está cancelado.`, action: "Verificar devolución, soporte y motivo antes de cerrar.", amount: total });
    }
    if (!order.pagadoEn && !PREPAYMENT_STATES.has(order.estado) && order.estado !== "Cancelado") {
      addTask(queue, { id: `unpaid-operation-${order.id}`, orderId: order.id, severity: "critical", category: "Integridad", title: "Pedido operativo sin pago confirmado", detail: `${order.id} está en ${order.estado}, pero no tiene sello de pago.`, action: "Detener el avance y revisar la trazabilidad del pago.", amount: total });
    }
    if (order.pagadoEn && PREPAYMENT_STATES.has(order.estado)) {
      addTask(queue, { id: `paid-prestate-${order.id}`, orderId: order.id, severity: "critical", category: "Integridad", title: "Pago confirmado con estado anterior al pago", detail: `${order.id} tiene pagadoEn, pero permanece en ${order.estado}.`, action: "Revisar el evento de pago y corregir el flujo sin duplicar reservas.", amount: total });
    }
    if (subtotal <= 0 || total <= 0 || number(order.descuento) > subtotal) {
      addTask(queue, { id: `invalid-total-${order.id}`, orderId: order.id, severity: "critical", category: "Valor", title: "Total del pedido inconsistente", detail: `${order.id} tiene subtotal ${subtotal}, descuento ${number(order.descuento)} y total ${total}.`, action: "Corregir líneas o descuento antes de conciliar.", amount: total });
    }
    if (!order.pagadoEn && paymentEvidence) {
      addTask(queue, { id: `verify-payment-${order.id}`, orderId: order.id, severity: "high", category: "Pago", title: "Comprobante esperando verificación", detail: `${order.id} tiene evidencia de pago, pero todavía no está confirmado.`, action: "Comparar valor, referencia y cuenta receptora; luego confirmar desde Pedidos.", amount: total });
    }
    if (order.pagadoEn && !isRappi && !paymentEvidence) {
      addTask(queue, { id: `missing-payment-proof-${order.id}`, orderId: order.id, severity: "high", category: "Soporte", title: "Pago sin evidencia consultable", detail: `${order.id} figura pagado por ${order.pago || "un medio no identificado"}, pero no tiene comprobante vinculado.`, action: "Adjuntar o localizar el soporte real; no reemplazarlo con una nota.", amount: total });
    }
    if (lines.length === 0) {
      addTask(queue, { id: `missing-lines-${order.id}`, orderId: order.id, severity: "critical", category: "Integridad", title: "Pedido sin líneas de producto", detail: `${order.id} no tiene productos contra los cuales validar cobro y costo.`, action: "Reconstruir la orden desde su fuente antes del cierre.", amount: total });
    }

    if (order.pagadoEn) {
      const missingCosts = lines.filter((line) => {
        const product = indexes.productById.get(line.productId);
        const historical = line.costoUnitario !== undefined && line.costoUnitario !== null ? number(line.costoUnitario) : number(product?.costo);
        return number(line.cant) <= 0 || number(line.precio) < 0 || historical <= 0;
      });
      if (missingCosts.length) {
        addTask(queue, { id: `missing-cost-${order.id}`, orderId: order.id, severity: "high", category: "Costo", title: "Costo histórico incompleto", detail: `${order.id} tiene ${missingCosts.length} línea${missingCosts.length === 1 ? "" : "s"} sin cantidad, precio o costo confiable.`, action: "Completar el costo histórico sin recalcular ventas antiguas con precios actuales.", amount: missingCosts.reduce((sum, line) => sum + number(line.precio) * number(line.cant), 0) });
      }
    }

    if (!isRappi && TERMINAL_WITH_DELIVERY.has(order.estado)) {
      if (!authoritativeDelivery || number(authoritativeDelivery.costoReal) <= 0) {
        addTask(queue, { id: `delivery-cost-${order.id}`, orderId: order.id, severity: "high", category: "Domicilio", title: "Domicilio sin costo real", detail: `${order.id} llegó a ${order.estado} sin un costo logístico comprobable.`, action: "Registrar el valor cobrado por el proveedor de domicilio.", amount: number(order.domCobrado) });
      }
      if (deliveries.length > 1) {
        addTask(queue, { id: `duplicate-delivery-${order.id}`, orderId: order.id, severity: "high", category: "Domicilio", title: "Más de un domicilio activo para el pedido", detail: `${order.id} tiene ${deliveries.length} solicitudes activas o entregadas.`, action: "Definir cuál se pagó y cancelar las solicitudes duplicadas.", amount: deliveries.reduce((sum, delivery) => sum + number(delivery.costoReal), 0) });
      }
    }
    if (authoritativeDelivery && number(order.domCosto) > 0 && number(authoritativeDelivery.costoReal) > 0 && Math.abs(number(order.domCosto) - number(authoritativeDelivery.costoReal)) >= 1) {
      addTask(queue, { id: `delivery-mismatch-${order.id}`, orderId: order.id, severity: "medium", category: "Domicilio", title: "Costo de domicilio no coincide", detail: `${order.id}: el pedido registra ${number(order.domCosto)} y el domicilio ${number(authoritativeDelivery.costoReal)}.`, action: "Conciliar contra el cobro del proveedor y conservar una sola cifra oficial.", amount: Math.abs(number(order.domCosto) - number(authoritativeDelivery.costoReal)) });
    }
  });

  const claimsInRange = [];
  let recognizedClaims = 0;
  let recognizedClaimsForPeriod = 0;
  (db.claims || []).forEach((claim) => {
    const recognized = ["Aprobado", "Compensado"].includes(claim.estado);
    const fallbackDate = claim.fecha || indexes.orderById.get(claim.orderId)?.fecha;
    if (recognized && inRange(claim.fecha, from, to)) recognizedClaims += number(claim.costo);
    if (!inRange(fallbackDate, from, to)) return;
    claimsInRange.push(claim);
    if (recognized) recognizedClaimsForPeriod += number(claim.costo);
  });
  claimsInRange.forEach((claim) => {
    if (["En revisión", "Abierto", "Pendiente"].includes(claim.estado)) {
      addTask(queue, { id: `claim-open-${claim.id}`, orderId: claim.orderId, severity: "medium", category: "Reclamo", title: "Reclamo con exposición aún desconocida", detail: `${claim.id} está ${claim.estado} y todavía no debe asumirse como costo cero.`, action: "Definir decisión y costo antes del cierre definitivo.", amount: number(claim.costo), blocksClose: false });
    }
    if (["Aprobado", "Compensado"].includes(claim.estado) && number(claim.costo) <= 0) {
      addTask(queue, { id: `claim-cost-${claim.id}`, orderId: claim.orderId, severity: "high", category: "Reclamo", title: "Compensación aprobada sin costo", detail: `${claim.id} está ${claim.estado}, pero su costo sigue en cero.`, action: "Registrar producto, devolución o beneficio entregado a costo real.", amount: 0 });
    }
  });

  const grossCollected = confirmedPayments.reduce((sum, order) => sum + metricsByOrder.get(order).total, 0);
  const productRevenue = paidOrders.reduce((sum, order) => sum + metricsByOrder.get(order).subtotal - number(order.descuento), 0);
  const deliveryCollected = paidOrders.reduce((sum, order) => sum + number(order.domCobrado), 0);
  const cogs = paidOrders.reduce((sum, order) => sum + metricsByOrder.get(order).lines.reduce((lineSum, line) => lineSum + lineCost(indexes, line), 0), 0);
  const paidOrderIds = new Set(paidOrders.map((order) => order.id));
  const deliveryCosts = (db.deliveries || []).filter((delivery) => paidOrderIds.has(delivery.orderId) && delivery.estado !== "Cancelado")
    .reduce((sum, delivery) => sum + number(delivery.costoReal), 0);
  const platformSpend = (db.creative_results || []).filter((metric) => inRange(metric.fecha, from, to))
    .reduce((sum, metric) => sum + number(metric.gasto), 0);
  const fromTime = Date.parse(`${from || to || "1970-01-01"}T12:00:00`);
  const toTime = Date.parse(`${to || from || "1970-01-01"}T12:00:00`);
  const rangeDays = Number.isFinite(fromTime) && Number.isFinite(toTime) ? Math.max(1, Math.round((toTime - fromTime) / 86400000) + 1) : 1;
  const manualAdAllocation = Math.round(number(db.settings?.pautaMensual) / 30 * rangeDays);
  if (manualAdAllocation > 0 && (platformSpend === 0 || Math.abs(manualAdAllocation - platformSpend) > Math.max(5000, manualAdAllocation * 0.2))) {
    addTask(queue, { id: "ad-spend-unreconciled", orderId: "", severity: "medium", category: "Pauta", title: "Pauta manual y gasto documentado no coinciden", detail: `La asignación manual del rango es ${manualAdAllocation} y las métricas respaldan ${platformSpend}.`, action: "Conciliar Meta, TikTok, influencers y otros soportes sin inventar el gasto faltante.", amount: Math.abs(manualAdAllocation - platformSpend), blocksClose: false });
  }
  const inventoryPurchases = (db.inventory_movements || []).filter((movement) => inRange(movement.fecha, from, to) && /entrada|compra/.test(normalize(movement.tipo)) && parseMovementAmount(movement.cant) > 0)
    .reduce((sum, movement) => {
      const item = indexes.inventoryItemByName.get(movement.item);
      return sum + parseMovementAmount(movement.cant) * number(item?.costo);
    }, 0);

  const paymentsMap = new Map();
  confirmedPayments.forEach((order) => {
    const method = order.pago || "Sin medio";
    const current = paymentsMap.get(method) || { method, orders: 0, amount: 0 };
    current.orders += 1;
    current.amount += metricsByOrder.get(order).total;
    paymentsMap.set(method, current);
  });
  const payments = [...paymentsMap.values()].sort((a, b) => b.amount - a.amount);

  queue.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || number(b.amount) - number(a.amount) || String(a.orderId || "").localeCompare(String(b.orderId || "")));
  const queueIndicators = queue.reduce((totals, task) => {
    if (task.blocksClose) totals.blocking += 1;
    if (task.id.startsWith("verify-payment-")) totals.paymentEvidenceWaiting += 1;
    if (task.category === "Domicilio") totals.deliveryIssues += 1;
    if (task.category === "Costo" || task.category === "Reclamo") totals.costIssues += 1;
    return totals;
  }, { blocking: 0, paymentEvidenceWaiting: 0, deliveryIssues: 0, costIssues: 0 });
  const pendingValue = unpaidOrders.reduce((sum, order) => sum + Math.max(0, metricsByOrder.get(order).total), 0);
  const grossMargin = productRevenue - cogs;
  const recordedDeliveryCosts = paidOrders.reduce((sum, order) => sum + number(order.domCosto), 0);
  const deliverySubsidy = paidOrders.reduce((sum, order) => sum + Math.max(0, number(order.domCosto) - number(order.domCobrado)), 0);
  const estimatedProfit = grossMargin + deliveryCollected - recordedDeliveryCosts - manualAdAllocation - recognizedClaimsForPeriod;
  const operatingResult = productRevenue - cogs + deliveryCollected - deliveryCosts - recognizedClaims - platformSpend;

  return {
    range: { from, to },
    queue,
    payments,
    productionResults,
    summary: {
      ordersReviewed: orders.length,
      confirmedPaymentOrders: confirmedPayments.length,
      paidOrders: paidOrders.length,
      grossCollected,
      pendingValue,
      productRevenue,
      deliveryCollected,
      cogs,
      deliveryCosts,
      recognizedClaims,
      platformSpend,
      manualAdAllocation,
      configuredMonthlyAdBudget: number(db.settings?.pautaMensual),
      inventoryPurchases,
      rangeDays,
      grossMargin,
      recordedDeliveryCosts,
      deliverySubsidy,
      recognizedClaimsForPeriod,
      estimatedProfit,
      operatingResult,
      exceptions: queue.length,
      blocking: queueIndicators.blocking,
      closeReady: queueIndicators.blocking === 0,
      paymentEvidenceWaiting: queueIndicators.paymentEvidenceWaiting,
      deliveryIssues: queueIndicators.deliveryIssues,
      costIssues: queueIndicators.costIssues,
    },
    caveats: [
      "Los cobros son valores brutos registrados en MOMO OPS; deben conciliarse contra Nequi, bancos y Rappi.",
      "El resultado operativo no incluye nómina, servicios, impuestos, comisiones de pasarela ni otros gastos aún no registrados.",
      "Las compras de inventario se muestran como salida de caja informativa, pero no se descuentan otra vez del resultado porque el COGS reconoce el consumo vendido.",
    ],
  };
}

const requireObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Contrato financiero inválido: ${label}.`);
  return value;
};

const requireArray = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`Contrato financiero inválido: ${label}.`);
  return value;
};

const requireText = (value, label, { empty = false } = {}) => {
  if (typeof value !== "string" || (!empty && !value.trim())) throw new Error(`Contrato financiero inválido: ${label}.`);
  return value;
};

const requireNumber = (value, label) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Contrato financiero inválido: ${label}.`);
  return parsed;
};

const requireBoolean = (value, label) => {
  if (typeof value !== "boolean") throw new Error(`Contrato financiero inválido: ${label}.`);
  return value;
};

export function validateFinancialDateRange(from, to) {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDate.test(String(from || "")) || !isoDate.test(String(to || "")) || from > to) {
    throw new Error("El rango financiero no es válido.");
  }
  const fromTime = Date.parse(`${from}T12:00:00Z`);
  const toTime = Date.parse(`${to}T12:00:00Z`);
  const days = Math.round((toTime - fromTime) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 367) throw new Error("El rango financiero no puede superar 367 días.");
  return { from, to, days };
}

const FINANCE_COMPACT_CAVEATS = [
  "Los cobros son valores brutos registrados en MOMO OPS; deben conciliarse contra Nequi, bancos y Rappi.",
  "El resultado operativo no incluye nómina, servicios, impuestos, comisiones de pasarela ni otros gastos aún no registrados.",
  "Las compras de inventario se muestran como salida de caja informativa, pero no se descuentan otra vez del resultado porque el COGS reconoce el consumo vendido.",
];

export function buildOperationalFinanceFromSnapshot(payload, expectedRange = null) {
  const source = requireObject(payload, "snapshot");
  if (source.contract !== "momos.finance-snapshot.v1" || Number(source.version) !== 1) {
    throw new Error("Contrato financiero compacto no compatible.");
  }
  for (const key of ["containsPii", "containsFreeText", "containsStorageReferences", "containsSecrets", "externalExecution"]) {
    if (source[key] !== false) throw new Error(`Contrato financiero compacto inseguro: ${key}.`);
  }
  if (!/^\d+$/.test(String(source.snapshotVersion || "")) || String(source.snapshotVersion) === "0") {
    throw new Error("Contrato financiero compacto sin versión autoritativa.");
  }
  const rawRange = requireObject(source.range, "range");
  const range = validateFinancialDateRange(requireText(rawRange.from, "range.from"), requireText(rawRange.to, "range.to"));
  if (requireNumber(rawRange.days, "range.days") !== range.days) throw new Error("Contrato financiero compacto con rango inconsistente.");
  if (expectedRange && (range.from !== expectedRange.from || range.to !== expectedRange.to)) {
    throw new Error("El resumen financiero pertenece a otro rango.");
  }
  const rawSummary = requireObject(source.summary, "summary");
  const numericKeys = [
    "ordersReviewed", "confirmedPaymentOrders", "paidOrders", "grossCollected", "pendingValue",
    "productRevenue", "deliveryCollected", "cogs", "deliveryCosts", "recognizedClaims",
    "platformSpend", "manualAdAllocation", "configuredMonthlyAdBudget", "inventoryPurchases",
    "rangeDays", "grossMargin", "recordedDeliveryCosts", "deliverySubsidy",
    "recognizedClaimsForPeriod", "estimatedProfit", "operatingResult", "exceptions", "blocking",
    "paymentEvidenceWaiting", "deliveryIssues", "costIssues",
  ];
  const summary = Object.fromEntries(numericKeys.map((key) => [key, requireNumber(rawSummary[key], `summary.${key}`)]));
  summary.closeReady = requireBoolean(rawSummary.closeReady, "summary.closeReady");
  if (summary.rangeDays !== range.days || summary.closeReady !== (summary.blocking === 0)) {
    throw new Error("Contrato financiero compacto con indicadores inconsistentes.");
  }
  const countKeys = [
    "ordersReviewed", "confirmedPaymentOrders", "paidOrders", "exceptions", "blocking",
    "paymentEvidenceWaiting", "deliveryIssues", "costIssues",
  ];
  if (countKeys.some((key) => !Number.isInteger(summary[key]) || summary[key] < 0)
      || summary.confirmedPaymentOrders > summary.ordersReviewed
      || summary.paidOrders > summary.confirmedPaymentOrders
      || summary.blocking > summary.exceptions) {
    throw new Error("Contrato financiero compacto con conteos imposibles.");
  }
  const payments = requireArray(source.payments, "payments").map((row, index) => {
    const value = requireObject(row, `payments[${index}]`);
    return {
      method: requireText(value.method, `payments[${index}].method`),
      orders: requireNumber(value.orders, `payments[${index}].orders`),
      amount: requireNumber(value.amount, `payments[${index}].amount`),
    };
  });
  if (payments.some((row) => !Number.isInteger(row.orders) || row.orders < 0 || row.amount < 0)
      || payments.reduce((sum, row) => sum + row.orders, 0) !== summary.confirmedPaymentOrders) {
    throw new Error("Contrato financiero compacto con conciliación imposible.");
  }
  const closeEnough = (left, right) => Math.abs(left - right) <= 0.01;
  // H65 prorratea a centavos y H75 redondea ese importe a pesos enteros.
  // Replicar ambos pasos evita rechazar snapshots válidos en los bordes .499/.500.
  const proratedAdBudget = Math.round((summary.configuredMonthlyAdBudget / 30 * range.days) * 100) / 100;
  const expectedAdAllocation = Math.round(proratedAdBudget);
  if (!closeEnough(payments.reduce((sum, row) => sum + row.amount, 0), summary.grossCollected)
      || !closeEnough(summary.grossMargin, summary.productRevenue - summary.cogs)
      || !closeEnough(summary.manualAdAllocation, expectedAdAllocation)
      || !closeEnough(summary.estimatedProfit,
        summary.grossMargin + summary.deliveryCollected - summary.recordedDeliveryCosts
          - summary.manualAdAllocation - summary.recognizedClaimsForPeriod)
      || !closeEnough(summary.operatingResult,
        summary.productRevenue - summary.cogs + summary.deliveryCollected - summary.deliveryCosts
          - summary.recognizedClaims - summary.platformSpend)) {
    throw new Error("Contrato financiero compacto con totales inconsistentes.");
  }
  return {
    range,
    queue: [],
    payments,
    summary,
    caveats: FINANCE_COMPACT_CAVEATS,
    source: {
      kind: "server-finance-snapshot-v1",
      serverTime: requireText(source.serverTime, "serverTime"),
      snapshotVersion: String(source.snapshotVersion),
      completeRange: true,
    },
  };
}

export function normalizeFinancialFacts(payload, expectedRange = null) {
  const source = requireObject(payload, "respuesta");
  if (Number(source.version) !== 1) throw new Error("Contrato financiero inválido: versión no compatible.");
  for (const key of ["contains_pii", "contains_free_text", "contains_storage_references", "external_execution"]) {
    if (source[key] !== false) throw new Error(`Contrato financiero inseguro: ${key}.`);
  }

  const rawRange = requireObject(source.range, "range");
  const range = validateFinancialDateRange(requireText(rawRange.from, "range.from"), requireText(rawRange.to, "range.to"));
  if (requireNumber(rawRange.days, "range.days") !== range.days) throw new Error("Contrato financiero inválido: días del rango.");
  if (expectedRange && (range.from !== expectedRange.from || range.to !== expectedRange.to)) {
    throw new Error("La respuesta financiera pertenece a otro rango.");
  }

  const orders = requireArray(source.orders, "orders").map((row, index) => {
    const value = requireObject(row, `orders[${index}]`);
    return {
      id: requireText(value.order_id, `orders[${index}].order_id`),
      date: requireText(value.order_date, `orders[${index}].order_date`),
      channel: requireText(value.channel, `orders[${index}].channel`, { empty: true }),
      state: requireText(value.state, `orders[${index}].state`),
      paymentMethod: requireText(value.payment_method, `orders[${index}].payment_method`, { empty: true }),
      paymentConfirmed: requireBoolean(value.payment_confirmed, `orders[${index}].payment_confirmed`),
      campaignId: value.campaign_id ?? null,
      creativeId: value.creative_id ?? null,
      subtotalBeforeDiscount: requireNumber(value.product_revenue, `orders[${index}].product_revenue`),
      cogs: requireNumber(value.cogs, `orders[${index}].cogs`),
      discount: requireNumber(value.discount, `orders[${index}].discount`),
      deliveryCollected: requireNumber(value.delivery_collected, `orders[${index}].delivery_collected`),
      recordedDeliveryCost: requireNumber(value.delivery_cost_on_order, `orders[${index}].delivery_cost_on_order`),
      paymentFee: requireNumber(value.payment_fee, `orders[${index}].payment_fee`),
      totalCharged: requireNumber(value.total_charged, `orders[${index}].total_charged`),
      lineCount: requireNumber(value.line_count, `orders[${index}].line_count`),
      incompleteCostLines: requireNumber(value.incomplete_cost_lines, `orders[${index}].incomplete_cost_lines`),
      hasPaymentEvidence: requireBoolean(value.has_payment_evidence, `orders[${index}].has_payment_evidence`),
    };
  });
  const deliveries = requireArray(source.deliveries, "deliveries").map((row, index) => {
    const value = requireObject(row, `deliveries[${index}]`);
    return {
      id: requireText(value.delivery_id, `deliveries[${index}].delivery_id`),
      orderId: requireText(value.order_id, `deliveries[${index}].order_id`),
      state: requireText(value.state, `deliveries[${index}].state`),
      actualCost: requireNumber(value.actual_cost, `deliveries[${index}].actual_cost`),
      charged: requireNumber(value.charged, `deliveries[${index}].charged`),
    };
  });
  const claims = requireArray(source.claims, "claims").map((row, index) => {
    const value = requireObject(row, `claims[${index}]`);
    return {
      id: requireText(value.claim_id, `claims[${index}].claim_id`),
      orderId: requireText(value.order_id, `claims[${index}].order_id`, { empty: true }),
      date: requireText(value.claim_date, `claims[${index}].claim_date`),
      state: requireText(value.state, `claims[${index}].state`),
      documentedCost: requireNumber(value.documented_cost, `claims[${index}].documented_cost`),
      recognizedCost: requireNumber(value.recognized_cost, `claims[${index}].recognized_cost`),
    };
  });
  const inventoryPurchases = requireArray(source.inventory_purchases, "inventory_purchases").map((row, index) => {
    const value = requireObject(row, `inventory_purchases[${index}]`);
    return {
      movementId: requireText(value.movement_id, `inventory_purchases[${index}].movement_id`),
      lotId: requireText(value.lot_id, `inventory_purchases[${index}].lot_id`),
      date: requireText(value.purchase_date, `inventory_purchases[${index}].purchase_date`),
      itemId: requireText(value.item_id, `inventory_purchases[${index}].item_id`),
      quantity: requireNumber(value.quantity, `inventory_purchases[${index}].quantity`),
      unitCost: requireNumber(value.unit_cost, `inventory_purchases[${index}].unit_cost`),
      documentedCost: requireNumber(value.documented_cost, `inventory_purchases[${index}].documented_cost`),
      origin: requireText(value.origin, `inventory_purchases[${index}].origin`),
    };
  });
  const adSpend = requireArray(source.ad_spend, "ad_spend").map((row, index) => {
    const value = requireObject(row, `ad_spend[${index}]`);
    return {
      id: requireText(value.metric_id, `ad_spend[${index}].metric_id`),
      date: requireText(value.metric_date, `ad_spend[${index}].metric_date`),
      source: requireText(value.source, `ad_spend[${index}].source`, { empty: true }),
      campaignId: value.campaign_id ?? null,
      creativeId: value.creative_id ?? null,
      postId: value.post_id ?? null,
      documentedSpend: requireNumber(value.documented_spend, `ad_spend[${index}].documented_spend`),
    };
  });
  const configured = requireObject(source.configured_ad, "configured_ad");
  const configuredAd = {
    monthlyBudget: requireNumber(configured.monthly_budget, "configured_ad.monthly_budget"),
    rangeDays: requireNumber(configured.range_days, "configured_ad.range_days"),
    proratedBudget: requireNumber(configured.prorated_budget, "configured_ad.prorated_budget"),
  };
  if (configuredAd.rangeDays !== range.days) throw new Error("Contrato financiero inválido: rango de pauta.");

  const counts = requireObject(source.counts, "counts");
  const expectedCounts = {
    orders: orders.length,
    deliveries: deliveries.length,
    claims: claims.length,
    inventory_purchases: inventoryPurchases.length,
    ad_spend_rows: adSpend.length,
  };
  Object.entries(expectedCounts).forEach(([key, expected]) => {
    if (requireNumber(counts[key], `counts.${key}`) !== expected) throw new Error(`Contrato financiero incompleto: ${key}.`);
  });

  return {
    sourceKind: "server-financial-facts-v1",
    version: 1,
    serverTime: requireText(source.server_time, "server_time"),
    range,
    orders,
    deliveries,
    claims,
    inventoryPurchases,
    adSpend,
    configuredAd,
  };
}

export function buildOperationalFinanceFromFacts(input) {
  const facts = input?.sourceKind === "server-financial-facts-v1" ? input : normalizeFinancialFacts(input);
  const orders = facts.orders;
  const deliveriesByOrder = groupBy(facts.deliveries, (row) => row.orderId);
  const confirmedPayments = orders.filter((order) => order.paymentConfirmed);
  const paidOrders = confirmedPayments.filter((order) => !PREPAYMENT_STATES.has(order.state) && order.state !== "Cancelado");
  const unpaidOrders = orders.filter((order) => !order.paymentConfirmed && order.state !== "Cancelado");
  const paidOrderIds = new Set(paidOrders.map((order) => order.id));
  const queue = [];

  orders.forEach((order) => {
    const isRappi = normalize(order.channel) === "rappi" || normalize(order.paymentMethod).includes("rappi");
    const activeDeliveries = (deliveriesByOrder.get(order.id) || [])
      .filter((delivery) => ACTIVE_DELIVERY_STATES.has(delivery.state))
      .sort((a, b) => Number(b.state === "Entregado") - Number(a.state === "Entregado") || String(a.id).localeCompare(String(b.id)));
    const authoritativeDelivery = activeDeliveries[0];

    if (order.paymentConfirmed && order.state === "Cancelado") {
      addTask(queue, { id: `refund-${order.id}`, orderId: order.id, severity: "critical", category: "Pago", title: "Definir devolución de un pedido cancelado", detail: `${order.id} conserva un pago confirmado aunque está cancelado.`, action: "Verificar devolución, soporte y motivo antes de cerrar.", amount: order.totalCharged });
    }
    if (!order.paymentConfirmed && !PREPAYMENT_STATES.has(order.state) && order.state !== "Cancelado") {
      addTask(queue, { id: `unpaid-operation-${order.id}`, orderId: order.id, severity: "critical", category: "Integridad", title: "Pedido operativo sin pago confirmado", detail: `${order.id} está en ${order.state}, pero no tiene sello de pago.`, action: "Detener el avance y revisar la trazabilidad del pago.", amount: order.totalCharged });
    }
    if (order.paymentConfirmed && PREPAYMENT_STATES.has(order.state)) {
      addTask(queue, { id: `paid-prestate-${order.id}`, orderId: order.id, severity: "critical", category: "Integridad", title: "Pago confirmado con estado anterior al pago", detail: `${order.id} tiene pago confirmado, pero permanece en ${order.state}.`, action: "Revisar el evento de pago y corregir el flujo sin duplicar reservas.", amount: order.totalCharged });
    }
    if (order.subtotalBeforeDiscount <= 0 || order.totalCharged <= 0 || order.discount > order.subtotalBeforeDiscount) {
      addTask(queue, { id: `invalid-total-${order.id}`, orderId: order.id, severity: "critical", category: "Valor", title: "Total del pedido inconsistente", detail: `${order.id} tiene subtotal ${order.subtotalBeforeDiscount}, descuento ${order.discount} y total ${order.totalCharged}.`, action: "Corregir líneas o descuento antes de conciliar.", amount: order.totalCharged });
    }
    if (!order.paymentConfirmed && order.hasPaymentEvidence) {
      addTask(queue, { id: `verify-payment-${order.id}`, orderId: order.id, severity: "high", category: "Pago", title: "Comprobante esperando verificación", detail: `${order.id} tiene evidencia de pago, pero todavía no está confirmado.`, action: "Comparar valor, referencia y cuenta receptora; luego confirmar desde Pedidos.", amount: order.totalCharged });
    }
    if (order.paymentConfirmed && !isRappi && !order.hasPaymentEvidence) {
      addTask(queue, { id: `missing-payment-proof-${order.id}`, orderId: order.id, severity: "high", category: "Soporte", title: "Pago sin evidencia consultable", detail: `${order.id} figura pagado por ${order.paymentMethod || "un medio no identificado"}, pero no tiene comprobante vinculado.`, action: "Adjuntar o localizar el soporte real; no reemplazarlo con una nota.", amount: order.totalCharged });
    }
    if (order.lineCount === 0) {
      addTask(queue, { id: `missing-lines-${order.id}`, orderId: order.id, severity: "critical", category: "Integridad", title: "Pedido sin líneas de producto", detail: `${order.id} no tiene productos contra los cuales validar cobro y costo.`, action: "Reconstruir la orden desde su fuente antes del cierre.", amount: order.totalCharged });
    }
    if (order.paymentConfirmed && order.incompleteCostLines > 0) {
      addTask(queue, { id: `missing-cost-${order.id}`, orderId: order.id, severity: "high", category: "Costo", title: "Costo histórico incompleto", detail: `${order.id} tiene ${order.incompleteCostLines} línea${order.incompleteCostLines === 1 ? "" : "s"} sin cantidad, precio o costo confiable.`, action: "Completar el costo histórico sin recalcular ventas antiguas con precios actuales.", amount: 0 });
    }
    if (!isRappi && TERMINAL_WITH_DELIVERY.has(order.state)) {
      if (!authoritativeDelivery || authoritativeDelivery.actualCost <= 0) {
        addTask(queue, { id: `delivery-cost-${order.id}`, orderId: order.id, severity: "high", category: "Domicilio", title: "Domicilio sin costo real", detail: `${order.id} llegó a ${order.state} sin un costo logístico comprobable.`, action: "Registrar el valor cobrado por el proveedor de domicilio.", amount: order.deliveryCollected });
      }
      if (activeDeliveries.length > 1) {
        addTask(queue, { id: `duplicate-delivery-${order.id}`, orderId: order.id, severity: "high", category: "Domicilio", title: "Más de un domicilio activo para el pedido", detail: `${order.id} tiene ${activeDeliveries.length} solicitudes activas o entregadas.`, action: "Definir cuál se pagó y cancelar las solicitudes duplicadas.", amount: activeDeliveries.reduce((sum, delivery) => sum + delivery.actualCost, 0) });
      }
    }
    if (authoritativeDelivery && order.recordedDeliveryCost > 0 && authoritativeDelivery.actualCost > 0 && Math.abs(order.recordedDeliveryCost - authoritativeDelivery.actualCost) >= 1) {
      addTask(queue, { id: `delivery-mismatch-${order.id}`, orderId: order.id, severity: "medium", category: "Domicilio", title: "Costo de domicilio no coincide", detail: `${order.id}: el pedido registra ${order.recordedDeliveryCost} y el domicilio ${authoritativeDelivery.actualCost}.`, action: "Conciliar contra el cobro del proveedor y conservar una sola cifra oficial.", amount: Math.abs(order.recordedDeliveryCost - authoritativeDelivery.actualCost) });
    }
  });

  facts.claims.forEach((claim) => {
    if (["En revisión", "Abierto", "Pendiente"].includes(claim.state)) {
      addTask(queue, { id: `claim-open-${claim.id}`, orderId: claim.orderId, severity: "medium", category: "Reclamo", title: "Reclamo con exposición aún desconocida", detail: `${claim.id} está ${claim.state} y todavía no debe asumirse como costo cero.`, action: "Definir decisión y costo antes del cierre definitivo.", amount: claim.documentedCost, blocksClose: false });
    }
    if (["Aprobado", "Compensado"].includes(claim.state) && claim.documentedCost <= 0) {
      addTask(queue, { id: `claim-cost-${claim.id}`, orderId: claim.orderId, severity: "high", category: "Reclamo", title: "Compensación aprobada sin costo", detail: `${claim.id} está ${claim.state}, pero su costo sigue en cero.`, action: "Registrar producto, devolución o beneficio entregado a costo real.", amount: 0 });
    }
  });

  const paymentsMap = new Map();
  confirmedPayments.forEach((order) => {
    const method = order.paymentMethod || "Sin medio";
    const current = paymentsMap.get(method) || { method, orders: 0, amount: 0 };
    current.orders += 1;
    current.amount += order.totalCharged;
    paymentsMap.set(method, current);
  });
  const payments = [...paymentsMap.values()].sort((a, b) => b.amount - a.amount);
  const grossCollected = confirmedPayments.reduce((sum, order) => sum + order.totalCharged, 0);
  const pendingValue = unpaidOrders.reduce((sum, order) => sum + Math.max(0, order.totalCharged), 0);
  const productRevenue = paidOrders.reduce((sum, order) => sum + order.subtotalBeforeDiscount - order.discount, 0);
  const deliveryCollected = paidOrders.reduce((sum, order) => sum + order.deliveryCollected, 0);
  const cogs = paidOrders.reduce((sum, order) => sum + order.cogs, 0);
  const recordedDeliveryCosts = paidOrders.reduce((sum, order) => sum + order.recordedDeliveryCost, 0);
  const deliverySubsidy = paidOrders.reduce((sum, order) => sum + Math.max(0, order.recordedDeliveryCost - order.deliveryCollected), 0);
  const deliveryCosts = facts.deliveries.filter((delivery) => paidOrderIds.has(delivery.orderId) && delivery.state !== "Cancelado").reduce((sum, delivery) => sum + delivery.actualCost, 0);
  const recognizedClaims = facts.claims.reduce((sum, claim) => sum + claim.recognizedCost, 0);
  const platformSpend = facts.adSpend.reduce((sum, row) => sum + row.documentedSpend, 0);
  const inventoryPurchases = facts.inventoryPurchases.reduce((sum, row) => sum + row.documentedCost, 0);
  const manualAdAllocation = Math.round(facts.configuredAd.proratedBudget);
  if (manualAdAllocation > 0 && (platformSpend === 0 || Math.abs(manualAdAllocation - platformSpend) > Math.max(5000, manualAdAllocation * 0.2))) {
    addTask(queue, { id: "ad-spend-unreconciled", orderId: "", severity: "medium", category: "Pauta", title: "Pauta manual y gasto documentado no coinciden", detail: `La asignación manual del rango es ${manualAdAllocation} y las métricas respaldan ${platformSpend}.`, action: "Conciliar Meta, TikTok, influencers y otros soportes sin inventar el gasto faltante.", amount: Math.abs(manualAdAllocation - platformSpend), blocksClose: false });
  }

  queue.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || number(b.amount) - number(a.amount) || String(a.orderId || "").localeCompare(String(b.orderId || "")));
  const queueIndicators = queue.reduce((totals, task) => {
    if (task.blocksClose) totals.blocking += 1;
    if (task.id.startsWith("verify-payment-")) totals.paymentEvidenceWaiting += 1;
    if (task.category === "Domicilio") totals.deliveryIssues += 1;
    if (task.category === "Costo" || task.category === "Reclamo") totals.costIssues += 1;
    return totals;
  }, { blocking: 0, paymentEvidenceWaiting: 0, deliveryIssues: 0, costIssues: 0 });
  const grossMargin = productRevenue - cogs;
  const estimatedProfit = grossMargin + deliveryCollected - recordedDeliveryCosts - manualAdAllocation - recognizedClaims;
  const operatingResult = productRevenue - cogs + deliveryCollected - deliveryCosts - recognizedClaims - platformSpend;

  return {
    range: facts.range,
    queue,
    payments,
    summary: {
      ordersReviewed: orders.length,
      confirmedPaymentOrders: confirmedPayments.length,
      paidOrders: paidOrders.length,
      grossCollected,
      pendingValue,
      productRevenue,
      deliveryCollected,
      cogs,
      deliveryCosts,
      recognizedClaims,
      platformSpend,
      manualAdAllocation,
      configuredMonthlyAdBudget: facts.configuredAd.monthlyBudget,
      inventoryPurchases,
      rangeDays: facts.range.days,
      grossMargin,
      recordedDeliveryCosts,
      deliverySubsidy,
      recognizedClaimsForPeriod: recognizedClaims,
      estimatedProfit,
      operatingResult,
      exceptions: queue.length,
      blocking: queueIndicators.blocking,
      closeReady: queueIndicators.blocking === 0,
      paymentEvidenceWaiting: queueIndicators.paymentEvidenceWaiting,
      deliveryIssues: queueIndicators.deliveryIssues,
      costIssues: queueIndicators.costIssues,
    },
    caveats: [
      "Los cobros son valores brutos registrados en MOMO OPS; deben conciliarse contra Nequi, bancos y Rappi.",
      "El resultado operativo no incluye nómina, servicios, impuestos, comisiones de pasarela ni otros gastos aún no registrados.",
      "Las compras de inventario se muestran como salida de caja informativa, pero no se descuentan otra vez del resultado porque el COGS reconoce el consumo vendido.",
    ],
    source: { kind: facts.sourceKind, serverTime: facts.serverTime, completeRange: true },
  };
}
