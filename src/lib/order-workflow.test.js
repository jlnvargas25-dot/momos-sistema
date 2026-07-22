import test from "node:test";
import assert from "node:assert/strict";
import { canCreateOrder, canManageDeliveryHandoff, deliveryBlocksNewRequest, orderEvidencePermission, orderIntakePrimaryAction, orderTransitionPermission } from "./order-workflow.js";

test("separa quién puede crear y agendar pedidos", () => {
  ["Administrador", "Cajero", "Coordinador de pedidos", "Empaque"].forEach((role) => assert.equal(canCreateOrder(role), true, role));
  ["Cocina", "Logística", "Marketing/CRM", "Mensajero", ""].forEach((role) => assert.equal(canCreateOrder(role), false, role));
});

test("limita la etiqueta y solicitud de domicilio al relevo Empaque-Logística", () => {
  ["Administrador", "Empaque", "Logística"].forEach((role) => assert.equal(canManageDeliveryHandoff(role), true, role));
  ["Cocina", "Cajero", "Coordinador de pedidos", "Mensajero", "Marketing/CRM", ""].forEach((role) => assert.equal(canManageDeliveryHandoff(role), false, role));
});

test("solo ofrece pedidos que realmente no tienen un domicilio activo", () => {
  ["Por solicitar", "Solicitado", "Asignado", "En ruta", "Entregado"].forEach((estado) => assert.equal(deliveryBlocksNewRequest({ estado }), true, estado));
  ["Problema", "Cancelado", ""].forEach((estado) => assert.equal(deliveryBlocksNewRequest({ estado }), false, estado));
  assert.equal(deliveryBlocksNewRequest(null), false);
});

test("divide las confirmaciones del mismo pedido por área", () => {
  const cases = [
    ["Administrador", "Nuevo", "Confirmado", true],
    ["Empaque", "Nuevo", "Confirmado", true],
    ["Cajero", "Pendiente de pago", "Pagado", true],
    ["Administrador", "Pendiente de pago", "Pagado", true],
    ["Empaque", "Pendiente de pago", "Pagado", false],
    ["Cocina", "Pagado", "En producción", true],
    ["Administrador", "Pagado", "En producción", true],
    ["Cocina", "En producción", "Listo para empaque", true],
    ["Administrador", "En producción", "Listo para empaque", true],
    ["Empaque", "En producción", "Listo para empaque", false],
    ["Empaque", "Listo para empaque", "Empacado", true],
    ["Cocina", "Listo para empaque", "Empacado", false],
    ["Administrador", "Listo para empaque", "Empacado", true],
    ["Empaque", "Empacado", "Listo para despacho", true],
    ["Administrador", "Empacado", "Listo para despacho", true],
    ["Logística", "Listo para despacho", "En ruta", true],
    ["Administrador", "Listo para despacho", "En ruta", true],
    ["Mensajero", "En ruta", "Entregado", true],
    ["Administrador", "En ruta", "Entregado", true],
  ];
  cases.forEach(([role, from, to, allowed]) => assert.equal(orderTransitionPermission(role, from, to).allowed, allowed, `${role}: ${from} → ${to}`));
});

test("reserva cancelaciones, reclamos y entrega inmediata a sus responsables", () => {
  assert.equal(orderTransitionPermission("Coordinador de pedidos", "Pagado", "Cancelado").allowed, true);
  assert.equal(orderTransitionPermission("Cocina", "Pagado", "Cancelado").allowed, false);
  assert.equal(orderTransitionPermission("Marketing/CRM", "Entregado", "Reclamo").allowed, true);
  assert.equal(orderTransitionPermission("Cocina", "Entregado", "Reclamo").allowed, false);
  assert.equal(orderTransitionPermission("Cajero", "Pagado", "Entregado", { quickSale: true }).allowed, true);
  assert.equal(orderTransitionPermission("Administrador", "En producción", "Entregado", { quickSale: true }).allowed, false);
  assert.equal(orderTransitionPermission("Logística", "Empacado", "Entregado", { quickSale: true }).allowed, false);
  assert.equal(orderTransitionPermission("Cajero", "En ruta", "Entregado").allowed, false);
  assert.match(orderTransitionPermission("Administrador", "Pagado", "En producción").reason, /Administrador.*Cocina/);
});

test("asigna cada tipo de foto al área que produce la evidencia", () => {
  assert.equal(orderEvidencePermission("Cajero", "Comprobante de pago").allowed, true);
  assert.equal(orderEvidencePermission("Empaque", "Comprobante de pago").allowed, false);
  assert.equal(orderEvidencePermission("Empaque", "Caja abierta").allowed, true);
  assert.equal(orderEvidencePermission("Administrador", "Caja cerrada con sello").allowed, true);
  assert.equal(orderEvidencePermission("Logística", "Entrega").allowed, true);
  assert.equal(orderEvidencePermission("Administrador", "Entrega").allowed, true);
  assert.equal(orderEvidencePermission("Cocina", "Entrega").allowed, false);
  assert.equal(orderEvidencePermission("Administrador", "Foto inventada").allowed, false);
});

test("un usuario Cocina + Empaque puede cerrar las dos etapas sin heredar Caja", () => {
  const roles = { rol: "Cocina", roles: ["Cocina", "Empaque"] };
  assert.equal(orderTransitionPermission(roles, "Pagado", "En producción").allowed, true);
  assert.equal(orderTransitionPermission(roles, "En producción", "Listo para empaque").allowed, true);
  assert.equal(orderTransitionPermission(roles, "Listo para empaque", "Empacado").allowed, true);
  assert.equal(orderTransitionPermission(roles, "Empacado", "Listo para despacho").allowed, true);
  assert.equal(orderTransitionPermission(roles, "Pendiente de pago", "Pagado").allowed, false);
  assert.equal(orderEvidencePermission(roles, "Caja abierta").allowed, true);
  assert.equal(orderEvidencePermission(roles, "Comprobante de pago").allowed, false);
});

test("Recepción salta el clic redundante de Confirmado", () => {
  const action = orderIntakePrimaryAction("Coordinador de pedidos", { estado: "Nuevo", canal: "WhatsApp", pago: "Nequi" });
  assert.equal(action.type, "transition");
  assert.equal(action.target, "Pendiente de pago");
  assert.equal(action.label, "Pedido revisado · solicitar pago");
});

test("un comprobante válido convierte la única acción en confirmar pago", () => {
  for (const estado of ["Nuevo", "Confirmado", "Pendiente de pago"]) {
    const action = orderIntakePrimaryAction("Cajero", { estado, canal: "WhatsApp", pago: "Nequi" }, { hasPaymentEvidence: true });
    assert.equal(action.type, "transition", estado);
    assert.equal(action.target, "Pagado", estado);
    assert.equal(action.label, "Confirmar pago · enviar a Cocina", estado);
  }
});

test("Rappi puede pasar directo a pago sin exigir foto de transferencia", () => {
  const action = orderIntakePrimaryAction("Administrador", { estado: "Nuevo", canal: "Rappi", pago: "Rappi (app)" });
  assert.equal(action.type, "transition");
  assert.equal(action.target, "Pagado");
});

test("un pedido esperando pago une comprobante y confirmación en una sola acción", () => {
  const action = orderIntakePrimaryAction("Cajero", { estado: "Pendiente de pago", canal: "WhatsApp", pago: "Nequi" });
  assert.equal(action.type, "evidence");
  assert.equal(action.target, "Pagado");
  assert.equal(action.autoAdvance, true);
  assert.equal(action.label, "Tomar comprobante y confirmar pago");
});

test("Empaque puede consultar el pago pero no confirmarlo ni subir su comprobante", () => {
  const ready = orderIntakePrimaryAction("Empaque", { estado: "Pendiente de pago", canal: "WhatsApp", pago: "Nequi" }, { hasPaymentEvidence: true });
  const missing = orderIntakePrimaryAction("Empaque", { estado: "Pendiente de pago", canal: "WhatsApp", pago: "Nequi" });
  assert.equal(ready.type, "wait");
  assert.equal(ready.allowed, false);
  assert.equal(missing.type, "wait");
  assert.equal(missing.allowed, false);
});

test("el botón simplificado no invade estados de Cocina, Empaque o Logística", () => {
  ["Pagado", "En producción", "Listo para empaque", "Empacado", "Listo para despacho", "En ruta", "Entregado"].forEach((estado) => {
    assert.equal(orderIntakePrimaryAction("Administrador", { estado, canal: "WhatsApp" }), null, estado);
  });
});
