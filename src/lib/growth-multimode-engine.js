import { buildKitchenProductionPlan } from "./production-planner.js";
import { normalizeAgencyOperationalFacts } from "./agency-operational-facts.js";
import { businessDateISO } from "./business-date.js";

const PAID_STATES = new Set([
  "Pagado", "En producción", "Listo para empaque", "Empacado",
  "Listo para despacho", "En ruta", "Entregado", "Reclamo",
]);
const ACTIVE_BATCH_STATES = new Set(["En preparación", "Congelando"]);
const number = (value) => Math.max(0, Number(value) || 0);
const text = (value) => String(value || "").trim();
const isoDay = (value) => text(value).slice(0, 10);

export const GROWTH_MODE_IDS = Object.freeze([
  "venta-inmediata",
  "conquistar-demanda",
  "marca-comunidad",
  "pauta-aprendizaje",
]);

function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function growthSnapshotPayload(engine) {
  const sealed = {
    engine_version: Number(engine?.version || 1),
    generated_for: String(engine?.facts?.today || engine?.generatedAt || "").slice(0, 10),
    facts: engine?.facts || {},
    modes: (engine?.modes || []).map(({ recommendation: _recommendation, ...mode }) => mode),
    recommended_mode: engine?.recommendedModeId || "",
    policy: engine?.policy || {},
  };
  const fingerprint = shortHash(JSON.stringify(sealed));
  return { snapshot_key: `growth:${sealed.generated_for}:engine-${fingerprint}`, ...sealed };
}

function daysBetween(from, to) {
  const left = isoDay(from); const right = isoDay(to);
  if (!left || !right) return null;
  const value = Math.round((new Date(`${right}T12:00:00`) - new Date(`${left}T12:00:00`)) / 86400000);
  return Number.isFinite(value) ? value : null;
}

function isPaidOrder(order) {
  return order?.estado !== "Cancelado" && Boolean(order?.pagadoEn || PAID_STATES.has(order?.estado));
}

function activeProduct(db, id) {
  return (db.products || []).find((product) => product.id === id && product.activo !== false) || null;
}

function readyOperationalFacts(db) {
  if (db?.agencyOperationalFactsReady !== true) return null;
  return normalizeAgencyOperationalFacts(db.agencyOperationalFacts);
}

function operationalProducts(facts) {
  return (facts?.productCatalog || []).filter((product) => product.active !== false).map((product) => ({
    id: product.productId,
    nombre: product.name,
    activo: product.active,
    agencyAvailableStock: product.stockVerified === false ? null : number(product.availableStock),
    stockSource: product.stockSource,
    stockVerified: product.stockVerified !== false,
  }));
}

function operationalDemand(facts, products) {
  const byId = new Map(products.map((product) => [product.id, product]));
  return (facts?.productSales30d || []).map((row) => ({
    product: byId.get(row.productId),
    units: number(row.units),
    revenue: number(row.revenue),
    orders: number(row.orders),
  })).filter((row) => row.product)
    .sort((left, right) => right.units - left.units
      || right.revenue - left.revenue
      || left.product.id.localeCompare(right.product.id));
}

function preparationDisplayName(preparation = {}) {
  const name = text(preparation.name);
  const flavor = text(preparation.flavor);
  return flavor && !name.toLocaleLowerCase("es").includes(flavor.toLocaleLowerCase("es"))
    ? `${name} ${flavor}`
    : name;
}

function operationalProduction(facts) {
  const source = facts?.production || {};
  const preparationNeeds = (source.criticalPreparations || []).map((preparation) => ({
    severity: preparation.severity || "Crítica",
    subrecipeName: preparationDisplayName(preparation),
    flavor: text(preparation.flavor),
    recommendedAmount: number(preparation.recommendedAmount),
    unit: text(preparation.unit),
  }));
  return {
    summary: {
      queueUnits: number(source.queueUnits),
      units: number(source.planUnits),
      runs: number(source.planRuns),
    },
    preparationNeeds,
  };
}

function productDemand(db, today, windowDays = 30) {
  const orders = new Map((db.orders || []).filter((order) => {
    if (!isPaidOrder(order)) return false;
    const age = daysBetween(order.fecha || order.pagadoEn, today);
    return age !== null && age >= 0 && age < windowDays;
  }).map((order) => [order.id, order]));
  const result = new Map();
  (db.order_items || []).forEach((line) => {
    if (!orders.has(line.orderId) || line.parentItemId) return;
    const product = activeProduct(db, line.productId);
    if (!product) return;
    const current = result.get(product.id) || { product, units: 0, revenue: 0, orders: new Set() };
    const quantity = Math.max(1, number(line.cant));
    current.units += quantity;
    current.revenue += number(line.precio) * quantity;
    current.orders.add(line.orderId);
    result.set(product.id, current);
  });
  return [...result.values()].map((row) => ({ ...row, orders: row.orders.size }))
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.product.id.localeCompare(b.product.id));
}

function exactStock(db, today) {
  const byProduct = new Map();
  (db.variantes || []).forEach((variant) => {
    if (variant.vence && isoDay(variant.vence) < today) return;
    const product = activeProduct(db, variant.productId);
    if (!product) return;
    byProduct.set(product.id, (byProduct.get(product.id) || 0) + number(variant.disponibles));
  });
  return byProduct;
}

function status(value, detail) {
  return { value, detail };
}

function angle(id, title, format, promise, proof, channel) {
  return { id, title, format, promise, proof, channel };
}

function recommendation(mode, product, facts) {
  const productName = product?.nombre || "postre o presentación foco por definir";
  const type = mode.id === "marca-comunidad" || mode.id === "pauta-aprendizaje" ? "Crear contenido" : "Impulsar producto";
  return {
    id: `growth-${mode.id}-${product?.id || "sin-producto"}`,
    type,
    pillar: mode.id === "marca-comunidad" ? "Marca" : mode.id === "pauta-aprendizaje" ? "Pauta" : "Producto",
    risk: mode.status.value === "Bloqueado" ? "Alto" : mode.status.value === "Preparar" ? "Medio" : "Bajo",
    title: `${mode.label}: ${productName}`,
    rationale: `${mode.objective} ${mode.nextStep}`.trim(),
    evidence: {
      growthMode: mode.id,
      exactStock: facts.exactStockUnits,
      queueUnits: facts.queueUnits,
      productionUnits: facts.productionUnits,
      paidOrders30d: facts.paidOrders30d,
      measurementReady: facts.measurementReady,
      externalExecution: false,
    },
    productId: product?.id || "",
    channel: mode.channel === "Orgánico" ? "Instagram" : mode.channel === "Pauta" ? "Instagram" : "Multicanal",
    suggestedOffer: "",
  };
}

export function buildGrowthMultimodeEngine(db = {}, options = {}) {
  const today = options.today || businessDateISO();
  const operationalFacts = readyOperationalFacts(db);
  const activeProducts = operationalFacts
    ? operationalProducts(operationalFacts)
    : (db.products || []).filter((product) => product.activo !== false);
  const demand = operationalFacts
    ? operationalDemand(operationalFacts, activeProducts)
    : productDemand(db, today);
  const stockByProduct = operationalFacts
    ? new Map(activeProducts.filter((product) => product.stockVerified)
      .map((product) => [product.id, number(product.agencyAvailableStock)]))
    : exactStock(db, today);
  const production = operationalFacts
    ? operationalProduction(operationalFacts)
    : buildKitchenProductionPlan(db, { today, horizonDays: 3, historyDays: 28 });
  const topDemand = demand[0]?.product || null;
  const topStock = [...stockByProduct.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const stockProduct = topStock
    ? activeProducts.find((candidate) => candidate.id === topStock[0]) || null
    : null;
  const product = topDemand || stockProduct || activeProducts[0] || null;
  const legacyPaidOrders = operationalFacts ? null : (db.orders || []).filter((order) => {
    if (!isPaidOrder(order)) return false;
    const age = daysBetween(order.fecha || order.pagadoEn, today);
    return age !== null && age >= 0 && age < 30;
  });
  const paidOrders30d = operationalFacts
    ? number(operationalFacts.paidSummary.orders30d)
    : legacyPaidOrders.length;
  const attributedOrders30d = operationalFacts
    ? number(operationalFacts.paidSummary.attributedOrders30d)
    : legacyPaidOrders.filter((order) => order.campaignId || order.creativeId).length;
  const activeBatchUnits = operationalFacts
    ? number(operationalFacts.production.activeBatchUnits)
    : (db.production_batches || []).filter((batch) => ACTIVE_BATCH_STATES.has(batch.estado))
      .reduce((sum, batch) => sum + number(batch.prod), 0);
  const exactStockUnits = [...stockByProduct.values()].reduce((sum, value) => sum + value, 0);
  const unverifiedStockProducts = operationalFacts
    ? activeProducts.filter((candidate) => candidate.stockVerified === false).length
    : 0;
  const selectedStockVerified = !operationalFacts || !product || product.stockVerified !== false;
  const approvedCreatives = (db.creatives || []).filter((creative) => ["Aprobado", "Publicado", "Ganador"].includes(creative.estado));
  const brandReady = Boolean(db.agencyBrandProfile?.status === "Activo"
    || (db.brand_library?.tono || []).length >= 2
    || (db.brand_library?.frases || []).length >= 2);
  const measurementReady = Boolean(db.agencyMetaIncrementalityReady
    || (db.agencyRetentionMeasurements || []).length
    || (db.creative_results || []).length);
  const criticalPreparations = production.preparationNeeds.filter((need) => need.severity === "Crítica");
  const facts = {
    today,
    source: operationalFacts ? "agency-operational-facts-v1" : "h66-fallback",
    activeProducts: activeProducts.length,
    exactStockUnits,
    stockCoverageVerified: unverifiedStockProducts === 0,
    unverifiedStockProducts,
    stockProductId: stockProduct?.id || "",
    paidOrders30d,
    attributedOrders30d,
    queueUnits: number(production.summary.queueUnits),
    productionUnits: number(production.summary.units),
    activeBatchUnits,
    criticalPreparations: criticalPreparations.length,
    approvedCreatives: approvedCreatives.length,
    brandReady,
    measurementReady,
    topProductId: product?.id || "",
    topProductName: product?.nombre || "",
  };

  const immediateStatus = exactStockUnits > 0
    ? status("Listo", `${exactStockUnits} unidad(es) exactas pueden sostener una promesa inmediata.`)
    : unverifiedStockProducts > 0
      ? status("Bloqueado", `La disponibilidad de ${unverifiedStockProducts} producto(s) es desconocida; primero verificá su fuente de stock.`)
      : status("Preparar", "No hay producto terminado exacto; primero elegí una corrida verificable.");
  const demandStatus = !selectedStockVerified
    ? status("Bloqueado", "El postre o la presentación foco tiene stock desconocido. Verificá inventario o capacidad antes de conquistar demanda.")
    : product && (production.summary.units > 0 || demand.length > 0)
      ? status("Plan listo", criticalPreparations.length
        ? `La demanda puede abrirse, pero ${criticalPreparations.length} preparación(es) deben quedar listas antes de escalar.`
        : "Producción tiene una corrida o demanda concreta para adaptar la capacidad.")
      : status("Preparar", "Falta elegir producto y una señal de demanda que Producción pueda convertir en corrida.");
  const brandStatus = brandReady
    ? status("Listo", "La identidad de MOMOS permite crear conexión sin depender del stock del día.")
    : status("Preparar", "Primero hay que activar una versión de marca o confirmar el lenguaje de MOMOS.");
  const paidStatus = !selectedStockVerified
    ? status("Bloqueado", "La pauta no puede ampliarse con disponibilidad desconocida del postre o la presentación foco.")
    : product && approvedCreatives.length > 0 && measurementReady
      ? status("Listo", "Hay postre o presentación foco, creativo aprobado y una base de medición para comparar hipótesis.")
      : status("Preparar", [!product && "postre o presentación foco", approvedCreatives.length === 0 && "creativo aprobado", !measurementReady && "medición"].filter(Boolean).join(", ") || "evidencia");

  const modes = [
    {
      id: "venta-inmediata", icon: "🍨", label: "Vender lo que está listo", shortLabel: "Venta inmediata",
      channel: "Mixto", objective: "Convertir disponibilidad vigente en ventas sin crear faltantes.", status: immediateStatus,
      score: Math.min(100, 30 + Math.min(45, exactStockUnits * 4) + Math.min(25, paidOrders30d * 2)),
      primaryMetric: "Margen vendido sin faltantes", supportingMetrics: ["Unidades exactas vendidas", "Tiempo hasta la venta", "Pedidos sin sustitución"],
      why: [facts.exactStockUnits ? `Hay ${facts.exactStockUnits} unidades exactas disponibles.` : "El stock exacto está en cero.", facts.paidOrders30d ? `${facts.paidOrders30d} pedidos pagados dan una referencia real.` : "Aún no hay compras recientes suficientes."],
      nextStep: facts.exactStockUnits ? `Preparar una oferta clara para ${stockProduct?.nombre || product?.nombre || "el producto disponible"}.` : "Abrir Producción y cubrir una variante exacta antes de prometerla.",
      safeguards: ["Solo ofrece figura y sabor vigentes", "No usa stock agregado como disponibilidad exacta", "La persona aprueba el brief"],
      angles: [
        angle("antojo", "Antojo que se resuelve hoy", "Reel o historia", "Un momento MOMOS disponible ahora", "Producto real y variante exacta", "Mixto"),
        angle("ocasion", "Un detalle para hoy", "Carrusel", "Convertir una ocasión cotidiana en regalo", "Stock y ventana de entrega", "Orgánico"),
      ],
    },
    {
      id: "conquistar-demanda", icon: "🚀", label: "Salir a conquistar demanda", shortLabel: "Demanda agresiva",
      channel: "Mixto", objective: "Vender con ambición y hacer que Producción se adapte a la demanda validada.", status: demandStatus,
      score: Math.min(100, 42 + Math.min(28, demand.reduce((sum, row) => sum + row.units, 0) * 2) + Math.min(30, production.summary.units * 3)),
      primaryMetric: "Beneficio incremental cubierto por producción", supportingMetrics: ["Demanda capturada", "Corridas creadas", "Promesas cumplidas"],
      why: [demand.length ? `${demand[0].units} unidad(es) recientes del producto líder muestran demanda.` : "Todavía no existe una señal histórica fuerte.", production.summary.units ? `El plan de Cocina propone ${production.summary.units} unidad(es) en ${production.summary.runs} corrida(s).` : "Producción aún no tiene una corrida sugerida."],
      nextStep: criticalPreparations.length ? `Preparar ${criticalPreparations.map((need) => need.subrecipeName).slice(0, 2).join(" y ")} y confirmar capacidad antes de escalar.` : "Aprobar el postre o la presentación foco y convertir la demanda en corrida antes de ampliar alcance.",
      safeguards: ["La campaña no salta los gates de Cocina", "Toda promesa crea cobertura de producción", "Si faltan insumos, la escala se detiene"],
      productionPlan: {
        runs: production.summary.runs,
        units: production.summary.units,
        preparations: criticalPreparations.map((need) => {
          const amount = need.recommendedAmount ?? need.recommendedGrams;
          const unit = need.unit || "g";
          return { name: need.subrecipeName, amount, unit, ...(unit === "g" ? { grams: amount } : {}) };
        }),
      },
      angles: [
        angle("deseo", "El postre que no sabías que necesitabas", "Video vertical", "Provocar deseo antes de hablar de precio", "Textura, relleno y corte reales", "Pauta"),
        angle("regalo", "Regalar MOMOS cambia el momento", "UGC o testimonial", "Vender ocasión y emoción", "Entrega real y reacción humana", "Mixto"),
        angle("sabor", "Elegí tu combinación favorita", "Carrusel o encuesta", "Convertir variedad en participación", "Figuras y sabores producibles", "Orgánico"),
      ],
    },
    {
      id: "marca-comunidad", icon: "💗", label: "Construir marca y comunidad", shortLabel: "Marca y comunidad",
      channel: "Orgánico", objective: "Crear memoria, cercanía y conversación para que MOMOS sea elegida antes de la oferta.", status: brandStatus,
      score: Math.min(100, 50 + (brandReady ? 25 : 0) + Math.min(25, (db.agencyRetentionLearnings || []).length * 5)),
      primaryMetric: "Retención y conversaciones con intención", supportingMetrics: ["Retención del video", "Guardados y compartidos", "Mensajes orgánicos"],
      why: [brandReady ? "La identidad de MOMOS está disponible para gobernar el contenido." : "La identidad todavía necesita confirmación.", "Este modo no promete disponibilidad ni depende del inventario del día."],
      nextStep: "Elegir una historia humana o animada y definir qué emoción debe quedar después de verla.",
      safeguards: ["Siempre Orgánico", "Sin urgencia falsa", "La historia conserva personajes, tono y derechos"],
      angles: [
        angle("dia-momos", "Acompáñame un día dentro de MOMOS", "Video humano", "Mostrar el cuidado detrás del postre", "Proceso real y voz del equipo", "Orgánico"),
        angle("historia-animada", "Una pequeña historia del universo MOMOS", "Animación", "Crear afecto por personajes y marca", "Biblia de personajes y continuidad", "Orgánico"),
        angle("cocina", "Así nace una combinación MOMOS", "Behind the scenes", "Convertir oficio en confianza", "Tomas reales de cocina", "Orgánico"),
        angle("comunidad", "La comunidad elige el siguiente sabor", "Encuesta o serie", "Hacer que la audiencia participe", "Respuesta y seguimiento público", "Orgánico"),
      ],
    },
    {
      id: "pauta-aprendizaje", icon: "🎯", label: "Probar y escalar con pauta", shortLabel: "Pauta con aprendizaje",
      channel: "Pauta", objective: "Comparar ángulos de venta y escalar solo el beneficio incremental demostrado.", status: paidStatus,
      score: Math.min(100, 28 + (product ? 15 : 0) + (approvedCreatives.length ? 22 : 0) + (measurementReady ? 25 : 0) + Math.min(10, attributedOrders30d * 2)),
      primaryMetric: "Beneficio incremental", supportingMetrics: ["Conversión por ángulo", "Costo por pedido incremental", "Capacidad consumida"],
      why: [approvedCreatives.length ? `${approvedCreatives.length} creativo(s) aprobados pueden alimentar una prueba.` : "Falta un creativo aprobado.", measurementReady ? "Existe una base de medición para evitar confundir atribución con causalidad." : "Falta cerrar la medición antes de invertir."],
      nextStep: "Elegir una sola variable por prueba y preparar al menos tres ángulos de venta comparables.",
      safeguards: ["Pauta separada de Orgánico", "Una variable por experimento", "Sin gasto ni publicación automática", "Escala condicionada a stock, capacidad y margen"],
      angles: [
        angle("sensorial", "Textura y relleno irresistibles", "Anuncio de producto", "Detener el scroll con experiencia sensorial", "Macro real, corte limpio y producto exacto", "Pauta"),
        angle("prueba-social", "La reacción al abrir un MOMOS", "UGC", "Reducir riesgo con prueba social", "Testimonio autorizado y experiencia real", "Pauta"),
        angle("ocasion-pauta", "El regalo que sí sorprende", "Anuncio narrativo", "Vender una ocasión, no solo un postre", "Oferta y entrega verificables", "Pauta"),
        angle("diferenciacion", "No es otro postre: es tu MOMOS", "Video demostrativo", "Explicar figura, sabor y personalización", "Producto y marca sin claims inventados", "Pauta"),
      ],
    },
  ];

  modes.forEach((mode) => { mode.recommendation = recommendation(mode, product, facts); });
  const eligible = modes.filter((mode) => mode.status.value !== "Bloqueado")
    .sort((a, b) => b.score - a.score || GROWTH_MODE_IDS.indexOf(a.id) - GROWTH_MODE_IDS.indexOf(b.id));
  const recommendedModeId = eligible[0]?.id || "marca-comunidad";
  return {
    version: 1,
    generatedAt: `${today}T12:00:00.000Z`,
    recommendedModeId,
    facts,
    modes,
    policy: {
      humanDecisionRequired: true,
      externalExecution: false,
      paidOrganicSeparated: true,
      capacityGateRequired: true,
      statement: "El motor propone caminos; una persona elige. MOMOS OPS no publica, pauta, gasta ni promete stock por sí solo.",
    },
  };
}
