import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../supabase/finanzas-operativas-v1.sql", import.meta.url), "utf8");
const ordered = readFileSync(new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url), "utf8");
const app = readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../features/finance/FinancePanel.jsx", import.meta.url), "utf8");
const readModel = readFileSync(new URL("../lib/read-model.js", import.meta.url), "utf8");
const coordinator = readFileSync(new URL("../lib/sync-coordinator.js", import.meta.url), "utf8");

test("H75 instala un resumen financiero compacto, versionado y sin PII", () => {
  for (const required of [
    "20260719_75_finanzas_operativas", "finance_sync_state", "finance_delta_receipts",
    "momos_finance_snapshot_v1", "actualizar_pauta_financiera_v1",
    "momos.finance-snapshot.v1", "momos.finance-mutation.v1", "finanzas_operativas_disponibles",
  ]) assert.match(migration, new RegExp(required.replaceAll(".", "\\."), "i"));
  assert.match(migration, /containsPii',false[\s\S]+containsFreeText',false[\s\S]+containsStorageReferences',false/i);
  assert.match(migration, /revoke all on table public\.finance_delta_receipts[\s\S]+authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)\s+on\s+(?:table\s+)?public\.finance_delta_receipts/i);
});

test("H75 separa Finanzas del snapshot operativo y deja el detalle bajo demanda", () => {
  assert.match(coordinator, /FINANCE:\s*"finanzas"/);
  assert.match(coordinator, /const FINANCE_VIEWS = new Set\(\["finanzas"\]\)/);
  assert.doesNotMatch(coordinator, /OPERATIONAL_VIEWS = new Set\(\[[^\]]*Finanzas/);
  assert.match(readModel, /export async function fetchFinanceSnapshot[\s\S]+momos_finance_snapshot_v1/);
  assert.match(app, /finance_sync_state/);
  assert.match(app, /SYNC_DOMAINS\.FINANCE/);
  assert.match(panel, /if \(!asistenteAbierto[^\n]+return undefined;[\s\S]+fetchFinancialFacts/);
  assert.doesNotMatch(panel, /buildOperationalFinance\(db/);
});

test("la cadena ordenada incluye H75 después de H74", () => {
  assert.ok(ordered.indexOf("20260719_75_finanzas_operativas") > ordered.indexOf("20260719_74_catalogo_crm_deltas"));
  assert.match(ordered, /migraciones ordenadas 01-75 PASS/);
});
