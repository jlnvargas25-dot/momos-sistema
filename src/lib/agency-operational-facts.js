const clean = (value) => String(value ?? "").trim();
const rows = (value) => (Array.isArray(value) ? value : null);
const own = (source, key) => Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
const pick = (source, ...keys) => {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
};

const FACT_COLLECTIONS = Object.freeze([
  "product_catalog", "product_sales_30d", "campaign_attribution",
  "creative_attribution", "published_post_attribution", "critical_preparations",
]);
const STOCK_SOURCES = new Set([
  "exact-variants", "legacy-product", "recipe-capacity", "combo-capacity", "unverified",
]);

const asFiniteNonNegative = (value) => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
    value = trimmed;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const asIntegerNonNegative = (value) => {
  const parsed = asFiniteNonNegative(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
};

function requiredNumber(source, ...keys) {
  return asFiniteNonNegative(pick(source, ...keys));
}

function requiredInteger(source, ...keys) {
  return asIntegerNonNegative(pick(source, ...keys));
}

function normalizeContractMetadata(input) {
  const limitsSource = pick(input, "limits");
  const countsSource = pick(input, "counts");
  const truncatedSource = pick(input, "truncated");
  if (!limitsSource || typeof limitsSource !== "object" || Array.isArray(limitsSource)
      || !countsSource || typeof countsSource !== "object" || Array.isArray(countsSource)
      || !truncatedSource || typeof truncatedSource !== "object" || Array.isArray(truncatedSource)) return null;
  const expectedKeys = [...FACT_COLLECTIONS].sort();
  const hasExactKeys = (source) => {
    const keys = Object.keys(source).sort();
    return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
  };
  if (!hasExactKeys(limitsSource) || !hasExactKeys(countsSource) || !hasExactKeys(truncatedSource)) return null;

  const limits = {};
  const counts = {};
  const truncated = {};
  for (const key of FACT_COLLECTIONS) {
    const limit = asIntegerNonNegative(limitsSource[key]);
    const count = asIntegerNonNegative(countsSource[key]);
    const wasTruncated = truncatedSource[key];
    if (limit === null || limit <= 0 || count === null || typeof wasTruncated !== "boolean") return null;
    if (wasTruncated !== (count > limit) || wasTruncated) return null;
    limits[key] = limit;
    counts[key] = count;
    truncated[key] = false;
  }
  return { limits, counts, truncated };
}

function productRow(row = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const productId = clean(pick(row, "productId", "product_id", "id"));
  const name = clean(pick(row, "name", "nombre"));
  const active = pick(row, "active", "activo");
  const stockSource = clean(pick(row, "stockSource", "stock_source"));
  const category = clean(pick(row, "category", "categoria"));
  const type = clean(pick(row, "type", "tipo"));
  const species = clean(pick(row, "species", "especie"));
  const price = requiredNumber(row, "price", "precio");
  const queueUnits = requiredNumber(row, "queueUnits", "queue_units");
  const inProcessUnits = requiredNumber(row, "inProcessUnits", "in_process_units");
  const productionBuffer = requiredNumber(row, "productionBuffer", "production_buffer");
  if (!productId || !name || typeof active !== "boolean" || !STOCK_SOURCES.has(stockSource)
      || price === null || queueUnits === null || inProcessUnits === null || productionBuffer === null) return null;

  const rawStock = pick(row, "availableStock", "available_stock", "stock");
  if (stockSource === "unverified") {
    if (rawStock !== undefined && rawStock !== null) return null;
    return {
      productId, name, category, type, species, price, active, queueUnits, inProcessUnits, productionBuffer,
      availableStock: null, stockSource, stockVerified: false,
    };
  }
  const availableStock = asFiniteNonNegative(rawStock);
  if (availableStock === null) return null;
  return {
    productId, name, category, type, species, price, active, queueUnits, inProcessUnits, productionBuffer,
    availableStock, stockSource, stockVerified: true,
  };
}

function salesRow(row = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const productId = clean(pick(row, "productId", "product_id"));
  const units = requiredNumber(row, "units");
  const orders = requiredInteger(row, "orders");
  const revenue = requiredNumber(row, "revenue");
  if (!productId || units === null || orders === null || revenue === null) return null;
  return { productId, units, orders, revenue };
}

function attributionRow(row = {}, key) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const id = clean(pick(row, key, key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)));
  const orders = requiredInteger(row, "orders");
  const revenue = requiredNumber(row, "revenue");
  if (!id || orders === null || revenue === null) return null;
  return { [key]: id, orders, revenue };
}

function postAttributionRow(row = {}) {
  const base = attributionRow(row, "postId");
  const ambiguousOrders = requiredInteger(row, "ambiguousOrders", "ambiguous_orders");
  return base && ambiguousOrders !== null ? { ...base, ambiguousOrders } : null;
}

function preparationRow(row = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const name = clean(pick(row, "name", "subrecipeName", "subrecipe_name"));
  const rawFlavor = pick(row, "flavor", "sabor");
  const flavor = clean(rawFlavor);
  const recommendedAmount = requiredNumber(row, "recommendedAmount", "recommended_amount");
  const unit = clean(pick(row, "unit", "unidad"));
  const severity = clean(pick(row, "severity", "severidad"));
  if (!name || rawFlavor === undefined || rawFlavor === null
      || recommendedAmount === null || !unit || !severity) return null;
  return { name, flavor, recommendedAmount, unit, severity };
}

function mapStrict(source, mapper) {
  const list = rows(source);
  if (!list) return null;
  const result = list.map(mapper);
  return result.some((row) => row === null) ? null : result;
}

function calendarCount(value) {
  if (Array.isArray(value)) {
    let total = 0;
    for (const day of value) {
      const count = requiredInteger(day, "posts", "count");
      if (count === null) return null;
      total += count;
    }
    return total;
  }
  if (value && typeof value === "object") return requiredInteger(value, "posts", "count");
  return asIntegerNonNegative(value);
}

function normalizePaidSummary(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const paid = {
    orders30d: requiredInteger(source, "orders30d", "orders_30d"),
    revenue30d: requiredNumber(source, "revenue30d", "revenue_30d"),
    ordersAll: requiredInteger(source, "ordersAll", "orders_all"),
    revenueAll: requiredNumber(source, "revenueAll", "revenue_all"),
    attributedOrders30d: requiredInteger(source, "attributedOrders30d", "attributed_orders_30d"),
  };
  return Object.values(paid).some((value) => value === null) ? null : paid;
}

export function normalizeAgencyOperationalFacts(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const contractVersion = Number(pick(input, "contractVersion", "contract_version"));
  if (contractVersion !== 1 || pick(input, "factsReady", "facts_ready") !== true) return null;
  const generatedAt = clean(pick(input, "generatedAt", "generated_at", "asOf", "as_of"));
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(generatedAt)) return null;

  const metadata = normalizeContractMetadata(input);
  if (!metadata) return null;
  const productCatalog = mapStrict(pick(input, "productCatalog", "product_catalog"), productRow);
  const productSales30d = mapStrict(pick(input, "productSales30d", "product_sales_30d"), salesRow);
  const campaignAttribution = mapStrict(pick(input, "campaignAttribution", "campaign_attribution"), (row) => attributionRow(row, "campaignId"));
  const creativeAttribution = mapStrict(pick(input, "creativeAttribution", "creative_attribution"), (row) => attributionRow(row, "creativeId"));
  const publishedPostAttribution = mapStrict(pick(input, "publishedPostAttribution", "published_post_attribution"), postAttributionRow);
  if (!productCatalog || !productSales30d || !campaignAttribution || !creativeAttribution || !publishedPostAttribution) return null;
  if (productCatalog.length !== metadata.counts.product_catalog
      || productSales30d.length !== metadata.counts.product_sales_30d
      || campaignAttribution.length !== metadata.counts.campaign_attribution
      || creativeAttribution.length !== metadata.counts.creative_attribution
      || publishedPostAttribution.length !== metadata.counts.published_post_attribution) return null;

  const productIds = new Set(productCatalog.map((product) => product.productId));
  if (productIds.size !== productCatalog.length || productSales30d.some((row) => !productIds.has(row.productId))) return null;
  const paidSummary = normalizePaidSummary(pick(input, "paidSummary", "paid_summary"));
  const crm = pick(input, "crmSegments", "crm_segments");
  const calendar = pick(input, "calendar");
  const production = pick(input, "production");
  if (!paidSummary || !crm || typeof crm !== "object" || Array.isArray(crm)
      || !calendar || typeof calendar !== "object" || Array.isArray(calendar)
      || !production || typeof production !== "object" || Array.isArray(production)) return null;
  if (pick(crm, "containsCustomerIds", "contains_customer_ids") !== false) return null;

  const crmSegments = {
    birthdays7d: requiredInteger(crm, "birthdays7d", "birthdays_7d"),
    dormant30d: requiredInteger(crm, "dormant30d", "dormant_30d"),
  };
  const normalizedCalendar = {
    today: calendarCount(calendar.today),
    next7d: calendarCount(pick(calendar, "next7d", "next_7d")),
  };
  const criticalPreparations = mapStrict(pick(production, "criticalPreparations", "critical_preparations"), preparationRow);
  const normalizedProduction = {
    planUnits: requiredNumber(production, "planUnits", "plan_units"),
    planRuns: requiredInteger(production, "planRuns", "plan_runs"),
    queueUnits: requiredNumber(production, "queueUnits", "queue_units"),
    activeBatchUnits: requiredNumber(production, "activeBatchUnits", "active_batch_units"),
    criticalPreparations,
  };
  if (Object.values(crmSegments).some((value) => value === null)
      || Object.values(normalizedCalendar).some((value) => value === null)
      || !criticalPreparations
      || Object.values(normalizedProduction).some((value) => value === null)) return null;
  if (criticalPreparations.length !== metadata.counts.critical_preparations) return null;

  return {
    factsReady: true,
    contractVersion,
    generatedAt,
    limits: metadata.limits,
    counts: metadata.counts,
    truncated: metadata.truncated,
    productCatalog,
    productSales30d,
    paidSummary,
    campaignAttribution,
    creativeAttribution,
    publishedPostAttribution,
    crmSegments: { ...crmSegments, containsCustomerIds: false },
    calendar: normalizedCalendar,
    production: normalizedProduction,
  };
}

// Frontera operacional de la UI de Agencia. Esta lista no autoriza que textos
// o registros H66 se envÃ­en a MCP: ese canal conserva su propia proyecciÃ³n y
// sus gates. AquÃ­ solo impedimos que la vista reciba operaciÃ³n cruda.
const AGENCY_SAFE_DB_KEYS = Object.freeze([
  "agencyActionOutcomes", "agencyActionOutcomesReady", "agencyActionQueue", "agencyActionQueueReady",
  "agencyAgentProposals", "agencyAgentRuns",
  "agencyBrandIdentity", "agencyBrandProfile", "agencyBriefs", "agencyCollaborationEntries",
  "agencyCollaborationReady", "agencyCollaborationRooms", "agencyCreativeContracts", "agencyCreativeFlowReady",
  "agencyCreativeVersions", "agencyDecisions", "agencyGrowthReady", "agencyIntegrations", "agencyLoopLearningReady",
  "agencyMetaAuthorizationReady", "agencyMetaConnectorReady", "agencyMetaIncrementalityReady",
  "agencyMetaInvestmentReady", "agencyMetaInvestmentScenarios", "agencyMetaPolicies", "agencyMetaReady",
  "agencyMetaSnapshots", "agencyMetaDiagnostics", "agencyMetaLiftStudies", "agencyMetaLiftMeasurements",
  "agencyMetaInvestmentAuthorizations", "agencyMetaInvestmentExecutionJobs", "agencyMetaConnectorDryRuns",
  "agencyMotionReady", "agencyMotionPlans", "agencyMotionRecipes", "agencyMotionObservations", "agencyOrchestratorReady",
  "agencyPostproductionAudioReady", "agencyPostproductionAudioBindings", "agencyPostproductionExportReady",
  "agencyPostproductionExports", "agencyPostproductionPackages", "agencyPostproductionWorkers", "agencyQualityReady",
  "agencyRetentionDiagnostics", "agencyRetentionExperiments", "agencyRetentionHooks", "agencyRetentionLearnings",
  "agencyRetentionLoops", "agencyRetentionMeasurements", "agencyRetentionReady", "agencyRetentionScripts",
  "agencySceneQualityReviews", "agencySceneRouterReady", "agencySceneRoutingPlans", "agencySceneStudioReady",
  "agencyServerReady", "agencySettings", "agencySnapshotReady", "agencySnapshotVersion", "agencyStoryboards",
  "agencyStoryboardShots", "agencyBrandGovernanceReady", "agencyBrandGateBindings", "agencyGrowthPolicies",
  "agencyGrowthSnapshots", "agencyGrowthSelections", "agencyMasterReleases", "agencyMasterReleaseEvents",
  "brand_library", "brandMediaAssets", "brandMediaReady", "brandMediaUsages", "brandProductionReady",
  "brandProductionPacks", "brandProductionPackAssets", "campaigns", "content_calendar", "content_distributions",
  "creativeGenerationJobs", "creativeIterationReady", "creativeProductionReady", "creative_results", "creativeReviewReady",
  "creatives", "distributionConnectorJobs", "distributionConnectorReady", "distributionServerReady",
  "higgsfieldConnectorReady", "klingConnectorReady", "mcpHumanApprovalReady", "mcpHumanApprovals", "mundoAnimadoReady",
  "officialLogoDeletionReady", "agencyIntegrationsReady", "creativeConnectorRuns", "marketing_ideas",
  "marketing_guiones", "marketing_mensajes", "marketing_tasks",
]);

function projectSafeAgencyDomain(db) {
  const projected = {};
  for (const key of AGENCY_SAFE_DB_KEYS) if (own(db, key)) projected[key] = db[key];
  return projected;
}

function projectH66Products(value) {
  if (!Array.isArray(value)) return [];
  return value.map((product) => {
    if (!product || typeof product !== "object" || Array.isArray(product)) return null;
    const id = clean(pick(product, "id", "productId", "product_id"));
    const nombre = clean(pick(product, "nombre", "name"));
    if (!id || !nombre) return null;
    return { id, nombre, activo: pick(product, "activo", "active") !== false };
  }).filter(Boolean);
}

export function projectAgencyDbWithOperationalFacts(db = {}) {
  const facts = normalizeAgencyOperationalFacts(db.agencyOperationalFacts);
  const projected = projectSafeAgencyDomain(db);
  if (!facts) {
    // H66 queda disponible en modo degradado con etiquetas mÃ­nimas. Nunca se
    // entrega el db global: sin facts no hay stock ni capacidad verificables.
    projected.products = projectH66Products(db.products);
    projected.agencyOperationalFacts = null;
    projected.agencyOperationalFactsReady = false;
    projected.agencyOperationalFactsInvalid = db.agencyOperationalFactsReady === true;
    return projected;
  }
  projected.products = facts.productCatalog.map((product) => ({
    id: product.productId,
    nombre: product.name,
    activo: product.active,
    stock: product.availableStock,
    agencyAvailableStock: product.availableStock,
    stockSource: product.stockSource,
    stockVerified: product.stockVerified,
    categoria: product.category,
    tipo: product.type,
    especie: product.species,
    precio: product.price,
    colchonProduccion: product.productionBuffer,
    unidadesEnCola: product.queueUnits,
    unidadesEnProceso: product.inProcessUnits,
  }));
  projected.agencyOperationalFacts = facts;
  projected.agencyOperationalFactsReady = true;
  return projected;
}

export function agencyOperationalFactsReady(value) {
  return Boolean(normalizeAgencyOperationalFacts(value));
}
