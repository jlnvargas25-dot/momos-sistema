import test from "node:test";
import assert from "node:assert/strict";
import { agencyProviderExecutionGuard, buildAgencyIntegrationCenter } from "./agency-integrations.js";

const NOW = new Date("2026-07-15T15:00:00-05:00");

test("mantiene cerrados todos los conectores antes de la migración", () => {
    const center = buildAgencyIntegrationCenter({}, NOW);
    assert.equal(center.ready, false);
    assert.equal(center.integrations.length, 5);
    assert.equal(center.summary.operational, 0);
    assert.equal(center.integrations.every((item) => item.reasons[0].includes("migración 23")), true);
  });

test("solo considera operativo un conector activo, con secreto y heartbeat fresco", () => {
    const base = {
      agencyIntegrationsReady: true,
      higgsfieldConnectorReady: true,
      agencyIntegrations: [{
        provider: "Higgsfield", status: "Activa", secretConfigured: true,
        lastHeartbeatAt: "2026-07-15T14:45:00-05:00", capabilities: ["Video"],
      }],
    };
    assert.equal(agencyProviderExecutionGuard("Higgsfield", base, NOW).allowed, true);
    assert.equal(agencyProviderExecutionGuard("HeyGen", base, NOW).allowed, false);

    const stale = { ...base, agencyIntegrations: [{ ...base.agencyIntegrations[0], lastHeartbeatAt: "2026-07-15T13:00:00-05:00" }] };
    assert.match(agencyProviderExecutionGuard("Higgsfield", stale, NOW).reasons[0], /actividad reciente/);
  });

test("explica el bloqueo y cuenta trabajo autorizado sin ejecutarlo", () => {
    const db = {
      agencyIntegrationsReady: true,
      higgsfieldConnectorReady: true,
      agencyIntegrations: [{ provider: "Higgsfield", status: "Con error", secretConfigured: true, lastError: "Token vencido" }],
      creativeGenerationJobs: [{ id: 8, provider: "Higgsfield", status: "Autorizado" }],
    };
    const center = buildAgencyIntegrationCenter(db, NOW);
    const item = center.integrations.find((row) => row.provider === "Higgsfield");
    assert.equal(item.waiting, 1);
    assert.equal(item.needsAttention, true);
    assert.deepEqual(item.reasons, ["Token vencido"]);
  });

test("no declara Higgsfield operativo hasta instalar el worker protegido", () => {
  const db = {
    agencyIntegrationsReady: true,
    agencyIntegrations: [{
      provider: "Higgsfield", status: "Activa", secretConfigured: true,
      lastHeartbeatAt: "2026-07-15T14:55:00-05:00",
    }],
  };
  const guard = agencyProviderExecutionGuard("Higgsfield", db, NOW);
  assert.equal(guard.allowed, false);
  assert.match(guard.reasons[0], /migración 24/);
});

test("Kling exige su worker privado y queda operativo con API Key confirmada", () => {
  const base = {
    agencyIntegrationsReady: true,
    agencyIntegrations: [{
      provider: "Kling", status: "Activa", secretConfigured: true,
      lastHeartbeatAt: "2026-07-15T14:55:00-05:00",
    }],
  };
  assert.match(agencyProviderExecutionGuard("Kling", base, NOW).reasons[0], /migración 25/);
  assert.equal(agencyProviderExecutionGuard("Kling", { ...base, klingConnectorReady: true }, NOW).allowed, true);
});

test("Meta con ads_read concilia datos pero nunca obtiene permiso de ejecución", () => {
  const db = { agencyIntegrationsReady: true, agencyMetaConnectorReady: true, agencyIntegrations: [{ provider: "Meta",
    status: "Activa", secretConfigured: true, lastHeartbeatAt: "2026-07-15T14:55:00-05:00", capabilities: ["Métricas", "ads_read"] }] };
  const center = buildAgencyIntegrationCenter(db, NOW);
  const meta = center.integrations.find((item) => item.provider === "Meta");
  assert.equal(meta.operational, true);
  assert.equal(meta.readOnly, true);
  assert.equal(agencyProviderExecutionGuard("Meta", db, NOW).allowed, false);
  assert.match(agencyProviderExecutionGuard("Meta", db, NOW).reasons[0], /únicamente para lectura/);
});

test("cuenta publicaciones aprobadas por canal sin confundir Meta con TikTok", () => {
    const db = {
      agencyIntegrationsReady: true,
      content_distributions: [
        { channel: "Instagram", status: "Aprobada" },
        { channel: "Facebook", status: "Publicada" },
        { channel: "TikTok", status: "Aprobada" },
      ],
    };
    const center = buildAgencyIntegrationCenter(db, NOW);
    assert.equal(center.integrations.find((row) => row.provider === "Meta").waiting, 1);
    assert.equal(center.integrations.find((row) => row.provider === "TikTok").waiting, 1);
  });

test("permite el camino Manual sin secreto externo", () => {
    assert.deepEqual(agencyProviderExecutionGuard("Manual", {}, NOW), { allowed: true, reasons: [], integration: null });
  });
