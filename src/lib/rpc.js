import { supabase } from "./supabase";

/* ── Fase 3 · slice 3b: escrituras del ciclo de pedido ──
   El server es el árbitro (RPCs security definer de Fase 2, gate is_staff()).
   Los mensajes de error del server ya vienen en español listos para mostrar (error.message).
   El front NUNCA manda precios (salvo adiciones.precio): el server los calcula y snapshotea. */

export async function crearPedido(payload) {
  const { data, error } = await supabase.rpc("crear_pedido", { p: payload });
  if (error) throw new Error(error.message);
  return data; // {order_id, subtotal, descuento, dom_cobrado, total, faltantes}
}

export async function setOrderStatusRemoto(orderId, estado, ventaRapida = false) {
  const { data, error } = await supabase.rpc("set_order_status", { p_order_id: orderId, p_estado: estado, p_venta_rapida: ventaRapida });
  if (error) throw new Error(error.message);
  return data; // {ok, de, a, faltantes:[{producto,cant,area,item_id?}]}
}

// Evidencias: foto al bucket privado + RPC crear_evidencia (asigna id, deriva user de auth.uid() y audita server-side).
// La gate de set_order_status lee la FILA en evidences — sin fila no hay transición.
export async function subirEvidencia({ orderId, tipo, dataUrl }) {
  const blob = await (await fetch(dataUrl)).blob();
  const path = orderId + "/" + Date.now() + "-" + tipo.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".jpg";
  const up = await supabase.storage.from("evidencias").upload(path, blob, { contentType: "image/jpeg" });
  if (up.error) throw new Error("No se pudo subir la foto: " + up.error.message);
  const { data, error } = await supabase.rpc("crear_evidencia", { p_order_id: orderId, p_tipo: tipo, p_storage_path: path });
  if (error) throw new Error("La foto subió pero no se pudo registrar: " + error.message);
  return data; // id de la evidencia (E01, E02…)
}
