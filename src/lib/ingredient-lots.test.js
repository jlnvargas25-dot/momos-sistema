import test from "node:test";
import assert from "node:assert/strict";
import { buildIngredientLotSummary, planIngredientLotFifo } from "./ingredient-lots.js";

const lots = [
  { id: "IL-2", itemId: "I01", available: 4, expiresAt: "2026-07-20", receivedAt: "2026-07-12" },
  { id: "IL-1", itemId: "I01", available: 2, expiresAt: "2026-07-15", receivedAt: "2026-07-10" },
  { id: "IL-X", itemId: "I01", available: 3, expiresAt: "2026-07-13", receivedAt: "2026-07-09" },
];

test("separa el lote vencido sin bloquear el stock vigente del mismo insumo", () => {
  const summary = buildIngredientLotSummary("I01", lots, "2026-07-14");
  assert.equal(summary.expiredStock, 3);
  assert.equal(summary.usableStock, 6);
  assert.equal(summary.nextExpiry, "2026-07-15");
});

test("FIFO consume primero el lote vigente que vence antes", () => {
  const plan = planIngredientLotFifo("I01", lots, 5, "2026-07-14");
  assert.deepEqual(plan.allocations, [
    { lotId: "IL-1", quantity: 2 },
    { lotId: "IL-2", quantity: 3 },
  ]);
  assert.equal(plan.missing, 0);
});

test("FIFO falla cerrado cuando solo queda material vencido", () => {
  const plan = planIngredientLotFifo("I01", lots, 8, "2026-07-14");
  assert.equal(plan.missing, 2);
  assert.equal(plan.allocations.some((row) => row.lotId === "IL-X"), false);
});
