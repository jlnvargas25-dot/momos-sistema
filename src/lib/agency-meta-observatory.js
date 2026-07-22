const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const rate = (numerator, denominator, scale = 100) => number(denominator) > 0 ? number(numerator) / number(denominator) * scale : null;
const round = (value, digits = 2) => value == null ? null : Number(Number(value).toFixed(digits));

export const META_ENTITY_TYPES = Object.freeze(["Cuenta", "Campaña", "Conjunto", "Anuncio", "Creativo", "Pixel", "Catálogo"]);
export const META_OBJECTIVES = Object.freeze(["Ventas", "Mensajes", "Leads", "Reconocimiento"]);

export const DEFAULT_META_POLICY = Object.freeze({
  policyKey: "momos-meta-operacion-v1",
  source: "MOMOS OPS · hipótesis inicial revisable",
  market: "Cali, Colombia",
  currency: "COP",
  targets: { roas: 2.5, costPerConversation: 12000, costPerLead: 18000 },
  thresholds: { ctrMinPct: 1.5, landingRateMinPct: 60, checkoutPurchaseMinPct: 30, video3sMinPct: 20, frequencyHigh: 5, pixelDropPct: 20, pixelFloor: 50, minimumImpressions: 100 },
});

function normalizedPolicy(policy = DEFAULT_META_POLICY) {
  const targets = policy.targets || {}; const thresholds = policy.thresholds || {};
  return { ...DEFAULT_META_POLICY, ...policy, targets: {
    roas: number(targets.roas ?? DEFAULT_META_POLICY.targets.roas),
    costPerConversation: number(targets.costPerConversation ?? targets.cost_per_conversation ?? DEFAULT_META_POLICY.targets.costPerConversation),
    costPerLead: number(targets.costPerLead ?? targets.cost_per_lead ?? DEFAULT_META_POLICY.targets.costPerLead),
  }, thresholds: {
    ctrMinPct: number(thresholds.ctrMinPct ?? thresholds.ctr_min_pct ?? DEFAULT_META_POLICY.thresholds.ctrMinPct),
    landingRateMinPct: number(thresholds.landingRateMinPct ?? thresholds.landing_rate_min_pct ?? DEFAULT_META_POLICY.thresholds.landingRateMinPct),
    checkoutPurchaseMinPct: number(thresholds.checkoutPurchaseMinPct ?? thresholds.checkout_purchase_min_pct ?? DEFAULT_META_POLICY.thresholds.checkoutPurchaseMinPct),
    video3sMinPct: number(thresholds.video3sMinPct ?? thresholds.video_3s_min_pct ?? DEFAULT_META_POLICY.thresholds.video3sMinPct),
    frequencyHigh: number(thresholds.frequencyHigh ?? thresholds.frequency_high ?? DEFAULT_META_POLICY.thresholds.frequencyHigh),
    pixelDropPct: number(thresholds.pixelDropPct ?? thresholds.pixel_drop_pct ?? DEFAULT_META_POLICY.thresholds.pixelDropPct),
    pixelFloor: number(thresholds.pixelFloor ?? thresholds.pixel_floor ?? DEFAULT_META_POLICY.thresholds.pixelFloor),
    minimumImpressions: number(thresholds.minimumImpressions ?? thresholds.minimum_impressions ?? DEFAULT_META_POLICY.thresholds.minimumImpressions),
  } };
}

export function deriveMetaMetrics(metrics = {}) {
  const m = Object.fromEntries(Object.entries(metrics || {}).map(([key, value]) => [key, number(value)]));
  return {
    ...m,
    ctrPct: round(rate(m.clicks, m.impressions)),
    outboundCtrPct: round(rate(m.outboundClicks, m.impressions)),
    cpm: round(rate(m.spend, m.impressions, 1000)),
    cpc: round(rate(m.spend, m.clicks, 1)),
    roas: round(rate(m.purchaseValue, m.spend, 1)),
    costPerPurchase: round(rate(m.spend, m.purchases, 1)),
    costPerConversation: round(rate(m.spend, m.conversations, 1)),
    costPerLead: round(rate(m.spend, m.leads, 1)),
    landingRatePct: round(rate(m.landingViews, m.outboundClicks || m.clicks)),
    contentRatePct: round(rate(m.contentViews, m.landingViews)),
    cartRatePct: round(rate(m.addsToCart, m.contentViews)),
    checkoutRatePct: round(rate(m.checkouts, m.addsToCart)),
    purchaseRatePct: round(rate(m.purchases, m.checkouts)),
    video3sRatePct: round(rate(m.video3s, m.impressions)),
  };
}

export function validateMetaSnapshot(snapshot = {}) {
  const reasons = [];
  if (!/^[A-Za-z0-9:_-]{3,220}$/.test(text(snapshot.snapshotKey))) reasons.push("Falta una clave idempotente válida.");
  if (text(snapshot.accountExternalId).length < 3) reasons.push("Falta la cuenta Meta exacta.");
  if (!META_ENTITY_TYPES.includes(snapshot.entityType)) reasons.push("El tipo de entidad Meta no es válido.");
  if (!META_OBJECTIVES.includes(snapshot.objective)) reasons.push("Falta el objetivo real de la campaña.");
  if (!/^[A-Z]{3}$/.test(text(snapshot.currency))) reasons.push("La moneda debe conservar su código ISO.");
  if (text(snapshot.timezone).length < 3) reasons.push("Falta la zona horaria de la cuenta.");
  const start = Date.parse(snapshot.windowStart); const end = Date.parse(snapshot.windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) reasons.push("La ventana de medición no es válida.");
  if (!snapshot.metrics || typeof snapshot.metrics !== "object" || Array.isArray(snapshot.metrics)) reasons.push("Falta el objeto de métricas.");
  Object.entries(snapshot.metrics || {}).forEach(([key, value]) => {
    if (!Number.isFinite(Number(value)) || Number(value) < 0) reasons.push(`La métrica ${key} no puede ser negativa ni inválida.`);
  });
  list(snapshot.pixelEvents).forEach((event) => {
    if (!text(event.name) || [event.current, event.previous, event.emq].some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) reasons.push("Un evento del píxel está incompleto.");
    if (number(event.emq) > 10) reasons.push("El EMQ debe estar entre 0 y 10.");
  });
  list(snapshot.catalogProducts).forEach((product) => {
    if (!text(product.productExternalId) || !Number.isFinite(Number(product.spend)) || Number(product.spend) < 0) reasons.push("Un producto del catálogo está incompleto.");
  });
  return { ready: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function pixelHealth(events = [], policy = DEFAULT_META_POLICY) {
  const normalized = normalizedPolicy(policy);
  const threshold = number(normalized.thresholds?.pixelDropPct) || 20;
  const floor = number(normalized.thresholds?.pixelFloor) || 50;
  return list(events).map((event) => {
    const previous = number(event.previous); const current = number(event.current);
    const changePct = previous > 0 ? round((current - previous) / previous * 100) : null;
    const alert = previous >= floor && changePct != null && changePct < -threshold;
    const emq = number(event.emq);
    return { ...event, current, previous, emq, changePct, alert, lowVolume: previous < floor,
      emqStatus: emq >= 8 ? "Excelente" : emq >= 6 ? "Aceptable" : emq >= 4 ? "Bajo" : "Crítico" };
  });
}

function primaryOutcome(snapshot, derived, policy) {
  if (snapshot.objective === "Ventas") {
    const target = number(policy.targets?.roas);
    return { metric: "ROAS", value: derived.roas, target, healthy: derived.roas != null && derived.roas >= target,
      sample: number(derived.purchases), unit: "x" };
  }
  if (snapshot.objective === "Mensajes") {
    const target = number(policy.targets?.costPerConversation);
    return { metric: "Costo por conversación", value: derived.costPerConversation, target, healthy: derived.costPerConversation != null && derived.costPerConversation <= target,
      sample: number(derived.conversations), unit: snapshot.currency };
  }
  if (snapshot.objective === "Leads") {
    const target = number(policy.targets?.costPerLead);
    return { metric: "Costo por lead", value: derived.costPerLead, target, healthy: derived.costPerLead != null && derived.costPerLead <= target,
      sample: number(derived.leads), unit: snapshot.currency };
  }
  return { metric: "CPM", value: derived.cpm, target: null, healthy: null, sample: number(derived.impressions), unit: snapshot.currency };
}

export function buildMetaDiagnostic(snapshot = {}, policy = DEFAULT_META_POLICY) {
  const validation = validateMetaSnapshot(snapshot);
  if (!validation.ready) return { ready: false, reasons: validation.reasons };
  const normalized = normalizedPolicy(policy);
  const derived = deriveMetaMetrics(snapshot.metrics);
  const outcome = primaryOutcome(snapshot, derived, normalized);
  const hypotheses = [];
  const actions = [];
  const threshold = normalized.thresholds || {};
  if (derived.ctrPct != null && derived.ctrPct < number(threshold.ctrMinPct)) {
    hypotheses.push({ signal: "CTR", observation: `${derived.ctrPct}%`, interpretation: "El anuncio obtiene poca respuesta inicial para esta política.", causal: false });
    actions.push({ priority: "Alta", action: "Probar un hook o primer fotograma distinto sin cambiar oferta ni audiencia.", gate: "Experimento humano", changesExternalState: false });
  }
  if (derived.landingRatePct != null && derived.landingRatePct < number(threshold.landingRateMinPct)) {
    hypotheses.push({ signal: "Clic → destino", observation: `${derived.landingRatePct}%`, interpretation: "Existe pérdida entre el clic y la carga o llegada medida.", causal: false });
    actions.push({ priority: "Alta", action: "Auditar velocidad, URL, etiquetado y experiencia de destino antes de culpar al creativo.", gate: "Revisión técnica", changesExternalState: false });
  }
  if (derived.purchaseRatePct != null && derived.purchaseRatePct < number(threshold.checkoutPurchaseMinPct)) {
    hypotheses.push({ signal: "Checkout → compra", observation: `${derived.purchaseRatePct}%`, interpretation: "La fricción aparece al final del embudo o la medición está incompleta.", causal: false });
    actions.push({ priority: "Alta", action: "Contrastar checkout, pagos y pedidos pagados de MOMOS con la atribución de Meta.", gate: "Conciliación", changesExternalState: false });
  }
  if (derived.frequency >= number(threshold.frequencyHigh)) {
    hypotheses.push({ signal: "Frecuencia", observation: `${round(derived.frequency)} exposiciones`, interpretation: "Puede existir fatiga; la frecuencia por sí sola no demuestra saturación.", causal: false });
  }
  const pixels = pixelHealth(snapshot.pixelEvents, normalized);
  pixels.filter((item) => item.alert).forEach((item) => actions.push({ priority: "Crítica", action: `Revisar la caída del evento ${item.name} (${item.changePct}%) y su implementación.`, gate: "Medición", changesExternalState: false }));
  const catalog = list(snapshot.catalogProducts).map((product) => {
    const truth = product.momosTruth || {};
    const eligible = number(truth.availableStock) > 0 && !truth.expired && number(product.spend) >= 0;
    return { ...product, hypothesisOnly: true, eligible, reason: !eligible ? "Sin stock vigente suficiente o producto vencido." : "Candidato a prueba; gasto no equivale a venta." };
  });
  const localTruth = snapshot.localTruth || {};
  const metaRevenue = number(derived.purchaseValue); const momosRevenue = number(localTruth.paidRevenue);
  const attributionGap = metaRevenue > 0 || momosRevenue > 0 ? round(metaRevenue - momosRevenue) : 0;
  const minimum = number(threshold.minimumImpressions) || 100;
  const confidence = number(derived.impressions) < minimum || outcome.sample < 1 ? "Inicial" : Math.abs(attributionGap) > Math.max(1, momosRevenue * .2) ? "Media" : "Alta";
  if (!actions.length) actions.push({ priority: "Media", action: "Mantener observación y reunir otra ventana comparable antes de cambiar la pauta.", gate: "Muestra", changesExternalState: false });
  return {
    ready: true, snapshot, policy: normalized, derived, outcome, confidence,
    whatHappened: { objective: snapshot.objective, spend: derived.spend, impressions: derived.impressions, outcome, metaAttributedRevenue: metaRevenue, momosPaidRevenue: momosRevenue, attributionGap },
    whyHypotheses: hypotheses,
    recommendedActions: actions,
    pixelHealth: pixels,
    catalogHypotheses: catalog,
    guards: { readOnly: true, attributionIsNotCausality: true, approvalRequired: true, publicationForbidden: true, spendChangeForbidden: true },
  };
}

export function metaSnapshotPayload(input = {}) {
  const snapshot = { snapshotKey: text(input.snapshotKey), accountExternalId: text(input.accountExternalId), accountLabel: text(input.accountLabel),
    entityType: input.entityType, entityExternalId: text(input.entityExternalId), objective: input.objective, currency: text(input.currency).toUpperCase(),
    timezone: text(input.timezone), windowStart: input.windowStart, windowEnd: input.windowEnd, sourceCapturedAt: input.sourceCapturedAt,
    localCampaignId: text(input.localCampaignId), localCreativeId: text(input.localCreativeId), localPostId: text(input.localPostId),
    publicationFingerprint: text(input.publicationFingerprint), metrics: input.metrics || {}, pixelEvents: list(input.pixelEvents), catalogProducts: list(input.catalogProducts),
    connectorName: text(input.connectorName) };
  const validation = validateMetaSnapshot(snapshot);
  if (!validation.ready) throw new Error(validation.reasons[0]);
  return { snapshot_key: snapshot.snapshotKey, account_external_id: snapshot.accountExternalId, account_label: snapshot.accountLabel,
    entity_type: snapshot.entityType, entity_external_id: snapshot.entityExternalId, objective: snapshot.objective, currency: snapshot.currency,
    timezone: snapshot.timezone, window_start: snapshot.windowStart, window_end: snapshot.windowEnd, source_captured_at: snapshot.sourceCapturedAt,
    local_campaign_id: snapshot.localCampaignId || null, local_creative_id: snapshot.localCreativeId || null, local_post_id: snapshot.localPostId || null,
    publication_fingerprint: snapshot.publicationFingerprint, metrics: snapshot.metrics, pixel_events: snapshot.pixelEvents.map((event) => ({ name: text(event.name), current: number(event.current), previous: number(event.previous), emq: number(event.emq) })),
    catalog_products: snapshot.catalogProducts.map((product) => ({ product_external_id: text(product.productExternalId), local_product_id: text(product.localProductId) || null, name: text(product.name), spend: number(product.spend) })),
    connector_name: snapshot.connectorName };
}

export function buildAgencyMetaCenter(db = {}, policy = DEFAULT_META_POLICY) {
  const snapshots = list(db.agencyMetaSnapshots).map((snapshot) => ({ ...snapshot,
    preview: buildMetaDiagnostic({ snapshotKey: snapshot.snapshotKey, accountExternalId: snapshot.accountExternalId, entityType: snapshot.entityType,
      entityExternalId: snapshot.entityExternalId, objective: snapshot.objective, currency: snapshot.currency, timezone: snapshot.timezone,
      windowStart: snapshot.windowStart, windowEnd: snapshot.windowEnd, metrics: snapshot.metrics, pixelEvents: snapshot.pixelEvents,
      catalogProducts: snapshot.catalogProducts, localTruth: snapshot.localTruth }, policy),
    diagnostics: list(db.agencyMetaDiagnostics).filter((item) => String(item.snapshotId) === String(snapshot.id)),
  }));
  return { snapshots, diagnostics: list(db.agencyMetaDiagnostics), policies: list(db.agencyMetaPolicies),
    summary: { snapshots: snapshots.length, reviewing: list(db.agencyMetaDiagnostics).filter((item) => item.status === "En revisión").length,
      alerts: snapshots.reduce((sum, item) => sum + list(item.preview?.pixelHealth).filter((event) => event.alert).length, 0),
      linkedRevenue: snapshots.reduce((sum, item) => sum + number(item.localTruth?.paidRevenue), 0) } };
}
