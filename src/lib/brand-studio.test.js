import test from "node:test";
import assert from "node:assert/strict";
import { brandAssetCollection, brandAssetDeletionReadiness, brandAssetReadiness, buildBrandMediaLibrary, buildCreativeStudioDraft, searchBrandMediaAssets } from "./brand-studio.js";

const asset = (overrides = {}) => ({
  id: "A-1", name: "Lizi Oreo vertical", mediaType: "Video", source: "MOMOS", productId: "PR-1",
  productName: "Momo Gatito", figure: "Lizi", flavor: "Oreo", shotType: "Producto",
  orientation: "Vertical", containsPeople: false, rightsStatus: "Propio", rightsExpiresAt: "",
  aiUseAllowed: true, status: "Activo", storagePath: "originales/a1.mp4", url: "https://cdn/a1.mp4",
  contentHash: "hash-a1", durationSeconds: 8, tags: ["desmolde", "oreo"], notes: "", ...overrides,
});

const db = (overrides = {}) => ({
  brandMediaAssets: [asset()],
  brand_library: { frases: ["Adopta tu Momo"], tono: ["Tierno", "Premium"], palabrasSi: ["antojo"], palabrasNo: ["barato"] },
  creatives: [{ id: "CR-1", titulo: "Reel Lizi", canal: "Instagram", productoFocoId: "PR-1", productoFoco: "Momo Gatito" }],
  agencyBriefs: [], products: [{ id: "PR-1", nombre: "Momo Gatito" }], ...overrides,
});

test("un original propio y sin personas queda listo para edición con IA", () => {
  const result = brandAssetReadiness(asset(), "2026-07-15", "Editar");
  assert.equal(result.ready, true);
});

test("bloquea material con personas sin autorización explícita de imagen", () => {
  const result = brandAssetReadiness(asset({ containsPeople: true, rightsStatus: "Propio" }), "2026-07-15", "Editar");
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /personas.*autorización/i);
});

test("bloquea derechos vencidos, restringidos y activos sin permiso de IA", () => {
  assert.equal(brandAssetReadiness(asset({ rightsExpiresAt: "2026-07-14" }), "2026-07-15").ready, false);
  assert.equal(brandAssetReadiness(asset({ rightsStatus: "Restringido" }), "2026-07-15").ready, false);
  assert.equal(brandAssetReadiness(asset({ aiUseAllowed: false }), "2026-07-15").ready, false);
});

test("la biblioteca detecta duplicados por huella sin perder los originales", () => {
  const result = buildBrandMediaLibrary(db({ brandMediaAssets: [asset(), asset({ id: "A-2", storagePath: "originales/a2.mp4" })] }), "2026-07-15");
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.duplicates, 2);
  assert.equal(result.readyForAi.length, 0);
});

test("la búsqueda cruza producto, figura, sabor y etiquetas", () => {
  const library = buildBrandMediaLibrary(db(), "2026-07-15");
  assert.equal(searchBrandMediaAssets(library, "lizi oreo desmolde").length, 1);
  assert.equal(searchBrandMediaAssets(library, "coco").length, 0);
});

test("separa identidad de marca y material de producto sin duplicar tablas", () => {
  const brandPhoto = asset({ id: "A-MARCA", mediaType: "Foto", productId: "", productName: "", figure: "", flavor: "", shotType: "Ambiente y estilo de vida", tags: ["momos:marca"] });
  const productPhoto = asset({ id: "A-PRODUCTO", tags: ["momos:producto"] });
  const logo = asset({ id: "A-LOGO", mediaType: "Logo", productId: "", productName: "", figure: "", flavor: "", shotType: "Logo principal", tags: [] });
  const library = buildBrandMediaLibrary(db({ brandMediaAssets: [brandPhoto, productPhoto, logo] }), "2026-07-15");
  assert.equal(brandAssetCollection(brandPhoto), "Marca");
  assert.equal(brandAssetCollection(productPhoto), "Productos");
  assert.equal(brandAssetCollection(logo), "Marca");
  assert.equal(library.summary.brandAssets, 2);
  assert.equal(library.summary.productAssets, 1);
  assert.equal(library.summary.primaryLogos, 1);
  assert.equal(searchBrandMediaAssets(library, "", { collection: "Marca" }).length, 2);
  assert.equal(searchBrandMediaAssets(library, "", { collection: "Productos" }).length, 1);
});

test("una foto general de marca ya no exige producto relacionado", () => {
  const result = brandAssetReadiness(asset({ mediaType: "Foto", productId: "", productName: "", figure: "", flavor: "", tags: ["momos:marca"] }), "2026-07-15");
  assert.equal(result.warnings.some((warning) => /producto/i.test(warning)), false);
});

test("una composición exige archivo real y producto foco exacto", () => {
  const noAssets = buildCreativeStudioDraft({ creativeId: "CR-1", assetIds: [], operation: "Componer" }, db(), "2026-07-15");
  assert.equal(noAssets.audit.passed, false);
  const wrongProduct = buildCreativeStudioDraft({ creativeId: "CR-1", assetIds: ["A-2"], operation: "Componer" }, db({ brandMediaAssets: [asset({ id: "A-2", productId: "PR-2" })] }), "2026-07-15");
  assert.match(wrongProduct.audit.errors.join(" "), /toma real del producto foco/i);
});

test("una generación con producto foco tampoco puede inventar el postre", () => {
  const result = buildCreativeStudioDraft({ creativeId: "CR-1", assetIds: [], operation: "Generar imagen" }, db(), "2026-07-15");
  assert.equal(result.audit.passed, false);
  assert.match(result.audit.errors.join(" "), /toma real del producto foco/i);
});

test("una composición segura congela identidad y nunca sobrescribe originales", () => {
  const result = buildCreativeStudioDraft({ creativeId: "CR-1", assetIds: ["A-1"], operation: "Editar", targetFormat: "Reel 9:16", provider: "Higgsfield" }, db(), "2026-07-15");
  assert.equal(result.audit.passed, true);
  assert.equal(result.outputMode, "new_asset");
  assert.equal(result.usagePlan[0].preserveOriginal, true);
  assert.equal(result.brandSnapshot.forbiddenWords[0], "barato");
  assert.match(result.prompt, /sin alterar forma, relleno, color ni empaque/i);
});

test("rechaza referencias desaparecidas y no inventa una selección", () => {
  const result = buildCreativeStudioDraft({ creativeId: "CR-1", assetIds: ["A-X"], operation: "Editar" }, db(), "2026-07-15");
  assert.equal(result.audit.passed, false);
  assert.match(result.audit.errors.join(" "), /ya no existen/i);
  assert.equal(result.assets.length, 0);
});

test("permite eliminar únicamente originales que nunca fueron usados", () => {
  const free = brandAssetDeletionReadiness(asset(), db());
  assert.equal(free.allowed, true);
  const used = brandAssetDeletionReadiness(asset(), db({
    creativeGenerationJobs: [{ id: 7, inputAssetIds: ["A-1"], outputAssetId: null }],
  }));
  assert.equal(used.allowed, false);
  assert.match(used.reasons.join(" "), /trabajo creativo/i);
});

test("protege archivos ligados a escenas, audio, publicaciones o versiones", () => {
  const source = asset();
  const protectedAsset = brandAssetDeletionReadiness(source, db({
    agencyStoryboardShots: [{ inputAssetIds: ["A-1"] }],
    agencyPostproductionAudioBindings: [{ assetId: "A-1" }],
    agencyMasterReleases: [{ outputAssetId: "A-1" }],
    brandMediaAssets: [source, { ...asset({ id: "A-2" }), originalAssetId: "A-1" }],
  }));
  assert.equal(protectedAsset.allowed, false);
  assert.ok(protectedAsset.reasons.length >= 4);
});
