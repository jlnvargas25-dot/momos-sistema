import {
  expectedFigureProductId,
  isCommercialFamilyProduct,
  isKitchenFigureName,
  KITCHEN_FIGURE_DEFAULTS,
  KITCHEN_FIGURE_NAMES,
} from "./momos-domain-language.js";
import { businessDateISO } from "./business-date.js";
import { buildCanonicalPhysicalResults, canonicalBatchPhysicalResult } from "./canonical-production-results.js";

const PROCESS_STATES = new Set(["En preparación", "Congelando"]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonNegative(value) {
  return Math.max(0, number(value));
}

function grams(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function todayIso() {
  return businessDateISO();
}

function expired(date, today) {
  return Boolean(date && String(date).slice(0, 10) < today);
}

function figureBelongsToProduct(productId, figure) {
  const expectedProductId = expectedFigureProductId(figure);
  return Boolean(expectedProductId && String(productId || "").trim() === expectedProductId);
}

function hasImperfectDestination(batch) {
  const destination = String(batch?.destino || "").trim();
  return destination !== "" && destination !== "—";
}

function isShakeDestination(batch) {
  return /malteada/i.test(String(batch?.destino || ""));
}

function figureOutcomeRows(batch) {
  const detailed = Array.isArray(batch?.resultadosFiguras) ? batch.resultadosFiguras : [];
  const expectedImperfect = nonNegative(batch?.imperfectas);
  const expectedDiscarded = nonNegative(batch?.descartadas);
  const rows = detailed.map((row) => ({
    figura: isKitchenFigureName(row?.figura) ? String(row.figura).trim() : "Sin figura verificable",
    perfectas: nonNegative(row.perfectas),
    imperfectas: nonNegative(row.imperfectas),
    descartadas: nonNegative(row.descartadas),
  }));
  const assignedImperfect = rows.reduce((sum, row) => sum + row.imperfectas, 0);
  const assignedDiscarded = rows.reduce((sum, row) => sum + row.descartadas, 0);
  if (rows.length) {
    const remainderImperfect = Math.max(0, expectedImperfect - assignedImperfect);
    const remainderDiscarded = Math.max(0, expectedDiscarded - assignedDiscarded);
    if (remainderImperfect || remainderDiscarded) rows.push({
      figura: "Sin figura verificable", perfectas: 0,
      imperfectas: remainderImperfect, descartadas: remainderDiscarded,
    });
    return rows;
  }

  const planned = Array.isArray(batch?.figuras)
    ? batch.figuras.filter((row) => number(row.cant) > 0 && isKitchenFigureName(row?.figura))
    : [];
  const candidate = batch?.figura || (planned.length === 1 ? planned[0].figura : "");
  const onlyFigure = isKitchenFigureName(candidate) ? String(candidate).trim() : "Sin figura verificable";
  return [{
    figura: onlyFigure, perfectas: nonNegative(batch?.perfectas),
    imperfectas: expectedImperfect, descartadas: expectedDiscarded,
  }];
}

function earliestDate(current, next) {
  if (!next) return current || "";
  if (!current) return String(next);
  return String(next) < String(current) ? String(next) : current;
}

export function buildFinishedInventory(db = {}, { today = todayIso() } = {}) {
  const baseProducts = (db.products || [])
    .filter((product) => isCommercialFamilyProduct(product) && (product.activo !== false || number(product.stock) > 0))
    .map((product) => ({
      ...product,
      officialAvailable: nonNegative(product.stock),
      invalidNegativeStock: number(product.stock) < 0,
    }));

  const productIds = new Set(baseProducts.map((product) => product.id));
  const candidateVariants = [...(db.variantes || []), ...(db.variantesCuarentena || [])]
    .filter((variant) => productIds.has(variant.productId) && isKitchenFigureName(variant.figura) && number(variant.disponibles) > 0)
    .map((variant) => ({ ...variant, disponibles: nonNegative(variant.disponibles) }));
  const incompatibleVariants = candidateVariants.filter((variant) => !figureBelongsToProduct(variant.productId, variant.figura));
  const reportedVariants = candidateVariants.filter((variant) => figureBelongsToProduct(variant.productId, variant.figura));
  const quarantinedVariants = reportedVariants.filter((variant) => expired(variant.vence, today));
  const eligibleVariants = reportedVariants.filter((variant) => !expired(variant.vence, today));
  const quarantinedByProduct = quarantinedVariants.reduce((totals, variant) => {
    totals[variant.productId] = (totals[variant.productId] || 0) + variant.disponibles;
    return totals;
  }, {});
  const products = baseProducts.map((product) => ({
    ...product,
    available: Math.max(0, product.officialAvailable - (quarantinedByProduct[product.id] || 0)),
    quarantined: Math.min(product.officialAvailable, quarantinedByProduct[product.id] || 0),
  }));

  // Products.stock is the official sales counter. Variant detail can explain it,
  // but must never make the UI promise more units than that counter contains.
  const productById = new Map(products.map((product) => [product.id, product]));
  const eligibleTotals = eligibleVariants.reduce((totals, variant) => {
    totals[variant.productId] = (totals[variant.productId] || 0) + variant.disponibles;
    return totals;
  }, {});
  const inconsistentProducts = new Set(Object.entries(eligibleTotals)
    .filter(([productId, total]) => total > (productById.get(productId)?.available || 0))
    .map(([productId]) => productId));
  const reconciliationExcess = Array.from(inconsistentProducts).reduce((sum, productId) => (
    sum + eligibleTotals[productId] - (productById.get(productId)?.available || 0)
  ), 0);
  const reconciliationBlocked = Array.from(inconsistentProducts).reduce((sum, productId) => sum + eligibleTotals[productId], 0);
  const variants = eligibleVariants.filter((variant) => !inconsistentProducts.has(variant.productId));

  const exactByProduct = variants.reduce((totals, variant) => {
    totals[variant.productId] = (totals[variant.productId] || 0) + variant.disponibles;
    return totals;
  }, {});

  const finishedProducts = products.map((product) => {
    const exactAvailable = exactByProduct[product.id] || 0;
    return {
      ...product,
      exactAvailable,
      withoutVariantDetail: Math.max(0, product.available - exactAvailable),
    };
  });

  const reservationHistory = (db.inventory_reservations || [])
    .filter((reservation) => reservation.tipo === "producto" && reservation.estado !== "Liberada")
    .map((reservation) => ({ ...reservation, cantidad: number(reservation.cantidad) }))
    .sort((a, b) => (a.estado === "Reservada" ? -1 : 1) - (b.estado === "Reservada" ? -1 : 1));

  const activeReservations = reservationHistory.filter((reservation) => reservation.estado === "Reservada");
  const reservations = activeReservations;
  const inProcess = (db.production_batches || []).filter((batch) => PROCESS_STATES.has(batch.estado));
  const imperfects = (db.production_batches || [])
    .filter((batch) => number(batch.imperfectas) > 0 || number(batch.descartadas) > 0)
    .map((batch) => {
      const physicalResult = canonicalBatchPhysicalResult(batch);
      return {
        ...batch,
        perfectas: physicalResult.perfect,
        imperfectas: physicalResult.imperfect,
        descartadas: physicalResult.discarded,
        physicalResult,
        destinationRegistered: hasImperfectDestination(batch),
        forShakes: isShakeDestination(batch),
        figureOutcomes: figureOutcomeRows(batch),
      };
    });
  const physicalResults = buildCanonicalPhysicalResults(db.production_batches || []);

  const figureIndex = new Map();
  function ensureFigure(name, metadata = {}) {
    const figure = String(name || "Sin figura verificable");
    if (!figureIndex.has(figure)) figureIndex.set(figure, {
      figura: figure, available: 0, flavors: new Map(), productIds: new Set(),
      imperfectTotal: 0, imperfectForShakes: 0, imperfectPending: 0,
      imperfectOtherDestination: 0, discarded: 0, imperfectBatches: [],
      especie: "", gramajeG: null,
    });
    const entry = figureIndex.get(figure);
    if (metadata.especie) entry.especie = String(metadata.especie);
    if (grams(metadata.gramajeG ?? metadata.gramaje) != null) entry.gramajeG = grams(metadata.gramajeG ?? metadata.gramaje);
    if (metadata.productId) entry.productIds.add(metadata.productId);
    return entry;
  }
  // Las siete figuras físicas canónicas siempre existen en la operación de MOMOS.
  // El catálogo del servidor aporta metadatos, pero el stock nunca decide si una
  // figura se muestra: Producción e Inventario terminado deben conservar incluso
  // las tarjetas en cero para que la comparación sea exacta y operable.
  const serverFigures = Array.isArray(db.figuras)
    ? db.figuras.filter((figure) => figure?.activo !== false && isKitchenFigureName(figure?.nombre))
    : [];
  const fallbackFigures = Array.isArray(db.settings?.figuras)
    ? db.settings.figuras.filter((figure) => isKitchenFigureName(figure?.nombre))
    : [];
  const catalogFigures = serverFigures.length ? serverFigures : fallbackFigures;
  const incompatibleCatalogFigures = catalogFigures.filter((figure) => {
    const registeredProductId = String(figure?.productId ?? figure?.product_id ?? "").trim();
    return Boolean(registeredProductId && registeredProductId !== expectedFigureProductId(figure.nombre));
  });
  const catalogByName = new Map(catalogFigures.map((figure) => [String(figure.nombre), figure]));
  KITCHEN_FIGURE_NAMES.forEach((figureName) => {
    const configured = catalogByName.get(figureName) || {};
    const defaults = KITCHEN_FIGURE_DEFAULTS[figureName] || {};
    ensureFigure(figureName, {
      ...configured,
      especie: configured.especie || defaults.species,
      gramajeG: configured.gramajeG ?? configured.gramaje ?? defaults.grams,
      productId: expectedFigureProductId(figureName),
    });
  });
  variants.forEach((variant) => {
    const figure = ensureFigure(variant.figura, { gramajeG: variant.gramajeG, productId: variant.productId });
    const flavorName = String(variant.sabor || "Sin sabor");
    const flavor = figure.flavors.get(flavorName) || {
      sabor: flavorName, available: 0, nextExpiration: "", gramajes: new Set(), products: new Set(),
    };
    const quantity = nonNegative(variant.disponibles);
    figure.available += quantity;
    figure.productIds.add(variant.productId);
    flavor.available += quantity;
    flavor.nextExpiration = earliestDate(flavor.nextExpiration, variant.vence);
    if (variant.gramajeG != null) flavor.gramajes.add(number(variant.gramajeG));
    if (variant.producto) flavor.products.add(variant.producto);
    figure.flavors.set(flavorName, flavor);
  });
  imperfects.forEach((batch) => {
    batch.figureOutcomes.forEach((outcome) => {
      if (!outcome.imperfectas && !outcome.descartadas) return;
      const figure = ensureFigure(outcome.figura);
      figure.imperfectTotal += outcome.imperfectas;
      figure.discarded += outcome.descartadas;
      if (batch.forShakes) figure.imperfectForShakes += outcome.imperfectas;
      else if (!batch.destinationRegistered) figure.imperfectPending += outcome.imperfectas;
      else figure.imperfectOtherDestination += outcome.imperfectas;
      figure.imperfectBatches.push({
        id: batch.id, fecha: batch.fecha, sabor: batch.sabor || "Sin sabor",
        imperfectas: outcome.imperfectas, descartadas: outcome.descartadas,
        destino: batch.destino, destinationRegistered: batch.destinationRegistered,
        forShakes: batch.forShakes,
      });
    });
  });
  const figureSummaries = Array.from(figureIndex.values()).map((figure) => ({
    ...figure,
    productIds: Array.from(figure.productIds),
    flavors: Array.from(figure.flavors.values()).map((flavor) => ({
      ...flavor, gramajes: Array.from(flavor.gramajes).sort((a, b) => a - b),
      products: Array.from(flavor.products),
    })).sort((a, b) => b.available - a.available || a.sabor.localeCompare(b.sabor)),
  })).sort((a, b) => b.available - a.available || b.imperfectForShakes - a.imperfectForShakes || a.figura.localeCompare(b.figura));

  const summary = {
    officialAvailable: finishedProducts.reduce((sum, product) => sum + product.officialAvailable, 0),
    available: finishedProducts.reduce((sum, product) => sum + product.available, 0),
    exactAvailable: variants.reduce((sum, variant) => sum + variant.disponibles, 0),
    withoutVariantDetail: finishedProducts.reduce((sum, product) => sum + product.withoutVariantDetail, 0),
    reserved: activeReservations.reduce((sum, reservation) => sum + reservation.cantidad, 0),
    inProcess: inProcess.reduce((sum, batch) => sum + number(batch.prod), 0),
    produced: physicalResults.produced,
    perfect: physicalResults.perfect,
    imperfectTotal: physicalResults.imperfect,
    imperfectPending: physicalResults.pendingImperfectUnits,
    imperfectReused: physicalResults.repurposedImperfectUnits,
    imperfectForShakes: imperfects.filter((batch) => batch.forShakes).reduce((sum, batch) => sum + batch.imperfectas, 0),
    discarded: physicalResults.discarded,
    grossWasteUnits: physicalResults.grossWasteUnits,
    grossWasteRate: physicalResults.grossWasteRate,
    definitiveLossUnits: physicalResults.definitiveLossUnits,
    definitiveLossRate: physicalResults.definitiveLossRate,
    inconsistentPhysicalBatches: physicalResults.inconsistentBatchCount,
    quarantined: quarantinedVariants.reduce((sum, variant) => sum + variant.disponibles, 0),
    reconciliationExcess,
    reconciliationBlocked,
    incompatibleVariantUnits: incompatibleVariants.reduce((sum, variant) => sum + variant.disponibles, 0),
    incompatibleVariantRows: incompatibleVariants.length,
    incompatibleCatalogFigures: incompatibleCatalogFigures.length,
    negativeStockProducts: products.filter((product) => product.invalidNegativeStock).length,
  };

  return {
    products: finishedProducts,
    variants,
    incompatibleVariants,
    incompatibleCatalogFigures,
    quarantinedVariants,
    reservations,
    reservationHistory,
    activeReservations,
    inProcess,
    imperfects,
    physicalResults,
    figureSummaries,
    summary,
  };
}
