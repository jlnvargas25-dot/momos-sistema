const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const MOTION_GRAMMARS = Object.freeze([
  "Información y POV", "Movimiento y energía", "Claridad y blocking", "Impulso y compresión", "Precisión y control",
]);
export const MOTION_JOBS = Object.freeze(["Orientar", "Revelar", "Intensificar", "Demostrar", "Humanizar", "Cerrar"]);

function activeShots(storyboard = {}, shots = []) {
  return list(shots).filter((shot) => String(shot.storyboardId) === String(storyboard.id) && shot.status === "Vigente")
    .sort((a, b) => number(a.shotNumber) - number(b.shotNumber));
}

function classifyShot(shot = {}, index = 0, total = 1) {
  const payload = shot.payload || {};
  const corpus = [shot.title, shot.purpose, payload.subject, payload.action, payload.physics, payload.camera].map(text).join(" ").toLowerCase();
  if (index === total - 1 || /cta|cierre|hero|pack/.test(corpus)) return { job: "Cerrar", grammar: "Precisión y control", mode: "locked" };
  if (/mano|persona|ugc|reacci|habla|rostro/.test(corpus)) return { job: "Humanizar", grammar: "Claridad y blocking", mode: "supported-organic" };
  if (/verter|batir|rellenar|cortar|romper|abrir|cocina|proceso/.test(corpus)) return { job: "Demostrar", grammar: "Movimiento y energía", mode: "reactive" };
  if (/relleno|revel|interior|sorpresa|macro/.test(corpus)) return { job: "Revelar", grammar: "Información y POV", mode: "supported-organic" };
  return { job: index === 0 ? "Intensificar" : "Orientar", grammar: "Precisión y control", mode: "supported-organic" };
}

function proposalFor(shot = {}, nextShot = null, profile = "Precisa", index = 0, total = 1) {
  const payload = shot.payload || {}; const kind = classifyShot(shot, index, total);
  const organic = profile === "Orgánica"; const locked = kind.mode === "locked" && !organic;
  const primaryMove = locked ? "Encuadre fijo que termina en hero frame" : organic
    ? "Desplazamiento corto motivado por la acción, con una corrección amortiguada"
    : "Push o slider corto con inicio y asentamiento suaves";
  const transition = nextShot ? {
    purpose: `Transferir atención hacia la toma ${nextShot.shotNumber}`,
    type: /cortar|abrir|verter|batir/.test(text(payload.action).toLowerCase()) ? "Match on action" : "Corte directo motivado",
    anchorOut: text(payload.continuity_out) || "Acción, producto y luz sellados",
    anchorIn: text(nextShot.payload?.continuity_in) || "Recibir la misma dirección, estado y luz",
    preserve: ["identidad y cantidad del producto", "dirección de pantalla", "fase de acción", "dirección de luz"],
    intentionalChange: "Solo cambia escala o información revelada",
    generativeRisk: "Morphing, inversión de eje o cambio de relleno",
  } : { purpose: "Cerrar en un hero frame legible", type: "Corte final", anchorOut: text(payload.continuity_out) || "Producto estable", anchorIn: "Fin", preserve: ["identidad", "luz", "logo"], intentionalChange: "Ninguno", generativeRisk: "Flicker o mutación final" };
  const prompt = [
    `Producto y sujeto exactos: ${text(payload.subject) || text(shot.title)}.`,
    `Acción física cronológica: ${text(payload.action) || text(shot.purpose)}.`,
    `Contacto, peso y materia: ${text(payload.physics) || "gravedad, resistencia y volumen físicamente coherentes"}.`,
    `Entorno: ${text(payload.environment) || "set MOMOS aprobado"}.`,
    `Cámara: ${primaryMove}; aceleración suave, trayectoria legible y settle antes del corte.`,
    `${organic ? "Cámara humana apoyada, deriva lenta casi imperceptible y una corrección amortiguada causada por la acción; horizonte estable." : "Cámara estable y precisa; sin vibración aleatoria."}`,
    `Foco y blur: carácter natural 180°, foco motivado en el producto y sin hunting.`,
    `Luz: ${text(payload.lighting) || "key lateral suave fija, relleno amplio, sombra única y reflejos coherentes"}.`,
    `Continuidad de entrada: ${text(payload.continuity_in) || "según toma anterior"}. Salida: ${text(payload.continuity_out) || transition.anchorOut}.`,
  ].join(" ");
  const negatives = ["no morphing", "no product substitution", "no logo mutation", "no mirrored text", "no extra fingers",
    "no hand swap", "no teleportation", "no axis reversal", "no flavor or filling change", "no moving key light", "no double shadow", "no random camera shake", "no flicker"];
  return {
    proposalKey: `${profile.toLowerCase()}-${shot.id}`, label: `${profile} · ${kind.job}`, selected: profile === "Precisa",
    grammar: kind.grammar,
    intent: { narrativeJob: kind.job, emotionalEffect: kind.job === "Humanizar" ? "cercanía confiable" : "deseo y claridad", attentionTarget: text(shot.purpose) },
    framingLens: { shotSize: /macro|detalle/.test(text(payload.camera).toLowerCase()) ? "macro" : "close", angle: "three-quarter", cameraHeight: "a la altura funcional del producto", subjectDistance: "sin distorsionar la figura", lensCharacter: /macro/.test(text(payload.camera).toLowerCase()) ? "macro" : "natural", horizon: "level", copySpace: "reservado solo si el storyboard lo exige" },
    cameraPath: { rigFeel: locked ? "locked" : organic ? "shoulder" : "slider", primaryMove, startFrame: text(payload.continuity_in) || "producto estable", acceleration: "eased", path: primaryMove, settle: "asentamiento suave antes del corte", endFrame: text(payload.continuity_out) || "producto legible", motionMotivation: text(shot.purpose) },
    handheldProfile: { mode: locked ? "locked" : organic ? kind.mode : "supported-organic", lowFrequencyDrift: locked ? "ninguna" : "mínima y correlacionada", eventCorrections: organic ? "una corrección causada por contacto o acción" : "ninguna salvo evento", horizonTolerance: "casi nivelado", damping: "suave y completo" },
    motionBlurFocus: { shutterCharacter: "natural-180", focusStart: "plano principal del producto", focusAction: /revel|relleno/.test(`${shot.purpose} ${payload.action}`.toLowerCase()) ? "rack" : "locked", focusEnd: "detalle narrativo legible" },
    lightingMap: { motivatedSource: text(payload.lighting) || "fuente lateral suave del set", key: { direction: "lateral posterior", height: "ligeramente superior", softness: "amplia", temperature: "cálida neutra" }, fillOrNegativeFill: "rebote suave o negativo para conservar volumen", separation: "contraste de fondo controlado", practicals: "solo fuentes justificadas por el set", highlightBehavior: "brillo apetitoso sin clipping", shadowBehavior: "una sombra coherente con la key", lightingChange: "none" },
    continuity: { in: text(payload.continuity_in) || "entrada sellada por storyboard", out: text(payload.continuity_out) || "salida preparada para el siguiente corte", screenDirection: "conservar eje y vector aprobados", productState: "figura, sabor, relleno, cantidad y estado físico exactos", lightAnchor: "key y sombra fijas en el espacio" },
    physics: { contact: text(payload.physics) || "contacto visible y continuo", weightResistance: "peso y resistencia plausibles", gravityViscosity: "gravedad, volumen y viscosidad constantes", deformationLimits: "sin mutar silueta, cobertura, relleno o logo" },
    transitionToNext: transition, generationPrompt: prompt, negativeConstraints: negatives,
    acceptanceTests: ["identidad exacta del producto", "movimiento motivado con inercia y settle", "contacto y materia coherentes", "luz, sombra y reflejos físicamente compatibles", "continuidad de entrada y salida exacta", "transición añade información y funciona sin efecto vistoso"],
    providerAssumptions: ["los parámetros físicos son dirección visual y requieren QA", "reservar handles de montaje", "un movimiento primario por toma"],
    estimatedPreviewCostCop: Math.max(0, Math.round(number(shot.estimatedCostCop) * (organic ? .18 : .12))),
  };
}

export function validateMotionProposal(proposal = {}) {
  const reasons = [];
  if (!text(proposal.proposalKey) || !text(proposal.label)) reasons.push("Falta identificar la propuesta.");
  if (!MOTION_JOBS.includes(proposal.intent?.narrativeJob)) reasons.push("Falta un trabajo narrativo válido.");
  ["framingLens", "cameraPath", "handheldProfile", "motionBlurFocus", "lightingMap", "continuity", "physics", "transitionToNext"].forEach((key) => {
    if (!proposal[key] || typeof proposal[key] !== "object" || Array.isArray(proposal[key])) reasons.push(`Falta ${key}.`);
  });
  if (text(proposal.generationPrompt).length < 80) reasons.push("El prompt no conserva dirección física suficiente.");
  if (list(proposal.negativeConstraints).length < 6) reasons.push("Faltan negativos de identidad, física y continuidad.");
  if (list(proposal.acceptanceTests).length < 5) reasons.push("Faltan pruebas de aceptación antes de generar.");
  return { ready: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function buildMotionPlanDraft(storyboard = {}, shots = [], selections = {}) {
  const active = activeShots(storyboard, shots);
  const shotRecipes = active.map((shot, index) => {
    const proposals = [proposalFor(shot, active[index + 1], "Precisa", index, active.length), proposalFor(shot, active[index + 1], "Orgánica", index, active.length)];
    const selectedKey = text(selections[shot.id]) || proposals[0].proposalKey;
    proposals.forEach((proposal) => { proposal.selected = proposal.proposalKey === selectedKey; });
    return { shot, proposals, selected: proposals.find((proposal) => proposal.selected) || null };
  });
  const reasons = [];
  if (storyboard.status !== "Aprobado") reasons.push("El storyboard necesita aprobación humana.");
  if (shotRecipes.length === 0) reasons.push("El storyboard no tiene tomas vigentes.");
  shotRecipes.forEach(({ shot, proposals, selected }) => {
    if (!text(shot.fingerprint)) reasons.push(`La toma ${shot.shotNumber} perdió su huella.`);
    if (proposals.length < 1 || proposals.length > 3 || !selected || proposals.filter((item) => item.selected).length !== 1) reasons.push(`La toma ${shot.shotNumber} necesita una propuesta seleccionada entre una y tres.`);
    proposals.forEach((proposal) => reasons.push(...validateMotionProposal(proposal).reasons.map((reason) => `Toma ${shot.shotNumber}: ${reason}`)));
  });
  const primary = shotRecipes.map(({ selected }) => selected?.grammar).filter(Boolean);
  return {
    storyboard, shotRecipes, ready: reasons.length === 0, reasons: [...new Set(reasons)],
    grammarPrimary: primary.includes("Movimiento y energía") ? "Movimiento y energía" : "Precisión y control",
    grammarSecondary: primary.includes("Claridad y blocking") ? "Claridad y blocking" : "Información y POV",
    continuityLedger: { axis: "eje y dirección de pantalla sellados por el storyboard", productIdentity: "figura, sabor, relleno, topping, logo y cantidad exactos", physicalState: "cada cambio avanza cronológicamente", lightColor: "key, sombra, exposición y temperatura coherentes", audio: "room tone y acciones con colas de montaje", handles: "12–24 fotogramas por lado cuando el motor lo permita" },
    estimatedPreviewCostCop: shotRecipes.reduce((sum, item) => sum + number(item.selected?.estimatedPreviewCostCop), 0),
  };
}

function proposalPayload(proposal = {}) {
  return { proposal_key: proposal.proposalKey, label: proposal.label, selected: proposal.selected, grammar: proposal.grammar,
    intent: { narrative_job: proposal.intent?.narrativeJob, emotional_effect: proposal.intent?.emotionalEffect, attention_target: proposal.intent?.attentionTarget },
    framing_lens: proposal.framingLens, camera_path: proposal.cameraPath, handheld_profile: proposal.handheldProfile,
    motion_blur_focus: proposal.motionBlurFocus, lighting_map: proposal.lightingMap, continuity: proposal.continuity,
    physics: proposal.physics, transition_to_next: proposal.transitionToNext, generation_prompt: proposal.generationPrompt,
    negative_constraints: proposal.negativeConstraints, acceptance_tests: proposal.acceptanceTests,
    provider_assumptions: proposal.providerAssumptions, estimated_preview_cost_cop: proposal.estimatedPreviewCostCop };
}

export function motionPlanPayload(draft = {}, agentName = "") {
  if (!draft.ready) throw new Error(draft.reasons?.[0] || "El plan de motion todavía no está listo.");
  return { plan_key: `storyboard-${draft.storyboard.id}-motion-${Date.now()}`, storyboard_id: draft.storyboard.id,
    grammar_primary: draft.grammarPrimary, grammar_secondary: draft.grammarSecondary, continuity_ledger: draft.continuityLedger,
    agent_name: text(agentName), shots: draft.shotRecipes.map(({ shot, proposals }) => ({ shot_id: shot.id,
      shot_fingerprint: shot.fingerprint, proposals: proposals.map(proposalPayload) })) };
}

export function buildAgencyMotionCenter(db = {}) {
  const boards = list(db.agencyStoryboards); const plans = list(db.agencyMotionPlans).map((plan) => ({ ...plan,
    storyboard: boards.find((board) => String(board.id) === String(plan.storyboardId)) || null,
    recipes: list(db.agencyMotionRecipes).filter((recipe) => String(recipe.planId) === String(plan.id)),
    observations: list(db.agencyMotionObservations).filter((item) => String(item.planId) === String(plan.id)),
  }));
  const governed = new Set(plans.filter((plan) => !["Sustituido", "Devuelto"].includes(plan.status)).map((plan) => String(plan.storyboardId)));
  return { plans, eligibleStoryboards: boards.filter((board) => board.status === "Aprobado" && !governed.has(String(board.id))),
    reviewing: plans.filter((plan) => plan.status === "En revisión"), approved: plans.filter((plan) => plan.status === "Aprobado"),
    summary: { eligible: boards.filter((board) => board.status === "Aprobado" && !governed.has(String(board.id))).length,
      reviewing: plans.filter((plan) => plan.status === "En revisión").length, approved: plans.filter((plan) => plan.status === "Aprobado").length,
      observations: list(db.agencyMotionObservations).length } };
}
