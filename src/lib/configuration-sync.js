import {
  activeConfigurationFigureCatalog, isAuxiliaryFigureName, isKitchenFigureName,
} from "./momos-domain-language.js";

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

function object(value, label) {
  if (!isObject(value)) throw new Error(`Configuración inválida: ${label}.`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`Configuración inválida: ${label}.`);
  return value;
}

function text(value, label, { allowEmpty = false } = {}) {
  const result = String(value ?? "").trim();
  if (!allowEmpty && !result) throw new Error(`Configuración inválida: ${label}.`);
  return result;
}

function number(value, label, { integer = false, min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) {
    throw new Error(`Configuración inválida: ${label}.`);
  }
  return result;
}

function stringArray(value, label, { allowEmpty = false } = {}) {
  const result = array(value, label).map((item, index) => text(item, `${label}[${index}]`));
  if (!allowEmpty && !result.length) throw new Error(`Configuración inválida: ${label}.`);
  if (new Set(result.map((item) => item.toLocaleLowerCase("es"))).size !== result.length) {
    throw new Error(`Configuración inválida: ${label} contiene duplicados.`);
  }
  return result;
}

export function normalizeConfigurationSnapshot(payload) {
  const source = object(payload, "snapshot");
  const v2 = source.contract === "momos.configuration-snapshot.v2" && Number(source.version) === 2;
  const v1 = source.contract === "momos.configuration-snapshot.v1" && Number(source.version) === 1;
  if (!v1 && !v2) {
    throw new Error("Contrato de Configuración no compatible.");
  }
  if (source.containsCustomerPii !== false || source.containsStaffPii !== true
      || source.containsFreeText !== true || source.containsStorageReferences !== false
      || source.containsSecrets !== false || source.externalExecution !== false) {
    throw new Error("El contrato de Configuración no declara correctamente su privacidad.");
  }
  const snapshotVersion = text(source.snapshotVersion, "snapshotVersion");
  if (!/^\d+$/.test(snapshotVersion) || snapshotVersion === "0") throw new Error("Configuración sin versión autoritativa.");

  const settings = object(source.settings, "settings");
  const catalogs = object(settings.catalogs, "settings.catalogs");
  const delays = object(settings.delays, "settings.delays");
  const zones = array(settings.zones, "settings.zones").map((row, index) => {
    const item = object(row, `settings.zones[${index}]`);
    return { nombre: text(item.name, `settings.zones[${index}].name`), tarifa: number(item.fee, `settings.zones[${index}].fee`) };
  });
  const figures = array(settings.figures, "settings.figures").map((row, index) => {
    const item = object(row, `settings.figures[${index}]`);
    const name = text(item.name, `settings.figures[${index}].name`);
    if (!isKitchenFigureName(name) && !isAuxiliaryFigureName(name)) throw new Error(`Configuración contiene una figura física no canónica: ${name}.`);
    const species = text(item.species, `settings.figures[${index}].species`);
    if (!['gato', 'perro'].includes(species)) throw new Error("Configuración contiene una silueta visual inválida.");
    return {
      nombre: name,
      especie: species,
      gramaje: `${number(item.grams, `settings.figures[${index}].grams`, { integer: true, min: 1 })} g`,
      productId: text(item.productId, `settings.figures[${index}].productId`, { allowEmpty: true }),
      activo: item.active === true,
    };
  });
  const toppings = array(settings.toppings, "settings.toppings").map((row, index) => {
    const item = object(row, `settings.toppings[${index}]`);
    return {
      nombre: text(item.name, `settings.toppings[${index}].name`),
      precio: number(item.price, `settings.toppings[${index}].price`),
      insumoId: text(item.inventoryItemId, `settings.toppings[${index}].inventoryItemId`, { allowEmpty: true }),
      insumoCant: number(item.inventoryQuantity, `settings.toppings[${index}].inventoryQuantity`),
      activo: item.active === true,
    };
  });
  const activeFigures = figures.filter((item) => item.activo);
  const activeToppings = toppings.filter((item) => item.activo);
  const fixedFilling = text(settings.fixedFilling, "settings.fixedFilling");
  const settingsCatalogos = {
    zonas: zones,
    saboresFrutales: stringArray(catalogs.fruitFlavors, "catalogs.fruitFlavors"),
    saboresCremosos: stringArray(catalogs.creamyFlavors, "catalogs.creamyFlavors"),
    salsas: stringArray(catalogs.sauces, "catalogs.sauces", { allowEmpty: true }),
    pagos: stringArray(catalogs.payments, "catalogs.payments"),
    proveedores: stringArray(catalogs.deliveryProviders, "catalogs.deliveryProviders"),
    rellenos: [fixedFilling],
    figuras: activeFigures,
    toppings: activeToppings,
    pedidoMinimo: number(settings.orderMinimum, "settings.orderMinimum"),
    horasCongelacion: number(settings.freezingHours, "settings.freezingHours", { integer: true, min: 1 }),
    vidaUtilConfigurable: v2,
    vidaUtilProductoTerminadoDias: v2
      ? number(settings.finishedProductShelfDays, "settings.finishedProductShelfDays", { integer: true, min: 1, max: 30 })
      : 3,
    vidaUtilMezclasDias: v2
      ? number(settings.mixtureShelfDays, "settings.mixtureShelfDays", { integer: true, min: 1, max: 30 })
      : 0,
    demoraCocinaMin: number(delays.kitchenWarning, "settings.delays.kitchenWarning", { integer: true, min: 1 }),
    demoraCocinaUrgenteMin: number(delays.kitchenUrgent, "settings.delays.kitchenUrgent", { integer: true, min: 1 }),
    demoraEmpaqueMin: number(delays.packingWarning, "settings.delays.packingWarning", { integer: true, min: 1 }),
    demoraEmpaqueUrgenteMin: number(delays.packingUrgent, "settings.delays.packingUrgent", { integer: true, min: 1 }),
    demoraRepeticionMin: number(delays.repeatEvery, "settings.delays.repeatEvery", { integer: true, min: 1 }),
    politicas: text(settings.policies, "settings.policies"),
  };
  if (settingsCatalogos.demoraCocinaUrgenteMin < settingsCatalogos.demoraCocinaMin
      || settingsCatalogos.demoraEmpaqueUrgenteMin < settingsCatalogos.demoraEmpaqueMin) {
    throw new Error("Configuración contiene tiempos operativos inconsistentes.");
  }

  const users = array(source.staff, "staff").map((row, index) => {
    const item = object(row, `staff[${index}]`);
    const primaryRole = text(item.primaryRole, `staff[${index}].primaryRole`);
    const roles = stringArray(item.roles, `staff[${index}].roles`);
    if (!roles.includes(primaryRole)) throw new Error("Configuración contiene un rol principal inconsistente.");
    return {
      id: text(item.id, `staff[${index}].id`), nombre: text(item.name, `staff[${index}].name`),
      email: text(item.email, `staff[${index}].email`), rol: primaryRole, roles, activo: item.active === true,
    };
  });
  const inventoryChoices = array(source.inventoryChoices, "inventoryChoices").map((row, index) => {
    const item = object(row, `inventoryChoices[${index}]`);
    return { id: text(item.id, `inventoryChoices[${index}].id`), nombre: text(item.name, `inventoryChoices[${index}].name`), unidad: text(item.unit, `inventoryChoices[${index}].unit`) };
  });
  const figureProductChoices = array(source.figureProductChoices, "figureProductChoices").map((row, index) => {
    const item = object(row, `figureProductChoices[${index}]`);
    return { id: text(item.id, `figureProductChoices[${index}].id`), nombre: text(item.name, `figureProductChoices[${index}].name`), especie: text(item.species, `figureProductChoices[${index}].species`) };
  });
  const auditLogs = array(source.activity, "activity").map((row, index) => {
    const item = object(row, `activity[${index}]`);
    return {
      id: text(item.id, `activity[${index}].id`), fecha: text(item.at, `activity[${index}].at`),
      user: text(item.actor, `activity[${index}].actor`), entidad: text(item.entity, `activity[${index}].entity`),
      entidadId: text(item.entityId, `activity[${index}].entityId`, { allowEmpty: true }),
      accion: text(item.action, `activity[${index}].action`), de: "", a: "",
    };
  });
  return { snapshotVersion, settingsCatalogos, users, inventoryChoices, figureProductChoices, auditLogs, figures };
}

const grams = (value) => {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isInteger(parsed) ? parsed : 0;
};

export function buildConfigurationSavePayload(db, delayOverrides = {}) {
  const settings = object(db?.settings, "db.settings");
  const figures = array(settings.figuras, "db.settings.figuras");
  figures.forEach((figure) => {
    const name = String(figure?.nombre || "").trim();
    if (!isKitchenFigureName(name) && !isAuxiliaryFigureName(name)) {
      throw new Error(`Configuración contiene una figura física no canónica: ${name}.`);
    }
  });
  const visibleFigures = activeConfigurationFigureCatalog({
    figuras: figures,
    products: Array.isArray(db?.products) ? db.products : [],
  }).filter((figure) => isKitchenFigureName(figure?.nombre));
  const toppings = array(settings.toppings, "db.settings.toppings");
  const payload = {
    zones: array(settings.zonas, "db.settings.zonas").map((zone) => ({ name: String(zone.nombre || "").trim(), fee: Number(zone.tarifa) })),
    catalogs: {
      fruit_flavors: [...array(settings.saboresFrutales, "db.settings.saboresFrutales")],
      creamy_flavors: [...array(settings.saboresCremosos, "db.settings.saboresCremosos")],
      sauces: [...array(settings.salsas, "db.settings.salsas")],
      payments: [...array(settings.pagos, "db.settings.pagos")],
      delivery_providers: [...array(settings.proveedores, "db.settings.proveedores")],
    },
    fixed_filling: String(settings.rellenos?.[0] || "").trim(),
    figures: visibleFigures.map((figure) => {
      const name = String(figure.nombre || "").trim();
      return {
        name, species: figure.especie,
        grams: grams(figure.gramaje), product_id: String(figure.productId || "").trim(),
      };
    }),
    toppings: toppings.map((topping) => ({
      name: String(topping.nombre || "").trim(), price: Number(topping.precio || 0),
      inventory_item_id: String(topping.insumoId || "").trim(), inventory_quantity: Number(topping.insumoCant || 0),
    })),
    order_minimum: Number(settings.pedidoMinimo),
    freezing_hours: Number(settings.horasCongelacion),
    delays: {
      kitchen_warning: Number(delayOverrides.demoraCocinaMin ?? settings.demoraCocinaMin),
      kitchen_urgent: Number(delayOverrides.demoraCocinaUrgenteMin ?? settings.demoraCocinaUrgenteMin),
      packing_warning: Number(delayOverrides.demoraEmpaqueMin ?? settings.demoraEmpaqueMin),
      packing_urgent: Number(delayOverrides.demoraEmpaqueUrgenteMin ?? settings.demoraEmpaqueUrgenteMin),
      repeat_every: Number(delayOverrides.demoraRepeticionMin ?? settings.demoraRepeticionMin),
    },
    policies: String(settings.politicas || "").trim(),
  };
  if (settings.vidaUtilConfigurable === true) {
    payload.finished_product_shelf_days = Number(settings.vidaUtilProductoTerminadoDias);
    payload.mixture_shelf_days = Number(settings.vidaUtilMezclasDias);
  }
  return payload;
}
