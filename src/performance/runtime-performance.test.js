import test from "node:test";
import assert from "node:assert/strict";
import {
  classifySupabaseRequest,
  createInstrumentedFetch,
  createRuntimePerformance,
  estimateJsonBytes,
  nearestRankPercentile,
  statusClass,
} from "./runtime-performance.js";

test("calcula percentiles nearest-rank sin inventar muestras", () => {
  assert.equal(nearestRankPercentile([], 95), 0);
  assert.equal(nearestRankPercentile([50, 10, 40, 20, 30], 50), 30);
  assert.equal(nearestRankPercentile([50, 10, 40, 20, 30], 95), 50);
  assert.equal(statusClass(204), "2xx");
  assert.equal(statusClass(0), "network-error");
});

test("limita buffers y agrega HTTP por dominio sin conservar datos sensibles", () => {
  const telemetry = createRuntimePerformance({ maxSamples: 10, now: () => 1 });
  for (let index = 0; index < 15; index += 1) {
    telemetry.recordHttp({
      domain: index % 2 ? "operativo" : "agencia",
      kind: "rpc",
      status: 200,
      ok: true,
      durationMs: index + 1,
      bytesIn: 100,
      url: `https://secret.invalid?telefono=300${index}`,
      body: { direccion: "dato privado" },
      error: "token privado",
    });
  }
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.http.count, 10);
  assert.equal(snapshot.http.bytesIn, 1000);
  assert.equal(snapshot.http.byDomain.operativo.count + snapshot.http.byDomain.agencia.count, 10);
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /secret|telefono|direccion|token privado|3001/);
});

test("una navegación nueva reemplaza la anterior y solo cierra con UI y dominios listos", () => {
  let clock = 0;
  const telemetry = createRuntimePerformance({ now: () => clock });
  const dashboard = telemetry.startRoute("Dashboard", { requiredDomains: ["catalogos", "operativo"] });
  clock = 10;
  telemetry.markUiCommitted(dashboard);
  clock = 20;
  const finance = telemetry.startRoute("Finanzas", { requiredDomains: ["finanzas"], freshDomains: ["finanzas"] });
  clock = 35;
  assert.equal(telemetry.markUiCommitted(finance), true);
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.routes.count, 2);
  assert.equal(snapshot.routes.superseded, 1);
  assert.equal(snapshot.routes.ready, 1);
  assert.equal(snapshot.routes.p95Ms, 15);
  assert.equal(snapshot.activeRoute, null);
});

test("ignora señales tardías de una ruta anterior", () => {
  let clock = 0;
  const telemetry = createRuntimePerformance({ now: () => clock });
  const first = telemetry.startRoute("Pedidos", { requiredDomains: ["operativo"] });
  clock = 5;
  const second = telemetry.startRoute("Producción", { requiredDomains: ["operativo"] });
  assert.equal(telemetry.markDomainReady("operativo", first), false);
  clock = 10;
  telemetry.markUiCommitted(second);
  clock = 20;
  assert.equal(telemetry.markDomainReady("operativo", second), true);
  assert.equal(telemetry.snapshot().routes.ready, 1);
});

test("mapea la vista Crecimiento a agencia-momos", () => {
  const telemetry = createRuntimePerformance({ now: () => 10 });
  const routeId = telemetry.startRoute("Crecimiento");

  assert.equal(telemetry.snapshot().activeRoute.view, "agencia-momos");
  assert.equal(telemetry.markUiCommitted(routeId), true);
  assert.equal(telemetry.snapshot().routes.byView["agencia-momos"].ready, 1);
});

test("clasifica Supabase sin devolver URL, query, tabla cruda ni RPC cruda", () => {
  const cases = [
    ["https://x.supabase.co/rest/v1/orders?cliente=secreto", { domain: "operativo", kind: "rest" }],
    ["https://x.supabase.co/rest/v1/rpc/momos_operational_snapshot_v1", { domain: "operativo", kind: "rpc" }],
    ["https://x.supabase.co/rest/v1/rpc/momos_finance_snapshot_v1", { domain: "finanzas", kind: "rpc" }],
    ["https://x.supabase.co/rest/v1/rpc/momos_financial_facts_v1", { domain: "finanzas", kind: "rpc" }],
    ["https://x.supabase.co/rest/v1/finance_sync_state?select=version", { domain: "finanzas", kind: "rest" }],
    ["https://x.supabase.co/rest/v1/rpc/momos_configuration_snapshot_v1", { domain: "configuracion", kind: "rpc" }],
    ["https://x.supabase.co/rest/v1/rpc/guardar_configuracion_v1", { domain: "configuracion", kind: "rpc" }],
    ["https://x.supabase.co/rest/v1/configuration_sync_state?select=version", { domain: "configuracion", kind: "rest" }],
    ["https://x.supabase.co/rest/v1/rpc/momos_dashboard_snapshot_v1", { domain: "dashboard", kind: "rpc" }],
    ["https://x.supabase.co/rest/v1/dashboard_sync_state?select=version", { domain: "dashboard", kind: "rest" }],
    ["https://x.supabase.co/rest/v1/rpc/agency_context_snapshot", { domain: "agencia", kind: "rpc" }],
    ["https://x.supabase.co/rest/v1/rpc/momos_agency_snapshot", { domain: "agencia", kind: "rpc" }],
    ["https://x.supabase.co/rest/v1/momos_agency_assets?select=id", { domain: "agencia", kind: "rest" }],
    ["https://x.supabase.co/rest/v1/rpc/obtener_identidad_marca", { domain: "agencia", kind: "rpc" }],
    ["https://x.supabase.co/storage/v1/object/sign/brand-media/ruta", { domain: "agencia", kind: "storage" }],
    ["https://x.supabase.co/auth/v1/token", { domain: "catalogos", kind: "auth" }],
  ];
  cases.forEach(([url, expected]) => {
    const result = classifySupabaseRequest(url);
    assert.deepEqual(result, expected);
    assert.deepEqual(Object.keys(result).sort(), ["domain", "kind"]);
    assert.doesNotMatch(JSON.stringify(result), /secreto|orders|snapshot|brand-media/);
  });
});

test("fetch instrumentado mide headers y concurrencia sin leer el cuerpo", async () => {
  let clock = 0;
  const telemetry = createRuntimePerformance({ now: () => clock });
  const calls = [];
  const fetchImpl = async (_input, init) => {
    calls.push(init);
    clock += 25;
    return new Response("dato que no debe inspeccionarse", {
      status: 200,
      headers: { "content-length": "321" },
    });
  };
  const measuredFetch = createInstrumentedFetch({ fetchImpl, telemetry, now: () => clock });
  const response = await measuredFetch("https://x.supabase.co/rest/v1/orders?telefono=privado", {
    headers: { "content-length": "45" },
    body: "contenido privado",
    method: "POST",
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.http.count, 1);
  assert.equal(snapshot.http.bytesIn, 321);
  assert.equal(snapshot.http.bytesOut, 45);
  assert.equal(snapshot.http.p95Ms, 25);
  assert.doesNotMatch(JSON.stringify(snapshot), /telefono|privado|contenido|dato que/);
});

test("solicitudes concurrentes conservan medidas independientes", async () => {
  let clock = 0;
  const telemetry = createRuntimePerformance({ now: () => clock });
  const gates = [];
  const fetchImpl = () => new Promise((resolve) => gates.push(resolve));
  const measuredFetch = createInstrumentedFetch({ fetchImpl, telemetry, now: () => clock });
  const first = measuredFetch("https://x.supabase.co/rest/v1/orders");
  clock = 5;
  const second = measuredFetch("https://x.supabase.co/rest/v1/agency_integrations");
  clock = 15;
  gates[1](new Response(null, { status: 204, headers: { "content-length": "20" } }));
  await second;
  clock = 30;
  gates[0](new Response(null, { status: 204, headers: { "content-length": "10" } }));
  await first;
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.http.count, 2);
  assert.equal(snapshot.http.byDomain.operativo.count, 1);
  assert.equal(snapshot.http.byDomain.agencia.count, 1);
  assert.equal(snapshot.http.bytesIn, 30);
  assert.equal(snapshot.http.p50Ms, 10);
  assert.equal(snapshot.http.p95Ms, 30);
});

test("un error de red se mide sin exponer su mensaje y se vuelve a lanzar", async () => {
  let clock = 10;
  const telemetry = createRuntimePerformance({ now: () => clock });
  const measuredFetch = createInstrumentedFetch({
    telemetry,
    now: () => clock,
    fetchImpl: async () => {
      clock = 30;
      throw new Error("service role y dirección privada");
    },
  });
  await assert.rejects(measuredFetch("https://x.supabase.co/rest/v1/products"), /service role/);
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.recent.http[0].statusClass, "network-error");
  assert.equal(snapshot.recent.http[0].ok, false);
  assert.doesNotMatch(JSON.stringify(snapshot), /service role|dirección privada/);
});

test("telemetría desactivada no clasifica ni acumula", async () => {
  const telemetry = createRuntimePerformance({ enabled: false });
  const measuredFetch = createInstrumentedFetch({ telemetry, fetchImpl: async () => new Response(null, { status: 204 }) });
  await measuredFetch("esto ni siquiera necesita ser URL");
  assert.equal(telemetry.snapshot().http.count, 0);
  assert.equal(telemetry.startRoute("Finanzas"), 0);
});

test("estima bytes sin persistir el objeto y falla cerrado ante ciclos", () => {
  assert.equal(estimateJsonBytes({ hola: "momos" }) > 0, true);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(estimateJsonBytes(cyclic), 0);
});

test("atribuye solicitudes reales a Finanzas durante su apertura", () => {
  let clock = 0;
  const telemetry = createRuntimePerformance({ now: () => clock });
  const routeId = telemetry.startRoute("Finanzas", { requiredDomains: ["finanzas"] });
  telemetry.recordHttp({ domain: "finanzas", kind: "rpc", status: 200, ok: true, durationMs: 40, bytesIn: 800 });
  telemetry.recordHttp({ domain: "finanzas", kind: "rest", status: 200, ok: true, durationMs: 60, bytesIn: 1200 });
  clock = 90;
  telemetry.markUiCommitted(routeId);
  clock = 120;
  telemetry.markDomainReady("finanzas", routeId);

  const finance = telemetry.snapshot().routes.byView.finanzas;
  assert.equal(finance.count, 1);
  assert.equal(finance.ready, 1);
  assert.equal(finance.requests, 2);
  assert.equal(finance.bytesIn, 2000);
  assert.equal(finance.p95Ms, 120);
  assert.equal(finance.requestP95Ms, 60);
});
