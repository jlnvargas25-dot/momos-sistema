import test from "node:test";
import assert from "node:assert/strict";
import { buildFinishedStockSummary } from "./production-stock-summary.js";

test("unifica el macro con variantes, histórico, cuarentena y lotes exactos", () => {
  const result = buildFinishedStockSummary({
    today: "2026-07-19",
    products: [{ id: "PR01", nombre: "Momo Gatito", tipo: "momo", stock: 13 }],
    variants: [{ productId: "PR01", figura: "Momo", sabor: "Mango biche", gramajeG: 180, disponibles: 3, vence: "2026-07-21" }],
    quarantinedVariants: [{ productId: "PR01", figura: "Toby", sabor: "Mango biche", gramajeG: 280, disponibles: 1, vence: "2026-07-18" }],
    productionBatches: [{
      id: "L-1", productId: "PR01", sabor: "Mango biche", gramaje: "180 g", vence: "2026-07-21", stockContabilizado: true,
      resultadosFiguras: [{ figura: "Momo", perfectas: 5, consumidas: 2 }],
    }],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].registeredTotal, 13);
  assert.equal(result[0].exactAvailable, 3);
  assert.equal(result[0].unclassified, 9);
  assert.equal(result[0].quarantined, 1);
  assert.deepEqual(result[0].lotRows.map((row) => [row.batchId, row.figure, row.available]), [["L-1", "Momo", 3]]);
});

test("resume solo familias comerciales y excluye preparados al momento mal tipados", () => {
  const result = buildFinishedStockSummary({
    products: [
      { id: "PR02", nombre: "Momo Perrito", cat: "Momos Signature", tipo: "momo", stock: 2 },
      { id: "P8", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "momo", stock: 12 },
    ],
  });

  assert.deepEqual(result.map((product) => product.productId), ["PR02"]);
});

test("no cuenta una figura legacy como disponibilidad exacta", () => {
  const [summary] = buildFinishedStockSummary({
    products: [{ id: "PR01", nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo", stock: 3 }],
    variants: [
      { productId: "PR01", figura: "Lizi", sabor: "Coco", disponibles: 1 },
      { productId: "PR01", figura: "Horizontal", sabor: "Oreo", disponibles: 2 },
    ],
  });

  assert.equal(summary.exactAvailable, 1);
  assert.equal(summary.unclassified, 2);
  assert.deepEqual(summary.variants.map((variant) => variant.figura), ["Lizi"]);
});

test("separa variantes y lotes cuya figura no pertenece a la familia", () => {
  const [summary] = buildFinishedStockSummary({
    products: [{ id: "PR01", nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo", stock: 5 }],
    variants: [
      { productId: "PR01", figura: "Lizi", sabor: "Coco", disponibles: 2 },
      { productId: "PR01", figura: "Max", sabor: "Oreo", disponibles: 3 },
    ],
    productionBatches: [{
      id: "L-X", productId: "PR01", sabor: "Oreo", stockContabilizado: true,
      resultadosFiguras: [{ figura: "Max", perfectas: 3, consumidas: 0 }],
    }],
  });

  assert.equal(summary.exactAvailable, 2);
  assert.equal(summary.unclassified, 3);
  assert.equal(summary.incompatibleUnits, 3);
  assert.deepEqual(summary.incompatibleVariants.map((variant) => variant.figura), ["Max"]);
  assert.deepEqual(summary.lotRows, []);
  assert.deepEqual(summary.incompatibleLotRows.map((row) => row.figure), ["Max"]);
});

test("productos al momento no aparecen como familia ni aunque traigan figura legacy", () => {
  const result = buildFinishedStockSummary({
    products: [{ id: "PR08", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "pedido", stock: 12 }],
    variants: [{ productId: "PR08", figura: "Lizi", sabor: "Coco", disponibles: 12 }],
  });

  assert.deepEqual(result, []);
});
