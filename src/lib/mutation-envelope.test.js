import test from "node:test";
import assert from "node:assert/strict";
import {
  applyInventoryMutationEnvelope,
  InventoryMutationEnvelopeError,
  mergeInventoryAuditSnapshot,
  normalizeInventoryDeltaBatch,
  normalizeInventoryEventsEnvelope,
  normalizeInventoryMutationEnvelope,
} from "./mutation-envelope.js";

const delta = (overrides = {}) => ({
  contract: "momos.inventory-delta.v1",
  event_id: "184",
  source_version: "184",
  server_time: "2026-07-19T08:00:00.000Z",
  scope: "inventory_item",
  item: {
    id: "I01", nombre: "Crema de leche 1 L", cat: "Ingredientes", unidad: "L",
    stock: 3.1789, minimo: 2, costo: 11878.5, proveedor: "La Vaquita",
    vence: "2026-07-25", ubicacion: "Nevera 1", compra: "2026-07-19", costo_estimado: false,
  },
  lots: [{
    id: "IL-01", item_id: "I01", source_movement_id: "M184", received_at: "2026-07-19",
    expires_at: "2026-07-25", initial_quantity: 3.1789, available_quantity: 3.1789,
    unit_cost: 11878.5, supplier: "La Vaquita", location: "Nevera 1", origin: "Compra",
    created_at: "2026-07-19T08:00:00.000Z", status: "Vigente",
  }],
  movements: [{
    id: "M184", fecha: "2026-07-19T08:00:00.000Z", tipo: "Entrada", item_id: "I01",
    cant: 3.1789, order_id: null, batch_id: null,
  }],
  audits: [{
    id: "184", fecha: "2026-07-19T08:00:00.000Z", entidad: "Inventario", entidad_id: "I01", accion: "Entrada por lote",
  }],
  reconciliation: { item_stock: 3.1789, lots_available: 3.1789, difference: 0, exact: true },
  ...overrides,
});

const wrapper = (payload = delta()) => ({
  contract: "momos.inventory-mutation.v1",
  operation: "entrada_insumo_lote",
  idempotency_key: "d9428888-122b-11e1-b85c-61cd3cbb3210",
  duplicate: false,
  result: { ok: true, lot_id: "IL-01" },
  delta: payload,
});

const baseDb = () => {
  const unaffectedItem = { id: "I02", nombre: "Nutella" };
  const affectedItem = { id: "I01", nombre: "Crema anterior", stock: 0 };
  const unaffectedLot = { id: "IL-X", itemId: "I02", available: 2 };
  const oldLot = { id: "IL-OLD", itemId: "I01", available: 0 };
  const oldMovement = { id: "M100", fecha: "2026-07-18", tipo: "Entrada", item: "Nutella", cant: "+2 kg" };
  return {
    marker: { keep: true },
    inventory_items: [unaffectedItem, affectedItem],
    inventory_lots: [unaffectedLot, oldLot],
    inventory_movements: [oldMovement],
    audit_logs: [{ id: "100", fecha: "2026-07-18", entidad: "Inventario", entidadId: "I02", accion: "Entrada" }],
    refs: { unaffectedItem, affectedItem, unaffectedLot, oldLot, oldMovement },
  };
};

test("normaliza el wrapper H69 al shape React sin propagar receipt ni resultado opaco", () => {
  const normalized = normalizeInventoryMutationEnvelope(wrapper());
  assert.equal(normalized.contract, "momos.inventory-delta.v1");
  assert.equal(normalized.eventId, "184");
  assert.equal(normalized.sourceVersion, "184");
  assert.deepEqual(normalized.item, {
    id: "I01", nombre: "Crema de leche 1 L", cat: "Ingredientes", unidad: "L",
    stock: 3.1789, min: 2, costo: 11878.5, proveedor: "La Vaquita",
    vence: "2026-07-25", ubicacion: "Nevera 1", compra: "2026-07-19", costoEstimado: false,
  });
  assert.equal(normalized.lots[0].itemId, "I01");
  assert.equal(normalized.lots[0].itemName, "Crema de leche 1 L");
  assert.equal(normalized.lots[0].unit, "L");
  assert.equal(normalized.lots[0].available, 3.1789);
  assert.equal(normalized.lots[0].status, "Disponible");
  assert.deepEqual(normalized.movements[0], {
    id: "M184", fecha: "2026-07-19T08:00:00.000Z", tipo: "Entrada",
    item: "Crema de leche 1 L", cant: "+3.1789 L",
  });
  assert.equal(JSON.stringify(normalized).includes("idempotency_key"), false);
  assert.equal(JSON.stringify(normalized).includes("result"), false);
});

test("acepta el delta directo usado por reconciliaciones Realtime", () => {
  assert.equal(normalizeInventoryMutationEnvelope(delta()).itemId, "I01");
});

test("aplica solo el insumo, sus lotes, movimiento y auditoría preservando referencias ajenas", () => {
  const source = baseDb();
  const result = applyInventoryMutationEnvelope(source, wrapper(), { I02: "7" });
  assert.equal(result.status, "applied");
  assert.notEqual(result.db, source);
  assert.equal(source.inventory_items[1], source.refs.affectedItem);
  assert.equal(source.inventory_lots[1], source.refs.oldLot);
  assert.equal(result.db.marker, source.marker);
  assert.equal(result.db.inventory_items[0], source.refs.unaffectedItem);
  assert.equal(result.db.inventory_lots[0], source.refs.unaffectedLot);
  assert.equal(result.db.inventory_movements[1], source.refs.oldMovement);
  assert.equal(result.db.inventory_items[1].stock, 3.1789);
  assert.deepEqual(result.db.inventory_lots.map((lot) => lot.id), ["IL-X", "IL-01"]);
  assert.deepEqual(result.db.inventory_movements.map((movement) => movement.id), ["M184", "M100"]);
  assert.deepEqual(result.db.audit_logs.map((audit) => audit.id), ["184", "100"]);
  assert.deepEqual(result.versions, { I02: "7", I01: "184" });
});

test("ignora de forma idempotente eventos duplicados o atrasados", () => {
  const source = baseDb();
  for (const previous of ["184", "185", "999999999999999999999999999999999999"] ) {
    const versions = { I01: previous };
    const result = applyInventoryMutationEnvelope(source, delta(), versions);
    assert.equal(result.status, "stale");
    assert.equal(result.db, source);
    assert.equal(result.versions, versions);
  }
});

test("una lectura dirigida autoritativa reemplaza en igualdad y una version menor sigue stale", () => {
  const first = applyInventoryMutationEnvelope(baseDb(), delta(), {});
  const combined = delta({
    item: { ...delta().item, stock: 4 },
    lots: [{
      ...delta().lots[0], initial_quantity: 4, available_quantity: 4,
    }],
    movements: [
      delta().movements[0],
      {
        ...delta().movements[0],
        id: "M100-late",
        fecha: "2026-07-19T09:00:00.000Z",
        tipo: "Ajuste",
        cant: 0.8211,
      },
    ],
    audits: [
      delta().audits[0],
      {
        ...delta().audits[0],
        id: "100-late",
        fecha: "2026-07-19T09:00:00.000Z",
        accion: "Ajuste tardio combinado",
      },
    ],
    reconciliation: { item_stock: 4, lots_available: 4, difference: 0, exact: true },
  });

  const duplicate = applyInventoryMutationEnvelope(first.db, combined, first.versions);
  assert.equal(duplicate.status, "stale",
    "una respuesta mutante repetida conserva la monotonicidad anterior");

  const authoritative = applyInventoryMutationEnvelope(
    first.db,
    combined,
    first.versions,
    { authoritativeOnEqual: true },
  );
  assert.equal(authoritative.status, "applied");
  assert.equal(authoritative.db.inventory_items.find((item) => item.id === "I01").stock, 4);
  assert.equal(authoritative.db.inventory_movements.filter((row) => row.id === "M184").length, 1);
  assert.equal(authoritative.db.inventory_movements.filter((row) => row.id === "M100-late").length, 1);

  const replay = applyInventoryMutationEnvelope(
    authoritative.db,
    combined,
    authoritative.versions,
    { authoritativeOnEqual: true },
  );
  assert.equal(replay.db.inventory_movements.filter((row) => row.id === "M184").length, 1);
  assert.equal(replay.db.inventory_movements.filter((row) => row.id === "M100-late").length, 1);
  assert.equal(replay.db.audit_logs.filter((row) => row.id === "184").length, 1);
  assert.equal(replay.db.audit_logs.filter((row) => row.id === "100-late").length, 1);

  const older = delta({ event_id: "183", source_version: "183" });
  assert.equal(applyInventoryMutationEnvelope(
    replay.db,
    older,
    replay.versions,
    { authoritativeOnEqual: true },
  ).status, "stale");
});

test("soporta Map como registro monotónico sin mutarlo", () => {
  const versions = new Map([["I01", "183"]]);
  const result = applyInventoryMutationEnvelope(baseDb(), delta(), versions);
  assert.equal(result.status, "applied");
  assert.equal(versions.get("I01"), "183");
  assert.equal(result.versions.get("I01"), "184");
});

test("rechaza contratos abiertos, PII y secretos antes de tocar React", () => {
  const cases = [
    { ...delta(), extra: true },
    { ...delta(), item: { ...delta().item, telefono: "3000000000" } },
    wrapper({ ...delta(), reconciliation: { ...delta().reconciliation, token: "secret" } }),
    { ...wrapper(), result: { ok: true, service_role_key: "secret" } },
  ];
  for (const payload of cases) {
    assert.throws(() => normalizeInventoryMutationEnvelope(payload), InventoryMutationEnvelopeError);
  }
});

test("rechaza versiones ambiguas, no monotónicas o desacopladas", () => {
  for (const payload of [
    delta({ event_id: "0184" }),
    delta({ event_id: 184 }),
    delta({ source_version: "183" }),
    delta({ event_id: "0", source_version: "0" }),
  ]) assert.throws(() => normalizeInventoryMutationEnvelope(payload), { name: "InventoryMutationEnvelopeError" });
  assert.throws(() => applyInventoryMutationEnvelope(baseDb(), delta(), { I01: 183 }), /registro local/i);
});

test("rechaza lotes cruzados, duplicados, negativos o con saldo mayor al inicial", () => {
  const lot = delta().lots[0];
  const cases = [
    delta({ lots: [{ ...lot, item_id: "I02" }] }),
    delta({ lots: [lot, lot], reconciliation: { ...delta().reconciliation, lots_available: 6.3578 } }),
    delta({ lots: [{ ...lot, available_quantity: -1 }] }),
    delta({ lots: [{ ...lot, initial_quantity: 2 }] }),
  ];
  for (const payload of cases) assert.throws(() => normalizeInventoryMutationEnvelope(payload), InventoryMutationEnvelopeError);
});

test("falla cerrado ante NaN, Infinity, booleanos o movimientos cero", () => {
  for (const stock of [NaN, Infinity, -1, true, "1 unidad"]) {
    assert.throws(() => normalizeInventoryMutationEnvelope(delta({ item: { ...delta().item, stock } })), InventoryMutationEnvelopeError);
  }
  assert.throws(() => normalizeInventoryMutationEnvelope(delta({
    movements: [{ ...delta().movements[0], cant: 0 }],
  })), InventoryMutationEnvelopeError);
  assert.throws(() => normalizeInventoryMutationEnvelope(delta({
    item: { ...delta().item, costo_estimado: "false" },
  })), InventoryMutationEnvelopeError);
});

test("exige reconciliación exacta entre item, suma de lotes y sello del servidor", () => {
  const cases = [
    delta({ reconciliation: { ...delta().reconciliation, exact: false } }),
    delta({ reconciliation: { ...delta().reconciliation, difference: 0.0001 } }),
    delta({ reconciliation: { ...delta().reconciliation, item_stock: 3 } }),
    delta({ reconciliation: { ...delta().reconciliation, lots_available: 3 } }),
    delta({ lots: [{ ...delta().lots[0], available_quantity: 3 }] }),
  ];
  for (const payload of cases) assert.throws(() => normalizeInventoryMutationEnvelope(payload), /reconcil/i);
});

test("tolera únicamente ruido numérico subnanométrico y lo normaliza a cero", () => {
  const payload = delta({ reconciliation: { ...delta().reconciliation, difference: 5e-10 } });
  assert.equal(normalizeInventoryMutationEnvelope(payload).reconciliation.difference, 0);
});

test("rechaza auditorías o movimientos de otro insumo y fusiona solo la auditoría sanitizada", () => {
  assert.throws(() => normalizeInventoryMutationEnvelope(delta({
    movements: [{ ...delta().movements[0], item_id: "I02" }],
  })), /insumo/i);
  assert.throws(() => normalizeInventoryMutationEnvelope(delta({
    audits: [{ ...delta().audits[0], entidad_id: "I02" }],
  })), /insumo/i);
  assert.throws(() => normalizeInventoryMutationEnvelope(delta({
    audits: [{ ...delta().audits[0], entidad: "Pedido" }],
  })), /Inventario/i);
  const applied = applyInventoryMutationEnvelope(baseDb(), delta());
  assert.deepEqual(applied.db.audit_logs[0], {
    id: "184", fecha: "2026-07-19T08:00:00.000Z", entidad: "Inventario",
    entidadId: "I01", accion: "Entrada por lote",
  });
});

test("fusiona por id el último movimiento sin duplicarlo", () => {
  const source = baseDb();
  source.inventory_movements = [{ id: "M184", fecha: "vieja", tipo: "Entrada", item: "Crema", cant: "+1 L" }, source.refs.oldMovement];
  const result = applyInventoryMutationEnvelope(source, delta());
  assert.equal(result.db.inventory_movements.filter((row) => row.id === "M184").length, 1);
  assert.equal(result.db.inventory_movements[0].cant, "+3.1789 L");
  assert.equal(result.db.inventory_movements[1], source.refs.oldMovement);
});

test("conserva una ráfaga reciente completa, ordenada y sin IDs duplicados", () => {
  const recentMovements = [
    delta().movements[0],
    {
      ...delta().movements[0],
      id: "M183",
      fecha: "2026-07-19T07:59:00.000Z",
      tipo: "Ajuste",
      cant: -0.25,
    },
  ];
  const recentAudits = [
    delta().audits[0],
    {
      ...delta().audits[0],
      id: "183",
      fecha: "2026-07-19T07:59:00.000Z",
      accion: "Ajuste de inventario",
    },
  ];
  const result = applyInventoryMutationEnvelope(baseDb(), delta({
    movements: recentMovements,
    audits: recentAudits,
  }));
  assert.deepEqual(result.db.inventory_movements.map((movement) => movement.id), ["M184", "M183", "M100"]);
  assert.deepEqual(result.db.audit_logs.map((audit) => audit.id), ["184", "183", "100"]);

  assert.throws(() => normalizeInventoryMutationEnvelope(delta({
    movements: [recentMovements[0], { ...recentMovements[0] }],
  })), /duplicados/i);
  assert.throws(() => normalizeInventoryMutationEnvelope(delta({
    audits: [recentAudits[0], { ...recentAudits[0] }],
  })), /duplicad/i);
  assert.throws(() => normalizeInventoryMutationEnvelope(delta({
    movements: Array.from({ length: 51 }, (_, index) => ({
      ...recentMovements[0],
      id: `M-${index}`,
    })),
  })), /máximo 50/i);
});

test("un delta dirigido viejo de otro insumo no desplaza filas globalmente más recientes", () => {
  const first = applyInventoryMutationEnvelope(baseDb(), delta());
  const olderOtherItem = delta({
    event_id: "200",
    source_version: "200",
    server_time: "2026-07-19T08:05:00.000Z",
    item: { ...delta().item, id: "I02", nombre: "Nutella 3 kg", stock: 1 },
    lots: [{
      ...delta().lots[0], id: "IL-02", item_id: "I02", available_quantity: 1,
      initial_quantity: 1,
    }],
    movements: [{
      ...delta().movements[0], id: "M200", item_id: "I02",
      fecha: "2026-07-19T07:00:00.000Z", cant: 1,
    }],
    audits: [{
      ...delta().audits[0], id: "200", entidad_id: "I02",
      fecha: "2026-07-19T07:00:00.000Z",
    }],
    reconciliation: { item_stock: 1, lots_available: 1, difference: 0, exact: true },
  });
  const second = applyInventoryMutationEnvelope(first.db, olderOtherItem, first.versions);

  assert.deepEqual(second.db.inventory_movements.map((row) => row.id), ["M184", "M200", "M100"]);
  assert.deepEqual(second.db.audit_logs.map((row) => row.id), ["184", "200", "100"]);
});

test("fusiona fechas snapshot locales e ISO por instante sin reescribir el texto", () => {
  const source = baseDb();
  source.inventory_movements = [{
    id: "snapshot-late",
    fecha: "2026-07-19 23:00",
    tipo: "Entrada",
    item: "Nutella",
    cant: "+1 kg",
  }];
  source.audit_logs = [{
    id: "non-inventory",
    fecha: "2026-07-19 23:30",
    entidad: "Pedido",
    entidadId: "P-1",
    accion: "Entregado",
  }];
  const result = applyInventoryMutationEnvelope(source, delta(), {});

  assert.deepEqual(result.db.inventory_movements.map((row) => row.id), ["snapshot-late", "M184"]);
  assert.equal(result.db.inventory_movements[0].fecha, "2026-07-19 23:00");
  assert.equal(result.db.inventory_movements[1].fecha, "2026-07-19T08:00:00.000Z");
  assert.equal(result.db.audit_logs.some((row) => row.id === "non-inventory"), true);
});

test("un snapshot reemplaza solo auditorias de Inventario y preserva las demas", () => {
  const nonInventory = Array.from({ length: 60 }, (_, index) => ({
    id: `pedido-${index}`,
    fecha: `2026-07-18 10:${String(index % 60).padStart(2, "0")}`,
    entidad: "Pedido",
    entidadId: `P-${index}`,
    accion: "Cambio",
  }));
  const merged = mergeInventoryAuditSnapshot([
    ...nonInventory,
    { id: "old-inventory", fecha: "2026-07-19 09:00", entidad: "Inventario", entidadId: "I-1", accion: "Vieja" },
  ], [
    { id: "new-inventory", fecha: "2026-07-19T20:00:00.000Z", entidad: "Inventario", entidadId: "I-1", accion: "Nueva" },
  ]);

  assert.equal(merged.filter((row) => row.entidad === "Pedido").length, 60);
  assert.equal(merged.some((row) => row.id === "old-inventory"), false);
  assert.equal(merged.some((row) => row.id === "new-inventory"), true);
});

test("valida batch dirigido cerrado y mantiene separado el cursor global de versiones por item", () => {
  const taggedCursor = "4611686018427388027";
  const second = delta({
    event_id: "9007199254740993123",
    source_version: "9007199254740993123",
    item: { ...delta().item, id: "I02", nombre: "Nutella" },
    lots: [{ ...delta().lots[0], id: "IL-02", item_id: "I02" }],
    movements: [{ ...delta().movements[0], id: "M200", item_id: "I02" }],
    audits: [{ ...delta().audits[0], id: "200", entidad_id: "I02" }],
  });
  const result = normalizeInventoryDeltaBatch({
    contract: "momos.inventory-delta-batch.v1",
    latest_event_id: taggedCursor,
    items: [delta(), second],
  });
  assert.equal(result.latestEventId, taggedCursor);
  assert.deepEqual(result.items.map((item) => item.itemId), ["I01", "I02"]);
  assert.throws(() => normalizeInventoryDeltaBatch({
    contract: "momos.inventory-delta-batch.v1", latest_event_id: "184", items: [delta()], server_time: "extra",
  }), /claves cerrado/i);
  assert.equal(normalizeInventoryDeltaBatch({
    contract: "momos.inventory-delta-batch.v1", latest_event_id: "4611686018427387911", items: [second],
  }).latestEventId, "4611686018427387911",
  "safe-xmin tagged es opaco y nunca se compara con source_version");
  assert.throws(() => normalizeInventoryDeltaBatch({
    contract: "momos.inventory-delta-batch.v1", latest_event_id: "184", items: [delta(), delta()],
  }), /repetidos/i);
});

test("valida el cursor mínimo de gaps Realtime y rechaza PII o páginas incoherentes", () => {
  const latest = "4611686018427388109";
  const previous = "4611686018427388104";
  const ahead = "4611686018427388110";
  assert.deepEqual(normalizeInventoryEventsEnvelope({
    contract: "momos.inventory-events.v1",
    latest_event_id: latest,
    next_event_id: previous,
    overflow: true,
    item_ids: ["I01", "I02"],
  }), {
    contract: "momos.inventory-events.v1",
    latestEventId: latest,
    nextEventId: previous,
    overflow: true,
    itemIds: ["I01", "I02"],
    resetRequired: false,
  });
  assert.equal(normalizeInventoryEventsEnvelope({
    contract: "momos.inventory-events.v1",
    latest_event_id: latest,
    next_event_id: ahead,
    overflow: true,
    item_ids: [],
  }).resetRequired, true);
  for (const payload of [
    { contract: "momos.inventory-events.v1", latest_event_id: latest, next_event_id: ahead, overflow: true, item_ids: ["I01"] },
    { contract: "momos.inventory-events.v1", latest_event_id: latest, next_event_id: previous, overflow: false, item_ids: [] },
    { contract: "momos.inventory-events.v1", latest_event_id: latest, next_event_id: latest, overflow: false, item_ids: ["I01", "I01"] },
    { contract: "momos.inventory-events.v1", latest_event_id: latest, next_event_id: latest, overflow: false, item_ids: [], telefono: "PII" },
  ]) assert.throws(() => normalizeInventoryEventsEnvelope(payload), InventoryMutationEnvelopeError);
});
