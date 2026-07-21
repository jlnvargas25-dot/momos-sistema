import { useEffect, useMemo, useRef, useState } from "react";
import {
  createInventoryIdempotencyKey, guardarRecetaProducto, mutarCatalogoCrmDelta,
  sincronizarCostoProducto,
} from "../../lib/rpc";
import { buildKitchenFigureSheet, sortKitchenFigures } from "../../lib/kitchen-figure-sheet";
import {
  isCommercialFamilyProduct, isKitchenFigureName, productUsesHorizontalFigure,
} from "../../lib/momos-domain-language";
import { hasRole } from "../../lib/user-roles";

function silhouetteLabel(species) {
  if (species === "gato") return "Silueta visual: gato";
  if (species === "perro") return "Silueta visual: perro";
  return "Silueta visual sin registrar";
}

export default function KitchenRecipeCenter({
  db, perfil, open, initialProductId, onClose, onOpenPreparationSheet, refrescar,
  aplicarMutacionCatalogoCrm, capturarContextoMutacionCatalogoCrm, ui,
}) {
  const { T, Badge, Btn, BtnAsync, Card, Empty, Field, Input, Modal, fmt, inputStyle, recipeCost, recipeLines, toast } = ui;
  const [tab, setTab] = useState("figures");
  const [familyFilter, setFamilyFilter] = useState("");
  const [selectedFigureName, setSelectedFigureName] = useState("");
  const flavors = useMemo(
    () => [...(db.settings?.saboresFrutales || []), ...(db.settings?.saboresCremosos || [])],
    [db.settings?.saboresFrutales, db.settings?.saboresCremosos],
  );
  const [selectedFlavor, setSelectedFlavor] = useState("");
  const [productId, setProductId] = useState(null);
  const [draft, setDraft] = useState([]);
  const [line, setLine] = useState({ itemId: "", cantidad: "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const mutationKeyRef = useRef(createInventoryIdempotencyKey());
  const consumedInitialProductRef = useRef("");
  const canEdit = hasRole(perfil, "Administrador");
  const product = productId ? (db.products || []).find((row) => row.id === productId) : null;
  const figures = useMemo(
    () => sortKitchenFigures((db.figuras || []).filter(
      (row) => row.activo !== false && row.productId && isKitchenFigureName(row.nombre),
    )),
    [db.figuras],
  );
  const mappedFigureProductIds = useMemo(() => new Set(figures.map((row) => row.productId).filter(Boolean)), [figures]);
  const operationalProducts = useMemo(
    () => (db.products || []).filter((row) => row.activo !== false
      && row.tipo !== "combo"
      && !isCommercialFamilyProduct(row)
      && !mappedFigureProductIds.has(row.id)),
    [db.products, mappedFigureProductIds],
  );
  const preparations = useMemo(() => (db.subrecetas || []).filter((row) => row.activo !== false), [db.subrecetas]);
  const visibleFigures = familyFilter ? figures.filter((figure) => figure.productId === familyFilter) : figures;
  const selectedFigure = selectedFigureName ? figures.find((figure) => figure.nombre === selectedFigureName) : null;
  const figureSheet = useMemo(() => buildKitchenFigureSheet({
    figure: selectedFigure,
    flavor: selectedFlavor || flavors[0] || "",
    figures,
    products: db.products || [],
    subrecipes: db.subrecetas || [],
    subrecipeIngredients: db.subreceta_ingredientes || [],
    fillingRules: db.figura_relleno || [],
    inventory: db.inventory_items || [],
    freezingHours: db.settings?.horasCongelacion || 10,
  }), [selectedFigure, selectedFlavor, flavors, figures, db.products, db.subrecetas, db.subreceta_ingredientes, db.figura_relleno, db.inventory_items, db.settings?.horasCongelacion]);

  useEffect(() => {
    if (!selectedFlavor && flavors.length) setSelectedFlavor(flavors[0]);
  }, [selectedFlavor, flavors]);

  function openProductRecipe(nextProduct) {
    if (!nextProduct) return;
    setDraft(recipeLines(db, nextProduct.id).map((row) => ({ ...row })));
    setLine({ itemId: "", cantidad: "" });
    setDirty(false);
    setError("");
    setProductId(nextProduct.id);
  }

  useEffect(() => {
    if (!open) {
      consumedInitialProductRef.current = "";
      return;
    }
    const initialKey = String(initialProductId || "");
    if (!initialKey || consumedInitialProductRef.current === initialKey) return;
    const mappedFigures = figures.filter((figure) => String(figure.productId) === initialKey);
    const target = (db.products || []).find((row) => String(row.id) === initialKey);
    const commercialFamily = isCommercialFamilyProduct(target);
    if (mappedFigures.length || commercialFamily) {
      consumedInitialProductRef.current = initialKey;
      setTab("figures");
      setFamilyFilter(mappedFigures.length ? initialKey : "");
      setProductId(null);
    } else if (target) {
      consumedInitialProductRef.current = initialKey;
      setTab("other-products");
      openProductRecipe(target);
    }
  }, [open, initialProductId, db.products, figures]);

  function closeCenter() {
    setProductId(null);
    setSelectedFigureName("");
    setFamilyFilter("");
    setDirty(false);
    setError("");
    onClose();
  }

  async function executeProductDelta(operation, payload, legacyAction) {
    if (db.catalogCrmDeltaReady === true
        && typeof aplicarMutacionCatalogoCrm === "function"
        && typeof capturarContextoMutacionCatalogoCrm === "function") {
      const key = mutationKeyRef.current;
      const context = capturarContextoMutacionCatalogoCrm();
      const envelope = await mutarCatalogoCrmDelta(operation, payload, key);
      const applied = await aplicarMutacionCatalogoCrm(envelope, operation, context);
      mutationKeyRef.current = createInventoryIdempotencyKey();
      if (applied?.status === "discarded") await refrescar({ reason: "kitchen-recipe-delta-discard" });
      return applied?.result;
    }
    const result = await legacyAction();
    await refrescar({ reason: "kitchen-recipe-legacy-mutation" });
    return result;
  }

  async function saveRecipe() {
    if (!product || !canEdit) return;
    if (draft.some((row) => !(Number(row.cantidad) > 0))) {
      setError("Todas las cantidades deben ser mayores que cero.");
      return;
    }
    setBusy("save");
    setError("");
    try {
      const lines = draft.map((row) => ({ item_id: row.itemId, cantidad: Number(row.cantidad) }));
      await executeProductDelta(
        "guardar_receta_producto",
        { product_id: product.id, lineas: lines },
        () => guardarRecetaProducto(product.id, draft),
      );
      setDirty(false);
      toast("ok", "Receta de Producción guardada.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy("");
    }
  }

  async function syncProductCost() {
    if (!product || !canEdit || dirty) return;
    setBusy("cost");
    setError("");
    try {
      await executeProductDelta(
        "sincronizar_costo_producto",
        { product_id: product.id },
        () => sincronizarCostoProducto(product.id),
      );
      toast("ok", "Costo del producto actualizado desde la receta.");
    } catch (syncError) {
      setError(syncError.message);
    } finally {
      setBusy("");
    }
  }

  if (!open) return null;

  if (figureSheet) {
    const { preview, guide, commercialFamily } = figureSheet;
    return <Modal title={`Ficha de figura · ${figureSheet.identity}`} onClose={() => setSelectedFigureName("")} wide topLayer>
      <div data-testid="kitchen-figure-sheet">
        <div className="rounded-2xl p-4 mb-4" style={{ background: T.soft, border: `1px solid ${T.border}` }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Figura de Cocina</div>
              <div className="display text-2xl font-semibold mt-1">{figureSheet.displayName}</div>
              <div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>La figura es el postre físico y define forma y gramaje. El sabor cambia la mousse; la familia comercial define cómo se vende y reserva. Gato o perro describe únicamente su silueta visual.</div>
            </div>
            <div className="flex flex-wrap gap-2"><Badge label={silhouetteLabel(figureSheet.species)} /><Badge label={`${figureSheet.grams} g por unidad`} /></div>
          </div>
          <div className="rounded-xl px-3 py-2 mt-3 text-xs font-semibold" style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.choco2 }}>
            <b style={{ color: T.choco }}>Familia comercial:</b> {commercialFamily?.nombre || "Sin presentación comercial asignada"}. Esta referencia conserva precio, disponibilidad y reserva; no reemplaza la ficha física de {figureSheet.identity}.
          </div>
        </div>

        <Field label="Sabor de esta ficha">
          <select value={selectedFlavor || flavors[0] || ""} onChange={(event) => setSelectedFlavor(event.target.value)} className="w-full rounded-xl border px-3 py-2.5 text-sm font-semibold" style={inputStyle}>
            {flavors.map((flavor) => <option key={flavor} value={flavor}>{figureSheet.identity} de {flavor}</option>)}
          </select>
        </Field>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 my-4">
          <Card className="p-3"><div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>Peso final</div><div className="display text-xl mt-1" style={{ color: T.coral }}>{preview.totalProductGrams} g</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>1 {figureSheet.identity}</div></Card>
          <Card className="p-3"><div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>Mousse de {selectedFlavor || flavors[0]}</div><div className="display text-xl mt-1" style={{ color: "#3F6B42" }}>{preview.mousseOutputGrams} g</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>según el sabor</div></Card>
          <Card className="p-3"><div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>Rellenos</div><div className="display text-xl mt-1" style={{ color: "#63518A" }}>{preview.totalFillingGrams} g</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>{guide.fillings.length} {guide.fillings.length === 1 ? "elaboración" : "elaboraciones"}</div></Card>
          <Card className="p-3"><div className="text-[10px] uppercase font-extrabold" style={{ color: T.choco2 }}>Costo técnico</div><div className="display text-xl mt-1">{fmt(preview.totalFormulaCost)}</div><div className="text-[10px] font-semibold" style={{ color: T.choco2 }}>desde fórmulas vigentes</div></Card>
        </div>

        {(preview.errors.length > 0 || preview.warnings.length > 0) && <div className="space-y-2 mb-4">
          {preview.errors.map((row) => <div key={row.code} role="alert" className="rounded-xl p-3 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>✕ {row.message}</div>)}
          {preview.warnings.map((row) => <div key={`${row.code}-${row.message}`} className="rounded-xl p-3 text-xs font-bold" style={{ background: "#FBE8C8", color: "#7A5410" }}>⚠ {row.message}</div>)}
        </div>}

        <div className="grid lg:grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="text-xs font-extrabold" style={{ color: T.choco2 }}>COMPOSICIÓN EXACTA DE UNA UNIDAD</div>
            <div className="text-[11px] font-semibold mt-1 mb-3" style={{ color: T.choco2 }}>Estas elaboraciones forman {figureSheet.displayName}. Sus fórmulas se administran una sola vez y se reutilizan en todas las figuras.</div>
            <div className="space-y-2">
              {preview.preparations.map((preparation) => {
                const subrecipe = (db.subrecetas || []).find((row) => row.id === preparation.subrecipeId);
                return <div key={preparation.subrecipeId} className="rounded-xl p-3" style={{ background: T.vainilla }}>
                  <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] uppercase font-extrabold" style={{ color: T.coral }}>{preparation.kind}</div><div className="text-sm font-bold mt-0.5">{preparation.name}</div></div><div className="display text-lg shrink-0">{preparation.outputGrams} g</div></div>
                  <div className="flex items-center justify-between gap-2 mt-2"><span className="text-[10px] font-bold" style={{ color: preparation.formulaReady ? "#3F6B42" : "#A03B2A" }}>{preparation.formulaReady ? "✓ Fórmula vigente" : "✕ Falta completar fórmula"}</span>{subrecipe && <button type="button" className="text-[10px] font-extrabold" style={{ color: T.coral }} onClick={() => onOpenPreparationSheet(subrecipe)}>Ver fórmula y pasos ›</button>}</div>
                </div>;
              })}
              {preview.preparations.length === 0 && <Empty icon="🧾" text="No fue posible formar la composición de esta figura y sabor." />}
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-xs font-extrabold" style={{ color: T.choco2 }}>INSUMOS PARA PREPARAR LAS ELABORACIONES</div>
            <div className="text-[11px] font-semibold mt-1 mb-3" style={{ color: T.choco2 }}>Cantidades proporcionales para obtener mousse y rellenos de una unidad.</div>
            <div className="space-y-2">
              {preview.ingredients.map((ingredient) => <div key={ingredient.itemId} className="rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-xs" style={{ background: T.vainilla }}><span className="font-bold">{ingredient.name}</span><span className="font-extrabold shrink-0" style={{ color: ingredient.enough ? "#3F6B42" : "#A03B2A" }}>{ingredient.requiredQuantity} {ingredient.unit}</span></div>)}
              {preview.ingredients.length === 0 && <div className="rounded-xl p-3 text-xs font-semibold" style={{ background: "#FBE8C8", color: "#7A5410" }}>Primero completá las fórmulas de las elaboraciones para calcular los insumos crudos.</div>}
            </div>
          </Card>
        </div>

        <Card className="p-4 mt-3">
          <div className="text-xs font-extrabold" style={{ color: T.choco2 }}>PASO A PASO PARA FORMAR {figureSheet.displayName.toLocaleUpperCase("es")}</div>
          <div className="grid sm:grid-cols-2 gap-2 mt-3">{guide.steps.map((step, index) => <div key={`${index}-${step.title}`} className="rounded-xl p-3 flex gap-3" style={{ background: T.vainilla }}><span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-extrabold" style={{ background: T.rosa, color: T.coral }}>{index + 1}</span><div><div className="text-xs font-extrabold">{step.title}</div><div className="text-[11px] font-semibold mt-0.5 leading-relaxed" style={{ color: T.choco2 }}>{step.detail}</div></div></div>)}</div>
        </Card>

        <div className="flex justify-between gap-2 mt-4"><Btn kind="ghost" onClick={() => setSelectedFigureName("")}>← Volver a figuras</Btn><div className="text-[10px] font-semibold max-w-md text-right" style={{ color: T.choco2 }}>La ficha se calcula desde el gramaje de la figura y las fórmulas vigentes. No usa la receta genérica de la familia comercial.</div></div>
      </div>
    </Modal>;
  }

  if (product) {
    const estimatedCost = draft.reduce((total, row) => {
      const item = (db.inventory_items || []).find((candidate) => candidate.id === row.itemId);
      return total + Number(row.cantidad || 0) * Number(item?.costo || 0);
    }, 0);
    const availableItems = (db.inventory_items || []).filter((item) => !draft.some((row) => row.itemId === item.id));
    return <Modal title={`Receta operativa · ${product.nombre}`} onClose={() => setProductId(null)} wide topLayer>
      <div className="rounded-2xl p-4 mb-4" style={{ background: T.soft, border: `1px solid ${T.border}` }}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Preparación al momento · receta por unidad</div><div className="display text-xl font-semibold mt-1">Qué usa Cocina para preparar una unidad</div><div className="text-xs font-semibold mt-1 max-w-2xl" style={{ color: T.choco2 }}>Esta receta aplica a productos que no son figuras: bebidas, crepas, cuchareables y otras preparaciones del pedido.</div>{productUsesHorizontalFigure(product) && <div className="inline-flex mt-2 rounded-full px-3 py-1 text-[10px] font-extrabold" style={{ background: "#FFF1D6", color: "#7A5510" }}>Incluye Horizontal como decoración auxiliar · no es una variante vendible</div>}</div><Badge label={canEdit ? "Administración edita" : "Consulta de Cocina"} /></div>
      </div>
      <div className="space-y-2">
        {draft.map((row) => {
          const item = (db.inventory_items || []).find((candidate) => candidate.id === row.itemId);
          if (!item) return null;
          return <Card key={row.id || row.itemId} className="p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0"><div className="text-sm font-bold truncate">{item.nombre}</div><div className="text-xs" style={{ color: T.choco2 }}>{fmt(item.costo)}/{item.unidad} · stock {item.stock} {item.unidad}</div></div>
            <div className="flex items-center gap-2"><Input type="number" min="0" step="0.0001" value={row.cantidad} disabled={!canEdit} aria-label={`Cantidad de ${item.nombre}`} onChange={(event) => { setDraft((rows) => rows.map((candidate) => candidate.itemId === row.itemId ? { ...candidate, cantidad: event.target.value } : candidate)); setDirty(true); }} /><span className="text-xs font-bold" style={{ color: T.choco2 }}>{item.unidad}</span><span className="text-xs font-bold w-20 text-right">{fmt(item.costo * row.cantidad)}</span>{canEdit && <button type="button" aria-label={`Quitar ${item.nombre}`} onClick={() => { setDraft((rows) => rows.filter((candidate) => candidate.itemId !== row.itemId)); setDirty(true); }} className="w-8 h-8 rounded-full font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>×</button>}</div>
          </Card>;
        })}
        {draft.length === 0 && <Empty icon="🧾" text="Este producto todavía no tiene una receta de Producción." />}
      </div>
      {canEdit && <Card className="p-3 mt-3"><div className="text-xs font-extrabold mb-2" style={{ color: T.choco2 }}>AGREGAR INSUMO</div><div className="grid sm:grid-cols-[minmax(0,1fr)_120px_auto] gap-2 items-end"><Field label="Insumo"><select value={line.itemId} onChange={(event) => setLine({ ...line, itemId: event.target.value })} className="w-full rounded-xl border px-3 py-2.5 text-sm font-semibold" style={inputStyle}><option value="">Elegir insumo…</option>{availableItems.map((item) => <option key={item.id} value={item.id}>{item.nombre} ({item.unidad})</option>)}</select></Field><Field label="Cantidad"><Input type="number" min="0" step="0.0001" value={line.cantidad} onChange={(event) => setLine({ ...line, cantidad: event.target.value })} /></Field><Btn small kind="soft" onClick={() => { const quantity = Number(line.cantidad); if (!line.itemId || !(quantity > 0)) return; setDraft((rows) => [...rows, { id: `draft-${line.itemId}`, productId: product.id, itemId: line.itemId, cantidad: quantity }]); setLine({ itemId: "", cantidad: "" }); setDirty(true); }}>＋ Agregar</Btn></div></Card>}
      {error && <div role="alert" className="rounded-xl p-3 mt-3 text-xs font-bold" style={{ background: "#F6D4CD", color: "#A03B2A" }}>{error}</div>}
      <Card className="p-4 mt-3"><div className="flex justify-between gap-3 text-sm"><span className="font-semibold">Costo estimado por receta</span><b className="display text-lg" style={{ color: T.coral }}>{fmt(estimatedCost)}</b></div><div className="flex justify-between gap-3 text-xs mt-1" style={{ color: T.choco2 }}><span>Costo registrado</span><b>{fmt(product.costo)}</b></div></Card>
      <div className="flex flex-wrap justify-between gap-2 mt-4"><Btn kind="ghost" onClick={() => setProductId(null)}>← Volver al recetario</Btn>{canEdit && <div className="flex flex-wrap gap-2"><BtnAsync kind="soft" disabled={dirty || Boolean(busy) || draft.length === 0 || Math.round(estimatedCost) === product.costo} textoEnVuelo="Actualizando costo…" onClick={syncProductCost}>Actualizar costo</BtnAsync><BtnAsync disabled={!dirty || Boolean(busy)} textoEnVuelo="Guardando receta…" onClick={saveRecipe}>Guardar receta</BtnAsync></div>}</div>
    </Modal>;
  }

  return <Modal title="📖 Recetario de Cocina" onClose={closeCenter} extraWide>
    <div data-testid="kitchen-recipe-center">
      <div className="rounded-2xl p-4 mb-4" style={{ background: T.soft, border: `1px solid ${T.border}` }}><div className="text-[10px] uppercase tracking-[.14em] font-extrabold" style={{ color: T.coral }}>Un solo lugar de trabajo</div><div className="display text-xl font-semibold mt-1">Productos de Cocina y elaboraciones de MOMOS</div><div className="text-xs font-semibold mt-1" style={{ color: T.choco2 }}>Figuras, productos al momento y elaboraciones viven aquí. Los productos al momento son bebidas, crepas y cuchareables. Cocina trabaja con Lizi, Momo, Rocco, Teo, Toby, Danna y Max como figuras físicas. “Momo Gatito”, “Momo Perrito” y “Momo premium” son familias comerciales para vender, cobrar y reservar; no son figuras.</div></div>
      <div className="inline-flex flex-wrap gap-1 rounded-2xl p-1 mb-4" style={{ background: T.vainilla, border: `1px solid ${T.border}` }} role="tablist" aria-label="Tipo de receta">
        <button type="button" role="tab" aria-selected={tab === "figures"} onClick={() => setTab("figures")} className="rounded-xl px-4 py-2 text-xs font-extrabold" style={{ background: tab === "figures" ? T.surface : "transparent", color: tab === "figures" ? T.coral : T.choco2 }}>Figuras · {figures.length}</button>
        <button type="button" role="tab" aria-selected={tab === "other-products"} onClick={() => setTab("other-products")} className="rounded-xl px-4 py-2 text-xs font-extrabold" style={{ background: tab === "other-products" ? T.surface : "transparent", color: tab === "other-products" ? T.coral : T.choco2 }}>Preparaciones al momento · {operationalProducts.length}</button>
        <button type="button" role="tab" aria-selected={tab === "preparations"} onClick={() => setTab("preparations")} className="rounded-xl px-4 py-2 text-xs font-extrabold" style={{ background: tab === "preparations" ? T.surface : "transparent", color: tab === "preparations" ? T.coral : T.choco2 }}>Elaboraciones · {preparations.length}</button>
      </div>

      {tab === "figures" && <>
        {familyFilter && <div className="rounded-xl px-3 py-2 mb-3 flex items-center justify-between gap-3 text-xs font-semibold" style={{ background: T.vainilla, color: T.choco2 }}><span>Mostrando las figuras vendidas dentro de <b>{(db.products || []).find((row) => row.id === familyFilter)?.nombre}</b>.</span><button type="button" className="font-extrabold" style={{ color: T.coral }} onClick={() => setFamilyFilter("")}>Ver todas</button></div>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{visibleFigures.map((figure) => {
          const family = (db.products || []).find((row) => row.id === figure.productId);
          return <Card key={figure.nombre} className="p-4" onClick={() => setSelectedFigureName(figure.nombre)} aria-label={`Abrir ficha de figura ${figure.nombre}`}>
            <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] uppercase font-extrabold" style={{ color: T.coral }}>Figura de Cocina</div><div className="display text-xl font-semibold mt-1">{figure.nombre}</div></div><span className="display text-xl" style={{ color: "#3F6B42" }}>{figure.gramajeG} <small className="text-[9px]">g</small></span></div>
            <div className="text-xs font-semibold mt-2" style={{ color: T.choco2 }}>{silhouetteLabel(figure.especie)} · {flavors.length} sabores posibles</div>
            <div className="rounded-xl px-3 py-2 mt-3 text-[10px] font-semibold" style={{ background: T.vainilla, color: T.choco2 }}><b>Familia de venta:</b> {family?.nombre || "sin asignar"}</div>
            <div className="text-[10px] font-extrabold mt-3 pt-3 border-t" style={{ borderColor: T.border, color: T.coral }}>Ver sabores, cantidades y pasos ›</div>
          </Card>;
        })}</div>
        {visibleFigures.length === 0 && <Empty icon="🍨" text="No hay figuras activas dentro de esta familia comercial." />}
      </>}

      {tab === "other-products" && <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{operationalProducts.map((row) => { const lines = recipeLines(db, row.id); const usesHorizontal = productUsesHorizontalFigure(row); return <Card key={row.id} className="p-4" onClick={() => openProductRecipe(row)} aria-label={`Abrir receta de Producción de ${row.nombre}`}><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] uppercase font-extrabold" style={{ color: T.coral }}>Producto real de Cocina · preparación al momento</div><div className="font-bold mt-1">{row.nombre}</div></div><span className="display text-lg" style={{ color: lines.length ? "#3F6B42" : "#A03B2A" }}>{lines.length}</span></div><div className="text-xs font-semibold mt-2" style={{ color: T.choco2 }}>{lines.length ? `${lines.length} insumo${lines.length === 1 ? "" : "s"} · costo ${fmt(recipeCost(db, row.id))}` : "Sin receta registrada"}</div>{usesHorizontal && <div className="rounded-xl px-3 py-2 mt-3 text-[10px] font-bold" style={{ background: "#FFF1D6", color: "#7A5510" }}>Usa Horizontal como decoración auxiliar. No crea stock por figura.</div>}<div className="text-[10px] font-extrabold mt-3 pt-3 border-t" style={{ borderColor: T.border, color: T.coral }}>{canEdit ? "Gestionar receta ›" : "Consultar receta ›"}</div></Card>; })}</div>}

      {tab === "preparations" && <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{preparations.map((row) => { const formulaCount = (db.subreceta_ingredientes || []).filter((lineRow) => lineRow.subrecetaId === row.id).length; const stepCount = row.procedure?.steps?.length || 0; return <Card key={row.id} className="p-4" onClick={() => onOpenPreparationSheet(row)} aria-label={`Gestionar fórmula y pasos de ${row.nombre}`}><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] uppercase font-extrabold" style={{ color: T.coral }}>Elaboración interna</div><div className="font-bold mt-1">{row.nombre}</div></div><Badge label={row.procedure?.processDefined ? "Proceso oficial" : "Por completar"} /></div><div className="text-xs font-semibold mt-2" style={{ color: T.choco2 }}>{formulaCount} insumo{formulaCount === 1 ? "" : "s"} · {stepCount} paso{stepCount === 1 ? "" : "s"}</div><div className="text-[10px] font-extrabold mt-3 pt-3 border-t" style={{ borderColor: T.border, color: T.coral }}>Gestionar fórmula y pasos ›</div></Card>; })}</div>}
    </div>
  </Modal>;
}
