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
  const agencyBrandStudio = chunks.find((chunk) => Object.keys(chunk.modules || {})
    .some((id) => id.replaceAll("\\", "/").endsWith("/features/agency/AgencyBrandStudio.jsx")));
  const agencyCreativeSuite = chunks.find((chunk) => Object.keys(chunk.modules || {})
    .some((id) => id.replaceAll("\\", "/").endsWith("/features/agency/AgencyCreativeSuite.jsx")));
  const agencyMetaSuite = chunks.find((chunk) => Object.keys(chunk.modules || {})
    .some((id) => id.replaceAll("\\", "/").endsWith("/features/agency/AgencyMetaSuite.jsx")));
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
  const deliveryRuntime = chunks.find((chunk) => Object.keys(chunk.modules || {})
    .some((id) => {
      const normalized = id.replaceAll("\\", "/");
      return normalized.endsWith("/lib/delivery-sync.js")
        || normalized.endsWith("/lib/delivery-mutation.js");
    }));
  const catalogCrmRuntime = chunks.find((chunk) => Object.keys(chunk.modules || {})
    .some((id) => id.replaceAll("\\", "/").endsWith("/lib/catalog-crm-delta.js")));

  assert.ok(entry, "Vite debe producir un entry principal");
  assert.ok(agency, "Vite debe producir el chunk de Agencia");
  assert.ok(agencyBrandStudio, "Biblioteca e Identidad deben vivir en un chunk propio");
  assert.ok(agencyCreativeSuite, "Estudio creativo debe vivir en un chunk propio");
  assert.ok(agencyMetaSuite, "Meta y medición deben vivir en un chunk propio");
  assert.ok(orders, "Vite debe producir el chunk conjunto de Pedidos y Empaque");
  assert.ok(production, "Vite debe producir el chunk completo de Producción");
  assert.ok(inventory, "Vite debe producir el chunk conjunto de inventarios");
  assert.ok(finance, "Vite debe producir el chunk de Finanzas");
  assert.ok(financeRuntime, "Vite debe conservar el motor financiero fuera del arranque");
  assert.ok(deliveryRuntime, "Vite debe producir el runtime diferido de Domicilios");
  assert.ok(catalogCrmRuntime, "Vite debe producir el runtime diferido de Catálogo/CRM");
  assert.equal(agency.isDynamicEntry, true);
  assert.equal(agencyBrandStudio.isDynamicEntry, true);
  assert.equal(agencyCreativeSuite.isDynamicEntry, true);
  assert.equal(agencyMetaSuite.isDynamicEntry, true);
  assert.equal(agency.dynamicImports.includes(agencyBrandStudio.fileName), true,
    "Agencia debe solicitar Biblioteca solamente cuando el humano la abre");
  assert.equal(agency.dynamicImports.includes(agencyCreativeSuite.fileName), true,
    "Agencia debe solicitar el Estudio solamente cuando el humano lo abre");
  assert.equal(agency.dynamicImports.includes(agencyMetaSuite.fileName), true,
    "Agencia debe solicitar Meta solamente cuando el humano lo abre");
  assert.ok(Buffer.byteLength(agency.code, "utf8") < 200_000,
    "el shell amigable de Agencia debe permanecer por debajo de 200 KB sin sus herramientas avanzadas");
  assert.equal(orders.isDynamicEntry, true);
  assert.equal(production.isDynamicEntry, true);
  assert.equal(inventory.isDynamicEntry, true);
  assert.equal(finance.isDynamicEntry, true);
  assert.equal(deliveryRuntime.isDynamicEntry, true);
  assert.equal(catalogCrmRuntime.isDynamicEntry, true);
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
  assert.equal(Object.keys(entry.modules || {}).some((id) => {
    const normalized = id.replaceAll("\\", "/");
    return normalized.endsWith("/lib/delivery-sync.js")
      || normalized.endsWith("/lib/delivery-mutation.js")
      || normalized.endsWith("/lib/delivery-order-board.js");
  }), false, "el entry no debe contener el runtime exclusivo de Domicilios");
  assert.equal(Object.keys(entry.modules || {}).some((id) => id.replaceAll("\\", "/")
    .endsWith("/lib/catalog-crm-delta.js")), false,
  "el entry no debe contener el validador pesado de Catálogo/CRM");
});
