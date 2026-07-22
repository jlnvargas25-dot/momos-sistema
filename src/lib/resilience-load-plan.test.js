import assert from "node:assert/strict";
import test from "node:test";
import { createResilienceLoadPlan } from "./resilience-load-plan.js";

test("H99 conserva la carga base histórica sin fingir solicitudes", () => {
  const plan = createResilienceLoadPlan({ concurrency: 16, targetRequests: 150 });
  assert.equal(plan.idempotencyKeyCount, 40);
  assert.equal(plan.parallelReadCount, 40);
  assert.equal(plan.plannedRequestCount, 186);
});

test("H99 materializa exactamente 2000 solicitudes con 64 contendientes", () => {
  const plan = createResilienceLoadPlan({ concurrency: 64, targetRequests: 2000 });
  assert.equal(plan.idempotencyKeyCount, 552);
  assert.equal(plan.parallelReadCount, 734);
  assert.equal(plan.plannedRequestCount, 2000);
});

test("H99 escala al máximo permitido sin quedar por debajo del objetivo", () => {
  const plan = createResilienceLoadPlan({ concurrency: 64, targetRequests: 10000 });
  assert.equal(plan.plannedRequestCount, 10000);
  assert.ok(plan.parallelReadCount > 0);
});

test("H99 falla cerrado ante volumen o concurrencia fuera del contrato", () => {
  assert.throws(
    () => createResilienceLoadPlan({ concurrency: 65, targetRequests: 2000 }),
    /H99_CONCURRENCY_INVALID/,
  );
  assert.throws(
    () => createResilienceLoadPlan({ concurrency: 64, targetRequests: 10001 }),
    /H99_TARGET_REQUESTS_INVALID/,
  );
});
