import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../supabase/producto-terminado-deltas-v1.sql", import.meta.url), "utf8");
const ordered = readFileSync(new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url), "utf8");
const app = readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const readModel = readFileSync(new URL("../lib/read-model.js", import.meta.url), "utf8");
const production = readFileSync(new URL("../features/production/ProductionPanel.jsx", import.meta.url), "utf8");

test("H72 instala outbox sanitario y contrato cerrado por producto", () => {
  for (const required of [
    "20260719_72_producto_terminado_deltas", "finished_inventory_sync_versions",
    "momos_finished_inventory_deltas_v1", "momos.finished-inventory-delta-batch.v1",
    "momos.finished-inventory-delta.v1", "producto_terminado_deltas_disponibles",
  ]) assert.match(migration, new RegExp(required.replaceAll(".", "\\."), "i"));
  assert.match(migration, /create policy finished_inventory_sync_versions_staff_read[\s\S]+for select to authenticated[\s\S]+using\(public\.is_staff\(\)\)/i);
  assert.match(migration, /grant select on table public\.finished_inventory_sync_versions to authenticated/i);
  assert.match(migration, /cardinality\(p_product_ids\)>20/i);
  assert.doesNotMatch(migration, /grant (insert|update|delete)[\s\S]+finished_inventory_sync_versions/i);
});

test("H72 lee y aplica deltas dirigidos sin recargar colecciones crudas", () => {
  assert.match(readModel, /fetchFinishedInventoryDeltas[\s\S]+momos_finished_inventory_deltas_v1/);
  assert.match(readModel, /producto_terminado_deltas_disponibles/);
  assert.match(app, /finishedInventoryDeltaRealtime = vista === "Inventario terminado"/);
  assert.match(app, /table === "finished_inventory_sync_versions"/);
  assert.match(app, /fetchFinishedInventoryDeltas\(productIds\)/);
  assert.match(app, /finishedInventoryOperationsAreCurrent/);
  assert.match(app, /__finishedInventoryReadGeneration/);
});

test("H72 usa lectura dirigida tras cambiar un lote y conserva fallback", () => {
  assert.match(production, /sincronizarProductoTerminado\(\[lote\.productId\]\)/);
  assert.match(production, /await sincronizarLote\(l,/);
  assert.match(production, /await sincronizarLote\(lote,/);
  assert.match(production, /await refrescar\(\)/, "el fallback amplio debe seguir disponible durante rollout");
});

test("la cadena ordenada incluye H72 después de H71", () => {
  assert.ok(ordered.indexOf("20260719_72_producto_terminado_deltas") > ordered.indexOf("20260719_71_pedidos_deltas"));
  assert.match(ordered, /migraciones ordenadas 01-72 PASS/);
});
