import test from "node:test";
import assert from "node:assert/strict";
import { buildKitchenProductionPlan, productionRunDraft } from "./production-planner.js";

function baseDb() {
  return {
    orders: [
      { id: "O-1", estado: "Pagado", fecha: "2026-07-14", campaignId: "CMP-1" },
      { id: "O-2", estado: "Pagado", fecha: "2026-07-14" },
    ],
    order_items: [
      { id: "L-1", orderId: "O-1", productId: "P-G", nombre: "Momo Gatito", figura: "Lizi", sabor: "Maracuyá", relleno: "Cheesecake con ganache", cant: 1, precio: 18000 },
      { id: "L-2", orderId: "O-2", productId: "P-G", nombre: "Momo Gatito", figura: "Momo", sabor: "Maracuyá", relleno: "Cheesecake con ganache", cant: 1, precio: 18000 },
    ],
    products: [{ id: "P-G", nombre: "Momo Gatito", tipo: "momo", activo: true }],
    figuras: [
      { nombre: "Lizi", productId: "P-G", gramajeG: 150, activo: true },
      { nombre: "Momo", productId: "P-G", gramajeG: 180, activo: true },
    ],
    production_suggestions: [
      { id: "S-1", estado: "Pendiente", area: "Producción", orderId: "O-1", orderItemId: "L-1", productId: "P-G", cantidad: 1 },
      { id: "S-2", estado: "Pendiente", area: "Producción", orderId: "O-2", orderItemId: "L-2", productId: "P-G", cantidad: 1 },
    ],
    variantes: [], production_batches: [], inventoryLotsReady: false, inventory_lots: [],
    inventory_items: [
      { id: "I-MAR", nombre: "Mousse maracuyá", unidad: "kg", stock: 0.2, min: 0.1 },
      { id: "I-GAN", nombre: "Ganache", unidad: "kg", stock: 0.02, min: 0.05 },
    ],
    subrecetas: [
      { id: "SR-MAR", nombre: "Mousse maracuyá", tipo: "mousse_frutal", sabor: "Maracuyá", itemId: "I-MAR", activo: true },
      { id: "SR-GAN", nombre: "Ganache", tipo: "ganache", itemId: "I-GAN", activo: true },
    ],
    figura_relleno: [{ id: "FR-1", subrecetaId: "SR-GAN", gramosPorUnidad: 20, activo: true }],
    campaigns: [{ id: "CMP-1", nombre: "Maracuyá ganador", estado: "Activa" }],
    creatives: [], creative_results: [{ campaignId: "CMP-1", gasto: 10000 }],
  };
}

test("agrupa dos faltantes del mismo sabor y relleno en una sola corrida", () => {
  const result = buildKitchenProductionPlan(baseDb(), { today: "2026-07-15", historyDays: 28, horizonDays: 3 });
  assert.equal(result.plans.length, 1);
  const plan = result.plans[0];
  assert.equal(plan.flavor, "Maracuyá");
  assert.deepEqual(plan.suggestionIds.sort(), ["S-1", "S-2"]);
  assert.equal(plan.queueUnits, 2);
  assert.equal(plan.totalUnits, 2);
  const draft = productionRunDraft(plan, baseDb().figuras, "Cheesecake con ganache");
  assert.deepEqual(draft.figuras, { Lizi: 1, Momo: 1 });
});

test("no mezcla sabores o rellenos incompatibles en la misma corrida", () => {
  const db = baseDb();
  db.order_items[1] = { ...db.order_items[1], sabor: "Coco" };
  const result = buildKitchenProductionPlan(db, { today: "2026-07-15" });
  assert.equal(result.plans.length, 2);
  assert.deepEqual(result.plans.map((plan) => plan.flavor).sort(), ["Coco", "Maracuyá"]);
});

test("calcula mousse y relleno que deben prepararse antes de los lotes agrupados", () => {
  const result = buildKitchenProductionPlan(baseDb(), { today: "2026-07-15" });
  const mousse = result.preparationNeeds.find((need) => need.subrecipeId === "SR-MAR");
  const ganache = result.preparationNeeds.find((need) => need.subrecipeId === "SR-GAN");
  assert.equal(mousse.required, 0.29);
  assert.equal(mousse.shortage, 0.09);
  assert.equal(mousse.recommendedGrams, 200);
  assert.equal(ganache.required, 0.04);
  assert.equal(ganache.recommendedGrams, 100);
});

test("la demanda pagada atribuida a pauta ganadora agrega un colchón explicable", () => {
  const db = baseDb();
  db.production_suggestions = [];
  db.orders = [];
  db.order_items = [];
  for (let day = 9; day <= 15; day += 1) {
    const id = `O-${day}`;
    db.orders.push({ id, estado: "Entregado", fecha: `2026-07-${day}`, campaignId: "CMP-1" });
    db.order_items.push({ id: `L-${day}`, orderId: id, productId: "P-G", figura: "Lizi", sabor: "Maracuyá", relleno: "Cheesecake con ganache", cant: 1, precio: 50000 });
  }
  db.creative_results = [{ campaignId: "CMP-1", gasto: 50000 }];
  const result = buildKitchenProductionPlan(db, { today: "2026-07-15", historyDays: 28, horizonDays: 3 });
  assert.equal(result.plans[0].variants[0].forecast, 3);
  assert.equal(result.plans[0].variants[0].adBuffer, 1);
  assert.equal(result.plans[0].totalUnits, 4);
  assert.match(result.policy, /pedidos pagados atribuidos/);
});

test("no inventa demanda por clics si no existe una venta atribuida", () => {
  const db = baseDb();
  db.production_suggestions = [];
  db.orders = [{ id: "O-X", estado: "Cancelado", fecha: "2026-07-14", campaignId: "CMP-1" }];
  db.order_items = [{ id: "L-X", orderId: "O-X", productId: "P-G", figura: "Lizi", sabor: "Maracuyá", relleno: "Cheesecake con ganache", cant: 50, precio: 50000 }];
  db.creative_results = [{ campaignId: "CMP-1", gasto: 50000, clicks: 10000 }];
  const result = buildKitchenProductionPlan(db, { today: "2026-07-15" });
  assert.equal(result.plans.length, 0);
});

test("no trata un preparado al momento mal tipado como familia de figuras", () => {
  const db = baseDb();
  db.products = [{
    id: "P-CUCHARA", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara",
    tipo: "momo", activo: true,
  }];
  db.orders = [{ id: "O-CUCHARA", estado: "Pagado", fecha: "2026-07-14" }];
  db.order_items = [{
    id: "L-CUCHARA", orderId: "O-CUCHARA", productId: "P-CUCHARA",
    figura: "Lizi", sabor: "Coco", cant: 10,
  }];
  db.production_suggestions = [];

  const result = buildKitchenProductionPlan(db, { today: "2026-07-15" });
  assert.equal(result.plans.length, 0);
});

test("producto en proceso y stock exacto vigente reducen la recomendación sin ocultar la cola", () => {
  const db = baseDb();
  db.production_suggestions = [];
  db.orders = [db.orders[0]];
  db.order_items = [db.order_items[0]];
  db.variantes = [{ productId: "P-G", figura: "Lizi", sabor: "Maracuyá", relleno: "Cheesecake con ganache", disponibles: 1, vence: "2026-07-16" }];
  db.production_batches = [{ productId: "P-G", figuras: [{ figura: "Lizi", cant: 1 }], sabor: "Maracuyá", relleno: "Cheesecake con ganache", estado: "Congelando" }];
  const result = buildKitchenProductionPlan(db, { today: "2026-07-15", horizonDays: 3 });
  assert.equal(result.plans.length, 0);
});

test("bloquea una necesidad cuya familia contradice el productId canónico de la figura", () => {
  const db = baseDb();
  db.products.push({ id: "P-OTRA", nombre: "Momo premium", tipo: "momo", activo: true });
  db.production_suggestions = [{
    id: "S-MISMATCH", estado: "Pendiente", area: "Producción", orderId: "O-1",
    orderItemId: "L-1", productId: "P-OTRA", cantidad: 1,
  }];
  const result = buildKitchenProductionPlan(db, { today: "2026-07-15" });
  assert.equal(result.plans.some((plan) => plan.suggestionIds.includes("S-MISMATCH")), false);
  assert.deepEqual(result.integrityIssues[0], {
    code: "ORDER_VARIANT_PRODUCT_MISMATCH", sourceId: "S-MISMATCH", productId: "P-OTRA",
    canonicalProductId: "P-G", figure: "Lizi", flavor: "Maracuyá", canCreate: false,
  });
});

test("el plan de Cocina no convierte Gatito ni Horizontal en figuras producibles", () => {
  const db = baseDb();
  db.figuras.push({ nombre: "Gatito", productId: "P-G", gramajeG: 180, activo: true });
  db.order_items[0] = { ...db.order_items[0], figura: "Gatito" };
  db.production_suggestions = [{
    id: "S-LEGACY", estado: "Pendiente", area: "Producción", orderId: "O-1",
    orderItemId: "L-1", productId: "P-G", cantidad: 1,
  }];
  const result = buildKitchenProductionPlan(db, { today: "2026-07-15" });
  assert.equal(result.plans.some((plan) => plan.suggestionIds.includes("S-LEGACY")), false);
  assert.equal(result.integrityIssues.some((issue) => issue.code === "NON_CANONICAL_FIGURE"), true);

  const draft = productionRunDraft({ variants: [{ figure: "Horizontal", recommended: 3 }] }, [
    ...db.figuras, { nombre: "Horizontal", productId: "P-G", activo: true },
  ]);
  assert.equal("Horizontal" in draft.figuras, false);
  assert.equal("Gatito" in draft.figuras, false);
});
