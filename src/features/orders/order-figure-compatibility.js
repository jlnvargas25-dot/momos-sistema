import {
  COMMERCIAL_FAMILY_NAMES_BY_ID,
  expectedFigureProductId,
  isCommercialFamilyProduct,
  isKitchenFigureName,
} from "../../lib/momos-domain-language.js";

const text = (value) => String(value ?? "").trim();
const productIdOf = (product, fallback = "") => text(
  product?.id ?? product?.productId ?? product?.product_id ?? fallback,
);
const productNameOf = (product, fallback = "Producto sin identificar") => text(
  product?.nombre ?? product?.name ?? fallback,
);
const productTypeOf = (product) => text(product?.tipo ?? product?.type).toLowerCase();
const comboComponentIds = (product) => {
  const raw = product?.componentProductIds ?? product?.component_product_ids ?? [];
  return Array.isArray(raw) ? raw.map(text).filter(Boolean) : [];
};
const familyLabel = (productId) => {
  const id = text(productId);
  return `${COMMERCIAL_FAMILY_NAMES_BY_ID[id] || "Familia desconocida"} (${id || "sin ID"})`;
};
const ok = (extra = {}) => ({ valid: true, code: "ok", message: "", ...extra });
const fail = (code, message, extra = {}) => ({ valid: false, code, message, ...extra });

export function validateOrderFigureCatalogLink(figure = {}) {
  const figureName = text(figure?.nombre ?? figure?.name);
  const declaredProductId = text(figure?.productId ?? figure?.product_id);
  const expectedProductId = expectedFigureProductId(figureName);
  if (!isKitchenFigureName(figureName) || !expectedProductId) {
    return fail(
      "unknown-figure",
      `${figureName || "La figura"} no es una figura física canónica de MOMOS.`,
      { figure: figureName, declaredProductId, expectedProductId: "" },
    );
  }
  if (declaredProductId !== expectedProductId) {
    return fail(
      "catalog-family-mismatch",
      `${figureName} debe estar vinculada a ${familyLabel(expectedProductId)}, no a ${declaredProductId ? familyLabel(declaredProductId) : "una familia vacía"}.`,
      { figure: figureName, declaredProductId, expectedProductId },
    );
  }
  return ok({ figure: figureName, declaredProductId, expectedProductId });
}

export function orderFiguresForFamily(figures = [], productId = "") {
  const expectedProductId = text(productId);
  return (Array.isArray(figures) ? figures : []).filter((figure) => {
    if (!figure || figure.activo === false) return false;
    const link = validateOrderFigureCatalogLink(figure);
    return link.valid && link.expectedProductId === expectedProductId;
  });
}

export function validateOrderFigureForProduct(line = {}, product = null) {
  const figure = text(line?.figura ?? line?.figure);
  const productId = productIdOf(product, line?.productId ?? line?.product_id);
  const productName = productNameOf(product, line?.nombre);
  const type = productTypeOf(product);

  if (type === "combo") {
    return figure
      ? fail(
        "combo-global-figure",
        `${productName} (${productId}) es una caja: no admite una figura global. Elegí la figura dentro de cada espacio del combo.`,
        { figure, productId },
      )
      : ok({ complete: true, figure: "", productId });
  }

  if (!isCommercialFamilyProduct(product)) {
    return figure
      ? fail(
        "figure-not-allowed",
        `${productName} (${productId}) es una elaboración al momento y no admite figura. Quitá ${figure} antes de guardar.`,
        { figure, productId },
      )
      : ok({ complete: true, figure: "", productId });
  }

  if (!figure) return ok({ complete: false, figure: "", productId });
  if (!isKitchenFigureName(figure)) {
    return fail(
      "unknown-figure",
      `${figure} no es una figura física válida. Elegí Lizi, Momo, Toby, Max, Rocco, Danna o Teo.`,
      { figure, productId },
    );
  }

  const expectedProductId = expectedFigureProductId(figure);
  if (productId !== expectedProductId) {
    return fail(
      "family-figure-mismatch",
      `${figure} pertenece a ${familyLabel(expectedProductId)}, no a ${productName} (${productId || "sin ID"}). Elegí la familia correcta.`,
      { figure, productId, expectedProductId },
    );
  }
  return ok({ complete: true, figure, productId, expectedProductId });
}

export function validateOrderComboSlotFigure(combo = null, figureValue = "") {
  const figure = text(figureValue);
  const comboId = productIdOf(combo);
  const comboName = productNameOf(combo, "El combo");
  if (!figure) return ok({ complete: false, figure: "", comboId });
  if (!isKitchenFigureName(figure)) {
    return fail(
      "unknown-combo-figure",
      `${figure} no es una figura física válida para ${comboName} (${comboId}).`,
      { figure, comboId },
    );
  }
  const expectedProductId = expectedFigureProductId(figure);
  const allowedProductIds = comboComponentIds(combo);
  if (!allowedProductIds.includes(expectedProductId)) {
    return fail(
      "combo-family-mismatch",
      `${figure} pertenece a ${familyLabel(expectedProductId)}, pero ${comboName} (${comboId}) solo admite ${allowedProductIds.map(familyLabel).join(", ") || "familias configuradas"}. Elegí una figura compatible con la caja.`,
      { figure, comboId, expectedProductId, allowedProductIds },
    );
  }
  return ok({ complete: true, figure, comboId, expectedProductId, allowedProductIds });
}

export function orderLineFigureCompatibilityErrors(line = {}, product = null) {
  const errors = [];
  const parent = validateOrderFigureForProduct(line, product);
  if (!parent.valid) errors.push(parent);
  if (productTypeOf(product) !== "combo") return errors;

  (Array.isArray(line?.boxes) ? line.boxes : []).forEach((box, boxIndex) => {
    (Array.isArray(box) ? box : []).forEach((slot, slotIndex) => {
      const result = validateOrderComboSlotFigure(product, slot?.figura ?? slot?.figure);
      if (!result.valid) {
        errors.push({
          ...result,
          boxIndex,
          slotIndex,
          message: `Caja ${boxIndex + 1}, espacio ${slotIndex + 1}: ${result.message}`,
        });
      }
    });
  });
  return errors;
}

export function applyOrderFigureEdit(item = {}, product = null, figureValue = "") {
  const candidate = { ...item, figura: text(figureValue) };
  const error = orderLineFigureCompatibilityErrors(candidate, product)[0] || null;
  return error ? { ok: false, item, error } : { ok: true, item: candidate, error: null };
}

export function applyOrderComboFigureEdit(slot = {}, combo = null, figureValue = "") {
  const candidate = { ...slot, figura: text(figureValue) };
  const error = validateOrderComboSlotFigure(combo, candidate.figura);
  return error.valid
    ? { ok: true, slot: candidate, error: null }
    : { ok: false, slot, error };
}

export function sanitizeOrderLineFigureFields(line = {}, product = null) {
  const commercialFamily = isCommercialFamilyProduct(product);
  const combo = productTypeOf(product) === "combo";
  return {
    ...line,
    figura: commercialFamily ? text(line?.figura ?? line?.figure) : "",
    boxes: combo
      ? (Array.isArray(line?.boxes) ? line.boxes : []).map((box) => (
        (Array.isArray(box) ? box : []).map((slot) => ({
          ...slot,
          figura: text(slot?.figura ?? slot?.figure),
        }))
      ))
      : [],
  };
}

export function decorateOrderLineCompatibility(presentation = {}, line = {}, product = null) {
  const error = orderLineFigureCompatibilityErrors(line, product)[0] || null;
  if (!error) return presentation;
  return {
    ...presentation,
    secondary: [presentation.secondary, `⚠ ${error.message}`].filter(Boolean).join(" · "),
    figureCompatibilityError: error.message,
  };
}
