const CLOSED_SALE_STATES = new Set(["Entregado", "Reclamo"]);
const LOST_STATES = new Set(["Cancelado"]);

function asDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from, to) {
  const a = asDate(from); const b = asDate(to);
  if (!a || !b) return null;
  return Math.floor((b - a) / 86400000);
}

function itemTotal(item) {
  const additions = (item.adiciones || []).reduce((sum, addition) => sum + Number(addition.precio || 0) * Number(addition.cant || 1), 0);
  return Number(item.precio || 0) * Number(item.cant || 0) + additions;
}

export function customerOrderTotal(db, order) {
  const subtotal = (db.order_items || []).filter((item) => item.orderId === order.id && !item.esSubMomo)
    .reduce((sum, item) => sum + itemTotal(item), 0);
  return Math.max(0, subtotal - Number(order.descuento || 0) + Number(order.domCobrado || 0));
}

export function buildCustomerCrm(db, customerId, today = new Date().toISOString().slice(0, 10)) {
  const customer = (db.customers || []).find((row) => row.id === customerId) || {};
  const profile = (db.customer_crm_profiles || []).find((row) => row.customerId === customerId) || {};
  const orders = (db.orders || []).filter((order) => order.customerId === customerId)
    .map((order) => ({
      ...order,
      totalCrm: customerOrderTotal(db, order),
      itemsCrm: (db.order_items || []).filter((item) => item.orderId === order.id && !item.esCaja),
    }))
    .sort((a, b) => `${b.fecha || ""} ${b.hora || ""}`.localeCompare(`${a.fecha || ""} ${a.hora || ""}`));
  const completed = orders.filter((order) => CLOSED_SALE_STATES.has(order.estado));
  const liveOrders = orders.filter((order) => !CLOSED_SALE_STATES.has(order.estado) && !LOST_STATES.has(order.estado));
  const purchases = completed.length || Number(customer.pedidos || 0);
  const spend = completed.length ? completed.reduce((sum, order) => sum + order.totalCrm, 0) : Number(customer.total || 0);
  const lastPurchase = completed[0]?.fecha || customer.ultima || "";
  const firstPurchase = completed.at(-1)?.fecha || customer.primera || "";
  const recencyDays = lastPurchase ? daysBetween(lastPurchase, today) : null;

  const preferences = new Map();
  completed.forEach((order) => order.itemsCrm.forEach((item) => {
    const key = [item.nombre, item.figura, item.sabor].filter(Boolean).join(" · ") || "Producto sin detalle";
    preferences.set(key, (preferences.get(key) || 0) + Number(item.cant || 0));
  }));
  const automaticFavorites = [...preferences.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([label, quantity]) => ({ label, quantity }));

  const activeBenefits = (db.benefits || []).filter((benefit) => benefit.customerId === customerId && benefit.estado === "Activo" && (!benefit.vence || benefit.vence >= today));
  const contacts = (db.customer_contacts || []).filter((contact) => contact.customerId === customerId)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const activations = (db.customer_activations || []).filter((activation) => activation.customerId === customerId)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  let nextAction;
  if (profile.contactAllowed === false) nextAction = { type: "blocked", label: "No contactar", detail: profile.contactReason || "El cliente no autorizó mensajes comerciales." };
  else if (liveOrders.length) nextAction = { type: "service", label: `Acompañar ${liveOrders[0].id}`, detail: `El pedido está ${liveOrders[0].estado}. Prioriza el servicio antes de vender de nuevo.` };
  else if (!purchases) nextAction = { type: "lead", label: "Convertir primer pedido", detail: "Es un lead sin compra. Preséntale los productos más fáciles de elegir." };
  else if (activeBenefits.some((benefit) => benefit.vence && daysBetween(today, benefit.vence) <= 3)) nextAction = { type: "benefit", label: "Recordar beneficio", detail: "Tiene un beneficio activo próximo a vencer." };
  else if (recencyDays != null && recencyDays >= 30) nextAction = { type: "reactivation", label: "Reactivar con mensaje personal", detail: `Lleva ${recencyDays} días sin comprar. Usa su favorito real, no una promoción genérica.` };
  else if (purchases >= 5) nextAction = { type: "loyalty", label: "Cuidar cliente VIP", detail: "Agradece su recurrencia y anticipa novedades afines a sus gustos." };
  else nextAction = { type: "followup", label: "Seguimiento de recompra", detail: recencyDays == null ? "Completa la información del cliente." : `Compró hace ${recencyDays} días; valida cómo le fue antes de ofrecer otra compra.` };

  return {
    customer, profile, orders, completed, liveOrders, purchases, spend,
    averageTicket: purchases ? Math.round(spend / purchases) : 0,
    firstPurchase, lastPurchase, recencyDays, automaticFavorites,
    activeBenefits, contacts, activations, nextAction,
  };
}

export function crmCompleteness(crm) {
  const fields = [crm.customer.nombre, crm.customer.telefono, crm.customer.barrio, crm.customer.direccion, crm.customer.canal];
  const completed = fields.filter(Boolean).length + (crm.profile.contactAllowed !== undefined ? 1 : 0) + (crm.profile.acquisitionSource ? 1 : 0);
  return Math.round((completed / 7) * 100);
}
