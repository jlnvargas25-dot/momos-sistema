import assert from "node:assert/strict";
import test from "node:test";
import { evaluateComboVariantAvailability, evaluateExactVariantDemand } from "./variant-availability.js";

test("la disponibilidad exacta exige producto, figura y sabor", () => {
  const variants = [
    { productId: "P1", figura: "Max", sabor: "Oreo", disponibles: 2, vence: "2026-07-20" },
    { productId: "P1", figura: "Rocco", sabor: "Oreo", disponibles: 9 },
    { productId: "P1", figura: "Max", sabor: "Coco", disponibles: 7 },
  ];
  const result = evaluateExactVariantDemand({ productId: "P1", figure: "Max", flavor: "Oreo", quantity: 3, variants, today: "2026-07-14" });

  assert.equal(result.available, 2);
  assert.equal(result.covered, 2);
  assert.equal(result.missing, 1);
  assert.equal(result.canFulfill, false);
  assert.equal(result.nextExpiry, "2026-07-20");
});

test("una variante vencida no puede cubrir una venta exacta", () => {
  const result = evaluateExactVariantDemand({
    productId: "P1",
    figure: "Max",
    flavor: "Oreo",
    quantity: 1,
    variants: [{ productId: "P1", figura: "Max", sabor: "Oreo", disponibles: 8, vence: "2026-07-13" }],
    today: "2026-07-14",
  });

  assert.equal(result.available, 0);
  assert.equal(result.canFulfill, false);
  assert.equal(result.missing, 1);
});

test("el stock agregado anterior no cuenta como figura y sabor disponibles", () => {
  const result = evaluateExactVariantDemand({
    productId: "P1",
    figure: "Max",
    flavor: "Oreo",
    quantity: 1,
    variants: [],
  });

  assert.equal(result.available, 0);
  assert.equal(result.missing, 1);
});

test("una caja repetida no promete dos unidades cuando solo existe una variante exacta", () => {
  const db = {
    settings: { figuras: [{ nombre: "Max", especie: "perro" }] },
    products: [{ id: "PERRO", nombre: "Momo Perrito", especie: "perro" }],
    variantes: [{ productId: "PERRO", figura: "Max", sabor: "Oreo", disponibles: 1 }],
  };
  const combo = { componentProductIds: ["PERRO"] };
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

test("cada figura de la caja consume el producto de su especie", () => {
  const db = {
    settings: { figuras: [{ nombre: "Lizi", especie: "gato" }, { nombre: "Max", especie: "perro" }] },
    products: [
      { id: "GATO", nombre: "Momo Gatito", especie: "gato" },
      { id: "PERRO", nombre: "Momo Perrito", especie: "perro" },
    ],
    variantes: [
      { productId: "GATO", figura: "Lizi", sabor: "Coco", disponibles: 1 },
      { productId: "PERRO", figura: "Max", sabor: "Oreo", disponibles: 1 },
    ],
  };
  const combo = { componentProductIds: ["GATO", "PERRO"] };
  const result = evaluateComboVariantAvailability({
    db,
    combo,
    boxes: [[{ figura: "Lizi", sabor: "Coco" }, { figura: "Max", sabor: "Oreo" }]],
    today: "2026-07-14",
  });

  assert.equal(result.canFulfill, true);
  assert.deepEqual(result.slots.map((slot) => slot.productId), ["GATO", "PERRO"]);
});
