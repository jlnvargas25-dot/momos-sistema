import test from "node:test";
import assert from "node:assert/strict";
import { buildPackingGuide } from "./packing-workflow.js";

const progress = (overrides = {}) => ({
  verified: false,
  hasOpenPhoto: false,
  hasSealPhoto: false,
  readyToPack: false,
  ...overrides,
});

test("guía Empaque comienza por la comparación exacta de la comanda", () => {
  const guide = buildPackingGuide({ orderStatus: "Listo para empaque", progress: progress() });
  assert.equal(guide.completed, 1);
  assert.equal(guide.current.key, "verify");
  assert.match(guide.nextAction, /una por una/i);
});

test("guía respeta la secuencia verificación, caja abierta y sello", () => {
  const open = buildPackingGuide({ orderStatus: "Listo para empaque", progress: progress({ verified: true }) });
  assert.equal(open.current.key, "open-photo");

  const seal = buildPackingGuide({ orderStatus: "Listo para empaque", progress: progress({ verified: true, hasOpenPhoto: true }) });
  assert.equal(seal.current.key, "seal-photo");

  const packed = buildPackingGuide({ orderStatus: "Listo para empaque", progress: progress({ verified: true, hasOpenPhoto: true, hasSealPhoto: true, readyToPack: true }) });
  assert.equal(packed.current.key, "pack");
  assert.match(packed.nextAction, /confirmá.*Empacado/i);
});

test("después de empacar guía etiqueta y relevo físico sin saltarlo", () => {
  const ready = progress({ verified: true, hasOpenPhoto: true, hasSealPhoto: true, readyToPack: true });
  const packed = buildPackingGuide({ orderStatus: "Empacado", progress: ready });
  assert.equal(packed.current.key, "handoff");
  assert.match(packed.nextAction, /dirección/i);

  const offered = buildPackingGuide({ orderStatus: "Listo para despacho", progress: ready, handoff: { status: "Ofrecido" } });
  assert.equal(offered.current.key, "handoff");
  assert.match(offered.nextAction, /Logística debe/i);
});

test("solo cierra la guía cuando Logística aceptó el relevo", () => {
  const ready = progress({ verified: true, hasOpenPhoto: true, hasSealPhoto: true, readyToPack: true });
  assert.equal(buildPackingGuide({ orderStatus: "Listo para despacho", progress: ready }).complete, false);
  const complete = buildPackingGuide({ orderStatus: "Listo para despacho", progress: ready, handoff: { status: "Aceptado" } });
  assert.equal(complete.complete, true);
  assert.equal(complete.completed, 6);
});
