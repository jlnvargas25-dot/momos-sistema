import assert from "node:assert/strict";
import test from "node:test";
import { evaluateComboVariantAvailability, evaluateExactVariantDemand } from "./variant-availability.js";

test("la disponibilidad exacta exige producto, figura y sabor", () => {
  const variants = [
    { productId: "PR02", figura: "Max", sabor: "Oreo", disponibles: 2, vence: "2026-07-20" },
    { productId: "PR02", figura: "Rocco", sabor: "Oreo", disponibles: 9 },
    { productId: "PR02", figura: "Max", sabor: "Coco", disponibles: 7 },
  ];
  const result = evaluateExactVariantDemand({ productId: "PR02", figure: "Max", flavor: "Oreo", quantity: 3, variants, today: "2026-07-14" });

  assert.equal(result.available, 2);
  assert.equal(result.covered, 2);
  assert.equal(result.missing, 1);
  assert.equal(result.canFulfill, false);
  assert.equal(result.nextExpiry, "2026-07-20");
});

test("una variante vencida no puede cubrir una venta exacta", () => {
  const result = evaluateExactVariantDemand({
    productId: "PR02",
    figure: "Max",
    flavor: "Oreo",
    quantity: 1,
    variants: [{ productId: "PR02", figura: "Max", sabor: "Oreo", disponibles: 8, vence: "2026-07-13" }],
    today: "2026-07-14",
  });

  assert.equal(result.available, 0);
  assert.equal(result.canFulfill, false);
  assert.equal(result.missing, 1);
});

test("el stock agregado anterior no cuenta como figura y sabor disponibles", () => {
  const result = evaluateExactVariantDemand({
    productId: "PR02",
    figure: "Max",
    flavor: "Oreo",
    quantity: 1,
    variants: [],
  });

  assert.equal(result.available, 0);
  assert.equal(result.missing, 1);
});

test("un nombre legacy o una silueta no cuentan como figura física exacta", () => {
  const result = evaluateExactVariantDemand({
    productId: "PR02",
    figure: "Gatito",
    flavor: "Oreo",
    quantity: 1,
    variants: [{ productId: "PR02", figura: "Gatito", sabor: "Oreo", disponibles: 5 }],
  });

  assert.equal(result.complete, false);
  assert.equal(result.available, 0);
  assert.equal(result.canFulfill, false);
});

test("una caja repetida no promete dos unidades cuando solo existe una variante exacta", () => {
  const db = {
    settings: { figuras: [{ nombre: "Max", especie: "perro", productId: "PR02" }] },
    products: [{ id: "PR02", nombre: "Momo Perrito", especie: "perro" }],
    variantes: [{ productId: "PR02", figura: "Max", sabor: "Oreo", disponibles: 1 }],
  };
  const combo = { componentProductIds: ["PR02"] };
  const boxes = [[
    { figura: "Max", sabor: "Oreo" },
    { figura: "Max", sabor: "Oreo" },
  ]];
  const result = evaluateComboVariantAvailability({ db, combo, boxes, today: "2026-07-14" });

  assert.equal(result.required, 2);
  assert.equal(result.covered, 1);
  assert.equal(result.shortages[0].missing, 1);
  assert.deepEqual(result.slots.map((slot) => slot.covered), [true, false]);
});

test("cada figura de la caja consume su familia comercial exacta", () => {
  const db = {
    settings: { figuras: [{ nombre: "Lizi", especie: "gato", productId: "PR01" }, { nombre: "Max", especie: "perro", productId: "PR02" }] },
    products: [
      { id: "PR01", nombre: "Momo Gatito", especie: "gato" },
      { id: "PR02", nombre: "Momo Perrito", especie: "perro" },
    ],
    variantes: [
      { productId: "PR01", figura: "Lizi", sabor: "Coco", disponibles: 1 },
      { productId: "PR02", figura: "Max", sabor: "Oreo", disponibles: 1 },
    ],
  };
  const combo = { componentProductIds: ["PR01", "PR02"] };
  const result = evaluateComboVariantAvailability({
    db,
    combo,
    boxes: [[{ figura: "Lizi", sabor: "Coco" }, { figura: "Max", sabor: "Oreo" }]],
    today: "2026-07-14",
  });

  assert.equal(result.canFulfill, true);
  assert.deepEqual(result.slots.map((slot) => slot.productId), ["PR01", "PR02"]);
});

test("una figura de la misma especie no puede colarse en una caja de otra familia", () => {
  const db = {
    settings: { figuras: [{ nombre: "Lizi", especie: "gato", productId: "PR01" }, { nombre: "Teo", especie: "gato", productId: "PR04" }] },
    products: [
      { id: "PR01", nombre: "Momo Gatito", especie: "gato" },
      { id: "PR04", nombre: "Momo premium", especie: "gato" },
    ],
    variantes: [{ productId: "PR04", figura: "Teo", sabor: "Oreo", disponibles: 3 }],
  };
  const result = evaluateComboVariantAvailability({
    db,
    combo: { componentProductIds: ["PR01"] },
    boxes: [[{ figura: "Teo", sabor: "Oreo" }]],
    today: "2026-07-14",
  });

  assert.equal(result.canFulfill, false);
  assert.equal(result.incomplete, 1);
  assert.equal(result.slots[0].productId, "");
});

test("una variante con figura de otra familia se excluye del stock exacto", () => {
  const result = evaluateExactVariantDemand({
    productId: "PR01",
    figure: "Max",
    flavor: "Oreo",
    quantity: 1,
    variants: [{ productId: "PR01", figura: "Max", sabor: "Oreo", disponibles: 8 }],
  });

  assert.equal(result.complete, false);
  assert.equal(result.available, 0);
  assert.equal(result.canFulfill, false);
  assert.equal(result.integrityIssue, "FAMILY_FIGURE_MISMATCH");
  assert.equal(result.expectedProductId, "PR02");
});

test("un producto al momento nunca se usa como familia de una figura", () => {
  const result = evaluateExactVariantDemand({
    productId: "PR08",
    figure: "Lizi",
    flavor: "Coco",
    quantity: 1,
    variants: [{ productId: "PR08", figura: "Lizi", sabor: "Coco", disponibles: 9 }],
  });

  assert.equal(result.available, 0);
  assert.equal(result.integrityIssue, "FAMILY_FIGURE_MISMATCH");
  assert.equal(result.expectedProductId, "PR01");
});

test("el mapa completo de siete figuras solo acepta su familia canónica", () => {
  const expected = {
    Lizi: "PR01", Momo: "PR01", Toby: "PR01",
    Max: "PR02", Rocco: "PR02", Danna: "PR02",
    Teo: "PR04",
  };
  const variants = Object.entries(expected).map(([figura, productId]) => ({
    productId, figura, sabor: "Oreo", disponibles: 1,
  }));

  Object.entries(expected).forEach(([figure, productId]) => {
    const valid = evaluateExactVariantDemand({ productId, figure, flavor: "Oreo", variants });
    assert.equal(valid.canFulfill, true, `${figure} debe pertenecer a ${productId}`);

    const wrongProductId = productId === "PR01" ? "PR02" : "PR01";
    const invalid = evaluateExactVariantDemand({ productId: wrongProductId, figure, flavor: "Oreo", variants });
    assert.equal(invalid.canFulfill, false, `${figure} no debe pertenecer a ${wrongProductId}`);
    assert.equal(invalid.integrityIssue, "FAMILY_FIGURE_MISMATCH");
  });
});
