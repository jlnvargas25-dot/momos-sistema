import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../features/production/ProductionPanel.jsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../features/inventory/InternalPreparationSheetEditor.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const rpc = readFileSync(new URL("../lib/rpc.js", import.meta.url), "utf8");
const readModel = readFileSync(new URL("../lib/read-model.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/gestion-fichas-tecnicas-cocina-v1.sql", import.meta.url), "utf8");

test("H86 mantiene borrador y publicación como decisiones humanas separadas", () => {
  assert.match(panel, /InternalPreparationSheetEditor/);
  assert.match(editor, /Guardar para revisión/);
  assert.match(editor, /Publicar para Cocina/);
  assert.match(editor, /Esperando aprobación de Administración/);
  assert.match(editor, /Restaurar vigente/);
  assert.match(rpc, /guardar_ficha_tecnica_cocina/);
  assert.match(rpc, /activar_ficha_tecnica_cocina/);
  assert.match(migration, /Solo Administrador puede publicar una ficha técnica/);
  assert.match(migration, /ACTIVAR FICHA/);
});

test("H86 carga historial bajo demanda y despierta Producción con un cursor compacto", () => {
  assert.match(editor, /listarFichasIntegralesElaboracion/);
  assert.match(editor, /useEffect\(\(\) => \{ loadHistory\(\); \}, \[subrecipe\.id, db\.kitchenProcedureSyncVersion\]\)/);
  assert.match(readModel, /kitchenProcedureSyncVersion/);
  assert.match(app, /kitchen_procedure_sync_state/);
  assert.match(app, /refresh\(SYNC_DOMAINS\.CATALOGS\)/);
  assert.match(migration, /create table if not exists public\.kitchen_procedure_sync_state/);
  assert.doesNotMatch(migration, /kitchen_procedure_sync_state\([\s\S]{0,250}\b(?:email|actor|note|steps|recipe)\b/i);
});

test("H86 conserva el contenido versionado y expone solo historial sanitizado", () => {
  assert.match(migration, /El contenido versionado[\s\S]{0,30}permanece inmutable/);
  assert.match(migration, /Cocina solo puede archivar sus propios borradores/);
  assert.match(migration, /limit 50/);
  assert.doesNotMatch(migration, /'createdBy'|'approvedBy'|'email'/);
});
