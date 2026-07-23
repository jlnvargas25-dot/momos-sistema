import test from "node:test";
import assert from "node:assert/strict";
import {
  KITCHEN_FIGURE_DEFAULTS,
  activeAuxiliaryFigureCatalog,
  activeConfigurationFigureCatalog,
  expectedFigureProductId,
  KITCHEN_FIGURE_NAMES,
  activeFigureCatalog,
  batchPresentation,
  canonicalCommercialFamilyId,
  commercialFamilyLabel,
  figuresForCommercialProducts,
  inventoryReservationPresentation,
  isCanonicalFigureRecord,
  isCommercialFamilyProduct,
  isAuxiliaryFigureName,
  hasActiveHorizontalFigureProduct,
  isKitchenFigureName,
  orderAttributesForProduct,
  orderLinePresentation,
  productDomainKind,
  productUsesHorizontalFigure,
  productTypeForCategory,
} from "./momos-domain-language.js";

test("declara únicamente las siete figuras reales de Cocina", () => {
  assert.deepEqual(KITCHEN_FIGURE_NAMES, ["Lizi", "Momo", "Rocco", "Teo", "Toby", "Danna", "Max"]);
  assert.equal(isKitchenFigureName("lizi"), true);
  assert.equal(isKitchenFigureName("Momo Gatito"), false);
  assert.equal(isKitchenFigureName("Horizontal"), false);
  assert.equal(isAuxiliaryFigureName("Horizontal"), true);
  assert.deepEqual(KITCHEN_FIGURE_DEFAULTS.Toby, { species: "gato", grams: 210 });
  assert.equal(expectedFigureProductId("Lizi"), "PR01");
  assert.equal(expectedFigureProductId("Toby"), "PR01");
  assert.equal(expectedFigureProductId("Max"), "PR02");
  assert.equal(expectedFigureProductId("Teo"), "PR04");
  assert.equal(expectedFigureProductId("Momo Gatito"), "");
  assert.equal(canonicalCommercialFamilyId({ id: "P-G", nombre: "Momo Gatito" }), "PR01");
});

test("Horizontal solo aparece como figura auxiliar si un postre compatible está activo", () => {
  const horizontal = { nombre: "Horizontal", productId: "", activo: true };
  const inactive = {
    products: [
      { id: "PR08", nombre: "Cheesecake Momo cuchareable", activo: false },
      { id: "PR20", nombre: "Cake Momo", activo: false },
    ],
    figuras: [horizontal, { nombre: "Lizi", productId: "PR01", activo: true }],
  };
  assert.equal(productUsesHorizontalFigure(inactive.products[0]), true);
  assert.equal(productUsesHorizontalFigure({ nombre: "Postre especial", rutaId: "r-mck-cong" }), true);
  assert.equal(productUsesHorizontalFigure({ nombre: "Cheesecake Momo de temporada" }), true);
  assert.equal(hasActiveHorizontalFigureProduct(inactive.products), false);
  assert.deepEqual(activeAuxiliaryFigureCatalog(inactive), []);
  assert.deepEqual(activeConfigurationFigureCatalog(inactive).map((row) => row.nombre), ["Lizi"]);

  const active = { ...inactive, products: [{ ...inactive.products[0], activo: true }] };
  assert.equal(hasActiveHorizontalFigureProduct(active.products), true);
  assert.deepEqual(activeAuxiliaryFigureCatalog(active).map((row) => row.nombre), ["Horizontal"]);
  assert.deepEqual(activeConfigurationFigureCatalog(active).map((row) => row.nombre), ["Lizi", "Horizontal"]);
});

test("los atributos de venta nunca convierten un cuchareable en figura", () => {
  assert.deepEqual(orderAttributesForProduct({ nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo" }), ["sabor", "salsa", "figura"]);
  assert.deepEqual(orderAttributesForProduct({ nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "momo" }), ["sabor", "salsa"]);
  assert.deepEqual(orderAttributesForProduct({ nombre: "Malteada Oreo", cat: "Momos Bebidas", tipo: "pedido" }), []);
});

test("separa familia comercial, combo y producto preparado al momento", () => {
  const family = { nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo" };
  assert.equal(isCommercialFamilyProduct(family), true);
  assert.equal(productDomainKind(family), "commercial-family");
  assert.equal(productDomainKind({ nombre: "Caja x3", tipo: "combo" }), "combo");
  assert.equal(productDomainKind({ nombre: "Malteada Oreo", tipo: "pedido" }), "made-to-order");
  assert.equal(isCommercialFamilyProduct({ nombre: "Cheesecake Momo cuchareable", tipo: "momo" }), false);
  assert.equal(commercialFamilyLabel("Momo Gatito 150 g"), "Momo Gatito");
  assert.equal(productTypeForCategory("Momos Signature"), "momo");
  assert.equal(productTypeForCategory("Cajas y Combos"), "combo");
  assert.equal(productTypeForCategory("Momos Cuchara"), "pedido");
  assert.equal(productTypeForCategory("Momos Bebidas"), "pedido");
});

test("presenta la figura y el sabor como sujeto operativo, con la familia en segundo nivel", () => {
  const line = orderLinePresentation({
    nombre: "Momo Perrito", figura: "Max", sabor: "Oreo", salsa: "Maracuyá",
    relleno: "Cheesecake con ganache", cant: 2, esSubMomo: true,
  });
  assert.equal(line.primary, "Max de Oreo");
  assert.equal(line.quantityLabel, "2× Max de Oreo");
  assert.match(line.secondary, /Presentación comercial: Momo Perrito/);
  assert.match(line.secondary, /Salsa: Maracuyá/);
  assert.equal(line.exact, true);
});

test("no disfraza una familia sin figura como producto exacto", () => {
  const line = orderLinePresentation({ nombre: "Momo grande", cant: 1 }, { nombre: "Momo grande", cat: "Momos Signature", tipo: "momo" });
  assert.equal(line.primary, "Momo grande");
  assert.equal(line.requiresExactFigure, true);
  assert.match(line.secondary, /Figura exacta pendiente/);
});

test("ignora figuras heredadas en productos preparados al momento", () => {
  const line = orderLinePresentation(
    { nombre: "Cheesecake Momo cuchareable", figura: "Danna", sabor: "Oreo", cant: 1 },
    { id: "PR08", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "pedido" },
  );
  assert.equal(line.primary, "Cheesecake Momo cuchareable");
  assert.equal(line.figure, "");
  assert.equal(line.ignoredLegacyFigure, true);
  assert.doesNotMatch(line.secondary, /figura/i);
  assert.equal(line.exact, false);
});

test("marca una figura ligada a una familia comercial incompatible", () => {
  const line = orderLinePresentation(
    { nombre: "Momo Perrito", productId: "PR02", figura: "Lizi", sabor: "Coco", cant: 1 },
    { id: "PR02", nombre: "Momo Perrito", cat: "Momos Signature", tipo: "momo" },
  );
  assert.equal(line.primary, "Lizi de Coco");
  assert.equal(line.exact, false);
  assert.equal(line.integrityIssue, "FAMILY_FIGURE_MISMATCH");
  assert.equal(line.expectedFamilyName, "Momo Gatito");
  assert.match(line.secondary, /Dato por corregir: Lizi requiere Momo Gatito; registro actual Momo Perrito/);
  assert.doesNotMatch(line.secondary, /Presentación comercial:/);
});

test("resume lotes mixtos sin ocultar sus figuras", () => {
  const batch = batchPresentation({ producto: "Momo Perrito", sabor: "Oreo", figuras: [{ figura: "Max", cant: 2 }, { figura: "Rocco", cant: 3 }] });
  assert.equal(batch.primary, "Corrida de Oreo: 2× Max · 3× Rocco");
  assert.equal(batch.secondary, "Presentación comercial: Momo Perrito");
});

test("filtra figuras de combo por productId, nunca solo por especie", () => {
  const db = {
    products: [{ id: "PR01", especie: "gato" }, { id: "PR04", especie: "gato" }],
    figuras: [
      { nombre: "Lizi", productId: "PR01", especie: "gato", activo: true },
      { nombre: "Teo", productId: "PR04", especie: "gato", activo: true },
    ],
  };
  assert.deepEqual(figuresForCommercialProducts(db, ["PR01"]).map((figure) => figure.nombre), ["Lizi"]);
});

test("el catálogo operativo excluye siluetas y nombres legacy aunque sigan en la caché", () => {
  const db = {
    figuras: [
      { nombre: "Lizi", productId: "PR01", activo: true },
      { nombre: "Horizontal", productId: "PR01", activo: true },
      { nombre: "Gatito", productId: "PR01", activo: true },
    ],
  };
  assert.deepEqual(activeFigureCatalog(db).map((figure) => figure.nombre), ["Lizi"]);
});

test("el catálogo falla cerrado ante figuras huérfanas o ligadas a otra familia", () => {
  const db = {
    products: [{ id: "P-G", nombre: "Momo Gatito" }, { id: "P-P", nombre: "Momo Perrito" }],
    figuras: [
      { nombre: "Lizi", productId: "", activo: true },
      { nombre: "Toby", productId: "P-P", activo: true },
      { nombre: "Max", productId: "P-P", activo: true },
      { nombre: "Momo", productId: "P-G", activo: true },
    ],
  };
  assert.deepEqual(activeFigureCatalog(db).map((figure) => figure.nombre), ["Max", "Momo"]);
  assert.equal(isCanonicalFigureRecord({ nombre: "Teo", productId: "PR01", activo: true }, db), false);
});

test("las reservas muestran la figura física primero y nunca convierten la familia en producto exacto", () => {
  const exact = inventoryReservationPresentation({
    tipo: "producto", nombre: "Momo Perrito", figuraLote: "Max",
  });
  assert.equal(exact.primary, "Max");
  assert.match(exact.secondary, /Presentación comercial: Momo Perrito/);
  assert.equal(exact.exact, true);

  const legacy = inventoryReservationPresentation({
    tipo: "producto", nombre: "Momo Gatito", figuraLote: "Gatito",
  });
  assert.equal(legacy.primary, "Producto terminado sin figura verificable");
  assert.match(legacy.secondary, /Momo Gatito/);
  assert.equal(legacy.exact, false);
});
