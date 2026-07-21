import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../supabase/dashboard-operativo-v1.sql", import.meta.url), "utf8");
const ordered = readFileSync(new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url), "utf8");
const app = readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const businessPanels = readFileSync(new URL("../features/backoffice/BusinessPanels.jsx", import.meta.url), "utf8");
const readModel = readFileSync(new URL("../lib/read-model.js", import.meta.url), "utf8");
const coordinator = readFileSync(new URL("../lib/sync-coordinator.js", import.meta.url), "utf8");

test("H77 instala un Dashboard compacto, versionado y derivado de outboxes", () => {
  for (const required of [
    "20260719_76_configuracion_servidor", "20260719_77_dashboard_operativo",
    "dashboard_sync_state", "momos_dashboard_snapshot_v1", "dashboard_operativo_disponible",
    "momos.dashboard-snapshot.v1",
  ]) assert.match(migration, new RegExp(required.replaceAll(".", "\\."), "i"));

  assert.match(migration, /limit 24/i);
  assert.match(migration, /limit 12/i);
  assert.match(migration, /limit 20/i);
  assert.match(migration, /channel_totals as\([\s\S]+coalesce\(sum\(t\.total\),0\) value[\s\S]+from channel_totals/i);
  assert.doesNotMatch(migration, /jsonb_agg\([\s\S]{0,180}sum\(t\.total\)/i);
  assert.match(migration, /containsCustomerPii',false[\s\S]+containsStaffPii',false[\s\S]+containsFreeText',false[\s\S]+containsStorageReferences',false[\s\S]+containsSecrets',false[\s\S]+externalExecution',false/i);
  assert.match(migration, /revoke all on table public\.dashboard_sync_state[\s\S]+grant select on table public\.dashboard_sync_state to authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)\s+on\s+(?:table\s+)?public\.dashboard_sync_state/i);
});

test("H77 convierte Dashboard en un único dominio de lectura diferida", () => {
  assert.match(coordinator, /DASHBOARD:\s*"dashboard"/);
  assert.match(coordinator, /const DASHBOARD_VIEWS = new Set\(\["dashboard"\]\)/);
  assert.match(readModel, /export async function fetchDashboardSnapshot[\s\S]+momos_dashboard_snapshot_v1/);
  assert.match(app, /SYNC_DOMAINS\.DASHBOARD/);
  assert.match(app, /dashboard_sync_state/);
  assert.match(app, /fetchDashboardSnapshot/);

  const dashboardStart = businessPanels.indexOf("function Dashboard(");
  const dashboardEnd = businessPanels.indexOf("function HistorialOperativo", dashboardStart);
  const dashboard = businessPanels.slice(dashboardStart, dashboardEnd);
  assert.ok(dashboardStart >= 0 && dashboardEnd > dashboardStart);
  assert.match(dashboard, /db\.dashboardSnapshotReady\s*\?\s*db\.dashboardSnapshot/);
  assert.doesNotMatch(dashboard, /db\.(?:orders|customers|products|inventory|campaigns|creatives|contentCalendar|productionSuggestions)/);
  assert.doesNotMatch(dashboard, /import\(["']\.\/lib\/assistant-control-center\.js["']\)/);
  assert.match(app, /LazyBusinessPanels/);
});

test("la cadena ordenada incluye H77 después de H76", () => {
  assert.ok(ordered.indexOf("20260719_77_dashboard_operativo") > ordered.indexOf("20260719_76_configuracion_servidor"));
  assert.match(ordered, /migraciones ordenadas 01-83 PASS/);
});
