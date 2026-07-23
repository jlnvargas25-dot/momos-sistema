import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Pide MOMOS — app pública. El harness inyecta PORT; si no, 5174 (OPS usa 5173).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: Number(process.env.PORT) || 5174 },
});
