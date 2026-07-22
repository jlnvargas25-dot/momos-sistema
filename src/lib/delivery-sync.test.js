import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDeliverySnapshot, syncDeliverySnapshotOrders } from "./delivery-sync.js";

function snapshot() {
  return {
    contract: "momos.delivery-snapshot.v1",
    version: "12",
    serverTime: "2026-07-19T12:00:00Z",
    summary: { activeOrders: 1, readyWithoutDelivery: 0, historyReturned: 0, historyLimit: 50, subsidy: 0, surplus: 0 },
    orders: [{ id: "P-1", fecha: "2026-07-19", hora: "07:30", canal: "WhatsApp", customerId: "C-1", barrio: "Caney", direccion: "Calle 1", zona: "Zona 1", domCobrado: 5000, domCosto: 5000, descuento: 0, pago: "Nequi", estado: "Listo para despacho", obs: "Apto 2" }],
    orderItems: [{ id: "OI-1", orderId: "P-1", nombre: "Momo", cant: 1, precio: 18000, sabor: "Oreo", salsa: "", relleno: "", figura: "Max" }],
    customers: [{ id: "C-1", nombre: "Cliente", telefono: "3000000000", barrio: "Caney", direccion: "Calle 1" }],
    deliveries: [{ id: "D-1", orderId: "P-1", proveedor: "Pibox", costoReal: 5000, cobrado: 5000, zona: "Zona 1", hSolicitud: "07:40", hSalida: "", hEntrega: "", codigo: "", estado: "Solicitado", obs: "" }],
    orderVersions: [{ orderId: "P-1", version: "9" }],
    privacy: { bounded: true, containsCustomerPii: true, containsFreeText: true, containsSecrets: false, containsStaffPii: false, containsStorageReferences: false, destinationPiiRequired: true, externalExecution: false },
  };
}

test("H81 acepta el contrato compacto, acotado y con PII de destino declarada", () => {
  const normalized = normalizeDeliverySnapshot(snapshot());
  assert.equal(normalized.version, "12");
  assert.deepEqual(normalized.orderVersions, { "P-1": "9" });
  assert.equal(normalized.orders.length, 1);
});

test("H81 falla cerrado ante campos extra, secretos o historial sin límite", () => {
  const extra = snapshot();
  extra.internalNotes = "no";
  assert.throws(() => normalizeDeliverySnapshot(extra), /fuera/);
  const secret = snapshot();
  secret.privacy.containsSecrets = true;
  assert.throws(() => normalizeDeliverySnapshot(secret), /privacidad/);
  const unbounded = snapshot();
  unbounded.summary.historyLimit = 51;
  assert.throws(() => normalizeDeliverySnapshot(unbounded), /acotado/);
  const extraRow = snapshot();
  extraRow.orders[0].staffEmail = "no-debe-salir@momos.local";
  assert.throws(() => normalizeDeliverySnapshot(extraRow), /orders\[\]/);
});

test("H81 rechaza filas cruzadas entre pedidos", () => {
  const crossed = snapshot();
  crossed.deliveries[0].orderId = "P-OTRO";
  assert.throws(() => normalizeDeliverySnapshot(crossed), /mezcló/);
});

test("H71 actualiza también la proyección de Logística y retira lo que ya no aplica", () => {
  const db = {
    deliverySnapshotReady: true,
    deliveryOrders: [], deliveryOrderItems: [], deliveryCustomers: [], deliveryDeliveries: [],
    orders: [{ id: "P-2", fecha: "2026-07-19", hora: "08:00", canal: "WhatsApp", customerId: "C-2", estado: "Listo para despacho" }],
    order_items: [{ id: "OI-2", orderId: "P-2" }],
    customers: [{ id: "C-2", nombre: "Dos" }],
    deliveries: [],
  };
  syncDeliverySnapshotOrders(db, ["P-2"]);
  assert.deepEqual(db.deliveryOrders.map((row) => row.id), ["P-2"]);
  db.orders[0].estado = "Cancelado";
  syncDeliverySnapshotOrders(db, ["P-2"]);
  assert.equal(db.deliveryOrders.length, 0);
});
