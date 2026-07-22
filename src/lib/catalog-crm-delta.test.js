import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCustomerCrmDeltaBatchToDb, applyProductCatalogDeltaBatchToDb,
  compareCatalogCrmVersions, normalizeCatalogCrmMutationEnvelope,
} from "./catalog-crm-delta.js";

const productEnvelope = (version = "2") => ({
  contract: "momos.product-catalog-delta-batch.v1", containsCustomerPii: false, containsSecrets: false, externalExecution: false,
  deltas: [{ contract: "momos.product-catalog-delta.v1", productId: "P1", version, serverTime: "2026-07-19T12:00:00Z",
    product: { id: "P1", nombre: "Momo", cat: "Momos Signature", tipo: "momo", especie: "gato", precio: 18000, precioRappi: 23000, costo: 6000, stock: 2, prep: 0, frio: true, lejano: false, activo: true, desc: "", comboSize: null, componentProductIds: [], empaqueItem: "", colchonProduccion: 1 },
    recipes: [{ id: "R2", productId: "P1", itemId: "I1", cantidad: 0.1 }],
  }],
});

const crmEnvelope = (version = "3") => ({
  contract: "momos.customer-crm-delta-batch.v1", scope: "staff-private", containsCustomerPii: true, containsSecrets: false, externalExecution: false,
  deltas: [{ contract: "momos.customer-crm-delta.v1", customerId: "C1", version, serverTime: "2026-07-19T12:00:00Z",
    customer: { id: "C1", nombre: "Ana", telefono: "300", instagram: "", barrio: "Caney", direccion: "Calle 1", canal: "WhatsApp", primera: "", ultima: "", total: 0, pedidos: 0, cumple: "", favoritos: "", estado: "Nuevo", notas: "" },
    profile: { customerId: "C1", contactAllowed: true, contactReason: "", preferredChannel: "WhatsApp", acquisitionSource: "", referredByCustomerId: "", updatedBy: "U1", updatedAt: "2026-07-19 07:00" },
    contacts: [], activations: [], benefits: [],
  }],
});

test("H74 compara bigint sin perder precisión", () => {
  assert.equal(compareCatalogCrmVersions("90071992547409930", "90071992547409929"), 1);
});

test("H74 reemplaza solo el producto y su receta", () => {
  const db = { products: [{ id: "P1", nombre: "Viejo" }, { id: "P2", nombre: "Otro" }], recipes: [{ id: "R1", productId: "P1" }, { id: "R9", productId: "P2" }], productCatalogDeltaVersions: { P1: "1" } };
  const result = applyProductCatalogDeltaBatchToDb(db, productEnvelope());
  assert.deepEqual(result.applied, ["P1"]);
  assert.equal(result.db.products.find((row) => row.id === "P2").nombre, "Otro");
  assert.deepEqual(result.db.products.find((row) => row.id === "P1").atributos, ["sabor", "salsa", "figura"]);
  assert.deepEqual(result.db.recipes.map((row) => row.id).sort(), ["R2", "R9"]);
});

test("H74 no permite que una respuesta vieja revierta el catálogo", () => {
  const db = { products: [{ id: "P1", nombre: "Nuevo" }], recipes: [], productCatalogDeltaVersions: { P1: "10" } };
  assert.equal(applyProductCatalogDeltaBatchToDb(db, productEnvelope("9")).status, "stale");
});

test("H74 actualiza solo la ficha privada del cliente", () => {
  const db = { customers: [{ id: "C1", nombre: "Vieja" }, { id: "C2", nombre: "Bea" }], customer_crm_profiles: [], customer_contacts: [], customer_activations: [], benefits: [{ id: "B2", customerId: "C2" }], customerCrmDeltaVersions: {} };
  const result = applyCustomerCrmDeltaBatchToDb(db, crmEnvelope());
  assert.equal(result.db.customers.find((row) => row.id === "C1").nombre, "Ana");
  assert.equal(result.db.customers.find((row) => row.id === "C2").nombre, "Bea");
  assert.deepEqual(result.db.benefits, [{ id: "B2", customerId: "C2" }]);
});

test("H74 rechaza campos extra y mezclas de privacidad", () => {
  const mutation = { contract: "momos.catalog-crm-mutation.v1", operation: "editar_producto", idempotencyKey: "k", duplicate: false, result: {}, catalog: productEnvelope(), crm: null, containsCustomerPii: false, containsSecrets: false, externalExecution: false };
  assert.ok(normalizeCatalogCrmMutationEnvelope(mutation, "editar_producto").catalog);
  assert.throws(() => normalizeCatalogCrmMutationEnvelope({ ...mutation, secret: "x" }, "editar_producto"), /no permitidos/i);
  assert.throws(() => normalizeCatalogCrmMutationEnvelope({ ...mutation, crm: crmEnvelope() }, "editar_producto"), /mezcl/i);
});
