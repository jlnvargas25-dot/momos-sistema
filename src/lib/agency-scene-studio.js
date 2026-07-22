const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const STORYBOARD_CHANNELS = Object.freeze(["Instagram", "Facebook", "TikTok", "WhatsApp", "Multicanal"]);
export const STORYBOARD_FORMATS = Object.freeze(["Reel", "Historia", "TikTok", "UGC", "Video", "Carrusel"]);
export const STORYBOARD_ASPECT_RATIOS = Object.freeze(["9:16", "1:1", "4:5", "16:9"]);

export function normalizeShotDraft(input = {}) {
  return {
    shotNumber: Math.max(1, Math.trunc(number(input.shotNumber) || 1)),
    title: text(input.title),
    purpose: text(input.purpose),
    durationSec: Math.max(0.1, number(input.durationSec) || 3),
    subject: text(input.subject),
    action: text(input.action),
    physics: text(input.physics),
    environment: text(input.environment),
    camera: text(input.camera),
    lighting: text(input.lighting),
    audio: text(input.audio),
    onScreenText: text(input.onScreenText),
    continuityIn: text(input.continuityIn),
    continuityOut: text(input.continuityOut),
    avoid: text(input.avoid),
    assetIds: list(input.assetIds).map(Number).filter((id) => Number.isInteger(id) && id > 0),
    estimatedCostCop: Math.max(0, number(input.estimatedCostCop)),
  };
}

export function activeStoryboardShots(storyboard = {}, shots = []) {
  return list(shots)
    .filter((shot) => String(shot.storyboardId) === String(storyboard.id) && shot.status === "Vigente")
    .sort((a, b) => Number(a.shotNumber) - Number(b.shotNumber));
}

export function storyboardReadiness(storyboard = {}, shots = [], contracts = []) {
  const activeShots = activeStoryboardShots(storyboard, shots);
  const contract = list(contracts).find((item) => String(item.id) === String(storyboard.contractId));
  const reasons = [];
  if (!contract || contract.status !== "Aprobado") reasons.push("El contrato creativo dejó de estar aprobado.");
  if (!["Borrador", "En revisión"].includes(storyboard.status)) reasons.push("El storyboard ya no admite esta transición.");
  if (activeShots.length === 0) reasons.push("Falta al menos una toma vigente.");
  activeShots.forEach((shot, index) => {
    if (Number(shot.shotNumber) !== index + 1) reasons.push("Las tomas deben ser consecutivas desde la número 1.");
    const payload = shot.payload || {};
    if (!text(shot.title) || !text(shot.purpose) || !text(payload.subject) || !text(payload.action)
      || !text(payload.camera) || !text(payload.continuity_out)) {
      reasons.push(`La toma ${shot.shotNumber} no tiene dirección verificable completa.`);
    }
  });
  const totalDurationSec = activeShots.reduce((sum, shot) => sum + number(shot.durationSec), 0);
  if (activeShots.length > 0 && Math.abs(totalDurationSec - number(storyboard.targetDurationSec)) > 0.51) {
    reasons.push(`Las tomas suman ${totalDurationSec.toFixed(1)} s y el objetivo es ${number(storyboard.targetDurationSec).toFixed(1)} s.`);
  }
  const loops = list(storyboard.retentionPlan?.loops);
  if (number(storyboard.targetDurationSec) > 0 && loops.length === 0) reasons.push("Falta definir al menos un loop de retención con payoff.");
  loops.forEach((loop, index) => {
    const opened = number(loop.open_sec); const closed = number(loop.close_sec);
    if (!text(loop.promise) || !text(loop.payoff) || closed < opened || closed > number(storyboard.targetDurationSec)) {
      reasons.push(`El loop ${index + 1} no abre y cierra una promesa válida dentro de la pieza.`);
    }
  });
  return {
    ready: reasons.length === 0,
    reasons: [...new Set(reasons)],
    activeShots,
    totalDurationSec,
    estimatedCostCop: activeShots.reduce((sum, shot) => sum + number(shot.estimatedCostCop), 0),
  };
}

export function buildAgencySceneStudio(db = {}) {
  const contracts = list(db.agencyCreativeContracts);
  const storyboards = list(db.agencyStoryboards).map((storyboard) => ({
    ...storyboard,
    readiness: storyboardReadiness(storyboard, db.agencyStoryboardShots, contracts),
  }));
  const eligibleContracts = contracts.filter((contract) => contract.status === "Aprobado"
    && !storyboards.some((storyboard) => String(storyboard.contractId) === String(contract.id) && storyboard.status !== "Sustituido"));
  return {
    storyboards,
    eligibleContracts,
    active: storyboards.filter((item) => ["Borrador", "En revisión"].includes(item.status)),
    approved: storyboards.filter((item) => item.status === "Aprobado"),
    summary: {
      drafting: storyboards.filter((item) => item.status === "Borrador").length,
      reviewing: storyboards.filter((item) => item.status === "En revisión").length,
      approved: storyboards.filter((item) => item.status === "Aprobado").length,
      shots: list(db.agencyStoryboardShots).filter((item) => item.status === "Vigente").length,
    },
  };
}

export function storyboardPayload(input = {}, contract = {}) {
  const duration = Math.max(1, number(input.targetDurationSec) || 15);
  return {
    storyboard_key: `contract-${contract.id}-storyboard-${Date.now()}`,
    contract_id: contract.id,
    title: text(input.title) || text(contract.sealedPayload?.creative_direction?.concept) || `Storyboard contrato ${contract.id}`,
    channel: STORYBOARD_CHANNELS.includes(input.channel) ? input.channel : "Instagram",
    format: STORYBOARD_FORMATS.includes(input.format) ? input.format : "Reel",
    aspect_ratio: STORYBOARD_ASPECT_RATIOS.includes(input.aspectRatio) ? input.aspectRatio : "9:16",
    target_duration_sec: duration,
    creative_brief: {
      hook: text(input.hook),
      payoff: text(input.payoff),
      call_to_action: text(input.callToAction) || text(contract.sealedPayload?.creative_direction?.call_to_action),
      visual_thesis: text(input.visualThesis),
    },
    retention_plan: {
      loops: [{ loop_id: "L1", open_sec: 0, close_sec: duration, promise: text(input.hook), payoff: text(input.payoff) }],
    },
    estimated_cost_cop: Math.max(0, number(input.estimatedCostCop)),
  };
}

export function shotPayload(input = {}, storyboard = {}) {
  const shot = normalizeShotDraft(input);
  return {
    storyboard_id: storyboard.id,
    shot_number: shot.shotNumber,
    title: shot.title,
    purpose: shot.purpose,
    duration_sec: shot.durationSec,
    input_asset_ids: shot.assetIds,
    estimated_cost_cop: shot.estimatedCostCop,
    shot: {
      subject: shot.subject,
      action: shot.action,
      physics: shot.physics,
      environment: shot.environment,
      camera: shot.camera,
      lighting: shot.lighting,
      audio: shot.audio,
      on_screen_text: shot.onScreenText,
      continuity_in: shot.continuityIn,
      continuity_out: shot.continuityOut,
      avoid: shot.avoid,
      acceptance: "Producto y marca fieles; anatomía, física, texto y continuidad aprobables.",
    },
  };
}
