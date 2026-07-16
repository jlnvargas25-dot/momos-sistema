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

const additionsTotal = (line) => (Array.isArray(line?.adiciones) ? line.adiciones : [])
  .reduce((sum, addition) => sum + number(addition.precio) * Math.max(1, number(addition.cant)) * Math.max(1, number(line.cant)), 0);

const lineCost = (db, line) => {
  const product = (db.products || []).find((row) => row.id === line.productId);
  const base = line.costoUnitario !== undefined && line.costoUnitario !== null
    ? number(line.costoUnitario)
    : number(product?.costo);
  const additions = (Array.isArray(line?.adiciones) ? line.adiciones : []).reduce((sum, addition) => {
    if (!addition.insumoId) return sum;
    const item = (db.inventory_items || []).find((row) => row.id === addition.insumoId);
    return sum + number(addition.insumoCant) * Math.max(1, number(addition.cant)) * Math.max(1, number(line.cant)) * number(addition.insumoCosto ?? item?.costo);
  }, 0);
  return base * number(line.cant) + additions;
};

export function financeOrderSubtotal(db, order) {
  return (db.order_items || [])
    .filter((line) => line.orderId === order.id)
    .reduce((sum, line) => sum + number(line.precio) * number(line.cant) + additionsTotal(line), 0);
}

export function financeOrderTotal(db, order) {
  return financeOrderSubtotal(db, order) - number(order.descuento) + number(order.domCobrado);
}

function paymentEvidenceFor(db, orderId) {
  return (db.evidences || []).some((evidence) => evidence.orderId === orderId && /comprobante.*pago|pago.*comprobante/.test(normalize(evidence.tipo)));
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
  const itemsByOrder = new Map();
  (db.order_items || []).forEach((line) => {
    const current = itemsByOrder.get(line.orderId) || [];
    current.push(line);
    itemsByOrder.set(line.orderId, current);
  });

  const confirmedPayments = orders.filter((order) => order.pagadoEn);
  const paidOrders = confirmedPayments.filter((order) => !PREPAYMENT_STATES.has(order.estado) && order.estado !== "Cancelado");
  const unpaidOrders = orders.filter((order) => !order.pagadoEn && order.estado !== "Cancelado");
  const queue = [];

  orders.forEach((order) => {
    const lines = itemsByOrder.get(order.id) || [];
    const subtotal = financeOrderSubtotal(db, order);
    const total = financeOrderTotal(db, order);
    const paymentEvidence = paymentEvidenceFor(db, order.id);
    const isRappi = normalize(order.canal) === "rappi" || normalize(order.pago).includes("rappi");
    const deliveries = (db.deliveries || []).filter((delivery) => delivery.orderId === order.id && ACTIVE_DELIVERY_STATES.has(delivery.estado));
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
        const product = (db.products || []).find((row) => row.id === line.productId);
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

  (db.claims || []).filter((claim) => {
    const order = (db.orders || []).find((row) => row.id === claim.orderId);
    return inRange(claim.fecha || order?.fecha, from, to);
  }).forEach((claim) => {
    if (["En revisión", "Abierto", "Pendiente"].includes(claim.estado)) {
      addTask(queue, { id: `claim-open-${claim.id}`, orderId: claim.orderId, severity: "medium", category: "Reclamo", title: "Reclamo con exposición aún desconocida", detail: `${claim.id} está ${claim.estado} y todavía no debe asumirse como costo cero.`, action: "Definir decisión y costo antes del cierre definitivo.", amount: number(claim.costo), blocksClose: false });
    }
    if (["Aprobado", "Compensado"].includes(claim.estado) && number(claim.costo) <= 0) {
      addTask(queue, { id: `claim-cost-${claim.id}`, orderId: claim.orderId, severity: "high", category: "Reclamo", title: "Compensación aprobada sin costo", detail: `${claim.id} está ${claim.estado}, pero su costo sigue en cero.`, action: "Registrar producto, devolución o beneficio entregado a costo real.", amount: 0 });
    }
  });

  const grossCollected = confirmedPayments.reduce((sum, order) => sum + financeOrderTotal(db, order), 0);
  const productRevenue = paidOrders.reduce((sum, order) => sum + financeOrderSubtotal(db, order) - number(order.descuento), 0);
  const deliveryCollected = paidOrders.reduce((sum, order) => sum + number(order.domCobrado), 0);
  const cogs = paidOrders.reduce((sum, order) => sum + (itemsByOrder.get(order.id) || []).reduce((lineSum, line) => lineSum + lineCost(db, line), 0), 0);
  const paidOrderIds = new Set(paidOrders.map((order) => order.id));
  const deliveryCosts = (db.deliveries || []).filter((delivery) => paidOrderIds.has(delivery.orderId) && delivery.estado !== "Cancelado")
    .reduce((sum, delivery) => sum + number(delivery.costoReal), 0);
  const recognizedClaims = (db.claims || []).filter((claim) => ["Aprobado", "Compensado"].includes(claim.estado) && inRange(claim.fecha, from, to))
    .reduce((sum, claim) => sum + number(claim.costo), 0);
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
      const item = (db.inventory_items || []).find((row) => row.nombre === movement.item);
      return sum + parseMovementAmount(movement.cant) * number(item?.costo);
    }, 0);

  const paymentsMap = new Map();
  confirmedPayments.forEach((order) => {
    const method = order.pago || "Sin medio";
    const current = paymentsMap.get(method) || { method, orders: 0, amount: 0 };
    current.orders += 1;
    current.amount += financeOrderTotal(db, order);
    paymentsMap.set(method, current);
  });
  const payments = [...paymentsMap.values()].sort((a, b) => b.amount - a.amount);

  queue.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || number(b.amount) - number(a.amount) || String(a.orderId || "").localeCompare(String(b.orderId || "")));
  const blocking = queue.filter((task) => task.blocksClose);
  const pendingValue = unpaidOrders.reduce((sum, order) => sum + Math.max(0, financeOrderTotal(db, order)), 0);
  const operatingResult = productRevenue - cogs + deliveryCollected - deliveryCosts - recognizedClaims - platformSpend;

  return {
    range: { from, to },
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
      inventoryPurchases,
      operatingResult,
      exceptions: queue.length,
      blocking: blocking.length,
      closeReady: blocking.length === 0,
      paymentEvidenceWaiting: queue.filter((task) => task.id.startsWith("verify-payment-")).length,
      deliveryIssues: queue.filter((task) => task.category === "Domicilio").length,
      costIssues: queue.filter((task) => task.category === "Costo" || task.category === "Reclamo").length,
    },
    caveats: [
      "Los cobros son valores brutos registrados en MOMO OPS; deben conciliarse contra Nequi, bancos y Rappi.",
      "El resultado operativo no incluye nómina, servicios, impuestos, comisiones de pasarela ni otros gastos aún no registrados.",
      "Las compras de inventario se muestran como salida de caja informativa, pero no se descuentan otra vez del resultado porque el COGS reconoce el consumo vendido.",
    ],
  };
}
