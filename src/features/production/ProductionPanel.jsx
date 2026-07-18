import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createCompactQueueOrderCard } from "../operations/CompactQueueOrderCard.jsx";
import {
  completarEtapaPedido, convertirImperfectas, crearCorrida, crearIncidentePedido, desmoldarLote,
  empezarCongelamiento, producirSubreceta, resolverIncidentePedido, setLoteEstado,
  setOrderStatusRemoto, setSugerenciaEstado,
} from "../../lib/rpc";
import {
  kitchenDelayedOrderReminders, kitchenOrderAlert, kitchenReadyOrderCommands, normalizeKitchenDelaySettings,
} from "../../lib/kitchen-voice";
import { orderTransitionPermission } from "../../lib/order-workflow";
import { calculateSubrecipeBatch } from "../../lib/subrecipe-scaling";
import { explainOperationalError } from "../../lib/operational-errors";
import { buildPackingChecklistLines } from "../../lib/packing-workflow";
import { KITCHEN_ISSUE_GUIDANCE, kitchenQuickCommandState } from "../../lib/kitchen-command";
import { buildKitchenProductionPlan, productionRunDraft } from "../../lib/production-planner";
import { activeStageAssignment, canOperateStage, openOrderIncidents } from "../../lib/operational-control";
import { isActiveProductionBatch, partitionByActivity } from "../../lib/operational-history";

const LazyVoiceKitchenPanel = lazy(() => import("./VoiceKitchenPanel.jsx"));

export function createProductionPanel(shared) {
  const {
    T, Badge, Btn, BtnAsync, Card, Empty, Field, Input, MiniSelect, Modal, SectionTitle, Select,
    WorkScopeTabs, customerOf, dISO, estadoCongelacion, fmt, fmtHoras, hoyISO, inputCls, inputStyle,
    pct, toast, vibrar,
  } = shared;
  const CompactQueueOrderCard = createCompactQueueOrderCard({ T, Badge, Card, customerOf });
  const VOICE_PANEL_UI = Object.freeze({ T, Card, Btn, BtnAsync, inputCls, inputStyle, toast, vibrar });

  function KitchenProductionQueue({ db, onOpenOrder, canStart, canReady }) {
    const [delayClock, setDelayClock] = useState(() => Date.now());
    const [scope, setScope] = useState("active");
    useEffect(() => {
      const timer = setInterval(() => setDelayClock(Date.now()), 60000);
      return () => clearInterval(timer);
    }, []);
    const catalogs = useMemo(() => ({
      customers: db?.customers || [],
      products: db?.products || [],
      orders: db?.orders || [],
      orderItems: db?.order_items || [],
      auditLogs: db?.audit_logs || [],
    }), [db?.customers, db?.products, db?.orders, db?.order_items, db?.audit_logs]);
    const commands = useMemo(() => kitchenReadyOrderCommands(catalogs), [catalogs]);
    const inProduction = useMemo(() => (db?.orders || [])
      .filter((order) => order?.id && order.estado === "En producción")
      .slice()
      .sort((left, right) => `${left.fecha || ""}T${left.hora || ""}`.localeCompare(`${right.fecha || ""}T${right.hora || ""}`))
      .map((order) => ({ ...kitchenOrderAlert(order, catalogs), date: order.fecha || "", time: order.hora || "" })), [db?.orders, catalogs]);
    const delayTiming = useMemo(() => normalizeKitchenDelaySettings(db?.settings), [db?.settings]);
    const delayReminders = useMemo(() => kitchenDelayedOrderReminders(catalogs, delayClock, delayTiming), [catalogs, delayClock, delayTiming]);
    const kitchenDelayReminders = delayReminders.filter((reminder) => reminder.area === "Cocina");
    const timingByOrderId = useMemo(() => new Map(kitchenDelayReminders.map((reminder) => [String(reminder.orderId), reminder])), [kitchenDelayReminders]);

    return (
      <section className="mb-5" aria-labelledby="kitchen-queue-title">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 id="kitchen-queue-title" className="display text-lg font-semibold m-0">Comandas de Cocina</h2>
            <div className="text-xs font-semibold mt-0.5" style={{ color: T.choco2 }}>Del pago confirmado al relevo con Empaque, sin duplicar pedidos en el panel.</div>
          </div>
          <WorkScopeTabs value={scope} onChange={setScope} activeCount={commands.length} historyCount={inProduction.length}
            activeLabel="Cola por iniciar" secondaryLabel="En preparación" activeIcon="●" secondaryIcon="◷" ariaLabel="Etapa de las comandas de Cocina" />
        </div>

        {scope === "active" ? (
          commands.length ? <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {commands.map((command, index) => (
              <CompactQueueOrderCard key={command.orderId} db={db} orderId={command.orderId}
                eyebrow={index === 0 ? "Siguiente · FIFO" : `En cola · #${index + 1}`}
                position={index + 1} tone={index === 0 ? T.coral : "#8E4B5A"} content={command.content}
                nextAction={canStart ? "Abrir, revisar e iniciar la preparación" : "Consultar la comanda; Cocina confirma el inicio"}
                footer={canStart ? "Dentro encontrás Momobot y la confirmación segura." : "Tu rol no altera el estado."}
                timing={timingByOrderId.get(String(command.orderId))}
                onOpen={() => onOpenOrder?.(command.orderId)} />
            ))}
          </div> : <Empty icon="✅" text="No hay pedidos esperando iniciar. Cuando un pedido quede Pagado aparecerá aquí con figura, sabor y contenido." />
        ) : (
          inProduction.length ? <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {inProduction.map((command) => (
              <CompactQueueOrderCard key={command.orderId} db={db} orderId={command.orderId}
                eyebrow="En preparación" tone="#3E5C7E" content={command.content}
                nextAction={canReady ? "Abrir, completar líneas y entregar a Empaque" : "Consultar el avance de Cocina"}
                footer="Empaque ya puede verlo como pedido en camino."
                timing={timingByOrderId.get(String(command.orderId))}
                onOpen={() => onOpenOrder?.(command.orderId)} />
            ))}
          </div> : <Empty icon="👩‍🍳" text="No hay comandas en preparación. Las órdenes iniciadas por Cocina aparecerán aquí hasta su relevo con Empaque." />
        )}
      </section>
    );
  }

  function KitchenProductionAssistantFab({ plan, unplannedSuggestions = [], formatAmount, onPlanRun, onPrepare }) {
    const [open, setOpen] = useState(false);
    const actionCount = (plan?.plans?.length || 0) + (plan?.preparationNeeds?.length || 0);
    const preparationNeeds = plan?.preparationNeeds || [];
    const productionPlans = plan?.plans || [];

    useEffect(() => {
      if (!open) return undefined;
      const closeOnEscape = (event) => { if (event.key === "Escape") setOpen(false); };
      window.addEventListener("keydown", closeOnEscape);
      return () => window.removeEventListener("keydown", closeOnEscape);
    }, [open]);

    function choosePlan(selectedPlan) {
      setOpen(false);
      onPlanRun?.(selectedPlan);
    }

    function choosePreparation(need) {
      setOpen(false);
      onPrepare?.(need.subrecipeId, need.recommendedGrams);
    }

    return (
      <div className="momo-kitchen-plan-fab" data-open={open ? "true" : "false"}>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} aria-expanded="false" aria-controls="asistente-cocina-panel"
            data-testid="kitchen-assistant-fab" title={`Asistente de Cocina · ${actionCount} acciones`}
            className="momo-kitchen-plan-orb w-16 h-16 rounded-full flex items-center justify-center text-2xl text-white"
            style={{ background: "#3F6B42" }} aria-label={`Abrir Asistente de Cocina. ${actionCount} recomendaciones`}>
            <span aria-hidden="true">🧠</span>
            <span className="absolute -right-1 -top-1 min-w-6 h-6 px-1 rounded-full flex items-center justify-center text-[10px] font-black border-2"
              style={{ background: T.surface, color: "#3F6B42", borderColor: "#DDEBD9" }}>{actionCount || "✓"}</span>
          </button>
        ) : (
          <>
            <button type="button" className="fixed inset-0 momo-modal-backdrop cursor-default" onClick={() => setOpen(false)}
              style={{ background: "rgba(47,33,27,.22)" }} aria-label="Cerrar panel del Asistente de Cocina" />
            <Card id="asistente-cocina-panel" role="dialog" aria-modal="true" aria-labelledby="asistente-cocina-title"
              data-testid="kitchen-assistant-panel" className="momo-modal-sheet momo-kitchen-plan-panel relative p-0 overflow-hidden w-[min(94vw,920px)] max-h-[calc(100vh-2rem)] shadow-2xl"
              style={{ background: T.bg }}>
              <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b" style={{ borderColor: T.border, background: T.surface }}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-2xl flex items-center justify-center text-lg shrink-0" style={{ background: "#DDEBD9" }} aria-hidden="true">🧠</span>
                  <div className="min-w-0"><div className="text-[9px] uppercase tracking-[.18em] font-extrabold" style={{ color: "#3F6B42" }}>MOMO OPS Intelligence</div><div id="asistente-cocina-title" className="font-extrabold truncate">Asistente de Cocina · plan inteligente</div></div>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Minimizar Asistente de Cocina" title="Minimizar"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border shrink-0" style={{ background: T.surface, borderColor: T.border, color: T.choco2 }}>✕</button>
              </div>

              <div className="overflow-y-auto max-h-[calc(100vh-5.75rem)]">
                <div className="px-4 sm:px-5 py-4 border-b" style={{ background: T.surface, borderColor: T.border }}>
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0"><span className="w-10 h-10 rounded-2xl grid place-items-center text-lg shrink-0" style={{ background: "#DDEBD9" }}>🧠</span><div><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] uppercase tracking-[.16em] font-extrabold" style={{ color: "#3F6B42" }}>Asistente de Cocina MOMOS</span><span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold" style={{ background: "#DDEBD9", color: "#315B35" }}>Revisión humana</span></div><div className="display text-xl font-semibold mt-0.5">Qué preparar ahora</div><div className="text-xs mt-1 max-w-2xl leading-relaxed" style={{ color: T.choco2 }}>MOMO OPS ordenó los pedidos y te muestra únicamente lo que conviene preparar primero.</div></div></div>
                    <div className="grid grid-cols-3 gap-2 shrink-0">
                      {[["Corridas", plan?.summary?.runs || 0], ["Unidades", plan?.summary?.units || 0], ["Preparaciones", plan?.summary?.preparations || 0]].map(([label, value]) => (
                        <div key={label} className="rounded-xl px-3 py-2 text-center min-w-[72px]" style={{ background: "#FFFDFC", border: `1px solid ${T.border}` }}><div className="display text-lg font-semibold">{value}</div><div className="text-[8px] uppercase font-extrabold tracking-wider" style={{ color: T.choco2 }}>{label}</div></div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid lg:grid-cols-[1.25fr_.75fr] gap-5 p-4 sm:p-5">
                  <div>
                    <div className="flex items-end justify-between gap-3 mb-3"><div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>Primero</div><div className="display text-lg font-semibold mt-0.5">Lotes recomendados</div></div><div className="text-[10px] font-semibold text-right hidden sm:block" style={{ color: T.choco2 }}>Pedidos pagados<br />en orden</div></div>
                    <div className="space-y-3">
                      {productionPlans.map((productionPlan) => (
                        <div key={productionPlan.id} className="rounded-2xl border p-4" style={{ borderColor: productionPlan.queueUnits > 0 ? "#E9A18F" : T.border, background: T.surface, boxShadow: "0 2px 5px rgba(84,56,43,.07)" }}>
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="display text-xl font-semibold">{productionPlan.flavor}</span><Badge label={productionPlan.source} map={{ "Cola + demanda": { bg: "#FBE8C8", fg: "#96690F" }, "Cola pagada": { bg: "#F3D7DC", fg: "#8E4B5A" }, "Demanda proyectada": { bg: "#DDEBD9", fg: "#3F6B42" } }} /><span className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: T.vainilla, color: T.choco2 }}>Confianza {productionPlan.confidence}</span></div><div className="text-sm font-extrabold mt-2">Producir {productionPlan.totalUnits}: {productionPlan.variants.map((variant) => `${variant.recommended}× ${variant.figure}`).join(" · ")}</div><div className="text-[11px] font-semibold mt-1" style={{ color: T.choco2 }}>{productionPlan.filling || "Sin relleno"} · {productionPlan.queueUnits} en cola · {productionPlan.availableUnits} disponibles · {productionPlan.inProcessUnits} en proceso</div>{productionPlan.suggestionIds.length > 1 && <div className="rounded-xl px-3 py-2 mt-2 text-[11px] font-bold" style={{ background: "#FFF1D6", color: "#7B5410" }}>🔗 MOMOS agrupó {productionPlan.suggestionIds.length} necesidades compatibles en esta corrida.</div>}{productionPlan.attributedUnits > 0 && <div className="text-[11px] font-bold mt-2" style={{ color: "#3E5C7E" }}>📣 {productionPlan.attributedUnits} venta{productionPlan.attributedUnits === 1 ? "" : "s"} atribuida{productionPlan.attributedUnits === 1 ? "" : "s"} a pauta{productionPlan.adSignals.length ? ` · ${productionPlan.adSignals.join(" · ")}` : ""}</div>}</div><Btn small disabled={!productionPlan.canCreate} onClick={() => choosePlan(productionPlan)}>{productionPlan.suggestionIds.length > 1 ? "Crear corrida agrupada" : "Planear lote"}</Btn></div>
                        </div>
                      ))}
                      {productionPlans.length === 0 && <Empty icon="🧠" text="La cocina está cubierta: todavía no hay demanda exacta para recomendar otra corrida." />}
                      {unplannedSuggestions.length > 0 && <div className="rounded-2xl px-4 py-3 text-xs font-bold" style={{ background: "#FFF0DD", color: "#7B5410" }}>⚠ {unplannedSuggestions.length} recomendación{unplannedSuggestions.length === 1 ? "" : "es"} no {unplannedSuggestions.length === 1 ? "tiene" : "tienen"} sabor o figura exacta. MOMOS OPS no las mezclará hasta completar el pedido.</div>}
                    </div>
                  </div>

                  <div className="lg:border-l lg:pl-5" style={{ borderColor: T.border }}>
                    <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>Después</div><div className="display text-lg font-semibold mt-0.5 mb-3">Bases que hacen falta</div>
                    <div className="space-y-2">
                      {preparationNeeds.map((need) => (
                        <div key={need.subrecipeId} className="rounded-2xl border p-3" style={{ borderColor: need.severity === "Crítica" ? "#E9A18F" : T.border, background: T.surface, boxShadow: "0 2px 5px rgba(84,56,43,.07)" }}><div className="flex items-start justify-between gap-2"><div><div className="text-[9px] uppercase font-extrabold" style={{ color: need.severity === "Crítica" ? "#A03B2A" : "#96690F" }}>{need.severity === "Crítica" ? "Hace falta ahora" : "Preparar pronto"}</div><div className="font-extrabold mt-0.5">{need.subrecipeName}</div></div><span className="display text-xl" style={{ color: T.coral }}>{need.recommendedGrams} g</span></div><div className="text-[10px] mt-2" style={{ color: T.choco2 }}>Necesitás {formatAmount(need.unit, need.required)} y hay {formatAmount(need.unit, need.current)} disponibles.</div><div className="flex justify-end mt-3"><Btn small kind="soft" onClick={() => choosePreparation(need)}>Preparar {need.recommendedGrams} g</Btn></div></div>
                      ))}
                      {preparationNeeds.length === 0 && <div className="rounded-2xl px-4 py-4 text-xs font-bold" style={{ background: "#E8F1E5", color: "#315D36" }}>✓ Las elaboraciones vigentes cubren el plan y conservan su stock mínimo.</div>}
                    </div>
                    <div className="rounded-xl px-3 py-2.5 text-[10px] font-semibold mt-3 leading-relaxed" style={{ background: T.vainilla, color: T.choco2 }}>Nada se registra hasta que una persona lo confirme.</div>
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    );
  }

  function KitchenQuickCommand({ db, order, canStart, canReady, busyOrderId, onStart, onReady, onMomobot, onClose, refrescar, perfil }) {
    const customer = customerOf(db, order.customerId);
    const lines = buildPackingChecklistLines(order.id, db.order_items || []);
    const assignment = activeStageAssignment(order.id, "Cocina", db.order_stage_assignments);
    const incidents = openOrderIncidents(order.id, db.order_incidents);
    const [showIssue, setShowIssue] = useState(false);
    const [issue, setIssue] = useState({ type: "Faltante", orderItemId: "", description: "" });
    const [issueBusy, setIssueBusy] = useState("");
    const [feedback, setFeedback] = useState("");
    const canOperateKitchen = canOperateStage(perfil, "Cocina");
    const quickState = kitchenQuickCommandState({ orderStatus: order.estado, lineCount: lines.length, incidentCount: incidents.length });
    const isPaid = quickState.action === "start";
    const isCooking = quickState.action === "ready";

    async function registerIssue() {
      if (issueBusy || issue.description.trim().length < 3) return;
      setIssueBusy("create"); setFeedback("");
      try {
        await crearIncidentePedido({ order_id: order.id, order_item_id: issue.orderItemId || null, area: "Cocina", type: issue.type, description: issue.description.trim() });
        await refrescar();
        setIssue({ type: "Faltante", orderItemId: "", description: "" });
        setShowIssue(false);
        setFeedback("Novedad registrada. La comanda no podrá salir de Cocina hasta resolverla.");
      } catch (error) { setFeedback(error.message); }
      finally { setIssueBusy(""); }
    }

    async function resolveIssue(incidentId) {
      if (issueBusy) return;
      setIssueBusy(incidentId); setFeedback("");
      try {
        await resolverIncidentePedido(incidentId, "Resuelto y validado desde la comanda rápida de Cocina");
        await refrescar();
        setFeedback("Novedad resuelta. Ya podés terminar la comanda si todo está correcto.");
      } catch (error) { setFeedback(error.message); }
      finally { setIssueBusy(""); }
    }

    return (
      <Modal title={`Comanda ${order.id}`} onClose={onClose} wide>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
          <div><div className="flex flex-wrap items-center gap-2"><Badge label={order.estado} /><span className="text-xs font-semibold" style={{ color: T.choco2 }}>{order.fecha} · {order.hora}</span></div><div className="display text-2xl font-semibold mt-2">{customer.nombre || "Cliente"}</div><div className="text-xs font-semibold" style={{ color: T.choco2 }}>{customer.telefono || "Sin teléfono"}{order.obs ? ` · ${order.obs}` : ""}</div></div>
          <div className="rounded-2xl px-3 py-2 border shrink-0" style={{ background: assignment ? "#F2F8F0" : T.vainilla, borderColor: assignment ? "#A7C9A4" : T.border }}><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: assignment ? "#3F6B42" : "#96690F" }}>{assignment ? "Responsable de Cocina" : "Comanda disponible"}</div><div className="text-xs font-bold mt-0.5">{assignment?.user || (isPaid ? "Tomala para empezar" : "Sin responsable")}</div></div>
        </div>

        <div className="rounded-3xl border p-4 sm:p-5" style={{ background: "linear-gradient(135deg,#FFF9F1,#FFFFFF)", borderColor: T.border }}>
          <div className="flex items-start justify-between gap-3 mb-3"><div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Qué debe preparar Cocina</div><div className="display text-xl font-semibold">Revisá y ejecutá esta comanda</div></div><span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: T.rosa, color: "#7C3F4B" }}>{lines.length} control{lines.length === 1 ? "" : "es"}</span></div>
          <div className="space-y-2">
            {lines.map((line) => <div key={line.id} className="rounded-2xl border px-3 py-3 flex items-start gap-3" style={{ background: "#fff", borderColor: T.border }}><span className="w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0" style={{ background: line.parentItemId ? T.rosa : T.vainilla }} aria-hidden="true">{line.parentItemId ? "↳" : "✓"}</span><div className="min-w-0"><div className="text-sm font-extrabold">{line.label}</div>{line.detail && <div className="text-[11px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{line.detail}</div>}</div></div>)}
            {!lines.length && <div className="rounded-2xl p-5 text-center text-sm font-bold" style={{ background: T.vainilla }}>La orden no tiene líneas para preparar. Revisala con Coordinación.</div>}
          </div>
        </div>

        {incidents.length > 0 && <div className="mt-4 rounded-2xl border p-4" style={{ background: "#FFF3EF", borderColor: "#E8B7AD" }}><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: "#A03B2A" }}>Comanda pausada · {incidents.length} novedad{incidents.length === 1 ? "" : "es"}</div><div className="space-y-2 mt-2">{incidents.map((incident) => <div key={incident.id} className="rounded-xl bg-white px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2"><div className="flex-1 text-xs"><b>{incident.type}</b> · {incident.description}</div>{canOperateKitchen && <Btn small kind="ghost" disabled={!!issueBusy} onClick={() => resolveIssue(incident.id)}>{issueBusy === incident.id ? "Resolviendo…" : "Ya está resuelto"}</Btn>}</div>)}</div></div>}

        {showIssue && <div className="mt-4 rounded-2xl border p-4" style={{ background: T.coralSoft, borderColor: "#E8B5A5" }}><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: "#A54830" }}>Registrar problema</div><div className="text-sm font-extrabold mt-0.5">MOMO OPS recomienda cómo actuar sin improvisar</div></div><button type="button" onClick={() => setShowIssue(false)} className="text-sm font-black" aria-label="Cerrar problema">×</button></div><div className="grid sm:grid-cols-2 gap-2 mt-3"><select aria-label="Tipo de problema" value={issue.type} onChange={(event) => setIssue({ ...issue, type: event.target.value })} className="rounded-xl border px-3 py-2 text-xs font-bold" style={inputStyle}>{Object.keys(KITCHEN_ISSUE_GUIDANCE).map((type) => <option key={type}>{type}</option>)}</select><select aria-label="Línea afectada" value={issue.orderItemId} onChange={(event) => setIssue({ ...issue, orderItemId: event.target.value })} className="rounded-xl border px-3 py-2 text-xs" style={inputStyle}><option value="">Pedido completo</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.label}</option>)}</select></div><div className="rounded-xl px-3 py-2 mt-2 text-xs font-bold" style={{ background: "#FFF9F1", color: "#7B5410" }}>💡 {KITCHEN_ISSUE_GUIDANCE[issue.type]}</div><textarea value={issue.description} onChange={(event) => setIssue({ ...issue, description: event.target.value })} placeholder="Contá brevemente qué pasó…" rows="3" className="w-full rounded-xl border px-3 py-2 text-sm mt-2" style={inputStyle} /><div className="flex justify-end mt-2"><Btn disabled={issue.description.trim().length < 3 || !!issueBusy} onClick={registerIssue}>{issueBusy === "create" ? "Registrando…" : "Registrar y pausar comanda"}</Btn></div></div>}

        {feedback && <div className="mt-3 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: feedback.toLowerCase().includes("no ") || feedback.toLowerCase().includes("error") ? "#F6D4CD" : "#DDEBD9", color: feedback.toLowerCase().includes("no ") || feedback.toLowerCase().includes("error") ? "#A03B2A" : "#3F6B42" }}>{feedback}</div>}

        {!showIssue && <div className="mt-5 sticky bottom-0 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: T.bg }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" onClick={() => setShowIssue(true)} className="text-xs font-extrabold underline" style={{ color: "#A54830" }}>⚠ Reportar problema</button>
            <button type="button" onClick={onMomobot} className="text-xs font-extrabold underline" style={{ color: T.choco2 }}>🎙️ Pedir ayuda a Momobot</button>
          </div>
          {quickState.disabled && quickState.blockReason
            ? <div className="rounded-xl px-3 py-2 text-xs font-bold sm:max-w-xs" style={{ background: T.vainilla, color: "#7B5410" }}>{quickState.blockReason}</div>
            : <div className="sm:min-w-[250px] [&>button]:w-full">
              {isPaid && <BtnAsync textoEnVuelo="Tomando comanda…" disabled={!canStart || busyOrderId === order.id} onClick={() => onStart(order.id)}>{quickState.label}</BtnAsync>}
              {isCooking && <BtnAsync textoEnVuelo="Entregando a Empaque…" disabled={!canReady || busyOrderId === order.id} onClick={() => onReady(order.id)}>✓ {quickState.label}</BtnAsync>}
            </div>}
        </div>}
      </Modal>
    );
  }

  const LOTE_ESTADOS = ["En preparación","Congelando","Listo","Reservado","Vendido","Imperfecto","Descartado"];

  // Componentes + BOM: agrupación del select de bases por tipo de subreceta.
  const PREP_TIPOS = [
    ["mousse_frutal", "Mousses frutales"], ["mousse_cremosa", "Mousses cremosas"],
    ["cheesecake", "Cheesecake"], ["ganache", "Ganache"], ["salsa", "Salsas"], ["crocante", "Crocante"],
  ];


  function Produccion({ db, update, user, refrescar, perfil, serverDataReady, focus }) {
    const [, setTick] = useState(0);
    useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t); }, []);
    const [nuevo, setNuevo] = useState(false);
    const [pre, setPre] = useState(null); // sugerencia que origina la corrida
    const [queueRequest, setQueueRequest] = useState(null);
    const corridaIdemKeyRef = useRef(null); // 1 por apertura del form: tolera retries de red sin duplicar la corrida
    const s = db.settings;
    const sabores = useMemo(
      () => [...(s.saboresFrutales || []), ...(s.saboresCremosos || [])],
      [s.saboresFrutales, s.saboresCremosos],
    );
    // Producción v2: solo figuras activas CON product_id se pueden producir (contrato de RPC punto 4).
    const figurasProducibles = useMemo(() => (db.figuras || []).filter((f) => f.activo && f.productId), [db.figuras]);
    const productoDeFigura = useMemo(() => {
      const map = {};
      figurasProducibles.forEach((f) => { map[f.nombre] = db.products.find((p) => p.id === f.productId); });
      return map;
    }, [figurasProducibles, db.products]);
    const formInicial = () => ({
      sabor: sabores[0], relleno: s.rellenos[0], // salsa NO: se aplica al despacho, a gusto del cliente
      figuras: Object.fromEntries(figurasProducibles.map((f) => [f.nombre, 0])), // nombreFigura → cantidad
      resp: "", horasCongelacion: s.horasCongelacion || 10, obs: "",
    });
    const [form, setForm] = useState(formInicial);
    const [msg, setMsg] = useState("");
    const [registroError, setRegistroError] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [enviandoBatchId, setEnviandoBatchId] = useState(null); // deshabilita solo la card del lote en vuelo
    const [desmolde, setDesmolde] = useState(null); // {batchId, prod, perfectas, imperfectas, descartadas} — mini-modal de conteos
    const [enviandoDesmolde, setEnviandoDesmolde] = useState(false);
    const puedeIniciarPedidos = orderTransitionPermission(perfil, "Pagado", "En producción").allowed;
    const puedeEntregarEmpaque = orderTransitionPermission(perfil, "En producción", "Listo para empaque").allowed;
    const [queueBusyOrderId, setQueueBusyOrderId] = useState(null);
    const [detallePedidoCocinaId, setDetallePedidoCocinaId] = useState(null);
    const detallePedidoCocina = detallePedidoCocinaId ? db.orders.find((order) => order.id === detallePedidoCocinaId) : null;
    const batchBuckets = useMemo(() => partitionByActivity(db.production_batches, isActiveProductionBatch), [db.production_batches]);
    const [scope, setScope] = useState("active");
    const [detalleLoteId, setDetalleLoteId] = useState(null);
    const detalleLote = useMemo(() => (db.production_batches || []).find((lote) => lote.id === detalleLoteId) || null, [db.production_batches, detalleLoteId]);
    const detalleCongelacion = detalleLote ? estadoCongelacion(detalleLote) : null;
    const detalleMerma = detalleLote && detalleLote.prod > 0 ? (detalleLote.imperfectas + detalleLote.descartadas) / detalleLote.prod : 0;

    // ── Componentes + BOM (hito 2): preparar bases/subrecetas ──
    const [prepBase, setPrepBase] = useState(false);
    const prepIdemKeyRef = useRef(null); // 1 por apertura del form (mismo patrón que corridaIdemKeyRef)
    const [prepForm, setPrepForm] = useState({ subrecetaId: "", nominal: 1000, obtenidos: "", obtenidosTocado: false, resp: "", obs: "" });
    const [detallePreparacionId, setDetallePreparacionId] = useState(null);
    const [detalleCantidadFinal, setDetalleCantidadFinal] = useState(300);
    const [enviandoPrep, setEnviandoPrep] = useState(false);
    const subrecetasActivas = useMemo(() => (db.subrecetas || []).filter((sr) => sr.activo), [db.subrecetas]);
    useEffect(() => {
      const subrecipeId = focus?.subrecipeId;
      if (!subrecipeId || !subrecetasActivas.some((subrecipe) => subrecipe.id === subrecipeId)) return;
      abrirPrepararBase(subrecipeId);
    }, [focus?.subrecipeId]);
    const itemDe = useMemo(() => { const m = {}; db.inventory_items.forEach((i) => { m[i.id] = i; }); return m; }, [db.inventory_items]);
    const prepSel = subrecetasActivas.find((sr) => sr.id === prepForm.subrecetaId) || null;
    const detallePreparacion = subrecetasActivas.find((sr) => sr.id === detallePreparacionId) || null;
    const detalleFormula = useMemo(() => calculateSubrecipeBatch({
      subrecipe: detallePreparacion,
      ingredients: db.subreceta_ingredientes || [],
      inventory: db.inventory_items || [],
      desiredOutputGrams: detalleCantidadFinal,
    }), [detallePreparacion, detalleCantidadFinal, db.subreceta_ingredientes, db.inventory_items]);
    function cantidadPreparacionTexto(unidad, cantidad) {
      const value = +cantidad || 0;
      if (unidad === "kg" && value < 1) return `${Math.round(value * 10000) / 10} g`;
      if (unidad === "L" && value < 1) return `${Math.round(value * 10000) / 10} ml`;
      return `${Math.round(value * 10000) / 10000} ${unidad}`.trim();
    }
    // Derivado en vivo: consumo escalado (cantidad × nominal/1000) + costo estimado del batch.
    const prepIngredientes = useMemo(() => {
      if (!prepSel) return [];
      const factor = (+prepForm.nominal || 0) / 1000;
      return (db.subreceta_ingredientes || []).filter((r) => r.subrecetaId === prepSel.id).map((r) => {
        const it = itemDe[r.itemId];
        const req = Math.round(r.cantidad * factor * 10000) / 10000;
        // Texto para cocina: kg/L chicos se leen en g/ml (el descuento real sigue en la unidad del insumo)
        const unidad = it ? it.unidad : "";
        const reqTxt = cantidadPreparacionTexto(unidad, req);
        return { itemId: r.itemId, nombre: it ? it.nombre : r.itemId, unidad, req, reqTxt, alcanza: it ? it.stock >= req : false, costo: it ? req * it.costo : 0 };
      });
    }, [prepSel, prepForm.nominal, db.subreceta_ingredientes, itemDe]);
    const prepCosto = prepIngredientes.reduce((a, x) => a + x.costo, 0);
    const prepObtenidosDefault = prepSel ? Math.round((+prepForm.nominal || 0) * (1 - prepSel.mermaPct / 100) * 10) / 10 : 0;
    const prepObtenidos = prepForm.obtenidosTocado && prepForm.obtenidos !== "" ? prepForm.obtenidos : prepObtenidosDefault;
    const ultimaPrepDe = useMemo(() => {
      const m = {};
      (db.subreceta_producciones || []).forEach((sp) => { if (!m[sp.subrecetaId]) m[sp.subrecetaId] = sp; }); // vienen desc por created_at
      return m;
    }, [db.subreceta_producciones]);

    // Resuelve el nombre libre del form al id del staff activo (RPC exige FK real,
    // no nombre suelto). Sin match → null (resp_user_id es opcional server-side).
    function respUserId(nombre) {
      const n = String(nombre || "").trim().toLowerCase();
      if (!n) return null;
      const u = db.users.find((x) => x.activo && String(x.nombre || "").trim().toLowerCase() === n);
      return u ? u.id : null;
    }

    async function refrescarSilencioso(onFail) {
      try {
        await refrescar();
      } catch (e) {
        onFail();
      }
    }

    const kitchenProductionPlan = useMemo(() => buildKitchenProductionPlan({ ...db, figuras: figurasProducibles }, {
      today: hoyISO(), historyDays: 28, horizonDays: 3,
    }), [db, figurasProducibles]);
    const plannedSuggestionIds = new Set(kitchenProductionPlan.plans.flatMap((plan) => plan.suggestionIds));
    const unplannedSuggestions = (db.production_suggestions || []).filter((suggestion) => suggestion.estado === "Pendiente"
      && suggestion.area !== "Inventario" && !plannedSuggestionIds.has(suggestion.id));

    // Stock operativo: fuente oficial usada por ventas y reservas (products.stock de tipo momo)
    const stockOperativo = useMemo(() =>
      db.products.filter((p) => p.tipo === "momo").map((p) => [p.nombre, p.stock, p.id]),
    [db.products]);

    // v2: con desmolde diferido, "perfectas" vale 0 mientras el lote está en proceso —
    // acá lo que importa es lo PRODUCIDO pendiente/en curso (prod). Se agrupa por
    // producto·sabor·gramaje (sin figura en la key: una corrida puede mezclar figuras
    // que caen en el mismo producto); la figura mostrada se deriva de la composición
    // y si el grupo junta figuras distintas se muestra "varias".
    const enProceso = useMemo(() => {
      const map = {};
      db.production_batches.filter(isActiveProductionBatch).forEach((l) => {
        const k = `${l.producto} · ${l.sabor} · ${l.gramaje}`;
        const figuraLote = Array.isArray(l.figuras) && l.figuras.length ? l.figuras.map((f) => f.figura).join("+") : l.figura;
        if (!map[k]) map[k] = { label: k, producto: l.producto, sabor: l.sabor, gramaje: l.gramaje, figura: figuraLote, cant: 0 };
        else if (map[k].figura !== figuraLote) map[k].figura = "varias";
        map[k].cant += l.prod;
      });
      return Object.values(map).map((e) => ({ ...e, label: `${e.producto} · ${e.sabor} · ${e.figura || "—"} · ${e.gramaje}` }));
    }, [db.production_batches]);

    // Foco de las cards → filtra la lista "Lotes" de abajo (panel accionable, no solo informativo).
    const [foco, setFoco] = useState(null); // {producto} (stock) | {combo:true, producto,sabor,figura,gramaje} (en proceso)
    const lotesPorScope = scope === "active" ? batchBuckets.active : batchBuckets.history;
    const lotesFiltrados = useMemo(() => {
      if (!foco) return lotesPorScope;
      // foco.combo ya no incluye figura en la key (ver enProceso): agrupa por producto·sabor·gramaje.
      return lotesPorScope.filter((l) => foco.combo
        ? l.producto === foco.producto && l.sabor === foco.sabor && l.gramaje === foco.gramaje
        : l.producto === foco.producto);
    }, [lotesPorScope, foco]);
    const focoLabel = foco ? (foco.combo ? `${foco.producto} · ${foco.sabor} · ${foco.figura} · ${foco.gramaje}` : foco.producto) : "";
    function enfocarLotes(next) { setFoco(next); setTimeout(() => { const el = document.getElementById("lotes-produccion"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0); }

    function alistarPedidoDesdeCola(orderId) {
      if (!puedeIniciarPedidos) {
        setMsg("Solo Cocina o Administración pueden confirmar que un pedido pagado entra a producción.");
        return;
      }
      setQueueRequest({ orderId, token: `${orderId}-${Date.now()}` });
    }

    function enfocarMomobotListo() {
      const panel = document.getElementById("momobot-cocina");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function cambiarPedidoDesdeCocina(orderId, estado) {
      const order = db.orders.find((item) => item.id === orderId);
      const permiso = orderTransitionPermission(perfil, order?.estado, estado);
      if (!permiso.allowed) {
        setMsg(permiso.reason);
        return false;
      }
      setQueueBusyOrderId(orderId);
      // Escritura y refresco en try/catch SEPARADOS: si falla refrescar() no debe
      // reportarse como que falló la transición de estado (juice-v1 regla 4).
      let response;
      try {
        if (estado === "Listo para empaque" && db.operationalControlReady) {
          await completarEtapaPedido(orderId, "Cocina");
        }
        response = await setOrderStatusRemoto(orderId, estado);
      } catch (error) {
        setQueueBusyOrderId(null);
        toast("error", `No se pudo pasar ${orderId} a “${estado}”: ${error.message}`);
        return false;
      }
      const faltantes = Array.isArray(response?.faltantes) ? response.faltantes.length : 0;
      toast("ok", estado === "En producción"
        ? `${orderId} · Cocina inició la preparación${faltantes ? ` con ${faltantes} alerta${faltantes === 1 ? "" : "s"} de inventario` : ""}`
        : `${orderId} · listo para Empaque`);
      try { await refrescar(); } catch { toast("alert", `${orderId} avanzó, pero no se pudo actualizar la vista. Recargá la página.`); }
      setQueueBusyOrderId(null);
      if (estado === "Listo para empaque") setDetallePedidoCocinaId(null);
      return true;
    }

    // Genera una idempotency_key nueva cada vez que el form se abre; los reintentos
    // dentro de la misma apertura reusan la misma key (útil para timeouts de red).
    function abrirNuevaCorrida() {
      corridaIdemKeyRef.current = "corrida-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
      setForm(formInicial());
      setRegistroError("");
      setNuevo(true);
    }

    function abrirDesdePlanProduccion(plan) {
      if (!plan?.canCreate) {
        setMsg("Esta recomendación no tiene sabor o figura exacta. Revisa el pedido antes de crear la corrida.");
        return;
      }
      const base = formInicial();
      const draft = productionRunDraft(plan, figurasProducibles, s.rellenos[0]);
      corridaIdemKeyRef.current = "corrida-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
      setForm({ ...base, ...draft, figuras: { ...base.figuras, ...draft.figuras } });
      setRegistroError("");
      setPre({
        id: plan.id, grouped: true, flavor: plan.flavor, filling: plan.filling,
        cantidad: plan.totalUnits, suggestionIds: plan.suggestionIds,
        queueUnits: plan.queueUnits, source: plan.source,
        producto: plan.variants.map((variant) => `${variant.recommended}× ${variant.figure}`).join(" · "),
      });
      setNuevo(true);
    }

    async function registrarCorrida() {
      const figurasElegidas = Object.entries(form.figuras).filter(([, cant]) => +cant > 0).map(([figura, cant]) => ({ figura, cant: +cant }));
      if (!figurasElegidas.length) { setMsg("Elegí al menos una figura con cantidad mayor a 0."); return; }
      const suggestionIds = Array.isArray(pre?.suggestionIds) ? pre.suggestionIds.filter(Boolean) : [];
      const traceNote = suggestionIds.length > 1 ? `Sugerencias agrupadas: ${suggestionIds.join(", ")}` : "";
      const payload = {
        sabor: form.sabor, relleno: form.relleno, figuras: figurasElegidas,
        resp_user_id: respUserId(form.resp), horas_congelacion: +form.horasCongelacion || 10,
        obs: [form.obs, traceNote].filter(Boolean).join(" · "), sugerencia_id: suggestionIds[0] || undefined,
        idempotency_key: corridaIdemKeyRef.current,
      };
      setEnviando(true);
      let resultado;
      try {
        resultado = await crearCorrida(payload);
      } catch (e) {
        const friendlyError = explainOperationalError(e, {
          inventory: db.inventory_items || [],
          subrecipes: db.subrecetas || [],
        });
        setRegistroError(friendlyError);
        toast("error", friendlyError);
        setEnviando(false);
        return;
      }
      const suggestionUpdateFailures = [];
      for (const suggestionId of suggestionIds.slice(1)) {
        try { await setSugerenciaEstado(suggestionId, "Atendida"); }
        catch { suggestionUpdateFailures.push(suggestionId); }
      }
      setRegistroError("");
      setEnviando(false);
      setNuevo(false); setPre(null);
      corridaIdemKeyRef.current = null; // fuerza una key nueva en la próxima apertura (abrirNuevaCorrida)
      toast("ok", `Producción registrada${resultado && resultado.corrida_id ? ` (${resultado.corrida_id})` : ""}`);
      await refrescarSilencioso(() => setMsg("La producción se registró correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo."));
      if (suggestionUpdateFailures.length) {
        setMsg(`La corrida quedó registrada, pero MOMOS OPS no pudo cerrar ${suggestionUpdateFailures.join(", ")}. No crees otro lote: recarga y revisa esas recomendaciones.`);
      }
      const faltantes = resultado && resultado.faltantes;
      if (Array.isArray(faltantes) && faltantes.length) {
        const internos = faltantes.filter((f) => (db.subrecetas || []).some((subrecipe) => subrecipe.itemId === f.item_id));
        const compras = faltantes.filter((f) => !internos.includes(f));
        const acciones = [
          internos.length ? `prepará en Cocina: ${internos.map((f) => `${f.insumo} (faltan ${f.faltan} ${f.unidad})`).join(", ")}` : "",
          compras.length ? `comprá en Inventario: ${compras.map((f) => `${f.insumo} (faltan ${f.faltan} ${f.unidad})`).join(", ")}` : "",
        ].filter(Boolean).join(" · ");
        setMsg(`Producción registrada con faltantes: ${acciones}.`);
      }
    }

    function abrirPrepararBase(requestedSubrecipeId = "", requestedNominal = 1000) {
      const selectedId = typeof requestedSubrecipeId === "string" && subrecetasActivas.some((subrecipe) => subrecipe.id === requestedSubrecipeId)
        ? requestedSubrecipeId
        : (subrecetasActivas[0] ? subrecetasActivas[0].id : "");
      const nominal = +requestedNominal > 0 ? Math.round(+requestedNominal * 10) / 10 : 1000;
      prepIdemKeyRef.current = "subprod-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
      setPrepForm({ subrecetaId: selectedId, nominal, obtenidos: "", obtenidosTocado: false, resp: "", obs: "" });
      setPrepBase(true);
    }

    async function registrarPreparacion() {
      if (!prepSel) { setMsg("Elegí la base a preparar."); return; }
      if (!(+prepForm.nominal > 0)) { setMsg("Los gramos preparados deben ser mayores a 0."); return; }
      const payload = {
        subreceta_id: prepSel.id,
        gramos_nominales: +prepForm.nominal,
        gramos_obtenidos: +prepObtenidos,
        resp_user_id: respUserId(prepForm.resp),
        obs: prepForm.obs,
        idempotency_key: prepIdemKeyRef.current,
      };
      setEnviandoPrep(true);
      let resultado;
      try {
        resultado = await producirSubreceta(payload);
      } catch (e) {
        toast("error", "No se pudo registrar la preparación: " + e.message);
        setEnviandoPrep(false);
        return;
      }
      setEnviandoPrep(false);
      setPrepBase(false);
      prepIdemKeyRef.current = null; // fuerza key nueva en la próxima apertura
      toast("ok", `${prepSel.nombre} preparado · inventario actualizado`);
      await refrescarSilencioso(() => setMsg("La base se preparó correctamente, pero no se pudo actualizar la vista. Recargá la página para verla."));
      const faltantesPrep = resultado && resultado.faltantes;
      if (Array.isArray(faltantesPrep) && faltantesPrep.length) {
        setMsg(`Base preparada, pero el inventario no alcanzó para: ${faltantesPrep.map((f) => `${f.insumo} (faltan ${f.faltan} ${f.unidad})`).join(", ")}. Registra la compra en Inventario.`);
      }
    }

    // Desmolde diferido: el paso directo a 'Listo' ahora falla en el server sin conteos.
    function abrirDesmolde(l) {
      // Lote MIXTO (plan de 2+ figuras): el server exige conteos POR figura
      // (variantes-v1) — el modal pide el detalle en vez de los 3 totales.
      if ((l.figuras || []).length > 1) {
        setDesmolde({
          batchId: l.id, prod: l.prod,
          figuras: l.figuras.map((f) => ({ figura: f.figura, cant: +f.cant || 0, perfectas: +f.cant || 0, imperfectas: 0, descartadas: 0 })),
        });
        return;
      }
      const cargados = (l.perfectas || 0) + (l.imperfectas || 0) + (l.descartadas || 0);
      setDesmolde(cargados > 0
        ? { batchId: l.id, prod: l.prod, perfectas: l.perfectas, imperfectas: l.imperfectas, descartadas: l.descartadas }
        : { batchId: l.id, prod: l.prod, perfectas: l.prod, imperfectas: 0, descartadas: 0 });
    }

    // Transición a 'Listo': si perfectas+imperfectas+descartadas ya cuadra con prod
    // (lotes viejos ya cuadrados, o re-transiciones post-reversa), el server acepta
    // set_lote_estado directo. Si no cuadra, recién ahí hace falta el modal de desmolde.
    async function marcarListo(l) {
      const cuadra = (l.perfectas || 0) + (l.imperfectas || 0) + (l.descartadas || 0) === l.prod;
      if (!cuadra) { abrirDesmolde(l); return; }
      setEnviandoBatchId(l.id);
      try {
        await setLoteEstado(l.id, "Listo");
      } catch (e) {
        toast("error", "No se pudo cambiar el estado del lote: " + e.message);
        setEnviandoBatchId(null);
        return;
      }
      toast("ok", `${l.id} · listo`);
      await refrescarSilencioso(() => toast("alert", "El estado del lote cambió, pero no se pudo actualizar la vista. Recargá la página."));
      setEnviandoBatchId(null);
    }

    async function confirmarDesmolde() {
      const { batchId, perfectas, imperfectas, descartadas } = desmolde;
      setEnviandoDesmolde(true);
      try {
        if (desmolde.figuras) {
          // Lote mixto: totales = suma del detalle por figura (el server valida la coherencia doble).
          const tot = (k) => desmolde.figuras.reduce((s, f) => s + (+f[k] || 0), 0);
          await desmoldarLote(batchId, tot("perfectas"), tot("imperfectas"), tot("descartadas"),
            desmolde.figuras.map((f) => ({ figura: f.figura, perfectas: +f.perfectas || 0, imperfectas: +f.imperfectas || 0, descartadas: +f.descartadas || 0 })));
        } else {
          await desmoldarLote(batchId, +perfectas || 0, +imperfectas || 0, +descartadas || 0);
        }
      } catch (e) {
        toast("error", "No se pudo registrar el desmolde: " + e.message);
        setEnviandoDesmolde(false);
        return;
      }
      setEnviandoDesmolde(false);
      setDesmolde(null);
      toast("ok", `Lote desmoldado · stock actualizado · vence ${dISO(3)}`);
      await refrescarSilencioso(() => setMsg("El lote se desmoldó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo."));
    }

    async function iniciarCongelacionLote(lote) {
      setEnviandoBatchId(lote.id);
      try {
        await empezarCongelamiento(lote.id);
      } catch (error) {
        toast("error", "No se pudo empezar el congelamiento: " + error.message);
        setEnviandoBatchId(null);
        return;
      }
      toast("ok", `${lote.id} · congelamiento iniciado`);
      await refrescarSilencioso(() => toast("alert", "El lote empezó a congelar, pero no se pudo actualizar la vista. Recargá la página."));
      setEnviandoBatchId(null);
    }

    async function convertirImperfectasLote(lote) {
      setEnviandoBatchId(lote.id);
      try {
        await convertirImperfectas(lote.id);
      } catch (error) {
        toast("error", "No se pudieron convertir las imperfectas: " + error.message);
        setEnviandoBatchId(null);
        return;
      }
      toast("ok", `${lote.imperfectas} imperfectas del lote ${lote.id} → insumo`);
      await refrescarSilencioso(() => toast("alert", "Las imperfectas se convirtieron, pero no se pudo actualizar la vista. Recargá la página."));
      setEnviandoBatchId(null);
    }

    async function cambiarEstadoLote(lote, nuevoEstado) {
      if (nuevoEstado === "Listo") { await marcarListo(lote); return; }
      setEnviandoBatchId(lote.id);
      try {
        await setLoteEstado(lote.id, nuevoEstado);
      } catch (error) {
        toast("error", "No se pudo cambiar el estado del lote: " + error.message);
        setEnviandoBatchId(null);
        return;
      }
      toast("ok", `${lote.id} → ${nuevoEstado}`);
      await refrescarSilencioso(() => toast("alert", "El estado del lote cambió, pero no se pudo actualizar la vista. Recargá la página."));
      setEnviandoBatchId(null);
    }

    return (
      <div>
        <KitchenProductionQueue
          db={db}
          onOpenOrder={setDetallePedidoCocinaId}
          canStart={puedeIniciarPedidos}
          canReady={puedeEntregarEmpaque}
        />
        {detallePedidoCocina && <KitchenQuickCommand db={db} order={detallePedidoCocina}
          canStart={puedeIniciarPedidos} canReady={puedeEntregarEmpaque} busyOrderId={queueBusyOrderId}
          onStart={(orderId) => cambiarPedidoDesdeCocina(orderId, "En producción")}
          onReady={(orderId) => cambiarPedidoDesdeCocina(orderId, "Listo para empaque")}
          onMomobot={() => { const orderId = detallePedidoCocina.id; setDetallePedidoCocinaId(null); alistarPedidoDesdeCola(orderId); }}
          onClose={() => setDetallePedidoCocinaId(null)} refrescar={refrescar} perfil={perfil} />}
        <Suspense fallback={<Card className="p-4 mb-5" role="status" aria-live="polite"><div className="text-xs font-extrabold uppercase tracking-wider" style={{ color: T.coral }}>Momobot</div><div className="text-sm font-semibold mt-1" style={{ color: T.choco2 }}>Preparando el asistente de cocina…</div></Card>}>
          <LazyVoiceKitchenPanel db={db} perfil={perfil} flavors={sabores} figures={figurasProducibles} subrecipes={subrecetasActivas} refrescar={refrescar} serverDataReady={serverDataReady} requestedOrder={queueRequest} onReady={enfocarMomobotListo} ui={VOICE_PANEL_UI} />
        </Suspense>
        <div className="mb-4 flex gap-2 flex-wrap"><Btn onClick={abrirNuevaCorrida}>＋ Nueva producción</Btn>{subrecetasActivas.length > 0 && <Btn kind="soft" onClick={() => abrirPrepararBase()}>🥣 Preparar elaboración</Btn>}</div>

        <KitchenProductionAssistantFab
          plan={kitchenProductionPlan}
          unplannedSuggestions={unplannedSuggestions}
          formatAmount={cantidadPreparacionTexto}
          onPlanRun={abrirDesdePlanProduccion}
          onPrepare={abrirPrepararBase}
        />

        <SectionTitle>✅ Stock operativo disponible</SectionTitle>
        <div className="text-xs font-semibold mb-2" style={{ color: T.choco2 }}>Fuente oficial usada por ventas y reservas (products.stock). Un lote suma aquí al pasar a "Listo".</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
          {stockOperativo.map(([nombre, v, id]) => (
            <Card key={id} className="p-3 flex items-center justify-between gap-2" onClick={() => enfocarLotes({ producto: nombre })}>
              <div className="text-xs font-semibold leading-snug">{nombre}</div>
              <div className="display text-xl shrink-0" style={{ color: v <= 2 ? "#A03B2A" : "#3F6B42" }}>{v}</div>
            </Card>
          ))}
          {stockOperativo.length === 0 && <Empty icon="🍮" text="No hay productos con stock operativo." />}
        </div>

        <SectionTitle>🎯 Disponible por variante (figura + sabor)</SectionTitle>
        <div className="text-xs font-semibold mb-2" style={{ color: T.choco2 }}>Qué figuras exactas hay, por sabor y gramaje, con su vencimiento más próximo. Se llena con cada desmolde por figura (lotes nuevos; los viejos no tienen detalle).</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
          {(db.variantes || []).map((v) => (
            <Card key={`${v.productId}·${v.figura}·${v.sabor}·${v.gramajeG}`} className="p-3 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold leading-snug">
                {v.figura} · {v.sabor}
                <div className="text-[10px] mt-0.5 font-semibold" style={{ color: T.choco2 }}>{v.producto}{v.gramajeG != null ? ` · ${v.gramajeG} g` : ""}{v.vence ? ` · vence ${v.vence}` : ""}</div>
              </div>
              <div className="display text-xl shrink-0" style={{ color: v.disponibles > 0 ? "#3F6B42" : "#A03B2A" }}>{v.disponibles}</div>
            </Card>
          ))}
          {(db.variantes || []).length === 0 && <Empty icon="🎯" text="Sin desmoldes por figura todavía — el próximo desmolde llena este panel." />}
        </div>

        {subrecetasActivas.length > 0 && (
          <>
            <SectionTitle>🥣 Elaboraciones internas preparadas</SectionTitle>
            <div className="text-xs font-semibold mb-2" style={{ color: T.choco2 }}>Mousses por sabor, cheesecake, ganache y salsas se elaboran en Cocina: consumen su receta, registran rendimiento y alimentan este stock. Nunca entran como compra.</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
              {subrecetasActivas.map((sr) => {
                const it = itemDe[sr.itemId];
                const ult = ultimaPrepDe[sr.id];
                const formulaRows = (db.subreceta_ingredientes || []).filter((row) => row.subrecetaId === sr.id);
                return (
                  <Card key={sr.id} aria-label={`Ver receta de ${sr.nombre}`} className="p-3" onClick={() => { setDetalleCantidadFinal(300); setDetallePreparacionId(sr.id); }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold leading-snug">{sr.nombre}</div>
                      <div className="display text-xl shrink-0" style={{ color: it && it.stock > 0 ? "#3F6B42" : "#A03B2A" }}>{it ? it.stock : "—"}</div>
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>
                      {it ? `${it.unidad} · ${fmt(it.costo)}/${it.unidad}` : "sin item de inventario"}{ult ? ` · última: ${ult.creado || ult.fecha}` : ""}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2"><span className="text-[10px] font-bold" style={{ color: formulaRows.length ? "#3F6B42" : "#A03B2A" }}>{formulaRows.length ? `${formulaRows.length} insumos en fórmula` : "Sin fórmula cargada"}</span><span className="text-[10px] font-extrabold" style={{ color: T.coral }}>Ver receta ›</span></div>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {detallePreparacion && (
          <Modal title={`Receta · ${detallePreparacion.nombre}`} onClose={() => setDetallePreparacionId(null)} wide>
            <div className="rounded-2xl p-4 mb-3" style={{ background: T.soft, border: `1px solid ${T.border}` }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Guía de preparación de cocina</div><div className="display text-xl font-semibold mt-1">{detallePreparacion.nombre}</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Fórmula maestra registrada por cada 1.000 g antes de merma.</div></div>
                <div className="flex flex-wrap gap-2"><span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: T.rosa, color: "#8E4B5A" }}>{detallePreparacion.tipo.replaceAll("_", " ")}</span><span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: detalleFormula.completeFormula ? "#E6F1E3" : "#F6D4CD", color: detalleFormula.completeFormula ? "#3F6B42" : "#A03B2A" }}>{detalleFormula.components.length} insumos</span></div>
              </div>
              <div className="grid sm:grid-cols-[minmax(0,1fr)_220px] gap-3 items-end mt-4">
                <div><label className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Cantidad final que Cocina necesita</label><div className="text-xs mt-1" style={{ color: T.choco2 }}>Ejemplo: 300 g de cheesecake ya terminado y utilizable.</div></div>
                <div className="relative"><input type="number" min="1" step="10" value={detalleCantidadFinal} onChange={(event) => setDetalleCantidadFinal(Math.max(0, +event.target.value || 0))} aria-label="Cantidad final deseada en gramos" className="w-full rounded-xl border px-3 py-2.5 pr-10 text-lg font-bold outline-none" style={inputStyle} /><span className="absolute right-3 top-3 text-xs font-extrabold" style={{ color: T.choco2 }}>g</span></div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[["Resultado deseado", `${detalleFormula.desiredOutputGrams} g`, T.coral], ["Preparar antes de merma", `${detalleFormula.nominalInputGrams} g`, "#63518A"], ["Merma prevista", `${detalleFormula.wastePct}%`, "#96690F"], ["Costo estimado", fmt(detalleFormula.totalCost), "#3F6B42"]].map(([label, value, color]) => <div key={label} className="rounded-2xl p-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}><div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-xl mt-1" style={{ color }}>{value}</div></div>)}
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ background: T.vainilla }}><div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.choco2 }}>Ingredientes escalados</div><div className="font-bold text-sm mt-0.5">Cantidades para lograr {detalleFormula.desiredOutputGrams} g finales</div></div><Badge label={detalleFormula.canPrepare ? "Stock suficiente" : "Revisar stock"} map={{ "Stock suficiente": { bg: "#E6F1E3", fg: "#3F6B42" }, "Revisar stock": { bg: "#FBE8C8", fg: "#96690F" } }} /></div>
              {detalleFormula.components.map((component) => (
                <div key={component.itemId} className="grid sm:grid-cols-[minmax(0,1fr)_120px_170px] gap-2 items-center px-4 py-3 border-t" style={{ borderColor: T.border }}>
                  <div className="min-w-0"><div className="font-bold text-sm truncate">{component.name}</div><div className="text-[10px] font-semibold mt-0.5" style={{ color: T.choco2 }}>Fórmula base: {cantidadPreparacionTexto(component.unit, component.baseQuantity)} por 1.000 g</div></div>
                  <div className="sm:text-right"><div className="display text-lg" style={{ color: T.coral }}>{cantidadPreparacionTexto(component.unit, component.requiredQuantity)}</div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>usar ahora</div></div>
                  <div className="sm:text-right"><span className="inline-block text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: component.enough ? "#E6F1E3" : "#F6D4CD", color: component.enough ? "#3F6B42" : "#A03B2A" }}>{component.enough ? "✓" : "✕"} Disponible {cantidadPreparacionTexto(component.unit, component.stock)}</span></div>
                </div>
              ))}
              {!detalleFormula.hasFormula && <div className="p-4 text-sm font-bold" style={{ color: "#A03B2A" }}>Esta preparación todavía no tiene ingredientes asociados. No se puede calcular ni registrar de forma segura.</div>}
            </div>

            {!detalleFormula.canPrepare && detalleFormula.completeFormula && <div className="rounded-xl px-3 py-2.5 mt-3 text-xs font-bold" style={{ background: "#FBE8C8", color: "#96690F" }}>La receta está completa, pero uno o más insumos no alcanzan. Podés abrir el registro para planear la tanda; MOMOS OPS dejará trazado el faltante.</div>}
            <div className="flex flex-wrap justify-end gap-2 mt-4"><Btn kind="ghost" onClick={() => setDetallePreparacionId(null)}>Cerrar</Btn><Btn disabled={!detalleFormula.completeFormula || detalleFormula.desiredOutputGrams <= 0} onClick={() => { const subrecipeId = detallePreparacion.id; const nominal = detalleFormula.nominalInputGrams; setDetallePreparacionId(null); abrirPrepararBase(subrecipeId, nominal); }}>🥣 Preparar esta cantidad</Btn></div>
          </Modal>
        )}

        <SectionTitle>🧊 Lotes en proceso (aún no disponibles)</SectionTitle>
        <div className="text-xs font-semibold mb-2" style={{ color: T.choco2 }}>Congelando o en preparación. No suman al stock operativo hasta pasar a "Listo".</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
          {enProceso.map((e) => (
            <Card key={e.label} className="p-3 flex items-center justify-between gap-2" onClick={() => enfocarLotes({ combo: true, producto: e.producto, sabor: e.sabor, figura: e.figura, gramaje: e.gramaje })}>
              <div className="text-xs font-semibold leading-snug">{e.label}</div>
              <div className="display text-xl shrink-0" style={{ color: "#63518A" }}>{e.cant}</div>
            </Card>
          ))}
          {enProceso.length === 0 && <Empty icon="🧊" text="No hay lotes en proceso." />}
        </div>

        <div id="lotes-produccion" />
        <SectionTitle action={<div className="flex flex-wrap items-center justify-end gap-2">{foco && <button type="button" onClick={() => setFoco(null)} className="text-xs font-bold" style={{ color: T.coral }}>✕ Quitar filtro</button>}<WorkScopeTabs value={scope} onChange={(next) => { setScope(next); setFoco(null); }} activeCount={batchBuckets.active.length} historyCount={batchBuckets.history.length} activeLabel="En proceso" /></div>}>{scope === "active" ? "Lotes en proceso" : "Historial de lotes"}</SectionTitle>
        {foco && <div className="text-xs font-bold mb-3 p-2 rounded-lg" style={{ background: T.vainilla, color: T.choco2 }}>Mostrando lotes de: {focoLabel} ({lotesFiltrados.length})</div>}
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {lotesFiltrados.map((l) => {
            const cong = estadoCongelacion(l);
            const figuras = Array.isArray(l.figuras) && l.figuras.length ? l.figuras.map((f) => `${f.cant}× ${f.figura}`).join(" · ") : l.figura;
            return (
              <Card key={l.id} aria-label={`Abrir detalle del lote ${l.id}`} className="momo-queue-item p-4" onClick={() => setDetalleLoteId(l.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.choco2 }}>Lote {l.id}</div>
                    <div className="font-bold text-sm mt-1 truncate">{l.producto}</div>
                  </div>
                  <Badge label={l.estado} />
                </div>
                <div className="flex items-end justify-between gap-3 mt-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate" style={{ color: T.choco2 }}>{figuras || "Sin figura"} · {l.sabor || "Sin sabor"}</div>
                    <div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>{l.fecha} · {l.resp || "Sin responsable"}</div>
                  </div>
                  <div className="text-right shrink-0"><div className="display text-2xl leading-none" style={{ color: T.coral }}>{l.prod || 0}</div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>unidades</div></div>
                </div>
                {cong && (
                  <div className="rounded-2xl p-3 mt-3" style={{ background: cong.listo ? "#E6F1E3" : "#E7EEF6", color: cong.listo ? "#3F6B42" : "#365E87" }}>
                    <div className="flex items-center justify-between gap-3 text-xs font-extrabold"><span>{cong.listo ? "✓ Congelación cumplida" : "❄ Congelando"}</span><span>{fmtHoras(cong.horas)}</span></div>
                    <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: "rgba(255,255,255,.72)" }}><div className="h-full rounded-full" style={{ width: `${Math.min(100, (cong.horas / Math.max(cong.objetivo, 1)) * 100)}%`, background: cong.listo ? "#5E9162" : "#5B82AA" }} /></div>
                    <div className="text-[10px] font-bold mt-1.5">{cong.listo ? `Objetivo ${cong.objetivo} h · listo para desmolde` : `faltan ~${fmtHoras(cong.restan)} de ${cong.objetivo} h`}</div>
                  </div>
                )}
                {!cong && <div className="rounded-xl px-3 py-2 mt-3 text-xs font-bold" style={{ background: T.vainilla, color: T.choco2 }}>{l.estado === "En preparación" ? "Pendiente de iniciar congelación" : `Resultado: ${l.perfectas || 0} perfectas`}</div>}
                <div className="text-[11px] font-extrabold mt-3" style={{ color: T.coral }}>Ver información y acciones ›</div>
              </Card>
            );
          })}
          {lotesFiltrados.length === 0 && <div className="text-sm font-semibold p-3 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>{scope === "active" ? "No hay lotes activos para este filtro." : "Todavía no hay lotes en el historial para este filtro."}</div>}
        </div>

        {detalleLote && (
          <Modal title={`Lote ${detalleLote.id}`} onClose={() => setDetalleLoteId(null)} wide>
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl p-4 mb-3" style={{ background: T.soft, border: `1px solid ${T.border}` }}>
              <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Trazabilidad de producción</div><div className="display text-xl font-semibold mt-1">{detalleLote.producto}</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{detalleLote.fecha} · Responsable: {detalleLote.resp || "Sin asignar"}</div></div>
              <div className="flex gap-2 flex-wrap"><Badge label={detalleLote.estado} />{detalleLote.corridaId && <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: T.vainilla, color: "#63518A" }}>Corrida {detalleLote.corridaId}</span>}</div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[["Producidas", detalleLote.prod || 0, T.coral], ["Perfectas", detalleLote.perfectas || 0, "#3F6B42"], ["Imperfectas", detalleLote.imperfectas || 0, "#96690F"], ["Descartadas", detalleLote.descartadas || 0, "#A03B2A"]].map(([label, value, color]) => <div key={label} className="rounded-2xl p-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}><div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-2xl mt-1" style={{ color }}>{value}</div></div>)}
            </div>

            <div className="grid lg:grid-cols-2 gap-3">
              <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                <div className="text-[10px] uppercase tracking-[.12em] font-extrabold mb-3" style={{ color: T.choco2 }}>Composición del lote</div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Figuras</span><b className="text-right">{Array.isArray(detalleLote.figuras) && detalleLote.figuras.length ? detalleLote.figuras.map((f) => `${f.cant}× ${f.figura}`).join(" · ") : (detalleLote.figura || "—")}</b></div>
                  <div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Sabor</span><b>{detalleLote.sabor || "—"}</b></div>
                  <div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Relleno</span><b className="text-right">{detalleLote.relleno || "—"}</b></div>
                  {detalleLote.salsa && <div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Salsa</span><b>{detalleLote.salsa}</b></div>}
                  <div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Gramaje</span><b>{detalleLote.gramaje || "—"}</b></div>
                  {(detalleLote.molde || detalleLote.ubicacion) && <div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Molde / ubicación</span><b className="text-right">{[detalleLote.molde, detalleLote.ubicacion].filter(Boolean).join(" · ")}</b></div>}
                </div>
              </div>

              <div className="rounded-2xl p-4" style={{ background: detalleCongelacion ? (detalleCongelacion.listo ? "#E6F1E3" : "#E7EEF6") : T.surface, border: `1px solid ${detalleCongelacion ? (detalleCongelacion.listo ? "#B8D2B2" : "#B8CADE") : T.border}` }}>
                <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: detalleCongelacion?.listo ? "#3F6B42" : "#365E87" }}>Cronómetro de congelación</div>
                {detalleCongelacion ? <><div className="flex items-end justify-between gap-3 mt-2"><div><div className="display text-3xl" style={{ color: detalleCongelacion.listo ? "#3F6B42" : "#365E87" }}>{fmtHoras(detalleCongelacion.horas)}</div><div className="text-xs font-bold mt-1">transcurridas</div></div><div className="text-right text-xs font-bold">Objetivo {detalleCongelacion.objetivo} h<br />{detalleCongelacion.listo ? "Tiempo cumplido" : `Faltan ~${fmtHoras(detalleCongelacion.restan)}`}</div></div><div className="h-2 rounded-full overflow-hidden mt-3" style={{ background: "rgba(255,255,255,.7)" }}><div className="h-full rounded-full" style={{ width: `${Math.min(100, (detalleCongelacion.horas / Math.max(detalleCongelacion.objetivo, 1)) * 100)}%`, background: detalleCongelacion.listo ? "#5E9162" : "#5B82AA" }} /></div><div className="text-xs font-semibold mt-2">Inicio: {detalleLote.inicioCongelacion}</div></> : <div className="text-sm font-semibold mt-3" style={{ color: T.choco2 }}>{detalleLote.estado === "En preparación" ? "El cronómetro todavía no ha iniciado." : "Este lote ya no tiene un cronómetro activo."}</div>}
              </div>

              <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                <div className="text-[10px] uppercase tracking-[.12em] font-extrabold mb-3" style={{ color: T.choco2 }}>Calidad y destino</div>
                <div className="text-sm space-y-2"><div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Merma</span><b style={{ color: detalleMerma > 0.15 ? "#A03B2A" : "#3F6B42" }}>{pct(detalleMerma)}{detalleMerma > 0.15 ? " · revisar" : ""}</b></div><div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Destino imperfectas</span><b className="text-right">{detalleLote.destino && detalleLote.destino !== "—" ? detalleLote.destino : "Pendiente"}</b></div><div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Stock contabilizado</span><b>{detalleLote.stockContabilizado ? "Sí" : "No"}</b></div></div>
              </div>

              <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                <div className="text-[10px] uppercase tracking-[.12em] font-extrabold mb-3" style={{ color: T.choco2 }}>Vencimiento y observaciones</div>
                <div className="text-sm font-bold">{!isActiveProductionBatch(detalleLote) && detalleLote.vence ? `Vence ${detalleLote.vence} · 3 días desde desmolde` : "Vence 3 días después del desmolde"}</div>
                <div className="text-xs mt-3" style={{ color: T.choco2 }}>{detalleLote.obs ? `📝 ${detalleLote.obs}` : "Sin observaciones registradas."}</div>
              </div>
            </div>

            {isActiveProductionBatch(detalleLote) && <div className="flex flex-wrap items-center justify-end gap-2 mt-4 pt-4 border-t" style={{ borderColor: T.border }}>
              {detalleLote.estado === "En preparación" && <BtnAsync small confirmar="❄️ ¿Empezar? Tocá de nuevo" textoEnVuelo="Empezando…" disabled={enviandoBatchId === detalleLote.id} onClick={() => iniciarCongelacionLote(detalleLote)}>❄️ Empezar congelación</BtnAsync>}
              {detalleCongelacion?.listo && <BtnAsync small textoEnVuelo="Listando…" disabled={enviandoBatchId === detalleLote.id} onClick={() => marcarListo(detalleLote)}>Desmoldar y marcar listo</BtnAsync>}
              {detalleLote.imperfectas > 0 && !String(detalleLote.destino).includes("Insumo") && <BtnAsync small kind="soft" confirmar="♻️ ¿Convertir a insumo? Tocá de nuevo" textoEnVuelo="Convirtiendo…" disabled={enviandoBatchId === detalleLote.id} onClick={() => convertirImperfectasLote(detalleLote)}>♻️ Convertir imperfectas</BtnAsync>}
              <MiniSelect options={LOTE_ESTADOS} value={detalleLote.estado} disabled={enviandoBatchId === detalleLote.id} onChange={(event) => cambiarEstadoLote(detalleLote, event.target.value)} />
            </div>}
          </Modal>
        )}

        {nuevo && (() => {
          const totalUnidades = Object.values(form.figuras).reduce((s, c) => s + (+c || 0), 0);
          // Espejo del server: crear_corrida agrupa lotes por (producto, gramaje_g)
          const porLote = {};
          Object.entries(form.figuras).forEach(([figura, cant]) => {
            if (!(+cant > 0)) return;
            const p = productoDeFigura[figura];
            const f = figurasProducibles.find((x) => x.nombre === figura);
            const etiqueta = (p ? p.nombre : figura) + (f?.gramajeG != null ? ` (${f.gramajeG} g)` : "");
            porLote[etiqueta] = (porLote[etiqueta] || 0) + (+cant);
          });
          return (
            <Modal title={pre?.grouped ? `Plan de Cocina · ${pre.flavor}` : "Registrar producción"} onClose={() => { setNuevo(false); setPre(null); setRegistroError(""); }} wide>
              {pre?.grouped && <div className="mb-3 px-3 py-3 rounded-xl text-xs font-bold" style={{ background: "#DDEBD9", color: "#315D36" }}>
                <div className="text-[10px] uppercase tracking-[.12em] font-extrabold">🧠 Corrida agrupada y trazable</div>
                <div className="mt-1">{pre.cantidad} unidades de {pre.flavor}: {pre.producto}.</div>
                <div className="text-[10px] mt-1 opacity-80">{pre.queueUnits > 0 ? `${pre.queueUnits} vienen de la cola pagada` : "Cobertura sugerida por demanda"}{pre.suggestionIds.length > 1 ? ` · cerrará ${pre.suggestionIds.length} recomendaciones juntas` : ""}.</div>
              </div>}
              <div className="grid sm:grid-cols-2 gap-x-4">
                <Field label="Sabor"><Select options={sabores} value={form.sabor} onChange={(e) => setForm({ ...form, sabor: e.target.value })} /></Field>
                <Field label="Relleno"><Select options={s.rellenos} value={form.relleno} onChange={(e) => setForm({ ...form, relleno: e.target.value })} /></Field>
                {/* Salsa NO va acá: se aplica al despacho y la elige el cliente (NuevoPedido) */}
              </div>

              <div className="text-xs font-bold mb-1.5" style={{ color: T.choco2 }}>Cantidad por figura</div>
              <div className="grid sm:grid-cols-2 gap-2 mb-3">
                {figurasProducibles.map((f) => (
                  <div key={f.nombre} className="flex items-center justify-between gap-2 p-2.5 rounded-xl" style={{ background: T.vainilla }}>
                    <div className="text-xs font-semibold leading-snug">
                      {f.especie === "perro" ? "🐶" : "🐱"} {f.nombre}
                      <div className="text-[10px] font-normal" style={{ color: T.choco2 }}>{f.gramajeG != null ? `${f.gramajeG} g` : ""}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button type="button" onClick={() => setForm({ ...form, figuras: { ...form.figuras, [f.nombre]: Math.max(0, (+form.figuras[f.nombre] || 0) - 1) } })} className="w-7 h-7 rounded-full font-bold" style={{ background: "#fff", border: "1px solid " + T.border, color: T.choco }}>−</button>
                      <input type="number" min="0" step="1" value={form.figuras[f.nombre] ?? 0} onChange={(e) => setForm({ ...form, figuras: { ...form.figuras, [f.nombre]: Math.max(0, parseInt(e.target.value, 10) || 0) } })} className="w-12 text-center rounded-lg px-1 py-1 text-sm border" style={inputStyle} />
                      <button type="button" onClick={() => setForm({ ...form, figuras: { ...form.figuras, [f.nombre]: (+form.figuras[f.nombre] || 0) + 1 } })} className="w-7 h-7 rounded-full font-bold" style={{ background: "#fff", border: "1px solid " + T.border, color: T.choco }}>+</button>
                    </div>
                  </div>
                ))}
                {figurasProducibles.length === 0 && <Empty icon="🧊" text="No hay figuras activas con producto asignado." />}
              </div>

              <div className="text-xs font-semibold mb-3 p-2.5 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>
                Total: <b>{totalUnidades}</b> unidades{Object.keys(porLote).length > 0 && (" · " + Object.entries(porLote).map(([etiqueta, cant]) => `${cant}× ${etiqueta}`).join(" · "))}
                <div className="mt-0.5 text-[10px]">Solo informativo — el server calcula los lotes reales al registrar.</div>
              </div>

              <div className="grid sm:grid-cols-2 gap-x-4">
                <Field label="Responsable"><Select options={db.users.filter((u) => u.activo).map((u) => u.nombre)} value={form.resp} onChange={(e) => setForm({ ...form, resp: e.target.value })} placeholder="Sin responsable" /></Field>
                <Field label="Horas de congelación objetivo"><Input type="number" min="1" step="1" value={form.horasCongelacion} onChange={(e) => setForm({ ...form, horasCongelacion: +e.target.value })} /></Field>
              </div>
              <div className="rounded-xl px-3 py-2.5 mb-3 text-xs font-semibold" style={{ background: "#E8F1E5", color: "#315D36", border: "1px solid #C9DDC4" }}>
                🗓️ El vencimiento no se digita: empieza al confirmar el desmolde y queda sellado automáticamente por 3 días.
              </div>
              <Field label="Observaciones"><Input value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} /></Field>
              <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>Al registrar: se descuentan los insumos de la receta (por la cantidad producida) y se crea un lote por cada figura elegida. Las piezas perfectas se suman al stock cuando cada lote pase a "Listo" (con desmolde).</div>
              {registroError && <div role="alert" className="rounded-2xl border px-4 py-3 mb-3" style={{ background: "#FFF2EF", borderColor: "#E8B7AD", color: "#8F3528" }}>
                <div className="text-[10px] uppercase tracking-[.12em] font-extrabold">⚠ Stock insuficiente</div>
                <div className="text-sm font-bold mt-1">{registroError}</div>
              </div>}
              <div className="flex gap-2">
                <BtnAsync textoEnVuelo="Registrando…" disabled={enviando || totalUnidades === 0} onClick={registrarCorrida}>Registrar producción</BtnAsync>
                <Btn kind="ghost" disabled={enviando} onClick={() => { setNuevo(false); setPre(null); setRegistroError(""); }}>Cancelar</Btn>
              </div>
            </Modal>
          );
        })()}

        {prepBase && (
          <Modal title="🥣 Preparar elaboración interna" onClose={() => setPrepBase(false)} wide>
            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Base a preparar">
                <select value={prepForm.subrecetaId} onChange={(e) => setPrepForm({ ...prepForm, subrecetaId: e.target.value, obtenidos: "", obtenidosTocado: false })} className="w-full rounded-lg px-2 py-2 text-sm border" style={inputStyle}>
                  {PREP_TIPOS.map(([tipo, label]) => {
                    const grupo = subrecetasActivas.filter((sr) => sr.tipo === tipo);
                    return grupo.length ? (
                      <optgroup key={tipo} label={label}>
                        {grupo.map((sr) => <option key={sr.id} value={sr.id}>{sr.nombre}</option>)}
                      </optgroup>
                    ) : null;
                  })}
                </select>
              </Field>
              <Field label="Responsable"><Select options={db.users.filter((u) => u.activo).map((u) => u.nombre)} value={prepForm.resp} onChange={(e) => setPrepForm({ ...prepForm, resp: e.target.value })} placeholder="Sin responsable" /></Field>
              <Field label="Gramos preparados (nominal)"><Input type="number" min="1" step="50" value={prepForm.nominal} onChange={(e) => setPrepForm({ ...prepForm, nominal: Math.max(0, +e.target.value || 0), obtenidos: "", obtenidosTocado: false })} /></Field>
              <Field label={`Gramos obtenidos (sugerido ${prepObtenidosDefault} · merma ${prepSel ? prepSel.mermaPct : 0}%)`}><Input type="number" min="0" value={prepObtenidos} onChange={(e) => setPrepForm({ ...prepForm, obtenidos: e.target.value, obtenidosTocado: true })} /></Field>
            </div>
            <Field label="Observaciones"><Input value={prepForm.obs} onChange={(e) => setPrepForm({ ...prepForm, obs: e.target.value })} /></Field>
            {prepSel && (
              <>
                <div className="text-xs font-bold mb-1.5" style={{ color: T.choco2 }}>Ingredientes a consumir ({+prepForm.nominal || 0} g de {prepSel.nombre})</div>
                <div className="mb-3 rounded-xl p-2.5 text-xs" style={{ background: T.vainilla }}>
                  {prepIngredientes.map((x) => (
                    <div key={x.itemId} className="flex justify-between gap-2 py-0.5">
                      <span>{x.nombre}</span>
                      <span className="font-semibold" style={{ color: x.alcanza ? T.choco : "#A03B2A" }}>{x.reqTxt}{x.alcanza ? "" : " · ⚠ falta stock"}</span>
                    </div>
                  ))}
                  {prepIngredientes.length === 0 && <div>Esta base no tiene receta cargada.</div>}
                  <div className="flex justify-between gap-2 pt-1.5 mt-1.5 font-bold" style={{ borderTop: "1px solid " + T.border }}>
                    <span>Costo estimado del batch</span><span>{fmt(Math.round(prepCosto))}</span>
                  </div>
                </div>
              </>
            )}
            <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>Al registrar: se descuentan los ingredientes por los gramos nominales, y los gramos obtenidos suman al stock de la base con su costo real (WAC). Los faltantes no bloquean: quedan avisados.</div>
            <div className="flex gap-2">
              <BtnAsync textoEnVuelo="Registrando…" disabled={enviandoPrep || !prepSel || !(+prepForm.nominal > 0)} onClick={registrarPreparacion}>Registrar preparación</BtnAsync>
              <Btn kind="ghost" disabled={enviandoPrep} onClick={() => setPrepBase(false)}>Cancelar</Btn>
            </div>
          </Modal>
        )}

        {desmolde && (() => {
          // Lote MIXTO: conteos por figura — cada figura debe cuadrar completa
          // contra su cant del plan (mismo guard que valida el server).
          if (desmolde.figuras) {
            const filaCuadra = (f) => (+f.perfectas || 0) + (+f.imperfectas || 0) + (+f.descartadas || 0) === f.cant;
            const cuadraTodo = desmolde.figuras.every(filaCuadra);
            const setFig = (i, k, v) => setDesmolde({
              ...desmolde,
              figuras: desmolde.figuras.map((f, j) => (j === i ? { ...f, [k]: Math.max(0, parseInt(v, 10) || 0) } : f)),
            });
            return (
              <Modal title={`Desmolde ${desmolde.batchId} · lote mixto`} onClose={() => setDesmolde(null)}>
                <div className="text-sm font-semibold mb-2" style={{ color: T.choco2 }}>Producidas: {desmolde.prod} · este lote combina {desmolde.figuras.length} figuras — contá cada una por separado.</div>
                <div className="text-xs font-bold mb-3 rounded-xl px-3 py-2" style={{ background: "#E8F1E5", color: "#315D36" }}>Al confirmar, el producto terminado vencerá el {dISO(3)}.</div>
                {desmolde.figuras.map((f, i) => (
                  <div key={f.figura} className="mb-2 rounded-xl p-2.5" style={{ background: T.vainilla }}>
                    <div className="text-xs font-bold mb-1.5" style={{ color: filaCuadra(f) ? T.choco2 : "#A03B2A" }}>{f.figura} · {f.cant} producidas{filaCuadra(f) ? "" : ` — la suma debe dar ${f.cant}`}</div>
                    <div className="grid grid-cols-3 gap-x-3">
                      <Field label="Perfectas"><Input type="number" min="0" value={f.perfectas} onChange={(e) => setFig(i, "perfectas", e.target.value)} /></Field>
                      <Field label="Imperfectas"><Input type="number" min="0" value={f.imperfectas} onChange={(e) => setFig(i, "imperfectas", e.target.value)} /></Field>
                      <Field label="Descartadas"><Input type="number" min="0" value={f.descartadas} onChange={(e) => setFig(i, "descartadas", e.target.value)} /></Field>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 mt-3">
                  <BtnAsync confirmar="¿Desmoldar? Tocá de nuevo" textoEnVuelo="Desmoldando…" disabled={enviandoDesmolde || !cuadraTodo} onClick={confirmarDesmolde}>Confirmar</BtnAsync>
                  <Btn kind="ghost" disabled={enviandoDesmolde} onClick={() => setDesmolde(null)}>Cancelar</Btn>
                </div>
              </Modal>
            );
          }
          const suma = (+desmolde.perfectas || 0) + (+desmolde.imperfectas || 0) + (+desmolde.descartadas || 0);
          const cuadra = suma === desmolde.prod;
          return (
            <Modal title={`Desmolde ${desmolde.batchId}`} onClose={() => setDesmolde(null)}>
              <div className="text-sm font-semibold mb-2" style={{ color: T.choco2 }}>Producidas: {desmolde.prod}</div>
              <div className="text-xs font-bold mb-3 rounded-xl px-3 py-2" style={{ background: "#E8F1E5", color: "#315D36" }}>Al confirmar, el producto terminado vencerá el {dISO(3)}.</div>
              <div className="grid sm:grid-cols-3 gap-x-3">
                <Field label="Perfectas"><Input type="number" min="0" value={desmolde.perfectas} onChange={(e) => setDesmolde({ ...desmolde, perfectas: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
                <Field label="Imperfectas"><Input type="number" min="0" value={desmolde.imperfectas} onChange={(e) => setDesmolde({ ...desmolde, imperfectas: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
                <Field label="Descartadas"><Input type="number" min="0" value={desmolde.descartadas} onChange={(e) => setDesmolde({ ...desmolde, descartadas: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
              </div>
              {!cuadra && <div className="text-xs font-bold mb-3" style={{ color: "#A03B2A" }}>La suma ({suma}) debe ser igual a las producidas ({desmolde.prod}).</div>}
              <div className="flex gap-2">
                <BtnAsync confirmar="¿Desmoldar? Tocá de nuevo" textoEnVuelo="Desmoldando…" disabled={enviandoDesmolde || !cuadra} onClick={confirmarDesmolde}>Confirmar</BtnAsync>
                <Btn kind="ghost" disabled={enviandoDesmolde} onClick={() => setDesmolde(null)}>Cancelar</Btn>
              </div>
            </Modal>
          );
        })()}


        {msg && <Modal title="Aviso de producción" onClose={() => setMsg("")}><p className="text-sm m-0">{msg}</p><div className="mt-4"><Btn onClick={() => setMsg("")}>Listo</Btn></div></Modal>}
      </div>
    );
  }

  return Produccion;
}
