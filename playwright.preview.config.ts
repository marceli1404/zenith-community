import { defineConfig, devices } from "@playwright/test";

/**
 * Runs the existing end-to-end suite against a *production build* served by
 * `npx vite preview --port 4173`, instead of the Vite dev server.
 *
 * Why this exists: the Worker sends a strict `script-src` CSP with no
 * 'unsafe-inline' (src/middleware.ts, committed in 223e5ce). In development the
 * React plugin injects its own inline react-refresh preamble, which that CSP
 * blocks, so the SPA never boots on `npm run dev` and every DOM assertion fails
 * with an empty document. The production build has no inline script, so this
 * config exercises the same specs against something that actually renders.
 *
 *   npm run build && npx vite preview --port 4173 --strictPort
 *   npm run test:e2e:preview
 *
 * PREVIEW_URL overrides the target. There is no webServer here, so whatever
 * already listens on :4173 is what gets tested — in a worktree, serve this
 * checkout's build on its own port (e.g. `npx vite preview --port 4183
 * --strictPort`) and run with PREVIEW_URL=http://localhost:4183, or you may
 * be testing another checkout's old build.
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
