import { supabase } from "./supabase.js";
import { isMissingRpcError } from "./rpc.js";
import { normalizeCommercialPilotSnapshot } from "./commercial-pilot.js";

function toError(error, fallback) {
  const next = new Error(error?.message || fallback);
  if (error?.code) next.code = error.code;
  next.cause = error;
  return next;
}

async function call(name, args, fallback) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw toError(error, fallback);
  return data;
}

export async function fetchCommercialPilotSnapshot() {
  let result = await supabase.rpc("momos_commercial_pilot_snapshot_v2");
  if (result.error && isMissingRpcError(result.error)) result = await supabase.rpc("momos_commercial_pilot_snapshot_v1");
  if (result.error && isMissingRpcError(result.error)) {
    throw new Error("El control del piloto está pendiente de activación en este servidor.");
  }
  if (result.error) throw toError(result.error, "No se pudo consultar el piloto comercial.");
  return normalizeCommercialPilotSnapshot(result.data);
}

export function prepareCommercialPilot(draft) {
  const production = draft.environment === "Produccion";
  return call("preparar_piloto_comercial_v1", {
    p: {
      contract: "momos.commercial-pilot.prepare.v1",
      pilot_key: draft.pilotKey,
      environment: draft.environment,
      planned_orders: Number(draft.plannedOrders),
      max_order_total: Number(draft.maxOrderTotal),
      starts_at: new Date(draft.startsAt).toISOString(),
      expires_at: new Date(draft.expiresAt).toISOString(),
      ...(production ? { production_confirmation: "PREPARAR_PILOTO_CERRADO_SIN_ABRIR_TRAFICO" } : {}),
    },
  }, "No se pudo preparar el piloto.");
}

export function signCommercialPilot(pilot, signoff) {
  return call("firmar_piloto_comercial_v1", {
    p_pilot: pilot.id,
    p_area: signoff.area,
    p_evidence_code: signoff.evidenceCode,
    p_expected_version: pilot.version,
  }, "No se pudo registrar la aprobación.");
}

export function startCommercialPilot(pilot) {
  return call("iniciar_piloto_comercial_v1", {
    p_pilot: pilot.id,
    p_expected_version: pilot.version,
    p_confirmation: pilot.environment === "Produccion" ? "INICIAR_PILOTO_CERRADO_PRODUCCION" : "",
  }, "No se pudo iniciar el piloto.");
}

export function linkCommercialPilotOrder(pilotId, orderId, idempotencyKey) {
  return call("vincular_pedido_piloto_comercial_v1", {
    p_pilot: pilotId,
    p_order_id: orderId,
    p_idempotency_key: idempotencyKey,
  }, "No se pudo vincular el pedido.");
}

export function reconcileCommercialPilotOrder(pilotId, orderId) {
  return call("conciliar_pedido_piloto_comercial_v1", { p_pilot: pilotId, p_order_id: orderId }, "No se pudo conciliar el pedido.");
}

export function closeCommercialPilot(pilot) {
  return call("cerrar_piloto_comercial_v1", { p_pilot: pilot.id, p_expected_version: pilot.version }, "No se pudo cerrar el piloto.");
}

export function abortCommercialPilot(pilot) {
  return call("abortar_piloto_comercial_v1", {
    p_pilot: pilot.id,
    p_expected_version: pilot.version,
    p_confirmation: "ABORTAR_PILOTO_SIN_REVERTIR_PEDIDOS",
  }, "No se pudo abortar el piloto.");
}
