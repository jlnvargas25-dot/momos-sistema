import { buildFinishedInventory } from "./finished-inventory.js";
import { buildIngredientLotSummary } from "./ingredient-lots.js";
import { businessDateISO } from "./business-date.js";
import { expectedFigureProductId, isKitchenFigureName } from "./momos-domain-language.js";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildCanonicalFinishedStock(db = {}, { today = businessDateISO() } = {}) {
  return buildFinishedInventory(db, { today });
}

export function canonicalFinishedProductStock(db = {}, productId, options = {}) {
  const view = options.view || buildCanonicalFinishedStock(db, options);
  const product = view.products.find((row) => row.id === productId);
  if (!product) return null;
  return {
    official: product.officialAvailable,
    sellable: product.exactAvailable,
    withoutExactDetail: product.withoutVariantDetail,
    quarantined: product.quarantined,
  };
}

/**
 * Variantes exactas utilizables por los flujos comerciales.
 *
 * Cuando el servidor entregó el agregado oficial `products.stock`, la
 * reconciliación del inventario terminado manda y limita las variantes. En
 * fixtures o respaldos antiguos donde ese agregado no existe, conservamos las
 * variantes como fuente disponible: ausencia de dato no significa stock cero.
 */
export function canonicalVariantsForAvailability(db = {}, { today = businessDateISO() } = {}) {
  const view = buildCanonicalFinishedStock(db, { today });
  const productsWithOfficialStock = new Set((db.products || [])
    .filter((product) => product?.stock !== undefined
      && product?.stock !== null
      && Number.isFinite(Number(product.stock)))
    .map((product) => product.id));
  const variantsWithoutOfficialAggregate = (db.variantes || [])
    .filter((variant) => !productsWithOfficialStock.has(variant.productId));
  return [...view.variants, ...variantsWithoutOfficialAggregate];
}

export function canonicalExactFinishedStock(db = {}, {
  productId, figure, flavor, today = businessDateISO(),
} = {}) {
  const normalizedFigure = String(figure || "").trim();
  const normalizedFlavor = String(flavor || "").trim().toLocaleLowerCase("es");
  if (!productId || !isKitchenFigureName(normalizedFigure)
    || expectedFigureProductId(normalizedFigure) !== String(productId)
    || !normalizedFlavor) return 0;
  return canonicalVariantsForAvailability(db, { today })
    .filter((variant) => variant.productId === productId
      && String(variant.figura || "").trim() === normalizedFigure
      && String(variant.sabor || "").trim().toLocaleLowerCase("es") === normalizedFlavor
      && (!variant.vence || String(variant.vence).slice(0, 10) >= today))
    .reduce((sum, variant) => sum + Math.max(0, number(variant.disponibles)), 0);
}

export function canonicalUsableIngredientStock(db = {}, itemId, { today = businessDateISO() } = {}) {
  const item = (db.inventory_items || []).find((row) => row.id === itemId) || null;
  if (!item) return {
    item: null, physical: 0, usable: 0, expired: 0, lotStock: 0,
    nextExpiry: "", source: "missing",
  };
  if (db.inventoryLotsReady === true) {
    const lots = buildIngredientLotSummary(itemId, db.inventory_lots || [], today);
    return {
      item,
      physical: Math.max(0, number(item.stock)),
      usable: lots.usableStock,
      expired: lots.expiredStock,
      lotStock: lots.lotStock,
      nextExpiry: lots.nextExpiry,
      source: "vigente-lots",
      lots,
    };
  }
  const physical = Math.max(0, number(item.stock));
  return {
    item, physical, usable: physical, expired: 0, lotStock: physical,
    nextExpiry: item.vence || "", source: "legacy-aggregate",
  };
}
