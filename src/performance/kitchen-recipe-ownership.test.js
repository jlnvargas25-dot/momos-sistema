import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const production = readFileSync(new URL("../features/production/ProductionPanel.jsx", import.meta.url), "utf8");
const recipeCenter = readFileSync(new URL("../features/production/KitchenRecipeCenter.jsx", import.meta.url), "utf8");
const inventory = readFileSync(new URL("../features/inventory/InventoryPanels.jsx", import.meta.url), "utf8");
const products = readFileSync(new URL("../features/backoffice/BusinessPanels.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");

test("Producción es el único punto de gestión de recetas y fichas de Cocina", () => {
  assert.match(production, /KitchenRecipeCenter/);
  assert.match(production, /InternalPreparationSheetEditor/);
  assert.match(production, /Recetario de Cocina/);
  assert.match(recipeCenter, /Un solo lugar de trabajo/);
  assert.match(recipeCenter, /Figuras, productos al momento y elaboraciones/);
  assert.match(recipeCenter, /Cocina trabaja con Lizi, Momo, Rocco, Teo, Toby, Danna y Max/);
  assert.match(recipeCenter, /Momo Gatito.*Momo Perrito.*familias comerciales/);
  assert.match(recipeCenter, /buildKitchenFigureSheet/);
  assert.match(recipeCenter, /guardar_receta_producto/);
  assert.match(recipeCenter, /Gestionar fórmula y pasos/);
});

test("Inventario consulta y dirige la elaboración a Producción", () => {
  assert.doesNotMatch(inventory, /import InternalPreparationSheetEditor/);
  assert.doesNotMatch(inventory, /<InternalPreparationSheetEditor/);
  assert.match(inventory, /go\?\.\("Producción", \{ subrecipeId, manageKitchenSheet: true, source: "Inventario" \}\)/);
  assert.match(inventory, /Gestionar en Producción/);
});

test("Productos conserva el catálogo pero dirige la receta a Producción", () => {
  assert.doesNotMatch(products, /<Modal title=\{`Receta · \$\{prodReceta\.nombre\}`\}/);
  assert.doesNotMatch(products, /function abrirRecetaProducto/);
  assert.match(products, /go\?\.\("Producción", \{ productId, figure, manageProductRecipe: true, source: "Productos" \}\)/);
  assert.match(products, /FIGURAS DE ESTA FAMILIA COMERCIAL/);
  assert.match(products, /Abrir \$\{selectedFigure\?\.nombre \|\| "la familia"\} en Producción/);
  assert.match(app, /panel="Productos" \{\.\.\.p\} go=\{go\}/);
});

test("los accesos dirigidos abren el editor correcto dentro de Producción", () => {
  assert.match(production, /focus\?\.manageKitchenSheet/);
  assert.match(production, /focus\?\.manageProductRecipe/);
  assert.match(production, /initialProductId=\{recetarioProductId\}/);
});
