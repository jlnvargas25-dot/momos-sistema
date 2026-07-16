const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const SCENE_ROUTE_PROVIDERS = Object.freeze(["Higgsfield", "Kling"]);
export const SCENE_ROUTE_RISKS = Object.freeze(["Bajo", "Medio", "Alto"]);

function activeShots(storyboard = {}, shots = []) {
  return list(shots)
    .filter((shot) => String(shot.storyboardId) === String(storyboard.id) && shot.status === "Vigente")
    .sort((a, b) => Number(a.shotNumber) - Number(b.shotNumber));
}

function integrationState(provider, db = {}) {
  const row = list(db.agencyIntegrations).find((item) => item.provider === provider) || {};
  const bridgeReady = provider === "Higgsfield" ? db.higgsfieldConnectorReady === true : db.klingConnectorReady === true;
  const heartbeat = row.lastHeartbeatAt ? new Date(row.lastHeartbeatAt) : null;
  const heartbeatFresh = heartbeat && !Number.isNaN(heartbeat.getTime())
    ? Date.now() - heartbeat.getTime() <= 30 * 60 * 1000
    : false;
  const operational = Boolean(db.agencyIntegrationsReady) && bridgeReady && row.status === "Activa"
    && row.secretConfigured === true && heartbeatFresh;
  const reasons = [];
  if (!db.agencyIntegrationsReady) reasons.push("Falta el Centro de integraciones.");
  else if (!bridgeReady) reasons.push(`Falta el adaptador privado de ${provider}.`);
  else if (row.status === "Pausada") reasons.push(`${provider} está pausado.`);
  else if (row.status !== "Activa") reasons.push(`${provider} no está activo.`);
  else if (row.secretConfigured !== true) reasons.push(`${provider} no confirmó su autenticación privada.`);
  else if (!heartbeatFresh) reasons.push(`${provider} no tiene heartbeat reciente.`);
  return { operational, reasons };
}

export function recommendSceneProvider(shot = {}) {
  const payload = shot.payload || {};
  const corpus = [shot.title, shot.purpose, payload.subject, payload.action, payload.physics, payload.camera,
    payload.audio, payload.on_screen_text, payload.environment].map(text).join(" ").toLocaleLowerCase("es");
  if (/di[aá]logo|voz|audio|habla|labios|lip.?sync|movimiento humano|manos|f[ií]sica|gravedad|viscos|correr|caminar/.test(corpus)) {
    return { provider: "Kling", capability: "Movimiento físico y audio", rationale: "La toma exige física, gesto o audio coherente." };
  }
  if (/texto|tipograf|logo|infograf|dato|display|gr[aá]fic|transici[oó]n|componer|diseño/.test(corpus)) {
    return { provider: "Higgsfield", capability: "Motion gráfico y composición", rationale: "La toma prioriza jerarquía, texto o composición controlada." };
  }
  if (/dolly|[oó]rbita|orbit|handheld|c[aá]mara|macro|cinem|producto|relleno|salsa/.test(corpus)) {
    return { provider: "Kling", capability: "Video de producto y cámara", rationale: "La toma depende del movimiento de producto o cámara." };
  }
  return { provider: "Higgsfield", capability: "Composición visual", rationale: "La toma puede resolverse desde referencias visuales aprobadas." };
}

export function buildSceneRoutingDraft(storyboard = {}, shots = [], db = {}, overrides = {}) {
  const routes = activeShots(storyboard, shots).map((shot) => {
    const recommended = recommendSceneProvider(shot);
    const override = overrides[shot.id] || {};
    const provider = SCENE_ROUTE_PROVIDERS.includes(override.provider) ? override.provider : recommended.provider;
    const estimatedCostCop = Math.max(0, number(override.estimatedCostCop ?? shot.estimatedCostCop));
    const suggestedCap = estimatedCostCop > 0 ? Math.ceil((estimatedCostCop * 1.25) / 100) * 100 : 0;
    const maxCostCop = Math.max(0, number(override.maxCostCop ?? suggestedCap));
    const state = integrationState(provider, db);
    const payload = shot.payload || {};
    return {
      shotId: Number(shot.id), shotNumber: Number(shot.shotNumber), shotFingerprint: text(shot.fingerprint),
      title: text(shot.title), provider, recommendedProvider: recommended.provider,
      capability: text(override.capability) || recommended.capability,
      rationale: text(override.rationale) || recommended.rationale,
      riskLevel: SCENE_ROUTE_RISKS.includes(override.riskLevel) ? override.riskLevel : "Medio",
      operation: "Generar video", estimatedCostCop, maxCostCop,
      prompt: text(override.prompt) || [
        `Toma ${shot.shotNumber}: ${shot.title}.`, `Propósito: ${shot.purpose}.`,
        `Sujeto: ${payload.subject}.`, `Acción: ${payload.action}.`, `Física: ${payload.physics || "natural y consistente"}.`,
        `Entorno: ${payload.environment || "identidad MOMOS"}.`, `Cámara: ${payload.camera}.`,
        `Luz: ${payload.lighting || "fiel al storyboard"}.`, `Continuidad de entrada: ${payload.continuity_in || "según toma anterior"}.`,
        `Continuidad de salida: ${payload.continuity_out}.`, `Texto visible: ${payload.on_screen_text || "ninguno"}.`,
      ].join(" "),
      negativePrompt: text(override.negativePrompt) || [payload.avoid, "No deformar producto, logo, figura, relleno ni texto. No inventar claims."].filter(Boolean).join(" "),
      outputSpec: {
        aspect_ratio: storyboard.aspectRatio, duration_sec: Number(shot.durationSec || 0),
        acceptance: payload.acceptance || "Producto y marca fieles; física, cámara y continuidad aprobables.",
      },
      operational: state.operational, operationalReasons: state.reasons,
    };
  });
  const reasons = [];
  if (storyboard.status !== "Aprobado") reasons.push("El storyboard necesita aprobación humana.");
  if (routes.length === 0) reasons.push("El storyboard no tiene tomas vigentes.");
  routes.forEach((route) => {
    if (!route.shotFingerprint) reasons.push(`La toma ${route.shotNumber} no conserva su huella.`);
    if (route.estimatedCostCop <= 0) reasons.push(`Falta estimar el costo real de la toma ${route.shotNumber}.`);
    if (route.maxCostCop < route.estimatedCostCop) reasons.push(`El tope de la toma ${route.shotNumber} es menor que su estimado.`);
  });
  return {
    storyboard, routes, ready: reasons.length === 0, reasons: [...new Set(reasons)],
    totalEstimatedCostCop: routes.reduce((sum, route) => sum + route.estimatedCostCop, 0),
    totalCostCapCop: routes.reduce((sum, route) => sum + route.maxCostCop, 0),
    operational: routes.every((route) => route.operational),
    operationalReasons: [...new Set(routes.flatMap((route) => route.operationalReasons))],
  };
}

export function sceneRoutingPayload(draft = {}, agentName = "MOMO OPS Router") {
  return {
    plan_key: `storyboard-${draft.storyboard?.id}-route-${Date.now()}`,
    storyboard_id: draft.storyboard?.id,
    agent_name: agentName,
    routes: list(draft.routes).map((route) => ({
      shot_id: route.shotId, shot_fingerprint: route.shotFingerprint, provider: route.provider,
      capability: route.capability, rationale: route.rationale, risk_level: route.riskLevel,
      operation: route.operation, estimated_cost_cop: route.estimatedCostCop, max_cost_cop: route.maxCostCop,
      prompt: route.prompt, negative_prompt: route.negativePrompt, output_spec: route.outputSpec,
    })),
  };
}

export function buildAgencySceneRouter(db = {}) {
  const boards = list(db.agencyStoryboards);
  const plans = list(db.agencySceneRoutingPlans).map((plan) => {
    const storyboard = boards.find((board) => String(board.id) === String(plan.storyboardId)) || null;
    const jobs = list(db.creativeGenerationJobs).filter((job) => String(job.outputSpec?.routing_plan_id) === String(plan.id));
    return { ...plan, storyboard, jobs };
  });
  const routedBoardIds = new Set(plans.filter((plan) => plan.status !== "Sustituido").map((plan) => String(plan.storyboardId)));
  return {
    plans,
    eligibleStoryboards: boards.filter((board) => board.status === "Aprobado" && !routedBoardIds.has(String(board.id))),
    prepared: plans.filter((plan) => plan.status === "Preparado"),
    authorized: plans.filter((plan) => plan.status === "Autorizado"),
    summary: {
      prepared: plans.filter((plan) => plan.status === "Preparado").length,
      authorized: plans.filter((plan) => plan.status === "Autorizado").length,
      jobs: plans.reduce((sum, plan) => sum + plan.jobs.length, 0),
      committedCostCop: plans.filter((plan) => plan.status === "Autorizado").reduce((sum, plan) => sum + number(plan.totalCostCapCop), 0),
    },
  };
}

