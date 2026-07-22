import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDashboardSnapshot } from "./dashboard-sync.js";

function validSnapshot() {
  return {
    contract: "momos.dashboard-snapshot.v1", version: 1, snapshotVersion: "77",
    serverTime: "2026-07-19T15:00:00Z", businessDate: "2026-07-19",
    summary: { salesToday: 55000, ordersToday: 1, activeOrders: 2, pendingPayments: 1, pendingPaymentAmount: 55000, openClaims: 0 },
    assistantCenter: {
      primary: { title: "Cobrar P-1", detail: "El pedido espera confirmación de pago.", ownerRoles: ["Administrador"], nextAction: "Abrir Pedidos." },
      assistants: [{ id: "ventas", name: "Ventas", module: "Pedidos", count: 1, status: "Atención" }],
      tasks: [{ id: "pay:P-1", area: "VENTAS", module: "Pedidos", ownerRoles: ["Administrador"], entityId: "P-1", entityType: "Pedido", severity: "high", blocks: false, confidence: "Alta", confirmationRequired: true, title: "Cobrar P-1", detail: "El pedido espera confirmación de pago.", nextAction: "Abrir Pedidos.", reasons: ["Pago pendiente"] }],
      summary: { health: "Atención", tasks: 1, critical: 0, blocking: 0 }, policy: "Toda acción sensible requiere confirmación humana.",
    },
    notices: { productionSuggestions: [], freezingReady: [], publicationsToday: [], creativeReviews: [], campaignsWithoutOrders: [], winner: null },
    brandAssistant: { ideaToday: null, customerContact: null, campaignReview: null, contentRepeat: null, benefitExpiring: null, taskMissing: null },
    inventoryAlerts: { lowStock: [], expiringSoon: [] }, customerSummary: { new: 1, recurrent: 2 },
    ordersByState: [{ label: "Nuevo", value: 1 }], salesByChannel: [{ label: "WhatsApp", value: 55000 }],
    productAvailability: [{ id: "PR1", name: "Momo Gatito", type: "momo", available: 4, low: false }],
    privacy: { containsCustomerPii: false, containsStaffPii: false, containsFreeText: false, containsStorageReferences: false, containsSecrets: false, externalExecution: false },
  };
}

test("H77 acepta únicamente el contrato compacto esperado", () => {
  const normalized = normalizeDashboardSnapshot(validSnapshot());
  assert.equal(normalized.snapshotVersion, "77");
  assert.equal(normalized.assistantCenter.tasks.length, 1);
  assert.equal(normalized.summary.salesToday, 55000);
});

test("H77 falla cerrado ante PII, campos extra o colecciones sin límite", () => {
  const pii = validSnapshot();
  pii.privacy.containsCustomerPii = true;
  assert.throws(() => normalizeDashboardSnapshot(pii), /privacidad/i);
  const extra = validSnapshot();
  extra.customerName = "No debe existir";
  assert.throws(() => normalizeDashboardSnapshot(extra), /contrato/i);
  const unbounded = validSnapshot();
  unbounded.notices.productionSuggestions = Array.from({ length: 13 }, (_, id) => ({ id }));
  assert.throws(() => normalizeDashboardSnapshot(unbounded), /sugerencias/i);
});

test("H77 no acepta tareas abiertas ni versiones ambiguas", () => {
  const task = validSnapshot();
  task.assistantCenter.tasks[0].freeNote = "texto libre";
  assert.throws(() => normalizeDashboardSnapshot(task), /tarea/i);
  const version = validSnapshot();
  version.snapshotVersion = "7.7";
  assert.throws(() => normalizeDashboardSnapshot(version), /versión/i);
});
