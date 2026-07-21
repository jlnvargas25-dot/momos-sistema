import { useEffect, useRef, useState } from "react";
import { InlineNotice } from "../../components/ui/OperationalPrimitives.jsx";
import { fetchFinanceSnapshot, fetchFinancialFacts } from "../../lib/read-model.js";
import { actualizarPautaFinanciera, createInventoryIdempotencyKey } from "../../lib/rpc.js";
import * as operationalFinance from "../../lib/operational-finance.js";

export function createFinancePanel(shared) {
  const {
    T, Btn, Card, dISO, downloadCSV, fmt, hoyISO, inputStyle, Modal, pct, SectionTitle, Stat,
  } = shared;

  function FinanceView({ db }) {
    const [desde, setDesde] = useState(dISO(-30));
    const [hasta, setHasta] = useState(hoyISO());
    const [asistenteAbierto, setAsistenteAbierto] = useState(false);
    const financeRequestRef = useRef(0);
    const financeDetailRequestRef = useRef(0);
    const pautaMutationKeyRef = useRef(createInventoryIdempotencyKey());
    const financeKey = `${desde}|${hasta}`;
    const [financeRead, setFinanceRead] = useState({ key: "", status: "idle", data: null, error: "" });
    const [financeDetailRead, setFinanceDetailRead] = useState({ key: "", status: "idle", data: null, error: "" });
    const [pautaDraft, setPautaDraft] = useState(0);
    const [pautaSave, setPautaSave] = useState({ status: "idle", error: "" });
    const [financeRuntime] = useState(() => operationalFinance);

    const financeFromEnvelope = (envelope) => {
      const range = financeRuntime.validateFinancialDateRange(desde, hasta);
      if (envelope?.sourceKind === "server-finance-snapshot-v1") {
        return financeRuntime.buildOperationalFinanceFromSnapshot(envelope.payload, range);
      }
      const facts = financeRuntime.normalizeFinancialFacts(envelope?.payload, range);
      return financeRuntime.buildOperationalFinanceFromFacts(facts);
    };

    useEffect(() => {
      if (!financeRuntime) return undefined;
      if (db.financeSnapshotReady === true && db.financeSnapshotKey === financeKey && db.financeSnapshot) {
        try {
          const data = financeFromEnvelope(db.financeSnapshot);
          setFinanceRead({ key: financeKey, status: "ready", data, error: "" });
        } catch (error) {
          setFinanceRead({ key: financeKey, status: "error", data: null, error: error?.message || "El resumen financiero no cumple el contrato." });
        }
        return undefined;
      }
      const defaultKey = `${dISO(-30)}|${hoyISO()}`;
      if (financeKey === defaultKey && db.financeSnapshotReady !== true) {
        setFinanceRead((current) => current.key === financeKey && current.status === "loading"
          ? current : { key: financeKey, status: "loading", data: null, error: "" });
        return undefined;
      }
      const requestId = ++financeRequestRef.current;
      let active = true;
      setFinanceRead({ key: financeKey, status: "loading", data: null, error: "" });
      fetchFinanceSnapshot(desde, hasta)
        .then((envelope) => {
          if (!active || requestId !== financeRequestRef.current) return;
          setFinanceRead({ key: financeKey, status: "ready", data: financeFromEnvelope(envelope), error: "" });
        })
        .catch((error) => {
          if (!active || requestId !== financeRequestRef.current) return;
          setFinanceRead({ key: financeKey, status: "error", data: null, error: error?.message || "No se pudo completar la lectura financiera." });
        });
      return () => { active = false; };
    }, [desde, hasta, financeKey, financeRuntime, db.financeSnapshotReady, db.financeSnapshotKey, db.financeSnapshotVersion]);

    const financeAssistant = financeRead.status === "ready" && financeRead.key === financeKey ? financeRead.data : null;
    const financeDetailKey = `${financeKey}|${financeAssistant?.source?.snapshotVersion || db.financeSnapshotVersion || "legacy"}`;

    useEffect(() => {
      if (!financeAssistant) return;
      setPautaDraft(financeAssistant.summary.configuredMonthlyAdBudget);
    }, [financeAssistant?.source?.snapshotVersion, financeAssistant?.summary?.configuredMonthlyAdBudget]);

    useEffect(() => {
      if (!asistenteAbierto || !financeRuntime) return undefined;
      if (financeDetailRead.key === financeDetailKey && financeDetailRead.status === "ready") return undefined;
      const requestId = ++financeDetailRequestRef.current;
      let active = true;
      setFinanceDetailRead({ key: financeDetailKey, status: "loading", data: null, error: "" });
      fetchFinancialFacts(desde, hasta).then((payload) => {
        if (!active || requestId !== financeDetailRequestRef.current) return;
        const range = financeRuntime.validateFinancialDateRange(desde, hasta);
        const facts = financeRuntime.normalizeFinancialFacts(payload, range);
        setFinanceDetailRead({ key: financeDetailKey, status: "ready", data: financeRuntime.buildOperationalFinanceFromFacts(facts), error: "" });
      }).catch((error) => {
        if (!active || requestId !== financeDetailRequestRef.current) return;
        setFinanceDetailRead({ key: financeDetailKey, status: "error", data: null, error: error?.message || "No se pudo abrir el detalle financiero." });
      });
      return () => { active = false; };
    }, [asistenteAbierto, desde, hasta, financeDetailKey, financeRuntime]);

    const financeDetailAssistant = financeDetailRead.status === "ready" && financeDetailRead.key === financeDetailKey
      ? financeDetailRead.data : null;
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
    const pautaMensual = financeSummary.configuredMonthlyAdBudget;
    const diasRango = financeSummary.rangeDays;
    const pauta = financeSummary.manualAdAllocation;
    const utilidad = financeSummary.estimatedProfit;

    async function guardarPauta() {
      const monthlyBudget = Number(pautaDraft);
      if (!Number.isFinite(monthlyBudget) || monthlyBudget < 0) {
        setPautaSave({ status: "error", error: "Ingresá un valor mensual válido." });
        return;
      }
      setPautaSave({ status: "saving", error: "" });
      try {
        const response = await actualizarPautaFinanciera({ monthlyBudget, from: desde, to: hasta }, pautaMutationKeyRef.current);
        const envelope = { sourceKind: "server-finance-snapshot-v1", key: financeKey, payload: response?.snapshot };
        setFinanceRead({ key: financeKey, status: "ready", data: financeFromEnvelope(envelope), error: "" });
        setFinanceDetailRead({ key: "", status: "idle", data: null, error: "" });
        pautaMutationKeyRef.current = createInventoryIdempotencyKey();
        setPautaSave({ status: "saved", error: "" });
      } catch (error) {
        setPautaSave({ status: "error", error: error?.message || "No se pudo guardar la pauta mensual." });
      }
    }

    function exportar() {
      downloadCSV("finanzas",
        ["Concepto","Valor"],
        [["Rango", desde + " a " + hasta],
         ["Ventas cobradas de postres y productos (con descuentos)", ventasProductos],
         ["Costo histórico de todas las líneas cobradas (COGS)", cogs],
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
            Finanzas está actualizando el resumen compacto y protegido de este periodo.
          </InlineNotice>
        )}
        {financeRead.status === "error" && (
          <InlineNotice icon="⚠️" title="No se pudo actualizar el resumen" tone="danger" className="mb-4">
            {financeRead.error} Reintentá la lectura antes de tomar una decisión financiera.
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
          <Stat icon="💵" label="Ventas cobradas" value={fmt(ventasProductos)} sub={financeSummary.paidOrders + " pedidos · postres, combos y productos al momento"} tone={T.coral} />
          <Stat icon="🧾" label="Costo histórico" value={fmt(cogs)} sub="COGS de todas las líneas cobradas" />
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
            {linea("Ventas de postres y productos (con descuentos)", ventasProductos)}
            {linea("− Costo histórico de líneas cobradas", cogs, { color: "#A03B2A" })}
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
                <input type="number" min="0" value={pautaDraft} onChange={(e) => {
                  setPautaDraft(e.target.value);
                  setPautaSave({ status: "idle", error: "" });
                }} className="flex-1 rounded-xl px-3 py-2 text-sm border font-bold" style={inputStyle} />
                <Btn small onClick={guardarPauta} disabled={pautaSave.status === "saving" || Number(pautaDraft) === pautaMensual}>
                  {pautaSave.status === "saving" ? "Guardando…" : "Guardar"}
                </Btn>
              </div>
              <div className="text-xs mt-2" style={{ color: T.choco2 }}>Valor mensual. En la utilidad se descuenta solo la parte proporcional a los {diasRango} días del rango ({fmt(pauta)}). Registra aquí lo invertido en Meta Ads, influencers o volantes.</div>
              {pautaSave.status === "saved" && <div className="text-xs font-bold mt-2" style={{ color: "#3F6B42" }}>✓ Pauta guardada y resumen conciliado en servidor.</div>}
              {pautaSave.status === "error" && <div className="text-xs font-bold mt-2" style={{ color: "#A03B2A" }}>{pautaSave.error}</div>}
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

            {financeDetailRead.status === "loading" ? (
              <InlineNotice icon="⏳" title="Abriendo el detalle del periodo" className="mb-4">Solo ahora se consultan pedidos, soportes, domicilios y reclamos necesarios para el cierre.</InlineNotice>
            ) : financeDetailRead.status === "error" ? (
              <InlineNotice icon="⚠️" title="No se pudo abrir el detalle" tone="danger" className="mb-4">{financeDetailRead.error}</InlineNotice>
            ) : financeDetailAssistant && financeDetailAssistant.queue.length === 0 ? (
              <div className="rounded-3xl p-8 text-center mb-4" style={{ background: "#E5F0E1" }}><div className="text-3xl">✓</div><div className="display text-xl mt-2">Sin excepciones internas</div><div className="text-sm font-semibold mt-1" style={{ color: "#3F6B42" }}>Ya podés comparar los cobros por medio de pago contra sus extractos externos.</div></div>
            ) : financeDetailAssistant ? (
              <div className="space-y-2 mb-4">
                {financeDetailAssistant.queue.map((task, index) => {
                  const tone = task.severity === "critical" ? { bg: "#F6D4CD", fg: "#A03B2A", label: "Crítico" } : task.severity === "high" ? { bg: "#FBE8C8", fg: "#96690F", label: "Antes de cerrar" } : { bg: T.vainilla, fg: T.choco2, label: "Revisar" };
                  return <Card key={task.id} className="p-4" style={{ borderColor: index === 0 ? "#E59A83" : T.border, background: index === 0 ? "#FFF8F4" : T.surface }}>
                    <div className="flex items-start gap-3"><span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0" style={{ background: index === 0 ? T.coral : T.vainilla, color: index === 0 ? "#fff" : T.choco2 }}>{index + 1}</span><div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: tone.bg, color: tone.fg }}>{tone.label}</span><span className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.choco2 }}>{task.category}</span>{task.orderId && <span className="text-xs font-bold">{task.orderId}</span>}</div><div className="display text-lg font-semibold mt-1">{task.title}</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{task.detail}</div><div className="text-xs font-bold mt-2" style={{ color: task.blocksClose ? "#A03B2A" : "#3F6B42" }}>Siguiente paso: {task.action}</div></div>{task.amount > 0 && <div className="font-extrabold shrink-0" style={{ color: T.coral }}>{fmt(task.amount)}</div>}</div>
                  </Card>;
                })}
              </div>
            ) : null}

            <div className="grid md:grid-cols-2 gap-3">
              <Card className="p-4"><div className="text-[10px] uppercase tracking-wider font-extrabold mb-2" style={{ color: T.coral }}>Conciliación externa pendiente</div>{(financeDetailAssistant || financeAssistant).payments.length ? (financeDetailAssistant || financeAssistant).payments.map((row) => <div key={row.method} className="flex justify-between text-sm py-2 border-t first:border-0" style={{ borderColor: T.border }}><span className="font-bold">{row.method} · {row.orders}</span><b>{fmt(row.amount)}</b></div>) : <div className="text-sm" style={{ color: T.choco2 }}>Sin cobros para conciliar.</div>}</Card>
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
