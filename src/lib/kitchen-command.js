export const KITCHEN_ISSUE_GUIDANCE = {
  Faltante: "Pausá esa línea y revisá el stock exacto. No cambies figura, sabor o relleno sin autorización.",
  Sustitución: "Confirmá la alternativa con Coordinación o con el cliente antes de reemplazar cualquier componente.",
  "Preparación equivocada": "Separá lo incorrecto, registrá la línea afectada y prepará nuevamente lo que dice la orden.",
  Rehacer: "Marcá la pieza o preparación que debe repetirse y mantené la comanda en Cocina hasta corregirla.",
  Otro: "Describí qué ocurrió y qué necesitás para continuar. La comanda quedará bloqueada hasta resolverlo.",
};

export function kitchenQuickCommandState({ orderStatus, lineCount = 0, incidentCount = 0 } = {}) {
  const hasLines = Number(lineCount) > 0;
  if (orderStatus === "Pagado") {
    return {
      action: "start",
      label: "Tomar e iniciar comanda",
      disabled: !hasLines,
      blockReason: hasLines ? "" : "La orden no tiene líneas para preparar.",
    };
  }
  if (orderStatus === "En producción") {
    const hasIncidents = Number(incidentCount) > 0;
    return {
      action: "ready",
      label: "Terminé · enviar a Empaque",
      disabled: !hasLines || hasIncidents,
      blockReason: !hasLines
        ? "La orden no tiene líneas para preparar."
        : hasIncidents
          ? "Resolvé la novedad abierta antes de enviar la comanda a Empaque."
          : "",
    };
  }
  return { action: null, label: "", disabled: true, blockReason: "La comanda no está en una etapa operable por Cocina." };
}
