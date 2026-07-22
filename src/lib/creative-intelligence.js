const FORBIDDEN_KEY = /(?:customer|client|phone|email|address|(?:^|_)order_id(?:$|_)|storage_path|signed_url|api[_-]?key|access[_-]?token|service[_-]?role|authorization)/i;
const SAFE_DECLARATIONS = new Set(["contains_customer_pii", "contains_order_ids"]);

const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} debe ser un objeto.`);
  }
  return value;
};

const number = (value, label, { nullable = false } = {}) => {
  if (nullable && value == null) return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new Error(`${label} no es numérico.`);
  return normalized;
};

function assertSafeKeys(value, path = "snapshot") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (FORBIDDEN_KEY.test(key) && !SAFE_DECLARATIONS.has(key)) throw new Error(`${path}.${key} expone un campo privado.`);
    assertSafeKeys(item, `${path}.${key}`);
  });
}

function normalizeFormula(row) {
  object(row, "Cada fórmula");
  if (!Number.isInteger(Number(row.id)) || Number(row.id) <= 0) throw new Error("Una fórmula no tiene ID válido.");
  if (!/^[0-9a-f]{64}$/.test(String(row.formula_fingerprint || ""))) throw new Error("Una fórmula perdió su huella.");
  return {
    id: Number(row.id), formulaKey: String(row.formula_key || ""), version: Number(row.version),
    name: String(row.name || ""), mode: String(row.mode || ""), status: String(row.status || ""),
    sourceCreativeId: String(row.source_creative_id || ""),
    sourceCreativeVersionId: row.source_creative_version_id == null ? null : Number(row.source_creative_version_id),
    retentionScriptId: row.retention_script_id == null ? null : Number(row.retention_script_id),
    campaignId: String(row.campaign_id || ""), productId: String(row.product_id || ""),
    channel: String(row.channel || ""), objective: String(row.objective || ""),
    figure: String(row.figure || ""), flavor: String(row.flavor || ""),
    formula: object(row.formula_snapshot, "La estructura de fórmula"),
    fingerprint: row.formula_fingerprint, sourceKind: String(row.source_kind || ""),
    preparedAt: String(row.prepared_at || ""), reviewedAt: String(row.reviewed_at || ""),
  };
}

function normalizeMeasurement(row) {
  object(row, "Cada medición");
  if (!Number.isInteger(Number(row.id)) || Number(row.id) <= 0) throw new Error("Una medición no tiene ID válido.");
  if (!/^[0-9a-f]{64}$/.test(String(row.evidence_fingerprint || ""))) throw new Error("Una medición perdió su huella.");
  return {
    id: Number(row.id), measurementKey: String(row.measurement_key || ""), formulaId: Number(row.formula_id),
    platform: String(row.platform || ""), windowStart: String(row.window_start || ""), windowEnd: String(row.window_end || ""),
    impressions: number(row.impressions, "Impresiones"), reach: number(row.reach, "Alcance"),
    clicks: number(row.clicks, "Clicks"), messages: number(row.messages, "Mensajes"),
    spend: number(row.spend, "Gasto"),
    platformAttributedRevenue: number(row.platform_attributed_revenue, "Ingreso atribuido de plataforma", { nullable: true }),
    internalPaidOrders: number(row.internal_paid_orders, "Pedidos pagados"),
    internalRevenue: number(row.internal_revenue, "Ingreso interno"), internalMargin: number(row.internal_margin, "Margen interno"),
    internalRoas: number(row.internal_roas, "ROAS interno", { nullable: true }),
    contributionReturn: number(row.contribution_return, "Retorno sobre margen", { nullable: true }),
    platformRoas: number(row.platform_roas, "ROAS de plataforma", { nullable: true }),
    attributionGap: number(row.attribution_gap, "Brecha de atribución", { nullable: true }),
    unattributedCampaignOrders: number(row.unattributed_campaign_orders, "Pedidos de campaña sin creativo"),
    attributionStatus: String(row.attribution_status || ""), fingerprint: row.evidence_fingerprint,
    outcome: String(row.outcome || ""), sourceKind: String(row.source_kind || ""),
    recordedAt: String(row.recorded_at || ""), decidedAt: String(row.decided_at || ""),
  };
}

export function normalizeCreativeIntelligence(value) {
  const envelope = object(value, "La memoria creativa");
  const fingerprint = String(envelope.fingerprint || "");
  const snapshot = object(envelope.snapshot, "El snapshot creativo");
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("La memoria creativa no tiene una huella válida.");
  if (snapshot.schema_version !== "momos-creative-intelligence/v1") throw new Error("La versión de memoria creativa no es compatible.");
  if (snapshot.external_execution_allowed !== false) throw new Error("La memoria creativa intentó ampliar permisos externos.");
  if (snapshot.human_approval_required !== true) throw new Error("La memoria creativa perdió la aprobación humana.");
  const privacy = object(snapshot.privacy, "La declaración de privacidad");
  if (privacy.contains_customer_pii !== false || privacy.contains_staff_identity !== false
    || privacy.contains_secrets !== false || privacy.contains_order_ids !== false) {
    throw new Error("La memoria creativa declaró contenido privado.");
  }
  assertSafeKeys(snapshot);
  const definitions = object(snapshot.metric_definitions, "Las definiciones de retorno");
  if (definitions.attribution_is_causality !== false) throw new Error("La memoria confundió atribución con causalidad.");
  const formulas = Array.isArray(snapshot.formulas) ? snapshot.formulas.map(normalizeFormula) : [];
  const measurements = Array.isArray(snapshot.measurements) ? snapshot.measurements.map(normalizeMeasurement) : [];
  return {
    fingerprint, schemaVersion: snapshot.schema_version, generatedAt: String(snapshot.generated_at || ""),
    formulas, measurements, summary: object(snapshot.summary, "El resumen creativo"),
    metricDefinitions: definitions, privacy,
    humanApprovalRequired: true, externalExecutionAllowed: false,
  };
}
