import { createClient } from "@supabase/supabase-js";

// Cliente público de Pide. SOLO la clave publicable (anon) — nunca service_role.
// El anon únicamente puede EXECUTE las RPC públicas whitelisteadas
// (catalogo_publico_v1, cotizar_pedido_v1, reservar_checkout_v1, iniciar_pago_v1);
// no ve tablas de OPS ni costos/márgenes. Mismos valores base que OPS.
const env = import.meta.env || {};
const SUPABASE_URL = String(env.VITE_SUPABASE_URL || "https://csojbqpvujymesuvntxb.supabase.co").trim();
const SUPABASE_PUBLISHABLE_KEY = String(
  env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_v8gX8INyqyApDAXhVmaPTg_DOzQJMjM",
).trim();

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
