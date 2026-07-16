import test from "node:test";
import assert from "node:assert/strict";
import { buildPackingQueue } from "./packing-queue.js";

const order = (id, estado, hora) => ({ id, estado, fecha: "2026-07-15", hora });

test("Empaque ve lo que viene de Cocina sin volverlo trabajo accionable", () => {
  const queue = buildPackingQueue([
    order("P-3", "En producción", "10:03"),
    order("P-2", "Listo para empaque", "10:02"),
    order("P-1", "Listo para empaque", "10:01"),
  ]);
  assert.deepEqual(queue.incoming.map((row) => row.id), ["P-3"]);
  assert.deepEqual(queue.pending.map((row) => row.id), ["P-1", "P-2"]);
  assert.equal(queue.activeIds.has("P-3"), false);
});

test("mantiene cada pedido en una sola etapa de la cola", () => {
  const queue = buildPackingQueue([
    order("P-1", "En producción", "09:00"),
    order("P-2", "Listo para empaque", "09:01"),
    order("P-3", "Empacado", "09:02"),
    order("P-4", "Listo para despacho", "09:03"),
  ]);
  const all = [...queue.incoming, ...queue.pending, ...queue.packed, ...queue.handoff].map((row) => row.id);
  assert.equal(new Set(all).size, all.length);
  assert.equal(queue.visibleCount, 4);
});

test("sale del relevo activo únicamente cuando Logística lo acepta", () => {
  const orders = [order("P-1", "Listo para despacho", "09:00"), order("P-2", "Listo para despacho", "09:01")];
  const queue = buildPackingQueue(orders, [{ orderId: "P-1", status: "Ofrecido" }, { orderId: "P-2", status: "Aceptado" }]);
  assert.deepEqual(queue.handoff.map((row) => row.id), ["P-1"]);
  assert.equal(queue.activeIds.has("P-2"), false);
});
