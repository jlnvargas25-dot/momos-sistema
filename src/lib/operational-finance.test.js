import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationalFinance, financeOrderTotal } from "./operational-finance.js";

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
