import test from "node:test";
import assert from "node:assert/strict";
import {
  businessDateISO, buildCanonicalFinishedStock, calculateOrderAttributionRevenue,
  calculateOrderMoney, canonicalUsableIngredientStock,
} from "./canonical-calculations.js";
import { customerOrderTotal } from "./customer-crm.js";
import { financeOrderTotal } from "./operational-finance.js";
import { buildSalesReceptionAssistant } from "./sales-reception-assistant.js";
import { calculateSubrecipeBatch } from "./subrecipe-scaling.js";

test("la fecha comercial conserva el día de Cali después del cambio UTC", () => {
  assert.equal(businessDateISO("2026-07-21T00:30:00.000Z"), "2026-07-20");
  assert.equal(businessDateISO("2026-07-21T05:01:00.000Z"), "2026-07-21");
});

test("Pedidos, Finanzas, CRM y Ventas comparten el total monetario exacto", () => {
  const order = {
    id: "P-CANON", customerId: "C-CANON", fecha: "2026-07-20", hora: "10:00",
    estado: "Pendiente de pago", descuento: 500, domCobrado: 5000, pago: "Nequi",
    canal: "WhatsApp", direccion: "Calle 1", barrio: "Caney",
  };
  const db = {
    orders: [order],
    order_items: [
      { id: "L-1", orderId: order.id, productId: "P-1", cant: 2, precio: 18000, adiciones: [{ precio: 2000, cant: 1 }] },
      { id: "L-2", orderId: order.id, parentItemId: "BOX", esSubMomo: true, productId: "P-1", cant: 1, precio: 0, adiciones: [{ precio: 1500, cant: 1 }] },
    ],
    products: [{ id: "P-1", nombre: "Producto", tipo: "pedido", activo: true }],
    customers: [{ id: order.customerId, nombre: "Ana", telefono: "300", direccion: "Calle 1", barrio: "Caney" }],
    evidences: [], benefits: [], variantes: [], variantesCuarentena: [],
    inventory_reservations: [], production_batches: [], figuras: [], settings: { figuras: [] },
  };
  const expected = 46000;
  assert.equal(calculateOrderMoney(db, order).totalCharged, expected);
  assert.equal(customerOrderTotal(db, order), expected);
  assert.equal(financeOrderTotal(db, order), expected);
  assert.equal(buildSalesReceptionAssistant(db, { today: "2026-07-20" }).queue[0].total, expected);
  assert.equal(calculateOrderAttributionRevenue(db, order), 36000);
});

test("el stock utilizable nunca incluye lotes vencidos aunque el agregado físico sí", () => {
  const db = {
    inventory_items: [{ id: "I05", nombre: "Ganache", stock: 10, unidad: "kg" }],
    inventory_lots: [{ id: "IL-1", itemId: "I05", available: 10, expiresAt: "2026-07-19" }],
    inventoryLotsReady: true,
  };
  const stock = canonicalUsableIngredientStock(db, "I05", { today: "2026-07-20" });
  assert.equal(stock.physical, 10);
  assert.equal(stock.usable, 0);
  assert.equal(stock.expired, 10);

  const formula = calculateSubrecipeBatch({
    subrecipe: { id: "SR-1", mermaPct: 0 },
    ingredients: [{ subrecetaId: "SR-1", itemId: "I05", cantidad: 1 }],
    inventory: db.inventory_items,
    inventoryLots: db.inventory_lots,
    inventoryLotsReady: true,
    today: "2026-07-20",
    desiredOutputGrams: 1000,
  });
  assert.equal(formula.components[0].physicalStock, 10);
  assert.equal(formula.components[0].stock, 0);
  assert.equal(formula.canPrepare, false);
});

test("producto terminado bloquea el detalle exacto que excede el contador oficial", () => {
  const db = {
    products: [{ id: "PR01", nombre: "Momo Gatito", tipo: "momo", activo: true, stock: 0 }],
    variantes: [{ productId: "PR01", figura: "Lizi", sabor: "Coco", disponibles: 5, vence: "2026-07-20" }],
    variantesCuarentena: [], inventory_reservations: [], production_batches: [],
    figuras: [{ id: "F1", nombre: "Lizi", productId: "PR01", activo: true }],
    settings: { figuras: [] },
  };
  const stock = buildCanonicalFinishedStock(db, { today: "2026-07-20" });
  assert.equal(stock.summary.reconciliationBlocked, 5);
  assert.equal(stock.summary.exactAvailable, 0);
  assert.equal(stock.figureSummaries.find((row) => row.figura === "Lizi").available, 0);
});
