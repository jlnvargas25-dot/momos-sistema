import test from "node:test";
import assert from "node:assert/strict";
import { buildClientSloMeasurements, createRuntimeSloReporter } from "./runtime-slo-reporter.js";

function fakeTelemetry() {
  let subscriber = null;
  return {
    subscribeSlo(next) { subscriber = next; return () => { subscriber = null; }; },
    emit(event) { subscriber?.(event); },
  };
}

test("H96 agrupa cuatro dominios en un lote cerrado sin PII", async () => {
  const telemetry = fakeTelemetry();
  const payloads = [];
  let uuid = 0;
  const reporter = createRuntimeSloReporter({
    telemetry,
    report: async (payload) => { payloads.push(payload); return { ok: true }; },
    now: () => Date.parse("2026-07-21T12:34:45Z"),
    uuid: () => `96000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    setIntervalImpl: null,
  });
  telemetry.emit({ type: "route", record: { status: "ready", durationMs: 1200, view: "Pedidos", customer: "privado" } });
  telemetry.emit({ type: "http", record: { kind: "rpc", ok: true, durationMs: 90, url: "/cliente/300" } });
  telemetry.emit({ type: "http", record: { kind: "storage", ok: false, durationMs: 600, path: "logos/secreto" } });
  telemetry.emit({ type: "http", record: { kind: "realtime", ok: true, durationMs: 240 } });
  await reporter.flush();
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].measurements.map((item) => item.service_code), [
    "OPS_FRONTEND", "RPC_CORE", "STORAGE", "REALTIME",
  ]);
  assert.equal(payloads[0].measurements[0].latency_buckets.lte_2500, 1);
  assert.equal(payloads[0].measurements[2].error_count, 1);
  assert.match(payloads[0].measurements[0].bucket_at, /12:34:00\.000Z$/);
  assert.doesNotMatch(JSON.stringify(payloads), /Pedidos|privado|cliente|300|logos|secreto|url|path|view/);
  reporter.stop();
});

test("H96 reintenta exactamente el mismo lote si se pierde la respuesta", async () => {
  const telemetry = fakeTelemetry();
  const attempts = [];
  let fail = true;
  const reporter = createRuntimeSloReporter({
    telemetry,
    report: async (payload) => {
      attempts.push(structuredClone(payload));
      if (fail) { fail = false; throw new Error("respuesta perdida"); }
      return { ok: true };
    },
    uuid: () => "96000000-0000-4000-8000-000000000001",
    setIntervalImpl: null,
  });
  telemetry.emit({ type: "http", record: { kind: "rpc", ok: true, durationMs: 100 } });
  await assert.rejects(reporter.flush(), /respuesta perdida/);
  assert.equal(reporter.snapshot().pending, true);
  await reporter.flush();
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(reporter.snapshot().pending, false);
  reporter.stop();
});

test("H96 ignora rutas incompletas y comparte un flush concurrente", async () => {
  const telemetry = fakeTelemetry();
  let release;
  let calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const reporter = createRuntimeSloReporter({
    telemetry,
    report: async () => { calls += 1; await gate; return { ok: true }; },
    setIntervalImpl: null,
  });
  telemetry.emit({ type: "route", record: { status: "superseded", durationMs: 10 } });
  assert.equal((await reporter.flush()).empty, true);
  telemetry.emit({ type: "http", record: { kind: "rpc", ok: true, durationMs: 10 } });
  const first = reporter.flush();
  const second = reporter.flush();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  reporter.stop();
});

test("el constructor de mediciones no inventa servicios vacíos", () => {
  const accumulators = new Map([
    ["RPC_CORE", { samples: 2, success: 1, errors: 1, durations: [10, 3000], saturationPct: null, queueDepth: null }],
  ]);
  const result = buildClientSloMeasurements(accumulators, {
    now: Date.parse("2026-07-21T00:00:01Z"), uuid: () => "96000000-0000-4000-8000-000000000002",
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].latency_buckets.lte_100, 1);
  assert.equal(result[0].latency_buckets.gt_2500, 1);
});
