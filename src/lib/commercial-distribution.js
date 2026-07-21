import { preflightCalendarPost } from "./commercial-calendar.js";
import { businessDateISO } from "./business-date.js";

const MEDIA_CHANNELS = new Set(["Instagram", "Facebook", "TikTok", "Rappi", "Influencer", "Orgánico"]);
const ACTIVE_POST_STATES = new Set(["Pendiente", "Programado"]);
const CLOSED_POST_STATES = new Set(["Publicado", "No publicado"]);

const clean = (value) => String(value || "").trim();
const iso = (value) => /^\d{4}-\d{2}-\d{2}$/.test(clean(value).slice(0, 10)) ? clean(value).slice(0, 10) : "";

function creativeOf(db, post) {
  return (db.creatives || []).find((creative) => creative.id === post?.creativeId) || null;
}

function runOf(db, postId) {
  return (db.content_distributions || []).find((run) => run.postId === postId) || null;
}

export function contentModeFor(post, db = {}) {
  const run = runOf(db, post?.id);
  if (["Pauta", "Orgánico"].includes(run?.contentMode)) return run.contentMode;
  const creative = creativeOf(db, post);
  const campaign = (db.campaigns || []).find((item) => item.id === post?.campaignId);
  return campaign && (Number(campaign.presupuesto || 0) > 0 || clean(campaign.externalPlatform) || creative?.formato === "Anuncio")
    ? "Pauta" : "Orgánico";
}

export function distributionChecklistFor(post, db = {}) {
  const creative = creativeOf(db, post);
  const contentMode = contentModeFor(post, db);
  const items = [
    { key: "formato_canal", label: `Formato validado para ${post?.canal || "el canal"}` },
    { key: "copy_revisado", label: "Copy, ortografía y tono MOMOS revisados" },
    { key: "cta_enlace", label: "Llamado a la acción y enlace verificados" },
    { key: "identidad_marca", label: "La pieza se reconoce como MOMOS y respeta su personalidad" },
    { key: "producto_fiel", label: "Producto, figura, sabor, relleno y empaque coinciden con la realidad" },
    { key: "claims_verificados", label: "Precios, beneficios, disponibilidad y promesas tienen evidencia" },
    { key: "logo_color_tipografia", label: "Logo, colores y tipografías usan las versiones aprobadas" },
    { key: "objetivo_del_modo", label: contentMode === "Pauta" ? "Objetivo comercial, audiencia y etapa del embudo están definidos" : "El contenido entrega valor, historia o conversación antes de pedir una acción" },
    { key: "cta_del_modo", label: contentMode === "Pauta" ? "Oferta y CTA son claros, reales y medibles" : "El CTA es natural y no fuerza una venta" },
    { key: "medicion_del_modo", label: contentMode === "Pauta" ? "Atribución, pedidos pagados y beneficio podrán medirse" : "Retención, finalización, compartidos, guardados y conversación se medirán aparte" },
    { key: "separacion_pauta_organico", label: `Resultados de ${contentMode} no se mezclarán con ${contentMode === "Pauta" ? "Orgánico" : "Pauta"}` },
  ];
  if (MEDIA_CHANNELS.has(post?.canal)) items.unshift({ key: "archivo_final", label: "Archivo final listo y abre correctamente" });
  if (["Instagram", "TikTok"].includes(post?.canal) && ["Reel", "Video UGC"].includes(creative?.formato)) {
    items.push({ key: "audio_derechos", label: "Audio y derechos de uso verificados" });
  }
  if (post?.canal === "WhatsApp") items.push({ key: "audiencia_autorizada", label: "Audiencia con autorización comercial confirmada" });
  if (post?.canal === "Rappi") items.push({ key: "ficha_disponible", label: "Producto, precio y disponibilidad coinciden con Rappi" });
  if (post?.canal === "Influencer") items.push({ key: "menciones_acordadas", label: "Menciones, etiquetas y entregables acordados" });
  return items;
}

export function distributionReadiness(post, db = {}, run = null, today = businessDateISO()) {
  const preflight = preflightCalendarPost(post, db, today);
  const creative = creativeOf(db, post);
  const errors = [...preflight.errors.map((item) => item.message)];
  if (post?.estado !== "Programado") errors.push("La publicación debe estar Programada antes de preparar su salida.");
  if (MEDIA_CHANNELS.has(post?.canal) && !clean(creative?.assetUrl)) errors.push("El creativo necesita un archivo final antes de distribuirse.");
  const items = distributionChecklistFor(post, db).map((item) => ({ ...item, checked: run?.checklist?.[item.key] === true }));
  const checked = items.filter((item) => item.checked).length;
  return {
    readyToPrepare: errors.length === 0,
    checklistComplete: items.length > 0 && checked === items.length,
    checked,
    total: items.length,
    items,
    errors: [...new Set(errors)],
    preflight,
    creative,
  };
}

function isDue(post, today, nowTime) {
  const date = iso(post?.fecha);
  if (!date) return false;
  if (date < today) return true;
  if (date > today) return false;
  return clean(post?.hora || "00:00").slice(0, 5) <= nowTime;
}

function metricsForPost(db, post) {
  return (db.creative_results || []).filter((metric) => metric.postId === post.id || (!metric.postId && metric.creativeId && metric.creativeId === post.creativeId && metric.fecha === post.fecha));
}

function nextAction(post, run, readiness, due, hasMetrics) {
  if (run?.status === "Publicada") return hasMetrics ? "Sin acción" : "Capturar resultados";
  if (run?.status === "Cancelada") return "Sin acción";
  if (run?.status === "Fallida") return "Revisar fallo";
  if (post.estado === "Pendiente") return "Programar primero";
  if (!readiness.readyToPrepare) return "Corregir preflight";
  if (!run) return "Preparar salida";
  if (run.status === "Preparación") return readiness.checklistComplete ? "Marcar lista" : "Completar checklist";
  if (run.status === "Lista") return "Aprobar salida";
  if (run.status === "Aprobada") return due ? "Publicar y registrar evidencia" : "Esperar horario";
  if (run.status === "Publicada" && !hasMetrics) return "Capturar resultados";
  return "Sin acción";
}

export function buildDistributionRoom(db = {}, today = businessDateISO(), nowTime = "12:00") {
  const posts = [...(db.content_calendar || [])].sort((left, right) => `${left.fecha}${left.hora}${left.id}`.localeCompare(`${right.fecha}${right.hora}${right.id}`));
  const evaluated = posts.map((post) => {
    const run = runOf(db, post.id);
    const readiness = distributionReadiness(post, db, run, today);
    const due = isDue(post, today, nowTime);
    const metrics = metricsForPost(db, post);
    const contentMode = contentModeFor(post, db);
    const action = nextAction(post, run, readiness, due, metrics.length > 0);
    const blocked = ["Programar primero", "Corregir preflight", "Completar checklist", "Revisar fallo"].includes(action);
    const priority = post.estado === "Programado" && due ? (blocked ? 100 : 90) : blocked ? 80 : post.fecha === today ? 70 : 40;
    return { post, run, readiness, due, metrics, contentMode, action, blocked, priority };
  });
  const queue = evaluated.filter((item) => ACTIVE_POST_STATES.has(item.post.estado) || ["Preparación", "Lista", "Aprobada", "Fallida"].includes(item.run?.status))
    .sort((left, right) => right.priority - left.priority || `${left.post.fecha}${left.post.hora}`.localeCompare(`${right.post.fecha}${right.post.hora}`));
  const history = evaluated.filter((item) => CLOSED_POST_STATES.has(item.post.estado) || ["Publicada", "Cancelada"].includes(item.run?.status)).reverse();
  const needsMetrics = evaluated.filter((item) => item.run?.status === "Publicada" && item.metrics.length === 0);
  return {
    queue, history, needsMetrics,
    summary: {
      due: queue.filter((item) => item.due).length,
      blocked: queue.filter((item) => item.blocked).length,
      ready: queue.filter((item) => item.run?.status === "Aprobada" && item.due).length,
      awaitingApproval: queue.filter((item) => item.run?.status === "Lista").length,
      needsMetrics: needsMetrics.length,
    },
  };
}

export function validateDistributionAction(action, post, db = {}, run = null, payload = {}, today = businessDateISO(), nowTime = "12:00") {
  const readiness = distributionReadiness(post, db, run, today);
  const reasons = [];
  if (action === "prepare") reasons.push(...readiness.errors);
  else if (action === "approve") {
    if (run?.status !== "Lista") reasons.push("La salida debe estar Lista antes de aprobarse.");
    reasons.push(...readiness.errors);
    if (!readiness.checklistComplete) reasons.push("El checklist debe estar completo.");
  } else if (action === "publish") {
    if (run?.status !== "Aprobada") reasons.push("La salida necesita aprobación humana antes de publicarse.");
    reasons.push(...readiness.errors);
    if (!isDue(post, today, nowTime)) reasons.push("Todavía no llegó la fecha y hora programadas.");
    if (!clean(payload.externalUrl) && !clean(payload.externalPostId)) reasons.push("Registrá la URL o el identificador externo de la publicación.");
  } else if (action === "fail") {
    if (!run || ["Publicada", "Cancelada"].includes(run.status)) reasons.push("No hay una salida abierta que pueda marcarse como fallida.");
    if (clean(payload.reason).length < 5) reasons.push("Explicá por qué no se pudo publicar.");
  } else reasons.push("Acción de distribución desconocida.");
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], readiness };
}
