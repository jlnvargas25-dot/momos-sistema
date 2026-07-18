import { supabase } from "./supabase";

const isMissingRpc = (error) => error && (error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message || ""));

export async function fetchBrandIdentity({ includeHistory = false } = {}) {
  const result = await supabase.rpc("obtener_identidad_marca", { p_include_history: includeHistory });
  if (isMissingRpc(result.error)) return null;
  if (result.error) throw new Error(result.error.message);
  const dto = result.data || {};
  const assets = Array.isArray(dto.assets) ? dto.assets : [];
  const ids = [...new Set(assets.map((item) => Number(item.asset?.id)).filter(Number.isFinite))];
  if (!ids.length) return dto;

  // La identidad carga únicamente sus logos exactos. No vuelve a descargar la
  // Biblioteca completa ni firma fotos/videos que esta pantalla no necesita.
  const rows = await supabase.from("brand_media_assets").select("id,storage_path").in("id", ids);
  if (rows.error) throw new Error(rows.error.message);
  const paths = (rows.data || []).map((row) => row.storage_path).filter(Boolean);
  const signed = paths.length ? await supabase.storage.from("brand-assets").createSignedUrls(paths, 600) : { data: [], error: null };
  if (signed.error) throw new Error(signed.error.message);
  const urlByPath = new Map((signed.data || []).map((item) => [item.path, item.signedUrl]));
  const pathById = new Map((rows.data || []).map((row) => [Number(row.id), row.storage_path]));
  return {
    ...dto,
    assets: assets.map((binding) => ({
      ...binding,
      asset: { ...binding.asset, signed_url: urlByPath.get(pathById.get(Number(binding.asset?.id))) || "" },
    })),
  };
}
