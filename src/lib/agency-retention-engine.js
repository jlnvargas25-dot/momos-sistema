const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const RETENTION_PLATFORMS = Object.freeze(["Instagram Reels", "TikTok", "YouTube Shorts", "Meta Ads", "Multicanal"]);
export const RETENTION_HOOK_MECHANISMS = Object.freeze(["Resultado primero", "Contraste", "Demostración", "Pregunta", "Especificidad"]);
export const RETENTION_SCORE_KEYS = Object.freeze(["clarity", "relevance", "specificity", "proof", "novelty", "payoff_fit", "brand_fit", "honesty"]);

export function scoreRetentionHook(scores = {}) {
  const normalized = Object.fromEntries(RETENTION_SCORE_KEYS.map((key) => [key, Math.max(0, Math.min(2, Math.trunc(number(scores[key]))))]));
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  const reasons = [];
  if (normalized.proof < 2) reasons.push("El primer segundo todavía no demuestra la promesa.");
  if (normalized.honesty < 2) reasons.push("La promesa puede exceder la evidencia disponible.");
  if (normalized.payoff_fit < 2) reasons.push("El payoff no cierra exactamente lo que abre el hook.");
  if (total < 12) reasons.push(`El hook obtiene ${total}/16; necesita al menos 12/16.`);
  return { scores: normalized, total, eligible: reasons.length === 0, reasons };
}

export function validateRetentionArchitecture(script = {}) {
  const beats = list(script.beatMap);
  const loops = list(script.loops);
  const hooks = list(script.hooks);
  const duration = number(script.targetDurationSec);
  const reasons = [];
  if (!text(script.promise) || !text(script.payoff) || !text(script.callToAction)) reasons.push("Faltan promesa, payoff o CTA verificables.");
  if (duration < 5 || duration > 180) reasons.push("La duración objetivo debe estar entre 5 y 180 segundos.");
  if (hooks.length < 2) reasons.push("Se necesitan al menos control y retador para aprender una sola variable.");
  if (beats.length < 3) reasons.push("El guion necesita al menos hook, desarrollo y payoff.");
  const orderedBeats = [...beats].sort((a, b) => number(a.startSec) - number(b.startSec));
  orderedBeats.forEach((beat, index) => {
    if (!text(beat.label) || number(beat.startSec) < 0 || number(beat.endSec) <= number(beat.startSec)) reasons.push(`El bloque ${index + 1} no tiene tiempo o propósito válido.`);
    if (index > 0 && number(beat.startSec) < number(orderedBeats[index - 1].endSec)) reasons.push(`El bloque ${index + 1} se superpone con el anterior.`);
    if (number(beat.endSec) > duration) reasons.push(`El bloque ${index + 1} excede la duración objetivo.`);
  });
  loops.forEach((loop, index) => {
    const open = number(loop.openSec); const close = number(loop.closeSec);
    if (!text(loop.question) || !text(loop.payoff) || close <= open || close > duration) reasons.push(`El loop ${index + 1} no abre y cierra una promesa dentro de la pieza.`);
  });
  if (loops.length === 0) reasons.push("Falta al menos un loop con payoff real; el CTA no cuenta como cierre.");
  const selected = hooks.filter((hook) => hook.selected);
  if (selected.length !== 1) reasons.push("Debe existir exactamente un hook seleccionado para la versión.");
  if (selected[0] && !scoreRetentionHook(selected[0].scores).eligible) reasons.push(...scoreRetentionHook(selected[0].scores).reasons);
  return { ready: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function retentionScriptPayload(input = {}, contract = {}) {
  const hooks = list(input.hooks).map((hook, index) => ({
    variant_key: text(hook.variantKey) || `V${index + 1}`,
    label: text(hook.label) || (index === 0 ? "Control" : `Retador ${index}`),
    mechanism: RETENTION_HOOK_MECHANISMS.includes(hook.mechanism) ? hook.mechanism : "Resultado primero",
    hook_text: text(hook.hookText), opening_visual: text(hook.openingVisual), proof: text(hook.proof),
    scores: scoreRetentionHook(hook.scores).scores, selected: Boolean(hook.selected),
  }));
  return {
    script_key: text(input.scriptKey) || `contract-${contract.id}-retention-${Date.now()}`,
    contract_id: contract.id,
    title: text(input.title) || `Guion de retención · contrato ${contract.id}`,
    platform: RETENTION_PLATFORMS.includes(input.platform) ? input.platform : "Instagram Reels",
    target_duration_sec: Math.max(5, Math.min(180, number(input.targetDurationSec) || 15)),
    objective: text(input.objective) || text(contract.sealedPayload?.creative_direction?.primary_kpi) || "Beneficio incremental",
    audience: text(input.audience) || text(contract.sealedPayload?.creative_direction?.audience),
    promise: text(input.promise), payoff: text(input.payoff), call_to_action: text(input.callToAction),
    evidence_plan: input.evidencePlan || {}, beat_map: list(input.beatMap).map((beat, index) => ({
      beat: index + 1, label: text(beat.label), start_sec: number(beat.startSec), end_sec: number(beat.endSec),
      visual: text(beat.visual), audio: text(beat.audio), purpose: text(beat.purpose),
    })),
    loops: list(input.loops).map((loop, index) => ({
      loop_key: text(loop.loopKey) || `L${index + 1}`, question: text(loop.question), open_sec: number(loop.openSec),
      close_sec: number(loop.closeSec), partial_payoff_sec: loop.partialPayoffSec == null ? null : number(loop.partialPayoffSec), payoff: text(loop.payoff),
    })),
    hooks,
  };
}

export function buildAgencyRetentionCenter(db = {}) {
  const scripts = list(db.agencyRetentionScripts).map((script) => ({
    ...script,
    architecture: validateRetentionArchitecture({
      ...script.snapshot, targetDurationSec: script.targetDurationSec,
      beatMap: list(script.snapshot?.beat_map).map((beat) => ({ ...beat, startSec: beat.start_sec, endSec: beat.end_sec })),
      loops: list(script.snapshot?.loops).map((loop) => ({ ...loop, openSec: loop.open_sec, closeSec: loop.close_sec })),
      hooks: list(db.agencyRetentionHooks).filter((hook) => String(hook.scriptId) === String(script.id)),
      callToAction: script.snapshot?.call_to_action,
    }),
  }));
  const approvedContractIds = new Set(list(db.agencyCreativeContracts).filter((item) => item.status === "Aprobado").map((item) => String(item.id)));
  return {
    scripts,
    hooks: list(db.agencyRetentionHooks), loops: list(db.agencyRetentionLoops), experiments: list(db.agencyRetentionExperiments),
    measurements: list(db.agencyRetentionMeasurements),
    eligibleContracts: list(db.agencyCreativeContracts).filter((contract) => approvedContractIds.has(String(contract.id))
      && !scripts.some((script) => String(script.contractId) === String(contract.id) && !["Sustituido", "Anulado"].includes(script.status))),
    pending: scripts.filter((item) => item.status === "En revisión"), approved: scripts.filter((item) => item.status === "Aprobado"),
    summary: {
      drafts: scripts.filter((item) => item.status === "Borrador").length,
      pending: scripts.filter((item) => item.status === "En revisión").length,
      approved: scripts.filter((item) => item.status === "Aprobado").length,
      activeExperiments: list(db.agencyRetentionExperiments).filter((item) => item.status === "Activo").length,
      measurements: list(db.agencyRetentionMeasurements).length,
    },
  };
}
