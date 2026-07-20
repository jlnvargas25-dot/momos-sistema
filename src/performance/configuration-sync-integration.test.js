import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../supabase/configuracion-servidor-v1.sql", import.meta.url), "utf8");
const ordered = readFileSync(new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url), "utf8");
const app = readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const readModel = readFileSync(new URL("../lib/read-model.js", import.meta.url), "utf8");
const rpc = readFileSync(new URL("../lib/rpc.js", import.meta.url), "utf8");
const coordinator = readFileSync(new URL("../lib/sync-coordinator.js", import.meta.url), "utf8");

test("H76 instala Configuración compacta, versionada, idempotente y administrativa", () => {
  for (const required of [
    "20260719_76_configuracion_servidor", "configuration_sync_state", "configuration_mutation_receipts",
    "momos_configuration_snapshot_v1", "guardar_configuracion_v1", "configuracion_servidor_disponible",
    "momos.configuration-snapshot.v1", "momos.configuration-mutation.v1",
  ]) assert.match(migration, new RegExp(required.replaceAll(".", "\\."), "i"));
  assert.match(migration, /containsCustomerPii',false[\s\S]+containsStaffPii',true[\s\S]+containsSecrets',false[\s\S]+externalExecution',false/i);
  assert.match(migration, /Configuración cambió en otra sesión[\s\S]+errcode='40001'/i);
  assert.match(migration, /revoke all on table public\.configuration_mutation_receipts[\s\S]+authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)\s+on\s+(?:table\s+)?public\.configuration_mutation_receipts/i);
});

test("H76 separa Configuración de catálogos y evita la hidratación completa", () => {
  assert.match(coordinator, /CONFIGURATION:\s*"configuracion"/);
  assert.match(coordinator, /const CONFIGURATION_VIEWS = new Set\(\["configuracion"\]\)/);
  assert.doesNotMatch(coordinator, /CATALOG_VIEWS = new Set\(\[[^\]]*configuracion/i);
  assert.match(readModel, /export async function fetchConfigurationSnapshot[\s\S]+momos_configuration_snapshot_v1/);
  assert.match(rpc, /export async function guardarConfiguracionServidor[\s\S]+guardar_configuracion_v1/);
  assert.match(app, /SYNC_DOMAINS\.CONFIGURATION/);
  assert.match(app, /configuration_sync_state/);
  assert.match(app, /Guardar configuración/);
  assert.doesNotMatch(rpc, /guardarConfiguracionDemoras/);
});

test("la cadena ordenada incluye H76 después de H75", () => {
  assert.ok(ordered.indexOf("20260719_76_configuracion_servidor") > ordered.indexOf("20260719_75_finanzas_operativas"));
  assert.match(ordered, /migraciones ordenadas 01-76 PASS/);
});
