import { createRuntimePerformance, estimateJsonBytes } from "./runtime-performance.js";

export function shouldEnableRuntimePerformance({ dev = false, search = "" } = {}) {
  if (dev) return true;
  try {
    return new URLSearchParams(String(search || "")).get("momosPerf") === "1";
  } catch {
    return false;
  }
}

const enabled = shouldEnableRuntimePerformance({
  dev: Boolean(import.meta.env?.DEV),
  search: typeof window !== "undefined" ? window.location?.search : "",
});

export const runtimePerformance = createRuntimePerformance({
  enabled,
  onChange: (state) => {
    if (enabled && typeof window !== "undefined") window.MOMOS_PERF_METRICS = state;
  },
});

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
