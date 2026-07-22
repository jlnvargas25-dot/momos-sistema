import test from "node:test";
import assert from "node:assert/strict";
import { calculateSubrecipeBatch } from "./subrecipe-scaling.js";

const cheesecake = { id: "SR12", nombre: "Relleno cheesecake", mermaPct: 5 };
const ingredients = [
  { subrecetaId: "SR12", itemId: "QUESO", cantidad: 0.4065 },
  { subrecetaId: "SR12", itemId: "CREMA", cantidad: 0.2927 },
];
const inventory = [
  { id: "QUESO", nombre: "Queso crema", unidad: "kg", stock: 1, costo: 20000 },
  { id: "CREMA", nombre: "Crema de leche", unidad: "L", stock: 1, costo: 12000 },
];

test("escala la fórmula para lograr una cantidad final después de la merma", () => {
  const result = calculateSubrecipeBatch({ subrecipe: cheesecake, ingredients, inventory, desiredOutputGrams: 300 });
  assert.equal(result.nominalInputGrams, 315.8);
  assert.equal(result.expectedOutputGrams, 300);
  assert.equal(result.components[0].requiredQuantity, 0.1284);
  assert.equal(result.components[1].requiredQuantity, 0.0924);
  assert.equal(result.canPrepare, true);
});

test("falla cerrado si falta un insumo de la fórmula o no alcanza el stock", () => {
  const missing = calculateSubrecipeBatch({ subrecipe: cheesecake, ingredients, inventory: inventory.slice(0, 1), desiredOutputGrams: 300 });
  assert.equal(missing.completeFormula, false);
  assert.equal(missing.canPrepare, false);

  const low = calculateSubrecipeBatch({ subrecipe: cheesecake, ingredients, inventory: inventory.map((item) => ({ ...item, stock: 0.01 })), desiredOutputGrams: 300 });
  assert.equal(low.completeFormula, true);
  assert.equal(low.canPrepare, false);
});

test("no acepta cantidades negativas ni porcentajes de merma imposibles", () => {
  const result = calculateSubrecipeBatch({ subrecipe: { ...cheesecake, mermaPct: 200 }, ingredients, inventory, desiredOutputGrams: -10 });
  assert.equal(result.desiredOutputGrams, 0);
  assert.equal(result.nominalInputGrams, 0);
  assert.equal(result.canPrepare, false);
});
