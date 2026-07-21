import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const migration = readFileSync(
  resolve(root, "supabase/dominio-productos-figuras-canonico-v1.sql"),
  "utf8",
);
const adversarial = readFileSync(
  resolve(root, "supabase/tests/test-dominio-productos-figuras-canonico-v1.sql"),
  "utf8",
);
const ordered = readFileSync(
  resolve(root, "supabase/tests/test-migraciones-ordenadas.sql"),
  "utf8",
);
const readme = readFileSync(
  resolve(root, "supabase/migraciones-ordenadas/README.md"),
  "utf8",
);

test("H90 separa figura física, presentación, sabor y caja por product_id exacto", () => {
  for (const figure of ["Lizi", "Momo", "Rocco", "Teo", "Toby", "Danna", "Max"]) {
    assert.match(migration, new RegExp(`'${figure}'`));
  }
  assert.match(migration, /v_figure\.product_id/);
  assert.match(migration, /cc\.component_id=v_figure\.product_id/);
  assert.match(migration, /new\.product_id:=v_exact_product\.id/);
  assert.doesNotMatch(migration, /pr\.especie\s*=\s*v_especie/i);
});

test("H90 protege las cuatro fronteras de escritura y las prueba con rollback", () => {
  for (const trigger of [
    "momos_figuras_canonical_guard",
    "momos_combo_component_canonical_guard",
    "a00_momos_order_item_canonical_guard",
  ]) {
    assert.match(migration, new RegExp(trigger));
    assert.match(adversarial, new RegExp(trigger));
  }
  assert.match(adversarial, /Osito H90/);
  assert.match(adversarial, /Una caja admitió un producto sin figura física exacta/);
  assert.match(adversarial, /La caja aceptó una figura cuya presentación no está habilitada/);
  assert.match(adversarial, /Una venta simple cruzó figura y presentación comercial/);
  assert.match(adversarial, /rollback;\s*$/i);
});

test("H89 y H90 entran en cadena después de la conciliación histórica", () => {
  assert.match(ordered, /20260720_89_cierre_lecturas_pii/);
  assert.match(ordered, /20260720_90_dominio_productos_figuras/);
  assert.match(readme, /Hito 89 · cierre de lecturas PII por rol/i);
  assert.match(readme, /AR-H90-PR08/i);
  assert.match(readme, /aceptación completa vigente[\s\S]+01–90/i);
});
