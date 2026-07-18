import assert from "node:assert/strict";
import test from "node:test";
import { build } from "vite";

test("Agencia y paneles operativos viven en chunks dinámicos sin contaminar el arranque", async () => {
  const result = await build({
    configFile: "vite.config.js",
    logLevel: "silent",
    build: { write: false },
  });
  const outputs = (Array.isArray(result) ? result : [result])
    .flatMap((entry) => entry.output || []);
  const chunks = outputs.filter((output) => output.type === "chunk");
  const entry = chunks.find((chunk) => chunk.isEntry);
  const agency = chunks.find((chunk) => Object.keys(chunk.modules || {})
    .some((id) => id.replaceAll("\\", "/").endsWith("/features/agency/AgencyPanel.jsx")));
  const orders = chunks.find((chunk) => Object.keys(chunk.modules || {})
    .some((id) => id.replaceAll("\\", "/").endsWith("/features/orders/OrdersPanel.jsx")));
  const production = chunks.find((chunk) => Object.keys(chunk.modules || {})
    .some((id) => id.replaceAll("\\", "/").endsWith("/features/production/ProductionPanel.jsx")));
  const inventory = chunks.find((chunk) => Object.keys(chunk.modules || {})
    .some((id) => id.replaceAll("\\", "/").endsWith("/features/inventory/InventoryPanels.jsx")));
  const finance = chunks.find((chunk) => Object.keys(chunk.modules || {})
    .some((id) => id.replaceAll("\\", "/").endsWith("/features/finance/FinancePanel.jsx")));
  const financeRuntime = chunks.find((chunk) => Object.keys(chunk.modules || {})
    .some((id) => id.replaceAll("\\", "/").endsWith("/lib/operational-finance.js")));

  assert.ok(entry, "Vite debe producir un entry principal");
  assert.ok(agency, "Vite debe producir el chunk de Agencia");
  assert.ok(orders, "Vite debe producir el chunk conjunto de Pedidos y Empaque");
  assert.ok(production, "Vite debe producir el chunk completo de Producción");
  assert.ok(inventory, "Vite debe producir el chunk conjunto de inventarios");
  assert.ok(finance, "Vite debe producir el chunk de Finanzas");
  assert.ok(financeRuntime, "Vite debe conservar el motor financiero fuera del arranque");
  assert.equal(agency.isDynamicEntry, true);
  assert.equal(orders.isDynamicEntry, true);
  assert.equal(production.isDynamicEntry, true);
  assert.equal(inventory.isDynamicEntry, true);
  assert.equal(finance.isDynamicEntry, true);
  assert.equal(finance.dynamicImports.includes(financeRuntime.fileName), false,
    "el motor financiero debe ser dependencia estática y no una segunda carga dinámica");
  assert.equal(finance === financeRuntime || finance.imports.includes(financeRuntime.fileName), true,
    "Finanzas debe solicitar su motor en el mismo grafo de carga");
  assert.equal(Object.keys(entry.modules || {}).some((id) => {
    const normalized = id.replaceAll("\\", "/");
    return normalized.includes("/features/agency/")
      || normalized.endsWith("/lib/agency-orchestrator.js")
      || normalized.endsWith("/lib/brand-studio.js");
  }), false, "el entry no debe contener la interfaz ni los motores exclusivos de Agencia");
  assert.equal(Object.keys(entry.modules || {}).some((id) => {
    const normalized = id.replaceAll("\\", "/");
    return normalized.includes("/features/orders/")
      || normalized.endsWith("/lib/packing-queue.js")
      || normalized.endsWith("/lib/order-traceability.js");
  }), false, "el entry no debe contener la interfaz ni los motores exclusivos de Pedidos/Empaque");
  assert.equal(Object.keys(entry.modules || {}).some((id) => {
    const normalized = id.replaceAll("\\", "/");
    return normalized.includes("/features/production/")
      || normalized.endsWith("/lib/production-planner.js")
      || normalized.endsWith("/lib/subrecipe-scaling.js");
  }), false, "el entry no debe contener la interfaz ni los motores exclusivos de Producción");
  assert.equal(Object.keys(entry.modules || {}).some((id) => {
    const normalized = id.replaceAll("\\", "/");
    return normalized.includes("/features/inventory/")
      || normalized.endsWith("/lib/finished-inventory.js")
      || normalized.endsWith("/lib/ingredient-lots.js")
      || normalized.endsWith("/lib/inventory-supply-mode.js");
  }), false, "el entry no debe contener la interfaz ni los motores exclusivos de Inventario");
  assert.equal(Object.keys(entry.modules || {}).some((id) => {
    const normalized = id.replaceAll("\\", "/");
    return normalized.includes("/features/finance/")
      || normalized.endsWith("/lib/operational-finance.js");
  }), false, "el entry no debe contener la interfaz ni el motor exclusivo de Finanzas");
});
