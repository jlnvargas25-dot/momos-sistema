import test from "node:test";
import assert from "node:assert/strict";
import { animationAssetIsCanonical, animationAssetKind, brandAssetCollection, brandAssetDeletionPolicy, brandAssetDeletionReadiness, brandAssetReadiness, buildBrandMediaLibrary, buildCreativeStudioDraft, isOfficialBrandLogo, searchBrandMediaAssets } from "./brand-studio.js";

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

test("separa Mundo animado sin mezclar personajes con Marca o Productos", () => {
  const momo = asset({ id: "ANI-1", mediaType: "Diseño", productId: "", productName: "", figure: "Momo", flavor: "Base", shotType: "Turnaround", tags: ["momos:animacion", "animacion:tipo:personaje", "animacion:canon"] });
  const world = buildBrandMediaLibrary(db({ brandMediaAssets: [momo] }), "2026-07-15");
  assert.equal(brandAssetCollection(momo), "Animación");
  assert.equal(animationAssetKind(momo), "Personaje");
  assert.equal(animationAssetIsCanonical(momo), true);
  assert.equal(world.summary.animationAssets, 1);
  assert.equal(world.summary.animationCharacters, 1);
  assert.equal(world.summary.brandAssets, 0);
  assert.equal(world.summary.productAssets, 0);
});

test("Mundo animado exige identificar el personaje o elemento", () => {
  const result = brandAssetReadiness(asset({ productId: "", productName: "", figure: "", flavor: "", tags: ["momos:animacion", "animacion:tipo:personaje"] }), "2026-07-15");
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /personaje o elemento/i);
});

test("la búsqueda del mundo cruza personaje, variante y material", () => {
  const toby = asset({ id: "ANI-2", mediaType: "Diseño", productId: "", productName: "", figure: "Toby", flavor: "Chef", shotType: "Expresiones", tags: ["momos:animacion", "animacion:tipo:personaje"] });
  const library = buildBrandMediaLibrary(db({ brandMediaAssets: [toby] }), "2026-07-15");
  assert.equal(searchBrandMediaAssets(library, "toby chef expresiones", { collection: "Animación" }).length, 1);
});

test("una referencia canónica no se puede eliminar como archivo huérfano", () => {
  const canonical = asset({ id: "ANI-3", figure: "Momo", tags: ["momos:animacion", "animacion:tipo:personaje", "animacion:canon"] });
  const result = brandAssetDeletionReadiness(canonical, db({ brandMediaAssets: [canonical] }));
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /canónica/i);
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

test("el logo oficial nunca cae en la eliminación genérica y exige administrador, H60 y frase exacta", () => {
  const logo = asset({ id: "LOGO-7", mediaType: "Logo", productId: "", productName: "", shotType: "Logo principal", roleLabel: "Logo principal", collection: "Marca" });
  assert.equal(isOfficialBrandLogo(logo), true);
  const unavailable = brandAssetDeletionPolicy(logo, db({ brandMediaAssets: [logo] }), { isAdmin: true, officialLogoDeletionReady: false });
  assert.equal(unavailable.allowed, false);
  assert.equal(unavailable.mode, "blocked");
  const marketing = brandAssetDeletionPolicy(logo, db({ brandMediaAssets: [logo] }), { isAdmin: false, officialLogoDeletionReady: true });
  assert.equal(marketing.allowed, false);
  const admin = brandAssetDeletionPolicy(logo, db({ brandMediaAssets: [logo] }), { isAdmin: true, officialLogoDeletionReady: true });
  assert.equal(admin.allowed, true);
  assert.equal(admin.mode, "official-logo");
  assert.equal(admin.confirmationPhrase, "ELIMINAR LOGO LOGO-7");
});

test("una dependencia creativa sigue bloqueando el logo aunque exista la ruta protegida", () => {
  const logo = asset({ id: "LOGO-8", mediaType: "Logo", productId: "", productName: "", shotType: "Logo principal", roleLabel: "Logo principal", collection: "Marca" });
  const policy = brandAssetDeletionPolicy(logo, db({
    brandMediaAssets: [logo],
    creativeGenerationJobs: [{ id: 8, inputAssetIds: ["LOGO-8"] }],
  }), { isAdmin: true, officialLogoDeletionReady: true });
  assert.equal(policy.allowed, false);
  assert.match(policy.reasons.join(" "), /trabajo creativo/i);
});
