import { supabase } from "./supabase.js";
import { normalizeAgencySnapshotVersion } from "./sync-coordinator.js";
import { normalizeInventoryCursorToken } from "./inventory-cursor.js";
import { inventoryCoreSnapshotBlockIsComplete } from "./inventory-sync-policy.js";
import { agencyOperationalFactsReady as hasAgencyOperationalFacts, normalizeAgencyOperationalFacts } from "./agency-operational-facts.js";
import { normalizeOrderDeltaBatch } from "./order-delta.js";
import { normalizeFinishedInventoryDeltaBatch } from "./finished-inventory-delta.js";

/* ── Fase 3 · slice 2: lecturas de MAESTROS/CATÁLOGOS desde Supabase ──
   Devuelve objetos con el shape EXACTO de la maqueta (camelCase).
   Maestros operativos y marketing hidratado se traducen al shape legado del
   monolito; las escrituras correspondientes viven en RPCs por slice.
   settings.counters NO se hidrata: los ids operativos siguen siendo locales. */

const nz = (v, def = "") => (v === null || v === undefined ? def : v);

// Sellos operativos: el server guarda timestamptz UTC; la maqueta espera hora LOCAL Bogotá.
const BOGOTA = "America/Bogota";
const fechaBogota = (ts) => (ts ? new Date(ts).toLocaleDateString("en-CA", { timeZone: BOGOTA }) : "");
const horaBogota = (ts) => (ts ? new Date(ts).toLocaleTimeString("en-GB", { timeZone: BOGOTA, hour: "2-digit", minute: "2-digit" }) : "");
const tsBogota = (ts) => (ts ? fechaBogota(ts) + " " + horaBogota(ts) : "");
const hhmm = (t) => (t ? String(t).slice(0, 5) : ""); // time 'HH:MM:SS' → 'HH:MM'

let syncManifestPromise = null;

export async function fetchSyncManifest() {
  if (!syncManifestPromise) {
    syncManifestPromise = supabase.rpc("momos_sync_manifest_v1").then((result) => {
      const missing = result.error && (result.error.code === "PGRST202"
        || /could not find the function|schema cache/i.test(result.error.message || ""));
      if (missing) return null;
      if (result.error) throw new Error(result.error.message);
      return result.data || null;
    }).catch((error) => {
      syncManifestPromise = null;
      throw error;
    });
  }
  return syncManifestPromise;
}

async function capabilityResult(name) {
  const manifest = await fetchSyncManifest();
  if (manifest?.capabilities && Object.prototype.hasOwnProperty.call(manifest.capabilities, name)) {
    return { data: manifest.capabilities[name] === true, error: null };
  }
  return supabase.rpc(name);
}

async function optionalSnapshot(name) {
  const result = await supabase.rpc(name);
  const missing = result.error && (result.error.code === "PGRST202"
    || /could not find the function|schema cache/i.test(result.error.message || ""));
  if (missing) return null;
  if (result.error) throw new Error(result.error.message);
  return result.data && typeof result.data === "object" ? result.data : null;
}

export const AGENCY_SNAPSHOT_SCOPES = Object.freeze([
  "overview", "workflow", "production", "measurement",
]);

function agencySnapshotRpcFailure(result) {
  const error = result?.error || result?.thrown || null;
  if (!error) return { kind: "none", error: null, status: Number(result?.status || 0) };
  const code = String(error.code || "").trim().toUpperCase();
  const name = String(error.name || "").trim();
  const message = String(error.message || error || "").trim();
  const status = Number(result?.status || error.status || error.statusCode || 0);
  const missing = code === "PGRST202"
    || /could not find (?:the )?function\b/i.test(message)
    || /function\b.+\bdoes not exist\b/i.test(message);
  if (missing) return { kind: "missing", error, status };

  // Autenticacion, RLS y privilegios nunca se degradan a otro contrato.
  const forbidden = status === 401 || status === 403
    || code === "42501"
    || /^PGRST30[1-3]$/.test(code)
    || /permission denied|insufficient privilege|unauthori[sz]ed|forbidden|jwt/i.test(message);
  if (forbidden) return { kind: "forbidden", error, status };

  const transient = status === 408 || status === 429 || status >= 500
    || /^PGRST00[0-3]$/.test(code)
    || /^(?:08\w{3}|53\w{3}|57P01|57014|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)$/i.test(code)
    || /^(?:AbortError|TimeoutError)$/i.test(name)
    || /failed to fetch|fetch failed|network(?: request)? (?:error|failed)|timed?\s*out|timeout|connection (?:reset|refused|closed)|service unavailable|bad gateway|gateway timeout/i.test(message);
  return { kind: transient ? "transient" : "fatal", error, status };
}

async function callAgencySnapshotRpc(name) {
  try {
    return await supabase.rpc(name);
  } catch (error) {
    return { data: null, error, thrown: error, status: Number(error?.status || error?.statusCode || 0) };
  }
}

function throwAgencySnapshotRpcFailure(name, failure) {
  const error = new Error(failure?.error?.message || `No se pudo leer ${name}.`);
  if (failure?.error?.code) error.code = failure.error.code;
  if (failure?.status) error.status = failure.status;
  error.cause = failure?.error;
  throw error;
}

const AGENCY_LEGACY_TOP_LEVEL_KEYS = Object.freeze({
  content_calendar: "content_calendar",
  creative_results: "creative_results",
  content_distributions: "content_distributions",
});

const AGENCY_ROW_KEY_ALIASES = Object.freeze({
  mensajes_whatsapp: "mensajesWhatsApp",
});

const agencyCamelKey = (key) => String(key || "").replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());

function adaptAgencyRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    AGENCY_ROW_KEY_ALIASES[key] || agencyCamelKey(key),
    value,
  ]));
}

export function adaptAgencySnapshotEnvelope(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Number(snapshot.version) !== 1) {
    throw new Error("El snapshot de Agencia no tiene una versión compatible.");
  }
  const scope = String(snapshot.scope || "").trim().toLowerCase();
  const sourceVersion = normalizeAgencySnapshotVersion(snapshot.source_version);
  if (!AGENCY_SNAPSHOT_SCOPES.includes(scope) || !snapshot.payload || typeof snapshot.payload !== "object") {
    throw new Error("El snapshot de Agencia no tiene un alcance válido.");
  }
  const allowedRoles = snapshot.authority?.allowed_roles;
  if (snapshot.authority?.read_only !== true
      || snapshot.authority?.external_execution !== false
      || snapshot.authority?.human_approval_required !== true
      || !Array.isArray(allowedRoles)
      || allowedRoles.length !== 2
      || allowedRoles[0] !== "Administrador"
      || allowedRoles[1] !== "Marketing/CRM") {
    throw new Error("El snapshot de Agencia perdió su contrato de solo lectura.");
  }
  const privacy = snapshot.privacy || {};
  if (privacy.projection !== "agency-authorized-v1"
      || privacy.customer_records_projected !== false
      || privacy.secrets_projected !== false
      || privacy.free_text_unverified !== true
      || privacy.telemetry_allowed !== false
      || privacy.storage_references_projected !== (scope === "production")) {
    throw new Error("El snapshot de Agencia no cumple el contrato de privacidad.");
  }
  if (!sourceVersion) {
    throw new Error("El snapshot de Agencia no tiene una versión de fuente válida.");
  }

  const data = {};
  Object.entries(snapshot.payload).forEach(([key, value]) => {
    const legacyKey = AGENCY_LEGACY_TOP_LEVEL_KEYS[key] || agencyCamelKey(key);
    if (key === "agency_operational_facts") {
      const facts = normalizeAgencyOperationalFacts(value);
      if (!facts) throw new Error("El snapshot de Agencia contiene hechos operativos incompatibles.");
      data[legacyKey] = facts;
    }
    else if (key === "agency_action_queue" || key === "agency_brand_identity") data[legacyKey] = value;
    else if (Array.isArray(value)) data[legacyKey] = value.map(adaptAgencyRow);
    else if (value && typeof value === "object") data[legacyKey] = adaptAgencyRow(value);
    else data[legacyKey] = value;
  });

  // La propuesta sellada conserva JSON interno en snake_case por contrato,
  // pero el motor legado consume también sus campos principales en la raíz.
  if (Array.isArray(data.agencyAgentProposals)) {
    data.agencyAgentProposals = data.agencyAgentProposals.map((proposal) => {
      const sealed = proposal.sealedPayload || {};
      return {
        ...proposal,
        decisionType: sealed.decision_type,
        title: sealed.title,
        rationale: sealed.rationale,
        evidence: sealed.evidence || {},
        proposedAction: sealed.proposed_action || {},
        requiredTools: sealed.required_tools || [],
        confidence: Number(sealed.confidence || 0),
        riskLevel: sealed.risk_level,
        estimatedCostCop: Number(sealed.estimated_cost_cop || 0),
        costCapCop: Number(sealed.cost_cap_cop || 0),
        executionMode: sealed.execution_mode,
        source: sealed.source,
      };
    });
  }
  if (Array.isArray(data.brandMediaAssets)) {
    data.brandMediaAssets = data.brandMediaAssets.map((asset) => ({
      ...asset,
      url: "", // La URL firmada se solicita solo al abrir/mostrar el original.
      productName: asset.productName || "",
      contentHash: asset.contentHash || "",
      notes: asset.notes || "",
      generationMeta: asset.generationMeta || {},
      productionProfile: asset.productionProfile ? adaptAgencyRow(asset.productionProfile) : null,
    }));
  }
  if (Array.isArray(data.marketingGuiones)) {
    data.marketingGuiones = data.marketingGuiones.map((script) => ({
      ...script,
      duracion: script.duracionSeg ? `${script.duracionSeg} seg` : "",
      escena1: script.escenas?.[0] || "",
      escena2: script.escenas?.[1] || "",
      escena3: script.escenas?.[2] || "",
      escena4: script.escenas?.[3] || "",
    }));
  }

  return {
    scope,
    sourceVersion,
    eventId: String(snapshot.event_id || ""),
    serverTime: String(snapshot.server_time || ""),
    privacy: snapshot.privacy,
    authority: snapshot.authority,
    data,
  };
}

export function adaptAgencyOperationalFactsEnvelope(snapshot) {
  if (!snapshot || typeof snapshot !== "object"
      || Number(snapshot.version) !== 1
      || snapshot.contract !== "momos-agency-operational-facts/v1") {
    throw new Error("Los hechos operativos de Agencia no tienen una versión compatible.");
  }
  const sourceVersion = normalizeAgencySnapshotVersion(snapshot.source_version);
  const allowedRoles = snapshot.authority?.allowed_roles;
  const privacy = snapshot.privacy || {};
  if (!sourceVersion
      || snapshot.authority?.read_only !== true
      || snapshot.authority?.external_execution !== false
      || snapshot.authority?.human_approval_required !== true
      || !Array.isArray(allowedRoles)
      || allowedRoles.join("|") !== "Administrador|Marketing/CRM"
      || privacy.projection !== "agency-operational-facts-v1"
      || privacy.customer_records_projected !== false
      || privacy.order_records_projected !== false
      || privacy.free_text_projected !== false
      || privacy.secrets_projected !== false
      || privacy.storage_references_projected !== false) {
    throw new Error("Los hechos operativos de Agencia perdieron privacidad o autoridad de solo lectura.");
  }
  const payloadKeys = Object.keys(snapshot.payload || {});
  const facts = normalizeAgencyOperationalFacts(snapshot.payload?.agency_operational_facts);
  if (payloadKeys.length !== 1 || payloadKeys[0] !== "agency_operational_facts" || !facts) {
    throw new Error("Los hechos operativos de Agencia son incompatibles o incompletos.");
  }
  return {
    sourceVersion,
    serverTime: String(snapshot.server_time || ""),
    eventId: String(snapshot.event_id || ""),
    data: { agencyOperationalFacts: facts },
  };
}

export function adaptAgencySnapshotsBundle(bundle) {
  const bundleVersion = Number(bundle?.version);
  const sourceVersion = normalizeAgencySnapshotVersion(bundle?.source_version);
  const rawSnapshots = bundle?.snapshots;
  if (!bundle || ![1, 2].includes(bundleVersion)
      || !sourceVersion || !Array.isArray(rawSnapshots)
      || rawSnapshots.length !== AGENCY_SNAPSHOT_SCOPES.length) {
    throw new Error("El bundle de Agencia no tiene una versión compatible.");
  }
  if (bundleVersion === 2 && bundle.contract !== "momos-agency-snapshots/v2") {
    throw new Error("El bundle H67 de Agencia no tiene el contrato esperado.");
  }
  const adapted = rawSnapshots.map(adaptAgencySnapshotEnvelope);
  const byScope = new Map();
  adapted.forEach((snapshot) => {
    if (byScope.has(snapshot.scope)) throw new Error("El bundle de Agencia contiene alcances duplicados.");
    byScope.set(snapshot.scope, snapshot);
  });
  const keys = [...byScope.keys()].sort();
  if (keys.join("|") !== [...AGENCY_SNAPSHOT_SCOPES].sort().join("|")) {
    throw new Error("El bundle de Agencia no contiene los cuatro alcances cerrados.");
  }
  const snapshots = AGENCY_SNAPSHOT_SCOPES.map((scope) => {
    const snapshot = byScope.get(scope);
    if (snapshot.scope !== scope || snapshot.sourceVersion !== sourceVersion) {
      throw new Error("Los alcances de Agencia no comparten la misma versión de fuente.");
    }
    return snapshot;
  });
  let agencyOperationalFacts = null;
  if (bundleVersion === 2) {
    const adaptedFacts = adaptAgencyOperationalFactsEnvelope(bundle.agency_operational_facts);
    if (adaptedFacts.sourceVersion !== sourceVersion
        || adaptedFacts.serverTime !== String(bundle.server_time || "")) {
      throw new Error("Los hechos operativos no comparten el corte atómico de Agencia.");
    }
    agencyOperationalFacts = adaptedFacts.data.agencyOperationalFacts;
  }
  return {
    version: bundleVersion,
    sourceVersion,
    serverTime: String(bundle.server_time || ""),
    snapshots,
    agencyOperationalFacts,
  };
}

export async function fetchAgencySnapshot(scope = "overview") {
  const normalized = String(scope || "").trim().toLowerCase();
  if (!AGENCY_SNAPSHOT_SCOPES.includes(normalized)) throw new Error("El alcance de Agencia no es válido.");
  const result = await supabase.rpc("momos_agency_snapshot_v1", { p_scope: normalized });
  const missing = result.error && (result.error.code === "PGRST202"
    || /could not find the function|schema cache/i.test(result.error.message || ""));
  if (missing) return null;
  if (result.error) throw new Error(result.error.message);
  return adaptAgencySnapshotEnvelope(result.data);
}

export async function fetchAgencySnapshotBundle() {
  const preferred = await callAgencySnapshotRpc("momos_agency_snapshots_v2");
  const v2Failure = agencySnapshotRpcFailure(preferred);
  if (v2Failure.kind === "none") {
    const bundle = adaptAgencySnapshotsBundle(preferred.data);
    if (bundle.version !== 2) throw new Error("El endpoint H67 de Agencia no devolvio el contrato V2 esperado.");
    return bundle;
  }
  if (!["missing", "transient"].includes(v2Failure.kind)) {
    throwAgencySnapshotRpcFailure("momos_agency_snapshots_v2", v2Failure);
  }

  // Ventana de despliegue: el frontend H67 puede convivir con H66 hasta que
  // la migración sea aplicada. Una vez instalada V2, la ruta normal vuelve a
  // ser exactamente un RPC.
  const fallback = await callAgencySnapshotRpc("momos_agency_snapshots_v1");
  const v1Failure = agencySnapshotRpcFailure(fallback);
  if (v1Failure.kind === "none") {
    const bundle = adaptAgencySnapshotsBundle(fallback.data);
    if (bundle.version !== 1) throw new Error("El endpoint H66 de Agencia no devolvio el contrato V1 esperado.");
    return {
      ...bundle,
      fallbackReason: v2Failure.kind === "transient" ? "h67-transient" : "h67-not-installed",
    };
  }
  if (v1Failure.kind === "missing" && v2Failure.kind === "missing") return null;
  if (v2Failure.kind === "transient" && v1Failure.kind === "missing") {
    throwAgencySnapshotRpcFailure("momos_agency_snapshots_v2", v2Failure);
  }
  throwAgencySnapshotRpcFailure("momos_agency_snapshots_v1", v1Failure);
}

export async function fetchAgencySnapshots(scopes = AGENCY_SNAPSHOT_SCOPES) {
  const requested = [...new Set((scopes || []).map((scope) => String(scope || "").trim().toLowerCase()))];
  if (!requested.length || requested.some((scope) => !AGENCY_SNAPSHOT_SCOPES.includes(scope))) {
    throw new Error("Los alcances de Agencia no son válidos.");
  }

  // Un RPC H67 entrega una fotografía transaccional de los cuatro scopes y
  // los hechos compactos. Durante el despliegue conserva el bundle H66.
  const bundle = await fetchAgencySnapshotBundle();
  if (!bundle) return null;
  const snapshots = bundle.snapshots.filter((snapshot) => requested.includes(snapshot.scope));
  return {
    ...Object.assign({}, ...snapshots.map((snapshot) => snapshot.data)),
    ...(bundle.agencyOperationalFacts ? { agencyOperationalFacts: bundle.agencyOperationalFacts } : {}),
    agencySnapshotVersion: bundle.sourceVersion,
    agencySnapshotFallback: String(bundle.fallbackReason || ""),
    agencySnapshotScopes: Object.fromEntries(snapshots.map((snapshot) => [snapshot.scope, {
      sourceVersion: snapshot.sourceVersion,
      eventId: snapshot.eventId,
      serverTime: snapshot.serverTime,
      privacy: snapshot.privacy,
      authority: snapshot.authority,
    }])),
  };
}

// Loader exclusivo del dominio Agency. No vuelve a leer products, inventario,
// usuarios ni recetas: el coordinador ya mantiene esos maestros en CATALOGS.
// Con H67 instalado hace exactamente un RPC atómico; durante el rollout usa
// H66 y, si tampoco existe, conserva el fallback legado sin vaciar el estado.
export async function fetchAgencyCatalogos() {
  const agency = await fetchAgencySnapshots();
  if (!agency) return null;
  const scopeMeta = Object.values(agency.agencySnapshotScopes || {});
  const serverTimes = scopeMeta.map((item) => String(item?.serverTime || "")).filter(Boolean).sort();
  return {
    ...agency,
    agencySnapshotReady: true,
    agencyOperationalFactsReady: hasAgencyOperationalFacts(agency.agencyOperationalFacts),
    // runtime-telemetry clasifica por prefijo para no acoplarse a cada
    // versión del contrato. Mantener `snapshot-` primero evita reportar una
    // lectura atómica H66 como fuente desconocida.
    syncSource: "snapshot-agency-v1",
    syncSourceVersion: agency.agencySnapshotVersion,
    syncServerTime: serverTimes.at(-1) || "",
  };
}

// Cierre de rollout: si H67 y H66 aún no existen, el loader legado se invoca
// con skipAgencySnapshot para impedir un probe adicional dentro de fetchCatalogos.
export async function fetchAgencyCatalogosConFallback(
  legacyLoader = () => fetchCatalogos({ includeAgency: true, skipAgencySnapshot: true }),
) {
  const snapshots = await fetchAgencyCatalogos();
  return snapshots || legacyLoader();
}

export async function fetchAgencySnapshotEventVersion() {
  const { data, error } = await supabase
    .from("agency_snapshot_events")
    .select("version")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeAgencySnapshotVersion(data?.version);
}

async function multipleRolesCapability() {
  const result = await capabilityResult("roles_multiples_disponible");
  const missing = result.error && (result.error.code === "PGRST202"
    || /could not find the function|schema cache/i.test(result.error.message || ""));
  if (result.error && !missing) throw new Error(result.error.message);
  return !missing && result.data === true;
}

async function inventoryDeltasCapability() {
  const manifest = await fetchSyncManifest();
  const advertised = manifest?.capabilities?.inventario_deltas_disponibles === true;
  return {
    ready: advertised,
    latestEventId: advertised
      ? normalizeInventoryCursorToken(manifest?.inventory_latest_event_id)
      : "",
  };
}

export async function fetchInventoryDeltas(itemIds) {
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  if (!ids.length || ids.length > 50) throw new Error("La conciliación dirigida de Inventario requiere entre 1 y 50 insumos.");
  const { data, error } = await supabase.rpc("momos_inventory_deltas_v1", { p_item_ids: ids });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchInventoryDeltasSince(afterEventId = "", limit = 100) {
  const version = normalizeInventoryCursorToken(afterEventId);
  const { data, error } = await supabase.rpc("momos_inventory_deltas_since_v1", {
    p_after_event_id: version || "0",
    p_limit: Math.min(100, Math.max(1, Number(limit) || 100)),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchOrderDeltas(orderIds) {
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  if (!ids.length || ids.length > 50) {
    throw new Error("La conciliación dirigida de Pedidos requiere entre 1 y 50 órdenes.");
  }
  const { data, error } = await supabase.rpc("momos_order_deltas_v1", { p_order_ids: ids });
  if (error) {
    const next = new Error(error.message || "No se pudo actualizar la comanda.");
    if (error.code) next.code = error.code;
    throw next;
  }
  return normalizeOrderDeltaBatch(data);
}

export async function fetchFinishedInventoryDeltas(productIds) {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  if (!ids.length || ids.length > 20) {
    throw new Error("La conciliación dirigida de producto terminado requiere entre 1 y 20 productos.");
  }
  const { data, error } = await supabase.rpc("momos_finished_inventory_deltas_v1", { p_product_ids: ids });
  if (error) {
    const next = new Error(error.message || "No se pudo actualizar el producto terminado.");
    if (error.code) next.code = error.code;
    throw next;
  }
  return normalizeFinishedInventoryDeltaBatch(data);
}

export async function fetchUserProfile(authUserId) {
  const multipleRolesReady = await multipleRolesCapability();
  const columns = multipleRolesReady ? "id,nombre,rol,roles,activo" : "id,nombre,rol,activo";
  const { data, error } = await supabase.from("users").select(columns).eq("auth_id", authUserId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { ...data, roles: multipleRolesReady && Array.isArray(data.roles) ? data.roles : [data.rol], multipleRolesReady };
}

export async function fetchEvidenceSignedUrl(storagePath) {
  const path = String(storagePath || "").trim();
  if (!path || path.includes("..") || path.startsWith("/") || path.includes("\\")) {
    throw new Error("La evidencia no tiene una ruta privada valida.");
  }
  const { data, error } = await supabase.storage.from("evidencias").createSignedUrl(path, 60 * 15);
  if (error || !data?.signedUrl) throw new Error(error?.message || "No se pudo abrir la evidencia.");
  return data.signedUrl;
}

export async function fetchBrandAssetSignedUrl(storagePath) {
  const path = String(storagePath || "").trim();
  if (!path || path.startsWith("/") || /(^|[\\/])\.\.([\\/]|$)/.test(path)) {
    throw new Error("El archivo creativo no tiene una ruta privada valida.");
  }
  const { data, error } = await supabase.storage.from("brand-assets").createSignedUrl(path, 60 * 30);
  if (error || !data?.signedUrl) throw new Error(error?.message || "No se pudo abrir el archivo creativo.");
  return data.signedUrl;
}

export async function fetchOperationalHistoryPage(cursor = null, limit = 50) {
  const { data, error } = await supabase.rpc("momos_history_page_v1", {
    p_cursor: cursor || null,
    p_limit: Math.min(50, Math.max(1, Number(limit) || 50)),
  });
  if (error) throw new Error(error.message);
  return {
    rows: (data?.rows || []).map((row) => ({
      id: row.id, fecha: tsBogota(row.fecha), user: nz(row.user), entidad: row.entidad,
      entidadId: nz(row.entidad_id), accion: row.accion, de: nz(row.de), a: nz(row.a),
    })),
    cursor: data?.next_cursor || null,
  };
}

export async function fetchFinancialFacts(from, to) {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDate.test(String(from || "")) || !isoDate.test(String(to || "")) || from > to) throw new Error("El rango financiero no es válido.");
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 367) throw new Error("El rango financiero no puede superar 367 días.");
  const { data, error } = await supabase.rpc("momos_financial_facts_v1", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchCatalogos(options = {}) {
  const includeAgency = options.includeAgency !== false;
  const skipAgencySnapshot = options.skipAgencySnapshot === true;
  const [multipleRolesReady, inventoryDeltaCapability] = await Promise.all([
    multipleRolesCapability(), inventoryDeltasCapability(),
  ]);
  const userColumns = multipleRolesReady ? "id,nombre,email,rol,roles,activo" : "id,nombre,email,rol,activo";
  const coreSnapshot = includeAgency ? null : await optionalSnapshot("momos_core_snapshot_v1");
  const coreKeys = [
    "products", "combo_components", "inventory_items", "recipes", "users", "toppings", "figuras",
    "catalog_values", "zonas", "proveedores_domicilio", "brand_library", "app_settings", "subrecetas",
    "subreceta_ingredientes", "figura_relleno",
  ];
  const q = coreSnapshot ? [
    ...coreKeys.map((key) => ({ data: key === "brand_library" ? (coreSnapshot[key] || null) : (coreSnapshot[key] || []), error: null })),
    { data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null },
  ] : await Promise.all([
    supabase.from("products").select("id,nombre,cat,tipo,especie,precio,precio_rappi,costo,stock,prep,frio,lejano,activo,descr,combo_size,empaque_item_id,colchon_produccion").order("id"),
    supabase.from("combo_components").select("combo_id,component_id").order("component_id"),
    supabase.from("inventory_items").select("id,nombre,cat,unidad,stock,minimo,costo,proveedor,vence,ubicacion,compra,costo_estimado").order("id"),
    supabase.from("recipes").select("id,product_id,item_id,cantidad").order("id"),
    supabase.from("users").select(userColumns).order("id"),
    supabase.from("toppings").select("nombre,precio,insumo_id,insumo_cant").eq("activo", true).order("orden"),
    supabase.from("figuras").select("nombre,especie,gramaje_g,product_id,activo").order("orden"),
    supabase.from("catalog_values").select("categoria,valor").eq("activo", true).order("orden"),
    supabase.from("zonas").select("nombre,tarifa").order("nombre"),
    supabase.from("proveedores_domicilio").select("nombre").eq("activo", true).order("orden"),
    supabase.from("brand_library").select("frases,tono,palabras_si,palabras_no").limit(1).maybeSingle(),
    supabase.from("app_settings").select("clave,valor"),
    supabase.from("subrecetas").select("id,nombre,tipo,sabor,merma_pct,rinde_g,item_id,activo").order("id"),
    supabase.from("subreceta_ingredientes").select("subreceta_id,item_id,cantidad").order("subreceta_id"),
    supabase.from("figura_relleno").select("id,subreceta_id,gramos_por_unidad,activo").order("id"),
    includeAgency ? supabase.from("campaigns").select("id,nombre,canal,objetivo,producto_foco_id,oferta,fecha_inicio,fecha_fin,presupuesto,gasto_real,estado,responsable,notas").order("id", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    includeAgency ? supabase.from("creatives").select("id,campaign_id,titulo,canal,formato,producto_foco_id,figura,sabor,hook,copy,guion,estado,responsable,fecha_entrega,asset_url,notas,external_id,generacion").order("id", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    includeAgency ? supabase.from("content_posts").select("id,fecha,hora,canal,campaign_id,creative_id,titulo,copy_final,estado,url_publicacion,external_post_id,notas").order("fecha", { ascending: false }).order("hora", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    includeAgency ? supabase.from("metrics_daily").select("id,fecha,fuente,campaign_id,creative_id,post_id,impresiones,alcance,clicks,mensajes_wa,gasto,notas").order("fecha", { ascending: false }).order("id", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
  ]);
  const conError = q.find((r) => r.error);
  if (conError) throw new Error(conError.error.message);
  const [prods, combos, items, recs, usrs, tops, figs, cats, zons, provs, brandRes, appSet, subrs, subrIngs, figRell, camps, creativeRows, postRows, metricRows] = q.map((r) => r.data);

  const productReadyResult = await capabilityResult("productos_servidor_disponible");
  const productProbeMissing = productReadyResult.error &&
    (productReadyResult.error.code === "PGRST202" || /could not find the function|schema cache/i.test(productReadyResult.error.message || ""));
  if (productReadyResult.error && !productProbeMissing) throw new Error(productReadyResult.error.message);
  const productsServerReady = !productProbeMissing && productReadyResult.data === true;

  const lotsResult = coreSnapshot
    ? { data: coreSnapshot.inventory_lots || [], error: null }
    : await supabase
      .from("v_inventory_lots")
      .select("id,item_id,item_name,unidad,received_at,expires_at,initial_quantity,available_quantity,unit_cost,supplier,location,origin,status")
      .order("item_id").order("expires_at", { ascending: true, nullsFirst: false }).order("received_at");
  const lotsMissing = lotsResult.error && ["42P01", "PGRST205"].includes(lotsResult.error.code);
  if (lotsResult.error && !lotsMissing) throw new Error(lotsResult.error.message);
  const lotRows = lotsMissing ? [] : (lotsResult.data || []);

  // RLS deny-by-default devuelve VACÍO (no error): un catálogo estructural vacío = algo anda mal,
  // mejor quedarse con la caché local que pisar el db con arrays vacíos.
  // (toppings/proveedores/brand_library quedan afuera: pueden vaciarse legítimamente desde la UI.)
  const vacias = [];
  if (!prods.length) vacias.push("products");
  if (!items.length) vacias.push("inventory_items");
  if (!usrs.length) vacias.push("users");
  if (!recs.length) vacias.push("recipes");
  if (!figs.length) vacias.push("figuras");
  if (!cats.length) vacias.push("catalog_values");
  if (!zons.length) vacias.push("zonas");
  if (!appSet.length) vacias.push("app_settings");
  if (prods.some((p) => p.tipo === "combo") && !combos.length) vacias.push("combo_components");
  if (vacias.length) {
    throw new Error("Catálogos vacíos desde el servidor (" + vacias.join(", ") + ") — posible RLS; se mantiene la caché local");
  }

  const componentesDe = {};
  combos.forEach((c) => { (componentesDe[c.combo_id] = componentesDe[c.combo_id] || []).push(c.component_id); });

  const products = prods.map((p) => ({
    id: p.id, nombre: p.nombre, cat: p.cat, tipo: p.tipo,
    especie: p.especie ?? undefined,
    precio: p.precio, precioRappi: p.precio_rappi ?? Math.round(p.precio * 1.25), costo: p.costo,
    stock: p.stock ?? undefined,
    prep: p.prep, frio: p.frio, lejano: p.lejano, activo: p.activo,
    desc: nz(p.descr),
    // Variantes 3: colchón de sobre-producción por producto (advisory).
    colchonProduccion: p.colchon_produccion ?? 0,
    // atributos NO se hidrata: normalizeDbShape lo deriva SIEMPRE de tipo
    ...(p.tipo === "combo" ? {
      comboSize: p.combo_size ?? undefined,
      componentProductIds: componentesDe[p.id] || [],
      empaqueItem: nz(p.empaque_item_id),
    } : {}),
  }));

  const inventory_items = items.map((i) => ({
    id: i.id, nombre: i.nombre, cat: i.cat, unidad: i.unidad,
    stock: i.stock, min: i.minimo, costo: i.costo,
    proveedor: nz(i.proveedor), vence: nz(i.vence), ubicacion: nz(i.ubicacion), compra: nz(i.compra),
    costoEstimado: !!i.costo_estimado, // marca "corregir con compra real" (Componentes+BOM)
  }));
  const inventory_lots = lotRows.map((lot) => ({
    id: lot.id, itemId: lot.item_id, itemName: lot.item_name, unit: lot.unidad,
    receivedAt: nz(lot.received_at), expiresAt: nz(lot.expires_at),
    initialQuantity: Number(lot.initial_quantity), available: Number(lot.available_quantity),
    unitCost: Number(lot.unit_cost), supplier: nz(lot.supplier), location: nz(lot.location),
    origin: lot.origin, status: lot.status,
  }));
  const inventoryCoreSnapshotReady = inventoryCoreSnapshotBlockIsComplete(coreSnapshot);
  const inventorySnapshotHistoryReady = inventoryCoreSnapshotReady;
  const inventorySnapshotMovements = inventorySnapshotHistoryReady
    ? coreSnapshot.inventory_movements.map((movement) => {
      const item = inventory_items.find((candidate) => candidate.id === movement.item_id);
      const quantity = Number(movement.cant);
      return {
        id: String(movement.id),
        fecha: tsBogota(movement.fecha),
        tipo: movement.tipo,
        item: item?.nombre || "",
        cant: `${quantity > 0 ? "+" : ""}${quantity} ${item?.unidad || ""}`.trim(),
      };
    })
    : [];
  const inventorySnapshotAudits = inventorySnapshotHistoryReady
    ? coreSnapshot.inventory_audit_logs.map((audit) => ({
      id: String(audit.id),
      fecha: tsBogota(audit.fecha),
      entidad: audit.entidad,
      entidadId: nz(audit.entidad_id),
      accion: audit.accion,
    }))
    : [];

  const recipes = recs.map((r) => ({ id: r.id, productId: r.product_id, itemId: r.item_id, cantidad: r.cantidad }));

  const users = usrs.map((u) => ({
    id: u.id, nombre: u.nombre, email: u.email, rol: u.rol,
    roles: multipleRolesReady && Array.isArray(u.roles) ? u.roles : [u.rol], activo: u.activo,
  }));

  const porCat = {};
  cats.forEach((c) => { (porCat[c.categoria] = porCat[c.categoria] || []).push(c.valor); });
  const setting = {};
  appSet.forEach((s) => { setting[s.clave] = s.valor; });

  const settingsCatalogos = {
    zonas: zons.map((z) => ({ nombre: z.nombre, tarifa: Number(z.tarifa) })),
    saboresFrutales: porCat.sabor_frutal || [],
    saboresCremosos: porCat.sabor_cremoso || [],
    salsas: porCat.salsa || [],
    pagos: porCat.pago || [],
    toppings: tops.map((t) => ({ nombre: t.nombre, precio: Number(t.precio), insumoId: nz(t.insumo_id), insumoCant: Number(t.insumo_cant) })),
    figuras: figs.filter((f) => f.activo).map((f) => ({ nombre: f.nombre, especie: f.especie, gramaje: f.gramaje_g != null ? `${f.gramaje_g} g` : "" })),
    proveedores: provs.map((p) => p.nombre),
    pedidoMinimo: Number(setting.pedido_minimo ?? 25000),
    pautaMensual: Number(setting.pauta_mensual ?? 350000),
    horasCongelacion: Number(setting.horas_congelacion ?? 10),
    demoraCocinaMin: Number(setting.demora_cocina_min ?? 15),
    demoraCocinaUrgenteMin: Number(setting.demora_cocina_urgente_min ?? 30),
    demoraEmpaqueMin: Number(setting.demora_empaque_min ?? 10),
    demoraEmpaqueUrgenteMin: Number(setting.demora_empaque_urgente_min ?? 20),
    demoraRepeticionMin: Number(setting.demora_repeticion_min ?? 5),
    politicas: String(setting.politicas ?? ""),
  };
  if (setting.relleno_fijo) settingsCatalogos.rellenos = [String(setting.relleno_fijo)];

  const brand_library = brandRes ? {
    frases: Array.isArray(brandRes.frases) ? brandRes.frases : [],
    tono: Array.isArray(brandRes.tono) ? brandRes.tono : (brandRes.tono ? [String(brandRes.tono)] : []),
    palabrasSi: Array.isArray(brandRes.palabras_si) ? brandRes.palabras_si : [],
    palabrasNo: Array.isArray(brandRes.palabras_no) ? brandRes.palabras_no : [],
  } : null;

  // Producción v2: hidratación completa de la tabla figuras (activas e inactivas,
  // con product_id/gramaje_g numérico) para el grid de figuras del form de Producción.
  // settingsCatalogos.figuras arriba sigue igual (solo activas, gramaje en texto) para no romper otros consumidores.
  const figuras = figs.map((f) => ({ nombre: f.nombre, especie: f.especie, gramajeG: f.gramaje_g ?? null, productId: nz(f.product_id), activo: f.activo }));

  // Componentes + BOM (hito 2): bases/subrecetas, su receta por 1000 g y el relleno
  // configurable de figuras. Vacío es legítimo en bases sin migración — sin guard.
  const subrecetas = (subrs || []).map((sr) => ({
    id: sr.id, nombre: sr.nombre, tipo: sr.tipo, sabor: nz(sr.sabor),
    mermaPct: Number(sr.merma_pct), rindeG: Number(sr.rinde_g), itemId: sr.item_id, activo: sr.activo,
  }));
  const subreceta_ingredientes = (subrIngs || []).map((r) => ({ subrecetaId: r.subreceta_id, itemId: r.item_id, cantidad: Number(r.cantidad) }));
  const figura_relleno = (figRell || []).map((f) => ({ id: f.id, subrecetaId: f.subreceta_id, gramosPorUnidad: Number(f.gramos_por_unidad), activo: f.activo }));

  // Marketing Hito 2: campaigns desde el server. productoFoco se hidrata como NOMBRE
  // (el front lo usa por nombre en el Select y en stockProductoFoco); productoFocoId
  // conserva el id crudo. Vacío es LEGÍTIMO (marketing sin campañas) — sin guard.
  const nombreProd = {}; prods.forEach((p) => { nombreProd[p.id] = p.nombre; });
  const campaigns = (camps || []).map((c) => ({
    id: c.id, nombre: c.nombre, canal: c.canal, objetivo: c.objetivo,
    productoFocoId: nz(c.producto_foco_id, null),
    productoFoco: c.producto_foco_id ? (nombreProd[c.producto_foco_id] || "") : "",
    oferta: nz(c.oferta), fechaInicio: nz(c.fecha_inicio), fechaFin: nz(c.fecha_fin),
    presupuesto: Number(c.presupuesto || 0), gastoReal: Number(c.gasto_real || 0),
    estado: c.estado, responsable: nz(c.responsable), notas: nz(c.notas),
  }));

  // Marketing contenido v1: los tres arrays conservan el shape legado para
  // reducir la superficie del front, pero la fuente ya es Supabase. Igual que
  // campaigns, productoFoco expone nombre para la UI + id crudo para round-trip.
  const creatives = (creativeRows || []).map((c) => ({
    id: c.id, campaignId: nz(c.campaign_id), titulo: c.titulo, canal: c.canal, formato: c.formato,
    productoFocoId: nz(c.producto_foco_id, null),
    productoFoco: c.producto_foco_id ? (nombreProd[c.producto_foco_id] || "") : "",
    figuraFoco: nz(c.figura), saborFoco: nz(c.sabor), hook: nz(c.hook), copy: nz(c.copy),
    guion: nz(c.guion), estado: c.estado, responsable: nz(c.responsable),
    fechaEntrega: nz(c.fecha_entrega), assetUrl: nz(c.asset_url), notas: nz(c.notas),
    externalId: nz(c.external_id), generacion: c.generacion || null,
  }));
  const content_calendar = (postRows || []).map((p) => ({
    id: p.id, fecha: p.fecha, hora: hhmm(p.hora), canal: p.canal,
    campaignId: nz(p.campaign_id), creativeId: nz(p.creative_id), titulo: p.titulo,
    copyFinal: nz(p.copy_final), estado: p.estado, urlPublicacion: nz(p.url_publicacion),
    externalPostId: nz(p.external_post_id), notas: nz(p.notas),
  }));
  const creative_results = (metricRows || []).map((m) => ({
    id: String(m.id), fecha: m.fecha, fuente: m.fuente,
    campaignId: nz(m.campaign_id), creativeId: nz(m.creative_id), postId: nz(m.post_id),
    impresiones: Number(m.impresiones), alcance: Number(m.alcance), clicks: Number(m.clicks),
    mensajesWhatsApp: Number(m.mensajes_wa), gasto: Number(m.gasto), notas: nz(m.notas),
  }));

  const atomicInventoryBoundary = normalizeInventoryCursorToken(coreSnapshot?.inventory_latest_event_id);
  const inventoryDeltaReady = inventoryDeltaCapability.ready
    && inventoryCoreSnapshotReady;
  const coreCatalogs = {
    products, productsServerReady, inventory_items, inventory_lots,
    inventoryLotsReady: !lotsMissing, recipes, users, multipleRolesReady,
    inventoryMutationDeltaReady: inventoryDeltaReady,
    inventoryCoreSnapshotReady,
    inventorySnapshotHistoryReady,
    inventorySnapshotMovements,
    inventorySnapshotAudits,
    // H70: items, lotes, histories sanitizados y cursor pertenecen al mismo
    // snapshot MVCC. Una base H69 sin el bloque completo degrada al refresco
    // legacy; el manifiesto nunca puede sellar colecciones leidas aparte.
    inventoryMutationEventVersion: inventoryDeltaReady ? atomicInventoryBoundary : "",
    settingsCatalogos, brand_library, figuras, subrecetas,
    subreceta_ingredientes, figura_relleno,
    syncSource: coreSnapshot ? "snapshot-v1" : "legacy-queries",
    syncServerTime: coreSnapshot?.server_time || "",
  };
  if (!includeAgency) return coreCatalogs;

  // H66: un bundle atómico con cuatro scopes sustituye el fan-out de Agencia. El
  // bloque legado inferior permanece como fallback forward-compatible hasta
  // que la migración esté instalada en todos los entornos.
  const agencySnapshots = skipAgencySnapshot ? null : await fetchAgencyCatalogos();
  if (agencySnapshots) return {
    ...coreCatalogs,
    campaigns,
    creatives,
    content_calendar,
    creative_results,
    ...agencySnapshots,
    syncSource: "agency-snapshot-v1",
  };

  // Agencia Comercial v1 se hidrata de forma opcional durante el rollout de la
  // migración 16. Antes de aplicarla, Crecimiento conserva su biblioteca local.
  const agencyProbe = await capabilityResult("agencia_comercial_disponible");
  const agencyProbeMissing = agencyProbe.error &&
    (agencyProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(agencyProbe.error.message || ""));
  if (agencyProbe.error && !agencyProbeMissing) throw new Error(agencyProbe.error.message);
  const agencyServerReady = !agencyProbeMissing && agencyProbe.data === true;
  let agencySettings = null; let agencyBriefs = []; let agencyDecisions = []; let agencyCreativeVersions = [];
  let marketingIdeas = null; let marketingGuiones = null; let marketingMensajes = null; let marketingTasks = null;
  if (agencyServerReady) {
    const agencyResults = await Promise.all([
      supabase.from("agency_settings").select("autonomy_mode,daily_budget_limit,campaign_budget_limit,scale_step_pct,require_creative_approval,block_out_of_stock,contact_only_authorized,paused,updated_by,updated_at").eq("id", true).maybeSingle(),
      supabase.from("agency_briefs").select("id,decision_key,title,objective,campaign_id,product_id,crm_segment,offer,channel,deliverables,insight,evidence,status,proposed_budget,approved_budget,stock_snapshot,created_by,approved_by,created_at,approved_at,updated_at,notes").order("created_at", { ascending: false }).limit(100),
      supabase.from("agency_decisions").select("id,brief_id,campaign_id,creative_id,type,title,rationale,evidence,proposed_action,risk_level,status,author,created_by,approved_by,executed_by,created_at,approved_at,executed_at,result").order("created_at", { ascending: false }).limit(100),
      supabase.from("agency_creative_versions").select("id,creative_id,brief_id,version,provider,prompt,negative_prompt,brand_snapshot,asset_url,thumbnail_url,status,feedback,generation_cost,created_by,reviewed_by,created_at,reviewed_at").order("created_at", { ascending: false }).limit(100),
      supabase.from("marketing_ideas").select("id,titulo,cat,objetivo,producto_sugerido_id,copy,guion_corto,canal,estado,autor").order("id", { ascending: false }).limit(100),
      supabase.from("marketing_guiones").select("id,titulo,duracion_seg,producto_foco_id,objetivo,dificultad,escenas,texto_pantalla,audio,autor").order("id", { ascending: false }).limit(100),
      supabase.from("marketing_mensajes").select("id,tipo,texto").order("id"),
      supabase.from("marketing_tasks").select("id,tarea,fecha,estado,responsable,origen,recommendation_id").order("fecha", { ascending: false }).limit(100),
    ]);
    const agencyError = agencyResults.find((result) => result.error);
    if (agencyError) throw new Error(agencyError.error.message);
    const [settingsRow, briefRows, decisionRows, versionRows, ideaRows, guionRows, messageRows, taskRows] = agencyResults.map((result) => result.data);
    agencySettings = settingsRow ? {
      autonomyMode: settingsRow.autonomy_mode, dailyBudgetLimit: Number(settingsRow.daily_budget_limit),
      campaignBudgetLimit: Number(settingsRow.campaign_budget_limit), scaleStepPct: Number(settingsRow.scale_step_pct),
      requireCreativeApproval: settingsRow.require_creative_approval, blockOutOfStock: settingsRow.block_out_of_stock,
      contactOnlyAuthorized: settingsRow.contact_only_authorized, paused: settingsRow.paused,
      updatedBy: nz(settingsRow.updated_by), updatedAt: tsBogota(settingsRow.updated_at),
    } : null;
    agencyBriefs = briefRows.map((row) => ({
      id: row.id, decisionKey: nz(row.decision_key), title: row.title, objective: row.objective,
      campaignId: nz(row.campaign_id), productId: nz(row.product_id), crmSegment: nz(row.crm_segment),
      offer: nz(row.offer), channel: row.channel, deliverables: row.deliverables || [], insight: nz(row.insight),
      evidence: row.evidence || {}, status: row.status, proposedBudget: Number(row.proposed_budget),
      approvedBudget: row.approved_budget == null ? null : Number(row.approved_budget), stockSnapshot: row.stock_snapshot == null ? null : Number(row.stock_snapshot),
      createdBy: row.created_by, approvedBy: nz(row.approved_by), createdAt: tsBogota(row.created_at),
      approvedAt: tsBogota(row.approved_at), updatedAt: tsBogota(row.updated_at), notes: nz(row.notes),
    }));
    agencyDecisions = decisionRows.map((row) => ({
      id: row.id, briefId: row.brief_id, campaignId: nz(row.campaign_id), creativeId: nz(row.creative_id),
      type: row.type, title: row.title, rationale: row.rationale, evidence: row.evidence || {}, proposedAction: row.proposed_action || {},
      riskLevel: row.risk_level, status: row.status, author: row.author, createdBy: row.created_by,
      approvedBy: nz(row.approved_by), executedBy: nz(row.executed_by), createdAt: tsBogota(row.created_at),
      approvedAt: tsBogota(row.approved_at), executedAt: tsBogota(row.executed_at), result: nz(row.result),
    }));
    agencyCreativeVersions = versionRows.map((row) => ({
      id: row.id, creativeId: row.creative_id, briefId: row.brief_id, version: row.version, provider: row.provider,
      prompt: nz(row.prompt), negativePrompt: nz(row.negative_prompt), brandSnapshot: row.brand_snapshot || {},
      assetUrl: nz(row.asset_url), thumbnailUrl: nz(row.thumbnail_url), status: row.status, feedback: nz(row.feedback),
      generationCost: Number(row.generation_cost), createdBy: row.created_by, reviewedBy: nz(row.reviewed_by),
      createdAt: tsBogota(row.created_at), reviewedAt: tsBogota(row.reviewed_at),
    }));
    marketingIdeas = ideaRows.map((row) => ({ id: row.id, titulo: row.titulo, cat: nz(row.cat), objetivo: nz(row.objetivo),
      productoSugeridoId: nz(row.producto_sugerido_id), productoSugerido: row.producto_sugerido_id ? (nombreProd[row.producto_sugerido_id] || "") : "",
      copy: nz(row.copy), guionCorto: nz(row.guion_corto), canal: nz(row.canal), estado: row.estado, autor: row.autor }));
    marketingGuiones = guionRows.map((row) => ({ id: row.id, titulo: row.titulo, duracion: row.duracion_seg ? `${row.duracion_seg} seg` : "",
      productoFocoId: nz(row.producto_foco_id), productoFoco: row.producto_foco_id ? (nombreProd[row.producto_foco_id] || "") : "",
      objetivo: nz(row.objetivo), dificultad: nz(row.dificultad), escenas: row.escenas || [],
      escena1: row.escenas?.[0] || "", escena2: row.escenas?.[1] || "", escena3: row.escenas?.[2] || "", escena4: row.escenas?.[3] || "",
      textoPantalla: nz(row.texto_pantalla), audio: nz(row.audio), autor: row.autor }));
    marketingMensajes = messageRows.map((row) => ({ id: row.id, tipo: row.tipo, texto: row.texto }));
    marketingTasks = taskRows.map((row) => ({ id: row.id, tarea: row.tarea, fecha: row.fecha, estado: row.estado,
      responsable: nz(row.responsable), origen: row.origen, recommendationId: row.recommendation_id }));
  }

  const orchestratorProbe = await capabilityResult("orquestador_agencia_disponible");
  const orchestratorProbeMissing = orchestratorProbe.error &&
    (orchestratorProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(orchestratorProbe.error.message || ""));
  if (orchestratorProbe.error && !orchestratorProbeMissing) throw new Error(orchestratorProbe.error.message);
  const agencyOrchestratorReady = !orchestratorProbeMissing && orchestratorProbe.data === true;
  let agencyAgentRuns = []; let agencyAgentProposals = [];
  if (agencyOrchestratorReady) {
    const [runResult, proposalResult] = await Promise.all([
      supabase.from("agency_agent_runs").select("id,run_key,trigger_type,status,focus,context_snapshot,agent_name,agent_version,requested_by,requested_at,completed_at,error_message").order("requested_at", { ascending: false }).limit(50),
      supabase.from("agency_agent_proposals").select("id,run_id,proposal_key,sealed_payload,payload_fingerprint,status,decision_id,resolved_by,resolved_at,resolution_note,created_at").order("created_at", { ascending: false }).limit(100),
    ]);
    if (runResult.error) throw new Error(runResult.error.message);
    if (proposalResult.error) throw new Error(proposalResult.error.message);
    agencyAgentRuns = (runResult.data || []).map((row) => ({
      id: row.id, runKey: row.run_key, triggerType: row.trigger_type, status: row.status, focus: nz(row.focus),
      contextSnapshot: row.context_snapshot || {}, agentName: row.agent_name, agentVersion: row.agent_version,
      requestedBy: nz(row.requested_by), requestedAt: tsBogota(row.requested_at), completedAt: tsBogota(row.completed_at), errorMessage: nz(row.error_message),
    }));
    agencyAgentProposals = (proposalResult.data || []).map((row) => {
      const payload = row.sealed_payload || {};
      return {
        id: row.id, runId: row.run_id, proposalKey: row.proposal_key, fingerprint: row.payload_fingerprint,
        status: row.status, decisionId: row.decision_id, resolvedBy: nz(row.resolved_by), resolvedAt: tsBogota(row.resolved_at),
        resolutionNote: nz(row.resolution_note), createdAt: tsBogota(row.created_at), sealedPayload: payload,
        decisionType: payload.decision_type, title: payload.title, rationale: payload.rationale, evidence: payload.evidence || {},
        proposedAction: payload.proposed_action || {}, requiredTools: payload.required_tools || [], confidence: Number(payload.confidence || 0),
        riskLevel: payload.risk_level, estimatedCostCop: Number(payload.estimated_cost_cop || 0), costCapCop: Number(payload.cost_cap_cop || 0),
        executionMode: payload.execution_mode, source: payload.source,
      };
    });
  }

  const actionCenterProbe = await capabilityResult("centro_acciones_agencia_disponible");
  const actionCenterProbeMissing = actionCenterProbe.error &&
    (actionCenterProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(actionCenterProbe.error.message || ""));
  if (actionCenterProbe.error && !actionCenterProbeMissing) throw new Error(actionCenterProbe.error.message);
  const agencyActionQueueReady = !actionCenterProbeMissing && actionCenterProbe.data === true;
  let agencyActionQueue = null;
  if (agencyActionQueueReady) {
    const queueResult = await supabase.rpc("obtener_bandeja_acciones_agencia");
    if (queueResult.error) throw new Error(queueResult.error.message);
    agencyActionQueue = queueResult.data || null;
  }

  const actionOutcomeProbe = await capabilityResult("resultados_acciones_agencia_disponibles");
  const actionOutcomeProbeMissing = actionOutcomeProbe.error &&
    (actionOutcomeProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(actionOutcomeProbe.error.message || ""));
  if (actionOutcomeProbe.error && !actionOutcomeProbeMissing) throw new Error(actionOutcomeProbe.error.message);
  const agencyActionOutcomesReady = !actionOutcomeProbeMissing && actionOutcomeProbe.data === true;
  let agencyActionOutcomes = [];
  if (agencyActionOutcomesReady) {
    const outcomeResult = await supabase.from("agency_action_outcomes")
      .select("id,decision_id,action_code,completion_status,target_decision_status,observed_result,evidence_kind,evidence_id,evidence_snapshot,actual_cost,summary,blocker_code,external_execution,fingerprint,created_by,created_at")
      .order("created_at", { ascending: false }).limit(200);
    if (outcomeResult.error) throw new Error(outcomeResult.error.message);
    agencyActionOutcomes = (outcomeResult.data || []).map((row) => ({
      id: row.id, decisionId: row.decision_id, actionCode: row.action_code, completionStatus: row.completion_status,
      targetDecisionStatus: row.target_decision_status, observedResult: row.observed_result,
      evidenceKind: row.evidence_kind, evidenceId: row.evidence_id, evidence: row.evidence_snapshot || {},
      actualCost: Number(row.actual_cost || 0), summary: row.summary, blockerCode: row.blocker_code,
      externalExecution: Boolean(row.external_execution), fingerprint: row.fingerprint,
      createdBy: row.created_by, createdAt: tsBogota(row.created_at),
    }));
  }

  const collaborationProbe = await capabilityResult("mesa_agencia_disponible");
  const collaborationProbeMissing = collaborationProbe.error &&
    (collaborationProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(collaborationProbe.error.message || ""));
  if (collaborationProbe.error && !collaborationProbeMissing) throw new Error(collaborationProbe.error.message);
  const agencyCollaborationReady = !collaborationProbeMissing && collaborationProbe.data === true;
  let agencyCollaborationRooms = []; let agencyCollaborationEntries = []; let agencyCreativeContracts = [];
  if (agencyCollaborationReady) {
    const [roomResult, entryResult, contractResult] = await Promise.all([
      supabase.from("agency_collaboration_rooms").select("id,room_key,title,objective,status,brief_id,decision_id,context_snapshot,context_fingerprint,created_by,created_at,updated_at").order("updated_at", { ascending: false }).limit(100),
      supabase.from("agency_collaboration_entries").select("id,room_id,entry_key,author_kind,entry_type,body,payload,payload_fingerprint,created_by,agent_name,created_at").order("created_at", { ascending: true }).limit(500),
      supabase.from("agency_creative_contracts").select("id,contract_key,room_id,version,status,sealed_payload,contract_fingerprint,prepared_by,prepared_at,approved_by,approved_at,approval_note,approval_snapshot").order("prepared_at", { ascending: false }).limit(100),
    ]);
    if (roomResult.error) throw new Error(roomResult.error.message);
    if (entryResult.error) throw new Error(entryResult.error.message);
    if (contractResult.error) throw new Error(contractResult.error.message);
    agencyCollaborationRooms = (roomResult.data || []).map((row) => ({
      id: row.id, roomKey: row.room_key, title: row.title, objective: row.objective, status: row.status,
      briefId: row.brief_id, decisionId: row.decision_id, contextSnapshot: row.context_snapshot || {},
      contextFingerprint: row.context_fingerprint, createdBy: row.created_by,
      createdAt: tsBogota(row.created_at), updatedAt: tsBogota(row.updated_at),
    }));
    agencyCollaborationEntries = (entryResult.data || []).map((row) => ({
      id: row.id, roomId: row.room_id, entryKey: row.entry_key, authorKind: row.author_kind,
      entryType: row.entry_type, body: row.body, payload: row.payload || {}, fingerprint: row.payload_fingerprint,
      createdBy: nz(row.created_by), agentName: nz(row.agent_name), createdAt: tsBogota(row.created_at),
    }));
    agencyCreativeContracts = (contractResult.data || []).map((row) => ({
      id: row.id, contractKey: row.contract_key, roomId: row.room_id, version: Number(row.version), status: row.status,
      sealedPayload: row.sealed_payload || {}, fingerprint: row.contract_fingerprint, preparedBy: row.prepared_by,
      preparedAt: tsBogota(row.prepared_at), approvedBy: nz(row.approved_by), approvedAt: tsBogota(row.approved_at),
      approvalNote: nz(row.approval_note), approvalSnapshot: row.approval_snapshot || {},
    }));
  }

  const sceneStudioProbe = await capabilityResult("estudio_escenas_disponible");
  const sceneStudioProbeMissing = sceneStudioProbe.error &&
    (sceneStudioProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(sceneStudioProbe.error.message || ""));
  if (sceneStudioProbe.error && !sceneStudioProbeMissing) throw new Error(sceneStudioProbe.error.message);
  const agencySceneStudioReady = !sceneStudioProbeMissing && sceneStudioProbe.data === true;
  let agencyStoryboards = []; let agencyStoryboardShots = [];
  if (agencySceneStudioReady) {
    const [storyboardResult, shotResult] = await Promise.all([
      supabase.from("agency_storyboards").select("id,storyboard_key,contract_id,version,title,status,channel,format,aspect_ratio,target_duration_sec,creative_brief,retention_plan,source_fingerprint,estimated_cost_cop,created_by,created_at,submitted_by,submitted_at,reviewed_by,reviewed_at,review_note").order("created_at", { ascending: false }).limit(100),
      supabase.from("agency_storyboard_shots").select("id,storyboard_id,shot_number,revision,status,title,purpose,duration_sec,shot_payload,input_asset_ids,estimated_cost_cop,shot_fingerprint,created_by,created_at").order("shot_number", { ascending: true }).limit(1000),
    ]);
    if (storyboardResult.error) throw new Error(storyboardResult.error.message);
    if (shotResult.error) throw new Error(shotResult.error.message);
    agencyStoryboards = (storyboardResult.data || []).map((row) => ({
      id: row.id, storyboardKey: row.storyboard_key, contractId: row.contract_id, version: Number(row.version),
      title: row.title, status: row.status, channel: row.channel, format: row.format, aspectRatio: row.aspect_ratio,
      targetDurationSec: Number(row.target_duration_sec || 0), creativeBrief: row.creative_brief || {},
      retentionPlan: row.retention_plan || {}, fingerprint: row.source_fingerprint,
      estimatedCostCop: Number(row.estimated_cost_cop || 0), createdBy: row.created_by, createdAt: tsBogota(row.created_at),
      submittedBy: nz(row.submitted_by), submittedAt: tsBogota(row.submitted_at), reviewedBy: nz(row.reviewed_by),
      reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note),
    }));
    agencyStoryboardShots = (shotResult.data || []).map((row) => ({
      id: row.id, storyboardId: row.storyboard_id, shotNumber: Number(row.shot_number), revision: Number(row.revision),
      status: row.status, title: row.title, purpose: row.purpose, durationSec: Number(row.duration_sec || 0),
      payload: row.shot_payload || {}, assetIds: row.input_asset_ids || [], estimatedCostCop: Number(row.estimated_cost_cop || 0),
      fingerprint: row.shot_fingerprint, createdBy: row.created_by, createdAt: tsBogota(row.created_at),
    }));
  }

  const motionProbe = await capabilityResult("motion_experience_disponible");
  const motionProbeMissing = motionProbe.error &&
    (motionProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(motionProbe.error.message || ""));
  if (motionProbe.error && !motionProbeMissing) throw new Error(motionProbe.error.message);
  const agencyMotionReady = !motionProbeMissing && motionProbe.data === true;
  let agencyMotionPlans = []; let agencyMotionRecipes = []; let agencyMotionObservations = [];
  if (agencyMotionReady) {
    const [motionPlanResult, motionRecipeResult, motionObservationResult] = await Promise.all([
      supabase.from("agency_motion_plans").select("id,plan_key,storyboard_id,version,status,grammar_primary,grammar_secondary,continuity_ledger,plan_snapshot,plan_fingerprint,estimated_preview_cost_cop,source_kind,prepared_by,prepared_by_agent,prepared_at,reviewed_by,reviewed_at,review_note").order("prepared_at", { ascending: false }).limit(100),
      supabase.from("agency_motion_recipes").select("id,plan_id,storyboard_id,shot_id,shot_number,shot_fingerprint,selected_key,proposals,selected_recipe,recipe_fingerprint,estimated_preview_cost_cop,created_at").order("shot_number", { ascending: true }).limit(1000),
      supabase.from("agency_motion_observations").select("id,observation_key,plan_id,recipe_id,shot_id,job_id,quality_review_id,provider,model,model_version,effective_parameters,actual_cost_cop,runtime_sec,attempts,errors,manual_corrections,qa_snapshot,attention_snapshot,observation_fingerprint,recorded_by_connector,recorded_at").order("recorded_at", { ascending: false }).limit(1000),
    ]);
    if (motionPlanResult.error) throw new Error(motionPlanResult.error.message);
    if (motionRecipeResult.error) throw new Error(motionRecipeResult.error.message);
    if (motionObservationResult.error) throw new Error(motionObservationResult.error.message);
    agencyMotionPlans = (motionPlanResult.data || []).map((row) => ({
      id: row.id, planKey: row.plan_key, storyboardId: row.storyboard_id, version: Number(row.version), status: row.status,
      grammarPrimary: row.grammar_primary, grammarSecondary: row.grammar_secondary, continuityLedger: row.continuity_ledger || {},
      snapshot: row.plan_snapshot || {}, fingerprint: row.plan_fingerprint, estimatedPreviewCostCop: Number(row.estimated_preview_cost_cop || 0),
      sourceKind: row.source_kind, preparedBy: nz(row.prepared_by), preparedByAgent: nz(row.prepared_by_agent), preparedAt: tsBogota(row.prepared_at),
      reviewedBy: nz(row.reviewed_by), reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note),
    }));
    agencyMotionRecipes = (motionRecipeResult.data || []).map((row) => ({
      id: row.id, planId: row.plan_id, storyboardId: row.storyboard_id, shotId: row.shot_id, shotNumber: Number(row.shot_number),
      shotFingerprint: row.shot_fingerprint, selectedKey: row.selected_key, proposals: row.proposals || [], selectedRecipe: row.selected_recipe || {},
      fingerprint: row.recipe_fingerprint, estimatedPreviewCostCop: Number(row.estimated_preview_cost_cop || 0), createdAt: tsBogota(row.created_at),
    }));
    agencyMotionObservations = (motionObservationResult.data || []).map((row) => ({
      id: row.id, observationKey: row.observation_key, planId: row.plan_id, recipeId: row.recipe_id, shotId: row.shot_id,
      jobId: row.job_id, qualityReviewId: row.quality_review_id, provider: row.provider, model: row.model, modelVersion: row.model_version,
      effectiveParameters: row.effective_parameters || {}, actualCostCop: Number(row.actual_cost_cop || 0), runtimeSec: Number(row.runtime_sec || 0),
      attempts: Number(row.attempts || 0), errors: row.errors || [], manualCorrections: row.manual_corrections || [],
      qaSnapshot: row.qa_snapshot || {}, attentionSnapshot: row.attention_snapshot || {}, fingerprint: row.observation_fingerprint,
      recordedByConnector: row.recorded_by_connector, recordedAt: tsBogota(row.recorded_at),
    }));
  }

  const sceneRouterProbe = await capabilityResult("enrutador_escenas_disponible");
  const sceneRouterProbeMissing = sceneRouterProbe.error &&
    (sceneRouterProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(sceneRouterProbe.error.message || ""));
  if (sceneRouterProbe.error && !sceneRouterProbeMissing) throw new Error(sceneRouterProbe.error.message);
  const agencySceneRouterReady = !sceneRouterProbeMissing && sceneRouterProbe.data === true;
  let agencySceneRoutingPlans = [];
  if (agencySceneRouterReady) {
    const routeResult = await supabase.from("agency_scene_routing_plans")
      .select("id,plan_key,storyboard_id,motion_plan_id,motion_plan_fingerprint,version,status,plan_snapshot,plan_fingerprint,total_estimated_cost_cop,total_cost_cap_cop,prepared_by,prepared_by_agent,created_at,resolved_by,resolved_at,resolution_note,job_ids")
      .order("created_at", { ascending: false }).limit(100);
    if (routeResult.error) throw new Error(routeResult.error.message);
    agencySceneRoutingPlans = (routeResult.data || []).map((row) => ({
      id: row.id, planKey: row.plan_key, storyboardId: row.storyboard_id, motionPlanId: row.motion_plan_id,
      motionPlanFingerprint: nz(row.motion_plan_fingerprint), version: Number(row.version), status: row.status,
      snapshot: row.plan_snapshot || {}, fingerprint: row.plan_fingerprint,
      totalEstimatedCostCop: Number(row.total_estimated_cost_cop || 0), totalCostCapCop: Number(row.total_cost_cap_cop || 0),
      preparedBy: nz(row.prepared_by), preparedByAgent: nz(row.prepared_by_agent), createdAt: tsBogota(row.created_at),
      resolvedBy: nz(row.resolved_by), resolvedAt: tsBogota(row.resolved_at), resolutionNote: nz(row.resolution_note), jobIds: row.job_ids || [],
    }));
  }

  const qualityProbe = await capabilityResult("calidad_postproduccion_disponible");
  const qualityProbeMissing = qualityProbe.error &&
    (qualityProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(qualityProbe.error.message || ""));
  if (qualityProbe.error && !qualityProbeMissing) throw new Error(qualityProbe.error.message);
  const agencyQualityReady = !qualityProbeMissing && qualityProbe.data === true;
  let agencySceneQualityReviews = []; let agencyPostproductionPackages = [];
  if (agencyQualityReady) {
    const [qualityResult, packageResult] = await Promise.all([
      supabase.from("agency_scene_quality_reviews")
        .select("id,review_key,routing_plan_id,storyboard_id,shot_id,job_id,output_asset_id,source_kind,status,failure_type,scores,score_total,findings,continuity_observation,evidence_snapshot,review_fingerprint,prepared_by,prepared_by_agent,created_at,resolved_by,resolved_at,resolution_note")
        .order("created_at", { ascending: false }).limit(300),
      supabase.from("agency_postproduction_packages")
        .select("id,package_key,storyboard_id,routing_plan_id,version,status,package_snapshot,package_fingerprint,prepared_by,prepared_at,reviewed_by,reviewed_at,review_note")
        .order("prepared_at", { ascending: false }).limit(100),
    ]);
    if (qualityResult.error) throw new Error(qualityResult.error.message);
    if (packageResult.error) throw new Error(packageResult.error.message);
    agencySceneQualityReviews = (qualityResult.data || []).map((row) => ({
      id: row.id, reviewKey: row.review_key, routingPlanId: row.routing_plan_id, storyboardId: row.storyboard_id,
      shotId: row.shot_id, jobId: row.job_id, outputAssetId: row.output_asset_id, sourceKind: row.source_kind,
      status: row.status, failureType: row.failure_type, scores: row.scores || {}, scoreTotal: Number(row.score_total || 0),
      findings: row.findings || [], continuityObservation: row.continuity_observation,
      evidenceSnapshot: row.evidence_snapshot || {}, fingerprint: row.review_fingerprint,
      preparedBy: nz(row.prepared_by), preparedByAgent: nz(row.prepared_by_agent), createdAt: tsBogota(row.created_at),
      resolvedBy: nz(row.resolved_by), resolvedAt: tsBogota(row.resolved_at), resolutionNote: nz(row.resolution_note),
    }));
    agencyPostproductionPackages = (packageResult.data || []).map((row) => ({
      id: row.id, packageKey: row.package_key, storyboardId: row.storyboard_id, routingPlanId: row.routing_plan_id,
      version: Number(row.version), status: row.status, snapshot: row.package_snapshot || {}, fingerprint: row.package_fingerprint,
      preparedBy: row.prepared_by, preparedAt: tsBogota(row.prepared_at), reviewedBy: nz(row.reviewed_by),
      reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note),
    }));
  }

  const exportProbe = await capabilityResult("postproduccion_exportacion_disponible");
  const exportProbeMissing = exportProbe.error &&
    (exportProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(exportProbe.error.message || ""));
  if (exportProbe.error && !exportProbeMissing) throw new Error(exportProbe.error.message);
  const agencyPostproductionExportReady = !exportProbeMissing && exportProbe.data === true;
  let agencyPostproductionExports = []; let agencyPostproductionWorkers = [];
  if (agencyPostproductionExportReady) {
    const [exportResult, workerResult] = await Promise.all([
      supabase.from("agency_postproduction_exports")
        .select("id,export_key,package_id,version,status,export_snapshot,export_fingerprint,requested_by,requested_at,worker_id,leased_at,lease_expires_at,attempts,output_asset_id,result_snapshot,result_fingerprint,error_message,started_at,exported_at,reviewed_by,reviewed_at,review_note")
        .order("requested_at", { ascending: false }).limit(200),
      supabase.from("agency_postproduction_worker_health")
        .select("worker_id,version,status,ffmpeg_available,ffmpeg_version,last_error,heartbeat_at")
        .order("heartbeat_at", { ascending: false }).limit(20),
    ]);
    if (exportResult.error) throw new Error(exportResult.error.message);
    if (workerResult.error) throw new Error(workerResult.error.message);
    agencyPostproductionExports = (exportResult.data || []).map((row) => ({
      id: row.id, exportKey: row.export_key, packageId: row.package_id, version: Number(row.version), status: row.status,
      snapshot: row.export_snapshot || {}, fingerprint: row.export_fingerprint, requestedBy: row.requested_by,
      requestedAt: tsBogota(row.requested_at), workerId: nz(row.worker_id), leasedAt: tsBogota(row.leased_at),
      leaseExpiresAt: tsBogota(row.lease_expires_at), attempts: Number(row.attempts || 0), outputAssetId: row.output_asset_id,
      result: row.result_snapshot || {}, resultFingerprint: nz(row.result_fingerprint), errorMessage: nz(row.error_message),
      startedAt: tsBogota(row.started_at), exportedAt: tsBogota(row.exported_at), reviewedBy: nz(row.reviewed_by),
      reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note),
    }));
    agencyPostproductionWorkers = (workerResult.data || []).map((row) => ({
      workerId: row.worker_id, version: row.version, status: row.status, ffmpegAvailable: Boolean(row.ffmpeg_available),
      ffmpegVersion: nz(row.ffmpeg_version), lastError: nz(row.last_error), heartbeatAt: tsBogota(row.heartbeat_at),
    }));
  }

  const audioProbe = await capabilityResult("postproduccion_audio_disponible");
  const audioProbeMissing = audioProbe.error &&
    (audioProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(audioProbe.error.message || ""));
  if (audioProbe.error && !audioProbeMissing) throw new Error(audioProbe.error.message);
  const agencyPostproductionAudioReady = !audioProbeMissing && audioProbe.data === true;
  let agencyPostproductionAudioBindings = [];
  if (agencyPostproductionAudioReady) {
    const audioResult = await supabase.from("agency_postproduction_export_audio")
      .select("export_id,mode,asset_id,audio_snapshot,audio_fingerprint,authorized_by,authorized_at")
      .order("authorized_at", { ascending: false }).limit(200);
    if (audioResult.error) throw new Error(audioResult.error.message);
    agencyPostproductionAudioBindings = (audioResult.data || []).map((row) => ({
      exportId: row.export_id, mode: row.mode, assetId: row.asset_id, snapshot: row.audio_snapshot || {},
      fingerprint: row.audio_fingerprint, authorizedBy: row.authorized_by, authorizedAt: tsBogota(row.authorized_at),
    }));
  }

  const retentionProbe = await capabilityResult("retencion_guiones_disponible");
  const retentionProbeMissing = retentionProbe.error &&
    (retentionProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(retentionProbe.error.message || ""));
  if (retentionProbe.error && !retentionProbeMissing) throw new Error(retentionProbe.error.message);
  const agencyRetentionReady = !retentionProbeMissing && retentionProbe.data === true;
  let agencyRetentionScripts = []; let agencyRetentionHooks = []; let agencyRetentionLoops = [];
  let agencyRetentionExperiments = []; let agencyRetentionMeasurements = [];
  if (agencyRetentionReady) {
    const [scriptResult, hookResult, loopResult, experimentResult, measurementResult] = await Promise.all([
      supabase.from("agency_retention_scripts")
        .select("id,script_key,contract_id,version,title,status,platform,target_duration_sec,objective,audience,promise,payoff,source_kind,script_snapshot,script_fingerprint,prepared_by,prepared_by_agent,prepared_at,reviewed_by,reviewed_at,review_note")
        .order("prepared_at", { ascending: false }).limit(200),
      supabase.from("agency_retention_hooks")
        .select("id,script_id,variant_key,label,mechanism,hook_text,opening_visual,proof,scores,score_total,selected,hook_fingerprint")
        .order("id", { ascending: true }).limit(1000),
      supabase.from("agency_retention_loops")
        .select("id,script_id,loop_key,question,open_sec,partial_payoff_sec,close_sec,payoff,loop_fingerprint")
        .order("open_sec", { ascending: true }).limit(1000),
      supabase.from("agency_retention_experiments")
        .select("id,experiment_key,script_id,control_hook_id,challenger_hook_id,declared_variable,hypothesis,primary_metric,status,experiment_snapshot,experiment_fingerprint,created_by,created_at,resolved_by,resolved_at,resolution,winner_hook_id")
        .order("created_at", { ascending: false }).limit(300),
      supabase.from("agency_retention_measurements")
        .select("id,measurement_key,experiment_id,hook_id,content_post_id,platform,captured_at,sample_size,impressions,starts,views_3s,views_25,views_50,views_75,views_100,watch_time_sec,clicks,paid_orders,attributed_revenue,attributed_margin,incremental_profit,retention_curve,attribution_snapshot,publication_fingerprint,source_kind,recorded_by,recorded_by_connector,created_at")
        .order("captured_at", { ascending: false }).limit(1000),
    ]);
    for (const result of [scriptResult, hookResult, loopResult, experimentResult, measurementResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    agencyRetentionScripts = (scriptResult.data || []).map((row) => ({
      id: row.id, scriptKey: row.script_key, contractId: row.contract_id, version: Number(row.version), title: row.title,
      status: row.status, platform: row.platform, targetDurationSec: Number(row.target_duration_sec || 0), objective: row.objective,
      audience: row.audience, promise: row.promise, payoff: row.payoff, sourceKind: row.source_kind, snapshot: row.script_snapshot || {},
      fingerprint: row.script_fingerprint, preparedBy: nz(row.prepared_by), preparedByAgent: nz(row.prepared_by_agent),
      preparedAt: tsBogota(row.prepared_at), reviewedBy: nz(row.reviewed_by), reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note),
    }));
    agencyRetentionHooks = (hookResult.data || []).map((row) => ({
      id: row.id, scriptId: row.script_id, variantKey: row.variant_key, label: row.label, mechanism: row.mechanism,
      hookText: row.hook_text, openingVisual: row.opening_visual, proof: row.proof, scores: row.scores || {},
      scoreTotal: Number(row.score_total || 0), selected: Boolean(row.selected), fingerprint: row.hook_fingerprint,
    }));
    agencyRetentionLoops = (loopResult.data || []).map((row) => ({
      id: row.id, scriptId: row.script_id, loopKey: row.loop_key, question: row.question, openSec: Number(row.open_sec || 0),
      partialPayoffSec: row.partial_payoff_sec == null ? null : Number(row.partial_payoff_sec), closeSec: Number(row.close_sec || 0),
      payoff: row.payoff, fingerprint: row.loop_fingerprint,
    }));
    agencyRetentionExperiments = (experimentResult.data || []).map((row) => ({
      id: row.id, experimentKey: row.experiment_key, scriptId: row.script_id, controlHookId: row.control_hook_id,
      challengerHookId: row.challenger_hook_id, declaredVariable: row.declared_variable, hypothesis: row.hypothesis,
      primaryMetric: row.primary_metric, status: row.status, snapshot: row.experiment_snapshot || {}, fingerprint: row.experiment_fingerprint,
      createdBy: row.created_by, createdAt: tsBogota(row.created_at), resolvedBy: nz(row.resolved_by), resolvedAt: tsBogota(row.resolved_at),
      resolution: nz(row.resolution), winnerHookId: row.winner_hook_id,
    }));
    agencyRetentionMeasurements = (measurementResult.data || []).map((row) => ({
      id: row.id, measurementKey: row.measurement_key, experimentId: row.experiment_id, hookId: row.hook_id,
      contentPostId: row.content_post_id, platform: row.platform, capturedAt: tsBogota(row.captured_at), sampleSize: Number(row.sample_size || 0),
      impressions: Number(row.impressions || 0), starts: Number(row.starts || 0), views3s: Number(row.views_3s || 0),
      views25: Number(row.views_25 || 0), views50: Number(row.views_50 || 0), views75: Number(row.views_75 || 0), views100: Number(row.views_100 || 0),
      watchTimeSec: Number(row.watch_time_sec || 0), clicks: Number(row.clicks || 0), paidOrders: Number(row.paid_orders || 0),
      attributedRevenue: Number(row.attributed_revenue || 0), attributedMargin: Number(row.attributed_margin || 0), incrementalProfit: Number(row.incremental_profit || 0),
      retentionCurve: row.retention_curve || [], attributionSnapshot: row.attribution_snapshot || {}, publicationFingerprint: row.publication_fingerprint,
      sourceKind: row.source_kind, recordedBy: nz(row.recorded_by), recordedByConnector: nz(row.recorded_by_connector), createdAt: tsBogota(row.created_at),
    }));
  }

  const loopLearningProbe = await capabilityResult("retencion_loops_disponible");
  const loopLearningProbeMissing = loopLearningProbe.error &&
    (loopLearningProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(loopLearningProbe.error.message || ""));
  if (loopLearningProbe.error && !loopLearningProbeMissing) throw new Error(loopLearningProbe.error.message);
  const agencyLoopLearningReady = !loopLearningProbeMissing && loopLearningProbe.data === true;
  let agencyRetentionDiagnostics = []; let agencyRetentionLearnings = [];
  if (agencyLoopLearningReady) {
    const [diagnosticResult, learningResult] = await Promise.all([
      supabase.from("agency_retention_diagnostics")
        .select("id,diagnostic_key,measurement_id,experiment_id,script_id,hook_id,status,tested_variable,primary_signal,hypothesis,recommendation,confidence,diagnostic_snapshot,diagnostic_fingerprint,source_kind,prepared_by,prepared_by_agent,prepared_at,reviewed_by,reviewed_at,review_note")
        .order("prepared_at", { ascending: false }).limit(500),
      supabase.from("agency_retention_learnings")
        .select("id,learning_key,diagnostic_id,platform,audience,target_duration_sec,tested_variable,statement,scope_snapshot,evidence_snapshot,learning_fingerprint,approved_by,approved_at")
        .order("approved_at", { ascending: false }).limit(500),
    ]);
    for (const result of [diagnosticResult, learningResult]) if (result.error) throw new Error(result.error.message);
    agencyRetentionDiagnostics = (diagnosticResult.data || []).map((row) => ({
      id: row.id, diagnosticKey: row.diagnostic_key, measurementId: row.measurement_id, experimentId: row.experiment_id,
      scriptId: row.script_id, hookId: row.hook_id, status: row.status, testedVariable: row.tested_variable,
      primarySignal: row.primary_signal, hypothesis: row.hypothesis, recommendation: row.recommendation, confidence: row.confidence,
      snapshot: row.diagnostic_snapshot || {}, fingerprint: row.diagnostic_fingerprint, sourceKind: row.source_kind,
      preparedBy: nz(row.prepared_by), preparedByAgent: nz(row.prepared_by_agent), preparedAt: tsBogota(row.prepared_at),
      reviewedBy: nz(row.reviewed_by), reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note),
    }));
    agencyRetentionLearnings = (learningResult.data || []).map((row) => ({
      id: row.id, learningKey: row.learning_key, diagnosticId: row.diagnostic_id, platform: row.platform, audience: row.audience,
      targetDurationSec: Number(row.target_duration_sec || 0), testedVariable: row.tested_variable, statement: row.statement,
      scope: row.scope_snapshot || {}, evidence: row.evidence_snapshot || {}, fingerprint: row.learning_fingerprint,
      approvedBy: row.approved_by, approvedAt: tsBogota(row.approved_at),
    }));
  }

  const metaObservatoryProbe = await capabilityResult("observatorio_meta_disponible");
  const metaObservatoryProbeMissing = metaObservatoryProbe.error &&
    (metaObservatoryProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(metaObservatoryProbe.error.message || ""));
  if (metaObservatoryProbe.error && !metaObservatoryProbeMissing) throw new Error(metaObservatoryProbe.error.message);
  const agencyMetaReady = !metaObservatoryProbeMissing && metaObservatoryProbe.data === true;
  let agencyMetaPolicies = []; let agencyMetaSnapshots = []; let agencyMetaDiagnostics = [];
  if (agencyMetaReady) {
    const [policyResult, snapshotResult, diagnosticResult] = await Promise.all([
      supabase.from("agency_meta_policies")
        .select("id,policy_key,version,status,source_label,market,currency,effective_from,effective_until,targets,thresholds,policy_fingerprint,created_by,created_at")
        .order("version", { ascending: false }).limit(100),
      supabase.from("agency_meta_signal_snapshots")
        .select("id,snapshot_key,account_external_id,account_label,entity_type,entity_external_id,objective,currency,timezone,window_start,window_end,source_captured_at,local_campaign_id,local_creative_id,local_post_id,metrics,pixel_events,catalog_products,local_truth,publication_fingerprint,snapshot_fingerprint,recorded_by_connector,created_at")
        .order("window_end", { ascending: false }).limit(500),
      supabase.from("agency_meta_diagnostics")
        .select("id,diagnostic_key,snapshot_id,policy_id,status,what_happened,why_hypotheses,recommended_actions,evidence_snapshot,confidence,source_kind,diagnostic_fingerprint,prepared_by,prepared_by_agent,prepared_at,reviewed_by,reviewed_at,review_note")
        .order("prepared_at", { ascending: false }).limit(500),
    ]);
    for (const result of [policyResult, snapshotResult, diagnosticResult]) if (result.error) throw new Error(result.error.message);
    agencyMetaPolicies = (policyResult.data || []).map((row) => ({
      id: row.id, policyKey: row.policy_key, version: Number(row.version), status: row.status, sourceLabel: row.source_label,
      market: row.market, currency: row.currency, effectiveFrom: row.effective_from, effectiveUntil: nz(row.effective_until),
      targets: row.targets || {}, thresholds: row.thresholds || {}, fingerprint: row.policy_fingerprint,
      createdBy: nz(row.created_by), createdAt: tsBogota(row.created_at),
    }));
    agencyMetaSnapshots = (snapshotResult.data || []).map((row) => ({
      id: row.id, snapshotKey: row.snapshot_key, accountExternalId: row.account_external_id, accountLabel: row.account_label,
      entityType: row.entity_type, entityExternalId: row.entity_external_id, objective: row.objective, currency: row.currency,
      timezone: row.timezone, windowStart: row.window_start, windowEnd: row.window_end, sourceCapturedAt: tsBogota(row.source_captured_at),
      localCampaignId: nz(row.local_campaign_id), localCreativeId: nz(row.local_creative_id), localPostId: nz(row.local_post_id),
      metrics: row.metrics || {}, pixelEvents: row.pixel_events || [], catalogProducts: (row.catalog_products || []).map((item) => ({
        productExternalId: item.product_external_id || "", localProductId: item.local_product_id || "", name: item.name || "",
        spend: Number(item.spend || 0), momosTruth: item.momos_truth ? {
          availableStock: Number(item.momos_truth.available_stock || 0), paidUnits: Number(item.momos_truth.paid_units || 0),
          paidRevenue: Number(item.momos_truth.paid_revenue || 0), grossMargin: Number(item.momos_truth.gross_margin || 0),
          active: Boolean(item.momos_truth.active), expired: Boolean(item.momos_truth.expired), source: item.momos_truth.source || "MOMOS OPS",
        } : {},
      })), localTruth: {
        paidOrders: Number(row.local_truth?.paid_orders || 0), paidRevenue: Number(row.local_truth?.paid_revenue || 0),
        grossMargin: Number(row.local_truth?.gross_margin || 0), linked: Boolean(row.local_truth?.linked), source: row.local_truth?.source || "MOMOS OPS",
      },
      publicationFingerprint: nz(row.publication_fingerprint), fingerprint: row.snapshot_fingerprint,
      recordedByConnector: row.recorded_by_connector, createdAt: tsBogota(row.created_at),
    }));
    agencyMetaDiagnostics = (diagnosticResult.data || []).map((row) => ({
      id: row.id, diagnosticKey: row.diagnostic_key, snapshotId: row.snapshot_id, policyId: row.policy_id, status: row.status,
      whatHappened: row.what_happened || {}, whyHypotheses: row.why_hypotheses || [], recommendedActions: row.recommended_actions || [],
      evidence: row.evidence_snapshot || {}, confidence: row.confidence, sourceKind: row.source_kind, fingerprint: row.diagnostic_fingerprint,
      preparedBy: nz(row.prepared_by), preparedByAgent: nz(row.prepared_by_agent), preparedAt: tsBogota(row.prepared_at),
      reviewedBy: nz(row.reviewed_by), reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note),
    }));
  }

  const metaIncrementalityProbe = await capabilityResult("incrementalidad_meta_disponible");
  const metaIncrementalityProbeMissing = metaIncrementalityProbe.error &&
    (metaIncrementalityProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(metaIncrementalityProbe.error.message || ""));
  if (metaIncrementalityProbe.error && !metaIncrementalityProbeMissing) throw new Error(metaIncrementalityProbe.error.message);
  const agencyMetaIncrementalityReady = !metaIncrementalityProbeMissing && metaIncrementalityProbe.data === true;
  let agencyMetaLiftStudies = []; let agencyMetaLiftMeasurements = [];
  if (agencyMetaIncrementalityReady) {
    const [studyResult, measurementResult] = await Promise.all([
      supabase.from("agency_meta_lift_studies")
        .select("id,study_key,diagnostic_id,snapshot_id,campaign_id,external_study_id,design,lifecycle_scope,status,window_start,window_end,minimum_per_arm,hypothesis,assignment_snapshot,guardrails,study_fingerprint,source_kind,prepared_by,prepared_by_agent,prepared_at,reviewed_by,reviewed_at,review_note")
        .order("prepared_at", { ascending: false }).limit(300),
      supabase.from("agency_meta_lift_measurements")
        .select("id,measurement_key,study_id,status,captured_at,control_cell,exposed_cell,incremental_spend,platform_result,local_lifecycle_snapshot,result_snapshot,measurement_fingerprint,recorded_by_connector,recorded_at,reviewed_by,reviewed_at,review_note")
        .order("recorded_at", { ascending: false }).limit(500),
    ]);
    for (const result of [studyResult, measurementResult]) if (result.error) throw new Error(result.error.message);
    agencyMetaLiftStudies = (studyResult.data || []).map((row) => ({ id: row.id, studyKey: row.study_key, diagnosticId: row.diagnostic_id,
      snapshotId: row.snapshot_id, campaignId: row.campaign_id, externalStudyId: row.external_study_id, design: row.design,
      lifecycleScope: row.lifecycle_scope, status: row.status, windowStart: row.window_start, windowEnd: row.window_end,
      minimumPerArm: Number(row.minimum_per_arm || 100), hypothesis: row.hypothesis, assignment: row.assignment_snapshot || {},
      guardrails: row.guardrails || {}, fingerprint: row.study_fingerprint, sourceKind: row.source_kind, preparedBy: nz(row.prepared_by),
      preparedByAgent: nz(row.prepared_by_agent), preparedAt: tsBogota(row.prepared_at), reviewedBy: nz(row.reviewed_by),
      reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note) }));
    agencyMetaLiftMeasurements = (measurementResult.data || []).map((row) => ({ id: row.id, measurementKey: row.measurement_key,
      studyId: row.study_id, status: row.status, capturedAt: tsBogota(row.captured_at), control: row.control_cell || {}, exposed: row.exposed_cell || {},
      incrementalSpend: Number(row.incremental_spend || 0), platformResult: row.platform_result || {}, lifecycle: row.local_lifecycle_snapshot || {},
      result: { ...(row.result_snapshot || {}), sampleSufficient: Boolean(row.result_snapshot?.sample_sufficient),
        significant: Boolean(row.result_snapshot?.statistically_significant), causalClaimAllowed: Boolean(row.result_snapshot?.causal_claim_allowed),
        controlRatePct: Number(row.result_snapshot?.control_rate_pct || 0), exposedRatePct: Number(row.result_snapshot?.exposed_rate_pct || 0),
        rateDifferencePp: Number(row.result_snapshot?.rate_difference_pp || 0), liftPct: row.result_snapshot?.lift_pct == null ? null : Number(row.result_snapshot.lift_pct),
        incrementalBuyers: Number(row.result_snapshot?.incremental_buyers || 0), incrementalMargin: Number(row.result_snapshot?.incremental_margin || 0),
        incrementalProfit: Number(row.result_snapshot?.incremental_profit || 0) }, fingerprint: row.measurement_fingerprint,
      recordedByConnector: row.recorded_by_connector, recordedAt: tsBogota(row.recorded_at), reviewedBy: nz(row.reviewed_by),
      reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note) }));
  }

  const metaInvestmentProbe = await capabilityResult("escenarios_inversion_meta_disponible");
  const metaInvestmentProbeMissing = metaInvestmentProbe.error &&
    (metaInvestmentProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(metaInvestmentProbe.error.message || ""));
  if (metaInvestmentProbe.error && !metaInvestmentProbeMissing) throw new Error(metaInvestmentProbe.error.message);
  const agencyMetaInvestmentReady = !metaInvestmentProbeMissing && metaInvestmentProbe.data === true;
  let agencyMetaInvestmentScenarios = [];
  if (agencyMetaInvestmentReady) {
    const scenarioResult = await supabase.from("agency_meta_investment_scenarios")
      .select("id,scenario_key,measurement_id,study_id,campaign_id,product_id,status,horizon_days,recommended_option,evidence_snapshot,options_snapshot,guardrails,scenario_fingerprint,source_kind,prepared_by,prepared_by_agent,prepared_at,reviewed_by,reviewed_at,review_note")
      .order("prepared_at", { ascending: false }).limit(300);
    if (scenarioResult.error) throw new Error(scenarioResult.error.message);
    agencyMetaInvestmentScenarios = (scenarioResult.data || []).map((row) => {
      const evidence = row.evidence_snapshot || {}; const operations = evidence.operations || {}; const limits = evidence.limits || {};
      return { id: row.id, scenarioKey: row.scenario_key, measurementId: row.measurement_id, studyId: row.study_id,
        campaignId: row.campaign_id, productId: nz(row.product_id), status: row.status, horizonDays: Number(row.horizon_days || 7),
        recommendedOption: row.recommended_option, evidence: { ...evidence, capturedAt: tsBogota(evidence.captured_at),
          stockBlocked: Boolean(operations.stock_blocked), operations: { ...operations,
            exactAvailable: Number(operations.exact_available || 0), expiringSoon: Number(operations.expiring_within_2d || 0),
            inProcess: Number(operations.in_process || 0), reservations: Number(operations.reservations || 0),
            pendingProduction: Number(operations.pending_production || 0), kitchenQueue: Number(operations.kitchen_queue || 0) },
          limits: { ...limits, dailyBudgetLimit: Number(limits.daily_budget_limit || 0), campaignBudgetLimit: Number(limits.campaign_budget_limit || 0),
            scaleStepPct: Number(limits.scale_step_pct || 0) } },
        options: (row.options_snapshot || []).map((option) => ({ ...option, proposedBudget: Number(option.proposed_budget || 0),
          deltaPct: Number(option.delta_pct || 0), blockers: option.blockers || [], assumptions: option.assumptions || [] })),
        guardrails: row.guardrails || {}, fingerprint: row.scenario_fingerprint, sourceKind: row.source_kind,
        preparedBy: nz(row.prepared_by), preparedByAgent: nz(row.prepared_by_agent), preparedAt: tsBogota(row.prepared_at),
        reviewedBy: nz(row.reviewed_by), reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note) };
    });
  }

  const metaAuthorizationProbe = await capabilityResult("autorizacion_inversion_meta_disponible");
  const metaAuthorizationProbeMissing = metaAuthorizationProbe.error &&
    (metaAuthorizationProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(metaAuthorizationProbe.error.message || ""));
  if (metaAuthorizationProbe.error && !metaAuthorizationProbeMissing) throw new Error(metaAuthorizationProbe.error.message);
  const agencyMetaAuthorizationReady = !metaAuthorizationProbeMissing && metaAuthorizationProbe.data === true;
  let agencyMetaInvestmentAuthorizations = []; let agencyMetaInvestmentExecutionJobs = [];
  if (agencyMetaAuthorizationReady) {
    const [authorizationResult, executionResult] = await Promise.all([
      supabase.from("agency_meta_investment_authorizations")
        .select("id,authorization_key,scenario_id,measurement_id,campaign_id,product_id,selected_option,audience_external_id,target_budget,execution_mode,status,justification,valid_from,valid_until,sealed_snapshot,snapshot_fingerprint,requested_by,requested_at,authorized_by,authorized_at,reviewed_by,reviewed_at,review_note,revoked_by,revoked_at,revoke_reason")
        .order("requested_at", { ascending: false }).limit(300),
      supabase.from("agency_meta_investment_execution_jobs")
        .select("id,authorization_id,attempt,idempotency_key,execution_mode,status,worker_id,lease_expires_at,dispatched_at,completed_at,receipt,error_message,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(300),
    ]);
    if (authorizationResult.error) throw new Error(authorizationResult.error.message);
    if (executionResult.error) throw new Error(executionResult.error.message);
    agencyMetaInvestmentAuthorizations = (authorizationResult.data || []).map((row) => ({ id: row.id,
      authorizationKey: row.authorization_key, scenarioId: row.scenario_id, measurementId: row.measurement_id,
      campaignId: row.campaign_id, productId: nz(row.product_id), selectedOption: row.selected_option,
      audienceExternalId: row.audience_external_id, targetBudget: Number(row.target_budget || 0), executionMode: row.execution_mode,
      status: row.status, justification: row.justification, validFrom: tsBogota(row.valid_from), validUntil: tsBogota(row.valid_until),
      snapshot: row.sealed_snapshot || {}, fingerprint: row.snapshot_fingerprint, requestedBy: row.requested_by,
      requestedAt: tsBogota(row.requested_at), authorizedBy: nz(row.authorized_by), authorizedAt: tsBogota(row.authorized_at),
      reviewedBy: nz(row.reviewed_by), reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note),
      revokedBy: nz(row.revoked_by), revokedAt: tsBogota(row.revoked_at), revokeReason: nz(row.revoke_reason) }));
    agencyMetaInvestmentExecutionJobs = (executionResult.data || []).map((row) => ({ id: row.id,
      authorizationId: row.authorization_id, attempt: Number(row.attempt || 1), idempotencyKey: row.idempotency_key,
      executionMode: row.execution_mode, status: row.status, workerId: nz(row.worker_id), leaseExpiresAt: tsBogota(row.lease_expires_at),
      dispatchedAt: tsBogota(row.dispatched_at), completedAt: tsBogota(row.completed_at), receipt: row.receipt || {},
      errorMessage: nz(row.error_message), createdAt: tsBogota(row.created_at), updatedAt: tsBogota(row.updated_at) }));
  }

  const metaConnectorProbe = await capabilityResult("meta_conector_dry_run_disponible");
  const metaConnectorProbeMissing = metaConnectorProbe.error &&
    (metaConnectorProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(metaConnectorProbe.error.message || ""));
  if (metaConnectorProbe.error && !metaConnectorProbeMissing) throw new Error(metaConnectorProbe.error.message);
  const agencyMetaConnectorReady = !metaConnectorProbeMissing && metaConnectorProbe.data === true;
  let agencyMetaConnectorDryRuns = [];
  if (agencyMetaConnectorReady) {
    const result = await supabase.from("agency_meta_connector_dry_runs")
      .select("id,dry_run_key,authorization_id,campaign_id,campaign_external_id,audience_external_id,ad_account_id,api_version,mode,status,idempotency_key,prepared_by,prepared_at,worker_id,lease_expires_at,started_at,completed_at,receipt,error_message,updated_at")
      .order("prepared_at", { ascending: false }).limit(300);
    if (result.error) throw new Error(result.error.message);
    agencyMetaConnectorDryRuns = (result.data || []).map((row) => ({ id: row.id, dryRunKey: row.dry_run_key,
      authorizationId: row.authorization_id, campaignId: row.campaign_id, campaignExternalId: row.campaign_external_id,
      audienceExternalId: row.audience_external_id, adAccountId: row.ad_account_id, apiVersion: row.api_version,
      mode: row.mode, status: row.status, idempotencyKey: row.idempotency_key, preparedBy: row.prepared_by,
      preparedAt: tsBogota(row.prepared_at), workerId: nz(row.worker_id), leaseExpiresAt: tsBogota(row.lease_expires_at),
      startedAt: tsBogota(row.started_at), completedAt: tsBogota(row.completed_at), receipt: row.receipt || {},
      errorMessage: nz(row.error_message), updatedAt: tsBogota(row.updated_at) }));
  }

  const distributionProbe = await capabilityResult("distribucion_comercial_disponible");
  const distributionProbeMissing = distributionProbe.error &&
    (distributionProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(distributionProbe.error.message || ""));
  if (distributionProbe.error && !distributionProbeMissing) throw new Error(distributionProbe.error.message);
  const distributionServerReady = !distributionProbeMissing && distributionProbe.data === true;
  let content_distributions = [];
  if (distributionServerReady) {
    const distributionResult = await supabase.from("content_distributions")
      .select("*")
      .order("updated_at", { ascending: false }).limit(100);
    if (distributionResult.error) throw new Error(distributionResult.error.message);
    content_distributions = (distributionResult.data || []).map((row) => ({
      id: row.id, postId: row.post_id, channel: row.channel, contentMode: row.content_mode, status: row.status, checklist: row.checklist || {}, attempt: Number(row.attempt),
      preparedBy: row.prepared_by, preparedAt: tsBogota(row.prepared_at), approvedBy: nz(row.approved_by), approvedAt: tsBogota(row.approved_at),
      executedBy: nz(row.executed_by), publishedAt: tsBogota(row.published_at), externalUrl: nz(row.external_url),
      externalPostId: nz(row.external_post_id), failureReason: nz(row.failure_reason), notes: nz(row.notes), updatedAt: tsBogota(row.updated_at),
    }));
  }
  const connectorDistributionProbe = await capabilityResult("distribucion_conectores_disponible");
  const connectorDistributionProbeMissing = connectorDistributionProbe.error &&
    (connectorDistributionProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(connectorDistributionProbe.error.message || ""));
  if (connectorDistributionProbe.error && !connectorDistributionProbeMissing) throw new Error(connectorDistributionProbe.error.message);
  const distributionConnectorReady = !connectorDistributionProbeMissing && connectorDistributionProbe.data === true;
  let distributionConnectorJobs = [];
  if (distributionConnectorReady) {
    const connectorJobsResult = await supabase.from("distribution_connector_jobs")
      .select("id,distribution_id,post_id,provider,mode,attempt,idempotency_key,status,authorized_by,authorized_at,scheduled_at,worker_id,dispatched_at,provider_job_id,external_url,actual_cost_cop,error_message,completed_at,updated_at")
      .order("updated_at", { ascending: false }).limit(100);
    if (connectorJobsResult.error) throw new Error(connectorJobsResult.error.message);
    distributionConnectorJobs = (connectorJobsResult.data || []).map((row) => ({
      id: row.id, distributionId: row.distribution_id, postId: row.post_id, provider: row.provider, mode: row.mode,
      attempt: Number(row.attempt), idempotencyKey: row.idempotency_key, status: row.status,
      authorizedBy: row.authorized_by, authorizedAt: tsBogota(row.authorized_at), scheduledAt: nz(row.scheduled_at),
      workerId: nz(row.worker_id), dispatchedAt: tsBogota(row.dispatched_at), providerJobId: nz(row.provider_job_id),
      externalUrl: nz(row.external_url), actualCostCop: Number(row.actual_cost_cop || 0), errorMessage: nz(row.error_message),
      completedAt: tsBogota(row.completed_at), updatedAt: tsBogota(row.updated_at),
    }));
  }

  // Biblioteca Inteligente + Estudio Creativo (migración 20). Durante el
  // rollout la sonda puede no existir: Agencia sigue operativa y muestra la
  // instalación pendiente, sin consultar tablas que aún no fueron creadas.
  const brandMediaProbe = await capabilityResult("biblioteca_creativa_disponible");
  const brandMediaProbeMissing = brandMediaProbe.error &&
    (brandMediaProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(brandMediaProbe.error.message || ""));
  if (brandMediaProbe.error && !brandMediaProbeMissing) throw new Error(brandMediaProbe.error.message);
  const brandMediaReady = !brandMediaProbeMissing && brandMediaProbe.data === true;
  let mundoAnimadoReady = false;
  let officialLogoDeletionReady = false;
  let brandProductionReady = false;
  if (brandMediaReady) {
    const animationProbe = await capabilityResult("mundo_animado_disponible");
    const animationProbeMissing = animationProbe.error &&
      (animationProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(animationProbe.error.message || ""));
    if (animationProbe.error && !animationProbeMissing) throw new Error(animationProbe.error.message);
    mundoAnimadoReady = !animationProbeMissing && animationProbe.data === true;
    const officialLogoDeletionProbe = await capabilityResult("eliminacion_logo_oficial_disponible");
    const officialLogoDeletionMissing = officialLogoDeletionProbe.error &&
      (officialLogoDeletionProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(officialLogoDeletionProbe.error.message || ""));
    if (officialLogoDeletionProbe.error && !officialLogoDeletionMissing) throw new Error(officialLogoDeletionProbe.error.message);
    officialLogoDeletionReady = !officialLogoDeletionMissing && officialLogoDeletionProbe.data === true;
    const brandProductionProbe = await capabilityResult("biblioteca_produccion_disponible");
    const brandProductionMissing = brandProductionProbe.error &&
      (brandProductionProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(brandProductionProbe.error.message || ""));
    if (brandProductionProbe.error && !brandProductionMissing) throw new Error(brandProductionProbe.error.message);
    brandProductionReady = !brandProductionMissing && brandProductionProbe.data === true;
  }
  let creativeProductionReady = false; let creativeReviewReady = false; let creativeIterationReady = false;
  if (brandMediaReady) {
    const productionProbe = await capabilityResult("produccion_creativa_disponible");
    const productionProbeMissing = productionProbe.error &&
      (productionProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(productionProbe.error.message || ""));
    if (productionProbe.error && !productionProbeMissing) throw new Error(productionProbe.error.message);
    creativeProductionReady = !productionProbeMissing && productionProbe.data === true;
    if (creativeProductionReady) {
      const reviewProbe = await capabilityResult("revision_creativa_disponible");
      const reviewProbeMissing = reviewProbe.error &&
        (reviewProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(reviewProbe.error.message || ""));
      if (reviewProbe.error && !reviewProbeMissing) throw new Error(reviewProbe.error.message);
      creativeReviewReady = !reviewProbeMissing && reviewProbe.data === true;
      if (creativeReviewReady) {
        const iterationProbe = await capabilityResult("versiones_creativas_disponibles");
        const iterationProbeMissing = iterationProbe.error &&
          (iterationProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(iterationProbe.error.message || ""));
        if (iterationProbe.error && !iterationProbeMissing) throw new Error(iterationProbe.error.message);
        creativeIterationReady = !iterationProbeMissing && iterationProbe.data === true;
      }
    }
  }
  let mcpHumanApprovalReady = false; let mcpHumanApprovals = [];
  if (creativeProductionReady) {
    const humanApprovalProbe = await capabilityResult("mcp_aprobaciones_humanas_disponible");
    const humanApprovalMissing = humanApprovalProbe.error &&
      (humanApprovalProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(humanApprovalProbe.error.message || ""));
    if (humanApprovalProbe.error && !humanApprovalMissing) throw new Error(humanApprovalProbe.error.message);
    mcpHumanApprovalReady = !humanApprovalMissing && humanApprovalProbe.data === true;
    if (mcpHumanApprovalReady) {
      const approvalResult = await supabase.from("agency_mcp_human_approvals")
        .select("id,request_key,worker_id,job_id,title,status,approval_contract,contract_fingerprint,job_fingerprint,requested_at,expires_at,decided_by,decided_at,decision_note")
        .order("requested_at", { ascending: false }).limit(100);
      if (approvalResult.error) throw new Error(approvalResult.error.message);
      mcpHumanApprovals = (approvalResult.data || []).map((row) => {
        const expired = row.status === "Pendiente" && Date.parse(row.expires_at) <= Date.now();
        return {
          id: row.id, requestKey: row.request_key, workerId: row.worker_id, jobId: row.job_id,
          title: row.title, status: expired ? "Vencida" : row.status, storedStatus: row.status,
          contract: row.approval_contract || {}, contractFingerprint: row.contract_fingerprint,
          jobFingerprint: row.job_fingerprint, requestedAt: tsBogota(row.requested_at),
          requestedAtIso: row.requested_at, expiresAt: tsBogota(row.expires_at), expiresAtIso: row.expires_at,
          decidedBy: nz(row.decided_by), decidedAt: tsBogota(row.decided_at), decisionNote: nz(row.decision_note),
        };
      });
    }
  }
  let brandMediaAssets = []; let creativeGenerationJobs = []; let brandMediaUsages = [];
  let brandProductionPacks = []; let brandProductionPackAssets = [];
  if (brandMediaReady) {
    const brandMediaResults = await Promise.all([
      supabase.from("brand_media_assets")
        .select("id,name,media_type,source,product_id,figure,flavor,shot_type,orientation,contains_people,rights_status,rights_expires_at,ai_use_allowed,allowed_channels,status,storage_path,content_hash,mime_type,size_bytes,width,height,duration_seconds,tags,notes,original_asset_id,generation_meta,created_by,created_at,archived_by,archived_at")
        .in("status", ["Activo", "Archivado", "Bloqueado"])
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("creative_generation_jobs")
        .select(creativeIterationReady
          ? "id,creative_id,brief_id,provider,operation,status,input_asset_ids,target_channel,target_format,prompt,negative_prompt,brand_snapshot,output_spec,provider_job_id,output_asset_id,generation_cost,error_message,max_cost_cop,authorized_by,authorized_at,cancelled_by,cancelled_at,cancellation_reason,attempt_count,started_at,completed_at,output_review_status,output_review_feedback,output_reviewed_by,output_reviewed_at,revision_of_job_id,revision_number,created_by,created_at,updated_at"
          : creativeReviewReady
          ? "id,creative_id,brief_id,provider,operation,status,input_asset_ids,target_channel,target_format,prompt,negative_prompt,brand_snapshot,output_spec,provider_job_id,output_asset_id,generation_cost,error_message,max_cost_cop,authorized_by,authorized_at,cancelled_by,cancelled_at,cancellation_reason,attempt_count,started_at,completed_at,output_review_status,output_review_feedback,output_reviewed_by,output_reviewed_at,created_by,created_at,updated_at"
          : creativeProductionReady
          ? "id,creative_id,brief_id,provider,operation,status,input_asset_ids,target_channel,target_format,prompt,negative_prompt,brand_snapshot,output_spec,provider_job_id,output_asset_id,generation_cost,error_message,max_cost_cop,authorized_by,authorized_at,cancelled_by,cancelled_at,cancellation_reason,attempt_count,started_at,completed_at,created_by,created_at,updated_at"
          : "id,creative_id,brief_id,provider,operation,status,input_asset_ids,target_channel,target_format,prompt,negative_prompt,brand_snapshot,output_spec,provider_job_id,output_asset_id,generation_cost,error_message,created_by,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("brand_media_usages")
        .select("id,asset_id,job_id,creative_version_id,role,start_second,end_second,created_by,created_at")
        .order("created_at", { ascending: false }).limit(300),
    ]);
    const brandMediaError = brandMediaResults.find((result) => result.error);
    if (brandMediaError) throw new Error(brandMediaError.error.message);
    const [assetRows, jobRows, usageRows] = brandMediaResults.map((result) => result.data || []);
    // Los originales se firman cuando su miniatura entra al viewport. En esta
    // lectura solo se firman las salidas recientes que pueden requerir revision.
    const outputIds = new Set(jobRows.map((row) => String(row.output_asset_id || "")).filter(Boolean));
    const outputPaths = assetRows.filter((row) => outputIds.has(String(row.id))).map((row) => row.storage_path);
    let signedByPath = new Map();
    if (outputPaths.length) {
      const signed = await supabase.storage.from("brand-assets").createSignedUrls(outputPaths, 60 * 30);
      if (signed.error) throw new Error(`No se pudieron abrir los originales de marca: ${signed.error.message}`);
      signedByPath = new Map((signed.data || []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
    }
    brandMediaAssets = assetRows.map((row) => ({
      id: row.id, name: row.name, mediaType: row.media_type, source: row.source,
      productId: nz(row.product_id, null), productName: row.product_id ? (nombreProd[row.product_id] || "") : "",
      figure: nz(row.figure), flavor: nz(row.flavor), shotType: nz(row.shot_type), orientation: row.orientation,
      containsPeople: row.contains_people, rightsStatus: row.rights_status, rightsExpiresAt: nz(row.rights_expires_at),
      aiUseAllowed: row.ai_use_allowed, allowedChannels: row.allowed_channels || [], status: row.status,
      storagePath: row.storage_path, url: signedByPath.get(row.storage_path) || "", contentHash: row.content_hash,
      mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height), durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
      tags: row.tags || [], notes: nz(row.notes), originalAssetId: row.original_asset_id,
      generationMeta: row.generation_meta || {}, createdBy: row.created_by, createdAt: tsBogota(row.created_at),
      archivedBy: nz(row.archived_by), archivedAt: tsBogota(row.archived_at),
    }));
    creativeGenerationJobs = jobRows.map((row) => ({
      id: row.id, creativeId: nz(row.creative_id), briefId: row.brief_id, provider: row.provider,
      operation: row.operation, status: row.status, inputAssetIds: row.input_asset_ids || [],
      targetChannel: row.target_channel, targetFormat: row.target_format, prompt: row.prompt,
      negativePrompt: nz(row.negative_prompt), brandSnapshot: row.brand_snapshot || {}, outputSpec: row.output_spec || {},
      providerJobId: nz(row.provider_job_id), outputAssetId: row.output_asset_id,
      generationCost: Number(row.generation_cost), errorMessage: nz(row.error_message),
      maxCostCop: Number(row.max_cost_cop), authorizedBy: nz(row.authorized_by), authorizedAt: tsBogota(row.authorized_at),
      cancelledBy: nz(row.cancelled_by), cancelledAt: tsBogota(row.cancelled_at), cancellationReason: nz(row.cancellation_reason),
      attemptCount: Number(row.attempt_count), startedAt: tsBogota(row.started_at), completedAt: tsBogota(row.completed_at),
      outputReviewStatus: nz(row.output_review_status, row.status === "Completado" ? "Pendiente" : "No aplica"),
      outputReviewFeedback: nz(row.output_review_feedback), outputReviewedBy: nz(row.output_reviewed_by),
      outputReviewedAt: tsBogota(row.output_reviewed_at),
      revisionOfJobId: row.revision_of_job_id, revisionNumber: Number(row.revision_number || 1),
      createdBy: row.created_by, createdAt: tsBogota(row.created_at), updatedAt: tsBogota(row.updated_at),
    }));
    brandMediaUsages = usageRows.map((row) => ({
      id: row.id, assetId: row.asset_id, jobId: row.job_id, creativeVersionId: row.creative_version_id,
      role: row.role, startSecond: row.start_second == null ? null : Number(row.start_second),
      endSecond: row.end_second == null ? null : Number(row.end_second), createdBy: row.created_by,
      createdAt: tsBogota(row.created_at),
    }));
    if (brandProductionReady) {
      const productionResults = await Promise.all([
        supabase.from("brand_asset_production_profiles")
          .select("asset_id,component_type,view_angle,physical_state,interaction_type,hand_assignment,location_name,light_direction,scale_reference,continuity_notes,source_quality,qa_status,qa_notes,consent_status,canonical,created_by,created_at,updated_by,updated_at"),
        supabase.from("brand_production_packs")
          .select("id,name,purpose,version,status,product_id,figure,channel,target_format,description,requirements,fingerprint,created_by,created_at,reviewed_by,reviewed_at,review_note")
          .neq("status", "Archivado").order("created_at", { ascending: false }).limit(100),
        supabase.from("brand_production_pack_assets")
          .select("pack_id,asset_id,role,sequence,required,notes,added_by,added_at")
          .order("pack_id", { ascending: false }).order("sequence", { ascending: true }).limit(500),
      ]);
      const productionError = productionResults.find((result) => result.error);
      if (productionError) throw new Error(productionError.error.message);
      const [profileRows, packRows, packAssetRows] = productionResults.map((result) => result.data || []);
      const profileByAsset = new Map(profileRows.map((row) => [String(row.asset_id), {
        assetId: row.asset_id, componentType: row.component_type, viewAngle: row.view_angle,
        physicalState: row.physical_state, interactionType: row.interaction_type,
        handAssignment: row.hand_assignment, locationName: nz(row.location_name),
        lightDirection: nz(row.light_direction), scaleReference: nz(row.scale_reference),
        continuityNotes: nz(row.continuity_notes), sourceQuality: row.source_quality,
        qaStatus: row.qa_status, qaNotes: nz(row.qa_notes), consentStatus: row.consent_status,
        canonical: row.canonical, createdBy: row.created_by, createdAt: tsBogota(row.created_at),
        updatedBy: row.updated_by, updatedAt: tsBogota(row.updated_at),
      }]));
      brandMediaAssets = brandMediaAssets.map((asset) => ({
        ...asset, productionProfile: profileByAsset.get(String(asset.id)) || null,
      }));
      brandProductionPacks = packRows.map((row) => ({
        id: row.id, name: row.name, purpose: row.purpose, version: Number(row.version), status: row.status,
        productId: nz(row.product_id, null), figure: nz(row.figure), channel: row.channel,
        targetFormat: row.target_format, description: nz(row.description), requirements: row.requirements || {},
        fingerprint: row.fingerprint, createdBy: row.created_by, createdAt: tsBogota(row.created_at),
        reviewedBy: nz(row.reviewed_by), reviewedAt: tsBogota(row.reviewed_at), reviewNote: nz(row.review_note),
      }));
      brandProductionPackAssets = packAssetRows.map((row) => ({
        packId: row.pack_id, assetId: row.asset_id, role: row.role, sequence: Number(row.sequence),
        required: row.required, notes: nz(row.notes), addedBy: row.added_by, addedAt: tsBogota(row.added_at),
      }));
    }
  }

  // Centro de Integraciones (migración 23). La app solo lee estado, salud y
  // referencia de cuenta; los secretos permanecen en el runtime del servidor.
  let agencyIntegrationsReady = false; let agencyIntegrations = []; let creativeConnectorRuns = [];
  let higgsfieldConnectorReady = false; let klingConnectorReady = false;
  if (creativeProductionReady) {
    const integrationsProbe = await capabilityResult("integraciones_agencia_disponibles");
    const integrationsProbeMissing = integrationsProbe.error &&
      (integrationsProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(integrationsProbe.error.message || ""));
    if (integrationsProbe.error && !integrationsProbeMissing) throw new Error(integrationsProbe.error.message);
    agencyIntegrationsReady = !integrationsProbeMissing && integrationsProbe.data === true;
    if (agencyIntegrationsReady) {
      const higgsfieldProbe = await capabilityResult("higgsfield_conector_disponible");
      const higgsfieldProbeMissing = higgsfieldProbe.error &&
        (higgsfieldProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(higgsfieldProbe.error.message || ""));
      if (higgsfieldProbe.error && !higgsfieldProbeMissing) throw new Error(higgsfieldProbe.error.message);
      higgsfieldConnectorReady = !higgsfieldProbeMissing && higgsfieldProbe.data === true;
      const klingProbe = await capabilityResult("kling_conector_disponible");
      const klingProbeMissing = klingProbe.error &&
        (klingProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(klingProbe.error.message || ""));
      if (klingProbe.error && !klingProbeMissing) throw new Error(klingProbe.error.message);
      klingConnectorReady = !klingProbeMissing && klingProbe.data === true;
      const integrationsResult = await supabase.from("agency_integrations")
        .select(higgsfieldConnectorReady || klingConnectorReady
          ? "provider,kind,status,environment,account_label,external_account_id,capabilities,secret_configured,last_heartbeat_at,last_sync_at,last_error,configured_by,updated_at,worker_version,last_job_at,successful_jobs,failed_jobs"
          : "provider,kind,status,environment,account_label,external_account_id,capabilities,secret_configured,last_heartbeat_at,last_sync_at,last_error,configured_by,updated_at")
        .order("provider");
      if (integrationsResult.error) throw new Error(integrationsResult.error.message);
      agencyIntegrations = (integrationsResult.data || []).map((row) => ({
        provider: row.provider, kind: row.kind, status: row.status, environment: row.environment,
        accountLabel: nz(row.account_label), externalAccountId: nz(row.external_account_id),
        capabilities: row.capabilities || [], secretConfigured: row.secret_configured,
        lastHeartbeatAt: nz(row.last_heartbeat_at), lastSyncAt: nz(row.last_sync_at),
        lastError: nz(row.last_error), configuredBy: nz(row.configured_by), updatedAt: nz(row.updated_at),
        workerVersion: nz(row.worker_version), lastJobAt: nz(row.last_job_at),
        successfulJobs: Number(row.successful_jobs || 0), failedJobs: Number(row.failed_jobs || 0),
      }));
      if (higgsfieldConnectorReady || klingConnectorReady) {
        const runsResult = await supabase.from("creative_connector_runs")
          .select("id,job_id,provider,worker_id,state,provider_job_id,estimated_cost_cop,actual_cost_cop,error_message,metadata,leased_at,lease_expires_at,started_at,finished_at")
          .order("leased_at", { ascending: false }).limit(50);
        if (runsResult.error) throw new Error(runsResult.error.message);
        creativeConnectorRuns = (runsResult.data || []).map((row) => ({
          id: row.id, jobId: row.job_id, provider: row.provider, workerId: row.worker_id, state: row.state,
          providerJobId: nz(row.provider_job_id), estimatedCostCop: Number(row.estimated_cost_cop || 0),
          actualCostCop: Number(row.actual_cost_cop || 0), errorMessage: nz(row.error_message), metadata: row.metadata || {},
          leasedAt: nz(row.leased_at), leaseExpiresAt: nz(row.lease_expires_at), startedAt: nz(row.started_at), finishedAt: nz(row.finished_at),
        }));
      }
    }
  }

  const brandGovernanceProbe = await capabilityResult("gobernanza_marca_disponible");
  const brandGovernanceProbeMissing = brandGovernanceProbe.error &&
    (brandGovernanceProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(brandGovernanceProbe.error.message || ""));
  if (brandGovernanceProbe.error && !brandGovernanceProbeMissing) throw new Error(brandGovernanceProbe.error.message);
  const agencyBrandGovernanceReady = !brandGovernanceProbeMissing && brandGovernanceProbe.data === true;
  let agencyBrandProfile = null; let agencyBrandGateBindings = [];
  if (agencyBrandGovernanceReady) {
    const [profileResult, gatesResult] = await Promise.all([
      supabase.rpc("obtener_perfil_marca_activo"),
      supabase.from("agency_brand_gate_bindings")
        .select("id,target_type,target_key,brand_profile_id,brand_fingerprint,target_fingerprint,human_reviewed_by,passed_at")
        .order("passed_at", { ascending: false }).limit(200),
    ]);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (gatesResult.error) throw new Error(gatesResult.error.message);
    agencyBrandProfile = profileResult.data && Object.keys(profileResult.data).length ? {
      id: profileResult.data.id, version: Number(profileResult.data.version), status: profileResult.data.status,
      profile: profileResult.data.profile || {}, fingerprint: nz(profileResult.data.fingerprint),
      approvedAt: tsBogota(profileResult.data.approved_at),
    } : null;
    agencyBrandGateBindings = (gatesResult.data || []).map((row) => ({
      id: row.id, targetType: row.target_type, targetKey: row.target_key,
      brandProfileId: row.brand_profile_id, brandFingerprint: row.brand_fingerprint,
      targetFingerprint: row.target_fingerprint, humanReviewedBy: row.human_reviewed_by,
      passedAt: tsBogota(row.passed_at),
    }));
  }

  const growthProbe = await capabilityResult("motor_crecimiento_multimodo_disponible");
  const growthProbeMissing = growthProbe.error &&
    (growthProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(growthProbe.error.message || ""));
  if (growthProbe.error && !growthProbeMissing) throw new Error(growthProbe.error.message);
  const agencyGrowthReady = !growthProbeMissing && growthProbe.data === true;
  let agencyGrowthPolicies = []; let agencyGrowthSnapshots = []; let agencyGrowthSelections = [];
  if (agencyGrowthReady) {
    const [policiesResult, snapshotsResult, selectionsResult] = await Promise.all([
      supabase.from("agency_growth_mode_policies").select("mode_key,label,channel_mode,objective,controls,version,active,updated_at").eq("active", true).order("mode_key"),
      supabase.from("agency_growth_snapshots").select("id,snapshot_key,engine_version,generated_for,facts,modes,recommended_mode,policy_snapshot,snapshot_fingerprint,prepared_by,prepared_at").order("prepared_at", { ascending: false }).limit(30),
      supabase.from("agency_growth_selections").select("id,snapshot_id,mode_key,objective,status,selected_by,selected_at,external_execution").order("selected_at", { ascending: false }).limit(30),
    ]);
    if (policiesResult.error) throw new Error(policiesResult.error.message);
    if (snapshotsResult.error) throw new Error(snapshotsResult.error.message);
    if (selectionsResult.error) throw new Error(selectionsResult.error.message);
    agencyGrowthPolicies = (policiesResult.data || []).map((row) => ({ modeKey: row.mode_key, label: row.label, channelMode: row.channel_mode,
      objective: row.objective, controls: row.controls || {}, version: Number(row.version), active: row.active, updatedAt: tsBogota(row.updated_at) }));
    agencyGrowthSnapshots = (snapshotsResult.data || []).map((row) => ({ id: row.id, snapshotKey: row.snapshot_key,
      engineVersion: Number(row.engine_version), generatedFor: row.generated_for, facts: row.facts || {}, modes: row.modes || [],
      recommendedMode: row.recommended_mode, policy: row.policy_snapshot || {}, fingerprint: row.snapshot_fingerprint,
      preparedBy: row.prepared_by, preparedAt: tsBogota(row.prepared_at) }));
    agencyGrowthSelections = (selectionsResult.data || []).map((row) => ({ id: row.id, snapshotId: row.snapshot_id,
      modeKey: row.mode_key, objective: row.objective, status: row.status, selectedBy: row.selected_by,
      selectedAt: tsBogota(row.selected_at), externalExecution: row.external_execution }));
  }

  const creativeFlowProbe = await capabilityResult("flujo_creativo_e2e_disponible");
  const creativeFlowProbeMissing = creativeFlowProbe.error &&
    (creativeFlowProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(creativeFlowProbe.error.message || ""));
  if (creativeFlowProbe.error && !creativeFlowProbeMissing) throw new Error(creativeFlowProbe.error.message);
  const agencyCreativeFlowReady = !creativeFlowProbeMissing && creativeFlowProbe.data === true;
  let agencyMasterReleases = []; let agencyMasterReleaseEvents = [];
  if (agencyCreativeFlowReady) {
    const [releasesResult, eventsResult] = await Promise.all([
      supabase.from("agency_master_releases")
        .select("id,release_key,contract_id,storyboard_id,export_id,output_asset_id,creative_id,post_id,distribution_id,content_mode,status,lineage_snapshot,lineage_fingerprint,prepared_by,prepared_at,updated_at")
        .order("updated_at", { ascending: false }).limit(100),
      supabase.from("agency_master_release_events")
        .select("id,release_id,event_type,target_key,event_snapshot,event_fingerprint,recorded_by,recorded_at")
        .order("recorded_at", { ascending: false }).limit(300),
    ]);
    if (releasesResult.error) throw new Error(releasesResult.error.message);
    if (eventsResult.error) throw new Error(eventsResult.error.message);
    agencyMasterReleases = (releasesResult.data || []).map((row) => ({
      id: row.id, releaseKey: row.release_key, contractId: row.contract_id, storyboardId: row.storyboard_id,
      exportId: row.export_id, outputAssetId: row.output_asset_id, creativeId: row.creative_id,
      postId: nz(row.post_id), distributionId: row.distribution_id, contentMode: row.content_mode,
      status: row.status, lineageSnapshot: row.lineage_snapshot || {}, lineageFingerprint: row.lineage_fingerprint,
      preparedBy: row.prepared_by, preparedAt: tsBogota(row.prepared_at), updatedAt: tsBogota(row.updated_at),
    }));
    agencyMasterReleaseEvents = (eventsResult.data || []).map((row) => ({
      id: row.id, releaseId: row.release_id, eventType: row.event_type, targetKey: row.target_key,
      eventSnapshot: row.event_snapshot || {}, eventFingerprint: row.event_fingerprint,
      recordedBy: row.recorded_by, recordedAt: tsBogota(row.recorded_at),
    }));
  }

  return { products, productsServerReady, inventory_items, inventory_lots, inventoryLotsReady: !lotsMissing, recipes, users, multipleRolesReady, settingsCatalogos, brand_library, figuras, subrecetas, subreceta_ingredientes, figura_relleno, campaigns, creatives, content_calendar, creative_results,
    agencyServerReady, agencySettings, agencyBriefs, agencyDecisions, agencyCreativeVersions, marketingIdeas, marketingGuiones, marketingMensajes, marketingTasks,
    agencyOrchestratorReady, agencyAgentRuns, agencyAgentProposals, agencyActionQueueReady, agencyActionQueue,
    agencyActionOutcomesReady, agencyActionOutcomes,
    agencyCollaborationReady, agencyCollaborationRooms, agencyCollaborationEntries, agencyCreativeContracts,
    agencySceneStudioReady, agencyStoryboards, agencyStoryboardShots, agencyMotionReady, agencyMotionPlans, agencyMotionRecipes,
    agencyMotionObservations, agencySceneRouterReady, agencySceneRoutingPlans,
    agencyQualityReady, agencySceneQualityReviews, agencyPostproductionPackages,
    agencyPostproductionExportReady, agencyPostproductionExports, agencyPostproductionWorkers,
    agencyPostproductionAudioReady, agencyPostproductionAudioBindings,
    agencyRetentionReady, agencyRetentionScripts, agencyRetentionHooks, agencyRetentionLoops, agencyRetentionExperiments, agencyRetentionMeasurements,
    agencyLoopLearningReady, agencyRetentionDiagnostics, agencyRetentionLearnings,
    agencyMetaReady, agencyMetaPolicies, agencyMetaSnapshots, agencyMetaDiagnostics,
    agencyMetaIncrementalityReady, agencyMetaLiftStudies, agencyMetaLiftMeasurements,
    agencyMetaInvestmentReady, agencyMetaInvestmentScenarios,
    agencyMetaAuthorizationReady, agencyMetaInvestmentAuthorizations, agencyMetaInvestmentExecutionJobs,
    agencyMetaConnectorReady, agencyMetaConnectorDryRuns,
    distributionServerReady, content_distributions, distributionConnectorReady, distributionConnectorJobs, brandMediaReady, mundoAnimadoReady, officialLogoDeletionReady, brandProductionReady, brandProductionPacks, brandProductionPackAssets, creativeProductionReady, creativeReviewReady, creativeIterationReady, mcpHumanApprovalReady, mcpHumanApprovals, brandMediaAssets, creativeGenerationJobs, brandMediaUsages,
    agencyIntegrationsReady, agencyIntegrations, higgsfieldConnectorReady, klingConnectorReady, creativeConnectorRuns,
    agencyBrandGovernanceReady, agencyBrandProfile, agencyBrandGateBindings,
    agencyGrowthReady, agencyGrowthPolicies, agencyGrowthSnapshots, agencyGrowthSelections,
    agencyCreativeFlowReady, agencyMasterReleases, agencyMasterReleaseEvents };
}

/* ── Fase 3 · slice 3a/3d: lecturas OPERATIVAS desde Supabase ──
   El servidor es el dueño del ciclo de pedido: orders, order_items (+adiciones),
   customers, deliveries, evidences (signed URLs), benefits, claims, y el rastro de
   inventario del ciclo (movements, reservations, suggestions) + audit.
   Slice 4 suma production_batches (lotes) — antes de migrar sus escrituras, porque
   escribir sin leer haría que el primer refetch post-escritura PISARA los lotes
   locales con un array vacío (misma clase de bug que 3b/3c evitaron).
   Vacío es LEGÍTIMO acá (la operación real arranca en 0). */

export async function fetchOperativo() {
  const syncManifest = await fetchSyncManifest();
  const orderDeltaReady = syncManifest?.capabilities?.pedidos_deltas_disponibles === true;
  const finishedInventoryDeltaReady = syncManifest?.capabilities?.producto_terminado_deltas_disponibles === true;
  const operationalSnapshot = await optionalSnapshot("momos_operational_snapshot_v1");
  const operationalKeys = [
    "orders", "order_items", "order_item_adiciones", "customers", "deliveries", "evidences", "benefits",
    "claims", "inventory_movements", "inventory_reservations", "production_suggestions", "audit_logs",
    "users_lookup", "inventory_lookup", "products_lookup", "production_batches", "lote_figuras",
    "subreceta_producciones", "variantes",
  ];
  const q = operationalSnapshot
    ? operationalKeys.map((key) => ({ data: operationalSnapshot[key] || [], error: null }))
    : await Promise.all([
    supabase.from("orders").select("id,fecha,hora,canal,customer_id,barrio,direccion,zona,dom_cobrado,dom_costo,descuento,benefit_id,pago,comprobante,estado,obs,pagado_en,metricas_cliente_actualizadas,campaign_id,creative_id,origen_detalle").order("fecha", { ascending: false }).order("hora", { ascending: false }).limit(100),
    supabase.from("order_items").select("id,order_id,product_id,nombre,sabor,salsa,relleno,figura,cant,precio,costo_unitario,es_caja,parent_item_id,caja_num,es_sub_momo").order("id", { ascending: false }).limit(500),
    supabase.from("order_item_adiciones").select("order_item_id,nombre,precio,cant,insumo_id,insumo_cant"),
    supabase.from("customers").select("id,nombre,telefono,instagram,barrio,direccion,canal,primera,ultima,total,pedidos,cumple,favoritos,estado,notas").order("ultima", { ascending: false, nullsFirst: false }).limit(250),
    supabase.from("deliveries").select("id,order_id,proveedor,costo_real,cobrado,zona,h_solicitud,h_salida,h_entrega,codigo,estado,obs").order("id", { ascending: false }).limit(100),
    supabase.from("evidences").select("id,order_id,tipo,storage_path,fecha,user_id").order("fecha", { ascending: false }).limit(150),
    supabase.from("benefits").select("id,customer_id,beneficio,tipo_beneficio,valor,producto_gratis_id,condicion,minimo,activacion,vence,estado,pedido_uso,obs").order("id", { ascending: false }).limit(100),
    supabase.from("claims").select("id,order_id,customer_id,fecha,tipo,entregado_en,reclamo_en,descr,resp,decision,solucion,costo,estado,evidencia").order("id", { ascending: false }).limit(100),
    supabase.from("inventory_movements").select("id,fecha,tipo,item_id,cant,nota").order("fecha", { ascending: false }).limit(50),
    supabase.from("inventory_reservations").select("id,order_id,tipo,product_id,item_id,nombre,cantidad,fecha,estado,batch_id,figura").order("id", { ascending: false }).limit(150),
    supabase.from("production_suggestions").select("id,fecha,product_id,item_id,cantidad,motivo,order_id,estado,area,order_item_id").order("id", { ascending: false }).limit(100),
    supabase.from("audit_logs").select("id,fecha,user_id,entidad,entidad_id,accion,de,a").order("fecha", { ascending: false }).limit(50),
    supabase.from("users").select("id,rol,nombre"),
    supabase.from("inventory_items").select("id,nombre,unidad"),
    supabase.from("products").select("id,nombre"),
    supabase.from("production_batches").select("id,fecha,product_id,figura,sabor,relleno,salsa,gramaje_g,prod,perfectas,imperfectas,descartadas,destino,resp_user_id,vence,estado,stock_contabilizado,horas_congelacion,inicio_congelacion,molde,ubicacion,obs,corrida_id,figuras").order("id", { ascending: false }).limit(100),
    supabase.from("lote_figuras").select("batch_id,figura,cant,perfectas,imperfectas,descartadas,consumidas").order("batch_id", { ascending: false }),
    supabase.from("subreceta_producciones").select("id,fecha,subreceta_id,gramos_nominales,gramos_obtenidos,costo_batch,faltantes,resp_user_id,obs,created_at").order("created_at", { ascending: false }).limit(50),
    supabase.from("v_variantes_disponibles").select("product_id,producto,figura,sabor,gramaje_g,disponibles,vencimiento_proximo").order("producto").order("figura").order("sabor"),
  ]);
  const conError = q.find((r) => r.error);
  if (conError) throw new Error(conError.error.message);
  const [ords, items, adics, custs, delivs, evids, bens, clms, movs, resvs, sugs, audits, usrs, invs, prods, batches, loteFiguraRows, subProds, variantesRows] = q.map((r) => r.data);

  // Empaque trazable se despliega después del paquete 01-08. Mientras la
  // migración 09 todavía no exista, la lectura opcional queda vacía y no rompe
  // el resto de la operación durante el rollout.
  const packingResult = operationalSnapshot
    ? { data: operationalSnapshot.packing_verifications || [], error: null }
    : await supabase
      .from("packing_verifications")
      .select("order_id,user_id,verified_at,line_ids,order_signature,snapshot")
      .order("verified_at", { ascending: false }).limit(100);
  const packingMissing = packingResult.error && ["42P01", "PGRST205"].includes(packingResult.error.code);
  if (packingResult.error && !packingMissing) throw new Error(packingResult.error.message);
  const packingRows = packingMissing ? [] : (packingResult.data || []);

  // Control operativo (migración 14) es opcional durante el rollout. La sonda
  // evita consultar tablas inexistentes y mantiene utilizable la versión 13.
  const operationalProbe = await capabilityResult("operacion_pedido_disponible");
  const operationalProbeMissing = operationalProbe.error
    && (operationalProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(operationalProbe.error.message || ""));
  if (operationalProbe.error && !operationalProbeMissing) throw new Error(operationalProbe.error.message);
  const operationalControlReady = !operationalProbeMissing && operationalProbe.data === true;
  let assignmentRows = []; let progressRows = []; let incidentRows = []; let handoffRows = [];
  if (operationalControlReady && operationalSnapshot) {
    assignmentRows = operationalSnapshot.order_stage_assignments || [];
    progressRows = operationalSnapshot.order_line_progress || [];
    incidentRows = operationalSnapshot.order_incidents || [];
    handoffRows = operationalSnapshot.order_dispatch_handoffs || [];
  } else if (operationalControlReady) {
    const operationalResults = await Promise.all([
      supabase.from("order_stage_assignments").select("id,order_id,stage,user_id,status,claimed_at,released_at,release_reason").order("claimed_at", { ascending: false }).limit(150),
      supabase.from("order_line_progress").select("order_item_id,order_id,stage,status,user_id,updated_at,version").order("updated_at", { ascending: false }).limit(500),
      supabase.from("order_incidents").select("id,order_id,order_item_id,area,type,description,status,created_by,created_at,resolved_by,resolved_at,resolution").order("created_at", { ascending: false }).limit(100),
      supabase.from("order_dispatch_handoffs").select("order_id,status,packing_user_id,logistics_user_id,offered_at,accepted_at,package_signature,note,version").order("offered_at", { ascending: false }).limit(100),
    ]);
    const operationalError = operationalResults.find((result) => result.error);
    if (operationalError) throw new Error(operationalError.error.message);
    [assignmentRows, progressRows, incidentRows, handoffRows] = operationalResults.map((result) => result.data || []);
  }

  // CRM v2 (migración 15) también es opcional durante el despliegue. El CRM
  // histórico sigue visible con customers/orders aunque estas tablas aún no existan.
  const crmProbe = await capabilityResult("crm_clientes_disponible");
  const crmProbeMissing = crmProbe.error
    && (crmProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(crmProbe.error.message || ""));
  if (crmProbe.error && !crmProbeMissing) throw new Error(crmProbe.error.message);
  const crmServerReady = !crmProbeMissing && crmProbe.data === true;
  let crmProfileRows = []; let contactRows = []; let activationRows = [];
  if (crmServerReady && operationalSnapshot) {
    crmProfileRows = operationalSnapshot.customer_crm_profiles || [];
    contactRows = operationalSnapshot.customer_contacts || [];
    activationRows = operationalSnapshot.customer_activations || [];
  } else if (crmServerReady) {
    const crmResults = await Promise.all([
      supabase.from("customer_crm_profiles").select("customer_id,contact_allowed,contact_reason,preferred_channel,acquisition_source,referred_by_customer_id,updated_by,updated_at"),
      supabase.from("customer_contacts").select("id,customer_id,channel,reason,outcome,notes,follow_up_on,activation_id,order_id,created_by,created_at").order("created_at", { ascending: false }).limit(100),
      supabase.from("customer_activations").select("id,customer_id,type,title,message,status,benefit_id,expires_on,converted_order_id,created_by,created_at,updated_at").order("created_at", { ascending: false }).limit(100),
    ]);
    const crmError = crmResults.find((result) => result.error);
    if (crmError) throw new Error(crmError.error.message);
    [crmProfileRows, contactRows, activationRows] = crmResults.map((result) => result.data || []);
  }

  // La cuarentena aparece con la migración 11. Es opcional durante el rollout
  // para que el front siga cargando entre la publicación y la ejecución SQL.
  const quarantineResult = operationalSnapshot
    ? { data: operationalSnapshot.variantes_cuarentena || [], error: null }
    : await supabase
      .from("v_variantes_cuarentena")
      .select("product_id,producto,figura,sabor,gramaje_g,disponibles,vencimiento_proximo")
      .order("producto").order("figura").order("sabor");
  const quarantineMissing = quarantineResult.error && ["42P01", "PGRST205"].includes(quarantineResult.error.code);
  if (quarantineResult.error && !quarantineMissing) throw new Error(quarantineResult.error.message);
  const quarantineRows = quarantineMissing ? [] : (quarantineResult.data || []);

  const rolDe = {}; const nombreUserDe = {}; usrs.forEach((u) => { rolDe[u.id] = u.rol; nombreUserDe[u.id] = u.nombre; });
  const insumoDe = {}; invs.forEach((i) => { insumoDe[i.id] = i; });
  const productoDe = {}; prods.forEach((p) => { productoDe[p.id] = p; });

  const orders = ords.map((o) => ({
    id: o.id, fecha: o.fecha, hora: hhmm(o.hora), canal: o.canal,
    customerId: nz(o.customer_id), barrio: nz(o.barrio), direccion: nz(o.direccion), zona: nz(o.zona),
    domCobrado: o.dom_cobrado, domCosto: o.dom_costo, descuento: o.descuento,
    benefitId: nz(o.benefit_id), pago: nz(o.pago), comprobante: o.comprobante,
    estado: o.estado, obs: nz(o.obs),
    pagadoEn: o.pagado_en ? tsBogota(o.pagado_en) : undefined, // undefined, NO '' (los guards usan truthiness)
    metricasClienteActualizadas: o.metricas_cliente_actualizadas,
    campaignId: nz(o.campaign_id), creativeId: nz(o.creative_id), origenDetalle: nz(o.origen_detalle),
  }));

  const adicionesDe = {};
  adics.forEach((a) => {
    (adicionesDe[a.order_item_id] = adicionesDe[a.order_item_id] || []).push({
      nombre: a.nombre, precio: Number(a.precio), cant: Number(a.cant), insumoId: nz(a.insumo_id), insumoCant: Number(a.insumo_cant),
    });
  });
  const order_items = items.map((i) => ({
    id: i.id, orderId: i.order_id, productId: i.product_id, nombre: i.nombre,
    sabor: nz(i.sabor), salsa: nz(i.salsa), relleno: nz(i.relleno), figura: nz(i.figura),
    cant: i.cant, precio: i.precio, costoUnitario: i.costo_unitario, // COGS congelado server-side: jamás recalcular
    adiciones: adicionesDe[i.id] || [],
    esCaja: i.es_caja, esSubMomo: i.es_sub_momo,
    parentItemId: i.parent_item_id ?? undefined, cajaNum: i.caja_num ?? undefined,
  }));

  const customers = custs.map((c) => ({
    id: c.id, nombre: c.nombre, telefono: nz(c.telefono), instagram: nz(c.instagram),
    barrio: nz(c.barrio), direccion: nz(c.direccion), canal: nz(c.canal),
    primera: nz(c.primera), ultima: nz(c.ultima), total: c.total, pedidos: c.pedidos,
    cumple: nz(c.cumple), favoritos: nz(c.favoritos), estado: c.estado, notas: nz(c.notas),
  }));

  const deliveries = delivs.map((d) => ({
    id: d.id, orderId: d.order_id, proveedor: d.proveedor, costoReal: d.costo_real, cobrado: d.cobrado,
    zona: nz(d.zona), hSolicitud: hhmm(d.h_solicitud), hSalida: hhmm(d.h_salida), hEntrega: hhmm(d.h_entrega),
    codigo: nz(d.codigo), estado: d.estado, obs: nz(d.obs),
  }));

  // Evidencias: solo metadatos durante la sincronización. La URL privada se
  // firma por 15 minutos cuando una persona abre la evidencia exacta.
  const evidences = evids.map((e) => ({
    id: e.id, orderId: e.order_id, tipo: e.tipo,
    storagePath: nz(e.storage_path), url: "",
    fecha: fechaBogota(e.fecha), hora: horaBogota(e.fecha),
    user: nz(rolDe[e.user_id]), // la maqueta guarda el ROL del que subió
  }));

  const benefits = bens.map((b) => ({
    id: b.id, customerId: b.customer_id, beneficio: b.beneficio, tipoBeneficio: b.tipo_beneficio,
    valor: b.valor, productoGratisId: nz(b.producto_gratis_id), condicion: nz(b.condicion), minimo: b.minimo,
    activacion: nz(b.activacion), vence: nz(b.vence), estado: b.estado, pedidoUso: nz(b.pedido_uso), obs: nz(b.obs),
  }));

  const claims = clms.map((c) => ({
    id: c.id, orderId: c.order_id, customerId: nz(c.customer_id), fecha: c.fecha, tipo: c.tipo,
    hEntrega: horaBogota(c.entregado_en), hReclamo: horaBogota(c.reclamo_en), // legacy HH:MM
    entregadoEn: tsBogota(c.entregado_en), reclamoEn: tsBogota(c.reclamo_en), // canónicos (ventana de 20 min)
    desc: nz(c.descr), resp: nz(c.resp), decision: nz(c.decision), solucion: nz(c.solucion),
    costo: c.costo, estado: c.estado, evidencia: nz(c.evidencia),
  }));

  const inventory_movements = movs.map((m) => {
    const it = insumoDe[m.item_id];
    const n = Number(m.cant);
    return {
      id: m.id, fecha: tsBogota(m.fecha), tipo: m.tipo,
      item: it ? it.nombre : "", cant: (n > 0 ? "+" : "") + n + " " + (it ? it.unidad : ""),
      nota: nz(m.nota),
    };
  });

  const inventory_reservations = resvs.map((r) => ({
    id: r.id, orderId: r.order_id, tipo: r.tipo,
    refId: r.tipo === "producto" ? nz(r.product_id) : nz(r.item_id),
    nombre: r.nombre, cantidad: r.cantidad, fecha: tsBogota(r.fecha), estado: r.estado,
    // Variantes 1b: lote físico asignado por el FIFO al pagar (null en remanente
    // a producir, legacy sin lote_figuras, o tipo empaque/insumo).
    batchId: nz(r.batch_id), figuraLote: nz(r.figura),
  }));

  const production_suggestions = sugs.map((s) => ({
    id: s.id, fecha: s.fecha,
    producto: s.area === "Inventario" ? (insumoDe[s.item_id] ? insumoDe[s.item_id].nombre : "") : (productoDe[s.product_id] ? productoDe[s.product_id].nombre : ""),
    cantidad: s.cantidad, motivo: nz(s.motivo), orderId: nz(s.order_id), estado: s.estado, area: s.area,
    itemId: nz(s.item_id),
    productId: nz(s.product_id), // Variantes 3: lookup del colchón del producto en el front

    // Variantes 2: item del pedido que espera — figura/sabor pedidos se
    // resuelven contra db.order_items (la cola del server asigna con esto).
    orderItemId: nz(s.order_item_id),
  }));

  const audit_logs = audits.map((a) => ({
    id: a.id, fecha: tsBogota(a.fecha), user: nz(rolDe[a.user_id]),
    entidad: a.entidad, entidadId: nz(a.entidad_id), accion: a.accion, de: nz(a.de), a: nz(a.a),
  }));
  const desmoldadoEnDe = {};
  audit_logs.forEach((log) => {
    if (log.entidad !== "Lote" || !/desmoldado/i.test(log.accion || "")) return;
    if (!desmoldadoEnDe[log.entidadId] || log.fecha < desmoldadoEnDe[log.entidadId]) {
      desmoldadoEnDe[log.entidadId] = log.fecha;
    }
  });

  const packing_verifications = packingRows.map((verification) => ({
    orderId: verification.order_id,
    userId: verification.user_id,
    user: nz(nombreUserDe[verification.user_id], nz(rolDe[verification.user_id], "Empaque")),
    verifiedAt: tsBogota(verification.verified_at),
    lineIds: verification.line_ids || [],
    orderSignature: verification.order_signature,
    snapshot: verification.snapshot || [],
  }));

  const order_stage_assignments = assignmentRows.map((row) => ({
    id: row.id, orderId: row.order_id, stage: row.stage, userId: row.user_id,
    user: nz(nombreUserDe[row.user_id]), status: row.status, claimedAt: tsBogota(row.claimed_at),
    releasedAt: tsBogota(row.released_at), releaseReason: nz(row.release_reason),
  }));
  const order_line_progress = progressRows.map((row) => ({
    orderItemId: row.order_item_id, orderId: row.order_id, stage: row.stage,
    status: row.status, userId: row.user_id, user: nz(nombreUserDe[row.user_id]),
    updatedAt: tsBogota(row.updated_at), version: Number(row.version),
  }));
  const order_incidents = incidentRows.map((row) => ({
    id: row.id, orderId: row.order_id, orderItemId: nz(row.order_item_id), area: row.area,
    type: row.type, description: row.description, status: row.status,
    createdBy: row.created_by, createdByName: nz(nombreUserDe[row.created_by]), createdAt: tsBogota(row.created_at),
    resolvedBy: nz(row.resolved_by), resolvedAt: tsBogota(row.resolved_at), resolution: nz(row.resolution),
  }));
  const order_dispatch_handoffs = handoffRows.map((row) => ({
    orderId: row.order_id, status: row.status, packingUserId: row.packing_user_id,
    packingUser: nz(nombreUserDe[row.packing_user_id]), logisticsUserId: nz(row.logistics_user_id),
    logisticsUser: nz(nombreUserDe[row.logistics_user_id]), offeredAt: tsBogota(row.offered_at),
    acceptedAt: tsBogota(row.accepted_at), packageSignature: row.package_signature,
    note: nz(row.note), version: Number(row.version),
  }));

  const customer_crm_profiles = crmProfileRows.map((row) => ({
    customerId: row.customer_id, contactAllowed: row.contact_allowed, contactReason: nz(row.contact_reason),
    preferredChannel: row.preferred_channel, acquisitionSource: nz(row.acquisition_source),
    referredByCustomerId: nz(row.referred_by_customer_id), updatedBy: nz(row.updated_by), updatedAt: tsBogota(row.updated_at),
  }));
  const customer_contacts = contactRows.map((row) => ({
    id: String(row.id), customerId: row.customer_id, channel: row.channel, reason: row.reason,
    outcome: row.outcome, notes: nz(row.notes), followUpOn: nz(row.follow_up_on),
    activationId: row.activation_id == null ? "" : String(row.activation_id), orderId: nz(row.order_id),
    createdBy: row.created_by, createdByName: nz(nombreUserDe[row.created_by]), createdAt: tsBogota(row.created_at),
  }));
  const customer_activations = activationRows.map((row) => ({
    id: String(row.id), customerId: row.customer_id, type: row.type, title: row.title, message: nz(row.message),
    status: row.status, benefitId: nz(row.benefit_id), expiresOn: nz(row.expires_on),
    convertedOrderId: nz(row.converted_order_id), createdBy: row.created_by,
    createdByName: nz(nombreUserDe[row.created_by]), createdAt: tsBogota(row.created_at), updatedAt: tsBogota(row.updated_at),
  }));

  // Shape EXACTO de la maqueta (db.batches / production_batches en MomosOps.jsx):
  // producto/resp son STRINGS (nombre), no ids — el server normalizó a FK
  // (product_id, resp_user_id) pero el front sigue leyendo por nombre.
  // gramaje: la maqueta guarda "150 g" (texto); el server normalizó a integer (gramaje_g).
  const resultadosFiguraPorLote = (loteFiguraRows || []).reduce((index, row) => {
    if (!index[row.batch_id]) index[row.batch_id] = [];
    index[row.batch_id].push({
      figura: nz(row.figura), cant: Number(row.cant), perfectas: Number(row.perfectas),
      imperfectas: Number(row.imperfectas), descartadas: Number(row.descartadas),
      consumidas: Number(row.consumidas || 0),
    });
    return index;
  }, {});
  const production_batches = batches.map((b) => ({
    id: b.id, fecha: b.fecha,
    productId: b.product_id,
    producto: productoDe[b.product_id] ? productoDe[b.product_id].nombre : "",
    figura: nz(b.figura), sabor: nz(b.sabor), relleno: nz(b.relleno), salsa: nz(b.salsa),
    gramaje: b.gramaje_g != null ? `${b.gramaje_g} g` : "",
    prod: b.prod, perfectas: b.perfectas, imperfectas: b.imperfectas, descartadas: b.descartadas,
    destino: nz(b.destino, "—"),
    resp: nz(nombreUserDe[b.resp_user_id]), vence: nz(b.vence), desmoldadoEn: nz(desmoldadoEnDe[b.id]),
    estado: b.estado, stockContabilizado: b.stock_contabilizado,
    horasCongelacion: b.horas_congelacion,
    inicioCongelacion: b.inicio_congelacion ? tsBogota(b.inicio_congelacion) : "",
    molde: nz(b.molde), ubicacion: nz(b.ubicacion), obs: nz(b.obs),
    corridaId: b.corrida_id || "", figuras: Array.isArray(b.figuras) ? b.figuras : [],
    resultadosFiguras: resultadosFiguraPorLote[b.id] || [],
  }));

  // Componentes + BOM (hito 2): historial de preparaciones de bases (últimas 50).
  const subreceta_producciones = (subProds || []).map((sp) => ({
    id: sp.id, fecha: sp.fecha, subrecetaId: sp.subreceta_id,
    gramosNominales: Number(sp.gramos_nominales), gramosObtenidos: Number(sp.gramos_obtenidos),
    costoBatch: Number(sp.costo_batch), faltantes: Array.isArray(sp.faltantes) ? sp.faltantes : [],
    resp: nz(nombreUserDe[sp.resp_user_id]), obs: nz(sp.obs), creado: tsBogota(sp.created_at),
  }));

  // Variantes Etapa 1a: disponible por (producto, figura, sabor, gramaje) — nace
  // del desmolde por figura (v_variantes_disponibles agrega lote_figuras de lotes
  // Listo contabilizados; lotes viejos sin detalle por figura quedan fuera a propósito).
  const variantes = (variantesRows || []).map((v) => ({
    productId: v.product_id, producto: v.producto, figura: v.figura, sabor: nz(v.sabor),
    gramajeG: v.gramaje_g, disponibles: Number(v.disponibles), vence: nz(v.vencimiento_proximo),
  }));
  const variantesCuarentena = quarantineRows.map((v) => ({
    productId: v.product_id, producto: v.producto, figura: v.figura, sabor: nz(v.sabor),
    gramajeG: v.gramaje_g, disponibles: Number(v.disponibles), vence: nz(v.vencimiento_proximo),
  }));

  return { orders, order_items, customers, deliveries, evidences, benefits, claims, inventory_movements, inventory_reservations, production_suggestions, audit_logs, auditCursor: operationalSnapshot?.history_cursor || null, packing_verifications, production_batches, subreceta_producciones, variantes, variantesCuarentena, operationalControlReady, orderDeltaReady, finishedInventoryDeltaReady, order_stage_assignments, order_line_progress, order_incidents, order_dispatch_handoffs, crmServerReady, customer_crm_profiles, customer_contacts, customer_activations, syncSource: operationalSnapshot ? "snapshot-v1" : "legacy-queries", syncServerTime: operationalSnapshot?.server_time || "" };
}
