import { useEffect, useMemo, useState } from "react";
import {
  activarFichaTecnicaCocina, archivarBorradorFichaTecnica,
  guardarFichaTecnicaCocina, listarFichasIntegralesElaboracion,
} from "../../lib/rpc";
import {
  addKitchenProcedureStep, createInternalPreparationSheetDraft,
  moveKitchenProcedureStep, normalizeInternalPreparationSheetHistory,
  removeKitchenProcedureStep, updateKitchenProcedureStep,
  validateInternalPreparationSheetDraft,
} from "../../lib/kitchen-procedure-workflow";
import { hasRole } from "../../lib/user-roles";

export default function InternalPreparationSheetEditor({ db, subrecipe, perfil, refrescar, onClose, ui }) {
  const { T, Badge, Btn, BtnAsync, Card, Field, Input, Modal, inputStyle, toast } = ui;
  const [draft, setDraft] = useState(() => createInternalPreparationSheetDraft(subrecipe, db.subreceta_ingredientes));
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState([]);
  const [newLine, setNewLine] = useState({ itemId: "", cantidad: "" });
  const canPublish = hasRole(perfil, "Administrador");
  const inventoryById = useMemo(() => new Map((db.inventory_items || []).map((item) => [item.id, item])), [db.inventory_items]);
  const availableItems = useMemo(() => (db.inventory_items || []).filter((item) => (
    item.id !== subrecipe.itemId && !draft.formula.some((line) => line.itemId === item.id)
  )), [db.inventory_items, draft.formula, subrecipe.itemId]);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const envelope = await listarFichasIntegralesElaboracion(subrecipe.id);
      setHistory(normalizeInternalPreparationSheetHistory(envelope, subrecipe.id).rows);
    } catch (error) {
      setErrors([error.message]);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { loadHistory(); }, [subrecipe.id, db.kitchenProcedureSyncVersion]);

  function restoreCurrent() {
    setDraft(createInternalPreparationSheetDraft(subrecipe, db.subreceta_ingredientes));
    setErrors([]);
    setNewLine({ itemId: "", cantidad: "" });
  }

  async function saveDraft() {
    const validation = validateInternalPreparationSheetDraft(draft, db.inventory_items, subrecipe.itemId);
    setErrors(validation.errors);
    if (!validation.valid) return;
    setBusy("save");
    try {
      await guardarFichaTecnicaCocina(validation.payload);
      toast("ok", "Borrador integral guardado. La fórmula vigente todavía no cambió.");
      await loadHistory();
    } catch (error) {
      setErrors([error.message]);
    } finally {
      setBusy("");
    }
  }

  async function publish(row) {
    setBusy(`publish:${row.id}`);
    setErrors([]);
    try {
      await activarFichaTecnicaCocina(row.id);
      toast("ok", `Ficha v${row.version} publicada: fórmula y pasos ya son vigentes.`);
      await refrescar({ reason: "internal-preparation-sheet-published" });
      await loadHistory();
    } catch (error) {
      setErrors([error.message]);
    } finally {
      setBusy("");
    }
  }

  async function archive(row) {
    setBusy(`archive:${row.id}`);
    setErrors([]);
    try {
      await archivarBorradorFichaTecnica(row.id);
      toast("ok", `Borrador v${row.version} archivado; la ficha vigente sigue intacta.`);
      await loadHistory();
    } catch (error) {
      setErrors([error.message]);
    } finally {
      setBusy("");
    }
  }

  function addFormulaLine() {
    const quantity = Number(newLine.cantidad);
    if (!newLine.itemId || !Number.isFinite(quantity) || quantity <= 0) {
      setErrors(["Elegí un insumo e indicá una cantidad positiva."]);
      return;
    }
    setDraft((current) => ({ ...current, formula: [...current.formula, { itemId: newLine.itemId, cantidad: quantity }] }));
    setNewLine({ itemId: "", cantidad: "" });
    setErrors([]);
  }

  return <Modal title={`Ficha de elaboración · ${subrecipe.nombre}`} onClose={onClose} extraWide topLayer>
    <div className="rounded-2xl p-4 mb-4" style={{ background: T.soft, border: `1px solid ${T.border}` }}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Producción · ficha maestra de Cocina</div><div className="display text-xl font-semibold mt-1">Ingredientes y preparación en una sola versión</div><div className="text-xs font-semibold mt-1 max-w-2xl" style={{ color: T.choco2 }}>Las cantidades son por 1.000 g antes de merma. Cocina propone la fórmula y el paso a paso; solo Administración puede publicar la versión que se usará al producir.</div></div>
        <div className="flex flex-wrap gap-2"><Badge label={`Vigente v${subrecipe.procedure?.version || "—"}`} map={{ [`Vigente v${subrecipe.procedure?.version || "—"}`]: { bg: "#E6F1E3", fg: "#3F6B42" } }} /><Badge label={canPublish ? "Administración publica" : "Cocina propone"} /></div>
      </div>
    </div>

    <div className="grid lg:grid-cols-[1fr_.95fr] gap-4">
      <div>
        <Card className="p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-3"><div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>1 · Fórmula maestra</div><div className="font-bold mt-1">Insumos para obtener 1.000 g antes de merma</div></div><span className="text-xs font-extrabold" style={{ color: T.choco2 }}>{draft.formula.length}/30</span></div>
          <div className="space-y-2">
            {draft.formula.map((line, index) => {
              const item = inventoryById.get(line.itemId);
              return <div key={`${line.itemId}-${index}`} className="grid grid-cols-[minmax(0,1fr)_110px_auto] gap-2 items-center rounded-xl px-3 py-2" style={{ background: T.vainilla }}>
                <div className="min-w-0"><div className="text-sm font-bold truncate">{item?.nombre || line.itemId}</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>{item?.unidad || "unidad"} · stock {item?.stock ?? "—"}</div></div>
                <div className="relative"><Input type="number" min="0.0001" step="0.0001" value={line.cantidad} aria-label={`Cantidad de ${item?.nombre || line.itemId}`} onChange={(event) => setDraft((current) => ({ ...current, formula: current.formula.map((row, rowIndex) => rowIndex === index ? { ...row, cantidad: event.target.value } : row) }))} /><span className="absolute right-2 top-2.5 text-[10px] font-bold pointer-events-none" style={{ color: T.choco2 }}>{item?.unidad || ""}</span></div>
                <button type="button" aria-label={`Quitar ${item?.nombre || line.itemId}`} onClick={() => setDraft((current) => ({ ...current, formula: current.formula.filter((_, rowIndex) => rowIndex !== index) }))} className="w-8 h-8 rounded-full font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>×</button>
              </div>;
            })}
          </div>
          <div className="grid sm:grid-cols-[minmax(0,1fr)_120px_auto] gap-2 items-end mt-3 pt-3 border-t" style={{ borderColor: T.border }}>
            <Field label="Agregar insumo"><select value={newLine.itemId} onChange={(event) => setNewLine({ ...newLine, itemId: event.target.value })} className="w-full rounded-xl border px-3 py-2.5 text-sm font-semibold" style={inputStyle}><option value="">Elegir insumo…</option>{availableItems.map((item) => <option key={item.id} value={item.id}>{item.nombre} ({item.unidad})</option>)}</select></Field>
            <Field label="Cantidad"><Input type="number" min="0.0001" step="0.0001" value={newLine.cantidad} onChange={(event) => setNewLine({ ...newLine, cantidad: event.target.value })} /></Field>
            <Btn small kind="soft" onClick={addFormulaLine}>＋ Agregar</Btn>
          </div>
          <Field label="Fuente de las cantidades"><Input value={draft.formulaOrigin} onChange={(event) => setDraft({ ...draft, formulaOrigin: event.target.value })} placeholder="Ej. fórmula pesada y validada por Cocina" /></Field>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between gap-3 mb-3"><div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>2 · Paso a paso</div><div className="font-bold mt-1">Cómo debe preparar Cocina esta fórmula</div></div><label className="text-xs font-bold flex gap-2 items-center"><input type="checkbox" checked={draft.processDefined} onChange={(event) => setDraft({ ...draft, processDefined: event.target.checked })} /> Proceso oficial</label></div>
          <Field label="Nota operativa"><Input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></Field>
          <Field label="Fuente del procedimiento"><Input value={draft.sourceRef} onChange={(event) => setDraft({ ...draft, sourceRef: event.target.value })} /></Field>
          <div className="space-y-2">
            {draft.steps.map((step, index) => <div key={index} className="rounded-xl border p-3" style={{ borderColor: T.border }}>
              <div className="grid sm:grid-cols-[42px_minmax(0,1fr)] gap-2"><div className="w-9 h-9 rounded-full flex items-center justify-center font-extrabold" style={{ background: T.rosa, color: "#8E4B5A" }}>{index + 1}</div><div><Input value={step.title} onChange={(event) => setDraft(updateKitchenProcedureStep(draft, index, { title: event.target.value }))} placeholder="Nombre del paso" /><textarea value={step.detail} onChange={(event) => setDraft(updateKitchenProcedureStep(draft, index, { detail: event.target.value }))} placeholder="Instrucción concreta para Cocina" className="w-full rounded-xl border px-3 py-2 text-sm mt-2 min-h-[76px]" style={inputStyle} /></div></div>
              <div className="flex justify-end gap-1 mt-2"><Btn small kind="ghost" disabled={index === 0} onClick={() => setDraft(moveKitchenProcedureStep(draft, index, -1))}>↑</Btn><Btn small kind="ghost" disabled={index === draft.steps.length - 1} onClick={() => setDraft(moveKitchenProcedureStep(draft, index, 1))}>↓</Btn><Btn small kind="ghost" onClick={() => setDraft(removeKitchenProcedureStep(draft, index))}>Quitar</Btn></div>
            </div>)}
          </div>
          <div className="mt-3"><Btn small kind="soft" onClick={() => setDraft(addKitchenProcedureStep(draft))}>＋ Agregar paso</Btn></div>
        </Card>
      </div>

      <div>
        <Card className="p-4 mb-4">
          <div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>3 · Enviar a revisión</div><div className="text-sm font-semibold mt-2" style={{ color: T.choco2 }}>La ficha vigente no cambia al guardar. Administración revisa fórmula y pasos como una sola unidad.</div>
          {errors.length > 0 && <div className="rounded-xl p-3 mt-3 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{errors.map((error) => <div key={error}>× {error}</div>)}</div>}
          <div className="flex flex-wrap gap-2 mt-4"><Btn kind="ghost" onClick={restoreCurrent}>Restaurar vigente</Btn><BtnAsync disabled={Boolean(busy)} textoEnVuelo="Guardando borrador…" onClick={saveDraft}>Guardar para revisión</BtnAsync></div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.12em] font-extrabold" style={{ color: T.coral }}>Historial</div><div className="font-bold mt-1">Versiones de fórmula y pasos</div></div><span className="text-xs font-extrabold" style={{ color: T.choco2 }}>{history.length}</span></div>
          {historyLoading ? <div className="text-xs font-semibold py-5" style={{ color: T.choco2 }}>Cargando historial…</div> : <div className="space-y-3 mt-3 max-h-[620px] overflow-y-auto pr-1">{history.map((row) => <div key={row.id} className="rounded-xl border p-3" style={{ borderColor: row.status === "Vigente" ? "#B8D2B2" : T.border, background: row.status === "Vigente" ? "#F4FAF2" : T.surface }}>
            <div className="flex justify-between gap-3"><div className="font-extrabold">Versión {row.version}</div><Badge label={row.status} /></div><div className="text-[10px] font-semibold mt-1" style={{ color: T.choco2 }}>{row.formula.length} insumos · {row.steps.length} pasos · {row.formulaOrigin}</div><div className="text-xs font-semibold mt-2">{row.note}</div>
            <div className="mt-2 rounded-lg p-2" style={{ background: T.vainilla }}>{row.formula.map((line) => <div key={line.itemId} className="flex justify-between gap-3 text-[10px] py-0.5"><span>{inventoryById.get(line.itemId)?.nombre || line.itemId}</span><b>{line.cantidad} {inventoryById.get(line.itemId)?.unidad || ""}</b></div>)}</div>
            {row.status === "Borrador" && <div className="flex flex-wrap gap-2 mt-3">{canPublish && <BtnAsync small confirmar="¿Publicar fórmula y pasos? Tocá de nuevo" textoEnVuelo="Publicando…" disabled={Boolean(busy)} onClick={() => publish(row)}>Publicar para Cocina</BtnAsync>}<BtnAsync small kind="ghost" confirmar="¿Archivar borrador? Tocá de nuevo" textoEnVuelo="Archivando…" disabled={Boolean(busy)} onClick={() => archive(row)}>Archivar</BtnAsync>{!canPublish && <span className="text-[10px] font-bold" style={{ color: "#96690F" }}>Esperando aprobación de Administración</span>}</div>}
          </div>)}</div>}
        </Card>
      </div>
    </div>
  </Modal>;
}
