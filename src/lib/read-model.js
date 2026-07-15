import { supabase } from "./supabase";

/* ── Fase 3 · slice 2: lecturas de MAESTROS/CATÁLOGOS desde Supabase ──
   Devuelve objetos con el shape EXACTO de la maqueta (camelCase).
   Maestros operativos y marketing hidratado se traducen al shape legado del
   monolito; las escrituras correspondientes viven en RPCs por slice.
   settings.counters NO se hidrata: los ids operativos siguen siendo locales. */

const nz = (v, def = "") => (v === null || v === undefined ? def : v);

// Sellos operativos: el server guarda timestamptz UTC; la maqueta espera hora LOCAL Bogotá.
const BOGOTA = "America/Bogota";
const fechaBogota = (ts) => (ts ? new Date(ts).toLocaleDateString("en-CA", { timeZone: BOGOTA }) : "");
const horaBogota = (ts) => (ts ? new Date(ts).toLocaleTimeString("en-GB", { timeZone: BOGOTA, hour: "2-digit", minute: "2-digit" }) : "");
const tsBogota = (ts) => (ts ? fechaBogota(ts) + " " + horaBogota(ts) : "");
const hhmm = (t) => (t ? String(t).slice(0, 5) : ""); // time 'HH:MM:SS' → 'HH:MM'

export async function fetchCatalogos() {
  const q = await Promise.all([
    supabase.from("products").select("id,nombre,cat,tipo,especie,precio,precio_rappi,costo,stock,prep,frio,lejano,activo,descr,combo_size,empaque_item_id,colchon_produccion").order("id"),
    supabase.from("combo_components").select("combo_id,component_id").order("component_id"),
    supabase.from("inventory_items").select("id,nombre,cat,unidad,stock,minimo,costo,proveedor,vence,ubicacion,compra,costo_estimado").order("id"),
    supabase.from("recipes").select("id,product_id,item_id,cantidad").order("id"),
    supabase.from("users").select("id,nombre,email,rol,activo").order("id"),
    supabase.from("toppings").select("nombre,precio,insumo_id,insumo_cant").eq("activo", true).order("orden"),
    supabase.from("figuras").select("nombre,especie,gramaje_g,product_id,activo").order("orden"),
    supabase.from("catalog_values").select("categoria,valor").eq("activo", true).order("orden"),
    supabase.from("zonas").select("nombre,tarifa").order("nombre"),
    supabase.from("proveedores_domicilio").select("nombre").eq("activo", true).order("orden"),
    supabase.from("brand_library").select("frases,tono,palabras_si,palabras_no").limit(1).maybeSingle(),
    supabase.from("app_settings").select("clave,valor"),
    supabase.from("subrecetas").select("id,nombre,tipo,sabor,merma_pct,rinde_g,item_id,activo").order("id"),
    supabase.from("subreceta_ingredientes").select("subreceta_id,item_id,cantidad").order("subreceta_id"),
    supabase.from("figura_relleno").select("id,subreceta_id,gramos_por_unidad,activo").order("id"),
    supabase.from("campaigns").select("id,nombre,canal,objetivo,producto_foco_id,oferta,fecha_inicio,fecha_fin,presupuesto,gasto_real,estado,responsable,notas").order("id"),
    supabase.from("creatives").select("id,campaign_id,titulo,canal,formato,producto_foco_id,figura,sabor,hook,copy,guion,estado,responsable,fecha_entrega,asset_url,notas,external_id,generacion").order("id"),
    supabase.from("content_posts").select("id,fecha,hora,canal,campaign_id,creative_id,titulo,copy_final,estado,url_publicacion,external_post_id,notas").order("fecha").order("hora"),
    supabase.from("metrics_daily").select("id,fecha,fuente,campaign_id,creative_id,post_id,impresiones,alcance,clicks,mensajes_wa,gasto,notas").order("fecha", { ascending: false }).order("id", { ascending: false }),
  ]);
  const conError = q.find((r) => r.error);
  if (conError) throw new Error(conError.error.message);
  const [prods, combos, items, recs, usrs, tops, figs, cats, zons, provs, brandRes, appSet, subrs, subrIngs, figRell, camps, creativeRows, postRows, metricRows] = q.map((r) => r.data);

  const productReadyResult = await supabase.rpc("productos_servidor_disponible");
  const productProbeMissing = productReadyResult.error &&
    (productReadyResult.error.code === "PGRST202" || /could not find the function|schema cache/i.test(productReadyResult.error.message || ""));
  if (productReadyResult.error && !productProbeMissing) throw new Error(productReadyResult.error.message);
  const productsServerReady = !productProbeMissing && productReadyResult.data === true;

  const lotsResult = await supabase
    .from("v_inventory_lots")
    .select("id,item_id,item_name,unidad,received_at,expires_at,initial_quantity,available_quantity,unit_cost,supplier,location,origin,status")
    .order("item_id").order("expires_at", { ascending: true, nullsFirst: false }).order("received_at");
  const lotsMissing = lotsResult.error && ["42P01", "PGRST205"].includes(lotsResult.error.code);
  if (lotsResult.error && !lotsMissing) throw new Error(lotsResult.error.message);
  const lotRows = lotsMissing ? [] : (lotsResult.data || []);

  // RLS deny-by-default devuelve VACÍO (no error): un catálogo estructural vacío = algo anda mal,
  // mejor quedarse con la caché local que pisar el db con arrays vacíos.
  // (toppings/proveedores/brand_library quedan afuera: pueden vaciarse legítimamente desde la UI.)
  const vacias = [];
  if (!prods.length) vacias.push("products");
  if (!items.length) vacias.push("inventory_items");
  if (!usrs.length) vacias.push("users");
  if (!recs.length) vacias.push("recipes");
  if (!figs.length) vacias.push("figuras");
  if (!cats.length) vacias.push("catalog_values");
  if (!zons.length) vacias.push("zonas");
  if (!appSet.length) vacias.push("app_settings");
  if (prods.some((p) => p.tipo === "combo") && !combos.length) vacias.push("combo_components");
  if (vacias.length) {
    throw new Error("Catálogos vacíos desde el servidor (" + vacias.join(", ") + ") — posible RLS; se mantiene la caché local");
  }

  const componentesDe = {};
  combos.forEach((c) => { (componentesDe[c.combo_id] = componentesDe[c.combo_id] || []).push(c.component_id); });

  const products = prods.map((p) => ({
    id: p.id, nombre: p.nombre, cat: p.cat, tipo: p.tipo,
    especie: p.especie ?? undefined,
    precio: p.precio, precioRappi: p.precio_rappi ?? Math.round(p.precio * 1.25), costo: p.costo,
    stock: p.stock ?? undefined,
    prep: p.prep, frio: p.frio, lejano: p.lejano, activo: p.activo,
    desc: nz(p.descr),
    // Variantes 3: colchón de sobre-producción por producto (advisory).
    colchonProduccion: p.colchon_produccion ?? 0,
    // atributos NO se hidrata: normalizeDbShape lo deriva SIEMPRE de tipo
    ...(p.tipo === "combo" ? {
      comboSize: p.combo_size ?? undefined,
      componentProductIds: componentesDe[p.id] || [],
      empaqueItem: nz(p.empaque_item_id),
    } : {}),
  }));

  const inventory_items = items.map((i) => ({
    id: i.id, nombre: i.nombre, cat: i.cat, unidad: i.unidad,
    stock: i.stock, min: i.minimo, costo: i.costo,
    proveedor: nz(i.proveedor), vence: nz(i.vence), ubicacion: nz(i.ubicacion), compra: nz(i.compra),
    costoEstimado: !!i.costo_estimado, // marca "corregir con compra real" (Componentes+BOM)
  }));
  const inventory_lots = lotRows.map((lot) => ({
    id: lot.id, itemId: lot.item_id, itemName: lot.item_name, unit: lot.unidad,
    receivedAt: nz(lot.received_at), expiresAt: nz(lot.expires_at),
    initialQuantity: Number(lot.initial_quantity), available: Number(lot.available_quantity),
    unitCost: Number(lot.unit_cost), supplier: nz(lot.supplier), location: nz(lot.location),
    origin: lot.origin, status: lot.status,
  }));

  const recipes = recs.map((r) => ({ id: r.id, productId: r.product_id, itemId: r.item_id, cantidad: r.cantidad }));

  const users = usrs.map((u) => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, activo: u.activo }));

  const porCat = {};
  cats.forEach((c) => { (porCat[c.categoria] = porCat[c.categoria] || []).push(c.valor); });
  const setting = {};
  appSet.forEach((s) => { setting[s.clave] = s.valor; });

  const settingsCatalogos = {
    zonas: zons.map((z) => ({ nombre: z.nombre, tarifa: Number(z.tarifa) })),
    saboresFrutales: porCat.sabor_frutal || [],
    saboresCremosos: porCat.sabor_cremoso || [],
    salsas: porCat.salsa || [],
    pagos: porCat.pago || [],
    toppings: tops.map((t) => ({ nombre: t.nombre, precio: Number(t.precio), insumoId: nz(t.insumo_id), insumoCant: Number(t.insumo_cant) })),
    figuras: figs.filter((f) => f.activo).map((f) => ({ nombre: f.nombre, especie: f.especie, gramaje: f.gramaje_g != null ? `${f.gramaje_g} g` : "" })),
    proveedores: provs.map((p) => p.nombre),
    pedidoMinimo: Number(setting.pedido_minimo ?? 25000),
    pautaMensual: Number(setting.pauta_mensual ?? 350000),
    horasCongelacion: Number(setting.horas_congelacion ?? 10),
    demoraCocinaMin: Number(setting.demora_cocina_min ?? 15),
    demoraCocinaUrgenteMin: Number(setting.demora_cocina_urgente_min ?? 30),
    demoraEmpaqueMin: Number(setting.demora_empaque_min ?? 10),
    demoraEmpaqueUrgenteMin: Number(setting.demora_empaque_urgente_min ?? 20),
    demoraRepeticionMin: Number(setting.demora_repeticion_min ?? 5),
    politicas: String(setting.politicas ?? ""),
  };
  if (setting.relleno_fijo) settingsCatalogos.rellenos = [String(setting.relleno_fijo)];

  const brand_library = brandRes ? {
    frases: Array.isArray(brandRes.frases) ? brandRes.frases : [],
    tono: Array.isArray(brandRes.tono) ? brandRes.tono : (brandRes.tono ? [String(brandRes.tono)] : []),
    palabrasSi: Array.isArray(brandRes.palabras_si) ? brandRes.palabras_si : [],
    palabrasNo: Array.isArray(brandRes.palabras_no) ? brandRes.palabras_no : [],
  } : null;

  // Producción v2: hidratación completa de la tabla figuras (activas e inactivas,
  // con product_id/gramaje_g numérico) para el grid de figuras del form de Producción.
  // settingsCatalogos.figuras arriba sigue igual (solo activas, gramaje en texto) para no romper otros consumidores.
  const figuras = figs.map((f) => ({ nombre: f.nombre, especie: f.especie, gramajeG: f.gramaje_g ?? null, productId: nz(f.product_id), activo: f.activo }));

  // Componentes + BOM (hito 2): bases/subrecetas, su receta por 1000 g y el relleno
  // configurable de figuras. Vacío es legítimo en bases sin migración — sin guard.
  const subrecetas = (subrs || []).map((sr) => ({
    id: sr.id, nombre: sr.nombre, tipo: sr.tipo, sabor: nz(sr.sabor),
    mermaPct: Number(sr.merma_pct), rindeG: Number(sr.rinde_g), itemId: sr.item_id, activo: sr.activo,
  }));
  const subreceta_ingredientes = (subrIngs || []).map((r) => ({ subrecetaId: r.subreceta_id, itemId: r.item_id, cantidad: Number(r.cantidad) }));
  const figura_relleno = (figRell || []).map((f) => ({ id: f.id, subrecetaId: f.subreceta_id, gramosPorUnidad: Number(f.gramos_por_unidad), activo: f.activo }));

  // Marketing Hito 2: campaigns desde el server. productoFoco se hidrata como NOMBRE
  // (el front lo usa por nombre en el Select y en stockProductoFoco); productoFocoId
  // conserva el id crudo. Vacío es LEGÍTIMO (marketing sin campañas) — sin guard.
  const nombreProd = {}; prods.forEach((p) => { nombreProd[p.id] = p.nombre; });
  const campaigns = (camps || []).map((c) => ({
    id: c.id, nombre: c.nombre, canal: c.canal, objetivo: c.objetivo,
    productoFocoId: nz(c.producto_foco_id, null),
    productoFoco: c.producto_foco_id ? (nombreProd[c.producto_foco_id] || "") : "",
    oferta: nz(c.oferta), fechaInicio: nz(c.fecha_inicio), fechaFin: nz(c.fecha_fin),
    presupuesto: Number(c.presupuesto || 0), gastoReal: Number(c.gasto_real || 0),
    estado: c.estado, responsable: nz(c.responsable), notas: nz(c.notas),
  }));

  // Marketing contenido v1: los tres arrays conservan el shape legado para
  // reducir la superficie del front, pero la fuente ya es Supabase. Igual que
  // campaigns, productoFoco expone nombre para la UI + id crudo para round-trip.
  const creatives = (creativeRows || []).map((c) => ({
    id: c.id, campaignId: nz(c.campaign_id), titulo: c.titulo, canal: c.canal, formato: c.formato,
    productoFocoId: nz(c.producto_foco_id, null),
    productoFoco: c.producto_foco_id ? (nombreProd[c.producto_foco_id] || "") : "",
    figuraFoco: nz(c.figura), saborFoco: nz(c.sabor), hook: nz(c.hook), copy: nz(c.copy),
    guion: nz(c.guion), estado: c.estado, responsable: nz(c.responsable),
    fechaEntrega: nz(c.fecha_entrega), assetUrl: nz(c.asset_url), notas: nz(c.notas),
    externalId: nz(c.external_id), generacion: c.generacion || null,
  }));
  const content_calendar = (postRows || []).map((p) => ({
    id: p.id, fecha: p.fecha, hora: hhmm(p.hora), canal: p.canal,
    campaignId: nz(p.campaign_id), creativeId: nz(p.creative_id), titulo: p.titulo,
    copyFinal: nz(p.copy_final), estado: p.estado, urlPublicacion: nz(p.url_publicacion),
    externalPostId: nz(p.external_post_id), notas: nz(p.notas),
  }));
  const creative_results = (metricRows || []).map((m) => ({
    id: String(m.id), fecha: m.fecha, fuente: m.fuente,
    campaignId: nz(m.campaign_id), creativeId: nz(m.creative_id), postId: nz(m.post_id),
    impresiones: Number(m.impresiones), alcance: Number(m.alcance), clicks: Number(m.clicks),
    mensajesWhatsApp: Number(m.mensajes_wa), gasto: Number(m.gasto), notas: nz(m.notas),
  }));

  return { products, productsServerReady, inventory_items, inventory_lots, inventoryLotsReady: !lotsMissing, recipes, users, settingsCatalogos, brand_library, figuras, subrecetas, subreceta_ingredientes, figura_relleno, campaigns, creatives, content_calendar, creative_results };
}

/* ── Fase 3 · slice 3a/3d: lecturas OPERATIVAS desde Supabase ──
   El servidor es el dueño del ciclo de pedido: orders, order_items (+adiciones),
   customers, deliveries, evidences (signed URLs), benefits, claims, y el rastro de
   inventario del ciclo (movements, reservations, suggestions) + audit.
   Slice 4 suma production_batches (lotes) — antes de migrar sus escrituras, porque
   escribir sin leer haría que el primer refetch post-escritura PISARA los lotes
   locales con un array vacío (misma clase de bug que 3b/3c evitaron).
   Vacío es LEGÍTIMO acá (la operación real arranca en 0). */

export async function fetchOperativo() {
  const q = await Promise.all([
    supabase.from("orders").select("id,fecha,hora,canal,customer_id,barrio,direccion,zona,dom_cobrado,dom_costo,descuento,benefit_id,pago,comprobante,estado,obs,pagado_en,metricas_cliente_actualizadas,campaign_id,creative_id,origen_detalle").order("fecha", { ascending: false }).order("hora", { ascending: false }),
    supabase.from("order_items").select("id,order_id,product_id,nombre,sabor,salsa,relleno,figura,cant,precio,costo_unitario,es_caja,parent_item_id,caja_num,es_sub_momo").order("id"),
    supabase.from("order_item_adiciones").select("order_item_id,nombre,precio,cant,insumo_id,insumo_cant"),
    supabase.from("customers").select("id,nombre,telefono,instagram,barrio,direccion,canal,primera,ultima,total,pedidos,cumple,favoritos,estado,notas").order("id"),
    supabase.from("deliveries").select("id,order_id,proveedor,costo_real,cobrado,zona,h_solicitud,h_salida,h_entrega,codigo,estado,obs").order("id"),
    supabase.from("evidences").select("id,order_id,tipo,storage_path,fecha,user_id").order("fecha"),
    supabase.from("benefits").select("id,customer_id,beneficio,tipo_beneficio,valor,producto_gratis_id,condicion,minimo,activacion,vence,estado,pedido_uso,obs").order("id"),
    supabase.from("claims").select("id,order_id,customer_id,fecha,tipo,entregado_en,reclamo_en,descr,resp,decision,solucion,costo,estado,evidencia").order("id"),
    supabase.from("inventory_movements").select("id,fecha,tipo,item_id,cant,nota").order("fecha", { ascending: false }),
    supabase.from("inventory_reservations").select("id,order_id,tipo,product_id,item_id,nombre,cantidad,fecha,estado,batch_id,figura").order("id"),
    supabase.from("production_suggestions").select("id,fecha,product_id,item_id,cantidad,motivo,order_id,estado,area,order_item_id").order("id"),
    supabase.from("audit_logs").select("id,fecha,user_id,entidad,entidad_id,accion,de,a").order("fecha", { ascending: false }),
    supabase.from("users").select("id,rol,nombre"),
    supabase.from("inventory_items").select("id,nombre,unidad"),
    supabase.from("products").select("id,nombre"),
    supabase.from("production_batches").select("id,fecha,product_id,figura,sabor,relleno,salsa,gramaje_g,prod,perfectas,imperfectas,descartadas,destino,resp_user_id,vence,estado,stock_contabilizado,horas_congelacion,inicio_congelacion,molde,ubicacion,obs,corrida_id,figuras").order("id", { ascending: false }),
    supabase.from("subreceta_producciones").select("id,fecha,subreceta_id,gramos_nominales,gramos_obtenidos,costo_batch,faltantes,resp_user_id,obs,created_at").order("created_at", { ascending: false }).limit(50),
    supabase.from("v_variantes_disponibles").select("product_id,producto,figura,sabor,gramaje_g,disponibles,vencimiento_proximo").order("producto").order("figura").order("sabor"),
  ]);
  const conError = q.find((r) => r.error);
  if (conError) throw new Error(conError.error.message);
  const [ords, items, adics, custs, delivs, evids, bens, clms, movs, resvs, sugs, audits, usrs, invs, prods, batches, subProds, variantesRows] = q.map((r) => r.data);

  // Empaque trazable se despliega después del paquete 01-08. Mientras la
  // migración 09 todavía no exista, la lectura opcional queda vacía y no rompe
  // el resto de la operación durante el rollout.
  const packingResult = await supabase
    .from("packing_verifications")
    .select("order_id,user_id,verified_at,line_ids,order_signature,snapshot")
    .order("verified_at", { ascending: false });
  const packingMissing = packingResult.error && ["42P01", "PGRST205"].includes(packingResult.error.code);
  if (packingResult.error && !packingMissing) throw new Error(packingResult.error.message);
  const packingRows = packingMissing ? [] : (packingResult.data || []);

  // Control operativo (migración 14) es opcional durante el rollout. La sonda
  // evita consultar tablas inexistentes y mantiene utilizable la versión 13.
  const operationalProbe = await supabase.rpc("operacion_pedido_disponible");
  const operationalProbeMissing = operationalProbe.error
    && (operationalProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(operationalProbe.error.message || ""));
  if (operationalProbe.error && !operationalProbeMissing) throw new Error(operationalProbe.error.message);
  const operationalControlReady = !operationalProbeMissing && operationalProbe.data === true;
  let assignmentRows = []; let progressRows = []; let incidentRows = []; let handoffRows = [];
  if (operationalControlReady) {
    const operationalResults = await Promise.all([
      supabase.from("order_stage_assignments").select("id,order_id,stage,user_id,status,claimed_at,released_at,release_reason").order("claimed_at", { ascending: false }),
      supabase.from("order_line_progress").select("order_item_id,order_id,stage,status,user_id,updated_at,version"),
      supabase.from("order_incidents").select("id,order_id,order_item_id,area,type,description,status,created_by,created_at,resolved_by,resolved_at,resolution").order("created_at", { ascending: false }),
      supabase.from("order_dispatch_handoffs").select("order_id,status,packing_user_id,logistics_user_id,offered_at,accepted_at,package_signature,note,version"),
    ]);
    const operationalError = operationalResults.find((result) => result.error);
    if (operationalError) throw new Error(operationalError.error.message);
    [assignmentRows, progressRows, incidentRows, handoffRows] = operationalResults.map((result) => result.data || []);
  }

  // CRM v2 (migración 15) también es opcional durante el despliegue. El CRM
  // histórico sigue visible con customers/orders aunque estas tablas aún no existan.
  const crmProbe = await supabase.rpc("crm_clientes_disponible");
  const crmProbeMissing = crmProbe.error
    && (crmProbe.error.code === "PGRST202" || /could not find the function|schema cache/i.test(crmProbe.error.message || ""));
  if (crmProbe.error && !crmProbeMissing) throw new Error(crmProbe.error.message);
  const crmServerReady = !crmProbeMissing && crmProbe.data === true;
  let crmProfileRows = []; let contactRows = []; let activationRows = [];
  if (crmServerReady) {
    const crmResults = await Promise.all([
      supabase.from("customer_crm_profiles").select("customer_id,contact_allowed,contact_reason,preferred_channel,acquisition_source,referred_by_customer_id,updated_by,updated_at"),
      supabase.from("customer_contacts").select("id,customer_id,channel,reason,outcome,notes,follow_up_on,activation_id,order_id,created_by,created_at").order("created_at", { ascending: false }),
      supabase.from("customer_activations").select("id,customer_id,type,title,message,status,benefit_id,expires_on,converted_order_id,created_by,created_at,updated_at").order("created_at", { ascending: false }),
    ]);
    const crmError = crmResults.find((result) => result.error);
    if (crmError) throw new Error(crmError.error.message);
    [crmProfileRows, contactRows, activationRows] = crmResults.map((result) => result.data || []);
  }

  // La cuarentena aparece con la migración 11. Es opcional durante el rollout
  // para que el front siga cargando entre la publicación y la ejecución SQL.
  const quarantineResult = await supabase
    .from("v_variantes_cuarentena")
    .select("product_id,producto,figura,sabor,gramaje_g,disponibles,vencimiento_proximo")
    .order("producto").order("figura").order("sabor");
  const quarantineMissing = quarantineResult.error && ["42P01", "PGRST205"].includes(quarantineResult.error.code);
  if (quarantineResult.error && !quarantineMissing) throw new Error(quarantineResult.error.message);
  const quarantineRows = quarantineMissing ? [] : (quarantineResult.data || []);

  const rolDe = {}; const nombreUserDe = {}; usrs.forEach((u) => { rolDe[u.id] = u.rol; nombreUserDe[u.id] = u.nombre; });
  const insumoDe = {}; invs.forEach((i) => { insumoDe[i.id] = i; });
  const productoDe = {}; prods.forEach((p) => { productoDe[p.id] = p; });

  const orders = ords.map((o) => ({
    id: o.id, fecha: o.fecha, hora: hhmm(o.hora), canal: o.canal,
    customerId: nz(o.customer_id), barrio: nz(o.barrio), direccion: nz(o.direccion), zona: nz(o.zona),
    domCobrado: o.dom_cobrado, domCosto: o.dom_costo, descuento: o.descuento,
    benefitId: nz(o.benefit_id), pago: nz(o.pago), comprobante: o.comprobante,
    estado: o.estado, obs: nz(o.obs),
    pagadoEn: o.pagado_en ? tsBogota(o.pagado_en) : undefined, // undefined, NO '' (los guards usan truthiness)
    metricasClienteActualizadas: o.metricas_cliente_actualizadas,
    campaignId: nz(o.campaign_id), creativeId: nz(o.creative_id), origenDetalle: nz(o.origen_detalle),
  }));

  const adicionesDe = {};
  adics.forEach((a) => {
    (adicionesDe[a.order_item_id] = adicionesDe[a.order_item_id] || []).push({
      nombre: a.nombre, precio: Number(a.precio), cant: Number(a.cant), insumoId: nz(a.insumo_id), insumoCant: Number(a.insumo_cant),
    });
  });
  const order_items = items.map((i) => ({
    id: i.id, orderId: i.order_id, productId: i.product_id, nombre: i.nombre,
    sabor: nz(i.sabor), salsa: nz(i.salsa), relleno: nz(i.relleno), figura: nz(i.figura),
    cant: i.cant, precio: i.precio, costoUnitario: i.costo_unitario, // COGS congelado server-side: jamás recalcular
    adiciones: adicionesDe[i.id] || [],
    esCaja: i.es_caja, esSubMomo: i.es_sub_momo,
    parentItemId: i.parent_item_id ?? undefined, cajaNum: i.caja_num ?? undefined,
  }));

  const customers = custs.map((c) => ({
    id: c.id, nombre: c.nombre, telefono: nz(c.telefono), instagram: nz(c.instagram),
    barrio: nz(c.barrio), direccion: nz(c.direccion), canal: nz(c.canal),
    primera: nz(c.primera), ultima: nz(c.ultima), total: c.total, pedidos: c.pedidos,
    cumple: nz(c.cumple), favoritos: nz(c.favoritos), estado: c.estado, notas: nz(c.notas),
  }));

  const deliveries = delivs.map((d) => ({
    id: d.id, orderId: d.order_id, proveedor: d.proveedor, costoReal: d.costo_real, cobrado: d.cobrado,
    zona: nz(d.zona), hSolicitud: hhmm(d.h_solicitud), hSalida: hhmm(d.h_salida), hEntrega: hhmm(d.h_entrega),
    codigo: nz(d.codigo), estado: d.estado, obs: nz(d.obs),
  }));

  // Evidencias: bucket privado → signed URLs (8 h; se regeneran en cada hidratación)
  let urlDe = {};
  const paths = evids.map((e) => e.storage_path).filter(Boolean);
  if (paths.length) {
    const { data: firmadas, error: errFirma } = await supabase.storage.from("evidencias").createSignedUrls(paths, 60 * 60 * 8);
    if (!errFirma && firmadas) firmadas.forEach((f, i) => { if (f.signedUrl) urlDe[paths[i]] = f.signedUrl; });
  }
  const evidences = evids.map((e) => ({
    id: e.id, orderId: e.order_id, tipo: e.tipo,
    url: urlDe[e.storage_path] || "",
    fecha: fechaBogota(e.fecha), hora: horaBogota(e.fecha),
    user: nz(rolDe[e.user_id]), // la maqueta guarda el ROL del que subió
  }));

  const benefits = bens.map((b) => ({
    id: b.id, customerId: b.customer_id, beneficio: b.beneficio, tipoBeneficio: b.tipo_beneficio,
    valor: b.valor, productoGratisId: nz(b.producto_gratis_id), condicion: nz(b.condicion), minimo: b.minimo,
    activacion: nz(b.activacion), vence: nz(b.vence), estado: b.estado, pedidoUso: nz(b.pedido_uso), obs: nz(b.obs),
  }));

  const claims = clms.map((c) => ({
    id: c.id, orderId: c.order_id, customerId: nz(c.customer_id), fecha: c.fecha, tipo: c.tipo,
    hEntrega: horaBogota(c.entregado_en), hReclamo: horaBogota(c.reclamo_en), // legacy HH:MM
    entregadoEn: tsBogota(c.entregado_en), reclamoEn: tsBogota(c.reclamo_en), // canónicos (ventana de 20 min)
    desc: nz(c.descr), resp: nz(c.resp), decision: nz(c.decision), solucion: nz(c.solucion),
    costo: c.costo, estado: c.estado, evidencia: nz(c.evidencia),
  }));

  const inventory_movements = movs.map((m) => {
    const it = insumoDe[m.item_id];
    const n = Number(m.cant);
    return {
      id: m.id, fecha: tsBogota(m.fecha), tipo: m.tipo,
      item: it ? it.nombre : "", cant: (n > 0 ? "+" : "") + n + " " + (it ? it.unidad : ""),
      nota: nz(m.nota),
    };
  });

  const inventory_reservations = resvs.map((r) => ({
    id: r.id, orderId: r.order_id, tipo: r.tipo,
    refId: r.tipo === "producto" ? nz(r.product_id) : nz(r.item_id),
    nombre: r.nombre, cantidad: r.cantidad, fecha: tsBogota(r.fecha), estado: r.estado,
    // Variantes 1b: lote físico asignado por el FIFO al pagar (null en remanente
    // a producir, legacy sin lote_figuras, o tipo empaque/insumo).
    batchId: nz(r.batch_id), figuraLote: nz(r.figura),
  }));

  const production_suggestions = sugs.map((s) => ({
    id: s.id, fecha: s.fecha,
    producto: s.area === "Inventario" ? (insumoDe[s.item_id] ? insumoDe[s.item_id].nombre : "") : (productoDe[s.product_id] ? productoDe[s.product_id].nombre : ""),
    cantidad: s.cantidad, motivo: nz(s.motivo), orderId: nz(s.order_id), estado: s.estado, area: s.area,
    itemId: nz(s.item_id),
    productId: nz(s.product_id), // Variantes 3: lookup del colchón del producto en el front

    // Variantes 2: item del pedido que espera — figura/sabor pedidos se
    // resuelven contra db.order_items (la cola del server asigna con esto).
    orderItemId: nz(s.order_item_id),
  }));

  const audit_logs = audits.map((a) => ({
    id: a.id, fecha: tsBogota(a.fecha), user: nz(rolDe[a.user_id]),
    entidad: a.entidad, entidadId: nz(a.entidad_id), accion: a.accion, de: nz(a.de), a: nz(a.a),
  }));

  const packing_verifications = packingRows.map((verification) => ({
    orderId: verification.order_id,
    userId: verification.user_id,
    user: nz(nombreUserDe[verification.user_id], nz(rolDe[verification.user_id], "Empaque")),
    verifiedAt: tsBogota(verification.verified_at),
    lineIds: verification.line_ids || [],
    orderSignature: verification.order_signature,
    snapshot: verification.snapshot || [],
  }));

  const order_stage_assignments = assignmentRows.map((row) => ({
    id: row.id, orderId: row.order_id, stage: row.stage, userId: row.user_id,
    user: nz(nombreUserDe[row.user_id]), status: row.status, claimedAt: tsBogota(row.claimed_at),
    releasedAt: tsBogota(row.released_at), releaseReason: nz(row.release_reason),
  }));
  const order_line_progress = progressRows.map((row) => ({
    orderItemId: row.order_item_id, orderId: row.order_id, stage: row.stage,
    status: row.status, userId: row.user_id, user: nz(nombreUserDe[row.user_id]),
    updatedAt: tsBogota(row.updated_at), version: Number(row.version),
  }));
  const order_incidents = incidentRows.map((row) => ({
    id: row.id, orderId: row.order_id, orderItemId: nz(row.order_item_id), area: row.area,
    type: row.type, description: row.description, status: row.status,
    createdBy: row.created_by, createdByName: nz(nombreUserDe[row.created_by]), createdAt: tsBogota(row.created_at),
    resolvedBy: nz(row.resolved_by), resolvedAt: tsBogota(row.resolved_at), resolution: nz(row.resolution),
  }));
  const order_dispatch_handoffs = handoffRows.map((row) => ({
    orderId: row.order_id, status: row.status, packingUserId: row.packing_user_id,
    packingUser: nz(nombreUserDe[row.packing_user_id]), logisticsUserId: nz(row.logistics_user_id),
    logisticsUser: nz(nombreUserDe[row.logistics_user_id]), offeredAt: tsBogota(row.offered_at),
    acceptedAt: tsBogota(row.accepted_at), packageSignature: row.package_signature,
    note: nz(row.note), version: Number(row.version),
  }));

  const customer_crm_profiles = crmProfileRows.map((row) => ({
    customerId: row.customer_id, contactAllowed: row.contact_allowed, contactReason: nz(row.contact_reason),
    preferredChannel: row.preferred_channel, acquisitionSource: nz(row.acquisition_source),
    referredByCustomerId: nz(row.referred_by_customer_id), updatedBy: nz(row.updated_by), updatedAt: tsBogota(row.updated_at),
  }));
  const customer_contacts = contactRows.map((row) => ({
    id: String(row.id), customerId: row.customer_id, channel: row.channel, reason: row.reason,
    outcome: row.outcome, notes: nz(row.notes), followUpOn: nz(row.follow_up_on),
    activationId: row.activation_id == null ? "" : String(row.activation_id), orderId: nz(row.order_id),
    createdBy: row.created_by, createdByName: nz(nombreUserDe[row.created_by]), createdAt: tsBogota(row.created_at),
  }));
  const customer_activations = activationRows.map((row) => ({
    id: String(row.id), customerId: row.customer_id, type: row.type, title: row.title, message: nz(row.message),
    status: row.status, benefitId: nz(row.benefit_id), expiresOn: nz(row.expires_on),
    convertedOrderId: nz(row.converted_order_id), createdBy: row.created_by,
    createdByName: nz(nombreUserDe[row.created_by]), createdAt: tsBogota(row.created_at), updatedAt: tsBogota(row.updated_at),
  }));

  // Shape EXACTO de la maqueta (db.batches / production_batches en MomosOps.jsx):
  // producto/resp son STRINGS (nombre), no ids — el server normalizó a FK
  // (product_id, resp_user_id) pero el front sigue leyendo por nombre.
  // gramaje: la maqueta guarda "150 g" (texto); el server normalizó a integer (gramaje_g).
  const production_batches = batches.map((b) => ({
    id: b.id, fecha: b.fecha,
    producto: productoDe[b.product_id] ? productoDe[b.product_id].nombre : "",
    figura: nz(b.figura), sabor: nz(b.sabor), relleno: nz(b.relleno), salsa: nz(b.salsa),
    gramaje: b.gramaje_g != null ? `${b.gramaje_g} g` : "",
    prod: b.prod, perfectas: b.perfectas, imperfectas: b.imperfectas, descartadas: b.descartadas,
    destino: nz(b.destino, "—"),
    resp: nz(nombreUserDe[b.resp_user_id]), vence: nz(b.vence),
    estado: b.estado, stockContabilizado: b.stock_contabilizado,
    horasCongelacion: b.horas_congelacion,
    inicioCongelacion: b.inicio_congelacion ? tsBogota(b.inicio_congelacion) : "",
    molde: nz(b.molde), ubicacion: nz(b.ubicacion), obs: nz(b.obs),
    corridaId: b.corrida_id || "", figuras: Array.isArray(b.figuras) ? b.figuras : [],
  }));

  // Componentes + BOM (hito 2): historial de preparaciones de bases (últimas 50).
  const subreceta_producciones = (subProds || []).map((sp) => ({
    id: sp.id, fecha: sp.fecha, subrecetaId: sp.subreceta_id,
    gramosNominales: Number(sp.gramos_nominales), gramosObtenidos: Number(sp.gramos_obtenidos),
    costoBatch: Number(sp.costo_batch), faltantes: Array.isArray(sp.faltantes) ? sp.faltantes : [],
    resp: nz(nombreUserDe[sp.resp_user_id]), obs: nz(sp.obs), creado: tsBogota(sp.created_at),
  }));

  // Variantes Etapa 1a: disponible por (producto, figura, sabor, gramaje) — nace
  // del desmolde por figura (v_variantes_disponibles agrega lote_figuras de lotes
  // Listo contabilizados; lotes viejos sin detalle por figura quedan fuera a propósito).
  const variantes = (variantesRows || []).map((v) => ({
    productId: v.product_id, producto: v.producto, figura: v.figura, sabor: nz(v.sabor),
    gramajeG: v.gramaje_g, disponibles: Number(v.disponibles), vence: nz(v.vencimiento_proximo),
  }));
  const variantesCuarentena = quarantineRows.map((v) => ({
    productId: v.product_id, producto: v.producto, figura: v.figura, sabor: nz(v.sabor),
    gramajeG: v.gramaje_g, disponibles: Number(v.disponibles), vence: nz(v.vencimiento_proximo),
  }));

  return { orders, order_items, customers, deliveries, evidences, benefits, claims, inventory_movements, inventory_reservations, production_suggestions, audit_logs, packing_verifications, production_batches, subreceta_producciones, variantes, variantesCuarentena, operationalControlReady, order_stage_assignments, order_line_progress, order_incidents, order_dispatch_handoffs, crmServerReady, customer_crm_profiles, customer_contacts, customer_activations };
}
