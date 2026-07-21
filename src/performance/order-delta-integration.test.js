import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../supabase/pedidos-deltas-v1.sql", import.meta.url), "utf8");
const ordered = readFileSync(new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url), "utf8");
const panel = readFileSync(new URL("../features/orders/OrdersPanel.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");

test("H71 instala un contrato cerrado por orden y un outbox sanitario de solo lectura", () => {
  for (const required of [
    "20260719_71_pedidos_deltas", "momos_order_deltas_v1", "order_sync_versions",
    "momos.order-delta-batch.v1", "momos.order-delta.v1", "pedidos_deltas_disponibles",
  ]) assert.match(migration, new RegExp(required.replaceAll(".", "\\."), "i"));
  assert.match(migration, /revoke all on table public\.order_sync_versions[\s\S]+authenticated/i);
  assert.match(migration, /create policy order_sync_versions_staff_read[\s\S]+for select to authenticated[\s\S]+using\(public\.is_staff\(\)\)/i);
  assert.match(migration, /grant select on table public\.order_sync_versions to authenticated/i);
  assert.match(migration, /if public\.is_staff\(\) is not true then/i);
  assert.match(migration, /cardinality\(p_order_ids\)>50/i);
  assert.match(migration, /'activacion',coalesce\(b\.activacion::text,''\)/i,
    "las fechas opcionales deben serializarse como texto antes de aplicar el fallback vacío");
  assert.doesNotMatch(migration, /grant (insert|update|delete)[\s\S]+order_sync_versions/i);
});

test("H71 usa una sola lectura dirigida después de mutar Pedidos o Empaque", () => {
  assert.match(panel, /fetchOrderDeltas\(\[orderId\]\)/);
  assert.match(panel, /aplicarDeltaPedido\(envelope, generation\)/);
  assert.match(panel, /await sincronizarPedido\(res\.order_id\)/);
  assert.match(panel, /await confirmarVerificacionEmpaque[\s\S]+await sincronizarPedido\(o\.id\)/);
  assert.equal((panel.match(/await refrescar\(\);/g) || []).length, 1,
    "solo el fallback pre-H71 puede conservar el snapshot amplio");
});

test("H71 evita que un snapshot antiguo pise un delta y enruta Realtime por order_id", () => {
  assert.match(app, /__orderReadGeneration/);
  assert.match(app, /capturedOrderGeneration === orderSyncGenerationRef\.current/);
  assert.match(app, /orderSnapshotDiscarded/);
  assert.match(app, /table === "order_sync_versions"/);
  assert.match(app, /fetchOrderDeltas\(orderIds\)/);
  assert.match(app, /compareOrderDeltaVersions\(incomingVersion, currentVersion\)/);
});

test("Pedidos silencia recordatorios de demora sin apagar sus propios eventos", () => {
  assert.match(app, /activeView !== "Pedidos" && canReceiveKitchenDelayReminders/);
  assert.match(app, /activeView !== "Pedidos" \|\| dialogMode !== "delays"/);
  assert.match(app, /<GlobalKitchenOrderAlerts[\s\S]+activeView=\{vista\}/);
  assert.doesNotMatch(app, /activeView !== "Pedidos" && canReceiveKitchenOrderAlerts/);
});

test("la cadena ordenada incluye H71 después de H70", () => {
  assert.ok(ordered.indexOf("20260719_71_pedidos_deltas") > ordered.indexOf("20260719_70_inventario_delta_consistencia"));
});
