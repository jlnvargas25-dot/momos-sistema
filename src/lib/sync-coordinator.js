export const SYNC_DOMAINS = Object.freeze({
  CATALOGS: "catalogos",
  OPERATIONS: "operativo",
  AGENCY: "agencia",
  FINANCE: "finanzas",
  CONFIGURATION: "configuracion",
  DASHBOARD: "dashboard",
  LOGISTICS: "logistica",
});

const KNOWN_DOMAINS = new Set(Object.values(SYNC_DOMAINS));

const OPERATIONAL_VIEWS = new Set([
  "empaque",
  "reclamos", "historial operativo", "clientes", "beneficios",
]);

// Pedidos consulta el flujo vivo, pero al agendar también necesita el menú
// vendible canónico (activo, precio, familia, figuras y combos). Tratarlo como
// solo operativo deja el catálogo semilla en memoria y puede volver a ofrecer
// productos que el servidor ya desactivó.
const ORDER_ENTRY_VIEWS = new Set(["pedidos"]);

const LOGISTICS_VIEWS = new Set(["domicilios"]);

const FINANCE_VIEWS = new Set(["finanzas"]);
const CONFIGURATION_VIEWS = new Set(["configuracion"]);
const DASHBOARD_VIEWS = new Set(["dashboard"]);

const CATALOG_VIEWS = new Set([
  "productos",
]);

// Inventario terminado cruza el contador oficial de products (CATALOGS) con
// variantes, cuarentena y lotes (OPERATIONS). Debe hidratar ambos dominios,
// igual que Producción, para que una entrada al panel no compare contra un
// contador comercial antiguo y oculte stock exacto válido.
const MIXED_OPERATIONAL_VIEWS = new Set(["produccion", "inventario terminado", "inventario", "reportes"]);
const AGENCY_VIEWS = new Set(["agencia momos", "crecimiento", "marketing", "creativos", "calendario", "resultados"]);

const OPERATIONAL_TABLES = new Set([
  "orders", "order_items", "order_item_adiciones", "packing_verifications", "evidences", "deliveries",
  "order_stage_assignments", "order_line_progress", "order_incidents", "order_dispatch_handoffs",
  "customers", "benefits", "customer_crm_profiles", "customer_contacts", "customer_activations",
  "claims", "inventory_movements", "inventory_reservations", "production_suggestions",
  "production_batches", "lote_figuras", "subreceta_producciones", "production_runs", "production_run_items", "audit_logs",
]);

const AGENCY_TABLES = new Set([
  "agency_snapshot_events",
  "campaigns", "creatives", "content_posts", "metrics_daily", "marketing_ideas", "marketing_guiones", "marketing_mensajes", "marketing_tasks",
  "content_distributions", "distribution_connector_jobs", "brand_media_assets", "brand_media_usages",
  "brand_asset_production_profiles", "brand_visual_quality_assessments", "brand_production_packs", "brand_production_pack_assets",
  "creative_generation_jobs", "creative_connector_runs", "agency_integrations", "agency_mcp_human_approvals",
]);

const FINANCE_TABLES = new Set(["finance_sync_state"]);
const CONFIGURATION_TABLES = new Set(["configuration_sync_state"]);
const DASHBOARD_TABLES = new Set(["dashboard_sync_state"]);

function normalizedKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function syncDomainsForView(view, _options = {}) {
  const key = normalizedKey(view);
  if (ORDER_ENTRY_VIEWS.has(key)) return [SYNC_DOMAINS.CATALOGS, SYNC_DOMAINS.OPERATIONS];
  if (OPERATIONAL_VIEWS.has(key)) return [SYNC_DOMAINS.OPERATIONS];
  if (LOGISTICS_VIEWS.has(key)) return [SYNC_DOMAINS.LOGISTICS];
  if (FINANCE_VIEWS.has(key)) return [SYNC_DOMAINS.FINANCE];
  if (CONFIGURATION_VIEWS.has(key)) return [SYNC_DOMAINS.CONFIGURATION];
  if (DASHBOARD_VIEWS.has(key)) return [SYNC_DOMAINS.DASHBOARD];
  if (CATALOG_VIEWS.has(key)) return [SYNC_DOMAINS.CATALOGS];
  if (MIXED_OPERATIONAL_VIEWS.has(key)) return [SYNC_DOMAINS.CATALOGS, SYNC_DOMAINS.OPERATIONS];
  // H66 y H67 son contratos cerrados de Agencia. Incluso durante un fallback
  // funcional degradado, esta vista nunca cruza ni vuelve a cargar el dominio
  // operativo: la proyección segura del snapshot es su única fuente de lectura.
  if (AGENCY_VIEWS.has(key)) return [SYNC_DOMAINS.AGENCY];
  return [SYNC_DOMAINS.CATALOGS, SYNC_DOMAINS.OPERATIONS];
}

export function syncDomainForTable(table) {
  const key = normalizedKey(table);
  if (FINANCE_TABLES.has(key)) return SYNC_DOMAINS.FINANCE;
  if (CONFIGURATION_TABLES.has(key)) return SYNC_DOMAINS.CONFIGURATION;
  if (DASHBOARD_TABLES.has(key)) return SYNC_DOMAINS.DASHBOARD;
  if (OPERATIONAL_TABLES.has(key)) return SYNC_DOMAINS.OPERATIONS;
  if (AGENCY_TABLES.has(key) || key.startsWith("agency_")) return SYNC_DOMAINS.AGENCY;
  return SYNC_DOMAINS.CATALOGS;
}

export function normalizeSyncDomains(domains) {
  const values = Array.isArray(domains) ? domains : domains ? [domains] : Object.values(SYNC_DOMAINS);
  return [...new Set(values.filter((domain) => KNOWN_DOMAINS.has(domain)))];
}

// PostgreSQL bigint puede superar Number.MAX_SAFE_INTEGER. Las versiones del
// outbox se comparan como enteros decimales canónicos, nunca por reloj ni por
// Number, para no perder eventos por redondeo en sesiones de larga duración.
export function normalizeAgencySnapshotVersion(value) {
  const raw = typeof value === "bigint" ? value.toString() : String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return "";
  const canonical = raw.replace(/^0+(?=\d)/, "");
  return canonical !== "0" ? canonical : "";
}

export function compareAgencySnapshotVersions(left, right) {
  const a = normalizeAgencySnapshotVersion(left);
  const b = normalizeAgencySnapshotVersion(right);
  if (!a || !b) return null;
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a === b ? 0 : a > b ? 1 : -1;
}

export function shouldQueueAgencySnapshotVersion({ incomingVersion, appliedVersion, seenVersion }) {
  const incoming = normalizeAgencySnapshotVersion(incomingVersion);
  if (!incoming) return false;
  const appliedComparison = compareAgencySnapshotVersions(incoming, appliedVersion);
  const seenComparison = compareAgencySnapshotVersions(incoming, seenVersion);
  // Una versión local ausente significa que todavía no existe un snapshot
  // aplicable. El handshake inicial decidirá si debe cargarlo; los eventos se
  // aceptan una sola vez respecto al mayor valor observado/aplicado.
  const newerThanApplied = appliedComparison === null || appliedComparison > 0;
  const newerThanSeen = seenComparison === null || seenComparison > 0;
  return newerThanApplied && newerThanSeen;
}

export function shouldFlushAgencyRealtimeRefresh({ queuedVersion, appliedVersion }) {
  const queued = normalizeAgencySnapshotVersion(queuedVersion);
  // Los eventos operativos legados no incluyen versión y deben conservar el
  // comportamiento anterior. Para el outbox H66/H67, solo refrescamos si la
  // versión observada sigue siendo posterior a la ya aplicada.
  if (!queued) return true;
  const comparison = compareAgencySnapshotVersions(queued, appliedVersion);
  return comparison === null || comparison > 0;
}

export function shouldSyncRealtimeEvent(lastServerAt, commitTimestamp) {
  const commitAt = Date.parse(String(commitTimestamp || ""));
  const snapshotAt = Date.parse(String(lastServerAt || ""));
  if (!Number.isFinite(commitAt) || !Number.isFinite(snapshotAt)) return true;
  return snapshotAt < commitAt;
}

export function shouldQueueRealtimeDomain({ domain, visibleDomains, activeDomains, lastServerAt, commitTimestamp }) {
  const visible = visibleDomains instanceof Set ? visibleDomains : new Set(normalizeSyncDomains(visibleDomains));
  if (!visible.has(domain)) return false;
  const activeSet = activeDomains instanceof Set ? activeDomains : new Set(normalizeSyncDomains(activeDomains));
  // Un commit que llega durante una lectura queda pendiente. El coordinador
  // decidirá después de apply si la versión ya venía dentro de ese snapshot.
  // No se compara por reloj porque el snapshot en vuelo pudo empezar antes.
  if (activeSet.has(domain)) return true;
  return shouldSyncRealtimeEvent(lastServerAt, commitTimestamp);
}

export function createSyncCoordinator({ loaders, apply, onState = () => {}, now = () => Date.now() }) {
  if (!loaders || typeof apply !== "function") throw new Error("El coordinador necesita loaders y apply.");
  let pending = new Set();
  // Una solicitud Realtime que llega mientras su dominio está activo puede
  // quedar obsoleta si el snapshot en vuelo ya incorporó ese mismo evento. La
  // guarda se evalúa justo antes de iniciar el lote posterior, después de apply.
  const pendingAfterActiveGuards = new Map();
  let activeDomains = new Set();
  let active = null;
  let epoch = 0;
  let batchSequence = 0;
  let disposed = false;
  const lastSuccessAt = Object.fromEntries(Object.values(SYNC_DOMAINS).map((domain) => [domain, 0]));
  const lastServerAt = Object.fromEntries(Object.values(SYNC_DOMAINS).map((domain) => [domain, ""]));
  const counters = { requests: 0, batches: 0, loads: 0, deduplicated: 0, cancelled: 0 };
  const durationsMs = [];

  function percentile95(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  }

  function emit(status, extra = {}) {
    onState({
      status,
      pending: [...pending],
      inFlight: Boolean(active),
      counters: { ...counters },
      durationsMs: [...durationsMs],
      p95Ms: percentile95(durationsMs),
      ...extra,
    });
  }

  async function drain(currentEpoch) {
    emit("syncing");
    const failures = [];
    while (!disposed && currentEpoch === epoch && pending.size) {
      const queuedDomains = [...pending];
      pending = new Set();
      const domains = queuedDomains.filter((domain) => {
        const guard = pendingAfterActiveGuards.get(domain);
        pendingAfterActiveGuards.delete(domain);
        if (typeof guard !== "function") return true;
        // Ante un error de la guarda preferimos reconciliar una vez: omitir la
        // lectura podría dejar el cliente permanentemente atrasado.
        try { return guard(domain) !== false; }
        catch { return true; }
      });
      if (!domains.length) continue;
      activeDomains = new Set(domains);
      const batchId = ++batchSequence;
      const startedAt = now();
      counters.batches += 1;
      counters.loads += domains.length;
      try {
        const settled = await Promise.all(domains.map(async (domain) => {
          const loader = loaders[domain];
          if (typeof loader !== "function") return { domain, error: new Error(`No existe loader para ${domain}.`) };
          try { return { domain, data: await loader() }; }
          catch (error) { return { domain, error }; }
        }));
        if (disposed || currentEpoch !== epoch) {
          counters.cancelled += 1;
          emit("cancelled", { batchId, domains });
          return;
        }
        const payload = {};
        settled.forEach((entry) => {
          if (entry.error) failures.push(entry);
          else payload[entry.domain] = entry.data;
        });
        const successfulDomains = Object.keys(payload);
        if (successfulDomains.length) {
          await apply(payload, { batchId, domains: successfulDomains });
          const completedAt = now();
          successfulDomains.forEach((domain) => {
            lastSuccessAt[domain] = completedAt;
            if (payload[domain]?.syncServerTime) lastServerAt[domain] = payload[domain].syncServerTime;
          });
          durationsMs.push(Math.max(0, completedAt - startedAt));
          if (durationsMs.length > 50) durationsMs.shift();
        }
        emit(failures.length ? "partial" : "synced", {
          batchId, domains: successfulDomains, durationMs: durationsMs.at(-1) || 0, p95Ms: percentile95(durationsMs),
        });
      } finally {
        // Una excepción al aplicar React no puede dejar el dominio marcado como
        // activo para siempre: la siguiente solicitud debe poder reintentarlo.
        activeDomains = new Set();
      }
    }
    if (failures.length) {
      const error = new Error(failures.map(({ domain, error }) => `${domain}: ${error?.message || error}`).join(" · "));
      error.failures = failures;
      throw error;
    }
  }

  function request(domains, context = {}) {
    if (disposed) return Promise.reject(new Error("El coordinador de sincronización está cerrado."));
    const normalized = normalizeSyncDomains(domains);
    if (!normalized.length) return Promise.resolve();
    counters.requests += 1;
    normalized.forEach((domain) => {
      if (pending.has(domain)) {
        counters.deduplicated += 1;
        const previousGuard = pendingAfterActiveGuards.get(domain);
        const nextGuard = context.afterActive && typeof context.shouldRunAfterActive === "function"
          ? context.shouldRunAfterActive
          : null;
        // Una solicitud incondicional ya pendiente siempre prevalece. Si ambas
        // son condicionales usamos OR para no perder una versión más reciente.
        if (previousGuard && nextGuard) {
          pendingAfterActiveGuards.set(domain, (queuedDomain) => previousGuard(queuedDomain) !== false || nextGuard(queuedDomain) !== false);
        } else if (!context.afterActive) pendingAfterActiveGuards.delete(domain);
      }
      else if (activeDomains.has(domain)) {
        // Un evento Realtime puede llegar despues de que el snapshot en vuelo
        // ya fue tomado. Conservamos una sola lectura posterior; las solicitudes
        // concurrentes normales siguen deduplicadas.
        if (context.afterActive) {
          pending.add(domain);
          if (typeof context.shouldRunAfterActive === "function") {
            pendingAfterActiveGuards.set(domain, context.shouldRunAfterActive);
          }
        }
        else counters.deduplicated += 1;
      } else {
        pending.add(domain);
        pendingAfterActiveGuards.delete(domain);
      }
    });
    if (!active) {
      const currentEpoch = epoch;
      active = drain(currentEpoch).finally(() => {
        active = null;
        if (!disposed && pending.size) request([...pending], { reason: "trailing" }).catch(() => {});
        else emit("idle");
      });
    } else emit("queued", { reason: context.reason || "unspecified" });
    return active;
  }

  function staleDomains(ttlByDomain, at = now()) {
    return Object.values(SYNC_DOMAINS).filter((domain) => {
      const ttl = Math.max(0, Number(ttlByDomain?.[domain] ?? 0));
      return !lastSuccessAt[domain] || at - lastSuccessAt[domain] >= ttl;
    });
  }

  function cancel() {
    epoch += 1;
    pending.clear();
    pendingAfterActiveGuards.clear();
    disposed = true;
    emit("cancelled");
  }

  function snapshot() {
    return {
      pending: [...pending], activeDomains: [...activeDomains], inFlight: Boolean(active),
      lastSuccessAt: { ...lastSuccessAt }, lastServerAt: { ...lastServerAt }, counters: { ...counters }, durationsMs: [...durationsMs], p95Ms: percentile95(durationsMs),
    };
  }

  return { request, staleDomains, cancel, snapshot };
}
