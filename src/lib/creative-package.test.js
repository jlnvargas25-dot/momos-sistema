import test from "node:test";
import assert from "node:assert/strict";
import { auditCreativePackage, buildCreativePackage } from "./creative-package.js";

const baseDb = {
  products: [{ id: "P-1", nombre: "Momo Perrito", cat: "Momos Signature", tipo: "momo", activo: true }],
  figuras: [{ nombre: "Max", productId: "P-1", activo: true }],
  brand_library: {
    frases: ["El regalo más tierno de Cali."],
    tono: ["Tierno", "Premium", "Cercano"],
    palabrasSi: ["ternura", "sorpresa"],
    palabrasNo: ["barato", "remate", "descuento desesperado"],
  },
};
const exactSubject = { figure: "Max", flavor: "Oreo" };

test("crea un paquete accionable y trazable desde un brief", () => {
  const pkg = buildCreativePackage({
    id: 17, title: "Mover Momo Perrito", objective: "Ventas", productId: "P-1",
    channel: "Instagram", status: "Aprobado", insight: "Tiene stock y ventas recientes.", evidence: { stock: 15 },
  }, baseDb, 0, exactSubject);
  assert.equal(pkg.productName, "Momo Perrito");
  assert.equal(pkg.subjectName, "Max de Oreo");
  assert.match(pkg.prompt, /Sujeto exacto: Max de Oreo/);
  assert.match(pkg.prompt, /Presentación comercial: Momo Perrito/);
  assert.equal(pkg.format, "Reel");
  assert.equal(pkg.script.length, 4);
  assert.equal(pkg.measurement.primaryKpi, "Pedidos pagados atribuidos");
  assert.equal(pkg.source.evidence.stock, 15);
  assert.equal(pkg.audit.passed, true);
});

test("ignora una figura legacy en contenido de preparaciones al momento", () => {
  const db = {
    ...baseDb,
    products: [{ id: "P-M", nombre: "Malteada Oreo", cat: "Momos Bebidas", tipo: "pedido", activo: true }],
  };
  const pkg = buildCreativePackage({ objective: "Ventas", productId: "P-M", channel: "Instagram", status: "Aprobado" }, db, 0, { figure: "Max", flavor: "Oreo" });
  assert.equal(pkg.figure, null);
  assert.equal(pkg.subjectName, "Malteada Oreo");
  assert.doesNotMatch(pkg.prompt, /Sujeto exacto: Max/);
});

test("omite una oferta que todavía no tiene aprobación humana", () => {
  const pkg = buildCreativePackage({
    objective: "Ventas", productId: "P-1", channel: "Instagram", status: "Borrador", offer: "Dos por uno este viernes",
  }, baseDb, 0, exactSubject);
  assert.equal(pkg.copy.includes("Dos por uno"), false);
  assert.equal(pkg.source.offerIncluded, false);
  assert.match(pkg.audit.warnings.join(" "), /oferta se omitió/i);
});

test("incluye exactamente la oferta aprobada sin inventar condiciones", () => {
  const pkg = buildCreativePackage({
    objective: "Lanzamiento", productId: "P-1", channel: "Facebook", status: "Aprobado", offer: "Envío incluido en Zona 1 hasta el viernes",
  }, baseDb, 0, exactSubject);
  assert.equal(pkg.copy.includes("Envío incluido en Zona 1 hasta el viernes"), true);
  assert.equal(pkg.source.offerIncluded, true);
  assert.equal(pkg.format, "Carrusel");
});

test("adapta WhatsApp a conversación y exige atribución al pedido pagado", () => {
  const pkg = buildCreativePackage({ objective: "Recompra", channel: "WhatsApp", status: "Aprobado" }, baseDb, 0, exactSubject);
  assert.equal(pkg.format, "Copy");
  assert.match(pkg.cta, /WhatsApp/);
  assert.match(pkg.measurement.attribution, /pedido originado/);
  assert.equal(pkg.audit.passed, true);
});

test("bloquea vocabulario prohibido incluso si llega desde una oferta aprobada", () => {
  const brief = { objective: "Ventas", productId: "P-1", channel: "Instagram", status: "Aprobado", offer: "Remate barato por hoy" };
  const pkg = buildCreativePackage(brief, baseDb, 0, exactSubject);
  assert.equal(pkg.audit.passed, false);
  assert.deepEqual(pkg.audit.forbiddenHits, ["barato", "remate"]);
});

test("falla cerrado cuando el producto foco está inactivo o desapareció", () => {
  const inactiveDb = { ...baseDb, products: [{ id: "P-X", nombre: "Momo oculto", activo: false }] };
  const inactive = buildCreativePackage({ objective: "Ventas", productId: "P-X", channel: "Instagram" }, inactiveDb);
  assert.equal(inactive.audit.passed, false);
  assert.match(inactive.audit.errors[0], /inactivo/);
  const missing = buildCreativePackage({ objective: "Ventas", productId: "P-NO", channel: "Instagram" }, baseDb);
  assert.equal(missing.audit.passed, false);
  assert.match(missing.audit.errors[0], /no existe/);
});

test("las variantes de hook son deterministas y conservan el mismo paquete base", () => {
  const brief = { id: 8, objective: "Contenido", productId: "P-1", channel: "TikTok", status: "Aprobado" };
  const first = buildCreativePackage(brief, baseDb, 1, exactSubject);
  const second = buildCreativePackage(brief, baseDb, 1, exactSubject);
  const other = buildCreativePackage(brief, baseDb, 2, exactSubject);
  assert.deepEqual(first, second);
  assert.notEqual(first.selectedHook, other.selectedHook);
  assert.equal(first.format, "Video UGC");
});

test("la auditoría ignora las palabras prohibidas cuando solo aparecen en el prompt negativo", () => {
  const pkg = buildCreativePackage({ objective: "Ventas", productId: "P-1", channel: "Instagram", status: "Aprobado" }, baseDb, 0, exactSubject);
  assert.match(pkg.negativePrompt, /barato/);
  const audit = auditCreativePackage(pkg, { objective: "Ventas", productId: "P-1", channel: "Instagram" }, baseDb);
  assert.equal(audit.passed, true);
});

test("una familia comercial nunca produce un creativo si falta la figura o el sabor exactos", () => {
  const pending = buildCreativePackage({ objective: "Ventas", productId: "P-1", channel: "Instagram", status: "Aprobado" }, baseDb);
  assert.equal(pending.exactSubjectReady, false);
  assert.equal(pending.subjectName, "Postre exacto pendiente");
  assert.equal(pending.audit.passed, false);
  assert.match(pending.audit.errors.join(" "), /figura y el sabor exactos/i);

  const wrong = buildCreativePackage({ objective: "Ventas", productId: "P-1", channel: "Instagram", status: "Aprobado" }, baseDb, 0, { figure: "Lizi", flavor: "Coco" });
  assert.equal(wrong.audit.passed, false);
  assert.match(wrong.audit.errors.join(" "), /no pertenece/i);
});
