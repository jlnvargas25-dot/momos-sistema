import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = await Promise.all([
  readFile(new URL("../../supabase/historial-operativo-paginado-v1.sql", import.meta.url), "utf8"),
  readFile(new URL("../lib/read-model.js", import.meta.url), "utf8"),
  readFile(new URL("../features/backoffice/BusinessPanels.jsx", import.meta.url), "utf8"),
  readFile(new URL("../../supabase/tests/test-migraciones-ordenadas.sql", import.meta.url), "utf8"),
]);
const [migration, readModel, panels, ordered] = files;

test("H79 pagina y filtra el historial dentro de un contrato cerrado", () => {
  assert.match(migration, /momos_history_page_v2\(/);
  assert.match(migration, /limit v_limit\+1/);
  assert.match(migration, /audit_logs_history_recent_idx/);
  assert.match(migration, /audit_logs_history_area_recent_idx/);
  assert.match(migration, /contains_customer_pii',false/);
  assert.match(migration, /revoke all on function public\.momos_history_page_v2[\s\S]+from public,anon,service_role/);
});

test("H79 envía filtros al servidor y no degrada una búsqueda a páginas locales", () => {
  assert.match(readModel, /momos_history_page_v2/);
  assert.match(readModel, /p_query: normalized\.query/);
  assert.match(readModel, /p_area: normalized\.area/);
  assert.match(readModel, /if \(missing && filtered\) throw new Error/);
  assert.match(readModel, /El historial H79 no cumple su contrato protegido/);
});

test("H79 descarta respuestas tardías y pagina cincuenta filas por interacción", () => {
  assert.match(panels, /const requestId = \+\+filterRequestRef\.current/);
  assert.match(panels, /requestId !== filterRequestRef\.current/);
  assert.match(panels, /setTimeout\(async \(\) => \{/);
  assert.match(panels, /fetchOperationalHistoryPage\(filteredCursor, 50, serverFilters\)/);
  assert.match(panels, /new Map\(\[\.\.\.rows, \.\.\.page\.rows\]/);
  assert.match(panels, /"Inventario terminado"/);
  assert.match(panels, /"Finanzas"/);
});

test("la cadena ordenada instala H79 después del cierre físico H78", () => {
  assert.ok(ordered.indexOf("20260719_78_produccion_estados_fisicos") < ordered.indexOf("20260719_79_historial_operativo_paginado"));
  assert.match(ordered, /migraciones ordenadas 01-83 PASS/);
});
