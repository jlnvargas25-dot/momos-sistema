import test from "node:test";
import assert from "node:assert/strict";
import { supabase } from "./supabase.js";
import {
  adaptAgencyOperationalFactsEnvelope, adaptAgencySnapshotEnvelope, adaptAgencySnapshotsBundle, AGENCY_SNAPSHOT_SCOPES,
  fetchAgencyCatalogos, fetchAgencyCatalogosConFallback, fetchConfigurationSnapshot, fetchDashboardSnapshot, fetchFinanceSnapshot,
  fetchOperationalHistoryPage, normalizeOperationalHistoryFilters,
} from "./read-model.js";
import { makeAgencyOperationalFacts } from "./agency-operational-facts.test-fixture.js";

const envelope = (scope, payload, overrides = {}) => ({
  version: 1,
  source_version: 7,
  scope,
  server_time: "2026-07-18T15:00:00Z",
  event_id: `event-${scope}`,
  privacy: {
    projection: "agency-authorized-v1",
    customer_records_projected: false,
    secrets_projected: false,
    free_text_unverified: true,
    telemetry_allowed: false,
    storage_references_projected: scope === "production",
  },
  authority: {
    read_only: true,
    external_execution: false,
    human_approval_required: true,
    allowed_roles: ["Administrador", "Marketing/CRM"],
  },
  payload,
  ...overrides,
});

const operationalFacts = makeAgencyOperationalFacts({
  product_catalog: [{
    product_id: "P01", name: "Momo Perrito", active: true, available_stock: 4,
    category: "Momos Signature", type: "simple", species: "perro", price: 18000,
    queue_units: 0, in_process_units: 0, production_buffer: 2, stock_source: "exact-variants",
  }],
  product_sales_30d: [{ product_id: "P01", units: 3, orders: 2, revenue: 54000 }],
  paid_summary: { orders_30d: 2, revenue_30d: 54000, orders_all: 2, revenue_all: 54000, attributed_orders_30d: 1 },
  crm_segments: { birthdays_7d: 1, dormant_30d: 2, contains_customer_ids: false },
  calendar: { today: { posts: 0 }, next_7d: [{ date: "2026-07-19", posts: 1 }] },
  production: { plan_units: 2, plan_runs: 1, queue_units: 1, active_batch_units: 0, critical_preparations: [] },
});

const factsEnvelope = (overrides = {}) => ({
  version: 1,
  contract: "momos-agency-operational-facts/v1",
  source_version: 7,
  server_time: "2026-07-18T15:00:00Z",
  event_id: "event-facts",
  privacy: {
    projection: "agency-operational-facts-v1",
    customer_records_projected: false,
    order_records_projected: false,
    catalog_labels_projected: true,
    free_text_projected: false,
    secrets_projected: false,
    storage_references_projected: false,
  },
  authority: {
    read_only: true,
    external_execution: false,
    human_approval_required: true,
    allowed_roles: ["Administrador", "Marketing/CRM"],
  },
  payload: { agency_operational_facts: operationalFacts },
  ...overrides,
});

test("H75 consulta un solo resumen financiero compacto por rango", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  const payload = { contract: "momos.finance-snapshot.v1", version: 1 };
  supabase.rpc = async (name, args) => {
    calls.push([name, args]);
    return { data: payload, error: null };
  };
  try {
    const result = await fetchFinanceSnapshot("2026-07-01", "2026-07-19");
    assert.deepEqual(calls, [["momos_finance_snapshot_v1", { p_from: "2026-07-01", p_to: "2026-07-19" }]]);
    assert.deepEqual(result, {
      sourceKind: "server-finance-snapshot-v1",
      key: "2026-07-01|2026-07-19",
      payload,
    });
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H75 solo usa H65 como compatibilidad cuando la RPC compacta aún no existe", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  supabase.rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === "momos_finance_snapshot_v1") {
      return { data: null, error: { code: "PGRST202", message: "Could not find the function in the schema cache" } };
    }
    return { data: { version: 1, orders: [] }, error: null };
  };
  try {
    const result = await fetchFinanceSnapshot("2026-07-01", "2026-07-19");
    assert.equal(result.sourceKind, "legacy-financial-facts-v1");
    assert.deepEqual(calls.map(([name]) => name), ["momos_finance_snapshot_v1", "momos_financial_facts_v1"]);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H83 consulta Configuración v2 con una sola RPC compacta", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  const payload = { contract: "momos.configuration-snapshot.v2", version: 2, snapshotVersion: "8" };
  supabase.rpc = async (name, args) => {
    calls.push([name, args]);
    return { data: payload, error: null };
  };
  try {
    const result = await fetchConfigurationSnapshot();
    assert.deepEqual(calls, [["momos_configuration_snapshot_v2", undefined]]);
    assert.deepEqual(result, { sourceKind: "server-configuration-snapshot-v2", payload });
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H83 conserva H76 como compatibilidad únicamente cuando falta la RPC v2", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  const payload = { contract: "momos.configuration-snapshot.v1", version: 1, snapshotVersion: "8" };
  supabase.rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === "momos_configuration_snapshot_v2") {
      return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    }
    return { data: payload, error: null };
  };
  try {
    const result = await fetchConfigurationSnapshot();
    assert.deepEqual(calls.map(([name]) => name), ["momos_configuration_snapshot_v2", "momos_configuration_snapshot_v1"]);
    assert.deepEqual(result, { sourceKind: "server-configuration-snapshot-v1", payload });
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H76 falla cerrado si ningún snapshot protegido está desplegado", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  try {
    await assert.rejects(fetchConfigurationSnapshot(), /could not find the function/i);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H77 consulta Inicio con una sola RPC compacta y valida antes de aplicar", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  const payload = {
    contract: "momos.dashboard-snapshot.v1", version: 1, snapshotVersion: "77", serverTime: "2026-07-19T15:00:00Z", businessDate: "2026-07-19",
    summary: { salesToday: 0, ordersToday: 0, activeOrders: 0, pendingPayments: 0, pendingPaymentAmount: 0, openClaims: 0 },
    assistantCenter: { primary: null, assistants: [], tasks: [], summary: { health: "Al día", tasks: 0, critical: 0, blocking: 0 }, policy: "Toda acción sensible requiere confirmación humana." },
    notices: { productionSuggestions: [], freezingReady: [], publicationsToday: [], creativeReviews: [], campaignsWithoutOrders: [], winner: null },
    brandAssistant: { ideaToday: null, customerContact: null, campaignReview: null, contentRepeat: null, benefitExpiring: null, taskMissing: null },
    inventoryAlerts: { lowStock: [], expiringSoon: [] }, customerSummary: { new: 0, recurrent: 0 }, ordersByState: [], salesByChannel: [], productAvailability: [],
    privacy: { containsCustomerPii: false, containsStaffPii: false, containsFreeText: false, containsStorageReferences: false, containsSecrets: false, externalExecution: false },
  };
  supabase.rpc = async (name, args) => { calls.push([name, args]); return { data: payload, error: null }; };
  try {
    const result = await fetchDashboardSnapshot();
    assert.deepEqual(calls, [["momos_dashboard_snapshot_v1", undefined]]);
    assert.equal(result.sourceKind, "server-dashboard-snapshot-v1");
    assert.equal(result.payload.snapshotVersion, "77");
  } finally { supabase.rpc = originalRpc; }
});

test("H77 no intenta hidratar dominios masivos cuando la RPC falla", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  supabase.rpc = async (name) => { calls.push(name); return { data: null, error: { code: "PGRST202", message: "Could not find the function" } }; };
  try {
    await assert.rejects(fetchDashboardSnapshot(), /could not find the function/i);
    assert.deepEqual(calls, ["momos_dashboard_snapshot_v1"]);
  } finally { supabase.rpc = originalRpc; }
});

test("H79 consulta filtros y cursor en una sola RPC cerrada", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  const payload = {
    contract: "momos.history-page.v2", version: 2, limit: 25, has_more: true, filtered: true,
    next_cursor: { at: "2026-07-19T12:00:00Z", id: "A-1" },
    rows: [{ id: "A-2", fecha: "2026-07-19T13:00:00Z", user: "Administrador", entidad: "Pedido", entidad_id: "P-1", accion: "Pago", de: "Pendiente", a: "Pagado", area: "Pedidos" }],
    privacy: { contains_customer_pii: false, contains_staff_identity: false, contains_storage_references: false, contains_secrets: false, contains_free_text: true, external_execution: false },
  };
  supabase.rpc = async (name, args) => { calls.push([name, args]); return { data: payload, error: null }; };
  try {
    const result = await fetchOperationalHistoryPage({ at: "2026-07-19T14:00:00Z", id: "A-3" }, 25, {
      query: "P-1", area: "Pedidos", from: "2026-07-01", to: "2026-07-19",
    });
    assert.deepEqual(calls, [["momos_history_page_v2", {
      p_cursor: { at: "2026-07-19T14:00:00Z", id: "A-3" }, p_limit: 25,
      p_query: "P-1", p_area: "Pedidos", p_from: "2026-07-01", p_to: "2026-07-19",
    }]]);
    assert.equal(result.rows[0].id, "A-2");
    assert.equal(result.hasMore, true);
    assert.equal(result.filtered, true);
    assert.deepEqual(result.cursor, payload.next_cursor);
  } finally { supabase.rpc = originalRpc; }
});

test("H79 falla cerrado ante filtros inválidos, contrato abierto o despliegue ausente", async () => {
  assert.deepEqual(normalizeOperationalHistoryFilters({ area: "Finanzas" }), { query: "", area: "Finanzas", from: "", to: "" });
  assert.deepEqual(normalizeOperationalHistoryFilters({ area: "Inventario terminado" }), { query: "", area: "Inventario terminado", from: "", to: "" });
  assert.throws(() => normalizeOperationalHistoryFilters({ area: "Talento humano" }), /área/i);
  assert.throws(() => normalizeOperationalHistoryFilters({ from: "2026-07-20", to: "2026-07-19" }), /rango/i);
  assert.throws(() => normalizeOperationalHistoryFilters({ query: "x".repeat(81) }), /búsqueda/i);

  const originalRpc = supabase.rpc;
  try {
    supabase.rpc = async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await assert.rejects(fetchOperationalHistoryPage(null, 50, { query: "P-1" }), /H79/i);

    supabase.rpc = async () => ({ data: { contract: "abierto", version: 2, limit: 50, rows: [], privacy: {} }, error: null });
    await assert.rejects(fetchOperationalHistoryPage(null, 50), /contrato protegido/i);
  } finally { supabase.rpc = originalRpc; }
});

test("H66 declara exactamente los cuatro scopes de Agencia", () => {
  assert.deepEqual(AGENCY_SNAPSHOT_SCOPES, ["overview", "workflow", "production", "measurement"]);
});

test("H66 exige una version comun y contrato estricto en el bundle atomico", () => {
  const snapshots = AGENCY_SNAPSHOT_SCOPES.map((scope) => envelope(scope, {}));
  const bundle = adaptAgencySnapshotsBundle({ version: 1, source_version: 7, server_time: "2026-07-18T15:00:00Z", snapshots });
  assert.equal(bundle.sourceVersion, "7");
  assert.equal(bundle.snapshots.length, 4);
  assert.throws(() => adaptAgencySnapshotsBundle({ version: 1, source_version: 8, snapshots }), /misma versión/i);
  assert.throws(() => adaptAgencySnapshotsBundle({
    version: 1,
    source_version: 7,
    snapshots: [envelope("overview", {}), envelope("overview", {}), envelope("production", {}), envelope("measurement", {})],
  }), /duplicados/i);
  assert.throws(() => adaptAgencySnapshotsBundle({
    version: 1,
    source_version: 7,
    snapshots: snapshots.slice(0, 3),
  }), /versión compatible/i);
  assert.throws(() => adaptAgencySnapshotEnvelope(envelope("overview", {}, {
    authority: { read_only: true, external_execution: false, human_approval_required: false, allowed_roles: ["Administrador", "Marketing/CRM"] },
  })), /solo lectura/i);
  assert.throws(() => adaptAgencySnapshotEnvelope(envelope("production", {}, {
    privacy: { ...envelope("production", {}).privacy, storage_references_projected: false },
  })), /privacidad/i);
});

test("H67 agrega hechos operativos al mismo corte atómico y falla cerrado", () => {
  const snapshots = AGENCY_SNAPSHOT_SCOPES.map((scope) => envelope(scope, {}));
  const bundle = adaptAgencySnapshotsBundle({
    version: 2,
    contract: "momos-agency-snapshots/v2",
    source_version: 7,
    server_time: "2026-07-18T15:00:00Z",
    snapshots,
    agency_operational_facts: factsEnvelope(),
  });
  assert.equal(bundle.version, 2);
  assert.equal(bundle.agencyOperationalFacts.productCatalog[0].availableStock, 4);
  assert.equal(bundle.agencyOperationalFacts.calendar.next7d, 1);
  assert.equal(adaptAgencyOperationalFactsEnvelope(factsEnvelope()).sourceVersion, "7");
  assert.throws(() => adaptAgencyOperationalFactsEnvelope(factsEnvelope({
    privacy: { ...factsEnvelope().privacy, customer_records_projected: true },
  })), /privacidad/i);
  assert.throws(() => adaptAgencySnapshotsBundle({
    version: 2,
    contract: "momos-agency-snapshots/v2",
    source_version: 8,
    server_time: "2026-07-18T15:00:00Z",
    snapshots,
    agency_operational_facts: factsEnvelope(),
  }), /misma versión|corte atómico/i);
});

test("H66 adapta el snapshot al shape legado sin transformar JSON sellado", () => {
  const snapshot = adaptAgencySnapshotEnvelope(envelope("overview", {
    agency_server_ready: true,
    content_calendar: [{ copy_final: "Antojo", external_post_id: "post-1" }],
    creative_results: [{ mensajes_whatsapp: 4, views_3s: 9 }],
    agency_growth_snapshots: [{ policy_snapshot: { daily_budget_limit: 50000 } }],
  }));

  assert.equal(snapshot.scope, "overview");
  assert.equal(snapshot.eventId, "event-overview");
  assert.equal(snapshot.data.agencyServerReady, true);
  assert.deepEqual(snapshot.data.content_calendar[0], { copyFinal: "Antojo", externalPostId: "post-1" });
  assert.deepEqual(snapshot.data.creative_results[0], { mensajesWhatsApp: 4, views3s: 9 });
  assert.deepEqual(snapshot.data.agencyGrowthSnapshots[0].policySnapshot, { daily_budget_limit: 50000 });
});

test("H66 conserva la bandeja semantica y expande propuestas para el motor legado", () => {
  const queue = { allowed: true, contains_pii: false, free_text_exposed: false, items: [] };
  const snapshot = adaptAgencySnapshotEnvelope(envelope("workflow", {
    agency_action_queue: queue,
    agency_agent_proposals: [{
      id: 7,
      proposal_key: "proposal-7",
      sealed_payload: {
        decision_type: "Crear contenido",
        title: "Max Oreo",
        proposed_action: { product_id: "P01" },
        required_tools: ["Biblioteca de marca"],
        confidence: 0.8,
        estimated_cost_cop: 1200,
        cost_cap_cop: 1500,
        execution_mode: "Preparar borrador",
      },
    }],
  }));

  assert.equal(snapshot.data.agencyActionQueue, queue);
  assert.equal(snapshot.data.agencyAgentProposals[0].decisionType, "Crear contenido");
  assert.equal(snapshot.data.agencyAgentProposals[0].title, "Max Oreo");
  assert.deepEqual(snapshot.data.agencyAgentProposals[0].proposedAction, { product_id: "P01" });
  assert.equal(snapshot.data.agencyAgentProposals[0].estimatedCostCop, 1200);
});

test("H66 conserva Identidad oficial sin convertir su contrato ni exponer Storage", () => {
  const identity = {
    available: true,
    ready: true,
    enforcement_enabled: true,
    kit: { id: 4, version: 2, fingerprint: "a".repeat(32) },
    assets: [{ binding_id: 9, role: "principal", asset: { id: 12, name: "Logo MOMOS" } }],
    contains_secrets: false,
    external_execution: false,
  };
  const snapshot = adaptAgencySnapshotEnvelope(envelope("overview", { agency_brand_identity: identity }));
  assert.equal(snapshot.data.agencyBrandIdentity, identity);
  assert.equal(JSON.stringify(snapshot.data.agencyBrandIdentity).includes("storage_path"), false);
  assert.equal(JSON.stringify(snapshot.data.agencyBrandIdentity).includes("signed_url"), false);
});

test("H66 conserva la ficha de produccion y deja la firma del archivo bajo demanda", () => {
  const snapshot = adaptAgencySnapshotEnvelope(envelope("production", {
    brand_media_assets: [{
      id: 8,
      name: "Max Oreo",
      storage_path: "productos/max-oreo.webp",
      content_hash: "abc123",
      production_profile: {
        component_type: "Producto",
        view_angle: "Tres cuartos",
        qa_status: "Aprobado",
        physical_state: "Congelado",
      },
    }],
  }));

  assert.equal(snapshot.data.brandMediaAssets[0].storagePath, "productos/max-oreo.webp");
  assert.equal(snapshot.data.brandMediaAssets[0].contentHash, "abc123");
  assert.equal(snapshot.data.brandMediaAssets[0].url, "");
  assert.deepEqual(snapshot.data.brandMediaAssets[0].productionProfile, {
    componentType: "Producto",
    viewAngle: "Tres cuartos",
    qaStatus: "Aprobado",
    physicalState: "Congelado",
  });
});

test("H66 rechaza snapshots sin frontera de privacidad o solo lectura", () => {
  assert.throws(
    () => adaptAgencySnapshotEnvelope(envelope("overview", {}, {
      privacy: {
        projection: "agency-authorized-v1",
        customer_records_projected: true,
        secrets_projected: false,
        free_text_unverified: true,
        telemetry_allowed: false,
      },
    })),
    /privacidad/i,
  );
  assert.throws(
    () => adaptAgencySnapshotEnvelope(envelope("overview", {}, {
      privacy: {
        projection: "agency-safe-v1",
        customer_records_projected: false,
        secrets_projected: false,
        free_text_unverified: true,
        telemetry_allowed: false,
      },
    })),
    /privacidad/i,
  );
  assert.throws(
    () => adaptAgencySnapshotEnvelope(envelope("overview", {}, {
      privacy: {
        projection: "agency-authorized-v1",
        customer_records_projected: false,
        secrets_projected: true,
        free_text_unverified: true,
        telemetry_allowed: false,
      },
    })),
    /privacidad/i,
  );
  assert.throws(
    () => adaptAgencySnapshotEnvelope(envelope("overview", {}, {
      privacy: {
        projection: "agency-authorized-v1",
        customer_records_projected: false,
        secrets_projected: false,
        free_text_unverified: false,
        telemetry_allowed: false,
      },
    })),
    /privacidad/i,
  );
  assert.throws(
    () => adaptAgencySnapshotEnvelope(envelope("overview", {}, {
      privacy: {
        projection: "agency-authorized-v1",
        customer_records_projected: false,
        secrets_projected: false,
        free_text_unverified: true,
        telemetry_allowed: true,
      },
    })),
    /privacidad/i,
  );
  assert.throws(
    () => adaptAgencySnapshotEnvelope(envelope("overview", {}, {
      authority: { read_only: false, external_execution: false },
    })),
    /solo lectura/i,
  );
  assert.throws(() => adaptAgencySnapshotEnvelope(envelope("secrets", {})), /alcance/i);
});

test("H67 carga Agencia y hechos operativos en un RPC sin rehidratar catálogos core", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  supabase.rpc = async (name, args) => {
    calls.push([name, args]);
    const snapshots = AGENCY_SNAPSHOT_SCOPES.map((scope) => envelope(scope, { [`scope_${scope}`]: true }));
    return { data: {
      version: 2,
      contract: "momos-agency-snapshots/v2",
      source_version: 7,
      server_time: "2026-07-18T15:00:00Z",
      snapshots,
      agency_operational_facts: factsEnvelope(),
    }, error: null };
  };
  try {
    const result = await fetchAgencyCatalogos();
    assert.equal(result.agencySnapshotReady, true);
    assert.equal(result.agencyOperationalFactsReady, true);
    assert.equal(result.syncSource, "snapshot-agency-v1");
    assert.equal(result.agencySnapshotVersion, "7");
    assert.equal(result.syncServerTime, "2026-07-18T15:00:00Z");
    assert.deepEqual(calls, [["momos_agency_snapshots_v2", undefined]]);
    assert.equal(result.scopeOverview, true);
    assert.equal(result.scopeMeasurement, true);
    assert.equal(Object.keys(result.agencySnapshotScopes).length, 4);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H66 y H67 ausentes entregan el control al fallback tras sus probes de despliegue", async () => {
  const originalRpc = supabase.rpc;
  let calls = 0;
  supabase.rpc = async () => {
    calls += 1;
    return { data: null, error: { code: "PGRST202", message: "Function is not in schema cache" } };
  };
  try {
    assert.equal(await fetchAgencyCatalogos(), null);
    assert.equal(calls, 2);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H67 ausente conserva el bundle H66 sin hechos operativos", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  supabase.rpc = async (name) => {
    calls.push(name);
    if (name === "momos_agency_snapshots_v2") {
      return { data: null, error: { code: "PGRST202", message: "Function is not in schema cache" } };
    }
    const snapshots = AGENCY_SNAPSHOT_SCOPES.map((scope) => envelope(scope, {}));
    return { data: { version: 1, source_version: 7, server_time: "2026-07-18T15:00:00Z", snapshots }, error: null };
  };
  try {
    const result = await fetchAgencyCatalogos();
    assert.equal(result.agencySnapshotReady, true);
    assert.equal(result.agencyOperationalFactsReady, false);
    assert.deepEqual(calls, ["momos_agency_snapshots_v2", "momos_agency_snapshots_v1"]);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H66 y H67 ausentes ejecutan una sola vez el fallback legado", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  let legacyCalls = 0;
  supabase.rpc = async (name) => {
    calls.push(name);
    return { data: null, error: { code: "PGRST202", message: "Function is not in schema cache" } };
  };
  try {
    const legacy = { agencyServerReady: true, campaigns: [{ id: "C01" }] };
    const result = await fetchAgencyCatalogosConFallback(async () => {
      legacyCalls += 1;
      return legacy;
    });
    assert.equal(result, legacy);
    assert.equal(legacyCalls, 1);
    assert.deepEqual(calls, [
      "momos_agency_snapshots_v2",
      "momos_agency_snapshots_v1",
      "cierre_lecturas_pii_disponible",
    ]);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H67 usa un solo respaldo H66 ante timeout, 5xx o PGRST transitorio", async () => {
  const originalRpc = supabase.rpc;
  const transientCases = [
    { error: Object.assign(new Error("Request timed out"), { name: "TimeoutError" }), thrown: true },
    { error: { code: "PGRST000", message: "Database connection failed" }, status: 503 },
    { error: { code: "PGRST003", message: "Timed out acquiring connection" }, status: 504 },
  ];
  try {
    for (const transient of transientCases) {
      const calls = [];
      let legacyCalls = 0;
      supabase.rpc = async (name) => {
        calls.push(name);
        if (name === "momos_agency_snapshots_v2") {
          if (transient.thrown) throw transient.error;
          return { data: null, error: transient.error, status: transient.status };
        }
        const snapshots = AGENCY_SNAPSHOT_SCOPES.map((scope) => envelope(scope, {}));
        return { data: { version: 1, source_version: 7, server_time: "2026-07-18T15:00:00Z", snapshots }, error: null };
      };
      const result = await fetchAgencyCatalogosConFallback(async () => {
        legacyCalls += 1;
        return { rawLegacy: true };
      });
      assert.equal(result.agencySnapshotReady, true);
      assert.equal(result.agencyOperationalFactsReady, false);
      assert.equal(result.agencySnapshotFallback, "h67-transient");
      assert.equal(legacyCalls, 0);
      assert.deepEqual(calls, ["momos_agency_snapshots_v2", "momos_agency_snapshots_v1"]);
    }
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H67 transitorio sin H66 falla cerrado y no ejecuta el loader crudo", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  let legacyCalls = 0;
  supabase.rpc = async (name) => {
    calls.push(name);
    if (name === "momos_agency_snapshots_v2") {
      return { data: null, error: { code: "PGRST000", message: "Upstream unavailable" }, status: 503 };
    }
    return { data: null, error: { code: "PGRST202", message: "Could not find the function" }, status: 404 };
  };
  try {
    await assert.rejects(
      fetchAgencyCatalogosConFallback(async () => {
        legacyCalls += 1;
        return { rawLegacy: true };
      }),
      /upstream unavailable/i,
    );
    assert.equal(legacyCalls, 0);
    assert.deepEqual(calls, ["momos_agency_snapshots_v2", "momos_agency_snapshots_v1"]);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H67 no oculta denegaciones RBAC con H66 ni con datos legados", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  let legacyCalls = 0;
  supabase.rpc = async (name) => {
    calls.push(name);
    return { data: null, error: { code: "42501", message: "permission denied for function" }, status: 403 };
  };
  try {
    await assert.rejects(
      fetchAgencyCatalogosConFallback(async () => {
        legacyCalls += 1;
        return { rawLegacy: true };
      }),
      /permission denied/i,
    );
    assert.equal(legacyCalls, 0);
    assert.deepEqual(calls, ["momos_agency_snapshots_v2"]);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H67 no oculta contrato o privacidad invalidos con un fallback", async () => {
  const originalRpc = supabase.rpc;
  try {
    for (const invalidBundle of [
      {
        version: 2,
        contract: "momos-agency-snapshots/v0",
        source_version: 7,
        server_time: "2026-07-18T15:00:00Z",
        snapshots: AGENCY_SNAPSHOT_SCOPES.map((scope) => envelope(scope, {})),
        agency_operational_facts: factsEnvelope(),
      },
      {
        version: 2,
        contract: "momos-agency-snapshots/v2",
        source_version: 7,
        server_time: "2026-07-18T15:00:00Z",
        snapshots: AGENCY_SNAPSHOT_SCOPES.map((scope) => envelope(scope, {})),
        agency_operational_facts: factsEnvelope({
          privacy: { ...factsEnvelope().privacy, customer_records_projected: true },
        }),
      },
    ]) {
      const calls = [];
      let legacyCalls = 0;
      supabase.rpc = async (name) => {
        calls.push(name);
        return { data: invalidBundle, error: null };
      };
      await assert.rejects(
        fetchAgencyCatalogosConFallback(async () => {
          legacyCalls += 1;
          return { rawLegacy: true };
        }),
        /contrato|privacidad/i,
      );
      assert.equal(legacyCalls, 0);
      assert.deepEqual(calls, ["momos_agency_snapshots_v2"]);
    }
  } finally {
    supabase.rpc = originalRpc;
  }
});
