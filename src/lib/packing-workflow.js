const PACKING_EVIDENCE_OPEN = "Caja abierta";
const PACKING_EVIDENCE_SEALS = new Set(["Caja cerrada con sello", "Bolsa sellada"]);

export function buildPackingChecklistLines(orderId, orderItems = []) {
  return (orderItems || [])
    .filter((item) => item?.id && item.orderId === orderId)
    .map((item) => ({
      id: item.id,
      parentItemId: item.parentItemId || "",
      label: `${Number(item.cant || 0)}× ${item.nombre || "Producto"}`,
      detail: [
        item.figura && `Figura ${item.figura}`,
        item.sabor && `Sabor ${item.sabor}`,
        item.salsa && `Salsa ${item.salsa}`,
        item.relleno && `Relleno ${item.relleno}`,
        ...(item.adiciones || []).map((addition) => `Adición ${addition.nombre}${Number(addition.cant || 1) > 1 ? ` ×${addition.cant}` : ""}`),
      ].filter(Boolean).join(" · "),
    }));
}

export function findPackingVerification(orderId, verifications = []) {
  return (verifications || []).find((verification) => verification?.orderId === orderId) || null;
}

export function packingVerificationMatchesLines(verification, lines = []) {
  if (!verification || !Array.isArray(verification.lineIds) || !lines.length) return false;
  const expected = lines.map((line) => line.id).sort();
  const received = [...new Set(verification.lineIds.filter(Boolean))].sort();
  return verification.lineIds.length === received.length
    && expected.length === received.length
    && expected.every((id, index) => id === received[index]);
}

export function packingStationProgress({ orderId, orderItems = [], evidences = [], verifications = [] }) {
  const lines = buildPackingChecklistLines(orderId, orderItems);
  const verification = findPackingVerification(orderId, verifications);
  const verified = packingVerificationMatchesLines(verification, lines);
  const orderEvidence = (evidences || []).filter((evidence) => evidence?.orderId === orderId);
  const hasOpenPhoto = orderEvidence.some((evidence) => evidence.tipo === PACKING_EVIDENCE_OPEN);
  const hasSealPhoto = orderEvidence.some((evidence) => PACKING_EVIDENCE_SEALS.has(evidence.tipo));
  return {
    lines,
    verification,
    verified,
    hasOpenPhoto,
    hasSealPhoto,
    completedSteps: Number(verified) + Number(hasOpenPhoto) + Number(hasSealPhoto),
    readyToPack: Boolean(verified && hasOpenPhoto && hasSealPhoto),
  };
}
