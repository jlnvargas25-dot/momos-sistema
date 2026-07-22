import { parseOperationalTimestamp } from "./operational-time.js";

const MUTATION_CONTRACT = "momos.inventory-mutation.v1";
const DELTA_CONTRACT = "momos.inventory-delta.v1";
const DELTA_BATCH_CONTRACT = "momos.inventory-delta-batch.v1";
const EVENTS_CONTRACT = "momos.inventory-events.v1";
const ZERO_TOLERANCE = 1e-9;

const MUTATION_KEYS = ["contract", "operation", "idempotency_key", "duplicate", "result", "delta"];
const DELTA_KEYS = ["contract", "event_id", "source_version", "server_time", "scope", "item", "lots", "movements", "audits", "reconciliation"];
const ITEM_KEYS = ["id", "nombre", "cat", "unidad", "stock", "minimo", "costo", "proveedor", "vence", "ubicacion", "compra", "costo_estimado"];
const LOT_KEYS = ["id", "item_id", "source_movement_id", "received_at", "expires_at", "initial_quantity", "available_quantity", "unit_cost", "supplier", "location", "origin", "created_at", "status"];
const MOVEMENT_KEYS = ["id", "fecha", "tipo", "item_id", "cant", "order_id", "batch_id"];
const AUDIT_KEYS = ["id", "fecha", "entidad", "entidad_id", "accion"];
const RECONCILIATION_KEYS = ["item_stock", "lots_available", "difference", "exact"];
const FORBIDDEN_KEYS = new Set([
  "actor", "actor_id", "approved_by", "auth", "authorization", "client", "client_id", "cliente", "correo",
  "created_by", "customer", "customer_id", "descripcion", "description", "direccion", "email", "ip", "ip_address",
  "jwt", "nombre_cliente", "nota", "note", "notes", "obs", "owner_id", "password", "phone", "requested_by",
  "resolved_by", "service_role", "service_role_key", "secret", "storage_path", "telefono", "token", "updated_by", "user", "user_id",
]);

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").trim();

export class InventoryMutationEnvelopeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InventoryMutationEnvelopeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new InventoryMutationEnvelopeError(code, message);
}

function assertExactKeys(value, allowed, path) {
  if (!isRecord(value)) fail("INVALID_OBJECT", `${path} debe ser un objeto.`);
  const expected = new Set(allowed);
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !expected.has(key))) {
    fail("UNEXPECTED_KEYS", `${path} no cumple el contrato de claves cerrado.`);
  }
}

function rejectSensitiveKeys(value, path = "payload", depth = 0) {
  if (depth > 8) fail("PAYLOAD_TOO_DEEP", `${path} excede la profundidad permitida.`);
  if (Array.isArray(value)) {
    if (value.length > 1000) fail("PAYLOAD_TOO_LARGE", `${path} excede el límite permitido.`);
    value.forEach((entry, index) => rejectSensitiveKeys(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  if (Object.keys(value).length > 100) fail("PAYLOAD_TOO_LARGE", `${path} excede el límite permitido.`);
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) fail("SENSITIVE_KEY", `${path}.${key} no está permitido.`);
    rejectSensitiveKeys(entry, `${path}.${key}`, depth + 1);
  }
}

function requiredString(value, path, maxLength = 240) {
  const normalized = clean(value);
  if (!normalized || normalized.length > maxLength) fail("INVALID_STRING", `${path} no es válido.`);
  return normalized;
}

function optionalString(value, path, maxLength = 500) {
  if (value === null || value === undefined || value === "") return "";
  const normalized = clean(value);
  if (normalized.length > maxLength) fail("INVALID_STRING", `${path} excede el límite permitido.`);
  return normalized;
}

function finiteNumber(value, path, { min = -Number.MAX_VALUE, max = Number.MAX_VALUE } = {}) {
  if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    fail("INVALID_NUMBER", `${path} no es numérico.`);
  }
  if (typeof value !== "number" && typeof value !== "string") fail("INVALID_NUMBER", `${path} no es numérico.`);
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < min || normalized > max) fail("INVALID_NUMBER", `${path} está fuera de rango.`);
  return normalized;
}

function isoTimestamp(value, path) {
  const normalized = requiredString(value, path, 80);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    fail("INVALID_TIMESTAMP", `${path} no es una fecha ISO válida.`);
  }
  return normalized;
}

function decimalVersion(value, path) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) fail("INVALID_VERSION", `${path} debe ser un entero decimal positivo en texto.`);
  try {
    return { text: value, bigint: BigInt(value) };
  } catch {
    return fail("INVALID_VERSION", `${path} no es una versión válida.`);
  }
}

function decimalCursor(value, path) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) fail("INVALID_VERSION", `${path} debe ser un entero decimal no negativo en texto.`);
  try {
    return { text: value, bigint: BigInt(value) };
  } catch {
    return fail("INVALID_VERSION", `${path} no es un cursor válido.`);
  }
}

function uuid(value, path) {
  const normalized = requiredString(value, path, 36).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    fail("INVALID_IDEMPOTENCY_KEY", `${path} debe ser UUID.`);
  }
  return normalized;
}

function validateOpaqueResult(result) {
  if (result !== null && !isRecord(result)) fail("INVALID_RESULT", "result debe ser un objeto o null.");
  if (result !== null) rejectSensitiveKeys(result, "payload.result");
}

function normalizeItem(raw) {
  assertExactKeys(raw, ITEM_KEYS, "delta.item");
  if (typeof raw.costo_estimado !== "boolean") fail("INVALID_BOOLEAN", "delta.item.costo_estimado debe ser booleano.");
  return {
    id: requiredString(raw.id, "delta.item.id", 80),
    nombre: requiredString(raw.nombre, "delta.item.nombre", 200),
    cat: requiredString(raw.cat, "delta.item.cat", 120),
    unidad: requiredString(raw.unidad, "delta.item.unidad", 30),
    stock: finiteNumber(raw.stock, "delta.item.stock", { min: 0 }),
    min: finiteNumber(raw.minimo, "delta.item.minimo", { min: 0 }),
    costo: finiteNumber(raw.costo, "delta.item.costo", { min: 0 }),
    proveedor: optionalString(raw.proveedor, "delta.item.proveedor", 200),
    vence: optionalString(raw.vence, "delta.item.vence", 30),
    ubicacion: optionalString(raw.ubicacion, "delta.item.ubicacion", 200),
    compra: optionalString(raw.compra, "delta.item.compra", 30),
    costoEstimado: raw.costo_estimado,
  };
}

function normalizeLot(raw, item) {
  assertExactKeys(raw, LOT_KEYS, "delta.lots[]");
  const itemId = requiredString(raw.item_id, "delta.lots[].item_id", 80);
  if (itemId !== item.id) fail("SCOPE_MISMATCH", "Todos los lotes deben pertenecer al insumo del delta.");
  const initialQuantity = finiteNumber(raw.initial_quantity, "delta.lots[].initial_quantity", { min: 0 });
  const available = finiteNumber(raw.available_quantity, "delta.lots[].available_quantity", { min: 0 });
  if (available - initialQuantity > ZERO_TOLERANCE) fail("INVALID_LOT_QUANTITY", "El saldo del lote supera su cantidad inicial.");
  const rawStatus = requiredString(raw.status, "delta.lots[].status", 40);
  if (!["Vigente", "Disponible", "Vence hoy", "Vencido", "Agotado"].includes(rawStatus)) {
    fail("INVALID_LOT_STATUS", "El estado del lote no es reconocido.");
  }
  return {
    id: requiredString(raw.id, "delta.lots[].id", 100),
    itemId,
    itemName: item.nombre,
    unit: item.unidad,
    receivedAt: optionalString(raw.received_at, "delta.lots[].received_at", 30),
    expiresAt: optionalString(raw.expires_at, "delta.lots[].expires_at", 30),
    initialQuantity,
    available,
    unitCost: finiteNumber(raw.unit_cost, "delta.lots[].unit_cost", { min: 0 }),
    supplier: optionalString(raw.supplier, "delta.lots[].supplier", 200),
    location: optionalString(raw.location, "delta.lots[].location", 200),
    origin: requiredString(raw.origin, "delta.lots[].origin", 80),
    status: rawStatus === "Vigente" ? "Disponible" : rawStatus,
    sourceMovementId: optionalString(raw.source_movement_id, "delta.lots[].source_movement_id", 100),
    createdAt: isoTimestamp(raw.created_at, "delta.lots[].created_at"),
  };
}

function formatQuantity(value, unit) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value} ${unit}`;
}

function normalizeMovement(raw, item) {
  assertExactKeys(raw, MOVEMENT_KEYS, "delta.movements[]");
  const itemId = requiredString(raw.item_id, "delta.movements[].item_id", 80);
  if (itemId !== item.id) fail("SCOPE_MISMATCH", "El movimiento debe pertenecer al insumo del delta.");
  const quantity = finiteNumber(raw.cant, "delta.movements[].cant");
  if (Math.abs(quantity) <= ZERO_TOLERANCE) fail("INVALID_MOVEMENT", "El movimiento no puede ser cero.");
  return {
    id: requiredString(raw.id, "delta.movements[].id", 100),
    fecha: isoTimestamp(raw.fecha, "delta.movements[].fecha"),
    tipo: requiredString(raw.tipo, "delta.movements[].tipo", 80),
    item: item.nombre,
    cant: formatQuantity(quantity, item.unidad),
  };
}

function normalizeAudit(raw, itemId) {
  assertExactKeys(raw, AUDIT_KEYS, "delta.audits[]");
  const entityId = requiredString(raw.entidad_id, "delta.audits[].entidad_id", 100);
  if (entityId !== itemId) fail("SCOPE_MISMATCH", "La auditoría debe pertenecer al insumo del delta.");
  if (raw.entidad !== "Inventario") fail("SCOPE_MISMATCH", "La auditoría del delta debe ser de Inventario.");
  return {
    id: requiredString(raw.id, "delta.audits[].id", 100),
    fecha: isoTimestamp(raw.fecha, "delta.audits[].fecha"),
    entidad: requiredString(raw.entidad, "delta.audits[].entidad", 80),
    entidadId: entityId,
    accion: requiredString(raw.accion, "delta.audits[].accion", 200),
  };
}

function normalizeReconciliation(raw, item, lots) {
  assertExactKeys(raw, RECONCILIATION_KEYS, "delta.reconciliation");
  const itemStock = finiteNumber(raw.item_stock, "delta.reconciliation.item_stock", { min: 0 });
  const lotsAvailable = finiteNumber(raw.lots_available, "delta.reconciliation.lots_available", { min: 0 });
  const difference = finiteNumber(raw.difference, "delta.reconciliation.difference");
  const lotSum = lots.reduce((sum, lot) => sum + lot.available, 0);
  if (raw.exact !== true || Math.abs(difference) > ZERO_TOLERANCE
      || Math.abs(itemStock - lotsAvailable) > ZERO_TOLERANCE
      || Math.abs(item.stock - itemStock) > ZERO_TOLERANCE
      || Math.abs(lotSum - lotsAvailable) > ZERO_TOLERANCE) {
    fail("RECONCILIATION_FAILED", "El stock oficial y los lotes no reconcilian exactamente.");
  }
  return { itemStock, lotsAvailable, difference: 0, exact: true };
}

function extractDelta(input) {
  if (!isRecord(input)) fail("INVALID_OBJECT", "El payload debe ser un objeto.");
  rejectSensitiveKeys(input);
  if (input.contract === MUTATION_CONTRACT) {
    assertExactKeys(input, MUTATION_KEYS, "payload");
    requiredString(input.operation, "payload.operation", 80);
    uuid(input.idempotency_key, "payload.idempotency_key");
    if (typeof input.duplicate !== "boolean") fail("INVALID_DUPLICATE", "payload.duplicate debe ser booleano.");
    validateOpaqueResult(input.result);
    return input.delta;
  }
  if (input.contract === DELTA_CONTRACT) return input;
  fail("INVALID_CONTRACT", "Contrato de mutación de inventario desconocido.");
}

/**
 * Valida un sobre H69 (o su delta directo) y devuelve exclusivamente el delta
 * seguro ya adaptado al shape React. Lanza InventoryMutationEnvelopeError ante
 * cualquier desviación: nunca aplica parcialmente un payload dudoso.
 */
export function normalizeInventoryMutationEnvelope(input) {
  const raw = extractDelta(input);
  assertExactKeys(raw, DELTA_KEYS, "delta");
  if (raw.contract !== DELTA_CONTRACT) fail("INVALID_CONTRACT", "El contrato del delta no es válido.");
  const event = decimalVersion(raw.event_id, "delta.event_id");
  const version = decimalVersion(raw.source_version, "delta.source_version");
  if (event.bigint !== version.bigint) fail("VERSION_MISMATCH", "event_id y source_version deben coincidir.");
  if (raw.scope !== "inventory_item") fail("INVALID_SCOPE", "El delta debe tener alcance inventory_item.");
  const item = normalizeItem(raw.item);
  if (!Array.isArray(raw.lots) || raw.lots.length > 500) fail("INVALID_LOTS", "delta.lots no es válido.");
  if (!Array.isArray(raw.movements) || raw.movements.length > 50) fail("INVALID_MOVEMENTS", "delta.movements admite como máximo 50 movimientos recientes.");
  if (!Array.isArray(raw.audits) || raw.audits.length > 50) fail("INVALID_AUDITS", "delta.audits admite como máximo 50 auditorías recientes.");
  const lots = raw.lots.map((lot) => normalizeLot(lot, item));
  if (new Set(lots.map((lot) => lot.id)).size !== lots.length) fail("DUPLICATE_LOT", "El delta contiene lotes duplicados.");
  const movements = raw.movements.map((movement) => normalizeMovement(movement, item));
  const audits = raw.audits.map((audit) => normalizeAudit(audit, item.id));
  if (new Set(movements.map((movement) => movement.id)).size !== movements.length) {
    fail("DUPLICATE_MOVEMENT", "El delta contiene movimientos duplicados.");
  }
  if (new Set(audits.map((audit) => audit.id)).size !== audits.length) {
    fail("DUPLICATE_AUDIT", "El delta contiene auditorías duplicadas.");
  }
  const reconciliation = normalizeReconciliation(raw.reconciliation, item, lots);
  return {
    contract: DELTA_CONTRACT,
    eventId: event.text,
    sourceVersion: version.text,
    serverTime: isoTimestamp(raw.server_time, "delta.server_time"),
    itemId: item.id,
    item,
    lots,
    movements,
    audits,
    reconciliation,
  };
}

/** Valida una reconciliación dirigida de hasta 50 insumos. */
export function normalizeInventoryDeltaBatch(input) {
  assertExactKeys(input, ["contract", "latest_event_id", "items"], "batch");
  rejectSensitiveKeys(input, "batch");
  if (input.contract !== DELTA_BATCH_CONTRACT) fail("INVALID_CONTRACT", "El contrato del lote de deltas no es válido.");
  const latest = decimalCursor(input.latest_event_id, "batch.latest_event_id");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) {
    fail("INVALID_BATCH", "batch.items debe contener entre 1 y 50 deltas.");
  }
  const items = input.items.map((item) => normalizeInventoryMutationEnvelope(item));
  if (new Set(items.map((item) => item.itemId)).size !== items.length) fail("DUPLICATE_ITEM", "batch.items contiene insumos repetidos.");
  // latest_event_id es un cursor global opaco H70. sourceVersion pertenece al
  // item y solo se compara con el registro monotonicamente local de ese item.
  return { contract: DELTA_BATCH_CONTRACT, latestEventId: latest.text, items };
}

/** Valida el sobre mínimo usado para cerrar gaps de Realtime sin exponer filas. */
export function normalizeInventoryEventsEnvelope(input) {
  assertExactKeys(input, ["contract", "latest_event_id", "next_event_id", "overflow", "item_ids"], "events");
  rejectSensitiveKeys(input, "events");
  if (input.contract !== EVENTS_CONTRACT) fail("INVALID_CONTRACT", "El contrato de eventos no es válido.");
  const latest = decimalCursor(input.latest_event_id, "events.latest_event_id");
  const next = decimalCursor(input.next_event_id, "events.next_event_id");
  if (!Array.isArray(input.item_ids) || input.item_ids.length > 100) fail("INVALID_ITEM_IDS", "events.item_ids excede el límite permitido.");
  const itemIds = input.item_ids.map((id, index) => requiredString(id, `events.item_ids[${index}]`, 80));
  if (new Set(itemIds).size !== itemIds.length) fail("DUPLICATE_ITEM", "events.item_ids contiene insumos repetidos.");
  const resetRequired = next.bigint > latest.bigint;
  const expectedOverflow = resetRequired || next.bigint < latest.bigint;
  if (typeof input.overflow !== "boolean" || input.overflow !== expectedOverflow) {
    fail("INVALID_OVERFLOW", "overflow no coincide con los cursores del sobre.");
  }
  if (resetRequired && itemIds.length) {
    fail("INVALID_CURSOR_RESET", "Un cursor adelantado no puede incluir insumos parciales.");
  }
  return {
    contract: EVENTS_CONTRACT,
    latestEventId: latest.text,
    nextEventId: next.text,
    overflow: input.overflow,
    itemIds,
    resetRequired,
  };
}

function readVersion(versions, itemId) {
  const raw = versions instanceof Map ? versions.get(itemId) : versions?.[itemId];
  if (raw === undefined || raw === null || raw === "") return 0n;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) fail("INVALID_VERSION_REGISTRY", "El registro local de versiones no es válido.");
  return BigInt(raw);
}

function withVersion(versions, itemId, sourceVersion) {
  if (versions instanceof Map) {
    const next = new Map(versions);
    next.set(itemId, sourceVersion);
    return next;
  }
  if (versions !== undefined && (!isRecord(versions) || Array.isArray(versions))) {
    fail("INVALID_VERSION_REGISTRY", "El registro local de versiones debe ser un objeto o Map.");
  }
  return { ...(versions || {}), [itemId]: sourceVersion };
}

function replaceScopedLots(current, itemId, replacement) {
  if (!Array.isArray(current)) return replacement;
  const firstAffected = current.findIndex((lot) => lot?.itemId === itemId);
  const unaffected = current.filter((lot) => lot?.itemId !== itemId);
  if (firstAffected < 0) return [...current, ...replacement];
  const beforeCount = current.slice(0, firstAffected).filter((lot) => lot?.itemId !== itemId).length;
  return [...unaffected.slice(0, beforeCount), ...replacement, ...unaffected.slice(beforeCount)];
}

function mergeRecentRows(current, incoming, limit = 50) {
  if (!incoming.length) return Array.isArray(current) ? current : [];
  const existing = Array.isArray(current) ? current : [];
  const seenIds = new Set();
  const sorted = [...incoming, ...existing]
    .filter((row) => {
      const id = String(row?.id ?? "");
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    })
    .map((row, stableIndex) => ({ row, stableIndex, at: parseOperationalTimestamp(row?.fecha) }))
    .sort((left, right) => {
      const leftAt = left.at ?? Number.NEGATIVE_INFINITY;
      const rightAt = right.at ?? Number.NEGATIVE_INFINITY;
      return rightAt - leftAt || left.stableIndex - right.stableIndex;
    });
  const limited = Number.isSafeInteger(limit) && limit >= 0
    ? sorted.slice(0, limit)
    : sorted;
  return limited.map(({ row }) => row);
}

function mergeMovements(current, incoming) {
  return mergeRecentRows(current, incoming);
}

function mergeAudits(current, incoming) {
  const existing = Array.isArray(current) ? current : [];
  const preserved = existing.filter((row) => row?.entidad !== "Inventario");
  const inventory = mergeRecentRows(
    existing.filter((row) => row?.entidad === "Inventario"),
    incoming,
  );
  return mergeRecentRows(preserved, inventory, Number.POSITIVE_INFINITY);
}

export function mergeInventoryAuditSnapshot(current, incomingInventoryAudits) {
  const preserved = Array.isArray(current)
    ? current.filter((row) => row?.entidad !== "Inventario")
    : [];
  return mergeRecentRows(
    preserved,
    Array.isArray(incomingInventoryAudits) ? incomingInventoryAudits : [],
    Number.POSITIVE_INFINITY,
  );
}

/**
 * Aplica un delta H69 de forma inmutable. Por defecto, un evento repetido o
 * anterior devuelve status="stale". Las lecturas dirigidas pueden habilitar
 * authoritativeOnEqual: el mismo sourceVersion reemplaza el estado combinado
 * actual del item, mientras una version menor permanece bloqueada.
 */
export function applyInventoryMutationEnvelope(db, input, lastVersions = {}, options = {}) {
  if (!isRecord(db)) fail("INVALID_DB", "db debe ser un objeto.");
  const delta = normalizeInventoryMutationEnvelope(input);
  const previous = readVersion(lastVersions, delta.itemId);
  const incoming = BigInt(delta.sourceVersion);
  const authoritativeOnEqual = options?.authoritativeOnEqual === true;
  if (incoming < previous || (incoming === previous && !authoritativeOnEqual)) {
    return {
      status: "stale", db, versions: lastVersions,
      itemId: delta.itemId, sourceVersion: delta.sourceVersion,
    };
  }

  const currentItems = Array.isArray(db.inventory_items) ? db.inventory_items : [];
  const itemIndex = currentItems.findIndex((item) => item?.id === delta.itemId);
  const inventoryItems = itemIndex < 0
    ? [...currentItems, delta.item]
    : currentItems.map((item, index) => (index === itemIndex ? delta.item : item));
  const inventoryLots = replaceScopedLots(db.inventory_lots, delta.itemId, delta.lots);
  const inventoryMovements = mergeMovements(db.inventory_movements, delta.movements);
  const auditLogs = mergeAudits(db.audit_logs, delta.audits);
  const nextDb = {
    ...db,
    inventory_items: inventoryItems,
    inventory_lots: inventoryLots,
    inventory_movements: inventoryMovements,
    audit_logs: auditLogs,
  };
  return {
    status: "applied",
    db: nextDb,
    versions: withVersion(lastVersions, delta.itemId, delta.sourceVersion),
    itemId: delta.itemId,
    sourceVersion: delta.sourceVersion,
  };
}

export const INVENTORY_MUTATION_CONTRACT = MUTATION_CONTRACT;
export const INVENTORY_DELTA_CONTRACT = DELTA_CONTRACT;
export const INVENTORY_DELTA_BATCH_CONTRACT = DELTA_BATCH_CONTRACT;
export const INVENTORY_EVENTS_CONTRACT = EVENTS_CONTRACT;
