import test from "node:test";
import assert from "node:assert/strict";
import { supabase } from "./supabase.js";
import { fetchBrandIdentity } from "./brand-identity-api.js";

const identityDto = {
  available: true,
  ready: true,
  assets: [{ binding_id: 3, role: "principal", asset: { id: 8, name: "Logo MOMOS" } }],
};

test("Agencia carga metadatos de identidad sin firmar archivos en su portada", async () => {
  const originalRpc = supabase.rpc;
  const originalFrom = supabase.from;
  let storageReads = 0;
  supabase.rpc = async () => ({ data: identityDto, error: null });
  supabase.from = () => {
    storageReads += 1;
    throw new Error("La portada no debe consultar Storage.");
  };
  try {
    const result = await fetchBrandIdentity();
    assert.equal(result, identityDto);
    assert.equal(storageReads, 0);
  } finally {
    supabase.rpc = originalRpc;
    supabase.from = originalFrom;
  }
});

test("Identidad firma únicamente sus logos cuando la persona abre el detalle", async () => {
  const originalRpc = supabase.rpc;
  const originalFrom = supabase.from;
  const originalStorageFrom = supabase.storage.from;
  const calls = [];
  supabase.rpc = async (name, args) => {
    calls.push(["rpc", name, args]);
    return { data: identityDto, error: null };
  };
  supabase.from = (table) => ({
    select: (columns) => ({
      in: async (field, ids) => {
        calls.push(["table", table, columns, field, ids]);
        return { data: [{ id: 8, storage_path: "logos/momos.webp" }], error: null };
      },
    }),
  });
  supabase.storage.from = (bucket) => ({
    createSignedUrls: async (paths, ttl) => {
      calls.push(["storage", bucket, paths, ttl]);
      return { data: [{ path: "logos/momos.webp", signedUrl: "https://signed.invalid/logo" }], error: null };
    },
  });
  try {
    const result = await fetchBrandIdentity({ includeHistory: true, signAssets: true });
    assert.equal(result.assets[0].asset.signed_url, "https://signed.invalid/logo");
    assert.deepEqual(calls, [
      ["rpc", "obtener_identidad_marca", { p_include_history: true }],
      ["table", "brand_media_assets", "id,storage_path", "id", [8]],
      ["storage", "brand-assets", ["logos/momos.webp"], 600],
    ]);
  } finally {
    supabase.rpc = originalRpc;
    supabase.from = originalFrom;
    supabase.storage.from = originalStorageFrom;
  }
});
