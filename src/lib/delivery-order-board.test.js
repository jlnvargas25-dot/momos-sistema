import test from "node:test";
import assert from "node:assert/strict";
import { buildDeliveryOrderBoard, deliveryNextStep } from "./delivery-order-board.js";

const orders = [
  { id: "P-1", fecha: "2026-07-19", hora: "10:00", canal: "WhatsApp", estado: "Listo para despacho" },
  { id: "P-2", fecha: "2026-07-19", hora: "11:00", canal: "WhatsApp", estado: "Empacado" },
  { id: "P-3", fecha: "2026-07-19", hora: "12:00", canal: "Rappi", estado: "Empacado" },
];

test("la bandeja usa una tarjeta por pedido aunque tenga varios intentos de domicilio", () => {
  const board = buildDeliveryOrderBoard({
    orders,
    deliveries: [
      { id: "D-1", orderId: "P-1", estado: "Cancelado" },
      { id: "D-2", orderId: "P-1", estado: "Solicitado" },
      { id: "D-3", orderId: "P-1", estado: "Asignado" },
    ],
  });

  assert.equal(board.length, 2);
  assert.equal(board.find((card) => card.order.id === "P-1").delivery.id, "D-3");
  assert.equal(board.find((card) => card.order.id === "P-1").attempts.length, 3);
});

test("un pedido listo sin domicilio aparece primero y permite asignarlo", () => {
  const board = buildDeliveryOrderBoard({ orders, deliveries: [] });
  assert.deepEqual(board.map((card) => card.order.id), ["P-1", "P-2"]);
  assert.equal(board[0].needsAssignment, true);
  assert.equal(deliveryNextStep(board[0]), "Asignar proveedor y costo del domicilio");
  assert.ok(!board.some((card) => card.order.id === "P-3"), "Rappi no debe duplicar su domicilio interno");
});

test("el historial conserva una tarjeta por pedido y todos sus intentos", () => {
  const board = buildDeliveryOrderBoard({
    orders,
    scope: "history",
    deliveries: [
      { id: "D-4", orderId: "P-1", estado: "Cancelado" },
      { id: "D-8", orderId: "P-1", estado: "Entregado" },
    ],
  });

  assert.equal(board.length, 1);
  assert.equal(board[0].order.id, "P-1");
  assert.equal(board[0].delivery.id, "D-8");
  assert.equal(board[0].attempts.length, 2);
  assert.equal(deliveryNextStep(board[0]), "Entrega completada");
});
