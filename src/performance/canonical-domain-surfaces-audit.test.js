import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../MomosOps.jsx");
const production = read("../features/production/ProductionPanel.jsx");
const recipeCenter = read("../features/production/KitchenRecipeCenter.jsx");
const inventory = read("../features/inventory/InventoryPanels.jsx");
const orders = read("../features/orders/OrdersPanel.jsx");
const business = read("../features/backoffice/BusinessPanels.jsx");
const finance = read("../features/finance/FinancePanel.jsx");
const domain = read("../lib/momos-domain-language.js");
const packing = read("../lib/packing-workflow.js");
const sales = read("../lib/sales-reception-assistant.js");
const crm = read("../lib/customer-crm.js");
const planner = read("../lib/production-planner.js");
const finished = read("../lib/finished-inventory.js");
const finishedFigureSummary = read("../features/inventory/FinishedFigureSummary.jsx");
const finishedSummary = read("../lib/production-stock-summary.js");
const integrity = read("../lib/supply-chain-integrity.js");
const configuration = read("../lib/configuration-sync.js");
const expiry = read("../lib/production-expiry-control.js");
const history = read("../lib/operational-history.js");
const traceability = read("../lib/order-traceability.js");
const brandStudio = read("../features/agency/AgencyBrandStudio.jsx");
const creativePackage = read("../lib/creative-package.js");

test("la auditoría transversal conserva un único catálogo de siete figuras físicas", () => {
  assert.match(domain, /\["Lizi", "Momo", "Rocco", "Teo", "Toby", "Danna", "Max"\]/);
  for (const source of [production, recipeCenter, sales, planner, finished, finishedSummary, integrity, configuration, expiry]) {
    assert.match(source, /isKitchenFigureName/);
  }
  assert.doesNotMatch(app, /\/perr\/i\.test\(f\)/);
});

test("Pedidos, Empaque, Inventario e Historial muestran figura primero y familia como presentación", () => {
  assert.match(packing, /orderLinePresentation/);
  assert.match(inventory, /inventoryReservationPresentation/);
  assert.match(history, /inventoryReservationPresentation/);
  assert.match(traceability, /inventoryReservationPresentation/);
  assert.match(domain, /Producto terminado sin figura verificable/);
});

test("Producción y stock no convierten nombres legacy en figuras", () => {
  assert.match(planner, /NON_CANONICAL_FIGURE/);
  assert.match(integrity, /BATCH_FIGURE_INVALID/);
  assert.match(configuration, /figura física no canónica/);
  assert.match(expiry, /filter\(\(\{ result \}\) => isKitchenFigureName\(result\?\.figura\)\)/);
  assert.match(recipeCenter, /!isCommercialFamilyProduct\((?:row|product)\)/);
});

test("Producción e Inventario terminado comparan las mismas siete figuras, incluso en cero", () => {
  assert.match(finished, /KITCHEN_FIGURE_NAMES\.forEach/);
  assert.match(finished, /available: 0/);
  assert.match(production, /buildFinishedInventory/);
  assert.match(production, /buildFinishedInventory\(db, \{ today: hoyISO\(\) \}\)/);
  assert.match(inventory, /buildFinishedInventory\(db, \{ today: hoyISO\(\) \}\)/);
  assert.match(production, /inventarioTerminado\.figureSummaries/);
  assert.match(production, /<FinishedFigureCards/);
  assert.match(inventory, /<FinishedFigureCards/);
  assert.match(production, /<FinishedFigureDetailContent/);
  assert.match(inventory, /<FinishedFigureDetailContent/);
  assert.match(finishedFigureSummary, /Sin stock vendible exacto/);
  assert.doesNotMatch(production, /buildFinishedStockSummary/);
});

test("las familias comerciales no se detectan solo por tipo o especie", () => {
  for (const source of [planner, finished, finishedSummary]) {
    assert.match(source, /isCommercialFamilyProduct/);
    assert.doesNotMatch(source, /\.tipo\s*===\s*["']momo["']/);
  }
  assert.match(domain, /COMMERCIAL_FAMILY_PATTERN/);
});

test("Agencia y Biblioteca no convierten preparaciones al momento en figuras", () => {
  assert.match(brandStudio, /se prepara al momento y no admite una figura física/);
  assert.match(brandStudio, /validateProductFigure\(packForm\.productId, packForm\.figure\.trim\(\)\)/);
  assert.match(creativePackage, /const figure = family \? clean\(subject\.figure \|\| subject\.figura\) : ""/);
});

test("Pedidos, Productos, CRM, Domicilios, Reportes y Finanzas hablan el mismo idioma", () => {
  assert.match(orders, /groupOrderCatalogChoices\(orderCatalog\.all\)/);
  assert.match(orders, /<optgroup key=\{group\.category\}/);
  assert.match(orders, /Familia comercial:/);
  assert.match(business, /canonicalFigureRows/);
  assert.match(business, /Cada tarjeta es una figura física/);
  assert.match(business, /orderLinePresentation/);
  assert.match(crm, /orderLinePresentation/);
  assert.match(business, /PRESENTACIONES COMERCIALES MÁS VENDIDAS/);
  assert.match(business, /FIGURAS MÁS VENDIDAS/);
  assert.match(finance, /Ventas cobradas de postres y productos/);
  assert.doesNotMatch(finance, /label="Ventas de producto"/);
});
