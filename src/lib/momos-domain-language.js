export const KITCHEN_FIGURE_NAMES = Object.freeze(["Lizi", "Momo", "Rocco", "Teo", "Toby", "Danna", "Max"]);
export const AUXILIARY_FIGURE_NAMES = Object.freeze(["Horizontal"]);

export const KITCHEN_FIGURE_DEFAULTS = Object.freeze({
  Lizi: Object.freeze({ species: "gato", grams: 150 }),
  Momo: Object.freeze({ species: "gato", grams: 180 }),
  Rocco: Object.freeze({ species: "perro", grams: 180 }),
  Teo: Object.freeze({ species: "gato", grams: 250 }),
  Toby: Object.freeze({ species: "gato", grams: 280 }),
  Danna: Object.freeze({ species: "perro", grams: 180 }),
  Max: Object.freeze({ species: "perro", grams: 180 }),
});

export const KITCHEN_FIGURE_PRODUCT_IDS = Object.freeze({
  Lizi: "PR01",
  Momo: "PR01",
  Toby: "PR01",
  Max: "PR02",
  Rocco: "PR02",
  Danna: "PR02",
  Teo: "PR04",
});

export const COMMERCIAL_FAMILY_NAMES_BY_ID = Object.freeze({
  PR01: "Momo Gatito",
  PR02: "Momo Perrito",
  PR04: "Momo premium",
});

const COMMERCIAL_FAMILY_IDS_BY_NAME = Object.freeze(Object.fromEntries(
  Object.entries(COMMERCIAL_FAMILY_NAMES_BY_ID)
    .map(([id, name]) => [normalizeDomainText(name), id]),
));

const KITCHEN_FIGURE_SET = new Set(KITCHEN_FIGURE_NAMES.map((name) => normalizeDomainText(name)));
const AUXILIARY_FIGURE_SET = new Set(AUXILIARY_FIGURE_NAMES.map((name) => normalizeDomainText(name)));
const HORIZONTAL_ROUTE_IDS = new Set(["R-MCK-CONG", "R-CHK-REF", "R-CUC-REF"]);
const COMMERCIAL_FAMILY_PATTERN = /^momo\s+(?:gatito|perrito|grande|premium)\b/i;

export function normalizeDomainText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isKitchenFigureName(value) {
  return KITCHEN_FIGURE_SET.has(normalizeDomainText(value));
}

export function isAuxiliaryFigureName(value) {
  return AUXILIARY_FIGURE_SET.has(normalizeDomainText(value));
}

export function productUsesHorizontalFigure(product) {
  if (!product) return false;
  const name = normalizeDomainText(product.nombre ?? product.name);
  const family = normalizeDomainText(product.familia ?? product.family);
  const routeId = String(product.rutaId ?? product.ruta_id ?? product.routeId ?? product.route_id ?? "").trim().toUpperCase();
  return HORIZONTAL_ROUTE_IDS.has(routeId)
    || /\bcuchar(?:eable|iable)\b/.test(name)
    || /\b(?:cake momo|momo cake)\b/.test(name)
    || /^cheesecake momo\b/.test(name)
    || ["momo cake", "cheesecake momo", "cuchareable momos"].includes(family);
}

export function hasActiveHorizontalFigureProduct(products = []) {
  return products.some((product) => product?.activo !== false && productUsesHorizontalFigure(product));
}

export function activeAuxiliaryFigureCatalog(db = {}) {
  if (!hasActiveHorizontalFigureProduct(db.products || [])) return [];
  const source = [...(Array.isArray(db.figuras) ? db.figuras : []), ...(Array.isArray(db.settings?.figuras) ? db.settings.figuras : [])];
  const seen = new Set();
  return source.filter((figure) => {
    const name = normalizeDomainText(figure?.nombre);
    if (figure?.activo === false || !AUXILIARY_FIGURE_SET.has(name) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

export function activeConfigurationFigureCatalog(db = {}) {
  return [...activeFigureCatalog(db), ...activeAuxiliaryFigureCatalog(db)];
}

export function expectedFigureProductId(value) {
  const normalized = normalizeDomainText(value);
  const name = KITCHEN_FIGURE_NAMES.find((candidate) => normalizeDomainText(candidate) === normalized);
  return name ? KITCHEN_FIGURE_PRODUCT_IDS[name] : "";
}

export function figureProductId(figure) {
  return String(figure?.productId ?? figure?.product_id ?? "").trim();
}

export function canonicalCommercialFamilyId(product) {
  const directId = String(product?.id ?? product?.productId ?? product?.product_id ?? "").trim();
  if (COMMERCIAL_FAMILY_NAMES_BY_ID[directId]) return directId;
  const name = normalizeDomainText(product?.nombre ?? product?.name);
  return COMMERCIAL_FAMILY_IDS_BY_NAME[name] || "";
}

export function isCanonicalFigureRecord(figure, db = {}) {
  if (!figure || figure.activo === false || !isKitchenFigureName(figure.nombre)) return false;
  const linkedProductId = figureProductId(figure);
  const expectedProductId = expectedFigureProductId(figure.nombre);
  if (!linkedProductId || !expectedProductId) return false;
  if (linkedProductId === expectedProductId) return true;
  const linkedProduct = (db.products || []).find((product) => String(product?.id || "") === linkedProductId);
  return canonicalCommercialFamilyId(linkedProduct) === expectedProductId;
}

export function activeFigureCatalog(db = {}) {
  const complete = Array.isArray(db.figuras) ? db.figuras : [];
  const legacy = Array.isArray(db.settings?.figuras) ? db.settings.figuras : [];
  const source = complete.length ? complete : legacy;
  return source.filter((figure) => isCanonicalFigureRecord(figure, db));
}

export function isCommercialFamilyProduct(product) {
  if (!product) return false;
  const category = normalizeDomainText(product.cat ?? product.categoria);
  const name = String(product.nombre ?? product.name ?? "").trim();
  return category === "momos signature"
    || (String(product.tipo ?? product.type ?? "") === "momo" && COMMERCIAL_FAMILY_PATTERN.test(name));
}

export function commercialFamilyLabel(productOrName) {
  const product = typeof productOrName === "string" ? { nombre: productOrName } : (productOrName || {});
  const name = String(product.nombre ?? product.name ?? "").trim();
  return isCommercialFamilyProduct(product) || COMMERCIAL_FAMILY_PATTERN.test(name)
    ? name.replace(/\s+\d+(?:[.,]\d+)?\s*(?:g|gr|gramos?)\s*$/i, "").trim()
    : name;
}

export function productDomainKind(product) {
  if (!product) return "unknown";
  if (isCommercialFamilyProduct(product)) return "commercial-family";
  if (product.tipo === "combo" || product.type === "combo" || product.esCaja || product.es_caja) return "combo";
  if (product.tipo === "pedido" || product.type === "pedido") return "made-to-order";
  if (product.tipo === "momo" || product.type === "momo") return "standalone-finished";
  return "other";
}

export function productTypeForCategory(category) {
  const normalized = normalizeDomainText(category);
  if (normalized === "momos signature") return "momo";
  if (normalized === "cajas y combos") return "combo";
  return "pedido";
}

export function orderAttributesForProduct(product) {
  const kind = productDomainKind(product);
  if (kind === "commercial-family") return ["sabor", "salsa", "figura"];
  if (kind === "combo") return ["sabor", "salsa"];
  const category = normalizeDomainText(product?.cat ?? product?.categoria);
  const name = normalizeDomainText(product?.nombre ?? product?.name);
  if (category === "momos cuchara" || name.includes("cuchareable")) return ["sabor", "salsa"];
  return [];
}

function itemProduct(item, product) {
  if (product) return product;
  return {
    id: item?.productId ?? item?.product_id,
    nombre: item?.nombre,
    cat: item?.cat ?? item?.categoria,
    tipo: item?.tipo,
    esCaja: item?.esCaja ?? item?.es_caja,
  };
}

function additionLabel(addition) {
  const quantity = Number(addition?.cant || 1);
  return `${addition?.nombre || "Adición"}${quantity > 1 ? ` ×${quantity}` : ""}`;
}

export function orderLinePresentation(item = {}, product = null) {
  const resolvedProduct = itemProduct(item, product);
  const rawName = String(item.nombre || resolvedProduct.nombre || resolvedProduct.name || "Producto sin identificar").trim();
  const kind = productDomainKind(resolvedProduct);
  const commercialFamily = kind === "commercial-family" || COMMERCIAL_FAMILY_PATTERN.test(rawName);
  const familyName = commercialFamily
    ? commercialFamilyLabel(rawName)
    : rawName;
  const productId = String(resolvedProduct.id ?? resolvedProduct.productId ?? resolvedProduct.product_id ?? "").trim();
  const exactFigure = isKitchenFigureName(item.figura) ? String(item.figura).trim() : "";
  const physicalSubject = Boolean(exactFigure && kind !== "made-to-order" && (commercialFamily || item.esSubMomo || item.es_sub_momo || item.parentItemId || item.parent_item_id));
  const expectedProductId = physicalSubject ? expectedFigureProductId(exactFigure) : "";
  const expectedFamilyName = expectedProductId ? (COMMERCIAL_FAMILY_NAMES_BY_ID[expectedProductId] || expectedProductId) : "";
  const knownProductId = Boolean(COMMERCIAL_FAMILY_NAMES_BY_ID[productId]);
  const familyMismatch = Boolean(commercialFamily && expectedFamilyName && (
    (knownProductId && productId !== expectedProductId)
    || normalizeDomainText(familyName) !== normalizeDomainText(expectedFamilyName)
  ));
  const flavor = String(item.sabor || "").trim();
  const primary = physicalSubject ? `${exactFigure}${flavor ? ` de ${flavor}` : ""}` : familyName;
  const detailParts = [];

  if (physicalSubject && familyMismatch) {
    detailParts.push(`Dato por corregir: ${exactFigure} requiere ${expectedFamilyName}; registro actual ${familyName}`);
  } else if (physicalSubject) detailParts.push(`Presentación comercial: ${familyName}`);
  else {
    if (commercialFamily) detailParts.push("Figura exacta pendiente");
    if (item.figura && kind !== "made-to-order") detailParts.push(`Figura registrada: ${item.figura}`);
    if (flavor && !normalizeDomainText(primary).includes(normalizeDomainText(flavor))) detailParts.push(`Sabor: ${flavor}`);
  }
  if (item.salsa) detailParts.push(`Salsa: ${item.salsa}`);
  if (item.relleno) detailParts.push(`Relleno: ${item.relleno}`);
  const additions = Array.isArray(item.adiciones) ? item.adiciones.filter(Boolean) : [];
  if (additions.length) detailParts.push(`Adiciones: ${additions.map(additionLabel).join(", ")}`);

  const quantity = Math.max(0, Number(item.cant ?? item.cantidad ?? 0));
  return {
    kind,
    primary,
    secondary: detailParts.join(" · "),
    detailParts,
    quantity,
    quantityLabel: `${quantity}× ${primary}`,
    familyName,
    figure: physicalSubject ? exactFigure : "",
    flavor,
    exact: physicalSubject && !familyMismatch,
    requiresExactFigure: commercialFamily && !physicalSubject,
    integrityIssue: familyMismatch ? "FAMILY_FIGURE_MISMATCH" : "",
    expectedFamilyName,
    ignoredLegacyFigure: kind === "made-to-order" && Boolean(item.figura),
  };
}

export function inventoryReservationPresentation(reservation = {}) {
  const rawName = String(reservation.nombre || reservation.name || "").trim();
  const familyName = commercialFamilyLabel(rawName);
  const figure = isKitchenFigureName(reservation.figuraLote ?? reservation.figura)
    ? String(reservation.figuraLote ?? reservation.figura).trim()
    : "";
  const finishedProduct = normalizeDomainText(reservation.tipo ?? reservation.type) === "producto";
  if (!finishedProduct) {
    return {
      primary: rawName || "Ítem sin identificar",
      secondary: "",
      familyName: "",
      figure: "",
      exact: false,
    };
  }
  return {
    primary: figure || "Producto terminado sin figura verificable",
    secondary: familyName ? `Presentación comercial: ${familyName}` : "",
    familyName,
    figure,
    exact: Boolean(figure),
  };
}

function normalizeBatchFigures(batch) {
  const rows = Array.isArray(batch?.figuras) ? batch.figuras : [];
  const normalized = rows
    .map((row) => ({ figure: String(row?.figura || "").trim(), quantity: Math.max(0, Number(row?.cant ?? row?.cantidad ?? 0)) }))
    .filter((row) => isKitchenFigureName(row.figure) && row.quantity > 0);
  if (normalized.length) return normalized;
  const singular = String(batch?.figura || "").trim();
  if (!isKitchenFigureName(singular)) return [];
  return [{ figure: singular, quantity: Math.max(0, Number(batch?.prod || 0)) }];
}

export function batchPresentation(batch = {}) {
  const familyName = commercialFamilyLabel(String(batch.producto || batch.productName || "Familia comercial sin identificar").trim());
  const flavor = String(batch.sabor || "").trim();
  const figures = normalizeBatchFigures(batch);
  const composition = figures.map((row) => `${row.quantity}× ${row.figure}`).join(" · ");
  const primary = figures.length === 1
    ? `${figures[0].figure}${flavor ? ` de ${flavor}` : ""}`
    : figures.length > 1
      ? `${flavor ? `Corrida de ${flavor}` : "Corrida mixta"}: ${composition}`
      : `Lote sin figura exacta${flavor ? ` · ${flavor}` : ""}`;
  return {
    primary,
    secondary: `Presentación comercial: ${familyName}`,
    familyName,
    flavor,
    figures,
    composition,
    exact: figures.length > 0,
  };
}

export function figuresForCommercialProducts(db = {}, productIds = []) {
  const allowed = new Set((productIds || []).filter(Boolean));
  const figures = activeFigureCatalog(db);
  return figures.filter((figure) => {
    const productId = figureProductId(figure);
    return productId && allowed.has(productId);
  });
}
