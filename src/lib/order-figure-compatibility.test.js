import test from "node:test";
import assert from "node:assert/strict";

import {
  applyOrderComboFigureEdit,
  applyOrderFigureEdit,
  decorateOrderLineCompatibility,
  orderFiguresForFamily,
  orderLineFigureCompatibilityErrors,
  sanitizeOrderLineFigureFields,
  validateOrderComboSlotFigure,
  validateOrderFigureCatalogLink,
  validateOrderFigureForProduct,
} from "../features/orders/order-figure-compatibility.js";

const products = {
  PR01: { id: "PR01", nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo" },
  PR02: { id: "PR02", nombre: "Momo Perrito", cat: "Momos Signature", tipo: "momo" },
  PR04: { id: "PR04", nombre: "Momo premium", cat: "Momos Signature", tipo: "momo" },
  PR08: { id: "PR08", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "pedido" },
  PR05: { id: "PR05", nombre: "Caja x3 Momos", cat: "Cajas y Combos", tipo: "combo", componentProductIds: ["PR01", "PR02"] },
};

const canonicalFigures = [
  ["Lizi", "PR01"], ["Momo", "PR01"], ["Toby", "PR01"],
  ["Max", "PR02"], ["Rocco", "PR02"], ["Danna", "PR02"],
  ["Teo", "PR04"],
].map(([nombre, productId]) => ({ nombre, productId, activo: true }));

test("las siete figuras físicas conservan su familia canónica exacta", () => {
  for (const figure of canonicalFigures) {
    const link = validateOrderFigureCatalogLink(figure);
    assert.equal(link.valid, true, link.message);
    assert.equal(link.expectedProductId, figure.productId);
    const line = { productId: figure.productId, figura: figure.nombre };
    assert.equal(validateOrderFigureForProduct(line, products[figure.productId]).valid, true);
  }

  assert.deepEqual(orderFiguresForFamily(canonicalFigures, "PR01").map((row) => row.nombre), ["Lizi", "Momo", "Toby"]);
  assert.deepEqual(orderFiguresForFamily(canonicalFigures, "PR02").map((row) => row.nombre), ["Max", "Rocco", "Danna"]);
  assert.deepEqual(orderFiguresForFamily(canonicalFigures, "PR04").map((row) => row.nombre), ["Teo"]);
});

test("un enlace de catálogo cruzado no se ofrece como si fuera válido", () => {
  const wrong = validateOrderFigureCatalogLink({ nombre: "Lizi", productId: "PR02", activo: true });
  assert.equal(wrong.valid, false);
  assert.equal(wrong.code, "catalog-family-mismatch");
  assert.match(wrong.message, /Lizi debe estar vinculada a Momo Gatito \(PR01\), no a Momo Perrito \(PR02\)/);
  assert.deepEqual(orderFiguresForFamily([{ nombre: "Lizi", productId: "PR02", activo: true }], "PR02"), []);
});

test("crear o editar bloquea cruces familia-figura y conserva el estado anterior", () => {
  const original = { productId: "PR02", figura: "Max", sabor: "Oreo" };
  const edit = applyOrderFigureEdit(original, products.PR02, "Lizi");
  assert.equal(edit.ok, false);
  assert.strictEqual(edit.item, original);
  assert.equal(edit.error.code, "family-figure-mismatch");
  assert.match(edit.error.message, /Lizi pertenece a Momo Gatito \(PR01\), no a Momo Perrito \(PR02\)/);

  const validEdit = applyOrderFigureEdit(original, products.PR02, "Danna");
  assert.equal(validEdit.ok, true);
  assert.equal(validEdit.item.figura, "Danna");
});

test("las elaboraciones al momento nunca heredan una figura", () => {
  const stale = { productId: "PR08", figura: "Lizi", sabor: "Coco", boxes: [[{ figura: "Max" }]] };
  const validation = validateOrderFigureForProduct(stale, products.PR08);
  assert.equal(validation.valid, false);
  assert.equal(validation.code, "figure-not-allowed");
  assert.match(validation.message, /elaboración al momento y no admite figura/);

  const clean = sanitizeOrderLineFigureFields(stale, products.PR08);
  assert.equal(clean.figura, "");
  assert.deepEqual(clean.boxes, []);
});

test("los combos validan cada espacio y permanecen separados de una figura global", () => {
  for (const figure of ["Lizi", "Momo", "Toby", "Max", "Rocco", "Danna"]) {
    assert.equal(validateOrderComboSlotFigure(products.PR05, figure).valid, true);
  }
  const teo = validateOrderComboSlotFigure(products.PR05, "Teo");
  assert.equal(teo.valid, false);
  assert.equal(teo.code, "combo-family-mismatch");
  assert.match(teo.message, /Teo pertenece a Momo premium \(PR04\)/);

  const global = validateOrderFigureForProduct({ productId: "PR05", figura: "Max" }, products.PR05);
  assert.equal(global.valid, false);
  assert.equal(global.code, "combo-global-figure");

  const slot = { figura: "Max", sabor: "Oreo" };
  const rejected = applyOrderComboFigureEdit(slot, products.PR05, "Teo");
  assert.equal(rejected.ok, false);
  assert.strictEqual(rejected.slot, slot);
});

test("el guard de guardado identifica la caja y el espacio incompatibles", () => {
  const line = {
    productId: "PR05",
    figura: "",
    boxes: [[{ figura: "Lizi" }, { figura: "Teo" }, { figura: "Max" }]],
  };
  const errors = orderLineFigureCompatibilityErrors(line, products.PR05);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].boxIndex, 0);
  assert.equal(errors[0].slotIndex, 1);
  assert.match(errors[0].message, /^Caja 1, espacio 2:/);
});

test("los datos históricos incompatibles se muestran con advertencia explícita", () => {
  const presentation = { primary: "Lizi de Coco", secondary: "Presentación comercial: Momo Perrito" };
  const decorated = decorateOrderLineCompatibility(
    presentation,
    { productId: "PR02", figura: "Lizi", sabor: "Coco" },
    products.PR02,
  );
  assert.notStrictEqual(decorated, presentation);
  assert.match(decorated.secondary, /⚠ Lizi pertenece a Momo Gatito \(PR01\)/);
  assert.match(decorated.figureCompatibilityError, /Elegí la familia correcta/);
});
