import {
  COMMERCIAL_FAMILY_NAMES_BY_ID,
  KITCHEN_FIGURE_DEFAULTS,
  commercialFamilyLabel,
  expectedFigureProductId,
  isKitchenFigureName,
  normalizeDomainText,
} from "./momos-domain-language.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function gramNumber(value) {
  const match = String(value ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function utcDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

export function classifyExpiry(expiry, today) {
  const expiryTime = utcDateOnly(expiry);
  const todayTime = utcDateOnly(today);
  if (expiryTime == null || todayTime == null) return { priority: "missing", days: null };
  const days = Math.round((expiryTime - todayTime) / DAY_MS);
  if (days < 0) return { priority: "expired", days };
  if (days === 0) return { priority: "today", days };
  if (days <= 2) return { priority: "urgent", days };
  if (days <= 5) return { priority: "soon", days };
  return { priority: "later", days };
}

function expiryRow(row, today) {
  return { ...row, ...classifyExpiry(row.expiry, today) };
}

function priorityRank(priority) {
  return ({ expired: 0, today: 1, urgent: 2, soon: 3, missing: 4, later: 5 })[priority] ?? 6;
}

function sortRows(rows) {
  return rows.slice().sort((left, right) => {
    const rank = priorityRank(left.priority) - priorityRank(right.priority);
    if (rank) return rank;
    return `${left.expiry || "9999-12-31"}:${left.name}:${left.id}`.localeCompare(`${right.expiry || "9999-12-31"}:${right.name}:${right.id}`);
  });
}

function isKitchenConsumable(item) {
  const category = String(item?.cat || "").toLocaleLowerCase("es");
  return !/(caja|vaso|sticker|empaque|cuchara|servilleta|cubierto)/.test(category);
}

function buildInventoryRows({ inventoryLots, inventoryItems, inventoryLotsReady, preparationItemIds, preparationNames, today }) {
  const itemById = new Map(inventoryItems.map((item) => [item.id, item]));
  const positiveLots = inventoryLots.filter((lot) => number(lot?.available) > 0
    && (preparationItemIds.has(lot.itemId) || isKitchenConsumable(itemById.get(lot.itemId))));
  const rows = positiveLots.map((lot) => {
    const isPreparation = preparationItemIds.has(lot.itemId);
    return expiryRow({
      id: `inventory:${lot.id}`,
      sourceId: lot.id,
      kind: isPreparation ? "preparation" : "ingredient",
      name: isPreparation ? (preparationNames.get(lot.itemId) || lot.itemName || "Elaboración") : (lot.itemName || "Insumo"),
      quantity: number(lot.available),
      unit: lot.unit || "",
      expiry: lot.expiresAt || "",
      receivedAt: lot.receivedAt || "",
      location: lot.location || "",
      origin: lot.origin || "",
      exactLot: true,
    }, today);
  });

  if (inventoryLotsReady) return rows;
  const representedItems = new Set(positiveLots.map((lot) => lot.itemId));
  const fallbacks = inventoryItems
    .filter((item) => number(item?.stock) > 0 && !representedItems.has(item.id)
      && (preparationItemIds.has(item.id) || isKitchenConsumable(item)))
    .map((item) => {
      const isPreparation = preparationItemIds.has(item.id);
      return expiryRow({
        id: `inventory-item:${item.id}`,
        sourceId: item.id,
        kind: isPreparation ? "preparation" : "ingredient",
        name: isPreparation ? (preparationNames.get(item.id) || item.nombre || "Elaboración") : (item.nombre || "Insumo"),
        quantity: number(item.stock),
        unit: item.unidad || "",
        expiry: item.vence || "",
        receivedAt: "",
        location: item.ubicacion || "",
        origin: isPreparation ? "Producción" : "Histórico sin lote",
        exactLot: false,
      }, today);
    });
  return [...rows, ...fallbacks];
}

function buildFinishedRows(productionBatches, today) {
  return productionBatches
    .filter((batch) => batch?.stockContabilizado)
    .flatMap((batch) => (Array.isArray(batch.resultadosFiguras) ? batch.resultadosFiguras : []).map((result) => ({ batch, result })))
    .filter(({ result }) => isKitchenFigureName(result?.figura))
    .map(({ batch, result }) => ({
      batch,
      result,
      remaining: Math.max(0, number(result?.perfectas) - number(result?.consumidas)),
    }))
    .filter(({ remaining }) => remaining > 0)
    .map(({ batch, result, remaining }) => {
      const expectedGrams = KITCHEN_FIGURE_DEFAULTS[result.figura]?.grams || 0;
      const recordedGrams = gramNumber(batch.gramaje);
      const expectedFamilyName = COMMERCIAL_FAMILY_NAMES_BY_ID[expectedFigureProductId(result.figura)] || "";
      const assemblySpecVersion = String(batch.assemblySpecVersion || "").trim().toUpperCase();
      const isHistoricalAssembly = assemblySpecVersion === "V3"
        || (!assemblySpecVersion && String(batch.fecha || "") < "2026-07-23");
      const recordedFamilyName = commercialFamilyLabel(batch.producto || "");
      const issues = [];
      if (!isHistoricalAssembly && expectedGrams && recordedGrams && expectedGrams !== recordedGrams) {
        issues.push(`${result.figura} requiere ${expectedGrams} g; el lote registra ${recordedGrams} g`);
      }
      if (expectedFamilyName && recordedFamilyName && normalizeDomainText(expectedFamilyName) !== normalizeDomainText(recordedFamilyName)) {
        issues.push(`${result.figura} pertenece a ${expectedFamilyName}; el lote registra ${recordedFamilyName}`);
      }
      return expiryRow({
      id: `finished:${batch.id}:${result.figura}`,
      sourceId: batch.id,
      kind: "finished",
      name: batch.producto || "Producto terminado",
      figure: result.figura || batch.figura || "Sin figura",
      flavor: batch.sabor || "Sin sabor",
      grams: batch.gramaje || "",
      quantity: remaining,
      unit: "und",
      expiry: batch.vence || "",
      receivedAt: batch.desmoldadoEn || batch.fecha || "",
      location: batch.ubicacion || "",
      origin: "Producción",
      exactLot: true,
      expectedGrams,
      expectedFamilyName,
      integrityWarning: issues.length ? `Dato histórico por corregir: ${issues.join("; ")}` : "",
    }, today);
    });
}

/**
 * Bandeja FEFO de Cocina. Conserva vencidos y faltantes de fecha como alertas;
 * nunca borra, descuenta ni transforma los datos de origen.
 */
export function buildProductionExpiryControl({
  today,
  inventoryLots = [],
  inventoryItems = [],
  inventoryLotsReady = false,
  subrecipes = [],
  productionBatches = [],
} = {}) {
  const preparationItemIds = new Set(subrecipes.map((subrecipe) => subrecipe.itemId).filter(Boolean));
  const preparationNames = new Map(subrecipes.map((subrecipe) => [subrecipe.itemId, subrecipe.nombre]));
  const inventoryRows = buildInventoryRows({
    inventoryLots, inventoryItems, inventoryLotsReady, preparationItemIds, preparationNames, today,
  });
  const rows = sortRows([...inventoryRows, ...buildFinishedRows(productionBatches, today)]);
  const actionable = rows.filter((row) => row.priority !== "later");
  const byKind = {
    ingredient: actionable.filter((row) => row.kind === "ingredient"),
    preparation: actionable.filter((row) => row.kind === "preparation"),
    finished: actionable.filter((row) => row.kind === "finished"),
  };
  const summary = Object.fromEntries(["expired", "today", "urgent", "soon", "missing"].map((priority) => [priority, actionable.filter((row) => row.priority === priority).length]));
  return { rows, actionable, byKind, summary };
}
