const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value, digits = 2) => Number(number(value).toFixed(digits));

export const LOOP_LEARNING_VARIABLES = Object.freeze([
  "Hook", "Primer fotograma", "Prueba temprana", "Orden de beats", "Payoff", "CTA", "Oferta",
]);

export function normalizeRetentionCurve(curve = [], durationSec = 0) {
  const duration = number(durationSec);
  const points = list(curve).map((point) => ({ sec: number(point.sec), pct: number(point.pct) }));
  const reasons = [];
  if (points.length < 3) reasons.push("La curva necesita al menos tres puntos temporales.");
  points.forEach((point, index) => {
    if (point.sec < 0 || point.pct < 0 || point.pct > 1) reasons.push(`El punto ${index + 1} está fuera de rango.`);
    if (index > 0 && point.sec <= points[index - 1].sec) reasons.push("Los segundos de la curva deben ser únicos y crecientes.");
    if (index > 0 && point.pct > points[index - 1].pct) reasons.push("La retención acumulada no puede aumentar entre puntos.");
  });
  if (points[0]?.sec !== 0) reasons.push("La curva debe comenzar en el segundo cero.");
  if (duration > 0 && number(points.at(-1)?.sec) < duration) reasons.push("La curva todavía no cubre la duración completa del guion.");
  return { points, ready: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function retentionAt(curve = [], second = 0) {
  const points = list(curve);
  if (points.length === 0) return null;
  const target = Math.max(0, number(second));
  if (target <= number(points[0].sec)) return number(points[0].pct);
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]; const right = points[index];
    if (target <= number(right.sec)) {
      const span = number(right.sec) - number(left.sec);
      if (span <= 0) return number(right.pct);
      const progress = (target - number(left.sec)) / span;
      return round(number(left.pct) + ((number(right.pct) - number(left.pct)) * progress), 6);
    }
  }
  return number(points.at(-1).pct);
}

function observation(label, startSec, endSec, curve, extra = {}) {
  const startPct = retentionAt(curve, startSec); const endPct = retentionAt(curve, endSec);
  const dropPp = round((number(startPct) - number(endPct)) * 100, 1);
  const signal = dropPp < -2 ? "Pico o repetición" : dropPp >= 15 ? "Caída principal" : dropPp >= 5 ? "Caída moderada" : "Sostiene";
  return { label: text(label), startSec: number(startSec), endSec: number(endSec), startPct: round(startPct, 4), endPct: round(endPct, 4), dropPp, signal, ...extra };
}

function variableForBeat(beat = {}, index = 0, total = 1) {
  const haystack = `${text(beat.label)} ${text(beat.purpose)}`.toLowerCase();
  if (/cta|llamado|acción/.test(haystack)) return "CTA";
  if (/payoff|revel|cierre|respuesta/.test(haystack)) return "Payoff";
  if (/prueba|evidencia|demostr/.test(haystack)) return "Prueba temprana";
  if (index === 0 || /hook|apertura|promesa/.test(haystack)) return "Hook";
  if (index === total - 1) return "Payoff";
  return "Orden de beats";
}

export function diagnoseRetentionMeasurement({ measurement = {}, script = {}, loops = [], experiment = {}, hook = {} } = {}) {
  const duration = number(script.targetDurationSec || script.snapshot?.target_duration_sec);
  const curveState = normalizeRetentionCurve(measurement.retentionCurve, duration);
  const sampleSize = number(measurement.sampleSize);
  const reasons = [...curveState.reasons];
  if (sampleSize < 100) reasons.push(`La muestra tiene ${sampleSize}; se requieren al menos 100 observaciones para aprender.`);
  const rawBeats = list(script.snapshot?.beat_map);
  if (rawBeats.length < 3) reasons.push("El guion no conserva al menos tres beats temporales.");

  const beats = rawBeats.map((beat, index) => observation(
    beat.label || `Beat ${index + 1}`, beat.start_sec ?? beat.startSec, beat.end_sec ?? beat.endSec, curveState.points,
    { beat: number(beat.beat) || index + 1, purpose: text(beat.purpose), visual: text(beat.visual) },
  ));
  const loopObservations = list(loops).map((loop) => observation(
    loop.loopKey || "Loop", loop.openSec, loop.closeSec, curveState.points,
    { loopId: loop.id, question: text(loop.question), payoff: text(loop.payoff), kind: "Loop" },
  ));
  const primary = [...beats].sort((a, b) => b.dropPp - a.dropPp)[0] || null;
  const primaryIndex = primary ? beats.findIndex((beat) => beat.beat === primary.beat) : 0;
  const testedVariable = variableForBeat(primary || {}, primaryIndex, beats.length);
  const starts = number(measurement.starts); const impressions = number(measurement.impressions); const clicks = number(measurement.clicks);
  const funnel = {
    startRate: impressions > 0 ? round(starts / impressions, 4) : 0,
    retention3s: starts > 0 ? round(number(measurement.views3s) / starts, 4) : 0,
    completionRate: starts > 0 ? round(number(measurement.views100) / starts, 4) : 0,
    clickRate: starts > 0 ? round(clicks / starts, 4) : 0,
    paidOrderRate: clicks > 0 ? round(number(measurement.paidOrders) / clicks, 4) : 0,
    paidOrders: number(measurement.paidOrders), incrementalProfit: number(measurement.incrementalProfit),
  };
  const scope = {
    platform: text(measurement.platform || script.platform), audience: text(script.audience), durationSec: duration,
    scriptId: script.id, scriptFingerprint: text(script.fingerprint), experimentId: experiment.id,
    experimentFingerprint: text(experiment.fingerprint), hookId: hook.id, hookFingerprint: text(hook.fingerprint),
    publicationFingerprint: text(measurement.publicationFingerprint),
  };
  const primarySignal = primary
    ? `La mayor caída observada coincide con “${primary.label}”: ${primary.dropPp} pp. Es una asociación temporal, no una causa demostrada.`
    : "Todavía no existe cobertura temporal suficiente para localizar una caída.";
  const hypothesis = primary
    ? `Cambiar únicamente ${testedVariable.toLowerCase()} en “${primary.label}” puede reducir su caída sin empeorar pedidos pagados ni beneficio incremental.`
    : "Se necesita una curva completa antes de formular una hipótesis de retención.";
  const recommendation = primary
    ? `Crear una variante que conserve producto, audiencia, oferta, duración y CTA; modificar solo ${testedVariable.toLowerCase()} y comparar la misma ventana de medición.`
    : "Completar la medición exacta antes de proponer otra versión.";
  return {
    ready: reasons.length === 0, reasons: [...new Set(reasons)], measurementId: measurement.id, scriptId: script.id,
    experimentId: experiment.id, hookId: hook.id, sampleSize, confidence: sampleSize >= 500 ? "Alta" : sampleSize >= 200 ? "Media" : "Inicial",
    curve: curveState.points, beats, loops: loopObservations, funnel, scope, primarySignal, testedVariable, hypothesis, recommendation,
    guardrails: { oneVariable: true, sameProduct: true, sameAudience: true, sameOffer: true, sameDuration: true, humanApproval: true, noAutoGeneration: true, noAutoPublication: true },
  };
}

export function loopDiagnosticPayload(diagnostic = {}) {
  if (!diagnostic.ready) throw new Error(diagnostic.reasons?.[0] || "El diagnóstico todavía no está listo.");
  return {
    diagnostic_key: `measurement-${diagnostic.measurementId}-loop-v1`, measurement_id: diagnostic.measurementId,
    tested_variable: diagnostic.testedVariable, hypothesis: diagnostic.hypothesis, recommendation: diagnostic.recommendation,
    guardrails: {
      one_variable: true, same_product: true, same_audience: true, same_offer: true, same_duration: true,
      human_approval: true, no_auto_generation: true, no_auto_publication: true,
    },
  };
}

export function buildAgencyLoopLearningCenter(db = {}) {
  const scripts = list(db.agencyRetentionScripts); const hooks = list(db.agencyRetentionHooks);
  const loops = list(db.agencyRetentionLoops); const experiments = list(db.agencyRetentionExperiments);
  const diagnostics = list(db.agencyRetentionDiagnostics); const learnings = list(db.agencyRetentionLearnings);
  const candidates = list(db.agencyRetentionMeasurements).map((measurement) => {
    const experiment = experiments.find((item) => String(item.id) === String(measurement.experimentId)) || {};
    const script = scripts.find((item) => String(item.id) === String(experiment.scriptId)) || {};
    const hook = hooks.find((item) => String(item.id) === String(measurement.hookId)) || {};
    return diagnoseRetentionMeasurement({ measurement, experiment, script, hook, loops: loops.filter((item) => String(item.scriptId) === String(script.id)) });
  }).filter((item) => !diagnostics.some((diagnostic) => String(diagnostic.measurementId) === String(item.measurementId)));
  return {
    candidates, diagnostics, learnings, pending: diagnostics.filter((item) => item.status === "En revisión"),
    approved: diagnostics.filter((item) => item.status === "Aprobado"),
    summary: { ready: candidates.filter((item) => item.ready).length, pending: diagnostics.filter((item) => item.status === "En revisión").length, learnings: learnings.length },
  };
}
