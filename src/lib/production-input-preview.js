import { calculateSubrecipeBatch } from "./subrecipe-scaling.js";
import { isKitchenFigureName } from "./momos-domain-language.js";
import { canonicalUsableIngredientStock } from "./canonical-stock.js";
import { businessDateISO } from "./business-date.js";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("es");
}

function inventoryQuantityForGrams(grams, unit) {
  return rounded(number(grams) / (unit === "g" ? 1 : 1000));
}

function chosenFigures(quantities = {}) {
  if (Array.isArray(quantities)) {
    return quantities
      .map((row) => ({ figure: String(row.figura || row.figure || "").trim(), quantity: Math.max(0, Math.trunc(number(row.cant ?? row.quantity))) }))
      .filter((row) => row.figure && row.quantity > 0);
  }
  return Object.entries(quantities)
    .map(([figure, quantity]) => ({ figure, quantity: Math.max(0, Math.trunc(number(quantity))) }))
    .filter((row) => row.figure && row.quantity > 0);
}

export function calculateProductionInputPreview({
  flavor = "",
  quantities = {},
  figures = [],
  subrecipes = [],
  subrecipeIngredients = [],
  fillingRules = [],
  inventory = [],
  inventoryLots = [],
  inventoryLotsReady = false,
  today = businessDateISO(),
} = {}) {
  const selected = chosenFigures(quantities);
  const figureByName = new Map(figures
    .filter((figure) => isKitchenFigureName(figure?.nombre))
    .map((figure) => [normalized(figure.nombre), figure]));
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const stockDb = {
    inventory_items: inventory,
    inventory_lots: inventoryLots,
    inventoryLotsReady,
  };
  const subrecipeById = new Map(subrecipes.map((subrecipe) => [subrecipe.id, subrecipe]));
  const errors = [];
  const warnings = [];
  const totalUnits = selected.reduce((sum, row) => sum + row.quantity, 0);
  const activeFillingRules = fillingRules.filter((rule) => rule.activo !== false && number(rule.gramosPorUnidad) > 0);
  const fillingPerUnitGrams = rounded(activeFillingRules.reduce((sum, rule) => sum + number(rule.gramosPorUnidad), 0), 1);

  if (totalUnits === 0) errors.push({ code: "NO_UNITS", message: "Elegí al menos una figura para calcular los insumos." });

  let totalProductGrams = 0;
  let mousseOutputGrams = 0;
  selected.forEach((row) => {
    const figure = figureByName.get(normalized(row.figure));
    if (!figure) {
      errors.push({ code: "MISSING_FIGURE", figure: row.figure, message: `La figura ${row.figure} no existe en el catálogo activo.` });
      return;
    }
    const weight = number(figure.gramajeG);
    if (!(weight > 0)) {
      errors.push({ code: "MISSING_WEIGHT", figure: row.figure, message: `${row.figure} no tiene gramaje oficial configurado.` });
      return;
    }
    if (weight <= fillingPerUnitGrams) {
      errors.push({ code: "INVALID_WEIGHT", figure: row.figure, message: `El gramaje de ${row.figure} no alcanza para el relleno configurado.` });
      return;
    }
    totalProductGrams += weight * row.quantity;
    mousseOutputGrams += (weight - fillingPerUnitGrams) * row.quantity;
  });

  const mousse = subrecipes.find((subrecipe) => subrecipe.activo !== false
    && ["mousse_frutal", "mousse_cremosa"].includes(subrecipe.tipo)
    && normalized(subrecipe.sabor) === normalized(flavor));
  if (totalUnits > 0 && !mousse) {
    errors.push({ code: "MISSING_MOUSSE", message: `No hay una subreceta activa de mousse para ${flavor || "el sabor elegido"}.` });
  }

  const requiredOutputs = new Map();
  if (mousse && mousseOutputGrams > 0) {
    requiredOutputs.set(mousse.id, { subrecipe: mousse, kind: "Mousse", outputGrams: mousseOutputGrams });
  }
  activeFillingRules.forEach((rule) => {
    const subrecipe = subrecipeById.get(rule.subrecetaId);
    if (!subrecipe) {
      errors.push({ code: "MISSING_FILLING", message: `La regla de relleno ${rule.id || rule.subrecetaId} no tiene subreceta activa asociada.` });
      return;
    }
    const current = requiredOutputs.get(subrecipe.id) || { subrecipe, kind: "Relleno", outputGrams: 0 };
    current.outputGrams += number(rule.gramosPorUnidad) * totalUnits;
    requiredOutputs.set(subrecipe.id, current);
  });

  const ingredientsById = new Map();
  const preparations = Array.from(requiredOutputs.values()).map((requirement) => {
    const formula = calculateSubrecipeBatch({
      subrecipe: requirement.subrecipe,
      ingredients: subrecipeIngredients,
      inventory,
      inventoryLots,
      inventoryLotsReady,
      today,
      desiredOutputGrams: requirement.outputGrams,
    });
    const preparedItem = inventoryById.get(requirement.subrecipe.itemId) || null;
    const requiredStock = inventoryQuantityForGrams(requirement.outputGrams, preparedItem?.unidad);
    const preparedStock = canonicalUsableIngredientStock(stockDb, requirement.subrecipe.itemId, { today });
    const currentStock = preparedStock.usable;
    const shortage = rounded(Math.max(0, requiredStock - currentStock));

    formula.components.forEach((component) => {
      const current = ingredientsById.get(component.itemId) || {
        itemId: component.itemId,
        name: component.name,
        unit: component.unit,
        requiredQuantity: 0,
        stock: component.stock,
        cost: 0,
        item: component.item,
      };
      current.requiredQuantity += component.requiredQuantity;
      current.cost += component.cost;
      ingredientsById.set(component.itemId, current);
    });

    if (!formula.hasFormula) {
      warnings.push({ code: "MISSING_FORMULA", message: `${requirement.subrecipe.nombre} no tiene ingredientes configurados.` });
    } else if (!formula.completeFormula) {
      warnings.push({ code: "INCOMPLETE_FORMULA", message: `La fórmula de ${requirement.subrecipe.nombre} referencia insumos que no existen.` });
    }

    return {
      subrecipeId: requirement.subrecipe.id,
      name: requirement.subrecipe.nombre,
      kind: requirement.kind,
      itemId: requirement.subrecipe.itemId,
      unit: preparedItem?.unidad || "kg",
      outputGrams: rounded(requirement.outputGrams, 1),
      nominalInputGrams: formula.nominalInputGrams,
      wastePct: formula.wastePct,
      requiredStock,
      currentStock,
      physicalStock: preparedStock.physical,
      expiredStock: preparedStock.expired,
      stockSource: preparedStock.source,
      shortage,
      enough: Boolean(preparedItem) && shortage === 0,
      formulaReady: formula.completeFormula,
      formulaCost: formula.totalCost,
    };
  });

  const ingredients = Array.from(ingredientsById.values())
    .map((ingredient) => ({
      ...ingredient,
      requiredQuantity: rounded(ingredient.requiredQuantity),
      cost: rounded(ingredient.cost, 2),
      enough: Boolean(ingredient.item) && ingredient.stock + 1e-9 >= ingredient.requiredQuantity,
      shortage: rounded(Math.max(0, ingredient.requiredQuantity - ingredient.stock)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "es"));

  return {
    totalUnits,
    totalProductGrams: rounded(totalProductGrams, 1),
    fillingPerUnitGrams,
    totalFillingGrams: rounded(fillingPerUnitGrams * totalUnits, 1),
    mousseOutputGrams: rounded(mousseOutputGrams, 1),
    preparations,
    ingredients,
    totalFormulaCost: rounded(ingredients.reduce((sum, ingredient) => sum + ingredient.cost, 0), 2),
    preparedStockEnough: preparations.length > 0 && preparations.every((preparation) => preparation.enough),
    rawStockEnough: ingredients.length > 0 && ingredients.every((ingredient) => ingredient.enough),
    canCalculate: totalUnits > 0 && errors.length === 0 && preparations.length > 0,
    errors,
    warnings,
  };
}
