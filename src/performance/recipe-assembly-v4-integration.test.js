import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("H112 remains single-apply and fully certified by the staging gate", () => {
  const workflow = read(".github/workflows/staging-database-gate.yml");
  const migration = read("supabase/recetas-figuras-v4.sql");
  const adversarial = read("supabase/tests/test-recetas-figuras-v4.sql");
  const ordered = read("supabase/tests/test-migraciones-ordenadas.sql");

  assert.match(workflow, /20260723_112_recetas_figuras_v4/);
  assert.match(workflow, /--file=supabase\/recetas-figuras-v4\.sql/);
  assert.match(workflow, /--file=supabase\/tests\/test-recetas-figuras-v4\.sql/);
  assert.match(workflow, /01-112 PASS/);
  assert.match(workflow, /if \[ "\$h112_applied" = "t" \]/);

  assert.match(migration, /where id='20260722_111_conciliacion_higgsfield'/);
  assert.match(migration, /'20260723_112_recetas_figuras_v4'/);
  assert.match(migration, /validation_status[^]*'VALIDACION_PILOTO'/);
  assert.match(migration, /contains_maltodextrin boolean not null default false/);
  assert.match(migration, /assembly_spec_version text not null default 'V3'/);
  assert.match(migration, /alter column assembly_spec_version set default 'V4'/);

  assert.match(adversarial, /chr\(65533\)/);
  assert.match(adversarial, /aplicar H112 como bytes UTF-8/);
  assert.match(adversarial, /rollback;/);
  assert.match(ordered, /migraciones ordenadas 01-112 PASS, continua H113/);
});
