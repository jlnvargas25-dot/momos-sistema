import test from "node:test";
import assert from "node:assert/strict";
import { explainOperationalError, formatOperationalQuantity } from "./operational-errors.js";

const inventory = [
  { id: "I05", nombre: "Ganache de chocolate", unidad: "kg" },
  { id: "I01", nombre: "Crema de leche", unidad: "L" },
];

test("traduce faltantes técnicos de una elaboración interna a lenguaje de cocina", () => {
  const result = explainOperationalError(
    new Error("Stock vigente insuficiente para I05. Solicitado: 0.0300, disponible por lotes: 0."),
    { inventory, subrecipes: [{ id: "SR-1", itemId: "I05", nombre: "Ganache de chocolate", activo: true }] },
  );
  assert.match(result, /Ganache de chocolate/);
  assert.match(result, /30 g/);
  assert.match(result, /Prepará Ganache de chocolate en Cocina/);
  assert.doesNotMatch(result, /I05|0\.0300/);
});

test("diferencia un insumo comprado y muestra mililitros naturales", () => {
  const result = explainOperationalError(
    "Stock vigente insuficiente para I01. Solicitado: 0.25, disponible por lotes: 0.1.",
    { inventory, subrecipes: [] },
  );
  assert.match(result, /Necesitás 250 ml/);
  assert.match(result, /hay 100 ml/);
  assert.match(result, /Registrá una compra o entrada vigente/);
});

test("conserva errores que no corresponden a inventario", () => {
  assert.equal(explainOperationalError(new Error("El lote ya fue desmoldado."), { inventory }), "El lote ya fue desmoldado.");
});

test("formatea cantidades completas sin ceros técnicos", () => {
  assert.equal(formatOperationalQuantity(2, "kg"), "2 kg");
  assert.equal(formatOperationalQuantity(0.03, "kg"), "30 g");
});
