import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../features/agency/AgencyPanel.jsx", import.meta.url), "utf8");
const studio = readFileSync(new URL("../features/agency/AgencyBrandStudio.jsx", import.meta.url), "utf8");

test("el siguiente paso creativo usa el enrutador visible y nunca un scroll opcional silencioso", () => {
  assert.match(panel, /function openAgencyTarget\(target = ""\)/);
  assert.match(panel, /onOpenTarget=\{openAgencyTarget\}/);
  assert.match(panel, /if \(!onOpenTarget\?\.\(target\)\) toast\("error"/);
  assert.doesNotMatch(panel, /document\.getElementById\(flight\.nextTarget\)\?\./);
});

test("el Centro humano comparte la misma continuidad de rutas", () => {
  assert.match(panel, /AgencyActionCenter\(\{ db, go, refrescar, onOpenTarget \}\)/);
  assert.match(panel, /onOpenTarget=\{openAgencyTarget\}/);
  assert.match(panel, /Recorrido principal de Agencia MOMOS/);
});

test("el Centro creativo muestra recorrido y creación guiada por divulgación progresiva", () => {
  assert.match(studio, /Centro creativo MOMOS/);
  assert.match(studio, /Pasos para preparar un trabajo creativo/);
  assert.match(studio, /studioStep === "encargo"/);
  assert.match(studio, /studioStep === "fuentes"/);
  assert.match(studio, /studioStep === "revisar"/);
  assert.match(studio, /setSection\("Producción"\)/);
});
