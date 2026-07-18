import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationalFinance, buildOperationalFinanceFromFacts, financeOrderTotal, normalizeFinancialFacts, validateFinancialDateRange } from "./operational-finance.js";

function fixture() {
  return {
    products: [{ id: "PR-1", nombre: "Momo", costo: 9000 }],
    inventory_items: [{ id: "I-1", nombre: "Crema", costo: 12000 }],
    orders: [{ id: "P-1", fecha: "2026-07-15", canal: "WhatsApp", pago: "Nequi", estado: "Entregado", pagadoEn: "2026-07-15 10:00", descuento: 1000, domCobrado: 5000, domCosto: 6000 }],
    order_items: [{ id: "L-1", orderId: "P-1", productId: "PR-1", nombre: "Momo", cant: 2, precio: 18000, costoUnitario: 7000, adiciones: [] }],
    evidences: [{ id: "E-1", orderId: "P-1", tipo: "Comprobante de pago" }],
    deliveries: [{ id: "D-1", orderId: "P-1", estado: "Entregado", costoReal: 6000, cobrado: 5000 }],
    claims: [],
    creative_results: [],
    inventory_movements: [],
  };
}

test("resume cobros confirmados y conserva el costo histórico de la venta", () => {
  const db = fixture();
  db.products[0].costo = 99999;
  const result = buildOperationalFinance(db, { from: "2026-07-15", to: "2026-07-15" });

  assert.equal(financeOrderTotal(db, db.orders[0]), 40000);
  assert.equal(result.summary.grossCollected, 40000);
  assert.equal(result.summary.cogs, 14000);
  assert.equal(result.summary.operatingResult, 20000);
  assert.equal(result.summary.closeReady, true);
});

test("un comprobante recibido no se convierte en cobro hasta que una persona confirme", () => {
  const db = fixture();
  db.orders[0].estado = "Pendiente de pago";
  delete db.orders[0].pagadoEn;

  const result = buildOperationalFinance(db, { from: "2026-07-15", to: "2026-07-15" });
  assert.equal(result.summary.grossCollected, 0);
  assert.equal(result.summary.pendingValue, 40000);
  assert.equal(result.summary.paymentEvidenceWaiting, 1);
  assert.equal(result.queue[0].id, "verify-payment-P-1");
});

test("bloquea el cierre si un pedido avanzó sin pago o un cancelado conserva pago", () => {
  const db = fixture();
  db.orders.push({ id: "P-2", fecha: "2026-07-15", canal: "WhatsApp", pago: "Nequi", estado: "En producción", descuento: 0, domCobrado: 0 });
  db.order_items.push({ id: "L-2", orderId: "P-2", productId: "PR-1", cant: 1, precio: 18000, costoUnitario: 7000 });
  db.orders[0].estado = "Cancelado";

  const result = buildOperationalFinance(db, { from: "2026-07-15", to: "2026-07-15" });
  assert.equal(result.summary.grossCollected, 40000);
  assert.equal(result.summary.closeReady, false);
  assert.ok(result.queue.some((task) => task.id === "refund-P-1"));
  assert.ok(result.queue.some((task) => task.id === "unpaid-operation-P-2"));
});

test("detecta domicilios duplicados, costos ausentes y diferencias sin sumarlas como una sola verdad", () => {
  const db = fixture();
  db.orders.push({ id: "P-2", fecha: "2026-07-15", canal: "WhatsApp", pago: "Nequi", estado: "En ruta", pagadoEn: "2026-07-15 11:00", descuento: 0, domCobrado: 7000, domCosto: 0 });
  db.order_items.push({ id: "L-2", orderId: "P-2", productId: "PR-1", cant: 1, precio: 18000, costoUnitario: 7000 });
  db.evidences.push({ id: "E-2", orderId: "P-2", tipo: "Comprobante de pago" });
  db.deliveries[0].costoReal = 6500;
  db.deliveries.push({ id: "D-2", orderId: "P-1", estado: "Asignado", costoReal: 5000, cobrado: 5000 });

  const result = buildOperationalFinance(db, { from: "2026-07-15", to: "2026-07-15" });
  assert.ok(result.queue.some((task) => task.id === "delivery-mismatch-P-1"));
  assert.ok(result.queue.some((task) => task.id === "duplicate-delivery-P-1"));
  assert.ok(result.queue.some((task) => task.id === "delivery-cost-P-2"));
  assert.equal(result.summary.deliveryIssues, 3);
});

test("Rappi no exige comprobante de transferencia y una venta bancaria sí", () => {
  const db = fixture();
  db.evidences = [];
  db.orders.push({ id: "P-2", fecha: "2026-07-15", canal: "Rappi", pago: "Rappi (app)", estado: "Entregado", pagadoEn: "2026-07-15 12:00", descuento: 0, domCobrado: 0, domCosto: 0 });
  db.order_items.push({ id: "L-2", orderId: "P-2", productId: "PR-1", cant: 1, precio: 23000, costoUnitario: 7000 });

  const result = buildOperationalFinance(db, { from: "2026-07-15", to: "2026-07-15" });
  assert.ok(result.queue.some((task) => task.id === "missing-payment-proof-P-1"));
  assert.ok(!result.queue.some((task) => task.id === "missing-payment-proof-P-2"));
  assert.ok(!result.queue.some((task) => task.id === "delivery-cost-P-2"));
});

test("no oculta descuentos imposibles, costos faltantes ni reclamos aprobados en cero", () => {
  const db = fixture();
  db.orders[0].descuento = 999999;
  db.order_items[0].costoUnitario = 0;
  db.claims.push({ id: "R-1", orderId: "P-1", fecha: "2026-07-15", estado: "Compensado", costo: 0 });

  const result = buildOperationalFinance(db, { from: "2026-07-15", to: "2026-07-15" });
  assert.ok(result.queue.some((task) => task.id === "invalid-total-P-1"));
  assert.ok(result.queue.some((task) => task.id === "missing-cost-P-1"));
  assert.ok(result.queue.some((task) => task.id === "claim-cost-R-1"));
  assert.equal(result.summary.closeReady, false);
});

test("las compras de inventario informan caja pero no duplican el costo de ventas", () => {
  const db = fixture();
  db.inventory_movements = [{ id: "M-1", fecha: "2026-07-15 08:00", tipo: "Entrada", item: "Crema", cant: "+3 L", nota: "Compra" }];
  db.creative_results = [{ id: "MET-1", fecha: "2026-07-15", gasto: 4000 }];

  const result = buildOperationalFinance(db, { from: "2026-07-15", to: "2026-07-15" });
  assert.equal(result.summary.inventoryPurchases, 36000);
  assert.equal(result.summary.cogs, 14000);
  assert.equal(result.summary.operatingResult, 16000);
});

test("separa por medio de pago para conciliar contra extractos", () => {
  const db = fixture();
  db.orders.push({ id: "P-2", fecha: "2026-07-15", canal: "Rappi", pago: "Rappi (app)", estado: "Entregado", pagadoEn: "2026-07-15 12:00", descuento: 0, domCobrado: 0, domCosto: 0 });
  db.order_items.push({ id: "L-2", orderId: "P-2", productId: "PR-1", cant: 1, precio: 23000, costoUnitario: 7000 });

  const result = buildOperationalFinance(db, { from: "2026-07-15", to: "2026-07-15" });
  assert.deepEqual(result.payments.map((row) => [row.method, row.orders, row.amount]), [
    ["Nequi", 1, 40000],
    ["Rappi (app)", 1, 23000],
  ]);
});

test("diferencia pauta manual de gasto respaldado sin inventar el faltante", () => {
  const db = fixture();
  db.settings = { pautaMensual: 300000 };

  const result = buildOperationalFinance(db, { from: "2026-07-15", to: "2026-07-15" });
  const task = result.queue.find((row) => row.id === "ad-spend-unreconciled");
  assert.ok(task);
  assert.equal(result.summary.manualAdAllocation, 10000);
  assert.equal(result.summary.platformSpend, 0);
  assert.equal(task.blocksClose, false);
});

test("expone en el mismo resumen los indicadores que consume la vista financiera", () => {
  const db = fixture();
  db.settings = { pautaMensual: 300000 };
  db.creative_results = [{ id: "MET-1", fecha: "2026-07-15", gasto: 4000 }];
  db.claims = [{ id: "R-1", orderId: "P-1", estado: "Compensado", costo: 2000 }];

  const result = buildOperationalFinance(db, { from: "2026-07-15", to: "2026-07-15" });

  assert.equal(result.summary.rangeDays, 1);
  assert.equal(result.summary.grossMargin, 21000);
  assert.equal(result.summary.recordedDeliveryCosts, 6000);
  assert.equal(result.summary.deliverySubsidy, 1000);
  assert.equal(result.summary.recognizedClaimsForPeriod, 2000);
  assert.equal(result.summary.manualAdAllocation, 10000);
  assert.equal(result.summary.estimatedProfit, 8000);
  assert.equal(result.summary.operatingResult, 16000);
});

test("preindexa relaciones financieras y conserva la primera coincidencia historica", () => {
  const db = fixture();
  db.products.push({ id: "PR-1", nombre: "Duplicado", costo: 1 });
  db.inventory_items.push({ id: "I-1", nombre: "Crema", costo: 1 });
  db.order_items[0].costoUnitario = null;
  db.order_items[0].adiciones = [{ insumoId: "I-1", insumoCant: 0.01, cant: 1, precio: 1000 }];
  db.inventory_movements = [{ id: "M-1", fecha: "2026-07-15", tipo: "Compra", item: "Crema", cant: "+3 L" }];
  db.claims = [{ id: "R-1", orderId: "P-1", estado: "Abierto", costo: 0 }];

  for (const collection of ["products", "inventory_items", "orders", "evidences", "deliveries", "claims"]) {
    Object.defineProperty(db[collection], "find", {
      configurable: true,
      value() { throw new Error(`scan repetido en ${collection}`); },
    });
  }

  const result = buildOperationalFinance(db, { from: "2026-07-15", to: "2026-07-15" });

  assert.equal(result.summary.grossCollected, 42000);
  assert.equal(result.summary.cogs, 18240);
  assert.equal(result.summary.inventoryPurchases, 36000);
  assert.ok(result.queue.some((task) => task.id === "claim-open-R-1"));
});

function serverFactsFixture(orderCount = 1) {
  const orders = Array.from({ length: orderCount }, (_, index) => ({
    order_id: `P-${index + 1}`,
    order_date: "2026-07-15",
    channel: "WhatsApp",
    state: "Entregado",
    payment_method: index % 2 ? "Daviplata" : "Nequi",
    payment_confirmed: true,
    campaign_id: null,
    creative_id: null,
    product_revenue: 36000,
    cogs: 14000,
    discount: 1000,
    delivery_collected: 5000,
    delivery_cost_on_order: 6000,
    payment_fee: 0,
    total_charged: 40000,
    line_count: 1,
    incomplete_cost_lines: 0,
    has_payment_evidence: true,
  }));
  const deliveries = orders.map((order, index) => ({
    delivery_id: `D-${index + 1}`,
    order_id: order.order_id,
    state: "Entregado",
    actual_cost: 6000,
    charged: 5000,
  }));
  return {
    version: 1,
    server_time: "2026-07-15T20:00:00Z",
    range: { from: "2026-07-15", to: "2026-07-15", days: 1 },
    orders,
    deliveries,
    claims: [],
    inventory_purchases: [{ movement_id: "M-1", lot_id: "IL-1", purchase_date: "2026-07-15", item_id: "I-1", quantity: 3, unit_cost: 12000, documented_cost: 36000, origin: "Compra" }],
    ad_spend: [{ metric_id: "MET-1", metric_date: "2026-07-15", source: "Meta", campaign_id: null, creative_id: null, post_id: null, documented_spend: 4000 }],
    configured_ad: { monthly_budget: 300000, range_days: 1, prorated_budget: 10000 },
    counts: { orders: orders.length, deliveries: deliveries.length, claims: 0, inventory_purchases: 1, ad_spend_rows: 1 },
    accounting_sources: { order_revenue_and_cogs: "v_order_totals" },
    contains_pii: false,
    contains_free_text: false,
    contains_storage_references: false,
    external_execution: false,
  };
}

test("normaliza H65 y usa la fuente completa para el mismo resumen de Finanzas", () => {
  const facts = normalizeFinancialFacts(serverFactsFixture(), { from: "2026-07-15", to: "2026-07-15" });
  const result = buildOperationalFinanceFromFacts(facts);

  assert.equal(result.source.kind, "server-financial-facts-v1");
  assert.equal(result.summary.ordersReviewed, 1);
  assert.equal(result.summary.productRevenue, 35000);
  assert.equal(result.summary.cogs, 14000);
  assert.equal(result.summary.grossMargin, 21000);
  assert.equal(result.summary.grossCollected, 40000);
  assert.equal(result.summary.recordedDeliveryCosts, 6000);
  assert.equal(result.summary.deliveryCosts, 6000);
  assert.equal(result.summary.inventoryPurchases, 36000);
  assert.equal(result.summary.platformSpend, 4000);
  assert.equal(result.summary.manualAdAllocation, 10000);
  assert.equal(result.summary.estimatedProfit, 10000);
  assert.equal(result.summary.operatingResult, 16000);
});

test("H65 no pierde pedidos cuando el snapshot operativo supera cincuenta terminales", () => {
  const result = buildOperationalFinanceFromFacts(serverFactsFixture(75));
  assert.equal(result.summary.ordersReviewed, 75);
  assert.equal(result.summary.paidOrders, 75);
  assert.equal(result.summary.grossCollected, 3000000);
  assert.equal(result.payments.reduce((sum, row) => sum + row.orders, 0), 75);
});

test("H65 falla cerrado ante privacidad, conteos o rango ajenos", () => {
  const unsafe = serverFactsFixture();
  unsafe.contains_pii = true;
  assert.throws(() => normalizeFinancialFacts(unsafe), /inseguro/);

  const incomplete = serverFactsFixture();
  incomplete.counts.orders = 2;
  assert.throws(() => normalizeFinancialFacts(incomplete), /incompleto/);

  assert.throws(() => normalizeFinancialFacts(serverFactsFixture(), { from: "2026-07-14", to: "2026-07-15" }), /otro rango/);
  assert.throws(() => validateFinancialDateRange("2026-07-15", "2026-07-14"), /no es válido/);
  assert.throws(() => validateFinancialDateRange("2025-01-01", "2026-07-15"), /367 días/);
});

test("H65 señala costos incompletos sin inventar su valor monetario", () => {
  const payload = serverFactsFixture();
  payload.orders[0].incomplete_cost_lines = 2;
  const result = buildOperationalFinanceFromFacts(payload);
  const task = result.queue.find((row) => row.id === "missing-cost-P-1");
  assert.ok(task);
  assert.equal(task.amount, 0);
  assert.match(task.detail, /2 líneas/);
});
