import { useEffect, useMemo, useRef, useState } from "react";
import {
  completarEtapaPedido,
  crearCorrida,
  desmoldarLote,
  empezarCongelamiento,
  producirSubreceta,
  setOrderStatusRemoto,
} from "../../lib/rpc";
import {
  combineKitchenVoiceAlternatives,
  kitchenConversationPrompt,
  kitchenOrderAlert,
  kitchenOrderLookupAnswer,
  kitchenOrderQueueAnswer,
  kitchenOrderStateEvents,
  kitchenRecognitionWatchdogMs,
  kitchenSpeechTimeoutMs,
  kitchenTaskVocabularyPhrases,
  kitchenVoiceControl,
  kitchenVoicePauseMs,
  kitchenVocabularyPhrases,
  mergeKitchenConversation,
  normalizeKitchenDelaySettings,
  parseKitchenVoice,
  selectKitchenVoiceAlternative,
  selectKitchenVoiceControl,
  splitKitchenVoiceClosure,
  splitKitchenWakeWord,
} from "../../lib/kitchen-voice";
import { orderTransitionPermission } from "../../lib/order-workflow";
import { explainOperationalError } from "../../lib/operational-errors";
import { momobotContextAnswer, momobotContextSnapshot } from "../../lib/momobot-context";
import { businessDateISO } from "../../lib/business-date";
import { canonicalUsableIngredientStock, canonicalVariantsForAvailability } from "../../lib/canonical-stock";
import {
  canAutoStartMomobot,
  isCurrentMomobotAuthorization,
  momobotModeAfterExecution,
  momobotModeAfterReadOnly,
} from "../../lib/momobot-session";

const VOICE_KITCHEN_EXAMPLE = "Se está preparando 200 gramos de ganache, ingrésalos. Se van a producir 20 Lizis: 3 de limón, 4 de coco, 3 de banano, 5 de Oreo y 5 de Milo. Van a ingresar a congelación, empieza cronómetro.";
const VOICE_PHRASE_BIAS_KEY = "momos-voice-native-phrases";

function nativeVoicePhraseBiasEnabled() {
  try { return window.localStorage.getItem(VOICE_PHRASE_BIAS_KEY) !== "unsupported"; }
  catch { return true; }
}

function rememberUnsupportedVoicePhrases(ref) {
  ref.current = false;
  try { window.localStorage.setItem(VOICE_PHRASE_BIAS_KEY, "unsupported"); } catch { /* el corrector local sigue activo */ }
}

function voiceCommandKey() {
  try { if (crypto && crypto.randomUUID) return "voice-" + crypto.randomUUID(); } catch { /* fallback abajo */ }
  return "voice-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function voiceOutcomeCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function voiceOrderItems(madeToOrder) {
  const items = madeToOrder?.items?.length
    ? madeToOrder.items
    : [{ quantity: madeToOrder?.quantity || 0, productName: madeToOrder?.productName || "producto" }];
  return items.map((item) => `${item.quantity} × ${item.productName}`).join("; ");
}

function voiceSummary(draft) {
  const parts = [];
  const preparations = draft.preparations?.length ? draft.preparations : (draft.preparation ? [draft.preparation] : []);
  preparations.forEach((preparation) => parts.push(`preparar ${preparation.nominalGrams} gramos de ${preparation.subrecipeName}${preparation.usage ? `, ${preparation.usage.toLowerCase()}` : ""}`));
  const productions = draft.productions?.length ? draft.productions : (draft.production ? [draft.production] : []);
  productions.forEach((production) => parts.push(`producir ${production.calculatedTotal} ${production.figure}: ${production.runs.map((run) => `${run.quantity} de ${run.flavor}`).join(", ")}`));
  if (draft.madeToOrder) parts.push(`iniciar el pedido ${draft.madeToOrder.orderId}${draft.madeToOrder.customerName ? ` de ${draft.madeToOrder.customerName}` : ""}. La comanda contiene ${draft.madeToOrder.orderContent || voiceOrderItems(draft.madeToOrder)}`);
  if (draft.orderHandoff) parts.push(`marcar el pedido ${draft.orderHandoff.orderId}${draft.orderHandoff.customerName ? ` de ${draft.orderHandoff.customerName}` : ""} como Listo para empaque`);
  if (draft.unmolding) parts.push(`desmoldar el lote ${draft.unmolding.batchId}: ${voiceOutcomeCount(draft.unmolding.perfectas, "perfecta", "perfectas")}, ${voiceOutcomeCount(draft.unmolding.imperfectas, "imperfecta", "imperfectas")} y ${voiceOutcomeCount(draft.unmolding.descartadas, "descartada", "descartadas")}`);
  if (draft.freezeBatchIds?.length) parts.push(`iniciar la congelación de ${draft.freezeBatchIds.length === 1 ? `el lote ${draft.freezeBatchIds[0]}` : `los lotes ${draft.freezeBatchIds.join(", ")}`}`);
  else if (draft.startFreezing) parts.push("iniciar la congelación de los lotes nuevos");
  return "Entendí: " + parts.join("; ") + ". ¿Está correcto?";
}

export default function VoiceKitchenPanel({ db, perfil, flavors, figures, subrecipes, refrescar, serverDataReady, requestedOrder, onReady, ui }) {
  const { T, Card, Btn, BtnAsync, inputCls, inputStyle, toast, vibrar } = ui;
  useEffect(() => {
    if (!requestedOrder) return undefined;
    const frame = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(frame);
    // El callback solo sincroniza el scroll con el pedido que abrió Momobot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedOrder]);
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [draft, setDraft] = useState(null);
  const [result, setResult] = useState(null);
  const [replyByVoice, setReplyByVoice] = useState(true);
  const [executionLabel, setExecutionLabel] = useState("Ejecutando…");
  const [executed, setExecuted] = useState(false);
  const [voiceMode, setVoiceMode] = useState("idle");
  const [voiceActivity, setVoiceActivity] = useState("idle");
  const [conversation, setConversation] = useState([]);
  const recognitionRef = useRef(null);
  const recognitionSessionRef = useRef({ active: false, mode: "dictation", baseText: "", currentText: "", starting: false, restartTimer: null, turnTimer: null, watchdogTimer: null, activityTimer: null, restartDelay: 180, failures: 0, generation: 0, attempt: 0 });
  const transcriptRef = useRef("");
  const draftRef = useRef(null);
  const executedRef = useRef(false);
  const executingRef = useRef(false);
  const conversationContextRef = useRef("");
  const conversationTurnsRef = useRef(0);
  const readOnlyTurnsRef = useRef(0);
  const assistantMemoryRef = useRef({ lastTopic: "", lastOrderId: null, lastBatchId: null });
  const speechTokenRef = useRef(0);
  const speechSafetyTimerRef = useRef(null);
  const speechInProgressRef = useRef(false);
  const handsFreeCommandRef = useRef(false);
  const authorizationAttemptRef = useRef(0);
  const knownOrderStatesRef = useRef(new Map((db.orders || []).filter((order) => order?.id).map((order) => [order.id, order.estado || ""])));
  const orderAlertsReadyRef = useRef(false);
  const orderAlertQueueRef = useRef([]);
  const orderAlertSpeakingRef = useRef(false);
  const flushOrderAlertsRef = useRef(null);
  const phraseBiasSupportedRef = useRef(nativeVoicePhraseBiasEnabled());
  const beginRecognitionRef = useRef(null);
  const startVoiceSessionRef = useRef(null);
  const finishDictationRef = useRef(null);
  const handleWakeWordRef = useRef(null);
  const handleVoiceControlRef = useRef(null);
  const handleConversationReplyRef = useRef(null);
  const interpretTranscriptRef = useRef(null);
  const executeCommandRef = useRef(null);
  const commandKeyRef = useRef(null);
  const progressRef = useRef({ bases: new Set(), runs: new Set(), batchIds: [], frozen: new Set(), unmolded: new Set(), orders: new Set(), ordersReady: new Set() });
  const SpeechRecognitionApi = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const voiceInputAvailable = Boolean(
    SpeechRecognitionApi
    && typeof navigator !== "undefined"
    && navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function",
  );
  const voiceCatalogs = useMemo(() => {
    const today = businessDateISO();
    const canonicalInventory = (db.inventory_items || []).map((item) => ({
      ...item,
      stock: canonicalUsableIngredientStock(db, item.id, { today }).usable,
    }));
    return ({
    flavors,
    figures,
    subrecipes,
    figureFillings: db.figura_relleno || [],
    products: db.products || [],
    inventory: canonicalInventory,
    inventoryLots: db.inventory_lots || [],
    batches: db.production_batches || [],
    orders: db.orders || [],
    orderItems: db.order_items || [],
    customers: db.customers || [],
    variants: canonicalVariantsForAvailability(db, { today }),
    suggestions: db.production_suggestions || [],
    reservations: db.inventory_reservations || [],
    auditLogs: db.audit_logs || [],
    delaySettings: normalizeKitchenDelaySettings(db.settings || {}),
    extras: [
      ...(db.settings.salsas || []),
      ...(db.settings.rellenos || []),
      ...(db.settings.toppings || []).map((item) => item?.nombre || item).filter(Boolean),
    ],
    });
  }, [db, flavors, figures, subrecipes]);
  const voicePhrases = useMemo(() => kitchenVocabularyPhrases(voiceCatalogs), [voiceCatalogs]);
  const voiceTaskPhrases = useMemo(() => new Set(kitchenTaskVocabularyPhrases()), []);
  const contextSnapshot = useMemo(() => momobotContextSnapshot(voiceCatalogs), [voiceCatalogs]);

  useEffect(() => () => {
    const session = recognitionSessionRef.current;
    session.active = false;
    session.generation += 1;
    if (session.restartTimer) clearTimeout(session.restartTimer);
    if (session.turnTimer) clearTimeout(session.turnTimer);
    if (session.watchdogTimer) clearTimeout(session.watchdogTimer);
    if (session.activityTimer) clearTimeout(session.activityTimer);
    try { recognitionRef.current?.abort(); } catch { /* nada que limpiar */ }
    speechTokenRef.current += 1;
    authorizationAttemptRef.current += 1;
    speechInProgressRef.current = false;
    if (speechSafetyTimerRef.current) clearTimeout(speechSafetyTimerRef.current);
    speechSafetyTimerRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* degradación silenciosa */ }
  }, []);

  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!requestedOrder?.orderId) return undefined;
    setAbierto(true);
    const command = `Preparar el pedido ${requestedOrder.orderId}`;
    stopVoiceSession({ abort: true, nextMode: "idle" });
    cancelSpeech();
    changeTranscript(command);
    const timer = setTimeout(() => interpretTranscriptRef.current?.(command), 60);
    return () => clearTimeout(timer);
  }, [requestedOrder?.token]);

  useEffect(() => {
    if (!voiceInputAvailable) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (!navigator.permissions?.query) {
          if (!cancelled) setSpeechError("Tocá “Activar Momobot” una vez para autorizar el micrófono.");
          return;
        }
        const permission = await navigator.permissions.query({ name: "microphone" });
        if (cancelled) return;
        if (canAutoStartMomobot({
          permissionState: permission.state,
          sessionActive: recognitionSessionRef.current.active,
          speechInProgress: speechInProgressRef.current,
          hasDraft: Boolean(draftRef.current),
          authorizing: recognitionSessionRef.current.starting,
        })) startVoiceSessionRef.current?.("standby");
        else if (permission.state === "denied") setSpeechError("El micrófono está bloqueado. Permitilo en el candado de la barra de direcciones y tocá “Activar Momobot”.");
        else setSpeechError("Tocá “Activar Momobot” una vez para conceder el micrófono.");
      } catch {
        if (!cancelled) setSpeechError("Tocá “Activar Momobot” una vez para autorizar el micrófono.");
      }
    }, 420);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [voiceInputAvailable]);

  useEffect(() => {
    const orders = db.orders || [];
    if (!serverDataReady || !orderAlertsReadyRef.current) {
      knownOrderStatesRef.current = new Map(orders.filter((order) => order?.id).map((order) => [order.id, order.estado || ""]));
      if (serverDataReady) orderAlertsReadyRef.current = true;
      return;
    }
    const detected = kitchenOrderStateEvents(orders, knownOrderStatesRef.current);
    knownOrderStatesRef.current = detected.nextStates;
    detected.events.slice().reverse().forEach(({ order, type }) => {
      const alert = kitchenOrderAlert(order, {
        customers: db.customers || [],
        products: db.products || [],
        orderItems: db.order_items || [],
      }, { eventType: type });
      if (!alert) return;
      const enriched = {
        ...alert,
        detectedAt: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
      };
      orderAlertQueueRef.current.push(enriched);
    });
    flushOrderAlertsRef.current?.();
  }, [serverDataReady, db.orders, db.order_items, db.customers, db.products]);

  useEffect(() => {
    flushOrderAlertsRef.current?.();
  }, [voiceMode, listening, replyByVoice]);

  function cancelSpeech() {
    speechTokenRef.current += 1;
    speechInProgressRef.current = false;
    if (speechSafetyTimerRef.current) clearTimeout(speechSafetyTimerRef.current);
    speechSafetyTimerRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* degradación silenciosa */ }
  }

  function speak(text, onDone) {
    const done = typeof onDone === "function" ? onDone : null;
    if (!replyByVoice || !text || typeof window === "undefined" || !("speechSynthesis" in window)) {
      done?.();
      return;
    }
    try {
      cancelSpeech();
      const token = speechTokenRef.current;
      const utterance = new SpeechSynthesisUtterance(text);
      let finished = false;
      let safetyTimer = null;
      speechInProgressRef.current = true;
      const finish = () => {
        if (finished) return;
        finished = true;
        speechInProgressRef.current = false;
        if (safetyTimer) clearTimeout(safetyTimer);
        if (speechSafetyTimerRef.current === safetyTimer) speechSafetyTimerRef.current = null;
        if (token !== speechTokenRef.current) return;
        done?.();
        setTimeout(() => flushOrderAlertsRef.current?.(), 0);
      };
      utterance.lang = "es-CO";
      utterance.rate = 0.98;
      utterance.onend = finish;
      utterance.onerror = finish;
      safetyTimer = setTimeout(() => {
        try { window.speechSynthesis.cancel(); } catch { /* el callback igual libera la escucha */ }
        finish();
      }, kitchenSpeechTimeoutMs(text));
      speechSafetyTimerRef.current = safetyTimer;
      window.speechSynthesis.speak(utterance);
    } catch {
      speechInProgressRef.current = false;
      if (speechSafetyTimerRef.current) clearTimeout(speechSafetyTimerRef.current);
      speechSafetyTimerRef.current = null;
      done?.();
      setTimeout(() => flushOrderAlertsRef.current?.(), 0);
    }
  }

  function flushOrderAlerts() {
    if (orderAlertSpeakingRef.current || speechInProgressRef.current || !orderAlertQueueRef.current.length) return;
    const session = recognitionSessionRef.current;
    const inConversation = session.active && session.mode !== "standby";
    const busy = inConversation || ["authorizing", "processing", "executing"].includes(voiceMode);
    if (busy) return;
    const alert = orderAlertQueueRef.current.shift();
    if (!alert) return;
    const resumeStandby = session.active && session.mode === "standby";
    if (resumeStandby) stopVoiceSession({ abort: true, nextMode: "idle" });
    orderAlertSpeakingRef.current = true;
    speak(alert.text, () => {
      orderAlertSpeakingRef.current = false;
      if (resumeStandby) startVoiceSession("standby");
      setTimeout(() => flushOrderAlertsRef.current?.(), 250);
    });
  }

  function addConversationMessage(role, text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    setConversation((current) => [...current, { id: voiceCommandKey(), role, text: clean }].slice(-8));
  }

  function resetVoiceDraft({ keepConversation = false } = {}) {
    setDraft(null);
    draftRef.current = null;
    setResult(null);
    setExecuted(false);
    executedRef.current = false;
    commandKeyRef.current = null;
    progressRef.current = { bases: new Set(), runs: new Set(), batchIds: [], frozen: new Set(), unmolded: new Set(), orders: new Set(), ordersReady: new Set() };
    conversationContextRef.current = "";
    conversationTurnsRef.current = 0;
    handsFreeCommandRef.current = false;
    if (!keepConversation) {
      readOnlyTurnsRef.current = 0;
      setConversation([]);
    }
  }

  function changeTranscript(value, { keepConversation = false } = {}) {
    if (recognitionSessionRef.current.active && recognitionSessionRef.current.mode === "standby") stopVoiceSession();
    const nextValue = String(value || "");
    setTranscript(nextValue);
    transcriptRef.current = nextValue;
    resetVoiceDraft({ keepConversation });
  }

  function stopVoiceSession({ abort = false, nextMode = "idle" } = {}) {
    authorizationAttemptRef.current += 1;
    const session = recognitionSessionRef.current;
    session.active = false;
    session.starting = false;
    session.generation += 1;
    if (session.restartTimer) clearTimeout(session.restartTimer);
    if (session.turnTimer) clearTimeout(session.turnTimer);
    if (session.watchdogTimer) clearTimeout(session.watchdogTimer);
    if (session.activityTimer) clearTimeout(session.activityTimer);
    session.restartTimer = null;
    session.turnTimer = null;
    session.watchdogTimer = null;
    session.activityTimer = null;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try { if (abort) recognition?.abort(); else recognition?.stop(); } catch { /* ya estaba detenida */ }
    setListening(false);
    setVoiceMode(nextMode);
    setVoiceActivity("idle");
  }

  function markVoiceActivity(session, generation, activity) {
    if (!session.active || session.generation !== generation) return;
    if (session.activityTimer) clearTimeout(session.activityTimer);
    setVoiceActivity(activity);
    if (activity === "hearing" || activity === "wake") {
      session.activityTimer = setTimeout(() => {
        if (session.active && session.generation === generation) setVoiceActivity("listening");
      }, activity === "wake" ? kitchenVoicePauseMs("standby") + 250 : 1100);
    }
  }

  function preserveCurrentDictation(session) {
    if (session.mode !== "dictation" || !session.currentText) return;
    session.baseText = [session.baseText, session.currentText].filter(Boolean).join(" ").trim();
    session.currentText = "";
    transcriptRef.current = session.baseText;
    setTranscript(session.baseText);
  }

  function queueRecognitionRestart(session, generation, { delay = 180, abort = true, message = "" } = {}) {
    if (!session.active || session.generation !== generation) return;
    preserveCurrentDictation(session);
    if (session.restartTimer) clearTimeout(session.restartTimer);
    if (session.watchdogTimer) clearTimeout(session.watchdogTimer);
    session.watchdogTimer = null;
    session.starting = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setListening(true);
    setVoiceMode(session.mode);
    setVoiceActivity("recovering");
    if (message) setSpeechError(message);
    session.restartTimer = setTimeout(() => {
      session.restartTimer = null;
      if (!session.active || session.generation !== generation) return;
      setVoiceActivity("starting");
      beginRecognitionRef.current?.();
    }, delay);
    if (abort) {
      try { recognition?.abort(); } catch { /* el reinicio vigilado continúa */ }
    }
  }

  function armRecognitionWatchdog(session, generation, attempt, recognition, phase) {
    if (session.watchdogTimer) clearTimeout(session.watchdogTimer);
    session.watchdogTimer = setTimeout(() => {
      if (!session.active || session.generation !== generation || session.attempt !== attempt || recognitionRef.current !== recognition) return;
      queueRecognitionRestart(session, generation, {
        delay: 220,
      });
    }, kitchenRecognitionWatchdogMs(phase));
  }

  async function authorizeAndStartVoiceSession(mode, options = {}) {
    if (!voiceInputAvailable) {
      setVoiceMode("idle");
      setListening(false);
      setSpeechError("Este navegador no permite usar el micrófono con Momobot. Abrí MOMOS OPS en Chrome o Edge.");
      return;
    }
    stopVoiceSession({ abort: true, nextMode: "authorizing" });
    const authorizationAttempt = authorizationAttemptRef.current;
    cancelSpeech();
    setSpeechError("Esperando autorización del micrófono…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (!isCurrentMomobotAuthorization(authorizationAttempt, authorizationAttemptRef.current)) return;
      setSpeechError("");
      startVoiceSession(mode, options);
    } catch (error) {
      if (!isCurrentMomobotAuthorization(authorizationAttempt, authorizationAttemptRef.current)) return;
      setVoiceMode("idle");
      setListening(false);
      const blocked = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      setSpeechError(blocked
        ? "El micrófono quedó bloqueado. Permitilo en el candado de la barra de direcciones y volvé a tocar “Activar Momobot”."
        : "No pude abrir el micrófono. Revisá que esté conectado y que ninguna otra aplicación lo esté usando.");
    }
  }

  function startVoiceSession(mode, { clearDictation = false } = {}) {
    if (!voiceInputAvailable) {
      setSpeechError("Este navegador no permite usar el micrófono con Momobot. Abrí MOMOS OPS en Chrome o Edge.");
      setVoiceMode("idle");
      return;
    }
    cancelSpeech();
    stopVoiceSession({ abort: true, nextMode: mode });
    if (clearDictation) changeTranscript("");
    const session = recognitionSessionRef.current;
    session.active = true;
    session.mode = mode;
    session.baseText = mode === "dictation" && !clearDictation ? transcriptRef.current.trim() : "";
    session.currentText = "";
    session.failures = 0;
    session.restartDelay = 180;
    if (session.turnTimer) clearTimeout(session.turnTimer);
    session.turnTimer = null;
    session.generation += 1;
    setVoiceMode(mode);
    setListening(true);
    setVoiceActivity("starting");
    setSpeechError("");
    session.restartTimer = setTimeout(() => beginRecognitionRef.current?.(), 80);
  }

  function processActionAlternatives(alternatives) {
    const readOnlyAlternative = alternatives.find((alternative) => kitchenOrderLookupAnswer(alternative?.transcript, voiceCatalogs) || kitchenOrderQueueAnswer(alternative?.transcript, voiceCatalogs));
    if (readOnlyAlternative) {
      interpretTranscriptRef.current?.(readOnlyAlternative.transcript, { handsFree: true, continuation: true, spokenText: readOnlyAlternative.transcript });
      return;
    }
    const controlSelection = selectKitchenVoiceControl(alternatives);
    const heard = controlSelection.transcript || selectKitchenVoiceAlternative(alternatives, voiceCatalogs).transcript;
    const control = controlSelection.control;
    if (controlSelection.ambiguous) {
      setSpeechError("Escuché dos órdenes posibles. Repetí solo confirmar, editar o cancelar.");
      return;
    }
    if (control) {
      handleVoiceControlRef.current?.(control);
      return;
    }
    handleConversationReplyRef.current?.(heard);
  }

  function processFollowupAlternatives(alternatives) {
    const readOnlyAlternative = alternatives.find((alternative) => kitchenOrderLookupAnswer(alternative?.transcript, voiceCatalogs) || kitchenOrderQueueAnswer(alternative?.transcript, voiceCatalogs));
    if (readOnlyAlternative) {
      interpretTranscriptRef.current?.(readOnlyAlternative.transcript, { handsFree: true, continuation: true, spokenText: readOnlyAlternative.transcript });
      return;
    }
    const controlSelection = selectKitchenVoiceControl(alternatives);
    const heard = controlSelection.transcript || selectKitchenVoiceAlternative(alternatives, voiceCatalogs).transcript;
    const control = controlSelection.control;
    if (controlSelection.ambiguous) {
      setSpeechError("Escuché dos órdenes posibles. Repetí una sola respuesta.");
      return;
    }
    if (control) handleVoiceControlRef.current?.(control);
    else handleConversationReplyRef.current?.(heard);
  }

  function recognitionEventAlternatives(event) {
    const groups = [];
    for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
      const alternatives = [];
      for (let j = 0; j < event.results[i].length; j += 1) {
        alternatives.push({ transcript: event.results[i][j].transcript, confidence: event.results[i][j].confidence });
      }
      if (alternatives.length) groups.push(alternatives);
    }
    return combineKitchenVoiceAlternatives(groups);
  }

  function beginRecognition() {
    const session = recognitionSessionRef.current;
    if (!session.active || session.starting || recognitionRef.current || !SpeechRecognitionApi) return;
    const generation = session.generation;
    session.attempt += 1;
    const attempt = session.attempt;
    session.starting = true;
    try {
      const recognition = new SpeechRecognitionApi();
      recognition.lang = "es-CO";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 5;
      try {
        const Phrase = window.SpeechRecognitionPhrase || window.webkitSpeechRecognitionPhrase;
        if (phraseBiasSupportedRef.current && Phrase && "phrases" in recognition) {
          recognition.phrases = voicePhrases.slice(0, 300).map((phrase) => new Phrase(phrase, phrase === "Momobot" || voiceTaskPhrases.has(phrase) ? 10 : 8));
        }
      } catch { rememberUnsupportedVoicePhrases(phraseBiasSupportedRef); }
      recognition.onstart = () => {
        if (recognitionSessionRef.current.generation !== generation || session.attempt !== attempt) return;
        session.starting = false;
        session.failures = 0;
        setListening(true);
        setVoiceActivity("listening");
        setSpeechError("");
        armRecognitionWatchdog(session, generation, attempt, recognition, "listening");
        vibrar("tap");
      };
      const noteAudioActivity = () => {
        if (!session.active || session.generation !== generation || session.attempt !== attempt) return;
        markVoiceActivity(session, generation, "hearing");
        armRecognitionWatchdog(session, generation, attempt, recognition, "listening");
      };
      recognition.onaudiostart = noteAudioActivity;
      recognition.onsoundstart = noteAudioActivity;
      recognition.onspeechstart = noteAudioActivity;
      recognition.onresult = (event) => {
        if (!session.active || session.generation !== generation || session.attempt !== attempt) return;
        session.failures = 0;
        session.restartDelay = 180;
        if (session.turnTimer) clearTimeout(session.turnTimer);
        session.turnTimer = null;
        markVoiceActivity(session, generation, "hearing");
        armRecognitionWatchdog(session, generation, attempt, recognition, "listening");
        if (session.mode === "standby") {
          let pendingWake = null;
          let lastHeard = "";
          let heardFinalWithoutWake = false;
          for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
            const alternatives = [];
            for (let j = 0; j < event.results[i].length; j += 1) {
              alternatives.push({ transcript: event.results[i][j].transcript, confidence: event.results[i][j].confidence });
            }
            const wakeAlternative = alternatives.find((alternative) => splitKitchenWakeWord(alternative.transcript).woke);
            const heard = wakeAlternative?.transcript || selectKitchenVoiceAlternative(alternatives, voiceCatalogs).transcript;
            const wake = splitKitchenWakeWord(heard);
            lastHeard = heard || lastHeard;
            if (wake.woke) {
              if (event.results[i].isFinal) {
                handleWakeWordRef.current?.(wake.text);
                return;
              }
              pendingWake = wake.text;
              markVoiceActivity(session, generation, "wake");
              setSpeechError("Te oigo. Terminá la frase y hacé una pausa.");
            }
            if (event.results[i].isFinal) {
              const standbySelection = selectKitchenVoiceControl(alternatives);
              const standbyControl = standbySelection.control;
              if (standbySelection.ambiguous) {
                setSpeechError("Escuché dos controles posibles. Repetí solo editar, limpiar o cancelar.");
                return;
              }
              if (standbyControl === "close") {
                handleVoiceControlRef.current?.("close");
                return;
              }
              const hasPendingDraft = Boolean(draftRef.current && !executedRef.current);
              if (hasPendingDraft && ["edit", "cancel", "repeat", "new"].includes(standbyControl)) {
                handleVoiceControlRef.current?.(standbyControl);
                return;
              }
              if (hasPendingDraft && !standbyControl && heard) {
                handleConversationReplyRef.current?.(heard);
                return;
              }
            }
            if (event.results[i].isFinal && !wake.woke) heardFinalWithoutWake = true;
          }
          if (pendingWake !== null) {
            session.turnTimer = setTimeout(() => {
              if (session.active && session.generation === generation && session.mode === "standby") handleWakeWordRef.current?.(pendingWake);
            }, kitchenVoicePauseMs("standby"));
          } else if (heardFinalWithoutWake && lastHeard) {
            setSpeechError(`Sí te oí: “${lastHeard}”. Para abrir un turno, empezá diciendo Momobot.`);
          }
          return;
        }
        if (session.mode === "action") {
          const alternatives = recognitionEventAlternatives(event);
          const lastResult = event.results[event.results.length - 1];
          if (lastResult?.isFinal) {
            processActionAlternatives(alternatives);
            return;
          }
          if (alternatives.length) {
            session.turnTimer = setTimeout(() => processActionAlternatives(alternatives), kitchenVoicePauseMs("action"));
          }
          return;
        }
        if (session.mode === "followup") {
          const alternatives = recognitionEventAlternatives(event);
          const lastResult = event.results[event.results.length - 1];
          if (lastResult?.isFinal) {
            processFollowupAlternatives(alternatives);
            return;
          }
          if (alternatives.length) {
            session.turnTimer = setTimeout(() => processFollowupAlternatives(alternatives), kitchenVoicePauseMs("followup"));
          }
          return;
        }

        setSpeechError("");
        const parts = [];
        for (let i = 0; i < event.results.length; i += 1) {
          const alternatives = [];
          for (let j = 0; j < event.results[i].length; j += 1) {
            alternatives.push({ transcript: event.results[i][j].transcript, confidence: event.results[i][j].confidence });
          }
          const readOnlyAlternative = alternatives.find((alternative) => kitchenOrderLookupAnswer(alternative?.transcript, voiceCatalogs) || kitchenOrderQueueAnswer(alternative?.transcript, voiceCatalogs));
          parts.push(readOnlyAlternative?.transcript || selectKitchenVoiceAlternative(alternatives, voiceCatalogs).transcript);
        }
        session.currentText = parts.join(" ").trim();
        const fullText = [session.baseText, session.currentText].filter(Boolean).join(" ").trim();
        transcriptRef.current = fullText;
        setTranscript(fullText);
        const lastResult = event.results[event.results.length - 1];
        const closure = splitKitchenVoiceClosure(fullText);
        if (lastResult?.isFinal && closure.closed) finishDictationRef.current?.(closure.text);
        else if (fullText) {
          session.turnTimer = setTimeout(() => finishDictationRef.current?.(fullText), kitchenVoicePauseMs("dictation", Boolean(lastResult?.isFinal)));
        }
      };
      recognition.onerror = (event) => {
        if (session.generation !== generation || session.attempt !== attempt) return;
        session.starting = false;
        const errorCode = event.error || "unknown";
        if (errorCode === "aborted" && session.active) {
          if (!session.restartTimer) queueRecognitionRestart(session, generation, { delay: 180, abort: false });
          return;
        }
        if (errorCode === "no-speech" && session.active) {
          const message = session.mode === "standby"
            ? "Momobot sigue atenta. Estoy renovando la escucha para que no se congele."
            : session.mode === "followup"
              ? "No escuché tu respuesta todavía. Momobot sigue atento."
              : session.mode === "action"
                ? "Sigo esperando tu confirmación o corrección."
                : "Sigo escuchando. Termino el turno cuando hagas una pausa.";
          queueRecognitionRestart(session, generation, { delay: 180, message });
          return;
        }
        if (errorCode === "phrases-not-supported" && session.active) {
          rememberUnsupportedVoicePhrases(phraseBiasSupportedRef);
          queueRecognitionRestart(session, generation, {
            delay: 180,
            message: "Este navegador no admite el refuerzo nativo de frases. Momobot continúa con el corrector de vocabulario MOMOS.",
          });
          return;
        }
        if (errorCode === "network" && session.active) {
          session.failures = Math.min(session.failures + 1, 6);
          queueRecognitionRestart(session, generation, {
            delay: Math.min(2400, 350 * session.failures),
            message: "Momobot perdió por un instante el servicio de voz. Sigue reconectando automáticamente…",
          });
          return;
        }
        session.active = false;
        setListening(false);
        setVoiceMode("idle");
        setVoiceActivity("idle");
        const friendly = errorCode === "not-allowed" || errorCode === "service-not-allowed" ? "Para activar Momobot, permití el micrófono y tocá “Activar Momobot” una vez."
          : errorCode === "audio-capture" ? "No encuentro un micrófono disponible. Revisá que esté conectado y permitido."
          : session.mode === "standby" ? `Momobot no pudo quedar en espera (código: ${errorCode}). Tocá “Activar Momobot” para reintentar.`
          : `Se interrumpió el reconocimiento de voz (código: ${errorCode}). Tocá el micrófono para retomarlo.`;
        setSpeechError(friendly);
      };
      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        if (session.generation !== generation || session.attempt !== attempt) return;
        session.starting = false;
        if (!session.active) { setListening(false); return; }
        if (session.restartTimer) return;
        const delay = session.restartDelay || 180;
        session.restartDelay = 180;
        queueRecognitionRestart(session, generation, { delay, abort: false });
      };
      recognitionRef.current = recognition;
      recognition.start();
      armRecognitionWatchdog(session, generation, attempt, recognition, "starting");
    } catch (e) {
      session.starting = false;
      recognitionRef.current = null;
      if (session.active && session.generation === generation && session.attempt === attempt && session.failures < 6) {
        session.failures += 1;
        queueRecognitionRestart(session, generation, {
          delay: Math.min(2400, 350 * session.failures),
          abort: false,
          message: `Momobot está reabriendo el micrófono (${session.failures}/6)…`,
        });
        return;
      }
      session.active = false;
      setListening(false);
      setVoiceMode("idle");
      setVoiceActivity("idle");
      setSpeechError("No pude mantener activo el reconocimiento: " + (e?.message || "error del navegador") + ".");
    }
  }

  function finishDictation(value) {
    const cleanText = String(value || "").trim();
    stopVoiceSession({ nextMode: "processing" });
    if (!cleanText) {
      setSpeechError("");
      setVoiceMode("idle");
      speak("Micrófono cerrado. No registré ninguna acción nueva.");
      return;
    }
    transcriptRef.current = cleanText;
    setTranscript(cleanText);
    setTimeout(() => interpretTranscriptRef.current?.(cleanText, { handsFree: true }), 120);
  }

  function handleWakeWord(remainder) {
    stopVoiceSession({ nextMode: "dictation" });
    readOnlyTurnsRef.current = 0;
    setSpeechError("");
    vibrar("tap");
    const closure = splitKitchenVoiceClosure(remainder);
    const control = kitchenVoiceControl(closure.text);
    if (control) {
      handleVoiceControlRef.current?.(control);
      return;
    }
    changeTranscript(closure.text);
    if (closure.text) {
      finishDictation(closure.text);
      return;
    }
    speak("Te oigo, empecemos.", () => startVoiceSession("dictation", { clearDictation: true }));
  }

  function resumeMomobotStandby() {
    if (voiceInputAvailable) startVoiceSession("standby");
  }

  function continueMomobotAfterExecution() {
    setDraft(null);
    draftRef.current = null;
    setExecuted(false);
    executedRef.current = false;
    commandKeyRef.current = null;
    progressRef.current = { bases: new Set(), runs: new Set(), batchIds: [], frozen: new Set(), unmolded: new Set(), orders: new Set(), ordersReady: new Set() };
    conversationContextRef.current = "";
    conversationTurnsRef.current = 0;
    readOnlyTurnsRef.current = 0;
    setTranscript("");
    transcriptRef.current = "";
    startVoiceSession("dictation");
  }

  function handleVoiceControl(control) {
    const currentDraft = draftRef.current;
    stopVoiceSession({ nextMode: control === "confirm" ? "executing" : "idle" });
    setSpeechError("");
    if (control === "confirm") {
      if (executingRef.current) {
        speak("Ya estoy registrando este comando. Esperá un momento.");
        return;
      }
      if (!currentDraft?.canExecute || executedRef.current) {
        speak(executedRef.current ? "Este comando ya fue aplicado." : "Todavía no puedo confirmar. Decí editar para dictar el comando nuevamente.", () => {
          if (!executedRef.current) startVoiceSession("action");
        });
        return;
      }
      executeCommandRef.current?.();
      return;
    }
    if (control === "edit" || control === "new") {
      changeTranscript("");
      speak("Listo, corrijámoslo. Contame nuevamente la tarea con tus palabras; termino el turno cuando hagas una pausa.", () => startVoiceSession("dictation"));
      return;
    }
    if (control === "repeat") {
      const prompt = currentDraft ? kitchenConversationPrompt(currentDraft, voiceCatalogs) : null;
      const summary = currentDraft?.canExecute
        ? voiceSummary(currentDraft) + " Podés decir sí, editar o cancelar."
        : prompt?.text || "Todavía no tengo una tarea para resumir.";
      speak(summary, () => startVoiceSession(currentDraft?.canExecute || !prompt?.recoverable ? "action" : "followup"));
      return;
    }
    if (control === "cancel") {
      changeTranscript("");
      speak("Comando cancelado. No registré nada. Momobot queda en espera.", resumeMomobotStandby);
      return;
    }
    if (control === "close") speak("Micrófono cerrado. El borrador sigue sin registrar.");
  }

  function handleConversationReply(reply) {
    const heard = String(reply || "").trim();
    if (!heard) {
      speak("No alcancé a oír la respuesta. Intentemos otra vez.", () => startVoiceSession("followup"));
      return;
    }
    stopVoiceSession({ nextMode: "processing" });
    const combined = mergeKitchenConversation(conversationContextRef.current || transcriptRef.current, heard, voiceCatalogs);
    transcriptRef.current = combined;
    setTranscript(combined);
    setTimeout(() => interpretTranscriptRef.current?.(combined, { handsFree: true, continuation: true, spokenText: heard }), 100);
  }

  function toggleListening() {
    if (recognitionSessionRef.current.active || listening) {
      stopVoiceSession();
      cancelSpeech();
      return;
    }
    if (draftRef.current && !executedRef.current) startVoiceSession(draftRef.current.canExecute ? "action" : "followup");
    else authorizeAndStartVoiceSession("dictation", { clearDictation: true });
  }

  function interpretTranscript(value, { handsFree = false, continuation = false, spokenText = value } = {}) {
    const queryText = String(spokenText || value || "").trim();
    const readOnlyAnswer = kitchenOrderLookupAnswer(queryText, voiceCatalogs)
      || kitchenOrderQueueAnswer(queryText, voiceCatalogs)
      || momobotContextAnswer(queryText, voiceCatalogs, assistantMemoryRef.current)
      || kitchenOrderLookupAnswer(value, voiceCatalogs)
      || kitchenOrderQueueAnswer(value, voiceCatalogs)
      || momobotContextAnswer(value, voiceCatalogs, assistantMemoryRef.current);
    if (readOnlyAnswer) {
      const pendingDraft = draftRef.current && !executedRef.current ? draftRef.current : null;
      stopVoiceSession({ nextMode: "processing" });
      setSpeechError("");
      setTranscript(queryText);
      transcriptRef.current = queryText;
      setResult({ type: "ok", text: readOnlyAnswer.text, warnings: [] });
      assistantMemoryRef.current = {
        ...assistantMemoryRef.current,
        ...(readOnlyAnswer.memoryPatch || {}),
        ...(readOnlyAnswer.orderId ? { lastTopic: "order", lastOrderId: readOnlyAnswer.orderId } : {}),
        ...(readOnlyAnswer.paidOrderIds?.[0] ? { lastTopic: "order", lastOrderId: readOnlyAnswer.paidOrderIds[0] } : {}),
      };
      addConversationMessage("user", queryText);
      addConversationMessage("assistant", readOnlyAnswer.text);
      readOnlyTurnsRef.current += 1;
      const resumeMode = momobotModeAfterReadOnly({
        handsFree,
        readOnlyTurns: readOnlyTurnsRef.current,
        hasPendingDraft: Boolean(pendingDraft),
        draftCanExecute: Boolean(pendingDraft?.canExecute),
      });
      if (handsFree) speak(readOnlyAnswer.text, resumeMode === "standby" ? resumeMomobotStandby : () => startVoiceSession(resumeMode));
      else setVoiceMode("idle");
      return;
    }
    readOnlyTurnsRef.current = 0;
    handsFreeCommandRef.current = handsFree;
    const next = parseKitchenVoice(value, voiceCatalogs);
    if (!commandKeyRef.current) commandKeyRef.current = voiceCommandKey();
    conversationContextRef.current = String(value || "").trim();
    conversationTurnsRef.current = continuation ? conversationTurnsRef.current + 1 : 0;
    progressRef.current = { bases: new Set(), runs: new Set(), batchIds: [], frozen: new Set(), unmolded: new Set(), orders: new Set(), ordersReady: new Set() };
    setDraft(next);
    draftRef.current = next;
    setResult(null);
    setExecuted(false);
    executedRef.current = false;
    if (handsFree) addConversationMessage("user", spokenText);
    if (next.canExecute) {
      vibrar("tap");
      const message = voiceSummary(next) + (handsFree ? " Podés responder sí, dale, editar o cancelar." : "");
      if (handsFree) addConversationMessage("assistant", message);
      speak(message, handsFree ? () => startVoiceSession("action") : null);
    } else {
      vibrar("error");
      const prompt = kitchenConversationPrompt(next, voiceCatalogs);
      const keepTalking = handsFree && prompt.recoverable && conversationTurnsRef.current < 4;
      const message = keepTalking
        ? prompt.text
        : prompt.recoverable
          ? `${prompt.text} Si preferís empezar de nuevo, decí editar.`
          : prompt.text;
      if (handsFree) addConversationMessage("assistant", message);
      speak(message, handsFree ? () => startVoiceSession(keepTalking ? "followup" : "action") : null);
    }
  }

  function interpretCommand() {
    interpretTranscript(transcriptRef.current || transcript);
  }

  async function executeCommand() {
    const currentDraft = draftRef.current;
    if (!currentDraft?.canExecute || executedRef.current || executingRef.current) return;
    executingRef.current = true;
    stopVoiceSession({ nextMode: "executing" });
    cancelSpeech();
    const key = commandKeyRef.current || voiceCommandKey();
    commandKeyRef.current = key;
    const note = (`[Comando de voz ${key}] ${currentDraft.transcript}`).slice(0, 1800);
    const progress = progressRef.current;
    const applied = [];
    const operationWarnings = [];
    try {
      const preparations = currentDraft.preparations?.length ? currentDraft.preparations : (currentDraft.preparation ? [currentDraft.preparation] : []);
      for (let i = 0; i < preparations.length; i += 1) {
        if (progress.bases.has(i)) continue;
        const preparation = preparations[i];
        setExecutionLabel(`Registrando ${preparation.subrecipeName}…`);
        const response = await producirSubreceta({
          subreceta_id: preparation.subrecipeId,
          gramos_nominales: preparation.nominalGrams,
          gramos_obtenidos: preparation.obtainedGrams,
          resp_user_id: perfil?.id || null,
          obs: note,
          idempotency_key: key + "-base-" + i,
        });
        progress.bases.add(i);
        applied.push(`${preparation.subrecipeName}: ${preparation.obtainedGrams} g`);
        if (Array.isArray(response?.faltantes) && response.faltantes.length) operationWarnings.push(...response.faltantes.map((x) => `${x.insumo}: faltan ${x.faltan} ${x.unidad}`));
      }

      const productions = currentDraft.productions?.length ? currentDraft.productions : (currentDraft.production ? [currentDraft.production] : []);
      if (productions.length) {
        const filling = db.settings.rellenos?.[0];
        if (!filling) throw new Error("No hay un relleno predeterminado configurado para crear las corridas.");
        for (let productionIndex = 0; productionIndex < productions.length; productionIndex += 1) {
          const production = productions[productionIndex];
          for (let runIndex = 0; runIndex < production.runs.length; runIndex += 1) {
            const runKey = `${productionIndex}:${runIndex}`;
            if (progress.runs.has(runKey)) continue;
            const run = production.runs[runIndex];
            setExecutionLabel(`Creando ${run.quantity} ${production.figure} de ${run.flavor}…`);
            const response = await crearCorrida({
              sabor: run.flavor,
              relleno: filling,
              figuras: [{ figura: production.figure, cant: run.quantity }],
              resp_user_id: perfil?.id || null,
              horas_congelacion: db.settings.horasCongelacion || 10,
              obs: note,
              idempotency_key: `${key}-production-${productionIndex}-run-${runIndex}`,
            });
            progress.runs.add(runKey);
            applied.push(`${run.quantity} ${production.figure} de ${run.flavor}`);
            const lots = Array.isArray(response?.lotes) ? response.lotes : [];
            lots.forEach((lot) => {
              const id = lot.batch_id || lot.id;
              if (id && !progress.batchIds.includes(id)) progress.batchIds.push(id);
            });
            if (Array.isArray(response?.faltantes) && response.faltantes.length) operationWarnings.push(...response.faltantes.map((x) => `${x.insumo}: faltan ${x.faltan} ${x.unidad}`));
          }
        }
      }

      if (currentDraft.madeToOrder && !progress.orders.has(currentDraft.madeToOrder.orderId)) {
        const orderPreparation = currentDraft.madeToOrder;
        const sourceOrder = db.orders.find((order) => order.id === orderPreparation.orderId);
        const permission = orderTransitionPermission(perfil, sourceOrder?.estado || "Pagado", "En producción");
        if (!permission.allowed) throw new Error(permission.reason);
        setExecutionLabel(`Iniciando preparación del pedido ${orderPreparation.orderId}…`);
        const response = await setOrderStatusRemoto(orderPreparation.orderId, "En producción");
        progress.orders.add(orderPreparation.orderId);
        applied.push(`${orderPreparation.orderId} en producción · ${voiceOrderItems(orderPreparation)}`);
        if (Array.isArray(response?.faltantes) && response.faltantes.length) {
          operationWarnings.push(`El pedido inició con ${response.faltantes.length} faltante${response.faltantes.length === 1 ? "" : "s"} de inventario. Revisá el detalle del pedido.`);
        }
      }

      if (currentDraft.orderHandoff && !progress.ordersReady.has(currentDraft.orderHandoff.orderId)) {
        const handoff = currentDraft.orderHandoff;
        const sourceOrder = db.orders.find((order) => order.id === handoff.orderId);
        const permission = orderTransitionPermission(perfil, sourceOrder?.estado || "En producción", "Listo para empaque");
        if (!permission.allowed) throw new Error(permission.reason);
        setExecutionLabel(`Entregando el pedido ${handoff.orderId} a Empaque…`);
        if (db.operationalControlReady) await completarEtapaPedido(handoff.orderId, "Cocina");
        await setOrderStatusRemoto(handoff.orderId, "Listo para empaque");
        progress.ordersReady.add(handoff.orderId);
        applied.push(`${handoff.orderId} listo para empaque`);
      }

      if (currentDraft.startFreezing) {
        const freezingTargets = [...new Set([...(currentDraft.freezeBatchIds || []), ...progress.batchIds])];
        if (!freezingTargets.length) throw new Error("No tengo un lote validado para iniciar su congelación.");
        for (let i = 0; i < freezingTargets.length; i += 1) {
          const batchId = freezingTargets[i];
          if (progress.frozen.has(batchId)) continue;
          setExecutionLabel(`Iniciando congelación ${batchId} · ${i + 1}/${freezingTargets.length}…`);
          await empezarCongelamiento(batchId);
          progress.frozen.add(batchId);
        }
        applied.push(`${progress.frozen.size} cronómetro${progress.frozen.size === 1 ? "" : "s"} de congelación`);
      }

      if (currentDraft.unmolding && !progress.unmolded.has(currentDraft.unmolding.batchId)) {
        const outcome = currentDraft.unmolding;
        setExecutionLabel(`Desmoldando ${outcome.batchId}…`);
        await desmoldarLote(outcome.batchId, outcome.perfectas, outcome.imperfectas, outcome.descartadas);
        progress.unmolded.add(outcome.batchId);
        applied.push(`${outcome.batchId} desmoldado: ${voiceOutcomeCount(outcome.perfectas, "perfecta", "perfectas")}, ${voiceOutcomeCount(outcome.imperfectas, "imperfecta", "imperfectas")} y ${voiceOutcomeCount(outcome.descartadas, "descartada", "descartadas")}`);
      }

      setExecutionLabel("Actualizando la cocina…");
      try { await refrescar(); }
      catch { operationWarnings.push("Las acciones se aplicaron, pero la vista no se pudo actualizar. Recargá para verlas."); }
      const uniqueApplied = [...new Set(applied)];
      const text = uniqueApplied.length ? uniqueApplied.join(" · ") : "Comando aplicado";
      setResult({ type: "ok", text, warnings: [...new Set(operationWarnings)] });
      setExecuted(true);
      executedRef.current = true;
      setVoiceMode("idle");
      toast("ok", "Comando de cocina aplicado");
      const nextMode = momobotModeAfterExecution({ handsFree: handsFreeCommandRef.current, voiceAvailable: voiceInputAvailable, succeeded: true });
      if (nextMode === "dictation") {
        const message = "Listo. " + text + ". ¿Qué hacemos después? Si terminaste, decí cierra.";
        addConversationMessage("assistant", message);
        speak(message, continueMomobotAfterExecution);
      } else speak("Listo. " + text + ". Momobot queda en espera.", resumeMomobotStandby);
    } catch (e) {
      const partial = progress.bases.size || progress.runs.size || progress.frozen.size || progress.unmolded.size || progress.orders.size;
      const friendlyError = explainOperationalError(e, { inventory: db.inventory_items || [], subrecipes });
      const detail = (partial ? "Hay pasos ya aplicados y protegidos contra duplicados. " : "") + friendlyError;
      setResult({ type: "error", text: detail, warnings: [] });
      setVoiceMode("idle");
      toast("error", detail);
      speak("No pude completar todo el comando. Revisá el mensaje en pantalla. No inicié pasos posteriores al error.", resumeMomobotStandby);
    } finally {
      executingRef.current = false;
    }
  }

  beginRecognitionRef.current = beginRecognition;
  startVoiceSessionRef.current = startVoiceSession;
  finishDictationRef.current = finishDictation;
  handleWakeWordRef.current = handleWakeWord;
  handleVoiceControlRef.current = handleVoiceControl;
  handleConversationReplyRef.current = handleConversationReply;
  interpretTranscriptRef.current = interpretTranscript;
  executeCommandRef.current = executeCommand;
  flushOrderAlertsRef.current = flushOrderAlerts;

  const voiceStatusLabel = listening
    ? voiceActivity === "recovering" ? "Reconectando oído…"
      : voiceActivity === "starting" ? "Abriendo micrófono…"
        : voiceActivity === "wake" ? "Momobot te oyó · terminá la frase"
          : voiceActivity === "hearing" ? "Te estoy oyendo…"
            : voiceMode === "standby" ? "Atenta · decí “Momobot”"
              : voiceMode === "action" ? "Esperando confirmar o editar"
                : voiceMode === "followup" ? "Escuchando tu respuesta"
                  : "Te escucho · hacé una pausa"
    : voiceMode === "authorizing" ? "Autorizando micrófono…"
      : voiceMode === "processing" ? "Interpretando…"
        : draft && !executed ? "Tocá para dar una orden" : "Tocá para hablar";
  const standbyStatus = voiceActivity === "recovering" ? "↻ Reconectando escucha"
    : voiceActivity === "starting" ? "◌ Abriendo micrófono"
      : voiceActivity === "wake" ? "● Momobot detectada"
        : voiceActivity === "hearing" ? "● Voz detectada"
          : "● Micrófono activo · decí Momobot";

  return (
    <div className="momo-momobot-fab" data-open={abierto ? "true" : "false"}>
      {!abierto ? (
        <button type="button" onClick={() => setAbierto(true)} data-listening={listening}
          className="momo-voice-orb w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl shadow-xl"
          style={{ background: T.coral }} title="MomoBot · copiloto de cocina"
          aria-label={listening ? "Momobot escuchando · abrir copiloto de cocina" : "Abrir Momobot copiloto de cocina"}>
          {listening ? <span className="momo-voice-wave" aria-hidden="true"><i /><i /><i /><i /></span> : "🎙️"}
        </button>
      ) : (
      <Card id="momobot-cocina" data-testid="momobot-panel" className="momo-modal-sheet momo-momobot-panel p-4 w-[min(94vw,720px)] max-h-[82vh] overflow-y-auto shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b" style={{ borderColor: T.border }}>
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0" style={{ background: T.coralSoft }} aria-hidden="true">✨</span>
          <div><div className="text-[9px] uppercase tracking-[.18em] font-extrabold" style={{ color: T.coral }}>Asistente de Cocina MOMOS</div><div className="text-sm font-extrabold" style={{ color: T.choco }}>Momobot · manos libres</div></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: listening ? T.coralSoft : "#DDEBD9", color: listening ? "#A54830" : "#315B35" }}>{listening ? "● Te estoy escuchando" : "✓ Confirmás antes de registrar"}</span>
          <button type="button" onClick={() => setAbierto(false)} aria-label="Minimizar Momobot" title="Minimizar" className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border shrink-0 transition" style={{ background: T.surface, borderColor: T.border, color: T.choco2 }}>✕</button>
        </div>
      </div>
      <div data-testid="momobot-layout" className="momo-momobot-layout">
        <div className="momo-momobot-rail">
          <button type="button" onClick={toggleListening} disabled={voiceMode === "authorizing"} data-listening={listening} aria-pressed={listening}
            className="momo-voice-orb momo-momobot-voice-orb rounded-full flex items-center justify-center text-white font-bold"
            style={{ background: T.coral }} aria-label={listening ? voiceMode === "standby" ? "Desactivar Momobot" : "Cerrar micrófono" : draft && !executed ? "Escuchar una orden de voz" : "Empezar dictado continuo"}>
            {listening ? <span className="momo-voice-wave" aria-hidden="true"><i /><i /><i /><i /></span> : "🎙️"}
          </button>
          <span className="momo-momobot-status text-[10px] font-extrabold uppercase tracking-[.1em]" style={{ color: listening ? "#A03B2A" : T.choco2 }}>
            {voiceStatusLabel}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <div>
              <div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Momobot</div>
              <div className="display momo-momobot-title font-semibold">¿Qué necesitas hacer?</div>
              <div className="text-xs mt-0.5" style={{ color: T.choco2 }}>Decí “Momobot” y hablá natural. Si falta algo te lo preguntará antes de registrar.</div>
              <div className="grid grid-cols-3 gap-2 mt-2 max-w-md">
                {[[listening ? "Activa" : "Lista","Escucha"],[contextSnapshot.paid + contextSnapshot.kitchen + contextSnapshot.packing,"Pedidos"],[contextSnapshot.activeLots,"Lotes"]].map(([value,label]) => <div key={label} className="rounded-xl border px-2.5 py-1.5 text-center" style={{ borderColor: T.border, background: "#FFFDFC" }}><div className="text-xs font-extrabold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}
              </div>
              {voiceMode === "standby" && <div className="inline-flex mt-2 rounded-full px-2 py-0.5 text-[9px] font-extrabold" role="status" style={{ background: "#DCE7F2", color: "#3E5C7E" }}>{standbyStatus}</div>}
              {!voiceInputAvailable && <div className="text-[10px] font-extrabold mt-1" style={{ color: "#A03B2A" }}>Este visor no ofrece micrófono para Momobot · abrí la app en Chrome o Edge</div>}
              <div className="mt-2 rounded-xl px-3 py-2 text-[10px] font-semibold" style={{ background: T.vainilla, color: T.choco2 }}>Podés decir: “¿Qué hago ahora?”, “¿Cómo va el lote 31?” o “Prepará 5 Lizis de Oreo”.</div>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] font-bold rounded-full px-3 py-1.5 shrink-0" style={{ color: T.choco2, background: T.surface, border: `1px solid ${T.border}` }}>
              <input type="checkbox" checked={replyByVoice} onChange={(e) => setReplyByVoice(e.target.checked)} /> Responder por voz
            </label>
          </div>
          {conversation.length > 0 && (
            <div className="rounded-2xl p-3 mb-2 space-y-2" aria-live="polite" style={{ background: T.soft, border: `1px solid ${T.border}` }}>
              <div className="text-[10px] font-extrabold uppercase tracking-[.12em]" style={{ color: T.choco2 }}>Conversación con Momobot</div>
              {conversation.map((message) => (
                <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[92%] rounded-2xl px-3 py-2 text-xs font-semibold" style={message.role === "user"
                    ? { background: T.rosa, color: "#6D3541" }
                    : { background: T.vainilla, color: T.choco }}>
                    <span className="font-extrabold">{message.role === "user" ? "Cocina" : "Momobot"}: </span>{message.text}
                  </div>
                </div>
              ))}
            </div>
          )}
          <textarea value={transcript} onChange={(e) => changeTranscript(e.target.value)} rows={3}
            className={inputCls + " resize-y"} style={{ ...inputStyle, borderColor: "#EAC8BA", boxShadow: "inset 0 1px 0 rgba(84,56,43,.03)" }}
            placeholder="Ej: Producir 10 Lizis: 4 de limón y 6 de Oreo; después iniciar congelación." aria-label="Comando de cocina" />
          {speechError && <div className="mt-2 text-xs font-bold rounded-xl px-3 py-2" style={{ background: "#FFF4E0", color: "#96690F" }}>{speechError}</div>}
          <div className="flex flex-wrap gap-2 mt-2">
            <Btn small onClick={interpretCommand} disabled={!transcript.trim() || listening || voiceMode === "processing" || voiceMode === "executing"}>Interpretar comando</Btn>
            <Btn small kind="ghost" onClick={() => changeTranscript(VOICE_KITCHEN_EXAMPLE)}>Usar ejemplo</Btn>
            {(transcript || draft || result) && <Btn small kind="ghost" onClick={() => changeTranscript("")}>Limpiar</Btn>}
            {voiceInputAvailable && !listening && voiceMode === "idle" && <Btn small kind="ghost" onClick={() => authorizeAndStartVoiceSession("standby")}>Activar “Momobot”</Btn>}
          </div>
        </div>
      </div>

      {draft && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: T.border }}>
          <div className="text-xs font-extrabold uppercase tracking-[.12em] mb-2" style={{ color: T.choco2 }}>Esto entendió MOMOS</div>
          {draft.corrections?.length > 0 && (
            <div className="text-xs font-bold rounded-xl px-3 py-2 mb-2" style={{ background: "#E3EFE0", color: "#3F6B42" }}>
              ✓ Afiné vocabulario MOMOS: {draft.corrections.map((item) => `“${item.heard}” → ${item.understoodAs}`).join(" · ")}
            </div>
          )}
          {draft.errors.map((error) => <div key={error} className="text-xs font-bold rounded-xl px-3 py-2 mb-2" style={{ background: "#F6D4CD", color: "#A03B2A" }}>✕ {error}</div>)}
          {draft.warnings.map((warning) => <div key={warning} className="text-xs font-bold rounded-xl px-3 py-2 mb-2" style={{ background: "#FFF4E0", color: "#96690F" }}>△ {warning}</div>)}
          <div className="grid sm:grid-cols-3 gap-2">
            {(draft.preparations?.length ? draft.preparations : (draft.preparation ? [draft.preparation] : [])).map((preparation) => (
              <div key={preparation.subrecipeId} className="rounded-2xl p-3" style={{ background: "#F7ECD9" }}>
                <div className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: T.choco2 }}>Preparar base</div>
                <div className="font-bold text-sm mt-1">{preparation.subrecipeName}</div>
                <div className="text-xs mt-1">{preparation.nominalGrams} g preparados → {preparation.obtainedGrams} g obtenidos</div>
                {preparation.usage && <div className="text-[10px] font-extrabold mt-1" style={{ color: preparation.usage.includes("Relleno") ? "#8E4B5A" : T.choco2 }}>↳ {preparation.usage}</div>}
              </div>
            ))}
            {(draft.productions?.length ? draft.productions : (draft.production ? [draft.production] : [])).map((production, productionIndex) => (
              <div key={`${production.figure}-${productionIndex}`} className="rounded-2xl p-3" style={{ background: "#F3D7DC" }}>
                <div className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: "#8E4B5A" }}>Producción · {production.calculatedTotal} total</div>
                <div className="font-bold text-sm mt-1">{production.figure}</div>
                <div className="text-xs mt-1">{production.runs.map((run) => `${run.quantity} ${run.flavor}`).join(" · ")}</div>
              </div>
            ))}
            {draft.madeToOrder && (
              <div className="rounded-2xl p-3" style={{ background: "#F7ECD9" }}>
                <div className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: "#96690F" }}>Preparación bajo pedido</div>
                <div className="font-bold text-sm mt-1">Pedido {draft.madeToOrder.orderId}{draft.madeToOrder.customerName ? ` · ${draft.madeToOrder.customerName}` : ""}</div>
                <div className="text-xs mt-1">Comanda: {draft.madeToOrder.orderContent || draft.madeToOrder.items.map((item) => `${item.quantity} × ${item.productName}`).join(" · ")}</div>
                <div className="text-[10px] font-extrabold mt-1" style={{ color: "#3F6B42" }}>✓ Orden pagada y contenido verificado</div>
                <div className="text-[10px] font-extrabold mt-1" style={{ color: "#96690F" }}>Al confirmar, el pedido completo pasa a En producción y registra su inicio en Cocina</div>
              </div>
            )}
            {draft.orderHandoff && (
              <div className="rounded-2xl p-3 border" style={{ background: T.vainilla, borderColor: T.border }}>
                <div className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: "#A54830" }}>Entrega de Cocina a Empaque</div>
                <div className="font-bold text-sm mt-1">Pedido {draft.orderHandoff.orderId}{draft.orderHandoff.customerName ? ` · ${draft.orderHandoff.customerName}` : ""}</div>
                <div className="text-xs mt-1">{draft.orderHandoff.orderContent}</div>
                <div className="text-[10px] font-extrabold mt-2" style={{ color: "#A54830" }}>Al confirmar pasa a Listo para empaque y avisa al equipo de Empaque.</div>
              </div>
            )}
            {draft.startFreezing && (
              <div className="rounded-2xl p-3" style={{ background: T.vainilla }}>
                <div className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: "#3E5C7E" }}>{draft.production ? "Después" : "Acción sobre lote"}</div>
                <div className="font-bold text-sm mt-1">❄️ Iniciar congelación</div>
                <div className="text-xs mt-1">{draft.freezeBatchIds?.length
                  ? `${draft.freezeBatchIds.join(", ")} · lote${draft.freezeBatchIds.length === 1 ? "" : "s"} existente${draft.freezeBatchIds.length === 1 ? "" : "s"} validado${draft.freezeBatchIds.length === 1 ? "" : "s"}`
                  : "Solo en los lotes que cree este comando"} · objetivo {db.settings.horasCongelacion || 10} h</div>
              </div>
            )}
            {draft.unmolding && (
              <div className="rounded-2xl p-3" style={{ background: T.vainilla }}>
                <div className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: "#3F6B42" }}>Desmolde · {draft.unmolding.total} total</div>
                <div className="font-bold text-sm mt-1">🧊 {draft.unmolding.batchId}</div>
                <div className="text-xs mt-1">{voiceOutcomeCount(draft.unmolding.perfectas, "perfecta", "perfectas")} · {voiceOutcomeCount(draft.unmolding.imperfectas, "imperfecta", "imperfectas")} · {voiceOutcomeCount(draft.unmolding.descartadas, "descartada", "descartadas")}</div>
                <div className="text-[10px] font-extrabold mt-1" style={{ color: "#3F6B42" }}>Al confirmar pasa a Listo y actualiza el stock</div>
              </div>
            )}
          </div>
          <div className="text-[11px] font-semibold mt-2" style={{ color: T.choco2 }}>Manos libres: respondé “sí”, “dale”, “hazlo”, “editar”, “repetir” o “cancelar”. “Cierra” solo apaga el micrófono. La conversación original quedará en las observaciones.</div>
          <div className="flex flex-wrap gap-2 mt-3">
            <BtnAsync confirmar="¿Ejecutar? Tocá de nuevo" textoEnVuelo={executionLabel} disabled={!draft.canExecute || executed} onClick={executeCommand}>
              {executed ? "Aplicado ✓" : "Confirmar y registrar"}
            </BtnAsync>
            <Btn kind="ghost" onClick={() => { stopVoiceSession(); resetVoiceDraft(); }}>Cancelar</Btn>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-2xl px-4 py-3 text-sm font-bold" role={result.type === "error" ? "alert" : "status"}
          style={result.type === "error" ? { background: "#F6D4CD", color: "#A03B2A" } : { background: "#E3EFE0", color: "#3F6B42" }}>
          {result.type === "error" ? "✕ " : "✓ "}{result.text}
          {result.warnings?.length > 0 && <div className="text-xs mt-2 font-semibold">Atención: {result.warnings.join(" · ")}</div>}
        </div>
      )}

    </Card>
      )}
    </div>
  );
}
