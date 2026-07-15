import test from "node:test";
import assert from "node:assert/strict";
import {
  canReceiveKitchenDelayReminders,
  canReceiveKitchenOrderAlerts,
  combineKitchenVoiceAlternatives,
  correctKitchenVocabulary,
  kitchenConversationPrompt,
  kitchenDelayedOrderReminders,
  kitchenOrderAlert,
  kitchenOrderLookupAnswer,
  kitchenOrderQueueAnswer,
  kitchenReadyOrderCommands,
  kitchenOrderStateEvents,
  kitchenRecognitionWatchdogMs,
  kitchenSpeechTimeoutMs,
  kitchenVoiceControl,
  kitchenVoicePauseMs,
  kitchenTaskVocabularyPhrases,
  kitchenVocabularyPhrases,
  mergeKitchenConversation,
  normalizeKitchenDelaySettings,
  normalizeKitchenVoice,
  parseKitchenVoice,
  selectKitchenVoiceAlternative,
  selectKitchenVoiceControl,
  splitKitchenVoiceClosure,
  splitKitchenWakeWord,
} from "./kitchen-voice.js";

const catalogs = {
  flavors: ["Mango biche", "Coco", "Maracuyá", "Limón", "Banano", "Durazno", "M&M", "Oreo", "Caramelo salado", "Nutella", "Milo"],
  figures: ["Lizi", "Momo", "Toby", "Teo", "Max", "Rocco", "Danna"].map((nombre) => ({ id: `F-${nombre.toUpperCase()}`, nombre })),
  subrecipes: [
    { id: "SR-GAN", nombre: "Ganache de chocolate", tipo: "ganache", mermaPct: 0 },
    { id: "SR-SALSA-MAR", nombre: "Salsa maracuyá", tipo: "salsa", sabor: "Maracuyá", mermaPct: 5 },
    { id: "SR-MOUSSE-COCO", nombre: "Mousse coco", tipo: "mousse_frutal", sabor: "Coco", mermaPct: 8 },
    { id: "SR-MOUSSE-OREO", nombre: "Mousse Oreo", tipo: "mousse_cremosa", sabor: "Oreo", mermaPct: 6 },
    { id: "SR-MOUSSE-NUTELLA", nombre: "Mousse Nutella", tipo: "mousse_cremosa", sabor: "Nutella", mermaPct: 6 },
    { id: "SR-MOUSSE-MYM", nombre: "Mousse M&M", tipo: "mousse_cremosa", sabor: "M&M", mermaPct: 6 },
    { id: "SR-MOUSSE-MILO", nombre: "Mousse Milo", tipo: "mousse_cremosa", sabor: "Milo", mermaPct: 6 },
  ],
  figureFillings: [{ id: "FR-GAN", subrecetaId: "SR-GAN", gramosPorUnidad: 15, activo: true }],
  batches: [
    { id: "L-031", estado: "Congelando", producto: "Momo Perrito", sabor: "Oreo", prod: 20, perfectas: 0, imperfectas: 0, descartadas: 0, stockContabilizado: false, figuras: [{ figura: "Max", cant: 20 }] },
    { id: "L-030", estado: "En preparación", producto: "Momo Perrito", sabor: "Oreo", prod: 3, perfectas: 0, imperfectas: 0, descartadas: 0, stockContabilizado: false, figuras: [{ figura: "Max", cant: 3 }] },
    { id: "L-029", estado: "En preparación", producto: "Momo Gatito", sabor: "Limón", prod: 4, perfectas: 0, imperfectas: 0, descartadas: 0, stockContabilizado: false, figuras: [{ figura: "Lizi", cant: 4 }] },
    { id: "L-028", estado: "Listo", producto: "Momo premium", sabor: "Mango biche", prod: 1, perfectas: 1, imperfectas: 0, descartadas: 0, stockContabilizado: true, figuras: [{ figura: "Teo", cant: 1 }] },
    { id: "L-027", estado: "Congelando", producto: "Momo Perrito", sabor: "Coco", prod: 2, perfectas: 0, imperfectas: 0, descartadas: 0, stockContabilizado: false, inicioCongelacion: "2026-07-14 02:00", figuras: [{ figura: "Rocco", cant: 2 }] },
    { id: "L-021", estado: "Listo", producto: "Momo Gatito", sabor: "Coco", prod: 1, perfectas: 1, imperfectas: 0, descartadas: 0, stockContabilizado: true, figuras: [{ figura: "Lizi", cant: 1 }] },
  ],
  products: [
    { id: "PR09", nombre: "Crepa Momo Nutella", tipo: "pedido", activo: true },
    { id: "PR10", nombre: "Crepa Momo Oreo", tipo: "pedido", activo: true },
    { id: "PR11", nombre: "Malteada Oreo Momo", tipo: "pedido", activo: true },
    { id: "PR12", nombre: "Malteada Nutella Momo", tipo: "pedido", activo: true },
    { id: "PR13", nombre: "Granizado de maracuyá", tipo: "pedido", activo: true },
  ],
  customers: [
    { id: "C01", nombre: "Valentina Ríos" },
    { id: "C02", nombre: "Sara Gómez" },
  ],
  orders: [
    { id: "P-1046", customerId: "C01", estado: "Pagado" },
    { id: "P-1047", customerId: "C02", estado: "Pendiente de pago" },
    { id: "P-1048", customerId: "C02", estado: "En producción" },
  ],
  orderItems: [
    { id: "OI-1", orderId: "P-1046", productId: "PR11", cant: 2 },
    { id: "OI-2", orderId: "P-1047", productId: "PR11", cant: 2 },
    { id: "OI-3", orderId: "P-1048", productId: "PR12", cant: 1 },
  ],
  inventory: [{ id: "I01", nombre: "Pulpa mango biche" }],
  extras: ["Frutos rojos", "Cheesecake con ganache"],
};

test("dirige los avisos globales de pedidos a Cocina, Empaque y Administrador", () => {
  assert.equal(canReceiveKitchenOrderAlerts("Cocina"), true);
  assert.equal(canReceiveKitchenOrderAlerts("Administrador"), true);
  assert.equal(canReceiveKitchenOrderAlerts("Empaque"), true);
  assert.equal(canReceiveKitchenOrderAlerts("Domiciliario"), false);
  assert.equal(canReceiveKitchenOrderAlerts(""), false);
  assert.equal(canReceiveKitchenDelayReminders("Administrador"), true);
  assert.equal(canReceiveKitchenDelayReminders("Cocina"), true);
  assert.equal(canReceiveKitchenDelayReminders("Empaque"), true);
  assert.equal(canReceiveKitchenDelayReminders("Domiciliario"), false);
});

test("recuerda pedidos demorados en Cocina y Empaque con escalamiento controlado", () => {
  const reminderCatalogs = {
    ...catalogs,
    orders: [
      { id: "P-2001", customerId: "C01", estado: "En producción" },
      { id: "P-2002", customerId: "C02", estado: "Empacado" },
      { id: "P-2003", customerId: "C01", estado: "En producción" },
      { id: "P-2004", customerId: "C01", estado: "Pagado" },
    ],
    orderItems: [
      { id: "OI-2001", orderId: "P-2001", productId: "PR11", cant: 2 },
      { id: "OI-2002", orderId: "P-2002", productId: "PR09", cant: 1 },
    ],
    auditLogs: [
      { entidad: "Pedido", entidadId: "P-2001", accion: "Cambio de estado", a: "En producción", fecha: "2026-07-14 10:00:30" },
      { entidad: "Pedido", entidadId: "P-2001", accion: "Cambio de estado", a: "En producción", fecha: "2026-07-14 10:58" },
      { entidad: "Pedido", entidadId: "P-2002", accion: "Cambio de estado", a: "Empacado", fecha: "2026-07-14 11:17" },
      { entidad: "Pedido", entidadId: "P-2003", accion: "Cambio de estado", a: "En producción", fecha: "2026-07-14 11:20" },
      { entidad: "Pedido", entidadId: "P-2004", accion: "Cambio de estado", a: "Pagado", fecha: "2026-07-14 10:00" },
    ],
  };
  const now = Date.parse("2026-07-14T11:30:00-05:00");
  const reminders = kitchenDelayedOrderReminders(reminderCatalogs, now);

  assert.deepEqual(reminders.map((reminder) => reminder.orderId), ["P-2001", "P-2002"]);
  assert.deepEqual(reminders.map((reminder) => reminder.elapsedMinutes), [32, 13]);
  assert.equal(reminders[0].area, "Cocina");
  assert.equal(reminders[0].urgent, true);
  assert.equal(reminders[0].repeatBucket, 3);
  assert.match(reminders[0].text, /Urgente.*32 minutos en Cocina.*olvidado/i);
  assert.equal(reminders[1].area, "Empaque");
  assert.equal(reminders[1].urgent, false);
  assert.equal(reminders[1].repeatBucket, 0);
  assert.match(reminders[1].nextAction, /Listo para despacho.*En ruta/i);
});

test("respeta tiempos configurables distintos para Cocina, Empaque, urgencia y repetición", () => {
  const customCatalogs = {
    ...catalogs,
    orders: [
      { id: "P-3001", customerId: "C01", estado: "En producción" },
      { id: "P-3002", customerId: "C02", estado: "Empacado" },
    ],
    auditLogs: [
      { entidad: "Pedido", entidadId: "P-3001", accion: "Cambio de estado", a: "En producción", fecha: "2026-07-14 11:10" },
      { entidad: "Pedido", entidadId: "P-3002", accion: "Cambio de estado", a: "Empacado", fecha: "2026-07-14 11:00" },
    ],
  };
  const timing = {
    demoraCocinaMin: 18,
    demoraCocinaUrgenteMin: 21,
    demoraEmpaqueMin: 12,
    demoraEmpaqueUrgenteMin: 25,
    demoraRepeticionMin: 4,
  };
  const reminders = kitchenDelayedOrderReminders(customCatalogs, Date.parse("2026-07-14T11:30:00-05:00"), timing);

  assert.deepEqual(reminders.map((reminder) => reminder.orderId), ["P-3002", "P-3001"]);
  assert.equal(reminders[0].urgent, true);
  assert.equal(reminders[0].thresholdMinutes, 12);
  assert.equal(reminders[0].urgentMinutes, 25);
  assert.equal(reminders[0].repeatMinutes, 4);
  assert.equal(reminders[0].repeatBucket, 4);
  assert.equal(reminders[1].urgent, false);
  assert.equal(reminders[1].repeatBucket, 0);
});

test("normaliza tiempos inválidos y nunca deja urgencia antes del primer aviso", () => {
  assert.deepEqual(normalizeKitchenDelaySettings({
    demoraCocinaMin: 40,
    demoraCocinaUrgenteMin: 20,
    demoraEmpaqueMin: 0,
    demoraEmpaqueUrgenteMin: "",
    demoraRepeticionMin: "abc",
  }), {
    demoraCocinaMin: 40,
    demoraCocinaUrgenteMin: 40,
    demoraEmpaqueMin: 10,
    demoraEmpaqueUrgenteMin: 20,
    demoraRepeticionMin: 5,
  });
});

test("normaliza números hablados y acentos", () => {
  assert.equal(normalizeKitchenVoice("Doscientos gramos y veintitrés Lizis"), "200 gramos y 23 lizis");
});

test("define pausas y vigilancia para que la escucha no dependa de eventos finales", () => {
  assert.equal(kitchenVoicePauseMs("dictation", false), 1800);
  assert.equal(kitchenVoicePauseMs("dictation", true), 1250);
  assert.equal(kitchenVoicePauseMs("followup", false), 1500);
  assert.equal(kitchenRecognitionWatchdogMs("starting"), 4000);
  assert.equal(kitchenRecognitionWatchdogMs("listening"), 12000);
  assert.equal(kitchenSpeechTimeoutMs("Te oigo"), 3500);
  assert.equal(kitchenSpeechTimeoutMs("x".repeat(500)), 15000);
});

test("anuncia una orden nueva con cliente, contenido y regla de pago", () => {
  const paid = kitchenOrderAlert(
    { id: "P-1053", customerId: "C01", estado: "Pagado" },
    {
      ...catalogs,
      orderItems: [
        { id: "OI-A", orderId: "P-1053", productId: "PR11", nombre: "Malteada Oreo Momo", cant: 2, sabor: "Oreo", figura: "Lizi" },
        { id: "OI-B", orderId: "P-1053", productId: "PR09", nombre: "Crepa Momo Nutella", cant: 1, sabor: "Nutella" },
      ],
    },
  );
  assert.equal(paid.canPrepare, true);
  assert.match(paid.text, /Nueva orden P-1053 de Valentina Ríos/i);
  assert.match(paid.text, /2 unidades de Malteada Oreo Momo/i);
  assert.match(paid.text, /una unidad de Crepa Momo Nutella/i);
  assert.match(paid.text, /pagada y lista para iniciar/i);
  assert.deepEqual(paid.figures, ["Lizi"]);
  assert.deepEqual(paid.flavors, ["Oreo", "Nutella"]);
  assert.deepEqual(paid.items[0], { id: "OI-A", name: "Malteada Oreo Momo", quantity: 2, figures: ["Lizi"], flavors: ["Oreo"] });

  const pending = kitchenOrderAlert(
    { id: "P-1054", customerId: "C02", estado: "Pendiente de pago" },
    { ...catalogs, orderItems: [{ id: "OI-C", orderId: "P-1054", productId: "PR13", nombre: "Granizado de maracuyá", cant: 1 }] },
  );
  assert.equal(pending.canPrepare, false);
  assert.match(pending.text, /todavía no la prepares.*Pagado/i);

  const paymentAlert = kitchenOrderAlert(
    { id: "P-1054", customerId: "C02", estado: "Pagado" },
    { ...catalogs, orderItems: [{ id: "OI-C", orderId: "P-1054", productId: "PR13", nombre: "Granizado de maracuyá", cant: 1 }] },
    { eventType: "paid" },
  );
  assert.equal(paymentAlert.eventType, "paid");
  assert.match(paymentAlert.text, /Pedido P-1054.*confirmado como pagado/i);
  assert.match(paymentAlert.text, /Cocina, ya pueden prepararlo/i);
});

test("arma la ventana de comandas solo con pedidos pagados y en orden operativo", () => {
  const commands = kitchenReadyOrderCommands({
    ...catalogs,
    orders: [
      { id: "P-1050", customerId: "C02", estado: "Pagado", fecha: "2026-07-14", hora: "10:00" },
      { id: "P-1046", customerId: "C01", estado: "Pagado", fecha: "2026-07-14", hora: "08:30" },
      { id: "P-1047", customerId: "C02", estado: "Pendiente de pago", fecha: "2026-07-14", hora: "08:45" },
      { id: "P-1048", customerId: "C02", estado: "En producción", fecha: "2026-07-14", hora: "09:00" },
    ],
    orderItems: [
      ...catalogs.orderItems,
      { id: "OI-5", orderId: "P-1050", productId: "PR11", cant: 1 },
    ],
  });

  assert.deepEqual(commands.map((command) => command.orderId), ["P-1046", "P-1050"]);
  assert.equal(commands[0].canPrepare, true);
  assert.equal(commands[0].customerName, "Valentina Ríos");
  assert.match(commands[0].content, /2 unidades de Malteada Oreo Momo/i);
  assert.equal(commands.some((command) => command.orderId === "P-1047"), false);
  assert.equal(commands.some((command) => command.orderId === "P-1048"), false);
});

test("responde qué pedidos hay en cola sin convertir la consulta en producción", () => {
  [
    "¿Qué pedido hay en cola?",
    "Quiero saber qué pedido hay en cola.",
    "Momobot, ¿qué tenemos para preparar?",
    "No tengo pedidos en cola.",
    "No veo pedidos en cocina.",
    "Hay pedidos en producción.",
  ].forEach((phrase) => {
    const answer = kitchenOrderQueueAnswer(phrase, catalogs);
    assert.ok(answer, phrase);
    assert.deepEqual(answer.paidOrderIds, ["P-1046"]);
    assert.deepEqual(answer.inProductionOrderIds, ["P-1048"]);
    assert.deepEqual(answer.waitingPaymentOrderIds, ["P-1047"]);
    assert.match(answer.text, /P-1046 de Valentina Ríos/i);
    assert.match(answer.text, /2 unidades de Malteada Oreo Momo/i);
    assert.match(answer.text, /P-1048 de Sara Gómez/i);
    assert.match(answer.text, /pendiente de pago/i);
  });

  assert.equal(kitchenOrderQueueAnswer("Preparar el pedido 1046", catalogs), null);
  assert.equal(kitchenOrderQueueAnswer("Producir cinco Max de Oreo", catalogs), null);
});

test("consulta por voz el contenido completo de un pedido sin convertirlo en una acción", () => {
  const orderCatalogs = {
    ...catalogs,
    products: [
      ...catalogs.products,
      { id: "PR-MOMO", nombre: "Momo Gatito", tipo: "momo", activo: true },
    ],
    orders: [...catalogs.orders, { id: "P-1053", customerId: "C01", estado: "Pagado" }],
    orderItems: [
      ...catalogs.orderItems,
      {
        id: "OI-MOMO",
        orderId: "P-1053",
        productId: "PR-MOMO",
        cant: 2,
        sabor: "Maracuyá",
        figura: "Lizi",
        salsa: "Frutos rojos",
        relleno: "Cheesecake con ganache",
      },
    ],
  };

  ["¿Qué es? ¿Qué tiene el pedido PS 1053?", "¿Qué tiene el pedido P 1053?", "Pedido 1053, dime qué trae"].forEach((phrase) => {
    const answer = kitchenOrderLookupAnswer(phrase, orderCatalogs);
    assert.ok(answer, phrase);
    assert.equal(answer.orderId, "P-1053");
    assert.equal(answer.canPrepare, true);
    assert.match(answer.text, /P-1053 de Valentina Ríos/i);
    assert.match(answer.text, /2 unidades de Momo Gatito/i);
    assert.match(answer.text, /sabor Maracuyá.*figura Lizi.*salsa Frutos rojos.*relleno Cheesecake con ganache/i);
    assert.match(answer.text, /Cocina puede iniciarlo/i);
  });

  assert.equal(kitchenOrderLookupAnswer("Preparar el pedido 1053", orderCatalogs), null);
});

test("avisa una sola vez cuando una orden pendiente entra a Pagado", () => {
  const known = new Map([
    ["P-1053", "Pendiente de pago"],
    ["P-1052", "Pagado"],
    ["P-1051", "En producción"],
    ["P-1050", "En producción"],
  ]);
  const detected = kitchenOrderStateEvents([
    { id: "P-1054", estado: "Pagado" },
    { id: "P-1053", estado: "Pagado" },
    { id: "P-1052", estado: "Pagado" },
    { id: "P-1051", estado: "Pagado" },
    { id: "P-1050", estado: "Listo para empaque" },
  ], known);
  assert.deepEqual(detected.events.map((event) => [event.order.id, event.type]), [
    ["P-1054", "new"],
    ["P-1053", "paid"],
    ["P-1050", "ready_for_packing"],
  ]);
  assert.equal(detected.nextStates.get("P-1053"), "Pagado");
  assert.equal(kitchenOrderStateEvents(detected.events.map((event) => event.order), detected.nextStates).events.length, 0);
});

test("anuncia a Empaque cuando Cocina termina una comanda", () => {
  const alert = kitchenOrderAlert(
    { id: "P-1048", customerId: "C02", estado: "Listo para empaque" },
    catalogs,
    { eventType: "ready_for_packing" },
  );
  assert.equal(alert.canPrepare, false);
  assert.equal(alert.canPack, true);
  assert.match(alert.text, /P-1048.*listo para empaque/i);
  assert.match(alert.text, /Empaque, ya pueden tomar la comanda/i);
});

test("recuerda a Empaque una comanda lista que nadie ha tomado", () => {
  const reminders = kitchenDelayedOrderReminders({
    ...catalogs,
    orders: [{ id: "P-1048", customerId: "C02", estado: "Listo para empaque" }],
    auditLogs: [{ entidad: "Pedido", entidadId: "P-1048", accion: "Cambio de estado", a: "Listo para empaque", fecha: "2026-07-14 11:00" }],
  }, Date.parse("2026-07-14T11:15:00-05:00"));
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].area, "Empaque");
  assert.match(reminders[0].nextAction, /tomar la comanda.*Empacado/i);
});

test("interpreta el ejemplo completo de cocina", () => {
  const parsed = parseKitchenVoice(
    "Se está preparando 200 gramos de ganache, ingrésalos. Se van a producir 20 Lizis: 3 de limón, 4 de coco, 3 de banano, 5 de Oreo y 5 de Milo. Van a ingresar a congelación, empieza cronómetro.",
    catalogs,
  );
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.preparation.subrecipeId, "SR-GAN");
  assert.equal(parsed.preparation.nominalGrams, 200);
  assert.equal(parsed.production.figure, "Lizi");
  assert.equal(parsed.production.calculatedTotal, 20);
  assert.deepEqual(parsed.production.runs, [
    { flavor: "Limón", quantity: 3 }, { flavor: "Coco", quantity: 4 },
    { flavor: "Banano", quantity: 3 }, { flavor: "Oreo", quantity: 5 },
    { flavor: "Milo", quantity: 5 },
  ]);
  assert.equal(parsed.startFreezing, true);
});

test("bloquea una suma de sabores que no coincide", () => {
  const parsed = parseKitchenVoice("Producir 20 Lizis: 3 limón y 4 coco", catalogs);
  assert.equal(parsed.canExecute, false);
  assert.match(parsed.errors[0], /suman 7/);
});

test("acepta una sola cantidad y un sabor", () => {
  const parsed = parseKitchenVoice("Hacer diez Lizis de limón", catalogs);
  assert.equal(parsed.canExecute, true);
  assert.deepEqual(parsed.production.runs, [{ flavor: "Limón", quantity: 10 }]);
});

test("entiende una cantidad expresada como postres de sabor y figura", () => {
  const cases = [
    "Mambo bot quiero 20 postres de coco de Momo",
    "Momobot quiero veinte piezas de coco de Momo",
    "Quiero preparar 20 figuras sabor coco de Momo",
  ];
  cases.forEach((transcript) => {
    const parsed = parseKitchenVoice(transcript, catalogs);
    assert.equal(parsed.canExecute, true, transcript);
    assert.equal(parsed.production.figure, "Momo", transcript);
    assert.equal(parsed.production.declaredTotal, 20, transcript);
    assert.deepEqual(parsed.production.runs, [{ flavor: "Coco", quantity: 20 }], transcript);
  });
});

test("conserva el total de postres cuando debe preguntar solamente el sabor", () => {
  const parsed = parseKitchenVoice("Momobot quiero 20 postres de Momo", catalogs);
  const prompt = kitchenConversationPrompt(parsed, catalogs);
  assert.equal(parsed.canExecute, false);
  assert.equal(prompt.kind, "flavors");
  assert.match(prompt.text, /entend[ií] 20 de la figura Momo/i);
});

test("no inicia cronómetros sin lotes del mismo comando", () => {
  const parsed = parseKitchenVoice("Inicia el cronómetro de congelación", catalogs);
  assert.equal(parsed.canExecute, false);
  assert.match(parsed.errors[0], /número del lote/i);
});

test("no confunde hacer una base con producir figuras", () => {
  const parsed = parseKitchenVoice("Hacer dos kilos de ganache; salieron mil novecientos gramos", catalogs);
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.production, null);
  assert.equal(parsed.preparation.nominalGrams, 2000);
  assert.equal(parsed.preparation.obtainedGrams, 1900);
});

test("interpreta kilos decimales y sabores con símbolos", () => {
  const withDecimal = parseKitchenVoice("Preparar 1,5 kg de ganache", catalogs);
  assert.equal(withDecimal.canExecute, true);
  assert.equal(withDecimal.preparation.nominalGrams, 1500);

  const withSymbol = parseKitchenVoice("Producir doce Lizis: cinco de M&M y siete de caramelo salado", catalogs);
  assert.equal(withSymbol.canExecute, true);
  assert.deepEqual(withSymbol.production.runs, [
    { flavor: "M&M", quantity: 5 },
    { flavor: "Caramelo salado", quantity: 7 },
  ]);
});

test("bloquea una base ambigua", () => {
  const parsed = parseKitchenVoice("Preparar 200 gramos de ganache", {
    ...catalogs,
    subrecipes: [
      { id: "SR-GAN-1", nombre: "Ganache oscuro", tipo: "ganache", mermaPct: 0 },
      { id: "SR-GAN-2", nombre: "Ganache blanco", tipo: "ganache", mermaPct: 0 },
    ],
  });
  assert.equal(parsed.canExecute, false);
  assert.match(parsed.errors[0], /Ganache oscuro/);
  assert.match(parsed.errors[0], /Ganache blanco/);
});

test("corrige las variantes fonéticas de las figuras MOMOS", () => {
  const cases = [
    ["lisis", "Lizi"], ["moh moh", "Momo"], ["tobi", "Toby"], ["theo", "Teo"],
    ["maks", "Max"], ["roko", "Rocco"], ["dana", "Danna"], ["dann", "Danna"],
    ["dan", "Danna"], ["danas", "Danna"], ["dannas", "Danna"],
  ];
  cases.forEach(([heard, expected]) => {
    const parsed = parseKitchenVoice(`Producir una ${heard} de coco`, catalogs);
    assert.equal(parsed.canExecute, true, `${heard} debe interpretarse como ${expected}`);
    assert.equal(parsed.production.figure, expected);
  });
});

test("entiende Danna cuando la voz devuelve Dana, Dann o ganas en contexto de unidades", () => {
  const transcript = "Mama bot preparemos. 5 ganas. Es Dana Dana. Dana prepara 5 danas.";
  const parsed = parseKitchenVoice(transcript, catalogs);
  const prompt = kitchenConversationPrompt(parsed, catalogs);

  assert.equal(parsed.preparation, null);
  assert.equal(parsed.production, null);
  assert.match(parsed.normalized, /5 danna/);
  assert.doesNotMatch(parsed.normalized, /ganache/);
  assert.equal(prompt.kind, "flavors");
  assert.match(prompt.text, /5 de la figura Danna/i);

  const completed = parseKitchenVoice(mergeKitchenConversation(transcript, "cinco de Oreo"), catalogs);
  assert.equal(completed.canExecute, true);
  assert.equal(completed.production.figure, "Danna");
  assert.deepEqual(completed.production.runs, [{ flavor: "Oreo", quantity: 5 }]);
  assert.equal(completed.preparation, null);
});

test("no reconoce Bingo como figura de MOMOS", () => {
  const parsed = parseKitchenVoice("Producir una Bingo de coco", catalogs);
  assert.equal(parsed.canExecute, false);
  assert.match(parsed.errors[0], /no reconocí la figura/i);
});

test("corrige sabores difíciles y conserva la frase escuchada", () => {
  const heard = "Producir once lizzy: una mango beach, una cocos, una maracuja, una limones, una bananas, una duraznos, una mym, una oreos, una caramelo saldo, una no tela y una mailo";
  const parsed = parseKitchenVoice(heard, catalogs);
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.transcript, heard);
  assert.equal(parsed.production.figure, "Lizi");
  assert.equal(parsed.production.calculatedTotal, 11);
  assert.deepEqual(parsed.production.runs.map((run) => run.flavor), catalogs.flavors);
  assert.ok(parsed.corrections.some((item) => item.understoodAs === "Lizi"));
  assert.ok(parsed.corrections.some((item) => item.understoodAs === "M&M"));
  assert.ok(parsed.corrections.some((item) => item.understoodAs === "Nutella"));
});

test("usa automáticamente productos, postres e inventario como vocabulario", () => {
  const phrases = kitchenVocabularyPhrases(catalogs);
  assert.ok(phrases.includes("Malteada Oreo Momo"));
  assert.ok(phrases.includes("Granizado de maracuyá"));
  assert.ok(phrases.includes("Pulpa mango biche"));
  assert.ok(phrases.includes("Cheesecake con ganache"));

  const corrected = correctKitchenVocabulary("Preparar una maltada de nutela y ganash", catalogs);
  assert.equal(corrected.correctedTranscript, "preparar 1 malteada de nutella y ganache");
});

test("elige la alternativa de voz que coincide con el vocabulario MOMOS", () => {
  const selected = selectKitchenVoiceAlternative([
    { transcript: "Producir diez listas de coco", confidence: 0.95 },
    { transcript: "Producir diez lisi de coco", confidence: 0.55 },
  ], catalogs);
  assert.equal(selected.transcript, "Producir diez lisi de coco");
});

test("cierra el dictado solo con una orden explícita al final", () => {
  assert.deepEqual(
    splitKitchenVoiceClosure("Producir diez Lizis de coco, cierra"),
    { text: "Producir diez Lizis de coco", closed: true },
  );
  assert.deepEqual(
    splitKitchenVoiceClosure("Cerrar el molde después de producir diez Lizis"),
    { text: "Cerrar el molde después de producir diez Lizis", closed: false },
  );
});

test("reconoce controles manos libres únicamente como frases aisladas", () => {
  assert.equal(kitchenVoiceControl("confirmar"), "confirm");
  assert.equal(kitchenVoiceControl("sí, confirmar"), "confirm");
  assert.equal(kitchenVoiceControl("editar comando"), "edit");
  assert.equal(kitchenVoiceControl("repite resumen"), "repeat");
  assert.equal(kitchenVoiceControl("cancelar"), "cancel");
  assert.equal(kitchenVoiceControl("volver a escuchar"), "new");
  assert.equal(kitchenVoiceControl("antes de confirmar revisa el total"), null);
  assert.equal(kitchenVoiceControl("registrar doscientos gramos de ganache"), null);
});

test("acepta confirmaciones y correcciones naturales sin confundir órdenes largas", () => {
  [
    "sí", "dale", "hazlo", "hágale", "todo bien", "regístralo", "dale sí dale", "sí dale",
    "dale dale", "confirmar y registra", "confirma y registra", "confirmar y registrar",
    "sí confirma y registra", "confirmar y regístralo por favor", "de acuerdo",
  ].forEach((phrase) => {
    assert.equal(kitchenVoiceControl(phrase), "confirm", phrase);
  });
  [
    "espera", "no espera", "me equivoqué", "quiero cambiarlo", "editar", "editar editar",
    "edita editar", "limpiar", "limpiar limpiar", "limpia todo", "borra todo",
    "vamos a limpiar el comando", "por favor borrar todo", "editar o limpiar", "empezar de nuevo", "otra orden",
    "Momobot editar", "oye Momobot limpiar el borrador", "quiero limpiar lo anterior", "evitar el comando",
  ].forEach((phrase) => {
    assert.equal(kitchenVoiceControl(phrase), "edit", phrase);
  });
  [
    "cancelar cancelar", "por favor cancela el comando", "quiero cancelar eso", "canselar el borrador",
    "Momobot cancelar", "no lo hagas", "no registres",
  ].forEach((phrase) => {
    assert.equal(kitchenVoiceControl(phrase), "cancel", phrase);
  });
  assert.equal(kitchenVoiceControl("sí, pero primero prepara ganache"), null);
  assert.equal(kitchenVoiceControl("dale cinco Lizis de coco"), null);
  assert.equal(kitchenVoiceControl("confirmar y registrar cinco Max"), null);
  assert.equal(kitchenVoiceControl("no confirmar"), null);
  assert.equal(kitchenVoiceControl("limpiar cinco kilos de mousse"), null);
  assert.equal(kitchenVoiceControl("editar cantidad a cinco"), null);
  assert.equal(kitchenVoiceControl("borrar lote treinta"), null);
  assert.equal(kitchenVoiceControl("cancelar pedido 1053"), null);
  assert.equal(kitchenVoiceControl("descartar cinco Max"), null);
});

test("reconstruye controles que el navegador entrega en fragmentos", () => {
  const edit = combineKitchenVoiceAlternatives([
    [{ transcript: "quiero", confidence: 0.94 }],
    [
      { transcript: "evitar el comando", confidence: 0.91 },
      { transcript: "editar el comando", confidence: 0.64 },
    ],
  ]);
  assert.equal(selectKitchenVoiceControl(edit).control, "edit");

  const cancel = combineKitchenVoiceAlternatives([
    [{ transcript: "por favor", confidence: 0.88 }],
    [{ transcript: "cancelar cancelar", confidence: 0.79 }],
  ]);
  assert.equal(selectKitchenVoiceControl(cancel).control, "cancel");

  const kitchenInstruction = combineKitchenVoiceAlternatives([
    [{ transcript: "limpiar", confidence: 0.9 }],
    [{ transcript: "cinco kilos de mousse", confidence: 0.87 }],
  ]);
  assert.equal(selectKitchenVoiceControl(kitchenInstruction).control, null);
});

test("elige una confirmación entre alternativas de voz y bloquea controles contradictorios", () => {
  const selected = selectKitchenVoiceControl([
    { transcript: "dale cinco", confidence: 0.94 },
    { transcript: "dale sí dale", confidence: 0.61 },
  ]);
  assert.equal(selected.control, "confirm");
  assert.equal(selected.transcript, "dale sí dale");
  assert.equal(selected.ambiguous, false);

  const edit = selectKitchenVoiceControl([
    { transcript: "limpiar cinco", confidence: 0.91 },
    { transcript: "limpiar limpiar", confidence: 0.58 },
  ]);
  assert.equal(edit.control, "edit");
  assert.equal(edit.transcript, "limpiar limpiar");

  const ambiguous = selectKitchenVoiceControl([
    { transcript: "confirmar", confidence: 0.72 },
    { transcript: "cancelar", confidence: 0.68 },
  ]);
  assert.equal(ambiguous.control, null);
  assert.equal(ambiguous.ambiguous, true);
});

test("entiende cantidades naturales antes o después del sabor", () => {
  const parsed = parseKitchenVoice(
    "Vamos a hacer 12 Lizis: para coco van 4, Oreo son 5 y 3 para Milo",
    catalogs,
  );
  assert.equal(parsed.canExecute, true);
  assert.deepEqual(parsed.production.runs, [
    { flavor: "Coco", quantity: 4 },
    { flavor: "Oreo", quantity: 5 },
    { flavor: "Milo", quantity: 3 },
  ]);
});

test("mantiene una conversación para completar figura y sabores", () => {
  const first = parseKitchenVoice("Vamos a producir veinte", catalogs);
  const figureQuestion = kitchenConversationPrompt(first, catalogs);
  assert.equal(figureQuestion.kind, "figure");
  assert.equal(figureQuestion.recoverable, true);

  const withFigureText = mergeKitchenConversation(first.transcript, "Lizi");
  const second = parseKitchenVoice(withFigureText, catalogs);
  const flavorsQuestion = kitchenConversationPrompt(second, catalogs);
  assert.equal(flavorsQuestion.kind, "flavors");

  const completedText = mergeKitchenConversation(withFigureText, "cinco de coco y quince de Oreo");
  const completed = parseKitchenVoice(completedText, catalogs);
  assert.equal(completed.canExecute, true);
  assert.equal(completed.production.calculatedTotal, 20);
});

test("conserva un sabor oído sin cantidad y pregunta exactamente lo que falta", () => {
  const text = "Va a ser de figura de Max. De Oreo y 5 de coco.";
  const first = parseKitchenVoice(text, catalogs);
  const prompt = kitchenConversationPrompt(first, catalogs);

  assert.equal(first.canExecute, false);
  assert.equal(first.production.figure, "Max");
  assert.deepEqual(first.production.runs, [{ flavor: "Coco", quantity: 5 }]);
  assert.match(first.errors.join(" "), /cantidad faltante por sabor: Oreo/i);
  assert.equal(prompt.kind, "quantities");
  assert.match(prompt.text, /s[ií] escuch[eé] Oreo/i);
  assert.match(prompt.text, /cu[aá]ntas unidades van de Oreo/i);

  const completed = parseKitchenVoice(mergeKitchenConversation(text, "cinco de Oreo"), catalogs);
  assert.equal(completed.canExecute, true);
  assert.equal(completed.production.calculatedTotal, 10);
  assert.deepEqual(completed.production.runs, [
    { flavor: "Coco", quantity: 5 },
    { flavor: "Oreo", quantity: 5 },
  ]);
});

test("no inventa por resta un sabor pendiente aunque haya un total anunciado", () => {
  const parsed = parseKitchenVoice("Producir 10 Max: Oreo y 5 de coco", catalogs);
  const prompt = kitchenConversationPrompt(parsed, catalogs);
  assert.equal(parsed.canExecute, false);
  assert.match(parsed.errors.join(" "), /cantidad faltante por sabor: Oreo/i);
  assert.doesNotMatch(parsed.errors.join(" "), /sabores suman/i);
  assert.equal(prompt.kind, "quantities");
});

test("pregunta la cantidad faltante de una base y completa el turno", () => {
  const first = parseKitchenVoice("Preparamos ganache de chocolate", catalogs);
  const prompt = kitchenConversationPrompt(first, catalogs);
  assert.equal(prompt.kind, "amount");
  assert.equal(prompt.recoverable, true);

  const completed = parseKitchenVoice(mergeKitchenConversation(first.transcript, "doscientos gramos"), catalogs);
  assert.equal(completed.canExecute, true);
  assert.equal(completed.preparation.nominalGrams, 200);
});

test("separa ganache y salsa en la misma conversación aunque la voz duplique un número", () => {
  const parsed = parseKitchenVoice(
    "Perfecto mamá, voy a preparar 200 200 g de ganache y 300 g de salsa de maracuyá. ¿Me escuchas Momobot?",
    catalogs,
  );
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.preparations.length, 2);
  assert.deepEqual(parsed.preparations.map((item) => [item.subrecipeName, item.nominalGrams]), [
    ["Ganache de chocolate", 200],
    ["Salsa maracuyá", 300],
  ]);
  assert.equal(parsed.preparations[0].usage, "Relleno de chocolate para figuras · 15 g por figura");
  assert.equal(parsed.preparations[1].usage, "Salsa de acabado");
  assert.equal(parsed.preparation, parsed.preparations[0]);
});

test("recupera las variantes de ganache observadas en cocina", () => {
  ["ganas de chocolate", "ganaste chocolate", "ganash"].forEach((heard) => {
    const parsed = parseKitchenVoice(`Preparar 200 gramos de ${heard}`, catalogs);
    assert.equal(parsed.canExecute, true, heard);
    assert.equal(parsed.preparation.subrecipeName, "Ganache de chocolate");
  });
});

test("reconoce mezcla secreta y variantes fonéticas como mousse del sabor indicado", () => {
  ["mezcla secreta de coco", "base secreta de coco", "mus de coco", "muss coco", "musse de coco", "mouse de coco"].forEach((heard) => {
    const parsed = parseKitchenVoice(`Preparar 500 gramos de ${heard}`, catalogs);
    assert.equal(parsed.canExecute, true, heard);
    assert.equal(parsed.preparation.subrecipeName, "Mousse coco");
    assert.equal(parsed.preparation.nominalGrams, 500);
    assert.equal(parsed.preparation.obtainedGrams, 460);
  });

  const oreo = parseKitchenVoice("Preparar 300 gramos de mezcla secreta de Oreo", catalogs);
  assert.equal(oreo.canExecute, true);
  assert.equal(oreo.preparation.subrecipeName, "Mousse Oreo");
});

test("pregunta el sabor cuando solo escucha mezcla secreta", () => {
  const first = parseKitchenVoice("Preparar 500 gramos de mezcla secreta", catalogs);
  const prompt = kitchenConversationPrompt(first, catalogs);
  assert.equal(first.canExecute, false);
  assert.equal(prompt.kind, "base-flavor");
  assert.match(prompt.text, /de qu[eé] sabor/i);

  const completed = parseKitchenVoice(mergeKitchenConversation(first.transcript, "de coco"), catalogs);
  assert.equal(completed.canExecute, true);
  assert.equal(completed.preparation.subrecipeName, "Mousse coco");
});

test("recupera Milo cuando la voz devuelve 1000 y acepta la corrección acumulada", () => {
  const first = parseKitchenVoice("Voy a preparar 200 g de mezcla secreta", catalogs);
  const heardAsNumber = parseKitchenVoice(mergeKitchenConversation(first.transcript, "de 1000"), catalogs);
  assert.equal(heardAsNumber.canExecute, true);
  assert.equal(heardAsNumber.preparation.subrecipeName, "Mousse Milo");
  assert.equal(heardAsNumber.preparation.nominalGrams, 200);
  assert.ok(heardAsNumber.corrections.some((item) => item.heard === "1000" && item.understoodAs === "Milo"));

  const correctedLater = parseKitchenVoice(
    mergeKitchenConversation(mergeKitchenConversation(first.transcript, "de 1000"), "De Milo"),
    catalogs,
  );
  assert.equal(correctedLater.canExecute, true);
  assert.equal(correctedLater.preparation.subrecipeName, "Mousse Milo");
  assert.equal(correctedLater.preparation.nominalGrams, 200);
});

test("la ayuda de mezcla secreta incluye mousses frutales y cremosas", () => {
  const parsed = parseKitchenVoice("Preparar 200 gramos de mezcla secreta", catalogs);
  const prompt = kitchenConversationPrompt(parsed, catalogs);
  assert.equal(prompt.kind, "base-flavor");
  assert.match(prompt.text, /frutales/i);
  assert.match(prompt.text, /cremosos/i);
  assert.match(prompt.text, /Milo/);
  assert.match(prompt.text, /Oreo/);
  assert.match(prompt.text, /Nutella/);
  assert.match(prompt.text, /M&M/);
});

test("no confunde una tanda real de 1000 gramos con el sabor Milo", () => {
  const parsed = parseKitchenVoice("Preparar 1000 gramos de mezcla secreta de Oreo", catalogs);
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.preparation.subrecipeName, "Mousse Oreo");
  assert.equal(parsed.preparation.nominalGrams, 1000);
  assert.equal(parsed.corrections.some((item) => item.heard === "1000" && item.understoodAs === "Milo"), false);
});

test("alista varias mezclas, salsas, ganache y cheesecake en una sola orden", () => {
  const multiBaseCatalogs = {
    ...catalogs,
    subrecipes: [
      ...catalogs.subrecipes,
      { id: "SR-CHEESECAKE", nombre: "Cheesecake base", tipo: "cheesecake", mermaPct: 5 },
    ],
  };
  const parsed = parseKitchenVoice(
    "Alistar 200 gramos de mezcla secreta de Milo, 300 gramos de salsa maracuyá, 400 gramos de ganache de chocolate y 500 gramos de cheesecake",
    multiBaseCatalogs,
  );
  assert.equal(parsed.canExecute, true);
  assert.deepEqual(
    parsed.preparations.map((item) => [item.subrecipeName, item.nominalGrams]),
    [
      ["Mousse Milo", 200],
      ["Salsa maracuyá", 300],
      ["Ganache de chocolate", 400],
      ["Cheesecake base", 500],
    ],
  );
});

test("alista dos o más figuras y conserva cantidad y sabor de cada una", () => {
  const parsed = parseKitchenVoice("Alistar 3 Lizis de coco, 4 Max de Oreo y 2 Dannas de Milo", catalogs);
  assert.equal(parsed.canExecute, true);
  assert.deepEqual(parsed.productions.map((item) => ({
    figure: item.figure,
    total: item.calculatedTotal,
    runs: item.runs,
  })), [
    { figure: "Lizi", total: 3, runs: [{ flavor: "Coco", quantity: 3 }] },
    { figure: "Max", total: 4, runs: [{ flavor: "Oreo", quantity: 4 }] },
    { figure: "Danna", total: 2, runs: [{ flavor: "Milo", quantity: 2 }] },
  ]);
});

test("separa distribuciones de sabores para varias figuras", () => {
  const parsed = parseKitchenVoice(
    "Producir 5 Lizis: 2 de coco y 3 de Oreo; y 4 Max: 1 de Milo y 3 de Nutella",
    catalogs,
  );
  assert.equal(parsed.canExecute, true);
  assert.deepEqual(parsed.productions.map((item) => ({ figure: item.figure, total: item.calculatedTotal, runs: item.runs })), [
    { figure: "Lizi", total: 5, runs: [{ flavor: "Coco", quantity: 2 }, { flavor: "Oreo", quantity: 3 }] },
    { figure: "Max", total: 4, runs: [{ flavor: "Milo", quantity: 1 }, { flavor: "Nutella", quantity: 3 }] },
  ]);
});

test("bloquea todo el comando si una de varias figuras quedó sin sabor o cantidad", () => {
  const missingFlavor = parseKitchenVoice("Alistar 3 Lizis de coco y 4 Max", catalogs);
  assert.equal(missingFlavor.canExecute, false);
  assert.match(missingFlavor.errors.join(" "), /cantidades por sabor/i);

  const missingQuantity = parseKitchenVoice("Alistar 3 Lizis de coco y Max de Oreo", catalogs);
  assert.equal(missingQuantity.canExecute, false);
  assert.match(missingQuantity.errors.join(" "), /cantidad faltante|cantidades por sabor/i);
});

test("combina varias bases y varias figuras sin cruzar cantidades", () => {
  const parsed = parseKitchenVoice(
    "Alistemos 200 gramos de mezcla secreta de Milo y 300 gramos de salsa maracuyá; además 3 Lizis de coco y 4 Max de Oreo",
    catalogs,
  );
  assert.equal(parsed.canExecute, true);
  assert.deepEqual(parsed.preparations.map((item) => [item.subrecipeName, item.nominalGrams]), [
    ["Mousse Milo", 200],
    ["Salsa maracuyá", 300],
  ]);
  assert.deepEqual(parsed.productions.map((item) => [item.figure, item.calculatedTotal, item.runs]), [
    ["Lizi", 3, [{ flavor: "Coco", quantity: 3 }]],
    ["Max", 4, [{ flavor: "Oreo", quantity: 4 }]],
  ]);
});

test("refuerza plurales y pronunciaciones de las preparaciones de cocina", () => {
  const parsed = parseKitchenVoice("Dejar listas 200 gramos de ganaches y 300 gramos de cheescake", {
    ...catalogs,
    subrecipes: [
      ...catalogs.subrecipes,
      { id: "SR-CHEESE-NATURAL", nombre: "Relleno cheesecake", tipo: "cheesecake", mermaPct: 5 },
    ],
  });
  assert.equal(parsed.canExecute, true);
  assert.deepEqual(parsed.preparations.map((item) => [item.subrecipeName, item.nominalGrams]), [
    ["Ganache de chocolate", 200],
    ["Relleno cheesecake", 300],
  ]);
});

test("cruza la preparación con la única orden pagada y especifica cuál es", () => {
  const parsed = parseKitchenVoice(
    "Preparar dos malteadas. de orio Sierra. Voy a preparar dos malteadas de oreo.",
    catalogs,
  );
  assert.equal(parsed.madeToOrderIntent, true);
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.madeToOrder.orderId, "P-1046");
  assert.equal(parsed.madeToOrder.customerName, "Valentina Ríos");
  assert.equal(parsed.madeToOrder.inferredOrder, true);
  assert.equal(parsed.madeToOrder.quantity, 2);
  assert.deepEqual(parsed.madeToOrder.items, [
    { productId: "PR11", productName: "Malteada Oreo Momo", quantity: 2 },
  ]);
  assert.match(parsed.warnings.join(" "), /P-1046 de Valentina Ríos.*2 × Malteada Oreo Momo/i);
});

test("deduce de la orden pagada el sabor y la cantidad que no se dijeron", () => {
  const withoutFlavor = parseKitchenVoice("Preparar dos malteadas", catalogs);
  assert.equal(withoutFlavor.canExecute, true);
  assert.equal(withoutFlavor.madeToOrder.orderId, "P-1046");
  assert.equal(withoutFlavor.madeToOrder.productName, "Malteada Oreo Momo");

  const withoutQuantity = parseKitchenVoice("Preparar malteadas Oreo", catalogs);
  assert.equal(withoutQuantity.canExecute, true);
  assert.equal(withoutQuantity.madeToOrder.quantity, 2);
  assert.equal(withoutQuantity.madeToOrder.orderId, "P-1046");
});

test("enumera las órdenes cuando más de una coincide y exige elegir", () => {
  const ambiguousCatalogs = {
    ...catalogs,
    orders: [...catalogs.orders, { id: "P-1049", customerId: "C02", estado: "Pagado" }],
    orderItems: [...catalogs.orderItems, { id: "OI-4", orderId: "P-1049", productId: "PR11", cant: 2 }],
  };
  const parsed = parseKitchenVoice("Preparar dos malteadas Oreo", ambiguousCatalogs);
  const prompt = kitchenConversationPrompt(parsed, ambiguousCatalogs);
  assert.equal(parsed.canExecute, false);
  assert.equal(prompt.kind, "order-number");
  assert.match(prompt.text, /P-1046 de Valentina Ríos/i);
  assert.match(prompt.text, /P-1049 de Sara Gómez/i);
  assert.match(prompt.text, /número del pedido/i);
});

test("lee todos los productos al momento de la orden antes de iniciar el pedido completo", () => {
  const completeOrderCatalogs = {
    ...catalogs,
    orders: [...catalogs.orders, { id: "P-1050", customerId: "C02", estado: "Pagado" }],
    orderItems: [
      ...catalogs.orderItems,
      { id: "OI-5", orderId: "P-1050", productId: "PR11", cant: 1 },
      { id: "OI-6", orderId: "P-1050", productId: "PR09", cant: 1 },
    ],
  };
  const parsed = parseKitchenVoice("Preparar una malteada Oreo", completeOrderCatalogs);
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.madeToOrder.orderId, "P-1050");
  assert.equal(parsed.madeToOrder.customerName, "Sara Gómez");
  assert.deepEqual(parsed.madeToOrder.items, [
    { productId: "PR11", productName: "Malteada Oreo Momo", quantity: 1 },
    { productId: "PR09", productName: "Crepa Momo Nutella", quantity: 1 },
  ]);
  assert.match(parsed.warnings.join(" "), /P-1050 de Sara Gómez.*Malteada Oreo Momo.*Crepa Momo Nutella/i);
});

test("cruza también crepas y granizados contra sus pedidos pagados", () => {
  [
    { phrase: "Preparar una crepa Nutella", productId: "PR09", productName: "Crepa Momo Nutella", quantity: 1, orderId: "P-1051" },
    { phrase: "Preparar dos granizados de maracuyá", productId: "PR13", productName: "Granizado de maracuyá", quantity: 2, orderId: "P-1052" },
  ].forEach((scenario) => {
    const scenarioCatalogs = {
      ...catalogs,
      orders: [{ id: scenario.orderId, customerId: "C01", estado: "Pagado" }],
      orderItems: [{ id: `OI-${scenario.orderId}`, orderId: scenario.orderId, productId: scenario.productId, cant: scenario.quantity }],
    };
    const parsed = parseKitchenVoice(scenario.phrase, scenarioCatalogs);
    assert.equal(parsed.canExecute, true, scenario.phrase);
    assert.equal(parsed.madeToOrder.orderId, scenario.orderId);
    assert.deepEqual(parsed.madeToOrder.items, [
      { productId: scenario.productId, productName: scenario.productName, quantity: scenario.quantity },
    ]);
  });
});

test("puede iniciar por número y leer todas las preparaciones al momento del pedido", () => {
  const parsed = parseKitchenVoice("Preparar el pedido 1046", catalogs);
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.madeToOrder.orderId, "P-1046");
  assert.equal(parsed.madeToOrder.customerName, "Valentina Ríos");
  assert.deepEqual(parsed.madeToOrder.items, [
    { productId: "PR11", productName: "Malteada Oreo Momo", quantity: 2 },
  ]);
});

test("puede iniciar por número una comanda completa aunque el producto no sea al momento", () => {
  const orderCatalogs = {
    ...catalogs,
    products: [
      ...catalogs.products,
      { id: "PR-MOMO", nombre: "Momo Gatito", tipo: "momo", activo: true },
    ],
    orders: [...catalogs.orders, { id: "P-1053", customerId: "C01", estado: "Pagado" }],
    orderItems: [
      ...catalogs.orderItems,
      {
        id: "OI-MOMO",
        orderId: "P-1053",
        productId: "PR-MOMO",
        cant: 2,
        sabor: "Maracuyá",
        figura: "Lizi",
        salsa: "Frutos rojos",
        relleno: "Cheesecake con ganache",
      },
    ],
  };
  const parsed = parseKitchenVoice("Preparar el pedido 1053", orderCatalogs);
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.madeToOrder.orderId, "P-1053");
  assert.deepEqual(parsed.madeToOrder.items, [
    { productId: "PR-MOMO", productName: "Momo Gatito", quantity: 2 },
  ]);
  assert.match(parsed.madeToOrder.orderContent, /2 unidades de Momo Gatito/i);
  assert.match(parsed.madeToOrder.orderContent, /Maracuyá.*Lizi.*Frutos rojos.*Cheesecake con ganache/i);
});

test("no permite iniciar una preparación si no existe una orden pagada compatible", () => {
  const withoutPaidOrder = {
    ...catalogs,
    orders: catalogs.orders.map((order) => ({ ...order, estado: "Pendiente de pago" })),
  };
  const parsed = parseKitchenVoice("Preparar dos malteadas Oreo", withoutPaidOrder);
  assert.equal(parsed.canExecute, false);
  assert.equal(kitchenConversationPrompt(parsed, withoutPaidOrder).kind, "order-number");
  assert.match(parsed.errors.join(" "), /no encontré una única orden Pagada/i);
});

test("protege pedido, cantidad y estado antes de preparar malteadas", () => {
  const mismatch = parseKitchenVoice("Preparar una malteada Oreo del pedido 1046", catalogs);
  assert.equal(mismatch.canExecute, false);
  assert.equal(kitchenConversationPrompt(mismatch, catalogs).kind, "order-mismatch");
  assert.match(mismatch.errors.join(" "), /tiene 2.*escuché 1/i);

  const unpaid = parseKitchenVoice("Preparar dos malteadas Oreo del pedido 1047", catalogs);
  assert.equal(unpaid.canExecute, false);
  assert.match(unpaid.errors.join(" "), /Pendiente de pago.*solo inicia.*Pagado/i);

  const already = parseKitchenVoice("Preparar una malteada Nutella del pedido 1048", catalogs);
  assert.equal(already.canExecute, false);
  assert.equal(kitchenConversationPrompt(already, catalogs).kind, "order-already-started");
  assert.match(already.errors.join(" "), /ya está En producción/i);
});

test("Cocina puede entregar por voz un pedido terminado a Empaque", () => {
  [
    "Pedido 1048 listo para empaque",
    "El pedido 1048 ya está listo",
    "Terminé el pedido 1048",
    "Pasar a empaque el pedido P 1048",
  ].forEach((phrase) => {
    const parsed = parseKitchenVoice(phrase, catalogs);
    assert.equal(parsed.canExecute, true, phrase);
    assert.equal(parsed.orderHandoffIntent, true, phrase);
    assert.equal(parsed.orderHandoff.orderId, "P-1048", phrase);
    assert.equal(parsed.orderHandoff.previousState, "En producción", phrase);
  });

  const duplicate = parseKitchenVoice("Pedido 1049 listo para empaque", {
    ...catalogs,
    orders: [...catalogs.orders, { id: "P-1049", customerId: "C01", estado: "Listo para empaque" }],
  });
  assert.equal(duplicate.canExecute, false);
  assert.match(duplicate.errors.join(" "), /ya está Listo para empaque/i);
});

test("bloquea dos preparaciones cuando una quedó sin cantidad", () => {
  const parsed = parseKitchenVoice("Preparar 200 gramos de ganache y salsa de maracuyá", catalogs);
  const prompt = kitchenConversationPrompt(parsed, catalogs);
  assert.equal(parsed.canExecute, false);
  assert.equal(parsed.preparations.length, 1);
  assert.match(parsed.errors.join(" "), /cantidad de Salsa maracuyá/i);
  assert.equal(prompt.kind, "amount");
  assert.match(prompt.text, /gramos.*Salsa maracuyá/i);
});

test("conserva el rendimiento real de una base sin robar la cantidad de la siguiente", () => {
  const parsed = parseKitchenVoice(
    "Preparar 500 gramos de ganache, salieron 480 gramos; y 300 gramos de salsa de maracuyá",
    catalogs,
  );
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.preparations[0].obtainedGrams, 480);
  assert.equal(parsed.preparations[1].nominalGrams, 300);
  assert.equal(parsed.preparations[1].obtainedGrams, 285);
});

test("entiende una orden natural para pasar los lotes nuevos al congelador", () => {
  const parsed = parseKitchenVoice("Hagamos 4 Lizis de coco y mételas al congelador", catalogs);
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.startFreezing, true);
});

test("congela un lote existente por el número dicho en cocina", () => {
  const parsed = parseKitchenVoice("Mama bot. El lote de Max. Lote 30. Congela.", catalogs);
  assert.equal(parsed.canExecute, true);
  assert.equal(parsed.production, null);
  assert.equal(parsed.startFreezing, true);
  assert.deepEqual(parsed.freezeBatchIds, ["L-030"]);
  assert.equal(parsed.freezeBatches[0].figuras[0], "Max");
});

test("mantiene contexto de lote sin pedir sabores y pregunta la acción", () => {
  assert.deepEqual(splitKitchenWakeWord("Mama bot"), { text: "", woke: true });
  const firstText = "El lote de Max";
  const first = parseKitchenVoice(firstText, catalogs);
  assert.equal(first.production, null);
  assert.equal(kitchenConversationPrompt(first, catalogs).kind, "batch-action");

  const secondText = mergeKitchenConversation(firstText, "Lote 30");
  const second = parseKitchenVoice(secondText, catalogs);
  assert.equal(kitchenConversationPrompt(second, catalogs).kind, "batch-action");

  const completed = parseKitchenVoice(mergeKitchenConversation(secondText, "Congela"), catalogs);
  assert.equal(completed.canExecute, true);
  assert.deepEqual(completed.freezeBatchIds, ["L-030"]);
});

test("puede inferir un único lote en preparación por figura", () => {
  const parsed = parseKitchenVoice("Congela el lote de Max", catalogs);
  assert.equal(parsed.canExecute, true);
  assert.deepEqual(parsed.freezeBatchIds, ["L-030"]);
  assert.match(parsed.warnings.join(" "), /único lote de Max/i);
});

test("agrega una preparación nueva sin perder la acción pendiente sobre el lote", () => {
  const extendedCatalogs = {
    ...catalogs,
    subrecipes: [
      ...catalogs.subrecipes,
      { id: "SR-CHEESE", nombre: "Relleno cheesecake", tipo: "relleno", mermaPct: 0 },
    ],
  };
  const pending = parseKitchenVoice("Congela el lote 29", extendedCatalogs);
  assert.equal(pending.canExecute, true);

  const combined = parseKitchenVoice(
    mergeKitchenConversation(pending.transcript, "También preparar 300 gramos de relleno cheesecake"),
    extendedCatalogs,
  );
  assert.equal(combined.canExecute, true);
  assert.deepEqual(combined.freezeBatchIds, ["L-029"]);
  assert.equal(combined.preparations.length, 1);
  assert.equal(combined.preparations[0].subrecipeId, "SR-CHEESE");
  assert.equal(combined.preparations[0].nominalGrams, 300);
});

test("bloquea lotes inexistentes o con congelación ya iniciada", () => {
  const missing = parseKitchenVoice("Congela el lote 99", catalogs);
  assert.equal(missing.canExecute, false);
  assert.match(missing.errors.join(" "), /no encontré el lote 99/i);

  const already = parseKitchenVoice("Inicia congelación del lote 27", catalogs);
  assert.equal(already.canExecute, false);
  assert.match(already.errors.join(" "), /ya está congelando/i);
});

test("entiende registrar imperfectas como desmolde y no como congelación", () => {
  const first = parseKitchenVoice("Quiero registrar imperfectos en el lote 30", catalogs);
  const prompt = kitchenConversationPrompt(first, catalogs);
  assert.equal(first.unmoldingIntent, true);
  assert.equal(first.canExecute, false);
  assert.equal(prompt.kind, "unmolding-counts");
  assert.equal(prompt.recoverable, true);
  assert.match(prompt.text, /perfectas, imperfectas y descartadas/i);
  assert.doesNotMatch(prompt.text, /congelaci[oó]n/i);

  const completed = parseKitchenVoice(
    mergeKitchenConversation(first.transcript, "dos perfectas, una imperfecta y cero descartadas"),
    catalogs,
  );
  assert.equal(completed.canExecute, true, completed.errors.join(" | "));
  assert.deepEqual(completed.unmolding, {
    batchId: "L-030",
    total: 3,
    perfectas: 2,
    imperfectas: 1,
    descartadas: 0,
    estado: "En preparación",
    figuras: ["Max"],
  });
});

test("pide y valida piezas perfectas, imperfectos y descartadas al desmoldar", () => {
  const pending = parseKitchenVoice("Desmoldar el lote 30", catalogs);
  const prompt = kitchenConversationPrompt(pending, catalogs);
  assert.equal(pending.canExecute, false);
  assert.equal(prompt.kind, "unmolding-counts");
  assert.match(prompt.text, /3 unidades/i);
  assert.match(prompt.text, /perfectas, imperfectas y descartadas/i);

  const completed = parseKitchenVoice(
    mergeKitchenConversation(pending.transcript, "Una pieza perfecta, un imperfecto y una descartada"),
    catalogs,
  );
  assert.equal(completed.canExecute, true);
  assert.deepEqual(completed.unmolding, {
    batchId: "L-030",
    total: 3,
    perfectas: 1,
    imperfectas: 1,
    descartadas: 1,
    estado: "En preparación",
    figuras: ["Max"],
  });

  const invalid = parseKitchenVoice(
    "Desmoldar lote 30: dos perfectas, dos imperfectos y cero descartadas",
    catalogs,
  );
  assert.equal(invalid.canExecute, false);
  assert.match(invalid.errors.join(" "), /suman 4.*produjo 3/i);
});

test("desmoldar, descongelar y lote listo abren el mismo cierre seguro", () => {
  [
    "Desmoldar lote 30",
    "Descongelar el lote 30",
    "Sacar del congelador el lote 30",
    "El lote 30 está listo",
    "Lote 30 listo para vender",
  ].forEach((phrase) => {
    const parsed = parseKitchenVoice(phrase, catalogs);
    const prompt = kitchenConversationPrompt(parsed, catalogs);
    assert.equal(parsed.unmoldingIntent, true, phrase);
    assert.equal(parsed.canExecute, false, phrase);
    assert.equal(prompt.kind, "unmolding-counts", phrase);
    assert.match(prompt.text, /perfectas, imperfectas y descartadas/i, phrase);
    assert.equal(parsed.startFreezing, false, phrase);
  });
});

test("la corrección más reciente reemplaza conteos anteriores del desmolde", () => {
  const batchCatalogs = {
    ...catalogs,
    batches: [
      ...catalogs.batches,
      { id: "L-032", estado: "Congelando", producto: "Momo Perrito", sabor: "Oreo", prod: 5, perfectas: 0, imperfectas: 0, descartadas: 0, stockContabilizado: false, figuras: [{ figura: "Danna", cant: 5 }] },
    ],
  };
  const conversation = [
    "Desmoldar lote 32",
    "Cuatro perfectas",
    "Dos imperfectas",
    "Estas tres imperfectas",
    "Corrección: dos perfectas, tres imperfectas y cero descartadas",
  ].reduce((current, reply) => mergeKitchenConversation(current, reply), "");
  const parsed = parseKitchenVoice(conversation, batchCatalogs);
  assert.equal(parsed.canExecute, true, parsed.errors.join(" | "));
  assert.deepEqual(parsed.unmolding, {
    batchId: "L-032",
    total: 5,
    perfectas: 2,
    imperfectas: 3,
    descartadas: 0,
    estado: "Congelando",
    figuras: ["Danna"],
  });

  const noisyConversation = [
    "Desmoldar lote 32",
    "Cinco unidades entonces cuatro buenas, cuatro perfectas, subieron cuatro y una mala",
    "Imperfectas dos imperfectas tres",
    "Estas tres imperfectas dos",
    "Perfecto dos perfectas y tres imperfectas cero imperfecero, cero descartadas",
    "Dos perfectas y tres imperfectas",
  ].reduce((current, reply) => mergeKitchenConversation(current, reply), "");
  const noisy = parseKitchenVoice(noisyConversation, batchCatalogs);
  assert.equal(noisy.canExecute, true, noisy.errors.join(" | "));
  assert.deepEqual(noisy.unmolding, parsed.unmolding);
});

test("el caso exacto del lote 21 explica que ya fue desmoldado y protege el stock", () => {
  const parsed = parseKitchenVoice(
    "Quiero registrar imperfectos en el lote 21. Registrar imperfectos.",
    catalogs,
  );
  const prompt = kitchenConversationPrompt(parsed, catalogs);
  assert.equal(parsed.unmoldingIntent, true);
  assert.equal(parsed.canExecute, false);
  assert.equal(prompt.kind, "unmolding-state");
  assert.equal(prompt.recoverable, false);
  assert.match(prompt.text, /L-021 ya fue desmoldado/i);
  assert.match(prompt.text, /1 perfecta, 0 imperfectas y 0 descartadas/i);
  assert.doesNotMatch(prompt.text, /inicia su congelaci[oó]n/i);
});

test("entiende que un lote listo para vender debe completar el desmolde", () => {
  const first = parseKitchenVoice(
    "Pero informar que él está listo, el lote 31. Está listo. 31 ya está listo.",
    catalogs,
  );
  const prompt = kitchenConversationPrompt(first, catalogs);
  assert.equal(first.readyForSaleIntent, true);
  assert.equal(first.unmoldingIntent, true);
  assert.equal(first.canExecute, false);
  assert.equal(prompt.kind, "unmolding-counts");
  assert.equal(prompt.recoverable, true);
  assert.match(prompt.text, /L-031 terminó.*Listo para vender/i);
  assert.match(prompt.text, /20 unidades.*perfectas, imperfectas y descartadas/i);
  assert.doesNotMatch(prompt.text, /inicia su congelaci[oó]n/i);

  const completed = parseKitchenVoice(
    mergeKitchenConversation(first.transcript, "salieron todas perfectas"),
    catalogs,
  );
  assert.equal(completed.canExecute, true);
  assert.deepEqual(completed.unmolding, {
    batchId: "L-031",
    total: 20,
    perfectas: 20,
    imperfectas: 0,
    descartadas: 0,
    estado: "Congelando",
    figuras: ["Max"],
  });
});

test("reconoce terminado para su venta y conteos explícitos como Listo", () => {
  const first = parseKitchenVoice("El lote 31 quedó terminado para su venta", catalogs);
  assert.equal(first.readyForSaleIntent, true);
  assert.equal(kitchenConversationPrompt(first, catalogs).kind, "unmolding-counts");

  const counted = parseKitchenVoice(
    "Lote 31 listo para la venta: 18 perfectas, 1 imperfecta y 1 descartada",
    catalogs,
  );
  assert.equal(counted.canExecute, true, counted.errors.join(" | "));
  assert.equal(counted.unmolding.perfectas, 18);
  assert.equal(counted.unmolding.imperfectas, 1);
  assert.equal(counted.unmolding.descartadas, 1);
});

test("rechaza conteos de desmolde que no cuadran con lo producido", () => {
  const parsed = parseKitchenVoice("Desmoldar lote 30: 1 perfecta, 1 imperfecta y 0 descartadas", catalogs);
  const prompt = kitchenConversationPrompt(parsed, catalogs);
  assert.equal(parsed.canExecute, false);
  assert.equal(prompt.kind, "unmolding-conflict");
  assert.equal(prompt.recoverable, false);
  assert.match(prompt.text, /suman 2.*produjo 3/i);
});

test("un total inconsistente no se completa conversando ni se vuelve ejecutable", () => {
  const parsed = parseKitchenVoice("Hacer 20 Lizis: 3 de limón y 4 de coco", catalogs);
  const prompt = kitchenConversationPrompt(parsed, catalogs);
  assert.equal(parsed.canExecute, false);
  assert.equal(prompt.kind, "conflict");
  assert.equal(prompt.recoverable, false);
});

test("Momobot despierta el dictado solo cuando inicia la frase", () => {
  assert.deepEqual(splitKitchenWakeWord("Momobot"), { text: "", woke: true });
  assert.deepEqual(splitKitchenWakeWord("Oye Momobot"), { text: "", woke: true });
  assert.deepEqual(
    splitKitchenWakeWord("Oye, momo bot, el lote 31 está listo"),
    { text: "el lote 31 está listo", woke: true },
  );
  assert.deepEqual(
    splitKitchenWakeWord("Oye mamá bot, preparar doscientos gramos de ganache"),
    { text: "preparar doscientos gramos de ganache", woke: true },
  );
  assert.deepEqual(
    splitKitchenWakeWord("Oye mambo bot"),
    { text: "", woke: true },
  );
  assert.deepEqual(
    splitKitchenWakeWord("Momo bot, producir dos Lizis de coco"),
    { text: "producir dos Lizis de coco", woke: true },
  );
  assert.deepEqual(
    splitKitchenWakeWord("Mono bot preparar doscientos gramos de ganache"),
    { text: "preparar doscientos gramos de ganache", woke: true },
  );
  assert.deepEqual(
    splitKitchenWakeWord("Avisale a Momobot que prepare ganache"),
    { text: "Avisale a Momobot que prepare ganache", woke: false },
  );
  assert.deepEqual(
    splitKitchenWakeWord("Le dije oye a Momobot"),
    { text: "Le dije oye a Momobot", woke: false },
  );
});

test("consume activaciones repetidas sin confundir Momobot con la figura Momo", () => {
  assert.deepEqual(
    splitKitchenWakeWord("Hola Momobot, oye Momo bot"),
    { text: "", woke: true },
  );
  assert.deepEqual(
    splitKitchenWakeWord("Momobot, Momobot, cancelar"),
    { text: "cancelar", woke: true },
  );
});

test("refuerza Oye Momobot como frase completa de activación", () => {
  const vocabulary = kitchenVocabularyPhrases(catalogs).map((phrase) => normalizeKitchenVoice(phrase));
  assert.ok(vocabulary.includes("oye momobot"));
  assert.ok(vocabulary.includes("oye momo bot"));
});

test("refuerza el vocabulario completo de tareas operativas", () => {
  const tasks = kitchenTaskVocabularyPhrases();
  [
    "preparar", "producir", "registrar", "desmoldar", "congelación", "cronómetro",
    "corrida", "perfectas", "imperfectas", "descartar", "convertir imperfectas",
    "movimiento", "consumir insumos", "entrada de inventario", "salida de inventario",
  ].forEach((task) => assert.ok(tasks.includes(task), `falta reforzar ${task}`));

  assert.equal(
    correctKitchenVocabulary("Desmolde el lote y empieza el temporizador de congelamiento", catalogs).correctedTranscript,
    "desmoldar el lote y iniciar el cronometro de congelacion",
  );
  assert.equal(
    correctKitchenVocabulary("Registrar movimiento por unidades defectuosas", catalogs).correctedTranscript,
    "movimiento por unidades imperfectas",
  );
});
