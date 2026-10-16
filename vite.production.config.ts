import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({ configPath: "./wrangler.production.jsonc" }),
  ],
  define: {
    __BUILD_YEAR__: JSON.stringify(String(new Date().getFullYear())),
  },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@web": fileURLToPath(new URL("./web", import.meta.url)),
    },
  },
  build: { sourcemap: false },
});
