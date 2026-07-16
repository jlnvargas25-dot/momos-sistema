import { hasAnyRole } from "./user-roles.js";

export const OPERATIONAL_STAGES = ["Cocina", "Empaque", "Logística"];

const STAGE_ROLES = {
  Cocina: new Set(["Administrador", "Cocina"]),
  Empaque: new Set(["Administrador", "Empaque"]),
  Logística: new Set(["Administrador", "Logística", "Mensajero"]),
};

export const STAGE_LINE_STATUSES = {
  Cocina: ["Pendiente", "En proceso", "Listo", "Incidente"],
  Empaque: ["Pendiente", "Incidente"], // Verificado solo nace del checklist exacto de Empaque.
  Logística: [],
};

export function operationalStageForOrder(order) {
  const state = order?.estado;
  if (["Pagado", "En producción"].includes(state)) return "Cocina";
  if (["Listo para empaque", "Empacado", "Listo para despacho"].includes(state)) return "Empaque";
  if (["En ruta"].includes(state)) return "Logística";
  return null;
}

export function canOperateStage(role, stage) {
  return Boolean(STAGE_ROLES[stage] && hasAnyRole(role, STAGE_ROLES[stage]));
}

export function activeStageAssignment(orderId, stage, assignments = []) {
  return (assignments || []).find((assignment) => assignment.orderId === orderId
    && assignment.stage === stage && assignment.status === "Activa") || null;
}

export function lineProgressFor(orderId, stage, orderItems = [], progress = []) {
  const rows = new Map((progress || [])
    .filter((row) => row.orderId === orderId && row.stage === stage)
    .map((row) => [row.orderItemId, row]));
  return (orderItems || []).filter((item) => item.orderId === orderId).map((item) => ({
    item,
    progress: rows.get(item.id) || { orderId, orderItemId: item.id, stage, status: "Pendiente" },
  }));
}

export function stageProgressSummary(orderId, stage, orderItems = [], progress = []) {
  const lines = lineProgressFor(orderId, stage, orderItems, progress);
  const terminal = stage === "Cocina" ? "Listo" : stage === "Empaque" ? "Verificado" : null;
  const incidents = lines.filter((line) => line.progress.status === "Incidente").length;
  const completed = terminal ? lines.filter((line) => line.progress.status === terminal).length : 0;
  return { lines, total: lines.length, completed, incidents, ready: Boolean(terminal && lines.length && completed === lines.length) };
}

export function openOrderIncidents(orderId, incidents = []) {
  return (incidents || []).filter((incident) => incident.orderId === orderId && incident.status === "Abierto");
}

export function dispatchHandoffFor(orderId, handoffs = []) {
  return (handoffs || []).find((handoff) => handoff.orderId === orderId) || null;
}
