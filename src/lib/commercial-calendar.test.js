import test from "node:test";
import assert from "node:assert/strict";
import { buildCommercialCalendar, buildPostDraftFromCreative, calendarTransitionGuard, preflightCalendarPost } from "./commercial-calendar.js";

const product = { id: "P-1", nombre: "Momo Perrito", activo: true, stock: 8 };
const creative = { id: "CR-1", titulo: "Perrito tierno", canal: "Instagram", campaignId: "CMP-1", productoFocoId: "P-1", copy: "Adopta tu Momo favorito.", estado: "Aprobado" };
const post = { id: "CAL-1", fecha: "2026-07-15", hora: "12:00", canal: "Instagram", campaignId: "CMP-1", creativeId: "CR-1", titulo: "Reel Perrito", copyFinal: "Adopta tu Momo favorito.", estado: "Pendiente" };
const db = { products: [product], creatives: [creative], content_calendar: [post] };

test("un post completo pasa el preflight comercial", () => {
  const result = preflightCalendarPost(post, db, "2026-07-15");
  assert.equal(result.ready, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.product.id, "P-1");
});

test("bloquea creativos inexistentes o sin aprobación humana", () => {
  const missing = preflightCalendarPost({ ...post, creativeId: "CR-X" }, db, "2026-07-15");
  assert.equal(missing.ready, false);
  assert.equal(missing.errors[0].code, "missing_creative");
  const unapprovedDb = { ...db, creatives: [{ ...creative, estado: "En revisión" }] };
  const unapproved = preflightCalendarPost(post, unapprovedDb, "2026-07-15");
  assert.equal(unapproved.errors.some((item) => item.code === "creative_unapproved"), true);
});

test("bloquea producto agotado, vencido o con stock no verificable", () => {
  const empty = preflightCalendarPost(post, { ...db, products: [{ ...product, stock: 0 }] }, "2026-07-15");
  assert.equal(empty.errors.some((item) => item.code === "out_of_stock"), true);
  const expired = preflightCalendarPost(post, {
    ...db, products: [{ id: "P-1", nombre: "Momo Perrito", activo: true }],
    variantes: [{ productId: "P-1", disponibles: 20, vence: "2026-07-14" }],
  }, "2026-07-15");
  assert.equal(expired.errors.some((item) => item.code === "unknown_stock"), true);
  const unknown = preflightCalendarPost(post, { ...db, products: [{ id: "P-1", nombre: "Momo Perrito", activo: true }] }, "2026-07-15");
  assert.equal(unknown.errors.some((item) => item.code === "unknown_stock"), true);
});

test("detecta cruces de canal y campaña", () => {
  const result = preflightCalendarPost({ ...post, canal: "TikTok", campaignId: "CMP-X" }, db, "2026-07-15");
  assert.equal(result.errors.some((item) => item.code === "channel_mismatch"), true);
  assert.equal(result.errors.some((item) => item.code === "campaign_mismatch"), true);
});

test("un contenido de marca sin producto puede programarse", () => {
  const brandCreative = { id: "CR-B", titulo: "Historia de marca", canal: "Instagram", copy: "Así nació MOMOS.", estado: "Aprobado" };
  const brandPost = { ...post, creativeId: "CR-B", campaignId: "", copyFinal: "Así nació MOMOS." };
  const result = preflightCalendarPost(brandPost, { products: [], creatives: [brandCreative] }, "2026-07-15");
  assert.equal(result.ready, true);
});

test("separa bandeja activa e historial sin perder registros", () => {
  const calendar = buildCommercialCalendar({ ...db, content_calendar: [
    post,
    { ...post, id: "CAL-2", fecha: "2026-07-14", estado: "Publicado", urlPublicacion: "https://instagram.com/p/1" },
    { ...post, id: "CAL-3", fecha: "2026-07-13", estado: "No publicado" },
  ] }, "2026-07-15");
  assert.deepEqual(calendar.active.map((item) => item.id), ["CAL-1"]);
  assert.deepEqual(calendar.history.map((item) => item.id), ["CAL-3", "CAL-2"]);
  assert.equal(calendar.active.length + calendar.history.length, 3);
});

test("marca como conflicto un creativo repetido el mismo día", () => {
  const calendar = buildCommercialCalendar({ ...db, content_calendar: [post, { ...post, id: "CAL-2", hora: "18:30" }] }, "2026-07-15");
  assert.equal(calendar.summary.blocked, 2);
  assert.equal(calendar.active.every((item) => item.preflight.errors.some((error) => error.code === "duplicate_creative_day")), true);
});

test("sugiere un espacio libre y completa el borrador desde el creativo", () => {
  const draft = buildPostDraftFromCreative(creative, db, "2026-07-15");
  assert.equal(draft.fecha, "2026-07-15");
  assert.equal(draft.hora, "18:30");
  assert.equal(draft.creativeId, "CR-1");
  assert.equal(draft.copyFinal, creative.copy);
  assert.equal(draft.estado, "Pendiente");
});

test("impide publicar antes de fecha y protege transiciones terminales", () => {
  const future = calendarTransitionGuard({ ...post, fecha: "2026-07-16", estado: "Programado" }, "Publicado", db, "2026-07-15");
  assert.equal(future.allowed, false);
  assert.match(future.reasons.join(" "), /antes de la fecha/);
  const terminal = calendarTransitionGuard({ ...post, estado: "Publicado" }, "Pendiente", db, "2026-07-15");
  assert.equal(terminal.allowed, false);
  assert.match(terminal.reasons[0], /Transición inválida/);
});

test("la agenda prioriza vencidas y bloqueadas antes que próximas", () => {
  const calendar = buildCommercialCalendar({ ...db, creatives: [creative, { ...creative, id: "CR-2", titulo: "Segundo" }], content_calendar: [
    { ...post, id: "CAL-LATE", fecha: "2026-07-14" },
    { ...post, id: "CAL-BLOCK", creativeId: "CR-X" },
    { ...post, id: "CAL-NEXT", creativeId: "CR-2", fecha: "2026-07-17" },
  ] }, "2026-07-15");
  assert.deepEqual(calendar.agenda.map((item) => item.id), ["CAL-LATE", "CAL-BLOCK", "CAL-NEXT"]);
  assert.equal(calendar.summary.overdue, 1);
  assert.equal(calendar.summary.blocked, 2);
});
