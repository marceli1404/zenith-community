import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The prerendered public pages must survive the mount.
 *
 * web/main.tsx calls hydrateRoot() on a prerendered page instead of
 * createRoot(), so the HTML already on screen is adopted rather than thrown away
 * and painted a second time. That second paint is what Largest Contentful Paint
 * reports, and it cost ~1.4s of LCP on mobile.
 *
 * Hydration works against a DOM capture (scripts/prerender.mjs screenshots the
 * live DOM, it is not a server render) only while three invariants hold:
 *
 *   1. No <Suspense> boundary is on the first render path. React hydrates a
 *      boundary by looking for the comment markers a real server render emits,
 *      and a DOM capture has none — so web/App.tsx renders an already-resolved
 *      chunk directly (RouteView) instead of wrapping every route in Suspense.
 *   2. Markup that only exists after mount must not be captured into the static
 *      page. Left in, it becomes markup the first client render does not produce.
 *   3. The prerenderer inserts <!-- --> between adjacent text nodes, because
 *      outerHTML welds them into one and React expects them separate.
 *
 * Break any of them and nothing visibly fails — the page just silently repaints
 * and LCP regresses. Hence this test. It needs a production build: run
 * `npm run build` first.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist", "client");

/**
 * The public prerendered routes are read from the prerenderer itself so adding
 * a public route there also covers it here. The script runs on import, so parse.
 */
function prerenderedRoutes(): string[] {
  const src = readFileSync(join(ROOT, "scripts", "prerender.mjs"), "utf8");
  const routes = /const ROUTES = \[([^\]]*)\]/.exec(src);
  if (!routes) throw new Error("prerender.mjs: could not read ROUTES");
  const literals = [...routes[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  return literals;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

/** Serves dist/client the way Cloudflare Assets does: exact file, else the shell. */
function startServer(): Promise<{ server: Server; base: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let file = join(DIST, decodeURIComponent(url.pathname));
    if (!existsSync(file) || extname(file) === "") file = join(file, "index.html");
    if (!existsSync(file)) file = join(DIST, "_shell.html");
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  });
  return new Promise((resolve) =>
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    }),
  );
}

declare global {
  interface Window {
    __hydrationErrors: string[];
    __detachedHeading: boolean;
  }
}

let server: Server;
let base: string;

test.beforeAll(async () => {
  if (!existsSync(join(DIST, "index.html"))) test.skip(true, "no dist/client — run `npm run build` first");
  ({ server, base } = await startServer());
});

test.afterAll(() => server?.close());

test.describe("prerendered pages hydrate", () => {
  for (const route of prerenderedRoutes()) {
    test(`${route} keeps its prerendered DOM`, async ({ page }) => {
      await page.addInitScript(() => {
        window.__hydrationErrors = [];
        const originalError = console.error.bind(console);
        console.error = (...args: unknown[]) => {
          if (String(args[0]).includes("Page hydration recovered")) window.__hydrationErrors.push(String(args[1]));
          originalError(...args);
        };
        // A hydration failure detaches the rendered tree and builds a new one.
        window.__detachedHeading = false;
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.removedNodes) {
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              const el = node as Element;
              if (el.tagName === "H1" || el.querySelector?.("h1")) window.__detachedHeading = true;
            }
          }
        }).observe(document, { childList: true, subtree: true });
      });
      // API behavior isn't part of this check; keep all requests local and quick.
      await page.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));

      await page.goto(base + route, { waitUntil: "networkidle" });
      await expect(page.locator("h1").first()).toBeVisible();

      const { errors, detached } = await page.evaluate(() => ({
        errors: window.__hydrationErrors,
        detached: window.__detachedHeading,
      }));

      expect(errors, `React reported a hydration mismatch on ${route}`).toEqual([]);
      expect(detached, `the prerendered heading on ${route} was detached and repainted`).toBe(false);
    });
  }
});
