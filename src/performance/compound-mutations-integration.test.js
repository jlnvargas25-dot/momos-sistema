import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const rpc = read("../lib/rpc.js");
const orders = read("../features/orders/OrdersPanel.jsx");
const production = read("../features/production/ProductionPanel.jsx");
const inventory = read("../features/inventory/InventoryPanels.jsx");
const migration = read("../../supabase/mutaciones-compuestas-atomicas-v1.sql");

test("H91 expone tres contratos compuestos idempotentes y ningún recibo público", () => {
  for (const name of [
    "completar_cocina_y_entregar_empaque_v1",
    "crear_corrida_agrupada_v1",
    "registrar_compra_y_atender_sugerencias_v1",
  ]) {
    assert.match(migration, new RegExp(`function public\\.${name}\\(p jsonb\\)`));
    assert.match(rpc, new RegExp(`supabase\\.rpc\\("${name}"`));
  }
  assert.match(migration, /primary key\(operation,idempotency_key\)/);
  assert.match(migration, /alter table public\.compound_mutation_receipts enable row level security/);
  assert.match(migration, /revoke all on table public\.compound_mutation_receipts[\s\S]*authenticated,service_role/);
  assert.match(migration, /request_hash text not null check\(request_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});

test("Cocina usa una sola RPC y solo conserva fallback durante el rollout", () => {
  for (const source of [orders, production]) {
    assert.match(source, /completarCocinaYEntregarEmpaque\(orderId, createInventoryIdempotencyKey\(\)\)/);
    assert.match(source,
      /catch \(error\) \{\s*if \(!isMissingRpcError\(error\)\) throw error;\s*await completarEtapaPedido/,
      "un error de permisos, validación o red jamás debe ejecutar el flujo partido");
  }
});

test("corrida agrupada y compra cierran sugerencias dentro del mismo commit", () => {
  assert.match(production, /await crearCorridaAgrupada\([\s\S]*?suggestionIds[\s\S]*?corridaCompoundIdemKeyRef/);
  assert.match(production, /for \(const suggestionId of compoundApplied \? \[\] : suggestionIds\.slice\(1\)\)/,
    "H91 no debe repetir el cierre legado después de confirmar la transacción");
  assert.match(inventory, /await registrarCompraYAtenderSugerencias\(payload, suggestionIds, intent\.key\)/);
  assert.match(inventory, /suggestionIds\.length && !compoundApplied/,
    "la compra H91 no debe cerrar nuevamente sus sugerencias desde el navegador");
  assert.match(migration, /v_production:=public\.crear_corrida_delta\(v_run\)[\s\S]*?set_sugerencia_estado/);
  assert.match(migration, /v_inventory:=public\.entrada_insumo_lote_delta\([\s\S]*?set_sugerencia_estado/);
});

test("H91 bloquea recursos, valida pertenencia y falla cerrado", () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('momos-h91:key:cocina_a_empaque:/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('momos-h91:key:corrida_agrupada:/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('momos-h91:key:compra_con_sugerencias:/);
  assert.match(migration, /area<>'Producción' or estado<>'Pendiente'/);
  assert.match(migration, /area<>'Inventario' or estado<>'Pendiente' or item_id is distinct from v_item_id/);
  assert.match(migration, /Una sugerencia no corresponde a las figuras de esta corrida/);
});
