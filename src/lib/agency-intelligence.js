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

export const DEFAULT_AGENCY_SETTINGS = Object.freeze({
  autonomyMode: "Copiloto",
  dailyBudgetLimit: 100000,
  campaignBudgetLimit: 500000,
  scaleStepPct: 15,
  requireCreativeApproval: true,
  blockOutOfStock: true,
  contactOnlyAuthorized: true,
  paused: false,
});

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
  if (number(order.total) > 0) return number(order.total);
  return (db.order_items || [])
    .filter((line) => line.orderId === order.id && !line.parentItemId)
    .reduce((sum, line) => sum + number(line.precio) * Math.max(1, number(line.cant)), 0);
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
  const item = (db.inventory_items || []).find((candidate) => candidate.id === itemId);
  if (!item) return null;
  const lots = (db.inventory_lots || []).filter((lot) => lot.itemId === itemId && number(lot.available) > 0);
  if (db.inventoryLotsReady && lots.length) {
    return lots.filter((lot) => !lot.expiresAt || lot.expiresAt >= today)
      .reduce((sum, lot) => sum + number(lot.available), 0);
  }
  return number(item.stock);
}

function productStock(db, reference, today = new Date().toISOString().slice(0, 10), visited = new Set()) {
  const product = resolveProduct(db, reference);
  if (!product || product.activo === false || visited.has(product.id)) return null;
  const nextVisited = new Set(visited); nextVisited.add(product.id);
  const exact = (db.variantes || []).filter((item) => item.productId === product.id && (!item.vence || item.vence >= today));
  if (exact.length) return exact.reduce((sum, item) => sum + number(item.disponibles), 0);
  if (product.stock !== undefined && product.stock !== null) return Math.max(0, number(product.stock));

  if (product.tipo === "combo" && product.comboSize) {
    const componentIds = product.componentProductIds || [];
    const componentStock = componentIds.reduce((sum, id) => sum + Math.max(0, productStock(db, id, today, nextVisited) || 0), 0);
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

export function agencyProductStock(db, reference, today = new Date().toISOString().slice(0, 10)) {
  return productStock(db, reference, today);
}

function platformMetrics(db) {
  const raw = db.creative_results || [];
  return raw.filter((metric) => metric.fuente !== "manual" || !raw.some((candidate) =>
    candidate.fuente && candidate.fuente !== "manual" &&
    candidate.fecha === metric.fecha && candidate.creativeId === metric.creativeId && candidate.campaignId === metric.campaignId
  ));
}

function campaignPerformance(campaign, db) {
  const orders = (db.orders || []).filter((order) => order.campaignId === campaign.id && isPaidOrder(order));
  const platform = platformMetrics(db).filter((metric) => metric.campaignId === campaign.id);
  const spend = platform.reduce((sum, metric) => sum + number(metric.gasto), 0) || number(campaign.gastoReal);
  const revenue = orders.reduce((sum, order) => sum + orderRevenue(order, db), 0);
  return {
    campaignId: campaign.id,
    orders: orders.length,
    revenue,
    spend,
    roas: spend > 0 ? revenue / spend : null,
    clicks: platform.reduce((sum, metric) => sum + number(metric.clicks), 0),
    messages: platform.reduce((sum, metric) => sum + number(metric.mensajesWhatsApp), 0),
  };
}

function creativePerformance(creative, db) {
  const orders = (db.orders || []).filter((order) => order.creativeId === creative.id && isPaidOrder(order));
  const platform = platformMetrics(db).filter((metric) => metric.creativeId === creative.id);
  const spend = platform.reduce((sum, metric) => sum + number(metric.gasto), 0);
  const revenue = orders.reduce((sum, order) => sum + orderRevenue(order, db), 0);
  return {
    creative,
    orders: orders.length,
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

function productSales(db, today, windowDays = 30) {
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
    const stock = productStock(db, action.productId, action.today);
    if (stock === null && !["Reponer stock", "Crear brief"].includes(type)) {
      reasons.push("No existe una disponibilidad verificable para el producto foco.");
    } else if (stock !== null && stock <= 0 && !["Reponer stock", "Crear brief"].includes(type)) {
      reasons.push("El producto foco no tiene stock disponible.");
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

export function buildAgencyIntelligence(db = {}, rawSettings = {}, today = new Date().toISOString().slice(0, 10)) {
  const settings = normalizeAgencySettings(rawSettings);
  const activeCampaigns = (db.campaigns || []).filter((campaign) => campaign.estado === "Activa");
  const performance = activeCampaigns.map((campaign) => ({ ...campaignPerformance(campaign, db), campaign }));
  const recommendations = [];

  performance.forEach((metric) => {
    const product = campaignProduct(metric.campaign, db);
    const stock = product ? productStock(db, product.id, today) : null;
    if (product && stock !== null && stock <= 0) {
      recommendations.push(recommendation({
        id: `stock-${metric.campaignId}`, type: "Reponer stock", pillar: "Inventario", risk: "Alto", priority: 100, confidence: "Alta",
        title: `Protegé la pauta de ${metric.campaign.nombre}`,
        rationale: "La campaña está activa, pero su producto foco no tiene disponibilidad para cumplir nuevas ventas.",
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

  const birthdays = birthdayCustomers(db, today);
  if (birthdays.length) {
    recommendations.push(recommendation({
      id: `birthdays-${today}`, type: "Activar cumpleaños", pillar: "CRM", risk: "Medio", priority: 82, confidence: "Alta",
      title: `Acompañá ${birthdays.length} cumpleaños próximo(s)`, channel: "WhatsApp", crmSegment: "Cumpleaños en los próximos 7 días",
      rationale: "Son clientes identificados, con cumpleaños cercano y permiso explícito de contacto.",
      evidence: { customers: birthdays.map(({ customer, days }) => ({ id: customer.id, days })) },
      signals: birthdays.slice(0, 3).map(({ customer, days }) => `${customer.nombre}: ${days === 0 ? "hoy" : `en ${days} día(s)`}`),
      customerIds: birthdays.map(({ customer }) => customer.id), suggestedOffer: "Detalle de cumpleaños MOMOS con vigencia corta",
      nextStep: "Crear una activación individual, revisar el beneficio y aprobar el mensaje antes de enviarlo.",
    }));
  }

  const sales = productSales(db, today, 30);
  const activeProductIds = new Set(activeCampaigns.map((campaign) => campaignProduct(campaign, db)?.id).filter(Boolean));
  const promotable = sales.find((entry) => entry.units >= 2 && !activeProductIds.has(entry.product.id) && number(productStock(db, entry.product.id, today)) > 0);
  if (promotable) {
    const stock = productStock(db, promotable.product.id, today);
    recommendations.push(recommendation({
      id: `product-momentum-${promotable.product.id}-${today}`, type: "Impulsar producto", pillar: "Producto", risk: "Medio", priority: 74, confidence: "Alta",
      title: `Convertí la demanda de ${promotable.product.nombre} en campaña`,
      rationale: "Tiene ventas recientes, disponibilidad verificable y no cuenta con una campaña activa propia.",
      evidence: { units30d: promotable.units, orders30d: promotable.orders, revenue30d: promotable.revenue, stock },
      signals: [signal("Vendidas 30 días", promotable.units), signal("Pedidos", promotable.orders), signal("Stock", stock)],
      productId: promotable.product.id, channel: "Instagram", nextStep: "Crear un brief con el aprendizaje de compra y una pieza orientada a conversión.",
    }));
  }

  const soldProductIds = new Set(sales.map((entry) => entry.product.id));
  const idleStock = (db.products || []).filter((product) => product.activo !== false && !soldProductIds.has(product.id) && !activeProductIds.has(product.id))
    .map((product) => ({ product, stock: productStock(db, product.id, today) }))
    .filter((entry) => Number.isFinite(entry.stock) && entry.stock >= 5)
    .sort((left, right) => right.stock - left.stock || left.product.id.localeCompare(right.product.id))[0];
  if (idleStock) {
    recommendations.push(recommendation({
      id: `idle-stock-${idleStock.product.id}-${today}`, type: "Mover inventario", pillar: "Producto", risk: "Medio", priority: 68, confidence: "Media",
      title: `Dale salida a ${idleStock.product.nombre}`,
      rationale: "Tiene inventario disponible, pero no registra ventas pagadas en los últimos 30 días ni una campaña activa.",
      evidence: { stock: idleStock.stock, units30d: 0, activeCampaigns: 0 }, signals: [signal("Stock", idleStock.stock), "Ventas 30 días: 0", "Campaña activa: no"],
      productId: idleStock.product.id, channel: "Instagram", nextStep: "Investigar primero precio, presentación y audiencia; no descontar sin revisar margen.",
    }));
  }

  const creativeMetrics = (db.creatives || []).map((creative) => creativePerformance(creative, db));
  const winner = creativeMetrics.filter((metric) => metric.orders >= 2 && (metric.roas === null || metric.roas >= 1.5))
    .sort((left, right) => right.orders - left.orders || number(right.roas) - number(left.roas) || left.creative.id.localeCompare(right.creative.id))[0];
  if (winner) {
    const product = creativeProduct(winner.creative, db);
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

  const todayPosts = (db.content_calendar || []).filter((post) => isoDate(post.fecha) === today && post.estado !== "No publicado");
  if (!todayPosts.length) {
    recommendations.push(recommendation({
      id: `content-${today}`, type: "Crear contenido", pillar: "Contenido", risk: "Bajo", priority: 60, confidence: "Alta",
      title: "Prepará una pieza de contenido para hoy", rationale: "No hay ninguna publicación programada para hoy.",
      evidence: { date: today, scheduledPosts: 0 }, signals: [signal("Fecha", today), "Publicaciones: 0"], channel: "Instagram",
      nextStep: "Elegir producto y objetivo, producir el archivo y aprobarlo antes de programar.",
    }));
  }

  const dormantCustomers = contactEligibleCustomers(db, today);
  if (dormantCustomers.length) {
    recommendations.push(recommendation({
      id: `reactivate-${today}`, type: "Contactar segmento", pillar: "CRM", risk: "Medio", priority: 55, confidence: "Alta",
      title: `Reactivá ${dormantCustomers.length} cliente(s) con permiso`, channel: "WhatsApp", crmSegment: "Clientes inactivos con permiso",
      rationale: "Llevan más de 30 días sin comprar y tienen un canal de contacto disponible.",
      evidence: { eligibleCustomers: dormantCustomers.length, inactivityDays: 30 }, signals: [signal("Contactables", dormantCustomers.length), "Inactividad: +30 días"],
      customerIds: dormantCustomers.map((customer) => customer.id), nextStep: "Crear una activación medible y excluir a quien cambie su preferencia de contacto.",
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
  const guarded = unique.map((item) => ({ ...item, guard: guardAgencyAction({ ...item, today, execute: true }, db, settings) }));
  const allPaidOrders = (db.orders || []).filter(isPaidOrder);
  const revenue = allPaidOrders.reduce((sum, order) => sum + orderRevenue(order, db), 0);
  const spend = platformMetrics(db).reduce((sum, metric) => sum + number(metric.gasto), 0);
  const scheduledNext7 = (db.content_calendar || []).filter((post) => {
    const distance = daysBetween(today, post.fecha);
    return distance !== null && distance >= 0 && distance <= 7 && !["No publicado", "Cancelado"].includes(post.estado);
  }).length;

  return {
    settings,
    recommendations: guarded,
    performance,
    productSales: sales,
    creativePerformance: creativeMetrics,
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
      eligibleCustomers: dormantCustomers.length + birthdays.length,
      productsWithStock: (db.products || []).filter((product) => number(productStock(db, product.id, today)) > 0).length,
      winners: winner ? 1 : 0,
      scheduledNext7,
    },
  };
}
