import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwind()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:4000" } },
  // The only chunk above Vite's 500 kB default is the lazily loaded, desktop-only
  // three.js hero scene (~134 kB gzip). Keep this limit tight so anything else still warns.
  build: { sourcemap: false, chunkSizeWarningLimit: 560 },
});
