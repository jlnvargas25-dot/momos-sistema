import { useState, useEffect, useMemo, useRef } from "react";
import { buildDeliveryOrderBoard, deliveryNextStep } from "../../lib/delivery-order-board.js";
import { buildCustomerCrm, crmCompleteness } from "../../lib/customer-crm.js";
import { buildCommercialCalendar, buildPostDraftFromCreative, calendarTransitionGuard } from "../../lib/commercial-calendar.js";
import { buildDistributionRoom, distributionChecklistFor, validateDistributionAction } from "../../lib/commercial-distribution.js";
import { enrichDistributionWithDispatch } from "../../lib/commercial-dispatch.js";
import { buildOperationalHistory, isActiveClaim, partitionByActivity } from "../../lib/operational-history.js";
import {
  activeConfigurationFigureCatalog, activeFigureCatalog, commercialFamilyLabel, expectedFigureProductId, figureProductId, isAuxiliaryFigureName, isCommercialFamilyProduct, isKitchenFigureName,
  productUsesHorizontalFigure,
  KITCHEN_FIGURE_DEFAULTS, KITCHEN_FIGURE_NAMES, orderLinePresentation, productTypeForCategory,
} from "../../lib/momos-domain-language.js";
import { PRODUCT_CATEGORY_EMOJI, PRODUCT_CATEGORY_ORDER } from "../../lib/product-categories.js";
import { buildCanonicalFinishedStock } from "../../lib/canonical-stock.js";
import { buildCanonicalPhysicalResults } from "../../lib/canonical-production-results.js";

export function createBusinessPanels(shared) {
  const { supabase, T, CANAL_STYLE, CANALES, CAL_ESTADOS, CAMP_ESTADOS, CREA_ESTADOS, MK_CANAL_STYLE, MK_CANALES, MK_FORMATOS, MK_OBJETIVOS, PERMISOS_POR_ROL, ROLES, SABORES, ATRIBUTO_LABEL, atributosDeTipo, hoyISO, dISO, diasEntre, selloAMs, milCO, fmt, pct, itemsOf, customerOf, productOf, orderSubtotal, orderTotal, lineAdiciones, lineAdicionesTotal, lineAdicionesCOGS, esPedidoCobrado, availability, ordersDeCampaign, ordersDeCreative, ventasDeCreative, atribucionDeResultado, resultadosDePlataforma, campaignMetrics, recipeLines, recipeCost, downloadCSV, Badge, Card, CountUp, Stat, SectionTitle, WorkScopeTabs, Btn, BtnAsync, toast, Modal, Field, Input, Select, MiniSelect, Empty, Bars, inputCls, inputStyle, InlineNotice, SegmentedTabs, deliveryBlocksNewRequest, normalizeRoles, normalizeKitchenDelaySettings, buildConfigurationSavePayload, normalizeConfigurationSnapshot, fetchOperationalHistoryPage, setOrderStatusRemoto, crearDomicilio, actualizarDomicilio, mutarDomicilioDelta, setReclamoEstado, editarReclamo, upsertCliente, guardarPreferenciasCliente, crearActivacionCliente, registrarContactoCliente, convertirActivacionCliente, activarBeneficioCliente, crearProducto, editarProducto, setProductoActivo, guardarRecetaProducto, sincronizarCostoProducto, mutarCatalogoCrmDelta, createInventoryIdempotencyKey, crearUsuarioStaff, quitarRolUsuario, setUserActivo, guardarConfiguracionServidor, fetchOperationalHealthSnapshot, fetchOperationalSloSnapshot, fetchContinuitySnapshot, runOperationalHealthReview, crearCampana, editarCampana, crearCreativo, editarCreativo, crearPublicacion, setPublicacionEstado, registrarMetricasCreativo, guardarPreparacionDistribucion, aprobarDistribucion, cerrarDistribucionPublicacion, autorizarDespachoDistribucion, reintentarDespachoDistribucion, DB_VERSION } = shared;

  function Dashboard({ db, go, user }) {
    const [assistantCenterOpen, setAssistantCenterOpen] = useState(false);
    const snapshot = db.dashboardSnapshotReady ? db.dashboardSnapshot : null;
    if (!snapshot) return (
      <div>
        <SectionTitle>Hoy en la cocina</SectionTitle>
        <Card className="p-8 text-center">
          <div className="text-3xl" aria-hidden="true">✦</div>
          <div className="display text-xl font-semibold mt-2">Preparando tu resumen operativo</div>
          <div className="text-sm mt-1" style={{ color: T.choco2 }}>MOMOS OPS está reuniendo únicamente los datos necesarios para Inicio.</div>
        </Card>
      </div>
    );
    const hoy = snapshot.businessDate;
    const assistantCenter = snapshot.assistantCenter;
    const ventasHoy = snapshot.summary.salesToday;
    const pedidosHoy = snapshot.summary.ordersToday;
    const activos = snapshot.summary.activeOrders;
    const pendPago = snapshot.summary.pendingPayments;
    const montoPendiente = snapshot.summary.pendingPaymentAmount;
    const reclamosAbiertos = snapshot.summary.openClaims;
    const stockBajo = snapshot.inventoryAlerts.lowStock.map((i) => ({ id: i.id, nombre: i.name, stock: i.stock, min: i.minimum, unidad: i.unit }));
    const porVencer = snapshot.inventoryAlerts.expiringSoon.map((i) => ({ id: i.id, nombre: i.name, vence: i.expires }));
    const sugerencias = snapshot.notices.productionSuggestions.map((s) => ({ id: s.id, cantidad: s.quantity, producto: s.product }));
    const lotesListos = snapshot.notices.freezingReady.map((l) => ({ id: l.id, producto: l.product, gramaje: l.grams ? `${l.grams} g` : "", sabor: l.flavor }));
    const pubsHoy = snapshot.notices.publicationsToday.map((p) => ({ ...p, hora: p.time, canal: p.channel }));
    const creativosPorAprobar = snapshot.notices.creativeReviews.map((c) => ({ ...c, titulo: c.label }));
    const campActivasSinPedidos = snapshot.notices.campaignsWithoutOrders.map((c) => ({ ...c, nombre: c.label }));
    const winner = snapshot.notices.winner;
    const asistente = {
      ideaHoy: snapshot.brandAssistant.ideaToday ? { titulo: snapshot.brandAssistant.ideaToday.label } : null,
      clienteContacto: snapshot.brandAssistant.customerContact ? { nombre: snapshot.brandAssistant.customerContact.label, motivo: snapshot.brandAssistant.customerContact.reason } : null,
      campRevisar: snapshot.brandAssistant.campaignReview ? { c: { nombre: snapshot.brandAssistant.campaignReview.label } } : null,
      contenidoRepetir: snapshot.brandAssistant.contentRepeat ? { titulo: snapshot.brandAssistant.contentRepeat.label } : null,
      benefVence: snapshot.brandAssistant.benefitExpiring ? { beneficio: snapshot.brandAssistant.benefitExpiring.label, vence: snapshot.brandAssistant.benefitExpiring.expires } : null,
      tareaFalta: snapshot.brandAssistant.taskMissing ? { tarea: snapshot.brandAssistant.taskMissing.label } : null,
    };
    const nuevos = snapshot.customerSummary.new;
    const recurrentes = snapshot.customerSummary.recurrent;
    const porEstado = snapshot.ordersByState;
    const porCanal = snapshot.salesByChannel.map((row) => ({ ...row, color: CANAL_STYLE[row.label]?.fg || T.coral }));
    const disponibilidad = snapshot.productAvailability;
    const assistantSeverityStyle = {
      critical: { label: "Crítica", bg: "#F6D4CD", fg: "#8F3528" },
      high: { label: "Alta", bg: "#FFF1D6", fg: "#7A5510" },
      medium: { label: "Media", bg: "#DCE7F2", fg: "#3E5C7E" },
      info: { label: "Informativa", bg: "#DDEBD9", fg: "#356239" },
    };

    return (
      <div>
        <SectionTitle>Hoy en la cocina</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat icon="🧁" label="Ventas del día" value={fmt(ventasHoy)} sub={pedidosHoy + " pedidos hoy · toca para ver"} tone={T.coral} onClick={() => go("Pedidos", { desde: hoy, hasta: hoy })} />
          <Stat icon="📦" label="Pedidos activos" value={activos} sub="en flujo operativo · toca para ver" onClick={() => go("Pedidos")} />
          <Stat icon="💳" label="Pendientes de pago" value={pendPago} sub={fmt(montoPendiente) + " · toca para ver"} tone="#96690F" onClick={() => go("Pedidos", { pendientesPago: true })} />
          <Stat icon="⚠️" label="Reclamos abiertos" value={reclamosAbiertos} sub="requieren decisión · toca para ver" tone="#A03B2A" onClick={() => go("Reclamos")} />
        </div>

        <Card className="mt-3 overflow-hidden" onClick={() => setAssistantCenterOpen(true)}
          aria-label="Abrir Centro de asistentes MOMOS"
          style={{ background: "linear-gradient(135deg,#FFF8F0 0%,#FFFFFF 55%,#F5EDE4 100%)", borderColor: assistantCenter.summary.health === "Bloqueado" ? "#E6AAA0" : assistantCenter.summary.health === "Atención" ? "#E5C98E" : "#BFD8BA" }}>
          <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl shrink-0" aria-hidden="true"
              style={{ background: assistantCenter.summary.health === "Bloqueado" ? "#F6D4CD" : assistantCenter.summary.health === "Atención" ? "#FFF1D6" : "#DDEBD9" }}>
              ✦
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[10px] uppercase tracking-[.16em] font-extrabold" style={{ color: T.coral }}>MOMOS OPS Intelligence</div>
                <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold"
                  style={{ background: assistantCenter.summary.health === "Bloqueado" ? "#F6D4CD" : assistantCenter.summary.health === "Atención" ? "#FFF1D6" : "#DDEBD9", color: assistantCenter.summary.health === "Bloqueado" ? "#8F3528" : assistantCenter.summary.health === "Atención" ? "#7A5510" : "#356239" }}>
                  {assistantCenter.summary.health}
                </span>
              </div>
              <div className="display text-xl font-semibold mt-1">Centro de asistentes MOMOS</div>
              {assistantCenter.primary ? <>
                <div className="text-sm font-extrabold mt-1.5">{assistantCenter.primary.title}</div>
                <div className="text-xs mt-1 leading-relaxed" style={{ color: T.choco2 }}>
                  Responsable: {assistantCenter.primary.ownerRoles.join(" / ")} · {assistantCenter.primary.nextAction}
                </div>
              </> : <div className="text-sm font-semibold mt-1.5" style={{ color: "#3F6B42" }}>Los cinco asistentes están al día.</div>}
            </div>
            <div className="grid grid-cols-3 gap-2 shrink-0 text-center">
              {[["Asistentes", assistantCenter.assistants.length], ["Prioridades", assistantCenter.summary.tasks], ["Críticas", assistantCenter.summary.critical]].map(([label, value]) => (
                <div key={label} className="rounded-2xl px-3 py-2 min-w-[70px]" style={{ background: "rgba(255,255,255,.78)", border: `1px solid ${T.border}` }}>
                  <div className="display text-lg font-semibold">{value}</div>
                  <div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {sugerencias.length > 0 && (
          <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#DCE7F2", color: "#3E5C7E" }}>
            👩‍🍳 Necesidad por presentación comercial: {sugerencias.map((s) => `${s.cantidad}× ${commercialFamilyLabel(s.producto)}`).join(" · ")}. Abrí Producción para confirmar la figura y el sabor exactos.{" "}
            <button className="underline" onClick={() => go("Producción")}>Ver detalle exacto</button>
          </div>
        )}

        {lotesListos.length > 0 && (
          <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#DDEBD9", color: "#3F6B42" }}>
            🧊✅ {lotesListos.length} lote(s) cumplieron su tiempo de congelación y esperan cierre: {lotesListos.map((l) => `${l.id} (${[commercialFamilyLabel(l.producto), l.gramaje, l.sabor].filter(Boolean).join(" · ")})`).join(", ")}. La figura exacta se valida dentro del lote.{" "}
            <button className="underline" onClick={() => go("Producción")}>Ir a Producción</button>
          </div>
        )}

        {pubsHoy.length > 0 && (
          <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#F3D7DC", color: "#8E4B5A" }}>
            🗓️ Publicaciones de hoy ({pubsHoy.length}): {pubsHoy.map((p) => `${p.hora} ${p.canal}`).join(" · ")}.{" "}
            <button className="underline" onClick={() => go("Calendario")}>Ver calendario</button>
          </div>
        )}
        {creativosPorAprobar.length > 0 && (
          <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#E8E0F2", color: "#63518A" }}>
            🎨 {creativosPorAprobar.length} creativo(s) esperan aprobación: {creativosPorAprobar.map((c) => c.titulo).join(", ")}.{" "}
            <button className="underline" onClick={() => go("Creativos")}>Revisar</button>
          </div>
        )}
        {campActivasSinPedidos.length > 0 && (
          <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#FBE8C8", color: "#96690F" }}>
            📣 Campañas activas sin pedidos atribuidos: {campActivasSinPedidos.map((c) => c.nombre).join(", ")}.{" "}
            <button className="underline" onClick={() => go("Marketing")}>Ver Marketing</button>
          </div>
        )}
        {winner && (
          <div className="mt-3 text-xs font-bold p-3 rounded-xl" style={{ background: "#DDEBD9", color: "#3F6B42" }}>
            🏆 Mejor resultado atribuido: campaña {winner.campaignId} · ROAS {Number(winner.roas || 0).toFixed(1)}x{winner.creativeId ? ` · creativo ${winner.creativeId}` : ""}
          </div>
        )}

        {(user === "Administrador" || user === "Marketing/CRM") && (
          <>
            <SectionTitle>🌱 Asistente de marca MOMOS</SectionTitle>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Card className="p-3.5" onClick={() => go("Crecimiento")}>
                <div className="text-xs font-bold mb-1" style={{ color: T.coral }}>📱 Qué publicar hoy</div>
                <div className="text-sm font-semibold leading-tight">{asistente.ideaHoy ? asistente.ideaHoy.titulo : "Sin ideas cargadas"}</div>
              </Card>
              <Card className="p-3.5" onClick={() => go("Crecimiento")}>
                <div className="text-xs font-bold mb-1" style={{ color: "#8E4B5A" }}>💬 Cliente para contactar</div>
                <div className="text-sm font-semibold leading-tight">{asistente.clienteContacto ? asistente.clienteContacto.nombre : "Nadie urgente hoy"}</div>
                {asistente.clienteContacto && <div className="text-[11px] mt-0.5" style={{ color: T.choco2 }}>{asistente.clienteContacto.motivo}</div>}
              </Card>
              <Card className="p-3.5" onClick={() => go("Crecimiento")}>
                <div className="text-xs font-bold mb-1" style={{ color: "#3E5C7E" }}>📣 Campaña para revisar</div>
                <div className="text-sm font-semibold leading-tight">{asistente.campRevisar ? asistente.campRevisar.c.nombre : "Sin campañas activas"}</div>
              </Card>
              <Card className="p-3.5" onClick={() => go("Crecimiento")}>
                <div className="text-xs font-bold mb-1" style={{ color: "#3F6B42" }}>🔁 Contenido para repetir</div>
                <div className="text-sm font-semibold leading-tight">{asistente.contenidoRepetir ? asistente.contenidoRepetir.titulo : "Aún sin ganadores"}</div>
              </Card>
              <Card className="p-3.5" onClick={() => go("Beneficios")}>
                <div className="text-xs font-bold mb-1" style={{ color: "#96690F" }}>⏳ Beneficio por vencer</div>
                <div className="text-sm font-semibold leading-tight">{asistente.benefVence ? asistente.benefVence.beneficio : "Ninguno próximo"}</div>
                {asistente.benefVence && <div className="text-[11px] mt-0.5" style={{ color: T.choco2 }}>vence {asistente.benefVence.vence}</div>}
              </Card>
              <Card className="p-3.5" onClick={() => go("Crecimiento")}>
                <div className="text-xs font-bold mb-1" style={{ color: "#63518A" }}>✅ Tarea que falta</div>
                <div className="text-sm font-semibold leading-tight">{asistente.tareaFalta ? asistente.tareaFalta.tarea : "¡Todo al día! 🎉"}</div>
              </Card>
            </div>
          </>
        )}

        <SectionTitle>Alertas</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>📉 Inventario bajo mínimo</div>
            {stockBajo.length === 0 ? <div className="text-sm">Todo el stock está por encima del mínimo.</div> :
              stockBajo.map((i) => (
                <button key={i.id} onClick={() => go("Inventario", { itemId: i.id })}
                  className="w-full flex justify-between items-center text-sm py-1.5 border-b last:border-0 text-left hover:opacity-70"
                  style={{ borderColor: T.border }}>
                  <span className="font-semibold">{i.nombre}</span>
                  <span className="flex items-center gap-1.5 font-bold" style={{ color: "#A03B2A" }}>{i.stock} / mín {i.min} {i.unidad} <span aria-hidden="true" style={{ color: T.choco2 }}>›</span></span>
                </button>
              ))}
            <div className="mt-3"><Btn small kind="soft" onClick={() => go("Inventario")}>Ir a inventario</Btn></div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>🗓️ Vencimientos próximos (5 días)</div>
            {porVencer.length === 0 ? <div className="text-sm">Sin vencimientos cercanos.</div> :
              porVencer.map((i) => (
                <button key={i.id} onClick={() => go("Inventario", { itemId: i.id })}
                  className="w-full flex justify-between items-center text-sm py-1.5 border-b last:border-0 text-left hover:opacity-70"
                  style={{ borderColor: T.border }}>
                  <span className="font-semibold">{i.nombre}</span>
                  <span className="flex items-center gap-1.5 font-bold" style={{ color: "#96690F" }}>{i.vence} <span aria-hidden="true" style={{ color: T.choco2 }}>›</span></span>
                </button>
              ))}
            <div className="mt-3 flex gap-2 text-xs font-semibold" style={{ color: T.choco2 }}>
              <span>👤 Nuevos: <b style={{ color: T.choco }}>{nuevos}</b></span><span>·</span>
              <span>💖 Recurrentes/VIP: <b style={{ color: T.choco }}>{recurrentes}</b></span>
            </div>
          </Card>
        </div>

        <SectionTitle>Pedidos por estado</SectionTitle>
        <Card className="p-4"><Bars data={porEstado} /></Card>

        <SectionTitle>Ventas por canal</SectionTitle>
        <Card className="p-4"><Bars data={porCanal} money /></Card>

        <SectionTitle>Disponibilidad por familia comercial y cajas</SectionTitle>
        <div className="text-xs font-semibold mb-3 -mt-3" style={{ color: T.choco2 }}>Este total sirve para vender y reservar. La promesa exacta se confirma después por figura y sabor en Inventario terminado.</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {disponibilidad.map((p) => {
            const disp = p.available;
            return (
              <Card key={p.id} className="p-3" onClick={() => go("Producción")}>
                <div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{p.type === "combo" ? "Caja / combo" : "Familia comercial"}</div>
                <div className="text-sm font-bold leading-tight mt-0.5">{commercialFamilyLabel(p.name)}</div>
                <div className="display text-xl mt-1" style={{ color: disp <= 2 ? "#A03B2A" : T.choco }}>
                  {disp} <span className="text-xs font-sans font-semibold" style={{ color: T.choco2 }}>disp.</span>
                </div>
                {p.type === "combo" && <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>calculado por momos + cajas</div>}
                {disp <= 2 && <div className="text-xs font-bold mt-0.5" style={{ color: "#A03B2A" }}>Producir / comprar pronto</div>}
              </Card>
            );
          })}
        </div>

        {assistantCenterOpen && (
          <Modal title="Centro de asistentes MOMOS" onClose={() => setAssistantCenterOpen(false)} wide>
            <div className="rounded-3xl p-4 sm:p-5 mb-4" style={{ background: "linear-gradient(135deg,#F8EBDD,#FFFDF9)", border: `1px solid ${T.border}` }}>
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-[.16em] font-extrabold" style={{ color: T.coral }}>Una prioridad · un responsable · una fuente</div>
                  <div className="display text-2xl font-semibold mt-1">{assistantCenter.primary ? assistantCenter.primary.title : "Operación protegida"}</div>
                  <div className="text-sm font-semibold mt-2 leading-relaxed" style={{ color: T.choco2 }}>
                    {assistantCenter.primary ? assistantCenter.primary.detail : "No hay tareas pendientes entre Ventas, Cocina, Compras, Empaque, Logística y Finanzas."}
                  </div>
                </div>
                <div className="rounded-2xl px-4 py-3 text-center shrink-0" style={{ background: "rgba(255,255,255,.82)" }}>
                  <div className="display text-2xl font-semibold">{assistantCenter.summary.tasks}</div>
                  <div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>prioridades abiertas</div>
                </div>
              </div>
              <div className="mt-4 rounded-2xl px-3 py-2.5 text-xs font-bold" style={{ background: "rgba(255,255,255,.68)", color: T.choco2 }}>
                🛡️ {assistantCenter.policy}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5" aria-label="Estado de los asistentes">
              {assistantCenter.assistants.map((row) => (
                <button key={row.id} type="button" onClick={() => { setAssistantCenterOpen(false); go(row.module); }}
                  className="rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
                  style={{ background: T.surface, borderColor: row.status === "Bloqueado" ? "#E6AAA0" : row.status === "Atención" ? "#E5C98E" : "#BFD8BA" }}>
                  <div className="text-[10px] uppercase font-extrabold leading-tight" style={{ color: T.choco2 }}>{row.name}</div>
                  <div className="display text-xl font-semibold mt-1">{row.count}</div>
                  <div className="text-[10px] font-extrabold mt-0.5" style={{ color: row.status === "Bloqueado" ? "#8F3528" : row.status === "Atención" ? "#7A5510" : "#356239" }}>{row.status}</div>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="display text-lg font-semibold">Qué necesita atención</div>
                <div className="text-xs mt-0.5" style={{ color: T.choco2 }}>Ordenado por riesgo operativo, no por el área que lo reportó.</div>
              </div>
              {assistantCenter.summary.blocking > 0 && <span className="rounded-full px-3 py-1 text-[10px] font-extrabold" style={{ background: "#F6D4CD", color: "#8F3528" }}>{assistantCenter.summary.blocking} bloquean</span>}
            </div>

            {assistantCenter.tasks.length === 0 ? (
              <div className="rounded-3xl p-8 text-center" style={{ background: "#DDEBD9", color: "#356239" }}>
                <div className="text-3xl" aria-hidden="true">✓</div>
                <div className="display text-xl font-semibold mt-2">Operación protegida</div>
                <div className="text-sm font-semibold mt-1">Los cinco asistentes están al día y no detectan inconsistencias.</div>
              </div>
            ) : (
              <div className="space-y-3">
                {assistantCenter.tasks.slice(0, 12).map((row) => {
                  const tone = assistantSeverityStyle[row.severity] || assistantSeverityStyle.medium;
                  return (
                    <div key={row.id} className="rounded-2xl border p-4" style={{ background: T.surface, borderColor: row.blocks ? "#E6AAA0" : T.border }}>
                      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{tone.label}</span>
                            <span className="text-[10px] uppercase font-extrabold" style={{ color: T.coral }}>{row.area}</span>
                            {row.entityId && <span className="text-[10px] font-bold" style={{ color: T.choco2 }}>{row.entityType} {row.entityId}</span>}
                            <span className="text-[10px] font-bold" style={{ color: T.choco2 }}>Confianza {row.confidence.toLowerCase()}</span>
                          </div>
                          <div className="text-sm font-extrabold">{row.title}</div>
                          <div className="text-xs mt-1 leading-relaxed" style={{ color: T.choco2 }}>{row.detail}</div>
                          <div className="mt-2 space-y-1">
                            {row.reasons.map((reason, index) => <div key={`${row.id}-reason-${index}`} className="text-[11px] font-semibold flex gap-2" style={{ color: T.choco2 }}><span aria-hidden="true">•</span><span>{reason}</span></div>)}
                          </div>
                          <div className="mt-3 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: T.vainilla }}>
                            Siguiente paso: {row.nextAction}
                          </div>
                        </div>
                        <div className="sm:w-44 shrink-0">
                          <div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>Responsable</div>
                          <div className="text-xs font-extrabold mt-1">{row.ownerRoles.join(" / ")}</div>
                          {row.confirmationRequired && <div className="text-[10px] font-bold mt-2" style={{ color: "#96690F" }}>Confirmación humana obligatoria</div>}
                          <button type="button" onClick={() => { setAssistantCenterOpen(false); go(row.module); }} className="momo-btn w-full rounded-xl px-3 py-2 mt-3 text-xs font-extrabold" style={{ background: T.coral, color: "white" }}>Abrir {row.module}</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {assistantCenter.tasks.length > 12 && <div className="rounded-2xl px-4 py-3 text-center text-xs font-bold" style={{ background: T.vainilla, color: T.choco2 }}>Se muestran las 12 prioridades más importantes de {assistantCenter.tasks.length}. Cada asistente conserva el detalle completo en su área.</div>}
              </div>
            )}
          </Modal>
        )}
      </div>
    );
  }

  /* ================= PEDIDOS ================= */

  const HISTORY_AREA_OPTIONS = Object.freeze([
    "Pedidos", "Producción", "Empaque", "Domicilios", "Reclamos", "Inventario",
    "Inventario terminado", "Productos", "Clientes", "Agencia MOMOS", "Finanzas",
    "Configuración", "Operación",
  ]);

  function HistorialOperativo({ db }) {
    const [olderAudit, setOlderAudit] = useState([]);
    const [historyCursor, setHistoryCursor] = useState(db.auditCursor || null);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [historyError, setHistoryError] = useState("");
    const mergedAudit = useMemo(() => {
      const byId = new Map([...(db.audit_logs || []), ...olderAudit].map((row) => [row.id, row]));
      return [...byId.values()];
    }, [db.audit_logs, olderAudit]);
    const localEntries = useMemo(() => buildOperationalHistory({ ...db, audit_logs: mergedAudit }), [db, mergedAudit]);
    const [q, setQ] = useState("");
    const [area, setArea] = useState("");
    const [desde, setDesde] = useState("");
    const [hasta, setHasta] = useState("");
    const [limit, setLimit] = useState(50);
    const filterRequestRef = useRef(0);
    const [filteredAudit, setFilteredAudit] = useState([]);
    const [filteredCursor, setFilteredCursor] = useState(null);
    const [filteredKey, setFilteredKey] = useState("");
    const serverFilters = useMemo(() => ({ query: q.trim(), area, from: desde, to: hasta }), [q, area, desde, hasta]);
    const serverFilterKey = useMemo(() => JSON.stringify(serverFilters), [serverFilters]);
    const hasServerFilters = Boolean(serverFilters.query || serverFilters.area || serverFilters.from || serverFilters.to);
    const remoteEntries = useMemo(() => buildOperationalHistory({ audit_logs: filteredAudit }), [filteredAudit]);
    const entries = hasServerFilters ? (filteredKey === serverFilterKey ? remoteEntries : []) : localEntries;
    const areas = useMemo(() => [...new Set([...localEntries, ...remoteEntries].map((entry) => entry.area))].sort((a, b) => a.localeCompare(b, "es")), [localEntries, remoteEntries]);
    const filtered = entries;
    useEffect(() => { setLimit(50); }, [q, area, desde, hasta]);
    useEffect(() => {
      const requestId = ++filterRequestRef.current;
      if (!hasServerFilters) {
        setFilteredAudit([]);
        setFilteredCursor(null);
        setFilteredKey("");
        setHistoryError("");
        setLoadingHistory(false);
        return undefined;
      }
      setLoadingHistory(true);
      setHistoryError("");
      const timer = setTimeout(async () => {
        try {
          const page = await fetchOperationalHistoryPage(null, 50, serverFilters);
          if (requestId !== filterRequestRef.current) return;
          setFilteredAudit(page.rows);
          setFilteredCursor(page.hasMore ? page.cursor : null);
          setFilteredKey(serverFilterKey);
        } catch (error) {
          if (requestId !== filterRequestRef.current) return;
          setFilteredAudit([]);
          setFilteredCursor(null);
          setFilteredKey(serverFilterKey);
          setHistoryError(error.message);
        } finally {
          if (requestId === filterRequestRef.current) setLoadingHistory(false);
        }
      }, 250);
      return () => clearTimeout(timer);
    }, [hasServerFilters, serverFilterKey, serverFilters]);
    const visible = hasServerFilters ? filtered : filtered.slice(0, limit);
    const today = hoyISO();
    const todayCount = entries.filter((entry) => entry.at.startsWith(today)).length;
    const actorCount = new Set(entries.map((entry) => entry.actor).filter(Boolean)).size;
    const primerRegistro = entries.reduce((min, e) => (min == null || (e.at && e.at < min) ? e.at : min), null);

    function exportar() {
      downloadCSV("historial-operativo", ["Fecha", "Área", "Entidad", "ID", "Acción", "Antes", "Después", "Responsable"], filtered.map((entry) => [entry.at, entry.area, entry.entity, entry.entityId, entry.action, entry.from, entry.to, entry.actor]));
    }

    async function verMasHistorial() {
      if (hasServerFilters) {
        if (!filteredCursor || loadingHistory) return;
        const requestId = ++filterRequestRef.current;
        const requestedKey = serverFilterKey;
        setLoadingHistory(true);
        setHistoryError("");
        try {
          const page = await fetchOperationalHistoryPage(filteredCursor, 50, serverFilters);
          if (requestId !== filterRequestRef.current || requestedKey !== serverFilterKey) return;
          setFilteredAudit((rows) => {
            const byId = new Map([...rows, ...page.rows].map((row) => [row.id, row]));
            return [...byId.values()];
          });
          setFilteredCursor(page.hasMore ? page.cursor : null);
        } catch (error) {
          if (requestId === filterRequestRef.current) setHistoryError(error.message);
        } finally {
          if (requestId === filterRequestRef.current) setLoadingHistory(false);
        }
        return;
      }
      if (visible.length < filtered.length) {
        setLimit((value) => value + 50);
        return;
      }
      if (!historyCursor || loadingHistory) return;
      setLoadingHistory(true);
      setHistoryError("");
      try {
        const page = await fetchOperationalHistoryPage(historyCursor, 50);
        setOlderAudit((rows) => [...rows, ...page.rows]);
        setHistoryCursor(page.rows.length ? page.cursor : null);
        setLimit((value) => value + page.rows.length);
      } catch (error) {
        setHistoryError(error.message);
      } finally {
        setLoadingHistory(false);
      }
    }

    return (
      <div>
        <SectionTitle>Historial operativo</SectionTitle>
        <div className="text-xs font-semibold mb-3 -mt-3" style={{ color: T.choco2 }}>
          Consultá qué pasó, en qué área, sobre qué registro y quién lo ejecutó. Nada se borra al salir de una bandeja de trabajo.
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat icon="◷" label="Movimientos" value={entries.length} sub={hasServerFilters ? "cargados para este filtro" : "rastro disponible"} tone={T.coral} />
          <Stat icon="●" label="Hoy" value={todayCount} sub="acciones registradas" tone="#3F6B42" />
          <Stat icon="▦" label="Áreas" value={areas.length} sub="fuentes conectadas" tone="#63518A" />
          <Stat icon="♙" label="Responsables" value={actorCount} sub="usuarios en el rastro" tone="#96690F" />
        </div>

        <div className="text-[11px] font-semibold mt-2 mb-3" style={{ color: T.choco2 }}>
          Rastro registrado desde <b style={{ color: T.coral }}>{primerRegistro ? primerRegistro.slice(0, 10) : "—"}</b> hasta hoy.
        </div>

        <SegmentedTabs
          ariaLabel="Áreas del historial"
          value={area}
          onChange={setArea}
          items={[["Todas", ""], ...HISTORY_AREA_OPTIONS.map((name) => [name, name])]}
          getCount={(value) => value ? entries.filter((entry) => entry.area === value).length : entries.length}
        />

        <Card className="p-3 mb-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_150px_150px_auto] gap-2 items-center">
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Buscar pedido, lote, acción o responsable…" className="rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
            <input type="date" aria-label="Historial desde" value={desde} onChange={(event) => setDesde(event.target.value)} className="rounded-xl px-3 py-2 text-xs border font-bold" style={inputStyle} />
            <input type="date" aria-label="Historial hasta" value={hasta} onChange={(event) => setHasta(event.target.value)} className="rounded-xl px-3 py-2 text-xs border font-bold" style={inputStyle} />
            <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
          </div>
        </Card>

        <div className="flex items-center justify-between gap-3 mb-3"><div><div className="display text-lg font-semibold">Bitácora consolidada</div><div className="text-xs font-semibold" style={{ color: T.choco2 }}>{loadingHistory && hasServerFilters && filteredKey !== serverFilterKey ? "Buscando en todo el historial…" : `${filtered.length} movimiento${filtered.length === 1 ? "" : "s"} cargado${filtered.length === 1 ? "" : "s"}`}</div></div>{(q || area || desde || hasta) && <button type="button" className="text-xs font-extrabold" style={{ color: T.coral }} onClick={() => { setQ(""); setArea(""); setDesde(""); setHasta(""); }}>Limpiar filtros</button>}</div>
        <Card className="overflow-hidden">
          <div className="divide-y" style={{ borderColor: T.border }}>
            {visible.map((entry) => (
              <div key={entry.id} className="p-3 sm:p-4 flex gap-3 items-start" style={{ borderColor: T.border }}>
                <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-sm font-black" style={{ background: entry.area === "Producción" ? "#DCE7F2" : entry.area === "Domicilios" ? "#DDEBD9" : entry.area === "Reclamos" ? "#F6D4CD" : T.vainilla, color: T.choco }}>↻</div>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{entry.area}</span><span className="text-[10px] font-bold" style={{ color: T.choco2 }}>{entry.entity}{entry.entityId ? ` · ${entry.entityId}` : ""}</span></div><div className="font-bold text-sm mt-0.5">{entry.action}</div>{(entry.from || entry.to) && <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{entry.from || "—"} <span aria-hidden="true">→</span> <b style={{ color: T.choco }}>{entry.to || "—"}</b></div>}</div>
                <div className="text-right shrink-0"><time className="text-[10px] font-bold block" style={{ color: T.choco2 }}>{entry.at || "Sin fecha"}</time><span className="text-[10px] font-extrabold block mt-1">{entry.actor}</span></div>
              </div>
            ))}
            {!visible.length && <div className="p-10 text-center"><div className="text-3xl mb-2">⌕</div><div className="font-bold">{loadingHistory ? "Buscando movimientos…" : "No hay movimientos con esos filtros"}</div></div>}
          </div>
        </Card>
        {((hasServerFilters && filteredCursor) || (!hasServerFilters && (visible.length < filtered.length || historyCursor))) && <div className="mt-3 text-center"><Btn kind="ghost" onClick={verMasHistorial} disabled={loadingHistory}>{loadingHistory ? "Cargando…" : "Ver 50 movimientos más"}</Btn></div>}
        {historyError && <div className="mt-2 text-center text-xs font-bold" style={{ color: T.red }}>{historyError}</div>}
      </div>
    );
  }

  /* ================= PRODUCCIÓN ================= */

  /* ================= INVENTARIO TERMINADO ================= */

  const CAT_EMOJI = PRODUCT_CATEGORY_EMOJI;

  function nuevoProductoVacio() {
    return { nombre: "", cat: "Momos Antojos", tipo: "pedido", especie: "", precio: "", precioRappi: "", costo: "", prep: "", frio: true, lejano: false, desc: "", comboSize: "", componentProductIds: [], empaqueItem: "", colchonProduccion: 0 };
  }

  function Productos({ db, user, refrescar, serverDataReady, aplicarMutacionCatalogoCrm, capturarContextoMutacionCatalogoCrm, go }) {
    const cats = PRODUCT_CATEGORY_ORDER;
    const [detalleProductoId, setDetalleProductoId] = useState(null);
    const [detalleFiguraNombre, setDetalleFiguraNombre] = useState("");
    const [abrirForm, setAbrirForm] = useState(false);
    const [editandoProd, setEditandoProd] = useState(null);
    const [form, setForm] = useState(nuevoProductoVacio());
    const [errProd, setErrProd] = useState("");
    const [fCatProd, setFCatProd] = useState("");
    const mutationKeyRef = useRef(createInventoryIdempotencyKey());
    const finishedStock = useMemo(() => buildCanonicalFinishedStock(db, { today: hoyISO() }), [
      db.products, db.variantes, db.variantesCuarentena, db.inventory_reservations,
      db.production_batches, db.figuras, db.settings?.figuras,
    ]);
    const gramsForFigure = (figure) => Number(figure?.gramajeG)
      || Number.parseFloat(String(figure?.gramaje || "").replace(",", "."))
      || KITCHEN_FIGURE_DEFAULTS[figure?.nombre]?.grams
      || 0;

    const detalleProducto = detalleProductoId ? db.products.find((p) => p.id === detalleProductoId) : null;
    const canonicalFigureRows = useMemo(() => activeFigureCatalog(db)
      .filter((figure) => isKitchenFigureName(figure.nombre) && figureProductId(figure))
      .map((figure) => ({
        figure,
        product: (db.products || []).find((product) => product.id === figureProductId(figure)),
      }))
      .filter((row) => row.product && isCommercialFamilyProduct(row.product)), [db.figuras, db.products, db.settings?.figuras]);
    const mappedFamilyProductIds = useMemo(
      () => new Set((db.products || []).filter(isCommercialFamilyProduct).map((product) => product.id)),
      [db.products],
    );
    const puedeEditar = user === "Administrador" && serverDataReady && Boolean(db.productsServerReady);

    function abrirEdicionProducto(product) {
      const tipo = productTypeForCategory(product.cat);
      setEditandoProd(product);
      setForm({ nombre: product.nombre, cat: product.cat, tipo, especie: tipo === "momo" ? (product.especie || "gato") : "", precio: product.precio, precioRappi: product.precioRappi, costo: product.costo, prep: product.prep, frio: !!product.frio, lejano: !!product.lejano, desc: product.desc || "", comboSize: product.comboSize || "", componentProductIds: [...(product.componentProductIds || [])], empaqueItem: product.empaqueItem || "", colchonProduccion: product.colchonProduccion ?? 0 });
      setErrProd("");
      setAbrirForm(true);
    }

    async function ejecutarProductoDelta(operation, payload, legacyAction) {
      if (db.catalogCrmDeltaReady === true
          && typeof aplicarMutacionCatalogoCrm === "function"
          && typeof capturarContextoMutacionCatalogoCrm === "function") {
        const key = mutationKeyRef.current;
        const context = capturarContextoMutacionCatalogoCrm();
        const envelope = await mutarCatalogoCrmDelta(operation, payload, key);
        const applied = await aplicarMutacionCatalogoCrm(envelope, operation, context);
        mutationKeyRef.current = createInventoryIdempotencyKey();
        if (applied?.status === "discarded") await refrescar({ reason: "catalog-delta-discard" });
        return applied?.result;
      }
      const result = await legacyAction();
      await refrescar({ reason: "catalog-legacy-mutation" });
      return result;
    }

    async function cambiarProductoActivo(product) {
      try {
        await ejecutarProductoDelta(
          "set_producto_activo",
          { product_id: product.id, activo: !product.activo },
          () => setProductoActivo(product.id, !product.activo),
        );
        toast("ok", product.activo ? "Entrada desactivada del menú." : "Entrada activada en el menú.");
      } catch (error) { toast("error", error.message); }
    }

    function payloadProducto() {
      const allowedFamilyIds = new Set((db.products || []).filter(isCommercialFamilyProduct).map((product) => product.id));
      return {
        nombre: form.nombre.trim(), cat: form.cat, tipo: form.tipo,
        especie: form.tipo === "momo" ? form.especie : null,
        precio: Number(form.precio), precio_rappi: Number(form.precioRappi) || null,
        costo: Number(form.costo), prep: Number(form.prep) || 0,
        frio: Boolean(form.frio), lejano: Boolean(form.lejano), descr: form.desc || "",
        combo_size: form.tipo === "combo" ? Number(form.comboSize) : null,
        component_product_ids: form.tipo === "combo" ? [...new Set(form.componentProductIds || [])].filter((id) => allowedFamilyIds.has(id)) : [],
        empaque_item_id: form.tipo === "combo" ? form.empaqueItem : null,
        colchon_produccion: form.tipo === "momo" ? Number(form.colchonProduccion) || 0 : 0,
      };
    }

    async function guardarNuevo() {
      const nombre = form.nombre.trim();
      if (!nombre) { setErrProd("Falta el nombre"); return; }
      if (!(+form.precio > 0)) { setErrProd("Precio inválido"); return; }
      if (!(+form.costo >= 0)) { setErrProd("Costo inválido"); return; }
      if (form.tipo === "momo") { setErrProd("Las familias comerciales de figuras son canónicas. Vinculá o corregí sus figuras desde Producción; no crees otra desde Productos."); return; }
      if (form.tipo === "momo" && !["gato","perro"].includes(form.especie)) { setErrProd("Elegí la silueta visual de referencia: gato o perro."); return; }
      if (form.tipo === "combo") {
        const invalidComponents = (form.componentProductIds || []).filter((id) => !isCommercialFamilyProduct((db.products || []).find((product) => product.id === id)));
        if (!(+form.comboSize > 0)) { setErrProd("El combo necesita un tamaño (cuántos momos por caja)."); return; }
        if (!(form.componentProductIds || []).length) { setErrProd("Elegí al menos un momo componente."); return; }
        if (invalidComponents.length) { setErrProd("El combo solo puede incluir familias comerciales vinculadas a figuras de Cocina."); return; }
        if (!form.empaqueItem) { setErrProd("Elegí la caja (empaque) del combo."); return; }
      }
      try {
        const payload = payloadProducto();
        await ejecutarProductoDelta("crear_producto", payload, () => crearProducto(payload));
        setAbrirForm(false);
        setErrProd("");
        toast("ok", "Entrada comercial creada.");
      } catch (error) { toast("error", error.message); return; }
    }

    async function guardarEdicion() {
      const nombre = form.nombre.trim();
      if (!nombre) { setErrProd("Falta el nombre"); return; }
      if (!(+form.precio > 0)) { setErrProd("Precio inválido"); return; }
      if (!(+form.costo >= 0)) { setErrProd("Costo inválido"); return; }
      if (form.tipo === "momo" && !["gato","perro"].includes(form.especie)) { setErrProd("Elegí la silueta visual de referencia: gato o perro."); return; }
      if (form.tipo === "combo") {
        const invalidComponents = (form.componentProductIds || []).filter((id) => !isCommercialFamilyProduct((db.products || []).find((product) => product.id === id)));
        if (!(+form.comboSize > 0)) { setErrProd("El combo necesita un tamaño (cuántos momos por caja)."); return; }
        if (!(form.componentProductIds || []).length) { setErrProd("Elegí al menos un momo componente."); return; }
        if (invalidComponents.length) { setErrProd("El combo solo puede incluir familias comerciales vinculadas a figuras de Cocina."); return; }
        if (!form.empaqueItem) { setErrProd("Elegí la caja (empaque) del combo."); return; }
      }
      try {
        const payload = payloadProducto();
        await ejecutarProductoDelta("editar_producto", { product_id: editandoProd.id, ...payload }, () => editarProducto(editandoProd.id, payload));
        setAbrirForm(false);
        setErrProd("");
        toast("ok", "Entrada comercial actualizada.");
      } catch (error) { toast("error", error.message); return; }
    }

    const nonFamilyProducts = db.products.filter((product) => !isCommercialFamilyProduct(product));
    const totalProductos = canonicalFigureRows.length + nonFamilyProducts.length;
    const productosActivos = canonicalFigureRows.filter((row) => row.product.activo !== false).length
      + nonFamilyProducts.filter((product) => product.activo).length;
    const marginEntries = [...canonicalFigureRows.map((row) => row.product), ...nonFamilyProducts]
      .filter((product) => Number(product?.precio) > 0)
      .map((product) => (Number(product.precio) - Number(product.costo || 0)) / Number(product.precio));
    const margenPromedio = marginEntries.length
      ? marginEntries.reduce((sum, margin) => sum + margin, 0) / marginEntries.length
      : null;
    const productosOperativos = db.products.filter((product) => product.tipo !== "combo" && !mappedFamilyProductIds.has(product.id));
    const productosSinReceta = productosOperativos.filter((product) => recipeLines(db, product.id).length === 0).length;

    return (
      <div>
        <SectionTitle>Catálogo comercial</SectionTitle>
        <div className="text-xs font-semibold mb-3 -mt-3" style={{ color: T.choco2 }}>
          🧾 Las familias comerciales definen precio, disponibilidad y venta. Lizi, Momo, Rocco, Teo, Toby, Danna y Max conservan su ficha técnica en Producción; bebidas, crepas y cuchareables sí pueden tener receta propia por unidad.
        </div>
        {!puedeEditar && <div className="text-xs font-bold p-2.5 rounded-xl mb-2" style={{ background: T.vainilla, color: T.choco2 }}>{user === "Administrador" && !db.productsServerReady ? "Catálogo en modo consulta hasta aplicar la migración 13 de Productos." : "Catálogo en modo consulta. Las recetas y el paso a paso se gestionan desde Producción."}</div>}
        {!abrirForm && errProd && <div className="text-sm font-bold p-2.5 rounded-xl mb-2" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{errProd}</div>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat icon="🧾" label="Entradas" value={totalProductos} sub="figuras, combos y productos al momento" tone={T.coral} />
          <Stat icon="✅" label="Activos" value={productosActivos} sub="a la venta" tone="#3F6B42" />
          <Stat icon="⚠️" label="Sin receta" value={productosSinReceta} sub="preparaciones pendientes" tone="#96690F" />
          <Stat icon="📈" label="Margen prom." value={margenPromedio === null ? "—" : pct(margenPromedio)} sub="precio vs. costo" />
        </div>
        <div className="text-[11px] font-semibold mt-2 mb-4" style={{ color: T.choco2 }}>
          <b style={{ color: T.coral }}>{productosActivos}</b> activos de {totalProductos} · {productosSinReceta} sin receta.
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          {puedeEditar && <Btn small kind="rosa" onClick={() => { setForm(nuevoProductoVacio()); setEditandoProd(null); setErrProd(""); setAbrirForm(true); }}>＋ Nueva entrada comercial</Btn>}
        </div>

        <SegmentedTabs
          ariaLabel="Categorías de productos"
          value={fCatProd}
          onChange={setFCatProd}
          items={[["Todas", ""], ...cats.map((category) => [`${CAT_EMOJI[category] || ""} ${category}`.trim(), category])]}
          getCount={(value) => value === "Momos Signature" ? canonicalFigureRows.length : value ? db.products.filter((product) => product.cat === value && !isCommercialFamilyProduct(product)).length : totalProductos}
        />
        {cats.filter((cat) => !fCatProd || cat === fCatProd).map((cat) => {
          const rows = cat === "Momos Signature"
            ? canonicalFigureRows
            : db.products
              .filter((product) => product.cat === cat && !isCommercialFamilyProduct(product))
              .map((product) => ({ product, figure: null }));
          return (
            <div key={cat}>
              <SectionTitle>{CAT_EMOJI[cat]} {cat}</SectionTitle>
              {cat === "Momos Signature" && <div className="text-[11px] font-semibold -mt-3 mb-3" style={{ color: T.choco2 }}>Cada tarjeta es una figura física. La familia comercial solo define precio, reserva y presentación.</div>}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {rows.map(({ product: p, figure }) => {
                  const margen = p.precio > 0 ? (p.precio - p.costo) / p.precio : 0;
                  const figureVariants = figure ? finishedStock.variants.filter((variant) => variant.productId === p.id && variant.figura === figure.nombre) : [];
                  const figureSummary = figure ? finishedStock.figureSummaries.find((row) => row.figura === figure.nombre) : null;
                  const disp = figure ? Number(figureSummary?.available || 0) : availability(db, p);
                  const flavorCount = new Set(figureVariants.filter((variant) => Number(variant.disponibles || 0) > 0).map((variant) => variant.sabor).filter(Boolean)).size;
                  const recipeCount = recipeLines(db, p.id).length;
                  const displayName = figure?.nombre || p.nombre;
                  const grams = gramsForFigure(figure);
                  return (
                    <Card key={figure ? `figure-${displayName}` : p.id} className={`momo-queue-item p-4 ${!p.activo ? "opacity-60" : ""}`} onClick={() => { setDetalleProductoId(p.id); setDetalleFiguraNombre(figure?.nombre || ""); }} aria-label={`Abrir detalle de ${displayName}`}>
                      <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2.5 min-w-0"><span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg" style={{ background: T.rosa }} aria-hidden="true">{CAT_EMOJI[cat]}</span><div className="min-w-0"><div className="font-bold text-sm leading-tight">{displayName}</div><div className="text-[10px] font-extrabold uppercase tracking-wider mt-1" style={{ color: p.activo ? "#3F6B42" : T.choco2 }}>{p.activo ? figure ? "Figura activa" : "Activo en el menú" : "Fuera del menú"}</div></div></div><div className="display text-lg shrink-0" style={{ color: T.coral }}>{fmt(p.precio)}</div></div>
                      <div className="flex items-end justify-between gap-3 mt-3"><div><div className="text-xs font-bold" style={{ color: margen > 0.6 ? "#3F6B42" : "#96690F" }}>{figure ? `${grams} g · ${commercialFamilyLabel(p)}` : `Margen ${pct(margen)}`}</div><div className="text-[11px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{figure ? `${flavorCount} sabor${flavorCount === 1 ? "" : "es"} con stock exacto` : recipeCount ? `Receta con ${recipeCount} insumo${recipeCount === 1 ? "" : "s"}` : p.tipo === "combo" ? "Composición comercial" : "Sin receta registrada"}</div></div><div className="text-right text-xs font-extrabold" style={{ color: isFinite(disp) && disp <= 2 ? "#A03B2A" : T.choco2 }}>{isFinite(disp) ? `${disp} disp.` : "Bajo pedido"}</div></div>
                      <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t text-[11px] font-bold" style={{ borderColor: T.border, color: T.choco2 }}><span>{figure ? "Figura física" : p.tipo === "combo" ? "Combo" : p.tipo === "momo" ? "Configuración inconsistente · revisar" : "Preparación al momento"}{p.frio ? " · requiere frío" : ""}</span><span style={{ color: T.coral }}>Abrir detalle ›</span></div>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}

        {detalleProducto && (() => {
          const lines = recipeLines(db, detalleProducto.id);
          const linkedFigures = activeFigureCatalog(db).filter((figure) => isKitchenFigureName(figure.nombre) && figureProductId(figure) === detalleProducto.id);
          const isCommercialFamily = isCommercialFamilyProduct(detalleProducto);
          const selectedFigure = isCommercialFamily ? linkedFigures.find((figure) => figure.nombre === detalleFiguraNombre) || linkedFigures[0] || null : null;
          const selectedFigureVariants = selectedFigure ? finishedStock.variants.filter((variant) => variant.productId === detalleProducto.id && variant.figura === selectedFigure.nombre) : [];
          const selectedFigureAvailability = selectedFigure
            ? Number(finishedStock.figureSummaries.find((row) => row.figura === selectedFigure.nombre)?.available || 0)
            : 0;
          const margen = detalleProducto.precio > 0 ? (detalleProducto.precio - detalleProducto.costo) / detalleProducto.precio : 0;
          const disp = selectedFigure ? selectedFigureAvailability : availability(db, detalleProducto);
          const comboProducts = (detalleProducto.componentProductIds || []).map((id) => db.products.find((product) => product.id === id)?.nombre).filter(Boolean);
          const pack = db.inventory_items.find((item) => item.id === detalleProducto.empaqueItem);
          const usesHorizontal = productUsesHorizontalFigure(detalleProducto);
          const closeDetail = () => { setDetalleProductoId(null); setDetalleFiguraNombre(""); };
          return (
            <Modal title={`${selectedFigure ? "Figura" : isCommercialFamily ? "Familia comercial" : "Producto"} · ${selectedFigure?.nombre || detalleProducto.nombre}`} onClose={closeDetail} wide>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>{CAT_EMOJI[detalleProducto.cat]} {selectedFigure ? `FIGURA FÍSICA · ${commercialFamilyLabel(detalleProducto)}` : detalleProducto.cat}</div><div className="display text-2xl font-semibold mt-0.5">{selectedFigure?.nombre || detalleProducto.nombre}</div><div className="text-sm font-semibold mt-1 max-w-2xl" style={{ color: T.choco2 }}>{selectedFigure ? `${gramsForFigure(selectedFigure)} g · su sabor se elige por separado · la familia comercial define el precio y la reserva.` : detalleProducto.desc || "Sin descripción comercial registrada."}</div></div>
                <Badge label={detalleProducto.activo ? "Activo" : "Inactivo"} map={{ Activo: { bg: "#DDEBD9", fg: "#3F6B42" }, Inactivo: { bg: "#EBE6E0", fg: "#7A6E63" } }} />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <Stat icon="$" label={selectedFigure ? "Precio de la familia" : "Precio directo"} value={fmt(detalleProducto.precio)} sub={selectedFigure ? commercialFamilyLabel(detalleProducto) : "precio de venta"} tone={T.coral} />
                <Stat icon="R" label="Precio Rappi" value={fmt(detalleProducto.precioRappi)} sub="canal plataforma" tone="#63518A" />
                <Stat icon="◒" label={selectedFigure ? "Costo de referencia" : "Costo"} value={fmt(detalleProducto.costo)} sub={selectedFigure ? "registrado en la familia" : "registrado"} tone={T.choco} />
                <Stat icon="↗" label="Margen" value={pct(margen)} sub="precio vs. costo" tone={margen > 0.6 ? "#3F6B42" : "#96690F"} />
              </div>

              <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-3 mb-4">
                <Card className="p-4">
                  <div className="text-xs font-extrabold mb-3" style={{ color: T.choco2 }}>OPERACIÓN Y VENTA</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                    <div><div className="font-semibold" style={{ color: T.choco2 }}>Clase operativa</div><div className="font-bold mt-0.5">{selectedFigure ? `Figura física · presentación ${commercialFamilyLabel(detalleProducto)}` : isCommercialFamily ? "Familia comercial sin figura seleccionada" : detalleProducto.tipo === "momo" ? "Configuración inconsistente: figura fuera del catálogo canónico" : detalleProducto.tipo === "combo" ? "Caja / combo" : "Preparación al momento"}</div></div>
                    <div><div className="font-semibold" style={{ color: T.choco2 }}>Disponibilidad</div><div className="font-bold mt-0.5" style={{ color: isFinite(disp) && disp <= 2 ? "#A03B2A" : "#3F6B42" }}>{isFinite(disp) ? `${disp} unidades` : "Bajo pedido"}</div></div>
                    <div><div className="font-semibold" style={{ color: T.choco2 }}>Preparación</div><div className="font-bold mt-0.5">{detalleProducto.prep || 0} min</div></div>
                    <div><div className="font-semibold" style={{ color: T.choco2 }}>Cadena de frío</div><div className="font-bold mt-0.5">{detalleProducto.frio ? "Requerida" : "No requerida"}</div></div>
                    <div><div className="font-semibold" style={{ color: T.choco2 }}>Domicilio lejano</div><div className="font-bold mt-0.5">{detalleProducto.lejano ? "Permitido" : "Solo zona cercana"}</div></div>
                    {detalleProducto.tipo === "momo" && <div><div className="font-semibold" style={{ color: T.choco2 }}>Colchón producción</div><div className="font-bold mt-0.5">{detalleProducto.colchonProduccion || 0} unidades</div></div>}
                  </div>
                  {detalleProducto.tipo === "combo" && <div className="mt-4 pt-3 border-t" style={{ borderColor: T.border }}><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Composición permitida</div><div className="text-xs font-bold mt-1">{detalleProducto.comboSize || 0} momos · caja {pack?.nombre || "sin configurar"}</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{comboProducts.join(" · ") || "Sin productos componentes"}</div></div>}
                  {usesHorizontal && <div className="rounded-xl p-3 mt-4 text-[10px] font-bold" style={{ background: "#FFF1D6", color: "#7A5510" }}>Horizontal es una decoración auxiliar de esta preparación. Solo permanece visible mientras este producto o alguna preparación compatible esté activa; no se ofrece como figura del pedido ni suma inventario terminado.</div>}
                </Card>

                {isCommercialFamily && <Card className="p-4">
                  <div className="text-xs font-extrabold" style={{ color: T.choco2 }}>FIGURAS DE ESTA FAMILIA COMERCIAL</div>
                  <div className="text-[11px] font-semibold mt-0.5 mb-3" style={{ color: T.choco2 }}>Esta presentación define venta, precio y reserva. Cada personaje conserva su identidad y ficha técnica en Producción.</div>
                  <div className="space-y-2">{linkedFigures.map((figure) => <button type="button" key={figure.nombre} className="rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-xs w-full text-left" onClick={() => setDetalleFiguraNombre(figure.nombre)} style={{ background: selectedFigure?.nombre === figure.nombre ? "#F6D9DF" : T.vainilla, outline: selectedFigure?.nombre === figure.nombre ? `1px solid ${T.coral}` : "none" }}><span className="font-bold">{figure.nombre}</span><span className="font-extrabold shrink-0" style={{ color: T.coral }}>{gramsForFigure(figure)} g</span></button>)}{linkedFigures.length === 0 && <div className="rounded-xl p-3 text-xs font-semibold" style={{ background: "#FBE8C8", color: "#7A5410" }}>Esta familia comercial todavía no tiene figuras físicas vinculadas. Producción seguirá mostrando las siete figuras activas para corregir la asignación sin inventar una receta.</div>}</div>
                  {selectedFigure && <div className="mt-3 pt-3 border-t" style={{ borderColor: T.border }}><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Stock exacto por sabor</div><div className="flex flex-wrap gap-1.5 mt-2">{selectedFigureVariants.filter((variant) => Number(variant.disponibles || 0) > 0).map((variant) => <span key={`${variant.sabor}-${variant.vence || ""}`} className="rounded-full px-2 py-1 text-[10px] font-extrabold" style={{ background: "#E6F1E3", color: "#3F6B42" }}>{variant.sabor || "Sin sabor"} · {variant.disponibles}</span>)}{selectedFigureVariants.every((variant) => Number(variant.disponibles || 0) <= 0) && <span className="text-[11px] font-semibold" style={{ color: T.choco2 }}>Sin unidades vendibles exactas.</span>}</div></div>}
                  <div className="rounded-xl p-3 text-[10px] font-bold mt-3" style={{ background: "#E6F1E3", color: "#3F6B42" }}>✓ La mousse se elige por sabor y los rellenos se calculan desde las elaboraciones vigentes; no se usa una receta genérica para toda la familia.</div>
                </Card>}

                {!isCommercialFamily && <Card className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-3"><div><div className="text-xs font-extrabold" style={{ color: T.choco2 }}>RECETA POR UNIDAD</div><div className="text-[11px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{lines.length ? `${lines.length} insumo${lines.length === 1 ? "" : "s"} vinculados` : "No descuenta inventario todavía"}</div></div><span className="display text-lg" style={{ color: T.coral }}>{fmt(recipeCost(db, detalleProducto.id))}</span></div>
                  <div className="space-y-2">{lines.slice(0, 6).map((line) => { const item = db.inventory_items.find((candidate) => candidate.id === line.itemId); return <div key={line.id || line.itemId} className="rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-xs" style={{ background: T.vainilla }}><span className="font-bold">{item?.nombre || "Insumo no encontrado"}</span><span className="font-extrabold shrink-0" style={{ color: T.choco2 }}>{line.cantidad} {item?.unidad || ""}</span></div>; })}{lines.length === 0 && <div className="rounded-xl p-3 text-xs font-semibold" style={{ background: "#FBE8C8", color: "#7A5410" }}>Falta registrar la receta para tener costo y descuento de inventario trazables.</div>}{lines.length > 6 && <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>＋ {lines.length - 6} insumo(s) más en la receta completa.</div>}</div>
                  {lines.length > 0 && <div className="text-[10px] font-bold mt-3" style={{ color: Math.abs(recipeCost(db, detalleProducto.id) - detalleProducto.costo) > detalleProducto.costo * 0.15 ? "#96690F" : "#3F6B42" }}>Costo receta {fmt(recipeCost(db, detalleProducto.id))} · registrado {fmt(detalleProducto.costo)}</div>}
                </Card>}
              </div>

              <div className="flex flex-wrap gap-2 pt-4 border-t" style={{ borderColor: T.border }}>
                <Btn kind="rosa" onClick={() => { const productId = detalleProducto.id; const figure = selectedFigure?.nombre || ""; closeDetail(); go?.("Producción", { productId, figure, manageProductRecipe: true, source: "Productos" }); }}>{isCommercialFamily ? `📖 Abrir ${selectedFigure?.nombre || "la familia"} en Producción` : "📖 Gestionar receta en Producción"}</Btn>
                {puedeEditar && !isCommercialFamily && <Btn kind="ghost" onClick={() => abrirEdicionProducto(detalleProducto)}>✏️ Editar entrada comercial</Btn>}
                {puedeEditar && !isCommercialFamily && <BtnAsync kind={detalleProducto.activo ? "ghost" : "soft"} textoEnVuelo={detalleProducto.activo ? "Desactivando…" : "Activando…"} onClick={() => cambiarProductoActivo(detalleProducto)}>{detalleProducto.activo ? "Desactivar del menú" : "Activar en el menú"}</BtnAsync>}
              </div>
            </Modal>
          );
        })()}

        {abrirForm && (
          <Modal title={editandoProd ? "Editar entrada comercial" : "Nueva entrada comercial"} onClose={() => setAbrirForm(false)}>
            <Field label="Nombre"><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Field>
            <Field label="Categoría">
              <Select options={editandoProd ? cats : cats.filter((category) => category !== "Momos Signature")} value={form.cat} onChange={(e) => {
                const cat = e.target.value;
                const tipo = productTypeForCategory(cat);
                setForm({
                  ...form, cat, tipo,
                  especie: tipo === "momo" ? (form.especie || "gato") : "",
                  componentProductIds: tipo === "combo" ? (form.componentProductIds || []) : [],
                  comboSize: tipo === "combo" ? form.comboSize : "",
                  empaqueItem: tipo === "combo" ? form.empaqueItem : "",
                });
              }} />
            </Field>
            <Field label="Clase de entrada">
              <select value={form.tipo} disabled className={inputCls} style={inputStyle}>
                <option value="momo">Familia comercial de figuras</option>
                <option value="pedido">Preparación al momento</option>
                <option value="combo">Caja / combo</option>
              </select>
              <div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>MOMO OPS la deriva de la categoría para que una bebida o cuchareable nunca se convierta en figura.</div>
            </Field>
            {form.tipo === "momo" && <Field label="Silueta visual de referencia (metadato)"><Select options={["gato","perro"]} value={form.especie} onChange={(e) => setForm({ ...form, especie: e.target.value })} /><div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>No define la figura física: Lizi, Momo, Rocco, Teo, Toby, Danna y Max se administran en Producción.</div></Field>}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Precio"><Input type="number" min="0" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} /></Field>
              <Field label="Precio Rappi"><Input type="number" min="0" value={form.precioRappi} onChange={(e) => setForm({ ...form, precioRappi: e.target.value })} /></Field>
              <Field label="Costo"><Input type="number" min="0" value={form.costo} onChange={(e) => setForm({ ...form, costo: e.target.value })} /></Field>
              <Field label="Prep (min)"><Input type="number" min="0" value={form.prep} onChange={(e) => setForm({ ...form, prep: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Requiere frío"><Select options={["Sí", "No"]} value={form.frio ? "Sí" : "No"} onChange={(e) => setForm({ ...form, frio: e.target.value === "Sí" })} /></Field>
              <Field label="Apto domicilio lejano"><Select options={["Sí", "No"]} value={form.lejano ? "Sí" : "No"} onChange={(e) => setForm({ ...form, lejano: e.target.value === "Sí" })} /></Field>
            </div>
            {editandoProd && form.tipo === "momo" && user === "Administrador" && (
              <Field label="🛡️ Colchón de producción (unidades extra por corrida — absorbe imperfectas y mostrador)">
                <Input type="number" min="0" step="1" value={form.colchonProduccion ?? 0} onChange={(e) => setForm({ ...form, colchonProduccion: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
              </Field>
            )}
            <Field label="Descripción"><Input value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} /></Field>
            {form.tipo === "combo" && (
              <div className="p-3 rounded-xl mb-3" style={{ background: T.vainilla }}>
                <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>🎁 CONFIGURACIÓN DEL COMBO</div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Momos por caja"><Input type="number" min="1" value={form.comboSize} onChange={(e) => setForm({ ...form, comboSize: e.target.value })} /></Field>
                  <Field label="Caja (empaque)">
                    <select value={form.empaqueItem} onChange={(e) => setForm({ ...form, empaqueItem: e.target.value })} className={inputCls} style={inputStyle}>
                      <option value="">Elegir caja…</option>
                      {db.inventory_items.filter((i) => i.cat === "Cajas").map((i) => <option key={i.id} value={i.id}>{i.nombre} · {i.stock} und</option>)}
                    </select>
                  </Field>
                </div>
                <div className="text-[11px] font-bold mt-1 mb-1" style={{ color: T.choco2 }}>Familias comerciales permitidas (la figura y el sabor exactos se eligen al armar la caja):</div>
                <div className="flex flex-wrap gap-1.5">
                  {db.products.filter((p) => isCommercialFamilyProduct(p) && p.activo).map((p) => {
                    const on = (form.componentProductIds || []).includes(p.id);
                    const exactFigures = activeFigureCatalog(db).filter((figure) => figureProductId(figure) === p.id && isKitchenFigureName(figure.nombre)).map((figure) => figure.nombre);
                    return (
                      <button key={p.id} type="button" onClick={() => setForm((f) => {
                        const cur = f.componentProductIds || [];
                        return { ...f, componentProductIds: cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id] };
                      })} className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                        style={{ background: on ? T.coral : T.surface, color: on ? "#fff" : T.choco2, border: "1px solid " + (on ? T.coral : T.border) }}>
                        {commercialFamilyLabel(p)}{exactFigures.length ? ` · ${exactFigures.join(", ")}` : " · sin figuras vinculadas"}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <Field label="Atributos que pedirá al vender">
              <div className="flex gap-2 flex-wrap items-center">
                {atributosDeTipo(form).length === 0
                  ? <span className="text-xs font-semibold" style={{ color: T.choco2 }}>Ninguno — se vende tal cual (sin sabor/salsa/figura).</span>
                  : atributosDeTipo(form).map((key) => (
                      <span key={key} className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: T.vainilla, color: T.choco2 }}>{ATRIBUTO_LABEL[key]}</span>
                    ))}
              </div>
              <div className="text-[11px] font-semibold mt-1.5" style={{ color: T.choco2 }}>
                Se derivan de la clase técnica automáticamente. La figura física se define en Producción y en cada línea del pedido, nunca desde el nombre comercial de esta ficha.
              </div>
            </Field>
            {errProd && <div className="text-sm font-bold mb-3" style={{ color: T.coral }}>{errProd}</div>}
            <div className="flex justify-end">
              <BtnAsync kind="rosa" onClick={editandoProd ? guardarEdicion : guardarNuevo}>Guardar</BtnAsync>
            </div>
          </Modal>
        )}

      </div>
    );
  }

  /* ================= DOMICILIOS ================= */

  const DOM_ESTADOS = ["Por solicitar","Solicitado","Asignado","En ruta","Entregado","Problema","Cancelado"];

  function Domicilios({ db, sincronizarPedidos, aplicarMutacionDomicilio, capturarGeneracionPedidos, solicitarConciliacionPedidos }) {
    const [nuevo, setNuevo] = useState(false);
    const [detallePedidoId, setDetallePedidoId] = useState("");
    const [avisoDom, setAvisoDom] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const mutationKeysRef = useRef(new Map());
    const s = db.settings;
    const deliveryDb = useMemo(() => db.deliverySnapshotReady ? {
      ...db,
      orders: db.deliveryOrders,
      order_items: db.deliveryOrderItems,
      customers: db.deliveryCustomers,
      deliveries: db.deliveryDeliveries,
    } : db, [db]);
    const [form, setForm] = useState({ orderId: "", proveedor: s.proveedores[0], costoReal: "", zona: s.zonas[0].nombre, obs: "" });
    const [scope, setScope] = useState("active");
    const pedidosActivos = useMemo(() => buildDeliveryOrderBoard({ orders: deliveryDb.orders, deliveries: deliveryDb.deliveries, scope: "active" }), [deliveryDb.orders, deliveryDb.deliveries]);
    const pedidosHistoricos = useMemo(() => buildDeliveryOrderBoard({ orders: deliveryDb.orders, deliveries: deliveryDb.deliveries, scope: "history" }), [deliveryDb.orders, deliveryDb.deliveries]);
    const tarjetasDomicilio = scope === "active" ? pedidosActivos : pedidosHistoricos;
    const tarjetaDetalle = tarjetasDomicilio.find((card) => card.order.id === detallePedidoId) || null;
    const clienteDetalle = tarjetaDetalle ? customerOf(deliveryDb, tarjetaDetalle.order.customerId) : null;
    const productosDetalle = tarjetaDetalle ? itemsOf(deliveryDb, tarjetaDetalle.order.id) : [];

    const subsidio = deliveryDb.deliveries.reduce((sm, d) => sm + Math.max(0, d.costoReal - d.cobrado), 0);
    const excedente = deliveryDb.deliveries.reduce((sm, d) => sm + Math.max(0, d.cobrado - d.costoReal), 0);
    const pedidosSinDomicilio = deliveryDb.orders
      .filter((o) => !["Entregado", "Cancelado"].includes(o.estado))
      .filter((o) => o.canal !== "Rappi")
      .filter((o) => !deliveryDb.deliveries.some((delivery) => delivery.orderId === o.id && deliveryBlocksNewRequest(delivery)));
    const pendientes = pedidosSinDomicilio.filter((o) => ["Empacado","Listo para despacho"].includes(o.estado));

    function abrirAsignacion(order) {
      setForm((actual) => ({
        ...actual,
        orderId: order.id,
        zona: order.zona || actual.zona,
        costoReal: order.domCosto > 0 ? String(order.domCosto) : actual.costoReal,
        obs: order.obs || "",
      }));
      setDetallePedidoId("");
      setNuevo(true);
    }

    function llaveMutacion(operation, payload) {
      const signature = `${operation}:${JSON.stringify(payload)}`;
      if (!mutationKeysRef.current.has(signature)) {
        mutationKeysRef.current.set(signature, createInventoryIdempotencyKey());
      }
      return { signature, key: mutationKeysRef.current.get(signature) };
    }

    async function ejecutarMutacionDomicilio(operation, payload, legacyMutation) {
      if (db.deliveryMutationDeltaReady !== true) {
        await legacyMutation();
        await sincronizarPedidos([payload.order_id]);
        return { status: "legacy" };
      }
      const { signature, key } = llaveMutacion(operation, payload);
      const generation = capturarGeneracionPedidos();
      const envelope = await mutarDomicilioDelta(operation, payload, key);
      mutationKeysRef.current.delete(signature);
      try {
        const result = await aplicarMutacionDomicilio(envelope, operation, generation);
        if (result?.status === "discarded") await solicitarConciliacionPedidos();
        return result;
      } catch (error) {
        // El servidor ya pudo confirmar el commit. Conciliar es seguro; repetir
        // la escritura con una llave nueva no lo sería.
        await solicitarConciliacionPedidos();
        return { status: "reconciled", recoveredFrom: error?.message || "invalid_delivery_receipt" };
      }
    }

    async function cambiarEstadoDomicilio(delivery, nuevoEstado) {
      setEnviando(true);
      try {
        if (nuevoEstado === "En ruta" || nuevoEstado === "Entregado") {
          await ejecutarMutacionDomicilio(
            "transition",
            { order_id: delivery.orderId, estado: nuevoEstado },
            () => setOrderStatusRemoto(delivery.orderId, nuevoEstado),
          );
        } else {
          await ejecutarMutacionDomicilio(
            "update",
            { order_id: delivery.orderId, delivery_id: delivery.id, estado: nuevoEstado },
            () => actualizarDomicilio(delivery.id, { estado: nuevoEstado }),
          );
        }
      } catch (error) {
        setAvisoDom({
          titulo: nuevoEstado === "En ruta" || nuevoEstado === "Entregado" ? "No se puede despachar todavía" : "No se pudo actualizar el domicilio",
          texto: error.message,
        });
        setEnviando(false);
        return;
      }
      setDetallePedidoId("");
      setEnviando(false);
    }

    function exportar() {
      downloadCSV("domicilios",
        ["ID","Pedido","Proveedor","Zona","Cobrado","Costo real","Diferencia","Solicitud","Salida","Entrega","Código","Estado"],
        tarjetasDomicilio.map(({ order, delivery }) => [
          delivery?.id || "Sin asignar", order.id, delivery?.proveedor || "", delivery?.zona || order.zona || "",
          delivery?.cobrado ?? order.domCobrado ?? 0, delivery?.costoReal ?? order.domCosto ?? 0,
          delivery ? delivery.cobrado - delivery.costoReal : "", delivery?.hSolicitud || "", delivery?.hSalida || "",
          delivery?.hEntrega || "", delivery?.codigo || "", delivery?.estado || "Sin domicilio",
        ]));
    }

    return (
      <div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat icon="🛵" label="Pedidos en logística" value={pedidosActivos.length} onClick={() => { setScope("active"); setTimeout(() => { const el = document.getElementById("lista-domicilios"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0); }} active={scope === "active"} />
          <Stat icon="🧾" label="Subsidio acumulado" value={fmt(subsidio)} sub="cobramos menos que el costo" tone="#A03B2A" />
          <Stat icon="💰" label="Excedente cobrado" value={fmt(excedente)} sub="cobramos más que el costo" tone="#3F6B42" />
          <Stat icon="📦" label="Listos sin domicilio" value={pendientes.length} sub="pedidos por solicitar" tone={pendientes.length ? "#96690F" : undefined} />
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <Btn onClick={() => { setForm({ orderId: "", proveedor: s.proveedores[0], costoReal: "", zona: s.zonas[0].nombre, obs: "" }); setNuevo(true); }}>＋ Asignar domicilio</Btn>
          <WorkScopeTabs value={scope} onChange={setScope} activeCount={pedidosActivos.length} historyCount={pedidosHistoricos.length} activeLabel="En seguimiento" />
          <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
        </div>

        {pendientes.length > 0 && (
          <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: "#FBE8C8", color: "#96690F" }}>
            ⏰ Pedidos listos esperando domicilio: {pendientes.map((o) => o.id).join(", ")}
          </div>
        )}

        <div id="lista-domicilios" />
        <SectionTitle>{scope === "active" ? "Pedidos para entrega" : "Pedidos entregados o cancelados"}</SectionTitle>
        <div className="grid lg:grid-cols-2 gap-3">
          {tarjetasDomicilio.map((card) => {
            const { order, delivery } = card;
            const customer = customerOf(deliveryDb, order.customerId);
            const orderItems = itemsOf(deliveryDb, order.id);
            const roots = orderItems.filter((item) => !item.parentItemId && !item.parent_item_id);
            const productos = roots.map((item) => {
              const presentation = orderLinePresentation(item, productOf(deliveryDb, item.productId));
              const childCount = orderItems.filter((candidate) => (candidate.parentItemId || candidate.parent_item_id) === item.id).length;
              return `${presentation.quantityLabel}${childCount ? ` · ${childCount} postres exactos` : ""}`;
            }).join(" · ");
            return (
              <Card key={order.id} className="p-4" onClick={() => setDetallePedidoId(order.id)} aria-label={`Abrir domicilio del pedido ${order.id}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: card.needsAssignment ? "#A03B2A" : T.choco2 }}>
                      {card.needsAssignment ? "Listo · falta domicilio" : "Seguimiento de entrega"}
                    </div>
                    <div className="display text-lg font-semibold">Pedido {order.id}</div>
                    <div className="text-xs truncate" style={{ color: T.choco2 }}>{customer.nombre || "Cliente sin nombre"} · {order.barrio || customer.barrio || "Sin barrio"}</div>
                  </div>
                  <Badge label={delivery?.estado || "Sin domicilio"} />
                </div>
                <div className="mt-3 text-sm font-semibold line-clamp-2">{productos || "Sin productos cargados"}</div>
                <div className="mt-2 text-xs truncate" style={{ color: T.choco2 }}>
                  📍 {order.direccion || customer.direccion || "Falta dirección"}
                </div>
                <div className="mt-3 pt-3 border-t flex items-end justify-between gap-3" style={{ borderColor: T.border }}>
                  <div className="min-w-0">
                    <div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Siguiente paso</div>
                    <div className="text-xs font-bold mt-0.5">{deliveryNextStep(card)}</div>
                  </div>
                  <span className="text-xs font-extrabold whitespace-nowrap" style={{ color: T.coral }}>{card.needsAssignment ? "Asignar ›" : "Abrir ›"}</span>
                </div>
              </Card>
            );
          })}
          {!tarjetasDomicilio.length && <Empty icon={scope === "active" ? "🛵" : "◷"} text={scope === "active" ? "No hay pedidos esperando o usando domicilio." : "Todavía no hay pedidos entregados o cancelados."} />}
        </div>

        {tarjetaDetalle && (
          <Modal wide title={`Pedido ${tarjetaDetalle.order.id} · entrega`} onClose={() => setDetallePedidoId("")}>
            <div className="rounded-2xl border p-4 mb-4" style={{ background: tarjetaDetalle.needsAssignment ? "#FFF4DF" : "#EEF6EA", borderColor: tarjetaDetalle.needsAssignment ? "#E8B55B" : "#A9CBA7" }}>
              <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: tarjetaDetalle.needsAssignment ? "#96690F" : "#3F6B42" }}>Siguiente paso</div>
              <div className="display text-lg font-semibold mt-1">{deliveryNextStep(tarjetaDetalle)}</div>
              <div className="text-xs mt-1" style={{ color: T.choco2 }}>El pedido es la unidad de trabajo. El código {tarjetaDetalle.delivery?.id || "D-xxx"} permanece como trazabilidad interna.</div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <Card className="p-4">
                <div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.choco2 }}>Cliente y destino</div>
                <div className="font-bold">{clienteDetalle?.nombre || "Sin nombre"}</div>
                <div className="text-sm">{clienteDetalle?.telefono || "Sin teléfono"}</div>
                <div className="text-sm font-semibold mt-3">📍 {tarjetaDetalle.order.direccion || clienteDetalle?.direccion || "Sin dirección"}</div>
                <div className="text-xs mt-1" style={{ color: T.choco2 }}>{tarjetaDetalle.order.barrio || clienteDetalle?.barrio || "Sin barrio"} · {tarjetaDetalle.order.zona || "Sin zona"}</div>
                <div className="text-xs mt-3 rounded-xl p-2.5" style={{ background: T.vainilla, color: T.choco2 }}>{tarjetaDetalle.order.obs || "Sin referencia adicional de entrega."}</div>
              </Card>

              <Card className="p-4">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Domicilio asignado</div>
                    <div className="font-bold mt-1">{tarjetaDetalle.delivery ? `${tarjetaDetalle.delivery.proveedor} · ${tarjetaDetalle.delivery.id}` : "Todavía sin asignar"}</div>
                  </div>
                  <Badge label={tarjetaDetalle.delivery?.estado || "Sin domicilio"} />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <div><span style={{ color: T.choco2 }}>Zona</span><div className="font-bold">{tarjetaDetalle.delivery?.zona || tarjetaDetalle.order.zona || "—"}</div></div>
                  <div><span style={{ color: T.choco2 }}>Código</span><div className="font-bold">{tarjetaDetalle.delivery?.codigo || "—"}</div></div>
                  <div><span style={{ color: T.choco2 }}>Cobrado</span><div className="font-bold">{fmt(tarjetaDetalle.delivery?.cobrado ?? tarjetaDetalle.order.domCobrado ?? 0)}</div></div>
                  <div><span style={{ color: T.choco2 }}>Costo real</span><div className="font-bold">{fmt(tarjetaDetalle.delivery?.costoReal ?? tarjetaDetalle.order.domCosto ?? 0)}</div></div>
                </div>
                {tarjetaDetalle.delivery?.obs && <div className="text-xs mt-3">📝 {tarjetaDetalle.delivery.obs}</div>}
              </Card>
            </div>

            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.choco2 }}>Contenido del pedido</div>
              <Card className="p-4">
                {productosDetalle.filter((item) => !item.parentItemId && !item.parent_item_id).map((item) => {
                  const presentation = orderLinePresentation(item, productOf(deliveryDb, item.productId));
                  const children = productosDetalle.filter((candidate) => (candidate.parentItemId || candidate.parent_item_id) === item.id);
                  return <div key={item.id} className="py-2 border-b last:border-b-0" style={{ borderColor: T.border }}>
                    <div className="flex justify-between gap-3 text-sm"><span className="font-bold">{presentation.quantityLabel}</span><span className="font-bold whitespace-nowrap">{fmt(item.precio * item.cant)}</span></div>
                    {presentation.secondary && <div className="text-[11px] mt-0.5" style={{ color: T.choco2 }}>{presentation.secondary}</div>}
                    {children.length > 0 && <div className="mt-2 pl-3 border-l space-y-1" style={{ borderColor: T.rosaDeep }}>{children.map((child) => { const childPresentation = orderLinePresentation(child, productOf(deliveryDb, child.productId)); return <div key={child.id}><div className="text-xs font-bold">{childPresentation.quantityLabel}</div>{childPresentation.secondary && <div className="text-[10px]" style={{ color: T.choco2 }}>{childPresentation.secondary}</div>}</div>; })}</div>}
                  </div>;
                })}
                {!productosDetalle.length && <div className="text-sm" style={{ color: T.choco2 }}>Sin productos cargados.</div>}
                <div className="flex justify-between gap-3 mt-3 pt-3 border-t font-bold" style={{ borderColor: T.border }}><span>Total del pedido</span><span>{fmt(orderTotal(deliveryDb, tarjetaDetalle.order))}</span></div>
              </Card>
            </div>

            {tarjetaDetalle.delivery && (
              <div className="mt-4">
                <div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.choco2 }}>Tiempos del domicilio</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[["Solicitud", tarjetaDetalle.delivery.hSolicitud || "—"], ["Salida", tarjetaDetalle.delivery.hSalida || "—"], ["Entrega", tarjetaDetalle.delivery.hEntrega || "—"]].map(([label, value]) => (
                    <div key={label} className="rounded-xl border py-2" style={{ background: T.vainilla, borderColor: T.border }}>
                      <div className="font-bold">{value}</div><div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tarjetaDetalle.attempts.length > 1 && (
              <div className="mt-4">
                <div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.choco2 }}>Intentos de domicilio</div>
                <Card className="p-3">
                  {tarjetaDetalle.attempts.map((attempt) => (
                    <div key={attempt.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0" style={{ borderColor: T.border }}>
                      <div className="text-sm"><b>{attempt.id}</b> · {attempt.proveedor || "Sin proveedor"}</div><Badge label={attempt.estado} />
                    </div>
                  ))}
                </Card>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2 mt-5">
              {tarjetaDetalle.needsAssignment && <Btn onClick={() => abrirAsignacion(tarjetaDetalle.order)}>🛵 Asignar domicilio</Btn>}
              {tarjetaDetalle.delivery && scope === "active" && (
                <Field label="Actualizar seguimiento">
                  <MiniSelect options={DOM_ESTADOS} value={tarjetaDetalle.delivery.estado} disabled={enviando} onChange={(event) => cambiarEstadoDomicilio(tarjetaDetalle.delivery, event.target.value)} />
                </Field>
              )}
              <Btn kind="ghost" onClick={() => setDetallePedidoId("")}>Cerrar</Btn>
            </div>
          </Modal>
        )}

        {nuevo && (
          <Modal title="Asignar domicilio al pedido" onClose={() => setNuevo(false)}>
            <Field label="Pedido">
              <Select placeholder="Elegir pedido…" options={pedidosSinDomicilio.map((o) => o.id)} value={form.orderId} onChange={(e) => {
                const o = deliveryDb.orders.find((x) => x.id === e.target.value);
                setForm({ ...form, orderId: e.target.value, zona: o ? o.zona : form.zona });
              }} />
            </Field>
            <Field label="Proveedor"><Select options={s.proveedores} value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} /></Field>
            <Field label="Zona"><Select options={s.zonas.map((z) => z.nombre)} value={form.zona} onChange={(e) => setForm({ ...form, zona: e.target.value })} /></Field>
            <Field label="Costo real cotizado"><Input type="number" min="0" value={form.costoReal} onChange={(e) => setForm({ ...form, costoReal: e.target.value })} /></Field>
            <Field label="Observaciones"><Input value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} /></Field>
            <div className="flex gap-2 mt-2">
              <Btn disabled={enviando} onClick={async () => {
                if (!form.orderId) return;
                setEnviando(true);
                try {
                  const payload = {
                    order_id: form.orderId,
                    proveedor: form.proveedor,
                    zona: form.zona,
                    costo_real: Math.max(0, +form.costoReal || 0),
                    obs: form.obs,
                  };
                  await ejecutarMutacionDomicilio(
                    "assign",
                    payload,
                    () => crearDomicilio(form.orderId, form.proveedor, form.zona, payload.costo_real, form.obs),
                  );
                } catch (e) {
                  setAvisoDom({ titulo: "No se pudo solicitar el domicilio", texto: e.message });
                  setEnviando(false);
                  return;
                }
                setEnviando(false);
                setNuevo(false);
              }}>Asignar domicilio</Btn>
              <Btn kind="ghost" onClick={() => setNuevo(false)}>Cancelar</Btn>
            </div>
          </Modal>
        )}

        {avisoDom && (
          <Modal title={avisoDom.titulo} onClose={() => setAvisoDom(null)}>
            <p className="text-sm m-0">{avisoDom.texto}</p>
            <div className="mt-4"><Btn onClick={() => setAvisoDom(null)}>Entendido</Btn></div>
          </Modal>
        )}
      </div>
    );
  }

  /* ================= RECLAMOS ================= */

  const RECLAMO_TIPOS = ["Producto faltante","Producto equivocado","Daño en entrega","Producto derretido","Error de sabor","Inconformidad de sabor","Retraso","Reclamo dudoso","Reclamo por calidad"];

  function minutosEntre(a, b) {
    if (!a || !b || a === "—") return null;
    const [h1, m1] = a.split(":").map(Number); const [h2, m2] = b.split(":").map(Number);
    return (h2 * 60 + m2) - (h1 * 60 + m1);
  }

  // Minutos reales entre entrega y reclamo. Usa entregadoEn/reclamoEn (con fecha y hora);
  // si faltan, cae al cálculo por horas hEntrega/hReclamo.
  function minutosReclamo(r) {
    const ent = selloAMs(r.entregadoEn);
    const rec = selloAMs(r.reclamoEn);
    if (ent && rec) return Math.round((rec - ent) / 60000);
    return minutosEntre(r.hEntrega, r.hReclamo);
  }

  function Reclamos({ db, update, user, focus, refrescar }) {
    const [sel, setSel] = useState(null);
    const [aviso, setAviso] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const claimBuckets = useMemo(() => partitionByActivity(db.claims, isActiveClaim), [db.claims]);
    const [scope, setScope] = useState(() => {
      const highlighted = focus?.claimId && db.claims.find((claim) => claim.id === focus.claimId);
      return highlighted && !isActiveClaim(highlighted) ? "history" : "active";
    });
    const listaReclamos = scope === "active" ? claimBuckets.active : claimBuckets.history;
    const highlightId = focus && focus.claimId;
    const highlightRef = useRef(null);
    useEffect(() => {
      if (highlightRef.current) highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }, [highlightId]);
    return (
      <div>
        <div className="text-xs font-bold p-2.5 rounded-xl mb-4" style={{ background: T.vainilla, color: T.choco2 }}>
          📋 Política: reclamos por estado del producto se aceptan máximo 20 minutos después de recibido, salvo calidad o inocuidad.
        </div>
        <div className="mb-4"><WorkScopeTabs value={scope} onChange={setScope} activeCount={claimBuckets.active.length} historyCount={claimBuckets.history.length} activeLabel="Casos activos" /></div>
        <SectionTitle>{scope === "active" ? "Casos por resolver" : "Historial de reclamos"}</SectionTitle>
        <div className="grid lg:grid-cols-2 gap-3">
          {listaReclamos.map((r) => {
            const c = customerOf(db, r.customerId);
            const min = minutosReclamo(r);
            const previos = db.claims.filter((x) => x.customerId === r.customerId && x.id !== r.id).length;
            const fuera = min !== null && min > 20;
            const hl = highlightId === r.id;
            return (
              <div key={r.id} ref={hl ? highlightRef : null} className="rounded-2xl" style={hl ? { boxShadow: `0 0 0 3px ${T.coral}` } : undefined}>
              <Card className="p-4">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="font-bold">{r.id} · {r.tipo}</div>
                    <div className="text-xs" style={{ color: T.choco2 }}>Pedido {r.orderId} · {c.nombre}</div>
                  </div>
                  <Badge label={r.estado} />
                </div>
                <div className="text-sm mt-2">{r.desc}</div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {min !== null && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: fuera ? "#F6D4CD" : "#DDEBD9", color: fuera ? "#A03B2A" : "#3F6B42" }}>
                      ⏱️ {min} min después de la entrega {fuera && "· fuera de ventana"}
                    </span>
                  )}
                  {previos > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FBE8C8", color: "#96690F" }}>Cliente con {previos} reclamo(s) anterior(es)</span>}
                  {r.evidencia && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: T.vainilla, color: T.choco2 }}>📷 {r.evidencia}</span>}
                </div>
                {r.decision && <div className="text-xs mt-2"><b>Decisión:</b> {r.decision}</div>}
                {r.solucion && <div className="text-xs mt-1"><b>Solución:</b> {r.solucion} {r.costo > 0 && `(costo ${fmt(r.costo)})`}</div>}
                <div className="flex gap-2 mt-3 items-center flex-wrap">
                  <MiniSelect options={["Abierto","En revisión","Aprobado","Rechazado","Compensado","Cerrado"]} value={r.estado} disabled={enviando || scope === "history"} onChange={async (e) => {
                    const estado = e.target.value;
                    setEnviando(true);
                    try {
                      await setReclamoEstado(r.id, estado);
                    } catch (err) {
                      setAviso({ titulo: "Acción no permitida", texto: err.message });
                      setEnviando(false);
                      return;
                    }
                    try {
                      await refrescar();
                    } catch (err) {
                      setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: "El estado del caso se actualizó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." });
                    }
                    setEnviando(false);
                  }} />
                  {scope === "active" ? <Btn small kind="ghost" onClick={() => setSel({ ...r })}>Editar caso</Btn> : <span className="text-[10px] font-bold" style={{ color: T.choco2 }}>Caso cerrado · solo consulta</span>}
                </div>
              </Card>
              </div>
            );
          })}
          {listaReclamos.length === 0 && <Empty icon={scope === "active" ? "🎉" : "◷"} text={scope === "active" ? "Sin reclamos activos." : "Todavía no hay reclamos cerrados."} />}
        </div>

        {sel && (
          <Modal title={`Editar ${sel.id}`} onClose={() => setSel(null)}>
            <Field label="Tipo de reclamo"><Select options={RECLAMO_TIPOS} value={sel.tipo} onChange={(e) => setSel({ ...sel, tipo: e.target.value })} /></Field>
            <Field label="Descripción"><Input value={sel.desc} onChange={(e) => setSel({ ...sel, desc: e.target.value })} /></Field>
            <Field label="Hora de entrega (HH:MM)"><Input value={sel.hEntrega} onChange={(e) => setSel({ ...sel, hEntrega: e.target.value })} /></Field>
            <Field label="Responsable interno"><Input value={sel.resp} onChange={(e) => setSel({ ...sel, resp: e.target.value })} /></Field>
            <Field label="Decisión"><Input value={sel.decision} onChange={(e) => setSel({ ...sel, decision: e.target.value })} /></Field>
            <Field label="Solución dada"><Input value={sel.solucion} onChange={(e) => setSel({ ...sel, solucion: e.target.value })} /></Field>
            <Field label="Costo de la solución"><Input type="number" value={sel.costo} onChange={(e) => setSel({ ...sel, costo: +e.target.value })} /></Field>
            <div className="flex gap-2 mt-2">
              <Btn disabled={enviando} onClick={async () => {
                const hEntrega = sel.hEntrega && sel.hEntrega !== "—" ? sel.hEntrega : "";
                setEnviando(true);
                try {
                  await editarReclamo(sel.id, { tipo: sel.tipo, descr: sel.desc, resp: sel.resp, decision: sel.decision, solucion: sel.solucion, costo: sel.costo, h_entrega: hEntrega });
                } catch (e) {
                  setAviso({ titulo: "Acción no permitida", texto: e.message });
                  setEnviando(false);
                  return;
                }
                try {
                  await refrescar();
                } catch (e) {
                  setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: "El caso se guardó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." });
                  setEnviando(false);
                  setSel(null);
                  return;
                }
                setEnviando(false);
                setSel(null);
              }}>Guardar caso</Btn>
              <Btn kind="ghost" onClick={() => setSel(null)}>Cancelar</Btn>
            </div>
          </Modal>
        )}
        {aviso && (
          <Modal title={aviso.titulo} onClose={() => setAviso(null)}>
            <p className="text-sm m-0">{aviso.texto}</p>
            <div className="mt-4"><Btn onClick={() => setAviso(null)}>Entendido</Btn></div>
          </Modal>
        )}
      </div>
    );
  }

  /* ================= CLIENTES / CRM ================= */

  const ESTADOS_CLIENTE = ["Nuevo", "Recurrente", "VIP", "Inactivo", "Riesgo por reclamos"];

  function Clientes({ db, update, user, refrescar, aplicarMutacionCatalogoCrm, capturarContextoMutacionCatalogoCrm }) {
    const [q, setQ] = useState("");
    const [sel, setSel] = useState(null);
    const [detalleVista, setDetalleVista] = useState("resumen");
    const [form, setForm] = useState(null); // null = cerrado; objeto = alta/edición
    const [err, setErr] = useState("");
    const [aviso, setAviso] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [crmForm, setCrmForm] = useState(null);
    const mutationKeyRef = useRef(createInventoryIdempotencyKey());
    const hoy = hoyISO();

    useEffect(() => {
      if (!sel?.id) return;
      const current = db.customers.find((customer) => customer.id === sel.id);
      if (!current) setSel(null);
      else if (current !== sel) setSel(current);
    }, [db.customers, sel?.id]);

    async function ejecutarClienteDelta(operation, payload, legacyAction) {
      if (db.catalogCrmDeltaReady === true
          && typeof aplicarMutacionCatalogoCrm === "function"
          && typeof capturarContextoMutacionCatalogoCrm === "function") {
        const key = mutationKeyRef.current;
        const context = capturarContextoMutacionCatalogoCrm();
        const envelope = await mutarCatalogoCrmDelta(operation, payload, key);
        const applied = await aplicarMutacionCatalogoCrm(envelope, operation, context);
        mutationKeyRef.current = createInventoryIdempotencyKey();
        if (applied?.status === "discarded") await refrescar({ reason: "crm-delta-discard" });
        return applied?.result;
      }
      const result = await legacyAction();
      await refrescar({ reason: "crm-legacy-mutation" });
      return result;
    }

    function abrirNuevo() {
      setErr(""); setSel(null);
      setForm({ id: null, nombre: "", telefono: "", instagram: "", canal: "WhatsApp", barrio: "", direccion: "", cumple: "", favoritos: "", estado: "Nuevo", notas: "" });
    }
    function abrirEdicion(c) {
      setErr(""); setSel(null);
      setForm({ id: c.id, nombre: c.nombre || "", telefono: c.telefono || "", instagram: c.instagram || "", canal: c.canal || "WhatsApp", barrio: c.barrio || "", direccion: c.direccion || "", cumple: c.cumple || "", favoritos: c.favoritos || "", estado: c.estado || "Nuevo", notas: c.notas || "" });
    }
    async function guardarCliente() {
      const nombre = form.nombre.trim();
      const telefono = form.telefono.trim();
      if (!nombre || !telefono) { setErr("Nombre y teléfono son obligatorios."); return; }
      const campos = { nombre, telefono, instagram: form.instagram.trim(), canal: form.canal, barrio: form.barrio.trim(), direccion: form.direccion.trim(), cumple: form.cumple, favoritos: form.favoritos.trim(), estado: form.estado, notas: form.notas.trim() };
      setEnviando(true);
      try {
        await ejecutarClienteDelta(
          "upsert_cliente",
          { customer_id: form.id || "", ...campos },
          () => upsertCliente(form.id || null, campos),
        );
      } catch (e) {
        setErr(e.message);
        setEnviando(false);
        return;
      }
      setEnviando(false);
      setForm(null);
    }
    const lista = db.customers.filter((c) => (c.nombre + c.telefono + (c.barrio || "")).toLowerCase().includes(q.toLowerCase()));
    const crm = sel ? buildCustomerCrm(db, sel.id, hoy) : null;
    const clientesConCompra = db.customers.filter((cliente) => (cliente.pedidos || 0) > 0).length;
    const clientesRecurrentes = db.customers.filter((cliente) => (cliente.pedidos || 0) >= 2).length;
    const clientesPorReactivar = db.customers.filter((cliente) => cliente.ultima && diasEntre(cliente.ultima, hoy) >= 15).length;

    function abrirDetalleCliente(cliente) {
      setDetalleVista("resumen");
      setSel(cliente);
    }

    async function ejecutarCrm(operation, payload, legacyAction) {
      setEnviando(true); setErr("");
      try { await ejecutarClienteDelta(operation, payload, legacyAction); setCrmForm(null); }
      catch (e) { setErr(e.message); }
      finally { setEnviando(false); }
    }

    const alertas = [];
    db.customers.forEach((c) => {
      if (c.ultima) {
        const dias = diasEntre(c.ultima, hoy);
        if (dias >= 30) alertas.push([`🚨 ${c.nombre} no compra hace ${dias} días`, "#A03B2A", "#F6D4CD"]);
        else if (dias >= 15) alertas.push([`💤 ${c.nombre} no compra hace ${dias} días`, "#96690F", "#FBE8C8"]);
      }
      if (c.cumple) {
        const [mm, dd] = c.cumple.split("-").map(Number);
        const prox = new Date(); prox.setMonth(mm - 1, dd);
        if (prox < new Date()) prox.setFullYear(prox.getFullYear() + 1);
        const faltan = Math.round((prox - new Date()) / 86400000);
        if (faltan <= 15) alertas.push([`🎂 ${c.nombre} cumple años en ${faltan} día(s)`, "#8E4B5A", "#F3D7DC"]);
      }
    });
    db.benefits.filter((b) => b.estado === "Activo" && diasEntre(hoy, b.vence) <= 3).forEach((b) => {
      const c = customerOf(db, b.customerId);
      if (c.nombre) alertas.push([`⏳ Beneficio de ${c.nombre} (${b.beneficio}) vence el ${b.vence}`, "#63518A", "#E8E0F2"]);
    });

    function exportar() {
      downloadCSV("clientes",
        ["Nombre","Teléfono","Instagram","Barrio","Dirección","Canal","Primera compra","Última compra","Total","Pedidos","Ticket promedio","Cumpleaños","Preferencia declarada","Estado"],
        db.customers.map((c) => [c.nombre, c.telefono, c.instagram, c.barrio, c.direccion, c.canal, c.primera, c.ultima, c.total, c.pedidos, Math.round(c.total / Math.max(c.pedidos, 1)), c.cumple, c.favoritos, c.estado]));
    }

    return (
      <div>
        <SectionTitle action={<div className="flex gap-2"><Btn small kind="rosa" onClick={abrirNuevo}>＋ Nuevo cliente</Btn><Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn></div>}>Alertas de CRM</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat icon="💗" label="Clientes" value={db.customers.length} sub="fichas registradas" />
          <Stat icon="🛍️" label="Con compra" value={clientesConCompra} sub="historial comercial" tone="#3F6B42" />
          <Stat icon="🔁" label="Recurrentes" value={clientesRecurrentes} sub="dos compras o más" tone="#63518A" />
          <Stat icon="💬" label="Por reactivar" value={clientesPorReactivar} sub="15 días o más" tone={clientesPorReactivar ? "#96690F" : "#3F6B42"} />
        </div>
        <div className="flex flex-col gap-1.5 mb-4">
          {alertas.slice(0, 4).map(([t, fg, bg], i) => <div key={i} className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: bg, color: fg }}>{t}</div>)}
          {alertas.length > 4 && <div className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>+ {alertas.length - 4} alertas adicionales disponibles dentro de las fichas CRM.</div>}
          {alertas.length === 0 && <div className="text-sm" style={{ color: T.choco2 }}>Sin alertas activas.</div>}
        </div>

        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono o barrio…"
          className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none mb-3" style={inputStyle} />

        <SectionTitle>Directorio de clientes</SectionTitle>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lista.map((c) => (
            <Card key={c.id} aria-label={`Abrir ficha CRM de ${c.nombre}`} className="p-4" onClick={() => abrirDetalleCliente(c)}>
              <div className="flex justify-between items-start gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center display text-base shrink-0" style={{ background: T.rosa, color: "#8E4B5A" }}>
                    {c.nombre.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate">{c.nombre}</div>
                    <div className="text-xs truncate" style={{ color: T.choco2 }}>{c.telefono} · {c.barrio}</div>
                  </div>
                </div>
                <Badge label={c.estado} />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded-xl px-3 py-2" style={{ background: T.vainilla }}><div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>Compras</div><div className="display text-lg mt-0.5">{c.pedidos || 0}</div></div>
                <div className="rounded-xl px-3 py-2" style={{ background: T.vainilla }}><div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>Valor cliente</div><div className="font-bold text-sm mt-1 truncate">{fmt(c.total || 0)}</div></div>
              </div>
              <div className="flex items-center justify-between gap-3 mt-3"><div className="text-[11px] font-semibold truncate" style={{ color: T.choco2 }}>{c.ultima ? `Última compra ${c.ultima}` : "Lead sin compras"}</div><Badge label={c.canal || "WhatsApp"} map={CANAL_STYLE} /></div>
              <div className="text-[11px] font-extrabold mt-3" style={{ color: T.coral }}>Abrir ficha CRM ›</div>
            </Card>
          ))}
          {lista.length === 0 && <div className="sm:col-span-2 lg:col-span-3"><Empty icon="💗" text="No encontramos clientes con esa búsqueda." /></div>}
        </div>

        {sel && (
          <Modal title={`Cliente · ${sel.nombre}`} onClose={() => setSel(null)} wide>
            {!db.crmServerReady && <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: "#FBE8C8", color: "#96690F" }}>CRM en modo consulta. Aplicá la migración 15 para registrar contactos, activaciones y preferencias.</div>}
            {/* Tira de identidad — plana, dentro de la paleta */}
            <div className="momo-trace-open flex items-center gap-3 rounded-2xl p-3 mb-3" style={{ background: T.soft, border: `1px solid ${T.border}`, animationDelay: "20ms" }}>
              <div className="w-11 h-11 rounded-full flex items-center justify-center display text-lg shrink-0" style={{ background: T.vainilla, color: T.rosaDeep, boxShadow: "inset 0 0 0 1px rgba(196,128,142,.2)" }}>
                {(sel.nombre || "·").split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <div className="min-w-0">
                <div className="flex gap-1.5 flex-wrap"><Badge label={sel.estado} /><Badge label={sel.canal} map={CANAL_STYLE} /></div>
                {(sel.telefono || sel.barrio) && <div className="text-xs font-semibold mt-1 truncate" style={{ color: T.choco2, fontVariantNumeric: "tabular-nums" }}>{sel.telefono}{sel.telefono && sel.barrio ? " · " : ""}{sel.barrio}</div>}
              </div>
            </div>
            {/* Métricas — tiles planos vainilla con count-up */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[["Compras", <CountUp value={crm.purchases} />], ["Valor cliente", <CountUp value={crm.spend} format={fmt} />], ["Ticket", <CountUp value={crm.averageTicket} format={fmt} />], ["Ficha", <CountUp value={crmCompleteness(crm)} format={(v) => `${v}%`} />]].map(([label, node], i) => (
                <div key={label} className="momo-crm-tile momo-trace-open rounded-xl p-2 text-center" style={{ background: T.vainilla, animationDelay: `${70 + i * 55}ms` }}>
                  <div className="display font-semibold text-base" style={{ fontVariantNumeric: "tabular-nums" }}>{node}</div>
                  <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{label}</div>
                </div>
              ))}
            </div>
            <div role="tablist" aria-label="Secciones de la ficha CRM" className="flex flex-wrap gap-1.5 p-1.5 rounded-2xl mb-3" style={{ background: T.vainilla }}>
              {[["resumen", "Resumen"], ["compras", `Pedidos ${crm.orders.length}`], ["seguimiento", `Relación ${crm.contacts.length + crm.activations.length + db.benefits.filter((benefit) => benefit.customerId === sel.id).length + db.claims.filter((claim) => claim.customerId === sel.id).length}`]].map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={detalleVista === value} onClick={() => setDetalleVista(value)} className="rounded-xl px-3 py-2 text-xs font-extrabold" style={{ background: detalleVista === value ? T.coral : "transparent", color: detalleVista === value ? "white" : T.choco2 }}>{label}</button>
              ))}
            </div>
            {detalleVista === "resumen" && <>
            {/* Siguiente mejor acción — colores originales, sin cambios */}
            <div className="momo-trace-open p-3 rounded-2xl mb-3" style={{ background: crm.nextAction.type === "blocked" ? "#F6D4CD" : "#E6F1E3", border: `1px solid ${crm.nextAction.type === "blocked" ? "#E8A697" : "#B8D2B2"}`, animationDelay: "290ms" }}>
              <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: crm.nextAction.type === "blocked" ? "#A03B2A" : "#3F6B42" }}>Siguiente mejor acción</div>
              <div className="font-bold text-sm mt-0.5">{crm.nextAction.label}</div><div className="text-xs mt-0.5">{crm.nextAction.detail}</div>
            </div>
            {/* Contacto — sin duplicar métricas (tel movido a la tira; total/ticket ya en métricas) */}
            <div className="momo-trace-open text-sm space-y-1.5 rounded-2xl p-3 mb-3" style={{ background: T.soft, border: `1px solid ${T.border}`, animationDelay: "330ms" }}>
              <div>📍 {sel.direccion} ({sel.barrio})</div>
              <div style={{ fontVariantNumeric: "tabular-nums" }}>🗓️ {crm.firstPurchase ? <>Primera compra <b>{crm.firstPurchase}</b> · última <b>{crm.lastPurchase}</b></> : <span style={{ color: T.choco2 }}>Sin compras entregadas aún (lead)</span>}</div>
              {sel.instagram && <div>📸 {sel.instagram}</div>}
              {sel.cumple && <div>🎂 Cumpleaños: {sel.cumple}</div>}
              {sel.favoritos && <div>💗 <b>Preferencia declarada:</b> {sel.favoritos}</div>}
            </div>
            <div className="momo-trace-open mt-3" style={{ animationDelay: "370ms" }}>
              <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>COMPRADO HISTÓRICAMENTE</div>
              {crm.automaticFavorites.length ? <div className="flex flex-wrap gap-1.5">{crm.automaticFavorites.map((favorite) => <span key={favorite.label} className="text-xs font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5" style={{ background: T.rosa, color: "#8E4B5A" }}>{favorite.label} <span style={{ background: "rgba(255,255,255,.6)", borderRadius: "999px", padding: "0 6px", fontVariantNumeric: "tabular-nums" }}>{favorite.quantity}</span></span>)}</div> : <div className="text-sm" style={{ color: T.choco2 }}>Aún no hay compras entregadas para aprender sus gustos.</div>}
            </div>
            {sel.notas && <div className="text-xs mt-3 p-2.5 rounded-xl" style={{ background: T.vainilla }}>📝 {sel.notas}</div>}
            </>}
            {detalleVista === "compras" && <>
            <div className="momo-trace-open mt-3" style={{ animationDelay: "410ms" }}>
              <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>HISTORIAL DE PEDIDOS</div>
              {crm.orders.map((order) => <div key={order.id} className="momo-crm-row flex justify-between gap-3 text-sm px-2 py-2 border-b last:border-0" style={{ borderColor: T.border }}><div className="min-w-0"><b>{order.id}</b> · <span style={{ fontVariantNumeric: "tabular-nums" }}>{order.fecha}</span><div className="text-xs" style={{ color: T.choco2 }}>{order.itemsCrm.map((item) => orderLinePresentation(item, productOf(db, item.productId)).quantityLabel).join("; ") || "Sin líneas"}</div></div><div className="text-right shrink-0"><Badge label={order.estado} /><div className="text-xs font-bold mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(order.totalCrm)}</div></div></div>)}
              {!crm.orders.length && <div className="text-sm" style={{ color: T.choco2 }}>Sin pedidos todavía.</div>}
            </div>
            </>}
            {detalleVista === "seguimiento" && <>
            <div className="mt-3">
              <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>SEGUIMIENTO COMERCIAL</div>
              {crm.contacts.map((contact) => <div key={contact.id} className="text-sm py-2 border-b last:border-0" style={{ borderColor: T.border }}><div className="flex justify-between gap-2"><b>{contact.channel} · {contact.reason}</b><Badge label={contact.outcome} /></div><div className="text-xs" style={{ color: T.choco2 }}>{contact.createdAt}{contact.createdByName ? ` · ${contact.createdByName}` : ""}{contact.followUpOn ? ` · seguimiento ${contact.followUpOn}` : ""}</div></div>)}
              {!crm.contacts.length && <div className="text-sm" style={{ color: T.choco2 }}>Sin contactos registrados.</div>}
            </div>
            <div className="mt-3">
              <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>ACTIVACIONES PUNTUALES</div>
              {crm.activations.map((activation) => <div key={activation.id} className="text-sm py-2 border-b last:border-0" style={{ borderColor: T.border }}><div className="flex justify-between gap-2"><div><b>{activation.title}</b><div className="text-xs" style={{ color: T.choco2 }}>{activation.type}{activation.expiresOn ? ` · vence ${activation.expiresOn}` : ""}{activation.convertedOrderId ? ` · pedido ${activation.convertedOrderId}` : ""}</div></div><div className="flex items-center gap-2"><Badge label={activation.status} />{!activation.convertedOrderId && <Btn small kind="ghost" onClick={() => { setErr(""); setCrmForm({ type: "conversion", activationId: activation.id, orderId: "" }); }}>Atribuir pedido</Btn>}</div></div></div>)}
              {!crm.activations.length && <div className="text-sm" style={{ color: T.choco2 }}>Sin activaciones creadas.</div>}
            </div>
            <div className="mt-3">
              <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>BENEFICIOS</div>
              {db.benefits.filter((b) => b.customerId === sel.id).map((b) => (
                <div key={b.id} className="flex justify-between items-center text-sm py-1.5 border-b last:border-0" style={{ borderColor: T.border }}>
                  <span>🎁 {b.beneficio} <span className="text-xs" style={{ color: T.choco2 }}>· vence {b.vence}{b.pedidoUso && ` · usado en ${b.pedidoUso}`}</span></span><Badge label={b.estado} />
                </div>
              ))}
              {db.benefits.filter((b) => b.customerId === sel.id).length === 0 && <div className="text-sm" style={{ color: T.choco2 }}>Sin beneficios.</div>}
            </div>
            <div className="mt-3">
              <div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>RECLAMOS</div>
              {db.claims.filter((r) => r.customerId === sel.id).map((r) => (
                <div key={r.id} className="flex justify-between items-center text-sm py-1.5 border-b last:border-0" style={{ borderColor: T.border }}>
                  <span>{r.id} · {r.tipo}</span><Badge label={r.estado} />
                </div>
              ))}
              {db.claims.filter((r) => r.customerId === sel.id).length === 0 && <div className="text-sm" style={{ color: T.choco2 }}>Sin reclamos. 💛</div>}
            </div>
            </>}
            <div className="mt-4 flex justify-end gap-2 flex-wrap">
              <Btn small kind="soft" disabled={!db.crmServerReady} onClick={() => { setErr(""); setCrmForm({ type: "preferences", contactAllowed: crm.profile.contactAllowed !== false, preferredChannel: crm.profile.preferredChannel || "WhatsApp", acquisitionSource: crm.profile.acquisitionSource || "", contactReason: crm.profile.contactReason || "" }); }}>Preferencias</Btn>
              <Btn small kind="soft" disabled={!db.crmServerReady || crm.profile.contactAllowed === false} onClick={() => { setErr(""); setCrmForm({ type: "contact", channel: crm.profile.preferredChannel === "No contactar" ? "WhatsApp" : (crm.profile.preferredChannel || "WhatsApp"), reason: crm.nextAction.label, outcome: "Enviado", notes: "", followUpOn: "" }); }}>Registrar contacto</Btn>
              <Btn small kind="soft" disabled={!db.crmServerReady || crm.profile.contactAllowed === false} onClick={() => { setErr(""); setCrmForm({ type: "activation", activationType: crm.nextAction.type === "reactivation" ? "Reactivación" : "Seguimiento", title: crm.nextAction.label, message: crm.nextAction.detail, expiresOn: dISO(7) }); }}>Nueva activación</Btn>
              <Btn small kind="rosa" onClick={() => abrirEdicion(sel)}>✏️ Editar cliente</Btn>
            </div>
          </Modal>
        )}

        {sel && crmForm?.type === "preferences" && (
          <Modal title="Preferencias de contacto" onClose={() => setCrmForm(null)}>
            <label className="flex items-center gap-2 text-sm font-bold mb-3"><input type="checkbox" checked={crmForm.contactAllowed} onChange={(e) => setCrmForm({ ...crmForm, contactAllowed: e.target.checked, preferredChannel: e.target.checked ? "WhatsApp" : "No contactar" })} /> Puede recibir mensajes comerciales</label>
            <Field label="Canal preferido"><Select options={["WhatsApp","Instagram","Llamada","No contactar"]} value={crmForm.preferredChannel} onChange={(e) => setCrmForm({ ...crmForm, preferredChannel: e.target.value, contactAllowed: e.target.value !== "No contactar" })} /></Field>
            <Field label="Cómo llegó"><Input value={crmForm.acquisitionSource} onChange={(e) => setCrmForm({ ...crmForm, acquisitionSource: e.target.value })} placeholder="Instagram, referido, Rappi…" /></Field>
            {!crmForm.contactAllowed && <Field label="Motivo de no contacto"><Input value={crmForm.contactReason} onChange={(e) => setCrmForm({ ...crmForm, contactReason: e.target.value })} /></Field>}
            {err && <div className="text-sm font-bold mb-2" style={{ color: T.coral }}>{err}</div>}
            <div className="flex justify-end gap-2"><Btn kind="ghost" onClick={() => setCrmForm(null)}>Cancelar</Btn><Btn disabled={enviando} onClick={() => {
              const payload = { customer_id: sel.id, contact_allowed: crmForm.contactAllowed, preferred_channel: crmForm.preferredChannel, acquisition_source: crmForm.acquisitionSource, contact_reason: crmForm.contactReason };
              return ejecutarCrm("guardar_preferencias_cliente", payload, () => guardarPreferenciasCliente(sel.id, {
                contact_allowed: crmForm.contactAllowed, preferred_channel: crmForm.preferredChannel,
                acquisition_source: crmForm.acquisitionSource, contact_reason: crmForm.contactReason,
              }));
            }}>Guardar</Btn></div>
          </Modal>
        )}
        {sel && crmForm?.type === "contact" && (
          <Modal title="Registrar contacto" onClose={() => setCrmForm(null)}>
            <Field label="Canal"><Select options={["WhatsApp","Instagram","Llamada","Presencial","Otro"]} value={crmForm.channel} onChange={(e) => setCrmForm({ ...crmForm, channel: e.target.value })} /></Field>
            <Field label="Motivo"><Input value={crmForm.reason} onChange={(e) => setCrmForm({ ...crmForm, reason: e.target.value })} /></Field>
            <Field label="Resultado"><Select options={["Pendiente","Enviado","Respondió","Interesado","No interesado","No respondió","Venta"]} value={crmForm.outcome} onChange={(e) => setCrmForm({ ...crmForm, outcome: e.target.value })} /></Field>
            <Field label="Próximo seguimiento"><Input type="date" value={crmForm.followUpOn} onChange={(e) => setCrmForm({ ...crmForm, followUpOn: e.target.value })} /></Field>
            <Field label="Notas"><Input value={crmForm.notes} onChange={(e) => setCrmForm({ ...crmForm, notes: e.target.value })} /></Field>
            {err && <div className="text-sm font-bold mb-2" style={{ color: T.coral }}>{err}</div>}
            <div className="flex justify-end gap-2"><Btn kind="ghost" onClick={() => setCrmForm(null)}>Cancelar</Btn><Btn disabled={enviando || crmForm.reason.trim().length < 3} onClick={() => {
              const payload = { customer_id: sel.id, channel: crmForm.channel, reason: crmForm.reason, outcome: crmForm.outcome, notes: crmForm.notes, follow_up_on: crmForm.followUpOn };
              return ejecutarCrm("registrar_contacto_cliente", payload, () => registrarContactoCliente(payload));
            }}>Registrar</Btn></div>
          </Modal>
        )}
        {sel && crmForm?.type === "activation" && (
          <Modal title="Nueva activación puntual" onClose={() => setCrmForm(null)}>
            <Field label="Tipo"><Select options={["Reactivación","Cumpleaños","Fidelización","Seguimiento","Recuperación","Otro"]} value={crmForm.activationType} onChange={(e) => setCrmForm({ ...crmForm, activationType: e.target.value })} /></Field>
            <Field label="Objetivo"><Input value={crmForm.title} onChange={(e) => setCrmForm({ ...crmForm, title: e.target.value })} /></Field>
            <Field label="Mensaje sugerido"><textarea value={crmForm.message} onChange={(e) => setCrmForm({ ...crmForm, message: e.target.value })} className={`${inputCls} min-h-24`} style={inputStyle} /></Field>
            <Field label="Vence"><Input type="date" value={crmForm.expiresOn} onChange={(e) => setCrmForm({ ...crmForm, expiresOn: e.target.value })} /></Field>
            {err && <div className="text-sm font-bold mb-2" style={{ color: T.coral }}>{err}</div>}
            <div className="flex justify-end gap-2"><Btn kind="ghost" onClick={() => setCrmForm(null)}>Cancelar</Btn><Btn disabled={enviando || crmForm.title.trim().length < 3} onClick={() => {
              const payload = { customer_id: sel.id, type: crmForm.activationType, title: crmForm.title, message: crmForm.message, expires_on: crmForm.expiresOn };
              return ejecutarCrm("crear_activacion_cliente", payload, () => crearActivacionCliente(payload));
            }}>Crear activación</Btn></div>
          </Modal>
        )}
        {sel && crmForm?.type === "conversion" && (
          <Modal title="Atribuir conversión" onClose={() => setCrmForm(null)}>
            <div className="text-xs font-semibold p-2.5 rounded-xl mb-3" style={{ background: T.vainilla, color: T.choco2 }}>Elegí un pedido real del mismo cliente. El servidor rechazará pedidos cancelados, ajenos o ya atribuidos.</div>
            <Field label="Pedido convertido">
              <select value={crmForm.orderId} onChange={(e) => setCrmForm({ ...crmForm, orderId: e.target.value })} className={inputCls} style={inputStyle}>
                <option value="">Elegir pedido…</option>
                {crm.orders.filter((order) => order.estado !== "Cancelado").map((order) => <option key={order.id} value={order.id}>{order.id} · {order.fecha} · {order.estado} · {fmt(order.totalCrm)}</option>)}
              </select>
            </Field>
            {err && <div className="text-sm font-bold mb-2" style={{ color: T.coral }}>{err}</div>}
            <div className="flex justify-end gap-2"><Btn kind="ghost" onClick={() => setCrmForm(null)}>Cancelar</Btn><Btn disabled={enviando || !crmForm.orderId} onClick={() => ejecutarCrm(
              "convertir_activacion_cliente",
              { activation_id: crmForm.activationId, order_id: crmForm.orderId },
              () => convertirActivacionCliente(crmForm.activationId, crmForm.orderId),
            )}>Confirmar conversión</Btn></div>
          </Modal>
        )}

        {form && (
          <Modal title={form.id ? "Editar cliente" : "Nuevo cliente (lead)"} onClose={() => setForm(null)}>
            {!form.id && (
              <div className="text-xs font-semibold p-2.5 rounded-xl mb-3" style={{ background: T.vainilla, color: T.choco2 }}>
                Alta manual de un prospecto/lead antes de su primer pedido. Las métricas (pedidos, total) arrancan en 0 y se llenan solas cuando compre.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Nombre *"><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Field>
              <Field label="Teléfono *"><Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Instagram"><Input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="@usuario" /></Field>
              <Field label="Canal"><Select options={CANALES} value={form.canal} onChange={(e) => setForm({ ...form, canal: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Barrio"><Input value={form.barrio} onChange={(e) => setForm({ ...form, barrio: e.target.value })} /></Field>
              <Field label="Dirección"><Input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cumpleaños"><Input type="date" value={form.cumple ? "2000-" + form.cumple : ""} onChange={(e) => setForm({ ...form, cumple: e.target.value ? e.target.value.slice(5) : "" })} /></Field>
              <Field label="Estado"><Select options={ESTADOS_CLIENTE} value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} /></Field>
            </div>
            <Field label="Preferencia declarada por el cliente"><Input value={form.favoritos} onChange={(e) => setForm({ ...form, favoritos: e.target.value })} placeholder="Ej: Lizi de Maracuyá · no confundir con el historial comprado" /></Field>
            <Field label="Notas"><Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Field>
            {err && <div className="text-sm font-bold mb-3" style={{ color: T.coral }}>{err}</div>}
            <div className="flex justify-end gap-2">
              <Btn kind="ghost" onClick={() => setForm(null)}>Cancelar</Btn>
              <Btn kind="rosa" disabled={enviando} onClick={guardarCliente}>Guardar</Btn>
            </div>
          </Modal>
        )}
        {aviso && (
          <Modal title={aviso.titulo} onClose={() => setAviso(null)}>
            <p className="text-sm m-0">{aviso.texto}</p>
            <div className="mt-4"><Btn onClick={() => setAviso(null)}>Entendido</Btn></div>
          </Modal>
        )}
      </div>
    );
  }

  /* ================= BENEFICIOS ================= */

  const TIPOS_BENEFICIO = [
    { tipo: "descuento_porcentaje", label: "Descuento %" },
    { tipo: "descuento_valor_fijo", label: "Descuento valor fijo ($)" },
    { tipo: "producto_gratis", label: "Producto preparado gratis" },
  ];

  function labelBeneficio(b, db) {
    if (b.tipoBeneficio === "descuento_porcentaje") return b.valor + "% descuento";
    if (b.tipoBeneficio === "descuento_valor_fijo") return fmt(b.valor) + " de descuento";
    const p = productOf(db, b.productoGratisId);
    return (p ? p.nombre : "Producto") + " gratis";
  }

  function Beneficios({ db, update, user, refrescar, aplicarMutacionCatalogoCrm, capturarContextoMutacionCatalogoCrm }) {
    const [nuevo, setNuevo] = useState(false);
    const [form, setForm] = useState({ customerId: "", tipoBeneficio: "descuento_porcentaje", valor: 20, productoGratisId: "PR11", condicion: "Historia en Instagram", minimo: 30000, vence: dISO(15), obs: "" });
    const [error, setError] = useState("");
    const [enviando, setEnviando] = useState(false);
    const mutationKeyRef = useRef(createInventoryIdempotencyKey());

    async function activarBeneficioConDelta(payload) {
      if (db.catalogCrmDeltaReady === true
          && typeof aplicarMutacionCatalogoCrm === "function"
          && typeof capturarContextoMutacionCatalogoCrm === "function") {
        const key = mutationKeyRef.current;
        const context = capturarContextoMutacionCatalogoCrm();
        const envelope = await mutarCatalogoCrmDelta("activar_beneficio_cliente", payload, key);
        const applied = await aplicarMutacionCatalogoCrm(envelope, "activar_beneficio_cliente", context);
        mutationKeyRef.current = createInventoryIdempotencyKey();
        if (applied?.status === "discarded") await refrescar({ reason: "benefit-delta-discard" });
        return applied?.result;
      }
      const result = await activarBeneficioCliente(payload);
      await refrescar({ reason: "benefit-legacy-mutation" });
      return result;
    }

    return (
      <div>
        <div className="text-xs font-bold p-2.5 rounded-xl mb-4" style={{ background: T.vainilla, color: T.choco2 }}>
          Ciclo del beneficio: <b>Activo</b> → <b>Reservado</b> (al crear el pedido) → <b>Usado</b> (al confirmar el pago). Si el pedido se cancela, vuelve a Activo. Un beneficio por pedido, no acumulable, no aplica sobre el domicilio.
        </div>
        <div className="mb-4"><Btn onClick={() => setNuevo(true)}>＋ Activar beneficio</Btn></div>
        <div className="grid sm:grid-cols-2 gap-3">
          {db.benefits.map((b) => {
            const c = customerOf(db, b.customerId);
            const vencido = b.estado === "Activo" && b.vence < hoyISO();
            return (
              <Card key={b.id} className="p-4">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="font-bold text-sm">🎁 {labelBeneficio(b, db)}</div>
                    <div className="text-xs" style={{ color: T.choco2 }}>{c.nombre} · {b.condicion}</div>
                  </div>
                  <Badge label={vencido ? "Vencido" : b.estado} />
                </div>
                <div className="text-xs mt-2" style={{ color: T.choco2 }}>
                  Mínimo {fmt(b.minimo)} · activado {b.activacion} · vence <b style={{ color: diasEntre(hoyISO(), b.vence) <= 3 && b.estado === "Activo" ? "#A03B2A" : T.choco2 }}>{b.vence}</b>
                  {b.pedidoUso && <> · pedido <b>{b.pedidoUso}</b></>}
                </div>
                {b.estado === "Reservado" && <div className="text-xs font-bold mt-1.5" style={{ color: "#63518A" }}>⏳ Reservado: pasará a Usado cuando el pedido {b.pedidoUso} se marque pagado, o volverá a Activo si se cancela.</div>}
                {b.obs && <div className="text-xs mt-1.5">📝 {b.obs}</div>}
                {b.estado === "Activo" && (
                  <div className="text-[11px] font-semibold mt-2" style={{ color: T.choco2 }}>Se reserva al crear el pedido y se marca usado al confirmar el pago; no requiere ajuste manual.</div>
                )}
              </Card>
            );
          })}
        </div>

        {nuevo && (
          <Modal title="Activar beneficio" onClose={() => setNuevo(false)}>
            <Field label="Cliente">
              <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} className={inputCls} style={inputStyle}>
                <option value="">Elegir cliente…</option>
                {db.customers.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Field>
            <Field label="Tipo de beneficio">
              <select value={form.tipoBeneficio} onChange={(e) => setForm({ ...form, tipoBeneficio: e.target.value })} className={inputCls} style={inputStyle}>
                {TIPOS_BENEFICIO.map((t) => <option key={t.tipo} value={t.tipo}>{t.label}</option>)}
              </select>
            </Field>
            {form.tipoBeneficio === "descuento_porcentaje" && (
              <Field label="Porcentaje de descuento"><Input type="number" min="1" max="100" value={form.valor} onChange={(e) => setForm({ ...form, valor: +e.target.value })} /></Field>
            )}
            {form.tipoBeneficio === "descuento_valor_fijo" && (
              <Field label="Valor del descuento ($)"><Input type="number" min="0" value={form.valor} onChange={(e) => setForm({ ...form, valor: +e.target.value })} /></Field>
            )}
            {form.tipoBeneficio === "producto_gratis" && (
               <Field label="Producto preparado gratis">
                 <select value={form.productoGratisId} onChange={(e) => setForm({ ...form, productoGratisId: e.target.value })} className={inputCls} style={inputStyle}>
                   {db.products.filter((p) => p.activo && !isCommercialFamilyProduct(p) && p.tipo !== "combo").map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                 </select>
                 <div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>Las familias Gatito, Perrito y Premium necesitan figura y sabor exactos; por eso no se agregan como regalo genérico.</div>
               </Field>
            )}
            <Field label="Condición"><Input value={form.condicion} onChange={(e) => setForm({ ...form, condicion: e.target.value })} placeholder="Historia, referido, cumpleaños, Club Sweet Love…" /></Field>
            <Field label="Compra mínima"><Input type="number" value={form.minimo} onChange={(e) => setForm({ ...form, minimo: +e.target.value })} /></Field>
            <Field label="Vence"><Input type="date" value={form.vence} onChange={(e) => setForm({ ...form, vence: e.target.value })} /></Field>
            <Field label="Observaciones"><Input value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} /></Field>
            {!db.crmServerReady && <div className="text-xs font-bold mb-2" style={{ color: "#A03B2A" }}>Aplicá la migración 15 para activar beneficios de forma persistente y auditada.</div>}
            {error && <div className="text-sm font-bold mb-2" style={{ color: T.coral }}>{error}</div>}
            <div className="flex gap-2 mt-2">
              <Btn disabled={!db.crmServerReady || enviando || !form.customerId} onClick={async () => {
                setError(""); setEnviando(true);
                try {
                  await activarBeneficioConDelta({ customer_id: form.customerId, tipo_beneficio: form.tipoBeneficio, valor: form.valor, producto_gratis_id: form.tipoBeneficio === "producto_gratis" ? form.productoGratisId : "", condicion: form.condicion, minimo: form.minimo, vence: form.vence, obs: form.obs });
                  setNuevo(false);
                } catch (e) { setError(e.message); }
                finally { setEnviando(false); }
              }}>Activar</Btn>
              <Btn kind="ghost" onClick={() => setNuevo(false)}>Cancelar</Btn>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  /* ================= FINANZAS ================= */

  /* ================= REPORTES ================= */

  function Reportes({ db }) {
    const [desde, setDesde] = useState(dISO(-14));
    const [hasta, setHasta] = useState(hoyISO());
    const validos = db.orders.filter((o) => esPedidoCobrado(o) && o.fecha >= desde && o.fecha <= hasta);
    const physicalResults = useMemo(() => buildCanonicalPhysicalResults(db.production_batches || [], { from: desde, to: hasta }), [db.production_batches, desde, hasta]);

    const porDia = {};
    validos.forEach((o) => { porDia[o.fecha] = (porDia[o.fecha] || 0) + orderTotal(db, o); });
    const ventasDia = Object.entries(porDia).sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([label, value]) => ({ label: label.slice(5), value, color: label === hoyISO() ? T.coral : undefined }));

    const porProducto = {}, porSabor = {}, porFigura = {}, porBarrio = {}, porCategoria = {};
    validos.forEach((o) => {
      porBarrio[o.barrio] = (porBarrio[o.barrio] || 0) + orderTotal(db, o);
      const orderItems = itemsOf(db, o.id);
      orderItems.filter((item) => !item.parentItemId && !item.parent_item_id).forEach((i) => {
        const presentationName = commercialFamilyLabel(i.nombre);
        porProducto[presentationName] = (porProducto[presentationName] || 0) + i.cant;
        const p = productOf(db, i.productId);
        if (p) porCategoria[p.cat] = (porCategoria[p.cat] || 0) + i.precio * i.cant;
      });
      orderItems.forEach((i) => {
        if (i.sabor) porSabor[i.sabor] = (porSabor[i.sabor] || 0) + i.cant;
        if (isKitchenFigureName(i.figura)) porFigura[i.figura.trim()] = (porFigura[i.figura.trim()] || 0) + i.cant;
      });
    });
    const top = (obj, n = 6) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, value]) => ({ label, value }));

    const ticket = Math.round(validos.reduce((s, o) => s + orderTotal(db, o), 0) / Math.max(validos.length, 1));
    const idsValidos = new Set(validos.map((o) => o.id));
    const deliveriesValidos = db.deliveries.filter((d) => idsValidos.has(d.orderId));
    const subsidio = deliveriesValidos.reduce((s, d) => s + Math.max(0, d.costoReal - d.cobrado), 0);
    const costoDomTotal = deliveriesValidos.reduce((s, d) => s + d.costoReal, 0);
    const mermaProm = physicalResults.grossWasteRate;
    const recuperadas = physicalResults.repurposedImperfectUnits;
    const nuevos = db.customers.filter((c) => diasEntre(c.primera, hoyISO()) <= 10).length;
    const recurr = db.customers.filter((c) => c.pedidos >= 2).length;
    const recompra = recurr / Math.max(db.customers.length, 1);
    const benefUsados = db.benefits.filter((b) => b.estado === "Usado").length;

    const reclamosCanal = {};
    db.claims.forEach((r) => {
      if (!r.fecha || r.fecha < desde || r.fecha > hasta) return;
      const o = db.orders.find((x) => x.id === r.orderId);
      const canal = o ? o.canal : "Otro";
      reclamosCanal[canal] = (reclamosCanal[canal] || 0) + 1;
    });

    const margenes = db.products.filter((p) => p.activo).map((p) => ({ label: p.nombre, value: Math.round(((p.precio - p.costo) / p.precio) * 100) })).sort((a, b) => b.value - a.value).slice(0, 8);

    function exportar() {
      downloadCSV("reporte-resumen",
        ["Indicador","Valor"],
        [["Rango", desde + " a " + hasta], ["Pedidos", validos.length], ["Ticket promedio", ticket],
         ["Costo real domicilios", costoDomTotal], ["Subsidio domicilios", subsidio],
         ["Merma bruta %", Math.round(mermaProm * 100)], ["Piezas reaprovechadas", recuperadas],
         ["Descarte definitivo", physicalResults.definitiveLossUnits],
         ["Clientes nuevos (10 días)", nuevos], ["Clientes recurrentes", recurr],
         ["Recompra %", Math.round(recompra * 100)], ["Beneficios usados", benefUsados],
         ...top(porProducto, 10).map((d) => ["Presentación comercial: " + d.label, d.value]),
         ...top(porSabor, 10).map((d) => ["Sabor: " + d.label, d.value])]);
    }

    return (
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-bold" style={{ color: T.choco2 }}>Rango:</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Desde" />
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Hasta" />
          <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
          <Stat icon="🎯" label="Ticket promedio" value={fmt(ticket)} />
          <Stat icon="🛵" label="Costo real domicilios" value={fmt(costoDomTotal)} sub={`subsidio ${fmt(subsidio)}`} tone="#96690F" />
          <Stat icon="🔁" label="Recompra" value={pct(recompra)} sub={`${recurr} de ${db.customers.length} clientes`} tone="#3F6B42" />
          <Stat icon="♻️" label="Piezas reaprovechadas" value={recuperadas} sub={`merma bruta ${pct(mermaProm)} · descarte ${physicalResults.definitiveLossUnits}`} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat icon="🆕" label="Clientes nuevos (10 días)" value={nuevos} />
          <Stat icon="💖" label="Clientes recurrentes" value={recurr} />
          <Stat icon="🎁" label="Beneficios usados" value={benefUsados} sub={`${db.benefits.filter((b) => b.estado === "Activo").length} activos`} />
          <Stat icon="⚠️" label="Reclamos totales" value={db.claims.length} />
        </div>

        <SectionTitle>Ventas por día</SectionTitle>
        <Card className="p-4"><Bars data={ventasDia} money /></Card>

        <div className="grid lg:grid-cols-2 gap-3 mt-3">
          <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>VENTAS POR CATEGORÍA</div><Bars data={top(porCategoria)} money /></Card>
          <Card className="p-4"><div className="text-xs font-bold mb-1" style={{ color: T.choco2 }}>PRESENTACIONES COMERCIALES MÁS VENDIDAS</div><div className="text-[10px] mb-3" style={{ color: T.choco2 }}>Cuenta cajas y familias vendidas sin duplicar sus postres internos.</div><Bars data={top(porProducto)} /></Card>
          <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>SABORES MÁS VENDIDOS</div><Bars data={top(porSabor)} /></Card>
          <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>FIGURAS MÁS VENDIDAS</div><Bars data={top(porFigura)} /></Card>
          <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>VENTAS POR BARRIO</div><Bars data={top(porBarrio)} money /></Card>
          <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>RECLAMOS POR CANAL</div><Bars data={Object.entries(reclamosCanal).map(([label, value]) => ({ label, value }))} /></Card>
        </div>

        <SectionTitle>Margen estimado por presentación o preparación (%)</SectionTitle>
        <Card className="p-4"><Bars data={margenes} /></Card>

        <SectionTitle>Merma bruta por lote (%)</SectionTitle>
        <Card className="p-4">
          <Bars data={physicalResults.batches.map((batch) => ({ label: `${batch.batchId} ${batch.flavor}`, value: Math.round(batch.grossWasteRate * 100), color: T.rosaDeep }))} />
        </Card>

        {(() => {
          const campM = (db.campaigns || []).map((c) => ({ c, m: campaignMetrics(db, c) }));
          const creM = (db.creatives || []).map((cr) => ({ cr, pedidos: ordersDeCreative(db, cr.id).length, ventas: ventasDeCreative(db, cr.id) }));
          const ganadores = (db.creatives || []).filter((c) => c.estado === "Ganador");
          // conversión por canal de marketing desde resultados
          const canalConv = {};
          resultadosDePlataforma(db).forEach((r) => {
            const atrib = atribucionDeResultado(db, r);
            const cre = db.creatives.find((x) => x.id === r.creativeId);
            const canal = cre ? cre.canal : "Otro";
            if (!canalConv[canal]) canalConv[canal] = { msg: 0, ped: 0 };
            canalConv[canal].msg += r.mensajesWhatsApp;
            canalConv[canal].ped += atrib.pedidos;
          });
          const bajaRent = campM.filter((x) => x.m.roas !== null && x.m.roas < 1);
          return (
            <>
              <SectionTitle>📣 Marketing · ventas y pedidos por campaña</SectionTitle>
              <div className="grid lg:grid-cols-2 gap-3">
                <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>VENTAS POR CAMPAÑA</div><Bars data={campM.filter((x) => x.m.ventas > 0).map((x) => ({ label: x.c.nombre, value: x.m.ventas })).sort((a, b) => b.value - a.value)} money /></Card>
                <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>PEDIDOS POR CAMPAÑA</div><Bars data={campM.filter((x) => x.m.pedidos > 0).map((x) => ({ label: x.c.nombre, value: x.m.pedidos })).sort((a, b) => b.value - a.value)} /></Card>
                <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>ROAS POR CAMPAÑA</div><Bars data={campM.filter((x) => x.m.roas !== null).map((x) => ({ label: x.c.nombre, value: +x.m.roas.toFixed(2), color: x.m.roas >= 1 ? "#3F6B42" : "#A03B2A" })).sort((a, b) => b.value - a.value)} /></Card>
                <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>CAC POR CAMPAÑA</div><Bars data={campM.filter((x) => x.m.cac !== null).map((x) => ({ label: x.c.nombre, value: Math.round(x.m.cac), color: "#96690F" })).sort((a, b) => a.value - b.value)} money /></Card>
                <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>TICKET PROMEDIO POR CAMPAÑA</div><Bars data={campM.filter((x) => x.m.pedidos > 0).map((x) => ({ label: x.c.nombre, value: Math.round(x.m.ticket) })).sort((a, b) => b.value - a.value)} money /></Card>
                <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>PEDIDOS POR CREATIVO</div><Bars data={creM.filter((x) => x.pedidos > 0).map((x) => ({ label: x.cr.titulo, value: x.pedidos, color: T.rosaDeep })).sort((a, b) => b.value - a.value)} /></Card>
                <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>VENTAS POR CREATIVO</div><Bars data={creM.filter((x) => x.ventas > 0).map((x) => ({ label: x.cr.titulo, value: x.ventas })).sort((a, b) => b.value - a.value)} money /></Card>
                <Card className="p-4"><div className="text-xs font-bold mb-3" style={{ color: T.choco2 }}>CANALES CON MEJOR CONVERSIÓN WA→PEDIDO</div><Bars data={Object.entries(canalConv).filter(([, v]) => v.msg > 0).map(([k, v]) => ({ label: k, value: Math.round((v.ped / v.msg) * 100) }))} /></Card>
              </div>

              <SectionTitle>🏆 Creativos ganadores</SectionTitle>
              <Card className="p-4">
                {ganadores.length === 0 ? <div className="text-sm" style={{ color: T.choco2 }}>Aún no hay creativos marcados como ganadores.</div> :
                  ganadores.map((c) => (
                    <div key={c.id} className="flex justify-between items-center py-1.5 border-b last:border-0" style={{ borderColor: T.border }}>
                      <span className="text-sm font-semibold">🎨 {c.titulo}</span>
                      <span className="text-xs font-bold" style={{ color: "#3F6B42" }}>{ordersDeCreative(db, c.id).length} pedidos · {fmt(ventasDeCreative(db, c.id))}</span>
                    </div>
                  ))}
              </Card>

              {bajaRent.length > 0 && (
                <>
                  <SectionTitle>⚠️ Campañas con baja rentabilidad (ROAS &lt; 1)</SectionTitle>
                  <Card className="p-4">
                    {bajaRent.map((x) => (
                      <div key={x.c.id} className="flex justify-between items-center py-1.5 border-b last:border-0" style={{ borderColor: T.border }}>
                        <span className="text-sm font-semibold">{x.c.nombre}</span>
                        <span className="text-xs font-bold" style={{ color: "#A03B2A" }}>ROAS {x.m.roas.toFixed(2)}x · gasto {fmt(x.c.gastoReal)} · ventas {fmt(x.m.ventas)}</span>
                      </div>
                    ))}
                  </Card>
                </>
              )}
            </>
          );
        })()}
      </div>
    );
  }

  /* ================= CONFIGURACIÓN ================= */

  function Configuracion({ db, update, user, resetear, restaurarBackup, refrescar }) {
    const [nuevoItem, setNuevoItem] = useState({});
    const [confirmar, setConfirmar] = useState(false);
    const [nuevoUser, setNuevoUser] = useState({ nombre: "", email: "", rol: "Cocina" });
    const [userMsg, setUserMsg] = useState("");
    const [enviandoUser, setEnviandoUser] = useState(false);
    const [backupMsg, setBackupMsg] = useState("");
    const [nuevaFig, setNuevaFig] = useState({ nombre: "", especie: "gato", gramaje: "150 g", productId: "" });
    const [nuevoTop, setNuevoTop] = useState({ nombre: "", precio: "", insumoId: "" });
    const s = db.settings;
    const [delayDraft, setDelayDraft] = useState(() => normalizeKitchenDelaySettings(s));
    const [delayMsg, setDelayMsg] = useState("");
    const [guardandoDemoras, setGuardandoDemoras] = useState(false);
    const [configDirty, setConfigDirty] = useState(false);
    const [configMsg, setConfigMsg] = useState("");
    const [healthSnapshot, setHealthSnapshot] = useState(null);
    const [sloSnapshot, setSloSnapshot] = useState(null);
    const [continuitySnapshot, setContinuitySnapshot] = useState(null);
    const [healthLoading, setHealthLoading] = useState(true);
    const [healthReviewing, setHealthReviewing] = useState(false);
    const [healthError, setHealthError] = useState("");
    const listas = [
      ["saboresFrutales", "Sabores frutales"], ["saboresCremosos", "Sabores cremosos"],
      ["rellenos", "Rellenos"], ["salsas", "Salsas"],
      ["pagos", "Métodos de pago"], ["proveedores", "Proveedores de domicilio"],
    ];

    useEffect(() => {
      setDelayDraft(normalizeKitchenDelaySettings(s));
    }, [s.demoraCocinaMin, s.demoraCocinaUrgenteMin, s.demoraEmpaqueMin, s.demoraEmpaqueUrgenteMin, s.demoraRepeticionMin]);

    useEffect(() => {
      let active = true;
      setHealthLoading(true);
      Promise.all([fetchOperationalHealthSnapshot(), fetchOperationalSloSnapshot(60), fetchContinuitySnapshot()])
        .then(([health, slo, continuity]) => { if (active) { setHealthSnapshot(health); setSloSnapshot(slo); setContinuitySnapshot(continuity); setHealthError(""); } })
        .catch((error) => { if (active) setHealthError(error?.message || "No se pudo consultar la salud de MOMO OPS."); })
        .finally(() => { if (active) setHealthLoading(false); });
      return () => { active = false; };
    }, []);

    async function revisarSaludAhora() {
      if (healthReviewing) return;
      setHealthReviewing(true);
      setHealthError("");
      try {
        await runOperationalHealthReview();
        const [health, slo, continuity] = await Promise.all([fetchOperationalHealthSnapshot(), fetchOperationalSloSnapshot(60), fetchContinuitySnapshot()]);
        setHealthSnapshot(health);
        setSloSnapshot(slo);
        setContinuitySnapshot(continuity);
        toast("ok", "Revisión operativa completada");
      } catch (error) {
        setHealthError(error?.message || "No se pudo ejecutar la revisión operativa.");
      } finally {
        setHealthReviewing(false);
      }
    }

    function editarBorrador(mutator) {
      update(mutator);
      setConfigDirty(true);
      setConfigMsg("");
    }

    function editarDemoras(mutator) {
      setDelayDraft((current) => mutator(current));
      setConfigDirty(true);
      setDelayMsg("");
    }

    function aplicarSnapshotConfiguracion(snapshot) {
      const normalized = normalizeConfigurationSnapshot(snapshot);
      update((d) => {
        d.configurationSnapshotReady = true;
        d.configurationSnapshotVersion = normalized.snapshotVersion;
        d.configurationInventoryChoices = normalized.inventoryChoices;
        d.configurationFigureProductChoices = normalized.figureProductChoices;
        d.users = normalized.users;
        d.multipleRolesReady = true;
        const normalizedFigures = normalized.figures.map((figure) => ({
          nombre: figure.nombre, especie: figure.especie, gramajeG: Number.parseInt(figure.gramaje, 10),
          productId: figure.productId, activo: figure.activo,
        }));
        d.figuras = activeFigureCatalog({ figuras: normalizedFigures, products: d.products || [] });
        Object.assign(d.settings, {
          ...normalized.settingsCatalogos,
          figuras: activeConfigurationFigureCatalog({
            figuras: normalized.settingsCatalogos.figuras,
            products: d.products || [],
          }),
        });
        const byId = new Map((d.audit_logs || []).map((row) => [String(row.id), row]));
        normalized.auditLogs.forEach((row) => byId.set(String(row.id), row));
        d.audit_logs = [...byId.values()].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 100);
      }, { silencioso: true, persistir: false });
      setDelayDraft(normalizeKitchenDelaySettings(normalized.settingsCatalogos));
      return normalized;
    }

    async function guardarCambiosConfiguracion(delayValues = delayDraft) {
      if (guardandoDemoras || !db.configurationSnapshotReady) return false;
      setGuardandoDemoras(true);
      setConfigMsg("");
      try {
        const response = await guardarConfiguracionServidor(
          buildConfigurationSavePayload(db, delayValues),
          db.configurationSnapshotVersion,
          createInventoryIdempotencyKey(),
        );
        if (!["momos.configuration-mutation.v1", "momos.configuration-mutation.v2"].includes(response?.contract) || !response?.snapshot) {
          throw new Error("El servidor devolvió una confirmación incompleta.");
        }
        aplicarSnapshotConfiguracion(response.snapshot);
        setConfigDirty(false);
        setConfigMsg("✓ Configuración guardada y compartida con todos los equipos.");
        toast("ok", "Configuración actualizada");
        return true;
      } catch (error) {
        setConfigMsg("⚠️ " + (error?.message || "No se pudo guardar Configuración."));
        return false;
      } finally {
        setGuardandoDemoras(false);
      }
    }

    async function guardarTiemposDemora() {
      if (guardandoDemoras) return;
      const values = Object.fromEntries(Object.entries(delayDraft).map(([key, value]) => [key, Number(value)]));
      if (Object.values(values).some((value) => !Number.isInteger(value) || value < 1)) {
        setDelayMsg("⚠️ Todos los tiempos deben ser minutos enteros mayores que cero.");
        return;
      }
      if (values.demoraCocinaUrgenteMin < values.demoraCocinaMin || values.demoraEmpaqueUrgenteMin < values.demoraEmpaqueMin) {
        setDelayMsg("⚠️ El tiempo urgente no puede ser menor que el primer aviso de su área.");
        return;
      }
      const next = normalizeKitchenDelaySettings(values);
      setDelayMsg("");
      const saved = await guardarCambiosConfiguracion(next);
      if (saved) setDelayMsg("✓ Tiempos guardados para todos los equipos.");
    }

    function agregar(k) {
      const v = (nuevoItem[k] || "").trim();
      if (!v) return;
      // política MOMOS: no se permite "Efectivo" como método de pago
      if (k === "pagos" && v.toLowerCase() === "efectivo") {
        setNuevoItem((prev) => ({ ...prev, [k]: "" }));
        return;
      }
      editarBorrador((d) => {
        if (d.settings[k].includes(v)) return;
        d.settings[k] = k === "rellenos" ? [v] : [...d.settings[k], v];
      });
      setNuevoItem((prev) => ({ ...prev, [k]: "" }));
    }

    function agregarFigura(nombreSeleccionado = nuevaFig.nombre) {
      const nombre = (nombreSeleccionado || "").trim();
      const canonical = KITCHEN_FIGURE_DEFAULTS[nombre];
      const canonicalProductId = expectedFigureProductId(nombre);
      if (!canonical) {
        setConfigMsg("⚠️ Elegí una de las siete figuras físicas canónicas de MOMOS.");
        return;
      }
      if (!nombre || !canonicalProductId || !(db.products || []).some((product) => product.id === canonicalProductId && isCommercialFamilyProduct(product))) {
        setConfigMsg("⚠️ Falta la familia comercial canónica de esta figura. Corregí el catálogo antes de restaurarla.");
        return;
      }
      editarBorrador((d) => {
        if (d.settings.figuras.some((f) => f.nombre.toLowerCase() === nombre.toLowerCase())) return;
        d.settings.figuras = [...d.settings.figuras, {
          nombre,
          especie: canonical.species,
          gramaje: (nuevaFig.nombre === nombre ? nuevaFig.gramaje : `${canonical.grams} g`).trim() || `${canonical.grams} g`,
          productId: canonicalProductId,
        }];
      });
      setNuevaFig({ nombre: "", especie: "gato", gramaje: "150 g", productId: "" });
    }

    function agregarTopping() {
      const nombre = (nuevoTop.nombre || "").trim();
      if (!nombre) return;
      editarBorrador((d) => {
        if (d.settings.toppings.some((t) => t.nombre.toLowerCase() === nombre.toLowerCase())) return;
        d.settings.toppings = [...d.settings.toppings, {
          nombre,
          precio: +nuevoTop.precio || 0,
          insumoId: nuevoTop.insumoId || "",
          insumoCant: 1,
        }];
      });
      setNuevoTop({ nombre: "", precio: "", insumoId: "" });
    }

    const healthStatus = healthSnapshot?.status || (healthLoading ? "Revisando" : "Sin diagnóstico");
    const healthCounts = healthSnapshot?.counts || {};
    const healthIncidents = Array.isArray(healthSnapshot?.incidents) ? healthSnapshot.incidents : [];
    const sloServices = Array.isArray(sloSnapshot?.services) ? sloSnapshot.services : [];
    const sloCounts = sloSnapshot?.counts || {};
    const sloLabels = {
      OPS_FRONTEND: "Interfaz MOMO OPS", RPC_CORE: "Operaciones del servidor",
      DATABASE: "Base de datos", REALTIME: "Actualización en vivo",
      STORAGE: "Archivos", CONNECTORS: "Integraciones", HEALTH_MONITOR: "Monitor automático",
    };
    const sloTone = (status) => status === "Saludable"
      ? { bg: "#E3EFE0", color: "#315D36" }
      : status === "En riesgo" ? { bg: "#FFF1D6", color: "#7B5410" }
        : status === "Fuera de SLO" ? { bg: "#FBE1DC", color: "#A03B2A" }
          : { bg: T.vainilla, color: T.choco2 };
    const healthTone = healthSnapshot?.readOnly || healthStatus === "Solo lectura"
      ? { bg: "#FBE1DC", border: "#E56B55", text: "#A03B2A", icon: "⛔" }
      : healthStatus === "Saludable"
        ? { bg: "#E3EFE0", border: "#93BF8D", text: "#315D36", icon: "✓" }
        : { bg: "#FFF1D6", border: "#E3B35B", text: "#7B5410", icon: "⚠" };
    const healthTitle = {
      INVENTORY_STOCK_DRIFT: "El stock y sus lotes no coinciden",
      FINISHED_RESULTS_DRIFT: "Los resultados físicos necesitan conciliación",
      KITCHEN_ORDER_STALLED: "Hay pedidos demorados en Cocina",
      PACKING_ORDER_STALLED: "Hay pedidos demorados en Empaque",
      CONNECTOR_HEARTBEAT_STALE: "Una integración necesita revisión",
      BACKUP_RPO_EXCEEDED: "El respaldo está fuera del tiempo objetivo",
      DATABASE_CONNECTION_PRESSURE: "La base está cerca de su límite de conexiones",
      SCHEMA_MIGRATION_MISSING: "El esquema del servidor está incompleto",
      PAID_ORDER_WITHOUT_FLOW: "Un pedido pagado no entró al flujo",
    };
    const healthDate = (value) => value
      ? new Date(value).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })
      : "Sin registro";
    const continuityBackup = continuitySnapshot?.backup || {};
    const continuityRecovery = continuitySnapshot?.recovery || {};

    return (
      <div>
        <Card className="p-4 mb-5" style={{ background: "linear-gradient(145deg, #fff, #FFF8EF)", borderColor: configDirty ? T.coral : T.border }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold">Configuración central de MOMOS</div>
              <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>
                {db.configurationSnapshotReady
                  ? `Versión ${db.configurationSnapshotVersion} · editá lo necesario y guardá una sola vez.`
                  : "Cargando la configuración protegida del servidor…"}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {configDirty && <span className="text-[10px] font-extrabold rounded-full px-3 py-1.5" style={{ background: "#FFF0D5", color: "#8A5D08" }}>Cambios sin guardar</span>}
              <Btn onClick={() => guardarCambiosConfiguracion()} disabled={!db.configurationSnapshotReady || !configDirty || guardandoDemoras}>
                {guardandoDemoras ? "Guardando…" : "Guardar configuración"}
              </Btn>
            </div>
          </div>
          {configMsg && <div className="text-xs font-bold mt-3" role="status" style={{ color: configMsg.startsWith("⚠️") ? "#A03B2A" : "#3F6B42" }}>{configMsg}</div>}
        </Card>
        <SectionTitle>🩺 Salud y continuidad de MOMO OPS</SectionTitle>
        <Card className="p-4" data-testid="operational-health-center" style={{ background: "linear-gradient(145deg, #fff, #FFF9F1)", borderColor: healthTone.border }}>
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg shrink-0" style={{ background: healthTone.bg, color: healthTone.text }} aria-hidden="true">{healthTone.icon}</span>
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-[.14em]" style={{ color: healthTone.text }}>Diagnóstico automático</div>
                <div className="font-serif text-xl font-bold mt-0.5">{healthStatus}</div>
                <div className="text-xs font-semibold mt-1 leading-relaxed" style={{ color: T.choco2 }}>
                  {healthSnapshot?.readOnly
                    ? "Las escrituras están protegidas hasta verificar y corregir el fallo de integridad."
                    : healthStatus === "Saludable"
                      ? "Pedidos, inventarios y trazabilidad están conciliados."
                      : "La operación puede continuar; revisá las advertencias para evitar que escalen."}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-2xl px-3 py-2 text-center min-w-[74px]" style={{ background: T.vainilla }}><div className="font-serif text-xl font-bold">{Number(healthCounts.critical || 0)}</div><div className="text-[9px] font-extrabold uppercase">Críticas</div></div>
              <div className="rounded-2xl px-3 py-2 text-center min-w-[74px]" style={{ background: T.vainilla }}><div className="font-serif text-xl font-bold">{Number(healthCounts.high || 0)}</div><div className="text-[9px] font-extrabold uppercase">Altas</div></div>
              <Btn small onClick={revisarSaludAhora} disabled={healthReviewing || healthLoading}>{healthReviewing ? "Revisando…" : "Revisar ahora"}</Btn>
            </div>
          </div>

          {healthError && <div className="mt-3 rounded-xl px-3 py-2 text-xs font-bold" role="alert" style={{ background: "#FBE1DC", color: "#A03B2A" }}>{healthError}</div>}
          {healthLoading && !healthSnapshot ? <div className="mt-4 text-sm font-semibold" style={{ color: T.choco2 }}>Consultando el estado protegido del servidor…</div> : <>
            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2 mt-4">
              <div className="rounded-2xl border p-3" style={{ borderColor: T.border, background: T.soft }}><div className="text-[9px] font-extrabold uppercase" style={{ color: T.choco2 }}>Última revisión</div><div className="text-sm font-bold mt-1">{healthDate(healthSnapshot?.lastCheckedAt)}</div></div>
              <div className="rounded-2xl border p-3" style={{ borderColor: T.border, background: T.soft }}><div className="text-[9px] font-extrabold uppercase" style={{ color: T.choco2 }}>Vigilancia</div><div className="text-sm font-bold mt-1">{healthSnapshot?.scheduler === "pg_cron" ? "Automática cada 5 minutos" : "Worker privado"}</div></div>
              <div className="rounded-2xl border p-3" style={{ borderColor: T.border, background: T.soft }}><div className="text-[9px] font-extrabold uppercase" style={{ color: T.choco2 }}>Backup observado</div><div className="text-sm font-bold mt-1">{continuityBackup.observed ? healthDate(continuityBackup.completedAt) : "Sin evidencia"}</div><div className="text-[10px] font-semibold mt-1" style={{ color: continuityBackup.pitrEnabled ? "#315D36" : "#A03B2A" }}>{continuityBackup.pitrEnabled ? "PITR activo" : "PITR inactivo"}</div></div>
              <div className="rounded-2xl border p-3" style={{ borderColor: continuityRecovery.certified ? "#93BF8D" : T.border, background: continuityRecovery.certified ? "#F2F7F0" : T.soft }}><div className="text-[9px] font-extrabold uppercase" style={{ color: T.choco2 }}>Recuperación comprobada</div><div className="text-sm font-bold mt-1">{continuityRecovery.certified ? `Certificada hasta ${healthDate(continuityRecovery.certifiedUntil)}` : continuityRecovery.tested ? `Último simulacro: ${continuityRecovery.status}` : "Simulacro pendiente"}</div></div>
            </div>
            <div className="mt-4 pt-4 border-t" style={{ borderColor: T.border }} data-testid="operational-slo-center">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div><div className="text-xs font-extrabold uppercase tracking-wide" style={{ color: T.choco2 }}>Nivel de servicio · última hora</div><div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>Disponibilidad y velocidad con evidencia agregada, nunca con datos de clientes.</div></div>
                <div className="flex gap-2 text-[10px] font-bold"><span>{Number(sloCounts.healthy || 0)} saludables</span><span>{Number(sloCounts.outside || 0)} fuera</span><span>{Number(sloCounts.withoutData || 0)} sin datos</span></div>
              </div>
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
                {sloSnapshot?.pendingActivation && <div className="sm:col-span-2 xl:col-span-4 rounded-2xl border px-3 py-3 text-xs font-bold" style={{ borderColor: T.border, background: T.vainilla, color: T.choco2 }}>H95 estÃ¡ listo en la aplicaciÃ³n y espera activaciÃ³n en el servidor. El diagnÃ³stico operativo actual sigue disponible.</div>}
                {sloServices.map((service) => {
                  const tone = sloTone(service.status);
                  const availabilityValue = service.availability == null ? "—" : `${(Number(service.availability) * 100).toFixed(2)}%`;
                  const p95Value = service.latency?.p95Ms == null ? "—" : `${service.latency.p95Ms} ms`;
                  return <div key={service.serviceCode} className="rounded-2xl border p-3" style={{ borderColor: T.border, background: "#fff" }}>
                    <div className="flex items-center justify-between gap-2"><div className="text-xs font-bold">{sloLabels[service.serviceCode] || service.serviceCode}</div><span className="rounded-full px-2 py-1 text-[8px] font-extrabold uppercase" style={{ background: tone.bg, color: tone.color }}>{service.status}</span></div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-center"><div><div className="font-serif text-base font-bold">{availabilityValue}</div><div className="text-[8px] uppercase font-bold" style={{ color: T.choco2 }}>Disponible</div></div><div><div className="font-serif text-base font-bold">{p95Value}</div><div className="text-[8px] uppercase font-bold" style={{ color: T.choco2 }}>p95</div></div><div><div className="font-serif text-base font-bold">{Number(service.sampleCount || 0)}</div><div className="text-[8px] uppercase font-bold" style={{ color: T.choco2 }}>Muestras</div></div></div>
                  </div>;
                })}
              </div>
            </div>
            <div className="mt-4 pt-4 border-t" style={{ borderColor: T.border }}>
              <div className="flex items-center justify-between gap-3 mb-2"><div className="text-xs font-extrabold uppercase tracking-wide" style={{ color: T.choco2 }}>Qué necesita atención</div><span className="text-[10px] font-bold">{healthIncidents.length} abiertas o recuperadas</span></div>
              {healthIncidents.length === 0 ? <div className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: "#E3EFE0", color: "#315D36" }}>✓ No hay incidentes pendientes.</div> : <div className="grid md:grid-cols-2 gap-2">
                {healthIncidents.slice(0, 6).map((incident) => <div key={incident.id} className="rounded-2xl border p-3" style={{ borderColor: incident.severity === "Crítica" ? "#E56B55" : T.border, background: incident.status === "Recuperado" ? "#F2F7F0" : "#fff" }}>
                  <div className="flex items-center justify-between gap-2"><span className="text-[9px] font-extrabold uppercase" style={{ color: incident.severity === "Crítica" ? "#A03B2A" : T.coral }}>{incident.severity} · {incident.domain}</span><Badge tone={incident.status === "Recuperado" ? "green" : "amber"}>{incident.status}</Badge></div>
                  <div className="text-sm font-bold mt-1">{healthTitle[incident.titleCode] || "Revisar una señal operativa"}</div>
                  <div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>Responsable: {incident.ownerRole} · detectado {healthDate(incident.lastSeenAt)}</div>
                </div>)}
              </div>}
            </div>
          </>}
        </Card>
        <SectionTitle>Zonas y tarifas de domicilio</SectionTitle>
        <Card className="p-4">
          {s.zonas.map((z, i) => (
            <div key={z.nombre} className="flex items-center justify-between gap-3 py-2 border-b last:border-0" style={{ borderColor: T.border }}>
              <span className="text-sm font-semibold">{z.nombre}</span>
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold" style={{ color: T.choco2 }}>$</span>
                <input type="number" value={z.tarifa} onChange={(e) => editarBorrador((d) => { d.settings.zonas[i].tarifa = +e.target.value; })}
                  className="w-24 rounded-xl px-2 py-1.5 text-sm border text-right font-bold" style={inputStyle} />
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t" style={{ borderColor: T.border }}>
            <span className="text-sm font-semibold">Pedido mínimo (sin domicilio)</span>
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold" style={{ color: T.choco2 }}>$</span>
              <input type="number" value={s.pedidoMinimo} onChange={(e) => editarBorrador((d) => { d.settings.pedidoMinimo = +e.target.value; })}
                className="w-24 rounded-xl px-2 py-1.5 text-sm border text-right font-bold" style={inputStyle} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t" style={{ borderColor: T.border }}>
            <span className="text-sm font-semibold">Horas de congelación objetivo (por defecto)</span>
            <div className="flex items-center gap-1">
              <input type="number" min="1" value={s.horasCongelacion || 10} onChange={(e) => editarBorrador((d) => { d.settings.horasCongelacion = +e.target.value; })}
                className="w-24 rounded-xl px-2 py-1.5 text-sm border text-right font-bold" style={inputStyle} />
              <span className="text-xs font-bold" style={{ color: T.choco2 }}>h</span>
            </div>
          </div>
        </Card>

        <SectionTitle>🗓️ Vida útil de Producción</SectionTitle>
        <Card className="p-4" data-testid="production-shelf-life-settings" style={{ background: "linear-gradient(145deg, #fff, #F5FAF2)" }}>
          <div className="flex items-start gap-3 mb-4">
            <span className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg shrink-0" style={{ background: "#E8F1E5", color: "#315D36" }} aria-hidden="true">🗓️</span>
            <div><div className="text-sm font-bold">Vencimientos automáticos de Cocina</div><div className="text-xs font-semibold mt-0.5 leading-relaxed" style={{ color: T.choco2 }}>La fecha se calcula desde el desmolde del producto o desde el registro de la mezcla. Cada lote conserva la vida útil con la que nació aunque esta configuración cambie después.</div></div>
          </div>
          {s.vidaUtilConfigurable ? <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Producto terminado">
              <div className="flex items-center gap-2"><Input type="number" min="1" max="30" step="1" value={s.vidaUtilProductoTerminadoDias} onChange={(e) => editarBorrador((d) => { d.settings.vidaUtilProductoTerminadoDias = Math.max(1, Math.min(30, Number.parseInt(e.target.value, 10) || 1)); })} /><span className="text-xs font-bold">días desde desmolde</span></div>
            </Field>
            <Field label="Mezclas y elaboraciones">
              <div className="flex items-center gap-2"><Input type="number" min="1" max="30" step="1" value={s.vidaUtilMezclasDias} onChange={(e) => editarBorrador((d) => { d.settings.vidaUtilMezclasDias = Math.max(1, Math.min(30, Number.parseInt(e.target.value, 10) || 1)); })} /><span className="text-xs font-bold">días desde preparación</span></div>
            </Field>
            <div className="sm:col-span-2 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: "#E8F1E5", color: "#315D36" }}>Regla actual: producto terminado {s.vidaUtilProductoTerminadoDias} días · mezclas {s.vidaUtilMezclasDias} días.</div>
          </div> : <div className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: "#FFF1D6", color: "#7B5410" }}>Aplicá la migración de vida útil configurable para editar estos valores sin desalinear Producción y la base de datos.</div>}
        </Card>

        <SectionTitle>⏱️ Tiempos de pedidos demorados</SectionTitle>
        <Card className="p-4" style={{ background: "linear-gradient(145deg, #fff, #FFF9F1)" }}>
          <div className="flex items-start gap-3 mb-4">
            <span className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg shrink-0" style={{ background: T.coralSoft, color: T.coral }} aria-hidden="true">⏱</span>
            <div>
              <div className="text-sm font-bold">Ritmo operativo por área</div>
              <div className="text-xs font-semibold mt-0.5 leading-relaxed" style={{ color: T.choco2 }}>
                Define cuándo Momo Ops avisa, cuándo escala una orden a urgente y cada cuánto vuelve a recordarla. Los cambios se comparten con Cocina, Empaque y Administración.
              </div>
            </div>
          </div>
          <div className="grid lg:grid-cols-[1fr_1fr_.72fr] gap-3">
            <div className="rounded-2xl border p-3" style={{ background: T.soft, borderColor: T.border }}>
              <div className="flex items-center gap-2 mb-3"><span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: T.rosa }} aria-hidden="true">👩‍🍳</span><div><div className="text-sm font-bold">Cocina</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>Preparación del pedido</div></div></div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Primer aviso">
                  <div className="flex items-center gap-2"><Input type="number" min="1" step="1" value={delayDraft.demoraCocinaMin} onChange={(e) => editarDemoras((current) => ({ ...current, demoraCocinaMin: e.target.value }))} /><span className="text-xs font-bold">min</span></div>
                </Field>
                <Field label="Urgente desde">
                  <div className="flex items-center gap-2"><Input type="number" min="1" step="1" value={delayDraft.demoraCocinaUrgenteMin} onChange={(e) => editarDemoras((current) => ({ ...current, demoraCocinaUrgenteMin: e.target.value }))} /><span className="text-xs font-bold">min</span></div>
                </Field>
              </div>
              <div className="text-[10px] font-bold rounded-xl px-2.5 py-2" style={{ background: T.rosa, color: "#7C3F4B" }}>Aviso a los {delayDraft.demoraCocinaMin} min → urgente a los {delayDraft.demoraCocinaUrgenteMin} min</div>
            </div>
            <div className="rounded-2xl border p-3" style={{ background: T.soft, borderColor: T.border }}>
              <div className="flex items-center gap-2 mb-3"><span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "#DCE7F2" }} aria-hidden="true">📦</span><div><div className="text-sm font-bold">Empaque</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>Alistamiento y sello</div></div></div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Primer aviso">
                  <div className="flex items-center gap-2"><Input type="number" min="1" step="1" value={delayDraft.demoraEmpaqueMin} onChange={(e) => editarDemoras((current) => ({ ...current, demoraEmpaqueMin: e.target.value }))} /><span className="text-xs font-bold">min</span></div>
                </Field>
                <Field label="Urgente desde">
                  <div className="flex items-center gap-2"><Input type="number" min="1" step="1" value={delayDraft.demoraEmpaqueUrgenteMin} onChange={(e) => editarDemoras((current) => ({ ...current, demoraEmpaqueUrgenteMin: e.target.value }))} /><span className="text-xs font-bold">min</span></div>
                </Field>
              </div>
              <div className="text-[10px] font-bold rounded-xl px-2.5 py-2" style={{ background: "#DCE7F2", color: "#3E5C7E" }}>Aviso a los {delayDraft.demoraEmpaqueMin} min → urgente a los {delayDraft.demoraEmpaqueUrgenteMin} min</div>
            </div>
            <div className="rounded-2xl border p-3 flex flex-col" style={{ background: T.vainilla, borderColor: T.border }}>
              <div className="flex items-center gap-2 mb-3"><span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "#fff" }} aria-hidden="true">🔔</span><div><div className="text-sm font-bold">Repetición</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>Mientras siga detenido</div></div></div>
              <Field label="Recordar cada">
                <div className="flex items-center gap-2"><Input type="number" min="1" step="1" value={delayDraft.demoraRepeticionMin} onChange={(e) => editarDemoras((current) => ({ ...current, demoraRepeticionMin: e.target.value }))} /><span className="text-xs font-bold">min</span></div>
              </Field>
              <div className="text-[10px] font-semibold mt-auto" style={{ color: T.choco2 }}>Evita que una orden urgente quede olvidada.</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t" style={{ borderColor: T.border }}>
            <Btn onClick={guardarTiemposDemora} disabled={guardandoDemoras}>{guardandoDemoras ? "Guardando…" : "Guardar tiempos"}</Btn>
            <div className="text-[10px] font-bold rounded-full px-3 py-1.5" style={{ background: "#E3EFE0", color: "#3F6B42" }}>✓ Se aplican en todos los equipos</div>
            {delayMsg && <span className="text-xs font-bold" role="status" style={{ color: delayMsg.startsWith("⚠️") ? "#A03B2A" : "#3F6B42" }}>{delayMsg}</span>}
          </div>
        </Card>

        <SectionTitle>Catálogos del negocio</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-3">
          {listas.map(([k, titulo]) => (
            <Card key={k} className="p-4">
              <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>{titulo.toUpperCase()}</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {s[k].map((v) => (
                  <span key={v} className="text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5" style={{ background: T.rosa, color: "#8E4B5A" }}>
                    {v}
                    {k !== "rellenos" && <button aria-label={`Quitar ${v}`} onClick={() => editarBorrador((d) => { d.settings[k] = d.settings[k].filter((x) => x !== v); })} className="font-bold opacity-70">✕</button>}
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={nuevoItem[k] || ""} onChange={(e) => setNuevoItem((prev) => ({ ...prev, [k]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && agregar(k)} placeholder="Agregar…"
                  className="flex-1 rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
                <Btn small kind="rosa" onClick={() => agregar(k)}>＋</Btn>
              </div>
            </Card>
          ))}
        </div>

        <SectionTitle>Figuras físicas y auxiliares (catálogo de Cocina)</SectionTitle>
        <Card className="p-4">
          <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>
            Lizi, Momo, Rocco, Teo, Toby, Danna y Max son <b>postres físicos</b>. Horizontal es una figura auxiliar de decoración y solo aparece mientras Cuchareable, Cake Momo o Cheesecake Momo estén activos.
          </div>
          {s.figuras.map((f, i) => (
            <div key={f.nombre} className="flex items-center justify-between gap-3 py-2 border-b last:border-0" style={{ borderColor: T.border }}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold truncate">{f.nombre}</span>
                <Badge label={isAuxiliaryFigureName(f.nombre) ? "Auxiliar de decoración" : f.especie === "perro" ? "Silueta: perro" : "Silueta: gato"} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isAuxiliaryFigureName(f.nombre)
                  ? <span className="text-[10px] font-bold" style={{ color: T.choco2 }}>Se activa automáticamente</span>
                  : <input value={f.gramaje} onChange={(e) => editarBorrador((d) => { d.settings.figuras[i].gramaje = e.target.value; })}
                    className="w-20 rounded-xl px-2 py-1.5 text-sm border text-right font-semibold" style={inputStyle} />}
                {isKitchenFigureName(f.nombre)
                  ? <span className="text-[9px] font-extrabold rounded-full px-2 py-1" style={{ background: "#E6F1E3", color: "#3F6B42" }}>CATÁLOGO PROTEGIDO</span>
                  : isAuxiliaryFigureName(f.nombre)
                    ? <span className="text-[9px] font-extrabold rounded-full px-2 py-1" style={{ background: "#FFF1D6", color: "#7A5510" }}>VISIBLE POR PRODUCTO ACTIVO</span>
                  : <button aria-label={`Quitar denominación heredada ${f.nombre}`} onClick={() => editarBorrador((d) => {
                    d.settings.figuras = d.settings.figuras.filter((x) => x.nombre !== f.nombre);
                  })} className="font-bold opacity-60 text-sm">Quitar legado</button>}
              </div>
            </div>
          ))}
          {(() => {
            const existing = new Set(s.figuras.map((figure) => figure.nombre));
            const missing = KITCHEN_FIGURE_NAMES.filter((name) => !existing.has(name));
            if (!missing.length) return <div className="rounded-xl px-3 py-2 mt-3 text-xs font-bold" style={{ background: "#E6F1E3", color: "#3F6B42" }}>✓ Las siete figuras físicas están completas. Sus nombres no se pueden reemplazar por una familia comercial.</div>;
            const selectedDefaults = KITCHEN_FIGURE_DEFAULTS[nuevaFig.nombre] || KITCHEN_FIGURE_DEFAULTS[missing[0]];
            const selectedName = missing.includes(nuevaFig.nombre) ? nuevaFig.nombre : missing[0];
            const selectedGrams = nuevaFig.nombre === selectedName && nuevaFig.gramaje ? nuevaFig.gramaje : `${selectedDefaults.grams} g`;
            const expectedProductId = expectedFigureProductId(selectedName);
            const canonicalProduct = (db.products || []).find((product) => product.id === expectedProductId);
            const canonicalFamily = canonicalProduct ? commercialFamilyLabel(canonicalProduct) : `Falta configurar ${expectedProductId}`;
            return <div className="flex flex-wrap gap-2 pt-3 items-center">
              <select value={selectedName} onChange={(e) => { const next = KITCHEN_FIGURE_DEFAULTS[e.target.value]; setNuevaFig({ nombre: e.target.value, especie: next.species, gramaje: `${next.grams} g`, productId: expectedFigureProductId(e.target.value) }); }} className="flex-1 min-w-[150px] rounded-xl px-3 py-2 text-sm border font-semibold" style={inputStyle}>
                {missing.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <span className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: T.vainilla }}>{selectedDefaults.species} · {selectedDefaults.grams} g base</span>
              <input value={selectedGrams} onChange={(e) => setNuevaFig({ ...nuevaFig, nombre: selectedName, especie: selectedDefaults.species, gramaje: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && agregarFigura()} placeholder={`${selectedDefaults.grams} g`}
                className="w-24 rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
              <span className="rounded-xl px-3 py-2 text-xs font-bold min-w-[190px]" style={{ background: canonicalProduct ? "#E6F1E3" : "#FFF1D6", color: canonicalProduct ? "#3F6B42" : "#7A5510" }}>Familia canónica: {canonicalFamily}</span>
              <Btn small kind="rosa" onClick={() => agregarFigura(selectedName)}>Restaurar figura</Btn>
            </div>;
          })()}
        </Card>

        <SectionTitle>Toppings / adiciones (catálogo)</SectionTitle>
        <Card className="p-4">
          <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>
            Un topping se agrega a la línea del pedido y <b>suma al total</b>. Precio <b>$0 = gratis</b> (incluido); mayor a 0 = extra pago.
            Si lo ligás a un insumo, se <b>descuenta del inventario</b> al vender y <b>vuelve</b> si el pedido se cancela.
          </div>
          {s.toppings.map((t, i) => (
            <div key={t.nombre} className="flex items-center justify-between gap-2 py-2 border-b last:border-0" style={{ borderColor: T.border }}>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-sm font-bold truncate">{t.nombre}</span>
                {(+t.precio > 0)
                  ? <Badge label={"+" + fmt(t.precio)} />
                  : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#DDEBD9", color: "#3F6B42" }}>gratis</span>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs font-bold" style={{ color: T.choco2 }}>$</span>
                <input type="number" min="0" value={t.precio} onChange={(e) => editarBorrador((d) => { d.settings.toppings[i].precio = +e.target.value || 0; })}
                  className="w-20 rounded-xl px-2 py-1.5 text-sm border text-right font-semibold" style={inputStyle} />
                <select value={t.insumoId || ""} onChange={(e) => editarBorrador((d) => { d.settings.toppings[i].insumoId = e.target.value; })}
                  className="rounded-xl px-2 py-1.5 text-xs border font-semibold max-w-[130px]" style={inputStyle}>
                  <option value="">— sin insumo —</option>
                  {(db.configurationInventoryChoices || []).map((it) => <option key={it.id} value={it.id}>{it.nombre}</option>)}
                </select>
                <button aria-label={`Quitar ${t.nombre}`} onClick={() => editarBorrador((d) => {
                  d.settings.toppings = d.settings.toppings.filter((x) => x.nombre !== t.nombre);
                })} className="font-bold opacity-60 text-sm">✕</button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-3 items-center">
            <input value={nuevoTop.nombre} onChange={(e) => setNuevoTop({ ...nuevoTop, nombre: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && agregarTopping()} placeholder="Nombre (ej. Chispas)"
              className="flex-1 min-w-[120px] rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold" style={{ color: T.choco2 }}>$</span>
              <input type="number" min="0" value={nuevoTop.precio} onChange={(e) => setNuevoTop({ ...nuevoTop, precio: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && agregarTopping()} placeholder="0 = gratis"
                className="w-24 rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
            </div>
            <select value={nuevoTop.insumoId} onChange={(e) => setNuevoTop({ ...nuevoTop, insumoId: e.target.value })}
              className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle}>
              <option value="">— sin insumo —</option>
              {(db.configurationInventoryChoices || []).map((it) => <option key={it.id} value={it.id}>{it.nombre}</option>)}
            </select>
            <Btn small kind="rosa" onClick={agregarTopping}>＋ Topping</Btn>
          </div>
        </Card>

        <SectionTitle>Usuarios (users · roles · permissions)</SectionTitle>
        <Card className="p-4">
          <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>
            Cada persona conserva un rol principal y puede acumular otros. Momo Ops une sus permisos sin duplicar el correo ni la cuenta de acceso.
          </div>
          {!db.multipleRolesReady && <div className="rounded-2xl px-3 py-2.5 mb-3 text-xs font-bold" style={{ background: "#FFF2D8", color: "#8A5D08", border: "1px solid #EDD4A8" }} role="status">
            Aplicá la migración 21 de roles múltiples para asignar más de un área a la misma persona. La administración actual sigue funcionando con un rol por usuario.
          </div>}
          {db.users.map((u) => {
            const userRoles = normalizeRoles(u);
            return <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 border-b" style={{ borderColor: T.border, opacity: u.activo ? 1 : 0.55 }}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold truncate">{u.nombre} <span className="text-xs font-semibold" style={{ color: T.choco2 }}>· {u.email}</span></div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {userRoles.map((role) => <span key={role} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: role === u.rol ? T.coralSoft : "#F4E8D3", color: role === u.rol ? "#923F2D" : T.choco2 }} title={PERMISOS_POR_ROL[role]}>
                    {role}{role === u.rol && <span className="opacity-70">· principal</span>}
                    {db.multipleRolesReady && userRoles.length > 1 && <button type="button" className="font-black opacity-70 hover:opacity-100" aria-label={`Quitar rol ${role} a ${u.nombre}`} onClick={async () => {
                      if (enviandoUser) return;
                      setEnviandoUser(true); setUserMsg("");
                      try {
                        const result = await quitarRolUsuario(u.id, role);
                        await refrescar();
                        setUserMsg(`Rol ${role} retirado de ${u.nombre}. Rol principal: ${result.rol}.`);
                      } catch (error) {
                        setUserMsg("⚠️ " + error.message);
                      } finally {
                        setEnviandoUser(false);
                      }
                    }}>×</button>}
                  </span>)}
                </div>
                <div className="text-[10px] mt-1.5 leading-relaxed" style={{ color: T.choco2 }}>{userRoles.map((role) => PERMISOS_POR_ROL[role]).filter(Boolean).join(" · ")}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge label={u.activo ? "Activo" : "Inactivo"} />
                <Btn small kind="ghost" onClick={async () => {
                  if (enviandoUser) return;
                  setEnviandoUser(true); setUserMsg("");
                  try {
                    await setUserActivo(u.id, !u.activo);
                    await refrescar();
                  } catch (e) {
                    setUserMsg("⚠️ " + e.message);
                  } finally {
                    setEnviandoUser(false);
                  }
                }}>{u.activo ? "Desactivar" : "Activar"}</Btn>
              </div>
            </div>;
          })}
          <div className="flex flex-wrap gap-2 pt-3 items-center">
            <input value={nuevoUser.nombre} onChange={(e) => setNuevoUser({ ...nuevoUser, nombre: e.target.value })} placeholder="Nombre"
              className="flex-1 min-w-[110px] rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
            <input value={nuevoUser.email} onChange={(e) => setNuevoUser({ ...nuevoUser, email: e.target.value })} placeholder="Correo"
              className="flex-1 min-w-[130px] rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
            <MiniSelect options={ROLES} value={nuevoUser.rol} onChange={(e) => setNuevoUser({ ...nuevoUser, rol: e.target.value })} />
            <Btn small kind="rosa" onClick={async () => {
              if (!nuevoUser.nombre.trim() || !nuevoUser.email.trim() || enviandoUser) return;
              setEnviandoUser(true); setUserMsg("");
              let r;
              try {
                r = await crearUsuarioStaff(nuevoUser.nombre, nuevoUser.email, nuevoUser.rol);
              } catch (e) {
                setUserMsg("⚠️ " + e.message);
                setEnviandoUser(false);
                return;
              }
              setNuevoUser({ nombre: "", email: "", rol: "Cocina" });
              try {
                await refrescar();
                setUserMsg(r.creado === undefined
                  ? `Usuario ${r.id} creado con el rol ${nuevoUser.rol}.`
                  : r.creado
                    ? `Usuario ${r.id} creado con el rol ${nuevoUser.rol}. Falta vincular su cuenta de acceso.`
                    : r.agregado
                      ? `${nuevoUser.rol} agregado al usuario ${r.id}. Ya puede operar ambas áreas con la misma cuenta.`
                      : `${nuevoUser.rol} ya estaba asignado al usuario ${r.id}; no se duplicó nada.`);
              } catch {
                setUserMsg(`El cambio sobre ${r.id} se guardó, pero no se pudo actualizar la vista. Recargá la página.`);
              }
              setEnviandoUser(false);
            }}>＋ Crear o asignar rol</Btn>
          </div>
          {userMsg && <div className="text-xs font-bold mt-2" style={{ color: userMsg.startsWith("⚠️") ? "#A03B2A" : "#3F6B42" }}>{userMsg}</div>}
        </Card>

        <SectionTitle>Políticas comerciales</SectionTitle>
        <Card className="p-4">
          <textarea rows={3} value={s.politicas} onChange={(e) => editarBorrador((d) => { d.settings.politicas = e.target.value; })}
            className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-y" style={{ ...inputStyle, fontFamily: "inherit" }} />
        </Card>

        <SectionTitle>Registro de actividad (audit log)</SectionTitle>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead><tr className="text-left text-xs" style={{ color: T.choco2 }}>
              {["Fecha","Usuario","Entidad","Acción","De → A"].map((h) => <th key={h} className="px-3 py-3 font-bold">{h}</th>)}
            </tr></thead>
            <tbody>
              {db.audit_logs.slice(0, 30).map((a) => (
                <tr key={a.id} className="border-t" style={{ borderColor: T.border }}>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{a.fecha}</td>
                  <td className="px-3 py-2 text-xs font-bold">{a.user}</td>
                  <td className="px-3 py-2 text-xs">{a.entidad} {a.entidadId}</td>
                  <td className="px-3 py-2 text-xs font-semibold">{a.accion}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: T.choco2 }}>{a.de ? `${a.de} → ${a.a}` : a.a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="mt-2"><Btn small kind="ghost" onClick={() => downloadCSV("audit-log", ["Fecha","Usuario","Entidad","ID","Acción","De","A"], db.audit_logs.map((a) => [a.fecha, a.user, a.entidad, a.entidadId, a.accion, a.de, a.a]))}>⬇ Exportar audit log</Btn></div>

        <SectionTitle>Datos</SectionTitle>
        <Card className="p-4 mb-3">
          <div className="text-sm font-semibold mb-1">💾 Backup diario</div>
          <div className="text-xs mb-3" style={{ color: T.choco2 }}>
            Descarga las tablas principales en archivos CSV (pedidos, items, clientes, inventario, movimientos, domicilios, evidencias, reclamos, beneficios, producción, reservas y audit log) más un respaldo completo en JSON. Hazlo al cierre de cada día.
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn small onClick={() => {
              const tablas = [
                ["pedidos", ["Pedido","Fecha","Hora","Canal","ClienteId","Barrio","Zona","Subtotal","Descuento","Dom cobrado","Dom costo","Total","Pago","Pagado en","Estado","Beneficio"],
                  db.orders.map((o) => [o.id, o.fecha, o.hora, o.canal, o.customerId, o.barrio, o.zona, orderSubtotal(db, o), o.descuento, o.domCobrado, o.domCosto, orderTotal(db, o), o.pago, o.pagadoEn || "", o.estado, o.benefitId])],
                ["items", ["Id","Pedido","Padre (caja)","Caja #","Producto","Sabor","Salsa","Relleno","Figura","Cant","Precio","Costo unitario histórico","Adiciones","Total adiciones","Costo insumo adiciones"],
                  db.order_items.map((i) => [i.id, i.orderId, i.parentItemId || "", i.cajaNum || "", i.nombre, i.sabor, i.salsa, i.relleno, i.figura, i.cant, i.precio, i.costoUnitario ?? "",
                    lineAdiciones(i).map((ad) => `${ad.nombre}×${ad.cant || 1} (+${(+ad.precio || 0) * (+ad.cant || 1)})`).join(" · "),
                    lineAdicionesTotal(i), lineAdicionesCOGS(db, i)])],
                ["clientes", ["Id","Nombre","Teléfono","Instagram","Barrio","Dirección","Canal","Primera","Última","Total","Pedidos","Cumple","Estado"],
                  db.customers.map((c) => [c.id, c.nombre, c.telefono, c.instagram, c.barrio, c.direccion, c.canal, c.primera, c.ultima, c.total, c.pedidos, c.cumple, c.estado])],
                ["inventario", ["Id","Nombre","Categoría","Unidad","Stock","Mínimo","Costo","Proveedor","Vence","Ubicación"],
                  db.inventory_items.map((i) => [i.id, i.nombre, i.cat, i.unidad, i.stock, i.min, i.costo, i.proveedor, i.vence, i.ubicacion])],
                ["movimientos", ["Id","Fecha","Tipo","Ítem","Cantidad","Nota"],
                  db.inventory_movements.map((m) => [m.id, m.fecha, m.tipo, m.item, m.cant, m.nota])],
                ["domicilios", ["Id","Pedido","Proveedor","Zona","Cobrado","Costo","Solicitud","Salida","Entrega","Código","Estado"],
                  db.deliveries.map((d) => [d.id, d.orderId, d.proveedor, d.zona, d.cobrado, d.costoReal, d.hSolicitud, d.hSalida, d.hEntrega, d.codigo, d.estado])],
                ["evidencias", ["Id","Pedido","Tipo","Fecha","Hora","Usuario","Tiene foto"],
                  db.evidences.map((e) => [e.id, e.orderId, e.tipo, e.fecha, e.hora, e.user, (e.storagePath || e.url) ? "Sí" : "No"])],
                ["reclamos", ["Id","Fecha","Pedido","ClienteId","Tipo","H entrega","H reclamo","Entregado en","Reclamo en","Decisión","Solución","Costo","Estado","Descripción","Evidencia"],
                  db.claims.map((r) => [r.id, r.fecha || "", r.orderId, r.customerId, r.tipo, r.hEntrega, r.hReclamo, r.entregadoEn || "", r.reclamoEn || "", r.decision, r.solucion, r.costo, r.estado, r.desc || "", r.evidencia || ""])],
                ["beneficios", ["Id","ClienteId","Beneficio","Tipo","Valor","Producto gratis","Mínimo","Activación","Vence","Estado","Pedido"],
                  db.benefits.map((b) => [b.id, b.customerId, b.beneficio, b.tipoBeneficio, b.valor, b.productoGratisId, b.minimo, b.activacion, b.vence, b.estado, b.pedidoUso])],
                ["produccion", ["Lote","Fecha","Producto","Figura","Sabor","Gramaje","Producidas","Perfectas","Imperfectas","Descartadas","Destino","Resp","Desmoldado","Vence","Estado","Horas congelación","Inicio congelación","Stock contabilizado"],
                  db.production_batches.map((l) => [l.id, l.fecha, l.producto, l.figura, l.sabor, l.gramaje, l.prod, l.perfectas, l.imperfectas, l.descartadas, l.destino, l.resp, l.desmoldadoEn || "", l.vence, l.estado, l.horasCongelacion || "", l.inicioCongelacion || "", l.stockContabilizado ? "Sí" : "No"])],
                ["reservas", ["Id","Pedido","Tipo","Referencia","Cantidad","Fecha","Estado"],
                  db.inventory_reservations.map((r) => [r.id, r.orderId, r.tipo, r.nombre, r.cantidad, r.fecha, r.estado])],
                ["campanas", ["Id","Nombre","Canal","Objetivo","Producto","Oferta","Inicio","Fin","Presupuesto","Gasto real","Estado","Responsable"],
                  db.campaigns.map((c) => [c.id, c.nombre, c.canal, c.objetivo, c.productoFoco, c.oferta, c.fechaInicio, c.fechaFin, c.presupuesto, c.gastoReal, c.estado, c.responsable])],
                ["creativos", ["Id","Campaña","Título","Canal","Formato","Producto","Hook","Estado","Responsable","Entrega"],
                  db.creatives.map((c) => [c.id, c.campaignId, c.titulo, c.canal, c.formato, c.productoFoco, c.hook, c.estado, c.responsable, c.fechaEntrega])],
                ["calendario", ["Id","Fecha","Hora","Canal","Campaña","Creativo","Título","Estado"],
                  db.content_calendar.map((p) => [p.id, p.fecha, p.hora, p.canal, p.campaignId, p.creativeId, p.titulo, p.estado])],
                ["resultados-creativos", ["Id","Creativo","Campaña","Fecha","Impresiones","Alcance","Clicks","Mensajes WA","Pedidos","Ventas","Gasto"],
                  db.creative_results.map((r) => { const a = atribucionDeResultado(db, r); return [r.id, r.creativeId, r.campaignId, r.fecha, r.impresiones, r.alcance, r.clicks, r.mensajesWhatsApp, a.contabilizar ? a.pedidos : "", a.contabilizar ? a.ventas : "", r.gasto]; })],
                ["ideas-marketing", ["Id","Título","Categoría","Objetivo","Producto","Copy","Guion","Canal","Estado"],
                  (db.marketing_ideas || []).map((i) => [i.id, i.titulo, i.cat, i.objetivo, i.productoSugerido, i.copy, i.guionCorto, i.canal, i.estado])],
                ["guiones-marketing", ["Id","Título","Duración","Producto","Objetivo","Dificultad","Escena 1","Escena 2","Escena 3","Escena 4","Texto pantalla","Audio"],
                  (db.marketing_guiones || []).map((g) => [g.id, g.titulo, g.duracion, g.productoFoco, g.objetivo, g.dificultad, g.escena1, g.escena2, g.escena3, g.escena4, g.textoPantalla, g.audio])],
                ["mensajes-whatsapp", ["Id","Tipo","Texto"],
                  (db.marketing_mensajes || []).map((m) => [m.id, m.tipo, m.texto])],
                ["tareas-marketing", ["Id","Tarea","Fecha","Estado","Responsable"],
                  (db.marketing_tasks || []).map((t) => [t.id, t.tarea, t.fecha, t.estado, t.responsable])],
                ["biblioteca-marca", ["Tipo","Valor"],
                  [
                    ...((db.brand_library && db.brand_library.frases) || []).map((v) => ["Frase", v]),
                    ...((db.brand_library && db.brand_library.tono) || []).map((v) => ["Tono", v]),
                    ...((db.brand_library && db.brand_library.palabrasSi) || []).map((v) => ["Palabra sí", v]),
                    ...((db.brand_library && db.brand_library.palabrasNo) || []).map((v) => ["Palabra no", v]),
                  ]],
                ["audit-log", ["Fecha","Usuario","Entidad","Id","Acción","De","A"],
                  db.audit_logs.map((a) => [a.fecha, a.user, a.entidad, a.entidadId, a.accion, a.de, a.a])],
              ];
              tablas.forEach(([nombre, headers, rows], i) => setTimeout(() => downloadCSV("momos-" + nombre, headers, rows), i * 450));
              setBackupMsg(`Descargando ${tablas.length} archivos CSV… revisa tu carpeta de descargas.`);
            }}>⬇ Backup en CSV (todas las tablas)</Btn>
            <Btn small kind="ghost" onClick={() => {
              const blob = new Blob([JSON.stringify(db)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "momos-backup-completo-" + hoyISO() + ".json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 2000);
              setBackupMsg("Respaldo JSON completo descargado (incluye fotos).");
            }}>⬇ Respaldo completo JSON</Btn>
          </div>
          <div className="mt-3 pt-3 border-t" style={{ borderColor: T.border }}>
            <div className="text-xs font-semibold mb-1.5" style={{ color: T.choco2 }}>♻️ Restaurar desde un respaldo JSON</div>
            <input type="file" accept="application/json" className="text-xs" onChange={(e) => {
              const file = e.target.files && e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = async () => {
                try {
                  const data = JSON.parse(reader.result);
                  if (!data || typeof data !== "object") { setBackupMsg("❌ El archivo no es un respaldo válido de MOMOS."); return; }
                  if (data.version && data.version > DB_VERSION) { setBackupMsg("❌ Este backup pertenece a una versión más nueva de MOMOS OPS."); return; }
                  const arraysReq = ["orders","order_items","customers","products"];
                  const faltanArray = arraysReq.filter((t) => !Array.isArray(data[t]));
                  if (faltanArray.length) { setBackupMsg("❌ El archivo no es un respaldo válido de MOMOS (tablas dañadas: " + faltanArray.join(", ") + ")."); return; }
                  if (!data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) { setBackupMsg("❌ El archivo no es un respaldo válido de MOMOS (falta la configuración)."); return; }
                  await restaurarBackup(data);
                  setBackupMsg("Backup restaurado correctamente.");
                } catch (err) {
                  setBackupMsg("❌ No se pudo restaurar: " + (err && err.message ? err.message : "formato inválido") + ".");
                }
              };
              reader.readAsText(file);
              e.target.value = "";
            }} />
            <div className="text-[11px] mt-1" style={{ color: T.choco2 }}>Reemplaza todos los datos actuales por los del archivo. Descarga antes un respaldo por si acaso.</div>
          </div>
          {backupMsg && <div className="text-xs font-bold mt-2" style={{ color: "#3F6B42" }}>{backupMsg}</div>}
        </Card>

        <Card className="p-4 mb-3">
          <div className="text-sm font-semibold mb-1">📷 Almacenamiento de fotos</div>
          <div className="text-xs font-bold p-2.5 rounded-xl" style={{ background: "#FBE8C8", color: "#96690F" }}>
            Las evidencias fotográficas se guardan en el bucket privado de <b>Supabase Storage</b>.
            Cada archivo queda ligado al pedido y al paso operativo correspondiente; las vistas temporales usan enlaces firmados que vencen automáticamente.
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-sm font-semibold mb-2">Reiniciar datos de ejemplo</div>
          <div className="text-xs mb-3" style={{ color: T.choco2 }}>Borra todos los datos guardados y vuelve a cargar los datos de ejemplo de El Caney. Esta acción no se puede deshacer.</div>
          {!confirmar ? <Btn small kind="danger" onClick={() => setConfirmar(true)}>Reiniciar datos…</Btn> : (
            <div className="flex gap-2">
              <Btn small kind="danger" onClick={resetear}>Sí, borrar y reiniciar</Btn>
              <Btn small kind="ghost" onClick={() => setConfirmar(false)}>Cancelar</Btn>
            </div>
          )}
        </Card>
      </div>
    );
  }


  /* ================= MARKETING 📣 ================= */

  function Marketing({ db, update, user, refrescar }) {
    const [nueva, setNueva] = useState(false);
    const [sel, setSel] = useState(null);
    const [form, setForm] = useState({ nombre: "", canal: "Instagram", objetivo: "Ventas", productoFoco: "", oferta: "", fechaInicio: hoyISO(), fechaFin: dISO(15), presupuesto: 0, gastoReal: 0, estado: "Planeada", responsable: "Marketing", notas: "" });

    const activas = db.campaigns.filter((c) => c.estado === "Activa");
    const totalPresup = db.campaigns.reduce((s, c) => s + (c.presupuesto || 0), 0);
    const totalGasto = db.campaigns.reduce((s, c) => s + (c.gastoReal || 0), 0);
    const conMetrics = db.campaigns.map((c) => ({ c, m: campaignMetrics(db, c) }));
    const mejores = [...conMetrics].filter((x) => x.m.roas !== null).sort((a, b) => b.m.roas - a.m.roas);
    const sinVentas = conMetrics.filter((x) => x.m.pedidos === 0 && x.c.estado !== "Planeada");

    function exportar() {
      downloadCSV("campanas",
        ["Id","Nombre","Canal","Objetivo","Producto o presentación foco","Oferta","Inicio","Fin","Presupuesto","Gasto real","Pedidos atrib.","Ventas atrib.","CAC","ROAS","Estado","Responsable"],
        conMetrics.map(({ c, m }) => [c.id, c.nombre, c.canal, c.objetivo, c.productoFoco, c.oferta, c.fechaInicio, c.fechaFin, c.presupuesto, c.gastoReal, m.pedidos, m.ventas, m.cac ? Math.round(m.cac) : "", m.roas ? m.roas.toFixed(2) : "", c.estado, c.responsable]));
    }

    // Fase 3 · Hito 2: la campaña nace en el SERVER (crear_campana). productoFoco (nombre) → id.
    async function guardar() {
      if (!form.nombre.trim()) { toast("error", "Falta el nombre de la campaña"); return; }
      const prodId = form.productoFoco ? (db.products.find((p) => p.nombre === form.productoFoco)?.id || null) : null;
      let res;
      try {
        res = await crearCampana({
          nombre: form.nombre, canal: form.canal, objetivo: form.objetivo,
          producto_foco_id: prodId, oferta: form.oferta,
          fecha_inicio: form.fechaInicio, fecha_fin: form.fechaFin,
          presupuesto: form.presupuesto, gasto_real: form.gastoReal,
          estado: form.estado, responsable: form.responsable, notas: form.notas,
        });
      } catch (e) { toast("error", e.message); return; }
      setNueva(false);
      setForm({ nombre: "", canal: "Instagram", objetivo: "Ventas", productoFoco: "", oferta: "", fechaInicio: hoyISO(), fechaFin: dISO(15), presupuesto: 0, gastoReal: 0, estado: "Planeada", responsable: "Marketing", notas: "" });
      toast("ok", `Campaña ${res.id} creada`);
      try { await refrescar(); } catch { toast("error", "Campaña creada; recargá para verla"); }
    }

    return (
      <div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat icon="📣" label="Campañas activas" value={activas.length} sub={db.campaigns.length + " en total"} tone={T.coral} />
          <Stat icon="💵" label="Presupuesto total" value={fmt(totalPresup)} sub={"gastado " + fmt(totalGasto)} />
          <Stat icon="🛒" label="Pedidos atribuidos" value={conMetrics.reduce((s, x) => s + x.m.pedidos, 0)} sub="con venta confirmada" tone="#3F6B42" />
          <Stat icon="📈" label="Ventas atribuidas" value={fmt(conMetrics.reduce((s, x) => s + x.m.ventas, 0))} sub="por campañas" tone="#3F6B42" />
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <Btn onClick={() => setNueva(true)}>＋ Nueva campaña</Btn>
          <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
        </div>

        {sinVentas.length > 0 && (
          <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: "#FBE8C8", color: "#96690F" }}>
            ⚠️ Campañas activas/finalizadas sin ventas atribuidas: {sinVentas.map((x) => x.c.nombre).join(", ")}
          </div>
        )}

        <SectionTitle>Campañas</SectionTitle>
        <div className="grid lg:grid-cols-2 gap-3">
          {conMetrics.map(({ c, m }) => {
            const usoPresup = c.presupuesto > 0 ? (c.gastoReal / c.presupuesto) : 0;
            return (
              <Card key={c.id} className="p-4" onClick={() => setSel(c)}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate">{c.nombre}</div>
                    <div className="text-xs" style={{ color: T.choco2 }}>{c.objetivo} · {c.productoFoco ? `foco: ${commercialFamilyLabel(c.productoFoco)}` : "sin producto o presentación foco"}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge label={c.estado} />
                    <Badge label={c.canal} map={MK_CANAL_STYLE} />
                  </div>
                </div>
                {c.oferta && <div className="text-xs mt-2 p-1.5 rounded-lg" style={{ background: T.vainilla }}>🎁 {c.oferta}</div>}
                <div className="mt-2">
                  <div className="flex justify-between text-[11px] font-bold mb-1" style={{ color: T.choco2 }}>
                    <span>Presupuesto {fmt(c.presupuesto)}</span><span>Gasto {fmt(c.gastoReal)}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: T.vainilla }}>
                    <div className="h-full rounded-full" style={{ width: Math.max(0, Math.min(100, usoPresup * 100)) + "%", background: usoPresup > 1 ? "#A03B2A" : T.rosaDeep }} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                  {[["Pedidos", m.pedidos, T.choco], ["Ventas", fmt(m.ventas), "#3F6B42"], ["CAC", m.cac !== null ? fmt(m.cac) : "—", "#96690F"], ["ROAS", m.roas !== null ? m.roas.toFixed(1) + "x" : "—", m.roas >= 1 ? "#3F6B42" : "#A03B2A"]].map(([lab, v, col]) => (
                    <div key={lab} className="rounded-xl py-2" style={{ background: T.vainilla }}>
                      <div className="text-sm font-bold truncate px-0.5" style={{ color: col }}>{v}</div>
                      <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{lab}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] mt-2" style={{ color: T.choco2 }}>{c.fechaInicio} → {c.fechaFin} · {c.responsable}</div>
              </Card>
            );
          })}
        </div>

        {mejores.length > 0 && (
          <>
            <SectionTitle>🏆 Mejores campañas por ROAS</SectionTitle>
            <Card className="p-4"><Bars data={mejores.slice(0, 5).map((x) => ({ label: x.c.nombre, value: +x.m.roas.toFixed(2), color: T.rosaDeep }))} /></Card>
          </>
        )}

        {nueva && (
          <Modal title="Nueva campaña" onClose={() => setNueva(false)} wide>
            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Nombre"><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Campaña Lizi de Oreo" /></Field>
              <Field label="Canal"><Select options={MK_CANALES} value={form.canal} onChange={(e) => setForm({ ...form, canal: e.target.value })} /></Field>
              <Field label="Objetivo"><Select options={MK_OBJETIVOS} value={form.objetivo} onChange={(e) => setForm({ ...form, objetivo: e.target.value })} /></Field>
              <Field label="Producto o presentación comercial foco"><Select placeholder="Sin foco único" options={db.products.map((p) => p.nombre)} value={form.productoFoco} onChange={(e) => setForm({ ...form, productoFoco: e.target.value })} /></Field>
              <Field label="Oferta"><Input value={form.oferta} onChange={(e) => setForm({ ...form, oferta: e.target.value })} placeholder="Ej: 2x1, envío gratis…" /></Field>
              <Field label="Responsable"><Input value={form.responsable} onChange={(e) => setForm({ ...form, responsable: e.target.value })} /></Field>
              <Field label="Fecha inicio"><Input type="date" value={form.fechaInicio} onChange={(e) => setForm({ ...form, fechaInicio: e.target.value })} /></Field>
              <Field label="Fecha fin"><Input type="date" value={form.fechaFin} onChange={(e) => setForm({ ...form, fechaFin: e.target.value })} /></Field>
              <Field label="Presupuesto"><Input type="number" value={form.presupuesto} onChange={(e) => setForm({ ...form, presupuesto: +e.target.value })} /></Field>
              <Field label="Gasto real"><Input type="number" value={form.gastoReal} onChange={(e) => setForm({ ...form, gastoReal: +e.target.value })} /></Field>
              <Field label="Estado"><Select options={CAMP_ESTADOS} value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} /></Field>
            </div>
            <Field label="Notas"><Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Field>
            <div className="flex gap-2 mt-2"><BtnAsync onClick={guardar} textoEnVuelo="Creando…">Crear campaña</BtnAsync><Btn kind="ghost" onClick={() => setNueva(false)}>Cancelar</Btn></div>
          </Modal>
        )}

        {sel && (
          <Modal title={sel.nombre} onClose={() => setSel(null)} wide>
            <div className="flex flex-wrap gap-2 mb-3"><Badge label={sel.estado} /><Badge label={sel.canal} map={MK_CANAL_STYLE} /><span className="text-xs font-semibold" style={{ color: T.choco2 }}>{sel.objetivo}</span></div>
            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Estado">
                <select value={sel.estado} onChange={(e) => setSel({ ...sel, estado: e.target.value })} className={inputCls} style={inputStyle}>{CAMP_ESTADOS.map((s) => <option key={s}>{s}</option>)}</select>
              </Field>
              {/* String crudo (no +coerción): vaciar el input queda '' y el PATCH lo OMITE — no pisa a 0. */}
              <Field label="Gasto real"><Input type="number" value={sel.gastoReal} onChange={(e) => setSel({ ...sel, gastoReal: e.target.value })} /></Field>
              <Field label="Presupuesto"><Input type="number" value={sel.presupuesto} onChange={(e) => setSel({ ...sel, presupuesto: e.target.value })} /></Field>
              <Field label="Oferta"><Input value={sel.oferta} onChange={(e) => setSel({ ...sel, oferta: e.target.value })} /></Field>
            </div>
            <Field label="Notas"><Input value={sel.notas} onChange={(e) => setSel({ ...sel, notas: e.target.value })} /></Field>
            <div className="text-xs font-semibold mb-3 p-2.5 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>
              Creativos de esta campaña: {db.creatives.filter((cr) => cr.campaignId === sel.id).length} · Pedidos atribuidos: {ordersDeCampaign(db, sel.id).length}
            </div>
            <div className="flex gap-2">
              <BtnAsync onClick={async () => {
                // PATCH por DIFF: solo las claves que cambiaron respecto del valor hidratado (el
                // resto — nombre, canal, foco, fechas — queda intacto server-side). Los numéricos
                // van solo si quedaron con un número válido: vaciar el input NO pisa el dato a 0.
                const orig = db.campaigns.find((x) => x.id === sel.id) || sel;
                const patch = {};
                if (sel.estado !== orig.estado) patch.estado = sel.estado;
                if (sel.oferta !== orig.oferta) patch.oferta = sel.oferta;
                if (sel.notas !== orig.notas) patch.notas = sel.notas;
                if (String(sel.presupuesto).trim() !== "" && !Number.isNaN(+sel.presupuesto) && +sel.presupuesto !== orig.presupuesto) patch.presupuesto = +sel.presupuesto;
                if (String(sel.gastoReal).trim() !== "" && !Number.isNaN(+sel.gastoReal) && +sel.gastoReal !== orig.gastoReal) patch.gasto_real = +sel.gastoReal;
                if (Object.keys(patch).length === 0) { setSel(null); toast("ok", "Sin cambios"); return; }
                let res;
                try {
                  res = await editarCampana(sel.id, patch);
                } catch (e) { toast("error", e.message); return; }
                setSel(null);
                toast("ok", res.cambio_estado ? `Campaña → ${sel.estado}` : "Campaña actualizada");
                try { await refrescar(); } catch { toast("error", "Guardado; recargá para verlo"); }
              }}>Guardar</BtnAsync>
              <Btn kind="ghost" onClick={() => setSel(null)}>Cancelar</Btn>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  /* ================= CREATIVOS 🎨 ================= */

  function Creativos({ db, refrescar }) {
    const [nuevo, setNuevo] = useState(false);
    const [sel, setSel] = useState(null);
    const [selBase, setSelBase] = useState(null);
    const [fEstado, setFEstado] = useState("");
    const vacio = { campaignId: "", titulo: "", canal: "Instagram", formato: "Reel", productoFoco: "", figuraFoco: "", saborFoco: "", hook: "", copy: "", guion: "", estado: "Idea", responsable: "Marketing", fechaEntrega: dISO(3), assetUrl: "", notas: "" };
    const [form, setForm] = useState(vacio);
    const sabores = [...db.settings.saboresFrutales, ...db.settings.saboresCremosos];

    function focusProductFor(draft) {
      return draft?.productoFoco ? db.products.find((product) => product.nombre === draft.productoFoco) : null;
    }

    function compatibleFigureNames(draft) {
      const product = focusProductFor(draft);
      if (!isCommercialFamilyProduct(product)) return [];
      return activeFigureCatalog(db)
        .filter((figure) => figureProductId(figure) === product.id)
        .map((figure) => figure.nombre);
    }

    function validateCreativeSubject(draft) {
      const product = focusProductFor(draft);
      if (!isCommercialFamilyProduct(product)) return "";
      const allowed = compatibleFigureNames(draft);
      if (!allowed.includes(draft.figuraFoco)) return `Elegí una figura física de ${commercialFamilyLabel(product)}: ${allowed.join(", ") || "falta configurarla en Producción"}.`;
      if (!draft.saborFoco) return "Elegí el sabor protagonista del creativo.";
      return "";
    }

    const grupos = [["Idea","Ideas pendientes"],["En diseño","En diseño"],["En revisión","En revisión"],["Aprobado","Aprobados"],["Publicado","Publicados"],["Ganador","Ganadores"]];
    const lista = db.creatives.filter((c) => !fEstado || c.estado === fEstado);

    function exportar() {
      downloadCSV("creativos",
        ["Id","Campaña","Título","Canal","Formato","Producto","Figura","Sabor","Hook","Estado","Responsable","Entrega"],
        db.creatives.map((c) => { const camp = db.campaigns.find((x) => x.id === c.campaignId); return [c.id, camp ? camp.nombre : "", c.titulo, c.canal, c.formato, c.productoFoco, c.figuraFoco, c.saborFoco, c.hook, c.estado, c.responsable, c.fechaEntrega]; }));
    }

    function payloadCreativo(f) {
      const prodId = f.productoFoco ? (db.products.find((p) => p.nombre === f.productoFoco)?.id || null) : null;
      return {
        campaign_id: f.campaignId || null, titulo: f.titulo, canal: f.canal, formato: f.formato,
        producto_foco_id: prodId, figura: f.figuraFoco || null, sabor: f.saborFoco || null,
        hook: f.hook, copy: f.copy, guion: f.guion, estado: f.estado,
        responsable: f.responsable, fecha_entrega: f.fechaEntrega || null,
        asset_url: f.assetUrl, notas: f.notas,
      };
    }

    async function guardar() {
      if (!form.titulo.trim()) { toast("error", "Falta el título del creativo"); return; }
      const subjectError = validateCreativeSubject(form);
      if (subjectError) { toast("error", subjectError); return; }
      let res;
      try { res = await crearCreativo(payloadCreativo(form)); }
      catch (e) { toast("error", e.message); return; }
      setNuevo(false); setForm(vacio);
      toast("ok", `Creativo ${res.id} creado`);
      try { await refrescar(); } catch { toast("error", "Creativo creado; recargá para verlo"); }
    }

    async function guardarEdicion() {
      // El baseline queda congelado al abrir el modal. Comparar contra el polling
      // más reciente podría reenviar valores viejos y pisar cambios de otro equipo.
      const orig = selBase || sel;
      const subjectError = validateCreativeSubject(sel);
      if (subjectError) { toast("error", subjectError); return; }
      const antes = payloadCreativo(orig);
      const despues = payloadCreativo(sel);
      const patch = {};
      Object.keys(despues).forEach((k) => { if (despues[k] !== antes[k]) patch[k] = despues[k]; });
      if (!Object.keys(patch).length) { setSel(null); setSelBase(null); toast("ok", "Sin cambios"); return; }
      let res;
      try { res = await editarCreativo(sel.id, patch); }
      catch (e) { toast("error", e.message); return; }
      setSel(null); setSelBase(null);
      toast("ok", res.cambio_estado ? `Creativo → ${sel.estado}` : "Creativo actualizado");
      try { await refrescar(); } catch { toast("error", "Guardado; recargá para verlo"); }
    }

    async function crearPostDesdeCreativo() {
      let res;
      try {
        res = await crearPublicacion({
          fecha: hoyISO(), hora: "12:00", canal: sel.canal,
          creative_id: sel.id, titulo: sel.titulo, copy_final: sel.copy || "",
          estado: "Programado", url_publicacion: "", notas: "Creado desde Creativos",
        });
      } catch (e) { toast("error", e.message); return; }
      setSel(null); setSelBase(null);
      toast("ok", `Publicación ${res.id} creada`);
      try { await refrescar(); } catch { toast("error", "Publicación creada; recargá para verla"); }
    }

    return (
      <div>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
          {grupos.map(([est, lab]) => (
            <Card key={est} className="p-3 text-center" onClick={() => setFEstado(fEstado === est ? "" : est)}>
              <div className="display text-xl" style={{ color: est === "Ganador" ? "#8E4B5A" : est === "Publicado" ? "#2F6B60" : T.choco }}>{db.creatives.filter((c) => c.estado === est).length}</div>
              <div className="text-[10px] font-bold leading-tight" style={{ color: T.choco2 }}>{lab}</div>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <Btn onClick={() => setNuevo(true)}>＋ Nuevo creativo</Btn>
          <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
          {fEstado && <Btn small kind="ghost" onClick={() => setFEstado("")}>Ver todos ({db.creatives.length})</Btn>}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lista.map((c) => {
            const camp = db.campaigns.find((x) => x.id === c.campaignId);
            const pedidos = ordersDeCreative(db, c.id).length;
            return (
              <Card key={c.id} className="p-4" onClick={() => { setSel({ ...c }); setSelBase({ ...c }); }}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm leading-tight">{c.titulo}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: T.choco2 }}>{c.formato} · {camp ? camp.nombre : "sin campaña"}</div>
                  </div>
                  <Badge label={c.estado} />
                </div>
                {c.hook && <div className="text-xs mt-2 italic p-2 rounded-lg" style={{ background: T.vainilla, color: T.choco }}>“{c.hook}”</div>}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Badge label={c.canal} map={MK_CANAL_STYLE} />
                  {c.productoFoco && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: T.vainilla, color: T.choco2 }}>Oferta foco: {commercialFamilyLabel(c.productoFoco)}</span>}
                  {c.figuraFoco && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: T.rosa, color: "#8E4B5A" }}>{c.figuraFoco}{c.saborFoco ? ` de ${c.saborFoco}` : ""}</span>}
                </div>
                <div className="flex justify-between items-center mt-2 text-[11px] font-semibold" style={{ color: T.choco2 }}>
                  <span>{c.responsable} · entrega {c.fechaEntrega}</span>
                  {pedidos > 0 && <span style={{ color: "#3F6B42" }}>{pedidos} pedido(s)</span>}
                </div>
              </Card>
            );
          })}
          {lista.length === 0 && <Empty icon="🎨" text="No hay creativos en este estado." />}
        </div>

        {(nuevo || sel) && (
          <Modal title={sel ? sel.titulo : "Nuevo creativo"} onClose={() => { setNuevo(false); setSel(null); setSelBase(null); }} wide>
            {(() => { const f = sel || form; const setF = sel ? setSel : setForm;
              return (
                <>
                  {sel && selBase && sel.estado !== selBase.estado && (
                    <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-xl text-xs font-bold" style={{ background: "#FFF1D6", color: "#7A5510" }} role="status">
                      <span>Cambio listo para guardar</span>
                      <Badge label={selBase.estado} />
                      <span aria-hidden="true">→</span>
                      <Badge label={sel.estado} />
                    </div>
                  )}
                  <div className="grid sm:grid-cols-2 gap-x-4">
                    <Field label="Título"><Input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Nombre interno del creativo" /></Field>
                    <Field label="Campaña">
                      <select value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })} className={inputCls} style={inputStyle}>
                        <option value="">Sin campaña</option>
                        {db.campaigns.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </Field>
                    <Field label="Canal"><Select options={MK_CANALES} value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })} /></Field>
                    <Field label="Formato"><Select options={MK_FORMATOS} value={f.formato} onChange={(e) => setF({ ...f, formato: e.target.value })} /></Field>
                    <Field label="Producto o presentación comercial foco"><Select placeholder="—" options={db.products.map((p) => p.nombre)} value={f.productoFoco} onChange={(e) => setF({ ...f, productoFoco: e.target.value, figuraFoco: "", saborFoco: "" })} /></Field>
                    <Field label="Postre / figura protagonista"><Select placeholder={isCommercialFamilyProduct(focusProductFor(f)) ? "Elegir figura exacta…" : "No aplica"} options={compatibleFigureNames(f)} value={f.figuraFoco} onChange={(e) => setF({ ...f, figuraFoco: e.target.value })} /></Field>
                    <Field label="Sabor foco"><Select placeholder="—" options={sabores} value={f.saborFoco} onChange={(e) => setF({ ...f, saborFoco: e.target.value })} /></Field>
                    <Field label="Estado"><Select options={CREA_ESTADOS} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })} /></Field>
                    <Field label="Responsable"><Input value={f.responsable} onChange={(e) => setF({ ...f, responsable: e.target.value })} /></Field>
                    <Field label="Fecha de entrega"><Input type="date" value={f.fechaEntrega} onChange={(e) => setF({ ...f, fechaEntrega: e.target.value })} /></Field>
                  </div>
                  <Field label="Hook (gancho)"><Input value={f.hook} onChange={(e) => setF({ ...f, hook: e.target.value })} placeholder="La frase que detiene el scroll" /></Field>
                  <Field label="Copy">
                    <textarea rows={2} value={f.copy} onChange={(e) => setF({ ...f, copy: e.target.value })} className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-y" style={{ ...inputStyle, fontFamily: "inherit" }} placeholder="Texto de la publicación" />
                  </Field>
                  <Field label="Guion">
                    <textarea rows={2} value={f.guion} onChange={(e) => setF({ ...f, guion: e.target.value })} className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-y" style={{ ...inputStyle, fontFamily: "inherit" }} placeholder="Escenas o pasos del video" />
                  </Field>
                  <Field label="URL del asset (opcional)"><Input value={f.assetUrl} onChange={(e) => setF({ ...f, assetUrl: e.target.value })} placeholder="Link a Drive, Canva…" /></Field>
                  <Field label="Notas"><Input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></Field>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {sel ? (
                      <BtnAsync onClick={guardarEdicion}>Guardar</BtnAsync>
                    ) : (
                      <BtnAsync onClick={guardar} textoEnVuelo="Creando…">Crear creativo</BtnAsync>
                    )}
                    {sel && ["Aprobado","Publicado","Ganador"].includes(sel.estado) && (
                      <BtnAsync kind="soft" onClick={crearPostDesdeCreativo} textoEnVuelo="Creando…">🗓️ Crear publicación</BtnAsync>
                    )}
                    <Btn kind="ghost" onClick={() => { setNuevo(false); setSel(null); setSelBase(null); }}>Cancelar</Btn>
                  </div>
                </>
              );
            })()}
          </Modal>
        )}
      </div>
    );
  }

  /* ================= CALENDARIO 🗓️ ================= */

  function Calendario({ db, refrescar }) {
    const [nueva, setNueva] = useState(false);
    const [vista, setVista] = useState(() => {
      const requested = window.sessionStorage.getItem("momos:calendar-view");
      window.sessionStorage.removeItem("momos:calendar-view");
      return requested === "Distribución" ? requested : "Activas";
    });
    const [distributionDraft, setDistributionDraft] = useState(null);
    const vacio = { fecha: hoyISO(), hora: "12:00", canal: "Instagram", campaignId: "", creativeId: "", titulo: "", copyFinal: "", estado: "Pendiente", urlPublicacion: "", notas: "" };
    const [form, setForm] = useState(vacio);
    const cambiosRef = useRef(new Set());
    const [estadosPendientes, setEstadosPendientes] = useState({});
    const vivoRef = useRef(true);
    useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; }; }, []);

    const commercialCalendar = useMemo(() => buildCommercialCalendar(db, hoyISO()), [db]);
    const distributionRoom = useMemo(() => buildDistributionRoom(db, hoyISO(), new Date().toLocaleTimeString("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" })), [db]);
    const distributionQueue = useMemo(() => distributionRoom.queue.map((item) => enrichDistributionWithDispatch(item, db)), [distributionRoom, db]);
    const formScheduleGuard = useMemo(() => form.creativeId
      ? calendarTransitionGuard({ ...form, id: "CAL-DRAFT", estado: "Pendiente" }, "Programado", db, hoyISO())
      : null, [form, db]);
    const semana = commercialCalendar.weekDates;
    const pubs = vista === "Activas" ? commercialCalendar.active : commercialCalendar.history;
    const todos = [...db.content_calendar].sort((a, b) => `${a.fecha}${a.hora}${a.id}`.localeCompare(`${b.fecha}${b.hora}${b.id}`));

    function exportar() {
      downloadCSV("calendario",
        ["Id","Fecha","Hora","Canal","Campaña","Creativo","Título","Estado","URL"],
        todos.map((p) => { const camp = db.campaigns.find((x) => x.id === p.campaignId); const cre = db.creatives.find((x) => x.id === p.creativeId); return [p.id, p.fecha, p.hora, p.canal, camp ? camp.nombre : "", cre ? cre.titulo : "", p.titulo, p.estado, p.urlPublicacion]; }));
    }

    function planificarCreativo(creative) {
      setForm({ ...vacio, ...buildPostDraftFromCreative(creative, db, hoyISO()) });
      setNueva(true);
    }

    function abrirPreparacion(item) {
      const checklist = {};
      distributionChecklistFor(item.post, db).forEach((step) => { checklist[step.key] = item.run?.checklist?.[step.key] === true; });
      setDistributionDraft({ mode: "prepare", item, checklist, notes: item.run?.notes || "", externalUrl: "", externalPostId: "", reason: "" });
    }

    function abrirCierre(item, mode = "publish") {
      setDistributionDraft({ mode, item, checklist: item.run?.checklist || {}, notes: "", externalUrl: item.dispatch?.job?.externalUrl || item.run?.externalUrl || "", externalPostId: item.dispatch?.job?.providerJobId || item.run?.externalPostId || "", reason: item.run?.failureReason || "" });
    }

    async function autorizarSalidaConector(item) {
      const eligibility = item.dispatch?.eligibility;
      if (!eligibility?.allowed) { toast("error", eligibility?.reasons?.[0] || "El conector todavía no está listo."); return; }
      try {
        const result = await autorizarDespachoDistribucion(item.post.id, eligibility.mode);
        toast("ok", result.duplicate ? `El despacho ya estaba ${result.status}` : `${eligibility.provider} autorizado · MOMO OPS lo enviará una sola vez`);
        await refrescar();
      } catch (error) { toast("error", error.message); }
    }

    async function reintentarSalidaConector(item) {
      const job = item.dispatch?.job;
      if (!job) return;
      try { await reintentarDespachoDistribucion(job.id); toast("ok", "Nuevo intento autorizado con una clave idempotente nueva"); await refrescar(); }
      catch (error) { toast("error", error.message); }
    }

    async function guardarPreparacionComercial() {
      const draft = distributionDraft;
      if (!draft) return;
      if (!db.distributionServerReady) { toast("error", "Aplicá la migración 19 para guardar la distribución trazable."); return; }
      const guard = validateDistributionAction("prepare", draft.item.post, db, draft.item.run, {}, hoyISO());
      if (!guard.allowed) { toast("error", guard.reasons[0]); return; }
      try {
        const res = await guardarPreparacionDistribucion(draft.item.post.id, draft.checklist, draft.notes);
        toast("ok", res.status === "Lista" ? "Checklist completo · salida Lista para aprobación" : "Preparación guardada");
        setDistributionDraft(null); await refrescar();
      } catch (error) { toast("error", error.message); }
    }

    async function aprobarSalidaComercial(item) {
      if (!db.distributionServerReady) { toast("error", "Aplicá la migración 19 para aprobar distribuciones."); return; }
      const guard = validateDistributionAction("approve", item.post, db, item.run, {}, hoyISO());
      if (!guard.allowed) { toast("error", guard.reasons[0]); return; }
      try { await aprobarDistribucion(item.post.id); toast("ok", "Salida aprobada · lista para publicar en su horario"); await refrescar(); }
      catch (error) { toast("error", error.message); }
    }

    async function cerrarSalidaComercial() {
      const draft = distributionDraft;
      if (!draft) return;
      if (!db.distributionServerReady) { toast("error", "Aplicá la migración 19 para cerrar distribuciones."); return; }
      const action = draft.mode === "fail" ? "fail" : "publish";
      const payload = action === "fail" ? { reason: draft.reason } : { externalUrl: draft.externalUrl, externalPostId: draft.externalPostId };
      const guard = validateDistributionAction(action, draft.item.post, db, draft.item.run, payload, hoyISO(), new Date().toLocaleTimeString("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" }));
      if (!guard.allowed) { toast("error", guard.reasons[0]); return; }
      try {
        await cerrarDistribucionPublicacion(draft.item.post.id, action === "fail" ? "Fallida" : "Publicada", draft.externalUrl, draft.externalPostId, action === "fail" ? draft.reason : draft.notes);
        toast("ok", action === "fail" ? "Fallo registrado sin perder trazabilidad" : "Publicación cerrada con evidencia externa");
        setDistributionDraft(null); await refrescar();
      } catch (error) { toast("error", error.message); }
    }

    async function guardar() {
      if (!form.titulo.trim()) { toast("error", "Falta el título de la publicación"); return; }
      if (form.estado === "Programado" && formScheduleGuard && !formScheduleGuard.allowed) { toast("error", formScheduleGuard.reasons[0]); return; }
      let res;
      try {
        res = await crearPublicacion({
          fecha: form.fecha, hora: form.hora, canal: form.canal,
          campaign_id: form.campaignId || null, creative_id: form.creativeId || null,
          titulo: form.titulo, copy_final: form.copyFinal, estado: form.estado,
          url_publicacion: form.urlPublicacion, notas: form.notas,
        });
      } catch (e) { toast("error", e.message); return; }
      setNueva(false); setForm(vacio);
      toast("ok", `Publicación ${res.id} creada`);
      try { await refrescar(); } catch { toast("error", "Publicación creada; recargá para verla"); }
    }

    async function cambiarEstado(p, estado) {
      if (cambiosRef.current.has(p.id) || estado === p.estado) return;
      if (db.distributionServerReady && estado === "Publicado") { toast("error", "Publicá y registrá la evidencia desde la pestaña Distribución."); return; }
      if (db.distributionServerReady && estado === "No publicado" && db.content_distributions.some((run) => run.postId === p.id)) { toast("error", "La salida preparada debe cerrarse como fallo desde Distribución."); return; }
      const guard = calendarTransitionGuard(p, estado, db, hoyISO());
      if (!guard.allowed) { toast("error", guard.reasons[0]); return; }
      cambiosRef.current.add(p.id);
      setEstadosPendientes((actuales) => ({ ...actuales, [p.id]: estado }));
      try {
        let res;
        try { res = await setPublicacionEstado(p.id, estado); }
        catch (e) { toast("error", e.message); return; }
        toast("ok", res.cambio ? `Publicación → ${estado}` : "Sin cambios");
        try { await refrescar(); } catch { toast("error", "Guardado; recargá para verlo"); }
      } finally {
        cambiosRef.current.delete(p.id);
        if (vivoRef.current) setEstadosPendientes((actuales) => {
          const siguientes = { ...actuales };
          delete siguientes[p.id];
          return siguientes;
        });
      }
    }

    return (
      <div>
        <SectionTitle action={
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 shrink-0" style={{ background: T.soft, border: `1px solid ${T.border}` }}>
            <span className="display font-semibold" style={{ color: T.coral, fontVariantNumeric: "tabular-nums" }}>{commercialCalendar.summary.readyToday}/{commercialCalendar.summary.today}</span>
            <span className="text-xs font-bold" style={{ color: T.choco2 }}>listas hoy</span>
          </div>
        }>Calendario inteligente MOMOS</SectionTitle>
        <div className="text-xs font-semibold mb-4 -mt-3" style={{ color: T.choco2 }}>Ordena la semana, valida marca y stock, y muestra exactamente qué debe ejecutar Marketing.</div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat icon="🗓️" label="Activas esta semana" value={<CountUp value={commercialCalendar.summary.scheduledWeek} />} tone={T.coral} />
          <Stat icon="⛔" label="Bloqueadas" value={<CountUp value={commercialCalendar.summary.blocked} />} sub="requieren corrección" tone="#A03B2A" />
          <Stat icon="⏰" label="Vencidas" value={<CountUp value={commercialCalendar.summary.overdue} />} sub="sin cerrar" tone="#96690F" />
          <Stat icon="✦" label="Por programar" value={<CountUp value={commercialCalendar.summary.unscheduledApproved} />} sub="creativos aprobados" tone="#3F6B42" />
        </div>

        {commercialCalendar.summary.blocked > 0 && <InlineNotice icon="⚠" title={`${commercialCalendar.summary.blocked} publicación(es) no deberían programarse todavía`} tone="danger" role="alert">Revisá aprobación del creativo, copy, canal, campaña y disponibilidad antes de continuar.</InlineNotice>}

        {commercialCalendar.agenda.length > 0 && <>
          <SectionTitle>Agenda priorizada de Marketing</SectionTitle>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
            {commercialCalendar.agenda.slice(0, 6).map((item) => <div key={item.id} className="rounded-2xl border p-4" style={{ borderColor: item.post.preflight.ready ? T.border : "#E8B7AD", background: item.post.preflight.ready ? "#fff" : "#FFF6F3" }}>
              <div className="flex items-start justify-between gap-2"><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: item.priority >= 90 ? "#A03B2A" : T.coral }}>{item.action}</div><Badge label={item.post.estado} /></div>
              <div className="font-bold text-sm mt-1">{item.post.titulo}</div>
              <div className="text-xs mt-1" style={{ color: T.choco2 }}>{item.post.fecha} · {item.post.hora} · {item.post.canal}</div>
              {!item.post.preflight.ready && <div className="text-[11px] font-bold mt-2" style={{ color: "#A03B2A" }}>⛔ {item.post.preflight.errors[0]?.message}</div>}
            </div>)}
          </div>
        </>}

        {commercialCalendar.planningQueue.length > 0 && <>
          <SectionTitle>Creativos aprobados esperando fecha</SectionTitle>
          <div className="flex gap-3 overflow-x-auto pb-3 mb-2">
            {commercialCalendar.planningQueue.slice(0, 8).map(({ creative, draft, preflight }) => <div key={creative.id} className="w-72 shrink-0 rounded-2xl border p-4" style={{ borderColor: preflight.ready ? T.border : "#E8B7AD", background: T.soft }}>
              <div className="flex justify-between gap-2"><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{creative.formato} · {creative.canal}</div><Badge label={creative.estado} /></div>
              <div className="display font-semibold mt-1">{creative.titulo}</div>
              <div className="text-xs mt-1 mb-3" style={{ color: T.choco2 }}>Sugerencia: {draft.fecha} · {draft.hora}</div>
              <Btn small kind={preflight.ready ? "primary" : "ghost"} onClick={() => planificarCreativo(creative)}>{preflight.ready ? "Planificar" : "Revisar borrador"}</Btn>
            </div>)}
          </div>
        </>}

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <SegmentedTabs
            ariaLabel="Bandejas del calendario"
            value={vista}
            onChange={setVista}
            className="momo-segmented-tabs inline-flex gap-1 p-1.5 rounded-2xl"
            tabClassName="rounded-xl border-0 px-4 py-2 text-xs font-extrabold"
            countClassName="ml-1 opacity-75"
            plainCount
            items={["Activas", "Distribución", "Historial"]}
            getCount={(tab) => tab === "Activas" ? commercialCalendar.active.length : tab === "Distribución" ? distributionRoom.queue.length : commercialCalendar.history.length}
          />
          <div className="flex gap-2"><Btn onClick={() => { setForm(vacio); setNueva(true); }}>＋ Nueva publicación</Btn>
          <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
          </div>
        </div>

        <SectionTitle>{vista === "Activas" ? "Bandeja activa por día" : vista === "Distribución" ? "Sala de distribución comercial" : "Historial de publicaciones"}</SectionTitle>
        {vista === "Activas" ? <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
          {semana.map((dia, i) => {
            const delDia = pubs.filter((p) => p.fecha === dia);
            const esHoy = dia === hoyISO();
            return (
              <div key={dia} className="momo-trace-open w-56 shrink-0" style={{ animationDelay: `${i * 55}ms` }}>
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-xs font-bold" style={{ color: esHoy ? T.coral : T.choco2 }}>{new Date(dia + "T12:00:00").toLocaleDateString("es-CO", { weekday: "short", day: "numeric" })}{esHoy && " · hoy"}</span>
                  <span className="text-xs font-bold" style={{ color: T.choco2, fontVariantNumeric: "tabular-nums" }}>{delDia.length}</span>
                </div>
                <div className="flex flex-col gap-2 min-h-[60px] rounded-2xl p-2" style={{ background: esHoy ? T.vainilla : T.vainilla + "80", border: esHoy ? `1.5px solid ${T.coral}40` : "1.5px solid transparent" }}>
                  {delDia.map((p) => {
                    const cre = db.creatives.find((x) => x.id === p.creativeId);
                    const estadoPendiente = estadosPendientes[p.id];
                    return (
                      <Card key={p.id} className="momo-cal-card p-2.5">
                        <div className="flex justify-between items-start gap-1">
                          <span className="text-xs font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{p.hora}</span>
                          <Badge label={p.canal} map={MK_CANAL_STYLE} />
                        </div>
                        <div className="text-xs font-semibold mt-1 leading-tight">{p.titulo}</div>
                        {cre && <div className="text-[10px] mt-0.5" style={{ color: T.choco2 }}>🎨 {cre.titulo}</div>}
                        <div className="mt-2 rounded-lg px-2 py-1.5 text-[10px] font-bold" style={{ background: p.preflight.ready ? "#E8F1E4" : "#F6D4CD", color: p.preflight.ready ? "#3F6B42" : "#A03B2A" }}>{p.preflight.ready ? "✓ Preflight completo" : `⛔ ${p.preflight.errors[0]?.message}`}</div>
                        <select value={estadoPendiente ?? p.estado} disabled={Boolean(estadoPendiente)} onChange={(e) => cambiarEstado(p, e.target.value)} className="mt-2 w-full rounded-lg px-1.5 py-1 text-[11px] border font-bold disabled:opacity-60" style={inputStyle}>
                          {(db.distributionServerReady ? CAL_ESTADOS.filter((state) => state !== "Publicado") : CAL_ESTADOS).map((s) => <option key={s}>{s}</option>)}
                        </select>
                        {estadoPendiente && (
                          <div className="flex items-center justify-center gap-1.5 mt-1.5 text-[10px] font-bold" style={{ color: "#96690F" }} role="status">
                            <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />
                            Guardando → {estadoPendiente}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                  {delDia.length === 0 && <div className="text-[11px] text-center py-3 font-semibold" style={{ color: T.choco2 }}>Sin publicaciones</div>}
                </div>
              </div>
            );
          })}
        </div> : vista === "Distribución" ? <div id="agency-distribution-room" className="scroll-mt-24">
          {!db.distributionServerReady && <InlineNotice icon="🛡️" title="Vista previa protegida">Aplicá la migración 19 para guardar checklist, aprobación humana y evidencia externa.</InlineNotice>}
          {db.distributionServerReady && !db.distributionConnectorReady && <InlineNotice icon="🔌" title="Distribución manual activa">La migración 29 habilita la cola protegida para Meta y borradores de TikTok; hasta entonces el registro manual sigue disponible.</InlineNotice>}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 mb-4">
            <Stat icon="⏱️" label="Deben salir" value={<CountUp value={distributionRoom.summary.due} />} tone={T.coral} />
            <Stat icon="✓" label="Aprobadas" value={<CountUp value={distributionRoom.summary.ready} />} tone="#3F6B42" />
            <Stat icon="👀" label="Por aprobar" value={<CountUp value={distributionRoom.summary.awaitingApproval} />} tone="#3E5C7E" />
            <Stat icon="⛔" label="Bloqueadas" value={<CountUp value={distributionRoom.summary.blocked} />} tone="#A03B2A" />
            <Stat icon="📊" label="Sin métricas" value={<CountUp value={distributionRoom.summary.needsMetrics} />} tone="#96690F" />
          </div>
          <div className="grid lg:grid-cols-2 gap-3">
            {distributionQueue.map((item) => <div key={item.post.id} className="rounded-[22px] border p-4" style={{ borderColor: item.blocked ? "#E8B7AD" : T.border, background: item.blocked ? "#FFF8F5" : "#fff", boxShadow: "0 8px 24px rgba(91,58,43,.06)" }}>
              <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: item.due ? T.coral : T.choco2 }}>{item.post.fecha} · {item.post.hora} · {item.post.canal}</div><div className="display font-semibold text-lg mt-1">{item.post.titulo}</div><div className="mt-1 inline-flex rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: item.contentMode === "Pauta" ? "#FFF1D8" : "#E8F1E4", color: item.contentMode === "Pauta" ? "#7B5410" : "#3F6B42" }}>{item.contentMode === "Pauta" ? "📣 PAUTA · CONVERSIÓN" : "🌱 ORGÁNICO · COMUNIDAD"}</div></div><Badge label={item.run?.status || item.post.estado} /></div>
              <div className="mt-3 rounded-2xl p-3" style={{ background: T.soft }}>
                <div className="flex justify-between gap-2 text-xs font-bold"><span>Checklist operativo</span><span style={{ color: item.readiness.checklistComplete ? "#3F6B42" : T.coral }}>{item.readiness.checked}/{item.readiness.total}</span></div>
                <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: "#E9DCCB" }}><div className="h-full rounded-full" style={{ width: `${item.readiness.total ? (item.readiness.checked / item.readiness.total) * 100 : 0}%`, background: item.readiness.checklistComplete ? "#5F8A61" : T.coral }} /></div>
              </div>
              <div className="mt-3 text-sm font-extrabold" style={{ color: item.blocked ? "#A03B2A" : T.choco }}>→ {item.action}</div>
              {item.readiness.errors[0] && <div className="text-[11px] mt-1" style={{ color: "#A03B2A" }}>{item.readiness.errors[0]}</div>}
              {item.run?.failureReason && <div className="text-xs mt-2 rounded-xl px-3 py-2" style={{ background: "#F6D4CD", color: "#8D3427" }}>Último fallo: {item.run.failureReason}</div>}
              {item.dispatch?.presentation && <div className="mt-3 rounded-2xl px-3 py-2.5" style={{ background: item.dispatch.job.status === "Incierto" ? "#FFF1ED" : item.dispatch.job.status === "Publicado" ? "#E8F1E4" : "#E9F0F7", color: item.dispatch.job.status === "Incierto" ? "#A03B2A" : item.dispatch.job.status === "Publicado" ? "#3F6B42" : "#3E5C7E" }}><div className="text-xs font-extrabold">{item.dispatch.presentation.label}</div><div className="text-[10px] mt-0.5">{item.dispatch.presentation.help} · intento {item.dispatch.job.attempt}</div></div>}
              <div className="flex flex-wrap gap-2 mt-4">
                {["Preparar salida","Completar checklist","Marcar lista"].includes(item.action) && <Btn small onClick={() => abrirPreparacion(item)} disabled={!item.readiness.readyToPrepare || !db.distributionServerReady}>Abrir checklist</Btn>}
                {item.action === "Aprobar salida" && <BtnAsync small onClick={() => aprobarSalidaComercial(item)} disabled={!db.distributionServerReady} textoEnVuelo="Aprobando…">Aprobar salida</BtnAsync>}
                {["Autorizar envío por Meta","Autorizar borrador TikTok"].includes(item.action) && <BtnAsync small onClick={() => autorizarSalidaConector(item)} textoEnVuelo="Autorizando…">{item.action}</BtnAsync>}
                {item.action === "Publicar y registrar evidencia" && <Btn small onClick={() => abrirCierre(item, "publish")} disabled={!db.distributionServerReady}>Registrar publicación manual</Btn>}
                {item.dispatch?.job?.status === "Fallido" && <BtnAsync small onClick={() => reintentarSalidaConector(item)} textoEnVuelo="Autorizando…">Reintentar conector</BtnAsync>}
                {item.dispatch?.job?.status === "Fallido" && <Btn small kind="ghost" onClick={() => abrirCierre(item, "publish")}>Registrar manualmente</Btn>}
                {item.dispatch?.job?.status === "Borrador listo" && <Btn small onClick={() => abrirCierre(item, "publish")}>Registrar publicación final</Btn>}
                {item.action === "Esperar horario" && <span className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: "#E9F0F7", color: "#3E5C7E" }}>Programada · todavía no ejecutar</span>}
                {item.action === "Revisar fallo" && <span className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>Volvé a Pendiente y reprogramá para reintentar</span>}
                {!item.dispatch?.job && item.run && !["Publicada","Cancelada","Fallida"].includes(item.run.status) && <Btn small kind="ghost" onClick={() => abrirCierre(item, "fail")} disabled={!db.distributionServerReady}>Registrar fallo</Btn>}
              </div>
              {!item.dispatch?.job && item.run?.status === "Aprobada" && item.dispatch?.eligibility?.provider && !item.dispatch.eligibility.allowed && <div className="text-[10px] mt-2" style={{ color: T.choco2 }}>Conector no disponible: {item.dispatch.eligibility.reasons[0]} Podés registrar la publicación manualmente.</div>}
            </div>)}
            {distributionQueue.length === 0 && <Empty icon="🚀" text="No hay publicaciones pendientes de distribución." />}
          </div>
          {distributionRoom.needsMetrics.length > 0 && <div className="rounded-2xl px-4 py-3 mt-4" style={{ background: "#FFF5E4", color: "#7B5410" }}><b>{distributionRoom.needsMetrics.length} publicación(es)</b> ya salieron y esperan captura de métricas en Resultados.</div>}
        </div> : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {pubs.map((p) => {
            const cre = db.creatives.find((creativeItem) => creativeItem.id === p.creativeId);
            return <div key={p.id} className="rounded-2xl border p-4" style={{ borderColor: T.border, background: "#fff" }}>
              <div className="flex items-start justify-between gap-2"><div><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{p.fecha} · {p.hora} · {p.canal}</div><div className="font-bold text-sm mt-1">{p.titulo}</div></div><Badge label={p.estado} /></div>
              {cre && <div className="text-xs mt-2" style={{ color: T.choco2 }}>🎨 {cre.titulo}</div>}
              {p.copyFinal && <div className="text-xs mt-2 line-clamp-2">{p.copyFinal}</div>}
              <div className="text-[10px] font-semibold mt-3" style={{ color: p.urlPublicacion || p.externalPostId ? "#3F6B42" : "#96690F" }}>{p.urlPublicacion || p.externalPostId ? "✓ Evidencia externa registrada" : "Sin enlace externo registrado"}</div>
            </div>;
          })}
          {pubs.length === 0 && <Empty icon="🗓️" text="Todavía no hay publicaciones cerradas en el historial." />}
        </div>}

        {nueva && (
          <Modal title="Nueva publicación" onClose={() => setNueva(false)} wide>
            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Título"><Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ej: Reel gatitos lunes" /></Field>
              <Field label="Canal"><Select options={MK_CANALES} value={form.canal} onChange={(e) => setForm({ ...form, canal: e.target.value })} /></Field>
              <Field label="Fecha"><Input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></Field>
              <Field label="Hora"><Input value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} placeholder="HH:MM" /></Field>
              <Field label="Campaña">
                <select value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value, creativeId: "" })} className={inputCls} style={inputStyle}>
                  <option value="">Sin campaña</option>
                  {db.campaigns.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </Field>
              <Field label="Creativo">
                <select value={form.creativeId} onChange={(e) => {
                  const id = e.target.value;
                  const cr = db.creatives.find((x) => x.id === id);
                  const draft = cr ? buildPostDraftFromCreative(cr, db, hoyISO()) : null;
                  setForm(draft ? { ...form, ...draft } : { ...form, creativeId: "" });
                }} className={inputCls} style={inputStyle}>
                  <option value="">Sin creativo</option>
                  {db.creatives.filter((c) => !form.campaignId || c.campaignId === form.campaignId).map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
                </select>
              </Field>
              <Field label="Guardar como"><Select options={["Pendiente","Programado"]} value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} /></Field>
            </div>
            {form.creativeId && <div className="rounded-2xl px-4 py-3 mb-3 text-xs font-bold" style={{ background: formScheduleGuard?.allowed ? "#E8F1E4" : "#F6D4CD", color: formScheduleGuard?.allowed ? "#3F6B42" : "#A03B2A" }}>{formScheduleGuard?.allowed ? "✓ Creativo, copy, campaña, canal y disponibilidad listos para programar." : `⛔ ${formScheduleGuard?.reasons[0] || "Falta completar el preflight."}`}</div>}
            <Field label="Copy final">
              <textarea rows={2} value={form.copyFinal} onChange={(e) => setForm({ ...form, copyFinal: e.target.value })} className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-y" style={{ ...inputStyle, fontFamily: "inherit" }} />
            </Field>
            <Field label="Notas"><Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Field>
            <div className="flex gap-2 mt-2"><BtnAsync onClick={guardar} textoEnVuelo="Creando…">Crear publicación</BtnAsync><Btn kind="ghost" onClick={() => setNueva(false)}>Cancelar</Btn></div>
          </Modal>
        )}

        {distributionDraft && distributionDraft.mode === "prepare" && (
          <Modal title={`Preparar salida · ${distributionDraft.item.post.id}`} onClose={() => setDistributionDraft(null)} wide>
            <div className="rounded-2xl p-4 mb-4" style={{ background: "linear-gradient(135deg,#FFF4EE,#F7E8D5)", border: `1px solid ${T.border}` }}>
              <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>{distributionDraft.item.post.canal} · {distributionDraft.item.post.fecha} {distributionDraft.item.post.hora}</div>
              <div className="display text-xl font-semibold mt-1">{distributionDraft.item.post.titulo}</div>
              <div className="text-xs mt-1" style={{ color: T.choco2 }}>Este checklist no publica nada: deja la salida lista para una aprobación humana separada.</div>
            </div>
            <div className="space-y-2 mb-4">
              {distributionChecklistFor(distributionDraft.item.post, db).map((step) => <label key={step.key} className="flex items-start gap-3 rounded-2xl border px-4 py-3 cursor-pointer" style={{ borderColor: distributionDraft.checklist[step.key] ? "#A8C7A4" : T.border, background: distributionDraft.checklist[step.key] ? "#EFF6EC" : "#fff" }}>
                <input type="checkbox" checked={distributionDraft.checklist[step.key] === true} onChange={(event) => setDistributionDraft({ ...distributionDraft, checklist: { ...distributionDraft.checklist, [step.key]: event.target.checked } })} className="mt-0.5 w-4 h-4" />
                <span className="text-sm font-bold">{step.label}</span>
              </label>)}
            </div>
            <Field label="Notas de preparación"><Input value={distributionDraft.notes} onChange={(event) => setDistributionDraft({ ...distributionDraft, notes: event.target.value })} placeholder="Decisiones, cambios o detalles para quien aprueba" /></Field>
            <div className="flex gap-2 mt-3"><BtnAsync onClick={guardarPreparacionComercial} textoEnVuelo="Guardando…">Guardar preparación</BtnAsync><Btn kind="ghost" onClick={() => setDistributionDraft(null)}>Cancelar</Btn></div>
          </Modal>
        )}

        {distributionDraft && ["publish","fail"].includes(distributionDraft.mode) && (
          <Modal title={distributionDraft.mode === "publish" ? `Registrar publicación · ${distributionDraft.item.post.id}` : `Registrar fallo · ${distributionDraft.item.post.id}`} onClose={() => setDistributionDraft(null)} wide>
            {distributionDraft.mode === "publish" ? <>
              <div className="rounded-2xl px-4 py-3 mb-4 text-sm font-bold" style={{ background: "#E8F1E4", color: "#3F6B42" }}>✓ Salida aprobada. Confirmá la evidencia después de publicarla en {distributionDraft.item.post.canal}.</div>
              <Field label="URL pública"><Input value={distributionDraft.externalUrl} onChange={(event) => setDistributionDraft({ ...distributionDraft, externalUrl: event.target.value })} placeholder="https://instagram.com/p/..." /></Field>
              <Field label="ID externo (si la plataforma lo muestra)"><Input value={distributionDraft.externalPostId} onChange={(event) => setDistributionDraft({ ...distributionDraft, externalPostId: event.target.value })} placeholder="Ej: IG-123456" /></Field>
              <Field label="Nota de ejecución"><Input value={distributionDraft.notes} onChange={(event) => setDistributionDraft({ ...distributionDraft, notes: event.target.value })} placeholder="Publicada sin cambios / ajuste realizado" /></Field>
            </> : <>
              <div className="rounded-2xl px-4 py-3 mb-4 text-sm" style={{ background: "#FFF1ED", color: "#A03B2A" }}><b>La publicación quedará “No publicada”.</b> El motivo se conserva para corregir y reprogramar sin ocultar el fallo.</div>
              <Field label="Motivo obligatorio"><textarea rows={3} value={distributionDraft.reason} onChange={(event) => setDistributionDraft({ ...distributionDraft, reason: event.target.value })} className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-y" style={{ ...inputStyle, fontFamily: "inherit" }} placeholder="Ej: la plataforma rechazó el formato del archivo" /></Field>
            </>}
            <div className="flex gap-2 mt-3"><BtnAsync onClick={cerrarSalidaComercial} textoEnVuelo="Registrando…">{distributionDraft.mode === "publish" ? "Confirmar publicación" : "Guardar fallo"}</BtnAsync><Btn kind="ghost" onClick={() => setDistributionDraft(null)}>Cancelar</Btn></div>
          </Modal>
        )}
      </div>
    );
  }

  /* ================= RESULTADOS CREATIVOS 📊 ================= */

  function ResultadosCreativos({ db, refrescar }) {
    const [nuevo, setNuevo] = useState(false);
    const vacio = { creativeId: "", fecha: hoyISO(), impresiones: 0, alcance: 0, clicks: 0, mensajesWhatsApp: 0, gasto: 0, notas: "" };
    const [form, setForm] = useState(vacio);
    const existente = db.creative_results.find((r) => r.fuente === "manual" && r.creativeId === form.creativeId && r.fecha === form.fecha);
    const resultados = resultadosDePlataforma(db);
    const numeroPreview = (valor) => {
      if (String(valor).trim() === "") return null;
      const numero = Number(valor);
      return Number.isFinite(numero) && numero >= 0 ? numero : null;
    };
    const previewImpresiones = numeroPreview(form.impresiones);
    const previewClicks = numeroPreview(form.clicks);
    const previewMensajes = numeroPreview(form.mensajesWhatsApp);
    const previewGasto = numeroPreview(form.gasto);
    const previewCtr = previewImpresiones > 0 && previewClicks !== null ? previewClicks / previewImpresiones : null;
    const previewCostoMsg = previewMensajes > 0 && previewGasto !== null ? previewGasto / previewMensajes : null;

    function cargarDia(creativeId, fecha) {
      const r = db.creative_results.find((x) => x.fuente === "manual" && x.creativeId === creativeId && x.fecha === fecha);
      setForm(r ? {
        creativeId, fecha, impresiones: r.impresiones, alcance: r.alcance, clicks: r.clicks,
        mensajesWhatsApp: r.mensajesWhatsApp, gasto: r.gasto, notas: r.notas || "",
      } : { ...vacio, creativeId, fecha });
    }

    const metric = (r) => {
      const atrib = atribucionDeResultado(db, r);
      return {
        ...atrib,
        ctr: r.impresiones > 0 ? r.clicks / r.impresiones : null,
        costoMsg: r.mensajesWhatsApp > 0 ? r.gasto / r.mensajesWhatsApp : null,
        cac: atrib.contabilizar && atrib.pedidos > 0 ? r.gasto / atrib.pedidos : null,
        roas: atrib.contabilizar && r.gasto > 0 ? atrib.ventas / r.gasto : null,
        conv: atrib.contabilizar && r.mensajesWhatsApp > 0 ? atrib.pedidos / r.mensajesWhatsApp : null,
      };
    };

    function exportar() {
      downloadCSV("resultados-creativos",
        ["Id","Creativo","Campaña","Fecha","Impresiones","Alcance","Clicks","CTR","Mensajes WA","Costo/msg","Pedidos","CAC","Ventas","Gasto","ROAS","Conv WA→pedido"],
        resultados.map((r) => { const cre = db.creatives.find((x) => x.id === r.creativeId); const camp = db.campaigns.find((x) => x.id === r.campaignId); const m = metric(r); return [r.id, cre ? cre.titulo : "", camp ? camp.nombre : "", r.fecha, r.impresiones, r.alcance, r.clicks, m.ctr ? (m.ctr * 100).toFixed(2) + "%" : "", r.mensajesWhatsApp, m.costoMsg ? Math.round(m.costoMsg) : "", m.contabilizar ? m.pedidos : "", m.cac ? Math.round(m.cac) : "", m.contabilizar ? m.ventas : "", r.gasto, m.roas ? m.roas.toFixed(2) : "", m.conv ? (m.conv * 100).toFixed(1) + "%" : ""]; }));
    }

    async function guardar() {
      if (!form.creativeId) { toast("error", "Elegí un creativo"); return; }
      const campos = ["impresiones", "alcance", "clicks", "mensajesWhatsApp", "gasto"];
      if (campos.some((k) => String(form[k]).trim() === "")) {
        toast("error", "Completá todas las métricas; un campo vacío no se guarda como cero"); return;
      }
      if (campos.some((k) => !Number.isFinite(Number(form[k])) || Number(form[k]) < 0)) {
        toast("error", "Las métricas deben ser números iguales o mayores a cero"); return;
      }
      // Impresiones/alcance/clicks/mensajes son integer en la RPC: un decimal la haría
      // rechazar ('10.5'::integer). Se ataja acá con el mismo mensaje que devuelve el server.
      if (["impresiones", "alcance", "clicks", "mensajesWhatsApp"].some((k) => !Number.isInteger(Number(form[k])))) {
        toast("error", "Impresiones, alcance, clicks y mensajes deben ser números enteros"); return;
      }
      let res;
      try {
        res = await registrarMetricasCreativo({
          creative_id: form.creativeId, fecha: form.fecha,
          impresiones: Number(form.impresiones), alcance: Number(form.alcance), clicks: Number(form.clicks),
          mensajes_wa: Number(form.mensajesWhatsApp), gasto: Number(form.gasto), notas: form.notas,
        });
      } catch (e) { toast("error", e.message); return; }
      setNuevo(false); setForm(vacio);
      toast("ok", res.actualizado ? "Métricas del día actualizadas" : "Métricas registradas");
      try { await refrescar(); } catch { toast("error", "Métricas guardadas; recargá para verlas"); }
    }

    return (
      <div>
        <div className="flex flex-wrap gap-2 mb-4">
          <Btn onClick={() => { setForm(vacio); setNuevo(true); }}>＋ Registrar métricas</Btn>
          <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
        </div>

        <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: "#DCE7F2", color: "#3E5C7E" }}>
          Pedidos y ventas se calculan desde los pedidos atribuidos del servidor. Acá solo registrás métricas de la plataforma.
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          {resultados.map((r) => {
            const cre = db.creatives.find((x) => x.id === r.creativeId);
            const camp = db.campaigns.find((x) => x.id === r.campaignId);
            const m = metric(r);
            return (
              <Card key={r.id} className="p-4">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate">{cre ? cre.titulo : (r.creativeId ? "Creativo eliminado" : "Métricas de campaña")}</div>
                    <div className="text-[11px]" style={{ color: T.choco2 }}>{camp ? camp.nombre : "—"} · {r.fecha} · {r.fuente || "manual"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="display text-lg" style={{ color: m.roas >= 1 ? "#3F6B42" : "#A03B2A" }}>{m.roas !== null ? m.roas.toFixed(1) + "x" : "—"}</div>
                    <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>ROAS</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  {[["CTR", m.ctr !== null ? (m.ctr * 100).toFixed(1) + "%" : "—"], ["Costo/msg", m.costoMsg !== null ? fmt(m.costoMsg) : "—"], ["CAC", m.contabilizar && m.cac !== null ? fmt(m.cac) : "—"], ["Mensajes", r.mensajesWhatsApp], ["Pedidos", m.contabilizar ? m.pedidos : "—"], ["Conv WA", m.contabilizar && m.conv !== null ? (m.conv * 100).toFixed(0) + "%" : "—"]].map(([lab, v]) => (
                    <div key={lab} className="rounded-xl py-1.5" style={{ background: T.vainilla }}>
                      <div className="text-xs font-bold truncate px-0.5">{v}</div>
                      <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{lab}</div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-[11px] font-semibold mt-2" style={{ color: T.choco2 }}>
                  <span>👁️ {milCO(r.impresiones)} impres. · {milCO(r.alcance)} alcance</span>
                  <span>💵 {m.contabilizar ? fmt(m.ventas) : "atribución en otra fuente"} / gasto {fmt(r.gasto)}</span>
                </div>
                {r.notas && <div className="text-xs mt-1.5" style={{ color: T.choco2 }}>📝 {r.notas}</div>}
              </Card>
            );
          })}
          {resultados.length === 0 && <Empty icon="📊" text="Sin resultados registrados." />}
        </div>

        {nuevo && (
          <Modal title={existente ? "Actualizar métricas del día" : "Registrar métricas de creativo"} onClose={() => setNuevo(false)} wide>
            <Field label="Creativo">
              <select value={form.creativeId} onChange={(e) => cargarDia(e.target.value, form.fecha)} className={inputCls} style={inputStyle}>
                <option value="">Elegir creativo…</option>
                {db.creatives.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
              </select>
            </Field>
            {existente && (
              <div className="text-xs font-bold px-3 py-2 rounded-xl mb-3" style={{ background: "#DCE7F2", color: "#3E5C7E" }} role="status">
                Ya existe una captura manual para este creativo y día. Al guardar se actualiza; no se duplica.
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4">
              <Field label="Fecha"><Input type="date" value={form.fecha} onChange={(e) => cargarDia(form.creativeId, e.target.value)} /></Field>
              <Field label="Impresiones"><Input type="number" step="1" min="0" value={form.impresiones} onChange={(e) => setForm({ ...form, impresiones: e.target.value })} /></Field>
              <Field label="Alcance"><Input type="number" step="1" min="0" value={form.alcance} onChange={(e) => setForm({ ...form, alcance: e.target.value })} /></Field>
              <Field label="Clicks"><Input type="number" step="1" min="0" value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} /></Field>
              <Field label="Mensajes WhatsApp"><Input type="number" step="1" min="0" value={form.mensajesWhatsApp} onChange={(e) => setForm({ ...form, mensajesWhatsApp: e.target.value })} /></Field>
              <Field label="Gasto"><Input type="number" step="any" min="0" value={form.gasto} onChange={(e) => setForm({ ...form, gasto: e.target.value })} /></Field>
            </div>
            <div className="rounded-2xl p-3 mb-3" style={{ background: T.vainilla, border: `1px solid ${T.border}` }} aria-live="polite">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-bold">Vista previa de plataforma</span>
                <span className="text-[10px] font-semibold" style={{ color: T.choco2 }}>se actualiza al escribir</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["CTR", previewCtr !== null ? `${(previewCtr * 100).toFixed(1)}%` : "—"],
                  ["Costo/msg", previewCostoMsg !== null ? fmt(previewCostoMsg) : "—"],
                  ["Gasto", previewGasto !== null ? fmt(previewGasto) : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl px-1 py-2" style={{ background: T.surface }}>
                    <div className="text-sm font-bold truncate">{value}</div>
                    <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
            <Field label="Notas"><Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Field>
            <div className="flex gap-2 mt-2"><BtnAsync onClick={guardar}>{existente ? "Actualizar métricas" : "Guardar métricas"}</BtnAsync><Btn kind="ghost" onClick={() => setNuevo(false)}>Cancelar</Btn></div>
          </Modal>
        )}
      </div>
    );
  }

  const PANELS = Object.freeze({
    Dashboard,
    HistorialOperativo,
    Productos,
    Domicilios,
    Reclamos,
    Clientes,
    Beneficios,
    Reportes,
    Configuracion,
    Marketing,
    Creativos,
    Calendario,
    ResultadosCreativos,
  });

  return function BusinessPanels({ panel, ...props }) {
    const Panel = PANELS[panel];
    if (!Panel) throw new Error(`Panel diferido desconocido: ${panel}`);
    return <Panel {...props} />;
  };
}
