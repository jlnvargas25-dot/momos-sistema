import assert from "node:assert/strict";
import test from "node:test";
import { buildFinishedInventory } from "./finished-inventory.js";
import { evaluateExactVariantDemand } from "./variant-availability.js";
import { auditSupplyChainSnapshot } from "./supply-chain-integrity.js";

const TODAY = "2026-07-14";
const product = { id: "P1", nombre: "Momo Perrito", tipo: "momo", especie: "perro", activo: true };

test("pedido reservado, cola, desmolde, cancelación y entrega conservan una sola unidad", () => {
  const reserved = {
    products: [{ ...product, stock: 0 }],
    orders: [{ id: "O1", estado: "Pagado" }],
    inventory_reservations: [{ id: "R1", orderId: "O1", tipo: "producto", productId: "P1", estado: "Reservada", cantidad: 1 }],
    variantes: [],
  };
  let view = buildFinishedInventory(reserved, { today: TODAY });
  assert.equal(view.summary.available, 0);
  assert.equal(view.summary.reserved, 1);
  assert.equal(evaluateExactVariantDemand({ productId: "P1", figure: "Max", flavor: "Oreo", quantity: 1, variants: reserved.variantes, today: TODAY }).canFulfill, false);

  const queued = {
    products: [{ ...product, stock: 0 }],
    orders: [{ id: "O1", estado: "En producción" }],
    production_suggestions: [{ id: "S1", orderId: "O1", estado: "Pendiente", cantidad: 1 }],
    production_batches: [{ id: "L1", productId: "P1", estado: "Congelando", prod: 1, perfectas: 0, imperfectas: 0, descartadas: 0, stockContabilizado: false }],
  };
  view = buildFinishedInventory(queued, { today: TODAY });
  assert.equal(view.summary.available, 0);
  assert.equal(view.summary.inProcess, 1);

  const assignedAfterMold = {
    products: [{ ...product, stock: 0 }],
    orders: [{ id: "O1", estado: "En producción" }],
    inventory_reservations: [{ id: "R2", orderId: "O1", tipo: "producto", productId: "P1", estado: "Reservada", cantidad: 1, batchId: "L1", figuraLote: "Max" }],
    production_batches: [{ id: "L1", productId: "P1", estado: "Listo", prod: 1, perfectas: 1, imperfectas: 0, descartadas: 0, stockContabilizado: true }],
    variantes: [],
  };
  view = buildFinishedInventory(assignedAfterMold, { today: TODAY });
  assert.equal(view.summary.available, 0);
  assert.equal(view.summary.reserved, 1);
  assert.equal(view.summary.inProcess, 0);

  const cancelled = {
    products: [{ ...product, stock: 1 }],
    orders: [{ id: "O1", estado: "Cancelado" }],
    inventory_reservations: [{ id: "R2", orderId: "O1", tipo: "producto", productId: "P1", estado: "Liberada", cantidad: 1 }],
    variantes: [{ productId: "P1", figura: "Max", sabor: "Oreo", disponibles: 1, vence: "2026-07-20" }],
  };
  view = buildFinishedInventory(cancelled, { today: TODAY });
  assert.equal(view.summary.available, 1);
  assert.equal(view.summary.reserved, 0);
  assert.equal(evaluateExactVariantDemand({ productId: "P1", figure: "Max", flavor: "Oreo", quantity: 1, variants: cancelled.variantes, today: TODAY }).canFulfill, true);

  const delivered = {
    products: [{ ...product, stock: 0 }],
    orders: [{ id: "O1", estado: "Entregado" }],
    inventory_reservations: [{ id: "R2", orderId: "O1", tipo: "producto", productId: "P1", estado: "Consumida", cantidad: 1 }],
    variantes: [],
  };
  view = buildFinishedInventory(delivered, { today: TODAY });
  assert.equal(view.summary.available, 0);
  assert.equal(view.summary.reserved, 0);
  assert.equal(view.reservationHistory.length, 1);
});

test("el auditor detecta corrupción cruzada entre pedidos, producción e inventarios", () => {
  const audit = auditSupplyChainSnapshot({
    products: [{ ...product, stock: -2 }],
    inventory_items: [{ id: "I1", nombre: "Ganache", stock: -1 }],
    orders: [{ id: "O1", estado: "Cancelado" }],
    order_items: [{ id: "OI1", orderId: "O1", productId: "P1", cant: 0.5, figura: "", sabor: "" }],
    inventory_reservations: [{ id: "R1", orderId: "O1", tipo: "producto", estado: "Reservada", cantidad: 1 }],
    production_suggestions: [{ id: "S1", orderId: "O1", estado: "Pendiente" }],
    production_batches: [{ id: "L1", productId: "P1", estado: "Congelando", prod: 2, perfectas: 2, imperfectas: 1, descartadas: 0, stockContabilizado: true }],
    variantes: [{ productId: "P1", figura: "Max", sabor: "Oreo", disponibles: 3, vence: "2026-07-13" }],
  }, { today: TODAY });

  const codes = new Set(audit.issues.map((entry) => entry.code));
  [
    "PRODUCT_STOCK_NEGATIVE", "SUPPLY_STOCK_NEGATIVE", "ORDER_QUANTITY_INVALID",
    "ORDER_VARIANT_INCOMPLETE", "ACTIVE_RESERVATION_ON_TERMINAL_ORDER",
    "PENDING_SUGGESTION_ON_TERMINAL_ORDER", "BATCH_COUNTS_EXCEED_PRODUCTION",
    "BATCH_STOCK_IN_WRONG_STATE", "IN_PROCESS_BATCH_ACCOUNTED", "EXPIRED_FINISHED_STOCK",
  ].forEach((code) => assert.equal(codes.has(code), true, code));
  assert.equal(audit.ok, false);
});

test("un ciclo coherente no produce alertas de integridad", () => {
  const audit = auditSupplyChainSnapshot({
    products: [{ ...product, stock: 1 }],
    inventory_items: [{ id: "I1", nombre: "Ganache", stock: 2 }],
    orders: [{ id: "O1", estado: "Listo para despacho" }],
    order_items: [{ id: "OI1", orderId: "O1", productId: "P1", cant: 1, figura: "Max", sabor: "Oreo" }],
    inventory_reservations: [{ id: "R1", orderId: "O1", tipo: "producto", estado: "Reservada", cantidad: 1 }],
    production_batches: [{ id: "L1", productId: "P1", estado: "Listo", prod: 2, perfectas: 2, imperfectas: 0, descartadas: 0, stockContabilizado: true }],
    variantes: [{ productId: "P1", figura: "Max", sabor: "Oreo", disponibles: 1, vence: "2026-07-20" }],
  }, { today: TODAY });

  assert.equal(audit.ok, true);
  assert.deepEqual(audit.issues, []);
});
