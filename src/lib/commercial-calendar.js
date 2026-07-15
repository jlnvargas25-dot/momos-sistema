import { agencyProductStock } from "./agency-intelligence.js";

const ACTIVE_STATES = new Set(["Pendiente", "Programado"]);
const HISTORY_STATES = new Set(["Publicado", "No publicado"]);
const APPROVED_CREATIVE_STATES = new Set(["Aprobado", "Publicado", "Ganador"]);
const CHANNEL_SLOTS = {
  Instagram: ["12:00", "18:30"], Facebook: ["13:00"], TikTok: ["19:00"],
  WhatsApp: ["11:00", "16:00"], Rappi: ["11:30"], Referidos: ["10:00"],
  Influencer: ["18:00"], "Orgánico": ["17:30"],
};

const text = (value) => String(value || "").trim();
const iso = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value).slice(0, 10)) ? text(value).slice(0, 10) : "";
const addDays = (date, days) => {
  const parsed = new Date(`${date}T12:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
};
const issue = (code, severity, message) => ({ code, severity, message });

function resolveCreative(db, id) {
  return id ? (db.creatives || []).find((creative) => creative.id === id) || null : null;
}

function resolveProduct(db, id) {
  return id ? (db.products || []).find((product) => product.id === id) || null : null;
}

function weekDates(today) {
  const current = new Date(`${today}T12:00:00`);
  const mondayOffset = current.getDay() === 0 ? -6 : 1 - current.getDay();
  const monday = addDays(today, mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function preflightCalendarPost(post = {}, db = {}, today = new Date().toISOString().slice(0, 10)) {
  const issues = [];
  const postDate = iso(post.fecha);
  const creative = resolveCreative(db, post.creativeId);
  const copy = text(post.copyFinal || creative?.copy);

  if (!postDate) issues.push(issue("invalid_date", "error", "Falta una fecha válida."));
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text(post.hora))) issues.push(issue("invalid_time", "error", "Falta una hora válida en formato HH:MM."));
  if (!creative) issues.push(issue("missing_creative", "error", "La publicación necesita un creativo existente."));
  else {
    if (!APPROVED_CREATIVE_STATES.has(creative.estado)) issues.push(issue("creative_unapproved", "error", `El creativo está ${creative.estado || "sin estado"}; requiere aprobación humana.`));
    if (text(post.canal) !== text(creative.canal)) issues.push(issue("channel_mismatch", "error", "El canal de la publicación no coincide con el creativo."));
    if (post.campaignId && creative.campaignId && post.campaignId !== creative.campaignId) issues.push(issue("campaign_mismatch", "error", "La campaña no coincide con la del creativo."));
    if (creative.productoFocoId) {
      const product = resolveProduct(db, creative.productoFocoId);
      const stock = agencyProductStock(db, creative.productoFocoId, today);
      if (!product) issues.push(issue("missing_product", "error", "El producto foco ya no existe."));
      else if (product.activo === false) issues.push(issue("inactive_product", "error", "El producto foco está inactivo."));
      else if (stock === null) issues.push(issue("unknown_stock", "error", "No se pudo verificar disponibilidad del producto foco."));
      else if (stock <= 0) issues.push(issue("out_of_stock", "error", "El producto foco no tiene disponibilidad para respaldar la publicación."));
    }
  }
  if (!text(post.titulo)) issues.push(issue("missing_title", "error", "Falta el título interno de la publicación."));
  if (!copy) issues.push(issue("missing_copy", "error", "Falta el copy final."));
  if (postDate && postDate < today && ACTIVE_STATES.has(post.estado || "Pendiente")) issues.push(issue("overdue", "error", "La fecha ya pasó y la publicación sigue activa."));
  if (post.estado === "Publicado" && !text(post.urlPublicacion) && !text(post.externalPostId)) issues.push(issue("missing_public_url", "warning", "Registrá la URL o identificador externo para cerrar la trazabilidad."));

  return {
    ready: issues.every((item) => item.severity !== "error"),
    issues,
    errors: issues.filter((item) => item.severity === "error"),
    warnings: issues.filter((item) => item.severity === "warning"),
    creative,
    product: creative?.productoFocoId ? resolveProduct(db, creative.productoFocoId) : null,
    copy,
  };
}

export function calendarTransitionGuard(post, nextState, db = {}, today = new Date().toISOString().slice(0, 10)) {
  const current = post?.estado || "Pendiente";
  if (current === nextState) return { allowed: true, reasons: [], preflight: preflightCalendarPost(post, db, today) };
  const transitions = {
    Pendiente: new Set(["Programado", "No publicado"]),
    Programado: new Set(["Pendiente", "Publicado", "No publicado"]),
    "No publicado": new Set(["Pendiente"]),
    Publicado: new Set(),
  };
  const reasons = [];
  if (!transitions[current]?.has(nextState)) reasons.push(`Transición inválida: ${current} → ${nextState}.`);
  const preflight = preflightCalendarPost({ ...post, estado: nextState }, db, today);
  if (["Programado", "Publicado"].includes(nextState)) reasons.push(...preflight.errors.map((item) => item.message));
  if (nextState === "Publicado" && iso(post.fecha) > today) reasons.push("No se puede marcar como publicada antes de la fecha programada.");
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], preflight };
}

function duplicateKeys(posts) {
  const groups = new Map();
  posts.filter((post) => ACTIVE_STATES.has(post.estado) && post.creativeId).forEach((post) => {
    const key = `${post.fecha}|${post.creativeId}`;
    groups.set(key, [...(groups.get(key) || []), post.id]);
  });
  return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
}

function slotTaken(posts, date, time, channel) {
  return posts.some((post) => ACTIVE_STATES.has(post.estado) && post.fecha === date && post.hora === time && post.canal === channel);
}

export function buildPostDraftFromCreative(creative, db = {}, today = new Date().toISOString().slice(0, 10)) {
  if (!creative) return null;
  const slots = CHANNEL_SLOTS[creative.canal] || ["12:00"];
  let date = today; let time = slots[0]; let found = false;
  for (let offset = 0; offset < 14 && !found; offset += 1) {
    const candidateDate = addDays(today, offset);
    for (const candidateTime of slots) {
      if (!slotTaken(db.content_calendar || [], candidateDate, candidateTime, creative.canal)) {
        date = candidateDate; time = candidateTime; found = true; break;
      }
    }
  }
  return {
    fecha: date, hora: time, canal: creative.canal || "Instagram", campaignId: creative.campaignId || "",
    creativeId: creative.id, titulo: creative.titulo || "Publicación MOMOS", copyFinal: creative.copy || "",
    estado: "Pendiente", urlPublicacion: "", notas: "Planificada desde el Calendario Comercial Inteligente.",
  };
}

export function buildCommercialCalendar(db = {}, today = new Date().toISOString().slice(0, 10)) {
  const posts = [...(db.content_calendar || [])].sort((left, right) => `${left.fecha}${left.hora}${left.id}`.localeCompare(`${right.fecha}${right.hora}${right.id}`));
  const duplicateIds = duplicateKeys(posts);
  const evaluated = posts.map((post) => {
    const preflight = preflightCalendarPost(post, db, today);
    if (duplicateIds.has(post.id)) {
      const duplicate = issue("duplicate_creative_day", "error", "El mismo creativo aparece más de una vez en este día.");
      preflight.issues.push(duplicate); preflight.errors.push(duplicate); preflight.ready = false;
    }
    return { ...post, preflight };
  });
  const active = evaluated.filter((post) => ACTIVE_STATES.has(post.estado));
  const history = evaluated.filter((post) => HISTORY_STATES.has(post.estado));
  const dates = weekDates(today);
  const scheduledCreativeIds = new Set(active.map((post) => post.creativeId).filter(Boolean));
  const planningQueue = (db.creatives || []).filter((creative) => APPROVED_CREATIVE_STATES.has(creative.estado) && !scheduledCreativeIds.has(creative.id))
    .map((creative) => {
      const draft = buildPostDraftFromCreative(creative, db, today);
      return { creative, draft, preflight: preflightCalendarPost(draft, db, today) };
    })
    .sort((left, right) => Number(right.preflight.ready) - Number(left.preflight.ready) || left.creative.titulo.localeCompare(right.creative.titulo));
  const agenda = active.map((post) => {
    const overdue = post.fecha < today;
    const todayPost = post.fecha === today;
    const action = !post.preflight.ready ? "Corregir preflight" : todayPost ? "Publicar o confirmar programación" : "Preparar archivo y aprobación";
    return { id: post.id, post, action, priority: overdue ? 100 : !post.preflight.ready ? 90 : todayPost ? 80 : 50 };
  }).sort((left, right) => right.priority - left.priority || `${left.post.fecha}${left.post.hora}`.localeCompare(`${right.post.fecha}${right.post.hora}`));

  return {
    today, weekDates: dates, active, history, planningQueue, agenda,
    summary: {
      today: active.filter((post) => post.fecha === today).length,
      readyToday: active.filter((post) => post.fecha === today && post.preflight.ready).length,
      blocked: active.filter((post) => !post.preflight.ready).length,
      overdue: active.filter((post) => post.fecha < today).length,
      scheduledWeek: active.filter((post) => dates.includes(post.fecha)).length,
      unscheduledApproved: planningQueue.length,
    },
  };
}
