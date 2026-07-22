import { canonicalUsableIngredientStock } from "./canonical-stock.js";
import { businessDateISO } from "./business-date.js";
import { inventorySupplyMode } from "./inventory-supply-mode.js";

const PRIORITY_ORDER = { Urgente: 0, Alta: 1, Revisar: 2 };

function positive(value) {
  return Math.max(0, Number(value) || 0);
}

function roundQuantity(value, unit) {
  const safe = positive(value);
  if (["und", "paquete", "docena"].includes(String(unit || "").toLowerCase())) return Math.ceil(safe);
  return Math.ceil(safe * 1000) / 1000;
}

function recentConsumption(item, movements = [], today = businessDateISO(), windowDays = 14) {
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end)) return 0;
  const start = end - (windowDays - 1) * 86400000;
  const consumed = (movements || []).reduce((sum, movement) => {
    if (movement?.item !== item?.nombre) return sum;
    const day = Date.parse(`${String(movement.fecha || "").slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(day) || day < start || day > end) return sum;
    const amount = Number.parseFloat(String(movement.cant || "").replace(",", "."));
    return amount < 0 ? sum + Math.abs(amount) : sum;
  }, 0);
  return consumed / windowDays;
}

export function buildPurchaseAssistant({
  inventoryItems = [], inventoryLots = [], inventoryLotsReady = false,
  subrecipes = [], suggestions = [], movements = [], today,
} = {}) {
  const day = today || businessDateISO();
  const stockDb = {
    inventory_items: inventoryItems,
    inventory_lots: inventoryLots,
    inventoryLotsReady,
  };
  const pending = (suggestions || []).filter((row) => row?.area === "Inventario" && row?.estado === "Pendiente");
  const recommendations = [];
  let internalPending = 0;
  const internalNeedsSetup = [];

  for (const item of inventoryItems || []) {
    const stockView = canonicalUsableIngredientStock(stockDb, item.id, { today: day });
    const current = stockView.usable;
    const supply = inventorySupplyMode(item, subrecipes);
    const itemSuggestions = pending.filter((row) => row.itemId === item.id || (!row.itemId && row.producto === item.nombre));
    const ownProduction = /producci[oó]n propia/i.test(String(item.proveedor || ""))
      || /producci[oó]n interna/i.test(String(item.origenAbastecimiento || item.origen_abastecimiento || ""));
    if (supply.kind === "prepared" || ownProduction) {
      internalPending += itemSuggestions.length;
      if (ownProduction && !supply.subrecipe && (current <= positive(item.min) || itemSuggestions.length)) {
        internalNeedsSetup.push({ itemId: item.id, name: item.nombre, current, minimum: positive(item.min) });
      }
      continue;
    }

    const minimum = positive(item.min);
    const pendingDemand = itemSuggestions.reduce((sum, row) => sum + positive(row.cantidad), 0);
    const dailyUse = recentConsumption(item, movements, day);
    const target = Math.max(minimum * 1.25, dailyUse * 7);
    const replenish = current <= minimum ? Math.max(0, target - current) : 0;
    const quantity = roundQuantity(pendingDemand + replenish, item.unidad);
    if (!(quantity > 0)) continue;

    const priority = pendingDemand > 0 || current === 0 ? "Urgente" : current < minimum ? "Alta" : "Revisar";
    const reasons = [];
    if (pendingDemand > 0) {
      const orders = [...new Set(itemSuggestions.map((row) => row.orderId).filter(Boolean))];
      reasons.push(`${roundQuantity(pendingDemand, item.unidad)} ${item.unidad} faltan para ${orders.length ? orders.join(", ") : "pedidos activos"}`);
    }
    if (current === 0) reasons.push("no queda stock utilizable");
    else if (current < minimum) reasons.push(`stock ${current} ${item.unidad}, por debajo del mínimo ${minimum}`);
    else if (current === minimum) reasons.push(`stock justo en el mínimo ${minimum}`);
    if (stockView.expired > 0) reasons.push(`${stockView.expired} ${item.unidad} vencidos no cuentan`);
    if (dailyUse > 0) reasons.push(`consumo reciente ≈ ${roundQuantity(dailyUse * 7, item.unidad)} ${item.unidad}/semana`);

    recommendations.push({
      itemId: item.id,
      name: item.nombre,
      category: item.cat,
      unit: item.unidad,
      current,
      minimum,
      quantity,
      priority,
      supplier: item.proveedor || "Proveedor por definir",
      location: item.ubicacion || "",
      unitCost: positive(item.costo),
      estimatedCost: quantity * positive(item.costo),
      pendingDemand: roundQuantity(pendingDemand, item.unidad),
      expiredStock: stockView.expired,
      suggestionIds: itemSuggestions.map((row) => row.id),
      orderIds: [...new Set(itemSuggestions.map((row) => row.orderId).filter(Boolean))],
      reasons,
    });
  }

  recommendations.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    || String(a.supplier).localeCompare(String(b.supplier)) || a.name.localeCompare(b.name));

  const suppliers = recommendations.reduce((groups, row) => {
    const key = row.supplier;
    if (!groups[key]) groups[key] = { supplier: key, items: [], estimatedCost: 0 };
    groups[key].items.push(row);
    groups[key].estimatedCost += row.estimatedCost;
    return groups;
  }, {});

  return {
    recommendations,
    suppliers: Object.values(suppliers),
    summary: {
      items: recommendations.length,
      urgent: recommendations.filter((row) => row.priority === "Urgente").length,
      estimatedCost: recommendations.reduce((sum, row) => sum + row.estimatedCost, 0),
      internalPending,
      internalNeedsSetup: internalNeedsSetup.length,
    },
    internalNeedsSetup,
  };
}
