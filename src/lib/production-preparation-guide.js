import { isKitchenFigureName } from "./momos-domain-language.js";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("es");
}

function selectedFigures(quantities = []) {
  if (Array.isArray(quantities)) {
    return quantities
      .map((row) => ({ figure: String(row.figura || row.figure || "").trim(), quantity: Math.max(0, Math.trunc(number(row.cant ?? row.quantity))) }))
      .filter((row) => row.figure && row.quantity > 0);
  }
  return Object.entries(quantities)
    .map(([figure, quantity]) => ({ figure, quantity: Math.max(0, Math.trunc(number(quantity))) }))
    .filter((row) => row.figure && row.quantity > 0);
}

export function buildFigureBatchPreparationGuide({
  batch = {},
  preview = {},
  figures = [],
  subrecipes = [],
  fillingRules = [],
} = {}) {
  const figureByName = new Map(figures
    .filter((figure) => isKitchenFigureName(figure?.nombre))
    .map((figure) => [normalized(figure.nombre), figure]));
  const subrecipeById = new Map(subrecipes.map((subrecipe) => [subrecipe.id, subrecipe]));
  const activeFillings = fillingRules
    .filter((rule) => rule.activo !== false && number(rule.gramosPorUnidad) > 0)
    .map((rule) => ({
      id: rule.id || rule.subrecetaId,
      name: subrecipeById.get(rule.subrecetaId)?.nombre || rule.subrecetaId,
      gramsPerUnit: number(rule.gramosPorUnidad),
      totalGrams: number(rule.gramosPorUnidad) * number(preview.totalUnits),
    }));
  const fillingPerUnitGrams = activeFillings.reduce((sum, filling) => sum + filling.gramsPerUnit, 0);
  const rows = selectedFigures(batch.figuras?.length ? batch.figuras : [{ figura: batch.figura, cant: batch.prod }])
    .map((selected) => {
      const figure = figureByName.get(normalized(selected.figure));
      const finalGramsPerUnit = number(figure?.gramajeG);
      if (!(finalGramsPerUnit > fillingPerUnitGrams)) return null;
      const mousseGramsPerUnit = finalGramsPerUnit - fillingPerUnitGrams;
      return {
        figure: selected.figure,
        quantity: selected.quantity,
        finalGramsPerUnit,
        finalGrams: finalGramsPerUnit * selected.quantity,
        mousseGramsPerUnit,
        mousseGrams: mousseGramsPerUnit * selected.quantity,
        fillingGramsPerUnit: fillingPerUnitGrams,
        fillingGrams: fillingPerUnitGrams * selected.quantity,
      };
    })
    .filter(Boolean);
  const molds = rows.map((row) => `${row.quantity} ${row.figure}`).join(" · ");
  const fillingsText = activeFillings.map((filling) => `${filling.totalGrams} g de ${filling.name} (${filling.gramsPerUnit} g/unidad)`).join(" · ");
  const targetHours = Math.max(0, number(batch.horasCongelacion)) || 10;
  const unitsText = number(preview.totalUnits) === 1 ? "1 unidad" : `${number(preview.totalUnits)} unidades`;

  return {
    ready: Boolean(preview.canCalculate && rows.length > 0 && rows.reduce((sum, row) => sum + row.quantity, 0) === number(preview.totalUnits)),
    rows,
    fillings: activeFillings,
    steps: [
      {
        title: "Verificar y pesar las bases",
        detail: `Separá ${number(preview.mousseOutputGrams)} g de mousse y ${number(preview.totalFillingGrams)} g de rellenos para ${unitsText}.`,
      },
      {
        title: "Preparar los moldes",
        detail: molds ? `Alistá y verificá los moldes: ${molds}.` : "La composición por figura no está disponible; no continúes hasta verificarla.",
      },
      {
        title: "Formar la primera capa",
        detail: "Dosificá parte de la mousse en cada molde. Conservá el saldo para cerrar; el total exacto por figura aparece en la tabla.",
      },
      {
        title: "Agregar los rellenos",
        detail: fillingsText || "No hay una regla activa de relleno; revisá la ficha antes de continuar.",
      },
      {
        title: "Cerrar y controlar el peso",
        detail: "Completá con la mousse restante, nivelá y verificá que cada unidad alcance el gramaje oficial indicado, sin cambiar la fórmula por personaje.",
      },
      {
        title: "Congelar",
        detail: `Trasladá el lote al congelador e iniciá el cronómetro de ${targetHours} h en MOMOS OPS.`,
      },
    ],
  };
}

function specificSubrecipeSteps(subrecipe = {}) {
  const type = String(subrecipe.tipo || "");
  const name = normalized(subrecipe.nombre);
  const procedure = subrecipe.procedure;
  if (procedure && typeof procedure === "object") {
    const governedSteps = (Array.isArray(procedure.steps) ? procedure.steps : [])
      .map((step) => ({
        title: String(step?.title || "").trim(),
        detail: String(step?.detail || "").trim(),
      }))
      .filter((step) => step.title && step.detail);
    return {
      governed: true,
      version: Math.max(0, Math.trunc(number(procedure.version))),
      sourceRef: String(procedure.sourceRef || "").trim(),
      processDefined: procedure.processDefined === true && governedSteps.length > 0,
      note: String(procedure.note || "La ficha técnica vigente no contiene una nota operativa.").trim(),
      steps: governedSteps,
    };
  }

  if (type === "mousse_frutal") return {
    processDefined: false,
    note: "La fórmula es oficial; falta parametrizar temperaturas y tiempos del proceso frutal.",
    steps: [
      { title: "Preparar la base frutal", detail: "Procesá la fruta o pulpa con los líquidos y secos de la fórmula hasta obtener una mezcla uniforme." },
      { title: "Incorporar la estabilización", detail: "Hidratá la grenetina con el agua asignada en la fórmula e incorporala de manera uniforme." },
      { title: "Integrar la crema", detail: "Agregá la crema de leche y homogeneizá sin alterar las cantidades pesadas." },
    ],
  };
  if (type === "mousse_cremosa") return {
    processDefined: false,
    note: "La fórmula es oficial; falta parametrizar temperaturas y tiempos. La crema se usa líquida, no montada.",
    steps: [
      { title: "Preparar la fase cremosa", detail: "Usá la crema líquida, no montada, y reuní los líquidos y secos según la fórmula." },
      { title: "Incorporar la estabilización", detail: "Hidratá la grenetina con el agua asignada e incorporala de manera uniforme." },
      { title: "Emulsionar", detail: "Emulsioná la preparación hasta que quede homogénea." },
      ...(name.includes("m&m") ? [{ title: "Agregar M&M al final", detail: "Incorporá los M&M al final y no los licúes, para evitar que suelten color." }] : []),
    ],
  };
  if (type === "cheesecake") return {
    processDefined: true,
    note: "Procedimiento oficial de la receta MOMOS.",
    steps: [
      { title: "Hidratar la grenetina", detail: "Hidratá la grenetina con el agua pesada para esta tanda." },
      { title: "Preparar la mezcla base", detail: "Mezclá queso crema con leche condensada, limón, vainilla y sal." },
      { title: "Agregar la crema", detail: "Incorporá la crema de leche hasta homogeneizar." },
      { title: "Estabilizar", detail: "Derretí la grenetina hidratada e incorporala en hilo a la mezcla." },
      { title: "Conservar o dosificar", detail: "Refrigerá la elaboración o usala inmediatamente como relleno." },
    ],
  };
  if (type === "ganache") return {
    processDefined: true,
    note: "Procedimiento oficial de la receta MOMOS.",
    steps: [
      { title: "Calentar la crema", detail: "Calentá la crema sin dejar que hierva fuertemente." },
      { title: "Verter sobre el chocolate", detail: "Verté la crema caliente sobre el chocolate pesado y dejá reposar 1 minuto." },
      { title: "Emulsionar", detail: "Mezclá hasta obtener una emulsión uniforme." },
      { title: "Terminar la ganache", detail: "Incorporá la mantequilla y la sal pesadas para la tanda." },
    ],
  };
  if (type === "crocante") return {
    processDefined: true,
    note: "Proceso sin horno derivado de la ficha oficial de la base crocante.",
    steps: [
      { title: "Preparar la galleta", detail: "Triturá y pesá la galleta elegida. Si usás Saltín, omití la sal extra." },
      { title: "Integrar", detail: "Agregá la mantequilla derretida, la sal y el azúcar opcional de la fórmula." },
      { title: "Uniformar", detail: "Mezclá hasta lograr una textura húmeda y uniforme lista para compactar." },
    ],
  };
  if (type === "salsa" && (name.includes("maracuy") || name.includes("frutos rojos"))) return {
    processDefined: true,
    note: "Procedimiento disponible en la receta oficial; el punto final se valida por textura.",
    steps: name.includes("maracuy") ? [
      { title: "Reunir la fórmula", detail: "Combiná la pulpa, azúcar, agua, limón y sal ya pesados." },
      { title: "Cocinar", detail: "Cociná hasta que espese ligeramente; debe seguir siendo salsa y no caramelo." },
    ] : [
      { title: "Reunir la fórmula", detail: "Combiná la fruta, azúcar, agua, limón y sal ya pesados." },
      { title: "Cocinar", detail: "Cociná la mezcla y triturá solo un poco, conservando textura de fruta." },
    ],
  };
  return {
    processDefined: false,
    note: "La fórmula y sus cantidades están cargadas, pero el procedimiento fino todavía no está estandarizado. No improvisar temperaturas ni tiempos.",
    steps: [],
  };
}

export function buildSubrecipePreparationGuide(subrecipe = {}) {
  const specific = specificSubrecipeSteps(subrecipe);
  return {
    ...specific,
    steps: [
      { title: "Mise en place", detail: "Verificá disponibilidad, pesá por separado cada ingrediente mostrado y prepará utensilios y recipiente." },
      ...specific.steps,
      { title: "Pesar y registrar el rendimiento", detail: "Pesá los gramos realmente obtenidos, anotá cualquier diferencia y registrá la elaboración en MOMOS OPS." },
    ],
  };
}
