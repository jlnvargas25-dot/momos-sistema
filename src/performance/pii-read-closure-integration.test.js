import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../supabase/cierre-lecturas-pii-por-rol-v1.sql", import.meta.url),
  "utf8",
);
const adversarial = readFileSync(
  new URL("../../supabase/tests/test-cierre-lecturas-pii-por-rol-v1.sql", import.meta.url),
  "utf8",
);
const readModel = readFileSync(new URL("../lib/read-model.js", import.meta.url), "utf8");

test("H89 elimina las lecturas amplias y conserva solamente el perfil propio", () => {
  assert.match(migration, /drop policy if exists staff_read on public\.users/i);
  assert.match(migration, /create policy own_profile_read on public\.users/i);
  assert.match(migration, /drop policy if exists claude_read on public\.orders/i);
  for (const table of ["customers", "orders", "deliveries", "evidences", "claims", "customer_contacts"]) {
    assert.match(migration, new RegExp(`'${table}'`, "i"));
  }
});

test("H89 publica un perfil mínimo y snapshots obligatorios con fail-closed", () => {
  assert.match(migration, /create or replace function public\.momos_current_user_profile_v1\(\)/i);
  assert.match(migration, /'contains_email',false/i);
  assert.match(migration, /'contains_auth_id',false/i);
  assert.match(readModel, /supabase\.rpc\("momos_current_user_profile_v1"\)/);
  assert.match(readModel, /H89 impide degradar a lecturas directas/);
  assert.match(readModel, /H89 bloquea la lectura directa/);
});

test("la prueba H89 usa identidades por rol, intenta bypass y siempre revierte", () => {
  assert.match(adversarial, /set local role authenticated/i);
  assert.match(adversarial, /select count\(\*\) from public\.customers\)=0/i);
  assert.match(adversarial, /select count\(\*\) from public\.customer_contacts\)=0/i);
  assert.match(adversarial, /momos_operational_snapshot_v2\(\)/i);
  assert.match(adversarial, /rollback;\s*$/i);
});
