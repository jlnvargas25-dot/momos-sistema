import test from "node:test";
import assert from "node:assert/strict";
import { KITCHEN_ISSUE_GUIDANCE, kitchenQuickCommandState } from "./kitchen-command.js";

test("Cocina recibe una sola acción principal para tomar una comanda pagada", () => {
  assert.deepEqual(kitchenQuickCommandState({ orderStatus: "Pagado", lineCount: 2, incidentCount: 0 }), {
    action: "start",
    label: "Tomar e iniciar comanda",
    disabled: false,
    blockReason: "",
  });
});

test("Cocina recibe una sola acción principal para entregar una comanda terminada", () => {
  const state = kitchenQuickCommandState({ orderStatus: "En producción", lineCount: 3, incidentCount: 0 });
  assert.equal(state.action, "ready");
  assert.equal(state.disabled, false);
});

test("una novedad abierta oculta el camino feliz hasta resolverla", () => {
  const state = kitchenQuickCommandState({ orderStatus: "En producción", lineCount: 3, incidentCount: 1 });
  assert.equal(state.action, "ready");
  assert.equal(state.disabled, true);
  assert.match(state.blockReason, /Resolvé la novedad/i);
});

test("una orden vacía nunca puede entrar ni salir de Cocina", () => {
  assert.equal(kitchenQuickCommandState({ orderStatus: "Pagado", lineCount: 0 }).disabled, true);
  assert.equal(kitchenQuickCommandState({ orderStatus: "En producción", lineCount: 0 }).disabled, true);
});

test("la sustitución exige autorización y no induce cambios silenciosos", () => {
  assert.match(KITCHEN_ISSUE_GUIDANCE.Sustitución, /Confirmá.*antes de reemplazar/i);
});
