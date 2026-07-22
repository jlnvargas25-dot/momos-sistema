function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonNegative(value) {
  return Math.max(0, finite(value));
}

function hasOwn(source, key) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
}

function datePart(value) {
  return String(value || "").slice(0, 10);
}

function inRange(value, from, to) {
  const date = datePart(value);
  return Boolean(date && (!from || date >= from) && (!to || date <= to));
}

function destinationKind(batch) {
  const destination = String(batch?.destino || "").trim();
  if (!destination || destination === "—") return "pending";
  if (/insumo|malteada|crepa|reutil|reaprove/i.test(destination)) return "repurposed";
  return "assigned-other";
}

function detailedCounts(batch) {
  const rows = Array.isArray(batch?.resultadosFiguras) ? batch.resultadosFiguras : [];
  if (!rows.length) return null;
  return rows.reduce((totals, row) => ({
    produced: totals.produced + nonNegative(row?.cant),
    perfect: totals.perfect + nonNegative(row?.perfectas),
    imperfect: totals.imperfect + nonNegative(row?.imperfectas),
    discarded: totals.discarded + nonNegative(row?.descartadas),
  }), { produced: 0, perfect: 0, imperfect: 0, discarded: 0 });
}

/**
 * Resultado físico oficial de un lote.
 *
 * `prod` es el total físico elaborado. Perfectas, imperfectas y descartadas
 * son una partición de ese total. La merma bruta es la salida no conforme
 * (imperfectas + descartadas); el descarte definitivo son solo descartadas.
 * Una imperfecta reaprovechada se conserva en merma bruta, pero nunca se
 * presenta como descarte definitivo.
 */
export function canonicalBatchPhysicalResult(batch = {}) {
  const detail = detailedCounts(batch);
  const hasOfficialCounts = ["perfectas", "imperfectas", "descartadas"]
    .some((key) => hasOwn(batch, key));
  const produced = nonNegative(hasOwn(batch, "prod") ? batch.prod : detail?.produced);
  const perfect = nonNegative(hasOfficialCounts ? batch.perfectas : detail?.perfect);
  const imperfect = nonNegative(hasOfficialCounts ? batch.imperfectas : detail?.imperfect);
  const discarded = nonNegative(hasOfficialCounts ? batch.descartadas : detail?.discarded);
  const classified = perfect + imperfect + discarded;
  const grossWasteUnits = imperfect + discarded;
  const disposition = destinationKind(batch);
  const invalidNegative = ["prod", "perfectas", "imperfectas", "descartadas"]
    .some((key) => hasOwn(batch, key) && finite(batch[key]) < 0);
  const detailMismatch = Boolean(detail && hasOfficialCounts && (
    detail.perfect !== perfect || detail.imperfect !== imperfect || detail.discarded !== discarded
  ));
  const planDetailMismatch = Boolean(detail && detail.produced > 0 && detail.produced !== produced);
  const overflow = Math.max(0, classified - produced);

  return {
    batchId: String(batch?.id || ""),
    date: datePart(batch?.fecha),
    productId: String(batch?.productId || ""),
    product: String(batch?.producto || ""),
    figure: String(batch?.figura || ""),
    flavor: String(batch?.sabor || ""),
    state: String(batch?.estado || ""),
    produced,
    perfect,
    imperfect,
    discarded,
    classified,
    pendingClassification: Math.max(0, produced - classified),
    overflow,
    grossWasteUnits,
    grossWasteRate: produced > 0 ? grossWasteUnits / produced : 0,
    perfectYieldRate: produced > 0 ? perfect / produced : 0,
    definitiveLossUnits: discarded,
    definitiveLossRate: produced > 0 ? discarded / produced : 0,
    repurposedImperfectUnits: disposition === "repurposed" ? imperfect : 0,
    assignedOtherImperfectUnits: disposition === "assigned-other" ? imperfect : 0,
    pendingImperfectUnits: disposition === "pending" ? imperfect : 0,
    imperfectDisposition: disposition,
    destination: String(batch?.destino || "").trim(),
    closed: produced > 0 && classified === produced,
    trustworthy: !invalidNegative && overflow === 0 && !detailMismatch && !planDetailMismatch,
    issues: [
      ...(invalidNegative ? ["negative-count"] : []),
      ...(overflow > 0 ? ["classified-over-produced"] : []),
      ...(detailMismatch ? ["figure-detail-mismatch"] : []),
      ...(planDetailMismatch ? ["figure-plan-mismatch"] : []),
    ],
  };
}

/**
 * Resumen canónico del periodo. Las tasas se calculan sobre los totales
 * físicos; nunca como promedio simple de porcentajes por lote.
 */
export function buildCanonicalPhysicalResults(batches = [], { from = "", to = "" } = {}) {
  const selected = (Array.isArray(batches) ? batches : [])
    .filter((batch) => (!from && !to) || inRange(batch?.fecha, from, to))
    .map(canonicalBatchPhysicalResult);
  const totals = selected.reduce((sum, batch) => ({
    produced: sum.produced + batch.produced,
    perfect: sum.perfect + batch.perfect,
    imperfect: sum.imperfect + batch.imperfect,
    discarded: sum.discarded + batch.discarded,
    classified: sum.classified + batch.classified,
    pendingClassification: sum.pendingClassification + batch.pendingClassification,
    overflow: sum.overflow + batch.overflow,
    grossWasteUnits: sum.grossWasteUnits + batch.grossWasteUnits,
    definitiveLossUnits: sum.definitiveLossUnits + batch.definitiveLossUnits,
    repurposedImperfectUnits: sum.repurposedImperfectUnits + batch.repurposedImperfectUnits,
    assignedOtherImperfectUnits: sum.assignedOtherImperfectUnits + batch.assignedOtherImperfectUnits,
    pendingImperfectUnits: sum.pendingImperfectUnits + batch.pendingImperfectUnits,
  }), {
    produced: 0, perfect: 0, imperfect: 0, discarded: 0, classified: 0,
    pendingClassification: 0, overflow: 0, grossWasteUnits: 0,
    definitiveLossUnits: 0, repurposedImperfectUnits: 0,
    assignedOtherImperfectUnits: 0, pendingImperfectUnits: 0,
  });
  return {
    ...totals,
    grossWasteRate: totals.produced > 0 ? totals.grossWasteUnits / totals.produced : 0,
    perfectYieldRate: totals.produced > 0 ? totals.perfect / totals.produced : 0,
    definitiveLossRate: totals.produced > 0 ? totals.definitiveLossUnits / totals.produced : 0,
    batches: selected,
    batchCount: selected.length,
    closedBatchCount: selected.filter((batch) => batch.closed).length,
    inconsistentBatchCount: selected.filter((batch) => !batch.trustworthy).length,
    trustworthy: selected.every((batch) => batch.trustworthy),
    range: { from, to },
  };
}
