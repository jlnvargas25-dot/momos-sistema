import { businessDateISO } from "./business-date.js";

const isoDay = (value) => String(value || "").slice(0, 10);
const positive = (value) => Math.max(0, Number(value) || 0);

export function ingredientLotStatus(lot, today = businessDateISO()) {
  const available = positive(lot?.available ?? lot?.disponible);
  const expiry = isoDay(lot?.expiresAt ?? lot?.vence);
  if (available === 0) return "Agotado";
  if (expiry && expiry < today) return "Vencido";
  if (expiry === today) return "Vence hoy";
  return "Disponible";
}

export function buildIngredientLotSummary(itemId, lots = [], today) {
  const active = (lots || [])
    .filter((lot) => lot?.itemId === itemId && positive(lot.available) > 0)
    .map((lot) => ({ ...lot, available: positive(lot.available), status: ingredientLotStatus(lot, today) }))
    .sort((a, b) => {
      const ae = isoDay(a.expiresAt) || "9999-12-31";
      const be = isoDay(b.expiresAt) || "9999-12-31";
      return ae.localeCompare(be) || String(a.receivedAt || "").localeCompare(String(b.receivedAt || "")) || String(a.id).localeCompare(String(b.id));
    });
  const expired = active.filter((lot) => lot.status === "Vencido");
  const usable = active.filter((lot) => lot.status !== "Vencido");
  return {
    active,
    expired,
    usable,
    expiredStock: expired.reduce((sum, lot) => sum + lot.available, 0),
    usableStock: usable.reduce((sum, lot) => sum + lot.available, 0),
    lotStock: active.reduce((sum, lot) => sum + lot.available, 0),
    nextExpiry: usable.find((lot) => lot.expiresAt)?.expiresAt || "",
  };
}

export function planIngredientLotFifo(itemId, lots = [], quantity, today, { allowExpired = false } = {}) {
  let remaining = positive(quantity);
  const summary = buildIngredientLotSummary(itemId, lots, today);
  const candidates = allowExpired ? summary.active : summary.usable;
  const allocations = [];
  for (const lot of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.available);
    if (take > 0) allocations.push({ lotId: lot.id, quantity: take });
    remaining -= take;
  }
  return { allocations, requested: positive(quantity), missing: Math.max(0, remaining) };
}
