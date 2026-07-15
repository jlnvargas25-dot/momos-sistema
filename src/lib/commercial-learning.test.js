import test from "node:test";
import assert from "node:assert/strict";
import { buildCommercialLearning } from "./commercial-learning.js";

function baseDb(overrides = {}) {
  return {
    content_calendar: [{ id: "POST-1", fecha: "2026-07-12", hora: "12:00", estado: "Publicado", canal: "Instagram", creativeId: "CR-1", campaignId: "CMP-1", titulo: "Reel Lizi" }],
    content_distributions: [{ postId: "POST-1", status: "Publicada", publishedAt: "2026-07-12 12:05" }],
    creatives: [{ id: "CR-1", titulo: "Hook Lizi", estado: "Publicado", productoFocoId: "PR-1" }],
    campaigns: [{ id: "CMP-1", nombre: "Campaña Lizi", estado: "Activa" }],
    creative_results: [], orders: [], order_items: [],
    ...overrides,
  };
}

test("una publicación sin métricas no se convierte prematuramente en ganadora o perdedora", () => {
  const result = buildCommercialLearning(baseDb(), "2026-07-15");
  assert.equal(result.items[0].stage.key, "missing");
  assert.equal(result.items[0].recommendation, null);
  assert.equal(result.summary.missingMetrics, 1);
});

test("espera una muestra mínima antes de decidir", () => {
  const db = baseDb({
    content_calendar: [{ id: "POST-1", fecha: "2026-07-15", hora: "10:00", estado: "Publicado", canal: "Instagram", creativeId: "CR-1", campaignId: "CMP-1", titulo: "Reel Lizi" }],
    content_distributions: [{ postId: "POST-1", status: "Publicada", publishedAt: "2026-07-15 10:05" }],
    creative_results: [{ postId: "POST-1", creativeId: "CR-1", campaignId: "CMP-1", fecha: "2026-07-15", fuente: "meta", impresiones: 120, clicks: 4, mensajesWhatsApp: 1, gasto: 3000 }],
  });
  const result = buildCommercialLearning(db, "2026-07-15");
  assert.equal(result.items[0].stage.key, "collecting");
  assert.equal(result.summary.actionable, 0);
});

test("declara ganador solo con pedidos pagados y retorno comprobable", () => {
  const db = baseDb({
    creative_results: [{ postId: "POST-1", creativeId: "CR-1", campaignId: "CMP-1", fecha: "2026-07-12", fuente: "meta", impresiones: 4000, clicks: 180, mensajesWhatsApp: 20, gasto: 30000 }],
    orders: [
      { id: "O-1", creativeId: "CR-1", fecha: "2026-07-12", estado: "Pagado", total: 45000 },
      { id: "O-2", creativeId: "CR-1", fecha: "2026-07-12", estado: "Entregado", total: 45000 },
      { id: "O-X", creativeId: "CR-1", fecha: "2026-07-12", estado: "Cancelado", total: 900000 },
    ],
  });
  const result = buildCommercialLearning(db, "2026-07-15");
  assert.equal(result.items[0].stage.key, "winner");
  assert.equal(result.items[0].metrics.orders, 2);
  assert.equal(result.items[0].metrics.revenue, 90000);
  assert.equal(result.items[0].metrics.roas, 3);
  assert.equal(result.items[0].recommendation.type, "Repetir creativo");
});

test("detecta fuga cuando hay conversaciones pero ninguna compra pagada", () => {
  const result = buildCommercialLearning(baseDb({
    creative_results: [{ postId: "POST-1", creativeId: "CR-1", fecha: "2026-07-12", fuente: "meta", impresiones: 3000, clicks: 120, mensajesWhatsApp: 22, gasto: 18000 }],
    orders: [{ id: "O-X", creativeId: "CR-1", fecha: "2026-07-12", estado: "Cancelado", total: 50000 }],
  }), "2026-07-15");
  assert.equal(result.items[0].stage.key, "funnel");
  assert.equal(result.items[0].recommendation.type, "Revisar oferta");
});

test("propone revisar pauta después de gasto significativo sin ventas", () => {
  const result = buildCommercialLearning(baseDb({
    creative_results: [{ postId: "POST-1", creativeId: "CR-1", fecha: "2026-07-12", fuente: "meta", impresiones: 5000, clicks: 50, mensajesWhatsApp: 2, gasto: 30000 }],
  }), "2026-07-15");
  assert.equal(result.items[0].stage.key, "spend");
  assert.equal(result.items[0].recommendation.type, "Pausar campaña");
  assert.equal(result.items[0].recommendation.risk, "Alto");
});

test("no duplica atribución cuando el mismo creativo tuvo dos publicaciones el mismo día", () => {
  const duplicatePost = { id: "POST-2", fecha: "2026-07-12", hora: "18:00", estado: "Publicado", canal: "Instagram", creativeId: "CR-1", campaignId: "CMP-1", titulo: "Historia Lizi" };
  const db = baseDb({
    content_calendar: [...baseDb().content_calendar, duplicatePost],
    content_distributions: [...baseDb().content_distributions, { postId: "POST-2", status: "Publicada", publishedAt: "2026-07-12 18:05" }],
    creative_results: [{ creativeId: "CR-1", campaignId: "CMP-1", fecha: "2026-07-12", fuente: "manual", impresiones: 3000, mensajesWhatsApp: 15, gasto: 20000 }],
    orders: [{ id: "O-1", creativeId: "CR-1", fecha: "2026-07-12", estado: "Pagado", total: 50000 }],
  });
  const result = buildCommercialLearning(db, "2026-07-15");
  assert.equal(result.items.every((item) => item.metrics.orders === 0), true);
  assert.equal(result.items.every((item) => item.metricRows.length === 0), true);
  assert.equal(result.items.every((item) => item.attribution.ambiguous === 1), true);
  assert.equal(result.summary.ambiguousAttribution, 2);
});

test("una métrica exacta no autoriza decisiones si los pedidos siguen ambiguos", () => {
  const duplicatePost = { id: "POST-2", fecha: "2026-07-12", hora: "18:00", estado: "Publicado", canal: "Instagram", creativeId: "CR-1", campaignId: "CMP-1", titulo: "Historia Lizi" };
  const db = baseDb({
    content_calendar: [...baseDb().content_calendar, duplicatePost],
    content_distributions: [...baseDb().content_distributions, { postId: "POST-2", status: "Publicada", publishedAt: "2026-07-12 18:05" }],
    creative_results: [{ postId: "POST-1", creativeId: "CR-1", campaignId: "CMP-1", fecha: "2026-07-12", fuente: "meta", impresiones: 5000, mensajesWhatsApp: 25, gasto: 40000 }],
    orders: [{ id: "O-1", creativeId: "CR-1", fecha: "2026-07-12", estado: "Pagado", total: 50000 }],
  });
  const result = buildCommercialLearning(db, "2026-07-15");
  const first = result.items.find((item) => item.post.id === "POST-1");
  assert.equal(first.stage.key, "ambiguous");
  assert.equal(first.recommendation, null);
});

test("prefiere métricas automáticas frente al respaldo manual de la misma dimensión", () => {
  const db = baseDb({
    creative_results: [
      { postId: "POST-1", creativeId: "CR-1", campaignId: "CMP-1", fecha: "2026-07-12", fuente: "manual", impresiones: 9999, gasto: 99999 },
      { postId: "POST-1", creativeId: "CR-1", campaignId: "CMP-1", fecha: "2026-07-12", fuente: "meta", impresiones: 1000, gasto: 10000 },
    ],
  });
  const result = buildCommercialLearning(db, "2026-07-15");
  assert.equal(result.items[0].metrics.impressions, 1000);
  assert.equal(result.items[0].metrics.spend, 10000);
});
