import test from "node:test";
import assert from "node:assert/strict";
import { buildPackingChecklistLines, findPackingVerification, packingStationProgress, packingVerificationMatchesLines } from "./packing-workflow.js";

const items = [
  { id: "I1", orderId: "P1", nombre: "Caja x3", cant: 1, adiciones: [] },
  { id: "I2", orderId: "P1", parentItemId: "I1", nombre: "Momo Perrito", cant: 1, figura: "Max", sabor: "Oreo", salsa: "Maracuyá", relleno: "Cheesecake con ganache", adiciones: [{ nombre: "Milo", cant: 1 }] },
  { id: "I3", orderId: "P2", nombre: "Momo Gatito", cant: 1, figura: "Lizi", sabor: "Limón", adiciones: [] },
];

test("arma el checklist completo de la orden, incluidas las piezas de una caja", () => {
  const lines = buildPackingChecklistLines("P1", items);
  assert.deepEqual(lines.map((line) => line.id), ["I1", "I2"]);
  assert.match(lines[1].detail, /Figura Max/);
  assert.match(lines[1].detail, /Sabor Oreo/);
  assert.match(lines[1].detail, /Adición Milo/);
});

test("la verificación pertenece únicamente al pedido correspondiente", () => {
  assert.equal(findPackingVerification("P1", [{ orderId: "P2" }]), null);
  assert.equal(findPackingVerification("P1", [{ orderId: "P1", user: "Empaque" }]).user, "Empaque");
});

test("invalida verificaciones viejas o manipuladas si cambian las líneas", () => {
  const lines = buildPackingChecklistLines("P1", items);
  assert.equal(packingVerificationMatchesLines({ lineIds: ["I1", "I2"] }, lines), true);
  assert.equal(packingVerificationMatchesLines({ lineIds: ["I1"] }, lines), false);
  assert.equal(packingVerificationMatchesLines({ lineIds: ["I1", "I2", "FALSA"] }, lines), false);
  assert.equal(packingVerificationMatchesLines({ lineIds: ["I1", "I1", "I2"] }, lines), false);
});

test("no habilita Empacado hasta verificar líneas, caja abierta y sello", () => {
  const base = { orderId: "P1", orderItems: items };
  assert.equal(packingStationProgress(base).readyToPack, false);
  assert.equal(packingStationProgress({ ...base, verifications: [{ orderId: "P1", lineIds: ["I1", "I2"] }], evidences: [{ orderId: "P1", tipo: "Caja abierta" }] }).readyToPack, false);
  const complete = packingStationProgress({
    ...base,
    verifications: [{ orderId: "P1", lineIds: ["I1", "I2"] }],
    evidences: [{ orderId: "P1", tipo: "Caja abierta" }, { orderId: "P1", tipo: "Bolsa sellada" }],
  });
  assert.equal(complete.completedSteps, 3);
  assert.equal(complete.readyToPack, true);
});

test("acepta cualquiera de los dos sellos autorizados", () => {
  for (const tipo of ["Caja cerrada con sello", "Bolsa sellada"]) {
    const progress = packingStationProgress({
      orderId: "P1",
      orderItems: items,
      verifications: [{ orderId: "P1", lineIds: ["I1", "I2"] }],
      evidences: [{ orderId: "P1", tipo: "Caja abierta" }, { orderId: "P1", tipo }],
    });
    assert.equal(progress.hasSealPhoto, true, tipo);
  }
});
