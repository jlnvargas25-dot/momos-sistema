import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultCommercialPilotDraft, eligibleOrdersForPilot, normalizeCommercialPilotSnapshot, pilotNextStep,
} from "./commercial-pilot.js";

function snapshot(overrides = {}) {
  return {
    contract: "momos.commercial-pilot.snapshot.v2",
    capturedAt: "2026-07-22T12:00:00Z",
    pilots: [{
      id: "10200000-0000-4000-8000-000000000001",
      key: "pilot-staging-102",
      environment: "Staging",
      status: "Borrador",
      plannedOrders: 2,
      maxOrderTotal: 150000,
      linkedOrders: 0,
      reconciledOrders: 0,
      approvedSignoffs: 1,
      startsAt: "2026-07-22T12:00:00Z",
      expiresAt: "2026-07-23T12:00:00Z",
      version: 2,
      signoffs: [
        { area: "Producto", status: "Aprobado" },
        { area: "Operaciones", status: "Pendiente" },
        { area: "Finanzas", status: "Pendiente" },
        { area: "Seguridad y Privacidad", status: "Pendiente" },
      ],
      orders: [],
    }],
    eligibleOrders: [{ id: "P-1064", status: "Pagado", total: 68000, paidAt: "2026-07-22T11:00:00Z" }],
    permissions: { canPrepare: true, signableAreas: ["Producto", "Operaciones", "Finanzas", "Seguridad y Privacidad"] },
    health: { ready: true, status: "Saludable", operationReadOnly: false, blockingIncidents: 0 },
    authority: { actorPresent: true, readOnly: true, publicTrafficOpened: false },
    privacy: { containsCustomerPii: false, containsSecrets: false, containsFreeText: false },
    externalExecution: false,
    ...overrides,
  };
}

test("H104 normaliza la muestra compacta y sus cuatro firmas", () => {
  const result = normalizeCommercialPilotSnapshot(snapshot());
  assert.equal(result.detailed, true);
  assert.equal(result.pilots[0].signoffs.length, 4);
  assert.equal(result.pilots[0].signoffs[0].status, "Aprobado");
  assert.equal(pilotNextStep(result.pilots[0]), "Completar 3 aprobación(es)");
});

test("H104 falla cerrado ante PII, secretos, tráfico o conteos imposibles", () => {
  assert.throws(() => normalizeCommercialPilotSnapshot(snapshot({ customerPhone: "3000000000" })), /campo privado/);
  assert.throws(() => normalizeCommercialPilotSnapshot(snapshot({ externalExecution: true })), /ejecución externa/);
  assert.throws(() => normalizeCommercialPilotSnapshot(snapshot({ privacy: { containsCustomerPii: true, containsSecrets: false, containsFreeText: false } })), /privacidad/);
  const impossible = snapshot();
  impossible.pilots[0].linkedOrders = 3;
  assert.throws(() => normalizeCommercialPilotSnapshot(impossible), /conteos no cierran/);
});

test("H104 solo ofrece pedidos bajo el tope y con cupo en curso", () => {
  const result = normalizeCommercialPilotSnapshot(snapshot({
    eligibleOrders: [
      { id: "P-1", status: "Pagado", total: 68000, paidAt: "2026-07-22T11:00:00Z" },
      { id: "P-2", status: "Pagado", total: 180000, paidAt: "2026-07-22T11:05:00Z" },
    ],
  }));
  const pilot = { ...result.pilots[0], status: "En curso" };
  assert.deepEqual(eligibleOrdersForPilot(result, pilot).map((order) => order.id), ["P-1"]);
  assert.deepEqual(eligibleOrdersForPilot(result, { ...pilot, status: "Listo" }), []);
});

test("H104 construye una ventana local coherente sin iniciar nada", () => {
  const draft = defaultCommercialPilotDraft(new Date("2026-07-22T10:00:00-05:00"));
  assert.equal(draft.environment, "Staging");
  assert.equal(draft.plannedOrders, 5);
  assert.ok(new Date(draft.expiresAt).getTime() > new Date(draft.startsAt).getTime());
});
