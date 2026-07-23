import { supabase } from "./supabase.js";

// Lee el catálogo público autoritativo. Contrato: momos.pide.catalogo.v1
// (RPC catalogo_publico_v1(), sin args, EXECUTE a anon). Los precios vienen del
// servidor (products.precio_pide); el navegador NUNCA calcula ni envía precio.
export async function fetchCatalog() {
  const { data, error } = await supabase.rpc("catalogo_publico_v1");
  if (error) return { ok: false, error: error.message };
  if (!data || data.ok !== true) return { ok: false, error: data?.error || "CATALOGO_NO_DISPONIBLE" };

  const productos = Array.isArray(data.productos) ? data.productos : [];
  const grupos = [];
  const index = new Map();
  for (const p of productos) {
    const categoria = p.categoria || "Menú";
    if (!index.has(categoria)) {
      const grupo = { categoria, items: [] };
      index.set(categoria, grupo);
      grupos.push(grupo);
    }
    index.get(categoria).items.push(p);
  }

  return {
    ok: true,
    moneda: data.moneda || "COP",
    pedidoMinimo: Number(data.pedido_minimo || 0),
    grupos,
    categorias: grupos.map((g) => g.categoria),
    figuras: Array.isArray(data.figuras) ? data.figuras : [],
    sabores: Array.isArray(data.sabores) ? data.sabores : [],
    salsas: Array.isArray(data.salsas) ? data.salsas : [],
    zonas: Array.isArray(data.zonas) ? data.zonas : [],
    franjas: Array.isArray(data.franjas) ? data.franjas : [],
  };
}
