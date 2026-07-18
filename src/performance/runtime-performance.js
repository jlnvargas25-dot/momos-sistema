const DEFAULT_MAX_SAMPLES = 100;

const KNOWN_DOMAINS = new Set(["catalogos", "operativo", "agencia", "finanzas", "unknown"]);
const KNOWN_KINDS = new Set(["rest", "rpc", "storage", "auth", "realtime", "other"]);
const KNOWN_SYNC_SOURCES = new Set(["snapshot", "legacy", "cache", "realtime", "unknown"]);
const KNOWN_VIEWS = new Set([
  "dashboard", "pedidos", "produccion", "empaque", "inventario-terminado", "inventario",
  "productos", "domicilios", "reclamos", "historial", "clientes", "beneficios", "agencia-momos",
  "marketing", "creativos", "calendario", "resultados", "finanzas", "reportes", "configuracion",
]);

const OPERATIONAL_RESOURCES = new Set([
  "orders", "order_items", "order_item_adiciones", "packing_verifications", "evidences", "deliveries",
  "order_stage_assignments", "order_line_progress", "order_incidents", "order_dispatch_handoffs",
  "customers", "benefits", "customer_crm_profiles", "customer_contacts", "customer_activations", "claims",
  "inventory_movements", "inventory_reservations", "production_suggestions", "production_batches",
  "lote_figuras", "subreceta_producciones", "production_runs", "production_run_items", "audit_logs",
]);

const FINANCE_RESOURCES = new Set([
  "finance_summary", "financial_summary", "finance_movements", "payment_reconciliations",
  "momos_finance_snapshot_v1", "obtener_resumen_financiero",
]);

function normalizedToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function limitedPush(list, value, limit) {
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function sanitizeDomain(value) {
  const domain = normalizedToken(value);
  return KNOWN_DOMAINS.has(domain) ? domain : "unknown";
}

function sanitizeKind(value) {
  const kind = normalizedToken(value);
  return KNOWN_KINDS.has(kind) ? kind : "other";
}

function sanitizeSyncSource(value) {
  const source = normalizedToken(value);
  return KNOWN_SYNC_SOURCES.has(source) ? source : "unknown";
}

function sanitizeView(value) {
  const view = normalizedToken(value);
  return KNOWN_VIEWS.has(view) ? view : "unknown";
}

export function nearestRankPercentile(values, percentile) {
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const requested = Number(percentile);
  const bounded = Number.isFinite(requested) ? Math.min(100, Math.max(0, requested)) : 0;
  const rank = Math.max(1, Math.ceil(bounded / 100 * clean.length));
  return clean[Math.min(clean.length - 1, rank - 1)];
}

export function statusClass(status) {
  const value = Number(status);
  if (!Number.isInteger(value) || value < 100 || value > 599) return "network-error";
  return `${Math.floor(value / 100)}xx`;
}

export function estimateJsonBytes(value) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return 0;
    return new TextEncoder().encode(serialized).byteLength;
  } catch {
    return 0;
  }
}

function aggregate(records, durationKey = "durationMs") {
  const durations = records.map((record) => record[durationKey]);
  return {
    count: records.length,
    bytesIn: records.reduce((total, record) => total + safeNumber(record.bytesIn), 0),
    bytesOut: records.reduce((total, record) => total + safeNumber(record.bytesOut), 0),
    p50Ms: nearestRankPercentile(durations, 50),
    p95Ms: nearestRankPercentile(durations, 95),
  };
}

function aggregateBy(records, key) {
  const groups = {};
  records.forEach((record) => {
    const group = record[key] || "unknown";
    if (!groups[group]) groups[group] = [];
    groups[group].push(record);
  });
  return Object.fromEntries(Object.entries(groups).map(([group, entries]) => [group, aggregate(entries)]));
}

function aggregateRoutesByView(records) {
  const groups = {};
  records.forEach((record) => {
    if (!groups[record.view]) groups[record.view] = [];
    groups[record.view].push(record);
  });
  return Object.fromEntries(Object.entries(groups).map(([view, entries]) => [view, {
    count: entries.length,
    ready: entries.filter((entry) => entry.status === "ready").length,
    requests: entries.reduce((total, entry) => total + safeNumber(entry.requests), 0),
    bytesIn: entries.reduce((total, entry) => total + safeNumber(entry.bytesIn), 0),
    bytesOut: entries.reduce((total, entry) => total + safeNumber(entry.bytesOut), 0),
    p50Ms: nearestRankPercentile(entries.filter((entry) => entry.status === "ready").map((entry) => entry.durationMs), 50),
    p95Ms: nearestRankPercentile(entries.filter((entry) => entry.status === "ready").map((entry) => entry.durationMs), 95),
    requestP95Ms: nearestRankPercentile(entries.flatMap((entry) => entry.requestDurationsMs || []), 95),
  }]));
}

export function createRuntimePerformance({
  enabled = true,
  maxSamples = DEFAULT_MAX_SAMPLES,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  onChange = () => {},
} = {}) {
  const limit = Math.max(10, Math.min(1000, Math.trunc(Number(maxSamples) || DEFAULT_MAX_SAMPLES)));
  const http = [];
  const sync = [];
  const routes = [];
  let activeRoute = null;
  let routeSequence = 0;

  function emit() {
    if (enabled) onChange(snapshot());
  }

  function finishActiveRoute(status, at = now()) {
    if (!activeRoute) return null;
    const finished = {
      id: activeRoute.id,
      view: activeRoute.view,
      status,
      durationMs: Math.max(0, at - activeRoute.startedAt),
      requiredDomains: [...activeRoute.requiredDomains],
      requests: activeRoute.requests,
      bytesIn: activeRoute.bytesIn,
      bytesOut: activeRoute.bytesOut,
      requestDurationsMs: [...activeRoute.requestDurationsMs],
    };
    limitedPush(routes, finished, limit);
    activeRoute = null;
    return finished;
  }

  function tryFinishRoute(at = now()) {
    if (!activeRoute || activeRoute.uiCommittedAt === null) return null;
    const ready = activeRoute.requiredDomains.every((domain) => activeRoute.readyDomains.has(domain));
    return ready ? finishActiveRoute("ready", at) : null;
  }

  function startRoute(view, { requiredDomains = [], freshDomains = [] } = {}) {
    if (!enabled) return 0;
    const at = now();
    finishActiveRoute("superseded", at);
    const required = [...new Set(requiredDomains.map(sanitizeDomain).filter((domain) => domain !== "unknown"))];
    const fresh = new Set(freshDomains.map(sanitizeDomain).filter((domain) => required.includes(domain)));
    activeRoute = {
      id: ++routeSequence,
      view: sanitizeView(view),
      startedAt: at,
      uiCommittedAt: null,
      requiredDomains: required,
      readyDomains: fresh,
      requests: 0,
      bytesIn: 0,
      bytesOut: 0,
      requestDurationsMs: [],
    };
    emit();
    return activeRoute.id;
  }

  function markUiCommitted(routeId) {
    if (!enabled || !activeRoute || activeRoute.id !== routeId) return false;
    activeRoute.uiCommittedAt = now();
    const finished = tryFinishRoute(activeRoute.uiCommittedAt);
    emit();
    return Boolean(finished);
  }

  function markDomainReady(domain, routeId = activeRoute?.id) {
    if (!enabled || !activeRoute || activeRoute.id !== routeId) return false;
    const safeDomain = sanitizeDomain(domain);
    if (activeRoute.requiredDomains.includes(safeDomain)) activeRoute.readyDomains.add(safeDomain);
    const finished = tryFinishRoute(now());
    emit();
    return Boolean(finished);
  }

  function recordHttp(metric = {}) {
    if (!enabled) return;
    const record = {
      domain: sanitizeDomain(metric.domain),
      kind: sanitizeKind(metric.kind),
      statusClass: statusClass(metric.status),
      ok: metric.ok === true,
      durationMs: safeNumber(metric.durationMs),
      bytesIn: safeNumber(metric.bytesIn),
      bytesOut: safeNumber(metric.bytesOut),
    };
    limitedPush(http, record, limit);
    if (activeRoute) {
      activeRoute.requests += 1;
      activeRoute.bytesIn += record.bytesIn;
      activeRoute.bytesOut += record.bytesOut;
      limitedPush(activeRoute.requestDurationsMs, record.durationMs, limit);
    }
    emit();
  }

  function recordSync(metric = {}) {
    if (!enabled) return;
    limitedPush(sync, {
      domain: sanitizeDomain(metric.domain),
      source: sanitizeSyncSource(metric.source),
      ok: metric.ok === true,
      durationMs: safeNumber(metric.durationMs),
      bytesIn: safeNumber(metric.bytesIn),
      bytesOut: 0,
    }, limit);
    emit();
  }

  function snapshot() {
    const readyRoutes = routes.filter((route) => route.status === "ready");
    return {
      enabled,
      http: { ...aggregate(http), byDomain: aggregateBy(http, "domain"), byKind: aggregateBy(http, "kind") },
      sync: { ...aggregate(sync), byDomain: aggregateBy(sync, "domain") },
      routes: {
        count: routes.length,
        ready: readyRoutes.length,
        superseded: routes.filter((route) => route.status === "superseded").length,
        p50Ms: nearestRankPercentile(readyRoutes.map((route) => route.durationMs), 50),
        p95Ms: nearestRankPercentile(readyRoutes.map((route) => route.durationMs), 95),
        byView: aggregateRoutesByView(routes),
      },
      activeRoute: activeRoute ? {
        id: activeRoute.id,
        view: activeRoute.view,
        requiredDomains: [...activeRoute.requiredDomains],
        readyDomains: [...activeRoute.readyDomains],
        uiCommitted: activeRoute.uiCommittedAt !== null,
        requests: activeRoute.requests,
        bytesIn: activeRoute.bytesIn,
        bytesOut: activeRoute.bytesOut,
      } : null,
      recent: {
        http: http.map((record) => ({ ...record })),
        sync: sync.map((record) => ({ ...record })),
        routes: routes.map((record) => ({
          ...record,
          requiredDomains: [...record.requiredDomains],
          requestDurationsMs: [...record.requestDurationsMs],
        })),
      },
    };
  }

  function reset() {
    http.length = 0;
    sync.length = 0;
    routes.length = 0;
    activeRoute = null;
    emit();
  }

  return { isEnabled: () => enabled, startRoute, markUiCommitted, markDomainReady, recordHttp, recordSync, snapshot, reset };
}

function requestUrl(input) {
  if (typeof input === "string" || input instanceof URL) return String(input);
  return typeof input?.url === "string" ? input.url : "";
}

function resourceDomain(resource) {
  const key = normalizedToken(resource).replaceAll("-", "_");
  if (FINANCE_RESOURCES.has(key) || key.startsWith("finance_") || key.startsWith("financial_")) return "finanzas";
  if (OPERATIONAL_RESOURCES.has(key) || key.startsWith("momos_operational_") || key.startsWith("operational_")) return "operativo";
  if (key.startsWith("agency_") || key.startsWith("brand_") || key.startsWith("creative_") || key.startsWith("content_")) return "agencia";
  return "catalogos";
}

export function classifySupabaseRequest(input) {
  let pathname = "";
  try { pathname = new URL(requestUrl(input), "https://local.invalid").pathname.toLowerCase(); }
  catch { return { domain: "unknown", kind: "other" }; }

  if (pathname.includes("/storage/v1/")) {
    return { domain: /brand|creative|content|agency/.test(pathname) ? "agencia" : "catalogos", kind: "storage" };
  }
  if (pathname.includes("/auth/v1/")) return { domain: "catalogos", kind: "auth" };
  if (pathname.includes("/realtime/v1/")) return { domain: "operativo", kind: "realtime" };

  const rpcMatch = pathname.match(/\/rest\/v1\/rpc\/([^/]+)/);
  if (rpcMatch) return { domain: resourceDomain(rpcMatch[1]), kind: "rpc" };
  const restMatch = pathname.match(/\/rest\/v1\/([^/]+)/);
  if (restMatch) return { domain: resourceDomain(restMatch[1]), kind: "rest" };
  return { domain: "unknown", kind: "other" };
}

function headerNumber(headers, name) {
  try {
    const value = headers?.get?.(name);
    return safeNumber(value);
  } catch {
    return 0;
  }
}

function requestHeaders(input, init) {
  if (init?.headers && typeof Headers !== "undefined") return new Headers(init.headers);
  return input?.headers || null;
}

export function createInstrumentedFetch({ fetchImpl = globalThis.fetch, telemetry, now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Se necesita una implementación de fetch.");
  if (!telemetry || typeof telemetry.recordHttp !== "function") throw new Error("Se necesita telemetría de rendimiento.");

  return async function instrumentedFetch(input, init) {
    if (telemetry.isEnabled?.() === false) return fetchImpl(input, init);
    const startedAt = now();
    const classification = classifySupabaseRequest(input);
    const bytesOut = headerNumber(requestHeaders(input, init), "content-length");
    try {
      const response = await fetchImpl(input, init);
      telemetry.recordHttp({
        ...classification,
        status: response?.status,
        ok: response?.ok === true,
        durationMs: Math.max(0, now() - startedAt),
        bytesIn: headerNumber(response?.headers, "content-length"),
        bytesOut,
      });
      return response;
    } catch (error) {
      telemetry.recordHttp({
        ...classification,
        status: 0,
        ok: false,
        durationMs: Math.max(0, now() - startedAt),
        bytesIn: 0,
        bytesOut,
      });
      throw error;
    }
  };
}
