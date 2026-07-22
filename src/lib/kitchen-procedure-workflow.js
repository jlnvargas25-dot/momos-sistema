const MAX_STEPS = 20;
const MAX_TITLE = 120;
const MAX_DETAIL = 700;
const MAX_NOTE = 1000;
const MAX_SOURCE = 200;
const MAX_FORMULA_LINES = 30;

const clean = (value) => String(value ?? "").trim();

function cleanStep(step = {}) {
  return { title: clean(step.title), detail: clean(step.detail) };
}

export function createKitchenProcedureDraft(subrecipe = {}) {
  const current = subrecipe?.procedure || {};
  const steps = Array.isArray(current.steps) ? current.steps.slice(0, MAX_STEPS).map(cleanStep) : [];
  return {
    subrecipeId: clean(subrecipe.id),
    processDefined: current.processDefined === true,
    note: clean(current.note),
    sourceRef: clean(current.sourceRef) || "Procedimiento interno MOMOS",
    steps: steps.length ? steps : [{ title: "", detail: "" }],
  };
}

export function validateKitchenProcedureDraft(form = {}) {
  const errors = [];
  const subrecipeId = clean(form.subrecipeId);
  const note = clean(form.note);
  const sourceRef = clean(form.sourceRef);
  const inputSteps = Array.isArray(form.steps) ? form.steps : [];
  const steps = inputSteps.map(cleanStep).filter((step) => step.title || step.detail);
  if (!subrecipeId) errors.push("Falta la preparación asociada.");
  if (!note) errors.push("Explicá qué valida esta versión para Cocina.");
  if (note.length > MAX_NOTE) errors.push(`La nota supera ${MAX_NOTE} caracteres.`);
  if (!sourceRef) errors.push("Indicá de dónde sale el procedimiento.");
  if (sourceRef.length > MAX_SOURCE) errors.push(`La fuente supera ${MAX_SOURCE} caracteres.`);
  if (inputSteps.length > MAX_STEPS) errors.push(`La ficha admite máximo ${MAX_STEPS} pasos.`);
  steps.forEach((step, index) => {
    if (!step.title || !step.detail) errors.push(`Completá el nombre y la instrucción del paso ${index + 1}.`);
    if (step.title.length > MAX_TITLE) errors.push(`El nombre del paso ${index + 1} supera ${MAX_TITLE} caracteres.`);
    if (step.detail.length > MAX_DETAIL) errors.push(`La instrucción del paso ${index + 1} supera ${MAX_DETAIL} caracteres.`);
  });
  if (form.processDefined === true && !steps.length) errors.push("Un proceso oficial necesita al menos un paso.");
  return {
    valid: errors.length === 0,
    errors,
    payload: {
      subrecipe_id: subrecipeId,
      process_defined: form.processDefined === true,
      note,
      source_ref: sourceRef,
      steps,
    },
  };
}

export function addKitchenProcedureStep(form = {}) {
  const steps = Array.isArray(form.steps) ? form.steps : [];
  if (steps.length >= MAX_STEPS) return form;
  return { ...form, steps: [...steps.map(cleanStep), { title: "", detail: "" }] };
}

export function updateKitchenProcedureStep(form = {}, index, patch = {}) {
  const steps = (Array.isArray(form.steps) ? form.steps : []).map((step, stepIndex) => (
    stepIndex === index ? cleanStep({ ...step, ...patch }) : cleanStep(step)
  ));
  return { ...form, steps };
}

export function removeKitchenProcedureStep(form = {}, index) {
  const steps = (Array.isArray(form.steps) ? form.steps : []).filter((_, stepIndex) => stepIndex !== index).map(cleanStep);
  return { ...form, steps: steps.length ? steps : [{ title: "", detail: "" }] };
}

export function moveKitchenProcedureStep(form = {}, index, direction) {
  const steps = (Array.isArray(form.steps) ? form.steps : []).map(cleanStep);
  const target = index + (direction < 0 ? -1 : 1);
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) return form;
  [steps[index], steps[target]] = [steps[target], steps[index]];
  return { ...form, steps };
}

export function normalizeKitchenProcedureHistory(envelope, expectedSubrecipeId = "") {
  if (!envelope || envelope.contract !== "momos.kitchen-procedure-history.v1") {
    throw new Error("El historial de la ficha no cumple el contrato de MOMO OPS.");
  }
  const subrecipeId = clean(envelope.subrecipeId);
  if (expectedSubrecipeId && subrecipeId !== clean(expectedSubrecipeId)) {
    throw new Error("El historial recibido pertenece a otra preparación.");
  }
  const rows = Array.isArray(envelope.rows) ? envelope.rows.slice(0, 50).map((row) => ({
    id: Number(row?.id),
    subrecipeId: clean(row?.subrecipeId),
    version: Number(row?.version),
    status: clean(row?.status),
    processDefined: row?.processDefined === true,
    note: clean(row?.note),
    sourceRef: clean(row?.sourceRef),
    fingerprint: clean(row?.fingerprint),
    createdAt: clean(row?.createdAt),
    approvedAt: clean(row?.approvedAt),
    steps: Array.isArray(row?.steps) ? row.steps.slice(0, MAX_STEPS).map(cleanStep) : [],
  })) : [];
  if (rows.some((row) => !Number.isSafeInteger(row.id) || row.id <= 0
      || row.subrecipeId !== subrecipeId || !Number.isInteger(row.version) || row.version <= 0
      || !["Borrador", "Vigente", "Archivado"].includes(row.status))) {
    throw new Error("El historial contiene una versión inválida.");
  }
  return { subrecipeId, syncVersion: clean(envelope.syncVersion), rows };
}

function cleanFormulaLine(line = {}) {
  return { itemId: clean(line.itemId ?? line.item_id), cantidad: Number(line.cantidad) };
}

export function createInternalPreparationSheetDraft(subrecipe = {}, formulaRows = []) {
  return {
    ...createKitchenProcedureDraft(subrecipe),
    formulaOrigin: "Fórmula interna MOMOS",
    formula: (Array.isArray(formulaRows) ? formulaRows : [])
      .filter((row) => clean(row.subrecetaId ?? row.subreceta_id) === clean(subrecipe.id))
      .slice(0, MAX_FORMULA_LINES)
      .map(cleanFormulaLine),
  };
}

export function validateInternalPreparationSheetDraft(form = {}, inventoryItems = [], outputItemId = "") {
  const procedure = validateKitchenProcedureDraft(form);
  const errors = [...procedure.errors];
  const rawFormula = Array.isArray(form.formula) ? form.formula : [];
  const formula = rawFormula.map(cleanFormulaLine).filter((line) => line.itemId || Number.isFinite(line.cantidad));
  const validIds = new Set((Array.isArray(inventoryItems) ? inventoryItems : []).map((item) => clean(item.id)));
  if (!formula.length) errors.push("Agregá al menos un insumo a la fórmula.");
  if (rawFormula.length > MAX_FORMULA_LINES) errors.push(`La fórmula admite máximo ${MAX_FORMULA_LINES} insumos.`);
  if (new Set(formula.map((line) => line.itemId)).size !== formula.length) errors.push("La fórmula contiene insumos repetidos.");
  formula.forEach((line, index) => {
    if (!line.itemId || !validIds.has(line.itemId)) errors.push(`Elegí un insumo válido en la línea ${index + 1}.`);
    if (line.itemId === clean(outputItemId)) errors.push("Una elaboración no puede consumirse a sí misma.");
    if (!Number.isFinite(line.cantidad) || line.cantidad <= 0 || line.cantidad > 100000) {
      errors.push(`La cantidad de la línea ${index + 1} debe ser positiva.`);
    }
  });
  const formulaOrigin = clean(form.formulaOrigin);
  if (!formulaOrigin) errors.push("Indicá de dónde salen las cantidades de la fórmula.");
  if (formulaOrigin.length > MAX_SOURCE) errors.push(`La fuente de la fórmula supera ${MAX_SOURCE} caracteres.`);
  return {
    valid: errors.length === 0,
    errors,
    payload: {
      ...procedure.payload,
      formula_origin: formulaOrigin,
      formula: formula.map((line) => ({ item_id: line.itemId, cantidad: line.cantidad })),
    },
  };
}

export function normalizeInternalPreparationSheetHistory(envelope, expectedSubrecipeId = "") {
  if (!envelope || envelope.contract !== "momos.internal-preparation-sheet-history.v1") {
    throw new Error("El historial integral no cumple el contrato de MOMO OPS.");
  }
  const subrecipeId = clean(envelope.subrecipeId);
  if (expectedSubrecipeId && subrecipeId !== clean(expectedSubrecipeId)) {
    throw new Error("El historial recibido pertenece a otra elaboración.");
  }
  const rows = Array.isArray(envelope.rows) ? envelope.rows.slice(0, 50).map((row) => ({
    id: Number(row?.id), subrecipeId: clean(row?.subrecipeId), version: Number(row?.version),
    status: clean(row?.status), processDefined: row?.processDefined === true,
    note: clean(row?.note), sourceRef: clean(row?.sourceRef), fingerprint: clean(row?.fingerprint),
    formulaFingerprint: clean(row?.formulaFingerprint), formulaOrigin: clean(row?.formulaOrigin),
    createdAt: clean(row?.createdAt), approvedAt: clean(row?.approvedAt),
    steps: Array.isArray(row?.steps) ? row.steps.slice(0, MAX_STEPS).map(cleanStep) : [],
    formula: Array.isArray(row?.formula) ? row.formula.slice(0, MAX_FORMULA_LINES).map(cleanFormulaLine) : [],
  })) : [];
  if (rows.some((row) => !Number.isSafeInteger(row.id) || row.id <= 0
      || row.subrecipeId !== subrecipeId || !Number.isInteger(row.version) || row.version <= 0
      || !["Borrador", "Vigente", "Archivado"].includes(row.status)
      || !/^[0-9a-f]{64}$/.test(row.formulaFingerprint))) {
    throw new Error("El historial integral contiene una versión inválida.");
  }
  return { subrecipeId, syncVersion: clean(envelope.syncVersion), rows };
}

export const KITCHEN_PROCEDURE_LIMITS = Object.freeze({
  maxSteps: MAX_STEPS, maxTitle: MAX_TITLE, maxDetail: MAX_DETAIL,
  maxNote: MAX_NOTE, maxSource: MAX_SOURCE, maxFormulaLines: MAX_FORMULA_LINES,
});
