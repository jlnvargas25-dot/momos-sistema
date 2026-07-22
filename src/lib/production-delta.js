import { normalizeInventoryDeltaBatch } from "./mutation-envelope.js";
import { normalizeFinishedInventoryDeltaBatch } from "./finished-inventory-delta.js";

const MUTATION_CONTRACT = "momos.production-mutation.v1";
const ACTIVITY_CONTRACT = "momos.production-activity-delta.v1";
const OPERATIONS = new Set([
  "crear_corrida", "producir_subreceta", "convertir_imperfectas", "desechar_producto_terminado",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)) throw new Error(`${label} debe ser un objeto.`);
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new Error(`${label} no cumple el contrato cerrado.`);
  }
}

function text(value, label, max = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${label} no es valido.`);
  return normalized;
}

function version(value, label = "version") {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) throw new Error(`${label} no es una version valida.`);
  return normalized;
}

function finite(value, label, { min = -Number.MAX_VALUE } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) throw new Error(`${label} no es numerico.`);
  return number;
}

function rows(value, label, max) {
  if (!Array.isArray(value) || value.length > max || value.some((row) => !isRecord(row))) {
    throw new Error(`${label} no es una coleccion valida.`);
  }
  return value;
}

function normalizeSubrecipeProduction(row) {
  exactKeys(row, [
    "id", "fecha", "subrecetaId", "gramosNominales", "gramosObtenidos",
    "costoBatch", "faltantes", "creado",
  ], "activity.subrecipeProductions[]");
  return {
    id: text(row.id, "subrecipe.id", 100),
    fecha: text(row.fecha, "subrecipe.fecha", 30),
    subrecetaId: text(row.subrecetaId, "subrecipe.subrecetaId", 100),
    gramosNominales: finite(row.gramosNominales, "subrecipe.gramosNominales", { min: 0 }),
    gramosObtenidos: finite(row.gramosObtenidos, "subrecipe.gramosObtenidos", { min: 0 }),
    costoBatch: finite(row.costoBatch, "subrecipe.costoBatch", { min: 0 }),
    faltantes: rows(row.faltantes, "subrecipe.faltantes", 50),
    resp: "",
    obs: "",
    creado: text(row.creado, "subrecipe.creado", 80),
  };
}

function normalizeSuggestion(row) {
  exactKeys(row, [
    "id", "fecha", "producto", "cantidad", "motivo", "orderId", "estado",
    "area", "itemId", "productId", "orderItemId",
  ], "activity.productionSuggestions[]");
  return {
    id: text(row.id, "suggestion.id", 100),
    fecha: text(row.fecha, "suggestion.fecha", 30),
    producto: String(row.producto ?? "").trim(),
    cantidad: finite(row.cantidad, "suggestion.cantidad", { min: 0 }),
    motivo: String(row.motivo ?? "").trim(),
    orderId: String(row.orderId ?? "").trim(),
    estado: text(row.estado, "suggestion.estado", 40),
    area: text(row.area, "suggestion.area", 40),
    itemId: String(row.itemId ?? "").trim(),
    productId: String(row.productId ?? "").trim(),
    orderItemId: String(row.orderItemId ?? "").trim(),
  };
}

export function compareProductionDeltaVersions(left, right) {
  const a = version(left, "left");
  const b = version(right, "right");
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a === b ? 0 : a > b ? 1 : -1;
}

export function normalizeProductionActivityDelta(input) {
  exactKeys(input, [
    "contract", "version", "subrecipeProductions", "productionSuggestions",
    "containsSecrets", "externalExecution",
  ], "activity");
  if (input.contract !== ACTIVITY_CONTRACT || input.containsSecrets !== false || input.externalExecution !== false) {
    throw new Error("La actividad de Produccion abrio una frontera no autorizada.");
  }
  const normalizedVersion = version(input.version, "activity.version");
  const subrecipeProductions = rows(input.subrecipeProductions, "activity.subrecipeProductions", 50)
    .map(normalizeSubrecipeProduction);
  const productionSuggestions = rows(input.productionSuggestions, "activity.productionSuggestions", 100)
    .map(normalizeSuggestion);
  if (new Set(subrecipeProductions.map((row) => row.id)).size !== subrecipeProductions.length
      || new Set(productionSuggestions.map((row) => row.id)).size !== productionSuggestions.length) {
    throw new Error("La actividad de Produccion contiene filas repetidas.");
  }
  return { contract: ACTIVITY_CONTRACT, version: normalizedVersion, subrecipeProductions, productionSuggestions };
}

export function normalizeProductionMutationEnvelope(input) {
  exactKeys(input, [
    "contract", "operation", "idempotencyKey", "duplicate", "result", "inventory",
    "finishedInventory", "activity", "containsSecrets", "externalExecution",
  ], "productionMutation");
  if (input.contract !== MUTATION_CONTRACT || !OPERATIONS.has(input.operation)
      || typeof input.duplicate !== "boolean" || !isRecord(input.result)
      || input.containsSecrets !== false || input.externalExecution !== false) {
    throw new Error("La mutacion de Produccion no tiene el contrato esperado.");
  }
  const idempotencyKey = text(input.idempotencyKey, "productionMutation.idempotencyKey", 200);
  const inventory = input.inventory === null ? null : input.inventory;
  const finishedInventory = input.finishedInventory === null ? null : input.finishedInventory;
  const activity = input.activity === null ? null : input.activity;
  if (inventory) normalizeInventoryDeltaBatch(inventory);
  if (finishedInventory) normalizeFinishedInventoryDeltaBatch(finishedInventory);
  if (activity) normalizeProductionActivityDelta(activity);
  if (input.operation === "crear_corrida" && !finishedInventory) {
    throw new Error("Crear una corrida debe devolver sus lotes exactos.");
  }
  if (input.operation === "producir_subreceta" && (!inventory || !activity)) {
    throw new Error("Preparar una subreceta debe devolver inventario y actividad.");
  }
  if (input.operation === "convertir_imperfectas" && !finishedInventory) {
    throw new Error("Convertir imperfectas debe devolver el lote actualizado.");
  }
  if (input.operation === "desechar_producto_terminado" && !finishedInventory) {
    throw new Error("Desechar producto terminado debe devolver el lote actualizado.");
  }
  return {
    contract: MUTATION_CONTRACT,
    operation: input.operation,
    idempotencyKey,
    duplicate: input.duplicate,
    result: input.result,
    inventory,
    finishedInventory,
    activity,
  };
}

export function applyProductionActivityDeltaToDb(db, input) {
  const normalized = normalizeProductionActivityDelta(input);
  if (!db || typeof db !== "object") throw new Error("MOMO OPS no tiene estado para Produccion.");
  const current = String(db.productionActivityDeltaVersion || "").trim();
  if (current && compareProductionDeltaVersions(normalized.version, current) !== 1) {
    return { status: "stale", version: current };
  }
  db.subreceta_producciones = normalized.subrecipeProductions;
  db.production_suggestions = normalized.productionSuggestions;
  db.productionActivityDeltaVersion = normalized.version;
  return { status: "applied", version: normalized.version };
}

// H88: la actividad de ProducciÃ³n reemplaza dos colecciones y una versiÃ³n;
// no necesita clonar pedidos, inventarios, Agencia ni configuraciÃ³n.
export function applyProductionActivityDelta(db, input) {
  if (!db || typeof db !== "object") throw new Error("MOMO OPS no tiene estado para Produccion.");
  const next = { ...db };
  const result = applyProductionActivityDeltaToDb(next, input);
  if (result.status !== "applied") return { ...result, db };
  return { ...result, db: next };
}

export const PRODUCTION_MUTATION_CONTRACT = MUTATION_CONTRACT;
export const PRODUCTION_ACTIVITY_CONTRACT = ACTIVITY_CONTRACT;
