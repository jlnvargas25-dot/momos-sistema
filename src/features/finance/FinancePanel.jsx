import { useEffect, useMemo, useRef, useState } from "react";
import { InlineNotice } from "../../components/ui/OperationalPrimitives.jsx";
import { fetchFinancialFacts } from "../../lib/read-model.js";
import * as operationalFinance from "../../lib/operational-finance.js";

export function createFinancePanel(shared) {
  const {
    T, addAudit, Btn, Card, dISO, downloadCSV, fmt, hoyISO, inputStyle, Modal, pct, SectionTitle, Stat,
  } = shared;

  function FinanceView({ db, update, user }) {
    const [desde, setDesde] = useState(dISO(-30));
    const [hasta, setHasta] = useState(hoyISO());
    const [asistenteAbierto, setAsistenteAbierto] = useState(false);
    const financeRequestRef = useRef(0);
    const financeKey = `${desde}|${hasta}`;
    const [financeRead, setFinanceRead] = useState({ key: "", status: "idle", data: null, error: "" });
    const [financeRuntime] = useState(() => operationalFinance);

    const financeFallback = useMemo(() => financeRuntime
      ? financeRuntime.buildOperationalFinance(db, { from: desde, to: hasta })
      : null, [db, desde, hasta, financeRuntime]);

    useEffect(() => {
      if (!financeRuntime) return undefined;
      const requestId = ++financeRequestRef.current;
      let active = true;
      setFinanceRead({ key: financeKey, status: "loading", data: null, error: "" });
      fetchFinancialFacts(desde, hasta)
        .then((payload) => {
          if (!active || requestId !== financeRequestRef.current) return;
          const range = financeRuntime.validateFinancialDateRange(desde, hasta);
          const data = financeRuntime.normalizeFinancialFacts(payload, range);
          setFinanceRead({ key: financeKey, status: "ready", data, error: "" });
        })
        .catch((error) => {
          if (!active || requestId !== financeRequestRef.current) return;
          setFinanceRead({ key: financeKey, status: "error", data: null, error: error?.message || "No se pudo completar la lectura financiera." });
        });
      return () => { active = false; };
    }, [desde, hasta, financeKey, financeRuntime]);

    const financeAssistant = useMemo(() => {
      if (financeRuntime && financeRead.status === "ready" && financeRead.key === financeKey && financeRead.data) {
        return financeRuntime.buildOperationalFinanceFromFacts(financeRead.data);
      }
      return financeFallback;
    }, [financeFallback, financeKey, financeRead, financeRuntime]);
    if (!financeAssistant) {
      return <div><SectionTitle>Finanzas operativas</SectionTitle><InlineNotice icon={financeRead.status === "error" ? "⚠️" : "⏳"} title={financeRead.status === "error" ? "No se pudo abrir Finanzas" : "Preparando Finanzas"} tone={financeRead.status === "error" ? "danger" : "warning"}>{financeRead.error || "Cargando el asistente y los controles del periodo solo para esta vista."}</InlineNotice></div>;
    }
    const financeSummary = financeAssistant.summary;
    const ventasProductos = financeSummary.productRevenue;
    const cogs = financeSummary.cogs;
    const margenBruto = financeSummary.grossMargin;
    const domCobrado = financeSummary.deliveryCollected;
    const domCosto = financeSummary.recordedDeliveryCosts;
    const subsidio = financeSummary.deliverySubsidy;
    const costoReclamos = financeSummary.recognizedClaimsForPeriod;
    const pautaMensual = db.settings.pautaMensual || 0;
    const diasRango = financeSummary.rangeDays;
    const pauta = financeSummary.manualAdAllocation;
    const utilidad = financeSummary.estimatedProfit;

    function exportar() {
      downloadCSV("finanzas",
        ["Concepto","Valor"],
        [["Rango", desde + " a " + hasta],
         ["Ventas de producto (con descuentos)", ventasProductos],
         ["Costo estimado de producto (COGS)", cogs],
         ["Margen bruto", margenBruto],
         ["Domicilio cobrado", domCobrado],
         ["Costo real de domicilios", domCosto],
         ["Subsidio de domicilios", subsidio],
         ["Costo de reclamos compensados", costoReclamos],
         ["Pauta prorrateada del rango (" + diasRango + " días)", pauta],
         ["Utilidad estimada", utilidad]]);
    }

    const linea = (label, valor, opts = {}) => (
      <div className="flex justify-between items-center text-sm py-2 border-b last:border-0" style={{ borderColor: T.border }}>
        <span className={opts.strong ? "font-bold" : "font-semibold"} style={{ color: opts.muted ? T.choco2 : T.choco }}>{label}</span>
        <b style={{ color: opts.color || T.choco }}>{opts.raw ? valor : fmt(valor)}</b>
      </div>
    );

    return (
      <div>
        <SectionTitle>Finanzas operativas</SectionTitle>
        <div className="text-xs font-semibold mb-3 -mt-3" style={{ color: T.choco2 }}>
          Conciliá cobros, soportes, costos y excepciones antes de dar el periodo por cerrado.
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-bold" style={{ color: T.choco2 }}>Rango:</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Desde" />
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-xl px-2 py-2 text-xs border font-semibold" style={inputStyle} aria-label="Hasta" />
          <Btn small kind="ghost" onClick={exportar}>⬇ CSV</Btn>
        </div>

        {financeRead.status === "loading" && (
          <InlineNotice icon="⏳" title="Consolidando el periodo" className="mb-4">
            Finanzas está leyendo todos los hechos del rango; mientras termina, muestra una vista local parcial.
          </InlineNotice>
        )}
        {financeRead.status === "error" && (
          <InlineNotice icon="⚠️" title="Lectura local parcial" tone="danger" className="mb-4">
            {financeRead.error} Los valores visibles sirven para operar, pero pueden omitir registros antiguos hasta recuperar la lectura completa.
          </InlineNotice>
        )}
        {financeRead.status === "ready" && financeRead.key === financeKey && (
          <div className="rounded-2xl px-4 py-3 mb-4 text-xs font-bold" style={{ background: "#E5F0E1", color: "#3F6B42", border: "1px solid #BFD8BA" }} role="status">
            ✓ Periodo completo consolidado en servidor · {financeSummary.ordersReviewed} pedido{financeSummary.ordersReviewed === 1 ? "" : "s"} revisado{financeSummary.ordersReviewed === 1 ? "" : "s"}.
          </div>
        )}

        <Card className="p-4 mb-4" onClick={() => setAsistenteAbierto(true)} style={{ background: "linear-gradient(135deg,#FFF4EA,#FFFFFF)", borderColor: financeAssistant.summary.blocking ? "#E7B36E" : "#A7C9A4" }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0" style={{ background: financeAssistant.summary.blocking ? T.coralSoft : "#E5F0E1" }} aria-hidden="true">🧾</span>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: financeAssistant.summary.blocking ? T.coral : "#3F6B42" }}>Asistente de cierre financiero</div>
                <div className="display text-xl font-semibold mt-0.5">{financeAssistant.summary.closeReady ? "Periodo listo para conciliar" : `${financeAssistant.summary.blocking} control${financeAssistant.summary.blocking === 1 ? "" : "es"} antes del cierre`}</div>
                <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{fmt(financeAssistant.summary.grossCollected)} cobrados en MOMO OPS · {fmt(financeAssistant.summary.pendingValue)} por cobrar · {financeAssistant.summary.exceptions} observaciones totales</div>
              </div>
            </div>
            <span className="text-xs font-extrabold shrink-0" style={{ color: T.coral }}>{financeAssistant.summary.closeReady ? "Ver conciliación ›" : "Revisar pendientes ›"}</span>
          </div>
        </Card>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat icon="💵" label="Ventas de producto" value={fmt(ventasProductos)} sub={financeSummary.paidOrders + " pedidos cobrados"} tone={T.coral} />
          <Stat icon="🧾" label="Costo de producto" value={fmt(cogs)} sub="estimado por receta" />
          <Stat icon="📈" label="Margen bruto" value={fmt(margenBruto)} sub={ventasProductos ? pct(margenBruto / ventasProductos) + " de las ventas" : "—"} tone="#3F6B42" />
          <Stat icon="✨" label="Utilidad estimada" value={fmt(utilidad)} sub="tras domicilios, pauta y reclamos" tone={utilidad >= 0 ? "#3F6B42" : "#A03B2A"} />
        </div>

        <div className="grid lg:grid-cols-3 gap-3 mb-4">
          <Card className="p-4 lg:col-span-2">
            <div className="flex items-start justify-between gap-3 mb-2"><div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>Cobros para conciliar</div><div className="display text-lg font-semibold">Separados por medio de pago</div></div><div className="text-right"><div className="display text-xl font-semibold" style={{ color: "#3F6B42" }}>{fmt(financeAssistant.summary.grossCollected)}</div><div className="text-[10px] font-bold" style={{ color: T.choco2 }}>bruto registrado</div></div></div>
            {financeAssistant.payments.length ? financeAssistant.payments.map((row) => (
              <div key={row.method} className="flex justify-between items-center py-2 border-t" style={{ borderColor: T.border }}><div><div className="text-sm font-bold">{row.method}</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>{row.orders} pedido{row.orders === 1 ? "" : "s"} · comparar con extracto</div></div><div className="font-extrabold">{fmt(row.amount)}</div></div>
            )) : <div className="text-sm font-semibold py-4" style={{ color: T.choco2 }}>No hay cobros confirmados en este rango.</div>}
          </Card>
          <Card className="p-4">
            <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>Caja operativa documentada</div>
            <div className="display text-lg font-semibold mb-2">Movimientos que sí conocemos</div>
            {linea("Compras de inventario", financeAssistant.summary.inventoryPurchases, { color: "#A03B2A" })}
            {linea("Pauta con métricas", financeAssistant.summary.platformSpend, { color: "#A03B2A" })}
            {linea("Costos de domicilios", financeAssistant.summary.deliveryCosts, { color: "#A03B2A" })}
            {linea("Resultado operativo documentado", financeAssistant.summary.operatingResult, { strong: true, color: financeAssistant.summary.operatingResult >= 0 ? "#3F6B42" : "#A03B2A" })}
            <div className="text-[10px] font-semibold mt-2 leading-relaxed" style={{ color: T.choco2 }}>No es saldo bancario: faltan nómina, servicios, impuestos, comisiones y otros egresos que aún no tienen libro en MOMO OPS.</div>
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>ESTADO DE RESULTADOS SIMPLE</div>
            {linea("Ventas de producto (con descuentos aplicados)", ventasProductos)}
            {linea("− Costo estimado de producto", cogs, { color: "#A03B2A" })}
            {linea("= Margen bruto", margenBruto, { strong: true, color: "#3F6B42" })}
            {linea("+ Domicilio cobrado a clientes", domCobrado)}
            {linea("− Costo real de domicilios", domCosto, { color: "#A03B2A" })}
            {linea("− Costo de reclamos compensados", costoReclamos, { color: "#A03B2A" })}
            {linea(`− Pauta prorrateada del rango (${diasRango} días)`, pauta, { color: "#A03B2A" })}
            {linea("= Utilidad estimada del periodo", utilidad, { strong: true, color: utilidad >= 0 ? "#3F6B42" : "#A03B2A" })}
          </Card>
          <div className="flex flex-col gap-3">
            <Card className="p-4">
              <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>DOMICILIOS EN EL RANGO</div>
              {linea("Cobrado a clientes", domCobrado)}
              {linea("Costo real pagado", domCosto)}
              {linea("Subsidio (pedidos donde costó más de lo cobrado)", subsidio, { color: "#A03B2A" })}
            </Card>
            <Card className="p-4">
              <div className="text-xs font-bold mb-2" style={{ color: T.choco2 }}>PAUTA PUBLICITARIA (asignación manual mensual)</div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold" style={{ color: T.choco2 }}>$</span>
                <input type="number" value={pautaMensual} onChange={(e) => update((d) => {
                  d.settings.pautaMensual = +e.target.value || 0;
                  addAudit(d, { user, entidad: "Configuración", entidadId: "pauta", accion: "Pauta actualizada", a: fmt(+e.target.value || 0) });
                })} className="flex-1 rounded-xl px-3 py-2 text-sm border font-bold" style={inputStyle} />
              </div>
              <div className="text-xs mt-2" style={{ color: T.choco2 }}>Valor mensual. En la utilidad se descuenta solo la parte proporcional a los {diasRango} días del rango ({fmt(pauta)}). Registra aquí lo invertido en Meta Ads, influencers o volantes.</div>
            </Card>
          </div>
        </div>

        {asistenteAbierto && (
          <Modal title="Asistente de cierre financiero" onClose={() => setAsistenteAbierto(false)} wide>
            <div className="rounded-3xl border p-4 sm:p-5 mb-4" style={{ background: "linear-gradient(135deg,#FFF4EA,#FFFFFF)", borderColor: T.border }}>
              <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Control del periodo · {desde} a {hasta}</div>
              <div className="display text-2xl font-semibold mt-1">{financeAssistant.summary.closeReady ? "Los datos están listos para conciliar" : "Qué debe revisar Finanzas ahora"}</div>
              <div className="text-sm font-semibold mt-1 max-w-3xl" style={{ color: T.choco2 }}>MOMO OPS cruza pedido, pago, evidencia, costo histórico, domicilio y reclamo. Señala diferencias, pero no confirma pagos, devuelve dinero ni inventa un saldo bancario.</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Cobrado bruto</div><div className="display text-lg mt-0.5" style={{ color: "#3F6B42" }}>{fmt(financeAssistant.summary.grossCollected)}</div></div>
                <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Por cobrar</div><div className="display text-lg mt-0.5" style={{ color: "#96690F" }}>{fmt(financeAssistant.summary.pendingValue)}</div></div>
                <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Bloquean cierre</div><div className="display text-xl mt-0.5" style={{ color: financeAssistant.summary.blocking ? "#A03B2A" : "#3F6B42" }}>{financeAssistant.summary.blocking}</div></div>
                <div className="rounded-2xl bg-white px-3 py-3"><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>Resultado documentado</div><div className="display text-lg mt-0.5" style={{ color: financeAssistant.summary.operatingResult >= 0 ? "#3F6B42" : "#A03B2A" }}>{fmt(financeAssistant.summary.operatingResult)}</div></div>
              </div>
            </div>

            {financeAssistant.queue.length === 0 ? (
              <div className="rounded-3xl p-8 text-center mb-4" style={{ background: "#E5F0E1" }}><div className="text-3xl">✓</div><div className="display text-xl mt-2">Sin excepciones internas</div><div className="text-sm font-semibold mt-1" style={{ color: "#3F6B42" }}>Ya podés comparar los cobros por medio de pago contra sus extractos externos.</div></div>
            ) : (
              <div className="space-y-2 mb-4">
                {financeAssistant.queue.map((task, index) => {
                  const tone = task.severity === "critical" ? { bg: "#F6D4CD", fg: "#A03B2A", label: "Crítico" } : task.severity === "high" ? { bg: "#FBE8C8", fg: "#96690F", label: "Antes de cerrar" } : { bg: T.vainilla, fg: T.choco2, label: "Revisar" };
                  return <Card key={task.id} className="p-4" style={{ borderColor: index === 0 ? "#E59A83" : T.border, background: index === 0 ? "#FFF8F4" : T.surface }}>
                    <div className="flex items-start gap-3"><span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0" style={{ background: index === 0 ? T.coral : T.vainilla, color: index === 0 ? "#fff" : T.choco2 }}>{index + 1}</span><div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: tone.bg, color: tone.fg }}>{tone.label}</span><span className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{task.category}</span>{task.orderId && <span className="text-xs font-bold">{task.orderId}</span>}</div><div className="display text-lg font-semibold mt-1">{task.title}</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{task.detail}</div><div className="text-xs font-bold mt-2" style={{ color: task.blocksClose ? "#A03B2A" : "#3F6B42" }}>Siguiente paso: {task.action}</div></div>{task.amount > 0 && <div className="font-extrabold shrink-0" style={{ color: T.coral }}>{fmt(task.amount)}</div>}</div>
                  </Card>;
                })}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              <Card className="p-4"><div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.coral }}>Conciliación externa pendiente</div>{financeAssistant.payments.length ? financeAssistant.payments.map((row) => <div key={row.method} className="flex justify-between text-sm py-2 border-t first:border-0" style={{ borderColor: T.border }}><span className="font-bold">{row.method} · {row.orders}</span><b>{fmt(row.amount)}</b></div>) : <div className="text-sm" style={{ color: T.choco2 }}>Sin cobros para conciliar.</div>}</Card>
              <Card className="p-4"><div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.coral }}>Límites de esta lectura</div>{financeAssistant.caveats.map((note) => <div key={note} className="text-xs font-semibold py-1.5 leading-relaxed" style={{ color: T.choco2 }}>• {note}</div>)}</Card>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  function FinancePanel(props) {
    return <FinanceView {...props} />;
  }

  return FinancePanel;
}
