import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { agencyDecisionType, buildAgencyIntelligence, DEFAULT_AGENCY_SETTINGS, guardAgencyAction } from "../../lib/agency-intelligence";
import { buildOrchestratorInbox, orchestratorProposalPayload } from "../../lib/agency-orchestrator";
import { agencyActionDestination, buildAgencyActionQueue } from "../../lib/agency-action-queue";
import { AGENCY_EVIDENCE_KINDS, AGENCY_OBSERVED_RESULTS, AGENCY_OUTCOME_STATUSES, agencyOutcomeDefaults, agencyOutcomePayload, validateAgencyOutcome } from "../../lib/agency-action-outcome";
import { buildCreativeFlightCenter, creativeCandidatesForFlight, creativeRelayStep, publicationCandidatesForFlight, publicationDraftForFlight } from "../../lib/agency-creative-flight";
import { FRIENDLY_AGENCY_GOALS, buildFriendlyAgencyGuide } from "../../lib/agency-friendly-guide";
import { buildGrowthMultimodeEngine, growthSnapshotPayload } from "../../lib/growth-multimode-engine";
import { brandIdentitySummary, buildBrandIdentityView } from "../../lib/brand-identity";
import { fetchBrandIdentity } from "../../lib/brand-identity-api";
import { buildCommercialLearning } from "../../lib/commercial-learning";
import { projectAgencyDbWithOperationalFacts } from "../../lib/agency-operational-facts";
import { buildCreativePackage } from "../../lib/creative-package";
import { buildProductionLibrary } from "../../lib/production-library";
import { activeFigureCatalog, commercialFamilyLabel, figureProductId, isCommercialFamilyProduct } from "../../lib/momos-domain-language";
import {
  registrarContactoCliente, crearCampana, editarCampana, setCampanaEstado, crearCreativo, crearPublicacion,
  guardarConfiguracionAgencia, crearBriefAgencia, registrarSnapshotMotorCrecimiento, seleccionarModoCrecimiento,
  setEstadoBriefAgencia, crearDecisionAgencia, resolverDecisionAgencia, registrarResultadoAccionAgencia,
  registrarRecomendacionOrquestador, resolverPropuestaOrquestador, abrirMesaAgencia, agregarAporteMesaAgencia,
  prepararContratoCreativo, aprobarContratoCreativo, crearStoryboardAgencia, guardarTomaStoryboard,
  enviarStoryboardRevision, resolverStoryboardAgencia, prepararPlanMotion, resolverPlanMotion,
  prepararEnrutamientoEscenas, resolverEnrutamientoEscenas, registrarRevisionCalidadEscena,
  resolverRevisionCalidadEscena, prepararPaquetePostproduccion, resolverPaquetePostproduccion,
  autorizarExportacionPostproduccion, resolverControlMasterPostproduccion, reintentarExportacionPostproduccion,
  prepararGuionRetencion, resolverGuionRetencion, crearExperimentoRetencion, cerrarExperimentoRetencion,
  prepararDiagnosticoRetencion, resolverDiagnosticoRetencion, crearVersionCreativaAgencia,
  revisarVersionCreativaAgencia, subirActivoMarca, declararLogoPrincipalMarca, archivarActivoMarca,
  actualizarMetadatosActivoMarca, eliminarActivoMarca, eliminarLogoOficialMarca, crearTrabajoCreativo,
  autorizarTrabajoCreativo, cancelarTrabajoCreativo, reintentarTrabajoCreativo, revisarSalidaCreativa,
  crearRevisionSalidaCreativa, guardarReferenciaIntegracionAgencia, pausarIntegracionAgencia,
  prepararDiagnosticoMeta, resolverDiagnosticoMeta, crearEstudioIncrementalMeta, resolverEstudioIncrementalMeta,
  resolverMedicionIncrementalMeta, crearEscenariosInversionMeta, resolverEscenariosInversionMeta,
  solicitarAutorizacionInversionMeta, resolverAutorizacionInversionMeta, revocarAutorizacionInversionMeta,
  prepararDryRunMeta, prepararRelevoMasterCreativo, vincularPublicacionMaster, clasificarActivoProduccion,
  crearPaqueteProduccion, crearTrabajoDesdePaqueteProduccion, resolverAprobacionHumanaMcp, revisarPaqueteProduccion
} from "../../lib/rpc";

export function createAgencyPanel(shared) {
  const {
    T, hoyISO, dISO, fmt, copiarTexto, Badge, Card, SectionTitle, Btn, toast,
    BtnAsync, Modal, Field, inputCls, inputStyle, Input, Select, Empty, SABORES,
  } = shared;
  const statusTone = (status) => status === "Aprobado"
    ? { bg: "#DDEBD9", fg: "#315B35" }
    : status === "En revisi?n"
      ? { bg: "#FFF2D8", fg: "#7A5410" }
      : { bg: "#E5EEF7", fg: "#315A7D" };

  const LazyAgencyBrandStudio = lazy(() => import("./AgencyBrandStudio").then((module) => ({ default: module.createAgencyBrandStudio(shared) })));
  const LazyAgencyCreativeSuite = lazy(() => import("./AgencyCreativeSuite").then((module) => ({ default: module.createAgencyCreativeSuite(shared) })));
  const LazyAgencyMetaSuite = lazy(() => import("./AgencyMetaSuite").then((module) => ({ default: module.createAgencyMetaSuite(shared) })));
  const LazyAgencyFormulaLab = lazy(() => import("./AgencyFormulaLab").then((module) => ({ default: module.createAgencyFormulaLab(shared) })));
  const LazyAgencyHumanizationHub = lazy(() => import("./AgencyHumanizationHub").then((module) => ({ default: module.createAgencyHumanizationHub(shared) })));
  const agencySectionFallback = <div className="rounded-2xl border p-5 text-sm font-bold" style={{ borderColor: T.border, background: T.vainilla, color: T.choco2 }}>Cargando esta herramienta de Agencia MOMOS…</div>;

/* ================= CRECIMIENTO MOMOS 🌱 =================
   Asistente diario de marca en lenguaje simple.
   Traduce campañas, creativos y resultados a "qué hacer hoy". */

// Botón de copiar con feedback visual






function AgencyActionCenter({ db, go, refrescar }) {
  const center = useMemo(() => buildAgencyActionQueue(db.agencyActionQueue, db.agencyDecisions || []), [db.agencyActionQueue, db.agencyDecisions]);
  const [selected, setSelected] = useState(null);
  const [outcomeForm, setOutcomeForm] = useState(() => agencyOutcomeDefaults(null));
  const tone = (item) => item.blocked
    ? { border: "#E6B7AE", bg: "#FFF4F1", chip: "#F6D4CD", fg: "#A03B2A" }
    : item.humanActionRequired
      ? { border: "#E6C891", bg: "#FFFBF3", chip: "#FFF0CE", fg: "#8B5A08" }
      : { border: "#C7D8E8", bg: "#F5F9FD", chip: "#E5EEF7", fg: "#315A7D" };

  function openAction(item) {
    setOutcomeForm(agencyOutcomeDefaults(item));
    setSelected(item);
  }

  function navigateAction(item) {
    const destination = agencyActionDestination(item);
    setSelected(null);
    if (destination.module !== "Crecimiento") { go(destination.module); return; }
    window.setTimeout(() => document.getElementById(destination.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function completeDecision() {
    if (!selected) return;
    const error = validateAgencyOutcome(outcomeForm, selected);
    if (error) throw new Error(error);
    await registrarResultadoAccionAgencia(agencyOutcomePayload(selected, outcomeForm));
    setSelected(null); toast("ok", `Resultado verificable de decisión #${selected.decisionId} registrado`); await refrescar();
  }

  return <section id="agency-action-center" className="rounded-[26px] border overflow-hidden mb-6 shadow-sm scroll-mt-24" style={{ borderColor: T.border, background: T.surface }}>
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface, color: T.choco }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.coralSoft }}>🧭</div><div><div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: T.coral }}>Decisiones del equipo</div><div className="display text-xl font-semibold">Qué necesita tu aprobación</div><div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>Una acción clara por decisión. MOMOS abre el lugar correcto y nunca publica, contacta o gasta por sí sola.</div></div></div>
      <div className="grid grid-cols-3 gap-2 shrink-0">{[["Acciones",center.summary.total],["Para vos",center.summary.human],["Con alertas",center.summary.blocked]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[70px] text-center" style={{ borderColor: T.border, background: T.vainilla }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
    </div>
    {!db.agencyActionQueueReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>centro-acciones-agencia-v1.sql</code> para mostrar los siguientes pasos protegidos dentro de MOMO OPS.</div>
      : !center.allowed ? <div className="px-4 py-4 text-sm" style={{ color: T.choco2 }}>Tu rol no opera Agencia MOMOS; la bandeja permanece privada.</div>
        : center.items.length === 0 ? <div className="px-4 py-4 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Bandeja al día.</b> No hay decisiones aprobadas esperando un siguiente paso.</div>
          : <div className="p-3 grid md:grid-cols-2 xl:grid-cols-3 gap-3">{center.items.slice(0, 9).map((item) => { const style = tone(item); return <article key={item.decisionId} className="rounded-2xl border p-4 flex flex-col" style={{ borderColor: style.border, background: style.bg }}>
            <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Decisión #{item.decisionId} · {item.decisionType}</div><div className="display text-base font-semibold mt-1">{item.title}</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold uppercase shrink-0" style={{ background: style.chip, color: style.fg }}>{item.riskLevel}</span></div>
            {item.rationale && <p className="text-[11px] leading-relaxed my-2 line-clamp-2" style={{ color: T.choco2 }}>{item.rationale}</p>}
            <div className="rounded-xl px-3 py-2.5 my-2" style={{ background: "rgba(255,255,255,.72)", borderLeft: `3px solid ${style.fg}` }}><div className="text-[8px] uppercase tracking-wider font-extrabold" style={{ color: style.fg }}>{item.stage} · {item.area}</div><div className="text-[11px] font-extrabold mt-0.5">{item.actionLabel}</div></div>
            {item.blocked && <div className="text-[10px] font-bold mb-2" style={{ color: "#A03B2A" }}>Protegida: {item.blockerCode || "requiere resolver un bloqueo"}</div>}
            <div className="mt-auto"><Btn small kind={item.blocked ? "ghost" : "primary"} disabled={!item.humanActionRequired && !item.blocked} onClick={() => openAction(item)}>{item.humanActionRequired || item.blocked ? "Revisar acción" : "En seguimiento del sistema"}</Btn></div>
          </article>; })}</div>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>La tarjeta navega; no marca la decisión como ejecutada. El resultado solo se registra después de completar el trabajo real.</div>
    {selected && <Modal title={`Decisión #${selected.decisionId} · ${selected.decisionType}`} onClose={() => setSelected(null)} topLayer>
      <div className="rounded-2xl p-4 mb-3" style={{ background: "#FFF8F1", border: `1px solid ${T.border}` }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{selected.stage} · {selected.area}</div><div className="display text-lg font-semibold mt-1">{selected.title}</div>{selected.rationale && <p className="text-xs mt-2 mb-0" style={{ color: T.choco2 }}>{selected.rationale}</p>}</div>
      <div className="rounded-2xl px-3 py-3 mb-3 text-sm font-bold" style={{ background: selected.blocked ? "#F6D4CD" : "#E8F1E4", color: selected.blocked ? "#A03B2A" : "#315B35" }}>{selected.actionLabel}</div>
      {selected.blocked && <div className="rounded-xl px-3 py-2 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Bloqueo protegido: {selected.blockerCode}. Esta pantalla no puede ejecutar cambios externos.</div>}
      <div className="flex flex-wrap gap-2 mb-4"><Btn onClick={() => navigateAction(selected)}>Abrir {selected.area}</Btn><Btn kind="ghost" onClick={() => setSelected(null)}>Cerrar</Btn></div>
      {!db.agencyActionOutcomesReady ? <div className="rounded-xl px-3 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>resultados-verificables-agencia-v1.sql</code> para cerrar esta acción con evidencia.</div> : <div className="rounded-2xl border p-4" style={{ borderColor: T.border, background: "#FFFCF9" }}>
        <div className="text-[9px] uppercase tracking-wider font-extrabold mb-1" style={{ color: T.coral }}>Después de hacer el trabajo</div>
        <div className="display text-base font-semibold mb-3">Cerrar con evidencia verificable</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-[10px] font-bold">Cómo terminó<select className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={outcomeForm.completionStatus} onChange={(e) => setOutcomeForm((form) => ({ ...form, completionStatus: e.target.value }))}>{AGENCY_OUTCOME_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-[10px] font-bold">Resultado observado<select className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={outcomeForm.observedResult} onChange={(e) => setOutcomeForm((form) => ({ ...form, observedResult: e.target.value }))}>{AGENCY_OBSERVED_RESULTS.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-[10px] font-bold">Tipo de evidencia<select className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={outcomeForm.evidenceKind} onChange={(e) => setOutcomeForm((form) => ({ ...form, evidenceKind: e.target.value, evidenceId: e.target.value === "Ninguna" ? "" : form.evidenceId }))}>{AGENCY_EVIDENCE_KINDS.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-[10px] font-bold">ID exacto de MOMO OPS<input className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={outcomeForm.evidenceId} disabled={outcomeForm.evidenceKind === "Ninguna"} placeholder="Ej. L-046, P-1060 o CRE-01" onChange={(e) => setOutcomeForm((form) => ({ ...form, evidenceId: e.target.value }))} /></label>
          <label className="text-[10px] font-bold">Costo real COP<input type="number" min="0" className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={outcomeForm.actualCost} onChange={(e) => setOutcomeForm((form) => ({ ...form, actualCost: e.target.value }))} /></label>
          <label className="text-[10px] font-bold sm:col-span-2">Resumen del resultado<textarea maxLength={280} className="w-full mt-1 rounded-xl border px-3 py-2 bg-white min-h-20" value={outcomeForm.summary} placeholder="Qué se hizo y qué quedó comprobado" onChange={(e) => setOutcomeForm((form) => ({ ...form, summary: e.target.value }))} /></label>
        </div>
        {validateAgencyOutcome(outcomeForm, selected) && <div className="text-[10px] font-bold mt-2" style={{ color: "#A03B2A" }}>{validateAgencyOutcome(outcomeForm, selected)}</div>}
        <div className="mt-3"><BtnAsync disabled={Boolean(validateAgencyOutcome(outcomeForm, selected))} onClick={completeDecision}>Registrar resultado verificable</BtnAsync></div>
      </div>}
    </Modal>}
  </section>;
}

function AgencyCreativeFlightCenter({ db, go, refrescar }) {
  const center = useMemo(() => buildCreativeFlightCenter(db), [db]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [relay, setRelay] = useState(null);
  const [relayForm, setRelayForm] = useState({ creativeId: "", postChoice: "__new__", fecha: hoyISO(), hora: "12:00", titulo: "", copyFinal: "" });
  const flights = showCompleted ? center.flights : center.active;

  function openNext(flight) {
    const step = creativeRelayStep(flight);
    if (["master", "publication"].includes(step)) {
      const creativeOptions = creativeCandidatesForFlight(flight, db);
      const postOptions = publicationCandidatesForFlight(flight, db);
      const draft = publicationDraftForFlight(flight, db, hoyISO());
      setRelay({ flight, step, creativeOptions, postOptions });
      setRelayForm({
        creativeId: creativeOptions[0]?.id || "",
        postChoice: postOptions[0]?.id || "__new__",
        fecha: draft.fecha, hora: draft.hora, titulo: draft.titulo, copyFinal: draft.copyFinal,
      });
      return;
    }
    if (["distribution", "observe"].includes(step) || flight.nextTarget === "agency-distribution-room") {
      window.sessionStorage.setItem("momos:calendar-view", "Distribución");
      go("Calendario");
      return;
    }
    document.getElementById(flight.nextTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function completeRelay() {
    if (!relay) return;
    try {
      if (relay.step === "master") {
        if (!relayForm.creativeId) throw new Error("Primero necesitás un creativo aprobado del producto, canal y modo exactos.");
        await prepararRelevoMasterCreativo(relay.flight.master.id, relayForm.creativeId);
        toast("ok", "Máster y creativo exactos enlazados. El archivo quedó sellado; todavía no se publicó.");
      } else {
        let postId = relayForm.postChoice;
        let created = false;
        if (postId === "__new__") {
          if (!relayForm.fecha || !relayForm.titulo.trim()) throw new Error("Completá fecha y título antes de programar.");
          const result = await crearPublicacion({
            fecha: relayForm.fecha, hora: relayForm.hora || "12:00",
            canal: relay.flight.release.lineageSnapshot?.channel || relay.flight.board?.channel,
            campaign_id: db.creatives.find((creative) => String(creative.id) === String(relay.flight.release.creativeId))?.campaignId || "",
            creative_id: relay.flight.release.creativeId, titulo: relayForm.titulo.trim(),
            copy_final: relayForm.copyFinal.trim(), estado: "Programado", url_publicacion: "",
            notas: "Preparada desde el relevo humano del vuelo creativo; sin publicación automática.",
          });
          postId = result.id;
          created = true;
        }
        try {
          await vincularPublicacionMaster(relay.flight.release.id, postId);
        } catch (error) {
          if (created) {
            toast("alert", `La publicación ${postId} quedó Programada, pero falta enlazarla. Reabrí el relevo para recuperarla sin duplicar.`);
            await refrescar();
            return;
          }
          throw error;
        }
        toast("ok", `${postId} quedó ligada al máster exacto y lista para revisión de Distribución.`);
      }
      setRelay(null);
      await refrescar();
    } catch (error) {
      toast("error", error.message || "No se pudo completar el relevo creativo.");
    }
  }

  function relayButtonLabel(flight) {
    const step = creativeRelayStep(flight);
    if (step === "master") return "Enlazar máster";
    if (step === "publication") return "Preparar publicación";
    if (step === "distribution") return "Abrir Distribución";
    if (step === "observe") return "Ver seguimiento";
    return flight.blocked ? "Revisar contrato" : "Abrir siguiente paso";
  }

  return <section id="agency-creative-flight" className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: T.border, background: T.surface }} aria-label="Contenido en curso">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface, color: T.choco }}>
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.coralSoft }}>✦</div>
        <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: T.coral }}>Contenido en curso</div><div className="display text-xl font-semibold">Del objetivo al resultado</div><div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>Seguí cada contenido desde la idea hasta su resultado, con Pauta y Orgánico siempre separados.</div></div>
      </div>
      <div className="grid grid-cols-4 gap-2 shrink-0">
        {[["Activos",center.active.length],["Pauta",center.summary.pauta],["Orgánico",center.summary.organic],["Por revisar",center.summary.blocked]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[66px] text-center" style={{ borderColor: T.border, background: T.vainilla }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}
      </div>
    </div>
    {!db.agencyCreativeFlowReady && <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>flujo-creativo-e2e-v1.sql</code> para sellar el relevo Máster → Creativo → Publicación → Distribución → Medición.</div>}
    <div className="p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[10px] font-extrabold uppercase tracking-[.14em]" style={{ color: T.choco2 }}>{showCompleted ? "Todo el contenido" : "Contenido que necesita avanzar"}</div>
        {center.completed.length > 0 && <button type="button" className="rounded-full border px-3 py-1.5 text-[10px] font-extrabold" style={{ borderColor: T.border, color: T.choco2, background: T.vainilla }} onClick={() => setShowCompleted((value) => !value)}>{showCompleted ? "Ocultar cerrados" : `Ver cerrados · ${center.completed.length}`}</button>}
      </div>
      {flights.length === 0 ? <div className="rounded-2xl px-4 py-4 text-sm" style={{ background: "#F8F0E7", color: T.choco2 }}><b style={{ color: T.choco }}>{center.flights.length ? "Todo el contenido completó su aprendizaje." : "Todavía no hay contenido aprobado para iniciar."}</b> El equipo conserva el control de cada paso.</div> : <div className="grid xl:grid-cols-2 gap-3">
        {flights.slice(0, 8).map((flight) => <article key={flight.contract.id} className="rounded-[22px] border p-4" style={{ borderColor: flight.blocked ? "#E8B7AD" : T.border, background: flight.blocked ? "#FFF6F3" : "#FFF9F2" }}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="flex flex-wrap items-center gap-1.5"><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: flight.mode === "Pauta" ? "#F6D4CD" : "#DDEBD9", color: flight.mode === "Pauta" ? "#A03B2A" : "#315B35" }}>{flight.mode}</span><span className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Contrato {flight.contract.id}</span></div><div className="display text-lg font-semibold mt-1">{flight.goal}</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>Métrica primaria: {flight.metric}</div></div>
            <div className="text-right shrink-0"><div className="display text-2xl font-semibold" style={{ color: flight.blocked ? "#A03B2A" : T.coral }}>{flight.progress}%</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{flight.completed}/10 pasos</div></div>
          </div>
          <div className="grid grid-cols-10 gap-1 mt-3" aria-label={`Progreso ${flight.progress}%`}>{flight.stages.map((item) => <div key={item.label} title={`${item.label}: ${item.detail}`} className="h-2 rounded-full" style={{ background: item.state === "done" ? "#5F8B61" : item.state === "current" ? T.coral : "#EADFD2" }} />)}</div>
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t pt-3" style={{ borderColor: T.border }}>
            <div><div className="text-[9px] uppercase font-extrabold" style={{ color: flight.blocked ? "#A03B2A" : T.coral }}>{flight.blocked ? "Requiere corrección" : "Siguiente paso"}</div><div className="text-xs font-extrabold">{flight.currentStage}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{flight.stages.find((item) => item.label === flight.currentStage)?.detail}</div></div>
            <Btn small kind={flight.blocked ? "ghost" : "primary"} onClick={() => openNext(flight)}>{relayButtonLabel(flight)}</Btn>
          </div>
        </article>)}
      </div>}
    </div>
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Este centro solo orienta y verifica la cadena. No genera, publica, pauta ni gasta automáticamente.</div>
    {relay && <Modal title={relay.step === "master" ? "Enlazar el máster aprobado" : "Preparar la publicación exacta"} onClose={() => setRelay(null)} topLayer>
      <div className="rounded-2xl p-4 mb-4" style={{ background: "#F8F0E7", border: `1px solid ${T.border}` }}>
        <div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{relay.flight.mode} · Contrato {relay.flight.contract.id}</div>
        <div className="display text-lg font-semibold mt-1">{relay.flight.goal}</div>
        <div className="text-xs mt-1" style={{ color: T.choco2 }}>Canal sellado: {relay.flight.board?.channel || relay.flight.release?.lineageSnapshot?.channel}. La acción conserva producto, marca y medición.</div>
      </div>
      {relay.step === "master" ? <>
        {relay.creativeOptions.length ? <label className="text-[10px] font-bold block">Creativo comercial aprobado
          <select className="w-full mt-1 rounded-xl border px-3 py-2.5 bg-white" value={relayForm.creativeId} onChange={(event) => setRelayForm((form) => ({ ...form, creativeId: event.target.value }))}>
            {relay.creativeOptions.map((creative) => <option key={creative.id} value={creative.id}>{creative.id} · {creative.titulo}</option>)}
          </select>
        </label> : <div className="rounded-xl px-3 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>No hay un creativo aprobado que coincida con producto, canal y modo. Creá una versión nueva y aprobala antes de continuar.</div>}
        <div className="rounded-xl px-3 py-3 my-4 text-xs" style={{ background: "#E8F1E4", color: "#315B35" }}>MOMOS OPS enlazará el archivo aprobado al creativo elegido. No lo publicará ni ejecutará pauta.</div>
        <div className="flex flex-wrap gap-2"><BtnAsync disabled={!relay.creativeOptions.length} onClick={completeRelay}>Enlazar máster exacto</BtnAsync>{!relay.creativeOptions.length && <Btn kind="ghost" onClick={() => { setRelay(null); go("Creativos"); }}>Abrir Creativos</Btn>}</div>
      </> : <>
        {relay.postOptions.length > 0 && <label className="text-[10px] font-bold block mb-3">Reutilizar una publicación compatible
          <select className="w-full mt-1 rounded-xl border px-3 py-2.5 bg-white" value={relayForm.postChoice} onChange={(event) => setRelayForm((form) => ({ ...form, postChoice: event.target.value }))}>
            {relay.postOptions.map((post) => <option key={post.id} value={post.id}>{post.id} · {post.fecha} {post.hora} · {post.titulo}</option>)}
            <option value="__new__">Crear una nueva programación</option>
          </select>
        </label>}
        {(relay.postOptions.length === 0 || relayForm.postChoice === "__new__") && <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-[10px] font-bold">Fecha<input type="date" min={hoyISO()} className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={relayForm.fecha} onChange={(event) => setRelayForm((form) => ({ ...form, fecha: event.target.value }))} /></label>
          <label className="text-[10px] font-bold">Hora<input type="time" className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={relayForm.hora} onChange={(event) => setRelayForm((form) => ({ ...form, hora: event.target.value }))} /></label>
          <label className="text-[10px] font-bold sm:col-span-2">Título<input maxLength={180} className="w-full mt-1 rounded-xl border px-3 py-2 bg-white" value={relayForm.titulo} onChange={(event) => setRelayForm((form) => ({ ...form, titulo: event.target.value }))} /></label>
          <label className="text-[10px] font-bold sm:col-span-2">Copy final<textarea maxLength={2000} className="w-full mt-1 rounded-xl border px-3 py-2 bg-white min-h-24" value={relayForm.copyFinal} onChange={(event) => setRelayForm((form) => ({ ...form, copyFinal: event.target.value }))} /></label>
        </div>}
        <div className="rounded-xl px-3 py-3 my-4 text-xs" style={{ background: "#FFF2D8", color: "#7A5410" }}>Quedará en estado <b>Programado</b>. Distribución deberá revisar checklist, derechos y evidencia antes de cualquier salida externa.</div>
        <BtnAsync onClick={completeRelay}>Programar y enlazar</BtnAsync>
      </>}
    </Modal>}
  </section>;
}

function GrowthModeExplorer({ engine, selectedModeId, onSelectMode, onUseMode }) {
  const selected = engine.modes.find((mode) => mode.id === selectedModeId)
    || engine.modes.find((mode) => mode.id === engine.recommendedModeId)
    || engine.modes[0];
  const statusColors = selected.status.value === "Listo" || selected.status.value === "Plan listo"
    ? { bg: "#DDEBD9", fg: "#315B35", border: "#B8D3B2" }
    : selected.status.value === "Bloqueado"
      ? { bg: "#F6D4CD", fg: "#A03B2A", border: "#E6B7AE" }
      : { bg: "#FFF2D8", fg: "#7A5410", border: "#E8C98B" };
  return <section className="rounded-[26px] border shadow-sm overflow-hidden" style={{ borderColor: T.border, background: T.surface }} aria-label="Motor de crecimiento multimodo">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: "linear-gradient(135deg,#FFF9F2,#FFFDFC)" }}>
      <div className="flex items-start gap-3"><span className="w-10 h-10 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.coralSoft }}>🧭</span><div><div className="text-[9px] uppercase tracking-[.16em] font-extrabold" style={{ color: T.coral }}>Motor de crecimiento MOMOS</div><div className="display text-xl font-semibold mt-0.5">Elegí cómo queremos crecer</div><div className="text-xs mt-1 max-w-2xl" style={{ color: T.choco2 }}>MOMOS compara inventario, demanda, Producción, marca y resultados. Recomienda un camino, pero la decisión sigue siendo humana.</div></div></div>
      <div className="grid grid-cols-3 gap-2 shrink-0">{[[engine.facts.exactStockUnits,"Listas"],[engine.facts.productionUnits,"Por producir"],[engine.facts.paidOrders30d,"Pedidos 30 d"]].map(([value,label]) => <div key={label} className="rounded-xl border px-3 py-2 text-center min-w-[72px]" style={{ borderColor: T.border, background: T.surface }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
    </div>
    <div className="p-4 sm:p-5">
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2.5 mb-4" role="tablist" aria-label="Modos de crecimiento">
        {engine.modes.map((mode) => { const active = mode.id === selected.id; const recommended = mode.id === engine.recommendedModeId; return <button key={mode.id} type="button" role="tab" aria-selected={active} onClick={() => onSelectMode(mode.id)} className="text-left rounded-2xl border p-3 transition min-h-[106px]" style={{ borderColor: active ? "#E9A18F" : T.border, background: active ? "#FFF5F0" : T.surface, boxShadow: active ? "0 4px 12px rgba(204,103,77,.10)" : "none" }}>
          <div className="flex items-start justify-between gap-2"><span className="w-8 h-8 rounded-xl grid place-items-center text-base" style={{ background: active ? T.coralSoft : T.vainilla }}>{mode.icon}</span>{recommended && <span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: "#DDEBD9", color: "#315B35" }}>Recomendado</span>}</div>
          <div className="font-extrabold text-xs mt-2">{mode.shortLabel}</div><div className="text-[9px] mt-1 leading-relaxed" style={{ color: T.choco2 }}>{mode.objective}</div>
        </button>; })}
      </div>

      <article className="rounded-[22px] border overflow-hidden" style={{ borderColor: statusColors.border, background: "#FFFDFC" }}>
        <div className="p-4 flex flex-col lg:flex-row lg:items-start justify-between gap-3" style={{ background: "#FFF9F2" }}>
          <div className="flex items-start gap-3"><span className="w-10 h-10 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.vainilla }}>{selected.icon}</span><div><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{selected.channel}</span><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: statusColors.bg, color: statusColors.fg }}>{selected.status.value}</span></div><div className="display text-lg font-semibold mt-1">{selected.label}</div><div className="text-[10px] mt-1" style={{ color: T.choco2 }}>{selected.status.detail}</div></div></div>
          <BtnAsync small onClick={() => onUseMode(selected)}>Usar este camino</BtnAsync>
        </div>
        <div className="grid lg:grid-cols-[.9fr_1.1fr] border-t" style={{ borderColor: T.border }}>
          <div className="p-4 lg:border-r" style={{ borderColor: T.border }}>
            <div className="text-[9px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.coral }}>Por qué conviene</div>
            <div className="space-y-2 mb-4">{selected.why.map((item) => <div key={item} className="flex items-start gap-2 text-[10px] leading-relaxed"><span style={{ color: "#5F8B61" }}>✓</span><span>{item}</span></div>)}</div>
            <div className="rounded-xl px-3 py-2.5" style={{ background: T.vainilla }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>Siguiente paso</div><div className="text-[11px] font-extrabold mt-1">{selected.nextStep}</div></div>
            <div className="mt-3"><div className="text-[8px] uppercase font-extrabold mb-1.5" style={{ color: T.choco2 }}>Antes de usarlo</div><div className="flex flex-wrap gap-1.5">{selected.safeguards.map((item) => <span key={item} className="rounded-full px-2 py-1 text-[8px] font-bold" style={{ background: "#EDF5EA", color: "#315B35" }}>✓ {item}</span>)}</div></div>
            {selected.productionPlan && <div className="grid grid-cols-3 gap-2 mt-3">{[[selected.productionPlan.runs,"Corridas"],[selected.productionPlan.units,"Unidades"],[selected.productionPlan.preparations.length,"Preparaciones"]].map(([value,label]) => <div key={label} className="rounded-xl border px-2 py-2 text-center" style={{ borderColor: T.border }}><div className="display text-lg font-semibold">{value}</div><div className="text-[7px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>}
          </div>
          <div className="p-4">
            <div className="flex items-end justify-between gap-2 mb-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Ángulos para probar</div><div className="text-[10px]" style={{ color: T.choco2 }}>No repetimos el mismo mensaje: cada idea persigue una razón distinta para elegir MOMOS.</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold shrink-0" style={{ background: T.vainilla }}>{selected.angles.length} ideas</span></div>
            <div className="grid sm:grid-cols-2 gap-2">{selected.angles.map((item, index) => <div key={item.id} className="rounded-xl border p-3" style={{ borderColor: T.border, background: T.surface }}><div className="flex items-center justify-between gap-2"><span className="text-[8px] uppercase font-extrabold" style={{ color: T.coral }}>Idea {index + 1}</span><span className="text-[8px] font-bold" style={{ color: T.choco2 }}>{item.format}</span></div><div className="font-extrabold text-[11px] mt-1">{item.title}</div><div className="text-[9px] mt-1 leading-relaxed" style={{ color: T.choco2 }}>{item.promise}</div></div>)}</div>
          </div>
        </div>
        <div className="px-4 py-2.5 border-t text-[9px] font-semibold" style={{ borderColor: T.border, background: "#F8F0E7", color: T.choco2 }}>{engine.policy.statement}</div>
      </article>
    </div>
  </section>;
}

function BrandIdentitySummaryCard({ identity, loading, error, onOpen }) {
  const summary = brandIdentitySummary(identity);
  const statusBg = identity.ready ? "#DDEBD9" : "#FFF2D8";
  const statusColor = identity.ready ? "#315B35" : "#7A5410";
  return <button type="button" onClick={onOpen} className="momo-card-action w-full rounded-2xl border p-4 text-left" style={{ borderColor: identity.ready ? "#BFD8BE" : "#E7C078", background: T.surface }} aria-label="Abrir identidad de marca MOMOS">
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0"><span className="w-10 h-10 rounded-2xl grid place-items-center text-lg shrink-0" style={{ background: T.coralSoft }}>✦</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] uppercase tracking-[.16em] font-extrabold" style={{ color: T.coral }}>Identidad de marca</span><span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold" style={{ background: statusBg, color: statusColor }}>{loading ? "Verificando" : error ? "Revisar conexión" : identity.statusLabel}</span></div><div className="display text-lg font-semibold mt-0.5">La guía visual y verbal de MOMOS</div><div className="text-[10px] mt-1 line-clamp-2" style={{ color: T.choco2 }}>{identity.positioning}</div></div></div>
      <div className="grid grid-cols-3 gap-2 shrink-0">{[[summary.officialLogos,"Logos"],[summary.colors,"Colores"],[summary.rules,"Reglas"]].map(([value,label]) => <div key={label} className="rounded-xl border px-3 py-2 text-center min-w-[68px]" style={{ borderColor: T.border, background: "#FFFDFC" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[7px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
    </div>
    <div className="mt-3 pt-2.5 border-t flex items-center justify-between gap-3 text-[9px]" style={{ borderColor: T.border }}><span style={{ color: T.choco2 }}>{error || `${identity.sourceLabel} · Biblioteca guarda archivos; Identidad declara su uso oficial.`}</span><span className="font-extrabold shrink-0" style={{ color: T.coral }}>Ver identidad <span aria-hidden="true">›</span></span></div>
  </button>;
}

function BrandIdentityPanel({ identity, loading, error, onRetry, onOpenLibrary }) {
  const modeCard = (mode, icon, bg, border, color) => {
    const data = identity.contentModes?.[mode] || {};
    return <div className="rounded-2xl border p-4" style={{ borderColor: border, background: bg }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color }}>{icon} {mode}</div><div className="display text-lg font-semibold mt-1">{data.purpose || (mode === "Pauta" ? "Conversión rentable y medible" : "Atención, afinidad y comunidad")}</div><div className="text-[10px] leading-relaxed mt-2" style={{ color: T.choco2 }}>{mode === "Pauta" ? "Oferta, audiencia, capacidad, atribución y CTA deben estar verificados." : "Valor antes de pedir; la venta solo se atribuye cuando existe un vínculo exacto."}</div><div className="flex flex-wrap gap-1.5 mt-3">{(data.primary_metrics || []).map((metric) => <span key={metric} className="rounded-full px-2 py-1 text-[8px] font-bold" style={{ background: T.surface, color }}>{metric}</span>)}</div></div>;
  };
  return <div className="space-y-4">
    <div className="rounded-2xl border p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ borderColor: identity.ready ? "#BFD8BE" : "#E7C078", background: identity.ready ? "#F7FBF5" : "#FFF9EC" }}>
      <div><div className="text-[9px] uppercase tracking-[.16em] font-extrabold" style={{ color: identity.ready ? "#315B35" : "#7A5410" }}>{identity.statusLabel}</div><div className="display text-xl font-semibold mt-1">{identity.name} · {identity.sourceLabel}</div><div className="text-xs mt-1 max-w-2xl" style={{ color: T.choco2 }}>{identity.positioning}</div></div>
      <div className="flex flex-wrap gap-2"><Btn small onClick={() => onOpenLibrary?.({ collection: "Marca", brandRole: "Logo principal", openUpload: true })}>Subir logo principal</Btn><Btn small kind="ghost" onClick={() => onOpenLibrary?.({ collection: "Marca" })}>Ver archivos de marca</Btn>{(error || !identity.serverAvailable) && <Btn small onClick={onRetry}>{loading ? "Verificando…" : "Verificar H55"}</Btn>}</div>
    </div>

    {!identity.ready && <div className="rounded-xl px-3.5 py-3 text-[11px] font-semibold" style={{ background: "#FFF2D8", color: "#7A5410" }}>{error || identity.errors[0] || "La identidad verbal y visual base sigue disponible. Elegí un logo principal oficial para activar la protección completa."}</div>}

    <section><div className="flex items-end justify-between gap-3 mb-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Firma oficial</div><h3 className="display text-lg font-semibold m-0">Logos aprobados</h3></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: T.vainilla }}>{identity.logos.length} vinculados</span></div>
      {identity.logos.length ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{identity.logos.map((logo) => <div key={`${logo.role}-${logo.assetId}`} className="rounded-2xl border overflow-hidden" style={{ borderColor: T.border, background: T.surface }}><div className="h-40 grid place-items-center p-5" style={{ background: logo.background === "Oscuro" ? T.choco : T.bg }}>{logo.signedUrl ? <img src={logo.signedUrl} alt={`${identity.name} · ${logo.role}`} className="max-w-full max-h-full object-contain" /> : <div className="text-center"><div className="text-3xl">✦</div><div className="text-[10px] mt-2" style={{ color: T.choco2 }}>Vista disponible al abrir desde el servidor</div></div>}</div><div className="p-3 border-t" style={{ borderColor: T.border }}><div className="font-extrabold text-sm capitalize">{logo.role.replaceAll("_", " ")}</div><div className="text-[9px] mt-1" style={{ color: T.choco2 }}>Mínimo {logo.minWidthPx} px · aire {logo.clearSpaceRatio}× · fondo {logo.background}</div></div></div>)}</div> : <div className="rounded-2xl border border-dashed p-6 text-center" style={{ borderColor: "#E7C078", background: "#FFF9EC" }}><div className="text-2xl">✦</div><div className="font-extrabold text-sm mt-2">Falta declarar el logo principal</div><div className="text-[10px] mt-1" style={{ color: T.choco2 }}>Usá el botón “Subir logo principal”. MOMO OPS lo guardará y creará la nueva versión oficial sin mezclarlo con productos.</div><div className="mt-3"><Btn small onClick={() => onOpenLibrary?.({ collection: "Marca", brandRole: "Logo principal", openUpload: true })}>Subir logo principal</Btn></div></div>}
    </section>

    <section className="rounded-2xl border p-4" style={{ borderColor: T.border, background: T.surface }}><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Referencias visuales de marca</div><h3 className="display text-lg font-semibold m-0 mt-1">Fotos que enseñan cómo se siente MOMOS</h3><div className="text-[10px] mt-1 max-w-2xl" style={{ color: T.choco2 }}>Ambientes, empaque, equipo, cultura, texturas y estilo de vida viven en su propio panel. No se mezclan con fotos de postres.</div></div><Btn small kind="ghost" onClick={() => onOpenLibrary?.({ collection: "Marca", brandRole: "Referencia visual", openUpload: true })}>Agregar fotos de marca</Btn></div></section>

    <section><div className="mb-2"><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Sistema visual</div><h3 className="display text-lg font-semibold m-0">Colores con una función clara</h3></div><div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">{identity.colors.map((color) => <div key={color.token} className="rounded-2xl border overflow-hidden" style={{ borderColor: T.border, background: T.surface }}><div className="h-16" style={{ background: color.colorHex }} /><div className="p-3"><div className="flex items-center justify-between gap-2"><span className="font-extrabold text-[11px]">{color.label}</span><code className="text-[9px]">{color.colorHex}</code></div><div className="text-[9px] mt-1" style={{ color: T.choco2 }}>{color.usage}</div></div></div>)}</div></section>

    <div className="grid lg:grid-cols-2 gap-3"><section className="rounded-2xl border p-4" style={{ borderColor: T.border, background: T.surface }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Tipografía y estilo</div><div className="display text-2xl font-semibold mt-2">{identity.typography.display}</div><div className="text-sm font-bold">{identity.typography.body}</div><div className="flex flex-wrap gap-1.5 mt-3">{identity.visualStyle.map((item) => <span key={item} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>{item}</span>)}</div></section><section className="rounded-2xl border p-4" style={{ borderColor: T.border, background: T.surface }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Voz de MOMOS</div><div className="flex flex-wrap gap-1.5 mt-2">{identity.tone.map((item) => <span key={item} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.rosa, color: "#8E4B5A" }}>{item}</span>)}</div><div className="mt-3 space-y-1">{identity.approvedPhrases.slice(0, 3).map((phrase) => <div key={phrase} className="text-xs italic">“{phrase}”</div>)}</div></section></div>
    <section><div className="mb-2"><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Dos contratos distintos</div><h3 className="display text-lg font-semibold m-0">Pauta y Orgánico comparten marca, no objetivo</h3></div><div className="grid lg:grid-cols-2 gap-3">{modeCard("Pauta", "📣", "#FFF4E0", "#E7C078", "#7B5410")}{modeCard("Orgánico", "🌱", "#E8F1E4", "#BFD8BE", "#315B35")}</div></section>
  </div>;
}

function AgencyFriendlyHome({ guide, selectedGoal, onSelectGoal, onContinue, onAdvanced, growthEngine, selectedGrowthModeId, onSelectGrowthMode, onUseGrowthMode, brandIdentity, brandIdentityLoading, brandIdentityError, onOpenIdentity }) {
  const goal = FRIENDLY_AGENCY_GOALS.find((item) => item.id === selectedGoal) || FRIENDLY_AGENCY_GOALS[0];
  const recommendation = guide.recommendations[selectedGoal] || null;
  const activeContent = selectedGoal === "content" ? guide.activeFlight : null;
  const primaryLabel = selectedGoal === "content" && activeContent ? "Continuar contenido"
    : selectedGoal === "sales" ? "Preparar propuesta de venta"
      : selectedGoal === "customers" ? "Preparar activación"
        : selectedGoal === "results" ? "Ver análisis completo" : "Empezar contenido";

  return <div className="space-y-5">
    <BrandIdentitySummaryCard identity={brandIdentity} loading={brandIdentityLoading} error={brandIdentityError} onOpen={onOpenIdentity} />
    <section aria-label="Inicio guiado de Agencia MOMOS">
      <div className="mb-3"><h3 className="display text-lg font-semibold m-0">¿Qué quieres hacer hoy?</h3><p className="text-xs mt-0.5 mb-0" style={{ color: T.choco2 }}>Elegí un resultado. MOMOS organiza el trabajo y te pide solo las decisiones necesarias.</p></div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3" role="tablist" aria-label="Objetivos de Agencia MOMOS">
        {FRIENDLY_AGENCY_GOALS.map((item) => { const active = item.id === selectedGoal; return <button key={item.id} type="button" role="tab" aria-selected={active} onClick={() => onSelectGoal(item.id)} className="text-left rounded-2xl border p-3.5 transition min-h-[104px]" style={{ borderColor: active ? "#E9A18F" : T.border, background: active ? "#FFF5F0" : T.surface, boxShadow: "0 2px 5px rgba(84,56,43,.08)" }}>
          <div className="flex items-start gap-3"><span className="w-8 h-8 rounded-xl grid place-items-center text-base shrink-0" style={{ background: active ? T.coralSoft : T.vainilla }}>{item.icon}</span><span className="min-w-0"><span className="block font-extrabold text-sm mb-1">{item.label}</span><span className="block text-[10px] leading-relaxed" style={{ color: T.choco2 }}>{item.description}</span></span></div>
        </button>; })}
      </div>
    </section>

    {selectedGoal === "sales" ? <GrowthModeExplorer engine={growthEngine} selectedModeId={selectedGrowthModeId} onSelectMode={onSelectGrowthMode} onUseMode={onUseGrowthMode} /> : <section className="rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: activeContent ? "#E9A18F" : T.border, background: T.surface }} aria-label={`Recorrido ${goal.label}`}>
      <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0"><span className="w-10 h-10 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: T.coralSoft }}>{goal.icon}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] uppercase tracking-[.16em] font-extrabold" style={{ color: T.coral }}>Agencia MOMOS</span><span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold" style={{ background: activeContent ? "#DDEBD9" : T.vainilla, color: activeContent ? "#315B35" : T.choco2 }}>{activeContent ? "En curso" : "Lista para empezar"}</span></div><div className="display text-xl font-semibold mt-0.5">{goal.label}</div><div className="text-xs mt-1" style={{ color: T.choco2 }}>{activeContent ? `${activeContent.title} · ${activeContent.mode}` : recommendation?.title || goal.description}</div></div></div>
        <div className="grid grid-cols-3 gap-2 shrink-0">{[[activeContent ? `${activeContent.progress}%` : "—","Avance"],[activeContent ? activeContent.current.label : "1","Paso actual"],[activeContent ? activeContent.phases.length : "3","Pasos"]].map(([value,label]) => <div key={label} className="rounded-xl border px-3 py-2 text-center min-w-[72px]" style={{ borderColor: T.border, background: "#FFFDFC" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
      </div>

      {activeContent ? <div className="px-4 sm:px-5 pb-5">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 mb-3">{activeContent.phases.map((phase, index) => <div key={phase.id} className="rounded-xl border p-3" style={{ borderColor: phase.state === "current" ? "#E9A18F" : T.border, background: phase.state === "current" ? "#FFF5F0" : T.surface }}><div className="flex items-center gap-2 mb-1.5"><span className="w-5 h-5 rounded-full grid place-items-center text-[9px] font-extrabold" style={{ background: phase.state === "done" ? "#DDEBD9" : phase.state === "current" ? T.coral : T.vainilla, color: phase.state === "current" ? "#fff" : T.choco }}>{phase.state === "done" ? "✓" : index + 1}</span><span className="font-extrabold text-[11px]">{phase.label}</span></div><div className="text-[9px] leading-relaxed" style={{ color: T.choco2 }}>{phase.description}</div></div>)}</div>
        <div className="rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: T.vainilla }}><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Lo siguiente</div><div className="font-extrabold text-sm">{activeContent.current.description}</div></div><Btn small onClick={onContinue}>{primaryLabel}</Btn></div>
      </div> : selectedGoal === "results" ? <div className="px-4 sm:px-5 pb-5"><div className="grid sm:grid-cols-3 gap-2 mb-3">{[["Publicaciones",guide.results.published],["Aprendizajes",guide.results.conclusive],["Ganadores",guide.results.winners]].map(([label,value]) => <div key={label} className="rounded-xl border px-3 py-2.5" style={{ borderColor: T.border, background: T.surface }}><div className="display text-xl font-semibold" style={{ color: T.coral }}>{value}</div><div className="text-[9px] font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div><div className="rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: T.vainilla }}><div><div className="font-extrabold text-sm">Todavía no hay una conclusión suficiente.</div><div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>Cuando exista muestra real, verás qué repetir y qué cambiar.</div></div><Btn small kind="ghost" onClick={onContinue}>{primaryLabel}</Btn></div></div>
        : <div className="px-4 sm:px-5 pb-5"><div className="grid md:grid-cols-3 gap-2 mb-3">{[["1","Contanos el objetivo","Elegís qué quieres lograr."],["2","MOMOS prepara","Cruza la información necesaria."],["3","Vos decidís","Revisás el resultado antes de usarlo."]].map(([number,title,description]) => <div key={number} className="rounded-xl border px-3 py-2.5 flex items-center gap-2.5" style={{ borderColor: T.border, background: T.surface }}><div className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-extrabold shrink-0" style={{ background: number === "1" ? T.coralSoft : T.vainilla }}>{number}</div><div><div className="font-extrabold text-[11px]">{title}</div><div className="text-[9px]" style={{ color: T.choco2 }}>{description}</div></div></div>)}</div><div className="rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: recommendation ? "#EDF5EA" : T.vainilla }}><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: recommendation ? "#315B35" : T.coral }}>{recommendation ? "Recomendación lista" : "Empecemos"}</div><div className="font-extrabold text-sm">{recommendation?.title || goal.description}</div>{recommendation?.rationale && <div className="text-[10px] mt-0.5 line-clamp-1" style={{ color: T.choco2 }}>{recommendation.rationale}</div>}</div><Btn small onClick={onContinue}>{primaryLabel}</Btn></div></div>}
    </section>}

    <div className="flex justify-end"><button type="button" onClick={onAdvanced} className="rounded-full border px-3 py-1.5 text-[9px] font-extrabold" style={{ borderColor: T.border, background: T.surface, color: T.choco2 }}>Ver controles avanzados</button></div>
  </div>;
}

function AgencyAdvancedModuleCard({ icon, eyebrow, title, description, metric, metricLabel, status = "Disponible", tone = "coral", onOpen }) {
  const tones = {
    coral: { accent: T.coral, soft: "#FFF1EA" },
    green: { accent: "#3F6B42", soft: "#E8F1E4" },
    blue: { accent: "#315A7D", soft: "#E5EEF7" },
    gold: { accent: "#96690F", soft: "#FFF2D8" },
    rose: { accent: "#8B4660", soft: "#F6E3E9" },
  };
  const palette = tones[tone] || tones.coral;
  return <button type="button" onClick={onOpen} className="group w-full min-h-[178px] rounded-2xl border p-4 text-left flex flex-col transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2" style={{ borderColor: T.border, background: T.surface, "--tw-ring-color": palette.accent }}>
    <div className="flex items-start justify-between gap-3">
      <span className="w-10 h-10 rounded-2xl grid place-items-center text-lg shrink-0" style={{ background: palette.soft }}>{icon}</span>
      <span className="rounded-full px-2 py-1 text-[8px] uppercase tracking-wider font-extrabold" style={{ background: palette.soft, color: palette.accent }}>{status}</span>
    </div>
    <div className="mt-3 text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: palette.accent }}>{eyebrow}</div>
    <div className="display text-lg font-semibold leading-tight mt-1">{title}</div>
    <div className="text-[11px] leading-relaxed mt-1 line-clamp-2" style={{ color: T.choco2 }}>{description}</div>
    <div className="mt-auto pt-3 flex items-end justify-between gap-3 border-t" style={{ borderColor: T.border }}>
      <div>{metric !== undefined && <><div className="display text-xl font-semibold" style={{ color: palette.accent }}>{metric}</div><div className="text-[8px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{metricLabel}</div></>}</div>
      <span className="text-[10px] font-extrabold" style={{ color: palette.accent }}>Ver detalle <span aria-hidden="true">›</span></span>
    </div>
  </button>;
}

function AgenciaControl({ db: sourceDb, user, refrescar, go }) {
  // H67 proyecta solo los productos y agregados operativos autorizados dentro
  // de Agencia. El estado global conserva sus catálogos completos para las
  // pantallas operativas y nunca es reemplazado por esta vista compacta.
  const db = useMemo(() => projectAgencyDbWithOperationalFacts(sourceDb), [sourceDb]);
  const serverReady = Boolean(db.agencyServerReady);
  const settings = db.agencySettings || DEFAULT_AGENCY_SETTINGS;
  const intelligence = useMemo(() => buildAgencyIntelligence(db, settings, hoyISO()), [db, settings]);
  const learning = useMemo(() => buildCommercialLearning(db, hoyISO()), [db]);
  const orchestrator = useMemo(() => buildOrchestratorInbox(db), [db]);
  const [briefSource, setBriefSource] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creativeOpen, setCreativeOpen] = useState(false);
  const [opportunityFilter, setOpportunityFilter] = useState("Todas");
  const [expandedOpportunity, setExpandedOpportunity] = useState(null);
  const [creativePackageBrief, setCreativePackageBrief] = useState(null);
  const [creativePackageVariant, setCreativePackageVariant] = useState(0);
  const [creativePackageSubject, setCreativePackageSubject] = useState({ figure: "", flavor: "" });
  const [agencyView, setAgencyView] = useState("simple");
  const [selectedGoal, setSelectedGoal] = useState("content");
  const [advancedArea, setAdvancedArea] = useState("overview");
  const [advancedDetail, setAdvancedDetail] = useState(null);
  const [brandStudioIntent, setBrandStudioIntent] = useState(null);
  const [brandIdentityDto, setBrandIdentityDto] = useState(null);
  const [brandIdentityLoading, setBrandIdentityLoading] = useState(true);
  const [brandIdentityError, setBrandIdentityError] = useState("");
  const brandIdentityRequestRef = useRef(0);
  const [settingsForm, setSettingsForm] = useState(settings);
  const [briefForm, setBriefForm] = useState({ title: "", objective: "Ventas", channel: "Instagram", offer: "", crmSegment: "", proposedBudget: 0, notes: "" });
  const [creativeForm, setCreativeForm] = useState({ creativeId: "", briefId: "", prompt: "", negativePrompt: "", assetUrl: "" });
  const existingKeys = new Set((db.agencyBriefs || []).map((brief) => brief.decisionKey).filter(Boolean));
  const orchestratedKeys = new Set((db.agencyAgentProposals || []).map((proposal) => proposal.proposalKey));
  const opportunityPillars = ["Todas", ...new Set(intelligence.recommendations.map((item) => item.pillar))];
  const visibleRecommendations = opportunityFilter === "Todas"
    ? intelligence.recommendations
    : intelligence.recommendations.filter((item) => item.pillar === opportunityFilter);
  const creativePackageDraft = useMemo(() => creativePackageBrief
    ? buildCreativePackage(creativePackageBrief, db, creativePackageVariant, creativePackageSubject)
    : null, [creativePackageBrief, creativePackageVariant, creativePackageSubject, db]);
  const creativePackageSaved = creativePackageBrief
    ? (db.agencyCreativeVersions || []).some((version) => String(version.briefId) === String(creativePackageBrief.id))
    : false;
  const creativeFocusProduct = creativePackageDraft ? (db.products || []).find((product) => product.id === creativePackageDraft.productId) : null;
  const creativeCompatibleFigures = creativePackageDraft
    ? activeFigureCatalog(db).filter((figure) => figureProductId(figure) === creativePackageDraft.productId)
    : [];
  const friendlyGuide = useMemo(() => buildFriendlyAgencyGuide(db, intelligence, learning), [db, intelligence, learning]);
  const growthEngine = useMemo(() => buildGrowthMultimodeEngine(db, { today: hoyISO() }), [db]);
  const [selectedGrowthModeId, setSelectedGrowthModeId] = useState("");
  const activeGrowthMode = growthEngine.modes.find((mode) => mode.id === selectedGrowthModeId)
    || growthEngine.modes.find((mode) => mode.id === growthEngine.recommendedModeId)
    || growthEngine.modes[0];
  const brandIdentity = useMemo(() => buildBrandIdentityView(brandIdentityDto, db.agencyBrandProfile), [brandIdentityDto, db.agencyBrandProfile]);
  const visualProductionLibrary = useMemo(() => buildProductionLibrary(db), [db]);
  const visualQualityPending = visualProductionLibrary.approved.filter((asset) => !asset.aiReadiness.videoGeneration.ready).length;

  async function loadBrandIdentity({ includeHistory = false, signAssets = false } = {}) {
    const requestId = ++brandIdentityRequestRef.current;
    setBrandIdentityLoading(true); setBrandIdentityError("");
    try {
      const identity = await fetchBrandIdentity({ includeHistory, signAssets });
      if (requestId === brandIdentityRequestRef.current) setBrandIdentityDto(identity);
    }
    catch (error) {
      if (requestId === brandIdentityRequestRef.current) setBrandIdentityError(error.message || "No se pudo verificar la identidad oficial.");
    }
    finally {
      if (requestId === brandIdentityRequestRef.current) setBrandIdentityLoading(false);
    }
  }

  useEffect(() => {
    // H66 entrega los metadatos de Identidad dentro del bundle atómico. No se
    // abre otra RPC al entrar a Agencia; una solicitud aparte queda reservada
    // para firmar los logos cuando la persona abre el detalle.
    brandIdentityRequestRef.current += 1;
    setBrandIdentityDto(db.agencyBrandIdentity || null);
    setBrandIdentityError("");
    setBrandIdentityLoading(false);
  // La versión sellada es la dependencia estable. `db` se clona al aplicar
  // cualquier cambio operativo; depender del objeto volvería a ejecutar este
  // efecto y borraría las URLs firmadas mientras el modal sigue abierto.
  }, [db.agencySnapshotVersion]);

  function openBrandIdentity() {
    showAdvanced("agency-brand-identity");
    loadBrandIdentity({ signAssets: true });
  }

  function showAdvanced(target = "") {
    const creativeTargets = new Set(["agency-collaboration-desk", "agency-retention-lab", "agency-scene-studio", "agency-motion-experience", "agency-scene-router", "agency-quality-control", "agency-approval-center"]);
    const protectionTargets = new Set(["agency-action-center"]);
    const identityTargets = new Set(["agency-brand-identity"]);
    setAdvancedArea(identityTargets.has(target) ? "identity" : creativeTargets.has(target) ? "creative" : protectionTargets.has(target) ? "protection" : "overview");
    const targetDetails = {
      "agency-collaboration-desk": "creative-collaboration",
      "agency-retention-lab": "creative-retention",
      "agency-scene-studio": "creative-studio",
      "agency-motion-experience": "creative-studio",
      "agency-scene-router": "creative-studio",
      "agency-quality-control": "creative-studio",
      "agency-approval-center": "creative-library",
      "agency-action-center": "protection-actions",
      "agency-brand-identity": "identity-overview",
    };
    setAdvancedDetail(targetDetails[target] || null);
    setAgencyView("advanced");
  }

  function openBrandLibrary(intent = {}) {
    setBrandStudioIntent({ key: Date.now(), collection: "Marca", ...intent });
    setAdvancedArea("identity");
    setAdvancedDetail("creative-library");
    setAgencyView("advanced");
  }

  function manualGoalSource(goalId) {
    if (goalId === "sales") return { id: `manual-sales-${Date.now()}`, type: "Impulsar producto", risk: "Bajo", title: "Nueva propuesta para vender más", rationale: "Elegiremos producto, mensaje y canal usando ventas y stock vigentes.", evidence: {} };
    if (goalId === "customers") return { id: `manual-crm-${Date.now()}`, type: "Contactar segmento", risk: "Bajo", title: "Nueva activación de clientes", rationale: "Definiremos el segmento y solo incluiremos clientes con permiso de contacto.", evidence: {}, crmSegment: "Clientes con permiso" };
    return { id: `manual-content-${Date.now()}`, type: "Crear contenido", risk: "Bajo", title: "Nuevo contenido MOMOS", rationale: "Definiremos producto, objetivo y canal antes de preparar la pieza.", evidence: {}, channel: "Instagram" };
  }

  function continueFriendlyGoal() {
    if (selectedGoal === "content" && friendlyGuide.activeFlight) { showAdvanced(friendlyGuide.activeFlight.current.target); return; }
    if (selectedGoal === "results") { showAdvanced(); return; }
    if (selectedGoal === "sales" && activeGrowthMode) { openBrief(activeGrowthMode.recommendation); return; }
    openBrief(friendlyGuide.recommendations[selectedGoal] || manualGoalSource(selectedGoal));
  }

  async function useGrowthMode(mode) {
    if (db.agencyGrowthReady) {
      const snapshot = await registrarSnapshotMotorCrecimiento(growthSnapshotPayload(growthEngine));
      await seleccionarModoCrecimiento(snapshot.id, mode.id, mode.objective);
      toast("ok", `${mode.shortLabel} quedó elegido con los hechos actuales; todavía no se ejecutó nada.`);
      await refrescar();
    } else {
      toast("alert", "La estrategia puede prepararse, pero aplicá el Hito 53 para sellar la elección en el servidor.");
    }
    openBrief(mode.recommendation);
  }

  function openBrief(recommendation = null) {
    const source = recommendation || {
      id: `manual-${Date.now()}`, type: "Crear contenido", risk: "Bajo",
      title: "Nueva oportunidad comercial", rationale: "Brief iniciado manualmente por el equipo.", evidence: {},
    };
    setBriefSource(source);
    setBriefForm({
      title: source.title,
      objective: source.type === "Contactar segmento" ? "Recompra"
        : source.type === "Activar cumpleaños" ? "Cumpleaños"
          : ["Crear contenido", "Repetir creativo"].includes(source.type) ? "Contenido" : "Ventas",
      channel: source.channel || (source.type === "Contactar segmento" ? "WhatsApp" : "Instagram"),
      offer: source.suggestedOffer || "", crmSegment: source.crmSegment || "",
      proposedBudget: source.proposedBudget || 0, notes: source.rationale,
    });
  }

  async function saveBrief() {
    if (!serverReady) throw new Error("Aplicá primero la migración 16 de Agencia Comercial.");
    const created = await crearBriefAgencia({
      decision_key: briefSource.id, title: briefForm.title, objective: briefForm.objective,
      campaign_id: briefSource.campaignId || null, product_id: briefSource.productId || null,
      crm_segment: briefForm.crmSegment, offer: briefForm.offer, channel: briefForm.channel,
      deliverables: ["Crear contenido", "Repetir creativo", "Impulsar producto", "Mover inventario"].includes(briefSource.type)
        ? ["Pieza principal", "Adaptación para historias"] : [],
      insight: briefSource.rationale, evidence: briefSource.evidence || {}, proposed_budget: Number(briefForm.proposedBudget || 0), notes: briefForm.notes,
    });
    await crearDecisionAgencia({
      brief_id: created.brief_id, campaign_id: briefSource.campaignId || null, creative_id: briefSource.creativeId || null,
      type: agencyDecisionType(briefSource.type), title: briefSource.title, rationale: briefSource.rationale,
      evidence: briefSource.evidence || {}, risk_level: briefSource.risk, author: "reglas",
      proposed_action: {
        product_id: briefSource.productId || null, creative_id: briefSource.creativeId || null,
        proposed_budget: Number(briefForm.proposedBudget || 0), customer_ids: briefSource.customerIds || [],
      },
    });
    setBriefSource(null);
    toast("ok", "Brief y decisión guardados con trazabilidad");
    await refrescar();
  }

  async function saveSettings() {
    await guardarConfiguracionAgencia({
      autonomy_mode: settingsForm.autonomyMode, daily_budget_limit: Number(settingsForm.dailyBudgetLimit),
      campaign_budget_limit: Number(settingsForm.campaignBudgetLimit), scale_step_pct: Number(settingsForm.scaleStepPct),
      require_creative_approval: settingsForm.requireCreativeApproval, block_out_of_stock: settingsForm.blockOutOfStock,
      contact_only_authorized: settingsForm.contactOnlyAuthorized, paused: settingsForm.paused,
    });
    setSettingsOpen(false); toast("ok", "Guardas comerciales actualizadas"); await refrescar();
  }

  async function advanceBrief(brief) {
    const next = { "Borrador": "En revisión", "En revisión": "Aprobado", "Aprobado": "En producción", "En producción": "Completado" }[brief.status];
    if (!next) return;
    await setEstadoBriefAgencia(brief.id, next, `${next} desde Agencia MOMOS`);
    toast("ok", `Brief #${brief.id}: ${next}`); await refrescar();
  }

  async function advanceDecision(decision) {
    if (decision.status === "Propuesta") {
      await resolverDecisionAgencia(decision.id, "Aprobada", "Aprobación humana desde Agencia MOMOS");
      toast("ok", `Decisión #${decision.id} aprobada`); await refrescar(); return;
    }
    throw new Error("Las decisiones aprobadas se cierran con evidencia desde la Bandeja de acciones de Agencia.");
  }

  async function sendToOrchestrator(recommendation) {
    if (!db.agencyOrchestratorReady) throw new Error("Aplicá la migración 28 del Orquestador de Agencia.");
    await registrarRecomendacionOrquestador(orchestratorProposalPayload(recommendation));
    toast("ok", "Propuesta sellada en el Cerebro de Agencia; todavía no ejecutó ninguna acción.");
    await refrescar();
  }

  async function resolveOrchestratorProposal(proposal, decision) {
    let note = "Aprobación humana desde Agencia MOMOS";
    if (decision === "Descartar") {
      note = window.prompt("¿Por qué descartamos esta propuesta?", "No corresponde al momento comercial actual") || "";
      if (!note) return;
    }
    await resolverPropuestaOrquestador(proposal.id, decision, note);
    toast("ok", decision === "Aprobar" ? "Propuesta convertida en decisión aprobada; aún no se ejecutó." : "Propuesta descartada con trazabilidad.");
    await refrescar();
  }

  function openCreativeVersion() {
    const creative = (db.creatives || []).find((item) => !["Publicado","Ganador"].includes(item.estado)) || (db.creatives || [])[0];
    const tone = (db.brand_library?.tono || []).join(", ");
    setCreativeForm({
      creativeId: creative?.id || "", briefId: "",
      prompt: creative ? `Crear ${creative.formato} para ${creative.productoFoco || creative.titulo}. Hook: ${creative.hook || "momento MOMOS"}. Tono de marca: ${tone || "tierno, premium y cercano"}.` : "",
      negativePrompt: (db.brand_library?.palabrasNo || []).join(", "), assetUrl: creative?.assetUrl || "",
    });
    setCreativeOpen(true);
  }

  async function saveCreativeVersion() {
    if (!creativeForm.creativeId) throw new Error("Elegí el creativo que vas a versionar.");
    await crearVersionCreativaAgencia({
      creative_id: creativeForm.creativeId, brief_id: creativeForm.briefId || null,
      provider: "manual", prompt: creativeForm.prompt, negative_prompt: creativeForm.negativePrompt,
      asset_url: creativeForm.assetUrl, thumbnail_url: creativeForm.assetUrl, generation_cost: 0,
    });
    setCreativeOpen(false); toast("ok", "Versión creativa guardada con la marca usada como evidencia"); await refrescar();
  }

  function openCreativePackage(brief) {
    setCreativePackageVariant(0);
    setCreativePackageSubject({ figure: "", flavor: "" });
    setCreativePackageBrief(brief);
  }

  async function saveCreativePackage() {
    const brief = creativePackageBrief; const draft = creativePackageDraft;
    if (!brief || !draft) return;
    if (!["Aprobado", "En producción"].includes(brief.status)) {
      toast("alert", "El paquete puede revisarse, pero solo se guarda cuando el brief tenga aprobación humana."); return;
    }
    if (!draft.audit.passed) {
      toast("error", draft.audit.errors[0] || "El paquete no pasó el control de marca."); return;
    }
    const focusProduct = (db.products || []).find((product) => product.id === draft.productId);
    const compatibleFigures = activeFigureCatalog(db).filter((figure) => figureProductId(figure) === draft.productId);
    if (isCommercialFamilyProduct(focusProduct)) {
      if (!compatibleFigures.some((figure) => figure.nombre === creativePackageSubject.figure)) {
        toast("error", `Elegí el postre / figura protagonista de ${commercialFamilyLabel(focusProduct)} antes de guardar el creativo.`); return;
      }
      if (!creativePackageSubject.flavor) {
        toast("error", "Elegí el sabor protagonista antes de guardar el creativo."); return;
      }
    }
    const marker = `[AGENCY_BRIEF:${brief.id}]`;
    const existingVersion = (db.agencyCreativeVersions || []).find((version) => String(version.briefId) === String(brief.id));
    let creativeId = existingVersion?.creativeId || (db.creatives || []).find((creative) => String(creative.notas || "").includes(marker))?.id || "";
    try {
      if (!creativeId) {
        const created = await crearCreativo({
          campaign_id: draft.campaignId || null, titulo: draft.title, canal: draft.channel, formato: draft.format,
          producto_foco_id: draft.productId || null, figura: draft.figure || null, sabor: draft.flavor || null, hook: draft.selectedHook,
          copy: draft.copy, guion: draft.script.join("\n"), estado: "Idea", responsable: "Marketing",
          fecha_entrega: dISO(3), asset_url: "", notas: `${marker} Borrador generado desde Agencia MOMOS; requiere revisión humana.`,
        });
        creativeId = created.id;
      }
      if (!existingVersion) {
        await crearVersionCreativaAgencia({
          creative_id: creativeId, brief_id: brief.id, provider: "momos-ops-rules",
          prompt: draft.prompt, negative_prompt: draft.negativePrompt, brand_snapshot: draft.brandSnapshot,
          asset_url: "", thumbnail_url: "", generation_cost: 0,
        });
      }
      setCreativePackageBrief(null);
      toast("ok", `Paquete guardado como creativo ${creativeId}; continúa en Idea hasta revisión humana.`);
      await refrescar();
    } catch (error) {
      toast("error", creativeId
        ? `El creativo ${creativeId} quedó guardado, pero falta completar su versión trazable. Reintentá: ${error.message}`
        : error.message);
      try { await refrescar(); } catch { /* conserva la recuperación por marcador al recargar */ }
    }
  }

  async function reviewCreativeVersion(version, status) {
    await revisarVersionCreativaAgencia(version.id, status, status === "Aprobada" ? "Aprobación humana en Agencia MOMOS" : "Lista para revisión humana");
    toast("ok", `Versión ${version.version}: ${status}`); await refrescar();
  }

  const money = (value) => fmt(Math.round(Number(value || 0)));
  const riskStyle = (risk) => risk === "Alto" ? { bg: "#F6D4CD", fg: "#A03B2A" } : risk === "Medio" ? { bg: "#FBE8C8", fg: "#96690F" } : { bg: "#DDEBD9", fg: "#3F6B42" };
  const learningStyle = (stage) => ({
    winner: { bg: "#DDEBD9", fg: "#315B35", border: "#B8D3B2" },
    funnel: { bg: "#FBE8C8", fg: "#8B5A08", border: "#EACB92" },
    spend: { bg: "#F6D4CD", fg: "#A03B2A", border: "#E6B7AE" },
    ambiguous: { bg: "#FFF2D8", fg: "#7A5410", border: "#E8C98B" },
    collecting: { bg: "#E5EEF7", fg: "#315A7D", border: "#C7D8E8" },
    promising: { bg: "#E9E4F4", fg: "#5C4C7D", border: "#D4C9E7" },
    missing: { bg: "#F5E9D8", fg: T.choco2, border: T.border },
    inconclusive: { bg: "#F3EEE8", fg: T.choco2, border: T.border },
  }[stage] || { bg: "#F3EEE8", fg: T.choco2, border: T.border });
  const pillarIcon = { Inventario: "📦", Pauta: "📣", CRM: "💗", Producto: "🍨", Contenido: "🎨", Marca: "✦", General: "◎" };
  const evidenceValue = (value) => {
    if (Array.isArray(value)) return `${value.length} registro(s)`;
    if (value && typeof value === "object") return JSON.stringify(value).slice(0, 120);
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
    return String(value ?? "—");
  };
  const pipelineSteps = [
    ["Oportunidades", intelligence.pipeline.opportunities, "Detectadas"],
    ["Briefs", intelligence.pipeline.briefs, "En curso"],
    ["Aprobaciones", intelligence.pipeline.approvals, "Humanas"],
    ["Creativo", intelligence.pipeline.creativeReview, "En revisión"],
    ["Programado", intelligence.pipeline.scheduled, "Próx. 7 días"],
    ["Aprendizaje", learning.summary.conclusive, "Lecturas concluyentes"],
  ];
  const advancedAreas = [
    { id: "overview", icon: "⌂", label: "Resumen", description: "Qué está avanzando", count: friendlyGuide.activeFlightCount },
    { id: "identity", icon: "✦", label: "Marca", description: "Cómo debe verse", count: brandIdentity.logos.length },
    { id: "strategy", icon: "✦", label: "Oportunidades", description: "Qué conviene hacer", count: intelligence.recommendations.length },
    { id: "creative", icon: "🎨", label: "Crear", description: "Del guion al archivo", count: intelligence.pipeline.briefs },
    { id: "results", icon: "📊", label: "Resultados", description: "Qué funcionó", count: learning.summary.conclusive },
    { id: "protection", icon: "✓", label: "Revisión", description: "Aprobar y proteger", count: intelligence.pipeline.approvals },
  ];
  const advancedAreaCopy = {
    overview: ["Estado general", "Revisá el trabajo en curso y abrí únicamente el siguiente paso."],
    identity: ["Identidad de MOMOS", "Logo, colores, tipografías, voz y estilo que deben respetar todas las piezas."],
    strategy: ["Decidir qué hacer", "MOMO OPS reúne oportunidades y alternativas para que el equipo elija."],
    creative: ["Construir contenido", "Guion, escenas, movimiento y calidad organizados como una sola ruta."],
    results: ["Aprender y mejorar", "Ventas, publicaciones y pauta convertidas en decisiones comprensibles."],
    protection: ["Aprobar con seguridad", "Acciones, permisos y límites que siempre requieren una persona."],
  };
  const activeAdvancedArea = advancedAreas.find((item) => item.id === advancedArea) || advancedAreas[0];
  const advancedModules = {
    overview: [
      { id: "overview-pipeline", icon: "🧭", eyebrow: "Estado general", title: "Recorrido de la agencia", description: "Mirá cuántas oportunidades, briefs, aprobaciones y piezas están avanzando.", metric: friendlyGuide.activeFlightCount, metricLabel: "trabajos activos", tone: "blue" },
      { id: "overview-flight", icon: "🎬", eyebrow: "Siguiente paso", title: "Producción creativa en curso", description: "Abrí únicamente el trabajo que necesita continuar ahora.", metric: intelligence.pipeline.creativeReview, metricLabel: "en revisión", tone: "coral" },
    ],
    identity: [
      { id: "identity-overview", icon: "✦", eyebrow: "Fuente oficial", title: "Identidad de marca MOMOS", description: "Logo, paleta, tipografía, voz y reglas de uso reunidas en una versión aprobada.", metric: brandIdentity.logos.length, metricLabel: "logos oficiales", tone: brandIdentity.ready ? "green" : "gold" },
      { id: "creative-library", icon: "🎨", eyebrow: "Archivos originales", title: "Biblioteca creativa", description: "Fotos, videos, logos y referencias con derechos y trazabilidad.", metric: (db.brandMediaAssets || []).length, metricLabel: "archivos", tone: "coral" },
      { id: "visual-quality", icon: "🎬", eyebrow: "Calidad para IA", title: "Activos listos para crear", description: "Verificá qué fotos sirven para imagen, video y Elements, y cuáles necesitan una nueva toma.", metric: visualProductionLibrary.summary.videoReady, metricLabel: "aptos para video", tone: visualQualityPending > 0 ? "gold" : "green" },
    ],
    strategy: [
      { id: "strategy-humanization", icon: "♡", eyebrow: "Conexión de marca", title: "Humanización y Comunidad", description: "Series, episodios y señales reales sin testimonios inventados ni datos personales.", metric: Number(db.agencyHumanization?.summary?.approved_series || 0), metricLabel: "series activas", tone: "rose" },
      { id: "strategy-opportunities", icon: "✦", eyebrow: "Radar comercial", title: "Oportunidades para crecer", description: "Recomendaciones explicadas con ventas, clientes, stock y contenido real.", metric: intelligence.recommendations.length, metricLabel: "oportunidades", tone: "coral" },
      { id: "strategy-scenarios", icon: "▣", eyebrow: "Antes de invertir", title: "Comparar alternativas", description: "Revisá escenarios y sus alertas sin cambiar campañas ni presupuesto.", metric: (db.agencyMetaInvestmentScenarios || []).length, metricLabel: "escenarios", tone: "gold" },
      { id: "strategy-brain", icon: "🧠", eyebrow: "Propuestas protegidas", title: "Cerebro de Agencia MOMOS", description: "Propuestas trazables que el equipo puede aprobar o descartar.", metric: orchestrator.summary.pending, metricLabel: "por revisar", tone: "rose" },
    ],
    creative: [
      { id: "creative-collaboration", icon: "🤝", eyebrow: "Trabajo en equipo", title: "Mesa creativa", description: "Hechos, decisiones y aportes humanos organizados alrededor de cada pieza.", metric: intelligence.pipeline.briefs, metricLabel: "briefs", tone: "blue" },
      { id: "creative-retention", icon: "🪝", eyebrow: "Guion y atención", title: "Hooks y retención", description: "Diseñá aperturas, loops y aprendizajes para sostener la atención.", metric: learning.summary.conclusive, metricLabel: "aprendizajes", tone: "gold" },
      { id: "creative-studio", icon: "🎥", eyebrow: "De idea a tomas", title: "Estudio de producción", description: "Storyboard, cámara, movimiento, motores y control de calidad en una sola ruta.", metric: intelligence.pipeline.creativeReview, metricLabel: "piezas activas", tone: "coral" },
      { id: "creative-library", icon: "🎨", eyebrow: "Marca y archivos", title: "Biblioteca creativa", description: "Briefs, versiones y reglas de marca con todo el detalle disponible al abrir.", metric: (db.agencyCreativeVersions || []).length, metricLabel: "versiones", tone: "green" },
    ],
    results: [
      { id: "results-formulas", icon: "✦", eyebrow: "Memoria creativa", title: "Fórmulas ganadoras", description: "Versioná lo que funciona y compará Meta/TikTok con ventas y margen reales.", metric: Number(db.agencyCreativeIntelligence?.summary?.winners || 0), metricLabel: "ganadoras", tone: "coral" },
      { id: "results-learning", icon: "📈", eyebrow: "Aprendizaje comercial", title: "Qué funcionó", description: "Ventas, gasto y pedidos ligados a cada publicación sin inventar ganadores.", metric: learning.summary.conclusive, metricLabel: "conclusiones", tone: "green" },
      { id: "results-meta", icon: "◎", eyebrow: "Lectura de plataformas", title: "Resultados de Meta", description: "Snapshots y métricas verificables en modo de solo lectura.", metric: learning.summary.published, metricLabel: "publicadas", tone: "blue" },
      { id: "results-incrementality", icon: "⇄", eyebrow: "Impacto real", title: "Incrementalidad", description: "Separá correlación de ventas que realmente produjo la campaña.", metric: learning.summary.winners, metricLabel: "ganadoras", tone: "rose" },
    ],
    protection: [
      { id: "protection-actions", icon: "🎯", eyebrow: "Decisiones del equipo", title: "Acciones por aprobar", description: "Una acción clara por tarjeta, con responsable y siguiente paso.", metric: intelligence.pipeline.approvals, metricLabel: "por revisar", tone: "coral" },
      { id: "protection-meta", icon: "✓", eyebrow: "Inversión protegida", title: "Permisos de Meta", description: "Vigencia, alcance y doble aprobación antes de cualquier cambio externo.", metric: 0, metricLabel: "sin ejecutar", tone: "green" },
      { id: "protection-guards", icon: "🛡️", eyebrow: "Límites operativos", title: "Guardas de la agencia", description: "Presupuesto, stock, contactos y parada de emergencia en lenguaje sencillo.", metric: settings.paused ? 1 : 0, metricLabel: settings.paused ? "agencia pausada" : "alertas", tone: "gold" },
    ],
  };
  const activeAdvancedModules = advancedModules[advancedArea] || advancedModules.overview;
  const selectedAdvancedModule = Object.values(advancedModules).flat().find((item) => item.id === advancedDetail);

  return (
    <section className="mb-6" aria-label="Agencia Comercial MOMOS">
      <div className="rounded-2xl overflow-hidden border shadow-sm" style={{ borderColor: T.border, background: T.surface }}>
        <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface }}>
          <div className="flex items-start gap-3 min-w-0"><span className="w-10 h-10 rounded-2xl grid place-items-center text-lg shrink-0" style={{ background: T.coralSoft }}>✦</span><div><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-extrabold tracking-[.18em] uppercase" style={{ color: T.coral }}>MOMO OPS Intelligence</span><span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold" style={{ background: settings.paused ? "#F6D4CD" : "#DDEBD9", color: settings.paused ? "#A03B2A" : "#315B35" }}>{settings.paused ? "Pausada" : "Protegida"}</span></div><h2 className="display text-xl font-semibold mt-0.5 mb-0">Tu agencia comercial</h2><p className="text-xs mt-1 mb-0 max-w-2xl" style={{ color: T.choco2 }}>Elegí qué quieres lograr. MOMOS prepara una propuesta y vos aprobás el resultado.</p></div></div>
          <div className="flex flex-col gap-2 shrink-0">
            <div className="grid grid-cols-4 gap-2">{[["✓","Marca"],["✓","Revisión"],["✓","Datos reales"],[db.visualQualityReady ? visualProductionLibrary.summary.videoReady : "—","Video IA"]].map(([value,label]) => <div key={label} className="rounded-xl border px-3 py-2 text-center min-w-[64px]" style={{ borderColor: T.border, background: "#FFFDFC" }}><div className="display text-lg font-semibold" style={{ color: label === "Video IA" && visualQualityPending > 0 ? "#9A6410" : "#3F6B42" }}>{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
            <button type="button" aria-label="Abrir Biblioteca de fotos, videos y marca" onClick={() => openBrandLibrary()} className="w-full rounded-xl border px-3 py-2.5 flex items-center gap-3 text-left transition hover:-translate-y-px hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1" style={{ borderColor: "#E9A18F", background: "#FFF5F0", "--tw-ring-color": T.coral }}>
              <span className="w-8 h-8 rounded-xl grid place-items-center shrink-0" style={{ background: T.coralSoft }} aria-hidden="true">🖼️</span>
              <span className="flex-1 min-w-0"><span className="block text-xs font-extrabold" style={{ color: T.choco }}>Abrir Biblioteca</span><span className="block text-[9px]" style={{ color: T.choco2 }}>Fotos, videos, logos y marca · {(db.brandMediaAssets || []).filter((asset) => asset.status === "Activo").length} activos</span></span>
              <span className="text-base font-bold" style={{ color: T.coral }} aria-hidden="true">›</span>
            </button>
            <button type="button" aria-label="Revisar calidad de fotos y videos para inteligencia artificial" onClick={() => openBrandLibrary({ section: "Activos de producción" })} className="w-full rounded-xl border px-3 py-2.5 flex items-center gap-3 text-left transition hover:-translate-y-px hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1" style={{ borderColor: db.visualQualityReady ? "#B8D3B2" : "#E7C078", background: db.visualQualityReady ? "#F4FAF2" : "#FFF9EC", "--tw-ring-color": db.visualQualityReady ? "#6B956D" : "#C58B24" }}>
              <span className="w-8 h-8 rounded-xl grid place-items-center shrink-0" style={{ background: db.visualQualityReady ? "#DDEBD9" : "#FFF0CE" }} aria-hidden="true">🎬</span>
              <span className="flex-1 min-w-0"><span className="block text-xs font-extrabold" style={{ color: T.choco }}>Calidad para IA</span><span className="block text-[9px]" style={{ color: T.choco2 }}>{db.visualQualityReady ? `${visualProductionLibrary.summary.videoReady} aptos para video · ${visualQualityPending} por revisar` : "Conectar revisión maestra H110"}</span></span>
              <span className="text-base font-bold" style={{ color: db.visualQualityReady ? "#3F6B42" : "#9A6410" }} aria-hidden="true">›</span>
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {!serverReady && <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Vista inteligente activa · aplicá <code>agencia-comercial-v1.sql</code> para guardar briefs, aprobaciones y decisiones en el servidor.</div>}

          {agencyView === "simple" ? <AgencyFriendlyHome guide={friendlyGuide} selectedGoal={selectedGoal} onSelectGoal={setSelectedGoal} onContinue={continueFriendlyGoal} onAdvanced={() => showAdvanced()} growthEngine={growthEngine} selectedGrowthModeId={activeGrowthMode?.id} onSelectGrowthMode={setSelectedGrowthModeId} onUseGrowthMode={useGrowthMode} brandIdentity={brandIdentity} brandIdentityLoading={brandIdentityLoading} brandIdentityError={brandIdentityError} onOpenIdentity={openBrandIdentity} /> : <>
          <div className="sticky top-2 z-20 rounded-2xl border p-3 mb-4 shadow-sm" style={{ borderColor: T.border, background: "rgba(255,253,250,.97)", backdropFilter: "blur(10px)" }}>
            <div className="flex items-center justify-between gap-3 mb-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Centro de Agencia MOMOS</div><div className="text-xs font-bold">Elegí el área que quieres revisar</div></div><Btn small kind="ghost" onClick={() => { setAgencyView("simple"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>← Inicio sencillo</Btn></div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2" role="tablist" aria-label="Áreas del Centro de Agencia MOMOS">{advancedAreas.map((area) => { const active = area.id === advancedArea; return <button key={area.id} type="button" role="tab" aria-selected={active} onClick={() => setAdvancedArea(area.id)} className="rounded-xl border px-3 py-2.5 text-left transition" style={{ borderColor: active ? "#E9A18F" : T.border, background: active ? "#FFF5F0" : T.surface }}><div className="flex items-center justify-between gap-2"><span className="text-sm">{area.icon}</span><span className="rounded-full min-w-5 h-5 px-1 grid place-items-center text-[8px] font-extrabold" style={{ background: active ? T.coralSoft : T.vainilla }}>{area.count}</span></div><div className="text-[11px] font-extrabold mt-1">{area.label}</div><div className="text-[8px]" style={{ color: T.choco2 }}>{area.description}</div></button>; })}</div>
          </div>

          <div className="rounded-2xl border px-4 py-3 mb-4 flex items-start gap-3" style={{ borderColor: T.border, background: T.vainilla }}><span className="w-8 h-8 rounded-xl grid place-items-center shrink-0" style={{ background: T.surface }}>{activeAdvancedArea.icon}</span><div><div className="display text-base font-semibold">{advancedAreaCopy[advancedArea][0]}</div><div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>{advancedAreaCopy[advancedArea][1]}</div></div></div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-5" aria-label={`Herramientas de ${activeAdvancedArea.label}`}>
            {activeAdvancedModules.map((module) => <AgencyAdvancedModuleCard key={module.id} {...module} status={module.metric > 0 ? "Con información" : "Listo para usar"} onOpen={() => { if (module.id === "creative-library") openBrandLibrary(); else if (module.id === "visual-quality") openBrandLibrary({ section: "Activos de producción" }); else setAdvancedDetail(module.id); }} />)}
          </div>
          <div className="rounded-2xl border px-4 py-3 text-[10px] flex items-start gap-2" style={{ borderColor: T.border, background: "#FFF9F1", color: T.choco2 }}><span aria-hidden="true">💡</span><span><b style={{ color: T.choco }}>Vista limpia:</b> cada tarjeta muestra solo lo necesario. Abrila para consultar datos, evidencia y controles completos.</span></div>

          {advancedDetail === "overview-pipeline" && <Modal title="Recorrido de la agencia" onClose={() => setAdvancedDetail(null)} extraWide><div className="rounded-2xl border p-4 mb-5" style={{ borderColor: T.border, background: T.surface }}>
            <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
              <div><div className="text-[10px] font-extrabold tracking-[.14em] uppercase" style={{ color: T.coral }}>Recorrido comercial</div><div className="display text-lg font-semibold">Cómo avanza el trabajo</div></div>
              <div className="text-[11px]" style={{ color: T.choco2 }}>Cada número abre una decisión del equipo.</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
              {pipelineSteps.map(([label, value, sub], index) => <div key={label} className="relative rounded-2xl border px-3 py-3" style={{ borderColor: T.border, background: index === 0 ? "#FFF" : "rgba(255,255,255,.64)" }}>
                <div className="text-[9px] font-extrabold uppercase tracking-wider" style={{ color: T.choco2 }}>{String(index + 1).padStart(2, "0")} · {label}</div>
                <div className="display text-2xl font-semibold" style={{ color: index === 0 ? T.coral : T.choco }}>{value}</div>
                <div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>{sub}</div>
              </div>)}
            </div>
          </div>

          </Modal>}
          {advancedDetail === "overview-flight" && <Modal title="Producción creativa en curso" onClose={() => setAdvancedDetail(null)} extraWide><AgencyCreativeFlightCenter db={db} go={go} refrescar={refrescar} /></Modal>}
          {advancedDetail === "identity-overview" && <Modal title="Identidad de marca MOMOS" onClose={() => setAdvancedDetail(null)} extraWide><BrandIdentityPanel identity={brandIdentity} loading={brandIdentityLoading} error={brandIdentityError} onRetry={() => loadBrandIdentity({ includeHistory: true, signAssets: true })} onOpenLibrary={openBrandLibrary} /></Modal>}
          {advancedDetail === "protection-actions" && <Modal title="Acciones por aprobar" onClose={() => setAdvancedDetail(null)} extraWide><AgencyActionCenter db={db} go={go} refrescar={refrescar} /></Modal>}
          {advancedDetail === "protection-meta" && <Modal title="Permisos de inversión Meta" onClose={() => setAdvancedDetail(null)} extraWide><Suspense fallback={agencySectionFallback}><LazyAgencyMetaSuite module="authorization" db={db} refrescar={refrescar} /></Suspense></Modal>}
          {advancedDetail === "protection-guards" && <Modal title="Guardas de la agencia" onClose={() => setAdvancedDetail(null)}><div className="rounded-2xl p-4 mb-4 text-sm" style={{ background: T.vainilla }}>Definí límites claros. Ningún cambio publica, contacta ni gasta por sí solo.</div><Btn onClick={() => { setAdvancedDetail(null); setSettingsForm(settings); setSettingsOpen(true); }}>Revisar guardas</Btn></Modal>}
          {advancedDetail === "results-meta" && <Modal title="Resultados de Meta" onClose={() => setAdvancedDetail(null)} extraWide><Suspense fallback={agencySectionFallback}><LazyAgencyMetaSuite module="observatory" db={db} refrescar={refrescar} /></Suspense></Modal>}
          {advancedDetail === "results-incrementality" && <Modal title="Incrementalidad Meta" onClose={() => setAdvancedDetail(null)} extraWide><Suspense fallback={agencySectionFallback}><LazyAgencyMetaSuite module="incrementality" db={db} refrescar={refrescar} /></Suspense></Modal>}
          {advancedDetail === "strategy-scenarios" && <Modal title="Comparar alternativas antes de invertir" onClose={() => setAdvancedDetail(null)} extraWide><Suspense fallback={agencySectionFallback}><LazyAgencyMetaSuite module="investment" db={db} refrescar={refrescar} /></Suspense></Modal>}
          {advancedDetail === "creative-collaboration" && <Modal title="Mesa creativa MOMOS" onClose={() => setAdvancedDetail(null)} extraWide><div id="agency-collaboration-desk"><Suspense fallback={agencySectionFallback}><LazyAgencyCreativeSuite module="collaboration" db={db} refrescar={refrescar} /></Suspense></div></Modal>}
          {advancedDetail === "creative-retention" && <Modal title="Hooks, retención y aprendizaje" onClose={() => setAdvancedDetail(null)} extraWide><div id="agency-retention-lab"><Suspense fallback={agencySectionFallback}><LazyAgencyCreativeSuite module="retention" db={db} refrescar={refrescar} /></Suspense></div></Modal>}
          {advancedDetail === "creative-studio" && <Modal title="Estudio de producción creativa" onClose={() => setAdvancedDetail(null)} extraWide><div id="agency-scene-studio"><Suspense fallback={agencySectionFallback}><LazyAgencyCreativeSuite module="studio" db={db} refrescar={refrescar} /></Suspense></div></Modal>}

          {["strategy-brain", "strategy-opportunities"].includes(advancedDetail) && <Modal title={selectedAdvancedModule?.title || "Estrategia comercial"} onClose={() => setAdvancedDetail(null)} extraWide><div className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }}>
            <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#4A3028,#704334)", color: "#fff" }}>
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "rgba(255,255,255,.14)" }}>🧠</div>
                <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Orquestador protegido · MCP</div><div className="display text-xl font-semibold">Cerebro de Agencia MOMOS</div><div className="text-xs opacity-80 max-w-2xl">Recibe señales y propuestas de agentes, declara qué herramientas necesita y sella evidencia, confianza y costo. Nunca publica ni gasta por sí solo.</div></div>
              </div>
              <div className="grid grid-cols-3 gap-2 shrink-0">
                {[["Pendientes",orchestrator.summary.pending],["Externas",orchestrator.summary.externalActions],["Costo máx.",money(orchestrator.summary.estimatedCost)]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[76px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}
              </div>
            </div>
            {!db.agencyOrchestratorReady ? <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>orquestador-agencia-v1.sql</code> para habilitar la bandeja gobernada y el contrato para MCP.</div> : orchestrator.pending.length === 0 ? <div className="px-4 py-4 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Bandeja al día.</b> Enviá una oportunidad del radar o conectá un agente MCP para recibir propuestas trazables.</div> : <div className="p-3 grid lg:grid-cols-2 gap-2">
              {orchestrator.pending.slice(0, 4).map((proposal) => <article key={proposal.id} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#FFF9F2" }}>
                <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{proposal.decisionType} · riesgo {proposal.riskLevel}</div><div className="font-extrabold text-sm">{proposal.title}</div></div><span className="rounded-full px-2 py-1 text-[9px] font-extrabold shrink-0" style={{ background: "#E5EEF7", color: "#315A7D" }}>{Math.round(proposal.confidence * 100)}% confianza</span></div>
                <p className="text-[11px] leading-relaxed my-2" style={{ color: T.choco2 }}>{proposal.rationale}</p>
                <div className="flex flex-wrap gap-1 mb-2">{proposal.requiredTools.map((tool) => <span key={tool} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: T.vainilla }}>{tool}</span>)}</div>
                <div className="rounded-xl px-2.5 py-2 mb-2 text-[10px]" style={{ background: "#F5E9D8" }}><b>{proposal.executionMode}</b> · costo máximo {money(proposal.costCapCop)} · huella {proposal.fingerprint.slice(0, 8)}</div>
                <div className="flex flex-wrap gap-2"><BtnAsync small onClick={() => resolveOrchestratorProposal(proposal, "Aprobar")}>Aprobar propuesta</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveOrchestratorProposal(proposal, "Descartar")}>Descartar</BtnAsync></div>
              </article>)}
            </div>}
            <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Aprobar crea una decisión comercial aprobada, no una ejecución. Pauta, publicación, contacto y gasto conservan su confirmación y sus guardas.</div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div><div className="text-[10px] font-extrabold tracking-[.14em] uppercase" style={{ color: T.coral }}>Radar de oportunidades</div><div className="display text-xl font-semibold">Qué conviene hacer ahora</div><div className="text-sm" style={{ color: T.choco2 }}>Cruza pedidos pagados, stock, CRM, contenido y pauta; cada recomendación explica su evidencia.</div></div>
            <div className="flex gap-2"><Btn kind="soft" small onClick={() => openBrief()}>＋ Brief manual</Btn>{user === "Administrador" && <Btn kind="ghost" small onClick={() => { setSettingsForm(settings); setSettingsOpen(true); }}>⚙ Guardas</Btn>}</div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3" role="tablist" aria-label="Filtrar oportunidades por área">
            {opportunityPillars.map((pillar) => {
              const active = opportunityFilter === pillar;
              const count = pillar === "Todas" ? intelligence.recommendations.length : intelligence.recommendations.filter((item) => item.pillar === pillar).length;
              return <button key={pillar} type="button" role="tab" aria-selected={active} onClick={() => setOpportunityFilter(pillar)} className="shrink-0 rounded-full border px-3 py-2 text-[11px] font-extrabold transition"
                style={{ borderColor: active ? T.coral : T.border, background: active ? T.coral : "#fff", color: active ? "#fff" : T.choco }}>
                {pillar === "Todas" ? "◎" : pillarIcon[pillar] || "◎"} {pillar} <span className="ml-1 opacity-75">{count}</span>
              </button>;
            })}
          </div>
          <div className="grid lg:grid-cols-2 gap-3">
            {visibleRecommendations.slice(0, 8).map((item) => {
              const guard = item.guard; const risk = riskStyle(item.risk); const created = existingKeys.has(item.id);
              const expanded = expandedOpportunity === item.id;
              return <article key={item.id} className="rounded-3xl border p-4 sm:p-5 flex flex-col shadow-sm" style={{ borderColor: guard.allowed ? T.border : "#E6B7AE", background: guard.allowed ? "linear-gradient(145deg,#FFF,#FFF8F2)" : "#FFF5F2" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2"><span className="w-9 h-9 shrink-0 rounded-2xl grid place-items-center text-base" style={{ background: T.vainilla }}>{pillarIcon[item.pillar] || "◎"}</span><div><div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.choco2 }}>{item.pillar}</div><div className="text-[11px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{item.type}</div></div></div>
                  <div className="flex flex-wrap justify-end gap-1"><span className="px-2 py-1 rounded-full text-[9px] font-extrabold" style={{ background: T.vainilla, color: T.choco }}>Prioridad {item.priority}</span><span className="px-2 py-1 rounded-full text-[9px] font-extrabold" style={{ background: risk.bg, color: risk.fg }}>Riesgo {item.risk}</span></div>
                </div>
                <h3 className="display text-lg font-semibold mt-3 mb-1">{item.title}</h3>
                <p className="text-xs leading-relaxed mb-3" style={{ color: T.choco2 }}>{item.rationale}</p>
                <div className="flex flex-wrap gap-1.5 mb-3">{item.signals.map((itemSignal) => <span key={itemSignal} className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: "#F5E9D8", color: T.choco }}>{itemSignal}</span>)}</div>
                <div className="rounded-2xl px-3 py-2.5 mb-3" style={{ background: "#F8EFE4", borderLeft: `3px solid ${T.coral}` }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Siguiente paso</div><div className="text-[11px] leading-relaxed font-semibold" style={{ color: T.choco }}>{item.nextStep}</div></div>
                <button type="button" className="self-start border-0 bg-transparent p-0 mb-3 text-[11px] font-extrabold underline" style={{ color: T.choco2 }} onClick={() => setExpandedOpportunity(expanded ? null : item.id)} aria-expanded={expanded}>{expanded ? "Ocultar evidencia" : "Ver evidencia y confianza"}</button>
                {expanded && <div className="rounded-2xl p-3 mb-3 text-[11px]" style={{ background: "#fff", border: `1px dashed ${T.border}` }}>
                  <div className="font-extrabold mb-2" style={{ color: T.choco }}>Confianza {item.confidence} · fuente interna de MOMO OPS</div>
                  <div className="grid sm:grid-cols-2 gap-1.5">{Object.entries(item.evidence || {}).map(([key, value]) => <div key={key} className="flex justify-between gap-2"><span style={{ color: T.choco2 }}>{key}</span><b className="text-right break-all">{evidenceValue(value)}</b></div>)}</div>
                </div>}
                <div className="mt-auto">
                  <div className="rounded-xl px-3 py-2 text-[11px] mb-3" style={{ background: guard.allowed ? "#E8F1E4" : "#F6D4CD", color: guard.allowed ? "#3F6B42" : "#A03B2A" }}>
                    {guard.allowed ? "✓ Pasa las guardas; requiere aprobación según el modo." : `⛔ ${guard.reasons[0]}`}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <BtnAsync small disabled={orchestratedKeys.has(`momos:${item.id}`) || !db.agencyOrchestratorReady || !guard.allowed} onClick={() => sendToOrchestrator(item)}>{orchestratedKeys.has(`momos:${item.id}`) ? "En el cerebro ✓" : "Enviar al cerebro"}</BtnAsync>
                    <Btn small kind="ghost" disabled={created || !serverReady || !guard.allowed} onClick={() => openBrief(item)}>{created ? "Brief creado ✓" : guard.allowed ? "Crear brief directo" : "Bloqueada por guardas"}</Btn>
                  </div>
                </div>
              </article>;
            })}
          </div>
          {visibleRecommendations.length === 0 && <Empty icon="✦" text="No hay oportunidades en este frente hoy. El radar seguirá cruzando operación, clientes y campañas." />}
          </Modal>}

          {advancedDetail === "results-formulas" && <Modal title="Fórmulas ganadoras y memoria creativa" onClose={() => setAdvancedDetail(null)} extraWide><Suspense fallback={agencySectionFallback}><LazyAgencyFormulaLab db={db} refrescar={refrescar} /></Suspense></Modal>}

          {advancedDetail === "strategy-humanization" && <Modal title="Humanización y Comunidad MOMOS" onClose={() => setAdvancedDetail(null)} extraWide><Suspense fallback={agencySectionFallback}><LazyAgencyHumanizationHub db={db} refrescar={refrescar} /></Suspense></Modal>}

          {advancedDetail === "results-learning" && <Modal title="Qué funcionó y qué conviene repetir" onClose={() => setAdvancedDetail(null)} extraWide><div className="mt-2 mb-3 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <div className="text-[10px] font-extrabold tracking-[.14em] uppercase" style={{ color: T.coral }}>Sala de aprendizaje</div>
              <div className="display text-xl font-semibold">Qué aprendimos de lo publicado</div>
              <div className="text-sm max-w-3xl" style={{ color: T.choco2 }}>Cruza la publicación exacta, métricas de plataforma, gasto y pedidos pagados. Si la atribución es dudosa, MOMO OPS espera y no inventa un ganador.</div>
            </div>
            <span className="self-start sm:self-auto rounded-full px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider" style={{ background: T.vainilla, color: T.choco }}>Decisiones con evidencia</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
            {[
              ["Publicadas", learning.summary.published],
              ["Sin métricas", learning.summary.missingMetrics],
              ["Conclusiones", learning.summary.conclusive],
              ["Ganadoras", learning.summary.winners],
              ["Atribución pendiente", learning.summary.ambiguousAttribution],
            ].map(([label, value]) => <div key={label} className="rounded-2xl border px-3 py-3" style={{ borderColor: T.border, background: "#FFF9F1" }}>
              <div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div>
              <div className="display text-2xl font-semibold" style={{ color: T.coral }}>{value}</div>
            </div>)}
          </div>
          {learning.items.length > 0 ? <div className="grid lg:grid-cols-2 gap-3 mb-6">
            {learning.items.slice(0, 6).map((item) => {
              const stageStyle = learningStyle(item.stage.key);
              const recommendation = item.recommendation;
              const guard = recommendation ? guardAgencyAction({ ...recommendation, today: hoyISO(), execute: false }, db, settings) : null;
              const created = recommendation ? existingKeys.has(recommendation.id) : false;
              return <article key={item.post.id} className="rounded-3xl border p-4 flex flex-col shadow-sm" style={{ borderColor: stageStyle.border, background: "linear-gradient(145deg,#FFF,#FFF9F2)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[9px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>{item.post.canal || "Canal"} · {item.post.fecha} · {item.post.id}</div>
                    <h3 className="display text-lg font-semibold mt-1 mb-0">{item.creative?.titulo || item.post.titulo || "Publicación MOMOS"}</h3>
                  </div>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase" style={{ background: stageStyle.bg, color: stageStyle.fg }}>{item.stage.label}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-3">
                  {[
                    ["Pedidos", item.metrics.orders],
                    ["Ventas", money(item.metrics.revenue)],
                    ["Gasto", money(item.metrics.spend)],
                    ["ROAS", item.metrics.roas == null ? "Orgánico / —" : `${item.metrics.roas.toFixed(1)}×`],
                  ].map(([label, value]) => <div key={label} className="rounded-xl px-2.5 py-2" style={{ background: "#F8EFE4" }}><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="text-xs font-extrabold">{value}</div></div>)}
                </div>
                <p className="text-xs leading-relaxed mb-2" style={{ color: T.choco2 }}>{item.stage.insight}</p>
                <div className="rounded-2xl px-3 py-2.5 mb-3" style={{ background: stageStyle.bg, color: stageStyle.fg }}><div className="text-[9px] uppercase tracking-wider font-extrabold">Siguiente paso</div><div className="text-[11px] leading-relaxed font-semibold">{item.stage.nextStep}</div></div>
                {item.attribution.ambiguous > 0 && <div className="text-[10px] font-bold mb-3" style={{ color: "#7A5410" }}>Hay {item.attribution.ambiguous} pedido(s) sin publicación exacta. No se usaron para decidir.</div>}
                {recommendation && <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[10px] font-bold" style={{ color: guard?.allowed ? "#3F6B42" : "#A03B2A" }}>{guard?.allowed ? "✓ Aprendizaje listo para brief humano" : `Protegido: ${guard?.reasons?.[0] || "requiere revisión"}`}</div>
                  <Btn small kind={created ? "ghost" : "primary"} disabled={created || !serverReady || !guard?.allowed} onClick={() => openBrief(recommendation)}>{created ? "Brief creado ✓" : "Convertir aprendizaje en brief"}</Btn>
                </div>}
              </article>;
            })}
          </div> : <div className="mb-6"><Empty icon="◎" text="Cuando una publicación salga al aire, aparecerá aquí para medirla sin mezclar sus pedidos con otras piezas." /></div>}

          </Modal>}

          {advancedDetail === "creative-library" && <Modal title="Biblioteca creativa y marca" onClose={() => { setAdvancedDetail(null); setBrandStudioIntent(null); }} extraWide><Suspense fallback={agencySectionFallback}><LazyAgencyBrandStudio db={db} user={user} refrescar={refrescar} initialIntent={brandStudioIntent} onIdentityChanged={() => loadBrandIdentity({ includeHistory: true, signAssets: false })} /></Suspense>

          {(db.agencyBriefs || []).length > 0 && <>
            <SectionTitle>Flujo de briefs</SectionTitle>
            <div className="grid md:grid-cols-2 gap-3">
              {(db.agencyBriefs || []).slice(0, 4).map((brief) => <div key={brief.id} className="rounded-2xl border p-4" style={{ borderColor: T.border, background: "#fff" }}>
                <div className="flex justify-between gap-2"><div><div className="text-[10px] font-extrabold uppercase" style={{ color: T.coral }}>BRIEF #{brief.id} · {brief.objective}</div><div className="display font-semibold">{brief.title}</div></div><Badge label={brief.status} /></div>
                <div className="text-xs mt-2" style={{ color: T.choco2 }}>{brief.channel} · presupuesto {money(brief.proposedBudget)}{brief.stockSnapshot !== null ? ` · stock foto ${brief.stockSnapshot}` : ""}</div>
                {["Borrador","En revisión","Aprobado","En producción"].includes(brief.status) && <div className="mt-3 flex flex-wrap gap-2">
                  <Btn kind="ghost" small onClick={() => openCreativePackage(brief)}>✦ Preparar paquete</Btn>
                  <BtnAsync small kind={brief.status === "En revisión" ? "primary" : "soft"} onClick={() => advanceBrief(brief)}>{({ "Borrador": "Enviar a revisión", "En revisión": "Aprobar brief", "Aprobado": "Iniciar producción", "En producción": "Marcar completado" })[brief.status]}</BtnAsync>
                </div>}
              </div>)}
            </div>
          </>}

          {(db.agencyDecisions || []).some((decision) => decision.status === "Propuesta") && <div id="agency-approval-center" className="scroll-mt-24">
            <SectionTitle>Decisiones por aprobar</SectionTitle>
            <div className="space-y-2">{(db.agencyDecisions || []).filter((decision) => decision.status === "Propuesta").slice(0, 5).map((decision) => <div key={decision.id} className="rounded-2xl border p-3 flex flex-col sm:flex-row sm:items-center gap-3" style={{ borderColor: T.border }}>
              <div className="flex-1"><div className="text-[10px] font-extrabold uppercase" style={{ color: T.coral }}>{decision.type} · riesgo {decision.riskLevel}</div><div className="font-bold text-sm">{decision.title}</div><div className="text-xs" style={{ color: T.choco2 }}>{decision.rationale}</div></div>
              <BtnAsync small onClick={() => advanceDecision(decision)}>Aprobar decisión</BtnAsync>
            </div>)}</div>
          </div>}

          {(db.creatives || []).length > 0 && <>
            <SectionTitle action={<Btn small kind="soft" disabled={!serverReady} onClick={openCreativeVersion}>＋ Nueva versión</Btn>}>Estudio creativo versionado</SectionTitle>
            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: T.border }}>
              <div className="px-4 py-3 text-xs" style={{ background: T.vainilla, color: T.choco2 }}><b style={{ color: T.choco }}>Marca congelada por versión.</b> Cada pieza conserva prompt, palabras prohibidas, archivo, costo y aprobación. El generador externo podrá conectarse después sin perder control.</div>
              {(db.agencyCreativeVersions || []).length === 0 ? <div className="p-4 text-sm" style={{ color: T.choco2 }}>Todavía no hay versiones. Creá la primera sobre uno de los creativos existentes.</div> :
                (db.agencyCreativeVersions || []).slice(0, 5).map((version) => {
                  const creative = (db.creatives || []).find((item) => item.id === version.creativeId);
                  return <div key={version.id} className="p-4 border-t flex flex-col sm:flex-row sm:items-center gap-3" style={{ borderColor: T.border }}>
                    {version.thumbnailUrl ? <img src={version.thumbnailUrl} alt="" className="w-14 h-14 rounded-xl object-cover border" style={{ borderColor: T.border }} /> : <div className="w-14 h-14 rounded-xl flex items-center justify-center text-xl" style={{ background: T.rosa }}>✦</div>}
                    <div className="flex-1 min-w-0"><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{creative?.titulo || version.creativeId} · V{version.version}</div><div className="text-sm font-bold truncate">{version.prompt || "Versión sin prompt"}</div><div className="text-xs" style={{ color: T.choco2 }}>{version.provider} · {version.status}</div></div>
                    {version.status === "Borrador" && <BtnAsync small kind="soft" onClick={() => reviewCreativeVersion(version, "En revisión")}>Enviar a revisión</BtnAsync>}
                    {version.status === "En revisión" && <BtnAsync small disabled={!version.assetUrl} onClick={() => reviewCreativeVersion(version, "Aprobada")}>Aprobar archivo</BtnAsync>}
                  </div>;
                })}
            </div>
          </>}
          </Modal>}
          </>}
        </div>
      </div>

      {briefSource && <Modal title="Nuevo brief comercial" onClose={() => setBriefSource(null)}>
        <div className="rounded-2xl p-3 mb-4 text-xs" style={{ background: T.vainilla }}><b>Por qué ahora:</b> {briefSource.rationale}</div>
        <Field label="Nombre del brief"><Input value={briefForm.title} onChange={(e) => setBriefForm({ ...briefForm, title: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Objetivo"><Select value={briefForm.objective} onChange={(e) => setBriefForm({ ...briefForm, objective: e.target.value })} options={["Ventas","Recompra","Lanzamiento","Cumpleaños","Tráfico WhatsApp","Branding","Contenido","Otro"]} /></Field><Field label="Canal"><Select value={briefForm.channel} onChange={(e) => setBriefForm({ ...briefForm, channel: e.target.value })} options={["Instagram","Facebook","TikTok","WhatsApp","Rappi","Referidos","Influencer","Orgánico","Multicanal"]} /></Field></div>
        <Field label="Segmento CRM"><Input value={briefForm.crmSegment} placeholder="Ej. clientes inactivos con permiso" onChange={(e) => setBriefForm({ ...briefForm, crmSegment: e.target.value })} /></Field>
        <Field label="Oferta o mensaje central"><Input value={briefForm.offer} placeholder="Qué queremos que entienda o haga la persona" onChange={(e) => setBriefForm({ ...briefForm, offer: e.target.value })} /></Field>
        <Field label="Presupuesto propuesto"><Input type="number" min="0" value={briefForm.proposedBudget} onChange={(e) => setBriefForm({ ...briefForm, proposedBudget: e.target.value })} /></Field>
        <Field label="Notas"><textarea className={inputCls} style={inputStyle} rows="3" value={briefForm.notes} onChange={(e) => setBriefForm({ ...briefForm, notes: e.target.value })} /></Field>
        <div className="flex gap-2"><BtnAsync onClick={saveBrief}>Guardar brief trazable</BtnAsync><Btn kind="ghost" onClick={() => setBriefSource(null)}>Cancelar</Btn></div>
      </Modal>}

      {creativePackageBrief && creativePackageDraft && <Modal title="Paquete creativo MOMOS" onClose={() => setCreativePackageBrief(null)} wide>
        <div className="rounded-3xl p-4 mb-4" style={{ background: "linear-gradient(135deg,#4A3028,#8C4E3B)", color: "#fff" }}>
          <div className="text-[9px] uppercase tracking-[.18em] font-extrabold opacity-70">Brief #{creativePackageBrief.id} · {creativePackageBrief.status}</div>
          <div className="display text-xl font-semibold mt-1">{creativePackageDraft.title}</div>
          <div className="text-xs opacity-80 mt-1">{creativePackageDraft.channel} · {creativePackageDraft.format} · {creativePackageDraft.objective}</div>
        </div>

        {!creativePackageDraft.audit.passed && <div className="rounded-2xl px-4 py-3 mb-3 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }} role="alert">⛔ {creativePackageDraft.audit.errors.join(" · ")}</div>}
        {creativePackageDraft.audit.warnings.length > 0 && <div className="rounded-2xl px-4 py-3 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>⚠ {creativePackageDraft.audit.warnings.join(" · ")}</div>}
        {!["Aprobado","En producción"].includes(creativePackageBrief.status) && <div className="rounded-2xl px-4 py-3 mb-4 text-xs font-bold" style={{ background: "#EAF0F7", color: "#3E5C7E" }}>Podés revisar y copiar este borrador. Para guardarlo en Creativos, primero el brief debe quedar Aprobado.</div>}

        <div className="grid md:grid-cols-3 gap-2 mb-4">
          {[["Postre protagonista",creativePackageDraft.exactSubjectReady ? creativePackageDraft.subjectName : "Elegí figura y sabor"],["Presentación comercial",commercialFamilyLabel(creativePackageDraft.productName)],["KPI principal",creativePackageDraft.measurement.primaryKpi]].map(([label,value]) => <div key={label} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: T.soft }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="text-sm font-bold">{value}</div></div>)}
        </div>

        {isCommercialFamilyProduct(creativeFocusProduct) && <div className="grid sm:grid-cols-2 gap-3 mb-4 rounded-2xl border p-3" style={{ borderColor: T.border, background: T.vainilla }}>
          <Field label="Postre / figura protagonista"><Select placeholder="Elegir figura exacta…" options={creativeCompatibleFigures.map((figure) => figure.nombre)} value={creativePackageSubject.figure} onChange={(event) => setCreativePackageSubject((current) => ({ ...current, figure: event.target.value }))} /></Field>
          <Field label="Sabor protagonista"><Select placeholder="Elegir sabor exacto…" options={SABORES || db.settings?.sabores || []} value={creativePackageSubject.flavor} onChange={(event) => setCreativePackageSubject((current) => ({ ...current, flavor: event.target.value }))} /></Field>
          <div className="sm:col-span-2 text-[10px] font-bold" style={{ color: T.choco2 }}>La presentación define la venta; la figura y el sabor definen lo que realmente aparecerá en el creativo.</div>
        </div>}

        <Field label="Elegí el hook que detiene el scroll">
          <div className="grid gap-2">{creativePackageDraft.hooks.map((hook, index) => <button key={hook} type="button" onClick={() => setCreativePackageVariant(index)} className="text-left rounded-2xl border px-3 py-3 text-sm font-bold" style={{ borderColor: creativePackageDraft.hookIndex === index ? T.coral : T.border, background: creativePackageDraft.hookIndex === index ? T.coralSoft : "#fff", color: T.choco }}><span className="text-[9px] uppercase tracking-wider mr-2" style={{ color: T.coral }}>Opción {String.fromCharCode(65 + index)}</span>{hook}</button>)}</div>
        </Field>

        <div className="grid lg:grid-cols-2 gap-3 mt-4">
          <div className="rounded-2xl border p-4" style={{ borderColor: T.border }}>
            <div className="flex items-center justify-between gap-2 mb-2"><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Copy listo para revisar</div><CopyBtn texto={creativePackageDraft.copy} label="Copiar copy" /></div>
            <div className="text-sm whitespace-pre-line leading-relaxed">{creativePackageDraft.copy}</div>
          </div>
          <div className="rounded-2xl border p-4" style={{ borderColor: T.border }}>
            <div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.coral }}>Guion de producción</div>
            <ol className="m-0 pl-5 text-sm space-y-2">{creativePackageDraft.script.map((line) => <li key={line}>{line}</li>)}</ol>
          </div>
        </div>

        <div className="rounded-2xl p-4 mt-3" style={{ background: T.vainilla }}>
          <div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.coral }}>Dirección visual para generar o producir</div>
          <div className="text-xs leading-relaxed mb-2">{creativePackageDraft.prompt}</div>
          <div className="text-[11px]" style={{ color: T.choco2 }}><b>Evitar:</b> {creativePackageDraft.negativePrompt}</div>
        </div>

        <div className="rounded-2xl border p-4 mt-3 mb-4" style={{ borderColor: T.border }}>
          <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Cómo sabremos si funcionó</div>
          <div className="text-sm font-bold mt-1">{creativePackageDraft.measurement.primaryKpi}</div>
          <div className="text-xs mt-1" style={{ color: T.choco2 }}>{creativePackageDraft.measurement.secondaryKpi} · {creativePackageDraft.measurement.attribution}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <BtnAsync onClick={saveCreativePackage} disabled={creativePackageSaved || !creativePackageDraft.audit.passed || !["Aprobado","En producción"].includes(creativePackageBrief.status) || (isCommercialFamilyProduct(creativeFocusProduct) && (!creativePackageSubject.figure || !creativePackageSubject.flavor))} textoEnVuelo="Guardando paquete…">{creativePackageSaved ? "Paquete ya guardado ✓" : "Guardar como creativo en Idea"}</BtnAsync>
          <CopyBtn texto={[creativePackageDraft.selectedHook, creativePackageDraft.copy, ...creativePackageDraft.script, creativePackageDraft.prompt].join("\n\n")} label="Copiar paquete" />
          <Btn kind="ghost" onClick={() => setCreativePackageBrief(null)}>Cerrar</Btn>
        </div>
      </Modal>}

      {settingsOpen && <Modal title="Guardas de Agencia MOMOS" onClose={() => setSettingsOpen(false)}>
        <Field label="Modo de autonomía"><Select value={settingsForm.autonomyMode} onChange={(e) => setSettingsForm({ ...settingsForm, autonomyMode: e.target.value })} options={["Asesor","Copiloto","Autopiloto protegido"]} /></Field>
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Límite diario"><Input type="number" min="0" value={settingsForm.dailyBudgetLimit} onChange={(e) => setSettingsForm({ ...settingsForm, dailyBudgetLimit: e.target.value })} /></Field><Field label="Límite por campaña"><Input type="number" min="0" value={settingsForm.campaignBudgetLimit} onChange={(e) => setSettingsForm({ ...settingsForm, campaignBudgetLimit: e.target.value })} /></Field></div>
        <Field label="Escalamiento máximo por paso (%)"><Input type="number" min="0" max="30" value={settingsForm.scaleStepPct} onChange={(e) => setSettingsForm({ ...settingsForm, scaleStepPct: e.target.value })} /></Field>
        {[["requireCreativeApproval","Exigir aprobación humana del creativo"],["blockOutOfStock","Bloquear pauta sin stock"],["contactOnlyAuthorized","Contactar solo clientes autorizados"],["paused","Parada de emergencia comercial"]].map(([key,label]) => <label key={key} className="flex items-center gap-2 py-2 text-sm font-bold"><input type="checkbox" checked={Boolean(settingsForm[key])} onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.checked })} />{label}</label>)}
        <div className="flex gap-2 mt-4"><BtnAsync onClick={saveSettings}>Guardar guardas</BtnAsync><Btn kind="ghost" onClick={() => setSettingsOpen(false)}>Cancelar</Btn></div>
      </Modal>}

      {creativeOpen && <Modal title="Nueva versión creativa" onClose={() => setCreativeOpen(false)} wide>
        <div className="rounded-2xl px-4 py-3 mb-4 text-xs" style={{ background: T.vainilla }}><b>Control de marca:</b> esta versión guardará una fotografía del tono y vocabulario vigente. Crear la versión no la aprueba ni la publica.</div>
        <Field label="Creativo base"><select className={inputCls} style={inputStyle} value={creativeForm.creativeId} onChange={(e) => setCreativeForm({ ...creativeForm, creativeId: e.target.value })}><option value="">Elegir creativo…</option>{(db.creatives || []).map((creative) => <option key={creative.id} value={creative.id}>{creative.titulo} · {creative.formato}</option>)}</select></Field>
        <Field label="Brief relacionado (opcional)"><select className={inputCls} style={inputStyle} value={creativeForm.briefId} onChange={(e) => setCreativeForm({ ...creativeForm, briefId: e.target.value })}><option value="">Sin brief</option>{(db.agencyBriefs || []).filter((brief) => !["Descartado","Completado"].includes(brief.status)).map((brief) => <option key={brief.id} value={brief.id}>#{brief.id} · {brief.title}</option>)}</select></Field>
        <Field label="Prompt maestro"><textarea className={inputCls} style={inputStyle} rows="4" value={creativeForm.prompt} onChange={(e) => setCreativeForm({ ...creativeForm, prompt: e.target.value })} /></Field>
        <Field label="Evitar"><Input value={creativeForm.negativePrompt} onChange={(e) => setCreativeForm({ ...creativeForm, negativePrompt: e.target.value })} /></Field>
        <Field label="URL del archivo o borrador (opcional)"><Input value={creativeForm.assetUrl} placeholder="Se puede agregar cuando el archivo esté listo" onChange={(e) => setCreativeForm({ ...creativeForm, assetUrl: e.target.value })} /></Field>
        <div className="flex gap-2"><BtnAsync onClick={saveCreativeVersion}>Guardar versión</BtnAsync><Btn kind="ghost" onClick={() => setCreativeOpen(false)}>Cancelar</Btn></div>
      </Modal>}
    </section>
  );
}

  function AgencyPanel({ db, user, go, refrescar }) {
    return <AgenciaControl db={db} user={user} go={go} refrescar={refrescar} />;
  }

  return AgencyPanel;
}
