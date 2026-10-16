import { defineConfig, devices } from "@playwright/test";

/**
 * Runs the existing end-to-end suite against a production Worker build through
 * local Wrangler, instead of Vite's static-only preview server.
 *
 * Why this exists: the Worker sends a strict `script-src` CSP with no
 * 'unsafe-inline' (src/middleware.ts, committed in 223e5ce). In development the
 * React plugin injects its own inline react-refresh preamble, which that CSP
 * blocks. Vite preview also bypasses the Worker asset router, so it cannot
 * verify the shell, noindex, or not-found response behavior.
 *
 *   npm run build
 *   npx wrangler d1 migrations apply zenith-community-db --local --config dist/zenith_community_app/wrangler.json
 *   npx wrangler dev --local --config dist/zenith_community_app/wrangler.json --port 4173
 *   npm run test:e2e:preview
 *
 * PREVIEW_URL overrides the target. There is no webServer here, so whatever
 * already listens on :4173 is what gets tested — in a worktree, serve this
 * checkout's generated Worker config on its own port, then run with
 * PREVIEW_URL=http://127.0.0.1:4183.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: { baseURL: process.env.PREVIEW_URL ?? "http://localhost:4173", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
