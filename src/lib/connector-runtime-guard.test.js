import test from "node:test";
import assert from "node:assert/strict";
import { assertConnectorRuntime, supabaseProjectRef } from "./connector-runtime-guard.js";

const STAGING_REF = "mxrsmuqyesolkxoqvggl";
const PRODUCTION_REF = "csojbqpvujymesuvntxb";

test("extrae únicamente un project ref Supabase remoto con HTTPS", () => {
  assert.equal(supabaseProjectRef(`https://${STAGING_REF}.supabase.co`), STAGING_REF);
  assert.throws(() => supabaseProjectRef("http://127.0.0.1:54321"), /HTTPS/);
  assert.throws(() => supabaseProjectRef("https://example.com"), /Supabase remoto/);
});

test("staging exige ref exacto y confirmación no productiva", () => {
  const runtime = assertConnectorRuntime({
    supabaseUrl: `https://${STAGING_REF}.supabase.co`, environment: "Staging",
    projectRef: STAGING_REF, stagingConfirmation: "CONTROLLED_NON_PRODUCTION",
  });
  assert.deepEqual(runtime, { environment: "Staging", projectRef: STAGING_REF });
  assert.throws(() => assertConnectorRuntime({
    supabaseUrl: `https://${STAGING_REF}.supabase.co`, environment: "Staging",
    projectRef: PRODUCTION_REF, stagingConfirmation: "CONTROLLED_NON_PRODUCTION",
  }), /no coincide/);
  assert.throws(() => assertConnectorRuntime({
    supabaseUrl: `https://${STAGING_REF}.supabase.co`, environment: "Staging", projectRef: STAGING_REF,
  }), /CONTROLLED_NON_PRODUCTION/);
});

test("producción permanece cerrada sin una confirmación distinta y explícita", () => {
  assert.throws(() => assertConnectorRuntime({
    supabaseUrl: `https://${PRODUCTION_REF}.supabase.co`, environment: "Produccion",
    projectRef: PRODUCTION_REF, stagingConfirmation: "CONTROLLED_NON_PRODUCTION",
  }), /EXPLICIT_PRODUCTION/);
  assert.deepEqual(assertConnectorRuntime({
    supabaseUrl: `https://${PRODUCTION_REF}.supabase.co`, environment: "Produccion",
    projectRef: PRODUCTION_REF, productionConfirmation: "EXPLICIT_PRODUCTION",
  }), { environment: "Produccion", projectRef: PRODUCTION_REF });
});
