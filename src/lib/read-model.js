import { supabase } from "./supabase";

/* ── Fase 3 · slice 2: lecturas de MAESTROS/CATÁLOGOS desde Supabase ──
   Devuelve objetos con el shape EXACTO de la maqueta (camelCase).
   Lo operativo (orders, customers, lotes, reclamos, marketing) sigue local
   hasta que su slice porte las escrituras por RPC.
   settings.counters NO se hidrata: los ids operativos siguen siendo locales. */

const nz = (v, def = "") => (v === null || v === undefined ? def : v);

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
