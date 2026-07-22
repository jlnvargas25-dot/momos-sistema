import { useEffect, useMemo, useRef, useState } from "react";
import {
  abortCommercialPilot, closeCommercialPilot, fetchCommercialPilotSnapshot, linkCommercialPilotOrder,
  prepareCommercialPilot, reconcileCommercialPilotOrder, signCommercialPilot, startCommercialPilot,
} from "../../lib/commercial-pilot-api.js";
import {
  defaultCommercialPilotDraft, eligibleOrdersForPilot, pilotNextStep,
} from "../../lib/commercial-pilot.js";

const STATUS_TONE = {
  Borrador: { bg: "#FFF1D6", fg: "#7A5510" },
  Listo: { bg: "#DCE7F2", fg: "#355D80" },
  "En curso": { bg: "#DDEBD9", fg: "#356239" },
  Cerrado: { bg: "#E3EFE0", fg: "#315D36" },
  Abortado: { bg: "#F6D4CD", fg: "#8F3528" },
};

function dateLabel(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

function money(value) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function StatBox({ label, value, T }) {
  return <div className="rounded-2xl border px-3 py-2 text-center min-w-[82px]" style={{ borderColor: T.border, background: T.vainilla }}>
    <div className="font-serif text-xl font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
    <div className="text-[9px] font-extrabold uppercase tracking-wide" style={{ color: T.choco2 }}>{label}</div>
  </div>;
}

export default function CommercialPilotPanel({ T, Card, Btn, BtnAsync, Modal, Field, Input, Select, toast, createIdempotencyKey }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState(() => defaultCommercialPilotDraft());
  const [productionAccepted, setProductionAccepted] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const linkKeysRef = useRef(new Map());

  async function refresh({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    try {
      const next = await fetchCommercialPilotSnapshot();
      setSnapshot(next);
      setError("");
      setSelectedId((current) => current && next.pilots.some((pilot) => pilot.id === current) ? current : next.pilots[0]?.id || "");
    } catch (nextError) {
      setError(nextError?.message || "No se pudo consultar el piloto comercial.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const activePilots = useMemo(() => (snapshot?.pilots || []).filter((pilot) => !pilot.terminal), [snapshot]);
  const historicalPilots = useMemo(() => (snapshot?.pilots || []).filter((pilot) => pilot.terminal), [snapshot]);
  const selected = useMemo(() => (snapshot?.pilots || []).find((pilot) => pilot.id === selectedId) || null, [snapshot, selectedId]);
  const eligibleOrders = useMemo(() => eligibleOrdersForPilot(snapshot, selected), [snapshot, selected]);

  async function mutate(action, success) {
    await action();
    await refresh({ quiet: true });
    toast("ok", success);
  }

  async function createPilot() {
    if (draft.environment === "Produccion" && !productionAccepted) throw new Error("Confirmá que la muestra no abrirá tráfico público.");
    const start = new Date(draft.startsAt);
    const expires = new Date(draft.expiresAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(expires.getTime()) || expires <= start) throw new Error("Revisá la ventana del piloto.");
    const pilotKey = `pilot-${draft.environment.toLowerCase()}-${Date.now()}`;
    await prepareCommercialPilot({ ...draft, pilotKey });
    setCreateOpen(false);
    setDraft(defaultCommercialPilotDraft());
    setProductionAccepted(false);
    await refresh({ quiet: true });
    toast("ok", "Muestra preparada; todavía no se ha iniciado");
  }

  function exportAct() {
    if (!selected) return;
    const safeAct = {
      contract: "momos.commercial-pilot.act.v1",
      pilot: selected.key,
      environment: selected.environment,
      status: selected.status,
      sample: { planned: selected.plannedOrders, linked: selected.linkedOrders, reconciled: selected.reconciledOrders },
      approvals: selected.signoffs.map(({ area, status }) => ({ area, status })),
      orders: selected.orders.map(({ id, status, outcome, reconciled, finalMargin }) => ({ id, status, outcome, reconciled, finalMargin })),
      generatedAt: new Date().toISOString(),
      privacy: { containsCustomerPii: false, containsSecrets: false },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(safeAct, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `acta-${selected.key}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const permissions = snapshot?.permissions || {};
  const healthReady = snapshot?.health?.ready !== false;

  return <section className="mt-6" data-testid="commercial-pilot-panel">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-3">
      <div>
        <div className="text-[10px] font-extrabold uppercase tracking-[.14em]" style={{ color: T.coral }}>Salida comercial protegida</div>
        <h2 className="display text-lg font-semibold m-0">Piloto comercial controlado</h2>
        <p className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Probá una muestra pequeña de pedidos reales, con cuatro aprobaciones y conciliación completa.</p>
      </div>
      <div className="flex gap-2">
        <Btn kind="ghost" small onClick={() => refresh()} disabled={loading}>Actualizar</Btn>
        {permissions.canPrepare && <Btn small onClick={() => setCreateOpen(true)}>＋ Preparar muestra</Btn>}
      </div>
    </div>

    {error && <Card className="p-4" role="alert" style={{ borderColor: "#ECBBB1", background: "#FFF7F4" }}>
      <div className="font-bold" style={{ color: "#A03B2A" }}>El panel todavía no está disponible en este servidor</div>
      <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>{error}</div>
      <div className="text-xs mt-2">La operación normal sigue intacta y no se inició ningún piloto.</div>
    </Card>}

    {!error && loading && <Card className="p-7 text-center"><div className="font-bold">Consultando la muestra protegida…</div></Card>}

    {!error && !loading && snapshot && !snapshot.detailed && <Card className="p-4" style={{ background: "#FFF8E9", borderColor: "#E7C078" }}>
      <div className="font-bold">Vista básica disponible</div>
      <div className="text-xs mt-1" style={{ color: T.choco2 }}>Aplicá H104 para ver firmas y pedidos individuales desde esta pantalla. Ninguna acción quedó habilitada a medias.</div>
    </Card>}

    {!error && !loading && snapshot?.detailed && <>
      <Card className="p-4 mb-3" style={{ background: "linear-gradient(145deg,#fff,#FFF8EF)", borderColor: healthReady ? "#BFD8BE" : "#ECBBB1" }}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl" style={{ background: healthReady ? "#E3EFE0" : "#F6D4CD" }} aria-hidden="true">{healthReady ? "✓" : "!"}</span>
            <div><div className="font-serif text-xl font-bold">{healthReady ? "Listo para preparar; sin iniciar" : "Inicio bloqueado por salud operativa"}</div>
              <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>El piloto nunca crea pedidos, cobra ni abre tráfico. Solo vincula pedidos ya pagados cuando una persona lo decide.</div></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatBox T={T} label="Activos" value={activePilots.length} />
            <StatBox T={T} label="Cerrados" value={historicalPilots.length} />
            <StatBox T={T} label="Disponibles" value={snapshot.eligibleOrders.length} />
          </div>
        </div>
      </Card>

      {(snapshot.pilots || []).length === 0 ? <Card className="p-8 text-center">
        <div className="text-3xl" aria-hidden="true">🧪</div>
        <div className="font-serif text-xl font-bold mt-2">Aún no hay muestras preparadas</div>
        <div className="text-sm mt-1" style={{ color: T.choco2 }}>Preparar una muestra no inicia la operación ni modifica pedidos.</div>
      </Card> : <div className="grid lg:grid-cols-[minmax(260px,.8fr)_minmax(0,1.7fr)] gap-3">
        <div className="space-y-2">
          {(snapshot.pilots || []).map((pilot) => {
            const tone = STATUS_TONE[pilot.status] || STATUS_TONE.Borrador;
            return <Card key={pilot.id} className="p-4" role="button" tabIndex={0}
              onClick={() => setSelectedId(pilot.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedId(pilot.id);
                }
              }}
              aria-pressed={selectedId === pilot.id}
              style={selectedId === pilot.id ? { borderColor: T.coral, boxShadow: `0 0 0 2px ${T.coralSoft}` } : undefined}>
              <div className="flex items-center justify-between gap-2"><span className="font-bold truncate">{pilot.key}</span><span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: tone.bg, color: tone.fg }}>{pilot.status}</span></div>
              <div className="text-[10px] font-bold mt-2" style={{ color: T.choco2 }}>{pilot.environment} · {pilot.linkedOrders}/{pilot.plannedOrders} pedidos · {pilot.approvedSignoffs}/4 firmas</div>
              <div className="text-xs font-semibold mt-2" style={{ color: T.coral }}>{pilotNextStep(pilot)} ›</div>
            </Card>;
          })}
        </div>

        {selected && <Card className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b" style={{ borderColor: T.border }}>
            <div><div className="text-[10px] font-extrabold uppercase" style={{ color: T.coral }}>{selected.environment} · muestra de {selected.plannedOrders}</div><div className="font-serif text-2xl font-bold mt-1">{pilotNextStep(selected)}</div><div className="text-xs mt-1" style={{ color: T.choco2 }}>{dateLabel(selected.startsAt)} → {dateLabel(selected.expiresAt)}</div></div>
            <div className="flex flex-wrap gap-2">
              {selected.status === "Listo" && permissions.canStart && <BtnAsync confirmar="Confirmar inicio" disabled={!healthReady} onClick={() => mutate(() => startCommercialPilot(selected), "Piloto iniciado; ya podés vincular la muestra")}>Iniciar muestra</BtnAsync>}
              {selected.status === "En curso" && selected.reconciledOrders === selected.plannedOrders && permissions.canClose && <BtnAsync confirmar="Confirmar cierre" onClick={() => mutate(() => closeCommercialPilot(selected), "Piloto cerrado y conciliado")}>Cerrar piloto</BtnAsync>}
              {selected.status === "Cerrado" && <Btn kind="soft" onClick={exportAct}>Descargar acta</Btn>}
              {!selected.terminal && permissions.canAbort && <BtnAsync kind="danger" confirmar="Sí, abortar" onClick={() => mutate(() => abortCommercialPilot(selected), "Piloto abortado; los pedidos se conservaron")}>Abortar</BtnAsync>}
            </div>
          </div>

          <div className="mt-4"><div className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: T.choco2 }}>1. Aprobaciones responsables</div>
            <div className="grid sm:grid-cols-2 gap-2 mt-2">{selected.signoffs.map((signoff) => {
              const canSign = (permissions.signableAreas || []).includes(signoff.area);
              return <div key={signoff.area} className="rounded-2xl border p-3 flex items-center justify-between gap-3" style={{ borderColor: signoff.status === "Aprobado" ? "#BFD8BE" : T.border, background: signoff.status === "Aprobado" ? "#F2F7F0" : T.soft }}>
                <div><div className="text-sm font-bold">{signoff.label}</div><div className="text-[10px] font-semibold mt-0.5" style={{ color: signoff.status === "Aprobado" ? "#315D36" : T.choco2 }}>{signoff.status === "Aprobado" ? "✓ Aprobado" : "Pendiente"}</div></div>
                {signoff.status !== "Aprobado" && canSign && selected.status === "Borrador" && <BtnAsync small kind="soft" onClick={() => mutate(() => signCommercialPilot(selected, signoff), `${signoff.label} aprobado`)}>Aprobar</BtnAsync>}
              </div>;
            })}</div>
          </div>

          {selected.status === "En curso" && <div className="mt-5 pt-4 border-t" style={{ borderColor: T.border }}>
            <div className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: T.choco2 }}>2. Pedidos de la muestra</div>
            {selected.orders.length === 0 ? <div className="rounded-2xl p-4 mt-2 text-sm" style={{ background: T.vainilla }}>Todavía no vinculaste pedidos. Solo aparecen pedidos ya pagados y operables.</div> : <div className="space-y-2 mt-2">{selected.orders.map((order) => <div key={order.id} className="rounded-2xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ borderColor: order.reconciled ? "#BFD8BE" : T.border }}>
              <div><div className="font-bold">{order.id} · {order.status}</div><div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>{order.reconciled ? `✓ ${order.outcome} · margen ${money(order.finalMargin)}` : "Esperando cierre operativo o financiero"}</div></div>
              {!order.reconciled && permissions.canReconcile && <BtnAsync small kind="soft" onClick={() => mutate(() => reconcileCommercialPilotOrder(selected.id, order.id), `${order.id} revisado`)}>Revisar cierre</BtnAsync>}
            </div>)}</div>}

            {selected.linkedOrders < selected.plannedOrders && permissions.canLink && <div className="rounded-2xl border p-3 mt-3" style={{ borderColor: T.border, background: T.soft }}>
              <div className="text-xs font-bold mb-2">Agregar pedido pagado</div>
              <div className="flex flex-col sm:flex-row gap-2"><Select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)} options={["", ...eligibleOrders.map((order) => order.id)]} />
                <BtnAsync disabled={!selectedOrderId} onClick={async () => {
                  const signature = `${selected.id}:${selectedOrderId}`;
                  const key = linkKeysRef.current.get(signature) || createIdempotencyKey();
                  linkKeysRef.current.set(signature, key);
                  await mutate(() => linkCommercialPilotOrder(selected.id, selectedOrderId, key), `${selectedOrderId} agregado a la muestra`);
                  linkKeysRef.current.delete(signature);
                  setSelectedOrderId("");
                }}>Agregar</BtnAsync></div>
              {selectedOrderId && <div className="text-[10px] font-semibold mt-2" style={{ color: T.choco2 }}>{money(eligibleOrders.find((order) => order.id === selectedOrderId)?.total)} · no modifica el estado del pedido</div>}
              {!eligibleOrders.length && <div className="text-[10px] font-semibold mt-2" style={{ color: T.choco2 }}>No hay pedidos pagados elegibles en este momento.</div>}
            </div>}
          </div>}
        </Card>}
      </div>}
    </>}

    {createOpen && <Modal title="Preparar una muestra cerrada" onClose={() => setCreateOpen(false)}>
      <div className="rounded-2xl p-3 mb-4 text-xs font-semibold" style={{ background: T.vainilla }}>Esto crea el control del piloto. No crea pedidos, no cobra y no abre Pide MOMOS.</div>
      <Field label="Entorno"><Select value={draft.environment} onChange={(event) => { setDraft({ ...draft, environment: event.target.value }); setProductionAccepted(false); }} options={["Staging", "Produccion"]} /></Field>
      <div className="grid sm:grid-cols-2 gap-3"><Field label="Pedidos de la muestra"><Input type="number" min="1" max="20" value={draft.plannedOrders} onChange={(event) => setDraft({ ...draft, plannedOrders: event.target.value })} /></Field><Field label="Tope por pedido"><Input type="number" min="1000" max="500000" step="1000" value={draft.maxOrderTotal} onChange={(event) => setDraft({ ...draft, maxOrderTotal: event.target.value })} /></Field></div>
      <div className="grid sm:grid-cols-2 gap-3"><Field label="Empieza"><Input type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></Field><Field label="Termina"><Input type="datetime-local" value={draft.expiresAt} onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })} /></Field></div>
      {draft.environment === "Produccion" && <label className="flex items-start gap-2 rounded-2xl border p-3 text-xs font-bold" style={{ borderColor: "#E7C078", background: "#FFF8E9" }}><input type="checkbox" checked={productionAccepted} onChange={(event) => setProductionAccepted(event.target.checked)} /><span>Entiendo que solo prepara una muestra cerrada y no abre tráfico público.</span></label>}
      <div className="flex gap-2 mt-4"><BtnAsync onClick={createPilot} disabled={draft.environment === "Produccion" && !productionAccepted}>Preparar muestra</BtnAsync><Btn kind="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Btn></div>
    </Modal>}
  </section>;
}
