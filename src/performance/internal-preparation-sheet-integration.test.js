import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("H87 separa el catálogo y el inventario de la gestión central en Producción", async () => {
  const [inventory, production, products, recipeCenter] = await Promise.all([
    load("../features/inventory/InventoryPanels.jsx"),
    load("../features/production/ProductionPanel.jsx"),
    load("../features/backoffice/BusinessPanels.jsx"),
    load("../features/production/KitchenRecipeCenter.jsx"),
  ]);
  assert.match(inventory, /Gestionar en Producción/);
  assert.doesNotMatch(inventory, /InternalPreparationSheetEditor/);
  assert.match(inventory, /manageKitchenSheet: true/);
  assert.match(inventory, /setDetalleInsumoId\(null\)/);
  assert.match(production, /Recetario de Cocina/);
  assert.match(production, /InternalPreparationSheetEditor/);
  assert.match(production, /se administran aquí, dentro del Recetario de Cocina de Producción/);
  assert.match(products, /Gestionar receta en Producción/);
  assert.match(products, /manageProductRecipe: true/);
  assert.doesNotMatch(products, /<Modal title=\{`Receta · \$\{prodReceta\.nombre\}`\}/);
  assert.match(recipeCenter, /Productos de Cocina y elaboraciones de MOMOS/);
  assert.match(recipeCenter, /Producto real de Cocina/);
  assert.match(recipeCenter, /guardar_receta_producto/);
});

test("H87 usa el manifiesto ya cacheado y no agrega una sonda HTTP", async () => {
  const [readModel, app] = await Promise.all([
    load("../lib/read-model.js"),
    load("../MomosOps.jsx"),
  ]);
  assert.match(readModel, /manifest\?\.capabilities\?\.formulas_elaboraciones_internas_disponibles === true/);
  assert.doesNotMatch(readModel, /supabase\.rpc\("formulas_elaboraciones_internas_disponibles"/);
  assert.match(app, /d\.internalPreparationFormulaReady = Boolean\(cat\.internalPreparationFormulaReady\)/);
  assert.match(app, /d\.kitchen_procedures = cat\.kitchen_procedures \|\| \[\]/);
});

test("H87 mantiene fórmula y procedimiento bajo un único botón de publicación", async () => {
  const editor = await load("../features/inventory/InternalPreparationSheetEditor.jsx");
  assert.match(editor, /Ingredientes y preparación en una sola versión/);
  assert.match(editor, /Guardar para revisión/);
  assert.match(editor, /Publicar para Cocina/);
  assert.match(editor, /activarFichaTecnicaCocina/);
  assert.doesNotMatch(editor, /guardar.*formula.*direct/i);
});
