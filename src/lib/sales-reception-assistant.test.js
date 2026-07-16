import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesReceptionAssistant } from "./sales-reception-assistant.js";

const product = { id: "PR-1", nombre: "Momo Perrito", tipo: "momo", atributos: ["figura", "sabor", "salsa"] };
const customer = { id: "C-1", nombre: "Ana", telefono: "3001234567", barrio: "Caney", direccion: "Calle 1", pedidos: 3, favoritos: "Oreo" };
const base = {
  products: [product], customers: [customer], benefits: [], evidences: [], variantes: [],
  orders: [], order_items: [], settings: { pedidoMinimo: 25000 },
};
const order = { id: "P-1", customerId: "C-1", fecha: "2026-07-15", hora: "10:00", canal: "WhatsApp", barrio: "Caney", direccion: "Calle 1", pago: "Nequi", estado: "Pendiente de pago", domCobrado: 5000 };
const item = { id: "OI-1", orderId: "P-1", productId: "PR-1", nombre: "Momo Perrito", cant: 2, precio: 18000, figura: "Max", sabor: "Oreo", salsa: "Maracuyá" };

test("un comprobante recibido se vuelve la primera tarea sin confirmar el pago automáticamente", () => {
  const result = buildSalesReceptionAssistant({ ...base, orders: [order], order_items: [item], evidences: [{ orderId: "P-1", tipo: "Comprobante de pago" }] }, { today: "2026-07-15", now: "2026-07-15T10:20:00" });
  assert.equal(result.queue[0].action, "Verificar comprobante y confirmar pago");
  assert.equal(result.queue[0].order.estado, "Pendiente de pago");
  assert.equal(result.summary.evidence, 1);
});

test("un pedido incompleto se bloquea antes de cobrar", () => {
  const incomplete = { ...order, id: "P-2", customerId: "C-2", estado: "Nuevo", direccion: "", pago: "" };
  const result = buildSalesReceptionAssistant({ ...base, customers: [{ id: "C-2", nombre: "", telefono: "" }], orders: [incomplete], order_items: [] }, { today: "2026-07-15" });
  assert.equal(result.queue[0].action, "Completar datos antes de cobrar");
  assert.ok(result.queue[0].missing.includes("productos"));
  assert.ok(result.queue[0].missing.includes("forma de pago"));
});

test("agrupa demanda exacta repetida y no promete stock insuficiente", () => {
  const result = buildSalesReceptionAssistant({
    ...base,
    orders: [order],
    order_items: [item, { ...item, id: "OI-2", cant: 2 }],
    variantes: [{ productId: "PR-1", figura: "Max", sabor: "Oreo", disponibles: 3, vence: "2026-07-18" }],
  }, { today: "2026-07-15" });
  assert.equal(result.queue[0].stock.status, "shortage");
  assert.equal(result.queue[0].stock.shortages[0].missing, 1);
});

test("muestra el beneficio como contexto y nunca lo aplica silenciosamente", () => {
  const result = buildSalesReceptionAssistant({
    ...base,
    orders: [order], order_items: [item],
    benefits: [{ customerId: "C-1", estado: "Activo", beneficio: "10%", minimo: 30000, vence: "2026-07-20" }],
  }, { today: "2026-07-15" });
  assert.match(result.queue[0].customerContext.join(" "), /beneficio activo para revisar/i);
  assert.equal(result.queue[0].order.benefitId, undefined);
});

test("pedidos pagados y etapas posteriores no vuelven a la cola de recepción", () => {
  const result = buildSalesReceptionAssistant({ ...base, orders: [{ ...order, estado: "Pagado", pagadoEn: "2026-07-15 10:10" }], order_items: [item] }, { today: "2026-07-15" });
  assert.equal(result.summary.attention, 0);
});
