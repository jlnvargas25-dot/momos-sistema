import { commercialFamilyLabel } from "../../lib/momos-domain-language.js";

export function finishedFigureFamilyLabels(figure, products = []) {
  return (figure?.productIds || [])
    .map((productId) => products.find((product) => product.id === productId))
    .filter(Boolean)
    .map(commercialFamilyLabel);
}

export function FinishedFigureCards({ figureSummaries = [], products = [], Card, Empty, T, onOpen }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
      {figureSummaries.map((figure) => {
        const familyLabels = finishedFigureFamilyLabels(figure, products);
        return (
          <Card
            key={figure.figura}
            className="momo-queue-item p-4"
            onClick={() => onOpen?.(figure.figura)}
            aria-label={`Abrir inventario de la figura ${figure.figura}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider font-extrabold" style={{ color: T.coral }}>Figura terminada</div>
                <div className="display text-xl font-semibold mt-0.5">{figure.figura}</div>
                {familyLabels.length > 0 && <div className="text-[10px] font-bold mt-0.5" style={{ color: T.choco2 }}>Presentación comercial: {familyLabels.join(" · ")}</div>}
                {(figure.especie || figure.gramajeG) && <div className="text-[10px] font-bold mt-0.5 capitalize" style={{ color: T.choco2 }}>{[figure.especie ? `Silueta visual: ${figure.especie}` : "", figure.gramajeG ? `${figure.gramajeG} g` : ""].filter(Boolean).join(" · ")}</div>}
                <div className="text-[11px] font-semibold mt-1" style={{ color: T.choco2 }}>{figure.flavors.length} {figure.flavors.length === 1 ? "sabor disponible" : "sabores disponibles"}</div>
              </div>
              <div className="text-right shrink-0"><div className="display text-3xl" style={{ color: figure.available > 0 ? "#3F6B42" : T.choco2 }}>{figure.available}</div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>para vender</div></div>
            </div>
            <div className="flex gap-1.5 flex-wrap mt-3">
              {figure.flavors.map((flavor) => <span key={flavor.sabor} className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: "#E3EFE0", color: "#315D37" }}>{flavor.sabor} · {flavor.available}</span>)}
              {figure.flavors.length === 0 && <span className="text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: T.vainilla, color: T.choco2 }}>Sin stock vendible exacto</span>}
            </div>
            {(figure.imperfectForShakes > 0 || figure.imperfectPending > 0) && <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="rounded-xl p-2" style={{ background: "#F1DFEB" }}><div className="text-[9px] uppercase font-extrabold" style={{ color: "#754568" }}>Para malteadas</div><div className="font-extrabold" style={{ color: "#754568" }}>{figure.imperfectForShakes}</div></div>
              <div className="rounded-xl p-2" style={{ background: "#FBE8C8" }}><div className="text-[9px] uppercase font-extrabold" style={{ color: "#7A5410" }}>Por decidir</div><div className="font-extrabold" style={{ color: "#7A5410" }}>{figure.imperfectPending}</div></div>
            </div>}
            <div className="flex items-center justify-end mt-3 pt-3 border-t text-[11px] font-bold" style={{ borderColor: T.border, color: T.coral }}>Ver sabores, vencimientos e imperfectas ›</div>
          </Card>
        );
      })}
      {figureSummaries.length === 0 && <Empty icon="🐾" text="Todavía no hay figuras terminadas configuradas." />}
    </div>
  );
}

export function FinishedFigureDetailContent({ figure, products = [], Card, Stat, T }) {
  if (!figure) return null;
  const familyLabels = finishedFigureFamilyLabels(figure, products);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Inventario exacto por figura</div>
          <div className="display text-2xl font-semibold mt-0.5">{figure.figura}</div>
          {familyLabels.length > 0 && <div className="text-xs font-bold mt-1" style={{ color: T.choco2 }}>Presentación comercial: {familyLabels.join(" · ")}</div>}
          <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Sabores vigentes disponibles para vender e imperfectas separadas por destino.</div>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: figure.available > 0 ? "#DDEBD9" : "#FBE8C8", color: figure.available > 0 ? "#3F6B42" : "#96690F" }}>{figure.available > 0 ? "Disponible" : "Sin stock vendible"}</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon="✓" label="Para vender" value={figure.available} sub={`${figure.flavors.length} sabor(es)`} tone="#3F6B42" />
        <Stat icon="🥤" label="Para malteadas" value={figure.imperfectForShakes} sub="destino ya definido" tone="#8A4D7A" />
        <Stat icon="♻" label="Por decidir" value={figure.imperfectPending} sub="requieren destino" tone="#96690F" />
        <Stat icon="×" label="Descartadas" value={figure.discarded} sub="no reutilizables" tone="#A03B2A" />
      </div>

      <Card className="p-4 mb-4" style={{ background: "linear-gradient(135deg,#FFF9F1,#F7ECD9)" }}>
        <div className="flex items-center justify-between gap-3 mb-3"><div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>Stock vendible</div><div className="display text-lg font-semibold">Todos los sabores de {figure.figura}</div></div><span className="text-xs font-extrabold" style={{ color: T.choco2 }}>{figure.available} unidades</span></div>
        <div className="grid sm:grid-cols-2 gap-2">
          {figure.flavors.map((flavor) => <div key={flavor.sabor} className="rounded-2xl border p-3 flex items-start justify-between gap-3" style={{ borderColor: T.border, background: T.surface }}><div><div className="text-sm font-extrabold">{flavor.sabor}</div><div className="text-[11px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{flavor.gramajes.length ? flavor.gramajes.map((grams) => `${grams} g`).join(" · ") : "Gramaje sin registrar"}{flavor.nextExpiration ? ` · vence primero ${flavor.nextExpiration}` : ""}</div></div><div className="text-right shrink-0"><div className="display text-2xl" style={{ color: "#3F6B42" }}>{flavor.available}</div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>disponibles</div></div></div>)}
          {figure.flavors.length === 0 && <div className="sm:col-span-2 text-sm font-semibold p-3 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>No hay sabores vendibles de esta figura.</div>}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 mb-2"><div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: "#8A4D7A" }}>Reaprovechamiento</div><div className="display text-lg font-semibold">Imperfectas por sabor y lote</div></div><span className="text-xs font-extrabold" style={{ color: T.choco2 }}>{figure.imperfectTotal} registradas</span></div>
        <div className="space-y-2">
          {figure.imperfectBatches.map((batch, index) => <div key={`${batch.id}-${batch.sabor}-${index}`} className="rounded-2xl p-3 flex items-start justify-between gap-3" style={{ background: batch.forShakes ? "#F1DFEB" : batch.destinationRegistered ? "#EDF0E8" : "#FBE8C8" }}><div><div className="text-sm font-extrabold">{batch.sabor} · lote {batch.id}</div><div className="text-[11px] font-semibold mt-0.5" style={{ color: T.choco2 }}>{batch.forShakes ? "Para malteadas y crepas" : batch.destinationRegistered ? `Destino: ${batch.destino}` : "Destino pendiente"}{batch.fecha ? ` · ${batch.fecha}` : ""}</div></div><div className="text-right shrink-0"><div className="display text-2xl" style={{ color: batch.forShakes ? "#8A4D7A" : "#96690F" }}>{batch.imperfectas}</div><div className="text-[9px] uppercase font-extrabold" style={{ color: T.choco2 }}>imperfectas</div>{batch.descartadas > 0 && <div className="text-[9px] font-extrabold mt-0.5" style={{ color: "#A03B2A" }}>{batch.descartadas} descartadas</div>}</div></div>)}
          {figure.imperfectBatches.length === 0 && <div className="text-sm font-semibold p-3 rounded-xl" style={{ background: T.vainilla, color: T.choco2 }}>Esta figura no tiene imperfectas registradas.</div>}
        </div>
      </Card>
    </>
  );
}
