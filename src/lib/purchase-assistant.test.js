import test from "node:test";
import assert from "node:assert/strict";
import { buildPurchaseAssistant } from "./purchase-assistant.js";

const external = { id: "I-1", nombre: "Crema", cat: "Ingredientes", unidad: "L", stock: 2, min: 6, costo: 10000, proveedor: "Proveedor A" };

test("sugiere reponer un insumo externo bajo sin comprar una elaboración interna", () => {
  const result = buildPurchaseAssistant({
    inventoryItems: [external, { id: "I-2", nombre: "Ganache", unidad: "kg", stock: 0, min: 1 }],
    subrecipes: [{ id: "SR-1", itemId: "I-2", nombre: "Ganache" }],
    today: "2026-07-15",
  });
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].name, "Crema");
  assert.equal(result.recommendations[0].quantity, 5.5);
});

test("una elaboración marcada como producción propia nunca se convierte en compra por faltar su fórmula", () => {
  const result = buildPurchaseAssistant({
    inventoryItems: [{ id: "I-9", nombre: "Mezcla de crepa", unidad: "L", stock: 0, min: 2, proveedor: "Producción propia" }],
    today: "2026-07-15",
  });
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.summary.internalNeedsSetup, 1);
  assert.equal(result.internalNeedsSetup[0].name, "Mezcla de crepa");
});

test("suma el faltante explícito de pedidos al colchón mínimo", () => {
  const result = buildPurchaseAssistant({
    inventoryItems: [{ ...external, stock: 0 }],
    suggestions: [{ id: "S-1", itemId: "I-1", area: "Inventario", estado: "Pendiente", cantidad: 2, orderId: "P-1" }],
    today: "2026-07-15",
  });
  const row = result.recommendations[0];
  assert.equal(row.quantity, 9.5);
  assert.equal(row.priority, "Urgente");
  assert.deepEqual(row.suggestionIds, ["S-1"]);
  assert.match(row.reasons.join(" "), /P-1/);
});

test("el stock vencido no cubre la compra sugerida", () => {
  const result = buildPurchaseAssistant({
    inventoryItems: [{ ...external, stock: 8 }],
    inventoryLotsReady: true,
    inventoryLots: [
      { id: "IL-1", itemId: "I-1", available: 8, expiresAt: "2026-07-14" },
      { id: "IL-2", itemId: "I-1", available: 1, expiresAt: "2026-07-20" },
    ],
    today: "2026-07-15",
  });
  assert.equal(result.recommendations[0].current, 1);
  assert.equal(result.recommendations[0].expiredStock, 8);
  assert.match(result.recommendations[0].reasons.join(" "), /vencidos no cuentan/);
});

test("no recomienda comprar cuando el stock utilizable supera el mínimo y no hay faltantes", () => {
  const result = buildPurchaseAssistant({ inventoryItems: [{ ...external, stock: 10 }], today: "2026-07-15" });
  assert.equal(result.summary.items, 0);
});

test("agrupa la lista por proveedor y estima el presupuesto", () => {
  const result = buildPurchaseAssistant({
    inventoryItems: [external, { ...external, id: "I-3", nombre: "Cajas", unidad: "und", stock: 0, min: 4, costo: 2000 }],
    today: "2026-07-15",
  });
  assert.equal(result.suppliers.length, 1);
  assert.equal(result.suppliers[0].items.length, 2);
  assert.equal(result.summary.estimatedCost, result.recommendations.reduce((sum, row) => sum + row.estimatedCost, 0));
});
