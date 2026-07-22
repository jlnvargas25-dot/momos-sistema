import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const panels = readFileSync(new URL("../features/backoffice/BusinessPanels.jsx", import.meta.url), "utf8");

const panelNames = [
  "Dashboard", "HistorialOperativo", "Productos", "Domicilios", "Reclamos", "Clientes",
  "Beneficios", "Reportes", "Configuracion", "Marketing", "Creativos", "Calendario",
  "ResultadosCreativos",
];

test("H78 saca los paneles de negocio del paquete inicial", () => {
  assert.match(app, /lazy\(\(\) => import\("\.\/features\/backoffice\/BusinessPanels\.jsx"\)/);
  assert.match(app, /module\.createBusinessPanels\(getBusinessPanelsShared\(\)\)/);
  assert.doesNotMatch(app, /function\s+(?:Dashboard|Productos|Clientes|Configuracion)\s*\(/);
  assert.ok(app.split(/\r?\n/).length <= 5000, "MomosOps.jsx volvió a superar 5.000 líneas");
});

test("H78 conserva todos los paneles extraídos bajo un contrato cerrado", () => {
  assert.match(panels, /export function createBusinessPanels\(shared\)/);
  for (const name of panelNames) {
    assert.match(panels, new RegExp(`function ${name}\\b`));
    assert.match(panels, new RegExp(`\\b${name},`));
  }
  assert.match(panels, /Panel diferido desconocido/);
  assert.doesNotMatch(panels, /from\s+["']\.\.\/\.\.\/MomosOps/);
});

test("H83 inyecta el catalogo de roles que Configuracion renderiza", () => {
  assert.match(app, /function getBusinessPanelsShared\(\)[\s\S]+PERMISOS_POR_ROL, ROLES, SABORES/);
  assert.match(panels, /PERMISOS_POR_ROL, ROLES, SABORES/);
  assert.match(panels, /<MiniSelect options=\{ROLES\}/);
});

test("H78 espera el panel real antes de cerrar la navegación", () => {
  assert.match(app, /<Suspense fallback=\{<BusinessPanelFallback \/>\}>[\s\S]+<PanelReadySignal routeId=\{performanceRouteId\}/);
  for (const view of ["Dashboard", "Productos", "Domicilios", "Reclamos", "Clientes", "Beneficios", "Marketing", "Creativos", "Calendario", "Resultados", "Reportes", "Configuración"]) {
    assert.match(app, new RegExp(`LAZY_PERFORMANCE_VIEWS[^;]+["']${view}["']`));
  }
});

test("H78 expone solo telemetría técnica agregada para el E2E", () => {
  const telemetry = readFileSync(new URL("./runtime-telemetry.js", import.meta.url), "utf8");
  assert.match(telemetry, /data-momos-perf/);
  assert.match(app, /data-momos-sync/);
  assert.doesNotMatch(telemetry, /(?:customer|telefono|direcci[oó]n|nota|payload|query|url)\s*:/i);
});
