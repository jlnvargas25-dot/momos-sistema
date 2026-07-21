import { supabase } from "./supabase.js";

function rpcError(error, fallbackMessage = "No se pudo completar la operación.") {
  const next = new Error(error?.message || fallbackMessage);
  if (error?.code) next.code = error.code;
  if (error?.status) next.status = error.status;
  next.cause = error;
  return next;
}

export function isMissingRpcError(error) {
  return error?.code === "PGRST202"
    || /could not find (?:the )?function|schema cache|function\b.+\bdoes not exist/i.test(error?.message || "");
}

export function createInventoryIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Los navegadores soportados exponen randomUUID. Este fallback conserva el
  // formato UUID para una WebView antigua, sin usar el valor como secreto.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const value = Math.floor(Math.random() * 16);
    return (token === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export async function actualizarPautaFinanciera({ monthlyBudget, from, to }, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error("La actualización financiera no tiene una llave idempotente válida.");
  }
  const { data, error } = await supabase.rpc("actualizar_pauta_financiera_v1", {
    p: {
      idempotency_key: key,
      monthly_budget: Number(monthlyBudget),
      from,
      to,
    },
  });
  if (error) throw rpcError(error, "No se pudo guardar la pauta mensual.");
  return data;
}

export async function guardarConfiguracionServidor(payload, expectedVersion, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error("La actualización de Configuración no tiene una llave idempotente válida.");
  }
  if (!/^\d+$/.test(String(expectedVersion || "")) || String(expectedVersion) === "0") {
    throw new Error("Configuración no tiene una versión autoritativa para guardar.");
  }
  const shelfLifeV2 = Object.prototype.hasOwnProperty.call(payload || {}, "finished_product_shelf_days")
    && Object.prototype.hasOwnProperty.call(payload || {}, "mixture_shelf_days");
  const { data, error } = await supabase.rpc(shelfLifeV2 ? "guardar_configuracion_v2" : "guardar_configuracion_v1", {
    p: { idempotency_key: key, expected_version: String(expectedVersion), payload },
  });
  if (error) throw rpcError(error, "No se pudo guardar Configuración.");
  return data;
}

export async function fetchOperationalHealthSnapshot() {
  const { data, error } = await supabase.rpc("momos_operational_health_snapshot_v1");
  if (error) throw rpcError(error, "No se pudo consultar la salud de MOMO OPS.");
  if (data?.contract !== "momos.operational-health.v1") {
    throw new Error("El servidor devolvió un diagnóstico incompleto.");
  }
  return data;
}

export async function fetchOperationalSloSnapshot(windowMinutes = 60) {
  const minutes = Number(windowMinutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
    throw new Error("La ventana de observabilidad no es válida.");
  }
  const { data, error } = await supabase.rpc("momos_operational_slo_snapshot_v1", {
    p_window_minutes: minutes,
  });
  if (error && isMissingRpcError(error)) {
    return {
      contract: "momos.operational-slo.v1",
      pendingActivation: true,
      services: [],
      counts: { healthy: 0, atRisk: 0, outside: 0, withoutData: 0 },
    };
  }
  if (error) throw rpcError(error, "No se pudieron consultar los SLO de MOMO OPS.");
  if (data?.contract !== "momos.operational-slo.v1" || !Array.isArray(data?.services)) {
    throw new Error("El servidor devolvió observabilidad incompleta.");
  }
  return data;
}

export async function fetchContinuitySnapshot() {
  const { data, error } = await supabase.rpc("momos_continuity_snapshot_v1");
  if (error) throw rpcError(error, "No se pudo consultar la continuidad de MOMO OPS.");
  if (data?.contract !== "momos.continuity.v1") {
    throw new Error("El servidor devolvió una evidencia de continuidad incompleta.");
  }
  return data;
}

export async function runOperationalHealthReview() {
  const { data, error } = await supabase.rpc("ejecutar_revision_salud_operativa_v1");
  if (error) throw rpcError(error, "No se pudo ejecutar la revisión operativa.");
  return data;
}

async function inventoryMutationRpc(name, payload, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error("La operación de Inventario no tiene una llave idempotente válida.");
  }
  const { data, error } = await supabase.rpc(name, { p: { ...payload, idempotency_key: key } });
  if (error) throw rpcError(error);
  // Una respuesta HTTP exitosa puede corresponder a una mutación ya
  // confirmada. La frontera cerrada se valida al aplicar el sobre; si viene
  // corrupto, la UI reconcilia por lectura y jamás repite la escritura.
  return data;
}

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

/* Control operativo v1: todas las escrituras pasan por RPCs con RBAC,
   bloqueo de fila y control de versión en el servidor. */
export async function tomarEtapaPedido(orderId, stage) {
  const { data, error } = await supabase.rpc("tomar_etapa_pedido", { p_order_id: orderId, p_stage: stage });
  if (error) throw new Error(error.message);
  return data;
}

export async function liberarEtapaPedido(orderId, stage, reason = "") {
  const { data, error } = await supabase.rpc("liberar_etapa_pedido", { p_order_id: orderId, p_stage: stage, p_reason: reason });
  if (error) throw new Error(error.message);
  return data;
}

export async function setProgresoLineaPedido(orderItemId, stage, status, expectedVersion = null) {
  const { data, error } = await supabase.rpc("set_progreso_linea_pedido", {
    p_order_item_id: orderItemId, p_stage: stage, p_status: status, p_expected_version: expectedVersion,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function completarEtapaPedido(orderId, stage) {
  const { data, error } = await supabase.rpc("completar_etapa_pedido", { p_order_id: orderId, p_stage: stage });
  if (error) throw new Error(error.message);
  return data;
}

// H91: Cocina completa sus líneas y entrega el pedido a Empaque dentro de la
// misma transacción PostgreSQL. La llave se conserva durante el intento para
// que una respuesta perdida no repita ninguna escritura.
export async function completarCocinaYEntregarEmpaque(orderId, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error("El relevo Cocina a Empaque no tiene una llave idempotente válida.");
  }
  const { data, error } = await supabase.rpc("completar_cocina_y_entregar_empaque_v1", {
    p: { order_id: orderId, idempotency_key: key },
  });
  if (error) throw rpcError(error, "No se pudo entregar el pedido de Cocina a Empaque.");
  return data;
}

export async function crearIncidentePedido(payload) {
  const { data, error } = await supabase.rpc("crear_incidente_pedido", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverIncidentePedido(incidentId, resolution) {
  const { data, error } = await supabase.rpc("resolver_incidente_pedido", { p_incident_id: incidentId, p_resolution: resolution });
  if (error) throw new Error(error.message);
  return data;
}

export async function ofrecerRelevoDespacho(orderId, note = "") {
  const { data, error } = await supabase.rpc("ofrecer_relevo_despacho", { p_order_id: orderId, p_note: note });
  if (error) throw new Error(error.message);
  return data;
}

export async function aceptarRelevoDespacho(orderId) {
  const { data, error } = await supabase.rpc("aceptar_relevo_despacho", { p_order_id: orderId });
  if (error) throw new Error(error.message);
  return data;
}

export async function confirmarVerificacionEmpaque(orderId, lineIds) {
  const { data, error } = await supabase.rpc("confirmar_verificacion_empaque", {
    p_order_id: orderId,
    p_line_ids: lineIds,
  });
  if (error) {
    const missingRpc = error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message || "");
    if (missingRpc) throw new Error("La verificación de Empaque todavía no está instalada en el servidor. Un administrador debe aplicar la migración 09 de Empaque y luego recargar Momo Ops.");
    throw new Error(error.message);
  }
  return data; // {ok, order_id, lineas}
}

// Evidencias: foto al bucket privado + RPC crear_evidencia (asigna id, deriva user de auth.uid() y audita server-side).
// La gate de set_order_status lee la FILA en evidences — sin fila no hay transición.
export async function subirEvidencia({ orderId, tipo, dataUrl }) {
  const blob = await (await fetch(dataUrl)).blob();
  const path = orderId + "/" + Date.now() + "-" + tipo.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".jpg";
  const up = await supabase.storage.from("evidencias").upload(path, blob, { contentType: "image/jpeg" });
  if (up.error) throw new Error("No se pudo subir la foto: " + up.error.message);
  const { data, error } = await supabase.rpc("crear_evidencia", { p_order_id: orderId, p_tipo: tipo, p_storage_path: path });
  if (error) {
    // La fila y el archivo forman una sola unidad lógica. Si la RPC rechaza la
    // evidencia (rol, ruta, duplicado, etc.), retirar el objeto recién subido.
    const cleanup = await supabase.storage.from("evidencias").remove([path]);
    const cleanupNote = cleanup.error ? " No se pudo limpiar el archivo huérfano: " + cleanup.error.message : "";
    throw new Error("La foto subió pero no se pudo registrar: " + error.message + cleanupNote);
  }
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

export async function mutarDomicilioDelta(operation, payload, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!key) throw new Error("La operación logística necesita una llave idempotente.");
  const { data, error } = await supabase.rpc("mutar_domicilio_delta", {
    p: { operation, idempotency_key: key, payload },
  });
  if (error) throw rpcError(error, "No se pudo completar la operación logística.");
  return data;
}

export async function upsertCliente(customerId, payload) {
  const { data, error } = await supabase.rpc("upsert_cliente", { p_customer_id: customerId || null, p: payload });
  if (error) throw new Error(error.message);
  return data; // customer_id
}

export async function guardarPreferenciasCliente(customerId, payload) {
  const { data, error } = await supabase.rpc("guardar_preferencias_cliente", { p_customer_id: customerId, p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearActivacionCliente(payload) {
  const { data, error } = await supabase.rpc("crear_activacion_cliente", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function registrarContactoCliente(payload) {
  const { data, error } = await supabase.rpc("registrar_contacto_cliente", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function convertirActivacionCliente(activationId, orderId) {
  const { data, error } = await supabase.rpc("convertir_activacion_cliente", { p_activation_id: Number(activationId), p_order_id: orderId });
  if (error) throw new Error(error.message);
  return data;
}

export async function activarBeneficioCliente(payload) {
  const { data, error } = await supabase.rpc("activar_beneficio_cliente", { p: payload });
  if (error) throw new Error(error.message);
  return data;
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

export async function crearCorridaDelta(payload) {
  const { data, error } = await supabase.rpc("crear_corrida_delta", { p: payload });
  if (error) throw rpcError(error);
  return data;
}

export async function crearCorridaAgrupada(payload, suggestionIds, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error("La corrida agrupada no tiene una llave idempotente válida.");
  }
  const ids = Array.isArray(suggestionIds) ? suggestionIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  if (!ids.length || new Set(ids).size !== ids.length) {
    throw new Error("La corrida agrupada necesita sugerencias únicas.");
  }
  const { data, error } = await supabase.rpc("crear_corrida_agrupada_v1", {
    p: { idempotency_key: key, corrida: payload, suggestion_ids: ids },
  });
  if (error) throw rpcError(error, "No se pudo registrar la corrida agrupada.");
  return data;
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

export async function convertirImperfectasDelta(batchId, idempotencyKey) {
  const { data, error } = await supabase.rpc("convertir_imperfectas_delta", {
    p: { batch_id: batchId, idempotency_key: idempotencyKey },
  });
  if (error) throw rpcError(error);
  return data;
}

export async function crearInsumo(payload) {
  const { data, error } = await supabase.rpc("crear_insumo", { p: payload });
  if (error) throw new Error(error.message);
  return data; // {item_id, costo}
}

export async function setColchonProduccion(productId, colchon) {
  const { data, error } = await supabase.rpc("set_colchon_produccion", { p_product_id: productId, p_colchon: colchon });
  if (error) throw new Error(error.message);
  return data; // {ok, colchon, cambio}
}

/* ── Productos servidor v1 (migración 13) ── */
export async function crearProducto(payload) {
  const { data, error } = await supabase.rpc("crear_producto", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function editarProducto(productId, payload) {
  const { data, error } = await supabase.rpc("editar_producto", { p_id: productId, p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function setProductoActivo(productId, activo) {
  const { data, error } = await supabase.rpc("set_producto_activo", { p_id: productId, p_activo: activo });
  if (error) throw new Error(error.message);
  return data;
}

export async function guardarRecetaProducto(productId, lines) {
  const { data, error } = await supabase.rpc("guardar_receta_producto", {
    p_product_id: productId,
    p_lineas: lines.map((line) => ({ item_id: line.itemId, cantidad: Number(line.cantidad) })),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function sincronizarCostoProducto(productId) {
  const { data, error } = await supabase.rpc("sincronizar_costo_producto", { p_product_id: productId });
  if (error) throw new Error(error.message);
  return data;
}

export async function mutarCatalogoCrmDelta(operation, payload, idempotencyKey) {
  const { data, error } = await supabase.rpc("mutar_catalogo_crm_delta", {
    p: { operation, payload, idempotency_key: idempotencyKey },
  });
  if (error) throw rpcError(error);
  return data;
}

export async function crearUsuarioStaff(nombre, email, rol) {
  const { data, error } = await supabase.rpc("crear_usuario_staff", { p_nombre: nombre, p_email: email, p_rol: rol });
  if (error) throw new Error(error.message);
  return data; // Crea el usuario o acumula el rol sobre el correo existente.
}

export async function quitarRolUsuario(userId, rol) {
  const { data, error } = await supabase.rpc("quitar_rol_usuario", { p_user_id: userId, p_rol: rol });
  if (error) throw new Error(error.message);
  return data;
}

export async function setUserActivo(userId, activo) {
  const { data, error } = await supabase.rpc("set_user_activo", { p_user_id: userId, p_activo: activo });
  if (error) throw new Error(error.message);
  return data; // {ok, activo, cambio}
}

// Marketing Hito 2: gate is_staff() is not true (server). productoFocoId → id crudo.
export async function crearCampana(payload) {
  const { data, error } = await supabase.rpc("crear_campana", { p: payload });
  if (error) throw new Error(error.message);
  return data; // {ok, id}
}

// PATCH real: solo las claves presentes se aplican; ausentes se conservan.
export async function editarCampana(id, payload) {
  const { data, error } = await supabase.rpc("editar_campana", { p_id: id, p: payload });
  if (error) throw new Error(error.message);
  return data; // {ok, cambio_estado}
}

export async function setCampanaEstado(id, estado) {
  const { data, error } = await supabase.rpc("set_campana_estado", { p_id: id, p_estado: estado });
  if (error) throw new Error(error.message);
  return data; // {ok, de, a, cambio}
}

/* ── Marketing contenido v1: Creativos, Calendario y Resultados ──
   Resultados manda solo métricas de plataforma. Pedidos/ventas se derivan de
   orders en el read-model del front; jamás forman parte del payload. */

export async function crearCreativo(payload) {
  const { data, error } = await supabase.rpc("crear_creativo", { p: payload });
  if (error) throw new Error(error.message);
  return data; // {ok, id}
}

// PATCH real: solo las claves presentes se aplican.
export async function editarCreativo(id, payload) {
  const { data, error } = await supabase.rpc("editar_creativo", { p_id: id, p: payload });
  if (error) throw new Error(error.message);
  return data; // {ok, cambio_estado}
}

export async function crearPublicacion(payload) {
  const { data, error } = await supabase.rpc("crear_publicacion", { p: payload });
  if (error) throw new Error(error.message);
  return data; // {ok, id}
}

export async function setPublicacionEstado(id, estado) {
  const { data, error } = await supabase.rpc("set_publicacion_estado", { p_id: id, p_estado: estado });
  if (error) throw new Error(error.message);
  return data; // {ok, de, a, cambio}
}

export async function registrarMetricasCreativo(payload) {
  const { data, error } = await supabase.rpc("registrar_metricas_creativo", { p: payload });
  if (error) throw new Error(error.message);
  return data; // {ok, id, actualizado}
}

/* ── Distribución Comercial MOMOS v1 (migración 19) ── */
export async function guardarPreparacionDistribucion(postId, checklist, notes = "") {
  const { data, error } = await supabase.rpc("guardar_preparacion_distribucion", { p_post_id: postId, p_checklist: checklist, p_notes: notes });
  if (error) throw new Error(error.message);
  return data;
}

export async function aprobarDistribucion(postId) {
  const { data, error } = await supabase.rpc("aprobar_distribucion", { p_post_id: postId });
  if (error) throw new Error(error.message);
  return data;
}

export async function cerrarDistribucionPublicacion(postId, result, externalUrl = "", externalPostId = "", note = "") {
  const { data, error } = await supabase.rpc("cerrar_distribucion_publicacion", {
    p_post_id: postId, p_result: result, p_external_url: externalUrl, p_external_post_id: externalPostId, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

/* ── Distribución por conectores MOMOS v1 (migración 29) ── */
export async function autorizarDespachoDistribucion(postId, mode = null) {
  const { data, error } = await supabase.rpc("autorizar_despacho_distribucion", { p_post_id: postId, p_mode: mode });
  if (error) throw new Error(error.message);
  return data;
}

export async function reintentarDespachoDistribucion(jobId) {
  const { data, error } = await supabase.rpc("reintentar_despacho_distribucion", { p_job_id: jobId });
  if (error) throw new Error(error.message);
  return data;
}

/* ── Agencia Comercial MOMOS v1 (migración 16) ── */
export async function guardarConfiguracionAgencia(payload) {
  const { data, error } = await supabase.rpc("guardar_configuracion_agencia", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearBriefAgencia(payload) {
  const { data, error } = await supabase.rpc("crear_brief_agencia", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function registrarSnapshotMotorCrecimiento(payload) {
  const { data, error } = await supabase.rpc("registrar_snapshot_motor_crecimiento", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function seleccionarModoCrecimiento(snapshotId, modeKey, objective) {
  const { data, error } = await supabase.rpc("seleccionar_modo_crecimiento", {
    p_snapshot_id: snapshotId, p_mode_key: modeKey, p_objective: objective,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function setEstadoBriefAgencia(briefId, status, note = "") {
  const { data, error } = await supabase.rpc("set_estado_brief_agencia", { p_brief_id: briefId, p_status: status, p_note: note });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearDecisionAgencia(payload) {
  const { data, error } = await supabase.rpc("crear_decision_agencia", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverDecisionAgencia(decisionId, status, result = "") {
  const { data, error } = await supabase.rpc("resolver_decision_agencia", { p_decision_id: decisionId, p_status: status, p_result: result });
  if (error) throw new Error(error.message);
  return data;
}

export async function registrarResultadoAccionAgencia(payload) {
  const { data, error } = await supabase.rpc("registrar_resultado_accion_agencia", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function registrarRecomendacionOrquestador(payload) {
  const { data, error } = await supabase.rpc("registrar_recomendacion_orquestador", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverPropuestaOrquestador(proposalId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_propuesta_orquestador", { p_proposal_id: proposalId, p_decision: decision, p_note: note });
  if (error) throw new Error(error.message);
  return data;
}

export async function abrirMesaAgencia(payload) {
  const { data, error } = await supabase.rpc("abrir_mesa_agencia", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function agregarAporteMesaAgencia(roomId, entryKey, entryType, body, payload = {}) {
  const { data, error } = await supabase.rpc("agregar_aporte_mesa_agencia", {
    p_room_id: roomId, p_entry_key: entryKey, p_entry_type: entryType, p_body: body, p_payload: payload,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function prepararContratoCreativo(roomId, direction, constraints = {}) {
  const { data, error } = await supabase.rpc("preparar_contrato_creativo", {
    p_room_id: roomId, p_direction: direction, p_constraints: constraints,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function aprobarContratoCreativo(contractId, note = "") {
  const { data, error } = await supabase.rpc("aprobar_contrato_creativo", { p_contract_id: contractId, p_note: note });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearStoryboardAgencia(payload) {
  const { data, error } = await supabase.rpc("crear_storyboard_agencia", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function guardarTomaStoryboard(payload) {
  const { data, error } = await supabase.rpc("guardar_toma_storyboard", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function enviarStoryboardRevision(storyboardId) {
  const { data, error } = await supabase.rpc("enviar_storyboard_revision", { p_storyboard_id: storyboardId });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverStoryboardAgencia(storyboardId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_storyboard_agencia", {
    p_storyboard_id: storyboardId, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function prepararPlanMotion(payload) {
  const { data, error } = await supabase.rpc("preparar_plan_motion", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverPlanMotion(planId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_plan_motion", {
    p_plan_id: planId, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearPoliticaMeta(payload) {
  const { data, error } = await supabase.rpc("crear_politica_meta", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function prepararDiagnosticoMeta(snapshotId, note = "") {
  const { data, error } = await supabase.rpc("preparar_diagnostico_meta", { p_snapshot_id: snapshotId, p_note: note });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverDiagnosticoMeta(diagnosticId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_diagnostico_meta", {
    p_diagnostic_id: diagnosticId, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearEstudioIncrementalMeta(payload) {
  const { data, error } = await supabase.rpc("crear_estudio_incremental_meta", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverEstudioIncrementalMeta(studyId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_estudio_incremental_meta", { p_study_id: studyId, p_decision: decision, p_note: note });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverMedicionIncrementalMeta(measurementId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_medicion_incremental_meta", { p_measurement_id: measurementId, p_decision: decision, p_note: note });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearEscenariosInversionMeta(payload) {
  const { data, error } = await supabase.rpc("crear_escenarios_inversion_meta", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverEscenariosInversionMeta(scenarioId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_escenarios_inversion_meta", {
    p_scenario_id: scenarioId, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function solicitarAutorizacionInversionMeta(payload) {
  const { data, error } = await supabase.rpc("solicitar_autorizacion_inversion_meta", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverAutorizacionInversionMeta(authorizationId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_autorizacion_inversion_meta", {
    p_authorization_id: authorizationId, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function revocarAutorizacionInversionMeta(authorizationId, reason) {
  const { data, error } = await supabase.rpc("revocar_autorizacion_inversion_meta", {
    p_authorization_id: authorizationId, p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearVersionCreativaAgencia(payload) {
  const { data, error } = await supabase.rpc("crear_version_creativa_agencia", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function revisarVersionCreativaAgencia(versionId, status, feedback = "") {
  const { data, error } = await supabase.rpc("revisar_version_creativa_agencia", { p_version_id: versionId, p_status: status, p_feedback: feedback });
  if (error) throw new Error(error.message);
  return data;
}

/* Biblioteca Inteligente de Marca + Estudio Creativo (migración 20).
   El navegador calcula la huella del archivo; Storage conserva el original
   privado y la RPC valida que objeto, tipo, tamaño, derechos y fila coincidan. */
async function sha256File(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function subirActivoMarca(file, metadata = {}) {
  if (!(file instanceof File)) throw new Error("Elegí un archivo original para la biblioteca.");
  if (file.size <= 0 || file.size > 100 * 1024 * 1024) throw new Error("El archivo debe pesar entre 1 byte y 100 MB.");
  const allowedMime = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm)|audio\/(mpeg|mp4|wav)|application\/pdf)$/i;
  if (!allowedMime.test(file.type || "")) throw new Error("El formato del archivo no está permitido en la biblioteca de marca.");
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("La sesión expiró; volvé a iniciar sesión antes de subir el archivo.");
  const hash = await sha256File(file);
  const rawExt = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const path = `${auth.user.id}/${Date.now()}-${crypto.randomUUID()}.${rawExt}`;
  const upload = await supabase.storage.from("brand-assets").upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) throw new Error(`No se pudo subir el original: ${upload.error.message}`);
  const { data, error } = await supabase.rpc("registrar_activo_marca", {
    p: {
      ...metadata, storage_path: path, content_hash: hash,
      mime_type: file.type, size_bytes: file.size,
    },
  });
  if (error) {
    const cleanup = await supabase.storage.from("brand-assets").remove([path]);
    const cleanupNote = cleanup.error ? ` Además, no se pudo retirar el archivo huérfano: ${cleanup.error.message}` : "";
    throw new Error(`${error.message}${cleanupNote}`);
  }
  return data;
}

export async function declararLogoPrincipalMarca(assetId) {
  const prepared = await supabase.rpc("preparar_kit_identidad_marca", {
    p_change_note: "Actualizar el logo principal oficial de MOMOS",
  });
  if (prepared.error) throw new Error(prepared.error.message);
  const kitId = prepared.data?.kit_id;
  if (!kitId) throw new Error("MOMO OPS no pudo preparar la nueva versión de identidad.");

  const linked = await supabase.rpc("vincular_logo_kit_identidad", {
    p_kit_id: kitId,
    p_asset_id: assetId,
    p_role: "principal",
    p_background: "Cualquiera",
    p_channels: ["Instagram", "Facebook", "TikTok", "YouTube", "WhatsApp", "Web", "Email", "Punto de venta"],
    p_min_width_px: 48,
    p_clear_space_ratio: 0.25,
  });
  if (linked.error) throw new Error(linked.error.message);

  const activated = await supabase.rpc("activar_kit_identidad_marca", {
    p_kit_id: kitId,
    p_note: "Logo principal verificado y aprobado por el equipo de MOMOS",
  });
  if (activated.error) throw new Error(activated.error.message);
  return activated.data;
}

export async function archivarActivoMarca(assetId, reason) {
  const { data, error } = await supabase.rpc("archivar_activo_marca", { p_asset_id: assetId, p_reason: reason });
  if (error) throw new Error(error.message);
  return data;
}

export async function actualizarMetadatosActivoMarca(assetId, metadata = {}) {
  const { data, error } = await supabase.rpc("actualizar_metadatos_activo_marca", {
    p_asset_id: assetId,
    p: metadata,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function clasificarActivoProduccion(assetId, profile = {}) {
  const { data, error } = await supabase.rpc("clasificar_activo_produccion", {
    p_asset_id: assetId,
    p: profile,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearPaqueteProduccion(payload = {}) {
  const { data, error } = await supabase.rpc("crear_paquete_produccion", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function revisarPaqueteProduccion(packId, decision, note = "") {
  const { data, error } = await supabase.rpc("revisar_paquete_produccion", {
    p_pack_id: packId, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearTrabajoDesdePaqueteProduccion(packId, payload = {}) {
  const { data, error } = await supabase.rpc("preparar_trabajo_desde_paquete_produccion", {
    p_pack_id: packId, p: payload,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function eliminarActivoMarca(assetId) {
  const prepared = await supabase.rpc("preparar_eliminacion_activo_marca", { p_asset_id: assetId });
  if (prepared.error) throw new Error(prepared.error.message);
  const path = String(prepared.data?.storage_path || "");
  const previousStatus = String(prepared.data?.previous_status || "Activo");
  if (!path) {
    await supabase.rpc("cancelar_eliminacion_activo_marca", { p_asset_id: assetId, p_previous_status: previousStatus });
    throw new Error("MOMO OPS no encontró la ruta del archivo; la eliminación fue cancelada.");
  }
  const removed = await supabase.storage.from("brand-assets").remove([path]);
  if (removed.error) {
    const rollback = await supabase.rpc("cancelar_eliminacion_activo_marca", { p_asset_id: assetId, p_previous_status: previousStatus });
    const rollbackNote = rollback.error ? " Además, requiere revisión porque no se pudo restaurar su estado." : " No se cambió su estado en la biblioteca.";
    throw new Error(`No se pudo borrar el archivo real: ${removed.error.message}.${rollbackNote}`);
  }
  const confirmed = await supabase.rpc("confirmar_eliminacion_activo_marca", { p_asset_id: assetId });
  if (confirmed.error) throw new Error(`El archivo fue retirado, pero falta cerrar su registro: ${confirmed.error.message}`);
  return confirmed.data;
}

export async function eliminarLogoOficialMarca(assetId, confirmation) {
  const prepared = await supabase.rpc("preparar_eliminacion_logo_oficial", {
    p_asset_id: assetId,
    p_confirmation: confirmation,
  });
  if (prepared.error) throw new Error(prepared.error.message);
  const path = String(prepared.data?.storage_path || "");
  const previousStatus = String(prepared.data?.previous_status || "Activo");
  if (!path) {
    await supabase.rpc("cancelar_eliminacion_activo_marca", { p_asset_id: assetId, p_previous_status: previousStatus });
    throw new Error("MOMO OPS no encontró la ruta del logo; la eliminación fue cancelada.");
  }
  const removed = await supabase.storage.from("brand-assets").remove([path]);
  if (removed.error) {
    const rollback = await supabase.rpc("cancelar_eliminacion_activo_marca", { p_asset_id: assetId, p_previous_status: previousStatus });
    const rollbackNote = rollback.error
      ? " Además, requiere revisión porque no se pudo restaurar su estado."
      : " El logo continúa activo en la identidad.";
    throw new Error(`No se pudo borrar el logo real: ${removed.error.message}.${rollbackNote}`);
  }
  const confirmed = await supabase.rpc("confirmar_eliminacion_logo_oficial", {
    p_asset_id: assetId,
    p_confirmation: confirmation,
  });
  if (confirmed.error) throw new Error(`El logo fue retirado, pero falta cerrar su registro: ${confirmed.error.message}`);
  return confirmed.data;
}

export async function crearTrabajoCreativo(payload) {
  const { data, error } = await supabase.rpc("crear_trabajo_creativo", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function autorizarTrabajoCreativo(jobId, maxCostCop) {
  const { data, error } = await supabase.rpc("autorizar_trabajo_creativo", {
    p_job_id: jobId, p_max_cost_cop: maxCostCop,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverAprobacionHumanaMcp(approvalId, decision, note, expectedFingerprint) {
  const { data, error } = await supabase.rpc("resolver_aprobacion_humana_mcp", {
    p_approval_id: approvalId,
    p_decision: decision,
    p_note: note,
    p_expected_fingerprint: expectedFingerprint,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function cancelarTrabajoCreativo(jobId, reason) {
  const { data, error } = await supabase.rpc("cancelar_trabajo_creativo", { p_job_id: jobId, p_reason: reason });
  if (error) throw new Error(error.message);
  return data;
}

export async function reintentarTrabajoCreativo(jobId) {
  const { data, error } = await supabase.rpc("reintentar_trabajo_creativo", { p_job_id: jobId });
  if (error) throw new Error(error.message);
  return data;
}

export async function revisarSalidaCreativa(jobId, decision, feedback = "") {
  const { data, error } = await supabase.rpc("revisar_salida_creativa", {
    p_job_id: jobId, p_decision: decision, p_feedback: feedback,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearRevisionSalidaCreativa(jobId) {
  const { data, error } = await supabase.rpc("crear_revision_salida_creativa", { p_job_id: jobId });
  if (error) throw new Error(error.message);
  return data;
}

export async function prepararEnrutamientoEscenas(payload) {
  const { data, error } = await supabase.rpc("preparar_enrutamiento_escenas", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverEnrutamientoEscenas(planId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_enrutamiento_escenas", {
    p_plan_id: planId, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function registrarRevisionCalidadEscena(payload) {
  const { data, error } = await supabase.rpc("registrar_revision_calidad_escena", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverRevisionCalidadEscena(reviewId, decision, failureType = "Pendiente", note = "") {
  const { data, error } = await supabase.rpc("resolver_revision_calidad_escena", {
    p_review_id: reviewId, p_decision: decision, p_failure_type: failureType, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function prepararPaquetePostproduccion(payload) {
  const { data, error } = await supabase.rpc("preparar_paquete_postproduccion", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverPaquetePostproduccion(packageId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_paquete_postproduccion", {
    p_package_id: packageId, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function autorizarExportacionPostproduccion(payload) {
  const { data, error } = await supabase.rpc("autorizar_exportacion_postproduccion", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverControlMasterPostproduccion(exportId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_control_master_postproduccion", {
    p_export_id: exportId, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function reintentarExportacionPostproduccion(exportId, note = "") {
  const { data, error } = await supabase.rpc("reintentar_exportacion_postproduccion", {
    p_export_id: exportId, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function prepararGuionRetencion(payload) {
  const { data, error } = await supabase.rpc("preparar_guion_retencion", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverGuionRetencion(scriptId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_guion_retencion", {
    p_script_id: scriptId, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearExperimentoRetencion(payload) {
  const { data, error } = await supabase.rpc("crear_experimento_retencion", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function registrarMedicionRetencion(payload) {
  const { data, error } = await supabase.rpc("registrar_medicion_retencion", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function cerrarExperimentoRetencion(experimentId, resolution, winnerHookId = null, note = "") {
  const { data, error } = await supabase.rpc("cerrar_experimento_retencion", {
    p_experiment_id: experimentId, p_resolution: resolution, p_winner_hook_id: winnerHookId, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function prepararDiagnosticoRetencion(payload) {
  const { data, error } = await supabase.rpc("preparar_diagnostico_retencion", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function resolverDiagnosticoRetencion(diagnosticId, decision, note = "") {
  const { data, error } = await supabase.rpc("resolver_diagnostico_retencion", {
    p_diagnostic_id: diagnosticId, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function guardarReferenciaIntegracionAgencia(payload) {
  const { data, error } = await supabase.rpc("guardar_referencia_integracion_agencia", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function pausarIntegracionAgencia(provider, reason) {
  const { data, error } = await supabase.rpc("pausar_integracion_agencia", { p_provider: provider, p_reason: reason });
  if (error) throw new Error(error.message);
  return data;
}

export async function prepararDryRunMeta(authorizationId, adAccountId, apiVersion = "v25.0") {
  const { data, error } = await supabase.rpc("preparar_dry_run_meta", {
    p_authorization_id: authorizationId, p_ad_account_id: adAccountId, p_api_version: apiVersion,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function prepararRelevoMasterCreativo(exportId, creativeId) {
  const { data, error } = await supabase.rpc("preparar_relevo_master_creativo", {
    p_export_id: exportId, p_creative_id: creativeId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function vincularPublicacionMaster(releaseId, postId) {
  const { data, error } = await supabase.rpc("vincular_publicacion_master", {
    p_release_id: releaseId, p_post_id: postId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function setIdeaMarketingEstado(id, estado) {
  const { data, error } = await supabase.rpc("set_idea_marketing_estado", { p_id: id, p_estado: estado });
  if (error) throw new Error(error.message);
  return data;
}

export async function crearTareaMarketing(payload) {
  const { data, error } = await supabase.rpc("crear_tarea_marketing", { p: payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function setTareaMarketingEstado(id, estado) {
  const { data, error } = await supabase.rpc("set_tarea_marketing_estado", { p_id: id, p_estado: estado });
  if (error) throw new Error(error.message);
  return data;
}

export async function entradaInsumo(itemId, cant, costoTotal, nota = "") {
  const { data, error } = await supabase.rpc("entrada_insumo", { p_item_id: itemId, p_cant: cant, p_costo_total: costoTotal, p_nota: nota });
  if (error) throw new Error(error.message);
  return data; // {stock, costo}
}

export async function entradaInsumoLote({ itemId, cant, costoTotal, vence, proveedor = "", ubicacion = "", nota = "" }) {
  const { data, error } = await supabase.rpc("entrada_insumo_lote", {
    p_item_id: itemId,
    p_cant: cant,
    p_costo_total: costoTotal,
    p_vence: vence || null,
    p_proveedor: proveedor,
    p_ubicacion: ubicacion,
    p_nota: nota,
  });
  if (error) {
    const missingRpc = error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message || "");
    if (missingRpc) throw new Error("Los lotes de insumos todavía no están instalados. Aplicá la migración 12 y recargá Momo Ops.");
    throw new Error(error.message);
  }
  return data;
}

export async function desecharLoteInsumo(lotId, motivo) {
  const { data, error } = await supabase.rpc("desechar_lote_insumo", { p_lot_id: lotId, p_motivo: motivo });
  if (error) throw new Error(error.message);
  return data;
}

// H69: las variantes *_delta son aditivas y conservan las RPC anteriores como
// fallback durante el rollout. La respuesta incluye el estado autoritativo
// posterior a H68; el navegador nunca calcula el stock por su cuenta.
export function entradaInsumoLoteDelta({ itemId, cant, costoTotal, vence, proveedor = "", ubicacion = "", nota = "" }, idempotencyKey) {
  return inventoryMutationRpc("entrada_insumo_lote_delta", {
    item_id: itemId,
    cant,
    costo_total: costoTotal,
    vence: vence || null,
    proveedor,
    ubicacion,
    nota,
  }, idempotencyKey);
}

export async function registrarCompraYAtenderSugerencias(
  { itemId, cant, costoTotal, vence, proveedor = "", ubicacion = "", nota = "" },
  suggestionIds,
  idempotencyKey,
) {
  const key = String(idempotencyKey || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error("La compra agrupada no tiene una llave idempotente válida.");
  }
  const ids = Array.isArray(suggestionIds) ? suggestionIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  if (!ids.length || new Set(ids).size !== ids.length) {
    throw new Error("La compra agrupada necesita sugerencias únicas.");
  }
  const { data, error } = await supabase.rpc("registrar_compra_y_atender_sugerencias_v1", {
    p: {
      idempotency_key: key,
      suggestion_ids: ids,
      compra: {
        item_id: itemId,
        cant,
        costo_total: costoTotal,
        vence: vence || null,
        proveedor,
        ubicacion,
        nota,
      },
    },
  });
  if (error) throw rpcError(error, "No se pudo registrar la compra y cerrar sus recomendaciones.");
  return data;
}

export function movimientoInsumoDelta(itemId, tipo, cant, nota = "", idempotencyKey) {
  return inventoryMutationRpc("movimiento_insumo_delta", {
    item_id: itemId,
    tipo,
    cant,
    nota,
  }, idempotencyKey);
}

export function desecharLoteInsumoDelta(lotId, motivo, idempotencyKey) {
  return inventoryMutationRpc("desechar_lote_insumo_delta", {
    lot_id: lotId,
    motivo,
  }, idempotencyKey);
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

export async function producirSubrecetaDelta(payload) {
  const { data, error } = await supabase.rpc("producir_subreceta_delta", { p: payload });
  if (error) throw rpcError(error);
  return data;
}

export async function listarFichasTecnicasCocina(subrecipeId) {
  const { data, error } = await supabase.rpc("listar_fichas_tecnicas_cocina", {
    p_subrecipe_id: String(subrecipeId || "").trim(),
  });
  if (error) throw rpcError(error, "No se pudo consultar el historial de la ficha técnica.");
  return data;
}

export async function listarFichasIntegralesElaboracion(subrecipeId) {
  const { data, error } = await supabase.rpc("listar_fichas_integrales_elaboracion", {
    p_subrecipe_id: String(subrecipeId || "").trim(),
  });
  if (error) throw rpcError(error, "No se pudo consultar el historial integral de la elaboración.");
  return data;
}

export async function guardarFichaTecnicaCocina(payload) {
  const { data, error } = await supabase.rpc("guardar_ficha_tecnica_cocina", { p: payload });
  if (error) throw rpcError(error, "No se pudo guardar el borrador de la ficha técnica.");
  return data;
}

export async function activarFichaTecnicaCocina(id, confirmacion = "ACTIVAR FICHA") {
  const { data, error } = await supabase.rpc("activar_ficha_tecnica_cocina", {
    p_id: Number(id), p_confirmacion: confirmacion,
  });
  if (error) throw rpcError(error, "No se pudo publicar la ficha técnica.");
  return data;
}

export async function archivarBorradorFichaTecnica(id, confirmacion = "ARCHIVAR BORRADOR") {
  const { data, error } = await supabase.rpc("archivar_borrador_ficha_tecnica", {
    p_id: Number(id), p_confirmacion: confirmacion,
  });
  if (error) throw rpcError(error, "No se pudo archivar el borrador de la ficha técnica.");
  return data;
}

export async function desecharProductoTerminadoDelta({ batchId, figura, motivo, cantidadEsperada }, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error("El desecho de producto terminado no tiene una llave idempotente válida.");
  }
  if (!Number.isInteger(Number(cantidadEsperada)) || Number(cantidadEsperada) <= 0) {
    throw new Error("La cantidad de producto terminado a desechar debe ser un entero positivo.");
  }
  const { data, error } = await supabase.rpc("desechar_producto_terminado_delta", {
    p: {
      batch_id: batchId,
      figura,
      motivo,
      cantidad_esperada: Number(cantidadEsperada),
      idempotency_key: key,
    },
  });
  if (error) throw rpcError(error, "No se pudo desechar el producto terminado.");
  return data;
}

export async function setSugerenciaEstado(sugId, estado) {
  const { error } = await supabase.rpc("set_sugerencia_estado", { p_sug_id: sugId, p_estado: estado });
  if (error) throw new Error(error.message);
}
