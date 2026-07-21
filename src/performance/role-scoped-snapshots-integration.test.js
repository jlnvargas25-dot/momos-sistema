import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../supabase/aislamiento-snapshots-por-rol-v1.sql", import.meta.url),
  "utf8",
);
const adversarial = readFileSync(
  new URL("../../supabase/tests/test-aislamiento-snapshots-por-rol-v1.sql", import.meta.url),
  "utf8",
);
const readModel = readFileSync(new URL("../lib/read-model.js", import.meta.url), "utf8");

test("H88 instala snapshots security definer con proyección cerrada por roles", () => {
  assert.match(migration, /create or replace function public\.momos_core_snapshot_v3\(\)/i);
  assert.match(migration, /create or replace function public\.momos_operational_snapshot_v2\(\)/i);
  assert.match(migration, /security definer[\s\S]+set row_security=off/i);
  assert.match(migration, /public\.current_roles\(\)/i);
  assert.match(migration, /_momos_project_jsonb_rows/i);
  assert.match(migration, /revoke all on function public\._momos_project_jsonb_rows[\s\S]+authenticated/i);
});

test("H88 no entrega a Cocina PII, pagos, Storage, CRM ni precios", () => {
  for (const forbidden of [
    "telefono", "direccion", "cumple", "notas", "comprobante", "campaign_id",
    "creative_id", "precio", "costo_unitario",
  ]) {
    assert.match(adversarial, new RegExp(forbidden, "i"));
  }
  assert.match(adversarial, /jsonb_array_length\(v_op->'evidences'\)=0/i);
  assert.match(adversarial, /jsonb_array_length\(v_op->'customer_crm_profiles'\)=0/i);
  assert.match(adversarial, /contains_customer_pii/i);
  assert.match(adversarial, /rollback;/i);
});

test("el frontend prefiere H88 y conserva fallback temporal H87", () => {
  assert.match(readModel, /optionalSnapshot\("momos_core_snapshot_v3"\)/);
  assert.match(readModel, /optionalSnapshot\("momos_operational_snapshot_v2"\)[\s\S]+optionalSnapshot\("momos_operational_snapshot_v1"\)/);
  assert.match(readModel, /snapshot-v3-role-scoped/);
});
