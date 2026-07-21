import {
  correctKitchenVocabulary,
  kitchenDelayedOrderReminders,
  kitchenOrderAlert,
  normalizeKitchenVoice,
} from "./kitchen-voice.js";
import { batchPresentation, commercialFamilyLabel, isCommercialFamilyProduct } from "./momos-domain-language.js";
import { buildCanonicalPhysicalResults, canonicalBatchPhysicalResult } from "./canonical-production-results.js";

const UNPAID = new Set(["Nuevo", "Confirmado", "Pendiente de pago"]);
const ACTIVE_BATCH_STATES = new Set(["En preparación", "Congelando"]);

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function entityName(value) {
  return text(typeof value === "string" ? value : value?.nombre ?? value?.name ?? value?.valor);
}

function numericId(value) {
  const match = text(value).match(/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function naturalList(values = []) {
  const clean = values.map(text).filter(Boolean);
  if (clean.length < 2) return clean[0] || "";
  return `${clean.slice(0, -1).join(", ")} y ${clean.at(-1)}`;
}

function orderMoment(order) {
  return `${text(order?.fecha)}T${text(order?.hora)}`;
}

function sortedOrders(catalogs, state) {
  return (catalogs.orders || [])
    .filter((order) => order?.id && (!state || order.estado === state))
    .slice()
    .sort((left, right) => orderMoment(left).localeCompare(orderMoment(right)) || text(left.id).localeCompare(text(right.id)));
}

function findOrderByNumber(catalogs, spokenNumber) {
  return (catalogs.orders || []).find((order) => numericId(order?.id) === Number(spokenNumber)) || null;
}

function findOrder(catalogs, query, memory) {
  const explicit = query.match(/(?:^|\s)(?:pedido|orden|comanda)(?:\s+(?:numero|ps|pe|p|n))?\s+(\d+)(?=\s|$)/)?.[1];
  if (explicit) return findOrderByNumber(catalogs, explicit);
  if (/(?:^|\s)(?:ese|esa|este|esta|el|la|mismo|misma)\s+(?:pedido|orden|comanda)(?=\s|$)|^(?:y\s+)?(?:como|que|cual|donde)\b/.test(query)
      && memory?.lastOrderId) {
    return (catalogs.orders || []).find((order) => order.id === memory.lastOrderId) || null;
  }
  return null;
}

function findBatch(catalogs, query, memory) {
  const explicit = query.match(/(?:^|\s)lote(?:\s+(?:numero|n))?\s+(\d+)(?=\s|$)/)?.[1];
  if (explicit) return (catalogs.batches || []).find((batch) => numericId(batch?.id) === Number(explicit)) || null;
  if (/(?:ese|este|el|mismo)\s+lote|^(?:y\s+)?(?:como|que|cuanto)\b/.test(query) && memory?.lastBatchId) {
    return (catalogs.batches || []).find((batch) => batch.id === memory.lastBatchId) || null;
  }
  return null;
}

function nextOrderStep(state) {
  if (UNPAID.has(state)) return "esperar la confirmación del pago";
  if (state === "Pagado") return "iniciar su preparación en Cocina";
  if (state === "En producción") return "terminar Cocina y entregarlo como Listo para empaque";
  if (state === "Listo para empaque") return "que Empaque lo aliste y confirme Empacado";
  if (state === "Empacado") return "confirmar que está Listo para despacho";
  if (state === "Listo para despacho") return "asignar la salida de Logística";
  if (state === "En ruta") return "confirmar la entrega con su evidencia";
  if (state === "Entregado") return "no requiere otro paso operativo";
  if (state === "Cancelado") return "no realizar ninguna preparación";
  return "revisar el detalle con Coordinación";
}

function describeOrder(order, catalogs) {
  const alert = kitchenOrderAlert(order, catalogs);
  const customer = alert?.customerName ? ` de ${alert.customerName}` : "";
  return `El pedido ${order.id}${customer} está ${order.estado}. Contiene ${alert?.content || "productos sin detalle"}. Lo siguiente es ${nextOrderStep(order.estado)}.`;
}

function freezingStatus(batch, now) {
  if (batch.estado !== "Congelando" || !batch.inicioCongelacion) return "";
  const start = new Date(text(batch.inicioCongelacion).replace(" ", "T"));
  if (Number.isNaN(start.getTime())) return " Su cronómetro de congelación está activo.";
  const target = start.getTime() + number(batch.horasCongelacion) * 60 * 60 * 1000;
  const remaining = Math.max(0, Math.ceil((target - now) / 60000));
  if (remaining <= 0) return " Ya cumplió el tiempo objetivo de congelación; revisalo antes de desmoldar.";
  const hours = Math.floor(remaining / 60);
  const minutes = remaining % 60;
  return ` Le faltan aproximadamente ${hours ? `${hours} hora${hours === 1 ? "" : "s"}` : ""}${hours && minutes ? " y " : ""}${minutes ? `${minutes} minuto${minutes === 1 ? "" : "s"}` : ""}.`;
}

function describeBatch(batch, now) {
  const presentation = batchPresentation(batch);
  const result = canonicalBatchPhysicalResult(batch);
  const countText = result.produced ? ` Tiene ${result.produced} producida${result.produced === 1 ? "" : "s"}.` : "";
  const resultText = result.classified ? ` Resultado: ${result.perfect} perfectas, ${result.imperfect} imperfectas y ${result.discarded} descartadas. Merma bruta ${Math.round(result.grossWasteRate * 100)}%; descarte definitivo ${result.discarded}.` : "";
  return `El lote ${batch.id} corresponde a ${presentation.primary}; ${presentation.secondary.toLowerCase()}. Está ${batch.estado}.${countText}${resultText}${freezingStatus(batch, now)}`;
}

function matchedCatalogName(query, entries = []) {
  return entries
    .flatMap((entry) => {
      const name = entityName(entry);
      const normalized = normalizeKitchenVoice(name);
      const short = normalized.replace(/\s+\d+(?:\.\d+)?\s*(?:ml|l|g|kg|und|unidad|unidades)\s*$/u, "").trim();
      return [...new Set([normalized, short].filter(Boolean))].map((label) => ({ entry, name, normalized: label }));
    })
    .filter((candidate) => (` ${query} `).includes(` ${candidate.normalized} `))
    .sort((left, right) => right.normalized.length - left.normalized.length)[0]?.entry || null;
}

function exactVariantAnswer(query, catalogs) {
  const figure = matchedCatalogName(query, catalogs.figures || []);
  const flavor = matchedCatalogName(query, catalogs.flavors || []);
  if (!figure || !flavor) return null;
  const figureName = entityName(figure);
  const flavorName = entityName(flavor);
  const variants = (catalogs.variants || []).filter((variant) =>
    normalizeKitchenVoice(variant.figura) === normalizeKitchenVoice(figureName)
    && normalizeKitchenVoice(variant.sabor) === normalizeKitchenVoice(flavorName));
  const available = variants.reduce((sum, variant) => sum + number(variant.disponibles), 0);
  const expiry = variants.map((variant) => text(variant.vence)).filter(Boolean).sort()[0];
  return {
    text: `Hay ${available} unidad${available === 1 ? "" : "es"} lista${available === 1 ? "" : "s"} de ${figureName} sabor ${flavorName}.${expiry ? ` El vencimiento más próximo es ${expiry}.` : ""}${available ? "" : " Esa combinación requiere producción."}`,
    magnitude: {
      kind: "finished_exact_sellable", value: available,
      productId: variants[0]?.productId || "", figure: figureName, flavor: flavorName,
    },
    memoryPatch: { lastTopic: "inventory", lastFigure: figureName, lastFlavor: flavorName },
  };
}

function stockAnswer(query, catalogs) {
  const exact = exactVariantAnswer(query, catalogs);
  if (exact) return exact;
  const inventoryItem = matchedCatalogName(query, catalogs.inventory || []);
  if (inventoryItem) {
    const stock = number(inventoryItem.stock);
    const minimum = number(inventoryItem.min ?? inventoryItem.minimo);
    const warning = stock <= minimum ? " Está en mínimo o por debajo; conviene reponerlo." : "";
    return {
      text: `Hay ${stock} ${inventoryItem.unidad || "unidades"} de ${entityName(inventoryItem)}.${warning}`,
      magnitude: { kind: "ingredient_usable", value: stock, itemId: inventoryItem.id || "" },
      memoryPatch: { lastTopic: "inventory", lastInventoryId: inventoryItem.id || null },
    };
  }
  const product = matchedCatalogName(query, catalogs.products || []);
  if (product) {
    const stock = number(product.stock);
    const exactNote = isCommercialFamilyProduct(product) ? " Es el total general de la familia comercial; para prometer una figura y sabor debo revisar la variante exacta." : "";
    return {
      text: `El stock general de ${entityName(product)} es ${stock}.${exactNote}`,
      magnitude: { kind: "finished_official_physical", value: stock, productId: product.id || "" },
      memoryPatch: { lastTopic: "inventory", lastProductId: product.id || null },
    };
  }
  return null;
}

function nextWorkAnswer(catalogs) {
  const paid = sortedOrders(catalogs, "Pagado");
  if (paid.length) {
    const first = paid[0];
    const alert = kitchenOrderAlert(first, catalogs);
    return {
      text: `Lo primero es el pedido ${first.id}${alert?.customerName ? ` de ${alert.customerName}` : ""}, porque es el pagado más antiguo sin iniciar. Hay que preparar ${alert?.content || "su comanda"}. Después quedan ${paid.length - 1} pedido${paid.length - 1 === 1 ? "" : "s"} pagado${paid.length - 1 === 1 ? "" : "s"} en espera. Podés decir “prepara el pedido ${numericId(first.id)}” para abrirlo con confirmación.`,
      memoryPatch: { lastTopic: "order", lastOrderId: first.id },
    };
  }
  const producing = sortedOrders(catalogs, "En producción");
  if (producing.length) {
    const first = producing[0];
    return {
      text: `No hay pedidos pagados por iniciar. Lo más antiguo en Cocina es ${first.id}; está En producción. Cuando termine, Cocina debe marcarlo Listo para empaque.`,
      memoryPatch: { lastTopic: "order", lastOrderId: first.id },
    };
  }
  const packing = sortedOrders(catalogs, "Listo para empaque");
  if (packing.length) {
    return {
      text: `Cocina no tiene pedidos por iniciar. Empaque tiene ${packing.length}: ${naturalList(packing.slice(0, 4).map((order) => order.id))}.`,
      memoryPatch: { lastTopic: "order", lastOrderId: packing[0].id },
    };
  }
  return { text: "La cola operativa está al día: no hay pedidos pagados por iniciar ni comandas activas en Cocina o Empaque.", memoryPatch: { lastTopic: "overview" } };
}

function overviewAnswer(catalogs, now) {
  const counts = Object.fromEntries(["Pagado", "En producción", "Listo para empaque", "Empacado", "Listo para despacho"].map((state) => [state, sortedOrders(catalogs, state).length]));
  const activeLots = (catalogs.batches || []).filter((batch) => ACTIVE_BATCH_STATES.has(batch.estado));
  const pendingShortages = (catalogs.suggestions || []).filter((item) => !item.estado || item.estado === "Pendiente");
  const delayed = kitchenDelayedOrderReminders(catalogs, now, catalogs.delaySettings).length;
  return {
    text: `Resumen operativo: ${counts.Pagado} pedido${counts.Pagado === 1 ? "" : "s"} pagado${counts.Pagado === 1 ? "" : "s"} por iniciar, ${counts["En producción"]} en Cocina, ${counts["Listo para empaque"]} esperando Empaque, ${counts.Empacado + counts["Listo para despacho"]} listo${counts.Empacado + counts["Listo para despacho"] === 1 ? "" : "s"} en salida, ${activeLots.length} lote${activeLots.length === 1 ? "" : "s"} activo${activeLots.length === 1 ? "" : "s"} y ${pendingShortages.length} faltante${pendingShortages.length === 1 ? "" : "s"} pendiente${pendingShortages.length === 1 ? "" : "s"}.${delayed ? ` Atención: ${delayed} pedido${delayed === 1 ? "" : "s"} supera${delayed === 1 ? "" : "n"} el tiempo configurado.` : " No hay demoras activas."}`,
    memoryPatch: { lastTopic: "overview" },
  };
}

function shortagesAnswer(catalogs) {
  const pending = (catalogs.suggestions || []).filter((item) => !item.estado || item.estado === "Pendiente");
  if (!pending.length) return { text: "No hay faltantes pendientes registrados para Producción o Inventario.", memoryPatch: { lastTopic: "shortages" } };
  const visible = pending.slice(0, 5).map((item) => {
    const entity = item.area === "Inventario" ? "insumo" : "presentación comercial";
    const name = item.area === "Inventario" ? (item.producto || "sin identificar") : commercialFamilyLabel(item.producto || "sin identificar");
    return `${number(item.cantidad)} de ${entity} ${name}${item.orderId ? ` para ${item.orderId}` : ""}`;
  });
  return {
    text: `Hay ${pending.length} faltante${pending.length === 1 ? "" : "s"} pendiente${pending.length === 1 ? "" : "s"}: ${naturalList(visible)}${pending.length > 5 ? `, y ${pending.length - 5} más` : ""}.`,
    memoryPatch: { lastTopic: "shortages" },
  };
}

function activeLotsAnswer(catalogs, now) {
  const active = (catalogs.batches || []).filter((batch) => ACTIVE_BATCH_STATES.has(batch.estado));
  if (!active.length) return { text: "No hay lotes en preparación ni congelando en este momento.", memoryPatch: { lastTopic: "batch" } };
  const visible = active.slice(0, 4).map((batch) => `${batch.id}: ${batchPresentation(batch).primary}, ${batch.estado}`);
  const first = active[0];
  return {
    text: `Hay ${active.length} lote${active.length === 1 ? "" : "s"} activo${active.length === 1 ? "" : "s"}: ${naturalList(visible)}.${active.length === 1 ? freezingStatus(first, now) : ""}`,
    memoryPatch: { lastTopic: "batch", lastBatchId: first.id },
  };
}

function lowInventoryAnswer(catalogs) {
  const low = (catalogs.inventory || []).filter((item) => number(item.stock) <= number(item.min ?? item.minimo));
  if (!low.length) return { text: "No hay insumos en mínimo ni por debajo del mínimo configurado.", memoryPatch: { lastTopic: "inventory" } };
  const visible = low.slice(0, 6).map((item) => `${entityName(item)}: ${number(item.stock)} ${item.unidad || "unidades"}, mínimo ${number(item.min ?? item.minimo)}`);
  return {
    text: `Hay ${low.length} insumo${low.length === 1 ? "" : "s"} para reponer: ${naturalList(visible)}${low.length > 6 ? `, y ${low.length - 6} más` : ""}.`,
    memoryPatch: { lastTopic: "inventory" },
  };
}

function inventoryExpiryAnswer(catalogs, now, expiredOnly = false) {
  const today = new Date(now);
  const todayIso = Number.isNaN(today.getTime()) ? "" : [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const lots = (catalogs.inventoryLots || []).map((lot) => ({
    itemId: lot.itemId ?? lot.item_id ?? null,
    name: lot.itemName || lot.nombre || entityName((catalogs.inventory || []).find((item) => item.id === (lot.itemId ?? lot.item_id))) || "insumo",
    available: number(lot.available ?? lot.disponible ?? lot.cantidad),
    unit: lot.unit || lot.unidad || "unidades",
    expiry: text(lot.expiresAt ?? lot.expires_at ?? lot.vence),
  })).filter((lot) => lot.available > 0 && lot.expiry);
  const itemsWithLots = new Set(lots.map((lot) => lot.itemId).filter(Boolean));
  const legacy = (catalogs.inventory || []).filter((item) => !itemsWithLots.has(item.id)).map((item) => ({
    name: entityName(item), available: number(item.stock), unit: item.unidad || "unidades", expiry: text(item.vence),
  })).filter((item) => item.available > 0 && item.expiry);
  const dated = [...lots, ...legacy].map((item) => ({ ...item, days: todayIso ? Math.ceil((Date.parse(`${item.expiry}T00:00:00`) - Date.parse(`${todayIso}T00:00:00`)) / 86400000) : 9999 }));
  const matches = dated.filter((item) => expiredOnly ? item.days < 0 : item.days >= 0 && item.days <= 5).sort((a, b) => a.days - b.days);
  if (!matches.length) return {
    text: expiredOnly ? "No hay lotes de insumos vencidos con saldo disponible." : "No hay lotes de insumos que venzan en los próximos cinco días.",
    memoryPatch: { lastTopic: "inventory" },
  };
  const visible = matches.slice(0, 6).map((item) => `${item.name}, ${item.available} ${item.unit}, vence ${item.expiry}`);
  return {
    text: `${expiredOnly ? "Insumos vencidos" : "Insumos próximos a vencer"}: ${naturalList(visible)}${matches.length > 6 ? `, y ${matches.length - 6} más` : ""}.`,
    memoryPatch: { lastTopic: "inventory" },
  };
}

export function momobotContextSnapshot(catalogs = {}, now = Date.now()) {
  return {
    paid: sortedOrders(catalogs, "Pagado").length,
    kitchen: sortedOrders(catalogs, "En producción").length,
    packing: sortedOrders(catalogs, "Listo para empaque").length,
    activeLots: (catalogs.batches || []).filter((batch) => ACTIVE_BATCH_STATES.has(batch.estado)).length,
    shortages: (catalogs.suggestions || []).filter((item) => !item.estado || item.estado === "Pendiente").length,
    delayed: kitchenDelayedOrderReminders(catalogs, now, catalogs.delaySettings).length,
  };
}

export function momobotContextAnswer(value, catalogs = {}, memory = {}, now = Date.now()) {
  const query = correctKitchenVocabulary(value, catalogs).correctedTranscript;
  if (!query) return null;

  const order = findOrder(catalogs, query, memory);
  const asksOrder = order && /(?:como|donde|en que|que|cual|estado|sigue|falta|va|tiene|trae|contiene)/.test(query);
  if (asksOrder) return {
    matched: true,
    topic: "order",
    text: describeOrder(order, catalogs),
    memoryPatch: { lastTopic: "order", lastOrderId: order.id },
  };

  const asksNext = /(?:que|cual).*(?:hago|hacemos|sigue|primero|ahora)|por donde (?:empiezo|comienzo)|ayudame (?:a )?(?:priorizar|empezar)|dime que hago/.test(query)
    || /(?:que|cual).*(?:hay|tenemos|queda|toca|debemos).*(?:hacer|preparar|atender)|(?:en que|con que).*(?:trabajamos|seguimos)|(?:que|cual).*(?:siguiente|proxima).*(?:tarea|comanda|pedido)/.test(query);
  if (asksNext) return { matched: true, topic: "next", ...nextWorkAnswer(catalogs) };

  const batch = findBatch(catalogs, query, memory);
  const asksBatch = batch && /(?:como|cuanto|que|cual|estado|falta|va|tiempo)/.test(query);
  if (asksBatch) {
    const physicalResult = canonicalBatchPhysicalResult(batch);
    return {
      matched: true,
      topic: "batch",
      text: describeBatch(batch, now),
      magnitude: { kind: "physical_batch_result", ...physicalResult },
      memoryPatch: { lastTopic: "batch", lastBatchId: batch.id },
    };
  }

  const asksPhysicalResults = /(?:merma|rendimiento fisico|resultado fisico|resultados fisicos|imperfectas|descartadas)/.test(query);
  if (asksPhysicalResults) {
    if (!Array.isArray(catalogs.batches)) return {
      matched: true,
      topic: "physical-results",
      text: "No tengo cargados los resultados físicos de Producción; no voy a reportar una merma cero sin evidencia.",
      magnitude: { kind: "physical_production_summary", available: false },
      memoryPatch: { lastTopic: "physical-results" },
    };
    const physicalResults = buildCanonicalPhysicalResults(catalogs.batches || []);
    return {
      matched: true,
      topic: "physical-results",
      text: `Resultados físicos: ${physicalResults.produced} producidas, ${physicalResults.perfect} perfectas, ${physicalResults.imperfect} imperfectas y ${physicalResults.discarded} descartadas. La merma bruta es ${Math.round(physicalResults.grossWasteRate * 100)}%; ${physicalResults.repurposedImperfectUnits} imperfectas fueron reaprovechadas y el descarte definitivo es ${physicalResults.definitiveLossUnits}.`,
      magnitude: { kind: "physical_production_summary", ...physicalResults },
      memoryPatch: { lastTopic: "physical-results" },
    };
  }

  const asksOverview = /(?:como|que tal).*(?:cocina|produccion|operacion)|(?:dame|dime|quiero) (?:un )?resumen|ponme al dia|panorama (?:de )?(?:cocina|produccion|operativo)/.test(query);
  if (asksOverview) return { matched: true, topic: "overview", ...overviewAnswer(catalogs, now) };

  const asksShortages = /(?:que|cuales|cuantos|hay|tenemos|muestra|dime).*(?:faltante|faltantes|por producir|por comprar)|(?:falta|necesitamos) (?:producir|comprar|reponer)/.test(query);
  if (asksShortages) return { matched: true, topic: "shortages", ...shortagesAnswer(catalogs) };

  const asksExpiredInventory = /(?:que|cuales|hay|tenemos|muestra|dime).*(?:insumo|materia prima|inventario).*(?:vencido|caducado)|(?:que|cual).*(?:se vencio|esta vencido|ya vencio)/.test(query);
  if (asksExpiredInventory) return { matched: true, topic: "inventory", ...inventoryExpiryAnswer(catalogs, now, true) };

  const asksExpiringInventory = /(?:que|cuales|hay|tenemos|muestra|dime).*(?:se esta venciendo|por vencer|vence pronto|proximo a vencer)|(?:que|cual).*(?:vence|vencimiento).*(?:primero|proximo)|^que se esta venciendo/.test(query);
  if (asksExpiringInventory) return { matched: true, topic: "inventory", ...inventoryExpiryAnswer(catalogs, now, false) };

  const asksLowInventory = /(?:que|cuales|hay|tenemos|muestra|dime).*(?:insumo|materia prima|inventario|stock).*(?:bajo|bajos|minimo|reponer|comprar)|(?:que|cual).*(?:hace falta|falta).*(?:insumo|inventario|comprar)/.test(query);
  if (asksLowInventory) return { matched: true, topic: "inventory", ...lowInventoryAnswer(catalogs) };

  const asksLots = /(?:que|cuales|cuantos|hay|tenemos|muestra|dime).*(?:lote|lotes).*(?:activo|preparacion|congelando|produccion)?|(?:como|que tal).*lotes/.test(query);
  if (asksLots) return { matched: true, topic: "batch", ...activeLotsAnswer(catalogs, now) };

  const asksStock = /(?:cuanto|cuanta|cuantos|cuantas|stock|existencias|disponible|disponibles|tenemos|queda|quedan|hay|alcanza|suficiente)(?:\s|$)/.test(query);
  if (asksStock) {
    const answer = stockAnswer(query, catalogs);
    if (answer) return { matched: true, topic: "inventory", ...answer };
  }

  return null;
}
