import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesReceptionAssistant } from "./sales-reception-assistant.js";

const product = { id: "PR02", nombre: "Momo Perrito", cat: "Momos Signature", tipo: "momo", atributos: ["figura", "sabor", "salsa"] };
const customer = { id: "C-1", nombre: "Ana", telefono: "3001234567", barrio: "Caney", direccion: "Calle 1", pedidos: 3, favoritos: "Oreo" };
const base = {
  products: [product], customers: [customer], benefits: [], evidences: [], variantes: [],
  orders: [], order_items: [], settings: { pedidoMinimo: 25000 },
};
const order = { id: "P-1", customerId: "C-1", fecha: "2026-07-15", hora: "10:00", canal: "WhatsApp", barrio: "Caney", direccion: "Calle 1", pago: "Nequi", estado: "Pendiente de pago", domCobrado: 5000 };
const item = { id: "OI-1", orderId: "P-1", productId: "PR02", nombre: "Momo Perrito", cant: 2, precio: 18000, figura: "Max", sabor: "Oreo", salsa: "Maracuyá" };

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
    variantes: [{ productId: "PR02", figura: "Max", sabor: "Oreo", disponibles: 3, vence: "2026-07-18" }],
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

test("un cuchareable pide sabor y salsa, pero nunca una figura física", () => {
  const spoonable = { id: "PR-8", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "momo" };
  const spoonableItem = { id: "OI-8", orderId: "P-1", productId: "PR-8", nombre: spoonable.nombre, cant: 1, precio: 15000, sabor: "Coco", salsa: "Maracuyá", figura: "" };
  const result = buildSalesReceptionAssistant({ ...base, products: [spoonable], orders: [order], order_items: [spoonableItem] }, { today: "2026-07-15" });
  assert.equal(result.queue[0].missing.some((entry) => /figura/i.test(entry)), false);
  assert.equal(result.queue[0].stock.status, "not-applicable");
});

test("Ventas bloquea una familia que trae Gatito como si fuera figura física", () => {
  const invalid = { ...item, figura: "Gatito" };
  const result = buildSalesReceptionAssistant({ ...base, orders: [order], order_items: [invalid] }, { today: "2026-07-15" });
  assert.equal(result.queue[0].stock.status, "incomplete");
  assert.ok(result.queue[0].missing.some((entry) => /figura física válida/i.test(entry)));
});

test("Ventas bloquea un cruce canónico de figura y familia antes de consultar stock", () => {
  const crossed = { ...item, figura: "Lizi" };
  const result = buildSalesReceptionAssistant({
    ...base,
    orders: [order],
    order_items: [crossed],
    variantes: [{ productId: "PR02", figura: "Lizi", sabor: "Oreo", disponibles: 20, vence: "2026-07-18" }],
  }, { today: "2026-07-15" });
  assert.equal(result.queue[0].stock.status, "incomplete");
  assert.deepEqual(result.queue[0].stock.checks, []);
  assert.ok(result.queue[0].missing.some((entry) => /Lizi no corresponde.*Momo Perrito/i.test(entry)));
});

test("Ventas usa el vínculo figura-familia y nunca la especie como inferencia", () => {
  const result = buildSalesReceptionAssistant({
    ...base,
    products: [{ ...product, especie: "gato" }],
    orders: [order],
    order_items: [item],
    variantes: [{ productId: "PR02", figura: "Max", sabor: "Oreo", disponibles: 2, vence: "2026-07-18" }],
  }, { today: "2026-07-15" });
  assert.deepEqual(result.queue[0].missing, []);
  assert.equal(result.queue[0].stock.status, "available");
});

test("Ventas rechaza figuras físicas en elaboraciones al momento", () => {
  const madeToOrder = { id: "PR08", nombre: "Cheesecake Momo cuchareable", cat: "Momos Cuchara", tipo: "pedido" };
  const madeToOrderItem = {
    id: "OI-8", orderId: "P-1", productId: "PR08", nombre: madeToOrder.nombre,
    cant: 1, precio: 15000, sabor: "Coco", salsa: "Maracuyá", figura: "Max",
  };
  const result = buildSalesReceptionAssistant({
    ...base, products: [madeToOrder], orders: [order], order_items: [madeToOrderItem],
  }, { today: "2026-07-15" });
  assert.ok(result.queue[0].missing.some((entry) => /se prepara al momento y no admite figura física/i.test(entry)));
  assert.equal(result.queue[0].stock.status, "not-applicable");
});

test("Ventas mantiene la caja padre fuera del stock exacto y valida cada figura hija", () => {
  const cat = { id: "PR01", nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo" };
  const combo = { id: "PR05", nombre: "Caja x3 Momos", cat: "Cajas y Combos", tipo: "combo", componentProductIds: ["PR01"] };
  const parent = { id: "BOX", orderId: "P-1", productId: "PR05", nombre: combo.nombre, cant: 1, precio: 49000, esCaja: true, figura: "", sabor: "" };
  const child = { id: "CHILD", orderId: "P-1", parentItemId: "BOX", productId: "PR01", nombre: cat.nombre, cant: 1, precio: 0, esSubMomo: true, figura: "Momo", sabor: "Oreo", salsa: "Chocolate" };
  const result = buildSalesReceptionAssistant({
    ...base,
    products: [cat, combo],
    orders: [order],
    order_items: [parent, child],
    variantes: [{ productId: "PR01", figura: "Momo", sabor: "Oreo", disponibles: 1, vence: "2026-07-18" }],
  }, { today: "2026-07-15" });
  assert.deepEqual(result.queue[0].missing, []);
  assert.equal(result.queue[0].stock.status, "available");
  assert.equal(result.queue[0].stock.checks.length, 1);
  assert.equal(result.queue[0].total, 54000);
});

test("Ventas bloquea combos sueltos e hijas de familias no admitidas", () => {
  const cat = { id: "PR01", nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo" };
  const premium = { id: "PR04", nombre: "Momo premium", cat: "Momos Signature", tipo: "momo" };
  const combo = { id: "PR05", nombre: "Caja x3 Momos", cat: "Cajas y Combos", tipo: "combo", componentProductIds: ["PR01"] };
  const parent = { id: "BOX", orderId: "P-1", productId: "PR05", nombre: combo.nombre, cant: 1, precio: 49000, esCaja: true, figura: "", sabor: "" };
  const invalidChild = { id: "CHILD", orderId: "P-1", parentItemId: "BOX", productId: "PR04", nombre: premium.nombre, cant: 1, precio: 0, esSubMomo: true, figura: "Teo", sabor: "Oreo", salsa: "Chocolate" };
  const looseCombo = { ...parent, id: "LOOSE", esCaja: false };
  const result = buildSalesReceptionAssistant({
    ...base, products: [cat, premium, combo], orders: [order], order_items: [parent, invalidChild, looseCombo],
  }, { today: "2026-07-15" });
  assert.ok(result.queue[0].missing.some((entry) => /no pertenece a una caja compatible/i.test(entry)));
  assert.ok(result.queue[0].missing.some((entry) => /debe registrarse como caja con postres hijos/i.test(entry)));
  assert.equal(result.queue[0].stock.status, "incomplete");
});

test("Ventas no acepta una figura global heredada por la caja padre", () => {
  const cat = { id: "PR01", nombre: "Momo Gatito", cat: "Momos Signature", tipo: "momo" };
  const combo = { id: "PR05", nombre: "Caja x3 Momos", cat: "Cajas y Combos", tipo: "combo", componentProductIds: ["PR01"] };
  const parent = { id: "BOX", orderId: "P-1", productId: "PR05", nombre: combo.nombre, cant: 1, precio: 49000, esCaja: true, figura: "Momo", sabor: "Oreo" };
  const child = { id: "CHILD", orderId: "P-1", parentItemId: "BOX", productId: "PR01", nombre: cat.nombre, cant: 1, precio: 0, esSubMomo: true, figura: "Momo", sabor: "Oreo", salsa: "Chocolate" };
  const result = buildSalesReceptionAssistant({
    ...base,
    products: [cat, combo],
    orders: [order],
    order_items: [parent, child],
    variantes: [{ productId: "PR01", figura: "Momo", sabor: "Oreo", disponibles: 1, vence: "2026-07-18" }],
  }, { today: "2026-07-15" });
  assert.ok(result.queue[0].missing.some((entry) => /caja.*figura y sabor únicamente en sus postres hijos/i.test(entry)));
});
