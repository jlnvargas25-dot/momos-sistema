import test from "node:test";
import assert from "node:assert/strict";
import { buildCustomerCrm, crmCompleteness, customerOrderTotal } from "./customer-crm.js";

const db = {
  customers: [{ id: "C1", nombre: "Ana", telefono: "300", pedidos: 2, total: 90000, ultima: "2026-06-01" }],
  orders: [
    { id: "P1", customerId: "C1", fecha: "2026-05-01", estado: "Entregado", descuento: 2000, domCobrado: 5000 },
    { id: "P2", customerId: "C1", fecha: "2026-06-01", estado: "Entregado", descuento: 0, domCobrado: 0 },
  ],
  order_items: [
    { id: "I1", orderId: "P1", nombre: "Momo Perrito", figura: "Max", sabor: "Oreo", cant: 2, precio: 20000 },
    { id: "I2", orderId: "P2", nombre: "Momo Perrito", figura: "Max", sabor: "Oreo", cant: 1, precio: 20000 },
  ],
  benefits: [], customer_contacts: [], customer_activations: [], customer_crm_profiles: [],
};

test("calcula historial, gasto real y favorito automático", () => {
  const crm = buildCustomerCrm(db, "C1", "2026-07-14");
  assert.equal(crm.purchases, 2);
  assert.equal(crm.spend, 63000);
  assert.equal(crm.averageTicket, 31500);
  assert.equal(crm.firstPurchase, "2026-05-01");
  assert.equal(crm.lastPurchase, "2026-06-01");
  assert.deepEqual(crm.automaticFavorites[0], { label: "Max de Oreo", quantity: 3 });
  assert.equal(crm.nextAction.type, "reactivation");
});

test("respeta no contactar por encima de cualquier activación", () => {
  const crm = buildCustomerCrm({ ...db, customer_crm_profiles: [{ customerId: "C1", contactAllowed: false }] }, "C1", "2026-07-14");
  assert.equal(crm.nextAction.type, "blocked");
});

test("no cuenta pedidos cancelados como compras", () => {
  const onlyLead = { ...db, customers: [{ id: "C2", nombre: "Lead", pedidos: 0, total: 0 }], orders: [{ id: "PX", customerId: "C2", fecha: "2026-07-01", estado: "Cancelado" }], order_items: [] };
  assert.equal(buildCustomerCrm(onlyLead, "C2").nextAction.type, "lead");
});

test("total y completitud son deterministas", () => {
  assert.equal(customerOrderTotal(db, db.orders[0]), 43000);
  const crm = buildCustomerCrm({ ...db, customer_crm_profiles: [{ customerId: "C1", contactAllowed: true, acquisitionSource: "Instagram" }] }, "C1");
  assert.equal(crmCompleteness(crm), 57);
});
