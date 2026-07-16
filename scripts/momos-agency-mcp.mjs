import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  MOMOS_AGENCY_MCP_VERSION,
  buildAgencyMcpRun,
  creativeContextRpc,
  normalizeAgencyMcpSnapshot,
} from "../src/lib/momos-agency-mcp.js";

const VERSION = `momos-agency-mcp/${MOMOS_AGENCY_MCP_VERSION}`;
const SELF_TEST = process.argv.includes("--self-test");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const WORKER_ID = String(process.env.MOMOS_MCP_WORKER_ID || `${hostname()}-${process.pid}`).trim();
const PROPOSALS_ENABLED = String(process.env.MOMOS_MCP_PROPOSALS_ENABLED || "false").toLowerCase() === "true";

function isSupabaseServerKey(value) {
  const key = String(value || "").trim();
  if (key.startsWith("sb_secret_")) return true;
  if (key.startsWith("sb_publishable_")) return false;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role"; }
  catch { return false; }
}

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno privado del MCP.");
let supabaseEndpoint;
try { supabaseEndpoint = new URL(SUPABASE_URL); }
catch { throw new Error("SUPABASE_URL debe ser la URL completa del proyecto MOMOS OPS."); }
if (!/^https?:$/.test(supabaseEndpoint.protocol)) throw new Error("SUPABASE_URL debe usar HTTP o HTTPS.");
if (!isSupabaseServerKey(SERVICE_KEY)) throw new Error("SUPABASE_SERVICE_ROLE_KEY no es una clave privada válida.");
if (!/^[A-Za-z0-9._:-]{2,120}$/.test(WORKER_ID)) throw new Error("MOMOS_MCP_WORKER_ID es inválido.");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const hash = (value) => createHash("md5").update(JSON.stringify(value ?? null)).digest("hex");
const redact = (value) => String(value || "Error MCP")
  .replace(/(sb_secret_|eyJ)[A-Za-z0-9._-]+/g, "[credencial redactada]")
  .replace(/(access[_-]?token|api[_-]?key|app[_-]?secret|service[_-]?role)\s*[:=]\s*\S+/gi, "$1=[redactado]")
  .slice(0, 600);
const requestKey = (tool) => `${tool}:${Date.now()}:${randomUUID().replaceAll("-", "").slice(0, 16)}`;

async function rpc(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message);
  return data;
}

async function logAccess({ key, tool, mode = "Lectura", status, input, output, subject = "", details = {} }) {
  try {
    await rpc("registrar_acceso_mcp_agencia", { p: {
      request_key: key, tool_name: tool, mode, status, worker_id: WORKER_ID,
      subject_ref: subject, input_fingerprint: hash(input), output_fingerprint: output == null ? "" : hash(output), details,
    } });
  } catch (error) {
    console.error(`[MOMOS MCP] No se pudo registrar la bitácora: ${redact(error.message)}`);
  }
}

const textResult = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const errorResult = (message) => ({ isError: true, content: [{ type: "text", text: redact(message) }] });

async function governedTool(tool, input, callback, { mode = "Lectura", subject = "" } = {}) {
  const key = requestKey(tool);
  try {
    const output = await callback();
    await logAccess({ key, tool, mode, status: "OK", input, output, subject, details: { version: VERSION, external_execution: false } });
    return textResult(output);
  } catch (error) {
    await logAccess({ key, tool, mode, status: mode === "Propuesta" && !PROPOSALS_ENABLED ? "Denegado" : "Fallido", input, subject, details: { version: VERSION, error: redact(error.message), external_execution: false } });
    return errorResult(error.message);
  }
}

async function selfTest() {
  const available = await rpc("mcp_agency_gateway_disponible");
  const context = normalizeAgencyMcpSnapshot(await rpc("obtener_contexto_director_agencia"));
  process.stdout.write(`[MOMOS MCP] Salud OK · gateway ${available ? "activo" : "inactivo"} · contexto ${context.fingerprint.slice(0, 8)} · propuestas ${PROPOSALS_ENABLED ? "habilitadas" : "protegidas"}\n`);
}

if (SELF_TEST) {
  await selfTest();
} else {
  const server = new McpServer({ name: "momos-agency", version: MOMOS_AGENCY_MCP_VERSION });

  server.registerTool("momos_health", {
    title: "Salud del Cerebro de Agencia MOMOS",
    description: "Comprueba el gateway semántico. No devuelve secretos ni ejecuta acciones.",
    inputSchema: z.object({}),
  }, async (input) => governedTool("momos_health", input, async () => ({
    ok: Boolean(await rpc("mcp_agency_gateway_disponible")), version: VERSION,
    proposals_enabled: PROPOSALS_ENABLED, external_execution_allowed: false,
  })));

  server.registerTool("momos_agency_snapshot", {
    title: "Snapshot seguro de MOMOS OPS",
    description: "Lee señales agregadas de pedidos, operación, inventario, CRM y Agencia sin PII. No ofrece SQL libre.",
    inputSchema: z.object({}),
  }, async (input) => governedTool("momos_agency_snapshot", input, async () => normalizeAgencyMcpSnapshot(await rpc("obtener_contexto_director_agencia"))));

  server.registerTool("momos_meta_observatory", {
    title: "Contexto analítico Meta",
    description: "Lee el contexto gobernado del Observatorio Meta. No crea, pausa, publica ni cambia presupuesto.",
    inputSchema: z.object({}),
  }, async (input) => governedTool("momos_meta_observatory", input, async () => rpc("obtener_contexto_meta_agente")));

  server.registerTool("momos_creative_context", {
    title: "Contexto creativo gobernado",
    description: "Lee un contexto exacto de routing, motion, calidad o retención mediante RPC de lista cerrada.",
    inputSchema: z.object({
      kind: z.enum(["routing", "motion", "quality", "retention"]),
      id: z.number().int().positive(),
    }),
  }, async (input) => governedTool("momos_creative_context", input, async () => {
    const route = creativeContextRpc(input.kind);
    return rpc(route.rpc, { [route.param]: input.id });
  }, { subject: `${input.kind}:${input.id}` }));

  server.registerTool("momos_submit_proposals", {
    title: "Enviar propuestas a revisión humana",
    description: "Registra propuestas selladas en MOMO OPS. Nunca ejecuta la acción propuesta y está deshabilitada por defecto.",
    inputSchema: z.object({
      requestKey: z.string().min(3).max(160).regex(/^[A-Za-z0-9:_-]+$/),
      snapshotFingerprint: z.string().regex(/^[0-9a-f]{32}$/),
      focus: z.string().min(3).max(180),
      proposals: z.array(z.record(z.string(), z.unknown())).max(12),
    }),
  }, async (input) => governedTool("momos_submit_proposals", input, async () => {
    if (!PROPOSALS_ENABLED) throw new Error("Las propuestas MCP están protegidas. Activá MOMOS_MCP_PROPOSALS_ENABLED=true en el entorno privado para registrarlas.");
    const run = buildAgencyMcpRun(input);
    const result = await rpc("registrar_corrida_orquestador_agente", { p: run });
    return { ...result, external_execution: false, requires_human_approval: true };
  }, { mode: "Propuesta", subject: input.focus.slice(0, 180) }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[MOMOS MCP] ${VERSION} listo por stdio · propuestas ${PROPOSALS_ENABLED ? "habilitadas" : "protegidas"}`);
  process.on("SIGINT", async () => { await server.close(); process.exit(0); });
}

