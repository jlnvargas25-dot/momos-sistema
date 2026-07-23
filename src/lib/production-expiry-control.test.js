import test from "node:test";
import assert from "node:assert/strict";
import { buildProductionExpiryControl, classifyExpiry } from "./production-expiry-control.js";

test("clasifica vencidos, hoy, próximos y faltantes sin depender de la hora", () => {
  assert.deepEqual(classifyExpiry("2026-07-18", "2026-07-19"), { priority: "expired", days: -1 });
  assert.deepEqual(classifyExpiry("2026-07-19", "2026-07-19"), { priority: "today", days: 0 });
  assert.deepEqual(classifyExpiry("2026-07-21", "2026-07-19"), { priority: "urgent", days: 2 });
  assert.deepEqual(classifyExpiry("2026-07-24", "2026-07-19"), { priority: "soon", days: 5 });
  assert.deepEqual(classifyExpiry("", "2026-07-19"), { priority: "missing", days: null });
});

test("separa insumos, elaboraciones y producto terminado y excluye saldos agotados", () => {
  const result = buildProductionExpiryControl({
    today: "2026-07-19",
    inventoryLotsReady: true,
    subrecipes: [{ id: "SR1", itemId: "I-PREP", nombre: "Ganache de chocolate" }],
    inventoryLots: [
      { id: "IL-1", itemId: "I-RAW", itemName: "Crema", available: 2, unit: "L", expiresAt: "2026-07-18" },
      { id: "IL-2", itemId: "I-PREP", itemName: "Ganache", available: 0.5, unit: "kg", expiresAt: "2026-07-21", origin: "Producción" },
      { id: "IL-3", itemId: "I-ZERO", itemName: "Agotado", available: 0, unit: "kg", expiresAt: "2026-07-19" },
      { id: "IL-4", itemId: "I-BOX", itemName: "Caja", available: 20, unit: "und", expiresAt: "" },
    ],
    inventoryItems: [
      { id: "I-RAW", cat: "Ingredientes" },
      { id: "I-PREP", cat: "Ganache" },
      { id: "I-ZERO", cat: "Ingredientes" },
      { id: "I-BOX", cat: "Cajas" },
    ],
    productionBatches: [{
      id: "L-1", producto: "Momo Gatito", sabor: "Mango biche", gramaje: "180 g", vence: "2026-07-24", stockContabilizado: true,
      resultadosFiguras: [{ figura: "Momo", perfectas: 5, consumidas: 2 }, { figura: "Toby", perfectas: 1, consumidas: 1 }],
    }],
  });
  assert.deepEqual(result.byKind.ingredient.map((row) => row.name), ["Crema"]);
  assert.deepEqual(result.byKind.preparation.map((row) => row.name), ["Ganache de chocolate"]);
  assert.deepEqual(result.byKind.finished.map((row) => [row.figure, row.quantity]), [["Momo", 3]]);
  assert.equal(result.summary.expired, 1);
  assert.equal(result.summary.urgent, 1);
  assert.equal(result.summary.soon, 1);
});

test("expone inventario histórico sin fecha cuando no existe detalle por lote", () => {
  const result = buildProductionExpiryControl({
    today: "2026-07-19",
    inventoryLotsReady: false,
    inventoryItems: [{ id: "I1", nombre: "Azúcar", stock: 4, unidad: "kg", vence: "" }],
  });
  assert.equal(result.byKind.ingredient[0].priority, "missing");
  assert.equal(result.byKind.ingredient[0].exactLot, false);
});

test("vencimientos nunca presentan Gatito o Horizontal como producto físico terminado", () => {
  const result = buildProductionExpiryControl({
    today: "2026-07-19",
    productionBatches: [{
      id: "L-legacy", producto: "Momo Gatito", sabor: "Oreo", vence: "2026-07-20", stockContabilizado: true,
      resultadosFiguras: [
        { figura: "Gatito", perfectas: 2, consumidas: 0 },
        { figura: "Horizontal", perfectas: 1, consumidas: 0 },
        { figura: "Lizi", perfectas: 1, consumidas: 0 },
      ],
    }],
  });
  assert.deepEqual(result.byKind.finished.map((row) => row.figure), ["Lizi"]);
});

test("marca gramaje o familia históricos incompatibles sin reescribir el lote", () => {
  const result = buildProductionExpiryControl({
    today: "2026-07-23",
    productionBatches: [{
      id: "L-toby-v4", fecha: "2026-07-23", assemblySpecVersion: "V4", producto: "Momo Perrito", sabor: "Coco", gramaje: "180 g", vence: "2026-07-26", stockContabilizado: true,
      resultadosFiguras: [{ figura: "Toby", perfectas: 1, consumidas: 0 }],
    }],
  });
  const [row] = result.byKind.finished;
  assert.equal(row.figure, "Toby");
  assert.equal(row.expectedGrams, 210);
  assert.equal(row.expectedFamilyName, "Momo Gatito");
  assert.match(row.integrityWarning, /Toby requiere 210 g; el lote registra 180 g/);
  assert.match(row.integrityWarning, /Toby pertenece a Momo Gatito; el lote registra Momo Perrito/);
  assert.equal(row.grams, "180 g");
  assert.equal(row.name, "Momo Perrito");
});

test("conserva el gramaje V3 de un lote historico sin reinterpretarlo como V4", () => {
  const result = buildProductionExpiryControl({
    today: "2026-07-23",
    productionBatches: [{
      id: "L-toby-v3", fecha: "2026-07-20", assemblySpecVersion: "V3", producto: "Momo Gatito",
      sabor: "Coco", gramaje: "280 g", vence: "2026-07-24", stockContabilizado: true,
      resultadosFiguras: [{ figura: "Toby", perfectas: 1, consumidas: 0 }],
    }],
  });
  const [row] = result.byKind.finished;
  assert.equal(row.expectedGrams, 210);
  assert.equal(row.grams, "280 g");
  assert.equal(row.integrityWarning, "");
});
