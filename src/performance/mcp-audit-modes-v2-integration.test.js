import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("H113 seals canonical MCP audit modes and staging certification", () => {
  const workflow = read(".github/workflows/staging-database-gate.yml");
  const migration = read("supabase/auditoria-mcp-modos-v2.sql");
  const adversarial = read("supabase/tests/test-auditoria-mcp-modos-v2.sql");
  const ordered = read("supabase/tests/test-migraciones-ordenadas.sql");

  assert.match(workflow, /--file=supabase\/auditoria-mcp-modos-v2\.sql/);
  assert.match(workflow, /--file=supabase\/tests\/test-auditoria-mcp-modos-v2\.sql/);
  assert.match(workflow, /01-113 PASS/);
  assert.match(workflow, /Reapply H113 canonical MCP audit after controlled chain/);
  assert.doesNotMatch(workflow, /h113_applied/);

  assert.match(migration, /'Lectura','Propuesta','Referencia','Solicitud'/);
  assert.match(migration, /'OK','Denegado','Fallido'/);
  assert.match(migration, /momos_get_brand_asset_reference/);
  assert.match(migration, /momos_request_human_approval/);
  assert.match(migration, /on conflict\(request_key\) do nothing/);
  assert.match(migration, /is distinct from row/);
  assert.match(migration, /20260723_113_auditoria_mcp_modos_v2/);
  assert.match(migration, /on conflict\(id\) do nothing/);

  assert.match(adversarial, /h113-wrong-mode/);
  assert.match(adversarial, /h113-invalid-status/);
  assert.match(adversarial, /h113-invalid-hash/);
  assert.match(adversarial, /customer_phone/);
  assert.match(ordered, /migraciones ordenadas 01-113 PASS, rollback total/);
});
