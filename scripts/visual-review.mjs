/**
 * Deterministic visual-review screenshots for Zenith Community.
 *
 *   npm run visual:review
 *   VISUAL_BASE_URL=https://your-community-instance.example npm run visual:review
 *
 * Captures each review surface across viewports and both themes into
 * artifacts/visual-review/ as <surface>-<viewport>-<theme>.png. Astra reviews
 * the rendered PNGs (never approves from code alone). Files are git-ignored;
 * only the latest set is kept locally / as CI artifacts.
 *
 * If VISUAL_BASE_URL is unset, it boots `vite preview` against a prior build.
 * Theme is forced by seeding localStorage (the app reads a 'theme' key) and
 * setting Playwright's colorScheme, so shots are stable regardless of OS theme.
 */

import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "artifacts", "visual-review");

/** Review surfaces. Add the Labs root once it exists as a route. */
const SURFACES = [
  { name: "scope-hero", path: "/", full: false },
  { name: "scope-security", path: "/security", full: true },
  { name: "scope-methodology", path: "/methodology", full: true },
  { name: "scope-contact", path: "/contact", full: true },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const THEMES = ["light", "dark"];

function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok || res.status < 500) return resolve();
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > timeoutMs) return reject(new Error(`server not ready: ${url}`));
      setTimeout(tick, 500);
    };
    tick();
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });

  let base = process.env.VISUAL_BASE_URL;
  let server;
  if (!base) {
    base = "http://127.0.0.1:4173";
    console.log("VISUAL_BASE_URL unset — starting `vite preview` (run `npm run build` first).");
    server = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], {
      cwd: ROOT,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    await waitForServer(base);
  }

  const browser = await chromium.launch();
  let count = 0;
  try {
    for (const theme of THEMES) {
      for (const vp of VIEWPORTS) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          colorScheme: theme,
          deviceScaleFactor: 1,
        });
        // Seed the app's stored theme preference before any page script runs.
        await context.addInitScript((t) => {
          try {
            localStorage.setItem("wh-theme", t); // key used by web/lib/theme.tsx
          } catch {
            /* storage blocked */
          }
        }, theme);

        const page = await context.newPage();
        for (const surface of SURFACES) {
          // Tablet is redundant for the hero-only shot; keep the matrix lean.
          if (surface.name === "scope-hero" && vp.name === "tablet") continue;
          await page.goto(base + surface.path, { waitUntil: "domcontentloaded" });
          await page.waitForSelector("h1", { timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(400); // let fonts/layout settle
          const file = join(OUT, `${surface.name}-${vp.name}-${theme}.png`);
          await page.screenshot({ path: file, fullPage: surface.full });
          console.log(`  ${surface.name.padEnd(18)} ${vp.name.padEnd(8)} ${theme.padEnd(5)} -> ${file.slice(ROOT.length + 1)}`);
          count++;
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log(`visual:review — ${count} screenshots written to artifacts/visual-review/`);
}

main().catch((err) => {
  console.error("visual:review failed:", err);
  process.exit(1);
});
