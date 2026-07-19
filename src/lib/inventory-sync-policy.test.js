import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgeInventoryRealtimePending,
  enqueueInventoryRealtimeItem,
  inventoryCoreSnapshotBlockIsComplete,
  inventoryDeltaCanApply,
  inventoryProtectedCatalogCanApply,
} from "./inventory-sync-policy.js";
import { applyInventoryMutationEnvelope } from "./mutation-envelope.js";

function coreSnapshot(overrides = {}) {
  return {
    inventory_latest_event_id: "4611686018427388004",
    inventory_items: [{ id: "I-1" }],
    inventory_lots: [],
    inventory_movements: [{
      id: "M-1",
      fecha: "2026-07-19T20:00:00.000Z",
      tipo: "Entrada",
      item_id: "I-1",
      cant: 2,
      order_id: null,
      batch_id: null,
    }],
    inventory_audit_logs: [{
      id: "A-1",
      fecha: "2026-07-19T20:00:00.000Z",
      entidad: "Inventario",
      entidad_id: "I-1",
      accion: "Entrada",
    }],
    ...overrides,
  };
}

function itemDelta(version, stock, movementVersions = [version]) {
  return {
    contract: "momos.inventory-delta.v1",
    event_id: String(version),
    source_version: String(version),
    server_time: "2026-07-19T20:00:00.000Z",
    scope: "inventory_item",
    item: {
      id: "I-1", nombre: "Crema", cat: "Ingredientes", unidad: "L",
      stock, minimo: 1, costo: 10, proveedor: "", vence: "", ubicacion: "",
      compra: "", costo_estimado: false,
    },
    lots: [{
      id: "LOT-1", item_id: "I-1", source_movement_id: `M-${version}`,
      received_at: "2026-07-19", expires_at: "", initial_quantity: stock,
      available_quantity: stock, unit_cost: 10, supplier: "", location: "",
      origin: "Compra", created_at: "2026-07-19T20:00:00.000Z", status: "Vigente",
    }],
    movements: movementVersions.map((movementVersion, index) => ({
      id: `M-${movementVersion}`,
      fecha: `2026-07-19T20:0${index}:00.000Z`,
      tipo: "Entrada",
      item_id: "I-1",
      cant: 1,
      order_id: null,
      batch_id: null,
    })),
    audits: movementVersions.map((movementVersion, index) => ({
      id: `A-${movementVersion}`,
      fecha: `2026-07-19T20:0${index}:00.000Z`,
      entidad: "Inventario",
      entidad_id: "I-1",
      accion: "Entrada",
    })),
    reconciliation: {
      item_stock: stock,
      lots_available: stock,
      difference: 0,
      exact: true,
    },
  };
}

test("un cursor solo sella un snapshot core con los cuatro bloques completos y sanitizados", () => {
  assert.equal(inventoryCoreSnapshotBlockIsComplete(coreSnapshot()), true);

  for (const partial of [
    coreSnapshot({ inventory_lots: undefined }),
    coreSnapshot({ inventory_movements: undefined }),
    coreSnapshot({ inventory_audit_logs: undefined }),
    coreSnapshot({ inventory_latest_event_id: "" }),
    coreSnapshot({
      inventory_movements: [{
        id: "M-1", fecha: "fecha-invalida", tipo: "Entrada", item_id: "I-1",
        cant: 2, order_id: null, batch_id: null,
      }],
    }),
    coreSnapshot({
      inventory_movements: [{
        id: "M-1", fecha: "2026-07-19T20:00:00.000Z", tipo: "Entrada",
        item_id: "I-1", cant: 2, order_id: null,
      }],
    }),
    coreSnapshot({
      inventory_audit_logs: [{
        id: "A-1", fecha: "2026-07-19T20:00:00.000Z", entidad: "Inventario",
        entidad_id: "I-1", accion: "Entrada", user_id: "privado",
      }],
    }),
  ]) assert.equal(inventoryCoreSnapshotBlockIsComplete(partial), false);
});

test("fullSnapshotRequired bloquea deltas hasta aceptar un core completo de la generacion vigente", () => {
  assert.equal(inventoryDeltaCanApply({
    fullSnapshotRequired: true,
    expectedGeneration: 8,
    currentGeneration: 8,
  }), false);
  assert.equal(inventoryDeltaCanApply({
    fullSnapshotRequired: undefined,
    expectedGeneration: 8,
    currentGeneration: 8,
  }), false, "el guard debe fallar cerrado si el flag no existe");
  assert.equal(inventoryDeltaCanApply({
    fullSnapshotRequired: false,
    expectedGeneration: 7,
    currentGeneration: 8,
  }), false);
  assert.equal(inventoryDeltaCanApply({
    fullSnapshotRequired: false,
    expectedGeneration: 8,
    currentGeneration: 8,
  }), true);

  const catalog = {
    inventoryMutationDeltaReady: true,
    inventoryCoreSnapshotReady: true,
    inventoryMutationEventVersion: "4611686018427387946",
    inventory_items: [],
    inventory_lots: [],
    inventorySnapshotHistoryReady: true,
    inventorySnapshotMovements: [],
    inventorySnapshotAudits: [],
    __inventoryReadGeneration: 8,
  };
  assert.equal(inventoryProtectedCatalogCanApply(catalog, 8), true);
  assert.equal(inventoryProtectedCatalogCanApply({ ...catalog, inventoryCoreSnapshotReady: false }, 8), false);
  assert.equal(inventoryProtectedCatalogCanApply(catalog, 9), false);
});

test("la cola Realtime sobrevive relevos y solo confirma el marcador exacto ya conciliado", () => {
  const pending = new Map();
  enqueueInventoryRealtimeItem(pending, "I-1");
  const capturedBeforeViewChange = [...pending.entries()];

  // Un segundo evento llega mientras el nuevo efecto concilia el primero.
  const latestMarker = enqueueInventoryRealtimeItem(pending, "I-1");
  enqueueInventoryRealtimeItem(pending, "I-2");
  assert.equal(acknowledgeInventoryRealtimePending(pending, capturedBeforeViewChange), 0);
  assert.equal(pending.get("I-1"), latestMarker);

  const capturedAfterViewChange = [...pending.entries()];
  assert.equal(acknowledgeInventoryRealtimePending(pending, capturedAfterViewChange), 2);
  assert.equal(pending.size, 0);
});

test("A/B del mismo item converge con igualdad autoritativa y descarta respuestas de red viejas", () => {
  let generation = 10;
  let db = { inventory_items: [], inventory_lots: [], inventory_movements: [], audit_logs: [] };
  let versions = {};
  const capturedA = generation;
  const capturedB = generation;

  // B (101) confirma primero.
  assert.equal(inventoryDeltaCanApply({
    fullSnapshotRequired: false,
    expectedGeneration: capturedB,
    currentGeneration: generation,
  }), true);
  const b = applyInventoryMutationEnvelope(db, itemDelta(101, 1), versions);
  db = b.db;
  versions = b.versions;
  generation += 1;

  // La respuesta tardia de A fue leida en la generacion anterior y no gana.
  assert.equal(inventoryDeltaCanApply({
    fullSnapshotRequired: false,
    expectedGeneration: capturedA,
    currentGeneration: generation,
  }), false);

  // La reconciliacion actual combina A+B, pero conserva max sourceVersion=101.
  const reconciliationGeneration = generation;
  assert.equal(inventoryDeltaCanApply({
    fullSnapshotRequired: false,
    expectedGeneration: reconciliationGeneration,
    currentGeneration: generation,
  }), true);
  const combined = applyInventoryMutationEnvelope(
    db,
    itemDelta(101, 2, [100, 101]),
    versions,
    { authoritativeOnEqual: true },
  );
  assert.equal(combined.status, "applied");
  assert.equal(combined.db.inventory_items[0].stock, 2);
  assert.deepEqual(new Set(combined.db.inventory_movements.map((row) => row.id)), new Set(["M-100", "M-101"]));
  assert.equal(combined.db.inventory_movements.length, 2);
  assert.equal(combined.db.audit_logs.length, 2);
  generation += 1;

  // Incluso otra lectura autoritativa, iniciada antes de la convergencia, se descarta.
  assert.equal(inventoryDeltaCanApply({
    fullSnapshotRequired: false,
    expectedGeneration: reconciliationGeneration,
    currentGeneration: generation,
  }), false);
});
