import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderTraceability, orderCurrentArea, orderNextOperationalAction, traceabilityHealth } from "./order-traceability.js";

const order = { id: "P-1", fecha: "2026-07-14", hora: "10:00", canal: "WhatsApp", estado: "Listo para despacho" };
const db = {
  order_items: [{ id: "I-1", orderId: "P-1", nombre: "Momo Perrito", cant: 1 }],
  evidences: [{ id: "E-1", orderId: "P-1", tipo: "Caja abierta", fecha: "2026-07-14", hora: "10:30", user: "Empaque" }],
  inventory_reservations: [{ id: "R-1", orderId: "P-1", nombre: "Momo Perrito", cantidad: 1, fecha: "2026-07-14 10:10", estado: "Activa", tipo: "producto", batchId: "L-1" }],
  order_incidents: [], order_stage_assignments: [], order_line_progress: [], claims: [], audit_logs: [], deliveries: [],
  packing_verifications: [{ orderId: "P-1", verifiedAt: "2026-07-14 10:35", lineIds: ["I-1"], user: "Ana" }],
  order_dispatch_handoffs: [{ orderId: "P-1", status: "Ofrecido", offeredAt: "2026-07-14 10:40", packingUser: "Ana" }],
};

test("ubica el pedido en el relevo exacto y explica el siguiente paso", () => {
  const trace = buildOrderTraceability(db, order);
  assert.equal(trace.area, "Relevo Empaque → Logística");
  assert.equal(trace.nextAction, "Logística debe aceptar el paquete");
  assert.equal(trace.events[0].title, "Paquete ofrecido a Logística");
});

test("una novedad abierta domina la salud y el siguiente paso", () => {
  const trace = buildOrderTraceability({ ...db, order_incidents: [{ id: "INC-1", orderId: "P-1", status: "Abierto", type: "Faltante", description: "Falta sello", area: "Empaque", createdAt: "2026-07-14 10:45" }] }, order);
  assert.equal(traceabilityHealth(trace), "blocked");
  assert.match(trace.nextAction, /Resolver 1 novedad/);
});

test("no mezcla eventos, evidencias ni reservas de otro pedido", () => {
  const trace = buildOrderTraceability({ ...db, evidences: [...db.evidences, { id: "E-X", orderId: "P-X", tipo: "Entrega" }], inventory_reservations: [...db.inventory_reservations, { id: "R-X", orderId: "P-X" }] }, order);
  assert.equal(trace.evidences.length, 1);
  assert.equal(trace.reservations.length, 1);
});

test("mapea todas las áreas críticas sin ambigüedad", () => {
  assert.equal(orderCurrentArea({ estado: "Pendiente de pago" }), "Recepción / Caja");
  assert.equal(orderCurrentArea({ estado: "En producción" }), "Cocina");
  assert.equal(orderCurrentArea({ estado: "Listo para empaque" }), "Empaque");
  assert.equal(orderCurrentArea({ estado: "En ruta" }), "Logística");
  assert.equal(orderNextOperationalAction({ estado: "Entregado" }), "Pedido finalizado");
});
