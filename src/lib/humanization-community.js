const FORBIDDEN_KEY = /(?:customer|client|phone|email|address|username|user_handle|profile_url|raw_comment|comment_text|direct_message|message_text|storage_path|signed_url|(?:^|_)order_id(?:$|_)|api[_-]?key|access[_-]?token|service[_-]?role|authorization)/i;
const SAFE_PRIVACY_KEYS = new Set([
  "contains_customer_pii", "contains_raw_comments", "contains_handles",
  "contains_direct_messages", "contains_order_ids",
]);
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(^|\s)\+?\d{7,15}(\s|$)/;
const HANDLE = /(^|\s)@[A-Z0-9_.-]{2,}/i;

const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} debe ser un objeto.`);
  return value;
};

const positiveId = (value, label) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} no tiene ID válido.`);
  return id;
};

const count = (value, label) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} no es un conteo válido.`);
  return number;
};

function assertSafe(value, path = "snapshot") {
  if (typeof value === "string" && (EMAIL.test(value) || PHONE.test(value) || HANDLE.test(value))) {
    throw new Error(`${path} expone PII o un identificador social.`);
  }
  if (Array.isArray(value)) return value.forEach((item, index) => assertSafe(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (FORBIDDEN_KEY.test(key) && !SAFE_PRIVACY_KEYS.has(key)) throw new Error(`${path}.${key} expone un campo privado.`);
    assertSafe(item, `${path}.${key}`);
  });
}

function normalizeSeries(row) {
  object(row, "Cada serie");
  const fingerprint = String(row.series_fingerprint || "");
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("Una serie perdió su huella.");
  return {
    id: positiveId(row.id, "Una serie"), seriesKey: String(row.series_key || ""),
    version: count(row.version, "La versión de serie"), name: String(row.name || ""),
    purpose: String(row.purpose || ""), protagonist: String(row.protagonist || ""),
    emotionalTerritory: String(row.emotional_territory || ""), mode: String(row.mode || ""),
    channel: String(row.channel || ""), status: String(row.status || ""),
    sourceFormulaId: row.source_formula_id == null ? null : positiveId(row.source_formula_id, "La fórmula fuente"),
    editorialContract: object(row.editorial_contract, "El contrato editorial"),
    fingerprint, sourceKind: String(row.source_kind || ""),
    preparedAt: String(row.prepared_at || ""), reviewedAt: String(row.reviewed_at || ""),
  };
}

function normalizeEpisode(row) {
  object(row, "Cada episodio");
  const fingerprint = String(row.episode_fingerprint || "");
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("Un episodio perdió su huella.");
  const readiness = object(row.pack_readiness || { ready: true, reasons: [] }, "El estado del paquete");
  if (readiness.ready !== true && readiness.ready !== false) throw new Error("El paquete no declaró su estado.");
  return {
    id: positiveId(row.id, "Un episodio"), episodeKey: String(row.episode_key || ""),
    seriesId: positiveId(row.series_id, "La serie del episodio"), title: String(row.title || ""),
    storyKind: String(row.story_kind || ""), representation: String(row.representation || ""),
    status: String(row.status || ""), productionPackId: row.production_pack_id == null ? null : positiveId(row.production_pack_id, "El paquete"),
    sourceFormulaId: row.source_formula_id == null ? null : positiveId(row.source_formula_id, "La fórmula del episodio"),
    sourceBriefId: row.source_brief_id == null ? null : positiveId(row.source_brief_id, "El brief del episodio"),
    sourceCreativeId: String(row.source_creative_id || ""),
    episodeContract: object(row.episode_contract, "El contrato del episodio"), fingerprint,
    sourceKind: String(row.source_kind || ""), preparedAt: String(row.prepared_at || ""),
    reviewedAt: String(row.reviewed_at || ""), postId: String(row.post_id || ""),
    linkedAt: String(row.linked_at || ""), packReadiness: {
      ready: readiness.ready, reasons: Array.isArray(readiness.reasons) ? readiness.reasons.map(String) : [],
    },
  };
}

function normalizeSignal(row) {
  object(row, "Cada señal agregada");
  const fingerprint = String(row.evidence_fingerprint || "");
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("Una señal perdió su huella.");
  const themes = Array.isArray(row.themes) ? row.themes.map((theme) => ({
    theme: String(object(theme, "Cada tema").theme || ""),
    count: count(theme.count, "El conteo del tema"), sentiment: String(theme.sentiment || ""),
  })) : [];
  return {
    id: positiveId(row.id, "Una señal"), signalKey: String(row.signal_key || ""),
    episodeId: positiveId(row.episode_id, "El episodio de la señal"), platform: String(row.platform || ""),
    windowStart: String(row.window_start || ""), windowEnd: String(row.window_end || ""),
    impressions: count(row.impressions, "Impresiones"), reach: count(row.reach, "Alcance"),
    commentsTotal: count(row.comments_total, "Comentarios agregados"),
    meaningfulComments: count(row.meaningful_comments, "Comentarios significativos"),
    questions: count(row.questions, "Preguntas"), shares: count(row.shares, "Compartidos"),
    saves: count(row.saves, "Guardados"), mentions: count(row.mentions, "Menciones"),
    authorizedUgc: count(row.authorized_ugc, "UGC autorizado"),
    recurringConversations: count(row.recurring_conversations, "Conversaciones recurrentes"),
    characterAssociations: count(row.character_associations, "Asociaciones con personajes"),
    connectionSignals: count(row.connection_signals, "Señales de conexión"), themes, fingerprint,
    sourceKind: String(row.source_kind || ""), recordedAt: String(row.recorded_at || ""),
    outcome: String(row.outcome || ""), decidedAt: String(row.decided_at || ""),
  };
}

export function normalizeHumanizationCommunity(value) {
  const envelope = object(value, "La memoria de humanización");
  const fingerprint = String(envelope.fingerprint || "");
  const snapshot = object(envelope.snapshot, "El snapshot de humanización");
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("La memoria de humanización no tiene huella válida.");
  if (snapshot.schema_version !== "momos-humanization-community/v1") throw new Error("La versión de humanización no es compatible.");
  if (snapshot.external_execution_allowed !== false || snapshot.human_approval_required !== true) {
    throw new Error("La memoria de humanización intentó ampliar permisos.");
  }
  const privacy = object(snapshot.privacy, "La privacidad de comunidad");
  for (const key of ["contains_customer_pii", "contains_staff_identity", "contains_raw_comments", "contains_handles", "contains_direct_messages", "contains_secrets", "contains_order_ids"]) {
    if (privacy[key] !== false) throw new Error("La memoria comunitaria declaró datos privados.");
  }
  const capabilities = object(snapshot.capabilities, "Las capacidades comunitarias");
  if (capabilities.can_propose !== true || capabilities.can_read_aggregates !== true
    || ["can_approve", "can_reply", "can_contact", "can_publish", "can_reuse_ugc", "can_change_budget"].some((key) => capabilities[key] !== false)) {
    throw new Error("La memoria comunitaria declaró capacidades peligrosas.");
  }
  const definitions = object(snapshot.metric_definitions, "Las definiciones de conexión");
  if (definitions.views_alone_can_win !== false || definitions.attribution_is_causality !== false) {
    throw new Error("La memoria comunitaria permitió aprendizaje sin evidencia.");
  }
  assertSafe(snapshot);
  return {
    fingerprint, schemaVersion: snapshot.schema_version, generatedAt: String(snapshot.generated_at || ""),
    series: Array.isArray(snapshot.series) ? snapshot.series.map(normalizeSeries) : [],
    episodes: Array.isArray(snapshot.episodes) ? snapshot.episodes.map(normalizeEpisode) : [],
    signals: Array.isArray(snapshot.signals) ? snapshot.signals.map(normalizeSignal) : [],
    summary: object(snapshot.summary, "El resumen de humanización"), metricDefinitions: definitions,
    privacy, capabilities, humanApprovalRequired: true, externalExecutionAllowed: false,
  };
}
