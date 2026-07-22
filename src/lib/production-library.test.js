import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProductionLibrary, defaultProductionProfile, productionProfilePayload,
  cleanMasterReadiness, productionProfileReadiness, visualQualityReadiness, visualQualityReviewPayload,
  VISUAL_QUALITY_CHECKS,
} from "./production-library.js";

const baseAsset = {
  id: 1, status: "Activo", containsPeople: false, rightsStatus: "Propio",
  readiness: { ready: true, reasons: [] },
};

test("un producto aprobado queda listo y conserva advertencia de escarcha", () => {
  const result = productionProfileReadiness({
    ...baseAsset,
    productionProfile: { ...defaultProductionProfile("Producto"), qaStatus: "Aprobado", sourceQuality: "Original con escarcha" },
  });
  assert.equal(result.ready, true);
  assert.match(result.warnings[0], /escarcha/i);
});

test("manos y UGC exigen persona, derechos y consentimiento", () => {
  const result = productionProfileReadiness({
    ...baseAsset,
    productionProfile: { ...defaultProductionProfile("Manos"), qaStatus: "Aprobado" },
  });
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /personas|autorización de imagen/i);
  assert.match(result.reasons.join(" "), /canal y finalidad/i);
});

test("la biblioteca calcula vistas, locaciones y vacíos", () => {
  const db = { brandProductionReady: true, brandMediaAssets: [
    { ...baseAsset, productionProfile: { ...defaultProductionProfile("Producto"), qaStatus: "Aprobado", viewAngle: "Frontal" } },
    { ...baseAsset, id: 2, productionProfile: { ...defaultProductionProfile("Locación"), qaStatus: "Aprobado", locationName: "Cocina MOMOS" } },
  ] };
  const library = buildProductionLibrary(db);
  assert.equal(library.summary.approved, 2);
  assert.equal(library.summary.multiviewAngles, 1);
  assert.equal(library.summary.locations, 1);
  assert.ok(library.gaps.some((item) => item.componentType === "Manos"));
});

test("un paquete no aprueba si le falta el rol requerido", () => {
  const profile = { ...defaultProductionProfile("Producto"), qaStatus: "Aprobado" };
  const library = buildProductionLibrary({
    brandProductionReady: true,
    brandMediaAssets: [{ ...baseAsset, productionProfile: profile }],
    brandProductionPacks: [{ id: 4, status: "Borrador", requirements: { required_roles: ["Producto", "Identidad"] } }],
    brandProductionPackAssets: [{ packId: 4, assetId: 1, role: "Producto", sequence: 1 }],
  });
  assert.equal(library.packs[0].readiness.ready, false);
  assert.match(library.packs[0].readiness.reasons[0], /Identidad/);
});

test("el payload traduce la ficha a snake_case", () => {
  const payload = productionProfilePayload({ ...defaultProductionProfile("Presentador UGC"), locationName: "  Casa creadora  ",
    visualSetKey: " Momo-UGC-01 ", consentChannels: ["TikTok"], consentPurposes: ["Pauta"] });
  assert.equal(payload.component_type, "Presentador UGC");
  assert.equal(payload.location_name, "Casa creadora");
  assert.equal(payload.consent_status, "Pendiente");
  assert.equal(payload.visual_set_key, "momo-ugc-01");
  assert.deepEqual(payload.consent_channels, ["TikTok"]);
});

test("agrupa multivistas del mismo sujeto sin mezclar variantes", () => {
  const approved = { ...defaultProductionProfile("Producto"), qaStatus: "Aprobado", visualSetKey: "momo-mango", variantLabel: "intacto" };
  const library = buildProductionLibrary({ brandProductionReady: true, visualLibraryReady: true, brandMediaAssets: [
    { ...baseAsset, productionProfile: { ...approved, viewAngle: "Frontal" } },
    { ...baseAsset, id: 2, productionProfile: { ...approved, viewAngle: "Trasera", variantLabel: "bolsa" } },
  ] });
  assert.equal(library.visualSets.length, 1);
  assert.equal(library.visualSets[0].hasFrontAndBack, true);
  assert.deepEqual(library.visualSets[0].variants, ["intacto", "bolsa"]);
});

test("separa permiso de IA de aptitud técnica para video", () => {
  const pending = visualQualityReadiness({ ...baseAsset, width: null, height: null });
  assert.equal(pending.videoGeneration.ready, false);
  assert.match(pending.videoGeneration.reasons[0], /revisión maestra/i);

  const ready = visualQualityReadiness({ ...baseAsset, qualityAssessment: {
    status: "Aprobado", sourceCurrent: true, issues: [], recommendedAction: "Ninguna",
    usageReadiness: {
      digital_content: { ready: true, reasons: [] }, image_generation: { ready: true, reasons: [] },
      video_generation: { ready: true, reasons: [] }, element: { ready: false, reasons: ["Falta canon."] },
    },
  } });
  assert.equal(ready.videoGeneration.ready, true);
  assert.equal(ready.element.ready, false);
});

test("el gate H110 excluye referencias no certificadas de la cobertura para generación", () => {
  const approvedProfile = { ...defaultProductionProfile("Producto"), qaStatus: "Aprobado" };
  const library = buildProductionLibrary({ brandProductionReady: true, visualQualityReady: true, brandMediaAssets: [
    { ...baseAsset, mediaType: "Foto", productionProfile: approvedProfile },
    { ...baseAsset, id: 2, mediaType: "Audio", productionProfile: { ...defaultProductionProfile("Audio"), qaStatus: "Aprobado" } },
  ] });
  assert.equal(library.approved.length, 2);
  assert.equal(library.generationReady.length, 1);
  assert.equal(library.summary.videoReady, 0);
});

test("el payload de revisión conserva taxonomía cerrada sin duplicados", () => {
  const payload = visualQualityReviewPayload({
    qualityIssues: ["Escarcha", "Escarcha"],
    qualityChecksCompleted: [...VISUAL_QUALITY_CHECKS, VISUAL_QUALITY_CHECKS[0]],
    qualityReviewNotes: "  Repetir la toma sin escarcha.  ",
  });
  assert.deepEqual(payload.issues, ["Escarcha"]);
  assert.equal(payload.checks_completed.length, VISUAL_QUALITY_CHECKS.length);
  assert.equal(payload.review_notes, "Repetir la toma sin escarcha.");
});

test("H111 conserva escarcha como variante pero la excluye de generación", () => {
  const qualityAssessment = {
    status: "Variante artística", sourceCurrent: true, issues: ["Escarcha", "Condensación"],
    recommendedAction: "Capturar máster limpio", usageReadiness: {
      digital_content: { ready: true, reasons: [] },
      image_generation: { ready: false, reasons: ["Escarcha."] },
      video_generation: { ready: false, reasons: ["Escarcha."] },
      element: { ready: false, reasons: ["Escarcha."] },
    },
  };
  const frosted = { ...baseAsset, mediaType: "Foto", productionProfile: {
    ...defaultProductionProfile("Producto"), qaStatus: "Aprobado", sourceQuality: "Original con escarcha", canonical: false,
  }, qualityAssessment };
  const state = cleanMasterReadiness(frosted);
  const library = buildProductionLibrary({ brandProductionReady: true, visualQualityReady: true,
    visualCleanMasterReady: true, brandMediaAssets: [frosted] });
  assert.equal(state.className, "Variante artística");
  assert.equal(state.ready, false);
  assert.equal(library.summary.artisticFrost, 1);
  assert.equal(library.generationReady.length, 0);
});

test("H111 solo habilita un restaurado canónico enlazado y certificado", () => {
  const qualityAssessment = { status: "Aprobado", sourceCurrent: true, issues: [], recommendedAction: "Ninguna",
    usageReadiness: { digital_content: { ready: true, reasons: [] }, image_generation: { ready: true, reasons: [] },
      video_generation: { ready: true, reasons: [] }, element: { ready: true, reasons: [] } } };
  const clean = { ...baseAsset, mediaType: "Foto", originalAssetId: 8, productionProfile: {
    ...defaultProductionProfile("Producto"), qaStatus: "Aprobado", sourceQuality: "Restaurado", canonical: true,
  }, qualityAssessment };
  const state = cleanMasterReadiness(clean);
  assert.equal(state.className, "Máster IA limpio");
  assert.equal(state.ready, true);
});

test("el payload nunca declara canónica una fuente con escarcha", () => {
  const payload = productionProfilePayload({ ...defaultProductionProfile("Producto"),
    sourceQuality: "Original con escarcha", canonical: true, variantLabel: "" });
  assert.equal(payload.canonical, false);
  assert.equal(payload.variant_label, "Variante artística");
});
