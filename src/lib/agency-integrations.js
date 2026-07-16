const INTEGRATION_CATALOG = [
  {
    provider: "Higgsfield",
    kind: "Generación",
    icon: "✦",
    purpose: "Genera y transforma imágenes o videos desde originales aprobados.",
    capabilities: ["Imagen", "Video", "Edición"],
  },
  {
    provider: "HeyGen",
    kind: "Generación",
    icon: "▶",
    purpose: "Produce piezas habladas o con avatar sin alterar los originales de marca.",
    capabilities: ["Video", "Avatar", "Voz"],
  },
  {
    provider: "Meta",
    kind: "Distribución y métricas",
    icon: "◎",
    purpose: "Publica con aprobación y devuelve resultados de Instagram y Facebook.",
    capabilities: ["Instagram", "Facebook", "Métricas"],
  },
  {
    provider: "TikTok",
    kind: "Distribución y métricas",
    icon: "♪",
    purpose: "Publica con aprobación y devuelve pauta, interacción y conversiones.",
    capabilities: ["TikTok", "Pauta", "Métricas"],
  },
];

export const AGENCY_INTEGRATION_PROVIDERS = INTEGRATION_CATALOG.map((item) => item.provider);
export const AGENCY_INTEGRATION_ENVIRONMENTS = ["Pruebas", "Producción"];

const STATUS_ORDER = ["Con error", "Por conectar", "Configurada", "Pausada", "Activa"];

function asDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function minutesBetween(now, value) {
  const date = asDate(value);
  return date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000)) : null;
}

function rowsForProvider(db, provider) {
  const jobs = (db.creativeGenerationJobs || []).filter((job) => job.provider === provider);
  if (provider === "Meta") {
    const distributions = (db.content_distributions || []).filter((row) => ["Instagram", "Facebook"].includes(row.channel));
    return { jobs, distributions };
  }
  if (provider === "TikTok") {
    return { jobs, distributions: (db.content_distributions || []).filter((row) => row.channel === "TikTok") };
  }
  return { jobs, distributions: [] };
}

function normalizeCapabilities(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

export function buildAgencyIntegrationCenter(db = {}, nowValue = new Date()) {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const storedByProvider = new Map((db.agencyIntegrations || []).map((row) => [row.provider, row]));

  const integrations = INTEGRATION_CATALOG.map((definition) => {
    const stored = storedByProvider.get(definition.provider) || {};
    const status = STATUS_ORDER.includes(stored.status) ? stored.status : "Por conectar";
    const heartbeatMinutes = minutesBetween(now, stored.lastHeartbeatAt);
    const heartbeatFresh = heartbeatMinutes !== null && heartbeatMinutes <= 30;
    const secretConfigured = stored.secretConfigured === true;
    const bridgeRequired = definition.provider === "Higgsfield";
    const bridgeInstalled = !bridgeRequired || db.higgsfieldConnectorReady === true;
    const operational = Boolean(db.agencyIntegrationsReady) && bridgeInstalled && status === "Activa" && secretConfigured && heartbeatFresh;
    const { jobs, distributions } = rowsForProvider(db, definition.provider);
    const runs = (db.creativeConnectorRuns || []).filter((run) => run.provider === definition.provider);
    const waiting = definition.kind === "Generación"
      ? jobs.filter((job) => job.status === "Autorizado").length
      : distributions.filter((row) => row.status === "Aprobada").length;
    const running = jobs.filter((job) => job.status === "En generación").length;
    const reasons = [];
    if (!db.agencyIntegrationsReady) reasons.push("Falta aplicar la migración 23.");
    else if (status === "Pausada") reasons.push("La integración está pausada por el equipo.");
    else if (!bridgeInstalled) reasons.push("Falta aplicar la migración 24 del worker Higgsfield.");
    else if (status === "Con error") reasons.push(stored.lastError || "El último chequeo del conector falló.");
    else if (!secretConfigured) reasons.push("Falta autenticar la credencial privada del conector.");
    else if (status !== "Activa") reasons.push("El conector todavía no confirmó que está activo.");
    else if (!heartbeatFresh) reasons.push("El conector no reporta actividad reciente.");

    return {
      ...definition,
      ...stored,
      provider: definition.provider,
      kind: definition.kind,
      icon: definition.icon,
      purpose: definition.purpose,
      status,
      capabilities: normalizeCapabilities(stored.capabilities, definition.capabilities),
      environment: stored.environment || "Producción",
      accountLabel: stored.accountLabel || "",
      externalAccountId: stored.externalAccountId || "",
      secretConfigured,
      heartbeatMinutes,
      heartbeatFresh,
      bridgeInstalled,
      operational,
      waiting,
      running,
      lastRun: runs[0] || null,
      runCount: runs.length,
      reasons,
      needsAttention: waiting > 0 && !operational || status === "Con error",
    };
  });

  return {
    ready: Boolean(db.agencyIntegrationsReady),
    integrations,
    summary: {
      total: integrations.length,
      operational: integrations.filter((item) => item.operational).length,
      needsAttention: integrations.filter((item) => item.needsAttention).length,
      waiting: integrations.reduce((total, item) => total + item.waiting, 0),
      completed: integrations.reduce((total, item) => total + Number(item.successfulJobs || 0), 0),
      failed: integrations.reduce((total, item) => total + Number(item.failedJobs || 0), 0),
    },
  };
}

export function agencyProviderExecutionGuard(provider, db = {}, nowValue = new Date()) {
  if (provider === "Manual") return { allowed: true, reasons: [], integration: null };
  const center = buildAgencyIntegrationCenter(db, nowValue);
  const integration = center.integrations.find((item) => item.provider === provider);
  if (!integration) return { allowed: false, reasons: ["El proveedor no pertenece al catálogo protegido de MOMO OPS."], integration: null };
  return { allowed: integration.operational, reasons: integration.reasons, integration };
}
