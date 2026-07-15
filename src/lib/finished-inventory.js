const PROCESS_STATES = new Set(["En preparación", "Congelando", "Reservado"]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonNegative(value) {
  return Math.max(0, number(value));
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
    }));

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
    summary,
  };
}
