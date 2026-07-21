import { useMemo, useState } from "react";
import { buildAgencyMetaCenter } from "../../lib/agency-meta-observatory";
import { buildMetaIncrementalityCenter, liftStudyPayload } from "../../lib/agency-meta-incrementality";
import { buildMetaInvestmentCenter, investmentScenarioPayload } from "../../lib/agency-meta-investment";
import { buildMetaAuthorizationCenter, metaAuthorizationPayload } from "../../lib/agency-meta-authorization";
import { buildMetaConnectorCenter } from "../../lib/agency-meta-connector";
import {
  prepararDiagnosticoMeta, resolverDiagnosticoMeta, crearEstudioIncrementalMeta,
  resolverEstudioIncrementalMeta, resolverMedicionIncrementalMeta, crearEscenariosInversionMeta,
  resolverEscenariosInversionMeta, solicitarAutorizacionInversionMeta, resolverAutorizacionInversionMeta,
  revocarAutorizacionInversionMeta, prepararDryRunMeta,
} from "../../lib/rpc";

export function createAgencyMetaSuite(shared) {
  const {
    T, hoyISO, dISO, fmt, copiarTexto, Badge, Card, SectionTitle, Btn, toast,
    BtnAsync, Modal, Field, inputCls, inputStyle, Input, Select, Empty,
  } = shared;

function AgencyMetaObservatory({ db, refrescar }) {
  const activePolicy = (db.agencyMetaPolicies || []).find((item) => item.status === "Activa");
  const center = useMemo(() => buildAgencyMetaCenter(db, activePolicy), [db, activePolicy]);
  const [expanded, setExpanded] = useState(null);
  const money = (value) => fmt(Math.round(Number(value || 0)));
  const percent = (value) => value == null ? "—" : `${Number(value).toFixed(2)}%`;

  async function prepare(snapshot) {
    await prepararDiagnosticoMeta(snapshot.id, "Diagnóstico determinístico preparado desde el Observatorio Meta para revisión humana.");
    toast("ok", "Diagnóstico 3Q preparado. No se publicó ni cambió presupuesto.");
    await refrescar();
  }

  async function resolve(diagnostic, decision) {
    const defaultNote = decision === "Aprobar"
      ? "Revisé hechos, atribución, píxel y acciones; no autorizo cambios de pauta."
      : "Devolver para corregir evidencia, denominadores o alcance del diagnóstico.";
    const note = window.prompt(decision === "Aprobar" ? "Nota de aprobación humana" : "¿Qué debe corregirse?", defaultNote) || "";
    if (note.trim().length < 8) return;
    await resolverDiagnosticoMeta(diagnostic.id, decision, note.trim());
    toast("ok", decision === "Aprobar" ? "Diagnóstico aprobado como lectura, sin ejecutar pauta." : "Diagnóstico devuelto con trazabilidad.");
    await refrescar();
  }

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: T.border, background: T.surface }} aria-label="Resultados de Meta">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface, color: T.choco }}>
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "#E8F1E4" }}>◎</div>
        <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: "#3F6B42" }}>Resultados de Meta</div><div className="display text-xl font-semibold">Qué funcionó y qué revisar</div><div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>Cruza campañas, pedidos pagados y margen para convertir datos en decisiones comprensibles.</div></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
        {[["Lecturas",center.summary.snapshots],["Por revisar",center.summary.reviewing],["Alertas",center.summary.alerts],["Ingreso ligado",money(center.summary.linkedRevenue)]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[82px] text-center" style={{ borderColor: T.border, background: T.vainilla }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}
      </div>
    </div>
    {!db.agencyMetaReady ? <div className="px-4 py-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>observatorio-meta-v1.sql</code> después del Hito 36. Hasta entonces Meta no aporta señales al cerebro de Agencia.</div> : <>
      <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: T.border, background: "#F4FAF1" }}>
        <div className="text-[11px]"><b>Política vigente:</b> {activePolicy ? `${activePolicy.sourceLabel} · V${activePolicy.version} · ${activePolicy.market} · ${activePolicy.currency}` : "sin política activa"}</div>
        <span className="rounded-full px-3 py-1 text-[9px] font-extrabold uppercase" style={{ background: "#DDEBD9", color: "#315B35" }}>Solo lectura · pauta protegida</span>
      </div>
      {center.snapshots.length === 0 ? <div className="px-4 py-5 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Todavía no hay ventanas Meta.</b> El conector privado registrará snapshots inmutables; ninguna clave ni secreto vive en el navegador.</div> : <div className="p-3 grid xl:grid-cols-2 gap-3">
        {center.snapshots.slice(0, 8).map((snapshot) => {
          const preview = snapshot.preview || {}; const derived = preview.derived || {}; const diagnostic = snapshot.diagnostics?.[0];
          const open = expanded === snapshot.id; const catalogAlerts = (preview.catalogHypotheses || []).filter((item) => !item.eligible).length;
          const pixelAlerts = (preview.pixelHealth || []).filter((item) => item.alert).length;
          const tone = diagnostic?.status === "Aprobado" ? { bg: "#DDEBD9", fg: "#315B35" } : diagnostic?.status === "Devuelto" ? { bg: "#F6D4CD", fg: "#A03B2A" } : { bg: "#FFF2D8", fg: "#7A5410" };
          return <article key={snapshot.id} className="rounded-2xl border overflow-hidden momo-card-action" style={{ borderColor: open ? "#A8C5AD" : T.border, background: "#fff" }}>
            <button type="button" className="w-full text-left p-4 bg-transparent border-0" onClick={() => setExpanded(open ? null : snapshot.id)} aria-expanded={open}>
              <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: "#3F6B42" }}>{snapshot.entityType} · {snapshot.objective}</div><div className="display text-lg font-semibold">{snapshot.accountLabel || snapshot.accountExternalId}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{snapshot.windowStart} → {snapshot.windowEnd} · {snapshot.currency}</div></div><div className="text-right"><div className="display text-xl font-semibold" style={{ color: T.coral }}>{derived.roas == null ? "—" : `${derived.roas}×`}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>ROAS atribuido</div></div></div>
              <div className="grid grid-cols-4 gap-2 mt-3">{[["Gasto",money(derived.spend)],["CTR",percent(derived.ctrPct)],["Pedidos MOMOS",snapshot.localTruth?.paidOrders || 0],["Alertas",pixelAlerts + catalogAlerts]].map(([label,value]) => <div key={label} className="rounded-xl px-2 py-2" style={{ background: "#FAF4EC" }}><div className="font-extrabold text-xs">{value}</div><div className="text-[8px] uppercase font-bold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
            </button>
            {open && <div className="px-4 pb-4 border-t" style={{ borderColor: T.border, background: "#FFFCF8" }}>
              <div className="grid sm:grid-cols-3 gap-2 my-3">{[["Meta atribuye",money(preview.whatHappened?.metaAttributedRevenue)],["MOMOS pagado",money(snapshot.localTruth?.paidRevenue)],["Brecha atribuida",money(preview.whatHappened?.attributionGap)]].map(([label,value]) => <div key={label} className="rounded-xl border p-2.5" style={{ borderColor: T.border }}><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="font-extrabold">{value}</div></div>)}</div>
              <div className="rounded-xl px-3 py-2 text-[10px] mb-3" style={{ background: "#E5EEF7", color: "#315A7D" }}><b>Atribución no es causalidad.</b> Meta aporta una lectura; pedidos pagados y margen vienen de MOMOS OPS.</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><div className="text-[9px] uppercase font-extrabold mb-1" style={{ color: T.coral }}>Por qué podría pasar</div>{(preview.whyHypotheses || []).length ? preview.whyHypotheses.slice(0, 3).map((item, index) => <div key={`${item.signal}-${index}`} className="text-[10px] mb-1">• <b>{item.signal}:</b> {item.interpretation}</div>) : <div className="text-[10px]" style={{ color: T.choco2 }}>Sin hipótesis concluyentes en esta ventana.</div>}</div>
                <div><div className="text-[9px] uppercase font-extrabold mb-1" style={{ color: T.coral }}>Qué revisaríamos</div>{(preview.recommendedActions || []).slice(0, 3).map((item, index) => <div key={`${item.action}-${index}`} className="text-[10px] mb-1">• {item.action}</div>)}</div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">{diagnostic ? <><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{diagnostic.status} · confianza {diagnostic.confidence}</span>{diagnostic.status === "En revisión" && <><BtnAsync small confirmar onClick={() => resolve(diagnostic, "Aprobar")}>Aprobar lectura</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolve(diagnostic, "Devolver")}>Devolver</BtnAsync></>}</> : <BtnAsync small onClick={() => prepare(snapshot)}>Preparar diagnóstico 3Q</BtnAsync>}</div>
            </div>}
          </article>;
        })}
      </div>}
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Este panel no crea campañas, no cambia presupuesto, no pausa, no escala y no publica. Cada acción externa conserva contrato y aprobación específicos.</div>
  </section>;
}

function AgencyMetaIncrementality({ db, refrescar }) {
  const center = useMemo(() => buildMetaIncrementalityCenter(db), [db]);
  const money = (value) => fmt(Math.round(Number(value || 0)));

  async function createStudy(diagnostic) {
    const snapshot = (db.agencyMetaSnapshots || []).find((item) => String(item.id) === String(diagnostic.snapshotId));
    if (!snapshot?.localCampaignId) throw new Error("El diagnóstico debe provenir de una campaña local exacta.");
    const externalStudyId = window.prompt("ID del estudio Meta Conversion Lift", `META-LIFT-${snapshot.localCampaignId}`) || "";
    if (externalStudyId.trim().length < 3) return;
    const payload = liftStudyPayload({ studyKey: `meta-lift-${diagnostic.id}-${Date.now()}`, diagnosticId: diagnostic.id,
      design: "Meta Conversion Lift", lifecycleScope: "Todos", windowStart: snapshot.windowStart, windowEnd: snapshot.windowEnd,
      minimumPerArm: 100, randomized: true, externalStudyId: externalStudyId.trim(), assignmentMethod: "Meta Conversion Lift",
      hypothesis: "La campaña aumenta compradores pagados y beneficio frente al control aleatorio." });
    await crearEstudioIncrementalMeta(payload);
    toast("ok", "Diseño incremental preparado para revisión; no se modificó la pauta.");
    await refrescar();
  }

  async function resolveStudy(study, decision) {
    const note = window.prompt(decision === "Aprobar" ? "Nota de revisión del diseño" : "¿Qué debe corregirse?",
      decision === "Aprobar" ? "Revisé aleatorización, ventana, muestra y alcance del estudio." : "Corregir diseño, asignación o ventana antes de medir.") || "";
    if (note.trim().length < 8) return;
    await resolverEstudioIncrementalMeta(study.id, decision, note.trim());
    toast("ok", decision === "Aprobar" ? "Estudio diseñado; espera medición privada del conector." : "Estudio devuelto con trazabilidad.");
    await refrescar();
  }

  async function resolveMeasurement(measurement, decision) {
    const note = window.prompt("Nota de revisión humana", decision === "Aprobar"
      ? "Revisé muestra, aleatorización, ciclo de vida, margen y alcance causal."
      : decision === "Inconclusa" ? "La evidencia no permite una decisión causal todavía." : "Corregir la medición o su evidencia externa.") || "";
    if (note.trim().length < 8) return;
    await resolverMedicionIncrementalMeta(measurement.id, decision, note.trim());
    toast("ok", "Resultado revisado sin cambiar presupuesto, publicación ni pauta.");
    await refrescar();
  }

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D7C5B2", background: "#FFFDFC" }} aria-label="Medición incremental Meta">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#3D315B,#5B4779 62%,#80679B)", color: "#fff" }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "rgba(255,255,255,.14)" }}>⇄</div>
        <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Control vs. expuesto · nuevos vs. recurrentes</div><div className="display text-xl font-semibold">Incrementalidad Meta</div>
          <div className="text-xs opacity-85 max-w-2xl">Mide compradores y beneficio que no habrían ocurrido sin la campaña. Exige aleatorización, muestra suficiente y revisión humana.</div></div></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">{[["Estudios",center.summary.studies],["En revisión",center.summary.reviewing],["Causales",center.summary.causal],["Beneficio",money(center.summary.profit)]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[82px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencyMetaIncrementalityReady ? <div className="px-4 py-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>incrementalidad-meta-v1.sql</code> después del Hito 37. El Observatorio seguirá funcionando mientras tanto.</div> : <>
      {center.candidates.length > 0 && <div className="p-3 border-b" style={{ borderColor: T.border, background: "#F7F2FB" }}><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: "#5B4779" }}>Lecturas aprobadas listas para diseñar prueba</div><div className="grid lg:grid-cols-2 gap-2">{center.candidates.slice(0, 4).map((diagnostic) => {
        const snapshot = (db.agencyMetaSnapshots || []).find((item) => String(item.id) === String(diagnostic.snapshotId));
        return <article key={diagnostic.id} className="rounded-2xl border bg-white p-3 flex items-center gap-3" style={{ borderColor: "#D9CBE5" }}><div className="flex-1"><div className="text-[9px] uppercase font-extrabold" style={{ color: "#5B4779" }}>Diagnóstico #{diagnostic.id} · confianza {diagnostic.confidence}</div><div className="font-extrabold text-sm">{snapshot?.accountLabel || snapshot?.accountExternalId || "Ventana Meta"}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Campaña {snapshot?.localCampaignId || "sin vínculo"} · atribución todavía no causal</div></div><BtnAsync small onClick={() => createStudy(diagnostic)} disabled={!snapshot?.localCampaignId}>Diseñar lift</BtnAsync></article>;
      })}</div></div>}
      {center.studies.length === 0 ? <div className="px-4 py-5 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Aún no hay estudios.</b> Primero aprobá una lectura del Observatorio ligada a una campaña exacta.</div> : <div className="p-3 grid xl:grid-cols-2 gap-3">{center.studies.slice(0, 8).map((study) => <article key={study.id} className="rounded-2xl border p-4" style={{ borderColor: "#D9CBE5", background: "#FFFCFF" }}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: "#5B4779" }}>{study.design} · {study.lifecycleScope}</div><div className="display text-lg font-semibold">Campaña {study.campaignId}</div><div className="text-[10px]" style={{ color: T.choco2 }}>{study.windowStart} → {study.windowEnd} · mínimo {study.minimumPerArm} por brazo</div></div><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: study.status === "Cerrado" ? "#DDEBD9" : study.status === "Devuelto" ? "#F6D4CD" : "#EEE5F4", color: study.status === "Devuelto" ? "#A03B2A" : "#5B4779" }}>{study.status}</span></div>
        <div className="rounded-xl px-3 py-2 text-[10px] my-3" style={{ background: "#F7F0E3" }}><b>Hipótesis:</b> {study.hypothesis}</div>
        {study.status === "En revisión" && <div className="flex gap-2 mb-3"><BtnAsync small confirmar onClick={() => resolveStudy(study, "Aprobar")}>Aprobar diseño</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveStudy(study, "Devolver")}>Devolver</BtnAsync></div>}
        {study.measurements.length === 0 ? <div className="text-[10px]" style={{ color: T.choco2 }}>{study.status === "Diseñado" ? "Esperando resultado agregado del conector privado de Meta." : "Todavía no existe una medición sellada."}</div> : study.measurements.slice(0, 2).map((measurement) => { const result = measurement.result || {}; return <div key={measurement.id} className="rounded-2xl border p-3 mt-2" style={{ borderColor: result.causalClaimAllowed ? "#A8C5AD" : "#E8C98B", background: result.causalClaimAllowed ? "#F4FAF1" : "#FFF8E9" }}>
          <div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold">Resultado · {result.classification || "En revisión"}</div><div className="font-extrabold text-sm">{result.controlRatePct}% control → {result.exposedRatePct}% expuesto</div></div><div className="text-right"><div className="display text-lg font-semibold" style={{ color: Number(result.incrementalProfit) >= 0 ? "#315B35" : "#A03B2A" }}>{money(result.incrementalProfit)}</div><div className="text-[8px] uppercase font-extrabold">beneficio incremental</div></div></div>
          <div className="grid grid-cols-3 gap-2 my-2">{[["Lift",result.liftPct == null ? "—" : `${result.liftPct}%`],["Muestra",result.sampleSufficient ? "Suficiente" : "Insuficiente"],["Causal",result.causalClaimAllowed ? "Sí" : "No"]].map(([label,value]) => <div key={label} className="rounded-xl bg-white px-2 py-1.5"><div className="text-[10px] font-extrabold">{value}</div><div className="text-[8px] uppercase">{label}</div></div>)}</div>
          {measurement.status === "En revisión" && <div className="flex flex-wrap gap-2"><BtnAsync small confirmar onClick={() => resolveMeasurement(measurement, "Aprobar")} disabled={!result.sampleSufficient}>Aprobar lectura</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveMeasurement(measurement, "Inconclusa")}>Marcar inconclusa</BtnAsync><BtnAsync small kind="ghost" onClick={() => resolveMeasurement(measurement, "Devolver")}>Devolver</BtnAsync></div>}
        </div>; })}
      </article>)}</div>}
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Una correlación o atribución nunca se presenta como causalidad. Este módulo no crea campañas, no cambia audiencias o presupuesto y no publica.</div>
  </section>;
}

function AgencyMetaInvestmentScenarios({ db, refrescar }) {
  const center = useMemo(() => buildMetaInvestmentCenter(db), [db]);
  const money = (value) => fmt(Math.round(Number(value || 0)));

  async function createScenario(measurement) {
    const payload = investmentScenarioPayload(measurement, 7);
    await crearEscenariosInversionMeta(payload);
    toast("ok", "Cuatro escenarios preparados con datos actuales; no se cambió la pauta.");
    await refrescar();
  }

  async function reviewScenario(scenario, decision) {
    const defaults = decision === "Aprobar"
      ? "Revisé beneficio incremental, inventario, capacidad, ciclo de vida y límites."
      : decision === "Devolver" ? "Actualizar evidencia operativa o supuestos antes de decidir."
        : "Descartado por decisión humana; no debe ejecutarse.";
    const note = window.prompt("Nota obligatoria de revisión humana", defaults) || "";
    if (note.trim().length < 8) return;
    await resolverEscenariosInversionMeta(scenario.id, decision, note.trim());
    toast("ok", `${decision}: la revisión quedó registrada sin ejecutar cambios.`);
    await refrescar();
  }

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: T.border, background: T.surface }} aria-label="Opciones de inversión Meta">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b" style={{ borderColor: T.border, background: T.surface, color: T.choco }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "#E5EEF7" }}>◫</div>
        <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em]" style={{ color: "#315A7D" }}>Opciones para crecer</div><div className="display text-xl font-semibold">Comparar antes de invertir</div>
          <div className="text-xs max-w-2xl" style={{ color: T.choco2 }}>MOMOS compara alternativas para que el equipo elija. Nunca cambia la pauta automáticamente.</div></div></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">{[["Opciones",center.summary.scenarios],["Por revisar",center.summary.reviewing],["Aprobadas",center.summary.approved],["Con alertas",center.summary.blocked]].map(([label,value]) => <div key={label} className="rounded-2xl border px-3 py-2 min-w-[82px] text-center" style={{ borderColor: T.border, background: T.vainilla }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
    </div>
    {!db.agencyMetaInvestmentReady ? <div className="px-4 py-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>escenarios-inversion-meta-v1.sql</code> después del Hito 38. La medición incremental seguirá disponible.</div> : <>
      {center.candidates.length > 0 && <div className="p-3 border-b" style={{ borderColor: T.border, background: "#EEF5F7" }}><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: "#245777" }}>Mediciones aprobadas listas para comparar</div><div className="grid lg:grid-cols-2 gap-2">{center.candidates.slice(0, 4).map((measurement) => <article key={measurement.id} className="rounded-2xl border bg-white p-3 flex items-center gap-3" style={{ borderColor: "#C9D9E2" }}><div className="flex-1"><div className="text-[9px] uppercase font-extrabold" style={{ color: "#245777" }}>Medición causal #{measurement.id}</div><div className="font-extrabold text-sm">Beneficio incremental {money(measurement.result?.incrementalProfit)}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Horizonte operativo sugerido: 7 días · revisión humana obligatoria</div></div><BtnAsync small onClick={() => createScenario(measurement)}>Comparar 4 opciones</BtnAsync></article>)}</div></div>}
      {center.scenarios.length === 0 ? <div className="px-4 py-5 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>Aún no hay escenarios.</b> Primero aprobá una medición incremental con muestra suficiente.</div> : <div className="p-3 grid xl:grid-cols-2 gap-3">{center.scenarios.slice(0, 10).map((scenario) => {
        const evidence = scenario.evidence || {}; const operations = evidence.operations || {}; const product = evidence.product || {}; const campaign = evidence.campaign || {};
        return <article key={scenario.id} className="rounded-2xl border overflow-hidden" style={{ borderColor: scenario.status === "En revisión" ? "#9FBAC8" : T.border, background: "#FFFEFC" }}>
          <div className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase font-extrabold tracking-wider" style={{ color: "#245777" }}>Campaña {campaign.name || scenario.campaignId} · {scenario.horizonDays} días</div><div className="display text-lg font-semibold">{product.name || "Producto o presentación foco sin identificar"}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Recomendación del modelo: <b>{scenario.recommendedOption}</b> · evidencia sellada</div></div><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={{ background: scenario.status === "Aprobado" ? "#DDEBD9" : scenario.status === "En revisión" ? "#DDEAF0" : "#F3E6DD", color: scenario.status === "Aprobado" ? "#315B35" : "#245777" }}>{scenario.status}</span></div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 my-3">{[["Exacto",operations.exactAvailable],["En proceso",operations.inProcess],["Reservado",operations.reservations],["Vence pronto",operations.expiringSoon],["Cola cocina",operations.kitchenQueue],["Pendiente",operations.pendingProduction]].map(([label,value]) => <div key={label} className="rounded-xl px-2 py-2" style={{ background: "#F4F7F8" }}><div className="text-xs font-extrabold">{Number(value || 0)}</div><div className="text-[7px] uppercase font-bold" style={{ color: T.choco2 }}>{label}</div></div>)}</div>
            {evidence.stockBlocked && <div className="rounded-xl px-3 py-2 mb-3 text-[10px] font-bold" style={{ background: "#F9D8D1", color: "#A03B2A" }}>Stock operativo bloqueado: no se recomienda ampliar exposición.</div>}
            <div className="grid sm:grid-cols-2 gap-2">{(scenario.options || []).map((option) => { const recommended = option.key === scenario.recommendedOption; const projection = option.projection || {}; return <div key={option.key} className="rounded-2xl border p-3" style={{ borderColor: recommended ? "#4B8798" : T.border, background: recommended ? "#EEF7F8" : "#fff" }}><div className="flex items-start justify-between gap-2"><div><div className="font-extrabold text-sm">{option.key}</div><div className="text-[9px]" style={{ color: T.choco2 }}>{option.purpose}</div></div>{recommended && <span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: "#245777", color: "#fff" }}>SUGERIDA</span>}</div><div className="grid grid-cols-2 gap-2 my-2"><div><div className="font-extrabold text-sm">{money(option.proposedBudget)}</div><div className="text-[8px] uppercase">presupuesto simulado</div></div><div><div className="font-extrabold text-sm">{Number(option.deltaPct || 0)}%</div><div className="text-[8px] uppercase">variación</div></div></div><div className="text-[9px] rounded-lg px-2 py-1.5" style={{ background: "#FAF4EC" }}>Beneficio proyectado: {money(projection.low)} — <b>{money(projection.base)}</b> — {money(projection.high)}</div>{(option.blockers || []).slice(0, 2).map((blocker) => <div key={blocker} className="text-[9px] mt-1" style={{ color: "#A03B2A" }}>• {blocker}</div>)}</div>; })}</div>
            {scenario.status === "En revisión" && <div className="flex flex-wrap gap-2 mt-3"><BtnAsync small confirmar onClick={() => reviewScenario(scenario, "Aprobar")}>Aprobar lectura</BtnAsync><BtnAsync small kind="ghost" onClick={() => reviewScenario(scenario, "Devolver")}>Devolver</BtnAsync><BtnAsync small kind="ghost" onClick={() => reviewScenario(scenario, "Descartar")}>Descartar</BtnAsync></div>}
          </div>
        </article>;
      })}</div>}
    </>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Aprobar una lectura no ejecuta nada: no cambia presupuesto, audiencia, campaña o publicación. La ejecución requiere otro contrato y otra aprobación.</div>
  </section>;
}

function AgencyMetaAuthorizationPanel({ db, refrescar }) {
  const center = useMemo(() => buildMetaAuthorizationCenter(db), [db]);
  const connector = useMemo(() => buildMetaConnectorCenter(db), [db]);
  const money = (value) => fmt(Math.round(Number(value || 0)));

  async function requestAuthorization(scenario, optionKey) {
    const audienceExternalId = window.prompt("ID exacto de la audiencia Meta", "aud_momos_principal") || "";
    if (!audienceExternalId.trim()) return;
    const validMinutes = Number(window.prompt("Vigencia de esta autorización (10 a 120 minutos)", "60") || 0);
    const justification = window.prompt("Justificación humana obligatoria", `Autorizar ${optionKey} para la campaña exacta, con presupuesto y audiencia sellados.`) || "";
    const payload = metaAuthorizationPayload({ scenario, optionKey, audienceExternalId, validMinutes, justification,
      settings: { campaignBudgetLimit: db.agencySettings?.campaignBudgetLimit, paused: db.agencySettings?.paused } });
    await solicitarAutorizacionInversionMeta(payload);
    toast("ok", "Solicitud sellada para revisión. Todavía no cambió ninguna campaña.");
    await refrescar();
  }

  async function reviewAuthorization(authorization, decision) {
    const suggested = decision === "Autorizar"
      ? "Verifiqué campaña, audiencia, presupuesto, vigencia y evidencia operativa."
      : decision === "Devolver" ? "Corregir el alcance o la evidencia antes de autorizar." : "No corresponde ejecutar esta alternativa.";
    const note = window.prompt("Nota de revisión humana", suggested) || "";
    if (note.trim().length < 16) return;
    await resolverAutorizacionInversionMeta(authorization.id, decision, note.trim());
    toast("ok", decision === "Autorizar" ? "Autorización vigente creada para simulación privada; no se tocó Meta." : `${decision} registrada con trazabilidad.`);
    await refrescar();
  }

  async function revokeAuthorization(authorization) {
    const reason = window.prompt("Motivo de revocación", "La autorización ya no corresponde al momento comercial actual.") || "";
    if (reason.trim().length < 16) return;
    await revocarAutorizacionInversionMeta(authorization.id, reason.trim());
    toast("ok", "Autorización revocada; cualquier simulación pendiente quedó cerrada.");
    await refrescar();
  }

  async function prepareMetaVerification(authorization) {
    if (!db.agencyMetaConnectorReady) throw new Error("Aplicá primero meta-conector-dry-run-v1.sql.");
    const storedAccount = (db.agencyIntegrations || []).find((item) => item.provider === "Meta")?.externalAccountId || "act_";
    const accountId = window.prompt("Cuenta publicitaria exacta de Meta (act_...)", storedAccount) || "";
    if (!accountId.trim()) return;
    const apiVersion = window.prompt("Versión Graph API sellada para esta verificación", "v25.0") || "";
    if (!apiVersion.trim()) return;
    await prepararDryRunMeta(authorization.id, accountId.trim(), apiVersion.trim());
    toast("ok", "Verificación oficial preparada: el worker solo hará tres lecturas GET y no cambiará la campaña.");
    await refrescar();
  }

  const statusStyle = (status) => status === "Autorizada" ? { background: "#DDEBD9", color: "#315B35" }
    : status === "En revisión" ? { background: "#FBE8C8", color: "#8B5A08" }
      : status === "Incierta" ? { background: "#F6D4CD", color: "#A03B2A" }
        : { background: "#F1E7E0", color: T.choco2 };

  return <section className="rounded-[26px] border overflow-hidden mb-6 shadow-sm" style={{ borderColor: "#D4B9C4", background: "#FFFDFC" }} aria-label="Autorización de inversión Meta">
    <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4" style={{ background: "linear-gradient(135deg,#4C2637,#74384D 58%,#A35569)", color: "#fff" }}>
      <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: "rgba(255,255,255,.14)" }}>✓</div>
        <div><div className="text-[9px] font-extrabold uppercase tracking-[.18em] opacity-75">Doble aprobación · alcance exacto · vigencia corta</div><div className="display text-xl font-semibold">Autorización de inversión Meta</div>
          <div className="text-xs opacity-85 max-w-2xl">H40 sella el permiso humano y H41 verifica cuenta, campaña y audiencia por Graph API. Es una comprobación oficial de solo lectura: nunca modifica pauta.</div></div></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">{[["Solicitudes",center.summary.requests],["En revisión",center.summary.reviewing],["Autorizadas",center.summary.authorized],["Inciertas",center.summary.uncertain]].map(([label,value]) => <div key={label} className="rounded-2xl px-3 py-2 min-w-[82px] text-center" style={{ background: "rgba(255,255,255,.12)" }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold opacity-70">{label}</div></div>)}</div>
    </div>
    {!db.agencyMetaAuthorizationReady ? <div className="px-4 py-4 text-sm font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>Aplicá <code>autorizacion-inversion-meta-v1.sql</code> después del Hito 39. Los escenarios seguirán disponibles sin permisos de ejecución.</div> : <>
      {center.candidates.length > 0 && <div className="p-3 border-b" style={{ borderColor: T.border, background: "#FBF1F4" }}><div className="text-[9px] uppercase font-extrabold mb-2" style={{ color: "#74384D" }}>Escenarios aprobados que todavía no tienen autorización</div><div className="grid xl:grid-cols-2 gap-3">{center.candidates.slice(0, 6).map((scenario) => <article key={scenario.id} className="rounded-2xl border bg-white p-3" style={{ borderColor: "#E0CAD2" }}>
        <div className="flex items-start justify-between gap-3 mb-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: "#74384D" }}>Escenario #{scenario.id} · campaña {scenario.campaignId}</div><div className="font-extrabold text-sm">Elegí exactamente qué alternativa solicitar</div></div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold" style={{ background: "#DDEBD9", color: "#315B35" }}>LECTURA APROBADA</span></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{(scenario.options || []).map((option) => { const blocked = (option.blockers || []).length > 0 || (scenario.evidence?.stockBlocked && option.key !== "Reducir"); return <button key={option.key} type="button" disabled={blocked} title={blocked ? (option.blockers || []).join(" ") || "Bloqueada por stock" : `Solicitar ${option.key}`} onClick={() => requestAuthorization(scenario, option.key)} className="rounded-xl border px-2 py-2 text-left disabled:opacity-40" style={{ borderColor: option.key === scenario.recommendedOption ? "#A35569" : T.border, background: option.key === scenario.recommendedOption ? "#FFF2F5" : "#fff" }}><div className="text-[10px] font-extrabold">{option.key}</div><div className="text-[9px]">{money(option.proposedBudget)}</div></button>; })}</div>
        {scenario.evidence?.stockBlocked && <div className="text-[9px] mt-2 font-bold" style={{ color: "#A03B2A" }}>Sin stock operativo, la guarda solo permite solicitar Reducir.</div>}
      </article>)}</div></div>}
      {center.authorizations.length === 0 ? <div className="px-4 py-5 text-sm" style={{ color: T.choco2 }}><b style={{ color: T.choco }}>No hay permisos solicitados.</b> La aprobación analítica del Hito 39 no autoriza inversión por sí sola.</div> : <div className="p-3 grid xl:grid-cols-2 gap-3">{center.authorizations.slice(0, 12).map((authorization) => { const dryRun = connector.dryRuns.find((item) => String(item.authorizationId) === String(authorization.id)); return <article key={authorization.id} className="rounded-2xl border p-4" style={{ borderColor: authorization.status === "Incierta" || dryRun?.status === "Incierto" ? "#D88A7C" : "#E0CAD2", background: "#FFFCFD" }}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: "#74384D" }}>Campaña {authorization.campaignId} · audiencia {authorization.audienceExternalId}</div><div className="display text-lg font-semibold">{authorization.selectedOption} · {money(authorization.targetBudget)}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Contrato #{authorization.id} · {authorization.executionMode} · vence {authorization.validUntil || "sin fecha"}</div></div><span className="rounded-full px-2.5 py-1 text-[9px] font-extrabold" style={statusStyle(authorization.status)}>{authorization.status}</span></div>
        <div className="rounded-xl px-3 py-2 text-[10px] my-3" style={{ background: "#F7F0E3" }}><b>Razón:</b> {authorization.justification}</div>
        {authorization.job && <div className="rounded-xl px-3 py-2 text-[10px] mb-3" style={{ background: authorization.job.status === "Incierto" ? "#F9D8D1" : "#EEF3F7" }}><b>Ensayo privado:</b> {authorization.job.status} · intento {authorization.job.attempt}{authorization.job.errorMessage ? ` · ${authorization.job.errorMessage}` : ""}</div>}
        {dryRun && <div className="rounded-xl px-3 py-2 text-[10px] mb-3" style={{ background: dryRun.status === "Conciliado" ? "#E5F1E1" : ["Divergente","Fallido","Incierto"].includes(dryRun.status) ? "#F9D8D1" : "#EEF3F7" }}><div className="font-extrabold">◎ Verificación oficial: {dryRun.status}</div><div>{dryRun.adAccountId} · {dryRun.apiVersion} · solo GET</div>{dryRun.status === "Conciliado" && <div>Cuenta, campaña y audiencia coinciden · cero mutaciones.</div>}{dryRun.errorMessage && <div>{dryRun.errorMessage}</div>}</div>}
        {authorization.status === "En revisión" && <div className="flex flex-wrap gap-2"><BtnAsync small confirmar onClick={() => reviewAuthorization(authorization, "Autorizar")}>Autorizar simulación</BtnAsync><BtnAsync small kind="ghost" onClick={() => reviewAuthorization(authorization, "Devolver")}>Devolver</BtnAsync><BtnAsync small kind="ghost" onClick={() => reviewAuthorization(authorization, "Rechazar")}>Rechazar</BtnAsync></div>}
        {authorization.status === "Autorizada" && <div className="flex flex-wrap gap-2">{!dryRun && db.agencyMetaConnectorReady && <BtnAsync small confirmar onClick={() => prepareMetaVerification(authorization)}>Verificar en Meta</BtnAsync>}<BtnAsync small kind="ghost" onClick={() => revokeAuthorization(authorization)}>Revocar permiso</BtnAsync></div>}
      </article>; })}</div>}
    </>}
    {db.agencyMetaAuthorizationReady && !db.agencyMetaConnectorReady && <div className="px-4 py-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#7A5410" }}>El permiso humano ya está protegido. Aplicá <code>meta-conector-dry-run-v1.sql</code> para comprobar las identidades en Meta sin tocar campañas.</div>}
    <div className="px-4 py-2.5 border-t text-[10px] font-semibold" style={{ borderColor: T.border, color: T.choco2 }}>Una autorización o lectura incierta no se reintenta. H41 solo usa ads_read + appsecret_proof; ads_management, publicaciones y cambios de presupuesto permanecen prohibidos.</div>
  </section>;
}

  function AgencyMetaSuite({ module, db, refrescar }) {
    if (module === "observatory") return <AgencyMetaObservatory db={db} refrescar={refrescar} />;
    if (module === "incrementality") return <AgencyMetaIncrementality db={db} refrescar={refrescar} />;
    if (module === "investment") return <AgencyMetaInvestmentScenarios db={db} refrescar={refrescar} />;
    if (module === "authorization") return <AgencyMetaAuthorizationPanel db={db} refrescar={refrescar} />;
    return null;
  }

  return AgencyMetaSuite;
}
