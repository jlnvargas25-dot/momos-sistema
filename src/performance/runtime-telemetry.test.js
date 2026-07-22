import test from "node:test";
import assert from "node:assert/strict";
import { shouldEnableRuntimePerformance } from "./runtime-telemetry.js";

test("habilita telemetria solo en desarrollo o por bandera diagnostica explicita", () => {
  assert.equal(shouldEnableRuntimePerformance({ dev: true, search: "" }), true);
  assert.equal(shouldEnableRuntimePerformance({ dev: false, search: "?momosPerf=1" }), true);
  assert.equal(shouldEnableRuntimePerformance({ dev: false, search: "?momosPerf=0" }), false);
  assert.equal(shouldEnableRuntimePerformance({ dev: false, search: "?telefono=3000000000" }), false);
});
