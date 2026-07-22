import test from "node:test";
import assert from "node:assert/strict";
import {
  agencyOperationalFactsReady, normalizeAgencyOperationalFacts, projectAgencyDbWithOperationalFacts,
} from "./agency-operational-facts.js";

const limits = {
  product_catalog: 500, product_sales_30d: 500,
  campaign_attribution: 500, creative_attribution: 500, published_post_attribution: 500,
  critical_preparations: 50,
};
const counts = {
  product_catalog: 1, product_sales_30d: 1,
  campaign_attribution: 1, creative_attribution: 1, published_post_attribution: 1,
  critical_preparations: 1,
};
const notTruncated = Object.fromEntries(Object.keys(limits).map((key) => [key, false]));

const raw = {
  facts_ready: true,
  contract_version: 1,
  generated_at: "2026-07-18T18:00:00Z",
  limits,
  counts,
  truncated: notTruncated,
  product_catalog: [{
    product_id: "P01", name: "Momo Perrito", category: "Momos Signature", type: "simple", species: "perro",
    price: 18000, active: true, queue_units: 1, in_process_units: 2, production_buffer: 2,
    available_stock: 5, stock_source: "exact-variants",
  }],
  product_sales_30d: [{ product_id: "P01", units: 4, orders: 3, revenue: 72000 }],
  paid_summary: { orders_30d: 3, revenue_30d: 72000, orders_all: 9, revenue_all: 216000, attributed_orders_30d: 2 },
  campaign_attribution: [{ campaign_id: "C01", orders: 2, revenue: 54000 }],
  creative_attribution: [{ creative_id: "CR01", orders: 2, revenue: 54000 }],
  published_post_attribution: [{ post_id: "POST01", orders: 2, revenue: 54000, ambiguous_orders: 0 }],
  crm_segments: { birthdays_7d: 2, dormant_30d: 4, contains_customer_ids: false },
  calendar: { today: { posts: 0, published: 0 }, next_7d: [{ date: "2026-07-19", posts: 1 }] },
  production: { plan_units: 8, plan_runs: 2, queue_units: 5, active_batch_units: 3, critical_preparations: [{ name: "Mousse", flavor: "Durazno", recommended_amount: 0.3, unit: "kg", severity: "CrÃ­tica" }] },
};

test("normaliza el contrato compacto H67 sin registros de clientes", () => {
  const facts = normalizeAgencyOperationalFacts(raw);
  assert.equal(facts.contractVersion, 1);
  assert.equal(facts.productCatalog[0].availableStock, 5);
  assert.equal(facts.productCatalog[0].stockVerified, true);
  assert.deepEqual(facts.crmSegments, { birthdays7d: 2, dormant30d: 4, containsCustomerIds: false });
  assert.deepEqual(facts.production.criticalPreparations[0], { name: "Mousse", flavor: "Durazno", recommendedAmount: 0.3, unit: "kg", severity: "CrÃ­tica" });
  assert.equal(JSON.stringify(facts).includes("telefono"), false);
  assert.deepEqual(normalizeAgencyOperationalFacts(facts), facts);
});

test("proyecta solo facts y catÃ¡logos de Agencia sin alterar ni leer la operaciÃ³n cruda", () => {
  const db = {
    products: [{ id: "P01", nombre: "Anterior", activo: false, precio: 18000, telefono: "PII" }],
    agencyOperationalFacts: raw,
    agencyBriefs: [{ id: 3, status: "Aprobado" }],
    creatives: [{ id: "CR01", estado: "Aprobado" }],
    agencyPostproductionExports: [{ id: 8, status: "Aprobado" }],
  };
  for (const key of ["orders", "order_items", "customers", "customer_crm_profiles", "inventory_items", "inventory_lots", "recipes", "variantes", "production_batches"]) {
    Object.defineProperty(db, key, { enumerable: true, get() { throw new Error(`PII/operaciÃ³n leÃ­da: ${key}`); } });
  }
  const projected = projectAgencyDbWithOperationalFacts(db);
  assert.notEqual(projected, db);
  assert.deepEqual(projected.products, [{
    id: "P01", nombre: "Momo Perrito", activo: true, stock: 5, agencyAvailableStock: 5,
    stockSource: "exact-variants", stockVerified: true,
    categoria: "Momos Signature", tipo: "simple", especie: "perro", precio: 18000, colchonProduccion: 2,
    unidadesEnCola: 1, unidadesEnProceso: 2,
  }]);
  assert.deepEqual(projected.agencyBriefs, db.agencyBriefs);
  assert.deepEqual(projected.agencyPostproductionExports, db.agencyPostproductionExports);
  assert.equal(db.products[0].nombre, "Anterior");
  for (const key of ["orders", "order_items", "customers", "customer_crm_profiles", "inventory_items", "inventory_lots", "recipes", "variantes", "production_batches"]) {
    assert.equal(Object.hasOwn(projected, key), false);
  }
  assert.doesNotMatch(JSON.stringify(projected), /Anterior|telefono|PII/);
});

test("conserva null como stock desconocido y nunca lo degrada a agotado cero", () => {
  const unknown = {
    ...raw,
    product_catalog: [{ ...raw.product_catalog[0], available_stock: null, stock_source: "unverified" }],
  };
  const facts = normalizeAgencyOperationalFacts(unknown);
  assert.equal(facts.productCatalog[0].availableStock, null);
  assert.equal(facts.productCatalog[0].stockVerified, false);
  const projected = projectAgencyDbWithOperationalFacts({ agencyOperationalFacts: unknown });
  assert.equal(projected.products[0].stock, null);
  assert.equal(projected.products[0].stockVerified, false);
  assert.equal(normalizeAgencyOperationalFacts({ ...unknown, product_catalog: [{ ...unknown.product_catalog[0], available_stock: 0 }] }), null);
});

test("falla cerrado ante ausencias, null, tipos invÃ¡lidos y metadatos inconsistentes", () => {
  assert.equal(agencyOperationalFactsReady(null), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, contract_version: 2 }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, facts_ready: false }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, counts: null }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, limits: { ...limits, product_catalog: 0 } }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, counts: { ...counts, product_catalog: 2 } }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, counts: { ...counts, legacy_extra: 0 } }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, truncated: { ...notTruncated, product_catalog: true } }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, paid_summary: { ...raw.paid_summary, orders_30d: null } }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, paid_summary: { ...raw.paid_summary, orders_30d: true } }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, paid_summary: { ...raw.paid_summary, orders_30d: [] } }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, paid_summary: { ...raw.paid_summary, orders_30d: {} } }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, paid_summary: { ...raw.paid_summary, orders_30d: "   " } }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, crm_segments: { ...raw.crm_segments, contains_customer_ids: true } }), false);
  assert.equal(agencyOperationalFactsReady({ ...raw, product_sales_30d: [{ product_id: "P01", units: -1, orders: 1, revenue: 1 }] }), false);
  assert.equal(agencyOperationalFactsReady({
    ...raw,
    production: {
      ...raw.production,
      critical_preparations: [{ name: "Mousse", recommended_amount: 0.3, unit: "kg", severity: "CrÃ­tica" }],
    },
  }), false);
  assert.equal(normalizeAgencyOperationalFacts({}), null);
});

test("un H67 declarado listo pero invÃ¡lido no devuelve el db operativo; H66 conserva su fallback", () => {
  const invalidH67 = { agencyOperationalFactsReady: true, agencyOperationalFacts: { ...raw, counts: null } };
  for (const key of ["orders", "customers", "inventory_items"]) {
    Object.defineProperty(invalidH67, key, { enumerable: true, get() { throw new Error(`no leer ${key}`); } });
  }
  const closed = projectAgencyDbWithOperationalFacts(invalidH67);
  assert.equal(closed.agencyOperationalFactsInvalid, true);
  assert.equal(closed.agencyOperationalFactsReady, false);
  assert.deepEqual(closed.products, []);
  assert.equal(Object.hasOwn(closed, "orders"), false);

  const h66 = {
    agencyOperationalFactsReady: false,
    products: [{ id: "P-H66", nombre: "Momo H66", stock: 99, costo: 5000, telefono: "PII" }],
    orders: [{ id: "O-H66" }], customers: [{ id: "C-H66" }], recipes: [{ productId: "P-H66" }],
    agencyBriefs: [{ id: 1 }],
  };
  const degraded = projectAgencyDbWithOperationalFacts(h66);
  assert.notEqual(degraded, h66);
  assert.deepEqual(degraded.products, [{ id: "P-H66", nombre: "Momo H66", activo: true }]);
  assert.deepEqual(degraded.agencyBriefs, [{ id: 1 }]);
  for (const key of ["orders", "customers", "recipes"]) assert.equal(Object.hasOwn(degraded, key), false);
  assert.doesNotMatch(JSON.stringify(degraded), /PII|99|5000/);
});
