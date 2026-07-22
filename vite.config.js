import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const REACT_VENDOR_MODULES = [
  "/node_modules/react/",
  "/node_modules/react-dom/",
  "/node_modules/scheduler/",
];

const DATA_ACCESS_MODULES = [
  "/src/lib/supabase.js",
  "/src/lib/read-model.js",
  "/src/lib/rpc.js",
  "/src/lib/brand-identity-api.js",
  "/src/performance/runtime-performance.js",
  "/src/performance/runtime-telemetry.js",
];

export function manualChunks(id) {
  const normalizedId = id.replaceAll("\\", "/");

  if (REACT_VENDOR_MODULES.some((modulePath) => normalizedId.includes(modulePath))) {
    return "react-vendor";
  }
  if (normalizedId.includes("/node_modules/@supabase/")) {
    return "supabase-vendor";
  }
  if (DATA_ACCESS_MODULES.some((modulePath) => normalizedId.endsWith(modulePath))) {
    return "data-access";
  }
  if (normalizedId.includes("/node_modules/")) {
    return "vendor";
  }
  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
        onlyExplicitManualChunks: true,
      },
    },
  },
});
