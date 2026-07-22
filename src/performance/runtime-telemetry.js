import { createRuntimePerformance, estimateJsonBytes } from "./runtime-performance.js";

export function shouldEnableRuntimePerformance({ dev = false, search = "" } = {}) {
  if (dev) return true;
  try {
    return new URLSearchParams(String(search || "")).get("momosPerf") === "1";
  } catch {
    return false;
  }
}

const exposeEnabled = shouldEnableRuntimePerformance({
  dev: Boolean(import.meta.env?.DEV),
  search: typeof window !== "undefined" ? window.location?.search : "",
});
// H96 conserva solo contadores, histogramas y estados cerrados. Se recolectan en
// produccion para reportar SLO, pero el detalle de diagnostico sigue visible
// unicamente en desarrollo o cuando un administrador abre ?momosPerf=1.
const enabled = typeof window !== "undefined";

function exposeRuntimePerformance(state) {
  if (!exposeEnabled || typeof window === "undefined") return;
  window.MOMOS_PERF_METRICS = state;
  // El atributo permite a la prueba E2E leer el resumen desde un mundo de
  // automatización aislado. El contrato ya está agregado y no contiene URL,
  // payload, identidad, notas ni mensajes de error.
  document.documentElement?.setAttribute("data-momos-perf", JSON.stringify({
    http: state.http,
    sync: state.sync,
    routes: state.routes,
    activeRoute: state.activeRoute,
  }));
}

export const runtimePerformance = createRuntimePerformance({
  enabled,
  onChange: exposeRuntimePerformance,
});

// La consola de medición debe existir desde el primer frame, incluso si la
// primera navegación todavía no ha producido una muestra. Así un build de
// preview puede auditarse con `?momosPerf=1` sin esperar otro evento.
exposeRuntimePerformance(runtimePerformance.snapshot());

function syncSource(value) {
  const source = String(value || "").toLowerCase();
  if (source.startsWith("snapshot")) return "snapshot";
  if (source.startsWith("legacy")) return "legacy";
  if (source.startsWith("cache")) return "cache";
  if (source.startsWith("realtime")) return "realtime";
  return "unknown";
}

export async function measureSyncLoad(domain, loader) {
  if (!runtimePerformance.isEnabled()) return loader();
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  try {
    const data = await loader();
    const completedAt = globalThis.performance?.now?.() ?? Date.now();
    runtimePerformance.recordSync({
      domain,
      source: syncSource(data?.syncSource),
      ok: true,
      durationMs: Math.max(0, completedAt - startedAt),
      bytesIn: estimateJsonBytes(data),
    });
    return data;
  } catch (error) {
    const completedAt = globalThis.performance?.now?.() ?? Date.now();
    runtimePerformance.recordSync({
      domain,
      source: "unknown",
      ok: false,
      durationMs: Math.max(0, completedAt - startedAt),
      bytesIn: 0,
    });
    throw error;
  }
}
