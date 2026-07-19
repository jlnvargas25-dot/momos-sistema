const BATCH_CONTRACT = "momos.finished-inventory-delta-batch.v1";
const DELTA_CONTRACT = "momos.finished-inventory-delta.v1";

function token(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized) || /^0+$/.test(normalized)) return "";
  return normalized.replace(/^0+(?=\d)/, "");
}

function compareTokens(left, right) {
  const a = token(left);
  const b = token(right);
  if (!a || !b) return null;
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a === b ? 0 : a > b ? 1 : -1;
}

function requiredRows(value, label) {
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error(`La respuesta de producto terminado no contiene ${label} como colección cerrada.`);
  }
  return value;
}

function variantIdentity(row) {
  return [row.productId, row.figura, row.sabor, row.gramajeG].map((value) => String(value ?? "")).join("|");
}

export function compareFinishedInventoryDeltaVersions(left, right) {
  return compareTokens(left, right);
}

export function normalizeFinishedInventoryDeltaBatch(envelope) {
  if (!envelope || typeof envelope !== "object" || envelope.contract !== BATCH_CONTRACT) {
    throw new Error("La respuesta de producto terminado no tiene el contrato esperado.");
  }
  if (envelope.containsSecrets !== false || envelope.externalExecution !== false) {
    throw new Error("La respuesta de producto terminado abrió una frontera no autorizada.");
  }
  const deltas = requiredRows(envelope.deltas, "deltas").map((delta) => {
    const productId = String(delta.productId || "").trim();
    const version = token(delta.version);
    if (delta.contract !== DELTA_CONTRACT || !productId || !version
        || !delta.product || typeof delta.product !== "object" || Array.isArray(delta.product)
        || String(delta.product.id || "").trim() !== productId) {
      throw new Error("La respuesta de producto terminado contiene un producto incompleto o sin versión válida.");
    }
    const productionBatches = requiredRows(delta.productionBatches, "productionBatches");
    const variants = requiredRows(delta.variants, "variants");
    const quarantinedVariants = requiredRows(delta.quarantinedVariants, "quarantinedVariants");
    const batchIds = new Set();
    for (const batch of productionBatches) {
      const batchId = String(batch.id || "").trim();
      if (!batchId || batchIds.has(batchId) || String(batch.productId || "").trim() !== productId
          || !Array.isArray(batch.resultadosFiguras)) {
        throw new Error("La respuesta de producto terminado mezcló o repitió lotes.");
      }
      batchIds.add(batchId);
    }
    for (const [label, collection] of [["variants", variants], ["quarantinedVariants", quarantinedVariants]]) {
      const identities = new Set();
      for (const row of collection) {
        const identity = variantIdentity(row);
        if (String(row.productId || "").trim() !== productId || identities.has(identity)) {
          throw new Error(`La respuesta de producto terminado mezcló o repitió filas en ${label}.`);
        }
        identities.add(identity);
      }
    }
    return { ...delta, productId, version, productionBatches, variants, quarantinedVariants };
  });
  const productIds = new Set();
  for (const delta of deltas) {
    if (productIds.has(delta.productId)) throw new Error("La respuesta de producto terminado repitió un producto.");
    productIds.add(delta.productId);
  }
  return { contract: BATCH_CONTRACT, serverTime: envelope.serverTime || "", deltas };
}

function rows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];
}

function replaceProductRows(current, incoming, productId) {
  return [...rows(current).filter((row) => String(row.productId || "") !== productId), ...incoming];
}

export function applyFinishedInventoryDeltaBatchToDb(db, envelope) {
  const normalized = normalizeFinishedInventoryDeltaBatch(envelope);
  if (!db || typeof db !== "object") throw new Error("MOMO OPS no tiene un estado válido para producto terminado.");
  if (!db.finishedInventoryDeltaVersions || typeof db.finishedInventoryDeltaVersions !== "object"
      || Array.isArray(db.finishedInventoryDeltaVersions)) db.finishedInventoryDeltaVersions = {};
  const applied = [];
  const stale = [];
  for (const delta of normalized.deltas) {
    const currentVersion = token(db.finishedInventoryDeltaVersions[delta.productId]);
    if (currentVersion && compareTokens(delta.version, currentVersion) !== 1) {
      stale.push(delta.productId);
      continue;
    }
    const existing = rows(db.products).find((product) => product.id === delta.productId) || {};
    db.products = [
      ...rows(db.products).filter((product) => product.id !== delta.productId),
      { ...existing, ...delta.product },
    ];
    db.production_batches = replaceProductRows(db.production_batches, delta.productionBatches, delta.productId);
    db.variantes = replaceProductRows(db.variantes, delta.variants, delta.productId);
    db.variantesCuarentena = replaceProductRows(db.variantesCuarentena, delta.quarantinedVariants, delta.productId);
    db.finishedInventoryDeltaVersions[delta.productId] = delta.version;
    applied.push(delta.productId);
  }
  return { status: stale.length && !applied.length ? "stale" : "applied", applied, stale };
}

export const FINISHED_INVENTORY_DELTA_BATCH_CONTRACT = BATCH_CONTRACT;
export const FINISHED_INVENTORY_DELTA_CONTRACT = DELTA_CONTRACT;
