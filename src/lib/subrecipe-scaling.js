function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

export function calculateSubrecipeBatch({ subrecipe, ingredients = [], inventory = [], desiredOutputGrams = 0 } = {}) {
  const desired = Math.max(0, number(desiredOutputGrams));
  const wastePct = Math.min(95, Math.max(0, number(subrecipe?.mermaPct)));
  const yieldFactor = 1 - wastePct / 100;
  const nominalInputGrams = desired > 0 ? rounded(desired / yieldFactor, 1) : 0;
  const scale = nominalInputGrams / 1000;
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const recipeRows = ingredients.filter((row) => row.subrecetaId === subrecipe?.id);
  const components = recipeRows.map((row) => {
    const item = inventoryById.get(row.itemId) || null;
    const requiredQuantity = rounded(number(row.cantidad) * scale);
    const stock = Math.max(0, number(item?.stock));
    return {
      itemId: row.itemId,
      name: item?.nombre || row.itemId,
      unit: item?.unidad || "",
      baseQuantity: number(row.cantidad),
      requiredQuantity,
      stock,
      enough: Boolean(item) && stock + 1e-9 >= requiredQuantity,
      cost: rounded(requiredQuantity * number(item?.costo), 2),
      item,
    };
  });

  return {
    desiredOutputGrams: rounded(desired, 1),
    nominalInputGrams,
    expectedOutputGrams: rounded(nominalInputGrams * yieldFactor, 1),
    wastePct,
    components,
    totalCost: rounded(components.reduce((sum, component) => sum + component.cost, 0), 2),
    hasFormula: recipeRows.length > 0,
    completeFormula: recipeRows.length > 0 && components.every((component) => component.item),
    canPrepare: desired > 0 && recipeRows.length > 0 && components.every((component) => component.enough),
  };
}
