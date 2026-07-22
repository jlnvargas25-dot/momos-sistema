import test from "node:test";
import assert from "node:assert/strict";
import { inventorySupplyMode, isInternallyPreparedItem, subrecipeForInventoryItem } from "./inventory-supply-mode.js";

const items = {
  cream: { id: "I01", nombre: "Crema de leche", proveedor: "La Vaquita" },
  mousse: { id: "I02", nombre: "Base mousse maracuyá", proveedor: "Producción propia" },
  sauce: { id: "I03", nombre: "Salsa frutos rojos", proveedor: "Producción propia" },
  nutella: { id: "I04", nombre: "Nutella", proveedor: "Makro" },
  ganache: { id: "I05", nombre: "Ganache de chocolate", proveedor: "Producción propia" },
  cheesecake: { id: "I54", nombre: "Relleno cheesecake", proveedor: "Producción propia" },
};
const subrecipes = [
  { id: "SR03", nombre: "Mousse maracuyá", itemId: "I02", activo: true },
  { id: "SR12", nombre: "Relleno cheesecake", itemId: "I54", activo: true },
  { id: "SR13", nombre: "Ganache de chocolate", itemId: "I05", activo: true },
  { id: "SR16", nombre: "Salsa frutos rojos", itemId: "I03", activo: true },
];

test("mousse, cheesecake, ganache y salsas se abastecen por preparación", () => {
  [items.mousse, items.cheesecake, items.ganache, items.sauce].forEach((item) => {
    const mode = inventorySupplyMode(item, subrecipes);
    assert.equal(mode.kind, "prepared", item.nombre);
    assert.equal(mode.canPrepare, true, item.nombre);
    assert.ok(mode.subrecipe?.id, item.nombre);
  });
});

test("los ingredientes atómicos y productos comprados conservan Registrar compra", () => {
  [items.cream, items.nutella].forEach((item) => {
    assert.equal(isInternallyPreparedItem(item, subrecipes), false, item.nombre);
    assert.equal(inventorySupplyMode(item, subrecipes).kind, "purchase", item.nombre);
  });
});

test("la relación item_id de subreceta es la fuente de verdad, no el texto del proveedor", () => {
  assert.equal(subrecipeForInventoryItem({ id: "X", proveedor: "Producción propia" }, subrecipes), null);
  assert.equal(isInternallyPreparedItem({ id: "X", nombre: "Salsa comprada" }, subrecipes), false);
  assert.equal(subrecipeForInventoryItem(items.ganache, subrecipes)?.id, "SR13");
});

test("una subreceta inactiva sigue sin ser compra, pero no permite preparar", () => {
  const mode = inventorySupplyMode(items.ganache, [{ ...subrecipes[2], activo: false }]);
  assert.equal(mode.kind, "prepared");
  assert.equal(mode.canPrepare, false);
});
