const FORBIDDEN_KEY = /(?:customer|client|phone|email|address|storage_path|signed_url|api[_-]?key|access[_-]?token|service[_-]?role)/i;
const SAFE_DECLARATIONS = new Set([
  "contains_customer_pii", "contains_staff_identity", "contains_storage_paths",
]);
const PROVIDERS = new Set(["Higgsfield", "Kling"]);

const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} debe ser un objeto.`);
  return value;
};

function assertSafeKeys(value, path = "authorizations") {
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

function normalizeAuthorization(raw) {
  const row = object(raw, "Cada autorización de generación");
  if (!Number.isInteger(Number(row.id)) || Number(row.id) <= 0
      || !Number.isInteger(Number(row.plan_id)) || Number(row.plan_id) <= 0
      || !Number.isInteger(Number(row.job_id)) || Number(row.job_id) <= 0
      || !PROVIDERS.has(String(row.provider || ""))
      || !/^[0-9a-f]{64}$/.test(String(row.plan_fingerprint || ""))
      || !/^[0-9a-f]{32}$/.test(String(row.job_fingerprint || ""))
      || !/^[0-9a-f]{64}$/.test(String(row.authorization_fingerprint || ""))) {
    throw new Error("Una autorización perdió su identidad, proveedor o huella.");
  }
  if (row.status !== "Autorizado" || row.publication_allowed !== false) {
    throw new Error("Una autorización intentó ampliar su estado o permiso de publicación.");
  }
  return {
    id: Number(row.id), authorizationKey: String(row.authorization_key || ""),
    planId: Number(row.plan_id), jobId: Number(row.job_id), provider: row.provider,
    status: row.status, jobStatus: String(row.job_status || ""), operation: String(row.operation || ""),
    targetChannel: String(row.target_channel || ""), targetFormat: String(row.target_format || ""),
    maxCostCop: finite(row.max_cost_cop, "Tope de costo"), planFingerprint: row.plan_fingerprint,
    jobFingerprint: row.job_fingerprint, fingerprint: row.authorization_fingerprint,
    authorizedAt: String(row.authorized_at || ""), workerMayClaim: row.worker_may_claim === true,
    publicationAllowed: false,
  };
}

export function normalizeGenerationAuthorizations(value) {
  const envelope = object(value, "La memoria de autorizaciones");
  const fingerprint = String(envelope.fingerprint || "");
  const snapshot = object(envelope.snapshot, "El snapshot de autorizaciones");
  if (!/^[0-9a-f]{64}$/.test(fingerprint)
      || snapshot.schema_version !== "momos-generation-authorizations/v1"
      || snapshot.human_authorization_required !== true
      || snapshot.credits_consumed_by_authorization !== false
      || snapshot.external_generation_authorized !== true
      || snapshot.publication_allowed !== false) {
    throw new Error("Las autorizaciones perdieron su huella o separación entre generación y publicación.");
  }
  const privacy = object(snapshot.privacy, "La privacidad de autorizaciones");
  if (privacy.contains_customer_pii !== false || privacy.contains_staff_identity !== false
      || privacy.contains_storage_paths !== false || privacy.contains_secrets !== false
      || privacy.contains_order_ids !== false) throw new Error("Las autorizaciones declararon información privada.");
  assertSafeKeys(snapshot);
  const authorizations = Array.isArray(snapshot.authorizations)
    ? snapshot.authorizations.map(normalizeAuthorization) : [];
  const summary = object(snapshot.summary, "El resumen de autorizaciones");
  if (Number(summary.authorizations) !== authorizations.length) {
    throw new Error("El resumen de autorizaciones no coincide con sus filas.");
  }
  return {
    fingerprint, schemaVersion: snapshot.schema_version, generatedAt: String(snapshot.generated_at || ""),
    authorizations, summary, privacy, humanAuthorizationRequired: true,
    creditsConsumedByAuthorization: false, externalGenerationAuthorized: true,
    publicationAllowed: false,
  };
}
