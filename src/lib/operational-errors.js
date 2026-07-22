import { inventorySupplyMode } from "./inventory-supply-mode.js";

function number(value) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatOperationalQuantity(value, unit = "") {
  const amount = number(value);
  if (unit === "kg" && amount < 1) return `${Math.round(amount * 1000)} g`;
  if (unit === "L" && amount < 1) return `${Math.round(amount * 1000)} ml`;
  const formatted = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(amount);
  return `${formatted} ${unit || "unidades"}`.trim();
}

export function explainOperationalError(error, { inventory = [], subrecipes = [] } = {}) {
  const raw = String(error?.message || error || "No se pudo completar el comando.").trim();
  const shortage = raw.match(/Stock vigente insuficiente para\s+(.+?)\.\s*Solicitado:\s*([0-9]+(?:[.,][0-9]+)?),\s*disponible por lotes:\s*([0-9]+(?:[.,][0-9]+)?)\.?/i);
  if (!shortage) return raw;

  const [, itemId, requestedRaw, availableRaw] = shortage;
  const item = inventory.find((candidate) => String(candidate.id) === String(itemId));
  const name = item?.nombre || "este insumo";
  const unit = item?.unidad || "unidades";
  const requested = formatOperationalQuantity(requestedRaw, unit);
  const available = formatOperationalQuantity(availableRaw, unit);
  const supply = item ? inventorySupplyMode(item, subrecipes) : null;

  let nextStep = "Revisá sus lotes vigentes en Inventario y volvé a confirmar.";
  if (supply?.kind === "prepared" && supply.canPrepare) {
    nextStep = `Prepará ${supply.preparationName || name} en Cocina y volvé a confirmar.`;
  } else if (supply?.kind === "prepared") {
    nextStep = `La elaboración interna ${supply.preparationName || name} está inactiva. Activala en Productos antes de continuar.`;
  } else if (supply?.kind === "purchase") {
    nextStep = `Registrá una compra o entrada vigente de ${name} en Inventario y volvé a confirmar.`;
  }

  return `Stock vigente insuficiente de ${name}. Necesitás ${requested} y hay ${available} disponibles en lotes vigentes. ${nextStep}`;
}
