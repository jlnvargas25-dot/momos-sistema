import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../MomosOps.jsx");
const orders = read("../features/orders/OrdersPanel.jsx");
const production = read("../features/production/ProductionPanel.jsx");
const inventory = read("../features/inventory/InventoryPanels.jsx");
const business = read("../features/backoffice/BusinessPanels.jsx");
const agency = read("../features/agency/AgencyPanel.jsx");
const brand = read("../features/agency/AgencyBrandStudio.jsx");
const variants = read("../lib/variant-availability.js");
const readModel = read("../lib/read-model.js");
const seed = read("../../supabase/seed-catalogos.sql");
const creativePackage = read("../lib/creative-package.js");

test("las superficies operativas comparten el vocabulario canónico", () => {
  for (const source of [app, orders, production, inventory, business, agency, brand]) {
    assert.match(source, /momos-domain-language/);
  }
});

test("la selección exacta nunca vuelve a inferir familias por especie", () => {
  assert.doesNotMatch(variants, /productSpecies|figureSpecies|components\[0\]/);
  assert.doesNotMatch(app, /function momoEspecie|function figuraEspecie/);
  assert.match(variants, /figureProductId\(mappedFigure\)/);
  assert.match(app, /figureProductId\(figure\)/);
});

test("la normalización conserva el vínculo figura a familia comercial", () => {
  assert.match(app, /productId:\s*String\(f\?\.productId \|\| f\?\.product_id \|\| expectedFigureProductId\(nombre\)\)\.trim\(\)/);
  assert.match(app, /\{ nombre: "Lizi",[\s\S]{0,100}productId: "PR01" \}/);
  assert.match(app, /\{ nombre: "Teo",[\s\S]{0,100}productId: "PR04" \}/);
});

test("los datos operativos de respaldo no usan familias o personajes retirados como figura", () => {
  assert.doesNotMatch(app, /figura(?:Foco)?:\s*["'](?:Gatito|Perrito|Osito|Corazón)["']/);
  assert.doesNotMatch(app, /figura:\s*["']Horizontal["']/);
  assert.match(app, /figura: "Lizi"/);
  assert.match(app, /figura: "Max"/);
  assert.match(app, /figura: "Teo"/);
  assert.doesNotMatch(app, /Momo (?:Gatito|Perrito|grande|premium) \d+ g/);
  assert.doesNotMatch(app, /Nueva figura: osito/);
});

test("Pedidos no duplica la caja padre al resumir sus figuras hijas", () => {
  assert.match(orders, /filter\(\(item\) => !item\.esCaja\)/);
  assert.match(orders, /comboFaltantesFamilia/);
  assert.doesNotMatch(orders, /comboFaltantesEspecie/);
});

test("Productos y Agencia explican la diferencia antes de permitir una acción", () => {
  assert.match(business, /Las familias comerciales definen precio, disponibilidad y venta/);
  assert.match(business, /Cada tarjeta es una figura física/);
  assert.match(business, /canonicalFigureRows/);
  assert.match(business, /Figura física/);
  assert.match(business, /FIGURAS DE ESTA FAMILIA COMERCIAL/);
  assert.match(agency, /Postre \/ figura protagonista/);
  assert.match(brand, /Postre \/ figura protagonista/);
});

test("Configuración restaura la familia exacta de cada figura y nunca la deduce por especie", () => {
  assert.match(business, /expectedFigureProductId\(nombre\)/);
  assert.match(business, /Familia canónica:/);
  assert.doesNotMatch(business, /product\.especie === selectedDefaults\.species/);
  assert.match(readModel, /activeConfigurationFigureCatalog\(\{[\s\S]{0,320}productId:\s*nz\(f\.product_id\)/);
  assert.match(business, /Horizontal es una figura auxiliar de decoración/);
  assert.match(business, /VISIBLE POR PRODUCTO ACTIVO/);
});

test("el catálogo de respaldo no vuelve a vender preparaciones al momento como figuras", () => {
  assert.match(app, /id: "PR08"[\s\S]{0,180}tipo: "pedido"/);
  assert.match(seed, /'PR08',[\s\S]{0,180}'Momos Cuchara',[\s\S]{0,40}'pedido',[\s\S]{0,20}null/);
  assert.match(seed, /'PR03',[\s\S]{0,180}'Momos Signature',[\s\S]{0,100}false/);
  assert.doesNotMatch(seed, /Momo premium 280 g/);
});

test("Agencia genera sobre figura y sabor exactos, no sobre la familia comercial", () => {
  assert.match(creativePackage, /Sujeto exacto:/);
  assert.match(creativePackage, /exactSubjectReady/);
  assert.match(agency, /buildCreativePackage\(creativePackageBrief, db, creativePackageVariant, creativePackageSubject\)/);
  assert.match(agency, /Postre protagonista/);
});
