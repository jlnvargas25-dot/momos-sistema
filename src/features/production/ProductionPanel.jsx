import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createCompactQueueOrderCard } from "../operations/CompactQueueOrderCard.jsx";
import {
  completarEtapaPedido, completarCocinaYEntregarEmpaque, convertirImperfectas, convertirImperfectasDelta,
  crearCorrida, crearCorridaAgrupada, crearCorridaDelta,
  crearIncidentePedido, createInventoryIdempotencyKey, desecharLoteInsumo, desecharLoteInsumoDelta,
  desecharProductoTerminadoDelta, desmoldarLote, empezarCongelamiento, isMissingRpcError,
  producirSubreceta, producirSubrecetaDelta, resolverIncidentePedido, setLoteEstado,
  setOrderStatusRemoto, setSugerenciaEstado,
} from "../../lib/rpc";
import {
  kitchenDelayedOrderReminders, kitchenOrderAlert, kitchenReadyOrderCommands, normalizeKitchenDelaySettings,
} from "../../lib/kitchen-voice";
import { orderTransitionPermission } from "../../lib/order-workflow";
import { calculateSubrecipeBatch } from "../../lib/subrecipe-scaling";
import { calculateProductionInputPreview } from "../../lib/production-input-preview";
import { buildFigureBatchPreparationGuide, buildSubrecipePreparationGuide } from "../../lib/production-preparation-guide";
import { buildFinishedInventory } from "../../lib/finished-inventory";
import { canonicalUsableIngredientStock } from "../../lib/canonical-stock.js";
import { canonicalBatchPhysicalResult } from "../../lib/canonical-production-results.js";
import { buildProductionExpiryControl } from "../../lib/production-expiry-control";
import { explainOperationalError } from "../../lib/operational-errors";
import { buildPackingChecklistLines } from "../../lib/packing-workflow";
import { KITCHEN_ISSUE_GUIDANCE, kitchenQuickCommandState } from "../../lib/kitchen-command";
import { buildKitchenProductionPlan, productionRunDraft } from "../../lib/production-planner";
import { activeStageAssignment, canOperateStage, openOrderIncidents } from "../../lib/operational-control";
import { isActiveProductionBatch, partitionByActivity } from "../../lib/operational-history";
import { activeFigureCatalog, batchPresentation, commercialFamilyLabel, isKitchenFigureName } from "../../lib/momos-domain-language";
import InternalPreparationSheetEditor from "../inventory/InternalPreparationSheetEditor.jsx";
import { FinishedFigureCards, FinishedFigureDetailContent } from "../inventory/FinishedFigureSummary.jsx";
import KitchenRecipeCenter from "./KitchenRecipeCenter.jsx";

const LazyVoiceKitchenPanel = lazy(() => import("./VoiceKitchenPanel.jsx"));

function physicalBatchPresentation(batch) {
  const presentation = batchPresentation(batch);
  if (presentation.figures.length <= 1) return presentation;
  return {
    ...presentation,
    primary: `${presentation.flavor || "Sin sabor"} · ${presentation.composition}`,
  };
}

function physicalFigureIcon(species) {
  if (species === "gato") return "🐱";
  if (species === "perro") return "🐶";
  return "🍨";
}

function batchBelongsToFocus(batch, focus) {
  if (!batch || !focus) return false;
  if (batch.productId && focus.productId) return batch.productId === focus.productId;
  return batch.producto === focus.producto;
}

export function createProductionPanel(shared) {
  const {
    T, Badge, Btn, BtnAsync, Card, Empty, Field, Input, Modal, SectionTitle, Select, Stat,
    WorkScopeTabs, customerOf, dISO, estadoCongelacion, fmt, fmtHoras, hoyISO, inputCls, inputStyle,
    pct, recipeCost, recipeLines, toast, vibrar,
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
                    <div className="flex items-end justify-between gap-3 mb-3"><div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>Primero</div><div className="display text-lg font-semibold mt-0.5">Corridas recomendadas</div></div><div className="text-[10px] font-semibold text-right hidden sm:block" style={{ color: T.choco2 }}>Pedidos pagados<br />en orden</div></div>
                    <div className="space-y-3">
                      {productionPlans.map((productionPlan) => (
                        <div key={productionPlan.id} className="rounded-2xl border p-4" style={{ borderColor: productionPlan.queueUnits > 0 ? "#E9A18F" : T.border, background: T.surface, boxShadow: "0 2px 5px rgba(84,56,43,.07)" }}>
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="display text-xl font-semibold">Corrida de {productionPlan.flavor}</span><Badge label={productionPlan.source} map={{ "Cola + demanda": { bg: "#FBE8C8", fg: "#96690F" }, "Cola pagada": { bg: "#F3D7DC", fg: "#8E4B5A" }, "Demanda proyectada": { bg: "#DDEBD9", fg: "#3F6B42" } }} /><span className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: T.vainilla, color: T.choco2 }}>Confianza {productionPlan.confidence}</span></div><div className="text-sm font-extrabold mt-2">Producir {productionPlan.totalUnits}: {productionPlan.variants.map((variant) => `${variant.recommended}× ${variant.figure}`).join(" · ")}</div><div className="text-[11px] font-semibold mt-1" style={{ color: T.choco2 }}>{productionPlan.filling || "Sin relleno"} · {productionPlan.queueUnits} en cola · {productionPlan.availableUnits} disponibles · {productionPlan.inProcessUnits} en proceso</div>{productionPlan.suggestionIds.length > 1 && <div className="rounded-xl px-3 py-2 mt-2 text-[11px] font-bold" style={{ background: "#FFF1D6", color: "#7B5410" }}>🔗 MOMOS agrupó {productionPlan.suggestionIds.length} necesidades compatibles en esta corrida.</div>}{productionPlan.attributedUnits > 0 && <div className="text-[11px] font-bold mt-2" style={{ color: "#3E5C7E" }}>📣 {productionPlan.attributedUnits} venta{productionPlan.attributedUnits === 1 ? "" : "s"} atribuida{productionPlan.attributedUnits === 1 ? "" : "s"} a pauta{productionPlan.adSignals.length ? ` · ${productionPlan.adSignals.join(" · ")}` : ""}</div>}</div><Btn small disabled={!productionPlan.canCreate} onClick={() => choosePlan(productionPlan)}>Crear corrida</Btn></div>
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

  // Componentes + BOM: agrupación del select de bases por tipo de subreceta.
  const PREP_TIPOS = [
    ["mousse_frutal", "Mousses frutales"], ["mousse_cremosa", "Mousses cremosas"],
    ["cheesecake", "Cheesecake"], ["ganache", "Ganache"], ["salsa", "Salsas"], ["crocante", "Crocante"],
  ];
  const EXPIRY_META = Object.freeze({
    expired: { label: "Vencido · cuarentena", bg: "#F6D4CD", fg: "#A03B2A" },
    today: { label: "Vence hoy · usar primero", bg: "#FBE0D7", fg: "#A54830" },
    urgent: { label: "Usar primero", bg: "#FBE8C8", fg: "#7B5410" },
    soon: { label: "Planificar uso", bg: "#E8F1E5", fg: "#315D36" },
    missing: { label: "Falta fecha", bg: "#E8E1F1", fg: "#63518A" },
    later: { label: "Vigente", bg: "#E8F1E5", fg: "#315D36" },
  });

  function expiryLabel(row) {
    if (row.priority === "urgent" || row.priority === "soon") return `${EXPIRY_META[row.priority].label} · ${row.days} d`;
    return EXPIRY_META[row.priority]?.label || "Revisar";
  }

  function PreparationSteps({ guide, title = "Paso a paso", testId }) {
    if (!guide) return null;
    return (
      <div data-testid={testId} className="rounded-2xl overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3" style={{ background: T.soft }}>
          <div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>{title}</div>{guide.note && <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{guide.note}</div>}{guide.governed && <div className="text-[10px] font-bold mt-1" style={{ color: T.green }}>Ficha vigente v{guide.version}{guide.sourceRef ? ` · ${guide.sourceRef}` : ""}</div>}</div>
          {typeof guide.processDefined === "boolean" && <span className="text-[10px] uppercase font-extrabold px-2.5 py-1 rounded-full" style={{ background: guide.processDefined ? "#E6F1E3" : "#FBE8C8", color: guide.processDefined ? "#3F6B42" : "#96690F" }}>{guide.processDefined ? "Proceso oficial" : "Proceso parcial"}</span>}
        </div>
        <div className="p-3 space-y-2">
          {guide.steps.map((step, index) => <div key={`${index}-${step.title}`} className="grid grid-cols-[30px_minmax(0,1fr)] gap-2.5 rounded-xl p-3" style={{ background: index % 2 ? T.vainilla : T.surface }}><div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold" style={{ background: T.coral, color: "white" }}>{index + 1}</div><div><div className="text-sm font-extrabold">{step.title}</div><div className="text-xs font-semibold mt-0.5 leading-relaxed" style={{ color: T.choco2 }}>{step.detail}</div></div></div>)}
        </div>
      </div>
    );
  }


  function Produccion({
    db, update, user, refrescar, sincronizarProductoTerminado,
    aplicarMutacionProduccion, capturarContextoMutacionProduccion,
    aplicarDeltaInventario, capturarGeneracionInventario,
    aplicarMutacionCatalogoCrm, capturarContextoMutacionCatalogoCrm,
    perfil, serverDataReady, focus,
  }) {
    const [, setTick] = useState(0);
    useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t); }, []);
    const [nuevo, setNuevo] = useState(false);
    const [pre, setPre] = useState(null); // sugerencia que origina la corrida
    const [queueRequest, setQueueRequest] = useState(null);
    const corridaIdemKeyRef = useRef(null); // 1 por apertura del form: tolera retries de red sin duplicar la corrida
    const corridaCompoundIdemKeyRef = useRef(null); // H91: corrida + sugerencias en una transacción
    const imperfectasIdemKeysRef = useRef(new Map());
    const s = db.settings;
    const vidaUtilProductoTerminadoDias = Number.isInteger(s.vidaUtilProductoTerminadoDias) && s.vidaUtilProductoTerminadoDias > 0
      ? s.vidaUtilProductoTerminadoDias : 3;
    const vidaUtilMezclasDias = Number.isInteger(s.vidaUtilMezclasDias) && s.vidaUtilMezclasDias > 0
      ? s.vidaUtilMezclasDias : 0;
    const sabores = useMemo(
      () => [...(s.saboresFrutales || []), ...(s.saboresCremosos || [])],
      [s.saboresFrutales, s.saboresCremosos],
    );
    // Producción solo ofrece figuras activas enlazadas a su familia comercial
    // exacta. Un nombre canónico con product_id equivocado falla cerrado.
    const figurasProducibles = useMemo(
      () => activeFigureCatalog(db),
      [db.figuras, db.products, db.settings?.figuras],
    );
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
    const [calculadoraElaboraciones, setCalculadoraElaboraciones] = useState(false);
    const [calculoElaboracionesForm, setCalculoElaboracionesForm] = useState(() => ({
      sabor: sabores[0] || "",
      figuras: Object.fromEntries(figurasProducibles.map((figure) => [figure.nombre, 0])),
    }));
    const [msg, setMsg] = useState("");
    const [registroError, setRegistroError] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [enviandoBatchId, setEnviandoBatchId] = useState(null); // deshabilita solo la card del lote en vuelo
    const [desmolde, setDesmolde] = useState(null); // {batchId, prod, perfectas, imperfectas, descartadas} — mini-modal de conteos
    const [enviandoDesmolde, setEnviandoDesmolde] = useState(false);
    const [desechoVencido, setDesechoVencido] = useState(null);
    const [motivoDesecho, setMotivoDesecho] = useState("");
    const [enviandoDesecho, setEnviandoDesecho] = useState(false);
    const [errorDesecho, setErrorDesecho] = useState("");
    const desechoIdemKeyRef = useRef(null);
    const puedeIniciarPedidos = orderTransitionPermission(perfil, "Pagado", "En producción").allowed;
    const puedeEntregarEmpaque = orderTransitionPermission(perfil, "En producción", "Listo para empaque").allowed;
    const [queueBusyOrderId, setQueueBusyOrderId] = useState(null);
    const [detallePedidoCocinaId, setDetallePedidoCocinaId] = useState(null);
    const detallePedidoCocina = detallePedidoCocinaId ? db.orders.find((order) => order.id === detallePedidoCocinaId) : null;
    const batchBuckets = useMemo(() => partitionByActivity(db.production_batches, isActiveProductionBatch), [db.production_batches]);
    const [scope, setScope] = useState("active");
    const [detalleLoteId, setDetalleLoteId] = useState(null);
    const [detalleStockFiguraNombre, setDetalleStockFiguraNombre] = useState(null);
    const detalleLote = useMemo(() => (db.production_batches || []).find((lote) => lote.id === detalleLoteId) || null, [db.production_batches, detalleLoteId]);
    const detalleCongelacion = detalleLote ? estadoCongelacion(detalleLote) : null;
    const detalleResultado = useMemo(() => (detalleLote ? canonicalBatchPhysicalResult(detalleLote) : null), [detalleLote]);
    const detalleMerma = detalleResultado?.grossWasteRate || 0;
    const detalleComercial = useMemo(() => {
      if (!detalleLote) return null;
      const reservations = (db.inventory_reservations || []).filter((reservation) => reservation.tipo === "producto" && reservation.batchId === detalleLote.id);
      const resultRows = Array.isArray(detalleLote.resultadosFiguras) ? detalleLote.resultadosFiguras : [];
      const assigned = resultRows.reduce((sum, row) => sum + (+row.consumidas || 0), 0);
      return {
        exact: resultRows.length > 0,
        available: Math.max(0, (detalleResultado?.perfect || 0) - assigned),
        reserved: reservations.filter((reservation) => reservation.estado === "Reservada").reduce((sum, reservation) => sum + (+reservation.cantidad || 0), 0),
        sold: reservations.filter((reservation) => reservation.estado === "Consumida").reduce((sum, reservation) => sum + (+reservation.cantidad || 0), 0),
      };
    }, [detalleLote, detalleResultado, db.inventory_reservations]);

    const corridaInsumos = useMemo(() => calculateProductionInputPreview({
      flavor: form.sabor,
      quantities: form.figuras,
      figures: figurasProducibles,
      subrecipes: db.subrecetas || [],
      subrecipeIngredients: db.subreceta_ingredientes || [],
      fillingRules: db.figura_relleno || [],
      inventory: db.inventory_items || [],
      inventoryLots: db.inventory_lots || [],
      inventoryLotsReady: db.inventoryLotsReady === true,
      today: hoyISO(),
    }), [form.sabor, form.figuras, figurasProducibles, db.subrecetas, db.subreceta_ingredientes, db.figura_relleno, db.inventory_items, db.inventory_lots, db.inventoryLotsReady]);
    const calculoElaboraciones = useMemo(() => calculateProductionInputPreview({
      flavor: calculoElaboracionesForm.sabor,
      quantities: calculoElaboracionesForm.figuras,
      figures: figurasProducibles,
      subrecipes: db.subrecetas || [],
      subrecipeIngredients: db.subreceta_ingredientes || [],
      fillingRules: db.figura_relleno || [],
      inventory: db.inventory_items || [],
      inventoryLots: db.inventory_lots || [],
      inventoryLotsReady: db.inventoryLotsReady === true,
      today: hoyISO(),
    }), [calculoElaboracionesForm, figurasProducibles, db.subrecetas, db.subreceta_ingredientes, db.figura_relleno, db.inventory_items, db.inventory_lots, db.inventoryLotsReady]);
    const detalleLoteInsumos = useMemo(() => calculateProductionInputPreview({
      flavor: detalleLote?.sabor || "",
      quantities: detalleLote?.figuras?.length ? detalleLote.figuras : [{ figura: detalleLote?.figura || "", cant: detalleLote?.prod || 0 }],
      figures: figurasProducibles,
      subrecipes: db.subrecetas || [],
      subrecipeIngredients: db.subreceta_ingredientes || [],
      fillingRules: db.figura_relleno || [],
      inventory: db.inventory_items || [],
      inventoryLots: db.inventory_lots || [],
      inventoryLotsReady: db.inventoryLotsReady === true,
      today: hoyISO(),
    }), [detalleLote, figurasProducibles, db.subrecetas, db.subreceta_ingredientes, db.figura_relleno, db.inventory_items, db.inventory_lots, db.inventoryLotsReady]);
    const detalleLoteGuia = useMemo(() => buildFigureBatchPreparationGuide({
      batch: detalleLote || {},
      preview: detalleLoteInsumos,
      figures: figurasProducibles,
      subrecipes: db.subrecetas || [],
      fillingRules: db.figura_relleno || [],
    }), [detalleLote, detalleLoteInsumos, figurasProducibles, db.subrecetas, db.figura_relleno]);

    // ── Componentes + BOM (hito 2): preparar bases/subrecetas ──
    const [prepBase, setPrepBase] = useState(false);
    const prepIdemKeyRef = useRef(null); // 1 por apertura del form (mismo patrón que corridaIdemKeyRef)
    const [prepForm, setPrepForm] = useState({ subrecetaId: "", nominal: 1000, obtenidos: "", obtenidosTocado: false, resp: "", obs: "" });
    const [detallePreparacionId, setDetallePreparacionId] = useState(null);
    const [detalleCantidadFinal, setDetalleCantidadFinal] = useState(300);
    const [enviandoPrep, setEnviandoPrep] = useState(false);
    const [fichaEditorId, setFichaEditorId] = useState(null);
    const [recetarioOpen, setRecetarioOpen] = useState(false);
    const [recetarioProductId, setRecetarioProductId] = useState(null);
    const recetarioFocusConsumidoRef = useRef("");
    const subrecetasActivas = useMemo(() => (db.subrecetas || []).filter((sr) => sr.activo), [db.subrecetas]);
    useEffect(() => {
      const subrecipeId = focus?.subrecipeId;
      if (!subrecipeId || !subrecetasActivas.some((subrecipe) => subrecipe.id === subrecipeId)) return;
      if (focus?.manageKitchenSheet) {
        if (canOperateStage(perfil, "Cocina")) setFichaEditorId(subrecipeId);
        return;
      }
      abrirPrepararBase(subrecipeId);
    }, [focus?.subrecipeId, focus?.manageKitchenSheet, perfil]);
    useEffect(() => {
      const productId = focus?.productId;
      if (!productId || !focus?.manageProductRecipe) {
        recetarioFocusConsumidoRef.current = "";
        return;
      }
      const focusKey = String(productId);
      if (recetarioFocusConsumidoRef.current === focusKey
        || !(db.products || []).some((product) => String(product.id) === focusKey)) return;
      recetarioFocusConsumidoRef.current = focusKey;
      setRecetarioProductId(productId);
      setRecetarioOpen(true);
    }, [focus?.productId, focus?.manageProductRecipe, db.products]);
    const itemDe = useMemo(() => { const m = {}; db.inventory_items.forEach((i) => { m[i.id] = i; }); return m; }, [db.inventory_items]);
    const prepSel = subrecetasActivas.find((sr) => sr.id === prepForm.subrecetaId) || null;
    const detallePreparacion = subrecetasActivas.find((sr) => sr.id === detallePreparacionId) || null;
    const fichaPreparacion = subrecetasActivas.find((sr) => sr.id === fichaEditorId) || null;
    const puedeGestionarFicha = db.kitchenProcedureManagementReady === true && canOperateStage(perfil, "Cocina");
    const prepGuia = useMemo(() => buildSubrecipePreparationGuide(prepSel || {}), [prepSel]);
    const detallePreparacionGuia = useMemo(() => buildSubrecipePreparationGuide(detallePreparacion || {}), [detallePreparacion]);
    const detalleFormula = useMemo(() => calculateSubrecipeBatch({
      subrecipe: detallePreparacion,
      ingredients: db.subreceta_ingredientes || [],
      inventory: db.inventory_items || [],
      inventoryLots: db.inventory_lots || [],
      inventoryLotsReady: db.inventoryLotsReady === true,
      today: hoyISO(),
      desiredOutputGrams: detalleCantidadFinal,
    }), [detallePreparacion, detalleCantidadFinal, db.subreceta_ingredientes, db.inventory_items, db.inventory_lots, db.inventoryLotsReady]);
    function cantidadPreparacionTexto(unidad, cantidad) {
      const value = +cantidad || 0;
      if (unidad === "kg" && value < 1) return `${Math.round(value * 10000) / 10} g`;
      if (unidad === "L" && value < 1) return `${Math.round(value * 10000) / 10} ml`;
      return `${Math.round(value * 10000) / 10000} ${unidad}`.trim();
    }
    function abrirCalculadoraElaboraciones() {
      setCalculoElaboracionesForm({
        sabor: sabores[0] || "",
        figuras: Object.fromEntries(figurasProducibles.map((figure) => [figure.nombre, 0])),
      });
      setCalculadoraElaboraciones(true);
    }
    function abrirEditorFicha(subrecipe) {
      if (!subrecipe || !puedeGestionarFicha) return;
      setFichaEditorId(subrecipe.id);
    }
    function gramosCorridaTexto(cantidad) {
      return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(+cantidad || 0)} g`;
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
        const stockView = canonicalUsableIngredientStock(db, r.itemId, { today: hoyISO() });
        return {
          itemId: r.itemId, nombre: it ? it.nombre : r.itemId, unidad, req, reqTxt,
          stock: stockView.usable, stockFisico: stockView.physical, stockVencido: stockView.expired,
          alcanza: it ? stockView.usable >= req : false, costo: it ? req * it.costo : 0,
        };
      });
    }, [prepSel, prepForm.nominal, db.subreceta_ingredientes, db.inventory_items, db.inventory_lots, db.inventoryLotsReady, itemDe]);
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

    function puedeUsarMutacionProduccionDelta() {
      return db.productionMutationDeltaReady === true
        && typeof aplicarMutacionProduccion === "function"
        && typeof capturarContextoMutacionProduccion === "function";
    }

    async function aplicarMutacionProduccionORefrescar(envelope, context, onFail) {
      if (envelope && context && puedeUsarMutacionProduccionDelta()) {
        try {
          const applied = aplicarMutacionProduccion(envelope, context);
          if (applied?.status === "applied") return applied;
        } catch {
          // El servidor ya confirmo la escritura: reconciliar por lectura,
          // nunca repetir una mutacion ambigua.
        }
      }
      await refrescarSilencioso(onFail);
      return { status: "snapshot" };
    }

    async function sincronizarLote(lote, onFail) {
      try {
        if (lote?.productId && typeof sincronizarProductoTerminado === "function") {
          await sincronizarProductoTerminado([lote.productId]);
        } else {
          await refrescar();
        }
      } catch {
        onFail();
      }
    }

    function abrirDesechoVencido(row) {
      setDesechoVencido(row);
      setMotivoDesecho(`Vencimiento del lote ${row.sourceId} el ${row.expiry}`);
      setErrorDesecho("");
      desechoIdemKeyRef.current = createInventoryIdempotencyKey();
    }

    async function confirmarDesechoVencido() {
      if (!desechoVencido || enviandoDesecho) return;
      const motivo = motivoDesecho.trim();
      if (!motivo) {
        setErrorDesecho("Indicá el motivo para conservar la trazabilidad de la merma.");
        return;
      }
      setEnviandoDesecho(true);
      setErrorDesecho("");
      try {
        if (desechoVencido.kind === "finished") {
          if (db.finishedProductDisposalReady !== true || !puedeUsarMutacionProduccionDelta()) {
            throw new Error("Aplicá la migración H84 para habilitar el desecho trazable de producto terminado.");
          }
          const mutationContext = capturarContextoMutacionProduccion();
          const envelope = await desecharProductoTerminadoDelta({
            batchId: desechoVencido.sourceId,
            figura: desechoVencido.figure,
            motivo,
            cantidadEsperada: desechoVencido.quantity,
          }, desechoIdemKeyRef.current);
          await aplicarMutacionProduccionORefrescar(
            envelope,
            mutationContext,
            () => toast("alert", "El desecho se registró, pero la vista requiere una recarga."),
          );
          toast("ok", `✓ ${desechoVencido.quantity} und de ${desechoVencido.figure} desechadas`);
        } else if (["ingredient", "preparation"].includes(desechoVencido.kind) && desechoVencido.exactLot) {
          if (db.inventoryMutationDeltaReady && typeof aplicarDeltaInventario === "function"
              && typeof capturarGeneracionInventario === "function") {
            try {
              const generation = capturarGeneracionInventario();
              const envelope = await desecharLoteInsumoDelta(
                desechoVencido.sourceId,
                motivo,
                desechoIdemKeyRef.current,
              );
              const applied = aplicarDeltaInventario(envelope, generation);
              if (applied?.status !== "applied") await refrescar();
            } catch (error) {
              if (!isMissingRpcError(error)) throw error;
              await desecharLoteInsumo(desechoVencido.sourceId, motivo);
              await refrescar();
            }
          } else {
            await desecharLoteInsumo(desechoVencido.sourceId, motivo);
            await refrescar();
          }
          const mensajeDesecho = desechoVencido.kind === "ingredient"
            ? `✓ Insumo ${desechoVencido.name} retirado del inventario`
            : `✓ Elaboración ${desechoVencido.name} retirada del inventario`;
          toast("ok", mensajeDesecho);
        } else {
          throw new Error("Este saldo no tiene un lote exacto que pueda desecharse con trazabilidad.");
        }
        setDesechoVencido(null);
        setMotivoDesecho("");
        desechoIdemKeyRef.current = null;
      } catch (error) {
        setErrorDesecho(isMissingRpcError(error)
          ? (desechoVencido.kind === "finished"
            ? "Aplicá la migración H84 y recargá MOMO OPS para habilitar este desecho."
            : "Aplicá las migraciones H68 y H69 de lotes de Inventario y recargá MOMO OPS para habilitar este desecho.")
          : explainOperationalError(error, {
            inventory: db.inventory_items || [],
            subrecipes: db.subrecetas || [],
          }));
      } finally {
        setEnviandoDesecho(false);
      }
    }

    const kitchenProductionPlan = useMemo(() => buildKitchenProductionPlan({ ...db, figuras: figurasProducibles }, {
      today: hoyISO(), historyDays: 28, horizonDays: vidaUtilProductoTerminadoDias,
    }), [db, figurasProducibles, vidaUtilProductoTerminadoDias]);
    const plannedSuggestionIds = new Set(kitchenProductionPlan.plans.flatMap((plan) => plan.suggestionIds));
    const unplannedSuggestions = (db.production_suggestions || []).filter((suggestion) => suggestion.estado === "Pendiente"
      && suggestion.area !== "Inventario" && !plannedSuggestionIds.has(suggestion.id));

    // Producción e Inventario terminado comparten el mismo modelo exacto. Así las siete
    // figuras permanecen visibles aunque estén en cero y nunca se mezclan por familia.
    const inventarioTerminado = useMemo(() => buildFinishedInventory(db, { today: hoyISO() }), [db]);
    const detalleStockFigura = useMemo(() => inventarioTerminado.figureSummaries
      .find((figure) => figure.figura === detalleStockFiguraNombre) || null,
    [inventarioTerminado.figureSummaries, detalleStockFiguraNombre]);

    const controlVencimientos = useMemo(() => buildProductionExpiryControl({
      today: hoyISO(),
      inventoryLots: db.inventory_lots || [],
      inventoryItems: db.inventory_items || [],
      inventoryLotsReady: db.inventoryLotsReady === true,
      subrecipes: db.subrecetas || [],
      productionBatches: db.production_batches || [],
    }), [db.inventory_lots, db.inventory_items, db.inventoryLotsReady, db.subrecetas, db.production_batches]);

    // v2: con desmolde diferido, "perfectas" vale 0 mientras el lote está en proceso —
    // acá lo que importa es lo PRODUCIDO pendiente/en curso (prod). Se agrupa por
    // producto·sabor·gramaje (sin figura en la key: una corrida puede mezclar figuras
    // que caen en el mismo producto); la figura mostrada se deriva de la composición
    // y si el grupo junta figuras distintas se muestra "varias".
    const enProceso = useMemo(() => {
      const map = {};
      db.production_batches.filter(isActiveProductionBatch).forEach((l) => {
        const productId = l.productId || "";
        const productKey = productId || l.producto;
        const k = `${productKey} · ${l.sabor} · ${l.gramaje}`;
        const presentation = physicalBatchPresentation(l);
        const figureNames = presentation.figures.map((figure) => figure.figure);
        if (!map[k]) map[k] = {
          key: k, productId, producto: l.producto, sabor: l.sabor, gramaje: l.gramaje,
          figures: new Set(), cant: 0,
        };
        figureNames.forEach((figure) => map[k].figures.add(figure));
        map[k].cant += l.prod;
      });
      return Object.values(map).map((entry) => {
        const figures = [...entry.figures];
        return {
          ...entry,
          figura: figures.join(" · ") || "Sin figura exacta",
          primary: figures.length ? `${figures.join(" · ")} de ${entry.sabor || "sabor pendiente"}` : `Figura exacta pendiente · ${entry.sabor || "sin sabor"}`,
          secondary: `Presentación comercial: ${commercialFamilyLabel(entry.producto)}${entry.gramaje ? ` · ${entry.gramaje}` : ""}`,
        };
      });
    }, [db.production_batches]);

    // Foco de las cards → filtra la lista "Lotes" de abajo (panel accionable, no solo informativo).
    const [foco, setFoco] = useState(null); // {productId, producto} (stock) | {combo:true, productId, producto,sabor,gramaje} (en proceso)
    const lotesPorScope = scope === "active" ? batchBuckets.active : batchBuckets.history;
    const lotesFiltrados = useMemo(() => {
      if (!foco) return lotesPorScope;
      return lotesPorScope.filter((l) => foco.combo
        ? batchBelongsToFocus(l, foco) && l.sabor === foco.sabor && l.gramaje === foco.gramaje
        : batchBelongsToFocus(l, foco));
    }, [lotesPorScope, foco]);
    const focoLabel = foco ? (foco.combo ? `${foco.figura} de ${foco.sabor} · Presentación comercial: ${commercialFamilyLabel(foco.producto)}` : `Presentación comercial: ${commercialFamilyLabel(foco.producto)}`) : "";
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
          try {
            const compound = await completarCocinaYEntregarEmpaque(orderId, createInventoryIdempotencyKey());
            response = compound?.status;
          } catch (error) {
            if (!isMissingRpcError(error)) throw error;
            await completarEtapaPedido(orderId, "Cocina");
            response = await setOrderStatusRemoto(orderId, estado);
          }
        } else {
          response = await setOrderStatusRemoto(orderId, estado);
        }
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
      corridaCompoundIdemKeyRef.current = createInventoryIdempotencyKey();
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
      corridaCompoundIdemKeyRef.current = createInventoryIdempotencyKey();
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
      let mutationEnvelope = null;
      let compoundApplied = false;
      const mutationContext = puedeUsarMutacionProduccionDelta()
        ? capturarContextoMutacionProduccion() : null;
      try {
        if (suggestionIds.length) {
          try {
            const compound = await crearCorridaAgrupada(
              payload,
              suggestionIds,
              corridaCompoundIdemKeyRef.current || createInventoryIdempotencyKey(),
            );
            mutationEnvelope = compound?.production;
            compoundApplied = true;
            if (mutationContext) {
              const applied = await aplicarMutacionProduccionORefrescar(
                mutationEnvelope, mutationContext,
                () => setMsg("La producción se registró, pero la vista necesita recargarse."),
              );
              resultado = applied?.result || mutationEnvelope?.result;
            } else {
              resultado = mutationEnvelope?.result;
            }
          } catch (error) {
            if (!isMissingRpcError(error)) throw error;
          }
        }
        if (!compoundApplied && mutationContext) {
          mutationEnvelope = await crearCorridaDelta(payload);
          const applied = await aplicarMutacionProduccionORefrescar(
            mutationEnvelope, mutationContext,
            () => setMsg("La producción se registró, pero la vista necesita recargarse."),
          );
          resultado = applied?.result || mutationEnvelope?.result;
        } else if (!compoundApplied) {
          resultado = await crearCorrida(payload);
        }
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
      for (const suggestionId of compoundApplied ? [] : suggestionIds.slice(1)) {
        try { await setSugerenciaEstado(suggestionId, "Atendida"); }
        catch { suggestionUpdateFailures.push(suggestionId); }
      }
      const suggestionUpdates = compoundApplied ? [] : suggestionIds.filter((suggestionId, index) => (
        index === 0 || !suggestionUpdateFailures.includes(suggestionId)
      ));
      if (mutationContext && suggestionUpdates.length) {
        update((draft) => {
          draft.production_suggestions = (draft.production_suggestions || []).map((suggestion) => (
            suggestionUpdates.includes(suggestion.id) ? { ...suggestion, estado: "Atendida" } : suggestion
          ));
        }, { silencioso: true, persistir: false });
      }
      setRegistroError("");
      setEnviando(false);
      setNuevo(false); setPre(null);
      corridaIdemKeyRef.current = null; // fuerza una key nueva en la próxima apertura (abrirNuevaCorrida)
      corridaCompoundIdemKeyRef.current = null;
      toast("ok", `Corrida registrada${resultado && resultado.corrida_id ? ` (${resultado.corrida_id})` : ""}`);
      if (!mutationContext) {
        await refrescarSilencioso(() => setMsg("La producción se registró correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo."));
      }
      if (suggestionUpdateFailures.length) {
        setMsg(`La corrida quedó registrada, pero MOMOS OPS no pudo cerrar ${suggestionUpdateFailures.join(", ")}. No crees otra corrida: recarga y revisa esas recomendaciones.`);
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
      const mutationContext = puedeUsarMutacionProduccionDelta()
        ? capturarContextoMutacionProduccion() : null;
      try {
        if (mutationContext) {
          const envelope = await producirSubrecetaDelta(payload);
          const applied = await aplicarMutacionProduccionORefrescar(
            envelope, mutationContext,
            () => setMsg("La base se preparó, pero la vista necesita recargarse."),
          );
          resultado = applied?.result || envelope?.result;
        } else {
          resultado = await producirSubreceta(payload);
        }
      } catch (e) {
        toast("error", "No se pudo registrar la preparación: " + e.message);
        setEnviandoPrep(false);
        return;
      }
      setEnviandoPrep(false);
      setPrepBase(false);
      prepIdemKeyRef.current = null; // fuerza key nueva en la próxima apertura
      toast("ok", `${prepSel.nombre} preparado · inventario actualizado${vidaUtilMezclasDias ? ` · vence ${dISO(vidaUtilMezclasDias)}` : ""}`);
      if (!mutationContext) {
        await refrescarSilencioso(() => setMsg("La base se preparó correctamente, pero no se pudo actualizar la vista. Recargá la página para verla."));
      }
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
      await sincronizarLote(l, () => toast("alert", "El estado del lote cambió, pero no se pudo actualizar la vista. Recargá la página."));
      setEnviandoBatchId(null);
    }

    async function confirmarDesmolde() {
      const { batchId, perfectas, imperfectas, descartadas } = desmolde;
      const lote = (db.production_batches || []).find((item) => item.id === batchId);
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
      toast("ok", `Lote desmoldado · stock actualizado · vence ${dISO(vidaUtilProductoTerminadoDias)}`);
      await sincronizarLote(lote, () => setMsg("El lote se desmoldó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo."));
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
      await sincronizarLote(lote, () => toast("alert", "El lote empezó a congelar, pero no se pudo actualizar la vista. Recargá la página."));
      setEnviandoBatchId(null);
    }

    async function convertirImperfectasLote(lote) {
      setEnviandoBatchId(lote.id);
      const mutationContext = puedeUsarMutacionProduccionDelta()
        ? capturarContextoMutacionProduccion() : null;
      let envelope = null;
      try {
        if (mutationContext) {
          let idempotencyKey = imperfectasIdemKeysRef.current.get(lote.id);
          if (!idempotencyKey) {
            idempotencyKey = createInventoryIdempotencyKey();
            imperfectasIdemKeysRef.current.set(lote.id, idempotencyKey);
          }
          envelope = await convertirImperfectasDelta(lote.id, idempotencyKey);
          await aplicarMutacionProduccionORefrescar(
            envelope, mutationContext,
            () => toast("alert", "Las imperfectas se convirtieron, pero la vista necesita recargarse."),
          );
          imperfectasIdemKeysRef.current.delete(lote.id);
        } else {
          await convertirImperfectas(lote.id);
        }
      } catch (error) {
        toast("error", "No se pudieron convertir las imperfectas: " + error.message);
        setEnviandoBatchId(null);
        return;
      }
      toast("ok", `${lote.imperfectas} imperfectas del lote ${lote.id} → insumo`);
      if (!mutationContext) {
        await refrescarSilencioso(() => toast("alert", "Las imperfectas se convirtieron, pero no se pudo actualizar la vista. Recargá la página."));
      }
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
        <div className="mb-4 flex gap-2 flex-wrap"><Btn onClick={abrirNuevaCorrida}>＋ Nueva corrida</Btn>{subrecetasActivas.length > 0 && <Btn kind="soft" onClick={() => abrirPrepararBase()}>🥣 Preparar elaboración</Btn>}<Btn kind="ghost" onClick={() => { setRecetarioProductId(null); setRecetarioOpen(true); }}>📖 Recetario de Cocina</Btn></div>

        {kitchenProductionPlan.integrityIssues.length > 0 && (
          <div data-testid="production-plan-integrity-alert" role="alert" className="rounded-2xl px-4 py-3 mb-4" style={{ background: "#FFF2EF", border: "1px solid #E8B7AD", color: "#8F3528" }}>
            <div className="text-[10px] uppercase tracking-[.12em] font-extrabold">⚠ Corridas bloqueadas por datos inconsistentes</div>
            <div className="text-xs font-bold mt-1">{kitchenProductionPlan.integrityIssues.length} línea{kitchenProductionPlan.integrityIssues.length === 1 ? "" : "s"} relacionan una figura física con una presentación comercial distinta a la configurada.</div>
            <div className="text-[11px] font-semibold mt-1">Revisá la figura y su familia comercial en {kitchenProductionPlan.integrityIssues.map((issue) => issue.sourceId || issue.figure).filter(Boolean).join(" · ")}. Estas líneas no se incluyen en una corrida.</div>
          </div>
        )}

        <KitchenProductionAssistantFab
          plan={kitchenProductionPlan}
          unplannedSuggestions={unplannedSuggestions}
          formatAmount={cantidadPreparacionTexto}
          onPlanRun={abrirDesdePlanProduccion}
          onPrepare={abrirPrepararBase}
        />

        <section data-testid="finished-product-stock-summary">
          <SectionTitle>📦 Resumen de figuras terminadas</SectionTitle>
          <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>La comparación es la misma de Inventario terminado: una tarjeta por figura física, incluso con cero unidades. Solo suma existencias vigentes con figura + sabor trazables y lote verificable.</div>
          <FinishedFigureCards figureSummaries={inventarioTerminado.figureSummaries} products={db.products} Card={Card} Empty={Empty} T={T} onOpen={setDetalleStockFiguraNombre} />
        </section>

        {detalleStockFigura && <Modal title={`Figura terminada · ${detalleStockFigura.figura}`} onClose={() => setDetalleStockFiguraNombre(null)} wide>
          <div data-testid="finished-product-stock-detail">
            <FinishedFigureDetailContent figure={detalleStockFigura} products={db.products} Card={Card} Stat={Stat} T={T} />
            <div className="flex justify-end mt-4"><Btn kind="ghost" onClick={() => setDetalleStockFiguraNombre(null)}>Cerrar</Btn></div>
          </div>
        </Modal>}

        <section data-testid="production-expiry-control" className="mt-5">
          <SectionTitle>⏳ Control de vencimientos de Cocina</SectionTitle>
          <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>Alertas a 5 días para insumos, elaboraciones y producto terminado. MOMO OPS prioriza por FEFO, conserva los vencidos en cuarentena y nunca borra existencias automáticamente.</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
            {[
              ["Vencidos", controlVencimientos.summary.expired, "#A03B2A", "#F6D4CD"],
              ["Vencen hoy", controlVencimientos.summary.today, "#A54830", "#FBE0D7"],
              ["En 1–2 días", controlVencimientos.summary.urgent, "#7B5410", "#FBE8C8"],
              ["En 3–5 días", controlVencimientos.summary.soon, "#315D36", "#E8F1E5"],
              ["Sin fecha", controlVencimientos.summary.missing, "#63518A", "#E8E1F1"],
            ].map(([label, value, color, background]) => <div key={label} className="rounded-xl p-3" style={{ background }}><div className="display text-2xl" style={{ color }}>{value}</div><div className="text-[9px] uppercase font-extrabold" style={{ color }}>{label} · lotes</div></div>)}
          </div>
          <div className="grid lg:grid-cols-3 gap-3 mb-4">
            {[
              ["ingredient", "🧺 Insumos", "Materia prima por lote"],
              ["preparation", "🥣 Elaboraciones", "Bases preparadas en Cocina"],
              ["finished", "🍮 Producto terminado", "Figura + sabor + lote"],
            ].map(([kind, title, subtitle]) => {
              const rows = controlVencimientos.byKind[kind];
              return <div key={kind} className="rounded-2xl overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.border}` }}><div className="px-4 py-3" style={{ background: T.vainilla }}><div className="font-extrabold text-sm">{title}</div><div className="text-[10px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{subtitle}</div></div><div className="divide-y" style={{ borderColor: T.border }}>{rows.slice(0, 8).map((row) => {
                const meta = EXPIRY_META[row.priority] || EXPIRY_META.missing;
                const detail = row.kind === "finished" ? `${row.figure} · ${row.flavor}${row.grams ? ` · ${row.grams}` : ""}` : `${row.exactLot ? `Lote ${row.sourceId}` : "Saldo histórico sin lote"}${row.location ? ` · ${row.location}` : ""}`;
                const canDiscard = row.priority === "expired" && row.exactLot
                  && ["ingredient", "preparation", "finished"].includes(row.kind)
                  && (row.kind !== "finished" || db.finishedProductDisposalReady === true);
                return <div key={row.id} className="px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><div className="text-xs font-extrabold leading-snug">{row.name}</div><div className="text-[10px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{detail}</div>{row.integrityWarning && <div className="text-[10px] font-extrabold mt-1" style={{ color: "#A03B2A" }}>{row.integrityWarning}</div>}</div>
                    <div className="text-right shrink-0"><div className="font-extrabold text-xs">{cantidadPreparacionTexto(row.unit, row.quantity)}</div><div className="text-[9px] font-bold mt-0.5" style={{ color: T.choco2 }}>{row.expiry || "sin fecha"}</div></div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <span className="inline-block rounded-full px-2 py-1 text-[9px] uppercase font-extrabold" style={{ background: meta.bg, color: meta.fg }}>{expiryLabel(row)}</span>
                    {canDiscard && <Btn small kind="danger" onClick={() => abrirDesechoVencido(row)}>Desechar</Btn>}
                  </div>
                </div>;
              })}{rows.length === 0 && <div className="p-4"><Empty icon="✓" text="Sin alertas en los próximos 5 días." /></div>}{rows.length > 8 && <div className="px-3 py-2 text-[10px] font-bold" style={{ color: T.choco2 }}>+ {rows.length - 8} lotes adicionales por revisar</div>}</div></div>;
            })}
          </div>
          <div className="rounded-xl px-3 py-2 text-[11px] font-bold" style={{ background: "#FFF1D6", color: "#7B5410" }}>Regla operativa: vencido = cuarentena y no uso; sin fecha = completar el dato antes de consumir. Cocina puede desechar aquí insumos, elaboraciones y producto terminado vencidos cuando existe un lote exacto; el motivo queda trazado.</div>
        </section>

        {desechoVencido && <Modal title="Desechar vencido" onClose={() => { if (!enviandoDesecho) setDesechoVencido(null); }}>
          <div data-testid="production-expired-disposal-modal">
            <div className="rounded-2xl p-4 mb-4" style={{ background: "#FFF1ED", border: "1px solid #E9A08F" }}>
              <div className="text-xs font-extrabold uppercase tracking-[.12em]" style={{ color: "#A03B2A" }}>Merma exacta y trazable</div>
              <div className="display text-xl mt-1" style={{ color: T.choco }}>{desechoVencido.name}</div>
              <div className="text-sm mt-1" style={{ color: T.choco2 }}>
                Se retirarán <b>{cantidadPreparacionTexto(desechoVencido.unit, desechoVencido.quantity)}</b> del lote <b>{desechoVencido.sourceId}</b>
                {desechoVencido.kind === "finished" ? ` · ${desechoVencido.figure} · ${desechoVencido.flavor}` : ""}. Las reservas existentes no se tocan y la salida quedará en el historial.
              </div>
            </div>
            <Field label="Motivo del desecho"><Input value={motivoDesecho} onChange={(event) => setMotivoDesecho(event.target.value)} placeholder="Ej: vencimiento, cadena de frío, olor o textura alterada" /></Field>
            {errorDesecho && <div role="alert" className="rounded-xl px-3 py-2 mt-3 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{errorDesecho}</div>}
            <div className="flex gap-2 mt-4">
              <BtnAsync kind="danger" disabled={enviandoDesecho} textoEnVuelo="Desechando…" onClick={confirmarDesechoVencido}>Confirmar desecho</BtnAsync>
              <Btn kind="ghost" disabled={enviandoDesecho} onClick={() => setDesechoVencido(null)}>Conservar lote</Btn>
            </div>
          </div>
        </Modal>}

        {subrecetasActivas.length > 0 && (
          <>
            <SectionTitle action={<Btn small kind="soft" onClick={abrirCalculadoraElaboraciones}>🧮 Calcular por figuras</Btn>}>🥣 Elaboraciones internas preparadas</SectionTitle>
            <div className="text-xs font-semibold mb-2" style={{ color: T.choco2 }}>Mousses por sabor, cheesecake, ganache y salsas se elaboran en Cocina: consumen su receta, registran rendimiento y alimentan este stock. Nunca entran como compra.</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
              {subrecetasActivas.map((sr) => {
                const it = itemDe[sr.itemId];
                const stockView = canonicalUsableIngredientStock(db, sr.itemId, { today: hoyISO() });
                const ult = ultimaPrepDe[sr.id];
                const formulaRows = (db.subreceta_ingredientes || []).filter((row) => row.subrecetaId === sr.id);
                return (
                  <Card key={sr.id} aria-label={`Ver receta de ${sr.nombre}`} className="p-3" onClick={() => { setDetalleCantidadFinal(300); setDetallePreparacionId(sr.id); }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold leading-snug">{sr.nombre}</div>
                      <div className="display text-xl shrink-0" style={{ color: it && stockView.usable > 0 ? "#3F6B42" : "#A03B2A" }}>{it ? stockView.usable : "—"}</div>
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

        {calculadoraElaboraciones && (() => {
          const totalUnidades = calculoElaboraciones.totalUnits;
          return (
            <Modal title="🧮 Calculadora de elaboraciones por figuras" onClose={() => setCalculadoraElaboraciones(false)} wide>
              <div data-testid="elaboration-by-figures-calculator">
                <div className="rounded-2xl p-4 mb-3" style={{ background: "#F7F4FB", border: "1px solid #D8CEE5" }}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: "#63518A" }}>Simulador de Cocina</div><div className="font-bold text-sm mt-1">Decidí cuántas figuras vas a producir y MOMO OPS calculará todas las elaboraciones.</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Este cálculo no crea lotes, no descuenta inventario y puede usarse solo para planear las bases; la corrida real se registra aparte.</div></div>
                    <div className="min-w-[210px]"><label className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Sabor de la mousse</label><select value={calculoElaboracionesForm.sabor} onChange={(event) => setCalculoElaboracionesForm({ ...calculoElaboracionesForm, sabor: event.target.value })} className="w-full rounded-xl px-3 py-2 mt-1 text-sm border" style={inputStyle}>{sabores.map((sabor) => <option key={sabor} value={sabor}>{sabor}</option>)}</select></div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
                  {figurasProducibles.map((figure) => <div key={figure.nombre} className="flex items-center justify-between gap-2 p-3 rounded-xl" style={{ background: T.vainilla }}>
                    <div className="text-xs font-semibold">{physicalFigureIcon(figure.especie)} {figure.nombre}<div className="text-[10px] font-normal" style={{ color: T.choco2 }}>{figure.gramajeG} g por unidad</div></div>
                    <div className="flex items-center gap-1.5">
                      <button type="button" aria-label={`Restar una unidad de ${figure.nombre} en calculadora`} onClick={() => setCalculoElaboracionesForm({ ...calculoElaboracionesForm, figuras: { ...calculoElaboracionesForm.figuras, [figure.nombre]: Math.max(0, (+calculoElaboracionesForm.figuras[figure.nombre] || 0) - 1) } })} className="w-7 h-7 rounded-full font-bold" style={{ background: T.surface, border: `1px solid ${T.border}` }}>−</button>
                      <input aria-label={`Cantidad de ${figure.nombre} en calculadora`} type="number" min="0" step="1" value={calculoElaboracionesForm.figuras[figure.nombre] ?? 0} onChange={(event) => setCalculoElaboracionesForm({ ...calculoElaboracionesForm, figuras: { ...calculoElaboracionesForm.figuras, [figure.nombre]: Math.max(0, parseInt(event.target.value, 10) || 0) } })} className="w-12 text-center rounded-lg px-1 py-1 text-sm border" style={inputStyle} />
                      <button type="button" aria-label={`Agregar una unidad de ${figure.nombre} en calculadora`} onClick={() => setCalculoElaboracionesForm({ ...calculoElaboracionesForm, figuras: { ...calculoElaboracionesForm.figuras, [figure.nombre]: (+calculoElaboracionesForm.figuras[figure.nombre] || 0) + 1 } })} className="w-7 h-7 rounded-full font-bold" style={{ background: T.surface, border: `1px solid ${T.border}` }}>+</button>
                    </div>
                  </div>)}
                </div>

                {totalUnidades === 0 ? <div className="rounded-2xl p-5 mb-3 text-center text-sm font-semibold" style={{ background: T.vainilla, color: T.choco2 }}>Agregá las cantidades de las figuras para calcular mousse, cheesecake, ganache e ingredientes.</div> : calculoElaboraciones.errors.length > 0 ? <div className="rounded-2xl p-4 mb-3" style={{ background: "#FFF2EF" }}>{calculoElaboraciones.errors.map((error) => <div key={`${error.code}-${error.figure || error.message}`} className="text-xs font-bold py-1" style={{ color: "#A03B2A" }}>⚠ {error.message}</div>)}</div> : <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    {[["Figuras", totalUnidades, T.coral], ["Peso final", gramosCorridaTexto(calculoElaboraciones.totalProductGrams), "#63518A"], ["Mousse", gramosCorridaTexto(calculoElaboraciones.mousseOutputGrams), "#3F6B42"], ["Rellenos", gramosCorridaTexto(calculoElaboraciones.totalFillingGrams), "#96690F"]].map(([label, value, color]) => <div key={label} className="rounded-xl p-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-xl mt-1" style={{ color }}>{value}</div></div>)}
                  </div>

                  <div className="rounded-2xl overflow-hidden mb-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                    <div className="px-4 py-3" style={{ background: "#E8F1E5" }}><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: "#3F6B42" }}>Elaboraciones necesarias</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Resultado terminado que debe estar disponible para fabricar las figuras.</div></div>
                    {calculoElaboraciones.preparations.map((preparation) => <button type="button" aria-label={`Ver ingredientes para ${gramosCorridaTexto(preparation.outputGrams)} de ${preparation.name}`} key={preparation.subrecipeId} onClick={() => { setCalculadoraElaboraciones(false); setDetalleCantidadFinal(preparation.outputGrams); setDetallePreparacionId(preparation.subrecipeId); }} className="w-full text-left grid sm:grid-cols-[minmax(0,1fr)_130px_170px] gap-2 items-center px-4 py-3 border-t transition hover:bg-[#FFF9F2] focus:outline-none focus:ring-2 focus:ring-inset" style={{ borderColor: T.border, '--tw-ring-color': T.coral }}><div><div className="font-bold text-sm">{preparation.name}</div><div className="text-[10px] font-semibold mt-0.5" style={{ color: T.choco2 }}>Disponible: {cantidadPreparacionTexto(preparation.unit, preparation.currentStock)}{preparation.enough ? " · suficiente" : ` · faltan ${cantidadPreparacionTexto(preparation.unit, preparation.shortage)}`}</div></div><div className="sm:text-right"><div className="display text-xl" style={{ color: preparation.enough ? "#3F6B42" : "#A03B2A" }}>{gramosCorridaTexto(preparation.outputGrams)}</div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>necesarios</div></div><div className="sm:text-right"><span className="inline-block text-[10px] uppercase font-extrabold px-2.5 py-1 rounded-full" style={{ background: preparation.enough ? "#E6F1E3" : "#FBE8C8", color: preparation.enough ? "#3F6B42" : "#96690F" }}>{preparation.enough ? "Ya disponible" : "Falta preparar"}</span><div className="text-[10px] font-extrabold mt-1" style={{ color: T.coral }}>Ver ingredientes y pasos ›</div></div></button>)}
                  </div>

                  <div className="rounded-2xl overflow-hidden mb-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                    <div className="px-4 py-3" style={{ background: T.vainilla }}><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.choco2 }}>Materia prima agregada</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Para producir desde cero todas las elaboraciones anteriores, con sus mermas incluidas.</div></div>
                    <div className="max-h-60 overflow-y-auto">{calculoElaboraciones.ingredients.map((ingredient) => <div key={ingredient.itemId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2.5 border-t text-xs" style={{ borderColor: T.border }}><div><div className="font-bold">{ingredient.name}</div><div className="text-[10px]" style={{ color: T.choco2 }}>Hay {cantidadPreparacionTexto(ingredient.unit, ingredient.stock)}</div></div><div className="text-right"><div className="font-extrabold" style={{ color: ingredient.enough ? T.choco : "#A03B2A" }}>{cantidadPreparacionTexto(ingredient.unit, ingredient.requiredQuantity)}</div>{!ingredient.enough && <div className="text-[9px] font-bold" style={{ color: "#A03B2A" }}>Faltan {cantidadPreparacionTexto(ingredient.unit, ingredient.shortage)}</div>}</div></div>)}</div>
                  </div>
                </>}

                <div className="flex justify-end"><Btn kind="ghost" onClick={() => setCalculadoraElaboraciones(false)}>Cerrar</Btn></div>
              </div>
            </Modal>
          );
        })()}

        {detallePreparacion && (
          <Modal title={`Receta · ${detallePreparacion.nombre}`} onClose={() => setDetallePreparacionId(null)} wide>
            <div className="rounded-2xl p-4 mb-3" style={{ background: T.soft, border: `1px solid ${T.border}` }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Guía de preparación de cocina</div><div className="display text-xl font-semibold mt-1">{detallePreparacion.nombre}</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Fórmula maestra registrada por cada 1.000 g antes de merma.</div></div>
                <div className="flex flex-wrap gap-2"><span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: T.rosa, color: "#8E4B5A" }}>{detallePreparacion.tipo.replaceAll("_", " ")}</span><span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: detalleFormula.completeFormula ? "#E6F1E3" : "#F6D4CD", color: detalleFormula.completeFormula ? "#3F6B42" : "#A03B2A" }}>{detalleFormula.components.length} insumos</span></div>
              </div>
              <div className="grid sm:grid-cols-[minmax(0,1fr)_220px] gap-3 items-end mt-4">
                <div><label className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Cantidad final que Cocina necesita</label><div className="text-xs mt-1" style={{ color: T.choco2 }}>Ejemplo: 300 g de {detallePreparacion.nombre} ya terminados y utilizables.</div></div>
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

            <div className="mt-3"><PreparationSteps guide={detallePreparacionGuia} title="Procedimiento de esta elaboración" testId="subrecipe-recipe-steps" /></div>

            {!detalleFormula.canPrepare && detalleFormula.completeFormula && <div className="rounded-xl px-3 py-2.5 mt-3 text-xs font-bold" style={{ background: "#FBE8C8", color: "#96690F" }}>La receta está completa, pero uno o más insumos no alcanzan. Podés abrir el registro para planear la tanda; MOMOS OPS dejará trazado el faltante.</div>}
            <div className="flex flex-wrap justify-between gap-2 mt-4">
              <div className="text-[10px] font-semibold max-w-sm" style={{ color: T.choco2 }}>La fórmula y sus pasos se administran aquí, dentro del Recetario de Cocina de Producción.</div>
              <div className="flex flex-wrap justify-end gap-2"><Btn kind="ghost" onClick={() => setDetallePreparacionId(null)}>Cerrar</Btn>{puedeGestionarFicha && <Btn kind="soft" onClick={() => { const selected = detallePreparacion; setDetallePreparacionId(null); abrirEditorFicha(selected); }}>✎ Gestionar fórmula y pasos</Btn>}<Btn disabled={!detalleFormula.completeFormula || detalleFormula.desiredOutputGrams <= 0} onClick={() => { const subrecipeId = detallePreparacion.id; const nominal = detalleFormula.nominalInputGrams; setDetallePreparacionId(null); abrirPrepararBase(subrecipeId, nominal); }}>🥣 Preparar esta cantidad</Btn></div>
            </div>
          </Modal>
        )}

        {fichaPreparacion && <InternalPreparationSheetEditor db={db} subrecipe={fichaPreparacion} perfil={perfil} refrescar={refrescar} onClose={() => setFichaEditorId(null)} ui={{ T, Badge, Btn, BtnAsync, Card, Field, Input, Modal, inputStyle, toast }} />}

        <KitchenRecipeCenter
          db={db}
          perfil={perfil}
          open={recetarioOpen}
          initialProductId={recetarioProductId}
          onClose={() => { setRecetarioOpen(false); setRecetarioProductId(null); }}
          onOpenPreparationSheet={(subrecipe) => { setRecetarioOpen(false); setRecetarioProductId(null); abrirEditorFicha(subrecipe); }}
          refrescar={refrescar}
          aplicarMutacionCatalogoCrm={aplicarMutacionCatalogoCrm}
          capturarContextoMutacionCatalogoCrm={capturarContextoMutacionCatalogoCrm}
          ui={{ T, Badge, Btn, BtnAsync, Card, Empty, Field, Input, Modal, fmt, inputStyle, recipeCost, recipeLines, toast }}
        />

        <SectionTitle>🧊 Lotes en proceso (aún no disponibles)</SectionTitle>
        <div className="text-xs font-semibold mb-2" style={{ color: T.choco2 }}>Congelando o en preparación. No suman al stock operativo hasta pasar a "Listo".</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
          {enProceso.map((e) => (
            <Card key={e.key} className="p-3 flex items-center justify-between gap-2" onClick={() => enfocarLotes({ combo: true, productId: e.productId, producto: e.producto, sabor: e.sabor, figura: e.figura, gramaje: e.gramaje })}>
              <div className="text-xs font-semibold leading-snug"><div className="font-extrabold">{e.primary}</div><div className="text-[10px] mt-1" style={{ color: T.choco2 }}>{e.secondary}</div></div>
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
            const presentation = physicalBatchPresentation(l);
            return (
              <Card key={l.id} aria-label={`Abrir detalle del lote ${l.id}`} className="momo-queue-item p-4" onClick={() => setDetalleLoteId(l.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.choco2 }}>Lote {l.id}</div>
                    <div className="font-bold text-sm mt-1">{presentation.primary}</div>
                    <div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>{presentation.secondary}</div>
                  </div>
                  <Badge label={l.estado} />
                </div>
                <div className="flex items-end justify-between gap-3 mt-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold" style={{ color: T.choco2 }}>{presentation.composition || "Sin figura física exacta"}</div>
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
              <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Trazabilidad física del lote</div><div className="display text-xl font-semibold mt-1">{physicalBatchPresentation(detalleLote).primary}</div><div className="text-xs font-bold mt-1" style={{ color: T.choco2 }}>{physicalBatchPresentation(detalleLote).secondary}</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{detalleLote.fecha} · Responsable: {detalleLote.resp || "Sin asignar"}</div></div>
              <div className="flex gap-2 flex-wrap"><Badge label={detalleLote.estado} />{detalleLote.corridaId && <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: T.vainilla, color: "#63518A" }}>Corrida {detalleLote.corridaId}</span>}</div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[["Producidas", detalleResultado?.produced || 0, T.coral], ["Perfectas", detalleResultado?.perfect || 0, "#3F6B42"], ["Imperfectas", detalleResultado?.imperfect || 0, "#96690F"], ["Descartadas", detalleResultado?.discarded || 0, "#A03B2A"]].map(([label, value, color]) => <div key={label} className="rounded-2xl p-3" style={{ background: T.surface, border: `1px solid ${T.border}` }}><div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-2xl mt-1" style={{ color }}>{value}</div></div>)}
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
                <div className="text-sm space-y-2"><div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Merma bruta</span><b style={{ color: detalleMerma > 0.15 ? "#A03B2A" : "#3F6B42" }}>{pct(detalleMerma)}{detalleMerma > 0.15 ? " · revisar" : ""}</b></div><div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Descarte definitivo</span><b>{detalleResultado?.definitiveLossUnits || 0} · {pct(detalleResultado?.definitiveLossRate || 0)}</b></div><div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Destino imperfectas</span><b className="text-right">{detalleLote.destino && detalleLote.destino !== "—" ? detalleLote.destino : "Pendiente"}</b></div><div className="flex justify-between gap-3"><span style={{ color: T.choco2 }}>Stock contabilizado</span><b>{detalleLote.stockContabilizado ? "Sí" : "No"}</b></div></div>
              </div>

              <div className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                <div className="text-[10px] uppercase tracking-[.12em] font-extrabold mb-3" style={{ color: T.choco2 }}>Vencimiento y observaciones</div>
                <div className="text-sm font-bold">{!isActiveProductionBatch(detalleLote) && detalleLote.vence ? `Vence ${detalleLote.vence} · fecha sellada al desmolde` : `Vence ${vidaUtilProductoTerminadoDias} días después del desmolde`}</div>
                <div className="text-xs mt-3" style={{ color: T.choco2 }}>{detalleLote.obs ? `📝 ${detalleLote.obs}` : "Sin observaciones registradas."}</div>
              </div>

              {detalleLote.estado === "En preparación" && <div data-testid="active-batch-preparation-guide" className="rounded-2xl overflow-hidden lg:col-span-2" style={{ background: T.surface, border: `1px solid ${detalleLoteGuia.ready ? "#C9DDC4" : "#E8B7AD"}` }}>
                <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" style={{ background: detalleLoteGuia.ready ? "#E8F1E5" : "#FFF2EF" }}>
                  <div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: detalleLoteGuia.ready ? "#3F6B42" : "#A03B2A" }}>Orden de preparación del lote</div><div className="font-bold text-sm mt-1">Cantidades y secuencia para {detalleLote.id}</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Las bases se descontaron al registrar el lote; esta es la hoja operativa que debe seguir Cocina antes de iniciar la congelación.</div></div>
                  <span className="text-[10px] uppercase font-extrabold px-2.5 py-1 rounded-full" style={{ background: T.surface, color: detalleLoteGuia.ready ? "#3F6B42" : "#A03B2A" }}>{detalleLoteGuia.ready ? "Datos completos" : "Revisar catálogo"}</span>
                </div>
                {detalleLoteGuia.ready ? <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[['Unidades', detalleLoteInsumos.totalUnits, T.coral], ['Peso final', gramosCorridaTexto(detalleLoteInsumos.totalProductGrams), '#63518A'], ['Mousse', gramosCorridaTexto(detalleLoteInsumos.mousseOutputGrams), '#3F6B42'], ['Rellenos', gramosCorridaTexto(detalleLoteInsumos.totalFillingGrams), '#96690F']].map(([label, value, color]) => <div key={label} className="rounded-xl p-2.5" style={{ background: T.vainilla }}><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-lg mt-0.5" style={{ color }}>{value}</div></div>)}
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-[.12em] font-extrabold mb-2" style={{ color: T.choco2 }}>Dosificación por figura</div>
                    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
                      {detalleLoteGuia.rows.map((row) => <div key={row.figure} className="grid sm:grid-cols-[minmax(0,1fr)_repeat(3,120px)] gap-2 items-center px-3 py-2.5 border-t first:border-t-0 text-xs" style={{ borderColor: T.border }}><div className="font-extrabold">{row.quantity}× {row.figure}</div><div><span style={{ color: T.choco2 }}>Mousse/unidad</span><div className="font-bold">{gramosCorridaTexto(row.mousseGramsPerUnit)}</div></div><div><span style={{ color: T.choco2 }}>Relleno/unidad</span><div className="font-bold">{gramosCorridaTexto(row.fillingGramsPerUnit)}</div></div><div><span style={{ color: T.choco2 }}>Peso final</span><div className="font-bold">{gramosCorridaTexto(row.finalGramsPerUnit)}</div></div></div>)}
                    </div>
                  </div>

                  <div className="grid lg:grid-cols-2 gap-3">
                    <div className="rounded-xl p-3" style={{ background: T.vainilla }}><div className="text-[10px] uppercase font-extrabold mb-2" style={{ color: T.choco2 }}>Bases exactas para dosificar</div>{detalleLoteInsumos.preparations.map((preparation) => <div key={preparation.subrecipeId} className="flex justify-between gap-3 py-1 text-xs"><span className="font-semibold">{preparation.name}</span><span className="font-extrabold">{gramosCorridaTexto(preparation.outputGrams)}</span></div>)}</div>
                    <div className="rounded-xl p-3" style={{ background: '#F7F4FB' }}><div className="text-[10px] uppercase font-extrabold mb-2" style={{ color: '#63518A' }}>Ingredientes si hay que elaborar las bases</div>{detalleLoteInsumos.ingredients.map((ingredient) => <div key={ingredient.itemId} className="flex justify-between gap-3 py-1 text-xs"><span className="font-semibold">{ingredient.name}</span><span className="font-extrabold">{cantidadPreparacionTexto(ingredient.unit, ingredient.requiredQuantity)}</span></div>)}<div className="text-[10px] font-semibold mt-2 pt-2 border-t" style={{ color: T.choco2, borderColor: T.border }}>Incluye la merma configurada. No volver a descontar estos ingredientes: el lote ya consumió sus bases preparadas al registrarse.</div></div>
                  </div>

                  <PreparationSteps guide={detalleLoteGuia} title="Secuencia de moldeado" testId="active-batch-steps" />
                </div> : <div className="p-4 text-sm font-bold" style={{ color: '#A03B2A' }}>{detalleLoteInsumos.errors.map((error) => error.message).join(' · ') || 'No se puede construir la guía sin figuras, gramajes y recetas completas.'}</div>}
              </div>}

              <div className="rounded-2xl p-4 lg:col-span-2" style={{ background: "#F7F4FB", border: "1px solid #D8CEE5" }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: "#63518A" }}>Salida comercial automática</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>El lote no se marca reservado ni vendido manualmente. Los pedidos asignan y consumen sus unidades exactas.</div></div>
                  {detalleComercial?.exact && <div className="flex gap-2 flex-wrap">
                    {[["Disponibles", detalleComercial.available, "#3F6B42"], ["Reservadas", detalleComercial.reserved, "#63518A"], ["Entregadas", detalleComercial.sold, "#3E5C7E"]].map(([label, value, color]) => <div key={label} className="rounded-xl px-3 py-2 text-center min-w-[82px]" style={{ background: T.surface }}><div className="display text-xl" style={{ color }}>{value}</div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div></div>)}
                  </div>}
                </div>
                {!detalleComercial?.exact && <div className="text-[11px] font-semibold mt-3" style={{ color: T.choco2 }}>{isActiveProductionBatch(detalleLote) ? "Los contadores aparecerán después del desmolde por figura." : "Este lote es anterior a la trazabilidad por figura; consulta sus reservas desde Inventario terminado."}</div>}
              </div>
            </div>

            {isActiveProductionBatch(detalleLote) && <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t" style={{ borderColor: T.border }}>
              <div className="text-xs font-semibold max-w-xl" style={{ color: T.choco2 }}>El estado físico avanza con la acción de cocina correspondiente. Las reservas y ventas se registran automáticamente desde Pedidos.</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {detalleLote.estado === "En preparación" && <BtnAsync small confirmar="❄️ ¿Empezar? Tocá de nuevo" textoEnVuelo="Empezando…" disabled={enviandoBatchId === detalleLote.id} onClick={() => iniciarCongelacionLote(detalleLote)}>❄️ Empezar congelación</BtnAsync>}
                {detalleCongelacion?.listo && <BtnAsync small textoEnVuelo="Listando…" disabled={enviandoBatchId === detalleLote.id} onClick={() => marcarListo(detalleLote)}>Desmoldar y marcar listo</BtnAsync>}
                {(detalleResultado?.imperfect || 0) > 0 && !String(detalleLote.destino).includes("Insumo") && <BtnAsync small kind="soft" confirmar="♻️ ¿Convertir a insumo? Tocá de nuevo" textoEnVuelo="Convirtiendo…" disabled={enviandoBatchId === detalleLote.id} onClick={() => convertirImperfectasLote(detalleLote)}>♻️ Convertir imperfectas</BtnAsync>}
              </div>
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
            const figuraFisica = `${figura}${f?.gramajeG != null ? ` (${f.gramajeG} g)` : ""}`;
            const etiqueta = p
              ? `${figuraFisica} · presentación ${commercialFamilyLabel(p)}`
              : figuraFisica;
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
                      {physicalFigureIcon(f.especie)} {f.nombre}
                      <div className="text-[10px] font-normal" style={{ color: T.choco2 }}>{f.gramajeG != null ? `${f.gramajeG} g` : ""}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button type="button" aria-label={`Restar una unidad de ${f.nombre}`} onClick={() => setForm({ ...form, figuras: { ...form.figuras, [f.nombre]: Math.max(0, (+form.figuras[f.nombre] || 0) - 1) } })} className="w-7 h-7 rounded-full font-bold" style={{ background: "#fff", border: "1px solid " + T.border, color: T.choco }}>−</button>
                      <input aria-label={`Cantidad de ${f.nombre}`} type="number" min="0" step="1" value={form.figuras[f.nombre] ?? 0} onChange={(e) => setForm({ ...form, figuras: { ...form.figuras, [f.nombre]: Math.max(0, parseInt(e.target.value, 10) || 0) } })} className="w-12 text-center rounded-lg px-1 py-1 text-sm border" style={inputStyle} />
                      <button type="button" aria-label={`Agregar una unidad de ${f.nombre}`} onClick={() => setForm({ ...form, figuras: { ...form.figuras, [f.nombre]: (+form.figuras[f.nombre] || 0) + 1 } })} className="w-7 h-7 rounded-full font-bold" style={{ background: "#fff", border: "1px solid " + T.border, color: T.choco }}>+</button>
                    </div>
                  </div>
                ))}
                {figurasProducibles.length === 0 && <Empty icon="🧊" text="No hay figuras activas con producto asignado." />}
              </div>

              <div className="text-xs font-semibold mb-3 p-2.5 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>
                Total: <b>{totalUnidades}</b> unidades{Object.keys(porLote).length > 0 && (" · " + Object.entries(porLote).map(([etiqueta, cant]) => `${cant}× ${etiqueta}`).join(" · "))}
                <div className="mt-0.5 text-[10px]">Solo informativo — el server calcula los lotes reales al registrar.</div>
              </div>

              <div data-testid="production-input-preview" className="rounded-2xl border overflow-hidden mb-4" style={{ borderColor: T.border, background: T.surface }}>
                <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" style={{ background: "#F7F4FB" }}>
                  <div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: "#63518A" }}>Necesidades para esta corrida</div><div className="font-bold text-sm mt-0.5">Bases preparadas e ingredientes desde cero</div></div>
                  {corridaInsumos.canCalculate && <Badge label={corridaInsumos.preparedStockEnough ? "Bases suficientes" : "Faltan bases"} map={{ "Bases suficientes": { bg: "#E6F1E3", fg: "#3F6B42" }, "Faltan bases": { bg: "#FBE8C8", fg: "#96690F" } }} />}
                </div>

                {totalUnidades === 0 ? <div className="px-4 py-4 text-xs font-semibold" style={{ color: T.choco2 }}>Agrega cantidades por figura y MOMO OPS calculará automáticamente la fórmula completa.</div> : corridaInsumos.errors.length > 0 ? <div className="px-4 py-3" style={{ background: "#FFF2EF" }}>
                  {corridaInsumos.errors.map((error) => <div key={`${error.code}-${error.figure || error.message}`} className="text-xs font-bold py-1" style={{ color: "#A03B2A" }}>⚠ {error.message}</div>)}
                </div> : <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 border-t" style={{ borderColor: T.border }}>
                    {[["Peso final", gramosCorridaTexto(corridaInsumos.totalProductGrams), T.coral], ["Mousse", gramosCorridaTexto(corridaInsumos.mousseOutputGrams), "#63518A"], ["Rellenos", gramosCorridaTexto(corridaInsumos.totalFillingGrams), "#96690F"], ["Costo fórmula", fmt(Math.round(corridaInsumos.totalFormulaCost)), "#3F6B42"]].map(([label, value, color]) => <div key={label} className="rounded-xl p-2.5" style={{ background: T.vainilla }}><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="display text-lg mt-0.5" style={{ color }}>{value}</div></div>)}
                  </div>

                  <div className="px-4 py-3 border-t" style={{ borderColor: T.border }}>
                    <div className="text-[10px] uppercase tracking-[.1em] font-extrabold mb-2" style={{ color: T.choco2 }}>Elaboraciones que consumirá la corrida</div>
                    <div className="grid sm:grid-cols-3 gap-2">
                      {corridaInsumos.preparations.map((preparation) => <div key={preparation.subrecipeId} className="rounded-xl p-3" style={{ background: preparation.enough ? "#E8F1E5" : "#FFF1D6" }}>
                        <div className="text-xs font-bold">{preparation.name}</div>
                        <div className="display text-xl mt-1" style={{ color: preparation.enough ? "#3F6B42" : "#96690F" }}>{gramosCorridaTexto(preparation.outputGrams)}</div>
                        <div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>Hay {cantidadPreparacionTexto(preparation.unit, preparation.currentStock)}{preparation.enough ? " · suficiente" : ` · faltan ${cantidadPreparacionTexto(preparation.unit, preparation.shortage)}`}</div>
                      </div>)}
                    </div>
                  </div>

                  <div className="border-t" style={{ borderColor: T.border }}>
                    <div className="flex flex-wrap items-end justify-between gap-2 px-4 py-3" style={{ background: T.vainilla }}><div><div className="text-[10px] uppercase tracking-[.1em] font-extrabold" style={{ color: T.choco2 }}>Ingredientes crudos</div><div className="text-xs font-bold mt-0.5">Para preparar todas las bases desde cero, con merma incluida</div></div><Badge label={corridaInsumos.rawStockEnough ? "Stock suficiente" : "Revisar existencias"} map={{ "Stock suficiente": { bg: "#E6F1E3", fg: "#3F6B42" }, "Revisar existencias": { bg: "#FBE8C8", fg: "#96690F" } }} /></div>
                    <div className="max-h-56 overflow-y-auto">
                      {corridaInsumos.ingredients.map((ingredient) => <div key={ingredient.itemId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center px-4 py-2 border-t" style={{ borderColor: T.border }}>
                        <div className="text-xs font-semibold min-w-0"><div className="font-bold truncate">{ingredient.name}</div><div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>Disponible: {cantidadPreparacionTexto(ingredient.unit, ingredient.stock)}</div></div>
                        <div className="text-right"><div className="font-extrabold text-sm" style={{ color: ingredient.enough ? T.choco : "#A03B2A" }}>{cantidadPreparacionTexto(ingredient.unit, ingredient.requiredQuantity)}</div>{!ingredient.enough && <div className="text-[9px] font-bold" style={{ color: "#A03B2A" }}>Faltan {cantidadPreparacionTexto(ingredient.unit, ingredient.shortage)}</div>}</div>
                      </div>)}
                    </div>
                  </div>
                  {corridaInsumos.warnings.map((warning) => <div key={warning.code + warning.message} className="px-4 py-2 text-xs font-bold border-t" style={{ borderColor: T.border, background: "#FFF2EF", color: "#A03B2A" }}>⚠ {warning.message}</div>)}
                  <div className="px-4 py-2.5 text-[10px] font-semibold border-t" style={{ borderColor: T.border, color: T.choco2 }}>La corrida descuenta las bases preparadas y crea los lotes físicos correspondientes. La lista de ingredientes muestra qué usar para elaborarlas desde cero y contempla la merma configurada de cada receta.</div>
                </>}
              </div>

              <div className="grid sm:grid-cols-2 gap-x-4">
                <Field label="Responsable"><Select options={db.users.filter((u) => u.activo).map((u) => u.nombre)} value={form.resp} onChange={(e) => setForm({ ...form, resp: e.target.value })} placeholder="Sin responsable" /></Field>
                <Field label="Horas de congelación objetivo"><Input type="number" min="1" step="1" value={form.horasCongelacion} onChange={(e) => setForm({ ...form, horasCongelacion: +e.target.value })} /></Field>
              </div>
              <div className="rounded-xl px-3 py-2.5 mb-3 text-xs font-semibold" style={{ background: "#E8F1E5", color: "#315D36", border: "1px solid #C9DDC4" }}>
                🗓️ El vencimiento no se digita: empieza al confirmar el desmolde y queda sellado por {vidaUtilProductoTerminadoDias} días según Configuración.
              </div>
              <Field label="Observaciones"><Input value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} /></Field>
              <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>Al registrar: se descuentan las elaboraciones preparadas y el servidor crea lotes físicos por figura, familia comercial y gramaje. Las piezas perfectas se suman al stock cuando cada lote pase a "Listo" mediante el desmolde.</div>
              {registroError && <div role="alert" className="rounded-2xl border px-4 py-3 mb-3" style={{ background: "#FFF2EF", borderColor: "#E8B7AD", color: "#8F3528" }}>
                <div className="text-[10px] uppercase tracking-[.12em] font-extrabold">⚠ Stock insuficiente</div>
                <div className="text-sm font-bold mt-1">{registroError}</div>
              </div>}
              {totalUnidades > 0 && corridaInsumos.canCalculate && !corridaInsumos.preparedStockEnough && <div className="rounded-xl px-3 py-2.5 mb-3 text-xs font-bold" style={{ background: "#FBE8C8", color: "#7B5410", border: "1px solid #E7C985" }}>Primero prepará y registrá en inventario todas las elaboraciones faltantes. La corrida se habilitará cuando mousse, cheesecake y ganache alcancen.</div>}
              <div className="flex gap-2">
                <BtnAsync textoEnVuelo="Registrando…" disabled={enviando || totalUnidades === 0 || !corridaInsumos.canCalculate || !corridaInsumos.preparedStockEnough} onClick={registrarCorrida}>Registrar corrida</BtnAsync>
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
                <div className="mb-3"><PreparationSteps guide={prepGuia} title="Paso a paso durante la elaboración" testId="active-subrecipe-steps" /></div>
              </>
            )}
            <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>Al registrar: se descuentan los ingredientes por los gramos nominales, y los gramos obtenidos suman al stock de la base con su costo real (WAC).{vidaUtilMezclasDias ? ` La tanda vencerá el ${dISO(vidaUtilMezclasDias)} (${vidaUtilMezclasDias} días configurados).` : " La vida útil de mezclas aún no está habilitada en el servidor."} Los faltantes no bloquean: quedan avisados.</div>
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
                <div className="text-xs font-bold mb-3 rounded-xl px-3 py-2" style={{ background: "#E8F1E5", color: "#315D36" }}>Al confirmar, el producto terminado vencerá el {dISO(vidaUtilProductoTerminadoDias)} ({vidaUtilProductoTerminadoDias} días configurados).</div>
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
              <div className="text-xs font-bold mb-3 rounded-xl px-3 py-2" style={{ background: "#E8F1E5", color: "#315D36" }}>Al confirmar, el producto terminado vencerá el {dISO(vidaUtilProductoTerminadoDias)} ({vidaUtilProductoTerminadoDias} días configurados).</div>
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
