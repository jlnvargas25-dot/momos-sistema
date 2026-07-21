import { useMemo, useState } from "react";
import { AGENCY_COLLABORATION_ENTRY_TYPES, AGENCY_CONTENT_MODES, AGENCY_CONTRACT_KPIS, AGENCY_MODE_METRICS, agencyContractConstraints, agencyContractDirection, agencyRoomPayload, buildAgencyCollaborationDesk } from "../../lib/agency-collaboration";
import { STORYBOARD_ASPECT_RATIOS, STORYBOARD_CHANNELS, STORYBOARD_FORMATS, buildAgencySceneStudio, shotPayload, storyboardPayload } from "../../lib/agency-scene-studio";
import { buildAgencyMotionCenter, buildMotionPlanDraft, motionPlanPayload } from "../../lib/agency-motion-experience";
import { SCENE_ROUTE_PROVIDERS, buildAgencySceneRouter, buildSceneRoutingDraft, sceneRoutingPayload } from "../../lib/agency-scene-router";
import { AGENCY_QUALITY_CRITERIA, AGENCY_QUALITY_FAILURE_TYPES, buildAgencyQualityCenter, evaluateSceneQuality, postproductionPackagePayload, sceneQualityReviewPayload } from "../../lib/agency-quality-control";
import { buildPostproductionExportCenter, evaluatePostproductionMaster, postproductionExportPayload } from "../../lib/agency-postproduction-export";
import { RETENTION_PLATFORMS, buildAgencyRetentionCenter, retentionScriptPayload } from "../../lib/agency-retention-engine";
import { buildAgencyLoopLearningCenter, loopDiagnosticPayload } from "../../lib/agency-loop-learning";
import { businessDateISO } from "../../lib/business-date";
import {
  abrirMesaAgencia, agregarAporteMesaAgencia, prepararContratoCreativo, aprobarContratoCreativo,
  crearStoryboardAgencia, guardarTomaStoryboard, enviarStoryboardRevision, resolverStoryboardAgencia,
  prepararPlanMotion, resolverPlanMotion, prepararEnrutamientoEscenas, resolverEnrutamientoEscenas,
  registrarRevisionCalidadEscena, resolverRevisionCalidadEscena, prepararPaquetePostproduccion,
  resolverPaquetePostproduccion, autorizarExportacionPostproduccion, resolverControlMasterPostproduccion,
  reintentarExportacionPostproduccion, prepararGuionRetencion, resolverGuionRetencion,
  crearExperimentoRetencion, cerrarExperimentoRetencion, prepararDiagnosticoRetencion,
  resolverDiagnosticoRetencion,
} from "../../lib/rpc";

export function createAgencyCreativeSuite(shared) {
  const {
    T, hoyISO, dISO, fmt, copiarTexto, Badge, Card, SectionTitle, Btn, toast,
    BtnAsync, Modal, Field, inputCls, inputStyle, Input, Select, Empty,
  } = shared;

function AgencyCollaborationDesk({ db, refrescar }) {
  const desk = useMemo(() => buildAgencyCollaborationDesk(db), [db]);
  const [openForm, setOpenForm] = useState(false);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [sourceKey, setSourceKey] = useState("");
  const [objective, setObjective] = useState("");
  const [entryType, setEntryType] = useState("Aporte");
  const [entryBody, setEntryBody] = useState("");
  const [contractForm, setContractForm] = useState({
    concept: "", audience: "", channel: "Instagram", primaryKpi: "Beneficio incremental",
    contentMode: "Orgánico", contentGoal: "Construir deseo y conversación alrededor de MOMOS", modePrimaryMetric: "Retención",
    humanIntent: "", callToAction: "", mustInclude: "", mustAvoid: "",
  });
  const [approvalNote, setApprovalNote] = useState("");
  const [contractEditing, setContractEditing] = useState(false);
  const linkedDecisions = new Set((db.agencyCollaborationRooms || []).map((room) => String(room.decisionId || "")).filter(Boolean));
  const linkedBriefs = new Set((db.agencyCollaborationRooms || []).map((room) => String(room.briefId || "")).filter(Boolean));
  const sources = useMemo(() => [
    ...(db.agencyDecisions || []).filter((item) => item.status === "Aprobada" && !linkedDecisions.has(String(item.id))).map((item) => ({ ...item, kind: "decision", key: `decision-${item.id}`, label: `Decisión #${item.id} · ${item.title}` })),
    ...(db.agencyBriefs || []).filter((item) => ["Aprobado", "En producción"].includes(item.status) && !linkedBriefs.has(String(item.id))).map((item) => ({ ...item, kind: "brief", key: `brief-${item.id}`, label: `Brief #${item.id} · ${item.title}` })),
  ], [db.agencyDecisions, db.agencyBriefs, db.agencyCollaborationRooms]);
  const activeRoom = desk.rooms.find((room) => String(room.id) === String(activeRoomId)) || null;
  const activeEntries = activeRoom ? (db.agencyCollaborationEntries || []).filter((entry) => String(entry.roomId) === String(activeRoom.id)) : [];
  const activeContracts = activeRoom ? (db.agencyCreativeContracts || []).filter((contract) => String(contract.roomId) === String(activeRoom.id)).sort((a, b) => Number(b.version || 0) - Number(a.version || 0)) : [];
  const latestContract = activeContracts.find((contract) => contract.status !== "Sustituido") || null;

  function startRoom() {
    const first = sources[0];
    setSourceKey(first?.key || "");
    setObjective(first?.rationale || first?.insight || "Convertir esta oportunidad en una acción creativa rentable y fiel a MOMOS.");
    setOpenForm(true);
  }

  async function createRoom() {
    const source = sources.find((item) => item.key === sourceKey);
    if (!source) throw new Error("Elegí una decisión o brief aprobado.");
    const result = await abrirMesaAgencia(agencyRoomPayload(source, objective));
    setOpenForm(false);
    setActiveRoomId(result.room_id);
    toast("ok", result.duplicate ? "La mesa ya existía; abrimos su conversación." : "Mesa cooperativa abierta con contexto sellado.");
    await refrescar();
  }

  async function addHumanEntry() {
    if (!activeRoom || entryBody.trim().length < 3) throw new Error("Escribí el criterio que querés aportar.");
    await agregarAporteMesaAgencia(activeRoom.id, `human-${activeRoom.id}-${Date.now()}`, entryType, entryBody.trim(), { ui: "agency-collaboration-desk" });
    setEntryBody("");
    toast("ok", "Tu criterio quedó firmado en la mesa.");
    await refrescar();
  }

  async function prepareContract() {
    if (!activeRoom) return;
    const result = await prepararContratoCreativo(activeRoom.id, agencyContractDirection(contractForm, activeRoom), agencyContractConstraints(contractForm));
    setContractEditing(false);
    toast("ok", result.duplicate ? "Ese contrato ya estaba sellado." : "Contrato creativo preparado; falta aprobación humana.");
    await refrescar();
  }

  async function approveContract() {
    if (!latestContract) return;
    await aprobarContratoCreativo(latestContract.id, approvalNote || "Aprobación humana desde la Mesa de Agencia MOMOS");
    setApprovalNote("");
    toast("ok", "Contrato creativo aprobado. No generó, gastó ni publicó nada.");
    await refrescar();
  }

  const statusTone = (status) => status === "Aprobado" ? { bg: "#DDEBD9", fg: "#315B35" } : status === "En revisión" ? { bg: "#FFF2D8", fg: "#7A5410" } : { bg: "#E5EEF7", fg: "#315A7D" };

  return <div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: T.border, background: T.surface }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface, color: T.choco }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.coralSoft }}>✦</div><div><div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: T.coral }}>Equipo MOMOS</div><div className="display text-xl font-semibold">Mesa de trabajo creativo</div><div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>MOMOS reúne los datos y la propuesta; vos aportás el criterio de marca antes de crear una pieza.</div></div></div>
      <div className="flex items-center gap-2"><div className="grid grid-cols-2 gap-2">{[["Mesas",desk.summary.open],["Acuerdos",desk.summary.approved]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[72px] text-center" style={{ borderColor: T.border, background: T.vainilla }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div><Btn small kind="soft" disabled={!db.agencyCollaborationReady || sources.length === 0} onClick={startRoom}>＋ Abrir mesa</Btn></div>
    </div>
    {!db.agencyCollaborationReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>mesa-agencia-v1.sql</code> después de la migración 29. Hasta entonces no se puede sellar la colaboración.</div> : <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 border-b" style={{ borderColor: T.border, background: "#FFF8F1" }}>
        {[["Abiertas",desk.summary.open],["Falta humano",desk.summary.waitingForHuman],["Falta agente",desk.summary.waitingForAgent],["Por aprobar",desk.summary.pendingApproval]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2" style={{ borderColor: T.border, background: "#fff" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-xl font-semibold">{value}</div></div>)}
      </div>
      {desk.open.length === 0 ? <div className="p-4 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>No hay mesas abiertas.</b> Elegí una decisión o brief aprobado para reunir la data, el criterio humano y la propuesta del agente.</div> : <div className="p-3 grid lg:grid-cols-2 gap-2">
        {desk.open.slice(0, 6).map((room) => <button type="button" key={room.id} onClick={() => setActiveRoomId(room.id)} className="text-left rounded-2xl border p-3 transition hover:-translate-y-0.5" style={{ borderColor: room.readiness.readyForContract ? "#B8D3B2" : T.border, background: room.readiness.readyForContract ? "#F4FAF2" : "#FFF9F2" }}>
          <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Mesa #{room.id} · {room.status}</div><div className="font-extrabold text-sm">{room.title}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: room.readiness.readyForContract ? "#DDEBD9" : "#FFF2D8", color: room.readiness.readyForContract ? "#315B35" : "#7A5410" }}>{room.readiness.readyForContract ? "ACUERDO POSIBLE" : "EN CONVERSACIÓN"}</span></div>
          <p className="text-[11px] my-2 line-clamp-2" style={{ color: T.choco2 }}>{room.objective}</p><div className="flex gap-1.5"><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: "#F3D7DC" }}>Humano {room.readiness.humanCount}</span><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: "#E5EEF7" }}>Agente {room.readiness.agentCount}</span><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>Contrato {room.readiness.hasApprovedContract ? "aprobado" : "pendiente"}</span></div>
        </button>)}
      </div>}
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>La mesa no ejecuta herramientas. El contrato aprobado será la entrada gobernada de generación, revisión humana y distribución.</div>

    {openForm && <Modal title="Abrir Mesa cooperativa" onClose={() => setOpenForm(false)} topLayer>
      <div className="rounded-2xl px-4 py-3 mb-4 text-sm" style={{ background: T.vainilla }}><b>El contexto comercial se captura ahora y queda inmutable.</b> Nuevos datos requerirán una nueva mesa o una versión posterior del contrato.</div>
      <Field label="Oportunidad aprobada"><select className={inputCls} style={inputStyle} value={sourceKey} onChange={(event) => { const next = sources.find((item) => item.key === event.target.value); setSourceKey(event.target.value); if (next) setObjective(next.rationale || next.insight || objective); }}><option value="">Elegí una fuente…</option>{sources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}</select></Field>
      <Field label="Objetivo de la mesa"><textarea className={inputCls} style={inputStyle} rows="4" value={objective} onChange={(event) => setObjective(event.target.value)} /></Field>
      <div className="flex gap-2"><BtnAsync onClick={createRoom} disabled={!sourceKey || objective.trim().length < 5}>Abrir con contexto sellado</BtnAsync><Btn kind="ghost" onClick={() => setOpenForm(false)}>Cancelar</Btn></div>
    </Modal>}

    {activeRoom && <Modal title={`Mesa #${activeRoom.id} · ${activeRoom.title}`} onClose={() => setActiveRoomId(null)} wide topLayer>
      <div className="rounded-2xl px-4 py-3 mb-4" style={{ background: "#F5E9D8" }}><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Objetivo sellado</div><div className="text-sm font-bold">{activeRoom.objective}</div><div className="text-[9px] mt-1" style={{ color: T.choco2 }}>Huella {String(activeRoom.contextFingerprint || "").slice(0, 12)} · este contexto no se puede reemplazar.</div></div>
      <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-4">
        <div><div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.choco2 }}>Conversación trazable</div><div className="rounded-3xl border p-3 min-h-[220px] max-h-[420px] overflow-y-auto space-y-2" style={{ borderColor: T.border, background: "#FFFAF5" }}>
          {activeEntries.length === 0 && <div className="text-sm p-3" style={{ color: T.choco2 }}>Empezá dejando el criterio humano de marca. El agente se incorpora mediante el Orquestador/MCP seguro.</div>}
          {activeEntries.map((entry) => <div key={entry.id} className={`flex ${entry.authorKind === "Humano" ? "justify-end" : "justify-start"}`}><div className="rounded-2xl px-3 py-2 max-w-[88%]" style={{ background: entry.authorKind === "Humano" ? "#F3D7DC" : entry.authorKind === "Agente" ? "#E5EEF7" : T.vainilla }}><div className="text-[8px] uppercase font-extrabold" style={{ color: entry.authorKind === "Humano" ? "#8E4B5A" : "#315A7D" }}>{entry.authorKind} · {entry.entryType}{entry.agentName ? ` · ${entry.agentName}` : ""}</div><div className="text-xs leading-relaxed">{entry.body}</div><div className="text-[8px] mt-1 opacity-60">{entry.createdAt} · {String(entry.fingerprint || "").slice(0, 8)}</div></div></div>)}
        </div>
          {!["Cerrada","Cancelada"].includes(activeRoom.status) && <div className="rounded-2xl border p-3 mt-3" style={{ borderColor: T.border }}><div className="grid sm:grid-cols-[160px_1fr] gap-2"><Select options={AGENCY_COLLABORATION_ENTRY_TYPES} value={entryType} onChange={(event) => setEntryType(event.target.value)} /><textarea className={inputCls} style={inputStyle} rows="3" value={entryBody} onChange={(event) => setEntryBody(event.target.value)} placeholder="Tu intención, objeción o decisión de marca…" /></div><BtnAsync small onClick={addHumanEntry} disabled={entryBody.trim().length < 3}>Firmar aporte humano</BtnAsync></div>}
        </div>
        <div><div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.choco2 }}>Contrato creativo</div>
          {!activeRoom.readiness.readyForContract && <div className="rounded-2xl px-3 py-2 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>{activeRoom.readiness.reasons.join(" ")} El agente solo puede firmar su lado mediante el canal MCP protegido.</div>}
          {latestContract && !contractEditing ? <div className="rounded-3xl border p-4 mb-3" style={{ borderColor: statusTone(latestContract.status).fg, background: statusTone(latestContract.status).bg }}><div className="flex justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold">Versión {latestContract.version} · {latestContract.sealedPayload?.creative_direction?.content_mode || "Modo pendiente"}</div><div className="display text-lg font-semibold">{latestContract.sealedPayload?.creative_direction?.concept || "Contrato creativo MOMOS"}</div></div><span className="rounded-full bg-white/70 px-2 py-1 h-fit text-[9px] font-extrabold">{latestContract.status}</span></div><div className="text-xs mt-2"><b>Norte comercial:</b> {latestContract.sealedPayload?.primary_kpi}<br /><b>Métrica del contenido:</b> {latestContract.sealedPayload?.creative_direction?.mode_primary_metric || "Pendiente"}<br /><b>Canal:</b> {latestContract.sealedPayload?.creative_direction?.channel}<br /><b>Huella:</b> {String(latestContract.fingerprint || "").slice(0, 12)}</div>{latestContract.status === "En revisión" && <><Field label="Nota de aprobación"><Input value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="Qué validaste como dueño de marca" /></Field><div className="flex flex-wrap gap-2"><BtnAsync confirmar onClick={approveContract}>Aprobar contrato humano + agente</BtnAsync><Btn small kind="ghost" onClick={() => setContractEditing(true)}>Preparar nueva versión</Btn></div></>}</div> : <div className="space-y-2"><Field label="Concepto acordado"><Input value={contractForm.concept} onChange={(event) => setContractForm({ ...contractForm, concept: event.target.value })} placeholder="La idea central que debe recordar el cliente" /></Field><div className="grid sm:grid-cols-2 gap-2"><Field label="Audiencia"><Input value={contractForm.audience} onChange={(event) => setContractForm({ ...contractForm, audience: event.target.value })} /></Field><Field label="Canal"><Input value={contractForm.channel} onChange={(event) => setContractForm({ ...contractForm, channel: event.target.value })} /></Field></div><div className="grid sm:grid-cols-2 gap-2"><Field label="Tipo de contenido"><Select options={AGENCY_CONTENT_MODES} value={contractForm.contentMode} onChange={(event) => { const contentMode = event.target.value; setContractForm({ ...contractForm, contentMode, modePrimaryMetric: AGENCY_MODE_METRICS[contentMode][0] }); }} /></Field><Field label="Métrica propia del contenido"><Select options={AGENCY_MODE_METRICS[contractForm.contentMode]} value={contractForm.modePrimaryMetric} onChange={(event) => setContractForm({ ...contractForm, modePrimaryMetric: event.target.value })} /></Field></div><div className="rounded-2xl px-3 py-2 text-[10px] font-semibold" style={{ background: contractForm.contentMode === "Pauta" ? "#FFF1D8" : "#E8F1E4", color: contractForm.contentMode === "Pauta" ? "#7B5410" : "#3F6B42" }}>{contractForm.contentMode === "Pauta" ? "Pauta: vender de forma medible con oferta, audiencia, stock, atribución y CTA claros." : "Orgánico: ganar atención, afinidad y conversación; la venta asistida se mide aparte y nunca se presume."}</div><Field label="Objetivo de esta pieza"><Input value={contractForm.contentGoal} onChange={(event) => setContractForm({ ...contractForm, contentGoal: event.target.value })} /></Field><Field label="Norte comercial de MOMOS"><Select options={AGENCY_CONTRACT_KPIS} value={contractForm.primaryKpi} onChange={(event) => setContractForm({ ...contractForm, primaryKpi: event.target.value })} /></Field><Field label="Intención humana de marca"><textarea className={inputCls} style={inputStyle} rows="2" value={contractForm.humanIntent} onChange={(event) => setContractForm({ ...contractForm, humanIntent: event.target.value })} /></Field><Field label="Llamado a la acción"><Input value={contractForm.callToAction} onChange={(event) => setContractForm({ ...contractForm, callToAction: event.target.value })} /></Field><div className="grid sm:grid-cols-2 gap-2"><Field label="Debe incluir"><textarea className={inputCls} style={inputStyle} rows="2" value={contractForm.mustInclude} onChange={(event) => setContractForm({ ...contractForm, mustInclude: event.target.value })} /></Field><Field label="Debe evitar"><textarea className={inputCls} style={inputStyle} rows="2" value={contractForm.mustAvoid} onChange={(event) => setContractForm({ ...contractForm, mustAvoid: event.target.value })} /></Field></div><div className="flex gap-2"><BtnAsync onClick={prepareContract} disabled={!activeRoom.readiness.readyForContract || contractForm.concept.trim().length < 3 || contractForm.audience.trim().length < 3 || contractForm.contentGoal.trim().length < 3 || contractForm.humanIntent.trim().length < 3}>Preparar contrato sellado</BtnAsync>{latestContract && <Btn kind="ghost" onClick={() => setContractEditing(false)}>Conservar versión {latestContract.version}</Btn>}</div></div>}
          <div className="rounded-2xl px-3 py-2 mt-3 text-[10px] font-semibold" style={{ background: "#E5EEF7", color: "#315A7D" }}>Aprobar este contrato no llama a Kling, no crea pauta y no publica. Solo fija la intención compartida para los siguientes motores.</div>
        </div>
      </div>
    </Modal>}
  </div>;
}

function AgencyRetentionLab({ db, refrescar }) {
  const center = useMemo(() => buildAgencyRetentionCenter(db), [db]);
  const [contractId, setContractId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState({});
  const [form, setForm] = useState({ platform: "Instagram Reels", duration: 15, title: "", audience: "", promise: "", payoff: "", callToAction: "", controlHook: "", challengerHook: "", openingVisual: "", proof: "" });

  function openScript(contract) {
    const direction = contract.sealedPayload?.creative_direction || {};
    const concept = direction.concept || "Mostrar un Momo real de forma irresistible";
    setContractId(String(contract.id));
    setForm({
      platform: "Instagram Reels", duration: 15, title: `Guion de retención · ${concept}`,
      audience: direction.audience || "Personas que disfrutan postres premium en Cali",
      promise: `Vas a descubrir por qué ${concept.toLowerCase()}.`, payoff: "La demostración real cierra exactamente la promesa del inicio.",
      callToAction: direction.call_to_action || "Pedí tu Momo", controlHook: concept,
      challengerHook: `Esperá a ver el centro de este Momo.`, openingVisual: "Producto real y reconocible en el primer fotograma.",
      proof: "La cámara muestra el producto real y su textura; no se inventan beneficios.",
    });
    setFormOpen(true);
  }

  async function saveScript() {
    const contract = (db.agencyCreativeContracts || []).find((item) => String(item.id) === String(contractId));
    if (!contract) throw new Error("El contrato creativo ya no está disponible.");
    const duration = Math.max(5, Number(form.duration || 15));
    const hookEnd = Math.min(3, Math.max(1.5, duration * 0.2));
    const proofEnd = Math.max(hookEnd + 1, duration - Math.max(1, duration * 0.2));
    const scores = { clarity: 2, relevance: 2, specificity: 2, proof: 2, novelty: 1, payoff_fit: 2, brand_fit: 2, honesty: 2 };
    const payload = retentionScriptPayload({
      title: form.title, platform: form.platform, targetDurationSec: duration, audience: form.audience,
      objective: contract.sealedPayload?.creative_direction?.primary_kpi || "Beneficio incremental",
      promise: form.promise, payoff: form.payoff, callToAction: form.callToAction,
      evidencePlan: { product_real: true, approved_contract_fingerprint: contract.fingerprint, no_unapproved_claims: true },
      hooks: [
        { variantKey: "A", label: "Control", mechanism: "Resultado primero", hookText: form.controlHook, openingVisual: form.openingVisual, proof: form.proof, scores, selected: true },
        { variantKey: "B", label: "Retador", mechanism: "Pregunta", hookText: form.challengerHook, openingVisual: form.openingVisual, proof: form.proof, scores, selected: false },
      ],
      beatMap: [
        { label: "Hook y promesa", startSec: 0, endSec: hookEnd, visual: form.openingVisual, audio: form.controlHook, purpose: "Detener el scroll mostrando relevancia." },
        { label: "Prueba y desarrollo", startSec: hookEnd, endSec: proofEnd, visual: form.proof, audio: form.promise, purpose: "Demostrar sin esconder el producto." },
        { label: "Payoff y CTA", startSec: proofEnd, endSec: duration, visual: form.payoff, audio: `${form.payoff} ${form.callToAction}`, purpose: "Cerrar el loop antes de pedir la acción." },
      ],
      loops: [{ loopKey: "L1", question: form.promise, openSec: 0, closeSec: Math.max(hookEnd + 0.5, duration - 1), payoff: form.payoff }],
    }, contract);
    const result = await prepararGuionRetencion(payload);
    setFormOpen(false); toast("ok", `Guion V${result.version || 1} sellado para revisión humana; no generó ni publicó.`); await refrescar();
  }

  async function resolveScript(script, decision) {
    const note = String(reviewNotes[script.id] || "").trim();
    if (!note) { toast("alert", decision === "Aprobar" ? "Escribí qué verificaste antes de aprobar." : "Escribí qué debe corregirse antes de devolver."); return; }
    await resolverGuionRetencion(script.id, decision, note);
    setReviewNotes((current) => ({ ...current, [script.id]: "" }));
    toast("ok", decision === "Aprobar" ? "Guion aprobado. Generación, pauta y publicación siguen separadas." : "Guion devuelto con aprendizaje trazable.");
    await refrescar();
  }

  async function createExperiment(script) {
    const hooks = center.hooks.filter((hook) => String(hook.scriptId) === String(script.id));
    const control = hooks.find((hook) => hook.selected) || hooks[0]; const challenger = hooks.find((hook) => hook.id !== control?.id);
    if (!control || !challenger) throw new Error("El guion necesita control y retador.");
    const hypothesis = window.prompt("Hipótesis A/B — cambiaremos únicamente el hook:", `“${control.hookText}” retendrá mejor a los 3 segundos que “${challenger.hookText}”.`) || "";
    if (hypothesis.trim().length < 10) return;
    await crearExperimentoRetencion({
      experiment_key: `retention-${script.id}-${Date.now()}`, script_id: script.id, control_hook_id: control.id, challenger_hook_id: challenger.id,
      declared_variable: "Hook", hypothesis, primary_metric: "Retención 3 s",
      guardrails: { same_product: true, same_offer: true, same_cta: true, same_audience: true, human_winner_required: true },
    });
    toast("ok", "Experimento A/B planificado. No publicó ni autorizó pauta."); await refrescar();
  }

  async function closeExperiment(experiment, resolution, winnerHookId = null) {
    const note = window.prompt(resolution === "Ganador" ? "Documentá muestra, atribución y criterio del ganador:" : "¿Por qué el resultado permanece inconcluso?",
      resolution === "Ganador" ? "Ambos brazos superan la muestra mínima y la atribución corresponde a esta versión exacta." : "La muestra o la diferencia no permiten declarar ganador.") || "";
    if (!note) return;
    await cerrarExperimentoRetencion(experiment.id, resolution, winnerHookId, note);
    toast("ok", resolution === "Ganador" ? "Ganador sellado por decisión humana; no se escaló automáticamente." : "Ambigüedad conservada como aprendizaje válido.");
    await refrescar();
  }

  return <div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#6C3F24,#A55A35)", color: "#fff" }}>
      <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Contrato → atención → aprendizaje económico</div><div className="display text-xl font-semibold">Laboratorio de retención MOMOS</div><div className="text-xs opacity-85 max-w-2xl">Versiona hooks, cierra cada loop y mide la publicación exacta. El cerebro propone; el humano aprueba; una muestra insuficiente nunca se convierte en “ganador”.</div></div>
      <div className="grid grid-cols-4 gap-2 shrink-0">{[["Borradores",center.summary.drafts],["Por revisar",center.summary.pending],["Aprobados",center.summary.approved],["A/B activos",center.summary.activeExperiments]].map(([label,value]) => <div key={label} className="rounded-2xl px-2.5 py-2 min-w-[64px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[7px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencyRetentionReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>retencion-aprendizaje-v1.sql</code>. Hasta entonces los hooks y resultados no quedarán versionados.</div> : <>
      <div className="p-4 border-b" style={{ borderColor: T.border }}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Arquitectura antes de generar</div><div className="font-extrabold text-sm">Promesa, demostración, payoff y CTA</div></div></div>
        <div className="grid lg:grid-cols-2 gap-2">
          {center.eligibleContracts.map((contract) => <article key={contract.id} className="rounded-2xl border p-3 flex items-center gap-3" style={{ borderColor: "#B8D3B2", background: "#F4FAF1" }}><div className="flex-1"><div className="text-[9px] uppercase font-extrabold" style={{ color: "#315B35" }}>Contrato #{contract.id} aprobado</div><div className="font-extrabold text-sm">{contract.sealedPayload?.creative_direction?.concept || contract.contractKey}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Todavía no tiene guion de retención activo.</div></div><Btn small onClick={() => openScript(contract)}>Diseñar guion</Btn></article>)}
          {center.pending.map((script) => <article key={script.id} className="rounded-2xl border p-3" style={{ borderColor: "#E8C98B", background: "#FFF7E8" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>V{script.version} · {script.platform} · {script.sourceKind}</div><div className="font-extrabold text-sm">{script.title}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: "#FBE8C8", color: "#8B5A08" }}>En revisión</span></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}><b>Promesa:</b> {script.promise}<br /><b>Payoff:</b> {script.payoff}</div>{!script.architecture.ready && <div className="rounded-xl px-2 py-1.5 text-[10px] mb-2" style={{ background: "#F6D4CD", color: "#A03B2A" }}>× {script.architecture.reasons[0]}</div>}<Input aria-label={`Nota de revisión del guion V${script.version}`} value={reviewNotes[script.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [script.id]: event.target.value }))} placeholder="Qué verificaste o qué debe corregirse" /><div className="flex gap-2 mt-2"><BtnAsync small confirmar disabled={!script.architecture.ready || !String(reviewNotes[script.id] || "").trim()} onClick={() => resolveScript(script, "Aprobar")}>Aprobar guion</BtnAsync><BtnAsync small kind="ghost" disabled={!String(reviewNotes[script.id] || "").trim()} onClick={() => resolveScript(script, "Devolver")}>Devolver</BtnAsync></div></article>)}
          {center.approved.map((script) => { const experiment = center.experiments.find((item) => String(item.scriptId) === String(script.id) && !["Cerrado","Inconcluso","Cancelado"].includes(item.status)); const contract = (db.agencyCreativeContracts || []).find((item) => String(item.id) === String(script.contractId)); return <article key={script.id} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: "#315B35" }}>Aprobado · V{script.version} · {script.targetDurationSec}s</div><div className="font-extrabold text-sm">{script.title}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: "#DDEBD9", color: "#315B35" }}>No publicado</span></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}>{script.promise} → {script.payoff}</div><div className="flex flex-wrap gap-2">{!experiment ? <BtnAsync small onClick={() => createExperiment(script)}>Planear A/B de hook</BtnAsync> : <div className="rounded-xl px-2.5 py-2 text-[10px] font-bold" style={{ background: "#E5EEF7", color: "#315A7D" }}>Experimento #{experiment.id} · {experiment.status} · variable única: {experiment.declaredVariable}</div>}{contract && !experiment && <Btn small kind="ghost" onClick={() => openScript(contract)}>Preparar nueva versión</Btn>}</div></article>; })}
        </div>
      </div>
      {center.experiments.length > 0 && <div className="p-4"><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: T.coral }}>Aprendizaje por versión exacta</div><div className="grid lg:grid-cols-2 gap-2">{center.experiments.slice(0, 8).map((experiment) => { const controlSample = center.measurements.filter((item) => String(item.experimentId) === String(experiment.id) && String(item.hookId) === String(experiment.controlHookId)).reduce((sum,item) => sum + item.sampleSize, 0); const challengerSample = center.measurements.filter((item) => String(item.experimentId) === String(experiment.id) && String(item.hookId) === String(experiment.challengerHookId)).reduce((sum,item) => sum + item.sampleSize, 0); const ready = Math.min(controlSample, challengerSample) >= 100; return <article key={experiment.id} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>A/B #{experiment.id} · {experiment.primaryMetric}</div><div className="font-extrabold text-sm">{experiment.hypothesis}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: ready ? "#DDEBD9" : "#FBE8C8", color: ready ? "#315B35" : "#8B5A08" }}>{experiment.status}</span></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}>Muestra A {controlSample} · B {challengerSample} · mínimo 100 por brazo</div>{["Planificado","Activo"].includes(experiment.status) && <div className="flex flex-wrap gap-2"><BtnAsync small disabled={!ready} onClick={() => closeExperiment(experiment, "Ganador", experiment.controlHookId)}>Gana A</BtnAsync><BtnAsync small disabled={!ready} onClick={() => closeExperiment(experiment, "Ganador", experiment.challengerHookId)}>Gana B</BtnAsync><BtnAsync small kind="ghost" onClick={() => closeExperiment(experiment, "Inconcluso")}>Inconcluso</BtnAsync></div>}</article>; })}</div></div>}
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Preparar y aprobar cuesta $0: generación, pauta y publicación conservan sus gates separados. Las métricas entran por RPC/conector y no pueden reescribirse.</div>
    {formOpen && <Modal title="Arquitectura de retención" onClose={() => setFormOpen(false)} wide topLayer>
      <div className="rounded-2xl px-3 py-2 mb-3 text-xs" style={{ background: T.vainilla }}><b>Primero el guion.</b> Abrimos una pregunta, la demostramos y la cerramos antes del CTA. Se guardan control y retador; solo cambiaremos el hook.</div>
      <div className="grid sm:grid-cols-2 gap-2"><Field label="Canal"><Select options={RETENTION_PLATFORMS} value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })} /></Field><Field label="Duración objetivo (s)"><Input type="number" min="5" max="180" value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })} /></Field></div>
      <Field label="Título"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field><Field label="Audiencia"><Input value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} /></Field>
      <Field label="Promesa que abre el loop"><textarea className={inputCls} style={inputStyle} rows="2" value={form.promise} onChange={(event) => setForm({ ...form, promise: event.target.value })} /></Field><Field label="Payoff real que lo cierra"><textarea className={inputCls} style={inputStyle} rows="2" value={form.payoff} onChange={(event) => setForm({ ...form, payoff: event.target.value })} /></Field>
      <div className="grid sm:grid-cols-2 gap-2"><Field label="Hook A · control"><textarea className={inputCls} style={inputStyle} rows="2" value={form.controlHook} onChange={(event) => setForm({ ...form, controlHook: event.target.value })} /></Field><Field label="Hook B · retador"><textarea className={inputCls} style={inputStyle} rows="2" value={form.challengerHook} onChange={(event) => setForm({ ...form, challengerHook: event.target.value })} /></Field></div>
      <Field label="Primer fotograma"><Input value={form.openingVisual} onChange={(event) => setForm({ ...form, openingVisual: event.target.value })} /></Field><Field label="Prueba visible"><Input value={form.proof} onChange={(event) => setForm({ ...form, proof: event.target.value })} /></Field><Field label="CTA"><Input value={form.callToAction} onChange={(event) => setForm({ ...form, callToAction: event.target.value })} /></Field>
      <div className="flex gap-2"><BtnAsync confirmar onClick={saveScript} disabled={[form.title,form.audience,form.promise,form.payoff,form.callToAction,form.controlHook,form.challengerHook,form.openingVisual,form.proof].some((value) => !String(value).trim())}>Sellar para revisión</BtnAsync><Btn kind="ghost" onClick={() => setFormOpen(false)}>Cancelar</Btn></div>
    </Modal>}
  </div>;
}

function AgencyLoopLearningDesk({ db, refrescar }) {
  const center = useMemo(() => buildAgencyLoopLearningCenter(db), [db]);

  async function prepare(candidate) {
    await prepararDiagnosticoRetencion(loopDiagnosticPayload(candidate));
    toast("ok", "Diagnóstico sellado para revisión humana. No generó, pautó ni publicó.");
    await refrescar();
  }

  async function resolve(diagnostic, decision) {
    const note = window.prompt(
      decision === "Aprobar" ? "¿Qué evidencia y alcance verificaste antes de convertirlo en aprendizaje?" : "¿Qué debe revisar el cerebro de Agencia?",
      decision === "Aprobar"
        ? "Validé la curva exacta, el beat señalado y que la hipótesis aplica solo a esta plataforma, audiencia y duración."
        : "Reformular la hipótesis sin presentar asociación temporal como causalidad.",
    ) || "";
    if (!note.trim()) return;
    await resolverDiagnosticoRetencion(diagnostic.id, decision, note);
    toast("ok", decision === "Aprobar" ? "Aprendizaje aprobado con alcance exacto; no se escaló automáticamente." : "Diagnóstico devuelto con una corrección trazable.");
    await refrescar();
  }

  const tone = (drop) => Number(drop) >= 15 ? { bg: "#F8DDD7", fg: "#A03B2A" }
    : Number(drop) >= 5 ? { bg: "#FFF0CE", fg: "#8B5A08" } : { bg: "#E3EFE0", fg: "#315B35" };

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 border-b flex flex-col lg:flex-row lg:items-center justify-between gap-3" style={{ borderColor: T.border, background: "#FFF9F2" }}>
      <div className="flex items-start gap-3"><div className="w-10 h-10 rounded-2xl grid place-items-center text-lg shrink-0" style={{ background: "#F3D7DC" }}>↗</div><div>
        <div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: T.coral }}>Curva → beat → hipótesis → aprendizaje</div>
        <div className="display text-xl font-semibold">Sala de aprendizaje de loops</div>
        <div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>Localiza dónde cae la atención, conserva cada loop y propone una sola variable. Una asociación temporal nunca se presenta como causa.</div>
      </div></div>
      <div className="grid grid-cols-3 gap-2 shrink-0">{[["Listos",center.summary.ready],["Por revisar",center.summary.pending],["Aprendizajes",center.summary.learnings]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[74px] text-center" style={{ borderColor: T.border, background: "#fff" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
    </div>
    {!db.agencyLoopLearningReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>experiencia-loops-retencion-v1.sql</code> después del Hito 34. Los resultados existentes permanecen intactos.</div> : <div className="p-4 space-y-5">
      <div>
        <div className="flex items-center justify-between gap-2 mb-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Evidencia nueva</div><div className="font-extrabold text-sm">Mediciones exactas por diagnosticar</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: "#E5EEF7", color: "#315A7D" }}>Mínimo 100 observaciones</span></div>
        {center.candidates.length === 0 ? <div className="rounded-2xl border px-3 py-3 text-xs" style={{ borderColor: T.border, color: T.choco2 }}>No hay mediciones nuevas. Cuando una variante tenga curva completa, MOMO OPS la ubicará sobre el guion exacto.</div> : <div className="grid xl:grid-cols-2 gap-3">{center.candidates.slice(0, 6).map((candidate) => <article key={candidate.measurementId} className="rounded-2xl border p-3" style={{ borderColor: candidate.ready ? "#D7C5B2" : "#E8C98B", background: "#fff" }}>
          <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Medición #{candidate.measurementId} · muestra {candidate.sampleSize}</div><div className="font-extrabold text-sm">{candidate.testedVariable} · cobertura {candidate.confidence}</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold shrink-0" style={{ background: "#F3D7DC", color: "#8E4B5A" }}>NO CAUSAL</span></div>
          {candidate.ready ? <><div className="text-[10px] my-2 leading-relaxed" style={{ color: T.choco2 }}>{candidate.primarySignal}</div><div className="grid gap-1.5">{candidate.beats.map((beat) => { const beatTone = tone(beat.dropPp); return <div key={`${candidate.measurementId}-${beat.beat}`} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center rounded-xl px-2.5 py-2" style={{ background: "#FFF9F2" }}><div><div className="text-[10px] font-extrabold">{beat.label}</div><div className="text-[8px]" style={{ color: T.choco2 }}>{beat.startSec}s → {beat.endSec}s</div></div><div className="text-[9px] font-bold">{Math.round(beat.startPct * 100)}% → {Math.round(beat.endPct * 100)}%</div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: beatTone.bg, color: beatTone.fg }}>{beat.dropPp} pp</span></div>; })}</div><div className="mt-3 flex items-center justify-between gap-3"><div className="text-[9px]" style={{ color: T.choco2 }}>Una sola variable · mismo producto, oferta, audiencia y duración</div><BtnAsync small onClick={() => prepare(candidate)}>Preparar diagnóstico</BtnAsync></div></> : <div className="rounded-xl px-2.5 py-2 text-[10px] mt-2" style={{ background: "#FFF2D8", color: "#7A5410" }}>{candidate.reasons[0]}</div>}
        </article>)}</div>}
      </div>

      {center.pending.length > 0 && <div><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: T.coral }}>Decisión cooperativa · revisión humana</div><div className="grid xl:grid-cols-2 gap-3">{center.pending.map((diagnostic) => <article key={diagnostic.id} className="rounded-2xl border p-3" style={{ borderColor: "#E8C98B", background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: "#8B5A08" }}>Diagnóstico #{diagnostic.id} · {diagnostic.sourceKind}</div><div className="font-extrabold text-sm">Probar: {diagnostic.testedVariable}</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: "#FBE8C8", color: "#8B5A08" }}>En revisión</span></div><div className="text-[10px] mt-2" style={{ color: T.choco2 }}>{diagnostic.primarySignal}</div><div className="rounded-xl px-2.5 py-2 my-2 text-[10px]" style={{ background: "#fff" }}><b>Hipótesis:</b> {diagnostic.hypothesis}<br /><b>Siguiente prueba:</b> {diagnostic.recommendation}</div><div className="flex gap-2"><BtnAsync small confirmar onClick={() => resolve(diagnostic,"Aprobar")}>Aprobar aprendizaje</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolve(diagnostic,"Devolver")}>Devolver</BtnAsync></div></article>)}</div></div>}

      {center.learnings.length > 0 && <div><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: "#315B35" }}>Memoria aprobada de MOMOS</div><div className="grid xl:grid-cols-2 gap-3">{center.learnings.slice(0, 8).map((learning) => <article key={learning.id} className="rounded-2xl border p-3" style={{ borderColor: "#B8D3B2", background: "#F5FAF3" }}><div className="text-[9px] uppercase font-extrabold" style={{ color: "#315B35" }}>{learning.platform} · {learning.targetDurationSec}s · {learning.testedVariable}</div><div className="text-xs font-semibold mt-1">{learning.statement}</div><div className="text-[9px] mt-2" style={{ color: T.choco2 }}>Alcance exacto: {learning.audience} · aprobado {learning.approvedAt}</div></article>)}</div></div>}
    </div>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Este aprendizaje alimentará futuros guiones; nunca cambia campañas, genera contenido o publica por sí solo.</div>
  </section>;
}

function AgencySceneStudio({ db, refrescar }) {
  const studio = useMemo(() => buildAgencySceneStudio(db), [db]);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [contractId, setContractId] = useState("");
  const [boardForm, setBoardForm] = useState({
    title: "", channel: "Instagram", format: "Reel", aspectRatio: "9:16", targetDurationSec: 15,
    hook: "", payoff: "", callToAction: "Pedí el tuyo", visualThesis: "", estimatedCostCop: 0,
  });
  const emptyShot = (number = 1) => ({
    shotNumber: number, title: "", purpose: "", durationSec: 3, subject: "", action: "", physics: "",
    environment: "", camera: "", lighting: "", audio: "", onScreenText: "", continuityIn: "",
    continuityOut: "", avoid: "", assetIds: [], estimatedCostCop: 0,
  });
  const [shotForm, setShotForm] = useState(emptyShot());
  const [shotEditing, setShotEditing] = useState(false);
  const [storyboardReviewNote, setStoryboardReviewNote] = useState("");
  const selected = studio.storyboards.find((item) => String(item.id) === String(selectedId)) || null;
  const authorizedAssets = (db.brandMediaAssets || []).filter((asset) => asset.status === "Activo"
    && asset.rightsStatus === "Autorizado" && asset.aiUseAllowed);

  function startStoryboard() {
    const contract = studio.eligibleContracts[0];
    setContractId(contract ? String(contract.id) : "");
    setBoardForm({
      title: contract?.sealedPayload?.creative_direction?.concept || "", channel: "Instagram", format: "Reel",
      aspectRatio: "9:16", targetDurationSec: 15, hook: "", payoff: "",
      callToAction: contract?.sealedPayload?.creative_direction?.call_to_action || "Pedí el tuyo",
      visualThesis: "Producto real, iluminación cálida y lenguaje visual MOMOS.", estimatedCostCop: 0,
    });
    setCreateOpen(true);
  }

  async function createStoryboard() {
    const contract = studio.eligibleContracts.find((item) => String(item.id) === String(contractId));
    if (!contract) throw new Error("Elegí un contrato creativo aprobado.");
    const result = await crearStoryboardAgencia(storyboardPayload(boardForm, contract));
    setCreateOpen(false); setSelectedId(result.storyboard_id);
    toast("ok", result.duplicate ? "Ese storyboard ya estaba sellado." : "Storyboard abierto. Todavía no generó ni gastó nada.");
    await refrescar();
  }

  function newShot() {
    const next = (selected?.readiness?.activeShots?.length || 0) + 1;
    setShotForm(emptyShot(next)); setShotEditing(true);
  }

  function editShot(shot) {
    const payload = shot.payload || {};
    setShotForm({
      shotNumber: shot.shotNumber, title: shot.title, purpose: shot.purpose, durationSec: shot.durationSec,
      subject: payload.subject || "", action: payload.action || "", physics: payload.physics || "",
      environment: payload.environment || "", camera: payload.camera || "", lighting: payload.lighting || "",
      audio: payload.audio || "", onScreenText: payload.on_screen_text || "", continuityIn: payload.continuity_in || "",
      continuityOut: payload.continuity_out || "", avoid: payload.avoid || "", assetIds: shot.assetIds || [],
      estimatedCostCop: shot.estimatedCostCop || 0,
    });
    setShotEditing(true);
  }

  async function saveShot() {
    if (!selected) return;
    const result = await guardarTomaStoryboard(shotPayload(shotForm, selected));
    setShotEditing(false);
    toast("ok", result.duplicate ? "La toma ya estaba guardada." : `Toma ${shotForm.shotNumber} versionada y sellada.`);
    await refrescar();
  }

  async function submitStoryboard() {
    if (!selected) return;
    await enviarStoryboardRevision(selected.id);
    toast("ok", "Storyboard enviado a revisión humana. No inició generación.");
    await refrescar();
  }

  async function resolveStoryboard(decision) {
    if (!selected) return;
    const note = storyboardReviewNote.trim();
    if (!note) { toast("alert", decision === "Aprobar" ? "Escribí qué verificaste antes de aprobar la dirección." : "Escribí qué toma o continuidad debe corregirse."); return; }
    await resolverStoryboardAgencia(selected.id, decision, note);
    setStoryboardReviewNote("");
    toast("ok", decision === "Aprobar" ? "Storyboard aprobado. Aún no llamó a ningún proveedor." : "Storyboard devuelto a edición con trazabilidad.");
    await refrescar();
  }

  const statusTone = (status) => status === "Aprobado" ? { bg: "#DDEBD9", fg: "#315B35" }
    : status === "En revisión" ? { bg: "#E5EEF7", fg: "#315A7D" } : { bg: "#FFF2D8", fg: "#7A5410" };
  const money = (value) => fmt(Math.round(Number(value || 0)));

  return <div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#315A57,#47766C)", color: "#fff" }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "rgba(255,255,255,.15)" }}>🎬</div><div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Contrato aprobado → dirección por tomas</div><div className="display text-xl font-semibold">Estudio creativo MOMOS</div><div className="text-xs opacity-85 max-w-2xl">Guion visual, retención, física, continuidad, activos y costo quedan revisables antes de llamar a Kling, Higgsfield o cualquier motor.</div></div></div>
      <div className="flex items-center gap-2"><div className="grid grid-cols-3 gap-2">{[["Borrador",studio.summary.drafting],["Revisión",studio.summary.reviewing],["Tomas",studio.summary.shots]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[68px] text-center" style={{ background: "rgba(255,255,255,.13)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div><Btn small kind="soft" onClick={startStoryboard} disabled={!db.agencySceneStudioReady || studio.eligibleContracts.length === 0}>＋ Nuevo storyboard</Btn></div>
    </div>
    {!db.agencySceneStudioReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>estudio-escenas-v1.sql</code> después de la Mesa de Agencia. El Estudio permanecerá apagado hasta que el servidor confirme el contrato.</div>
      : studio.storyboards.length === 0 ? <div className="p-4 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Todavía no hay storyboards.</b> Aprobá primero un contrato en la Mesa cooperativa; luego convertí ese acuerdo en tomas verificables.</div>
        : <div className="p-3 grid lg:grid-cols-2 gap-2">{studio.storyboards.slice(0, 8).map((board) => { const tone = statusTone(board.status); return <button type="button" key={board.id} onClick={() => setSelectedId(board.id)} className="text-left rounded-2xl border p-3 transition hover:-translate-y-0.5" style={{ borderColor: board.readiness.ready ? "#B8D3B2" : T.border, background: "#FFF9F2" }}>
          <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold tracking-wider" style={{ color: T.coral }}>Storyboard #{board.id} · V{board.version}</div><div className="font-extrabold text-sm">{board.title}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{board.status}</span></div>
          <div className="flex flex-wrap gap-1.5 my-2"><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: "#E5EEF7" }}>{board.channel} · {board.format}</span><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>{board.aspectRatio} · {board.targetDurationSec}s</span><span className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: "#F3D7DC" }}>{board.readiness.activeShots.length} toma(s)</span></div>
          <div className="text-[10px]" style={{ color: T.choco2 }}>{board.readiness.ready ? `Listo para revisión · ${money(board.readiness.estimatedCostCop)} estimados` : board.readiness.reasons[0]}</div>
        </button>; })}</div>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Separación de responsabilidades: el Estudio diseña y aprueba; el siguiente hito autorizará qué motor puede ejecutar cada toma y con qué tope.</div>

    {createOpen && <Modal title="Abrir storyboard desde contrato aprobado" onClose={() => setCreateOpen(false)} wide topLayer>
      <div className="rounded-2xl px-4 py-3 mb-4 text-sm" style={{ background: T.vainilla }}><b>Primero fijamos la película en papel.</b> Hook, payoff y CTA se sellan aquí; ninguna llamada externa ocurre al guardar.</div>
      <Field label="Contrato creativo"><select className={inputCls} style={inputStyle} value={contractId} onChange={(event) => setContractId(event.target.value)}><option value="">Elegí un contrato…</option>{studio.eligibleContracts.map((contract) => <option key={contract.id} value={contract.id}>Contrato #{contract.id} · {contract.sealedPayload?.creative_direction?.concept || `Versión ${contract.version}`}</option>)}</select></Field>
      <Field label="Nombre de la pieza"><Input value={boardForm.title} onChange={(event) => setBoardForm({ ...boardForm, title: event.target.value })} /></Field>
      <div className="grid sm:grid-cols-4 gap-2"><Field label="Canal"><Select options={STORYBOARD_CHANNELS} value={boardForm.channel} onChange={(event) => setBoardForm({ ...boardForm, channel: event.target.value })} /></Field><Field label="Formato"><Select options={STORYBOARD_FORMATS} value={boardForm.format} onChange={(event) => setBoardForm({ ...boardForm, format: event.target.value })} /></Field><Field label="Proporción"><Select options={STORYBOARD_ASPECT_RATIOS} value={boardForm.aspectRatio} onChange={(event) => setBoardForm({ ...boardForm, aspectRatio: event.target.value })} /></Field><Field label="Duración (s)"><Input type="number" min="1" max="600" value={boardForm.targetDurationSec} onChange={(event) => setBoardForm({ ...boardForm, targetDurationSec: event.target.value })} /></Field></div>
      <div className="grid sm:grid-cols-2 gap-2"><Field label="Hook · promesa abierta"><textarea className={inputCls} style={inputStyle} rows="2" value={boardForm.hook} onChange={(event) => setBoardForm({ ...boardForm, hook: event.target.value })} /></Field><Field label="Payoff · respuesta"><textarea className={inputCls} style={inputStyle} rows="2" value={boardForm.payoff} onChange={(event) => setBoardForm({ ...boardForm, payoff: event.target.value })} /></Field></div>
      <Field label="Llamado a la acción"><Input value={boardForm.callToAction} onChange={(event) => setBoardForm({ ...boardForm, callToAction: event.target.value })} /></Field>
      <Field label="Tesis visual"><textarea className={inputCls} style={inputStyle} rows="2" value={boardForm.visualThesis} onChange={(event) => setBoardForm({ ...boardForm, visualThesis: event.target.value })} /></Field>
      <Field label="Costo total estimado (COP, informativo)"><Input type="number" min="0" value={boardForm.estimatedCostCop} onChange={(event) => setBoardForm({ ...boardForm, estimatedCostCop: event.target.value })} /></Field>
      <div className="flex gap-2"><BtnAsync onClick={createStoryboard} disabled={!contractId || boardForm.title.trim().length < 3 || boardForm.hook.trim().length < 2 || boardForm.payoff.trim().length < 2 || boardForm.callToAction.trim().length < 2}>Sellar storyboard</BtnAsync><Btn kind="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Btn></div>
    </Modal>}

    {selected && <Modal title={`Storyboard #${selected.id} · ${selected.title}`} onClose={() => { setSelectedId(null); setShotEditing(false); }} wide topLayer>
      <div className="grid lg:grid-cols-[1fr_300px] gap-4">
        <div><div className="flex flex-wrap items-center justify-between gap-2 mb-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>{selected.channel} · {selected.format} · {selected.aspectRatio}</div><div className="display text-lg font-semibold">{selected.targetDurationSec}s de historia dirigida</div></div>{selected.status === "Borrador" && <Btn small onClick={newShot}>＋ Agregar toma</Btn>}</div>
          <div className="space-y-2">{selected.readiness.activeShots.length === 0 ? <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: T.border, color: T.choco2 }}>Empezá con la toma 1. Cada toma necesita sujeto, acción, cámara y una salida de continuidad para que la siguiente escena sepa dónde retomar.</div> : selected.readiness.activeShots.map((shot) => <button type="button" key={shot.id} onClick={() => selected.status === "Borrador" && editShot(shot)} className="w-full text-left rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Toma {shot.shotNumber} · R{shot.revision} · {shot.durationSec}s</div><div className="font-extrabold text-sm">{shot.title}</div></div><span className="text-[10px] font-bold">{money(shot.estimatedCostCop)}</span></div><div className="text-[11px] mt-1" style={{ color: T.choco2 }}>{shot.purpose}</div><div className="rounded-xl px-2 py-1.5 mt-2 text-[10px]" style={{ background: "#E5EEF7", color: "#315A7D" }}>{shot.payload?.camera} → {shot.payload?.continuity_out}</div></button>)}</div>
        </div>
        <aside><div className="rounded-3xl p-4 border mb-3" style={{ borderColor: selected.readiness.ready ? "#B8D3B2" : "#E8C98B", background: selected.readiness.ready ? "#F4FAF2" : "#FFF8E8" }}><div className="text-[9px] uppercase font-extrabold">Control antes de generar</div><div className="display text-xl font-semibold">{selected.readiness.totalDurationSec.toFixed(1)} / {selected.targetDurationSec}s</div><div className="text-xs mb-2">{selected.readiness.activeShots.length} toma(s) · {money(selected.readiness.estimatedCostCop)}</div>{selected.readiness.reasons.map((reason) => <div key={reason} className="text-[10px] mb-1">• {reason}</div>)}</div>
          <div className="rounded-2xl px-3 py-2 mb-3 text-[10px]" style={{ background: T.vainilla }}><b>Hook:</b> {selected.creativeBrief?.hook}<br /><b>Payoff:</b> {selected.creativeBrief?.payoff}<br /><b>CTA:</b> {selected.creativeBrief?.call_to_action}</div>
          {selected.status === "Borrador" && <BtnAsync onClick={submitStoryboard} disabled={!selected.readiness.ready}>Enviar a revisión humana</BtnAsync>}
          {selected.status === "En revisión" && <div className="flex flex-col gap-2"><Input aria-label="Nota de revisión del storyboard" value={storyboardReviewNote} onChange={(event) => setStoryboardReviewNote(event.target.value)} placeholder="Qué verificaste o qué debe corregirse" /><BtnAsync confirmar disabled={!storyboardReviewNote.trim()} onClick={() => resolveStoryboard("Aprobar")}>Aprobar dirección</BtnAsync><BtnAsync kind="ghost" disabled={!storyboardReviewNote.trim()} onClick={() => resolveStoryboard("Devolver")}>Devolver a edición</BtnAsync></div>}
          {selected.status === "Aprobado" && <div className="rounded-2xl px-3 py-3 text-xs font-bold" style={{ background: "#DDEBD9", color: "#315B35" }}>✓ Dirección aprobada y sellada. No se ha generado ni publicado ninguna toma.</div>}
        </aside>
      </div>
      {shotEditing && selected.status === "Borrador" && <div className="rounded-3xl border p-4 mt-5" style={{ borderColor: "#D7C5B2", background: "#FFFAF5" }}><div className="flex items-center justify-between gap-2 mb-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Dirección verificable</div><div className="display text-lg font-semibold">Toma {shotForm.shotNumber}</div></div><Btn small kind="ghost" onClick={() => setShotEditing(false)}>Cerrar editor</Btn></div>
        <div className="grid sm:grid-cols-3 gap-2"><Field label="Número"><Input type="number" min="1" value={shotForm.shotNumber} onChange={(event) => setShotForm({ ...shotForm, shotNumber: event.target.value })} /></Field><Field label="Duración (s)"><Input type="number" min="0.1" step="0.1" value={shotForm.durationSec} onChange={(event) => setShotForm({ ...shotForm, durationSec: event.target.value })} /></Field><Field label="Costo estimado"><Input type="number" min="0" value={shotForm.estimatedCostCop} onChange={(event) => setShotForm({ ...shotForm, estimatedCostCop: event.target.value })} /></Field></div>
        <div className="grid sm:grid-cols-2 gap-2"><Field label="Título"><Input value={shotForm.title} onChange={(event) => setShotForm({ ...shotForm, title: event.target.value })} /></Field><Field label="Propósito"><Input value={shotForm.purpose} onChange={(event) => setShotForm({ ...shotForm, purpose: event.target.value })} /></Field><Field label="Sujeto"><Input value={shotForm.subject} onChange={(event) => setShotForm({ ...shotForm, subject: event.target.value })} /></Field><Field label="Acción"><Input value={shotForm.action} onChange={(event) => setShotForm({ ...shotForm, action: event.target.value })} /></Field><Field label="Física y movimiento"><Input value={shotForm.physics} onChange={(event) => setShotForm({ ...shotForm, physics: event.target.value })} /></Field><Field label="Entorno"><Input value={shotForm.environment} onChange={(event) => setShotForm({ ...shotForm, environment: event.target.value })} /></Field><Field label="Cámara"><Input value={shotForm.camera} onChange={(event) => setShotForm({ ...shotForm, camera: event.target.value })} /></Field><Field label="Iluminación"><Input value={shotForm.lighting} onChange={(event) => setShotForm({ ...shotForm, lighting: event.target.value })} /></Field><Field label="Audio"><Input value={shotForm.audio} onChange={(event) => setShotForm({ ...shotForm, audio: event.target.value })} /></Field><Field label="Texto en pantalla"><Input value={shotForm.onScreenText} onChange={(event) => setShotForm({ ...shotForm, onScreenText: event.target.value })} /></Field><Field label="Continuidad de entrada"><Input value={shotForm.continuityIn} onChange={(event) => setShotForm({ ...shotForm, continuityIn: event.target.value })} /></Field><Field label="Continuidad de salida"><Input value={shotForm.continuityOut} onChange={(event) => setShotForm({ ...shotForm, continuityOut: event.target.value })} /></Field></div>
        <Field label="Evitar"><Input value={shotForm.avoid} onChange={(event) => setShotForm({ ...shotForm, avoid: event.target.value })} placeholder="Deformaciones, texto ilegible, producto distinto…" /></Field>
        {authorizedAssets.length > 0 && <Field label="Referencias de marca autorizadas"><div className="flex flex-wrap gap-2">{authorizedAssets.slice(0, 20).map((asset) => { const checked = shotForm.assetIds.includes(Number(asset.id)); return <label key={asset.id} className="rounded-full px-3 py-2 text-[10px] font-bold cursor-pointer" style={{ background: checked ? "#DDEBD9" : T.vainilla }}><input type="checkbox" className="mr-1" checked={checked} onChange={() => setShotForm({ ...shotForm, assetIds: checked ? shotForm.assetIds.filter((id) => id !== Number(asset.id)) : [...shotForm.assetIds, Number(asset.id)] })} />{asset.name}</label>; })}</div></Field>}
        <BtnAsync onClick={saveShot} disabled={shotForm.title.trim().length < 2 || shotForm.purpose.trim().length < 2 || shotForm.subject.trim().length < 2 || shotForm.action.trim().length < 2 || shotForm.camera.trim().length < 2 || shotForm.continuityOut.trim().length < 2}>Guardar revisión de toma</BtnAsync>
      </div>}
    </Modal>}
  </div>;
}

function AgencyMotionExperience({ db, refrescar }) {
  const center = useMemo(() => buildAgencyMotionCenter(db), [db]);
  const [boardId, setBoardId] = useState("");
  const [selections, setSelections] = useState({});
  const [reviewNotes, setReviewNotes] = useState({});
  const board = center.eligibleStoryboards.find((item) => String(item.id) === String(boardId)) || null;
  const draft = useMemo(() => board
    ? buildMotionPlanDraft(board, db.agencyStoryboardShots || [], selections)
    : null, [board, db.agencyStoryboardShots, selections]);

  async function prepare() {
    if (!db.agencyMotionReady) throw new Error("Aplicá la migración 36 de Dirección de motion.");
    if (!draft?.ready) throw new Error(draft?.reasons?.[0] || "La dirección de motion todavía no está lista.");
    const result = await prepararPlanMotion(motionPlanPayload(draft, "MOMO OPS Motion Director"));
    setBoardId(""); setSelections({});
    toast("ok", result.duplicate
      ? "Esa dirección ya estaba sellada."
      : "Dirección de cámara y luz preparada para revisión. No generó, gastó ni publicó.");
    await refrescar();
  }

  async function resolve(plan, decision) {
    const note = String(reviewNotes[plan.id] || "").trim();
    if (!note) throw new Error(decision === "Aprobar"
      ? "Escribí qué verificaste antes de aprobar la dirección."
      : "Escribí qué debe corregirse por toma.");
    await resolverPlanMotion(plan.id, decision, note);
    setReviewNotes((current) => { const next = { ...current }; delete next[plan.id]; return next; });
    toast("ok", decision === "Aprobar"
      ? "Motion aprobado: el Enrutador ya puede asignar motores y topes. Aún no se generó nada."
      : "Plan devuelto con corrección trazable.");
    await refrescar();
  }

  const planTone = (status) => status === "Aprobado" ? { bg: "#DDEBD9", fg: "#315B35" }
    : status === "En revisión" ? { bg: "#FFF0CE", fg: "#8B5A08" } : { bg: "#F3D7DC", fg: "#8E4B5A" };

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#7C3F2D,#B86445)", color: "#fff" }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "rgba(255,255,255,.15)" }}>🎥</div><div>
        <div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Storyboard → cámara, luz, física y continuidad</div>
        <div className="display text-xl font-semibold">Dirección de motion MOMOS</div>
        <div className="text-xs opacity-85 max-w-2xl">Define por qué se mueve la cámara, cómo responde la materia y qué debe conservar el corte. El humano elige una propuesta por toma antes de permitir el Enrutador.</div>
      </div></div>
      <div className="grid grid-cols-4 gap-2 shrink-0">{[["Por dirigir",center.summary.eligible],["Revisión",center.summary.reviewing],["Aprobados",center.summary.approved],["Aprendizajes",center.summary.observations]].map(([label,value]) => <div key={label} className="rounded-2xl px-2.5 py-2 min-w-[64px] text-center" style={{ background: "rgba(255,255,255,.13)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[7px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencyMotionReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>experiencia-motion-v1.sql</code> después del Hito 35. Hasta entonces el Enrutador no recibirá recetas de cámara aprobadas.</div> : <>
      {center.eligibleStoryboards.length > 0 && <div className="p-4 border-b" style={{ borderColor: T.border }}>
        <div className="flex flex-wrap items-end gap-2 mb-3"><Field label="Storyboard aprobado sin motion"><select className={inputCls} style={{ ...inputStyle, minWidth: 300 }} value={boardId} onChange={(event) => { setBoardId(event.target.value); setSelections({}); }}><option value="">Elegí una pieza…</option>{center.eligibleStoryboards.map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.title} · {item.channel}</option>)}</select></Field>{draft && <div className="pb-3 text-[10px] font-bold" style={{ color: draft.ready ? "#315B35" : "#A03B2A" }}>{draft.ready ? `● ${draft.shotRecipes.length} tomas cubiertas · $0 comprometidos` : `× ${draft.reasons[0]}`}</div>}</div>
        {draft && <div className="space-y-3">{draft.shotRecipes.map(({ shot, proposals, selected }) => <article key={shot.id} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}>
          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-3"><div className="min-w-0"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Toma {shot.shotNumber} · {selected?.intent?.narrativeJob}</div><div className="font-extrabold text-sm">{shot.title}</div><div className="text-[10px] mt-1" style={{ color: T.choco2 }}>Una intención · un movimiento principal · una fuente de luz motivada.</div></div>
            <div className="flex flex-wrap gap-2">{proposals.map((proposal) => <button type="button" key={proposal.proposalKey} onClick={() => setSelections((current) => ({ ...current, [shot.id]: proposal.proposalKey }))} className="rounded-xl border px-3 py-2 text-left transition" style={{ borderColor: proposal.selected ? T.coral : T.border, background: proposal.selected ? "#F8E0D8" : "#fff" }}><div className="text-[10px] font-extrabold">{proposal.label}</div><div className="text-[8px]" style={{ color: T.choco2 }}>{proposal.cameraPath.rigFeel} · {proposal.handheldProfile.mode}</div></button>)}</div>
          </div>
          {selected && <div className="grid md:grid-cols-4 gap-2 mt-3 text-[10px]"><div className="rounded-xl p-2.5" style={{ background: "#F5E8D2" }}><b>Cámara</b><br />{selected.cameraPath.primaryMove}<br /><span style={{ color: T.choco2 }}>Inercia {selected.cameraPath.acceleration}; {selected.cameraPath.settle}.</span></div><div className="rounded-xl p-2.5" style={{ background: "#F6E6D9" }}><b>Luz y sombra</b><br />{selected.lightingMap.motivatedSource}<br /><span style={{ color: T.choco2 }}>{selected.lightingMap.shadowBehavior}</span></div><div className="rounded-xl p-2.5" style={{ background: "#E7EFE5" }}><b>Física</b><br />{selected.physics.contact}<br /><span style={{ color: T.choco2 }}>{selected.physics.weightResistance}</span></div><div className="rounded-xl p-2.5" style={{ background: "#E7EDF2" }}><b>Siguiente corte</b><br />{selected.transitionToNext.type}<br /><span style={{ color: T.choco2 }}>{selected.transitionToNext.intentionalChange}</span></div></div>}
        </article>)}<div className="rounded-2xl px-3 py-3 flex flex-wrap items-center justify-between gap-3" style={{ background: T.vainilla }}><div className="text-xs"><b>{draft.grammarPrimary}</b>{draft.grammarSecondary !== draft.grammarPrimary ? ` + ${draft.grammarSecondary}` : ""}<div className="text-[9px]" style={{ color: T.choco2 }}>Costo preliminar informativo {fmt(draft.estimatedPreviewCostCop)} · preparar cuesta $0.</div></div><BtnAsync onClick={prepare} disabled={!draft.ready}>Sellar dirección para revisión</BtnAsync></div></div>}
      </div>}
      <div className="p-3 grid lg:grid-cols-2 gap-2">{center.plans.slice(0, 8).map((plan) => { const tone = planTone(plan.status); const note = reviewNotes[plan.id] || ""; return <article key={plan.id} className="rounded-2xl border p-3" style={{ borderColor: plan.status === "En revisión" ? "#E8C98B" : T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Motion #{plan.id} · V{plan.version}</div><div className="font-extrabold text-sm">{plan.storyboard?.title || `Storyboard #${plan.storyboardId}`}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{plan.status}</span></div><div className="flex flex-wrap gap-1.5 my-2">{plan.recipes.map((recipe) => <span key={recipe.id} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: "#F5E8D2" }}>T{recipe.shotNumber} · {recipe.selectedRecipe?.intent?.narrative_job || recipe.selectedKey}</span>)}</div><div className="text-[10px] mb-2" style={{ color: T.choco2 }}>{plan.grammarPrimary} · huella {plan.fingerprint?.slice(0, 8)} · {plan.recipes.length} receta(s)</div>{plan.status === "En revisión" && <div className="space-y-2"><textarea className={inputCls} style={{ ...inputStyle, minHeight: 72 }} value={note} onChange={(event) => setReviewNotes((current) => ({ ...current, [plan.id]: event.target.value }))} placeholder="Qué verificaste o qué debe corregirse por toma…" aria-label={`Nota de revisión motion ${plan.id}`} /><div className="flex gap-2"><BtnAsync small confirmar disabled={!note.trim()} onClick={() => resolve(plan,"Aprobar")}>Aprobar motion</BtnAsync><BtnAsync small kind="ghost" disabled={!note.trim()} onClick={() => resolve(plan,"Devolver")}>Devolver</BtnAsync></div></div>}{plan.status === "Aprobado" && <div className="rounded-xl px-2.5 py-2 text-[10px] font-bold" style={{ background: "#DDEBD9", color: "#315B35" }}>✓ Enrutador habilitado · generación y publicación siguen bloqueadas</div>}</article>; })}{center.plans.length === 0 && center.eligibleStoryboards.length === 0 && <div className="p-2 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Sin piezas pendientes.</b> Cuando el Estudio apruebe un storyboard aparecerá aquí.</div>}</div>
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Contrato seguro: aprobar motion cuesta $0 y no llama motores. El Enrutador consume únicamente la receta seleccionada y sellada de cada toma.</div>
  </section>;
}

function AgencySceneRouter({ db, refrescar }) {
  const center = useMemo(() => buildAgencySceneRouter(db), [db]);
  const [boardId, setBoardId] = useState("");
  const [overrides, setOverrides] = useState({});
  const board = center.eligibleStoryboards.find((item) => String(item.id) === String(boardId)) || null;
  const draft = useMemo(() => board
    ? buildSceneRoutingDraft(board, db.agencyStoryboardShots || [], db, overrides)
    : null, [board, db, overrides]);

  function patchRoute(shotId, values) {
    setOverrides((current) => ({ ...current, [shotId]: { ...(current[shotId] || {}), ...values } }));
  }

  async function prepareRoutes() {
    if (!db.agencySceneRouterReady) throw new Error("Aplicá la migración 32 del Enrutador de escenas.");
    if (!draft?.ready) throw new Error(draft?.reasons?.[0] || "El plan no está listo.");
    const result = await prepararEnrutamientoEscenas(sceneRoutingPayload(draft, "MOMO OPS Router"));
    setBoardId(""); setOverrides({});
    toast("ok", result.duplicate ? "Ese enrutamiento ya estaba sellado." : "Ruta preparada. Ningún motor fue llamado todavía.");
    await refrescar();
  }

  async function resolvePlan(plan, decision) {
    const note = decision === "Descartar"
      ? (window.prompt("¿Por qué descartamos este enrutamiento?", "Se ajustará la dirección o el costo") || "")
      : "Autorización humana de motores y topes por escena";
    if (!note) return;
    const result = await resolverEnrutamientoEscenas(plan.id, decision, note);
    toast("ok", decision === "Autorizar"
      ? `${result.job_ids?.length || 0} toma(s) autorizadas para la cola privada. Aún no se publicó nada.`
      : "Enrutamiento descartado con trazabilidad.");
    await refrescar();
  }

  return <div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#243D37,#355E53)", color: "#fff" }}>
      <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Motion aprobado → motor controlado</div><div className="display text-xl font-semibold">Enrutador de escenas MOMOS</div><div className="text-xs opacity-80 max-w-2xl">Consume la cámara y luz ya aprobadas, elige el motor por capacidad y sella costo y riesgo por toma. Los workers ejecutan después; publicar sigue siendo otro paso.</div></div>
      <div className="grid grid-cols-3 gap-2 shrink-0">{[["Por autorizar",center.summary.prepared],["Autorizados",center.summary.authorized],["Trabajos",center.summary.jobs]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[74px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencySceneRouterReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>enrutador-escenas-v1.sql</code>. Hasta entonces MOMO OPS no creará trabajos desde storyboards.</div> : <>
      <div className="p-4 border-b" style={{ borderColor: T.border }}>
        <div className="flex flex-wrap items-end gap-2"><Field label="Storyboard + motion aprobados"><select className={inputCls} style={{ ...inputStyle, minWidth: 280 }} value={boardId} onChange={(event) => { setBoardId(event.target.value); setOverrides({}); }}><option value="">Elegí una pieza dirigida sin enrutar…</option>{center.eligibleStoryboards.map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.title} · {item.channel}</option>)}</select></Field>{draft && <div className="pb-3 text-[10px] font-bold" style={{ color: draft.operational ? "#315B35" : "#9A5B16" }}>{draft.operational ? "● Motores disponibles ahora" : `● Plan documentable; ${draft.operationalReasons[0] || "conector no disponible"}`}</div>}</div>
        {draft && <div className="space-y-2 mt-1">{draft.routes.map((route) => <article key={route.shotId} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}>
          <div className="grid lg:grid-cols-[1fr_160px_140px_140px] gap-2 items-end"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Toma {route.shotNumber} · riesgo {route.riskLevel}</div><div className="font-extrabold text-sm">{route.title}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{route.capability} · {route.rationale}</div></div><Field label="Motor"><Select options={SCENE_ROUTE_PROVIDERS} value={route.provider} onChange={(event) => patchRoute(route.shotId, { provider: event.target.value })} /></Field><Field label="Estimado COP"><Input type="number" min="1" value={route.estimatedCostCop || ""} onChange={(event) => patchRoute(route.shotId, { estimatedCostCop: event.target.value })} /></Field><Field label="Tope COP"><Input type="number" min="1" value={route.maxCostCop || ""} onChange={(event) => patchRoute(route.shotId, { maxCostCop: event.target.value })} /></Field></div>
        </article>)}<div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-3" style={{ background: T.vainilla }}><div className="text-xs"><b>{draft.routes.length} toma(s)</b> · estimado {fmt(draft.totalEstimatedCostCop)} · tope {fmt(draft.totalCostCapCop)}{draft.reasons.map((reason) => <div key={reason} className="text-red-700">× {reason}</div>)}</div><BtnAsync onClick={prepareRoutes} disabled={!draft.ready}>Sellar ruta multimotor</BtnAsync></div></div>}
      </div>
      <div className="p-3 grid lg:grid-cols-2 gap-2">{center.plans.slice(0, 8).map((plan) => { const routes = plan.snapshot?.routes || []; const tone = statusTone(plan.status); return <article key={plan.id} className="rounded-2xl border p-3" style={{ borderColor: plan.status === "Preparado" ? "#E8C98B" : T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Ruta #{plan.id} · V{plan.version}</div><div className="font-extrabold text-sm">{plan.storyboard?.title || `Storyboard #${plan.storyboardId}`}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{plan.status}</span></div><div className="flex flex-wrap gap-1 my-2">{routes.map((route) => <span key={route.shot_id} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: route.provider === "Kling" ? "#E5EEF7" : "#F3D7DC" }}>T{route.shot_number} · {route.provider}</span>)}</div><div className="text-[10px] mb-2" style={{ color: T.choco2 }}>Estimado {fmt(plan.totalEstimatedCostCop)} · tope humano {fmt(plan.totalCostCapCop)} · huella {plan.fingerprint?.slice(0, 8)}</div>{plan.status === "Preparado" && <div className="flex gap-2"><BtnAsync small confirmar onClick={() => resolvePlan(plan, "Autorizar")}>Autorizar {routes.length} toma(s)</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolvePlan(plan, "Descartar")}>Descartar</BtnAsync></div>}{plan.status === "Autorizado" && <div className="rounded-xl px-2.5 py-2 text-[10px] font-bold" style={{ background: "#DDEBD9", color: "#315B35" }}>✓ {plan.jobIds.length} trabajo(s) en colas privadas · publicación: bloqueada</div>}</article>; })}{center.plans.length === 0 && <div className="p-2 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>No hay rutas selladas.</b> Aprobá un storyboard y asigná su motor por toma.</div>}</div>
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Arquitectura segura: preparar no gasta; autorizar crea la cola atómicamente; el worker genera; Revisión Creativa decide; Distribución publica por separado.</div>
  </div>;
}

function AgencyQualityControl({ db, refrescar }) {
  const center = useMemo(() => buildAgencyQualityCenter(db), [db]);
  const exportCenter = useMemo(() => buildPostproductionExportCenter(db), [db]);
  const exportWorker = (db.agencyPostproductionWorkers || [])[0] || null;
  const [reviewJob, setReviewJob] = useState(null);
  const [scores, setScores] = useState(() => Object.fromEntries(AGENCY_QUALITY_CRITERIA.map(({ key }) => [key, 2])));
  const [failureType, setFailureType] = useState("Fallo técnico");
  const [note, setNote] = useState("");
  const [continuity, setContinuity] = useState("");
  const [audioByPackage, setAudioByPackage] = useState({});
  const today = businessDateISO();
  const audioAssets = useMemo(() => (db.brandMediaAssets || []).filter((asset) => asset.mediaType === "Audio" && asset.status === "Activo"
    && ["Propio", "Autorizado"].includes(asset.rightsStatus) && (!asset.rightsExpiresAt || asset.rightsExpiresAt >= today)
    && ["audio/mpeg", "audio/mp4", "audio/wav"].includes(asset.mimeType) && asset.storagePath && /^[0-9a-f]{64}$/i.test(asset.contentHash || "")
    && Number(asset.sizeBytes) > 0 && Number(asset.durationSeconds) > 0 && Number(asset.durationSeconds) <= 1800), [db.brandMediaAssets, today]);
  const outputAsset = reviewJob ? (db.brandMediaAssets || []).find((item) => String(item.id) === String(reviewJob.outputAssetId)) : null;
  const rightsValid = Boolean(outputAsset && outputAsset.status === "Activo" && outputAsset.rightsStatus === "Autorizado");
  const evaluation = useMemo(() => evaluateSceneQuality(scores, rightsValid), [scores, rightsValid]);

  function openReview(job) {
    const shot = (db.agencyStoryboardShots || []).find((item) => String(item.id) === String(job.outputSpec?.storyboard_shot_id));
    setReviewJob(job); setScores(Object.fromEntries(AGENCY_QUALITY_CRITERIA.map(({ key }) => [key, 2])));
    setFailureType("Fallo técnico"); setNote("");
    setContinuity(shot?.payload?.continuity_out ? `La salida conserva: ${shot.payload.continuity_out}` : "Entrada y salida comparadas contra el storyboard");
  }

  async function saveQualityReview() {
    const payload = sceneQualityReviewPayload(reviewJob, scores, {
      rightsValid, failureType, reviewNote: note || (evaluation.approved ? "Producto, marca, física y continuidad verificados" : "La toma requiere una nueva versión"),
      continuityObservation: continuity, findings: evaluation.reasons,
    });
    const result = await registrarRevisionCalidadEscena(payload);
    setReviewJob(null);
    toast(result.status === "Aprobada" ? "ok" : "alert", result.status === "Aprobada"
      ? `Toma aprobada para postproducción · ${result.score_total}/22.`
      : `Toma clasificada como ${result.failure_type}; no entrará al corte.`);
    await refrescar();
  }

  async function resolveAgentReview(review, decision) {
    const failure = decision === "Aprobar" ? "Pendiente" : "Fallo técnico";
    const resolution = window.prompt(decision === "Aprobar" ? "¿Qué verificaste antes de aprobar?" : "¿Qué debe corregirse?",
      decision === "Aprobar" ? "Producto, física, luz y continuidad verificados" : "Corregir la salida antes de regenerar") || "";
    if (!resolution) return;
    await resolverRevisionCalidadEscena(review.id, decision, failure, resolution);
    toast("ok", decision === "Aprobar" ? "Control del agente aprobado por humano." : "Hallazgo del agente clasificado y devuelto.");
    await refrescar();
  }

  const packageCandidates = useMemo(() => (db.agencySceneRoutingPlans || []).filter((plan) => plan.status === "Autorizado").map((plan) => {
    const storyboard = (db.agencyStoryboards || []).find((item) => String(item.id) === String(plan.storyboardId));
    const activeShots = (db.agencyStoryboardShots || []).filter((shot) => String(shot.storyboardId) === String(plan.storyboardId) && shot.status === "Vigente");
    const approved = center.approved.filter((review) => String(review.routingPlanId) === String(plan.id));
    const alreadyPackaged = center.packages.some((item) => String(item.routingPlanId) === String(plan.id) && !["Devuelto", "Anulado"].includes(item.status));
    return { plan, storyboard, activeShots, approved, ready: Boolean(storyboard) && activeShots.length > 0 && approved.length === activeShots.length && !alreadyPackaged };
  }).filter((item) => item.ready), [db.agencySceneRoutingPlans, db.agencyStoryboards, db.agencyStoryboardShots, center.approved, center.packages]);

  async function preparePackage(candidate) {
    const payload = postproductionPackagePayload(candidate.storyboard, candidate.plan, candidate.approved);
    const result = await prepararPaquetePostproduccion(payload);
    toast("ok", `${candidate.approved.length} toma(s) selladas para postproducción. Falta aprobación del corte.`);
    if (result.duplicate) toast("alert", "Ese paquete ya existía; no se duplicó.");
    await refrescar();
  }

  async function resolvePackage(item, decision) {
    const noteText = window.prompt(decision === "Aprobar" ? "¿Qué validaste en el corte final?" : "¿Qué debe corregir postproducción?",
      decision === "Aprobar" ? "Orden, audio, subtítulos, color y continuidad verificados" : "Ajustar el corte antes de aprobar") || "";
    if (!noteText) return;
    await resolverPaquetePostproduccion(item.id, decision, noteText);
    toast("ok", decision === "Aprobar" ? "Corte aprobado. Publicación y pauta siguen bloqueadas." : "Corte devuelto con instrucciones trazables.");
    await refrescar();
  }

  async function authorizeExport(pkg) {
    const selectedId = audioByPackage[String(pkg.id)] || "";
    const audioAsset = audioAssetsForPackage(pkg).find((asset) => String(asset.id) === String(selectedId)) || null;
    const payload = postproductionExportPayload(pkg, { audioAsset });
    const result = await autorizarExportacionPostproduccion(payload);
    toast("ok", result.duplicate
      ? "La exportación ya estaba autorizada; no se duplicó."
      : `Máster autorizado con audio ${audioAsset ? `de Biblioteca · ${audioAsset.name}` : "original de las tomas"}. Aún no existe archivo ni publicación.`);
    await refrescar();
  }

  function audioAssetsForPackage(pkg) {
    const channel = String(pkg.storyboard?.channel || pkg.snapshot?.export_spec?.channel || "").trim().toLowerCase();
    return audioAssets.filter((asset) => {
      const allowed = Array.isArray(asset.allowedChannels) ? asset.allowedChannels.map((item) => String(item).trim().toLowerCase()) : [];
      return allowed.length === 0 || allowed.includes(channel) || allowed.includes("todos") || allowed.includes("all");
    });
  }

  async function resolveMaster(item, decision) {
    const evaluation = evaluatePostproductionMaster(item, item.outputAsset);
    if (decision === "Aprobar" && !evaluation.approved) {
      toast("alert", evaluation.reasons[0] || "El máster no supera el control técnico.");
      return;
    }
    const suggested = decision === "Aprobar"
      ? "Resolución, FPS, audio, color, peso y continuidad verificados"
      : "Corregir el máster antes de enviarlo a Distribución";
    const noteText = window.prompt(decision === "Aprobar" ? "¿Qué verificaste en el máster?" : "¿Qué debe corregirse?", suggested) || "";
    if (noteText.trim().length < 5) return;
    await resolverControlMasterPostproduccion(item.id, decision, noteText.trim());
    toast("ok", decision === "Aprobar" ? "Máster aprobado. Distribución y publicación siguen siendo pasos separados." : "Máster rechazado con corrección trazable.");
    await refrescar();
  }

  async function retryExport(item) {
    const noteText = window.prompt("¿Por qué es seguro reintentar este fallo definitivo?", "FFmpeg no produjo archivo; reintentar con el mismo contrato sellado") || "";
    if (noteText.trim().length < 5) return;
    await reintentarExportacionPostproduccion(item.id, noteText.trim());
    toast("ok", "Reintento autorizado. Los resultados inciertos nunca se reenvían.");
    await refrescar();
  }

  return <div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#5B2947,#7A3D5D)", color: "#fff" }}>
      <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Salida generada → corte verificable</div><div className="display text-xl font-semibold">Calidad y postproducción MOMOS</div><div className="text-xs opacity-80 max-w-2xl">Protege producto, marca, física, cámara, luz y continuidad. Una falla crítica no se promedia y ningún corte autoriza publicación.</div></div>
      <div className="grid grid-cols-4 gap-2 shrink-0">{[["Por revisar",center.summary.waiting + center.summary.pending],["Aprobadas",center.summary.approved],["Cortes",center.summary.packagesApproved],["Másters",exportCenter.summary.approved]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[70px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencyQualityReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>calidad-postproduccion-v1.sql</code>. La generación sigue disponible, pero ninguna salida se declarará lista para corte.</div> : <>
      <div className="p-4 border-b" style={{ borderColor: T.border }}>
        <div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: T.coral }}>Control por toma</div>
        <div className="grid lg:grid-cols-2 gap-2">{center.eligibleJobs.map((job) => { const shot = (db.agencyStoryboardShots || []).find((item) => String(item.id) === String(job.outputSpec?.storyboard_shot_id)); return <article key={job.id} className="rounded-2xl border p-3 flex items-center gap-3" style={{ borderColor: T.border, background: "#FFF9F2" }}><div className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#F3D7DC" }}>◉</div><div className="flex-1 min-w-0"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Toma {shot?.shotNumber || "?"} · {job.provider}</div><div className="font-extrabold text-sm truncate">{shot?.title || job.operation}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Salida #{job.outputAssetId} · revisión creativa aprobada</div></div><Btn small onClick={() => openReview(job)}>Evaluar toma</Btn></article>; })}
          {center.eligibleJobs.length === 0 && center.pending.length === 0 && <div className="text-sm p-2" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>No hay salidas esperando control.</b> Aparecerán cuando el motor complete una toma y pase la revisión creativa humana.</div>}
        </div>
        {center.pending.length > 0 && <div className="mt-3 space-y-2">{center.pending.map((review) => <article key={review.id} className="rounded-2xl border p-3 flex flex-wrap items-center gap-2" style={{ borderColor: "#E8C98B", background: "#FFF7E8" }}><div className="flex-1"><div className="text-[9px] uppercase font-extrabold">Propuesta del agente · toma {review.shot?.shotNumber}</div><div className="text-sm font-extrabold">{review.scoreTotal}/22 · requiere decisión humana</div></div><BtnAsync small confirmar onClick={() => resolveAgentReview(review, "Aprobar")}>Aprobar</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveAgentReview(review, "Rechazar")}>Clasificar falla</BtnAsync></article>)}</div>}
      </div>
      <div className="p-4 border-b" style={{ borderColor: T.border }}><div className="flex flex-wrap items-center justify-between gap-2 mb-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Postproducción</div><div className="font-extrabold text-sm">Tomas, audio, subtítulos y decisiones de corte</div></div></div>
        <div className="grid lg:grid-cols-2 gap-2">{packageCandidates.map((candidate) => <article key={candidate.plan.id} className="rounded-2xl border p-3 flex items-center gap-3" style={{ borderColor: "#B8D3B2", background: "#F4FAF1" }}><div className="flex-1"><div className="text-[9px] uppercase font-extrabold" style={{ color: "#315B35" }}>{candidate.approved.length} toma(s) aprobadas</div><div className="font-extrabold text-sm">{candidate.storyboard.title}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Cobertura exacta · lista para preparar corte</div></div><BtnAsync small onClick={() => preparePackage(candidate)}>Preparar corte</BtnAsync></article>)}
          {center.packages.map((item) => { const tone = statusTone(item.status); return <article key={item.id} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Paquete #{item.id} · V{item.version}</div><div className="font-extrabold text-sm">{item.storyboard?.title || `Storyboard #${item.storyboardId}`}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{item.status}</span></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}>{item.snapshot?.selections?.length || 0} tomas · publicación bloqueada · huella {item.fingerprint?.slice(0, 8)}</div>{item.status === "Preparado" && <div className="flex gap-2"><BtnAsync small confirmar onClick={() => resolvePackage(item, "Aprobar")}>Aprobar corte final</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolvePackage(item, "Devolver")}>Devolver</BtnAsync></div>}</article>; })}
        </div>
      </div>
      <div className="p-4 border-b" style={{ borderColor: T.border, background: "#FBF7F1" }}>
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Exportación verificable</div><div className="font-extrabold text-sm">Del corte aprobado al archivo máster real</div><div className="text-[10px]" style={{ color: T.choco2 }}>MP4 · H.264 · AAC · BT.709 · hash y probe técnico · revisión humana final</div></div>
          {db.agencyPostproductionExportReady && <span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: exportWorker?.ffmpegAvailable ? "#DDEBD9" : "#FFF2D8", color: exportWorker?.ffmpegAvailable ? "#315B35" : "#7A5410" }}>{exportWorker?.ffmpegAvailable ? `Worker disponible · ${exportWorker.version}` : "Worker pendiente · no hay FFmpeg activo"}</span>}
        </div>
        {!db.agencyPostproductionExportReady ? <div className="rounded-2xl px-3 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>postproduccion-exportacion-v1.sql</code>. Hasta entonces un corte aprobado no puede declararse archivo final.</div> : <div className="grid lg:grid-cols-2 gap-2">
          {exportCenter.candidates.map((pkg) => <article key={`candidate-${pkg.id}`} className="rounded-2xl border p-3" style={{ borderColor: "#B8D3B2", background: "#F4FAF1" }}><div className="flex flex-col sm:flex-row sm:items-end gap-3"><div className="flex-1"><div className="text-[9px] uppercase font-extrabold" style={{ color: "#315B35" }}>Corte #{pkg.id} · V{pkg.version} aprobado</div><div className="font-extrabold text-sm">Autorizar máster operativo</div><div className="text-[10px] mb-2" style={{ color: T.choco2 }}>Elegí audio original o una pista vigente de la Biblioteca. La mezcla queda sellada y no publica.</div><label className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Audio del máster</label><select className={`${inputCls} mt-1`} style={inputStyle} value={audioByPackage[String(pkg.id)] || ""} onChange={(event) => setAudioByPackage((current) => ({ ...current, [String(pkg.id)]: event.target.value }))} disabled={!db.agencyPostproductionAudioReady}><option value="">Audio original de las tomas</option>{audioAssetsForPackage(pkg).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.rightsExpiresAt ? ` · vence ${asset.rightsExpiresAt}` : " · sin vencimiento"}</option>)}</select>{!db.agencyPostproductionAudioReady && <div className="text-[9px] mt-1 font-bold" style={{ color: "#A66A00" }}>Aplicá audio-postproduccion-v1.sql para sellar la pista.</div>}</div><BtnAsync small onClick={() => authorizeExport(pkg)} disabled={!db.agencyPostproductionAudioReady}>Autorizar exportación</BtnAsync></div></article>)}
          {exportCenter.exports.map((item) => { const tone = statusTone(item.status); const evaluation = item.status === "Exportada" ? evaluatePostproductionMaster(item, item.outputAsset) : null; const audioLabel = item.audioBinding?.mode === "Biblioteca" ? ((db.brandMediaAssets || []).find((asset) => String(asset.id) === String(item.audioBinding.assetId))?.name || `Pista #${item.audioBinding.assetId}`) : "Audio original"; return <article key={item.id} className="rounded-2xl border p-3" style={{ borderColor: ["Fallida", "Incierta", "Rechazada"].includes(item.status) ? "#E9AAA0" : T.border, background: "#FFFDFC" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.coral }}>Exportación #{item.id} · intento {item.attempts}</div><div className="font-extrabold text-sm">{item.package?.storyboard?.title || `Paquete #${item.packageId}`}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{item.status}</span></div><div className="text-[10px] my-2" style={{ color: T.choco2 }}>{item.snapshot?.export_spec?.width}×{item.snapshot?.export_spec?.height} · {item.snapshot?.export_spec?.fps} FPS · {audioLabel} · huella {item.fingerprint?.slice(0, 8)}</div>{item.errorMessage && <div className="rounded-xl px-2.5 py-2 text-[10px] mb-2" style={{ background: "#F9D8D1", color: "#A03B2A" }}>{item.errorMessage}</div>}{item.status === "Autorizada" && <div className="rounded-xl px-2.5 py-2 text-[10px] font-bold" style={{ background: exportWorker?.ffmpegAvailable ? "#DDEBD9" : "#FFF2D8", color: exportWorker?.ffmpegAvailable ? "#315B35" : "#7A5410" }}>{exportWorker?.ffmpegAvailable ? "En cola privada · worker FFmpeg disponible." : "En cola privada · activá el worker FFmpeg para procesarla."}</div>}{item.status === "Exportada" && <><div className="rounded-xl px-2.5 py-2 text-[10px] mb-2" style={{ background: evaluation?.approved ? "#DDEBD9" : "#F9D8D1", color: evaluation?.approved ? "#315B35" : "#A03B2A" }}>{evaluation?.approved ? "✓ Archivo y probe coinciden; falta decisión humana." : `× ${evaluation?.reasons?.[0] || "No supera el QA técnico."}`}</div><div className="flex gap-2"><BtnAsync small confirmar disabled={!evaluation?.approved} onClick={() => resolveMaster(item, "Aprobar")}>Aprobar máster</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveMaster(item, "Rechazar")}>Rechazar</BtnAsync></div></>}{item.status === "Fallida" && <BtnAsync small kind="ghost" onClick={() => retryExport(item)}>Reintentar fallo definitivo</BtnAsync>}{item.status === "Incierta" && <div className="text-[10px] font-extrabold" style={{ color: "#A03B2A" }}>Bloqueada: conciliar antes de cualquier reenvío.</div>}</article>; })}
          {exportCenter.candidates.length === 0 && exportCenter.exports.length === 0 && <div className="p-2 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Todavía no hay cortes listos para exportar.</b> Primero aprobá el paquete completo de postproducción.</div>}
        </div>}
      </div>
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>El corte aprobado sigue separado de Distribución Comercial: no publica, no pauta y no gasta.</div>
    {reviewJob && <Modal title="Control de calidad de la toma" onClose={() => setReviewJob(null)} wide topLayer>
      <div className="rounded-2xl p-3 mb-3 text-xs" style={{ background: T.vainilla }}><b>Trabajo #{reviewJob.id} · salida #{reviewJob.outputAssetId}</b><br />Puntaje {evaluation.total}/22 · {evaluation.approved ? "cumple el umbral" : evaluation.reasons[0]}</div>
      {outputAsset?.url && (outputAsset.mediaType === "Video" ? <video src={outputAsset.url} controls className="w-full max-h-72 rounded-2xl bg-black mb-3" /> : <img src={outputAsset.url} alt={outputAsset.name} className="w-full max-h-72 object-contain rounded-2xl mb-3" />)}
      <div className="grid sm:grid-cols-2 gap-2">{AGENCY_QUALITY_CRITERIA.map((criterion) => <Field key={criterion.key} label={`${criterion.label}${criterion.critical ? " · crítica" : ""}`}><Select options={["0 · falla", "1 · deriva menor", "2 · exacto"]} value={`${scores[criterion.key]} · ${scores[criterion.key] === 0 ? "falla" : scores[criterion.key] === 1 ? "deriva menor" : "exacto"}`} onChange={(event) => setScores({ ...scores, [criterion.key]: Number(event.target.value.slice(0, 1)) })} /></Field>)}</div>
      {!evaluation.approved && <Field label="Tipo de corrección"><Select options={AGENCY_QUALITY_FAILURE_TYPES.filter((item) => item !== "Aprobada")} value={failureType} onChange={(event) => setFailureType(event.target.value)} /></Field>}
      <Field label="Continuidad observada"><textarea className={inputCls} style={inputStyle} rows="2" value={continuity} onChange={(event) => setContinuity(event.target.value)} /></Field>
      <Field label={evaluation.approved ? "Nota de aprobación" : "Qué debe corregirse"}><textarea className={inputCls} style={inputStyle} rows="3" value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      <div className="flex gap-2"><BtnAsync confirmar onClick={saveQualityReview} disabled={continuity.trim().length < 3 || (!evaluation.approved && note.trim().length < 5)}>{evaluation.approved ? "Aprobar para postproducción" : `Sellar ${failureType.toLowerCase()}`}</BtnAsync><Btn kind="ghost" onClick={() => setReviewJob(null)}>Cancelar</Btn></div>
    </Modal>}
  </div>;
}

  function AgencyCreativeSuite({ module, db, refrescar }) {
    if (module === "collaboration") return <AgencyCollaborationDesk db={db} refrescar={refrescar} />;
    if (module === "retention") return <><AgencyRetentionLab db={db} refrescar={refrescar} /><AgencyLoopLearningDesk db={db} refrescar={refrescar} /></>;
    if (module === "studio") return <>
      <AgencySceneStudio db={db} refrescar={refrescar} />
      <div id="agency-motion-experience"><AgencyMotionExperience db={db} refrescar={refrescar} /></div>
      <div id="agency-scene-router"><AgencySceneRouter db={db} refrescar={refrescar} /></div>
      <div id="agency-quality-control"><AgencyQualityControl db={db} refrescar={refrescar} /></div>
    </>;
    return null;
  }

  return AgencyCreativeSuite;
}
