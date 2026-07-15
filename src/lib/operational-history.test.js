import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOperationalHistory,
  isActiveClaim,
  isActiveDelivery,
  isActiveOrder,
  isActivePackingOrder,
  isActiveProductionBatch,
  isPackingHistoryOrder,
  partitionByActivity,
} from "./operational-history.js";

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
