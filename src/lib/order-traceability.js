const FLOW = ["Nuevo", "Confirmado", "Pendiente de pago", "Pagado", "En producción", "Listo para empaque", "Empacado", "Listo para despacho", "En ruta", "Entregado"];

export function orderCurrentArea(order) {
  const state = order?.estado;
  if (["Nuevo", "Confirmado", "Pendiente de pago"].includes(state)) return "Recepción / Caja";
  if (["Pagado", "En producción"].includes(state)) return "Cocina";
  if (["Listo para empaque", "Empacado"].includes(state)) return "Empaque";
  if (state === "Listo para despacho") return "Relevo Empaque → Logística";
  if (state === "En ruta") return "Logística";
  if (state === "Entregado") return "Cerrado · entregado";
  if (state === "Cancelado") return "Cerrado · cancelado";
  if (state === "Reclamo") return "Servicio / Reclamos";
  return "Sin ubicación";
}

export function orderNextOperationalAction(order, context = {}) {
  const state = order?.estado;
  const openIncidents = context.openIncidents || [];
  if (openIncidents.length) return `Resolver ${openIncidents.length} novedad${openIncidents.length === 1 ? "" : "es"} abierta${openIncidents.length === 1 ? "" : "s"}`;
  const next = {
    Nuevo: "Confirmar los datos del pedido",
    Confirmado: "Solicitar o validar el pago",
    "Pendiente de pago": "Caja debe confirmar el pago con comprobante",
    Pagado: "Cocina debe tomar e iniciar la comanda",
    "En producción": "Cocina debe completar todas las líneas",
    "Listo para empaque": "Empaque debe verificar orden y tomar 3 evidencias",
    Empacado: "Confirmar que está listo para despacho",
    "Listo para despacho": context.handoff?.status === "Aceptado" ? "Logística puede iniciar la ruta" : context.handoff?.status === "Ofrecido" ? "Logística debe aceptar el paquete" : "Empaque debe ofrecer el paquete a Logística",
    "En ruta": "Logística debe confirmar la entrega",
    Entregado: "Pedido finalizado",
    Cancelado: "Pedido cancelado",
    Reclamo: "Resolver el reclamo y documentar la decisión",
  };
  return next[state] || "Revisar el pedido";
}

export function orderFlowProgress(order) {
  if (order?.estado === "Cancelado") return { index: -1, total: FLOW.length, percent: 0, terminal: true };
  if (order?.estado === "Reclamo") return { index: FLOW.indexOf("Entregado"), total: FLOW.length, percent: 100, terminal: false };
  const index = Math.max(0, FLOW.indexOf(order?.estado));
  return { index, total: FLOW.length, percent: Math.round((index / (FLOW.length - 1)) * 100), terminal: order?.estado === "Entregado" };
}

const clean = (value) => String(value || "").trim();
const eventTime = (date, time = "") => [clean(date), clean(time)].filter(Boolean).join(" ");

export function buildOrderTraceability(db, order) {
  if (!order?.id) return null;
  const orderId = order.id;
  const items = (db.order_items || []).filter((row) => row.orderId === orderId);
  const evidences = (db.evidences || []).filter((row) => row.orderId === orderId);
  const reservations = (db.inventory_reservations || []).filter((row) => row.orderId === orderId);
  const incidents = (db.order_incidents || []).filter((row) => row.orderId === orderId);
  const assignments = (db.order_stage_assignments || []).filter((row) => row.orderId === orderId);
  const progress = (db.order_line_progress || []).filter((row) => row.orderId === orderId);
  const packing = (db.packing_verifications || []).find((row) => row.orderId === orderId) || null;
  const delivery = (db.deliveries || []).find((row) => row.orderId === orderId) || null;
  const handoff = (db.order_dispatch_handoffs || []).find((row) => row.orderId === orderId) || null;
  const claim = (db.claims || []).find((row) => row.orderId === orderId && row.estado !== "Cancelado") || null;
  const audits = (db.audit_logs || []).filter((row) => row.entidadId === orderId);
  const events = [];
  const add = (event) => events.push({ actor: "", detail: "", area: "Pedido", ...event });

  add({ id: `created-${orderId}`, at: eventTime(order.fecha, order.hora), type: "created", title: "Pedido recibido", detail: `${order.canal || "Canal no indicado"} · ${items.length} línea${items.length === 1 ? "" : "s"}` });
  audits.forEach((row) => add({ id: `audit-${row.id}`, at: row.fecha, type: "audit", title: row.accion, detail: [row.de, row.a].filter(Boolean).join(" → "), actor: row.user }));
  evidences.forEach((row) => add({ id: `evidence-${row.id}`, at: eventTime(row.fecha, row.hora), type: "evidence", title: `Evidencia: ${row.tipo}`, actor: row.user, area: row.tipo === "Comprobante de pago" ? "Caja" : "Empaque" }));
  assignments.forEach((row) => add({ id: `assignment-${row.id}`, at: row.claimedAt, type: "assignment", title: `${row.stage} tomó la etapa`, detail: row.status === "Liberada" ? `Liberada ${row.releasedAt || ""} · ${row.releaseReason || "sin motivo"}` : "Responsable activo", actor: row.user, area: row.stage }));
  incidents.forEach((row) => add({ id: `incident-${row.id}`, at: row.createdAt, type: "incident", title: `${row.type} · ${row.status}`, detail: row.description, actor: row.createdByName, area: row.area }));
  if (packing) add({ id: `packing-${orderId}`, at: packing.verifiedAt, type: "packing", title: "Comanda verificada contra la orden", detail: `${packing.lineIds.length} línea${packing.lineIds.length === 1 ? "" : "s"} confirmadas`, actor: packing.user, area: "Empaque" });
  if (delivery?.hSolicitud) add({ id: `delivery-${delivery.id}`, at: eventTime(order.fecha, delivery.hSolicitud), type: "delivery", title: `Domicilio ${delivery.estado}`, detail: `${delivery.proveedor} · ${delivery.codigo || "sin código"}`, area: "Logística" });
  if (handoff) {
    add({ id: `handoff-offer-${orderId}`, at: handoff.offeredAt, type: "handoff", title: "Paquete ofrecido a Logística", actor: handoff.packingUser, area: "Empaque" });
    if (handoff.acceptedAt) add({ id: `handoff-accept-${orderId}`, at: handoff.acceptedAt, type: "handoff", title: "Relevo físico aceptado", actor: handoff.logisticsUser, area: "Logística" });
  }
  if (claim) add({ id: `claim-${claim.id}`, at: claim.reclamoEn || claim.fecha, type: "claim", title: `Reclamo ${claim.estado}`, detail: claim.desc, actor: claim.resp, area: "Servicio" });
  reservations.slice(0, 20).forEach((row) => add({ id: `reservation-${row.id}`, at: row.fecha, type: "inventory", title: `${row.estado === "Activa" ? "Reserva" : row.estado}: ${row.nombre}`, detail: `${row.cantidad} unidad${Number(row.cantidad) === 1 ? "" : "es"}${row.batchId ? ` · lote ${row.batchId}` : ""}`, area: row.tipo === "producto" ? "Inventario terminado" : "Inventario" }));

  events.sort((a, b) => clean(b.at).localeCompare(clean(a.at)) || clean(b.id).localeCompare(clean(a.id)));
  const openIncidents = incidents.filter((row) => row.status === "Abierto");
  const activeAssignments = assignments.filter((row) => row.status === "Activa");
  return {
    order, items, evidences, reservations, incidents, openIncidents, activeAssignments,
    progress, packing, delivery, handoff, claim, events,
    area: orderCurrentArea(order),
    nextAction: orderNextOperationalAction(order, { openIncidents, handoff }),
    flow: orderFlowProgress(order),
  };
}

export function traceabilityHealth(trace) {
  if (!trace) return "unknown";
  if (trace.openIncidents.length) return "blocked";
  if (["Cancelado", "Reclamo"].includes(trace.order.estado)) return "attention";
  if (trace.order.estado === "Entregado") return "complete";
  return "active";
}

export { FLOW as ORDER_TRACE_FLOW };
