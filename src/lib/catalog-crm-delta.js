const BIGINT_TOKEN = /^\d+$/;

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} no es un objeto.`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`${label} contiene campos no permitidos: ${extra.join(", ")}.`);
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} es obligatorio.`);
  return text;
}

export function normalizeCatalogCrmVersion(value) {
  const token = String(value ?? "").trim();
  if (!BIGINT_TOKEN.test(token)) throw new Error("La versión incremental no es válida.");
  return token.replace(/^0+(?=\d)/, "");
}

export function compareCatalogCrmVersions(left, right) {
  const a = normalizeCatalogCrmVersion(left);
  const b = normalizeCatalogCrmVersion(right);
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a === b ? 0 : a > b ? 1 : -1;
}

function normalizeProduct(raw) {
  const product = asObject(raw, "El producto");
  exactKeys(product, [
    "id", "nombre", "cat", "tipo", "especie", "precio", "precioRappi", "costo", "stock",
    "prep", "frio", "lejano", "activo", "desc", "comboSize", "componentProductIds",
    "empaqueItem", "colchonProduccion",
  ], "El producto");
  return {
    id: requiredText(product.id, "product.id"),
    nombre: requiredText(product.nombre, "product.nombre"),
    cat: requiredText(product.cat, "product.cat"),
    tipo: requiredText(product.tipo, "product.tipo"),
    especie: product.especie || undefined,
    precio: Number(product.precio || 0),
    precioRappi: Number(product.precioRappi || 0),
    costo: Number(product.costo || 0),
    stock: product.stock == null ? undefined : Number(product.stock),
    prep: Number(product.prep || 0),
    frio: product.frio === true,
    lejano: product.lejano === true,
    activo: product.activo === true,
    desc: String(product.desc || ""),
    colchonProduccion: Number(product.colchonProduccion || 0),
    ...(product.tipo === "combo" ? {
      comboSize: Number(product.comboSize || 0),
      componentProductIds: Array.isArray(product.componentProductIds)
        ? product.componentProductIds.map((id) => requiredText(id, "componentProductId")) : [],
      empaqueItem: String(product.empaqueItem || ""),
    } : {}),
  };
}

function normalizeRecipe(raw, productId) {
  const recipe = asObject(raw, "La receta");
  exactKeys(recipe, ["id", "productId", "itemId", "cantidad"], "La receta");
  if (requiredText(recipe.productId, "recipe.productId") !== productId) {
    throw new Error("La receta no corresponde al producto solicitado.");
  }
  const quantity = Number(recipe.cantidad);
  if (!(quantity > 0)) throw new Error("La cantidad de receta debe ser positiva.");
  return {
    id: requiredText(recipe.id, "recipe.id"), productId,
    itemId: requiredText(recipe.itemId, "recipe.itemId"), cantidad: quantity,
  };
}

export function normalizeProductCatalogDeltaBatch(envelope) {
  const root = asObject(envelope, "El lote de catálogo");
  exactKeys(root, ["contract", "deltas", "containsCustomerPii", "containsSecrets", "externalExecution"], "El lote de catálogo");
  if (root.contract !== "momos.product-catalog-delta-batch.v1"
      || root.containsCustomerPii !== false || root.containsSecrets !== false
      || root.externalExecution !== false || !Array.isArray(root.deltas)
      || root.deltas.length < 1 || root.deltas.length > 20) {
    throw new Error("El lote de catálogo perdió su contrato de seguridad.");
  }
  const seen = new Set();
  const deltas = root.deltas.map((raw) => {
    const delta = asObject(raw, "El delta de producto");
    exactKeys(delta, ["contract", "productId", "version", "serverTime", "product", "recipes"], "El delta de producto");
    const productId = requiredText(delta.productId, "productId");
    if (seen.has(productId)) throw new Error("El lote repite un producto.");
    seen.add(productId);
    const product = normalizeProduct(delta.product);
    if (product.id !== productId) throw new Error("El producto no coincide con el delta.");
    if (!Array.isArray(delta.recipes) || delta.recipes.length > 100) throw new Error("La receta excede el contrato compacto.");
    return {
      productId,
      version: normalizeCatalogCrmVersion(delta.version),
      serverTime: requiredText(delta.serverTime, "serverTime"),
      product,
      recipes: delta.recipes.map((row) => normalizeRecipe(row, productId)),
    };
  });
  return {
    contract: root.contract, deltas,
    containsCustomerPii: false, containsSecrets: false, externalExecution: false,
  };
}

function replaceScopedRows(rows, field, id, replacements) {
  return [...(rows || []).filter((row) => String(row?.[field] || "") !== id), ...replacements];
}

export function applyProductCatalogDeltaBatchToDb(db, envelope) {
  const batch = normalizeProductCatalogDeltaBatch(envelope);
  const next = { ...db };
  let products = [...(db.products || [])];
  let recipes = [...(db.recipes || [])];
  const versions = { ...(db.productCatalogDeltaVersions || {}) };
  const applied = [];
  const stale = [];
  batch.deltas.forEach((delta) => {
    const current = versions[delta.productId];
    if (current && compareCatalogCrmVersions(delta.version, current) < 0) {
      stale.push(delta.productId); return;
    }
    products = [...products.filter((product) => product.id !== delta.productId), delta.product];
    recipes = replaceScopedRows(recipes, "productId", delta.productId, delta.recipes);
    versions[delta.productId] = delta.version;
    applied.push(delta.productId);
  });
  if (applied.length) {
    products.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    recipes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    next.products = products;
    next.recipes = recipes;
    next.productCatalogDeltaVersions = versions;
  }
  return { db: next, status: applied.length ? "applied" : "stale", applied, stale };
}

function normalizeCustomer(raw) {
  const customer = asObject(raw, "El cliente");
  exactKeys(customer, ["id", "nombre", "telefono", "instagram", "barrio", "direccion", "canal", "primera", "ultima", "total", "pedidos", "cumple", "favoritos", "estado", "notas"], "El cliente");
  return {
    id: requiredText(customer.id, "customer.id"), nombre: requiredText(customer.nombre, "customer.nombre"),
    telefono: String(customer.telefono || ""), instagram: String(customer.instagram || ""),
    barrio: String(customer.barrio || ""), direccion: String(customer.direccion || ""), canal: String(customer.canal || ""),
    primera: String(customer.primera || ""), ultima: String(customer.ultima || ""), total: Number(customer.total || 0),
    pedidos: Number(customer.pedidos || 0), cumple: String(customer.cumple || ""), favoritos: String(customer.favoritos || ""),
    estado: requiredText(customer.estado, "customer.estado"), notas: String(customer.notas || ""),
  };
}

function normalizeProfile(raw, customerId) {
  if (raw == null) return null;
  const profile = asObject(raw, "El perfil CRM");
  exactKeys(profile, ["customerId", "contactAllowed", "contactReason", "preferredChannel", "acquisitionSource", "referredByCustomerId", "updatedBy", "updatedAt"], "El perfil CRM");
  if (requiredText(profile.customerId, "profile.customerId") !== customerId) throw new Error("El perfil CRM no corresponde al cliente.");
  return { ...profile, customerId, contactAllowed: profile.contactAllowed !== false };
}

function normalizeContact(raw, customerId) {
  const row = asObject(raw, "El contacto CRM");
  exactKeys(row, ["id", "customerId", "channel", "reason", "outcome", "notes", "followUpOn", "activationId", "orderId", "createdBy", "createdByName", "createdAt"], "El contacto CRM");
  if (requiredText(row.customerId, "contact.customerId") !== customerId) throw new Error("El contacto no corresponde al cliente.");
  return { ...row, id: requiredText(row.id, "contact.id"), customerId };
}

function normalizeActivation(raw, customerId) {
  const row = asObject(raw, "La activación CRM");
  exactKeys(row, ["id", "customerId", "type", "title", "message", "status", "benefitId", "expiresOn", "convertedOrderId", "createdBy", "createdByName", "createdAt", "updatedAt"], "La activación CRM");
  if (requiredText(row.customerId, "activation.customerId") !== customerId) throw new Error("La activación no corresponde al cliente.");
  return { ...row, id: requiredText(row.id, "activation.id"), customerId };
}

function normalizeBenefit(raw, customerId) {
  const row = asObject(raw, "El beneficio");
  exactKeys(row, ["id", "customerId", "beneficio", "tipoBeneficio", "valor", "productoGratisId", "condicion", "minimo", "activacion", "vence", "estado", "pedidoUso", "obs"], "El beneficio");
  if (requiredText(row.customerId, "benefit.customerId") !== customerId) throw new Error("El beneficio no corresponde al cliente.");
  return { ...row, id: requiredText(row.id, "benefit.id"), customerId, valor: Number(row.valor || 0), minimo: Number(row.minimo || 0) };
}

export function normalizeCustomerCrmDeltaBatch(envelope) {
  const root = asObject(envelope, "El lote CRM");
  exactKeys(root, ["contract", "deltas", "containsCustomerPii", "containsSecrets", "externalExecution", "scope"], "El lote CRM");
  if (root.contract !== "momos.customer-crm-delta-batch.v1" || root.scope !== "staff-private"
      || root.containsCustomerPii !== true || root.containsSecrets !== false || root.externalExecution !== false
      || !Array.isArray(root.deltas) || root.deltas.length < 1 || root.deltas.length > 20) {
    throw new Error("El lote CRM perdió su contrato privado.");
  }
  const seen = new Set();
  const deltas = root.deltas.map((raw) => {
    const delta = asObject(raw, "El delta CRM");
    exactKeys(delta, ["contract", "customerId", "version", "serverTime", "customer", "profile", "contacts", "activations", "benefits"], "El delta CRM");
    const customerId = requiredText(delta.customerId, "customerId");
    if (seen.has(customerId)) throw new Error("El lote CRM repite un cliente.");
    seen.add(customerId);
    const customer = normalizeCustomer(delta.customer);
    if (customer.id !== customerId) throw new Error("El cliente no coincide con el delta.");
    if (!Array.isArray(delta.contacts) || delta.contacts.length > 100
        || !Array.isArray(delta.activations) || delta.activations.length > 100
        || !Array.isArray(delta.benefits) || delta.benefits.length > 100) {
      throw new Error("El historial CRM excede el contrato compacto.");
    }
    return {
      customerId, version: normalizeCatalogCrmVersion(delta.version), serverTime: requiredText(delta.serverTime, "serverTime"), customer,
      profile: normalizeProfile(delta.profile, customerId),
      contacts: delta.contacts.map((row) => normalizeContact(row, customerId)),
      activations: delta.activations.map((row) => normalizeActivation(row, customerId)),
      benefits: delta.benefits.map((row) => normalizeBenefit(row, customerId)),
    };
  });
  return {
    contract: root.contract, scope: "staff-private", deltas,
    containsCustomerPii: true, containsSecrets: false, externalExecution: false,
  };
}

export function applyCustomerCrmDeltaBatchToDb(db, envelope) {
  const batch = normalizeCustomerCrmDeltaBatch(envelope);
  const next = { ...db };
  let customers = [...(db.customers || [])];
  let profiles = [...(db.customer_crm_profiles || [])];
  let contacts = [...(db.customer_contacts || [])];
  let activations = [...(db.customer_activations || [])];
  let benefits = [...(db.benefits || [])];
  const versions = { ...(db.customerCrmDeltaVersions || {}) };
  const applied = [];
  const stale = [];
  batch.deltas.forEach((delta) => {
    const current = versions[delta.customerId];
    if (current && compareCatalogCrmVersions(delta.version, current) < 0) {
      stale.push(delta.customerId); return;
    }
    customers = [...customers.filter((row) => row.id !== delta.customerId), delta.customer];
    profiles = replaceScopedRows(profiles, "customerId", delta.customerId, delta.profile ? [delta.profile] : []);
    contacts = replaceScopedRows(contacts, "customerId", delta.customerId, delta.contacts);
    activations = replaceScopedRows(activations, "customerId", delta.customerId, delta.activations);
    benefits = replaceScopedRows(benefits, "customerId", delta.customerId, delta.benefits);
    versions[delta.customerId] = delta.version;
    applied.push(delta.customerId);
  });
  if (applied.length) {
    next.customers = customers;
    next.customer_crm_profiles = profiles;
    next.customer_contacts = contacts;
    next.customer_activations = activations;
    next.benefits = benefits;
    next.customerCrmDeltaVersions = versions;
  }
  return { db: next, status: applied.length ? "applied" : "stale", applied, stale };
}

export function normalizeCatalogCrmMutationEnvelope(envelope, expectedOperation) {
  const root = asObject(envelope, "La mutación incremental");
  exactKeys(root, ["contract", "operation", "idempotencyKey", "duplicate", "result", "catalog", "crm", "containsCustomerPii", "containsSecrets", "externalExecution"], "La mutación incremental");
  if (root.contract !== "momos.catalog-crm-mutation.v1" || root.operation !== expectedOperation
      || typeof root.duplicate !== "boolean" || root.containsSecrets !== false || root.externalExecution !== false) {
    throw new Error("La mutación incremental perdió su contrato.");
  }
  const catalog = root.catalog == null ? null : normalizeProductCatalogDeltaBatch(root.catalog);
  const crm = root.crm == null ? null : normalizeCustomerCrmDeltaBatch(root.crm);
  if ((catalog ? 1 : 0) + (crm ? 1 : 0) !== 1 || root.containsCustomerPii !== Boolean(crm)) {
    throw new Error("La mutación incremental mezcló dominios o privacidad.");
  }
  return { operation: root.operation, idempotencyKey: requiredText(root.idempotencyKey, "idempotencyKey"), duplicate: root.duplicate, result: root.result, catalog, crm };
}
