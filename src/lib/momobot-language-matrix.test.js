import test from "node:test";
import assert from "node:assert/strict";
import { kitchenVocabularyPhrases, normalizeKitchenVoice, parseKitchenVoice } from "./kitchen-voice.js";
import { momobotContextAnswer } from "./momobot-context.js";

const catalogs = {
  flavors: ["Coco", "Limón", "Oreo", "Milo", "Maracuyá", "Caramelo salado"],
  figures: ["Lizi", "Toby", "Max", "Rocco", "Danna"].map((nombre) => ({ id: `F-${nombre}`, nombre })),
  subrecipes: [
    { id: "SR-GAN", nombre: "Ganache de chocolate", tipo: "ganache", mermaPct: 0 },
    { id: "SR-CH", nombre: "Cheesecake", tipo: "cheesecake", mermaPct: 0 },
    { id: "SR-SA", nombre: "Salsa maracuyá", tipo: "salsa", sabor: "Maracuyá", mermaPct: 5 },
    { id: "SR-MO", nombre: "Mousse Oreo", tipo: "mousse_cremosa", sabor: "Oreo", mermaPct: 5 },
    { id: "SR-MM", nombre: "Mousse Milo", tipo: "mousse_cremosa", sabor: "Milo", mermaPct: 5 },
    { id: "SR-MC", nombre: "Mousse Coco", tipo: "mousse_frutal", sabor: "Coco", mermaPct: 5 },
    { id: "SR-MCS", nombre: "Mousse Caramelo salado", tipo: "mousse_cremosa", sabor: "Caramelo salado", mermaPct: 5 },
  ],
  products: [
    { id: "PR-MAL", nombre: "Malteada Oreo Momo", tipo: "pedido", activo: true },
    { id: "PR-MOMO", nombre: "Momo Perrito", tipo: "momo", activo: true, stock: 12 },
  ],
  customers: [{ id: "C-1", nombre: "Ana" }],
  orders: [
    { id: "P-1046", customerId: "C-1", estado: "Pagado", fecha: "2026-07-15", hora: "08:00" },
    { id: "P-1048", customerId: "C-1", estado: "En producción", fecha: "2026-07-15", hora: "08:10" },
  ],
  orderItems: [
    { id: "OI-1", orderId: "P-1046", productId: "PR-MAL", cant: 2 },
    { id: "OI-2", orderId: "P-1048", productId: "PR-MOMO", nombre: "Momo Perrito", cant: 1, figura: "Max", sabor: "Oreo" },
  ],
  batches: [
    { id: "L-030", estado: "En preparación", producto: "Momo Perrito", prod: 4, figuras: [{ figura: "Max", cant: 4 }] },
    { id: "L-031", estado: "Congelando", producto: "Momo Perrito", prod: 5, figuras: [{ figura: "Lizi", cant: 5 }] },
  ],
  inventory: [
    { id: "I-1", nombre: "Crema de leche 1 L", stock: 3, min: 5, unidad: "L", vence: "2026-07-17" },
    { id: "I-2", nombre: "Ganache de chocolate", stock: 0.4, min: 0.2, unidad: "kg", vence: "2026-07-14" },
  ],
  inventoryLots: [
    { id: "IL-1", itemId: "I-1", itemName: "Crema de leche 1 L", available: 3, unit: "L", expiresAt: "2026-07-17" },
    { id: "IL-2", itemId: "I-2", itemName: "Ganache de chocolate", available: 0.4, unit: "kg", expiresAt: "2026-07-14" },
  ],
  variants: [{ producto: "Momo Perrito", figura: "Max", sabor: "Oreo", disponibles: 4, vence: "2026-07-18" }],
  suggestions: [],
  auditLogs: [],
};

test("normaliza cantidades naturales de cocina, incluidas fracciones de kilo", () => {
  assert.equal(normalizeKitchenVoice("medio kilo de cheesecake"), "0.5 kilos de cheesecake");
  assert.equal(normalizeKitchenVoice("un kilo y medio de ganache"), "1.5 kilos de ganache");
  assert.equal(normalizeKitchenVoice("un cuarto de kilo de mousse"), "0.25 kilos de mousse");
  assert.equal(normalizeKitchenVoice("tres cuartos de kilo de salsa"), "0.75 kilos de salsa");
});

test("prioriza nombres vivos de MOMOS dentro del límite nativo de reconocimiento", () => {
  const nativePhrases = kitchenVocabularyPhrases(catalogs).slice(0, 300).map(normalizeKitchenVoice);
  ["lizi", "oreo", "ganache de chocolate", "malteada oreo momo", "crema de leche", "lote 30"].forEach((phrase) => {
    assert.ok(nativePhrases.includes(phrase), `${phrase} quedó fuera del sesgo nativo`);
  });
});

test("cruza formas naturales de ordenar preparaciones internas", () => {
  const cases = [
    ["Hagamos 300 g de ganache", "SR-GAN", 300],
    ["Alistá 250 gramos de salsa maracuyá", "SR-SA", 250],
    ["Dejemos listos 400 gramos de mousse Oreo", "SR-MO", 400],
    ["Vamos con medio kilo de cheesecake", "SR-CH", 500],
    ["Necesito 1 kilo de mezcla secreta sabor Milo", "SR-MM", 1000],
    ["Cocinamos 200 g de ganache de chocolate", "SR-GAN", 200],
    ["Mezclamos 350 g de mousse caramelo salado", "SR-MCS", 350],
  ];
  cases.forEach(([phrase, id, grams]) => {
    const parsed = parseKitchenVoice(phrase, catalogs);
    assert.equal(parsed.errors.length, 0, `${phrase}: ${parsed.errors.join(" | ")}`);
    assert.equal(parsed.preparations[0]?.subrecipeId, id, phrase);
    assert.equal(parsed.preparations[0]?.nominalGrams, grams, phrase);
  });
});

test("entiende varias bases dentro de una sola instrucción", () => {
  const parsed = parseKitchenVoice("Prepara 200 g de ganache y 300 g de salsa maracuyá", catalogs);
  assert.equal(parsed.errors.length, 0, parsed.errors.join(" | "));
  assert.deepEqual(parsed.preparations.map((item) => [item.subrecipeId, item.nominalGrams]), [["SR-GAN", 200], ["SR-SA", 300]]);
});

test("cruza formas naturales de producir figuras y sabores", () => {
  const cases = [
    ["Hagamos 2 Lizis sabor Oreo", "Lizi", "Oreo", 2],
    ["Saca 2 figuras Lizi de Oreo", "Lizi", "Oreo", 2],
    ["Necesito alistar dos Toby sabor limón", "Toby", "Limón", 2],
    ["Moldeá tres Max de Milo", "Max", "Milo", 3],
    ["Vamos con cuatro Roccos de coco", "Rocco", "Coco", 4],
    ["De Danna van dos de Oreo", "Danna", "Oreo", 2],
  ];
  cases.forEach(([phrase, figure, flavor, quantity]) => {
    const parsed = parseKitchenVoice(phrase, catalogs);
    assert.equal(parsed.errors.length, 0, `${phrase}: ${parsed.errors.join(" | ")}`);
    assert.equal(parsed.production?.figure, figure, phrase);
    assert.deepEqual(parsed.production?.runs, [{ flavor, quantity }], phrase);
  });
});

test("entiende dos figuras distintas en la misma instrucción", () => {
  const parsed = parseKitchenVoice("Producir 2 Lizis de limón y 3 Max de Oreo", catalogs);
  assert.equal(parsed.errors.length, 0, parsed.errors.join(" | "));
  assert.deepEqual(parsed.productions.map((item) => [item.figure, item.calculatedTotal]), [["Lizi", 2], ["Max", 3]]);
});

test("cruza formas naturales de iniciar y terminar pedidos", () => {
  ["Alistar pedido 1046", "Arranca la orden 1046", "Pon en cocina pedido 1046", "Comienza con las dos malteadas Oreo"].forEach((phrase) => {
    const parsed = parseKitchenVoice(phrase, catalogs);
    assert.equal(parsed.errors.length, 0, `${phrase}: ${parsed.errors.join(" | ")}`);
    assert.equal(parsed.madeToOrder?.orderId, "P-1046", phrase);
  });
  ["El pedido 1048 quedó listo", "Ya acabé la orden 1048", "Manda pedido 1048 a empaque", "Envía la orden 1048 al empaque"].forEach((phrase) => {
    const parsed = parseKitchenVoice(phrase, catalogs);
    assert.equal(parsed.errors.length, 0, `${phrase}: ${parsed.errors.join(" | ")}`);
    assert.equal(parsed.orderHandoff?.orderId, "P-1048", phrase);
  });
});

test("cruza formas de congelar y desmoldar un lote", () => {
  ["Mete lote 30 al congelador", "Pon a congelar el lote 30", "Arranca reloj lote 30"].forEach((phrase) => {
    const parsed = parseKitchenVoice(phrase, catalogs);
    assert.equal(parsed.errors.length, 0, `${phrase}: ${parsed.errors.join(" | ")}`);
    assert.deepEqual(parsed.freezeBatchIds, ["L-030"], phrase);
  });
  const unmold = parseKitchenVoice("Saca lote 31 del molde: 2 buenas, 2 dañadas y 1 botada", catalogs);
  assert.equal(unmold.errors.length, 0, unmold.errors.join(" | "));
  assert.deepEqual(
    { perfectas: unmold.unmolding?.perfectas, imperfectas: unmold.unmolding?.imperfectas, descartadas: unmold.unmolding?.descartadas },
    { perfectas: 2, imperfectas: 2, descartadas: 1 },
  );
});

test("responde consultas naturales de pedidos, producto terminado e insumos", () => {
  const now = Date.parse("2026-07-15T09:00:00-05:00");
  const cases = [
    ["¿Dónde va la orden 1048?", /En producción/i],
    ["¿Qué toca hacer ahora?", /P-1046/],
    ["¿Cómo va la cocina?", /Resumen operativo/i],
    ["¿Cuántos Max de Oreo tenemos?", /4 unidades/i],
    ["¿Cuánta crema de leche nos queda?", /3 L/i],
    ["¿Tenemos suficiente ganache de chocolate?", /0.4 kg/i],
    ["¿Qué insumos están bajos?", /Crema de leche/i],
    ["¿Qué se está venciendo?", /2026-07-17/i],
    ["¿Qué está vencido?", /Ganache de chocolate/i],
  ];
  cases.forEach(([phrase, expected]) => {
    const answer = momobotContextAnswer(phrase, catalogs, {}, now);
    assert.ok(answer, phrase);
    assert.match(answer.text, expected, phrase);
  });
});

test("mantiene bloqueados los escenarios ambiguos o inseguros", () => {
  const noQuantity = parseKitchenVoice("Prepara ganache", catalogs);
  assert.match(noQuantity.errors.join(" "), /cantidad/i);

  const wrongTotal = parseKitchenVoice("Desmolda lote 31: 3 perfectas, 2 imperfectas y 2 descartadas", catalogs);
  assert.match(wrongTotal.errors.join(" "), /suman 7.*produjo 5/i);

  const duplicateFreeze = parseKitchenVoice("Congela el lote 31", catalogs);
  assert.match(duplicateFreeze.errors.join(" "), /ya está congelando/i);
});
