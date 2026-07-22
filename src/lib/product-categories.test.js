import test from "node:test";
import assert from "node:assert/strict";
import {
  groupOrderCatalogChoices, orderedProductCategories, PRODUCT_CATEGORY_EMOJI,
} from "./product-categories.js";

test("las categorías comerciales mantienen el mismo orden en Productos y Pedidos", () => {
  assert.deepEqual(orderedProductCategories([
    "Momos Bebidas", "Momos Signature", "Temporada", "Cajas y Combos",
  ]), ["Momos Signature", "Cajas y Combos", "Momos Bebidas", "Temporada"]);
});

test("el catálogo de Pedidos agrupa figuras y productos sin mezclar categorías", () => {
  const groups = groupOrderCatalogChoices([
    { key: "lizi", category: "Momos Signature" },
    { key: "caja", product: { cat: "Cajas y Combos" } },
    { key: "milo", product: { cat: "Momos Bebidas" } },
    { key: "max", category: "Momos Signature" },
  ]);
  assert.deepEqual(groups.map((group) => [group.category, group.choices.map((choice) => choice.key)]), [
    ["Momos Signature", ["lizi", "max"]],
    ["Cajas y Combos", ["caja"]],
    ["Momos Bebidas", ["milo"]],
  ]);
  assert.equal(groups[0].emoji, PRODUCT_CATEGORY_EMOJI["Momos Signature"]);
});
