import assert from "node:assert/strict";
import test from "node:test";
import { manualChunks } from "../../vite.config.js";

test("manualChunks aísla vendors y data access sin capturar features dinámicas", () => {
  assert.equal(manualChunks("C:\\repo\\node_modules\\react-dom\\client.js"), "react-vendor");
  assert.equal(manualChunks("/repo/node_modules/scheduler/index.js"), "react-vendor");
  assert.equal(manualChunks("/repo/node_modules/@supabase/auth-js/dist/index.js"), "supabase-vendor");
  assert.equal(manualChunks("/repo/node_modules/loose-envify/index.js"), "vendor");
  assert.equal(manualChunks("C:\\repo\\src\\lib\\read-model.js"), "data-access");
  assert.equal(manualChunks("/repo/src/performance/runtime-telemetry.js"), "data-access");

  assert.equal(manualChunks("/repo/src/features/agency/AgencyPanel.jsx"), undefined);
  assert.equal(manualChunks("/repo/src/lib/agency-orchestrator.js"), undefined);
});
