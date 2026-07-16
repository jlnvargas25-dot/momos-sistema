import { auditSupplyChainSnapshot } from "./supply-chain-integrity.js";
import { buildSalesReceptionAssistant } from "./sales-reception-assistant.js";
import { buildPurchaseAssistant } from "./purchase-assistant.js";
import { buildOperationalFinance } from "./operational-finance.js";
import { buildKitchenProductionPlan } from "./production-planner.js";
import { buildPackingQueue } from "./packing-queue.js";

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, info: 3 };

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function task(base) {
  return {
    entityId: "",
    entityType: "",
    severity: "medium",
    blocks: false,
    confidence: "Alta",
    confirmationRequired: true,
    reasons: [],
    ...base,
  };
}

function sortTasks(left, right) {
  return (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9)
    || Number(right.blocks) - Number(left.blocks)
    || String(left.area).localeCompare(String(right.area))
    || String(left.id).localeCompare(String(right.id));
}

function salesTasks(sales) {
  return sales.queue.map((row) => task({
    id: `sales-${row.orderId}`,
    area: "Ventas y Recepción",
    module: "Pedidos",
    ownerRoles: ["Cajero", "Coordinador de pedidos", "Administrador"],
    entityId: row.orderId,
    entityType: "Pedido",
    severity: row.hasEvidence || row.missing.length ? "high" : row.priority === "Alta" ? "high" : "medium",
    blocks: row.missing.length > 0,
    title: row.action,
    detail: `${row.orderId} · ${row.customer?.nombre || "cliente sin nombre"} · ${row.stock.label}.`,
    nextAction: row.action,
    reasons: [
      row.hasEvidence ? "Existe un comprobante real esperando validación." : "El pago todavía no está confirmado.",
      row.missing.length ? `Faltan ${row.missing.join(", ")}.` : "Los datos mínimos del pedido están completos.",
      row.stock.status === "shortage" ? "El stock exacto es insuficiente; al pagar debe generarse la sugerencia de producción." : row.stock.label,
    ],
  }));
}

function kitchenTasks(kitchen) {
  const runs = kitchen.plans.map((plan) => task({
    id: `kitchen-${plan.id}`,
    area: "Cocina",
    module: "Producción",
    ownerRoles: ["Cocina", "Administrador"],
    entityId: plan.id,
    entityType: "Corrida",
    severity: plan.queueUnits > 0 ? "high" : "medium",
    blocks: !plan.canCreate,
    confidence: plan.queueUnits > 0 ? "Alta" : "Media",
    title: `Producir ${plan.totalUnits} de ${plan.flavor}`,
    detail: `${plan.variants.map((variant) => `${variant.recommended}× ${variant.figure}`).join(" · ")} · ${plan.filling || "sin relleno"}.`,
    nextAction: plan.suggestionIds.length > 1 ? "Crear una sola corrida agrupada y confirmar responsable." : "Revisar y crear la corrida recomendada.",
    reasons: [
      plan.queueUnits > 0 ? `${plan.queueUnits} unidad(es) vienen de pedidos pagados.` : "La recomendación viene del pronóstico de venta de 3 días.",
      `${plan.availableUnits} disponibles y ${plan.inProcessUnits} en proceso fueron descontadas.`,
      plan.adSignals.length ? `Pauta respaldada: ${plan.adSignals.join(", ")}.` : "La pauta no agregó demanda sin ventas atribuidas.",
    ],
  }));
  const preparations = kitchen.preparationNeeds.map((need) => task({
    id: `preparation-${need.subrecipeId}`,
    area: "Cocina",
    module: "Producción",
    ownerRoles: ["Cocina", "Administrador"],
    entityId: need.subrecipeId,
    entityType: "Elaboración interna",
    severity: need.severity === "Crítica" ? "critical" : "high",
    blocks: need.shortage > 0,
    title: `Preparar ${need.recommendedGrams} g de ${need.subrecipeName}`,
    detail: `Hay ${need.current} ${need.unit}; las corridas requieren ${need.required} ${need.unit}.`,
    nextAction: "Abrir la fórmula, verificar insumos y registrar el rendimiento real.",
    reasons: need.reasons.length ? need.reasons : ["La preparación quedará por debajo del mínimo."],
  }));
  return [...preparations, ...runs];
}

function purchaseTasks(purchases) {
  const recommendations = purchases.recommendations.map((row) => task({
    id: `purchase-${row.itemId}`,
    area: "Compras",
    module: "Inventario",
    ownerRoles: ["Cocina", "Administrador"],
    entityId: row.itemId,
    entityType: "Insumo",
    severity: row.priority === "Urgente" ? "critical" : row.priority === "Alta" ? "high" : "medium",
    blocks: row.pendingDemand > 0 && row.current <= 0,
    title: `Comprar ${row.quantity} ${row.unit} de ${row.name}`,
    detail: `${row.supplier} · costo estimado ${Math.round(row.estimatedCost).toLocaleString("es-CO")}.`,
    nextAction: "Confirmar proveedor, cantidad y precio; después registrar la compra y su lote.",
    reasons: row.reasons,
  }));
  const configuration = purchases.internalNeedsSetup.map((row) => task({
    id: `internal-formula-${row.itemId}`,
    area: "Cocina",
    module: "Inventario",
    ownerRoles: ["Administrador", "Cocina"],
    entityId: row.itemId,
    entityType: "Insumo de elaboración",
    severity: "critical",
    blocks: true,
    title: `Definir la receta o el origen de ${row.name}`,
    detail: `${row.name} tiene ${row.current} de stock y un mínimo de ${row.minimum}. Está marcada como elaboración propia, pero no existe una fórmula vinculada.`,
    nextAction: "Si Cocina la prepara, crear o activar su fórmula; si llega lista de un proveedor, cambiarla a compra externa.",
    reasons: [
      `Stock actual ${row.current}; mínimo operativo ${row.minimum}.`,
      "MOMOS OPS no la enviará a Compras mientras figure como producción propia.",
      "Sin fórmula tampoco puede calcular ingredientes, costo ni rendimiento de una tanda.",
    ],
  }));
  return [...configuration, ...recommendations];
}

function packingTasks(packing) {
  const pending = packing.pending.map((order) => task({
    id: `packing-${order.id}`,
    area: "Empaque",
    module: "Empaque",
    ownerRoles: ["Empaque", "Administrador"],
    entityId: order.id,
    entityType: "Pedido",
    severity: "high",
    title: `Verificar y empacar ${order.id}`,
    detail: "Cocina entregó la comanda; falta cotejar líneas y completar las evidencias de empaque.",
    nextAction: "Abrir el pedido, verificar contenido y tomar las fotos de caja abierta y sello.",
    reasons: ["El pedido está Listo para empaque.", "No puede avanzar sin verificación y evidencias del pedido exacto."],
  }));
  const packed = packing.packed.map((order) => task({
    id: `handoff-offer-${order.id}`,
    area: "Empaque",
    module: "Empaque",
    ownerRoles: ["Empaque", "Administrador"],
    entityId: order.id,
    entityType: "Pedido",
    severity: "medium",
    title: `Preparar relevo de ${order.id}`,
    detail: "El pedido está empacado, pero todavía no fue ofrecido formalmente a Logística.",
    nextAction: "Confirmar etiqueta, domicilio y ofrecer el paquete a Logística.",
    reasons: ["El cierre de Empaque no equivale a entrega física."],
  }));
  const handoff = packing.handoff.map((order) => task({
    id: `handoff-accept-${order.id}`,
    area: "Logística",
    module: "Empaque",
    ownerRoles: ["Logística", "Administrador"],
    entityId: order.id,
    entityType: "Pedido",
    severity: "high",
    title: `Aceptar físicamente ${order.id}`,
    detail: "Empaque terminó, pero Logística todavía no ha aceptado el relevo.",
    nextAction: "Comparar paquete y etiqueta; después aceptar el relevo con el sello del pedido.",
    reasons: ["La trazabilidad permanece abierta hasta la aceptación física."],
  }));
  return [...pending, ...packed, ...handoff];
}

function financeTasks(finance, salesOrderIds) {
  return finance.queue.filter((row) => !(row.id.startsWith("verify-payment-") && salesOrderIds.has(row.orderId))).map((row) => task({
    id: `finance-${row.id}`,
    area: "Finanzas",
    module: "Finanzas",
    ownerRoles: ["Administrador"],
    entityId: row.orderId || row.id,
    entityType: row.orderId ? "Pedido" : "Control financiero",
    severity: row.severity,
    blocks: row.blocksClose,
    title: row.title,
    detail: row.detail,
    nextAction: row.action,
    reasons: [row.category, row.blocksClose ? "Bloquea el cierre del periodo." : "Debe revisarse durante la conciliación."],
  }));
}

function integrityTask(row, index, db) {
  if (row.code === "ORDER_VARIANT_INCOMPLETE") {
    const item = (db.order_items || []).find((candidate) => candidate.id === row.entityId);
    const order = (db.orders || []).find((candidate) => candidate.id === item?.orderId);
    const product = (db.products || []).find((candidate) => candidate.id === item?.productId);
    const missing = [!String(item?.figura || "").trim() && "figura", !String(item?.sabor || "").trim() && "sabor"].filter(Boolean);
    const orderId = order?.id || item?.orderId || "sin pedido identificado";
    const productName = product?.nombre || item?.nombre || "producto MOMOS";
    return task({
      id: `integrity-${row.code}-${orderId}`,
      area: "Control interno",
      module: "Pedidos",
      ownerRoles: ["Cajero", "Coordinador de pedidos", "Administrador"],
      entityId: order?.id || item?.orderId || row.entityId,
      entityType: order?.id || item?.orderId ? "Pedido" : "Línea de pedido",
      severity: "critical",
      blocks: true,
      title: `Completar ${missing.join(" y ") || "la variante"} del pedido ${orderId}`,
      detail: `La línea ${row.entityId} corresponde a ${number(item?.cant) || 1}× ${productName}, pero no define ${missing.join(" ni ") || "su variante exacta"}.`,
      nextAction: `Abrir el pedido ${orderId}, elegir ${missing.join(" y ") || "figura y sabor"} y guardar antes de cobrar, reservar o producir.`,
      reasons: [
        `Dato faltante: ${missing.join(" y ") || "variante exacta"}.`,
        "MOMOS OPS bloquea la línea para no inventar qué figura o sabor pidió el cliente.",
      ],
    });
  }
  return task({
    id: `integrity-${row.code}-${row.entityId || index}`,
    area: "Control interno",
    module: "Historial operativo",
    ownerRoles: ["Administrador"],
    entityId: row.entityId,
    entityType: "Integridad",
    severity: "critical",
    blocks: true,
    title: "Corregir una inconsistencia antes de actuar",
    detail: row.message,
    nextAction: "Abrir la trazabilidad y corregir la fuente; ningún asistente debe compensar el dato inventando otro movimiento.",
    reasons: [`Control ${row.code}.`],
  });
}

export function buildAssistantControlCenter(db = {}, options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const sales = buildSalesReceptionAssistant(db, { today, now: options.now });
  const kitchen = buildKitchenProductionPlan(db, { today, historyDays: 28, horizonDays: 3 });
  const purchases = buildPurchaseAssistant({
    inventoryItems: db.inventory_items || [], inventoryLots: db.inventory_lots || [],
    inventoryLotsReady: db.inventoryLotsReady === true, subrecipes: db.subrecetas || [],
    suggestions: db.production_suggestions || [], movements: db.inventory_movements || [], today,
  });
  const packing = buildPackingQueue(db.orders || [], db.order_dispatch_handoffs || []);
  const finance = buildOperationalFinance(db, { from: options.financeFrom || today, to: options.financeTo || today });
  const integrity = auditSupplyChainSnapshot(db, { today });

  const tasks = [];
  const variantIntegrityOrders = new Set();
  integrity.issues.forEach((row, index) => {
    const contextual = integrityTask(row, index, db);
    if (row.code === "ORDER_VARIANT_INCOMPLETE" && variantIntegrityOrders.has(contextual.entityId)) return;
    if (row.code === "ORDER_VARIANT_INCOMPLETE") variantIntegrityOrders.add(contextual.entityId);
    tasks.push(contextual);
  });

  const salesQueueTasks = salesTasks(sales).filter((row) => !variantIntegrityOrders.has(row.entityId));
  tasks.push(...salesQueueTasks, ...kitchenTasks(kitchen), ...purchaseTasks(purchases), ...packingTasks(packing));
  tasks.push(...financeTasks(finance, new Set(sales.queue.map((row) => row.orderId))));

  const coveredSuggestions = new Set(kitchen.plans.flatMap((plan) => plan.suggestionIds));
  (db.production_suggestions || []).filter((row) => row.estado === "Pendiente" && row.area !== "Inventario"
    && !coveredSuggestions.has(row.id)).forEach((row) => tasks.push(task({
      id: `uncovered-suggestion-${row.id}`,
      area: "Cocina",
      module: "Producción",
      ownerRoles: ["Cocina", "Administrador"],
      entityId: row.id,
      entityType: "Sugerencia de producción",
      severity: "critical",
      blocks: true,
      title: `Completar datos de la recomendación ${row.id}`,
      detail: "Existe una necesidad pagada que el plan de Cocina no pudo convertir en figura, sabor y relleno exactos.",
      nextAction: "Abrir la sugerencia y completar la variante; no crear un lote ambiguo.",
      reasons: [row.orderId ? `Proviene del pedido ${row.orderId}.` : "No conserva pedido de origen.", `${number(row.cantidad)} unidad(es) pendientes.`],
    })));

  if (integrity.finished.summary.withoutVariantDetail > 0) tasks.push(task({
    id: "finished-stock-without-detail",
    area: "Control interno",
    module: "Inventario terminado",
    ownerRoles: ["Administrador", "Cocina"],
    entityType: "Producto terminado",
    severity: "medium",
    confidence: "Alta",
    title: "Reducir stock terminado sin figura o sabor",
    detail: `${integrity.finished.summary.withoutVariantDetail} unidad(es) legacy no pueden prometerse como variante exacta.`,
    nextAction: "Mantenerlas separadas y completar la trazabilidad únicamente mediante nuevos desmoldes.",
    reasons: ["Ventas solo puede ofrecer combinaciones verificables."],
  }));

  tasks.sort(sortTasks);
  const unique = [];
  const seen = new Set();
  tasks.forEach((row) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    unique.push(row);
  });

  const assistantRows = [
    { id: "sales", name: "Ventas y Recepción", module: "Pedidos", count: sales.summary.attention, status: sales.summary.incomplete || sales.summary.evidence ? "Atención" : "Estable" },
    { id: "kitchen", name: "Cocina", module: "Producción", count: kitchen.summary.runs + kitchen.summary.preparations, status: kitchen.preparationNeeds.some((row) => row.shortage > 0) ? "Bloqueado" : kitchen.summary.runs ? "Atención" : "Estable" },
    { id: "purchase", name: "Compras", module: "Inventario", count: purchases.summary.items + purchases.summary.internalNeedsSetup, status: purchases.summary.urgent || purchases.summary.internalNeedsSetup ? "Atención" : "Estable" },
    { id: "packing", name: "Empaque y Logística", module: "Empaque", count: packing.pending.length + packing.packed.length + packing.handoff.length, status: packing.pending.length + packing.packed.length + packing.handoff.length ? "Atención" : "Estable" },
    { id: "finance", name: "Finanzas", module: "Finanzas", count: finance.summary.exceptions, status: finance.summary.blocking ? "Bloqueado" : finance.summary.exceptions ? "Atención" : "Estable" },
  ];
  const critical = unique.filter((row) => row.severity === "critical").length;
  const blocking = unique.filter((row) => row.blocks).length;
  return {
    tasks: unique,
    primary: unique[0] || null,
    assistants: assistantRows,
    summary: {
      tasks: unique.length,
      critical,
      blocking,
      assistantsStable: assistantRows.filter((row) => row.status === "Estable").length,
      integrityIssues: integrity.issues.length,
      health: integrity.issues.length ? "Bloqueado" : blocking ? "Atención" : "Protegido",
    },
    sources: { sales, kitchen, purchases, packing, finance, integrity },
    policy: "Los asistentes recomiendan y priorizan; nunca confirman pagos, compras, sustituciones, producción, despacho o cierres sin una persona autorizada.",
  };
}
