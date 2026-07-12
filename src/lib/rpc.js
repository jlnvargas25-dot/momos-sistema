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

/* ── Fase 3 · slice 3c: reclamos, domicilios y clientes ──
   crear_reclamo ya transiciona el pedido a 'Reclamo' y audita server-side (no llamar setOrderStatusRemoto aparte). */

export async function crearReclamo(orderId, tipo, descr) {
  const { data, error } = await supabase.rpc("crear_reclamo", { p_order_id: orderId, p_tipo: tipo, p_descr: descr });
  if (error) throw new Error(error.message);
  return data; // {claim_id}
}

export async function setReclamoEstado(claimId, estado) {
  const { data, error } = await supabase.rpc("set_reclamo_estado", { p_claim_id: claimId, p_estado: estado });
  if (error) throw new Error(error.message);
  return data; // {ok, estado}
}

export async function editarReclamo(claimId, payload) {
  const { data, error } = await supabase.rpc("editar_reclamo", { p_claim_id: claimId, p: payload });
  if (error) throw new Error(error.message);
  return data; // {ok}
}

export async function crearDomicilio(orderId, proveedor, zona, costoReal, obs) {
  const { data, error } = await supabase.rpc("crear_domicilio", { p_order_id: orderId, p_proveedor: proveedor, p_zona: zona, p_costo_real: costoReal, p_obs: obs });
  if (error) throw new Error(error.message);
  return data; // delivery_id
}

export async function actualizarDomicilio(deliveryId, payload) {
  const { error } = await supabase.rpc("actualizar_domicilio", { p_delivery_id: deliveryId, p: payload });
  if (error) throw new Error(error.message);
}

export async function upsertCliente(customerId, payload) {
  const { data, error } = await supabase.rpc("upsert_cliente", { p_customer_id: customerId || null, p: payload });
  if (error) throw new Error(error.message);
  return data; // customer_id
}

/* ── Fase 3 · slice 4: producción (lotes) e inventario (WAC) ──
   crear_lote NO bloquea por faltantes de insumo (paridad-maqueta): faltantes[]
   es un AVISO post-hecho, nunca motivo para abortar en el front. */

export async function crearLote(payload) {
  const { data, error } = await supabase.rpc("crear_lote", { p: payload });
  if (error) throw new Error(error.message);
  return data; // {batch_id, faltantes:[{item_id,insumo,faltan,unidad}], idempotente?}
}

/* ── Producción v2: corrida = un sabor + cantidades por figura (mezcla especies) ──
   El server deriva figura→producto y crea los lotes hijos; crear_lote de arriba
   queda vivo para lotes viejos/otros flujos, pero el form de Producción ya usa esto. */

export async function crearCorrida(payload) {
  const { data, error } = await supabase.rpc("crear_corrida", { p: payload });
  if (error) throw new Error(error.message);
  return data; // {corrida_id, lotes:[{batch_id,product_id,prod,gramaje_g}], faltantes:[{item_id,insumo,faltan,unidad}], idempotente?}
}

export async function desmoldarLote(batchId, perfectas, imperfectas, descartadas, figuras = null) {
  // figuras (variantes-v1): lote MIXTO exige conteos por figura [{figura,perfectas,imperfectas,descartadas}];
  // en lote de 1 figura se omite y el server auto-deriva (firma retrocompatible, p_figuras default null).
  const params = { p_batch_id: batchId, p_perfectas: perfectas, p_imperfectas: imperfectas, p_descartadas: descartadas };
  if (figuras) params.p_figuras = figuras;
  const { data, error } = await supabase.rpc("desmoldar_lote", params);
  if (error) throw new Error(error.message);
  return data; // {ok, estado:'Listo'}
}

export async function setLoteEstado(batchId, estado) {
  const { data, error } = await supabase.rpc("set_lote_estado", { p_batch_id: batchId, p_estado: estado });
  if (error) throw new Error(error.message);
  return data; // {ok, estado, sin_cambio?}
}

export async function empezarCongelamiento(batchId) {
  const { data, error } = await supabase.rpc("empezar_congelamiento", { p_batch_id: batchId });
  if (error) throw new Error(error.message);
  return data; // {ok, estado}
}

export async function convertirImperfectas(batchId) {
  const { data, error } = await supabase.rpc("convertir_imperfectas", { p_batch_id: batchId });
  if (error) throw new Error(error.message);
  return data; // {ok}
}

export async function crearInsumo(payload) {
  const { data, error } = await supabase.rpc("crear_insumo", { p: payload });
  if (error) throw new Error(error.message);
  return data; // {item_id, costo}
}

export async function entradaInsumo(itemId, cant, costoTotal, nota = "") {
  const { data, error } = await supabase.rpc("entrada_insumo", { p_item_id: itemId, p_cant: cant, p_costo_total: costoTotal, p_nota: nota });
  if (error) throw new Error(error.message);
  return data; // {stock, costo}
}

export async function movimientoInsumo(itemId, tipo, cant, nota = "") {
  const { data, error } = await supabase.rpc("movimiento_insumo", { p_item_id: itemId, p_tipo: tipo, p_cant: cant, p_nota: nota });
  if (error) throw new Error(error.message);
  return data; // {stock, aplicado, truncado?}
}

/* ── Componentes + BOM (hito 2): producción de bases/subrecetas ──
   producir_subreceta NO bloquea por faltantes (paridad crear_lote/crear_corrida):
   faltantes[] es un AVISO post-hecho. El server aplica el WAC al item de la base. */

export async function producirSubreceta(payload) {
  const { data, error } = await supabase.rpc("producir_subreceta", { p: payload });
  if (error) throw new Error(error.message);
  return data; // {ok, id, costo_batch, gramos_obtenidos, faltantes:[{item_id,insumo,faltan,unidad}], idempotente?}
}

export async function setSugerenciaEstado(sugId, estado) {
  const { error } = await supabase.rpc("set_sugerencia_estado", { p_sug_id: sugId, p_estado: estado });
  if (error) throw new Error(error.message);
}
