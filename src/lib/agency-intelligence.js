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

function campaignPerformance(campaign, db) {
  const orders = (db.orders || []).filter((order) =>
    order.campaignId === campaign.id && order.estado !== "Cancelado" &&
    (order.pagadoEn || PAID_STATES.has(order.estado))
  );
  const platform = (db.creative_results || []).filter((metric) => metric.campaignId === campaign.id);
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

function productStock(db, productId) {
  if (!productId) return null;
  const exact = (db.variantes || []).filter((item) => item.productId === productId);
  if (exact.length) return exact.reduce((sum, item) => sum + number(item.disponibles), 0);
  const product = (db.products || []).find((item) => item.id === productId);
  if (!product) return null;
  return product.stock === undefined || product.stock === null ? null : number(product.stock);
}

function contactEligibleCustomers(db, today) {
  const profiles = new Map((db.customer_crm_profiles || []).map((profile) => [profile.customerId, profile]));
  const cutoff = new Date(`${today}T12:00:00`);
  cutoff.setDate(cutoff.getDate() - 30);
  return (db.customers || []).filter((customer) => {
    const profile = profiles.get(customer.id);
    if (profile?.contactAllowed !== true) return false;
    if (!customer.telefono && !customer.instagram) return false;
    const last = isoDate(customer.ultima);
    return last && new Date(`${last}T12:00:00`) < cutoff;
  });
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
    const stock = productStock(db, action.productId);
    if (stock !== null && stock <= 0 && !["Reponer stock", "Crear brief"].includes(type)) {
      reasons.push("El producto foco no tiene stock disponible.");
    }
  }
  if (settings.requireCreativeApproval && action.creativeId && ["Activar campaña", "Publicar contenido"].includes(type)) {
    const creative = (db.creatives || []).find((item) => item.id === action.creativeId);
    if (!creative || !["Aprobado", "Publicado", "Ganador"].includes(creative.estado)) {
      reasons.push("El creativo todavía no tiene aprobación humana.");
    }
  }
  const proposedBudget = number(action.proposedBudget);
  if (proposedBudget > settings.campaignBudgetLimit) {
    reasons.push(`El presupuesto propuesto supera el límite por campaña de ${settings.campaignBudgetLimit}.`);
  }
  if (number(action.dailySpend) + number(action.incrementalDailySpend) > settings.dailyBudgetLimit) {
    reasons.push(`La acción supera el límite diario de ${settings.dailyBudgetLimit}.`);
  }
  if (settings.contactOnlyAuthorized && action.customerIds?.length) {
    const profiles = new Map((db.customer_crm_profiles || []).map((profile) => [profile.customerId, profile]));
    const forbidden = action.customerIds.filter((id) => profiles.get(id)?.contactAllowed !== true);
    if (forbidden.length) reasons.push(`${forbidden.length} cliente(s) no tienen autorización explícita de contacto.`);
  }
  if (settings.autonomyMode === "Asesor" && action.execute) {
    reasons.push("El modo Asesor solo permite proponer acciones.");
  } else if (settings.autonomyMode === "Copiloto" && action.execute) {
    warnings.push("Esta acción requiere aprobación humana antes de ejecutarse.");
  }
  return { allowed: reasons.length === 0, reasons, warnings, settings };
}

export function buildAgencyIntelligence(db = {}, rawSettings = {}, today = new Date().toISOString().slice(0, 10)) {
  const settings = normalizeAgencySettings(rawSettings);
  const activeCampaigns = (db.campaigns || []).filter((campaign) => campaign.estado === "Activa");
  const performance = activeCampaigns.map((campaign) => ({ ...campaignPerformance(campaign, db), campaign }));
  const recommendations = [];

  performance.forEach((metric) => {
    const stock = productStock(db, metric.campaign.productoFocoId);
    if (stock !== null && stock <= 0) {
      recommendations.push({
        id: `stock-${metric.campaignId}`, type: "Reponer stock", risk: "Alto", priority: 100,
        title: `Protegé la pauta de ${metric.campaign.nombre}`,
        rationale: "La campaña está activa, pero su producto foco no tiene stock.",
        evidence: { stock, campaignId: metric.campaignId, spend: metric.spend },
        campaignId: metric.campaignId, productId: metric.campaign.productoFocoId,
      });
    } else if (metric.spend >= 25000 && metric.orders === 0) {
      recommendations.push({
        id: `pause-${metric.campaignId}`, type: "Pausar campaña", risk: "Alto", priority: 90,
        title: `Revisá ${metric.campaign.nombre} antes de gastar más`,
        rationale: "Ya consumió presupuesto y todavía no tiene pedidos atribuidos.",
        evidence: { spend: metric.spend, clicks: metric.clicks, orders: 0 }, campaignId: metric.campaignId,
      });
    } else if (metric.roas !== null && metric.roas >= 2 && metric.orders >= 2) {
      const proposedBudget = Math.round(number(metric.campaign.presupuesto) * (1 + settings.scaleStepPct / 100));
      recommendations.push({
        id: `scale-${metric.campaignId}`, type: "Escalar presupuesto", risk: "Medio", priority: 75,
        title: `Escalá con cuidado ${metric.campaign.nombre}`,
        rationale: `La campaña devuelve ${metric.roas.toFixed(1)}× y tiene ventas comprobadas.`,
        evidence: { roas: metric.roas, orders: metric.orders, revenue: metric.revenue, spend: metric.spend },
        campaignId: metric.campaignId, productId: metric.campaign.productoFocoId, proposedBudget,
      });
    }
  });

  const todayPosts = (db.content_calendar || []).filter((post) => isoDate(post.fecha) === today && post.estado !== "No publicado");
  if (!todayPosts.length) {
    recommendations.push({
      id: `content-${today}`, type: "Crear contenido", risk: "Bajo", priority: 60,
      title: "Prepará una pieza de contenido para hoy",
      rationale: "No hay ninguna publicación programada para hoy.",
      evidence: { date: today, scheduledPosts: 0 },
    });
  }

  const dormantCustomers = contactEligibleCustomers(db, today);
  if (dormantCustomers.length) {
    recommendations.push({
      id: `reactivate-${today}`, type: "Contactar segmento", risk: "Medio", priority: 55,
      title: `Reactivá ${dormantCustomers.length} cliente(s) con permiso`,
      rationale: "Llevan más de 30 días sin comprar y tienen un canal de contacto disponible.",
      evidence: { eligibleCustomers: dormantCustomers.length, inactivityDays: 30 },
      customerIds: dormantCustomers.map((customer) => customer.id),
    });
  }

  const pendingCreatives = (db.creatives || []).filter((creative) => creative.estado === "En revisión");
  if (pendingCreatives.length) {
    recommendations.push({
      id: `review-${today}`, type: "Revisar creativo", risk: "Bajo", priority: 50,
      title: `Revisá ${pendingCreatives.length} creativo(s) antes de publicar`,
      rationale: "La aprobación humana protege la marca y evita publicaciones accidentales.",
      evidence: { pendingCreatives: pendingCreatives.length }, creativeId: pendingCreatives[0].id,
    });
  }

  recommendations.sort((a, b) => b.priority - a.priority);
  const guarded = recommendations.map((recommendation) => ({
    ...recommendation,
    guard: guardAgencyAction({ ...recommendation, execute: true }, db, settings),
  }));
  const allPaidOrders = (db.orders || []).filter((order) => order.pagadoEn || PAID_STATES.has(order.estado));
  const revenue = allPaidOrders.reduce((sum, order) => sum + orderRevenue(order, db), 0);
  const spend = (db.creative_results || []).reduce((sum, metric) => sum + number(metric.gasto), 0);

  return {
    settings,
    recommendations: guarded,
    performance,
    summary: {
      revenue, spend, blendedRoas: spend > 0 ? revenue / spend : null,
      opportunities: guarded.length,
      blocked: guarded.filter((item) => !item.guard.allowed).length,
      activeCampaigns: activeCampaigns.length,
      pendingCreatives: pendingCreatives.length,
      eligibleCustomers: dormantCustomers.length,
    },
  };
}
