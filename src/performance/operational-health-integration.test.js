import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../supabase/centro-salud-operativa-v1.sql", import.meta.url), "utf8");
const adversarial = readFileSync(new URL("../../supabase/tests/test-centro-salud-operativa-v1.sql", import.meta.url), "utf8");
const ordered = readFileSync(new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../scripts/operational-health-worker.mjs", import.meta.url), "utf8");
const rpc = readFileSync(new URL("../lib/rpc.js", import.meta.url), "utf8");
const backoffice = readFileSync(new URL("../features/backoffice/BusinessPanels.jsx", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

test("H92 centraliza chequeos, incidentes, errores y backups sin exponer tablas", () => {
  for (const name of [
    "operational_health_state", "operational_health_runs", "operational_health_checks",
    "operational_health_incidents", "operational_health_error_events", "operational_backup_receipts",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${name}\\(`));
  }
  assert.match(migration, /revoke all on table public\.%I from public,anon,authenticated,service_role/);
  assert.match(migration, /containsCustomerPii',false,'containsSecrets',false,'containsFreeText',false/);
  assert.doesNotMatch(migration, /error_message text|request_payload|response_payload|storage_path text/);
});

test("H92 congela el núcleo ante deriva y exige recuperación verificada", () => {
  assert.match(migration, /INVENTORY_RECONCILIATION[\s\S]+INVENTORY_STOCK_DRIFT[\s\S]+true\);/);
  assert.match(migration, /create trigger momos_h92_read_only_guard before insert or update or delete/);
  assert.match(migration, /Persisten fallos críticos de integridad; no se puede reactivar la escritura/);
  assert.match(adversarial, /stock=stock\+1[\s\S]+readOnly[\s\S]+sqlstate '55000'/);
  assert.match(adversarial, /status[\s\S]{0,120}'Recuperado'[\s\S]+resolver_incidente_salud_v1/);
});

test("el monitor autónomo usa service role privada y nunca imprime errores remotos", () => {
  assert.equal(pkg.scripts["worker:health"], "node scripts/operational-health-worker.mjs");
  assert.equal(pkg.scripts["worker:health:check"], "node scripts/operational-health-worker.mjs --once --health-only");
  assert.match(worker, /isSupabaseServerKey/);
  assert.match(worker, /ejecutar_monitor_salud_operativa_v1/);
  assert.match(worker, /MONITOR_RPC_FAILED/);
  assert.doesNotMatch(worker, /error\.message\}\n|JSON\.stringify\(error/);
});

test("H92 queda detrás de H91 en la cadena ordenada", () => {
  const h91 = ordered.indexOf("20260721_91_mutaciones_compuestas_atomicas");
  const h92 = ordered.indexOf("20260721_92_centro_salud_operativa");
  assert.ok(h91 >= 0 && h92 > h91);
  assert.match(ordered, /migraciones ordenadas 01-92 PASS/);
});

test("H92 se consulta bajo demanda y se presenta en lenguaje operativo", () => {
  assert.match(rpc, /momos_operational_health_snapshot_v1/);
  assert.match(rpc, /ejecutar_revision_salud_operativa_v1/);
  assert.match(backoffice, /data-testid="operational-health-center"/);
  assert.match(backoffice, /Salud y continuidad de MOMO OPS/);
  assert.match(backoffice, /Qué necesita atención/);
  assert.doesNotMatch(backoffice, /operational_health_(?:state|runs|checks|incidents)/);
});
