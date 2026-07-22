import { calculateProductionInputPreview } from "./production-input-preview.js";
import { buildFigureBatchPreparationGuide } from "./production-preparation-guide.js";
import {
  expectedFigureProductId, figureProductId, isCommercialFamilyProduct, isKitchenFigureName,
} from "./momos-domain-language.js";

export const KITCHEN_FIGURE_ORDER = Object.freeze([
  "Lizi", "Momo", "Rocco", "Teo", "Toby", "Danna", "Max",
]);

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("es");
}

export function sortKitchenFigures(figures = []) {
  const order = new Map(KITCHEN_FIGURE_ORDER.map((name, index) => [normalized(name), index]));
  return [...figures].sort((left, right) => {
    const leftOrder = order.get(normalized(left?.nombre)) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(normalized(right?.nombre)) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left?.nombre || "").localeCompare(String(right?.nombre || ""), "es");
  });
}

export function buildKitchenFigureSheet({
  figure,
  flavor,
  figures = [],
  products = [],
  subrecipes = [],
  subrecipeIngredients = [],
  fillingRules = [],
  inventory = [],
  inventoryLots = [],
  inventoryLotsReady = false,
  today,
  freezingHours = 10,
} = {}) {
  if (!isKitchenFigureName(figure?.nombre) || figure?.activo === false) return null;
  const canonicalProductId = expectedFigureProductId(figure.nombre);
  if (!canonicalProductId || figureProductId(figure) !== canonicalProductId) return null;
  const commercialFamily = products.find((product) => String(product?.id || "").trim() === canonicalProductId) || null;
  if (!commercialFamily || commercialFamily.activo === false || !isCommercialFamilyProduct(commercialFamily)) return null;
  const canonicalFigures = figures.filter((candidate) => {
    const expectedProductId = expectedFigureProductId(candidate?.nombre);
    return candidate?.activo !== false
      && Boolean(expectedProductId)
      && figureProductId(candidate) === expectedProductId;
  });

  const preview = calculateProductionInputPreview({
    flavor,
    quantities: { [figure.nombre]: 1 },
    figures: canonicalFigures,
    subrecipes,
    subrecipeIngredients,
    fillingRules,
    inventory,
    inventoryLots,
    inventoryLotsReady,
    today,
  });
  const guide = buildFigureBatchPreparationGuide({
    batch: {
      figuras: [{ figura: figure.nombre, cant: 1 }],
      horasCongelacion: freezingHours,
    },
    preview,
    figures: canonicalFigures,
    subrecipes,
    fillingRules,
  });
  return {
    identity: figure.nombre,
    flavor,
    displayName: flavor ? `${figure.nombre} de ${flavor}` : figure.nombre,
    species: figure.especie || "",
    grams: Number(figure.gramajeG || 0),
    commercialFamily,
    preview,
    guide,
  };
}
