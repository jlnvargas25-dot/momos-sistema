import { orderLinePresentation } from "./momos-domain-language.js";

const PACKING_EVIDENCE_OPEN = "Caja abierta";
const PACKING_EVIDENCE_SEALS = new Set(["Caja cerrada con sello", "Bolsa sellada"]);

export function buildPackingChecklistLines(orderId, orderItems = []) {
  return (orderItems || [])
    .filter((item) => item?.id && item.orderId === orderId)
    .map((item) => {
      const presentation = orderLinePresentation(item);
      return {
        id: item.id,
        parentItemId: item.parentItemId || "",
        label: presentation.quantityLabel,
        detail: presentation.secondary,
        domainKind: presentation.kind,
        exactVariant: presentation.exact,
      };
    });
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

const PACKED_OR_LATER = new Set(["Empacado", "Listo para despacho", "En ruta", "Entregado", "Reclamo"]);
const DISPATCHED_OR_LATER = new Set(["En ruta", "Entregado", "Reclamo"]);

export function buildPackingGuide({ orderStatus = "Listo para empaque", progress, handoff = null } = {}) {
  const safeProgress = progress || {
    verified: false,
    hasOpenPhoto: false,
    hasSealPhoto: false,
    readyToPack: false,
  };
  const packed = PACKED_OR_LATER.has(orderStatus);
  const handoffAccepted = handoff?.status === "Aceptado" || DISPATCHED_OR_LATER.has(orderStatus);
  const definitions = [
    { key: "receive", icon: "📥", title: "Recibir de Cocina", detail: "Tomá la etapa y ubicá la orden física en la mesa.", done: ["Listo para empaque", ...PACKED_OR_LATER].includes(orderStatus) },
    { key: "verify", icon: "✓", title: "Comparar la comanda", detail: "Revisá primero figura y sabor; después presentación comercial, salsa, relleno y cantidades.", done: safeProgress.verified },
    { key: "open-photo", icon: "📷", title: "Caja abierta", detail: "Fotografiá todo el contenido antes de cerrar.", done: safeProgress.hasOpenPhoto },
    { key: "seal-photo", icon: "🔒", title: "Cerrar y sellar", detail: "Cerrá, sellá y registrá la evidencia final.", done: safeProgress.hasSealPhoto },
    { key: "pack", icon: "🎁", title: "Confirmar Empacado", detail: "El sistema valida los tres controles antes de avanzar.", done: packed },
    { key: "handoff", icon: "🤝", title: "Relevo a Logística", detail: "Prepará etiqueta y dirección; entregá el paquete físicamente.", done: handoffAccepted },
  ];
  const currentIndex = definitions.findIndex((step) => !step.done);
  const steps = definitions.map((step, index) => ({
    ...step,
    status: step.done ? "done" : index === currentIndex ? "current" : "pending",
  }));
  const current = currentIndex >= 0 ? steps[currentIndex] : null;

  let nextAction = "Empaque completo y relevado a Logística.";
  if (current?.key === "receive") nextAction = "Tomá la etapa de Empaque y llevá la comanda física a tu mesa.";
  if (current?.key === "verify") nextAction = "Compará una por una las líneas físicas contra la orden y confirmá únicamente si todo coincide.";
  if (current?.key === "open-photo") nextAction = "Con todo verificado y visible, tomá la foto obligatoria de caja abierta.";
  if (current?.key === "seal-photo") nextAction = "Cerrá el empaque, aplicá el sello y tomá la foto obligatoria del cierre.";
  if (current?.key === "pack") nextAction = safeProgress.readyToPack
    ? "Los controles están completos: confirmá el pedido como Empacado."
    : "Completá verificación y evidencias antes de confirmar Empacado.";
  if (current?.key === "handoff") {
    if (orderStatus === "Empacado") nextAction = "Revisá la dirección, prepará la etiqueta y confirmá Listo para despacho.";
    else if (handoff?.status === "Ofrecido") nextAction = "El paquete ya fue ofrecido. Logística debe recibirlo físicamente y aceptar el relevo.";
    else nextAction = "Ofrecé el paquete a Logística; la ruta solo podrá iniciar después de su aceptación física.";
  }

  return {
    steps,
    current,
    nextAction,
    completed: steps.filter((step) => step.done).length,
    total: steps.length,
    complete: steps.every((step) => step.done),
  };
}
