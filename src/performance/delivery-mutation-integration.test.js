import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const panels = fs.readFileSync(new URL("../features/backoffice/BusinessPanels.jsx", import.meta.url), "utf8");
const readModel = fs.readFileSync(new URL("../lib/read-model.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../../supabase/domicilios-mutaciones-atomicas-v1.sql", import.meta.url), "utf8");

function deliverySection() {
  const start = panels.indexOf("function Domicilios(");
  const end = panels.indexOf("/* ================= RECLAMOS", start);
  assert.ok(start >= 0 && end > start, "no se encontró el panel de Domicilios");
  return panels.slice(start, end);
}

test("H82 devuelve la mutación y el delta exacto del pedido desde una sola RPC", () => {
  assert.match(migration, /create table if not exists public\.delivery_mutation_receipts/i);
  assert.match(migration, /primary key\(operation,idempotency_key\)/i);
  assert.match(migration, /public\.momos_order_deltas_v1\(array\[p_order_id\]\)/i);
  assert.match(migration, /'contract','momos\.delivery-mutation\.v1'/i);
});

test("H82 no agrega una sonda HTTP: obtiene la capacidad del manifiesto cacheado", () => {
  assert.match(readModel, /const manifest = await fetchSyncManifest\(\)/);
  assert.match(readModel, /manifest\?\.capabilities\?\.domicilios_mutaciones_atomicas_disponibles === true/);
  assert.doesNotMatch(readModel, /capabilityResult\("domicilios_mutaciones_atomicas_disponibles"\)/);
});

test("H82 aplica el recibo localmente y solo concilia si está vencido o inválido", () => {
  const section = deliverySection();
  assert.match(section, /const envelope = await mutarDomicilioDelta\(operation, payload, key\)/);
  assert.match(section, /const result = await aplicarMutacionDomicilio\(envelope, operation, generation\)/);
  assert.match(section, /if \(result\?\.status === "discarded"\) await solicitarConciliacionPedidos\(\)/);
  assert.match(section, /catch \(error\)[\s\S]*?await solicitarConciliacionPedidos\(\)/);
});

test("H82 conserva la misma llave durante reintentos de red y no persiste el estado global", () => {
  const section = deliverySection();
  assert.match(section, /mutationKeysRef = useRef\(new Map\(\)\)/);
  assert.match(section, /mutationKeysRef\.current\.set\(signature, createInventoryIdempotencyKey\(\)\)/);
  assert.match(section, /mutationKeysRef\.current\.delete\(signature\)/);
  assert.match(app, /deliveryMutationDeltaReady: false/);
  assert.match(app, /persistir: false/);
});
