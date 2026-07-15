import test from "node:test";
import assert from "node:assert/strict";
import { auditCreativePackage, buildCreativePackage } from "./creative-package.js";

const baseDb = {
  products: [{ id: "P-1", nombre: "Momo Perrito", activo: true }],
  brand_library: {
    frases: ["El regalo más tierno de Cali."],
    tono: ["Tierno", "Premium", "Cercano"],
    palabrasSi: ["ternura", "sorpresa"],
    palabrasNo: ["barato", "remate", "descuento desesperado"],
  },
};

test("crea un paquete accionable y trazable desde un brief", () => {
  const pkg = buildCreativePackage({
    id: 17, title: "Mover Momo Perrito", objective: "Ventas", productId: "P-1",
    channel: "Instagram", status: "Aprobado", insight: "Tiene stock y ventas recientes.", evidence: { stock: 15 },
  }, baseDb, 0);
  assert.equal(pkg.productName, "Momo Perrito");
  assert.equal(pkg.format, "Reel");
  assert.equal(pkg.script.length, 4);
  assert.equal(pkg.measurement.primaryKpi, "Pedidos pagados atribuidos");
  assert.equal(pkg.source.evidence.stock, 15);
  assert.equal(pkg.audit.passed, true);
});

test("omite una oferta que todavía no tiene aprobación humana", () => {
  const pkg = buildCreativePackage({
    objective: "Ventas", productId: "P-1", channel: "Instagram", status: "Borrador", offer: "Dos por uno este viernes",
  }, baseDb);
  assert.equal(pkg.copy.includes("Dos por uno"), false);
  assert.equal(pkg.source.offerIncluded, false);
  assert.match(pkg.audit.warnings.join(" "), /oferta se omitió/i);
});

test("incluye exactamente la oferta aprobada sin inventar condiciones", () => {
  const pkg = buildCreativePackage({
    objective: "Lanzamiento", productId: "P-1", channel: "Facebook", status: "Aprobado", offer: "Envío incluido en Zona 1 hasta el viernes",
  }, baseDb);
  assert.equal(pkg.copy.includes("Envío incluido en Zona 1 hasta el viernes"), true);
  assert.equal(pkg.source.offerIncluded, true);
  assert.equal(pkg.format, "Carrusel");
});

test("adapta WhatsApp a conversación y exige atribución al pedido pagado", () => {
  const pkg = buildCreativePackage({ objective: "Recompra", channel: "WhatsApp", status: "Aprobado" }, baseDb);
  assert.equal(pkg.format, "Copy");
  assert.match(pkg.cta, /WhatsApp/);
  assert.match(pkg.measurement.attribution, /pedido originado/);
  assert.equal(pkg.audit.passed, true);
});

test("bloquea vocabulario prohibido incluso si llega desde una oferta aprobada", () => {
  const brief = { objective: "Ventas", productId: "P-1", channel: "Instagram", status: "Aprobado", offer: "Remate barato por hoy" };
  const pkg = buildCreativePackage(brief, baseDb);
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
  const first = buildCreativePackage(brief, baseDb, 1);
  const second = buildCreativePackage(brief, baseDb, 1);
  const other = buildCreativePackage(brief, baseDb, 2);
  assert.deepEqual(first, second);
  assert.notEqual(first.selectedHook, other.selectedHook);
  assert.equal(first.format, "Video UGC");
});

test("la auditoría ignora las palabras prohibidas cuando solo aparecen en el prompt negativo", () => {
  const pkg = buildCreativePackage({ objective: "Ventas", productId: "P-1", channel: "Instagram", status: "Aprobado" }, baseDb);
  assert.match(pkg.negativePrompt, /barato/);
  const audit = auditCreativePackage(pkg, { objective: "Ventas", productId: "P-1", channel: "Instagram" }, baseDb);
  assert.equal(audit.passed, true);
});
