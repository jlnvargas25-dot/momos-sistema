const FORBIDDEN_KEY = /(?:customer|client|phone|email|address|storage_path|signed_url|api[_-]?key|access[_-]?token|service[_-]?role)/i;
const SAFE_DECLARATIONS = new Set(["contains_customer_pii", "contains_staff_identity", "contains_storage_paths"]);
const PROVIDERS = new Set(["Higgsfield", "Kling"]);
const STATUSES = new Set([
  "Armado", "Arrendado", "Despachando", "En proveedor", "Incierto", "Generado",
  "Fallido", "Aprobado", "Cambios solicitados", "Descartado", "Cancelado", "Expirado",
]);

const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} debe ser un objeto.`);
  return value;
};

function assertSafeKeys(value, path = "pilots") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertSafeKeys(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (FORBIDDEN_KEY.test(key) && !SAFE_DECLARATIONS.has(key)) throw new Error(`${path}.${key} expone un campo privado.`);
    assertSafeKeys(item, `${path}.${key}`);
  });
}

const integer = (value, label) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} no es válido.`);
  return number;
};

const money = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error("El tope del piloto no es válido.");
  return number;
};

function normalizePilot(row) {
  object(row, "Cada piloto de generación");
  if (!PROVIDERS.has(String(row.provider || "")) || !STATUSES.has(String(row.status || ""))
      || !/^[0-9a-f]{64}$/.test(String(row.pilot_fingerprint || ""))
      || !/^[0-9a-f]{64}$/.test(String(row.authorization_fingerprint || ""))
      || !/^[0-9a-f]{32}$/.test(String(row.job_fingerprint || ""))
      || row.human_review_required !== true || row.publication_allowed !== false) {
    throw new Error("Un piloto perdió proveedor, estado, huellas o guardas humanas.");
  }
  const canClaim = row.pilot_worker_may_claim === true;
  const started = row.external_execution_started === true;
  if ((canClaim && row.status !== "Armado") || (started && row.connector_run_id == null)
      || (!started && row.connector_run_id != null)) {
    throw new Error("Un piloto declaró una etapa de ejecución inconsistente.");
  }
  return {
    id: integer(row.id, "El piloto"), authorizationId: integer(row.authorization_id, "La autorización"),
    jobId: integer(row.job_id, "El trabajo"), provider: row.provider, status: row.status,
    maxCostCop: money(row.max_cost_cop), fingerprint: row.pilot_fingerprint,
    authorizationFingerprint: row.authorization_fingerprint, jobFingerprint: row.job_fingerprint,
    armedAt: String(row.armed_at || ""), expiresAt: String(row.expires_at || ""),
    claimedAt: String(row.claimed_at || ""), finishedAt: String(row.finished_at || ""),
    connectorRunId: row.connector_run_id == null ? null : integer(row.connector_run_id, "La ejecución"),
    pilotWorkerMayClaim: canClaim, externalExecutionStarted: started,
    humanReviewRequired: true, publicationAllowed: false,
  };
}

export function normalizeGenerationPilots(value) {
  const envelope = object(value, "La memoria de pilotos");
  const snapshot = object(envelope.snapshot, "El snapshot de pilotos");
  const fingerprint = String(envelope.fingerprint || "");
  if (!/^[0-9a-f]{64}$/.test(fingerprint)
      || snapshot.schema_version !== "momos-generation-pilots/v1"
      || snapshot.single_active_pilot !== true
      || snapshot.human_authorization_required !== true
      || snapshot.credits_consumed_by_arm !== false
      || snapshot.publication_allowed !== false) {
    throw new Error("Los pilotos perdieron su huella o separación entre permiso, ejecución y publicación.");
  }
  const privacy = object(snapshot.privacy, "La privacidad del piloto");
  if (privacy.contains_customer_pii !== false || privacy.contains_staff_identity !== false
      || privacy.contains_storage_paths !== false || privacy.contains_secrets !== false
      || privacy.contains_order_ids !== false) throw new Error("Los pilotos declararon información privada.");
  assertSafeKeys(snapshot);
  const pilots = Array.isArray(snapshot.pilots) ? snapshot.pilots.map(normalizePilot) : [];
  const summary = object(snapshot.summary, "El resumen de pilotos");
  if (Number(summary.pilots) !== pilots.length || pilots.filter((pilot) => pilot.status === "Armado").length > 1) {
    throw new Error("El resumen o la unicidad del piloto no coincide con sus filas.");
  }
  return {
    fingerprint, schemaVersion: snapshot.schema_version, generatedAt: String(snapshot.generated_at || ""),
    pilots, summary, privacy, singleActivePilot: true, humanAuthorizationRequired: true,
    creditsConsumedByArm: false, publicationAllowed: false,
  };
}
