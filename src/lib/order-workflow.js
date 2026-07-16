import { hasAnyRole, normalizeRoles } from "./user-roles.js";

export const ORDER_WORKFLOW_ROLES = [
  "Administrador",
  "Cajero",
  "Coordinador de pedidos",
  "Cocina",
  "Empaque",
  "Logística",
  "Marketing/CRM",
  "Mensajero",
];

export const ORDER_ROLE_SUMMARY = {
  Administrador: "crea y agenda pedidos, confirma pagos y puede operar Cocina, Empaque y Logística como respaldo",
  Cajero: "crea y agenda pedidos, recibe comprobantes y confirma pagos",
  "Coordinador de pedidos": "crea, agenda y coordina pedidos; confirma pagos y cancelaciones",
  Cocina: "inicia la preparación y confirma cuándo el pedido queda Listo para empaque",
  Empaque: "puede agendar pedidos y confirma Empacado y Listo para despacho",
  Logística: "confirma salida a ruta y entrega",
  "Marketing/CRM": "consulta pedidos y gestiona reclamos autorizados",
  Mensajero: "confirma salida a ruta y entrega",
};

const ORDER_INTAKE_ROLES = new Set(["Administrador", "Cajero", "Coordinador de pedidos", "Empaque"]);
const PAYMENT_ROLES = new Set(["Administrador", "Cajero", "Coordinador de pedidos"]);
const DELIVERY_ROLES = new Set(["Administrador", "Logística", "Mensajero"]);
const CLAIM_ROLES = new Set(["Administrador", "Coordinador de pedidos", "Empaque", "Logística", "Marketing/CRM"]);
const DELIVERY_HANDOFF_ROLES = new Set(["Administrador", "Empaque", "Logística"]);

export function canCreateOrder(role) {
  return hasAnyRole(role, ORDER_INTAKE_ROLES);
}

export function canManageDeliveryHandoff(role) {
  return hasAnyRole(role, DELIVERY_HANDOFF_ROLES);
}

export function deliveryBlocksNewRequest(delivery) {
  return Boolean(delivery && ["Por solicitar", "Solicitado", "Asignado", "En ruta", "Entregado"].includes(delivery.estado));
}

export function orderEvidencePermission(role, evidenceType) {
  const normalizedRoles = normalizeRoles(role);
  const type = String(evidenceType || "").trim();
  let roles = new Set();
  let ownerLabel = "un área autorizada";
  if (type === "Comprobante de pago") {
    roles = PAYMENT_ROLES;
    ownerLabel = "Caja / Coordinación de pedidos";
  } else if (["Pedido armado", "Caja abierta", "Caja cerrada con sello", "Bolsa sellada"].includes(type)) {
    roles = new Set(["Administrador", "Empaque"]);
    ownerLabel = "Administrador / Empaque";
  } else if (type === "Entrega") {
    roles = new Set([...PAYMENT_ROLES, ...DELIVERY_ROLES]);
    ownerLabel = "Administrador, Caja, Coordinación o Logística";
  }
  const allowed = hasAnyRole(normalizedRoles, roles);
  return {
    allowed,
    ownerLabel,
    reason: allowed ? `${ownerLabel} puede registrar esta evidencia.` : `Solo ${ownerLabel} puede registrar “${type || "esta evidencia"}”.`,
  };
}

function transitionOwner(from, to, quickSale) {
  if (to === "Nuevo" || to === "Confirmado" || to === "Pendiente de pago") return { roles: ORDER_INTAKE_ROLES, label: "Recepción / Coordinación de pedidos" };
  if (to === "Pagado") return { roles: PAYMENT_ROLES, label: "Caja / Coordinación de pedidos" };
  if (to === "En producción" || to === "Listo para empaque") return { roles: new Set(["Administrador", "Cocina"]), label: "Administrador / Cocina" };
  if (to === "Empacado" || to === "Listo para despacho") return { roles: new Set(["Administrador", "Empaque"]), label: "Administrador / Empaque" };
  if (to === "En ruta") return { roles: DELIVERY_ROLES, label: "Administrador / Logística / Mensajero" };
  if (to === "Entregado" && quickSale) return from === "Pagado"
    ? { roles: new Set([...PAYMENT_ROLES, ...DELIVERY_ROLES]), label: "Caja, Coordinación o Logística" }
    : { roles: new Set(), label: "Venta inmediata únicamente desde un pedido Pagado" };
  if (to === "Entregado") return { roles: DELIVERY_ROLES, label: "Administrador / Logística / Mensajero" };
  if (to === "Cancelado") return { roles: PAYMENT_ROLES, label: "Administrador, Caja o Coordinación de pedidos" };
  if (to === "Reclamo") return { roles: CLAIM_ROLES, label: "Coordinación / área de reclamos" };
  return { roles: new Set(), label: "un área autorizada" };
}

export function orderTransitionPermission(role, from, to, options = {}) {
  const normalizedRoles = normalizeRoles(role);
  const quickSale = Boolean(options.quickSale);
  if (from && from === to) {
    const allowed = hasAnyRole(normalizedRoles, ORDER_WORKFLOW_ROLES);
    return { allowed, ownerLabel: "el equipo de MOMOS", reason: allowed ? "El pedido ya está en ese estado." : "No hay un rol operativo activo." };
  }
  const owner = transitionOwner(from, to, quickSale);
  const allowed = hasAnyRole(normalizedRoles, owner.roles);
  return {
    allowed,
    ownerLabel: owner.label,
    reason: allowed
      ? `${owner.label} puede confirmar este paso.`
      : `Solo ${owner.label} puede confirmar el paso a “${to}”. Tus roles actuales son ${normalizedRoles.join(" + ") || "sin rol"}.`,
  };
}

const ORDER_INTAKE_STATES = new Set(["Nuevo", "Confirmado", "Pendiente de pago"]);

// Una sola decisión visible para Recepción/Caja. El estado Confirmado se conserva
// por compatibilidad e historial, pero deja de ser un clic obligatorio del camino feliz.
export function orderIntakePrimaryAction(role, order, options = {}) {
  if (!order || !ORDER_INTAKE_STATES.has(order.estado)) return null;
  const hasPaymentEvidence = Boolean(options.hasPaymentEvidence);
  const paidInPlatform = String(order.canal || "").trim() === "Rappi" || String(order.pago || "").toLowerCase().includes("rappi");
  const paymentReady = paidInPlatform || hasPaymentEvidence;

  if (paymentReady) {
    const permission = orderTransitionPermission(role, order.estado, "Pagado");
    return {
      type: permission.allowed ? "transition" : "wait",
      target: "Pagado",
      label: permission.allowed ? "Confirmar pago · enviar a Cocina" : "Pago listo · requiere Caja",
      detail: paidInPlatform
        ? "Rappi confirma el pago en su plataforma; Caja registra el relevo a la operación."
        : "El comprobante ya está vinculado. Caja verifica valor, referencia y cuenta antes de confirmar.",
      ...permission,
    };
  }

  if (order.estado === "Nuevo" || order.estado === "Confirmado") {
    const permission = orderTransitionPermission(role, order.estado, "Pendiente de pago");
    return {
      type: permission.allowed ? "transition" : "wait",
      target: "Pendiente de pago",
      label: permission.allowed ? "Pedido revisado · solicitar pago" : "Pedido pendiente de Recepción",
      detail: "Revisa cliente, productos, entrega y total. Después solo quedará recibir y verificar el pago.",
      ...permission,
    };
  }

  const permission = orderEvidencePermission(role, "Comprobante de pago");
  return {
    type: permission.allowed ? "evidence" : "wait",
    target: "Pagado",
    autoAdvance: permission.allowed,
    label: permission.allowed ? "Tomar comprobante y confirmar pago" : "Esperando comprobante y verificación",
    detail: permission.allowed
      ? "La foto se vincula al pedido y, si el servidor la valida, el pedido pasa a Cocina en el mismo flujo."
      : "Caja o Coordinación debe registrar el soporte y confirmar el pago.",
    ...permission,
  };
}
