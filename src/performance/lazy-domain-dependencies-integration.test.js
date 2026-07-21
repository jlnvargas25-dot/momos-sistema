import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");
const backoffice = readFileSync(new URL("../features/backoffice/BusinessPanels.jsx", import.meta.url), "utf8");
const intelligence = readFileSync(new URL("../lib/agency-intelligence.js", import.meta.url), "utf8");
const settings = readFileSync(new URL("../lib/agency-settings.js", import.meta.url), "utf8");

const deferredModules = [
  "customer-crm",
  "commercial-calendar",
  "commercial-distribution",
  "commercial-dispatch",
  "operational-history",
];

test("H89 mantiene fuera del arranque los motores exclusivos de Backoffice", () => {
  for (const moduleName of deferredModules) {
    assert.doesNotMatch(app, new RegExp(`from [\"']\\./lib/${moduleName}`));
    assert.match(backoffice, new RegExp(`from [\"']\\.\\./\\.\\./lib/${moduleName}\\.js[\"']`));
  }
  assert.match(app, /lazy\(\(\) => import\("\.\/features\/backoffice\/BusinessPanels\.jsx"\)/);
});

test("H89 hidrata solo la configuración mínima de Agencia durante el arranque", () => {
  assert.match(app, /from "\.\/lib\/agency-settings"/);
  assert.doesNotMatch(app, /from "\.\/lib\/agency-intelligence"/);
  assert.match(intelligence, /from "\.\/agency-settings\.js"/);
  assert.match(settings, /Object\.freeze/);
  assert.doesNotMatch(settings, /agency-operational-facts|buildAgencyIntelligence|supabase/);
});
