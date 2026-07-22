import test from "node:test";
import assert from "node:assert/strict";
import { supabase } from "./supabase.js";
import { guardarConfiguracionServidor } from "./rpc.js";

const UUID = "12345678-1234-4234-9234-123456789abc";

test("H76 guarda un contrato cerrado con versión e idempotencia", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  supabase.rpc = async (name, args) => {
    calls.push([name, args]);
    return { data: { contract: "momos.configuration-mutation.v1", duplicate: false }, error: null };
  };
  try {
    const payload = { zones: [] };
    await guardarConfiguracionServidor(payload, "17", UUID);
    assert.deepEqual(calls, [["guardar_configuracion_v1", {
      p: { idempotency_key: UUID, expected_version: "17", payload },
    }]]);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H83 usa la mutación v2 cuando la vida útil configurable está presente", async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  supabase.rpc = async (name, args) => {
    calls.push([name, args]);
    return { data: { contract: "momos.configuration-mutation.v2", duplicate: false }, error: null };
  };
  try {
    const payload = { zones: [], finished_product_shelf_days: 6, mixture_shelf_days: 5 };
    await guardarConfiguracionServidor(payload, "18", UUID);
    assert.deepEqual(calls, [["guardar_configuracion_v2", {
      p: { idempotency_key: UUID, expected_version: "18", payload },
    }]]);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("H76 rechaza localmente una llave o versión no autoritativas", async () => {
  await assert.rejects(guardarConfiguracionServidor({}, "17", "invalida"), /idempotente válida/i);
  await assert.rejects(guardarConfiguracionServidor({}, "0", UUID), /versión autoritativa/i);
});
