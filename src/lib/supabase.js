import { createClient } from "@supabase/supabase-js";

// Publishable key: segura en el bundle del cliente (RLS es quien protege los datos).
// La service key JAMÁS va acá ni en ningún archivo del repo.
const SUPABASE_URL = "https://csojbqpvujymesuvntxb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_v8gX8INyqyApDAXhVmaPTg_DOzQJMjM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
