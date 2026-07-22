import { createClient } from "@supabase/supabase-js";
import { createInstrumentedFetch } from "../performance/runtime-performance.js";
import { runtimePerformance } from "../performance/runtime-telemetry.js";

// Publishable key: segura en el bundle del cliente (RLS es quien protege los datos).
// La service key JAMÁS va acá ni en ningún archivo del repo.
// Staging inyecta solo valores publicos al arrancar Vite. La service role nunca
// entra al navegador ni al repositorio.
const viteEnv = import.meta.env || {};
const SUPABASE_URL = String(viteEnv.VITE_SUPABASE_URL || "https://csojbqpvujymesuvntxb.supabase.co").trim();
const SUPABASE_PUBLISHABLE_KEY = String(viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_v8gX8INyqyApDAXhVmaPTg_DOzQJMjM").trim();

const clientOptions = runtimePerformance.isEnabled()
  ? { global: { fetch: createInstrumentedFetch({ telemetry: runtimePerformance }) } }
  : undefined;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, clientOptions);
