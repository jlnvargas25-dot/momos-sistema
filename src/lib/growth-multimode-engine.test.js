import test from "node:test";
import assert from "node:assert/strict";
import { buildGrowthMultimodeEngine, growthSnapshotPayload, GROWTH_MODE_IDS } from "./growth-multimode-engine.js";
import { normalizeAgencyOperationalFacts } from "./agency-operational-facts.js";
import { makeAgencyOperationalFacts } from "./agency-operational-facts.test-fixture.js";

const product = { id: "P1", nombre: "Momo Gatito", tipo: "momo", activo: true };
const base = {
  products: [product],
  figuras: [{ nombre: "Lizi", productId: "P1", gramajeG: 150, activo: true }],
  orders: [{ id: "O1", estado: "Entregado", fecha: "2026-07-15", campaignId: "C1" }],
  order_items: [{ id: "LI1", orderId: "O1", productId: "P1", nombre: "Momo Gatito", figura: "Lizi", sabor: "Coco", relleno: "Ganache", cant: 2, precio: 18000 }],
  variantes: [{ productId: "P1", figura: "Lizi", sabor: "Coco", disponibles: 4, vence: "2026-07-19" }],
  production_suggestions: [], production_batches: [], inventory_items: [], inventory_lots: [],
  recipes: [], subrecetas: [], figura_relleno: [], creative_results: [{ campaignId: "C1", gasto: 9000 }],
  creatives: [{ id: "CR1", estado: "Aprobado" }], agencyMetaIncrementalityReady: true,
  agencyBrandProfile: { status: "Activo" },
};

test("expone exactamente cuatro modos separados y una recomendación determinística", () => {
  const first = buildGrowthMultimodeEngine(base, { today: "2026-07-17" });
  const second = buildGrowthMultimodeEngine(base, { today: "2026-07-17" });
  assert.deepEqual(first, second);
  assert.deepEqual(first.modes.map((mode) => mode.id), GROWTH_MODE_IDS);
  assert.ok(GROWTH_MODE_IDS.includes(first.recommendedModeId));
  assert.equal(first.policy.externalExecution, false);
  assert.equal(first.policy.humanDecisionRequired, true);
});

test("venta inmediata solo queda lista con variante exacta vigente", () => {
  const ready = buildGrowthMultimodeEngine(base, { today: "2026-07-17" });
  assert.equal(ready.modes[0].status.value, "Listo");
  const expired = buildGrowthMultimodeEngine({ ...base, variantes: [{ ...base.variantes[0], vence: "2026-07-16" }] }, { today: "2026-07-17" });
  assert.equal(expired.modes[0].status.value, "Preparar");
  assert.match(expired.modes[0].nextStep, /Producción/i);
});

test("demanda agresiva crea cobertura de producción y nunca elimina sus gates", () => {
  const db = {
    ...base,
    variantes: [],
    production_suggestions: [{ id: "S1", orderId: "O1", orderItemId: "LI1", productId: "P1", cantidad: 3, estado: "Pendiente", area: "Producción" }],
  };
  const result = buildGrowthMultimodeEngine(db, { today: "2026-07-17" });
  const mode = result.modes.find((item) => item.id === "conquistar-demanda");
  assert.equal(mode.status.value, "Plan listo");
  assert.ok(mode.productionPlan.units >= 3);
  assert.ok(mode.safeguards.some((item) => /no salta/i.test(item)));
  assert.equal(mode.recommendation.evidence.externalExecution, false);
});

test("orgánico puede construir marca sin prometer stock y ofrece formatos humanos y animados", () => {
  const result = buildGrowthMultimodeEngine({ ...base, variantes: [], orders: [], order_items: [] }, { today: "2026-07-17" });
  const mode = result.modes.find((item) => item.id === "marca-comunidad");
  assert.equal(mode.channel, "Orgánico");
  assert.equal(mode.status.value, "Listo");
  assert.ok(mode.angles.some((item) => /Acompáñame/i.test(item.title)));
  assert.ok(mode.angles.some((item) => item.format === "Animación"));
  assert.ok(mode.why.some((item) => /no promete disponibilidad/i.test(item)));
});

test("pauta falla cerrada sin creativo o medición y conserva varios ángulos", () => {
  const blocked = buildGrowthMultimodeEngine({ ...base, creatives: [], creative_results: [], agencyMetaIncrementalityReady: false }, { today: "2026-07-17" });
  const mode = blocked.modes.find((item) => item.id === "pauta-aprendizaje");
  assert.equal(mode.status.value, "Preparar");
  assert.match(mode.status.detail, /creativo aprobado/i);
  assert.match(mode.status.detail, /medición/i);
  assert.equal(mode.channel, "Pauta");
  assert.ok(mode.angles.length >= 4);
  assert.ok(mode.safeguards.some((item) => /Sin gasto ni publicación automática/i.test(item)));
});

test("el snapshot no inventa ventas ni atribución cuando no hay pedidos", () => {
  const result = buildGrowthMultimodeEngine({ ...base, orders: [], order_items: [], creative_results: [] }, { today: "2026-07-17" });
  assert.equal(result.facts.paidOrders30d, 0);
  assert.equal(result.facts.attributedOrders30d, 0);
  result.modes.forEach((mode) => assert.equal(mode.recommendation.evidence.externalExecution, false));
});

test("H67 usa hechos operativos agregados sin leer órdenes, lotes ni producción cruda", () => {
  const rawFacts = makeAgencyOperationalFacts({
    product_catalog: [
      { product_id: "P1", name: "Momo Gatito", active: true, available_stock: 7, customer_id: "PII-CUSTOMER" },
      { product_id: "P2", name: "Momo Perrito", active: true, available_stock: 1 },
    ],
    product_sales_30d: [
      { product_id: "P1", units: 6, orders: 4, revenue: 108000, order_id: "ORDER-SECRET" },
      { product_id: "P2", units: 2, orders: 2, revenue: 36000 },
    ],
    paid_summary: { orders_30d: 6, revenue_30d: 144000, attributed_orders_30d: 3 },
    published_post_attribution: [],
    production: {
      plan_units: 9,
      plan_runs: 2,
      queue_units: 5,
      active_batch_units: 4,
      critical_preparations: [{ name: "Mousse", flavor: "Durazno", recommended_amount: 0.35, unit: "kg", severity: "Crítica", batch_id: "BATCH-SECRET" }],
    },
  });
  const db = {
    ...base,
    agencyOperationalFactsReady: true,
    agencyOperationalFacts: rawFacts,
    get orders() { throw new Error("H67 no debe leer orders"); },
    get order_items() { throw new Error("H67 no debe leer order_items"); },
    get variantes() { throw new Error("H67 no debe leer variantes"); },
    get production_suggestions() { throw new Error("H67 no debe leer production_suggestions"); },
    get production_batches() { throw new Error("H67 no debe leer production_batches"); },
    get inventory_items() { throw new Error("H67 no debe leer inventory_items"); },
  };

  const result = buildGrowthMultimodeEngine(db, { today: "2026-07-17" });
  const demandMode = result.modes.find((mode) => mode.id === "conquistar-demanda");
  assert.equal(result.facts.source, "agency-operational-facts-v1");
  assert.equal(result.facts.exactStockUnits, 8);
  assert.equal(result.facts.paidOrders30d, 6);
  assert.equal(result.facts.attributedOrders30d, 3);
  assert.equal(result.facts.queueUnits, 5);
  assert.equal(result.facts.productionUnits, 9);
  assert.equal(result.facts.activeBatchUnits, 4);
  assert.equal(result.facts.criticalPreparations, 1);
  assert.deepEqual(demandMode.productionPlan, {
    runs: 2,
    units: 9,
    preparations: [{ name: "Mousse Durazno", amount: 0.35, unit: "kg" }],
  });
  assert.doesNotMatch(JSON.stringify(result), /PII-CUSTOMER|ORDER-SECRET|BATCH-SECRET/);
});

test("H66 sigue siendo el fallback cuando los hechos H67 no están listos", () => {
  const result = buildGrowthMultimodeEngine({
    ...base,
    agencyOperationalFactsReady: false,
    agencyOperationalFacts: { contract_version: 1, paid_summary: { orders_30d: 999 } },
  }, { today: "2026-07-17" });
  assert.equal(result.facts.source, "h66-fallback");
  assert.equal(result.facts.paidOrders30d, 1);
});

test("H67 consume también el corte ya normalizado por el read model", () => {
  const db = {
    ...base,
    agencyOperationalFactsReady: true,
    agencyOperationalFacts: normalizeAgencyOperationalFacts(makeAgencyOperationalFacts({
      product_catalog: [{ product_id: "P1", name: "Momo Gatito", active: true, available_stock: 3 }],
      product_sales_30d: [{ product_id: "P1", units: 5, orders: 4, revenue: 90000 }],
      paid_summary: { orders_30d: 4, revenue_30d: 90000, orders_all: 4, revenue_all: 90000, attributed_orders_30d: 2 },
      production: { plan_units: 2, plan_runs: 1, queue_units: 1, active_batch_units: 1, critical_preparations: [] },
    })),
    get orders() { throw new Error("el corte normalizado no debe volver a orders"); },
  };
  const result = buildGrowthMultimodeEngine(db, { today: "2026-07-17" });
  assert.equal(result.facts.source, "agency-operational-facts-v1");
  assert.equal(result.facts.paidOrders30d, 4);
  assert.equal(result.facts.exactStockUnits, 3);
});

test("H67 bloquea venta, conquista y pauta cuando el stock del producto foco es desconocido", () => {
  const unknownFacts = makeAgencyOperationalFacts({
    product_catalog: [{ product_id: "P1", name: "Momo Gatito", active: true, available_stock: null, stock_source: "unverified" }],
    product_sales_30d: [{ product_id: "P1", units: 5, orders: 4, revenue: 90000 }],
    paid_summary: { orders_30d: 4, revenue_30d: 90000, orders_all: 4, revenue_all: 90000, attributed_orders_30d: 2 },
    production: { plan_units: 6, plan_runs: 1, queue_units: 2, active_batch_units: 1, critical_preparations: [] },
  });
  const result = buildGrowthMultimodeEngine({
    ...base, agencyOperationalFactsReady: true, agencyOperationalFacts: unknownFacts,
  }, { today: "2026-07-17" });
  assert.equal(result.facts.exactStockUnits, 0);
  assert.equal(result.facts.stockCoverageVerified, false);
  assert.equal(result.facts.unverifiedStockProducts, 1);
  for (const id of ["venta-inmediata", "conquistar-demanda", "pauta-aprendizaje"]) {
    assert.equal(result.modes.find((mode) => mode.id === id).status.value, "Bloqueado");
  }
  assert.equal(result.recommendedModeId, "marca-comunidad");
});

test("el payload sellable es estable, no incluye el brief y mantiene los cuatro modos", () => {
  const engine = buildGrowthMultimodeEngine(base, { today: "2026-07-17" });
  const first = growthSnapshotPayload(engine);
  const second = growthSnapshotPayload(engine);
  assert.deepEqual(first, second);
  assert.match(first.snapshot_key, /^growth:2026-07-17:engine-[0-9a-f]{8}$/);
  assert.equal(first.modes.length, 4);
  assert.equal("recommendation" in first.modes[0], false);
});
