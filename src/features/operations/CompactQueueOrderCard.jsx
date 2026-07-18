import { buildPackingChecklistLines } from "../../lib/packing-workflow";

export function createCompactQueueOrderCard(shared) {
  const { T, Badge, Card, customerOf } = shared;

  return function CompactQueueOrderCard({ db, orderId, eyebrow, nextAction, content, tone = T.coral, position, onOpen, footer, timing }) {
    const order = (db.orders || []).find((item) => item.id === orderId);
    if (!order) return null;
    const customer = customerOf(db, order.customerId);
    const lines = buildPackingChecklistLines(orderId, db.order_items || []);
    const topLines = lines.filter((line) => !line.parentItemId);
    return (
      <Card className="momo-queue-item p-4 min-h-[188px] flex flex-col" onClick={onOpen} aria-label={`Abrir detalle del pedido ${orderId}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: tone }}>{eyebrow}</div>
            <div className="flex flex-wrap items-center gap-2 mt-1"><h3 className="display text-lg font-semibold m-0">{orderId}</h3><Badge label={order.estado} /></div>
          </div>
          {timing ? <div className="text-right shrink-0">
            {timing.urgent && <div className="text-[8px] uppercase tracking-wider font-black" style={{ color: "#A03B2A" }}>Urgente</div>}
            <div className="display text-xl font-bold leading-none" style={{ color: timing.urgent ? "#A03B2A" : "#96690F" }}>{timing.elapsedMinutes}</div>
            <div className="text-[8px] uppercase font-extrabold" style={{ color: T.choco2 }}>min</div>
          </div> : <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0" style={{ background: `${tone}18`, color: tone }}>{position || "›"}</span>}
        </div>
        <div className="text-xs font-semibold mt-1 truncate" style={{ color: T.choco2 }}>{customer.nombre || "Cliente"} · {order.fecha} {order.hora}</div>
        {timing && <div className="mt-2 rounded-xl px-2.5 py-1.5 text-[10px] font-extrabold" style={{ background: timing.urgent ? "#F6D4CD" : "#FFF2D8", color: timing.urgent ? "#A03B2A" : "#7A5410" }}>⏱ {timing.elapsedMinutes} min · {timing.phase || timing.state}</div>}
        <div className="mt-3 text-sm font-bold leading-snug line-clamp-2">{content || topLines.map((line) => line.label).join(" · ") || "Sin contenido registrado"}</div>
        <div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>{topLines.length} línea{topLines.length === 1 ? "" : "s"} principal{topLines.length === 1 ? "" : "es"} · {lines.length} control{lines.length === 1 ? "" : "es"} exacto{lines.length === 1 ? "" : "s"}</div>
        <div className="mt-auto pt-3 flex items-end justify-between gap-3 border-t" style={{ borderColor: T.border }}>
          <div className="min-w-0"><div className="text-[9px] uppercase tracking-wider font-extrabold" style={{ color: tone }}>Siguiente acción</div><div className="text-[11px] font-bold leading-snug mt-0.5">{nextAction}</div>{footer && <div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>{footer}</div>}</div>
          <span className="text-lg shrink-0" style={{ color: tone }} aria-hidden="true">›</span>
        </div>
      </Card>
    );
  };
}
