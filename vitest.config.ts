import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests run in a plain Node environment. They target pure, isomorphic
// modules (SSRF, entitlements, scoring, prompt generation, webhook idempotency)
// that have no Worker-runtime or DOM dependencies.
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
});
