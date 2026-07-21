import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const coordinator = fs.readFileSync(new URL("../lib/sync-coordinator.js", import.meta.url), "utf8");
const panels = fs.readFileSync(new URL("../features/backoffice/BusinessPanels.jsx", import.meta.url), "utf8");

test("H81 Domicilios carga solo el dominio compacto de Logística", () => {
  assert.match(coordinator, /const LOGISTICS_VIEWS = new Set\(\["domicilios"\]\)/);
  assert.match(coordinator, /if \(LOGISTICS_VIEWS\.has\(key\)\) return \[SYNC_DOMAINS\.LOGISTICS\]/);
  assert.match(app, /\[SYNC_DOMAINS\.LOGISTICS\]: \(\) => measureSyncLoad\([\s\S]*?fetchDeliverySnapshot\(50\)/);
});

test("H81 conserva Pedidos global y guarda la proyección logística por separado", () => {
  assert.match(app, /d\.deliveryOrders = logistics\.orders/);
  assert.match(app, /d\.deliveryOrderItems = logistics\.orderItems/);
  assert.doesNotMatch(app, /if \(logistics\)[\s\S]{0,500}d\.orders = logistics\.orders/);
  assert.match(panels, /orders: db\.deliveryOrders/);
});

test("H81 usa H71 para cambios y reconcilia con Logística, no con Operaciones", () => {
  assert.match(app, /syncDeliverySnapshotOrders\(nextDb, result\.applied, 50\)/);
  assert.match(app, /logisticsRealtime \? SYNC_DOMAINS\.LOGISTICS : SYNC_DOMAINS\.OPERATIONS/);
  assert.match(app, /\(operationsRealtime \|\| logisticsRealtime\)/);
});

test("H81 entra con una lectura acotada y no trae evidencias, reclamos ni auditoría", () => {
  const migration = fs.readFileSync(new URL("../../supabase/domicilios-snapshot-v1.sql", import.meta.url), "utf8");
  assert.match(migration, /limit 200/i);
  assert.match(migration, /least\(50,greatest\(1/);
  assert.match(migration, /limit 3000/i);
  assert.match(migration, /limit 1000/i);
  assert.doesNotMatch(migration, /from public\.evidences/i);
  assert.doesNotMatch(migration, /from public\.claims/i);
  assert.doesNotMatch(migration, /from public\.audit_logs/i);
});
