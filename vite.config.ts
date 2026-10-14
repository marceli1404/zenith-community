import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The Cloudflare Vite plugin serves the React SPA (from ./web) as static assets
// and runs the Worker (./src/index.ts) for /api/* routes in a single dev server.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({ configPath: "./wrangler.jsonc" }),
  ],
  define: {
    // The footer's copyright year, frozen at build time. `new Date()` during
    // render would disagree with the prerendered HTML across a year boundary,
    // and hydration would throw the prerendered page away to fix one character.
    __BUILD_YEAR__: JSON.stringify(String(new Date().getFullYear())),
  },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@web": fileURLToPath(new URL("./web", import.meta.url)),
    },
  },
  build: {
    // The Cloudflare Vite plugin owns the output layout: client assets land in
    // dist/client (matching wrangler.jsonc assets.directory) and the worker in
    // dist/<name>. Do not override outDir here or the paths nest incorrectly.
    sourcemap: false,
  },
});
