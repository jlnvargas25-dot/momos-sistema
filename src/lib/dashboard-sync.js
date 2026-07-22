const TOP_LEVEL_KEYS = [
  "contract", "version", "snapshotVersion", "serverTime", "businessDate", "summary",
  "assistantCenter", "notices", "brandAssistant", "inventoryAlerts", "customerSummary",
  "ordersByState", "salesByChannel", "productAvailability", "privacy",
];

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`El snapshot de Dashboard no contiene ${label}.`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(object(value, label)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`El contrato de ${label} no coincide con H77.`);
  }
}

function text(value, label, max = 180, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max) {
    throw new Error(`El campo ${label} es inválido.`);
  }
  return value;
}

function number(value, label, { integer = false, min = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || (integer && !Number.isInteger(parsed))) {
    throw new Error(`El campo ${label} es inválido.`);
  }
  return parsed;
}

function list(value, label, max) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`La colección ${label} es inválida.`);
  return value;
}

function nullableObject(value, label) {
  return value === null ? null : object(value, label);
}

function normalizeTask(row, index) {
  exactKeys(row, ["id", "area", "module", "ownerRoles", "entityId", "entityType", "severity", "blocks", "confidence", "confirmationRequired", "title", "detail", "nextAction", "reasons"], `tarea ${index + 1}`);
  const ownerRoles = list(row.ownerRoles, "responsables", 6).map((role, roleIndex) => text(role, `responsable ${roleIndex + 1}`, 60));
  const reasons = list(row.reasons, "razones", 5).map((reason, reasonIndex) => text(reason, `razón ${reasonIndex + 1}`, 180));
  if (!ownerRoles.length || !["critical", "high", "medium", "info"].includes(row.severity)
      || !["Alta", "Media", "Inicial"].includes(row.confidence)
      || typeof row.blocks !== "boolean" || typeof row.confirmationRequired !== "boolean") {
    throw new Error("Una tarea del Dashboard no cumple el contrato cerrado.");
  }
  return {
    id: text(row.id, "id de tarea", 100), area: text(row.area, "área", 40), module: text(row.module, "módulo", 50),
    ownerRoles, entityId: text(row.entityId, "entidad", 100, true), entityType: text(row.entityType, "tipo de entidad", 50, true),
    severity: row.severity, blocks: row.blocks, confidence: row.confidence, confirmationRequired: row.confirmationRequired,
    title: text(row.title, "título", 180), detail: text(row.detail, "detalle", 320), nextAction: text(row.nextAction, "siguiente acción", 240), reasons,
  };
}

export function normalizeDashboardSnapshot(payload) {
  exactKeys(payload, TOP_LEVEL_KEYS, "Dashboard");
  if (payload.contract !== "momos.dashboard-snapshot.v1" || payload.version !== 1) {
    throw new Error("MOMOS OPS recibió una versión de Dashboard no compatible.");
  }
  const snapshotVersion = text(payload.snapshotVersion, "versión", 30);
  if (!/^\d+$/.test(snapshotVersion) || snapshotVersion === "0") throw new Error("La versión del Dashboard es inválida.");
  text(payload.serverTime, "hora del servidor", 50);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(payload.businessDate, "fecha operativa", 10))) throw new Error("La fecha operativa es inválida.");

  exactKeys(payload.summary, ["salesToday", "ordersToday", "activeOrders", "pendingPayments", "pendingPaymentAmount", "openClaims"], "resumen");
  const summary = {
    salesToday: number(payload.summary.salesToday, "ventas"),
    ordersToday: number(payload.summary.ordersToday, "pedidos del día", { integer: true }),
    activeOrders: number(payload.summary.activeOrders, "pedidos activos", { integer: true }),
    pendingPayments: number(payload.summary.pendingPayments, "pagos pendientes", { integer: true }),
    pendingPaymentAmount: number(payload.summary.pendingPaymentAmount, "valor pendiente"),
    openClaims: number(payload.summary.openClaims, "reclamos", { integer: true }),
  };

  exactKeys(payload.assistantCenter, ["primary", "assistants", "tasks", "summary", "policy"], "centro de asistentes");
  const tasks = list(payload.assistantCenter.tasks, "tareas", 24).map(normalizeTask);
  const assistants = list(payload.assistantCenter.assistants, "asistentes", 8).map((row, index) => {
    exactKeys(row, ["id", "name", "module", "count", "status"], `asistente ${index + 1}`);
    if (!["Al día", "Atención", "Bloqueado"].includes(row.status)) throw new Error("Estado de asistente inválido.");
    return { id: text(row.id, "id de asistente", 50), name: text(row.name, "asistente", 80), module: text(row.module, "módulo", 50), count: number(row.count, "conteo", { integer: true }), status: row.status };
  });
  const primary = nullableObject(payload.assistantCenter.primary, "prioridad principal");
  if (primary) {
    exactKeys(primary, ["title", "detail", "ownerRoles", "nextAction"], "prioridad principal");
    primary.title = text(primary.title, "título principal", 180);
    primary.detail = text(primary.detail, "detalle principal", 320);
    primary.nextAction = text(primary.nextAction, "acción principal", 240);
    primary.ownerRoles = list(primary.ownerRoles, "responsables principales", 6).map((role) => text(role, "responsable", 60));
  }
  exactKeys(payload.assistantCenter.summary, ["health", "tasks", "critical", "blocking"], "resumen de asistentes");
  if (!["Al día", "Atención", "Bloqueado"].includes(payload.assistantCenter.summary.health)) throw new Error("Salud de asistentes inválida.");
  const assistantCenter = {
    primary, assistants, tasks, policy: text(payload.assistantCenter.policy, "política", 300),
    summary: {
      health: payload.assistantCenter.summary.health,
      tasks: number(payload.assistantCenter.summary.tasks, "prioridades", { integer: true }),
      critical: number(payload.assistantCenter.summary.critical, "críticas", { integer: true }),
      blocking: number(payload.assistantCenter.summary.blocking, "bloqueos", { integer: true }),
    },
  };

  exactKeys(payload.notices, ["productionSuggestions", "freezingReady", "publicationsToday", "creativeReviews", "campaignsWithoutOrders", "winner"], "avisos");
  const notices = {
    productionSuggestions: list(payload.notices.productionSuggestions, "sugerencias", 12).map((row, index) => {
      exactKeys(row, ["id", "quantity", "product"], `sugerencia ${index + 1}`);
      return { id: text(row.id, "sugerencia", 100), quantity: number(row.quantity, "cantidad"), product: text(row.product, "producto", 120) };
    }),
    freezingReady: list(payload.notices.freezingReady, "lotes listos", 12).map((row, index) => {
      exactKeys(row, ["id", "product", "grams", "flavor"], `lote listo ${index + 1}`);
      return { id: text(row.id, "lote", 100), product: text(row.product, "producto", 120), grams: row.grams === null ? null : number(row.grams, "gramaje"), flavor: text(row.flavor, "sabor", 100, true) };
    }),
    publicationsToday: list(payload.notices.publicationsToday, "publicaciones", 12).map((row, index) => {
      exactKeys(row, ["id", "time", "channel"], `publicación ${index + 1}`);
      return { id: text(row.id, "publicación", 100), time: text(row.time, "hora", 5), channel: text(row.channel, "canal", 40) };
    }),
    creativeReviews: list(payload.notices.creativeReviews, "creativos", 12).map((row, index) => {
      exactKeys(row, ["id", "label"], `creativo ${index + 1}`);
      return { id: text(row.id, "creativo", 100), label: text(row.label, "etiqueta creativa", 120) };
    }),
    campaignsWithoutOrders: list(payload.notices.campaignsWithoutOrders, "campañas", 12).map((row, index) => {
      exactKeys(row, ["id", "label"], `campaña ${index + 1}`);
      return { id: text(row.id, "campaña", 100), label: text(row.label, "etiqueta de campaña", 120) };
    }),
    winner: nullableObject(payload.notices.winner, "ganador"),
  };
  if (notices.winner) {
    exactKeys(notices.winner, ["campaignId", "roas", "creativeId"], "ganador");
    notices.winner = {
      campaignId: text(notices.winner.campaignId, "campaña ganadora", 100),
      roas: number(notices.winner.roas, "ROAS"),
      creativeId: notices.winner.creativeId === null ? null : text(notices.winner.creativeId, "creativo ganador", 100),
    };
  }

  exactKeys(payload.brandAssistant, ["ideaToday", "customerContact", "campaignReview", "contentRepeat", "benefitExpiring", "taskMissing"], "asistente de marca");
  exactKeys(payload.inventoryAlerts, ["lowStock", "expiringSoon"], "alertas de inventario");
  exactKeys(payload.customerSummary, ["new", "recurrent"], "resumen de clientes");
  exactKeys(payload.privacy, ["containsCustomerPii", "containsStaffPii", "containsFreeText", "containsStorageReferences", "containsSecrets", "externalExecution"], "privacidad");
  if (Object.values(payload.privacy).some(Boolean)) throw new Error("El Dashboard expuso datos fuera de su contrato de privacidad.");

  return {
    contract: payload.contract, version: 1, snapshotVersion, serverTime: payload.serverTime, businessDate: payload.businessDate,
    summary, assistantCenter, notices, brandAssistant: normalizeBrandAssistant(payload.brandAssistant),
    inventoryAlerts: {
      lowStock: list(payload.inventoryAlerts.lowStock, "stock bajo", 20).map((row, index) => {
        exactKeys(row, ["id", "name", "stock", "minimum", "unit"], `stock bajo ${index + 1}`);
        return { id: text(row.id, "insumo", 100), name: text(row.name, "insumo", 120), stock: number(row.stock, "stock"), minimum: number(row.minimum, "mínimo"), unit: text(row.unit, "unidad", 20) };
      }),
      expiringSoon: list(payload.inventoryAlerts.expiringSoon, "vencimientos", 20).map((row, index) => {
        exactKeys(row, ["id", "name", "expires"], `vencimiento ${index + 1}`);
        return { id: text(row.id, "insumo", 100), name: text(row.name, "insumo", 120), expires: text(row.expires, "vencimiento", 10) };
      }),
    },
    customerSummary: {
      new: number(payload.customerSummary.new, "clientes nuevos", { integer: true }),
      recurrent: number(payload.customerSummary.recurrent, "clientes recurrentes", { integer: true }),
    },
    ordersByState: list(payload.ordersByState, "pedidos por estado", 20).map((row, index) => {
      exactKeys(row, ["label", "value"], `estado ${index + 1}`);
      return { label: text(row.label, "estado", 50), value: number(row.value, "pedidos", { integer: true }) };
    }),
    salesByChannel: list(payload.salesByChannel, "ventas por canal", 10).map((row, index) => {
      exactKeys(row, ["label", "value"], `canal ${index + 1}`);
      return { label: text(row.label, "canal", 40), value: number(row.value, "ventas") };
    }),
    productAvailability: list(payload.productAvailability, "disponibilidad", 50).map((row, index) => {
      exactKeys(row, ["id", "name", "type", "available", "low"], `producto ${index + 1}`);
      if (typeof row.low !== "boolean" || !["momo", "combo"].includes(row.type)) throw new Error("Disponibilidad de producto inválida.");
      return { id: text(row.id, "producto", 100), name: text(row.name, "nombre de producto", 120), type: row.type, available: number(row.available, "disponibilidad", { integer: true }), low: row.low };
    }),
    privacy: { ...payload.privacy },
  };
}

function normalizeBrandAssistant(value) {
  const optional = (row, expected, label, build) => {
    if (row === null) return null;
    exactKeys(row, expected, label);
    return build(row);
  };
  return {
    ideaToday: optional(value.ideaToday, ["id", "label"], "idea", (row) => ({ id: text(row.id, "idea", 100), label: text(row.label, "idea", 120) })),
    customerContact: optional(value.customerContact, ["label", "reason"], "contacto", (row) => ({ label: text(row.label, "contacto", 120), reason: text(row.reason, "motivo", 160) })),
    campaignReview: optional(value.campaignReview, ["id", "label"], "campaña", (row) => ({ id: text(row.id, "campaña", 100), label: text(row.label, "campaña", 120) })),
    contentRepeat: optional(value.contentRepeat, ["id", "label"], "contenido", (row) => ({ id: text(row.id, "contenido", 100), label: text(row.label, "contenido", 120) })),
    benefitExpiring: optional(value.benefitExpiring, ["id", "label", "expires"], "beneficio", (row) => ({ id: text(row.id, "beneficio", 100), label: text(row.label, "beneficio", 120), expires: text(row.expires, "vencimiento", 10) })),
    taskMissing: optional(value.taskMissing, ["id", "label"], "tarea", (row) => ({ id: text(row.id, "tarea", 100), label: text(row.label, "tarea", 120) })),
  };
}
