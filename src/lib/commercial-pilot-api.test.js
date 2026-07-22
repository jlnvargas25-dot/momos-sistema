import test from "node:test";
import assert from "node:assert/strict";
import { supabase } from "./supabase.js";
import {
  fetchCommercialPilotSnapshot,
  linkCommercialPilotOrder,
  prepareCommercialPilot,
  signCommercialPilot,
  startCommercialPilot,
} from "./commercial-pilot-api.js";

function compactSnapshot(contract = "momos.commercial-pilot.snapshot.v2") {
  return {
    contract,
    capturedAt: "2026-07-22T12:00:00Z",
    pilots: [],
    eligibleOrders: [],
    permissions: {},
    health: { ready: true },
    authority: { actorPresent: true, readOnly: true, publicTrafficOpened: false },
    privacy: { containsCustomerPii: false, containsSecrets: false, containsFreeText: false },
    externalExecution: false,
  };
}

async function withRpc(fake, action) {
  const original = supabase.rpc;
  supabase.rpc = fake;
  try {
    return await action();
  } finally {
    supabase.rpc = original;
  }
}

test("H104 consulta v2 y normaliza el contrato compacto", { concurrency: false }, async () => {
  const calls = [];
  const result = await withRpc(async (name, args) => {
    calls.push({ name, args });
    return { data: compactSnapshot(), error: null };
  }, () => fetchCommercialPilotSnapshot());
  assert.equal(result.contract, "momos.commercial-pilot.snapshot.v2");
  assert.equal(result.detailed, true);
  assert.deepEqual(calls, [{ name: "momos_commercial_pilot_snapshot_v2", args: undefined }]);
});

test("H104 cae a v1 solo cuando v2 no existe", { concurrency: false }, async () => {
  const calls = [];
  const result = await withRpc(async (name) => {
    calls.push(name);
    if (name.endsWith("_v2")) return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    return { data: compactSnapshot("momos.commercial-pilot.snapshot.v1"), error: null };
  }, () => fetchCommercialPilotSnapshot());
  assert.equal(result.detailed, false);
  assert.deepEqual(calls, ["momos_commercial_pilot_snapshot_v2", "momos_commercial_pilot_snapshot_v1"]);
});

test("H104 traduce un servidor sin H102/H104 a un mensaje operativo", { concurrency: false }, async () => {
  await assert.rejects(withRpc(async () => ({
    data: null,
    error: { code: "PGRST202", message: "schema cache" },
  }), () => fetchCommercialPilotSnapshot()), /pendiente de activación/);
});

test("H104 conserva contratos y confirmaciones exactas de H102", { concurrency: false }, async () => {
  const calls = [];
  await withRpc(async (name, args) => {
    calls.push({ name, args });
    return { data: { ok: true }, error: null };
  }, async () => {
    await prepareCommercialPilot({
      pilotKey: "pilot-produccion-104",
      environment: "Produccion",
      plannedOrders: 3,
      maxOrderTotal: 120000,
      startsAt: "2026-07-22T13:00:00-05:00",
      expiresAt: "2026-07-23T13:00:00-05:00",
    });
    const pilot = { id: "10200000-0000-4000-8000-000000000001", version: 4, environment: "Produccion" };
    await signCommercialPilot(pilot, { area: "Finanzas", evidenceCode: "CLOSE_READY" });
    await startCommercialPilot(pilot);
    await linkCommercialPilotOrder(pilot.id, "P-1064", "123e4567-e89b-42d3-a456-426614174000");
  });

  assert.equal(calls[0].name, "preparar_piloto_comercial_v1");
  assert.equal(calls[0].args.p.production_confirmation, "PREPARAR_PILOTO_CERRADO_SIN_ABRIR_TRAFICO");
  assert.equal(calls[1].args.p_evidence_code, "CLOSE_READY");
  assert.equal(calls[2].args.p_confirmation, "INICIAR_PILOTO_CERRADO_PRODUCCION");
  assert.deepEqual(calls[3], {
    name: "vincular_pedido_piloto_comercial_v1",
    args: {
      p_pilot: "10200000-0000-4000-8000-000000000001",
      p_order_id: "P-1064",
      p_idempotency_key: "123e4567-e89b-42d3-a456-426614174000",
    },
  });
});
