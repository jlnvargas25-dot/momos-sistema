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

export async function guardarConfiguracionDemoras(settings) {
  const rows = [
    { clave: "demora_cocina_min", valor: settings.demoraCocinaMin },
    { clave: "demora_cocina_urgente_min", valor: settings.demoraCocinaUrgenteMin },
    { clave: "demora_empaque_min", valor: settings.demoraEmpaqueMin },
    { clave: "demora_empaque_urgente_min", valor: settings.demoraEmpaqueUrgenteMin },
    { clave: "demora_repeticion_min", valor: settings.demoraRepeticionMin },
  ];
  const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "clave" });
  if (error) throw new Error(error.message);
  return settings;
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

export async function archivarActivoMarca(assetId, reason) {
  const { data, error } = await supabase.rpc("archivar_activo_marca", { p_asset_id: assetId, p_reason: reason });
  if (error) throw new Error(error.message);
  return data;
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
