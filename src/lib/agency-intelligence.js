import { normalizeAgencyOperationalFacts } from "./agency-operational-facts.js";
import { DEFAULT_AGENCY_SETTINGS } from "./agency-settings.js";
import { commercialFamilyLabel, isCommercialFamilyProduct } from "./momos-domain-language.js";
import { businessDateISO } from "./business-date.js";
import {
  buildCanonicalFinishedStock, canonicalExactFinishedStock,
  canonicalFinishedProductStock, canonicalUsableIngredientStock,
} from "./canonical-stock.js";
import { calculateOrderAttributionRevenue } from "./order-money.js";
import { buildCanonicalPhysicalResults } from "./canonical-production-results.js";

export { DEFAULT_AGENCY_SETTINGS } from "./agency-settings.js";

const PAID_STATES = new Set([
  "Pagado", "En producción", "Listo para empaque", "Empacado",
  "Listo para despacho", "En ruta", "Entregado", "Reclamo",
]);

const number = (value) => Number(value || 0);
const isoDate = (value) => {
  if (!value) return "";
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};
const daysBetween = (from, to) => {
  const left = isoDate(from); const right = isoDate(to);
  if (!left || !right) return null;
  return Math.round((new Date(`${right}T12:00:00`) - new Date(`${left}T12:00:00`)) / 86400000);
};
const isPaidOrder = (order) => order?.estado !== "Cancelado" && Boolean(order?.pagadoEn || PAID_STATES.has(order?.estado));

const SERVER_DECISION_TYPES = new Set([
  "Crear contenido", "Contactar segmento", "Activar campaña", "Pausar campaña",
  "Escalar presupuesto", "Reponer stock", "Revisar creativo", "Revisar oferta", "Otro",
]);

export function agencyDecisionType(value) {
  const type = String(value || "").trim();
  if (SERVER_DECISION_TYPES.has(type)) return type;
  if (type === "Activar cumpleaños") return "Contactar segmento";
  if (["Impulsar producto", "Mover inventario", "Repetir creativo"].includes(type)) return "Crear contenido";
  return "Otro";
}

export function normalizeAgencySettings(settings = {}) {
  return {
    ...DEFAULT_AGENCY_SETTINGS,
    ...settings,
    dailyBudgetLimit: Math.max(0, number(settings.dailyBudgetLimit ?? DEFAULT_AGENCY_SETTINGS.dailyBudgetLimit)),
    campaignBudgetLimit: Math.max(0, number(settings.campaignBudgetLimit ?? DEFAULT_AGENCY_SETTINGS.campaignBudgetLimit)),
    scaleStepPct: Math.min(30, Math.max(0, number(settings.scaleStepPct ?? DEFAULT_AGENCY_SETTINGS.scaleStepPct))),
  };
}

function orderRevenue(order, db) {
  return calculateOrderAttributionRevenue(db, order);
}

function resolveProduct(db, reference) {
  if (!reference) return null;
  return (db.products || []).find((product) => product.id === reference || product.nombre === reference) || null;
}

function campaignProduct(campaign, db) {
  return resolveProduct(db, campaign?.productoFocoId || campaign?.productoFoco);
}

function creativeProduct(creative, db) {
  return resolveProduct(db, creative?.productoFocoId || creative?.productoFoco);
}

function usableIngredientStock(db, itemId, today) {
  const stock = canonicalUsableIngredientStock(db, itemId, { today });
  return stock.item ? stock.usable : null;
}

function productStock(db, reference, today = businessDateISO(), visited = new Set(), finishedView = null) {
  const product = resolveProduct(db, reference);
  if (!product || product.activo === false || visited.has(product.id)) return null;
  // H67 distingue explÃ­citamente "desconocido" de cero. Ninguna receta o
  // valor legado puede rellenar silenciosamente una fuente no verificada.
  if (product.stockVerified === false || product.stockSource === "unverified") return null;
  const nextVisited = new Set(visited); nextVisited.add(product.id);
  if (isCommercialFamilyProduct(product)
    && product.stock !== undefined && product.stock !== null
    && Array.isArray(db.variantes) && db.variantes.length) {
    const canonical = canonicalFinishedProductStock(db, product.id, {
      today,
      view: finishedView || buildCanonicalFinishedStock(db, { today }),
    });
    return canonical?.sellable ?? null;
  }
  const exact = (db.variantes || []).filter((item) => item.productId === product.id && (!item.vence || item.vence >= today));
  if (exact.length) return exact.reduce((sum, item) => sum + number(item.disponibles), 0);
  if (product.stock !== undefined && product.stock !== null) return Math.max(0, number(product.stock));

  if (product.tipo === "combo" && product.comboSize) {
    const componentIds = product.componentProductIds || [];
    const componentStock = componentIds.reduce((sum, id) => sum + Math.max(0, productStock(db, id, today, nextVisited, finishedView) || 0), 0);
    const boxes = Math.floor(componentStock / Math.max(1, number(product.comboSize)));
    const packaging = product.empaqueItem ? usableIngredientStock(db, product.empaqueItem, today) : null;
    return packaging === null ? boxes : Math.min(boxes, Math.floor(packaging));
  }

  const recipe = (db.recipes || []).filter((line) => line.productId === product.id && number(line.cantidad) > 0);
  if (recipe.length) {
    const capacities = recipe.map((line) => {
      const stock = usableIngredientStock(db, line.itemId, today);
      return stock === null ? null : Math.floor(stock / number(line.cantidad));
    });
    if (capacities.some((capacity) => capacity === null)) return null;
    return Math.min(...capacities);
  }
  return null;
}

export function agencyProductStock(db, reference, today = businessDateISO()) {
  const finishedView = Array.isArray(db?.variantes) && db.variantes.length
    ? buildCanonicalFinishedStock(db, { today })
    : null;
  return productStock(db, reference, today, new Set(), finishedView);
}

export function agencyExactVariantStock(db, {
  productId, figure, flavor, today = businessDateISO(),
} = {}) {
  return canonicalExactFinishedStock(db, { productId, figure, flavor, today });
}

export function agencyPhysicalProductionResults(db = {}, options = {}) {
  if (!Array.isArray(db.production_batches)) return null;
  return buildCanonicalPhysicalResults(db.production_batches || [], options);
}

function platformMetrics(db) {
  const raw = db.creative_results || [];
  return raw.filter((metric) => metric.fuente !== "manual" || !raw.some((candidate) =>
    candidate.fuente && candidate.fuente !== "manual" &&
    candidate.fecha === metric.fecha && candidate.creativeId === metric.creativeId && candidate.campaignId === metric.campaignId
  ));
}

function campaignPerformance(campaign, db, facts = null) {
  const attribution = facts?.campaignAttribution.find((row) => row.campaignId === campaign.id);
  const orders = facts ? null : (db.orders || []).filter((order) => order.campaignId === campaign.id && isPaidOrder(order));
  const platform = platformMetrics(db).filter((metric) => metric.campaignId === campaign.id);
  const spend = platform.reduce((sum, metric) => sum + number(metric.gasto), 0) || number(campaign.gastoReal);
  const revenue = facts ? number(attribution?.revenue) : orders.reduce((sum, order) => sum + orderRevenue(order, db), 0);
  return {
    campaignId: campaign.id,
    orders: facts ? number(attribution?.orders) : orders.length,
    revenue,
    spend,
    roas: spend > 0 ? revenue / spend : null,
    clicks: platform.reduce((sum, metric) => sum + number(metric.clicks), 0),
    messages: platform.reduce((sum, metric) => sum + number(metric.mensajesWhatsApp), 0),
  };
}

function creativePerformance(creative, db, facts = null) {
  const attribution = facts?.creativeAttribution.find((row) => row.creativeId === creative.id);
  const orders = facts ? null : (db.orders || []).filter((order) => order.creativeId === creative.id && isPaidOrder(order));
  const platform = platformMetrics(db).filter((metric) => metric.creativeId === creative.id);
  const spend = platform.reduce((sum, metric) => sum + number(metric.gasto), 0);
  const revenue = facts ? number(attribution?.revenue) : orders.reduce((sum, order) => sum + orderRevenue(order, db), 0);
  return {
    creative,
    orders: facts ? number(attribution?.orders) : orders.length,
    revenue,
    spend,
    roas: spend > 0 ? revenue / spend : null,
    clicks: platform.reduce((sum, metric) => sum + number(metric.clicks), 0),
    messages: platform.reduce((sum, metric) => sum + number(metric.mensajesWhatsApp), 0),
  };
}

function contactEligibleCustomers(db, today) {
  const profiles = new Map((db.customer_crm_profiles || []).map((profile) => [profile.customerId, profile]));
  return (db.customers || []).filter((customer) => {
    const profile = profiles.get(customer.id);
    if (profile?.contactAllowed !== true || (!customer.telefono && !customer.instagram)) return false;
    const inactiveDays = daysBetween(customer.ultima, today);
    return inactiveDays !== null && inactiveDays > 30;
  });
}

function birthdayDistance(birthday, today) {
  const match = String(birthday || "").match(/(?:^|\d{4}-)(\d{2})-(\d{2})$/);
  if (!match) return null;
  const current = new Date(`${today}T12:00:00`);
  let target = new Date(Date.UTC(current.getUTCFullYear(), Number(match[1]) - 1, Number(match[2]), 12));
  if (target < current) target = new Date(Date.UTC(current.getUTCFullYear() + 1, Number(match[1]) - 1, Number(match[2]), 12));
  return Math.round((target - current) / 86400000);
}

function birthdayCustomers(db, today) {
  const profiles = new Map((db.customer_crm_profiles || []).map((profile) => [profile.customerId, profile]));
  return (db.customers || []).map((customer) => ({ customer, days: birthdayDistance(customer.cumple, today) }))
    .filter(({ customer, days }) => days !== null && days <= 7 && profiles.get(customer.id)?.contactAllowed === true && (customer.telefono || customer.instagram));
}

function productSales(db, today, windowDays = 30, facts = null) {
  if (facts) {
    const products = new Map((db.products || []).map((product) => [product.id, product]));
    return facts.productSales30d.map((entry) => ({
      product: products.get(entry.productId),
      units: entry.units,
      revenue: entry.revenue,
      orders: entry.orders,
    })).filter((entry) => entry.product && entry.product.activo !== false)
      .sort((left, right) => right.units - left.units || right.revenue - left.revenue || left.product.id.localeCompare(right.product.id));
  }
  const eligibleOrders = new Map((db.orders || []).filter((order) => {
    if (!isPaidOrder(order)) return false;
    const age = daysBetween(order.fecha || order.pagadoEn, today);
    return age !== null && age >= 0 && age <= windowDays;
  }).map((order) => [order.id, order]));
  const stats = new Map();
  (db.order_items || []).filter((line) => !line.parentItemId && eligibleOrders.has(line.orderId)).forEach((line) => {
    const product = resolveProduct(db, line.productId || line.nombre);
    if (!product || product.activo === false) return;
    const current = stats.get(product.id) || { product, units: 0, revenue: 0, orders: new Set() };
    current.units += Math.max(1, number(line.cant));
    current.revenue += number(line.precio) * Math.max(1, number(line.cant));
    current.orders.add(line.orderId);
    stats.set(product.id, current);
  });
  return [...stats.values()].map((entry) => ({ ...entry, orders: entry.orders.size }))
    .sort((left, right) => right.units - left.units || right.revenue - left.revenue || left.product.id.localeCompare(right.product.id));
}

function agencyFactsContext(db) {
  if (db?.agencyOperationalFactsReady !== true) return null;
  const facts = normalizeAgencyOperationalFacts(db.agencyOperationalFacts);
  if (!facts) return null;
  const products = facts.productCatalog.map((product) => ({
    id: product.productId,
    nombre: product.name,
    cat: product.category,
    tipo: product.type,
    activo: product.active,
    stock: product.availableStock,
    agencyAvailableStock: product.availableStock,
    stockSource: product.stockSource,
    stockVerified: product.stockVerified,
  }));
  return {
    facts,
    decisionDb: { products, creatives: db.creatives || [] },
  };
}

function agencyProductLabel(product) {
  if (!product) return "producto sin identificar";
  return isCommercialFamilyProduct(product)
    ? `la presentación comercial ${commercialFamilyLabel(product)}`
    : product.nombre;
}

function agencyFactsCalendar(facts) {
  const today = number(facts.calendar.today);
  return { today, next7d: today + number(facts.calendar.next7d) };
}

function signal(label, value) {
  return `${label}: ${value}`;
}

function recommendation(input) {
  return {
    pillar: "General", confidence: "Media", nextStep: "Convertir la oportunidad en un brief trazable.",
    signals: [], channel: "Multicanal", crmSegment: "", suggestedOffer: "", ...input,
    priority: Math.min(100, Math.max(0, number(input.priority))),
  };
}

export function guardAgencyAction(action = {}, db = {}, rawSettings = {}) {
  const settings = normalizeAgencySettings(rawSettings);
  const reasons = [];
  const warnings = [];
  const type = action.type || "";

  if (settings.paused && !["Crear brief", "Guardar borrador", "Reponer stock"].includes(type)) {
    reasons.push("La parada de emergencia de Agencia MOMOS está activa.");
  }
  if (settings.blockOutOfStock && action.productId) {
    const figure = action.figure ?? action.figura;
    const flavor = action.flavor ?? action.sabor;
    const stock = figure && flavor
      ? agencyExactVariantStock(db, {
        productId: action.productId, figure, flavor,
        today: action.today || businessDateISO(),
      })
      : productStock(db, action.productId, action.today);
    if (stock === null && !["Reponer stock", "Crear brief"].includes(type)) {
      reasons.push("No existe una disponibilidad verificable para el postre o la presentación comercial foco.");
    } else if (stock !== null && stock <= 0 && !["Reponer stock", "Crear brief"].includes(type)) {
      reasons.push("El postre o la presentación comercial foco no tiene stock disponible.");
    }
  }
  if (settings.requireCreativeApproval && action.creativeId && ["Activar campaña", "Publicar contenido", "Repetir creativo"].includes(type)) {
    const creative = (db.creatives || []).find((item) => item.id === action.creativeId);
    if (!creative || !["Aprobado", "Publicado", "Ganador"].includes(creative.estado)) {
      reasons.push("El creativo todavía no tiene aprobación humana.");
    }
  }
  const proposedBudget = number(action.proposedBudget);
  if (proposedBudget > settings.campaignBudgetLimit) reasons.push(`El presupuesto propuesto supera el límite por campaña de ${settings.campaignBudgetLimit}.`);
  if (number(action.dailySpend) + number(action.incrementalDailySpend) > settings.dailyBudgetLimit) reasons.push(`La acción supera el límite diario de ${settings.dailyBudgetLimit}.`);
  if (settings.contactOnlyAuthorized && action.customerIds?.length) {
    const profiles = new Map((db.customer_crm_profiles || []).map((profile) => [profile.customerId, profile]));
    const forbidden = action.customerIds.filter((id) => profiles.get(id)?.contactAllowed !== true);
    if (forbidden.length) reasons.push(`${forbidden.length} cliente(s) no tienen autorización explícita de contacto.`);
  }
  if (settings.autonomyMode === "Asesor" && action.execute) reasons.push("El modo Asesor solo permite proponer acciones.");
  else if (settings.autonomyMode === "Copiloto" && action.execute) warnings.push("Esta acción requiere aprobación humana antes de ejecutarse.");
  return { allowed: reasons.length === 0, reasons, warnings, settings };
}

export function buildAgencyIntelligence(db = {}, rawSettings = {}, today = businessDateISO()) {
  const settings = normalizeAgencySettings(rawSettings);
  const physicalProduction = agencyPhysicalProductionResults(db);
  const factsContext = agencyFactsContext(db);
  const facts = factsContext?.facts || null;
  // Con H67 listo, las decisiones operativas se resuelven sobre agregados
  // sin mezclar stock, pedidos ni clientes del estado legado.
  const operationalDb = factsContext?.decisionDb || db;
  const finishedView = Array.isArray(operationalDb?.variantes) && operationalDb.variantes.length
    ? buildCanonicalFinishedStock(operationalDb, { today })
    : null;
  const factCalendar = facts ? agencyFactsCalendar(facts) : null;
  const activeCampaigns = (db.campaigns || []).filter((campaign) => campaign.estado === "Activa");
  const performance = activeCampaigns.map((campaign) => ({ ...campaignPerformance(campaign, db, facts), campaign }));
  const recommendations = [];

  performance.forEach((metric) => {
    const product = campaignProduct(metric.campaign, operationalDb);
    const stock = product ? productStock(operationalDb, product.id, today, new Set(), finishedView) : null;
    if (product && stock === null) {
      recommendations.push(recommendation({
        id: `verify-stock-${metric.campaignId}`, type: "Revisar oferta", pillar: "Control interno", risk: "Alto", priority: 100, confidence: "Alta",
        title: `VerificÃ¡ disponibilidad antes de mover ${metric.campaign.nombre}`,
        rationale: "El postre o la presentación comercial foco no tiene una fuente de stock verificable; desconocido no significa agotado ni disponible.",
        evidence: { stock: null, stockSource: product.stockSource || "unverified", campaignId: metric.campaignId, spend: metric.spend },
        signals: ["Stock: por verificar", signal("Fuente", product.stockSource || "unverified"), signal("Gasto", metric.spend)],
        campaignId: metric.campaignId, productId: product.id,
        nextStep: "Verificar inventario terminado o capacidad exacta antes de pausar, escalar o ampliar la promesa.",
      }));
    } else if (product && stock <= 0) {
      recommendations.push(recommendation({
        id: `stock-${metric.campaignId}`, type: "Reponer stock", pillar: "Inventario", risk: "Alto", priority: 100, confidence: "Alta",
        title: `Protegé la pauta de ${metric.campaign.nombre}`,
        rationale: "La campaña está activa, pero su postre o presentación comercial foco no tiene disponibilidad para cumplir nuevas ventas.",
        evidence: { stock, campaignId: metric.campaignId, spend: metric.spend }, signals: [signal("Stock", stock), signal("Gasto", metric.spend)],
        campaignId: metric.campaignId, productId: product.id, nextStep: "Pausar la promesa comercial y enviar el faltante a Producción o Inventario.",
      }));
    } else if (metric.spend >= 25000 && metric.orders === 0) {
      recommendations.push(recommendation({
        id: `pause-${metric.campaignId}`, type: "Pausar campaña", pillar: "Pauta", risk: "Alto", priority: 92, confidence: "Alta",
        title: `Revisá ${metric.campaign.nombre} antes de gastar más`,
        rationale: "Ya consumió presupuesto y todavía no tiene pedidos pagados atribuidos.",
        evidence: { spend: metric.spend, clicks: metric.clicks, messages: metric.messages, orders: 0 },
        signals: [signal("Gasto", metric.spend), signal("Clicks", metric.clicks), "Pedidos: 0"], campaignId: metric.campaignId,
        productId: product?.id || null, nextStep: "Revisar segmentación, oferta y creativo; pausar solo después de aprobación humana.",
      }));
    } else if (metric.roas !== null && metric.roas >= 2 && metric.orders >= 2) {
      const proposedBudget = Math.round(number(metric.campaign.presupuesto) * (1 + settings.scaleStepPct / 100));
      recommendations.push(recommendation({
        id: `scale-${metric.campaignId}`, type: "Escalar presupuesto", pillar: "Pauta", risk: "Medio", priority: 78, confidence: "Alta",
        title: `Escalá con cuidado ${metric.campaign.nombre}`,
        rationale: `La campaña devuelve ${metric.roas.toFixed(1)}× y tiene ventas pagadas comprobadas.`,
        evidence: { roas: metric.roas, orders: metric.orders, revenue: metric.revenue, spend: metric.spend },
        signals: [signal("ROAS", `${metric.roas.toFixed(1)}×`), signal("Pedidos", metric.orders), signal("Ventas", metric.revenue)],
        campaignId: metric.campaignId, productId: product?.id || null, proposedBudget,
        nextStep: `Proponer un aumento máximo de ${settings.scaleStepPct}% y vigilar stock, CAC y pedidos.`,
      }));
    }
  });

  const birthdays = facts ? [] : birthdayCustomers(db, today);
  const birthdayCount = facts ? facts.crmSegments.birthdays7d : birthdays.length;
  if (birthdayCount) {
    recommendations.push(recommendation({
      id: `birthdays-${today}`, type: "Activar cumpleaños", pillar: "CRM", risk: "Medio", priority: 82, confidence: "Alta",
      title: `Acompañá ${birthdayCount} cumpleaños próximo(s)`, channel: "WhatsApp", crmSegment: "Cumpleaños en los próximos 7 días",
      rationale: "Son clientes identificados, con cumpleaños cercano y permiso explícito de contacto.",
      evidence: facts
        ? { eligibleCustomers: birthdayCount, windowDays: 7, source: "agency-operational-facts-v1" }
        : { customers: birthdays.map(({ customer, days }) => ({ id: customer.id, days })) },
      signals: facts
        ? [signal("Cumpleaños con permiso", birthdayCount), "Ventana: 7 días"]
        : birthdays.slice(0, 3).map(({ customer, days }) => `${customer.nombre}: ${days === 0 ? "hoy" : `en ${days} día(s)`}`),
      ...(facts ? {} : { customerIds: birthdays.map(({ customer }) => customer.id) }),
      suggestedOffer: "Detalle de cumpleaños MOMOS con vigencia corta",
      nextStep: "Crear una activación individual, revisar el beneficio y aprobar el mensaje antes de enviarlo.",
    }));
  }

  const sales = productSales(operationalDb, today, 30, facts);
  const activeProductIds = new Set(activeCampaigns.map((campaign) => campaignProduct(campaign, operationalDb)?.id).filter(Boolean));
  const promotable = sales.find((entry) => entry.units >= 2 && !activeProductIds.has(entry.product.id) && number(productStock(operationalDb, entry.product.id, today, new Set(), finishedView)) > 0);
  if (promotable) {
    const stock = productStock(operationalDb, promotable.product.id, today, new Set(), finishedView);
    recommendations.push(recommendation({
      id: `product-momentum-${promotable.product.id}-${today}`, type: "Impulsar producto", pillar: "Producto", risk: "Medio", priority: 74, confidence: "Alta",
      title: `Convertí la demanda de ${agencyProductLabel(promotable.product)} en campaña`,
      rationale: "Tiene ventas recientes, disponibilidad verificable y no cuenta con una campaña activa propia.",
      evidence: { units30d: promotable.units, orders30d: promotable.orders, revenue30d: promotable.revenue, stock },
      signals: [signal("Vendidas 30 días", promotable.units), signal("Pedidos", promotable.orders), signal("Stock", stock)],
      productId: promotable.product.id, channel: "Instagram", nextStep: "Crear un brief con el aprendizaje de compra y una pieza orientada a conversión.",
    }));
  }

  const soldProductIds = new Set(sales.map((entry) => entry.product.id));
  const idleStock = (operationalDb.products || []).filter((product) => product.activo !== false && !soldProductIds.has(product.id) && !activeProductIds.has(product.id))
    .map((product) => ({ product, stock: productStock(operationalDb, product.id, today, new Set(), finishedView) }))
    .filter((entry) => Number.isFinite(entry.stock) && entry.stock >= 5)
    .sort((left, right) => right.stock - left.stock || left.product.id.localeCompare(right.product.id))[0];
  if (idleStock) {
    recommendations.push(recommendation({
      id: `idle-stock-${idleStock.product.id}-${today}`, type: "Mover inventario", pillar: "Producto", risk: "Medio", priority: 68, confidence: "Media",
      title: `Dale salida a ${agencyProductLabel(idleStock.product)}`,
      rationale: "Tiene inventario disponible, pero no registra ventas pagadas en los últimos 30 días ni una campaña activa.",
      evidence: { stock: idleStock.stock, units30d: 0, activeCampaigns: 0 }, signals: [signal("Stock", idleStock.stock), "Ventas 30 días: 0", "Campaña activa: no"],
      productId: idleStock.product.id, channel: "Instagram", nextStep: "Investigar primero precio, presentación y audiencia; no descontar sin revisar margen.",
    }));
  }

  const creativeMetrics = (db.creatives || []).map((creative) => creativePerformance(creative, db, facts));
  const winner = creativeMetrics.filter((metric) => metric.orders >= 2 && (metric.roas === null || metric.roas >= 1.5))
    .sort((left, right) => right.orders - left.orders || number(right.roas) - number(left.roas) || left.creative.id.localeCompare(right.creative.id))[0];
  if (winner) {
    const product = creativeProduct(winner.creative, operationalDb);
    recommendations.push(recommendation({
      id: `repeat-${winner.creative.id}-${today}`, type: "Repetir creativo", pillar: "Contenido", risk: "Bajo", priority: 66, confidence: "Alta",
      title: `Versioná el aprendizaje de ${winner.creative.titulo}`,
      rationale: "El creativo tiene pedidos pagados atribuidos; conviene repetir su estructura sin publicar una copia idéntica.",
      evidence: { orders: winner.orders, revenue: winner.revenue, spend: winner.spend, roas: winner.roas },
      signals: [signal("Pedidos", winner.orders), signal("Ventas", winner.revenue), signal("ROAS", winner.roas === null ? "orgánico" : `${winner.roas.toFixed(1)}×`)],
      creativeId: winner.creative.id, campaignId: winner.creative.campaignId || null, productId: product?.id || null,
      channel: winner.creative.canal || "Instagram", nextStep: "Crear una nueva versión con el mismo hook y una variación visual; someterla a aprobación.",
    }));
  }

  const todayPosts = facts
    ? factCalendar.today
    : (db.content_calendar || []).filter((post) => isoDate(post.fecha) === today && post.estado !== "No publicado").length;
  if (!todayPosts) {
    recommendations.push(recommendation({
      id: `content-${today}`, type: "Crear contenido", pillar: "Contenido", risk: "Bajo", priority: 60, confidence: "Alta",
      title: "Prepará una pieza de contenido para hoy", rationale: "No hay ninguna publicación programada para hoy.",
      evidence: { date: today, scheduledPosts: 0 }, signals: [signal("Fecha", today), "Publicaciones: 0"], channel: "Instagram",
      nextStep: "Elegir producto y objetivo, producir el archivo y aprobarlo antes de programar.",
    }));
  }

  const dormantCustomers = facts ? [] : contactEligibleCustomers(db, today);
  const dormantCount = facts ? facts.crmSegments.dormant30d : dormantCustomers.length;
  if (dormantCount) {
    recommendations.push(recommendation({
      id: `reactivate-${today}`, type: "Contactar segmento", pillar: "CRM", risk: "Medio", priority: 55, confidence: "Alta",
      title: `Reactivá ${dormantCount} cliente(s) con permiso`, channel: "WhatsApp", crmSegment: "Clientes inactivos con permiso",
      rationale: "Llevan más de 30 días sin comprar y tienen un canal de contacto disponible.",
      evidence: { eligibleCustomers: dormantCount, inactivityDays: 30, ...(facts ? { source: "agency-operational-facts-v1" } : {}) },
      signals: [signal("Contactables", dormantCount), "Inactividad: +30 días"],
      ...(facts ? {} : { customerIds: dormantCustomers.map((customer) => customer.id) }),
      nextStep: "Crear una activación medible y excluir a quien cambie su preferencia de contacto.",
    }));
  }

  const pendingCreatives = (db.creatives || []).filter((creative) => creative.estado === "En revisión");
  if (pendingCreatives.length) {
    recommendations.push(recommendation({
      id: `review-${today}`, type: "Revisar creativo", pillar: "Marca", risk: "Bajo", priority: 50, confidence: "Alta",
      title: `Revisá ${pendingCreatives.length} creativo(s) antes de publicar`,
      rationale: "La aprobación humana protege la marca y evita publicaciones accidentales.",
      evidence: { pendingCreatives: pendingCreatives.length }, signals: [signal("En revisión", pendingCreatives.length)], creativeId: pendingCreatives[0].id,
      nextStep: "Comparar archivo, copy, promesa y palabras prohibidas; aprobar o devolver con feedback.",
    }));
  }

  const unique = [...new Map(recommendations.map((item) => [item.id, item])).values()]
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const guarded = unique.map((item) => ({ ...item, guard: guardAgencyAction({ ...item, today, execute: true }, operationalDb, settings) }));
  const allPaidOrders = facts ? null : (db.orders || []).filter(isPaidOrder);
  const revenue = facts
    ? facts.paidSummary.revenue30d
    : allPaidOrders.reduce((sum, order) => sum + orderRevenue(order, db), 0);
  const spend = platformMetrics(db).reduce((sum, metric) => sum + number(metric.gasto), 0);
  const scheduledNext7 = facts ? factCalendar.next7d : (db.content_calendar || []).filter((post) => {
    const distance = daysBetween(today, post.fecha);
    return distance !== null && distance >= 0 && distance <= 7 && !["No publicado", "Cancelado"].includes(post.estado);
  }).length;

  return {
    settings,
    recommendations: guarded,
    performance,
    productSales: sales,
    creativePerformance: creativeMetrics,
    physicalProduction,
    pipeline: {
      opportunities: guarded.length,
      briefs: (db.agencyBriefs || []).filter((brief) => !["Descartado", "Completado"].includes(brief.status)).length,
      approvals: (db.agencyDecisions || []).filter((decision) => decision.status === "Propuesta").length,
      creativeReview: (db.agencyCreativeVersions || []).filter((version) => version.status === "En revisión").length + pendingCreatives.length,
      scheduled: scheduledNext7,
      learning: (db.agencyDecisions || []).filter((decision) => decision.status === "Ejecutada" && decision.result).length,
    },
    summary: {
      revenue, spend, blendedRoas: spend > 0 ? revenue / spend : null,
      opportunities: guarded.length,
      blocked: guarded.filter((item) => !item.guard.allowed).length,
      activeCampaigns: activeCampaigns.length,
      pendingCreatives: pendingCreatives.length,
      eligibleCustomers: dormantCount + birthdayCount,
      productsWithStock: (operationalDb.products || []).filter((product) => number(productStock(operationalDb, product.id, today, new Set(), finishedView)) > 0).length,
      winners: winner ? 1 : 0,
      scheduledNext7,
      producedUnits: physicalProduction?.produced ?? null,
      grossWasteUnits: physicalProduction?.grossWasteUnits ?? null,
      grossWasteRate: physicalProduction?.grossWasteRate ?? null,
      definitiveLossUnits: physicalProduction?.definitiveLossUnits ?? null,
    },
  };
}
