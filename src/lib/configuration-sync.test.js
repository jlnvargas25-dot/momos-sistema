import test from "node:test";
import assert from "node:assert/strict";
import { buildConfigurationSavePayload, normalizeConfigurationSnapshot } from "./configuration-sync.js";

const snapshot = (overrides = {}) => ({
  contract: "momos.configuration-snapshot.v1", version: 1, snapshotVersion: "9", serverTime: "2026-07-19T20:00:00Z",
  settings: {
    zones: [{ name: "Zona 1", fee: 5000 }],
    catalogs: { fruitFlavors: ["Coco"], creamyFlavors: ["Oreo"], sauces: [], payments: ["Nequi"], deliveryProviders: ["Picap"] },
    fixedFilling: "Cheesecake con ganache",
    figures: [{ name: "Lizi", species: "gato", grams: 150, productId: "PR01", active: true }],
    toppings: [{ name: "Oreo", price: 0, inventoryItemId: "", inventoryQuantity: 1, active: true }],
    orderMinimum: 25000, freezingHours: 10,
    delays: { kitchenWarning: 15, kitchenUrgent: 30, packingWarning: 10, packingUrgent: 20, repeatEvery: 5 },
    policies: "Pago anticipado.",
  },
  staff: [{ id: "U01", name: "Admin", email: "admin@example.test", primaryRole: "Administrador", roles: ["Administrador"], active: true }],
  activity: [{ id: "A01", at: "2026-07-19T19:00:00Z", actor: "Admin", entity: "Configuración", entityId: "general", action: "Guardada" }],
  inventoryChoices: [{ id: "I01", name: "Crema", unit: "L" }],
  figureProductChoices: [{ id: "PR01", name: "Momo Gatito", species: "gato" }],
  containsCustomerPii: false, containsStaffPii: true, containsFreeText: true,
  containsStorageReferences: false, containsSecrets: false, externalExecution: false,
  ...overrides,
});

test("H76 adapta Configuración compacta con versión y catálogos exactos", () => {
  const result = normalizeConfigurationSnapshot(snapshot());
  assert.equal(result.snapshotVersion, "9");
  assert.deepEqual(result.settingsCatalogos.rellenos, ["Cheesecake con ganache"]);
  assert.equal(result.settingsCatalogos.figuras[0].productId, "PR01");
  assert.equal(result.users[0].roles[0], "Administrador");
  assert.deepEqual(result.inventoryChoices[0], { id: "I01", nombre: "Crema", unidad: "L" });
});

test("H76 falla cerrado ante versión, privacidad o tiempos incoherentes", () => {
  assert.throws(() => normalizeConfigurationSnapshot(snapshot({ snapshotVersion: "0" })), /versión autoritativa/i);
  assert.throws(() => normalizeConfigurationSnapshot(snapshot({ containsSecrets: true })), /privacidad/i);
  const bad = snapshot(); bad.settings.delays.kitchenUrgent = 5;
  assert.throws(() => normalizeConfigurationSnapshot(bad), /tiempos operativos/i);
});

test("H76 construye un único contrato de guardado sin actores, auditoría ni secretos", () => {
  const normalized = normalizeConfigurationSnapshot(snapshot());
  const payload = buildConfigurationSavePayload({ settings: normalized.settingsCatalogos });
  assert.equal(payload.figures[0].product_id, "PR01");
  assert.equal(payload.delays.kitchen_warning, 15);
  assert.deepEqual(Object.keys(payload).sort(), [
    "catalogs", "delays", "figures", "fixed_filling", "freezing_hours", "order_minimum", "policies", "toppings", "zones",
  ].sort());
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const forbidden of ["email", "actor", "audit", "secret", "token", "storage"]) assert.equal(serialized.includes(forbidden), false);
});
