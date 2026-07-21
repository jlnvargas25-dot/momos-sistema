import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../MomosOps.jsx", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `No se encontrÃ³ el bloque ${name}.`);
  return source.slice(start, end);
}

test("H88 publica deltas dirigidos sin clonar ni normalizar todo MOMO OPS", () => {
  const blocks = [
    functionSource("aplicarDeltaCatalogoProductos", "aplicarDeltaClienteCrm"),
    functionSource("aplicarDeltaClienteCrm", "aplicarMutacionCatalogoCrm"),
    functionSource("aplicarDeltaPedido", "aplicarMutacionDomicilio"),
    functionSource("aplicarDeltaProductoTerminado", "solicitarConciliacionProductoTerminado"),
    functionSource("aplicarActividadProduccion", "capturarContextoMutacionProduccion"),
  ];
  blocks.forEach((block) => {
    assert.doesNotMatch(block, /\bupdate\s*\(/);
    assert.doesNotMatch(block, /normalizeDbShape\s*\(/);
    assert.match(block, /publicarDeltaServidor\s*\(/);
  });
});

test("H88 mantiene separado el camino profundo para snapshots completos", () => {
  const publisher = functionSource("publicarDeltaServidor", "capturarGeneracionInventario");
  assert.doesNotMatch(publisher, /cloneDb|structuredClone|dbPersist|normalizeDbShape/);
  assert.match(publisher, /dbRef\.current\s*=\s*next/);
  assert.match(publisher, /setDb\(next\)/);
  const snapshot = functionSource("aplicarDominiosServidor", "hidratarDesdeServidor");
  assert.match(snapshot, /normalizeDbShape\(d\)/);
});
