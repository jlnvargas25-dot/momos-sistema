import test from "node:test";
import assert from "node:assert/strict";
import {
  compareAgencySnapshotVersions, createSyncCoordinator, normalizeAgencySnapshotVersion,
  shouldFlushAgencyRealtimeRefresh, shouldQueueAgencySnapshotVersion, shouldQueueRealtimeDomain, shouldSyncRealtimeEvent,
  syncDomainForTable, syncDomainsForView, SYNC_DOMAINS,
} from "./sync-coordinator.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("deduplica solicitudes simultáneas del mismo dominio", async () => {
  const gate = deferred();
  let loads = 0;
  const applied = [];
  const coordinator = createSyncCoordinator({
    loaders: { [SYNC_DOMAINS.OPERATIONS]: async () => { loads += 1; await gate.promise; return { orders: [1] }; } },
    apply: async (payload) => applied.push(payload),
  });
  const first = coordinator.request(SYNC_DOMAINS.OPERATIONS);
  const second = coordinator.request(SYNC_DOMAINS.OPERATIONS);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(loads, 1);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0].operativo.orders, [1]);
});

test("encola un dominio distinto sin permitir dos vuelos simultáneos", async () => {
  const gate = deferred();
  const order = [];
  let active = 0;
  let maxActive = 0;
  const loader = (name, waits = false) => async () => {
    active += 1; maxActive = Math.max(maxActive, active); order.push(`start:${name}`);
    if (waits) await gate.promise;
    active -= 1; order.push(`end:${name}`); return { name };
  };
  const coordinator = createSyncCoordinator({
    loaders: {
      [SYNC_DOMAINS.OPERATIONS]: loader("op", true),
      [SYNC_DOMAINS.CATALOGS]: loader("cat"),
    },
    apply: async () => {},
  });
  const first = coordinator.request(SYNC_DOMAINS.OPERATIONS);
  const second = coordinator.request(SYNC_DOMAINS.CATALOGS);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ["start:op", "end:op", "start:cat", "end:cat"]);
});

test("una cancelación invalida la respuesta tardía", async () => {
  const gate = deferred();
  let applied = 0;
  const coordinator = createSyncCoordinator({
    loaders: { [SYNC_DOMAINS.OPERATIONS]: async () => { await gate.promise; return { orders: [1] }; } },
    apply: async () => { applied += 1; },
  });
  const request = coordinator.request(SYNC_DOMAINS.OPERATIONS);
  coordinator.cancel();
  gate.resolve();
  await request;
  assert.equal(applied, 0);
});

test("calcula TTL por dominio sin refrescar catálogos vigentes", async () => {
  let clock = 1_000;
  const coordinator = createSyncCoordinator({
    loaders: {
      [SYNC_DOMAINS.OPERATIONS]: async () => ({}),
      [SYNC_DOMAINS.CATALOGS]: async () => ({}),
      [SYNC_DOMAINS.AGENCY]: async () => ({}),
    },
    apply: async () => {},
    now: () => clock,
  });
  await coordinator.request([SYNC_DOMAINS.CATALOGS, SYNC_DOMAINS.OPERATIONS, SYNC_DOMAINS.AGENCY]);
  clock += 70_000;
  assert.deepEqual(coordinator.staleDomains({ catalogos: 15 * 60_000, operativo: 60_000, agencia: 5 * 60_000 }), [SYNC_DOMAINS.OPERATIONS]);
});

test("una vista operativa no consulta Agencia y una vista comercial usa solo su contrato cerrado", () => {
  assert.deepEqual(syncDomainsForView("Produccion"), [SYNC_DOMAINS.CATALOGS, SYNC_DOMAINS.OPERATIONS]);
  assert.deepEqual(syncDomainsForView("Pedidos"), [SYNC_DOMAINS.OPERATIONS]);
  assert.deepEqual(syncDomainsForView("Productos"), [SYNC_DOMAINS.CATALOGS]);
  assert.deepEqual(syncDomainsForView("Creativos"), [SYNC_DOMAINS.AGENCY]);
  assert.deepEqual(syncDomainsForView("Agencia MOMOS"), [SYNC_DOMAINS.AGENCY]);
  assert.deepEqual(syncDomainsForView("Agencia MOMOS", { agencyOperationalFactsReady: true }), [SYNC_DOMAINS.AGENCY]);
  assert.deepEqual(syncDomainsForView("Creativos", { agencyOperationalFactsReady: true }), [SYNC_DOMAINS.AGENCY]);
});

test("Realtime clasifica ordenes, catalogos y Agencia por separado", () => {
  assert.equal(syncDomainForTable("orders"), SYNC_DOMAINS.OPERATIONS);
  assert.equal(syncDomainForTable("order_items"), SYNC_DOMAINS.OPERATIONS);
  assert.equal(syncDomainForTable("order_item_adiciones"), SYNC_DOMAINS.OPERATIONS);
  assert.equal(syncDomainForTable("lote_figuras"), SYNC_DOMAINS.OPERATIONS);
  assert.equal(syncDomainForTable("subreceta_producciones"), SYNC_DOMAINS.OPERATIONS);
  assert.equal(syncDomainForTable("inventory_items"), SYNC_DOMAINS.CATALOGS);
  assert.equal(syncDomainForTable("brand_media_assets"), SYNC_DOMAINS.AGENCY);
  assert.equal(syncDomainForTable("marketing_guiones"), SYNC_DOMAINS.AGENCY);
  assert.equal(syncDomainForTable("marketing_mensajes"), SYNC_DOMAINS.AGENCY);
  assert.equal(syncDomainForTable("agency_snapshot_events"), SYNC_DOMAINS.AGENCY);
  assert.equal(syncDomainForTable("agency_storyboards"), SYNC_DOMAINS.AGENCY);
});

test("Realtime no repite un commit ya incluido en la ultima lectura", () => {
  const commit = "2026-07-17T15:00:00.000Z";
  assert.equal(shouldSyncRealtimeEvent("2026-07-17T15:00:00.001Z", commit), false);
  assert.equal(shouldSyncRealtimeEvent("2026-07-17T14:59:59.999Z", commit), true);
  assert.equal(shouldSyncRealtimeEvent("2026-07-17T15:00:00.001Z", ""), true);
});

test("Realtime de Agencia deduplica bigint por versión y nunca por reloj", () => {
  assert.equal(normalizeAgencySnapshotVersion("0009007199254740993"), "9007199254740993");
  assert.equal(normalizeAgencySnapshotVersion(0), "");
  assert.equal(compareAgencySnapshotVersions("9007199254740993", "9007199254740992"), 1);
  assert.equal(compareAgencySnapshotVersions("9007199254740992", "9007199254740993"), -1);
  assert.equal(compareAgencySnapshotVersions("42", "42"), 0);
  assert.equal(shouldQueueAgencySnapshotVersion({
    incomingVersion: "9007199254740993",
    appliedVersion: "9007199254740992",
    seenVersion: "9007199254740992",
  }), true);
  assert.equal(shouldQueueAgencySnapshotVersion({
    incomingVersion: "9007199254740993",
    appliedVersion: "9007199254740992",
    seenVersion: "9007199254740993",
  }), false, "la misma versión observada no encola otra lectura");
  assert.equal(shouldQueueAgencySnapshotVersion({
    incomingVersion: "9007199254740991",
    appliedVersion: "9007199254740992",
    seenVersion: "9007199254740992",
  }), false);
});

test("Realtime de Agencia descarta el refresco si la lectura explícita ya aplicó esa versión", () => {
  assert.equal(shouldFlushAgencyRealtimeRefresh({ queuedVersion: "43", appliedVersion: "42" }), true);
  assert.equal(shouldFlushAgencyRealtimeRefresh({ queuedVersion: "43", appliedVersion: "43" }), false);
  assert.equal(shouldFlushAgencyRealtimeRefresh({ queuedVersion: "42", appliedVersion: "43" }), false);
  assert.equal(shouldFlushAgencyRealtimeRefresh({ queuedVersion: "", appliedVersion: "43" }), true);
});

test("Realtime ignora dominios fuera de vista y conserva commits durante una lectura", () => {
  const common = {
    domain: SYNC_DOMAINS.AGENCY,
    lastServerAt: "2026-07-17T15:00:00.001Z",
    commitTimestamp: "2026-07-17T15:00:00.000Z",
  };
  assert.equal(shouldQueueRealtimeDomain({
    ...common,
    visibleDomains: new Set([SYNC_DOMAINS.OPERATIONS]),
    activeDomains: new Set([SYNC_DOMAINS.AGENCY]),
  }), false);
  assert.equal(shouldQueueRealtimeDomain({
    ...common,
    visibleDomains: new Set([SYNC_DOMAINS.AGENCY]),
    activeDomains: new Set([SYNC_DOMAINS.AGENCY]),
  }), true);
  assert.equal(shouldQueueRealtimeDomain({
    ...common,
    visibleDomains: new Set([SYNC_DOMAINS.AGENCY]),
    activeDomains: new Set(),
  }), false);
});

test("un commit durante una lectura conserva un unico refresco posterior", async () => {
  const first = deferred();
  let calls = 0;
  const applied = [];
  const coordinator = createSyncCoordinator({
    loaders: {
      [SYNC_DOMAINS.OPERATIONS]: async () => {
        calls += 1;
        if (calls === 1) return first.promise;
        return { version: calls };
      },
    },
    apply: async (payload) => applied.push(payload.operativo.version),
  });

  const initial = coordinator.request(SYNC_DOMAINS.OPERATIONS);
  coordinator.request(SYNC_DOMAINS.OPERATIONS, { reason: "realtime", afterActive: true });
  coordinator.request(SYNC_DOMAINS.OPERATIONS, { reason: "realtime", afterActive: true });
  first.resolve({ version: 1 });
  await initial;

  assert.equal(calls, 2);
  assert.deepEqual(applied, [1, 2]);
});

test("un evento Realtime no crea trailing si el snapshot activo ya incorporo su version", async () => {
  const first = deferred();
  let calls = 0;
  let appliedVersion = "42";
  const coordinator = createSyncCoordinator({
    loaders: {
      [SYNC_DOMAINS.AGENCY]: async () => {
        calls += 1;
        if (calls === 1) return first.promise;
        return { agencySnapshotVersion: "44" };
      },
    },
    apply: async (payload) => {
      appliedVersion = payload.agencia.agencySnapshotVersion;
    },
  });

  const initial = coordinator.request(SYNC_DOMAINS.AGENCY);
  coordinator.request(SYNC_DOMAINS.AGENCY, {
    reason: "realtime",
    afterActive: true,
    shouldRunAfterActive: () => shouldFlushAgencyRealtimeRefresh({
      queuedVersion: "43",
      appliedVersion,
    }),
  });
  first.resolve({ agencySnapshotVersion: "43" });
  await initial;

  assert.equal(calls, 1, "la version 43 aplicada invalida su propia lectura posterior");
  assert.equal(coordinator.snapshot().counters.batches, 1);
});

test("guardas Realtime acumuladas conservan una version mas nueva que el snapshot activo", async () => {
  const first = deferred();
  let calls = 0;
  let appliedVersion = "42";
  const coordinator = createSyncCoordinator({
    loaders: {
      [SYNC_DOMAINS.AGENCY]: async () => {
        calls += 1;
        if (calls === 1) return first.promise;
        return { agencySnapshotVersion: "44" };
      },
    },
    apply: async (payload) => {
      appliedVersion = payload.agencia.agencySnapshotVersion;
    },
  });

  const initial = coordinator.request(SYNC_DOMAINS.AGENCY);
  ["43", "44"].forEach((queuedVersion) => coordinator.request(SYNC_DOMAINS.AGENCY, {
    reason: "realtime",
    afterActive: true,
    shouldRunAfterActive: () => shouldFlushAgencyRealtimeRefresh({ queuedVersion, appliedVersion }),
  }));
  first.resolve({ agencySnapshotVersion: "43" });
  await initial;

  assert.equal(calls, 2, "la version 44 sigue necesitando exactamente una lectura posterior");
  assert.equal(appliedVersion, "44");
});

test("un fallo al aplicar no bloquea reintentos posteriores del dominio", async () => {
  let loads = 0;
  let applies = 0;
  const coordinator = createSyncCoordinator({
    loaders: {
      [SYNC_DOMAINS.OPERATIONS]: async () => ({ version: ++loads }),
    },
    apply: async () => {
      applies += 1;
      if (applies === 1) throw new Error("fallo de render simulado");
    },
  });

  await assert.rejects(coordinator.request(SYNC_DOMAINS.OPERATIONS), /fallo de render simulado/);
  assert.deepEqual(coordinator.snapshot().activeDomains, []);
  await coordinator.request(SYNC_DOMAINS.OPERATIONS);

  assert.equal(loads, 2);
  assert.equal(applies, 2);
  assert.deepEqual(coordinator.snapshot().activeDomains, []);
});

test("las metricas idle conservan duraciones y p95", async () => {
  let clock = 100;
  const states = [];
  const coordinator = createSyncCoordinator({
    loaders: { [SYNC_DOMAINS.OPERATIONS]: async () => { clock += 25; return {}; } },
    apply: async () => { clock += 25; },
    now: () => clock,
    onState: (state) => states.push(state),
  });
  await coordinator.request(SYNC_DOMAINS.OPERATIONS);
  await new Promise((resolve) => setImmediate(resolve));
  const idle = states.at(-1);
  assert.equal(idle.status, "idle");
  assert.deepEqual(idle.durationsMs, [50]);
  assert.equal(idle.p95Ms, 50);
});
