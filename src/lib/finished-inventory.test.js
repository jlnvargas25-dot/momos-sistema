import assert from "node:assert/strict";
import test from "node:test";
import { buildFinishedInventory } from "./finished-inventory.js";

test("separa stock oficial, detalle exacto y stock legado sin duplicarlo", () => {
  const result = buildFinishedInventory({
    products: [
      { id: "P1", nombre: "Momo", tipo: "momo", stock: 10, activo: true },
      { id: "P2", nombre: "Malteada", tipo: "pedido", stock: 99, activo: true },
    ],
    variantes: [
      { productId: "P1", figura: "Max", sabor: "Oreo", disponibles: 4 },
      { productId: "P1", figura: "Danna", sabor: "Coco", disponibles: 2 },
    ],
  });

  assert.equal(result.summary.available, 10);
  assert.equal(result.summary.exactAvailable, 6);
  assert.equal(result.summary.withoutVariantDetail, 4);
  assert.equal(result.products.length, 1);
});

test("cuenta solo reservas activas y lotes realmente en proceso", () => {
  const result = buildFinishedInventory({
    products: [{ id: "P1", tipo: "momo", stock: 3 }],
    inventory_reservations: [
      { id: "R1", tipo: "producto", estado: "Reservada", cantidad: 2 },
      { id: "R2", tipo: "producto", estado: "Consumida", cantidad: 5 },
      { id: "R3", tipo: "producto", estado: "Liberada", cantidad: 7 },
      { id: "R4", tipo: "insumo", estado: "Reservada", cantidad: 11 },
    ],
    production_batches: [
      { id: "L1", estado: "Congelando", prod: 20 },
      { id: "L2", estado: "Listo", prod: 30 },
    ],
  });

  assert.equal(result.summary.reserved, 2);
  assert.equal(result.reservations.length, 1);
  assert.equal(result.reservationHistory.length, 2);
  assert.equal(result.summary.inProcess, 20);
});

test("pone en cuarentena variantes vencidas y nunca promete más que el stock oficial", () => {
  const result = buildFinishedInventory({
    products: [{ id: "P1", nombre: "Momo", tipo: "momo", stock: 7, activo: true }],
    variantes: [
      { productId: "P1", figura: "Max", sabor: "Oreo", disponibles: 4, vence: "2026-07-13" },
      { productId: "P1", figura: "Danna", sabor: "Coco", disponibles: 5, vence: "2026-07-20" },
    ],
  }, { today: "2026-07-14" });

  assert.equal(result.summary.officialAvailable, 7);
  assert.equal(result.summary.available, 3);
  assert.equal(result.summary.exactAvailable, 0);
  assert.equal(result.summary.quarantined, 4);
  assert.equal(result.summary.reconciliationExcess, 2);
  assert.equal(result.summary.reconciliationBlocked, 5);
  assert.equal(result.variants.length, 0);
  assert.equal(result.quarantinedVariants[0].figura, "Max");
});

test("normaliza stock oficial negativo sin mostrar disponibilidad imposible", () => {
  const result = buildFinishedInventory({
    products: [{ id: "P1", nombre: "Momo", tipo: "momo", stock: -5, activo: true }],
  });

  assert.equal(result.summary.available, 0);
  assert.equal(result.summary.negativeStockProducts, 1);
});

test("distingue imperfectas pendientes, reaprovechadas y descartadas", () => {
  const result = buildFinishedInventory({
    products: [],
    production_batches: [
      { id: "L1", imperfectas: 3, descartadas: 1, destino: "—" },
      { id: "L2", imperfectas: 4, descartadas: 2, destino: "Insumo para malteadas" },
      { id: "L3", imperfectas: 0, descartadas: 5, destino: "—" },
    ],
  });

  assert.equal(result.summary.imperfectPending, 3);
  assert.equal(result.summary.imperfectReused, 4);
  assert.equal(result.summary.imperfectTotal, 7);
  assert.equal(result.summary.discarded, 8);
});
