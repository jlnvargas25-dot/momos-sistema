import { normalizeInventoryCursorToken } from "./inventory-cursor.js";
import { parseOperationalTimestamp } from "./operational-time.js";

const RAW_MOVEMENT_KEYS = Object.freeze([
  "id", "fecha", "tipo", "item_id", "cant", "order_id", "batch_id",
]);
const RAW_AUDIT_KEYS = Object.freeze([
  "id", "fecha", "entidad", "entidad_id", "accion",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  const expected = new Set(keys);
  return actual.length === keys.length && actual.every((key) => expected.has(key));
}

function isPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function isFiniteDecimal(value) {
  return (typeof value === "number" && Number.isFinite(value))
    || (typeof value === "string"
      && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
      && Number.isFinite(Number(value)));
}

function rawMovementIsComplete(row) {
  return hasExactKeys(row, RAW_MOVEMENT_KEYS)
    && isPresent(row.id)
    && parseOperationalTimestamp(row.fecha) !== null
    && isPresent(row.tipo)
    && isPresent(row.item_id)
    && isFiniteDecimal(row.cant)
    && (row.order_id === null || row.order_id === undefined || typeof row.order_id === "string")
    && (row.batch_id === null || row.batch_id === undefined || typeof row.batch_id === "string");
}

function rawAuditIsComplete(row) {
  return hasExactKeys(row, RAW_AUDIT_KEYS)
    && isPresent(row.id)
    && parseOperationalTimestamp(row.fecha) !== null
    && row.entidad === "Inventario"
    && isPresent(row.entidad_id)
    && isPresent(row.accion);
}

export function inventoryReadGenerationIsCurrent(readGeneration, currentGeneration) {
  return Number.isSafeInteger(readGeneration)
    && Number.isSafeInteger(currentGeneration)
    && readGeneration === currentGeneration;
}

/**
 * El cursor H70 solo puede sellar el bloque atómico completo del RPC core.
 * La comprobación de claves exactas también impide que el historial compacto
 * se convierta accidentalmente en una nueva superficie de datos sensibles.
 */
export function inventoryCoreSnapshotBlockIsComplete(snapshot) {
  return isRecord(snapshot)
    && Boolean(normalizeInventoryCursorToken(snapshot.inventory_latest_event_id))
    && Array.isArray(snapshot.inventory_items)
    && Array.isArray(snapshot.inventory_lots)
    && Array.isArray(snapshot.inventory_movements)
    && snapshot.inventory_movements.every(rawMovementIsComplete)
    && Array.isArray(snapshot.inventory_audit_logs)
    && snapshot.inventory_audit_logs.every(rawAuditIsComplete);
}

export function inventoryProtectedCatalogCanApply(snapshot, currentGeneration) {
  return snapshot?.inventoryMutationDeltaReady === true
    && snapshot?.inventoryCoreSnapshotReady === true
    && Boolean(normalizeInventoryCursorToken(snapshot?.inventoryMutationEventVersion))
    && Array.isArray(snapshot?.inventory_items)
    && Array.isArray(snapshot?.inventory_lots)
    && snapshot?.inventorySnapshotHistoryReady === true
    && Array.isArray(snapshot?.inventorySnapshotMovements)
    && Array.isArray(snapshot?.inventorySnapshotAudits)
    && inventoryReadGenerationIsCurrent(
      Number(snapshot?.__inventoryReadGeneration),
      currentGeneration,
    );
}

export function inventoryDeltaCanApply({
  fullSnapshotRequired,
  expectedGeneration,
  currentGeneration,
}) {
  return fullSnapshotRequired === false
    && inventoryReadGenerationIsCurrent(expectedGeneration, currentGeneration);
}

/** La cola usa marcadores por identidad, nunca event_id ni source_version. */
export function enqueueInventoryRealtimeItem(pending, itemId) {
  if (!(pending instanceof Map)) throw new TypeError("pending debe ser Map.");
  const normalizedItemId = String(itemId ?? "").trim();
  if (!normalizedItemId) return null;
  const marker = Object.freeze({});
  pending.set(normalizedItemId, marker);
  return marker;
}

export function acknowledgeInventoryRealtimePending(pending, capturedEntries) {
  if (!(pending instanceof Map)) throw new TypeError("pending debe ser Map.");
  const entries = Array.isArray(capturedEntries) ? capturedEntries : [];
  let removed = 0;
  entries.forEach(([itemId, marker]) => {
    if (pending.get(itemId) === marker) {
      pending.delete(itemId);
      removed += 1;
    }
  });
  return removed;
}
