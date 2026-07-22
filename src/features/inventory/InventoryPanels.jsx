import { useEffect, useMemo, useRef, useState } from "react";
import { SegmentedTabs } from "../../components/ui/OperationalPrimitives.jsx";
import {
  createInventoryIdempotencyKey, crearInsumo, desecharLoteInsumo, desecharLoteInsumoDelta,
  desecharProductoTerminadoDelta, entradaInsumo, entradaInsumoLote, entradaInsumoLoteDelta, isMissingRpcError,
  movimientoInsumo, movimientoInsumoDelta, registrarCompraYAtenderSugerencias, setSugerenciaEstado,
} from "../../lib/rpc";
import { buildFinishedInventory } from "../../lib/finished-inventory";
import { buildFinishedStockSummary } from "../../lib/production-stock-summary";
import { buildIngredientLotSummary } from "../../lib/ingredient-lots";
import { inventorySupplyMode } from "../../lib/inventory-supply-mode";
import { buildPurchaseAssistant } from "../../lib/purchase-assistant";
import { batchPresentation, commercialFamilyLabel, inventoryReservationPresentation } from "../../lib/momos-domain-language";
import { FinishedFigureCards, FinishedFigureDetailContent } from "./FinishedFigureSummary.jsx";
import {
  buildActiveReservationDashboard, buildInventoryHistory, isActiveInventoryReservation, partitionByActivity,
} from "../../lib/operational-history";

function belongsToProduct(row, product) {
  if (!row || !product) return false;
  const productId = row.productId || row.refId;
  return productId ? productId === product.id : row.producto === product.nombre || row.nombre === product.nombre;
}

function physicalBatchPresentation(batch) {
  const presentation = batchPresentation(batch);
  if (presentation.figures.length <= 1) return presentation;
  return {
    ...presentation,
    primary: `${presentation.flavor || "Sin sabor"} · ${presentation.composition}`,
  };
}

export function createInventoryPanels(shared) {
  const {
    T, Badge, Btn, BtnAsync, Card, Empty, Field, Input, Modal, SectionTitle, Select, Stat, diasEntre,
    downloadCSV, fmt, hoyISO, inputStyle, toast,
  } = shared;

  function InventarioTerminado({
    db, go, user, refrescar, sincronizarProductoTerminado,
    aplicarMutacionProduccion, capturarContextoMutacionProduccion,
  }) {
    const [tab, setTab] = useState("Figuras");
    const [detalleProductoId, setDetalleProductoId] = useState(null);
    const [detalleFiguraNombre, setDetalleFiguraNombre] = useState(null);
    const [desechoTerminado, setDesechoTerminado] = useState(null);
    const [motivoDesechoTerminado, setMotivoDesechoTerminado] = useState("");
    const [errorDesechoTerminado, setErrorDesechoTerminado] = useState("");
    const [enviandoDesechoTerminado, setEnviandoDesechoTerminado] = useState(false);
    const desechoTerminadoKeyRef = useRef(null);
    // Usa el mismo día operativo local de Producción. `toISOString()` puede
    // adelantarse un día respecto a Cali después de las 19:00 y pondría en
    // cuarentena una figura aquí mientras Producción todavía la muestra vigente.
    const inventory = useMemo(() => buildFinishedInventory(db, { today: hoyISO() }), [db, hoyISO]);
    const finishedStock = useMemo(() => buildFinishedStockSummary({
      products: db.products || [],
      variants: db.variantes || [],
      quarantinedVariants: db.variantesCuarentena || [],
      productionBatches: db.production_batches || [],
      today: hoyISO(),
    }), [db, hoyISO]);
    const orderById = useMemo(() => Object.fromEntries((db.orders || []).map((order) => [order.id, order])), [db.orders]);
    const detalleProducto = detalleProductoId ? inventory.products.find((product) => product.id === detalleProductoId) : null;
    const detalleStockTrazable = detalleProductoId ? finishedStock.find((product) => product.productId === detalleProductoId) : null;
    const detalleLotesCuarentena = (detalleStockTrazable?.lotRows || []).filter((lot) => lot.quarantined);
    const detalleCuarentenaExacta = detalleLotesCuarentena.reduce((sum, lot) => sum + Number(lot.available || 0), 0);
    const detalleCuarentenaSinLote = Math.max(0, (detalleStockTrazable?.quarantined || 0) - detalleCuarentenaExacta);
    const puedeDesecharTerminado = ["Administrador", "Cocina"].includes(user)
      && db.finishedProductDisposalReady === true;
    const detalleVariantes = detalleProducto ? inventory.variants.filter((variant) => variant.productId === detalleProducto.id) : [];
    const detalleCuarentena = detalleProducto ? inventory.quarantinedVariants.filter((variant) => variant.productId === detalleProducto.id) : [];
    const detalleReservas = detalleProducto ? inventory.reservations.filter((reservation) => belongsToProduct(reservation, detalleProducto)) : [];
    const detalleEnProceso = detalleProducto ? inventory.inProcess.filter((batch) => belongsToProduct(batch, detalleProducto)) : [];
    const detalleImperfectas = detalleProducto ? inventory.imperfects.filter((batch) => belongsToProduct(batch, detalleProducto)) : [];
    const detalleFigura = detalleFiguraNombre ? inventory.figureSummaries.find((figure) => figure.figura === detalleFiguraNombre) : null;
    const tabs = [
      ["Figuras", inventory.figureSummaries.length],
      ["Disponibles", inventory.summary.available],
      ["Reservadas", inventory.summary.reserved],
      ["En proceso", inventory.summary.inProcess],
      ["Imperfectas", inventory.summary.imperfectTotal],
    ];
    const exactCoverage = inventory.summary.available > 0
      ? Math.round(inventory.summary.exactAvailable / inventory.summary.available * 100)
      : 0;

    function abrirDesechoTerminado(lot) {
      setDesechoTerminado({
        ...lot,
        productId: detalleProducto.id,
        productName: detalleProducto.nombre,
      });
      setMotivoDesechoTerminado(`Vencimiento del lote ${lot.batchId} el ${lot.expiry}`);
      setErrorDesechoTerminado("");
      desechoTerminadoKeyRef.current = createInventoryIdempotencyKey();
    }

    async function confirmarDesechoTerminado() {
      if (!desechoTerminado || enviandoDesechoTerminado) return;
      const motivo = motivoDesechoTerminado.trim();
      if (!motivo) {
        setErrorDesechoTerminado("Indicá el motivo para conservar la trazabilidad de la merma.");
        return;
      }
      setEnviandoDesechoTerminado(true);
      setErrorDesechoTerminado("");
      try {
        const canApplyDelta = db.finishedProductDisposalReady === true
          && db.productionMutationDeltaReady === true
          && typeof aplicarMutacionProduccion === "function"
          && typeof capturarContextoMutacionProduccion === "function";
        if (!canApplyDelta) throw new Error("Aplicá la migración H84 y recargá MOMO OPS para habilitar el desecho trazable de producto terminado.");

        const context = capturarContextoMutacionProduccion();
        const envelope = await desecharProductoTerminadoDelta({
          batchId: desechoTerminado.batchId,
          figura: desechoTerminado.figure,
          motivo,
          cantidadEsperada: desechoTerminado.quantity,
        }, desechoTerminadoKeyRef.current);

        let viewUpdated = false;
        try {
          viewUpdated = aplicarMutacionProduccion(envelope, context)?.status === "applied";
        } catch {
          // La escritura ya fue confirmada; reconciliar sin repetir la mutación.
        }
        if (!viewUpdated) {
          try {
            if (typeof sincronizarProductoTerminado === "function") {
              await sincronizarProductoTerminado([desechoTerminado.productId]);
            } else {
              await refrescar();
            }
            viewUpdated = true;
          } catch {
            // El recibo idempotente conserva el resultado; una recarga lo concilia.
          }
        }

        toast("ok", `✓ ${desechoTerminado.available} und de ${desechoTerminado.figure} desechadas`);
        if (!viewUpdated) toast("alert", "El desecho se registró, pero la vista requiere una recarga.");
        setDesechoTerminado(null);
        setMotivoDesechoTerminado("");
        desechoTerminadoKeyRef.current = null;
      } catch (error) {
        setErrorDesechoTerminado(isMissingRpcError(error)
          ? "Aplicá la migración H84 y recargá MOMO OPS para habilitar este desecho."
          : (error?.message || "No se pudo desechar el producto terminado."));
      } finally {
        setEnviandoDesechoTerminado(false);
      }
    }

    const metrics = [
      { icon: "✓", label: "Disponibles para vender", value: inventory.summary.available, note: inventory.summary.quarantined > 0 ? `stock seguro · ${inventory.summary.quarantined} en cuarentena` : "stock oficial, después de reservas", color: T.coral, wash: "rgba(63,107,66,.12)", iconBg: "#E3EFE0" },
      { icon: "🏷", label: "Reservadas", value: inventory.summary.reserved, note: "separadas para pedidos pagos", color: "#63518A", wash: "rgba(99,81,138,.12)", iconBg: "#E8E0F2" },
      { icon: "❄", label: "En proceso", value: inventory.summary.inProcess, note: "todavía no se pueden vender", color: T.choco, wash: "rgba(62,92,126,.12)", iconBg: "#DCE7F2" },
      { icon: "🥤", label: "Para malteadas", value: inventory.summary.imperfectForShakes, note: "imperfectas con ese destino", color: "#8A4D7A", wash: "rgba(138,77,122,.12)", iconBg: "#F1DFEB" },
      { icon: "♻", label: "Imperfectas pendientes", value: inventory.summary.imperfectPending, note: `${inventory.summary.imperfectReused} ya tienen destino`, color: "#96690F", wash: "rgba(150,105,15,.12)", iconBg: "#FBE8C8" },
    ];

    return (
      <div>
        <SectionTitle>Inventario terminado</SectionTitle>
        <div className="text-xs font-semibold mb-3 -mt-3" style={{ color: T.choco2 }}>
          “Disponibles” es la cifra oficial que usan ventas y reservas. Las reservadas ya fueron descontadas; el detalle por figura y sabor explica ese stock sin duplicarlo.
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {metrics.map((metric) => (
            <Stat key={metric.label} icon={metric.icon} label={metric.label} value={metric.value} sub={metric.note} tone={metric.color} />
          ))}
        </div>
        <div className="text-[11px] font-semibold mt-2 mb-4" style={{ color: T.choco2 }}>
          Trazabilidad exacta: <b style={{ color: T.coral }}>{exactCoverage}%</b> — {inventory.summary.exactAvailable} de {inventory.summary.available} con figura y sabor.
        </div>
        {(inventory.summary.quarantined > 0 || inventory.summary.reconciliationExcess > 0 || inventory.summary.negativeStockProducts > 0) && (
          <div className="rounded-2xl p-3 mb-4 text-xs font-semibold" role="alert" style={{ background: "#F6D4CD", color: "#7D2D22", border: "1px solid #ECBBB1" }}>
            <div className="font-extrabold mb-1">⚠ Inventario protegido</div>
            {inventory.summary.quarantined > 0 && <div>{inventory.summary.quarantined} unidad(es) vencidas están en cuarentena y no cubren ventas.</div>}
            {inventory.summary.reconciliationExcess > 0 && <div>{inventory.summary.reconciliationBlocked} unidad(es) con detalle físico quedaron bloqueadas: exceden el stock oficial por {inventory.summary.reconciliationExcess}. Reconciliá antes de vender esa variante.</div>}
            {inventory.summary.negativeStockProducts > 0 && <div>{inventory.summary.negativeStockProducts} producto(s) tenían stock negativo; se muestran en cero y requieren revisión.</div>}
          </div>
        )}

        <SegmentedTabs
          ariaLabel="Vistas del inventario terminado"
          value={tab}
          onChange={setTab}
          className="momo-segmented-tabs inline-flex max-w-full gap-1 overflow-x-auto p-1.5 mb-3 rounded-2xl"
          items={tabs.map(([name, count]) => [name, name, count])}
        />

        {tab === "Figuras" && (
          <>
            <SectionTitle>Figuras listas y sabores exactos</SectionTitle>
            <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>
              Cada tarjeta suma únicamente producto terminado vigente con figura y sabor verificados. Las imperfectas aparecen aparte y nunca aumentan el stock para venta.
            </div>
            <FinishedFigureCards figureSummaries={inventory.figureSummaries} products={db.products} Card={Card} Empty={Empty} T={T} onOpen={setDetalleFiguraNombre} />
          </>
        )}

        {tab === "Disponibles" && (
          <>
            <SectionTitle>Disponibilidad por presentación comercial</SectionTitle>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {inventory.products.map((product) => {
                const productVariants = inventory.variants.filter((variant) => variant.productId === product.id);
                const figureNames = [...new Set(productVariants.map((variant) => variant.figura).filter(Boolean))];
                const coverage = product.available > 0 ? Math.round(product.exactAvailable / product.available * 100) : 0;
                return (
                <Card key={product.id} className="momo-queue-item p-4" onClick={() => setDetalleProductoId(product.id)} aria-label={`Abrir detalle de ${product.nombre}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: product.available <= 2 ? "#A03B2A" : T.choco2 }}>{product.available <= 2 ? "Stock por reponer" : "Disponible ahora"}</div>
                      <div className="text-sm font-bold leading-tight mt-0.5">{figureNames.length ? figureNames.join(" · ") : "Figuras exactas pendientes"}</div>
                      <div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>Presentación comercial: {commercialFamilyLabel(product)}</div>
                    </div>
                    <div className="text-right shrink-0"><div className="display text-2xl" style={{ color: product.available <= 2 ? "#A03B2A" : T.coral }}>{product.available}</div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>unidades</div></div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap mt-3">
                    <span className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: product.exactAvailable ? "#E3EFE0" : "#FBE8C8", color: product.exactAvailable ? "#3F6B42" : "#96690F" }}>{product.exactAvailable} exactas</span>
                    <span className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: T.vainilla, color: T.choco2 }}>{productVariants.length} {productVariants.length === 1 ? "combinación" : "combinaciones"}</span>
                    {product.withoutVariantDetail > 0 && <span className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: "#FBE8C8", color: "#96690F" }}>{product.withoutVariantDetail} sin detalle</span>}
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t text-[11px] font-bold" style={{ borderColor: T.border, color: T.choco2 }}><span>{coverage}% trazabilidad exacta</span><span style={{ color: T.coral }}>Ver figuras y sabores ›</span></div>
                </Card>
              );})}
              {inventory.products.length === 0 && <Empty icon="🍮" text="No hay presentaciones comerciales con producto terminado disponible." />}
            </div>
          </>
        )}

        {tab === "Reservadas" && (
          <>
            <SectionTitle>Producto separado para pedidos</SectionTitle>
            <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>
              Estas unidades ya salieron del stock disponible. El lote muestra la asignación FIFO cuando existe trazabilidad física.
            </div>
            {inventory.reservations.length > 0 ? (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm min-w-[680px]">
                  <thead><tr className="text-left text-xs" style={{ color: T.choco2 }}>
                    {['Pedido','Producto','Cantidad','Lote / figura','Estado pedido','Reserva'].map((heading) => <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}
                  </tr></thead>
                  <tbody>
                    {inventory.reservations.map((reservation) => {
                      const order = orderById[reservation.orderId];
                    const presentation = inventoryReservationPresentation(reservation);
                      return (
                        <tr key={reservation.id} className="border-t" style={{ borderColor: T.border }}>
                          <td className="px-3 py-2 text-xs font-bold">{reservation.orderId}</td>
                          <td className="px-3 py-2"><div className="font-semibold">{presentation.primary}</div>{presentation.secondary && <div className="text-[10px] font-bold mt-0.5" style={{ color: T.choco2 }}>{presentation.secondary}</div>}</td>
                          <td className="px-3 py-2 font-bold">{reservation.cantidad}</td>
                          <td className="px-3 py-2 text-xs">{reservation.batchId ? `${reservation.batchId}${reservation.figuraLote ? ` · ${reservation.figuraLote}` : ""}` : "Sin lote detallado"}</td>
                          <td className="px-3 py-2"><Badge label={order?.estado || "Sin pedido"} /></td>
                          <td className="px-3 py-2"><Badge label={reservation.estado} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            ) : <Empty icon="🏷️" text="No hay reservas de producto terminado." />}
          </>
        )}

        {tab === "En proceso" && (
          <>
            <SectionTitle action={<Btn small kind="soft" onClick={() => go("Producción")}>Abrir Producción</Btn>}>Lotes que todavía no están disponibles</SectionTitle>
            <div className="grid lg:grid-cols-2 gap-3">
              {inventory.inProcess.map((batch) => {
                const presentation = physicalBatchPresentation(batch);
                return (
                <Card key={batch.id} className="p-4">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Lote {batch.id}</div>
                      <div className="font-bold mt-0.5">{presentation.primary}</div>
                      <div className="text-xs mt-0.5" style={{ color: T.choco2 }}>{presentation.secondary} · {batch.gramaje || "sin gramaje"}</div>
                    </div>
                    <Badge label={batch.estado} />
                  </div>
                  <div className="mt-3 flex justify-between items-baseline gap-2">
                    <span className="text-xs font-bold" style={{ color: T.choco2 }}>Unidades producidas</span>
                    <span className="display text-2xl font-semibold" style={{ color: T.choco }}>{batch.prod || 0}</span>
                  </div>
                </Card>
              );})}
              {inventory.inProcess.length === 0 && <Empty icon="🧊" text="No hay lotes en preparación o congelación." />}
            </div>
          </>
        )}

        {tab === "Imperfectas" && (
          <>
            <SectionTitle action={<Btn small kind="soft" onClick={() => go("Producción")}>Gestionar en Producción</Btn>}>Imperfectas y descartadas por lote</SectionTitle>
            <div className="rounded-xl p-3 mb-3 text-xs font-semibold" style={{ background: T.vainilla, color: T.choco2 }}>
              Pendientes: {inventory.summary.imperfectPending} · Reaprovechadas/con destino: {inventory.summary.imperfectReused} · Descartadas: {inventory.summary.discarded}. Las reaprovechadas no se suman al producto disponible para venta.
            </div>
            <div className="grid lg:grid-cols-2 gap-3">
              {inventory.imperfects.map((batch) => {
                const presentation = physicalBatchPresentation(batch);
                return (
                <Card key={batch.id} className="p-4">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Lote {batch.id}</div>
                      <div className="font-bold mt-0.5">{presentation.primary}</div>
                      <div className="text-xs mt-0.5" style={{ color: T.choco2 }}>{presentation.secondary} · {batch.fecha}</div>
                    </div>
                    <Badge label={batch.destinationRegistered ? "Con destino" : "Pendiente"} map={{ "Con destino": { bg: "#DDEBD9", fg: "#3F6B42" }, "Pendiente": { bg: "#FBE8C8", fg: "#96690F" } }} />
                  </div>
                  <div className="mt-3 pl-3 border-l-2" style={{ borderColor: T.rosa }}>
                    <div className="flex justify-between items-baseline gap-2 text-xs">
                      <span style={{ color: T.choco2 }}>Imperfectas</span>
                      <span className="font-bold" style={{ color: "#96690F" }}>{batch.imperfectas}</span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2 text-xs mt-0.5">
                      <span style={{ color: T.choco2 }}>Descartadas</span>
                      <span className="font-bold" style={{ color: "#A03B2A" }}>{batch.descartadas}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap mt-2">
                    {batch.figureOutcomes.filter((row) => row.imperfectas > 0 || row.descartadas > 0).map((row) => <span key={row.figura} className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: T.vainilla, color: T.choco2 }}>{row.figura}: {row.imperfectas} imperfectas{row.descartadas ? ` · ${row.descartadas} descartadas` : ""}</span>)}
                  </div>
                  <div className="text-xs font-bold mt-2" style={{ color: batch.destinationRegistered ? "#3F6B42" : "#96690F" }}>
                    {batch.destinationRegistered ? `Destino: ${batch.destino}` : "Falta definir si se reaprovechan o se descartan."}
                  </div>
                </Card>
              );})}
              {inventory.imperfects.length === 0 && <Empty icon="✨" text="No hay imperfectas ni descartadas registradas." />}
            </div>
          </>
        )}

        {detalleFigura && (
          <Modal title={`Figura terminada · ${detalleFigura.figura}`} onClose={() => setDetalleFiguraNombre(null)} wide>
            <FinishedFigureDetailContent figure={detalleFigura} products={db.products} Card={Card} Stat={Stat} T={T} />
          </Modal>
        )}

        {detalleProducto && (
          <Modal title={`Inventario por presentación · ${detalleProducto.nombre}`} onClose={() => setDetalleProductoId(null)} wide>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Presentación comercial</div>
                <div className="display text-2xl font-semibold mt-0.5">{[...new Set(detalleVariantes.map((variant) => variant.figura).filter(Boolean))].join(" · ") || "Figuras exactas pendientes"}</div>
                <div className="text-xs font-bold mt-1" style={{ color: T.choco2 }}>Presentación comercial: {commercialFamilyLabel(detalleProducto)}</div>
                <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Stock oficial después de reservas y cuarentena.</div>
              </div>
              <Badge label={detalleProducto.available > 0 ? "Disponible" : "Sin stock"} map={{ Disponible: { bg: "#DDEBD9", fg: "#3F6B42" }, "Sin stock": { bg: "#F6D4CD", fg: "#A03B2A" } }} />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <Stat icon="✓" label="Disponibles" value={detalleProducto.available} sub="para nuevas ventas" tone="#3F6B42" />
              <Stat icon="🐾" label="Exactas" value={detalleProducto.exactAvailable} sub="con figura y sabor" tone={T.coral} />
              <Stat icon="◌" label="Sin detalle" value={detalleProducto.withoutVariantDetail} sub="stock legado" tone="#96690F" />
              <Stat icon="🏷" label="Reservadas" value={detalleReservas.reduce((sum, row) => sum + Number(row.cantidad || 0), 0)} sub={`${detalleReservas.length} asignación(es)`} tone="#63518A" />
            </div>

            <Card className="p-4 mb-4" style={{ background: "linear-gradient(135deg,#FFF9F1,#F7ECD9)" }}>
              <div className="flex items-center justify-between gap-3 mb-3"><div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>Detalle vendible exacto</div><div className="display text-lg font-semibold">Figuras y sabores disponibles</div></div><span className="text-xs font-extrabold" style={{ color: T.choco2 }}>{detalleVariantes.length} {detalleVariantes.length === 1 ? "combinación" : "combinaciones"}</span></div>
              <div className="grid sm:grid-cols-2 gap-2">
                {detalleVariantes.map((variant) => {
                  const days = variant.vence ? diasEntre(hoyISO(), variant.vence) : null;
                  return <div key={`${variant.figura}-${variant.sabor}-${variant.gramajeG}`} className="rounded-2xl border p-3 flex items-start justify-between gap-3" style={{ borderColor: days != null && days <= 1 ? "#ECBBB1" : T.border, background: T.surface }}><div><div className="text-sm font-extrabold">{variant.figura} · {variant.sabor || "Sin sabor"}</div><div className="text-[11px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{variant.gramajeG != null ? `${variant.gramajeG} g` : "Gramaje sin registrar"}{variant.vence ? ` · vence ${variant.vence}` : ""}</div></div><div className="text-right shrink-0"><div className="display text-2xl" style={{ color: T.coral }}>{variant.disponibles}</div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>disponibles</div></div></div>;
                })}
                {detalleVariantes.length === 0 && <div className="sm:col-span-2 rounded-2xl p-4 text-sm font-semibold" style={{ background: "#FBE8C8", color: "#7A5410" }}>Todavía no hay unidades con figura y sabor verificables para esta presentación comercial. El stock sin detalle no debe prometerse como una combinación exacta.</div>}
              </div>
            </Card>

            {detalleCuarentena.length > 0 && <Card className="p-4 mb-4" style={{ background: "#FFF5F2", borderColor: "#ECBBB1" }}>
              <div className="text-xs font-extrabold" style={{ color: "#A03B2A" }}>Cuarentena por vencimiento</div>
              <div className="text-[10px] font-semibold mt-0.5" style={{ color: T.choco2 }}>El desecho se aplica al lote y figura exactos; nunca al saldo agregado.</div>
              <div className="space-y-2 mt-3">
                {detalleLotesCuarentena.map((lot) => <div key={lot.id} className="rounded-xl p-3 flex items-center justify-between gap-3" style={{ background: T.surface, border: "1px solid #ECBBB1" }}><div><div className="text-xs font-extrabold">{lot.available}× {lot.figure} · {lot.flavor || "Sin sabor"}</div><div className="text-[10px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{lot.batchId}{lot.grams ? ` · ${lot.grams}` : ""} · venció {lot.expiry}</div></div>{puedeDesecharTerminado && <Btn small kind="danger" onClick={() => abrirDesechoTerminado(lot)}>Desechar</Btn>}</div>)}
                {detalleCuarentenaSinLote > 0 && <div className="rounded-xl p-3 text-xs font-semibold" style={{ background: "#FBE8C8", color: "#7A5410" }}>{detalleCuarentenaSinLote} unidad(es) en cuarentena no tienen lote exacto y requieren conciliación; no se pueden desechar automáticamente.</div>}
                {detalleLotesCuarentena.length === 0 && detalleCuarentena.map((variant) => <div key={`${variant.figura}-${variant.sabor}-${variant.vence}`} className="text-xs font-semibold">{variant.disponibles}× {variant.figura} · {variant.sabor || "Sin sabor"} · venció {variant.vence} · sin lote exacto</div>)}
              </div>
            </Card>}

            <div className="grid lg:grid-cols-2 gap-3">
              <Card className="p-4">
                <div className="text-xs font-extrabold mb-2" style={{ color: T.choco2 }}>RESERVAS ACTIVAS</div>
                <div className="space-y-2">{detalleReservas.map((reservation) => <div key={reservation.id} className="rounded-xl p-2.5 flex items-center justify-between gap-3" style={{ background: T.vainilla }}><div><div className="text-sm font-bold">{reservation.cantidad}× · pedido {reservation.orderId}</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>{reservation.batchId ? `${reservation.batchId}${reservation.figuraLote ? ` · ${reservation.figuraLote}` : ""}` : "Sin lote físico exacto"}</div></div><Badge label={orderById[reservation.orderId]?.estado || "Sin pedido"} /></div>)}{detalleReservas.length === 0 && <div className="text-xs font-semibold" style={{ color: T.choco2 }}>No hay unidades reservadas.</div>}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-extrabold mb-2" style={{ color: T.choco2 }}>LOTES EN PROCESO</div>
                <div className="space-y-2">{detalleEnProceso.map((batch) => { const presentation = physicalBatchPresentation(batch); return <div key={batch.id} className="rounded-xl p-2.5 flex items-center justify-between gap-3" style={{ background: "#EDF3F8" }}><div><div className="text-sm font-bold">{presentation.primary} · {batch.prod || 0} unidades</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>Lote {batch.id} · {presentation.secondary}</div></div><Badge label={batch.estado} /></div>; })}{detalleEnProceso.length === 0 && <div className="text-xs font-semibold" style={{ color: T.choco2 }}>No hay lotes activos de esta presentación comercial.</div>}</div>
              </Card>
            </div>

            {detalleImperfectas.length > 0 && <Card className="p-4 mt-3"><div className="text-xs font-extrabold mb-2" style={{ color: T.choco2 }}>IMPERFECTAS Y DESCARTADAS</div>{detalleImperfectas.map((batch) => { const presentation = physicalBatchPresentation(batch); return <div key={batch.id} className="flex items-center justify-between gap-3 py-2 border-t first:border-0 text-xs" style={{ borderColor: T.border }}><span className="font-bold">{presentation.primary} · lote {batch.id}</span><span style={{ color: T.choco2 }}>{batch.imperfectas} imperfectas · {batch.descartadas} descartadas</span></div>; })}</Card>}
          </Modal>
        )}

        {desechoTerminado && <Modal title="Desechar producto terminado" onClose={() => { if (!enviandoDesechoTerminado) setDesechoTerminado(null); }}>
          <div data-testid="finished-inventory-disposal-modal">
            <div className="rounded-2xl p-4 mb-4" style={{ background: "#FFF1ED", border: "1px solid #E9A08F" }}>
              <div className="text-xs font-extrabold uppercase tracking-[.12em]" style={{ color: "#A03B2A" }}>Merma exacta y trazable</div>
              <div className="display text-xl mt-1">{desechoTerminado.productName}</div>
              <div className="text-sm mt-1" style={{ color: T.choco2 }}>Se retirarán <b>{desechoTerminado.available} unidades</b> de <b>{desechoTerminado.figure} · {desechoTerminado.flavor}</b>, lote <b>{desechoTerminado.batchId}</b>. Las reservas existentes no se modifican.</div>
            </div>
            <Field label="Motivo del desecho"><Input value={motivoDesechoTerminado} onChange={(event) => setMotivoDesechoTerminado(event.target.value)} placeholder="Ej: vencimiento, cadena de frío, olor o textura alterada" /></Field>
            {errorDesechoTerminado && <div role="alert" className="rounded-xl px-3 py-2 mt-3 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{errorDesechoTerminado}</div>}
            <div className="flex gap-2 mt-4">
              <BtnAsync kind="danger" disabled={enviandoDesechoTerminado} textoEnVuelo="Desechando…" onClick={confirmarDesechoTerminado}>Confirmar desecho</BtnAsync>
              <Btn kind="ghost" disabled={enviandoDesechoTerminado} onClick={() => setDesechoTerminado(null)}>Conservar lote</Btn>
            </div>
          </div>
        </Modal>}
      </div>
    );
  }

  /* ================= INVENTARIO DE INSUMOS ================= */

  function InventoryScopeTabs({ value, onChange, operationCount, reservationCount, historyCount }) {
    const options = [
      { id: "active", label: "Operación", count: operationCount, icon: "●" },
      { id: "reservations", label: "Reservas", count: reservationCount, icon: "▦" },
      { id: "history", label: "Historial", count: historyCount, icon: "◷" },
    ];
    return (
      <div className="inline-flex max-w-full overflow-x-auto rounded-2xl border p-1" style={{ borderColor: T.border, background: T.vainilla }} role="tablist" aria-label="Operación, reservas e historial de Inventario">
        {options.map((option) => {
          const selected = value === option.id;
          return <button key={option.id} type="button" role="tab" aria-selected={selected} onClick={() => onChange(option.id)} className="rounded-xl px-3 py-2 text-xs font-extrabold transition flex items-center gap-2 shrink-0" style={{ background: selected ? T.surface : "transparent", color: selected ? T.choco : T.choco2, boxShadow: selected ? "0 3px 10px rgba(84,56,43,.10)" : "none" }}><span aria-hidden="true" style={{ color: selected ? T.coral : T.choco2 }}>{option.icon}</span><span>{option.label}</span><span className="min-w-5 h-5 px-1 rounded-full inline-flex items-center justify-center text-[10px]" style={{ background: selected ? T.coralSoft : "rgba(255,255,255,.72)", color: selected ? "#A94D34" : T.choco2 }}>{option.count}</span></button>;
        })}
      </div>
    );
  }

  function InventoryReservationsPanel({ dashboard, go }) {
    const [filter, setFilter] = useState("");
    const [query, setQuery] = useState("");
    const rowsForFilter = dashboard.reservations.filter((row) => !filter
      || (filter === "product" && row.tipo === "producto")
      || (filter === "supply" && row.tipo !== "producto")
      || (filter === "attention" && row.attention));
    const needle = query.trim().toLocaleLowerCase("es");
    const visibleGroups = dashboard.groups.map((group) => ({
      ...group,
      rows: group.rows.filter((row) => rowsForFilter.includes(row)
        && (!needle || [row.id, row.orderId, row.nombre, row.customerName, row.orderState, row.sourceLabel].join(" ").toLocaleLowerCase("es").includes(needle))),
    })).filter((group) => group.rows.length > 0);
    const visibleRows = visibleGroups.flatMap((group) => group.rows);
    const productCount = dashboard.reservations.filter((row) => row.tipo === "producto").length;
    const supplyCount = dashboard.reservations.length - productCount;

    function ageLabel(hours) {
      if (hours == null) return "antigüedad desconocida";
      if (hours < 1) return "reservada hace menos de 1 h";
      if (hours < 24) return `reservada hace ${hours} h`;
      const days = Math.floor(hours / 24);
      return `reservada hace ${days} día${days === 1 ? "" : "s"}`;
    }

    function exportReservations() {
      downloadCSV("reservas-vigentes", ["Reserva", "Pedido", "Cliente", "Estado pedido", "Tipo", "Ítem", "Cantidad", "Fecha", "Origen", "Antigüedad horas", "Atención"], visibleRows.map((row) => [row.id, row.orderId, row.customerName, row.orderState, row.tipo, row.nombre, row.quantity, row.fecha, row.sourceLabel, row.ageHours, row.attentionReasons.join(" · ")]));
    }

    return (
      <div className="momo-page-enter">
        <Card className="p-4 mb-4" style={{ background: "linear-gradient(135deg,#FFF9F1,#F7ECD9)" }}>
          <div className="grid lg:grid-cols-[1fr_auto] gap-4 items-center">
            <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Stock comprometido</div><div className="display text-xl font-semibold mt-0.5">¿Qué es una reserva vigente?</div><div className="text-xs font-semibold mt-1 max-w-3xl" style={{ color: T.choco2 }}>Es inventario separado para un pedido pagado. Ya no está disponible para otra venta; si el pedido se cancela se libera, y cuando Cocina o Empaque lo utiliza pasa a Consumida. Aquí detectamos reservas antiguas, sin pedido o ligadas a órdenes ya cerradas.</div></div>
            <div className="flex items-center gap-2 text-[10px] font-extrabold whitespace-nowrap"><span className="rounded-xl px-3 py-2" style={{ background: "#DDEBD9", color: "#3F6B42" }}>RESERVADA</span><span>→</span><span className="rounded-xl px-3 py-2" style={{ background: "#DCE7F2", color: "#3E5C7E" }}>CONSUMIDA</span><span>o</span><span className="rounded-xl px-3 py-2" style={{ background: "#FBE8C8", color: "#96690F" }}>LIBERADA</span></div>
          </div>
        </Card>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat icon="▦" label="Reservas vigentes" value={dashboard.summary.reservations} sub="filas comprometidas" tone={T.coral} />
          <Stat icon="🧾" label="Pedidos" value={dashboard.summary.orders} sub="órdenes con stock separado" tone="#3E5C7E" />
          <Stat icon="#" label="Cantidad reservada" value={dashboard.summary.quantity} sub={`${dashboard.summary.exact} con lote físico exacto`} tone="#3F6B42" />
          <Stat icon="△" label="Necesitan revisión" value={dashboard.summary.attention} sub="antiguas o inconsistentes" tone="#A03B2A" />
        </div>

        <Card className="p-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            {[["Todas", "", dashboard.summary.reservations], ["Producto terminado", "product", productCount], ["Insumos y empaque", "supply", supplyCount], ["Necesitan revisión", "attention", dashboard.summary.attention]].map(([label, value, count]) => {
              const selected = filter === value;
              return <button key={label} type="button" aria-pressed={selected} onClick={() => setFilter(value)} className="rounded-xl px-3 py-2 text-xs font-extrabold border" style={{ borderColor: selected ? T.coral : T.border, background: selected ? T.coralSoft : T.surface, color: selected ? "#A34A2A" : T.choco2 }}>{label} <span className="ml-1">{count}</span></button>;
            })}
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pedido, cliente, ítem o lote…" className="rounded-xl px-3 py-2 text-sm border outline-none min-w-[230px] flex-1" style={inputStyle} />
            <Btn small kind="ghost" onClick={exportReservations}>⬇ CSV</Btn>
          </div>
        </Card>

        <div className="flex items-end justify-between gap-3 mb-3"><div><div className="display text-lg font-semibold">Reservas por pedido</div><div className="text-xs font-semibold" style={{ color: T.choco2 }}>{visibleRows.length} reserva{visibleRows.length === 1 ? "" : "s"} en {visibleGroups.length} pedido{visibleGroups.length === 1 ? "" : "s"}</div></div>{(filter || query) && <button type="button" onClick={() => { setFilter(""); setQuery(""); }} className="text-xs font-extrabold" style={{ color: T.coral }}>Limpiar filtros</button>}</div>
        <div className="grid lg:grid-cols-2 gap-3">
          {visibleGroups.map((group) => (
            <Card key={group.orderId} className="momo-queue-item p-4" style={group.attention ? { borderColor: "#E9A08F", background: "#FFF9F7" } : undefined}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="display text-lg font-semibold">{group.orderId}</span><Badge label={group.orderState} />{group.attention && <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>Revisar</span>}</div><div className="text-xs font-semibold mt-0.5" style={{ color: T.choco2 }}>{group.customerName} · {ageLabel(group.oldestHours)}</div></div>
                <Btn small kind="ghost" disabled={group.orderId === "Sin pedido"} onClick={() => go?.("Pedidos", { orderId: group.orderId })}>Abrir pedido</Btn>
              </div>
              {group.attention && <div className="rounded-xl px-3 py-2 mt-3 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>△ {[...new Set(group.rows.flatMap((row) => row.attentionReasons))].join(" · ")}</div>}
              <div className="mt-3 space-y-2">
                {group.rows.map((row) => {
                  const presentation = reservationPresentation(row);
                  return (
                    <div key={row.id} className="rounded-xl border px-3 py-2.5 flex items-start justify-between gap-3" style={{ borderColor: T.border, background: T.surface }}>
                      <div className="min-w-0"><div className="text-sm font-bold">{row.quantity}× {presentation.primary}</div>{presentation.secondary && <div className="text-[10px] font-bold mt-0.5" style={{ color: T.choco2 }}>{presentation.secondary}</div>}<div className="text-[10px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{row.id} · {row.tipo === "producto" ? "Producto terminado" : "Insumo / empaque"} · {row.sourceLabel}</div></div>
                      <time className="text-[10px] font-bold shrink-0" style={{ color: T.choco2 }}>{row.fecha}</time>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
          {!visibleGroups.length && <Empty icon="▦" text="No hay reservas vigentes con esos filtros." />}
        </div>
      </div>
    );
  }

  function InventoryHistoryPanel({ entries, go }) {
    const [query, setQuery] = useState("");
    const [kind, setKind] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [limit, setLimit] = useState(50);
    const filtered = useMemo(() => {
      const needle = query.trim().toLocaleLowerCase("es");
      return entries.filter((entry) => {
        const haystack = [entry.sourceId, entry.type, entry.item, entry.orderId, entry.status, entry.note].join(" ").toLocaleLowerCase("es");
        const day = entry.at.slice(0, 10);
        return (!needle || haystack.includes(needle))
          && (!kind || entry.kind === kind)
          && (!from || day >= from)
          && (!to || day <= to);
      });
    }, [entries, query, kind, from, to]);
    useEffect(() => { setLimit(50); }, [query, kind, from, to]);
    const visible = filtered.slice(0, limit);
    const movementCount = entries.filter((entry) => entry.kind === "movement").length;
    const reservationCount = entries.filter((entry) => entry.kind === "reservation").length;
    const wasteCount = entries.filter((entry) => entry.kind === "movement" && entry.type === "Merma").length;

    function exportHistory() {
      downloadCSV("historial-inventario", ["Fecha", "Origen", "ID", "Tipo", "Ítem", "Cantidad", "Pedido", "Estado", "Nota"], filtered.map((entry) => [entry.at, entry.kind === "movement" ? "Movimiento" : "Reserva", entry.sourceId, entry.type, entry.item, entry.quantity, entry.orderId, entry.status, entry.note]));
    }

    const statusMap = {
      Entrada: { bg: "#DDEBD9", fg: "#3F6B42" },
      Salida: { bg: "#DCE7F2", fg: "#3E5C7E" },
      Ajuste: { bg: "#EBE6E0", fg: "#7A6E63" },
      Merma: { bg: "#F6D4CD", fg: "#A03B2A" },
      "Uso en producción": { bg: "#E8E0F2", fg: "#63518A" },
      Consumida: { bg: "#DDEBD9", fg: "#3F6B42" },
      Liberada: { bg: "#FBE8C8", fg: "#96690F" },
    };

    return (
      <div className="momo-page-enter">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat icon="◷" label="Registros" value={entries.length} sub="rastro de inventario" tone={T.coral} />
          <Stat icon="↕" label="Movimientos" value={movementCount} sub="entradas, usos y ajustes" tone="#3E5C7E" />
          <Stat icon="▦" label="Reservas cerradas" value={reservationCount} sub="consumidas o liberadas" tone="#3F6B42" />
          <Stat icon="△" label="Mermas" value={wasteCount} sub="retiros trazables" tone="#A03B2A" />
        </div>

        <Card className="p-3 mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {[["Todos", ""], ["Movimientos", "movement"], ["Reservas cerradas", "reservation"]].map(([label, value]) => {
              const selected = kind === value;
              const count = value === "movement" ? movementCount : value === "reservation" ? reservationCount : entries.length;
              return <button key={label} type="button" aria-pressed={selected} onClick={() => setKind(value)} className="rounded-xl px-3 py-2 text-xs font-extrabold border" style={{ borderColor: selected ? T.coral : T.border, background: selected ? T.coralSoft : T.surface, color: selected ? "#A34A2A" : T.choco2 }}>{label} <span className="ml-1">{count}</span></button>;
            })}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_150px_150px_auto_auto] gap-2 items-center">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar insumo, pedido, movimiento o nota…" className="rounded-xl px-3 py-2 text-sm border outline-none" style={inputStyle} />
            <input type="date" aria-label="Inventario desde" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-xl px-3 py-2 text-xs border font-bold" style={inputStyle} />
            <input type="date" aria-label="Inventario hasta" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-xl px-3 py-2 text-xs border font-bold" style={inputStyle} />
            <Btn small kind="ghost" onClick={exportHistory}>⬇ CSV</Btn>
            <Btn small kind="ghost" onClick={() => go?.("Historial operativo")}>Historial central</Btn>
          </div>
        </Card>

        <div className="flex items-center justify-between gap-3 mb-3">
          <div><div className="display text-lg font-semibold">Bitácora de Inventario</div><div className="text-xs font-semibold" style={{ color: T.choco2 }}>{filtered.length} registro{filtered.length === 1 ? "" : "s"} · nada se elimina al salir de Operación</div></div>
          {(query || kind || from || to) && <button type="button" className="text-xs font-extrabold" style={{ color: T.coral }} onClick={() => { setQuery(""); setKind(""); setFrom(""); setTo(""); }}>Limpiar filtros</button>}
        </div>
        <Card className="overflow-hidden">
          <div className="divide-y" style={{ borderColor: T.border }}>
            {visible.map((entry) => (
              <div key={entry.id} className="p-3 sm:p-4 flex gap-3 items-start" style={{ borderColor: T.border }}>
                <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-base font-black" style={{ background: entry.kind === "reservation" ? "#F7ECD9" : entry.type === "Merma" ? "#F6D4CD" : entry.quantity >= 0 ? "#DDEBD9" : "#DCE7F2", color: entry.kind === "reservation" ? "#96690F" : entry.type === "Merma" ? "#A03B2A" : T.choco }}>{entry.kind === "reservation" ? "▦" : entry.quantity >= 0 ? "+" : "−"}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-bold text-sm">{entry.item}</span><Badge label={entry.status} map={statusMap} /></div>
                  <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{entry.kind === "reservation" ? `Reserva ${entry.sourceId}${entry.orderId ? ` · pedido ${entry.orderId}` : ""}` : `${entry.type} · ${entry.sourceId}`}{entry.note ? ` · ${entry.note}` : ""}</div>
                </div>
                <div className="text-right shrink-0"><div className="display text-lg" style={{ color: entry.quantity < 0 || entry.type === "Merma" ? "#A03B2A" : T.coral, fontVariantNumeric: "tabular-nums" }}>{entry.quantityLabel}</div><time className="text-[10px] font-bold block" style={{ color: T.choco2 }}>{entry.at || "Sin fecha"}</time></div>
              </div>
            ))}
            {!visible.length && <div className="p-10 text-center"><div className="text-3xl mb-2">⌕</div><div className="font-bold">No hay registros con esos filtros</div><div className="text-xs mt-1" style={{ color: T.choco2 }}>Probá otra fecha, tipo o término de búsqueda.</div></div>}
          </div>
        </Card>
        {visible.length < filtered.length && <div className="mt-3 text-center"><Btn kind="ghost" onClick={() => setLimit((value) => value + 50)}>Ver 50 registros más</Btn></div>}
      </div>
    );
  }

  function Inventario({
    db, update, user, focus, refrescar, aplicarDeltaInventario,
    capturarGeneracionInventario, solicitarConciliacionInventario, go,
  }) {
    const [scope, setScope] = useState("active");
    const [asistenteComprasAbierto, setAsistenteComprasAbierto] = useState(false);
    const [detalleInsumoId, setDetalleInsumoId] = useState(null);
    const [mov, setMov] = useState(false);
    const [desecharVencido, setDesecharVencido] = useState(null);
    const [motivoDesecho, setMotivoDesecho] = useState("");
    const [nuevoIns, setNuevoIns] = useState(false);
    const [fi, setFi] = useState({ nombre: "", cat: "", unidad: "und", stock: "", min: "", costoTotal: "", proveedor: "", vence: "", ubicacion: "" });
    const [errIns, setErrIns] = useState("");
    const [form, setForm] = useState({ tipo: "Entrada", item: "", cant: "", precio: "", vence: "", proveedor: "", ubicacion: "", nota: "", suggestionIds: [] });
    const [fCat, setFCat] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [avisoInv, setAvisoInv] = useState(null);
    const [enviandoSugId, setEnviandoSugId] = useState(null);
    const highlightId = focus && focus.itemId;
    const highlightRef = useRef(null);
    const mutationIntentKeysRef = useRef(new Map());
    useEffect(() => {
      if (highlightRef.current) highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }, [highlightId]);
    const cats = [...new Set(db.inventory_items.map((i) => i.cat))];
    // Dominios CERRADOS en Nuevo insumo (regla: dominio finito → cerrado; evita
    // "Lácteos"/"lacteos" duplicadas). Solo Administrador puede ampliar la lista
    // vía la opción centinela "➕ Nueva…" — cocina elige de lo existente.
    const NUEVA_CAT = "➕ Nueva categoría…";
    const NUEVA_UBI = "➕ Nueva ubicación…";
    const ubicacionesInv = [...new Set(db.inventory_items.map((i) => i.ubicacion).filter(Boolean))].sort();
    const lista = db.inventory_items.filter((i) => !fCat || i.cat === fCat);
    const selMovIt = db.inventory_items.find((i) => i.nombre === form.item);
    const selMovSupply = inventorySupplyMode(selMovIt, db.subrecetas || []);

    function abrirPreparacion(item) {
      const supply = inventorySupplyMode(item, db.subrecetas || []);
      if (!supply.subrecipe) return;
      if (!supply.canPrepare) {
        setAvisoInv({ titulo: "Preparación inactiva", texto: `${supply.preparationName} está inactiva en el catálogo de subrecetas. Actívala antes de registrar una tanda.` });
        return;
      }
      go?.("Producción", { subrecipeId: supply.subrecipe.id, itemId: item.id, source: "Inventario" });
    }

    function abrirMovimiento(item, tipo = "Entrada") {
      if (tipo === "Entrada" && inventorySupplyMode(item, db.subrecetas || []).kind === "prepared") {
        abrirPreparacion(item);
        return;
      }
      setForm({
        tipo,
        item: item.nombre,
        cant: "",
        precio: "",
        vence: "",
        proveedor: item.proveedor || "",
        ubicacion: item.ubicacion || "",
        nota: tipo === "Entrada" ? "Compra de inventario" : "",
        suggestionIds: [],
      });
      setMov(true);
    }

    function abrirCompraAsistida(recommendation) {
      const item = db.inventory_items.find((candidate) => candidate.id === recommendation.itemId);
      if (!item) return;
      setForm({
        tipo: "Entrada",
        item: item.nombre,
        cant: String(recommendation.quantity),
        precio: "",
        vence: "",
        proveedor: recommendation.supplier === "Proveedor por definir" ? "" : recommendation.supplier,
        ubicacion: recommendation.location || item.ubicacion || "",
        nota: `Compra sugerida por MOMOS OPS · ${recommendation.reasons.join(" · ")}`,
        suggestionIds: recommendation.suggestionIds || [],
      });
      setAsistenteComprasAbierto(false);
      setMov(true);
    }

    async function refrescarSilencioso(onFail) {
      try {
        await refrescar();
      } catch (e) {
        onFail();
      }
    }

    function exportar() {
      downloadCSV("inventario",
        ["Nombre","Categoría","Unidad","Stock","Mínimo","Costo unitario","Proveedor","Vence","Ubicación"],
        db.inventory_items.map((i) => [i.nombre, i.cat, i.unidad, i.stock, i.min, i.costo, i.proveedor, i.vence, i.ubicacion]));
    }

    const totalInsumos = db.inventory_items.length;
    const bajoMinimo = db.inventory_items.filter((i) => Number(i.min) > 0 && Number(i.stock) <= Number(i.min)).length;
    const porVencerInv = db.inventory_items.filter((i) => {
      if (!i.vence) return false;
      const d = diasEntre(hoyISO(), i.vence);
      return d != null && d <= 7;
    }).length;
    const valorStock = db.inventory_items.reduce((acc, i) => acc + Number(i.stock || 0) * Number(i.costo || 0), 0);
    const reposicionPendiente = db.production_suggestions.filter((s) => s.area === "Inventario" && s.estado === "Pendiente").length;
    const reservationBuckets = useMemo(() => partitionByActivity(db.inventory_reservations || [], isActiveInventoryReservation), [db.inventory_reservations]);
    const activeReservations = useMemo(() => [...reservationBuckets.active].sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || ""))), [reservationBuckets.active]);
    const reservationDashboard = useMemo(() => buildActiveReservationDashboard(db), [db.inventory_reservations, db.orders, db.customers]);
    const inventoryHistory = useMemo(() => buildInventoryHistory(db), [db.inventory_movements, db.inventory_reservations]);
    const purchaseAssistant = useMemo(() => buildPurchaseAssistant({
      inventoryItems: db.inventory_items,
      inventoryLots: db.inventory_lots,
      inventoryLotsReady: db.inventoryLotsReady,
      subrecipes: db.subrecetas,
      suggestions: db.production_suggestions,
      movements: db.inventory_movements,
      today: hoyISO(),
    }), [db.inventory_items, db.inventory_lots, db.inventoryLotsReady, db.subrecetas, db.production_suggestions, db.inventory_movements]);
    const activeAttentionCount = bajoMinimo + porVencerInv + reposicionPendiente;
    const detalleInsumo = detalleInsumoId ? db.inventory_items.find((item) => item.id === detalleInsumoId) : null;

    function estadoInsumo(item) {
      const supply = inventorySupplyMode(item, db.subrecetas || []);
      const lotesListos = Boolean(db.inventoryLotsReady);
      const lotSummary = buildIngredientLotSummary(item.id, db.inventory_lots || [], hoyISO());
      const diasVence = item.vence ? diasEntre(hoyISO(), item.vence) : null;
      const vencidoLegacy = diasVence != null && diasVence < 0;
      const vencido = lotesListos ? lotSummary.expiredStock > 0 : vencidoLegacy;
      const todoVencido = lotesListos ? lotSummary.expiredStock > 0 && lotSummary.usableStock === 0 : vencidoLegacy;
      const venceHoy = lotesListos ? lotSummary.usable.some((lot) => lot.status === "Vence hoy") : diasVence === 0;
      const proximoVence = lotesListos ? lotSummary.nextExpiry : item.vence;
      const diasProximo = proximoVence ? diasEntre(hoyISO(), proximoVence) : null;
      return { supply, lotesListos, lotSummary, vencido, todoVencido, venceHoy, proximoVence, vencePronto: diasProximo != null && diasProximo > 0 && diasProximo <= 5, bajo: Number(item.min) > 0 && Number(item.stock) <= Number(item.min) };
    }

    function mutationIntent(kind, payload) {
      const fingerprint = `${kind}:${JSON.stringify(payload)}`;
      let key = mutationIntentKeysRef.current.get(fingerprint);
      if (!key) {
        key = createInventoryIdempotencyKey();
        mutationIntentKeysRef.current.set(fingerprint, key);
        if (mutationIntentKeysRef.current.size > 20) {
          const oldest = mutationIntentKeysRef.current.keys().next().value;
          mutationIntentKeysRef.current.delete(oldest);
        }
      }
      return { fingerprint, key };
    }

    async function applyInventoryMutationOrReconcile(response, fallbackMessage, mutationGeneration) {
      try {
        const result = aplicarDeltaInventario(response, mutationGeneration);
        if (result?.status === "discarded") {
          await solicitarConciliacionInventario();
          return "reconciled";
        }
        return "applied";
      } catch (error) {
        if (typeof solicitarConciliacionInventario === "function") {
          await solicitarConciliacionInventario();
        } else {
          await refrescarSilencioso(() => toast("alert", fallbackMessage));
        }
        return "reconciled";
      }
    }

    const detalleEstado = detalleInsumo ? estadoInsumo(detalleInsumo) : null;
    const detalleMovimientos = detalleInsumo ? (db.inventory_movements || []).filter((movement) => movement.item === detalleInsumo.nombre).slice(0, 12) : [];
    const detalleReservas = detalleInsumo ? (db.inventory_reservations || []).filter((reservation) => isActiveInventoryReservation(reservation) && (reservation.refId === detalleInsumo.id || reservation.nombre === detalleInsumo.nombre)) : [];

    return (
      <div>
        <SectionTitle action={<InventoryScopeTabs value={scope} onChange={setScope} operationCount={activeAttentionCount} reservationCount={activeReservations.length} historyCount={inventoryHistory.length} />}>Inventario de insumos</SectionTitle>
        <div className="text-xs font-semibold mb-3 -mt-3" style={{ color: T.choco2 }}>
          {scope === "active" ? "Lo que requiere atención ahora: stock, vencimientos y reposición." : scope === "reservations" ? "Stock comprometido por pedidos pagados, con su origen, antigüedad y alertas." : "Movimientos y reservas cerradas, ordenados para consultar sin cargar la operación diaria."}
        </div>

        {scope === "active" ? <>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <Stat icon="📦" label="Insumos" value={totalInsumos} sub="en catálogo" tone={T.coral} />
          <Stat icon="⚠️" label="Bajo mínimo" value={bajoMinimo} sub="requieren reposición" tone="#A03B2A" />
          <Stat icon="⏳" label="Por vencer" value={porVencerInv} sub="en 7 días o menos" tone="#96690F" />
          <Stat icon="💰" label="Valor en stock" value={fmt(valorStock)} sub="a costo de compra" tone="#3F6B42" />
        </div>
        <Card className="p-4 mt-3 mb-4" onClick={() => setAsistenteComprasAbierto(true)} style={{ background: "linear-gradient(135deg,#FFF5E8,#FFFFFF)", borderColor: purchaseAssistant.summary.urgent ? "#E7B36E" : T.border }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <span className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl shrink-0" style={{ background: T.vainilla }} aria-hidden="true">🛒</span>
              <div className="min-w-0"><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Asistente de compras</div><div className="display text-lg font-semibold mt-0.5">{purchaseAssistant.summary.items ? `${purchaseAssistant.summary.items} insumo${purchaseAssistant.summary.items === 1 ? "" : "s"} para revisar` : "No hace falta comprar hoy"}</div><div className="text-xs font-semibold mt-0.5" style={{ color: T.choco2 }}>{purchaseAssistant.summary.items ? `${purchaseAssistant.summary.urgent} urgente${purchaseAssistant.summary.urgent === 1 ? "" : "s"} · presupuesto estimado ${fmt(purchaseAssistant.summary.estimatedCost)} · nunca compra sin tu confirmación` : "El stock utilizable cubre los mínimos y no hay faltantes de pedidos."}</div></div>
            </div>
            <span className="text-xs font-extrabold shrink-0" style={{ color: T.coral }}>{purchaseAssistant.summary.items ? "Ver lista sugerida ›" : "Ver análisis ›"}</span>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Btn onClick={() => { setFi({ nombre: "", cat: "", unidad: "und", stock: "", min: "", costoTotal: "", proveedor: "", vence: "", ubicacion: "" }); setErrIns(""); setNuevoIns(true); }}>＋ Nuevo insumo</Btn>
          <Btn kind="soft" onClick={() => { setForm({ tipo: "Entrada", item: "", cant: "", precio: "", vence: "", proveedor: "", ubicacion: "", nota: "", suggestionIds: [] }); setMov(true); }}>＋ Registrar movimiento</Btn>
          <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
        </div>

        <SegmentedTabs
          ariaLabel="Categorías de insumos"
          value={fCat}
          onChange={setFCat}
          items={[["Todas", ""], ...cats.map((category) => [category, category])]}
          getCount={(value) => value ? db.inventory_items.filter((item) => item.cat === value).length : totalInsumos}
        />

        {(() => {
          const compras = db.production_suggestions.filter((s) => {
            if (s.area !== "Inventario" || s.estado !== "Pendiente") return false;
            const item = db.inventory_items.find((candidate) => candidate.id === s.itemId || candidate.nombre === s.producto);
            return inventorySupplyMode(item, db.subrecetas || []).kind === "prepared";
          });
          if (compras.length === 0) return null;
          return (
            <div className="mb-4">
              <SectionTitle>🥣 Preparaciones internas pendientes</SectionTitle>
              <div className="grid sm:grid-cols-2 gap-2">
                {compras.map((sg) => {
                  const item = db.inventory_items.find((candidate) => candidate.id === sg.itemId || candidate.nombre === sg.producto);
                  const supply = inventorySupplyMode(item, db.subrecetas || []);
                  return (
                  <Card key={sg.id} className="p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold">{sg.cantidad}× {sg.producto}</div>
                      <div className="text-xs" style={{ color: T.choco2 }}>{supply.kind === "prepared" ? "Preparar en Cocina" : "Comprar a proveedor"} · falta para {sg.orderId ? "pedido " + sg.orderId : "reponer stock"} · {sg.fecha}</div>
                    </div>
                    {supply.kind === "prepared" ? (
                      <Btn small kind="soft" onClick={() => item && abrirPreparacion(item)}>🥣 Preparar</Btn>
                    ) : (
                    <BtnAsync small kind="soft" textoEnVuelo="Marcando…" disabled={enviandoSugId === sg.id} onClick={async () => {
                      setEnviandoSugId(sg.id);
                      try {
                        await setSugerenciaEstado(sg.id, "Atendida");
                      } catch (e) {
                        toast("error", "No se pudo marcar la sugerencia: " + e.message);
                        setEnviandoSugId(null);
                        return;
                      }
                      setEnviandoSugId(null);
                      toast("ok", `✓ ${sg.producto} · compra atendida`);
                      await refrescarSilencioso(() => toast("alert", "La sugerencia se marcó, pero no se pudo actualizar la vista. Recargá la página."));
                    }}>Marcar compra atendida</BtnAsync>
                    )}
                  </Card>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lista.map((i) => {
            const { supply, lotesListos, lotSummary, vencido, todoVencido, venceHoy, proximoVence, vencePronto, bajo } = estadoInsumo(i);
            const hl = highlightId === i.id;
            return (
              <div key={i.id} ref={hl ? highlightRef : null} className="rounded-2xl" style={hl ? { boxShadow: `0 0 0 3px ${T.coral}` } : undefined}>
              <Card className="momo-queue-item p-4" onClick={() => setDetalleInsumoId(i.id)} aria-label={`Abrir detalle de ${i.nombre}`} style={todoVencido ? { borderColor: "#D66A59", background: "#FFF5F2" } : vencido || venceHoy ? { borderColor: "#E9A45F", background: vencido ? "#FFFAF2" : undefined } : undefined}>
                <div className="flex justify-between items-start gap-2">
                  <div className="font-bold text-sm leading-tight">{i.nombre}</div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: T.vainilla, color: T.choco2 }}>{i.cat}</span>
                </div>
                <div className="flex items-end gap-1 mt-2">
                  <span className="display text-2xl" style={{ color: bajo ? "#A03B2A" : T.coral }}>{i.stock}</span>
                  <span className="text-xs font-semibold mb-1" style={{ color: T.choco2 }}>{i.unidad} · mín {i.min}</span>
                </div>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {supply.kind === "prepared" && <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: "#E8E0F2", color: "#63518A" }}>🥣 Elaboración interna</span>}
                  {bajo && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#F6D4CD", color: "#A03B2A" }}>Stock bajo</span>}
                  {todoVencido && <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: "#A03B2A", color: "#fff" }}>Vencido · no usar</span>}
                  {lotesListos && vencido && !todoVencido && <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: "#FBE8C8", color: "#96690F" }}>{lotSummary.expiredStock} {i.unidad} en cuarentena</span>}
                  {venceHoy && <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: "#F6D4CD", color: "#A03B2A" }}>Vence hoy</span>}
                  {vencePronto && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FBE8C8", color: "#96690F" }}>Vence pronto</span>}
                  {i.costoEstimado && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FBE8C8", color: "#96690F" }}>≈ costo estimado</span>}
                </div>
                <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t text-[11px] font-bold" style={{ borderColor: T.border, color: T.choco2 }}><span>{lotesListos ? `${lotSummary.active.length} lote${lotSummary.active.length === 1 ? "" : "s"}` : "Stock consolidado"}{proximoVence ? ` · próximo ${proximoVence}` : ""}</span><span style={{ color: T.coral }}>Abrir detalle ›</span></div>
              </Card>
              </div>
            );
          })}
        </div>

        <Card className="p-4 mt-5" onClick={() => setScope("reservations")}>
          <div className="flex items-center justify-between gap-4">
            <div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>Stock comprometido</div><div className="font-bold mt-0.5">{activeReservations.length} reserva{activeReservations.length === 1 ? "" : "s"} vigente{activeReservations.length === 1 ? "" : "s"} en {reservationDashboard.summary.orders} pedido{reservationDashboard.summary.orders === 1 ? "" : "s"}</div><div className="text-xs font-semibold mt-0.5" style={{ color: T.choco2 }}>Abrí Reservas para consultar lote físico, antigüedad y alertas por pedido.</div></div>
            <span className="text-xl" style={{ color: T.coral }}>›</span>
          </div>
        </Card>
        </> : scope === "reservations" ? <InventoryReservationsPanel dashboard={reservationDashboard} go={go} /> : <InventoryHistoryPanel entries={inventoryHistory} go={go} />}

        {asistenteComprasAbierto && (
          <Modal title="Asistente de compras" onClose={() => setAsistenteComprasAbierto(false)} wide>
            <div className="rounded-3xl border p-4 sm:p-5 mb-4" style={{ background: "linear-gradient(135deg,#FFF5E8,#FFFFFF)", borderColor: T.border }}>
              <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Decisión explicable</div>
              <div className="display text-2xl font-semibold mt-1">Qué conviene comprar hoy</div>
              <div className="text-sm font-semibold mt-1 max-w-2xl" style={{ color: T.choco2 }}>MOMO OPS cruza stock utilizable, lotes vencidos, mínimos, consumo reciente y faltantes reales de pedidos. La cantidad queda editable y nada entra al inventario hasta que confirmes la compra física.</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Insumos</div><div className="display text-xl mt-0.5" style={{ color: T.coral }}>{purchaseAssistant.summary.items}</div></div>
                <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Urgentes</div><div className="display text-xl mt-0.5" style={{ color: purchaseAssistant.summary.urgent ? "#A03B2A" : "#3F6B42" }}>{purchaseAssistant.summary.urgent}</div></div>
                <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Proveedores</div><div className="display text-xl mt-0.5">{purchaseAssistant.suppliers.length}</div></div>
                <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Presupuesto</div><div className="display text-lg mt-0.5" style={{ color: "#3F6B42" }}>{fmt(purchaseAssistant.summary.estimatedCost)}</div></div>
              </div>
            </div>

            {purchaseAssistant.recommendations.length === 0 ? (
              <div className="rounded-3xl p-8 text-center" style={{ background: "#E5F0E1" }}><div className="text-3xl">✓</div><div className="display text-xl mt-2">Compras al día</div><div className="text-sm font-semibold mt-1" style={{ color: "#3F6B42" }}>No hay faltantes ni insumos externos por debajo de su cobertura mínima.</div></div>
            ) : (
              <div className="space-y-4">
                {purchaseAssistant.suppliers.map((group) => (
                  <Card key={group.supplier} className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3"><div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>Proveedor</div><div className="display text-lg font-semibold">{group.supplier}</div></div><div className="text-right"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Estimado</div><div className="font-extrabold" style={{ color: "#3F6B42" }}>{fmt(group.estimatedCost)}</div></div></div>
                    <div className="space-y-2">
                      {group.items.map((recommendation) => (
                        <div key={recommendation.itemId} className="rounded-2xl border p-3 flex flex-col sm:flex-row sm:items-center gap-3" style={{ borderColor: recommendation.priority === "Urgente" ? "#E8B7AD" : T.border, background: recommendation.priority === "Urgente" ? "#FFF7F4" : T.surface }}>
                          <div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2"><div className="font-extrabold">{recommendation.name}</div><Badge label={recommendation.priority} map={{ Urgente: { bg: "#F6D4CD", fg: "#A03B2A" }, Alta: { bg: "#FBE8C8", fg: "#96690F" }, Revisar: { bg: T.vainilla, fg: T.choco2 } }} /></div><div className="text-xs font-bold mt-1" style={{ color: T.choco2 }}>Comprar <b style={{ color: T.coral }}>{recommendation.quantity} {recommendation.unit}</b> · quedan {recommendation.current} · mínimo {recommendation.minimum}</div><div className="text-[11px] font-semibold mt-1" style={{ color: T.choco2 }}>{recommendation.reasons.join(" · ")}</div></div>
                          <div className="flex sm:flex-col sm:items-end justify-between gap-2 shrink-0"><div className="text-xs font-extrabold" style={{ color: "#3F6B42" }}>≈ {fmt(recommendation.estimatedCost)}</div><Btn small onClick={() => abrirCompraAsistida(recommendation)}>Preparar compra</Btn></div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            )}
            {purchaseAssistant.summary.internalPending > 0 && <div className="rounded-2xl px-4 py-3 mt-4 text-xs font-bold" style={{ background: "#EEE8F5", color: "#63518A" }}>🥣 {purchaseAssistant.summary.internalPending} faltante{purchaseAssistant.summary.internalPending === 1 ? "" : "s"} corresponde{purchaseAssistant.summary.internalPending === 1 ? "" : "n"} a elaboraciones internas. No aparecen como compra: se atienden preparando una tanda en Cocina.</div>}
            {purchaseAssistant.internalNeedsSetup.length > 0 && <div className="rounded-2xl px-4 py-3 mt-3 text-xs font-bold" style={{ background: "#FFF0DD", color: "#7B5410" }}>⚙ {purchaseAssistant.internalNeedsSetup.map((row) => row.name).join(", ")} {purchaseAssistant.internalNeedsSetup.length === 1 ? "está marcada" : "están marcadas"} como producción propia, pero {purchaseAssistant.internalNeedsSetup.length === 1 ? "le falta" : "les falta"} una fórmula activa. MOMOS OPS no {purchaseAssistant.internalNeedsSetup.length === 1 ? "la" : "las"} enviará a compras hasta corregir esa ficha.</div>}
          </Modal>
        )}

        {detalleInsumo && detalleEstado && (
          <Modal title={`Insumo · ${detalleInsumo.nombre}`} onClose={() => setDetalleInsumoId(null)} wide>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>{detalleInsumo.cat}</div><div className="display text-2xl font-semibold mt-0.5">{detalleInsumo.nombre}</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{detalleEstado.supply.kind === "prepared" ? "Elaboración interna preparada en Cocina" : "Insumo comprado a proveedor"}</div></div>
              <div className="flex gap-1.5 flex-wrap">{detalleEstado.bajo && <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: "#F6D4CD", color: "#A03B2A" }}>Stock bajo</span>}{detalleEstado.todoVencido && <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: "#A03B2A", color: "#fff" }}>Vencido · no usar</span>}{detalleEstado.vencePronto && <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: "#FBE8C8", color: "#96690F" }}>Vence pronto</span>}</div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <Stat icon="📦" label="Stock total" value={`${detalleInsumo.stock} ${detalleInsumo.unidad}`} sub={`mínimo ${detalleInsumo.min}`} tone={detalleEstado.bajo ? "#A03B2A" : T.coral} />
              <Stat icon="✓" label="Stock utilizable" value={`${detalleEstado.lotesListos ? detalleEstado.lotSummary.usableStock : detalleEstado.todoVencido ? 0 : detalleInsumo.stock} ${detalleInsumo.unidad}`} sub="vigente para operación" tone="#3F6B42" />
              <Stat icon="△" label="En cuarentena" value={`${detalleEstado.lotesListos ? detalleEstado.lotSummary.expiredStock : detalleEstado.todoVencido ? detalleInsumo.stock : 0} ${detalleInsumo.unidad}`} sub="vencido, no utilizar" tone="#A03B2A" />
              <Stat icon="▦" label="Reservado" value={detalleReservas.reduce((sum, row) => sum + Number(row.cantidad || 0), 0)} sub={`${detalleReservas.length} pedido(s)`} tone="#63518A" />
            </div>

            <Card className="p-4 mb-4">
              <div className="text-xs font-extrabold mb-3" style={{ color: T.choco2 }}>FICHA DEL INSUMO</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-3 text-xs">
                <div><div className="font-semibold" style={{ color: T.choco2 }}>Costo unitario</div><div className="font-bold mt-0.5">{fmt(detalleInsumo.costo)} / {detalleInsumo.unidad}</div></div>
                <div><div className="font-semibold" style={{ color: T.choco2 }}>Proveedor</div><div className="font-bold mt-0.5">{detalleInsumo.proveedor || "Sin registrar"}</div></div>
                <div><div className="font-semibold" style={{ color: T.choco2 }}>Ubicación</div><div className="font-bold mt-0.5">{detalleInsumo.ubicacion || "Sin registrar"}</div></div>
                <div><div className="font-semibold" style={{ color: T.choco2 }}>Próximo vencimiento</div><div className="font-bold mt-0.5">{detalleEstado.proximoVence || "Sin vencimiento"}</div></div>
              </div>
            </Card>

            <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-3 mb-4">
              <Card className="p-4">
                <div className="flex items-center justify-between gap-3 mb-3"><div><div className="text-xs font-extrabold" style={{ color: T.choco2 }}>LOTES DEL INSUMO</div><div className="text-[10px] font-semibold mt-0.5" style={{ color: T.choco2 }}>FIFO usa primero el lote vigente que vence antes.</div></div><span className="text-xs font-extrabold" style={{ color: T.coral }}>{detalleEstado.lotSummary.active.length}</span></div>
                <div className="space-y-2">{detalleEstado.lotesListos && detalleEstado.lotSummary.active.map((lot) => <div key={lot.id} className="rounded-xl border p-3" style={{ borderColor: lot.status === "Vencido" ? "#ECBBB1" : T.border, background: lot.status === "Vencido" ? "#FFF5F2" : T.surface }}><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-bold">{lot.id} · {lot.available} {detalleInsumo.unidad}</div><div className="text-[10px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{lot.expiresAt ? `Vence ${lot.expiresAt}` : "Sin vencimiento"}{lot.supplier ? ` · ${lot.supplier}` : ""}{lot.location ? ` · ${lot.location}` : ""}</div></div><Badge label={lot.status} map={{ Disponible: { bg: "#DDEBD9", fg: "#3F6B42" }, "Vence hoy": { bg: "#FBE8C8", fg: "#96690F" }, Vencido: { bg: "#F6D4CD", fg: "#A03B2A" } }} /></div>{lot.status === "Vencido" && ["Administrador","Cocina"].includes(user) && <div className="mt-2"><Btn small kind="danger" onClick={() => { setMotivoDesecho(`Vencido desde ${lot.expiresAt}`); setDesecharVencido({ ...lot, itemName: detalleInsumo.nombre, unit: detalleInsumo.unidad }); }}>Desechar este lote</Btn></div>}</div>)}{!detalleEstado.lotesListos && <div className="rounded-xl p-3 text-xs font-semibold" style={{ background: T.vainilla, color: T.choco2 }}>Este insumo conserva stock consolidado anterior a la trazabilidad por lotes.</div>}{detalleEstado.lotesListos && detalleEstado.lotSummary.active.length === 0 && <div className="text-xs font-semibold" style={{ color: T.choco2 }}>No hay lotes con saldo disponible.</div>}</div>
              </Card>

              <Card className="p-4">
                <div className="text-xs font-extrabold mb-3" style={{ color: T.choco2 }}>RESERVAS VIGENTES</div>
                <div className="space-y-2">{detalleReservas.map((reservation) => <div key={reservation.id} className="rounded-xl px-3 py-2.5 flex items-center justify-between gap-3" style={{ background: T.vainilla }}><div><div className="text-sm font-bold">{reservation.cantidad} {detalleInsumo.unidad} · {reservation.orderId}</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>{reservation.id} · {reservation.fecha}</div></div><Badge label={reservation.estado} /></div>)}{detalleReservas.length === 0 && <div className="text-xs font-semibold" style={{ color: T.choco2 }}>No hay stock de este insumo comprometido por pedidos.</div>}</div>
              </Card>
            </div>

            <Card className="p-4 mb-4">
              <div className="flex items-center justify-between gap-3 mb-2"><div><div className="text-xs font-extrabold" style={{ color: T.choco2 }}>MOVIMIENTOS RECIENTES</div><div className="text-[10px] font-semibold mt-0.5" style={{ color: T.choco2 }}>Entradas, usos, ajustes y mermas de este insumo.</div></div><span className="text-xs font-extrabold" style={{ color: T.coral }}>{detalleMovimientos.length}</span></div>
              <div>{detalleMovimientos.map((movement) => <div key={movement.id} className="flex items-start justify-between gap-3 py-2 border-t first:border-0 text-xs" style={{ borderColor: T.border }}><div><div className="font-bold">{movement.tipo} · {movement.cant}</div><div className="text-[10px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{movement.nota || "Sin nota"}</div></div><time className="text-[10px] font-bold shrink-0" style={{ color: T.choco2 }}>{movement.fecha}</time></div>)}{detalleMovimientos.length === 0 && <div className="text-xs font-semibold py-2" style={{ color: T.choco2 }}>Todavía no hay movimientos registrados.</div>}</div>
            </Card>

            <div className="flex flex-wrap gap-2 pt-4 border-t" style={{ borderColor: T.border }}>
              {detalleEstado.supply.kind === "prepared" ? <Btn kind="soft" disabled={!detalleEstado.supply.canPrepare} onClick={() => abrirPreparacion(detalleInsumo)}>🥣 Preparar tanda</Btn> : <Btn kind="soft" onClick={() => abrirMovimiento(detalleInsumo, "Entrada")}>＋ Registrar compra</Btn>}
              {detalleEstado.supply.kind === "prepared" && db.internalPreparationFormulaReady === true && <Btn kind="ghost" onClick={() => {
                const subrecipeId = String(detalleEstado.supply.subrecipe.id);
                setDetalleInsumoId(null);
                go?.("Producción", { subrecipeId, manageKitchenSheet: true, source: "Inventario" });
              }}>📖 Gestionar en Producción</Btn>}
              <Btn kind="ghost" onClick={() => abrirMovimiento(detalleInsumo, "Ajuste")}>Registrar otro movimiento</Btn>
              {!detalleEstado.lotesListos && detalleEstado.vencido && Number(detalleInsumo.stock) > 0 && ["Administrador","Cocina"].includes(user) && <Btn kind="danger" onClick={() => { setMotivoDesecho(`Vencido desde ${detalleInsumo.vence}`); setDesecharVencido({ itemId: detalleInsumo.id, itemName: detalleInsumo.nombre, available: Number(detalleInsumo.stock), unit: detalleInsumo.unidad, expiresAt: detalleInsumo.vence }); }}>Desechar vencido</Btn>}
            </div>
          </Modal>
        )}

        {nuevoIns && (
          <Modal title="Nuevo insumo" onClose={() => setNuevoIns(false)} wide>
            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Nombre del insumo"><Input value={fi.nombre} onChange={(e) => setFi({ ...fi, nombre: e.target.value })} placeholder="Ej: Pulpa de coco 1 kg" /></Field>
              <Field label="Categoría">
                <Select placeholder="Elegir categoría…" options={[...cats, ...(user === "Administrador" ? [NUEVA_CAT] : [])]} value={fi.cat} onChange={(e) => setFi({ ...fi, cat: e.target.value, catNueva: "" })} />
                {fi.cat === NUEVA_CAT && <Input value={fi.catNueva || ""} onChange={(e) => setFi({ ...fi, catNueva: e.target.value })} placeholder="Nombre de la categoría nueva" />}
              </Field>
              <Field label="Unidad de medida"><Select options={["und","kg","g","L","ml","paquete","docena"]} value={fi.unidad} onChange={(e) => setFi({ ...fi, unidad: e.target.value })} /></Field>
              <Field label="Stock inicial"><Input type="number" min="0" step="0.01" value={fi.stock} onChange={(e) => setFi({ ...fi, stock: e.target.value })} placeholder="Cantidad que entra hoy" /></Field>
              <Field label="Stock mínimo (para alertas)"><Input type="number" min="0" step="0.01" value={fi.min} onChange={(e) => setFi({ ...fi, min: e.target.value })} /></Field>
              <Field label="Costo total de la compra"><Input type="number" min="0" value={fi.costoTotal} onChange={(e) => setFi({ ...fi, costoTotal: e.target.value })} placeholder="Lo que pagaste en total (factura)" /></Field>
              <Field label="Proveedor"><Input value={fi.proveedor} onChange={(e) => setFi({ ...fi, proveedor: e.target.value })} placeholder="Ej: Makro, Galería Alameda" /></Field>
              <Field label="Fecha de vencimiento (opcional)"><Input type="date" value={fi.vence} onChange={(e) => setFi({ ...fi, vence: e.target.value })} /></Field>
              <Field label="Ubicación">
                <Select placeholder="Elegir ubicación…" options={[...ubicacionesInv, ...(user === "Administrador" ? [NUEVA_UBI] : [])]} value={fi.ubicacion} onChange={(e) => setFi({ ...fi, ubicacion: e.target.value, ubiNueva: "" })} />
                {fi.ubicacion === NUEVA_UBI && <Input value={fi.ubiNueva || ""} onChange={(e) => setFi({ ...fi, ubiNueva: e.target.value })} placeholder="Ej: Nevera 1, Congelador A, Estante seco…" />}
              </Field>
            </div>
            {(+fi.costoTotal > 0 && +fi.stock > 0) && (
              <div className="text-xs font-bold mb-3 p-2.5 rounded-xl" style={{ background: "#DDEBD9", color: "#3F6B42" }}>Costo unitario calculado: {fmt(+fi.costoTotal / +fi.stock)} / {fi.unidad}  ·  (costo total ÷ stock inicial)</div>
            )}
            {(+fi.costoTotal > 0 && !(+fi.stock > 0)) && (
              <div className="text-xs font-semibold mb-3" style={{ color: "#A03B2A" }}>Poné el stock inicial (cantidad comprada) para calcular el costo unitario.</div>
            )}
            {errIns && <div className="text-sm font-bold p-2.5 rounded-xl mb-3" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{errIns}</div>}
            <div className="text-xs font-semibold mb-3" style={{ color: T.choco2 }}>El stock inicial quedará registrado como un movimiento de entrada (fecha de compra: hoy).</div>
            <div className="flex gap-2">
              <BtnAsync textoEnVuelo="Creando…" disabled={enviando} onClick={async () => {
                // Centinelas "➕ Nueva…" (solo admin): el valor final sale del input de texto.
                const catFinal = fi.cat === NUEVA_CAT ? (fi.catNueva || "").trim() : fi.cat.trim();
                const ubiFinal = fi.ubicacion === NUEVA_UBI ? (fi.ubiNueva || "").trim() : fi.ubicacion.trim();
                if (!fi.nombre.trim()) { setErrIns("Escribe el nombre del insumo."); return; }
                if (db.inventory_items.some((i) => i.nombre.toLowerCase() === fi.nombre.trim().toLowerCase())) { setErrIns("Ya existe un insumo con ese nombre. Usa “Registrar movimiento” para sumarle stock."); return; }
                if (!catFinal) { setErrIns("Indica la categoría."); return; }
                setErrIns("");
                setEnviando(true);
                const nombreCreado = fi.nombre.trim();
                try {
                  await crearInsumo({
                    nombre: nombreCreado, cat: catFinal, unidad: fi.unidad,
                    stock: parseFloat(fi.stock) || 0, minimo: parseFloat(fi.min) || 0,
                    costo_total: +fi.costoTotal || 0, proveedor: fi.proveedor.trim(),
                    vence: fi.vence || null, ubicacion: ubiFinal,
                  });
                } catch (e) {
                  setErrIns(e.message);
                  setEnviando(false);
                  return;
                }
                setEnviando(false);
                setNuevoIns(false);
                toast("ok", `✓ Insumo ${nombreCreado} creado`);
                await refrescarSilencioso(() => toast("alert", "El insumo se creó, pero no se pudo actualizar la vista. Recargá la página."));
              }}>Crear insumo</BtnAsync>
              <Btn kind="ghost" disabled={enviando} onClick={() => setNuevoIns(false)}>Cancelar</Btn>
            </div>
          </Modal>
        )}

        {mov && (
          <Modal title={selMovIt ? `Movimiento · ${selMovIt.nombre}` : "Registrar movimiento de inventario"} onClose={() => setMov(false)}>
            <Field label="Tipo"><Select options={["Entrada","Salida","Ajuste","Merma","Uso en producción"]} value={form.tipo} onChange={(e) => {
              const nextType = e.target.value;
              if (nextType === "Entrada" && selMovSupply.kind === "prepared") {
                setMov(false);
                abrirPreparacion(selMovIt);
                return;
              }
              setForm({ ...form, tipo: nextType });
            }} /></Field>
            <Field label="Ítem"><Select placeholder="Elegir ítem…" options={db.inventory_items.map((i) => i.nombre)} value={form.item} onChange={(e) => {
              const nextItem = db.inventory_items.find((item) => item.nombre === e.target.value);
              if (form.tipo === "Entrada" && inventorySupplyMode(nextItem, db.subrecetas || []).kind === "prepared") {
                setMov(false);
                abrirPreparacion(nextItem);
                return;
              }
              setForm({ ...form, item: e.target.value });
            }} /></Field>
            {form.tipo === "Entrada" ? (
              <>
                <Field label={"Cantidad comprada" + (selMovIt ? " (en " + selMovIt.unidad + ")" : "")}>
                  <div className="flex items-center gap-2">
                    <Input type="number" min="0" step="0.01" value={form.cant} onChange={(e) => setForm({ ...form, cant: e.target.value })} placeholder="Ej: 3" />
                    <span className="text-sm font-bold px-2.5 py-2 rounded-lg whitespace-nowrap" style={{ background: "#EBE6E0", color: T.choco2 }}>{selMovIt ? selMovIt.unidad : "unidad"}</span>
                  </div>
                </Field>
                <Field label="Costo total de la compra"><Input type="number" min="0" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} placeholder="Lo que pagaste en total (factura)" /></Field>
                <Field label="Vencimiento de este lote (opcional)"><Input type="date" min={hoyISO()} value={form.vence} onChange={(e) => setForm({ ...form, vence: e.target.value })} /></Field>
                <Field label="Proveedor de este lote"><Input value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} /></Field>
                <Field label="Ubicación"><Input value={form.ubicacion} onChange={(e) => setForm({ ...form, ubicacion: e.target.value })} /></Field>
              </>
            ) : (
              <Field label="Cantidad (ej: +5, -0.5)"><Input value={form.cant} onChange={(e) => setForm({ ...form, cant: e.target.value })} /></Field>
            )}
            <Field label="Nota"><Input value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} placeholder="Pedido, lote o motivo" /></Field>
            {form.tipo === "Entrada" && (
              (selMovIt && +form.cant > 0 && form.precio !== "" && +form.precio >= 0) ? (
                <div className="text-xs font-bold mt-1 p-2.5 rounded-xl" style={{ background: "#DDEBD9", color: "#3F6B42" }}>
                  {(() => {
                    const cant = +form.cant, total = +form.precio || 0;
                    if (!(total > 0)) return "Entrada sin costo: solo suma stock, el costo unitario NO cambia (" + fmt(selMovIt.costo || 0) + "/" + selMovIt.unidad + ").";
                    const cc = total / cant;
                    const sn = (selMovIt.stock || 0) + cant;
                    const wac = sn > 0 ? ((selMovIt.stock || 0) * (selMovIt.costo || 0) + cant * cc) / sn : (selMovIt.costo || 0);
                    return "Costo de esta compra: " + fmt(cc) + "/" + selMovIt.unidad + "  ·  Nuevo costo promedio: " + fmt(wac) + "/" + selMovIt.unidad + " (antes " + fmt(selMovIt.costo || 0) + ")";
                  })()}
                </div>
              ) : (
                <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Cargá cantidad comprada y costo total; el costo unitario se recalcula solo (promedio ponderado).</div>
              )
            )}
            <div className="flex gap-2 mt-2">
              <BtnAsync textoEnVuelo="Guardando…" disabled={enviando} onClick={async () => {
                if (!form.item || !form.cant) { setAvisoInv({ titulo: "Faltan datos", texto: "Elegí el insumo e indicá una cantidad." }); return; }
                const cantidadMovimiento = Number(form.cant);
                if (!Number.isFinite(cantidadMovimiento) || cantidadMovimiento === 0) { setAvisoInv({ titulo: "Cantidad inválida", texto: "Ingresá una cantidad numérica distinta de cero." }); return; }
                if (form.tipo === "Entrada" && (!(cantidadMovimiento > 0) || form.precio === "" || !Number.isFinite(Number(form.precio)) || +form.precio < 0)) { setAvisoInv({ titulo: "Entrada inválida", texto: "La cantidad debe ser mayor que cero y el costo total no puede ser negativo." }); return; }
                const it = db.inventory_items.find((i) => i.nombre === form.item);
                if (!it) return;
                if (form.tipo === "Entrada" && inventorySupplyMode(it, db.subrecetas || []).kind === "prepared") {
                  setMov(false);
                  abrirPreparacion(it);
                  return;
                }
                const itemVencido = it.vence && diasEntre(hoyISO(), it.vence) < 0;
                if (itemVencido && ["Salida", "Uso en producción"].includes(form.tipo)) { setAvisoInv({ titulo: "Insumo vencido", texto: `${it.nombre} venció el ${it.vence}. Registrá una Merma para retirarlo; no puede usarse ni salir como inventario válido.` }); return; }
                const tipoMov = form.tipo, nombreMov = it.nombre;
                const suggestionIds = Array.isArray(form.suggestionIds) ? form.suggestionIds : [];
                let inventoryUpdateMode = "legacy";
                let compoundApplied = false;
                setEnviando(true);
                try {
                  if (form.tipo === "Entrada") {
                    const payload = { itemId: it.id, cant: +form.cant, costoTotal: +form.precio || 0, vence: form.vence || null, proveedor: form.proveedor, ubicacion: form.ubicacion, nota: form.nota };
                    if (db.inventoryMutationDeltaReady && db.inventoryLotsReady) {
                      const intentPayload = suggestionIds.length
                        ? { ...payload, suggestionIds: [...suggestionIds].sort() }
                        : payload;
                      const intent = mutationIntent(suggestionIds.length ? "entrada-con-sugerencias" : "entrada", intentPayload);
                      try {
                        const mutationGeneration = capturarGeneracionInventario();
                        let response;
                        if (suggestionIds.length) {
                          try {
                            const compound = await registrarCompraYAtenderSugerencias(payload, suggestionIds, intent.key);
                            response = compound?.inventory;
                            compoundApplied = true;
                          } catch (error) {
                            if (!isMissingRpcError(error)) throw error;
                          }
                        }
                        if (!compoundApplied) response = await entradaInsumoLoteDelta(payload, intent.key);
                        mutationIntentKeysRef.current.delete(intent.fingerprint);
                        inventoryUpdateMode = await applyInventoryMutationOrReconcile(
                          response,
                          "La compra se registró, pero no se pudo conciliar el insumo. Recargá la página.",
                          mutationGeneration,
                        );
                      } catch (error) {
                        if (!isMissingRpcError(error)) throw error;
                        mutationIntentKeysRef.current.delete(intent.fingerprint);
                        await entradaInsumoLote(payload);
                      }
                    } else if (db.inventoryLotsReady) {
                      await entradaInsumoLote(payload);
                    } else {
                      await entradaInsumo(it.id, +form.cant, +form.precio || 0, form.nota);
                    }
                  } else {
                    const payload = { itemId: it.id, tipo: form.tipo, cant: cantidadMovimiento, nota: form.nota };
                    if (db.inventoryMutationDeltaReady) {
                      const intent = mutationIntent("movimiento", payload);
                      try {
                        const mutationGeneration = capturarGeneracionInventario();
                        const response = await movimientoInsumoDelta(it.id, form.tipo, cantidadMovimiento, form.nota, intent.key);
                        mutationIntentKeysRef.current.delete(intent.fingerprint);
                        inventoryUpdateMode = await applyInventoryMutationOrReconcile(
                          response,
                          "El movimiento se registró, pero no se pudo conciliar el insumo. Recargá la página.",
                          mutationGeneration,
                        );
                      } catch (error) {
                        if (!isMissingRpcError(error)) throw error;
                        mutationIntentKeysRef.current.delete(intent.fingerprint);
                        await movimientoInsumo(it.id, form.tipo, cantidadMovimiento, form.nota);
                      }
                    } else {
                      await movimientoInsumo(it.id, form.tipo, cantidadMovimiento, form.nota);
                    }
                  }
                } catch (e) {
                  toast("error", "No se pudo registrar el movimiento: " + e.message);
                  setEnviando(false);
                  return;
                }
                if (form.tipo === "Entrada" && suggestionIds.length && !compoundApplied) {
                  try {
                    await Promise.all(suggestionIds.map((suggestionId) => setSugerenciaEstado(suggestionId, "Atendida")));
                  } catch (error) {
                    toast("alert", `La compra entró al inventario, pero una sugerencia quedó pendiente: ${error.message}`);
                  }
                }
                setEnviando(false);
                setMov(false); setForm({ tipo: "Entrada", item: "", cant: "", precio: "", vence: "", proveedor: "", ubicacion: "", nota: "", suggestionIds: [] });
                toast("ok", `✓ ${tipoMov} registrada · ${nombreMov}`);
                if (inventoryUpdateMode === "legacy") {
                  await refrescarSilencioso(() => toast("alert", "El movimiento se registró, pero no se pudo actualizar la vista. Recargá la página."));
                }
              }}>Guardar</BtnAsync>
              <Btn kind="ghost" disabled={enviando} onClick={() => setMov(false)}>Cancelar</Btn>
            </div>
          </Modal>
        )}

        {desecharVencido && (
          <Modal title="Desechar insumo vencido" onClose={() => { if (!enviando) setDesecharVencido(null); }}>
            <div className="rounded-2xl p-4 mb-4" style={{ background: "#FFF1ED", border: "1px solid #E9A08F" }}>
              <div className="text-xs font-extrabold uppercase tracking-[.12em]" style={{ color: "#A03B2A" }}>Merma con trazabilidad</div>
              <div className="display text-xl mt-1" style={{ color: T.choco }}>{desecharVencido.itemName}</div>
              <div className="text-sm mt-1" style={{ color: T.choco2 }}>
                Se retirarán <b>{desecharVencido.available} {desecharVencido.unit}</b> del {desecharVencido.id ? `lote ${desecharVencido.id}, ` : ""}vencido el {desecharVencido.expiresAt}. El insumo seguirá visible y el movimiento quedará en el historial.
              </div>
            </div>
            <Field label="Motivo del desecho"><Input value={motivoDesecho} onChange={(e) => setMotivoDesecho(e.target.value)} placeholder="Ej: olor alterado, vencimiento, cadena de frío" /></Field>
            <div className="flex gap-2 mt-2">
              <BtnAsync kind="danger" textoEnVuelo="Desechando…" disabled={enviando} onClick={async () => {
                const stockActual = Number(desecharVencido.available);
                const nombreDesecho = desecharVencido.itemName;
                if (!(stockActual > 0)) {
                  setDesecharVencido(null);
                  setAvisoInv({ titulo: "Sin stock para desechar", texto: "Este insumo ya está en cero." });
                  return;
                }
                if (!motivoDesecho.trim()) {
                  setAvisoInv({ titulo: "Falta el motivo", texto: "Indicá por qué se desecha para conservar la trazabilidad de la merma." });
                  return;
                }
                let inventoryUpdateMode = "legacy";
                setEnviando(true);
                try {
                  if (desecharVencido.id && db.inventoryLotsReady) {
                    const payload = { lotId: desecharVencido.id, motivo: motivoDesecho.trim() };
                    if (db.inventoryMutationDeltaReady) {
                      const intent = mutationIntent("desecho", payload);
                      try {
                        const mutationGeneration = capturarGeneracionInventario();
                        const response = await desecharLoteInsumoDelta(payload.lotId, payload.motivo, intent.key);
                        mutationIntentKeysRef.current.delete(intent.fingerprint);
                        inventoryUpdateMode = await applyInventoryMutationOrReconcile(
                          response,
                          "El desecho se registró, pero no se pudo conciliar el insumo. Recargá la página.",
                          mutationGeneration,
                        );
                      } catch (error) {
                        if (!isMissingRpcError(error)) throw error;
                        mutationIntentKeysRef.current.delete(intent.fingerprint);
                        await desecharLoteInsumo(payload.lotId, payload.motivo);
                      }
                    } else {
                      await desecharLoteInsumo(payload.lotId, payload.motivo);
                    }
                  } else {
                    const note = `Desecho por vencimiento ${desecharVencido.expiresAt} · ${motivoDesecho.trim()}`;
                    if (db.inventoryMutationDeltaReady) {
                      const payload = { itemId: desecharVencido.itemId, tipo: "Merma", cant: -stockActual, nota: note };
                      const intent = mutationIntent("movimiento", payload);
                      try {
                        const mutationGeneration = capturarGeneracionInventario();
                        const response = await movimientoInsumoDelta(payload.itemId, payload.tipo, payload.cant, payload.nota, intent.key);
                        mutationIntentKeysRef.current.delete(intent.fingerprint);
                        inventoryUpdateMode = await applyInventoryMutationOrReconcile(
                          response,
                          "La merma se registró, pero no se pudo conciliar el insumo. Recargá la página.",
                          mutationGeneration,
                        );
                      } catch (error) {
                        if (!isMissingRpcError(error)) throw error;
                        mutationIntentKeysRef.current.delete(intent.fingerprint);
                        await movimientoInsumo(payload.itemId, payload.tipo, payload.cant, payload.nota);
                      }
                    } else {
                      await movimientoInsumo(desecharVencido.itemId, "Merma", -stockActual, note);
                    }
                  }
                } catch (e) {
                  toast("error", "No se pudo desechar el insumo: " + e.message);
                  setEnviando(false);
                  return;
                }
                setEnviando(false);
                setDesecharVencido(null);
                setMotivoDesecho("");
                toast("ok", `✓ Merma registrada · ${nombreDesecho}`);
                if (inventoryUpdateMode === "legacy") {
                  await refrescarSilencioso(() => toast("alert", "El stock quedó retirado, pero no se pudo actualizar la vista. Recargá la página."));
                }
              }}>Confirmar desecho</BtnAsync>
              <Btn kind="ghost" disabled={enviando} onClick={() => setDesecharVencido(null)}>Conservar insumo</Btn>
            </div>
          </Modal>
        )}

        {avisoInv && (
          <Modal title={avisoInv.titulo} onClose={() => setAvisoInv(null)}>
            <p className="text-sm m-0">{avisoInv.texto}</p>
            <div className="mt-4"><Btn onClick={() => setAvisoInv(null)}>Entendido</Btn></div>
          </Modal>
        )}
      </div>
    );
  }

  /* ================= PRODUCTOS Y MENÚ ================= */

  return function InventoryPanels({ kind, ...props }) {
    return kind === "finished" ? <InventarioTerminado {...props} /> : <Inventario {...props} />;
  };
}
