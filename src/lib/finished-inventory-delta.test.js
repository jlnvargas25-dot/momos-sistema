import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFinishedInventoryDeltaBatch,
  applyFinishedInventoryDeltaBatchToDb,
  compareFinishedInventoryDeltaVersions,
  normalizeFinishedInventoryDeltaBatch,
} from "./finished-inventory-delta.js";

function envelope(version = "7") {
  return {
    contract: "momos.finished-inventory-delta-batch.v1",
    serverTime: "2026-07-19T12:00:00Z",
    containsSecrets: false,
    externalExecution: false,
    deltas: [{
      contract: "momos.finished-inventory-delta.v1",
      productId: "PR01",
      version,
      product: { id: "PR01", nombre: "Momo Gatito", tipo: "momo", activo: true, stock: 3 },
      productionBatches: [{ id: "L-1", productId: "PR01", producto: "Momo Gatito", resultadosFiguras: [] }],
      variants: [{ productId: "PR01", figura: "Lizi", sabor: "Oreo", gramajeG: 150, disponibles: 3 }],
      quarantinedVariants: [],
    }],
  };
}

test("H72 normaliza versiones decimales sin perder precisión", () => {
  assert.equal(compareFinishedInventoryDeltaVersions("900719925474099312", "900719925474099311"), 1);
  assert.equal(normalizeFinishedInventoryDeltaBatch(envelope("0007")).deltas[0].version, "7");
});

test("H72 reemplaza solo el producto solicitado y conserva su ficha completa", () => {
  const db = {
    products: [{ id: "PR01", precio: 18000, stock: 1 }, { id: "PR02", stock: 9 }],
    production_batches: [{ id: "L-OLD", productId: "PR01" }, { id: "L-2", productId: "PR02" }],
    variantes: [{ productId: "PR02", figura: "Max", sabor: "Coco", gramajeG: 180 }],
    variantesCuarentena: [{ productId: "PR01", figura: "Lizi", sabor: "Limón", gramajeG: 150 }],
  };
  const result = applyFinishedInventoryDeltaBatchToDb(db, envelope());
  assert.deepEqual(result.applied, ["PR01"]);
  assert.equal(db.products.find((row) => row.id === "PR01").precio, 18000);
  assert.equal(db.products.find((row) => row.id === "PR01").stock, 3);
  assert.deepEqual(db.production_batches.map((row) => row.id).sort(), ["L-1", "L-2"]);
  assert.equal(db.variantesCuarentena.some((row) => row.productId === "PR01"), false);
});

test("H72 descarta replay o respuesta antigua", () => {
  const db = { products: [], production_batches: [], variantes: [], variantesCuarentena: [], finishedInventoryDeltaVersions: { PR01: "8" } };
  const result = applyFinishedInventoryDeltaBatchToDb(db, envelope("7"));
  assert.equal(result.status, "stale");
  assert.deepEqual(result.applied, []);
});

test("H88 actualiza producto terminado preservando el estado no relacionado", () => {
  const unrelated = Array.from({ length: 25000 }, (_, id) => ({ id }));
  const db = {
    products: [{ id: "PR01", precio: 18000, stock: 1 }], production_batches: [], variantes: [],
    variantesCuarentena: [], finishedInventoryDeltaVersions: {}, agencyRetentionMeasurements: unrelated,
  };
  const result = applyFinishedInventoryDeltaBatch(db, envelope());
  assert.equal(db.products[0].stock, 1);
  assert.equal(db.finishedInventoryDeltaVersions.PR01, undefined);
  assert.equal(result.db.products[0].stock, 3);
  assert.equal(result.db.agencyRetentionMeasurements, unrelated);
  assert.equal(result.db.finishedInventoryDeltaVersions.PR01, "7");
});

test("H72 rechaza mezcla de productos, duplicados y fronteras abiertas", () => {
  const mixed = envelope();
  mixed.deltas[0].productionBatches[0].productId = "PR02";
  assert.throws(() => normalizeFinishedInventoryDeltaBatch(mixed), /mezcló o repitió lotes/);
  const open = envelope();
  open.containsSecrets = true;
  assert.throws(() => normalizeFinishedInventoryDeltaBatch(open), /frontera no autorizada/);
});
