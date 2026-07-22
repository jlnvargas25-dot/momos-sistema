import { useEffect, useMemo, useRef, useState } from "react";
import { fetchEvidenceSignedUrl, fetchOrderDeltas } from "../../lib/read-model";
import {
  crearPedido, setOrderStatusRemoto, confirmarVerificacionEmpaque, subirEvidencia, crearReclamo,
  crearDomicilio, tomarEtapaPedido, liberarEtapaPedido, setProgresoLineaPedido, completarEtapaPedido,
  completarCocinaYEntregarEmpaque, createInventoryIdempotencyKey, isMissingRpcError,
  crearIncidentePedido, resolverIncidentePedido, ofrecerRelevoDespacho, aceptarRelevoDespacho,
} from "../../lib/rpc";
import {
  canCreateOrder, canManageDeliveryHandoff, deliveryBlocksNewRequest, orderEvidencePermission,
  orderIntakePrimaryAction, orderTransitionPermission,
} from "../../lib/order-workflow";
import { hasAnyRole, hasRole, rolesLabel } from "../../lib/user-roles";
import {
  buildPackingChecklistLines, buildPackingGuide, findPackingVerification, packingStationProgress,
  packingVerificationMatchesLines,
} from "../../lib/packing-workflow";
import { buildPackingQueue } from "../../lib/packing-queue";
import { buildSalesReceptionAssistant } from "../../lib/sales-reception-assistant";
import {
  activeStageAssignment, canOperateStage, dispatchHandoffFor, lineProgressFor, openOrderIncidents,
  operationalStageForOrder, STAGE_LINE_STATUSES,
} from "../../lib/operational-control";
import { buildOrderTraceability, traceabilityHealth } from "../../lib/order-traceability";
import { isActiveOrder, isPackingHistoryOrder, partitionByActivity } from "../../lib/operational-history";
import { evaluateComboVariantAvailability, evaluateExactVariantDemand } from "../../lib/variant-availability";
import {
  activeFigureCatalog, commercialFamilyLabel, isCommercialFamilyProduct,
  isKitchenFigureName, normalizeDomainText, orderAttributesForProduct, orderLinePresentation,
} from "../../lib/momos-domain-language";
import { groupOrderCatalogChoices, PRODUCT_CATEGORY_EMOJI } from "../../lib/product-categories.js";
import { canonicalVariantsForAvailability } from "../../lib/canonical-stock.js";
import {
  applyOrderComboFigureEdit, applyOrderFigureEdit, decorateOrderLineCompatibility,
  orderFiguresForFamily, orderLineFigureCompatibilityErrors, sanitizeOrderLineFigureFields,
  validateOrderComboSlotFigure, validateOrderFigureCatalogLink,
} from "./order-figure-compatibility.js";
import { createCompactQueueOrderCard } from "../operations/CompactQueueOrderCard.jsx";

const orderCatalogFigureKey = (productId, figureName) =>
  `figure:${String(productId || "").trim()}:${normalizeDomainText(figureName)}`;
const orderCatalogProductKey = (productId) => `product:${String(productId || "").trim()}`;

/**
 * El alta del pedido habla el idioma de Cocina: primero el postre fisico.
 * `products` conserva la presentacion comercial que fija precio y receta;
 * `figuras` declara que postre exacto recibira el cliente.
 */
export function buildOrderCatalogChoices(db = {}) {
  // Pedidos refleja el menú vendible, no todo el catálogo administrativo.
  // Un producto desactivado (o sin activación explícita) nunca se ofrece al recibir una orden.
  const activeProducts = (db.products || []).filter((product) => product?.activo === true);
  const productsById = new Map(activeProducts.map((product) => [String(product.id), product]));
  const invalidFigureLinks = [];
  const figures = activeFigureCatalog(db)
    .map((figure) => {
      const link = validateOrderFigureCatalogLink(figure);
      if (!link.valid) {
        invalidFigureLinks.push(link);
        return null;
      }
      const productId = link.expectedProductId;
      const product = productsById.get(productId);
      if (!product || !isCommercialFamilyProduct(product)) return null;
      return {
        key: orderCatalogFigureKey(productId, figure.nombre),
        kind: "figure",
        productId,
        figure: String(figure.nombre).trim(),
        product,
        category: "Momos Signature",
        primary: String(figure.nombre).trim(),
        secondary: `Familia comercial: ${commercialFamilyLabel(product)}`,
      };
    })
    .filter(Boolean);

  const seenFigures = new Set();
  const figureChoices = figures.filter((choice) => {
    const key = normalizeDomainText(choice.figure);
    if (seenFigures.has(key)) return false;
    seenFigures.add(key);
    return true;
  });
  const otherChoices = activeProducts
    .filter((product) => !isCommercialFamilyProduct(product))
    .map((product) => ({
      key: orderCatalogProductKey(product.id),
      kind: "product",
      productId: String(product.id),
      figure: "",
      product,
      category: String(product.cat || "Otros").trim() || "Otros",
      primary: product.nombre,
      secondary: product.tipo === "combo"
        ? "Caja o combo"
        : product.tipo === "pedido" ? "Elaboración al momento" : "Otro producto del menú",
    }));

  return { figureChoices, otherChoices, invalidFigureLinks, all: [...figureChoices, ...otherChoices] };
}

export function applyOrderCatalogChoice(item, choice) {
  if (!choice) {
    return { ...item, catalogKey: "", productId: "", figura: "", sabor: "", salsa: "", relleno: "", adiciones: [], boxes: [] };
  }
  const quantity = Math.max(1, Math.floor(Number(item?.cant) || 1));
  const product = choice.product;
  const boxes = product?.tipo === "combo"
    ? Array.from({ length: quantity }, () => Array.from({ length: product.comboSize || 0 }, () => ({ figura: "", sabor: "", salsa: "", adiciones: [] })))
    : [];
  return {
    ...item,
    catalogKey: choice.key,
    productId: choice.productId,
    figura: choice.kind === "figure" ? choice.figure : "",
    sabor: "",
    salsa: "",
    relleno: "",
    adiciones: [],
    boxes,
  };
}

export function orderProductAttributes(product) {
  return orderAttributesForProduct(product);
}

export function orderLinePresentationForOrders(item, product) {
  return decorateOrderLineCompatibility(orderLinePresentation(item, product), item, product);
}

export function createOrdersPanel(shared) {
  const {
    T, hoyISO, fmt, copiarTexto, toast, Badge, Btn, BtnAsync, Card, Empty, Field, Input, MiniSelect,
    Modal, SectionTitle, Select, Stat, WorkScopeTabs, CANALES, CANAL_STYLE,
    EV_TIPOS, ORDER_STATES, ORIGEN_SIMPLE, availability, boxesAdicionesTotal, comboFaltantesFamilia,
    compressImage, customerOf, downloadCSV, evidencesOf, figurasDeCombo, inputCls, inputStyle, itemsOf,
    lineAdiciones, lineAdicionesTotal, orderSubtotal, orderTotal, productOf, reqFotosPaso, sugerirZona,
    tieneEvidencia, tieneSelloEmpaque,
  } = shared;
  const CompactQueueOrderCard = createCompactQueueOrderCard({ T, Badge, Card, customerOf });

  async function sincronizarPedidoDirigido(orderId, context) {
    const { db, refrescar, aplicarDeltaPedido, capturarGeneracionPedidos, solicitarConciliacionPedidos } = context;
    if (db?.orderDeltaReady !== true || typeof aplicarDeltaPedido !== "function" || typeof capturarGeneracionPedidos !== "function") {
      await refrescar();
      return { status: "snapshot" };
    }
    const generation = capturarGeneracionPedidos();
    try {
      const envelope = await fetchOrderDeltas([orderId]);
      const result = await aplicarDeltaPedido(envelope, generation);
      if (result?.status === "discarded") {
        await solicitarConciliacionPedidos?.();
        return { status: "reconciled" };
      }
      return result;
    } catch (error) {
      // La escritura ya quedó confirmada: nunca se repite. Una lectura
      // dirigida incompatible degrada a una conciliación completa y segura.
      await refrescar({ reason: "order-delta-fallback" });
      return { status: "snapshot", cause: error };
    }
  }

function Empaque({ db, update, user, refrescar, perfil, aplicarDeltaPedido, capturarGeneracionPedidos, solicitarConciliacionPedidos }) {
  const [selId, setSelId] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [scope, setScope] = useState("active");
  const verifications = db.packing_verifications || [];
  const packingQueue = buildPackingQueue(db.orders, db.order_dispatch_handoffs);
  const { incoming, pending, packed, handoff: handoffQueue, activeIds: activePackingIds } = packingQueue;
  const history = db.orders
    .filter((order) => isPackingHistoryOrder(order, db) && !activePackingIds.has(order.id))
    .sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`));
  const verifiedPending = pending.filter((order) => findPackingVerification(order.id, verifications)).length;
  const selected = selId ? db.orders.find((order) => order.id === selId) : null;
  const sincronizarPedido = (orderId) => sincronizarPedidoDirigido(orderId, {
    db, refrescar, aplicarDeltaPedido, capturarGeneracionPedidos, solicitarConciliacionPedidos,
  });

  async function cambiar(orderId, estado, opts) {
    const actual = db.orders.find((order) => order.id === orderId);
    const permiso = orderTransitionPermission(perfil, actual?.estado, estado, { quickSale: !!(opts && opts.ventaRapida) });
    if (!permiso.allowed) {
      setAviso({ titulo: "Este paso pertenece a otra área", texto: permiso.reason });
      return false;
    }
    try {
      await setOrderStatusRemoto(orderId, estado, !!(opts && opts.ventaRapida));
      await sincronizarPedido(orderId);
      toast("ok", `${orderId} → ${estado}`);
      if (estado !== "Empacado") setSelId(null);
      return true;
    } catch (error) {
      toast("error", error.message);
      return false;
    }
  }

  function OrderPackingCard({ order, index }) {
    const progress = packingStationProgress({
      orderId: order.id,
      orderItems: db.order_items,
      evidences: db.evidences,
      verifications,
    });
    const handoff = dispatchHandoffFor(order.id, db.order_dispatch_handoffs);
    const guide = ["Listo para empaque", "Empacado", "Listo para despacho"].includes(order.estado)
      ? buildPackingGuide({ orderStatus: order.estado, progress, handoff }) : null;
    const incomingOrder = order.estado === "En producción";
    const tone = incomingOrder ? "#3E5C7E" : order.estado === "Empacado" ? "#63518A" : order.estado === "Listo para despacho" ? "#2F6B60" : T.coral;
    const eyebrow = incomingOrder ? "En camino desde Cocina" : order.estado === "Listo para empaque" ? (index === 0 ? "Siguiente · FIFO" : `En cola · #${index + 1}`) : order.estado === "Empacado" ? "Empacado · preparar despacho" : "Relevo a Logística";
    const nextAction = incomingOrder ? "Cocina debe terminar y entregar la comanda" : guide?.nextAction || "Abrir y revisar el pedido";
    const footer = incomingOrder ? "Visible para anticipar caja y espacio; todavía no es accionable." : order.estado === "Listo para empaque" ? `${progress.completedSteps}/3 controles de Empaque completos.` : handoff?.status === "Ofrecido" ? "Paquete ofrecido; espera aceptación de Logística." : "Abrí para ver dirección, etiqueta y relevo.";
    return <CompactQueueOrderCard db={db} orderId={order.id} eyebrow={eyebrow} position={order.estado === "Listo para empaque" ? index + 1 : undefined}
      tone={tone} nextAction={nextAction} footer={footer} onOpen={() => setSelId(order.id)} />;
  }

  return (
    <div>
      <SectionTitle>Verificá la comanda antes de sellar</SectionTitle>
      <div className="text-xs font-semibold mb-3 -mt-3" style={{ color: T.choco2 }}>
        Compará primero cada postre —figura, sabor y cantidad— y después su presentación comercial, salsa y relleno. La verificación queda registrada con usuario y hora.
      </div>

      <div className="mb-4"><WorkScopeTabs value={scope} onChange={setScope} activeCount={incoming.length + pending.length + packed.length + handoffQueue.length} historyCount={history.length} activeLabel="Cola de Empaque" /></div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
        <Stat icon="👩‍🍳" label="En Cocina" value={incoming.length} sub="pedidos que vienen en camino" tone="#3E5C7E" />
        <Stat icon="📦" label="Por empacar" value={pending.length} sub="comandas que Cocina entregó" tone={T.coral} />
        <Stat icon="🎁" label="Empacados" value={packed.length} sub="preparan dirección y etiqueta" tone="#63518A" />
        <Stat icon="🤝" label="En relevo" value={handoffQueue.length} sub="esperan a Logística" tone="#2F6B60" />
        <Stat icon="◷" label="Historial" value={history.length} sub="pedidos que ya salieron del área" tone="#3F6B42" onClick={() => setScope("history")} active={scope === "history"} />
      </div>

      {scope === "active" ? <>
      <div className="text-[11px] font-semibold mb-4 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: T.choco2 }}>
        <span>En Cocina <b style={{ color: "#3E5C7E" }}>{incoming.length}</b></span>
        <span aria-hidden="true">→</span>
        <span>Cocina entregó <b style={{ color: "#3F6B42" }}>{pending.length}</b></span>
        <span aria-hidden="true">→</span>
        <span><b style={{ color: T.coral }}>{verifiedPending}</b> comparada{verifiedPending === 1 ? "" : "s"} con la orden</span>
        <span aria-hidden="true">→</span>
        <span><b style={{ color: "#63518A" }}>{packed.length}</b> empacada{packed.length === 1 ? "" : "s"}</span>
        <span aria-hidden="true">→</span>
        <span><b style={{ color: "#2F6B60" }}>{handoffQueue.length}</b> en relevo</span>
      </div>

      <SectionTitle>📋 Cola activa para verificar y empacar</SectionTitle>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
        {pending.map((order, index) => <OrderPackingCard key={order.id} order={order} index={index} />)}
        {packed.map((order, index) => <OrderPackingCard key={order.id} order={order} index={index} />)}
        {handoffQueue.map((order, index) => <OrderPackingCard key={order.id} order={order} index={index} />)}
        {!pending.length && !packed.length && !handoffQueue.length && <Card className="p-8 text-center sm:col-span-2 xl:col-span-3"><div className="text-3xl mb-2">✅</div><div className="font-bold">No hay comandas accionables en Empaque</div><div className="text-xs mt-1" style={{ color: T.choco2 }}>Cuando Cocina marque “Listo para empaque”, aparecerán aquí automáticamente.</div></Card>}
      </div>

      {incoming.length > 0 && <>
        <SectionTitle>👩‍🍳 En camino desde Producción</SectionTitle>
        <div className="text-xs font-semibold mb-3 -mt-2" style={{ color: T.choco2 }}>Sirve para anticipar espacio, cajas y carga. Empaque podrá actuar cuando Cocina confirme el relevo.</div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{incoming.map((order, index) => <OrderPackingCard key={order.id} order={order} index={index} />)}</div>
      </>}
      </> : <>
        <SectionTitle>◷ Historial de Empaque</SectionTitle>
        <div className="text-xs font-semibold mb-3 -mt-2" style={{ color: T.choco2 }}>Pedidos que ya fueron relevados a Logística o terminaron su recorrido. El historial es de consulta y no altera la operación.</div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {history.map((order) => {
            const verification = findPackingVerification(order.id, verifications);
            const evidenceCount = evidencesOf(db, order.id).filter((evidence) => evidence.tipo !== "Comprobante de pago").length;
            return <CompactQueueOrderCard key={order.id} db={db} orderId={order.id} eyebrow="Historial de Empaque" tone="#3F6B42"
              nextAction="Consultar detalle y trazabilidad del pedido" footer={`${verification ? "Comanda verificada" : "Sin verificación"} · ${evidenceCount} evidencia${evidenceCount === 1 ? "" : "s"}`}
              onOpen={() => setSelId(order.id)} />;
          })}
          {!history.length && <Empty icon="◷" text="Todavía no hay pedidos en el historial de Empaque." />}
        </div>
      </>}

      {selected && <DetallePedido db={db} o={selected} update={update} user={user} onClose={() => setSelId(null)} cambiar={cambiar} setAviso={setAviso} sincronizarPedido={sincronizarPedido} perfil={perfil} />}
      {aviso && <Modal title={aviso.titulo} onClose={() => setAviso(null)}><p className="text-sm m-0">{aviso.texto}</p><div className="mt-4"><Btn onClick={() => setAviso(null)}>Entendido</Btn></div></Modal>}
    </div>
  );
}

const TRACE_HEALTH_STYLE = {
  blocked: { bg: "#F6D4CD", color: "#A03B2A", label: "Bloqueado" },
  attention: { bg: "#FBE8C8", color: "#96690F", label: "Requiere atención" },
  complete: { bg: "#DDEBD9", color: "#3F6B42", label: "Finalizado" },
  active: { bg: "#FBE3DA", color: "#E5714E", label: "En curso" },
};
const TRACE_EVENT_ICON = { created: "🧾", audit: "↻", evidence: "📷", assignment: "👤", incident: "⚠", packing: "🎁", delivery: "🛵", handoff: "🤝", claim: "💬", inventory: "📦" };

// Detalle completo de un pedido: se renderiza inline dentro de la fila expandida del acordeón.
// Read-only — reusa el shape de buildOrderTraceability tal cual. labelledBy apunta al botón cabecera.
function DetalleTrazabilidad({ trace, db, onOpen, labelledBy }) {
  const order = trace.order;
  const customer = customerOf(db, order.customerId);
  const health = TRACE_HEALTH_STYLE[traceabilityHealth(trace)] || TRACE_HEALTH_STYLE.active;
  return (
    <div role="region" aria-labelledby={labelledBy} className="momo-trace-open space-y-4 min-w-0 pt-3">
      <Card className="p-4 sm:p-5" style={{ borderColor: health.color + "66" }}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="display text-2xl font-semibold m-0">{order.id}</h2><Badge label={order.estado} /><span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: health.bg, color: health.color }}>{health.label}</span></div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{order.fecha} · {order.hora} · {order.canal}</div></div>
          <Btn small onClick={() => onOpen(order.id)}>Abrir pedido completo</Btn>
        </div>
        <div className="mt-4 pl-3 border-l-2" style={{ borderColor: T.rosa }}>
          <div className="flex justify-between text-xs font-extrabold"><span>{trace.area}</span><span style={{ color: health.color }}>{trace.flow.percent}%</span></div>
          <div className="mt-3 relative" aria-label="Etapas del pedido">
            <div className="absolute left-[6px] right-[6px] top-[6px] h-[2px] rounded-full" style={{ background: "#EEDFCE" }} aria-hidden="true" />
            <div className="absolute left-[6px] top-[6px] h-[2px] rounded-full" style={{ width: `calc((100% - 12px) * ${Math.min(100, Math.max(0, trace.flow.percent)) / 100})`, background: health.color, transition: "width 620ms var(--momo-spring)" }} aria-hidden="true" />
            <div className="relative flex justify-between">
              {["Pago", "Cocina", "Empaque", "Despacho", "Entrega"].map((label, index) => <span key={label} className="w-3 h-3 rounded-full border-2" style={{ background: trace.flow.percent >= index * 25 ? health.color : T.surface, borderColor: trace.flow.percent >= index * 25 ? health.color : "#E4D5C4", transition: "background 400ms ease, border-color 400ms ease" }} aria-hidden="true" />)}
            </div>
            <div className="flex justify-between mt-1.5">
              {["Pago", "Cocina", "Empaque", "Despacho", "Entrega"].map((label, index) => <span key={label} className="text-[9px] font-extrabold" style={{ color: trace.flow.percent >= index * 25 ? health.color : T.choco2 }}>{label}</span>)}
            </div>
          </div>
        </div>
        <div className="mt-3 rounded-xl px-3 py-2 border" style={{ background: trace.openIncidents.length ? "#F6D4CD" : "#E3EFE0", borderColor: trace.openIncidents.length ? "#ECBBB1" : "#BFD8BE" }}><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: trace.openIncidents.length ? "#A03B2A" : "#3F6B42" }}>Siguiente acción</div><div className="text-sm font-bold">{trace.nextAction}</div></div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4"><div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.choco2 }}>Cliente y destino</div><div className="font-bold">{customer.nombre || "Sin nombre"}</div><div className="text-sm">{customer.telefono || "Sin teléfono"}</div><div className="text-sm mt-1">{order.direccion || customer.direccion || "Sin dirección"}</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{order.barrio || customer.barrio} · {order.zona}</div></Card>
        <Card className="p-4"><div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.choco2 }}>Pago y valor</div><div className="flex justify-between text-sm"><span>Total</span><b>{fmt(orderTotal(db, order))}</b></div><div className="flex justify-between text-sm mt-1"><span>Medio</span><b>{order.pago || "Pendiente"}</b></div><div className="flex justify-between text-sm mt-1"><span>Comprobante</span><b style={{ color: order.comprobante ? "#3F6B42" : "#A03B2A" }}>{order.comprobante ? "Recibido ✓" : "Pendiente"}</b></div></Card>
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3"><div><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Contenido y control físico</div><div className="display text-lg font-semibold">{trace.items.length} línea{trace.items.length === 1 ? "" : "s"} del pedido</div></div><span className="text-xs font-bold" style={{ color: trace.packing ? "#3F6B42" : T.choco2 }}>{trace.packing ? "Comanda verificada ✓" : "Sin verificación de Empaque"}</span></div>
        <div className="space-y-2">{trace.items.map((item) => {
          const lineProgress = trace.progress.filter((row) => row.orderItemId === item.id);
          const presentation = orderLinePresentationForOrders(item, productOf(db, item.productId));
          return <div key={item.id} className="rounded-xl px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2" style={{ background: T.soft }}><div className="flex-1"><b className="text-sm">{presentation.quantityLabel}</b><div className="text-[11px] font-semibold" style={{ color: T.choco2 }}>{presentation.secondary || "Línea sin variante física"}</div></div><div className="flex flex-wrap gap-1">{lineProgress.map((row) => <span key={row.stage} className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: row.status === "Incidente" ? "#F6D4CD" : row.status === "Listo" || row.status === "Verificado" ? "#DDEBD9" : T.vainilla }}>{row.stage}: {row.status}</span>)}</div></div>;
        })}</div>
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[["Responsable", trace.activeAssignments.map((row) => `${row.stage}: ${row.user || "asignado"}`).join(" · ") || "Sin etapa tomada"], ["Evidencias", `${trace.evidences.length} registradas`], ["Reservas FIFO", `${trace.reservations.length} movimientos`], ["Domicilio", trace.delivery ? `${trace.delivery.proveedor} · ${trace.delivery.estado}` : "Sin solicitud"]].map(([label, value]) => <Card key={label} className="p-3"><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{label}</div><div className="text-xs font-bold mt-1">{value}</div></Card>)}
      </div>

      <Card className="p-4 sm:p-5">
        <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Trazabilidad completa</div><div className="display text-xl font-semibold mb-4">Qué ha pasado con {order.id}</div>
        <div className="relative pl-7 space-y-4 before:absolute before:left-[10px] before:top-2 before:bottom-2 before:w-px before:bg-[#EEDFCE]">
          {trace.events.map((event) => <div key={event.id} className="relative"><span className="absolute -left-7 top-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px]" style={{ background: event.type === "incident" ? "#F6D4CD" : T.vainilla }}>{TRACE_EVENT_ICON[event.type] || "•"}</span><div className="flex flex-col sm:flex-row sm:items-start justify-between gap-1"><div><div className="text-sm font-bold">{event.title}</div>{event.detail && <div className="text-xs font-semibold mt-0.5" style={{ color: T.choco2 }}>{event.detail}</div>}<div className="text-[10px] font-bold mt-1" style={{ color: T.choco2 }}>{event.area}{event.actor ? ` · ${event.actor}` : ""}</div></div><time className="text-[10px] font-bold shrink-0" style={{ color: T.choco2 }}>{event.at || "Sin hora"}</time></div></div>)}
        </div>
      </Card>
    </div>
  );
}

// Buckets accionables de la cabecera: fuente única para conteo, filtro y etiqueta.
const PEDIDO_FOCOS = [
  { key: "seguimiento", icon: "🧾", label: "En seguimiento", sub: "pedidos no terminales", tone: T.coral, match: (t) => !["Entregado", "Cancelado"].includes(t.order.estado) },
  { key: "bloqueados", icon: "⚠️", label: "Bloqueados", sub: "novedades por resolver", tone: "#A03B2A", match: (t) => traceabilityHealth(t) === "blocked" },
  { key: "relevo", icon: "🤝", label: "En relevo", sub: "Empaque → Logística", tone: "#63518A", match: (t) => t.order.estado === "Listo para despacho" },
  { key: "ruta", icon: "🛵", label: "En ruta", sub: "esperan entrega", tone: "#3F6B42", match: (t) => t.order.estado === "En ruta" },
];

// Acordeón de pedidos: fila colapsada con lo esencial; click → despliega el detalle inline.
// Modo normal abre uno a la vez; "Comparar" permite varios abiertos en paralelo.
function PanelTrazabilidadPedidos({ db, orders, onOpen }) {
  const traces = useMemo(() => orders.map((order) => buildOrderTraceability(db, order)).filter(Boolean), [db, orders]);
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [comparar, setComparar] = useState(false);
  const [foco, setFoco] = useState(null);

  // Purga ids abiertos que ya no existen tras un cambio de filtros/pedidos.
  useEffect(() => {
    setAbiertos((prev) => {
      if (!prev.size) return prev;
      const validos = new Set(traces.map((trace) => trace.order.id));
      const next = new Set([...prev].filter((id) => validos.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [traces]);

  function toggle(id) {
    setAbiertos((prev) => {
      if (prev.has(id)) { const next = new Set(prev); next.delete(id); return next; }
      return comparar ? new Set(prev).add(id) : new Set([id]);
    });
  }

  const conteos = PEDIDO_FOCOS.map((f) => traces.filter(f.match).length);
  const focoActivo = PEDIDO_FOCOS.find((f) => f.key === foco) || null;
  const mostrados = focoActivo ? traces.filter(focoActivo.match) : traces;

  if (!traces.length) return <Card className="p-8 text-center"><div className="text-3xl mb-2">🔎</div><div className="font-bold">No hay pedidos que coincidan con la búsqueda</div></Card>;

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {PEDIDO_FOCOS.map((f, i) => (
          <Stat key={f.key} icon={f.icon} label={f.label} value={conteos[i]} sub={f.sub} tone={f.tone}
            active={foco === f.key}
            onClick={(conteos[i] > 0 || foco === f.key) ? () => setFoco((prev) => (prev === f.key ? null : f.key)) : undefined} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.choco2 }}>{focoActivo ? `${focoActivo.label} · ${mostrados.length} de ${traces.length}` : `Pedidos encontrados · ${traces.length}`}</div>
          {focoActivo && <button type="button" onClick={() => setFoco(null)} className="rounded-full px-2.5 py-0.5 text-[10px] font-extrabold border transition" style={{ borderColor: T.border, color: T.choco2, background: T.surface }}>✕ Quitar filtro</button>}
        </div>
        <button type="button" onClick={() => setComparar((v) => !v)} aria-pressed={comparar}
          className="rounded-full px-3 py-1.5 text-[11px] font-extrabold border transition"
          style={{ background: comparar ? T.coral : T.surface, color: comparar ? "#fff" : T.choco2, borderColor: comparar ? T.coral : T.border }}>
          {comparar ? "Comparar ✓" : "Comparar"}
        </button>
      </div>

      <div className="space-y-2">
        {mostrados.map((trace) => {
          const id = trace.order.id;
          const open = abiertos.has(id);
          const traceHealth = TRACE_HEALTH_STYLE[traceabilityHealth(trace)] || TRACE_HEALTH_STYLE.active;
          const traceCustomer = customerOf(db, trace.order.customerId);
          const headerId = `trace-head-${id}`;
          return (
            <Card key={id} data-open={open ? "true" : "false"} className="momo-trace-card p-0 overflow-hidden" style={{ borderColor: open ? "#E9A18C" : T.border }}>
              <button id={headerId} type="button" onClick={() => toggle(id)} aria-expanded={open}
                className="w-full text-left p-3 sm:p-4 flex items-start gap-3 transition"
                style={{ background: open ? T.coralSoft : T.surface }}>
                <span className="momo-trace-chevron shrink-0 mt-0.5 text-lg font-bold leading-none" data-open={open ? "true" : "false"} style={{ color: traceHealth.color }} aria-hidden="true">›</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2"><b className="text-sm">{id}</b><span className="rounded-full px-2 py-0.5 text-[9px] font-extrabold shrink-0" style={{ background: traceHealth.bg, color: traceHealth.color }}>{traceHealth.label}</span></div>
                  <div className="flex items-center justify-between gap-2 mt-1"><span className="text-xs font-bold truncate">{traceCustomer.nombre || "Cliente sin nombre"}</span><Badge label={trace.order.estado} /></div>
                  <div className="text-[10px] font-semibold mt-1 truncate" style={{ color: T.choco2 }}>{trace.area}</div>
                  <div className="text-[10px] font-bold mt-1 truncate" style={{ color: traceHealth.color }}>{trace.nextAction}</div>
                </div>
              </button>
              {open && <div className="px-3 sm:px-4 pb-4"><DetalleTrazabilidad trace={trace} db={db} onOpen={onOpen} labelledBy={headerId} /></div>}
            </Card>
          );
        })}
        {focoActivo && !mostrados.length && <Card className="p-6 text-center"><div className="text-2xl mb-1">🫙</div><div className="text-sm font-bold">No hay pedidos en «{focoActivo.label}» ahora mismo</div></Card>}
      </div>
    </div>
  );
}

function Pedidos({ db, update, user, focus, refrescar, perfil, aplicarDeltaPedido, capturarGeneracionPedidos, solicitarConciliacionPedidos }) {
  const [modo, setModo] = useState("kanban");
  const [asistenteVentasAbierto, setAsistenteVentasAbierto] = useState(false);
  const orderBuckets = useMemo(() => partitionByActivity(db.orders, isActiveOrder), [db.orders]);
  const [scope, setScope] = useState(() => (focus?.estado && !isActiveOrder({ estado: focus.estado }) ? "history" : "active"));
  const [selId, setSelId] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [verFiltros, setVerFiltros] = useState(!!(focus && (focus.estado || focus.desde || focus.pendientesPago)));
  const [pendPago, setPendPago] = useState(!!(focus && focus.pendientesPago));
  const [f, setF] = useState({ q: "", canal: "", estado: (focus && focus.estado) || "", barrio: "", producto: "", cliente: "", desde: (focus && focus.desde) || "", hasta: (focus && focus.hasta) || "" });
  const puedeCrearPedido = canCreateOrder(perfil);
  const sincronizarPedido = (orderId) => sincronizarPedidoDirigido(orderId, {
    db, refrescar, aplicarDeltaPedido, capturarGeneracionPedidos, solicitarConciliacionPedidos,
  });
  const salesAssistant = useMemo(() => buildSalesReceptionAssistant(db, { today: hoyISO() }), [
    db.orders, db.order_items, db.customers, db.evidences, db.benefits,
    db.products, db.variantes, db.variantesCuarentena, db.inventory_reservations,
    db.production_batches, db.figuras, db.settings?.figuras,
  ]);

  const barrios = [...new Set(db.orders.map((o) => o.barrio))];

  const scopeOrders = scope === "active" ? orderBuckets.active : orderBuckets.history;
  const filtrados = scopeOrders.filter((o) => {
    const c = customerOf(db, o.customerId);
    const items = itemsOf(db, o.id);
    const contenido = items.map((item) => {
      const presentation = orderLinePresentationForOrders(item, productOf(db, item.productId));
      return `${presentation.primary} ${presentation.familyName} ${item.sabor || ""} ${item.figura || ""}`;
    }).join(" ");
    const texto = (o.id + " " + (c.nombre || "") + " " + (c.telefono || "") + " " + contenido).toLowerCase();
    const cumplePendPago = !pendPago || (["Nuevo","Confirmado","Pendiente de pago"].includes(o.estado) && !o.pagadoEn);
    return cumplePendPago
      && (!f.q || texto.includes(f.q.toLowerCase()))
      && (!f.canal || o.canal === f.canal)
      && (!f.estado || o.estado === f.estado)
      && (!f.barrio || o.barrio === f.barrio)
      && (!f.cliente || o.customerId === f.cliente)
      && (!f.producto || items.some((i) => i.productId === f.producto))
      && (!f.desde || o.fecha >= f.desde)
      && (!f.hasta || o.fecha <= f.hasta);
  });
  const columnasVisibles = scope === "active"
    ? ORDER_STATES.filter((state) => isActiveOrder({ estado: state }))
    : ["Entregado", "Cancelado"];

  // Fase 3: la transición vive en el SERVER (set_order_status con todas las gates). Luego re-fetch.
  async function cambiar(orderId, estado, opts) {
    const actual = db.orders.find((order) => order.id === orderId);
    const permiso = orderTransitionPermission(perfil, actual?.estado, estado, { quickSale: !!(opts && opts.ventaRapida) });
    if (!permiso.allowed) {
      setAviso({ titulo: "Este paso pertenece a otra área", texto: permiso.reason });
      return false;
    }
    let res;
    try {
      if (estado === "Listo para empaque" && db.operationalControlReady) {
        try {
          const compound = await completarCocinaYEntregarEmpaque(orderId, createInventoryIdempotencyKey());
          res = compound?.status;
        } catch (error) {
          if (!isMissingRpcError(error)) throw error;
          await completarEtapaPedido(orderId, "Cocina");
          res = await setOrderStatusRemoto(orderId, estado, !!(opts && opts.ventaRapida));
        }
      } else {
        res = await setOrderStatusRemoto(orderId, estado, !!(opts && opts.ventaRapida));
      }
    } catch (e) {
      toast("error", e.message);
      return false;
    }
    const faltantes = (res && res.faltantes) || [];
    try {
      await sincronizarPedido(orderId);
    } catch (e) {
      setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: "El cambio se aplicó correctamente, pero no se pudo actualizar la vista. Recargá la página para ver el estado actual." + (faltantes.length ? " Ojo: había alertas de inventario, revisá Producción." : "") });
      return true;
    }
    toast("ok", estado === "Cancelado" ? `Pedido ${orderId} cancelado` : `${orderId} → ${estado}`);
    if (faltantes.length) {
      const prod = faltantes.filter((x) => x.area !== "Inventario");
      const ins = faltantes.filter((x) => x.area === "Inventario");
      const partes = [];
      if (prod.length) partes.push(`falta producir: ${prod.map((x) => x.cant + "× " + x.producto).join(", ")}`);
      if (ins.length) partes.push(`el inventario no alcanzó para: ${ins.map((x) => x.cant + "× " + x.producto).join(", ")}`);
      setAviso({ titulo: "Inventario insuficiente", texto: `Se reservó lo disponible, pero ${partes.join(" y ")}. Ya quedó la sugerencia en Producción.` });
    }
    return true;
  }

  function exportar() {
    downloadCSV("pedidos",
      ["Pedido","Fecha","Hora","Canal","Cliente","Teléfono","Barrio","Zona","Contenido exacto","Subtotal","Descuento","Domicilio cobrado","Costo domicilio","Total","Pago","Estado","Campaña","Creativo","Origen"],
      filtrados.map((o) => {
        const c = customerOf(db, o.customerId);
        const camp = db.campaigns.find((x) => x.id === o.campaignId);
        const cre = db.creatives.find((x) => x.id === o.creativeId);
        return [o.id, o.fecha, o.hora, o.canal, c.nombre, c.telefono, o.barrio, o.zona,
          itemsOf(db, o.id).map((i) => { const p = orderLinePresentationForOrders(i, productOf(db, i.productId)); return p.quantityLabel + (p.secondary ? " (" + p.secondary + ")" : "") + (i.costoUnitario !== undefined ? " · costo hist. " + fmt(i.costoUnitario) : ""); }).join(" | "),
          orderSubtotal(db, o), o.descuento, o.domCobrado, o.domCosto, orderTotal(db, o), o.pago, o.estado,
          camp ? camp.nombre : "", cre ? cre.titulo : "", o.origenDetalle || ""];
      }));
  }

  const sel = selId ? db.orders.find((o) => o.id === selId) : null;

  return (
    <div>
      <SectionTitle>Tablero de pedidos</SectionTitle>
      <div className="text-xs font-semibold mb-3 -mt-3" style={{ color: T.choco2 }}>
        Seguí cada pedido desde la agenda hasta la entrega, en tablero, tabla o trazabilidad.
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="🧾" label="Pedidos" value={db.orders.length} sub="en el sistema" tone={T.coral} />
        <Stat icon="⚙" label="En operación" value={orderBuckets.active.length} sub="en flujo activo" tone="#63518A" />
        <Stat icon="◷" label="En historial" value={orderBuckets.history.length} sub="cerrados o cancelados" tone={T.choco} />
        <Stat icon="💵" label="Ventas (filtro)" value={fmt(filtrados.reduce((s, o) => s + orderTotal(db, o), 0))} sub="según filtros aplicados" tone="#3F6B42" />
      </div>
      <div className="text-[11px] font-semibold mt-2 mb-4" style={{ color: T.choco2 }}>
        <b style={{ color: T.coral }}>{orderBuckets.active.length}</b> en operación de {db.orders.length} pedidos registrados.
      </div>

      <Card className="p-3 mb-3" style={{ borderColor: "#A7C9A4", background: "#F2F8F0" }}>
        <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: "#3F6B42" }}>Responsables del pedido</div>
        <div className="text-xs font-bold mt-1 leading-relaxed">Recepción agenda → Caja/Coordinación confirma pago → Cocina prepara → Empaque alista → Logística despacha y entrega.</div>
        <div className="text-[11px] font-semibold mt-1" style={{ color: T.choco2 }}>Tus roles: <b>{rolesLabel(perfil)}</b> · los permisos de cada área se acumulan.</div>
      </Card>
      <Card className="p-4 mb-3" onClick={() => setAsistenteVentasAbierto(true)} style={{ background: "linear-gradient(135deg,#FFF4EA,#FFFFFF)", borderColor: salesAssistant.summary.evidence || salesAssistant.summary.incomplete ? "#E7B36E" : T.border }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl shrink-0" style={{ background: T.coralSoft }} aria-hidden="true">💬</span>
            <div className="min-w-0"><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Asistente de Ventas y Recepción</div><div className="display text-lg font-semibold mt-0.5">{salesAssistant.summary.attention ? `${salesAssistant.summary.attention} ${salesAssistant.summary.attention === 1 ? "conversación" : "conversaciones"} por atender` : "Recepción está al día"}</div><div className="text-xs font-semibold mt-0.5" style={{ color: T.choco2 }}>{salesAssistant.summary.attention ? `${salesAssistant.summary.evidence} comprobante${salesAssistant.summary.evidence === 1 ? "" : "s"} por verificar · ${salesAssistant.summary.incomplete} pedido${salesAssistant.summary.incomplete === 1 ? "" : "s"} incompleto${salesAssistant.summary.incomplete === 1 ? "" : "s"} · ${fmt(salesAssistant.summary.pendingValue)} pendientes` : "No hay pedidos nuevos ni pagos pendientes en la cola."}</div></div>
          </div>
          <span className="text-xs font-extrabold shrink-0" style={{ color: T.coral }}>{salesAssistant.summary.attention ? "Ver siguiente acción ›" : "Ver análisis ›"}</span>
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {puedeCrearPedido && <Btn onClick={() => setNuevo(true)}>＋ Agendar pedido</Btn>}
        <WorkScopeTabs value={scope} onChange={(next) => { setScope(next); setPendPago(false); }} activeCount={orderBuckets.active.length} historyCount={orderBuckets.history.length} activeLabel="En operación" />
        <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: T.border }}>
          {[{ id: "kanban", label: "Kanban" }, { id: "tabla", label: "Tabla" }, { id: "control", label: "Control y trazabilidad" }].map((option) => (
            <button key={option.id} onClick={() => setModo(option.id)} className="px-3 py-2 text-xs font-bold"
              style={{ background: modo === option.id ? T.rosa : T.surface, color: modo === option.id ? "#8E4B5A" : T.choco2 }}>{option.label}</button>
          ))}
        </div>
        <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Buscar pedido, cliente o teléfono…"
          className="flex-1 min-w-[170px] rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
        <Btn small kind="ghost" onClick={() => setVerFiltros(!verFiltros)}>Filtros {(pendPago || Object.values(f).filter((v, i) => i > 0 && v).length > 0) && "●"}</Btn>
        <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
      </div>

      {verFiltros && (
        <Card className="p-3 mb-4">
          {pendPago && (
            <div className="flex items-center justify-between gap-2 mb-2 px-2.5 py-1.5 rounded-xl" style={{ background: "#FBE8C8" }}>
              <span className="text-xs font-bold" style={{ color: "#96690F" }}>💳 Solo pendientes de pago (Nuevo, Confirmado o Pendiente de pago, sin pago registrado)</span>
              <button onClick={() => setPendPago(false)} className="text-xs font-bold" style={{ color: "#96690F" }}>Quitar ✕</button>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MiniSelect placeholder="Canal: todos" options={CANALES} value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })} />
          <MiniSelect placeholder="Estado: todos" options={ORDER_STATES} value={f.estado} onChange={(e) => { const estado = e.target.value; setF({ ...f, estado }); if (estado) setScope(isActiveOrder({ estado }) ? "active" : "history"); }} />
          <MiniSelect placeholder="Barrio: todos" options={barrios} value={f.barrio} onChange={(e) => setF({ ...f, barrio: e.target.value })} />
          <select value={f.producto} onChange={(e) => setF({ ...f, producto: e.target.value })} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle}>
            <option value="">Postre, caja o elaboración: todos</option>
            {db.products.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <select value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle}>
            <option value="">Cliente: todos</option>
            {db.customers.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <input type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Desde" />
          <input type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Hasta" />
          <Btn small kind="ghost" onClick={() => { setF({ q: f.q, canal: "", estado: "", barrio: "", producto: "", cliente: "", desde: "", hasta: "" }); setPendPago(false); }}>Limpiar</Btn>
          </div>
        </Card>
      )}

      {modo === "control" ? (
        <PanelTrazabilidadPedidos db={db} orders={filtrados} onOpen={setSelId} />
      ) : modo === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
          {columnasVisibles.map((col) => {
            const enCol = filtrados.filter((o) => o.estado === col);
            return (
              <div key={col} className="w-64 shrink-0">
                <div className="flex items-center justify-between mb-2 px-1">
                  <Badge label={col} /><span className="text-xs font-bold" style={{ color: T.choco2 }}>{enCol.length}</span>
                </div>
                <div className="flex flex-col gap-2 min-h-[60px] rounded-2xl p-2" style={{ background: T.vainilla + "80" }}>
                  {enCol.map((o) => {
                    const c = customerOf(db, o.customerId);
                    return (
                      <Card key={o.id} className="p-3" onClick={() => setSelId(o.id)}>
                        <div className="flex justify-between items-start gap-2">
                          <div className="font-bold text-sm">{o.id}</div>
                          <Badge label={o.canal} map={CANAL_STYLE} />
                        </div>
                        <div className="text-sm font-semibold mt-1 truncate">{c.nombre}</div>
                        <div className="text-xs truncate" style={{ color: T.choco2 }}>{o.barrio} · {o.hora}</div>
                        <div className="text-xs mt-1 truncate" style={{ color: T.choco2 }}>
                          {itemsOf(db, o.id).filter((item) => !item.esCaja).map((i) => orderLinePresentationForOrders(i, productOf(db, i.productId)).quantityLabel).join(", ")}
                        </div>
                        <div className="flex justify-between items-center mt-2">
                          <span className="display font-semibold" style={{ color: T.coral }}>{fmt(orderTotal(db, o))}</span>
                          {tieneSelloEmpaque(db, o.id) && <span title="Con sello de empaque" className="text-xs">📸</span>}
                        </div>
                      </Card>
                    );
                  })}
                  {enCol.length === 0 && <div className="text-xs text-center py-4 font-semibold" style={{ color: T.choco2 }}>Sin pedidos</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs" style={{ color: T.choco2 }}>
              {["Pedido","Cliente","Canal","Barrio","Total","Pago","Estado",""].map((h) => <th key={h} className="px-3 py-3 font-bold">{h}</th>)}
            </tr></thead>
            <tbody>
              {filtrados.map((o) => {
                const c = customerOf(db, o.customerId);
                return (
                  <tr key={o.id} className="border-t" style={{ borderColor: T.border }}>
                    <td className="px-3 py-2.5 font-bold">{o.id}<div className="text-xs font-normal" style={{ color: T.choco2 }}>{o.fecha} {o.hora}</div></td>
                    <td className="px-3 py-2.5">{c.nombre}<div className="text-xs" style={{ color: T.choco2 }}>{c.telefono}</div></td>
                    <td className="px-3 py-2.5"><Badge label={o.canal} map={CANAL_STYLE} /></td>
                    <td className="px-3 py-2.5">{o.barrio}</td>
                    <td className="px-3 py-2.5 font-bold" style={{ color: T.coral }}>{fmt(orderTotal(db, o))}</td>
                    <td className="px-3 py-2.5 text-xs font-semibold">{o.pago}{o.comprobante ? " ✓" : ""}</td>
                    <td className="px-3 py-2.5"><Badge label={o.estado} /></td>
                    <td className="px-3 py-2.5"><Btn small kind="ghost" onClick={() => setSelId(o.id)}>Abrir</Btn></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {asistenteVentasAbierto && (
        <Modal title="Asistente de Ventas y Recepción" onClose={() => setAsistenteVentasAbierto(false)} wide>
          <div className="rounded-3xl border p-4 sm:p-5 mb-4" style={{ background: "linear-gradient(135deg,#FFF4EA,#FFFFFF)", borderColor: T.border }}>
            <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Atención priorizada</div>
            <div className="display text-2xl font-semibold mt-1">Qué conversación atender ahora</div>
            <div className="text-sm font-semibold mt-1 max-w-2xl" style={{ color: T.choco2 }}>MOMO OPS reúne datos faltantes, comprobantes, disponibilidad exacta y contexto del cliente. Te recomienda el siguiente paso, pero no confirma pagos, beneficios ni sustituciones sin una persona autorizada.</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
              <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>En recepción</div><div className="display text-xl mt-0.5" style={{ color: T.coral }}>{salesAssistant.summary.attention}</div></div>
              <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Comprobantes</div><div className="display text-xl mt-0.5" style={{ color: salesAssistant.summary.evidence ? "#3F6B42" : T.choco }}>{salesAssistant.summary.evidence}</div></div>
              <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Incompletos</div><div className="display text-xl mt-0.5" style={{ color: salesAssistant.summary.incomplete ? "#A03B2A" : "#3F6B42" }}>{salesAssistant.summary.incomplete}</div></div>
              <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Valor pendiente</div><div className="display text-lg mt-0.5" style={{ color: "#3F6B42" }}>{fmt(salesAssistant.summary.pendingValue)}</div></div>
            </div>
          </div>

          {salesAssistant.queue.length === 0 ? (
            <div className="rounded-3xl p-8 text-center" style={{ background: "#E5F0E1" }}><div className="text-3xl">✓</div><div className="display text-xl mt-2">Recepción al día</div><div className="text-sm font-semibold mt-1" style={{ color: "#3F6B42" }}>No hay pedidos nuevos, incompletos ni pagos esperando seguimiento.</div></div>
          ) : (
            <div className="space-y-2">
              {salesAssistant.queue.map((row, index) => {
                const stockTone = row.stock.status === "available" ? { bg: "#DDEBD9", fg: "#3F6B42" } : row.stock.status === "shortage" ? { bg: "#F6D4CD", fg: "#A03B2A" } : { bg: T.vainilla, fg: "#7B5410" };
                const waitLabel = row.waitingMinutes >= 60 ? `${Math.floor(row.waitingMinutes / 60)} h ${row.waitingMinutes % 60} min` : `${row.waitingMinutes} min`;
                return <Card key={row.orderId} className="p-4" style={{ borderColor: index === 0 ? "#E59A83" : T.border, background: index === 0 ? "#FFF8F4" : T.surface }}>
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0" style={{ background: index === 0 ? T.coral : T.vainilla, color: index === 0 ? "#fff" : T.choco2 }}>{index + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><div className="font-extrabold">{row.orderId} · {row.customer.nombre || "Cliente sin nombre"}</div><Badge label={row.order.estado} /><Badge label={row.priority} map={{ Urgente: { bg: "#F6D4CD", fg: "#A03B2A" }, Alta: { bg: "#FBE8C8", fg: "#96690F" }, Normal: { bg: T.vainilla, fg: T.choco2 } }} /></div>
                      <div className="display text-lg font-semibold mt-1">{row.action}</div>
                      <div className="flex flex-wrap gap-1.5 mt-2"><span className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: stockTone.bg, color: stockTone.fg }}>{row.stock.label}</span><span className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: "#F2F2F2", color: T.choco2 }}>{fmt(row.total)} · espera {waitLabel}</span>{row.hasEvidence && <span className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: "#E5F0E1", color: "#3F6B42" }}>Comprobante recibido</span>}</div>
                      {row.missing.length > 0 && <div className="text-[11px] font-bold mt-2" style={{ color: "#A03B2A" }}>Falta: {row.missing.join(" · ")}</div>}
                      {row.customerContext.length > 0 && <div className="text-[11px] font-semibold mt-1" style={{ color: T.choco2 }}>Cliente: {row.customerContext.join(" · ")}</div>}
                      {row.stock.status === "shortage" && <div className="text-[11px] font-semibold mt-1" style={{ color: "#A03B2A" }}>No prometas sustituciones: al pagar se generará la producción exacta faltante.</div>}
                    </div>
                    <div className="shrink-0"><Btn small onClick={() => { setAsistenteVentasAbierto(false); setSelId(row.orderId); }}>Abrir pedido</Btn></div>
                  </div>
                </Card>;
              })}
            </div>
          )}
        </Modal>
      )}

      {sel && <DetallePedido db={db} o={sel} update={update} user={user} onClose={() => setSelId(null)} cambiar={cambiar} setAviso={setAviso} sincronizarPedido={sincronizarPedido} perfil={perfil} />}
      {nuevo && puedeCrearPedido && <NuevoPedido db={db} update={update} user={user} onClose={() => setNuevo(false)} setAviso={setAviso} sincronizarPedido={sincronizarPedido} />}
      {aviso && (
        <Modal title={aviso.titulo} onClose={() => setAviso(null)}>
          <p className="text-sm m-0">{aviso.texto}</p>
          <div className="mt-4"><Btn onClick={() => setAviso(null)}>Entendido</Btn></div>
        </Modal>
      )}
    </div>
  );
}

function ControlOperativoPedido({ db, order, perfil, sincronizarPedido, setAviso }) {
  const stage = operationalStageForOrder(order);
  const assignment = stage ? activeStageAssignment(order.id, stage, db.order_stage_assignments) : null;
  const lines = stage && stage !== "Logística" ? lineProgressFor(order.id, stage, db.order_items, db.order_line_progress) : [];
  const incidents = openOrderIncidents(order.id, db.order_incidents);
  const handoff = dispatchHandoffFor(order.id, db.order_dispatch_handoffs);
  const allowed = stage && canOperateStage(perfil, stage);
  const owns = assignment && (assignment.userId === perfil?.id || hasRole(perfil, "Administrador"));
  const [busy, setBusy] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issue, setIssue] = useState({ type: "Faltante", description: "", orderItemId: "" });

  if (!db.operationalControlReady || !stage) return null;

  async function act(key, action, success) {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      await sincronizarPedido(order.id);
      toast("ok", success);
    } catch (error) {
      setAviso({ titulo: "No se pudo completar el control operativo", texto: error.message });
    } finally { setBusy(""); }
  }

  const allKitchenReady = stage === "Cocina" && lines.length > 0 && lines.every(({ progress }) => progress.status === "Listo");
  return (
    <div id={`packing-control-${order.id}`} className="rounded-2xl border p-4 mb-4" style={{ background: "linear-gradient(135deg,#FFF9F1,#FFFFFF)", borderColor: T.border }}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Control operativo · {stage}</div>
          <div className="display text-lg font-semibold">{assignment ? `${assignment.user || "Responsable asignado"} tiene esta etapa` : "Etapa disponible para tomar"}</div>
          <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>
            {assignment ? `Tomada ${assignment.claimedAt}. Una sola persona confirma; el equipo puede consultar.` : "Tomarla evita que dos personas procesen la misma orden al tiempo."}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!assignment && allowed && <Btn small disabled={!!busy} onClick={() => act("claim", () => tomarEtapaPedido(order.id, stage), `${order.id} · ${stage} quedó a tu cargo`)}>Tomar {stage}</Btn>}
          {assignment && owns && <Btn small kind="ghost" disabled={!!busy} onClick={() => act("release", () => liberarEtapaPedido(order.id, stage, "Reasignación operativa"), `${order.id} · etapa liberada`)}>Liberar etapa</Btn>}
          {allowed && <Btn small kind="rosa" disabled={!!busy} onClick={() => setIssueOpen((value) => !value)}>⚠ Registrar novedad</Btn>}
        </div>
      </div>

      {lines.length > 0 && <div className="mt-4 space-y-2">
        {lines.map(({ item, progress }) => {
          const presentation = orderLinePresentationForOrders(item, productOf(db, item.productId));
          return (
          <div key={item.id} className="rounded-xl border px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2" style={{ borderColor: progress.status === "Incidente" ? "#E3A292" : T.border, background: progress.status === "Listo" || progress.status === "Verificado" ? "#F2F8F0" : "#fff" }}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold">{presentation.quantityLabel}</div>
              <div className="text-[11px] font-semibold" style={{ color: T.choco2 }}>{presentation.secondary || "Línea de la orden"}</div>
            </div>
            <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: progress.status === "Incidente" ? "#F8D6CF" : progress.status === "Listo" || progress.status === "Verificado" ? "#DDEBD9" : T.vainilla }}>{progress.status}</span>
            {stage === "Cocina" && owns && <select aria-label={`Estado de ${presentation.primary}`} value={progress.status} disabled={!!busy}
              onChange={(event) => act(item.id, () => setProgresoLineaPedido(item.id, stage, event.target.value, progress.version || null), `${presentation.primary} · ${event.target.value}`)}
              className="rounded-xl border px-2 py-2 text-xs font-bold" style={inputStyle}>
              {STAGE_LINE_STATUSES.Cocina.map((status) => <option key={status}>{status}</option>)}
            </select>}
          </div>
          );
        })}
        {stage === "Cocina" && owns && <div className="flex items-center justify-between gap-3 pt-1">
          <div className="text-[11px] font-semibold" style={{ color: allKitchenReady ? "#3F6B42" : T.choco2 }}>{lines.filter(({ progress }) => progress.status === "Listo").length}/{lines.length} líneas listas</div>
          {!allKitchenReady && <Btn small disabled={!!busy || incidents.length > 0} onClick={() => act("complete", () => completarEtapaPedido(order.id, "Cocina"), `${order.id} · todas las líneas quedaron listas`)}>Marcar cocina terminada</Btn>}
        </div>}
        {stage === "Empaque" && <div className="text-[11px] font-semibold" style={{ color: T.choco2 }}>Las líneas solo quedan Verificadas al completar la comparación exacta de la comanda; no pueden marcarse manualmente.</div>}
      </div>}

      {issueOpen && <div className="mt-4 rounded-xl p-3 border" style={{ background: T.coralSoft, borderColor: "#E8B5A5" }}>
        <div className="grid sm:grid-cols-3 gap-2">
          <select value={issue.orderItemId} onChange={(e) => setIssue({ ...issue, orderItemId: e.target.value })} className="rounded-xl border px-2 py-2 text-xs" style={inputStyle}>
            <option value="">Pedido completo</option>{lines.map(({ item }) => <option key={item.id} value={item.id}>{orderLinePresentationForOrders(item, productOf(db, item.productId)).quantityLabel}</option>)}
          </select>
          <select value={issue.type} onChange={(e) => setIssue({ ...issue, type: e.target.value })} className="rounded-xl border px-2 py-2 text-xs" style={inputStyle}>
            {["Faltante", "Sustitución", "Preparación equivocada", "Rehacer", "Diferencia de empaque", "Dirección", "Domicilio", "Cliente ausente", "Otro"].map((type) => <option key={type}>{type}</option>)}
          </select>
          <input value={issue.description} onChange={(e) => setIssue({ ...issue, description: e.target.value })} placeholder="¿Qué ocurrió?" className="rounded-xl border px-3 py-2 text-xs" style={inputStyle} />
        </div>
        <div className="flex justify-end mt-2"><Btn small disabled={issue.description.trim().length < 3 || !!busy} onClick={() => act("issue", () => crearIncidentePedido({ order_id: order.id, order_item_id: issue.orderItemId || null, area: stage, type: issue.type, description: issue.description }), `${order.id} · novedad registrada`).then(() => { setIssueOpen(false); setIssue({ type: "Faltante", description: "", orderItemId: "" }); })}>Registrar y bloquear avance</Btn></div>
      </div>}

      {incidents.length > 0 && <div className="mt-3 space-y-2">{incidents.map((incident) => <div key={incident.id} className="rounded-xl px-3 py-2 flex items-center gap-3" style={{ background: "#FBE3DA" }}>
        <div className="flex-1 text-xs"><b>{incident.type}</b> · {incident.description}<div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>{incident.area} · {incident.createdByName || "equipo"} · {incident.createdAt}</div></div>
        {(hasAnyRole(perfil, ["Administrador", "Coordinador de pedidos"]) || canOperateStage(perfil, incident.area)) && <Btn small kind="ghost" disabled={!!busy} onClick={() => act(incident.id, () => resolverIncidentePedido(incident.id, "Resuelto y validado por el área responsable"), `${incident.id} · resuelto`)}>Resolver</Btn>}
      </div>)}</div>}

      {order.estado === "Listo para despacho" && <div className="mt-4 rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: handoff?.status === "Aceptado" ? "#F2F8F0" : "#F7F0FF", borderColor: handoff?.status === "Aceptado" ? "#A7C9A4" : "#D8C8E8" }}>
        <div><div className="text-xs font-extrabold">Relevo físico Empaque → Logística</div><div className="text-[11px] font-semibold" style={{ color: T.choco2 }}>{handoff ? `${handoff.status} · ${handoff.packingUser || "Empaque"}${handoff.logisticsUser ? ` → ${handoff.logisticsUser}` : ""}` : "Empaque debe ofrecer el paquete y Logística aceptarlo antes de iniciar ruta."}</div></div>
        <div className="flex gap-2">
          {canOperateStage(perfil, "Empaque") && (!handoff || handoff.status !== "Aceptado") && <Btn small disabled={!!busy} onClick={() => act("offer", () => ofrecerRelevoDespacho(order.id), `${order.id} · ofrecido a Logística`)}>Ofrecer paquete</Btn>}
          {canOperateStage(perfil, "Logística") && handoff?.status === "Ofrecido" && <Btn small disabled={!!busy} onClick={() => act("accept", () => aceptarRelevoDespacho(order.id), `${order.id} · relevo aceptado`)}>Aceptar paquete</Btn>}
        </div>
      </div>}
    </div>
  );
}

function PackingCopilot({ order, progress, handoff }) {
  const guide = buildPackingGuide({ orderStatus: order.estado, progress, handoff });
  const current = guide.current;
  const topLines = progress.lines.filter((line) => !line.parentItemId);
  const targetByStep = {
    receive: `packing-control-${order.id}`,
    verify: `packing-checklist-${order.id}`,
    "open-photo": `packing-evidence-${order.id}`,
    "seal-photo": `packing-evidence-${order.id}`,
    pack: `packing-actions-${order.id}`,
    handoff: order.estado === "Empacado" ? `packing-delivery-${order.id}` : `packing-control-${order.id}`,
  };
  const actionLabel = {
    receive: "Ir al responsable",
    verify: "Ir a comparar",
    "open-photo": "Ir a la foto",
    "seal-photo": "Ir al sello",
    pack: "Ir a confirmar",
    handoff: order.estado === "Empacado" ? "Preparar etiqueta" : "Ir al relevo",
  };

  function focusCurrentStep() {
    const target = current && document.getElementById(targetByStep[current.key]);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="rounded-3xl border p-4 sm:p-5 mb-4 overflow-hidden" style={{ background: "linear-gradient(135deg,#FFF7F1 0%,#FFFFFF 58%,#F2F8F0 100%)", borderColor: "#E8CDBD" }}>
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[.16em] font-extrabold" style={{ color: T.coral }}>Copiloto de Empaque · pedido {order.id}</div>
          <div className="display text-xl sm:text-2xl font-semibold mt-0.5">Una comanda, seis controles, cero suposiciones</div>
          <div className="text-xs font-semibold mt-1 max-w-2xl" style={{ color: T.choco2 }}>Te acompaña desde la entrega de Cocina hasta el relevo físico a Logística. Cada avance usa la verificación y las evidencias oficiales del pedido.</div>
        </div>
        <div className="shrink-0 flex items-center gap-2 rounded-2xl px-3 py-2 border" style={{ background: "#fff", borderColor: guide.complete ? "#A7C9A4" : T.border }}>
          <span className="display text-2xl font-semibold" style={{ color: guide.complete ? "#3F6B42" : T.coral }}>{guide.completed}/{guide.total}</span>
          <span className="text-[10px] font-extrabold leading-tight" style={{ color: T.choco2 }}>{guide.complete ? "RELEVO\nCOMPLETO" : "PASOS\nSEGUROS"}</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2" aria-label={`Guía de Empaque para ${order.id}`}>
        {guide.steps.map((step, index) => {
          const done = step.status === "done";
          const active = step.status === "current";
          return <div key={step.key} className="rounded-2xl border px-3 py-3 min-h-[112px]" style={{ background: done ? "#F2F8F0" : active ? T.coralSoft : "#fff", borderColor: done ? "#A7C9A4" : active ? "#E59A83" : T.border, opacity: step.status === "pending" ? .72 : 1 }}>
            <div className="flex items-center justify-between gap-2"><span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black" style={{ background: done ? "#3F6B42" : active ? T.coral : T.vainilla, color: done || active ? "#fff" : T.choco2 }}>{done ? "✓" : index + 1}</span><span aria-hidden="true">{step.icon}</span></div>
            <div className="text-xs font-extrabold mt-2 leading-tight">{step.title}</div>
            <div className="text-[10px] font-semibold mt-1 leading-snug" style={{ color: T.choco2 }}>{step.detail}</div>
          </div>;
        })}
      </div>

      <div className="mt-4 grid lg:grid-cols-[1.35fr_.65fr] gap-3">
        <div className="rounded-2xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: guide.complete ? "#E3EFE0" : "#FFF5E2", borderColor: guide.complete ? "#BFD8BE" : "#E7C078" }}>
          <div><div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: guide.complete ? "#3F6B42" : "#96690F" }}>{guide.complete ? "Trabajo cerrado" : `Ahora · ${current?.title || "Completado"}`}</div><div className="text-sm font-extrabold mt-0.5">{guide.nextAction}</div></div>
          {!guide.complete && current && <Btn small onClick={focusCurrentStep}>{actionLabel[current.key] || "Continuar"}</Btn>}
        </div>
        <div className="rounded-2xl border px-4 py-3" style={{ background: "#fff", borderColor: T.border }}>
          <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>Contenido esperado</div>
          <div className="text-sm font-extrabold mt-0.5">{topLines.length} línea{topLines.length === 1 ? "" : "s"} principal{topLines.length === 1 ? "" : "es"} · {progress.lines.length} control{progress.lines.length === 1 ? "" : "es"}</div>
          <div className="text-[10px] font-semibold mt-1 line-clamp-2" style={{ color: T.choco2 }}>{topLines.map((line) => line.label).join(" · ") || "La orden no tiene líneas verificables."}</div>
        </div>
      </div>
    </div>
  );
}

function DetallePedido({ db, o, update, user, onClose, cambiar, setAviso, sincronizarPedido, perfil, contextActions = null }) {
  const fileRef = useRef(null);
  const tipoSubidaRef = useRef("Comprobante de pago"); // tipo fijo de la subida en curso
  const [tipoEv, setTipoEv] = useState(o.pagadoEn ? "Entrega" : "Comprobante de pago"); // solo para el modo libre (＋ otra foto)
  const [libre, setLibre] = useState(false); // muestra el picker manual para documentales
  const [subiendo, setSubiendo] = useState(false);
  const [foto, setFoto] = useState(null);
  const [abriendoEvidenciaId, setAbriendoEvidenciaId] = useState(null);
  const [enviando, setEnviando] = useState(false); // guarda local: cambiar() y crearReclamo() son async vía props
  const [verificandoEmpaque, setVerificandoEmpaque] = useState(false);
  const [etiquetaDomicilio, setEtiquetaDomicilio] = useState(false);
  const [solicitudDomicilio, setSolicitudDomicilio] = useState(false);
  const [creandoDomicilio, setCreandoDomicilio] = useState(false);
  const [verMasAcciones, setVerMasAcciones] = useState(false);
  const [formDomicilio, setFormDomicilio] = useState(() => ({
    proveedor: db.settings.proveedores[0] || "",
    zona: o.zona || db.settings.zonas[0]?.nombre || "",
    costoReal: "",
    obs: o.obs || "",
  }));
  const c = customerOf(db, o.customerId);
  const evs = evidencesOf(db, o.id);
  const packingLines = buildPackingChecklistLines(o.id, db.order_items);
  const packingVerificationCandidate = findPackingVerification(o.id, db.packing_verifications || []);
  const packingVerification = packingVerificationMatchesLines(packingVerificationCandidate, packingLines) ? packingVerificationCandidate : null;
  const packingProgress = packingStationProgress({ orderId: o.id, orderItems: db.order_items, evidences: db.evidences, verifications: db.packing_verifications || [] });
  const packingHandoff = dispatchHandoffFor(o.id, db.order_dispatch_handoffs);
  const [checkedPackingLines, setCheckedPackingLines] = useState(() => new Set(packingVerification ? packingLines.map((line) => line.id) : []));
  const flujo = { "Nuevo": "Confirmado", "Confirmado": "Pendiente de pago", "Pendiente de pago": "Pagado", "Pagado": "En producción", "En producción": "Listo para empaque", "Listo para empaque": "Empacado", "Empacado": "Listo para despacho", "Listo para despacho": "En ruta", "En ruta": "Entregado" };
  const siguiente = flujo[o.estado];
  const comprobantePagoVinculado = tieneEvidencia(db, o.id, "Comprobante de pago");
  const accionRecepcion = orderIntakePrimaryAction(perfil, o, { hasPaymentEvidence: comprobantePagoVinculado });
  const permisoSiguiente = siguiente ? orderTransitionPermission(perfil, o.estado, siguiente) : null;
  const permisoPago = orderTransitionPermission(perfil, o.estado, "Pagado");
  const permisoEntregaRapida = orderTransitionPermission(perfil, o.estado, "Entregado", { quickSale: true });
  const permisoCancelar = orderTransitionPermission(perfil, o.estado, "Cancelado");
  const permisoReclamo = orderTransitionPermission(perfil, o.estado, "Reclamo");
  const puedeCorregirPago = !accionRecepcion && o.estado === "En producción" && permisoPago.allowed && !comprobantePagoVinculado;
  const puedeEntregaRapida = permisoEntregaRapida.allowed && o.pagadoEn && ["Pagado","En producción","Empacado","Listo para despacho"].includes(o.estado);
  const puedeCrearReclamo = permisoReclamo.allowed && !["Reclamo","Cancelado"].includes(o.estado);
  const puedeCancelarPedido = permisoCancelar.allowed && !["Entregado","Cancelado","Reclamo"].includes(o.estado);
  const hayAccionesSecundarias = puedeCorregirPago || puedeEntregaRapida || puedeCrearReclamo || puedeCancelarPedido;
  const tiposEvidenciaPermitidos = EV_TIPOS.filter((tipo) => orderEvidencePermission(perfil, tipo).allowed);
  const puedeGestionarRelevo = canManageDeliveryHandoff(perfil);
  const domicilioActivo = db.deliveries.find((delivery) => delivery.orderId === o.id && deliveryBlocksNewRequest(delivery));
  const direccionParaCopiar = o.direccion || c.direccion || "";
  const textoDomicilio = [
    `Pedido ${o.id}`,
    `Cliente: ${c.nombre || "Sin nombre"}`,
    `Teléfono: ${c.telefono || "Sin teléfono"}`,
    `Dirección: ${o.direccion || c.direccion || "Sin dirección"}`,
    `Barrio: ${o.barrio || c.barrio || "Sin barrio"}`,
    `Zona: ${o.zona || "Sin zona"}`,
    `Apto/casa/local y referencia: ${o.obs || "Sin referencia adicional"}`,
  ].join("\n");

  useEffect(() => {
    setCheckedPackingLines(new Set(packingVerification ? packingLines.map((line) => line.id) : []));
  }, [o.id, packingVerification?.verifiedAt]);

  const packingChecklistComplete = packingLines.length > 0 && packingLines.every((line) => checkedPackingLines.has(line.id));

  async function abrirEvidencia(evidence) {
    if (!evidence || abriendoEvidenciaId) return;
    if (evidence.url) { setFoto(evidence); return; }
    if (!evidence.storagePath) return;
    setAbriendoEvidenciaId(evidence.id);
    try {
      const url = await fetchEvidenceSignedUrl(evidence.storagePath);
      setFoto({ ...evidence, url });
    } catch (error) {
      setAviso({ titulo: "No se pudo abrir la evidencia", texto: error.message });
    } finally {
      setAbriendoEvidenciaId(null);
    }
  }

  async function confirmarChecklistEmpaque() {
    if (!packingChecklistComplete || verificandoEmpaque) return;
    setVerificandoEmpaque(true);
    try {
      await confirmarVerificacionEmpaque(o.id, packingLines.map((line) => line.id));
      await sincronizarPedido(o.id);
      toast("ok", `${o.id} · comanda verificada contra la orden`);
    } catch (error) {
      setAviso({ titulo: "No se pudo verificar la comanda", texto: error.message });
    } finally {
      setVerificandoEmpaque(false);
    }
  }

  async function solicitarDomicilioDesdePedido() {
    if (creandoDomicilio || domicilioActivo || o.canal === "Rappi") return;
    setCreandoDomicilio(true);
    try {
      await crearDomicilio(o.id, formDomicilio.proveedor, formDomicilio.zona, Math.max(0, +formDomicilio.costoReal || 0), formDomicilio.obs);
      await sincronizarPedido(o.id);
      setSolicitudDomicilio(false);
      toast("ok", `${o.id} · domicilio solicitado`);
    } catch (error) {
      setAviso({ titulo: "No se pudo solicitar el domicilio", texto: error.message });
    } finally {
      setCreandoDomicilio(false);
    }
  }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const tipo = tipoSubidaRef.current;
    const permisoEvidencia = orderEvidencePermission(perfil, tipo);
    if (!permisoEvidencia.allowed) {
      setAviso({ titulo: "Esta foto pertenece a otra área", texto: permisoEvidencia.reason });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setSubiendo(true);
    try {
      const url = await compressImage(file);
      // Fase 3: la foto va al bucket privado + RPC crear_evidencia (id/user/audit server-side)
      await subirEvidencia({ orderId: o.id, tipo, dataUrl: url });
    } catch (err) {
      setAviso({ titulo: "Error al subir", texto: err.message || "No se pudo procesar la imagen. Intenta con otra foto." });
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (tipo === "Comprobante de pago" && accionRecepcion?.type === "evidence" && accionRecepcion.autoAdvance && accionRecepcion.allowed) {
      const pagoConfirmado = await cambiar(o.id, accionRecepcion.target);
      if (pagoConfirmado) {
        setSubiendo(false);
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
    }
    try {
      await sincronizarPedido(o.id);
    } catch (err) {
      setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: "La evidencia se guardó correctamente, pero no se pudo actualizar la vista. Recargá la página para verla." });
    }
    setSubiendo(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  // Dispara la cámara/galería para una foto con su tipo YA FIJO (evidencias guiadas por paso).
  function abrirCamara(tipo) {
    const permiso = orderEvidencePermission(perfil, tipo);
    if (!permiso.allowed) {
      setAviso({ titulo: "Esta foto pertenece a otra área", texto: permiso.reason });
      return;
    }
    tipoSubidaRef.current = tipo;
    if (fileRef.current) fileRef.current.click();
  }

  return (
    <Modal title={`Pedido ${o.id}`} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Badge label={o.estado} /><Badge label={o.canal} map={CANAL_STYLE} />
        <span className="text-xs font-semibold" style={{ color: T.choco2 }}>{o.fecha} · {o.hora}</span>
      </div>

      {(accionRecepcion || siguiente) && (
        <div className="rounded-2xl border px-4 py-3 mb-4" role="note"
          style={{ background: (accionRecepcion || permisoSiguiente).allowed ? "#F2F8F0" : "#FFF9F1", borderColor: (accionRecepcion || permisoSiguiente).allowed ? "#A7C9A4" : "#E7C078" }}>
          <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: (accionRecepcion || permisoSiguiente).allowed ? "#3F6B42" : "#96690F" }}>{accionRecepcion ? "Una sola acción para avanzar" : "Responsable del siguiente paso"}</div>
          <div className="text-sm font-extrabold mt-0.5">{accionRecepcion ? accionRecepcion.label : `${o.estado} → ${siguiente}: ${permisoSiguiente.ownerLabel}`}</div>
          <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{accionRecepcion ? accionRecepcion.detail : permisoSiguiente.allowed ? "Tu área puede confirmar este avance cuando termine el trabajo." : "Podés consultar la orden, pero la confirmación queda en manos del área que ejecuta el paso."}</div>
        </div>
      )}

      {["Listo para empaque", "Empacado", "Listo para despacho"].includes(o.estado) && <PackingCopilot order={o} progress={packingProgress} handoff={packingHandoff} />}

      <ControlOperativoPedido db={db} order={o} perfil={perfil} sincronizarPedido={sincronizarPedido} setAviso={setAviso} />

      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>CLIENTE Y ENTREGA</div>
          <div className="text-sm font-bold">{c.nombre}</div>
          <div className="text-sm">{c.telefono} {c.instagram && `· ${c.instagram}`}</div>
          <div className="text-sm mt-1">{o.direccion}</div>
          <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{o.barrio} · {o.zona}</div>
          {o.obs && <div className="text-xs mt-2 p-2 rounded-lg" style={{ background: T.vainilla }}>📝 {o.obs}</div>}
          {(o.campaignId || o.creativeId || o.origenDetalle) && (() => {
            const camp = db.campaigns.find((c) => c.id === o.campaignId);
            const cre = db.creatives.find((c) => c.id === o.creativeId);
            return (
              <div className="text-xs mt-2 p-2 rounded-lg" style={{ background: "#F3D7DC55" }}>
                📣 {[camp && "Campaña: " + camp.nombre, cre && "Creativo: " + cre.titulo, o.origenDetalle && "Origen: " + o.origenDetalle].filter(Boolean).join(" · ")}
              </div>
            );
          })()}
        </Card>
        <Card className="p-4">
          <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>PAGO</div>
          <div className="flex justify-between text-sm py-1"><span>Subtotal productos</span><b>{fmt(orderSubtotal(db, o))}</b></div>
          {o.descuento > 0 && <div className="flex justify-between text-sm py-1" style={{ color: "#3F6B42" }}><span>Beneficio {o.benefitId && `(${o.benefitId})`}</span><b>−{fmt(o.descuento)}</b></div>}
          <div className="flex justify-between text-sm py-1"><span>Domicilio cobrado</span><b>{fmt(o.domCobrado)}</b></div>
          <div className="flex justify-between text-sm py-1 items-center" style={{ color: T.choco2 }}>
            <span>Costo real domicilio</span>
            {o.canal === "Rappi" ? (
              <span className="text-xs font-bold" style={{ color: T.choco2 }}>$0 · Rappi app</span>
            ) : (
              <input type="number" value={o.domCosto || ""} placeholder="registrar"
                onChange={(e) => update((d) => { const x = d.orders.find((y) => y.id === o.id); x.domCosto = +e.target.value || 0; })}
                className="w-24 rounded-lg px-2 py-1 text-xs border text-right font-bold" style={inputStyle} />
            )}
          </div>
          <div className="flex justify-between py-2 mt-1 border-t display text-lg" style={{ borderColor: T.border }}><span>Total</span><b style={{ color: T.coral }}>{fmt(orderTotal(db, o))}</b></div>
          <div className="text-xs font-semibold">{o.pago} {o.canal === "Rappi" ? "· pago en la app" : comprobantePagoVinculado ? "· comprobante vinculado ✓" : "· sin comprobante"}</div>
        </Card>
      </div>

      {puedeGestionarRelevo && ["Listo para empaque", "Empacado", "Listo para despacho"].includes(o.estado) && (
        <div id={`packing-delivery-${o.id}`} className="mt-4 rounded-2xl border p-4" style={{ background: "#FFF9F1", borderColor: T.border }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: "#8E4B5A" }}>Relevo a domicilio</div>
              <div className="display text-lg font-semibold">Dirección lista para copiar o etiquetar</div>
              <div className="text-xs font-semibold mt-0.5" style={{ color: T.choco2 }}>{o.direccion || c.direccion || "Falta registrar dirección"} · {c.telefono || "sin teléfono"}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn small kind="ghost" disabled={!direccionParaCopiar} onClick={() => {
                if (copiarTexto(direccionParaCopiar)) toast("ok", `${o.id} · dirección copiada`);
                else setAviso({ titulo: "No se pudo copiar", texto: "Tu navegador bloqueó el portapapeles. Podés abrir la etiqueta y copiar los datos manualmente." });
              }}>📋 Copiar dirección</Btn>
              <Btn small kind="rosa" onClick={() => setEtiquetaDomicilio(true)}>🖨️ Imprimir etiqueta</Btn>
              {!domicilioActivo && o.canal !== "Rappi" && <Btn small onClick={() => setSolicitudDomicilio(true)}>🛵 Solicitar domicilio</Btn>}
            </div>
          </div>
          <div className="mt-2 text-[11px] font-bold" style={{ color: domicilioActivo ? "#3F6B42" : o.canal === "Rappi" ? "#96690F" : T.choco2 }}>
            {domicilioActivo ? `✓ Domicilio ${domicilioActivo.id} · ${domicilioActivo.proveedor} · ${domicilioActivo.estado}` : o.canal === "Rappi" ? "Rappi gestiona este domicilio desde su aplicación." : "Todavía no hay un domicilio solicitado para esta orden."}
          </div>
        </div>
      )}

      {["Listo para empaque", "Empacado", "Listo para despacho"].includes(o.estado) && (
        <div id={`packing-checklist-${o.id}`} className="mt-4 rounded-2xl border p-4" style={{ background: packingVerification ? "#F2F8F0" : T.soft, borderColor: packingVerification ? "#A7C9A4" : T.border }}>
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: packingVerification ? "#3F6B42" : "#A54830" }}>Control de coincidencia</div>
              <div className="display text-lg font-semibold">Orden solicitada vs. contenido recibido</div>
              <div className="text-xs font-semibold mt-0.5" style={{ color: T.choco2 }}>Marcá cada línea únicamente después de verla físicamente en la mesa de Empaque.</div>
            </div>
            <span className="rounded-full px-3 py-1.5 text-[10px] font-extrabold" style={{ background: packingVerification ? "#DDEBD9" : T.vainilla, color: packingVerification ? "#3F6B42" : "#96690F" }}>
              {packingVerification ? "✓ Verificación registrada" : `${checkedPackingLines.size}/${packingLines.length} líneas`}
            </span>
          </div>
          <div className="space-y-2">
            {packingLines.map((line) => (
              <label key={line.id} className="flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer" style={{ background: checkedPackingLines.has(line.id) ? "#fff" : T.vainilla, borderColor: checkedPackingLines.has(line.id) ? "#A7C9A4" : T.border }}>
                <input type="checkbox" className="mt-1 accent-[#E5714E]" checked={checkedPackingLines.has(line.id)} disabled={Boolean(packingVerification)} onChange={(event) => {
                  setCheckedPackingLines((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(line.id); else next.delete(line.id);
                    return next;
                  });
                }} />
                <span className="min-w-0">
                  <span className="block text-sm font-extrabold">{line.parentItemId ? "↳ " : ""}{line.label}</span>
                  {line.detail && <span className="block text-[11px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{line.detail}</span>}
                </span>
              </label>
            ))}
          </div>
          {packingVerification ? (
            <div className="text-xs font-bold mt-3" style={{ color: "#3F6B42" }}>✓ {packingVerification.user || "Empaque"} confirmó {packingVerification.lineIds?.length || packingLines.length} líneas · {packingVerification.verifiedAt}</div>
          ) : (
            <div className="mt-3">
              <Btn disabled={!packingChecklistComplete || verificandoEmpaque} onClick={confirmarChecklistEmpaque}>{verificandoEmpaque ? "Registrando verificación…" : "Confirmar que todo coincide"}</Btn>
              {!packingChecklistComplete && <div className="text-[10px] font-bold mt-1.5" style={{ color: "#96690F" }}>Faltan {Math.max(0, packingLines.length - checkedPackingLines.size)} línea(s) por comparar.</div>}
            </div>
          )}
        </div>
      )}

      <div id={`packing-content-${o.id}`} className="mt-4">
        <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>CONTENIDO DEL PEDIDO</div>
        {itemsOf(db, o.id).filter((i) => !i.parentItemId).map((i) => {
          const p = productOf(db, i.productId);
          const presentation = orderLinePresentationForOrders(i, p);
          const disp = p ? availability(db, p) : Infinity;
          const sinStock = p && !["Pagado","En producción","Listo para empaque","Empacado","Listo para despacho","En ruta","Entregado"].includes(o.estado) && disp < i.cant;
          const hijas = itemsOf(db, o.id).filter((h) => h.parentItemId === i.id);
          return (
            <Card key={i.id} className="p-3 mb-2">
              <div className="flex justify-between gap-2">
                <div className="text-sm font-bold">{presentation.quantityLabel}</div>
                <div className="text-sm font-bold">{fmt(i.precio * i.cant + lineAdicionesTotal(i) + hijas.reduce((s, h) => s + lineAdicionesTotal(h), 0))}</div>
              </div>
              <div className="text-xs mt-0.5" style={{ color: T.choco2 }}>
                {presentation.secondary}
              </div>
              {lineAdiciones(i).length > 0 && (
                <div className="text-xs font-bold mt-1" style={{ color: T.coral }}>
                  🍫 {lineAdiciones(i).map((ad) => ad.nombre + ((ad.cant || 1) > 1 ? ` ×${ad.cant}` : "") + (+ad.precio > 0 ? " (+" + fmt(ad.precio * (ad.cant || 1)) + ")" : " · gratis")).join("  ·  ")}
                </div>
              )}
              {hijas.length > 0 && (() => {
                const cajas = {};
                hijas.forEach((h) => { const n = h.cajaNum || 1; (cajas[n] = cajas[n] || []).push(h); });
                const nums = Object.keys(cajas).map(Number).sort((a, b) => a - b);
                const multi = nums.length > 1;
                return (
                  <div className="mt-2 pl-3 border-l-2" style={{ borderColor: T.rosa }}>
                    <div className="text-[10px] font-bold mb-1" style={{ color: T.choco2 }}>COMPOSICIÓN {multi ? `(${nums.length} cajas) ` : "DE LA CAJA "}(para la cocina)</div>
                    {nums.map((n) => (
                      <div key={n} className={multi ? "mb-1" : ""}>
                        {multi && <div className="text-[10px] font-bold" style={{ color: T.coral }}>Caja {n}</div>}
                        {cajas[n].map((h) => {
                          const childPresentation = orderLinePresentationForOrders(h, productOf(db, h.productId));
                          const comboSlotCompatibility = validateOrderComboSlotFigure(p, h.figura);
                          const childCompatibilityError = childPresentation.figureCompatibilityError
                            || (!comboSlotCompatibility.valid ? comboSlotCompatibility.message : "");
                          return (
                            <div key={h.id} className="text-xs mb-0.5" style={{ color: T.choco2 }}>
                              <span className="font-bold">🐾 {h.figura}</span>{[h.sabor && ` · ${h.sabor}`, h.salsa && ` · ${h.salsa}`, h.cant > 1 && ` · ×${h.cant}`].filter(Boolean).join("")}
                              {lineAdiciones(h).length > 0 && <span className="font-bold" style={{ color: T.coral }}>  ·  🍫 {lineAdiciones(h).map((ad) => ad.nombre + (+ad.precio > 0 ? " (+" + fmt(ad.precio) + ")" : "")).join(", ")}</span>}
                              {childCompatibilityError && <span className="block font-bold" style={{ color: "#8E4B5A" }}>⚠ {childCompatibilityError}</span>}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {sinStock && <div className="text-xs font-bold mt-1" style={{ color: "#A03B2A" }}>⚠️ Disponibilidad actual: {disp}. Al pagar se reservará lo posible y se sugerirá producción del resto.</div>}
            </Card>
          );
        })}
      </div>

      {(() => {
        /* Variantes 1b: rastro del FIFO — de qué lote físico (desmolde) salió
           cada unidad al pagar. Solo reservas tipo 'producto'; 'Liberada'
           (cancelación) no se muestra porque esa unidad volvió al lote. */
        const rvs = (db.inventory_reservations || []).filter((r) => r.orderId === o.id && r.tipo === "producto" && r.estado !== "Liberada");
        if (!rvs.length) return null;
        const conLote = rvs.filter((r) => r.batchId);
        const sinLote = rvs.filter((r) => !r.batchId);
        return (
          <div className="mt-4">
            <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>📦 LOTES ASIGNADOS (FIFO al pagar)</div>
            <Card className="p-3">
              {conLote.map((r) => (
                <div key={r.id} className="flex justify-between gap-2 text-xs py-0.5">
                  <span className="font-bold">{r.cantidad}× {r.nombre}</span>
                  <span className="font-semibold shrink-0" style={{ color: r.estado === "Consumida" ? T.choco2 : "#3F6B42" }}>{r.estado === "Consumida" ? "consumida ✓" : "reservada"}</span>
                </div>
              ))}
              {sinLote.map((r) => (
                <div key={r.id} className="flex justify-between gap-2 text-xs py-0.5" style={{ color: "#8E4B5A" }}>
                  <span className="font-bold">{r.cantidad}× {r.nombre}</span>
                  <span className="font-semibold shrink-0">{r.estado === "Consumida" ? "sin lote (pre-variantes o a pedido) ✓" : "a producir · sin lote"}</span>
                </div>
              ))}
            </Card>
          </div>
        );
      })()}

      <div id={`packing-evidence-${o.id}`} className="mt-4">
        <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>EVIDENCIAS ({evs.length})</div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
          {evs.map((e) => (
            <button key={e.id} onClick={() => abrirEvidencia(e)} disabled={abriendoEvidenciaId === e.id || (!e.url && !e.storagePath)} className="rounded-xl overflow-hidden border text-left" style={{ borderColor: T.border, background: T.vainilla }}>
              {e.url ? <img src={e.url} alt={e.tipo} className="w-full h-20 object-cover" /> :
                <div className="w-full h-20 flex flex-col items-center justify-center text-2xl" aria-hidden="true">📷<span className="text-[9px] font-bold mt-1">{abriendoEvidenciaId === e.id ? "Abriendo…" : "Abrir foto"}</span></div>}
              <div className="px-2 py-1">
                <div className="text-[10px] font-bold leading-tight">{e.tipo}</div>
                <div className="text-[9px]" style={{ color: T.choco2 }}>{e.hora} · {e.user}</div>
              </div>
            </button>
          ))}
        </div>
        {/* Evidencias guiadas por paso: cada objetivo alcanzable pide su(s) foto(s) con tipo YA FIJO */}
        {(() => {
          const objetivos = [];
          const objetivoPrincipal = accionRecepcion?.target || siguiente;
          if (objetivoPrincipal) objetivos.push(objetivoPrincipal);
          const puedePagar = !comprobantePagoVinculado && (o.estado === "Pendiente de pago" || accionRecepcion?.target === "Pagado");
          if (puedePagar && !objetivos.includes("Pagado")) objetivos.push("Pagado");
          const reqs = objetivos.flatMap((estadoObjetivo) => reqFotosPaso(o, estadoObjetivo).map((req) => ({
            ...req,
            estadoObjetivo,
            permiso: orderTransitionPermission(perfil, o.estado, estadoObjetivo),
          })));
          if (!reqs.length) return null;
          return (
            <div className="rounded-xl p-3 mb-3" style={{ background: T.vainilla, border: `1px solid ${T.border}` }}>
              <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>📸 Fotos necesarias para avanzar (obligatorias)</div>
              {reqs.map((req) => {
                const hecho = req.tipos.some((t) => tieneEvidencia(db, o.id, t));
                const evidenciaEnAccionPrincipal = accionRecepcion?.type === "evidence" && req.tipos.includes("Comprobante de pago");
                return (
                  <div key={`${req.estadoObjetivo}-${req.label}`} className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="text-sm font-semibold" style={{ color: hecho ? "#3F6B42" : "#A03B2A" }}>
                      {hecho ? "✓" : "○"} {req.label} <span className="text-[10px]">· para {req.estadoObjetivo}</span>
                    </span>
                    {!hecho && req.permiso.allowed && !evidenciaEnAccionPrincipal && req.tipos.map((t) => (
                      <Btn key={t} small kind="rosa" disabled={subiendo} onClick={() => abrirCamara(t)}>
                        {subiendo ? "Procesando…" : `📷 ${req.tipos.length > 1 ? t : "Tomar foto"}`}
                      </Btn>
                    ))}
                    {!hecho && req.permiso.allowed && evidenciaEnAccionPrincipal && <span className="text-[10px] font-bold" style={{ color: "#96690F" }}>Usá la acción principal inferior</span>}
                    {!hecho && !req.permiso.allowed && <span className="text-[10px] font-bold" style={{ color: "#96690F" }}>La sube {req.permiso.ownerLabel}</span>}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {siguiente === "En ruta" &&
          <div className="text-xs font-bold mb-2" style={{ color: "#A03B2A" }}>Para pasar a “En ruta” además: pago confirmado, domicilio asignado y costo real registrado (salvo Rappi). El sello ya se capturó en Empacado.</div>}

        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
        {tiposEvidenciaPermitidos.length > 0 && !accionRecepcion && <button type="button" onClick={() => {
          if (!libre) setTipoEv(tiposEvidenciaPermitidos.includes(tipoEv) ? tipoEv : tiposEvidenciaPermitidos[0]);
          setLibre((v) => !v);
        }} className="text-xs font-bold underline" style={{ color: T.choco2 }}>
          {libre ? "− ocultar" : "＋ otra foto permitida para mi área"}
        </button>}
        {libre && tiposEvidenciaPermitidos.length > 0 && !accionRecepcion && (
          <div className="flex flex-wrap gap-2 items-center mt-2">
            <MiniSelect options={tiposEvidenciaPermitidos} value={tipoEv} onChange={(e) => setTipoEv(e.target.value)} />
            <Btn small kind="rosa" disabled={subiendo} onClick={() => abrirCamara(tipoEv)}>
              {subiendo ? "Procesando…" : "📷 Subir foto"}
            </Btn>
          </div>
        )}
        <div className="text-[11px] font-semibold mt-2" style={{ color: "#96690F" }}>
          🔒 Las fotos se guardan en Supabase Storage y quedan vinculadas al pedido con usuario, fecha y tipo de evidencia.
        </div>
      </div>

      <div id={`packing-actions-${o.id}`} className="mt-5 flex flex-wrap gap-2 sticky bottom-0 py-3" style={{ background: T.bg }}>
        {contextActions}
        {accionRecepcion?.type === "transition" && accionRecepcion.allowed && <Btn disabled={enviando} onClick={async () => { setEnviando(true); await cambiar(o.id, accionRecepcion.target); setEnviando(false); }}>{accionRecepcion.label}</Btn>}
        {accionRecepcion?.type === "evidence" && accionRecepcion.allowed && <Btn disabled={enviando || subiendo} onClick={() => abrirCamara("Comprobante de pago")}>{subiendo ? "Procesando comprobante…" : accionRecepcion.label}</Btn>}
        {accionRecepcion?.type === "wait" && <Btn disabled>{accionRecepcion.label}</Btn>}
        {!accionRecepcion && siguiente && permisoSiguiente.allowed && (siguiente !== "Empacado" || packingVerification) && <Btn disabled={enviando} onClick={async () => { setEnviando(true); await cambiar(o.id, siguiente); setEnviando(false); }}>Confirmar “{siguiente}” · {permisoSiguiente.ownerLabel}</Btn>}
        {!accionRecepcion && siguiente === "Empacado" && permisoSiguiente.allowed && !packingVerification && <Btn disabled>Primero verificá la comanda completa</Btn>}
        {hayAccionesSecundarias && <button type="button" className="text-xs font-extrabold px-3 py-2 rounded-xl border" style={{ color: T.choco2, borderColor: T.border, background: T.surface }} onClick={() => setVerMasAcciones((current) => !current)}>{verMasAcciones ? "Ocultar opciones" : "Más opciones"}</button>}
        {verMasAcciones && hayAccionesSecundarias && <div className="basis-full flex flex-wrap gap-2 rounded-2xl border p-3" style={{ background: T.soft, borderColor: T.border }}>
        {puedeCorregirPago && <Btn kind="soft" disabled={enviando} onClick={async () => { setEnviando(true); await cambiar(o.id, "Pagado"); setEnviando(false); }}>Corregir pago faltante</Btn>}
        {puedeEntregaRapida && <Btn kind="soft" disabled={enviando} onClick={async () => { setEnviando(true); await cambiar(o.id, "Entregado", { ventaRapida: true }); setEnviando(false); }}>⚡ Entrega inmediata</Btn>}
        {puedeCrearReclamo && (
          <Btn kind="danger" disabled={enviando} onClick={async () => {
            setEnviando(true);
            // Fase 3: crear_reclamo ya transiciona el pedido a 'Reclamo' y audita server-side (no llamar setOrderStatusRemoto aparte).
            try {
              await crearReclamo(o.id, "Reclamo por calidad", "Reclamo creado desde el pedido. Completar detalle.");
            } catch (e) {
              setAviso({ titulo: "Acción no permitida", texto: e.message });
              setEnviando(false);
              return;
            }
            try {
              await sincronizarPedido(o.id);
            } catch (e) {
              setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: "El reclamo se creó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo." });
              setEnviando(false);
              return;
            }
            setAviso({ titulo: "Reclamo creado", texto: `Se abrió un caso conectado al pedido ${o.id}. Complétalo en el módulo Reclamos.` });
            setEnviando(false);
          }}>Crear reclamo</Btn>
        )}
        {puedeCancelarPedido && <BtnAsync kind="ghost" confirmar="¿Cancelar el pedido? Tocá de nuevo" textoEnVuelo="Cancelando…" disabled={enviando} onClick={async () => { setEnviando(true); try { await cambiar(o.id, "Cancelado"); } finally { setEnviando(false); } }}>Cancelar pedido</BtnAsync>}
        </div>}
      </div>

      {foto && (
        <Modal title={foto.tipo} onClose={() => setFoto(null)}>
          <img src={foto.url} alt={foto.tipo} className="w-full rounded-2xl" />
          <div className="text-xs font-semibold mt-2" style={{ color: T.choco2 }}>{foto.fecha} {foto.hora} · subida por {foto.user}</div>
        </Modal>
      )}


      {etiquetaDomicilio && (
        <Modal title={`Etiqueta de entrega · ${o.id}`} onClose={() => setEtiquetaDomicilio(false)}>
          <div className="momo-shipping-label rounded-2xl border p-5" style={{ borderColor: T.choco, background: "#fff" }}>
            <div className="flex justify-between items-start gap-4 border-b pb-3 mb-3" style={{ borderColor: T.border }}>
              <div><div className="text-[10px] uppercase tracking-[.18em] font-extrabold">D'MOMOS SWEET LOVE</div><div className="display text-2xl font-bold">Pedido {o.id}</div></div>
              <div className="text-2xl" aria-hidden="true">🐱</div>
            </div>
            <div className="text-lg font-extrabold">{c.nombre || "Cliente"}</div>
            <div className="text-base font-bold mt-1">Tel. {c.telefono || "Sin teléfono"}</div>
            <div className="text-base font-extrabold mt-4">📍 {o.direccion || c.direccion || "Sin dirección"}</div>
            <div className="text-sm font-bold mt-1">{o.barrio || c.barrio || "Sin barrio"} · {o.zona || "Sin zona"}</div>
            <div className="mt-4 rounded-lg border p-3 text-sm font-bold" style={{ borderColor: T.border }}><span className="text-[10px] uppercase block mb-1">Apto / casa / local y referencia</span>{o.obs || "Sin referencia adicional"}</div>
            <div className="text-[10px] font-bold mt-3">Verificá nombre, teléfono y dirección antes de pegar esta etiqueta.</div>
          </div>
          <div className="momo-no-print flex gap-2 mt-4"><Btn onClick={() => window.print()}>Imprimir</Btn><Btn kind="ghost" onClick={() => setEtiquetaDomicilio(false)}>Cerrar</Btn></div>
        </Modal>
      )}

      {solicitudDomicilio && !domicilioActivo && (
        <Modal title={`Solicitar domicilio · ${o.id}`} onClose={() => setSolicitudDomicilio(false)}>
          <div className="rounded-xl p-3 mb-3 text-xs font-bold whitespace-pre-line" style={{ background: T.vainilla }}>{textoDomicilio}</div>
          <Field label="Proveedor"><Select options={db.settings.proveedores} value={formDomicilio.proveedor} onChange={(event) => setFormDomicilio({ ...formDomicilio, proveedor: event.target.value })} /></Field>
          <Field label="Zona"><Select options={db.settings.zonas.map((zona) => zona.nombre)} value={formDomicilio.zona} onChange={(event) => setFormDomicilio({ ...formDomicilio, zona: event.target.value })} /></Field>
          <Field label="Costo real cotizado"><Input type="number" min="0" value={formDomicilio.costoReal} onChange={(event) => setFormDomicilio({ ...formDomicilio, costoReal: event.target.value })} /></Field>
          <Field label="Apto, casa, local o referencia"><Input value={formDomicilio.obs} onChange={(event) => setFormDomicilio({ ...formDomicilio, obs: event.target.value })} placeholder="Torre, apartamento, portería o indicaciones" /></Field>
          <div className="flex gap-2 mt-3"><Btn disabled={creandoDomicilio || !formDomicilio.proveedor || !formDomicilio.zona} onClick={solicitarDomicilioDesdePedido}>{creandoDomicilio ? "Solicitando…" : "Confirmar solicitud"}</Btn><Btn kind="ghost" onClick={() => setSolicitudDomicilio(false)}>Cancelar</Btn></div>
        </Modal>
      )}
    </Modal>
  );
}

function NuevoPedido({ db, update, user, onClose, setAviso, sincronizarPedido }) {
  const s = db.settings;
  const idemKeyRef = useRef("ui-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36)); // 1 por apertura del form: tolera retries de red
  const enviandoRef = useRef(false);
  const [enviando, setEnviando] = useState(false); // espejo de enviandoRef solo para feedback visual (disabled); el ref sigue siendo el guard real
  const [customerId, setCustomerId] = useState("");
  const [nc, setNc] = useState({ nombre: "", telefono: "", barrio: "" });
  const [canal, setCanal] = useState("WhatsApp");
  const [zona, setZona] = useState(s.zonas[0].nombre);
  const [direccion, setDireccion] = useState("");
  const [pago, setPago] = useState("Nequi");
  const [obs, setObs] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [creativeId, setCreativeId] = useState("");
  const [origenDetalle, setOrigenDetalle] = useState("");
  const [origenSimple, setOrigenSimple] = useState("");
  const [verAvanzado, setVerAvanzado] = useState(false);
  const [items, setItems] = useState([{ catalogKey: "", productId: "", sabor: "", salsa: "", relleno: "", figura: "", cant: 1, adiciones: [], boxes: [] }]);
  const [error, setError] = useState("");

  const pagosDisponibles = canal === "Rappi" ? ["Rappi (app)"] : s.pagos.filter((p) => p !== "Rappi (app)");
  const sabores = [...s.saboresFrutales, ...s.saboresCremosos];
  const c = db.customers.find((x) => x.id === customerId);
  const benef = c && db.benefits.find((b) => b.customerId === c.id && b.estado === "Activo" && b.vence >= hoyISO());
  const today = hoyISO();
  const availabilityVariants = useMemo(() => canonicalVariantsForAvailability(db, { today }), [
    today, db.products, db.variantes, db.variantesCuarentena, db.inventory_reservations,
    db.production_batches, db.figuras, db.settings?.figuras,
  ]);
  const canonicalAvailabilityDb = useMemo(() => ({ ...db, variantes: availabilityVariants }), [db, availabilityVariants]);
  const tarifaZona = (s.zonas.find((z) => z.nombre === zona) || {}).tarifa || 0;
  const tarifa = canal === "Rappi" ? 0 : tarifaZona;
  const orderCatalog = useMemo(
    () => buildOrderCatalogChoices(db),
    [db.products, db.figuras, db.settings?.figuras],
  );
  const orderCatalogGroups = useMemo(
    () => groupOrderCatalogChoices(orderCatalog.all),
    [orderCatalog],
  );

  const lineas = items.map((it) => {
    const p = productOf(db, it.productId);
    // Combos: faltante por presentación comercial según cada postre exacto de la caja.
    const faltantesFamilia = p && p.tipo === "combo" ? comboFaltantesFamilia(db, p, it.boxes) : [];
    const disponibilidadExacta = p && isCommercialFamilyProduct(p) ? evaluateExactVariantDemand({
      productId: p.id, productName: p.nombre, figure: it.figura, flavor: it.sabor,
      quantity: it.cant, variants: availabilityVariants, today,
    }) : null;
    const disponibilidadCaja = p && p.tipo === "combo" ? evaluateComboVariantAvailability({ db: canonicalAvailabilityDb, combo: p, boxes: it.boxes, today }) : null;
    const faltantesExactos = disponibilidadCaja?.shortages || (disponibilidadExacta?.complete && disponibilidadExacta.missing > 0 ? [disponibilidadExacta] : []);
    return { ...it, nombre: p ? p.nombre : "", precio: p ? (canal === "Rappi" ? p.precioRappi : p.precio) : 0, disp: p ? availability(db, p) : Infinity, tipo: p ? p.tipo : "", faltantesFamilia, disponibilidadExacta, disponibilidadCaja, faltantesExactos };
  });
  const subtotal = lineas.reduce((sm, l) => sm + l.precio * l.cant + lineAdicionesTotal(l) + boxesAdicionesTotal(l), 0);

  // Aplicación del beneficio según su tipo (solo si cumple compra mínima)
  const benefAplica = benef && subtotal >= benef.minimo;
  let descuento = 0;
  let productoGratis = null;
  if (benefAplica) {
    if (benef.tipoBeneficio === "descuento_porcentaje") descuento = Math.round(subtotal * (benef.valor / 100));
    else if (benef.tipoBeneficio === "descuento_valor_fijo") descuento = Math.min(benef.valor, subtotal);
    else if (benef.tipoBeneficio === "producto_gratis") productoGratis = productOf(db, benef.productoGratisId);
  }
  const total = subtotal - descuento + tarifa;
  const faltaStock = lineas.filter((l) => l.productId && (l.disp < l.cant || (l.faltantesFamilia && l.faltantesFamilia.length > 0) || (l.faltantesExactos && l.faltantesExactos.length > 0)));

  const setItem = (i, campo, valor) => setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, [campo]: valor } : x));
  // Combos con composición POR CAJA: boxes = Array(cant) de Array(comboSize) de {figura,sabor,salsa}.
  const setSlot = (i, boxIdx, slotIdx, campo, valor) => setItems((prev) => prev.map((x, idx) =>
    idx === i ? { ...x, boxes: (x.boxes || []).map((box, bi) => bi === boxIdx ? box.map((sl, si) => si === slotIdx ? { ...sl, [campo]: valor } : sl) : box) } : x));
  const setFigure = (i, product, value) => {
    const result = applyOrderFigureEdit(items[i], product, value);
    if (!result.ok) { setError(result.error.message); return; }
    setError("");
    setItems((prev) => prev.map((item, index) => index === i ? result.item : item));
  };
  const setSlotFigure = (i, boxIdx, slotIdx, combo, value) => {
    const current = items[i]?.boxes?.[boxIdx]?.[slotIdx] || {};
    const result = applyOrderComboFigureEdit(current, combo, value);
    if (!result.ok) { setError(result.error.message); return; }
    setError("");
    setItems((prev) => prev.map((item, index) => index !== i ? item : {
      ...item,
      boxes: (item.boxes || []).map((box, currentBox) => currentBox !== boxIdx ? box : box.map((slot, currentSlot) => currentSlot === slotIdx ? result.slot : slot)),
    }));
  };
  // "= mismos momos": copia el slot 0 al resto de esa caja.
  const mismosMomos = (i, boxIdx) => setItems((prev) => prev.map((x, idx) => {
    if (idx !== i) return x;
    return { ...x, boxes: (x.boxes || []).map((box, bi) => bi === boxIdx && box.length ? box.map(() => ({ ...box[0], adiciones: [...(box[0].adiciones || [])] })) : box) };
  }));
  // "Caja 1 → todas": replica la composición de la caja 1 a todas las cajas de la línea.
  const copiarCaja1ATodas = (i) => setItems((prev) => prev.map((x, idx) => {
    if (idx !== i || !(x.boxes || []).length) return x;
    const first = x.boxes[0];
    return { ...x, boxes: x.boxes.map(() => first.map((sl) => ({ ...sl, adiciones: [...(sl.adiciones || [])] }))) };
  }));
  // Cambiar la cantidad de una línea. Para combos, redimensiona `boxes` conservando lo ya compuesto.
  const setCant = (i, prod, nc) => setItems((prev) => prev.map((x, idx) => {
    if (idx !== i) return x;
    const n = Math.max(1, Math.floor(nc) || 1); // cajas/unidades enteras: mantiene boxes.length === cant
    if (prod && prod.tipo === "combo") {
      const size = prod.comboSize || 0;
      const cur = x.boxes || [];
      const boxes = Array.from({ length: n }, (_, b) => cur[b] || Array.from({ length: size }, () => ({ figura: "", sabor: "", salsa: "", adiciones: [] })));
      return { ...x, cant: n, boxes };
    }
    return { ...x, cant: n };
  }));
  const toggleAdicion = (i, top) => setItems((prev) => prev.map((x, idx) => {
    if (idx !== i) return x;
    const cur = Array.isArray(x.adiciones) ? x.adiciones : [];
    const has = cur.some((a) => a.nombre === top.nombre);
    return { ...x, adiciones: has
      ? cur.filter((a) => a.nombre !== top.nombre)
      : [...cur, { nombre: top.nombre, precio: +top.precio || 0, cant: 1, insumoId: top.insumoId || "", insumoCant: +top.insumoCant || 1 }] };
  }));
  // Toppings POR SUB-MOMO: cada slot de la caja lleva sus propias adiciones (mismo shape que la línea).
  const toggleSlotAdicion = (i, boxIdx, slotIdx, top) => setItems((prev) => prev.map((x, idx) => {
    if (idx !== i) return x;
    return { ...x, boxes: (x.boxes || []).map((box, bi) => bi !== boxIdx ? box : box.map((sl, si) => {
      if (si !== slotIdx) return sl;
      const cur = Array.isArray(sl.adiciones) ? sl.adiciones : [];
      const has = cur.some((a) => a.nombre === top.nombre);
      return { ...sl, adiciones: has
        ? cur.filter((a) => a.nombre !== top.nombre)
        : [...cur, { nombre: top.nombre, precio: +top.precio || 0, cant: 1, insumoId: top.insumoId || "", insumoCant: +top.insumoCant || 1 }] };
    })) };
  }));

  const agregarLinea = () => setItems((prev) => [...prev, { catalogKey: "", productId: "", sabor: "", salsa: "", relleno: "", figura: "", cant: 1, adiciones: [], boxes: [] }]);
  const quitarLinea = (index) => setItems((prev) => prev.filter((_, current) => current !== index));

  async function guardar() {
    if (!customerId && (!nc.nombre || !nc.telefono)) { setError("Selecciona un cliente o registra nombre y teléfono."); return; }
    if (!lineas.some((l) => l.productId)) { setError("Agrega al menos una línea al pedido."); return; }
    if (subtotal < s.pedidoMinimo) { setError(`El pedido mínimo es ${fmt(s.pedidoMinimo)} (sin domicilio).`); return; }
    const incompatibilidad = lineas.flatMap((line) => (
      orderLineFigureCompatibilityErrors(line, productOf(db, line.productId))
    ))[0];
    if (incompatibilidad) { setError(`No se puede guardar: ${incompatibilidad.message}`); return; }
    const postresIncompletos = lineas.filter((line) => {
      const product = productOf(db, line.productId);
      return product && isCommercialFamilyProduct(product) && (!isKitchenFigureName(line.figura) || !line.sabor);
    });
    if (postresIncompletos.length) { setError("Elegí el postre exacto y su sabor. La familia comercial se asigna automáticamente."); return; }
    const combosIncompletos = lineas.filter((l) => l.productId && l.tipo === "combo")
      .filter((l) => !(l.boxes || []).length || (l.boxes || []).some((box) => !box.length || box.some((sl) => !sl.figura || !sl.sabor || !sl.salsa)));
    if (combosIncompletos.length) { setError("Completá postre, sabor y salsa en cada espacio de la caja."); return; }
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError("");
    // Fase 3: el pedido nace en el SERVER. crear_pedido calcula precios, snapshotea costos,
    // crea el cliente nuevo, arma padre+hijas de combos, reserva el beneficio y el delivery Rappi.
    const mapAdic = (ads) => (ads || []).map((a) => ({ nombre: a.nombre, precio: +a.precio || 0, cant: +a.cant || 1, insumo_id: a.insumoId || null, insumo_cant: +a.insumoCant || 0 }));
    const payload = {
      customer_id: customerId || null,
      nuevo_cliente: customerId ? null : { nombre: nc.nombre.trim(), telefono: nc.telefono.trim(), barrio: nc.barrio || "", direccion, canal },
      canal, zona: zona || null, barrio: (c && c.barrio) || nc.barrio || "", direccion, pago,
      obs, benefit_id: benefAplica && benef ? benef.id : null,
      campaign_id: campaignId || null, creative_id: creativeId || null, origen_detalle: origenDetalle || "",
      idempotency_key: idemKeyRef.current,
      lineas: items.filter((l) => l.productId).map((l) => {
        const p = productOf(db, l.productId);
        const clean = sanitizeOrderLineFigureFields(l, p);
        const base = { product_id: clean.productId, cant: clean.cant, sabor: clean.sabor || "", salsa: clean.salsa || "", figura: clean.figura, adiciones: mapAdic(clean.adiciones) };
        if (p && p.tipo === "combo") base.boxes = clean.boxes.map((box) => box.map((sl) => ({ figura: sl.figura, sabor: sl.sabor, salsa: sl.salsa, adiciones: mapAdic(sl.adiciones) })));
        return base;
      }),
    };
    let res;
    try {
      res = await crearPedido(payload);
    } catch (e) {
      setError(e.message);
      enviandoRef.current = false;
      setEnviando(false);
      return;
    }
    onClose();
    toast("ok", `Pedido ${res.order_id} creado`);
    try {
      await sincronizarPedido(res.order_id);
      if (faltaStock.length) setAviso({ titulo: "Pedido creado con alerta", texto: `${res.order_id} creado. Ojo: disponibilidad insuficiente en ${faltaStock.map((l) => l.nombre).join(", ")}. Al marcar pagado se creará la sugerencia de producción.` });
    } catch (e) {
      setAviso({ titulo: "Acción aplicada, vista desactualizada", texto: `${res.order_id} se creó correctamente, pero no se pudo actualizar la vista. Recargá la página para verlo.` });
    }
    enviandoRef.current = false;
    setEnviando(false);
  }

  return (
    <Modal title="Nuevo pedido" onClose={onClose} wide>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Cliente existente">
          <select value={customerId} onChange={(e) => {
            const id = e.target.value;
            setCustomerId(id);
            const cli = db.customers.find((x) => x.id === id);
            if (cli) {
              if (cli.direccion) setDireccion(cli.direccion);
              const z = sugerirZona(s.zonas, cli.barrio);
              if (z) setZona(z);
            } else {
              // volvió a "Cliente nuevo": limpiar datos, mantener canal y pago
              setDireccion("");
              setNc({ nombre: "", telefono: "", barrio: "" });
              setZona(s.zonas[0].nombre);
            }
          }} className={inputCls} style={inputStyle}>
            <option value="">— Cliente nuevo —</option>
            {db.customers.map((x) => <option key={x.id} value={x.id}>{x.nombre} · {x.telefono}</option>)}
          </select>
        </Field>
        <Field label="Canal"><Select options={CANALES} value={canal} onChange={(e) => {
          const nuevoCanal = e.target.value;
          setCanal(nuevoCanal);
          setPago(nuevoCanal === "Rappi" ? "Rappi (app)" : "Nequi");
        }} /></Field>
        {!customerId && (<>
          <Field label="Nombre del cliente"><Input value={nc.nombre} onChange={(e) => setNc({ ...nc, nombre: e.target.value })} placeholder="Nombre y apellido" /></Field>
          <Field label="Teléfono / WhatsApp"><Input value={nc.telefono} onChange={(e) => setNc({ ...nc, telefono: e.target.value })} placeholder="3XX XXX XXXX" /></Field>
          <Field label="Barrio"><Input value={nc.barrio} onChange={(e) => setNc({ ...nc, barrio: e.target.value })} placeholder="El Caney, El Ingenio…" /></Field>
        </>)}
        <Field label="Dirección de entrega"><Input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección completa" /></Field>
        <Field label="Zona de domicilio"><Select options={s.zonas.map((z) => z.nombre)} value={zona} onChange={(e) => setZona(e.target.value)} /></Field>
        <Field label="Forma de pago"><Select options={pagosDisponibles} value={pago} onChange={(e) => setPago(e.target.value)} /></Field>
      </div>

      {benef && (
        <div className="text-xs font-bold p-2.5 rounded-xl mb-3" style={{ background: "#DDEBD9", color: "#3F6B42" }}>
          🎁 {c.nombre} tiene beneficio activo: {benef.beneficio} ({benef.condicion}). Mínimo {fmt(benef.minimo)}.
          {benefAplica
            ? (productoGratis ? ` Se agregará 1 ${productoGratis.nombre} gratis y el beneficio quedará Reservado hasta confirmar el pago.` : " Se aplicará el descuento y el beneficio quedará Reservado hasta confirmar el pago.")
            : " Aún no cumple la compra mínima."}
        </div>
      )}

      {canal === "Rappi" && (
        <div className="text-xs font-semibold mb-3 p-2.5 rounded-xl" style={{ background: T.coralSoft, color: "#A34A2A" }}>
          🛵 Rappi gestiona el domicilio y el pago dentro de su app. MOMOS no cobra domicilio adicional en este pedido.
        </div>
      )}

      <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>QUÉ VA EN EL PEDIDO</div>
      {orderCatalog.invalidFigureLinks.length > 0 && (
        <div className="text-xs font-bold mb-2 p-2.5 rounded-xl" style={{ color: "#8E4B5A", background: "#F3D7DC" }}>
          ⚠️ Hay figuras con una familia incorrecta y no se ofrecerán: {orderCatalog.invalidFigureLinks.map((issue) => issue.message).join(" · ")}
        </div>
      )}
      {items.map((it, i) => {
        const l = lineas[i];
        const pSel = productOf(db, it.productId);
        const attrs = orderProductAttributes(pSel);
        const compatibilityErrors = orderLineFigureCompatibilityErrors(it, pSel);
        const selectedCatalogChoice = orderCatalog.all.find((choice) => choice.key === it.catalogKey)
          || orderCatalog.all.find((choice) => choice.productId === it.productId && (choice.kind !== "figure" || choice.figure === it.figura));
        const selectedExactFigure = selectedCatalogChoice?.kind === "figure";
        return (
          <Card key={i} className="p-3 mb-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="col-span-2 sm:col-span-3">
                <div className="text-[10px] uppercase tracking-wider font-extrabold mb-1" style={{ color: T.choco2 }}>Postre, caja o elaboración del pedido</div>
                <select
                  aria-label="Postre, caja o elaboración del pedido"
                  className={inputCls}
                  style={inputStyle}
                  value={selectedCatalogChoice?.key || ""}
                  onChange={(event) => {
                    const choice = orderCatalog.all.find((entry) => entry.key === event.target.value);
                    setItems((prev) => prev.map((x, idx) => idx === i ? applyOrderCatalogChoice(x, choice) : x));
                  }}
                >
                  <option value="">Elegir postre, caja o elaboración…</option>
                  {orderCatalogGroups.map((group) => (
                    <optgroup key={group.category} label={`${PRODUCT_CATEGORY_EMOJI[group.category] || PRODUCT_CATEGORY_EMOJI.Otros} ${group.category}`}>
                      {group.choices.map((choice) => {
                        const price = canal === "Rappi" ? choice.product.precioRappi : choice.product.precio;
                        const context = choice.kind === "figure" ? commercialFamilyLabel(choice.product) : "";
                        return <option key={choice.key} value={choice.key}>{choice.primary} · {fmt(price)}{context ? ` · ${context}` : ""}</option>;
                      })}
                    </optgroup>
                  ))}
                </select>
                {compatibilityErrors.length > 0 && (
                  <div className="mt-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold" style={{ background: "#F3D7DC", color: "#8E4B5A" }}>
                    ⚠️ {compatibilityErrors[0].message}
                  </div>
                )}
              </div>
              {it.productId && pSel && pSel.tipo !== "combo" && attrs.includes("sabor") && <Select placeholder="Sabor" options={sabores} value={it.sabor} onChange={(e) => setItem(i, "sabor", e.target.value)} />}
              {it.productId && pSel && pSel.tipo !== "combo" && attrs.includes("salsa") && <Select placeholder="Salsa" options={s.salsas} value={it.salsa} onChange={(e) => setItem(i, "salsa", e.target.value)} />}
              {it.productId && pSel && pSel.tipo !== "combo" && attrs.includes("relleno") && <Select placeholder="Relleno" options={s.rellenos} value={it.relleno} onChange={(e) => setItem(i, "relleno", e.target.value)} />}
              {it.productId && pSel && pSel.tipo !== "combo" && attrs.includes("figura") && !selectedExactFigure && <Select placeholder="Postre / figura" options={orderFiguresForFamily(activeFigureCatalog(db), it.productId).map((figure) => figure.nombre)} value={it.figura} onChange={(e) => setFigure(i, pSel, e.target.value)} />}
              <Input type="number" min="1" value={it.cant} onChange={(e) => setCant(i, pSel, Math.max(1, +e.target.value))} />
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-bold">{fmt(l.precio * l.cant + lineAdicionesTotal(l) + boxesAdicionesTotal(l))}</span>
                {items.length > 1 && <button onClick={() => quitarLinea(i)} className="text-xs font-bold" style={{ color: "#A03B2A" }}>Quitar</button>}
              </div>
            </div>
            {it.productId && pSel && pSel.tipo !== "combo" && attrs.includes("figura") && (() => {
              /* Disponibilidad por variante EN VIVO: dice si lo que pide el cliente
                 está desmoldado y, si no, qué ofrece el FIFO (mismo orden de decisión
                 que _asignar_variante_fifo en el server: SABOR y FIGURA filtran
                 duro; otra variante nunca sustituye la elegida). */
              const vars = (db.variantes || []).filter((v) => v.productId === it.productId && v.disponibles > 0);
              const chip = (bg, color, texto) => <div className="mt-1 px-2 py-1.5 rounded-lg text-[11px] font-bold" style={{ background: bg, color }}>{texto}</div>;
              const lista = (arr) => arr.map((v) => `${v.figura} · ${v.sabor} (${v.disponibles})`).join(" · ");
              if (!vars.length) return chip("#F3D7DC", "#8E4B5A", "Sin stock verificado por figura y sabor — este pedido requiere producción exacta.");
              if (!it.sabor) return chip("#DCE7F2", "#3E5C7E", `Desmoldado disponible: ${lista(vars)}`);
              const deSabor = vars.filter((v) => v.sabor === it.sabor);
              if (!deSabor.length) return chip("#F3D7DC", "#8E4B5A", `Sin ${it.sabor} desmoldado — hay: ${lista(vars)} · el sabor no se sustituye: se produce a pedido.`);
              if (!it.figura) return chip("#DCE7F2", "#3E5C7E", `${it.sabor} disponible por figura: ${lista(deSabor)}. Elegí la figura para validar.`);
              const exacta = l.disponibilidadExacta;
              if (exacta?.canFulfill) {
                return chip("#DDEBD9", "#3F6B42", `✓ ${exacta.required}× ${it.figura} · ${it.sabor} verificadas · FIFO exacto al pagar${exacta.nextExpiry ? ` · vence ${exacta.nextExpiry}` : ""}`);
              }
              return chip("#F3D7DC", "#8E4B5A", `Solo ${exacta?.available || 0} de ${it.cant} ${it.figura} · ${it.sabor} verificadas. Otra figura no la reemplaza: faltan ${exacta?.missing || it.cant} para producir.`);
            })()}
            {it.productId && pSel && pSel.tipo === "combo" && (() => {
              const boxes = it.boxes || [];
              const multi = boxes.length > 1;
              const figOpts = figurasDeCombo(db, pSel)
                .filter((figure) => validateOrderFigureCatalogLink(figure).valid && validateOrderComboSlotFigure(pSel, figure.nombre).valid)
                .map((figure) => figure.nombre);
              return (
                <div className="mt-2 pt-2 border-t" style={{ borderColor: T.border }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[11px] font-bold" style={{ color: T.choco2 }}>🎁 ARMÁ {multi ? `LAS ${boxes.length} CAJAS` : "LA CAJA"} · {pSel.comboSize} momos c/u</div>
                    {multi && <button type="button" onClick={() => copiarCaja1ATodas(i)} className="text-[11px] font-bold" style={{ color: T.coral }}>Caja 1 → todas</button>}
                  </div>
                  <div className="mb-2 px-2.5 py-2 rounded-xl text-[11px] font-bold flex items-center justify-between gap-2" style={{ background: l.disponibilidadCaja?.canFulfill ? "#DDEBD9" : "#F7EAC9", color: l.disponibilidadCaja?.canFulfill ? "#3F6B42" : "#8A6D1F" }}>
                    <span>{l.disponibilidadCaja?.incomplete ? "Completá postre y sabor para validar cada espacio" : l.disponibilidadCaja?.canFulfill ? "Composición exacta disponible" : "La caja necesita producción exacta"}</span>
                    <span className="shrink-0">{l.disponibilidadCaja?.covered || 0}/{l.disponibilidadCaja?.slots?.length || 0} verificadas</span>
                  </div>
                  {boxes.map((box, b) => (
                    <div key={b} className={multi ? "mb-2 p-2 rounded-lg" : ""} style={multi ? { background: T.vainilla } : {}}>
                      <div className="flex items-center justify-between mb-1">
                        {multi ? <div className="text-[10px] font-bold" style={{ color: T.choco2 }}>CAJA {b + 1}</div> : <span />}
                        {box.length > 1 && <button type="button" onClick={() => mismosMomos(i, b)} className="text-[10px] font-bold" style={{ color: T.coral }}>= mismos momos</button>}
                      </div>
                      {box.map((sl, si) => (
                        <div key={si} className="mb-1.5">
                          <div className="grid grid-cols-3 gap-1.5">
                            <Select placeholder="Postre" options={figOpts} value={sl.figura} onChange={(e) => setSlotFigure(i, b, si, pSel, e.target.value)} />
                            <Select placeholder="Sabor" options={sabores} value={sl.sabor} onChange={(e) => setSlot(i, b, si, "sabor", e.target.value)} />
                            <Select placeholder="Salsa" options={s.salsas} value={sl.salsa} onChange={(e) => setSlot(i, b, si, "salsa", e.target.value)} />
                          </div>
                          {(() => {
                            const exacta = (l.disponibilidadCaja?.slots || []).find((slot) => slot.boxIndex === b && slot.slotIndex === si);
                            if (!exacta?.complete) return null;
                            return <div className="mt-1 px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: exacta.covered ? "#E3EFE0" : "#F3D7DC", color: exacta.covered ? "#3F6B42" : "#8E4B5A" }}>{exacta.covered ? `✓ ${exacta.figure} · ${exacta.flavor} disponible · FIFO exacto` : `⚠ ${exacta.figure} · ${exacta.flavor} sin unidad exacta · producir`}</div>;
                          })()}
                          {Array.isArray(s.toppings) && s.toppings.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {s.toppings.map((top) => {
                                const on = (sl.adiciones || []).some((a) => a.nombre === top.nombre);
                                return (
                                  <button key={top.nombre} type="button" onClick={() => toggleSlotAdicion(i, b, si, top)}
                                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                    style={{ background: on ? T.coral : T.vainilla, color: on ? "#fff" : T.choco2, border: "1px solid " + (on ? T.coral : T.border) }}>
                                    🍫 {top.nombre}{(+top.precio > 0) ? " +" + fmt(top.precio) : ""}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}
            {l.productId && l.faltantesExactos && l.faltantesExactos.length > 0 && (
              <div className="text-xs font-bold mt-2 p-2 rounded-xl" style={{ color: "#8E4B5A", background: "#F3D7DC" }}>⚠️ Producción exacta requerida: {l.faltantesExactos.map((f) => `${f.missing}× ${f.figure} · ${f.flavor}`).join(", ")}. El stock anterior u otra figura no cubren esta elección.</div>
            )}
            {it.productId && pSel && pSel.tipo !== "combo" && Array.isArray(s.toppings) && s.toppings.length > 0 && (
              <div className="mt-2 pt-2 border-t" style={{ borderColor: T.border }}>
                <div className="text-[11px] font-bold mb-1" style={{ color: T.choco2 }}>🍫 TOPPINGS (opcional)</div>
                <div className="flex flex-wrap gap-1.5">
                  {s.toppings.map((top) => {
                    const on = (it.adiciones || []).some((a) => a.nombre === top.nombre);
                    return (
                      <button key={top.nombre} type="button" onClick={() => toggleAdicion(i, top)}
                        className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                        style={{ background: on ? T.coral : T.vainilla, color: on ? "#fff" : T.choco2, border: "1px solid " + (on ? T.coral : T.border) }}>
                        {top.nombre}{(+top.precio > 0) ? " +" + fmt(top.precio) : " · gratis"}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {l.productId && (!l.faltantesExactos || l.faltantesExactos.length === 0) && (l.faltantesFamilia && l.faltantesFamilia.length > 0) && (
              <div className="text-xs font-bold mt-2" style={{ color: "#A03B2A" }}>⚠️ Faltan unidades de estas presentaciones para la caja: {l.faltantesFamilia.map((f) => f.falta + " " + f.nombre).join(", ")}. Se reservará lo posible y se sugerirá producción del resto.</div>
            )}
            {l.productId && l.disp < l.cant && !(l.faltantesFamilia && l.faltantesFamilia.length > 0) && (
              <div className="text-xs font-bold mt-2" style={{ color: "#A03B2A" }}>⚠️ Capacidad general: {l.disp}{l.tipo === "combo" ? " caja(s) por momos y empaques" : ""}. Se sugerirá producción del faltante.</div>
            )}
          </Card>
        );
      })}
      <Btn small kind="rosa" onClick={agregarLinea}>＋ Agregar otra línea</Btn>

      <Field label="Observaciones"><Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Hora deseada, dedicatoria…" /></Field>

      <div className="text-sm font-bold mb-2 mt-1">¿De dónde llegó este pedido?</div>
      <div className="flex flex-wrap gap-2 mb-2">
        {ORIGEN_SIMPLE.map((op) => {
          const activo = origenSimple === op.label;
          return (
            <button key={op.label} type="button" onClick={() => {
              setOrigenSimple(op.label);
              setOrigenDetalle(op.detalle);
            }} className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: activo ? T.coral : T.vainilla, color: activo ? "#fff" : T.choco2, border: "1px solid " + (activo ? T.coral : T.border) }}>
              {op.label}
            </button>
          );
        })}
      </div>

      <button type="button" onClick={() => setVerAvanzado(!verAvanzado)} className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>
        {verAvanzado ? "▾" : "▸"} Vincular a campaña o publicación (opcional)
      </button>
      {verAvanzado && (
        <div className="grid sm:grid-cols-2 gap-x-4 mb-2">
          <Field label="Campaña">
            <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setCreativeId(""); }} className={inputCls} style={inputStyle}>
              <option value="">Sin campaña</option>
              {db.campaigns.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Field>
          <Field label="Publicación / creativo">
            <select value={creativeId} onChange={(e) => {
              const id = e.target.value;
              setCreativeId(id);
              const cr = db.creatives.find((x) => x.id === id);
              if (cr && cr.campaignId) setCampaignId(cr.campaignId);
            }} className={inputCls} style={inputStyle}>
              <option value="">Sin publicación</option>
              {db.creatives.filter((c) => !campaignId || c.campaignId === campaignId).map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
            </select>
          </Field>
        </div>
      )}

      <Card className="p-4 mt-2">
        <div className="flex justify-between text-sm py-0.5"><span>Subtotal</span><b>{fmt(subtotal)}</b></div>
        {descuento > 0 && <div className="flex justify-between text-sm py-0.5" style={{ color: "#3F6B42" }}><span>Beneficio aplicado</span><b>−{fmt(descuento)}</b></div>}
        {productoGratis && <div className="flex justify-between text-sm py-0.5" style={{ color: "#3F6B42" }}><span>🎁 {productoGratis.nombre} (gratis)</span><b>$0</b></div>}
        <div className="flex justify-between text-sm py-0.5"><span>Domicilio ({zona.split("·")[0].trim()})</span><b>{fmt(tarifa)}</b></div>
        <div className="flex justify-between display text-lg pt-2 mt-1 border-t" style={{ borderColor: T.border }}><span>Total</span><b style={{ color: T.coral }}>{fmt(total)}</b></div>
      </Card>

      {error && <div className="text-sm font-bold mt-3 p-2.5 rounded-xl" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{error}</div>}
      <div className="mt-4 flex gap-2">
        <Btn disabled={enviando} onClick={guardar}>Crear pedido</Btn>
        <Btn kind="ghost" onClick={onClose}>Cancelar</Btn>
      </div>
    </Modal>
  );
}

  return function OrdersPanel({ section, ...props }) {
    return section === "Empaque" ? <Empaque {...props} /> : <Pedidos {...props} />;
  };
}
