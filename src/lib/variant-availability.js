import {
  activeFigureCatalog,
  expectedFigureProductId,
  figureProductId,
  isKitchenFigureName,
} from "./momos-domain-language.js";
import { businessDateISO } from "./business-date.js";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normal(value) {
  return String(value || "").trim().toLocaleLowerCase("es");
}

function variantKey(productId, figure, flavor) {
  return `${productId || ""}\u0000${normal(figure)}\u0000${normal(flavor)}`;
}

function figureBelongsToProduct(productId, figure) {
  const expectedProductId = expectedFigureProductId(figure);
  return Boolean(expectedProductId && String(productId || "").trim() === expectedProductId);
}

function todayIso() {
  return businessDateISO();
}

function exactVariantPool(variants = [], today = todayIso()) {
  const pool = new Map();
  variants.forEach((variant) => {
    const available = Math.max(0, number(variant.disponibles));
    const expiry = variant?.vence ? String(variant.vence).slice(0, 10) : "";
    if (!variant?.productId
      || !isKitchenFigureName(variant.figura)
      || !figureBelongsToProduct(variant.productId, variant.figura)
      || !normal(variant.sabor)
      || available <= 0
      || (expiry && expiry < today)) return;
    const key = variantKey(variant.productId, variant.figura, variant.sabor);
    const current = pool.get(key) || { available: 0, expirations: [] };
    current.available += available;
    if (variant.vence) current.expirations.push(variant.vence);
    pool.set(key, current);
  });
  pool.forEach((entry) => entry.expirations.sort());
  return pool;
}

export function evaluateExactVariantDemand({
  productId,
  productName = "",
  figure,
  flavor,
  quantity = 1,
  variants = [],
  today = todayIso(),
} = {}) {
  const required = Math.max(0, Math.round(number(quantity)));
  const figureKnown = isKitchenFigureName(figure);
  const compatibleFamily = figureKnown && figureBelongsToProduct(productId, figure);
  const complete = Boolean(productId && figureKnown && compatibleFamily && normal(flavor));
  const entry = complete ? exactVariantPool(variants, today).get(variantKey(productId, figure, flavor)) : null;
  const available = entry?.available || 0;
  const covered = Math.min(required, available);
  return {
    productId,
    productName,
    figure: figure || "",
    flavor: flavor || "",
    required,
    available,
    covered,
    missing: complete ? Math.max(0, required - covered) : 0,
    complete,
    canFulfill: complete && covered >= required,
    nextExpiry: entry?.expirations?.[0] || "",
    integrityIssue: figureKnown && productId && !compatibleFamily ? "FAMILY_FIGURE_MISMATCH" : "",
    expectedProductId: figureKnown ? expectedFigureProductId(figure) : "",
  };
}

function componentForFigure(db, combo, figure) {
  if (!isKitchenFigureName(figure)) return null;
  const expectedProductId = expectedFigureProductId(figure);
  const componentIds = combo?.componentProductIds || [];
  const mappedFigure = activeFigureCatalog(db)
    .find((item) => normal(item?.nombre) === normal(figure));
  const mappedProductId = figureProductId(mappedFigure);
  if (!expectedProductId
    || mappedProductId !== expectedProductId
    || !componentIds.includes(expectedProductId)) return null;
  return (db?.products || []).find((product) => product.id === expectedProductId) || null;
}

export function evaluateComboVariantAvailability({ db = {}, combo, boxes = [], today = todayIso() } = {}) {
  const pool = exactVariantPool(db.variantes || [], today);
  const remaining = new Map(Array.from(pool, ([key, entry]) => [key, entry.available]));
  const grouped = new Map();
  const slots = [];

  (boxes || []).forEach((box, boxIndex) => (box || []).forEach((slot, slotIndex) => {
    const component = slot?.figura ? componentForFigure(db, combo, slot.figura) : null;
    const complete = Boolean(component && normal(slot?.figura) && normal(slot?.sabor));
    const key = complete ? variantKey(component.id, slot.figura, slot.sabor) : "";
    const availableBefore = complete ? (remaining.get(key) || 0) : 0;
    const covered = complete && availableBefore > 0;
    if (covered) remaining.set(key, availableBefore - 1);

    const result = {
      boxIndex,
      slotIndex,
      productId: component?.id || "",
      productName: component?.nombre || "",
      figure: slot?.figura || "",
      flavor: slot?.sabor || "",
      complete,
      covered,
      availableBefore,
      nextExpiry: complete ? (pool.get(key)?.expirations?.[0] || "") : "",
    };
    slots.push(result);

    if (complete) {
      const current = grouped.get(key) || { ...result, required: 0, available: pool.get(key)?.available || 0 };
      current.required += 1;
      grouped.set(key, current);
    }
  }));

  const demands = Array.from(grouped.values()).map((demand) => ({
    productId: demand.productId,
    productName: demand.productName,
    figure: demand.figure,
    flavor: demand.flavor,
    required: demand.required,
    available: demand.available,
    covered: Math.min(demand.required, demand.available),
    missing: Math.max(0, demand.required - demand.available),
  }));
  const shortages = demands.filter((demand) => demand.missing > 0);
  const completeSlots = slots.filter((slot) => slot.complete);
  const covered = completeSlots.filter((slot) => slot.covered).length;

  return {
    slots,
    demands,
    shortages,
    required: completeSlots.length,
    covered,
    incomplete: slots.length - completeSlots.length,
    canFulfill: slots.length > 0 && completeSlots.length === slots.length && covered === slots.length,
  };
}
