const SMALL_NUMBERS = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiuna: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};

const TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300,
  trescientas: 300, cuatrocientos: 400, cuatrocientas: 400, quinientos: 500,
  quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900,
  novecientas: 900,
};

const KITCHEN_CORE_TERMS = [
  "Lizi", "Momo", "Max", "Rocco", "Teo", "Toby", "Danna",
  "M&M", "Oreo", "Nutella", "Milo", "Mango biche", "Coco", "Maracuyá",
  "Limón", "Banano", "Durazno", "Caramelo salado", "malteada", "granizado",
  "postre", "postres", "unidad", "unidades", "pieza", "piezas", "figura", "figuras",
  "cheesecake", "ganache", "mousse", "mezcla secreta", "base secreta", "crocante", "relleno", "salsa",
  "ganache de chocolate", "relleno de ganache", "ganache para rellenos", "relleno de chocolate para figuras",
  "congelación", "cronómetro", "desmoldar", "producción", "preparar",
  "lote", "número de lote", "congelar lote", "iniciar congelación del lote",
  "pedido", "número de pedido", "pedido pagado", "preparar pedido", "pedido en producción",
  "pedido listo para empaque", "terminé el pedido", "entregar a empaque", "pasar a empaque",
  "qué pedido hay en cola", "qué pedidos hay en cola", "qué hay pendiente en cocina", "qué sigue en cocina", "qué tenemos para preparar",
  "Momobot", "Oye Momobot", "Oye Momo bot", "Hola Momobot", "Ya Momobot", "Ya hola Momobot", "Buenas Momobot", "cierra", "confirmar", "sí", "dale", "dale sí dale", "hazlo", "hágale",
  "confirmar y registra", "confirma y registra", "confirmar y registrar", "editar", "edita", "editar editar",
  "editar el comando", "quiero editar", "evitar el comando", "limpiar", "limpia", "limpiar el comando", "limpia el borrador",
  "borrar", "borra todo", "corregir", "corrige", "empezar de nuevo", "cancelar", "cancelar el comando",
  "cancela el borrador", "cancelar cancelar", "canselar", "no lo hagas", "no registres", "repetir", "nuevo comando",
];

const KITCHEN_TASK_GROUPS = [
  { canonical: "preparar", aliases: ["prepara", "preparando", "preparación", "prepare", "prepárame", "hacer", "alistar", "alista", "alistando", "alistemos", "dejar listo", "dejar lista", "dejar listos", "dejar listas"] },
  { canonical: "producir", aliases: ["produce", "produciendo", "producción", "fabricar", "fabrica", "fabricando"] },
  { canonical: "registrar", aliases: ["registra", "registrando", "registro", "anotar", "anota"] },
  { canonical: "ingresar", aliases: ["ingresa", "ingresando", "ingreso", "entrar", "entra"] },
  { canonical: "desmoldar", aliases: ["desmolda", "desmoldando", "desmolde", "descongelar", "descongela", "descongelando", "descongelado", "descongelada", "sacar del molde", "sacar de los moldes", "sacar del congelador", "retirar del congelador"] },
  { canonical: "congelación", aliases: ["congelar", "congela", "congelando", "congelamiento", "meter al congelador", "pasar a congelación"] },
  { canonical: "iniciar", aliases: ["inicia", "iniciando", "empieza", "empezar", "arranca", "arrancar", "comienza", "comenzar"] },
  { canonical: "cronómetro", aliases: ["crono metro", "cronometros", "temporizador", "timer", "reloj de congelación"] },
  { canonical: "moldear", aliases: ["moldea", "moldeando", "llenar el molde", "llenar los moldes"] },
  { canonical: "corrida", aliases: ["corridas", "tanda", "tandas", "lote de producción"] },
  { canonical: "obtenidos", aliases: ["obtenido", "obtuve", "obtuvimos", "salieron", "resultado obtenido"] },
  { canonical: "rindieron", aliases: ["rindió", "rindio", "rindieron", "rendimiento real"] },
  { canonical: "perfectas", aliases: ["perfecta", "perfecto", "perfectos", "unidades perfectas", "piezas perfectas"] },
  { canonical: "imperfectas", aliases: ["imperfecta", "imperfecto", "imperfectos", "unidades imperfectas", "piezas imperfectas", "defectuosas", "quebradas"] },
  { canonical: "descartar", aliases: ["descartado", "descartada", "descartadas", "descarte", "desechar", "desechadas"] },
  { canonical: "convertir imperfectas", aliases: ["aprovechar imperfectas", "reprocesar imperfectas", "pasar imperfectas a insumo"] },
  { canonical: "listo", aliases: [
    "lista", "marcar listo", "marcar como listo", "pasar a listo", "lote listo",
    "terminado", "terminada", "termino", "finalizado", "finalizada",
    "listo para vender", "listo para la venta", "listo para su venta",
    "terminado para vender", "terminado para la venta", "terminado para su venta",
  ] },
  { canonical: "reservar", aliases: ["reserva", "reservado", "marcar reservado"] },
  { canonical: "vender", aliases: ["vendido", "marcar vendido"] },
  { canonical: "merma", aliases: ["mermas", "desperdicio", "pérdida de producción"] },
  { canonical: "movimiento", aliases: ["movimientos", "mover inventario", "registrar movimiento", "movimiento de inventario"] },
  { canonical: "consumir insumos", aliases: ["consumo de insumos", "usar insumos", "descontar insumos"] },
  { canonical: "entrada de inventario", aliases: ["agregar inventario", "sumar stock", "entrada de stock"] },
  { canonical: "salida de inventario", aliases: ["restar inventario", "restar stock", "salida de stock"] },
];

const KITCHEN_ALIAS_GROUPS = [
  ...KITCHEN_TASK_GROUPS,
  { canonical: "Lizi", aliases: ["lisi", "lissi", "lissy", "lizy", "lizzy", "lici", "lisa", "lis y", "liz y", "lucy", "luci", "lisis"] },
  { canonical: "Momo", aliases: ["moh moh", "momo's"] },
  { canonical: "Max", aliases: ["maks", "macs", "maxx"] },
  { canonical: "Rocco", aliases: ["roco", "roko", "roku"] },
  { canonical: "Teo", aliases: ["theo", "teho"] },
  { canonical: "Toby", aliases: ["tobi", "tovi", "tobby"] },
  { canonical: "Danna", aliases: ["dana dana", "danna danna", "dannas", "danas", "dann", "dan", "dana"] },
  { canonical: "Momobot", aliases: ["momo bot", "mono bot", "mama bot", "mamá bot", "mambo bot", "momobots"] },
  { canonical: "M&M", aliases: ["mym", "m y m", "m n m", "mnm", "eme y eme", "eme ene eme", "eminem"] },
  { canonical: "Oreo", aliases: ["o reo", "oreao", "oreos", "orio", "orio sierra", "oreo sierra"] },
  { canonical: "Nutella", aliases: ["nutela", "no tela", "nutellas"] },
  { canonical: "Milo", aliases: ["mylo", "mailo", "milos"] },
  { canonical: "Mango biche", aliases: ["mango viche", "mango bichi", "mango beach", "mango bici"] },
  { canonical: "Maracuyá", aliases: ["maracuja", "maracuya", "maracullá", "maracuyas"] },
  { canonical: "Coco", aliases: ["cocos"] },
  { canonical: "Limón", aliases: ["limones"] },
  { canonical: "Banano", aliases: ["banana", "bananas", "bananos"] },
  { canonical: "Durazno", aliases: ["duraznos"] },
  { canonical: "Caramelo salado", aliases: ["caramelo saldo"] },
  { canonical: "malteada", aliases: ["maltada", "malteado", "malteadas"] },
  { canonical: "granizado", aliases: ["granisado", "granizados"] },
  { canonical: "cheesecake", aliases: ["cheese cake", "chees cake", "cheescake", "chesecake", "chiz cake", "chis cake", "cheesecakes"] },
  { canonical: "ganache", aliases: ["ganaches", "ganash", "ganasch", "ganachi", "gana de chocolate", "ganas de chocolate", "ganaste chocolate"] },
  { canonical: "salsa", aliases: ["salsas"] },
  { canonical: "mousse", aliases: ["mezcla secreta", "mezclas secretas", "base secreta", "mus", "muss", "musse", "mous", "mouse", "muse", "mousse"] },
];

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function kitchenVoicePauseMs(mode, isFinal = false) {
  if (mode === "action" || mode === "followup") return isFinal ? 900 : 1500;
  if (mode === "standby") return 1800;
  return isFinal ? 1250 : 1800;
}

export function kitchenSpeechTimeoutMs(text) {
  const estimated = 1400 + String(text || "").trim().length * 75;
  return Math.min(15000, Math.max(3500, estimated));
}

export function kitchenRecognitionWatchdogMs(phase) {
  return phase === "starting" ? 4000 : 12000;
}

function readNumberWords(tokens, start) {
  let current = 0;
  let total = 0;
  let used = 0;
  let seen = false;
  for (let i = start; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (Object.prototype.hasOwnProperty.call(SMALL_NUMBERS, token)) {
      current += SMALL_NUMBERS[token]; seen = true; used += 1; continue;
    }
    if (Object.prototype.hasOwnProperty.call(TENS, token)) {
      current += TENS[token]; seen = true; used += 1; continue;
    }
    if (Object.prototype.hasOwnProperty.call(HUNDREDS, token)) {
      current += HUNDREDS[token]; seen = true; used += 1; continue;
    }
    if (token === "mil") {
      total += (current || 1) * 1000; current = 0; seen = true; used += 1; continue;
    }
    if (token === "y" && seen && i + 1 < tokens.length && Object.prototype.hasOwnProperty.call(SMALL_NUMBERS, tokens[i + 1])) {
      used += 1; continue;
    }
    break;
  }
  return seen ? { value: total + current, used } : null;
}

function replaceNumberWords(value) {
  const tokens = value.split(/\s+/).filter(Boolean);
  const output = [];
  for (let i = 0; i < tokens.length;) {
    const number = readNumberWords(tokens, i);
    if (number) { output.push(String(number.value)); i += number.used; }
    else { output.push(tokens[i]); i += 1; }
  }
  return output.join(" ");
}

export function normalizeKitchenVoice(value) {
  const base = stripAccents(value)
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)\.(\d)/g, "$1zzdecimalzz$2")
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/zzdecimalzz/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  return replaceNumberWords(base);
}

export function kitchenTaskVocabularyPhrases() {
  const seen = new Set();
  return KITCHEN_TASK_GROUPS.flatMap((group) => [group.canonical, ...group.aliases]).filter((phrase) => {
    const normalized = normalizeKitchenVoice(phrase);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

const VOICE_CLOSE_CONTROL_PATTERN = /^(?:cierra|cerrar|termina|terminar|finaliza|finalizar)(?:\s+(?:comando|dictado|escucha|microfono))?$/;
const VOICE_CLOSE_RAW_PATTERN = /(?:^|\s)(?:cierra|cerrar|termina|terminar|finaliza|finalizar)(?:\s+(?:comando|dictado|escucha|micr[oó]fono))?[\s.,;:!?]*$/iu;
const VOICE_WAKE_RAW_PATTERN = /^(?:(?:oye|oiga|hey|ey|hola|ya|bueno|pues|listo|buenas|por\s+favor)[\s,;:.-]+){0,3}(?:momobot|momo\s+bot|mono\s+bot|mam[aá]\s+bot|mambo\s+bot|momobots?)(?:[\s,;:.-]+|$)/iu;

export function splitKitchenWakeWord(value) {
  const raw = String(value || "").trim();
  let text = raw;
  let woke = false;
  let match = text.match(VOICE_WAKE_RAW_PATTERN);
  while (match) {
    woke = true;
    text = text.slice(match[0].length).trim();
    match = text.match(VOICE_WAKE_RAW_PATTERN);
  }
  return { text, woke };
}

export function splitKitchenVoiceClosure(value) {
  const raw = String(value || "").trim();
  const match = raw.match(VOICE_CLOSE_RAW_PATTERN);
  if (!match) return { text: String(value || "").trim(), closed: false };
  return {
    text: raw.slice(0, match.index).replace(/[\s,;:.-]+$/u, "").trim(),
    closed: true,
  };
}

export function kitchenVoiceControl(value) {
  const wake = splitKitchenWakeWord(value);
  const normalized = normalizeKitchenVoice(wake.woke ? wake.text : value);
  if (!normalized) return null;
  if (VOICE_CLOSE_CONTROL_PATTERN.test(normalized)) return "close";
  const confirmationTokens = new Set(["si", "dale", "claro", "correcto", "hazlo", "hagale", "adelante", "proceda"]);
  const tokens = normalized.split(" ");
  const onlyConfirmations = tokens.length <= 6 && tokens.every((token) => confirmationTokens.has(token));
  const confirmAndRegister = /^(?:(?:si|dale)\s+)?(?:confirma|confirmar|confirmo)(?:\s+y)?\s+(?:registra|registrar|registro|registralo|anota|anotar|anotalo)(?:\s+por\s+favor)?$/.test(normalized);
  if (onlyConfirmations
    || confirmAndRegister
    || /^(?:confirma|confirmar|confirmo|si confirma|si confirmar|registralo|anotalo|esta bien|todo bien|listo confirma|de acuerdo)$/.test(normalized)) return "confirm";
  const editActions = new Set([
    "edita", "editar", "edite", "editarlo", "editame", "evita", "evitar",
    "corrige", "corregir", "corrijamos", "corrigelo", "corregirlo",
    "limpia", "limpiar", "limpialo", "limpiarlo", "limpiame",
    "borra", "borrar", "borralo", "elimina", "eliminar",
    "cambia", "cambiar", "cambialo", "cambiarlo",
  ]);
  const editFillers = new Set([
    "y", "o", "el", "la", "los", "las", "lo", "ese", "esa", "esto", "eso",
    "comando", "borrador", "instruccion", "tarea", "anterior", "todo",
    "por", "favor", "quiero", "necesito", "podemos", "vamos", "a", "de", "nuevo", "mejor",
  ]);
  const hasEditAction = tokens.some((token) => editActions.has(token));
  const onlyEditControl = tokens.length <= 11 && hasEditAction && tokens.every((token) => editActions.has(token) || editFillers.has(token));
  if (onlyEditControl || /^(?:espera|no espera|me equivoque|empezar de nuevo|comenzar de nuevo|reiniciar comando|otra orden)$/.test(normalized)) return "edit";
  const cancelActions = new Set([
    "cancela", "cancelar", "cancelalo", "cancele", "cancelo", "cansela", "canselar",
    "descarta", "descartar", "descartalo", "olvida", "olvidar", "olvidalo",
  ]);
  const cancelFillers = new Set([
    "el", "la", "lo", "los", "las", "ese", "esa", "esto", "eso", "comando", "borrador",
    "instruccion", "tarea", "todo", "por", "favor", "quiero", "mejor", "vamos", "a", "de", "nuevo",
  ]);
  const hasCancelAction = tokens.some((token) => cancelActions.has(token));
  const onlyCancelControl = tokens.length <= 10 && hasCancelAction && tokens.every((token) => cancelActions.has(token) || cancelFillers.has(token));
  if (onlyCancelControl || /^(?:dejalo asi|dejemoslo asi|mejor no|no lo hagas|no hagas nada|no registres|no registrar|olvidalo)$/.test(normalized)) return "cancel";
  if (/^(?:repite|repetir|repite resumen|repetir resumen|lee el resumen|que entendiste|como quedo|dime que entendiste|otra vez)$/.test(normalized)) return "repeat";
  if (/^(?:nuevo comando|nueva orden|volver a escuchar|escuchar de nuevo)$/.test(normalized)) return "new";
  return null;
}

export function selectKitchenVoiceControl(alternatives = []) {
  const matches = (Array.isArray(alternatives) ? alternatives : [])
    .map((alternative) => ({
      transcript: String(alternative?.transcript || "").trim(),
      confidence: Number(alternative?.confidence || 0),
      control: kitchenVoiceControl(alternative?.transcript),
    }))
    .filter((alternative) => alternative.transcript && alternative.control);
  const controls = new Set(matches.map((alternative) => alternative.control));
  if (controls.size !== 1) return { transcript: "", control: null, ambiguous: controls.size > 1 };
  matches.sort((left, right) => right.confidence - left.confidence);
  return { ...matches[0], ambiguous: false };
}

export function combineKitchenVoiceAlternatives(resultGroups = []) {
  const groups = (Array.isArray(resultGroups) ? resultGroups : [])
    .map((group) => (Array.isArray(group) ? group : []).filter((alternative) => String(alternative?.transcript || "").trim()))
    .filter((group) => group.length);
  if (!groups.length) return [];
  const width = Math.min(5, Math.max(...groups.map((group) => group.length)));
  return Array.from({ length: width }, (_, rank) => {
    const selected = groups.map((group) => group[rank] || group[0]);
    const confidences = selected.map((alternative) => Number(alternative?.confidence || 0));
    return {
      transcript: selected.map((alternative) => String(alternative?.transcript || "").trim()).filter(Boolean).join(" "),
      confidence: confidences.length ? confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length : 0,
    };
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function catalogEntry(value) {
  if (typeof value === "string") return { id: value, name: value, type: "", wastePercent: 0 };
  return {
    ...value,
    id: value.id ?? value.nombre ?? value.name,
    name: value.nombre ?? value.name ?? String(value.id || ""),
    type: value.tipo ?? value.type ?? "",
    wastePercent: Number(value.mermaPct ?? value.wastePercent ?? 0),
  };
}

const KITCHEN_UNPAID_ORDER_STATES = new Set(["Nuevo", "Confirmado", "Pendiente de pago"]);

export function canReceiveKitchenOrderAlerts(role) {
  return ["Administrador", "Cocina", "Empaque"].includes(String(role || "").trim());
}

export function canReceiveKitchenDelayReminders(role) {
  return ["Administrador", "Cocina", "Empaque"].includes(String(role || "").trim());
}

export function kitchenOrderStateEvents(orders = [], knownStates = new Map()) {
  const previous = knownStates instanceof Map ? knownStates : new Map();
  const nextStates = new Map(previous);
  const events = [];
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    if (!order?.id) return;
    const wasKnown = previous.has(order.id);
    const previousState = previous.get(order.id);
    if (!wasKnown) events.push({ order, type: "new" });
    else if (KITCHEN_UNPAID_ORDER_STATES.has(previousState) && order.estado === "Pagado") {
      events.push({ order, type: "paid", previousState });
    } else if (previousState === "En producción" && order.estado === "Listo para empaque") {
      events.push({ order, type: "ready_for_packing", previousState });
    }
    nextStates.set(order.id, order.estado || "");
  });
  return { events, nextStates };
}

export function kitchenOrderAlert(order, catalogs = {}, { eventType = "new" } = {}) {
  if (!order?.id) return null;
  const customers = catalogs.customers || [];
  const products = (catalogs.products || []).map(catalogEntry);
  const productById = new Map(products.map((product) => [product.id, product]));
  const allItems = (catalogs.orderItems || []).filter((item) => item?.orderId === order.id);
  const rootItems = allItems.filter((item) => !item?.parentItemId && !item?.esSubMomo);
  const visibleItems = (rootItems.length ? rootItems : allItems).slice(0, 10);
  const customer = customers.find((item) => item?.id === order.customerId)?.nombre || "";
  const childrenFor = (item) => allItems.filter((child) => child?.parentItemId === item?.id
    || (item?.cajaNum !== undefined && item?.cajaNum !== null && child?.esSubMomo && child?.cajaNum === item.cajaNum));

  const describeDetails = (item, name) => {
    const normalizedName = normalizeKitchenVoice(name);
    const details = [];
    if (item?.sabor && !normalizedName.includes(normalizeKitchenVoice(item.sabor))) details.push(`sabor ${item.sabor}`);
    if (item?.figura) details.push(`figura ${item.figura}`);
    if (item?.salsa) details.push(`salsa ${item.salsa}`);
    if (item?.relleno) details.push(`relleno ${item.relleno}`);
    const additions = (item?.adiciones || []).map((addition) => addition?.nombre).filter(Boolean);
    if (additions.length) details.push(`adiciones ${additions.join(" y ")}`);
    return details.length ? `, ${details.join(", ")}` : "";
  };
  const describeItem = (item) => {
    const name = item?.nombre || productById.get(item?.productId)?.name || "producto";
    const quantity = Math.max(1, Number(item?.cant || 1));
    const main = `${quantity === 1 ? "una unidad" : `${quantity} unidades`} de ${name}${describeDetails(item, name)}`;
    const children = childrenFor(item);
    if (!children.length) return main;
    const childSummary = children.slice(0, 6).map((child) => {
      const childName = child?.figura || child?.nombre || productById.get(child?.productId)?.name || "Momo";
      return `${childName}${child?.sabor ? ` de ${child.sabor}` : ""}${child?.salsa ? ` con salsa ${child.salsa}` : ""}`;
    }).join(", ");
    return `${main}; incluye ${childSummary}`;
  };

  const content = visibleItems.length ? visibleItems.map(describeItem).join("; ") : "productos todavía sin detalle";
  const operationalItems = visibleItems.map((item) => {
    const children = childrenFor(item);
    return {
      id: item?.id || "",
      name: item?.nombre || productById.get(item?.productId)?.name || "Producto",
      quantity: Math.max(1, Number(item?.cant || 1)),
      figures: [...new Set([item?.figura, ...children.map((child) => child?.figura)].filter(Boolean))],
      flavors: [...new Set([item?.sabor, ...children.map((child) => child?.sabor)].filter(Boolean))],
    };
  });
  const figures = [...new Set(operationalItems.flatMap((item) => item.figures))];
  const flavors = [...new Set(operationalItems.flatMap((item) => item.flavors))];
  const pendingPayment = KITCHEN_UNPAID_ORDER_STATES.has(order.estado);
  const stateText = order.estado === "Pagado"
    ? "Está pagada y lista para iniciar en cocina."
    : order.estado === "Listo para empaque"
      ? "Cocina la terminó y está esperando al equipo de Empaque."
    : pendingPayment
      ? `Está ${order.estado || "pendiente"}; todavía no la prepares hasta que figure Pagado.`
      : `Estado actual: ${order.estado || "sin estado"}.`;
  return {
    eventType,
    orderId: order.id,
    customerName: customer,
    content,
    items: operationalItems,
    figures,
    flavors,
    state: order.estado || "",
    canPrepare: order.estado === "Pagado",
    canPack: order.estado === "Listo para empaque",
    text: eventType === "ready_for_packing"
      ? `Pedido ${order.id}${customer ? ` de ${customer}` : ""} listo para empaque. Empaque, ya pueden tomar la comanda. Contiene ${content}.`
      : eventType === "paid"
      ? `Pedido ${order.id}${customer ? ` de ${customer}` : ""} confirmado como pagado. Cocina, ya pueden prepararlo. Contiene ${content}.`
      : `Nueva orden ${order.id}${customer ? ` de ${customer}` : ""}. Contiene ${content}. ${stateText}`,
  };
}

export const DEFAULT_KITCHEN_DELAY_SETTINGS = Object.freeze({
  demoraCocinaMin: 15,
  demoraCocinaUrgenteMin: 30,
  demoraEmpaqueMin: 10,
  demoraEmpaqueUrgenteMin: 20,
  demoraRepeticionMin: 5,
});

const positiveInteger = (value, fallback) => {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function normalizeKitchenDelaySettings(value = {}) {
  const demoraCocinaMin = positiveInteger(value?.demoraCocinaMin, DEFAULT_KITCHEN_DELAY_SETTINGS.demoraCocinaMin);
  const demoraEmpaqueMin = positiveInteger(value?.demoraEmpaqueMin, DEFAULT_KITCHEN_DELAY_SETTINGS.demoraEmpaqueMin);
  return {
    demoraCocinaMin,
    demoraCocinaUrgenteMin: Math.max(
      demoraCocinaMin,
      positiveInteger(value?.demoraCocinaUrgenteMin, DEFAULT_KITCHEN_DELAY_SETTINGS.demoraCocinaUrgenteMin),
    ),
    demoraEmpaqueMin,
    demoraEmpaqueUrgenteMin: Math.max(
      demoraEmpaqueMin,
      positiveInteger(value?.demoraEmpaqueUrgenteMin, DEFAULT_KITCHEN_DELAY_SETTINGS.demoraEmpaqueUrgenteMin),
    ),
    demoraRepeticionMin: positiveInteger(value?.demoraRepeticionMin, DEFAULT_KITCHEN_DELAY_SETTINGS.demoraRepeticionMin),
  };
}

function bogotaOperationalTime(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return match ? Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4] || "00"}-05:00`) : Number.NaN;
}

export function kitchenDelayedOrderReminders(catalogs = {}, now = Date.now(), settings = DEFAULT_KITCHEN_DELAY_SETTINGS) {
  const orders = catalogs.orders || [];
  const audits = catalogs.auditLogs || catalogs.audit_logs || [];
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const timing = normalizeKitchenDelaySettings(settings);
  const reminders = [];

  orders.forEach((order) => {
    const isKitchen = order?.estado === "En producción";
    const isPacking = order?.estado === "Listo para empaque" || order?.estado === "Empacado";
    const thresholdMinutes = isKitchen
      ? timing.demoraCocinaMin
      : isPacking
        ? timing.demoraEmpaqueMin
        : 0;
    const urgentMinutes = isKitchen
      ? timing.demoraCocinaUrgenteMin
      : isPacking
        ? timing.demoraEmpaqueUrgenteMin
        : 0;
    if (!order?.id || !(thresholdMinutes > 0)) return;
    const stateAudit = audits
      .filter((audit) => audit?.entidad === "Pedido"
        && audit?.entidadId === order.id
        && audit?.accion === "Cambio de estado"
        && audit?.a === order.estado)
      .reduce((latest, audit) => {
        const auditMs = bogotaOperationalTime(audit.fecha);
        const latestMs = bogotaOperationalTime(latest?.fecha);
        return !latest || (Number.isFinite(auditMs) && (!Number.isFinite(latestMs) || auditMs > latestMs)) ? audit : latest;
      }, null);
    const sinceMs = bogotaOperationalTime(stateAudit?.fecha);
    if (!Number.isFinite(sinceMs) || !Number.isFinite(nowMs) || nowMs < sinceMs) return;
    const elapsedMinutes = Math.floor((nowMs - sinceMs) / 60000);
    if (elapsedMinutes < thresholdMinutes) return;

    const urgent = elapsedMinutes >= urgentMinutes;
    const area = isKitchen ? "Cocina" : "Empaque";
    const nextAction = isKitchen
      ? "Revisen la preparación y confirmen Listo para empaque apenas termine."
      : order.estado === "Listo para empaque"
        ? "Empaque debe tomar la comanda y confirmar Empacado cuando termine."
        : "Revisen el empaque y pásenlo a Listo para despacho o En ruta según corresponda.";
    const alert = kitchenOrderAlert(order, catalogs);
    reminders.push({
      orderId: order.id,
      customerName: alert?.customerName || "",
      content: alert?.content || "productos todavía sin detalle",
      state: order.estado,
      area,
      since: stateAudit.fecha,
      elapsedMinutes,
      thresholdMinutes,
      urgentMinutes,
      repeatMinutes: timing.demoraRepeticionMin,
      urgent,
      repeatBucket: Math.floor((elapsedMinutes - thresholdMinutes) / timing.demoraRepeticionMin),
      nextAction,
      text: `${urgent ? "Urgente" : "Recordatorio"}: el pedido ${order.id} lleva ${elapsedMinutes} minutos en ${area}. Puede haberse quedado olvidado. ${nextAction}`,
    });
  });

  return reminders.sort((left, right) => Number(right.urgent) - Number(left.urgent)
    || right.elapsedMinutes - left.elapsedMinutes
    || String(left.orderId).localeCompare(String(right.orderId)));
}

export function kitchenReadyOrderCommands(catalogs = {}) {
  const orderMoment = (order) => `${String(order?.fecha || "").trim()}T${String(order?.hora || "").trim()}`;
  return (catalogs.orders || [])
    .filter((order) => order?.id && order.estado === "Pagado")
    .slice()
    .sort((left, right) => orderMoment(left).localeCompare(orderMoment(right)) || String(left.id).localeCompare(String(right.id)))
    .map((order) => ({
      ...kitchenOrderAlert(order, catalogs),
      date: order.fecha || "",
      time: order.hora || "",
    }));
}

export function kitchenOrderQueueAnswer(value, catalogs = {}) {
  const normalized = normalizeKitchenVoice(value);
  const asksForQueue = /(?:^|\s)(?:que|cual|cuales|cuantos|dime|decime|muestra|muestrame|revisa|quiero saber)(?:\s+\w+){0,8}\s+(?:pedido|pedidos|orden|ordenes)(?:\s+\w+){0,6}\s+(?:cola|pendiente|pendientes|preparar|hacer)(?=\s|$)/.test(normalized)
    || /(?:^|\s)(?:que|cual|cuantos)(?:\s+\w+){0,5}\s+(?:hay|tenemos|sigue)(?:\s+\w+){0,5}\s+(?:cola|cocina|produccion|preparar)(?=\s|$)/.test(normalized)
    || /^(?:que|cual)\s+sigue\s+en\s+cocina$/.test(normalized)
    || /^(?:(?:yo\s+)?no\s+)?(?:tengo|tenemos|veo|vemos|encuentro|encontramos|aparece|aparecen|hay)(?:\s+\w+){0,5}\s+(?:pedido|pedidos|orden|ordenes)(?:\s+\w+){0,5}\s+(?:cola|cocina|produccion)(?=\s|$)/.test(normalized)
    || /^(?:no\s+)?hay\s+(?:pedido|pedidos|orden|ordenes)(?:\s+\w+){0,5}\s+(?:cola|cocina|produccion)(?=\s|$)/.test(normalized);
  if (!asksForQueue) return null;

  const orders = (catalogs.orders || []).filter((order) => order?.id);
  const paid = orders.filter((order) => order.estado === "Pagado");
  const inProduction = orders.filter((order) => order.estado === "En producción");
  const readyForPacking = orders.filter((order) => order.estado === "Listo para empaque");
  const waitingPayment = orders.filter((order) => KITCHEN_UNPAID_ORDER_STATES.has(order.estado));
  const describe = (order) => {
    const alert = kitchenOrderAlert(order, catalogs);
    return `${order.id}${alert?.customerName ? ` de ${alert.customerName}` : ""}: ${alert?.content || "sin detalle"}`;
  };
  const describeList = (list) => {
    const visible = list.slice(0, 4).map(describe).join("; ");
    return list.length > 4 ? `${visible}; y ${list.length - 4} pedido${list.length - 4 === 1 ? "" : "s"} más` : visible;
  };

  const parts = [];
  if (paid.length) parts.push(`Hay ${paid.length} pedido${paid.length === 1 ? "" : "s"} pagado${paid.length === 1 ? "" : "s"} por iniciar en cocina: ${describeList(paid)}.`);
  else parts.push("No hay pedidos pagados esperando iniciar en cocina.");
  if (inProduction.length) parts.push(`${inProduction.length === 1 ? "Ya está en producción" : "Ya están en producción"}: ${describeList(inProduction)}.`);
  if (readyForPacking.length) parts.push(`${readyForPacking.length === 1 ? "Está listo para empaque" : "Están listos para empaque"}: ${describeList(readyForPacking)}.`);
  if (waitingPayment.length) parts.push(`Además hay ${waitingPayment.length} pedido${waitingPayment.length === 1 ? "" : "s"} pendiente${waitingPayment.length === 1 ? "" : "s"} de pago; todavía no se prepara${waitingPayment.length === 1 ? "" : "n"}.`);

  return {
    matched: true,
    text: parts.join(" "),
    paidOrderIds: paid.map((order) => order.id),
    inProductionOrderIds: inProduction.map((order) => order.id),
    readyForPackingOrderIds: readyForPacking.map((order) => order.id),
    waitingPaymentOrderIds: waitingPayment.map((order) => order.id),
  };
}

export function kitchenOrderLookupAnswer(value, catalogs = {}) {
  const normalized = normalizeKitchenVoice(value);
  const orderMatch = normalized.match(/(?:^|\s)(?:pedido|orden)(?:\s+(?:numero|ps|pe|p|n))?\s+(\d+)(?=\s|$)/);
  if (!orderMatch) return null;

  const asksForDetails = /(?:^|\s)(?:que|cual|dime|decime|lee|leeme|leer|muestra|muestrame|revisa|consultar|consulta|informa|informame|quiero\s+saber)(?=\s|$)/.test(normalized)
    && /(?:^|\s)(?:tiene|trae|contiene|incluye|es|detalle|detalles|productos|comanda|pedido|orden|estado)(?=\s|$)/.test(normalized);
  if (!asksForDetails) return null;

  const spokenOrderNumber = Number(orderMatch[1]);
  const order = (catalogs.orders || []).find((item) => batchNumericId(item?.id) === spokenOrderNumber) || null;
  if (!order) {
    return {
      matched: true,
      orderId: `P-${spokenOrderNumber}`,
      state: "",
      canPrepare: false,
      content: "",
      text: `No encontré el pedido ${spokenOrderNumber}. Revisá el número y preguntame otra vez.`,
    };
  }

  const alert = kitchenOrderAlert(order, catalogs);
  const customer = alert?.customerName ? ` de ${alert.customerName}` : "";
  const stateText = order.estado === "Pagado"
    ? "Está pagado y Cocina puede iniciarlo."
    : order.estado === "En producción"
      ? "Ya está en producción."
      : order.estado === "Listo para empaque"
        ? "Cocina ya lo terminó y está esperando a Empaque."
      : order.estado === "Cancelado"
        ? "Está cancelado y no debe prepararse."
        : KITCHEN_UNPAID_ORDER_STATES.has(order.estado)
          ? `Está ${order.estado || "pendiente"}; todavía no debe prepararse hasta confirmar el pago.`
          : `Su estado actual es ${order.estado || "sin estado"}.`;
  return {
    matched: true,
    orderId: order.id,
    state: order.estado || "",
    canPrepare: order.estado === "Pagado",
    content: alert?.content || "productos todavía sin detalle",
    text: `El pedido ${order.id}${customer} tiene ${alert?.content || "productos todavía sin detalle"}. ${stateText}`,
  };
}

function correctionRecord(corrections, heard, understoodAs, source) {
  const normalizedHeard = String(heard || "").trim();
  if (!normalizedHeard || normalizeKitchenVoice(normalizedHeard) === normalizeKitchenVoice(understoodAs)) return;
  const key = `${normalizeKitchenVoice(normalizedHeard)}>${normalizeKitchenVoice(understoodAs)}`;
  if (!corrections.some((item) => item.key === key)) corrections.push({ key, heard: normalizedHeard, understoodAs, source });
}

function applyContextualFigureAliases(text, corrections) {
  return text.replace(
    /(^|\s)(\d+(?:\.\d+)?)\s+(?:unidades?\s+(?:de\s+)?)?ganas(?=\s|$)/g,
    (match, prefix, quantity) => {
      correctionRecord(corrections, "ganas", "Danna", "figure-context");
      return `${prefix}${quantity} danna`;
    },
  );
}

function catalogNames(catalogs = {}) {
  const dynamic = [
    ...(catalogs.flavors || []),
    ...(catalogs.figures || []),
    ...(catalogs.subrecipes || []),
    ...(catalogs.products || []),
    ...(catalogs.inventory || []),
    ...(catalogs.extras || []),
    ...(catalogs.batches || []),
  ].map(catalogEntry);
  const subrecipeEntries = (catalogs.subrecipes || []).map(catalogEntry);
  const subrecipeTypes = subrecipeEntries.flatMap((entry) => [entry.type, entry.sabor]).filter(Boolean);
  const subrecipeVariants = subrecipeEntries.filter((entry) => entry.sabor && entry.type).map((entry) => {
    const type = normalizeKitchenVoice(entry.type);
    const baseType = type.startsWith("mousse") ? "mousse" : type;
    return `${baseType} de ${entry.sabor}`;
  });
  const batchVariants = (catalogs.batches || []).flatMap((batch) => {
    const id = String(batch?.id || "").trim();
    const number = id.match(/(\d+)$/)?.[1];
    return number ? [id, `lote ${Number(number)}`, `lote ${number}`] : [id];
  });
  return [...kitchenTaskVocabularyPhrases(), ...KITCHEN_CORE_TERMS, ...KITCHEN_ALIAS_GROUPS.map((group) => group.canonical), ...dynamic.map((entry) => entry.name), ...subrecipeTypes, ...subrecipeVariants, ...batchVariants]
    .map((name) => String(name || "").trim())
    .filter(Boolean);
}

export function kitchenVocabularyPhrases(catalogs = {}) {
  const seen = new Set();
  return catalogNames(catalogs).filter((name) => {
    const normalized = normalizeKitchenVoice(name);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function applyKnownAliases(text, corrections) {
  let corrected = text;
  const replacements = KITCHEN_ALIAS_GROUPS.flatMap((group) => {
    const canonical = normalizeKitchenVoice(group.canonical);
    return group.aliases.map((alias) => ({ alias: normalizeKitchenVoice(alias), canonical, label: group.canonical }));
  }).filter((item) => item.alias && item.alias !== item.canonical)
    .sort((a, b) => b.alias.length - a.alias.length);

  replacements.forEach(({ alias, canonical, label }) => {
    const regex = new RegExp(`(^|\\s)${escapeRegExp(alias)}(?=\\s|$)`, "g");
    corrected = corrected.replace(regex, (match, prefix) => {
      correctionRecord(corrections, alias, label, "alias");
      return prefix + canonical;
    });
  });
  return corrected;
}

function applyContextualMousseAliases(text, corrections) {
  if (!/(?:^|\s)mousse(?=\s|$)/.test(text)) return text;

  // El reconocimiento de voz convierte con frecuencia "Milo"/"de Milo" en
  // "mil" o "de 1000". Solo lo corregimos dentro de una conversación sobre
  // mousse y cuando 1000 NO lleva una unidad de peso; así "1000 gramos de
  // mousse" conserva intacta su cantidad real.
  return text.replace(/(^|\s)de\s+1000(?!\s*(?:g|gr|grs|gramos?|kg|kilos?|kilogramos?)\b)(?=\s|$)/g, (match, prefix) => {
    correctionRecord(corrections, "1000", "Milo", "context");
    return `${prefix}de milo`;
  });
}

function editDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

let taskAliasOnlyCache = null;

function taskAliasOnlyTerms() {
  if (taskAliasOnlyCache) return taskAliasOnlyCache;
  const canonicals = new Set(KITCHEN_TASK_GROUPS.map((group) => normalizeKitchenVoice(group.canonical)));
  taskAliasOnlyCache = new Set(
    KITCHEN_TASK_GROUPS.flatMap((group) => group.aliases.map((alias) => normalizeKitchenVoice(alias)))
      .filter((alias) => alias && !canonicals.has(alias)),
  );
  return taskAliasOnlyCache;
}

function fuzzyVocabularyTerms(catalogs) {
  const seen = new Set();
  const taskAliases = taskAliasOnlyTerms();
  return kitchenVocabularyPhrases(catalogs).map((label) => {
    const normalized = normalizeKitchenVoice(label);
    return { label, normalized, tokens: normalized.split(" ") };
  }).filter((term) => {
    const compact = term.normalized.replace(/\s/g, "");
    if (compact.length < 5 || term.tokens.length > 3 || /\d/.test(term.normalized) || taskAliases.has(term.normalized) || seen.has(term.normalized)) return false;
    seen.add(term.normalized);
    return true;
  });
}

function applyFuzzyCatalog(text, catalogs, corrections) {
  const tokens = text.split(" ").filter(Boolean);
  const terms = fuzzyVocabularyTerms(catalogs);
  const output = [];
  for (let i = 0; i < tokens.length;) {
    const candidates = [];
    terms.forEach((term) => {
      const count = term.tokens.length;
      if (i + count > tokens.length) return;
      const heard = tokens.slice(i, i + count).join(" ");
      if (heard === term.normalized || /\d/.test(heard)) return;
      const compactLength = term.normalized.replace(/\s/g, "").length;
      const distance = editDistance(heard, term.normalized);
      const maxDistance = compactLength >= 9 ? 2 : 1;
      if (distance <= maxDistance && distance / Math.max(heard.length, term.normalized.length) <= 0.22 && heard[0] === term.normalized[0]) {
        candidates.push({ ...term, heard, distance, ratio: distance / Math.max(heard.length, term.normalized.length) });
      }
    });

    candidates.sort((a, b) => a.ratio - b.ratio || a.distance - b.distance || b.tokens.length - a.tokens.length);
    const best = candidates[0];
    const tied = best && candidates.some((candidate, index) => index > 0 && candidate.ratio === best.ratio && candidate.distance === best.distance && candidate.normalized !== best.normalized);
    if (best && !tied) {
      output.push(...best.tokens);
      correctionRecord(corrections, best.heard, best.label, "catalog");
      i += best.tokens.length;
    } else {
      output.push(tokens[i]);
      i += 1;
    }
  }
  return output.join(" ");
}

export function correctKitchenVocabulary(transcript, catalogs = {}) {
  const heardNormalized = normalizeKitchenVoice(transcript);
  const corrections = [];
  const withFigureContext = applyContextualFigureAliases(heardNormalized, corrections);
  const withAliases = applyKnownAliases(withFigureContext, corrections);
  const withMousseContext = applyContextualMousseAliases(withAliases, corrections);
  const correctedTranscript = applyFuzzyCatalog(withMousseContext, catalogs, corrections);
  return { heardNormalized, correctedTranscript, corrections: corrections.map(({ key, ...item }) => item) };
}

function includesName(text, name, plural = false) {
  const normalized = normalizeKitchenVoice(name);
  if (!normalized) return false;
  const suffix = plural ? "(?:s|es)?" : "";
  return new RegExp(`(?:^|\\s)${escapeRegExp(normalized)}${suffix}(?=\\s|$)`).test(text);
}

function findSubrecipe(text, subrecipes) {
  const entries = subrecipes.map(catalogEntry);
  const direct = entries.filter((entry) => includesName(text, entry.name));
  if (direct.length === 1) return { entry: direct[0], ambiguous: [] };
  if (direct.length > 1) return { entry: null, ambiguous: direct };

  const typesMentioned = ["ganache", "cheesecake", "salsa", "crocante", "mousse"]
    .filter((type) => new RegExp(`(?:^|\\s)${type}(?=\\s|$)`).test(text));
  if (!typesMentioned.length) return { entry: null, ambiguous: [] };
  const byType = entries.filter((entry) => {
    const type = normalizeKitchenVoice(entry.type);
    const name = normalizeKitchenVoice(entry.name);
    return typesMentioned.some((mentioned) => type.includes(mentioned) || name.includes(mentioned));
  });
  return byType.length === 1 ? { entry: byType[0], ambiguous: [] } : { entry: null, ambiguous: byType };
}

function extractGramAmountsDetailed(text) {
  const values = [];
  const regex = /(\d+(?:\.\d+)?)\s*(kilogramos?|kilos?|kg|gramos?|grs?|gr|g)(?=\s|$)/g;
  let match;
  while ((match = regex.exec(text))) {
    const amount = Number(match[1]);
    const unit = match[2];
    values.push({
      grams: unit.startsWith("k") ? amount * 1000 : amount,
      index: match.index,
      end: regex.lastIndex,
    });
  }
  return values;
}

function extractGramAmounts(text) {
  return extractGramAmountsDetailed(text).map((amount) => amount.grams);
}

function subrecipeMentions(text, subrecipes) {
  const entries = subrecipes.map(catalogEntry);
  const typeCounts = entries.reduce((counts, entry) => {
    const type = normalizeKitchenVoice(entry.type);
    if (type) counts.set(type, (counts.get(type) || 0) + 1);
    return counts;
  }, new Map());
  const mentions = [];
  const seen = new Set();

  entries.forEach((entry) => {
    const type = normalizeKitchenVoice(entry.type);
    const labels = [normalizeKitchenVoice(entry.name)];
    if (type && typeCounts.get(type) === 1) labels.push(type);
    if (entry.sabor && type) {
      const baseType = type.startsWith("mousse") ? "mousse" : type;
      labels.push(`${baseType} de ${normalizeKitchenVoice(entry.sabor)}`);
    }
    if (type === "ganache") labels.push("ganache chocolate");
    [...new Set(labels.filter(Boolean))].sort((a, b) => b.length - a.length).forEach((label) => {
      const regex = new RegExp(`(?:^|\\s)${escapeRegExp(label)}(?=\\s|$)`, "g");
      let match;
      while ((match = regex.exec(text))) {
        const index = match.index + (match[0].startsWith(" ") ? 1 : 0);
        const key = `${entry.id}:${index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mentions.push({ entry, index, end: index + label.length });
      }
    });
  });
  return mentions.sort((a, b) => a.index - b.index || b.end - b.index - (a.end - a.index));
}

function preparationUsage(entry, catalogs) {
  const filling = (catalogs.figureFillings || []).find((relation) => relation?.activo !== false
    && (relation?.subrecetaId ?? relation?.subreceta_id) === entry.id);
  if (filling) {
    const grams = Number((filling.gramosPorUnidad ?? filling.gramos_por_unidad) || 0);
    const label = entry.type === "ganache" ? "Relleno de chocolate para figuras" : "Relleno para figuras";
    return grams > 0 ? `${label} · ${grams} g por figura` : label;
  }
  if (entry.type === "salsa") return "Salsa de acabado";
  if (String(entry.type).startsWith("mousse")) return "Base de sabor para figuras";
  return "Base de producción";
}

function parsePreparations(text, catalogs, warnings, errors) {
  const subrecipes = catalogs.subrecipes || [];
  const amounts = extractGramAmountsDetailed(text);
  const mentions = subrecipeMentions(text, subrecipes);
  const trigger = /(?:prepar|hicimos|hizo|hacer|registr|ingres|produj|salieron|obtu)/.test(text);
  if (!trigger) return [];
  if (!amounts.length) {
    if (mentions.length) {
      const names = [...new Map(mentions.map(({ entry }) => [entry.id, entry.name])).values()];
      errors.push(`Me falta la cantidad de ${names.join(" y ")}.`);
    }
    return [];
  }
  if (!mentions.length) {
    const match = findSubrecipe(text, subrecipes);
    if (match.ambiguous.length) errors.push(`No sé cuál base elegir: ${match.ambiguous.map((entry) => entry.name).join(", ")}.`);
    else errors.push("Escuché una preparación en gramos, pero no reconocí la base o subreceta.");
    return [];
  }

  const grouped = new Map();
  amounts.forEach((amount) => {
    const closest = mentions.reduce((best, mention) => {
      const rawDistance = amount.end < mention.index ? mention.index - amount.end
        : mention.end < amount.index ? amount.index - mention.end
        : 0;
      const between = amount.end < mention.index ? text.slice(amount.end, mention.index)
        : mention.end < amount.index ? text.slice(mention.end, amount.index)
        : "";
      const clausePenalty = /(?:^|\s)(?:y|luego|despues|ademas|tambien)(?=\s|$)/.test(between) ? 1000 : 0;
      const amountIntroducesFollowingBase = amount.end <= mention.index && /^\s*de\s*$/.test(between);
      const distance = rawDistance + clausePenalty - (amountIntroducesFollowingBase ? 100 : 0);
      return !best || distance < best.distance ? { mention, distance } : best;
    }, null);
    if (!closest) return;
    const id = closest.mention.entry.id;
    if (!grouped.has(id)) grouped.set(id, { entry: closest.mention.entry, amounts: [] });
    grouped.get(id).amounts.push(amount);
  });

  const mentionedEntries = [...new Map(mentions.map(({ entry }) => [entry.id, entry])).values()];
  mentionedEntries.filter((entry) => !grouped.has(entry.id))
    .forEach((entry) => errors.push(`Me falta la cantidad de ${entry.name}.`));

  return [...grouped.values()].sort((left, right) => left.amounts[0].index - right.amounts[0].index).map(({ entry, amounts: ownAmounts }) => {
    const nominalGrams = ownAmounts[0].grams;
    const betweenAmounts = ownAmounts.length > 1
      ? text.slice(ownAmounts[0].end, ownAmounts[ownAmounts.length - 1].index)
      : "";
    const explicitObtained = ownAmounts.length > 1 && /(?:salieron|obtenidos|obtuvo|rindio|rindieron)/.test(betweenAmounts);
    const obtainedGrams = explicitObtained
      ? ownAmounts[ownAmounts.length - 1].grams
      : Math.round(nominalGrams * (1 - Math.max(0, entry.wastePercent) / 100) * 10) / 10;
    if (!explicitObtained) warnings.push(`Usé ${obtainedGrams} g obtenidos para ${entry.name}, según su merma esperada. Podés corregirlo antes de confirmar.`);
    return {
      subrecipeId: entry.id,
      subrecipeName: entry.name,
      nominalGrams,
      obtainedGrams,
      usage: preparationUsage(entry, catalogs),
    };
  });
}

function findFigure(text, figures) {
  return figures.map(catalogEntry)
    .sort((a, b) => normalizeKitchenVoice(b.name).length - normalizeKitchenVoice(a.name).length)
    .find((entry) => includesName(text, entry.name, true)) || null;
}

function flavorRuns(text, flavors) {
  const entries = flavors.map(catalogEntry);
  const totals = new Map(entries.map((flavor) => [flavor.id, { flavor: flavor.name, quantity: 0, position: Number.POSITIVE_INFINITY }]));
  const claimedNumbers = new Set();

  entries.forEach((flavor) => {
    const normalized = normalizeKitchenVoice(flavor.name);
    const afterFlavor = new RegExp(`(?:^|\\s)${escapeRegExp(normalized)}(?:s|es)?\\s+(?:son|van|serian|seran|hago|hacemos|pon|coloca)\\s+(\\d+(?:\\.\\d+)?)(?=\\s|$)`, "g");
    let match;
    while ((match = afterFlavor.exec(text))) {
      const numberPosition = match.index + match[0].lastIndexOf(match[1]);
      claimedNumbers.add(numberPosition);
      const total = totals.get(flavor.id);
      total.quantity += Number(match[1]);
      total.position = Math.min(total.position, match.index);
    }
  });

  entries.forEach((flavor) => {
    const normalized = normalizeKitchenVoice(flavor.name);
    const beforeFlavor = new RegExp(`(?:^|\\s)(\\d+(?:\\.\\d+)?)\\s*(?:(?:de|para|van\\s+de|seran\\s+de)\\s+)?${escapeRegExp(normalized)}(?:s|es)?(?=\\s|$)`, "g");
    let match;
    while ((match = beforeFlavor.exec(text))) {
      const numberPosition = match.index + match[0].indexOf(match[1]);
      if (claimedNumbers.has(numberPosition)) continue;
      const total = totals.get(flavor.id);
      total.quantity += Number(match[1]);
      total.position = Math.min(total.position, match.index);
    }
  });

  return [...totals.values()].filter((run) => run.quantity > 0)
    .sort((a, b) => a.position - b.position)
    .map(({ position, ...run }) => run);
}

function mentionedFlavors(text, flavors) {
  return flavors.map(catalogEntry).filter((flavor) => includesName(text, flavor.name, true));
}

function declaredProductionTotal(text, figure) {
  if (!figure) return null;
  const figurePattern = `${escapeRegExp(normalizeKitchenVoice(figure.name))}(?:s|es)?`;
  const directFigure = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s+(?:unidades?\\s+)?(?:de\\s+)?${figurePattern}(?=\\s|$)`));
  if (directFigure) return Number(directFigure[1]);

  // Forma natural frecuente en cocina: "quiero 20 postres de coco de Momo".
  // El sustantivo genérico separa el número tanto del sabor como de la figura,
  // por eso no lo capturan los patrones directos de "20 Momo" o "20 de coco".
  const genericProduct = text.match(
    /(?:^|\s)(?:quiero|queremos|necesito|necesitamos|preparar|producir|fabricar|moldear)(?:\s+(?:preparar|producir|fabricar|moldear))?\s+(?:unos?\s+)?(\d+(?:\.\d+)?)\s+(?:unidades?|piezas?|postres?|figuras?|momos?)(?=\s|$)/,
  );
  if (genericProduct) return Number(genericProduct[1]);

  const announced = text.match(/(?:en total|total de|van a ser|serian|seran)\s+(\d+(?:\.\d+)?)(?=\s|$)/);
  return announced ? Number(announced[1]) : null;
}

function parseProduction(text, figures, flavors, warnings, errors) {
  const figure = findFigure(text, figures);
  const hasProductionVerb = /(?:produc|fabric|corrida|moldear)/.test(text);
  if (!figure && !hasProductionVerb) return null;
  if (!figure) { errors.push("Escuché una producción, pero no reconocí la figura."); return null; }

  const declaredTotal = declaredProductionTotal(text, figure);
  const mentioned = mentionedFlavors(text, flavors);
  let runs = flavorRuns(text, flavors);
  if (!runs.length && declaredTotal) {
    if (mentioned.length === 1) runs = [{ flavor: mentioned[0].name, quantity: declaredTotal }];
  }
  if (!runs.length) {
    if (mentioned.length) errors.push(`Cantidad faltante por sabor: ${mentioned.map((item) => item.name).join(", ")}.`);
    else errors.push("No reconocí cantidades por sabor para la producción.");
    return null;
  }

  const quantifiedFlavors = new Set(runs.map((run) => normalizeKitchenVoice(run.flavor)));
  const missingFlavors = mentioned.filter((item) => !quantifiedFlavors.has(normalizeKitchenVoice(item.name)));
  if (missingFlavors.length) {
    errors.push(`Cantidad faltante por sabor: ${missingFlavors.map((item) => item.name).join(", ")}.`);
  }

  const calculatedTotal = runs.reduce((sum, run) => sum + run.quantity, 0);
  if (!missingFlavors.length && declaredTotal !== null && declaredTotal !== calculatedTotal) {
    errors.push(`El total anunciado es ${declaredTotal}, pero los sabores suman ${calculatedTotal}.`);
  }
  if (declaredTotal === null) warnings.push(`No escuché un total general; usaré la suma por sabores: ${calculatedTotal}.`);
  return { figure: figure.name, declaredTotal, calculatedTotal, runs };
}

function figureMentions(text, figures) {
  const mentions = [];
  figures.map(catalogEntry).forEach((entry) => {
    const label = normalizeKitchenVoice(entry.name);
    if (!label) return;
    const regex = new RegExp(`(?:^|\\s)${escapeRegExp(label)}(?:s|es)?(?=\\s|$)`, "g");
    let match;
    while ((match = regex.exec(text))) {
      const index = match.index + (match[0].startsWith(" ") ? 1 : 0);
      mentions.push({ entry, index, end: index + match[0].trim().length, start: index });
    }
  });

  mentions.sort((left, right) => left.index - right.index || right.end - right.index - (left.end - left.index));
  for (let i = 0; i < mentions.length; i += 1) {
    const previousEnd = i > 0 ? mentions[i - 1].end : 0;
    const prefix = text.slice(previousEnd, mentions[i].index);
    const amountBefore = prefix.match(/(?:^|\s)(\d+(?:\.\d+)?)\s+(?:unidades?\s+(?:de\s+)?)?$/);
    if (!amountBefore) continue;
    const offset = (amountBefore.index || 0) + (amountBefore[0].startsWith(" ") ? 1 : 0);
    mentions[i].start = previousEnd + offset;
  }
  return mentions;
}

function parseProductions(text, figures, flavors, warnings, errors) {
  const mentions = figureMentions(text, figures);
  const distinctFigures = new Set(mentions.map((mention) => mention.entry.id));
  if (mentions.length <= 1 || distinctFigures.size <= 1) {
    const production = parseProduction(text, figures, flavors, warnings, errors);
    return production ? [production] : [];
  }

  return mentions.map((mention, index) => {
    const nextStart = mentions[index + 1]?.start ?? text.length;
    const segment = text.slice(mention.start, nextStart).trim();
    return parseProduction(segment, [mention.entry.raw || mention.entry], flavors, warnings, errors);
  }).filter(Boolean);
}

function batchNumericId(value) {
  const match = String(value || "").match(/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function batchFigureNames(batch) {
  const mixed = Array.isArray(batch?.figuras) ? batch.figuras : [];
  return [batch?.figura, ...mixed.map((item) => typeof item === "string" ? item : item?.figura ?? item?.nombre ?? item?.name)]
    .map((name) => String(name || "").trim())
    .filter(Boolean);
}

function findBatchBySpokenNumber(text, batches) {
  const numberMatch = text.match(/(?:^|\s)lote\s+(?:numero\s+)?(\d+)(?=\s|$)/)
    || text.match(/(?:^|\s)l\s+(\d+)(?=\s|$)/);
  if (!numberMatch) return { batch: null, number: null };
  const number = Number(numberMatch[1]);
  return { batch: batches.find((item) => batchNumericId(item?.id) === number) || null, number };
}

function outcomeCount(text, labels) {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const candidates = [];
  const beforeLabels = [];
  for (const match of text.matchAll(new RegExp(`(?:^|\\s)(\\d+)\\s*(?:unidades?\\s+|piezas?\\s+)?(${labelPattern})(?=\\s|$)`, "g"))) {
    const matchIndex = match.index ?? 0;
    const labelStart = matchIndex + match[0].lastIndexOf(match[2]);
    const labelEnd = labelStart + match[2].length;
    beforeLabels.push({ labelStart, labelEnd });
    candidates.push({ index: labelStart, value: Number(match[1]) });
  }
  for (const match of text.matchAll(new RegExp(`(?:^|\\s)(${labelPattern})(?:\\s+(?:son|salieron|quedaron|hay|fueron))?\\s+(\\d+)(?=\\s|$)`, "g"))) {
    const matchIndex = match.index ?? 0;
    const labelStart = matchIndex + match[0].indexOf(match[1]);
    const labelEnd = labelStart + match[1].length;
    if (beforeLabels.some((before) => labelStart < before.labelEnd && labelEnd > before.labelStart)) continue;
    candidates.push({ index: labelStart, value: Number(match[2]) });
  }
  if (!candidates.length) return null;
  candidates.sort((left, right) => left.index - right.index);
  return candidates[candidates.length - 1].value;
}

function countedOutcome(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function parseExistingUnmolding(text, catalogs, errors, { readyForSaleIntent = false } = {}) {
  const batches = catalogs.batches || [];
  const { batch, number } = findBatchBySpokenNumber(text, batches);
  if (number === null) {
    errors.push("Para registrar perfectas, imperfectas y descartadas necesito el número del lote.");
    return null;
  }
  if (!batch) {
    errors.push(`No encontré el lote ${number}. Revisá el número antes de registrar el desmolde.`);
    return null;
  }

  const total = Number(batch.prod || 0);
  let perfectas = outcomeCount(text, ["perfectas", "perfecta"]);
  let imperfectas = outcomeCount(text, ["imperfectas", "imperfecta", "imperfectos", "imperfecto"]);
  let descartadas = outcomeCount(text, ["descartar", "descartadas", "descartada", "descartados", "descartado"]);
  const allPerfect = /(?:^|\s)(?:todos|todas)(?:\s+[a-z]+){0,2}\s+perfectas(?=\s|$)|(?:^|\s)perfectas\s+(?:todos|todas)(?=\s|$)/.test(text);
  if (allPerfect) {
    perfectas = total;
    imperfectas = 0;
    descartadas = 0;
  }
  const alreadyUnmolded = Boolean(batch.stockContabilizado)
    || String(batch.estado || "").toLowerCase() === "listo";
  if (alreadyUnmolded) {
    const currentPerfect = Number(batch.perfectas || 0);
    const currentImperfect = Number(batch.imperfectas || 0);
    const currentDiscarded = Number(batch.descartadas || 0);
    errors.push(`El lote ${batch.id} ya fue desmoldado y está ${batch.estado || "Listo"}: ${countedOutcome(currentPerfect, "perfecta", "perfectas")}, ${countedOutcome(currentImperfect, "imperfecta", "imperfectas")} y ${countedOutcome(currentDiscarded, "descartada", "descartadas")}. No cambiaré ese conteo ni el stock desde una orden nueva.`);
    return null;
  }
  if (!["En preparación", "Congelando"].includes(batch.estado)) {
    errors.push(`El lote ${batch.id} está ${String(batch.estado || "en otro estado").toLowerCase()}; solo puedo registrar su desmolde si está en preparación o congelando.`);
    return null;
  }

  const missing = [
    perfectas === null ? "perfectas" : null,
    imperfectas === null ? "imperfectas" : null,
    descartadas === null ? "descartadas" : null,
  ].filter(Boolean);
  if (missing.length) {
    errors.push(readyForSaleIntent
      ? `Entendí que ${batch.id} terminó y querés dejarlo Listo para vender. Antes debo registrar su desmolde: el lote produjo ${total} unidades; decime cuántas salieron perfectas, imperfectas y descartadas, incluso cuando alguna sea cero.`
      : `Para desmoldar ${batch.id} me faltan estos conteos: ${missing.join(", ")}. El lote produjo ${total} unidades y necesito perfectas, imperfectas y descartadas, incluso cuando alguna sea cero.`);
    return null;
  }
  if (perfectas + imperfectas + descartadas !== total) {
    errors.push(`Los conteos del lote ${batch.id} suman ${perfectas + imperfectas + descartadas}, pero el lote produjo ${total}. Repetí perfectas, imperfectas y descartadas sin cambiar el total.`);
    return null;
  }

  const figures = Array.isArray(batch.figuras) ? batch.figuras.filter((item) => Number(item?.cant || 0) > 0) : [];
  if (figures.length > 1) {
    errors.push(`El lote ${batch.id} mezcla ${figures.map((item) => `${item.cant} ${item.figura}`).join(" y ")}. Para desmoldarlo necesito los tres conteos por cada figura; usá el formulario de desmolde para no inventar qué figura salió imperfecta.`);
    return null;
  }

  return {
    batchId: batch.id,
    total,
    perfectas,
    imperfectas,
    descartadas,
    estado: batch.estado,
    figuras: batchFigureNames(batch),
  };
}

function parseExistingFreezing(text, catalogs, warnings, errors) {
  const batches = catalogs.batches || [];
  const { batch: numberedBatch, number } = findBatchBySpokenNumber(text, batches);
  let targets = [];

  if (number !== null) {
    if (!numberedBatch) {
      errors.push(`No encontré el lote ${number}. Revisá el número antes de confirmar.`);
      return [];
    }
    targets = [numberedBatch];
  } else {
    const figure = findFigure(text, catalogs.figures || []);
    if (!figure) {
      errors.push("Para iniciar congelación necesito el número del lote. Por ejemplo: congela el lote 30.");
      return [];
    }
    const matches = batches.filter((batch) => batchFigureNames(batch)
      .some((name) => normalizeKitchenVoice(name) === normalizeKitchenVoice(figure.name)));
    const eligible = matches.filter((batch) => batch.estado === "En preparación");
    if (eligible.length === 1) {
      targets = eligible;
      warnings.push(`Identifiqué ${eligible[0].id} como el único lote de ${figure.name} en preparación.`);
    } else if (eligible.length > 1) {
      errors.push(`Hay varios lotes de ${figure.name} en preparación: ${eligible.map((batch) => batch.id).join(", ")}. Decime el número exacto.`);
      return [];
    } else if (matches.length === 1) {
      errors.push(`El lote ${matches[0].id} de ${figure.name} está en estado ${matches[0].estado}; no puedo iniciar su congelación.`);
      return [];
    } else {
      errors.push(`No encontré un lote de ${figure.name} en preparación. Decime el número exacto del lote.`);
      return [];
    }
  }

  const invalid = targets.find((batch) => batch.estado !== "En preparación");
  if (invalid) {
    const detail = invalid.estado === "Congelando" && invalid.inicioCongelacion ? ` desde ${invalid.inicioCongelacion}` : "";
    errors.push(`El lote ${invalid.id} ya está ${String(invalid.estado || "en otro estado").toLowerCase()}${detail}; no iniciaré otro cronómetro.`);
    return [];
  }
  return targets.map((batch) => ({
    id: batch.id,
    estado: batch.estado,
    producto: batch.producto || "",
    figuras: batchFigureNames(batch),
    sabor: batch.sabor || "",
  }));
}

function parseMadeToOrder(text, catalogs, errors, warnings) {
  const family = ["malteada", "granizado", "crepa"].find((name) => new RegExp(`(?:^|\\s)${name}(?=\\s|$)`).test(text));
  const preparationVerb = /(?:^|\s)(?:preparar|hacer|producir|iniciar)(?=\s|$)/.test(text);
  const orderMatch = text.match(/(?:^|\s)(?:pedido|orden)(?:\s+(?:numero|ps|pe|p|n))?\s+(\d+)(?=\s|$)/);
  if (!preparationVerb || (!family && !orderMatch)) return { intent: false, action: null, request: null };

  const allProducts = (catalogs.products || []).map(catalogEntry)
    .filter((product) => product.activo !== false);
  const products = allProducts.filter((product) => product.type === "pedido");
  const familyProducts = family
    ? products.filter((product) => normalizeKitchenVoice(product.name).includes(family))
    : products;
  const flavorMentions = family ? mentionedFlavors(text, catalogs.flavors || []) : [];
  const mentionedFlavor = flavorMentions.length === 1 ? flavorMentions[0] : null;

  if (flavorMentions.length > 1) {
    errors.push(`Escuché varios sabores para la misma ${family}: ${flavorMentions.map((item) => item.name).join(", ")}. Decime uno solo.`);
    return { intent: true, action: null, request: { family, product: null, quantity: null } };
  }
  let candidates = family ? familyProducts.filter((product) => includesName(text, product.name)) : familyProducts;
  if (!candidates.length && mentionedFlavor) {
    candidates = familyProducts.filter((product) => includesName(normalizeKitchenVoice(product.name), mentionedFlavor.name, true));
  }
  if (!candidates.length && !mentionedFlavor) candidates = familyProducts;
  if (family && !candidates.length) {
    errors.push(`No encontré una ${family} activa${mentionedFlavor ? ` de ${mentionedFlavor.name}` : ""} en el catálogo.`);
    return { intent: true, action: null, request: { family, product: null, quantity: null } };
  }

  const familyPattern = family ? `${escapeRegExp(family)}(?:s|es)?` : "";
  const quantityMatch = family
    ? text.match(new RegExp(`(?:^|\\s)(\\d+)\\s*(?:unidades?\\s+(?:de\\s+)?)?${familyPattern}(?=\\s|$)`))
      || text.match(new RegExp(`(?:^|\\s)${familyPattern}(?:\\s+de\\s+[a-z0-9&]+)?\\s+(\\d+)(?=\\s|$)`))
    : null;
  const heardQuantity = quantityMatch ? Number(quantityMatch[1]) : null;
  const candidateIds = family ? new Set(candidates.map((product) => product.id)) : null;
  const productById = new Map(allProducts.map((product) => [product.id, product]));
  const customers = catalogs.customers || [];
  const orderItemsFor = (orderId, productIds = null) => {
    const grouped = new Map();
    (catalogs.orderItems || []).filter((item) => item?.orderId === orderId && (!productIds || productIds.has(item?.productId))).forEach((item) => {
      const product = productById.get(item.productId);
      if (!product) return;
      const current = grouped.get(product.id) || { productId: product.id, productName: product.name, quantity: 0 };
      current.quantity += Number(item?.cant || 0);
      grouped.set(product.id, current);
    });
    return [...grouped.values()].filter((item) => item.quantity > 0);
  };
  const itemSummary = (items) => items.map((item) => `${item.quantity} × ${item.productName}`).join(" + ");
  const customerFor = (order) => customers.find((customer) => customer?.id === order?.customerId)?.nombre || "";
  const orderLabel = (order, items) => `${order.id}${customerFor(order) ? ` de ${customerFor(order)}` : ""} (${itemSummary(items)})`;
  const totalOf = (items) => items.reduce((sum, item) => sum + item.quantity, 0);

  let order = null;
  let inferredOrder = false;
  if (orderMatch) {
    const spokenOrderNumber = Number(orderMatch[1]);
    order = (catalogs.orders || []).find((item) => batchNumericId(item?.id) === spokenOrderNumber) || null;
    if (!order) {
      errors.push(`No encontré el pedido ${spokenOrderNumber}. Revisá el número antes de iniciar la preparación.`);
      return { intent: true, action: null, request: { family, quantity: heardQuantity, spokenOrderNumber } };
    }
  } else {
    const matches = (catalogs.orders || []).filter((item) => item?.estado === "Pagado").map((item) => {
      const matchingItems = orderItemsFor(item.id, candidateIds);
      const items = orderItemsFor(item.id);
      return { order: item, items, matchingItems, total: totalOf(matchingItems) };
    }).filter((match) => match.total > 0 && (!(heardQuantity > 0) || match.total === heardQuantity));
    if (matches.length === 1) {
      order = matches[0].order;
      inferredOrder = true;
      warnings.push(`Identifiqué ${orderLabel(order, matches[0].items)} como el único pedido Pagado que coincide. Confirmá que sea ese antes de registrar.`);
    } else if (matches.length > 1) {
      errors.push(`Encontré varios pedidos Pagados que coinciden: ${matches.map((match) => orderLabel(match.order, match.items)).join("; ")}. Decime el número del pedido.`);
      return { intent: true, action: null, request: { family, quantity: heardQuantity, candidateOrderIds: matches.map((match) => match.order.id) } };
    } else {
      const heardProduct = candidates.length === 1 ? candidates[0].name : `${family}${mentionedFlavor ? ` de ${mentionedFlavor.name}` : "s"}`;
      const quantityLabel = heardQuantity > 0 ? `${heardQuantity} × ` : "";
      errors.push(`Entendí ${quantityLabel}${heardProduct}, pero no encontré una única orden Pagada que coincida. Decime el número del pedido para verificar qué hay que preparar.`);
      return { intent: true, action: null, request: { family, quantity: heardQuantity, productId: candidates.length === 1 ? candidates[0].id : null } };
    }
  }

  const matchingItems = orderItemsFor(order.id, candidateIds);
  const items = orderItemsFor(order.id);
  const orderedQuantity = totalOf(matchingItems);
  const quantity = heardQuantity > 0 ? heardQuantity : orderedQuantity;
  const request = {
    family: family || "pedido",
    quantity,
    orderId: order.id,
    items,
    matchingItems,
    productId: matchingItems.length === 1 ? matchingItems[0].productId : null,
    productName: matchingItems.length === 1 ? matchingItems[0].productName : itemSummary(matchingItems),
    orderContent: kitchenOrderAlert(order, catalogs)?.content || itemSummary(items),
  };
  if (!matchingItems.length) {
    errors.push(family
      ? `El pedido ${order.id} no contiene ${mentionedFlavor ? `${family} de ${mentionedFlavor.name}` : `${family}s`}. Decime el pedido correcto antes de preparar.`
      : `El pedido ${order.id} no contiene productos con detalle verificable. Revisá la orden antes de iniciar.`);
    return { intent: true, action: null, request };
  }
  if (heardQuantity > 0 && orderedQuantity !== heardQuantity) {
    errors.push(`El pedido ${order.id} tiene ${itemSummary(matchingItems)}, pero escuché ${heardQuantity} ${family}${heardQuantity === 1 ? "" : "s"}. No iniciaré un pedido con cantidades distintas.`);
    return { intent: true, action: null, request };
  }
  if (order.estado !== "Pagado") {
    errors.push(order.estado === "En producción"
      ? `El pedido ${order.id} ya está En producción; sus insumos no se descontarán otra vez.`
      : `El pedido ${order.id} está ${order.estado || "sin estado"}. MOMOS solo inicia esta preparación cuando el pedido está Pagado.`);
    return { intent: true, action: null, request };
  }

  return {
    intent: true,
    request,
    action: {
      orderId: order.id,
      previousState: order.estado,
      customerId: order.customerId || "",
      customerName: customerFor(order),
      inferredOrder,
      items,
      matchingItems,
      productId: matchingItems.length === 1 ? matchingItems[0].productId : null,
      productName: matchingItems.length === 1 ? matchingItems[0].productName : itemSummary(matchingItems),
      orderContent: kitchenOrderAlert(order, catalogs)?.content || itemSummary(items),
      quantity,
    },
  };
}

function parseOrderHandoff(text, catalogs, errors) {
  const orderMatch = text.match(/(?:^|\s)(?:pedido|orden)(?:\s+(?:numero|ps|pe|p|n))?\s+(\d+)(?=\s|$)/);
  const handoffIntent = /(?:^|\s)(?:listo(?:\s+para\s+empaque)?|entregar\s+(?:a|al)\s+empaque|pasar\s+(?:a|al)\s+empaque|termine|terminamos|terminado|finalice|finalizamos|finalizado|acabe|acabamos|acabado)(?=\s|$)/.test(text);
  if (!orderMatch || !handoffIntent) return { intent: false, action: null };

  const spokenOrderNumber = Number(orderMatch[1]);
  const order = (catalogs.orders || []).find((item) => batchNumericId(item?.id) === spokenOrderNumber) || null;
  if (!order) {
    errors.push(`No encontré el pedido ${spokenOrderNumber}. Revisá el número antes de entregarlo a Empaque.`);
    return { intent: true, action: null };
  }
  if (order.estado !== "En producción") {
    errors.push(order.estado === "Listo para empaque"
      ? `El pedido ${order.id} ya está Listo para empaque; no registraré el paso dos veces.`
      : `El pedido ${order.id} está ${order.estado || "sin estado"}. Solo puedo marcarlo Listo para empaque cuando está En producción.`);
    return { intent: true, action: null };
  }

  const alert = kitchenOrderAlert(order, catalogs);
  return {
    intent: true,
    action: {
      orderId: order.id,
      previousState: order.estado,
      customerId: order.customerId || "",
      customerName: alert?.customerName || "",
      orderContent: alert?.content || "productos todavía sin detalle",
    },
  };
}

export function parseKitchenVoice(transcript, catalogs = {}) {
  const vocabulary = correctKitchenVocabulary(transcript, catalogs);
  const normalized = vocabulary.correctedTranscript;
  const warnings = [];
  const errors = [];
  const preparations = parsePreparations(normalized, catalogs, warnings, errors);
  const preparation = preparations[0] || null;
  const batchMentioned = /(?:^|\s)lote(?=\s|$)|(?:^|\s)l\s+\d+(?=\s|$)/.test(normalized);
  const madeToOrderResult = parseMadeToOrder(normalized, catalogs, errors, warnings);
  const madeToOrderIntent = madeToOrderResult.intent;
  const madeToOrderRequest = madeToOrderResult.request;
  const madeToOrder = madeToOrderResult.action;
  const orderHandoffResult = parseOrderHandoff(normalized, catalogs, errors);
  const orderHandoffIntent = orderHandoffResult.intent;
  const orderHandoff = orderHandoffResult.action;
  const explicitProduction = /(?:produc|fabric|corrida|moldear)/.test(normalized);
  const productions = (batchMentioned && !explicitProduction) || madeToOrderIntent
    ? []
    : parseProductions(normalized, catalogs.figures || [], catalogs.flavors || [], warnings, errors);
  const production = productions[0] || null;
  const freezingMentioned = /(?:congel|cronomet|temporizador)/.test(normalized);
  const readyForSaleIntent = batchMentioned && /(?:^|\s)listo(?=\s|$)/.test(normalized);
  const unmoldingIntent = batchMentioned && !/(?:convertir|aprovechar|reprocesar)\s+imperfectas/.test(normalized)
    && (readyForSaleIntent
      || /(?:desmold)/.test(normalized)
      || /(?:registrar|anotar|ingresar)[^.!?]*(?:perfectas|imperfectas|descartar)/.test(normalized)
      || /\d+\s+(?:perfectas|imperfectas|descartar)/.test(normalized));
  const unmolding = unmoldingIntent ? parseExistingUnmolding(normalized, catalogs, errors, { readyForSaleIntent }) : null;
  const startFreezing = freezingMentioned && /(?:congel|empiez|inici|arranc|ingres|met|pon|pas|entr|van|lleva)/.test(normalized);
  const freezeBatches = batchMentioned && startFreezing ? parseExistingFreezing(normalized, catalogs, warnings, errors) : [];
  const freezeBatchIds = freezeBatches.map((batch) => batch.id);

  if (startFreezing && !production && !freezeBatchIds.length && !errors.some((error) => /lote|congelaci[oó]n/i.test(error))) {
    errors.push("Para iniciar congelación necesito el número del lote. Por ejemplo: congela el lote 30.");
  }
  if (!preparation && !production && !madeToOrder && !orderHandoff && !startFreezing && !unmolding && !errors.length) {
    errors.push("No reconocí una acción de preparar base, producir figuras, preparar un pedido, iniciar congelación o registrar un desmolde.");
  }

  return {
    transcript: String(transcript || "").trim(),
    heardNormalized: vocabulary.heardNormalized,
    normalized,
    corrections: vocabulary.corrections,
    preparation,
    preparations,
    production,
    productions,
    madeToOrderIntent,
    madeToOrderRequest,
    madeToOrder,
    orderHandoffIntent,
    orderHandoff,
    readyForSaleIntent,
    unmoldingIntent,
    unmolding,
    startFreezing,
    freezeBatches,
    freezeBatchIds,
    warnings,
    errors,
    canExecute: errors.length === 0 && Boolean(preparations.length || productions.length || madeToOrder || orderHandoff || unmolding || freezeBatchIds.length),
  };
}

/**
 * Decide qué debe preguntar Momobot cuando una orden todavía está incompleta.
 * La respuesta es deliberadamente determinista: conversa para reunir datos, pero
 * nunca inventa cantidades ni convierte un borrador ambiguo en una escritura.
 */
export function kitchenConversationPrompt(parsed, catalogs = {}) {
  const normalized = parsed?.normalized || normalizeKitchenVoice(parsed?.transcript || "");
  const figures = catalogs.figures || [];
  const flavors = catalogs.flavors || [];
  const subrecipes = catalogs.subrecipes || [];
  const figure = findFigure(normalized, figures);
  const figureQuantity = declaredProductionTotal(normalized, figure);
  const flavorMentions = mentionedFlavors(normalized, flavors);
  const grams = extractGramAmounts(normalized);
  const preparationMentioned = /(?:prepar|hacer|registr|ingres|ganache|mousse|salsa|relleno|crocante|cheesecake)/.test(normalized);
  const productionMentioned = Boolean(figure) || /(?:produc|fabric|corrida|moldear)/.test(normalized);
  const batchMentioned = /(?:^|\s)lote(?=\s|$)|(?:^|\s)l\s+\d+(?=\s|$)/.test(normalized);
  const freezingMentioned = /(?:congel|cronomet|temporizador)/.test(normalized);
  const batchNumber = normalized.match(/(?:^|\s)lote\s+(?:numero\s+)?(\d+)(?=\s|$)/)?.[1]
    || normalized.match(/(?:^|\s)l\s+(\d+)(?=\s|$)/)?.[1];
  const mismatch = (parsed?.errors || []).find((error) => /sabores suman|pero los sabores suman/i.test(error));
  const missingFlavorQuantity = (parsed?.errors || []).find((error) => /^cantidad faltante por sabor:/i.test(error));
  const missingPreparationAmount = (parsed?.errors || []).find((error) => /me falta la cantidad de/i.test(error));
  const ambiguousPreparation = (parsed?.errors || []).find((error) => /no s[eé] cu[aá]l base elegir/i.test(error));
  const batchError = (parsed?.errors || []).find((error) => /lote|congelaci[oó]n/i.test(error));
  const unmoldingError = parsed?.unmoldingIntent
    ? (parsed?.errors || []).find((error) => /desmold|perfectas|imperfectas|descartadas|conteos/i.test(error))
    : null;
  const madeToOrderError = parsed?.madeToOrderIntent
    ? (parsed?.errors || []).find((error) => /malteada|granizado|crepa|pedido|preparaci[oó]n/i.test(error))
    : null;

  if (parsed?.canExecute) {
    return { kind: "ready", recoverable: false, text: "Ya tengo los datos necesarios." };
  }
  if (missingFlavorQuantity) {
    const pending = missingFlavorQuantity.replace(/^cantidad faltante por sabor:\s*/i, "").replace(/[.!?]+$/u, "")
      .split(",").map((item) => item.trim()).filter(Boolean);
    const names = pending.length > 1 ? `${pending.slice(0, -1).join(", ")} y ${pending.at(-1)}` : pending[0] || "ese sabor";
    return {
      kind: "quantities",
      recoverable: true,
      text: pending.length === 1
        ? `Sí escuché ${names}, pero me falta su cantidad. ¿Cuántas unidades van de ${names}?`
        : `Sí escuché ${names}, pero me faltan sus cantidades. Decime cuántas unidades van de cada sabor.`,
    };
  }
  if (mismatch) {
    return {
      kind: "conflict",
      recoverable: false,
      text: `${mismatch} Para evitar un registro incorrecto, decime editar y repetí la distribución completa.`,
    };
  }
  if (missingPreparationAmount) {
    const name = missingPreparationAmount.replace(/^.*cantidad de\s+/i, "").replace(/[.!?]+$/u, "");
    return { kind: "amount", recoverable: true, text: `${missingPreparationAmount} ¿Cuántos gramos prepararon de ${name}?` };
  }
  if (ambiguousPreparation) {
    const isSecretMix = /(?:^|\s)mousse(?=\s|$)/.test(normalized);
    const mousseEntries = subrecipes
      .map(catalogEntry)
      .filter((entry) => String(entry.type).startsWith("mousse") && entry.sabor);
    const fruitFlavors = [...new Set(mousseEntries
      .filter((entry) => entry.type === "mousse_frutal")
      .map((entry) => entry.sabor))];
    const creamyFlavors = [...new Set(mousseEntries
      .filter((entry) => entry.type === "mousse_cremosa")
      .map((entry) => entry.sabor))];
    const mousseFlavors = [...new Set(mousseEntries.map((entry) => entry.sabor))];
    if (isSecretMix && mousseFlavors.length) {
      const flavorHelp = fruitFlavors.length && creamyFlavors.length
        ? `frutales como ${fruitFlavors.join(", ")}; o cremosos como ${creamyFlavors.join(", ")}`
        : mousseFlavors.join(", ");
      return {
        kind: "base-flavor",
        recoverable: true,
        text: `Entendí mezcla secreta. ¿De qué sabor es? Podés decir ${flavorHelp}.`,
      };
    }
    return { kind: "base", recoverable: true, text: ambiguousPreparation };
  }
  if (madeToOrderError) {
    const alreadyStarted = /ya est[aá] En producci[oó]n|no se descontar[aá]n otra vez/i.test(madeToOrderError);
    const mismatch = /cantidades distintas|no contiene/i.test(madeToOrderError);
    const missingOrder = /n[uú]mero del pedido/i.test(madeToOrderError);
    const missingProduct = /necesito un sabor|no encontr[eé] una/i.test(madeToOrderError);
    return {
      kind: alreadyStarted ? "order-already-started" : mismatch ? "order-mismatch" : missingOrder ? "order-number" : missingProduct ? "made-to-order-product" : "made-to-order",
      recoverable: !alreadyStarted,
      text: madeToOrderError,
    };
  }
  if (unmoldingError) {
    const alreadyUnmolded = /ya fue desmoldado|no cambiar[eé] ese conteo/i.test(unmoldingError);
    const mixed = /mezcla .*figura|por cada figura/i.test(unmoldingError);
    const mismatch = /suman \d+|sin cambiar el total/i.test(unmoldingError);
    return {
      kind: alreadyUnmolded ? "unmolding-state" : mixed ? "unmolding-mixed" : mismatch ? "unmolding-conflict" : "unmolding-counts",
      recoverable: !alreadyUnmolded && !mixed && !mismatch,
      text: unmoldingError,
    };
  }
  if (batchMentioned && !freezingMentioned) {
    const reference = batchNumber ? `el lote ${Number(batchNumber)}` : figure ? `el lote de ${figure.name}` : "ese lote";
    return { kind: "batch-action", recoverable: true, text: `¿Qué querés hacer con ${reference}? Por ejemplo, podés decir: inicia su congelación.` };
  }
  if (batchError) {
    const alreadyStarted = /ya est[aá]|no iniciar[eé] otro cron[oó]metro/i.test(batchError);
    return { kind: "batch", recoverable: !alreadyStarted, text: batchError };
  }
  if (productionMentioned && !figure) {
    const names = figures.map(catalogEntry).map((item) => item.name).slice(0, 7).join(", ");
    return { kind: "figure", recoverable: true, text: `¿Qué figura vamos a producir? Podés decir ${names}.` };
  }
  if (figure && !flavorMentions.length) {
    return {
      kind: "flavors",
      recoverable: true,
      text: figureQuantity
        ? `Entendí ${Number(figureQuantity)} de la figura ${figure.name}. ¿De qué sabor van? Por ejemplo: cinco de Oreo, o tres de coco y dos de limón.`
        : `Entendí la figura ${figure.name}. ¿Cuántas van de cada sabor? Por ejemplo: cinco de coco y cinco de Oreo.`,
    };
  }
  if (figure && flavorMentions.length) {
    return {
      kind: "quantities",
      recoverable: true,
      text: `Reconocí ${figure.name} y ${flavorMentions.map((item) => item.name).join(" y ")}, pero me faltan cantidades claras. Decime cuántas van de cada sabor.`,
    };
  }
  if (preparationMentioned && !grams.length) {
    return { kind: "amount", recoverable: true, text: "¿Qué cantidad prepararon? Podés responder, por ejemplo, doscientos gramos o uno coma cinco kilos." };
  }
  if (grams.length && !findSubrecipe(normalized, subrecipes).entry) {
    return { kind: "base", recoverable: true, text: "¿Qué base o subreceta prepararon? Decime su nombre, por ejemplo ganache de chocolate." };
  }
  if (parsed?.startFreezing && !parsed?.production) {
    return { kind: "unsupported-freezing", recoverable: false, text: "Puedo iniciar congelación automáticamente cuando la orden también crea los lotes. Para un lote existente, usá su botón de congelamiento." };
  }
  return {
    kind: "intent",
    recoverable: true,
    text: "No alcancé a entender la tarea. Contame con tus palabras qué van a preparar o producir y las cantidades; yo te preguntaré lo que falte.",
  };
}

export function mergeKitchenConversation(previousTranscript, reply, catalogs = null) {
  const previous = String(previousTranscript || "").trim().replace(/[\s,;:.-]+$/u, "");
  const next = String(reply || "").trim().replace(/^(?:y|pues|bueno|serian|serán|son)\s+/iu, "");
  if (!previous) return next;
  if (!next) return previous;

  if (catalogs) {
    // Una corrección completa y autosuficiente reemplaza lo oído antes. Así un
    // fragmento erróneo del navegador no contamina una repetición posterior.
    const nextParsed = parseKitchenVoice(next, catalogs);
    if (nextParsed.canExecute) return next;

    // Si falta la cantidad de un único sabor, “dos” o “son dos unidades”
    // pertenece inequívocamente al sabor que Momobot acaba de preguntar.
    const normalizedNext = normalizeKitchenVoice(next);
    const shortQuantity = normalizedNext.match(/^(\d+)(?:\s+unidades?)?$/);
    if (shortQuantity) {
      const previousParsed = parseKitchenVoice(previous, catalogs);
      const missing = (previousParsed.errors || [])
        .find((error) => /^cantidad faltante por sabor:/i.test(error));
      const pending = missing
        ? missing.replace(/^cantidad faltante por sabor:\s*/i, "").replace(/[.!?]+$/u, "")
          .split(",").map((item) => item.trim()).filter(Boolean)
        : [];
      if (pending.length === 1) return `${previous}. ${shortQuantity[1]} de ${pending[0]}`;
    }
  }
  return `${previous}. ${next}`;
}

function vocabularyHitCount(text, catalogs) {
  return kitchenVocabularyPhrases(catalogs).reduce((count, phrase) => count + (includesName(text, phrase, true) ? 1 : 0), 0);
}

export function selectKitchenVoiceAlternative(alternatives, catalogs = {}) {
  const candidates = (alternatives || []).map((alternative, index) => {
    const transcript = typeof alternative === "string" ? alternative : alternative?.transcript;
    const confidence = typeof alternative === "object" ? Number(alternative?.confidence || 0) : 0;
    const parsed = parseKitchenVoice(transcript || "", catalogs);
    const actions = Number(Boolean(parsed.preparation)) + Number(Boolean(parsed.production)) + Number(Boolean(parsed.madeToOrder)) + Number(Boolean(parsed.orderHandoff)) + Number(Boolean(parsed.unmolding)) + Number(parsed.startFreezing);
    const score = (parsed.canExecute ? 100 : 0)
      + actions * 20
      + vocabularyHitCount(parsed.normalized, catalogs) * 4
      + parsed.corrections.length * 2
      - parsed.errors.length * 12
      + confidence * 3;
    return { transcript: String(transcript || "").trim(), confidence, score, index, corrections: parsed.corrections };
  }).filter((candidate) => candidate.transcript);
  candidates.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.index - b.index);
  return candidates[0] || { transcript: "", confidence: 0, score: 0, corrections: [] };
}
