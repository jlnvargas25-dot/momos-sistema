import test from "node:test";
import assert from "node:assert/strict";
import { buildDistributionRoom, contentModeFor, distributionChecklistFor, distributionReadiness, validateDistributionAction } from "./commercial-distribution.js";

const product = { id: "PROD-1", nombre: "Momo Gatito", stock: 8, activo: true };
const creative = { id: "CRE-1", titulo: "Reel Momo", canal: "Instagram", formato: "Reel", estado: "Aprobado", productoFocoId: "PROD-1", copy: "Adopta tu Momo", assetUrl: "https://cdn.momos/reel.mp4" };
const post = { id: "CAL-1", fecha: "2026-07-15", hora: "12:00", canal: "Instagram", creativeId: "CRE-1", titulo: "Reel del día", copyFinal: "Adopta tu Momo", estado: "Programado" };
const checklist = {
  archivo_final: true, formato_canal: true, copy_revisado: true, cta_enlace: true,
  identidad_marca: true, producto_fiel: true, claims_verificados: true,
  logo_color_tipografia: true, objetivo_del_modo: true, cta_del_modo: true,
  medicion_del_modo: true, separacion_pauta_organico: true, audio_derechos: true,
};
const run = { id: 1, postId: "CAL-1", status: "Lista", checklist };
const db = { products: [product], creatives: [creative], content_calendar: [post], content_distributions: [run], creative_results: [] };

test("crea un checklist específico para Reel de Instagram", () => {
  assert.deepEqual(distributionChecklistFor(post, db).map((item) => item.key), [
    "archivo_final", "formato_canal", "copy_revisado", "cta_enlace",
    "identidad_marca", "producto_fiel", "claims_verificados", "logo_color_tipografia",
    "objetivo_del_modo", "cta_del_modo", "medicion_del_modo", "separacion_pauta_organico", "audio_derechos",
  ]);
});

test("separa contenido para pauta y orgánico antes de medirlo", () => {
  assert.equal(contentModeFor(post, db), "Orgánico");
  const paidDb = { ...db, campaigns: [{ id: "CMP-1", presupuesto: 100000 }], content_calendar: [{ ...post, campaignId: "CMP-1" }] };
  const paidPost = paidDb.content_calendar[0];
  assert.equal(contentModeFor(paidPost, paidDb), "Pauta");
  assert.match(distributionChecklistFor(paidPost, paidDb).find((item) => item.key === "medicion_del_modo").label, /pedidos pagados/i);
  assert.match(distributionChecklistFor(post, db).find((item) => item.key === "medicion_del_modo").label, /guardados/i);
});

test("WhatsApp exige autorización comercial y no un archivo multimedia", () => {
  const waPost = { ...post, canal: "WhatsApp" };
  const waDb = { ...db, creatives: [{ ...creative, canal: "WhatsApp", formato: "Copy", assetUrl: "" }] };
  const keys = distributionChecklistFor(waPost, waDb).map((item) => item.key);
  assert.equal(keys.includes("audiencia_autorizada"), true);
  assert.equal(keys.includes("archivo_final"), false);
});

test("bloquea distribución multimedia sin archivo final", () => {
  const result = distributionReadiness(post, { ...db, creatives: [{ ...creative, assetUrl: "" }] }, null, "2026-07-15");
  assert.equal(result.readyToPrepare, false);
  assert.match(result.errors.join(" "), /archivo final/i);
});

test("un checklist parcial no puede aprobarse", () => {
  const partial = { ...run, checklist: { ...checklist, cta_enlace: false } };
  const guard = validateDistributionAction("approve", post, db, partial, {}, "2026-07-15", "12:00");
  assert.equal(guard.allowed, false);
  assert.match(guard.reasons.join(" "), /checklist/i);
});

test("una salida Lista y completa puede recibir aprobación humana", () => {
  assert.equal(validateDistributionAction("approve", post, db, run, {}, "2026-07-15", "12:00").allowed, true);
});

test("impide publicar sin aprobación aunque tenga evidencia", () => {
  const guard = validateDistributionAction("publish", post, db, run, { externalUrl: "https://instagram.com/p/1" }, "2026-07-15", "12:00");
  assert.equal(guard.allowed, false);
  assert.match(guard.reasons.join(" "), /aprobación/i);
});

test("impide publicar antes de la hora programada", () => {
  const approved = { ...run, status: "Aprobada" };
  const guard = validateDistributionAction("publish", post, db, approved, { externalUrl: "https://instagram.com/p/1" }, "2026-07-15", "11:59");
  assert.equal(guard.allowed, false);
  assert.match(guard.reasons.join(" "), /hora/i);
});

test("publicar exige evidencia externa y acepta URL o id", () => {
  const approved = { ...run, status: "Aprobada" };
  assert.equal(validateDistributionAction("publish", post, db, approved, {}, "2026-07-15", "12:00").allowed, false);
  assert.equal(validateDistributionAction("publish", post, db, approved, { externalPostId: "IG-123" }, "2026-07-15", "12:00").allowed, true);
});

test("la sala prioriza vencidas bloqueadas y separa resultados pendientes", () => {
  const publishedPost = { ...post, id: "CAL-2", fecha: "2026-07-14", estado: "Publicado" };
  const room = buildDistributionRoom({ ...db, content_calendar: [post, publishedPost], content_distributions: [run, { ...run, id: 2, postId: "CAL-2", status: "Publicada" }] }, "2026-07-15", "13:00");
  assert.equal(room.queue[0].post.id, "CAL-1");
  assert.equal(room.needsMetrics.length, 1);
  assert.equal(room.history.length, 1);
});

test("un fallo necesita explicación y no puede alterar una salida ya publicada", () => {
  assert.equal(validateDistributionAction("fail", post, db, run, { reason: "no" }).allowed, false);
  assert.equal(validateDistributionAction("fail", post, db, { ...run, status: "Publicada" }, { reason: "La plataforma rechazó el archivo" }).allowed, false);
  assert.equal(validateDistributionAction("fail", post, db, run, { reason: "La plataforma rechazó el archivo" }).allowed, true);
});
