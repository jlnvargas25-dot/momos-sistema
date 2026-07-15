import test from "node:test";
import assert from "node:assert/strict";
import { buildAgencyIntelligence, guardAgencyAction, normalizeAgencySettings } from "./agency-intelligence.js";

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
