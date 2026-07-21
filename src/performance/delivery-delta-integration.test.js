import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const panels = fs.readFileSync(new URL("../features/backoffice/BusinessPanels.jsx", import.meta.url), "utf8");

function deliverySection() {
  const start = panels.indexOf("function Domicilios(");
  const end = panels.indexOf("/* ================= RECLAMOS", start);
  assert.ok(start >= 0 && end > start, "no se encontró el panel de Domicilios");
  return panels.slice(start, end);
}

test("H80 Domicilios escucha el outbox versionado y no tablas operativas crudas", () => {
  assert.match(
    app,
    /\["Pedidos", "Empaque", "Inventario terminado", "Producción", "Domicilios"\]\.includes\(vista\)/,
  );
  assert.match(app, /if \(orderDeltaRealtime\) tables\.push\("order_sync_versions"\)/);
});

test("H80 concilia solo los pedidos afectados y conserva snapshot como respaldo", () => {
  assert.match(app, /async function sincronizarPedidos\(orderIds\)/);
  assert.match(app, /const envelope = await fetchOrderDeltas\(ids\)/);
  assert.match(app, /if \(result\?\.status === "discarded"\) await solicitarConciliacionPedidos\(\)/);
  assert.match(app, /if \(dbRef\.current\?\.orderDeltaReady !== true\)[\s\S]*?await solicitarConciliacionPedidos\(\)/);
  assert.match(app, /return \{ status: "snapshot", applied: \[\], recoveredFrom:/);
});

test("H82 asignar y actualizar usa recibo atómico; H71 queda como fallback dirigido", () => {
  const section = deliverySection();
  assert.match(section, /db\.deliveryMutationDeltaReady !== true/);
  assert.match(section, /const envelope = await mutarDomicilioDelta\(operation, payload, key\)/);
  assert.match(section, /aplicarMutacionDomicilio\(envelope, operation, generation\)/);
  assert.match(section, /await sincronizarPedidos\(\[payload\.order_id\]\)/);
  assert.doesNotMatch(section, /await refrescar\(\)/);
});

test("H80 mantiene al pedido como unidad visual y D-xxx solo como trazabilidad", () => {
  const section = deliverySection();
  assert.match(section, /Pedido \{order\.id\}/);
  assert.match(section, /El pedido es la unidad de trabajo/);
  assert.match(section, /D-xxx/);
});
