const CONNECTOR_CHANNEL = Object.freeze({ Instagram: "Meta", Facebook: "Meta", TikTok: "TikTok" });
const TERMINAL = new Set(["Borrador listo", "Publicado", "Fallido", "Incierto", "Cancelado"]);
const IN_FLIGHT = new Set(["Autorizado", "Arrendado", "Despachando", "En proveedor"]);

const clean = (value) => String(value || "").trim();

export function distributionProvider(channel) {
  return CONNECTOR_CHANNEL[clean(channel)] || "";
}

export function integrationForDistribution(post, db = {}) {
  const provider = distributionProvider(post?.canal);
  return (db.agencyIntegrations || []).find((item) => item.provider === provider) || null;
}

export function connectorCapability(integration, label) {
  return (integration?.capabilities || []).some((item) => clean(item).toLocaleLowerCase("es") === clean(label).toLocaleLowerCase("es"));
}

function heartbeatFresh(integration, now = new Date()) {
  const heartbeat = Date.parse(integration?.lastHeartbeatAt || "");
  return Number.isFinite(heartbeat) && now.getTime() - heartbeat <= 30 * 60 * 1000;
}

export function dispatchEligibility(item, db = {}, now = new Date()) {
  const provider = distributionProvider(item?.post?.canal);
  const integration = integrationForDistribution(item?.post, db);
  const reasons = [];
  let mode = "";
  if (!provider) reasons.push("Este canal conserva distribución manual.");
  if (item?.run?.status !== "Aprobada") reasons.push("La salida debe tener aprobación humana.");
  if (provider && !db.distributionConnectorReady) reasons.push("Falta instalar la cola protegida de distribución.");
  if (provider && !integration) reasons.push(`Falta configurar la integración ${provider}.`);
  if (integration && integration.status !== "Activa") reasons.push(`La integración ${provider} no está Activa.`);
  if (integration && !integration.secretConfigured) reasons.push(`El servidor no confirmó el secreto de ${provider}.`);
  if (integration && !heartbeatFresh(integration, now)) reasons.push(`El conector ${provider} no reporta actividad reciente.`);
  if (provider === "TikTok") {
    mode = "Borrador";
    if (integration && !connectorCapability(integration, "Borradores")) reasons.push("TikTok todavía no confirmó la capacidad Borradores.");
  } else if (provider === "Meta") {
    mode = "Directo";
    if (integration && !connectorCapability(integration, "Publicación directa")) reasons.push("Meta todavía no confirmó Publicación directa.");
  }
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], provider, mode, integration };
}

export function dispatchJobFor(item, db = {}) {
  const jobs = (db.distributionConnectorJobs || []).filter((job) => job.distributionId === item?.run?.id);
  return jobs.sort((left, right) => Number(right.attempt || 0) - Number(left.attempt || 0) || Number(right.id || 0) - Number(left.id || 0))[0] || null;
}

export function dispatchJobPresentation(job) {
  if (!job) return null;
  const map = {
    Autorizado: ["Autorizado · esperando horario", "El servidor lo tomará una sola vez."],
    Arrendado: ["Conector preparando envío", "El trabajo tiene un lease temporal."],
    Despachando: ["Enviando al proveedor", "La clave idempotente ya quedó registrada."],
    "En proveedor": ["Procesando en plataforma", "MOMO OPS conciliará el resultado sin reenviar."],
    "Borrador listo": ["Borrador listo para revisar", "Abrilo en TikTok y publicalo cuando esté correcto."],
    Publicado: ["Publicado y conciliado", "La evidencia externa quedó ligada al calendario."],
    Fallido: ["El conector falló", "Corregí la causa y autorizá un nuevo intento."],
    Incierto: ["Resultado incierto · no reenviar", "Conciliá con la plataforma antes de reintentar."],
    Cancelado: ["Despacho cancelado", "No salió por este intento."],
  };
  const [label, help] = map[job.status] || [job.status, "Revisá el detalle del conector."];
  return { label, help, terminal: TERMINAL.has(job.status), inFlight: IN_FLIGHT.has(job.status) };
}

export function enrichDistributionWithDispatch(item, db = {}, now = new Date()) {
  const job = dispatchJobFor(item, db);
  const presentation = dispatchJobPresentation(job);
  const eligibility = dispatchEligibility(item, db, now);
  let action = item.action;
  if (job) action = presentation?.inFlight ? presentation.label : job.status === "Publicado" ? "Sin acción" : presentation?.label;
  else if (item.run?.status === "Aprobada" && eligibility.allowed) action = eligibility.mode === "Borrador" ? "Autorizar borrador TikTok" : `Autorizar envío por ${eligibility.provider}`;
  return { ...item, dispatch: { job, presentation, eligibility }, action };
}
