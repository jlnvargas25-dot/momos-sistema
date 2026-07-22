import { normalizeAgencyOperationalFacts } from "./agency-operational-facts.js";
import { businessDateISO } from "./business-date.js";
import { calculateOrderAttributionRevenue } from "./order-money.js";

const PAID_STATES = new Set([
  "Pagado", "En producción", "Listo para empaque", "Empacado",
  "Listo para despacho", "En ruta", "Entregado", "Reclamo",
]);

export const DEFAULT_LEARNING_THRESHOLDS = Object.freeze({
  observationDays: 1,
  minimumImpressions: 500,
  meaningfulSpend: 25000,
  minimumMessages: 10,
  winnerOrders: 2,
  winnerRoas: 2,
});

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const clean = (value) => String(value || "").trim();
const iso = (value) => /^\d{4}-\d{2}-\d{2}/.test(clean(value)) ? clean(value).slice(0, 10) : "";

function daysBetween(from, to) {
  const start = iso(from); const end = iso(to);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((Date.parse(`${end}T12:00:00`) - Date.parse(`${start}T12:00:00`)) / 86400000));
}

function isPaid(order) {
  return order?.estado !== "Cancelado" && Boolean(order?.pagadoEn || PAID_STATES.has(order?.estado));
}

function readyOperationalFacts(db) {
  if (db?.agencyOperationalFactsReady !== true) return null;
  return normalizeAgencyOperationalFacts(db.agencyOperationalFacts);
}

function orderRevenue(order, db) {
  return calculateOrderAttributionRevenue(db, order);
}

function publishedPosts(db) {
  const runs = new Map((db.content_distributions || []).map((run) => [run.postId, run]));
  return (db.content_calendar || []).filter((post) => post.estado === "Publicado" || runs.get(post.id)?.status === "Publicada")
    .map((post) => ({ post, run: runs.get(post.id) || null }));
}

function canonicalMetrics(db) {
  const rows = db.creative_results || [];
  return rows.filter((metric) => metric.fuente !== "manual" || !rows.some((candidate) =>
    candidate.fuente && candidate.fuente !== "manual"
    && candidate.fecha === metric.fecha
    && candidate.creativeId === metric.creativeId
    && candidate.campaignId === metric.campaignId
    && clean(candidate.postId) === clean(metric.postId)
  ));
}

function postMetrics(post, db, posts) {
  const sameCreativeDay = posts.filter((candidate) => candidate.post.creativeId === post.creativeId && candidate.post.fecha === post.fecha);
  return canonicalMetrics(db).filter((metric) => {
    if (metric.postId) return metric.postId === post.id;
    return sameCreativeDay.length === 1 && metric.creativeId === post.creativeId && metric.fecha === post.fecha;
  });
}

function legacyAttributedOrders(post, db, posts) {
  const sameCreativeDay = posts.filter((candidate) => candidate.post.creativeId === post.creativeId && candidate.post.fecha === post.fecha);
  const paid = (db.orders || []).filter(isPaid);
  const exact = paid.filter((order) => order.postId && order.postId === post.id);
  const inferred = sameCreativeDay.length === 1
    ? paid.filter((order) => !order.postId && order.creativeId === post.creativeId && order.fecha === post.fecha)
    : [];
  const ambiguous = sameCreativeDay.length > 1
    ? paid.filter((order) => !order.postId && order.creativeId === post.creativeId && order.fecha === post.fecha).length
    : 0;
  const orders = [...exact, ...inferred];
  return {
    orders: orders.length,
    revenue: orders.reduce((sum, order) => sum + orderRevenue(order, db), 0),
    ambiguous,
    source: "h66-fallback",
  };
}

function operationalAttributedOrders(post, facts) {
  const row = (facts?.publishedPostAttribution || []).find((candidate) => candidate.postId === post.id);
  return {
    orders: number(row?.orders),
    revenue: number(row?.revenue),
    ambiguous: number(row?.ambiguousOrders),
    source: "agency-operational-facts-v1",
  };
}

function learningStage(metrics, thresholds, ageDays) {
  if (!metrics.hasMetrics) return {
    key: "missing", label: "Faltan métricas", conclusive: false, actionable: false,
    insight: "La publicación salió, pero todavía no tiene una lectura de plataforma.",
    nextStep: "Registrar impresiones, alcance, clicks, mensajes y gasto para poder aprender.",
  };
  if (metrics.ambiguousOrders > 0) return {
    key: "ambiguous", label: "Atribución por resolver", conclusive: false, actionable: false,
    insight: "Hay pedidos del mismo creativo y día, pero más de una publicación podría haberlos originado.",
    nextStep: "Relacionar el pedido o la métrica con el ID exacto de la publicación antes de tomar una decisión.",
  };
  if (ageDays < thresholds.observationDays && metrics.impressions < thresholds.minimumImpressions && metrics.orders === 0) return {
    key: "collecting", label: "Acumulando señal", conclusive: false, actionable: false,
    insight: "La muestra todavía es pequeña; decidir ahora podría confundir ruido con aprendizaje.",
    nextStep: `Esperar al menos ${thresholds.observationDays} día(s) o ${thresholds.minimumImpressions} impresiones antes de cambiar la pieza.`,
  };
  if (metrics.orders >= thresholds.winnerOrders && (metrics.spend === 0 || metrics.roas >= thresholds.winnerRoas)) return {
    key: "winner", label: "Aprendizaje ganador", conclusive: true, actionable: true,
    insight: "La pieza convirtió en pedidos pagados y sostuvo un retorno saludable.",
    nextStep: "Versionar el hook y la estructura; no duplicar la pieza exacta ni escalar sin revisar stock.",
  };
  if (metrics.messages >= thresholds.minimumMessages && metrics.orders === 0) return {
    key: "funnel", label: "Fuga en conversión", conclusive: true, actionable: true,
    insight: "La pieza genera conversaciones, pero esas conversaciones no terminan en pedidos pagados.",
    nextStep: "Revisar oferta, precio, claridad del CTA y respuesta por WhatsApp antes de invertir más.",
  };
  if (metrics.spend >= thresholds.meaningfulSpend && metrics.orders === 0) return {
    key: "spend", label: "Pauta para revisar", conclusive: true, actionable: true,
    insight: "Ya hubo gasto significativo sin pedidos pagados atribuibles.",
    nextStep: "Proponer pausa y revisar segmentación, creativo y promesa con aprobación humana.",
  };
  if (metrics.orders > 0 && (metrics.spend === 0 || metrics.roas >= 1)) return {
    key: "promising", label: "Señal prometedora", conclusive: false, actionable: false,
    insight: "La publicación ya produjo una venta, pero aún no alcanza la muestra mínima para declararla ganadora.",
    nextStep: "Mantener observación y evitar cambios simultáneos que impidan saber qué funcionó.",
  };
  return {
    key: "inconclusive", label: "Sin señal suficiente", conclusive: false, actionable: false,
    insight: "Los datos actuales no justifican repetir, pausar ni escalar todavía.",
    nextStep: "Seguir midiendo y comprobar que la atribución de pedidos esté completa.",
  };
}

function actionFor(stage, item) {
  if (!stage.actionable) return null;
  const common = {
    id: `learning-${item.post.id}-${stage.key}`,
    pillar: stage.key === "winner" ? "Contenido" : "Pauta",
    confidence: item.attribution.ambiguous ? "Media" : "Alta",
    priority: stage.key === "spend" ? 90 : stage.key === "funnel" ? 82 : 72,
    risk: stage.key === "winner" ? "Bajo" : stage.key === "spend" ? "Alto" : "Medio",
    title: `${stage.label}: ${item.creative?.titulo || item.post.titulo}`,
    rationale: stage.insight,
    evidence: {
      postId: item.post.id, creativeId: item.post.creativeId, impressions: item.metrics.impressions,
      messages: item.metrics.messages, orders: item.metrics.orders, revenue: item.metrics.revenue,
      spend: item.metrics.spend, roas: item.metrics.roas, ambiguousOrders: item.attribution.ambiguous,
    },
    signals: [
      `Pedidos: ${item.metrics.orders}`,
      `Ventas: ${Math.round(item.metrics.revenue)}`,
      `Gasto: ${Math.round(item.metrics.spend)}`,
      `ROAS: ${item.metrics.roas == null ? "orgánico" : `${item.metrics.roas.toFixed(1)}×`}`,
    ],
    creativeId: item.post.creativeId || null,
    campaignId: item.post.campaignId || null,
    channel: item.post.canal || "Instagram",
    nextStep: stage.nextStep,
  };
  if (stage.key === "winner") return { ...common, type: "Repetir creativo", productId: item.creative?.productoFocoId || null };
  if (stage.key === "funnel") return { ...common, type: "Revisar oferta", productId: item.creative?.productoFocoId || null };
  return { ...common, type: "Pausar campaña" };
}

export function buildCommercialLearning(db = {}, today = businessDateISO(), rawThresholds = {}) {
  const thresholds = { ...DEFAULT_LEARNING_THRESHOLDS, ...rawThresholds };
  const operationalFacts = readyOperationalFacts(db);
  const posts = publishedPosts(db);
  const items = posts.map(({ post, run }) => {
    const metricRows = postMetrics(post, db, posts);
    const attribution = operationalFacts
      ? operationalAttributedOrders(post, operationalFacts)
      : legacyAttributedOrders(post, db, posts);
    const revenue = attribution.revenue;
    const metrics = {
      hasMetrics: metricRows.length > 0,
      impressions: metricRows.reduce((sum, metric) => sum + number(metric.impresiones), 0),
      reach: metricRows.reduce((sum, metric) => sum + number(metric.alcance), 0),
      clicks: metricRows.reduce((sum, metric) => sum + number(metric.clicks), 0),
      messages: metricRows.reduce((sum, metric) => sum + number(metric.mensajesWhatsApp), 0),
      spend: metricRows.reduce((sum, metric) => sum + number(metric.gasto), 0),
      orders: attribution.orders,
      revenue,
      ambiguousOrders: attribution.ambiguous,
    };
    metrics.ctr = metrics.impressions > 0 ? metrics.clicks / metrics.impressions : null;
    metrics.conversion = metrics.messages > 0 ? metrics.orders / metrics.messages : null;
    metrics.cac = metrics.orders > 0 && metrics.spend > 0 ? metrics.spend / metrics.orders : null;
    metrics.roas = metrics.spend > 0 ? metrics.revenue / metrics.spend : null;
    const ageDays = daysBetween(run?.publishedAt || post.fecha, today);
    const creative = (db.creatives || []).find((candidate) => candidate.id === post.creativeId) || null;
    const campaign = (db.campaigns || []).find((candidate) => candidate.id === post.campaignId) || null;
    const stage = learningStage(metrics, thresholds, ageDays);
    const item = { post, run, creative, campaign, metricRows, metrics, attribution, ageDays, stage };
    item.recommendation = actionFor(stage, item);
    return item;
  }).sort((left, right) => Number(right.stage.actionable) - Number(left.stage.actionable)
    || Number(right.stage.conclusive) - Number(left.stage.conclusive)
    || `${right.post.fecha}${right.post.hora}`.localeCompare(`${left.post.fecha}${left.post.hora}`));

  return {
    source: operationalFacts ? "agency-operational-facts-v1" : "h66-fallback",
    thresholds,
    items,
    recommendations: items.map((item) => item.recommendation).filter(Boolean),
    summary: {
      published: items.length,
      missingMetrics: items.filter((item) => !item.metrics.hasMetrics).length,
      collecting: items.filter((item) => item.stage.key === "collecting").length,
      conclusive: items.filter((item) => item.stage.conclusive).length,
      winners: items.filter((item) => item.stage.key === "winner").length,
      actionable: items.filter((item) => item.stage.actionable).length,
      ambiguousAttribution: items.filter((item) => item.attribution.ambiguous > 0).length,
      paidOrders30d: operationalFacts ? operationalFacts.paidSummary.orders30d : null,
      paidRevenue30d: operationalFacts ? operationalFacts.paidSummary.revenue30d : null,
    },
  };
}
