import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../supabase/produccion-deltas-v1.sql", import.meta.url), "utf8");
const ordered = readFileSync(new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url), "utf8");
const app = readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const readModel = readFileSync(new URL("../lib/read-model.js", import.meta.url), "utf8");
const panel = readFileSync(new URL("../features/production/ProductionPanel.jsx", import.meta.url), "utf8");

test("H73 instala recibos privados y contratos compactos de Produccion", () => {
  for (const required of [
    "20260719_73_produccion_deltas", "production_activity_sync_versions",
    "production_delta_receipts", "momos_production_activity_delta_v1",
    "crear_corrida_delta", "producir_subreceta_delta", "convertir_imperfectas_delta",
    "momos.production-mutation.v1", "momos.production-activity-delta.v1",
    "produccion_deltas_disponibles",
  ]) assert.match(migration, new RegExp(required.replaceAll(".", "\\."), "i"));
  assert.match(migration, /create policy production_activity_sync_versions_staff_read[\s\S]+for select to authenticated[\s\S]+using\(public\.is_staff\(\)\)/i);
  assert.match(migration, /revoke all on table public\.production_delta_receipts[\s\S]+authenticated/i);
  assert.match(migration, /primary key\(operation,idempotency_key\)/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended/i);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)\s+on\s+(?:table\s+)?public\.production_delta_receipts/i);
});

test("H73 aplica la respuesta de la mutacion sin snapshots completos", () => {
  assert.match(panel, /await crearCorridaDelta\(payload\)/);
  assert.match(panel, /await producirSubrecetaDelta\(payload\)/);
  assert.match(panel, /await convertirImperfectasDelta\(lote\.id, idempotencyKey\)/);
  assert.match(panel, /aplicarMutacionProduccionORefrescar/);
  assert.match(panel, /if \(!mutationContext\) \{[\s\S]+await refrescarSilencioso/i);
  assert.match(app, /capturarContextoMutacionProduccion/);
  assert.match(app, /aplicarMutacionProduccion/);
  assert.match(app, /production_activity_sync_versions/);
  assert.match(app, /fetchProductionActivityDelta\(\)/);
});

test("H73 conserva una sola normalizacion al cruzar la frontera de red", () => {
  assert.match(readModel, /export async function fetchOrderDeltas[\s\S]+normalizeOrderDeltaBatch\(data\);[\s\S]+return data;/);
  assert.match(readModel, /export async function fetchFinishedInventoryDeltas[\s\S]+normalizeFinishedInventoryDeltaBatch\(data\);[\s\S]+return data;/);
  assert.match(readModel, /export async function fetchProductionActivityDelta[\s\S]+normalizeProductionActivityDelta\(data\);[\s\S]+return data;/);
});

test("la cadena ordenada incluye H73 despues de H72", () => {
  assert.ok(ordered.indexOf("20260719_73_produccion_deltas") > ordered.indexOf("20260719_72_producto_terminado_deltas"));
  assert.match(ordered, /migraciones ordenadas 01-\d+ PASS/);
});
