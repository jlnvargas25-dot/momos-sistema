import test from "node:test";
import assert from "node:assert/strict";
import {
  applyProductionActivityDeltaToDb,
  compareProductionDeltaVersions,
  normalizeProductionActivityDelta,
  normalizeProductionMutationEnvelope,
} from "./production-delta.js";

const activity = (overrides = {}) => ({
  contract: "momos.production-activity-delta.v1",
  version: "7",
  subrecipeProductions: [{
    id: "SP-007", fecha: "2026-07-19", subrecetaId: "SR02", gramosNominales: 300,
    gramosObtenidos: 285, costoBatch: 12000, faltantes: [], creado: "2026-07-19T12:00:00+00:00",
  }],
  productionSuggestions: [{
    id: "S-7", fecha: "2026-07-19", producto: "Momo Gatito", cantidad: 2,
    motivo: "Demanda pagada", orderId: "P-1064", estado: "Pendiente", area: "Produccion",
    itemId: "", productId: "PR01", orderItemId: "OI-7",
  }],
  containsSecrets: false,
  externalExecution: false,
  ...overrides,
});

test("normaliza actividad compacta de Produccion y aplica solo versiones nuevas", () => {
  const normalized = normalizeProductionActivityDelta(activity());
  assert.equal(normalized.version, "7");
  assert.equal(normalized.subrecipeProductions[0].resp, "");
  const db = { productionActivityDeltaVersion: "6", subreceta_producciones: [], production_suggestions: [] };
  assert.equal(applyProductionActivityDeltaToDb(db, activity()).status, "applied");
  assert.equal(db.subreceta_producciones[0].id, "SP-007");
  assert.equal(applyProductionActivityDeltaToDb(db, activity({ version: "7" })).status, "stale");
  assert.equal(compareProductionDeltaVersions("10", "9"), 1);
});

test("falla cerrada ante campos extra, secretos o colecciones repetidas", () => {
  assert.throws(() => normalizeProductionActivityDelta(activity({ token: "x" })), /contrato cerrado/);
  assert.throws(() => normalizeProductionActivityDelta(activity({ containsSecrets: true })), /frontera/);
  const duplicate = activity();
  duplicate.productionSuggestions.push({ ...duplicate.productionSuggestions[0] });
  assert.throws(() => normalizeProductionActivityDelta(duplicate), /repetidas/);
});

test("el sobre de mutacion exige deltas acordes a cada operacion", () => {
  const base = {
    contract: "momos.production-mutation.v1",
    operation: "producir_subreceta",
    idempotencyKey: "subprod-abc",
    duplicate: false,
    result: { ok: true },
    inventory: null,
    finishedInventory: null,
    activity: activity(),
    containsSecrets: false,
    externalExecution: false,
  };
  assert.throws(() => normalizeProductionMutationEnvelope(base), /inventario y actividad/);
  assert.throws(() => normalizeProductionMutationEnvelope({ ...base, operation: "borrar_todo" }), /contrato esperado/);
});
