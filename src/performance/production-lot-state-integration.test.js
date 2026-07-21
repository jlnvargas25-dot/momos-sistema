import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../features/production/ProductionPanel.jsx", import.meta.url), "utf8");
const finishedInventoryPanel = readFileSync(new URL("../features/inventory/InventoryPanels.jsx", import.meta.url), "utf8");
const rpc = readFileSync(new URL("../lib/rpc.js", import.meta.url), "utf8");
const readModel = readFileSync(new URL("../lib/read-model.js", import.meta.url), "utf8");
const guide = readFileSync(new URL("../lib/production-preparation-guide.js", import.meta.url), "utf8");
const preflightMigration = readFileSync(new URL("../../supabase/produccion-preflight-elaboraciones-v1.sql", import.meta.url), "utf8");
const shelfLifeMigration = readFileSync(new URL("../../supabase/vida-util-produccion-configurable-v1.sql", import.meta.url), "utf8");
const kitchenSheetsMigration = readFileSync(new URL("../../supabase/fichas-tecnicas-cocina-v1.sql", import.meta.url), "utf8");

test("Producción no permite reservar o vender manualmente un lote completo", () => {
  assert.doesNotMatch(panel, /LOTE_ESTADOS/);
  assert.doesNotMatch(panel, /<MiniSelect[^>]+cambiarEstadoLote/);
  assert.match(panel, /Salida comercial automática/);
  assert.match(panel, /Los pedidos asignan y consumen sus unidades exactas/);
});

test("el formulario expone el cálculo de bases e ingredientes antes de registrar", () => {
  assert.match(panel, /data-testid="production-input-preview"/);
  assert.match(panel, /Necesidades para esta corrida/);
  assert.match(panel, /Ingredientes crudos/);
  assert.match(panel, /merma incluida/);
});

test("los lotes en preparación y las elaboraciones muestran cantidades y pasos", () => {
  assert.match(panel, /data-testid="active-batch-preparation-guide"/);
  assert.match(panel, /Dosificación por figura/);
  assert.match(panel, /Bases exactas para dosificar/);
  assert.match(panel, /Ingredientes si hay que elaborar las bases/);
  assert.match(panel, /testId="active-subrecipe-steps"/);
  assert.match(guide, /buildFigureBatchPreparationGuide/);
  assert.match(guide, /buildSubrecipePreparationGuide/);
  assert.match(guide, /No improvisar temperaturas ni tiempos/);
});

test("H85 sirve fichas técnicas vigentes sin sumar lecturas al snapshot core", () => {
  assert.match(kitchenSheetsMigration, /create or replace function public\.momos_core_snapshot_v2\(\)/i);
  assert.match(kitchenSheetsMigration, /v_base:=public\.momos_core_snapshot_v1\(\)/i);
  assert.match(kitchenSheetsMigration, /kitchen_procedures/i);
  assert.match(kitchenSheetsMigration, /process_defined/i);
  assert.match(kitchenSheetsMigration, /no improvisarlos/i);
  assert.match(readModel, /optionalSnapshot\("momos_core_snapshot_v3"\)/);
  assert.match(readModel, /kitchenProceduresReady \? "momos_core_snapshot_v2" : "momos_core_snapshot_v1"/);
  assert.match(readModel, /procedure: procedureBySubrecipe\.get\(sr\.id\) \|\| null/);
  assert.match(guide, /const procedure = subrecipe\.procedure/);
  assert.match(panel, /Ficha vigente v\{guide\.version\}/);
});

test("Elaboraciones internas ofrece su calculadora independiente por figuras", () => {
  assert.match(panel, /Elaboraciones internas preparadas/);
  assert.match(panel, /🧮 Calcular por figuras/);
  assert.match(panel, /data-testid="elaboration-by-figures-calculator"/);
  assert.match(panel, /Este cálculo no crea lotes, no descuenta inventario/);
  assert.match(panel, /Elaboraciones necesarias/);
  assert.match(panel, /Ver ingredientes y pasos/);
  assert.match(panel, /setDetalleCantidadFinal\(preparation\.outputGrams\)/);
  assert.match(panel, /!corridaInsumos\.preparedStockEnough/);
  assert.match(panel, /Primero prepará y registrá en inventario todas las elaboraciones faltantes/);
});

test("Producción unifica el stock macro/micro y controla vencimientos sin autoeliminar", () => {
  assert.match(panel, /data-testid="finished-product-stock-summary"/);
  assert.match(panel, /data-testid="finished-product-stock-detail"/);
  assert.match(panel, /figura \+ sabor trazables/);
  assert.doesNotMatch(panel, /<SectionTitle>🎯 Disponible por variante/);
  assert.match(panel, /data-testid="production-expiry-control"/);
  assert.match(panel, /desecharProductoTerminadoDelta/);
  assert.match(panel, /desecharLoteInsumoDelta/);
  assert.match(panel, /data-testid="production-expired-disposal-modal"/);
  assert.match(panel, /\["ingredient", "preparation", "finished"\]\.includes\(row\.kind\)/);
  assert.match(panel, /\["ingredient", "preparation"\]\.includes\(desechoVencido\.kind\)/);
  assert.match(panel, /Insumo.*retirado del inventario/);
  assert.match(panel, /Elaboración.*retirada del inventario/);
  assert.match(panel, /insumos, elaboraciones y producto terminado/);
  assert.match(panel, /nunca borra existencias automáticamente/);
  assert.match(panel, /vencido = cuarentena y no uso/);
  assert.match(panel, /FinishedFigureDetailContent figure=\{detalleStockFigura\}/);
});

test("Inventario terminado desecha cuarentena solo desde lote y figura exactos", () => {
  assert.match(finishedInventoryPanel, /buildFinishedStockSummary/);
  assert.match(finishedInventoryPanel, /detalleLotesCuarentena/);
  assert.match(finishedInventoryPanel, /desecharProductoTerminadoDelta/);
  assert.match(finishedInventoryPanel, /batchId: desechoTerminado\.batchId/);
  assert.match(finishedInventoryPanel, /figura: desechoTerminado\.figure/);
  assert.match(finishedInventoryPanel, /cantidadEsperada: desechoTerminado\.quantity/);
  assert.match(panel, /cantidadEsperada: desechoVencido\.quantity/);
  assert.match(rpc, /cantidad_esperada: Number\(cantidadEsperada\)/);
  assert.match(finishedInventoryPanel, /db\.finishedProductDisposalReady === true/);
  assert.match(panel, /db\.finishedProductDisposalReady === true/);
  assert.match(readModel, /capabilities\?\.desecho_producto_terminado_disponible === true/);
  assert.match(readModel, /productionMutationDeltaReady, finishedProductDisposalReady/);
  assert.match(finishedInventoryPanel, /data-testid="finished-inventory-disposal-modal"/);
  assert.match(finishedInventoryPanel, /no tienen lote exacto y requieren conciliación/);
});

test("Producción usa la vida útil configurable y conserva la fecha de cada lote", () => {
  assert.match(panel, /vidaUtilProductoTerminadoDias/);
  assert.match(panel, /vidaUtilMezclasDias/);
  assert.match(panel, /fecha sellada al desmolde/);
  assert.match(shelfLifeMigration, /new\.vida_util_dias:=old\.vida_util_dias/);
  assert.match(shelfLifeMigration, /received_at\+coalesce/);
});

test("el servidor también impide crear el lote sin las bases preparadas", () => {
  assert.match(preflightMigration, /production_batches_prepared_stock_guard/);
  assert.match(preflightMigration, /before insert on public\.production_batches/);
  assert.match(preflightMigration, /for update/);
  assert.match(preflightMigration, /using errcode='23514'/);
  assert.match(preflightMigration, /Prepará y registrá esta elaboración en inventario/);
  assert.match(preflightMigration, /revoke all on function public\._production_batch_prepared_stock_guard\(\)/);
});
