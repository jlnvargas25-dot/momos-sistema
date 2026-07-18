import test from "node:test";
import assert from "node:assert/strict";
import { supabase } from "./supabase.js";
import {
  adaptAgencySnapshotEnvelope, adaptAgencySnapshotsBundle, AGENCY_SNAPSHOT_SCOPES,
  fetchAgencyCatalogos, fetchAgencyCatalogosConFallback,
} from "./read-model.js";

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

test("H66 carga Agencia en un bundle RPC y no rehidrata catalogos core", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  supabase.rpc = async (name, args) => {
    calls.push([name, args]);
    const snapshots = AGENCY_SNAPSHOT_SCOPES.map((scope) => envelope(scope, { [`scope_${scope}`]: true }));
    return { data: { version: 1, source_version: 7, server_time: "2026-07-18T15:00:00Z", snapshots }, error: null };
  };
  try {
    const result = await fetchAgencyCatalogos();
    assert.equal(result.agencySnapshotReady, true);
    assert.equal(result.syncSource, "agency-snapshots-v1");
    assert.equal(result.agencySnapshotVersion, "7");
    assert.equal(result.syncServerTime, "2026-07-18T15:00:00Z");
    assert.deepEqual(calls, [["momos_agency_snapshots_v1", undefined]]);
    assert.equal(result.scopeOverview, true);
    assert.equal(result.scopeMeasurement, true);
    assert.equal(Object.keys(result.agencySnapshotScopes).length, 4);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H66 ausente hace un solo probe y entrega el control al fallback", async () => {
  const originalRpc = supabase.rpc;
  let calls = 0;
  supabase.rpc = async () => {
    calls += 1;
    return { data: null, error: { code: "PGRST202", message: "Function is not in schema cache" } };
  };
  try {
    assert.equal(await fetchAgencyCatalogos(), null);
    assert.equal(calls, 1);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H66 ausente ejecuta el fallback legado sin repetir el probe", async () => {
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
    assert.deepEqual(calls, ["momos_agency_snapshots_v1"]);
  } finally {
    supabase.rpc = originalRpc;
  }
});
