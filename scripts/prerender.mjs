/**
 * Build-time prerendering for the Community edition's public pages.
 *
 * The app is a client-rendered SPA, which means the initial HTTP response for a
 * public URL would otherwise be an empty <div id="root">. That is bad for
 * crawlers that don't execute JS and for link previews. This script serves the
 * built client locally, renders each public route in headless Chromium, and
 * writes the resulting HTML back into dist/client as a real static file.
 *
 * Cloudflare Assets serves an exact file match (e.g. /security ->
 * dist/client/security/index.html) in preference to the SPA fallback, so those
 * URLs now return real content. The authenticated app is deliberately NOT
 * prerendered.
 *
 * The untouched shell is also written to _shell.html. The Worker serves that for
 * client-only routes (/app/*, /login, …) so deep links never flash prerendered
 * marketing markup, without needing a CSP-violating inline script.
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist", "client");

/** Public routes present in the Community app. Authenticated pages are excluded. */
const ROUTES = ["/", "/security", "/methodology", "/contact", "/legal/privacy", "/legal/terms"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".webp": "image/webp",
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let filePath = join(DIST, decodeURIComponent(url.pathname));
      if (!existsSync(filePath) || extname(filePath) === "") {
        // SPA fallback for routes without a matching file. It must be the
        // pristine shell, never index.html: by the time we render /security this
        // run has already overwritten index.html with the landing markup, and a
        // rebuild leaves last run's prerendered files on disk. The client
        // hydrates whatever markup it is given, so serving stale or wrong-route
        // HTML here would bake a hydration mismatch into the output.
        filePath = join(DIST, "_shell.html");
      }
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("prerender: dist/client/index.html not found — run `vite build` first.");
    process.exit(1);
  }

  // Preserve the pristine shell for client-only routes before we overwrite
  // index.html with prerendered landing markup. Running this script twice
  // without a rebuild would otherwise copy the landing page over the shell, and
  // every client-only route would be served marketing markup.
  const shell = await readFile(join(DIST, "index.html"), "utf8");
  if (shell.includes("data-boot-frame")) {
    await writeFile(join(DIST, "_shell.html"), shell, "utf8");
    console.log("wrote _shell.html (client-only route shell)");
  } else if (existsSync(join(DIST, "_shell.html"))) {
    console.log("kept _shell.html (index.html is already prerendered)");
  } else {
    console.error("prerender: index.html is already prerendered and no _shell.html exists — run `vite build` first.");
    process.exit(1);
  }

  const server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  // Reduced motion keeps components that animate after mount (the hero story)
  // in their first, finished render, so the snapshot is what hydration expects
  // and what a visitor without JavaScript should see.
  const page = await browser.newPage({ reducedMotion: "reduce" });
  // The API isn't running during prerender; fail those calls fast and quietly.
  await page.route("**/api/**", (route) => route.abort());

  let count = 0;
  for (const route of ROUTES) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    // Wait for the app to replace the boot frame (index.html) and for the
    // route's real content to exist before capturing.
    await page.waitForFunction(() => !document.querySelector("[data-boot-frame]"), null, { timeout: 15_000 });
    await page.waitForSelector("h1", { timeout: 10_000 }).catch(() => {});
    const html = await page.evaluate(() => {
      // Runtime-only markup must not be baked into the static HTML.
      for (const node of document.querySelectorAll("[data-runtime]")) node.remove();
      // The <noscript> summary in index.html is for the client-only shell. A
      // prerendered page already carries its real content, so there it would
      // only repeat a second, generic <h1> under the page.
      for (const node of document.querySelectorAll("body > noscript")) node.remove();

      /*
       * `outerHTML` welds adjacent text nodes into one string, so `{note} and
       * some words` comes back as a single text node and React, which expects
       * two, throws the whole page away and re-renders it. A real server render
       * avoids this by emitting <!-- --> between them; do the same here.
       */
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const joins = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nextSibling?.nodeType === Node.TEXT_NODE) joins.push(n);
      }
      for (const n of joins) n.parentNode.insertBefore(document.createComment(" "), n.nextSibling);

      return "<!doctype html>\n" + document.documentElement.outerHTML;
    });

    /*
     * The entry script keeps its normal fetch priority.
     *
     * Lowering it was worth ~0.8s of FCP, because its ~140 kB stops competing
     * with the stylesheet and the font — but a prerendered page is painted, not
     * interactive, and every <button> is dead until React hydrates. Measured on
     * a throttled phone against live, that left the mobile menu visible and
     * ignoring taps for ~1.8s, and the nav links sit inside the dialog only that
     * button opens. Links are real anchors and still work; buttons are not.
     * If this is revisited, make the pre-hydration state honest first.
     */

    const outPath =
      route === "/" ? join(DIST, "index.html") : join(DIST, route.replace(/^\//, ""), "index.html");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, html, "utf8");
    const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
    console.log(`prerendered ${route.padEnd(18)} -> ${kb} kB`);
    count++;
  }

  await browser.close();
  server.close();
  console.log(`prerender: ${count} routes written.`);
}

main().catch((err) => {
  console.error("prerender failed:", err);
  process.exit(1);
});
