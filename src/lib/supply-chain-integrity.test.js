import assert from "node:assert/strict";
import test from "node:test";
import { buildFinishedInventory } from "./finished-inventory.js";
import { evaluateExactVariantDemand } from "./variant-availability.js";
import { auditSupplyChainSnapshot } from "./supply-chain-integrity.js";

const TODAY = "2026-07-14";
const product = { id: "PR02", nombre: "Momo Perrito", cat: "Momos Signature", tipo: "momo", especie: "perro", activo: true };

test("pedido reservado, cola, desmolde, cancelación y entrega conservan una sola unidad", () => {
  const reserved = {
    products: [{ ...product, stock: 0 }],
    orders: [{ id: "O1", estado: "Pagado" }],
    inventory_reservations: [{ id: "R1", orderId: "O1", tipo: "producto", productId: "PR02", estado: "Reservada", cantidad: 1 }],
    variantes: [],
  };
  let view = buildFinishedInventory(reserved, { today: TODAY });
  assert.equal(view.summary.available, 0);
  assert.equal(view.summary.reserved, 1);
  assert.equal(evaluateExactVariantDemand({ productId: "PR02", figure: "Max", flavor: "Oreo", quantity: 1, variants: reserved.variantes, today: TODAY }).canFulfill, false);

  const queued = {
    products: [{ ...product, stock: 0 }],
    orders: [{ id: "O1", estado: "En producción" }],
    production_suggestions: [{ id: "S1", orderId: "O1", estado: "Pendiente", cantidad: 1 }],
    production_batches: [{ id: "L1", productId: "PR02", estado: "Congelando", prod: 1, perfectas: 0, imperfectas: 0, descartadas: 0, stockContabilizado: false }],
  };
  view = buildFinishedInventory(queued, { today: TODAY });
  assert.equal(view.summary.available, 0);
  assert.equal(view.summary.inProcess, 1);

  const assignedAfterMold = {
    products: [{ ...product, stock: 0 }],
    orders: [{ id: "O1", estado: "En producción" }],
    inventory_reservations: [{ id: "R2", orderId: "O1", tipo: "producto", productId: "PR02", estado: "Reservada", cantidad: 1, batchId: "L1", figuraLote: "Max" }],
    production_batches: [{ id: "L1", productId: "PR02", estado: "Listo", prod: 1, perfectas: 1, imperfectas: 0, descartadas: 0, stockContabilizado: true }],
    variantes: [],
  };
  view = buildFinishedInventory(assignedAfterMold, { today: TODAY });
  assert.equal(view.summary.available, 0);
  assert.equal(view.summary.reserved, 1);
  assert.equal(view.summary.inProcess, 0);

  const cancelled = {
    products: [{ ...product, stock: 1 }],
    orders: [{ id: "O1", estado: "Cancelado" }],
    inventory_reservations: [{ id: "R2", orderId: "O1", tipo: "producto", productId: "PR02", estado: "Liberada", cantidad: 1 }],
    variantes: [{ productId: "PR02", figura: "Max", sabor: "Oreo", disponibles: 1, vence: "2026-07-20" }],
  };
  view = buildFinishedInventory(cancelled, { today: TODAY });
  assert.equal(view.summary.available, 1);
  assert.equal(view.summary.reserved, 0);
  assert.equal(evaluateExactVariantDemand({ productId: "PR02", figure: "Max", flavor: "Oreo", quantity: 1, variants: cancelled.variantes, today: TODAY }).canFulfill, true);

  const delivered = {
    products: [{ ...product, stock: 0 }],
    orders: [{ id: "O1", estado: "Entregado" }],
    inventory_reservations: [{ id: "R2", orderId: "O1", tipo: "producto", productId: "PR02", estado: "Consumida", cantidad: 1 }],
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
    order_items: [{ id: "OI1", orderId: "O1", productId: "PR02", cant: 0.5, figura: "", sabor: "" }],
    inventory_reservations: [{ id: "R1", orderId: "O1", tipo: "producto", estado: "Reservada", cantidad: 1 }],
    production_suggestions: [{ id: "S1", orderId: "O1", estado: "Pendiente" }],
    production_batches: [{ id: "L1", productId: "PR02", estado: "Congelando", prod: 2, perfectas: 2, imperfectas: 1, descartadas: 0, stockContabilizado: true }],
    variantes: [{ productId: "PR02", figura: "Max", sabor: "Oreo", disponibles: 3, vence: "2026-07-13" }],
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
    order_items: [{ id: "OI1", orderId: "O1", productId: "PR02", cant: 1, figura: "Max", sabor: "Oreo" }],
    inventory_reservations: [{ id: "R1", orderId: "O1", tipo: "producto", estado: "Reservada", cantidad: 1 }],
    production_batches: [{ id: "L1", productId: "PR02", estado: "Listo", prod: 2, perfectas: 2, imperfectas: 0, descartadas: 0, stockContabilizado: true }],
    variantes: [{ productId: "PR02", figura: "Max", sabor: "Oreo", disponibles: 1, vence: "2026-07-20" }],
  }, { today: TODAY });

  assert.equal(audit.ok, true);
  assert.deepEqual(audit.issues, []);
});

test("un producto terminado independiente no se disfraza como figura", () => {
  const spoonable = { id: "P8", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "momo", stock: 0, activo: true };
  const audit = auditSupplyChainSnapshot({
    products: [spoonable],
    orders: [{ id: "O8", estado: "Nuevo" }],
    order_items: [{ id: "OI8", orderId: "O8", productId: "P8", cant: 1, figura: "", sabor: "Coco" }],
  }, { today: TODAY });
  assert.equal(audit.issues.some((entry) => entry.code === "ORDER_VARIANT_INCOMPLETE"), false);
});

test("un preparado al momento mal tipado no exige contabilización de stock de figuras", () => {
  const spoonable = { id: "P8", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "momo", stock: 0, activo: true };
  const audit = auditSupplyChainSnapshot({
    products: [spoonable],
    production_batches: [{
      id: "L8", productId: "P8", estado: "Listo", prod: 2,
      perfectas: 2, imperfectas: 0, descartadas: 0, stockContabilizado: false,
    }],
  }, { today: TODAY });

  assert.equal(audit.issues.some((entry) => entry.code === "READY_BATCH_NOT_ACCOUNTED"), false);
});

test("el auditor rechaza familias y siluetas legacy usadas como figuras físicas", () => {
  const audit = auditSupplyChainSnapshot({
    products: [product],
    orders: [{ id: "O9", estado: "Pagado" }],
    order_items: [{ id: "OI9", orderId: "O9", productId: "PR02", cant: 1, figura: "Gatito", sabor: "Oreo" }],
    production_batches: [{
      id: "L9", productId: "PR02", estado: "Congelando", prod: 1,
      figura: "Horizontal", perfectas: 0, imperfectas: 0, descartadas: 0, stockContabilizado: false,
    }],
  }, { today: TODAY });
  const codes = new Set(audit.issues.map((entry) => entry.code));
  assert.equal(codes.has("ORDER_VARIANT_INCOMPLETE"), true);
  assert.equal(codes.has("BATCH_FIGURE_INVALID"), true);
});

test("el auditor acepta únicamente las siete asignaciones canónicas sin mirar especie", () => {
  const products = [
    { id: "PR01", nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo", especie: "perro" },
    { id: "PR02", nombre: "Momo Perrito", cat: "Momos Signature", tipo: "momo", especie: "gato" },
    { id: "PR04", nombre: "Momo premium", cat: "Momos Signature", tipo: "momo", especie: "perro" },
  ];
  const assignments = [
    ["Lizi", "PR01"], ["Momo", "PR01"], ["Toby", "PR01"],
    ["Max", "PR02"], ["Rocco", "PR02"], ["Danna", "PR02"],
    ["Teo", "PR04"],
  ];
  const audit = auditSupplyChainSnapshot({
    products,
    order_items: assignments.map(([figura, productId], index) => ({
      id: `OI-C${index}`, productId, cant: 1, figura, sabor: "Oreo",
    })),
    production_batches: assignments.map(([figura, productId], index) => ({
      id: `L-C${index}`, productId, estado: "Congelando", figura,
      prod: 1, perfectas: 0, imperfectas: 0, descartadas: 0, stockContabilizado: false,
    })),
  }, { today: TODAY });

  const forbidden = new Set([
    "ORDER_FAMILY_FIGURE_MISMATCH", "ORDER_FIGURE_NOT_APPLICABLE",
    "BATCH_FAMILY_FIGURE_MISMATCH", "BATCH_FIGURE_NOT_APPLICABLE",
  ]);
  assert.deepEqual(audit.issues.filter((entry) => forbidden.has(entry.code)), []);
});

test("el auditor bloquea cruces familia-figura y figuras en elaboraciones al momento", () => {
  const audit = auditSupplyChainSnapshot({
    products: [
      { id: "PR01", nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo" },
      { id: "PR02", nombre: "Momo Perrito", cat: "Momos Signature", tipo: "momo" },
      { id: "PR08", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "pedido" },
    ],
    order_items: [
      { id: "OI-X1", productId: "PR01", cant: 1, figura: "Max", sabor: "Oreo" },
      { id: "OI-X2", productId: "PR08", cant: 1, figura: "Lizi", sabor: "Coco" },
    ],
    production_batches: [
      { id: "L-X1", productId: "PR02", estado: "Congelando", figura: "Teo", prod: 1, perfectas: 0, imperfectas: 0, descartadas: 0, stockContabilizado: false },
      { id: "L-X2", productId: "PR08", estado: "En preparación", figura: "Momo", prod: 1, perfectas: 0, imperfectas: 0, descartadas: 0, stockContabilizado: false },
    ],
  }, { today: TODAY });
  const codes = new Set(audit.issues.map((entry) => entry.code));
  assert.equal(codes.has("ORDER_FAMILY_FIGURE_MISMATCH"), true);
  assert.equal(codes.has("ORDER_FIGURE_NOT_APPLICABLE"), true);
  assert.equal(codes.has("BATCH_FAMILY_FIGURE_MISMATCH"), true);
  assert.equal(codes.has("BATCH_FIGURE_NOT_APPLICABLE"), true);
});

test("las cajas conservan padre e hijas separados y validan sus familias componentes", () => {
  const products = [
    { id: "PR01", nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo" },
    { id: "PR04", nombre: "Momo premium", cat: "Momos Signature", tipo: "momo" },
    { id: "PR05", nombre: "Caja x3 Momos", cat: "Cajas y Combos", tipo: "combo", componentProductIds: ["PR01"] },
  ];
  const valid = auditSupplyChainSnapshot({
    products,
    order_items: [
      { id: "BOX", orderId: "O1", productId: "PR05", cant: 1, esCaja: true, figura: "", sabor: "" },
      { id: "CHILD", orderId: "O1", parentItemId: "BOX", productId: "PR01", cant: 1, esSubMomo: true, figura: "Momo", sabor: "Oreo" },
    ],
  }, { today: TODAY });
  assert.equal(valid.issues.some((entry) => entry.code === "ORDER_COMBO_STRUCTURE_INVALID"), false);

  const invalid = auditSupplyChainSnapshot({
    products,
    order_items: [
      { id: "BOX", orderId: "O1", productId: "PR05", cant: 1, esCaja: true, figura: "", sabor: "" },
      { id: "CHILD", orderId: "O1", parentItemId: "BOX", productId: "PR04", cant: 1, esSubMomo: true, figura: "Teo", sabor: "Oreo" },
      { id: "LOOSE-COMBO", orderId: "O1", productId: "PR05", cant: 1, figura: "", sabor: "" },
    ],
  }, { today: TODAY });
  assert.equal(invalid.issues.filter((entry) => entry.code === "ORDER_COMBO_STRUCTURE_INVALID").length, 2);
});
