import test from "node:test";
import assert from "node:assert/strict";
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
