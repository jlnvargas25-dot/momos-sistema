import test from "node:test";
import assert from "node:assert/strict";
import { buildFigureBatchPreparationGuide, buildSubrecipePreparationGuide } from "./production-preparation-guide.js";

test("arma la dosificación del lote desde gramajes y rellenos vivos", () => {
  const guide = buildFigureBatchPreparationGuide({
    batch: { figuras: [{ figura: "Momo", cant: 2 }, { figura: "Toby", cant: 1 }], horasCongelacion: 11 },
    preview: { canCalculate: true, totalUnits: 3, mousseOutputGrams: 535, totalFillingGrams: 105 },
    figures: [{ nombre: "Momo", gramajeG: 180 }, { nombre: "Toby", gramajeG: 280 }],
    subrecipes: [{ id: "CHEESE", nombre: "Cheesecake" }, { id: "GAN", nombre: "Ganache" }],
    fillingRules: [
      { id: "F1", subrecetaId: "CHEESE", gramosPorUnidad: 20, activo: true },
      { id: "F2", subrecetaId: "GAN", gramosPorUnidad: 15, activo: true },
    ],
  });
  assert.equal(guide.ready, true);
  assert.deepEqual(guide.rows.map((row) => [row.figure, row.mousseGramsPerUnit, row.finalGrams]), [
    ["Momo", 145, 360], ["Toby", 245, 280],
  ]);
  assert.deepEqual(guide.fillings.map((row) => [row.name, row.totalGrams]), [["Cheesecake", 60], ["Ganache", 45]]);
  assert.match(guide.steps.at(-1).detail, /11 h/);
});

test("no arma pasos para una silueta legacy aunque tenga gramaje", () => {
  const guide = buildFigureBatchPreparationGuide({
    batch: { figuras: [{ figura: "Horizontal", cant: 1 }] },
    preview: { canCalculate: true, totalUnits: 1, mousseOutputGrams: 115, totalFillingGrams: 35 },
    figures: [{ nombre: "Horizontal", gramajeG: 150 }],
  });
  assert.equal(guide.ready, false);
  assert.deepEqual(guide.rows, []);
});

test("conserva el proceso oficial de ganache y el cierre de rendimiento", () => {
  const guide = buildSubrecipePreparationGuide({ tipo: "ganache", nombre: "Ganache de chocolate" });
  assert.equal(guide.processDefined, true);
  assert.match(guide.steps.map((step) => step.detail).join(" "), /reposar 1 minuto/i);
  assert.match(guide.steps.at(-1).title, /registrar el rendimiento/i);
});

test("M&M se agrega al final y una salsa no documentada falla de forma explícita", () => {
  const mousse = buildSubrecipePreparationGuide({ tipo: "mousse_cremosa", nombre: "Mousse M&M" });
  assert.match(mousse.steps.map((step) => step.title).join(" "), /M&M al final/);
  const sauce = buildSubrecipePreparationGuide({ tipo: "salsa", nombre: "Salsa arequipe" });
  assert.equal(sauce.processDefined, false);
  assert.match(sauce.note, /no está estandarizado/i);
});

test("prioriza la ficha técnica vigente del servidor y conserva su versión", () => {
  const guide = buildSubrecipePreparationGuide({
    tipo: "ganache",
    nombre: "Ganache de chocolate",
    procedure: {
      version: 3,
      processDefined: true,
      sourceRef: "RECETAS.md",
      note: "Ficha aprobada por Cocina.",
      steps: [{ title: "Paso gobernado", detail: "Usar únicamente la secuencia aprobada." }],
    },
  });
  assert.equal(guide.governed, true);
  assert.equal(guide.version, 3);
  assert.equal(guide.processDefined, true);
  assert.match(guide.steps.map((step) => step.title).join(" "), /Paso gobernado/);
  assert.doesNotMatch(guide.steps.map((step) => step.detail).join(" "), /reposar 1 minuto/i);
});

test("una ficha incompleta del servidor falla cerrada aunque declare proceso definido", () => {
  const guide = buildSubrecipePreparationGuide({
    tipo: "cheesecake",
    nombre: "Relleno cheesecake",
    procedure: {
      version: 2,
      processDefined: true,
      note: "Pendiente de corregir.",
      steps: [{ title: "", detail: "dato inválido" }],
    },
  });
  assert.equal(guide.governed, true);
  assert.equal(guide.processDefined, false);
  assert.equal(guide.steps.length, 2);
  assert.match(guide.steps[0].title, /Mise en place/i);
});
