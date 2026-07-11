import { supabase } from "./supabase";

/* ── Fase 3 · slice 2: lecturas de MAESTROS/CATÁLOGOS desde Supabase ──
   Devuelve objetos con el shape EXACTO de la maqueta (camelCase).
   Lo operativo (orders, customers, lotes, reclamos, marketing) sigue local
   hasta que su slice porte las escrituras por RPC.
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
    supabase.from("products").select("id,nombre,cat,tipo,especie,precio,precio_rappi,costo,stock,prep,frio,lejano,activo,descr,combo_size,empaque_item_id").order("id"),
    supabase.from("combo_components").select("combo_id,component_id").order("component_id"),
    supabase.from("inventory_items").select("id,nombre,cat,unidad,stock,minimo,costo,proveedor,vence,ubicacion,compra").order("id"),
    supabase.from("recipes").select("id,product_id,item_id,cantidad").order("id"),
    supabase.from("users").select("id,nombre,email,rol,activo").order("id"),
    supabase.from("toppings").select("nombre,precio,insumo_id,insumo_cant").eq("activo", true).order("orden"),
    supabase.from("figuras").select("nombre,especie,gramaje_g").eq("activo", true).order("orden"),
    supabase.from("catalog_values").select("categoria,valor").eq("activo", true).order("orden"),
    supabase.from("zonas").select("nombre,tarifa").order("nombre"),
    supabase.from("proveedores_domicilio").select("nombre").eq("activo", true).order("orden"),
    supabase.from("brand_library").select("frases,tono,palabras_si,palabras_no").limit(1).maybeSingle(),
    supabase.from("app_settings").select("clave,valor"),
  ]);
  const conError = q.find((r) => r.error);
  if (conError) throw new Error(conError.error.message);
  const [prods, combos, items, recs, usrs, tops, figs, cats, zons, provs, brandRes, appSet] = q.map((r) => r.data);

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
    figuras: figs.map((f) => ({ nombre: f.nombre, especie: f.especie, gramaje: f.gramaje_g != null ? `${f.gramaje_g} g` : "" })),
    proveedores: provs.map((p) => p.nombre),
    pedidoMinimo: Number(setting.pedido_minimo ?? 25000),
    pautaMensual: Number(setting.pauta_mensual ?? 350000),
    horasCongelacion: Number(setting.horas_congelacion ?? 10),
    politicas: String(setting.politicas ?? ""),
  };
  if (setting.relleno_fijo) settingsCatalogos.rellenos = [String(setting.relleno_fijo)];

  const brand_library = brandRes ? {
    frases: Array.isArray(brandRes.frases) ? brandRes.frases : [],
    tono: Array.isArray(brandRes.tono) ? brandRes.tono : (brandRes.tono ? [String(brandRes.tono)] : []),
    palabrasSi: Array.isArray(brandRes.palabras_si) ? brandRes.palabras_si : [],
    palabrasNo: Array.isArray(brandRes.palabras_no) ? brandRes.palabras_no : [],
  } : null;

  return { products, inventory_items, recipes, users, settingsCatalogos, brand_library };
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
    supabase.from("inventory_reservations").select("id,order_id,tipo,product_id,item_id,nombre,cantidad,fecha,estado").order("id"),
    supabase.from("production_suggestions").select("id,fecha,product_id,item_id,cantidad,motivo,order_id,estado,area").order("id"),
    supabase.from("audit_logs").select("id,fecha,user_id,entidad,entidad_id,accion,de,a").order("fecha", { ascending: false }),
    supabase.from("users").select("id,rol,nombre"),
    supabase.from("inventory_items").select("id,nombre,unidad"),
    supabase.from("products").select("id,nombre"),
    supabase.from("production_batches").select("id,fecha,product_id,figura,sabor,relleno,salsa,gramaje_g,prod,perfectas,imperfectas,descartadas,destino,resp_user_id,vence,estado,stock_contabilizado,horas_congelacion,inicio_congelacion,molde,ubicacion,obs").order("id", { ascending: false }),
  ]);
  const conError = q.find((r) => r.error);
  if (conError) throw new Error(conError.error.message);
  const [ords, items, adics, custs, delivs, evids, bens, clms, movs, resvs, sugs, audits, usrs, invs, prods, batches] = q.map((r) => r.data);

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
  }));

  const production_suggestions = sugs.map((s) => ({
    id: s.id, fecha: s.fecha,
    producto: s.area === "Inventario" ? (insumoDe[s.item_id] ? insumoDe[s.item_id].nombre : "") : (productoDe[s.product_id] ? productoDe[s.product_id].nombre : ""),
    cantidad: s.cantidad, motivo: nz(s.motivo), orderId: nz(s.order_id), estado: s.estado, area: s.area,
    itemId: nz(s.item_id),
  }));

  const audit_logs = audits.map((a) => ({
    id: a.id, fecha: tsBogota(a.fecha), user: nz(rolDe[a.user_id]),
    entidad: a.entidad, entidadId: nz(a.entidad_id), accion: a.accion, de: nz(a.de), a: nz(a.a),
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
  }));

  return { orders, order_items, customers, deliveries, evidences, benefits, claims, inventory_movements, inventory_reservations, production_suggestions, audit_logs, production_batches };
}
