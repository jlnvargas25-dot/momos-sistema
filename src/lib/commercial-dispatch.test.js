import test from "node:test";
import assert from "node:assert/strict";
import { dispatchEligibility, dispatchJobFor, dispatchJobPresentation, distributionProvider, enrichDistributionWithDispatch } from "./commercial-dispatch.js";

const now = new Date("2026-07-16T15:00:00Z");
const item = { post: { id: "CAL-1", canal: "Instagram" }, run: { id: 9, status: "Aprobada" }, action: "Publicar y registrar evidencia" };
const activeMeta = { provider: "Meta", status: "Activa", secretConfigured: true, lastHeartbeatAt: "2026-07-16T14:50:00Z", capabilities: ["Instagram", "Publicación directa"] };
const db = { distributionConnectorReady: true, agencyIntegrations: [activeMeta], distributionConnectorJobs: [] };

test("mapea únicamente canales con conector protegido", () => {
  assert.equal(distributionProvider("Instagram"), "Meta");
  assert.equal(distributionProvider("Facebook"), "Meta");
  assert.equal(distributionProvider("TikTok"), "TikTok");
  assert.equal(distributionProvider("WhatsApp"), "");
});

test("Meta exige integración activa, secreto, heartbeat y publicación directa", () => {
  assert.equal(dispatchEligibility(item, db, now).allowed, true);
  assert.equal(dispatchEligibility(item, { ...db, agencyIntegrations: [{ ...activeMeta, secretConfigured: false }] }, now).allowed, false);
  assert.match(dispatchEligibility(item, { ...db, agencyIntegrations: [{ ...activeMeta, capabilities: ["Instagram"] }] }, now).reasons.join(" "), /publicación directa/i);
  assert.match(dispatchEligibility(item, { ...db, agencyIntegrations: [{ ...activeMeta, lastHeartbeatAt: "2026-07-16T13:00:00Z" }] }, now).reasons.join(" "), /actividad reciente/i);
});

test("TikTok usa borrador y nunca asume publicación directa", () => {
  const tiktokItem = { ...item, post: { ...item.post, canal: "TikTok" } };
  const integration = { ...activeMeta, provider: "TikTok", capabilities: ["TikTok", "Borradores"] };
  const result = dispatchEligibility(tiktokItem, { ...db, agencyIntegrations: [integration] }, now);
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "Borrador");
});

test("no autoriza una salida sin aprobación humana", () => {
  const result = dispatchEligibility({ ...item, run: { ...item.run, status: "Lista" } }, db, now);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /aprobación humana/i);
});

test("elige el intento más reciente y vuelve incierto un estado terminal sin reenvío", () => {
  const jobs = [{ id: 1, distributionId: 9, attempt: 1, status: "Fallido" }, { id: 2, distributionId: 9, attempt: 2, status: "Incierto" }];
  const chosen = dispatchJobFor(item, { ...db, distributionConnectorJobs: jobs });
  assert.equal(chosen.id, 2);
  assert.equal(dispatchJobPresentation(chosen).inFlight, false);
  assert.match(dispatchJobPresentation(chosen).help, /conciliá/i);
});

test("cambia un solo CTA manual por autorización protegida cuando el conector está listo", () => {
  assert.equal(enrichDistributionWithDispatch(item, db, now).action, "Autorizar envío por Meta");
  assert.equal(enrichDistributionWithDispatch({ ...item, action: "Esperar horario" }, db, now).action, "Autorizar envío por Meta");
  const running = enrichDistributionWithDispatch(item, { ...db, distributionConnectorJobs: [{ id: 3, distributionId: 9, attempt: 1, status: "En proveedor" }] }, now);
  assert.equal(running.action, "Procesando en plataforma");
});
