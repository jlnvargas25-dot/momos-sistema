import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const orders = readFileSync(new URL("../features/orders/OrdersPanel.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const domain = readFileSync(new URL("../lib/momos-domain-language.js", import.meta.url), "utf8");
const compatibility = readFileSync(new URL("../features/orders/order-figure-compatibility.js", import.meta.url), "utf8");

test("Pedidos construye el catalogo desde figuras canonicas con productId exacto", () => {
  assert.match(orders, /export function buildOrderCatalogChoices/);
  assert.match(orders, /const activeProducts = \(db\.products \|\| \[\]\)\.filter\(\(product\) => product\?\.activo === true\)/);
  assert.match(orders, /activeFigureCatalog\(db\)/);
  assert.match(orders, /const link = validateOrderFigureCatalogLink\(figure\)/);
  assert.match(orders, /const productId = link\.expectedProductId/);
  assert.match(orders, /!product \|\| !isCommercialFamilyProduct\(product\)/);
  assert.match(orders, /productId,\s*figure: String\(figure\.nombre\)\.trim\(\)/);
  assert.match(orders, /invalidFigureLinks\.push\(link\)/);
  assert.match(compatibility, /declaredProductId !== expectedProductId/);
});

test("el selector de Pedidos agrupa por las mismas categorías de Productos", () => {
  assert.match(orders, /Postre, caja o elaboración del pedido/);
  assert.match(orders, /const orderCatalogGroups = useMemo/);
  assert.match(orders, /groupOrderCatalogChoices\(orderCatalog\.all\)/);
  assert.match(orders, /PRODUCT_CATEGORY_EMOJI/);
  assert.match(orders, /<optgroup key=\{group\.category\}/);
  assert.match(orders, /label=\{`\$\{PRODUCT_CATEGORY_EMOJI\[group\.category\]/);
  assert.doesNotMatch(app, /function getOrdersPanelShared\(\)[\s\S]*SegmentedTabs[\s\S]*?\n\}/);
  assert.match(orders, /Familia comercial:/);
  assert.doesNotMatch(orders, /OrderCatalogPicker/);
  assert.doesNotMatch(orders, />Presentación comercial o producto del menú</);
  assert.doesNotMatch(orders, /Elegir presentación o producto/);
  assert.doesNotMatch(orders, /Producto: todos/);
});

test("seleccionar una figura asigna atomica y exactamente figura y productId", () => {
  assert.match(orders, /export function applyOrderCatalogChoice/);
  assert.match(orders, /productId: choice\.productId/);
  assert.match(orders, /figura: choice\.kind === "figure" \? choice\.figure : ""/);
  assert.match(orders, /idx === i \? applyOrderCatalogChoice\(x, choice\) : x/);
  assert.match(orders, /!selectedExactFigure && <Select placeholder="Postre \/ figura"/);
});

test("familias incompletas y combos no pasan silenciosamente", () => {
  assert.match(orders, /orderLineFigureCompatibilityErrors\(line, productOf\(db, line\.productId\)\)/);
  assert.match(orders, /No se puede guardar: \$\{incompatibilidad\.message\}/);
  assert.match(orders, /isCommercialFamilyProduct\(product\).*\(!isKitchenFigureName\(line\.figura\) \|\| !line\.sabor\)/s);
  assert.match(orders, /Elegí el postre exacto y su sabor\. La familia comercial se asigna automáticamente/);
  assert.match(orders, /Completá postre, sabor y salsa en cada espacio de la caja/);
  assert.match(orders, /<Select placeholder="Postre" options=\{figOpts\}/);
  assert.match(orders, /setSlotFigure\(i, b, si, pSel, e\.target\.value\)/);
});

test("las familias comerciales no reaparecen como opciones principales", () => {
  assert.match(orders, /\.filter\(\(product\) => !isCommercialFamilyProduct\(product\)\)/);
  assert.match(orders, /all: \[\.\.\.figureChoices, \.\.\.otherChoices\]/);
  assert.match(orders, /groupOrderCatalogChoices\(orderCatalog\.all\)/);
});

test("el cuchareable se configura por sabor y salsa, nunca como figura", () => {
  assert.match(orders, /export function orderProductAttributes/);
  assert.match(orders, /orderAttributesForProduct\(product\)/);
  assert.match(domain, /category === "momos cuchara"/);
  assert.match(domain, /return \["sabor", "salsa"\]/);
  assert.match(orders, /const attrs = orderProductAttributes\(pSel\)/);
  assert.match(orders, /attrs\.includes\("figura"\)/);
  assert.match(orders, /sanitizeOrderLineFigureFields\(l, p\)/);
  assert.match(compatibility, /figura: commercialFamily \? text\(line\?\.figura/);
});

test("Pedidos muestra incompatibilidades históricas en todos sus resúmenes", () => {
  assert.match(orders, /export function orderLinePresentationForOrders/);
  assert.match(orders, /decorateOrderLineCompatibility\(orderLinePresentation\(item, product\), item, product\)/);
  assert.equal((orders.match(/orderLinePresentation\(/g) || []).length, 1,
    "OrdersPanel no debe saltarse el decorador canónico en vistas históricas");
  assert.match(orders, /childPresentation\.figureCompatibilityError/);
  assert.match(orders, /validateOrderComboSlotFigure\(p, h\.figura\)/);
  assert.match(orders, /childCompatibilityError/);
});
