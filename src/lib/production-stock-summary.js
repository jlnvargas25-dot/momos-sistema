import {
  expectedFigureProductId,
  isCommercialFamilyProduct,
  isKitchenFigureName,
} from "./momos-domain-language.js";
import { buildCanonicalFinishedStock } from "./canonical-stock.js";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function remainingFigureUnits(row) {
  return Math.max(0, number(row?.perfectas) - number(row?.consumidas));
}

function figureBelongsToProduct(productId, figure) {
  const expectedProductId = expectedFigureProductId(figure);
  return Boolean(expectedProductId && String(productId || "").trim() === expectedProductId);
}

/**
 * Unifica el total histórico del producto con el detalle trazable que realmente
 * puede prometerse por figura y sabor. No corrige ni muta saldos: hace visible
 * cualquier diferencia para que Cocina pueda sanear el histórico.
 */
export function buildFinishedStockSummary({
  products = [], variants = [], quarantinedVariants = [], productionBatches = [], today = "",
} = {}) {
  const canonical = buildCanonicalFinishedStock({
    products, variantes: variants, variantesCuarentena: quarantinedVariants,
    production_batches: productionBatches, inventory_reservations: [],
  }, today ? { today } : undefined);
  return products.filter(isCommercialFamilyProduct).map((product) => {
    const canonicalProduct = canonical.products.find((row) => row.id === product.id);
    const variantCandidates = variants.filter((variant) => variant.productId === product.id
      && isKitchenFigureName(variant.figura) && number(variant.disponibles) > 0);
    const quarantineCandidates = quarantinedVariants.filter((variant) => variant.productId === product.id
      && isKitchenFigureName(variant.figura) && number(variant.disponibles) > 0);
    const incompatibleVariants = variantCandidates
      .filter((variant) => !figureBelongsToProduct(product.id, variant.figura));
    const incompatibleQuarantinedVariants = quarantineCandidates
      .filter((variant) => !figureBelongsToProduct(product.id, variant.figura));
    const productVariants = canonical.variants.filter((variant) => variant.productId === product.id);
    const quarantine = canonical.quarantinedVariants.filter((variant) => variant.productId === product.id);
    const exactAvailable = canonicalProduct?.exactAvailable || 0;
    const quarantined = canonicalProduct?.quarantined || 0;
    const registeredTotal = canonicalProduct?.officialAvailable || 0;

    const lotCandidates = productionBatches
      .filter((batch) => batch?.productId === product.id && batch?.stockContabilizado)
      .flatMap((batch) => (Array.isArray(batch.resultadosFiguras) ? batch.resultadosFiguras : [])
        .filter((row) => isKitchenFigureName(row?.figura))
        .map((row) => ({
          id: `${batch.id}:${row.figura}`,
          batchId: batch.id,
          figure: row.figura || batch.figura || "Sin figura",
          flavor: batch.sabor || "Sin sabor",
          grams: batch.gramaje || "",
          expiry: batch.vence || "",
          available: remainingFigureUnits(row),
          quarantined: Boolean(batch.vence && today && batch.vence < today),
        })))
      .filter((row) => row.available > 0);
    const incompatibleLotRows = lotCandidates
      .filter((row) => !figureBelongsToProduct(product.id, row.figure));
    const lotRows = lotCandidates
      .filter((row) => figureBelongsToProduct(product.id, row.figure))
      .sort((left, right) => `${left.expiry || "9999-12-31"}:${left.batchId}`.localeCompare(`${right.expiry || "9999-12-31"}:${right.batchId}`));

    return {
      productId: product.id,
      name: product.nombre,
      registeredTotal,
      exactAvailable,
      unclassified: canonicalProduct?.withoutVariantDetail || 0,
      quarantined,
      variants: productVariants.slice().sort((left, right) => `${left.figura}:${left.sabor}:${left.gramajeG}`.localeCompare(`${right.figura}:${right.sabor}:${right.gramajeG}`)),
      quarantinedVariants: quarantine,
      lotRows,
      incompatibleVariants,
      incompatibleQuarantinedVariants,
      incompatibleLotRows,
      incompatibleUnits: [...incompatibleVariants, ...incompatibleQuarantinedVariants]
        .reduce((sum, variant) => sum + number(variant.disponibles), 0),
    };
  });
}
