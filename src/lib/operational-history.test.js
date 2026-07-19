import test from "node:test";
import assert from "node:assert/strict";
import {
  buildActiveReservationDashboard,
  buildInventoryHistory,
  buildOperationalHistory,
  isActiveClaim,
  isActiveDelivery,
  isActiveInventoryReservation,
  isActiveOrder,
  isActivePackingOrder,
  isActiveProductionBatch,
  isPackingHistoryOrder,
  partitionByActivity,
} from "./operational-history.js";

test("Reservas vigentes se agrupan por pedido y revelan antigüedad y origen físico", () => {
  const dashboard = buildActiveReservationDashboard({
    customers: [{ id: "C-1", nombre: "Mamá Momo" }],
    orders: [
      { id: "P-1", customerId: "C-1", estado: "En producción" },
      { id: "P-2", customerId: "C-1", estado: "Entregado" },
    ],
    inventory_reservations: [
      { id: "R-1", orderId: "P-1", estado: "Reservada", tipo: "producto", nombre: "Momo Perrito", cantidad: 1, fecha: "2026-07-15 10:00", batchId: "L-1", figuraLote: "Max" },
      { id: "R-2", orderId: "P-1", estado: "Reservada", tipo: "insumo", nombre: "Caja x3", cantidad: 1, fecha: "2026-07-15 10:00" },
      { id: "R-3", orderId: "P-2", estado: "Reservada", tipo: "producto", nombre: "Momo Gatito", cantidad: 2, fecha: "2026-07-14 10:00" },
      { id: "R-4", orderId: "P-1", estado: "Consumida", tipo: "producto", nombre: "No activa", cantidad: 99, fecha: "2026-07-15 11:00" },
    ],
  }, "2026-07-15 15:00");
  assert.equal(dashboard.summary.reservations, 3);
  assert.equal(dashboard.summary.orders, 2);
  assert.equal(dashboard.summary.quantity, 4);
  assert.equal(dashboard.summary.exact, 1);
  assert.equal(dashboard.groups.find((group) => group.orderId === "P-1").rows.length, 2);
  assert.equal(dashboard.reservations.find((row) => row.id === "R-1").sourceLabel, "Lote L-1 · Max");
  assert.equal(dashboard.reservations.find((row) => row.id === "R-3").attention, true);
  assert.match(dashboard.reservations.find((row) => row.id === "R-3").attentionReasons.join(" "), /entregado/);
});

test("Inventario separa reservas vigentes del historial sin perder trazabilidad", () => {
  const reservations = [
    { id: "R-1", estado: "Reservada" },
    { id: "R-2", estado: "Consumida" },
    { id: "R-3", estado: "Liberada" },
  ];
  const buckets = partitionByActivity(reservations, isActiveInventoryReservation);
  assert.deepEqual(buckets.active.map((row) => row.id), ["R-1"]);
  assert.deepEqual(buckets.history.map((row) => row.id), ["R-2", "R-3"]);
  assert.equal(buckets.active.length + buckets.history.length, reservations.length);
});

test("el historial de Inventario une movimientos y reservas cerradas en orden reciente", () => {
  const rows = buildInventoryHistory({
    inventory_movements: [
      { id: "M-1", fecha: "2026-07-14 09:00", tipo: "Entrada", item: "Crema", cant: 2, nota: "Compra" },
      { id: "M-2", fecha: "2026-07-14 11:00", tipo: "Uso en producción", item: "Crema", cant: "-0.5 L", nota: "Lote L-1" },
    ],
    inventory_reservations: [
      { id: "R-1", fecha: "2026-07-14 10:00", estado: "Reservada", nombre: "Vaso", cantidad: 1, orderId: "P-1" },
      { id: "R-2", fecha: "2026-07-14 10:30", estado: "Consumida", nombre: "Vaso", cantidad: 1, orderId: "P-2" },
    ],
  });
  assert.deepEqual(rows.map((row) => row.id), ["movement:M-2", "reservation:R-2", "movement:M-1"]);
  assert.equal(rows.some((row) => row.id === "reservation:R-1"), false);
  assert.equal(rows[1].orderId, "P-2");
  assert.equal(rows[1].status, "Consumida");
  assert.equal(rows[0].quantity, -0.5);
  assert.equal(rows[0].quantityLabel, "-0.5 L");
});

test("el historial ordena cronologicamente formatos snapshot local e ISO sin cambiar su presentacion", () => {
  const snapshotDate = "2026-07-19 23:00";
  const deltaDate = "2026-07-19T08:00:00.000Z";
  const rows = buildInventoryHistory({
    inventory_movements: [
      { id: "snapshot", fecha: snapshotDate, tipo: "Entrada", item: "Crema", cant: "+1 L" },
      { id: "delta", fecha: deltaDate, tipo: "Ajuste", item: "Crema", cant: "-1 L" },
    ],
  });

  assert.deepEqual(rows.map((row) => row.id), ["movement:snapshot", "movement:delta"]);
  assert.deepEqual(rows.map((row) => row.at), [snapshotDate, deltaDate],
    "la normalizacion no debe alterar el texto mostrado");
});

test("las bandejas activas y los historiales no pierden ni duplican registros", () => {
  const orders = [
    { id: "P-1", estado: "Pagado" },
    { id: "P-2", estado: "En ruta" },
    { id: "P-3", estado: "Entregado" },
    { id: "P-4", estado: "Cancelado" },
  ];
  const result = partitionByActivity(orders, isActiveOrder);
  assert.deepEqual(result.active.map((row) => row.id), ["P-1", "P-2"]);
  assert.deepEqual(result.history.map((row) => row.id), ["P-3", "P-4"]);
  assert.equal(result.active.length + result.history.length, orders.length);
  assert.equal(result.active.some((row) => result.history.includes(row)), false);
});

test("cada área conserva únicamente trabajo accionable en su bandeja", () => {
  assert.equal(isActiveProductionBatch({ estado: "En preparación" }), true);
  assert.equal(isActiveProductionBatch({ estado: "Congelando" }), true);
  assert.equal(isActiveProductionBatch({ estado: "Listo" }), false);
  assert.equal(isActivePackingOrder({ estado: "Listo para empaque" }), true);
  assert.equal(isActivePackingOrder({ estado: "Empacado" }), true);
  assert.equal(isActivePackingOrder({ estado: "Listo para despacho" }), false);
  assert.equal(isActiveDelivery({ estado: "Problema" }), true);
  assert.equal(isActiveDelivery({ estado: "Entregado" }), false);
  assert.equal(isActiveClaim({ estado: "Aprobado" }), true);
  assert.equal(isActiveClaim({ estado: "Compensado" }), false);
});

test("Empaque archiva solo pedidos que llegaron al área", () => {
  const db = {
    packing_verifications: [{ orderId: "P-9" }],
    audit_logs: [{ entidadId: "P-8", de: "Listo para empaque", a: "Empacado" }],
  };
  assert.equal(isPackingHistoryOrder({ id: "P-7", estado: "Entregado" }, db), true);
  assert.equal(isPackingHistoryOrder({ id: "P-8", estado: "Cancelado" }, db), true);
  assert.equal(isPackingHistoryOrder({ id: "P-9", estado: "Cancelado" }, db), true);
  assert.equal(isPackingHistoryOrder({ id: "P-10", estado: "Cancelado" }, db), false);
});

test("el historial central ordena, identifica área y conserva responsable y transición", () => {
  const rows = buildOperationalHistory({ audit_logs: [
    { id: "A-1", fecha: "2026-07-14 09:00", user: "Cocina", entidad: "Lote", entidadId: "L-1", accion: "Cambio de estado", de: "Congelando", a: "Listo" },
    { id: "A-2", fecha: "2026-07-14 10:00", user: "Logística", entidad: "Domicilio", entidadId: "D-1", accion: "Entrega confirmada", de: "En ruta", a: "Entregado" },
  ] });
  assert.deepEqual(rows.map((row) => row.id), ["A-2", "A-1"]);
  assert.equal(rows[0].area, "Domicilios");
  assert.equal(rows[1].area, "Producción");
  assert.equal(rows[1].actor, "Cocina");
  assert.equal(rows[1].from, "Congelando");
  assert.equal(rows[1].to, "Listo");
});
