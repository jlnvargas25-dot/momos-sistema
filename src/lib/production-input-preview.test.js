import test from "node:test";
import assert from "node:assert/strict";
import { calculateProductionInputPreview } from "./production-input-preview.js";

const figures = [
  { nombre: "Lizi", gramajeG: 150, activo: true },
  { nombre: "Momo", gramajeG: 180, activo: true },
  { nombre: "Toby", gramajeG: 280, activo: true },
  { nombre: "Max", gramajeG: 180, activo: true },
  { nombre: "Teo", gramajeG: 250, activo: true },
];
const subrecipes = [
  { id: "MANGO", nombre: "Mousse mango biche", tipo: "mousse_frutal", sabor: "Mango biche", mermaPct: 8, itemId: "BASE-MANGO", activo: true },
  { id: "CHEESE", nombre: "Relleno cheesecake", tipo: "cheesecake", mermaPct: 5, itemId: "BASE-CHEESE", activo: true },
  { id: "GANACHE", nombre: "Ganache", tipo: "ganache", mermaPct: 4, itemId: "BASE-GANACHE", activo: true },
];
const fillingRules = [
  { id: "F1", subrecetaId: "CHEESE", gramosPorUnidad: 20, activo: true },
  { id: "F2", subrecetaId: "GANACHE", gramosPorUnidad: 15, activo: true },
];
const subrecipeIngredients = [
  { subrecetaId: "MANGO", itemId: "PULPA", cantidad: 0.4803 },
  { subrecetaId: "MANGO", itemId: "CREMA", cantidad: 0.3095 },
  { subrecetaId: "CHEESE", itemId: "QUESO", cantidad: 0.4065 },
  { subrecetaId: "CHEESE", itemId: "CREMA", cantidad: 0.2927 },
  { subrecetaId: "GANACHE", itemId: "CHOCOLATE", cantidad: 0.55 },
  { subrecetaId: "GANACHE", itemId: "CREMA", cantidad: 0.43 },
];
const inventory = [
  { id: "BASE-MANGO", nombre: "Base Mango", unidad: "kg", stock: 10, costo: 10000 },
  { id: "BASE-CHEESE", nombre: "Base Cheesecake", unidad: "kg", stock: 10, costo: 12000 },
  { id: "BASE-GANACHE", nombre: "Base Ganache", unidad: "kg", stock: 10, costo: 14000 },
  { id: "PULPA", nombre: "Pulpa", unidad: "kg", stock: 10, costo: 8000 },
  { id: "CREMA", nombre: "Crema", unidad: "L", stock: 10, costo: 12000 },
  { id: "QUESO", nombre: "Queso", unidad: "kg", stock: 10, costo: 20000 },
  { id: "CHOCOLATE", nombre: "Chocolate", unidad: "kg", stock: 10, costo: 24000 },
];

test("calcula la composición exacta de un lote mixto por figura", () => {
  const preview = calculateProductionInputPreview({
    flavor: "Mango biche",
    quantities: { Momo: 10, Max: 10, Toby: 10 },
    figures,
    subrecipes,
    subrecipeIngredients,
    fillingRules,
    inventory,
  });

  assert.equal(preview.totalUnits, 30);
  assert.equal(preview.totalProductGrams, 6400);
  assert.equal(preview.mousseOutputGrams, 5350);
  assert.equal(preview.totalFillingGrams, 1050);
  assert.deepEqual(preview.preparations.map((row) => [row.subrecipeId, row.outputGrams]), [
    ["MANGO", 5350], ["CHEESE", 600], ["GANACHE", 450],
  ]);
  assert.equal(preview.preparations[0].nominalInputGrams, 5815.2);
  assert.equal(preview.canCalculate, true);
});

test("agrega un mismo insumo atómico usado por varias preparaciones", () => {
  const preview = calculateProductionInputPreview({
    flavor: "Mango biche",
    quantities: { Lizi: 2, Teo: 1 },
    figures,
    subrecipes,
    subrecipeIngredients,
    fillingRules,
    inventory,
  });
  const cream = preview.ingredients.find((ingredient) => ingredient.itemId === "CREMA");
  const expected = (0.3095 * (445 / 0.92) / 1000)
    + (0.2927 * (60 / 0.95) / 1000)
    + (0.43 * (45 / 0.96) / 1000);
  assert.ok(Math.abs(cream.requiredQuantity - expected) < 0.0002);
});

test("señala catálogo incompleto sin inventar gramajes ni fórmulas", () => {
  const preview = calculateProductionInputPreview({
    flavor: "Sabor inexistente",
    quantities: { Fantasma: 1 },
    figures,
    subrecipes,
    subrecipeIngredients,
    fillingRules,
    inventory,
  });
  assert.equal(preview.canCalculate, false);
  assert.deepEqual(preview.errors.map((error) => error.code), ["MISSING_FIGURE", "MISSING_MOUSSE"]);
});

test("rechaza una silueta legacy aunque todavía exista en una caché de figuras", () => {
  const preview = calculateProductionInputPreview({
    flavor: "Mango biche",
    quantities: { Horizontal: 1 },
    figures: [...figures, { nombre: "Horizontal", gramajeG: 150, activo: true }],
    subrecipes,
    subrecipeIngredients,
    fillingRules,
    inventory,
  });

  assert.equal(preview.canCalculate, false);
  assert.equal(preview.errors.some((error) => error.code === "MISSING_FIGURE" && error.figure === "Horizontal"), true);
});

test("compara tanto las bases preparadas como los ingredientes crudos contra stock", () => {
  const lowInventory = inventory.map((item) => ({ ...item, stock: item.id.startsWith("BASE-") ? 0 : 0.001 }));
  const preview = calculateProductionInputPreview({
    flavor: "Mango biche",
    quantities: { Momo: 10 },
    figures,
    subrecipes,
    subrecipeIngredients,
    fillingRules,
    inventory: lowInventory,
  });
  assert.equal(preview.preparedStockEnough, false);
  assert.equal(preview.rawStockEnough, false);
  assert.ok(preview.preparations.every((row) => row.shortage > 0));
  assert.ok(preview.ingredients.some((row) => row.shortage > 0));
});
