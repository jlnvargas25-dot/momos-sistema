const PROCESS_STATES = new Set(["En preparación", "Congelando", "Reservado"]);

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
  return new Date().toISOString().slice(0, 10);
}

function expired(date, today) {
  return Boolean(date && String(date).slice(0, 10) < today);
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
    figura: String(row.figura || "Sin figura verificable"),
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

  const planned = Array.isArray(batch?.figuras) ? batch.figuras.filter((row) => number(row.cant) > 0) : [];
  const onlyFigure = String(batch?.figura || (planned.length === 1 ? planned[0].figura : "") || "Sin figura verificable");
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
    .filter((product) => product.tipo === "momo" && (product.activo !== false || number(product.stock) > 0))
    .map((product) => ({
      ...product,
      officialAvailable: nonNegative(product.stock),
      invalidNegativeStock: number(product.stock) < 0,
    }));

  const productIds = new Set(baseProducts.map((product) => product.id));
  const reportedVariants = [...(db.variantes || []), ...(db.variantesCuarentena || [])]
    .filter((variant) => productIds.has(variant.productId) && number(variant.disponibles) > 0)
    .map((variant) => ({ ...variant, disponibles: nonNegative(variant.disponibles) }));
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
    .map((batch) => ({
      ...batch,
      imperfectas: number(batch.imperfectas),
      descartadas: number(batch.descartadas),
      destinationRegistered: hasImperfectDestination(batch),
      forShakes: isShakeDestination(batch),
      figureOutcomes: figureOutcomeRows(batch),
    }));

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
  // El catálogo define qué figuras existen; el stock solo completa sus cifras.
  // Así una figura activa nunca desaparece de Inventario terminado por estar en cero.
  const serverFigures = Array.isArray(db.figuras) ? db.figuras.filter((figure) => figure?.activo !== false) : [];
  const fallbackFigures = Array.isArray(db.settings?.figuras) ? db.settings.figuras : [];
  (serverFigures.length ? serverFigures : fallbackFigures).forEach((figure) => ensureFigure(figure.nombre, figure));
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
    imperfectTotal: imperfects.reduce((sum, batch) => sum + batch.imperfectas, 0),
    imperfectPending: imperfects.filter((batch) => !batch.destinationRegistered).reduce((sum, batch) => sum + batch.imperfectas, 0),
    imperfectReused: imperfects.filter((batch) => batch.destinationRegistered).reduce((sum, batch) => sum + batch.imperfectas, 0),
    imperfectForShakes: imperfects.filter((batch) => batch.forShakes).reduce((sum, batch) => sum + batch.imperfectas, 0),
    discarded: imperfects.reduce((sum, batch) => sum + batch.descartadas, 0),
    quarantined: quarantinedVariants.reduce((sum, variant) => sum + variant.disponibles, 0),
    reconciliationExcess,
    reconciliationBlocked,
    negativeStockProducts: products.filter((product) => product.invalidNegativeStock).length,
  };

  return {
    products: finishedProducts,
    variants,
    quarantinedVariants,
    reservations,
    reservationHistory,
    activeReservations,
    inProcess,
    imperfects,
    figureSummaries,
    summary,
  };
}
