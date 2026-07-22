import { canonicalUsableIngredientStock } from "./canonical-stock.js";
import { businessDateISO } from "./business-date.js";
import { isCommercialFamilyProduct, isKitchenFigureName } from "./momos-domain-language.js";

const PAID_STATES = new Set([
  "Pagado", "En producción", "Listo para empaque", "Empacado",
  "Listo para despacho", "En ruta", "Entregado", "Reclamo",
]);
const ACTIVE_BATCH_STATES = new Set(["En preparación", "Congelando"]);
const number = (value) => Math.max(0, Number(value) || 0);
const text = (value) => String(value || "").trim();
const normalized = (value) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const round4 = (value) => Math.round((Number(value) || 0) * 10000) / 10000;
const isoDay = (value) => text(value).slice(0, 10);

function daysBetween(from, to) {
  const left = isoDay(from); const right = isoDay(to);
  if (!left || !right) return null;
  const result = Math.round((new Date(`${right}T12:00:00`) - new Date(`${left}T12:00:00`)) / 86400000);
  return Number.isFinite(result) ? result : null;
}

function isPaidOrder(order) {
  return order?.estado !== "Cancelado" && Boolean(order?.pagadoEn || PAID_STATES.has(order?.estado));
}

function exactKey(productId, figure, flavor, filling) {
  return [productId, normalized(figure), normalized(flavor), normalized(filling)].join("|");
}

function exactStockKey(productId, figure, flavor) {
  return [productId, normalized(figure), normalized(flavor)].join("|");
}

function runKey(flavor, filling) {
  return `${normalized(flavor)}|${normalized(filling)}`;
}

function resolveProduct(db, reference) {
  return (db.products || []).find((product) => product.id === reference || product.nombre === reference) || null;
}

function usablePreparedStock(db, itemId, today) {
  return canonicalUsableIngredientStock(db, itemId, { today }).usable;
}

function lineDemandRows(db, today, historyDays) {
  const orders = new Map((db.orders || []).filter((order) => {
    if (!isPaidOrder(order)) return false;
    const age = daysBetween(order.fecha || order.pagadoEn, today);
    return age !== null && age >= 0 && age < historyDays;
  }).map((order) => [order.id, order]));

  const products = new Map((db.products || []).map((product) => [product.id, product]));
  const itemsByOrder = new Map();
  (db.order_items || []).forEach((line) => {
    if (!itemsByOrder.has(line.orderId)) itemsByOrder.set(line.orderId, []);
    itemsByOrder.get(line.orderId).push(line);
  });

  const rows = [];
  orders.forEach((order) => {
    const lines = itemsByOrder.get(order.id) || [];
    const parentIds = new Set(lines.map((line) => line.parentItemId).filter(Boolean));
    lines.forEach((line) => {
      const product = products.get(line.productId);
      if (!product || product.activo === false || !isCommercialFamilyProduct(product)) return;
      if (!line.figura || !line.sabor) return;
      // Una caja tiene una línea padre y líneas hijas exactas; contar ambas duplicaría la demanda.
      if (!line.parentItemId && parentIds.has(line.id)) return;
      rows.push({
        order, line, product, quantity: Math.max(1, number(line.cant)),
        attributed: Boolean(order.campaignId || order.creativeId),
      });
    });
  });
  return rows;
}

function suggestionRows(db) {
  const orderItems = new Map((db.order_items || []).map((line) => [line.id, line]));
  const figures = new Map((db.figuras || [])
    .filter((figure) => figure?.activo !== false && isKitchenFigureName(figure?.nombre))
    .map((figure) => [normalized(figure.nombre), figure]));
  return (db.production_suggestions || [])
    .filter((suggestion) => suggestion.estado === "Pendiente" && suggestion.area !== "Inventario")
    .map((suggestion) => {
      const line = orderItems.get(suggestion.orderItemId);
      const figure = line?.figura ? figures.get(normalized(line.figura)) : null;
      return {
        suggestion, line, figure,
        quantity: number(suggestion.cantidad),
        productId: suggestion.productId || line?.productId || figure?.productId || "",
        flavor: text(line?.sabor), filling: text(line?.relleno), figureName: text(line?.figura),
      };
    });
}

function inProcessByVariant(db) {
  const result = new Map();
  (db.production_batches || []).filter((batch) => ACTIVE_BATCH_STATES.has(batch.estado)).forEach((batch) => {
    const productId = batch.productId || resolveProduct(db, batch.producto)?.id || "";
    const figures = Array.isArray(batch.figuras) && batch.figuras.length
      ? batch.figuras
      : (batch.figura ? [{ figura: batch.figura, cant: batch.prod }] : []);
    figures.forEach((entry) => {
      if (!isKitchenFigureName(entry?.figura)) return;
      const key = exactKey(productId, entry.figura, batch.sabor, batch.relleno);
      result.set(key, (result.get(key) || 0) + number(entry.cant));
    });
  });
  return result;
}

function availableByVariant(db, today) {
  const result = new Map();
  (db.variantes || []).forEach((variant) => {
    if (!isKitchenFigureName(variant?.figura) || (variant.vence && isoDay(variant.vence) < today)) return;
    const key = exactStockKey(variant.productId, variant.figura, variant.sabor);
    result.set(key, (result.get(key) || 0) + number(variant.disponibles));
  });
  return result;
}

function campaignEvidence(db, demandRows) {
  const campaigns = new Map((db.campaigns || []).map((campaign) => [campaign.id, campaign]));
  const creatives = new Map((db.creatives || []).map((creative) => [creative.id, creative]));
  const spendByCampaign = new Map();
  const spendByCreative = new Map();
  (db.creative_results || []).forEach((metric) => {
    if (metric.campaignId) spendByCampaign.set(metric.campaignId, (spendByCampaign.get(metric.campaignId) || 0) + number(metric.gasto));
    if (metric.creativeId) spendByCreative.set(metric.creativeId, (spendByCreative.get(metric.creativeId) || 0) + number(metric.gasto));
  });
  const revenueByCampaign = new Map();
  const revenueByCreative = new Map();
  demandRows.forEach(({ order, line, quantity }) => {
    const revenue = number(line.precio) * quantity;
    if (order.campaignId) revenueByCampaign.set(order.campaignId, (revenueByCampaign.get(order.campaignId) || 0) + revenue);
    if (order.creativeId) revenueByCreative.set(order.creativeId, (revenueByCreative.get(order.creativeId) || 0) + revenue);
  });
  return { campaigns, creatives, spendByCampaign, spendByCreative, revenueByCampaign, revenueByCreative };
}

function adSignalsForRows(rows, evidence) {
  const names = new Set();
  let strong = false;
  rows.filter((row) => row.attributed).forEach(({ order }) => {
    if (order.campaignId) {
      const campaign = evidence.campaigns.get(order.campaignId);
      const spend = evidence.spendByCampaign.get(order.campaignId) || 0;
      const revenue = evidence.revenueByCampaign.get(order.campaignId) || 0;
      const roas = spend > 0 ? revenue / spend : null;
      if (campaign?.nombre) names.add(campaign.nombre);
      if (campaign?.estado === "Activa" && roas !== null && roas >= 2) strong = true;
    }
    if (order.creativeId) {
      const creative = evidence.creatives.get(order.creativeId);
      const spend = evidence.spendByCreative.get(order.creativeId) || 0;
      const revenue = evidence.revenueByCreative.get(order.creativeId) || 0;
      const roas = spend > 0 ? revenue / spend : null;
      if (creative?.titulo) names.add(creative.titulo);
      if (roas !== null && roas >= 2) strong = true;
    }
  });
  return { names: [...names], strong };
}

function addVariant(group, variant) {
  group.variants.push(variant);
  group.totalUnits += variant.recommended;
  group.queueUnits += variant.queue;
  group.historicalUnits += variant.historical;
  group.attributedUnits += variant.attributed;
  group.availableUnits += variant.available;
  group.inProcessUnits += variant.inProcess;
  variant.suggestionIds.forEach((id) => group.suggestionIds.add(id));
  variant.orderIds.forEach((id) => group.orderIds.add(id));
  variant.adSignals.forEach((name) => group.adSignals.add(name));
}

function finalizeGroups(groups) {
  return [...groups.values()].map((group) => ({
    ...group,
    suggestionIds: [...group.suggestionIds], orderIds: [...group.orderIds], adSignals: [...group.adSignals],
    source: group.queueUnits > 0 && group.historicalUnits > 0 ? "Cola + demanda" : group.queueUnits > 0 ? "Cola pagada" : "Demanda proyectada",
    confidence: group.historicalUnits >= 6 ? "Alta" : group.historicalUnits >= 3 ? "Media" : "Inicial",
    canCreate: group.variants.every((variant) => variant.figure && variant.flavor && variant.productId),
  })).sort((a, b) => b.queueUnits - a.queueUnits || b.totalUnits - a.totalUnits || a.flavor.localeCompare(b.flavor));
}

function unitToGrams(value, unit) {
  if (["kg", "L"].includes(unit)) return number(value) * 1000;
  return number(value);
}

function buildPreparationNeeds(db, plans, today) {
  const needs = new Map();
  const subrecipes = db.subrecetas || [];
  const subrecipeById = new Map(subrecipes.map((subrecipe) => [subrecipe.id, subrecipe]));
  const items = new Map((db.inventory_items || []).map((item) => [item.id, item]));
  const fillingRules = (db.figura_relleno || []).filter((rule) => rule.activo !== false);
  const fillingGrams = fillingRules.reduce((sum, rule) => sum + number(rule.gramosPorUnidad), 0);

  function add(subrecipe, grams, reason) {
    if (!subrecipe?.itemId || grams <= 0) return;
    const item = items.get(subrecipe.itemId);
    if (!item) return;
    const unitFactor = ["kg", "L"].includes(item.unidad) ? 1000 : 1;
    const required = grams / unitFactor;
    const current = usablePreparedStock(db, item.id, today);
    const currentNeed = needs.get(subrecipe.id) || { subrecipe, item, required: 0, current, reasons: new Set() };
    currentNeed.required += required;
    currentNeed.reasons.add(reason);
    needs.set(subrecipe.id, currentNeed);
  }

  plans.forEach((plan) => {
    const mousse = subrecipes.find((subrecipe) => subrecipe.activo !== false
      && ["mousse_frutal", "mousse_cremosa"].includes(subrecipe.tipo)
      && normalized(subrecipe.sabor) === normalized(plan.flavor));
    let mousseGrams = 0;
    plan.variants.forEach((variant) => {
      const gramaje = number(variant.gramajeG);
      mousseGrams += Math.max(0, gramaje - fillingGrams) * variant.recommended;
    });
    if (mousse) add(mousse, mousseGrams, `${plan.totalUnits} unidades de ${plan.flavor}`);
    fillingRules.forEach((rule) => {
      const subrecipe = subrecipeById.get(rule.subrecetaId);
      if (subrecipe?.activo !== false) add(subrecipe, number(rule.gramosPorUnidad) * plan.totalUnits, `${plan.totalUnits} figuras con relleno`);
    });
  });

  return [...needs.values()].map((need) => {
    need.required = round4(need.required);
    const minimum = number(need.item.min);
    const projected = round4(need.current - need.required);
    const amountToPrepare = Math.max(0, minimum - projected);
    const recommendedGrams = amountToPrepare > 0 ? Math.ceil(unitToGrams(amountToPrepare, need.item.unidad) / 50) * 50 : 0;
    return {
      subrecipeId: need.subrecipe.id,
      subrecipeName: need.subrecipe.nombre,
      itemId: need.item.id,
      itemName: need.item.nombre,
      unit: need.item.unidad,
      current: round4(need.current), required: need.required, projected, minimum,
      shortage: round4(Math.max(0, need.required - need.current)),
      recommendedGrams,
      reasons: [...need.reasons],
      severity: need.current < need.required ? "Crítica" : projected < minimum ? "Preparar pronto" : "Cubierta",
    };
  }).filter((need) => need.recommendedGrams > 0)
    .sort((a, b) => (a.severity === "Crítica" ? -1 : 1) - (b.severity === "Crítica" ? -1 : 1) || b.recommendedGrams - a.recommendedGrams);
}

export function productionRunDraft(plan, figures = [], defaultFilling = "") {
  const canonicalFigures = (figures || []).filter((figure) => figure.activo !== false && isKitchenFigureName(figure?.nombre));
  const availableNames = new Set(canonicalFigures.map((figure) => figure.nombre));
  const quantities = Object.fromEntries(canonicalFigures.map((figure) => [figure.nombre, 0]));
  (plan?.variants || []).forEach((variant) => {
    if (availableNames.has(variant.figure)) quantities[variant.figure] = (quantities[variant.figure] || 0) + variant.recommended;
  });
  return { sabor: plan?.flavor || "", relleno: plan?.filling || defaultFilling || "", figuras: quantities };
}

export function buildKitchenProductionPlan(db = {}, options = {}) {
  const today = options.today || businessDateISO();
  const horizonDays = Math.max(1, number(options.horizonDays || 3));
  const historyDays = Math.max(7, number(options.historyDays || 28));
  const suggestions = suggestionRows(db);
  const demandRows = lineDemandRows(db, today, historyDays);
  const evidence = campaignEvidence(db, demandRows);
  const inProcess = inProcessByVariant(db);
  const available = availableByVariant(db, today);
  const figures = new Map((db.figuras || [])
    .filter((figure) => figure?.activo !== false && isKitchenFigureName(figure?.nombre))
    .map((figure) => [normalized(figure.nombre), figure]));

  const variants = new Map();
  const integrityIssues = [];
  function ensureVariant({ productId, figure, flavor, filling, sourceId = "" }) {
    if (!isKitchenFigureName(figure)) {
      integrityIssues.push({
        code: "NON_CANONICAL_FIGURE", sourceId, productId, figure, flavor, canCreate: false,
      });
      return null;
    }
    const figureConfig = figures.get(normalized(figure));
    if (!figureConfig) {
      integrityIssues.push({
        code: "FIGURE_NOT_CONFIGURED", sourceId, productId, figure, flavor, canCreate: false,
      });
      return null;
    }
    const canonicalProductId = figureConfig?.productId || "";
    if (productId && canonicalProductId && productId !== canonicalProductId) {
      integrityIssues.push({
        code: "ORDER_VARIANT_PRODUCT_MISMATCH",
        sourceId,
        productId,
        canonicalProductId,
        figure,
        flavor,
        canCreate: false,
      });
      return null;
    }
    const resolvedProductId = productId || canonicalProductId;
    if (!resolvedProductId) return null;
    const key = exactKey(resolvedProductId, figure, flavor, filling);
    if (!variants.has(key)) variants.set(key, {
      key, productId: resolvedProductId, figure, flavor, filling,
      gramajeG: number(figureConfig?.gramajeG),
      queue: 0, historical: 0, attributed: 0, salesRows: [], suggestionIds: [], orderIds: new Set(),
    });
    return variants.get(key);
  }

  suggestions.forEach((row) => {
    if (!row.productId || !row.figureName || !row.flavor) return;
    const variant = ensureVariant({ productId: row.productId, figure: row.figureName, flavor: row.flavor, filling: row.filling, sourceId: row.suggestion.id });
    if (!variant) return;
    variant.queue += row.quantity;
    variant.suggestionIds.push(row.suggestion.id);
    if (row.suggestion.orderId) variant.orderIds.add(row.suggestion.orderId);
  });
  demandRows.forEach((row) => {
    const variant = ensureVariant({ productId: row.product.id, figure: row.line.figura, flavor: row.line.sabor, filling: row.line.relleno, sourceId: row.line.id });
    if (!variant) return;
    variant.historical += row.quantity;
    if (row.attributed) variant.attributed += row.quantity;
    variant.salesRows.push(row);
  });

  const groups = new Map();
  variants.forEach((variant) => {
    const oldest = variant.salesRows.map((row) => isoDay(row.order.fecha || row.order.pagadoEn)).sort()[0];
    const span = oldest ? Math.min(historyDays, Math.max(1, (daysBetween(oldest, today) ?? 0) + 1)) : historyDays;
    const denominator = Math.max(7, span);
    const forecast = Math.ceil((variant.historical / denominator) * horizonDays);
    const ad = adSignalsForRows(variant.salesRows, evidence);
    const adBuffer = ad.strong && variant.attributed > 0 && forecast > 0 ? Math.min(2, Math.max(1, Math.ceil(forecast * 0.15))) : 0;
    const stock = available.get(exactStockKey(variant.productId, variant.figure, variant.flavor)) || 0;
    const underway = inProcess.get(variant.key) || 0;
    const coverageNeed = Math.max(0, forecast + adBuffer - stock - underway);
    const recommended = Math.ceil(Math.max(variant.queue, coverageNeed));
    if (recommended <= 0) return;
    const key = runKey(variant.flavor, variant.filling);
    if (!groups.has(key)) groups.set(key, {
      id: `PLAN-${normalized(variant.flavor).replace(/[^a-z0-9]+/g, "-") || "sin-sabor"}-${normalized(variant.filling).replace(/[^a-z0-9]+/g, "-") || "sin-relleno"}`,
      flavor: variant.flavor, filling: variant.filling, variants: [], totalUnits: 0,
      queueUnits: 0, historicalUnits: 0, attributedUnits: 0, availableUnits: 0, inProcessUnits: 0,
      suggestionIds: new Set(), orderIds: new Set(), adSignals: new Set(), horizonDays, historyDays,
    });
    addVariant(groups.get(key), {
      ...variant, forecast, adBuffer, available: stock, inProcess: underway, recommended,
      orderIds: [...variant.orderIds], adSignals: ad.names,
    });
  });

  const plans = finalizeGroups(groups);
  const preparationNeeds = buildPreparationNeeds(db, plans, today);
  return {
    plans,
    preparationNeeds,
    integrityIssues,
    summary: {
      runs: plans.length,
      units: plans.reduce((sum, plan) => sum + plan.totalUnits, 0),
      queueUnits: plans.reduce((sum, plan) => sum + plan.queueUnits, 0),
      forecastUnits: plans.reduce((sum, plan) => sum + Math.max(0, plan.totalUnits - plan.queueUnits), 0),
      preparations: preparationNeeds.length,
    },
    policy: `Pronóstico de ${horizonDays} días según la vida útil configurada del producto terminado. La pauta solo agrega colchón cuando existen pedidos pagados atribuidos y ROAS respaldado.`,
  };
}
