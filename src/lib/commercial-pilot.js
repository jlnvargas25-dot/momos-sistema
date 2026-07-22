const PILOT_CONTRACTS = new Set([
  "momos.commercial-pilot.snapshot.v1",
  "momos.commercial-pilot.snapshot.v2",
]);

export const PILOT_SIGNOFFS = Object.freeze([
  { area: "Producto", evidenceCode: "SCOPE_APPROVED", label: "Producto y alcance" },
  { area: "Operaciones", evidenceCode: "ROLES_TRAINED", label: "Equipo y operación" },
  { area: "Finanzas", evidenceCode: "CLOSE_READY", label: "Cierre financiero" },
  { area: "Seguridad y Privacidad", evidenceCode: "PRIVACY_REVIEWED", label: "Privacidad y seguridad" },
]);

const TERMINAL = new Set(["Cerrado", "Abortado"]);
const ALLOWED_OUTCOMES = new Set(["En curso", "Entregado", "Cancelado", "Reclamo"]);
const FORBIDDEN_KEY = /(phone|telefono|direcci[oó]n|address|email|customer|cliente|nombre|note|nota|secret|token|api.?key|actor|evidence.?code)/i;

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Piloto comercial inválido: ${label}.`);
  return value;
}

function asArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Piloto comercial inválido: ${label}.`);
  return value;
}

function safeText(value, label, pattern = /^[\p{L}\p{N}_.:\- ]{1,100}$/u) {
  const text = String(value ?? "").trim();
  if (!pattern.test(text)) throw new Error(`Piloto comercial inválido: ${label}.`);
  return text;
}

function safeInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Piloto comercial inválido: ${label}.`);
  return number;
}

function rejectForbiddenKeys(value, path = "snapshot") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectForbiddenKeys(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, child]) => {
    const safePrivacyKey = ["containsCustomerPii", "containsSecrets", "containsFreeText", "actorPresent"].includes(key);
    if (!safePrivacyKey && FORBIDDEN_KEY.test(key)) throw new Error(`El piloto comercial expuso un campo privado en ${path}.`);
    rejectForbiddenKeys(child, `${path}.${key}`);
  });
}

function normalizeSignoffs(rows = []) {
  const byArea = new Map(asArray(rows, "firmas").map((row) => {
    const item = asObject(row, "firma");
    return [safeText(item.area, "área"), item.status === "Aprobado" ? "Aprobado" : "Pendiente"];
  }));
  return PILOT_SIGNOFFS.map((definition) => ({ ...definition, status: byArea.get(definition.area) || "Pendiente" }));
}

function normalizeOrders(rows = []) {
  return asArray(rows, "pedidos vinculados").map((row) => {
    const item = asObject(row, "pedido vinculado");
    const outcome = ALLOWED_OUTCOMES.has(item.outcome) ? item.outcome : "En curso";
    return {
      id: safeText(item.id, "pedido", /^[A-Za-z0-9_.:-]{1,80}$/),
      status: safeText(item.status, "estado"),
      outcome,
      reconciled: item.reconciled === true,
      linkedAt: String(item.linkedAt || ""),
      finalMargin: item.finalMargin == null ? null : Number(item.finalMargin),
    };
  });
}

function normalizePilot(raw, detailed) {
  const pilot = asObject(raw, "piloto");
  const plannedOrders = safeInteger(pilot.plannedOrders, "muestra", { min: 1, max: 20 });
  const linkedOrders = safeInteger(pilot.linkedOrders, "pedidos vinculados", { max: 20 });
  const reconciledOrders = safeInteger(pilot.reconciledOrders, "pedidos conciliados", { max: 20 });
  const approvedSignoffs = safeInteger(pilot.approvedSignoffs, "firmas", { max: 4 });
  if (linkedOrders > plannedOrders || reconciledOrders > linkedOrders) throw new Error("Piloto comercial inválido: los conteos no cierran.");
  const status = safeText(pilot.status, "estado");
  return {
    id: safeText(pilot.id, "id", /^[0-9a-f-]{36}$/i),
    key: safeText(pilot.key, "clave", /^[A-Za-z0-9_.:-]{8,80}$/),
    environment: pilot.environment === "Produccion" ? "Produccion" : "Staging",
    status,
    plannedOrders,
    maxOrderTotal: Number(pilot.maxOrderTotal || 0),
    linkedOrders,
    reconciledOrders,
    approvedSignoffs,
    startsAt: String(pilot.startsAt || ""),
    expiresAt: String(pilot.expiresAt || ""),
    version: safeInteger(pilot.version, "versión", { min: 1 }),
    terminal: TERMINAL.has(status),
    signoffs: detailed ? normalizeSignoffs(pilot.signoffs) : [],
    orders: detailed ? normalizeOrders(pilot.orders) : [],
  };
}

export function normalizeCommercialPilotSnapshot(payload) {
  const root = asObject(payload, "respuesta");
  if (!PILOT_CONTRACTS.has(root.contract)) throw new Error("El servidor no tiene un contrato compatible para el piloto comercial.");
  if (root.privacy?.containsCustomerPii !== false || root.privacy?.containsSecrets !== false || root.privacy?.containsFreeText !== false) {
    throw new Error("El piloto comercial no confirmó el cierre de privacidad.");
  }
  if (root.externalExecution !== false || root.authority?.publicTrafficOpened !== false) {
    throw new Error("El piloto comercial intentó abrir una ejecución externa.");
  }
  rejectForbiddenKeys(root);
  const detailed = root.contract.endsWith(".v2");
  const pilots = asArray(root.pilots, "pilotos").map((pilot) => normalizePilot(pilot, detailed));
  const eligibleOrders = detailed ? asArray(root.eligibleOrders, "pedidos disponibles").map((row) => {
    const item = asObject(row, "pedido disponible");
    return {
      id: safeText(item.id, "pedido", /^[A-Za-z0-9_.:-]{1,80}$/),
      status: safeText(item.status, "estado"),
      total: Number(item.total || 0),
      paidAt: String(item.paidAt || ""),
    };
  }) : [];
  return {
    contract: root.contract,
    detailed,
    capturedAt: String(root.capturedAt || ""),
    pilots,
    eligibleOrders,
    permissions: { ...(root.permissions || {}) },
    health: { ...(root.health || {}) },
  };
}

export function pilotNextStep(pilot) {
  if (!pilot) return "Preparar una muestra cerrada";
  if (pilot.status === "Borrador") return `Completar ${4 - pilot.approvedSignoffs} aprobación(es)`;
  if (pilot.status === "Listo") return "Iniciar cuando empiece la ventana autorizada";
  if (pilot.status === "En curso" && pilot.linkedOrders < pilot.plannedOrders) return `Vincular ${pilot.plannedOrders - pilot.linkedOrders} pedido(s) pagado(s)`;
  if (pilot.status === "En curso" && pilot.reconciledOrders < pilot.linkedOrders) return `Conciliar ${pilot.linkedOrders - pilot.reconciledOrders} pedido(s)`;
  if (pilot.status === "En curso") return "Cerrar y sellar el acta";
  if (pilot.status === "Cerrado") return "Piloto cerrado y conciliado";
  return "Piloto abortado; los pedidos conservaron su estado";
}

export function eligibleOrdersForPilot(snapshot, pilot) {
  if (!pilot || pilot.status !== "En curso") return [];
  const linked = new Set(pilot.orders.map((order) => order.id));
  return (snapshot?.eligibleOrders || []).filter((order) => !linked.has(order.id) && order.total > 0 && order.total <= pilot.maxOrderTotal);
}

export function defaultCommercialPilotDraft(now = new Date()) {
  const start = new Date(now.getTime() + 5 * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  const local = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return {
    environment: "Staging",
    plannedOrders: 5,
    maxOrderTotal: 150000,
    startsAt: local(start),
    expiresAt: local(end),
  };
}
