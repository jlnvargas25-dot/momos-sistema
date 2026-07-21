import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Pedidos, CRM, Ventas y Finanzas comparten el contrato monetario", async () => {
  const [root, crm, sales, finance] = await Promise.all([
    read("../MomosOps.jsx"),
    read("../lib/customer-crm.js"),
    read("../lib/sales-reception-assistant.js"),
    read("../lib/operational-finance.js"),
  ]);
  for (const source of [root, crm, sales, finance]) {
    assert.match(source, /calculateOrderMoney/);
  }
});

test("venta, productos, producción y voz consumen stock canónico compartido", async () => {
  const [orders, products, production, voice] = await Promise.all([
    read("../features/orders/OrdersPanel.jsx"),
    read("../features/backoffice/BusinessPanels.jsx"),
    read("../features/production/ProductionPanel.jsx"),
    read("../features/production/VoiceKitchenPanel.jsx"),
  ]);
  assert.match(orders, /canonicalVariantsForAvailability/);
  assert.match(products, /buildCanonicalFinishedStock/);
  assert.match(production, /canonicalUsableIngredientStock/);
  assert.match(voice, /canonicalVariantsForAvailability/);
  assert.match(voice, /canonicalUsableIngredientStock/);
});

test("las fechas operativas usan el día comercial de Cali", async () => {
  const sources = await Promise.all([
    "../lib/finished-inventory.js",
    "../lib/variant-availability.js",
    "../lib/customer-crm.js",
    "../lib/commercial-calendar.js",
    "../lib/commercial-distribution.js",
    "../lib/brand-studio.js",
  ].map(read));
  for (const source of sources) assert.match(source, /businessDateISO/);
});
