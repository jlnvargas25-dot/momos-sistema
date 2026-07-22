import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const readModel = fs.readFileSync(new URL("../lib/read-model.js", import.meta.url), "utf8");
const backoffice = fs.readFileSync(new URL("../features/backoffice/BusinessPanels.jsx", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");

test("Domicilios carga validación y sincronización únicamente cuando se usan", () => {
  assert.doesNotMatch(app, /^import .*delivery-(?:sync|mutation)/m);
  assert.doesNotMatch(readModel, /^import .*delivery-sync/m);
  assert.match(app, /await import\("\.\/lib\/delivery-sync"\)/);
  assert.match(app, /await import\("\.\/lib\/delivery-mutation"\)/);
  assert.match(readModel, /await import\("\.\/delivery-sync\.js"\)/);
  assert.match(backoffice, /await aplicarMutacionDomicilio\(envelope, operation, generation\)/);
});

test("Catálogo y CRM conservan solo la comparación de versiones en el arranque", () => {
  assert.match(app, /from "\.\/lib\/catalog-crm-version"/);
  assert.doesNotMatch(app, /^import .*catalog-crm-delta/m);
  assert.doesNotMatch(readModel, /^import .*catalog-crm-delta/m);
  assert.match(app, /await import\("\.\/lib\/catalog-crm-delta"\)/);
  assert.match(readModel, /await import\("\.\/catalog-crm-delta\.js"\)/);
  assert.match(backoffice, /await aplicarMutacionCatalogoCrm\(envelope, operation, context\)/);
});

test("el presupuesto de producción bloquea excesos y conserva un reporte informativo", () => {
  assert.match(packageJson.scripts["perf:budget"], /--enforce/);
  assert.doesNotMatch(packageJson.scripts["perf:budget:report"], /--enforce/);
});

test("las fuentes empiezan desde HTML y no esperan a que React inyecte un import", () => {
  assert.doesNotMatch(app, /@import url\(['"]https:\/\/fonts\.googleapis\.com/);
  assert.match(html, /rel="preconnect" href="https:\/\/fonts\.googleapis\.com"/);
  assert.match(html, /fonts\.googleapis\.com\/css2[^\n]+rel="stylesheet"/);
});
