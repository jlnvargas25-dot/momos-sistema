import test from "node:test";
import assert from "node:assert/strict";
import { buildAssistantControlCenter } from "./assistant-control-center.js";
import { MOMOS_ROLES } from "./user-roles.js";

function baseDb() {
  return {
    products: [], orders: [], order_items: [], customers: [], benefits: [], evidences: [],
    variantes: [], variantesCuarentena: [], inventory_items: [], inventory_lots: [],
    inventoryLotsReady: true, inventory_reservations: [], inventory_movements: [],
    production_suggestions: [], production_batches: [], subrecetas: [], figura_relleno: [],
    figuras: [], deliveries: [], claims: [], creative_results: [], order_dispatch_handoffs: [], settings: {},
  };
}

test("eleva una inconsistencia de integridad por encima de recomendaciones operativas", () => {
  const db = baseDb();
  db.products = [{ id: "P1", nombre: "Momo", tipo: "momo", stock: -1 }];
  const result = buildAssistantControlCenter(db, { today: "2026-07-15" });
  assert.equal(result.primary.area, "Control interno");
  assert.equal(result.primary.severity, "critical");
  assert.equal(result.primary.blocks, true);
  assert.equal(result.summary.health, "Bloqueado");
});

test("un comprobante pendiente tiene un solo responsable y no se duplica en Finanzas", () => {
  const db = baseDb();
  db.customers = [{ id: "C1", nombre: "Ana", telefono: "300", direccion: "Calle 1", barrio: "Caney" }];
  db.orders = [{ id: "P1", customerId: "C1", fecha: "2026-07-15", hora: "10:00", canal: "WhatsApp", estado: "Pendiente de pago", pago: "Nequi", direccion: "Calle 1", barrio: "Caney" }];
  db.products = [{ id: "PR1", nombre: "Malteada", tipo: "pedido", precio: 15000, costo: 5000 }];
  db.order_items = [{ id: "OI1", orderId: "P1", productId: "PR1", nombre: "Malteada", cant: 1, precio: 15000, costoUnitario: 5000 }];
  db.evidences = [{ id: "E1", orderId: "P1", tipo: "Comprobante de pago" }];
  const result = buildAssistantControlCenter(db, { today: "2026-07-15", now: "2026-07-15T10:10:00" });
  assert.equal(result.tasks.filter((row) => row.entityId === "P1" && /comprobante/i.test(`${row.title} ${row.detail}`)).length, 1);
  assert.equal(result.tasks.find((row) => row.id === "sales-P1").area, "Ventas y Recepción");
  assert.ok(!result.tasks.some((row) => row.id === "finance-verify-payment-P1"));
});

test("una sugerencia pagada ambigua queda bloqueada y nunca crea un lote inventado", () => {
  const db = baseDb();
  db.production_suggestions = [{ id: "S1", estado: "Pendiente", area: "Producción", cantidad: 2, orderId: "P1", producto: "Momo" }];
  const result = buildAssistantControlCenter(db, { today: "2026-07-15" });
  const gap = result.tasks.find((row) => row.id === "uncovered-suggestion-S1");
  assert.ok(gap);
  assert.equal(gap.blocks, true);
  assert.match(gap.nextAction, /no crear un lote ambiguo/i);
});

test("una variante incompleta muestra pedido y producto una sola vez", () => {
  const db = baseDb();
  db.customers = [{ id: "C1", nombre: "Ana", telefono: "300", direccion: "Calle 1", barrio: "Caney" }];
  db.products = [{ id: "PR1", nombre: "Momo Perrito", tipo: "momo", precio: 18000, costo: 7000 }];
  db.orders = [{ id: "P-77", customerId: "C1", fecha: "2026-07-15", hora: "10:00", canal: "WhatsApp", estado: "Confirmado", pago: "Nequi", direccion: "Calle 1", barrio: "Caney" }];
  db.order_items = [{ id: "IT15", orderId: "P-77", productId: "PR1", nombre: "Momo Perrito", cant: 2, precio: 18000 }];

  const result = buildAssistantControlCenter(db, { today: "2026-07-15" });
  const related = result.tasks.filter((row) => row.entityId === "P-77" && /figura|sabor|variante/i.test(`${row.title} ${row.detail}`));
  assert.equal(related.length, 1);
  assert.equal(related[0].module, "Pedidos");
  assert.match(related[0].title, /pedido P-77/i);
  assert.match(related[0].detail, /2× Momo Perrito/i);
  assert.match(related[0].nextAction, /abrir el pedido P-77/i);
});

test("una elaboración sin fórmula explica las dos decisiones válidas", () => {
  const db = baseDb();
  db.inventory_items = [{ id: "I06", nombre: "Mezcla de crepa", unidad: "L", stock: 0, min: 2, proveedor: "Producción propia" }];
  const result = buildAssistantControlCenter(db, { today: "2026-07-15" });
  const alert = result.tasks.find((row) => row.id === "internal-formula-I06");

  assert.ok(alert);
  assert.match(alert.detail, /0.*mínimo de 2.*no existe una fórmula/i);
  assert.match(alert.nextAction, /crear o activar su fórmula.*compra externa/i);
  assert.ok(alert.reasons.some((reason) => /ingredientes, costo ni rendimiento/i.test(reason)));
});

test("una recomendación exacta cubierta por Cocina no aparece como brecha", () => {
  const db = baseDb();
  db.products = [{ id: "PR1", nombre: "Momo Gatito", tipo: "momo", stock: 0, activo: true }];
  db.figuras = [{ nombre: "Lizi", productId: "PR1", gramajeG: 150, activo: true }];
  db.order_items = [{ id: "OI1", orderId: "P1", productId: "PR1", figura: "Lizi", sabor: "Limón", relleno: "Cheesecake", cant: 2 }];
  db.production_suggestions = [{ id: "S1", estado: "Pendiente", area: "Producción", cantidad: 2, orderId: "P1", orderItemId: "OI1", productId: "PR1" }];
  const result = buildAssistantControlCenter(db, { today: "2026-07-15" });
  assert.ok(result.tasks.some((row) => row.area === "Cocina" && /Limón/.test(row.title)));
  assert.ok(!result.tasks.some((row) => row.id === "uncovered-suggestion-S1"));
});

test("Empaque y Logística reciben tareas distintas según el relevo físico", () => {
  const db = baseDb();
  db.orders = [
    { id: "P1", fecha: "2026-07-15", hora: "10:00", estado: "Listo para empaque", pagadoEn: "2026-07-15 09:00" },
    { id: "P2", fecha: "2026-07-15", hora: "11:00", estado: "Listo para despacho", pagadoEn: "2026-07-15 09:30" },
  ];
  db.order_dispatch_handoffs = [{ orderId: "P2", status: "Ofrecido" }];
  const result = buildAssistantControlCenter(db, { today: "2026-07-15" });
  assert.equal(result.tasks.find((row) => row.id === "packing-P1").area, "Empaque");
  assert.equal(result.tasks.find((row) => row.id === "handoff-accept-P2").area, "Logística");
});

test("todas las recomendaciones conservan evidencia y confirmación humana", () => {
  const db = baseDb();
  db.inventory_items = [{ id: "I1", nombre: "Crema", unidad: "L", stock: 0, min: 2, costo: 10000, proveedor: "Proveedor" }];
  const result = buildAssistantControlCenter(db, { today: "2026-07-15" });
  const validModules = new Set(["Pedidos", "Producción", "Empaque", "Inventario", "Inventario terminado", "Historial operativo", "Finanzas"]);
  assert.ok(result.tasks.length > 0);
  result.tasks.forEach((row) => {
    assert.equal(row.confirmationRequired, true);
    assert.ok(row.reasons.length > 0);
    assert.ok(row.ownerRoles.length > 0);
    assert.ok(row.nextAction);
    assert.ok(validModules.has(row.module), `módulo inválido: ${row.module}`);
    row.ownerRoles.forEach((role) => assert.ok(MOMOS_ROLES.includes(role), `rol inválido: ${role}`));
  });
});
