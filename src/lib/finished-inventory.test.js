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

test("agrupa el stock terminado por figura y muestra todos sus sabores", () => {
  const result = buildFinishedInventory({
    products: [{ id: "P1", nombre: "Momo Gatito", tipo: "momo", stock: 9, activo: true }],
    variantes: [
      { productId: "P1", producto: "Momo Gatito", figura: "Lizi", sabor: "Limón", disponibles: 4, gramajeG: 150, vence: "2026-07-18" },
      { productId: "P1", producto: "Momo Gatito", figura: "Lizi", sabor: "Coco", disponibles: 2, gramajeG: 150, vence: "2026-07-17" },
      { productId: "P1", producto: "Momo Gatito", figura: "Momo", sabor: "Maracuyá", disponibles: 3, gramajeG: 180, vence: "2026-07-19" },
    ],
  }, { today: "2026-07-15" });

  const lizi = result.figureSummaries.find((figure) => figure.figura === "Lizi");
  assert.equal(lizi.available, 6);
  assert.deepEqual(lizi.flavors.map((flavor) => [flavor.sabor, flavor.available]), [["Limón", 4], ["Coco", 2]]);
  assert.equal(lizi.flavors[1].nextExpiration, "2026-07-17");
});

test("separa imperfectas por figura y cuenta las destinadas a malteadas", () => {
  const result = buildFinishedInventory({
    products: [],
    production_batches: [
      {
        id: "L1", sabor: "Oreo", imperfectas: 3, descartadas: 1,
        destino: "Insumo para malteadas y crepas",
        resultadosFiguras: [
          { figura: "Lizi", perfectas: 2, imperfectas: 1, descartadas: 0 },
          { figura: "Momo", perfectas: 1, imperfectas: 2, descartadas: 1 },
        ],
      },
      { id: "L2", sabor: "Coco", figura: "Lizi", imperfectas: 2, descartadas: 0, destino: "—" },
    ],
  });

  const lizi = result.figureSummaries.find((figure) => figure.figura === "Lizi");
  const momo = result.figureSummaries.find((figure) => figure.figura === "Momo");
  assert.equal(result.summary.imperfectForShakes, 3);
  assert.equal(lizi.imperfectForShakes, 1);
  assert.equal(lizi.imperfectPending, 2);
  assert.equal(momo.imperfectForShakes, 2);
  assert.equal(momo.discarded, 1);
});

test("un lote mixto legado no atribuye imperfectas a una figura inventada", () => {
  const result = buildFinishedInventory({
    products: [],
    production_batches: [{
      id: "L1", sabor: "Milo", imperfectas: 2, descartadas: 0, destino: "—",
      figuras: [{ figura: "Lizi", cant: 2 }, { figura: "Momo", cant: 2 }],
    }],
  });

  assert.equal(result.figureSummaries.length, 1);
  assert.equal(result.figureSummaries[0].figura, "Sin figura verificable");
  assert.equal(result.figureSummaries[0].imperfectPending, 2);
});
