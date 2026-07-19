import test from "node:test";
import assert from "node:assert/strict";
import { makeAgencyOperationalFacts } from "./agency-operational-facts.test-fixture.js";
import { agencyDecisionType, buildAgencyIntelligence, guardAgencyAction, normalizeAgencySettings } from "./agency-intelligence.js";

test("traduce tipos amigables al contrato cerrado del servidor", () => {
  assert.equal(agencyDecisionType("Repetir creativo"), "Crear contenido");
  assert.equal(agencyDecisionType("Impulsar producto"), "Crear contenido");
  assert.equal(agencyDecisionType("Activar cumpleaños"), "Contactar segmento");
  assert.equal(agencyDecisionType("Pausar campaña"), "Pausar campaña");
  assert.equal(agencyDecisionType("Idea desconocida"), "Otro");
});

test("bloquea pauta activa cuando el producto no tiene stock", () => {
  const db = {
    products: [{ id: "P-1", stock: 0 }],
    campaigns: [{ id: "CMP-1", nombre: "Momos frutales", estado: "Activa", productoFocoId: "P-1", presupuesto: 100000 }],
    orders: [], creative_results: [], content_calendar: [], customers: [], creatives: [],
  };
  const result = buildAgencyIntelligence(db, {}, "2026-07-14");
  assert.equal(result.recommendations[0].type, "Reponer stock");
  assert.equal(result.recommendations[0].risk, "Alto");
});

test("propone escalar solo cuando hay ventas y ROAS suficiente", () => {
  const db = {
    products: [{ id: "P-1", stock: 20 }],
    campaigns: [{ id: "CMP-1", nombre: "Ganadora", estado: "Activa", productoFocoId: "P-1", presupuesto: 100000 }],
    orders: [
      { id: "O-1", campaignId: "CMP-1", estado: "Pagado", total: 60000 },
      { id: "O-2", campaignId: "CMP-1", estado: "Entregado", total: 60000 },
    ],
    creative_results: [{ campaignId: "CMP-1", gasto: 40000, clicks: 12 }],
    content_calendar: [{ fecha: "2026-07-14", estado: "Programado" }], customers: [], creatives: [],
  };
  const result = buildAgencyIntelligence(db, { scaleStepPct: 10 }, "2026-07-14");
  const scale = result.recommendations.find((item) => item.type === "Escalar presupuesto");
  assert.equal(scale.proposedBudget, 110000);
  assert.equal(scale.evidence.roas, 3);
});

test("respeta No contactar y el modo Asesor", () => {
  const db = { customer_crm_profiles: [{ customerId: "C-1", contactAllowed: false }] };
  const guard = guardAgencyAction({ type: "Contactar segmento", customerIds: ["C-1"], execute: true }, db, { autonomyMode: "Asesor" });
  assert.equal(guard.allowed, false);
  assert.equal(guard.reasons.length, 2);
});

test("no trata un consentimiento desconocido como permiso comercial", () => {
  const guard = guardAgencyAction({ type: "Contactar segmento", customerIds: ["C-SIN-PERFIL"] }, {}, { contactOnlyAuthorized: true });
  assert.equal(guard.allowed, false);
  assert.match(guard.reasons[0], /autorización explícita/);
});

test("presupuesto y porcentaje quedan dentro de límites seguros", () => {
  const settings = normalizeAgencySettings({ dailyBudgetLimit: -1, scaleStepPct: 80 });
  assert.equal(settings.dailyBudgetLimit, 0);
  assert.equal(settings.scaleStepPct, 30);
  const guard = guardAgencyAction({ type: "Activar campaña", proposedBudget: 600000 }, {}, settings);
  assert.equal(guard.allowed, false);
});

test("convierte ventas pagadas y stock real en una oportunidad de producto", () => {
  const db = {
    products: [{ id: "P-1", nombre: "Momo Lizi", stock: 8, activo: true }],
    orders: [
      { id: "O-1", estado: "Pagado", fecha: "2026-07-10", total: 40000 },
      { id: "O-2", estado: "Entregado", fecha: "2026-07-12", total: 40000 },
      { id: "O-X", estado: "Cancelado", pagadoEn: "2026-07-12", fecha: "2026-07-12", total: 90000 },
    ],
    order_items: [
      { orderId: "O-1", productId: "P-1", cant: 2, precio: 20000 },
      { orderId: "O-2", productId: "P-1", cant: 2, precio: 20000 },
      { orderId: "O-X", productId: "P-1", cant: 50, precio: 20000 },
    ],
    campaigns: [], creative_results: [], content_calendar: [], customers: [], creatives: [],
  };
  const result = buildAgencyIntelligence(db, {}, "2026-07-14");
  const opportunity = result.recommendations.find((item) => item.type === "Impulsar producto");
  assert.equal(opportunity.productId, "P-1");
  assert.deepEqual(opportunity.signals, ["Vendidas 30 días: 4", "Pedidos: 2", "Stock: 8"]);
  assert.equal(opportunity.guard.allowed, true);
});

test("detecta inventario quieto sin inventar ventas ni campañas", () => {
  const result = buildAgencyIntelligence({
    products: [{ id: "P-QUIETO", nombre: "Momo Toby", stock: 7, activo: true }],
    orders: [], order_items: [], campaigns: [], creative_results: [], content_calendar: [], customers: [], creatives: [],
  }, {}, "2026-07-14");
  const opportunity = result.recommendations.find((item) => item.type === "Mover inventario");
  assert.equal(opportunity.productId, "P-QUIETO");
  assert.equal(opportunity.evidence.stock, 7);
  assert.equal(opportunity.priority, 68);
});

test("cumpleaños y reactivación incluyen únicamente clientes con permiso explícito", () => {
  const db = {
    customers: [
      { id: "C-SI", nombre: "Ana", cumple: "1995-07-18", ultima: "2026-05-01", telefono: "3001" },
      { id: "C-NO", nombre: "Beto", cumple: "07-19", ultima: "2026-05-01", telefono: "3002" },
    ],
    customer_crm_profiles: [
      { customerId: "C-SI", contactAllowed: true },
      { customerId: "C-NO", contactAllowed: false },
    ],
    products: [], orders: [], campaigns: [], creative_results: [], content_calendar: [], creatives: [],
  };
  const result = buildAgencyIntelligence(db, {}, "2026-07-14");
  assert.deepEqual(result.recommendations.find((item) => item.type === "Activar cumpleaños").customerIds, ["C-SI"]);
  assert.deepEqual(result.recommendations.find((item) => item.type === "Contactar segmento").customerIds, ["C-SI"]);
});

test("un creativo ganador exige pedidos pagados atribuidos y no una métrica declarativa", () => {
  const db = {
    creatives: [
      { id: "CR-REAL", titulo: "Hook real", estado: "Aprobado" },
      { id: "CR-FALSO", titulo: "Hook inflado", estado: "Aprobado" },
    ],
    orders: [
      { id: "O-1", creativeId: "CR-REAL", estado: "Pagado", fecha: "2026-07-10", total: 50000 },
      { id: "O-2", creativeId: "CR-REAL", estado: "Entregado", fecha: "2026-07-11", total: 50000 },
      { id: "O-3", creativeId: "CR-FALSO", estado: "Cancelado", fecha: "2026-07-11", total: 500000 },
    ],
    creative_results: [
      { creativeId: "CR-REAL", gasto: 40000 },
      { creativeId: "CR-FALSO", gasto: 1000, pedidos: 99, ventas: 999999 },
    ],
    products: [], order_items: [], campaigns: [], content_calendar: [], customers: [],
  };
  const result = buildAgencyIntelligence(db, {}, "2026-07-14");
  const repeats = result.recommendations.filter((item) => item.type === "Repetir creativo");
  assert.equal(repeats.length, 1);
  assert.equal(repeats[0].creativeId, "CR-REAL");
});

test("falla cerrado si una receta no permite verificar todos sus ingredientes", () => {
  const db = {
    products: [{ id: "P-RECETA", nombre: "Producto preparado", activo: true }],
    recipes: [
      { productId: "P-RECETA", itemId: "I-1", cantidad: 1 },
      { productId: "P-RECETA", itemId: "I-FALTA", cantidad: 1 },
    ],
    inventory_items: [{ id: "I-1", stock: 100 }],
  };
  const guard = guardAgencyAction({ type: "Impulsar producto", productId: "P-RECETA" }, db, { blockOutOfStock: true });
  assert.equal(guard.allowed, false);
  assert.match(guard.reasons[0], /disponibilidad verificable/);
});

test("prioriza de forma determinista y expone la cadena comercial completa", () => {
  const db = {
    products: [{ id: "P-1", nombre: "Momo Max", stock: 0 }],
    campaigns: [{ id: "CMP-1", nombre: "Max siempre activo", estado: "Activa", productoFocoId: "P-1" }],
    content_calendar: [], customers: [], orders: [], order_items: [], creative_results: [], creatives: [],
    agencyBriefs: [{ id: 1, status: "Borrador" }],
    agencyDecisions: [
      { id: 1, status: "Propuesta" },
      { id: 2, status: "Ejecutada", result: "3 pedidos pagados" },
    ],
    agencyCreativeVersions: [{ id: 1, status: "En revisión" }],
  };
  const first = buildAgencyIntelligence(db, {}, "2026-07-14");
  const second = buildAgencyIntelligence(db, {}, "2026-07-14");
  assert.deepEqual(first.recommendations.map((item) => item.id), second.recommendations.map((item) => item.id));
  assert.equal(new Set(first.recommendations.map((item) => item.id)).size, first.recommendations.length);
  assert.equal(first.recommendations[0].priority, 100);
  assert.deepEqual(first.pipeline, { opportunities: 2, briefs: 1, approvals: 1, creativeReview: 1, scheduled: 0, learning: 1 });
});

function h67FactsDb() {
  return {
    agencyOperationalFactsReady: true,
    agencyOperationalFacts: makeAgencyOperationalFacts({
      product_catalog: [
        { id: "P-CAM", name: "Momo campaña", active: true, available_stock: 8 },
        { id: "P-HIT", name: "Momo favorito", active: true, available_stock: 9 },
        { id: "P-IDLE", name: "Momo por mover", active: true, available_stock: 7 },
      ],
      product_sales_30d: [{ product_id: "P-HIT", units: 4, orders: 2, revenue: 80000 }],
      paid_summary: { orders_30d: 5, revenue_30d: 220000, attributed_orders_30d: 2 },
      campaign_attribution: [{ campaign_id: "CMP-1", orders: 2, revenue: 120000 }],
      creative_attribution: [{ creative_id: "CR-1", orders: 2, revenue: 100000 }],
      crm_segments: { birthdays_7d: 2, dormant_30d: 3, contains_customer_ids: false },
      calendar: {
        today: { posts: 0, published: 0, pending: 0 },
        next_7d: [{ date: "2026-07-15", posts: 1 }, { date: "2026-07-16", posts: 2 }],
      },
      production: { plan_units: 0, plan_runs: 0, queue_units: 0, active_batch_units: 0, critical_preparations: [] },
    }),
    campaigns: [{ id: "CMP-1", nombre: "Campaña segura", estado: "Activa", productoFocoId: "P-CAM", presupuesto: 100000 }],
    creatives: [{ id: "CR-1", titulo: "Hook aprobado", estado: "Aprobado", productoFocoId: "P-HIT", canal: "Instagram" }],
    creative_results: [{ campaignId: "CMP-1", creativeId: "CR-1", gasto: 40000, clicks: 12, mensajesWhatsApp: 4 }],
    agencyBriefs: [], agencyDecisions: [], agencyCreativeVersions: [],
  };
}

test("H67 calcula recomendaciones únicamente con hechos agregados y no lee operación cruda", () => {
  const db = h67FactsDb();
  for (const key of ["products", "orders", "order_items", "customers", "customer_crm_profiles", "content_calendar"]) {
    Object.defineProperty(db, key, {
      configurable: true,
      get() { throw new Error(`H67 intentó leer ${key}`); },
    });
  }

  const result = buildAgencyIntelligence(db, {}, "2026-07-14");
  const scale = result.recommendations.find((item) => item.type === "Escalar presupuesto");
  const product = result.recommendations.find((item) => item.type === "Impulsar producto");
  const creative = result.recommendations.find((item) => item.type === "Repetir creativo");
  const birthdays = result.recommendations.find((item) => item.type === "Activar cumpleaños");
  const dormant = result.recommendations.find((item) => item.type === "Contactar segmento");

  assert.deepEqual(scale.evidence, { roas: 3, orders: 2, revenue: 120000, spend: 40000 });
  assert.deepEqual(product.evidence, { units30d: 4, orders30d: 2, revenue30d: 80000, stock: 9 });
  assert.deepEqual(creative.evidence, { orders: 2, revenue: 100000, spend: 40000, roas: 2.5 });
  assert.equal(Object.hasOwn(birthdays, "customerIds"), false);
  assert.equal(Object.hasOwn(dormant, "customerIds"), false);
  assert.equal(result.summary.revenue, 220000);
  assert.equal(result.summary.eligibleCustomers, 5);
  assert.equal(result.summary.scheduledNext7, 3);
  assert.equal(result.pipeline.scheduled, 3);
});

test("H67 es invariante ante órdenes y PII locales y conserva el fallback H66 sin facts", () => {
  const factsOnly = h67FactsDb();
  const poisoned = {
    ...h67FactsDb(),
    products: [{ id: "P-PII", nombre: "NO-USAR", stock: 999 }],
    orders: [{ id: "O-PII", estado: "Pagado", total: 999999999, campaignId: "CMP-1", creativeId: "CR-1" }],
    order_items: [{ orderId: "O-PII", productId: "P-PII", cant: 999, precio: 999999 }],
    customers: [{ id: "C-PII", nombre: "PII-NOMBRE-SECRETO", telefono: "300-PII-SECRETO", cumple: "07-14", ultima: "2020-01-01" }],
    customer_crm_profiles: [{ customerId: "C-PII", contactAllowed: true }],
    content_calendar: [{ fecha: "2026-07-14", estado: "Programado", notas: "PII-NOTA-SECRETA" }],
  };

  const expected = buildAgencyIntelligence(factsOnly, {}, "2026-07-14");
  const actual = buildAgencyIntelligence(poisoned, {}, "2026-07-14");
  assert.deepEqual(actual, expected);
  assert.doesNotMatch(JSON.stringify(actual), /PII-|300-PII|NO-USAR/);

  const legacy = buildAgencyIntelligence({
    products: [{ id: "P-LEGACY", nombre: "Legado", stock: 6, activo: true }],
    orders: [], order_items: [], customers: [], content_calendar: [], campaigns: [], creatives: [], creative_results: [],
  }, {}, "2026-07-14");
  assert.equal(legacy.recommendations.some((item) => item.type === "Mover inventario"), true);
});

test("H67 no escala una campaña cuando su stock es desconocido", () => {
  const db = h67FactsDb();
  db.agencyOperationalFacts = makeAgencyOperationalFacts({
    product_catalog: [{ product_id: "P-CAM", name: "Momo campaña", active: true, available_stock: null, stock_source: "unverified" }],
    product_sales_30d: [],
    paid_summary: { orders_30d: 2, revenue_30d: 120000, orders_all: 2, revenue_all: 120000, attributed_orders_30d: 2 },
    campaign_attribution: [{ campaign_id: "CMP-1", orders: 2, revenue: 120000 }],
  });
  const result = buildAgencyIntelligence(db, {}, "2026-07-14");
  assert.equal(result.recommendations.some((item) => item.type === "Escalar presupuesto"), false);
  const verify = result.recommendations.find((item) => item.id === "verify-stock-CMP-1");
  assert.equal(verify.evidence.stock, null);
  assert.equal(verify.evidence.stockSource, "unverified");
  assert.equal(verify.guard.allowed, false);
  assert.match(verify.guard.reasons.join(" "), /disponibilidad verificable/i);
});
