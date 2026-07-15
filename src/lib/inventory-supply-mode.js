function text(value) {
  return String(value || "").trim();
}

export function subrecipeForInventoryItem(item, subrecipes = []) {
  if (!item?.id) return null;
  return subrecipes.find((subrecipe) => subrecipe?.itemId === item.id) || null;
}

export function inventorySupplyMode(item, subrecipes = []) {
  const subrecipe = subrecipeForInventoryItem(item, subrecipes);
  if (!subrecipe) {
    return {
      kind: "purchase",
      label: "Compra externa",
      subrecipe: null,
      canPrepare: false,
    };
  }
  return {
    kind: "prepared",
    label: "Elaboración interna",
    subrecipe,
    canPrepare: subrecipe.activo !== false,
    preparationName: text(subrecipe.nombre) || text(item.nombre),
  };
}

export function isInternallyPreparedItem(item, subrecipes = []) {
  return inventorySupplyMode(item, subrecipes).kind === "prepared";
}
