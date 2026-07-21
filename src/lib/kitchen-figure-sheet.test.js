import test from "node:test";
import assert from "node:assert/strict";
import { buildKitchenFigureSheet, sortKitchenFigures } from "./kitchen-figure-sheet.js";

const products = [
  { id: "PR01", nombre: "Momo Gatito 150 g", cat: "Momos Signature", tipo: "momo" },
  { id: "PR02", nombre: "Momo Perrito 180 g", cat: "Momos Signature", tipo: "momo" },
  { id: "PR04", nombre: "Momo premium 250 g", cat: "Momos Signature", tipo: "momo" },
];
const figures = [
  { nombre: "Momo", especie: "gato", gramajeG: 150, productId: "PR01", activo: true },
  { nombre: "Lizi", especie: "gato", gramajeG: 150, productId: "PR01", activo: true },
  { nombre: "Max", especie: "perro", gramajeG: 180, productId: "PR02", activo: true },
  { nombre: "Teo", especie: "gato", gramajeG: 250, productId: "PR04", activo: true },
];
const subrecipes = [
  { id: "SR-COCO", nombre: "Mousse coco", tipo: "mousse_frutal", sabor: "Coco", itemId: "MOUSSE-COCO", activo: true, inputGrams: 100, outputGrams: 100 },
  { id: "SR-OREO", nombre: "Mousse Oreo", tipo: "mousse_cremosa", sabor: "Oreo", itemId: "MOUSSE-OREO", activo: true, inputGrams: 100, outputGrams: 100 },
  { id: "SR-CHEESE", nombre: "Relleno cheesecake", tipo: "cheesecake", itemId: "CHEESE", activo: true, inputGrams: 100, outputGrams: 100 },
  { id: "SR-GANACHE", nombre: "Ganache de chocolate", tipo: "ganache", itemId: "GANACHE", activo: true, inputGrams: 100, outputGrams: 100 },
];
const fillingRules = [
  { id: "FR1", subrecetaId: "SR-CHEESE", gramosPorUnidad: 20, activo: true },
  { id: "FR2", subrecetaId: "SR-GANACHE", gramosPorUnidad: 15, activo: true },
];
const inventory = [
  { id: "MOUSSE-COCO", nombre: "Mousse coco", unidad: "kg", stock: 1, costo: 1 },
  { id: "MOUSSE-OREO", nombre: "Mousse Oreo", unidad: "kg", stock: 1, costo: 1 },
  { id: "CHEESE", nombre: "Relleno cheesecake", unidad: "kg", stock: 1, costo: 1 },
  { id: "GANACHE", nombre: "Ganache de chocolate", unidad: "kg", stock: 1, costo: 1 },
];

test("la ficha de Cocina conserva al personaje como producto y la presentación como familia comercial", () => {
  const sheet = buildKitchenFigureSheet({
    figure: figures[1], flavor: "Coco", figures, products, subrecipes,
    fillingRules, inventory, freezingHours: 10,
  });

  assert.equal(sheet.identity, "Lizi");
  assert.equal(sheet.displayName, "Lizi de Coco");
  assert.equal(sheet.commercialFamily.nombre, "Momo Gatito 150 g");
  assert.equal(sheet.grams, 150);
  assert.equal(sheet.preview.mousseOutputGrams, 115);
  assert.equal(sheet.preview.totalFillingGrams, 35);
  assert.deepEqual(sheet.preview.preparations.map((row) => row.name), [
    "Mousse coco", "Relleno cheesecake", "Ganache de chocolate",
  ]);
});

test("cambiar el sabor cambia la mousse, no el personaje ni su familia comercial", () => {
  const sheet = buildKitchenFigureSheet({
    figure: figures[1], flavor: "Oreo", figures, products, subrecipes,
    fillingRules, inventory,
  });

  assert.equal(sheet.identity, "Lizi");
  assert.equal(sheet.commercialFamily.id, "PR01");
  assert.equal(sheet.preview.preparations[0].name, "Mousse Oreo");
  assert.equal(sheet.preview.preparations.some((row) => row.name === "Mousse coco"), false);
});

test("el orden del Recetario prioriza los siete personajes de MOMOS", () => {
  const sorted = sortKitchenFigures([
    { nombre: "Max" }, { nombre: "Toby" }, { nombre: "Lizi" }, { nombre: "Momo" },
  ]);
  assert.deepEqual(sorted.map((figure) => figure.nombre), ["Lizi", "Momo", "Toby", "Max"]);
});

test("no construye una ficha de Cocina para una silueta o figura legacy", () => {
  const sheet = buildKitchenFigureSheet({
    figure: { nombre: "Gatito", especie: "gato", gramajeG: 150, productId: "PR01" },
    flavor: "Coco", figures, products, subrecipes, fillingRules, inventory,
  });
  assert.equal(sheet, null);
});

test("la ficha rechaza una figura canónica enlazada a la familia equivocada", () => {
  const sheet = buildKitchenFigureSheet({
    figure: { nombre: "Lizi", especie: "gato", gramajeG: 150, productId: "PR02", activo: true },
    flavor: "Coco", figures, products, subrecipes,
    fillingRules, inventory,
  });
  assert.equal(sheet, null);
});

test("las fichas aceptan PR01, PR02 y PR04 por nombre canónico, no por especie", () => {
  const cases = [
    [{ ...figures.find((figure) => figure.nombre === "Lizi"), especie: "perro" }, "PR01"],
    [{ ...figures.find((figure) => figure.nombre === "Max"), especie: "gato" }, "PR02"],
    [{ ...figures.find((figure) => figure.nombre === "Teo"), especie: "perro" }, "PR04"],
  ];
  cases.forEach(([figure, expectedProductId]) => {
    const sheet = buildKitchenFigureSheet({
      figure, flavor: "Oreo", figures: [...figures.filter((row) => row.nombre !== figure.nombre), figure],
      products, subrecipes, fillingRules, inventory,
    });
    assert.equal(sheet.identity, figure.nombre);
    assert.equal(sheet.commercialFamily.id, expectedProductId);
  });
});

test("una figura nunca hereda una caja o elaboración al momento como familia", () => {
  const invalidProducts = [
    { id: "PR01", nombre: "Caja gatitos", cat: "Cajas y Combos", tipo: "combo" },
    { id: "PR02", nombre: "Preparación perrito", cat: "Momos Cuchara", tipo: "pedido" },
  ];
  const catSheet = buildKitchenFigureSheet({
    figure: figures.find((figure) => figure.nombre === "Momo"), flavor: "Coco",
    figures, products: invalidProducts, subrecipes, fillingRules, inventory,
  });
  const dogSheet = buildKitchenFigureSheet({
    figure: figures.find((figure) => figure.nombre === "Max"), flavor: "Coco",
    figures, products: invalidProducts, subrecipes, fillingRules, inventory,
  });
  assert.equal(catSheet, null);
  assert.equal(dogSheet, null);
});
