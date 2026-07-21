import test from "node:test";
import assert from "node:assert/strict";
import {
  addKitchenProcedureStep, createKitchenProcedureDraft, moveKitchenProcedureStep,
  createInternalPreparationSheetDraft, normalizeInternalPreparationSheetHistory,
  normalizeKitchenProcedureHistory, removeKitchenProcedureStep,
  updateKitchenProcedureStep, validateInternalPreparationSheetDraft, validateKitchenProcedureDraft,
} from "./kitchen-procedure-workflow.js";

test("clona la vigente sin mutarla y genera un payload cerrado", () => {
  const subrecipe = { id: "SR13", procedure: {
    processDefined: true, note: "Oficial", sourceRef: "RECETAS.md",
    steps: [{ title: "Pesar", detail: "Pesar la fórmula." }],
  } };
  const draft = createKitchenProcedureDraft(subrecipe);
  const changed = updateKitchenProcedureStep(draft, 0, { detail: "Pesar con balanza." });
  assert.equal(subrecipe.procedure.steps[0].detail, "Pesar la fórmula.");
  assert.deepEqual(validateKitchenProcedureDraft(changed), {
    valid: true, errors: [], payload: {
      subrecipe_id: "SR13", process_defined: true, note: "Oficial",
      source_ref: "RECETAS.md", steps: [{ title: "Pesar", detail: "Pesar con balanza." }],
    },
  });
});

test("ordena, agrega y retira pasos sin dejar una ficha imposible de editar", () => {
  let draft = { steps: [{ title: "A", detail: "Uno" }, { title: "B", detail: "Dos" }] };
  draft = moveKitchenProcedureStep(draft, 1, -1);
  assert.deepEqual(draft.steps.map((step) => step.title), ["B", "A"]);
  draft = removeKitchenProcedureStep(draft, 0);
  draft = removeKitchenProcedureStep(draft, 0);
  assert.deepEqual(draft.steps, [{ title: "", detail: "" }]);
  assert.equal(addKitchenProcedureStep(draft).steps.length, 2);
});

test("impide declarar oficial un proceso vacío o incompleto", () => {
  const result = validateKitchenProcedureDraft({
    subrecipeId: "SR13", processDefined: true, note: "Revisión", sourceRef: "Cocina",
    steps: [{ title: "Pesar", detail: "" }],
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /paso 1/i);
});

test("normaliza únicamente el historial de la preparación solicitada", () => {
  const raw = {
    contract: "momos.kitchen-procedure-history.v1", subrecipeId: "SR13", syncVersion: "9",
    rows: [{ id: 2, subrecipeId: "SR13", version: 2, status: "Borrador", processDefined: false,
      note: "Pendiente", sourceRef: "Cocina", fingerprint: "a".repeat(64), createdAt: "2026-07-20", approvedAt: null,
      steps: [{ title: "Uno", detail: "Dos" }], extra: "ignorado" }],
  };
  const value = normalizeKitchenProcedureHistory(raw, "SR13");
  assert.equal(value.syncVersion, "9");
  assert.equal(Object.hasOwn(value.rows[0], "extra"), false);
  assert.throws(() => normalizeKitchenProcedureHistory({ ...raw, contract: "otro" }, "SR13"), /contrato/i);
});

test("crea una ficha integral con fórmula cerrada y evita insumos repetidos o circulares", () => {
  const subrecipe = { id: "SR13", itemId: "GANACHE", procedure: {
    processDefined: true, note: "Oficial", sourceRef: "Cocina",
    steps: [{ title: "Pesar", detail: "Pesar la fórmula." }],
  } };
  const draft = createInternalPreparationSheetDraft(subrecipe, [
    { subrecetaId: "SR13", itemId: "CREMA", cantidad: 0.4 },
    { subrecetaId: "OTRA", itemId: "AZUCAR", cantidad: 1 },
  ]);
  assert.deepEqual(draft.formula, [{ itemId: "CREMA", cantidad: 0.4 }]);
  const valid = validateInternalPreparationSheetDraft(draft, [
    { id: "CREMA" }, { id: "GANACHE" },
  ], "GANACHE");
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.payload.formula, [{ item_id: "CREMA", cantidad: 0.4 }]);
  const invalid = validateInternalPreparationSheetDraft({
    ...draft, formula: [{ itemId: "CREMA", cantidad: 1 }, { itemId: "CREMA", cantidad: 2 }, { itemId: "GANACHE", cantidad: 1 }],
  }, [{ id: "CREMA" }, { id: "GANACHE" }], "GANACHE");
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /repetidos|sí misma/i);
});

test("normaliza el historial integral sin actores ni campos abiertos", () => {
  const value = normalizeInternalPreparationSheetHistory({
    contract: "momos.internal-preparation-sheet-history.v1", subrecipeId: "SR13", syncVersion: "12",
    rows: [{ id: 4, subrecipeId: "SR13", version: 3, status: "Borrador", processDefined: true,
      note: "Revisión", sourceRef: "Cocina", fingerprint: "a".repeat(64),
      formulaFingerprint: "b".repeat(64), formulaOrigin: "Balanza", createdAt: "2026-07-20", approvedAt: null,
      steps: [{ title: "Pesar", detail: "Exacto" }], formula: [{ item_id: "CREMA", cantidad: 0.4 }], actor: "oculto" }],
  }, "SR13");
  assert.equal(value.rows[0].formula[0].itemId, "CREMA");
  assert.equal(Object.hasOwn(value.rows[0], "actor"), false);
  assert.throws(() => normalizeInternalPreparationSheetHistory({ contract: "otro", rows: [] }, "SR13"), /contrato/i);
});
