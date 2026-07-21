import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalFinishedStock, calculateOrderMoney,
  canonicalVariantsForAvailability,
} from "./canonical-calculations.js";
import { customerOrderTotal } from "./customer-crm.js";
import { financeOrderTotal } from "./operational-finance.js";
import { evaluateExactVariantDemand } from "./variant-availability.js";
import { buildFinishedStockSummary } from "./production-stock-summary.js";
import { momobotContextAnswer } from "./momobot-context.js";
import { agencyExactVariantStock } from "./agency-intelligence.js";

const TODAY = "2026-07-21";

function orderFixture() {
  const order = {
    id: "P-CONTRACT", customerId: "C-CONTRACT", fecha: TODAY, hora: "10:00",
    estado: "Pendiente de pago", descuento: 1000, domCobrado: 5000,
  };
  return {
    order,
    db: {
      orders: [order],
      order_items: [{
        id: "LINE-1", orderId: order.id, productId: "PR01", cant: 2,
        precio: 18000, adiciones: [{ precio: 2000, cant: 1 }],
      }],
      customers: [{ id: order.customerId, nombre: "Cliente contrato" }],
      products: [{ id: "PR01", nombre: "Momo Gatito", tipo: "momo", activo: true }],
      benefits: [], customer_crm_profiles: [], customer_contacts: [], customer_activations: [],
    },
  };
}

function stockFixture({ inconsistent = false } = {}) {
  const activeUnits = inconsistent ? 4 : 7;
  return {
    products: [{ id: "PR01", nombre: "Momo Gatito", tipo: "momo", activo: true, stock: inconsistent ? 2 : 9 }],
    variantes: [
      { id: "V-COCO", productId: "PR01", producto: "Momo Gatito", figura: "Lizi", sabor: "Coco", disponibles: 4, vence: "2026-07-23" },
      ...(activeUnits > 4 ? [{ id: "V-OREO", productId: "PR01", producto: "Momo Gatito", figura: "Lizi", sabor: "Oreo", disponibles: 3, vence: "2026-07-24" }] : []),
    ],
    variantesCuarentena: inconsistent ? [] : [
      { id: "V-OLD", productId: "PR01", producto: "Momo Gatito", figura: "Lizi", sabor: "Milo", disponibles: 2, vence: "2026-07-20" },
    ],
    inventory_reservations: [], production_batches: [],
    figuras: [{ id: "F-LIZI", nombre: "Lizi", productId: "PR01", activo: true }],
    settings: { figuras: [], saboresFrutales: ["Coco"], saboresCremosos: ["Oreo", "Milo"] },
  };
}

function exactStockBySurface(db) {
  const finished = buildCanonicalFinishedStock(db, { today: TODAY });
  const canonicalVariants = canonicalVariantsForAvailability(db, { today: TODAY });
  const productFlavor = finished.figureSummaries
    .find((row) => row.figura === "Lizi")?.flavors
    .find((row) => row.sabor === "Coco")?.available || 0;
  const production = buildFinishedStockSummary({
    products: db.products, variants: db.variantes,
    quarantinedVariants: db.variantesCuarentena,
    productionBatches: db.production_batches, today: TODAY,
  });
  const productionFlavor = production[0]?.variants
    .filter((row) => row.figura === "Lizi" && row.sabor === "Coco")
    .reduce((sum, row) => sum + Number(row.disponibles || 0), 0) || 0;
  const orders = evaluateExactVariantDemand({
    productId: "PR01", productName: "Momo Gatito", figure: "Lizi", flavor: "Coco",
    quantity: 1, variants: canonicalVariants, today: TODAY,
  }).available;
  const momobot = momobotContextAnswer("Cuántas Lizi de Coco tenemos", {
    figures: db.figuras, flavors: [{ nombre: "Coco" }], variants: canonicalVariants,
    products: db.products, inventory: [], orders: [], batches: [], suggestions: [],
  });
  return {
    Pedidos: orders,
    Productos: productFlavor,
    Produccion: productionFlavor,
    Momobot: momobot?.magnitude?.value,
    Agencia: agencyExactVariantStock(db, {
      productId: "PR01", figure: "Lizi", flavor: "Coco", today: TODAY,
    }),
  };
}

test("contrato: Pedidos, CRM y Finanzas devuelven el mismo total cobrado", () => {
  const { db, order } = orderFixture();
  const expected = 44000;
  const surfaces = {
    Pedidos: calculateOrderMoney(db, order).totalCharged,
    CRM: customerOrderTotal(db, order),
    Finanzas: financeOrderTotal(db, order),
  };
  assert.deepEqual(surfaces, { Pedidos: expected, CRM: expected, Finanzas: expected });
});

test("contrato: Pedidos, Productos, Producción, Momobot y Agencia devuelven el mismo stock exacto vendible", () => {
  const surfaces = exactStockBySurface(stockFixture());
  assert.deepEqual(surfaces, {
    Pedidos: 4, Productos: 4, Produccion: 4, Momobot: 4, Agencia: 4,
  });
});

test("contrato adversarial: ninguna superficie promete detalle exacto que contradiga el contador oficial", () => {
  const surfaces = exactStockBySurface(stockFixture({ inconsistent: true }));
  assert.deepEqual(surfaces, {
    Pedidos: 0, Productos: 0, Produccion: 0, Momobot: 0, Agencia: 0,
  });
});
