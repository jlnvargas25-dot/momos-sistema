import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const readModelSource = await readFile(new URL("../lib/read-model.js", import.meta.url), "utf8");
const coordinatorSource = await readFile(new URL("../lib/sync-coordinator.js", import.meta.url), "utf8");
const agencyPanelSource = await readFile(new URL("../features/agency/AgencyPanel.jsx", import.meta.url), "utf8");
const migrationSource = await readFile(new URL("../../supabase/agency-snapshot-rendimiento-v1.sql", import.meta.url), "utf8");
const factsMigrationSource = await readFile(new URL("../../supabase/agency-operational-facts-v1.sql", import.meta.url), "utf8");

test("Agencia usa su snapshot cerrado sin rehidratar ni reemplazar catálogos", () => {
  assert.match(mainSource, /fetchAgencyCatalogosConFallback/,
    "el snapshot H66 debe conservar un fallback controlado para instalaciones anteriores");
  assert.match(readModelSource, /fetchCatalogos\(\{ includeAgency: true, skipAgencySnapshot: true \}\)/,
    "el fallback legado no puede ejecutar un segundo probe H66");
  assert.match(readModelSource, /callAgencySnapshotRpc\("momos_agency_snapshots_v2"\)/,
    "la ruta normal debe cargar los cuatro scopes y hechos H67 con un solo RPC");
  assert.match(mainSource, /const catalogs = payload\?\.\[SYNC_DOMAINS\.CATALOGS\];/);
  assert.match(mainSource, /const agency = payload\?\.\[SYNC_DOMAINS\.AGENCY\];/);
  assert.doesNotMatch(mainSource, /const cat = payload\?\.\[SYNC_DOMAINS\.AGENCY\]\s*\|\|\s*payload\?\.\[SYNC_DOMAINS\.CATALOGS\]/,
    "un snapshot de Agencia nunca debe poder vaciar productos, inventario o usuarios");
});

test("Identidad viaja en H66 y firma logos únicamente al abrir su detalle", () => {
  assert.match(migrationSource, /'agency_brand_identity',coalesce\(public\.obtener_identidad_marca\(false\)/,
    "el bundle debe incluir metadatos oficiales sin otra RPC de entrada");
  assert.match(mainSource, /d\.agencyBrandIdentity = cat\.agencyBrandIdentity \|\| null/);
  assert.match(agencyPanelSource, /setBrandIdentityDto\(db\.agencyBrandIdentity \|\| null\)/);
  assert.doesNotMatch(agencyPanelSource, /\}, \[db\.agencyBrandIdentity,/,
    "un clon operativo de db no debe borrar las URLs firmadas del modal abierto");
  assert.match(agencyPanelSource, /\}, \[db\.agencySnapshotVersion\]\);/,
    "Identidad debe refrescarse por la versión sellada del snapshot");
  assert.doesNotMatch(agencyPanelSource, /fetchBrandIdentity\(\{ signAssets: false \}\)/,
    "la portada no debe repetir la lectura de Identidad");
  assert.match(agencyPanelSource, /loadBrandIdentity\(\{ signAssets: true \}\)/,
    "abrir Identidad debe resolver sus logos bajo demanda");
});

test("Realtime de Agencia usa un solo outbox y nunca las tablas crudas", () => {
  assert.match(mainSource, /const realtimeDomains = new Set\(syncDomainsForDbView\(vista, db\)\)/);
  assert.match(mainSource, /agencySnapshotReady:\s*false/,
    "una instalación anterior a H66 no debe intentar el outbox inexistente");
  assert.match(mainSource, /d\.agencySnapshotReady = cat\.agencySnapshotReady === true/);
  assert.match(mainSource, /if \(agencyRealtime && db\.agencySnapshotReady === true\) tables\.push\("agency_snapshot_events"\)/);
  assert.match(mainSource, /Boolean\(db\?\.agencySnapshotReady\), Boolean\(db\?\.agencyOperationalFactsReady\)/,
    "cambiar de panel debe reconstruir la suscripción Realtime");

  const realtimeBody = mainSource.match(/const tables = \[\];([\s\S]*?)let channel =/)?.[1] || "";
  const subscribed = new Set([...realtimeBody.matchAll(/"([a-z][a-z0-9_]+)"/g)].map((match) => match[1]));
  assert.equal(subscribed.has("agency_snapshot_events"), true);
  [
    "agency_settings", "agency_briefs", "agency_storyboards", "brand_media_assets",
    "campaigns", "creatives", "content_posts", "marketing_guiones",
  ].forEach((table) => assert.equal(subscribed.has(table), false,
    `${table} no debe exponerse como suscripción cruda`));
  assert.match(mainSource, /payload\?\.new\?\.version/,
    "los eventos de Agencia se deduplican por versión del outbox");
  assert.match(mainSource, /fetchAgencySnapshotEventVersion\(\)/,
    "SUBSCRIBED debe cerrar la ventana snapshot-suscripción con un SELECT singleton");
  assert.match(coordinatorSource, /compareAgencySnapshotVersions[\s\S]*?a\.length !== b\.length/,
    "la versión bigint debe compararse sin convertirla a Number");
});

test("H67 deja Agencia en un solo dominio y evita la segunda lectura de Realtime", () => {
  assert.match(mainSource, /agencyOperationalFactsReady: data\?\.agencyOperationalFactsReady === true/);
  assert.match(mainSource, /shouldFlushAgencyRealtimeRefresh\(\{[\s\S]*?queuedVersion:[\s\S]*?appliedVersion:/,
    "un evento ya incorporado por una mutación no debe volver a leer Agencia");
  assert.match(readModelSource, /callAgencySnapshotRpc\("momos_agency_snapshots_v2"\)/,
    "la ruta H67 debe pedir scopes y hechos en un único bundle");
  assert.match(readModelSource, /\["missing", "transient"\]\.includes\(v2Failure\.kind\)/,
    "timeout, 5xx y PGRST transitorio tienen un solo respaldo H66");
  assert.match(readModelSource, /v2Failure\.kind === "transient" && v1Failure\.kind === "missing"/,
    "un fallo transitorio sin H66 no cae a datos crudos legados");
  assert.match(coordinatorSource, /if \(AGENCY_VIEWS\.has\(key\)\) return \[SYNC_DOMAINS\.AGENCY\]/,
    "H66 y H67 deben permanecer en un unico dominio cerrado");
  assert.doesNotMatch(mainSource, /agencyNeedsFreshOperations|agency-h66-fallback/,
    "el fallback H66 no debe disparar una segunda lectura de Operaciones");
  assert.match(factsMigrationSource, /'agency_operational_facts',public\._momos_agency_operational_facts_envelope_v1/);
  assert.match(factsMigrationSource, /'customer_records_projected',false/);
  assert.match(factsMigrationSource, /'order_records_projected',false/);
  assert.match(factsMigrationSource, /'external_execution',false/);
});

test("Realtime conserva versiones durante debounce y elimina trailing ya incorporado", () => {
  assert.match(mainSource, /const agencyRealtimePendingVersionRef = useRef\(""\)/,
    "la version pendiente debe vivir fuera del efecto que crea la suscripcion");
  assert.match(mainSource, /agencyRealtime && agencyRealtimePendingVersionRef\.current && shouldFlushAgencyRealtimeRefresh[\s\S]*?refresh\(SYNC_DOMAINS\.AGENCY, agencyRealtimePendingVersionRef\.current\)/,
    "un efecto nuevo debe retomar la version que el cleanup anterior dejo pendiente");
  const realtimeCleanup = mainSource.match(/return \(\) => \{\s*alive = false;[\s\S]*?supabase\.removeChannel\(channel\);\s*\};/)?.[0] || "";
  assert.doesNotMatch(realtimeCleanup, /agencyRealtimePendingVersionRef\.current\s*=\s*""/,
    "limpiar el debounce no puede descartar la version Realtime persistida");
  assert.match(mainSource, /shouldRunAfterActive: \(domain\) => domain !== SYNC_DOMAINS\.AGENCY[\s\S]*?queuedVersion: queuedAgencyVersion/,
    "la version debe reevaluarse despues de aplicar el snapshot activo");
  assert.match(coordinatorSource, /pendingAfterActiveGuards[\s\S]*?guard\(domain\) !== false/,
    "el coordinador debe resolver la guarda justo antes del lote trailing");
});

test("pre-H66 mantiene polling de Agencia sin cruzar el dominio Operaciones", () => {
  assert.match(mainSource, /const agencyFallback = visibleSyncDomainsRef\.current\.has\(SYNC_DOMAINS\.AGENCY\)[\s\S]*?agencySnapshotReady !== true/);
  assert.match(mainSource, /realtimeStatusRef\.current === "activo" && !agencyFallback/);
  assert.match(mainSource, /agencyFallbackOnly:\s*realtimeStatusRef\.current === "activo" && agencyFallback/);
});

test("la migración H66 consolida fuentes, triggers y publicación en el outbox", () => {
  assert.match(migrationSource, /create table(?: if not exists)? public\.agency_snapshot_events/i);
  assert.match(migrationSource, /_momos_agency_snapshot_source_tables_v1/i,
    "la lista canónica de fuentes evita que frontend y SQL diverjan");
  assert.match(migrationSource, /_momos_touch_agency_snapshot_event_v1/i);
  assert.match(migrationSource, /create trigger momos_agency_snapshot_event_v1/i);
  assert.match(migrationSource, /alter publication supabase_realtime drop table/i,
    "las tablas crudas deben salir de Realtime antes de publicar el outbox");
  assert.match(migrationSource, /alter publication supabase_realtime add table public\.agency_snapshot_events/i);
  assert.doesNotMatch(migrationSource, /alter publication supabase_realtime add table public\.%I/i,
    "H66 no debe volver a publicar su lista de fuentes crudas");
});

test("la telemetría espera el panel real y no confunde Suspense con UI utilizable", () => {
  assert.match(mainSource, /function PanelReadySignal\(\{ routeId \}\)[\s\S]*?markUiCommitted\(routeId\)/);
  assert.match(mainSource, /<LazyAgencyPanel \{\.\.\.props\} \/>[\s\S]*?<PanelReadySignal routeId=\{performanceRouteId\} \/>/);
  assert.match(mainSource, /if \(LAZY_PERFORMANCE_VIEWS\.has\(vista\)\) return undefined;/,
    "el efecto general no debe cerrar la ruta mientras solo se muestra el fallback");
  assert.match(mainSource, /await waitForUiCommitFrame\(\)/,
    "la lectura no debe declararse lista antes de permitir el commit visual de React");
});
