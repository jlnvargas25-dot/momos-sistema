import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalPhysicalResults, canonicalBatchPhysicalResult,
} from "./canonical-production-results.js";
import { buildFinishedInventory } from "./finished-inventory.js";
import { buildOperationalFinance } from "./operational-finance.js";
import { momobotContextAnswer } from "./momobot-context.js";
import { agencyPhysicalProductionResults } from "./agency-intelligence.js";

const BATCH = {
  id: "L-901", fecha: "2026-07-21", productId: "PR02", producto: "Momo Perrito",
  figura: "Max", sabor: "Oreo", estado: "Listo", prod: 12,
  perfectas: 9, imperfectas: 2, descartadas: 1,
  destino: "Insumo para malteadas",
  resultadosFiguras: [{ figura: "Max", cant: 12, perfectas: 9, imperfectas: 2, descartadas: 1 }],
};

function comparable(result) {
  return {
    produced: result.produced,
    perfect: result.perfect,
    imperfect: result.imperfect,
    discarded: result.discarded,
    grossWasteUnits: result.grossWasteUnits,
    grossWasteRate: result.grossWasteRate,
    definitiveLossUnits: result.definitiveLossUnits,
    repurposedImperfectUnits: result.repurposedImperfectUnits,
  };
}

test("resultado físico canónico separa merma bruta, reaprovechamiento y descarte definitivo", () => {
  const result = canonicalBatchPhysicalResult(BATCH);
  assert.deepEqual(comparable(result), {
    produced: 12, perfect: 9, imperfect: 2, discarded: 1,
    grossWasteUnits: 3, grossWasteRate: 0.25,
    definitiveLossUnits: 1, repurposedImperfectUnits: 2,
  });
  assert.equal(result.closed, true);
  assert.equal(result.trustworthy, true);
});

test("la merma del periodo es ponderada por unidades y no un promedio de porcentajes por lote", () => {
  const result = buildCanonicalPhysicalResults([
    { id: "L-1", fecha: "2026-07-21", prod: 2, perfectas: 1, imperfectas: 1, descartadas: 0 },
    { id: "L-2", fecha: "2026-07-21", prod: 100, perfectas: 90, imperfectas: 0, descartadas: 10 },
  ]);
  assert.equal(result.produced, 102);
  assert.equal(result.grossWasteUnits, 11);
  assert.equal(result.grossWasteRate, 11 / 102);
  assert.notEqual(result.grossWasteRate, 0.3);
});

test("un detalle por figura que contradice el total oficial queda marcado y nunca se oculta", () => {
  const result = canonicalBatchPhysicalResult({
    ...BATCH,
    resultadosFiguras: [{ figura: "Max", cant: 12, perfectas: 10, imperfectas: 1, descartadas: 1 }],
  });
  assert.equal(result.trustworthy, false);
  assert.deepEqual(result.issues, ["figure-detail-mismatch"]);
  assert.equal(result.perfect, 9);
});

test("contrato: todas las superficies devuelven el mismo resultado físico y la misma merma", () => {
  const db = {
    production_batches: [BATCH], products: [], variantes: [], variantesCuarentena: [],
    inventory_reservations: [], orders: [], order_items: [], customers: [], deliveries: [],
    evidences: [], claims: [], inventory_items: [], inventory_movements: [], creative_results: [],
    campaigns: [], creatives: [], benefits: [], customer_crm_profiles: [], customer_contacts: [],
    customer_activations: [], content_calendar: [], agencyBriefs: [], agencyDecisions: [],
    agencyCreativeVersions: [], settings: {},
  };
  const expected = comparable(canonicalBatchPhysicalResult(BATCH));
  const results = buildCanonicalPhysicalResults(db.production_batches, { from: "2026-07-21", to: "2026-07-21" });
  const inventory = buildFinishedInventory(db, { today: "2026-07-21" }).physicalResults;
  const finance = buildOperationalFinance(db, { from: "2026-07-21", to: "2026-07-21" }).productionResults;
  const momobot = momobotContextAnswer("Cómo va el lote 901", { batches: [BATCH], orders: [] });
  const agency = agencyPhysicalProductionResults(db, { from: "2026-07-21", to: "2026-07-21" });

  assert.deepEqual({
    Produccion: expected,
    InventarioTerminado: comparable(inventory),
    Resultados: comparable(results),
    Finanzas: comparable(finance),
    Momobot: comparable(momobot.magnitude),
    Agencia: comparable(agency),
  }, {
    Produccion: expected,
    InventarioTerminado: expected,
    Resultados: expected,
    Finanzas: expected,
    Momobot: expected,
    Agencia: expected,
  });
});

test("el rango canónico excluye lotes fuera del periodo", () => {
  const result = buildCanonicalPhysicalResults([
    BATCH,
    { ...BATCH, id: "L-OLD", fecha: "2026-07-20", prod: 100, perfectas: 0, imperfectas: 100, descartadas: 0 },
  ], { from: "2026-07-21", to: "2026-07-21" });
  assert.equal(result.batchCount, 1);
  assert.equal(result.produced, 12);
  assert.equal(result.grossWasteUnits, 3);
});

test("Momobot responde la merma general con la misma magnitud canónica", () => {
  const answer = momobotContextAnswer("Cuál es la merma de producción", { batches: [BATCH], orders: [] });
  assert.equal(answer.magnitude.kind, "physical_production_summary");
  assert.deepEqual(comparable(answer.magnitude), comparable(canonicalBatchPhysicalResult(BATCH)));
  assert.match(answer.text, /merma bruta es 25%/i);
  assert.match(answer.text, /descarte definitivo es 1/i);
});

test("la carga diferida nunca convierte datos ausentes en merma cero", () => {
  assert.equal(agencyPhysicalProductionResults({}), null);
  assert.equal(buildOperationalFinance({ orders: [] }).productionResults, null);
  const answer = momobotContextAnswer("Cuál es la merma de producción", { orders: [] });
  assert.equal(answer.magnitude.available, false);
  assert.match(answer.text, /no voy a reportar una merma cero sin evidencia/i);
});
