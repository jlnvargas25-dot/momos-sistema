import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const inventoryPanelSource = await readFile(new URL("../features/inventory/InventoryPanels.jsx", import.meta.url), "utf8");
const readModelSource = await readFile(new URL("../lib/read-model.js", import.meta.url), "utf8");
const rpcSource = await readFile(new URL("../lib/rpc.js", import.meta.url), "utf8");
const migrationSource = await readFile(new URL("../../supabase/inventario-deltas-v1.sql", import.meta.url), "utf8");
const consistencyMigrationSource = await readFile(
  new URL("../../supabase/inventario-deltas-consistencia-v1.sql", import.meta.url),
  "utf8",
);

function sourceBetween(source, start, end, label) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `no se encontró el inicio de ${label}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `no se encontró el final de ${label}`);
  return source.slice(startIndex, endIndex);
}

test("H69 falla antes de cualquier DDL si H70 ya fue aplicado", () => {
  const advisoryLock = migrationSource.indexOf("pg_advisory_xact_lock");
  const marker = migrationSource.indexOf("20260719_70_inventario_delta_consistencia");
  const helper = migrationSource.indexOf("public._momos_inventory_events_page_v1(bigint,bigint,integer)");
  const message = migrationSource.indexOf("H69 no puede reaplicarse despues de H70.");
  const firstDdl = migrationSource.search(/^\s*(?:create|alter|drop)\b/im);

  assert.notEqual(advisoryLock, -1, "H69 debe adquirir el advisory lock antes del guard");
  assert.notEqual(firstDdl, -1, "la migracion H69 debe contener DDL");
  for (const [label, index] of [["marker H70", marker], ["helper H70", helper], ["mensaje fail-fast", message]]) {
    assert.equal(index > advisoryLock && index < firstDdl, true,
      `${label} debe evaluarse despues del lock y antes del primer CREATE/ALTER/DROP`);
  }
});

test("H70 publica un cursor global tagged safe-xmin y el bloque core atomico completo", () => {
  assert.match(consistencyMigrationSource, /4611686018427387904/,
    "el cursor bigint debe conservar el tag 2^62 sin pasar por Number");
  assert.match(consistencyMigrationSource, /pg_catalog\.pg_snapshot_xmin\(/);
  assert.match(consistencyMigrationSource, /producer_xid bigint not null/);
  assert.match(consistencyMigrationSource,
    /create or replace function public\.momos_inventory_deltas_since_v1\(\s*p_after_event_id bigint,\s*p_limit integer default 100/);
  assert.match(consistencyMigrationSource, /x\.producer_xid>=p_after_xid/);
  assert.match(consistencyMigrationSource, /x\.producer_xid<p_target_xid/);

  const coreSnapshot = sourceBetween(
    consistencyMigrationSource,
    "create or replace function public.momos_core_snapshot_v1()",
    "-- El manifiesto conserva su contrato H69",
    "momos_core_snapshot_v1 H70",
  );
  for (const field of [
    "inventory_items", "inventory_lots", "inventory_movements",
    "inventory_audit_logs", "inventory_latest_event_id",
  ]) assert.match(coreSnapshot, new RegExp(`'${field}'`));
  assert.match(coreSnapshot, /select id,fecha,tipo,item_id,cant,order_id,batch_id/);
  assert.match(coreSnapshot, /select id,fecha,entidad,entidad_id,accion[\s\S]*?where entidad='Inventario'/);
});

test("H70 falla cerrado ante una publicacion FOR ALL TABLES antes de crear el mapping xid", () => {
  const publicationCatalog = consistencyMigrationSource.indexOf("pg_catalog.pg_publication");
  const allTablesGuard = consistencyMigrationSource.indexOf("puballtables");
  const message = consistencyMigrationSource.indexOf(
    "H70 requiere publicaciones por lista; desactive FOR ALL TABLES antes de instalar el mapping xid privado.",
  );
  const mappingDdl = consistencyMigrationSource.indexOf(
    "create table if not exists public.inventory_sync_event_xids",
  );
  assert.notEqual(mappingDdl, -1);
  for (const [label, index] of [
    ["catalogo pg_publication", publicationCatalog],
    ["guard puballtables", allTablesGuard],
    ["mensaje fail-closed", message],
  ]) {
    assert.equal(index >= 0 && index < mappingDdl, true,
      `${label} debe ejecutarse antes de crear el mapping xid privado`);
  }
});

test("InventoryPanels aplica el camino feliz H69 sin refrescar snapshots", () => {
  assert.match(inventoryPanelSource, /function Inventario\(\{[^}]*aplicarDeltaInventario[^}]*\}\)/,
    "Inventario debe recibir el aplicador H69 desde MomosOps");

  const deltaCalls = [...inventoryPanelSource.matchAll(
    /await (entradaInsumoLoteDelta|movimientoInsumoDelta|desecharLoteInsumoDelta)\(/g,
  )];
  assert.equal(deltaCalls.length, 4,
    "entrada, movimiento y las dos rutas de merma deben usar sus RPC delta");
  assert.equal((inventoryPanelSource.match(
    /inventoryUpdateMode = await applyInventoryMutationOrReconcile\(/g,
  ) || []).length, 4, "cada RPC delta exitosa debe aplicar su sobre autoritativo");

  const applyHelper = sourceBetween(
    inventoryPanelSource,
    "async function applyInventoryMutationOrReconcile",
    "const detalleEstado",
    "applyInventoryMutationOrReconcile",
  );
  assert.match(applyHelper, /aplicarDeltaInventario\(response, mutationGeneration\)/);
  assert.match(applyHelper, /if \(result\?\.status === "discarded"\) \{[\s\S]*?solicitarConciliacionInventario\(\)[\s\S]*?return "reconciled";/,
    "una respuesta mutante vieja debe conciliar sin repetir la escritura");
  const happyPath = sourceBetween(applyHelper, "try {", "} catch (error) {", "camino feliz del delta");
  assert.doesNotMatch(happyPath, /refrescarSilencioso|refrescar\s*\(/,
    "un delta válido no debe volver a pedir Catálogos ni Operaciones");

  assert.equal((inventoryPanelSource.match(/if \(inventoryUpdateMode === "legacy"\)/g) || []).length, 2,
    "los refrescos posteriores de ambos formularios deben quedar limitados al modo legacy");
});

test("un delta malformado solo reconcilia y nunca repite la mutación", () => {
  const mutationRpc = sourceBetween(
    rpcSource,
    "async function inventoryMutationRpc",
    "export async function crearPedido",
    "inventoryMutationRpc",
  );
  assert.match(mutationRpc, /if \(error\) throw rpcError\(error\);\s*[\s\S]*?return data;/,
    "una mutación confirmada debe entregar la respuesta al validador local");
  assert.doesNotMatch(mutationRpc, /assertInventory|normalizeInventory|\.delta\b/,
    "la RPC no debe lanzar por el payload después de que el servidor pudo confirmar la escritura");

  const applyHelper = sourceBetween(
    inventoryPanelSource,
    "async function applyInventoryMutationOrReconcile",
    "const detalleEstado",
    "applyInventoryMutationOrReconcile",
  );
  assert.match(applyHelper, /catch \(error\) \{[\s\S]*?solicitarConciliacionInventario[\s\S]*?return "reconciled";/,
    "el fallo de validación debe cerrar con una lectura de reconciliación");
  assert.equal((applyHelper.match(/aplicarDeltaInventario\(/g) || []).length, 1,
    "el mismo sobre malformado no debe aplicarse por segunda vez");
  assert.doesNotMatch(
    applyHelper,
    /(?:entradaInsumoLote|movimientoInsumo|desecharLoteInsumo)(?:Delta)?\s*\(/,
    "reconciliar nunca debe repetir una RPC de escritura",
  );
});

test("el fallback legacy se usa únicamente cuando falta la RPC H69", () => {
  const deltaCallCount = (inventoryPanelSource.match(
    /await (?:entradaInsumoLoteDelta|movimientoInsumoDelta|desecharLoteInsumoDelta)\(/g,
  ) || []).length;
  const missingGuardCount = (inventoryPanelSource.match(
    /if \(!isMissingRpcError\(error\)\) throw error;/g,
  ) || []).length;
  assert.equal(missingGuardCount, deltaCallCount,
    "cada posible degradación a la RPC anterior debe estar protegida por isMissingRpcError");

  const guardedFallbacks = [...inventoryPanelSource.matchAll(
    /catch \(error\) \{\s*if \(!isMissingRpcError\(error\)\) throw error;\s*mutationIntentKeysRef\.current\.delete\(intent\.fingerprint\);\s*await (entradaInsumoLote|movimientoInsumo|desecharLoteInsumo)\(/g,
  )];
  assert.equal(guardedFallbacks.length, deltaCallCount,
    "ningún fallback legacy puede capturar errores transitorios, de permisos o de contrato");

  const missingRpcClassifier = sourceBetween(
    rpcSource,
    "export function isMissingRpcError",
    "export function createInventoryIdempotencyKey",
    "isMissingRpcError",
  );
  assert.match(missingRpcClassifier, /error\?\.code === "PGRST202"/);
  assert.match(missingRpcClassifier, /could not find[\s\S]*schema cache[\s\S]*does not exist/i);
  assert.doesNotMatch(missingRpcClassifier, /timeout|timed.out|network|transient|5\d\d/i,
    "un fallo recuperable del servidor no demuestra que la RPC no exista");
  assert.match(rpcSource, /if \(error\?\.code\) next\.code = error\.code;/,
    "el clasificador necesita que la capa RPC preserve el código original");
});

test("MomosOps aplica deltas directamente sin update global ni persistencia local", () => {
  const directApply = sourceBetween(
    mainSource,
    "function aplicarSobresInventario",
    "async function resetear",
    "aplicadores H69",
  );
  assert.match(directApply, /applyInventoryMutationEnvelope\(nextDb, envelope, nextVersions, options\)/);
  assert.match(directApply, /dbRef\.current = nextDb;\s*setDb\(nextDb\);/,
    "el commit React debe publicar el delta ya validado de forma directa");
  assert.match(directApply, /function aplicarDeltaInventario\(envelope, expectedGeneration = capturarGeneracionInventario\(\)\) \{\s*return aplicarSobresInventario\(\[envelope\], expectedGeneration\);/);
  assert.doesNotMatch(directApply, /\bupdate\s*\(|\bdbPersist\s*\(/,
    "los datos derivados del servidor no deben disparar el guardado global");
  assert.doesNotMatch(directApply, /hidratarDesdeServidor|refetchFocoRef/,
    "aplicar un delta válido no debe degradarse a un snapshot completo");
  assert.match(mainSource, /db, update, user, refrescar: refrescarVistaActual, aplicarDeltaInventario/,
    "MomosOps debe cablear el aplicador directo al panel de Inventario");
});

test("Realtime H69 usa su outbox y excluye las cuatro tablas crudas", () => {
  const tableSetup = sourceBetween(
    mainSource,
    "const inventoryDeltaRealtime",
    "let channel =",
    "tablas Realtime H69",
  );
  assert.match(tableSetup, /db\.inventoryMutationDeltaReady === true/,
    "el rollout solo puede activar el outbox con capability explícita");
  assert.match(tableSetup, /db\.inventoryMutationFullSnapshotRequired === false/);
  assert.match(tableSetup, /inventoryFullSnapshotRequiredRef\.current === false/,
    "el camino incremental debe fallar cerrado hasta aceptar un core completo");
  assert.match(tableSetup, /if \(inventoryDeltaRealtime\) tables\.push\("inventory_sync_events"\)/);

  const legacyOnlyExpressions = [...tableSetup.matchAll(
    /\.\.\.\(inventoryDeltaRealtime \? \[\] : \[([^\]]+)\]\)/g,
  )];
  const legacyOnlyTables = legacyOnlyExpressions.flatMap((match) => (
    [...match[1].matchAll(/"([a-z][a-z0-9_]+)"/g)].map((name) => name[1])
  ));
  assert.deepEqual(new Set(legacyOnlyTables), new Set([
    "inventory_items", "inventory_lots", "inventory_movements", "audit_logs",
  ]), "las fuentes crudas de Inventario deben existir únicamente en la rama pre-H69");

  const h69TableSetup = tableSetup.replace(
    /\.\.\.\(inventoryDeltaRealtime \? \[\] : \[[^\]]+\]\)/g,
    "",
  );
  for (const table of ["inventory_items", "inventory_lots", "inventory_movements", "audit_logs"]) {
    assert.doesNotMatch(h69TableSetup, new RegExp(`"${table}"`),
      `${table} no debe quedar como suscripción cruda cuando H69 está listo`);
  }
  assert.match(mainSource, /if \(table === "inventory_sync_events"\) \{\s*queueInventoryDelta\(payload\);\s*return;/,
    "el outbox debe alimentar la cola dirigida, no el refresco de dominios");
  assert.match(mainSource, /Boolean\(db\?\.inventoryMutationDeltaReady\)/,
    "un cambio de capability debe reconstruir la suscripción");
});

test("el handshake cierra gaps con momos_inventory_deltas_since_v1 y batches dirigidos completos", () => {
  const inventoryReaders = sourceBetween(
    readModelSource,
    "export async function fetchInventoryDeltas",
    "export async function fetchUserProfile",
    "lecturas H69",
  );
  assert.match(inventoryReaders, /supabase\.rpc\("momos_inventory_deltas_v1", \{ p_item_ids: ids \}\)/);
  assert.match(inventoryReaders, /supabase\.rpc\("momos_inventory_deltas_since_v1", \{/);
  assert.match(inventoryReaders, /p_after_event_id: version \|\| "0"[\s\S]*p_limit:/);

  const realtimeDeltaFlow = sourceBetween(
    mainSource,
    "const fetchAndApplyInventoryItems",
    "tables.forEach",
    "conciliación Realtime H69",
  );
  assert.match(realtimeDeltaFlow,
    /for \(let offset = 0; offset < itemIds\.length; offset \+= 50\)[\s\S]*?readGeneration = capturarGeneracionInventario\(\)[\s\S]*?fetchInventoryDeltas\(itemIds\.slice\(offset, offset \+ 50\)\)[\s\S]*?aplicarBatchInventario\(envelope, readGeneration\)/,
    "ningún ID puede perderse cuando una página o debounce supera 50 insumos");
  assert.equal((realtimeDeltaFlow.match(/fetchAndApplyInventoryItems\(/g) || []).length, 2,
    "el helper debe ser usado tanto por el debounce como por el handshake");
  assert.match(realtimeDeltaFlow,
    /fetchInventoryDeltasSince\(cursor, 100\)[\s\S]*?normalizeInventoryEventsEnvelope\(rawEvents\)[\s\S]*?fetchAndApplyInventoryItems\(events\.itemIds\)/,
    "el handshake debe convertir el gap en IDs antes de pedir estados dirigidos");
  assert.match(realtimeDeltaFlow,
    /if \(events\.resetRequired\) \{\s*exigirSnapshotCompletoInventario\("inventory_cursor_reset"\);\s*throw new Error/,
    "un cursor adelantado debe invalidarse sin adoptar latest antes del snapshot");
  assert.match(realtimeDeltaFlow, /if \(!events\.overflow\)[\s\S]*?events\.latestEventId/,
    "el cursor solo puede cerrarse por completo al terminar la paginación");
  assert.match(mainSource,
    /if \(inventoryDeltaRealtime && dbRef\.current\?\.inventoryMutationDeltaReady === true\) \{\s*requestInventoryReconciliation\(\);/,
    "SUBSCRIBED debe cerrar la ventana entre snapshot y suscripción");

  const batchApply = sourceBetween(
    mainSource,
    "function aplicarBatchInventario",
    "function avanzarCursorInventario",
    "aplicación de batch H69",
  );
  assert.match(batchApply, /normalizeInventoryDeltaBatch\(envelope\)/,
    "el batch dirigido debe validarse completo antes del commit React");
});

test("un batch dirigido nunca adelanta el cursor global con eventos de otros insumos", () => {
  const applier = sourceBetween(
    mainSource,
    "function aplicarSobresInventario",
    "function aplicarDeltaInventario",
    "aplicador por ítem H69",
  );
  assert.match(applier, /inventoryMutationVersionsRef\.current = nextVersions/);
  assert.doesNotMatch(applier, /inventoryMutationLatestEventRef|inventoryMutationEventVersion|sourceVersion|mayorVersionInventario/,
    "aplicar un estado dirigido solo puede avanzar la versión monotónica del insumo");

  const body = sourceBetween(
    mainSource,
    "function aplicarBatchInventario",
    "function avanzarCursorInventario",
    "batch dirigido H69",
  );
  assert.match(body, /normalizeInventoryDeltaBatch\(envelope\)/);
  assert.match(body, /aplicarSobresInventario\(envelope\.items, expectedGeneration, \{\s*authoritativeOnEqual: true/,
    "una lectura dirigida debe reemplazar el estado combinado aun si conserva sourceVersion");
  assert.doesNotMatch(body, /normalized\.latestEventId/);

  const handshake = sourceBetween(
    mainSource,
    "const reconcileInventoryGap",
    "tables.forEach",
    "handshake paginado H69",
  );
  assert.match(handshake, /await fetchAndApplyInventoryItems\(events\.itemIds\)/);
  assert.match(handshake, /if \(!applied\.ok\) return false/);
  assert.match(handshake, /applied\.generation !== capturarGeneracionInventario\(\)/,
    "el cursor no avanza si otro snapshot o delta se aplicó durante la página");
  assert.match(handshake, /avanzarCursorInventario\(events\.nextEventId \|\| events\.latestEventId\)/);
});

test("H70 protege snapshot, fetch delta y mutación con una generación monotónica", () => {
  assert.match(mainSource, /const inventorySyncGenerationRef = useRef\(0\)/);
  assert.match(mainSource,
    /\[SYNC_DOMAINS\.CATALOGS\]: async \(\) => \{\s*const inventoryReadGeneration = capturarGeneracionInventario\(\)[\s\S]*?__inventoryReadGeneration: inventoryReadGeneration/,
    "CATALOGS debe capturar la generación antes de iniciar la lectura");

  const snapshotApply = sourceBetween(
    mainSource,
    "async function aplicarDominiosServidor",
    "function hidratarDesdeServidor",
    "apply snapshot H70",
  );
  assert.match(snapshotApply, /inventoryProtectedCatalogCanApply\(cat, currentGeneration\)/);
  assert.match(snapshotApply, /if \(snapshotIsCurrent\) \{[\s\S]*?d\.inventory_items = cat\.inventory_items/);
  assert.match(snapshotApply, /inventorySnapshotDiscarded = true/);
  assert.match(snapshotApply,
    /if \(inventorySnapshotApplied\) \{\s*inventorySyncGenerationRef\.current \+= 1;\s*inventorySnapshotRevisionRef\.current \+= 1/);
  assert.match(snapshotApply, /if \(inventorySnapshotDiscarded\) \{\s*solicitarConciliacionInventario\(\)/);
  assert.match(snapshotApply,
    /d\.inventory_movements = cat\.inventorySnapshotMovements[\s\S]*?mergeInventoryAuditSnapshot\(d\.audit_logs, cat\.inventorySnapshotAudits\)[\s\S]*?d\.inventoryMutationEventVersion = protectedSnapshotCursor[\s\S]*?inventoryMutationVersionsRef\.current = \{\}[\s\S]*?inventoryMutationLatestEventRef\.current = protectedSnapshotCursor/,
    "un snapshot aceptado debe reiniciar cursor y versiones exactamente al boundary");

  const applier = sourceBetween(
    mainSource,
    "function aplicarSobresInventario",
    "function avanzarCursorInventario",
    "guards de aplicación H70",
  );
  assert.match(applier, /inventoryDeltaCanApply\(\{/);
  assert.match(applier, /fullSnapshotRequired: inventoryFullSnapshotRequiredRef\.current/);
  assert.match(applier, /status: "discarded"/);
  assert.match(applier, /inventorySyncGenerationRef\.current \+= 1/);

  const mutations = [...inventoryPanelSource.matchAll(
    /const mutationGeneration = capturarGeneracionInventario\(\);\s*const response = await (entradaInsumoLoteDelta|movimientoInsumoDelta|desecharLoteInsumoDelta)\(/g,
  )];
  assert.equal(mutations.length, 4,
    "cada RPC mutante debe capturar la generación antes de escribir");
  assert.equal((inventoryPanelSource.match(/mutationGeneration,\s*\);/g) || []).length, 4,
    "cada respuesta mutante debe validarse contra su generación de inicio");
});

test("fullSnapshotRequired persiste y solo se limpia dentro de un core completo aceptado", () => {
  assert.match(mainSource, /const inventoryFullSnapshotRequiredRef = useRef\(true\)/);
  assert.equal((mainSource.match(/inventoryFullSnapshotRequiredRef\.current = false/g) || []).length, 1,
    "ningún delta, gap o cambio de vista puede levantar el bloqueo");
  const snapshotApply = sourceBetween(
    mainSource,
    "async function aplicarDominiosServidor",
    "function hidratarDesdeServidor",
    "aceptación de core H70",
  );
  assert.match(snapshotApply,
    /inventoryProtectedCatalogCanApply\(cat, currentGeneration\)[\s\S]*?if \(snapshotIsCurrent\)[\s\S]*?if \(protectedInventorySnapshot\)[\s\S]*?inventoryFullSnapshotRequiredRef\.current = false/);
  assert.match(snapshotApply,
    /else \{[\s\S]*?d\.inventoryMutationEventVersion = "";[\s\S]*?d\.inventoryMutationFullSnapshotRequired = true;[\s\S]*?inventoryMutationLatestEventRef\.current = "";[\s\S]*?inventoryFullSnapshotRequiredRef\.current = true/,
    "una lectura legacy puede degradar a snapshots crudos, pero no conservar un boundary H70");

  const reset = sourceBetween(
    mainSource,
    "function exigirSnapshotCompletoInventario",
    "async function resetear",
    "reset seguro H70",
  );
  assert.match(reset, /inventoryFullSnapshotRequiredRef\.current = true/);
  assert.match(reset, /inventoryMutationLatestEventRef\.current = ""/);
  assert.doesNotMatch(reset, /latestEventId|sourceVersion|event_id/,
    "reset no puede aceptar ningún token proveniente del gap o del delta");
  assert.match(mainSource, /inventoryMutationFullSnapshotRequired: true/,
    "el bloqueo debe sobrevivir también en el estado React/local");
});

test("los pendientes Realtime sobreviven cleanup y cambios de vista sin mezclar dominios de version", () => {
  const realtimeFlow = sourceBetween(
    mainSource,
    "const fallbackInventorySnapshots",
    "tables.forEach",
    "cola Realtime durable H70",
  );
  assert.match(realtimeFlow, /enqueueInventoryRealtimeItem\(inventoryRealtimePendingRef\.current, itemId\)/);
  assert.match(realtimeFlow,
    /snapshotRevision = inventorySnapshotRevisionRef\.current[\s\S]*?return inventorySnapshotRevisionRef\.current > snapshotRevision/,
    "un fallback solo puede confirmar pendientes si CATALOGS acepto un snapshot durante esa lectura");
  assert.doesNotMatch(realtimeFlow, /payload\?\.new\?\.event_id|compareAgencySnapshotVersions/,
    "event_id del outbox solo despierta el item y nunca se compara con el cursor/source");
  assert.match(realtimeFlow,
    /if \(inventoryDeltaRealtime && inventoryRealtimePendingRef\.current\.size\)[\s\S]*?flushInventoryDeltas\(\)[\s\S]*?else if \(dbRef\.current\?\.inventoryMutationDeltaReady === true[\s\S]*?fallbackInventorySnapshots\(\)/,
    "un nuevo efecto debe retomar pendientes tanto dentro como fuera de Inventario");

  const cleanup = sourceBetween(
    mainSource,
    "return () => {\n      alive = false;",
    "  }, [session?.user?.id",
    "cleanup de Realtime H70",
  );
  assert.doesNotMatch(cleanup, /inventoryRealtimePendingRef\.current\.clear|\.delete\(/,
    "el teardown del canal no puede borrar trabajo observado pero no conciliado");
});

test("OPERATIONS nunca pisa el historial atomico de Inventario cuando H70 esta activo", () => {
  const snapshotApply = sourceBetween(
    mainSource,
    "async function aplicarDominiosServidor",
    "function hidratarDesdeServidor",
    "propiedad del historial H70",
  );
  const operations = sourceBetween(
    snapshotApply,
    "if (op) {",
    "} // orders, order_items",
    "apply OPERATIONS H70",
  );
  assert.match(operations, /if \(protectedOperations\)/);
  assert.match(operations, /const \{ inventory_movements, audit_logs, \.\.\.safeOperations \} = operationData/);
  assert.match(operations, /currentInventoryAudits[\s\S]*?mergeInventoryAuditSnapshot\(audit_logs, currentInventoryAudits\)/);
  assert.doesNotMatch(operations, /Object\.assign\(d, operationData\)[\s\S]*?protectedOperations/,
    "la rama protegida no debe publicar las colecciones crudas de OPERATIONS");
});

test("frontend y manifiesto comparten un único contrato de capability H69", () => {
  const capability = sourceBetween(
    readModelSource,
    "async function inventoryDeltasCapability",
    "export async function fetchInventoryDeltas",
    "capability H69",
  );
  assert.match(capability, /const manifest = await fetchSyncManifest\(\)/);
  assert.match(capability, /manifest\?\.capabilities\?\.inventario_deltas_disponibles === true/);
  assert.match(capability, /normalizeInventoryCursorToken\(manifest\?\.inventory_latest_event_id\)/);
  assert.doesNotMatch(capability, /supabase\.rpc|capabilityResult/,
    "H69 no debe agregar una sonda aparte del manifiesto único");

  assert.match(readModelSource, /inventoryCoreSnapshotReady = inventoryCoreSnapshotBlockIsComplete\(coreSnapshot\)/);
  assert.match(readModelSource, /atomicInventoryBoundary = normalizeInventoryCursorToken\(coreSnapshot\?\.inventory_latest_event_id\)/);
  assert.match(readModelSource, /inventoryDeltaReady = inventoryDeltaCapability\.ready\s*&& inventoryCoreSnapshotReady/);
  assert.match(readModelSource, /inventoryMutationDeltaReady: inventoryDeltaReady/);
  assert.match(readModelSource, /inventoryMutationEventVersion: inventoryDeltaReady \? atomicInventoryBoundary : ""/);
  assert.doesNotMatch(readModelSource,
    /inventoryMutationEventVersion:\s*inventoryDeltaCapability\.latestEventId/,
    "el manifiesto cacheado no puede habilitar deltas sin boundary MVCC");
  assert.match(mainSource, /d\.inventoryMutationDeltaReady = Boolean\(cat\.inventoryMutationDeltaReady\)/);
  assert.match(mainSource,
    /d\.inventoryMutationEventVersion = protectedSnapshotCursor/,
    "el snapshot debe adoptar exactamente su boundary atómico");
  assert.match(mainSource,
    /function exigirSnapshotCompletoInventario\([\s\S]*?inventoryMutationLatestEventRef\.current = "";[\s\S]*?inventoryMutationEventVersion: ""[\s\S]*?inventoryMutationFullSnapshotRequired: true/,
    "un reset debe borrar el cursor y exigir un core, nunca adoptar latest por adelantado");

  assert.match(migrationSource, /'inventario_deltas_disponibles'/);
  assert.match(migrationSource, /to_regprocedure\('public\.momos_inventory_deltas_v1\(text\[\]\)'\) is not null/);
  assert.match(migrationSource, /to_regprocedure\('public\.momos_inventory_deltas_since_v1\(bigint,integer\)'\) is not null/);
  assert.match(migrationSource, /'inventory_latest_event_id',v_inventory_event_id::text/,
    "el cursor bigint debe viajar como string seguro para JavaScript");
  assert.match(migrationSource, /'contains_pii',false/);
  assert.match(migrationSource, /'contains_secrets',false/);
  assert.match(migrationSource, /'external_execution',false/);
});
