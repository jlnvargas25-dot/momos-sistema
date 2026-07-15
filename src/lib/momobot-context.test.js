import test from "node:test";
import assert from "node:assert/strict";
import { momobotContextAnswer, momobotContextSnapshot } from "./momobot-context.js";

const catalogs = {
  orders: [
    { id: "P-1055", fecha: "2026-07-14", hora: "05:28", estado: "Pagado", customerId: "C1" },
    { id: "P-1056", fecha: "2026-07-14", hora: "06:03", estado: "Pagado", customerId: "C2" },
    { id: "P-1053", fecha: "2026-07-14", hora: "04:20", estado: "En producción", customerId: "C1" },
    { id: "P-1052", fecha: "2026-07-14", hora: "04:00", estado: "Listo para empaque", customerId: "C2" },
  ],
  orderItems: [
    { orderId: "P-1055", nombre: "Momo Perrito", cant: 1, figura: "Max", sabor: "Oreo" },
    { orderId: "P-1056", nombre: "Malteada", cant: 2, sabor: "Milo" },
    { orderId: "P-1053", nombre: "Momo Gatito", cant: 2, figura: "Lizi", sabor: "Coco" },
  ],
  customers: [{ id: "C1", nombre: "Ana" }, { id: "C2", nombre: "Lina" }],
  batches: [
    { id: "L-031", producto: "Momo Perrito", figura: "Max", sabor: "Oreo", prod: 20, perfectas: 0, imperfectas: 0, descartadas: 0, estado: "Congelando", inicioCongelacion: "2026-07-14 03:00", horasCongelacion: 10 },
    { id: "L-032", producto: "Momo Gatito", figura: "Lizi", sabor: "Coco", prod: 12, estado: "En preparación" },
  ],
  products: [{ id: "PR1", nombre: "Momo Perrito", tipo: "momo", stock: 16 }],
  inventory: [{ id: "I1", nombre: "Chocolate", stock: 2, min: 3, unidad: "kg" }],
  figures: ["Max", "Lizi"],
  flavors: ["Oreo", "Coco", "Milo"],
  variants: [{ productId: "PR1", producto: "Momo Perrito", figura: "Max", sabor: "Oreo", disponibles: 4, vence: "2026-07-28" }],
  suggestions: [{ id: "S1", producto: "Momo Perrito", cantidad: 3, orderId: "P-1056", estado: "Pendiente" }],
  auditLogs: [],
  delaySettings: { demoraCocinaMin: 15, demoraCocinaUrgenteMin: 30, demoraEmpaqueMin: 10, demoraEmpaqueUrgenteMin: 20, demoraRepeticionMin: 5 },
};

test("prioriza el pedido pagado más antiguo y explica qué hacer", () => {
  [
    "Oye Momobot, ¿qué hago ahora?",
    "¿Qué hay para hacer?",
    "¿Qué tenemos para preparar?",
    "¿Qué toca hacer?",
    "¿En qué trabajamos?",
    "¿Cuál es la siguiente tarea?",
  ].forEach((phrase) => {
    const answer = momobotContextAnswer(phrase, catalogs);
    assert.ok(answer, phrase);
    assert.match(answer.text, /P-1055/);
    assert.match(answer.text, /pagado más antiguo/);
    assert.equal(answer.memoryPatch.lastOrderId, "P-1055");
  });
});

test("responde cómo va un pedido con lenguaje natural", () => {
  const answer = momobotContextAnswer("¿Cómo va el pedido 1053?", catalogs);
  assert.match(answer.text, /En producción/);
  assert.match(answer.text, /Listo para empaque/);
  assert.match(answer.text, /2 unidades de Momo Gatito, sabor Coco, figura Lizi/i);
});

test("recuerda ese pedido para una pregunta de seguimiento", () => {
  const answer = momobotContextAnswer("¿Y qué sigue con ese pedido?", catalogs, { lastOrderId: "P-1053" });
  assert.match(answer.text, /P-1053/);
  assert.match(answer.text, /Listo para empaque/);
});

test("responde el estado y tiempo restante de un lote", () => {
  const now = new Date("2026-07-14T05:00:00-05:00").getTime();
  const answer = momobotContextAnswer("¿Cómo va el lote 31?", catalogs, {}, now);
  assert.match(answer.text, /Congelando/);
  assert.match(answer.text, /8 horas/);
  assert.equal(answer.memoryPatch.lastBatchId, "L-031");
});

test("recuerda el lote en la conversación", () => {
  const answer = momobotContextAnswer("¿Y cuánto le falta?", catalogs, { lastBatchId: "L-031" }, new Date("2026-07-14T12:30:00-05:00").getTime());
  assert.match(answer.text, /30 minutos/);
});

test("consulta stock exacto por figura y sabor", () => {
  const answer = momobotContextAnswer("¿Cuántos Max de Oreo tenemos?", catalogs);
  assert.match(answer.text, /4 unidades/);
  assert.match(answer.text, /2026-07-28/);
});

test("no promete stock agregado como variante exacta", () => {
  const answer = momobotContextAnswer("¿Cuánto stock de Momo Perrito tenemos?", catalogs);
  assert.match(answer.text, /16/);
  assert.match(answer.text, /total general/);
  assert.match(answer.text, /variante exacta/);
});

test("advierte insumos por debajo del mínimo", () => {
  const answer = momobotContextAnswer("¿Cuánto chocolate queda?", catalogs);
  assert.match(answer.text, /2 kg/);
  assert.match(answer.text, /reponerlo/);
});

test("entrega un resumen operativo con demoras y faltantes", () => {
  const answer = momobotContextAnswer("Momobot, ponme al día", catalogs, {}, new Date("2026-07-14T07:00:00-05:00").getTime());
  assert.match(answer.text, /2 pedidos pagados/);
  assert.match(answer.text, /1 faltante/);
  assert.match(answer.text, /2 lotes activos/);
});

test("explica los faltantes registrados", () => {
  const answer = momobotContextAnswer("¿Qué falta producir?", catalogs);
  assert.match(answer.text, /3 de Momo Perrito/);
  assert.match(answer.text, /P-1056/);
});

test("enumera lotes activos sin convertir la consulta en acción", () => {
  const answer = momobotContextAnswer("¿Qué lotes tenemos activos?", catalogs);
  assert.match(answer.text, /L-031/);
  assert.match(answer.text, /L-032/);
});

test("no intercepta una orden de escritura", () => {
  assert.equal(momobotContextAnswer("Prepara 5 Max de Oreo", catalogs), null);
  assert.equal(momobotContextAnswer("Congela el lote 31", catalogs), null);
  assert.equal(momobotContextAnswer("El lote 31 está listo", catalogs), null);
});

test("crea una foto operativa compacta para la interfaz", () => {
  const snapshot = momobotContextSnapshot(catalogs, new Date("2026-07-14T07:00:00-05:00").getTime());
  assert.deepEqual({ paid: snapshot.paid, kitchen: snapshot.kitchen, packing: snapshot.packing, activeLots: snapshot.activeLots, shortages: snapshot.shortages }, { paid: 2, kitchen: 1, packing: 1, activeLots: 2, shortages: 1 });
});
