const FORBIDDEN_KEY = /(?:customer|client|phone|email|address|storage_path|signed_url|api[_-]?key|access[_-]?token|service[_-]?role|authorization)/i;
const SAFE_DECLARATIONS = new Set(["contains_customer_pii", "contains_staff_identity", "contains_storage_paths"]);

const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} debe ser un objeto.`);
  return value;
};

function assertSafeKeys(value, path = "preflight") {
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

function finite(value, label) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) throw new Error(`${label} no es válido.`);
  return normalized;
}

function normalizePlan(raw) {
  const plan = object(raw, "Cada plan de producción");
  const preflight = object(plan.preflight, "El contrato sellado");
  if (!Number.isInteger(Number(plan.id)) || Number(plan.id) <= 0
      || !/^[0-9a-f]{64}$/.test(String(plan.formula_fingerprint || ""))
      || !/^[0-9a-f]{32}$/.test(String(plan.pack_fingerprint || ""))
      || !/^[0-9a-f]{64}$/.test(String(plan.preflight_fingerprint || ""))
      || preflight.schema_version !== "momos-formula-production-preflight/v1") {
    throw new Error("Un plan perdió su identidad, huella o contrato.");
  }
  const guards = object(preflight.guards, "Las guardas del plan");
  if (guards.human_approval_required !== true || guards.credits_consumed !== false
      || guards.job_created !== false || guards.external_execution_allowed !== false
      || guards.publication_allowed !== false) {
    throw new Error("Un plan intentó ampliar permisos o declarar ejecución.");
  }
  return {
    id: Number(plan.id), planKey: String(plan.plan_key || ""), formulaId: Number(plan.formula_id),
    productionPackId: Number(plan.production_pack_id), version: Number(plan.version),
    status: String(plan.status || ""), provider: String(plan.provider || ""), operation: String(plan.operation || ""),
    modelLabel: String(plan.model_label || ""), channel: String(plan.channel || ""),
    targetFormat: String(plan.target_format || ""), durationSeconds: finite(plan.duration_seconds, "Duración"),
    outputCount: finite(plan.output_count, "Cantidad de salidas"),
    estimatedCostCop: finite(plan.estimated_cost_cop, "Costo estimado"),
    maxCostCop: finite(plan.max_cost_cop, "Tope de costo"), formulaFingerprint: plan.formula_fingerprint,
    packFingerprint: plan.pack_fingerprint, fingerprint: plan.preflight_fingerprint,
    preflight, sourceKind: String(plan.source_kind || ""), preparedAt: String(plan.prepared_at || ""),
    reviewedAt: String(plan.reviewed_at || ""),
  };
}

export function normalizeProductionPreflight(value) {
  const envelope = object(value, "La memoria de preflight");
  const fingerprint = String(envelope.fingerprint || "");
  const snapshot = object(envelope.snapshot, "El snapshot de preflight");
  if (!/^[0-9a-f]{64}$/.test(fingerprint)
      || snapshot.schema_version !== "momos-production-preflight/v1"
      || snapshot.human_approval_required !== true
      || snapshot.credits_consumed !== false || snapshot.jobs_created !== false
      || snapshot.external_execution_allowed !== false || snapshot.publication_allowed !== false) {
    throw new Error("El preflight perdió huella, aprobación humana o guardas de ejecución.");
  }
  const privacy = object(snapshot.privacy, "La privacidad del preflight");
  if (privacy.contains_customer_pii !== false || privacy.contains_staff_identity !== false
      || privacy.contains_storage_paths !== false || privacy.contains_secrets !== false
      || privacy.contains_order_ids !== false) throw new Error("El preflight declaró información privada.");
  assertSafeKeys(snapshot);
  const plans = Array.isArray(snapshot.plans) ? snapshot.plans.map(normalizePlan) : [];
  const summary = object(snapshot.summary, "El resumen del preflight");
  if (Number(summary.plans) !== plans.length) throw new Error("El resumen del preflight no coincide con sus planes.");
  return { fingerprint, schemaVersion: snapshot.schema_version, generatedAt: String(snapshot.generated_at || ""),
    plans, summary, privacy, humanApprovalRequired: true, creditsConsumed: false, jobsCreated: false,
    externalExecutionAllowed: false, publicationAllowed: false };
}
